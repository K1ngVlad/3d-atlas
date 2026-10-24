// Подготовка модели аппарата Гольджи: Sketchfab glTF → projects/app/public/models/golgi/v1/golgi.glb
//
// Исходник: «Golgi Apparatus/Complex», MajoraMaster, CC BY 4.0 (изменения разрешены).
// В исходнике два склеенных меша: все цистерны (GA) и все пузырьки (vesicles).
// Скрипт:
//   1. Делит оба меша на связные куски (сварка вершин по позиции).
//   2. Цистерны (8) упорядочивает вдоль оси стопки (X): 1–2 — цис, 3–6 — срединные, 7–8 — транс.
//   3. Пузырьки (22) делит по стороне стопки: со стороны цистерны 1 — транспортные (цис),
//      со стороны цистерны 8 — секреторные (транс). Какая сторона цис — предположение
//      по форме пузырьков (крупные вытянутые = секреторные), см. docs/models/golgi.md;
//      поменять — CIS_SIDE ниже.
//   4. Собирает иерархию Cisternae{Cis,Medial,Trans}, Vesicles{Cis,Trans}; трансформации
//      исходных узлов сохраняются (группы Cisternae / Vesicles получают матрицы GA / vesicles).
//   5. dedup + prune + meshopt. Без `instance`.
// Встроенные проверки: число кусков, баланс треугольников, число пузырьков по сторонам, имена.
//
// Запуск: node tools/prepare-golgi.mjs <путь>/scene.gltf projects/app/public/models/golgi/v1/golgi.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node tools/prepare-golgi.mjs <scene.gltf> <out.glb>');
  process.exit(1);
}

/** -1: цис-сторона — меньшие X (сторона цистерны с наименьшим X); +1 — наоборот. */
const CIS_SIDE = -1;

const EXPECT = {
  triangles: 52672,
  cisternae: 8,
  cisternaeTriangles: 45632,
  vesicles: 22,
  vesicleTriangles: 7040,
  cisVesicles: 7,
  transVesicles: 15,
};
const GROUPS = { cis: [1, 2], medial: [3, 4, 5, 6], trans: [7, 8] };

function fail(msg) {
  console.error('ПРОВЕРКА НЕ ПРОШЛА:', msg);
  process.exit(1);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

function countTriangles() {
  let t = 0;
  for (const m of root.listMeshes())
    for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return t;
}
const trianglesBefore = countTriangles();
if (trianglesBefore !== EXPECT.triangles) fail(`треугольников ${trianglesBefore}, ожидалось ${EXPECT.triangles}`);

const findNode = (name) => {
  const n = root.listNodes().find((x) => x.getName() === name);
  if (!n) fail(`нет узла "${name}"`);
  return n;
};

/** Связные куски примитива: массив { tris: Uint32Array(индексы треугольников) }. */
function components(prim) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const vcount = pos.length / 3;
  // сварка по позиции
  const key = new Map();
  const weld = new Uint32Array(vcount);
  for (let v = 0; v < vcount; v++) {
    const k = `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`;
    let w = key.get(k);
    if (w === undefined) key.set(k, (w = key.size));
    weld[v] = w;
  }
  const parent = new Uint32Array(key.size).map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const tcount = idx.length / 3;
  for (let t = 0; t < tcount; t++) {
    const a = find(weld[idx[t * 3]]);
    parent[find(weld[idx[t * 3 + 1]])] = a;
    parent[find(weld[idx[t * 3 + 2]])] = a;
  }
  const groups = new Map();
  for (let t = 0; t < tcount; t++) {
    const r = find(weld[idx[t * 3]]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()].map((tris) => {
    // центр по вершинам куска
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        sx += pos[v * 3]; sy += pos[v * 3 + 1]; sz += pos[v * 3 + 2]; n++;
      }
    return { tris, center: [sx / n, sy / n, sz / n] };
  });
}

/** Новый примитив из подмножества треугольников (вершины уплотняются). */
function subPrimitive(prim, tris) {
  const idx = prim.getIndices().getArray();
  const remap = new Map();
  const order = [];
  const newIdx = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let nv = remap.get(v);
      if (nv === undefined) {
        nv = order.length;
        remap.set(v, nv);
        order.push(v);
      }
      newIdx[i * 3 + k] = nv;
    }
  });
  const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
  for (const semantic of prim.listSemantics()) {
    const src = prim.getAttribute(semantic);
    const size = src.getElementSize();
    const arr = src.getArray();
    const dst = new arr.constructor(order.length * size);
    order.forEach((v, i) => {
      for (let c = 0; c < size; c++) dst[i * size + c] = arr[v * size + c];
    });
    out.setAttribute(
      semantic,
      doc.createAccessor().setType(src.getType()).setArray(dst).setNormalized(src.getNormalized()).setBuffer(buffer),
    );
  }
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(newIdx).setBuffer(buffer));
  return out;
}

function leaf(name, prim) {
  const mesh = doc.createMesh(name).addPrimitive(prim);
  return doc.createNode(name).setMesh(mesh);
}

