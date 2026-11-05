// Build state + left-hand options panel.
import { COLOR_GROUPS, FILAMENTS, PRESETS, ensureColors, filamentName, groupColor } from './colors.js';
import { check, h, section, select, seg } from './dom.js';
import { HW_FINISHES } from './hardware.js';
import { openPlanner } from './planner.js';
import {
  accessoryLabel,
  BIN_MAX_H,
  boxStack,
  GRID_CELLS,
  boxSplits,
  BASES,
  DEPTHS,
  DRAWER_INTERIORS,
  HANDLES,
  HEIGHTS,
  LAYOUTS,
  PEGBOARDS,
  ROOFS,
  SIZES,
  SIZE_LABEL,
  SUSTAINER_INTERIORS,
  defaultBuild,
  depthMM,
  roofTakesHandle,
  newColumn,
  newId,
  newLevel,
} from './rules.js';

const STORAGE_KEY = 'vault-configurator:build';

/** Set by main.js: switch to the Bins tab. */
export const configHooks = { openBinsTab: null };

// ---------------------------------------------------------------- persistence

export function loadInitialBuild() {
  const fromHash = decodeHash(location.hash);
  if (fromHash) return fromHash;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* storage unavailable */
  }
  return defaultBuild();
}

export function saveBuild(build) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
  } catch {
    /* storage unavailable */
  }
}

export function shareUrl(build) {
  const json = JSON.stringify(build);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${location.origin}${location.pathname}#b=${b64}`;
}

