/* ══════════════════════════════════
   app.js — パパノート（妊娠生活OS）
   データアクセス抽象化レイヤー (DataService) を採用。
   将来的に DATA_URL を Google Spreadsheet の Web API に
   差し替えるだけで、CMSとしてデータがリアルタイム連携可能。
   LocalStorageを使用してサーバー不要で動くパパログを完全実装。
   また、データが0件でも絶対にクラッシュしない堅牢な設計。
══════════════════════════════════ */

// ─── 設定 ───────────────────────────────────────────
const DATA_URL = 'data.json'; // 将来: Google Apps Script Web App URL に変更可能
const FULL_PREG_DAYS = 280;

// ─── データアクセスレイヤー (抽象レイヤー) ──────────────
const DataService = {
  weeks: [],
  momConditions: [],
  dadTasks: [],
  searchItems: [],

  async init() {
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const raw = await res.json();
      
      this.weeks = raw.weeks || [];
      this.momConditions = raw.mom_conditions || [];
      this.dadTasks = raw.dad_tasks || [];
      this.searchItems = raw.search_items || [];
    } catch (e) {
      console.warn('data.json の取得に失敗しました。フォールバックで空データ動作をします:', e);
      this.weeks = [];
      this.momConditions = [];
      this.dadTasks = [];
      this.searchItems = [];
    }
  },

  // 週数に合致する「weeks」データを取得（なければ手前の週、それもなければnull）
  getWeekData(week) {
    if (this.weeks.length === 0) return null;
    // 完全一致を探索
    let match = this.weeks.find(w => w.week === week);
    if (match) return match;
    // なければ、その週以下の最大の週のデータを探索（下限フォールバック）
    const under = this.weeks.filter(w => w.week <= week).sort((a,b) => b.week - a.week);
    if (under.length > 0) return under[0];
    // なければ最初のデータ
    return this.weeks[0];
  },

  // 週数に合致する「ママの状態」を取得
  getMomCondition(week) {
    if (this.momConditions.length === 0) return null;
    let match = this.momConditions.find(m => m.week === week);
    if (match) return match;
    const under = this.momConditions.filter(m => m.week <= week).sort((a,b) => b.week - a.week);
    if (under.length > 0) return under[0];
    return this.momConditions[0];
  },

  // 週数に合致する「パパのミッション」を取得
  getDadTasks(week) {
    if (this.dadTasks.length === 0) return [];
    // その週のミッションを取得
    let tasks = this.dadTasks.filter(t => t.week === week);
    if (tasks.length > 0) return tasks;
    // なければ、一番近い過去の週のミッションを取得
    const underWeeks = [...new Set(this.dadTasks.map(t => t.week))].filter(w => w <= week).sort((a,b) => b - a);
    if (underWeeks.length > 0) {
      return this.dadTasks.filter(t => t.week === underWeeks[0]);
    }
    return [];
  },

  // 検索アイテムを取得（クエリとカテゴリチップでフィルタリング）
  search(query, type = 'all') {
    let items = this.searchItems;
    if (type && type !== 'all') {
      items = items.filter(item => item.type === type);
    }
    if (query) {
      const q = query.toLowerCase().trim();
      items = items.filter(item => 
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.summary && item.summary.toLowerCase().includes(q)) ||
        (item.detail && item.detail.toLowerCase().includes(q))
      );
    }
    return items;
  },

  // パパログ (LocalStorage)
  getLogs() {
    return JSON.parse(localStorage.getItem('dad_logs') || '[]');
  },

  saveLogs(logs) {
    localStorage.setItem('dad_logs', JSON.stringify(logs));
  },

  addLog(date, memo) {
    const logs = this.getLogs();
    const newLog = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      date: date || fmt(new Date()),
      memo: memo.trim()
    };
    logs.push(newLog);
    logs.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)); // 日付の新しい順
    this.saveLogs(logs);
    return newLog;
  },

  updateLog(id, date, memo) {
    const logs = this.getLogs();
    const idx = logs.findIndex(l => l.id === id);
    if (idx !== -1) {
      logs[idx].date = date || fmt(new Date());
      logs[idx].memo = memo.trim();
      logs.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
      this.saveLogs(logs);
    }
  },

  deleteLog(id) {
    let logs = this.getLogs();
    logs = logs.filter(l => l.id !== id);
    this.saveLogs(logs);
  }
};

