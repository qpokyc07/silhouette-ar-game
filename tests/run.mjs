/**
 * Автотесты без браузера:
 *   node tests/run.mjs
 *
 * Проверяют геометрию поз, матчинг по синтетическим точкам MediaPipe,
 * таймеры и сценарий соло/дуэли.
 */

import assert from 'node:assert/strict';
import {
  POSES,
  NEUTRAL_POSE,
  MODEL_HEIGHT,
  buildFigure,
  targetAngles,
  deckFor,
  blendPose,
  angleDiff,
  JOINT_POSES,
} from '../js/poses.js';
import { PoseMatcher, IDX } from '../js/matcher.js';
import { SilhouetteGame, PREP_TIME, IMPACT_TIME } from '../js/game.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  OK   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
}

function makeLandmarks(pose, anchor, rect = { x: 0, y: 0, w: 1000, h: 800 }) {
  const fig = buildFigure(pose);
  const screen = (q) => ({
    x: anchor.x + (q.x - fig.pivotX) * anchor.scale,
    y: anchor.groundY + (q.y - fig.bottom) * anchor.scale,
  });
  const toNorm = (q) => {
    const s = screen(q);
    return {
      x: 1 - (s.x - rect.x) / rect.w,
      y: (s.y - rect.y) / rect.h,
      z: 0,
      visibility: 0.99,
    };
  };
  const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
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
  for (const [key, index] of Object.entries(IDX)) {
    arr[index] = toNorm(fig.points[map[key]]);
  }
  return arr;
}

const anchor = { x: 500, groundY: 720, scale: 130, bodyHeight: 130 * MODEL_HEIGHT };
const rect = { x: 0, y: 0, w: 1000, h: 800 };
const now = () => performance.now();

console.log('\nГеометрия поз');

test('все позы строятся и дают конечные углы', () => {
  for (const pose of POSES) {
    const fig = buildFigure(pose);
    for (const value of Object.values(fig.points)) {
      assert.ok(Number.isFinite(value.x) && Number.isFinite(value.y), pose.id);
    }
    for (const [key, value] of Object.entries(targetAngles(pose))) {
      assert.ok(Number.isFinite(value), `${pose.id}.${key}`);
    }
    assert.ok(fig.bounds.width > 1);
    assert.ok(fig.bounds.height > 2);
  }
});

test('углы сравниваются по короткой дуге', () => {
  assert.equal(angleDiff(350, 10), -20);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(270, 270), 0);
});

test('deckFor собирает 5 теней без повторов и с ростом сложности', () => {
  let seed = 7;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const deck = deckFor(5, rng);
  assert.equal(deck.length, 5);
  assert.equal(new Set(deck.map((p) => p.id)).size, 5);
  assert.deepEqual(deck.map((p) => p.diff), [1, 1, 2, 2, 3]);
});

test('blendPose не ломает углы', () => {
  const b = blendPose(POSES[0], POSES[1], 0.5);
  assert.ok(Number.isFinite(b.torso));
  assert.ok(Number.isFinite(b.arms.L[0]));
  assert.ok(Number.isFinite(b.legs.R[1]));
});

console.log('\nМатчинг');

test('матчер узнаёт точную позу', () => {
  const matcher = new PoseMatcher();
  const lm = makeLandmarks(POSES[0], anchor, rect);
  let score = 0;
  for (let i = 0; i < 24; i++) {
    matcher.update(lm, rect, now());
    score = matcher.score(POSES[0]).match;
  }
  assert.ok(score > 0.93, `score=${score}`);
  const frame = matcher.update(lm, rect, now());
  assert.equal(frame.fullBody, true);
  assert.ok(frame.anchor);
  assert.ok(Math.abs(frame.anchor.scale - anchor.scale) / anchor.scale < 0.1);
});

test('матчер видит разницу между T-позой и руками вниз', () => {
  const matcher = new PoseMatcher();
  const lm = makeLandmarks(NEUTRAL_POSE, anchor, rect);
  let score = 0;
  for (let i = 0; i < 24; i++) {
    matcher.update(lm, rect, now());
    score = matcher.score(POSES[0]).match;
  }
  assert.ok(score < 0.78, `score=${score}`);
});

test('без точек матчер не выдаёт ложную позу', () => {
  const matcher = new PoseMatcher();
  matcher.update(null, rect, now());
  const res = matcher.score(POSES[0]);
  assert.equal(res.match, null);
  assert.equal(matcher.fullBody, false);
});

console.log('\nИгровой цикл');

const sample = (match = 1, fullBody = true) => ({
  visible: fullBody,
  fullBody,
  fresh: true,
  match,
});

function step(game, seconds, match = 1, fullBody = true, events = []) {
  const frames = Math.ceil(seconds / 0.05);
  for (let i = 0; i < frames; i++) {
    game.update(0.05, sample(match, fullBody));
    events.push(...game.drainEvents());
  }
  return events;
}

test('подготовка ждёт, пока игрок попадёт в кадр целиком', () => {
  const game = new SilhouetteGame().start('solo', { rounds: 5, rng: () => 0.3 });
  step(game, 1, 1, false);
  assert.equal(game.phase, 'prep');
  assert.equal(game.phaseTime, 0);
  step(game, PREP_TIME + 0.1, 1, true);
  assert.equal(game.phase, 'approach');
});

