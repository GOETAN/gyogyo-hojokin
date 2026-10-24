// tools/build.mjs のテスト。検証エラーがあれば何も書き出さないこと。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { build } from '../tools/build.mjs';
import { DATA_DIR } from '../tools/lib/data.mjs';

function makeDataDir(site) {
  const dir = mkdtempSync(join(tmpdir(), 'hojokin-build-'));
  mkdirSync(join(dir, 'subsidies'));
  writeFileSync(join(dir, 'site.yaml'), YAML.stringify(site));
  copyFileSync(join(DATA_DIR, 'questions.yaml'), join(dir, 'questions.yaml'));
  return dir;
}

test('検証エラーがあればビルドは失敗し、出力を作らない', async () => {
  const dataDir = makeDataDir({ kumiai_name: null, phone: null, hours: null });
  const outDir = join(mkdtempSync(join(tmpdir(), 'hojokin-out-')), 'dist');
  await assert.rejects(build({ dataDir, outDir }), /検証エラー 3 件/);
  assert.equal(existsSync(outDir), false);
});

test('値は HTML エスケープされる', async () => {
  const dataDir = makeDataDir({ kumiai_name: '<script>x</script>漁協', phone: '000-000-0000', hours: '平日 & 土曜' });
  const outDir = join(mkdtempSync(join(tmpdir(), 'hojokin-out-')), 'dist');
  await build({ dataDir, outDir });
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;漁協'));
  assert.ok(html.includes('平日 &amp; 土曜'));
  assert.ok(html.includes('href="tel:0000000000"'));
  assert.ok(!/\{\{\w+\}\}/.test(html), '置き換え忘れの {{...}} が残っています');
});
