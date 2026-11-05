// three.js viewer for assembled builds and single parts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadPreview } from './api.js';
import { MOUNT_FACE, interfaceRotation, mountFaceRotation, orientsByInterface } from './orient.js';
import { COLORS, ORIENT_BY_NAME, ORIENT_BY_ROLE, layout } from './rules.js';
import { hardwareGeometry, hardwareMaterial, poseHardware } from './hardware.js';
import { fitAxes } from './viewer-fit.js';

export { fitAxes };

function extraRotation(rot) {
  const m = new THREE.Matrix4();
  if (!rot) return m;
  const e = new THREE.Euler(
    THREE.MathUtils.degToRad(rot.x || 0),
    THREE.MathUtils.degToRad(rot.y || 0),
    THREE.MathUtils.degToRad(rot.z || 0),
  );
  return m.makeRotationFromEuler(e);
}

/**
 * Smooth shading that keeps sharp edges: each vertex gets one normal per group
 * of its faces that bend less than `creaseDeg` against each other (area-weighted
 * average), so fillets and curves render smooth while box edges stay crisp.
 * Vertices are split where groups differ. Run last: it breaks the vertex
 * sharing that body splitting and orientation rely on.
 */
function creasedNormals(g, creaseDeg = 35) {
  const pos = g.attributes.position.array;
  const idx = g.index.array;
  const nv = pos.length / 3;
  const nt = idx.length / 3;
  const fn = new Float32Array(nt * 3); // area-weighted face normals
  const un = new Float32Array(nt * 3); // the same, unit length
  for (let t = 0; t < nt; t++) {
    const a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1;
    fn[3 * t] = x;
    fn[3 * t + 1] = y;
    fn[3 * t + 2] = z;
    un[3 * t] = x / l;
    un[3 * t + 1] = y / l;
    un[3 * t + 2] = z / l;
  }
  // vertex -> incident faces (CSR)
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < idx.length; i++) start[idx[i] + 1]++;
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nv);
  const faces = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) faces[fill[idx[i]]++] = (i / 3) | 0;

  const cos = Math.cos(THREE.MathUtils.degToRad(creaseDeg));
  // At most one output vertex per corner.
  const outPos = new Float32Array(idx.length * 3);
  const outNrm = new Float32Array(idx.length * 3);
  const outIdx = new Uint32Array(idx.length);
  const taken = new Uint8Array(faces.length);
  let n = 0;
  for (let v = 0; v < nv; v++) {
    const f0 = start[v], f1 = start[v + 1];
    for (let i = f0; i < f1; i++) {
      if (taken[i]) continue;
      const s = faces[i] * 3;
      const sx0 = un[s], sy0 = un[s + 1], sz0 = un[s + 2];
      let sx = 0, sy = 0, sz = 0;
      for (let j = i; j < f1; j++) {
        if (taken[j]) continue;
        const t = faces[j];
        if (un[3 * t] * sx0 + un[3 * t + 1] * sy0 + un[3 * t + 2] * sz0 < cos) continue;
        taken[j] = 1;
        sx += fn[3 * t];
        sy += fn[3 * t + 1];
        sz += fn[3 * t + 2];
        for (let k = 0; k < 3; k++) if (idx[3 * t + k] === v) outIdx[3 * t + k] = n;
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      outPos[3 * n] = pos[3 * v];
      outPos[3 * n + 1] = pos[3 * v + 1];
      outPos[3 * n + 2] = pos[3 * v + 2];
      outNrm[3 * n] = sx / l;
      outNrm[3 * n + 1] = sy / l;
      outNrm[3 * n + 2] = sz / l;
      n++;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outPos.slice(0, 3 * n), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(outNrm.slice(0, 3 * n), 3));
  out.setIndex(new THREE.BufferAttribute(outIdx, 1));
  out.userData = { ...g.userData };
  out.computeBoundingBox();
  return out;
}

const materials = new Map();
const colorMaterials = new Map();
function colorMaterial(hex) {
  if (!colorMaterials.has(hex)) {
    colorMaterials.set(hex, new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.75, metalness: 0.05 }));
  }
  return colorMaterials.get(hex);
}

