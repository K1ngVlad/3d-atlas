import { z } from 'zod';
import { ManifestError } from './errors';

export const PickModeSchema = z.enum(['select', 'pass', 'block']);
export const SelectModeSchema = z.enum(['whole', 'each']);

export const NodeSelectorSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.object({ match: z.string() }).passthrough(),
]);

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const MaterialOverrideSchema = z
  .object({
    opacity: z.number().optional(),
    color: z.string().optional(),
    emissive: z.string().optional(),
    transmission: z.number().optional(),
  })
  .passthrough();

export const DetailRefSchema = z.union([
  z.string(),
  z.object({ id: z.string(), focus: z.string().optional() }).passthrough(),
]);

export const LabelSchema = z
  .object({
    anchor: z.union([z.literal('auto'), Vec3Schema]).optional(),
    hidden: z.boolean().optional(),
    instance: z.string().optional(),
    each: z.boolean().optional(),
  })
  .passthrough();

export const PartSchema = z
  .object({
    id: z.string(),
    entity: z.string().optional(),
    nodes: NodeSelectorSchema,
    pick: PickModeSchema.optional(),
    select: SelectModeSchema.optional(),
    hoverable: z.boolean().optional(),
    material: MaterialOverrideSchema.optional(),
    detail: DetailRefSchema.optional(),
    label: LabelSchema.optional(),
  })
  .passthrough();

export const DefaultsSchema = z
  .object({
    pick: PickModeSchema.optional(),
    select: SelectModeSchema.optional(),
    hoverable: z.boolean().optional(),
  })
  .passthrough();

export const ModelSchema = z
  .object({
    url: z.string(),
    upAxis: z.enum(['y', 'z']).optional(),
    scale: z.number().optional(),
  })
  .passthrough();

export const CameraSchema = z
  .object({
    fit: z.literal('auto').optional(),
    position: Vec3Schema.optional(),
    target: Vec3Schema.optional(),
    minDistance: z.number().optional(),
    maxDistance: z.number().optional(),
  })
  .passthrough();

export const SceneManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    status: z.enum(['ready', 'stub']).optional(),
    entity: z.string().optional(),
    model: ModelSchema,
    camera: CameraSchema.optional(),
    defaults: DefaultsSchema.optional(),
    parts: z.array(PartSchema),
    include: NodeSelectorSchema.optional(),
    ignore: z.array(z.object({ match: z.string() }).passthrough()).optional(),
  })
  .passthrough();

export type Vec3 = z.infer<typeof Vec3Schema>;
export type NodeSelector = z.infer<typeof NodeSelectorSchema>;
export type PickMode = z.infer<typeof PickModeSchema>;
export type SelectMode = z.infer<typeof SelectModeSchema>;
export type MaterialOverride = z.infer<typeof MaterialOverrideSchema>;
export type DetailRef = z.infer<typeof DetailRefSchema>;
export type LabelDef = z.infer<typeof LabelSchema>;
export type PartDef = z.infer<typeof PartSchema>;
export type CameraDef = z.infer<typeof CameraSchema>;
export type SceneManifest = z.infer<typeof SceneManifestSchema>;

export function parseManifest(input: unknown): SceneManifest {
  const result = SceneManifestSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') || '<root>';
    throw new ManifestError(`Manifest validation failed at "${path}": ${first?.message}`, result.error.issues);
  }
  return result.data;
}

export function detailId(ref: DetailRef | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

export function detailFocus(ref: DetailRef | undefined): string | null {
  if (!ref || typeof ref === 'string') return null;
  return ref.focus ?? null;
}
