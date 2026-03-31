const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzb2CDFE3zQqBvvsOttfsQKhpyNbjlcIVhs9EUxNaPap0Qxe91HmRsIySaAJZQFZkk/exec';
const ALARM_PREFIX = 'sns_monitor_';

chrome.runtime.onInstalled.addListener(() => { initSchedules(); });
chrome.runtime.onStartup.addListener(() => { initSchedules(); });

async function initSchedules() {
  const { schedules = [] } = await chrome.storage.local.get('schedules');
  const alarms = await chrome.alarms.getAll();
  for (const alarm of alarms) {
    if (alarm.name.startsWith(ALARM_PREFIX)) await chrome.alarms.clear(alarm.name);
  }
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    const times = (schedule.times || [schedule.time]).filter(Boolean);
    times.forEach(time => {
      const [hour, minute] = time.split(':').map(Number);
      const next = new Date();
      next.setHours(hour, minute, 0, 0);
      if (next <= new Date()) next.setDate(next.getDate() + 1);
      chrome.alarms.create(`${ALARM_PREFIX}${schedule.id}_${time.replace(':', '-')}`, {
        when: next.getTime(), periodInMinutes: 24 * 60
      });
    });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const scheduleId = alarm.name.replace(ALARM_PREFIX, '').split('_')[0];
  const { schedules = [] } = await chrome.storage.local.get('schedules');
  const schedule = schedules.find(s => s.id === scheduleId);
  if (!schedule || !schedule.enabled) return;
  for (const urlItem of schedule.urls) {
    try { await captureUrl(urlItem, schedule); await sleep(3000); }
    catch (err) { await logCapture(schedule.id, urlItem.url, 'failed', err.message); }
  }
});

async function captureUrl(urlItem, schedule) {
  return new Promise((resolve, reject) => {
    chrome.windows.create({ url: urlItem.url, focused: true, state: 'maximized' }, async (win) => {
      const tab = win.tabs[0];
      const tabId = tab.id;
      const winId = win.id;
      const onUpdated = async (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        try {
          await sleep(urlItem.extraWait || 3000);
          await chrome.tabs.update(tabId, { active: true });
          await sleep(500);
          const dataUrl = await captureFullPage(tabId, winId);
          const croppedDataUrl = urlItem.cropRegion ? await cropImage(dataUrl, urlItem.cropRegion) : dataUrl;
          const timestamp = formatTimestamp(new Date());
          const safeName = urlItem.label || getDomainLabel(urlItem.url);
          const filename = `${schedule.name}_${safeName}_${timestamp}.jpg`;
          await uploadToAppsScript(croppedDataUrl, filename);
          if (schedule.localDownload) {
            await chrome.downloads.download({ url: croppedDataUrl, filename: `SNS_Monitor/${filename}`, saveAs: false });
          }
          await logCapture(schedule.id, urlItem.url, 'success', filename);
          chrome.windows.remove(winId);
          resolve();
        } catch (err) {
          chrome.windows.remove(winId).catch(() => {});
          reject(err);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.windows.remove(winId).catch(() => {});
        reject(new Error('캡처 타임아웃 (60초)'));
      }, 60000);
    });
  });
}

async function captureFullPage(tabId, winId) {
  const [{ result: pageInfo }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      totalHeight: document.documentElement.scrollHeight,
      viewHeight: window.innerHeight,
      viewWidth: window.innerWidth
    })
  });

  const { totalHeight, viewHeight, viewWidth } = pageInfo;

  // 맨 위로 스크롤
  await chrome.scripting.executeScript({ target: { tabId }, func: () => window.scrollTo(0, 0) });
  await sleep(500);

  // 첫 번째 캡처 (헤더 포함)
  const firstShot = await chrome.tabs.captureVisibleTab(winId, { format: 'jpeg', quality: 70 });

  // 고정 헤더 숨기기
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const selectors = ['#header', '#spt_hd', '.spt_hd', '#wrap_hd', '#NM_FAVORITE', '.header_wrap', '#header_wrap', '#nx-header', '.nx-header', 'header', '#gnb', '.gnb', '#lnb', '.search_wrap'];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          el.style.setProperty('display', 'none', 'important');
        });
      });
      document.querySelectorAll('*').forEach(el => {
        const pos = window.getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') {
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('opacity', '0', 'important');
        }
      });
    }
  });
  await sleep(300);

  const shots = [{ dataUrl: firstShot, y: 0 }];
  let scrollY = viewHeight;

  while (scrollY < totalHeight) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (y) => window.scrollTo(0, y),
      args: [scrollY]
    });
    await sleep(800);
    const shot = await chrome.tabs.captureVisibleTab(winId, { format: 'jpeg', quality: 70 });
    shots.push({ dataUrl: shot, y: scrollY });
    if (scrollY + viewHeight >= totalHeight) break;
    scrollY = Math.min(scrollY + viewHeight, totalHeight - viewHeight);
  }