function materialFor(role) {
  if (!materials.has(role)) {
    materials.set(
      role,
      new THREE.MeshStandardMaterial({
        color: COLORS[role] ?? COLORS.part,
        roughness: 0.75,
        metalness: 0.05,
      }),
    );
  }
  return materials.get(role);
}
const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.25, depthWrite: false });
// Parts whose file is missing or unreadable: a red see-through box at the
// part's nominal size, still clickable so the part card can say why.
const missingMat = new THREE.MeshStandardMaterial({ color: 0xd9534f, transparent: true, opacity: 0.4, depthWrite: false });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);

/** Everything (besides the file) that determines a placement's oriented geometry. */
function geoKey(pl) {
  return `${pl.role}|${JSON.stringify(pl.expect)}|${pl.iface?.key || ''}|${JSON.stringify(pl.rot || null)}|${pl.body || ''}|${JSON.stringify(pl.xform || null)}|${pl.mount || ''}|${JSON.stringify(pl.hw || null)}`;
}

/**
 * Explicit placement from measured file coordinates (used for hinges): keep
 * one body (by which side of an axis its centre lies), move `origin` (in the
 * file's preview frame) to 0, then remap axes with `rows`. Not re-centred —
 * the mesh origin is the anchor the layout positions.
 */
function applyXform(g, xf) {
  // One filter, or several applied in turn (e.g. one pin out of a set of four).
  for (const b of [].concat(xf.body || [])) keepBodyBySide(g, b.axis, b.sign);
  g.translate(-xf.origin[0], -xf.origin[1], -xf.origin[2]);
  const r = xf.rows;
  g.applyMatrix4(new THREE.Matrix4().set(...r[0], 0, ...r[1], 0, ...r[2], 0, 0, 0, 0, 1));
  g.computeBoundingBox();
}

/**
 * Connected bodies of an indexed geometry: for each vertex the id of its body,
 * plus per body its vertex count, mean position and Y range.
 */
function connectedBodies(g) {
  const idx = g.index.array;
  const pos = g.attributes.position.array;
  const n = pos.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]);
    parent[find(idx[t + 1])] = a;
    parent[find(idx[t + 2])] = a;
  }
  const label = new Int32Array(n);
  const bodies = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    label[i] = r;
    let b = bodies.get(r);
    if (!b) bodies.set(r, (b = { count: 0, sum: [0, 0, 0], lo: Infinity, hi: -Infinity }));
    b.count++;
    b.sum[0] += pos[3 * i];
    b.sum[1] += pos[3 * i + 1];
    b.sum[2] += pos[3 * i + 2];
    if (pos[3 * i + 1] < b.lo) b.lo = pos[3 * i + 1];
    if (pos[3 * i + 1] > b.hi) b.hi = pos[3 * i + 1];
  }
  return { label, bodies };
}

/** Keeps only the triangles of the given bodies, with compact buffers (so bounding boxes only see them). */
function keepBodies(g, label, keep) {
  const idx = g.index.array;
  const pos = g.attributes.position.array;
  const remap = new Int32Array(pos.length / 3).fill(-1);
  const newPos = new Float32Array(pos.length);
  const newIdx = new Uint32Array(idx.length);
  let nv = 0;
  let ni = 0;
  for (let t = 0; t < idx.length; t += 3) {
    if (!keep.has(label[idx[t]])) continue;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k];
      if (remap[v] < 0) {
        remap[v] = nv;
        newPos[3 * nv] = pos[3 * v];
        newPos[3 * nv + 1] = pos[3 * v + 1];
        newPos[3 * nv + 2] = pos[3 * v + 2];
        nv++;
      }
      newIdx[ni++] = remap[v];
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(newPos.slice(0, 3 * nv), 3));
  g.setIndex(new THREE.BufferAttribute(newIdx.slice(0, ni), 1));
}

/** Keeps the bodies whose centre lies on one side (sign) of an axis. */
function keepBodyBySide(g, axis, sign) {
  const { label, bodies } = connectedBodies(g);
  const keep = new Set([...bodies].filter(([, b]) => b.count > 20 && Math.sign(b.sum[axis] / b.count) === sign).map(([r]) => r));
  if (keep.size) keepBodies(g, label, keep);
}

/**
 * Some STL files hold several separate parts (e.g. the two geared racks).
 * Keeps one connected body in place: 'tallest' / 'shortest' by height (Y).
 */
