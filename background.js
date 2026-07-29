const TASKS_KEY = 'sheetTimerTasks';

function getSheetKey(url) {
  try {
    const parsedUrl = new URL(url);
    const match = parsedUrl.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
    if (match) {
      const gid = parsedUrl.searchParams.get('gid') || '0';
      return 'sheet:' + match[1] + ':' + gid;
    }

    return 'url:' + parsedUrl.origin + parsedUrl.pathname;
  } catch {
    return 'url:' + (url || 'unknown');
  }
}

function cleanTaskTitle(title) {
  return String(title || '')
    .replace(/\s+-\s+(Google Sheets|Google Drive|Google \u8A66\u7B97\u8868|Google \u8868\u683C)$/i, '')
    .trim();
}

function normalizeTaskTitle(title) {
  return cleanTaskTitle(title || 'untitled')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN');
}

function getTaskKey(tab, title) {
  // A task represents a named piece of work, not a browser tab. This lets a
  // user return to the same named sheet later and append another time segment.
  return 'title:' + encodeURIComponent(normalizeTaskTitle(title || tab?.title));
}

const emptyTask = (taskKey, title, url, tabId) => ({
  taskKey,
  tabId,
  title: cleanTaskTitle(title) || '未命名表格',
  url: url || '',
  status: 'idle',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  currentStart: null,
  intervals: [],
  totalMs: 0
});

async function readTasks() {
  const result = await chrome.storage.local.get(TASKS_KEY);
  return result[TASKS_KEY] || {};
}

async function writeTasks(tasks) {
  await chrome.storage.local.set({ [TASKS_KEY]: tasks });
}

async function upsertTask(tab, title) {
  const tasks = await readTasks();
  const key = getTaskKey(tab, title);
  let current = tasks[key];

  // Migrate a legacy tab-specific record when this name is used again.
  if (!current) {
    const candidate = Object.entries(tasks).find(([candidateKey, record]) => {
      return candidateKey !== key && normalizeTaskTitle(record?.title) === normalizeTaskTitle(title);
    });
    if (candidate) {
      const [candidateKey, record] = candidate;
      current = { ...record, taskKey: key, tabId: tab.id };
      tasks[key] = current;
      delete tasks[candidateKey];
    }
  }

  if (!current) {
    tasks[key] = emptyTask(key, title, tab.url, tab.id);
  } else {
    tasks[key] = current;
    current.taskKey = key;
    current.title = cleanTaskTitle(title) || current.title;
    current.url = tab.url || current.url;
    current.tabId = tab.id;
    current.updatedAt = Date.now();
  }

  await writeTasks(tasks);
  return tasks[key];
}

function finalizeCurrentInterval(task, now) {
  if (!task.currentStart) return;

  const end = Math.max(now, task.currentStart);
  if (end > task.currentStart) {
    task.intervals.push({ start: task.currentStart, end });
    task.totalMs += end - task.currentStart;
  }
  task.currentStart = null;
}

function recalculateTaskTotal(task) {
  task.totalMs = task.intervals.reduce((total, interval) => total + Math.max(0, interval.end - interval.start), 0);
}

async function updateTask(taskKey, action) {
  const tasks = await readTasks();
  const task = tasks[taskKey];
  if (!task) return null;

  const now = Date.now();
  if (action === 'start' && task.status !== 'running') {
    task.status = 'running';
    task.currentStart = now;
  }

  if (action === 'pause' && task.status === 'running') {
    finalizeCurrentInterval(task, now);
    task.status = 'paused';
  }

  if (action === 'resume' && (task.status === 'paused' || task.status === 'stopped')) {
    task.status = 'running';
    task.currentStart = now;
  }

  if (action === 'stop' && (task.status === 'running' || task.status === 'paused')) {
    finalizeCurrentInterval(task, now);
    task.status = 'stopped';
  }

  task.title = cleanTaskTitle(task.title) || task.title;
  task.updatedAt = now;
  await writeTasks(tasks);
  notifyTaskUpdated();
  return tasks[taskKey];
}

function notifyTaskUpdated() {
  chrome.runtime.sendMessage({ type: 'timer-task-updated' }).catch(() => {});
}

function actionCanCreateTask(action) {
  return action === 'start';
}

