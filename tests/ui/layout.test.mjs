// 画面の自動チェック: 360px 幅でのアクセシビリティ要件（完了条件）。全画面で同じ検査をする。
// 実機（高齢者のスマホ）での確認の代わりにはならない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { open, AXE_PATH, SCREENS } from './helpers.mjs';

for (const [name, path] of SCREENS) {
  test(`${name}: 360px 幅で横スクロールが出ない`, async () => {
    const { context, page } = await open(path);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(scrollWidth <= clientWidth, `scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
    await context.close();
  });

  test(`${name}: 文字は本文 20px 以上、ボタン内 22px 以上（ふりがなは除く）`, async () => {
    const { context, page } = await open(path);
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

  test(`${name}: タップできるものは高さ 56px 以上、互いに 12px 以上離れている`, async () => {
    const { context, page } = await open(path);
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

  test(`${name}: axe で WCAG 2.1 A/AA の違反がない（コントラストを含む）`, async () => {
    const { context, page } = await open(path, { bypassCSP: true });
    await page.addScriptTag({ path: AXE_PATH });
    const result = await page.evaluate(() =>
      window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
    const violations = result.violations.map((v) => `${v.id}: ${v.help}（${v.nodes.map((n) => n.target.join(' ')).join(', ')}）`);
    assert.deepEqual(violations, []);
    assert.ok(result.passes.some((p) => p.id === 'color-contrast'), 'コントラストの検査が実行されていません');
    await context.close();
  });
}

test('電話リンクはどれも site.yaml の番号の tel: リンク', async () => {
  const { context, page } = await open();
  const site = (await import('yaml')).default.parse(readFileSync(new URL('../../data/site.yaml', import.meta.url), 'utf8'));
  const hrefs = await page.locator('a[href^="tel:"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  assert.equal(hrefs.length, 2);
  for (const href of hrefs) assert.equal(href, `tel:${site.phone.replace(/\D/g, '')}`);
  assert.ok((await page.textContent('.btn-tel')).includes(site.phone));
  assert.ok((await page.getAttribute('.btn-tel-mini', 'aria-label')).includes(site.phone));
  await context.close();
});

for (const [name, path] of SCREENS) {
  test(`${name}: スクロールしなくても電話リンクが見えている（360×640）`, async () => {
    const { context, page } = await open(path);
    const box = await page.locator('.btn-tel-mini').boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 640, `電話リンクの位置 ${JSON.stringify(box)}`);
    await context.close();
  });
}
