/* ══════════════════════════════════
   app.js — パパノート
   データ分離設計: DATA_URL を変えるだけで
   Spreadsheet → JSON API に切り替え可能
══════════════════════════════════ */

// ─── 設定 ───────────────────────────────────────────
const DATA_URL = 'data.json'; // 将来: Spreadsheet Apps Script URL に変更

// 妊娠全体 = 280日(40週), 妊娠前 = 2週相当のオフセット
const FULL_PREG_DAYS = 280;

// 妊娠週 → データインデックス マッピング
const PREG_MAP = [
  { range: [4, 7],   idx: 0 },
  { range: [8, 11],  idx: 1 },
  { range: [12, 15], idx: 2 },
  { range: [16, 19], idx: 3 },
  { range: [20, 23], idx: 4 },
  { range: [24, 27], idx: 5 },
  { range: [28, 31], idx: 6 },
  { range: [32, 35], idx: 7 },
  { range: [36, 40], idx: 8 },
];

// 赤ちゃんサイズ → 絵文字
const SIZE_EMOJI = {
  'ブルーベリー': '🫐', 'いちご': '🍓', 'レモン': '🍋', 'アボカド': '🥑',
  'バナナ': '🍌', 'とうもろこし': '🌽', 'キャベツ': '🥬', 'パイナップル': '🍍',
  'すいか': '🍉', '生まれたて': '👶', '小さなぬいぐるみ': '🧸', '文庫本': '📖',
  '500mlペットボトル': '🧴', 'りんご': '🍎', 'メロン（小）': '🍈',
  'スイカ（小）': '🍉', 'ボーリングボール': '🎳', 'スコップ': '🧲',
  '小さなかぼちゃ': '🎃', '小さなバックパック': '🎒',
  '小さなランドセル': '🎒', '1歳の子ども': '🧒',
};

// ─── 状態 ──────────────────────────────────────────
let data = [];
let currentIdx = 0;
let modeSetup = 'future';

// ─── 初期化 ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // データ取得
  try {
    const res = await fetch(DATA_URL);
    data = await res.json();
  } catch (e) {
    console.error('data.json 読込失敗:', e);
    data = [];
  }

  // デフォルト日付(6ヶ月後)
  const def = new Date();
  def.setMonth(def.getMonth() + 6);
  document.getElementById('date-input').value = fmt(def);

  // 既存設定確認
  if (localStorage.getItem('papa_date')) {
    startApp();
  }
});

// ─── ユーティリティ ──────────────────────────────────
function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2,'0'); }
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// ─── セットアップ ────────────────────────────────────
function setMode(m) {
  modeSetup = m;
  document.getElementById('tab-future').classList.toggle('active', m === 'future');
  document.getElementById('tab-past').classList.toggle('active', m === 'past');
  document.getElementById('field-label').textContent =
    m === 'future' ? '出産予定日' : 'お子さんの誕生日';
}

function saveAndStart() {
  const val = document.getElementById('date-input').value;
  if (!val) { alert('日付を選んでください'); return; }
  localStorage.setItem('papa_date', val);
  localStorage.setItem('papa_mode', modeSetup);
  startApp();
}

