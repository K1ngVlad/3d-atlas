# Контракты: API, события, БД, инфраструктура

Единственный источник истины для стыков между сервисами. Меняется **до** кода (правило 2 в `docs/lab/README.md`). OpenAPI отдельно не пишем: каждый сервис публикует свой автоматически (ASP.NET OpenAPI, `@nestjs/swagger`, FastAPI `/docs`) и должен совпадать с этим документом.

## Общие соглашения

- Все сервисы слушают порт **8080** внутри контейнера, наружу не публикуются (кроме gateway).
- Префикс пути у каждого сервиса свой и совпадает с маршрутом gateway: `/api/catalog/…`, `/api/quiz/…`, `/api/analytics/…`. Gateway путь не переписывает.
- `GET /health` у каждого сервиса (без префикса): `200 {"status":"ok"}`, если доступны его зависимости (БД; у Quiz — ещё брокер с этапа 3; у Catalog — ещё синхронизация моделей с MinIO, см. этап 1), иначе `503`. Этот же адрес — HTTP-проверка Consul.
- Каждый ответ сервиса несёт заголовок **`X-Instance: <hostname>`** — для демонстрации балансировки. Gateway этот заголовок **не ставит и не перезаписывает** (иначе он смешается с заголовком сервиса при проксировании); свой экземпляр gateway, если нужно, сообщает в `X-Gateway-Instance`.
- JSON в `camelCase`. Ошибки: `{"error": "<code>", "message": "<текст>"}`, коды HTTP по смыслу (400, 404, 409, 503).
- Идентификаторы каталога — строковые slug'и (как сейчас в файлах: `mitochondrion`, `animal-cell`). Идентификаторы Quiz и Analytics — UUID, кроме `quiz.id` (slug).

## Consul

- Адрес агента: env `CONSUL_HTTP_ADDR=http://consul:8500`.
- Регистрация при старте через HTTP API агента (`PUT /v1/agent/service/register`), снятие при остановке (`PUT /v1/agent/service/deregister/{id}`, по SIGTERM). Consul недоступен при старте → ретраи с паузой, не падать.
- Поля: `Name` = `catalog` | `quiz` | `analytics`; `ID` = `<name>-<hostname>`; `Address` = **IP контейнера** (не hostname: при `--scale` имена неразрешимы между контейнерами); `Port` = 8080; `Check`: `HTTP http://<ip>:8080/health`, `Interval 5s`, `Timeout 2s`, `DeregisterCriticalServiceAfter 1m`.
- **Повторная регистрация каждые 30 с** (`PUT register` идемпотентен): Consul в dev-режиме ничего не хранит, и после его перезапуска сервисы иначе пропадут навсегда.
- Gateway тоже регистрируется (имя `gateway`) — только для наглядности в UI Consul; маршрутизация от этого не зависит.
- Поиск адресов: `GET /v1/health/service/{name}?passing=true` → список `Service.Address:Service.Port`. Клиенты (gateway, Quiz) держат список не дольше **5 с** и выбирают экземпляр по кругу.
- Регистрация — общий небольшой модуль в каждом сервисе (без сторонних клиентов Consul, если они не поддерживаются: HTTP API достаточно).

## API Gateway (YARP)

| Маршрут | Кластер | Адреса |
|---|---|---|
| `/api/catalog/{**}` | `catalog` | из Consul |
| `/api/quiz/{**}` | `quiz` | из Consul |
| `/api/analytics/{**}` | `analytics` | из Consul |
| `/models/{**}` | `minio` | статически `http://minio:9000` (путь `/models/...` = бакет `models`) |
| `/{**}` (низший приоритет) | `web` | статически `http://web:80` |

- Конфигурация маршрутов статическая (appsettings); у кластеров с метаданными `"Consul": "true"` адреса подставляет свой `IProxyConfigProvider`: фоновая служба опрашивает Consul (первый раз — **сразу при старте**, дальше раз в 5 с) и при изменении набора адресов публикует новую конфигурацию. Балансировка `RoundRobin`. Consul недоступен → держать последний известный набор адресов и писать предупреждение.
- Нет живых экземпляров → `503` с телом-ошибкой.
- Наружу: `8080`.

