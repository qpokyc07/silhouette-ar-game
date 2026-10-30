/**
 * «СИЛУЭТ» — интерфейс, камера и игровой цикл.
 *
 * Один статичный сайт: камера → MediaPipe Pose → углы тела → сравнение
 * с позой тени. Без сборки, сервера и баз данных.
 */

import {
  POSES,
  NEUTRAL_POSE,
  MODEL_HEIGHT,
  buildFigure,
} from './poses.js';
import { PoseEngine } from './pose.js';
import { PoseMatcher } from './matcher.js';
import { SilhouetteGame, PREP_TIME } from './game.js';
import { Scene, renderPoseMini } from './scene.js';
import { Sound } from './audio.js';
import { loadBoard, saveScore } from './leaderboard.js';

const $ = (id) => document.getElementById(id);
const ROUNDS = 5;
const STORE_KEY = 'silhouette:v1';
const PRIMARY = ['screen-intro', 'screen-menu', 'screen-duel', 'screen-leaders', 'screen-handoff', 'screen-over', 'screen-pause'];

const state = {
  screen: 'intro',
  mode: 'intro',
  w: 1,
  h: 1,
  dpr: 1,
  canvas: null,
  ctx: null,
  video: null,
  stream: null,
  cameraOn: false,
  cameraReady: false,
  modelReady: false,
  demo: false,
  busy: false,
  paused: false,
  game: null,
  lastMode: 'solo',
  lastNames: ['ИГРОК 1', 'ИГРОК 2'],
  setupMode: 'duel',
  challenge: null,
  photos: [],
  phase: 'idle',
  target: null,
  targets: null,
  anchorSmooth: null,
  lastSample: null,
  lastDetect: 0,
  landmarks: null,
  videoRect: { x: 0, y: 0, w: 1, h: 1 },
  engine: new PoseEngine(),
  matcher: new PoseMatcher(),
  scene: new Scene(),
  sound: new Sound(),
  soundOn: true,
  bestSolo: 0,
  leaderName: 'ИГРОК',
  countShown: null,
  helpOpen: false,
  hudCache: {},
  debug: false,
  demoTime: 0,
  loopAt: 0,
};

/* ------------------------------------------------------------------ */
/*  Старт                                                             */
/* ------------------------------------------------------------------ */

function init() {
  state.canvas = $('fx');
  state.ctx = state.canvas.getContext('2d');
  state.video = $('cam');
  loadPrefs();
  bindUi();
  onResize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 260));
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('fullscreenchange', syncFullscreen);

  state.video.addEventListener('loadedmetadata', onResize);
  state.video.addEventListener('resize', onResize);

  window.__silhouette = {
    state,
    startGame,
    startDemo,
    showMenu,
    pauseGame,
    resumeGame,
    showResults: () => showResults(state.game),
  };

  renderPoseMini($('pose-mini'), POSES[0]);
  showIntro();
  requestAnimationFrame(loop);

  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    startDemo();
    if (params.get('auto') === 'solo') startGame('solo', ['ИГРОК']);
    if (params.get('auto') === 'duel') startGame('duel', ['ИГРОК 1', 'ИГРОК 2']);
  }
  state.challenge = parseChallenge();
  updateChallengeBanner();
}

function loadPrefs() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!data) return;
    if (Number.isFinite(data.bestSolo)) state.bestSolo = data.bestSolo;
    if (typeof data.name === 'string' && data.name.trim()) state.leaderName = data.name.trim().slice(0, 14);
    if (typeof data.sound === 'boolean') {
      state.soundOn = data.sound;
      state.sound.enabled = data.sound;
    }
  } catch (_) {
    /* noop */
  }
  syncSoundUI();
}

function savePrefs() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ bestSolo: state.bestSolo, sound: state.soundOn, name: state.leaderName }));
  } catch (_) {
    /* noop */
  }
}

/* ------------------------------------------------------------------ */
/*  Экраны                                                            */
/* ------------------------------------------------------------------ */

function hidePrimary() {
  for (const id of PRIMARY) {
    const el = $(id);
    if (el) el.hidden = true;
  }
  $('screen-help').hidden = true;
  state.helpOpen = false;
}

function openScreen(id) {
  for (const sid of PRIMARY) {
    const el = $(sid);
    if (el) el.hidden = sid !== id;
  }
  if (id !== 'screen-help') {
    $('screen-help').hidden = true;
    state.helpOpen = false;
  }
}

function setHud(on) {
  $('hud').hidden = !on;
}

function showIntro() {
  hidePrimary();
  state.screen = 'intro';
  state.mode = 'intro';
  state.phase = 'idle';
  state.target = null;
  state.game = null;
  document.body.dataset.mode = 'intro';
  document.body.classList.remove('camera-on', 'demo', 'is-paused');
  openScreen('screen-intro');
  setHud(false);
  updateBestLabels();
  const note = $('intro-note');
  if (note) {
    note.classList.toggle('warn', !window.isSecureContext);
    note.textContent = window.isSecureContext
      ? 'Нужно разрешение на камеру. Видео остаётся на этом устройстве.'
      : 'Камера работает только по HTTPS или на localhost.';
  }
}

function showMenu() {
  hidePrimary();
  state.screen = 'menu';
  state.mode = 'menu';
  state.phase = 'idle';
  state.paused = false;
  state.target = null;
  state.game = null;
  state.lastSample = null;
  state.scene.reset();
  document.body.dataset.mode = 'menu';
  document.body.classList.toggle('camera-on', state.cameraOn);
  document.body.classList.toggle('demo', state.demo);
  openScreen('screen-menu');
  setHud(false);
  updateBestLabels();
  syncSoundUI();
}

function showDuelSetup(mode = 'duel') {
  state.setupMode = mode === 'versus' ? 'versus' : 'duel';
  hidePrimary();
  state.screen = 'duel';
  document.body.dataset.mode = 'duel';
  openScreen('screen-duel');
  setHud(false);
  const n1 = $('name1');
  const n2 = $('name2');
  if (n1 && !n1.value) n1.value = 'ИГРОК 1';
  if (n2 && !n2.value) n2.value = 'ИГРОК 2';
  if (state.setupMode === 'versus') {
    $('duel-title').innerHTML = 'ДВА ИГРОКА<br>ОДНОВРЕМЕННО';
    $('duel-lead').textContent = 'Оба в кадре одновременно, одна и та же тень на каждого. Победит тот, кто точнее повторит позу и наберёт больше очков.';
  } else {
    $('duel-title').innerHTML = 'КТО БРОСАЕТ<br>ТЕНЬ?';
    $('duel-lead').textContent = 'Игроки проходят одинаковое число теней по очереди. Счёт и точность решают, кто сильнее.';
  }
  // На телефоне автофокус открывает клавиатуру поверх игры — не мешаем.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    setTimeout(() => n1?.select(), 180);
  }
  state.sound.ui();
}

function updateBestLabels() {
  const txt = state.bestSolo > 0 ? formatScore(state.bestSolo) : '—';
  for (const el of document.querySelectorAll('[data-best-solo]')) el.textContent = txt;
}

function openHelp() {
  state.helpOpen = true;
  const help = $('screen-help');
  help.hidden = false;
  help.scrollTop = 0;
  state.sound.ui();
}

function closeHelp() {
  state.helpOpen = false;
  $('screen-help').hidden = true;
}

/* ------------------------------------------------------------------ */
/*  Камера и загрузка                                                 */
/* ------------------------------------------------------------------ */

