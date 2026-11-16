# Этап 0. Каркас и инфраструктура (17.11)

Прочитай перед началом: `docs/lab/README.md`, `docs/lab/contracts.md`.

**Результат этапа:** `docker compose up -d --build` из `deploy/` поднимает PostgreSQL (три БД), RabbitMQ, Consul, MinIO и четыре заготовки (gateway + три сервиса). Все сервисы зарегистрированы в Consul и проходят health check. Бизнес-логики пока нет.

Пункты, помеченные ⚠ — уроки первой итерации: именно на этом она спотыкалась.

## Задачи

### 0.1 Git и документация (сначала)
- [ ] ⚠ `.gitattributes` в корень: `* text=auto eol=lf`, бинарные (`*.glb`, `*.png`, `*.jpg`, `*.webp`, `*.woff`, `*.woff2`, `*.ico`, `*.pdf`) — `binary`. Без этого Windows-инструменты пересохраняют файлы с CRLF (диффы «весь файл изменился», а `*.sh` с CRLF не запускается в Linux-контейнере).
- [ ] `.gitignore`: добавить `deploy/.env`, `.claude/settings.local.json`, `**/bin/`, `**/obj/` — **добавить строки, не переписывая файл**.
- [ ] Дописать решения 37–44 из `contracts.md` в `docs/decisions.md` (только новые строки).
- [ ] `docs/06-backend.md`: в начало — абзац «Минимальная версия для показа — `docs/lab/`; Redis, k6 и загрузка моделей — после». Не переписывать документ.
- [ ] `CLAUDE.md` (и `AGENTS.md` — копия): в таблицу «Где искать контекст» — строка «Лабораторная: план, контракты, этапы → `docs/lab/README.md`»; в «Структуру» — `services/`, `deploy/`.
- [ ] `docs/roadmap.md`, «Этап 9»: заменить пункты ссылками на этапы 0–4 из `docs/lab/` с чекбоксами.

### 0.2 Инфраструктура в `deploy/`
- [ ] ⚠ Версии образов: проверить командами (`docker pull`), закрепить теги, никаких `latest`. Ориентиры: postgres 16+, rabbitmq 4.x-management, consul — актуальный (dev-режим одного агента, UI), MinIO — строго `minio/minio:RELEASE.2025-04-22T22-12-26Z` (решение 42; если docker.io не отдаёт — тот же тег с `quay.io/minio/minio`).
- [ ] `docker-compose.yml`: тома для данных postgres, rabbitmq, minio; healthcheck у каждого инфраструктурного контейнера (MinIO: `curl -f http://localhost:9000/minio/health/live`, если в образе нет curl — `mc ready local`); сервисы ждут через `depends_on: condition: service_healthy`.
- [ ] ⚠ Если docker.io недоступен из среды сборки — зеркала (`mirror.gcr.io/library/...`) с комментарием в compose, почему.
- [ ] `postgres/init.sh` (LF!): три БД, три пользователя, права только на свою БД, `REVOKE ... FROM PUBLIC`; пароли из env.
- [ ] ⚠ `.env.example`: **только базовые секреты** (пароли БД, RabbitMQ, root MinIO). Строки подключения собираются в `docker-compose.yml` из этих переменных (`Password=${CATALOG_DB_PASSWORD}`, `MINIO_ACCESS_KEY: ${MINIO_ROOT_USER}`); продублированные пароли разъезжаются при смене.
- [ ] Порты наружу — только из таблицы в `contracts.md`.
- [ ] `smoke.mjs` (Node, без зависимостей, параметры `--base`, `--consul`): `GET <base>/health` → `200 {"status":"ok"}`; для каждого из `catalog`, `quiz`, `analytics` — `GET <consul>/v1/health/service/<name>?passing=true` возвращает ≥ 1 экземпляр. Ненулевой код выхода при ошибке. ⚠ Не проверять `/api/<svc>/health` — таких путей нет (`/health` у сервисов без префикса, gateway путь не переписывает).
- [ ] ⚠ `.dockerignore` в корне: `**/node_modules`, `**/dist`, `**/.angular`, `**/.git`, `**/bin`, `**/obj`, `**/__pycache__`, `**/.venv`, `**/*.log`, `deploy/.env` — контекст сборки общий на весь репозиторий.