## Catalog Service (C#, ASP.NET Core, EF Core + Npgsql) — `catalog_db`

### API

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/catalog/manifests/{id}` | тело манифеста — тот же JSON, что `projects/app/public/manifests/<id>.json`, **по содержимому** (колонка `jsonb` не сохраняет порядок ключей объектов и пробелы; порядок элементов массивов, в т. ч. `parts`, сохраняется — этого достаточно); `404`, если нет |
| GET | `/api/catalog/manifests` | `[{ id, entity, status, title }]` (`title` — из сущности) |
| GET | `/api/catalog/entities/{id}` | `EntityContent` — формат `projects/app/public/content/entities/<id>.json`: `{ id, kind, title:{ru}, summary:{ru}, sources:[{title,url}] }`; `404`, если нет |
| GET | `/api/catalog/entities?ids=a,b,c` | `EntityContent[]` (отсутствующие пропускаются); без `ids` — все |
| PUT | `/api/catalog/entities/{id}` | **необязательно (этап 3)**: тело `{ title:{ru}, summary:{ru} }` → `200 EntityContent`, публикует `AtlasContentUpdated` |

Валидация манифеста остаётся на клиенте (zod в `viewer-core`). Catalog хранит и отдаёт манифест без изменений.

### Таблицы (5)

```
entities        id text PK, kind text, title_ru text, summary_ru text, updated_at timestamptz
entity_sources  id serial PK, entity_id → entities, title text, url text, position int
models          id text PK (напр. "animal-cell/v1"), object_key text UNIQUE ("animal-cell/v1/cell.glb"),
                size_bytes bigint, content_type text,
                source_author text, source_url text, source_platform text, license text, modified bool
scene_manifests id text PK, entity_id → entities, model_id → models, status text ('ready'|'stub'),
                schema_version int, body jsonb, updated_at timestamptz
scene_parts     manifest_id → scene_manifests, part_id text, entity_id → entities,
                detail_manifest_id text NULL (без FK: detail может указывать на несуществующий манифест — так задумано),
                detail_focus text NULL, PK (manifest_id, part_id)