async function enableCamera() {
  if (state.busy) return;
  state.busy = true;
  state.engine.error = null;
  state.sound.init();
  state.sound.resume();
  setLoader('ВКЛЮЧАЮ КАМЕРУ', 'Разрешите доступ, когда браузер спросит', 16);

  try {
    await startCamera();
    setLoader('НАСТРАИВАЮ ЗРЕНИЕ', 'Загружаю модель распознавания тела…', 48);
    await state.engine.load((text) => {
      const p = /готов/i.test(text) ? 90 : /вычислител/i.test(text) ? 72 : 58;
      setLoader('НАСТРАИВАЮ ЗРЕНИЕ', text, p);
    });
    state.modelReady = true;
    state.cameraReady = true;
    state.busy = false;
    setLoader('ГОТОВО', 'Можно выходить на сцену', 100);
    setTimeout(() => {
      hideLoader();
      showMenu();
      state.sound.ui();
    }, 260);
  } catch (e) {
    state.busy = false;
    const modelFailed = !!state.engine.error;
    state.cameraReady = false;
    showCameraError(e, modelFailed);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('mediaDevices unavailable');
    err.code = 'insecure';
    throw err;
  }
  stopCamera();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
  } catch (e) {
    if (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError') {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } else {
      throw e;
    }
  }

  state.stream = stream;
  const v = state.video;
  v.srcObject = stream;
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  try {
    await v.play();
  } catch (_) {
    /* автоплей может ждать жеста — он уже был */
  }
  if (v.readyState < 2) {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      v.addEventListener('loadeddata', finish, { once: true });
      setTimeout(finish, 4000);
    });
  }
  state.cameraOn = true;
  state.demo = false;
  document.body.classList.add('camera-on');
  document.body.classList.remove('demo');
  onResize();
}

function stopCamera() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  state.cameraOn = false;
  if (state.video) state.video.srcObject = null;
}

function describeCameraError(e) {
  if (!window.isSecureContext || e?.code === 'insecure') {
    return 'Браузер открывает камеру только по HTTPS или на localhost. Загрузите игру на GitHub Pages — там HTTPS уже включён.';
  }
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Доступ к камере запрещён. Разрешите камеру в настройках браузера для этой страницы и попробуйте снова.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Камера не найдена. Подключите камеру или откройте страницу на телефоне.';
    case 'NotReadableError':
      return 'Камера занята другим приложением. Закройте его и попробуйте снова.';
    default:
      return `Не удалось открыть камеру. ${escapeHtml(String(e?.message || e || ''))}`;
  }
}

function showCameraError(e, modelFailed) {
  stopCamera();
  document.body.classList.remove('camera-on');
  const msg = modelFailed
    ? 'Модель распознавания не загрузилась. Проверьте интернет и попробуйте ещё раз.'
    : describeCameraError(e);
  setLoaderError(modelFailed ? 'НЕ ЗАГРУЗИЛАСЬ МОДЕЛЬ' : 'КАМЕРА НЕ ОТКРЫЛАСЬ', msg);
}

function setLoader(title, text, progress) {
  const l = $('loader');
  l.hidden = false;
  l.classList.remove('is-error');
  $('loader-title').textContent = title;
  $('loader-text').textContent = text;
  $('loader-actions').hidden = true;
  $('loader-bar').hidden = false;
  $('loader-fill').style.width = `${Math.max(4, Math.min(100, progress))}%`;
}

function setLoaderError(title, html) {
  const l = $('loader');
  l.hidden = false;
  l.classList.add('is-error');
  $('loader-title').textContent = title;
  $('loader-text').innerHTML = html;
  $('loader-actions').hidden = false;
  $('loader-bar').hidden = true;
}

function hideLoader() {
  $('loader').hidden = true;
  $('loader').classList.remove('is-error');
}

function startDemo() {
  stopCamera();
  state.busy = false;
  state.demo = true;
  state.cameraOn = false;
  state.cameraReady = true;
  state.modelReady = false;
  state.sound.init();
  state.sound.resume();
  hideLoader();
  document.body.classList.remove('camera-on');
  document.body.classList.add('demo');
  showMenu();
  showToast('Демо-режим: скелет сам повторяет позу тени');
}

/* ------------------------------------------------------------------ */
/*  Запуск партии                                                     */
/* ------------------------------------------------------------------ */

function startGame(mode, names) {
  if (!state.demo && (!state.cameraReady || !state.cameraOn)) {
    showToast('Сначала включите камеру');
    return;
  }
  state.sound.init();
  state.sound.resume();
  state.sound.duck(false);
  requestWakeLock();

  hidePrimary();
  state.screen = 'game';
  state.mode = ['duel', 'endless', 'versus', 'joint'].includes(mode) ? mode : 'solo';
  state.paused = false;
  state.lastMode = state.mode;
  state.lastNames = (state.mode === 'duel' || state.mode === 'versus')
    ? [names[0], names[1]]
    : [state.leaderName || 'ИГРОК'];
  state.phase = 'prep';
  state.target = null;
  state.targets = null;
  state.photos = [];
  state.anchorSmooth = null;
  state.lastSample = null;
  state.lastDetect = 0;
  state.countShown = null;
  state.hudCache = {};
  state.scene.reset();
  state.matcher.reset();

  state.game = new SilhouetteGame().start(state.mode, {
    names: state.lastNames,
    rounds: ROUNDS,
  });
  state.game.drainEvents();

  setHud(true);
  document.body.dataset.mode = 'game';
  document.body.classList.toggle('camera-on', state.cameraOn);
  document.body.classList.toggle('demo', state.demo);
  openScreen(null);
  enterPrep();
  updateHud(true);
}

function enterPrep() {
  state.phase = 'prep';
  state.target = null;
  state.targets = null;
  state.anchorSmooth = null;
  state.lastSample = null;
  state.countShown = null;
  state.matcher.reset();
  $('prep').hidden = false;
  $('prep').classList.remove('waiting');
  $('prep-title').textContent = 'ВСТАНЬТЕ В КАДР';
  const multi = state.game && (state.game.mode === 'versus' || state.game.mode === 'joint');
  $('prep-sub').textContent = multi ? 'Нужны оба игрока целиком: голова, руки и стопы' : 'Нужны голова, руки и стопы целиком';
  $('prep-count').textContent = '3';
  $('verdict').hidden = true;
  $('panel').hidden = true;
  $('big-state').hidden = true;
  $('detect-hint').hidden = true;
  state.sound.duck(false);
  updateHud(true);
}

function nextPlayer() {
  if (!state.game) return;
  if (!state.game.nextPlayer()) return;
  state.game.drainEvents();
  hidePrimary();
  state.screen = 'game';
  state.paused = false;
  document.body.dataset.mode = 'game';
  document.body.classList.toggle('camera-on', state.cameraOn);
  document.body.classList.toggle('demo', state.demo);
  setHud(true);
  state.scene.reset();
  enterPrep();
  state.sound.handoff();
}

function pauseGame() {
  if (!state.game || state.screen !== 'game' || state.paused) return;
  if (!['prep', 'approach', 'hold', 'impact'].includes(state.game.phase)) return;
  state.paused = true;
  state.screen = 'pause';
  document.body.dataset.mode = 'pause';
  document.body.classList.add('is-paused');
  openScreen('screen-pause');
  state.sound.duck(true);
  syncSoundUI();
}

function resumeGame() {
  if (!state.paused) return;
  state.paused = false;
  state.screen = 'game';
  document.body.dataset.mode = 'game';
  document.body.classList.remove('is-paused');
  openScreen(null);
  state.sound.duck(false);
}

