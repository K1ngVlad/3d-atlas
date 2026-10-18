# Архитектура клиента

## Общая схема

```
app  ──зависит от──▶  viewer-core  ──зависит от──▶  three
 ▲                          ✗
 └──── ядро никогда не импортирует app и @angular/*
```

- `projects/viewer-core` — 3D-ядро на чистом TypeScript. Описано в `docs/04-viewer-core.md`.
- `projects/app` — Angular-приложение: экраны, UI, состояние, данные.
- Стык между ними — слой-адаптер `app/src/app/viewer/`.

Граница обеспечивается правилом ESLint `no-restricted-imports` для файлов `projects/viewer-core/**`: запрещены `@angular/*` и пути в `projects/app`.

Ядро подключается в приложение по алиасу `@atlas/viewer-core` через `paths` в `tsconfig.json`, указывающему на исходники (`projects/viewer-core/src/public-api.ts`), а не на собранный `dist`.

## Структура приложения

```
projects/app/src/app/
├─ core/                  # синглтоны уровня приложения
│  ├─ config/             # настройки окружения
│  ├─ error-handling/
│  └─ layout/             # шапка, меню, общий каркас
├─ data-access/
│  ├─ repositories/       # StructureRepository + реализации
│  ├─ model-cache.service.ts  # кэш моделей на устройстве (FetchModel для ядра)
│  └─ atlas.store.ts      # состояние экрана атласа
├─ viewer/                # адаптер Angular ↔ viewer-core
│  ├─ viewer.service.ts
│  ├─ viewer-host.component.ts
│  └─ label-layer.component.ts
├─ shared/ui/             # переиспользуемые «глупые» компоненты
│  ├─ bottom-sheet/
│  ├─ breadcrumbs/
│  ├─ view-toolbar/
│  └─ info-panel/
└─ features/
   ├─ atlas/              # экран атласа (делаем сейчас)
   ├─ quiz/               # позже
   ├─ upload/             # позже
   └─ analytics/          # позже
```

Каждая фича лениво грузится по маршруту.

## Принципы

### Smart / presentational
- Страница фичи (smart) берёт данные из сторов и сервисов, раздаёт их вниз через `input()`, получает события через `output()`.
- Компоненты из `shared/ui` ничего не знают о сервисах и сторах.

### Состояние
- Сигналы для состояния, RxJS для потоков событий во времени (HTTP, события ядра), мост `toSignal()` / `toObservable()`.
- Состояние экрана атласа живёт в `AtlasStore` (сервис на сигналах):
  - `viewStack: ViewLevel[]` — стек уровней; у каждого `manifestId` и сохранённый `ViewState`;
  - `current` — текущий уровень (computed);
  - `selectedPartId`;
  - `options` — сноски, расслоение, подсветка, изоляция;
  - `panelOpen`;
  - `loading` — прогресс и ошибка загрузки.
- NgRx SignalStore не используем, пока обычного сервиса хватает.

### Данные: репозиторий за токеном
```ts
export interface StructureRepository {
  getManifest(id: string): Observable<SceneManifest>;
  getEntity(id: string): Observable<EntityContent>;
}
export const STRUCTURE_REPO = new InjectionToken<StructureRepository>('STRUCTURE_REPO');
```
- Сейчас: `AssetsStructureRepository` читает JSON из `projects/app/public/manifests` и `projects/app/public/content`.
- Для лабораторной: `HttpStructureRepository` ходит в API Gateway. Подмена — одна строка в провайдерах.

### Маршрутизация и стек уровней
- Маршрут отражает путь в иерархии: `/atlas/:rootId/*path`, например `/atlas/cell/mitochondrion`.
- `AtlasStore` синхронизируется с роутером: переход вглубь кладёт `ViewState` текущего уровня в стек; возврат (кнопка, крошка, «назад» браузера) восстанавливает его.
- При прямом заходе по ссылке на глубокий уровень стек строится из пути, состояния уровней — по умолчанию.

### Адаптер ядра
- `ViewerService` создаёт экземпляр `Viewer`, превращает его события в сигналы, передаёт команды из `AtlasStore`.
- `ViewerHostComponent` владеет `<canvas>`, следит за размером через `ResizeObserver`, передаёт отступы от панели и шторки в `setViewportInsets`.
- `LabelLayerComponent` рисует сноски HTML-элементами по экранным позициям, которые отдаёт ядро. Ядро решает, *где* сноска и видна ли она; Angular — *как* она выглядит (текст, номер, значок лупы).
- Рендер-цикл не запускает обнаружение изменений Angular (zoneless; при наличии zone.js — `NgZone.runOutsideAngular`).
- Позиции сносок обновляются каждый кадр — их нельзя гонять через сигналы и шаблон на каждый кадр. `LabelLayerComponent` создаёт элементы через шаблон, а позицию выставляет напрямую через `transform` по событию ядра.

