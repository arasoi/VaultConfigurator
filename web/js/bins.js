// Bins tab: generate Gridfinity bins and keep a library of them on the server.
import { deleteBin, fileUrl, formatBytes, saveBin } from './api.js';
import { check, h, section, select } from './dom.js';
import { binHeight, binKey, binLabel, DEFAULT_BIN, generateBin, LIMITS, meshToPositions, meshToSTL, normalizeBin, outerSize, SPEC } from './gridfinity.js';
import { BIN_MAX_H, binOf } from './rules.js';
import * as THREE from 'three';

const STORAGE_KEY = 'vault-configurator:bin-draft';
const QUICK_SIZES = [
  [1, 1],
  [1, 2],
  [2, 2],
  [1, 3],
  [2, 3],
  [3, 3],
];
/** Common bins for the starter set: fit every 1F drawer (4u with lip = 32.4 mm). */
const STARTER = QUICK_SIZES.slice(0, 5).map(([w, d]) => ({ ...DEFAULT_BIN, w, d, h: 4, lip: true }));

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Where a bin of this height fits, e.g. [{ label: '1F drawer', ok: true }, …]. */
function fitList(height) {
  const out = [];
  for (const [kind, label] of [
    ['drawer', 'drawer'],
    ['sustainer', 'sustainer'],
  ]) {
    for (const [F, max] of Object.entries(BIN_MAX_H[kind])) out.push({ label: `${F}F ${label}`, ok: height <= max + 0.01, max });
  }
  return out;
}

function fitBadges(height) {
  return h(
    'div.fit-badges',
    fitList(height).map((f) => h('span.badge', { class: `badge${f.ok ? ' ok' : ''}`, title: `${f.label}: room for ${f.max} mm` }, f.label)),
  );
}

/**
 * Sets up the Bins tab.
 *   viewer: a Viewer for the preview
 *   getCatalog(): current catalog
 *   onCatalog(catalog): the library changed (saved / deleted)
 */
