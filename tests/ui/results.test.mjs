// 結果画面のテスト。補助金データはすべて架空（example.com）で、日付は固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startSite, makeDataDir, layoutProblems } from './helpers.mjs';

const TODAY = '2026-10-24';
const NOW = new Date('2026-10-24T12:00:00+09:00');

const fake = (id, match, extra = {}) => ({
  id,
  name: `架空の制度 ${id}（テスト用）`,
  plain_name: `テスト ${id}`,
  level: 'national',
  provider: '架空の機関',
  summary_plain: `${id} はテスト用の架空データです。`,
  match: { purposes: ['any'], fishery_types: ['any'], applicant: ['any'], ...match },
  amount_note: '要確認',
  deadline: null,
  contact_note: '漁協の窓口',
  source_url: `https://example.com/${id}`,
  checked_date: '2026-10-01',
  checked_by: 'secret-checker-name',
  status: 'open',
  ...extra,
});

const FIXTURES = [
  fake('a', { purposes: ['equipment'], fishery_types: ['aquaculture'] }, { deadline: '2026-12-01' }),
  fake('b', { purposes: ['fuel_cost'], applicant: ['group'] }, { checked_date: '2026-06-01' }), // 古い（145日）
  fake('c', { purposes: ['equipment', 'boat_engine'] }, { deadline: '2026-11-01', status: 'upcoming' }),
  fake('d', { purposes: ['equipment'] }, { deadline: '2026-10-23' }), // 締切切れ
  fake('e', { purposes: ['equipment'] }, { status: 'closed' }),
  fake('f', { purposes: ['equipment'] }, { deadline: TODAY }), // 締切当日
];

const site = await startSite({ dataDir: makeDataDir(FIXTURES), today: TODAY, now: NOW });

const cardTitles = (page, list) =>
  page.locator(`#screen-result [${list}] .card :is(h2, h3)`).allTextContents();
const visible = (page, sel) => page.isVisible(`#screen-result ${sel}`);

test('当てはまるものを締切の近い順に出す（締切切れ・closed は出さない、締切当日は出す）', async () => {
  const { context, page } = await site.open('#result/equipment/aquaculture/individual');
  assert.deepEqual(await cardTitles(page, 'data-hit-list'), ['テスト f', 'テスト c', 'テスト a']);
  assert.equal((await page.textContent('[data-hit-count]')).trim(), '3けん');
  assert.equal(await visible(page, '[data-none]'), false);
  assert.equal(await visible(page, '[data-empty]'), false);
  await context.close();
});

test('「当てはまるかもしれません。漁協に相談」を出し、「対象です」と断定しない', async () => {
  for (const path of ['#result/equipment/aquaculture/individual', '#result/processing_sales/vessel/individual']) {
    const { context, page } = await site.open(path);
    const text = await page.locator('#screen-result').innerText();
    assert.match(text, /当てはまるかもしれません。/);
    assert.match(text, /漁協に 相談して ください/);
    for (const ng of ['対象です', '対象になります', '申請できます', '使えます']) {
      assert.ok(!text.includes(ng), `「${ng}」が含まれています`);
    }
    await context.close();
  }
});

test('カードに締切・募集前・古い情報の表示が出る', async () => {
  const { context, page } = await site.open('#result/unknown/unknown/unknown');
  const cards = page.locator('[data-hit-list] .card');
  assert.equal(await cards.count(), 4);
  const byTitle = async (t) => cards.filter({ has: page.locator('h2', { hasText: t }) }).innerText();
  assert.match(await byTitle('テスト a'), /しめきり：2026年12月1日/);
  assert.match(await byTitle('テスト b'), /しめきり：決まっていません/);
  assert.match(await byTitle('テスト b'), /情報が古い可能性があります/);
  assert.doesNotMatch(await byTitle('テスト a'), /情報が古い/);
  assert.match(await byTitle('テスト c'), /まだ 募集は 始まって いません/);
  await context.close();
});

test('「わからない」は条件をゆるめる（全部わからない → 一覧に出せる全件）', async () => {
  const { context, page } = await site.open('#result/unknown/unknown/unknown');
  assert.deepEqual(await cardTitles(page, 'data-hit-list'), ['テスト f', 'テスト c', 'テスト a', 'テスト b']);
  await context.close();
});

