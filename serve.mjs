/**
 * Локальный сервер без зависимостей.
 *
 *   node serve.mjs          → http://localhost:8080
 *   node serve.mjs 3000     → другой порт
 *
 * Камера доступна только в безопасном контексте: https:// или http://localhost.
 * С телефона по http://192.168.x.x браузер камеру не отдаст. Варианты:
 *   1) GitHub Pages / Netlify Drop — там HTTPS сразу;
 *   2) туннель: cloudflared tunnel --url http://localhost:8080;
 *   3) положить рядом cert.pem и key.pem — сервер поднимет HTTPS на 8443.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

function handler(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  } catch (_) {
    res.writeHead(400).end('bad request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const target = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404: ' + urlPath);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(target).pipe(res);
  });
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();
  console.log('');
  console.log('  СИЛУЭТ — AR-игра');
  console.log('  ───────────────────────────────────────────────');
  console.log(`  компьютер:  http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  сеть:       http://${ip}:${PORT}  (камера по http не откроется)`);
  console.log('  ───────────────────────────────────────────────');
  console.log('  Камера: только https:// или localhost.');
  console.log('  С телефона: GitHub Pages, Netlify Drop или туннель.');
  console.log('');
});

const keyPath = path.join(ROOT, 'key.pem');
const certPath = path.join(ROOT, 'cert.pem');
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  try {
    https
      .createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, handler)
      .listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`  https://0.0.0.0:${HTTPS_PORT} — сертификат из key.pem/cert.pem`);
        console.log('');
      });
  } catch (e) {
    console.warn('  Не удалось поднять HTTPS:', e.message);
  }
} else {
  console.log('  Подсказка: cert.pem + key.pem рядом — и сервер поднимет HTTPS.');
  console.log('');
}
