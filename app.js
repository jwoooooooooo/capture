// ============================================================
// SNS Monitor WebApp - app.js
// ============================================================
// v2
const EXT_ID = 'heolilimiogheedodmacegnpeidhngam';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzb2CDFE3zQqBvvsOttfsQKhpyNbjlcIVhs9EUxNaPap0Qxe91HmRsIySaAJZQFZkk/exec';

let schedules = [];
let driveConfig = null;
let logs = [];
let editingScheduleId = null;
let modalTimes = [];
let modalUrls = [];

function sendToExt(msg) {
  return new Promise((resolve, reject) => {
    if (!window.chrome?.runtime?.sendMessage) { reject(new Error('NO_EXT')); return; }
    chrome.runtime.sendMessage(EXT_ID, msg, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (resp?.error) reject(new Error(resp.error));
      else resolve(resp);
    });
  });
}

async function init() {
  await checkExtension();
  await loadData();
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
    // 확장에서 받은 스케줄을 localStorage에도 백업
    if (schedules.length > 0) {
      localStorage.setItem('sns_schedules', JSON.stringify(schedules));
    }
  } catch {
    // 확장 연결 실패 시 localStorage 백업에서 복원 (덮어쓰지 않음)
    const backup = JSON.parse(localStorage.getItem('sns_schedules') || '[]');
    if (backup.length > 0) schedules = backup;
  }
  try {
    const res = await sendToExt({ type: 'GET_LOGS' });
    logs = res.logs || [];
  } catch { logs = []; }
  driveConfig = JSON.parse(localStorage.getItem('sns_drive_config') || 'null');
  renderStats();
  renderSchedules();
  renderDrive();
  renderLogs();
}

function renderStats() {
  const active = schedules.filter(s => s.enabled);
  document.getElementById('statSchedules').textContent = active.length;
  document.getElementById('statUrls').textContent = active.reduce((sum, s) => sum + (s.urls?.length || 0), 0);
  const today = new Date().toLocaleDateString('ko-KR');
  document.getElementById('statToday').textContent = logs.filter(l => l.status === 'success' && new Date(l.timestamp).toLocaleDateString('ko-KR') === today).length;
  if (logs.length > 0) {
    document.getElementById('statRate').textContent = Math.round(logs.filter(l => l.status === 'success').length / logs.length * 100) + '%';
  }
}

function renderSchedules() {
  const list = document.getElementById('scheduleList');
  if (schedules.length === 0) {
    list.innerHTML = `<div style="text-align:center;color:var(--text2);padding:40px;font-size:14px;">스케줄이 없습니다. 위의 버튼으로 추가해주세요.</div>`;
    return;
  }
  list.innerHTML = schedules.map(s => {
    const times = (s.times || [s.time]).filter(Boolean);
    return `
    <div class="schedule-card ${s.enabled ? '' : 'disabled'}" data-id="${s.id}">
      <div class="card-header">
        <label class="card-toggle">
          <input type="checkbox" class="toggle-input" ${s.enabled ? 'checked' : ''} data-id="${s.id}">
          <span class="toggle-slider"></span>
        </label>
        <div class="card-info">
          <div class="card-name">${escHtml(s.name)}</div>
          <div class="card-meta">
            <span>🕐 ${times.join(', ')}</span>
            <span>🔗 ${s.urls?.length || 0}개 URL</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm btn-run" data-id="${s.id}">▶ 지금 실행</button>
          <button class="btn btn-ghost btn-icon btn-edit" data-id="${s.id}">✏</button>
          <button class="btn btn-danger btn-icon btn-delete" data-id="${s.id}">🗑</button>
          <button class="btn-expand card-expand-btn">▼</button>
        </div>
      </div>
      <div class="card-body">
        <table class="url-table">
          <thead><tr><th>레이블</th><th>플랫폼</th><th>URL</th><th>크롭</th><th></th></tr></thead>
          <tbody>
            ${(s.urls || []).map(u => `
              <tr>
                <td class="label-cell">${escHtml(u.label || '—')}</td>
                <td><span class="platform-badge ${getPlatform(u.url)}">${getPlatformName(u.url)}</span></td>
                <td class="url-cell" title="${escHtml(u.url)}">${escHtml(u.url)}</td>
                <td>${u.cropRegion ? `<span class="crop-status set">✓ ${u.cropRegion.width}×${u.cropRegion.height}</span>` : `<span class="crop-status unset">미설정</span>`}</td>
                <td><button class="btn btn-ghost btn-sm btn-crop" data-sched-id="${s.id}" data-url-id="${u.id}">크롭 설정</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.toggle-input').forEach(el => {
    el.addEventListener('change', e => toggleSchedule(e.target.dataset.id, e.target.checked));
  });
  list.querySelectorAll('.btn-run').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); runScheduleNow(el.dataset.id); });
  });
  list.querySelectorAll('.btn-edit').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); openModal(el.dataset.id); });
  });
  list.querySelectorAll('.btn-delete').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); deleteSchedule(el.dataset.id); });
  });
  list.querySelectorAll('.btn-expand').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const card = el.closest('.schedule-card');
      card.classList.toggle('expanded');
      el.textContent = card.classList.contains('expanded') ? '▲' : '▼';
    });
  });
  list.querySelectorAll('.card-header').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('label')) return;
      const card = el.closest('.schedule-card');
      card.classList.toggle('expanded');
      const btn = card.querySelector('.btn-expand');
      if (btn) btn.textContent = card.classList.contains('expanded') ? '▲' : '▼';
    });
  });
  list.querySelectorAll('.btn-crop').forEach(el => {
    el.addEventListener('click', () => startCropMode(el.dataset.schedId, el.dataset.urlId));
  });
}

