# Отчёт: Quiz Service (задачи 2.1, 2.2, 3.1)

Ветка `claude/lab-quiz-service-debe20`, коммиты:

| Коммит | Задача |
|---|---|
| `79eef4d` quiz: prisma schema, init migration and quiz seed | 2.1 |
| `4fca897` quiz: API, answer rules, X-Client-Id ownership, Catalog client via Consul | 2.2 |
| `21186ce` quiz: publish AnswerSubmitted/TestCompleted to RabbitMQ | 3.1 |

Не запушено и не слито в `lab-backend` — это делает оркестратор.

## Что сделано

### 2.1 Данные
- `prisma/schema.prisma`: 6 моделей по `contracts.md` (имена таблиц и колонок — snake_case через `@@map`/`@map`), плюс `UNIQUE (quiz_id, position)` у вопросов и `UNIQUE (question_id, position)` у вариантов. Миграция `prisma/migrations/20261117000000_init`.
- `docker-entrypoint.sh`: `prisma migrate deploy` → `node dist/main.js`. Prisma сама берёт advisory-блокировку на миграции, при `--scale quiz=2` безопасно.
- `prisma/seed/quizzes.json` — два теста по 10 вопросов:
  - `animal-cell-organelles` «Органоиды животной клетки»: 4 вопроса «Что выделено на модели?» (митохондрии, Гольджи, шероховатая ЭПС, центросома), 2 `multiple`, 4 обычных `single`;
  - `organelle-structure` «Строение органоидов»: 5 вопросов «Что выделено?», 2 `multiple`, 3 обычных; 4 вопроса по `mitochondrion`, 4 по `golgi`, 2 по `endoplasmic-reticulum`.
- Загрузка при старте (`SeedService`): файл проверяется всегда (ошибка → старт падает со списком проблем `Invalid quiz seed: - …`); вставка — одной транзакцией под `pg_advisory_xact_lock`, только если `quizzes` пуста.
- Id вопросов и вариантов — детерминированные UUID (SHA-1 от `quizId/qN/oM`, раскладка v5): пересев даёт те же id, статистика Analytics не «осиротеет».
- В файле верный вариант записан первым (удобно проверять), а `position` (порядок показа) — стабильная перестановка от хэша. Иначе верным всегда был бы первый вариант.

### 2.2 API и логика
- Все 6 эндпоинтов контракта (`QuizController` → `QuizService` → порт `QuizStore`, реализация `PrismaQuizStore`).
- `GET /quizzes/{id}` отдаёт только `{id, text}` вариантов — `isCorrect` в ответ не попадает (проверено тестом и `curl`).
- Проверка ответа: `single` — выбран единственный верный; `multiple` — точное совпадение множеств; пустой ответ — неверно. `400`: вопрос не из теста, вариант не из вопроса, дубликаты, >1 варианта у `single`, неверное тело. `409`: повторный ответ (`already_answered`), попытка завершена (`attempt_completed`).
- `X-Client-Id`: отсутствует / не UUID / чужой → `404` на `GET attempt`, `answers`, `complete`. Невалидный `attemptId` → тоже `404`.
- Сохранение ответа и `complete` — в транзакции с `SELECT … FOR UPDATE` на строке попытки: параллельные дубли дают ровно один сохранённый ответ, параллельные `complete` — ровно одно событие. Повторный `complete` возвращает тот же `{score, total, completedAt}` без события.
- `CatalogClient`: Consul `/v1/health/service/catalog?passing=true`, список на 5 с, выбор по кругу; таймаут 2 с; кэш сущностей 60 с. Любая ошибка → `entity: null` + `WARN` в лог, ответ проверяется как обычно. В лог пишется адрес экземпляра Catalog (`Catalog entity "x" fetched from 172.x.x.x:8080`) — для проверки `--scale catalog=2`.
- Все ошибки (включая встроенные Nest/Fastify: битый JSON, неизвестный маршрут) приводятся к `{"error","message"}` глобальным фильтром.
- Определения тестов кэшируются в памяти экземпляра (после seed они не меняются).

