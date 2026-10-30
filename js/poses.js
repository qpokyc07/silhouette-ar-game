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
  {
    id: 'soldier',
    name: 'СОЛДАТ',
    hint: 'Руки вдоль тела, стойка смирно',
    diff: 1,
    torso: 270,
    arms: { L: [92, 92], R: [88, 88] },
    legs: { L: [95, 93], R: [85, 87] },
  },
  {
    id: 'clock',
    name: 'ЧАСЫ',
    hint: 'Одна рука вверх, другая вниз',
    diff: 1,
    torso: 270,
    arms: { L: [90, 90], R: [270, 270] },
    legs: { L: [95, 93], R: [85, 87] },
  },
  {
    id: 'mountain',
    name: 'ГОРА',
    hint: 'Ладони вместе над головой',
    diff: 1,
    torso: 270,
    arms: { L: [282, 290], R: [258, 250] },
    legs: { L: [94, 92], R: [86, 88] },
  },
  {
    id: 'tree',
    name: 'ДЕРЕВО',
    hint: 'Руки вверх широким V, ноги шире',
    diff: 1,
    torso: 270,
    arms: { L: [235, 242], R: [305, 298] },
    legs: { L: [100, 98], R: [80, 82] },
  },
  {
    id: 'surfer',
    name: 'СЕРФЕР',
    hint: 'Руки в стороны, колени согнуты',
    diff: 1,
    torso: 278,
    arms: { L: [180, 180], R: [0, 0] },
    legs: { L: [115, 110], R: [65, 70] },
  },
  {
    id: 'angel',
    name: 'АНГЕЛ',
    hint: 'Руки-крылья вверх, ноги вместе',
    diff: 1,
    torso: 270,
    arms: { L: [200, 204], R: [340, 336] },
    legs: { L: [94, 92], R: [86, 88] },
  },
  {
    id: 'pray',
    name: 'МОЛИТВА',
    hint: 'Ладони вместе у груди',
    diff: 1,
    torso: 270,
    arms: { L: [95, 350], R: [85, 10] },
    legs: { L: [95, 93], R: [85, 87] },
  },
  {
    id: 'flamingo',
    name: 'ФЛАМИНГО',
    hint: 'Стой на одной ноге, руки в стороны',
    diff: 2,
    torso: 270,
    arms: { L: [180, 180], R: [0, 0] },
    legs: { L: [97, 94], R: [45, 75] },
  },
  {
    id: 'warrior',
    name: 'ВОИН',
    hint: 'Выпад, одна рука вверх, другая вниз',
    diff: 2,
    torso: 280,
    arms: { L: [250, 250], R: [90, 90] },
    legs: { L: [75, 85], R: [105, 95] },
  },
  {
    id: 'crab',
    name: 'КРАБ',
    hint: 'Клешни вверх, ноги полусогнуты',
    diff: 2,
    torso: 270,
    arms: { L: [160, 250], R: [20, 290] },
    legs: { L: [120, 100], R: [60, 80] },
  },
  {
    id: 'dancer',
    name: 'ТАНЦОР',
    hint: 'Одна рука дугой вверх, другая вбок',
    diff: 2,
    torso: 272,
    arms: { L: [235, 265], R: [0, 0] },
    legs: { L: [105, 100], R: [75, 80] },
  },
  {
    id: 'sumo',
    name: 'СУМО',
    hint: 'Глубокий присед, руки на бёдрах',
    diff: 2,
    torso: 272,
    arms: { L: [115, 90], R: [65, 90] },
    legs: { L: [125, 110], R: [55, 70] },
  },
  {
    id: 'marionette',
    name: 'МАРИОНЕТКА',
    hint: 'Одна рука вверх, другая вниз, кисти согнуты',
    diff: 2,
    torso: 270,
    arms: { L: [270, 250], R: [90, 110] },
    legs: { L: [95, 93], R: [85, 87] },
  },
  {
    id: 'karate',
    name: 'КАРАТИСТ',
    hint: 'Удар вперёд, кулак у пояса',
    diff: 2,
    torso: 272,
    arms: { L: [135, 60], R: [20, 20] },
    legs: { L: [110, 105], R: [70, 75] },
  },
  {
    id: 'ballerina',
    name: 'БАЛЕРИНА',
    hint: 'Руки над головой, нога в сторону',
    diff: 3,
    torso: 272,
    arms: { L: [230, 240], R: [310, 300] },
    legs: { L: [97, 94], R: [25, 35] },
  },
  {
    id: 'cobra',
    name: 'КОБРА',
    hint: 'Наклон, руки согнуты как капюшон',
    diff: 3,
    torso: 285,
    arms: { L: [120, 240], R: [60, 300] },
    legs: { L: [105, 100], R: [75, 80] },
  },
  {
    id: 'hammer',
    name: 'МОЛОТ',
    hint: 'Руки сомкнуты над головой, наклон',
    diff: 3,
    torso: 285,
    arms: { L: [250, 300], R: [285, 305] },
    legs: { L: [100, 96], R: [80, 84] },
  },
  {
    id: 'superman',
    name: 'СУПЕРМЕН',
    hint: 'Наклон вперёд, руки вперёд, нога назад',
    diff: 3,
    torso: 285,
    arms: { L: [0, 0], R: [0, 0] },
    legs: { L: [95, 93], R: [120, 100] },
  },
  {
    id: 'sidekick',
    name: 'УДАР НОГОЙ',
    hint: 'Удар ногой вбок, защитная стойка',
    diff: 3,
    torso: 272,
    arms: { L: [135, 60], R: [45, 120] },
    legs: { L: [95, 93], R: [0, 0] },
  },
  {
    id: 'skater',
    name: 'КОНЬКОБЕЖЕЦ',
    hint: 'Глубокий выпад, руки назад',
    diff: 3,
    torso: 285,
    arms: { L: [180, 180], R: [160, 160] },
    legs: { L: [70, 80], R: [110, 100] },
  },
];

