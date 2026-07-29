const state = {
  tab: null,
  task: null,
  tick: null,
  tasks: [],
  historyDate: ''
};

let syncVersion = 0;

const $ = (selector) => document.querySelector(selector);

function isSheetTab(tab) {
  return Boolean(tab?.url && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(tab.url));
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatClock(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp);
}

function getTaskTotalMs(task, intervals = null) {
  if (!task) return 0;
  if (intervals) {
    return intervals.reduce((total, interval) => total + Math.max(0, interval.end - interval.start), 0);
  }
  const current = task.status === 'running' && task.currentStart
    ? Date.now() - task.currentStart
    : 0;
  return (task.totalMs || 0) + current;
}

function getTaskIntervals(task) {
  if (!task) return [];
  const intervals = (task.intervals || []).map((interval, sourceIndex) => ({ ...interval, sourceIndex }));
  if (task.status === 'running' && task.currentStart) {
    intervals.push({ start: task.currentStart, end: Date.now(), live: true, sourceIndex: null });
  }
  return intervals;
}

function getDateKey(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-');
}

function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  }).format(new Date(year, month - 1, day));
}

function getVisibleTaskEntries() {
  const selectedDate = state.historyDate;
  return (state.tasks || []).map((task) => {
    const intervals = getTaskIntervals(task).filter((interval) => {
      return !selectedDate || getDateKey(interval.start) === selectedDate;
    });
    return { task, intervals };
  }).filter(({ intervals }) => !selectedDate || intervals.length > 0);
}

function updateHistoryDateOptions() {
  const select = $('#historyDate');
  if (!select) return;
  const dates = new Set();
  (state.tasks || []).forEach((task) => {
    getTaskIntervals(task).forEach((interval) => dates.add(getDateKey(interval.start)));
  });
  const sortedDates = [...dates].filter(Boolean).sort().reverse();
  if (state.historyDate && !sortedDates.includes(state.historyDate)) state.historyDate = '';
  select.innerHTML = '<option value="">\u5168\u90e8\u65e5\u671f</option>' + sortedDates
    .map((dateKey) => '<option value="' + escapeHtml(dateKey) + '">' + escapeHtml(formatDateLabel(dateKey)) + '</option>')
    .join('');
  select.value = state.historyDate;
}