### 3.1 События
- `RabbitQuizEventsPublisher` на `amqplib` 2.4.0 + `amqp-connection-manager` 5.0.1 (без `@nestjs/microservices`). Exchange `quiz.events` (topic, durable) объявляется в `setup` канала — заново при каждом переподключении.
- Конверт `{eventId, type, version: 1, occurredAt, source: "quiz", payload}`, payload по контракту; `messageId = eventId`, `persistent`, `contentType: application/json`; confirm-канал.
- Публикация — после коммита, без ожидания (ответ пользователю не задерживается). Пока брокера нет, `amqp-connection-manager` держит сообщение в памяти до 10 с (`publishTimeout`): короткий обрыв переживается, дольше — `ERROR … lost (decision 43)` в лог.
- `/health`: `503 {"error":"unavailable","message":"message broker is unavailable"}`, пока нет соединения и готового канала; при недоступной БД — тоже `503`.
- `deploy/docker-compose.yml`, блок `quiz`: `RABBITMQ_URL=amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@rabbitmq:5672`, `depends_on: rabbitmq (healthy)`. Пароль RabbitMQ в `.env` не должен содержать символов, требующих URL-кодирования (`@`, `/`, `:`).

## Проверки

Все — локально в `services/quiz`, Node 22.21. Временные контейнеры: `quizsvc-it-pg` (postgres 18.7, порт 55439), `quizsvc-it-rmq` (rabbitmq 4.4.0, 55679/55680), образ `quizsvc-it-image:local`; Consul и Catalog — фейковый HTTP-сервер на 18500/18601/18602. Всё удалено после проверки. Стек `atlas` не поднимался.

| Команда | Результат |
|---|---|
| `npm test` | 4 набора, 29 тестов passed; интеграционный набор пропущен (нет `TEST_DATABASE_URL`) |
| `npm run typecheck` (tsc по `tsconfig.spec.json`, вместе с тестами) | без ошибок |
| `npm run build` (`prisma generate && tsc -p tsconfig.build.json`) | собирается |
| `TEST_DATABASE_URL=… npm run test:int` (после `prisma migrate deploy` на временной БД) | 3 passed: два параллельных `SeedService` → один посев (2 теста / 20 вопросов), повторный старт ничего не меняет; 3 параллельных ответа на один вопрос → `saved` + 2×`duplicate`; 2 параллельных `complete` → одно `newlyCompleted`; ответ после завершения → `completed` |
| Jest-тесты из задачи 2.2 (`quiz.service.spec.ts`) | `multiple` — верно только при точном совпадении (подмножество и надмножество → неверно); пустой ответ — неверно; `409` на повторный ответ и на завершённую попытку; `404` без / с чужим / с мусорным `X-Client-Id` (для всех трёх запросов к попытке); `entity: null` при недоступном Catalog (мок), ответ сохранён; `complete` идемпотентен, `testCompleted` вызван один раз; `answerSubmitted` вызывается после сохранения |
| `seed-data.spec.ts` | каждый `partId` есть в `projects/app/public/manifests/<manifestId>.json`; каждый `entityId` — в `content/entities`; манифесты вопросов и тестов — только `status: "ready"`; 8–10 вопросов, 3–5 вариантов, ≥ 3 «Что выделено?», ≥ 2 `multiple`; во втором тесте ≥ 2 митохондрии и Гольджи + ЭПС; верный вариант на первом месте менее чем в половине вопросов; негативные проверки валидатора |
| `catalog.client.spec.ts` | адрес из Consul, маппинг `title.ru`/`summary.ru`, кэш 60 с, круг между двумя экземплярами, обновление списка через 5 с, `null` при `503` / таймауте / пустом Consul, ошибки не кэшируются |
| `rabbit-quiz-events.publisher.spec.ts` | конверт, ключи, `persistent`, `messageId = eventId`, confirm-канал, `isReady`, ошибка публикации не бросается, а логируется |
| `curl` по запущенному `dist/main.js` | `GET quizzes` — 2 теста по 10; в `GET quizzes/{id}` нет `correct`; `POST attempts` → `201`; верный ответ → `{correct:true, …, entity:{…}}`; повтор → `409 already_answered`; 2 варианта у `single` → `400 invalid_option`; чужой вариант → `400`; без / с чужим `X-Client-Id` → `404`; `complete` дважды → одинаковый `{score:1,total:10,completedAt}`; ответ после завершения → `409 attempt_completed`; битый JSON → `400 bad_request`; `X-Instance` в каждом ответе |
| Два фейковых Catalog за фейковым Consul | запросы шли по очереди на `:18601` и `:18602`, в логе Quiz оба адреса |
| RabbitMQ: очередь-зонд `it-probe` на `quiz.#` | после 2 ответов и 2 `complete` — ровно 3 сообщения (`quiz.answer.submitted` ×2, `quiz.test.completed` ×1), `delivery_mode=2`, `application/json`, `message_id == eventId` |
| `docker stop` брокера | `/health` → `503`; ответ на вопрос → `200` за 0,26 с; через 10 с `ERROR Event AnswerSubmitted … lost (decision 43): timeout`; после `docker start` переподключение само, `/health` → `200` через ~7 с |
| Старт сервиса без брокера | стартует, `/health` → `503`, в логе `RabbitMQ connection failed: ECONNREFUSED`; брокер поднялся → `200` |
| `docker kill` брокера на ~1 с во время ответа | сообщение дошло после переподключения (в очереди-зонде 1 сообщение, `lost` в логе нет) |
| `docker build -f services/quiz/Dockerfile .` + запуск на пустой БД | entrypoint: `All migrations have been successfully applied`, `Seeded 2 quizzes, 20 questions, 83 options`, `/health` 200; после `docker restart` — `No pending migrations to apply`, `seed skipped` |

