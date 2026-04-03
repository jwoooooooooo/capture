// SNS Monitor WebApp - app.js

const EXT_ID = 'klpcoocimooedofbgmnbmnfhcofichkd';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzb2CDFE3zQqBvvsOttfsQKhpyNbjlcIVhs9EUxNaPap0Qxe91HmRsIySaAJZQFZkk/exec';

let schedules = [];
let blogGroups = [];
let driveConfig = null;
let logs = [];
let editingScheduleId = null;
let editingGroupId = null;
let modalTimes = [];
let modalUrls = [];
let groupModalUrls = [];

function sendToExt(msg) {
  return new Promise(function(resolve, reject) {
    if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) { reject(new Error('NO_EXT')); return; }
    chrome.runtime.sendMessage(EXT_ID, msg, function(resp) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (resp && resp.error) reject(new Error(resp.error));
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
  } catch(e) {
    el.textContent = '⚠ 확장 프로그램 필요';
    el.style.color = 'var(--warn)';
    el.style.borderColor = 'rgba(255,176,64,0.3)';
  }
}

async function loadData() {
  try {
    const res = await sendToExt({ type: 'GET_SCHEDULES' });
    schedules = res.schedules || [];
    localStorage.setItem('sns_schedules', JSON.stringify(schedules));
  } catch(e) {
    schedules = JSON.parse(localStorage.getItem('sns_schedules') || '[]');
  }
  try {
    const res = await sendToExt({ type: 'GET_LOGS' });
    logs = res.logs || [];
  } catch(e) { logs = []; }
  blogGroups = JSON.parse(localStorage.getItem('sns_blog_groups') || '[]');
  driveConfig = JSON.parse(localStorage.getItem('sns_drive_config') || 'null');
  renderStats();
  renderSchedules();
  renderBlogGroups();
  renderDrive();
  renderLogs();
}

function renderStats() {
  const active = schedules.filter(function(s) { return s.enabled; });
  document.getElementById('statSchedules').textContent = active.length;
  document.getElementById('statUrls').textContent = active.reduce(function(sum, s) { return sum + (s.urls ? s.urls.length : 0); }, 0);
  const today = new Date().toLocaleDateString('ko-KR');
  document.getElementById('statToday').textContent = logs.filter(function(l) { return l.status === 'success' && new Date(l.timestamp).toLocaleDateString('ko-KR') === today; }).length;
  if (logs.length > 0) {
    document.getElementById('statRate').textContent = Math.round(logs.filter(function(l) { return l.status === 'success'; }).length / logs.length * 100) + '%';
  }
}

// ── 통합검색 자동캡처 ────────────────────────────────────
function renderSchedules() {
  const list = document.getElementById('scheduleList');
  if (schedules.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text2);padding:40px;font-size:14px;">스케줄이 없습니다. 위의 버튼으로 추가해주세요.</div>';
    return;
  }
  list.innerHTML = schedules.map(function(s) {
    const times = (s.times || [s.time]).filter(Boolean);
    return '<div class="schedule-card ' + (s.enabled ? '' : 'disabled') + '" data-id="' + s.id + '">' +
      '<div class="card-header">' +
        '<label class="card-toggle"><input type="checkbox" class="toggle-input" ' + (s.enabled ? 'checked' : '') + ' data-id="' + s.id + '"><span class="toggle-slider"></span></label>' +
        '<div class="card-info">' +
          '<div class="card-name">' + escHtml(s.name) + '</div>' +
          '<div class="card-meta"><span>🕐 ' + times.join(', ') + '</span><span>🔗 ' + (s.urls ? s.urls.length : 0) + '개 URL</span></div>' +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="btn btn-ghost btn-sm btn-run" data-id="' + s.id + '">▶ 지금 실행</button>' +
          '<button class="btn btn-ghost btn-icon btn-edit" data-id="' + s.id + '">✏</button>' +
          '<button class="btn btn-danger btn-icon btn-delete" data-id="' + s.id + '">🗑</button>' +
          '<button class="btn-expand card-expand-btn">▼</button>' +
        '</div>' +
      '</div>' +
      '<div class="card-body">' +
        '<table class="url-table"><thead><tr><th>키워드</th><th>URL</th><th>크롭</th><th></th></tr></thead><tbody>' +
        (s.urls || []).map(function(u) {
          return '<tr><td class="label-cell">' + escHtml(u.label || '—') + '</td>' +
            '<td class="url-cell" title="' + escHtml(u.url) + '">' + escHtml(u.url) + '</td>' +
            '<td>' + (u.cropRegion ? '<span class="crop-status set">✓ ' + u.cropRegion.width + 'px</span>' : '<span class="crop-status unset">미설정</span>') + '</td>' +
            '<td><button class="btn btn-ghost btn-sm btn-crop" data-sched-id="' + s.id + '" data-url-id="' + u.id + '">크롭 설정</button></td></tr>';
        }).join('') +
        '</tbody></table>' +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('.toggle-input').forEach(function(el) {
    el.addEventListener('change', function(e) { toggleSchedule(e.target.dataset.id, e.target.checked); });
  });
  list.querySelectorAll('.btn-run').forEach(function(el) {
    el.addEventListener('click', function(e) { e.stopPropagation(); runScheduleNow(el.dataset.id); });
  });
  list.querySelectorAll('.btn-edit').forEach(function(el) {
    el.addEventListener('click', function(e) { e.stopPropagation(); openModal(el.dataset.id); });
  });
  list.querySelectorAll('.btn-delete').forEach(function(el) {
    el.addEventListener('click', function(e) { e.stopPropagation(); deleteSchedule(el.dataset.id); });
  });
  list.querySelectorAll('.btn-expand').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      const card = el.closest('.schedule-card');
      card.classList.toggle('expanded');
      el.textContent = card.classList.contains('expanded') ? '▲' : '▼';
    });
  });
  list.querySelectorAll('.card-header').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('button') || e.target.closest('label')) return;
      const card = el.closest('.schedule-card');
      card.classList.toggle('expanded');
      const btn = card.querySelector('.btn-expand');
      if (btn) btn.textContent = card.classList.contains('expanded') ? '▲' : '▼';
    });
  });
  list.querySelectorAll('.btn-crop').forEach(function(el) {
    el.addEventListener('click', function() { startCropMode(el.dataset.schedId, el.dataset.urlId); });
  });
}