function exitToMenu() {
  state.paused = false;
  state.game = null;
  state.target = null;
  state.phase = 'idle';
  state.scene.reset();
  state.sound.duck(false);
  document.body.classList.remove('is-paused');
  showMenu();
}

/* ------------------------------------------------------------------ */
/*  UI                                                                */
/* ------------------------------------------------------------------ */

function bindUi() {
  $('btn-camera').addEventListener('click', () => {
    state.sound.init();
    state.sound.resume();
    enableCamera();
  });
  $('btn-help-intro').addEventListener('click', openHelp);
  $('btn-help').addEventListener('click', openHelp);
  for (const el of document.querySelectorAll('[data-close-help]')) {
    el.addEventListener('click', closeHelp);
  }
  $('btn-help-close').addEventListener('click', closeHelp);
  $('btn-loader-retry').addEventListener('click', () => {
    hideLoader();
    enableCamera();
  });
  $('btn-loader-demo').addEventListener('click', startDemo);

  $('btn-solo').addEventListener('click', () => {
    state.sound.ui();
    startGame('solo', ['ИГРОК']);
  });
  $('btn-endless').addEventListener('click', () => {
    state.sound.ui();
    startGame('endless', [state.leaderName || 'ИГРОК']);
  });
  $('btn-duel').addEventListener('click', () => showDuelSetup('duel'));
  $('btn-versus').addEventListener('click', () => showDuelSetup('versus'));
  $('btn-joint').addEventListener('click', () => {
    state.sound.ui();
    startGame('joint', ['ДУЭТ']);
  });
  $('btn-duel-back').addEventListener('click', () => {
    state.sound.ui();
    showMenu();
  });
  $('btn-duel-start').addEventListener('click', () => {
    const a = cleanName($('name1')?.value, 'ИГРОК 1');
    const b = cleanName($('name2')?.value, 'ИГРОК 2');
    state.sound.ui();
    startGame(state.setupMode === 'versus' ? 'versus' : 'duel', [a, b]);
  });

  for (const el of document.querySelectorAll('[data-sound]')) {
    el.addEventListener('click', toggleSound);
  }
  for (const el of document.querySelectorAll('[data-full]')) {
    el.addEventListener('click', toggleFullscreen);
  }

  $('btn-pause').addEventListener('click', pauseGame);
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-restart').addEventListener('click', () => {
    startGame(state.lastMode, state.lastNames);
  });
  $('btn-pause-menu').addEventListener('click', exitToMenu);

  $('btn-handoff-next').addEventListener('click', nextPlayer);
  $('btn-handoff-menu').addEventListener('click', exitToMenu);

  $('btn-again').addEventListener('click', () => {
    state.sound.ui();
    startGame(state.lastMode, state.lastNames);
  });
  $('btn-over-menu').addEventListener('click', () => {
    state.sound.ui();
    showMenu();
  });

  $('btn-leaders').addEventListener('click', showLeaders);
  $('btn-leaders-back').addEventListener('click', () => {
    state.sound.ui();
    showMenu();
  });
  $('btn-challenge-close').addEventListener('click', () => {
    const el = $('challenge-banner');
    if (el) el.hidden = true;
  });

  document.addEventListener('pointerdown', () => {
    if (state.sound.ctx) state.sound.resume();
  }, { capture: true });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (state.helpOpen) closeHelp();
      else if (state.screen === 'pause') resumeGame();
      else if (state.screen === 'game') pauseGame();
    }
    if (e.code === 'KeyD' && state.screen === 'game') {
      state.debug = !state.debug;
      showToast(state.debug ? 'Отладка включена' : 'Отладка выключена');
    }
  });
}

function cleanName(value, fallback) {
  return (String(value || '').trim().replace(/[<>]/g, '').slice(0, 14) || fallback).toUpperCase();
}

function toggleSound() {
  state.sound.init();
  state.sound.resume();
  state.soundOn = !state.soundOn;
  state.sound.setEnabled(state.soundOn);
  if (state.soundOn) state.sound.ui();
  savePrefs();
  syncSoundUI();
}

function syncSoundUI() {
  for (const el of document.querySelectorAll('[data-sound]')) {
    el.classList.toggle('is-off', !state.soundOn);
    el.setAttribute('aria-pressed', String(state.soundOn));
    const label = el.querySelector('.sound-label');
    if (label) label.textContent = state.soundOn ? 'ЗВУК' : 'БЕЗ ЗВУКА';
  }
}

async function toggleFullscreen() {
  state.sound.ui();
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  } catch (_) {
    showToast('Полный экран недоступен в этом браузере');
  }
  syncFullscreen();
}

function syncFullscreen() {
  const on = !!document.fullscreenElement;
  for (const el of document.querySelectorAll('[data-full]')) {
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', String(on));
  }
}

function showToast(text) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('on'), 2800);
}

function formatScore(n) {
  return new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.round(n || 0)));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/*  Цикл                                                              */
/* ------------------------------------------------------------------ */

function loop(now) {
  requestAnimationFrame(loop);
  const dt = state.loopAt ? Math.min(0.055, Math.max(0, (now - state.loopAt) / 1000)) : 0.016;
  state.loopAt = now;

  if (state.screen === 'game' && state.game && !state.paused) {
    if (!state.demo) detectPose(now);
    const sample = state.demo
      ? (state.game.mode === 'versus' || state.game.mode === 'joint' ? makeDemoMultiSample(now, dt) : makeDemoSample(now, dt))
      : makeSample(now);
    state.lastSample = sample;
    smoothAnchor(sample);
    state.game.update(dt, sample);
    processGameEvents();
    syncPhase();
    updateTargetProgress();
    updateHud(false);
    state.scene.update(dt, sceneState());
  } else if (state.screen === 'pause') {
    // В паузе замирает и игра, и частицы.
  } else {
    state.scene.update(dt, sceneState());
  }

  draw();
}

function detectPose(now) {
  if (!state.engine.ready || !state.cameraOn || state.video.readyState < 2) return;
  const interval = 45;
  if (now - state.lastDetect < interval) return;
  state.lastDetect = now;
  const lms = state.engine.detect(state.video, now) || [];
  state.landmarks = lms.length ? lms : null;
  const multi = state.game && (state.game.mode === 'versus' || state.game.mode === 'joint');
  if (multi) {
    state.matcher.updateMulti(lms, state.videoRect, now);
  } else if (lms.length) {
    state.matcher.update(lms[0], state.videoRect, now);
  }
}

function makeSample(now) {
  const game = state.game;
  if (game && (game.mode === 'versus' || game.mode === 'joint')) {
    return makeMultiSample(now, game);
  }
  const fresh = state.matcher.isFresh(now, 430);
  const base = state.matcher.frame();
  let scored = { match: null, jointScores: {}, worst: null, valid: false };
  if (fresh && game?.pose && (game.phase === 'approach' || game.phase === 'hold')) {
    scored = state.matcher.score(game.pose);
  }
  return {
    visible: !!(fresh && base.visible),
    fullBody: !!(fresh && base.fullBody),
    bodyVisible: !!(fresh && base.bodyVisible),
    fresh,
    anchor: fresh ? base.anchor : null,
    points: fresh ? base.points : {},
    angles: base.angles,
    match: scored.match,
    rawMatch: scored.raw,
    jointScores: scored.jointScores,
    worst: scored.worst,
    updatedAt: base.updatedAt,
  };
}

