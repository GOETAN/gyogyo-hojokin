// 詳細画面のテスト。補助金データはすべて架空（example.com）で、日付は固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSite, makeDataDir, layoutProblems, AFTER_SCREEN_CHANGE_MS } from './helpers.mjs';

const TODAY = '2026-10-24';
const NOW = new Date('2026-10-24T12:00:00+09:00');

const fake = (id, match, extra = {}) => ({
  id,
  name: `架空の制度 ${id} 正式名称（テスト用）`,
  plain_name: `テスト ${id}`,
  level: 'national',
  provider: `架空の機関 ${id}`,
  summary_plain: `${id} はテスト用の架空データです。`,
  match: { purposes: ['any'], fishery_types: ['any'], applicant: ['any'], ...match },
  amount_note: '補助率 1/2 以内\n上限 100万円（架空）',
  deadline: '2026-12-01',
  contact_note: `${id} の相談先（架空）`,
  source_url: `https://example.com/${id}`,
  checked_date: '2026-10-01',
  checked_by: 'tester',
  status: 'open',
  ...extra,
});

const site = await startSite({
  dataDir: makeDataDir([
    fake('a', { purposes: ['equipment'] }),
    fake('b', { purposes: ['fuel_cost'] }, { deadline: null, status: 'upcoming', checked_date: '2026-06-01' }),
    fake('c', { purposes: ['equipment'] }, { deadline: '2026-10-30' }),
  ]),
  today: TODAY,
  now: NOW,
});

const visibleScreen = (page) =>
  page.evaluate(() => [...document.querySelectorAll('main > .screen')].filter((s) => !s.hidden).map((s) => s.id.replace(/^screen-/, '')));
const waitScreen = (page, id) =>
  page.waitForFunction((id) => !document.getElementById(`screen-${id}`).hidden, id);
const field = (page, f) => page.locator(`#screen-detail [data-f="${f}"]`).innerText();

test('結果のカードの「くわしく みる」で詳細へ進み、トップから 5 タップで詳細まで届く', async () => {
  const { context, page } = await site.open();
  for (const label of ['はじめる', '機械や設備を 入れたい', '養殖', '自分ひとり']) {
    await page.locator('main > .screen:not([hidden])').getByText(label, { exact: true }).tap();
    await page.waitForTimeout(AFTER_SCREEN_CHANGE_MS);
  }
  const card = page.locator('[data-hit-list] .card', { has: page.locator('h2', { hasText: 'テスト a' }) });
  await card.getByRole('link', { name: 'くわしく みる' }).tap();
  await waitScreen(page, 'detail');
  assert.deepEqual(await visibleScreen(page), ['detail']);
  assert.equal(new URL(page.url()).hash, '#detail/a/equipment/aquaculture/individual');
  assert.equal(await field(page, 'plain_name'), 'テスト a');
  await context.close();
});

test('詳細に やさしい説明・締切・補助の割合と上限（原文どおり）・相談先・正式名称・実施機関・確認日を出す', async () => {
  const { context, page } = await site.open('#detail/a/equipment/vessel/group');
  assert.equal(await field(page, 'summary_plain'), 'a はテスト用の架空データです。');
  assert.equal(await field(page, 'deadline'), '2026年12月1日');
  assert.equal(await field(page, 'amount_note'), '補助率 1/2 以内\n上限 100万円（架空）');
  assert.equal(await field(page, 'contact_note'), 'a の相談先（架空）');
  assert.equal(await field(page, 'name'), '架空の制度 a 正式名称（テスト用）');
  assert.equal(await field(page, 'provider'), '架空の機関 a');
  assert.equal(await field(page, 'checked_date'), '2026年10月1日');
  assert.equal(await page.isVisible('#screen-detail [data-stale]'), false);
  assert.equal(await page.isVisible('#screen-detail [data-upcoming]'), false);
  await context.close();
});

test('出典リンクは https・新しいタブ・参照元を送らない。外のサイトであることを書き添える', async () => {
  const { context, page } = await site.open('#detail/a/equipment/vessel/group');
  const link = page.locator('#screen-detail [data-source-link]');
  assert.equal(await link.getAttribute('href'), 'https://example.com/a');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.match(await link.getAttribute('rel'), /noopener/);
  assert.match(await link.getAttribute('rel'), /noreferrer/);
  assert.match(await page.locator('#screen-detail [data-source-note]').innerText(), /外の サイト（example\.com）が ひらきます/);
  await context.close();
});

