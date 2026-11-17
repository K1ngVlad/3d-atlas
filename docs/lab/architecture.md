# Архитектура стенда лабораторной

Документ описывает то, что работает в ветке `lab-backend` (состояние на 17.11.2026). Контракты API и событий — `docs/lab/contracts.md`, запуск и учётные данные — `deploy/README.md`, сценарий показа — `docs/lab/demo.md`.

## Схема компонентов

```mermaid
flowchart LR
    user([Студент<br/>браузер])

    subgraph client["Клиент"]
        spa[Angular SPA<br/>атлас · тесты · аналитика]
        core[viewer-core<br/>three.js]
        spa --- core
    end

    gw[API Gateway<br/>C# · YARP<br/>:8080]
    consul[(Consul<br/>service discovery<br/>:8500)]

    subgraph svc["Stateless-микросервисы (масштабируются --scale)"]
        catalog[Catalog<br/>C# · ASP.NET Core · EF Core]
        quiz[Quiz<br/>TypeScript · NestJS · Prisma]
        analytics[Analytics<br/>Python · FastAPI · SQLAlchemy]
    end

    rmq[[RabbitMQ<br/>exchange quiz.events<br/>:15672]]
    minio[(MinIO<br/>бакет models · .glb<br/>:9001)]
    web[web<br/>nginx + сборка Angular]

    subgraph pg["PostgreSQL :5432"]
        cdb[(catalog_db)]
        qdb[(quiz_db)]
        adb[(analytics_db)]
    end

    user --> spa
    spa -- "HTTPS/REST /api/**" --> gw
    core -- "/models/**" --> gw
    gw -- "/api/catalog" --> catalog
    gw -- "/api/quiz" --> quiz
    gw -- "/api/analytics" --> analytics
    gw -- "/models (статический адрес)" --> minio
    gw -- "/** SPA" --> web
    gw -. "адреса экземпляров" .-> consul

    quiz -- "REST: сущность для карточки<br/>(адрес из Consul)" --> catalog
    quiz -- "AnswerSubmitted, TestCompleted" --> rmq
    rmq -- "analytics.quiz-events" --> analytics

    catalog --> cdb
    catalog -- "синхронизация .glb при старте" --> minio
    quiz --> qdb
    analytics --> adb

    catalog -. "регистрация, health" .-> consul
    quiz -. "регистрация, health; адреса Catalog" .-> consul
    analytics -. "регистрация, health" .-> consul
```

Ключевое решение — **один origin**: браузер ходит только на gateway `:8080`, поэтому `model.url` в манифестах (`models/animal-cell/v1/…`) работает без изменений и CORS не нужен.

## Компоненты

### Клиент (Angular + viewer-core)
- **Что делает.** Три экрана: «Атлас» (3D-модель клетки и детальные модели органоидов, сноски, расслоение, справочник), «Тесты» (модель слева, панель теста справа; вопросы «Что выделено на модели?» с подлётом камеры и изоляцией части), «Аналитика» (сводка, самые трудные органоиды, статистика по вопросам; автообновление раз в 10 с).
- **Как получает данные.** Только через репозитории за `InjectionToken`: `STRUCTURE_REPO` (`HttpStructureRepository` → Catalog), `QUIZ_REPO` (→ Quiz), `ANALYTICS_REPO` (→ Analytics). Модели `.glb` грузит ядро `viewer-core` по `/models/...`.
- **Пользователь.** Анонимный; `clientId` (UUID) хранится в `localStorage` и отправляется в заголовке `X-Client-Id` — по нему Quiz отдаёт попытку только её владельцу.
- **В контейнере.** `web` — nginx со статикой сборки; наружу не публикуется, отдаётся через gateway.

