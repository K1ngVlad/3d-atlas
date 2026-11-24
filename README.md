# Атлас клетки — обучающая 3D-платформа

Веб-приложение для наглядного изучения строения клетки человека на интерактивных 3D-моделях: студент вращает и приближает модель, выбирает органоиды, читает описание, переходит к детальной модели органоида, проходит тесты по моделям. Делается для студентов медицинского университета; одновременно — лабораторная работа по высоконагруженным приложениям и основа дипломной работы.

## Возможности

- **Атлас** — 3D-модель животной клетки и детальные модели митохондрии, аппарата Гольджи, ЭПР; выбор частей, сноски, расслоение, изоляция, справочная панель, навигация по уровням с сохранением вида.
- **Тесты** — вопросы «Что выделено на модели?» (камера подлетает к части, остальное приглушается) и обычные вопросы с одним / несколькими ответами; после ответа — описание органоида.
- **Аналитика** — сводка по попыткам, самые трудные органоиды, статистика по вопросам; обновляется в реальном времени.

## Архитектура

```
Браузер ─▶ API Gateway (YARP, :8080) ─┬─▶ Catalog   (C#, ASP.NET Core)  ─▶ PostgreSQL catalog_db
            адреса из Consul          ├─▶ Quiz      (TypeScript, NestJS) ─▶ PostgreSQL quiz_db
                                      ├─▶ Analytics (Python, FastAPI)    ─▶ PostgreSQL analytics_db
                                      ├─▶ MinIO (модели .glb)
                                      └─▶ web (собранный Angular)
Quiz ──REST (адрес из Consul)──▶ Catalog
Quiz ──RabbitMQ quiz.events──▶ Analytics
```

Клиент — Angular (standalone, сигналы, zoneless) и отдельное 3D-ядро `viewer-core` на three.js без Angular. Подробно: [docs/lab/architecture.md](docs/lab/architecture.md).

## Быстрый старт

Нужны Docker Desktop и Node.js 18+.

```
cd deploy
cp .env.example .env
docker compose up -d --build
node smoke.mjs
```

Приложение — http://localhost:8080. Адреса Consul, RabbitMQ, MinIO и учётные данные — [deploy/README.md](deploy/README.md). Сценарий демонстрации — [docs/lab/demo.md](docs/lab/demo.md).

Только клиент, без бэкенда:

```
npm install
npm run start:assets   # http://localhost:4200, данные и модели из projects/app/public
```

## Структура

```
projects/viewer-core/  3D-ядро (TypeScript + three.js)
projects/app/          Angular-приложение; public/ — модели, манифесты, тексты
services/              gateway, catalog, quiz, analytics
deploy/                docker compose, smoke-тест, инструкция по запуску
tools/                 скрипты подготовки моделей
docs/                  продукт, UX, архитектура, манифест, решения, план; docs/lab — лабораторная
```

## Документация

| Тема | Документ |
|---|---|
| Сводка проекта одним файлом | [docs/project-context.md](docs/project-context.md) |
| Продукт и ограничения | [docs/01-product.md](docs/01-product.md) |
| Экраны и взаимодействия | [docs/02-ux-spec.md](docs/02-ux-spec.md) |
| Архитектура клиента | [docs/03-frontend-architecture.md](docs/03-frontend-architecture.md) |
| 3D-ядро | [docs/04-viewer-core.md](docs/04-viewer-core.md) |
| Формат манифеста сцены | [docs/05-manifest.md](docs/05-manifest.md) |
| Бэкенд: архитектура, БД, контракты | [docs/lab/architecture.md](docs/lab/architecture.md), [docs/lab/contracts.md](docs/lab/contracts.md) |
| Модели и лицензии | [docs/07-models-and-licensing.md](docs/07-models-and-licensing.md) |
| Принятые решения | [docs/decisions.md](docs/decisions.md) |
| План работ | [docs/roadmap.md](docs/roadmap.md) |

## Разработка

```
npm start              # клиент с прокси /api и /models на gateway :8080 (нужен docker compose)
npm test               # тесты приложения
npm run test:core      # тесты viewer-core
npm run lint
```

Модели взяты из открытых источников; автор, ссылка и лицензия каждой модели указаны в её манифесте и в [docs/07-models-and-licensing.md](docs/07-models-and-licensing.md).