function toDateTimeLocal(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTaskForCopy(task, intervals = getTaskIntervals(task)) {
  const title = task?.title || '\u672a\u547d\u540d\u8868\u683c';
  const lines = [title + ' \uFF5C\u603B\u8BA1 ' + formatDuration(getTaskTotalMs(task, intervals))];
  if (intervals.length) lines.push(...intervals.map(intervalText));
  return lines.join('\n');
}

function getTaskStatusLabel(status) {
  const labels = {
    idle: '\u672a\u5f00\u59cb',
    running: '\u8ba1\u65f6\u4e2d',
    paused: '\u5df2\u6682\u505c',
    stopped: '\u5df2\u505c\u6b62'
  };
  return labels[status] || labels.idle;
}

function renderTaskList() {
  const list = $('#taskList');
  if (!list) return;

  updateHistoryDateOptions();
  const openKeys = new Set([...list.querySelectorAll('details[open]')].map((item) => item.dataset.taskKey));
  const entries = getVisibleTaskEntries();
  $('#taskCount').textContent = entries.length + ' \u4e2a\u4efb\u52a1';
  $('#copyAllTasks').disabled = !entries.length;
  $('#exportSchedule').disabled = !entries.length;

  if (!entries.length) {
    list.innerHTML = '<div class="empty-state"><span>\u25f7</span><p>\u8be5\u65e5\u671f\u6682\u65e0\u65f6\u95f4\u8bb0\u5f55\u3002</p></div>';
    return;
  }

  list.innerHTML = entries.map(({ task, intervals }) => {
    const taskKey = escapeHtml(task.taskKey);
    const title = escapeHtml(task.title || '\u672a\u547d\u540d\u8868\u683c');
    const total = formatDuration(getTaskTotalMs(task, intervals));
    const status = task.status || 'idle';
    const details = intervals.length
      ? intervals.map((interval) => {
          if (interval.live) {
            return '<div class="task-interval"><div class="task-interval-row"><div class="task-interval-main">' +
              escapeHtml(formatClock(interval.start) + ' \u2014 ' + formatClock(interval.end)) +
              '<span class="task-interval-duration">\u8fdb\u884c\u4e2d</span></div></div></div>';
          }
          const index = interval.sourceIndex;
          return '<div class="task-interval" data-interval-index="' + index + '">' +
            '<div class="task-interval-row"><div class="task-interval-main">' +
            escapeHtml(formatClock(interval.start) + ' \u2014 ' + formatClock(interval.end)) +
            '<span class="task-interval-duration">' + escapeHtml(formatDuration(Math.max(0, interval.end - interval.start))) + '</span></div>' +
            '<div class="task-interval-actions"><button type="button" class="interval-action" data-edit-interval>\u7f16\u8f91</button><button type="button" class="interval-action interval-delete" data-delete-interval>\u6e05\u9664</button></div></div>' +
            '<form class="interval-editor hidden" data-edit-form="' + index + '">' +
            '<label>\u5f00\u59cb <input name="start" type="datetime-local" step="1" value="' + escapeHtml(toDateTimeLocal(interval.start)) + '" required></label>' +
            '<label>\u7ed3\u675f <input name="end" type="datetime-local" step="1" value="' + escapeHtml(toDateTimeLocal(interval.end)) + '" required></label>' +
            '<div class="interval-editor-actions"><button type="submit" class="interval-action interval-save">\u4fdd\u5b58</button><button type="button" class="interval-action" data-cancel-edit>\u53d6\u6d88</button></div>' +
            '</form></div>';
        }).join('')
      : '<div class="task-empty">\u6682\u65e0\u65f6\u95f4\u6bb5</div>';
    const isOpen = openKeys.has(task.taskKey) ? ' open' : '';
    return '<details class="task-card" data-task-key="' + taskKey + '"' + isOpen + '>' +
      '<summary class="task-summary"><span class="task-title">' + title + '</span>' +
      '<span class="task-total">' + total + '</span>' +
      '<button class="task-action" type="button" data-copy-task>\u590d\u5236</button>' +
      '<button class="task-action task-delete" type="button" data-delete-task>\u6e05\u9664</button></summary>' +
      '<div class="task-details">' + details + '</div></details>';
  }).join('');
}

function getTotalMs() {
  return getTaskTotalMs(state.task);
}

function setVisible(element, visible) {
  element.classList.toggle('hidden', !visible);
}

function render() {
  const task = state.task;
  const title = task?.title || state.tab?.title || '\u672A\u547D\u540D\u8868\u683C';
  const status = task?.status || 'idle';
  const total = getTotalMs();

  $('#sheetTitle').textContent = title;
  renderClock();

  const labels = { idle: '\u672A\u5F00\u59CB', running: '\u8BA1\u65F6\u4E2D', paused: '\u5DF2\u6682\u505C', stopped: '\u5DF2\u505C\u6B62' };
  const badge = $('#statusBadge');
  badge.textContent = labels[status];
  badge.className = `status-badge status-${status}`;

  const isActive = status === 'running' || status === 'paused';
  $('#liveHint').textContent = status === 'running'
    ? '\u6b63\u5728\u8bb0\u5f55\u5f53\u524d\u5de5\u4f5c\u533a\u95f4'
    : status === 'paused' ? '\u5df2\u4fdd\u5b58\u5f53\u524d\u533a\u95f4\uff0c\u53ef\u4ee5\u7ee7\u7eed' : status === 'stopped' ? '\u5df2\u4fdd\u5b58\u8bb0\u5f55\uff0c\u53ef\u4ee5\u7ee7\u7eed' : '\u51c6\u5907\u597d\u540e\u5f00\u59cb\u8bb0\u5f55';

  setVisible($('#startButton'), status !== 'paused' && status !== 'running');
  setVisible($('#resumeButton'), status === 'paused');
  $('#startButton').textContent = status === 'stopped' ? '\u21bb \u7ee7\u7eed\u8ba1\u65f6' : '\u25b6 \u5f00\u59cb';
  $('#pauseButton').disabled = status !== 'running';
  $('#stopButton').disabled = !isActive;
  $('#copySummary').disabled = !task || total === 0;

  renderTaskList();
}

function renderClock() {
  const total = getTotalMs();
  $('#totalTime').textContent = formatDuration(total);
  $('#progressBar').style.width = `${Math.min(100, total / 3600000 * 100)}%`;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('visible'), 1800);
}

