// Подготовка модели «Animal cell 2.0 - annotated in English» (montanna, CC BY 4.0).
//
// Что делает:
//   1. Даёт узлам смысловые имена и собирает их в иерархию, повторяющую строение клетки
//      (Nucleus → оболочка, поры, ядрышко…; RoughER → мембрана + рибосомы и т. д.).
//   2. Разделяет склеенные меши (мембраны митохондрий; центриоли + жёлтые тельца).
//   3. Чистит рибосомы: удаляет точные дубликаты и крупную сферу с материалом рибосом
//      (артефакт: торчит из ядра сквозь ЭПР, виден при подсветке ядра); её вклад в цвет ядра
//      компенсирует материал нуклеоплазмы. Удаляет невидимые крошечные сферы.
//   4. Сжимает: dedup + prune + meshopt (без instance — он стирает имена узлов).
//
// Использование: node tools/prepare-animal-cell.mjs <scene.gltf> <out.glb>
// Скрипт падает с ошибкой, если структура модели не совпадает с ожидаемой.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node prepare-animal-cell.mjs <scene.gltf> <out.glb>');
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) {
    console.error('ПРОВЕРКА НЕ ПРОЙДЕНА: ' + msg);
    process.exit(2);
  }
}

// ---------- Ожидаемая структура исходника ----------
const RENAME = {
  'Sphere_13': 'PlasmaMembrane',
  'Sphere.001_18': 'Cytoplasm',
  'Icosphere_16': 'Nucleus_Envelope',
  'Roundcube_10': 'Nucleus_Nucleoplasm',
  'Icosphere.002_9': 'Nucleus_Pores',
  'Roundcube.001_11': 'Nucleus_Nucleolus',
  'Mesh_2028': 'Nucleus_Chromatin',
  'BezierCurve_15': 'RoughER_Membrane',
  'BezierCurve.004_26': 'SmoothER.1',
  'BezierCurve.005_25': 'SmoothER.2',
  'BezierCurve.006_27': 'SmoothER.3',
  'BezierCurve.002_14': 'Golgi',
  'Sphere.005_8': 'Mitochondrion.1_Cristae',
};
const RIBOSOME_MATERIAL = 'Material.018';
const MITO_OUTER_SOURCE = 'Sphere.002_17';   // 3 наружные мембраны митохондрий в одном меше
const CENTRIOLES_SOURCE = 'Roundcube.000_12'; // 2 центриоли + 2 жёлтых тельца в одном меше
const EXPECT = {
  ribosomeObjects: 2002,      // объектов с материалом рибосом в исходнике
  ribosomesUnique: 951,       // после удаления дубликатов, крупной и крошечной сфер
  nucleusSphere: 1,           // крупная сфера с материалом рибосом, пересекающая ядро — артефакт, удаляется
  tinySpheres: 10,            // крошечные сферы, утопленные в мембраны ЭПР (невидимы) — удаляются
  centriolePiecesMin: 20,
};

// ---------- Загрузка ----------
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

const primTris = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
const sceneTris = () => {
  let t = 0;
  root.listScenes()[0].traverse((n) => { const m = n.getMesh(); if (m) for (const p of m.listPrimitives()) t += primTris(p); });
  return t;
};
const trisBefore = sceneTris();
let trisRemoved = 0;

const sceneRoot = root.listNodes().find((n) => n.getName() === 'GLTF_SceneRootNode');
assert(sceneRoot, 'нет узла GLTF_SceneRootNode');
const wrappers = new Map(sceneRoot.listChildren().map((n) => [n.getName(), n]));
const meshKids = (w) => w.listChildren().filter((n) => n.getMesh());

