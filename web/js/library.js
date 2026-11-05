// Parts library: browse every STL in the data folder and preview it.
import { fileUrl, formatBytes } from './api.js';
import { h, select } from './dom.js';

const CATEGORY_LABEL = {
  drawers: 'Drawers',
  sustainers: 'Sustainers',
  modifications: 'Modifications',
  pegboard: 'Pegboard',
  bins: 'Gridfinity bins',
  other: 'Other',
};

export function initLibrary(listEl, viewer, catalog, { infoEl, statusEl, emptyEl }) {
  let stls = catalog.parts.filter((p) => p.kind === 'stl');
  let query = '';
  let category = 'all';
  let active = null;

  const search = h('input.text-input', {
    type: 'search',
    placeholder: 'Search parts, e.g. "L5 2F", "hinge", "roof"…',
    oninput: (e) => {
      query = e.target.value.trim().toLowerCase();
      renderTree();
    },
  });
  const catSel = select(
    [{ value: 'all', label: 'All categories' }, ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))],
    category,
    (v) => {
      category = v;
      renderTree();
    },
  );
  const count = h('div.lib-count');
  const tree = h('div.lib-tree');
  listEl.replaceChildren(h('div.lib-filters', search, catSel, count), tree);

  function matches(p) {
    if (category !== 'all' && p.category !== category) return false;
    if (!query) return true;
    const hay = `${p.name} ${p.path}`.toLowerCase();
    return query.split(/\s+/).every((t) => hay.includes(t));
  }

  function renderTree() {
    const list = stls.filter(matches);
    count.textContent = `${list.length} of ${stls.length} files`;
    // Build nested folders: category > folders...
    const rootNode = { children: new Map(), items: [] };
    for (const p of list) {
      let node = rootNode;
      const chain = [CATEGORY_LABEL[p.category] || p.category, ...p.folders.slice(1)];
      for (const f of chain) {
        if (!node.children.has(f)) node.children.set(f, { children: new Map(), items: [] });
        node = node.children.get(f);
      }
      node.items.push(p);
    }
    const open = !!query || list.length < 60;
    tree.replaceChildren(...renderNode(rootNode, open, 0));
  }

  function total(node) {
    let n = node.items.length;
    for (const c of node.children.values()) n += total(c);
    return n;
  }

  function renderNode(node, open, depth) {
    const out = [];
    for (const [name, child] of node.children) {
      out.push(
        h(
          'details',
          { open: open || depth === 0 },
          h('summary', name, ' ', h('span.c', `(${total(child)})`)),
          ...renderNode(child, open, depth + 1),
        ),
      );
    }
    for (const p of node.items) {
      out.push(
        h(
          'div.lib-item',
          { class: `lib-item${p.id === active ? ' active' : ''}`, dataset: { id: p.id }, onclick: () => show(p) },
          h('span', p.name),
          h('small', formatBytes(p.bytes)),
        ),
      );
    }
    return out;
  }

  async function show(p) {
    active = p.id;
    for (const el of tree.querySelectorAll('.lib-item')) el.classList.toggle('active', el.dataset.id === p.id);
    emptyEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = p.bytes > 30e6 ? `Preparing preview of a ${formatBytes(p.bytes)} file…` : 'Loading preview…';
    infoEl.hidden = false;
    infoEl.replaceChildren(h('h4', p.name), h('div.path', p.path), h('div.muted', 'Loading…'));
    try {
      const pv = await viewer.showPart(p);
      if (active !== p.id || !pv) return;
      const s = pv.size.map((v) => v.toFixed(1)).sort((a, b) => b - a);
      infoEl.replaceChildren(
        h('h4', p.name),
        h('div.path', p.path),
        h('div', `${s.join(' × ')} mm`),
        h('div.muted', `${pv.srcTris.toLocaleString()} triangles · preview ${pv.tris.toLocaleString()}`),
        tags(p) || '',
        h('div.btn-row', { style: { marginTop: '10px' } }, h('a.btn.primary.sm', { href: fileUrl(p.id, true) }, `Download STL (${formatBytes(p.bytes)})`)),
      );
    } catch (e) {
      infoEl.replaceChildren(h('h4', p.name), h('div.path', p.path), h('div', `Preview failed: ${e.message}`));
    } finally {
      if (active === p.id) statusEl.hidden = true;
    }
  }

  renderTree();
  return {
    /** The catalog changed (e.g. a bin was saved). */
    refresh(c) {
      stls = c.parts.filter((p) => p.kind === 'stl');
      renderTree();
    },
  };
}

function tags(p) {
  const t = [];
  if (p.sizes?.length) t.push(`size ${p.sizes.join('/')}`);
  if (p.depth) t.push(`depth ${p.depth}`);
  if (p.heights?.length) t.push(`${p.heights.join('/')}F`);
  if (p.variant) t.push(p.variant);
  if (p.piece) t.push(p.piece === 'whole' ? 'whole' : `part ${p.piece}`);
  return t.length ? h('div.muted', t.join(' · ')) : null;
}
