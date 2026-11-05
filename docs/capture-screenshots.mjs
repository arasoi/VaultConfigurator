// Regenerates the screenshots in docs/images from the running app, using
// headless Chrome over the DevTools protocol (Node 22+, no npm packages).
//
//   go run . -data Data            # in another terminal
//   node docs/capture-screenshots.mjs [outDir] [only]
//
// outDir defaults to docs/images; `only` captures just the shots whose file
// name contains it (e.g. "library"). Set CHROME to the browser executable if
// it isn't in the default place, and APP if the app isn't on localhost:8080.
// Each shot sets up a build, theme, tab and camera through window.vault.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] || 'docs/images';
const ONLY = process.argv[3];
const APP = process.env.APP || 'http://localhost:8080/';
const PORT = 9333;
const W = 1600, H = 1000;
const CHROME =
  process.env.CHROME ||
  {
    win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }[process.platform] ||
  'google-chrome';
const PROFILE = join(tmpdir(), `vault-shots-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('chrome did not start');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// Page helpers installed after each load.
const HELPERS = `
  window.__waitLoaded = async (ms = 180000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const objs = [...(window.vault?.viewer.objects.values() || [])];
      if (objs.length && objs.every((o) => o.loaded)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  window.__setBuild = async (mut) => {
    const R = await import('/js/rules.js');
    vault.update((b) => { for (const k of Object.keys(b)) delete b[k]; Object.assign(b, R.defaultBuild()); mut(b, R); });
    await new Promise((r) => setTimeout(r, 300));
    return __waitLoaded();
  };
  window.__theme = (t) => { document.documentElement.dataset.theme = t; };
  // Camera: azimuth / elevation in degrees around the build, distance as a multiple of its size.
  window.__view = (az, el, dist = 1, lift = 0.45, tx = 0) => {
    const v = vault.viewer, L = v.lastLayout;
    const size = Math.max(L.width, L.height, L.depth);
    const tgt = [tx, L.height * lift, 0];
    const r = size * 2.1 * dist, a = az * Math.PI / 180, e = el * Math.PI / 180;
    v.controls.target.set(...tgt);
    v.camera.position.set(tgt[0] + r * Math.cos(e) * Math.sin(a), tgt[1] + r * Math.sin(e), tgt[2] + r * Math.cos(e) * Math.cos(a));
    v.controls.update();
    v.renderer.render(v.scene, v.camera);
  };
`;

async function load() {
  await send('Page.navigate', { url: APP });
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    try { if (await js('return !!(window.vault && vault.viewer)')) break; } catch {}
  }
  await js(HELPERS);
}

async function shot(name, clipSel) {
  await js('vault.viewer.renderer.render(vault.viewer.scene, vault.viewer.camera); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));');
  let clip;
  if (clipSel) {
    const r = await js(`const b = document.querySelector(${JSON.stringify(clipSel)}).getBoundingClientRect(); return [b.x, b.y, b.width, b.height];`);
    clip = { x: r[0], y: r[1], width: r[2], height: r[3], scale: 1 };
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  console.log('saved', name);
}

const TROLLEY = `
  b.name = 'Workshop trolley'; b.width = 'L'; b.depth = 5; b.base = 'wheels';
  b.pullHandle = true; b.backbone = true; b.roof = 'grid'; b.topHandle = true; b.colors.preset = 'orange';
  b.levels = [
    { id: R.newId(), layout: 'L', height: 2, cols: [{ type: 'drawer', interior: 'gridfinity' }] },
    { id: R.newId(), layout: 'L', height: 1, cols: [{ type: 'drawer', interior: 'griddividers' }] },
    { id: R.newId(), layout: 'S+S', height: 1, cols: [R.newColumn('drawer'), R.newColumn('drawer')] },
    { id: R.newId(), layout: 'L', height: 1, cols: [{ type: 'sustainer', interior: 'dividers' }] },
    { id: R.newId(), layout: 'L', height: 1, cols: [R.newColumn('drawer')] },
  ];`;

const SHOTS = {
  async 'build-trolley.png'() {
    await js(`__theme('dark'); await __setBuild((b, R) => { ${TROLLEY} }); __view(35, 18, 0.95);`);
    await shot('build-trolley.png');
    await shot('stack-editor.png', '#config');
    await shot('parts-list.png', '#bom');
  },
  async 'hardware.png'() {
    await js(`__theme('dark'); await __setBuild((b, R) => { ${TROLLEY} });
      const sec = [...document.querySelectorAll('#bom .section')].find((e) => e.querySelector('h3')?.textContent === 'Hardware');
      sec.id = 'hw-shot'; sec.scrollIntoView({ block: 'center' });`);
    await shot('hardware.png', '#hw-shot');
  },
  async 'open-explode.png'() {
    await js(`__theme('light'); await __setBuild((b, R) => { ${TROLLEY} });
      document.querySelector('#opt-open').checked = true; vault.viewer.setOptions({ open: 1, explode: 0.45 });
      document.querySelector('#opt-explode').value = 0.45; __view(-30, 20, 1.15);`);
    await shot('open-explode.png');
  },
  async 'desk-tower.png'() {
    await js(`__theme('light'); await __setBuild((b, R) => {
      b.name = 'Desk tower'; b.width = 'M'; b.depth = 4; b.base = 'feet'; b.roof = 'table'; b.topHandle = false; b.colors.preset = 'arctic';
      b.levels = [
        { id: R.newId(), layout: 'M', height: 4, cols: [{ type: 'drawer', interior: 'empty', boxes: [2, 1, 1] }] },
        { id: R.newId(), layout: 'M', height: 2, cols: [{ type: 'sustainer', interior: 'gridfinity' }] },
        { id: R.newId(), layout: 'M', height: 1, cols: [{ type: 'drawer', interior: 'griddividers' }] },
        { id: R.newId(), layout: 'M', height: 1, cols: [R.newColumn('drawer')] },
      ];
    }); __view(28, 14, 1.12, 0.5);`);
    await shot('desk-tower.png');
  },
  async 'color-card.png'() {
    await js(`__theme('dark'); await __setBuild((b, R) => { ${TROLLEY} b.colors.preset = 'toybox'; });
      const pl = vault.res.placements.find((p) => p.role === 'facade');
      vault.viewer.select(pl.key); vault.viewer.onPick(pl);
      const h = [...document.querySelectorAll('#config h3')].find((e) => /^Colou?rs/.test(e.textContent));
      h?.scrollIntoView({ block: 'start' });
      __view(20, 12, 0.85);`);
    await shot('color-card.png');
  },
  async 'parts-library.png'() {
    await js(`__theme('dark');
      document.querySelector('.tabs button[data-tab="library"]').click();
      await new Promise((r) => setTimeout(r, 400));
      const s = document.querySelector('#lib-list input[type=search]'); s.value = 'L5 Grid Roof'; s.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const item = [...document.querySelectorAll('#lib-list .lib-item')].find((e) => e.textContent.startsWith('L5 Grid Roof'));
      item.click();
      for (let i = 0; i < 400 && !document.querySelector('#lib-status').hidden; i++) await new Promise((r) => setTimeout(r, 250));
      const rx = document.querySelector('[data-rot="x"]'); rx.click(); rx.click(); document.querySelector('#lib-fit').click();
      await new Promise((r) => setTimeout(r, 500));`);
    await shot('parts-library.png');
  },
};

try {
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (ONLY && !name.includes(ONLY)) continue;
    await load();
    await fn();
  }
} finally {
  ws.close();
  chrome.kill();
}