function resetApp() {
  if (!confirm('設定をリセットしますか？')) return;
  localStorage.removeItem('papa_date');
  localStorage.removeItem('papa_mode');
  localStorage.removeItem('papa_mission_done');
  localStorage.removeItem('papa_mission_date');
  document.getElementById('screen-setup').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

// ─── アプリ起動 ──────────────────────────────────────
function startApp() {
  // セットアップ画面を隠す
  document.getElementById('screen-setup').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // 現在位置を計算
  currentIdx = calcCurrentIndex();

  // 全画面レンダリング
  renderHome();
  renderBaby();
  renderMom();
  renderDad();
  renderVoice();
}

// ─── 現在インデックス計算 ────────────────────────────
function calcCurrentIndex() {
  const saved = localStorage.getItem('papa_date');
  const mode  = localStorage.getItem('papa_mode') || 'future';
  if (!saved || data.length === 0) return 0;

  const today  = new Date(); today.setHours(0,0,0,0);
  const target = new Date(saved); target.setHours(0,0,0,0);

  if (mode === 'future') {
    const toGo = daysBetween(today, target);
    if (toGo < 0) {
      // 予定日過ぎ → 出産後と判断
      const months = Math.floor(Math.abs(toGo) / 30);
      return postBirthIdx(months);
    }
    const pregnant = FULL_PREG_DAYS - toGo;
    if (pregnant <= 0) return 0;
    const weeks = Math.floor(pregnant / 7);
    return pregIdx(weeks);
  } else {
    const since = daysBetween(target, today);
    if (since < 0) return 0;
    const months = Math.floor(since / 30);
    return postBirthIdx(months);
  }
}

function pregIdx(weeks) {
  for (const m of PREG_MAP) {
    if (weeks >= m.range[0] && weeks <= m.range[1]) return m.idx;
  }
  return weeks < 4 ? 0 : 8;
}

function postBirthIdx(months) {
  // インデックス9=生後0ヶ月, 10=1ヶ月 … 21=12ヶ月
  return Math.min(9 + months, data.length - 1);
}

// ─── 週数・日数テキスト生成 ──────────────────────────
function calcStatusText() {
  const saved = localStorage.getItem('papa_date');
  const mode  = localStorage.getItem('papa_mode') || 'future';
  if (!saved) return { badge:'', week:'--', sub:'', pct:0 };

  const today  = new Date(); today.setHours(0,0,0,0);
  const target = new Date(saved); target.setHours(0,0,0,0);
  let badge='', week='', sub='', pct=0;

  if (mode === 'future') {
    const toGo = daysBetween(today, target);
    if (toGo < 0) {
      const d = Math.abs(toGo);
      const m = Math.floor(d / 30);
      const r = d % 30;
      badge = '👶 育児中';
      week  = `生後 ${m}ヶ月 ${r}日`;
      sub   = `誕生から ${d} 日`;
      pct   = Math.min(Math.round((d / 365) * 100), 100);
    } else {
      const pregnant = FULL_PREG_DAYS - toGo;
      if (pregnant <= 0) {
        badge = '🗓 妊娠前';
        week  = '妊娠まもなく';
        sub   = `予定日まで ${toGo} 日`;
        pct   = 0;
      } else {
        const w = Math.floor(pregnant / 7);
        const d = pregnant % 7;
        badge = '🤰 妊娠中';
        week  = `妊娠 ${w}週 ${d}日`;
        sub   = `出産予定日まで ${toGo} 日`;
        pct   = Math.round((pregnant / FULL_PREG_DAYS) * 100);
      }
    }
  } else {
    const since = daysBetween(target, today);
    if (since < 0) {
      badge = '🗓 出産前';
      week  = `生まれるまで ${Math.abs(since)} 日`;
      sub   = '楽しみにしていてください！';
      pct   = 0;
    } else {
      const m = Math.floor(since / 30);
      const r = since % 30;
      badge = '👶 育児中';
      week  = `生後 ${m}ヶ月 ${r}日`;
      sub   = `誕生から ${since} 日`;
      pct   = Math.min(Math.round((since / 365) * 100), 100);
    }
  }
  return { badge, week, sub, pct };
}

// ─── 進捗リング更新 ──────────────────────────────────
function updateRing(pct) {
  const circumference = 2 * Math.PI * 50; // r=50
  const offset = circumference * (1 - pct / 100);
  document.getElementById('ring-fill').style.strokeDashoffset = offset;
  document.getElementById('ring-pct').textContent = pct + '%';
}

// ─── 今日のひとこと（日付ベースで選択） ─────────────
function getTodayVoice(item) {
  if (!item || !item.voice) return '--';
  // 同じ週のデータに voice が1つだけなのでそのまま返す
  // 将来: voice_list 配列 + 日付ハッシュで日替わりに
  return item.voice;
}

// ─── ミッションチェック ──────────────────────────────
function isMissionDone() {
  const date = localStorage.getItem('papa_mission_date');
  const today = fmt(new Date());
  return date === today && localStorage.getItem('papa_mission_done') === '1';
}

function toggleMission(e) {
  e.stopPropagation();
  const done = isMissionDone();
  const today = fmt(new Date());
  if (done) {
    localStorage.removeItem('papa_mission_done');
    localStorage.removeItem('papa_mission_date');
  } else {
    localStorage.setItem('papa_mission_done', '1');
    localStorage.setItem('papa_mission_date', today);
  }
  updateMissionUI();
}

function updateMissionUI() {
  const check = document.getElementById('mission-check');
  if (isMissionDone()) {
    check.classList.add('done');
  } else {
    check.classList.remove('done');
  }
}

// ─── ホーム画面レンダリング ──────────────────────────
function renderHome() {
  const { badge, week, sub, pct } = calcStatusText();
  document.getElementById('hero-badge').textContent = badge;
  document.getElementById('hero-week').textContent  = week;
  document.getElementById('hero-sub').textContent   = sub;

  // リング（少し遅延してアニメーション）
  requestAnimationFrame(() => {
    setTimeout(() => updateRing(pct), 80);
  });

  const item = data[currentIdx] || {};

  // 声かけ
  const voice = getTodayVoice(item);
  document.getElementById('home-voice-text').textContent = voice;

  // ミッション
  document.getElementById('home-mission-text').textContent = item.mission || '--';
  updateMissionUI();
  document.getElementById('ring-label').textContent = '進捗';

  // サマリー
  document.getElementById('home-baby-text').textContent = item.baby || '--';
  document.getElementById('home-mama-text').textContent = item.mama || '--';

  // タイムラインリスト
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';
  data.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'tl-card' + (i === currentIdx ? ' is-current' : '');
    el.innerHTML = `
      <div class="tl-dot"></div>
      <div class="tl-period">${d.period}</div>
      <div class="tl-arrow">›</div>
    `;
    el.addEventListener('click', () => openOverlay(i));
    list.appendChild(el);
  });
}

