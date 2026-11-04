// Right-hand panel: summary, warnings, files to print, hardware.
import { fileUrl, formatBytes, zipUrl } from './api.js';
import { bomColors, filamentName, filamentSummary } from './colors.js';
import { h, section } from './dom.js';

export function renderBom(root, build, res, layoutInfo, { onHover, onShare }) {
  const files = res.bom.length;
  const prints = res.bom.reduce((s, e) => s + e.qty, 0);
  const bytes = res.bom.reduce((s, e) => s + e.part.bytes, 0);
  const H = layoutInfo ? Math.round(layoutInfo.height) : null;

  const summary = h(
    'div.summary',
    stat(files, 'files'),
    stat(prints, 'prints'),
    stat(H ? `${H}` : '—', 'mm tall'),
  );

  const warnings = res.warnings.length ? h('ul.warnings', res.warnings.map((w) => h('li', w))) : null;

  // Colors: each file split into how many prints in which filament.
  const split = bomColors(build, res);
  const zipItems = res.bom.flatMap((e) => (split.get(e.part.id) || [{ hex: null, qty: e.qty }]).map((c) => ({ id: e.part.id, qty: c.qty, color: c.hex ? filamentName(c.hex) : '' })));
  const filament = filamentSummary(build, res, split);

  const download = h(
    'div.btn-row',
    { style: { marginBottom: '16px' } },
    h(
      'a.btn.primary',
      {
        href: files ? zipUrl(build.name || 'vault-build', zipItems) : null,
        'aria-disabled': files ? null : 'true',
        title: 'Original STL files in one folder per filament color, quantities noted in file names',
        style: { flex: '1' },
      },
      `Download STLs (.zip, ${formatBytes(bytes)})`,
    ),
    h('button.btn', { onclick: onShare, title: 'Copy a link to this build' }, 'Share'),
  );

  const groups = new Map();
  for (const e of res.bom) {
    if (!groups.has(e.section)) groups.set(e.section, []);
    groups.get(e.section).push(e);
  }
  const groupEls = [...groups.entries()].map(([name, rows]) =>
    h(
      'div.bom-group',
      h('h4', name),
      rows.map((e) =>
        h(
          'div.bom-row',
          {
            dataset: { id: e.part.id },
            title: e.part.path,
            onmouseenter: () => onHover?.(e.part.id),
            onmouseleave: () => onHover?.(null),
          },
          h('span.qty', `×${e.qty}`),
          h(
            'span.name',
            h(
              'span.dots',
              (split.get(e.part.id) || []).map((c) =>
                h('i.dot', { style: { background: c.hex }, title: `${c.qty} × ${filamentName(c.hex)}` }),
              ),
            ),
            e.part.name,
            e.note || (split.get(e.part.id) || []).length > 1
              ? h('span.note', [e.note, colorNote(split.get(e.part.id))].filter(Boolean).join(' · '))
              : null,
          ),
          h('a', { href: fileUrl(e.part.id, true), title: `Download (${formatBytes(e.part.bytes)})` }, '↓ STL'),
        ),
      ),
    ),
  );

  const hw = res.hardwareList.length
    ? section(
        'Hardware',
        h(
          'table.hw',
          h(
            'tbody',
            res.hardwareList.map((x) => h('tr', h('td', `×${x.qty}`), h('td', x.name))),
          ),
        ),
      )
    : null;

  root.replaceChildren(
    ...[
      summary,
      warnings,
      download,
      section(
      'Filament',
      h(
        'div.filaments',
        filament.map((f) =>
          h('div.filament', h('i.dot', { style: { background: f.hex } }), h('span', f.name), h('b', `${f.prints} prints`)),
        ),
      ),
    ),
    section('Printed parts'),
      ...groupEls,
      hw,
      h('p.muted', { style: { fontSize: '12px' } }, 'Quantities for small universal parts are best-effort from the manuals; check the Documentation tab before printing.'),
    ].filter(Boolean),
  );
}

function stat(v, label) {
  return h('div.stat', h('b', String(v)), h('span', label));
}

/** Marks the BOM row of a part (when picked in 3D) and scrolls to it. */
export function markBomRow(root, partId) {
  for (const el of root.querySelectorAll('.bom-row')) {
    const on = el.dataset.id === partId;
    el.classList.toggle('active', on);
    if (on) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/** "2 × Orange, 1 × Light Grey" when a file is printed in several colors. */
function colorNote(list) {
  if (!list || list.length < 2) return '';
  return list.map((c) => `${c.qty} × ${filamentName(c.hex)}`).join(', ');
}
