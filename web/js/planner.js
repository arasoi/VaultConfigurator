// Gridfinity bin planner: a dialog with a top-down grid of one drawer box or
// sustainer, where library bins are dropped into cells.
import { binHeight, binLabel } from './gridfinity.js';
import { binCells, binOf } from './rules.js';
import { h } from './dom.js';

let open = null; // the dialog currently shown

/** Closes the planner if it's open. */
export function closePlanner() {
  open?.close();
}

/**
 * Opens the planner.
 *   title: e.g. "Level 2 · 1F drawer"
 *   cols, rows: grid size in cells (rows = front to back)
 *   maxH: tallest bin that fits (mm)
 *   list: [{ id, x, y, rot }] (x from the left, y from the front)
 *   library: bin parts from the catalog
 *   onChange(list): called after every edit
 *   onEditLibrary(): opens the Bins tab
 */
export function openPlanner({ title, cols, rows, maxH, list, library, onChange, onEditLibrary }) {
  closePlanner();
  let items = (list || []).map((b) => ({ ...b }));
  const usable = library.map((part) => ({ part, p: binOf(part) })).filter((b) => b.p);
  const fits = (b) => binHeight(b.p) <= maxH + 0.01;
  let selected = usable.find(fits)?.part.id || null;
  let rot = false;
  let hover = null; // [x, y]

  const backdrop = h('div.modal-backdrop', { onclick: (e) => e.target === backdrop && close() });
  const dialog = h('div.modal.planner', { role: 'dialog', 'aria-label': `Plan bins: ${title}` });
  backdrop.append(dialog);
  document.body.append(backdrop);
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'r' || e.key === 'R') {
      rot = !rot;
      render();
    }
  };
  document.addEventListener('keydown', onKey);

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    open = null;
  }
  open = { close };

  const byId = new Map(usable.map((b) => [b.part.id, b]));
  const footprint = (it) => {
    const b = byId.get(it.id);
    return b ? binCells(b.p, it.rot) : [1, 1];
  };
  /** Cell -> index of the item covering it. */
  function occupancy(skip = -1) {
    const m = new Map();
    items.forEach((it, i) => {
      if (i === skip) return;
      const [cw, cd] = footprint(it);
      for (let a = 0; a < cw; a++) for (let c = 0; c < cd; c++) m.set(`${it.x + a},${it.y + c}`, i);
    });
    return m;
  }
  function canPlace(id, x, y, r, occ = occupancy()) {
    const b = byId.get(id);
    if (!b || !fits(b)) return false;
    const [cw, cd] = binCells(b.p, r);
    if (x < 0 || y < 0 || x + cw > cols || y + cd > rows) return false;
    for (let a = 0; a < cw; a++) for (let c = 0; c < cd; c++) if (occ.has(`${x + a},${y + c}`)) return false;
    return true;
  }
  function commit() {
    onChange(items.map((it) => ({ ...it })));
    render();
  }
  function fillEmpty() {
    if (!selected) return;
    const occ = occupancy();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (canPlace(selected, x, y, rot, occ)) {
          items.push({ id: selected, x, y, rot });
          const [cw, cd] = footprint(items.at(-1));
          for (let a = 0; a < cw; a++) for (let c = 0; c < cd; c++) occ.set(`${x + a},${y + c}`, items.length - 1);
        }
      }
    }
    commit();
  }

  function render() {
    const occ = occupancy();
    const used = [...occ.keys()].length;
    // Cell size: fit the board in the dialog.
    const cell = Math.max(26, Math.min(64, Math.floor(Math.min(560 / cols, 420 / rows))));

    const palette = usable.length
      ? usable.map((b) => {
          const ok = fits(b);
          const [cw, cd] = binCells(b.p, false);
          return h(
            'button.bin-tile',
            {
              type: 'button',
              disabled: !ok,
              'aria-pressed': String(b.part.id === selected),
              title: ok ? binLabel(b.p) : `${binHeight(b.p).toFixed(1)} mm tall: too tall for this space (${maxH} mm)`,
              onclick: () => {
                selected = b.part.id;
                render();
              },
            },
            h('span.mini', { style: { width: `${cw * 8}px`, height: `${cd * 8}px` } }),
            h('span.bin-tile-text', h('b', b.part.name), h('small', `${binLabel(b.p)} · ${binHeight(b.p).toFixed(1)} mm`)),
          );
        })
      : h('p.muted', 'The bin library is empty. Make bins in the Bins tab first.');

    const board = h('div.board', { style: { width: `${cols * cell}px`, height: `${rows * cell}px` } });
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const taken = occ.has(`${x},${y}`);
        board.append(
          h('div.cell', {
            class: `cell${taken ? ' taken' : ''}`,
            style: { left: `${x * cell}px`, bottom: `${y * cell}px`, width: `${cell}px`, height: `${cell}px` },
            onmouseenter: () => {
              hover = [x, y];
              drawGhost();
            },
            onclick: () => {
              if (selected && canPlace(selected, x, y, rot)) {
                items.push({ id: selected, x, y, rot });
                commit();
              }
            },
          }),
        );
      }
    }
    items.forEach((it, i) => {
      const b = byId.get(it.id);
      const [cw, cd] = footprint(it);
      board.append(
        h(
          'button.placed',
          {
            type: 'button',
            title: `${b ? b.part.name : 'Missing bin'} · click to remove`,
            class: `placed${b ? '' : ' missing'}`,
            style: { left: `${it.x * cell + 2}px`, bottom: `${it.y * cell + 2}px`, width: `${cw * cell - 4}px`, height: `${cd * cell - 4}px` },
            onclick: () => {
              items.splice(i, 1);
              commit();
            },
          },
          h('span', b ? b.part.name : 'missing'),
        ),
      );
    });
    const ghost = h('div.ghost', { hidden: true });
    board.append(ghost);
    board.onmouseleave = () => {
      hover = null;
      drawGhost();
    };
    function drawGhost() {
      const b = selected && byId.get(selected);
      if (!hover || !b) return void (ghost.hidden = true);
      const [cw, cd] = binCells(b.p, rot);
      const ok = canPlace(selected, hover[0], hover[1], rot);
      Object.assign(ghost.style, { left: `${hover[0] * cell}px`, bottom: `${hover[1] * cell}px`, width: `${cw * cell}px`, height: `${cd * cell}px` });
      ghost.className = `ghost${ok ? '' : ' bad'}`;
      ghost.hidden = false;
    }

    dialog.replaceChildren(
      h(
        'div.modal-head',
        h('div', h('h2', `Bins · ${title}`), h('div.muted', `${cols} × ${rows} cells · bins up to ${maxH} mm tall`)),
        h('button.icon-btn', { type: 'button', title: 'Close (Esc)', onclick: close }, '✕'),
      ),
      h(
        'div.planner-body',
        h(
          'div.bin-palette',
          h('div.bin-palette-head', h('b', 'Library'), onEditLibrary ? h('button.link', { type: 'button', onclick: () => (close(), onEditLibrary()) }, 'Make bins…') : null),
          palette,
        ),
        h(
          'div.board-wrap',
          h('div.board-label', 'Back'),
          board,
          h('div.board-label', 'Front'),
          h(
            'div.btn-row',
            h('button.btn.sm', { type: 'button', 'aria-pressed': String(rot), onclick: () => ((rot = !rot), render()) }, rot ? 'Turned 90° (R)' : 'Turn 90° (R)'),
            h('button.btn.sm', { type: 'button', disabled: !selected, onclick: fillEmpty }, 'Fill empty cells'),
            h('button.btn.sm.ghost', { type: 'button', disabled: !items.length, onclick: () => ((items = []), commit()) }, 'Clear'),
          ),
          h('div.muted', `${items.length} bin${items.length === 1 ? '' : 's'} · ${used} of ${cols * rows} cells used · click a cell to drop the selected bin, click a bin to remove it`),
        ),
      ),
    );
  }
  render();
}