async function copyText(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const fallback = document.createElement('textarea');
    fallback.value = value;
    fallback.setAttribute('readonly', '');
    fallback.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    if (!copied) {
      showToast('\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u5141\u8BB8\u526A\u8D34\u677F\u6743\u9650\u540E\u91CD\u8BD5');
      return false;
    }
  }
  showToast('\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F');
  return true;
}

function intervalText(interval) {
  return formatClock(interval.start) + ' \u2014 ' + formatClock(interval.end);
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function cleanSheetTitle(title) {
  return String(title || '')
    .replace(/\s+-\s+(Google Sheets|Google Drive|Google \u8A66\u7B97\u8868|Google \u8868\u683C)$/i, '')
    .trim();
}

async function getSheetTitle(tab) {
  if (!isSheetTab(tab)) return cleanSheetTitle(tab?.title) || '\u5F53\u524D\u6807\u7B7E\u9875';
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'get-sheet-title' });
    return cleanSheetTitle(response?.title || tab.title) || '\u672A\u547D\u540D\u8868\u683C';
  } catch {
    return cleanSheetTitle(tab?.title) || '\u672A\u547D\u540D\u8868\u683C';
  }
}

async function loadTasks() {
  const response = await chrome.runtime.sendMessage({ type: 'list-tasks' });
  state.tasks = response?.tasks || [];
}

async function sync() {
  const requestVersion = ++syncVersion;
  const tab = await getCurrentTab();
  if (requestVersion !== syncVersion) return;

  state.tab = tab;
  const supported = isSheetTab(tab);
  setVisible($('#unsupported'), !supported);
  setVisible($('#workspace'), true);

  if (!supported) {
    state.task = null;
    await loadTasks();
    if (requestVersion !== syncVersion) return;
    render();
    return;
  }

  const title = await getSheetTitle(tab);
  if (requestVersion !== syncVersion) return;

  const response = await chrome.runtime.sendMessage({
    type: 'sync-tab',
    tab: { id: tab.id, title: tab.title, url: tab.url },
    title
  });
  if (requestVersion !== syncVersion) return;

  state.task = response.task;
  await loadTasks();
  if (requestVersion !== syncVersion) return;
  render();
}

function refresh() {
  sync().catch(() => {});
}

chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (state.tab?.id === tabId && (changeInfo.url || changeInfo.status === 'complete')) refresh();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'active-tab-changed' || message.type === 'timer-task-updated') refresh();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

async function timerAction(action) {
  if (!state.task?.taskKey) return;
  const response = await chrome.runtime.sendMessage({
    type: 'timer-action', taskKey: state.task.taskKey, action,
    tab: state.tab ? { id: state.tab.id, title: state.tab.title, url: state.tab.url } : null,
    title: state.task.title
  });
  if (response.task) {
    state.task = response.task;
    await loadTasks();
    render();
  }
}