### Кэш моделей

Постоянный кэш загруженных моделей на устройстве, чтобы повторные открытия были мгновенными и работали без сети (слабая сеть в аудиториях), а сервер не отдавал одни и те же файлы повторно.

- **Где:** сервис `ModelCacheService` в `data-access/` реализует `FetchModel` и передаётся ядру через `createViewer(canvas, { fetchModel })`. Ядро о кэше не знает (`docs/04-viewer-core.md`).
- **Хранилище:** Cache Storage API (`caches.open('models-v1')`), а не IndexedDB: оно хранит готовые HTTP-ответы, кода меньше, квота та же.
- **Стратегии:**
  - модели (`/models/**`) — **cache-first, навсегда**: версия зашита в путь (`.../v1/...`), новая версия — новый адрес, устаревших данных не бывает;
  - манифесты и контент — **network-first**, кэш только как запасной вариант без сети (маленькие и меняются).
- **Место:** перед записью `navigator.storage.estimate()`; если места мало — загрузка без кэша (не ошибка). Один раз запросить `navigator.storage.persist()`; отказ браузера — нормальный случай.
- **Очистка:** при старте удалять из кэша модели, на которые не ссылается ни один актуальный манифест (старые версии).
- **Прогресс:** при попадании в кэш загрузка мгновенная; при загрузке из сети — прогресс по `Content-Length`, ответ одновременно пишется в кэш (`response.clone()`).
- **Отключение:** в dev-режиме кэш выключен (модели часто меняются), включается флагом в конфиге окружения.
- **Ошибки:** любая ошибка кэша (нет API, квота, приватный режим) → тихий откат на обычную загрузку из сети.
- **Позже:** если приложение станет PWA, можно перейти на `@angular/service-worker` (`assetGroups` для моделей с `installMode: lazy`, `dataGroups` для манифестов), и `ModelCacheService` станет не нужен.

## Стилизация

- SCSS, модульная система `@use` / `@forward` (не `@import`).
- Дизайн-токены — CSS custom properties в `styles/tokens.scss`, генерируемые из SCSS-карт; компоненты используют только переменные.
- Тема Angular Material подстраивается под токены.
- Базовые токены из макетов:
  - фон приложения `#F6F8FA`, фон холста `#E8EDF2`, поверхности `#FFFFFF`, границы `#DCE2E8`;
  - текст `#17212B`, вторичный `#33404C` / `#52606D`;
  - акцент `#1D6A85`, акцент тёмный `#134B5F`, акцентный фон `#E3F0F5`;
  - шрифт IBM Plex Sans; радиусы 8–14 px, у сносок 999 px;
  - цели касания не меньше 44 px.

## UI-компоненты

| Компонент | Реализация |
|---|---|
| Шапка, меню | `MatToolbar`, `MatSidenav` или CDK Overlay |
| Панель вида | `MatButtonToggle` / `MatIconButton` + `MatTooltip` |
| Прогресс загрузки | `MatProgressSpinner` (determinate) |
| Список состава | `MatList` или кнопки |
| Правая панель | своя (flex-блок с анимацией) |
| Хлебные крошки | своя |
| Сноски | своя (`LabelLayerComponent`) |
| Мобильная шторка | своя на Pointer Events + CDK; `MatBottomSheet` не подходит: нет перетаскивания и точек остановки |

## Зависимости

| Пакет | Зачем |
|---|---|
| `three` | движок; `GLTFLoader`, `DRACOLoader`, `KTX2Loader`, meshopt-декодер |
| `camera-controls` | орбита, плавный подлёт к объекту, сенсорное управление |
| `three-mesh-bvh` | быстрый raycast по тяжёлым моделям |
| `gsap` | анимации расслоения и переходов |
| `zod` | схема и валидация манифеста |
| `@angular/material`, `@angular/cdk` | UI |
| `@gltf-transform/cli`, `@gltf-transform/core` | dev: оптимизация и инспекция моделей |
| `vitest`, `@playwright/test`, `angular-eslint` | качество |