async function toggleSchedule(id, enabled) {
  schedules = schedules.map(function(s) { return s.id === id ? Object.assign({}, s, { enabled: enabled }) : s; });
  await saveSchedules();
  renderStats();
}

async function deleteSchedule(id) {
  if (!confirm('이 스케줄을 삭제하시겠습니까?')) return;
  schedules = schedules.filter(function(s) { return s.id !== id; });
  await saveSchedules();
  renderSchedules();
  renderStats();
  showToast('✅ 스케줄 삭제 완료');
}

async function runScheduleNow(id) {
  const btn = document.querySelector('.btn-run[data-id="' + id + '"]');
  if (btn) { btn.textContent = '⏳ 실행 중...'; btn.disabled = true; }
  try {
    await sendToExt({ type: 'RUN_NOW', scheduleId: id });
    showToast('✅ 캡처가 시작되었습니다');
    setTimeout(loadData, 5000);
  } catch(err) {
    showToast('⚠ ' + err.message, 'error');
  }
  if (btn) { btn.textContent = '▶ 지금 실행'; btn.disabled = false; }
}

async function startCropMode(schedId, urlId) {
  const sched = schedules.find(function(s) { return s.id === schedId; });
  const urlItem = sched && sched.urls.find(function(u) { return u.id === urlId; });
  if (!urlItem) return;
  try {
    await sendToExt({ type: 'OPEN_CROP_MODE', schedId: schedId, urlId: urlId, url: urlItem.url, currentRegion: urlItem.cropRegion || null });
    showToast('📸 열린 탭에서 클릭 2번으로 크롭 영역을 설정하세요');
  } catch(err) {
    showToast('⚠ ' + err.message, 'error');
  }
}