test('соло: 5 успешных теней, счёт и финал', () => {
  const game = new SilhouetteGame().start('solo', { rounds: 5, rng: () => 0.2 });
  const events = [];
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 2000) {
    game.update(0.05, sample(1, true));
    events.push(...game.drainEvents());
  }
  assert.equal(game.phase, 'over');
  assert.equal(game.players[0].passed, 5);
  assert.equal(game.players[0].lives, 3);
  assert.ok(game.players[0].score > 5000);
  assert.ok(events.some((e) => e.type === 'game_over'));
  assert.equal(events.filter((e) => e.type === 'impact').length, 5);
});

test('соло: три промаха заканчивают партию раньше', () => {
  const game = new SilhouetteGame().start('solo', { rounds: 5, rng: () => 0.1 });
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 2000) game.update(0.05, sample(0.1, true));
  assert.equal(game.phase, 'over');
  assert.equal(game.players[0].lives, 0);
  assert.equal(game.players[0].passed, 0);
  assert.ok(game.players[0].rounds.length <= 5);
});

test('дуэль: передача хода и второй игрок', () => {
  const game = new SilhouetteGame().start('duel', {
    rounds: 5,
    names: ['АКА', 'КИРА'],
    rng: () => 0.25,
  });
  let guard = 0;
  while (game.phase !== 'handoff' && guard++ < 2000) game.update(0.05, sample(1, true));
  assert.equal(game.phase, 'handoff');
  assert.equal(game.players[0].name, 'АКА');
  assert.equal(game.nextPlayer(), true);
  assert.equal(game.activePlayer, 1);
  assert.equal(game.phase, 'prep');

  guard = 0;
  while (game.phase !== 'over' && guard++ < 2000) game.update(0.05, sample(1, true));
  assert.equal(game.phase, 'over');
  assert.equal(game.players[1].name, 'КИРА');
  assert.ok(game.players[0].score > 0);
});

test('impact длится фиксированное время', () => {
  const game = new SilhouetteGame().start('solo', { rounds: 5, rng: () => 0.4 });
  let guard = 0;
  while (game.phase !== 'hold' && guard++ < 400) game.update(0.05, sample(1, true));
  assert.equal(game.phase, 'hold');
  guard = 0;
  while (game.phase !== 'impact' && guard++ < 200) game.update(0.05, sample(1, true));
  assert.equal(game.phase, 'impact');
  step(game, IMPACT_TIME + 0.01, 1, true);
  assert.notEqual(game.phase, 'impact');
});

console.log('\nНовые режимы');

test('набор поз расширен: 30 одиночных и 10 парных', () => {
  assert.equal(POSES.length, 30);
  assert.equal(JOINT_POSES.length, 10);
  for (const p of JOINT_POSES) {
    assert.ok(p.joint, p.id);
    assert.ok(p.left && p.right, p.id);
    assert.ok(Number.isFinite(p.gap), p.id);
    assert.ok(Number.isFinite(p.left.torso) && Number.isFinite(p.right.torso), p.id);
    assert.ok(Number.isFinite(p.pass), p.id);
  }
});

const sample2 = (m0, m1, full0 = true, full1 = true) => ({
  fresh: full0 || full1,
  fullBody: full0 && full1,
  visible: full0 || full1,
  players: [
    { fresh: full0, fullBody: full0, visible: full0, match: m0 },
    { fresh: full1, fullBody: full1, visible: full1, match: m1 },
  ],
});

test('бесконечный режим не имеет потолка теней', () => {
  const game = new SilhouetteGame().start('endless', { rng: () => 0.5 });
  step(game, 75, 1, true);
  assert.notEqual(game.phase, 'over');
  assert.ok(game.players[0].rounds.length >= 7, `rounds=${game.players[0].rounds.length}`);
  assert.equal(game.players[0].lives, 3);
});

test('бесконечный режим завершается после трёх промахов', () => {
  const game = new SilhouetteGame().start('endless', { rng: () => 0.5 });
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 4000) {
    const fail = game.phase === 'hold';
    game.update(0.05, sample(fail ? 0.1 : 1, true));
  }
  assert.equal(game.phase, 'over');
  assert.equal(game.players[0].lives, 0);
  assert.equal(game.players[0].rounds.length, 3);
});

test('versus: два игрока одновременно, победитель по очкам', () => {
  const game = new SilhouetteGame().start('versus', { rounds: 5, names: ['АКА', 'КИРА'], rng: () => 0.2 });
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 4000) {
    const hold = game.phase === 'hold';
    game.update(0.05, sample2(1, hold ? 0.1 : 1, true, true));
  }
  assert.equal(game.phase, 'over');
  assert.ok(game.players[0].score > game.players[1].score, `p0=${game.players[0].score} p1=${game.players[1].score}`);
  assert.equal(game.winner, game.players[0]);
});

test('joint: совместная поза проходит с комбинированной точностью', () => {
  const game = new SilhouetteGame().start('joint', { rounds: 5, names: ['ДУЭТ'], rng: () => 0.3 });
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 4000) {
    const hold = game.phase === 'hold';
    game.update(0.05, sample2(hold ? 1 : 1, hold ? 1 : 1, true, true));
  }
  assert.equal(game.phase, 'over');
  assert.equal(game.players[0].passed, 5);
  assert.ok(game.players[0].score > 0);
});

console.log(`\nВсе тесты пройдены: ${passed}\n`);
