# Отчёт: Analytics — потребитель RabbitMQ и API статистики (задачи 3.2, 3.3)

Ветка `claude/lab-analytics-service-add2e3`, коммиты:
- `6072d3a` analytics: consume quiz events from RabbitMQ (task 3.2)
- `2ece397` analytics: statistics API (task 3.3)

Не запушено и не слито в `lab-backend` (по правилам параллельной работы).

## Что сделано

### 3.2 Потребитель (`services/analytics/app/`)

| Файл | Содержимое |
|---|---|
| `models.py` | 3 таблицы по контракту (SQLAlchemy Core `Table`): `answer_events`, `test_results`, `question_stats`; индексы по `answer_events.entity_id` и `question_stats.quiz_id` |
| `db.py` | engine/sessionmaker; `create_schema()` = `metadata.create_all` под `pg_advisory_xact_lock`; фоновые ретраи раз в 3 с |
| `events.py` | Pydantic-модели конверта и обоих payload, дискриминатор по `type`; `version: Literal[1]`; даты — только с часовым поясом (`AwareDatetime`); лишние поля игнорируются |
| `store.py` | `save_answer`: `INSERT answer_events … ON CONFLICT DO NOTHING RETURNING` и, только если вставлено, upsert `question_stats` (+1 / +correct) — в транзакции вызывающего; `save_test_result`: `INSERT test_results … ON CONFLICT DO NOTHING` |
| `consumer.py` | `handle(body) -> Outcome` (ACK / REJECT / REQUEUE) без типов AMQP — тестируется без брокера; класс `Consumer`: `aio_pika.connect_robust`, ретраи первого подключения раз в 3 с, объявление топологии, `prefetch 10`, `no_ack=False`; REJECT → `reject(requeue=False)` (→ DLQ), REQUEUE → пауза 1 с и `nack(requeue=True)` (без «горячего» цикла при лежащей БД) |
| `main.py` | lifespan: три фоновые задачи (Consul, создание схемы, потребитель — ждёт схему); старт не блокируется. `/health` → `503`, пока схема не создана, БД не отвечает или потребитель не подключён (флаг по `close_callbacks`/`reconnect_callbacks` robust-соединения) |

Топология: `quiz.events` (topic, durable — объявляется и Analytics, идемпотентно) → `quiz.#` → `analytics.quiz-events` (durable, `x-dead-letter-exchange: analytics.dlx`); `analytics.dlx` (fanout, durable) → `analytics.quiz-events.dlq` (durable).

`deploy/docker-compose.yml`, блок `analytics`: `RABBITMQ_URL=amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@rabbitmq:5672/` и `depends_on: rabbitmq (service_healthy)`.

### 3.3 API (`stats.py`, `main.py`)

- `GET /api/analytics/summary`, `GET /api/analytics/entities`, `GET /api/analytics/questions?quizId=` — формат по `contracts.md`; проценты округляются в SQL (`round(numeric, 1)`); без данных — нули и `lastEventAt: null`.
- Ошибка БД при запросе статистики → `503 {"error":"unavailable","message":"database is unavailable"}` (а не голый 500).
- Заголовок `X-Instance` — из каркаса.

### Тесты и инструменты

- `tests/` (pytest + pytest-asyncio): `test_events.py` (валидация, без БД, 16 случаев), `test_consumer.py` (повторная доставка `eventId` не меняет `question_stats`; `TestCompleted` идемпотентен, в т. ч. по `attemptId` с новым `eventId`; невалидное → REJECT и ничего не пишется в БД; ошибка БД → REQUEUE), `test_api.py` (пустая БД → нули/`null`; расчёт сводки, сортировка сущностей, фильтр по `quizId`; `/health` → 503 без потребителя).
- БД-тесты идут на настоящем PostgreSQL (`TEST_DATABASE_URL`), без неё — пропускаются (валидация всё равно работает).
- `requirements-dev.txt` (pytest 9.2.0, pytest-asyncio 1.5.0, ruff 0.17.5), `ruff.toml`, `pytest.ini`, `.gitignore` (`.venv`).
- Версии проверены `pip index versions`: aio-pika 10.2.3 (последняя), pydantic 2.14.3 (транзитивно от FastAPI), pytest 9.2.0, pytest-asyncio 1.5.0, ruff 0.17.5.

