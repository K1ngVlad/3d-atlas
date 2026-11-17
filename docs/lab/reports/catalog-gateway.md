# Отчёт: Catalog + Gateway (этап 1, задачи 1.1–1.3; этап 4, пункт 4.1 — gateway)

Ветка `claude/lab-catalog-gateway-bd431a`, не запушена и не слита в `lab-backend` (по заданию это делает оркестратор).

## Что сделано

### 1.1 Catalog: модель данных и seed
- EF Core (Npgsql 10.0.3, EF Core 10.0.15): 5 сущностей `entities`, `entity_sources`, `models`, `scene_manifests`, `scene_parts` с именами таблиц и колонок из `contracts.md`; `body` — `jsonb`; `scene_parts.detail_manifest_id` без FK; check `status IN ('ready','stub')`. Миграция `InitialCreate`.
- `StartupWorker` (фоновая служба): ждёт БД и применяет миграции с ретраями → seed БД → синхронизация с MinIO. Пока не пройдены оба шага, `/health` отдаёт `503` (с причиной в `message`), поэтому Consul не пускает на экземпляр трафик.
- `DbSeeder`: одна транзакция, `pg_advisory_xact_lock`, проверка «уже заполнено» — после захвата блокировки. `detail` — строка или `{id, focus}`. Заглушки сущностей создаются для частей и для `entity` самого манифеста; счётчик заглушек — по признаку, который возвращает метод создания. `models.source_*` — из первого манифеста с `source`; `size_bytes` — по файлу `.glb` в seed.
- `ModelSync` (AWSSDK.S3 4.1.0.1, path-style): бакет `models`, политика анонимного `s3:GetObject` через `PutBucketPolicy`, загрузка `models/**/*.glb` с пропуском существующих (HEAD). Выполняется **при каждом старте**, отдельно от seed БД; ретраи раз в 10 с бесконечно, с 5-й неудачи — `LogError`.
- Итоговый лог: `Catalog seed done: 27 entities from content + 0 stub entities, 5 manifests, 27 parts, 4 models`.
- Compose (блок `catalog`): том `../projects/app/public:/seed:ro`, `S3__*` из `MINIO_ROOT_USER/PASSWORD`, `depends_on: minio healthy`.

### 1.2 Catalog: API
- `GET /api/catalog/manifests`, `/manifests/{id}` (тело из `jsonb` отдаётся строкой как `application/json`, без пересериализации), `/entities/{id}` (формат файла контента), `/entities?ids=` (порядок `ids`, отсутствующие пропускаются; без `ids` — все). `404` — `{"error":"not_found","message":…}`. `PUT` не делался (этап 3, необязательный).
- OpenAPI: `/openapi/v1.json` в `Development` (`Microsoft.AspNetCore.OpenApi`).
- Тесты `services/catalog/tests/Catalog.Tests` (xUnit 2.9.3, Testcontainers.PostgreSql 4.17.0, `postgres:18.7-alpine`, WebApplicationFactory) — 9 тестов: все 5 манифестов равны файлам по содержимому (`JsonNode.DeepEquals`), `404` для манифеста и сущности, разбор `detail` в `scene_parts`, форма `EntityContent` = файл `mitochondrion.json`, `ids` с пропуском и порядком, список манифестов с `title`, идемпотентность seed + **два seed одновременно на пустой БД** (блокировка), OpenAPI. Ryuk отработал, `.testcontainers.properties` не понадобился.