export function initBins({ configEl, libraryEl, viewer, statsEl, dimsEl, statusEl, getCatalog, onCatalog }) {
  let params = normalizeBin(loadDraft()?.params || DEFAULT_BIN);
  let name = loadDraft()?.name || '';
  let result = null; // last generated bin
  let token = 0;
  let timer = 0;
  let lastFootprint = '';
  const savingOn = () => getCatalog().data?.bins !== false;

  function loadDraft() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  }
  function saveDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ params, name }));
    } catch {
      /* ignore */
    }
  }

  function set(patch) {
    params = normalizeBin({ ...params, ...patch });
    saveDraft();
    renderForm();
    regenerate();
  }

  function status(msg, warn = false) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('warn', warn);
  }

  function regenerate() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++token;
      status('Generating…');
      try {
        const r = await generateBin(params);
        if (my !== token) return r.manifold.delete();
        result?.manifold.delete();
        result = r;
        const { positions, index } = meshToPositions(r.mesh);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setIndex(new THREE.BufferAttribute(index, 1));
        const fp = `${params.w}x${params.d}x${params.h}`;
        viewer.showMesh(g, { refit: fp !== lastFootprint });
        g.dispose();
        lastFootprint = fp;
        const [W, D] = r.size;
        dimsEl.replaceChildren(h('div', 'W ', h('b', W.toFixed(1)), ' × D ', h('b', D.toFixed(1)), ' × H ', h('b', r.height.toFixed(1)), ' mm'));
        statsEl.textContent = `${r.triangles.toLocaleString()} triangles · ≈ ${Math.round(r.grams)} g of filament if printed solid`;
        status('');
        renderForm();
      } catch (e) {
        if (my === token) status(`Couldn't generate this bin: ${e.message}`, true);
      }
    }, 120);
  }

  // ---- form
  function renderForm() {
    const lib = getCatalog().parts.filter((p) => p.category === 'bins');
    const key = binKey(params);
    const existing = lib.find((p) => p.bin?.key === key);
    const [W, D] = outerSize(params);
    const maxCx = normalizeBin({ ...params, cx: 99 }).cx;
    const maxCy = normalizeBin({ ...params, cy: 99 }).cy;
    const height = binHeight(params);
    const nameInput = h('input.text-input', {
      type: 'text',
      value: name,
      placeholder: binLabel(params),
      maxLength: 80,
      oninput: (e) => {
        name = e.target.value;
        saveDraft();
      },
    });

    configEl.replaceChildren(
      section(
        'Size',
        h(
          'div.quick-sizes',
          QUICK_SIZES.map(([w, d]) =>
            h('button.btn.sm', { type: 'button', 'aria-pressed': String(params.w === w && params.d === d), onclick: () => set({ w, d }) }, `${w}×${d}`),
          ),
        ),
        h(
          'div.field-row',
          h('label.field', h('span', 'Width (cells)'), select(range(...LIMITS.w).map((v) => ({ value: String(v), label: `${v} · ${(v * SPEC.pitch - SPEC.gap).toFixed(1)} mm` })), String(params.w), (v) => set({ w: Number(v) }))),
          h('label.field', h('span', 'Depth (cells)'), select(range(...LIMITS.d).map((v) => ({ value: String(v), label: `${v} · ${(v * SPEC.pitch - SPEC.gap).toFixed(1)} mm` })), String(params.d), (v) => set({ d: Number(v) }))),
        ),
        h(
          'label.field',
          h('span', 'Height (7 mm units)'),
          select(
            range(...LIMITS.h).map((v) => {
              const mm = binHeight({ ...params, h: v });
              return { value: String(v), label: `${v}u · ${mm.toFixed(1)} mm${params.lip ? ' with lip' : ''}` };
            }),
            String(params.h),
            (v) => set({ h: Number(v) }),
          ),
        ),
        h('div.hint', 'Fits (green):'),
        fitBadges(height),
      ),
      section(
        'Features',
        check('Stacking lip', params.lip, (v) => set({ lip: v }), 'Standard Gridfinity lip, so bins stack (adds 4.4 mm)'),
        check('Magnet holes (6 × 2 mm)', params.magnets, (v) => set({ magnets: v }), '6.5 mm × 2.4 mm pockets in each foot'),
        check('Screw holes (M3)', params.screws, (v) => set({ screws: v }), '3 mm × 6 mm holes in each foot'),
        check('Label tab', params.label, (v) => set({ label: v }), '45° label shelf along the back of each compartment'),
        check('Finger scoop', params.scoop, (v) => set({ scoop: v }), 'Rounded front of each compartment, to scoop out small parts'),
      ),
      section(
        'Compartments',
        h(
          'div.field-row',
          h('label.field', h('span', 'Across'), select(range(1, maxCx).map((v) => ({ value: String(v), label: String(v) })), String(params.cx), (v) => set({ cx: Number(v) }))),
          h('label.field', h('span', 'Front to back'), select(range(1, maxCy).map((v) => ({ value: String(v), label: String(v) })), String(params.cy), (v) => set({ cy: Number(v) }))),
        ),
        h('div.hint', `Outer size ${W.toFixed(1)} × ${D.toFixed(1)} mm; compartments at least 10 mm wide.`),
      ),
      section(
        'Save',
        h('label.field', h('span', 'Name'), nameInput),
        existing ? h('div.hint', `Already in the library as “${existing.name}”. Saving again renames it.`) : null,
        savingOn() ? null : h('div.hint', 'Saving is turned off on this server (-bins). You can still download the STL.'),
        h(
          'div.btn-row',
          h(
            'button.btn.primary',
            {
              type: 'button',
              disabled: !result || !savingOn(),
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  const c = await saveBin({ key, name: name.trim() || binLabel(params), params }, existing ? null : meshToSTL(result.mesh, binLabel(params)));
                  onCatalog(c);
                  status(`Saved “${name.trim() || binLabel(params)}” to the library`);
                  setTimeout(() => status(''), 2500);
                } catch (err) {
                  status(`Couldn't save: ${err.message}`, true);
                }
                renderForm();
                renderLibrary();
              },
            },
            existing ? 'Save name' : 'Save to library',
          ),
          h(
            'button.btn',
            {
              type: 'button',
              disabled: !result,
              onclick: () => {
                const url = URL.createObjectURL(new Blob([meshToSTL(result.mesh, binLabel(params))], { type: 'model/stl' }));
                const a = h('a', { href: url, download: `${(name.trim() || `Gridfinity ${binLabel(params)}`).replace(/[\\/:*?"<>|]+/g, ' ')}.stl` });
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              },
            },
            'Download STL',
          ),
        ),
      ),
    );
  }

  // ---- library
  async function addStarterSet(btn) {
    btn.disabled = true;
    const lib = getCatalog().parts.filter((p) => p.category === 'bins');
    let added = 0;
    try {
      for (const p of STARTER) {
        const key = binKey(p);
        if (lib.some((x) => x.bin?.key === key)) continue;
        status(`Generating ${binLabel(p)}…`);
        const r = await generateBin(p);
        const c = await saveBin({ key, name: `${p.w}×${p.d} bin`, params: r.params }, meshToSTL(r.mesh, binLabel(p)));
        r.manifold.delete();
        onCatalog(c);
        added++;
      }
      status(added ? `Added ${added} bin${added === 1 ? '' : 's'}` : 'The starter set is already in the library');
      setTimeout(() => status(''), 2500);
    } catch (e) {
      status(`Couldn't add the starter set: ${e.message}`, true);
    }
    btn.disabled = false;
    renderLibrary();
    renderForm();
  }

  function renderLibrary() {
    const lib = getCatalog()
      .parts.filter((p) => p.category === 'bins')
      .map((part) => ({ part, p: binOf(part) }))
      .filter((b) => b.p)
      .sort((a, b) => a.p.w * a.p.d - b.p.w * b.p.d || a.p.h - b.p.h || a.part.name.localeCompare(b.part.name));
    const current = binKey(params);
    libraryEl.replaceChildren(
      h('h3.lib-title', `Bin library (${lib.length})`),
      h('p.muted', 'Saved on this server. Use them in drawers and sustainers with a Gridfinity baseplate: Build tab → Bins.'),
      savingOn()
        ? h('button.btn.sm', { type: 'button', title: STARTER.map(binLabel).join('\n'), onclick: (e) => addStarterSet(e.currentTarget) }, '+ Starter set (5 common 1F-drawer bins)')
        : null,
      lib.length
        ? h(
            'div.bin-list',
            lib.map(({ part, p }) =>
              h(
                'div.bin-item',
                { class: `bin-item${part.bin.key === current ? ' active' : ''}` },
                h(
                  'button.bin-item-main',
                  {
                    type: 'button',
                    title: 'Load into the generator',
                    onclick: () => {
                      params = normalizeBin(p);
                      name = part.name;
                      saveDraft();
                      renderForm();
                      renderLibrary();
                      regenerate();
                    },
                  },
                  h('b', part.name),
                  h('small', `${binLabel(p)} · ${binHeight(p).toFixed(1)} mm · ${formatBytes(part.bytes)}`),
                  fitBadges(binHeight(p)),
                ),
                h(
                  'div.bin-item-actions',
                  h('a.btn.sm.ghost', { href: fileUrl(part.id, true), title: 'Download STL' }, '↓'),
                  savingOn()
                    ? h(
                        'button.btn.sm.ghost',
                        {
                          type: 'button',
                          title: 'Delete from the library',
                          onclick: async () => {
                            if (!confirm(`Delete “${part.name}” from the bin library? Builds that use it will show a warning.`)) return;
                            try {
                              onCatalog(await deleteBin(part.bin.key));
                            } catch (e) {
                              status(`Couldn't delete: ${e.message}`, true);
                            }
                            renderLibrary();
                            renderForm();
                          },
                        },
                        '✕',
                      )
                    : null,
                ),
              ),
            ),
          )
        : h('p.muted', 'No bins yet. Make one on the left and save it, or add the starter set.'),
    );
  }

  renderForm();
  renderLibrary();
  regenerate();
  return {
    /** Re-render after the catalog changed elsewhere. */
    refresh() {
      renderForm();
      renderLibrary();
    },
  };
}