// ─── アプリの状態 ─────────────────────────────────────
let currentWeek = 7; // デフォルト：妊娠7週
let currentDayOffset = 2; // デフォルト：2日（妊娠7週2日）
let selectedSearchCategory = 'all';
let editingLogId = null;

// ─── 初期化 ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // データサービスの初期化
  await DataService.init();

  // 初期設定日付入力欄のデフォルト値（6ヶ月後）
  const defDate = new Date();
  defDate.setMonth(defDate.getMonth() + 6);
  const inputEl = document.getElementById('date-input');
  if (inputEl) inputEl.value = fmt(defDate);

  // 既存設定のチェック
  if (localStorage.getItem('papa_date')) {
    startApp();
  } else {
    showSetup();
  }

  // 検索イベントリスナー
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderSearch();
    });
  }

  // ログ送信イベント
  const logForm = document.getElementById('log-form');
  if (logForm) {
    logForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleLogSubmit();
    });
  }

  // ログ日付の初期値を「今日」に設定
  const logDateInput = document.getElementById('log-date');
  if (logDateInput) {
    logDateInput.value = fmt(new Date());
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

// ─── 画面遷移制御 ────────────────────────────────────
function showSetup() {
  document.getElementById('screen-setup').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

let modeSetup = 'future';
function setMode(m) {
  modeSetup = m;
  document.getElementById('tab-future').classList.toggle('active', m === 'future');
  document.getElementById('tab-past').classList.toggle('active', m === 'past');
  document.getElementById('field-label').textContent =
    m === 'future' ? '出産予定日' : 'お子さんの誕生日';
}

function saveAndStart() {
  const val = document.getElementById('date-input').value;
  if (!val) { alert('日付を選択してください'); return; }
  localStorage.setItem('papa_date', val);
  localStorage.setItem('papa_mode', modeSetup);
  startApp();
}

function resetApp() {
  if (!confirm('設定を初期化してよろしいですか？パパログやタスクのチェック状態は保持されます。')) return;
  localStorage.removeItem('papa_date');
  localStorage.removeItem('papa_mode');
  showSetup();
}

// ─── アプリ起動 ──────────────────────────────────────
function startApp() {
  document.getElementById('screen-setup').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // 週数計算
  calcPregnancyWeeks();

  // レンダリング実行
  switchTab('home');
}

// ─── 週数・日数計算 ──────────────────────────────────
function calcPregnancyWeeks() {
  const saved = localStorage.getItem('papa_date');
  const mode = localStorage.getItem('papa_mode') || 'future';
  if (!saved) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(saved); target.setHours(0,0,0,0);

  if (mode === 'future') {
    const toGo = daysBetween(today, target);
    if (toGo < 0) {
      // 予定日を過ぎた場合（育児フェーズ）
      const since = Math.abs(toGo);
      currentWeek = 40 + Math.floor(since / 7);
      currentDayOffset = since % 7;
    } else {
      // 妊娠フェーズ
      const pregnantDays = FULL_PREG_DAYS - toGo;
      if (pregnantDays <= 0) {
        currentWeek = 0;
        currentDayOffset = 0;
      } else {
        currentWeek = Math.floor(pregnantDays / 7);
        currentDayOffset = pregnantDays % 7;
      }
    }
  } else {
    // すでに生まれている場合（育児フェーズ）
    const since = daysBetween(target, today);
    if (since < 0) {
      currentWeek = 0;
      currentDayOffset = 0;
    } else {
      currentWeek = 40 + Math.floor(since / 7);
      currentDayOffset = since % 7;
    }
  }
}

// ステータステキストと進捗率の取得
function getStatusData() {
  const saved = localStorage.getItem('papa_date');
  const mode = localStorage.getItem('papa_mode') || 'future';
  if (!saved) return { badge: '未設定', week: '--週--日', sub: '', pct: 0 };

  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(saved); target.setHours(0,0,0,0);
  let badge = '', week = '', sub = '', pct = 0;

  if (mode === 'future') {
    const toGo = daysBetween(today, target);
    if (toGo < 0) {
      const d = Math.abs(toGo);
      const m = Math.floor(d / 30);
      const r = d % 30;
      badge = '👶 育児中';
      week = `生後 ${m}ヶ月 ${r}日`;
      sub = `誕生から ${d}日目`;
      pct = Math.min(Math.round((d / 365) * 100), 100);
    } else {
      const pregnantDays = FULL_PREG_DAYS - toGo;
      if (pregnantDays <= 0) {
        badge = '🗓 妊娠前';
        week = '妊娠まもなく';
        sub = `出産予定日まで ${toGo}日`;
        pct = 0;
      } else {
        const w = Math.floor(pregnantDays / 7);
        const d = pregnantDays % 7;
        badge = '🤰 妊娠中';
        week = `妊娠 ${w}週 ${d}日`;
        sub = `出産予定日まで ${toGo}日`;
        pct = Math.round((pregnantDays / FULL_PREG_DAYS) * 100);
      }
    }
  } else {
    const since = daysBetween(target, today);
    if (since < 0) {
      badge = '🗓 出産準備';
      week = `誕生まで ${Math.abs(since)}日`;
      sub = '新しい家族を迎える準備をしましょう';
      pct = 0;
    } else {
      const m = Math.floor(since / 30);
      const r = since % 30;
      badge = '👶 育児中';
      week = `生後 ${m}ヶ月 ${r}日`;
      sub = `誕生から ${since}日目`;
      pct = Math.min(Math.round((since / 365) * 100), 100);
    }
  }
  return { badge, week, sub, pct };
}

// ─── 進捗リングアニメーション ──────────────────────────
function updateProgressRing(pct) {
  const fill = document.getElementById('ring-fill');
  const pctText = document.getElementById('ring-pct');
  if (!fill || !pctText) return;

  const r = fill.getAttribute('r');
  const circumference = 2 * Math.PI * r;
  
  fill.style.strokeDasharray = circumference;
  const offset = circumference * (1 - pct / 100);
  fill.style.strokeDashoffset = offset;
  pctText.textContent = `${pct}%`;
}

// ─── タブ切り替えと画面更新 ──────────────────────────
function switchTab(tabId) {
  const tabs = ['home', 'search', 'mom', 'dad', 'log'];
  tabs.forEach(t => {
    const screen = document.getElementById(`screen-${t}`);
    const navBtn = document.getElementById(`nav-${t}`);
    if (screen) screen.classList.toggle('active-tab', t === tabId);
    if (navBtn) navBtn.classList.toggle('active', t === tabId);
  });

  // 各画面の更新
  if (tabId === 'home') renderHome();
  if (tabId === 'search') renderSearch();
  if (tabId === 'mom') renderMom();
  if (tabId === 'dad') renderDad();
  if (tabId === 'log') renderLogList();
}

// ─── HOME 画面レンダリング ──────────────────────────
function renderHome() {
  const status = getStatusData();
  
  setText('hero-badge', status.badge);
  setText('hero-week', status.week);
  setText('hero-sub', status.sub);
  
  requestAnimationFrame(() => {
    setTimeout(() => updateProgressRing(status.pct), 50);
  });

  // データロード
  const weekData = DataService.getWeekData(currentWeek);
  const momData = DataService.getMomCondition(currentWeek);
  const dadTasks = DataService.getDadTasks(currentWeek);

  // 1. 今日のママ
  const homeMamaTitle = document.getElementById('home-mama-title');
  const homeMamaText = document.getElementById('home-mama-text');
  if (momData) {
    if (homeMamaTitle) homeMamaTitle.textContent = momData.title || '今週のママの状態';
    if (homeMamaText) homeMamaText.textContent = momData.content || '--';
  } else {
    // 0件時フォールバック
    if (homeMamaTitle) homeMamaTitle.textContent = '今日のママ';
    if (homeMamaText) homeMamaText.innerHTML = `<span class="empty-state">ママのアドバイスは今後のデータ更新をお待ちください。</span>`;
  }

  // 2. 今日のパパミッション (優先度Highのタスクを1つ、または最新タスク)
  const homeMissionText = document.getElementById('home-mission-text');
  const homeMissionCard = document.getElementById('home-mission-card');
  const homeMissionCheck = document.getElementById('home-mission-check');
  
  if (dadTasks.length > 0) {
    // 優先度Highのものを優先して1つ抽出
    const highTask = dadTasks.find(t => t.priority === 'high') || dadTasks[0];
    const taskId = `task_${currentWeek}_${hashString(highTask.task)}`;
    
    if (homeMissionText) homeMissionText.textContent = highTask.task;
    
    // チェックボックス制御
    const isDone = localStorage.getItem(taskId) === '1';
    if (homeMissionCheck) {
      homeMissionCheck.className = 'mission-check' + (isDone ? ' done' : '');
      homeMissionCheck.onclick = (e) => {
        e.stopPropagation();
        const nextState = localStorage.getItem(taskId) === '1' ? '0' : '1';
        localStorage.setItem(taskId, nextState);
        homeMissionCheck.className = 'mission-check' + (nextState === '1' ? ' done' : '');
        // パパタブのUIと連動させるため、もし開いていたら再描画
        if (document.getElementById('screen-dad').classList.contains('active-tab')) {
          renderDad();
        }
      };
    }
    
    if (homeMissionCard) {
      homeMissionCard.onclick = () => switchTab('dad');
    }
  } else {
    // 0件時フォールバック
    if (homeMissionText) homeMissionText.innerHTML = `<span class="empty-state">今週のパパミッションは登録されていません。</span>`;
    if (homeMissionCheck) homeMissionCheck.className = 'mission-check hidden';
    if (homeMissionCard) homeMissionCard.onclick = () => switchTab('dad');
  }

  // 3. 今日の声掛け
  const homeVoiceText = document.getElementById('home-voice-text');
  if (weekData && weekData.content) {
    if (homeVoiceText) homeVoiceText.textContent = weekData.content;
  } else {
    // 0件時フォールバック
    if (homeVoiceText) homeVoiceText.innerHTML = `<span class="empty-state">おなかの赤ちゃんは順調に育っています。ママを優しく支えてあげてください。</span>`;
  }
}

// 文字列からシンプルなハッシュを生成し、一意なキーを作成する
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ─── SEARCH 画面レンダリング ──────────────────────────
function selectSearchCategory(category) {
  selectedSearchCategory = category;
  
  const chips = ['all', 'food', 'activity', 'medicine', 'symptom'];
  chips.forEach(c => {
    const chipBtn = document.getElementById(`chip-${c}`);
    if (chipBtn) chipBtn.classList.toggle('active', c === category);
  });
  
  renderSearch();
}

function renderSearch() {
  const query = document.getElementById('search-input')?.value || '';
  const results = DataService.search(query, selectedSearchCategory);
  const container = document.getElementById('search-results');
  if (!container) return;

  container.innerHTML = '';

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-search">
        <div class="empty-search-icon">🔍</div>
        <p class="empty-search-title">見つかりませんでした</p>
        <p class="empty-search-desc">条件に合う項目が登録されていません。<br>キーワードを変えるか、カテゴリを選択し直してください。</p>
      </div>
    `;
    return;
  }

  results.forEach(item => {
    const card = document.createElement('div');
    card.className = `search-card glass accent-${item.status.toLowerCase()}`;
    
    let statusClass = 'status-badge';
    if (item.status === 'OK') statusClass += ' ok';
    if (item.status === 'NG') statusClass += ' ng';
    if (item.status === 'caution') statusClass += ' caution';

    const statusLabel = item.status === 'OK' ? '安全' : item.status === 'NG' ? '厳禁' : '注意';

    card.innerHTML = `
      <div class="sc-header">
        <span class="sc-name">${escapeHtml(item.name)}</span>
        <span class="${statusClass}">${statusLabel}</span>
      </div>
      <p class="sc-summary">${escapeHtml(item.summary)}</p>
      <div class="sc-footer">
        <span class="sc-type-badge">${getTypeLabel(item.type)}</span>
        <span class="sc-more">詳しく見る →</span>
      </div>
    `;
    
    card.onclick = () => openSearchDetail(item);
    container.appendChild(card);
  });
}

function getTypeLabel(type) {
  const labels = { food: '食材', activity: '行動', medicine: '薬', symptom: '症状' };
  return labels[type] || type;
}

function openSearchDetail(item) {
  const overlay = document.getElementById('detail-overlay');
  const panel = document.getElementById('overlay-panel');
  if (!overlay || !panel) return;

  let statusClass = 'status-badge big';
  if (item.status === 'OK') statusClass += ' ok';
  if (item.status === 'NG') statusClass += ' ng';
  if (item.status === 'caution') statusClass += ' caution';
  const statusLabel = item.status === 'OK' ? '安全' : item.status === 'NG' ? '妊娠中NG' : '要注意';

  panel.innerHTML = `
    <div class="overlay-header">
      <button class="back-btn" onclick="closeOverlay()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <span class="overlay-title">詳細情報</span>
    </div>
    <div class="overlay-body">
      <div class="detail-header-card glass">
        <div class="dh-type">${getTypeLabel(item.type)}</div>
        <h2 class="dh-name">${escapeHtml(item.name)}</h2>
        <div style="margin-top: 0.8rem;"><span class="${statusClass}">${statusLabel}</span></div>
      </div>

      <div class="detail-section glass accent-warning">
        <div class="ds-header">
          <span class="ds-icon">💡</span>
          <span class="ds-title">要約</span>
        </div>
        <p class="ds-text font-bold">${escapeHtml(item.summary)}</p>
      </div>

      <div class="detail-section glass">
        <div class="ds-header">
          <span class="ds-icon">📝</span>
          <span class="ds-title">詳細な解説</span>
        </div>
        <p class="ds-text" style="white-space: pre-wrap;">${escapeHtml(item.detail)}</p>
      </div>

      ${item.source ? `
      <div class="detail-section glass accent-proc">
        <div class="ds-header">
          <span class="ds-icon">🌐</span>
          <span class="ds-title">情報元・エビデンス</span>
        </div>
        <p class="ds-text text-sm">${escapeHtml(item.source)}</p>
      </div>
      ` : ''}
      <div class="footer-pad"></div>
    </div>
  `;

  overlay.classList.remove('hidden');
  overlay.onclick = (e) => {
    if (e.target === overlay) closeOverlay();
  };
}

function closeOverlay() {
  const overlay = document.getElementById('detail-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ─── MOM 画面レンダリング ───────────────────────────
let browsingWeek = null;

function renderMom() {
  if (browsingWeek === null) {
    browsingWeek = currentWeek;
  }

  // 週数スライダー・ヘッダー
  const weekTitle = document.getElementById('mom-week-title');
  if (weekTitle) {
    const months = Math.floor(browsingWeek / 4) + 1;
    weekTitle.textContent = `妊娠 ${browsingWeek}週 （${months}ヶ月目）`;
  }

  // 週数インジケータ（スライド調整）
  const weekVal = document.getElementById('mom-week-value');
  if (weekVal) weekVal.textContent = browsingWeek;

  const inputSlider = document.getElementById('mom-week-slider');
  if (inputSlider) {
    inputSlider.value = browsingWeek;
    inputSlider.oninput = (e) => {
      browsingWeek = parseInt(e.target.value);
      renderMom();
    };
  }

  // ママデータロード
  const momData = DataService.getMomCondition(browsingWeek);
  const container = document.getElementById('mom-data-container');
  if (!container) return;

  if (momData) {
    container.innerHTML = `
      <div class="detail-section glass accent-mom">
        <div class="ds-header">
          <span class="ds-icon">🤰</span>
          <span class="ds-title">ママのからだの状態</span>
        </div>
        <h3 class="ds-subtitle">${escapeHtml(momData.title)}</h3>
        <p class="ds-text" style="white-space: pre-wrap; margin-top: 0.6rem;">${escapeHtml(momData.content)}</p>
      </div>
      
      <div class="detail-section glass accent-tip">
        <div class="ds-header">
          <span class="ds-icon">💡</span>
          <span class="ds-title">パパができる寄り添い方</span>
        </div>
        <p class="ds-text">
          つわりやだるさが辛い時期です。まずは「大丈夫？」と声をかけることから始めましょう。<br>
          家事はできる限り主体的に巻き取り、ママに休んでもらう環境作りをすることが、今のパパの一番の仕事です。
        </p>
      </div>
    `;
  } else {
    // 0件フォールバック
    container.innerHTML = `
      <div class="empty-state-card glass">
        <div class="esc-emoji">🤰</div>
        <p class="esc-title">データが未登録です</p>
        <p class="esc-desc">妊娠 ${browsingWeek}週目のママの状態データはまだありません。<br>今後のアップデートでお届けします。</p>
      </div>
    `;
  }
}

function adjustBrowsingWeek(offset) {
  let target = browsingWeek + offset;
  if (target < 0) target = 0;
  if (target > 42) target = 42;
  browsingWeek = target;
  renderMom();
}

// ─── DAD 画面レンダリング ───────────────────────────
function renderDad() {
  const dadPeriodChip = document.getElementById('dad-period-chip');
  if (dadPeriodChip) {
    dadPeriodChip.textContent = `妊娠 ${currentWeek}週`;
  }

  const tasks = DataService.getDadTasks(currentWeek);
  const container = document.getElementById('dad-tasks-list');
  if (!container) return;

  container.innerHTML = '';

  if (tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card glass">
        <div class="esc-emoji">🏃</div>
        <p class="esc-title">今週のミッションはありません</p>
        <p class="esc-desc">妊娠 ${currentWeek}週目のパパのミッションは現在ありません。<br>ママのお手伝いや休息をサポートしましょう！</p>
      </div>
    `;
    return;
  }

  // 優先度順に並び替え (high -> medium -> low)
  const priorityOrder = { high: 1, medium: 2, low: 3 };
  const sortedTasks = [...tasks].sort((a, b) => {
    return (priorityOrder[a.priority] || 9) - (priorityOrder[b.priority] || 9);
  });

  sortedTasks.forEach(task => {
    const taskId = `task_${currentWeek}_${hashString(task.task)}`;
    const isDone = localStorage.getItem(taskId) === '1';

    const card = document.createElement('div');
    card.className = 'dad-task-card glass' + (isDone ? ' done' : '');

    let priorityBadge = '';
    if (task.priority === 'high') priorityBadge = '<span class="pb pb-high">最優先</span>';
    if (task.priority === 'medium') priorityBadge = '<span class="pb pb-medium">推奨</span>';
    if (task.priority === 'low') priorityBadge = '<span class="pb pb-low">余裕があれば</span>';

    card.innerHTML = `
      <div class="dtc-check-wrap">
        <div class="mission-check${isDone ? ' done' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>
      <div class="dtc-content">
        <p class="dtc-text">${escapeHtml(task.task)}</p>
        <div class="dtc-meta">
          ${priorityBadge}
        </div>
      </div>
    `;

    card.onclick = () => {
      const nextState = localStorage.getItem(taskId) === '1' ? '0' : '1';
      localStorage.setItem(taskId, nextState);
      renderDad();
      // ホーム画面のUIとも同期
      if (document.getElementById('screen-home').classList.contains('active-tab')) {
        renderHome();
      }
    };

    container.appendChild(card);
  });
}

// ─── LOG (パパログ) 画面レンダリング ───────────────────
function renderLogList() {
  const container = document.getElementById('log-list');
  if (!container) return;

  const logs = DataService.getLogs();
  container.innerHTML = '';

  if (logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card glass">
        <div class="esc-emoji">📝</div>
        <p class="esc-title">パパログはまだありません</p>
        <p class="esc-desc">今日のママの様子や、通院で嬉しかったこと、<br>パパとしての気づきをメモに残しましょう。</p>
      </div>
    `;
    return;
  }

  logs.forEach(log => {
    const card = document.createElement('div');
    card.className = 'log-card glass';
    card.id = `log-card-${log.id}`;

    card.innerHTML = `
      <div class="log-card-header">
        <span class="log-card-date">${escapeHtml(log.date)}</span>
        <div class="log-card-actions">
          <button class="log-btn-icon edit-btn" onclick="startEditLog('${log.id}')" aria-label="編集">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="log-btn-icon delete-btn" onclick="deleteLog('${log.id}')" aria-label="削除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <p class="log-card-memo" id="log-memo-text-${log.id}">${escapeHtml(log.memo).replace(/\n/g, '<br>')}</p>
    `;
    container.appendChild(card);
  });
}

function handleLogSubmit() {
  const dateInput = document.getElementById('log-date');
  const memoInput = document.getElementById('log-memo');
  if (!dateInput || !memoInput) return;

  const date = dateInput.value;
  const memo = memoInput.value.trim();

  if (!memo) {
    alert('メモ内容を入力してください');
    return;
  }

  if (editingLogId) {
    // 編集更新
    DataService.updateLog(editingLogId, date, memo);
    
    // UIのリセット
    editingLogId = null;
    const submitBtn = document.querySelector('#log-form .cta-btn');
    if (submitBtn) {
      submitBtn.innerHTML = `記録する <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
      submitBtn.classList.remove('editing');
    }
    const cancelBtn = document.getElementById('log-edit-cancel');
    if (cancelBtn) cancelBtn.classList.add('hidden');
  } else {
    // 新規作成
    DataService.addLog(date, memo);
  }

  // 入力欄をクリア（日付は今日を保持）
  memoInput.value = '';
  dateInput.value = fmt(new Date());

  renderLogList();
}