```

`models.source_*` заполняется из `manifest.source`; если у нескольких манифестов одна модель (заглушки) — берётся первый с `source`.

### Начальные данные (seed)

При старте читать смонтированную `projects/app/public` (`/seed`, только чтение):

1. **БД** (только если `entities` пуста; весь seed БД — под advisory-блокировкой `pg_advisory_xact_lock`, проверка «уже заполнено» — после захвата: при `--scale catalog=2` на пустой БД иначе оба экземпляра сеют одновременно и падают на PK):
   - `content/entities/*.json` → `entities`, `entity_sources`;
   - `manifests/*.json` → `models` (по `model.url`, без префикса `models/`), `scene_manifests` (`body` целиком), `scene_parts` (`detail` бывает строкой или `{id, focus}`). Сущность части без файла контента → создать сущность-заглушку (`title_ru = id`) и предупреждение в лог; счётчик заглушек в итоговом логе — фактический.
   - Всё в одной транзакции; повторный старт ничего не меняет.
2. **MinIO — отдельный шаг при каждом старте** (не внутри проверки «БД уже заполнена»): создать бакет `models`, если нет; выставить политику анонимного чтения (`s3:GetObject` на `models/*`) через S3 API; загрузить `models/**/*.glb` (ключ = путь относительно `models/`), существующие пропускать. Ошибки — ретраи; не удалось после ретраев → `LogError`, и `/health` отдаёт `503`, пока синхронизация не прошла. Иначе при недоступном на первом старте MinIO модели не попали бы туда никогда, и атлас молча ломался бы.

## Quiz Service (TypeScript, NestJS + Prisma) — `quiz_db`

Поведение экрана — `docs/lab/quiz-ux.md`.

### API

| Метод | Путь | Тело / ответ |
|---|---|---|
| GET | `/api/quiz/quizzes` | `[{ id, title, description, manifestId, questionCount }]` |
| GET | `/api/quiz/quizzes/{id}` | `{ id, title, description, manifestId, questions:[{ id, order, type, text, manifestId, partId, options:[{ id, text }] }] }` — **без** признака правильного ответа. `type`: `"single"` \| `"multiple"`. `manifestId` / `partId` вопроса могут быть `null` (обычный вопрос) |
| POST | `/api/quiz/attempts` | `{ quizId, clientId }` → `201 { attemptId, startedAt }` |
| POST | `/api/quiz/attempts/{attemptId}/answers` | `{ questionId, optionIds: uuid[] }` (пустой массив = «Не знаю»; для `single` — не больше одного) → `{ correct, correctOptionIds, entity: { id, title, summary } \| null }`. Повторный ответ на тот же вопрос → `409`; попытка завершена → `409`; вариант не из этого вопроса или >1 варианта у `single` → `400` |
| POST | `/api/quiz/attempts/{attemptId}/complete` | → `{ score, total, completedAt }`; повторно → тот же результат (идемпотентно, событие не дублируется) |
| GET | `/api/quiz/attempts/{attemptId}` | `{ attemptId, quizId, startedAt, completedAt, score, total, answers:[{ questionId, optionIds, correct, correctOptionIds }] }` |

Запросы к попытке (`POST …/answers`, `POST …/complete`, `GET /attempts/{id}`) несут заголовок **`X-Client-Id`**; не совпадает с `client_id` попытки или отсутствует → `404`. Смысл — `docs/lab/quiz-ux.md`, «Идентификация пользователя».

Коды `error` в теле ошибок Quiz (клиент различает по ним два случая `409`): `already_answered` (`409`, на вопрос уже ответили), `attempt_completed` (`409`, попытка завершена), `invalid_option` / `invalid_question` / `bad_request` (`400`), `not_found` (`404`). В `entity` ответа `title` и `summary` — строки (русский текст из `title.ru` / `summary.ru` сущности каталога). Варианты в `GET quiz` идут в порядке показа; верный вариант не всегда первый.

Ответ верен: `single` — выбран единственный верный вариант; `multiple` — множество выбранных **в точности** равно множеству верных. Пустой ответ — неверно. `score` — число верных ответов, `total` — число вопросов теста (неотвеченные — неверные).

`partId` в ответе `GET quiz` формально подсказывает ответ — для учебного стенда это принято.

**Прямая связь с Catalog:** в ответе на `answers` поле `entity` заполняется из `GET /api/catalog/entities?ids=<entityId вопроса>`; адрес Catalog — из Consul. Таймаут 2 с; Catalog недоступен → `entity: null`, ответ проверяется как обычно (поведение для демонстрации отказа). Кэш сущностей в памяти экземпляра, TTL 60 с (не Redis).

### Таблицы (6)

```
quizzes                 id text PK (slug), title text, description text, manifest_id text, created_at timestamptz
questions               id uuid PK, quiz_id → quizzes, position int, type text ('single'|'multiple'), text text,
                        entity_id text (id сущности каталога, без FK — другая БД), manifest_id text NULL, part_id text NULL
answer_options          id uuid PK, question_id → questions, position int, text text, is_correct bool
attempts                id uuid PK, quiz_id → quizzes, client_id uuid, participant_name text NULL (не используется клиентом),
                        started_at timestamptz, completed_at timestamptz NULL, score int NULL, total int
attempt_answers         id uuid PK, attempt_id → attempts, question_id → questions, is_correct bool, answered_at timestamptz,
                        UNIQUE (attempt_id, question_id)