const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Мировые габариты узла-обёртки (по min/max атрибута POSITION)
function worldBox(w) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const c of meshKids(w)) {
    const m = c.getWorldMatrix();
    for (const p of c.getMesh().listPrimitives()) {
      const a = p.getAttribute('POSITION'); const mn = a.getMin([]), mx = a.getMax([]);
      for (const x of [mn[0], mx[0]]) for (const y of [mn[1], mx[1]]) for (const z of [mn[2], mx[2]]) {
        const v = apply(m, [x, y, z]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
      }
    }
  }
  return { center: lo.map((v, k) => (v + hi[k]) / 2), size: Math.max(...hi.map((v, k) => v - lo[k])) };
}
function removeWrapper(w) {
  for (const c of meshKids(w)) for (const p of c.getMesh().listPrimitives()) trisRemoved += primTris(p);
  for (const c of w.listChildren()) c.dispose();
  w.dispose();
}

// ---------- 1. Переименование ----------
for (const [from, to] of Object.entries(RENAME)) {
  const w = wrappers.get(from);
  assert(w, `нет узла ${from}`);
  w.setName(to);
}

// ---------- 2. Рибосомы ----------
const riboWrappers = sceneRoot.listChildren().filter((w) => {
  const k = meshKids(w);
  if (k.length !== 1) return false;
  const prims = k[0].getMesh().listPrimitives();
  return prims.length === 1 && prims[0].getMaterial()?.getName() === RIBOSOME_MATERIAL;
});
assert(riboWrappers.length === EXPECT.ribosomeObjects, `ожидалось ${EXPECT.ribosomeObjects} объектов рибосом, найдено ${riboWrappers.length}`);

const boxes = riboWrappers.map((w) => ({ w, ...worldBox(w) }));
const sizes = boxes.map((b) => b.size).sort((a, b) => a - b);
const typical = sizes[Math.floor(sizes.length / 2)];
const artifacts = boxes.filter((b) => b.size > typical * 5);      // крупная сфера, пересекающая ядро
const tiny = boxes.filter((b) => b.size < typical / 3);           // крошечная сфера — удаляется в шаге 3
assert(artifacts.length === EXPECT.nucleusSphere, `ожидалась ${EXPECT.nucleusSphere} крупная сфера у ядра, найдено ${artifacts.length}`);
{
  const nuc = worldBox(wrappers.get('Icosphere_16'));
  const sphere = artifacts[0];
  assert(dist(sphere.center, nuc.center) < (nuc.size + sphere.size) / 2, 'крупная сфера не пересекается с ядром — структура модели изменилась');
  // Сфера лишь частично внутри ядра и торчит вниз сквозь ЭПР. Сквозь полупрозрачную
  // нуклеоплазму она давала ядру насыщенный розовый цвет — компенсируем материалом (шаг 3а).
  removeWrapper(sphere.w);
}

const seen = new Map();
let duplicates = 0;
const ribosomes = [];
for (const b of boxes) {
  if (artifacts.includes(b) || tiny.includes(b)) continue;
  const key = b.center.map((v) => v.toFixed(3)).join(',');
  const prev = seen.get(key);
  if (prev) {
    assert(Math.abs(prev.size - b.size) < 1e-3, `рибосомы в одной точке разного размера: ${key}`);
    removeWrapper(b.w);
    duplicates++;
  } else {
    seen.set(key, b);
    ribosomes.push(b);
  }
}
assert(ribosomes.length === EXPECT.ribosomesUnique, `ожидалось ${EXPECT.ribosomesUnique} уникальных рибосом, найдено ${ribosomes.length}`);
ribosomes.forEach((b, i) => b.w.setName('Ribosome.' + String(i + 1).padStart(4, '0')));
console.log(`рибосомы: ${ribosomes.length} уникальных, удалено дубликатов ${duplicates}; крупная сфера у ядра удалена`);

