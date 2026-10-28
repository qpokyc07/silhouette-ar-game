/**
 * Правила «СИЛУЭТА» без DOM и canvas.
 *
 * Раунд:
 *   prep → approach → hold → impact → следующий раунд
 *
 * В prep и approach время стоит, если игрока не видно целиком. В hold
 * засчитывается средняя точность: недостаточно «поймать» позу на кадр,
 * её нужно удержать.
 */

import { deckFor } from './poses.js';

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
    this.holdSum = 0;
    this.holdTime = 0;
    this.holdSamples = 0;
    this.winner = null;
    this.isDraw = false;
  }

  start(mode, opts = {}) {
    this.mode = mode === 'duel' ? 'duel' : 'solo';
    this.rng = opts.rng || Math.random;
    this.roundsTotal = clamp(Number(opts.rounds) || DEFAULT_ROUNDS, 3, 7);
    const names = Array.isArray(opts.names) ? opts.names : [];
    this.players = Array.from({ length: this.mode === 'duel' ? 2 : 1 }, (_, i) => ({
      index: i,
      name: (names[i] || (this.mode === 'duel' ? `ИГРОК ${i + 1}` : 'ИГРОК')).trim().slice(0, 14) || `ИГРОК ${i + 1}`,
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
    this._startPlayer(0);
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
    this.deck = deckFor(this.roundsTotal, this.rng);
    this.roundIndex = 0;
    this.pose = null;
    this.phase = 'prep';
    this.phaseTime = 0;
    this.holdSum = 0;
    this.holdTime = 0;
    this.holdSamples = 0;
    this._emit({ type: 'player_start', player: index, playerData: p });
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
   * @param {{visible:boolean, fullBody:boolean, fresh:boolean, match:number|null}} sample
   */
  update(dt, sample = {}) {
    const d = clamp(Number(dt) || 0, 0, 0.08);
    if (this.phase === 'handoff' || this.phase === 'over' || this.phase === 'idle') return;
    const ready = !!(sample.fresh && sample.fullBody);
    const visible = !!(sample.fresh && sample.visible);

    if (this.phase === 'prep') {
      if (ready) this.phaseTime += d;
      if (this.phaseTime >= PREP_TIME) {
        this.phaseTime = 0;
        this._beginRound();
      }
      return;
    }

    if (this.phase === 'approach') {
      // Тень не нападает на человека, которого не видно: таймер ждёт.
      if (ready) this.phaseTime += d;
      if (this.phaseTime >= this.durations.approach) {
        this.phaseTime = 0;
        this.holdSum = 0;
        this.holdTime = 0;
        this.holdSamples = 0;
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
      if (ready && typeof sample.match === 'number' && Number.isFinite(sample.match)) {
        const m = clamp(sample.match, 0, 1);
        this.phaseTime += d;
        this.holdTime += d;
        this.holdSum += m * d;
        this.holdSamples++;
      }
      if (this.phaseTime >= this.durations.hold) this._evaluate();
      return;
    }

    if (this.phase === 'impact') {
      this.phaseTime += d;
      if (this.phaseTime >= IMPACT_TIME) this._afterImpact();
    }
  }

  _beginRound() {
    this.pose = this.deck[this.roundIndex];
    this.phase = 'approach';
    this.phaseTime = 0;
    this.holdSum = 0;
    this.holdTime = 0;
    this.holdSamples = 0;
    // Чем дальше, тем короче путь тени — но и удержание короче.
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
      player: this.activePlayer,
    });
  }

  _evaluate() {
    const p = this.currentPlayer;
    const pose = this.pose;
    const accuracy = this.holdTime > 0.22 ? clamp(this.holdSum / this.holdTime, 0, 1) : 0;
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

  _afterImpact() {
    const p = this.currentPlayer;
    if (p.lives <= 0) {
      this._finishPlayer('lives');
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
    this._emit({
      type: 'game_over',
      mode: this.mode,
      players: this.players,
      winner: this.winner,
      isDraw: this.isDraw,
    });
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
