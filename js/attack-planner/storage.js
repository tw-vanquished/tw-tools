// attack-planner — persistence (localStorage + File System Access) + village DB.
// Classic script (3/9): no modules, shared global scope, load order matters — must work
// by double-click (file://). See the <script src> order in attack-planner.html.
'use strict';

// ══════════════════════════════════════════════
// PERSISTENCE — localStorage
// ══════════════════════════════════════════════

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      DATA = { ...DATA, ...parsed };
      // ensure arrays exist
      if (!Array.isArray(DATA.villages)) DATA.villages = [];
      if (!Array.isArray(DATA.targets))  DATA.targets  = [];
      if (!Array.isArray(DATA.attacks))  DATA.attacks  = [];
      if (!DATA.settings) DATA.settings = { worldSpeed: 2, unitSpeed: 0.5, serverUrl: 'es103.guerrastribales.es' };
      if (DATA.settings.lang) { currentLang = DATA.settings.lang; }
    }
  } catch(e) { /* ignore */ }
  if (typeof ensureScavengeState === 'function') ensureScavengeState();
}

function saveData() {
  localStorage.setItem(LS_KEY, JSON.stringify(DATA));
  writeFileIfConnected();
}

// ══════════════════════════════════════════════
// PERSISTENCE — File System Access API
// ══════════════════════════════════════════════

async function openIdb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('tw_attack_planner_idb', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('handles');
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e);
  });
}

async function idbSet(key, val) {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

async function idbGet(key) {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = e => rej(e);
  });
}

async function tryAutoConnect() {
  try {
    const h = await idbGet(IDB_FILE);
    if (!h) return;
    const perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      fileHandle = h;
      setFileStatus(true, h.name);
    } else {
      const req = await h.requestPermission({ mode: 'readwrite' });
      if (req === 'granted') {
        fileHandle = h;
        setFileStatus(true, h.name);
      }
    }
  } catch(e) { /* no handle stored */ }
}

async function tryAutoConnectDb() {
  try {
    const h = await idbGet(IDB_DB);
    if (!h) return;
    const perm = await h.queryPermission({ mode: 'read' });
    if (perm === 'granted') {
      dbDirHandle = h;
      await loadDbFiles();
    }
  } catch(e) { /* no handle stored */ }
}

async function connectFile() {
  try {
    const [h] = await window.showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      multiple: false
    }).catch(() => [null]);
    if (!h) return;
    fileHandle = h;
    await idbSet(IDB_FILE, h);
    setFileStatus(true, h.name);
    // read existing content
    const file = await h.getFile();
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      DATA = { ...DATA, ...parsed };
      if (!Array.isArray(DATA.villages)) DATA.villages = [];
      if (!Array.isArray(DATA.targets))  DATA.targets  = [];
      if (!Array.isArray(DATA.attacks))  DATA.attacks  = [];
      if (typeof ensureScavengeState === 'function') ensureScavengeState();
      applySettings();
      renderAll();
    } catch(e) { /* new file, write current data */ }
    writeFileIfConnected();
  } catch(e) { /* cancelled */ }
}

async function writeFileIfConnected() {
  if (!fileHandle) return;
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(DATA, null, 2));
    await writable.close();
  } catch(e) { /* permission lost */ }
}

