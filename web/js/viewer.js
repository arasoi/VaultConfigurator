// three.js viewer for assembled builds and single parts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadPreview } from './api.js';
import { MOUNT_FACE, interfaceRotation, mountFaceRotation, orientsByInterface } from './orient.js';
import { COLORS, ORIENT_BY_NAME, ORIENT_BY_ROLE, layout } from './rules.js';
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

const materials = new Map();
const colorMaterials = new Map();
function colorMaterial(hex) {
  if (!colorMaterials.has(hex)) {
    colorMaterials.set(hex, new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.75, metalness: 0.05, flatShading: true }));
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
        flatShading: true,
      }),
    );
  }
  return materials.get(role);
}
const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.25, depthWrite: false });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);

/** Everything (besides the file) that determines a placement's oriented geometry. */
function geoKey(pl) {
  return `${pl.role}|${JSON.stringify(pl.expect)}|${pl.iface?.key || ''}|${JSON.stringify(pl.rot || null)}|${pl.body || ''}|${JSON.stringify(pl.xform || null)}|${pl.mount || ''}`;
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

function keepBodyBySide(g, axis, sign) {
  const idx = g.index.array;
  const pos = g.attributes.position.array;
  const n = pos.length / 3;
  const parent = new Int32Array(n).map((_, i) => i);
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
  const sums = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const s = sums.get(r) || { sum: 0, count: 0 };
    s.sum += pos[i * 3 + axis];
    s.count++;
    sums.set(r, s);
  }
  const keepRoots = new Set([...sums.entries()].filter(([, s]) => s.count > 20 && Math.sign(s.sum / s.count) === sign).map(([r]) => r));
  if (!keepRoots.size) return;
  const remap = new Int32Array(n).fill(-1);
  const newPos = [];
  const newIdx = [];
  for (let t = 0; t < idx.length; t++) {
    const v = idx[t];
    if (!keepRoots.has(find(v))) continue;
    if (remap[v] < 0) {
      remap[v] = newPos.length / 3;
      newPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    newIdx.push(remap[v]);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
  g.setIndex(newIdx);
}

/**
 * Some STL files hold several separate parts (e.g. the two geared racks).
 * Keeps one connected body in place: 'tallest' / 'shortest' by height (Y).
 */
function pickBody(g, which) {
  const idx = g.index.array;
  const pos = g.attributes.position.array;
  const n = pos.length / 3;
  const parent = new Int32Array(n).map((_, i) => i);
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
  const bodies = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const b = bodies.get(r) || { lo: Infinity, hi: -Infinity, count: 0 };
    b.lo = Math.min(b.lo, pos[i * 3 + 1]);
    b.hi = Math.max(b.hi, pos[i * 3 + 1]);
    b.count++;
    bodies.set(r, b);
  }
  const list = [...bodies.entries()].filter(([, b]) => b.count > 20).sort((x, y) => x[1].hi - x[1].lo - (y[1].hi - y[1].lo));
  if (list.length < 2) return;
  const keep = (which === 'shortest' ? list[0] : list[list.length - 1])[0];
  // Rebuild compact buffers so bounding boxes only see the kept body.
  const remap = new Int32Array(n).fill(-1);
  const newPos = [];
  const newIdx = [];
  for (let t = 0; t < idx.length; t++) {
    const v = idx[t];
    if (find(v) !== keep) continue;
    if (remap[v] < 0) {
      remap[v] = newPos.length / 3;
      newPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    newIdx.push(remap[v]);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
  g.setIndex(newIdx);
}

export class Viewer {
  constructor(container, { onPick, onStatus, onLayout, colorOf } = {}) {
    this.container = container;
    this.colorOf = colorOf;
    this.onPick = onPick;
    this.onStatus = onStatus;
    this.onLayout = onLayout;
    this.objects = new Map(); // placement key -> { mesh, pl, dims, loaded }
    this.geoCache = new Map(); // `${partId}|${role}` -> { geometry, dims }
    this.opts = { open: 0, explode: 0 };

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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(800, 1600, 1000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
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
    };
    new ResizeObserver(this._resize).observe(container);
    this._resize();
    const tick = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }

  _setupPicking() {
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector2();
    let down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = el.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, this.camera);
      const hit = ray.intersectObjects(this.root.children, false)[0];
      const key = hit?.object.userData.key;
      this.select(key || null);
      this.onPick?.(key ? this.objects.get(key).pl : null);
    });
  }

  /** Material for a placement: its resolved color, else the role default. */
  _mat(pl) {
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
  }

  _updateSelectionBox() {
    const o = this.selected && this.objects.get(this.selected);
    if (!o || !o.loaded || !o.mesh.visible) {
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
        continue;
      }
      if (cur) this.root.remove(cur.mesh);
      const mesh = new THREE.Mesh(unitBox, placeholderMat);
      mesh.userData.key = pl.key;
      this.root.add(mesh);
      const o = { id, mesh, pl, dims: null, loaded: false };
      this.objects.set(pl.key, o);
      if (pl.partId) this._load(o);
      else if (pl.role === 'backbone' || pl.role === 'rod') {
        // Backbones are drawn as solid blocks (one per level), rods as cylinders.
        o.loaded = true;
        mesh.geometry = pl.role === 'rod' ? unitCylinder : unitBox;
        mesh.material = this._mat(pl);
        mesh.castShadow = true;
        o.solidBox = true;
      }
    }
    for (const [k, o] of this.objects) {
      if (!keep.has(k)) {
        this.root.remove(o.mesh);
        this.objects.delete(k);
      }
    }
    this.recolor();
    this._relayout();
    this._status();
  }

  async _load(o) {
    const { partId, role } = o.pl;
    const ck = `${partId}|${geoKey(o.pl)}`;
    try {
      if (!this.geoCache.has(ck)) {
        this.geoCache.set(
          ck,
          loadPreview(partId).then(async (pv) => {
            const g = pv.geometry.clone();
            if (o.pl.xform) {
              applyXform(g, o.pl.xform);
              g.userData.orientedBy = 'measured (file coordinates)';
              const s = g.boundingBox.getSize(new THREE.Vector3());
              return { geometry: g, dims: [s.x, s.y, s.z] };
            }
            g.applyMatrix4(fitAxes(pv.size, o.pl.expect));
            g.computeBoundingBox();
            // Stacking parts: orient by matching their connecting face to the
            // footprint's interface (see orient.js). Others: static rules.
            const named = ORIENT_BY_NAME.find(([re]) => re.test(o.pl.name || ''));
            const auto = !named && orientsByInterface(role) ? await interfaceRotation(g, role, o.pl.iface) : null;
            g.applyMatrix4(auto ? auto.matrix : extraRotation(named?.[1] || ORIENT_BY_ROLE[role]));
            if (o.pl.rot) g.applyMatrix4(extraRotation(o.pl.rot));
            if (o.pl.body) pickBody(g, o.pl.body);
            // Mount face: the side screwed/resting against its host should be the flat one.
            const face = !auto && !named ? o.pl.mount || MOUNT_FACE[role] : null;
            const flip = face ? mountFaceRotation(g, face) : null;
            if (flip) g.applyMatrix4(flip.matrix);
            g.userData.orientedBy = auto
              ? `interface:${auto.name} (${auto.score.toFixed(2)})`
              : face
                ? `mount face ${face}${flip ? ` (flipped: ${flip.there.toFixed(2)} vs ${flip.here.toFixed(2)})` : ' (ok)'}`
                : 'static';
            g.computeBoundingBox();
            const bb = g.boundingBox;
            const c = bb.getCenter(new THREE.Vector3());
            g.translate(-c.x, -c.y, -c.z);
            const s = bb.getSize(new THREE.Vector3());
            return { geometry: g, dims: [s.x, s.y, s.z] };
          }),
        );
      }
      const { geometry, dims } = await this.geoCache.get(ck);
      if (this.objects.get(o.pl.key) !== o) return; // replaced meanwhile
      o.mesh.geometry = geometry;
      o.mesh.material = this._mat(o.pl);
      if (this.selected === o.pl.key) this._updateSelectionBox();
      o.mesh.castShadow = true;
      o.mesh.receiveShadow = true;
      o.mesh.scale.set(1, 1, 1);
      o.dims = dims;
      o.loaded = true;
    } catch (e) {
      console.warn(e);
      o.failed = true;
      this.geoCache.delete(ck);
    }
    this._relayout();
    this._status();
  }

  _status() {
    let total = 0;
    let done = 0;
    for (const o of this.objects.values()) {
      if (!o.pl.partId) continue;
      total++;
      if (o.loaded || o.failed) done++;
    }
    this.onStatus?.({ total, done });
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
      this.lastLayout = L;
      this._updateSelectionBox();
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
    const token = (this._single = {});
    const pv = await loadPreview(part.id);
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
    const mesh = new THREE.Mesh(g, materialFor('part'));
    mesh.castShadow = true;
    mesh.userData.key = 'single';
    this.root.add(mesh);
    this.objects.set('single', { mesh, pl: { key: 'single', partId: part.id, role: 'part' }, loaded: true });
    this.fit();
    return pv;
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
  }

  fit() {
    const box = new THREE.Box3();
    for (const o of this.objects.values()) if (o.mesh.visible) box.expandByObject(o.mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.35;
    const dir = new THREE.Vector3(0.62, 0.42, 0.86).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(1, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
  }

  /** PNG snapshot of the current view. */
  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
