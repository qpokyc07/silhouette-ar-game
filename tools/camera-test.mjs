/**
 * Проверка реальной ветки «камера + MediaPipe» на фейковом видео Chrome.
 *   node tools/camera-test.mjs
 * Нужен запущенный serve.mjs на localhost:8080.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9444;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'silhouette-cam-'));
const errors = [];
const videoFile = process.env.POSE_VIDEO || '';

const chromeArgs = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
];
if (videoFile) chromeArgs.push(`--use-file-for-fake-video-capture=${videoFile}`);
chromeArgs.push('about:blank');

const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' });

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
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
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main() {
  await waitForChrome();
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 900,
    screenHeight: 700,
  });
  await cdp.send('Page.navigate', { url: 'http://localhost:8080/' });
  await sleep(600);

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };

  for (let i = 0; i < 40; i++) {
    if (await evaluate(`typeof window.__silhouette !== 'undefined'`)) break;
    await sleep(250);
  }
  if (!(await evaluate(`typeof window.__silhouette !== 'undefined'`))) {
    throw new Error('window.__silhouette не появился: проверьте ошибки JS');
  }

  await evaluate(`document.getElementById('btn-camera').click()`);
  console.log('Нажата кнопка камеры, жду MediaPipe…');

  let state = null;
  for (let i = 0; i < 90; i++) {
    state = await evaluate(`(() => {
      const s = window.__silhouette.state;
      return {
        screen: s.screen,
        cameraOn: s.cameraOn,
        cameraReady: s.cameraReady,
        modelReady: s.modelReady,
        engineReady: s.engine.ready,
        engineError: s.engine.error,
        loader: document.getElementById('loader-title')?.textContent,
        loaderText: document.getElementById('loader-text')?.textContent,
        loaderHidden: document.getElementById('loader').hidden,
      };
    })()`);
    if (state.screen === 'menu' || state.loaderText?.includes('Модель') || state.loaderText?.includes('модель')) break;
    await sleep(500);
    if (i % 8 === 0) console.log('  ', state.screen, state.loader, state.loaderText?.slice(0, 70));
  }

  console.log('\nИтог:', JSON.stringify(state, null, 2));
  fs.mkdirSync('shots', { recursive: true });
  let shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync('shots/camera-test.png', Buffer.from(shot.data, 'base64'));

  if (state?.screen === 'menu') {
    await evaluate(`document.getElementById('btn-solo').click()`);
    await sleep(1200);
    const gameState = await evaluate(`(() => {
      const s = window.__silhouette.state;
      return {
        screen: s.screen,
        phase: s.game?.phase,
        prepTitle: document.getElementById('prep-title')?.textContent,
        prepSub: document.getElementById('prep-sub')?.textContent,
        hasSkeleton: Object.keys(s.lastSample?.points || {}).length,
      };
    })()`);
    console.log('Партия без человека в кадре:', JSON.stringify(gameState, null, 2));
    shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync('shots/camera-game.png', Buffer.from(shot.data, 'base64'));
    if (gameState.phase !== 'prep' || gameState.screen !== 'game') {
      console.error('Партия с камерой не перешла в ожидание игрока');
      process.exitCode = 1;
    }

    if (videoFile) {
      await sleep(1200);
      const poseState = await evaluate(`(() => {
        const s = window.__silhouette.state;
        const lm = s.lastSample;
        return {
          fullBody: lm?.fullBody,
          visible: lm?.visible,
          points: Object.keys(lm?.points || {}).length,
          anchor: lm?.anchor,
          phase: s.game?.phase,
        };
      })()`);
      console.log('Синтетическое видео с человеком:', JSON.stringify(poseState, null, 2));
      if (!poseState.fullBody) {
        console.error('MediaPipe не увидел человека целиком на тестовом видео');
        process.exitCode = 1;
      }
      await evaluate(`window.__silhouette.state.game.phaseTime = 2.999`);
      await sleep(400);
      await evaluate(`window.__silhouette.state.game.phaseTime = window.__silhouette.state.game.durations.approach - 0.01`);
      await sleep(650);
      fs.mkdirSync('shots', { recursive: true });
      shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync('shots/camera-pose.png', Buffer.from(shot.data, 'base64'));
      console.log('Фаза с человеком:', JSON.stringify(await evaluate(`(() => {
        const s = window.__silhouette.state;
        return { phase: s.game?.phase, match: s.lastSample?.match, score: s.game?.players?.[0]?.score };
      })()`)));
    }

    await evaluate(`document.getElementById('btn-pause').click()`);
    await sleep(300);
    const paused = await evaluate(`document.getElementById('screen-pause').hidden === false && window.__silhouette.state.paused === true`);
    console.log('Пауза:', paused ? 'OK' : 'FAIL');
    if (!paused) process.exitCode = 1;
    await evaluate(`document.getElementById('btn-resume').click()`);
    await sleep(250);
    const resumed = await evaluate(`document.getElementById('screen-pause').hidden === true && window.__silhouette.state.paused === false`);
    console.log('Возврат из паузы:', resumed ? 'OK' : 'FAIL');
    if (!resumed) process.exitCode = 1;
  }

  if (state?.screen !== 'menu') {
    console.error('Камера/модель не дошли до меню');
    process.exitCode = 1;
  }
  if (errors.length) {
    console.error('Ошибки браузера:', errors);
    process.exitCode = 1;
  }
  ws.close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => {
      chrome.kill();
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch (_) {
        /* noop */
      }
    }, 200);
  });
