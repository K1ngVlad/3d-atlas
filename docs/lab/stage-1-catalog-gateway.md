# Этап 1. Catalog + Gateway + клиент через API (18–19.11)

Прочитай перед началом: `docs/lab/README.md`, `docs/lab/contracts.md` (разделы Catalog, Gateway, Consul, Клиент), `docs/05-manifest.md` (форма манифеста и `detail`), `docs/03-frontend-architecture.md` (репозиторий за токеном).

**Результат этапа:** приложение открывается на `http://localhost:8080`, атлас работает как раньше, но манифесты и контент приходят из `catalog_db`, а модели — из MinIO через gateway. Связка YARP + Consul — самое рискованное место плана, поэтому она идёт первой.

Пункты с ⚠ — уроки первой итерации.

## Задачи

### 1.1 Catalog: модель данных и seed
- [x] EF Core: 5 сущностей и связи по `contracts.md`, первая миграция, применение миграций при старте (с ожиданием готовности БД).
- [x] Seed БД из `/seed` (том `../projects/app/public:/seed:ro` в compose) по шагам из `contracts.md`. ⚠ Весь seed БД — под `pg_advisory_xact_lock`, проверка «уже заполнено» — после захвата блокировки (иначе два экземпляра на пустой БД сеют одновременно и падают на PK). Одна транзакция; повторный старт ничего не меняет.
- [x] ⚠ Синхронизация моделей с MinIO — **отдельный шаг при каждом старте**, не внутри проверки «БД уже заполнена»: бакет, политика анонимного чтения через S3 API, загрузка `.glb` с пропуском существующих; ретраи; не удалось → `LogError` и `/health` → `503`, пока не пройдёт.
- [x] Лог итога seed: сколько сущностей, манифестов, частей, моделей; ⚠ счётчик созданных сущностей-заглушек — фактический (возвращать признак из метода создания, а не проверять множество после того, как сам в него добавил).
- [x] ⚠ Не писать в комментариях «preserve key order» про `jsonb` — он порядок ключей не сохраняет; контракт требует равенства по содержимому.

### 1.2 Catalog: API
- [x] Эндпоинты из `contracts.md` (кроме `PUT` — он на этапе 3, необязательный). `manifests/{id}` отдаёт `body` как `application/json` без пересериализации на лету.
- [x] `entities/{id}` собирает `EntityContent` в формате файлов контента (`title: { ru }`, `summary: { ru }`, `sources`).
- [x] OpenAPI-документ сервиса доступен в dev.
- [x] Тесты (xUnit; Testcontainers.PostgreSql или реальная БД): (1) после seed `manifests/animal-cell` равен исходному файлу **по содержимому** (`JsonNode.DeepEquals`); (2) `404` для несуществующего; (3) `detail` в виде `{id, focus}` разбирается в `scene_parts`. ⚠ Если образ ryuk не тянется из-за сети — `.testcontainers.properties` с `ryuk.disabled=true`.

### 1.3 Gateway
- [x] `ConsulProxyConfigProvider` (`IProxyConfigProvider`) + фоновая служба: запрашивает `/v1/health/service/{name}?passing=true` для кластеров с метаданными `Consul: true`; ⚠ первый опрос — **сразу при старте** (не после первого тика таймера: иначе первые ~6 с всё `/api/*` отдаёт 503), дальше раз в 5 с; при изменении набора адресов публикует новую конфигурацию через change token. Статические кластеры (`minio`, `web`) не трогает. Балансировка `RoundRobin`.
- [x] Нет экземпляров → `503` с JSON-ошибкой. Consul недоступен → держать последний известный набор адресов и предупреждение в лог.
- [x] `/models/**` проксируется в MinIO без изменения пути. Проверить, что `Content-Length` доходит до клиента (на нём держится прогресс загрузки модели в ядре).

### 1.4 Клиент
- [x] `environments` + `fileReplacements` по `contracts.md` («Клиент»); docker-сборка и `npm start` — `api`, запасная конфигурация `assets`.
- [x] `provideHttpClient(withFetch())`; `HttpStructureRepository` с кэшем промисов; провайдер `STRUCTURE_REPO` по `dataSource`.
- [x] `projects/app/proxy.conf.json` и `proxyConfig` в `angular.json` (dev-сервер).
- [x] `sandbox` можно оставить на статике (он для отладки) — отметить в отчёте.
- [x] Unit-тест `HttpStructureRepository` на `HttpTestingController`: `404` → `null` / `false`, успешный `getManifest` → `parseManifest`.

