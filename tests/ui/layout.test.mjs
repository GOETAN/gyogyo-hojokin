// 画面の自動チェック: 360px 幅でのアクセシビリティ要件（完了条件）。
// 実機（高齢者のスマホ）での確認の代わりにはならない。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { build } from '../../tools/build.mjs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

let server, browser, base;

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
async function open(path = '', { bypassCSP = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, bypassCSP });
  const page = await context.newPage();
  const requests = [];
  const consoleErrors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(base + path);
  return { context, page, requests, consoleErrors };
}

test('トップ: 360px 幅で横スクロールが出ない', async () => {
  const { context, page } = await open();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(scrollWidth <= clientWidth, `scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
  await context.close();
});

test('トップ: 文字は本文 20px 以上、ボタン内 22px 以上（ふりがなは除く）', async () => {
  const { context, page } = await open();
  const small = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!node.textContent.trim() || el.closest('rt')) continue;
      if (!el.getClientRects().length) continue; // 非表示
      const size = parseFloat(getComputedStyle(el).fontSize);
      const min = el.closest('.btn') ? 22 : 20;
      if (size < min) out.push(`${node.textContent.trim()} = ${size}px（最小 ${min}px）`);
    }
    return out;
  });
  assert.deepEqual(small, []);
  await context.close();
});

test('トップ: タップできるものは高さ 56px 以上、互いに 12px 以上離れている', async () => {
  const { context, page } = await open();
  const rects = await page.evaluate(() =>
    [...document.querySelectorAll('a, button, input, select, [role=button]')]
      .filter((el) => el.getClientRects().length)
      .map((el) => { const r = el.getBoundingClientRect(); return { label: el.textContent.trim().replace(/\s+/g, ' '), top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; }));
  assert.ok(rects.length >= 2, 'ボタンが見つかりません');
  for (const r of rects) assert.ok(r.height >= 56, `「${r.label}」の高さ ${r.height}px < 56px`);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const gap = Math.max(b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right);
      assert.ok(gap >= 12, `「${a.label}」と「${b.label}」の間 ${gap}px < 12px`);
    }
  }
  await context.close();
});

test('トップ: axe で WCAG 2.1 A/AA の違反がない（コントラストを含む）', async () => {
  const { context, page } = await open('', { bypassCSP: true });
  await page.addScriptTag({ path: AXE_PATH });
  const result = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  const violations = result.violations.map((v) => `${v.id}: ${v.help}（${v.nodes.map((n) => n.target.join(' ')).join(', ')}）`);
  assert.deepEqual(violations, []);
  assert.ok(result.passes.some((p) => p.id === 'color-contrast'), 'コントラストの検査が実行されていません');
  await context.close();
});

test('電話ボタンは site.yaml の番号の tel: リンク', async () => {
  const { context, page } = await open();
  const site = (await import('yaml')).default.parse(readFileSync(new URL('../../data/site.yaml', import.meta.url), 'utf8'));
  const href = await page.getAttribute('.btn-tel', 'href');
  assert.equal(href, `tel:${site.phone.replace(/\D/g, '')}`);
  assert.ok((await page.textContent('.btn-tel')).includes(site.phone));
  await context.close();
});

test('外部への通信・Cookie・コンソールエラーがない', async () => {
  const { context, page, requests, consoleErrors } = await open();
  await page.waitForLoadState('networkidle');
  const external = requests.filter((u) => !u.startsWith(base));
  assert.deepEqual(external, []);
  assert.deepEqual(await context.cookies(), []);
  assert.deepEqual(consoleErrors, []);
  await context.close();
});

test('トップでは「最初からやりなおす」を出さない（トップがその戻り先なので）', async () => {
  const { context, page } = await open();
  assert.equal(await page.isVisible('[data-restart]'), false);
  await context.close();
});