function pickBody(g, which) {
  const { label, bodies } = connectedBodies(g);
  const list = [...bodies].filter(([, b]) => b.count > 20).sort((x, y) => x[1].hi - x[1].lo - (y[1].hi - y[1].lo));
  if (list.length < 2) return;
  keepBodies(g, label, new Set([(which === 'shortest' ? list[0] : list[list.length - 1])[0]]));
}

export class Viewer {
  /**
   * lod: preview level of detail to load ('build' for assembled builds, where
   * small parts need fewer triangles; 'full' for single parts).
   */
  constructor(container, { onPick, onContext, onStatus, onLayout, colorOf, lod = 'full' } = {}) {
    this.container = container;
    this.lod = lod;
    this.colorOf = colorOf;
    this.onPick = onPick;
    this.onContext = onContext; // right-click (or long press) on a part: (pl, {x, y})
    this.onStatus = onStatus;
    this.onLayout = onLayout;
    this.objects = new Map(); // placement key -> { mesh, pl, dims, loaded }
    this.geoCache = new Map(); // `${partId}|${geoKey}` -> Promise<{ geometry, dims, fileToLocal }>, oldest first
    this.opts = { open: 0, explode: 0, solo: null };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 5, 50000);
    this.camera.position.set(900, 800, 1300);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 300, 0);
    // Draw only when something changed (camera, layout, colors, size): an
    // assembled build can be millions of triangles, too many to redraw 60
    // times a second while nothing moves.
    this._dirty = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(800, 1600, 1000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; // no striping ("acne") on large flat faces
    sun.shadow.normalBias = 0.6;
    Object.assign(sun.shadow.camera, { left: -1200, right: 1200, top: 1200, bottom: -1200, near: 10, far: 5000 });
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-900, 400, -600);
    this.scene.add(fill);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShadowMaterial({ opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.grid = new THREE.GridHelper(4000, 80, 0x888888, 0x888888);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.15;
    this.scene.add(this.grid);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this._setupPicking();
    this._resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.requestRender();
    };
    new ResizeObserver(this._resize).observe(container);
    this._resize();
    const tick = () => {
      requestAnimationFrame(tick);
      this.controls.update(); // emits 'change' while damping settles
      if (!this._dirty) return;
      this._dirty = false;
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  /** Schedules a redraw on the next animation frame. */
  requestRender() {
    this._dirty = true;
  }

  _setupPicking() {
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector2();
    let down = null;
    const el = this.renderer.domElement;
    const keyAt = (e) => {
      const r = el.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, this.camera);
      const hit = ray.intersectObjects(this.root.children, false).find((h) => h.object.visible);
      const key = hit?.object.userData.key;
      return key && this.objects.get(key)?.hw ? this.objects.get(key).pl.host : key; // a bolt picks its part
    };
    el.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY, performance.now()]));
    // A click (not a drag): left selects, right (or a long press on touch) opens
    // the part's menu. Right-drag still pans.
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const long = e.pointerType === 'touch' && performance.now() - down[2] > 500;
      if (e.button !== 0 && e.button !== 2) return;
      const key = keyAt(e);
      const pl = key ? this.objects.get(key).pl : null;
      if (e.button === 2 || long) {
        if (!pl) return;
        this.select(key);
        this.onContext?.(pl, { x: e.clientX, y: e.clientY });
        return;
      }
      this.select(key || null);
      this.onPick?.(pl);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Material for a placement: its resolved color, else the role default. */
  _mat(pl) {
    if (pl.hw) return hardwareMaterial(pl.hw.kind, this.build?.hwFinish, this.renderer);
    if (pl.role === 'rod') return hardwareMaterial('rod', null, this.renderer);
    const hex = this.colorOf?.(pl);
    return hex ? colorMaterial(hex) : materialFor(pl.role);
  }

  select(key) {
    this.selected = key;
    this.recolor();
  }

  /**
   * Re-applies colors (after a color change) without reloading meshes. The
   * selected part keeps its true color and gets an outline box instead of a
   * tint, so picked colors can be judged.
   */
  recolor() {
    for (const [, o] of this.objects) {
      if (o.loaded) o.mesh.material = this._mat(o.pl);
    }
    this._updateSelectionBox();
    this.requestRender();
  }

  _updateSelectionBox() {
    this.requestRender();
    const o = this.selected && this.objects.get(this.selected);
    if (!o || !(o.loaded || o.failed) || !o.mesh.visible) {
      if (this.selBox) this.selBox.visible = false;
      return;
    }
    if (!this.selBox) {
      this.selBox = new THREE.BoxHelper(o.mesh, 0xf07c2c);
      this.selBox.material.depthTest = false;
      this.selBox.material.transparent = true;
      this.selBox.renderOrder = 10;
      this.scene.add(this.selBox);
    }
    this.selBox.setFromObject(o.mesh);
    this.selBox.visible = true;
  }

  /** Highlights all placements using a given part id. */
  selectPart(partId) {
    const key = [...this.objects.entries()].find(([, o]) => o.pl.partId === partId)?.[0] || null;
    this.select(key);
  }



  setOptions(opts) {
    Object.assign(this.opts, opts);
    this._relayout();
  }

  /** Shows a resolved build. Reuses meshes whose placement key + part match. */
  setBuild(build, res) {
    this.mode = 'build';
    this.build = build;
    this.res = res;
    const keep = new Set();
    for (const pl of res.placements) {
      // Reuse a mesh only if everything that shapes its geometry is unchanged.
      const id = `${pl.key}|${pl.partId || 'ph'}|${geoKey(pl)}`;
      keep.add(pl.key);
      const cur = this.objects.get(pl.key);
      if (cur && cur.id === id) {
        cur.pl = pl;
        if (cur.hw) cur.mesh.material = this._mat(pl); // screw finish may have changed
        continue;
      }
      if (cur) this.root.remove(cur.mesh);
      const mesh = new THREE.Mesh(unitBox, placeholderMat);
      mesh.userData.key = pl.key;
      this.root.add(mesh);
      const o = { id, mesh, pl, dims: null, loaded: false };
      this.objects.set(pl.key, o);
      if (pl.partId) this._load(o);
      else if (pl.hw) {
        // Purchased hardware: drawn procedurally, posed from its host in _relayout.
        mesh.geometry = hardwareGeometry(pl.hw);
        mesh.material = this._mat(pl);
        mesh.castShadow = true;
        mesh.visible = false; // until its host is loaded and posed
        o.loaded = true;
        o.hw = true;
      } else if (pl.role === 'backbone' || pl.role === 'rod') {
        // Backbones are drawn as solid blocks (one per level), rods as cylinders.
        o.loaded = true;
        mesh.geometry = pl.role === 'rod' ? unitCylinder : unitBox;
        mesh.material = this._mat(pl);
        mesh.castShadow = true;
        o.solidBox = true;
      } else this._fail(o, 'there is no file for this part in the data folder');
    }
    for (const [k, o] of this.objects) {
      if (!keep.has(k)) {
        this.root.remove(o.mesh);
        this.objects.delete(k);
      }
    }
    this._pruneGeometry();
    this.recolor();
    this._relayout();
    this._status();
  }

  async _load(o) {
    const { partId, role } = o.pl;
    const ck = `${partId}|${geoKey(o.pl)}`;
    try {
      if (this.geoCache.has(ck)) {
        // Most recently used last (see _pruneGeometry).
        const p = this.geoCache.get(ck);
        this.geoCache.delete(ck);
        this.geoCache.set(ck, p);
      } else {
        this.geoCache.set(
          ck,
          loadPreview(partId, this.lod).then(async (pv) => {
            const g = pv.geometry.clone();
            if (o.pl.xform) {
              applyXform(g, o.pl.xform);
              g.userData.orientedBy = 'measured (file coordinates)';
              const s = g.boundingBox.getSize(new THREE.Vector3());
              const r = o.pl.xform.rows;
              const [ox, oy, oz] = o.pl.xform.origin;
              const fileToLocal = new THREE.Matrix4().set(...r[0], 0, ...r[1], 0, ...r[2], 0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeTranslation(-ox, -oy, -oz));
              return { geometry: creasedNormals(g), dims: [s.x, s.y, s.z], fileToLocal };
            }
            // fileToLocal: every transform applied below, so hardware can be
            // placed at points measured in this part's file (see hardware.js).
            const fileToLocal = new THREE.Matrix4();
            const apply = (m) => {
              g.applyMatrix4(m);
              fileToLocal.premultiply(m);
            };
            apply(fitAxes(pv.size, o.pl.expect));
            g.computeBoundingBox();
            // Stacking parts: orient by matching their connecting face to the
            // footprint's interface (see orient.js). Others: static rules.
            const named = ORIENT_BY_NAME.find(([re]) => re.test(o.pl.name || ''));
            const auto = !named && orientsByInterface(role) ? await interfaceRotation(g, role, o.pl.iface) : null;
            apply(auto ? auto.matrix : extraRotation(named?.[1] || ORIENT_BY_ROLE[role]));
            if (o.pl.rot) apply(extraRotation(o.pl.rot));
            if (o.pl.body) pickBody(g, o.pl.body);
            // Mount face: the side screwed/resting against its host should be the flat one.
            const face = !auto && !named ? o.pl.mount || MOUNT_FACE[role] : null;
            const flip = face ? mountFaceRotation(g, face) : null;
            if (flip) apply(flip.matrix);
            g.userData.orientedBy = auto
              ? `interface:${auto.name} (${auto.score.toFixed(2)})`
              : face
                ? `mount face ${face}${flip ? ` (flipped: ${flip.there.toFixed(2)} vs ${flip.here.toFixed(2)})` : ' (ok)'}`
                : 'static';
            g.computeBoundingBox();
            const bb = g.boundingBox;
            const c = bb.getCenter(new THREE.Vector3());
            apply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
            const s = bb.getSize(new THREE.Vector3());
            return { geometry: creasedNormals(g), dims: [s.x, s.y, s.z], fileToLocal };
          }),
        );
      }
      const { geometry, dims, fileToLocal } = await this.geoCache.get(ck);
      if (this.objects.get(o.pl.key) !== o) return; // replaced meanwhile
      o.mesh.geometry = geometry;
      o.mesh.material = this._mat(o.pl);
      if (this.selected === o.pl.key) this._updateSelectionBox();
      o.mesh.castShadow = true;
      o.mesh.receiveShadow = true;
      o.mesh.scale.set(1, 1, 1);
      o.dims = dims;
      o.fileToLocal = fileToLocal;
      o.loaded = true;
      o.failed = null;
    } catch (e) {
      this.geoCache.delete(ck);
      if (this.objects.get(o.pl.key) !== o) return;
      console.warn(`part ${o.pl.name || partId}:`, e);
      this._fail(o, e.reason || e.message);
    }
    this._relayout();
    this._status();
  }

  /** Marks a placement as not loadable; it stays as a red box at its nominal size. */
  _fail(o, reason) {
    o.failed = reason || 'unknown error';
    o.loaded = false;
    o.mesh.geometry = unitBox;
    o.mesh.material = missingMat;
    o.mesh.castShadow = false;
  }

  /** Why a placement couldn't be drawn ('' if it was). */
  failure(key) {
    return this.objects.get(key)?.failed || '';
  }

  /** Tries the parts that failed to load again (e.g. after fixing the data folder). */
  retryFailed() {
    for (const o of this.objects.values()) {
      if (!o.failed || !o.pl.partId) continue;
      o.failed = null;
      o.mesh.material = placeholderMat;
      this._load(o);
    }
    this._status();
  }

  /**
   * Frees geometry no current placement uses, keeping the most recently used
   * ones so toggling an option back and forth stays instant.
   */
  _pruneGeometry(keepUnused = 60) {
    const used = new Set();
    for (const o of this.objects.values()) if (o.pl.partId) used.add(`${o.pl.partId}|${geoKey(o.pl)}`);
    const unused = [...this.geoCache.keys()].filter((k) => !used.has(k));
    for (const k of unused.slice(0, Math.max(0, unused.length - keepUnused))) {
      const p = this.geoCache.get(k);
      this.geoCache.delete(k);
      p.then((r) => r.geometry.dispose(), () => {});
    }
  }

  _status() {
    let total = 0;
    let done = 0;
    const failed = [];
    for (const o of this.objects.values()) {
      if (o.failed) failed.push({ pl: o.pl, reason: o.failed });
      if (!o.pl.partId) continue;
      total++;
      if (o.loaded || o.failed) done++;
    }
    this.onStatus?.({ total, done, failed });
  }

  _relayout() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (this.mode !== 'build' || !this.res) return;
      const L = layout(this.build, this.res, (pl) => this.objects.get(pl.key)?.dims || null, this.opts);
      for (const [key, t] of L.transforms) {
        const o = this.objects.get(key);
        if (!o) continue;
        o.mesh.position.set(t.x, t.y, t.z);
        o.mesh.rotation.x = t.rx || 0;
        if (!o.dims || o.solidBox) o.mesh.scale.set(t.w, t.h, t.d);
        o.mesh.visible = true;
      }
      for (const [key, o] of this.objects) if (!L.transforms.has(key)) o.mesh.visible = false;
      // Hardware follows its host (after the hosts are placed).
      const showHw = this.build?.showHardware !== false;
      for (const o of this.objects.values()) {
        if (o.hw) o.mesh.visible = showHw && poseHardware(o.mesh, o.pl, this.objects.get(o.pl.host));
      }
      this.lastLayout = L;
      this._updateSelectionBox();
      this.requestRender();
      this.onLayout?.(L);
      if (!this._fitted) {
        this.fit();
        this._fitted = true;
      }
    });
  }

  /** Library mode: one part, laid flat on its largest face. */
  async showPart(part) {
    this.mode = 'single';
    for (const o of this.objects.values()) this.root.remove(o.mesh);
    this.objects.clear();
    this.requestRender();
    const token = (this._single = {});
    const pv = await loadPreview(part.id, this.lod);
    if (this._single !== token) return;
    const g = pv.geometry.clone();
    // Smallest extent -> up (Y), largest -> X.
    const order = [0, 1, 2].sort((a, b) => pv.size[b] - pv.size[a]);
    const want = [];
    want[0] = pv.size[order[0]];
    want[2] = pv.size[order[1]];
    want[1] = pv.size[order[2]];
    g.applyMatrix4(fitAxes(pv.size, want));
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const c = bb.getCenter(new THREE.Vector3());
    g.translate(-c.x, -bb.min.y, -c.z);
    const mesh = new THREE.Mesh(creasedNormals(g), materialFor('part'));
    mesh.castShadow = true;
    mesh.userData.key = 'single';
    this.root.add(mesh);
    this.objects.set('single', { mesh, pl: { key: 'single', partId: part.id, role: 'part' }, loaded: true });
    this.fit();
    this.requestRender();
    return pv;
  }

  /**
   * Shows a generated mesh (Y up, already in its final orientation) standing
   * on the ground, e.g. a Gridfinity bin. refit: frame the camera on it.
   */
  showMesh(geometry, { refit = true, role = 'bin', color } = {}) {
    this.mode = 'single';
    this._single = {};
    for (const o of this.objects.values()) this.root.remove(o.mesh);
    this.objects.clear();
    const g = geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const c = bb.getCenter(new THREE.Vector3());
    g.translate(-c.x, -bb.min.y, -c.z);
    const prev = this._shown;
    this._shown = creasedNormals(g);
    prev?.dispose();
    const mesh = new THREE.Mesh(this._shown, color ? colorMaterial(color) : materialFor(role));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.key = 'single';
    this.root.add(mesh);
    this.objects.set('single', { mesh, pl: { key: 'single', role }, loaded: true });
    if (refit) this.fit();
    this.requestRender();
  }

  /** Rotates the single part 90° around an axis (library mode). */
  rotateSingle(axis) {
    const o = this.objects.get('single');
    if (!o) return;
    const g = o.mesh.geometry;
    const m = new THREE.Matrix4();
    if (axis === 'x') m.makeRotationX(Math.PI / 2);
    if (axis === 'y') m.makeRotationY(Math.PI / 2);
    if (axis === 'z') m.makeRotationZ(Math.PI / 2);
    g.applyMatrix4(m);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const c = bb.getCenter(new THREE.Vector3());
    g.translate(-c.x, -bb.min.y, -c.z);
    this.fit();
    this.requestRender();
  }

  fit() {
    const box = new THREE.Box3();
    for (const o of this.objects.values()) if (o.mesh.visible) box.expandByObject(o.mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.5;
    // Fit the narrower of the vertical and horizontal fields of view.
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const dist = (r / Math.sin(Math.min(vHalf, hHalf))) * 1.35;
    const dir = new THREE.Vector3(0.62, 0.42, 0.86).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(1, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** PNG snapshot of the current view. */
  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
