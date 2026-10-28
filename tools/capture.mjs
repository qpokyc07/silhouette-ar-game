/**
 * Снимает экраны игры в headless Chrome через CDP.
 * Требует запущенный serve.mjs на http://localhost:8080.
 *
 *   node tools/capture.mjs
 *
 * Это инструмент разработки, в саму игру не входит.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.GAME_URL || 'http://localhost:8080/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'silhouette-chrome-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const exceptions = [];

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch (_) {
      /* noop */
    }
    await sleep(150);
  }
  throw new Error('Chrome DevTools not available');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${p.method})`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function openTarget(width, height, mobile) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const cdp = new CDP(ws);
  cdp.on('Runtime.exceptionThrown', (p) => {
    exceptions.push(p.exceptionDetails?.text + ' ' + (p.exceptionDetails?.exception?.description || ''));
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') exceptions.push(p.args?.map((a) => a.value || a.description).join(' '));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  if (mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  return cdp;
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result?.value;
}

async function go(cdp, url, wait = 1400) {
  await cdp.send('Page.navigate', { url });
  await sleep(wait);
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log('  shot', name);
}

async function stateInfo(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const s = window.__silhouette?.state;
      if (!s) return { error: 'no state' };
      return {
        screen: s.screen,
        phase: s.game?.phase || s.phase,
        phaseTime: +(s.game?.phaseTime || 0).toFixed(2),
        inner: [window.innerWidth, window.innerHeight],
        rect: s.videoRect,
        anchor: s.target?.anchor,
        clock: document.getElementById('clock-num')?.textContent,
        big: document.getElementById('big-state')?.textContent,
        verdict: document.getElementById('verdict-title')?.textContent,
        score: s.game?.players?.[0]?.score,
        toast: document.getElementById('toast')?.textContent,
      };
    })()`,
  );
}

async function desktop() {
  console.log('desktop 1440x900');
  const cdp = await openTarget(1440, 900, false);

  await go(cdp, BASE);
  await shot(cdp, 'intro');
  console.log('  intro', await stateInfo(cdp));

  await go(cdp, `${BASE}?demo=1`);
  await evaluate(cdp, `document.getElementById('toast').classList.remove('on')`);
  await sleep(250);
  await shot(cdp, 'menu');

  await evaluate(cdp, `document.getElementById('btn-duel').click()`);
  await sleep(550);
  await shot(cdp, 'duel-setup');

  await evaluate(cdp, `document.getElementById('btn-duel-back').click()`);
  await sleep(400);
  await evaluate(cdp, `document.getElementById('btn-help').click()`);
  await sleep(450);
  await shot(cdp, 'help');
  await evaluate(cdp, `document.getElementById('btn-help-close').click()`);
  await sleep(300);

  await go(cdp, `${BASE}?demo=1`);
  await evaluate(cdp, `window.__silhouette.startGame('solo', ['ИГРОК']); document.getElementById('toast').classList.remove('on')`);
  await sleep(500);
  await shot(cdp, 'prep');
  console.log('  prep', await stateInfo(cdp));

  await evaluate(cdp, `window.__silhouette.state.game.phaseTime = 2.999`);
  await sleep(1350);
  await shot(cdp, 'approach');
  console.log('  approach', await stateInfo(cdp));

  await evaluate(cdp, `window.__silhouette.state.game.phaseTime = window.__silhouette.state.game.durations.approach - 0.01`);
  await sleep(800);
  await shot(cdp, 'hold');
  console.log('  hold', await stateInfo(cdp));

  await evaluate(cdp, `document.getElementById('btn-pause').click()`);
  await sleep(450);
  await shot(cdp, 'pause');
  await evaluate(cdp, `document.getElementById('btn-resume').click()`);
  await sleep(250);

  await evaluate(cdp, `window.__silhouette.state.game.phaseTime = window.__silhouette.state.game.durations.hold - 0.01`);
  await sleep(650);
  await shot(cdp, 'impact');
  console.log('  impact', await stateInfo(cdp));

  await evaluate(
    cdp,
    `(() => {
      const s = window.__silhouette.state;
      s.game.players[0].score = 9420;
      s.game.players[0].passed = 4;
      s.game.players[0].avgAccuracy = 0.78;
      s.game.players[0].lives = 1;
      window.__silhouette.startGame('duel', ['АКА', 'КИРА']);
      const g = s.game;
      g.players[0].score = 9420;
      g.players[0].passed = 4;
      g.players[0].avgAccuracy = 0.78;
      g._finishPlayer('complete');
    })()`,
  );
  await sleep(800);
  await shot(cdp, 'handoff');
  console.log('  handoff', await stateInfo(cdp));
  await evaluate(cdp, `document.getElementById('btn-handoff-next').click()`);
  await sleep(650);
  console.log('  second player', await evaluate(cdp, `(() => {
    const s = window.__silhouette.state;
    return { screen: s.screen, phase: s.game?.phase, active: s.game?.activePlayer, name: s.game?.currentPlayer?.name };
  })()`));

  await evaluate(
    cdp,
    `(() => {
      window.__silhouette.startGame('duel', ['АКА', 'КИРА']);
      const s = window.__silhouette.state;
      const g = s.game;
      g.players[0].score = 12480;
      g.players[0].passed = 5;
      g.players[0].avgAccuracy = 0.84;
      g.players[0].bestCombo = 5;
      g.players[1].score = 10310;
      g.players[1].passed = 4;
      g.players[1].avgAccuracy = 0.79;
      g.players[1].bestCombo = 3;
      g.players[0].avgAccuracy = 0.84;
      g.phase = 'over';
      g.winner = g.players[0];
      g.isDraw = false;
      window.__silhouette.showResults();
    })()`,
  );
  await sleep(700);
  await shot(cdp, 'result-duel');
  console.log('  result', await stateInfo(cdp));

  cdp.ws.close();
}