// ── 스케줄 모달 ──────────────────────────────────────────
function openModal(editId) {
  editId = editId || null;
  editingScheduleId = editId;
  const s = editId ? schedules.find(function(s) { return s.id === editId; }) : null;
  document.getElementById('modalTitle').textContent = editId ? '스케줄 편집' : '스케줄 추가';
  document.getElementById('mName').value = s ? s.name : '';
  document.getElementById('mWait').value = s && s.extraWait ? s.extraWait / 1000 : 3;
  document.getElementById('mLocalDownload').value = String(s ? s.localDownload : false);
  modalTimes = s ? [].concat(s.times || [], s.time ? [s.time] : []).filter(Boolean).filter(function(v, i, a) { return a.indexOf(v) === i; }) : [];
  modalUrls = s ? s.urls.map(function(u) { return Object.assign({}, u); }) : [];
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
  container.innerHTML = modalTimes.map(function(t) {
    return '<div class="time-tag">' + t + '<button class="remove-time" data-time="' + t + '">×</button></div>';
  }).join('');
  container.querySelectorAll('.remove-time').forEach(function(btn) {
    btn.addEventListener('click', function() { modalTimes = modalTimes.filter(function(t) { return t !== btn.dataset.time; }); renderModalTimes(); });
  });
}

function renderModalUrls() {
  const container = document.getElementById('mUrlList');
  container.innerHTML = modalUrls.map(function(u, i) {
    return '<div class="add-url-form"><div class="form-row">' +
      '<div class="input-group" style="flex:2"><label class="input-label">URL</label><input type="url" class="url-input" data-idx="' + i + '" value="' + escHtml(u.url || '') + '" placeholder="https://search.naver.com/..."></div>' +
      '<div class="input-group" style="flex:1"><label class="input-label">키워드</label><input type="text" class="label-input" data-idx="' + i + '" value="' + escHtml(u.label || '') + '" placeholder="예: 일본어학습지"></div>' +
      '<button class="btn btn-danger btn-icon remove-url-btn" data-idx="' + i + '" style="align-self:flex-end;flex-shrink:0">✕</button>' +
    '</div></div>';
  }).join('');
  container.querySelectorAll('.url-input').forEach(function(inp) {
    inp.addEventListener('input', function(e) { modalUrls[+e.target.dataset.idx].url = e.target.value; });
  });
  container.querySelectorAll('.label-input').forEach(function(inp) {
    inp.addEventListener('input', function(e) { modalUrls[+e.target.dataset.idx].label = e.target.value; });
  });
  container.querySelectorAll('.remove-url-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { modalUrls.splice(+btn.dataset.idx, 1); renderModalUrls(); });
  });
}

async function saveModal() {
  const name = document.getElementById('mName').value.trim();
  if (!name) { showToast('스케줄 이름을 입력해주세요', 'error'); return; }
  if (modalTimes.length === 0) { showToast('실행 시간을 하나 이상 추가해주세요', 'error'); return; }
  const validUrls = modalUrls.filter(function(u) { return u.url && u.url.trim(); });
  if (validUrls.length === 0) { showToast('URL을 하나 이상 추가해주세요', 'error'); return; }
  const scheduleData = {
    id: editingScheduleId || generateId(),
    name: name,
    times: modalTimes,
    time: modalTimes[0],
    urls: validUrls.map(function(u) { return Object.assign({}, u, { id: u.id || generateId() }); }),
    extraWait: parseInt(document.getElementById('mWait').value) * 1000,
    localDownload: document.getElementById('mLocalDownload').value === 'true',
    enabled: true
  };
  if (editingScheduleId) {
    schedules = schedules.map(function(s) { return s.id === editingScheduleId ? scheduleData : s; });
  } else {
    schedules.push(scheduleData);
  }
  await saveSchedules();
  closeModal();
  renderSchedules();
  renderStats();
  showToast('✅ 스케줄이 저장되었습니다');
}

