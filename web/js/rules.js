// VAULT system rules: dimensions, options, and how a build resolves into
// files to print, 3D placements, and hardware.
//
// Everything here is derived from the manuals in Data/.../05. Documentation
// and from measuring the STL files. Values marked "FIT" are visual fitting
// guesses for the 3D preview only and do not affect the parts list.

// ---------------------------------------------------------------- dimensions

export const SIZES = ['S', 'M', 'L', 'XL'];
export const DEPTHS = [3, 4, 5, 6, 7];
export const HEIGHTS = [1, 2, 4];

/** Outer module width per size (mm). L = S+S, XL = S+M. */
export const WIDTH = { S: 164.8, M: 254.0, L: 329.6, XL: 418.8, L2: 329.6, XL2: 418.8 };
/** Outer module depth for gridfinity depth units (42 mm each). */
export const depthMM = (d) => 42 * d + 20.1;
/** Drawer module outer height; modules stack with a 48 mm pitch per F. */
export const drawerH = (f) => 48 * f + 9;
/** Sustainer module body height (measured). */
export const SUSTAINER_H = { 1: 50.8, 2: 84.8, 4: 180.8 };

export const FIT = {
  lip: 9, // interlocking lip between stacked modules
  // Sustainer lid: its side rims rest on the module's side walls; the rim
  // underside is 7.6 mm above the lid's lowest point (inner features drop into
  // the box). Measured on S/M/L/XL lids at several depths.
  lidSeat: 7.6,
  baseLip: 9,
  footTuck: 30, // how far the feet tuck up into the base
  boxFloor: 6,
  facadeT: 10,
  backboneT: 33,
  wallMountT: 17,
  pegboardT: 12,
  wheelR: 80,
  sFacadeLift: 4.8, // sustainer facade bottom above the module bottom
};

export const SIZE_LABEL = { S: 'S', M: 'M', L: 'L', XL: 'XL', L2: 'L²', XL2: 'XL²' };

/** Column layouts a level can use for each footprint width. */
export const LAYOUTS = {
  S: [{ key: 'S', label: 'S', cols: ['S'] }],
  M: [{ key: 'M', label: 'M', cols: ['M'] }],
  L: [
    { key: 'L', label: 'L (full width)', cols: ['L'] },
    { key: 'L2', label: 'L² (two S drawers in one module)', cols: ['L2'], drawerOnly: true },
    { key: 'S+S', label: 'S + S (side by side)', cols: ['S', 'S'] },
  ],
  XL: [
    { key: 'XL', label: 'XL (full width)', cols: ['XL'] },
    { key: 'XL2', label: 'XL² (S + M drawers in one module)', cols: ['XL2'], drawerOnly: true },
    { key: 'S+M', label: 'S + M (side by side)', cols: ['S', 'M'] },
    { key: 'M+S', label: 'M + S (side by side)', cols: ['M', 'S'] },
  ],
};

export const ROOFS = [
  { key: 'grid', label: 'Gridfinity roof' },
  { key: 'table', label: 'Table roof' },
  { key: 'bowl', label: 'Bowl roof' },
  { key: 'heavyweight', label: 'Heavyweight roof (L / XL)' },
  { key: 'heavyweight-cut', label: 'Heavyweight roof, cut version (XL)' },
  { key: 'under-table', label: 'Under-table mount roof' },
];

/** Roofs with a handle mount (see resolve()). */
export function roofTakesHandle(roof) {
  return roof === 'grid' || String(roof).startsWith('heavyweight');
}

export const BASES = [
  { key: 'none', label: 'No base' },
  { key: 'feet', label: 'Base + feet (stationary)' },
  { key: 'wheels', label: 'Base + wheels (mobile)' },
  { key: 'casters', label: 'Base + casters' },
];

export const DRAWER_INTERIORS = [
  { key: 'empty', label: 'Empty drawer' },
  { key: 'griddividers', label: 'Grid dividers' },
  { key: 'gridfinity', label: 'Gridfinity baseplate' },
  { key: 'gridfinity-1h', label: 'Gridfinity baseplate, 1 handle' },
  { key: 'gridfinity-2h', label: 'Gridfinity baseplate, 2 handles' },
];
export const SUSTAINER_INTERIORS = [
  { key: 'flat', label: 'Flat' },
  { key: 'gridfinity', label: 'Gridfinity base' },
  { key: 'dividers', label: 'Dividers' },
  { key: 'sealed', label: 'Sealed (L / XL)' },
];

export const HANDLES = [
  { key: 'knob', label: 'Knob' },
  { key: 'hidden', label: 'Hidden key' },
];

export const PEGBOARDS = [
  { key: 'none', label: 'None' },
  { key: 'ikea', label: 'IKEA Skådis' },
  { key: 'ussa', label: 'USSA pegboard' },
];

/** Base rod lengths for wheels (manual: hardware list). */
const ROD_LEN = { S: 248, M: 338, L: 414, XL: 504 };

/**
 * Pull-out handle: x of the two vertical M16 rods (Ø17 holes) from the centre,
 * measured on the backbone boards, the handle lock and the handle legs (all
 * agree; = W/2 − 42). Universal boards have the hole 10.5 mm inboard of centre.
 */
export const ROD_X = { S: 40, M: 85, L: 123, XL: 167 };
/** Handle lock knobs sit in Ø34 pockets 17.5 mm inboard of each rod (S: one knob in Part 2). */
const LOCK_KNOB_IN = 17.5;
/** Universal handle lock: rod hole 2.5 mm outboard of the part's centre (89.1 wide). */
const ULOCK_ROD_OFF = 2.5;

// ---------------------------------------------------------------- defaults

let uid = 0;
export const newId = () => `l${Date.now().toString(36)}${(uid++).toString(36)}`;

export function newColumn(type = 'drawer') {
  return { type, interior: type === 'drawer' ? 'empty' : 'flat' };
}

export function newLevel(width, height = 1, type = 'drawer') {
  const layout = LAYOUTS[width][0];
  return { id: newId(), layout: layout.key, height, cols: layout.cols.map(() => newColumn(type)) };
}

export function defaultBuild() {
  return {
    version: 1,
    name: 'My VAULT',
    width: 'L',
    depth: 5,
    base: 'feet',
    roof: 'grid',
    topHandle: true,
    handle: 'knob',
    dividerPins: 'loose',
    dividerBorder: 'straight',
    colors: { preset: 'classic', groups: {}, files: {}, parts: {} },
    splitPrints: false,
    gearedRails: true,
    backbone: false,
    backboneStyle: 'full',
    connectors: false,
    manualSupports: false,
    accessories: [],
    pullHandle: false,
    stationaryHandle: false,
    wallMount: false,
    pegboard: 'none',
    // bottom -> top
    levels: [
      { id: newId(), layout: 'L', height: 2, cols: [{ type: 'drawer', interior: 'gridfinity' }] },
      { id: newId(), layout: 'L', height: 1, cols: [{ type: 'sustainer', interior: 'dividers' }] },
      { id: newId(), layout: 'S+S', height: 1, cols: [newColumn('drawer'), newColumn('drawer')] },
      { id: newId(), layout: 'L', height: 1, cols: [newColumn('drawer')] },
    ],
  };
}

// ---------------------------------------------------------------- catalog queries

/** Thin query layer over the catalog. */
export class Parts {
  constructor(catalog) {
    this.all = catalog.parts.filter((p) => p.kind === 'stl');
    this.byId = new Map(this.all.map((p) => [p.id, p]));
  }

  /**
   * q: { category, group, size, depth, height, variant, piece, name (RegExp), path (RegExp) }
   * - size/height match if the part lists them (shared parts list several)
   * - variant: '' requires no variant; undefined ignores it
   * - piece: '' requires a single-piece file; undefined ignores it
   */
  findAll(q) {
    return this.all.filter((p) => {
      if (q.category && p.category !== q.category) return false;
      if (q.group && p.group !== q.group) return false;
      if (q.size && !(p.sizes || []).includes(q.size)) return false;
      if (q.noSize && (p.sizes || []).length) return false;
      if (q.depth && p.depth !== q.depth) return false;
      if (q.height && !(p.heights || []).includes(q.height)) return false;
      if (q.variant !== undefined && (p.variant || '') !== q.variant) return false;
      if (q.piece !== undefined && (p.piece || '') !== q.piece) return false;
      if (q.name && !q.name.test(p.name)) return false;
      if (q.path && !q.path.test(p.path)) return false;
      return true;
    });
  }

  find(q) {
    return this.findAll(q)[0] || null;
  }

  /** Heights available for a module of this type/size/depth. */
  heightsFor(type, size, depth) {
    const cat = type === 'drawer' ? 'drawers' : 'sustainers';
    const hs = new Set();
    for (const p of this.findAll({ category: cat, group: 'Modules', size, depth })) {
      for (const h of p.heights || []) hs.add(h);
    }
    return HEIGHTS.filter((h) => hs.has(h));
  }

  /**
   * Single-piece file if one exists, otherwise the split parts.
   * With preferSplit, split parts win when both exist.
   */
  wholeOrParts(q, preferSplit = false) {
    const list = this.findAll(q);
    const whole = list.find((p) => p.piece === 'whole') || list.find((p) => !p.piece);
    const parts = list.filter((p) => p.piece === '1' || p.piece === '2');
    if (parts.length && (preferSplit || !whole)) return { files: parts, split: true, show: whole };
    return { files: whole ? [whole] : [], split: false, show: whole };
  }
}

// ---------------------------------------------------------------- resolve

/**
 * Turns a build into:
 *   placements: things to draw in 3D (part id or placeholder + role + slot)
 *   bom:        files to print, merged by part id
 *   hardware:   non-printed parts
 *   warnings:   human readable issues
 */
