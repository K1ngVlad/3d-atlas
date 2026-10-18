export { createViewer } from './viewer';
export type {
  Viewer,
  ViewerConfig,
  ViewerEvent,
  LabelPosition,
  Selection,
  ViewerOptions,
  ViewState,
} from './viewer';
export type { FetchModel } from './scene/fetch-model';
export { parseManifest, detailId, detailFocus } from './manifest/schema';
export type {
  SceneManifest,
  PartDef,
  NodeSelector,
  PickMode,
  SelectMode,
  CameraDef,
  MaterialOverride,
  DetailRef,
  LabelDef,
  Vec3,
} from './manifest/schema';
export { ManifestError, ViewerError } from './manifest/errors';
export type { ViewerErrorCode } from './manifest/errors';