for (const p of POSES) p.pass = PASS[p.diff] || 0.67;

export const JOINT_POSES = [
  {
    id: 'tower',
    name: 'БАШНЯ',
    hint: 'Встаньте рядом и тянитесь вверх',
    diff: 1,
    joint: true,
    gap: 1.4,
    left: { torso: 270, arms: { L: [250, 255], R: [290, 285] }, legs: { L: [94, 92], R: [86, 88] } },
    right: { torso: 270, arms: { L: [250, 255], R: [290, 285] }, legs: { L: [94, 92], R: [86, 88] } },
  },
  {
    id: 'mirror',
    name: 'ЗЕРКАЛО',
    hint: 'Один повторяет другого зеркально',
    diff: 1,
    joint: true,
    gap: 1.8,
    left: { torso: 270, arms: { L: [270, 270], R: [0, 0] }, legs: { L: [95, 93], R: [85, 87] } },
    right: { torso: 270, arms: { L: [180, 180], R: [270, 270] }, legs: { L: [95, 93], R: [85, 87] } },
  },
  {
    id: 'wall',
    name: 'СТЕНА',
    hint: 'Руки в стороны, ноги широко',
    diff: 1,
    joint: true,
    gap: 1.8,
    left: { torso: 270, arms: { L: [180, 180], R: [0, 0] }, legs: { L: [110, 107], R: [70, 73] } },
    right: { torso: 270, arms: { L: [180, 180], R: [0, 0] }, legs: { L: [110, 107], R: [70, 73] } },
  },
  {
    id: 'highfive',
    name: 'ДАЙ ПЯТЬ',
    hint: 'Хлопните в ладоши вверху по центру',
    diff: 2,
    joint: true,
    gap: 2.2,
    left: { torso: 270, arms: { L: [90, 90], R: [330, 330] }, legs: { L: [95, 93], R: [85, 87] } },
    right: { torso: 270, arms: { L: [210, 210], R: [90, 90] }, legs: { L: [95, 93], R: [85, 87] } },
  },
  {
    id: 'handshake',
    name: 'РУКОПОЖАТИЕ',
    hint: 'Протяните руки навстречу друг другу',
    diff: 2,
    joint: true,
    gap: 1.6,
    left: { torso: 270, arms: { L: [90, 90], R: [10, 10] }, legs: { L: [95, 93], R: [85, 87] } },
    right: { torso: 270, arms: { L: [170, 170], R: [90, 90] }, legs: { L: [95, 93], R: [85, 87] } },
  },
  {
    id: 'heart',
    name: 'СЕРДЦЕ',
    hint: 'Руками вместе нарисуйте сердце',
    diff: 2,
    joint: true,
    gap: 1.8,
    left: { torso: 270, arms: { L: [240, 255], R: [300, 315] }, legs: { L: [95, 93], R: [85, 87] } },
    right: { torso: 270, arms: { L: [225, 240], R: [285, 300] }, legs: { L: [95, 93], R: [85, 87] } },
  },
  {
    id: 'gate',
    name: 'ВОРОТА',
    hint: 'Внешние руки вверх, внутренние — аркой',
    diff: 2,
    joint: true,
    gap: 1.6,
    left: { torso: 270, arms: { L: [270, 270], R: [300, 300] }, legs: { L: [95, 93], R: [85, 87] } },
    right: { torso: 270, arms: { L: [240, 240], R: [270, 270] }, legs: { L: [95, 93], R: [85, 87] } },
  },
  {
    id: 'bridge',
    name: 'МОСТ',
    hint: 'Наклонитесь навстречу, руки вверх',
    diff: 3,
    joint: true,
    gap: 1.5,
    left: { torso: 285, arms: { L: [300, 310], R: [290, 290] }, legs: { L: [100, 96], R: [80, 84] } },
    right: { torso: 255, arms: { L: [250, 250], R: [240, 230] }, legs: { L: [100, 96], R: [80, 84] } },
  },
  {
    id: 'tandem',
    name: 'ТАНДЕМ',
    hint: 'Наклонитесь вперёд в одну сторону',
    diff: 3,
    joint: true,
    gap: 1.6,
    left: { torso: 280, arms: { L: [20, 20], R: [20, 20] }, legs: { L: [75, 85], R: [105, 95] } },
    right: { torso: 280, arms: { L: [20, 20], R: [20, 20] }, legs: { L: [75, 85], R: [105, 95] } },
  },
  {
    id: 'pyramid',
    name: 'ПИРАМИДА',
    hint: 'Один — вершина, второй — основание',
    diff: 3,
    joint: true,
    gap: 1.6,
    left: { torso: 270, arms: { L: [250, 260], R: [290, 280] }, legs: { L: [94, 92], R: [86, 88] } },
    right: { torso: 270, arms: { L: [180, 180], R: [0, 0] }, legs: { L: [120, 110], R: [60, 70] } },
  },
];

for (const p of JOINT_POSES) p.pass = PASS[p.diff] || 0.67;

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
