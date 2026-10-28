/**
 * Статическая проверка index.html:
 *   node tests/check-html.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
const refs = [...new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))];
const missing = refs.filter((r) => !ids.includes(r));
let errors = 0;

if (dupes.length) {
  console.error('Дубли ID:', dupes.join(', '));
  errors++;
}
if (missing.length) {
  console.error('JS ссылается на отсутствующие ID:', missing.join(', '));
  errors++;
}

const localAssets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|#|mailto:)/.test(u));
for (const asset of localAssets) {
  if (!fs.existsSync(path.join(ROOT, asset))) {
    console.error('Нет файла:', asset);
    errors++;
  }
}

const required = [
  'screen-intro',
  'screen-menu',
  'screen-duel',
  'screen-help',
  'screen-handoff',
  'screen-over',
  'screen-pause',
  'hud',
  'prep',
  'verdict',
  'panel',
  'big-state',
  'pose-mini',
  'btn-camera',
  'btn-solo',
  'btn-duel',
  'btn-pause',
  'btn-resume',
  'btn-again',
  'btn-handoff-next',
];
for (const id of required) {
  if (!ids.includes(id)) {
    console.error('Нет обязательного элемента:', id);
    errors++;
  }
}

if (errors) {
  console.error(`\nПроверка не пройдена: ${errors} ошибок\n`);
  process.exit(1);
}
console.log(`HTML: ${ids.length} ID, дублей нет, все ${refs.length} JS-ссылок и ${localAssets.length} локальных файлов на месте.\n`);
