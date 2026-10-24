// Подготовка модели ЭПР: Sketchfab glTF → projects/app/public/models/endoplasmic-reticulum/v1/endoplasmic-reticulum.glb
//
// Исходник: «Endoplasmic Reticulum», SourLobster5747, CC BY 4.0 (изменения разрешены).
// Автор уже разметил модель: группы roughER_0 / ribosomesER_1 / smoothER_2, но каждая
// порезана экспортёром на куски по ~22 тыс. треугольников (32 меша), у групп —
// матрицы с поворотом, неравномерным масштабом и отражением. Скрипт:
//   1. Запекает мировую трансформацию каждого куска в вершины и склеивает куски
//      группы в один меш (новые узлы — с единичной матрицей; положение в мире то же).
//   2. Убирает неиспользуемые UV (текстур нет) и нормали, сваривает вершины, упрощает геометрию
//      (meshoptimizer simplify) с заданной долей треугольников и ограничением ошибки,
//      пересчитывает нормали.
//   3. Собирает иерархию как в клетке: EndoplasmicReticulum{RoughER{RoughER_Membrane, Ribosomes}, SmoothER}.
//   4. dedup + prune + meshopt. Без `instance`.
// Встроенные проверки: исходник тот самый; габариты групп в мире не изменились;
// число треугольников после упрощения — в ожидаемых пределах; имена.
//
// Запуск: node tools/prepare-er.mjs <путь>/scene.gltf projects/app/public/models/endoplasmic-reticulum/v1/endoplasmic-reticulum.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, meshopt, joinPrimitives, transformPrimitive, weldPrimitive, simplifyPrimitive, getBounds,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node tools/prepare-er.mjs <scene.gltf> <out.glb>');
  process.exit(1);
}

const GROUPS = [
  // source — узел-группа исходника; name — новый узел с мешем; ratio — доля треугольников после упрощения
  { source: 'roughER_0', name: 'RoughER_Membrane', parts: 15, triangles: 322693, ratio: 0.5 },
  { source: 'ribosomesER_1', name: 'Ribosomes', parts: 4, triangles: 102720, ratio: 0.25 },
  { source: 'smoothER_2', name: 'SmoothER', parts: 13, triangles: 272118, ratio: 0.5 },
];
const TOTAL_TRIANGLES = 697531;
const SIMPLIFY_ERROR = 0.002; // доля размера меша
const BOUNDS_EPS = 5e-3; // доля наибольшего габарита группы: упрощение слегка сдвигает края

function fail(msg) {
  console.error('ПРОВЕРКА НЕ ПРОШЛА:', msg);
  process.exit(1);
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const root = doc.getRoot();

const tri = (p) => (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
const triMesh = (m) => m.listPrimitives().reduce((s, p) => s + tri(p), 0);
const total = () => root.listMeshes().reduce((s, m) => s + triMesh(m), 0);
const findNode = (name) => root.listNodes().find((n) => n.getName() === name) ?? fail(`нет узла "${name}"`);

if (total() !== TOTAL_TRIANGLES) fail(`треугольников ${total()}, ожидалось ${TOTAL_TRIANGLES}`);
const sceneRoot = findNode('GLTF_SceneRootNode');
// Корни Sketchfab (повороты на −90° и +90° по X) взаимно гасятся: мир GLTF_SceneRootNode — единичный.
const w = sceneRoot.getWorldMatrix();
const isIdentity = w.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6);
if (!isIdentity) fail('мировая матрица GLTF_SceneRootNode не единичная');

/** Гладкие нормали по индексированной сетке (взвешены площадью треугольников). */
function smoothNormals(prim) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v] += nx; n[v + 1] += ny; n[v + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n).setBuffer(root.listBuffers()[0]));
}

const scene = root.listScenes()[0];
const results = {};
for (const g of GROUPS) {
  const group = findNode(g.source);
  const children = group.listChildren().filter((c) => c.getMesh());
  if (children.length !== g.parts) fail(`${g.source}: кусков ${children.length}, ожидалось ${g.parts}`);
  const before = getBounds(group);
  let srcTris = 0;
  // 1. запечь мировую трансформацию каждого куска и склеить
  const prims = [];
  for (const child of children) {
    const m = child.getWorldMatrix();
    for (const p of child.getMesh().listPrimitives()) {
      srcTris += tri(p);
      const copy = p.clone();
      transformPrimitive(copy, m);
      prims.push(copy);
    }
  }
  if (srcTris !== g.triangles) fail(`${g.source}: треугольников ${srcTris}, ожидалось ${g.triangles}`);
  let joined = joinPrimitives(prims);
  for (const p of prims) p.dispose();
  // 2. сварка и упрощение. Текстур в модели нет — UV не нужны; нормали пересчитываются
  // после упрощения (иначе разрывы UV/нормалей не дают сварить вершины и упростить сетку).
  for (const sem of ['TEXCOORD_0', 'NORMAL']) {
    const a = joined.getAttribute(sem);
    if (a) {
      joined.setAttribute(sem, null);
      a.dispose();
    }
  }
  weldPrimitive(joined);
  simplifyPrimitive(joined, { simplifier: MeshoptSimplifier, ratio: g.ratio, error: SIMPLIFY_ERROR, lockBorder: false });
  smoothNormals(joined);
  const after = tri(joined);
  if (after > g.triangles * g.ratio * 1.15) fail(`${g.name}: после упрощения ${after} треугольников — упрощение не сработало`);
  if (after < g.triangles * g.ratio * 0.5) fail(`${g.name}: после упрощения ${after} треугольников — слишком грубо`);
  const mesh = doc.createMesh(g.name).addPrimitive(joined);
  const node = doc.createNode(g.name).setMesh(mesh);
  results[g.name] = { node, before, srcTris, after };
  // убрать исходную группу
  for (const child of children) {
    child.getMesh().dispose();
    child.dispose();
  }
  group.dispose();
}

// 3. иерархия
const er = doc.createNode('EndoplasmicReticulum');
const rough = doc.createNode('RoughER');
rough.addChild(results.RoughER_Membrane.node).addChild(results.Ribosomes.node);
er.addChild(rough).addChild(results.SmoothER.node);
sceneRoot.addChild(er);

// проверки: габариты групп в мире не изменились
for (const [name, r] of Object.entries(results)) {
  const now = getBounds(r.node);
  const maxSize = Math.max(...[0, 1, 2].map((i) => r.before.max[i] - r.before.min[i]));
  for (const k of ['min', 'max'])
    for (let i = 0; i < 3; i++) {
      if (Math.abs(now[k][i] - r.before[k][i]) > BOUNDS_EPS * maxSize)
        fail(`${name}: габариты сместились (${k}[${i}] ${r.before[k][i]} → ${now[k][i]})`);
    }
}
const names = new Set(root.listNodes().map((n) => n.getName()));
for (const n of ['EndoplasmicReticulum', 'RoughER', 'RoughER_Membrane', 'Ribosomes', 'SmoothER'])
  if (!names.has(n)) fail(`нет узла "${n}"`);
for (const g of GROUPS) if (names.has(g.source)) fail(`остался исходный узел "${g.source}"`);
if (root.listMeshes().length !== 3) fail(`мешей ${root.listMeshes().length}, ожидалось 3`);

// 4. сжатие
await doc.transform(dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

await io.write(output, doc);
console.log(
  `готово: ${output}; ` +
    Object.entries(results).map(([n, r]) => `${n} ${r.srcTris} → ${r.after}`).join(', ') +
    `; всего ${total()} треугольников, мешей ${root.listMeshes().length}`,
);