Запуск тестов:

```
cd services/analytics
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
docker run -d --name analytics-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=analytics_test -p 55432:5432 postgres:18.7-alpine
TEST_DATABASE_URL=postgresql+asyncpg://postgres:test@localhost:55432/analytics_test .venv/Scripts/python -m pytest -q
```

## Проверки (команда → результат)

Все на временных контейнерах `analytics-test-pg-add2e3` (postgres:18.7-alpine, порт 55432) и `analytics-test-rmq-add2e3` (rabbitmq:4.4.0-management-alpine, порты 55672/55673); сервис — локально `uvicorn app.main:app --port 58080` (Python 3.13, venv). Контейнеры удалены после проверки, стек `atlas` не поднимался.

1. `pytest -q` (с `TEST_DATABASE_URL`) → `24 passed`; без БД → `16 passed, 8 skipped`.
2. `ruff check app tests` → `All checks passed!`; `ruff format --check` → `13 files already formatted`.
3. Сервис запущен **до** RabbitMQ → в логе `RabbitMQ connection failed (…); retrying in 3s` каждые 3 с, `/health` → `503`; RabbitMQ поднялся → `Consuming analytics.quiz-events (prefetch 10)`, `/health` → `200 {"status":"ok"}`.
4. Публикация скриптом (aio-pika, publisher confirms) в `quiz.events`: валидный `AnswerSubmitted` дважды с одним `eventId`, валидный `TestCompleted` дважды, `{"foo":1}` и `not json` (ключ `quiz.answer.submitted`) →
   - лог: `Stored AnswerSubmitted …`, `Duplicate AnswerSubmitted … ignored`, `Stored TestCompleted …`, `Duplicate TestCompleted … ignored`, 2 × `Invalid message -> DLQ: …`;
   - Management API: `analytics.quiz-events messages=0 args={'x-dead-letter-exchange': 'analytics.dlx'}`, `analytics.quiz-events.dlq messages=2`; привязки `quiz.events -> analytics.quiz-events quiz.#`, `analytics.dlx -> analytics.quiz-events.dlq`;
   - `GET /api/analytics/summary` → `{"attemptsCompleted":1,"avgScorePct":50.0,"answersTotal":1,"correctRatePct":100.0,"lastEventAt":"2026-11-17T18:48:36.029096Z"}`; `entities` → `[{"entityId":"mitochondrion","answersTotal":1,"correctRatePct":100.0}]`; `questions` и `questions?quizId=cell-organelles` → одна строка с `answersTotal: 1` (дубликат не учтён).
5. `docker stop` RabbitMQ → `/health` → `503 "message broker consumer is not connected"`; `docker start` → `RabbitMQ reconnected`, `/health` → `200`.
6. `docker stop` PostgreSQL → `/health` и `/api/analytics/summary` → `503 "database is unavailable"`; `docker start` → `200`.
7. PostgreSQL остановлен, опубликован тот же набор из 6 сообщений → 4 × `Failed to store event …; requeueing` (сообщения остаются в очереди), битые сразу в DLQ (стало 4); PostgreSQL запущен → `Stored …` / `Duplicate … ignored`, сводка `attemptsCompleted: 2, answersTotal: 2`.
8. `docker build -f services/analytics/Dockerfile .` → собран; `python -c "import app.main, aio_pika"` в образе → `import ok 10.2.3`. Образ удалён.

Не проверено (за оркестратором, на compose): проверки 1–6 этапа 3 со стеком, реальный Quiz-публикатор, регистрация в Consul с брокером, `--scale analytics=2`.