async function getTaskOrDraft(tab, title) {
  const taskKey = getTaskKey(tab, title);
  const tasks = await readTasks();
  if (tasks[taskKey]) return tasks[taskKey];

  const legacy = Object.entries(tasks).find(([, task]) => {
    return normalizeTaskTitle(task?.title) === normalizeTaskTitle(title);
  });
  if (legacy) {
    const [legacyKey, task] = legacy;
    return { ...task, title: cleanTaskTitle(task.title) || task.title, taskKey: task.taskKey || legacyKey };
  }
  return emptyTask(taskKey, title, tab.url, tab.id);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'get-task') {
      const taskKey = message.taskKey || (sender.tab ? getTaskKey(sender.tab) : null);
      const tasks = await readTasks();
      sendResponse({ task: taskKey == null ? null : tasks[taskKey] || null });
      return;
    }

    if (message.type === 'list-tasks') {
      const tasks = await readTasks();
      const sortedTasks = Object.entries(tasks)
        .map(([taskKey, task]) => ({ ...task, title: cleanTaskTitle(task.title) || task.title, taskKey: task.taskKey || taskKey }))
        .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
      sendResponse({ tasks: sortedTasks });
      return;
    }

    if (message.type === 'delete-task') {
      const tasks = await readTasks();
      const selectedTask = tasks[message.taskKey];
      const titleKey = normalizeTaskTitle(message.title || selectedTask?.title);
      const keysToDelete = Object.entries(tasks)
        .filter(([taskKey, task]) => taskKey === message.taskKey || normalizeTaskTitle(task?.title) === titleKey)
        .map(([taskKey]) => taskKey);

      for (const taskKey of keysToDelete) delete tasks[taskKey];
      if (keysToDelete.length) {
        await writeTasks(tasks);
        notifyTaskUpdated();
      }
      sendResponse({ deleted: keysToDelete.length > 0, deletedCount: keysToDelete.length });
      return;
    }

    if (message.type === 'delete-interval') {
      const tasks = await readTasks();
      const task = tasks[message.taskKey];
      const index = Number(message.intervalIndex);
      if (!task || !Number.isInteger(index) || index < 0 || index >= task.intervals.length) {
        sendResponse({ task: null });
        return;
      }
      task.intervals.splice(index, 1);
      recalculateTaskTotal(task);
      task.updatedAt = Date.now();
      await writeTasks(tasks);
      notifyTaskUpdated();
      sendResponse({ task });
      return;
    }

    if (message.type === 'update-interval') {
      const tasks = await readTasks();
      const task = tasks[message.taskKey];
      const index = Number(message.intervalIndex);
      const start = Number(message.start);
      const end = Number(message.end);
      if (!task || !Number.isInteger(index) || index < 0 || index >= task.intervals.length ||
          !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        sendResponse({ task: null });
        return;
      }
      task.intervals[index] = { start, end };
      recalculateTaskTotal(task);
      task.updatedAt = Date.now();
      await writeTasks(tasks);
      notifyTaskUpdated();
      sendResponse({ task });
      return;
    }

    if (message.type === 'sync-tab') {
      const tab = message.tab || sender.tab;
      if (!tab || tab.id == null) {
        sendResponse({ task: null });
        return;
      }
      // Viewing the current sheet must not recreate a record the user cleared.
      const task = await getTaskOrDraft(tab, message.title || tab.title);
      sendResponse({ task });
      return;
    }

    if (message.type === 'timer-action') {
      const tab = message.tab || sender.tab;
      const title = message.title || tab?.title;
      const taskKey = message.taskKey || (tab ? getTaskKey(tab, title) : null);
      let task = taskKey ? await updateTask(taskKey, message.action) : null;
      if (!task && actionCanCreateTask(message.action) && tab) {
        task = await upsertTask(tab, title);
        task = await updateTask(task.taskKey, message.action);
      }
      sendResponse({ task });
    }
  })().catch((error) => sendResponse({ error: error.message }));

  return true;
});

function notifyPopup() {
  chrome.runtime.sendMessage({ type: 'active-tab-changed' }).catch(() => {});
}

chrome.tabs.onActivated.addListener(notifyPopup);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    // Do not create empty records merely by opening or refreshing a sheet.
    notifyPopup();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tasks = await readTasks();
  const now = Date.now();
  let changed = false;

  for (const task of Object.values(tasks)) {
    if (task.tabId !== tabId || task.status !== 'running') continue;
    finalizeCurrentInterval(task, now);
    task.status = 'stopped';
    task.updatedAt = now;
    changed = true;
  }

  if (changed) await writeTasks(tasks);
});