attempt_answer_options  attempt_answer_id → attempt_answers, option_id → answer_options, PK (attempt_answer_id, option_id)
```

Проверки seed: у `single` ровно один верный вариант, у `multiple` — не меньше двух верных и хотя бы один неверный; `part_id` задан только вместе с `manifest_id` и существует в этом манифесте (достаточно проверки по файлам `projects/app/public/manifests` в тесте seed); `manifest_id` вопросов — только манифесты со `status: "ready"`.

### Начальные данные

`services/quiz/prisma/seed/quizzes.json`, загрузка при старте, если `quizzes` пуста. Два теста, по 8–10 вопросов с 3–5 вариантами:
- «Органоиды животной клетки» (`manifestId: "animal-cell"`): вопросы по модели клетки;
- «Строение органоидов» (`manifestId: "animal-cell"`): вопросы по детальным моделям — `mitochondrion`, `golgi`, `endoplasmic-reticulum` (у каждого вопроса свой `manifestId`), минимум по 2 на митохондрию и Гольджи.

В каждом тесте: ≥ 3 вопросов «Что выделено на модели?» (варианты — названия частей), ≥ 2 вопросов `multiple`, остальные — обычные `single`. В вопросах — только манифесты со `status: "ready"` (заглушка `nucleus` не подходит). `entity_id` — только существующие сущности. Тексты — черновик по `summary` сущностей; **автор проверит** их перед показом.

## RabbitMQ: события

- Exchange **`quiz.events`**, тип `topic`, durable. Публикует Quiz **после коммита** транзакции (outbox — потом).
- Ключи маршрутизации: `quiz.answer.submitted`, `quiz.test.completed`.
- Сообщения: persistent, `content_type: application/json`, `message_id = eventId`.
- Конверт:

```json
{ "eventId": "uuid", "type": "AnswerSubmitted", "version": 1,
  "occurredAt": "2026-11-20T10:00:00Z", "source": "quiz", "payload": { … } }
```

| `type` | `payload` |
|---|---|
| `AnswerSubmitted` | `attemptId, quizId, questionId, questionType, entityId, optionIds, correct, clientId, answeredAt` |
| `TestCompleted` | `attemptId, quizId, clientId, score, total, startedAt, completedAt, durationMs` |

- Analytics объявляет: очередь **`analytics.quiz-events`** (durable, привязка `quiz.#`, аргумент `x-dead-letter-exchange: analytics.dlx`), exchange `analytics.dlx` (fanout) и очередь **`analytics.quiz-events.dlq`**. Quiz объявляет только `quiz.events`. Объявления идемпотентны, порядок старта не важен.
- Обработка в Analytics: ручной `ack`, `prefetch 10`. Невалидное сообщение (не JSON, неизвестный `type`, нет полей) → `nack(requeue=false)` → DLQ. Ошибка БД → `nack(requeue=true)`.
- **Идемпотентность:** `eventId` — первичный ключ сырого события; повтор не меняет агрегаты.

### Необязательно (этап 3): `AtlasContentUpdated`

Exchange `catalog.events` (topic), ключ `catalog.content.updated`, payload `{ entityIds: string[] }`. Каждый экземпляр Quiz создаёт **свою** эксклюзивную автоудаляемую очередь (чтобы событие получили все экземпляры) и сбрасывает кэш сущностей.

## Analytics Service (Python, FastAPI + SQLAlchemy, aio-pika) — `analytics_db`

### API

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/analytics/summary` | `{ attemptsCompleted, avgScorePct, answersTotal, correctRatePct, lastEventAt }` |
| GET | `/api/analytics/entities` | `[{ entityId, answersTotal, correctRatePct }]` по возрастанию `correctRatePct` (самые трудные сверху) |
| GET | `/api/analytics/questions?quizId=` | `[{ questionId, quizId, entityId, answersTotal, correctRatePct }]` |

Названия сущностей клиент берёт из Catalog сам (Analytics в Catalog не ходит).

### Таблицы (3)

```
answer_events   event_id uuid PK, attempt_id uuid, quiz_id text, question_id uuid, entity_id text,
                correct bool, client_id uuid, occurred_at timestamptz, payload jsonb
test_results    attempt_id uuid PK, event_id uuid UNIQUE, quiz_id text, client_id uuid,
                score int, total int, duration_ms int, completed_at timestamptz
