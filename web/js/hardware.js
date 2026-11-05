// Purchased hardware (bolts, rods, bearings, collars, heat inserts), drawn
// procedurally in metal materials. rules.js places each item on a host part,
// at a point given in the host's file coordinates (as measured on the STL) or
// its local frame; the viewer turns that into a world pose (see poseHardware).
import * as THREE from 'three';

/** Screw finishes the user can choose. Rods, bearings and collars stay steel; inserts brass. */
export const HW_FINISHES = [
  { key: 'silver', label: 'Silver' },
  { key: 'brass', label: 'Brass' },
  { key: 'black', label: 'Black' },
];

// ---------------------------------------------------------------- materials

let envMap = null;
/** A small studio environment for metal reflections (hardware only). */
function environment(renderer) {
  if (envMap || !renderer) return envMap;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#ffffff');
  sky.addColorStop(0.45, '#b9c0c8');
  sky.addColorStop(0.55, '#5d636b');
  sky.addColorStop(1, '#1d2025');
  x.fillStyle = sky;
  x.fillRect(0, 0, 256, 128);
  // Soft-box highlights, so curved metal shows a clear gleam.
  x.fillStyle = 'rgba(255,255,255,0.9)';
  x.fillRect(40, 18, 40, 22);
  x.fillRect(170, 26, 30, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return envMap;
}

const METALS = {
  silver: { color: 0xd3d7db, metalness: 1, roughness: 0.3 },
  brass: { color: 0xd8ad55, metalness: 1, roughness: 0.32 },
  black: { color: 0x2b2d31, metalness: 0.75, roughness: 0.45 },
  steel: { color: 0xc4c9ce, metalness: 1, roughness: 0.38 },
  zinc: { color: 0xb8bec4, metalness: 1, roughness: 0.45 },
};
const materials = new Map();
export function hardwareMaterial(kind, finish, renderer) {
  const key = kind === 'bolt' ? finish || 'silver' : kind === 'insert' ? 'brass' : kind === 'rod' ? 'zinc' : 'steel';
  if (!materials.has(key)) {
    const m = new THREE.MeshStandardMaterial({ ...METALS[key], envMap: environment(renderer), envMapIntensity: 1.1 });
    materials.set(key, m);
  }
  return materials.get(key);
}

// ---------------------------------------------------------------- geometry

function merge(geos) {
  let nv = 0;
  let ni = 0;
  for (const g of geos) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < g.attributes.position.count; i++) idx[io++] = i + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  return out;
}

/** A ring with a rectangular cross-section along Y, centred on the origin. */
function tube(ri, ro, w, seg = 32) {
  const p = [
    new THREE.Vector2(ri, -w / 2),
    new THREE.Vector2(ro, -w / 2),
    new THREE.Vector2(ro, w / 2),
    new THREE.Vector2(ri, w / 2),
    new THREE.Vector2(ri, -w / 2),
  ];
  const g = new THREE.LatheGeometry(p, seg);
  g.computeVertexNormals();
  return g;
}

const geoCache = new Map();
/**
 * Geometry for a hardware spec, in its own frame:
 * - bolts: the head's bearing face (or a countersunk head's top) at y = 0,
 *   head above, shaft running down −Y for its length;
 * - rods, bearings, collars, inserts: axis along Y, centred on the origin.
 */