async function toggleSchedule(id, enabled) {
  schedules = schedules.map(s => s.id === id ? { ...s, enabled } : s);
  await saveSchedules();
  renderStats();
}

async function deleteSchedule(id) {
  if (!confirm('이 스케줄을 삭제하시겠습니까?')) return;
  schedules = schedules.filter(s => s.id !== id);
  await saveSchedules();
  renderSchedules();
  renderStats();
  showToast('✅ 스케줄 삭제 완료');
}

async function runScheduleNow(id) {
  const btn = document.querySelector(`.btn-run[data-id="${id}"]`);
  if (btn) { btn.textContent = '⏳ 실행 중...'; btn.disabled = true; }
  try {
    await sendToExt({ type: 'RUN_NOW', scheduleId: id });
    showToast('✅ 캡처가 시작되었습니다');
    setTimeout(loadData, 5000);
  } catch {
    showToast('⚠ 확장 프로그램 연결이 필요합니다', 'error');
  }
  if (btn) { btn.textContent = '▶ 지금 실행'; btn.disabled = false; }
}

async function startCropMode(schedId, urlId) {
  showToast('📸 해당 URL 탭에서 캡처 영역을 드래그하세요');
  try { await sendToExt({ type: 'OPEN_CROP_MODE', schedId, urlId }); }
  catch { showToast('⚠ 확장 프로그램 연결이 필요합니다', 'error'); }
}

function openModal(editId = null) {
  editingScheduleId = editId;
  const s = editId ? schedules.find(s => s.id === editId) : null;
  document.getElementById('modalTitle').textContent = editId ? '스케줄 편집' : '스케줄 추가';
  document.getElementById('mName').value = s?.name || '';
  document.getElementById('mWait').value = s?.extraWait ? s.extraWait / 1000 : 3;
  document.getElementById('mLocalDownload').value = String(s?.localDownload || false);
  modalTimes = s ? [...new Set([...(s.times || []), s.time].filter(Boolean))] : [];
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
  const container = document.getElementById('timeTags');
  container.innerHTML = modalTimes.map(t => `
    <div class="time-tag">${t}<button class="remove-time" data-time="${t}">×</button></div>`).join('');
  container.querySelectorAll('.remove-time').forEach(btn => {
    btn.addEventListener('click', () => { modalTimes = modalTimes.filter(t => t !== btn.dataset.time); renderModalTimes(); });
  });
}

function renderModalUrls() {
  const container = document.getElementById('mUrlList');
  container.innerHTML = modalUrls.map((u, i) => `
    <div class="add-url-form">
      <div class="form-row">
        <div class="input-group" style="flex:2">
          <label class="input-label">URL</label>
          <input type="url" class="url-input" data-idx="${i}" value="${escHtml(u.url || '')}" placeholder="https://...">
        </div>
        <div class="input-group" style="flex:1">
          <label class="input-label">레이블</label>
          <input type="text" class="label-input" data-idx="${i}" value="${escHtml(u.label || '')}" placeholder="예: 오리온_블로그">
        </div>
        <button class="btn btn-danger btn-icon remove-url-btn" data-idx="${i}" style="align-self:flex-end;flex-shrink:0">✕</button>
      </div>
    </div>`).join('');
  container.querySelectorAll('.url-input').forEach(inp => {
    inp.addEventListener('input', e => { modalUrls[+e.target.dataset.idx].url = e.target.value; });
  });
  container.querySelectorAll('.label-input').forEach(inp => {
    inp.addEventListener('input', e => { modalUrls[+e.target.dataset.idx].label = e.target.value; });
  });
  container.querySelectorAll('.remove-url-btn').forEach(btn => {
    btn.addEventListener('click', () => { modalUrls.splice(+btn.dataset.idx, 1); renderModalUrls(); });
  });
}