Не проверялось (нужен общий стек — делает оркестратор): работа за gateway, реальный Consul и Catalog, `--scale quiz=2` / `--scale catalog=2` в compose, приём событий Analytics, `smoke.mjs`.

## Отклонения и решения по ходу

1. **Jest в ESM-режиме.** NestJS 12 распространяется только как ESM; Jest 30 на Node 22 не умеет `require()` ESM-модулей (нативно — только с Node 24.9). Тесты запускаются `node --experimental-vm-modules node_modules/jest/bin/jest.js` (`npm test`), `ts-jest` с `useESM` и отдельным `tsconfig.spec.json`; `jest` импортируется из `@jest/globals`. Прод-сборка по-прежнему CommonJS через `tsc` (Node 22 сам загружает ESM-пакеты через `require`). Из-за ESM в коде нет `__dirname`: путь к seed — от рабочего каталога (`/app` в контейнере, `services/quiz` для npm-скриптов), переопределяется `QUIZ_SEED_FILE`.
2. **`prisma` перенесён в `dependencies`**: CLI нужен в рантайме для `prisma migrate deploy` в entrypoint. Образ — 741 МБ (движки Prisma); уменьшать — потом.
3. **Consul недоступен → `CatalogClient` держит последний известный список адресов** (с предупреждением), а не отбрасывает его через 5 с, как буквально сказано в контракте. Пустой список → `entity: null`. Так же ведёт себя gateway по контракту.
4. **Публикация без ожидания с буфером до 10 с** — уточнение решения 43: ответ пользователю не ждёт брокер, короткий обрыв не теряет событие, длинный — теряет с записью в лог.
5. **Порядок вариантов** — стабильная перестановка при посеве (см. 2.1).
6. Валидация тел запросов — вручную в `QuizService` (без `class-validator`): полей мало.
7. Переменная `PORT` (по умолчанию 8080) — только для локальных запусков рядом с другими сервисами.
8. Swagger (`@nestjs/swagger`, общее соглашение контракта) не подключён — не входило в задачи; см. «Что осталось».
9. Проверка, что `partId`/`entityId` существуют в каталоге, — только в Jest-тесте seed (в контейнер Quiz `projects/app/public` не монтируется; контракт это допускает). При старте проверяется структура.
10. `amqplib` 2.4.0 — новый мажор со своими типами (`@types/amqplib` не нужен); `amqp-connection-manager` 5.0.1 с ним совместим (его devDependency — `amqplib ^2.2.0`). Версии сверены через `npm view`.