export function hardwareGeometry(hw) {
  const key = JSON.stringify(hw);
  if (geoCache.has(key)) return geoCache.get(key);
  let g;
  if (hw.kind === 'bolt') {
    const d = hw.d;
    const parts = [];
    let shaftTop = 0;
    if (hw.head === 'countersunk') {
      // ISO 10642: head diameter 2d, 90° countersink; top flush at y = 0.
      const dk = 2 * d;
      const k = (dk - d) / 2;
      const head = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(dk / 2, 0), new THREE.Vector2(d / 2, -k)], 32);
      head.computeVertexNormals();
      parts.push(head);
      shaftTop = -k;
    } else if (hw.head === 'hex') {
      // ISO 4017: across flats ≈ 1.75d, height ≈ 0.7d.
      const s = 1.75 * d;
      const k = 0.7 * d;
      const head = new THREE.CylinderGeometry(s / Math.sqrt(3), s / Math.sqrt(3), k, 6);
      head.translate(0, k / 2, 0);
      parts.push(head);
    } else {
      // ISO 7380 button head: diameter ≈ 1.9d (M4) / 1.75d (M6), height 0.55d.
      const dk = (d <= 4 ? 1.9 : 1.75) * d;
      const k = 0.55 * d;
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(dk / 2, 0), new THREE.Vector2(dk / 2, k * 0.2)];
      for (let i = 1; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        pts.push(new THREE.Vector2((dk / 2) * Math.cos(a), k * 0.2 + k * 0.8 * Math.sin(a)));
      }
      const head = new THREE.LatheGeometry(pts, 32);
      head.computeVertexNormals();
      parts.push(head);
    }
    const len = hw.len - (hw.head === 'countersunk' ? -shaftTop : 0);
    const shaft = new THREE.CylinderGeometry(d * 0.47, d * 0.47, len, 16, 1, true);
    shaft.translate(0, shaftTop - len / 2, 0);
    const tip = new THREE.CircleGeometry(d * 0.47, 16);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, shaftTop - len, 0);
    parts.push(shaft, tip);
    g = merge(parts);
  } else if (hw.kind === 'rod') {
    g = new THREE.CylinderGeometry(hw.d / 2, hw.d / 2, hw.len, 24);
  } else if (hw.kind === 'bearing') {
    // Inner race, shields and outer race, slightly stepped.
    const p = [
      [hw.id / 2, -hw.w / 2],
      [hw.id / 2 + 3, -hw.w / 2],
      [hw.id / 2 + 3, -hw.w / 2 + 0.6],
      [hw.od / 2 - 3, -hw.w / 2 + 0.6],
      [hw.od / 2 - 3, -hw.w / 2],
      [hw.od / 2, -hw.w / 2],
      [hw.od / 2, hw.w / 2],
      [hw.od / 2 - 3, hw.w / 2],
      [hw.od / 2 - 3, hw.w / 2 - 0.6],
      [hw.id / 2 + 3, hw.w / 2 - 0.6],
      [hw.id / 2 + 3, hw.w / 2],
      [hw.id / 2, hw.w / 2],
      [hw.id / 2, -hw.w / 2],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    g = new THREE.LatheGeometry(p, 40);
    g.computeVertexNormals();
  } else if (hw.kind === 'collar' || hw.kind === 'insert') {
    g = tube(hw.id / 2, hw.od / 2, hw.w);
  }
  g.computeBoundingBox();
  geoCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------- posing

const Y_DOWN = new THREE.Vector3(0, -1, 0);
const Y_UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();

/**
 * Poses a hardware mesh from its host. `pl.at` and `pl.dir` are in the host's
 * file coordinates (frame 'file', mapped by the host geometry's fileToLocal)
 * or its local frame ('local'). Bolts: `at` is the head's seat, `dir` points
 * from head to tip. Others: `at` is the centre, `dir` the axis.
 * Returns false when the host isn't ready.
 */
export function poseHardware(mesh, pl, host) {
  if (!host?.loaded || !host.mesh.visible) return false;
  host.mesh.updateMatrix();
  tmpM.copy(host.mesh.matrix);
  if (pl.frame !== 'local') {
    if (!host.fileToLocal) return false;
    tmpM.multiply(host.fileToLocal);
  }
  const p = new THREE.Vector3(...pl.at).applyMatrix4(tmpM);
  const d = new THREE.Vector3(...pl.dir).transformDirection(tmpM);
  mesh.position.copy(p);
  mesh.quaternion.setFromUnitVectors(pl.hw.kind === 'bolt' ? Y_DOWN : Y_UP, d);
  return true;
}
