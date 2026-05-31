/* =======================================
   app.js — パパの育児タイムライン
======================================= */

// ---- 週→インデックス マッピング ----
// data.json の 0〜8 番目 = 妊娠月（4週〜40週）, 9番目 = 生後0ヶ月, 10〜21 = 生後1〜12ヶ月
// 妊娠：各期間の真ん中の週で判定
const PREGNANCY_RANGES = [
  { weeks: [4,7],   idx: 0 },  // 妊娠2ヶ月
  { weeks: [8,11],  idx: 1 },  // 妊娠3ヶ月
  { weeks: [12,15], idx: 2 },  // 妊娠4ヶ月
  { weeks: [16,19], idx: 3 },  // 妊娠5ヶ月
  { weeks: [20,23], idx: 4 },  // 妊娠6ヶ月
  { weeks: [24,27], idx: 5 },  // 妊娠7ヶ月
  { weeks: [28,31], idx: 6 },  // 妊娠8ヶ月
  { weeks: [32,35], idx: 7 },  // 妊娠9ヶ月
  { weeks: [36,40], idx: 8 },  // 妊娠10ヶ月
];

let timelineData = [];
let currentIndex = -1; // 現在該当するデータのインデックス
let mode = 'future';   // 'future'=出産予定日, 'past'=誕生日

/* ===== 初期化 ===== */
document.addEventListener('DOMContentLoaded', async () => {
  // data.json を読み込む
  try {
    const res = await fetch('data.json');
    timelineData = await res.json();
  } catch (e) {
    console.error('data.json の読み込みに失敗', e);
    timelineData = [];
  }

  // デフォルト日付：今日から6ヶ月後
  const defaultDate = new Date();
  defaultDate.setMonth(defaultDate.getMonth() + 6);
  document.getElementById('date-input').value = formatDate(defaultDate);

  // セーブ済みデータがあればホーム画面へ
  const saved = localStorage.getItem('expected_date');
  if (saved) {
    showHome();
  } else {
    showSetup();
  }
});

/* ===== ユーティリティ ===== */
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function daysDiff(from, to) {
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById(id).scrollTop = 0;
}
function showSetup() { showScreen('screen-setup'); }
function showHome()   { renderHome(); showScreen('screen-home'); }
function showDetail() { showScreen('screen-detail'); }

/* ===== セットアップ画面 ===== */
function setMode(m) {
  mode = m;
  document.getElementById('tab-future').classList.toggle('active', m === 'future');
  document.getElementById('tab-past').classList.toggle('active', m === 'past');
  document.getElementById('date-label').textContent =
    m === 'future' ? '出産予定日を選んでください' : 'お子さんの誕生日を選んでください';
}

function saveAndStart() {
  const val = document.getElementById('date-input').value;
  if (!val) { alert('日付を選んでください'); return; }

  localStorage.setItem('expected_date', val);
  localStorage.setItem('date_mode', mode); // 'future' or 'past'

  const btn = document.getElementById('start-btn');
  btn.style.opacity = '0.7';
  setTimeout(() => {
    showHome();
    btn.style.opacity = '1';
  }, 200);
}

function resetApp() {
  if (!confirm('設定をリセットして最初からやり直しますか？')) return;
  localStorage.removeItem('expected_date');
  localStorage.removeItem('date_mode');
  showSetup();
}

