// Tiny DOM helpers (no framework).

/**
 * h('div.cls#id', { onclick, attrs... }, ...children)
 * - props starting with "on" become event listeners
 * - booleans set/remove attributes; `dataset`/`style` objects are merged
 */
export function h(sel, props, ...children) {
  const [tag, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tag || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset' || k === 'style') Object.assign(el[k], v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Segmented control. options: [{ value, label, sub?, disabled?, title? }] */
export function seg(options, value, onChange, cls = '') {
  return h(
    `div.seg${cls ? '.' + cls : ''}`,
    { role: 'group' },
    options.map((o) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(o.value === value),
          disabled: !!o.disabled,
          title: o.title || null,
          onclick: () => o.value !== value && onChange(o.value),
        },
        o.label,
        o.sub ? h('small', o.sub) : null,
      ),
    ),
  );
}

export function select(options, value, onChange, cls = '') {
  return h(
    `select${cls ? '.' + cls : ''}`,
    { onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value, disabled: !!o.disabled }, o.label)),
  );
}

export function check(label, checked, onChange, title) {
  return h(
    'label.check',
    { title: title || null },
    h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
    label,
  );
}

export function section(title, ...children) {
  return h('div.section', h('h3', title), ...children);
}