function setFileStatus(connected, name) {
  const dot  = document.getElementById('file-dot');
  const text = document.getElementById('file-status-text');
  if (connected) {
    dot.className  = 'file-status-dot dot-ok';
    text.className = 'connected';
    text.textContent = name || t('file_connected');
  } else {
    dot.className  = 'file-status-dot dot-off';
    text.className = '';
    text.textContent = t('file_not_connected');
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tw_attack_planner.json';
  a.click();
}

function importJson() {
  document.getElementById('import-input').click();
}

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      DATA = { ...DATA, ...parsed };
      if (!Array.isArray(DATA.villages)) DATA.villages = [];
      if (!Array.isArray(DATA.targets))  DATA.targets  = [];
      if (!Array.isArray(DATA.attacks))  DATA.attacks  = [];
      applySettings();
      saveData();
      renderAll();
    } catch(err) {
      alert(t('alert_invalid_json'));
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════
// VILLAGE DB
// ══════════════════════════════════════════════

async function connectDbFolder() {
  try {
    const h = await window.showDirectoryPicker({ mode: 'read' });
    dbDirHandle = h;
    await idbSet(IDB_DB, h);
    await loadDbFiles();
  } catch(e) { /* cancelled */ }
}

function applyDbTexts(pText, vText) {
  villageDb = [];
  playerMap = {};

  // player.txt: id,name,...
  if (pText) {
    for (const line of pText.split('\n')) {
      const parts = line.trim().split(',');
      if (parts.length >= 2) {
        playerMap[parts[0].trim()] = decodeURIComponent(parts[1].trim().replace(/\+/g,' '));
      }
    }
  }

  // village.txt: id,name,x,y,playerId,points,...
  if (vText) {
    for (const line of vText.split('\n')) {
      const parts = line.trim().split(',');
      if (parts.length >= 6) {
        villageDb.push({
          id:       parts[0].trim(),
          name:     decodeURIComponent(parts[1].trim().replace(/\+/g,' ')),
          x:        parseInt(parts[2]),
          y:        parseInt(parts[3]),
          playerId: parts[4].trim(),
          points:   parseInt(parts[5]) || 0
        });
      }
    }
  }

  document.getElementById('db-status').textContent =
    `${villageDb.length.toLocaleString()} villages loaded`;
  renderDb('');
}

async function loadDbFiles() {
  if (!dbDirHandle) return;
  try {
    let pText = null, vText = null;
    try {
      const pf = await (await dbDirHandle.getFileHandle('player.txt')).getFile();
      pText = await pf.text();
    } catch(e) { /* file missing */ }
    try {
      const vf = await (await dbDirHandle.getFileHandle('village.txt')).getFile();
      vText = await vf.text();
    } catch(e) { /* file missing */ }
    applyDbTexts(pText, vText);
  } catch(e) {
    document.getElementById('db-status').textContent = t('db_error_loading');
  }
}

// ── Environment: 'production' when served over http(s) (the GitHub Pages site,
//    where a scheduled Action mirrors the world data under data/es103/);
//    'development' when opened from disk (file://) — uses local files instead.
const TW_ENV = (typeof location !== 'undefined' && /^https?:$/.test(location.protocol))
  ? 'production' : 'development';
const TW_DATA_URL = 'data/es103/';

async function loadDbFromWeb() {
  try {
    const [vText, pText, updated] = await Promise.all([
      fetch(TW_DATA_URL + 'village.txt').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
      fetch(TW_DATA_URL + 'player.txt').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
      fetch(TW_DATA_URL + 'last-updated.txt').then(r => r.ok ? r.text() : '').catch(() => ''),
    ]);
    applyDbTexts(pText, vText);
    if (updated.trim()) {
      document.getElementById('db-status').textContent +=
        ' ' + t('db_web_updated').replace('{ts}', updated.trim());
    }
  } catch(e) {
    document.getElementById('db-status').textContent = t('db_web_failed');
  }
}

function scheduleDbSearch() {
  clearTimeout(dbSearchTimer);
  dbSearchTimer = setTimeout(() => {
    renderDb(document.getElementById('db-search').value);
  }, 200);
}

function renderDb(query) {
  const q = query.trim().toLowerCase();
  let results = villageDb;
  if (q) {
    results = villageDb.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.id.includes(q) ||
      (playerMap[v.playerId] || '').toLowerCase().includes(q) ||
      `${v.x}|${v.y}`.includes(q)
    );
  }
  const total   = results.length;
  const capped  = results.slice(0, 200);
  const countEl = document.getElementById('db-count');
  countEl.textContent = total > 200 ? t('db_showing').replace('{total}', total.toLocaleString()) :
                        total > 0   ? `${total.toLocaleString()} results` : t('empty_no_results');

  const tbody = document.getElementById('db-tbody');
  if (capped.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${villageDb.length === 0 ? t('db_no_data') : t('empty_no_results')}</td></tr>`;
    return;
  }
  tbody.innerHTML = capped.map(v => {
    const player = escHtml(playerMap[v.playerId] || '-');
    return `<tr>
      <td class="coords">${escHtml(v.id)}</td>
      <td>${escHtml(v.name)}</td>
      <td class="coords">${v.x}|${v.y}</td>
      <td>${player}</td>
      <td>${v.points.toLocaleString()}</td>
      <td><button class="btn btn-primary btn-sm" onclick="addTargetFromDb('${escAttr(v.id)}')">+ Target</button></td>
    </tr>`;
  }).join('');
}

function addTargetFromDb(dbId) {
  const v = villageDb.find(x => x.id === dbId);
  if (!v) return;
  // check duplicate by villageId
  if (DATA.targets.some(t => String(t.villageId) === String(v.id))) {
    alert(t('alert_already_target'));
    return;
  }
  DATA.targets.push({
    id:        uid(),
    name:      v.name,
    villageId: v.id,
    player:    playerMap[v.playerId] || '',
    x:         v.x,
    y:         v.y
  });
  saveData();
  renderTargets();
  refreshDropdowns();
}

function enrichTargets() {
  if (villageDb.length === 0) {
    alert(t('alert_no_db'));
    return;
  }
  let enriched = 0;
  DATA.targets.forEach(t => {
    // try match by villageId first, then by coords
    let match = villageDb.find(v => String(v.id) === String(t.villageId));
    if (!match && t.x && t.y) match = villageDb.find(v => v.x === t.x && v.y === t.y);
    if (match) {
      if (!t.name || t.name === '-') t.name = match.name;
      if (!t.villageId) t.villageId = match.id;
      if (!t.player) t.player = playerMap[match.playerId] || '';
      if (!t.x) t.x = match.x;
      if (!t.y) t.y = match.y;
      enriched++;
    }
  });
  saveData();
  renderTargets();
  alert(t('alert_enriched').replace('{n}', enriched));
}

