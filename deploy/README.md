# Запуск стенда лабораторной

Весь бэкенд и собранный клиент поднимаются одной командой через Docker Compose. Архитектура и описание компонентов — `docs/lab/architecture.md`, сценарий показа — `docs/lab/demo.md`.

## Требования

- Docker Desktop (Windows / macOS) или Docker Engine + Compose v2 (Linux). Свободно ~4 ГБ RAM и ~5 ГБ диска под образы.
- Node.js 18+ — только для `smoke.mjs` и dev-сервера клиента.
- Свободные порты: 8080, 8500, 15672, 9001, 5432.

## Запуск

```
cd deploy
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
docker compose up -d --build
node smoke.mjs              # сквозная проверка, код выхода 0 — всё работает
```

Первая сборка занимает 5–10 минут (образы .NET, Node, Python, Angular). После `up` сервисам нужно ещё ~20–40 с: применить миграции, засеять БД, загрузить модели в MinIO и стать `passing` в Consul. Пока сервис не готов, gateway отвечает `503` с JSON.

Пересоздать с нуля (удаляет все данные, seed выполнится снова):

```
docker compose down -v
docker compose up -d --build
```

## Адреса и учётные данные

Значения — из `.env.example`. Если меняли `.env`, смотрите там.

| Компонент | Адрес | Логин | Пароль |
|---|---|---|---|
| Приложение (через gateway) | http://localhost:8080 | — (анонимно) | — |
| Consul UI | http://localhost:8500/ui | — (dev-режим без ACL) | — |
| RabbitMQ Management | http://localhost:15672 | `atlas` (`RABBITMQ_USER`) | `change-me-rabbit` (`RABBITMQ_PASSWORD`) |
| MinIO Console | http://localhost:9001 | `atlas-minio` (`MINIO_ROOT_USER`) | `change-me-minio-secret` (`MINIO_ROOT_PASSWORD`) |
| PostgreSQL (суперпользователь) | `localhost:5432` | `postgres` | `change-me-postgres` (`POSTGRES_PASSWORD`) |
| PostgreSQL, БД `catalog_db` | `localhost:5432` | `catalog` | `change-me-catalog` (`CATALOG_DB_PASSWORD`) |
| PostgreSQL, БД `quiz_db` | `localhost:5432` | `quiz` | `change-me-quiz` (`QUIZ_DB_PASSWORD`) |
| PostgreSQL, БД `analytics_db` | `localhost:5432` | `analytics` | `change-me-analytics` (`ANALYTICS_DB_PASSWORD`) |

Каждый пользователь БД имеет доступ только к своей базе (`deploy/postgres/init.sh`). Подключиться из консоли без клиента на хосте:

```
docker compose exec postgres psql -U postgres -d quiz_db
```

Пароль RabbitMQ не должен содержать `@`, `/`, `:` — он подставляется в AMQP-URL без кодирования.

## API через gateway

| Префикс | Сервис |
|---|---|
| `/api/catalog/**` | Catalog (C#) — манифесты сцен и тексты сущностей |
| `/api/quiz/**` | Quiz (NestJS) — тесты и попытки |
| `/api/analytics/**` | Analytics (FastAPI) — статистика |
| `/models/**` | MinIO, бакет `models` (`.glb`) |
| `/**` | `web` — собранный Angular под nginx |

Каждый ответ сервиса несёт `X-Instance` (имя контейнера экземпляра), gateway добавляет `X-Gateway-Instance`. Полный контракт — `docs/lab/contracts.md`.

## Полезные команды

```
docker compose ps                              # состояние контейнеров
docker compose logs -f quiz                    # логи сервиса
docker compose up -d --scale quiz=3            # три экземпляра Quiz
docker compose stop analytics                  # остановить сервис (start — запустить)
node smoke.mjs                                 # сквозная проверка
```

`smoke.mjs` сам проходит тест (две попытки) — после него в аналитике появляются ответы.

## Клиент в режиме разработки

При запущенном compose из корня репозитория:

```
npm start              # http://localhost:4200, /api и /models проксируются на gateway :8080
npm run start:assets   # без бэкенда: манифесты, контент и модели из projects/app/public
```

## Частые проблемы

| Симптом | Причина и что делать |
|---|---|
| `/api/...` отвечает `503 {"error":"service_unavailable"}` сразу после старта | Сервис ещё не `passing` в Consul (миграции, seed). Подождать 20–40 с, проверить в Consul UI |
| Catalog `critical` в Consul, в логе `MinIO model sync failed` | MinIO недоступен; синхронизация повторяется каждые 10 с, после восстановления MinIO Catalog станет `passing` сам |
| `docker compose up --build` завершается ошибкой `rename …compose-build-metadataFile-….json: The process cannot access the file because it is being used by another process` (Windows) | Образы уже собраны, но контейнеры не пересозданы — временный файл держит антивирус или индексатор. Выполнить `docker compose up -d` (без `--build`): контейнеры пересоздадутся на новых образах |
| Порт занят (`bind: address already in use`) | Освободить порт или поменять левую часть маппинга в `docker-compose.yml` |
| Сборка analytics падает на `pip install` | Нестабильный доступ к PyPI; повторить `docker compose build analytics` (в Dockerfile уже есть ретраи) |
| Изменили тексты вопросов в `services/quiz/prisma/seed/quizzes.json`, а в тестах старые | Seed Quiz загружается только в пустую БД: `docker compose down -v` и `up` (или очистить `quiz_db`) |
| Тест показывает «Описание сейчас недоступно» | Catalog недоступен — Quiz деградирует штатно; после старта Catalog карточки вернутся (кэш сущностей 60 с) |
| В логе Catalog `libgssapi_krb5.so.2` и `fail … __EFMigrationsHistory` при первом старте | Безвредный шум Npgsql/EF Core |