export function resolve(build, parts) {
  const out = { placements: [], bomMap: new Map(), hardware: new Map(), warnings: [] };
  const W = build.width;
  const d = build.depth;
  const D = depthMM(d);

  // group: color group for copies that aren't drawn; aid: print aid / tool
  // (printed but not part of the assembly, so never drawn).
  const addBom = (part, qty, section, note, group, aid) => {
    if (!part || qty <= 0) return;
    const e = out.bomMap.get(part.id);
    if (e) e.qty += qty;
    else out.bomMap.set(part.id, { part, qty, section, note: note || undefined, group, aid: !!aid });
  };
  const addHw = (name, qty) => out.hardware.set(name, (out.hardware.get(name) || 0) + qty);
  const missing = (what) => out.warnings.push(`No file found for ${what}.`);
  const levels = build.levels || [];
  // Stable ids for placements (used for per-part colors), built from the
  // level id / column / parent so they survive unrelated edits to the build.
  const cidByKey = new Map();
  const cidCount = new Map();
  const place = (pl) => {
    const key = `p${out.placements.length}`;
    let prefix = 'g';
    if (pl.attach) prefix = cidByKey.get(pl.attach.to) || 'g';
    else if (pl.slot && pl.slot.level !== undefined) {
      prefix = levels[pl.slot.level]?.id || `L${pl.slot.level}`;
      if (pl.slot.col !== undefined) prefix += `/${pl.slot.col}`;
    }
    const base = `${prefix}/${pl.role}`;
    const n = cidCount.get(base) || 0;
    cidCount.set(base, n + 1);
    const cid = `${base}/${n}`;
    cidByKey.set(key, cid);
    const full = { key, cid, name: (pl.partId && parts.byId.get(pl.partId)?.name) || '', ...pl };
    out.placements.push(full);
    return full;
  };

  if (!levels.length) out.warnings.push('Add at least one level to the stack.');

  // ---- stack levels
  levels.forEach((lv, li) => {
    const layout = LAYOUTS[W].find((l) => l.key === lv.layout) || LAYOUTS[W][0];
    const F = lv.height;
    let x = -WIDTH[W] / 2;
    layout.cols.forEach((size, ci) => {
      const col = lv.cols[ci] || newColumn();
      const w = WIDTH[size];
      const cx = x + w / 2;
      x += w;
      const slot = { level: li, col: ci, x: cx, width: w, type: col.type };
      if (col.type === 'sustainer' && layout.drawerOnly) {
        out.warnings.push(`Level ${li + 1}: ${SIZE_LABEL[size]} exists for drawers only.`);
      }
      const ctx = { size, F, d, D, col, slot, li, build, parts, addBom, addHw, place, missing, state: out };
      if (col.type === 'drawer') resolveDrawer(ctx);
      else resolveSustainer(ctx);
      if (build.manualSupports && F > 1) {
        // Print aid for tall modules (Instructions Manual: "Manual Supports").
        const ms = parts.find({ category: 'drawers', group: 'Universal', depth: d, name: /^x[3-7]$/ });
        addBom(ms, 1, 'Print aids', 'manual support for tall prints', 'internal', true);
      }
    });
  });

  // ---- removable key for hidden-key handles (one per build)
  if (out.hiddenKeyAt) {
    const k2 = parts.find({ category: 'drawers', group: 'Universal', name: /^Hidden Key Part 2/ });
    addBom(k2, 1, 'Drawers', 'removable key (one per build)');
    // A loose key, so it's shown on the shelf beside the build rather than in a lock.
    place({ partId: k2?.id, role: 'key', shelf: true, expect: [34, 29, 29.7] });
  }

  // ---- roof on top drawer columns
  const top = levels[levels.length - 1];
  if (top && build.roof !== 'none') {
    const layout = LAYOUTS[W].find((l) => l.key === top.layout) || LAYOUTS[W][0];
    let x = -WIDTH[W] / 2;
    layout.cols.forEach((size, ci) => {
      const w = WIDTH[size];
      const cx = x + w / 2;
      x += w;
      if ((top.cols[ci] || {}).type !== 'drawer') return; // sustainers carry their own lid
      const rs = size.replace('2', ''); // L2 -> L, XL2 -> XL
      let variant = build.roof;
      if (variant === 'heavyweight-cut' && rs !== 'XL') variant = 'heavyweight';
      if (variant === 'heavyweight' && !['L', 'XL'].includes(rs)) {
        out.warnings.push(`Heavyweight roof is only available for L and XL; using the gridfinity roof on the ${SIZE_LABEL[size]} column.`);
        variant = 'grid';
      }
      const roof = parts.find({ category: 'drawers', group: 'Roofs', size: rs, depth: d, variant });
      if (!roof) missing(`${rs}${d} ${variant} roof`);
      addBom(roof, 1, 'Roof');
      const rp = place({ partId: roof?.id, role: 'roof', slot: { level: levels.length - 1, col: ci, x: cx, width: w }, expect: [w, null, D], iface: ifaceFor(parts, rs, d) });
      // Only roofs with a handle mount take a handle: the Grid roofs (two M6
      // holes 48.4 mm apart, measured in every Grid roof file) take the Top
      // Handle; the heavyweight roofs take their own handle + insert.
      const handleOK = roofTakesHandle(variant);
      if (build.topHandle && !handleOK) {
        const msg = `The ${ROOFS.find((r) => r.key === variant)?.label.toLowerCase() || variant} has no handle mount, so no top handle was added. Grid and heavyweight roofs take one.`;
        if (!out.warnings.includes(msg)) out.warnings.push(msg);
      }
      if (build.topHandle && handleOK) {
        if (variant.startsWith('heavyweight')) {
          const hh = parts.find({ category: 'drawers', name: /^Heawyweight Roof Handle/ });
          const hi = parts.find({ category: 'drawers', name: /^Heawyweight Roof Insert/ });
          addBom(hh, 1, 'Roof');
          addBom(hi, 1, 'Roof');
          const hp = place({ partId: hh?.id, role: 'tophandle', attach: { to: rp.key, yRef: 'top', y: -2, yAlign: 'above' }, expect: [156.5, 29.5, 30] });
          place({ partId: hi?.id, role: 'tophandle', attach: { to: hp.key, y: 0 }, expect: [41.8, 16.8, 30.1] });
        } else {
          const th = parts.find({ category: 'drawers', name: /^Top Handle/ });
          addBom(th, 1, 'Roof');
          // Stands 51 mm tall over the roof's mount holes (9.8 mm back on S3/M3 grid roofs).
          const mountZ = /^(S|M)3 Grid Roof/.test(roof?.name || '') ? -9.8 : 0;
          place({ partId: th?.id, role: 'tophandle', mount: 'bottom', attach: { to: rp.key, yRef: 'top', y: -1, yAlign: 'above', z: mountZ }, expect: [126, 51, 37] });
        }
        addHw('M6 50mm bolt', 2);
      }
    });
  }

  // ---- base
  if (build.base !== 'none') {
    const b = parts.wholeOrParts({ category: 'modifications', group: 'Base', size: W, depth: d }, build.splitPrints);
    if (!b.files.length) missing(`${W}${d} base`);
    b.files.forEach((f) => addBom(f, 1, 'Base & mobility'));
    const basePl = place({ partId: b.show?.id, role: 'base', files: b.files.map((f) => f.id), expect: [WIDTH[W], 52.2, D + 10], iface: ifaceFor(parts, W, d) });
    if (b.split) {
      // Joins the two halves of a split base, underneath at the seam.
      const bc = parts.find({ category: 'modifications', name: /^Base Connector/ });
      addBom(bc, 1, 'Base & mobility', 'joins the split base');
      place({ partId: bc?.id, role: 'base', attach: { to: basePl.key, yRef: 'bottom', y: 0, yAlign: 'above' }, expect: [29.7, 15.7, 140] });
    }

    const feet = parts.find({ category: 'modifications', group: 'Feet', size: W });
    if (build.base === 'feet') {
      addBom(feet, 2, 'Base & mobility');
      addHw('M6 90mm bolt', 4);
      place({ partId: feet?.id, role: 'foot', side: 1, expect: [WIDTH[W] - 60, 92, 60.5] });
      place({ partId: feet?.id, role: 'foot', side: -1, expect: [WIDTH[W] - 60, 92, 60.5] });
    } else if (build.base === 'wheels') {
      addBom(feet, 1, 'Base & mobility');
      addHw('M6 90mm bolt', 2);
      place({ partId: feet?.id, role: 'foot', side: 1, expect: [WIDTH[W] - 60, 92, 60.5] });
      const wheelPart = (re) => parts.find({ category: 'modifications', group: 'Wheels', name: re });
      addBom(wheelPart(/^Tyre/), 2, 'Base & mobility', 'print in TPU');
      addBom(wheelPart(/^Disk/), 2, 'Base & mobility');
      addBom(wheelPart(/^Cover/), 2, 'Base & mobility');
      addBom(wheelPart(/^Bushing/), 2, 'Base & mobility');
      addBom(wheelPart(/^Jig/), 1, 'Print aids', 'tool for pressing bushings onto the rod', 'internal', true);
      addHw(`M16 threaded rod ${ROD_LEN[W]}mm`, 1);
      addHw('M4 25mm bolt', 12);
      addHw('6205ZZ bearing', 2);
      addHw('SCSAW stopper (16d 30D 10mm)', 2);
      for (const side of [-1, 1]) {
        const tp = place({ partId: wheelPart(/^Tyre/)?.id, role: 'wheel', side, expect: [40.6, 160, 160] });
        place({ partId: wheelPart(/^Cover/)?.id, role: 'wheelcover', side, expect: [23.9, 140, 140] });
        // Disk (hub) inside the tyre, bushing on the axle.
        place({ partId: wheelPart(/^Disk/)?.id, role: 'wheelcover', attach: { to: tp.key }, expect: [20.1, 142, 142] });
        place({ partId: wheelPart(/^Bushing/)?.id, role: 'wheelcover', attach: { to: tp.key, x: -side * 12 }, expect: [33, 31.2, 31.2] });
      }
    } else if (build.base === 'casters') {
      addHw('Caster with M8 bolt', 4);
    }
  }

  // ---- back: backbone, handles, pegboard, wall mount
  const wallOrBack = build.backbone || build.pullHandle || build.stationaryHandle || build.pegboard !== 'none';
  if ((build.pullHandle || build.stationaryHandle || build.pegboard !== 'none') && !build.backbone) {
    out.warnings.push('Handles and pegboards mount on the backbone; backbone parts were added.');
  }
  if (build.wallMount && wallOrBack) {
    out.warnings.push('Wall mounts and backbone both use the back of the stack; check the docs before combining them.');
  }
  const universal = build.backboneStyle === 'universal';
  const bbParts = (h) =>
    universal
      ? parts.find({ category: 'modifications', group: 'Backbone', height: h, name: /^Universal \dF Backbone/ })
      : parts.find({ category: 'modifications', group: 'Backbone', size: W, height: h, name: /Backbone$/ });
  const bbAvail = universal
    ? [1, 2]
    : parts.findAll({ category: 'modifications', group: 'Backbone', size: W, name: /Backbone$/ }).flatMap((p) => p.heights || []);
  // Universal boards are narrow: one at each side instead of one full-width board.
  const bbCols = universal ? [-(WIDTH[W] / 2 - 31.55), WIDTH[W] / 2 - 31.55] : [0];
  // Boards in placement order (bottom to top within a level); the stationary
  // handle bolts to the topmost one.
  const boards = [];
  let lockKey = null;
  // Handle lock: takes the place of the top 1F backbone board. The M16 rods
  // run through it and the boards below; a knob in a pocket next to each rod
  // clamps it (tightened by an M4 35mm hex bolt from the module side).
  const placeHandleLock = (li) => {
    const knob1 = parts.find({ category: 'modifications', name: /^Handle Lock Knob Part 1/ });
    const knob2 = parts.find({ category: 'modifications', name: /^Handle Lock Knob Part 2/ });
    const addKnob = (hostKey, x) => {
      addBom(knob1, 1, 'Backbone & handles', 'handle lock knob');
      addBom(knob2, 1, 'Backbone & handles', 'knob cap');
      addHw('M4 35mm hex bolt', 1);
      // Knob Part 1 is a Ø34 × 7.3 disc with a 28 × 10 stem (14.7 long). The
      // disc's flat face goes into the 6 mm deep pocket; the stem points out.
      const kp = place({ partId: knob1?.id, role: 'knob', mount: 'front', attach: { to: hostKey, x, zRef: 'back', z: 6, zAlign: 'out' }, expect: [34, 34, 22] });
      // Part 2 is the grip: a sleeve over the stem, open end towards the disc,
      // closed end 1.5 mm past the stem's end.
      place({ partId: knob2?.id, role: 'keycap', mount: 'back', attach: { to: kp.key, zRef: 'back', z: 11.7 - 1.5, zAlign: 'out' }, expect: [37.8, 13.2, 11.7] });
    };
    const rodX = ROD_X[W];
    if (universal) {
      // One narrow lock per side, outer edge flush with the module; the file is
      // the right-hand one (knob inboard of the rod), turned over for the left.
      const lock = parts.find({ category: 'modifications', name: /^Universal Pull-out Handle Lock/ });
      if (!lock) missing('universal pull-out handle lock');
      let first = null;
      for (const side of [-1, 1]) {
        addBom(lock, 1, 'Backbone & handles');
        addHw('M4 60–100mm bolt', 4);
        const lp = place({
          partId: lock?.id,
          placeholder: !lock,
          role: 'handlelock',
          slot: { level: li },
          bx: side * (rodX - ULOCK_ROD_OFF),
          rot: side < 0 ? { z: 180 } : null,
          expect: [89.1, 47, 35],
        });
        first ??= lp.key;
        addKnob(lp.key, -side * (LOCK_KNOB_IN - ULOCK_ROD_OFF));
      }
      return first;
    }
    const lock = parts.find({ category: 'modifications', group: 'Backbone', size: W, name: /Pull-out Handle Lock$/ });
    if (!lock) missing(`${W} pull-out handle lock`);
    addBom(lock, 1, 'Backbone & handles');
    addHw('M4 60–100mm bolt', 4);
    const lp = place({ partId: lock?.id, placeholder: !lock, role: 'handlelock', slot: { level: li }, bx: 0, expect: [WIDTH[W], 47, 35] });
    const part2 = parts.find({ category: 'modifications', group: 'Backbone', size: W, name: /Pull-out Handle Lock Part 2/ });
    if (part2) {
      // S: the rods are too close for two knobs; Part 2 clamps both rods
      // (half-holes at its ends) with one knob in the middle.
      addBom(part2, 1, 'Backbone & handles');
      const p2 = place({ partId: part2.id, role: 'handlelock', attach: { to: lp.key, zRef: 'back', z: 0, zAlign: 'out' }, expect: [80.4, 47, 15] });
      addKnob(p2.key, 0);
    } else {
      for (const s of [-1, 1]) addKnob(lp.key, s * (rodX - LOCK_KNOB_IN));
    }
    return lp.key;
  };
  levels.forEach((lv, li) => {
    if (wallOrBack) {
      // With the pull-out handle, the handle lock (1F tall) replaces the top
      // 1F of backbone on the top level (manual: Modifications 13–15).
      const lockHere = build.pullHandle && li === levels.length - 1;
      for (const h of splitHeight(lockHere ? lv.height - 1 : lv.height, bbAvail)) {
        const bb = bbParts(h);
        if (!bb) missing(`${universal ? 'universal' : W}${h}F backbone`);
        for (const bx of bbCols) {
          addBom(bb, 1, 'Backbone & handles');
          addHw('M4 60–100mm bolt', 4);
          const bp = place({ partId: bb?.id, placeholder: !bb, role: 'backbone', slot: { level: li }, bx, expect: [universal ? 63.1 : WIDTH[W], 48 * h - 1, FIT.backboneT] });
          boards.push({ key: bp.key, bx, h });
          if (build.connectors) {
            // Connectors for modules: tie this level to the next at the board ends.
            const cn = parts.find({ category: 'modifications', group: 'Backbone', height: h, name: /^Connector for Modules/ });
            addBom(cn, 2, 'Backbone & handles', 'connects modules to each other');
            const half = (universal ? 63.1 : WIDTH[W]) / 2 - 10;
            for (const s2 of [-1, 1]) {
              place({ partId: cn?.id, role: 'backbone', attach: { to: bp.key, x: s2 * half, zRef: 'back', z: 0, zAlign: 'out' }, expect: [16.3, 48 * h - 0.9, 12] });
            }
          }
        }
      }
      if (lockHere) lockKey = placeHandleLock(li);
      if (build.pegboard !== 'none') {
        const folder = build.pegboard === 'ikea' ? /IKEA/ : /USSA Pegboard/;
        const pAvail = parts.findAll({ category: 'modifications', group: 'Pegboard Attachment', size: W, path: folder }).flatMap((p) => p.heights || []);
        for (const h of splitHeight(lv.height, pAvail)) {
          const pg = parts.find({ category: 'modifications', group: 'Pegboard Attachment', size: W, height: h, path: folder });
          if (!pg) missing(`${W}${h}F pegboard attachment`);
          addBom(pg, 1, 'Pegboard');
          addHw('M4 40mm bolt', 4);
          place({ partId: pg?.id, role: 'pegboard', slot: { level: li }, expect: [null, null, FIT.pegboardT] });
        }
      }
    }
    if (build.wallMount) {
      const avail = parts.findAll({ category: 'modifications', group: 'Wall Mounts', size: W }).flatMap((p) => p.heights || []);
      const second = parts.find({ category: 'modifications', name: /^Wall Mount Second Part/ });
      for (const h of splitHeight(lv.height, avail)) {
        const wm = parts.find({ category: 'modifications', group: 'Wall Mounts', size: W, height: h });
        if (!wm) missing(`${W}${h}F wall mount`);
        addBom(wm, 1, 'Mounting');
        addBom(second, 1, 'Mounting', 'screwed to the wall');
        const wp = place({ partId: wm?.id, role: 'wallmount', slot: { level: li }, expect: [WIDTH[W], 48 * h + 7.1, FIT.wallMountT] });
        place({ partId: second?.id, role: 'wallmount', attach: { to: wp.key, zRef: 'back', z: 0, zAlign: 'out' }, expect: [102.5, 24.2, 13.8] });
      }
    }
  });
  if (build.pullHandle) {
    const ph = parts.find({ category: 'modifications', group: 'Pull-out Handle', size: W });
    addBom(ph, 1, 'Backbone & handles');
    addHw('M6 30mm bolt', 4);
    addHw('M6 35mm bolt', 2);
    addHw('M6x8x8 heat insert', 2);
    addHw('M16 threaded rod (tower height)', 2);
    // An upside-down U in the plane of the back: grip on top, legs down onto
    // the rods (M6 bolts through the leg ends into the tapped rods).
    place({ partId: ph?.id, role: 'pullhandle', expect: [null, 61.5, 35] });
    // M16 rods the handle slides on (drawn as cylinders, not printed); they run
    // through the backbone boards and the handle lock (placed in the level loop).
    place({ placeholder: true, role: 'rod', side: -1, fixedColor: true });
    place({ placeholder: true, role: 'rod', side: 1, fixedColor: true });
  }
  if (build.stationaryHandle) {
    const sh = parts.find({ category: 'modifications', group: 'Stationary Handle', size: W });
    addBom(sh, 1, 'Backbone & handles');
    addHw('M4 60mm bolt', 8);
    // A U lying flat: its two legs bolt through the topmost backbone board (from
    // the module side), grip parallel to the back. Below the handle lock if any.
    const board = boards.findLast((b) => b.bx <= 0);
    const host = board?.key || lockKey;
    place({
      partId: sh?.id,
      placeholder: !sh,
      role: 'stathandle',
      attach: host ? { to: host, x: board ? -board.bx : 0, yRef: 'top', yAlign: 'below', zRef: 'back', z: 0, zAlign: 'out' } : undefined,
      expect: [null, 47, 50],
    });
  }

  // ---- accessories & extras (pegboard hooks/containers/holders, spare grid divider pieces)
  for (const a of build.accessories || []) {
    const part = parts.byId.get(a.id);
    if (!part || !(a.qty > 0)) continue;
    addBom(part, a.qty, part.category === 'pegboard' ? 'Pegboard accessories' : 'Extras', accessoryLabel(part));
    for (let i = 0; i < Math.min(a.qty, 50); i++) place({ partId: part.id, role: 'accessory', expect: [null, null, null] });
  }

  // ---- final shape
  const order = ['Drawers', 'Sustainers', 'Roof', 'Base & mobility', 'Backbone & handles', 'Pegboard', 'Mounting', 'Pegboard accessories', 'Extras', 'Print aids'];
  out.bom = [...out.bomMap.values()].sort(
    (a, b) => order.indexOf(a.section) - order.indexOf(b.section) || a.part.path.localeCompare(b.part.path),
  );
  out.hardwareList = [...out.hardware.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => a.name.localeCompare(b.name));
  out.footprint = { width: WIDTH[W], depth: D };
  delete out.bomMap;
  delete out.hardware;
  return out;
}

