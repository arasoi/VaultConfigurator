// Axis fitting shared by the viewer and the interface orienter.
import * as THREE from 'three';

const PERMS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/**
 * Picks the axis permutation that best maps the mesh's normalized size onto
 * the expected [width, height, depth]; returns a rotation matrix (no mirroring).
 */
export function fitAxes(size, expect) {
  let best = PERMS[0];
  let bestCost = Infinity;
  for (const p of PERMS) {
    let cost = 0;
    for (let i = 0; i < 3; i++) {
      const e = expect?.[i];
      if (e == null) continue;
      cost += Math.abs(size[p[i]] - e) / Math.max(e, 1);
    }
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = p;
    }
  }
  const rows = [0, 1, 2].map((i) => {
    const r = [0, 0, 0];
    r[best[i]] = 1;
    return r;
  });
  // Odd permutations are reflections; flip one axis to keep a proper rotation.
  const det =
    rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1]) -
    rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0]) +
    rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0]);
  if (det < 0) rows[0] = rows[0].map((v) => -v);
  const m = new THREE.Matrix4();
  m.set(...rows[0], 0, ...rows[1], 0, ...rows[2], 0, 0, 0, 0, 1);
  return m;
}
