// Orientation from connection geometry.
//
// The STL files come out of one big CAD scene with arbitrary flips, so after
// the axes are matched to width/height/depth a part can still be upside down
// and/or back to front. Parts that stack share a distinctive interface: the
// pads on the underside of anything that sits on a module (call it P), and the
// receiving pattern on top of a module, base or lid (Q). Both are front/back
// asymmetric, so matching them fixes up/down *and* front/back.
//
// Per footprint (size + depth) the references are built from geometry alone:
//   1. The 1F sustainer module is an open box: its floor (large horizontal
//      area) is at the bottom, and its front wall carries the facade screw
//      holes while the back wall has none. Its underside is P.
//   2. The 1F drawer module turned so its underside matches P; its top is Q.
// Each stacking part is then tried in the four axis-preserving orientations
// and the one whose connecting face best overlaps the reference wins.
import * as THREE from 'three';
import { loadPreview } from './api.js';
import { fitAxes } from './viewer-fit.js';

const CELL = 3; // mm grid for face maps
const TOL = 1.2; // mm: how close to the extreme plane counts as "contact"

/** The four rotations that keep the axes where fitAxes put them. */
export const CANDIDATES = [
  { name: 'as-is', euler: [0, 0, 0] },
  { name: 'flip-z', euler: [0, 0, 180] }, // upside down, front stays front
  { name: 'flip-x', euler: [180, 0, 0] }, // upside down, front <-> back
  { name: 'turn-y', euler: [0, 180, 0] }, // front <-> back
];

export function rotationMatrix(euler) {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...euler.map(THREE.MathUtils.degToRad)));
}

function rotated(g, euler) {
  const c = g.clone();
  c.applyMatrix4(rotationMatrix(euler));
  c.computeBoundingBox();
  return c;
}

/**
 * Rasterizes the top-most (or bottom-most) surface over a centered XZ grid and
 * returns a mask of cells lying within TOL of that face's extreme plane.
 */
export function contactMask(g, face, half) {
  const pos = g.attributes.position.array;
  const idx = g.index.array;
  const bb = g.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const [hx, hz] = half;
  const nx = Math.ceil((2 * hx) / CELL);
  const nz = Math.ceil((2 * hz) / CELL);
  const up = face === 'top';
  const m = new Float32Array(nx * nz).fill(up ? -Infinity : Infinity);
  for (let t = 0; t < idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => {
      const i = idx[t + k] * 3;
      return [(pos[i] - cx + hx) / CELL, (pos[i + 2] - cz + hz) / CELL, pos[i + 1]];
    });
    const x0 = Math.max(0, Math.floor(Math.min(v[0][0], v[1][0], v[2][0])));
    const x1 = Math.min(nx - 1, Math.ceil(Math.max(v[0][0], v[1][0], v[2][0])));
    const z0 = Math.max(0, Math.floor(Math.min(v[0][1], v[1][1], v[2][1])));
    const z1 = Math.min(nz - 1, Math.ceil(Math.max(v[0][1], v[1][1], v[2][1])));
    if (x0 > x1 || z0 > z1) continue;
    const d = (v[1][1] - v[2][1]) * (v[0][0] - v[2][0]) + (v[2][0] - v[1][0]) * (v[0][1] - v[2][1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const pz = z + 0.5;
        const a = ((v[1][1] - v[2][1]) * (px - v[2][0]) + (v[2][0] - v[1][0]) * (pz - v[2][1])) / d;
        const b = ((v[2][1] - v[0][1]) * (px - v[2][0]) + (v[0][0] - v[2][0]) * (pz - v[2][1])) / d;
        if (a < -1e-4 || b < -1e-4 || 1 - a - b < -1e-4) continue;
        const y = a * v[0][2] + b * v[1][2] + (1 - a - b) * v[2][2];
        const k = z * nx + x;
        if (up ? y > m[k] : y < m[k]) m[k] = y;
      }
    }
  }
  const ext = up ? bb.max.y : bb.min.y;
  const mask = new Uint8Array(m.length);
  for (let k = 0; k < m.length; k++) mask[k] = Number.isFinite(m[k]) && Math.abs(m[k] - ext) < TOL ? 1 : 0;
  return mask;
}

export function jaccard(a, b) {
  let both = 0;
  let either = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] && b[k]) both++;
    if (a[k] || b[k]) either++;
  }
  return either ? both / either : 0;
}