function decodeHash(hash) {
  const m = /#b=([\w-]+)/.exec(hash || '');
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- validation

/** Heights every column of a level can use at the current depth. */
export function levelHeights(build, level, parts) {
  const layout = LAYOUTS[build.width].find((l) => l.key === level.layout) || LAYOUTS[build.width][0];
  let allowed = new Set(HEIGHTS);
  layout.cols.forEach((size, i) => {
    const type = level.cols[i]?.type || 'drawer';
    const hs = new Set(parts.heightsFor(type, size, build.depth));
    allowed = new Set([...allowed].filter((x) => hs.has(x)));
  });
  return HEIGHTS.filter((x) => allowed.has(x));
}

/** Makes a build consistent with the catalog (valid layouts, heights, types). */
/**
 * Planned bins: per box in the stack (bottom first), a list of { id, x, y, rot }
 * in grid cells. Only the shape is checked here; whether each bin still exists
 * and fits is decided when the build is resolved (with a warning), so changing
 * the depth back and forth doesn't throw a plan away.
 */
function cleanBins(bins) {
  if (!Array.isArray(bins)) return [];
  return bins.slice(0, 8).map((list) =>
    (Array.isArray(list) ? list : [])
      .filter((b) => b && typeof b.id === 'string' && b.id.length < 100)
      .slice(0, 200)
      .map((b) => ({ id: b.id, x: Math.max(0, Math.min(20, Math.round(Number(b.x) || 0))), y: Math.max(0, Math.min(20, Math.round(Number(b.y) || 0))), rot: !!b.rot })),
  );
}

export function sanitize(build, parts) {
  const b = { ...defaultBuild(), ...build };
  if (!SIZES.includes(b.width)) b.width = 'L';
  if (!DEPTHS.includes(b.depth)) b.depth = 5;
  b.levels = (b.levels || []).map((lv) => {
    const layouts = LAYOUTS[b.width];
    const layout = layouts.find((l) => l.key === lv.layout) || layouts[0];
    const cols = layout.cols.map((size, i) => {
      const c = { ...newColumn(), ...(lv.cols?.[i] || lv.cols?.[0] || {}) };
      if (layout.drawerOnly) c.type = 'drawer';
      const interiors = c.type === 'drawer' ? DRAWER_INTERIORS : SUSTAINER_INTERIORS;
      if (!interiors.some((o) => o.key === c.interior)) c.interior = interiors[0].key;
      if (c.type === 'sustainer' && c.interior === 'sealed' && !['L', 'XL'].includes(size)) c.interior = 'flat';
      return c;
    });
    const level = { id: lv.id || newId(), layout: layout.key, height: lv.height || 1, cols };
    const hs = levelHeights(b, level, parts);
    if (hs.length && !hs.includes(level.height)) {
      level.height = hs.reduce((best, x) => (Math.abs(x - level.height) < Math.abs(best - level.height) ? x : best), hs[0]);
    }
    // Drawer columns: the boxes stacked in the module must fill its height.
    // L²/XL² modules keep a setting per side (left / right box position).
    layout.cols.forEach((size, i) => {
      const c = level.cols[i];
      if (c.type !== 'drawer') {
        delete c.boxes;
        delete c.sides;
        return;
      }
      const sideSizes = SIDE_SIZES[size];
      if (sideSizes) {
        c.sides = sideSizes.map((bs, k) => {
          const sd = { interior: c.interior, boxes: c.boxes, across: c.across, along: c.along, divTall: c.divTall, ...((c.sides || [])[k] || {}) };
          sd.bins = cleanBins(sd.bins);
          if (!DRAWER_INTERIORS.some((o) => o.key === sd.interior)) sd.interior = 'empty';
          if (!drawerSplits(bs, b.depth, level.height, parts).some((sp) => sameList(sp, sd.boxes))) sd.boxes = [level.height];
          return sd;
        });
        delete c.boxes;
        return;
      }
      delete c.sides;
      const ok = drawerSplits(size, b.depth, level.height, parts).some((sp) => sameList(sp, c.boxes));
      if (!ok) c.boxes = [level.height];
    });
    for (const c of level.cols) {
      if (c.sides) delete c.bins;
      else c.bins = cleanBins(c.bins);
    }
    return level;
  });
  if (!ROOFS.some((r) => r.key === b.roof) && b.roof !== 'none') b.roof = 'grid';
  if (!BASES.some((r) => r.key === b.base)) b.base = 'none';
  if (!PEGBOARDS.some((r) => r.key === b.pegboard)) b.pegboard = 'none';
  if (!HANDLES.some((r) => r.key === b.handle)) b.handle = 'knob';
  b.colors = ensureColors(b);
  if (!['full', 'universal'].includes(b.backboneStyle)) b.backboneStyle = 'full';
  if (!HW_FINISHES.some((f) => f.key === b.hwFinish)) b.hwFinish = 'silver';
  b.showHardware = b.showHardware !== false;
  b.accessories = (Array.isArray(b.accessories) ? b.accessories : [])
    .filter((a) => a && parts.byId.has(a.id))
    .map((a) => ({ id: a.id, qty: Math.max(1, Math.min(99, Math.round(Number(a.qty) || 1))) }));
  return b;
}

// ---------------------------------------------------------------- panel

/**
 * Renders the options panel. `update(mutator)` applies a change to a draft
 * copy of the build and re-renders everything.
 */
export function renderConfig(root, build, parts, update) {
  const set = (k) => (v) => update((b) => void (b[k] = v));

  const name = h('input.text-input', {
    value: build.name,
    'aria-label': 'Build name',
    onchange: (e) => update((b) => void (b.name = e.target.value.trim() || 'My VAULT')),
  });

  const footprint = section(
    'Footprint',
    h('div.field', h('span', 'Width'), seg(SIZES.map((s) => ({ value: s, label: s })), build.width, set('width'))),
    h(
      'div.field',
      h('span', 'Depth (gridfinity units, 42 mm)'),
      seg(
        DEPTHS.map((d) => ({ value: d, label: String(d), sub: `${Math.round(depthMM(d))}mm` })),
        build.depth,
        set('depth'),
      ),
    ),
  );

  // Levels are shown top-first, like the real stack.
  const levelEls = [];
  const n = build.levels.length;
  for (let i = n - 1; i >= 0; i--) levelEls.push(renderLevel(build, i, parts, update));

  const stack = h(
    'div.section',
    h(
      'h3',
      'Stack',
      h(
        'button.btn.sm',
        {
          onclick: () =>
            update((b) => {
              const top = b.levels[b.levels.length - 1];
              b.levels.push(top ? { ...structuredClone(top), id: newId() } : newLevel(b.width));
            }),
        },
        '+ Add level',
      ),
    ),
    h('div.levels', levelEls, h('div.ground', build.base === 'none' ? 'floor' : 'base')),
  );

  const topHasSustainer = build.levels.length && build.levels[n - 1].cols.some((c) => c.type === 'sustainer');
  const roof = section(
    'Roof',
    build.levels.length
      ? [
          select([...ROOFS.map((r) => ({ value: r.key, label: r.label })), { value: 'none', label: 'No roof' }], build.roof, set('roof')),
          roofTakesHandle(build.roof)
            ? check('Top carry handle', build.topHandle, set('topHandle'), build.roof === 'grid' ? 'Bolts to the two holes in the grid roof' : 'Heavyweight handle + insert')
            : build.roof !== 'none'
              ? h('p.muted.hint', 'This roof has no handle mount. The gridfinity and heavyweight roofs take a top handle.')
              : null,
          topHasSustainer && build.roof !== 'none' ? h('p.muted.hint', 'On a sustainer the roof sits on its lid (same alignment keys) and lifts with it.') : null,
        ]
      : null,
  );

  const base = section('Base', select(BASES.map((b) => ({ value: b.key, label: b.label })), build.base, set('base')));

  const back = section(
    'Back & mounting',
    check('Backbone', build.backbone || build.pullHandle || build.stationaryHandle || build.pegboard !== 'none', set('backbone'), 'Reinforces and connects modules at the back'),
    check('Pull-out handle (trolley)', build.pullHandle, set('pullHandle')),
    check('Stationary handle', build.stationaryHandle, set('stationaryHandle')),
    build.backbone || build.pullHandle || build.stationaryHandle || build.pegboard !== 'none'
      ? [
          h(
            'div.field',
            h('span', 'Backbone boards'),
            seg(
              [
                { value: 'full', label: 'Full width' },
                { value: 'universal', label: 'Universal (narrow)' },
              ],
              build.backboneStyle,
              set('backboneStyle'),
              'small',
            ),
          ),
          check('Module connectors', build.connectors, set('connectors'), 'Connector pieces that tie stacked modules together at the back'),
        ]
      : null,
    check('Wall mounts', build.wallMount, set('wallMount')),
    h('div.field', h('span', 'Pegboard attachment'), seg(PEGBOARDS.map((p) => ({ value: p.key, label: p.label })), build.pegboard, set('pegboard'), 'small')),
  );

  const anyGrid = build.levels.some((l) => l.cols.some((c) => c.type === 'drawer' && c.interior === 'griddividers'));
  const drawers = section(
    'Drawers',
    h('div.field', h('span', 'Handle'), seg(HANDLES.map((x) => ({ value: x.key, label: x.label })), build.handle, set('handle'), 'small')),
    anyGrid
      ? [
          h('div.field', h('span', 'Grid divider pins'), seg([{ value: 'loose', label: 'Loose fit' }, { value: 'tight', label: 'Tight fit' }], build.dividerPins, set('dividerPins'), 'small')),
          h('div.field', h('span', 'Grid divider borders'), seg([{ value: 'straight', label: 'Straight' }, { value: 'rounded', label: 'Rounded' }], build.dividerBorder, set('dividerBorder'), 'small')),
        ]
      : null,
  );

  const colors = renderColors(build, update);

  const hardware = section(
    'Hardware',
    h('div.field', h('span', 'Screw finish'), seg(HW_FINISHES.map((f) => ({ value: f.key, label: f.label })), build.hwFinish, set('hwFinish'), 'small')),
    check('Show hardware in 3D', build.showHardware, set('showHardware'), 'Bolts, rods, bearings, collars and heat inserts'),
  );

  const printing = section(
    'Printing',
    check('Split large prints (depth 6–7)', build.splitPrints, set('splitPrints'), 'Use Part 1 / Part 2 files where available'),
    check('Manual supports for tall prints', build.manualSupports, set('manualSupports'), 'Print aids from the manual, one per 2F/4F module'),
  );

  const actions = section(
    'Build',
    h(
      'div.btn-row',
      h('button.btn.sm', { onclick: () => exportJson(build) }, 'Export JSON'),
      h('button.btn.sm', { onclick: () => importJson(update) }, 'Import JSON'),
      h(
        'button.btn.sm',
        {
          onclick: () => {
            if (confirm('Reset to the default build?')) update((b) => Object.assign(b, defaultBuild()));
          },
        },
        'Reset',
      ),
    ),
  );

  root.replaceChildren(h('div.field', name), footprint, stack, roof, drawers, base, back, renderAccessories(build, parts, update), colors, hardware, printing, actions);
}

function renderLevel(build, i, parts, update) {
  const lv = build.levels[i];
  const layouts = LAYOUTS[build.width];
  const layout = layouts.find((l) => l.key === lv.layout) || layouts[0];
  const hs = levelHeights(build, lv, parts);
  const n = build.levels.length;
  const mut = (fn) => update((b) => fn(b.levels[i], b));

  const tools = h(
    'div.level-tools',
    h('button', { title: 'Move up', disabled: i === n - 1, onclick: () => update((b) => swap(b.levels, i, i + 1)) }, '↑'),
    h('button', { title: 'Move down', disabled: i === 0, onclick: () => update((b) => swap(b.levels, i, i - 1)) }, '↓'),
    h('button', { title: 'Duplicate', onclick: () => update((b) => b.levels.splice(i + 1, 0, { ...structuredClone(lv), id: newId() })) }, '⧉'),
    h('button', { title: 'Remove', onclick: () => update((b) => b.levels.splice(i, 1)) }, '✕'),
  );

  const heightSeg = seg(
    HEIGHTS.map((x) => ({ value: x, label: `${x}F`, disabled: !hs.includes(x), title: hs.includes(x) ? null : 'Not available for this size/type' })),
    lv.height,
    (v) => mut((l) => void (l.height = v)),
    'small',
  );

  const layoutSel =
    layouts.length > 1
      ? select(
          layouts.map((l) => ({ value: l.key, label: l.label })),
          layout.key,
          (v) =>
            mut((l) => {
              const nl = layouts.find((x) => x.key === v);
              l.layout = v;
              l.cols = nl.cols.map((_, ci) => (nl.drawerOnly ? { ...newColumn('drawer') } : l.cols[ci] || { ...l.cols[0] }));
            }),
          'layout',
        )
      : null;

  const cols = layout.cols.map((size, ci) => {
    const c = lv.cols[ci];
    const interiors = (c.type === 'drawer' ? DRAWER_INTERIORS : SUSTAINER_INTERIORS).filter(
      (o) => !(o.key === 'sealed' && !['L', 'XL'].includes(size)),
    );
    const sideSizes = c.type === 'drawer' && SIDE_SIZES[size];
    if (sideSizes) {
      // L²/XL²: one box position per side, each with its own drawers and interior.
      return h(
        'div.col',
        h(
          'div.sides',
          sideSizes.map((bs, k) => {
            const sd = (c.sides || [])[k] || { interior: 'empty', boxes: [lv.height] };
            const mutSide = (fn) => mut((l) => fn(l.cols[ci].sides[k]));
            return h(
              'div.side',
              h('span.tag', `${k === 0 ? 'Left' : 'Right'} · ${bs} drawer${(sd.boxes || []).length > 1 ? 's' : ''}`),
              select(
                DRAWER_INTERIORS.map((o) => ({ value: o.key, label: o.label })),
                sd.interior,
                (v) => mutSide((x) => void (x.interior = v)),
              ),
              boxPicker({ ...sd, type: 'drawer' }, bs, lv.height, build.depth, parts, (v) => mutSide((x) => void (x.boxes = v))),
              dividerControls({ ...sd, type: 'drawer' }, bs, mutSide),
              binControls({
                cfg: sd,
                kind: 'drawer',
                size: bs,
                F: lv.height,
                depth: build.depth,
                where: `Level ${i + 1} · ${k === 0 ? 'left' : 'right'} ${bs} drawer`,
                parts,
                setBins: (bi, list) => mutSide((x) => setBinList(x, bi, list)),
              }),
            );
          }),
        ),
      );
    }
    return h(
      'div.col',
      layout.cols.length > 1 ? h('span.tag', SIZE_LABEL[size]) : null,
      seg(
        [
          { value: 'drawer', label: 'Drawer' },
          { value: 'sustainer', label: 'Sustainer', disabled: !!layout.drawerOnly },
        ],
        c.type,
        (v) => mut((l) => (l.cols[ci] = newColumn(v))),
        'small',
      ),
      select(
        interiors.map((o) => ({ value: o.key, label: o.label })),
        c.interior,
        (v) => mut((l) => void (l.cols[ci].interior = v)),
      ),
      boxPicker(c, size, lv.height, build.depth, parts, (v) => mut((l) => void (l.cols[ci].boxes = v))),
      dividerControls(c, size, (fn) => mut((l) => fn(l.cols[ci]))),
      binControls({
        cfg: c,
        kind: c.type,
        size,
        F: lv.height,
        depth: build.depth,
        where: `Level ${i + 1}${layout.cols.length > 1 ? ` · ${SIZE_LABEL[size]}` : ''} ${c.type}`,
        parts,
        setBins: (bi, list) => mut((l) => setBinList(l.cols[ci], bi, list)),
      }),
    );
  });

  return h(
    'div.level',
    h('div.level-head', h('span.num', String(i + 1)), heightSeg, tools),
    layoutSel,
    h(`div.cols${cols.length > 1 ? '.two' : ''}`, cols),
  );
}

function swap(a, i, j) {
  [a[i], a[j]] = [a[j], a[i]];
}

function exportJson(build) {
  const blob = new Blob([JSON.stringify(build, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${build.name || 'vault-build'}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importJson(update) {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      update((b) => {
        for (const k of Object.keys(b)) delete b[k];
        Object.assign(b, data);
      });
    } catch (e) {
      alert(`Could not read that file: ${e.message}`);
    }
  };
  input.click();
}

// ---------------------------------------------------------------- colors

/** Shared <datalist> so native color pickers suggest the filament palette. */
export function filamentDatalist() {
  let dl = document.getElementById('filaments');
  if (!dl) {
    dl = h('datalist#filaments', FILAMENTS.map((f) => h('option', { value: f.hex }, f.name)));
    document.body.append(dl);
  }
  return dl;
}

/** A color swatch backed by a native color picker. */
export function swatchInput(hex, onChange, title) {
  filamentDatalist();
  return h(
    'label.swatch',
    { title: title || filamentName(hex), style: { background: hex } },
    h('input', { type: 'color', value: hex, list: 'filaments', onchange: (e) => onChange(e.target.value) }),
  );
}

/** Row of palette buttons. */
export function paletteRow(current, onPick) {
  return h(
    'div.palette',
    FILAMENTS.map((f) =>
      h('button.chip', {
        type: 'button',
        title: f.name,
        style: { background: f.hex },
        'aria-pressed': String(current && current.toLowerCase() === f.hex.toLowerCase()),
        onclick: () => onPick(f.hex),
      }),
    ),
  );
}

function renderColors(build, update) {
  const c = build.colors;
  const overrides = Object.keys(c.parts).length + Object.keys(c.files).length;
  const rows = COLOR_GROUPS.map((g) => {
    const hex = groupColor(build, g.key);
    const custom = !!c.groups[g.key];
    return h(
      'div.color-row',
      swatchInput(hex, (v) => update((b) => void (b.colors.groups[g.key] = v))),
      h('span.color-label', g.label, h('small', filamentName(hex))),
      custom
        ? h('button.icon-x', { title: 'Back to preset color', onclick: () => update((b) => void delete b.colors.groups[g.key]) }, '↺')
        : null,
    );
  });
  return section(
    'Colors',
    h(
      'div.field',
      h('span', 'Preset'),
      select(
        PRESETS.map((p) => ({ value: p.key, label: p.label })),
        c.preset,
        (v) =>
          update((b) => {
            b.colors.preset = v;
            b.colors.groups = {};
          }),
      ),
    ),
    h('div.color-rows', rows),
    h('p.muted.hint', 'Right-click a part in the 3D view and choose Colour & details… to color just that part, or every copy of its file.'),
    overrides
      ? h(
          'button.btn.sm',
          {
            onclick: () =>
              update((b) => {
                b.colors.parts = {};
                b.colors.files = {};
              }),
          },
          `Clear ${overrides} part color override${overrides > 1 ? 's' : ''}`,
        )
      : null,
  );
}

// ---------------------------------------------------------------- dividers

function numberInput(value, min, max, onChange, title) {
  return h('input.num-input', {
    type: 'number',
    min,
    max,
    value: String(value),
    title,
    onchange: (e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0)))),
  });
}