async function mobile() {
  console.log('mobile 390x844');
  const cdp = await openTarget(390, 844, true);

  await go(cdp, BASE);
  await shot(cdp, 'mobile-intro');

  await go(cdp, `${BASE}?demo=1`);
  await shot(cdp, 'mobile-menu');

  await evaluate(cdp, `window.__silhouette.startGame('solo', ['ИГРОК'])`);
  await sleep(500);
  await evaluate(cdp, `window.__silhouette.state.game.phaseTime = 2.999`);
  await sleep(300);
  await evaluate(cdp, `window.__silhouette.state.game.phaseTime = window.__silhouette.state.game.durations.approach - 0.01`);
  await sleep(800);
  await shot(cdp, 'mobile-hold');
  console.log('  mobile hold', await stateInfo(cdp));

  await evaluate(
    cdp,
    `(() => {
      const s = window.__silhouette.state;
      const g = s.game;
      g.players[0].score = 7310;
      g.players[0].passed = 4;
      g.players[0].avgAccuracy = 0.77;
      g.players[0].lives = 0;
      g.phase = 'over';
      window.__silhouette.showResults();
    })()`,
  );
  await sleep(700);
  await shot(cdp, 'mobile-result');

  cdp.ws.close();
}

async function landscape() {
  console.log('landscape 844x390');
  const cdp = await openTarget(844, 390, true);

  await go(cdp, BASE);
  await shot(cdp, 'landscape-intro');

  await go(cdp, `${BASE}?demo=1`);
  await evaluate(cdp, `document.getElementById('toast').classList.remove('on')`);
  await sleep(250);
  await shot(cdp, 'landscape-menu');

  await evaluate(cdp, `window.__silhouette.startGame('solo', ['ИГРОК']); document.getElementById('toast').classList.remove('on')`);
  await sleep(350);
  await evaluate(cdp, `window.__silhouette.state.game.phaseTime = 2.999`);
  await sleep(250);
  await evaluate(cdp, `window.__silhouette.state.game.phaseTime = window.__silhouette.state.game.durations.approach - 0.01`);
  await sleep(700);
  await shot(cdp, 'landscape-hold');
  console.log('  landscape hold', await stateInfo(cdp));

  cdp.ws.close();
}

try {
  await waitForChrome();
  await desktop();
  await mobile();
  await landscape();
  if (exceptions.length) {
    console.log('\nBrowser errors:');
    for (const e of [...new Set(exceptions)]) console.log('  !', e);
  } else {
    console.log('\nNo browser errors.');
  }
} finally {
  try {
    chrome.kill();
  } catch (_) {
    /* noop */
  }
  setTimeout(() => {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (_) {
      /* noop */
    }
  }, 300);
}