### 1.3 Gateway
- `ConsulProxyConfigProvider : IProxyConfigProvider` — единственный провайдер: маршруты и кластеры читает из секции `ReverseProxy` appsettings (`IConfiguration.Get<RouteConfig/ClusterConfig>`), у кластеров с `Metadata.Consul = "true"` подменяет `Destinations`; новый снимок + change token при каждом изменении. Статические `minio`, `web` не трогает. Id назначения = адрес (YARP сохраняет состояние здоровья неизменившихся назначений).
- `ConsulDiscoveryService`: первый опрос — в `StartAsync` (хост-службы стартуют до Kestrel; бюджет 5 с), дальше `PeriodicTimer` 5 с; `GET /v1/health/service/{name}?passing=true`; публикация только при изменении набора адресов; Consul недоступен → последний набор и одно предупреждение до восстановления.
- Нет экземпляров → `503 {"error":"service_unavailable",…}`; ошибки проксирования → `502/504` с JSON.
- `/models/**` → `http://minio:9000` без переписывания пути; `Content-Length` доходит (проверено, см. ниже).
- Тесты `services/gateway/tests/Gateway.Tests` (xUnit, WebApplicationFactory + поддельные Consul и апстримы на Kestrel) — 9 тестов: маршрут сразу после старта, RoundRobin, 503 JSON, подхват новых экземпляров и удержание последнего набора при «упавшем» Consul, `Content-Length` у `/models`, привязка конфигурации кластеров, сценарии 4.1.

### 4.1 Gateway: отказ экземпляра
- Пассивные проверки: `HealthCheck.Passive` (`TransportFailureRate`, `ReactivationPeriod` 10 с) у consul-кластеров; `TransportFailureRateHealthPolicyOptions`: окно 10 с, от 2 запросов, порог 30 %.
- Повтор `GET`/`HEAD` при транспортной ошибке (`Request`, `RequestTimedOut`, `ResponseHeaders`) на другом экземпляре, до 3 попыток, только пока ответ не начат; `POST` и др. не повторяются. Middleware стоит первым в конвейере YARP, поэтому каждая попытка учитывается пассивной проверкой.
- `ConnectTimeout` 2 с (`ForwarderHttpClientFactory`): IP убитого контейнера может не отвечать RST, без таймаута запрос висел бы.
- Если все экземпляры помечены пассивной проверкой — запрос всё равно идёт на них (иначе единственный экземпляр после одной ошибки давал бы 503 ещё 10 с).

## Проверки (команда → результат)

Юнит/интеграционные:
- `dotnet test services/catalog/tests/Catalog.Tests` → 9/9 passed (6 прогонов подряд стабильно).
- `dotnet test services/gateway/tests/Gateway.Tests` → 9/9 passed.

Стек коротко поднимался под отдельным именем проекта и с другими портами (`docker compose -p atlas-cg --env-file .env.example -f docker-compose.yml -f <override с !override портов 28080/28500/29001/25432> up -d --build postgres consul minio catalog gateway`), без quiz/analytics/rabbitmq/web; после проверки — `down -v` этого проекта, Testcontainers-контейнеров не осталось.
1. Логи Catalog → `Catalog seed done: 27 entities from content + 0 stub entities, 5 manifests, 27 parts, 4 models`; `MinIO model sync done: 4 uploaded, 0 already present`.
2. `curl -si :28080/api/catalog/manifests/animal-cell` → `200`, `Content-Type: application/json`, `X-Instance: <catalog>`, `X-Gateway-Instance: <gateway>`; тело равно `projects/app/public/manifests/animal-cell.json` по содержимому (сравнение с сортировкой ключей в node → `true`).
3. `.../manifests/nope` → `404 {"error":"not_found","message":"Manifest 'nope' not found"}`; `.../entities/mitochondrion` → совпадает с файлом контента.
4. `curl -sI :28080/models/animal-cell/v1/animal-cell.glb` → `200`, `Content-Length: 4628572` (= размер файла), `Content-Type: model/gltf-binary`.
5. `/api/quiz/quizzes` (quiz не запущен) → `503 {"error":"service_unavailable","message":"No live instances of 'quiz'"}`.
6. `up -d --scale catalog=2` → второй экземпляр: `Catalog database is already seeded; skipping`, `0 uploaded, 4 already present`; 4 запроса подряд → `X-Instance` чередуются.
7. 120 запросов (каждые 100 мс), в процессе `docker stop` второго экземпляра → **120 × 200**; экземпляр снял регистрацию (`Deregistered … 200`), gateway: `Cluster catalog: 1 instance(s)`.
8. 150 запросов, в процессе `docker kill` (без снятия регистрации) → **150 × 200**; 3 запроса ~2 с (таймаут соединения + повтор); лог YARP: `Destination … marked as 'Unhealthy' … reactivation in 00:00:10`.
9. MinIO с чистым томом (`rm -sfv minio`, `docker volume rm`, `up minio`) + рестарт Catalog при живой БД → `already seeded; skipping`, `Created bucket models`, `4 uploaded`; `HEAD /models/golgi/v1/golgi.glb` → `200`, `Content-Length: 379080`.
10. MinIO остановлен + рестарт Catalog → `MinIO model sync failed (attempt 1): Name or service not known`; Consul: `catalog critical`; gateway → `503` JSON. MinIO запущен → `sync done: 0 uploaded, 4 already present`, Consul `passing`, gateway `200`.

