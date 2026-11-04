// App entry: wires tabs, build state, viewer, and panels together.
import { loadCatalog } from './api.js';
import { markBomRow, renderBom } from './bom.js';
import { placementColor, filamentName, groupOfRole, COLOR_GROUPS } from './colors.js';
import { loadInitialBuild, paletteRow, renderConfig, sanitize, saveBuild, shareUrl, swatchInput } from './configurator.js';
import { renderDocs } from './docs.js';
import { h } from './dom.js';
import { initLibrary } from './library.js';
import { Parts, resolve } from './rules.js';
import { Viewer } from './viewer.js';

const $ = (s) => document.querySelector(s);

// ---- theme
const themeBtn = $('#theme-toggle');
try {
  const t = localStorage.getItem('vault-configurator:theme');
  if (t) document.documentElement.dataset.theme = t;
} catch {
  /* ignore */
}
themeBtn.onclick = () => {
  const dark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('vault-configurator:theme', next);
  } catch {
    /* ignore */
  }
};

// ---- tabs
const tabInit = {};
for (const btn of document.querySelectorAll('.tabs button')) {
  btn.onclick = () => showTab(btn.dataset.tab);
}
function showTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('.tab-page')) p.classList.toggle('active', p.id === `tab-${name}`);
  tabInit[name]?.();
  tabInit[name] = null;
}

// ---- boot
let catalog;
try {
  catalog = await loadCatalog();
} catch (e) {
  $('#config').replaceChildren(h('p', `Could not load the parts catalog: ${e.message}`));
  throw e;
}
const parts = new Parts(catalog);

let build = sanitize(loadInitialBuild(), parts);
saveBuild(build);
if (location.hash.startsWith('#b=')) history.replaceState(null, '', location.pathname);

const statusEl = $('#status');
const pickEl = $('#pick');
const viewer = new Viewer($('#viewer'), {
  onPick: (pl) => showPick(pl),
  colorOf: (pl) => placementColor(build, pl),
  onStatus: ({ total, done }) => {
    statusEl.hidden = done >= total;
    statusEl.textContent = `Loading parts ${done} / ${total}… (first view of large files can take a few seconds)`;
  },
  onLayout: (L) => {
    $('#dims').replaceChildren(
      h('div', 'W ', h('b', `${Math.round(L.width)}`), ' × D ', h('b', `${Math.round(L.depth)}`), ' × H ', h('b', `${Math.round(L.height)}`), ' mm'),
    );
    const H = Math.round(L.height);
    if (H !== lastHeight) {
      lastHeight = H;
      refreshBom();
    }
  },
});
let lastHeight = null;

let res = null;
function update(mutator) {
  const draft = structuredClone(build);
  mutator(draft);
  build = sanitize(draft, parts);
  saveBuild(build);
  render();
}

function render() {
  res = resolve(build, parts);
  renderConfig($('#config'), build, parts, update);
  viewer.setBuild(build, res);
  refreshBom();
  // Keep the part card open across edits (placements are matched by stable id).
  if (picked) {
    const pl = res.placements.find((x) => x.cid === picked);
    if (pl) {
      viewer.select(pl.key);
      showPick(pl);
    } else showPick(null);
  }
}

function refreshBom() {
  renderBom($('#bom'), build, res, viewer.lastLayout, {
    onHover: (id) => {
      if (id) return viewer.selectPart(id);
      const pl = picked && res.placements.find((x) => x.cid === picked);
      viewer.select(pl ? pl.key : null);
    },
    onShare: async () => {
      const url = shareUrl(build);
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied to clipboard');
      } catch {
        prompt('Copy this link:', url);
      }
    },
  });
}

let picked = null; // cid of the part shown in the card
let pickScope = 'part'; // 'part' = this copy only, 'file' = every copy of the file

const ROLE_LABEL = { backbone: 'Backbone board' };