function makeMultiSample(now, game) {
  const players = ['left', 'right'].map((side) => {
    const pf = state.matcher.personFrame(side);
    const fresh = !!pf && now - pf.updatedAt <= 430;
    const pose = game.pose;
    const scoring = pose && (game.phase === 'approach' || game.phase === 'hold');
    let scored = { match: null, raw: null, jointScores: {}, worst: null, valid: false };
    if (fresh && scoring) {
      const targetPose = game.mode === 'joint'
        ? { ...(side === 'left' ? pose.left : pose.right), id: `${pose.id}:${side}` }
        : pose;
      if (targetPose) scored = state.matcher.scorePerson(side, targetPose);
    }
    return {
      side,
      fresh,
      visible: !!(fresh && pf.visible),
      fullBody: !!(fresh && pf.fullBody),
      bodyVisible: !!(fresh && pf.bodyVisible),
      anchor: fresh ? pf.anchor : null,
      points: fresh ? pf.points : {},
      angles: pf ? pf.angles : {},
      match: scored.match,
      rawMatch: scored.raw,
      jointScores: scored.jointScores,
      worst: scored.worst,
      updatedAt: pf ? pf.updatedAt : 0,
    };
  });
  const matches = players.map((p) => p.match).filter((m) => typeof m === 'number' && Number.isFinite(m));
  const match = matches.length ? matches.reduce((a, b) => a + b, 0) / matches.length : null;
  return {
    fresh: players.some((p) => p.fresh),
    visible: players.some((p) => p.visible),
    fullBody: players.every((p) => p.fullBody),
    bodyVisible: players.some((p) => p.bodyVisible),
    players,
    match,
    jointScores: {},
    worst: null,
    updatedAt: now,
  };
}

function smoothAnchor(sample) {
  if (!sample.fullBody || !sample.anchor) return;
  const next = sample.anchor;
  if (!state.anchorSmooth) {
    state.anchorSmooth = { ...next };
  } else {
    const k = 0.18;
    state.anchorSmooth.x += (next.x - state.anchorSmooth.x) * k;
    state.anchorSmooth.groundY += (next.groundY - state.anchorSmooth.groundY) * k;
    state.anchorSmooth.scale += (next.scale - state.anchorSmooth.scale) * k;
    state.anchorSmooth.bodyHeight += (next.bodyHeight - state.anchorSmooth.bodyHeight) * k;
  }
  if (state.phase === 'approach' && state.target) {
    state.target.anchor = { ...state.anchorSmooth };
  }
}

function updateTargetProgress() {
  if (!state.game) return;
  if (state.targets) {
    if (state.game.phase === 'approach') {
      const p = Math.max(0, Math.min(1, state.game.phaseTime / state.game.durations.approach));
      state.targets.forEach((t, i) => {
        t.progress = p;
        const a = state.lastSample?.players?.[i]?.anchor;
        if (a) t.anchor = { ...a };
      });
    } else if (state.game.phase === 'hold') {
      state.targets.forEach((t) => { t.progress = 1; });
    }
    return;
  }
  if (!state.target) return;
  if (state.game.phase === 'approach') {
    state.target.progress = Math.max(0, Math.min(1, state.game.phaseTime / state.game.durations.approach));
    if (state.anchorSmooth) state.target.anchor = { ...state.anchorSmooth };
  } else if (state.game.phase === 'hold') {
    state.target.progress = 1;
  }
}

function syncPhase() {
  if (!state.game) return;
  state.phase = state.game.phase;
}

function sceneState() {
  let mode = 'menu';
  if (state.screen === 'intro') mode = 'intro';
  else if (state.screen === 'game' || state.screen === 'pause') mode = 'game';
  else if (state.screen === 'over') mode = 'over';
  const holdFade = state.game && state.phase === 'hold'
    ? Math.max(0, Math.min(1, state.game.phaseTime / 0.9))
    : 0;
  return {
    mode,
    phase: state.phase,
    videoRect: state.videoRect,
    target: state.target,
    targets: state.targets,
    sample: state.lastSample,
    holdFade,
  };
}

function draw() {
  const ctx = state.ctx;
  if (!ctx) return;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  state.scene.draw(ctx, sceneState());
}

/* ------------------------------------------------------------------ */
/*  События игры                                                      */
/* ------------------------------------------------------------------ */

function processGameEvents() {
  if (!state.game) return;
  for (const ev of state.game.drainEvents()) {
    if (ev.type === 'player_start') {
      enterPrep();
      continue;
    }
    if (ev.type === 'round') {
      state.phase = 'approach';
      const multi = state.game.mode === 'versus' || state.game.mode === 'joint';
      if (multi) {
        const specFor = (side) => ev.pose.joint
          ? { ...(side === 'left' ? ev.pose.left : ev.pose.right), id: `${ev.pose.id}:${side}`, name: ev.pose.name, hint: ev.pose.hint, diff: ev.pose.diff, pass: ev.pose.pass }
          : ev.pose;
        state.targets = ['left', 'right'].map((side, i) => ({
          pose: specFor(side),
          anchor: state.lastSample?.players?.[i]?.anchor || fallbackAnchor(),
          progress: 0,
          side,
        }));
        state.target = null;
      } else {
        const anchor = state.anchorSmooth ? { ...state.anchorSmooth } : fallbackAnchor();
        state.target = { pose: ev.pose, anchor, progress: 0 };
        state.targets = null;
      }
      $('prep').hidden = true;
      $('verdict').hidden = true;
      $('panel').hidden = false;
      $('big-state').hidden = false;
      $('detect-hint').hidden = true;
      state.countShown = null;
      renderPoseMini($('pose-mini'), ev.pose);
      $('pose-name').textContent = ev.pose.name;
      $('pose-hint').textContent = ev.pose.hint;
      $('pose-diff').textContent = '●'.repeat(ev.pose.diff) + '○'.repeat(3 - ev.pose.diff);
      state.sound.whoosh();
      continue;
    }
    if (ev.type === 'lock') {
      state.phase = 'hold';
      if (state.targets) {
        state.targets.forEach((t, i) => {
          t.progress = 1;
          const a = state.lastSample?.players?.[i]?.anchor;
          if (a) t.anchor = { ...a };
        });
      } else if (state.target) {
        state.target.progress = 1;
        if (state.anchorSmooth) state.target.anchor = { ...state.anchorSmooth };
      }
      state.scene.flash = 0.18;
      state.scene.flashColor = '255,209,102';
      state.sound.lock();
      continue;
    }
    if (ev.type === 'impact') {
      state.phase = 'impact';
      capturePhoto();
      onImpact(ev);
      continue;
    }
    if (ev.type === 'handoff') {
      showHandoff(ev);
      continue;
    }
    if (ev.type === 'player_finished') {
      continue;
    }
    if (ev.type === 'game_over') {
      showResults(state.game);
    }
  }
}

function fallbackAnchor() {
  const r = state.videoRect;
  return {
    x: r.x + r.w / 2,
    groundY: r.y + r.h * 0.93,
    scale: (r.h * 0.7) / MODEL_HEIGHT,
    bodyHeight: r.h * 0.7,
  };
}

