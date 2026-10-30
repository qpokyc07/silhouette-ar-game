/**
 * Локальная таблица лидеров на localStorage. Без сервера и аккаунтов.
 * Хранит топ-10 лучших результатов в «СОЛО» и «БЕСКОНЕЧНЫЙ».
 */

const KEY = 'silhouette:leaders:v1';
const MAX = 10;

export function loadBoard() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && Number.isFinite(e.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX);
  } catch (_) {
    return [];
  }
}

function persist(board) {
  try {
    localStorage.setItem(KEY, JSON.stringify(board));
  } catch (_) {
    /* noop */
  }
}

/** Попадёт ли счёт в топ-10? */
export function qualifies(score) {
  const s = Math.max(0, Math.round(score || 0));
  if (s <= 0) return false;
  const board = loadBoard();
  if (board.length < MAX) return true;
  return s > board[board.length - 1].score;
}

/** Сохраняет результат и возвращает позицию (1-based) или -1. */
export function saveScore(entry) {
  const score = Math.max(0, Math.round(entry?.score || 0));
  if (score <= 0) return -1;
  const board = loadBoard();
  const item = {
    name: String(entry?.name || 'ИГРОК').trim().slice(0, 14) || 'ИГРОК',
    score,
    mode: entry?.mode === 'endless' ? 'endless' : 'solo',
    rounds: Math.max(0, Math.round(entry?.rounds || 0)),
    accuracy: Math.max(0, Math.min(100, Math.round(entry?.accuracy || 0))),
    date: Date.now(),
  };
  board.push(item);
  board.sort((a, b) => b.score - a.score || a.date - b.date);
  const top = board.slice(0, MAX);
  persist(top);
  const idx = top.indexOf(item);
  return idx >= 0 ? idx + 1 : -1;
}

/** Лучший результат в таблице. */
export function bestScore() {
  const board = loadBoard();
  return board.length ? board[0].score : 0;
}