/** Divider counts for drawer grid dividers and sustainer dividers. */
function dividerControls(c, size, mutCol) {
  const big = size === 'L' || size === 'XL';
  if (c.type === 'drawer' && c.interior === 'griddividers') {
    return h(
      'div.div-ctl',
      h('label', 'Across', numberInput(c.across ?? 1, 0, 6, (v) => mutCol((col) => void (col.across = v)))),
      h('label', 'Front-back', numberInput(c.along ?? 1, 0, 6, (v) => mutCol((col) => void (col.along = v)))),
      h('label.check', h('input', { type: 'checkbox', checked: !!c.divTall, onchange: (e) => mutCol((col) => void (col.divTall = e.target.checked)) }), 'Full height'),
    );
  }
  if (c.type === 'sustainer' && c.interior === 'dividers') {
    return h(
      'div.div-ctl',
      h('label', 'Across', numberInput(c.across ?? (big ? 1 : 2), 0, 8, (v) => mutCol((col) => void (col.across = v)))),
      big ? h('label', 'Front-back', numberInput(c.along ?? (size === 'XL' ? 4 : 3), 0, 10, (v) => mutCol((col) => void (col.along = v)))) : null,
    );
  }
  if (c.type === 'sustainer' && c.interior === 'sealed') {
    return h('div.div-ctl', h('label', 'Sealed rows', numberInput(c.across || 1, 1, 6, (v) => mutCol((col) => void (col.across = v)))));
  }
  return null;
}

