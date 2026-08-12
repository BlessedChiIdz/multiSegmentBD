from __future__ import annotations

import argparse
from pathlib import Path

from flask import Flask, jsonify, request

from multisectorbd.config import (
    ConfigError,
    find_segment,
    segment_password_info,
    set_password_vault,
    validate_config_path,
)
from multisectorbd.credential_vault import CredentialVault, CredentialVaultError
from multisectorbd.db_runner import (
    dispose_all_segment_engines,
    invalidate_segment_engines,
    ping_segment,
)
from multisectorbd.query import QueryError, QueryOptions, check_config, load_schema, start_query
from multisectorbd.query_jobs import QueryJobError, query_job_manager
from multisectorbd.schema_fetch import SchemaError
from multisectorbd.segment_health import check_all_segments
from multisectorbd.state import AppState

DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


class CredentialsLockedError(Exception):
    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__("требуется разблокировка хранилища паролей")


def _require_credentials(s: AppState, config) -> None:
    missing = s.vault.missing_for_segments(config.segments)
    if missing:
        raise CredentialsLockedError(missing)


def _credentials_error_response(exc: CredentialsLockedError):
    return (
        jsonify(
            {
                "error": str(exc),
                "code": "credentials_locked",
                "missing": exc.missing,
            }
        ),
        403,
    )


