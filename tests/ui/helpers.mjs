// 画面テストの共通部品: dist をビルドして配信し、360px 幅のスマホとして開く。

import { before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { build } from '../../tools/build.mjs';

const require = createRequire(import.meta.url);
export const AXE_PATH = require.resolve('axe-core/axe.min.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

let server, browser;
export let base;

before(async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hojokin-dist-'));
  await build({ outDir });
  server = createServer((req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.endsWith('/')) p += 'index.html';
    try {
      const body = readFileSync(join(outDir, p));
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

// bypassCSP は axe を注入するテストだけで使う（サイトの CSP がインラインスクリプトを止めるため）。
export async function open(path = '', { bypassCSP = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, bypassCSP });
  const page = await context.newPage();
  const requests = [];
  const consoleErrors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(base + path);
  return { context, page, requests, consoleErrors };
}


// 選択肢を押したあとの誤タップ防止（src/app.js の TAP_GUARD_MS）より長く待つ。
export const AFTER_SCREEN_CHANGE_MS = 600;

// 各画面のハッシュ。答えはどれでもよいので最初の選択肢を使う。
export const SCREENS = [
  ['トップ', ''],
  ['質問1', '#q1'],
  ['質問2', '#q2/boat_engine'],
  ['質問3', '#q3/boat_engine/vessel'],
  ['結果', '#result/boat_engine/vessel/individual'],
];
