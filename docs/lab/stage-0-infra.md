# Этап 0. Каркас и инфраструктура (17.11)

Прочитай перед началом: `docs/lab/README.md`, `docs/lab/contracts.md`.

**Результат этапа:** `docker compose up -d --build` из `deploy/` поднимает PostgreSQL (три БД), RabbitMQ, Consul, MinIO и четыре заготовки (gateway + три сервиса). Все сервисы зарегистрированы в Consul и проходят health check. Бизнес-логики пока нет.

Пункты, помеченные ⚠ — уроки первой итерации: именно на этом она спотыкалась.

## Задачи

### 0.1 Git и документация (сначала)
- [x] ⚠ `.gitattributes` в корень: `* text=auto eol=lf`, бинарные (`*.glb`, `*.png`, `*.jpg`, `*.webp`, `*.woff`, `*.woff2`, `*.ico`, `*.pdf`) — `binary`. Без этого Windows-инструменты пересохраняют файлы с CRLF (диффы «весь файл изменился», а `*.sh` с CRLF не запускается в Linux-контейнере).
- [x] `.gitignore`: добавить `deploy/.env`, `.claude/settings.local.json`, `**/bin/`, `**/obj/` — **добавить строки, не переписывая файл**.
- [x] Дописать решения 37–44 из `contracts.md` в `docs/decisions.md` (только новые строки).
- [x] `docs/06-backend.md`: в начало — абзац «Минимальная версия для показа — `docs/lab/`; Redis, k6 и загрузка моделей — после». Не переписывать документ.
- [x] `CLAUDE.md` (и `AGENTS.md` — копия): в таблицу «Где искать контекст» — строка «Лабораторная: план, контракты, этапы → `docs/lab/README.md`»; в «Структуру» — `services/`, `deploy/`.
- [x] `docs/roadmap.md`, «Этап 9»: заменить пункты ссылками на этапы 0–4 из `docs/lab/` с чекбоксами.

### 0.2 Инфраструктура в `deploy/`
- [x] ⚠ Версии образов: проверить командами (`docker pull`), закрепить теги, никаких `latest`. Ориентиры: postgres 16+, rabbitmq 4.x-management, consul — актуальный (dev-режим одного агента, UI), MinIO — строго `minio/minio:RELEASE.2025-04-22T22-12-26Z` (решение 42; если docker.io не отдаёт — тот же тег с `quay.io/minio/minio`).
- [x] `docker-compose.yml`: тома для данных postgres, rabbitmq, minio; healthcheck у каждого инфраструктурного контейнера (MinIO: `curl -f http://localhost:9000/minio/health/live`, если в образе нет curl — `mc ready local`); сервисы ждут через `depends_on: condition: service_healthy`.
- [x] ⚠ Если docker.io недоступен из среды сборки — зеркала (`mirror.gcr.io/library/...`) с комментарием в compose, почему.
- [x] `postgres/init.sh` (LF!): три БД, три пользователя, права только на свою БД, `REVOKE ... FROM PUBLIC`; пароли из env.
- [x] ⚠ `.env.example`: **только базовые секреты** (пароли БД, RabbitMQ, root MinIO). Строки подключения собираются в `docker-compose.yml` из этих переменных (`Password=${CATALOG_DB_PASSWORD}`, `MINIO_ACCESS_KEY: ${MINIO_ROOT_USER}`); продублированные пароли разъезжаются при смене.
- [x] Порты наружу — только из таблицы в `contracts.md`.
- [x] `smoke.mjs` (Node, без зависимостей, параметры `--base`, `--consul`): `GET <base>/health` → `200 {"status":"ok"}`; для каждого из `catalog`, `quiz`, `analytics` — `GET <consul>/v1/health/service/<name>?passing=true` возвращает ≥ 1 экземпляр. Ненулевой код выхода при ошибке. ⚠ Не проверять `/api/<svc>/health` — таких путей нет (`/health` у сервисов без префикса, gateway путь не переписывает).
- [x] ⚠ `.dockerignore` в корне: `**/node_modules`, `**/dist`, `**/.angular`, `**/.git`, `**/bin`, `**/obj`, `**/__pycache__`, `**/.venv`, `**/*.log`, `deploy/.env` — контекст сборки общий на весь репозиторий.

### 0.3 Заготовки сервисов
Общее для всех: порт 8080; `GET /health` **с проверкой своей БД** (`SELECT 1`; у gateway БД нет — просто `200`); заголовок `X-Instance` (⚠ gateway его **не ставит** — контракт); регистрация в Consul по контракту (IP контейнера, `ID = name-hostname`, ретраи при старте, ⚠ повторная регистрация каждые 30 с, снятие по SIGTERM); многоэтапный Dockerfile, непривилегированный пользователь; настройки из env.
- [x] `services/catalog` — ASP.NET Core на актуальном **LTS .NET** (⚠ на 17.11.2026 это .NET 10; .NET 8/9 вышли из поддержки 10.11.2026 — проверить `dotnet --list-sdks` / теги mcr); EF Core + Npgsql версий под эту платформу; `DbContext` пустой.
- [x] `services/quiz` — NestJS актуального мажора + Prisma актуального мажора (⚠ проверить `npm view @nestjs/core version`, `npm view prisma version`; если новый мажор Prisma требует миграции генератора клиента — взять предыдущий стабильный и записать в отчёт), Fastify-адаптер. ⚠ `X-Instance` — через Fastify-хук `onSend` (Express-синтаксис `app.use` с Fastify не работает). ⚠ Health — через `PrismaService` + `$queryRaw\`SELECT 1\``. ⚠ `package-lock.json` обязательно закоммитить — `npm ci` в Dockerfile без него падает.
- [x] `services/analytics` — FastAPI (Python 3.12), SQLAlchemy 2 async + asyncpg; версии проверить (`pip index versions` / PyPI); регистрация и повторная регистрация — фоновые задачи в lifespan.
- [x] `services/gateway` — YARP: маршруты и кластеры из таблицы контракта статически в appsettings; кластеры `catalog`/`quiz`/`analytics` с `Metadata: {"Consul":"true"}` и пустыми destinations (провайдер — этап 1); `minio`, `web` — статические адреса. `/health` → `200`.