function showPick(pl) {
  if (!pl || pl.fixedColor || (!pl.partId && !pl.files?.length)) {
    picked = null;
    pickEl.hidden = true;
    markBomRow($('#bom'), null);
    return;
  }
  picked = pl.cid;
  const p = pl.partId ? catalog.byId.get(pl.partId) : null;
  const entry = p && res.bom.find((e) => e.part.id === p.id);
  const hex = placementColor(build, pl);
  const group = COLOR_GROUPS.find((g) => g.key === groupOfRole(pl.role));
  const fileId = pl.partId;
  const c = build.colors;
  const source = c.parts[pl.colorFrom || pl.cid] ? 'this part' : fileId && c.files[fileId] ? 'all copies of this file' : `group: ${group?.label || 'other'}`;

  const cid = pl.colorFrom || pl.cid; // e.g. both racks of one rail file share a color
  const setColor = (v) =>
    update((b) => {
      if (pickScope === 'file' && fileId) {
        b.colors.files[fileId] = v;
        delete b.colors.parts[cid];
      } else b.colors.parts[cid] = v;
    });
  const reset = () =>
    update((b) => {
      delete b.colors.parts[cid];
      if (fileId) delete b.colors.files[fileId];
    });

  pickEl.hidden = false;
  pickEl.replaceChildren(
    h('h4', p ? p.name : ROLE_LABEL[pl.role] || pl.role),
    p ? h('div.path', p.path) : null,
    entry ? h('div', `Print ×${entry.qty} for this build`) : null,
    h(
      'div.pick-color',
      h('div.pick-color-head', swatchInput(hex, setColor), h('span', h('b', filamentName(hex)), h('small', `from ${source}`))),
      paletteRow(hex, setColor),
      fileId
        ? h(
            'div.seg.small',
            ['part', 'file'].map((k) =>
              h(
                'button',
                {
                  type: 'button',
                  'aria-pressed': String(pickScope === k),
                  onclick: () => {
                    pickScope = k;
                    showPick(pl);
                  },
                },
                k === 'part' ? 'Just this part' : `All copies (×${entry?.qty || 1})`,
              ),
            ),
          )
        : null,
      c.parts[pl.colorFrom || pl.cid] || (fileId && c.files[fileId]) ? h('button.btn.sm.ghost', { onclick: reset }, '↺ Use group color') : null,
    ),
    orientedBy(pl) ? h('div.muted', { style: { fontSize: '12px' } }, `Oriented: ${orientedBy(pl)}`) : null,
    h(
      'div.btn-row',
      { style: { marginTop: '8px' } },
      p ? h('a.btn.sm', { href: `/api/file/${p.id}?download` }, 'Download STL') : null,
      h(
        'button.btn.sm.ghost',
        {
          onclick: () => {
            viewer.select(null);
            showPick(null);
          },
        },
        'Close',
      ),
    ),
  );
  markBomRow($('#bom'), p?.id || null);
}

/** How the viewer oriented a placed part ("interface:flip-z (0.90)" or "static"). */
function orientedBy(pl) {
  return viewer.objects.get(pl.key)?.mesh.geometry.userData.orientedBy || '';
}

function toast(msg) {
  const t = h('div.viewer-status', { style: { top: 'auto', bottom: '70px' } }, msg);
  $('#tab-build .stage').append(t);
  setTimeout(() => t.remove(), 1800);
}

// ---- viewer toolbar
$('#opt-open').onchange = (e) => viewer.setOptions({ open: e.target.checked ? 1 : 0 });
$('#opt-explode').oninput = (e) => viewer.setOptions({ explode: Number(e.target.value) });
$('#btn-fit').onclick = () => viewer.fit();
$('#btn-snap').onclick = () => {
  const a = h('a', { href: viewer.snapshot(), download: `${build.name || 'vault'}.png` });
  a.click();
};

render();

// Handy from the dev tools console: vault.viewer, vault.build, vault.res
window.vault = {
  viewer,
  catalog,
  update,
  get build() {
    return build;
  },
  get res() {
    return res;
  },
};

// ---- other tabs (lazy)
tabInit.library = () => {
  const libViewer = new Viewer($('#lib-viewer'));
  initLibrary($('#lib-list'), libViewer, catalog, { infoEl: $('#lib-info'), statusEl: $('#lib-status'), emptyEl: $('#lib-empty') });
  for (const b of document.querySelectorAll('[data-rot]')) b.onclick = () => libViewer.rotateSingle(b.dataset.rot);
  $('#lib-fit').onclick = () => libViewer.fit();
};
tabInit.docs = () => renderDocs($('#docs'), catalog);