question_stats  question_id uuid PK, quiz_id text, entity_id text, answers_total int, answers_correct int, updated_at timestamptz
```

`question_stats` обновляется в той же транзакции, что вставка в `answer_events`, и только если вставка произошла (`INSERT … ON CONFLICT DO NOTHING RETURNING`). Статистика по сущностям — запрос `GROUP BY entity_id` по `answer_events`.

## PostgreSQL

Один контейнер; `deploy/postgres/init.sh` создаёт БД `catalog_db`, `quiz_db`, `analytics_db` и пользователей `catalog`, `quiz`, `analytics`, у каждого права только на свою БД. Пароли — из `deploy/.env`. Миграции: EF Core (Catalog, применяются при старте), `prisma migrate deploy` (Quiz, в entrypoint), Alembic или `create_all` (Analytics — допустимо `create_all` для минимальной версии).

## Порты наружу (docker compose)

| Сервис | Порт | Зачем |
|---|---|---|
| gateway | 8080 | приложение и API |
| consul | 8500 | UI для демонстрации |
| rabbitmq | 15672 | UI управления |
| minio | 9001 | консоль |
| postgres | 5432 | отладка |

## Клиент (Angular)

- `environments`: `{ dataSource: 'api' | 'assets', apiBase: '' }`; `api` по умолчанию и в docker-сборке, `assets` — запасная конфигурация без бэкенда (`fileReplacements`).
- `HttpStructureRepository implements StructureRepository`: `getManifest` → `GET /api/catalog/manifests/{id}` + `parseManifest`; `getEntity` → `GET /api/catalog/entities/{id}` (`404` → `null`); `manifestExists` → через кэш `getManifest`. Кэш промисов как в `AssetsStructureRepository`. Подмена провайдера в `app.config.ts` по `dataSource`; `provideHttpClient(withFetch())`.
- `projects/app/proxy.conf.json` для `ng serve`: `/api` и `/models` → `http://localhost:8080`.
- `QUIZ_REPO` и `ANALYTICS_REPO` — интерфейсы за `InjectionToken`, реализации на `HttpClient` (правило 3 `CLAUDE.md`).
- Экран тестов и требования к `QuizRunStore` / `AtlasStore` — `docs/lab/quiz-ux.md`, «Технические требования к клиенту».
- `clientId`: UUID в `localStorage` (`atlas.clientId`), чтение и запись в `try/catch`, при ошибке — UUID на сеанс.

## Решения (дописать в `docs/decisions.md`, этап 0)

| # | Решение | Почему |
|---|---|---|
| 37 | Минимальная версия лабораторной — без Redis, k6 и пользователей; пользователь анонимен (`clientId` в `localStorage`) | Жёсткий срок; ТЗ этого не требует. Redis и k6 — потом, по плану `06-backend.md` |
| 38 | Брокер — RabbitMQ, а не Kafka | Проще в запуске; DLQ и накопление очереди при отказе потребителя — готовая демонстрация |
| 39 | Quiz ищет Catalog через Consul, а не по фиксированному адресу | Прямая связь сервисов тоже идёт через Service Discovery; работает при `--scale catalog` |
| 40 | Один origin: gateway отдаёт `/api`, `/models` (MinIO) и SPA | `model.url` в манифестах не меняется, CORS не нужен |
| 41 | Catalog хранит манифест целиком (`jsonb`) + нормализованные части; валидация — на клиенте | Формат манифеста — уже контракт (`05-manifest.md`); части в таблице нужны для запросов и связей с сущностями |
| 42 | MinIO: образ `minio/minio` закреплён на `RELEASE.2025-04-22T22-12-26Z` — последней версии с полной веб-консолью | Начиная с мая 2025 г. консоль урезана; этот тег удобен на показе. Проект архивирован в 2026 г., новых образов нет; замена без изменений кода — `pgsty/minio`, Garage, SeaweedFS |
| 43 | События публикуются после коммита, без outbox; идемпотентность — по `eventId` в Analytics | Минимальная версия; риск потери события при падении между коммитом и публикацией принят, outbox — потом |
| 44 | Сервисы регистрируют в Consul IP контейнера, `ID = name-hostname`, повторная регистрация каждые 30 с; ответы несут `X-Instance` (gateway свой не ставит) | Корректная работа `docker compose --scale`; переживает перезапуск dev-Consul; видно балансировку на защите |