### API Gateway (C#, YARP) — `services/gateway`
- **Маршруты.** `/api/catalog/**`, `/api/quiz/**`, `/api/analytics/**` → соответствующие сервисы; `/models/**` → `http://minio:9000` без изменения пути; `/**` → `web`.
- **Service discovery.** `ConsulDiscoveryService` опрашивает `GET /v1/health/service/{name}?passing=true` сразу при старте, затем каждые 5 с; при изменении набора адресов `ConsulProxyConfigProvider` публикует новую конфигурацию YARP. Consul недоступен → используется последний известный набор.
- **Балансировка и отказоустойчивость.** `RoundRobin`; пассивные проверки здоровья (`TransportFailureRate`, окно и реактивация 10 с); повтор идемпотентных `GET`/`HEAD` на другом экземпляре при транспортной ошибке (до 3 попыток); `ConnectTimeout` 2 с. Нет экземпляров → `503 {"error":"service_unavailable"}`.

### Catalog Service (C#, ASP.NET Core + EF Core + Npgsql) — `services/catalog`, БД `catalog_db`
- **Что делает.** Хранит и отдаёт содержимое атласа: манифесты сцен (как `jsonb` целиком + нормализованные части) и тексты сущностей (органоидов). API: `GET /api/catalog/manifests[/{id}]`, `GET /api/catalog/entities[/{id}|?ids=]`.
- **Старт.** Фоновая служба: ждёт БД → применяет миграции → seed из `projects/app/public` (под `pg_advisory_xact_lock`, одна транзакция, повторный старт ничего не меняет) → синхронизация `.glb` в MinIO (при **каждом** старте, через S3 API, с ретраями). Пока шаги не пройдены, `/health` = `503` и Consul не пускает трафик.

### Quiz Service (TypeScript, NestJS + Prisma) — `services/quiz`, БД `quiz_db`
- **Что делает.** Тесты, вопросы, варианты, попытки и ответы; проверка ответов (`single` / `multiple`, пустой ответ = «Не знаю»). API: `GET /api/quiz/quizzes[/{id}]`, `POST /api/quiz/attempts`, `POST …/answers`, `POST …/complete`, `GET /api/quiz/attempts/{id}`. Признак правильного ответа не уходит клиенту до ответа на вопрос.
- **Состояние.** Попытка хранится в БД, а не в памяти экземпляра — поэтому Quiz масштабируется и переживает отказ экземпляра посреди теста. Ответ и завершение сериализуются `SELECT … FOR UPDATE` по строке попытки.
- **Прямая связь с Catalog.** `CatalogClient` берёт адреса Catalog из Consul (список на 5 с, по кругу), таймаут 2 с, кэш сущностей в памяти 60 с. Catalog недоступен → `entity: null`, ответ проверяется как обычно (деградация, а не ошибка).
- **События.** После коммита публикует в RabbitMQ `AnswerSubmitted` и `TestCompleted` (persistent, publisher confirms, `message_id = eventId`); брокер недоступен → ответ пользователю всё равно успешный.
- **Старт.** `prisma migrate deploy` в entrypoint, затем seed двух тестов, если `quizzes` пуста.

### Analytics Service (Python, FastAPI + SQLAlchemy async + aio-pika) — `services/analytics`, БД `analytics_db`
- **Что делает.** Потребляет события Quiz и считает статистику. API: `GET /api/analytics/summary`, `GET /api/analytics/entities`, `GET /api/analytics/questions?quizId=`.
- **Потребитель.** Очередь `analytics.quiz-events` (привязка `quiz.#`), `prefetch 10`, ручной `ack`. Валидация Pydantic; невалидное → `reject(requeue=false)` → `analytics.dlx` → `analytics.quiz-events.dlq`. Идемпотентность по `eventId`: `INSERT … ON CONFLICT DO NOTHING RETURNING`, и только при вставке — инкремент `question_stats`, в одной транзакции. Ошибка БД → `nack(requeue=true)` с паузой 1 с.
- **Старт.** Схема — `metadata.create_all` под advisory-блокировкой; потребитель запускается в lifespan с ретраями подключения.