/** True when most horizontal surface area sits in the lower part (a container floor). */
function floorIsDown(g) {
  const pos = g.attributes.position.array;
  const idx = g.index.array;
  const bb = g.boundingBox;
  const H = bb.max.y - bb.min.y;
  let lo = 0;
  let hi = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);
    if (!area2 || Math.abs(ny) / area2 < 0.95) continue;
    const y = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 - bb.min.y;
    if (y < 0.3 * H) lo += area2;
    else if (y > 0.7 * H) hi += area2;
  }
  return lo > 2 * hi;
}

/** Counts small enclosed through-holes (screw holes) in the wall at +Z (side 1) or -Z (side -1). */
function wallHoles(g, side, slab = 8) {
  const pos = g.attributes.position.array;
  const idx = g.index.array;
  const bb = g.boundingBox;
  const W = Math.ceil(bb.max.x - bb.min.x) + 1;
  const H = Math.ceil(bb.max.y - bb.min.y) + 1;
  const cov = new Uint8Array(W * H);
  const lim = side > 0 ? bb.max.z - slab : bb.min.z + slab;
  for (let t = 0; t < idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => {
      const i = idx[t + k] * 3;
      return [pos[i] - bb.min.x, pos[i + 1] - bb.min.y, pos[i + 2]];
    });
    const zc = (v[0][2] + v[1][2] + v[2][2]) / 3;
    if (side > 0 ? zc < lim : zc > lim) continue;
    const x0 = Math.max(0, Math.floor(Math.min(v[0][0], v[1][0], v[2][0])));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(v[0][0], v[1][0], v[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(v[0][1], v[1][1], v[2][1])));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(v[0][1], v[1][1], v[2][1])));
    const d = (v[1][1] - v[2][1]) * (v[0][0] - v[2][0]) + (v[2][0] - v[1][0]) * (v[0][1] - v[2][1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const a = ((v[1][1] - v[2][1]) * (px - v[2][0]) + (v[2][0] - v[1][0]) * (py - v[2][1])) / d;
        const b = ((v[2][1] - v[0][1]) * (px - v[2][0]) + (v[0][0] - v[2][0]) * (py - v[2][1])) / d;
        if (a < -1e-4 || b < -1e-4 || 1 - a - b < -1e-4) continue;
        cov[y * W + x] = 1;
      }
    }
  }
  const seen = new Uint8Array(W * H);
  let holes = 0;
  for (let k = 0; k < W * H; k++) {
    if (seen[k] || cov[k]) continue;
    const stack = [k];
    seen[k] = 1;
    let n = 0;
    let border = false;
    while (stack.length) {
      const q = stack.pop();
      n++;
      const x = q % W;
      const y = (q / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = ny * W + nx;
        if (!seen[nk] && !cov[nk]) {
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    if (!border && n >= 4 && n <= 60) holes++;
  }
  return holes;
}

async function fitted(ref) {
  const pv = await loadPreview(ref.id);
  const g = pv.geometry.clone();
  g.applyMatrix4(fitAxes(pv.size, ref.expect));
  g.computeBoundingBox();
  return g;
}

const refCache = new Map();

/**
 * Builds the interface references for a footprint.
 * iface: { key, half: [hx, hz], sustainer: {id, expect}, drawer: {id, expect} }
 * Returns { P, Q } masks or null if the references can't be established.
 */
export function interfaceRefs(iface) {
  if (!refCache.has(iface.key)) {
    refCache.set(
      iface.key,
      (async () => {
        if (!iface.sustainer || !iface.drawer) return null;
        const s = await fitted(iface.sustainer);
        const sc = CANDIDATES.map((c) => rotated(s, c.euler)).find((g) => floorIsDown(g) && wallHoles(g, 1) > wallHoles(g, -1));
        if (!sc) return null;
        const P = contactMask(sc, 'bottom', iface.half);
        const d = await fitted(iface.drawer);
        let best = null;
        for (const c of CANDIDATES) {
          const g = rotated(d, c.euler);
          const score = jaccard(contactMask(g, 'bottom', iface.half), P);
          if (!best || score > best.score) best = { g, score };
        }
        if (best.score < 0.5) return null;
        const Q = contactMask(best.g, 'top', iface.half);
        return { P, Q };
      })().catch((e) => {
        console.warn('interface refs', iface.key, e);
        return null;
      }),
    );
  }
  return refCache.get(iface.key);
}

/** Which face of a role connects to which reference. */
const RULES = {
  module: { face: 'bottom', ref: 'P' },
  smodule: { face: 'bottom', ref: 'P' },
  roof: { face: 'bottom', ref: 'P' },
  lid: { face: 'top', ref: 'Q' },
  base: { face: 'top', ref: 'Q' },
};

export const orientsByInterface = (role) => role in RULES;

/**
 * Returns the rotation (Matrix4) that makes geometry g connect properly, or
 * null if the match isn't confident (caller falls back to static rules).
 */
export async function interfaceRotation(g, role, iface) {
  const rule = RULES[role];
  if (!rule || !iface) return null;
  const refs = await interfaceRefs(iface);
  if (!refs) return null;
  const scored = CANDIDATES.map((c) => {
    const r = rotated(g, c.euler);
    return { c, score: jaccard(contactMask(r, rule.face, iface.half), refs[rule.ref]) };
  }).sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best.score < 0.35 || best.score - second.score < 0.15) return null;
  return { matrix: rotationMatrix(best.c.euler), name: best.c.name, score: best.score };
}

// ---------------------------------------------------------------- mount faces

const FACES = {
  bottom: { axis: 1, sign: -1 },
  top: { axis: 1, sign: 1 },
  back: { axis: 2, sign: -1 },
  front: { axis: 2, sign: 1 },
  left: { axis: 0, sign: -1 },
  right: { axis: 0, sign: 1 },
};

/**
 * Fraction of a part's footprint (seen along `axis`) whose outermost surface
 * on the `sign` side lies within 0.8 mm of that side's extreme plane — i.e.
 * how flat that face is. Mating faces (the side screwed to something) are flat.
 */
export function faceFlatness(g, axis, sign, cell = 2) {
  const pos = g.attributes.position.array;
  const idx = g.index.array;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const mn = [bb.min.x, bb.min.y, bb.min.z];
  const mx = [bb.max.x, bb.max.y, bb.max.z];
  const nu = Math.max(1, Math.ceil((mx[u] - mn[u]) / cell));
  const nv = Math.max(1, Math.ceil((mx[v] - mn[v]) / cell));
  const m = new Float32Array(nu * nv).fill(sign > 0 ? -Infinity : Infinity);
  for (let t = 0; t < idx.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const i = idx[t + k] * 3;
      return [(pos[i + u] - mn[u]) / cell, (pos[i + v] - mn[v]) / cell, pos[i + axis]];
    });
    const u0 = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const u1 = Math.min(nu - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const v0 = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const v1 = Math.min(nv - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = v0; y <= v1; y++) {
      for (let x = u0; x <= u1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const a = ((p[1][1] - p[2][1]) * (px - p[2][0]) + (p[2][0] - p[1][0]) * (py - p[2][1])) / d;
        const b = ((p[2][1] - p[0][1]) * (px - p[2][0]) + (p[0][0] - p[2][0]) * (py - p[2][1])) / d;
        if (a < -1e-4 || b < -1e-4 || 1 - a - b < -1e-4) continue;
        const w = a * p[0][2] + b * p[1][2] + (1 - a - b) * p[2][2];
        const k = y * nu + x;
        if (sign > 0 ? w > m[k] : w < m[k]) m[k] = w;
      }
    }
  }
  const plane = sign > 0 ? mx[axis] : mn[axis];
  let covered = 0;
  let flat = 0;
  for (const w of m) {
    if (!Number.isFinite(w)) continue;
    covered++;
    if (Math.abs(w - plane) < 0.8) flat++;
  }
  return covered ? flat / covered : 0;
}