## Проверка

Выполнить на запущенном стеке; в «Отчёт» — результат каждого пункта.

1. `docker compose down -v && docker compose up -d --build`; в логах Catalog — итог seed без ошибок; в MinIO — бакет `models` с 4 `.glb`.
2. `http://localhost:8080` → атлас клетки; в Network манифест и контент идут на `/api/catalog/...`, модель — на `/models/...`, прогресс загрузки работает.
3. Переход в детальные модели (митохондрия, Гольджи, ЭПР) и обратно — как до изменений.
4. `curl -i localhost:8080/api/catalog/manifests/animal-cell` — `200` + `X-Instance`; `.../manifests/nope` → `404`.
5. `docker compose up -d --scale catalog=2` → повторные запросы дают разные `X-Instance`; `docker stop` одного экземпляра → запросы продолжают проходить (≤ ~10 с на обнаружение).
6. Перезапуск только MinIO с чистым томом (`docker compose rm -sv minio` + up) при живой БД → после старта Catalog модели снова в бакете (синхронизация при каждом старте).
7. `npm start` (dev) при запущенном compose — атлас работает через прокси.
8. `smoke.mjs` дополнен: `GET /api/catalog/manifests/animal-cell` (200 + `X-Instance`), `GET /api/catalog/entities/mitochondrion` (`title.ru`), `HEAD /models/<model.url манифеста>` (200 + `Content-Length`), `GET .../manifests/nonexistent` → 404. Проходит.
9. Коммиты по задачам, **`git push`** выполнен.

## Отчёт
Ветка `lab-backend`. Работа велась параллельно в отдельных ветках по сервисам и слита в `lab-backend` 17.11.2026 без конфликтов. Подробные отчёты сессий (что сделано, юнит-тесты, отклонения, изменения контракта): `docs/lab/reports/`. Решения — `docs/decisions.md`, 47–61.

Общая проверка: `cd deploy && docker compose down -v && docker compose up -d --build` → все 9 контейнеров `Up`; `node smoke.mjs` → 16/16 OK, код 0 (gateway, Consul, Catalog, MinIO, полный проход Quiz, рост `answersTotal` в Analytics).

Отчёт сессии: `docs/lab/reports/catalog-gateway.md` (там же пункт 4.1 — пассивные проверки и повтор GET в gateway).

### Результаты проверки
1. Чистый запуск → лог Catalog `Catalog seed done: 27 entities from content + 0 stub entities, 5 manifests, 27 parts, 4 models`, `MinIO model sync done: 4 uploaded, 0 already present`. Шум `libgssapi_krb5.so.2` от Npgsql безвреден.
2. Браузер `http://localhost:8080` → атлас клетки; Resource Timing: `/api/catalog/manifests/animal-cell`, `/models/animal-cell/v1/animal-cell.glb`, `/api/catalog/entities/*`, `/api/catalog/manifests/{nucleus,endoplasmic-reticulum,golgi,mitochondrion}`.
3. `/atlas/animal-cell/mitochondrion` → детальная модель митохондрии со сносками и составом. Полный проход «туда-обратно» по всем детальным моделям глазами не делал.
4. `smoke.mjs`: `manifests/animal-cell` → `200`, `X-Instance`; `manifests/nonexistent` → `404`.
5. `--scale catalog=2` → 4 запроса: `X-Instance` чередуются (`2f42093c168f` / `a09b34ce454d`). 80 запросов каждые 100 мс, в процессе `docker stop` второго экземпляра → **80 × 200**.
6. `docker compose rm -sfv minio` + `docker volume rm atlas_minio-data` + `up minio` + `restart catalog` → `already seeded; skipping`, `MinIO model sync done: 4 uploaded`; `HEAD /models/golgi/v1/golgi.glb` → `200`, `Content-Length: 379080`.
7. `npm start` (dev-прокси) на этом стеке **не проверялся**; сессия клиента проверила прокси на моке gateway.
8. `smoke.mjs` дополнен всеми пунктами этапа (плюс этапы 2–3) — проходит.
9. Коммиты по задачам в ветке сервиса, merge в `lab-backend`, push.

### Отклонения
AWSSDK.S3 вместо Minio SDK (решение 47); окно пассивных проверок 10 с (решение 50); `sandbox` остался на статике. Остальное — в отчёте сессии.