function onImpact(ev) {
  if (ev.versus) {
    onImpactVersus(ev);
    return;
  }
  const anchor = state.target?.anchor || state.targets?.[0]?.anchor || fallbackAnchor();
  const cx = anchor.x;
  const cy = anchor.groundY - Math.min(anchor.bodyHeight * 0.5, state.h * 0.35);
  state.scene.impact(cx, cy, ev.passed);
  state.sound.impact(ev.passed);
  if (!ev.passed) state.sound.heartLost();

  const verdict = $('verdict');
  verdict.hidden = false;
  verdict.classList.remove('is-pass', 'is-fail');
  verdict.classList.add(ev.passed ? 'is-pass' : 'is-fail');
  $('verdict-title').textContent = ev.passed ? 'ЧИСТО' : 'ЗАДЕТО';
  $('verdict-acc').textContent = `${Math.round(ev.accuracy * 100)}%`;
  $('verdict-threshold').textContent = `порог ${Math.round(ev.threshold * 100)}%`;
  $('verdict-points').textContent = ev.passed ? `+${formatScore(ev.points)}` : '−1 ЖИЗНЬ';
  $('verdict-note').textContent = ev.passed
    ? `Тень прошла сквозь тебя${ev.comboAfter > 1 ? ` · серия ×${ev.comboAfter}` : ''}`
    : worstHint(ev.pose);
  $('panel').hidden = true;
  $('big-state').hidden = true;
  if (ev.passed) {
    state.scene.flash = 0.32;
    state.scene.flashColor = '150,255,220';
  }
  bump(verdict, 1.04);
}

function onImpactVersus(ev) {
  const results = ev.results || [];
  const anyPass = results.some((r) => r.passed);
  const allPass = results.every((r) => r.passed);
  const anchor = state.targets?.[0]?.anchor || fallbackAnchor();
  const cx = anchor.x;
  const cy = anchor.groundY - Math.min(anchor.bodyHeight * 0.5, state.h * 0.35);
  state.scene.impact(cx, cy, anyPass);
  state.sound.impact(anyPass);

  const verdict = $('verdict');
  verdict.hidden = false;
  verdict.classList.remove('is-pass', 'is-fail');
  verdict.classList.add(anyPass ? 'is-pass' : 'is-fail');
  $('verdict-title').textContent = allPass ? 'ОБА ЧИСТО' : anyPass ? 'ЧИСТО И ЗАДЕТО' : 'ОБА ЗАДЕТО';
  $('verdict-acc').textContent = results.map((r) => `${Math.round(r.accuracy * 100)}%`).join(' · ');
  $('verdict-threshold').textContent = `порог ${Math.round(ev.pose.pass * 100)}%`;
  $('verdict-points').textContent = results.map((r) => (r.passed ? `+${formatScore(r.points)}` : '−1')).join(' / ');
  $('verdict-note').textContent = results.map((r) => `${r.name}: ${r.passed ? 'чисто' : 'задето'}`).join(' · ');
  $('panel').hidden = true;
  $('big-state').hidden = true;
  if (anyPass) {
    state.scene.flash = 0.32;
    state.scene.flashColor = '150,255,220';
  }
  bump(verdict, 1.04);
}

function worstHint(pose) {
  const w = state.lastSample?.worst;
  if (w && w.score < 0.55) return `Слабое место: ${w.label.toLowerCase()}`;
  return `Сверься с подсказкой: ${pose.hint.toLowerCase()}`;
}

function showHandoff(ev) {
  state.screen = 'handoff';
  state.phase = 'handoff';
  state.paused = false;
  state.target = null;
  state.scene.reset();
  setHud(false);
  document.body.dataset.mode = 'handoff';
  openScreen('screen-handoff');
  const p = ev.playerData;
  $('handoff-kicker').textContent = `ХОД 1 / 2 ЗАВЕРШЁН`;
  $('handoff-title').textContent = 'ПЕРЕДАЙ ТЕНЬ';
  $('handoff-sub').textContent = `Теперь очередь: ${ev.nextName}`;
  $('handoff-score').textContent = formatScore(p.score);
  $('handoff-stats').textContent = `${p.passed} из ${state.game?.roundsTotal || ROUNDS} теней · точность ${Math.round(p.avgAccuracy * 100)}%`;
  $('handoff-next-name').textContent = ev.nextName;
  $('btn-handoff-next').textContent = `Я — ${ev.nextName}`;
  state.sound.handoff();
}

function showResults(game) {
  if (!game) return;
  state.screen = 'over';
  state.phase = 'over';
  state.paused = false;
  state.target = null;
  $('prep').hidden = true;
  $('verdict').hidden = true;
  $('panel').hidden = true;
  $('big-state').hidden = true;
  setHud(false);
  document.body.dataset.mode = 'over';
  openScreen('screen-over');
  state.sound.duck(false);

  const title = $('result-title');
  const sub = $('result-sub');
  const body = $('result-body');
  const again = $('btn-again');

  if (game.mode === 'solo' || game.mode === 'endless') {
    const p = game.players[0];
    const endless = game.mode === 'endless';
    const isRecord = p.score > state.bestSolo;
    if (isRecord) state.bestSolo = p.score;
    savePrefs();
    updateBestLabels();
    const avg = Math.round(p.avgAccuracy * 100);
    const rank = avg >= 85 ? 'МАСТЕР ТЕНИ' : avg >= 72 ? 'ТЕНЕВОЙ АКТЁР' : avg >= 58 ? 'УЧЕНИК ТЕНИ' : 'ГОСТЬ СЦЕНЫ';
    title.textContent = p.lives <= 0 ? 'ТЕНЬ ОКАЗАЛАСЬ БЫСТРЕЕ' : 'ТЕНЬ ПРОЙДЕНА';
    const passedTxt = endless ? `${p.rounds.length}` : `${p.passed}/${game.roundsTotal}`;
    sub.textContent = endless
      ? `${p.rounds.length} теней · средняя точность ${avg}%${isRecord ? ' · новый рекорд' : ''}`
      : `${p.passed} из ${game.roundsTotal} теней · средняя точность ${avg}%${isRecord ? ' · новый рекорд' : ''}`;
    body.innerHTML = `
      <div class="score-plaque">
        <span class="score-plaque__label">ИТОГОВЫЙ СЧЁТ</span>
        <strong class="score-plaque__value">${formatScore(p.score)}</strong>
        <span class="score-plaque__rank">${rank}</span>
      </div>
      <div class="result-grid">
        <div><b>${passedTxt}</b><span>теней пройдено</span></div>
        <div><b>${avg}%</b><span>точность</span></div>
        <div><b>${p.bestCombo}</b><span>лучшая серия</span></div>
        <div><b>${formatScore(state.bestSolo)}</b><span>рекорд</span></div>
      </div>
      ${leaderSaveHtml(p, endless)}
      ${challengeHtml(p, endless)}
      ${photosHtml()}`;
    const saveBtn = document.getElementById('btn-leader-save');
    if (saveBtn) saveBtn.addEventListener('click', () => saveLeaderScore(p, endless));
    const shareBtn = document.getElementById('btn-share');
    if (shareBtn) shareBtn.addEventListener('click', () => shareChallenge(endless ? 'endless' : 'solo', p.score, state.leaderName || 'ИГРОК'));
    again.textContent = 'ЕЩЁ РАЗ';
    if (p.lives <= 0) state.sound.lose();
    else state.sound.win();
  } else if (game.mode === 'joint') {
    const p = game.players[0];
    const avg = Math.round(p.avgAccuracy * 100);
    title.textContent = p.lives <= 0 ? 'ТЕНЬ ОКАЗАЛАСЬ БЫСТРЕЕ' : 'ТЕНЬ ПРОЙДЕНА';
    sub.textContent = `${p.passed} из ${game.roundsTotal} совместных поз · точность ${avg}%`;
    body.innerHTML = `
      <div class="score-plaque">
        <span class="score-plaque__label">СОВМЕСТНЫЙ СЧЁТ</span>
        <strong class="score-plaque__value">${formatScore(p.score)}</strong>
        <span class="score-plaque__rank">ДУЭТ</span>
      </div>
      <div class="result-grid">
        <div><b>${p.passed}/${game.roundsTotal}</b><span>поз пройдено</span></div>
        <div><b>${avg}%</b><span>точность</span></div>
        <div><b>${p.bestCombo}</b><span>лучшая серия</span></div>
        <div><b>${p.lives}</b><span>жизней</span></div>
      </div>
      ${photosHtml()}`;
    again.textContent = 'ЕЩЁ РАЗ';
    if (p.lives <= 0) state.sound.lose();
    else state.sound.win();
  } else {
    const [a, b] = game.players;
    title.textContent = game.isDraw ? 'НИЧЬЯ' : `${game.winner.name} ПОБЕЖДАЕТ`;
    sub.textContent = game.isDraw ? 'Тени не смогли выбрать сильнейшего' : 'Больше очков — больше власти над тенью';
    body.innerHTML = `
      <div class="duel-result">
        ${duelRow(a, game, game.winner === a)}
        <div class="duel-vs">VS</div>
        ${duelRow(b, game, game.winner === b)}
      </div>
      <div class="result-grid result-grid--duel">
        <div><b>${game.roundsTotal}</b><span>теней у каждого</span></div>
        <div><b>${Math.round(Math.max(a.avgAccuracy, b.avgAccuracy) * 100)}%</b><span>лучшая точность</span></div>
        <div><b>${Math.max(a.bestCombo, b.bestCombo)}</b><span>лучшая серия</span></div>
      </div>
      ${photosHtml()}`;
    again.textContent = 'РЕВАНШ';
    state.sound.win();
  }

  state.scene.burst(state.w / 2, state.h * 0.4, 70, ['#ffd166', '#79f7ff', '#bfff3c', '#ffffff'], 420);
}