// ─── 赤ちゃん画面 ────────────────────────────────────
function renderBaby() {
  const item = data[currentIdx] || {};
  const chip = document.getElementById('baby-period-chip');
  if (chip) chip.textContent = item.period || '--';

  const sizeKey = item.baby_size || '';
  const emoji   = SIZE_EMOJI[sizeKey] || '🫐';
  const sizeEl  = document.getElementById('baby-size-emoji');
  const lblEl   = document.getElementById('baby-size-label');
  if (sizeEl) sizeEl.textContent = emoji;
  if (lblEl)  lblEl.innerHTML   = sizeKey ? `${sizeKey}<br>くらい` : '--';

  const heroEl  = document.getElementById('baby-hero-text');
  const devEl   = document.getElementById('baby-dev-text');
  if (heroEl) heroEl.textContent = item.baby || '--';
  if (devEl)  devEl.textContent  = item.baby || '--';
}

// ─── ママ画面 ────────────────────────────────────────
function renderMom() {
  const item = data[currentIdx] || {};
  const chip = document.getElementById('mom-period-chip');
  if (chip) chip.textContent = item.period || '--';
  setText('mom-mama-text', item.mama);
  setText('mom-tip-text',  item.tip || item.notice);
}

// ─── パパ画面 ────────────────────────────────────────
function renderDad() {
  const item = data[currentIdx] || {};
  const chip = document.getElementById('dad-period-chip');
  if (chip) chip.textContent = item.period || '--';
  setText('dad-mission-text', item.mission);
  setText('dad-proc-text',    item.proc);
}

// ─── 声かけ画面 ──────────────────────────────────────
function renderVoice() {
  const item = data[currentIdx] || {};
  const chip = document.getElementById('voice-period-chip');
  if (chip) chip.textContent = item.period || '--';

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`;
  const dateEl = document.getElementById('voice-date');
  if (dateEl) dateEl.textContent = `${dateStr} のひとこと`;

  setText('voice-big-text', getTodayVoice(item));
}

// ─── タイムラインオーバーレイ ─────────────────────────
function openOverlay(idx) {
  const item = data[idx] || {};
  document.getElementById('overlay-title').textContent   = item.period || '--';
  document.getElementById('ov-baby').textContent         = item.baby    || '--';
  document.getElementById('ov-mama').textContent         = item.mama    || '--';
  document.getElementById('ov-mission').textContent      = item.mission || '--';
  document.getElementById('ov-proc').textContent         = item.proc    || '--';
  document.getElementById('ov-tip').textContent          = item.tip || item.notice || '--';
  document.getElementById('ov-voice').textContent        = item.voice   || '--';

  const overlay = document.getElementById('detail-overlay');
  overlay.classList.remove('hidden');
  // 閉じるのを許容するためにパネル外クリック
  overlay.addEventListener('click', overlayBgClick);
}

function overlayBgClick(e) {
  if (e.target === document.getElementById('detail-overlay')) {
    closeOverlay();
  }
}

function closeOverlay() {
  const overlay = document.getElementById('detail-overlay');
  overlay.classList.add('hidden');
  overlay.removeEventListener('click', overlayBgClick);
}

// ─── タブ切り替え ────────────────────────────────────
function switchTab(tab) {
  const tabs = ['home','baby','mom','dad','voice'];
  tabs.forEach(t => {
    document.getElementById(`screen-${t}`)?.classList.toggle('active-tab', t === tab);
    document.getElementById(`nav-${t}`)?.classList.toggle('active', t === tab);
  });
}

// ─── ユーティリティ ──────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || '--';
}