// ── 컨텐츠 즉시캡처 ─────────────────────────────────────
function renderBlogGroups() {
  const list = document.getElementById('blogGroupList');
  if (blogGroups.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text2);padding:40px;font-size:14px;">묶음이 없습니다. 위의 버튼으로 추가해주세요.</div>';
    return;
  }
  list.innerHTML = blogGroups.map(function(g) {
    return '<div class="schedule-card" data-id="' + g.id + '">' +
      '<div class="card-header">' +
        '<div class="card-info">' +
          '<div class="card-name">' + escHtml(g.name) + '</div>' +
          '<div class="card-meta">' +
            '<span>🔗 ' + (g.urls ? g.urls.length : 0) + '개 URL</span>' +
            '<span>' + (g.cropRegion ? '✂ 크롭: ' + g.cropRegion.startX + '~' + g.cropRegion.endX + 'px' : '✂ 크롭 미설정') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="btn btn-primary btn-sm btn-group-run" data-id="' + g.id + '">▶ 즉시 캡처</button>' +
          '<button class="btn btn-ghost btn-sm btn-group-crop" data-id="' + g.id + '">✂ 크롭 설정</button>' +
          '<button class="btn btn-ghost btn-icon btn-group-edit" data-id="' + g.id + '">✏</button>' +
          '<button class="btn btn-danger btn-icon btn-group-delete" data-id="' + g.id + '">🗑</button>' +
          '<button class="btn-expand card-expand-btn">▼</button>' +
        '</div>' +
      '</div>' +
      '<div class="card-body">' +
        '<table class="url-table"><thead><tr><th>레이블</th><th>URL</th></tr></thead><tbody>' +
        (g.urls || []).map(function(u) {
          return '<tr><td class="label-cell">' + escHtml(u.label || '—') + '</td><td class="url-cell" title="' + escHtml(u.url) + '">' + escHtml(u.url) + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('.btn-group-run').forEach(function(el) {
    el.addEventListener('click', function(e) { e.stopPropagation(); runGroupNow(el.dataset.id); });
  });
  list.querySelectorAll('.btn-group-crop').forEach(function(el) {
    el.addEventListener('click', function(e) { e.stopPropagation(); setGroupCrop(el.dataset.id); });
  });
  list.querySelectorAll('.btn-group-edit').forEach(function(el) {
    el.addEventListener('click', function(e) { e.stopPropagation(); openGroupModal(el.dataset.id); });
  });
  list.querySelectorAll('.btn-group-delete').forEach(function(el) {
    el.addEventListener('click', function(e) { e.stopPropagation(); deleteGroup(el.dataset.id); });
  });
  list.querySelectorAll('.btn-expand').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      const card = el.closest('.schedule-card');
      card.classList.toggle('expanded');
      el.textContent = card.classList.contains('expanded') ? '▲' : '▼';
    });
  });
  list.querySelectorAll('.card-header').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('button')) return;
      const card = el.closest('.schedule-card');
      card.classList.toggle('expanded');
      const btn = card.querySelector('.btn-expand');
      if (btn) btn.textContent = card.classList.contains('expanded') ? '▲' : '▼';
    });
  });
}

async function runGroupNow(id) {
  const group = blogGroups.find(function(g) { return g.id === id; });
  if (!group) return;
  const btn = document.querySelector('.btn-group-run[data-id="' + id + '"]');
  if (btn) { btn.textContent = '⏳ 캡처 중...'; btn.disabled = true; }
  try {
    await sendToExt({ type: 'RUN_GROUP', group: group });
    showToast('✅ 캡처가 시작되었습니다');
    setTimeout(loadData, 5000);
  } catch(err) {
    showToast('⚠ ' + err.message, 'error');
  }
  if (btn) { btn.textContent = '▶ 즉시 캡처'; btn.disabled = false; }
}

