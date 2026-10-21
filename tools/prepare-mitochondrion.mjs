// Подготовка модели митохондрии: Sketchfab glTF → projects/app/public/models/mitochondrion/v1/mitochondrion.glb
//
// Только ТЕХНИЧЕСКИЕ изменения (лицензия CC BY-NC-ND 4.0 запрещает распространять
// адаптации; п. 2(a)(4) разрешает технические изменения для другого формата):
//   - текстуры 4096 → 2048, PNG → WebP;
//   - dedup / prune / meshopt-сжатие геометрии.
// Имена узлов, иерархия, материалы, геометрия НЕ меняются — разметка частей
// целиком в манифесте (docs/models/mitochondrion.md).
//
// Запуск: node tools/prepare-mitochondrion.mjs <путь>/scene.gltf projects/app/public/models/mitochondrion/v1/mitochondrion.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node tools/prepare-mitochondrion.mjs <scene.gltf> <out.glb>');
  process.exit(1);
}

const TEXTURE_SIZE = 2048;
const EXPECT = {
  triangles: 45639,
  meshes: 13,
  // узлы, на которые ссылается манифест mitochondrion.json
  nodes: [
    'shell', 'cristae', 'matrix',
    'dna_01', 'dna_02', 'dna_03',
    'granule_0000', 'granule_0001', 'granule_0002', 'granule_0003',
    'granule_0004', 'granule_0005', 'granule_0006',
  ],
};

function fail(msg) {
  console.error('ПРОВЕРКА НЕ ПРОШЛА:', msg);
  process.exit(1);
}

function snapshot(doc) {
  const root = doc.getRoot();
  const names = root.listNodes().map((n) => n.getName()).sort();
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      triangles += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  const parents = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parents.set(c.getName(), n.getName());
  return { names, triangles, meshes: root.listMeshes().length, parents };
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(input);
const before = snapshot(doc);

// Проверки исходника: это именно та модель, под которую написан манифест.
if (before.triangles !== EXPECT.triangles) fail(`треугольников ${before.triangles}, ожидалось ${EXPECT.triangles}`);
if (before.meshes !== EXPECT.meshes) fail(`мешей ${before.meshes}, ожидалось ${EXPECT.meshes}`);
for (const n of EXPECT.nodes) if (!before.names.includes(n)) fail(`нет узла "${n}"`);

await doc.transform(
  dedup(),
  prune({ keepLeaves: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

const after = snapshot(doc);
// Технические изменения не должны трогать структуру.
if (after.triangles !== before.triangles) fail(`треугольники изменились: ${before.triangles} → ${after.triangles}`);
if (JSON.stringify(after.names) !== JSON.stringify(before.names)) fail('изменились имена узлов');
for (const [child, parent] of before.parents) {
  if (after.parents.get(child) !== parent) fail(`узел "${child}" сменил родителя`);
}
for (const tex of doc.getRoot().listTextures()) {
  if (tex.getMimeType() !== 'image/webp') fail(`текстура ${tex.getName()} не WebP`);
  const [w, h] = tex.getSize() ?? [0, 0];
  if (w > TEXTURE_SIZE || h > TEXTURE_SIZE) fail(`текстура ${tex.getName()} ${w}×${h}`);
}

await io.write(output, doc);
console.log(`готово: ${output}; треугольников ${after.triangles}, узлов ${after.names.length}, текстур ${doc.getRoot().listTextures().length}`);
