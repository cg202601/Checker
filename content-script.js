(() => {
  const HOST_ID = 'sheet-focus-timer-float';
  const POSITION_KEY = 'sheetFocusTimerFloatingPosition';
  if (document.getElementById(HOST_ID)) return;

  function cleanSheetTitle(title) {
    return String(title || '')
      .replace(/\s+-\s+(Google Sheets|Google Drive|Google \u8A66\u7B97\u8868|Google \u8868\u683C)$/i, '')
      .trim();
  }

  function getSheetTitle() {
    const titleElement = document.querySelector('.docs-title-input, [aria-label="Rename"], [data-tooltip="Rename"]');
    const domTitle = titleElement?.value || titleElement?.getAttribute('aria-label') || titleElement?.textContent;
    if (domTitle && !/^(rename|\u91CD\u547D\u540D)$/i.test(domTitle.trim())) return cleanSheetTitle(domTitle);
    const pageTitle = cleanSheetTitle(document.title);
    return pageTitle && !/^Google Sheets?$/i.test(pageTitle) ? pageTitle : '\u672A\u547D\u540D\u8868\u683C';
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
      .map((part) => String(part).padStart(2, '0')).join(':');
  }

  function getTaskTotal(task) {
    if (!task) return 0;
    return (task.totalMs || 0) + (task.status === 'running' && task.currentStart ? Date.now() - task.currentStart : 0);
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483647; display: block; }
      *, *::before, *::after { box-sizing: border-box; }
      .full-shell { width: 410px; overflow: hidden; border: 1px solid rgba(182, 243, 109, .32); border-radius: 13px; background: #11151c; box-shadow: 0 16px 48px rgba(0, 0, 0, .34); }
      .drag-bar { display: flex; height: 27px; align-items: center; justify-content: space-between; padding: 0 8px 0 11px; border-bottom: 1px solid rgba(255,255,255,.09); background: #151b24; color: #8e99a4; cursor: grab; font: 600 10px/1 Inter, "Segoe UI", sans-serif; letter-spacing: .04em; user-select: none; }
      .drag-bar:active, .compact-drag:active { cursor: grabbing; }
      .collapse { border: 0; border-radius: 6px; padding: 4px 7px; background: transparent; color: #b6f36d; cursor: pointer; font: 600 10px/1 Inter, "Segoe UI", sans-serif; }
      .collapse:hover { background: rgba(182, 243, 109, .12); }
      iframe { display: block; width: 408px; height: 570px; border: 0; }
      .compact-shell { display: none; align-items: center; gap: 8px; min-width: 280px; padding: 8px 9px 8px 11px; border: 1px solid rgba(182, 243, 109, .35); border-radius: 13px; background: rgba(25, 31, 41, .98); box-shadow: 0 10px 32px rgba(0, 0, 0, .28); color: #f4f7f4; font-family: Inter, "Segoe UI", sans-serif; }
      :host(.compact) .full-shell { display: none; }
      :host(.compact) .compact-shell { display: flex; }
      .compact-drag { min-width: 0; flex: 1; cursor: grab; user-select: none; }
      .compact-title { overflow: hidden; color: #cfd8d0; font-size: 10px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
      .compact-time { margin-top: 2px; color: #b6f36d; font-family: "SF Mono", Consolas, monospace; font-size: 17px; font-weight: 700; letter-spacing: -.04em; }
      .actions { display: flex; align-items: center; gap: 5px; }
      .action { border: 0; border-radius: 8px; padding: 6px 8px; background: #27303c; color: #f4f7f4; cursor: pointer; font: 600 11px/1 Inter, "Segoe UI", sans-serif; }
      .action:hover:not(:disabled) { background: #354151; }
      .action.primary { background: #b6f36d; color: #172014; }
      .action.danger { color: #ff9d95; }
      .action.hidden { display: none; }
      .expand { border: 0; border-radius: 7px; padding: 6px 7px; background: transparent; color: #b6f36d; cursor: pointer; font: 600 10px/1 Inter, "Segoe UI", sans-serif; }
      .expand:hover { background: rgba(182, 243, 109, .12); }
    </style>
    <section class="full-shell">
      <div class="drag-bar" title="\u6309\u4F4F\u8FD9\u91CC\u62D6\u52A8\u6574\u4E2A\u8BA1\u65F6\u5668"><span>\u2630 &nbsp;\u62D6\u52A8\u8BA1\u65F6\u5668</span><button class="collapse">\u6536\u8D77</button></div>
      <iframe class="app-frame" title="\u8868\u683C\u4E13\u6CE8\u8BA1\u65F6\u5668"></iframe>
    </section>
    <section class="compact-shell" aria-label="\u7CBE\u7B80\u8BA1\u65F6\u5668">
      <div class="compact-drag" title="\u6309\u4F4F\u62D6\u52A8"><div class="compact-title"></div><div class="compact-time">00:00:00</div></div>
      <div class="actions">
        <button class="action primary start">\u5F00\u59CB</button><button class="action primary resume hidden">\u7EE7\u7EED</button><button class="action pause hidden">\u6682\u505C</button><button class="action danger stop hidden">\u505C\u6B62</button><button class="expand">\u5C55\u5F00</button>
      </div>
    </section>`;
  document.documentElement.appendChild(host);

  const refs = {
    frame: shadow.querySelector('.app-frame'),
    dragBar: shadow.querySelector('.drag-bar'),
    compactDrag: shadow.querySelector('.compact-drag'),
    collapse: shadow.querySelector('.collapse'),
    expand: shadow.querySelector('.expand'),
    title: shadow.querySelector('.compact-title'),
    time: shadow.querySelector('.compact-time'),
    start: shadow.querySelector('.start'),
    resume: shadow.querySelector('.resume'),
    pause: shadow.querySelector('.pause'),
    stop: shadow.querySelector('.stop')
  };
  refs.frame.src = chrome.runtime.getURL('popup.html');

  let task = null;
  let compact = false;
  let dragging = null;

  function setVisible(element, visible) {
    element.classList.toggle('hidden', !visible);
  }

  function renderCompact() {
    const status = task?.status || 'idle';
    refs.title.textContent = task?.title || getSheetTitle();
    refs.time.textContent = formatDuration(getTaskTotal(task));
    setVisible(refs.start, status === 'idle');
    setVisible(refs.resume, status === 'paused' || status === 'stopped');
    setVisible(refs.pause, status === 'running');
    setVisible(refs.stop, status === 'running' || status === 'paused');
    host.classList.toggle('compact', compact);
  }

  function clampPosition(left, top) {
    const rect = host.getBoundingClientRect();
    return {
      left: Math.max(8, Math.min(left, Math.max(8, window.innerWidth - rect.width - 8))),
      top: Math.max(8, Math.min(top, Math.max(8, window.innerHeight - rect.height - 8)))
    };
  }

  async function savePosition(left, top) {
    await chrome.storage.local.set({ [POSITION_KEY]: { left, top } });
  }

  function setPosition(left, top, persist = true) {
    const position = clampPosition(left, top);
    host.style.left = position.left + 'px';
    host.style.top = position.top + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    if (persist) savePosition(position.left, position.top).catch(() => {});
  }

  function startDrag(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    dragging = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    setPosition(rect.left, rect.top, false);
    event.preventDefault();
  }

  document.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setPosition(event.clientX - dragging.offsetX, event.clientY - dragging.offsetY, false);
  });
  document.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = null;
    const rect = host.getBoundingClientRect();
    savePosition(rect.left, rect.top).catch(() => {});
  });

  async function restorePosition() {
    const saved = await chrome.storage.local.get(POSITION_KEY);
    const position = saved[POSITION_KEY];
    if (Number.isFinite(position?.left) && Number.isFinite(position?.top)) setPosition(position.left, position.top, false);
  }

  async function sync() {
    const response = await chrome.runtime.sendMessage({ type: 'sync-tab', title: getSheetTitle() });
    if (response?.task) task = response.task;
    renderCompact();
  }

  async function timerAction(action) {
    if (!task) await sync();
    const response = await chrome.runtime.sendMessage({ type: 'timer-action', taskKey: task?.taskKey, action, title: getSheetTitle() });
    if (response?.task) task = response.task;
    renderCompact();
  }

  refs.dragBar.addEventListener('pointerdown', startDrag);
  refs.compactDrag.addEventListener('pointerdown', startDrag);
  refs.collapse.addEventListener('click', () => { compact = true; renderCompact(); });
  refs.expand.addEventListener('click', () => { compact = false; renderCompact(); });
  refs.start.addEventListener('click', () => timerAction('start'));
  refs.resume.addEventListener('click', () => timerAction('resume'));
  refs.pause.addEventListener('click', () => timerAction('pause'));
  refs.stop.addEventListener('click', () => timerAction('stop'));

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'timer-task-updated') sync().catch(() => {});
  });
  setInterval(() => { if (task?.status === 'running') renderCompact(); }, 1000);

  restorePosition().finally(() => sync().catch(() => {}));
})();