async function setGroupCrop(id) {
  const group = blogGroups.find(function(g) { return g.id === id; });
  if (!group || !group.urls || group.urls.length === 0) { showToast('먼저 URL을 추가해주세요', 'error'); return; }

  // 크롭 기준으로 사용할 URL 선택
  let cropUrl = group.urls[0].url;
  if (group.urls.length > 1) {
    const options = group.urls.map(function(u, i) { return (i+1) + '. ' + (u.label || u.url); }).join('\n');
    const choice = prompt('크롭 기준으로 사용할 URL 번호를 선택하세요:\n\n' + options, '1');
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < group.urls.length) cropUrl = group.urls[idx].url;
  }

  try {
    await sendToExt({ type: 'OPEN_GROUP_CROP', groupId: id, url: cropUrl, currentRegion: group.cropRegion || null });
    showToast('📸 열린 탭에서 클릭 2번으로 크롭 영역을 설정하세요');
  } catch(err) {
    showToast('⚠ ' + err.message, 'error');
  }
}

async function deleteGroup(id) {
  if (!confirm('이 묶음을 삭제하시겠습니까?')) return;
  blogGroups = blogGroups.filter(function(g) { return g.id !== id; });
  saveBlogGroups();
  renderBlogGroups();
  showToast('✅ 묶음 삭제 완료');
}

function openGroupModal(editId) {
  editId = editId || null;
  editingGroupId = editId;
  const g = editId ? blogGroups.find(function(g) { return g.id === editId; }) : null;
  document.getElementById('groupModalTitle').textContent = editId ? '묶음 편집' : '묶음 추가';
  document.getElementById('gName').value = g ? g.name : '';
  document.getElementById('gUrlPaste').value = g ? (g.urls || []).map(function(u) { return u.url; }).join('\n') : '';
  editingGroupId = editId;
  document.getElementById('groupModal').classList.add('open');
}

function closeGroupModal() {
  document.getElementById('groupModal').classList.remove('open');
  editingGroupId = null;
}

async function saveGroupModal() {
  const name = document.getElementById('gName').value.trim();
  if (!name) { showToast('묶음 이름을 입력해주세요', 'error'); return; }
  const pasteText = document.getElementById('gUrlPaste').value.trim();
  if (!pasteText) { showToast('URL을 입력해주세요', 'error'); return; }

  const urls = pasteText.split('\n')
    .map(function(line) { return line.trim(); })
    .filter(function(line) { return line && line.startsWith('http'); })
    .slice(0, 50)
    .map(function(url) { return { id: generateId(), url: url, label: '' }; });

  if (urls.length === 0) { showToast('유효한 URL이 없습니다', 'error'); return; }

  const existing = editingGroupId ? blogGroups.find(function(g) { return g.id === editingGroupId; }) : null;
  const groupData = {
    id: editingGroupId || generateId(),
    name: name,
    urls: urls,
    cropRegion: existing ? existing.cropRegion : null
  };

  if (editingGroupId) {
    blogGroups = blogGroups.map(function(g) { return g.id === editingGroupId ? groupData : g; });
  } else {
    blogGroups.push(groupData);
  }
  saveBlogGroups();
  closeGroupModal();
  renderBlogGroups();
  showToast('✅ ' + urls.length + '개 URL이 저장되었습니다');
}

function saveBlogGroups() {
  localStorage.setItem('sns_blog_groups', JSON.stringify(blogGroups));
}

// ── Drive ────────────────────────────────────────────────
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
  if (driveConfig && driveConfig.connected) {
    connected.style.display = 'flex';
    guide.style.display = 'none';
    document.getElementById('driveFolderName').textContent = 'Apps Script 연결됨 ✓';
  } else {
    connected.style.display = 'none';
    guide.style.display = 'block';
  }
}