/** Splits a level height into available part heights, e.g. 4F with [1,2] -> [2,2]. */
export function splitHeight(F, available) {
  const avail = [...new Set(available)].sort((a, b) => b - a);
  if (!avail.length) return [];
  const out = [];
  let left = F;
  while (left > 0) {
    const h = avail.find((a) => a <= left);
    if (!h) break;
    out.push(h);
    left -= h;
  }
  return out;
}

/**
 * Interface references for orienting stacking parts by their connecting
 * geometry (see orient.js): the footprint's 1F sustainer and drawer modules.
 */
function ifaceFor(parts, size, d) {
  const s = size.replace('2', '');
  const big = s === 'L' || s === 'XL';
  const sus = parts.find({ category: 'sustainers', group: 'Modules', size: s, depth: d, height: 1, variant: big ? 'flat' : '' });
  const dr = parts.find({ category: 'drawers', group: 'Modules', size: s, depth: d, height: 1 });
  return {
    key: `${s}${d}`,
    half: [WIDTH[s] / 2, depthMM(d) / 2],
    sustainer: sus ? { id: sus.id, expect: [WIDTH[s], SUSTAINER_H[1], depthMM(d)] } : null,
    drawer: dr ? { id: dr.id, expect: [WIDTH[s], drawerH(1), depthMM(d)] } : null,
  };
}