function duelRow(p, game, winner) {
  return `
    <div class="duel-row ${winner ? 'is-winner' : ''}">
      <div class="duel-row__head">
        <span>${escapeHtml(p.name)}</span>
        ${winner ? '<b class="winner-mark">ПОБЕДА</b>' : ''}
      </div>
      <strong>${formatScore(p.score)}</strong>
      <small>${p.passed}/${game.roundsTotal} теней · ${Math.round(p.avgAccuracy * 100)}%</small>
    </div>`;
}

function leaderSaveHtml(p, endless) {
  if (!p.score) return '';
  return `
    <div class="leader-save">
      <div class="leader-save__head">
        <span>ЗАПИШИ СВОЙ РЕЗУЛЬТАТ В ОБЩУЮ ТАБЛИЦУ</span>
        <b>${formatScore(p.score)}</b>
      </div>
      <div class="leader-save__row">
        <input id="leader-name" maxlength="14" value="${escapeHtml(state.leaderName)}" autocomplete="off" spellcheck="false" />
        <button id="btn-leader-save" class="btn btn--primary">СОХРАНИТЬ</button>
      </div>
      <p id="leader-save-msg" class="micro-note" hidden></p>
    </div>`;
}

async function saveLeaderScore(p, endless) {
  const input = document.getElementById('leader-name');
  const name = cleanName(input?.value, 'ИГРОК');
  state.leaderName = name;
  savePrefs();
  const btn = document.getElementById('btn-leader-save');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'СОХРАНЯЮ…';
  }
  if (input) input.disabled = true;
  const msg = document.getElementById('leader-save-msg');
  let saved = false;
  try {
    saved = await saveScore({
      name,
      score: p.score,
      mode: endless ? 'endless' : 'solo',
      rounds: p.rounds.length,
      accuracy: Math.round(p.avgAccuracy * 100),
    });
  } catch (_) {
    saved = false;
  }
  if (msg) {
    msg.hidden = false;
    msg.textContent = saved ? 'Сохранено в общую таблицу лидеров' : 'Сохранено локально (нет сети)';
  }
  if (btn) btn.textContent = 'СОХРАНЕНО';
}

async function showLeaders() {
  hidePrimary();
  state.screen = 'leaders';
  state.phase = 'idle';
  state.game = null;
  state.target = null;
  state.paused = false;
  document.body.dataset.mode = 'leaders';
  openScreen('screen-leaders');
  setHud(false);
  const body = $('leaders-body');
  body.innerHTML = '<p class="leaders-empty">Загружаю таблицу…</p>';
  const board = await loadBoard();
  if (!board.length) {
    body.innerHTML = '<p class="leaders-empty">Пока пусто. Сыграйте в «СОЛО» или «БЕСКОНЕЧНЫЙ», чтобы попасть в таблицу.</p>';
  } else {
    body.innerHTML = board.map((e, i) => `
      <div class="leader-row${i === 0 ? ' is-top' : ''}">
        <span class="leader-rank">${i + 1}</span>
        <div class="leader-main">
          <span class="leader-name">${escapeHtml(e.name)}</span>
          <span class="leader-meta">${e.mode === 'endless' ? 'БЕСКОНЕЧНЫЙ' : 'СОЛО'} · ${e.rounds} теней · ${e.accuracy}%</span>
        </div>
        <b class="leader-score">${formatScore(e.score)}</b>
      </div>`).join('');
  }
  state.sound.ui();
}

function parseChallenge() {
  try {
    const raw = new URLSearchParams(location.search).get('challenge');
    if (!raw) return null;
    const o = JSON.parse(decodeURIComponent(raw));
    if (!o || typeof o.s !== 'number') return null;
    return {
      mode: o.m === 'endless' ? 'endless' : 'solo',
      score: Math.max(0, Math.round(o.s)),
      name: String(o.n || 'Друг').trim().slice(0, 14) || 'Друг',
    };
  } catch (_) {
    return null;
  }
}

function challengeLink(mode, score, name) {
  const payload = encodeURIComponent(JSON.stringify({
    m: mode === 'endless' ? 'endless' : 'solo',
    s: Math.round(score || 0),
    n: String(name || 'ИГРОК').trim().slice(0, 14) || 'ИГРОК',
  }));
  return `${location.origin}${location.pathname}?challenge=${payload}`;
}

async function shareChallenge(mode, score, name) {
  const url = challengeLink(mode, score, name);
  const text = `Побей мой рекорд в СИЛУЭТ: ${formatScore(score)} очков (${mode === 'endless' ? 'бесконечный' : 'соло'})`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'СИЛУЭТ — вызов', text, url });
      return;
    }
  } catch (_) {
    /* пользователь отменил — пробуем буфер */
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    showToast('Ссылка на вызов скопирована');
  } catch (_) {
    showToast(`Скопируй ссылку: ${url}`);
  }
}

function challengeHtml(p, endless) {
  const c = state.challenge;
  const mode = endless ? 'endless' : 'solo';
  const beat = c && c.mode === mode && p.score > c.score;
  return `
    <div class="challenge-block">
      ${beat ? `<p class="challenge-beat">🎉 Ты побил рекорд ${escapeHtml(c.name)} — ${formatScore(c.score)}!</p>` : ''}
      <button id="btn-share" class="btn btn--ghost">ПОДЕЛИТЬСЯ ВЫЗОВОМ</button>
    </div>`;
}

