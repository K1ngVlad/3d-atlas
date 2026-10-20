import { detailId as coreDetailId, type DetailRef } from '@atlas/viewer-core';

export function readDetailId(ref: unknown): string | null {
  return coreDetailId(ref as DetailRef | undefined);
}
