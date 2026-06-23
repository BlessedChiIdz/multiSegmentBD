from __future__ import annotations

import argparse
from pathlib import Path

from multisectorbd.app import run_server


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
    run_server(
        config=args.config,
        connect_timeout_secs=args.connect_timeout_secs,
        max_concurrent_segments=args.max_concurrent_segments,
        host=args.host,
        port=args.port,
    )


if __name__ == "__main__":
    main()
