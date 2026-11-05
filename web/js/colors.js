// Part colors: groups, filament palette, presets, and how a part's color is
// resolved. A part's color comes from (most specific first):
//   1. an override for that one placed part        build.colors.parts[cid]
//   2. an override for every copy of that STL file  build.colors.files[partId]
//   3. its color group                              build.colors.groups[group]
//   4. the preset's color for that group

/** Common PLA colors. The light grey is the one used in the VAULT renders (Bambu 10104). */
export const FILAMENTS = [
  { name: 'Light Grey', hex: '#d4d6d8' },
  { name: 'White', hex: '#f3f3f1' },
  { name: 'Silver', hex: '#a7abb0' },
  { name: 'Dark Grey', hex: '#4a4e54' },
  { name: 'Black', hex: '#1f2124' },
  { name: 'Orange', hex: '#f07c2c' },
  { name: 'Red', hex: '#c8312c' },
  { name: 'Yellow', hex: '#f2c230' },
  { name: 'Green', hex: '#3f8f4f' },
  { name: 'Mint', hex: '#8fd1b5' },
  { name: 'Blue', hex: '#2f6db5' },
  { name: 'Cyan', hex: '#46b3c9' },
  { name: 'Purple', hex: '#6b4fa0' },
  { name: 'Pink', hex: '#e58fb3' },
  { name: 'Beige', hex: '#d9c7a3' },
  { name: 'Brown', hex: '#7a5236' },
];

/**
 * Color groups. `roles` are the 3D placement roles in the group; parts in the
 * parts list that aren't drawn are assigned by `bomGroup()` below.
 */
export const COLOR_GROUPS = [
  { key: 'body', label: 'Modules & roofs', roles: ['module', 'smodule', 'roof', 'lid'] },
  { key: 'facade', label: 'Facades', roles: ['facade', 'sfacade'] },
  { key: 'box', label: 'Drawer boxes', roles: ['box'] },
  { key: 'knob', label: 'Knobs & handles', roles: ['key', 'tophandle', 'knob'] },
  { key: 'caps', label: 'Key & screw caps', roles: ['keycap', 'fcap'] },
  { key: 'label', label: 'Labels', roles: ['label'] },
  { key: 'latch', label: 'Latch levers', roles: ['lockouter', 'lockinner'] },
  { key: 'holder', label: 'Latch holders', roles: ['lockholder'] },
  { key: 'hinge', label: 'Hinges', roles: ['hinge', 'hingetop'] },
  { key: 'base', label: 'Base', roles: ['base'] },
  { key: 'feet', label: 'Feet & wheel hubs', roles: ['foot', 'wheelcover'] },
  { key: 'tyre', label: 'Tyres (TPU)', roles: ['wheel'] },
  { key: 'back', label: 'Backbone, pegboard, mounts & handles', roles: ['backbone', 'pegboard', 'pullhandle', 'stathandle', 'handlelock', 'wallmount'] },
  { key: 'accessories', label: 'Pegboard accessories', roles: ['accessory'] },
  { key: 'mechanism', label: 'Drawer lock (springs, racks, latch, stoppers)', roles: ['spring', 'grail', 'dlatch', 'stopper'] },
  { key: 'runner', label: 'Runner guides & slides', roles: ['guide', 'slide'] },
  { key: 'inserts', label: 'Baseplates & dividers', roles: ['gridplate', 'sbaseplate', 'divider', 'l2acc'] },
  { key: 'bins', label: 'Gridfinity bins', roles: ['bin'] },
  { key: 'internal', label: 'Other internal parts', roles: [] },
];

const GROUP_OF_ROLE = Object.fromEntries(COLOR_GROUPS.flatMap((g) => g.roles.map((r) => [r, g.key])));

const F = Object.fromEntries(FILAMENTS.map((f) => [f.name, f.hex]));
const CLASSIC = {
  body: F['Light Grey'],
  facade: F['Light Grey'],
  box: F['Dark Grey'],
  knob: F['Dark Grey'],
  caps: F['Light Grey'],
  label: F.White,
  latch: F['Dark Grey'],
  holder: F.Silver,
  hinge: F['Dark Grey'],
  base: F['Light Grey'],
  feet: F['Dark Grey'],
  tyre: F.Black,
  back: F['Dark Grey'],
  inserts: F['Dark Grey'],
  mechanism: F.Orange,
  accessories: F['Light Grey'],
  runner: F['Light Grey'],
  bins: F['Light Grey'],
  internal: F.Orange,
};

