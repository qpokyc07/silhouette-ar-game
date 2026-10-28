/**
 * Позы-цели и геометрия «тени».
 *
 * Углы заданы в экранных координатах: 0° — вправо, 90° — вниз,
 * 180° — влево, 270° — вверх. Так проще рисовать силуэт и сравнивать
 * направления конечностей с точками MediaPipe.
 *
 * Поза описывает:
 *   torso      — направление от таза к шее (270° = прямой корпус);
 *   arms.L/R   — [плечо → локоть, локоть → запястье];
 *   legs.L/R   — [бедро → колено, колено → стопа].
 */

export const MODEL = Object.freeze({
  torso: 1.34,
  shoulder: 0.78,
  hip: 0.46,
  headOffset: 0.42,
  headR: 0.3,
  upperArm: 0.8,
  foreArm: 0.72,
  thigh: 1.0,
  shin: 0.98,
  foot: 0.24,
});

/** Высота фигуры в модельных единицах — от макушки до подошвы. */
export const MODEL_HEIGHT = MODEL.torso + MODEL.headOffset + MODEL.headR + MODEL.thigh + MODEL.shin;

const PASS = { 1: 0.66, 2: 0.7, 3: 0.74 };

export const POSES = [
  {
    id: 'statue',
    name: 'СТАТУЯ',
    hint: 'Руки прямо в стороны, ладони вниз',
    diff: 1,
    torso: 270,
    arms: { L: [180, 180], R: [0, 0] },
    legs: { L: [98, 94], R: [82, 86] },
  },
  {
    id: 'star',
    name: 'ЗВЕЗДА',
    hint: 'Руки и ноги в стороны — большой X',
    diff: 1,
    torso: 270,
    arms: { L: [218, 222], R: [322, 318] },
    legs: { L: [116, 112], R: [64, 68] },
  },
  {
    id: 'keeper',
    name: 'ВРАТАРЬ',
    hint: 'Руки вниз-в стороны, ноги шире',
    diff: 1,
    torso: 270,
    arms: { L: [142, 146], R: [38, 34] },
    legs: { L: [110, 107], R: [70, 73] },
  },
  {
    id: 'rocket',
    name: 'РАКЕТА',
    hint: 'Руки вверх, ноги вместе',
    diff: 1,
    torso: 270,
    arms: { L: [250, 255], R: [290, 285] },
    legs: { L: [94, 92], R: [86, 88] },
  },
  {
    id: 'hero',
    name: 'ГЕРОЙ',
    hint: 'Руки на пояс, локти в стороны',
    diff: 2,
    torso: 270,
    arms: { L: [132, 55], R: [48, 125] },
    legs: { L: [102, 97], R: [78, 83] },
  },
  {
    id: 'strongman',
    name: 'СИЛАЧ',
    hint: 'Согни руки, кулаки вверх',
    diff: 2,
    torso: 270,
    arms: { L: [125, 235], R: [55, 305] },
    legs: { L: [100, 96], R: [80, 84] },
  },
  {
    id: 'scarecrow',
    name: 'ПУГАЛО',
    hint: 'Одна рука вверх, другая в сторону',
    diff: 2,
    torso: 272,
    arms: { L: [250, 250], R: [0, 0] },
    legs: { L: [105, 101], R: [75, 79] },
  },
  {
    id: 'teapot',
    name: 'ЧАЙНИК',
    hint: 'Рука на пояс, вторая — в сторону',
    diff: 2,
    torso: 275,
    arms: { L: [138, 55], R: [25, 25] },
    legs: { L: [96, 93], R: [84, 87] },
  },
  {
    id: 'archer',
    name: 'ЛУК',
    hint: 'Наклонись, рука вверх, вторая вбок',
    diff: 3,
    torso: 282,
    arms: { L: [225, 215], R: [0, 355] },
    legs: { L: [108, 104], R: [72, 76] },
  },
  {
    id: 'boxer',
    name: 'БОКСЁР',
    hint: 'Кулаки к голове, локти в стороны',
    diff: 3,
    torso: 272,
    arms: { L: [135, 315], R: [45, 225] },
    legs: { L: [100, 96], R: [80, 84] },
  },
];

for (const p of POSES) p.pass = PASS[p.diff] || 0.67;

export const POSE_BY_ID = Object.fromEntries(POSES.map((p) => [p.id, p]));

export const NEUTRAL_POSE = Object.freeze({
  id: 'neutral',
  name: 'СТОЙКА',
  hint: 'Встаньте свободно, руки вдоль тела',
  diff: 1,
  torso: 270,
  arms: { L: [100, 96], R: [80, 84] },
  legs: { L: [97, 95], R: [83, 85] },
});

const RAD = Math.PI / 180;

export function dir(deg) {
  return { x: Math.cos(deg * RAD), y: Math.sin(deg * RAD) };
}

export function add(a, b, k = 1) {
  return { x: a.x + b.x * k, y: a.y + b.y * k };
}

export function norm(deg) {
  return ((deg % 360) + 360) % 360;
}

