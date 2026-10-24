// tools/lib/data.mjs の検証ロジックのテスト。
// ここで使う補助金データはすべて架空（example.com）。data/ には置かない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { loadData, DATA_DIR } from '../tools/lib/data.mjs';

const TODAY = '2026-10-24';

const SITE = { kumiai_name: 'テスト漁業協同組合', phone: '000-000-0000', hours: '平日 9時〜17時' };

function subsidy(overrides = {}) {
  return {
    id: 'test-one',
    name: '架空の補助金（テスト用）',
    plain_name: 'テスト用',
    level: 'national',
    provider: '架空の機関',
    summary_plain: 'テスト用の架空データです。',
    match: { purposes: ['equipment'], fishery_types: ['any'], applicant: ['any'] },
    amount_note: '要確認',
    deadline: null,
    contact_note: '漁協の窓口',
    source_url: 'https://example.com/test',
    checked_date: '2026-10-01',
    checked_by: 'tester',
    status: 'open',
    ...overrides,
  };
}

// 一時ディレクトリに data/ 相当を作る。questions.yaml は本物を使う。
function makeDir({ site = SITE, noSite = false, subsidies = [], questions } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hojokin-test-'));
  mkdirSync(join(dir, 'subsidies'));
  if (!noSite) writeFileSync(join(dir, 'site.yaml'), YAML.stringify(site));
  if (questions) writeFileSync(join(dir, 'questions.yaml'), YAML.stringify(questions));
  else copyFileSync(join(DATA_DIR, 'questions.yaml'), join(dir, 'questions.yaml'));
  for (const [name, doc] of subsidies) {
    writeFileSync(join(dir, 'subsidies', name), typeof doc === 'string' ? doc : YAML.stringify(doc));
  }
  return dir;
}

const run = (opts) => loadData(makeDir(opts), { today: TODAY });
const msgs = (r) => r.errors.map((e) => `${e.path} ${e.msg}`).join('\n');

test('正しいデータは通る', async () => {
  const r = await run({ subsidies: [['test-one.yaml', subsidy()]] });
  assert.equal(r.errors.length, 0, msgs(r));
  assert.equal(r.subsidies.length, 1);
});

test('補助金 0 件でも通る（準備中表示になる）', async () => {
  const r = await run();
  assert.equal(r.errors.length, 0, msgs(r));
  assert.equal(r.subsidies.length, 0);
});

test('YAML の日付は引用符なしでも文字列として読まれる', async () => {
  const yaml = YAML.stringify(subsidy()).replace("checked_date: '2026-10-01'", 'checked_date: 2026-10-01');
  assert.match(yaml, /checked_date: 2026-10-01/);
  const r = await run({ subsidies: [['test-one.yaml', yaml]] });
  assert.equal(r.errors.length, 0, msgs(r));
});

for (const key of ['source_url', 'checked_date', 'checked_by', 'amount_note', 'status', 'deadline']) {
  test(`必須項目 ${key} がなければエラー（ルール3: 出典・確認日なしは出さない）`, async () => {
    const doc = subsidy();
    delete doc[key];
    const r = await run({ subsidies: [['test-one.yaml', doc]] });
    assert.ok(r.errors.some((e) => e.msg.includes(key)), msgs(r));
    assert.equal(r.subsidies.length, 0);
  });
}

test('出典が空文字・http はエラー', async () => {
  for (const url of ['', 'http://example.com/x', 'example.com']) {
    const r = await run({ subsidies: [['test-one.yaml', subsidy({ source_url: url })]] });
    assert.ok(r.errors.length > 0, `url=${url}`);
  }
});

test('未来の確認日はエラー', async () => {
  const r = await run({ subsidies: [['test-one.yaml', subsidy({ checked_date: '2026-10-25' })]] });
  assert.match(msgs(r), /未来/);
});

test('存在しない日付・形式違いの日付はエラー', async () => {
  for (const d of ['2026-02-30', '2026/10/01', '令和8年10月1日']) {
    const r = await run({ subsidies: [['test-one.yaml', subsidy({ deadline: d })]] });
    assert.ok(r.errors.length > 0, `deadline=${d}`);
  }
});

test('id とファイル名の不一致はエラー', async () => {
  const r = await run({ subsidies: [['other-name.yaml', subsidy()]] });
  assert.match(msgs(r), /一致しません/);
});

test('id の重複はエラー', async () => {
  const r = await run({ subsidies: [['test-one.yaml', subsidy()], ['test-one.yml', subsidy()]] });
  assert.match(msgs(r), /重複/);
});

test('選択肢にない値・any と他の値の併記はエラー', async () => {
  let r = await run({ subsidies: [['test-one.yaml', subsidy({ match: { purposes: ['boat'], fishery_types: ['any'], applicant: ['any'] } })]] });
  assert.match(msgs(r), /使えません/);
  r = await run({ subsidies: [['test-one.yaml', subsidy({ match: { purposes: ['any', 'equipment'], fishery_types: ['any'], applicant: ['any'] } })]] });
  assert.match(msgs(r), /単独/);
});

test('「わからない」は質問の値として使えない（unknown はデータ側では不可）', async () => {
  const r = await run({ subsidies: [['test-one.yaml', subsidy({ match: { purposes: ['unknown'], fishery_types: ['any'], applicant: ['any'] } })]] });
  assert.ok(r.errors.length > 0);
});

test('知らない項目（綴り違い）はエラー', async () => {
  const r = await run({ subsidies: [['test-one.yaml', { ...subsidy(), dedline: '2026-12-01' }]] });
  assert.match(msgs(r), /dedline/);
});

test('締切切れで closed でないものは警告（エラーではない）', async () => {
  const r = await run({ subsidies: [['test-one.yaml', subsidy({ deadline: '2026-10-23' })]] });
  assert.equal(r.errors.length, 0, msgs(r));
  assert.equal(r.warnings.length, 1);
});

test('締切当日は警告しない', async () => {
  const r = await run({ subsidies: [['test-one.yaml', subsidy({ deadline: TODAY })]] });
  assert.equal(r.warnings.length, 0);
});

test('site.yaml が未記入・電話番号の形式違いはエラー', async () => {
  let r = await run({ site: { kumiai_name: null, phone: null, hours: null } });
  assert.equal(r.errors.length, 3, msgs(r));
  r = await run({ site: { ...SITE, phone: '0000000000' } });
  assert.match(msgs(r), /phone/);
  r = await run({ noSite: true });
  assert.match(msgs(r), /ファイルがありません/);
});

test('質問に「わからない」がない・選択肢の過不足はエラー', async () => {
  const q = YAML.parse((await import('node:fs')).readFileSync(join(DATA_DIR, 'questions.yaml'), 'utf8'));
  q[1].options = q[1].options.filter((o) => o.value !== 'unknown' && o.value !== 'set_net');
  const r = await run({ questions: q });
  assert.match(msgs(r), /わからない/);
  assert.match(msgs(r), /set_net/);
});

test('本物の questions.yaml は schema と整合している', async () => {
  const r = await run();
  assert.ok(!r.errors.some((e) => e.file.endsWith('questions.yaml')), msgs(r));
});
