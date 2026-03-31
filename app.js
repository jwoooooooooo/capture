// ============================================================
// SNS Monitor WebApp - app.js
// Chrome 확장 프로그램과 통신하여 스케줄/드라이브 관리
// ============================================================

// ── 확장 프로그램과 통신 ─────────────────────────────────
const EXT_ID = 'dokamfkjdpdpkiaibdaohhmalklkhfdd'; // 확장 설치 후 교체

function sendToExt(msg) {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.sendMessage) {
      reject(new Error('NO_EXT'));
      return;
    }
    chrome.runtime.sendMessage(EXT_ID, msg, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (resp?.error) reject(new Error(resp.error));
      else resolve(resp);
    });
  });
}

// ── 상태 ─────────────────────────────────────────────────
let schedules = [];
let driveConfig = null;
let logs = [];
let editingScheduleId = null;
let modalTimes = [];
let modalUrls = [];

// ── 초기화 ───────────────────────────────────────────────
async function init() {
  setupTabs();
  await checkExtension();
  await loadData();
  setupEventListeners();
}

async function checkExtension() {
  const el = document.getElementById('extStatus');
  try {
    await sendToExt({ type: 'GET_SCHEDULES' });
    el.textContent = '✅ 확장 연결됨';
    el.style.color = 'var(--success)';
    el.style.borderColor = 'rgba(60,200,100,0.3)';
  } catch {
    el.textContent = '⚠ 확장 프로그램 필요';
    el.style.color = 'var(--warn)';
    el.style.borderColor = 'rgba(255,176,64,0.3)';
  }
}

async function loadData() {
  try {
    const res = await sendToExt({ type: 'GET_SCHEDULES' });
    schedules = res.schedules || [];
  } catch {
    schedules = JSON.parse(localStorage.getItem('sns_schedules') || '[]');
  }

  try {
    const res = await sendToExt({ type: 'GET_LOGS' });
    logs = res.logs || [];
  } catch {
    logs = [];
  }

  // Drive config from localStorage fallback
  driveConfig = JSON.parse(localStorage.getItem('sns_drive_config') || 'null');

  renderStats();
  renderSchedules();
  renderDrive();
  renderLogs();
}

// ── 통계 렌더링 ──────────────────────────────────────────
function renderStats() {
  const active = schedules.filter(s => s.enabled);
  const urlCount = active.reduce((sum, s) => sum + s.urls.length, 0);

  document.getElementById('statSchedules').textContent = active.length;
  document.getElementById('statUrls').textContent = urlCount;

  const today = new Date().toLocaleDateString('ko-KR');
  const todayLogs = logs.filter(l => new Date(l.timestamp).toLocaleDateString('ko-KR') === today);
  document.getElementById('statToday').textContent = todayLogs.filter(l => l.status === 'success').length;

  if (logs.length > 0) {
    const rate = Math.round(logs.filter(l => l.status === 'success').length / logs.length * 100);
    document.getElementById('statRate').textContent = rate + '%';
  }
}

// ── 스케줄 렌더링 ────────────────────────────────────────
function renderSchedules() {
  const list = document.getElementById('scheduleList');
  if (schedules.length === 0) {
    list.innerHTML = `<div style="text-align:center; color:var(--text2); padding:40px; font-size:14px;">
      스케줄이 없습니다. 위의 버튼으로 추가해주세요.
    </div>`;
    return;
  }

  list.innerHTML = schedules.map(s => renderScheduleCard(s)).join('');
  
  // 이벤트 연결
  list.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', handleCardAction);
  });
  list.querySelectorAll('.card-header').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]') || e.target.closest('.card-toggle')) return;
      const card = el.closest('.schedule-card');
      card.classList.toggle('expanded');
      const btn = card.querySelector('.card-expand-btn');
      btn.textContent = card.classList.contains('expanded') ? '▲' : '▼';
    });
  });
  list.querySelectorAll('.card-toggle input').forEach(el => {
    el.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      toggleSchedule(id, e.target.checked);
    });
  });
}

