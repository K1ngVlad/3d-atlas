export class ManifestError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = 'ManifestError';
  }
}

export type ViewerErrorCode =
  | 'manifest-invalid'
  | 'model-fetch-failed'
  | 'model-parse-failed'
  | 'view-state-manifest-mismatch'
  | 'load-aborted';

export class ViewerError extends Error {
  constructor(readonly code: ViewerErrorCode, message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'ViewerError';
  }
}