// ---------- 3. Крошечные сферы ----------
// Утоплены в мембраны ЭПР, снаружи не видны (проверено рендером: удаление меняет 0–6 пикселей).
let tinyRemoved = 0;
for (const w of [...sceneRoot.listChildren()]) {
  const n = w.getName();
  if (n === MITO_OUTER_SOURCE || n === CENTRIOLES_SOURCE) continue; // их разделяют шаги 4–5
  if (/^Sphere(\.\d+)?_\d+$/.test(n)) {
    assert(worldBox(w).size < typical / 3, `${n}: ожидалась крошечная сфера`);
    removeWrapper(w);
    tinyRemoved++;
  }
}
assert(tinyRemoved === EXPECT.tinySpheres, `ожидалось ${EXPECT.tinySpheres} крошечных сфер, найдено ${tinyRemoved}`);

// ---------- 3а. Цвет нуклеоплазмы ----------
// Компенсация удалённой сферы: подобрано сравнением рендеров с исходником
// (sRGB #ff63cf, непрозрачность 0.85, свечение #ff2a9a × 0.25).
{
  const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const hex = (h) => [1, 3, 5].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  const w = wrappers.get('Roundcube_10');
  const prims = meshKids(w).flatMap((c) => c.getMesh().listPrimitives());
  assert(prims.length === 1, 'у нуклеоплазмы ожидался один примитив');
  const mat = prims[0].getMaterial();
  const users = root.listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => p.getMaterial() === mat);
  assert(users.length === 1, 'материал нуклеоплазмы используется не только ею — менять нельзя');
  const [r, g, b] = hex('#ff63cf');
  mat.setBaseColorFactor([r, g, b, 0.85]);
  mat.setEmissiveFactor(hex('#ff2a9a').map((v) => v * 0.25));
}

