from __future__ import annotations

import argparse
from pathlib import Path

from flask import Flask, jsonify, request

from multisectorbd.config import ConfigError, validate_config_path
from multisectorbd.query import QueryError, QueryOptions, check_config, execute_query, load_schema
from multisectorbd.schema_fetch import SchemaError
from multisectorbd.state import AppState


def create_app(state: AppState) -> Flask:
    app = Flask(__name__)
    app.config["APP_STATE"] = state

    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
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

    @app.route("/api/segments", methods=["GET"])
    def list_segments():
        s: AppState = app.config["APP_STATE"]
        try:
            config = validate_config_path(s.config_path)
        except ConfigError as exc:
            return jsonify({"error": str(exc)}), 500
        segments = [
            {
                "name": seg.name,
                "host": seg.host,
                "port": seg.port,
                "database": seg.database,
                "user": seg.user,
            }
            for seg in config.segments
        ]
        return jsonify({"segments": segments})

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
                schema, source = load_schema(s, config)
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

        s: AppState = app.config["APP_STATE"]
        try:
            with s.lock:
                results = execute_query(
                    s,
                    sql,
                    segments,
                    QueryOptions(stop_on_first_match=stop_on_first_match),
                )
        except QueryError as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify({"results": results})

    return app


def run_server(
    *,
    config: Path,
    connect_timeout_secs: int,
    max_concurrent_segments: int,
    host: str,
    port: int,
) -> None:
    state = AppState(
        config_path=config,
        connect_timeout_secs=max(1, connect_timeout_secs),
        max_concurrent_segments=max(1, max_concurrent_segments),
    )

    config_data = check_config(state)
    schema, source = load_schema(state, config_data)
    state.schema = schema
    state.schema_source = source

    app = create_app(state)
    print(f"HTTP сервер запущен на {host}:{port}")
    app.run(host=host, port=port, threaded=True)
