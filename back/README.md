# multiSegmentBD

HTTP API для выполнения SQL-запросов по нескольким сегментам PostgreSQL (параллельно, с фильтром сегментов и режимом «остановиться на первом совпадении»).

## Запуск

```bash
cargo run -- --config segments.json --host 127.0.0.1 --port 8080
```

Параметры:

| Флаг | По умолчанию | Описание |
|------|--------------|----------|
| `-c` / `--config` | `segments.json` | Путь к конфигу сегментов |
| `--connect-timeout-secs` | `30` | Таймаут подключения и запроса к сегменту |
| `--max-concurrent-segments` | `10` | Параллельных подключений к сегментам |
| `--host` | `127.0.0.1` | Адрес HTTP-сервера |
| `-p` / `--port` | `8080` | Порт HTTP-сервера |

При старте загружается схема `public` с первого сегмента в конфиге.

## API

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/health` | Проверка живости |
| `GET` | `/api/status` | Путь к конфигу, таймауты, источник схемы |
| `GET` | `/api/segments` | Список сегментов (без паролей) |
| `GET` | `/api/schema` | Кэшированная схема БД |
| `POST` | `/api/schema/reload` | Перезагрузить схему с эталонного сегмента |
| `POST` | `/api/query` | Выполнить SQL на сегментах |

### POST `/api/query`

```json
{
  "sql": "SELECT 1",
  "segments": ["seg_a"],
  "stop_on_first_match": false
}
```

- `segments` — пустой массив = все сегменты из конфига.
- `stop_on_first_match` — остановиться после первого сегмента с ненулевым результатом SELECT.

Ответ:

```json
{
  "results": [
    {
      "segment": "seg_a",
      "ok": true,
      "columns": ["?column?"],
      "row_count": 1,
      "rows": [[1]]
    }
  ]
}
```

## Конфиг сегментов

Формат `segments.json` без изменений: массив `segments` с полями `name`, `host`, `port`, `database`, `user`, `password` или `password_env`.
