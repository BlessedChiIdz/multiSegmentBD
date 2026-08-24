from __future__ import annotations

import argparse
from pathlib import Path

from multisectorbd.app import DEFAULT_CORS_ORIGINS, run_server


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Многосегментный PostgreSQL — HTTP API (Flask)",
    )
    parser.add_argument(
        "-c",
        "--config",
        type=Path,
        default=Path("segments.json"),
        help="Путь к конфигу сегментов",
    )
    parser.add_argument(
        "--credentials-file",
        type=Path,
        default=None,
        help="Путь к зашифрованному хранилищу паролей",
    )
    parser.add_argument(
        "--connect-timeout-secs",
        type=int,
        default=30,
        metavar="SECS",
        help="Таймаут подключения и запроса к сегменту",
    )
    parser.add_argument(
        "--max-concurrent-segments",
        type=int,
        default=10,
        metavar="N",
        help="Параллельных подключений к сегментам",
    )
    parser.add_argument(
        "--cors-origin",
        action="append",
        default=None,
        metavar="URL",
        help=(
            "Разрешённый Origin для CORS"
            "По умолчанию: http://localhost:3000 и http://127.0.0.1:3000"
        ),
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Адрес HTTP-сервера",
    )
    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=8080,
        help="Порт HTTP-сервера",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    cors_origins = tuple(args.cors_origin) if args.cors_origin else DEFAULT_CORS_ORIGINS
    run_server(
        config=args.config,
        credentials=args.credentials_file,
        connect_timeout_secs=args.connect_timeout_secs,
        max_concurrent_segments=args.max_concurrent_segments,
        host=args.host,
        port=args.port,
        cors_origins=cors_origins,
    )


if __name__ == "__main__":
    main()
