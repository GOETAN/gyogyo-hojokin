// 画面テストの共通部品: dist をビルドして配信し、360px 幅のスマホとして開く。

import { after } from 'node:test';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import YAML from 'yaml';
import { build } from '../../tools/build.mjs';
import { DATA_DIR } from '../../tools/lib/data.mjs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

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

let browserPromise;
const sites = [];
after(async () => {
  for (const s of sites) s.close();
  if (browserPromise) await (await browserPromise).close();
});

// サイトをビルドして配信する。
//   dataDir: 省略時は本物の data/
//   today:   ビルド時の「今日」。now: ブラウザの現在時刻（Date）。テストで日付を固定するときに使う
export async function startSite({ dataDir, today, now } = {}) {
  const outDir = mkdtempSync(join(tmpdir(), 'hojokin-dist-'));
  await build({ outDir, ...(dataDir && { dataDir }), ...(today && { today }) });
  const server = createServer((req, res) => {
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
  const base = `http://127.0.0.1:${server.address().port}/`;
  browserPromise ??= chromium.launch();
  const browser = await browserPromise;
  const site = { base, outDir, close: () => server.close() };
  sites.push(site);

  // bypassCSP は axe を注入するときだけ使う（サイトの CSP がインラインスクリプトを止めるため）。
  site.open = async (path = '', { bypassCSP = false } = {}) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, bypassCSP });
    const page = await context.newPage();
    if (now) await page.clock.setFixedTime(now);
    const requests = [];
    const consoleErrors = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    await page.goto(base + path);
    return { context, page, requests, consoleErrors };
  };
  return site;
}

// テスト用の data ディレクトリを作る。site.yaml と questions.yaml は本物を使う。
export function makeDataDir(subsidies) {
  const dir = mkdtempSync(join(tmpdir(), 'hojokin-data-'));
  mkdirSync(join(dir, 'subsidies'));
  for (const f of ['site.yaml', 'questions.yaml']) copyFileSync(join(DATA_DIR, f), join(dir, f));
  for (const s of subsidies) writeFileSync(join(dir, 'subsidies', `${s.id}.yaml`), YAML.stringify(s));
  return dir;
}

// 完了条件のうち、画面ごとに自動で確かめられるもの。問題があれば文字列の配列で返す。
// axe を注入するので、page は bypassCSP: true で開いたものを渡す。
export async function layoutProblems(page) {
  const problems = [];

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
  }));
  if (scrollWidth > clientWidth) problems.push(`横スクロール: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);

  // 本文 20px 以上、ボタン内 22px 以上（ふりがなは除く）
  problems.push(...await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!node.textContent.trim() || el.closest('rt, script')) continue;
      if (!el.getClientRects().length) continue; // 非表示
      const size = parseFloat(getComputedStyle(el).fontSize);
      const min = el.closest('.btn') ? 22 : 20;
      if (size < min) out.push(`文字が小さい: 「${node.textContent.trim()}」 ${size}px（最小 ${min}px）`);
    }
    return out;
  }));

  // タップできるものは高さ 56px 以上、互いに 12px 以上離れている
  const rects = await page.evaluate(() =>
    [...document.querySelectorAll('a, button, input, select, [role=button]')]
      .filter((el) => el.getClientRects().length)
      .map((el) => { const r = el.getBoundingClientRect(); return { label: el.textContent.trim().replace(/\s+/g, ' '), top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; }));
  if (rects.length < 2) problems.push('ボタンが見つかりません');
  for (const r of rects) if (r.height < 56) problems.push(`「${r.label}」の高さ ${r.height}px < 56px`);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const gap = Math.max(b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right);
      if (gap < 12) problems.push(`「${a.label}」と「${b.label}」の間 ${gap}px < 12px`);
    }
  }

  // WCAG 2.1 A/AA（コントラストを含む）
  await page.addScriptTag({ path: AXE_PATH });
  const result = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  for (const v of result.violations) {
    problems.push(`axe ${v.id}: ${v.help}（${v.nodes.map((n) => n.target.join(' ')).join(', ')}）`);
  }
  if (!result.passes.some((p) => p.id === 'color-contrast')) problems.push('コントラストの検査が実行されていません');

  return problems;
}