// ---------- Геометрия: связные компоненты и разделение мешей ----------
function components(prim) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const vcount = pos.length / 3;
  const key = new Map();
  const weld = new Int32Array(vcount);
  for (let i = 0; i < vcount; i++) {
    const k = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`;
    if (!key.has(k)) key.set(k, key.size);
    weld[i] = key.get(k);
  }
  const parent = Int32Array.from({ length: key.size }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let t = 0; t < idx.length; t += 3) { unite(weld[idx[t]], weld[idx[t + 1]]); unite(weld[idx[t]], weld[idx[t + 2]]); }
  const byRoot = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(weld[idx[t]]);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(t);
  }
  return [...byRoot.values()];
}
function centerOf(prim, triStarts, m) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  let x = 0, y = 0, z = 0, n = 0;
  for (const t of triStarts) for (let k = 0; k < 3; k++) { const v = idx[t + k]; x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; n++; }
  return apply(m, [x / n, y / n, z / n]);
}
function subPrimitive(prim, triStarts) {
  const idx = prim.getIndices().getArray();
  const remap = new Map();
  const newIdx = [];
  for (const t of triStarts) for (let k = 0; k < 3; k++) {
    const v = idx[t + k];
    if (!remap.has(v)) remap.set(v, remap.size);
    newIdx.push(remap.get(v));
  }
  const order = [...remap.keys()];
  const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
  for (const sem of prim.listSemantics()) {
    const a = prim.getAttribute(sem);
    const size = a.getElementSize();
    const src = a.getArray();
    const dst = new src.constructor(order.length * size);
    order.forEach((v, i) => { for (let c = 0; c < size; c++) dst[i * size + c] = src[v * size + c]; });
    out.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setNormalized(a.getNormalized()).setBuffer(buffer));
  }
  const IdxArr = order.length > 65535 ? Uint32Array : Uint16Array;
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(IdxArr.from(newIdx)).setBuffer(buffer));
  return out;
}
function splitWrapper(wrapper, groups) {
  const [child] = meshKids(wrapper);
  const prim = child.getMesh().listPrimitives()[0];
  for (const g of groups) {
    const w = doc.createNode(g.name)
      .setTranslation(wrapper.getTranslation()).setRotation(wrapper.getRotation()).setScale(wrapper.getScale());
    w.addChild(doc.createNode(g.name + '_mesh')
      .setTranslation(child.getTranslation()).setRotation(child.getRotation()).setScale(child.getScale())
      .setMesh(doc.createMesh(g.name).addPrimitive(subPrimitive(prim, g.tris))));
    sceneRoot.addChild(w);
  }
  wrapper.dispose();
  child.dispose();
}

// ---------- 4. Наружные мембраны митохондрий ----------
{
  const w = wrappers.get(MITO_OUTER_SOURCE);
  assert(w, `нет узла ${MITO_OUTER_SOURCE}`);
  const [child] = meshKids(w);
  const prim = child.getMesh().listPrimitives()[0];
  const comps = components(prim);
  assert(comps.length === 3, `${MITO_OUTER_SOURCE}: ожидалось 3 куска, найдено ${comps.length}`);
  const cristaeCenter = worldBox(wrappers.get('Sphere.005_8')).center;
  const items = comps.map((tris) => ({ tris, c: centerOf(prim, tris, child.getWorldMatrix()) }));
  items.sort((a, b) => dist(a.c, cristaeCenter) - dist(b.c, cristaeCenter));
  const [cut, ...whole] = items;
  assert(dist(cut.c, cristaeCenter) < dist(whole[0].c, cristaeCenter) / 3, 'не удалось однозначно найти мембрану разрезанной митохондрии');
  whole.sort((a, b) => a.c[0] - b.c[0]);
  splitWrapper(w, [
    { name: 'Mitochondrion.1_Outer', tris: cut.tris },
    { name: 'Mitochondrion.2', tris: whole[0].tris },
    { name: 'Mitochondrion.3', tris: whole[1].tris },
  ]);
}

// ---------- 5. Центриоли и жёлтые тельца ----------
{
  const w = wrappers.get(CENTRIOLES_SOURCE);
  assert(w, `нет узла ${CENTRIOLES_SOURCE}`);
  const [child] = meshKids(w);
  const prim = child.getMesh().listPrimitives()[0];
  const items = components(prim).map((tris) => ({ tris, c: centerOf(prim, tris, child.getWorldMatrix()) }));
  const nn = items.map((a) => Math.min(...items.filter((b) => b !== a).map((b) => dist(a.c, b.c))));
  const median = [...nn].sort((a, b) => a - b)[Math.floor(nn.length / 2)];
  const isolated = items.filter((_, i) => nn[i] > median * 10);
  assert(isolated.length === 2, `ожидалось 2 обособленных жёлтых тельца, найдено ${isolated.length}`);
  const rest = items.filter((it) => !isolated.includes(it));
  let a = rest[0], b = rest[0], best = -1;
  for (const p of rest) for (const q of rest) { const d = dist(p.c, q.c); if (d > best) { best = d; a = p; b = q; } }
  let ca = a.c, cb = b.c, groupA = [], groupB = [];
  for (let iter = 0; iter < 20; iter++) {
    groupA = rest.filter((p) => dist(p.c, ca) <= dist(p.c, cb));
    groupB = rest.filter((p) => dist(p.c, ca) > dist(p.c, cb));
    const mean = (g) => [0, 1, 2].map((k) => g.reduce((s, p) => s + p.c[k], 0) / g.length);
    ca = mean(groupA); cb = mean(groupB);
  }
  assert(groupA.length >= EXPECT.centriolePiecesMin && groupB.length >= EXPECT.centriolePiecesMin,
    `центриоли разделились неравномерно: ${groupA.length} и ${groupB.length} кусков`);
  isolated.sort((p, q) => p.c[0] - q.c[0]);
  splitWrapper(w, [
    { name: 'Centriole.1', tris: groupA.flatMap((p) => p.tris) },
    { name: 'Centriole.2', tris: groupB.flatMap((p) => p.tris) },
    { name: 'Unknown_Yellow.1', tris: isolated[0].tris },
    { name: 'Unknown_Yellow.2', tris: isolated[1].tris },
  ]);
  console.log(`центриоли: ${groupA.length} + ${groupB.length} кусков, жёлтые тельца: 2`);
}

// ---------- 6. Имена вложенных узлов и мешей ----------
const SEMANTIC = /^(PlasmaMembrane|Cytoplasm|Nucleus_|RoughER_Membrane|Ribosome\.|SmoothER\.|Golgi|Mitochondrion|Centriole|Unknown_)/;
for (const w of sceneRoot.listChildren()) {
  const name = w.getName();
  assert(SEMANTIC.test(name), `остался узел без смыслового имени: ${name}`);
  const kids = meshKids(w);
  kids.forEach((c, i) => {
    c.setName(kids.length > 1 ? `${name}_mesh.${i + 1}` : `${name}_mesh`);
    c.getMesh().setName(name.startsWith('Ribosome.') ? 'Ribosome' : name);
  });
}

// ---------- 7. Иерархия по строению клетки ----------
// Группы — пустые узлы с единичной трансформацией, поэтому мировые положения не меняются.
// [имя группы, кого собрать, родитель (по умолчанию корень)]
const GROUPS = [
  ['Nucleus', /^Nucleus_/],
  ['RoughER', /^(RoughER_Membrane|Ribosome\.)/],
  ['Ribosomes', /^Ribosome\./, 'RoughER'],
  ['SmoothER', /^SmoothER\./],
  ['EndoplasmicReticulum', /^(RoughER|SmoothER)$/],
  ['Mitochondrion.1', /^Mitochondrion\.1_/],
  ['Mitochondria', /^Mitochondrion\.\d+$/],
  ['Centrosome', /^Centriole\./],
  ['Unidentified', /^Unknown_/],
];
const groupNodes = {};
for (const [name, re, parentName] of GROUPS) {
  const g = doc.createNode(name);
  (parentName ? groupNodes[parentName] : sceneRoot).addChild(g);
  groupNodes[name] = g;
  const members = (parentName ? groupNodes[parentName] : sceneRoot).listChildren().filter((n) => n !== g && re.test(n.getName()));
  for (const m of members) g.addChild(m);
}

// ---------- 8. Проверки ----------
const trisAfter = sceneTris();
assert(trisAfter === trisBefore - trisRemoved, `треугольники не сходятся: было ${trisBefore}, удалено ${trisRemoved}, стало ${trisAfter}`);
const allNames = new Set();
root.listScenes()[0].traverse((n) => allNames.add(n.getName()));
assert(!root.listNodes().some((n) => n.getName() === 'Nucleus_Body'), 'сфера у ядра не удалена');
for (const n of ['PlasmaMembrane', 'Cytoplasm', 'Nucleus', 'Nucleus_Envelope', 'Nucleus_Chromatin',
  'EndoplasmicReticulum', 'RoughER', 'RoughER_Membrane', 'Ribosomes', 'Ribosome.0001',
  'Ribosome.' + String(EXPECT.ribosomesUnique).padStart(4, '0'), 'SmoothER', 'SmoothER.3', 'Golgi',
  'Mitochondria', 'Mitochondrion.1', 'Mitochondrion.1_Outer', 'Mitochondrion.1_Cristae', 'Mitochondrion.2', 'Mitochondrion.3',
  'Centrosome', 'Centriole.1', 'Centriole.2', 'Unidentified']) {
  assert(allNames.has(n), `после обработки нет узла ${n}`);
}
assert(!allNames.has('Ribosome.' + String(EXPECT.ribosomesUnique + 1).padStart(4, '0')), 'рибосом больше, чем ожидалось');
const topLevel = sceneRoot.listChildren().map((n) => n.getName()).sort();
console.log('верхний уровень: ' + topLevel.join(', '));

// ---------- 9. Метаданные и сжатие ----------
root.getAsset().extras = {
  ...(root.getAsset().extras || {}),
  modified: 'Renamed and regrouped nodes, split combined meshes, removed duplicate ribosomes, stray sphere at nucleus (nucleoplasm recolored to compensate) and hidden tiny spheres, compressed (tools/prepare-animal-cell.mjs)',
};
await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(output, doc);
console.log(`OK: треугольников ${trisBefore} → ${trisAfter}, рибосом ${ribosomes.length}`);