async function saveModal() {
  const name = document.getElementById('mName').value.trim();
  if (!name) { showToast('스케줄 이름을 입력해주세요', 'error'); return; }
  if (modalTimes.length === 0) { showToast('실행 시간을 하나 이상 추가해주세요', 'error'); return; }
  const validUrls = modalUrls.filter(u => u.url?.trim());
  if (validUrls.length === 0) { showToast('URL을 하나 이상 추가해주세요', 'error'); return; }

  const scheduleData = {
    id: editingScheduleId || generateId(),
    name,
    times: modalTimes,
    time: modalTimes[0],
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

async function connectDrive() {
  try {
    const res = await fetch(APPS_SCRIPT_URL);
    const data = await res.json();
    if (!data.ok) throw new Error('Apps Script 응답 오류');
    driveConfig = { appsScriptUrl: APPS_SCRIPT_URL, connected: true };
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
  renderDrive();
  showToast('Drive 연결이 해제되었습니다');
}

function renderDrive() {
  const connected = document.getElementById('driveConnected');
  const guide = document.getElementById('driveSetupGuide');
  if (driveConfig?.connected) {
    connected.style.display = 'flex';
    guide.style.display = 'none';
    document.getElementById('driveFolderName').textContent = 'Apps Script 연결됨 ✓';
  } else {
    connected.style.display = 'none';
    guide.style.display = 'block';
  }
}

function renderLogs() {
  const tbody = document.getElementById('logTableBody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="log-empty">캡처 기록이 없습니다</td></tr>';
    return;
  }
  tbody.innerHTML = [...logs].reverse().slice(0, 100).map(log => {
    const sched = schedules.find(s => s.id === log.scheduleId);
    const time = new Date(log.timestamp).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const domain = (() => { try { return new URL(log.url).hostname.replace('www.', ''); } catch { return log.url; } })();
    return `<tr>
      <td class="${log.status === 'success' ? 'log-success' : 'log-failed'}">${log.status === 'success' ? '✓ 성공' : '✕ 실패'}</td>
      <td>${escHtml(sched?.name || '')}</td>
      <td class="log-url-cell">${escHtml(domain)}</td>
      <td style="font-size:11px;color:var(--text2)">${escHtml(log.detail || '')}</td>
      <td class="log-time-cell">${time}</td>
    </tr>`;
  }).join('');
}

async function saveSchedules() {
  try { await sendToExt({ type: 'SAVE_SCHEDULES', schedules }); }
  catch { localStorage.setItem('sns_schedules', JSON.stringify(schedules)); }
}

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

function generateId() { return Math.random().toString(36).slice(2, 10); }

function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();

  document.getElementById('runAllBtn').addEventListener('click', async () => {
    const btn = document.getElementById('runAllBtn');
    btn.textContent = '⏳ 실행 중...'; btn.disabled = true;
    for (const s of schedules.filter(s => s.enabled)) {
      await runScheduleNow(s.id);
      await new Promise(r => setTimeout(r, 1000));
    }
    btn.textContent = '▶ 지금 전체 캡처'; btn.disabled = false;
  });

  document.getElementById('addScheduleBtn').addEventListener('click', () => openModal());

  document.getElementById('addTimeBtn').addEventListener('click', () => {
    const t = document.getElementById('mTimeInput').value;
    if (!t) return;
    if (!modalTimes.includes(t)) { modalTimes.push(t); renderModalTimes(); }
    document.getElementById('mTimeInput').value = '';
  });
  document.getElementById('mTimeInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('addTimeBtn').click();
  });

  document.getElementById('addUrlRowBtn').addEventListener('click', () => {
    modalUrls.push({ id: generateId(), url: '', label: '' });
    renderModalUrls();
  });

  document.getElementById('modalSaveBtn').addEventListener('click', saveModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('scheduleModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById('connectDriveBtn').addEventListener('click', connectDrive);
  document.getElementById('disconnectDriveBtn').addEventListener('click', disconnectDrive);
  document.getElementById('refreshLogsBtn').addEventListener('click', loadData);

  init();
});
// DOMContentLoaded가 이미 실행됐을 경우 직접 실행
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => {
    setupTabs();
    document.getElementById('runAllBtn').addEventListener('click', async () => {
      const btn = document.getElementById('runAllBtn');
      btn.textContent = '⏳ 실행 중...'; btn.disabled = true;
      for (const s of schedules.filter(s => s.enabled)) {
        await runScheduleNow(s.id);
        await new Promise(r => setTimeout(r, 1000));
      }
      btn.textContent = '▶ 지금 전체 캡처'; btn.disabled = false;
    });
    document.getElementById('addScheduleBtn').addEventListener('click', () => openModal());
    document.getElementById('addTimeBtn').addEventListener('click', () => {
      const t = document.getElementById('mTimeInput').value;
      if (!t) return;
      if (!modalTimes.includes(t)) { modalTimes.push(t); renderModalTimes(); }
      document.getElementById('mTimeInput').value = '';
    });
    document.getElementById('mTimeInput').addEventListener('keypress', e => {
      if (e.key === 'Enter') document.getElementById('addTimeBtn').click();
    });
    document.getElementById('addUrlRowBtn').addEventListener('click', () => {
      modalUrls.push({ id: generateId(), url: '', label: '' });
      renderModalUrls();
    });
    document.getElementById('modalSaveBtn').addEventListener('click', saveModal);
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    document.getElementById('scheduleModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('connectDriveBtn').addEventListener('click', connectDrive);
    document.getElementById('disconnectDriveBtn').addEventListener('click', disconnectDrive);
    document.getElementById('refreshLogsBtn').addEventListener('click', loadData);
    init();
  }, 0);
}