try {
  if (shots.length < 2) return shots[0].dataUrl;
    const firstBlob = await (await fetch(shots[0].dataUrl)).blob();
    const firstBitmap = await createImageBitmap(firstBlob);
    const imgWidth = firstBitmap.width;
    const scale = imgWidth / viewWidth;
    const canvasHeight = Math.min(Math.round(totalHeight * scale), 32000);
    const canvas = new OffscreenCanvas(imgWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    for (const shot of shots) {
      const blob = await (await fetch(shot.dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, 0, Math.round(shot.y * scale));
    }
    const finalBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(finalBlob);
    });
  } catch(e) {
    return shots[0].dataUrl;
  }
}

async function cropImage(dataUrl, cropRegion) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(cropRegion.width, cropRegion.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height, 0, 0, cropRegion.width, cropRegion.height);
  const croppedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(croppedBlob);
  });
}

async function uploadToAppsScript(dataUrl, filename) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'UPLOAD_IMAGE', imageData: dataUrl, filename })
  });
  const result = await res.json();
  if (!result.ok) throw new Error(result.error || '업로드 실패');
  return result;
}

function handleMessage(msg, sendResponse) {
  (async () => {
    try {
      switch (msg.type) {
        case 'GET_SCHEDULES': {
          const { schedules = [] } = await chrome.storage.local.get('schedules');
          sendResponse({ schedules });
          break;
        }
        case 'SAVE_SCHEDULES': {
          await chrome.storage.local.set({ schedules: msg.schedules });
          sendResponse({ ok: true });
          initSchedules();
          break;
        }
        case 'RUN_NOW': {
          const { schedules = [] } = await chrome.storage.local.get('schedules');
          const schedule = schedules.find(s => s.id === msg.scheduleId);
          if (!schedule) { sendResponse({ error: '스케줄 없음' }); return; }
          sendResponse({ ok: true });
          for (const urlItem of schedule.urls) {
            try { await captureUrl(urlItem, schedule); await sleep(2000); }
            catch (err) { await logCapture(schedule.id, urlItem.url, 'failed', err.message); }
          }
          break;
        }
        case 'SET_CROP_REGION': {
          const { schedules = [] } = await chrome.storage.local.get('schedules');
          const updated = schedules.map(s => ({
            ...s, urls: s.urls.map(u => u.id === msg.urlId ? { ...u, cropRegion: msg.region } : u)
          }));
          await chrome.storage.local.set({ schedules: updated });
          sendResponse({ ok: true });
          break;
        }
        case 'GET_LOGS': {
          const { captureLogs = [] } = await chrome.storage.local.get('captureLogs');
          sendResponse({ logs: captureLogs.slice(-100) });
          break;
        }
        default:
          sendResponse({ error: '알 수 없는 타입' });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => { handleMessage(msg, sendResponse); return true; });
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => { handleMessage(msg, sendResponse); return true; });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatTimestamp(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth()+1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}

function getDomainLabel(url) {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.includes('naver.com')) {
      if (pathname.includes('blog')) return 'NaverBlog';
      if (pathname.includes('cafe')) return 'NaverCafe';
      return 'NaverSearch';
    }
    if (hostname.includes('instagram.com')) return 'Instagram';
    if (hostname.includes('youtube.com')) return 'YouTube';
    return hostname.replace('www.', '');
  } catch { return 'unknown'; }
}

async function logCapture(scheduleId, url, status, detail) {
  const { captureLogs = [] } = await chrome.storage.local.get('captureLogs');
  captureLogs.push({ id: Date.now(), scheduleId, url, status, detail, timestamp: new Date().toISOString() });
  if (captureLogs.length > 500) captureLogs.splice(0, captureLogs.length - 500);
  await chrome.storage.local.set({ captureLogs });
}
