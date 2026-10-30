/**
 * Сопоставление живой позы с силуэтом. Поддерживает одного или двух человек.
 *
 * MediaPipe отдаёт нормализованные точки кадра. Камера зеркальная, поэтому
 * x переворачивается: игрок видит себя как в зеркале и сравнивает фигуры
 * интуитивно. Углы считаются уже в пикселях экрана, иначе квадратный пиксель
 * кадра искажал бы направления.
 */

import { MODEL_HEIGHT, targetAngles, angleDiff } from './poses.js';

const IDX = {
  nose: 0,
  shL: 11,
  shR: 12,
  elL: 13,
  elR: 14,
  wrL: 15,
  wrR: 16,
  hipL: 23,
  hipR: 24,
  kneeL: 25,
  kneeR: 26,
  ankL: 27,
  ankR: 28,
};

const JOINTS = [
  { key: 'armLUp', a: 'shL', b: 'elL', target: 'armLUp', weight: 0.17, maxErr: 82, label: 'ЛЕВАЯ РУКА' },
  { key: 'armRUp', a: 'shR', b: 'elR', target: 'armRUp', weight: 0.17, maxErr: 82, label: 'ПРАВАЯ РУКА' },
  { key: 'armLFore', a: 'elL', b: 'wrL', target: 'armLFore', weight: 0.09, maxErr: 88, label: 'ЛЕВОЕ ПРЕДПЛЕЧЬЕ' },
  { key: 'armRFore', a: 'elR', b: 'wrR', target: 'armRFore', weight: 0.09, maxErr: 88, label: 'ПРАВОЕ ПРЕДПЛЕЧЬЕ' },
  { key: 'legLUp', a: 'hipL', b: 'kneeL', target: 'legLUp', weight: 0.1, maxErr: 76, label: 'ЛЕВАЯ НОГА' },
  { key: 'legRUp', a: 'hipR', b: 'kneeR', target: 'legRUp', weight: 0.1, maxErr: 76, label: 'ПРАВАЯ НОГА' },
  { key: 'legLFore', a: 'kneeL', b: 'ankL', target: 'legLFore', weight: 0.06, maxErr: 76, label: 'ЛЕВАЯ ГОЛЕНЬ' },
  { key: 'legRFore', a: 'kneeR', b: 'ankR', target: 'legRFore', weight: 0.06, maxErr: 76, label: 'ПРАВАЯ ГОЛЕНЬ' },
  { key: 'torso', a: 'hipMid', b: 'shMid', target: 'torso', weight: 0.16, maxErr: 58, label: 'КОРПУС' },
];

const KEY_POINTS = Object.keys(IDX);

function normDeg(d) {
  return ((d % 360) + 360) % 360;
}

class Person {
  constructor() {
    this.smoothed = {};
    this.points = {};
    this.angles = {};
    this.visible = false;
    this.fullBody = false;
    this.bodyVisible = false;
    this.anchor = null;
    this.rect = null;
    this.updatedAt = 0;
    this.poseId = null;
    this.match = null;
    this.matchSmooth = 0;
    this.jointScores = {};
    this.worst = null;
  }

  process(landmarks, rect, now) {
    this.rect = rect;
    this.updatedAt = now;

    if (!landmarks || landmarks.length < 29) {
      this.visible = false;
      this.fullBody = false;
      this.bodyVisible = false;
      this.anchor = null;
      this.points = {};
      this.angles = {};
      return;
    }

    const raw = {};
    for (const key of KEY_POINTS) {
      const lm = landmarks[IDX[key]];
      if (!lm) continue;
      const vis = Number.isFinite(lm.visibility) ? lm.visibility : 1;
      // Камера отображается зеркально.
      const x = rect.x + (1 - lm.x) * rect.w;
      const y = rect.y + lm.y * rect.h;
      const margin = 0.035;
      const inside =
        x > rect.x - rect.w * margin &&
        x < rect.x + rect.w * (1 + margin) &&
        y > rect.y - rect.h * margin &&
        y < rect.y + rect.h * (1 + margin);
      raw[key] = { x, y, vis, inside, valid: vis >= 0.22 && inside };
    }

    for (const key of KEY_POINTS) {
      const p = raw[key];
      if (!p) {
        delete this.points[key];
        continue;
      }
      const prev = this.smoothed[key];
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > rect.w * 0.22) {
        this.smoothed[key] = { x: p.x, y: p.y };
      } else {
        const k = 0.46;
        this.smoothed[key] = {
          x: prev.x + (p.x - prev.x) * k,
          y: prev.y + (p.y - prev.y) * k,
        };
      }
      this.points[key] = {
        ...this.smoothed[key],
        vis: p.vis,
        inside: p.inside,
        valid: p.valid,
      };
    }