## Отклонения и замечания

- **Схема — `create_all`, без Alembic.** Самое простое рабочее: 3 таблицы, `create_all` идемпотентен (создаёт только отсутствующие); контракт это допускает. Под `pg_advisory_xact_lock`, чтобы два экземпляра при `--scale` не гонялись на `CREATE TABLE`. Минус: изменения существующих таблиц не применятся — при первом изменении схемы переходить на Alembic.
- **`duration_ms` — `bigint`** вместо `int` (попытка, открытая дольше ~24,8 дня, переполнила бы `int`, и событие ушло бы в бесконечный requeue). Контракт обновлён.
- **Повторный `TestCompleted` по `attemptId` с новым `eventId`** тоже игнорируется (`ON CONFLICT DO NOTHING` без цели покрывает оба уникальных ключа). Quiz по контракту не дублирует событие при повторном `complete`, так что это лишь защита.
- `occurred_at` в `answer_events` — из `occurredAt` конверта (а не `payload.answeredAt`); `payload` в `jsonb` — только payload, нормализованный Pydantic.
- Невалидным считается и `version ≠ 1`, и дата без часового пояса.
- Ошибка БД → `nack(requeue=true)` после паузы 1 с: без паузы при лежащей БД сообщения крутились бы в горячем цикле. Ядовитое сообщение, стабильно валящее БД (не из-за доступности), будет крутиться бесконечно — принято для минимальной версии (повтор ограничивать через `x-delivery-limit` quorum-очереди — потом).
- Ловушка при ручной проверке: `docker exec rabbitmq-diagnostics …` **от root** до старта сервера создаёт `/var/lib/rabbitmq/.erlang.cookie` с владельцем root, и RabbitMQ падает с `eacces`. Ожидать готовность нужно `docker exec -u rabbitmq …` (compose-healthcheck не страдает: к его запуску cookie уже создан сервером).

## Предлагаемые записи для `docs/decisions.md`

| Решение | Почему |
|---|---|
| Analytics создаёт схему `metadata.create_all` при старте (под advisory-блокировкой), без Alembic | 3 таблицы, схема пока не меняется; контракт допускает. Alembic — при первом изменении существующей таблицы |
| Потребитель Analytics: `aio_pika.connect_robust` + свой цикл ретраев первого подключения; обработка сообщения отделена от AMQP (`handle(body) -> ack/reject/requeue`) | Robust-соединение само восстанавливает топологию и потребителя после разрыва; чистая функция обработки покрывается тестами без брокера |
| Ошибка БД в потребителе → requeue с паузой 1 с; невалидное → DLQ сразу | Нет горячего цикла при лежащей БД; события не теряются, пока Analytics/БД недоступны |

## Изменения контракта (`docs/lab/contracts.md`, раздел Analytics)

- Добавлены определения полей ответа: `avgScorePct` (среднее по попыткам, `total = 0` не учитывается), `correctRatePct`, `lastEventAt` (максимум из `answer_events.occurred_at` и `test_results.completed_at`, UTC с `Z`), округление, сортировки `entities` и `questions`, поведение `quizId` (не задан — все, неизвестный — `[]`), `503` при ошибке БД, условия `503` для `/health`.
- `test_results.duration_ms`: `int` → `bigint`.
- Повторный `TestCompleted` той же попытки игнорируется; схема — `create_all` под `pg_advisory_xact_lock`.
- Формат событий не менялся.

## Что осталось

- Проверки этапа 3 на docker compose (оркестратор): прохождение теста через Quiz, `stop/start analytics` с накоплением очереди, ручная публикация `{"foo":1}` через UI, повтор `eventId`, `--scale quiz=2`.
- `smoke.mjs`: ожидание роста `summary.answersTotal` (оркестратор).
- Клиентский экран аналитики (задача 3.4) — другая сессия.
