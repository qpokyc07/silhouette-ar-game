/**
 * Таблица лидеров: глобальная (Supabase) + локальный запас (localStorage).
 *
 * Счёт пишется в Supabase — это общая таблица для всех игроков. Если сети
 * нет, результат сохраняется в localStorage и показывается оттуда.
 */

const SUPABASE_URL = 'https://reznxdlivkmehvthacgj.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJlem54ZGxpdmttZWh2dGhhY2dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMzIwMTMsImV4cCI6MjEwODkwODAxM30.1zbTHRnEgPfz7rY4W1RahoilJ6ut2BT7VawV2twmMSs';
const KEY = 'silhouette:leaders:v1';
const MAX = 10;

function localBoard() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function persistLocal(board) {
  try {
    localStorage.setItem(KEY, JSON.stringify(board));
  } catch (_) {
    /* noop */
  }
}

function normalize(e) {
  return {
    name: String(e?.name || 'ИГРОК').trim().slice(0, 14) || 'ИГРОК',
    score: Math.max(0, Math.round(Number(e?.score) || 0)),
    mode: e?.mode === 'endless' ? 'endless' : 'solo',
    rounds: Math.max(0, Math.round(Number(e?.rounds) || 0)),
    accuracy: Math.max(0, Math.min(100, Math.round(Number(e?.accuracy) || 0))),
  };
}

async function fetchTop(limit = MAX) {
  const url = `${SUPABASE_URL}/rest/v1/leaderboard?select=name,score,mode,rounds,accuracy&order=score.desc&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map(normalize);
}

async function postScore(item) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: item.name,
      score: item.score,
      mode: item.mode,
      rounds: item.rounds,
      accuracy: item.accuracy,
    }),
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
}

/** Топ-10: из Supabase, при ошибке сети — локальная копия. */
export async function loadBoard() {
  try {
    const remote = await fetchTop(MAX);
    if (remote.length) return remote;
  } catch (_) {
    /* offline */
  }
  return localBoard().sort((a, b) => b.score - a.score).slice(0, MAX).map(normalize);
}

/** Сохраняет результат. Возвращает true, если записано в общую таблицу. */
export async function saveScore(entry) {
  const item = normalize(entry || {});
  if (item.score <= 0) return false;

  const local = localBoard();
  local.push(item);
  local.sort((a, b) => b.score - a.score);
  persistLocal(local.slice(0, MAX));

  try {
    await postScore(item);
    return true;
  } catch (_) {
    return false;
  }
}
