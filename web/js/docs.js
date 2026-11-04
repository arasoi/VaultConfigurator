// Documentation tab: manuals (PDF) and reference images from the data folder.
import { fileUrl, formatBytes } from './api.js';
import { h } from './dom.js';

export function renderDocs(root, catalog) {
  const docs = catalog.parts.filter((p) => p.kind !== 'stl');
  const manuals = docs.filter((p) => p.kind === 'pdf');
  const images = docs.filter((p) => p.kind === 'image');
  const texts = docs.filter((p) => p.kind === 'text');

  const card = (p) =>
    h(
      'a.doc-card',
      { href: fileUrl(p.id), target: '_blank', rel: 'noopener' },
      p.kind === 'image'
        ? h('div.thumb', { style: { backgroundImage: `url("${fileUrl(p.id)}")` } })
        : h('div.thumb', p.kind.toUpperCase()),
      h('div.meta', h('b', p.name.replace(/^\d+[_.]\s*/, '')), h('span', `${p.folders.slice(1).join(' / ') || p.folders[0] || ''} · ${formatBytes(p.bytes)}`)),
    );

  root.replaceChildren(
    h('h2', 'Manuals'),
    h('div.doc-grid', manuals.map(card)),
    h('h2', 'Reference images'),
    h('div.doc-grid', images.map(card)),
    texts.length ? [h('h2', 'Notes'), h('div.doc-grid', texts.map(card))] : null,
  );
}
