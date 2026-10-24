// 画面の切り替え。状態は URL のハッシュだけに持つ（保存しない）。
//   #top                     トップ
//   #q2/equipment            2問目。1問目の答えが equipment
//   #result/a/b/c            結果。3問の答え
//   #detail/<id>/a/b/c       詳細。補助金の id と 3問の答え（もどる で結果に戻るため）
// ハッシュに持つので、スマホの「戻る」で前の質問に戻れ、再読み込みしても答えが消えない。
// Cookie・localStorage は使わない。

import { selectResults, todayJST, isStale, isListed, matches, formatDate } from './match.js';

{
  const screens = [...document.querySelectorAll('main > .screen')];
  const questions = screens.filter((s) => s.dataset.step);
  const total = questions.length;
  const keys = questions.map((q) => q.dataset.key);
  const restart = document.querySelector('[data-restart]');
  const subsidies = JSON.parse(document.getElementById('subsidies-data').textContent);
  const result = document.getElementById('screen-result');
  const detail = document.getElementById('screen-detail');
  const baseTitle = document.title;

  // 各質問で選べる値。ハッシュを書き換えられても、知らない値は受け付けない。
  const allowed = questions.map((q) =>
    new Set([...q.querySelectorAll('[data-value]')].map((b) => b.dataset.value)));

  const hashFor = (screen, answers) => '#' + [screen, ...answers].join('/');

  const answersValid = (answers, n) => answers.length === n && answers.every((a, i) => allowed[i].has(a));

  // ハッシュを読んで { id, step, answers } にする。おかしなハッシュはトップ扱い。
  // 詳細の補助金が見つからない（閲覧日で締切を過ぎた等）ときは結果画面に戻す。
  function parse(hash) {
    const [id = '', ...answers] = decodeURIComponent(hash.replace(/^#/, '')).split('/');
    if (id === 'detail') {
      const [subsidyId, ...rest] = answers;
      if (!answersValid(rest, total)) return { id: 'top', step: 0, answers: [] };
      const subsidy = subsidies.find((s) => s.id === subsidyId && isListed(s, todayJST()));
      return subsidy
        ? { id: 'detail', step: total + 2, answers: rest, subsidy }
        : { id: 'result', step: total + 1, answers: rest, fallback: true };
    }
    const step = id === 'result' ? total + 1 : /^q\d+$/.test(id) ? Number(id.slice(1)) : 0;
    const valid = step >= 1 && step <= total + 1 && answersValid(answers, step - 1);
    return valid ? { id, step, answers } : { id: 'top', step: 0, answers: [] };
  }

  function show() {
    const { id, step, answers, subsidy, fallback } = parse(location.hash);
    if (id === 'top' && location.hash && location.hash !== '#top') {
      history.replaceState(null, '', '#top');
    }
    if (fallback) history.replaceState(null, '', hashFor('result', answers));
    const current = document.getElementById(`screen-${id}`);
    for (const s of screens) s.hidden = s !== current;

    // もどる: 1つ前の画面へ。直接このURLを開いた人でもサイトの外に出ないよう、history.back() は使わない。
    const back = current.querySelector('[data-back]');
    if (back) {
      back.href = id === 'detail' ? hashFor('result', answers)
        : step <= 1 ? '#top' : hashFor(`q${step - 1}`, answers.slice(0, step - 2));
    }
    if (restart) restart.hidden = id === 'top';
    if (id === 'result') renderResults(answers);
    if (id === 'detail') renderDetail(subsidy, answers);

    const heading = current.querySelector('h1');
    document.title = id === 'top' ? baseTitle : `${heading.textContent.trim()}｜${baseTitle}`;
    window.scrollTo(0, 0);
    // 読み上げソフトが新しい画面の見出しから読むように、見出しへフォーカスを移す（初回表示は除く）。
    if (shown) heading.focus({ preventScroll: true });
    shown = true;
    shownAt = performance.now();
  }
  let shown = false;
  let shownAt = 0;

  // 画面が切り替わった直後のタップは無視する。2度押しすると、次の画面の同じ位置の
  // 選択肢まで押してしまうため（指が震える・反応が遅いと感じて押し直す、を想定）。
  const TAP_GUARD_MS = 500;

  // 選択肢: 選んだらすぐ次の画面へ（確認ボタンを挟まない。5タップ以内の条件のため）。
  for (const q of questions) {
    q.addEventListener('click', (e) => {
      const button = e.target.closest('[data-value]');
      if (!button || performance.now() - shownAt < TAP_GUARD_MS) return;
      const { answers } = parse(location.hash);
      const step = Number(q.dataset.step);
      const next = [...answers.slice(0, step - 1), button.dataset.value];
      location.hash = step < total ? hashFor(`q${step + 1}`, next) : hashFor('result', next);
    });
  }

  // 画面に入れる文字はすべて textContent で入れる（データ由来の文字を HTML として解釈させない）。
  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };
  const deadlineText = (s) => (s.deadline
    ? formatDate(s.deadline)
    : '決まっていません（漁協に 確認して ください）');

  // 結果画面。
  function renderResults(answers) {
    const today = todayJST();

    result.querySelector('[data-answers]').replaceChildren(...answers.map((a, i) =>
      el('li', null, questions[i].querySelector(`[data-value="${CSS.escape(a)}"]`).textContent)));

    const card = (s, headingTag) => {
      const c = el('article', 'card');
      const heading = el(headingTag, null, s.plain_name);
      heading.id = `card-${s.id}`;
      c.append(heading, el('p', null, s.summary_plain));
      c.append(el('p', 'deadline', `しめきり：${deadlineText(s)}`));
      if (s.status === 'upcoming') c.append(el('p', 'upcoming', 'まだ 募集は 始まって いません'));
      if (isStale(s, today)) c.append(el('p', 'stale', '情報が古い可能性があります'));
      const more = el('a', 'btn btn-primary', 'くわしく みる');
      more.href = hashFor(`detail/${s.id}`, answers);
      more.setAttribute('aria-describedby', heading.id); // どのカードの「くわしく」かを読み上げで伝える
      c.append(more);
      return c;
    };

    const { hits, others, listedCount } = selectResults(subsidies, answers, keys, today);
    const hitsBox = result.querySelector('[data-hits]');
    const noneBox = result.querySelector('[data-none]');
    const emptyBox = result.querySelector('[data-empty]');
    hitsBox.hidden = hits.length === 0;
    noneBox.hidden = !(hits.length === 0 && listedCount > 0);
    emptyBox.hidden = listedCount > 0;
    result.querySelector('[data-hit-count]').textContent = `${hits.length}けん`;
    result.querySelector('[data-hit-list]').replaceChildren(...hits.map((s) => card(s, 'h2')));
    result.querySelector('[data-other-list]').replaceChildren(...others.map((s) => card(s, 'h3')));
  }

  // 詳細画面。
  function renderDetail(s, answers) {
    const today = todayJST();
    const set = (field, text) => { detail.querySelector(`[data-f="${field}"]`).textContent = text; };
    set('plain_name', s.plain_name);
    set('summary_plain', s.summary_plain);
    set('deadline', deadlineText(s));
    set('amount_note', s.amount_note);
    set('name', s.name);
    set('provider', s.provider);
    set('contact_note', s.contact_note);
    set('checked_date', formatDate(s.checked_date));

    // こたえに合ったものか（0 件のときの「ほかの補助金」から来たか）で、注意書きを結果画面と同じ文にする。
    const matched = matches(s, answers, keys);
    detail.querySelector('[data-notice-match]').hidden = !matched;
    detail.querySelector('[data-notice-other]').hidden = matched;
    detail.querySelector('[data-upcoming]').hidden = s.status !== 'upcoming';
    detail.querySelector('[data-stale]').hidden = !isStale(s, today);

    // 出典。同じタブで開く（新しいタブだと、iPhone ではタブを切り替えないと戻れず迷いやすいため）。
    // スキーマで https に限っているが、念のためここでも https 以外はリンクにしない。
    const link = detail.querySelector('[data-source-link]');
    const host = detail.querySelector('[data-f="source_host"]');
    let url;
    try { url = new URL(s.source_url); } catch { url = null; }
    const ok = url?.protocol === 'https:';
    link.hidden = !ok;
    link.href = ok ? url.href : '#';
    host.textContent = ok ? url.hostname : '';
    detail.querySelector('[data-source-note]').hidden = !ok;
  }

  window.addEventListener('hashchange', show);
  show();
}