export const PRESETS = [
  { key: 'classic', label: 'Classic', groups: CLASSIC },
  {
    key: 'orange',
    label: 'Orange accents',
    groups: { ...CLASSIC, knob: F.Orange, latch: F.Orange, caps: F.Orange, label: F.Orange, hinge: F.Orange },
  },
  {
    key: 'stealth',
    label: 'Stealth',
    groups: { ...CLASSIC, body: F['Dark Grey'], facade: F.Black, box: F.Black, base: F['Dark Grey'], caps: F.Black, knob: F.Silver, latch: F.Silver, label: F['Dark Grey'], holder: F.Black, back: F.Black, feet: F.Black },
  },
  {
    key: 'arctic',
    label: 'Arctic',
    groups: { ...CLASSIC, body: F.White, facade: F.White, base: F.White, box: F.Cyan, knob: F.Cyan, latch: F.Cyan, caps: F.White, holder: F.White, hinge: F.Cyan, feet: F.Silver, back: F.Silver, inserts: F.Cyan, internal: F.Cyan, bins: F.White },
  },
  {
    key: 'toybox',
    label: 'Toy box',
    groups: { ...CLASSIC, body: F.White, facade: F.Yellow, box: F.Blue, knob: F.Red, latch: F.Red, caps: F.Red, label: F.White, hinge: F.Blue, holder: F.White, feet: F.Blue, back: F.Blue, inserts: F.Blue, internal: F.Green, bins: F.Yellow },
  },
];

export const groupOfRole = (role) => GROUP_OF_ROLE[role] || 'internal';

/** Color group for a parts-list entry that isn't drawn in 3D. */
export function bomGroup(entry) {
  if (entry.group) return entry.group;
  const n = entry.part.name;
  if (/Baseplate|Divider/i.test(n)) return 'inserts';
  if (/Tyre/i.test(n)) return 'tyre';
  if (/^(Disk|Cover|Bushing|Jig)$/i.test(n)) return 'feet';
  if (/Base( |$)|Base Connector/i.test(n)) return 'base';
  if (/Roof|Connector For Split Roof/i.test(n) && entry.section === 'Sustainers') return 'body';
  if (/Heawyweight Roof (Handle|Insert)/i.test(n)) return 'knob';
  if (['Backbone & handles', 'Pegboard', 'Mounting'].includes(entry.section)) return 'back';
  if (entry.section === 'Pegboard accessories') return 'accessories';
  if (entry.section === 'Gridfinity bins') return 'bins';
  return 'internal';
}

export function ensureColors(build) {
  const c = build.colors && typeof build.colors === 'object' ? build.colors : {};
  return {
    preset: PRESETS.some((p) => p.key === c.preset) ? c.preset : 'classic',
    groups: { ...(c.groups || {}) },
    files: { ...(c.files || {}) },
    parts: { ...(c.parts || {}) },
  };
}

export function groupColor(build, group) {
  const c = build.colors || {};
  const preset = PRESETS.find((p) => p.key === c.preset) || PRESETS[0];
  return c.groups?.[group] || preset.groups[group] || CLASSIC[group] || F['Light Grey'];
}

/** Resolved color (hex) of a placed part. */
export function placementColor(build, pl) {
  if (pl.fixedColor) return null;
  const c = build.colors || {};
  const cid = pl.colorFrom || pl.cid; // parts printed together share a color
  if (c.parts?.[cid]) return c.parts[cid];
  if (pl.partId && c.files?.[pl.partId]) return c.files[pl.partId];
  return groupColor(build, groupOfRole(pl.role));
}

export function filamentName(hex) {
  const f = FILAMENTS.find((x) => x.hex.toLowerCase() === String(hex).toLowerCase());
  return f ? f.name : `Custom ${String(hex).replace('#', '').toUpperCase()}`;
}

/**
 * Splits each parts-list entry by color. Copies that are drawn take their
 * placement's color; the rest take the file override or the entry's group.
 * Returns Map partId -> [{ hex, qty }].
 */
export function bomColors(build, res) {
  const placed = new Map(); // partId -> Map(hex -> count)
  for (const pl of res.placements) {
    const hex = placementColor(build, pl);
    if (!hex) continue;
    for (const id of pl.files || (pl.partId ? [pl.partId] : [])) {
      if (!placed.has(id)) placed.set(id, new Map());
      const m = placed.get(id);
      m.set(hex, (m.get(hex) || 0) + (pl.weight ?? 1)); // weight 0.5: half of a two-part file
    }
  }
  const out = new Map();
  for (const e of res.bom) {
    const m = new Map(placed.get(e.part.id) || []);
    let n = [...m.values()].reduce((s, x) => s + x, 0);
    if (n > e.qty) {
      // More drawn copies than prints (shouldn't happen) — scale down.
      for (const [k, v] of m) m.set(k, Math.max(1, Math.round((v * e.qty) / n)));
      n = e.qty;
    }
    const rest = e.qty - n;
    if (rest > 0) {
      const hex = build.colors?.files?.[e.part.id] || groupColor(build, bomGroup(e));
      m.set(hex, (m.get(hex) || 0) + rest);
    }
    out.set(e.part.id, [...m.entries()].map(([hex, qty]) => ({ hex, qty })).sort((a, b) => b.qty - a.qty));
  }
  return out;
}

/** Prints per filament color across the build. */
export function filamentSummary(build, res, split = bomColors(build, res)) {
  const totals = new Map();
  for (const e of res.bom) {
    for (const { hex, qty } of split.get(e.part.id) || []) {
      const t = totals.get(hex) || { hex, name: filamentName(hex), prints: 0, files: 0 };
      t.prints += qty;
      t.files += 1;
      totals.set(hex, t);
    }
  }
  return [...totals.values()].sort((a, b) => b.prints - a.prints);
}