function renderScheduleCard(s) {
  const times = (s.times || [s.time]).filter(Boolean);
  const urlCount = s.urls?.length || 0;
  const platforms = [...new Set((s.urls || []).map(u => getPlatform(u.url)))];
  
  return `
    <div class="schedule-card ${s.enabled ? '' : 'disabled'}" data-id="${s.id}">
      <div class="card-header">
        <label class="card-toggle" onclick="event.stopPropagation()">
          <input type="checkbox" ${s.enabled ? 'checked' : ''} data-id="${s.id}">
          <span class="toggle-slider"></span>
        </label>
        <div class="card-info">
          <div class="card-name">${escHtml(s.name)}</div>
          <div class="card-meta">
            <span>🕐 ${times.map(t => `<strong>${t}</strong>`).join(', ')}</span>
            <span>🔗 ${urlCount}개 URL</span>
            <span>${platforms.map(p => `<span class="platform-badge ${p}">${p}</span>`).join(' ')}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-action="run" data-id="${s.id}" onclick="event.stopPropagation()">▶ 지금 실행</button>
          <button class="btn btn-ghost btn-icon" data-action="edit" data-id="${s.id}" onclick="event.stopPropagation()">✏</button>
          <button class="btn btn-danger btn-icon" data-action="delete" data-id="${s.id}" onclick="event.stopPropagation()">🗑</button>
          <button class="card-expand-btn" onclick="event.stopPropagation()">▼</button>
        </div>
      </div>
      <div class="card-body">
        <table class="url-table">
          <thead>
            <tr>
              <th>레이블</th>
              <th>플랫폼</th>
              <th>URL</th>
              <th>크롭 설정</th>
              <th>액션</th>
            </tr>
          </thead>
          <tbody>
            ${(s.urls || []).map(u => `
              <tr>
                <td class="label-cell">${escHtml(u.label || '—')}</td>
                <td><span class="platform-badge ${getPlatform(u.url)}">${getPlatformName(u.url)}</span></td>
                <td class="url-cell" title="${escHtml(u.url)}">${escHtml(u.url)}</td>
                <td>
                  ${u.cropRegion
                    ? `<span class="crop-status set">✓ 설정됨 (${u.cropRegion.width}×${u.cropRegion.height})</span>`
                    : `<span class="crop-status unset">미설정</span>`
                  }
                </td>
                <td>
                  <button class="btn btn-ghost btn-sm" data-action="crop" data-sched-id="${s.id}" data-url-id="${u.id}">크롭 설정</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function handleCardAction(e) {
  const btn = e.currentTarget;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'edit') openModal(id);
  if (action === 'delete') deleteSchedule(id);
  if (action === 'run') runScheduleNow(id);
  if (action === 'crop') {
    const schedId = btn.dataset.schedId;
    const urlId = btn.dataset.urlId;
    startCropMode(schedId, urlId);
  }
}

// ── 크롭 모드 ────────────────────────────────────────────
async function startCropMode(schedId, urlId) {
  const sched = schedules.find(s => s.id === schedId);
  const urlItem = sched?.urls.find(u => u.id === urlId);
  if (!urlItem) return;

  // 해당 URL을 새 탭에서 열고 크롭 오버레이 시작
  showToast('📸 브라우저에서 캡처할 영역을 드래그해서 선택하세요');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // content script에 크롭 선택 시작 메시지
    await sendToExt({
      type: 'OPEN_CROP_MODE',
      url: urlItem.url,
      urlId: urlId,
      currentRegion: urlItem.cropRegion || null
    });
  } catch (err) {
    showToast('⚠ 확장 프로그램을 통해 크롭 모드를 시작해주세요', 'error');
  }
}

// ── 스케줄 토글 ──────────────────────────────────────────
async function toggleSchedule(id, enabled) {
  schedules = schedules.map(s => s.id === id ? { ...s, enabled } : s);
  await saveSchedules();
  renderStats();
}

// ── 스케줄 삭제 ──────────────────────────────────────────
async function deleteSchedule(id) {
  if (!confirm('이 스케줄을 삭제하시겠습니까?')) return;
  schedules = schedules.filter(s => s.id !== id);
  await saveSchedules();
  renderSchedules();
  renderStats();
  showToast('✅ 스케줄 삭제 완료');
}

// ── 즉시 실행 ────────────────────────────────────────────
async function runScheduleNow(id) {
  const btn = document.querySelector(`[data-action="run"][data-id="${id}"]`);
  if (btn) { btn.textContent = '⏳ 실행 중...'; btn.disabled = true; }
  try {
    await sendToExt({ type: 'RUN_NOW', scheduleId: id });
    showToast('✅ 캡처가 시작되었습니다');
    setTimeout(loadData, 5000);
  } catch (err) {
    showToast('⚠ 확장 프로그램 연결이 필요합니다', 'error');
  }
  if (btn) { btn.textContent = '▶ 지금 실행'; btn.disabled = false; }
}

