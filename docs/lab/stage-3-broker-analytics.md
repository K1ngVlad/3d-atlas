# Этап 3. Брокер + Analytics + экран аналитики (23–24.11)

Прочитай перед началом: `docs/lab/README.md`, `docs/lab/contracts.md` (RabbitMQ, Analytics, Клиент).

**Результат этапа:** каждый ответ и завершение теста уходят из Quiz в RabbitMQ, Analytics их обрабатывает и отдаёт статистику, экран «Аналитика» её показывает. Если Analytics остановлен, события копятся в очереди и обрабатываются после его запуска.

## Задачи

### 3.1 Quiz: публикация событий
- [ ] `QuizEventsPublisher` на RabbitMQ (`amqplib` + `amqp-connection-manager` — переподключение; **не** транспорт `@nestjs/microservices`: он оборачивает сообщения в свой формат `{pattern, data}`, Python-потребителю это не нужно). Объявить exchange `quiz.events`.
- [ ] Конверт и payload строго по `contracts.md`; `eventId` — новый UUID, `message_id` = `eventId`, persistent, publisher confirms.
- [ ] Брокер недоступен при публикации → ответ пользователю всё равно успешный, ошибка в лог (решение 43). Health Quiz → `503`, пока нет соединения с брокером.

### 3.2 Analytics: потребитель
- [ ] `aio-pika`, подключение с ретраями; объявление `analytics.quiz-events`, `analytics.dlx`, `analytics.quiz-events.dlq` по `contracts.md`; `prefetch 10`, ручной `ack`.
- [ ] Валидация конверта и payload (Pydantic-модели по `contracts.md`). Невалидное → `nack(requeue=false)` (в DLQ) + лог.
- [ ] `AnswerSubmitted` → `answer_events` (`ON CONFLICT DO NOTHING RETURNING`) и, только если вставлено, `question_stats` — в одной транзакции. `TestCompleted` → `test_results` (`ON CONFLICT DO NOTHING`).
- [ ] Потребитель запускается в lifespan FastAPI; health → `503`, если потребитель не подключён или нет БД.

### 3.3 Analytics: API
- [ ] Три эндпоинта из `contracts.md`. Проценты — с одним знаком после запятой; при отсутствии данных — нули и `lastEventAt: null`, не ошибка.
- [ ] Тесты (pytest): повторная доставка одного `eventId` не меняет `question_stats`; невалидное сообщение не пишет в БД.

### 3.4 Клиент: экран аналитики
- [ ] `ANALYTICS_REPO` + `HttpAnalyticsRepository`.
- [ ] `features/analytics`: карточки сводки (завершено попыток, средний результат, всего ответов, доля верных, время последнего события); таблица «Самые трудные органоиды» (название из `STRUCTURE_REPO.getEntity`, доля верных — горизонтальная полоса на CSS); таблица по вопросам с фильтром по тесту (текст вопроса — из `QUIZ_REPO`).
- [ ] Кнопка «Обновить» и автообновление раз в 10 с, пока экран открыт (для демонстрации — видно, как приходят события).
- [ ] Пустое состояние: «Пока нет данных — пройдите тест».

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
(заполняет Claude Code по завершении)