Не проверялось здесь (делает оркестратор на полном стеке): браузер/атлас через `:8080`, `npm start` с прокси, `smoke.mjs`.

## Отклонения от плана
- S3-клиент — **AWSSDK.S3**, а не Minio SDK: MinIO архивирован, а образ уже заменён на `pgsty/minio` (решение 45); AWSSDK — стандартный S3 API. Для v4 SDK выключены обязательные контрольные суммы (`WHEN_REQUIRED`).
- Явно закреплён `Microsoft.EntityFrameworkCore.Relational 10.0.15`: Npgsql 10.0.3 тянет EF Core 10.0.4, а `EF Core Design 10.0.15` — 10.0.15; без этого тестовый проект не собирался (CS1705).
- Окно обнаружения пассивных проверок = 10 с, а не дефолтные 60 с: YARP не реактивирует раньше окна (с окном 30 с лог показывал реактивацию через 30 с вместо заданных 10).
- Тестовые проекты лежат в `services/<svc>/tests/`; в `.csproj` сервисов — `DefaultItemExcludes` для `tests/**`, в Dockerfile публикуется явный `.csproj`.
- В тестах Catalog отключены провайдеры логов: на Windows провайдер EventLog бросал `ObjectDisposedException` при остановке хоста (только тестовая среда).
- Безвредный шум в логах Catalog при первом старте: `fail: … SELECT … FROM "__EFMigrationsHistory"` (EF проверяет таблицу истории до её создания) и `libgssapi_krb5.so.2` от Npgsql (Kerberos не используется).

## Предлагаемые записи для `docs/decisions.md`
- Catalog работает с MinIO через AWSSDK.S3 (path-style), а не через Minio SDK | MinIO архивирован; S3 API стандартен и подходит к `pgsty/minio`, Garage, SeaweedFS без изменений кода.
- Миграции, seed и синхронизация моделей — фоновая служба; до их завершения `/health` = 503 | Consul не пускает трафик на неготовый экземпляр; процесс не падает при недоступных БД/MinIO.
- Gateway: один `IProxyConfigProvider` читает `ReverseProxy` из appsettings и подставляет адреса из Consul; первый опрос в `StartAsync` | Нет дублирования конфигурации; маршруты готовы до приёма первого запроса.
- Gateway: повтор `GET`/`HEAD` на другом экземпляре при транспортной ошибке + пассивные проверки (окно = реактивация = 10 с) + `ConnectTimeout` 2 с; при всех помеченных экземплярах — запрос всё равно на них | Остановка/убийство экземпляра проходит без 502 у пользователя; единственный экземпляр не «выключается» на 10 с из-за одной ошибки.

## Изменения контракта (`docs/lab/contracts.md`, только разделы Gateway и Catalog)
- Gateway: коды тел ошибок (`service_unavailable`, `bad_gateway`, `gateway_timeout`); параметры пассивных проверок и повтора (4.1); метаданные `ConsulService` для имени сервиса.
- Catalog: формат `404`; порядок `entities?ids=`; поля сущности-заглушки (`kind = "unknown"`, пустые `summary`/`sources`); заглушка создаётся и для `entity` манифеста; адрес OpenAPI.

## Что осталось
- Полная проверка этапа 1 на общем стеке (`atlas`, порт 8080, с `web`, quiz, analytics), `smoke.mjs`, браузер и `npm start` — оркестратор.
- `PUT /api/catalog/entities/{id}` + `AtlasContentUpdated` — этап 3, необязательно.
- Отметки в `docs/roadmap.md`, `docs/decisions.md`, отчёт в `stage-1-catalog-gateway.md` — оркестратор.