test('0 件なら「見つかりませんでした」・電話ボタン・ほかの補助金（全件）を出す', async () => {
  const { context, page } = await site.open('#result/processing_sales/vessel/individual');
  assert.equal(await visible(page, '[data-hits]'), false);
  assert.equal(await visible(page, '[data-none]'), true);
  assert.equal(await visible(page, '[data-none] .btn-tel'), true);
  assert.deepEqual(await cardTitles(page, 'data-other-list'), ['テスト f', 'テスト c', 'テスト a', 'テスト b']);
  await context.close();
});

test('あなたのこたえ に選んだ文言を出す', async () => {
  const { context, page } = await site.open('#result/equipment/unknown/group');
  assert.deepEqual(await page.locator('[data-answers] li').allTextContents(),
    ['機械や設備を 入れたい', 'わからない', '仲間や 漁協と いっしょに']);
  await context.close();
});

for (const [name, path] of [
  ['結果あり', '#result/unknown/unknown/unknown'],
  ['結果0件', '#result/processing_sales/vessel/individual'],
]) {
  test(`${name}: 横スクロール・文字の大きさ・タップ領域・WCAG 2.1 AA（360px）`, async () => {
    const { context, page, consoleErrors } = await site.open(path, { bypassCSP: true });
    assert.deepEqual(await layoutProblems(page), []);
    assert.deepEqual(consoleErrors, []);
    await context.close();
  });
}

test('checked_by（確認者）は公開するファイルに含めない', () => {
  const html = readFileSync(join(site.outDir, 'index.html'), 'utf8');
  assert.ok(!html.includes('secret-checker-name'));
  assert.ok(!html.includes('"checked_by"'));
  assert.ok(!html.includes('テスト d') && !html.includes('テスト e'), 'ビルド時点で出せないものは含めない');
});

test('ビルド後に締切を過ぎたものは、閲覧日で判定して出さない', async () => {
  const later = await startSite({
    dataDir: makeDataDir([fake('g', {}, { deadline: '2026-10-30' }), fake('h', {})]),
    today: TODAY,
    now: new Date('2026-11-05T09:00:00+09:00'),
  });
  const { context, page } = await later.open('#result/unknown/unknown/unknown');
  assert.deepEqual(await cardTitles(page, 'data-hit-list'), ['テスト h']);
  await context.close();
});

test('閲覧日で 90 日を超えたら「情報が古い可能性があります」', async () => {
  const later = await startSite({
    dataDir: makeDataDir([fake('i', {}, { checked_date: '2026-10-01' })]),
    today: TODAY,
    now: new Date('2026-12-31T09:00:00+09:00'), // 91 日後
  });
  const { context, page } = await later.open('#result/unknown/unknown/unknown');
  assert.match(await page.locator('[data-hit-list] .card').innerText(), /情報が古い可能性があります/);
  await context.close();
});

test('データの文字は HTML として解釈しない', async () => {
  const xss = await startSite({
    dataDir: makeDataDir([fake('j', {}, { plain_name: '<img src=x onerror="window.__pwned=1">', summary_plain: '</script><b>x</b>' })]),
    today: TODAY,
    now: NOW,
  });
  const { context, page, consoleErrors } = await xss.open('#result/unknown/unknown/unknown');
  assert.equal(await page.locator('[data-hit-list] img, [data-hit-list] b').count(), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.match(await page.locator('[data-hit-list] .card').innerText(), /<img src=x/);
  assert.deepEqual(consoleErrors, []);
  await context.close();
});

test('データが 0 件なら「じゅんびして います」と電話ボタン', async () => {
  const empty = await startSite({ dataDir: makeDataDir([]), today: TODAY, now: NOW });
  const { context, page } = await empty.open('#result/unknown/unknown/unknown', { bypassCSP: true });
  assert.equal(await page.isVisible('[data-empty]'), true);
  assert.equal(await page.isVisible('[data-empty] .btn-tel'), true);
  assert.equal(await page.isVisible('[data-hits]'), false);
  assert.equal(await page.isVisible('[data-none]'), false);
  assert.deepEqual(await layoutProblems(page), []);
  await context.close();
});
