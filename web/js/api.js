// Data access: catalog, preview meshes, file URLs.
import * as THREE from 'three';

let catalogPromise = null;

/** Loads the catalog once. Returns { parts, byId }. */
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('/api/catalog')
      .then((r) => {
        if (!r.ok) throw new Error(`catalog: HTTP ${r.status}`);
        return r.json();
      })
      .then((c) => {
        c.byId = new Map(c.parts.map((p) => [p.id, p]));
        return c;
      });
  }
  return catalogPromise;
}

export const fileUrl = (id, download = false) => `/api/file/${id}${download ? '?download' : ''}`;

/** items: [{ id, qty, color? }] — color is a filament name; files are grouped into one folder per color. */
export function zipUrl(name, items) {
  const list = items
    .map((it) => `${it.id}${it.qty > 1 ? `*${it.qty}` : ''}${it.color ? `~${encodeURIComponent(it.color)}` : ''}`)
    .join(',');
  return `/api/zip?name=${encodeURIComponent(name)}&items=${list}`;
}

const meshCache = new Map(); // id -> Promise<{geometry, size, srcTris}>

/**
 * Fetches and decodes a preview mesh (see internal/mesh/format.go).
 * The geometry is centered at the origin with its tightest bounding box
 * aligned to the axes; callers decide which axis is width/height/depth.
 */
export function loadPreview(id) {
  if (!meshCache.has(id)) {
    // Previews revalidate by ETag. The query string only skips copies browsers
    // cached under the old day-long max-age; it never needs bumping again.
    const p = fetch(`/api/preview/${id}?r=2`)
      .then((r) => {
        if (!r.ok) throw new Error(`preview ${id}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(decodePreview)
      .catch((e) => {
        meshCache.delete(id); // allow retry
        throw e;
      });
    meshCache.set(id, p);
  }
  return meshCache.get(id);
}

function decodePreview(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'VMS1') throw new Error('bad preview format');
  const nv = dv.getUint32(4, true);
  const nt = dv.getUint32(8, true);
  const srcTris = dv.getUint32(12, true);
  const size = [dv.getFloat32(16, true), dv.getFloat32(20, true), dv.getFloat32(24, true)];
  const posOff = 76;
  const idxOff = posOff + nv * 12;
  const pos = new Float32Array(buf.slice(posOff, idxOff));
  const idx = new Uint32Array(buf.slice(idxOff, idxOff + nt * 12));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  geometry.computeBoundingBox();
  return { geometry, size, srcTris, tris: nt };
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}