### 0.4 Клиент в контейнере
- [x] `projects/app/Dockerfile`: сборка `ng build --configuration production` → nginx. ⚠ Node-образ ≥ 22.12 (требование Angular CLI; 22.9 не хватало). Контекст сборки — корень репозитория.
- [x] `projects/app/nginx.conf`: SPA (`try_files $uri $uri/ /index.html`), gzip, длинный кэш для статики.
- [x] Сервис `web` в compose: без внешних портов, без `depends_on`.

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

Ветка `lab-backend`, коммиты по задачам, `git push` — в конце.

### Результаты проверки
1. `cd deploy && cp .env.example .env && docker compose up -d --build` → все 9 контейнеров `Up`; postgres, rabbitmq, consul, minio — `healthy`. `node smoke.mjs` → `OK GET http://localhost:8080/health -> 200 {"status":"ok"}`, `OK consul catalog/quiz/analytics: 1 passing instance(s)`, код выхода 0.
2. Consul UI: `curl localhost:8500/v1/internal/ui/services` → `analytics`, `catalog`, `gateway`, `quiz` без critical-проверок; `/ui/` отвечает 200 (визуально в браузере не открывал).
3. `docker compose up -d --scale quiz=2` → `quiz-9a7249bf5dec 172.20.0.11` и `quiz-bb23a90dd4b6 172.20.0.8`, оба в `?passing=true`. `docker kill atlas-quiz-2` → через ~12 с `quiz-9a7249bf5dec critical` в `/v1/health/state/critical`, в `?passing=true` остался только `quiz-bb23a90dd4b6`. (Контейнер убит `kill`, а не `stop`, поэтому снятие по SIGTERM здесь не проверялось.)
4. `docker compose restart consul` → после перезапуска Consul пуст; через ~38 с `node smoke.mjs` снова зелёный (повторная регистрация каждые 30 с).
5. `docker compose exec postgres psql -U catalog -d quiz_db` → `FATAL: permission denied for database "quiz_db". User does not have CONNECT privilege.`
6. `curl localhost:15672` → 200, `curl localhost:9001` → 200 (проверено HTTP-запросами, не глазами).
7. `npm run lint` → «All files pass linting»; `npm run test:core` → 11 файлов, 80 тестов passed; `npm test -- --watch=false` → 2 файла, 2 теста passed.
8. `git status` чист, массовых диффов от переводов строк нет (индекс LF, `.gitattributes` добавлен первым коммитом). Push — см. ниже.

### Отклонения от плана
- **MinIO**: `minio/minio:RELEASE.2025-04-22T22-12-26Z` недоступен (репозиторий удалён с docker.io, quay.io отвечает 401). По согласованию с автором взят `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` (решение 45). Healthcheck `curl -f http://localhost:9000/minio/health/live` работает.
- **Prisma**: `prisma@latest` — это `8.0.0-rc.34` (пререлиз), взят стабильный `7.10.1` (`@prisma/client`, `@prisma/adapter-pg` той же версии; в Prisma 7 нужны driver adapter и `prisma.config.ts`). NestJS 12.5.1 + Fastify.
- **TypeScript 5.9.3 и `tsc` вместо `@nestjs/cli`**: `typescript@latest` — 7.x (нативный порт), совместимость с декораторами/Nest CLI не проверял; сборка простым `tsc`.
- Версии образов: postgres `18.7-alpine` (данные в `/var/lib/postgresql`, как требует PG 18), rabbitmq `4.4.0-management-alpine`, consul `1.22.7`, nginx `1.31.8-alpine`; .NET 10 (sdk/aspnet `10.0`), node `22-alpine`, python `3.12-slim`.
- В Dockerfile analytics для `pip` добавлены `--retries 10 --timeout 60`: сборка из BuildKit дважды падала на нестабильном доступе к PyPI; повтор прошёл.
- Gateway дополнительно ставит `X-Gateway-Instance` (разрешено контрактом); `X-Instance` не трогает.
- Контейнер `web` пока содержит и `.glb` из `public` (в этапе 1 модели идут из MinIO).
- По ходу проверки случайно выполнил `docker compose rm -sf` (удалил контейнеры, тома целы) и поднял стек заново — на результаты не повлияло.

### Осталось
Бизнес-логика — этап 1. Пароли в `deploy/.env` — примерные из `.env.example`.
