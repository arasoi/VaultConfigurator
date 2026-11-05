// Data access: catalog, preview meshes, file URLs.
import * as THREE from 'three';

let catalogPromise = null;

function indexCatalog(c) {
  c.parts ||= [];
  c.byId = new Map(c.parts.map((p) => [p.id, p]));
  return c;
}

/**
 * Loads the catalog once. Returns { parts, byId, data } where data describes
 * the data folder ({ dir, found, error, parts, skipped }).
 */
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('/api/catalog')
      .then((r) => {
        if (!r.ok) throw new Error(`catalog: HTTP ${r.status}`);
        return r.json();
      })
      .then(indexCatalog)
      .catch((e) => {
        catalogPromise = null; // allow retry
        throw e;
      });
  }
  return catalogPromise;
}

/** Asks the server to read the data folder again; returns the new catalog. */
export async function rescanCatalog() {
  const r = await fetch('/api/rescan', { method: 'POST' });
  if (!r.ok) throw new Error(`rescan: HTTP ${r.status}`);
  const c = indexCatalog(await r.json());
  catalogPromise = Promise.resolve(c);
  meshCache.clear();
  return c;
}

export const fileUrl = (id, download = false) => `/api/file/${id}${download ? '?download' : ''}`;

/** items: [{ id, qty, color? }] — color is a filament name; files are grouped into one folder per color. */
export function zipUrl(name, items) {
  const list = items
    .map((it) => `${it.id}${it.qty > 1 ? `*${it.qty}` : ''}${it.color ? `~${encodeURIComponent(it.color)}` : ''}`)
    .join(',');
  return `/api/zip?name=${encodeURIComponent(name)}&items=${list}`;
}

const meshCache = new Map(); // `${id}|${lod}` -> Promise<{geometry, size, srcTris, tris}>

/** A preview that couldn't be loaded; `reason` is the server's explanation. */
export class PreviewError extends Error {
  constructor(id, status, reason) {
    super(reason || `HTTP ${status}`);
    this.id = id;
    this.status = status;
    this.reason = reason || (status ? `the server answered HTTP ${status}` : 'the server could not be reached');
  }
}

/**
 * Fetches and decodes a preview mesh (see internal/mesh/format.go).
 * The geometry is centered at the origin with its tightest bounding box
 * aligned to the axes; callers decide which axis is width/height/depth.
 * lod: 'full' (one part on its own) or 'build' (lighter, for assembled
 * builds; small parts get fewer triangles).
 */
export function loadPreview(id, lod = 'full') {
  const key = `${id}|${lod}`;
  if (!meshCache.has(key)) {
    // Previews revalidate by ETag (cheap 304s).
    const p = fetch(`/api/preview/${id}?lod=${lod}`)
      .catch(() => {
        throw new PreviewError(id, 0, '');
      })
      .then(async (r) => {
        if (!r.ok) throw new PreviewError(id, r.status, (await r.text().catch(() => '')).trim());
        return r.arrayBuffer();
      })
      .then((buf) => {
        try {
          return decodePreview(buf);
        } catch (e) {
          throw new PreviewError(id, 200, `the preview data is damaged (${e.message})`);
        }
      })
      .catch((e) => {
        meshCache.delete(key); // allow retry
        throw e;
      });
    meshCache.set(key, p);
  }
  return meshCache.get(key);
}

function decodePreview(buf) {
  if (buf.byteLength < 76) throw new Error('too short');
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'VMS1') throw new Error('unknown format');
  const nv = dv.getUint32(4, true);
  const nt = dv.getUint32(8, true);
  const srcTris = dv.getUint32(12, true);
  const size = [dv.getFloat32(16, true), dv.getFloat32(20, true), dv.getFloat32(24, true)];
  const posOff = 76;
  const idxOff = posOff + nv * 12;
  if (idxOff + nt * 12 > buf.byteLength) throw new Error('truncated');
  if (!nt) throw new Error('no triangles');
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