function startEditLog(id) {
  const logs = DataService.getLogs();
  const log = logs.find(l => l.id === id);
  if (!log) return;

  editingLogId = id;

  const dateInput = document.getElementById('log-date');
  const memoInput = document.getElementById('log-memo');
  if (dateInput) dateInput.value = log.date;
  if (memoInput) {
    memoInput.value = log.memo;
    memoInput.focus();
  }

  // ボタン表示の切り替え
  const submitBtn = document.querySelector('#log-form .cta-btn');
  if (submitBtn) {
    submitBtn.innerHTML = `更新する <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
    submitBtn.classList.add('editing');
  }

  const cancelBtn = document.getElementById('log-edit-cancel');
  if (cancelBtn) {
    cancelBtn.classList.remove('hidden');
    cancelBtn.onclick = () => cancelEditLog();
  }

  // 編集中のカードを目立たせる
  const cards = document.querySelectorAll('.log-card');
  cards.forEach(c => c.classList.remove('is-editing'));
  const targetCard = document.getElementById(`log-card-${id}`);
  if (targetCard) targetCard.classList.add('is-editing');
}

function cancelEditLog() {
  editingLogId = null;

  const dateInput = document.getElementById('log-date');
  const memoInput = document.getElementById('log-memo');
  if (dateInput) dateInput.value = fmt(new Date());
  if (memoInput) memoInput.value = '';

  const submitBtn = document.querySelector('#log-form .cta-btn');
  if (submitBtn) {
    submitBtn.innerHTML = `記録する <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
    submitBtn.classList.remove('editing');
  }

  const cancelBtn = document.getElementById('log-edit-cancel');
  if (cancelBtn) cancelBtn.classList.add('hidden');

  const cards = document.querySelectorAll('.log-card');
  cards.forEach(c => c.classList.remove('is-editing'));
}

function deleteLog(id) {
  if (!confirm('このログを削除してよろしいですか？この操作は取り消せません。')) return;
  DataService.deleteLog(id);
  
  if (editingLogId === id) {
    cancelEditLog();
  }
  
  renderLogList();
}

// ─── 汎用ヘルパー ────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || '--';
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// グローバル関数として登録（HTML側インラインイベント用）
window.setMode = setMode;
window.saveAndStart = saveAndStart;
window.resetApp = resetApp;
window.switchTab = switchTab;
window.selectSearchCategory = selectSearchCategory;
window.closeOverlay = closeOverlay;
window.adjustBrowsingWeek = adjustBrowsingWeek;
window.startEditLog = startEditLog;
window.cancelEditLog = cancelEditLog;
window.deleteLog = deleteLog;
