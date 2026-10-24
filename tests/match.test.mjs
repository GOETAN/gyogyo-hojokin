// src/match.js（絞り込み・表示の判定）のテスト。データはすべて架空。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matches, isListed, isStale, sortByDeadline, selectResults, formatDate, daysBetween, todayJST,
} from '../src/match.js';

const KEYS = ['purposes', 'fishery_types', 'applicant'];
const TODAY = '2026-10-24';

const s = (id, match = {}, extra = {}) => ({
  id, plain_name: id, status: 'open', deadline: null, checked_date: '2026-10-01',
  match: { purposes: ['any'], fishery_types: ['any'], applicant: ['any'], ...match },
  ...extra,
});

test('質問どうしは AND', () => {
  const x = s('x', { purposes: ['equipment'], fishery_types: ['aquaculture'] });
  assert.equal(matches(x, ['equipment', 'aquaculture', 'individual'], KEYS), true);
  assert.equal(matches(x, ['equipment', 'vessel', 'individual'], KEYS), false);
  assert.equal(matches(x, ['fuel_cost', 'aquaculture', 'individual'], KEYS), false);
});

test('データ側の複数の値は OR', () => {
  const x = s('x', { fishery_types: ['vessel', 'set_net'] });
  assert.equal(matches(x, ['equipment', 'vessel', 'group'], KEYS), true);
  assert.equal(matches(x, ['equipment', 'set_net', 'group'], KEYS), true);
  assert.equal(matches(x, ['equipment', 'aquaculture', 'group'], KEYS), false);
});

test('「わからない」はその質問を条件にしない', () => {
  const x = s('x', { purposes: ['equipment'], fishery_types: ['aquaculture'], applicant: ['group'] });
  assert.equal(matches(x, ['unknown', 'aquaculture', 'group'], KEYS), true);
  assert.equal(matches(x, ['unknown', 'unknown', 'unknown'], KEYS), true);
  assert.equal(matches(x, ['unknown', 'vessel', 'unknown'], KEYS), false);
});

test('データ側の any はどの答えにも当てはまる', () => {
  assert.equal(matches(s('x'), ['processing_sales', 'other', 'individual'], KEYS), true);
});

test('一覧に出すのは closed でなく、締切が今日以降か未定のもの', () => {
  assert.equal(isListed(s('a'), TODAY), true);
  assert.equal(isListed(s('a', {}, { deadline: TODAY }), TODAY), true, '締切当日は出す');
  assert.equal(isListed(s('a', {}, { deadline: '2026-10-23' }), TODAY), false);
  assert.equal(isListed(s('a', {}, { status: 'closed' }), TODAY), false);
  assert.equal(isListed(s('a', {}, { status: 'upcoming', deadline: '2026-12-01' }), TODAY), true);
});

test('確認日から 90 日までは古くない、91 日目から古い', () => {
  assert.equal(daysBetween('2026-07-26', TODAY), 90);
  assert.equal(isStale(s('a', {}, { checked_date: '2026-07-26' }), TODAY), false);
  assert.equal(isStale(s('a', {}, { checked_date: '2026-07-25' }), TODAY), true);
});

test('日数の計算はうるう年・夏時間に影響されない', () => {
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
  assert.equal(daysBetween('2026-03-01', '2026-11-30'), 274);
});

test('締切の近い順、締切なしは最後', () => {
  const list = [s('none'), s('dec', {}, { deadline: '2026-12-01' }), s('nov', {}, { deadline: '2026-11-01' })];
  assert.deepEqual(sortByDeadline(list).map((x) => x.id), ['nov', 'dec', 'none']);
});

test('当てはまるものがあれば others は空', () => {
  const r = selectResults([s('a', { purposes: ['equipment'] }), s('b', { purposes: ['fuel_cost'] })],
    ['equipment', 'vessel', 'individual'], KEYS, TODAY);
  assert.deepEqual(r.hits.map((x) => x.id), ['a']);
  assert.deepEqual(r.others, []);
  assert.equal(r.listedCount, 2);
});

test('0 件なら others に一覧に出せる全件（締切切れ・closed は除く）', () => {
  const r = selectResults([
    s('a', { purposes: ['fuel_cost'] }),
    s('old', { purposes: ['fuel_cost'] }, { deadline: '2026-01-01' }),
    s('closed', {}, { status: 'closed' }),
  ], ['equipment', 'vessel', 'individual'], KEYS, TODAY);
  assert.deepEqual(r.hits, []);
  assert.deepEqual(r.others.map((x) => x.id), ['a']);
});

test('データが 0 件なら listedCount は 0', () => {
  const r = selectResults([], ['unknown', 'unknown', 'unknown'], KEYS, TODAY);
  assert.equal(r.listedCount, 0);
});

test('日付の表示', () => {
  assert.equal(formatDate('2026-12-01'), '2026年12月1日');
});

test('todayJST は日本時間で日付を切り替える', () => {
  assert.equal(todayJST(new Date('2026-10-24T14:59:59Z')), '2026-10-24');
  assert.equal(todayJST(new Date('2026-10-24T15:00:00Z')), '2026-10-25');
});