### 0.3 Заготовки сервисов
Общее для всех: порт 8080; `GET /health` **с проверкой своей БД** (`SELECT 1`; у gateway БД нет — просто `200`); заголовок `X-Instance` (⚠ gateway его **не ставит** — контракт); регистрация в Consul по контракту (IP контейнера, `ID = name-hostname`, ретраи при старте, ⚠ повторная регистрация каждые 30 с, снятие по SIGTERM); многоэтапный Dockerfile, непривилегированный пользователь; настройки из env.
- [ ] `services/catalog` — ASP.NET Core на актуальном **LTS .NET** (⚠ на 17.11.2026 это .NET 10; .NET 8/9 вышли из поддержки 10.11.2026 — проверить `dotnet --list-sdks` / теги mcr); EF Core + Npgsql версий под эту платформу; `DbContext` пустой.
- [ ] `services/quiz` — NestJS актуального мажора + Prisma актуального мажора (⚠ проверить `npm view @nestjs/core version`, `npm view prisma version`; если новый мажор Prisma требует миграции генератора клиента — взять предыдущий стабильный и записать в отчёт), Fastify-адаптер. ⚠ `X-Instance` — через Fastify-хук `onSend` (Express-синтаксис `app.use` с Fastify не работает). ⚠ Health — через `PrismaService` + `$queryRaw\`SELECT 1\``. ⚠ `package-lock.json` обязательно закоммитить — `npm ci` в Dockerfile без него падает.
- [ ] `services/analytics` — FastAPI (Python 3.12), SQLAlchemy 2 async + asyncpg; версии проверить (`pip index versions` / PyPI); регистрация и повторная регистрация — фоновые задачи в lifespan.
- [ ] `services/gateway` — YARP: маршруты и кластеры из таблицы контракта статически в appsettings; кластеры `catalog`/`quiz`/`analytics` с `Metadata: {"Consul":"true"}` и пустыми destinations (провайдер — этап 1); `minio`, `web` — статические адреса. `/health` → `200`.

### 0.4 Клиент в контейнере
- [ ] `projects/app/Dockerfile`: сборка `ng build --configuration production` → nginx. ⚠ Node-образ ≥ 22.12 (требование Angular CLI; 22.9 не хватало). Контекст сборки — корень репозитория.
- [ ] `projects/app/nginx.conf`: SPA (`try_files $uri $uri/ /index.html`), gzip, длинный кэш для статики.
- [ ] Сервис `web` в compose: без внешних портов, без `depends_on`.

## Проверка

Выполнить на запущенном стеке; в «Отчёт» — результат каждого пункта (команда → что увидели).

1. `cd deploy && cp .env.example .env && docker compose up -d --build` — все контейнеры `running` / `healthy`; `node smoke.mjs` — все проверки зелёные.
2. Consul UI (`http://localhost:8500`): `catalog`, `quiz`, `analytics` (и `gateway`) зелёные.
3. `docker compose up -d --scale quiz=2` → два экземпляра `quiz` с разными ID и IP; `docker stop` одного → он уходит в `critical` и из `?passing=true`.
4. `docker compose restart consul` → в течение ~35 с все сервисы снова зарегистрированы (повторная регистрация).
5. `docker compose exec postgres psql -U catalog -d quiz_db` → отказ в доступе.
6. RabbitMQ UI (`:15672`) и консоль MinIO (`:9001`) открываются.
7. `npm run lint`, `npm test`, `npm run test:core` клиента проходят.
8. `git status` — нет случайных массовых диффов из-за переводов строк; коммиты по задачам сделаны, **`git push`** выполнен.

## Отчёт
(заполняет Claude Code по завершении)