// ── 모달 ─────────────────────────────────────────────────
function openModal(editId = null) {
  editingScheduleId = editId;
  const s = editId ? schedules.find(s => s.id === editId) : null;

  document.getElementById('modalTitle').textContent = editId ? '스케줄 편집' : '스케줄 추가';
  document.getElementById('mName').value = s?.name || '';
  document.getElementById('mWait').value = s?.extraWait ? s.extraWait / 1000 : 3;
  document.getElementById('mLocalDownload').value = String(s?.localDownload || false);

  modalTimes = s ? ([...new Set([...(s.times || []), s.time].filter(Boolean))]) : [];
  modalUrls = s ? s.urls.map(u => ({ ...u })) : [];

  renderModalTimes();
  renderModalUrls();
  document.getElementById('scheduleModal').classList.add('open');
}

function closeModal() {
  document.getElementById('scheduleModal').classList.remove('open');
  editingScheduleId = null;
}

function renderModalTimes() {
  document.getElementById('timeTags').innerHTML = modalTimes.map(t => `
    <div class="time-tag">
      ${t}
      <button class="remove-time" data-time="${t}">×</button>
    </div>
  `).join('');
  document.querySelectorAll('.remove-time').forEach(btn => {
    btn.addEventListener('click', () => {
      modalTimes = modalTimes.filter(t => t !== btn.dataset.time);
      renderModalTimes();
    });
  });
}

function renderModalUrls() {
  const container = document.getElementById('mUrlList');
  container.innerHTML = modalUrls.map((u, i) => `
    <div class="add-url-form" data-idx="${i}">
      <div class="form-row">
        <div class="input-group" style="flex:2">
          <label class="input-label">URL</label>
          <input type="url" class="url-input" data-idx="${i}" value="${escHtml(u.url || '')}" placeholder="https://...">
        </div>
        <div class="input-group" style="flex:1">
          <label class="input-label">레이블 (파일명에 사용)</label>
          <input type="text" class="label-input" data-idx="${i}" value="${escHtml(u.label || '')}" placeholder="예: 오리온_블로그">
        </div>
        <button class="btn btn-danger btn-icon" style="align-self:flex-end; flex-shrink:0" onclick="removeUrlRow(${i})">✕</button>
      </div>
    </div>
  `).join('');
  
  container.querySelectorAll('.url-input').forEach(inp => {
    inp.addEventListener('input', e => { modalUrls[+e.target.dataset.idx].url = e.target.value; });
  });
  container.querySelectorAll('.label-input').forEach(inp => {
    inp.addEventListener('input', e => { modalUrls[+e.target.dataset.idx].label = e.target.value; });
  });
}

window.removeUrlRow = function(i) {
  modalUrls.splice(i, 1);
  renderModalUrls();
};

async function saveModal() {
  const name = document.getElementById('mName').value.trim();
  if (!name) { showToast('스케줄 이름을 입력해주세요', 'error'); return; }
  if (modalTimes.length === 0) { showToast('실행 시간을 하나 이상 추가해주세요', 'error'); return; }
  
  const validUrls = modalUrls.filter(u => u.url?.trim());
  if (validUrls.length === 0) { showToast('URL을 하나 이상 추가해주세요', 'error'); return; }

  // 다중 시간 → 각각 별도 스케줄로 분리 (또는 times 배열로 저장)
  const scheduleData = {
    id: editingScheduleId || generateId(),
    name,
    times: modalTimes,
    time: modalTimes[0], // 하위 호환
    urls: validUrls.map(u => ({ ...u, id: u.id || generateId() })),
    extraWait: parseInt(document.getElementById('mWait').value) * 1000,
    localDownload: document.getElementById('mLocalDownload').value === 'true',
    enabled: true,
    createdAt: editingScheduleId ? undefined : new Date().toISOString()
  };

  if (editingScheduleId) {
    schedules = schedules.map(s => s.id === editingScheduleId ? scheduleData : s);
  } else {
    schedules.push(scheduleData);
  }

  await saveSchedules();
  closeModal();
  renderSchedules();
  renderStats();
  showToast('✅ 스케줄이 저장되었습니다');
}

// ── Drive 렌더링 ─────────────────────────────────────────
function renderDrive() {
  const connected = document.getElementById('driveConnected');
  const guide = document.getElementById('driveSetupGuide');

  if (driveConfig?.folderId) {
    connected.style.display = 'flex';
    guide.style.display = 'none';
    document.getElementById('driveFolderName').textContent = `폴더 ID: ${driveConfig.folderId}`;
  } else {
    connected.style.display = 'none';
    guide.style.display = 'block';
  }
}