    const mid = (a, b) => {
      if (!a || !b) return null;
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        vis: Math.min(a.vis || 0, b.vis || 0),
        inside: a.inside && b.inside,
        valid: a.valid && b.valid,
      };
    };

    this.points.shMid = mid(this.points.shL, this.points.shR);
    this.points.hipMid = mid(this.points.hipL, this.points.hipR);

    this.bodyVisible = !!(this.points.shL?.valid && this.points.shR?.valid && this.points.hipL?.valid && this.points.hipR?.valid);
    this.visible = this.bodyVisible;
    this.fullBody = !!(
      this.bodyVisible &&
      this.points.nose?.valid &&
      this.points.elL?.valid &&
      this.points.elR?.valid &&
      this.points.wrL?.valid &&
      this.points.wrR?.valid &&
      this.points.kneeL?.valid &&
      this.points.kneeR?.valid &&
      this.points.ankL?.valid &&
      this.points.ankR?.valid
    );

    this.angles = this.extractAngles();
    this.anchor = this.fullBody ? this.makeAnchor() : null;
  }

  extractAngles() {
    const p = this.points;
    const angle = (a, b) => {
      if (!a?.valid || !b?.valid) return null;
      return normDeg((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
    };
    return {
      torso: angle(p.hipMid, p.shMid),
      armLUp: angle(p.shL, p.elL),
      armLFore: angle(p.elL, p.wrL),
      armRUp: angle(p.shR, p.elR),
      armRFore: angle(p.elR, p.wrR),
      legLUp: angle(p.hipL, p.kneeL),
      legLFore: angle(p.kneeL, p.ankL),
      legRUp: angle(p.hipR, p.kneeR),
      legRFore: angle(p.kneeR, p.ankR),
    };
  }

  makeAnchor() {
    const p = this.points;
    const ankleX = (p.ankL.x + p.ankR.x) / 2;
    const ankleY = Math.max(p.ankL.y, p.ankR.y);
    const nose = p.nose;
    const shoulderW = Math.abs(p.shR.x - p.shL.x);
    const headTop = nose.y - Math.max(8, shoulderW * 0.17);
    const bodyPx = Math.max(60, ankleY - headTop);
    const groundY = ankleY + Math.max(3, bodyPx * 0.045);
    const height = Math.max(60, groundY - headTop);
    return {
      x: ankleX,
      groundY,
      scale: height / MODEL_HEIGHT,
      bodyHeight: height,
    };
  }

  score(pose) {
    if (!pose) {
      this.match = null;
      return { match: null, raw: null, jointScores: {}, worst: null, valid: false };
    }
    if (this.poseId !== pose.id) {
      this.poseId = pose.id;
      this.matchSmooth = 0;
      this.match = null;
    }
    if (!this.visible) {
      this.match = null;
      this.matchSmooth = 0;
      this.jointScores = {};
      this.worst = null;
      return { match: null, raw: null, jointScores: {}, worst: null, valid: false };
    }

    const target = targetAngles(pose);
    let sum = 0;
    let weight = 0;
    let worst = null;
    const jointScores = {};

    for (const j of JOINTS) {
      const playerAngle = this.angles[j.key];
      const targetAngle = target[j.target];
      const a = this.points[j.a];
      const b = this.points[j.b];
      let score = 0;
      if (playerAngle != null && targetAngle != null && a?.valid && b?.valid) {
        const err = Math.abs(angleDiff(playerAngle, targetAngle));
        score = Math.max(0, Math.min(1, 1 - err / j.maxErr));
        score = Math.pow(score, 0.82);
        if (!worst || score < worst.score) worst = { key: j.key, label: j.label, score, err };
      } else {
        if (!worst) worst = { key: j.key, label: j.label, score: 0, err: 999 };
      }
      jointScores[j.key] = score;
      sum += score * j.weight;
      weight += j.weight;
    }

    const raw = weight ? sum / weight : 0;
    const k = 0.28;
    this.matchSmooth = this.matchSmooth + (raw - this.matchSmooth) * k;
    const smoothed = Math.max(0, Math.min(1, this.matchSmooth));
    this.match = smoothed;
    this.jointScores = jointScores;
    this.worst = worst;
    return { match: smoothed, raw, jointScores, worst, valid: true };
  }
}

export class PoseMatcher {
  constructor() {
    this.reset();
  }

  reset() {
    this.person = new Person();
    this.person2 = new Person();
    this.left = null;
    this.right = null;
    this.frameAt = 0;
    this.debug = false;
    this._sync();
  }

  _sync() {
    const p = this.person;
    this.smoothed = p.smoothed;
    this.points = p.points;
    this.angles = p.angles;
    this.visible = p.visible;
    this.fullBody = p.fullBody;
    this.bodyVisible = p.bodyVisible;
    this.anchor = p.anchor;
    this.updatedAt = p.updatedAt;
    this.rect = p.rect;
    this.match = p.match;
    this.matchSmooth = p.matchSmooth;
    this.poseId = p.poseId;
    this.jointScores = p.jointScores;
    this.worst = p.worst;
  }

  /**
   * Один человек (соло / дуэль по очереди / бесконечный).
   */
  update(landmarks, rect, now = performance.now()) {
    this.person.process(landmarks, rect, now);
    this.person2.process(null, rect, now);
    this.left = this.person.bodyVisible ? this.person : null;
    this.right = null;
    this._sync();
    return this.frame();
  }

  /**
   * До двух человек одновременно (versus / совместные позы).
   * Левым считается тот, у кого центр бедра левее на экране.
   */
  updateMulti(sets, rect, now = performance.now()) {
    const list = Array.isArray(sets) ? sets : [];
    const a = list[0] && list[0].length >= 29 ? list[0] : null;
    const b = list[1] && list[1].length >= 29 ? list[1] : null;
    this.person.process(a, rect, now);
    this.person2.process(b, rect, now);

    const present = [this.person, this.person2].filter((p) => p.bodyVisible);
    if (present.length === 2) {
      const [p0, p1] = present;
      const x0 = p0.points.hipMid ? p0.points.hipMid.x : 0;
      const x1 = p1.points.hipMid ? p1.points.hipMid.x : 0;
      if (x0 <= x1) {
        this.left = p0;
        this.right = p1;
      } else {
        this.left = p1;
        this.right = p0;
      }
    } else if (present.length === 1) {
      const p = present[0];
      const x = p.points.hipMid ? p.points.hipMid.x : rect.x + rect.w / 2;
      if (x <= rect.x + rect.w / 2) {
        this.left = p;
        this.right = null;
      } else {
        this.left = null;
        this.right = p;
      }
    } else {
      this.left = null;
      this.right = null;
    }
    this._sync();
    return this.frame();
  }

  frame() {
    return {
      visible: this.visible,
      fullBody: this.fullBody,
      bodyVisible: this.bodyVisible,
      anchor: this.anchor,
      points: this.points,
      angles: this.angles,
      updatedAt: this.updatedAt,
      rect: this.rect,
      match: this.match,
      matchSmooth: this.matchSmooth,
      jointScores: this.jointScores,
      worst: this.worst,
    };
  }

  isFresh(now = performance.now(), maxAge = 420) {
    return now - this.updatedAt <= maxAge;
  }

  score(pose) {
    return this.person.score(pose);
  }

  scorePerson(side, pose) {
    const p = side === 'left' ? this.left : side === 'right' ? this.right : null;
    if (!p) return { match: null, raw: null, jointScores: {}, worst: null, valid: false };
    return p.score(pose);
  }

  personFrame(side) {
    const p = side === 'left' ? this.left : this.right;
    if (!p) return null;
    return {
      visible: p.visible,
      fullBody: p.fullBody,
      bodyVisible: p.bodyVisible,
      anchor: p.anchor,
      points: p.points,
      angles: p.angles,
      updatedAt: p.updatedAt,
      rect: p.rect,
    };
  }
}

export { IDX };