$('#startButton').addEventListener('click', () => timerAction('start'));
$('#pauseButton').addEventListener('click', () => timerAction('pause'));
$('#resumeButton').addEventListener('click', () => timerAction('resume'));
$('#stopButton').addEventListener('click', () => timerAction('stop'));

$('#copySummary').addEventListener('click', () => {
  if (!state.task) return;
  copyText(state.task.title + ' \uFF5C\u603B\u8BA1 ' + formatDuration(getTotalMs()));
});



async function refreshAfterMutation(task) {
  if (task && state.task?.taskKey === task.taskKey) state.task = task;
  await loadTasks();
  render();
}

$('#historyDate').addEventListener('change', (event) => {
  state.historyDate = event.target.value;
  renderTaskList();
});

$('#taskList').addEventListener('click', async (event) => {
  const taskCard = event.target.closest('.task-card');
  if (!taskCard) return;
  const taskKey = taskCard.dataset.taskKey;
  const copyButton = event.target.closest('[data-copy-task]');
  const deleteTaskButton = event.target.closest('[data-delete-task]');
  const editButton = event.target.closest('[data-edit-interval]');
  const deleteIntervalButton = event.target.closest('[data-delete-interval]');
  const cancelButton = event.target.closest('[data-cancel-edit]');

  if (event.target.closest('.task-summary button')) event.preventDefault();

  if (copyButton) {
    const entry = getVisibleTaskEntries().find(({ task }) => task.taskKey === taskKey);
    if (entry) copyText(formatTaskForCopy(entry.task, entry.intervals));
    return;
  }

  if (deleteTaskButton) {
    const entry = (state.tasks || []).find((task) => task.taskKey === taskKey);
    const response = await chrome.runtime.sendMessage({ type: 'delete-task', taskKey, title: entry?.title });
    if (!response?.deleted) {
      showToast('\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F');
      return;
    }
    await sync();
    showToast('\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F');
    return;
  }

  if (deleteIntervalButton) {
    const row = deleteIntervalButton.closest('.task-interval');
    if (!window.confirm('\u786e\u5b9a\u8981\u6e05\u9664\u8fd9\u4e2a\u65f6\u95f4\u6bb5\u5417\uff1f')) return;
    const response = await chrome.runtime.sendMessage({
      type: 'delete-interval', taskKey, intervalIndex: row.dataset.intervalIndex
    });
    if (response.task) await refreshAfterMutation(response.task);
    else showToast('\u6e05\u9664\u65f6\u95f4\u6bb5\u5931\u8d25\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5');
    return;
  }

  if (editButton) {
    const row = editButton.closest('.task-interval');
    row.querySelector('.interval-editor')?.classList.remove('hidden');
    return;
  }

  if (cancelButton) {
    cancelButton.closest('.interval-editor')?.classList.add('hidden');
  }
});

$('#taskList').addEventListener('submit', async (event) => {
  const form = event.target.closest('.interval-editor');
  if (!form) return;
  event.preventDefault();
  const taskCard = form.closest('.task-card');
  const start = new Date(form.elements.start.value).getTime();
  const end = new Date(form.elements.end.value).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    showToast('\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F');
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: 'update-interval',
    taskKey: taskCard.dataset.taskKey,
    intervalIndex: form.dataset.editForm,
    start,
    end
  });
  if (response.task) await refreshAfterMutation(response.task);
});

function allTasksText() {
  return getVisibleTaskEntries()
    .map(({ task, intervals }) => formatTaskForCopy(task, intervals))
    .join('\n\n');
}

$('#copyAllTasks').addEventListener('click', () => {
  if (getVisibleTaskEntries().length) copyText(allTasksText());
});

$('#exportSchedule').addEventListener('click', () => {
  if (!getVisibleTaskEntries().length) return;
  const blob = new Blob([allTasksText()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'work-schedule-' + new Date().toISOString().slice(0, 10) + '.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast('\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F');
});

state.tick = setInterval(() => {
  if (state.task?.status === 'running') renderClock();
}, 1000);

sync();