// ---------------------------------------------------------------- facade geometry
//
// Measured from the facade STLs (see README). Coordinates are in the facade's
// own frame as drawn: x to the right when looking at the front, y up, origin at
// the facade center.

/** Distance of the outer screw holes from the facade center, per drawer size. */
const DRAWER_HOLE_OUTER = { S: 51.5, M: 92.5, L: 130.3, XL: 169.6 };
const DRAWER_HOLE_INNER = 51.5;

/**
 * Drawer facade layout: every screw hole gets an M4 14mm bolt; all but one are
 * covered by a Facade Cap — the remaining one sits under the Label slot. The
 * key (handle) goes in the bottom row (the latch lives in the module floor).
 */
export function drawerFacadeLayout(size, F) {
  const H = 48 * F - 1;
  const row = F === 1 ? 0 : H / 2 - 23.5;
  const keyY = -row; // bottom row (or center on 1F)
  const outer = DRAWER_HOLE_OUTER[size];
  const xsKeyRow = outer === DRAWER_HOLE_INNER ? [-outer, outer] : [-outer, -DRAWER_HOLE_INNER, DRAWER_HOLE_INNER, outer];
  const holes = xsKeyRow.map((x) => ({ x, y: keyY }));
  if (F > 1) for (const x of [-outer, outer]) holes.push({ x, y: row });
  const label = { x: -outer, y: keyY };
  const caps = holes.filter((h) => !(h.x === label.x && h.y === label.y));
  return { H, holes, caps, label, key: { x: 0, y: keyY } };
}

/**
 * Sustainer hinge layout per size, from the screw holes in the module's back
 * wall (leaves) and under the lid (top plates): x centres relative to the
 * module, the leaves' outer end, and per-file frame data for the pins/plates.
 */
const HINGE_GEOMETRY = {
  S: { leaves: [-51.9, 51.9], leafOuter: 71.9, tops: [0], topKx: 0, rodHeadX: -42.2, rodAxisY: 1.7 },
  M: { leaves: [-69.3, 69.3], leafOuter: 89.3, tops: [0], topKx: 0, rodHeadX: -42.2, rodAxisY: 1.7 },
  L: { leaves: [-86.75, 86.75], leafOuter: 111.75, tops: [-41.3, 41.3], topKx: 8.7, rodHeadX: -52.5, rodAxisY: 1.9 },
  XL: { leaves: [-131.35, 131.35], leafOuter: 156.35, tops: [-85.9, 85.9], topKx: 8.7, rodHeadX: -52.5, rodAxisY: 1.9 },
};
/** Knuckle bore centre (x, y) of the upper leaf in each Hinge file. */
const HINGE_LEAF_KNUCKLE = {
  'S-M 1F Hinge': [16.9, 20.4],
  'S-M 2-4F Hinge': [26.5, 20.7],
  'L-XL 1F Hinge': [16.9, 20.1],
  'L 2-4F Hinge': [26.5, 20.2],
};
/**
 * Hinge axis: just below the module rim and ~8 mm behind the back wall
 * (module frame); dyLid is the same axis from the closed lid's centre.
 */
const HINGE_AXIS = { dy: -0.6, dz: -8.1, dyLid: -6.9 };

/** Sustainer latch centers along the facade (S/M: one, L/XL: two). */
export const SUSTAINER_LOCK_X = { S: [0], M: [0], L: [-82.4, 82.4], XL: [-127, 127] };
/** Lock holder centre below the facade top edge (from the facade's 61.4 × 9 mm screw holes). */
const LOCK_HOLDER_DROP = { 1: 11.5, 2: 17.5, 4: 17.5 };
/**
 * Sustainer latch geometry, measured on the STLs (preview frames; file x is the
 * part's up axis, y its depth, z its width):
 * - holder: 5 mm plate (y -9.5..-4.5) behind the facade, screwed through it; its
 *   30 mm pivot boss pokes forward through the facade's top notch. Pivot bore at
 *   (x -3, y 6). "UP" markers on the plate back and the boss shoulder: file −x is up.
 * - link (inner part): U-shaped, ear holes (x 8) on the boss pivot, bar bore (x −7.5)
 *   on the lever's knuckle: 15.5 mm between them.
 * - lever (outer part): a tray, open towards the facade, its walls resting in the
 *   facade's 4.1 mm pocket; the hook at the top reaches back over the lid's catch
 *   bump. Knuckle bore at x −22 (1F) / −25 (2-4F), y 2. "UP" marker: file +x is up.
 */
const LATCH = { pocket: 4.1, holderPlateFront: -4.5, pivot: [-3, 6], link: 15.5, linkEar: 8, knuckle: { 1: -22, 2: -25 }, knuckleY: 2 };

/**
 * Boxes stacked inside a drawer module, bottom to top: e.g. a 4F module can
 * hold [4], [2, 2], [2, 1, 1], [1, 2, 1], [1, 1, 2] or [1, 1, 1, 1].
 * Returns [{ lvl, h }] (start level, height) — falls back to one full-height box.
 */
export function boxStack(boxes, F) {
  const list = Array.isArray(boxes) && boxes.length && boxes.every((x) => [1, 2, 4].includes(x)) && boxes.reduce((a, b) => a + b, 0) === F ? boxes : [F];
  let lvl = 0;
  return list.map((h) => {
    const out = { lvl, h };
    lvl += h;
    return out;
  });
}

/**
 * Settings for one side of a drawer module. Single modules use the column
 * itself; L²/XL² modules can override per side via col.sides[i].
 */
export function sideConfig(col, i, shared) {
  if (!shared) return col;
  const sd = (col.sides && col.sides[i]) || {};
  return { ...col, ...sd };
}

/** Every way to fill F levels with 1F/2F/4F boxes (bottom to top). */
export function boxSplits(F, heights = [1, 2, 4]) {
  if (F === 0) return [[]];
  const out = [];
  for (const h of heights) if (h <= F) for (const rest of boxSplits(F - h, heights)) out.push([h, ...rest]);
  return out;
}

