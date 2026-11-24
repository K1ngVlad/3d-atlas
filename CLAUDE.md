# Атлас клетки — обучающая 3D-платформа

Веб-приложение для наглядного изучения строения клеток человека (позже — органов и систем) на интерактивных 3D-моделях. Делается для студентов медицинского университета; одновременно это проект лабораторной работы по высоконагруженным приложениям и основа дипломной работы.

Отвечай на русском. Идентификаторы в коде, имена файлов и коммиты — на английском.

## Текущее состояние (24.11.2026)

- **Клиент:** атлас клетки (десктоп) — просмотр, выбор, сноски, расслоение, детальные модели митохондрии, Гольджи, ЭПР; экраны «Тесты» и «Аналитика».
- **Бэкенд лабораторной реализован** (этапы 0–4, `docs/lab/`): API Gateway (YARP) + Consul, Catalog (C#), Quiz (NestJS), Analytics (FastAPI), RabbitMQ, PostgreSQL (три БД), MinIO; запуск одной командой `docker compose`. Клиент по умолчанию берёт данные из Catalog через gateway (`dataSource: 'api'`), запасной режим — статика из `public/` (`npm run start:assets`).
- **Ветка:** вся работа лабораторной — в `lab-backend` (в `main` ещё не слита).
- **Не сделано:** Redis, `AtlasContentUpdated`, пользователи и роли, мобильная версия, загрузка моделей — см. `docs/roadmap.md` и «Потом» в `docs/lab/README.md`.

## Где искать контекст

Перед работой над задачей прочитай документ, который к ней относится:

| Тема | Документ |
|---|---|
| Что за продукт, для кого, ограничения | `docs/01-product.md` |
| Экраны, взаимодействия, состояния (десктоп и мобильная версия) | `docs/02-ux-spec.md` |
| Архитектура Angular-приложения, слои, состояние, зависимости | `docs/03-frontend-architecture.md` |
| 3D-ядро `viewer-core`: API, выбор, расслоение, сноски | `docs/04-viewer-core.md` |
| Формат манифеста сцены и подключение новых моделей | `docs/05-manifest.md` |
| Исходный замысел бэкенда (до реализации; полная версия с Redis, k6, авторизацией) | `docs/06-backend.md` |
| **Как устроен бэкенд сейчас**: компоненты, взаимодействия, ER-диаграммы БД | `docs/lab/architecture.md` |
| Запуск стенда, адреса UI, учётные данные | `deploy/README.md` |
| Сценарий демонстрации | `docs/lab/demo.md` |
| Сводка проекта одним файлом (для чатов без доступа к репозиторию) | `docs/project-context.md` |
| Модели, источники, лицензии | `docs/07-models-and-licensing.md` |
| Разбор конкретной модели (части, имена узлов, подготовка) | `docs/models/<model>.md` |
| Лабораторная: план, контракты API/событий/БД, этапы и отчёты | `docs/lab/README.md`, `docs/lab/contracts.md`, `docs/lab/stage-*.md` |
| Принятые решения и почему (не пересматривать без причины) | `docs/decisions.md` |
| План работ и текущий этап | `docs/roadmap.md` |

## Стек

- Angular (актуальная версия), standalone-компоненты, сигналы, OnPush, zoneless.
- SCSS, Angular Material + CDK для стандартных элементов.
- 3D: three.js, camera-controls, three-mesh-bvh, gsap.
- Валидация манифестов: zod.
- Тесты: Vitest для `viewer-core` и сервисов, Playwright для сквозных сценариев.
- Бэкенд (`services/`): gateway — C#/.NET 10 + YARP; catalog — C#/.NET 10, ASP.NET Core, EF Core + Npgsql, AWSSDK.S3; quiz — TypeScript, NestJS 12 (Fastify), Prisma 7, amqplib; analytics — Python 3.12, FastAPI, SQLAlchemy async, aio-pika. Инфраструктура: PostgreSQL 18, RabbitMQ 4.4, Consul 1.22, MinIO (`pgsty/minio`).

## Структура

```
projects/
  viewer-core/   # чистый TypeScript + three.js, БЕЗ Angular
  app/           # Angular-приложение
    public/      # статика, раздаётся с корня сайта (model.url в манифесте — относительно неё)
      models/    # .glb
      manifests/ # манифесты сцен (JSON)
      content/   # тексты сущностей (JSON)
tools/           # скрипты подготовки моделей (prepare-*, inspect)
services/        # микросервисы лабораторной: gateway/, catalog/, quiz/, analytics/ (тесты — внутри каждого)
deploy/          # docker-compose.yml, .env.example, postgres/init.sh, smoke.mjs, README.md
docs/
```

## Жёсткие правила

1. `projects/viewer-core` никогда не импортирует `@angular/*` и ничего из `projects/app`. Ядро общается с приложением только через свой публичный API (`public-api.ts`).
2. В `viewer-core` нет знаний о предметной области (клетки, органоиды). Всё предметное приходит из манифеста и контента.
3. Компоненты не получают данные напрямую (`HttpClient`, `fetch`): только через сервисы и репозитории за `InjectionToken`.
4. Рендер-цикл three.js не должен запускать обнаружение изменений Angular.
5. Состояние уровня просмотра (камера, режимы, выбор) сохраняется явно через `getViewState` / `restoreViewState`. Позиции частей при расслоении всегда вычисляются из манифеста, а не из текущего положения мешей.
6. Новый формат или поле манифеста — сначала обновить схему zod и `docs/05-manifest.md`, потом код.
7. У каждой модели должны быть автор, ссылка и лицензия в манифесте (`source`).
8. Механизм детальных уровней не зависит от наличия детальных моделей: сейчас они — заглушки (`status: "stub"`) на модели клетки. Добавление модели не должно требовать изменений кода. Подробности — `docs/05-manifest.md`, «Детальные уровни».
9. Модели готовятся скриптами в `tools/` со встроенными проверками; исходники моделей в репозиторий не кладутся. Текущая модель: `docs/models/animal-cell.md`.

## Команды

```
npm start              # dev-сервер (API через прокси на gateway :8080, нужен docker compose)
npm run start:assets   # dev-сервер без бэкенда (манифесты и модели из public/)
npm test               # тесты приложения
npm run test:core      # тесты viewer-core (Vitest)
npm run lint

# стенд лабораторной (из deploy/, нужен Docker Desktop)
cp .env.example .env           # один раз
docker compose up -d --build   # всё целиком; адреса и пароли — deploy/README.md
node smoke.mjs                 # сквозная проверка через gateway

# тесты сервисов
dotnet test services/catalog/tests/Catalog.Tests
dotnet test services/gateway/tests/Gateway.Tests
cd services/quiz && npm test
cd services/analytics && python -m pytest -q   # БД-тесты — с TEST_DATABASE_URL (см. docs/lab/reports/analytics-service.md)
```

Скрипт подготовки модели: `node tools/prepare-animal-cell.mjs <scene.gltf> <out.glb>` (нужны devDependencies `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer` — см. roadmap, этап 1).

Обновляй этот раздел, когда меняются скрипты в `package.json`.
