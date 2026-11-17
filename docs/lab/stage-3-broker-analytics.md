# Этап 3. Брокер + Analytics + экран аналитики (23–24.11)

Прочитай перед началом: `docs/lab/README.md`, `docs/lab/contracts.md` (RabbitMQ, Analytics, Клиент).

**Результат этапа:** каждый ответ и завершение теста уходят из Quiz в RabbitMQ, Analytics их обрабатывает и отдаёт статистику, экран «Аналитика» её показывает. Если Analytics остановлен, события копятся в очереди и обрабатываются после его запуска.

## Задачи

### 3.1 Quiz: публикация событий
- [x] `QuizEventsPublisher` на RabbitMQ (`amqplib` + `amqp-connection-manager` — переподключение; **не** транспорт `@nestjs/microservices`: он оборачивает сообщения в свой формат `{pattern, data}`, Python-потребителю это не нужно). Объявить exchange `quiz.events`.
- [x] Конверт и payload строго по `contracts.md`; `eventId` — новый UUID, `message_id` = `eventId`, persistent, publisher confirms.
- [x] Брокер недоступен при публикации → ответ пользователю всё равно успешный, ошибка в лог (решение 43). Health Quiz → `503`, пока нет соединения с брокером.

### 3.2 Analytics: потребитель
- [x] `aio-pika`, подключение с ретраями; объявление `analytics.quiz-events`, `analytics.dlx`, `analytics.quiz-events.dlq` по `contracts.md`; `prefetch 10`, ручной `ack`.
- [x] Валидация конверта и payload (Pydantic-модели по `contracts.md`). Невалидное → `nack(requeue=false)` (в DLQ) + лог.
- [x] `AnswerSubmitted` → `answer_events` (`ON CONFLICT DO NOTHING RETURNING`) и, только если вставлено, `question_stats` — в одной транзакции. `TestCompleted` → `test_results` (`ON CONFLICT DO NOTHING`).
- [x] Потребитель запускается в lifespan FastAPI; health → `503`, если потребитель не подключён или нет БД.

### 3.3 Analytics: API
- [x] Три эндпоинта из `contracts.md`. Проценты — с одним знаком после запятой; при отсутствии данных — нули и `lastEventAt: null`, не ошибка.
- [x] Тесты (pytest): повторная доставка одного `eventId` не меняет `question_stats`; невалидное сообщение не пишет в БД.

### 3.4 Клиент: экран аналитики
- [x] `ANALYTICS_REPO` + `HttpAnalyticsRepository`.
- [x] `features/analytics`: карточки сводки (завершено попыток, средний результат, всего ответов, доля верных, время последнего события); таблица «Самые трудные органоиды» (название из `STRUCTURE_REPO.getEntity`, доля верных — горизонтальная полоса на CSS); таблица по вопросам с фильтром по тесту (текст вопроса — из `QUIZ_REPO`).
- [x] Кнопка «Обновить» и автообновление раз в 10 с, пока экран открыт (для демонстрации — видно, как приходят события).
- [x] Пустое состояние: «Пока нет данных — пройдите тест».

### 3.5 Необязательно (только если 3.1–3.4 готовы с запасом)
- [ ] `PUT /api/catalog/entities/{id}` + публикация `AtlasContentUpdated` из Catalog; в Quiz — подписка каждого экземпляра на свою очередь и сброс кэша сущностей (`contracts.md`). Проверка: изменить `summary` через `curl` → следующий ответ в тесте показывает новый текст сразу, не дожидаясь TTL.

## Проверка

Выполнить на запущенном стеке; в «Отчёт» — результат каждого пункта.

1. Пройти тест → в RabbitMQ UI сообщения прошли через `analytics.quiz-events`; `/analytics` показывает новые числа.
2. `docker compose stop analytics` → пройти тест → в очереди лежат сообщения (видно в UI) → `docker compose start analytics` → очередь опустела, экран аналитики учёл все ответы.
3. Опубликовать вручную в `quiz.events` (UI RabbitMQ, ключ `quiz.answer.submitted`) сообщение `{"foo":1}` → оно в `analytics.quiz-events.dlq`, сервис работает.
4. Повторно опубликовать то же валидное событие с тем же `eventId` → статистика не изменилась.
5. `--scale quiz=2` → прохождение теста работает, события от обоих экземпляров доходят.
6. `smoke.mjs`: после прохождения теста ждать (до 10 с), пока `summary.answersTotal` вырастет.
7. Все тесты и линтеры проходят.
8. Коммиты по задачам, **`git push`** выполнен.

## Отчёт
Ветка `lab-backend`. Работа велась параллельно в отдельных ветках по сервисам и слита в `lab-backend` 17.11.2026 без конфликтов. Подробные отчёты сессий (что сделано, юнит-тесты, отклонения, изменения контракта): `docs/lab/reports/`. Решения — `docs/decisions.md`, 47–61.

Общая проверка: `cd deploy && docker compose down -v && docker compose up -d --build` → все 9 контейнеров `Up`; `node smoke.mjs` → 16/16 OK, код 0 (gateway, Consul, Catalog, MinIO, полный проход Quiz, рост `answersTotal` в Analytics).

Отчёты сессий: `docs/lab/reports/analytics-service.md`, `docs/lab/reports/quiz-service.md` (3.1), `docs/lab/reports/angular-client.md` (3.4). Необязательный пункт 3.5 не делался.

### Результаты проверки
1. Тест пройден → `/analytics` показывает сводку (6 попыток, 25 %, 65 ответов, 23,1 %, время последнего события) и «Самые трудные органоиды»; ответ из браузера учтён сразу (64 → 65).
2. `docker compose stop analytics` → прохождение теста через `smoke.mjs` → `analytics.quiz-events messages=22` (20 ответов + 2 `TestCompleted`) → `start analytics` → через 15 с `messages=0`, `answersTotal` 44 → 64.
3. Публикация `{"foo":1}` в `quiz.events` с ключом `quiz.answer.submitted` (Management API) → `analytics.quiz-events.dlq messages=1`, `/api/analytics/summary` → `200`.
4. Повтор события с тем же `eventId` на стеке не публиковал; проверено pytest (`test_consumer.py`) и вручную сессией Analytics на временном брокере (`Duplicate AnswerSubmitted … ignored`, статистика не изменилась).
5. `--scale quiz=2` → события обоих экземпляров дошли (`smoke.mjs`: `answersTotal` вырос на 20).
6. `smoke.mjs` ждёт (до 10 с) рост `summary.answersTotal` — проходит.
7. Analytics: pytest 24 passed, `ruff` чисто (сессия Analytics); клиент — см. этап 2, п. 10.
8. Merge в `lab-backend`, push.

### Отклонения
`create_all` вместо Alembic (решение 56), `duration_ms` — `bigint`, ошибка БД → requeue с паузой (решение 57).