function resolveDrawer({ size, F, d, D, col, slot, li, build, parts, addBom, addHw, place, missing, state }) {
  const w = WIDTH[size];
  const module = parts.find({ category: 'drawers', group: 'Modules', size, depth: d, height: F });
  if (!module) missing(`${SIZE_LABEL[size]}${d} ${F}F drawer module`);
  addBom(module, 1, 'Drawers');
  const mp = place({ partId: module?.id, role: 'module', slot, expect: [w, drawerH(F), D], iface: ifaceFor(parts, size, d) });

  const uni = (re) => parts.find({ category: 'drawers', group: 'Universal', name: re });
  const keyPart = build.handle === 'hidden' ? uni(/^Hidden Key \(/) : uni(/^Key \(/);
  const keyPart2 = build.handle === 'hidden' ? uni(/^Hidden Key Part 2/) : uni(/^Key Cap/);
  const capPart = uni(/^Facade Cap/);
  const labelPart = uni(/^Label$/);
  const stopper = uni(/^Runner Stopper/);
  const springs = uni(/^Springs/);
  const latch = uni(/^Latch/);

  // Side by side: L² holds two S boxes, XL² holds an S and an M box.
  const boxSizes = size === 'L2' ? ['S', 'S'] : size === 'XL2' ? ['S', 'M'] : [size];
  const shared = boxSizes.length > 1;
  let bx = slot.x - w / 2;
  const inner = boxSizes.reduce((s, b) => s + WIDTH[b], 0);
  bx += (w - inner) / 2;
  boxSizes.forEach((bs, pi) => {
    const bw = WIDTH[bs];
    const bcx = bx + bw / 2;
    bx += bw;
    const boxW = bw - 30.6;
    // L²/XL²: each side has its own drawers and interior (col.sides[pi]).
    const cfg = sideConfig(col, pi, shared);
    // Boxes stacked on this side of the module (a 4F module can hold e.g. 2F + 1F + 1F).
    const stack = boxStack(cfg.boxes, F);
    const dx = bcx - slot.x; // box center relative to the module
    const xl = bs === 'XL';
    const runner = (kind) =>
      parts.find({ category: 'drawers', group: 'Universal', depth: d, name: new RegExp(`Runner ${kind}${xl ? ' XL' : '$'}`) });
    const guide = runner('Guide');
    const slide = runner('Slide');
    const gT = xl ? 14.6 : 9.4;
    const sT = xl ? 16 : 9;

    // ---- Module side: one runner guide per level per side, and a stopper
    // clicked into the module's side-wall slot per level (outer walls only —
    // in L²/XL² modules the middle guides have no wall to clip into).
    for (const side of [-1, 1]) {
      const outer = !shared || (side < 0 ? bcx - bw / 2 <= slot.x - w / 2 + 1 : bcx + bw / 2 >= slot.x + w / 2 - 1);
      const gx = dx + side * (boxW / 2 + gT / 2 + 0.5);
      for (let lvl = 0; lvl < F; lvl++) {
        addBom(guide, 1, 'Drawers', 'runner guide');
        place({ partId: guide?.id, role: 'guide', attach: { to: mp.key, x: gx, yRef: 'bottom', y: 29 + 48 * lvl, yAlign: 'center', z: -1 }, expect: [gT, 27, D - 2.6] });
        if (!outer) continue;
        addBom(stopper, 1, 'Drawers', 'clicks into the module side, holds the runner');
        place({ partId: stopper?.id, role: 'stopper', attach: { to: mp.key, x: side * (w / 2 - 3.1), yRef: 'bottom', y: 28.3 + 48 * lvl, yAlign: 'center', z: 28.5 }, expect: [8.2, 7.8, 17.9] });
      }
    }

    // ---- Each box in the stack, with everything that rides on it.
    for (const { lvl, h } of stack) {
      const box = parts.wholeOrParts({ category: 'drawers', group: 'Boxes', size: bs, depth: d, height: h, variant: '' }, build.splitPrints);
      if (!box.files.length) missing(`${bs}${d} ${h}F box`);
      box.files.forEach((f) => addBom(f, 1, 'Drawers'));
      const boxFiles = box.files.map((f) => f.id);
      if (xl) {
        const panel = parts.find({ category: 'drawers', group: 'Boxes', size: 'XL', depth: d, variant: 'back-panel' });
        addBom(panel, 1, 'Drawers');
        if (panel) boxFiles.push(panel.id);
      }
      const bp = place({ partId: box.show?.id, placeholder: !box.show, role: 'box', lvl, h, files: boxFiles, slot: { ...slot, x: bcx, width: bw }, expect: [boxW, 48 * h - 10.5, D - 2.3] });

      // Facade with its handle, screw caps and label.
      const facade = parts.find({ category: 'drawers', group: 'Facades', size: bs, height: h });
      if (!facade) missing(`${bs}${h}F drawer facade`);
      addBom(facade, 1, 'Drawers');
      const fl = drawerFacadeLayout(bs, h);
      const fp = place({ partId: facade?.id, role: 'facade', lvl, h, slot: { ...slot, x: bcx, width: bw }, expect: [bw, fl.H, FIT.facadeT] });
      addHw('M4 14mm bolt', fl.holes.length);

      if (!keyPart) missing('drawer key / handle');
      addBom(keyPart, 1, 'Drawers', build.handle === 'hidden' ? 'hidden key handle' : 'handle');
      if (build.handle === 'hidden') {
        // Flush dial. The removable key (part 2) is one per build, drawn in the
        // top drawer's lock (see resolve()).
        const hk = place({ partId: keyPart?.id, role: 'key', attach: { to: fp.key, x: fl.key.x, y: fl.key.y, zRef: 'front', z: -8 }, expect: [45, 36.5, 18.4] });
        state.hiddenKeyAt = hk.key;
      } else {
        addBom(keyPart2, 1, 'Drawers');
        // Dial face flush with the facade, gear behind it, 15 mm grip tab in front.
        const kp = place({ partId: keyPart?.id, role: 'key', attach: { to: fp.key, x: fl.key.x, y: fl.key.y, zRef: 'front', z: -1.2 }, expect: [45, 36.5, 33.4] });
        // The cap slides over the grip tab, flush with its end.
        place({ partId: keyPart2?.id, role: 'keycap', attach: { to: kp.key, x: 0, y: 0, zRef: 'front', z: -5.85 }, expect: [37.8, 13.2, 11.7] });
      }
      addBom(capPart, fl.caps.length, 'Drawers', 'screw hole fillers');
      for (const c of fl.caps) {
        place({ partId: capPart?.id, role: 'fcap', attach: { to: fp.key, x: c.x, y: c.y, zRef: 'front', z: -1.7 }, expect: [9.8, 9.8, 3.8] });
      }
      addBom(labelPart, 1, 'Drawers', 'covers the last screw');
      place({ partId: labelPart?.id, role: 'label', attach: { to: fp.key, x: fl.label.x + 4, y: fl.label.y, zRef: 'front', z: -1.6 }, expect: [47.9, 20.6, 2] });

      // Gridfinity baseplate, lying on the box floor.
      if (cfg.interior?.startsWith('gridfinity')) {
        const variant = { gridfinity: '', 'gridfinity-1h': 'baseplate-1-handle', 'gridfinity-2h': 'baseplate-2-handles' }[cfg.interior];
        let gp = parts.wholeOrParts({ category: 'drawers', group: 'Baseplates', size: bs, depth: d, variant });
        if (!gp.files.length && variant) {
          gp = parts.wholeOrParts({ category: 'drawers', group: 'Baseplates', size: bs, depth: d, variant: '' });
        }
        gp.files.forEach((f) => addBom(f, 1, 'Drawers', null, 'inserts'));
        if (!gp.files.length) missing(`${bs}${d} gridfinity baseplate`);
        place({
          partId: gp.show?.id || gp.files[0]?.id,
          files: gp.files.map((f) => f.id),
          role: 'gridplate',
          attach: { to: bp.key, yRef: 'bottom', y: 2, yAlign: 'above' },
          expect: [boxW - 8.4, null, D - 12.1],
        });
      }

      // Grid dividers: T-profile walls pinned into the box floor holes. Full-width
      // pieces are named after the size (10-S, 18-M, 26-L, 32-XL), full-depth
      // ones after the depth (x3 = 10 … x7 = 26). Each gets two border pieces
      // (sealing to the walls) and two pins.
      if (cfg.interior === 'griddividers') {
        const tall = cfg.divTall && h >= 1;
        const hFolder = !tall ? /20MM TALL/ : h === 1 ? /34\.5MM TALL/ : /82\.5MM TALL/;
        const hLabel = !tall ? '20MM' : h === 1 ? '1F' : '2F';
        const H = !tall ? 20 : h === 1 ? 34.5 : 82.5;
        const piece = (n) => parts.find({ category: 'drawers', group: 'Universal', path: hFolder, name: new RegExp(`^${n}(?![0-9])`) });
        const borderKind = build.dividerBorder === 'rounded' ? 'Rounded' : 'Straight';
        const border = parts.find({ category: 'drawers', group: 'Universal', path: hFolder, name: new RegExp(`^${borderKind} Edge Piece ${hLabel}`) });
        const pin = build.dividerPins === 'tight' ? uni(/^grid divider pin_tight/) : uni(/^grid divider pin_loose/);
        const across = clampInt(cfg.across ?? 1, 0, 6);
        const along = clampInt(cfg.along ?? 1, 0, 6);
        const wN = { S: 10, M: 18, L: 26, XL: 32 }[bs];
        const dN = { 3: 10, 4: 14, 5: 18, 6: 22, 7: 26 }[d];
        const wp = piece(wN);
        const dp = piece(dN);
        if (across && !wp) missing(`grid divider ${wN} (${hLabel})`);
        if (along && !dp) missing(`grid divider ${dN} (${hLabel})`);
        // With across dividers present, each front-back line is split into
        // segments between them, using the generic piece for the open holes
        // (instructions option 1: no border, tiny gap at the wall).
        const segs = across + 1;
        const segHoles = across ? Math.floor((dN - across) / segs) : dN;
        const sp = across ? piece(segHoles) : dp;
        const alongOK = along && (!across || (segHoles >= 5 && sp));
        if (along && !alongOK) {
          state.warnings.push(`Front-back grid dividers don't fit between ${across} across dividers in a ${bs}${d} drawer; leaving them out.`);
        }
        const alongPieces = alongOK ? along * (across ? segs : 1) : 0;
        const bordered = across + (alongOK && !across ? along : 0);
        addBom(wp, across, 'Drawers', 'grid divider across the drawer', 'inserts');
        addBom(sp, alongPieces, 'Drawers', across ? `grid divider segment (${segHoles} holes)` : 'grid divider front to back', 'inserts');
        addBom(border, 2 * bordered, 'Drawers', 'grid divider border pieces', 'inserts');
        addBom(pin, 2 * (across + alongPieces), 'Drawers', 'grid divider pins', 'inserts');
        const innerD = D - 14;
        const innerW = boxW - 14;
        const acrossZ = Array.from({ length: across }, (_, i) => -innerD / 2 + (innerD * (i + 1)) / (across + 1));
        for (const z of acrossZ) {
          const dvp = place({ partId: wp?.id, role: 'divider', attach: { to: bp.key, yRef: 'bottom', y: 3, yAlign: 'above', z }, expect: [innerW, H, 25.4] });
          for (const sx of [-1, 1]) {
            place({ partId: border?.id, role: 'divider', attach: { to: dvp.key, x: sx * (innerW / 2 + 3), yRef: 'bottom', yAlign: 'above' }, expect: [9, H, 25.3] });
            place({ partId: pin?.id, role: 'divider', attach: { to: dvp.key, x: sx * (innerW / 2 - 12), yRef: 'bottom', y: -3, yAlign: 'above' }, expect: [6, 13.9, 4.9] });
          }
        }
        if (alongOK) {
          const bounds = [-innerD / 2, ...acrossZ, innerD / 2];
          for (let i = 1; i <= along; i++) {
            const x = -innerW / 2 + (innerW * i) / (along + 1);
            if (!across) {
              const dvp = place({ partId: dp?.id, role: 'divider', attach: { to: bp.key, x, yRef: 'bottom', y: 3, yAlign: 'above' }, expect: [25.4, H, innerD] });
              for (const sz of [-1, 1]) {
                place({ partId: border?.id, role: 'divider', attach: { to: dvp.key, yRef: 'bottom', yAlign: 'above', z: sz * (innerD / 2 + 3) }, expect: [25.3, H, 9] });
                place({ partId: pin?.id, role: 'divider', attach: { to: dvp.key, yRef: 'bottom', y: -3, yAlign: 'above', z: sz * (innerD / 2 - 12) }, expect: [4.9, 13.9, 6] });
              }
              continue;
            }
            for (let k = 0; k < segs; k++) {
              const z = (bounds[k] + bounds[k + 1]) / 2;
              const len = bounds[k + 1] - bounds[k] - 14;
              const dvp = place({ partId: sp.id, role: 'divider', attach: { to: bp.key, x, yRef: 'bottom', y: 3, yAlign: 'above', z }, expect: [25.4, H, len] });
              for (const sz of [-1, 1]) {
                place({ partId: pin?.id, role: 'divider', attach: { to: dvp.key, yRef: 'bottom', y: -3, yAlign: 'above', z: sz * (len / 2 - 10) }, expect: [4.9, 13.9, 6] });
              }
            }
          }
        }
      }

      // ---- Lock mechanism and runner slides (see Drawer Assembly in the docs).
      addBom(springs, 1, 'Drawers', 'pair of springs for the key lock');
      addBom(latch, 1, 'Drawers');
      // Slides ride in the box's side channels, one per level of the box.
      for (const side of [-1, 1]) {
        for (let k = 0; k < h; k++) {
          addBom(slide, 1, 'Drawers', 'runner slide, rides on the box');
          place({ partId: slide?.id, role: 'slide', attach: { to: bp.key, x: side * (boxW / 2 - sT / 4), yRef: 'bottom', y: 18.7 + 48 * k, yAlign: 'center', z: -12 }, expect: [sT, 18.2, D - 28.1] });
        }
      }
      // Springs sit in the back of the facade around the key's gear (the file holds both).
      place({ partId: springs?.id, role: 'spring', attach: { to: fp.key, x: fl.key.x, y: fl.key.y, zRef: 'back', z: 0, zAlign: 'out' }, expect: [75.6, 47.5, 5.2] });
      // The latch clips in under the drawer front: the module floor, or the ledge for upper boxes.
      place({ partId: latch?.id, role: 'dlatch', attach: { to: mp.key, x: dx, yRef: 'bottom', y: 0.5 + 48 * lvl, yAlign: 'above', zRef: 'front', z: -6, zAlign: 'in' }, expect: [96.6, 4.5, 74.6] });

      // Geared rails: one file = the pair (a 6.2 mm upper and a 4.8 mm lower
      // rack). They slide into two tunnels in the box's front wall, one from
      // each side, and the key's gear drives them out into the module walls.
      // Every box gets them (they're what lock a box when several share a
      // module); each rack is drawn on its own.
      const rails = parts.find({ category: 'drawers', group: 'Universal', size: bs, name: /Rails$/ });
      if (!rails) missing(`${bs} geared rails`);
      addBom(rails, 1, 'Drawers', 'pair of geared racks (upper + lower)');
      const len = { S: 121.1, M: 165.7, L: 203.5, XL: 248.5 }[bs];
      const shift = Math.max(0, (boxW - len) / 2);
      const upper = place({
        partId: rails?.id,
        role: 'grail',
        body: 'tallest',
        weight: 0.5,
        // Both racks come out of the file teeth-up; the upper one is turned over
        // so its teeth face down onto the gear.
        rot: { z: 180 },
        attach: { to: bp.key, x: shift, yRef: 'bottom', y: 33.3, yAlign: 'center', zRef: 'front', z: -3 },
        expect: [len, 12.3, 3.8],
      });
      place({
        partId: rails?.id,
        role: 'grail',
        body: 'shortest',
        weight: 0.5,
        colorFrom: upper.cid,
        attach: { to: bp.key, x: -shift, yRef: 'bottom', y: 4.1, yAlign: 'center', zRef: 'front', z: -3 },
        expect: [len, 12.3, 3.8],
      });
    }
  });
  if (size === 'L2') {
    // Divider pieces that hold the two S boxes of an L² module apart.
    parts.findAll({ category: 'drawers', group: 'Universal', depth: d, name: /Accessory/ }).forEach((p) => {
      addBom(p, 1, 'Drawers');
      place({ partId: p.id, role: 'l2acc', attach: { to: mp.key, yRef: 'bottom', y: FIT.boxFloor, yAlign: 'above' }, expect: [null, null, D - 10] });
    });
  }
}

function resolveSustainer({ size, F, d, D, col, slot, build, parts, addBom, addHw, place, missing }) {
  const w = WIDTH[size];
  const big = size === 'L' || size === 'XL';
  let interior = col.interior || 'flat';
  if (interior === 'sealed' && !big) interior = 'flat';
  const variant = big ? (interior === 'dividers' ? 'dividers' : interior === 'sealed' ? 'sealed' : 'flat') : '';
  const module = parts.find({ category: 'sustainers', group: 'Modules', size, depth: d, height: F, variant });
  if (!module) missing(`${SIZE_LABEL[size]}${d} ${F}F sustainer module`);
  addBom(module, 1, 'Sustainers');
  const bodyH = variant === 'sealed' ? null : SUSTAINER_H[F];
  const mp = place({ partId: module?.id, role: 'smodule', slot, expect: [w, bodyH, D], iface: ifaceFor(parts, size, d) });

  const lid = parts.wholeOrParts({ category: 'sustainers', group: 'Roofs', size, depth: d, variant: '' }, build.splitPrints);
  if (!lid.files.length) missing(`${size}${d} sustainer lid`);
  lid.files.forEach((f) => addBom(f, 1, 'Sustainers'));
  if (lid.split) addBom(parts.find({ category: 'sustainers', group: 'Roofs', size, depth: d, variant: 'roof-connector' }), 1, 'Sustainers');
  const lidFiles = lid.files.map((f) => f.id);
  if (lid.split) {
    const conn = parts.find({ category: 'sustainers', group: 'Roofs', size, depth: d, variant: 'roof-connector' });
    if (conn) lidFiles.push(conn.id);
  }
  const lp = place({ partId: lid.show?.id, role: 'lid', files: lidFiles, slot, expect: [w, 27.8, D + 10], iface: ifaceFor(parts, size, d) });

  const facade =
    parts.find({ category: 'sustainers', group: 'Facades', size, height: F, path: /Families/ }) ||
    parts.find({ category: 'sustainers', group: 'Facades', size, height: F });
  if (!facade) missing(`${size}${F}F sustainer facade`);
  addBom(facade, 1, 'Sustainers');
  const fp = place({ partId: facade?.id, role: 'sfacade', slot, expect: [w, null, FIT.facadeT] });

  const uni = (re) => parts.find({ category: 'sustainers', group: 'Universal', name: re });
  const sm = size === 'S' || size === 'M';

  // Hinges (measured from the STLs and the module/lid screw holes):
  //  - the Hinge file holds both bottom leaves; each screws to the inside of
  //    the back wall (2×2 holes) and its knuckle sits at rim height, ~8 mm
  //    behind the back wall (the back wall is lower, so the riser passes over);
  //  - the Hinge Top file holds the lid side: one plate across the middle on
  //    S/M, two plates on L/XL, screwed under the lid (holes 16 and 36 mm in
  //    from the lid's back edge);
  //  - the Rods file holds both pins; each runs through a leaf and the top
  //    plate's knuckle, head outward.
  // All knuckles share one axis; the lid pivots on it.
  const hinge = sm ? uni(F === 1 ? /^S-M 1F Hinge/ : /^S-M 2-4F Hinge/) : uni(F === 1 || size === 'XL' ? /^L-XL 1F Hinge/ : /^L 2-4F Hinge/);
  const hingeTop = uni(size === 'S' ? /^S Hinge Top/ : size === 'M' ? /^M Hinge Top/ : /^L-XL Hinge Top/);
  const rods = uni(sm ? /^S-M Rods/ : /^L-XL Rods/);
  if (!hinge) missing(`${size} ${F}F hinge`);
  if (!hingeTop) missing(`${size} hinge top`);
  addBom(hinge, 1, 'Sustainers', 'both hinge leaves (module side)');
  addBom(hingeTop, 1, 'Sustainers', sm ? 'hinge plate (lid side)' : 'both hinge plates (lid side)');
  addBom(rods, 1, 'Sustainers', 'both hinge pins');
  const hg = HINGE_GEOMETRY[size];
  const leafKnuckle = HINGE_LEAF_KNUCKLE[hinge?.name] || [16.9, 20.4];
  const axis = { yRef: 'top', y: HINGE_AXIS.dy, zRef: 'back', z: HINGE_AXIS.dz };
  let firstLeaf = null;
  hg.leaves.forEach((lx, i) => {
    // Leaf frame: plate in x/z, knuckle bore along z at (kx, ky). Map z -> X,
    // x -> Y (knuckle up), y -> -Z (plate in front of the axis, on the wall).
    const lp2 = place({
      partId: hinge?.id,
      role: 'hinge',
      weight: 0.5,
      colorFrom: firstLeaf?.cid,
      attach: { to: mp.key, x: lx, ...axis },
      xform: { body: { axis: 1, sign: 1 }, origin: [leafKnuckle[0], leafKnuckle[1], 0], rows: [[0, 0, -1], [1, 0, 0], [0, -1, 0]] },
    });
    firstLeaf = firstLeaf || lp2;
  });
  let firstTop = null;
  hg.tops.forEach((tx) => {
    // Top frame: plate in y/z, knuckle bore along z at (kx, -21.5); plate's lid
    // face 7 mm above the knuckle. Map z -> X, x -> Y, y -> Z.
    const tp = place({
      partId: hingeTop?.id,
      role: 'hingetop',
      weight: 1 / hg.tops.length,
      colorFrom: firstTop?.cid,
      attach: { to: lp.key, x: tx, yRef: 'center', y: HINGE_AXIS.dyLid, zRef: 'back', z: HINGE_AXIS.dz },
      xform: { body: hg.tops.length > 1 ? { axis: 0, sign: 1 } : null, origin: [hg.topKx, -21.5, 0], rows: [[0, 0, 1], [1, 0, 0], [0, 1, 0]] },
    });
    firstTop = firstTop || tp;
  });
  // Pins: head outward at each end of the hinge line, shaft running inward.
  let firstRod = null;
  for (const side of [-1, 1]) {
    const rp = place({
      partId: rods?.id,
      role: 'hinge',
      weight: 0.5,
      colorFrom: firstRod?.cid,
      attach: { to: mp.key, x: side * (hg.leafOuter + 3.7), ...axis },
      xform: {
        body: { axis: 1, sign: 1 },
        origin: [hg.rodHeadX, hg.rodAxisY, 0],
        rows: side < 0 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
      },
    });
    firstRod = firstRod || rp;
  }

  // Latches on the front: S/M have one, L/XL two. Each is a holder screwed to
  // the facade, an outer lever that hooks over the lid, an inner link and pins.
  const locks = SUSTAINER_LOCK_X[size];
  const holder = uni(/^LOCK HOLDER/);
  const inner = uni(/^LOCK INNER/);
  const outer = uni(F === 1 ? /^LOCK OUTER PART 1F/ : /^LOCK OUTER PART 2-4F/);
  const pins = uni(/^1 SET OF PINS/);
  addBom(holder, locks.length, 'Sustainers', 'latch');
  addBom(inner, locks.length, 'Sustainers', 'latch');
  addBom(outer, locks.length, 'Sustainers', 'latch lever');
  addBom(pins, locks.length, 'Sustainers', 'one set per latch');
  // Closed latch (see LATCH). Frames map file z -> X, x -> Y (up), y -> Z (out);
  // the holder is turned over (its UP markers say file −x is up).
  const drop = LOCK_HOLDER_DROP[F];
  const LATCH_ROWS = [[0, 0, 1], [1, 0, 0], [0, 1, 0]];
  const HOLDER_ROWS = [[0, 0, -1], [-1, 0, 0], [0, 1, 0]];
  // Holder pivot, relative to the facade's top edge and front face.
  const pivotY = -drop - LATCH.pivot[0];
  const pivotZ = -FIT.facadeT + (LATCH.pivot[1] - LATCH.holderPlateFront);
  // Lever: walls on the pocket floor; its knuckle hangs on the link below the pivot.
  const knuckleZ = -LATCH.pocket + LATCH.knuckleY;
  const dz = knuckleZ - pivotZ;
  const dy = Math.sqrt(LATCH.link ** 2 - dz ** 2);
  const knuckleY = pivotY - dy;
  const cosL = dy / LATCH.link;
  const sinL = dz / LATCH.link;
  // Link: ears (file +x) up at the pivot, bar down at the lever's knuckle.
  const LINK_ROWS = [
    [0, 0, 1],
    [cosL, sinL, 0],
    [-sinL, cosL, 0],
  ];
  for (const lx of locks) {
    const at = (y, z, zRef = 'front') => ({ to: fp.key, x: lx, yRef: 'top', y, zRef, z });
    place({ partId: holder?.id, role: 'lockholder', attach: at(-drop, 0, 'back'), xform: { origin: [0, LATCH.holderPlateFront, 0], rows: HOLDER_ROWS } });
    place({ partId: inner?.id, role: 'lockinner', attach: at(pivotY, pivotZ), xform: { origin: [LATCH.linkEar, 0, 0], rows: LINK_ROWS } });
    place({ partId: pins?.id, role: 'lockinner', attach: at(knuckleY, knuckleZ), xform: { origin: [0, 0, 0], rows: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } });
    place({ partId: outer?.id, role: 'lockouter', attach: at(knuckleY, knuckleZ), xform: { origin: [LATCH.knuckle[F === 1 ? 1 : 2], LATCH.knuckleY, 0], rows: LATCH_ROWS } });
  }

  const slabel = uni(/^Label for Sustainers/);
  addBom(slabel, 1, 'Sustainers');
  place({ partId: slabel?.id, role: 'label', attach: { to: fp.key, x: -w / 2 + 34, yRef: 'bottom', y: 6, yAlign: 'above', zRef: 'front', z: -1.6 }, expect: [38.1, 20.1, 2] });
  addHw('M4 10mm bolt', 8); // two hinge leaves × 4
  addHw('M4 14mm bolt', 4 * hg.tops.length + 4 * locks.length); // hinge plate(s) × 4 + lock holders × 4
  addHw('M4 20mm bolt', 7);

  // Interiors, drawn inside the module.
  const innerW = w - 6;
  const innerD = D - 8;
  if (interior === 'gridfinity') {
    const gp = parts.wholeOrParts({ category: 'sustainers', group: 'Baseplates', size, depth: d });
    gp.files.forEach((f) => addBom(f, 1, 'Sustainers', null, 'inserts'));
    if (!gp.files.length) missing(`${size}${d} sustainer baseplate`);
    place({ partId: gp.show?.id || gp.files[0]?.id, files: gp.files.map((f) => f.id), role: 'sbaseplate', attach: { to: mp.key, yRef: 'bottom', y: 3, yAlign: 'above' }, expect: [innerW - 4, null, innerD - 4] });
  } else if (interior === 'dividers' || interior === 'sealed') {
    const across = clampInt(col.across ?? (big ? 1 : 2), 0, 8);
    const along = clampInt(col.along ?? (big ? (size === 'XL' ? 4 : 3) : 0), 0, 10);
    const zs = (n) => Array.from({ length: n }, (_, i) => -innerD / 2 + (innerD * (i + 1)) / (n + 1));
    const xs = (n) => Array.from({ length: n }, (_, i) => -innerW / 2 + (innerW * (i + 1)) / (n + 1));
    const putAcross = (part, x, len) => (z) => place({ partId: part?.id, role: 'divider', attach: { to: mp.key, x, yRef: 'bottom', y: 3, yAlign: 'above', z }, expect: [len, null, 2] });
    if (interior === 'sealed') {
      // Sealed rows across the box: L = two seal dividers, XL = centre + two sides.
      const rows = across || 1;
      if (size === 'L') {
        const sd = uni(new RegExp(`^L-${F}F Seal Divider`));
        addBom(sd, 2 * rows, 'Sustainers', 'seal dividers, two per row', 'inserts');
        for (const z of zs(rows)) for (const x of [-innerW / 4, innerW / 4]) putAcross(sd, x, 160.7)(z);
      } else {
        const c = uni(/^XL Seal Divider \(Center/);
        const sdv = uni(/^XL Seal Divider \(Sides/);
        addBom(c, rows, 'Sustainers', 'seal divider, centre', 'inserts');
        addBom(sdv, 2 * rows, 'Sustainers', 'seal dividers, sides', 'inserts');
        for (const z of zs(rows)) {
          putAcross(c, 0, 123.5)(z);
          for (const sx of [-1, 1]) putAcross(sdv, sx * (123.5 / 2 + 143 / 2), 143)(z);
        }
      }
    } else if (sm) {
      const dv = uni(new RegExp(`^${size}${F}F Divider`));
      addBom(dv, across, 'Sustainers', 'dividers across the box', 'inserts');
      for (const z of zs(across)) putAcross(dv, 0, innerW - 2)(z);
    } else {
      const depthDiv =
        size === 'L'
          ? parts.find({ category: 'sustainers', group: 'Universal', size: 'L', depth: d, height: F, name: /Depth Divider/ })
          : parts.find({ category: 'sustainers', group: 'Universal', size: 'XL', depth: d, name: /Depth Divider/ });
      const widthDiv = size === 'L' ? uni(new RegExp(`^L-${F}F Width Divider`)) : uni(/^XL Width Divider/);
      addBom(depthDiv, along, 'Sustainers', 'dividers front to back', 'inserts');
      addBom(widthDiv, across, 'Sustainers', 'dividers across the box', 'inserts');
      for (const x of xs(along)) place({ partId: depthDiv?.id, role: 'divider', attach: { to: mp.key, x, yRef: 'bottom', y: 3, yAlign: 'above' }, expect: [2, null, innerD - 1] });
      for (const z of zs(across)) putAcross(widthDiv, 0, innerW - 3)(z);
    }
  }
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

/** Friendly names for pegboard accessory files ("Hook 40mm C", "Container 75mm × 4in B"). */
export function accessoryLabel(part) {
  const f = part.folders.join('/');
  let m;
  if ((m = /HOOKS\/(\d+mm)$/.exec(f))) return `Hook ${m[1]} ${part.name}`;
  if (/HOOKS$/.test(f)) return `Hook ${part.name}`;
  if ((m = /Depth_(\d+mm)\/Width_(\d+) inches/.exec(f))) return `Container ${m[1]} deep × ${m[2]}in, ${part.name}`;
  if (/HOOKs for containers/.test(f)) return `Container hook ${part.name}`;
  if (/holders/i.test(part.name)) return 'Pegboard holders (37mm ×4)';
  if (part.folders.includes('Grid Dividers')) {
    const ht = /20MM/.test(f) ? '20 mm' : /34\.5MM/.test(f) ? '1F height' : /82\.5MM/.test(f) ? '2F height' : '';
    const nm = part.name.replace(/,\s*x\d$/, '').replace(/_/g, ' ');
    return /^\d/.test(nm) ? `Grid divider ${nm} holes${ht ? `, ${ht}` : ''}` : `Grid divider ${nm}${ht && !nm.includes(ht) ? `, ${ht}` : ''}`;
  }
  return part.name;
}

// ---------------------------------------------------------------- layout

/**
 * Computes world transforms for placements.
 * dimsOf(placement) -> [w, h, d] of the oriented mesh, or null (use expect / nominal).
 * opts: { open: 0..1 drawers pulled out, explode: 0..1 }
 * Returns Map key -> { x, y, z, w, h, d } (center + size), plus total bounds.
 */
export function layout(build, res, dimsOf, opts = {}) {
  const open = opts.open || 0;
  const gap = (opts.explode || 0) * 60;
  const W = WIDTH[build.width];
  const D = depthMM(build.depth);
  const out = new Map();
  const dims = (pl) => {
    const real = dimsOf(pl);
    const e = pl.expect || [];
    return [0, 1, 2].map((i) => real?.[i] ?? e[i] ?? nominal(pl, build)[i]);
  };
  const set = (pl, x, y, z, s, rx = 0) => out.set(pl.key, { x, y, z, w: s[0], h: s[1], d: s[2], rx });
  // Top-level placements only; attached parts are positioned from their parent.
  const byRole = (role) => res.placements.filter((p) => p.role === role && !p.attach);

  // ---- ground: base, feet, wheels
  let y = 0;
  const base = byRole('base')[0];
  if (base) {
    const bs = dims(base);
    let under = 0;
    const feet = byRole('foot');
    if (feet.length) {
      const fs = dims(feet[0]);
      under = fs[1] - FIT.footTuck;
      for (const f of feet) {
        const s = dims(f);
        set(f, 0, s[1] / 2 - gap * 0.5, f.side * (D / 2 - s[2] / 2 - 10), s);
      }
    }
    if (build.base === 'wheels') under = Math.max(under, FIT.wheelR - 20);
    if (build.base === 'casters') under = 45;
    const by = under + bs[1] / 2;
    set(base, 0, by, 0, bs);
    for (const wpl of [...byRole('wheel'), ...byRole('wheelcover')]) {
      const s = dims(wpl);
      const off = wpl.role === 'wheel' ? s[0] / 2 : s[0] / 2 + dims(byRole('wheel')[0] || wpl)[0] - 8;
      set(wpl, wpl.side * (W / 2 + off + 2 + gap * 0.5), FIT.wheelR, -D / 2 + FIT.wheelR - 10, s);
    }
    y = under + bs[1] - FIT.baseLip + gap;
  }

  // ---- levels
  const levelY = [];
  const colTops = new Map(); // "level:col" -> top y of that column
  (build.levels || []).forEach((lv, li) => {
    let levelH = 0;
    const items = res.placements.filter((p) => p.slot && p.slot.level === li);
    const cols = [...new Set(items.filter((p) => p.slot.col !== undefined).map((p) => p.slot.col))];
    for (const ci of cols) {
      const colItems = items.filter((p) => p.slot.col === ci);
      const mod = colItems.find((p) => p.role === 'module' || p.role === 'smodule');
      if (!mod) continue;
      const ms = dims(mod);
      set(mod, mod.slot.x, y + ms[1] / 2, 0, ms);
      let colH = ms[1] - FIT.lip;
      if (mod.role === 'module') {
        for (const p of colItems) {
          const s = dims(p);
          const pull = open * (D * 0.55);
          // Boxes stack inside the module: box k starts 48 mm × its level up.
          const lvl = p.lvl || 0;
          const bh = p.h || lv.height;
          if (p.role === 'box') set(p, p.slot.x, y + FIT.boxFloor + 48 * lvl + s[1] / 2, pull, s);
          if (p.role === 'facade') set(p, p.slot.x, y + 48 * lvl + 24 * bh, D / 2 + s[2] / 2 + pull, s);
        }
      } else {
        const lid = colItems.find((p) => p.role === 'lid');
        let lidTop = y + ms[1];
        if (lid) {
          const ls = dims(lid);
          const ly = y + ms[1] - FIT.lidSeat + gap * 0.3;
          lidTop = ly + ls[1];
          colH = lidTop - y - FIT.lip;
          // Lids swing open around the hinge line at the top of the back wall —
          // only on the top level, where nothing is stacked on the lid.
          const isTop = li === build.levels.length - 1;
          const a = isTop ? -open * THREE_DEG * 105 : 0;
          // The lid is 10 mm deeper than the module (the facade's thickness): its
          // back edge is flush with the module back and its front covers the facade.
          // Pivot on the hinge axis (rim height, behind the back wall).
          const py = y + ms[1] + HINGE_AXIS.dy;
          const pz = -ms[2] / 2 + HINGE_AXIS.dz;
          const dy = ly + ls[1] / 2 - py; // closed lid centre relative to the pivot
          const dz = -ms[2] / 2 + ls[2] / 2 - pz;
          set(lid, mod.slot.x, py + dy * Math.cos(a) - dz * Math.sin(a), pz + dy * Math.sin(a) + dz * Math.cos(a), ls, a);
        }
        const fac = colItems.find((p) => p.role === 'sfacade');
        if (fac) {
          // Facade sits 4.8 mm above the module floor with its top flush to the rim.
          const s = dims(fac);
          set(fac, mod.slot.x, y + FIT.sFacadeLift + s[1] / 2, D / 2 + s[2] / 2, s);
        }
      }
      colTops.set(`${li}:${ci}`, y + colH);
      levelH = Math.max(levelH, colH);
    }
    levelY.push({ y0: y, y1: y + levelH });
    y += levelH + gap;
  });
  let top = y - gap;

  // ---- roof & top handle
  for (const r of byRole('roof')) {
    const s = dims(r);
    const ry = (colTops.get(`${r.slot.level}:${r.slot.col}`) ?? top) + gap;
    set(r, r.slot.x, ry + s[1] / 2, 0, s);
    top = Math.max(top, ry + s[1]);
    // Handles are attached to the roof (positioned with the other attached
    // parts); they just add to the overall height.
    const th = res.placements.find((p) => p.role === 'tophandle' && p.attach?.to === r.key);
    if (th) {
      const ts = dims(th);
      top = Math.max(top, ry + s[1] + ts[1] - 1);
    }
  }
  // Sustainer lids on top count too.
  for (const [k, v] of out) {
    const pl = res.placements.find((p) => p.key === k);
    if (pl?.role === 'lid') top = Math.max(top, v.y + v.h / 2);
  }

  // ---- back side: layers of boards stacked per level (backbone, then
  // pegboard attachments / wall mounts outside it).
  let backZ = -D / 2;
  const backLayer = (...roles) => {
    const items = res.placements.filter((p) => roles.includes(p.role) && !p.attach && p.slot);
    if (!items.length) return;
    let t = 0;
    const cursor = new Map();
    for (const p of items) {
      const L = levelY[p.slot.level];
      if (!L) continue;
      const s = dims(p);
      t = Math.max(t, s[2]);
      // Stack per side (universal boards and locks sit left and right).
      const k = `${p.slot.level}|${Math.sign(p.bx || 0)}`;
      const y0 = cursor.get(k) ?? L.y0 + 4;
      set(p, p.bx || 0, y0 + s[1] / 2, backZ - s[2] / 2 - gap * 0.3, s);
      cursor.set(k, y0 + s[1] + 1);
    }
    backZ -= t + gap * 0.3;
  };
  // The handle lock stands in for the top backbone board, so it stacks with them.
  backLayer('backbone', 'handlelock');
  backLayer('pegboard');
  backLayer('wallmount');
  // Stationary handle without a board to bolt to (shouldn't happen): behind the top level.
  for (const h of byRole('stathandle')) {
    const L = levelY[levelY.length - 1];
    if (!L) continue;
    const s = dims(h);
    set(h, 0, (L.y0 + L.y1) / 2 + FIT.lip / 2, backZ - s[2] / 2 - gap * 0.3, s);
  }
  // Pegboard accessories: laid out on a shelf beside the build.
  {
    let ax = W / 2 + 60;
    let az = D / 2;
    let rowD = 0;
    const shelfItems = [...res.placements.filter((p) => p.shelf && !p.attach), ...byRole('accessory')];
    for (const a of shelfItems) {
      const s = dims(a);
      if (ax - W / 2 > 420) {
        ax = W / 2 + 60;
        az -= rowD + 20;
        rowD = 0;
      }
      set(a, ax + s[0] / 2, s[1] / 2, az - s[2] / 2, s);
      ax += s[0] + 15;
      rowD = Math.max(rowD, s[2]);
    }
  }
  for (const h of byRole('pullhandle')) {
    const s = dims(h);
    // Drawn pulled out, 120 mm above the top.
    const hy = top + 120 + s[1] / 2 + gap;
    // Rods run through the boards' and lock's holes, ~16.5 mm behind the modules.
    const rz = -D / 2 - 16.5 - gap * 0.3;
    // The legs' rod holes are 3 mm off the handle's mid-depth, towards the back.
    set(h, 0, hy, rz + 3, s);
    const floor = base ? out.get(base.key).y : 0;
    const rodTop = hy - s[1] / 2 + 30; // ~30 mm up into the legs
    for (const r of byRole('rod')) {
      const len = rodTop - floor;
      set(r, r.side * (ROD_X[build.width] ?? s[0] / 2 - 17.5), floor + len / 2, rz, [16, len, 16]);
    }
    top += 120 + s[1];
  }

  // ---- attached parts (handles, caps, labels, hinges, latches)
  for (const pl of res.placements) {
    const a = pl.attach;
    if (!a) continue;
    const p = out.get(a.to);
    if (!p) continue;
    const s = dims(pl);
    let oy = a.yRef === 'top' ? p.h / 2 : a.yRef === 'bottom' ? -p.h / 2 : 0;
    oy += a.y || 0;
    if (a.yAlign === 'below') oy -= s[1] / 2;
    if (a.yAlign === 'above') oy += s[1] / 2;
    const dir = a.zRef === 'back' ? -1 : 1;
    let oz = a.zRef === 'front' ? p.d / 2 : a.zRef === 'back' ? -p.d / 2 : 0;
    oz += a.z || 0;
    if (a.zAlign === 'out') oz += (dir * s[2]) / 2;
    if (a.zAlign === 'in') oz -= (dir * s[2]) / 2;
    const ox = a.x || 0;
    const c = Math.cos(p.rx || 0);
    const sn = Math.sin(p.rx || 0);
    set(pl, p.x + ox, p.y + oy * c - oz * sn, p.z + oy * sn + oz * c, s, p.rx || 0);
  }

  return { transforms: out, height: top, width: W, depth: D };
}

const THREE_DEG = Math.PI / 180;

/** Fallback dims for placeholders. */
function nominal(pl, build) {
  const W = WIDTH[build.width];
  const D = depthMM(build.depth);
  switch (pl.role) {
    case 'roof':
      return [W, 22, D];
    case 'pegboard':
      return [W * 0.75, 47, FIT.pegboardT];
    case 'pullhandle':
      return [W * 0.7, 61.5, 35];
    case 'stathandle':
      return [W * 0.75, 47, 50];
    case 'sfacade':
      return [W, 46, FIT.facadeT];
    case 'smodule':
      return [W, 92.3, D];
    default:
      return [W, 48, D];
  }
}

// ---------------------------------------------------------------- appearance

export const COLORS = {
  module: 0xdcdedf,
  smodule: 0xdcdedf,
  lid: 0xe6e7e8,
  roof: 0xe6e7e8,
  facade: 0xeeeeee,
  sfacade: 0xeeeeee,
  box: 0x3b3e43,
  base: 0xcfd1d3,
  foot: 0x45484d,
  wheel: 0x2f3236,
  wheelcover: 0xbfc2c5,
  backbone: 0x3b3e43,
  pegboard: 0xc9cbce,
  tophandle: 0x45484d,
  pullhandle: 0x5a5e63,
  stathandle: 0xc9cbce,
  rod: 0x9aa0a6,
  key: 0x3b3e43,
  keycap: 0xe9eaeb,
  fcap: 0xf2f2f2,
  label: 0xf7f7f7,
  hinge: 0x3b3e43,
  hingetop: 0x3b3e43,
  lockholder: 0xc9ccd0,
  lockinner: 0x6b7077,
  lockouter: 0x3b3e43,
  part: 0xd6d8da,
};

/**
 * Per-role extra rotation (degrees) applied after the automatic axis fit, to
 * fix parts that come out upside down or facing backwards. Refine here.
 * Keys can also be part-name RegExps via ORIENT_BY_NAME.
 */
export const ORIENT_BY_ROLE = {
  // Drawer facades come out upside down: key belongs in the bottom row, label bottom-left.
  facade: { z: 180 },
  // Stacking parts (module, smodule, roof, lid, base) are oriented from their
  // connecting geometry in orient.js; these entries are only the fallback.
  smodule: { z: 180 },
  // Sustainer facades: the latch pockets (4.1 mm deep, notched at the top edge
  // for the holder's boss) face out, with the lock-holder screw holes near the top.
  sfacade: { z: 180 },
  // Hinge leaves: knuckle at the rim, leaf hanging down the back wall.
  hinge: { x: 180 },
  // Sustainer lids come out upside down. Flip around Z (front-back axis) so the
  // latch catches (at the latch x positions) stay at the front edge.
  lid: { z: 180 },
};
export const ORIENT_BY_NAME = [
  // [ /regex on part name/, { x: deg, y: deg, z: deg } ]
];
