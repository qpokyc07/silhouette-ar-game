/**
 * Canvas-слой: тень, скелет игрока, частицы, скорость, вспышки.
 * Все координаты — CSS-пиксели; DPR учитывается снаружи.
 */

import {
  MODEL,
  MODEL_HEIGHT,
  POSES,
  NEUTRAL_POSE,
  buildFigure,
  poseAtTime,
  smoothstep,
} from './poses.js';

const COLORS = {
  cyan: '#79f7ff',
  cyanSoft: 'rgba(121,247,255,0.55)',
  amber: '#ffd166',
  amberSoft: 'rgba(255,209,102,0.55)',
  mint: '#a6ffbb',
  red: '#ff5c7a',
  ink: 'rgba(3,7,14,0.97)',
};

export class Scene {
  constructor() {
    this.time = 0;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '255,255,255';
    this.dust = [];
    this.particles = [];
    this.rings = [];
    this.speedSeeds = [];
    this.w = 1;
    this.h = 1;
    this.trailAcc = 0;
    this.ringAcc = 0;
    this.lastFigure = null;
    this.reduced = false;
    this._seed();
  }

  _seed() {
    this.speedSeeds = Array.from({ length: 64 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.25 + Math.random() * 0.75,
      len: 0.04 + Math.random() * 0.12,
      w: 0.3 + Math.random() * 1.2,
    }));
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    if (this.dust.length < 54) {
      while (this.dust.length < 70) {
        this.dust.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.random() * 1.5,
          vx: (Math.random() - 0.5) * 5,
          vy: -4 - Math.random() * 12,
          a: 0.06 + Math.random() * 0.22,
        });
      }
    }
  }

  reset() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.shake = 0;
    this.flash = 0;
    this.trailAcc = 0;
    this.ringAcc = 0;
  }

  impact(x, y, passed) {
    const colors = passed
      ? [COLORS.cyan, COLORS.mint, '#ffffff', COLORS.amber]
      : [COLORS.red, '#ff9b6a', '#ffffff'];
    this.burst(x, y, passed ? 84 : 56, colors, passed ? 640 : 420);
    this.shake = passed ? 8 : 17;
    this.flash = passed ? 0.4 : 0.28;
    this.flashColor = passed ? '150,255,220' : '255,70,100';
    this.rings.push({ x, y, r: 12, maxR: passed ? 330 : 210, life: 0, max: 0.75, color: colors[0], width: 3 });
  }

  burst(x, y, count, colors, power) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = power * (0.25 + Math.random() * 0.75);
      const life = 0.5 + Math.random() * 1.1;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 65,
        gravity: 240 + Math.random() * 300,
        drag: 0.985,
        size: 1.2 + Math.random() * 4.2,
        color: colors[(Math.random() * colors.length) | 0],
        life,
        max: life,
        shard: Math.random() < 0.45,
        rot: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 12,
      });
    }
  }

  update(dt, state) {
    this.time += dt;
    this.shake *= Math.pow(0.002, dt);
    if (this.shake < 0.1) this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 2.2);

    for (const d of this.dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < -10) {
        d.y = this.h + 10;
        d.x = Math.random() * this.w;
      }
      if (d.x < -10) d.x = this.w + 10;
      if (d.x > this.w + 10) d.x = -10;
    }

    const target = state?.target;
    if (target?.anchor && state.phase === 'approach') {
      const p = target.progress || 0;
      this.trailAcc += dt;
      this.ringAcc += dt;
      const fig = this._fig(target.pose);
      if (fig && p > 0.15) {
        const groundY = target.anchor.groundY - (1 - easeOut(p)) * (state.videoRect?.h || this.h) * 0.18;
        while (this.trailAcc > 0.045) {
          this.trailAcc -= 0.045;
          const s = target.anchor.scale * (0.3 + 0.7 * easeOut(p));
          const y = groundY - Math.random() * fig.bounds.height * s;
          const x = target.anchor.x + (Math.random() - 0.5) * fig.bounds.width * s;
          this.particles.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 18,
            vy: -20 - Math.random() * 40,
            gravity: -12,
            drag: 0.97,
            size: 0.8 + Math.random() * 2.2,
            color: Math.random() < 0.25 ? COLORS.amber : COLORS.cyan,
            life: 0.35 + Math.random() * 0.5,
            max: 0.85,
            shard: false,
            rot: 0,
            spin: 0,
          });
        }
        if (this.ringAcc > 0.42) {
          this.ringAcc = 0;
          this.rings.push({
            x: target.anchor.x,
            y: groundY,
            r: 10,
            maxR: 110 + 70 * p,
            life: 0,
            max: 0.7,
            color: COLORS.cyan,
            width: 1.5,
          });
        }
      }
    }

    const alive = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy = p.vy * Math.pow(p.drag, dt * 60) + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      alive.push(p);
    }
    this.particles = alive.slice(-420);

    this.rings = this.rings.filter((r) => {
      r.life += dt;
      r.r += (r.maxR - r.r) * Math.min(1, dt * 4.5);
      return r.life < r.max;
    });
  }

  draw(ctx, state = {}) {
    const w = this.w;
    const h = this.h;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (this.shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    this.drawDust(ctx, state);

    if (state.mode === 'intro') {
      this.drawIntro(ctx, w, h, state);
    } else if (state.mode === 'game') {
      this.drawGame(ctx, state);
    } else if (state.mode === 'over') {
      this.drawRings(ctx);
      this.drawParticles(ctx);
    } else {
      this.drawRings(ctx);
      this.drawParticles(ctx);
    }

    ctx.restore();
    if (this.flash > 0.001) {
      ctx.save();
      ctx.globalAlpha = this.flash;
      ctx.fillStyle = `rgba(${this.flashColor},1)`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  drawGame(ctx, state) {
    const { videoRect, target, sample } = state;
    if (target?.anchor && state.phase !== 'impact') {
      if (state.phase === 'approach') this.drawSpeed(ctx, target, videoRect);
      this.drawRings(ctx);
      this.drawTarget(ctx, target, state);
    } else {
      this.drawRings(ctx);
    }

    if (state.phase === 'prep') this.drawPrepGuide(ctx, videoRect, sample);
    // Во время приближения не заслоняем тень собственным скелетом:
    // он вспыхивает только в момент контакта.
    if (sample?.points && state.phase !== 'approach') this.drawPlayer(ctx, sample, state);

    this.drawParticles(ctx);
  }

  drawIntro(ctx, w, h, state) {
    const portrait = h > w * 1.05;
    const x = portrait ? w * 0.64 : w * 0.73;
    const groundY = portrait ? h * 0.83 : h * 0.9;
    const scale = Math.min(h * (portrait ? 0.52 : 0.68), w * (portrait ? 0.62 : 0.34)) / MODEL_HEIGHT;
    const pose = poseAtTime(POSES, this.time + 0.6, 3.25, 0.7);
    const fig = this._fig(pose);

    // Сцена: круги на «полу».
    ctx.save();
    ctx.translate(x, groundY);
    ctx.scale(1, 0.2);
    for (let i = 1; i <= 4; i++) {
      const rr = (i * 86 + ((this.time * 15) % 86));
      ctx.beginPath();
      ctx.strokeStyle = `rgba(121,247,255,${0.08 - i * 0.012})`;
      ctx.lineWidth = 1.2;
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(x, groundY - 160 * scale, 10, x, groundY - 160 * scale, 330);
    glow.addColorStop(0, 'rgba(121,247,255,0.12)');
    glow.addColorStop(1, 'rgba(121,247,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 340, groundY - 500, 680, 620);

    drawFigure(ctx, fig, { x, groundY, scale }, {
      edge: COLORS.cyan,
      fill: 'rgba(3,8,16,0.68)',
      alpha: portrait ? 0.28 : 0.42,
      glow: 28,
      wire: true,
      rimAlpha: 0.55,
    });

    // Развевающаяся «тень» позади.
    drawFigure(ctx, fig, { x: x + 18, groundY: groundY + 4, scale: scale * 0.99 }, {
      edge: COLORS.amber,
      fill: 'rgba(3,8,16,0.12)',
      alpha: 0.06,
      glow: 42,
      rimAlpha: 0.18,
    });

    this.drawRings(ctx);
    this.drawParticles(ctx);
    void state;
  }

  drawSpeed(ctx, target, rect) {
    const fig = this._fig(target.pose);
    if (!fig) return;
    const cx = target.anchor.x;
    const cy =
      target.anchor.groundY -
      (1 - easeOut(target.progress || 0)) * (rect?.h || this.h) * 0.18 -
      fig.bounds.height * target.anchor.scale * 0.45;
    const p = target.progress || 0;
    const R = Math.max(this.w, this.h) * 0.62;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.speedSeeds) {
      const a = s.a;
      const r0 = R * s.r * (1.08 - p * 0.45);
      const r1 = r0 - R * s.len * (0.45 + p * 0.6);
      const alpha = (0.025 + p * 0.12) * (1 - s.r * 0.5);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(121,247,255,${alpha})`;
      ctx.lineWidth = s.w;
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTarget(ctx, target, state) {
    const fig = this._fig(target.pose);
    if (!fig) return;
    const p = state.phase === 'approach' ? smoothstep(target.progress || 0) : 1;
    const scale = target.anchor.scale * (state.phase === 'approach' ? 0.3 + 0.7 * easeOut(p) : 1);
    const rise = state.phase === 'approach' ? (1 - easeOut(p)) * (state.videoRect?.h || this.h) * 0.18 : 0;
    const locked = state.phase === 'hold';
    const edge = locked ? COLORS.amber : COLORS.cyan;
    const alpha = state.phase === 'approach' ? 0.4 + p * 0.58 : 0.84;
    const bodyAlpha = state.phase === 'approach' ? 0.96 + p * 0.04 : 0.42;

    if (state.phase === 'approach') {
      // Призрачные догоняющие копии.
      for (let i = 3; i >= 1; i--) {
        const q = Math.max(0, p - i * 0.035);
        drawFigure(
          ctx,
          fig,
          {
            x: target.anchor.x,
            groundY: target.anchor.groundY - (1 - easeOut(q)) * (state.videoRect?.h || this.h) * 0.18,
            scale: target.anchor.scale * (0.3 + 0.7 * easeOut(q)),
          },
          {
            edge: COLORS.cyan,
            fill: 'rgba(3,8,16,0.05)',
            alpha: 0.07 + p * 0.05,
            glow: 20,
            rimAlpha: 0.2,
            fillAlpha: 0.04,
          },
        );
      }
    }

    drawFigure(
      ctx,
      fig,
      { x: target.anchor.x, groundY: target.anchor.groundY - rise, scale },
      {
        edge,
        fill: COLORS.ink,
        alpha,
        fillAlpha: bodyAlpha,
        glow: locked ? 16 : 11,
        wire: locked,
        rimAlpha: locked ? 0.88 : 0.62,
        guide: locked,
      },
    );

    if (locked) {
      const box = figureBox(fig, { x: target.anchor.x, groundY: target.anchor.groundY, scale });
      drawBrackets(ctx, box, COLORS.amber, 0.42);
    }
  }

  drawPlayer(ctx, sample, state) {
    const p = sample.points;
    if (!p?.shL || !p?.shR || !p?.hipL || !p?.hipR) return;
    const scores = sample.jointScores || {};
    const lock = state.phase === 'hold';
    const baseAlpha = lock ? 1 : 0.8;
    const segs = [
      [p.shL, p.elL, scores.armLUp],
      [p.elL, p.wrL, scores.armLFore],
      [p.shR, p.elR, scores.armRUp],
      [p.elR, p.wrR, scores.armRFore],
      [p.hipL, p.kneeL, scores.legLUp],
      [p.kneeL, p.ankL, scores.legLFore],
      [p.hipR, p.kneeR, scores.legRUp],
      [p.kneeR, p.ankR, scores.legRFore],
      [p.shL, p.hipL, scores.torso],
      [p.shR, p.hipR, scores.torso],
      [p.shL, p.shR, scores.torso],
      [p.hipL, p.hipR, scores.torso],
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [a, b, score] of segs) {
      if (!a?.valid || !b?.valid) continue;
      const col = colorFor(score, lock);
      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.globalAlpha = baseAlpha * 0.13;
      ctx.lineWidth = 9;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = baseAlpha * 0.92;
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (const key of ['shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR']) {
      const q = p[key];
      if (!q?.valid) continue;
      const score = jointForPoint(key, scores);
      ctx.beginPath();
      ctx.fillStyle = colorFor(score, lock);
      ctx.globalAlpha = baseAlpha;
      ctx.arc(q.x, q.y, key.startsWith('wr') || key.startsWith('ank') ? 2.4 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = baseAlpha * 0.1;
      ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    // Голова.
    if (p.nose?.valid && p.shMid?.valid) {
      const r = Math.max(13, Math.hypot(p.shR.x - p.shL.x, p.shR.y - p.shL.y) * 0.22);
      const cy = p.shMid.y - r * 0.95;
      const cx = p.shMid.x;
      ctx.beginPath();
      ctx.strokeStyle = COLORS.cyan;
      ctx.globalAlpha = baseAlpha * 0.84;
      ctx.lineWidth = 2.3;
      ctx.shadowColor = COLORS.cyan;
      ctx.shadowBlur = 7;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPrepGuide(ctx, rect, sample) {
    if (!rect) return;
    const visible = sample?.fullBody;
    const x = rect.x + rect.w * 0.5;
    const groundY = rect.y + rect.h * 0.94;
    const scale = (rect.h * 0.68) / MODEL_HEIGHT;
    const fig = this._fig(NEUTRAL_POSE);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.4);
    drawFigure(ctx, fig, { x, groundY, scale }, {
      edge: visible ? COLORS.mint : COLORS.cyan,
      fill: 'rgba(3,8,16,0.9)',
      alpha: visible ? 0.28 : 0.3,
      fillAlpha: 0.1,
      glow: 16,
      rimAlpha: 0.28 + pulse * 0.14,
      dashed: true,
    });
    const box = figureBox(fig, { x, groundY, scale });
    drawBrackets(ctx, box, visible ? COLORS.mint : COLORS.cyan, 0.25 + pulse * 0.16);
  }

  drawDust(ctx, state) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of this.dust) {
      ctx.globalAlpha = d.a * (state.mode === 'intro' ? 1 : 0.55);
      ctx.fillStyle = COLORS.cyan;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const a = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.shard) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size * 1.6, -p.size * 0.3, p.size * 3.2, p.size * 0.6);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawRings(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const a = 1 - r.life / r.max;
      if (a <= 0) continue;
      ctx.beginPath();
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = a * 0.55;
      ctx.lineWidth = r.width;
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _fig(pose) {
    if (!pose) return null;
    if (this.lastFigure?.pose === pose) return this.lastFigure.fig;
    const fig = buildFigure(pose);
    this.lastFigure = { pose, fig };
    return fig;
  }
}

export function drawFigure(ctx, fig, anchor, opts = {}) {
  const s = anchor.scale * (opts.scale ?? 1);
  if (!(s > 0)) return;
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0) return;
  ctx.save();
  ctx.translate(anchor.x, anchor.groundY);
  ctx.scale(s, s);
  ctx.translate(-fig.pivotX, -fig.bottom);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawBody(ctx, fig, opts, alpha);
  ctx.restore();
}

function drawBody(ctx, fig, opts, alpha) {
  const p = fig.points;
  const edge = opts.edge || COLORS.cyan;
  const fill = opts.fill || COLORS.ink;
  const rim = opts.rimAlpha ?? 0.7;
  const glow = opts.glow ?? 24;
  const fillAlpha = opts.fillAlpha ?? 0.7;

  const parts = [
    { a: p.hipL, b: p.kneeL, w: 0.4 },
    { a: p.kneeL, b: p.ankleL, w: 0.3 },
    { a: p.ankleL, b: p.footL, w: 0.21 },
    { a: p.hipR, b: p.kneeR, w: 0.4 },
    { a: p.kneeR, b: p.ankleR, w: 0.3 },
    { a: p.ankleR, b: p.footR, w: 0.21 },
    { a: p.pelvis, b: p.neck, w: 0.62 },
    { a: p.shoulderL, b: p.shoulderR, w: 0.34 },
    { a: p.neck, b: p.head, w: 0.25 },
    { a: p.shoulderL, b: p.elbowL, w: 0.32 },
    { a: p.elbowL, b: p.wristL, w: 0.25 },
    { a: p.shoulderR, b: p.elbowR, w: 0.32 },
    { a: p.elbowR, b: p.wristR, w: 0.25 },
  ];

  if (opts.dashed) {
    ctx.setLineDash([0.12, 0.09]);
  }

  // Светящийся контур: чуть толще тела.
  ctx.save();
  ctx.globalAlpha = alpha * rim;
  ctx.strokeStyle = edge;
  ctx.shadowColor = edge;
  ctx.shadowBlur = glow;
  for (const part of parts) {
    segment(ctx, part.a, part.b, part.w + 0.04);
  }
  ctx.beginPath();
  ctx.arc(p.head.x, p.head.y, MODEL.headR + 0.02, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Тело.
  ctx.save();
  ctx.globalAlpha = alpha * fillAlpha;
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  for (const part of parts) {
    segment(ctx, part.a, part.b, part.w);
  }
  ctx.beginPath();
  ctx.arc(p.head.x, p.head.y, MODEL.headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Внутренний «каркас» — проявляется, когда тень застыла.
  if (opts.wire) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.4;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.018;
    for (const part of parts) segment(ctx, part.a, part.b, 0.018);
    ctx.restore();
  }

  if (opts.guide) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.012;
    for (const part of parts) {
      ctx.beginPath();
      ctx.moveTo(part.a.x, part.a.y);
      ctx.lineTo(part.b.x, part.b.y);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.setLineDash([]);
}

function segment(ctx, a, b, width) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function figureBox(fig, anchor) {
  const s = anchor.scale;
  const minX = anchor.x + (fig.bounds.minX - fig.pivotX) * s;
  const maxX = anchor.x + (fig.bounds.maxX - fig.pivotX) * s;
  const minY = anchor.groundY + (fig.bounds.minY - fig.bottom) * s;
  const maxY = anchor.groundY;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function drawBrackets(ctx, box, color, alpha) {
  const pad = 18;
  const len = Math.min(34, Math.max(14, box.w * 0.12));
  const x = box.x - pad;
  const y = box.y - pad;
  const w = box.w + pad * 2;
  const h = box.h + pad * 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  const corners = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sy * len);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * len, cy);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderPoseMini(canvas, pose) {
  if (!canvas || !pose) return;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const fig = buildFigure(pose);
  const pad = Math.min(w, h) * 0.1;
  const scale = Math.min((w - pad * 2) / fig.bounds.width, (h - pad * 2) / fig.bounds.height);
  const anchor = {
    x: w / 2,
    groundY: h - pad,
    scale,
  };
  // Лёгкая сетка.
  ctx.save();
  ctx.strokeStyle = 'rgba(121,247,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (h / 4) * i);
    ctx.lineTo(w, (h / 4) * i);
    ctx.stroke();
  }
  ctx.restore();
  drawFigure(ctx, fig, anchor, {
    edge: COLORS.amber,
    fill: 'rgba(3,8,16,0.34)',
    alpha: 0.98,
    fillAlpha: 0.3,
    glow: 14,
    rimAlpha: 0.85,
    wire: true,
  });
}

function colorFor(score, lock) {
  if (!lock || score == null) return COLORS.cyan;
  if (score >= 0.78) return COLORS.mint;
  if (score >= 0.52) return COLORS.amber;
  return COLORS.red;
}

function jointForPoint(key, scores) {
  if (key.startsWith('elL') || key.startsWith('wrL') || key === 'shL') return scores.armLUp;
  if (key.startsWith('elR') || key.startsWith('wrR') || key === 'shR') return scores.armRUp;
  if (key.startsWith('kneeL') || key.startsWith('ankL') || key === 'hipL') return scores.legLUp;
  if (key.startsWith('kneeR') || key.startsWith('ankR') || key === 'hipR') return scores.legRUp;
  return scores.torso;
}

function easeOut(t) {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}