export function angleDiff(a, b) {
  let d = norm(a) - norm(b);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function lerpAngle(a, b, t) {
  return norm(a + angleDiff(b, a) * t);
}

export function blendPose(a, b, t) {
  const mix = (x, y) => lerpAngle(x, y, t);
  return {
    ...a,
    id: `${a.id}-${b.id}`,
    torso: mix(a.torso, b.torso),
    arms: {
      L: [mix(a.arms.L[0], b.arms.L[0]), mix(a.arms.L[1], b.arms.L[1])],
      R: [mix(a.arms.R[0], b.arms.R[0]), mix(a.arms.R[1], b.arms.R[1])],
    },
    legs: {
      L: [mix(a.legs.L[0], b.legs.L[0]), mix(a.legs.L[1], b.legs.L[1])],
      R: [mix(a.legs.R[0], b.legs.R[0]), mix(a.legs.R[1], b.legs.R[1])],
    },
  };
}

/**
 * Собирает скелет в модельных координатах (таз в 0,0; y направлен вниз).
 */
export function buildFigure(pose) {
  const u = dir(pose.torso);
  // left — единичный вектор влево относительно корпуса
  const left = { x: u.y, y: -u.x };

  const pelvis = { x: 0, y: 0 };
  const neck = add(pelvis, u, MODEL.torso);
  const head = add(neck, u, MODEL.headOffset);
  const shoulderY = add(neck, u, -0.09);
  const shoulderL = add(shoulderY, left, MODEL.shoulder);
  const shoulderR = add(shoulderY, left, -MODEL.shoulder);
  const hipL = add(pelvis, left, MODEL.hip);
  const hipR = add(pelvis, left, -MODEL.hip);

  const armL = limb(shoulderL, pose.arms.L, MODEL.upperArm, MODEL.foreArm);
  const armR = limb(shoulderR, pose.arms.R, MODEL.upperArm, MODEL.foreArm);
  const legL = limb(hipL, pose.legs.L, MODEL.thigh, MODEL.shin);
  const legR = limb(hipR, pose.legs.R, MODEL.thigh, MODEL.shin);

  const footL = add(legL.end, dir(180), MODEL.foot);
  const footR = add(legR.end, dir(0), MODEL.foot);

  const points = {
    pelvis,
    neck,
    head,
    shoulderL,
    shoulderR,
    elbowL: armL.mid,
    wristL: armL.end,
    elbowR: armR.mid,
    wristR: armR.end,
    hipL,
    hipR,
    kneeL: legL.mid,
    ankleL: legL.end,
    kneeR: legR.mid,
    ankleR: legR.end,
    footL,
    footR,
  };

  const bounds = figureBounds(points);
  return { pose, points, bounds, pivotX: (legL.end.x + legR.end.x) / 2, bottom: bounds.maxY };
}

function limb(root, angles, a, b) {
  const mid = add(root, dir(angles[0]), a);
  const end = add(mid, dir(angles[1]), b);
  return { root, mid, end };
}

function figureBounds(p) {
  const pts = [
    p.head,
    p.shoulderL,
    p.shoulderR,
    p.elbowL,
    p.elbowR,
    p.wristL,
    p.wristR,
    p.hipL,
    p.hipR,
    p.kneeL,
    p.kneeR,
    p.ankleL,
    p.ankleR,
    p.footL,
    p.footR,
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of pts) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y);
    maxY = Math.max(maxY, q.y);
  }
  return {
    minX: minX - MODEL.headR,
    maxX: maxX + MODEL.headR,
    minY: minY - MODEL.headR,
    maxY: maxY + 0.03,
    width: maxX - minX + MODEL.headR * 2,
    height: maxY - minY + MODEL.headR * 2,
  };
}

/** Углы, которые сравниваются с телом игрока. */
export function targetAngles(pose) {
  return {
    torso: pose.torso,
    armLUp: pose.arms.L[0],
    armLFore: pose.arms.L[1],
    armRUp: pose.arms.R[0],
    armRFore: pose.arms.R[1],
    legLUp: pose.legs.L[0],
    legLFore: pose.legs.L[1],
    legRUp: pose.legs.R[0],
    legRFore: pose.legs.R[1],
  };
}

/** Смешивает две позы для «примерки» тени перед игрой. */
export function poseAtTime(poses, seconds, hold = 3.1, morph = 0.65) {
  const n = poses.length;
  const raw = seconds / hold;
  const i = Math.floor(raw) % n;
  const local = (raw - Math.floor(raw)) * hold;
  const a = poses[i];
  const b = poses[(i + 1) % n];
  if (local < hold - morph) return a;
  const t = smoothstep((local - (hold - morph)) / morph);
  return blendPose(a, b, t);
}

export function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function deckFor(count, rng = Math.random) {
  const schedule = [];
  for (let i = 0; i < count; i++) {
    const p = count <= 1 ? 1 : i / (count - 1);
    const diff = p < 0.32 ? 1 : p < 0.78 ? 2 : 3;
    schedule.push(diff);
  }
  const used = new Set();
  const out = [];
  for (const diff of schedule) {
    let pool = POSES.filter((p) => p.diff === diff && !used.has(p.id));
    if (!pool.length) pool = POSES.filter((p) => !used.has(p.id));
    if (!pool.length) pool = POSES.slice();
    const pick = pool[Math.floor(rng() * pool.length)] || pool[0];
    used.add(pick.id);
    out.push(pick);
  }
  return out;
}