// ── 로그 ─────────────────────────────────────────────────
function renderLogs() {
  const tbody = document.getElementById('logTableBody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="log-empty">캡처 기록이 없습니다</td></tr>';
    return;
  }
  tbody.innerHTML = [].concat(logs).reverse().slice(0, 100).map(function(log) {
    const sched = schedules.find(function(s) { return s.id === log.scheduleId; });
    const group = blogGroups.find(function(g) { return g.id === log.scheduleId; });
    const name = (sched && sched.name) || (group && group.name) || log.scheduleId || '';
    const time = new Date(log.timestamp).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const domain = (function() { try { return new URL(log.url).hostname.replace('www.', ''); } catch(e) { return log.url; } })();
    return '<tr><td class="' + (log.status === 'success' ? 'log-success' : 'log-failed') + '">' + (log.status === 'success' ? '✓' : '✕') + '</td>' +
      '<td>' + escHtml(name) + '</td>' +
      '<td class="log-url-cell">' + escHtml(domain) + '</td>' +
      '<td style="font-size:11px;color:var(--text2)">' + escHtml(log.detail || '') + '</td>' +
      '<td class="log-time-cell">' + time + '</td></tr>';
  }).join('');
}

async function saveSchedules() {
  try {
    await sendToExt({ type: 'SAVE_SCHEDULES', schedules: schedules });
    localStorage.setItem('sns_schedules', JSON.stringify(schedules));
  } catch(e) {
    localStorage.setItem('sns_schedules', JSON.stringify(schedules));
  }
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

function generateId() { return Math.random().toString(36).slice(2, 10); }
function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function showToast(msg, type) {
  type = type || 'success';
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.borderColor = type === 'error' ? 'rgba(255,80,96,0.3)' : 'var(--border2)';
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

// ── 이벤트 연결 ──────────────────────────────────────────
setupTabs();

document.getElementById('runAllBtn').onclick = async function() {
  this.textContent = '⏳ 실행 중...'; this.disabled = true;
  for (let i = 0; i < schedules.length; i++) {
    if (schedules[i].enabled) await runScheduleNow(schedules[i].id);
  }
  this.textContent = '▶ 전체 자동캡처 실행'; this.disabled = false;
};

document.getElementById('addScheduleBtn').onclick = function() { openModal(); };
document.getElementById('addTimeBtn').onclick = function() {
  const t = document.getElementById('mTimeInput').value;
  if (!t) return;
  if (modalTimes.indexOf(t) === -1) { modalTimes.push(t); renderModalTimes(); }
  document.getElementById('mTimeInput').value = '';
};
document.getElementById('mTimeInput').onkeypress = function(e) {
  if (e.key === 'Enter') document.getElementById('addTimeBtn').click();
};
document.getElementById('addUrlRowBtn').onclick = function() {
  modalUrls.push({ id: generateId(), url: '', label: '' });
  renderModalUrls();
};
document.getElementById('modalSaveBtn').onclick = function() { saveModal(); };
document.getElementById('modalCancelBtn').onclick = function() { closeModal(); };
document.getElementById('scheduleModal').onclick = function(e) { if (e.target === this) closeModal(); };

document.getElementById('addGroupBtn').onclick = function() { openGroupModal(); };
document.getElementById('groupModalSaveBtn').onclick = function() { saveGroupModal(); };
document.getElementById('groupModalCancelBtn').onclick = function() { closeGroupModal(); };
document.getElementById('groupModal').onclick = function(e) { if (e.target === this) closeGroupModal(); };

document.getElementById('connectDriveBtn').onclick = function() { connectDrive(); };
document.getElementById('disconnectDriveBtn').onclick = function() { disconnectDrive(); };
document.getElementById('refreshLogsBtn').onclick = function() { loadData(); };

init();
