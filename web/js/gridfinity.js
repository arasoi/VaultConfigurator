// Gridfinity bin generator. Builds watertight, printable bins with Manifold
// (vendored WebAssembly CSG library, loaded on first use).
//
// File coordinates: millimetres, Z up, the bin's bottom at z = 0 and centred
// on X/Y. X is the bin's width, Y its depth, -Y the front (finger scoop) and
// +Y the back (label shelf).

/** Gridfinity dimensions used here (Zack Freedman's spec, common community values). */
export const SPEC = {
  pitch: 42, // grid cell
  gap: 0.5, // a bin is 0.5 mm smaller than its cells
  radius: 3.75, // outer corner radius
  unit: 7, // height unit
  // Foot under each cell, bottom to top: [z, inset from the cell's 41.5 mm outline, corner radius].
  foot: [
    [0, 2.95, 0.8],
    [0.8, 2.15, 1.6],
    [2.6, 2.15, 1.6],
    [4.75, 0, 3.75],
  ],
  wall: 1.2,
  divider: 1.2,
  // Stacking lip above the wall top (h = 0), as [h, inset from the outer outline]:
  // mirrors the foot (with 0.25 mm clearance) so the next bin's feet seat in it.
  lip: [
    [-1.0, 1.2], // 45° support chamfer from the wall's inner face...
    [0.5, 2.7], // ...to the lip's narrowest point
    [1.3, 1.9],
    [3.1, 1.9],
    [4.4, 0.6], // top, with a 0.6 mm flat
  ],
  lipHeight: 4.4,
  magnet: { d: 6.5, h: 2.4 },
  screw: { d: 3, h: 6 },
  holeOffset: 13, // holes at ±13 mm from each cell centre (26 mm apart)
  pla: 1.24, // g/cm³, for the weight estimate
};

export const LIMITS = { w: [1, 9], d: [1, 7], h: [2, 25] };
const MIN_POCKET = 10; // narrowest compartment, mm

export const DEFAULT_BIN = { w: 1, d: 1, h: 3, lip: true, magnets: false, screws: false, cx: 1, cy: 1, scoop: false, label: false };

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

/** Outer size of a bin in mm: [width, depth]. */
export const outerSize = (p) => [p.w * SPEC.pitch - SPEC.gap, p.d * SPEC.pitch - SPEC.gap];

/** Overall height in mm (with the lip, if any). */
export const binHeight = (p) => p.h * SPEC.unit + (p.lip ? SPEC.lipHeight : 0);

/** Height of the solid floor inside the bin. */
const floorTop = (p) => (p.screws ? 7 : 6);

/** Most compartments that fit along an inner length. */
function maxCompartments(inner) {
  return Math.max(1, Math.floor((inner + SPEC.divider) / (MIN_POCKET + SPEC.divider)));
}

/** Valid, complete bin parameters. */
export function normalizeBin(p = {}) {
  const b = { ...DEFAULT_BIN, ...p };
  b.w = clampInt(b.w, ...LIMITS.w);
  b.d = clampInt(b.d, ...LIMITS.d);
  b.h = clampInt(b.h, ...LIMITS.h);
  for (const k of ['lip', 'magnets', 'screws', 'scoop', 'label']) b[k] = !!b[k];
  const [W, D] = outerSize(b);
  b.cx = clampInt(b.cx, 1, maxCompartments(W - 2 * SPEC.wall));
  b.cy = clampInt(b.cy, 1, maxCompartments(D - 2 * SPEC.wall));
  return b;
}

/** Short description, e.g. "2×3 · 6u · 3×2 compartments · lip, magnets". */
export function binLabel(p) {
  const f = [p.lip && 'lip', p.magnets && 'magnets', p.screws && 'screws', p.scoop && 'scoop', p.label && 'label'].filter(Boolean);
  const parts = [`${p.w}×${p.d}`, `${p.h}u`];
  if (p.cx * p.cy > 1) parts.push(`${p.cx}×${p.cy} compartments`);
  if (f.length) parts.push(f.join(', '));
  return parts.join(' · ');
}

/** Stable key for a set of parameters (same parameters = same bin). */
export function binKey(p) {
  const b = normalizeBin(p);
  return `${b.w}x${b.d}x${b.h}${b.lip ? 'L' : ''}${b.magnets ? 'M' : ''}${b.screws ? 'S' : ''}c${b.cx}x${b.cy}${b.scoop ? 'P' : ''}${b.label ? 'T' : ''}`;
}

// ---------------------------------------------------------------- Manifold

