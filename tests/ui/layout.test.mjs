// 画面の自動チェック: 360px 幅でのアクセシビリティ要件（完了条件）。全画面で同じ検査をする。
// 実機（高齢者のスマホ）での確認の代わりにはならない。
// 本物の data/ でビルドする。結果画面のカード表示は results.test.mjs（架空データ）で検査する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { startSite, layoutProblems, SCREENS } from './helpers.mjs';

const site = await startSite();

for (const [name, path] of SCREENS) {
  test(`${name}: 横スクロール・文字の大きさ・タップ領域・WCAG 2.1 AA（360px）`, async () => {
    const { context, page } = await site.open(path, { bypassCSP: true });
    assert.deepEqual(await layoutProblems(page), []);
    await context.close();
  });

  test(`${name}: スクロールしなくても電話リンクが見えている（360×640）`, async () => {
    const { context, page } = await site.open(path);
    const box = await page.locator('.btn-tel-mini').boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 640, `電話リンクの位置 ${JSON.stringify(box)}`);
    await context.close();
  });
}

test('電話リンクはどれも site.yaml の番号の tel: リンク', async () => {
  const { context, page } = await site.open();
  const data = YAML.parse(readFileSync(new URL('../../data/site.yaml', import.meta.url), 'utf8'));
  const hrefs = await page.locator('a[href^="tel:"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  assert.ok(hrefs.length >= 2);
  for (const href of hrefs) assert.equal(href, `tel:${data.phone.replace(/\D/g, '')}`);
  assert.ok((await page.textContent('.actions .btn-tel')).includes(data.phone));
  assert.ok((await page.getAttribute('.btn-tel-mini', 'aria-label')).includes(data.phone));
  await context.close();
});
