/**
 * Правила «СИЛУЭТА» без DOM и canvas.
 *
 * Режимы:
 *   solo    — один игрок, 5 теней, 3 жизни;
 *   duel    — два игрока по очереди;
 *   endless — бесконечная серия теней до потери жизней;
 *   versus  — два игрока одновременно, каждый против одной и той же тени;
 *   joint   — два игрока вместе собирают одну парную позу (совместный счёт).
 *
 * Раунд: prep → approach → hold → impact → следующий раунд.
 */

import { deckFor, POSES, JOINT_POSES } from './poses.js';

export const PREP_TIME = 3.0;
export const IMPACT_TIME = 1.7;
export const DEFAULT_ROUNDS = 5;
export const LIVES = 3;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SilhouetteGame {
  constructor() {
    this.rng = Math.random;
    this.mode = 'solo';
    this.players = [];
    this.activePlayer = 0;
    this.phase = 'idle';
    this.phaseTime = 0;
    this.events = [];
    this.pose = null;
    this.deck = [];
    this.roundIndex = 0;
    this.roundsTotal = DEFAULT_ROUNDS;
    this.durations = { prep: PREP_TIME, approach: 2.6, hold: 3.0, impact: IMPACT_TIME };
    this.hold = [];
    this.winner = null;
    this.isDraw = false;
    this.lastPoseId = null;
  }

  get simultaneous() {
    return this.mode === 'versus' || this.mode === 'joint';
  }

  start(mode, opts = {}) {
    this.mode = ['duel', 'endless', 'versus', 'joint'].includes(mode) ? mode : 'solo';
    this.rng = opts.rng || Math.random;
    this.roundsTotal = clamp(Number(opts.rounds) || DEFAULT_ROUNDS, 3, 7);
    if (this.mode === 'endless') this.roundsTotal = Infinity;
    const names = Array.isArray(opts.names) ? opts.names : [];
    const count = this.mode === 'duel' || this.mode === 'versus' ? 2 : 1;
    this.players = Array.from({ length: count }, (_, i) => ({
      index: i,
      name: (names[i] || (count === 2 ? `ИГРОК ${i + 1}` : 'ИГРОК')).trim().slice(0, 14) || `ИГРОК ${i + 1}`,
      score: 0,
      lives: LIVES,
      combo: 0,
      bestCombo: 0,
      passed: 0,
      rounds: [],
      accuracySum: 0,
      avgAccuracy: 0,
      reason: '',
      finished: false,
    }));
    this.winner = null;
    this.isDraw = false;
    this.events.length = 0;
    if (this.mode === 'versus') this._startVersus();
    else this._startPlayer(0);
    return this;
  }

  _startPlayer(index) {
    this.activePlayer = index;
    const p = this.players[index];
    p.score = 0;
    p.lives = LIVES;
    p.combo = 0;
    p.bestCombo = 0;
    p.passed = 0;
    p.rounds = [];
    p.accuracySum = 0;
    p.avgAccuracy = 0;
    p.reason = '';
    p.finished = false;
    this.deck = this.mode === 'endless'
      ? []
      : this.mode === 'joint'
        ? deckJoint(this.roundsTotal, this.rng)
        : deckFor(this.roundsTotal, this.rng);
    this.lastPoseId = null;
    this.roundIndex = 0;
    this.pose = null;
    this.phase = 'prep';
    this.phaseTime = 0;
    this.hold = this.players.map(() => ({ sum: 0, time: 0, samples: 0 }));
    this._emit({ type: 'player_start', player: index, playerData: p });
  }

  _startVersus() {
    this.activePlayer = 0;
    this.players.forEach((p) => {
      p.score = 0;
      p.lives = LIVES;
      p.combo = 0;
      p.bestCombo = 0;
      p.passed = 0;
      p.rounds = [];
      p.accuracySum = 0;
      p.avgAccuracy = 0;
      p.reason = '';
      p.finished = false;
    });
    this.deck = deckFor(this.roundsTotal, this.rng);
    this.lastPoseId = null;
    this.roundIndex = 0;
    this.pose = null;
    this.phase = 'prep';
    this.phaseTime = 0;
    this.hold = this.players.map(() => ({ sum: 0, time: 0, samples: 0 }));
    this._emit({ type: 'versus_start', players: this.players });
  }

  get currentPlayer() {
    return this.players[this.activePlayer] || null;
  }

  get roundNumber() {
    return Math.min(this.roundIndex + 1, this.roundsTotal);
  }

  get progress() {
    if (this.phase === 'prep') return this.phaseTime / PREP_TIME;
    if (this.phase === 'approach') return this.phaseTime / this.durations.approach;
    if (this.phase === 'hold') return this.phaseTime / this.durations.hold;
    if (this.phase === 'impact') return this.phaseTime / IMPACT_TIME;
    return 0;
  }

  /**
   * @param {number} dt
   * @param {{visible:boolean, fullBody:boolean, fresh:boolean, match:number|null, players?:Array}} sample
   */
  update(dt, sample = {}) {
    const d = clamp(Number(dt) || 0, 0, 0.08);
    if (this.phase === 'handoff' || this.phase === 'over' || this.phase === 'idle') return;
    const s = this._normalizeSample(sample);
    const ready = !!(s.fresh && s.fullBody);

    if (this.phase === 'prep') {
      if (ready) this.phaseTime += d;
      if (this.phaseTime >= PREP_TIME) {
        this.phaseTime = 0;
        this._beginRound();
      }
      return;
    }

    if (this.phase === 'approach') {
      if (ready) this.phaseTime += d;
      if (this.phaseTime >= this.durations.approach) {
        this.phaseTime = 0;
        this.hold.forEach((h) => { h.sum = 0; h.time = 0; h.samples = 0; });
        this.phase = 'hold';
        this._emit({
          type: 'lock',
          pose: this.pose,
          roundNumber: this.roundNumber,
          difficulty: this.pose?.diff || 1,
        });
      }
      return;
    }

    if (this.phase === 'hold') {
      if (this.mode === 'versus') {
        this.players.forEach((p, i) => {
          if (p.lives <= 0) return;
          const ps = s.players?.[i];
          if (ps && ps.fresh && ps.fullBody && typeof ps.match === 'number' && Number.isFinite(ps.match)) {
            const m = clamp(ps.match, 0, 1);
            this.hold[i].time += d;
            this.hold[i].sum += m * d;
            this.hold[i].samples++;
          }
        });
        if (ready) this.phaseTime += d;
      } else {
        if (ready && typeof s.match === 'number' && Number.isFinite(s.match)) {
          const m = clamp(s.match, 0, 1);
          this.phaseTime += d;
          this.hold[0].time += d;
          this.hold[0].sum += m * d;
          this.hold[0].samples++;
        }
      }
      if (this.phaseTime >= this.durations.hold) this._evaluate();
      return;
    }

    if (this.phase === 'impact') {
      this.phaseTime += d;
      if (this.phaseTime >= IMPACT_TIME) this._afterImpact();
    }
  }

  _normalizeSample(sample) {
    const ps = Array.isArray(sample.players) ? sample.players : [];
    if (this.mode === 'versus') {
      const alive = this.players.map((p) => p.lives > 0);
      const need = alive.map((a, i) => (a ? ps[i] : null)).filter(Boolean);
      const ready = need.length > 0 && need.every((p) => p.fresh && p.fullBody);
      const visible = ps.some((p) => p && p.fresh && p.visible);
      return { fresh: ps.some((p) => p && p.fresh), fullBody: ready, visible, match: null, players: ps };
    }
    if (this.mode === 'joint') {
      const l = ps[0];
      const r = ps[1];
      const ready = !!(l && r && l.fresh && l.fullBody && r.fresh && r.fullBody);
      const visible = !!((l && l.fresh && l.visible) || (r && r.fresh && r.visible));
      const both = (typeof l?.match === 'number' && Number.isFinite(l.match)) && (typeof r?.match === 'number' && Number.isFinite(r.match));
      const match = both ? (l.match + r.match) / 2 : null;
      return { fresh: !!((l && l.fresh) || (r && r.fresh)), fullBody: ready, visible, match, players: ps };
    }
    return sample;
  }

  _pickPose() {
    if (this.mode === 'endless') {
      const r = this.roundIndex;
      const diff = r < 3 ? 1 : r < 8 ? 2 : 3;
      let pool = POSES.filter((p) => p.diff === diff && p.id !== this.lastPoseId);
      if (!pool.length) pool = POSES.filter((p) => p.diff === diff);
      if (!pool.length) pool = POSES.filter((p) => p.id !== this.lastPoseId);
      if (!pool.length) pool = POSES.slice();
      const pick = pool[Math.floor(this.rng() * pool.length)] || pool[0];
      this.lastPoseId = pick.id;
      return pick;
    }
    return this.deck[this.roundIndex];
  }

  _beginRound() {
    this.pose = this._pickPose();
    this.phase = 'approach';
    this.phaseTime = 0;
    this.hold.forEach((h) => { h.sum = 0; h.time = 0; h.samples = 0; });
    this.durations = {
      prep: PREP_TIME,
      approach: Math.max(2.05, 2.65 - this.roundIndex * 0.08),
      hold: Math.max(2.55, 3.0 - this.roundIndex * 0.07),
      impact: IMPACT_TIME,
    };
    this._emit({
      type: 'round',
      pose: this.pose,
      roundIndex: this.roundIndex,
      roundNumber: this.roundNumber,
      roundsTotal: this.roundsTotal,
      durations: { ...this.durations },
      player: this.mode === 'versus' ? -1 : this.activePlayer,
    });
  }

  _evaluate() {
    if (this.mode === 'versus') {
      this._evaluateVersus();
      return;
    }
    const p = this.currentPlayer;
    const pose = this.pose;
    const h = this.hold[0];
    const accuracy = h.time > 0.22 ? clamp(h.sum / h.time, 0, 1) : 0;
    const passed = accuracy >= pose.pass;
    const comboBefore = p.combo;
    let points = 0;
    if (passed) {
      const base = 400 + (this.roundIndex + 1) * 100;
      const precision = Math.round(accuracy * 1000);
      const mult = 1 + Math.min(p.combo, 4) * 0.12;
      points = Math.round((base + precision) * mult);
      p.score += points;
      p.combo += 1;
      p.bestCombo = Math.max(p.bestCombo, p.combo);
      p.passed += 1;
    } else {
      p.lives = Math.max(0, p.lives - 1);
      p.combo = 0;
    }
    p.accuracySum += accuracy;
    p.avgAccuracy = p.accuracySum / Math.max(1, p.rounds.length + 1);
    p.rounds.push({
      poseId: pose.id,
      poseName: pose.name,
      accuracy,
      passed,
      points,
      threshold: pose.pass,
      difficulty: pose.diff,
    });

    this.phase = 'impact';
    this.phaseTime = 0;
    this._emit({
      type: 'impact',
      passed,
      accuracy,
      threshold: pose.pass,
      points,
      comboBefore,
      comboAfter: p.combo,
      lives: p.lives,
      score: p.score,
      pose,
      roundNumber: this.roundNumber,
      roundsTotal: this.roundsTotal,
      player: this.activePlayer,
      playerName: p.name,
      livesLost: passed ? 0 : 1,
    });
  }

  _evaluateVersus() {
    const pose = this.pose;
    const results = this.players.map((p, i) => {
      if (p.lives <= 0) {
        return { player: i, name: p.name, active: false, accuracy: 0, passed: false, points: 0, comboBefore: p.combo, comboAfter: p.combo, lives: p.lives, score: p.score };
      }
      const h = this.hold[i];
      const accuracy = h.time > 0.22 ? clamp(h.sum / h.time, 0, 1) : 0;
      const passed = accuracy >= pose.pass;
      const comboBefore = p.combo;
      let points = 0;
      if (passed) {
        const base = 400 + (this.roundIndex + 1) * 100;
        const precision = Math.round(accuracy * 1000);
        const mult = 1 + Math.min(p.combo, 4) * 0.12;
        points = Math.round((base + precision) * mult);
        p.score += points;
        p.combo += 1;
        p.bestCombo = Math.max(p.bestCombo, p.combo);
        p.passed += 1;
      } else {
        p.lives = Math.max(0, p.lives - 1);
        p.combo = 0;
      }
      p.accuracySum += accuracy;
      p.avgAccuracy = p.accuracySum / Math.max(1, p.rounds.length + 1);
      p.rounds.push({ poseId: pose.id, poseName: pose.name, accuracy, passed, points, threshold: pose.pass, difficulty: pose.diff });
      return { player: i, name: p.name, active: true, accuracy, passed, points, comboBefore, comboAfter: p.combo, lives: p.lives, score: p.score };
    });
    this.phase = 'impact';
    this.phaseTime = 0;
    this._emit({
      type: 'impact',
      versus: true,
      results,
      pose,
      roundNumber: this.roundNumber,
      roundsTotal: this.roundsTotal,
    });
  }

  _afterImpact() {
    if (this.mode === 'versus') {
      const allOut = this.players.every((p) => p.lives <= 0);
      if (allOut || this.roundIndex + 1 >= this.roundsTotal) {
        this._finishVersus();
        return;
      }
      this.roundIndex++;
      this._beginRound();
      return;
    }
    const p = this.currentPlayer;
    if (p.lives <= 0) {
      this._finishPlayer('lives');
      return;
    }
    if (this.mode === 'endless') {
      this.roundIndex++;
      this._beginRound();
      return;
    }
    if (this.roundIndex + 1 >= this.roundsTotal) {
      this._finishPlayer('complete');
      return;
    }
    this.roundIndex++;
    this._beginRound();
  }

  _finishPlayer(reason) {
    const p = this.currentPlayer;
    p.finished = true;
    p.reason = reason;
    p.avgAccuracy = p.rounds.length ? p.accuracySum / p.rounds.length : 0;
    this.phase = 'impact';
    this._emit({ type: 'player_finished', player: this.activePlayer, playerData: p, reason });

    if (this.mode === 'duel' && this.activePlayer === 0) {
      this.phase = 'handoff';
      this._emit({
        type: 'handoff',
        player: 0,
        playerData: p,
        next: 1,
        nextName: this.players[1].name,
      });
      return;
    }
    this._finishGame();
  }

  nextPlayer() {
    if (this.mode !== 'duel' || this.activePlayer !== 0 || this.phase !== 'handoff') return false;
    this._startPlayer(1);
    return true;
  }

  _finishVersus() {
    this.phase = 'over';
    const [a, b] = this.players;
    if (a.score !== b.score) {
      this.winner = a.score > b.score ? a : b;
      this.isDraw = false;
    } else if (Math.abs(a.avgAccuracy - b.avgAccuracy) > 0.002) {
      this.winner = a.avgAccuracy > b.avgAccuracy ? a : b;
      this.isDraw = false;
    } else {
      this.winner = null;
      this.isDraw = true;
    }
    this._emit({ type: 'game_over', mode: this.mode, players: this.players, winner: this.winner, isDraw: this.isDraw });
  }

  _finishGame() {
    this.phase = 'over';
    if (this.mode === 'duel') {
      const [a, b] = this.players;
      if (a.score !== b.score) {
        this.winner = a.score > b.score ? a : b;
        this.isDraw = false;
      } else if (Math.abs(a.avgAccuracy - b.avgAccuracy) > 0.002) {
        this.winner = a.avgAccuracy > b.avgAccuracy ? a : b;
        this.isDraw = false;
      } else {
        this.winner = null;
        this.isDraw = true;
      }
    }
    this._emit({ type: 'game_over', mode: this.mode, players: this.players, winner: this.winner, isDraw: this.isDraw });
  }

  _emit(event) {
    this.events.push(event);
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

function deckJoint(count, rng = Math.random) {
  const schedule = [];
  for (let i = 0; i < count; i++) {
    const p = count <= 1 ? 1 : i / (count - 1);
    const diff = p < 0.32 ? 1 : p < 0.78 ? 2 : 3;
    schedule.push(diff);
  }
  const used = new Set();
  const out = [];
  for (const diff of schedule) {
    let pool = JOINT_POSES.filter((p) => p.diff === diff && !used.has(p.id));
    if (!pool.length) pool = JOINT_POSES.filter((p) => !used.has(p.id));
    if (!pool.length) pool = JOINT_POSES.slice();
    const pick = pool[Math.floor(rng() * pool.length)] || pool[0];
    used.add(pick.id);
    out.push(pick);
  }
  return out;
}