async function connectDrive() {
  const folderId = document.getElementById('folderIdInput').value.trim();
  if (!folderId) { showToast('폴더 ID를 입력해주세요', 'error'); return; }

  try {
    const { token } = await sendToExt({ type: 'GET_AUTH_TOKEN' });
    if (!token) throw new Error('인증 실패');

    driveConfig = { folderId, accessToken: token };
    await sendToExt({ type: 'SAVE_DRIVE_CONFIG', config: driveConfig });
    localStorage.setItem('sns_drive_config', JSON.stringify(driveConfig));
    
    renderDrive();
    showToast('✅ Google Drive 연결 완료!');
  } catch (err) {
    showToast('⚠ Drive 연결 실패: ' + err.message, 'error');
  }
}

async function disconnectDrive() {
  driveConfig = null;
  localStorage.removeItem('sns_drive_config');
  await sendToExt({ type: 'SAVE_DRIVE_CONFIG', config: null }).catch(() => {});
  renderDrive();
  showToast('Drive 연결이 해제되었습니다');
}

// ── 로그 렌더링 ──────────────────────────────────────────
function renderLogs() {
  const tbody = document.getElementById('logTableBody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="log-empty">캡처 기록이 없습니다</td></tr>';
    return;
  }
  
  const recent = [...logs].reverse().slice(0, 100);
  tbody.innerHTML = recent.map(log => {
    const sched = schedules.find(s => s.id === log.scheduleId);
    const time = new Date(log.timestamp).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const domain = (() => { try { return new URL(log.url).hostname.replace('www.',''); } catch { return log.url; } })();
    return `
      <tr>
        <td class="${log.status === 'success' ? 'log-success' : 'log-failed'}">${log.status === 'success' ? '✓ 성공' : '✕ 실패'}</td>
        <td>${escHtml(sched?.name || log.scheduleId)}</td>
        <td class="log-url-cell" title="${escHtml(log.url)}">${escHtml(domain)}</td>
        <td style="font-size:11px; color:var(--text2)">${escHtml(log.detail || '')}</td>
        <td class="log-time-cell">${time}</td>
      </tr>
    `;
  }).join('');
}

// ── 저장 ─────────────────────────────────────────────────
async function saveSchedules() {
  try {
    await sendToExt({ type: 'SAVE_SCHEDULES', schedules });
  } catch {
    localStorage.setItem('sns_schedules', JSON.stringify(schedules));
  }
}

// ── 탭 ───────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ── 이벤트 연결 ──────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('addScheduleBtn').addEventListener('click', () => openModal());
  document.getElementById('runAllBtn').addEventListener('click', async () => {
    const btn = document.getElementById('runAllBtn');
    btn.textContent = '⏳ 실행 중...';
    btn.disabled = true;
    for (const s of schedules.filter(s => s.enabled)) {
      await runScheduleNow(s.id);
      await new Promise(r => setTimeout(r, 1000));
    }
    btn.textContent = '▶ 지금 전체 캡처';
    btn.disabled = false;
  });

  document.getElementById('addTimeBtn').addEventListener('click', () => {
    const t = document.getElementById('mTimeInput').value;
    if (!t) return;
    if (!modalTimes.includes(t)) { modalTimes.push(t); renderModalTimes(); }
    document.getElementById('mTimeInput').value = '';
  });
  document.getElementById('mTimeInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('addTimeBtn').click();
  });

  document.getElementById('addUrlRowBtn').addEventListener('click', () => {
    modalUrls.push({ id: generateId(), url: '', label: '' });
    renderModalUrls();
  });

  document.getElementById('modalSaveBtn').addEventListener('click', saveModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('scheduleModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById('connectDriveBtn').addEventListener('click', connectDrive);
  document.getElementById('disconnectDriveBtn').addEventListener('click', disconnectDrive);
  document.getElementById('refreshLogsBtn').addEventListener('click', loadData);
}

// ── 유틸리티 ─────────────────────────────────────────────
function generateId() { return Math.random().toString(36).slice(2, 10); }

function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getPlatform(url) {
  if (!url) return '';
  if (url.includes('naver.com')) return 'naver';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('youtube.com')) return 'youtube';
  return 'naver';
}

function getPlatformName(url) {
  if (!url) return '';
  if (url.includes('blog.naver')) return 'N블로그';
  if (url.includes('cafe.naver')) return 'N카페';
  if (url.includes('search.naver')) return 'N검색';
  if (url.includes('naver.com')) return 'Naver';
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('youtube.com')) return 'YouTube';
  return 'Web';
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.borderColor = type === 'error' ? 'rgba(255,80,96,0.3)' : 'var(--border2)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── 시작 ─────────────────────────────────────────────────
init();