def create_app(
    state: AppState,
    *,
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS,
) -> Flask:
    app = Flask(__name__)
    app.config["APP_STATE"] = state
    allowed_origins = set(cors_origins)

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin")
        if origin and origin in allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"})

    @app.route("/api/status", methods=["GET"])
    def status():
        s: AppState = app.config["APP_STATE"]
        with s.lock:
            return jsonify(
                {
                    "config_path": str(s.config_path),
                    "connect_timeout_secs": s.connect_timeout_secs,
                    "max_concurrent_segments": s.max_concurrent_segments,
                    "schema_source": s.schema_source,
                    "table_count": len(s.schema.get("tables", [])),
                }
            )

    @app.route("/api/credentials/status", methods=["GET"])
    def credentials_status():
        s: AppState = app.config["APP_STATE"]
        try:
            config = validate_config_path(s.config_path)
        except ConfigError as exc:
            return jsonify({"error": str(exc)}), 500
        return jsonify(s.vault.status_payload(config.segments))

    @app.route("/api/credentials/unlock", methods=["POST", "OPTIONS"])
    def credentials_unlock():
        if request.method == "OPTIONS":
            return ("", 204)

        s: AppState = app.config["APP_STATE"]
        body = request.get_json(silent=True) or {}
        master_password = str(body.get("master_password", ""))

        try:
            s.vault.unlock(master_password)
            config = validate_config_path(s.config_path)
        except (CredentialVaultError, ConfigError) as exc:
            return jsonify({"error": str(exc)}), 400

        missing = s.vault.missing_for_segments(config.segments)
        return jsonify(
            {
                "ok": True,
                "unlocked": True,
                "missing": missing,
            }
        )

    @app.route("/api/credentials/setup", methods=["POST", "OPTIONS"])
    def credentials_setup():
        if request.method == "OPTIONS":
            return ("", 204)

        s: AppState = app.config["APP_STATE"]
        body = request.get_json(silent=True) or {}
        master_password = str(body.get("master_password", ""))
        raw_passwords = body.get("passwords") or {}
        if not isinstance(raw_passwords, dict):
            return jsonify({"error": "passwords должен быть объектом"}), 400

        passwords = {str(key): str(value) for key, value in raw_passwords.items()}

        try:
            config = validate_config_path(s.config_path)
            required = s.vault.vault_segment_ids(config.segments)
            for segment_id in required:
                if not passwords.get(segment_id):
                    return (
                        jsonify({"error": f"не указан пароль для {segment_id}"}),
                        400,
                    )
            s.vault.setup(master_password, passwords)
        except (CredentialVaultError, ConfigError) as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify({"ok": True, "unlocked": True, "missing": []})

    @app.route("/api/credentials/save", methods=["POST", "OPTIONS"])
    def credentials_save():
        if request.method == "OPTIONS":
            return ("", 204)

        s: AppState = app.config["APP_STATE"]
        body = request.get_json(silent=True) or {}
        master_password = str(body.get("master_password", ""))
        raw_passwords = body.get("passwords") or {}
        if not isinstance(raw_passwords, dict):
            return jsonify({"error": "passwords должен быть объектом"}), 400

        passwords = {str(key): str(value) for key, value in raw_passwords.items() if value}
        if not passwords:
            return jsonify({"error": "нет паролей для сохранения"}), 400

        try:
            if s.vault.is_unlocked:
                s.vault.save_passwords(passwords, master_password or None)
            else:
                s.vault.setup(master_password, passwords)
            config = validate_config_path(s.config_path)
        except (CredentialVaultError, ConfigError) as exc:
            return jsonify({"error": str(exc)}), 400

        missing = s.vault.missing_for_segments(config.segments)
        return jsonify({"ok": True, "unlocked": True, "missing": missing})

    @app.route("/api/credentials/lock", methods=["POST", "OPTIONS"])
    def credentials_lock():
        if request.method == "OPTIONS":
            return ("", 204)

        s: AppState = app.config["APP_STATE"]
        s.vault.lock()
        dispose_all_segment_engines()
        return jsonify({"ok": True, "unlocked": False})

    @app.route("/api/connections/<path:connection_id>/settings", methods=["GET"])
    def connection_settings(connection_id: str):
        s: AppState = app.config["APP_STATE"]
        try:
            config = validate_config_path(s.config_path)
            seg = find_segment(config, connection_id)
        except ConfigError as exc:
            return jsonify({"error": str(exc)}), 404

        pwd = segment_password_info(seg)
        return jsonify(
            {
                "id": seg.name,
                "name": seg.label,
                "group": seg.group,
                "host": seg.host,
                "port": seg.port,
                "database": seg.database,
                "user": seg.user,
                "password_source": pwd["source"],
                "password_configured": pwd["configured"],
                "can_edit_password": pwd["can_edit"],
                "password_hint": pwd.get("hint"),
                "password_env": pwd.get("env_var"),
            }
        )

    @app.route(
        "/api/connections/<path:connection_id>/password",
        methods=["POST", "OPTIONS"],
    )
    def connection_password(connection_id: str):
        if request.method == "OPTIONS":
            return ("", 204)

        s: AppState = app.config["APP_STATE"]
        body = request.get_json(silent=True) or {}
        password = str(body.get("password", ""))

        try:
            config = validate_config_path(s.config_path)
            seg = find_segment(config, connection_id)
            pwd = segment_password_info(seg)
            if not pwd["can_edit"]:
                return jsonify({"error": "пароль этого подключения нельзя изменить здесь"}), 400
            if not password:
                return jsonify({"error": "пароль не может быть пустым"}), 400
            if not s.vault.is_unlocked:
                return jsonify({"error": "хранилище паролей заблокировано"}), 403

            s.vault.save_passwords({seg.name: password})
            invalidate_segment_engines(seg.name)
        except (ConfigError, CredentialVaultError) as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify({"ok": True, "password_configured": True})

    @app.route(
        "/api/connections/<path:connection_id>/test",
        methods=["POST", "OPTIONS"],
    )
    def connection_test(connection_id: str):
        if request.method == "OPTIONS":
            return ("", 204)

        s: AppState = app.config["APP_STATE"]
        body = request.get_json(silent=True) or {}
        password_override = body.get("password")
        if password_override is not None:
            password_override = str(password_override)

        try:
            config = validate_config_path(s.config_path)
            seg = find_segment(config, connection_id)
            if password_override:
                result = ping_segment(seg, password_override=password_override)
            else:
                _require_credentials(s, config)
                result = ping_segment(seg)
        except CredentialsLockedError as exc:
            return _credentials_error_response(exc)
        except ConfigError as exc:
            return jsonify({"error": str(exc)}), 404

        return jsonify(
            {
                "ok": result.get("ok", False),
                "latency_ms": result.get("latency_ms"),
                "error": result.get("error"),
            }
        )

    @app.route("/api/segments", methods=["GET"])
    def list_segments():
        s: AppState = app.config["APP_STATE"]
        try:
            config = validate_config_path(s.config_path)
        except ConfigError as exc:
            return jsonify({"error": str(exc)}), 500
        groups = [
            {
                "name": group.name,
                "alert": group.alert,
                "connections": [
                    {
                        "id": seg.name,
                        "name": seg.label,
                        "group": seg.group,
                        "host": seg.host,
                        "port": seg.port,
                        "database": seg.database,
                        "user": seg.user,
                    }
                    for seg in group.connections
                ],
            }
            for group in config.groups
        ]
        return jsonify({"groups": groups})

    @app.route("/api/segments/health", methods=["GET"])
    def segments_health():
        s: AppState = app.config["APP_STATE"]
        try:
            config = validate_config_path(s.config_path)
            _require_credentials(s, config)
        except ConfigError as exc:
            return jsonify({"error": str(exc)}), 500
        except CredentialsLockedError as exc:
            return _credentials_error_response(exc)

        segments_map = check_all_segments(
            config.segments,
            s.connect_timeout,
            s.max_concurrent_segments,
        )
        online = sum(1 for item in segments_map.values() if item.get("ok"))
        return jsonify(
            {
                "segments": segments_map,
                "online": online,
                "total": len(segments_map),
            }
        )

    @app.route("/api/schema", methods=["GET"])
    def get_schema():
        s: AppState = app.config["APP_STATE"]
        with s.lock:
            return jsonify({"source": s.schema_source, "schema": s.schema})

    @app.route("/api/schema/reload", methods=["POST", "OPTIONS"])
    def reload_schema():
        if request.method == "OPTIONS":
            return ("", 204)

        s: AppState = app.config["APP_STATE"]
        with s.lock:
            try:
                config = validate_config_path(s.config_path)
                _require_credentials(s, config)
                schema, source = load_schema(s, config)
            except CredentialsLockedError as exc:
                return _credentials_error_response(exc)
            except (ConfigError, SchemaError) as exc:
                return jsonify({"error": str(exc)}), 500
            s.schema = schema
            s.schema_source = source
            return jsonify({"source": s.schema_source, "schema": s.schema})

    @app.route("/api/query", methods=["POST", "OPTIONS"])
    def post_query():
        if request.method == "OPTIONS":
            return ("", 204)

        body = request.get_json(silent=True) or {}
        sql = body.get("sql", "")
        segments = body.get("segments") or []
        stop_on_first_match = bool(body.get("stop_on_first_match", False))
        autocommit = body.get("autocommit", True)
        if not isinstance(autocommit, bool):
            autocommit = bool(autocommit)

        s: AppState = app.config["APP_STATE"]
        try:
            config = validate_config_path(s.config_path)
            _require_credentials(s, config)
            query_id = start_query(
                s,
                sql,
                segments,
                QueryOptions(
                    stop_on_first_match=stop_on_first_match,
                    autocommit=autocommit,
                ),
            )
        except CredentialsLockedError as exc:
            return _credentials_error_response(exc)
        except QueryError as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify({"query_id": query_id})

    @app.route("/api/query/<query_id>", methods=["GET"])
    def get_query(query_id: str):
        job = query_job_manager.get(query_id)
        if not job:
            return jsonify({"error": "запрос не найден"}), 404
        return jsonify(job.to_dict())

    @app.route("/api/query/<query_id>/cancel", methods=["POST", "OPTIONS"])
    def cancel_query(query_id: str):
        if request.method == "OPTIONS":
            return ("", 204)

        body = request.get_json(silent=True) or {}
        segment_list = body.get("segments") or None
        if segment_list is not None and not isinstance(segment_list, list):
            segment_list = None

        try:
            query_job_manager.cancel(query_id, segment_list)
        except QueryJobError as exc:
            return jsonify({"error": str(exc)}), 404

        return jsonify({"ok": True})

    return app


def run_server(
    *,
    config: Path,
    credentials: Path | None,
    connect_timeout_secs: int,
    max_concurrent_segments: int,
    host: str,
    port: int,
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS,
) -> None:
    credentials_path = credentials or (config.parent / "credentials.enc")
    vault = CredentialVault(credentials_path)
    state = AppState(
        config_path=config,
        credentials_path=credentials_path,
        connect_timeout_secs=max(1, connect_timeout_secs),
        max_concurrent_segments=max(1, max_concurrent_segments),
        vault=vault,
    )
    set_password_vault(vault)

    config_data = check_config(state)
    missing = vault.missing_for_segments(config_data.segments)
    if not missing:
        try:
            schema, source = load_schema(state, config_data)
            state.schema = schema
            state.schema_source = source
        except SchemaError:
            state.schema = {"tables": []}
            state.schema_source = ""

    app = create_app(state, cors_origins=cors_origins)
    print(f"HTTP сервер запущен на {host}:{port}")
    print(f"CORS разрешён для: {', '.join(cors_origins)}")
    if missing:
        print(
            "Хранилище паролей не разблокировано — откройте интерфейс и введите мастер-пароль"
        )
    app.run(host=host, port=port, threaded=True)