## Предлагаемые записи для `docs/decisions.md` (без номеров)

| Решение | Почему |
|---|---|
| Тесты Quiz — Jest в ESM-режиме (`--experimental-vm-modules`, `ts-jest` `useESM`), сборка — CommonJS через `tsc` | NestJS 12 только ESM; Jest на Node 22 не загружает ESM через `require`; прод на Node 22 работает через встроенный `require(esm)` |
| Ответ и завершение попытки сериализуются блокировкой строки попытки (`SELECT … FOR UPDATE`); `complete` идемпотентен и шлёт `TestCompleted` только при первом завершении | Двойной клик, две вкладки и `--scale quiz=2` не дают дублей ответов и событий |
| Id вопросов и вариантов seed — детерминированные UUID от `quizId/номер`; порядок вариантов — стабильная перестановка | Пересев не ломает статистику Analytics; верный ответ не всегда первый |
| События Quiz публикуются без ожидания; `amqp-connection-manager` держит сообщение до 10 с до подтверждения брокера | Ответ пользователю не зависит от брокера (решение 43), короткий обрыв не теряет событие |
| `CatalogClient` при недоступном Consul использует последний известный список Catalog | Отказ Consul не должен сразу выключать карточки органоидов; поведение как у gateway |
| `prisma` — рантайм-зависимость Quiz | `prisma migrate deploy` в entrypoint контейнера |

## Изменения контракта (`docs/lab/contracts.md`, раздел Quiz)

Добавлен абзац после правила `X-Client-Id`:
- коды `error` для Quiz: `already_answered` (409), `attempt_completed` (409), `invalid_option` / `invalid_question` / `bad_request` (400), `not_found` (404) — клиенту нужно различать два случая `409` из `quiz-ux.md`;
- `entity.title` и `entity.summary` — строки (из `title.ru` / `summary.ru`);
- варианты в `GET quiz` — в порядке показа, верный не всегда первый.

Эндпоинты, поля и коды HTTP не менялись.

## ⚠ Тексты вопросов проверить автору

Все 20 вопросов и варианты в `services/quiz/prisma/seed/quizzes.json` — черновик по `summary` сущностей каталога. Особенно стоит посмотреть:
- «Какие из перечисленных структур окружены мембраной?» (рибосома и центросома — неверные варианты);
- «Что верно для митохондриальной ДНК?» (неверный вариант «Упакована с гистонами в хромосомы»);
- «Что доставляют транспортные пузырьки к цис-стороне аппарата Гольджи?»;
- формулировки «Что выделено на модели …?» для частей с `select: "each"` (митохондрии, гранулы матрикса) — подсвечивается один экземпляр.

После правки текстов база уже засеяна: seed загружается, только если `quizzes` пуста (для пересева — очистить `quiz_db`).

## Что осталось

- Проверка на общем стеке (оркестратор): пункты 5–7 этапа 2 и 1, 2, 5 этапа 3, дописать `smoke.mjs`.
- `@nestjs/swagger` (OpenAPI сервиса) — не подключён.
- Необязательное 3.5 (`AtlasContentUpdated` → сброс кэша): в `CatalogClient` уже есть `invalidate(ids?)`, подписки нет.
- Линтера в `services/quiz` нет (только `tsc`).