function updateChallengeBanner() {
  const el = $('challenge-banner');
  if (!el) return;
  const c = state.challenge;
  if (c) {
    el.hidden = false;
    setText('challenge-text', `Вызов от ${c.name}: побей ${formatScore(c.score)} очков в «${c.mode === 'endless' ? 'БЕСКОНЕЧНЫЙ' : 'СОЛО'}»`);
  } else {
    el.hidden = true;
  }
}

function capturePhoto() {
  const v = state.video;
  if (!v || v.readyState < 2 || !v.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    state.photos.push({ url, round: state.game ? state.game.roundNumber : state.photos.length + 1 });
  }, 'image/jpeg', 0.88);
}

function photosHtml() {
  const photos = state.photos || [];
  if (!photos.length) return '';
  const items = photos.map((p) => `<div class="photo-item"><img src="${p.url}" alt="Снимок позы ${p.round}" /></div>`).join('');
  return `
    <div class="photo-gallery">
      <div class="photo-gallery__head">
        <span>ТВОИ СНИМКИ</span>
        <b>${photos.length}</b>
      </div>
      <div class="photo-gallery__grid">${items}</div>
      <div class="photo-cta">
        <img src="qrcode.png" alt="QR-код Телеграм" class="photo-cta__qr" />
        <p>Хочешь эти фото? Забери их в <a href="https://t.me/qpokycnow" target="_blank" rel="noopener">ТГ</a><br /><small>выдача через бота — скоро</small></p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  HUD                                                               */
/* ------------------------------------------------------------------ */

function updateHud(force) {
  const game = state.game;
  if (!game || (state.screen !== 'game' && state.screen !== 'pause')) return;
  const p = game.currentPlayer;
  if (!p) return;
  const sample = state.lastSample || {};
  const cache = state.hudCache;

  if (game.mode === 'versus') {
    const [a, b] = game.players;
    setText('hud-player', `${a.name} · ${b.name}`);
    setText('hud-role', 'ДУЭЛЬ ×2');
    setText('hud-score', `${formatScore(a.score)} : ${formatScore(b.score)}`);
    setText('hud-round', `${game.roundNumber} / ${game.roundsTotal}`);
    const lives = (q) => '◆'.repeat(q.lives) + '◇'.repeat(Math.max(0, 3 - q.lives));
    $('hud-lives').innerHTML = `<span class="lives-pair">${lives(a)}</span><span class="lives-pair">${lives(b)}</span>`;
    $('hud-combo').hidden = true;
  } else {
    const role = game.mode === 'duel' ? `ДУЭЛЬ · ХОД ${game.activePlayer + 1}/2` : game.mode === 'endless' ? 'БЕСКОНЕЧНЫЙ' : game.mode === 'joint' ? 'СОВМЕСТНО' : 'СОЛО';
    setText('hud-player', p.name);
    setText('hud-role', role);
    setText('hud-score', formatScore(p.score));
    setText('hud-round', game.mode === 'endless' ? `${game.roundNumber}` : `${game.roundNumber} / ${game.roundsTotal}`);

    const combo = $('hud-combo');
    if (p.combo > 0) {
      combo.hidden = false;
      setText('hud-combo', `СЕРИЯ ×${p.combo}`);
    } else {
      combo.hidden = true;
    }

    if (cache.livesKey !== `${p.lives}:${p.name}`) {
      cache.livesKey = `${p.lives}:${p.name}`;
      $('hud-lives').innerHTML = Array.from({ length: 3 }, (_, i) => `<i class="life ${i < p.lives ? 'is-on' : ''}"></i>`).join('');
    }
  }

  const phase = game.phase;
  const prep = $('prep');
  const panel = $('panel');
  const big = $('big-state');
  const verdict = $('verdict');

  if (phase === 'prep') {
    prep.hidden = false;
    panel.hidden = true;
    big.hidden = true;
    verdict.hidden = true;
    updatePrepUi(sample);
    setText('hud-state', 'ПОДГОТОВКА');
  } else {
    prep.hidden = true;
  }

  if (phase === 'approach' || phase === 'hold') {
    panel.hidden = false;
    big.hidden = false;
    const m = typeof sample.match === 'number' ? Math.round(sample.match * 100) : null;
    const passPct = game.pose ? Math.round(game.pose.pass * 100) : 65;
    const isHold = phase === 'hold';
    const tone = m != null && m >= passPct ? 'pass' : m != null && m < passPct - 15 ? 'fail' : 'warn';
    panel.dataset.tone = isHold ? tone : 'idle';
    setText('match-val', isHold && m != null ? `${m}%` : '—');
    $('match-fill').style.width = `${isHold && m != null ? m : 0}%`;
    $('pass-mark').style.left = `${passPct}%`;
    setText('pass-label', `ПОРОГ ${passPct}%`);

    const pProgress = game.phase === 'approach' ? game.phaseTime / game.durations.approach : game.phaseTime / game.durations.hold;
    const remaining = game.phase === 'approach' ? game.durations.approach - game.phaseTime : game.durations.hold - game.phaseTime;
    setClock(Math.max(0, Math.min(1, pProgress)), Math.max(0, remaining));
    setText('hold-label', isHold ? 'УДЕРЖИ ПОЗУ' : 'ТЕНЬ ПРИБЛИЖАЕТСЯ');

    let tip = isHold ? 'Повтори позу и не двигайся' : 'Приготовься повторить позу';
    if (isHold) {
      if (!sample.fresh || !sample.fullBody) tip = 'Встань целиком в кадр — таймер ждёт';
      else if (m != null && m >= passPct) tip = 'Есть контакт — держи';
      else if (sample.worst) tip = `Поправь: ${sample.worst.label.toLowerCase()}`;
    } else if (!sample.fresh || !sample.fullBody) {
      tip = 'Встань целиком в кадр';
    }
    setText('form-tip', tip);

    let bigTitle = '';
    if (phase === 'approach') {
      bigTitle = game.progress < 0.55 ? 'ТЕНЬ ИДЁТ' : 'ПРИГОТОВЬСЯ';
    } else {
      bigTitle = 'ЗАМРИ';
    }
    big.hidden = false;
    big.classList.toggle('is-hold', phase === 'hold');
    setText('big-state', bigTitle);
    setText('hud-state', phase === 'hold' ? 'КОНТАКТ' : 'ТЕНЬ');
  }

  if (phase === 'impact') {
    prep.hidden = true;
    panel.hidden = true;
    big.hidden = true;
    verdict.hidden = false;
  }

  const lost = (phase === 'approach' || phase === 'hold') && (!sample.fresh || !sample.bodyVisible);
  const hint = $('detect-hint');
  if (lost) {
    hint.hidden = false;
    hint.textContent = sample.fresh && sample.bodyVisible && !sample.fullBody
      ? 'НУЖНЫ СТОПЫ И РУКИ В КАДРЕ'
      : 'ВАС НЕ ВИДНО — ВСТАНЬТЕ В КАДР';
  } else {
    hint.hidden = true;
  }

  if (force) {
    // force используется после смены фазы: тексты уже обновлены выше.
    void force;
  }
}

function updatePrepUi(sample) {
  const ready = !!(sample.fresh && sample.fullBody);
  const n = Math.max(1, Math.ceil(PREP_TIME - (state.game.phaseTime || 0)));
  $('prep').classList.toggle('waiting', !ready);
  $('prep-title').textContent = ready ? 'ПРИГОТОВЬТЕСЬ' : 'ВСТАНЬТЕ В КАДР';
  $('prep-sub').textContent = !sample.bodyVisible
    ? 'Я не вижу вас. Включите свет и встаньте напротив камеры.'
    : ready
      ? 'Тень уже рядом. Смотрите на позу.'
      : 'В кадре должны быть голова, руки и обе стопы.';
  if ($('prep-count').textContent !== String(n)) {
    $('prep-count').textContent = String(n);
    if (ready) bump($('prep-count'), 1.16);
  }
  if (ready && state.countShown !== n) {
    state.countShown = n;
    state.sound.countdown(n);
  }
}

function setClock(progress, remain) {
  const ring = $('clock');
  if (ring) ring.style.setProperty('--p', String(progress));
  const text = remain >= 10 ? String(Math.ceil(remain)) : Math.max(0, remain).toFixed(1);
  setText('clock-num', text);
  setText('clock-sub', state.phase === 'approach' ? 'до контакта' : 'удержание');
}

function setText(id, text) {
  const el = $(id);
  if (!el) return;
  if (el.textContent !== text) el.textContent = text;
}

function bump(el, scale = 1.08) {
  if (!el?.animate) return;
  el.animate(
    [{ transform: `scale(${scale})`, filter: 'brightness(1.6)' }, { transform: 'scale(1)', filter: 'brightness(1)' }],
    { duration: 280, easing: 'ease-out' },
  );
}

/* ------------------------------------------------------------------ */
/*  Демо без камеры                                                   */
/* ------------------------------------------------------------------ */

function makeDemoSample(now, dt) {
  state.demoTime += dt;
  const game = state.game;
  const pose = game?.pose && game.phase !== 'prep' && game.phase !== 'over' ? game.pose : NEUTRAL_POSE;
  const r = state.videoRect;
  const groundY = r.y + r.h * 0.79;
  const scale = Math.min((r.h * 0.62) / MODEL_HEIGHT, (r.w * 0.68) / MODEL_HEIGHT);
  const anchor = { x: r.x + r.w / 2, groundY, scale, bodyHeight: scale * MODEL_HEIGHT };
  const fig = buildFigure(pose);
  const point = (name) => {
    const q = fig.points[name];
    return {
      x: anchor.x + (q.x - fig.pivotX) * anchor.scale,
      y: anchor.groundY + (q.y - fig.bottom) * anchor.scale,
      valid: true,
      vis: 1,
    };
  };
  const pts = {};
  for (const key of ['nose', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR']) {
    const map = {
      nose: 'head',
      shL: 'shoulderL',
      shR: 'shoulderR',
      elL: 'elbowL',
      elR: 'elbowR',
      wrL: 'wristL',
      wrR: 'wristR',
      hipL: 'hipL',
      hipR: 'hipR',
      kneeL: 'kneeL',
      kneeR: 'kneeR',
      ankL: 'ankleL',
      ankR: 'ankleR',
    };
    pts[key] = point(map[key]);
  }
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, valid: true, vis: 1 });
  pts.shMid = mid(pts.shL, pts.shR);
  pts.hipMid = mid(pts.hipL, pts.hipR);
  pts.nose.y -= scale * 0.08;
  const hold = game && (game.phase === 'hold' || game.phase === 'impact');
  const match = hold ? Math.max(0, Math.min(1, 0.9 + Math.sin(now * 0.004) * 0.025)) : null;
  const scores = {};
  if (hold) {
    for (const key of ['armLUp', 'armRUp', 'armLFore', 'armRFore', 'legLUp', 'legRUp', 'legLFore', 'legRFore', 'torso']) {
      scores[key] = 0.88;
    }
  }
  return {
    visible: true,
    fullBody: true,
    bodyVisible: true,
    fresh: true,
    anchor,
    points: pts,
    angles: {},
    match,
    rawMatch: match,
    jointScores: scores,
    worst: hold ? { key: 'torso', label: 'КОРПУС', score: 0.88, err: 5 } : null,
    updatedAt: now,
  };
}

function makeDemoMultiSample(now, dt) {
  state.demoTime += dt;
  const game = state.game;
  const pose = game?.pose && game.phase !== 'prep' && game.phase !== 'over' ? game.pose : null;
  const r = state.videoRect;
  const hold = game && (game.phase === 'hold' || game.phase === 'impact');

  const players = ['left', 'right'].map((side) => {
    const spec = game?.mode === 'joint' && pose?.joint
      ? (side === 'left' ? pose.left : pose.right)
      : (pose || NEUTRAL_POSE);
    const scale = Math.min((r.h * 0.5) / MODEL_HEIGHT, (r.w * 0.4) / MODEL_HEIGHT);
    const anchor = {
      x: side === 'left' ? r.x + r.w * 0.3 : r.x + r.w * 0.7,
      groundY: r.y + r.h * 0.79,
      scale,
      bodyHeight: scale * MODEL_HEIGHT,
    };
    const fig = buildFigure(spec);
    const point = (name) => {
      const q = fig.points[name];
      return { x: anchor.x + (q.x - fig.pivotX) * anchor.scale, y: anchor.groundY + (q.y - fig.bottom) * anchor.scale, valid: true, vis: 1 };
    };
    const map = { nose: 'head', shL: 'shoulderL', shR: 'shoulderR', elL: 'elbowL', elR: 'elbowR', wrL: 'wristL', wrR: 'wristR', hipL: 'hipL', hipR: 'hipR', kneeL: 'kneeL', kneeR: 'kneeR', ankL: 'ankleL', ankR: 'ankleR' };
    const pts = {};
    for (const key of Object.keys(map)) pts[key] = point(map[key]);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, valid: true, vis: 1 });
    pts.shMid = mid(pts.shL, pts.shR);
    pts.hipMid = mid(pts.hipL, pts.hipR);
    pts.nose.y -= anchor.scale * 0.08;
    const match = hold ? 0.92 : null;
    const scores = {};
    if (hold) {
      for (const k of ['armLUp', 'armRUp', 'armLFore', 'armRFore', 'legLUp', 'legRUp', 'legLFore', 'legRFore', 'torso']) scores[k] = 0.9;
    }
    return { side, fresh: true, visible: true, fullBody: true, bodyVisible: true, anchor, points: pts, angles: {}, match, rawMatch: match, jointScores: scores, worst: null, updatedAt: now };
  });

  return {
    fresh: true,
    visible: true,
    fullBody: true,
    bodyVisible: true,
    players,
    match: hold ? 0.92 : null,
    jointScores: {},
    worst: null,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/*  Служебное                                                         */
/* ------------------------------------------------------------------ */

function onResize() {
  if (!state.canvas) return;
  state.w = Math.max(1, window.innerWidth);
  state.h = Math.max(1, window.innerHeight);
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.canvas.width = Math.round(state.w * state.dpr);
  state.canvas.height = Math.round(state.h * state.dpr);
  state.canvas.style.width = `${state.w}px`;
  state.canvas.style.height = `${state.h}px`;
  state.videoRect = computeVideoRect();
  state.scene.resize(state.w, state.h);
}

function computeVideoRect() {
  const v = state.video;
  if (!state.cameraOn || !v || !v.videoWidth || !v.videoHeight) {
    return { x: 0, y: 0, w: state.w, h: state.h };
  }
  const s = Math.min(state.w / v.videoWidth, state.h / v.videoHeight);
  const w = v.videoWidth * s;
  const h = v.videoHeight * s;
  return { x: (state.w - w) / 2, y: (state.h - h) / 2, w, h };
}

let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch (_) {
    wakeLock = null;
  }
}

function onVisibility() {
  if (document.hidden && state.screen === 'game' && !state.paused) pauseGame();
  if (!document.hidden && state.screen === 'game') requestWakeLock();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