/* ===== ホーム画面 ===== */
function renderHome() {
  const savedDate = localStorage.getItem('expected_date');
  const savedMode = localStorage.getItem('date_mode') || 'future';
  if (!savedDate || timelineData.length === 0) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const target = new Date(savedDate);
  target.setHours(0,0,0,0);

  let statusMain = '';
  let statusSub = '';
  let statusBadge = '';

  if (savedMode === 'future') {
    // 予定日まで何日か → 妊娠何週か
    const daysToGo = daysDiff(today, target);
    if (daysToGo < 0) {
      // 予定日を過ぎている＝もう生まれているかも
      const daysPast = Math.abs(daysToGo);
      const months = Math.floor(daysPast / 30);
      const days = daysPast % 30;
      statusBadge = '👶 出産後';
      statusMain = `生後 ${months}ヶ月 ${days}日`;
      statusSub = `おめでとうございます！`;
      currentIndex = getPostBirthIndex(months);
    } else {
      // まだ予定日前 → 妊娠週数計算（出産予定日=40週0日として逆算）
      const totalPregnancyDays = 280; // 40週
      const daysPregnant = totalPregnancyDays - daysToGo;
      if (daysPregnant <= 0) {
        statusBadge = '🗓 妊娠前';
        statusMain = 'まもなく妊娠';
        statusSub = `予定日まで ${daysToGo} 日`;
        currentIndex = 0;
      } else {
        const weeks = Math.floor(daysPregnant / 7);
        const days = daysPregnant % 7;
        statusBadge = '🤰 妊娠中';
        statusMain = `妊娠 ${weeks}週 ${days}日`;
        statusSub = `出産予定日まで ${daysToGo} 日`;
        currentIndex = getPregnancyIndex(weeks);
      }
    }
  } else {
    // 誕生日から月齢計算
    const daysSinceBirth = daysDiff(target, today);
    if (daysSinceBirth < 0) {
      statusBadge = '🗓 出産前';
      statusMain = `生まれるまで ${Math.abs(daysSinceBirth)} 日`;
      statusSub = '楽しみにしていてください！';
      currentIndex = 0;
    } else {
      const months = Math.floor(daysSinceBirth / 30);
      const days = daysSinceBirth % 30;
      statusBadge = '👶 育児中';
      statusMain = `生後 ${months}ヶ月 ${days}日`;
      statusSub = `誕生日から ${daysSinceBirth} 日`;
      currentIndex = getPostBirthIndex(months);
    }
  }

  // 表示更新
  document.getElementById('status-badge').textContent = statusBadge;
  document.getElementById('status-main').textContent = statusMain;
  document.getElementById('status-sub').textContent = statusSub;

  // クイックビュー
  const cur = timelineData[Math.max(0, Math.min(currentIndex, timelineData.length - 1))];
  if (cur) {
    document.getElementById('quick-period').textContent = cur.period;
    document.getElementById('quick-mama').textContent = cur.mama;
    document.getElementById('quick-mission').textContent = cur.mission;
  }

  // タイムラインリスト
  renderTimeline();
}

function getPregnancyIndex(weeks) {
  for (const r of PREGNANCY_RANGES) {
    if (weeks >= r.weeks[0] && weeks <= r.weeks[1]) return r.idx;
  }
  if (weeks < 4) return 0;
  return 8;
}

function getPostBirthIndex(months) {
  // 9=生後0ヶ月, 10=1ヶ月 … 21=12ヶ月
  const idx = 9 + Math.min(months, 12);
  return Math.min(idx, timelineData.length - 1);
}

function renderTimeline() {
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';

  timelineData.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'timeline-card' + (i === currentIndex ? ' current-period' : '');
    card.innerHTML = `
      <div class="timeline-card-dot"></div>
      <div class="timeline-card-period">${item.period}</div>
      <div class="timeline-card-arrow">›</div>
    `;
    card.addEventListener('click', () => openDetail(i));
    list.appendChild(card);
  });
}

/* ===== 現在の詳細を開く（クイックビューから） ===== */
function openCurrentDetail() {
  openDetail(Math.max(0, Math.min(currentIndex, timelineData.length - 1)));
}

/* ===== 詳細画面 ===== */
function openDetail(index) {
  const item = timelineData[index];
  if (!item) return;

  document.getElementById('detail-title').textContent = item.period;
  document.getElementById('detail-mama').textContent = item.mama;
  document.getElementById('detail-mission').textContent = item.mission;
  document.getElementById('detail-proc').textContent = item.proc;
  document.getElementById('detail-notice').textContent = item.notice;

  showDetail();
}

function goHome() {
  showHome();
}