let wasmPromise = null;
/** Loads Manifold once (~0.6 MB, only when bins are generated). */
export function manifold() {
  wasmPromise ||= import('../vendor/manifold/manifold.js')
    .then(({ default: Module }) => Module())
    .then((m) => {
      m.setup();
      return m;
    })
    .catch((e) => {
      wasmPromise = null;
      throw new Error(`Couldn't load the geometry engine (${e.message})`);
    });
  return wasmPromise;
}

const SEG = 8; // segments per rounded corner

/** Rounded-rectangle outline points at height z, centred on (cx, cy). */
function rr(w, d, r, z, cx = 0, cy = 0) {
  r = Math.max(0.2, Math.min(r, w / 2 - 0.01, d / 2 - 0.01));
  const hx = w / 2 - r;
  const hy = d / 2 - r;
  const pts = [];
  for (const [ox, oy, a0] of [
    [hx, hy, 0],
    [-hx, hy, 90],
    [-hx, -hy, 180],
    [hx, -hy, 270],
  ]) {
    for (let i = 0; i <= SEG; i++) {
      const a = ((a0 + (90 * i) / SEG) * Math.PI) / 180;
      pts.push([cx + ox + r * Math.cos(a), cy + oy + r * Math.sin(a), z]);
    }
  }
  return pts;
}

/**
 * Solid swept through rounded-rectangle sections (each { w, d, r, z }), as the
 * union of the convex hulls of consecutive sections, so non-convex profiles
 * (chamfer, straight, chamfer) come out exactly.
 */
function loft(M, sections, cx = 0, cy = 0) {
  const pieces = [];
  for (let i = 0; i + 1 < sections.length; i++) {
    const a = sections[i];
    const b = sections[i + 1];
    pieces.push(M.Manifold.hull([...rr(a.w, a.d, a.r, a.z, cx, cy), ...rr(b.w, b.d, b.r, b.z, cx, cy)]));
  }
  return pieces.length === 1 ? pieces[0] : M.Manifold.union(pieces);
}

/** Straight rounded-rectangle prism from z0 to z1. */
const prism = (M, w, d, r, z0, z1, cx = 0, cy = 0) => loft(M, [{ w, d, r, z: z0 }, { w, d, r, z: z1 }], cx, cy);

/**
 * Builds a bin. Returns { manifold, mesh, triangles, volume (mm³), grams,
 * height (mm) }. The caller owns `manifold` (call .delete() when done).
 */