### Инфраструктура
| Компонент | Образ | Роль |
|---|---|---|
| PostgreSQL | `postgres:18.7-alpine` | одна инстанция, три БД и три пользователя с доступом только к своей БД |
| RabbitMQ | `rabbitmq:4.4.0-management-alpine` | брокер событий Quiz → Analytics, UI управления |
| Consul | `hashicorp/consul:1.22.7` (dev-режим) | реестр сервисов и health checks |
| MinIO | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | объектное хранилище `.glb`, бакет `models` с анонимным чтением |
| web | `nginx:1.31.8-alpine` | статика Angular |

Все сервисы регистрируются в Consul с IP контейнера, `ID = <name>-<hostname>`, HTTP health check `/health`, повторной регистрацией каждые 30 с (переживает перезапуск Consul) и снятием регистрации при остановке.

## Взаимодействия

| Откуда → куда | Тип | Как | Зачем |
|---|---|---|---|
| Браузер → Gateway | синхронно, HTTP | REST `/api/**`, `/models/**`, SPA | единая точка входа |
| Gateway → Catalog / Quiz / Analytics | синхронно, HTTP | YARP, адреса из **Consul**, RoundRobin | маршрутизация и балансировка |
| Gateway → MinIO, web | синхронно, HTTP | статический адрес | модели и статика |
| **Quiz → Catalog** | **прямая связь**, HTTP | `GET /api/catalog/entities?ids=`, адрес из **Consul** | карточка органоида после ответа |
| **Quiz → Analytics** | **через брокер**, асинхронно | RabbitMQ `quiz.events` (topic): `quiz.answer.submitted`, `quiz.test.completed` | статистика без связности по времени |
| Catalog → MinIO | синхронно, S3 API | при каждом старте | синхронизация `.glb` |
| Сервисы → Consul | HTTP | регистрация + health check `/health` | обнаружение, вывод из ротации |
| Сервисы → PostgreSQL | TCP | своя БД у каждого | хранение |

### Топология RabbitMQ

```mermaid
flowchart LR
    quiz[Quiz] -- "quiz.answer.submitted<br/>quiz.test.completed" --> ex{{quiz.events<br/>topic, durable}}
    ex -- "quiz.#" --> q[analytics.quiz-events<br/>durable, x-dead-letter-exchange]
    q --> analytics[Analytics]
    q -. "reject(requeue=false)" .-> dlx{{analytics.dlx<br/>fanout}}
    dlx --> dlq[analytics.quiz-events.dlq]
```

### Поток «студент ответил на вопрос»

```mermaid
sequenceDiagram
    participant B as Браузер
    participant G as Gateway
    participant Q as Quiz
    participant C as Catalog
    participant R as RabbitMQ
    participant A as Analytics
    B->>G: POST /api/quiz/attempts/{id}/answers (X-Client-Id)
    G->>Q: экземпляр из Consul (RoundRobin)
    Q->>Q: проверка ответа, INSERT в quiz_db (транзакция)
    Q->>C: GET /api/catalog/entities?ids=… (адрес из Consul, кэш 60 с)
    C-->>Q: EntityContent (или таймаут → entity: null)
    Q-->>B: { correct, correctOptionIds, entity }
    Q-)R: AnswerSubmitted (после коммита)
    R-)A: analytics.quiz-events
    A->>A: answer_events ON CONFLICT DO NOTHING → question_stats
    B->>G: GET /api/analytics/summary (раз в 10 с)
```

## Базы данных

Диаграммы построены по фактическим схемам в запущенных БД (`information_schema`), а не по плану.

### `catalog_db` (Catalog, EF Core, миграция `InitialCreate`)