test('一番目立つ電話ボタンは、スクロールしなくても見える位置にある（360×640）', async () => {
  const { context, page } = await site.open('#detail/a/equipment/vessel/group');
  const box = await page.locator('[data-detail-tel]').boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= 640, `電話ボタンの位置 ${JSON.stringify(box)}`);
  assert.ok(box.height >= 72, '他のボタンより大きい');
  await context.close();
});

test('締切未定・募集前・古い情報の表示', async () => {
  const { context, page } = await site.open('#detail/b/fuel_cost/unknown/unknown');
  assert.match(await field(page, 'deadline'), /決まっていません/);
  assert.equal(await page.isVisible('#screen-detail [data-upcoming]'), true);
  assert.equal(await page.isVisible('#screen-detail [data-stale]'), true);
  await context.close();
});

test('注意書きは、こたえに合ったものなら「当てはまるかもしれません」、合わないものなら別の文', async () => {
  let { context, page } = await site.open('#detail/a/equipment/vessel/group');
  assert.equal(await page.isVisible('[data-notice-match]'), true);
  assert.equal(await page.isVisible('[data-notice-other]'), false);
  await context.close();
  ({ context, page } = await site.open('#detail/a/processing_sales/vessel/group'));
  assert.equal(await page.isVisible('[data-notice-match]'), false);
  assert.equal(await page.isVisible('[data-notice-other]'), true);
  const text = await page.locator('#screen-detail').innerText();
  for (const ng of ['対象です', '対象になります', '申請できます']) assert.ok(!text.includes(ng), ng);
  await context.close();
});

test('「けっかに もどる」とスマホの「戻る」で、同じこたえの結果画面に戻る', async () => {
  const { context, page } = await site.open('#result/equipment/vessel/group');
  await page.waitForTimeout(AFTER_SCREEN_CHANGE_MS);
  await page.locator('[data-hit-list] .card').first().getByRole('link', { name: 'くわしく みる' }).tap();
  await waitScreen(page, 'detail');
  await page.goBack();
  await waitScreen(page, 'result');
  await page.locator('[data-hit-list] .card').first().getByRole('link', { name: 'くわしく みる' }).tap();
  await waitScreen(page, 'detail');
  await page.locator('#screen-detail [data-back]').tap();
  await waitScreen(page, 'result');
  assert.deepEqual(await visibleScreen(page), ['result']);
  assert.equal(new URL(page.url()).hash, '#result/equipment/vessel/group');
  await context.close();
});

test('知らない id・こたえの数が合わない詳細 URL', async () => {
  let { context, page } = await site.open('#detail/zzz/equipment/vessel/group');
  assert.deepEqual(await visibleScreen(page), ['result']);
  assert.equal(new URL(page.url()).hash, '#result/equipment/vessel/group');
  await context.close();
  ({ context, page } = await site.open('#detail/a/equipment'));
  assert.deepEqual(await visibleScreen(page), ['top']);
  await context.close();
});

test('閲覧日に締切を過ぎた補助金の詳細 URL は、結果画面に戻す', async () => {
  const later = await startSite({
    dataDir: makeDataDir([fake('c', {}, { deadline: '2026-10-30' })]),
    today: TODAY,
    now: new Date('2026-11-05T09:00:00+09:00'),
  });
  const { context, page } = await later.open('#detail/c/unknown/unknown/unknown');
  assert.deepEqual(await visibleScreen(page), ['result']);
  await context.close();
});

test('詳細: 横スクロール・文字の大きさ・タップ領域・WCAG 2.1 AA（360px）', async () => {
  for (const path of ['#detail/a/equipment/vessel/group', '#detail/b/unknown/unknown/unknown']) {
    const { context, page, consoleErrors } = await site.open(path, { bypassCSP: true });
    assert.deepEqual(await layoutProblems(page), [], path);
    assert.deepEqual(consoleErrors, []);
    await context.close();
  }
});

test('詳細の文字は HTML として解釈しない', async () => {
  const xss = await startSite({
    dataDir: makeDataDir([fake('x', {}, { name: '<img src=x onerror="window.__pwned=1">', amount_note: '<b>bold</b>', contact_note: '</dd><script>window.__pwned=1</script>' })]),
    today: TODAY,
    now: NOW,
  });
  const { context, page, consoleErrors } = await xss.open('#detail/x/unknown/unknown/unknown');
  assert.equal(await page.locator('#screen-detail img, #screen-detail b, #screen-detail dd script').count(), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await field(page, 'amount_note'), '<b>bold</b>');
  assert.deepEqual(consoleErrors, []);
  await context.close();
});