// ---------------------------------------------------------------- pegboard accessories

/** Picker for pegboard hooks, containers and holders (data/04. PEGBOARD). */
function renderAccessories(build, parts, update) {
  const all = parts.all.filter((p) => p.category === 'pegboard' || p.folders.includes('Grid Dividers'));
  const kinds = [
    { key: 'hook', label: 'Hooks', test: (p) => /HOOKS(\/|$)/.test(p.folders.join('/')) && !/containers/i.test(p.folders.join('/')) },
    { key: 'container', label: 'Containers', test: (p) => /CONTAINERS\/Depth/.test(p.folders.join('/')) },
    { key: 'chook', label: 'Container hooks', test: (p) => /HOOKs for containers/.test(p.folders.join('/')) },
    { key: 'holder', label: 'Holders', test: (p) => /holders/i.test(p.name) },
    { key: 'grid', label: 'Grid divider pieces (custom layouts)', test: (p) => p.folders.includes('Grid Dividers') },
  ];
  const state = (renderAccessories.state ||= { kind: 'hook', id: null });
  const kind = kinds.find((k) => k.key === state.kind) || kinds[0];
  const options = all.filter(kind.test).map((p) => ({ value: p.id, label: accessoryLabel(p) })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  if (!options.some((o) => o.value === state.id)) state.id = options[0]?.value || null;
  const list = (build.accessories || []).map((a, i) => {
    const p = parts.byId.get(a.id);
    return h(
      'div.acc-row',
      numberInput(a.qty, 1, 99, (v) => update((b) => void (b.accessories[i].qty = v)), 'Quantity'),
      h('span', p ? accessoryLabel(p) : a.id),
      h('button.icon-x', { title: 'Remove', onclick: () => update((b) => void b.accessories.splice(i, 1)) }, '✕'),
    );
  });
  return section(
    'Accessories & extras',
    h(
      'div.acc-pick',
      select(kinds.map((k) => ({ value: k.key, label: k.label })), kind.key, (v) => {
        state.kind = v;
        state.id = null;
        update(() => {});
      }),
      select(options, state.id, (v) => void (state.id = v)),
      h(
        'button.btn.sm',
        {
          onclick: () =>
            state.id &&
            update((b) => {
              const ex = b.accessories.find((a) => a.id === state.id);
              if (ex) ex.qty += 1;
              else b.accessories.push({ id: state.id, qty: 1 });
            }),
        },
        'Add',
      ),
    ),
    list.length ? h('div.acc-list', list) : h('p.muted.hint', 'Pegboard hooks, containers and holders, or extra grid divider pieces. They show on a shelf beside the build.'),
  );
}

// ---------------------------------------------------------------- boxes inside a drawer module

/** Box sizes per side for modules that hold two boxes side by side. */
const SIDE_SIZES = { L2: ['S', 'S'], XL2: ['S', 'M'] };

function sameList(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Valid ways to fill a drawer module of height F with boxes that exist for this size/depth. */
export function drawerSplits(size, depth, F, parts) {
  const boxSizes = size === 'L2' ? ['S'] : size === 'XL2' ? ['S', 'M'] : [size];
  const has = (h) => boxSizes.every((bs) => parts.find({ category: 'drawers', group: 'Boxes', size: bs, depth, height: h }));
  return boxSplits(F, [1, 2, 4].filter(has));
}

function splitLabel(sp) {
  if (sp.every((x) => x === sp[0])) return sp.length === 1 ? `One ${sp[0]}F drawer` : `${sp.length} × ${sp[0]}F drawers`;
  return `${sp.map((x) => `${x}F`).join(' + ')} (bottom → top)`;
}

/** "Drawers inside" picker for tall drawer modules (e.g. 4F = 2F + 1F + 1F). */
function setBinList(target, bi, list) {
  target.bins = Array.isArray(target.bins) ? target.bins : [];
  while (target.bins.length <= bi) target.bins.push([]);
  target.bins[bi] = list;
}

/**
 * "Bins" buttons for a column (or L²/XL² side) with a Gridfinity baseplate:
 * one per drawer box in the stack, or one for a sustainer. Each opens the
 * planner for that space.
 */
function binControls({ cfg, kind, size, F, depth, where, parts, setBins }) {
  const gridfinity = kind === 'drawer' ? cfg.interior?.startsWith('gridfinity') : cfg.interior === 'gridfinity';
  const cols = GRID_CELLS[kind]?.[size];
  if (!gridfinity || !cols) return null;
  const library = parts.all.filter((p) => p.category === 'bins');
  const spaces = kind === 'drawer' ? boxStack(cfg.boxes, F).map((b, bi) => ({ bi, h: b.h })) : [{ bi: 0, h: F }];
  const multi = spaces.length > 1;
  return h(
    'div.bin-controls',
    spaces.map(({ bi, h: bh }) => {
      const list = cfg.bins?.[bi] || [];
      const maxH = BIN_MAX_H[kind][bh];
      const title = `${where}${multi ? ` ${bi + 1} (${bh}F)` : ''}`;
      return h(
        'button.btn.sm.bin-btn',
        {
          type: 'button',
          title: `Plan Gridfinity bins: ${cols} × ${depth} cells, up to ${maxH} mm tall`,
          onclick: () =>
            openPlanner({
              title,
              cols,
              rows: depth,
              maxH,
              list,
              library,
              onChange: (next) => setBins(bi, next),
              onEditLibrary: configHooks.openBinsTab,
            }),
        },
        `▦ Bins${multi ? ` · drawer ${bi + 1}` : ''}: ${list.length ? `${list.length} placed` : 'plan…'}`,
      );
    }),
  );
}

function boxPicker(c, size, F, depth, parts, onChange) {
  if (c.type !== 'drawer' || F < 2) return null;
  const splits = drawerSplits(size, depth, F, parts);
  if (splits.length < 2) return null;
  const cur = splits.findIndex((sp) => sameList(sp, c.boxes));
  return h(
    'label.box-pick',
    h('span', 'Drawers inside'),
    select(
      splits.map((sp, i) => ({ value: String(i), label: splitLabel(sp) })),
      String(Math.max(0, cur)),
      (v) => onChange(splits[Number(v)]),
    ),
  );
}