// ---- исходные узлы
const gaNode = findNode('GA');
const vesNode = findNode('vesicles');
const gaMeshNode = findNode('GA-material');
const vesMeshNode = findNode('vesicles-material');
const sceneGroup = gaNode.getParentNode();
const gaPrim = gaMeshNode.getMesh().listPrimitives()[0];
const vesPrim = vesMeshNode.getMesh().listPrimitives()[0];
const gaMatrix = gaNode.getMatrix();
const vesMatrix = vesNode.getMatrix();
const applyM = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// ---- 1–2. цистерны
const cis = components(gaPrim).map((c) => ({ ...c, w: applyM(gaMatrix, c.center) }));
if (cis.length !== EXPECT.cisternae) fail(`цистерн ${cis.length}, ожидалось ${EXPECT.cisternae}`);
const cisTris = cis.reduce((s, c) => s + c.tris.length, 0);
if (cisTris !== EXPECT.cisternaeTriangles) fail(`треугольников в цистернах ${cisTris}`);
cis.sort((a, b) => CIS_SIDE * (b.w[0] - a.w[0])); // 1 — цис-край
const stackMid = (cis[0].w[0] + cis[cis.length - 1].w[0]) / 2;

// ---- 3. пузырьки
const ves = components(vesPrim).map((c) => ({ ...c, w: applyM(vesMatrix, c.center) }));
if (ves.length !== EXPECT.vesicles) fail(`пузырьков ${ves.length}, ожидалось ${EXPECT.vesicles}`);
const vesTris = ves.reduce((s, c) => s + c.tris.length, 0);
if (vesTris !== EXPECT.vesicleTriangles) fail(`треугольников в пузырьках ${vesTris}`);
const isCis = (v) => Math.sign(v.w[0] - stackMid) === CIS_SIDE;
const cisVes = ves.filter(isCis).sort((a, b) => a.w[1] - b.w[1] || a.w[2] - b.w[2]);
const transVes = ves.filter((v) => !isCis(v)).sort((a, b) => a.w[1] - b.w[1] || a.w[2] - b.w[2]);
if (cisVes.length !== EXPECT.cisVesicles) fail(`транспортных пузырьков ${cisVes.length}, ожидалось ${EXPECT.cisVesicles}`);
if (transVes.length !== EXPECT.transVesicles) fail(`секреторных пузырьков ${transVes.length}, ожидалось ${EXPECT.transVesicles}`);
// пузырьки должны лежать у своего края стопки: не ближе к середине, чем 60 % полудлины стопки
const halfStack = Math.abs(cis[cis.length - 1].w[0] - cis[0].w[0]) / 2;
for (const v of ves) {
  const d = Math.abs(v.w[0] - stackMid);
  if (d < 0.6 * halfStack) fail(`пузырёк у середины стопки (x=${v.w[0].toFixed(3)}): сторона неоднозначна`);
}

// ---- 4. иерархия
const cisternae = doc.createNode('Cisternae').setMatrix(gaMatrix);
const groupNodes = {
  cis: doc.createNode('CisCisternae'),
  medial: doc.createNode('MedialCisternae'),
  trans: doc.createNode('TransCisternae'),
};
for (const g of Object.values(groupNodes)) cisternae.addChild(g);
cis.forEach((c, i) => {
  const n = i + 1;
  const group = Object.entries(GROUPS).find(([, list]) => list.includes(n))[0];
  groupNodes[group].addChild(leaf(`Cisterna.${n}`, subPrimitive(gaPrim, c.tris)));
});
const vesicles = doc.createNode('Vesicles').setMatrix(vesMatrix);
const cisVesNode = doc.createNode('TransportVesicles');
const transVesNode = doc.createNode('SecretoryVesicles');
vesicles.addChild(cisVesNode).addChild(transVesNode);
cisVes.forEach((v, i) => cisVesNode.addChild(leaf(`TransportVesicle.${String(i + 1).padStart(2, '0')}`, subPrimitive(vesPrim, v.tris))));
transVes.forEach((v, i) => transVesNode.addChild(leaf(`SecretoryVesicle.${String(i + 1).padStart(2, '0')}`, subPrimitive(vesPrim, v.tris))));

sceneGroup.addChild(cisternae).addChild(vesicles);
gaMeshNode.getMesh().dispose();
vesMeshNode.getMesh().dispose();
gaMeshNode.dispose();
vesMeshNode.dispose();
gaNode.dispose();
vesNode.dispose();

// ---- проверки структуры
const trianglesAfterSplit = countTriangles();
if (trianglesAfterSplit !== EXPECT.triangles) fail(`баланс треугольников: ${trianglesBefore} → ${trianglesAfterSplit}`);
const names = new Set(root.listNodes().map((n) => n.getName()));
const expected = [
  'Cisternae', 'CisCisternae', 'MedialCisternae', 'TransCisternae', 'Vesicles', 'TransportVesicles', 'SecretoryVesicles',
  ...Array.from({ length: 8 }, (_, i) => `Cisterna.${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `TransportVesicle.${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 15 }, (_, i) => `SecretoryVesicle.${String(i + 1).padStart(2, '0')}`),
];
for (const n of expected) if (!names.has(n)) fail(`нет узла "${n}"`);
for (const n of ['GA', 'vesicles', 'GA-material', 'vesicles-material']) if (names.has(n)) fail(`остался исходный узел "${n}"`);

// ---- 5. сжатие
await doc.transform(dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
if (countTriangles() !== EXPECT.triangles) fail('сжатие изменило число треугольников');

await io.write(output, doc);
console.log(
  `готово: ${output}; цистерн ${cis.length} (${GROUPS.cis.length}/${GROUPS.medial.length}/${GROUPS.trans.length}), ` +
    `пузырьков ${cisVes.length} транспортных + ${transVes.length} секреторных, треугольников ${countTriangles()}`,
);
