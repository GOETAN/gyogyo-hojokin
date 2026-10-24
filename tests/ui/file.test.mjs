// ビルドした index.html を、ファイルとして直接開いて（file://）動くことのテスト。
// サーバーなしで確認できるようにするための要件。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { build } from '../../tools/build.mjs';
import { AFTER_SCREEN_CHANGE_MS } from './helpers.mjs';

const browser = await chromium.launch();
after(() => browser.close());

async function openFile(file, hash = '') {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); // CSP 違反もここに出る
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(file).href + hash);
  return { context, page, errors };
}

const visibleScreen = (page) =>
  page.evaluate(() => [...document.querySelectorAll('main > .screen')].filter((s) => !s.hidden).map((s) => s.id.replace(/^screen-/, '')));

async function tapAndWait(page, locator) {
  await locator.tap();
  await page.waitForTimeout(AFTER_SCREEN_CHANGE_MS);
}

test('本物のデータのビルドは index.html 1 ファイルだけで、見本の帯は出ない', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hojokin-file-'));
  const { file } = await build({ outDir });
  assert.deepEqual(readdirSync(outDir), ['index.html']);
  const { context, page, errors } = await openFile(file);
  assert.equal(await page.locator('.demo-banner').count(), 0);
  await tapAndWait(page, page.getByRole('link', { name: 'はじめる' }));
  assert.deepEqual(await visibleScreen(page), ['q1']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('見本（--demo）を file:// で開いて、トップ → 質問 → 結果 → 詳細 → もどる → やりなおす まで動く', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hojokin-demo-'));
  execFileSync('node', ['tools/build.mjs', '--demo', '-o', outDir], { cwd: new URL('../..', import.meta.url) });
  const file = join(outDir, 'index.html');
  assert.match(readFileSync(file, 'utf8'), /確認用の 見本です/);

  const { context, page, errors } = await openFile(file);
  assert.equal(await page.isVisible('.demo-banner'), true);
  const screen = page.locator('main > .screen:not([hidden])');
  await tapAndWait(page, screen.getByRole('link', { name: 'はじめる' }));
  await tapAndWait(page, screen.getByRole('button', { name: '機械や設備を 入れたい' }));
  await tapAndWait(page, screen.getByRole('button', { name: 'わからない' }));
  await tapAndWait(page, screen.getByRole('button', { name: 'わからない' }));
  assert.deepEqual(await visibleScreen(page), ['result']);
  assert.ok(await page.locator('[data-hit-list] .card').count() >= 1);

  await tapAndWait(page, page.locator('[data-hit-list] .card').first().getByRole('link', { name: 'くわしく みる' }));
  assert.deepEqual(await visibleScreen(page), ['detail']);
  assert.match(await page.locator('#screen-detail h1').innerText(), /（架空）/);

  await tapAndWait(page, page.locator('#screen-detail [data-back]'));
  assert.deepEqual(await visibleScreen(page), ['result']);
  await tapAndWait(page, page.locator('[data-restart]'));
  assert.deepEqual(await visibleScreen(page), ['top']);
  assert.deepEqual(errors, []);
  await context.close();
});
