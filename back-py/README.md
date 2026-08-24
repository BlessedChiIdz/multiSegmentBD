# multiSegmentBD (Python)

HTTP API для выполнения SQL-запросов по нескольким сегментам PostgreSQL.

## Зависимости

- `flask`
- `sqlalchemy`
- `psycopg2` или `psycopg2-binary` (драйвер PostgreSQL; в банке обычно уже есть в контуре)

## Локальный запуск

### 1. PostgreSQL

Нужны базы на портах из `segments.json` (5432, 5433, 5434). Если есть Docker:

```powershell
# из корня репозитория, если есть docker-compose
docker compose up -d
```

Или один локальный PostgreSQL — временно оставьте в `segments.json` один сегмент.

### 2. Python-окружение

```powershell
cd back-py
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install psycopg2-binary
```

### 3. Запуск API

```powershell
python main.py --config segments.json --host 127.0.0.1 --port 8080
```

Проверка:

```powershell
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/api/status
```

### 4. Фронтенд (опционально)

```powershell
cd ..\front
npm install
npm start
```

UI по умолчанию ходит на `http://127.0.0.1:8080`.

## Параметры CLI

| Флаг | По умолчанию | Описание |
|------|--------------|----------|
| `-c` / `--config` | `segments.json` | Путь к конфигу сегментов |
| `--connect-timeout-secs` | `30` | Таймаут подключения и запроса |
| `--max-concurrent-segments` | `10` | Параллельных подключений |
| `--host` | `127.0.0.1` | Адрес HTTP-сервера |
| `-p` / `--port` | `8080` | Порт HTTP-сервера |