```mermaid
erDiagram
    entities ||--o{ entity_sources : "источники"
    entities ||--o{ scene_manifests : "сущность сцены"
    models ||--o{ scene_manifests : "модель"
    scene_manifests ||--o{ scene_parts : "части"
    entities ||--o{ scene_parts : "сущность части"

    entities {
        text id PK
        text kind
        text title_ru
        text summary_ru
        timestamptz updated_at
    }
    entity_sources {
        int id PK
        text entity_id FK
        text title
        text url
        int position
    }
    models {
        text id PK
        text object_key
        bigint size_bytes
        text content_type
        text source_author
        text source_url
        text source_platform
        text license
        bool modified
    }
    scene_manifests {
        text id PK
        text entity_id FK
        text model_id FK
        text status "ready | stub"
        int schema_version
        jsonb body "манифест целиком"
        timestamptz updated_at
    }
    scene_parts {
        text manifest_id PK,FK
        text part_id PK
        text entity_id FK
        text detail_manifest_id "без FK: может указывать на заглушку"
        text detail_focus
    }
```

### `quiz_db` (Quiz, Prisma, миграция `20261117000000_init`)

```mermaid
erDiagram
    quizzes ||--o{ questions : ""
    questions ||--o{ answer_options : ""
    quizzes ||--o{ attempts : ""
    attempts ||--o{ attempt_answers : ""
    questions ||--o{ attempt_answers : ""
    attempt_answers ||--o{ attempt_answer_options : "выбранные"
    answer_options ||--o{ attempt_answer_options : ""

    quizzes {
        text id PK
        text title
        text description
        text manifest_id
        timestamptz created_at
    }
    questions {
        uuid id PK
        text quiz_id FK
        int position "UNIQUE с quiz_id"
        text type "single | multiple"
        text text
        text entity_id
        text manifest_id "null — обычный вопрос"
        text part_id "null — обычный вопрос"
    }
    answer_options {
        uuid id PK
        uuid question_id FK
        int position "UNIQUE с question_id"
        text text
        bool is_correct "не отдаётся клиенту до ответа"
    }
    attempts {
        uuid id PK
        text quiz_id FK
        uuid client_id
        text participant_name
        timestamptz started_at
        timestamptz completed_at
        int score
        int total
    }
    attempt_answers {
        uuid id PK
        uuid attempt_id FK
        uuid question_id FK
        bool is_correct
        timestamptz answered_at
    }
    attempt_answer_options {
        uuid attempt_answer_id PK,FK
        uuid option_id PK,FK
    }
```

### `analytics_db` (Analytics, SQLAlchemy `create_all`)

Связей между таблицами нет намеренно: это проекция событий, ссылки на Quiz — логические (идентификаторы из событий).

```mermaid
erDiagram
    answer_events {
        uuid event_id PK "идемпотентность"
        uuid attempt_id
        text quiz_id
        uuid question_id
        text entity_id
        bool correct
        uuid client_id
        timestamptz occurred_at
        jsonb payload
    }
    test_results {
        uuid attempt_id PK
        uuid event_id
        text quiz_id
        uuid client_id
        int score
        int total
        bigint duration_ms
        timestamptz completed_at
    }
    question_stats {
        uuid question_id PK
        text quiz_id
        text entity_id
        int answers_total
        int answers_correct
        timestamptz updated_at
    }
```

## Соответствие требованиям ТЗ

| Требование | Чем закрыто |
|---|---|
| Фронтенд на Angular | `projects/app`: экраны «Атлас», «Тесты», «Аналитика» |
| ≥ 2 микросервиса на разных языках | Catalog (C#), Quiz (TypeScript), Analytics (Python) + Gateway (C#) |
| Прямая связь микросервисов | Quiz → Catalog по REST, адрес из Consul |
| Связь через брокер | Quiz → RabbitMQ → Analytics |
| БД, ≥ 5 проработанных сущностей | 5 таблиц в `catalog_db`, 6 в `quiz_db`, 3 в `analytics_db` |
| Consul | регистрация и health checks всех сервисов; Gateway и Quiz берут адреса из Consul |
| API Gateway | YARP: `/api/*`, `/models/*`, SPA; балансировка и отказоустойчивость |

## Не входит в минимальную версию

Redis (кэш и сессии), пользователи и роли, k6-нагрузка, outbox для событий, `AtlasContentUpdated` (`PUT` сущностей Catalog + сброс кэша в Quiz). Подробнее — `docs/lab/README.md`, «Потом».