/**
 * If the opposite face is clearly flatter than the mount face, returns the
 * half-turn that swaps them (keeping the part's other axes on their axes).
 */
export function mountFaceRotation(g, face) {
  const f = FACES[face];
  if (!f) return null;
  const here = faceFlatness(g, f.axis, f.sign);
  const there = faceFlatness(g, f.axis, -f.sign);
  if (there <= here + 0.05) return null;
  // Half-turn about an axis perpendicular to the face normal.
  const about = f.axis === 1 ? [0, 0, 180] : f.axis === 2 ? [0, 180, 0] : [0, 180, 0];
  return { matrix: rotationMatrix(about), here, there };
}

/** Which face of each role sits against what it's mounted to. */
export const MOUNT_FACE = {
  foot: 'top',
  backbone: 'front',
  pegboard: 'front',
  wallmount: 'front',
  handlelock: 'front',
  // The stationary handle is a U lying flat: its leg ends bolt to the backbone
  // and the grip's flat back faces out. Leg pads cover little of the outline,
  // so test the grip side instead (it must be the flat one, facing back).
  stathandle: 'back',
  // Pull-out handle: upside-down U, the grip's flat top up, legs down on the rods.
  pullhandle: 'top',
  label: 'back',
  gridplate: 'bottom',
  sbaseplate: 'bottom',
  divider: 'bottom',
  l2acc: 'bottom',
  dlatch: 'bottom',
  accessory: 'bottom',
};
