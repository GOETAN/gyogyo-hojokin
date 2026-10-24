// 絞り込みと表示の判定。ブラウザ（app.js）・ビルド・テストが同じものを使う。
// 日付はすべて 'YYYY-MM-DD' の文字列で扱い、日本時間で判定する。

export const UNKNOWN = 'unknown';
export const ANY = 'any';
export const STALE_DAYS = 90;

// 日本時間の今日を YYYY-MM-DD で返す。
export function todayJST(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

const toUTC = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / 86400000);
}

// 一覧に出してよいか。closed と締切を過ぎたものは出さない。締切当日は出す。
export function isListed(s, today) {
  return s.status !== 'closed' && (s.deadline == null || s.deadline >= today);
}

// 確認日から STALE_DAYS 日を超えたら「情報が古い可能性があります」。
export function isStale(s, today) {
  return daysBetween(s.checked_date, today) > STALE_DAYS;
}

// keys[i] は i 問目の match のキー、answers[i] はその答え。
// 質問どうしは AND、データ側の値（1 問の中の候補）は OR。
// 「わからない」はその質問を条件にしない。データ側の any はどの答えにも当てはまる。
export function matches(s, answers, keys) {
  return keys.every((key, i) => {
    const a = answers[i];
    if (a === UNKNOWN) return true;
    const values = s.match[key];
    return values.includes(ANY) || values.includes(a);
  });
}

// 締切の近い順。締切なし（随時・未定）は最後。同じなら名前順で、表示順を毎回同じにする。
export function sortByDeadline(list) {
  return [...list].sort((a, b) => {
    if (a.deadline !== b.deadline) {
      if (a.deadline == null) return 1;
      if (b.deadline == null) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    }
    return a.plain_name.localeCompare(b.plain_name, 'ja');
  });
}

// 結果画面に出すもの。
//   hits:   当てはまるかもしれないもの
//   others: hits が 0 件のときだけ、一覧に出せる全件
//   listedCount: 一覧に出せる件数（0 なら「準備中」）
export function selectResults(subsidies, answers, keys, today) {
  const listed = sortByDeadline(subsidies.filter((s) => isListed(s, today)));
  const hits = listed.filter((s) => matches(s, answers, keys));
  return { hits, others: hits.length ? [] : listed, listedCount: listed.length };
}

export function formatDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}