export async function generateBin(params) {
  const M = await manifold();
  const p = normalizeBin(params);
  const { pitch, wall, divider, radius: R } = SPEC;
  const [W, D] = outerSize(p);
  const H = p.h * SPEC.unit; // wall top
  const top = binHeight(p);
  const zFloor = floorTop(p);
  const cell = pitch - SPEC.gap;
  const cellCentres = [];
  for (let i = 0; i < p.w; i++) for (let j = 0; j < p.d; j++) cellCentres.push([(i - (p.w - 1) / 2) * pitch, (j - (p.d - 1) / 2) * pitch]);

  const trash = []; // intermediate manifolds to free
  const keep = (m) => (trash.push(m), m);
  try {
    // ---- solid: feet + body
    const feet = cellCentres.map(([x, y]) =>
      keep(loft(M, SPEC.foot.map(([z, inset, r]) => ({ w: cell - 2 * inset, d: cell - 2 * inset, r, z })), x, y)),
    );
    const body = keep(prism(M, W, D, R, SPEC.foot.at(-1)[0] - 0.05, top));
    let solid = keep(M.Manifold.union([...feet, body]));

    // ---- cavity
    const innerW = W - 2 * wall;
    const innerD = D - 2 * wall;
    const rIn = Math.max(0.6, R - wall);
    const divTop = p.lip ? H + SPEC.lip[0][0] : H; // dividers end where the lip support starts
    const cavity = [];
    // Compartments below the divider top.
    const pw = (innerW - (p.cx - 1) * divider) / p.cx;
    const pd = (innerD - (p.cy - 1) * divider) / p.cy;
    const pockets = [];
    for (let i = 0; i < p.cx; i++) {
      for (let j = 0; j < p.cy; j++) {
        const x = -innerW / 2 + pw / 2 + i * (pw + divider);
        const y = -innerD / 2 + pd / 2 + j * (pd + divider);
        pockets.push({ x, y });
        const r = p.cx * p.cy === 1 ? rIn : Math.min(rIn, 1.5);
        cavity.push(keep(prism(M, pw, pd, r, zFloor, divTop + 0.01, x, y)));
      }
    }
    if (p.lip) {
      // Lip: sections relative to the wall top, insets from the outer outline.
      const secs = SPEC.lip.map(([h, inset]) => ({ w: W - 2 * inset, d: D - 2 * inset, r: Math.max(0.6, R - inset), z: H + h }));
      secs.push({ ...secs.at(-1), z: top + 1 }); // cut through the top
      cavity.push(keep(loft(M, secs)));
    } else {
      cavity.push(keep(prism(M, innerW, innerD, rIn, divTop, top + 1)));
    }

    // ---- magnet / screw holes under every cell
    const holes = [];
    for (const [x, y] of cellCentres) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const hx = x + sx * SPEC.holeOffset;
          const hy = y + sy * SPEC.holeOffset;
          if (p.magnets) holes.push(keep(M.Manifold.cylinder(SPEC.magnet.h, SPEC.magnet.d / 2, SPEC.magnet.d / 2, 32).translate(hx, hy, -0.01)));
          if (p.screws) holes.push(keep(M.Manifold.cylinder(SPEC.screw.h, SPEC.screw.d / 2, SPEC.screw.d / 2, 24).translate(hx, hy, -0.01)));
        }
      }
    }
    solid = keep(M.Manifold.difference([solid, ...cavity, ...holes]));

    // ---- additions inside the compartments
    const adds = [];
    const depth = divTop - zFloor;
    if (p.scoop && depth > 4) {
      // Quarter-round fillet along the front wall of each compartment.
      const rs = Math.min(depth * 0.6, pd * 0.5, 15);
      for (const { x, y } of pockets) {
        const y0 = y - pd / 2; // front face of the pocket
        const block = M.Manifold.cube([pw + 0.02, rs, rs]).translate(x - pw / 2 - 0.01, y0 - 0.01, zFloor - 0.01);
        const round = M.Manifold.cylinder(pw + 0.2, rs, rs, 48).rotate([0, 90, 0]).translate(x - pw / 2 - 0.1, y0 + rs, zFloor + rs);
        adds.push(keep(M.Manifold.difference(keep(block), keep(round))));
      }
    }
    if (p.label && depth > 6) {
      // 45° shelf along the back wall of each compartment, flush with the divider top.
      const ld = Math.min(12, pd * 0.45, depth - 1);
      for (const { x, y } of pockets) {
        const yb = y + pd / 2 + 0.01; // back face of the pocket
        const zt = divTop - (p.lip ? 0 : 0.6);
        const tri = [
          [yb, zt],
          [yb - ld, zt],
          [yb, zt - ld],
        ];
        const pts = [];
        for (const xx of [x - pw / 2 - 0.01, x + pw / 2 + 0.01]) for (const [yy, zz] of tri) pts.push([xx, yy, zz]);
        adds.push(keep(M.Manifold.hull(pts)));
      }
    }
    if (adds.length) solid = M.Manifold.union([solid, ...adds]);
    else trash.splice(trash.indexOf(solid), 1); // returned to the caller

    if (solid.status && solid.status() !== 'NoError' && solid.status() !== 0) throw new Error(`geometry error: ${solid.status()}`);
    const mesh = solid.getMesh();
    const volume = solid.volume();
    return {
      params: p,
      manifold: solid,
      mesh,
      triangles: mesh.triVerts.length / 3,
      volume,
      grams: (volume / 1000) * SPEC.pla,
      height: top,
      size: [W, D, top],
    };
  } finally {
    for (const m of trash) m.delete?.();
  }
}

/** Binary STL (Z up, millimetres) from a Manifold mesh. */
export function meshToSTL(mesh, name = 'gridfinity bin') {
  const { vertProperties: v, triVerts: t, numProp: np } = mesh;
  const n = t.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = `VAULT Configurator ${name}`.slice(0, 79);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < n; i++) {
    const a = t[3 * i] * np, b = t[3 * i + 1] * np, c = t[3 * i + 2] * np;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const val of [nx, ny, nz, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]]) {
      dv.setFloat32(o, val, true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/**
 * Indexed positions for three.js from a Manifold mesh, turned to the viewer's
 * Y-up frame (file X → X, file Z → Y, file Y → −Z so the front faces +Z).
 */
export function meshToPositions(mesh) {
  const { vertProperties: v, triVerts: t, numProp: np } = mesh;
  const n = v.length / np;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[3 * i] = v[i * np];
    pos[3 * i + 1] = v[i * np + 2];
    pos[3 * i + 2] = -v[i * np + 1];
  }
  return { positions: pos, index: new Uint32Array(t) };
}
