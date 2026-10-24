// 画面の流れのテスト: タップ数・もどる・スマホの戻る・やりなおす・誤タップ防止。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { open, base, AFTER_SCREEN_CHANGE_MS } from './helpers.mjs';

const QUESTIONS = YAML.parse(readFileSync(new URL('../../data/questions.yaml', import.meta.url), 'utf8'));

const visibleScreen = (page) =>
  page.evaluate(() => [...document.querySelectorAll('main > .screen')].filter((s) => !s.hidden).map((s) => s.id));

// 見えている画面の、指定ラベルのボタンをタップする。
async function tap(page, label) {
  await page.locator('main > .screen:not([hidden])').getByRole('button', { name: label, exact: true })
    .or(page.locator('main > .screen:not([hidden])').getByRole('link', { name: label, exact: true }))
    .tap();
  await page.waitForTimeout(AFTER_SCREEN_CHANGE_MS);
}

test('トップから結果まで 4 タップ（5 タップ以内）', async () => {
  const { context, page } = await open();
  let taps = 0;
  await tap(page, 'はじめる'); taps++;
  await tap(page, '機械や設備を入れたい'); taps++;
  await tap(page, '養殖'); taps++;
  await tap(page, '自分ひとり'); taps++;
  assert.deepEqual(await visibleScreen(page), ['result']);
  assert.equal(new URL(page.url()).hash, '#result/equipment/aquaculture/individual');
  assert.ok(taps <= 5);
  await context.close();
});

test('どの質問にも「わからない」があり、選ぶと次へ進む', async () => {
  const { context, page } = await open('#q1');
  await page.waitForTimeout(AFTER_SCREEN_CHANGE_MS);
  for (let i = 0; i < QUESTIONS.length; i++) {
    assert.deepEqual(await visibleScreen(page), [`q${i + 1}`]);
    await tap(page, 'わからない');
  }
  assert.equal(new URL(page.url()).hash, '#result/unknown/unknown/unknown');
  await context.close();
});

test('質問の選択肢は questions.yaml と同じ順・同じ文言', async () => {
  const { context, page } = await open();
  for (let i = 0; i < QUESTIONS.length; i++) {
    const labels = await page.locator(`#q${i + 1} [data-value]`).allTextContents();
    assert.deepEqual(labels, QUESTIONS[i].options.map((o) => o.label));
    assert.equal((await page.textContent(`#q${i + 1} h1`)).trim(), QUESTIONS[i].text);
  }
  await context.close();
});

test('「もどる」で 1 つ前の質問に、答えを保ったまま戻る', async () => {
  const { context, page } = await open('#q3/fuel_cost/set_net');
  await page.waitForTimeout(AFTER_SCREEN_CHANGE_MS);
  await tap(page, 'もどる');
  assert.equal(new URL(page.url()).hash, '#q2/fuel_cost');
  await tap(page, 'もどる');
  assert.equal(new URL(page.url()).hash, '#q1');
  await tap(page, 'もどる');
  assert.deepEqual(await visibleScreen(page), ['top']);
  await context.close();
});

test('スマホの「戻る」（ブラウザの戻る）で前の画面に戻る', async () => {
  const { context, page } = await open();
  await tap(page, 'はじめる');
  await tap(page, '船・エンジンを新しくしたい');
  await page.goBack();
  assert.deepEqual(await visibleScreen(page), ['q1']);
  await page.goBack();
  assert.deepEqual(await visibleScreen(page), ['top']);
  await context.close();
});

test('「最初からやりなおす」はトップ以外で出て、押すとトップに戻る', async () => {
  const { context, page } = await open();
  assert.equal(await page.isVisible('[data-restart]'), false);
  await tap(page, 'はじめる');
  assert.equal(await page.isVisible('[data-restart]'), true);
  await tap(page, '船・エンジンを新しくしたい');
  await Promise.all([page.waitForURL(base), page.locator('[data-restart]').tap()]);
  assert.deepEqual(await visibleScreen(page), ['top']);
  assert.equal(new URL(page.url()).hash, '');
  await context.close();
});

test('電話ボタンは全画面に見えている', async () => {
  for (const path of ['', '#q1', '#q2/boat_engine', '#q3/boat_engine/vessel', '#result/boat_engine/vessel/group']) {
    const { context, page } = await open(path);
    assert.equal(await page.isVisible('.btn-tel'), true, `画面 ${path || 'トップ'}`);
    await context.close();
  }
});

test('おかしな URL（知らない値・答えの数の不一致）はトップに戻す', async () => {
  for (const path of ['#q2/hacked', '#q3/boat_engine', '#result/a/b/c', '#q9', '#<script>']) {
    const { context, page } = await open(path);
    assert.deepEqual(await visibleScreen(page), ['top'], path);
    await context.close();
  }
});

test('2度押ししても次の質問まで答えてしまわない', async () => {
  const { context, page } = await open('#q1');
  await page.waitForTimeout(AFTER_SCREEN_CHANGE_MS);
  const button = page.locator('#q1 [data-value="boat_engine"]');
  const box = await button.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(150);
  await page.touchscreen.tap(x, y); // 同じ位置。ここには 2 問目の選択肢がある
  await page.waitForTimeout(AFTER_SCREEN_CHANGE_MS);
  assert.deepEqual(await visibleScreen(page), ['q2']);
  assert.equal(new URL(page.url()).hash, '#q2/boat_engine');
  await context.close();
});

test('画面が変わると見出しにフォーカスが移る（読み上げソフト向け）', async () => {
  const { context, page } = await open();
  await tap(page, 'はじめる');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'q1-title');
  await context.close();
});

test('全画面を通して、外部への通信・Cookie・保存・コンソールエラーがない', async () => {
  const { context, page, requests, consoleErrors } = await open();
  await tap(page, 'はじめる');
  await tap(page, 'わからない');
  await tap(page, 'その他');
  await tap(page, '仲間や漁協といっしょに');
  assert.deepEqual(requests.filter((u) => !u.startsWith(base)), []);
  assert.deepEqual(await context.cookies(), []);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(consoleErrors, []);
  await context.close();
});
