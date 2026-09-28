// attack-planner — tabs, utils, villages CRUD, targets CRUD (incl. requirements editor).
// Classic script (4/9): no modules, shared global scope, load order matters — must work
// by double-click (file://). See the <script src> order in attack-planner.html.
'use strict';

// ══════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const names = ['plan', 'villages', 'targets', 'scavenge', 'db', 'guide'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.remove('active');
  });
  document.getElementById('tab-' + name).classList.add('active');
}

// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function stripBB(s) {
  return (s || '').replace(/\[\/?[^\]]+\]/g, '').trim();
}
function escAttr(s) {
  return String(s ?? '').replace(/'/g, "\\'");
}

function togglePanel(id) {
  const panel = document.getElementById(id);
  panel.classList.toggle('open');
  if (panel.classList.contains('open') && id === 'add-attack-panel') {
    // pre-fill landing time: 1 hour from now
    document.getElementById('aa-landing').value = localDatetimeValue(Date.now() + 3600000);
  }
}

function onAttackTypeChange(rowId) {
  const typeEl = rowId === 'aa-noble-row'
    ? document.getElementById('aa-type')
    : document.getElementById('ma-type');
  const row = document.getElementById(rowId);
  if (typeEl.value === 'snob') {
    row.classList.remove('hidden');
  } else {
    row.classList.add('hidden');
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function closePanel(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

// Escape closes whatever modal is open (same effect as its ✕ / Close button).
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
});

// ══════════════════════════════════════════════
// VILLAGES CRUD
// ══════════════════════════════════════════════

function addVillage() {
  const x    = parseInt(document.getElementById('av-x').value);
  const y    = parseInt(document.getElementById('av-y').value);
  if (!x || !y) { alert(t('alert_coords_required')); return; }
  const name = document.getElementById('av-name').value.trim() || `(${x}|${y})`;
  const vid  = document.getElementById('av-vid').value.trim();

  DATA.villages.push({
    id:          uid(),
    name,
    villageId:   vid || '',
    x, y,
    axes:        parseInt(document.getElementById('av-axes').value)        || 0,
    lc:          parseInt(document.getElementById('av-lc').value)          || 0,
    rams:        parseInt(document.getElementById('av-rams').value)        || 0,
    cats:        parseInt(document.getElementById('av-cats').value)        || 0,
    nobles:      parseInt(document.getElementById('av-nobles').value)      || 0,
  });
  // reset form
  ['av-name','av-vid','av-x','av-y'].forEach(id => document.getElementById(id).value = '');
  ['av-axes','av-lc','av-rams','av-cats','av-nobles']
    .forEach(id => document.getElementById(id).value = '0');
  document.getElementById('add-village-panel').classList.remove('open');

  saveData();
  renderVillages();
  refreshDropdowns();
}

function editVillage(id) {
  const v = DATA.villages.find(v => v.id === id);
  if (!v) return;
  document.getElementById('mv-id').value          = v.id;
  document.getElementById('mv-name').value        = v.name;
  document.getElementById('mv-vid').value         = v.villageId || '';
  document.getElementById('mv-x').value           = v.x;
  document.getElementById('mv-y').value           = v.y;
  document.getElementById('mv-axes').value        = v.axes || 0;
  document.getElementById('mv-lc').value          = v.lc || 0;
  document.getElementById('mv-rams').value        = v.rams || 0;
  document.getElementById('mv-cats').value        = v.cats || 0;
  document.getElementById('mv-nobles').value      = v.nobles || 0;
  openModal('modal-village');
}

function saveVillage() {
  const id = document.getElementById('mv-id').value;
  const v  = DATA.villages.find(v => v.id === id);
  if (!v) return;
  v.name       = document.getElementById('mv-name').value.trim();
  v.villageId  = document.getElementById('mv-vid').value.trim();
  v.x          = parseInt(document.getElementById('mv-x').value)           || 0;
  v.y          = parseInt(document.getElementById('mv-y').value)           || 0;
  v.axes       = parseInt(document.getElementById('mv-axes').value)        || 0;
  v.lc         = parseInt(document.getElementById('mv-lc').value)          || 0;
  v.rams       = parseInt(document.getElementById('mv-rams').value)        || 0;
  v.cats       = parseInt(document.getElementById('mv-cats').value)        || 0;
  v.nobles     = parseInt(document.getElementById('mv-nobles').value)      || 0;
  closeModal('modal-village');
  saveData();
  renderVillages();
  refreshDropdowns();
  renderAttacks();
}

function deleteVillage(id) {
  if (!confirm(t('alert_delete_village'))) return;
  DATA.villages = DATA.villages.filter(v => v.id !== id);
  DATA.attacks  = DATA.attacks.filter(a => a.fromId !== id);
  saveData();
  renderVillages();
  refreshDropdowns();
  renderAttacks();
}

function renderVillages() {
  const tbody = document.getElementById('villages-tbody');
  if (DATA.villages.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">${t('empty_villages')}</td></tr>`;
    return;
  }
  tbody.innerHTML = DATA.villages.map(v => {
    const pow = calcOffPow(v);
    return `
    <tr>
      <td>${escHtml(v.name)}</td>
      <td class="coords">${escHtml(v.villageId||'-')}</td>
      <td class="coords">${v.x}|${v.y}</td>
      <td>${v.axes||0}</td>
      <td>${v.lc||0}</td>
      <td>${v.rams||0}</td>
      <td>${v.cats||0}</td>
      <td>${v.nobles||0}</td>
      <td>${pow.toLocaleString()} ${offTierBadge(pow)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-edit btn-sm" onclick="editVillage('${v.id}')">✎ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteVillage('${v.id}')">✕</button>
      </td>
    </tr>
  `;
  }).join('');
}

// ══════════════════════════════════════════════
// TARGETS CRUD
// ══════════════════════════════════════════════

function dbAutoFillTarget() {
  const x = parseInt(document.getElementById('at-x').value);
  const y = parseInt(document.getElementById('at-y').value);
  if (!x || !y || villageDb.length === 0) return;
  const match = villageDb.find(v => v.x === x && v.y === y);
  if (match) {
    document.getElementById('at-name').value   = match.name;
    document.getElementById('at-vid').value    = match.id;
    document.getElementById('at-player').value = playerMap[match.playerId] || '';
  }
}

function dbAutoFillModal() {
  const x = parseInt(document.getElementById('mt-x').value);
  const y = parseInt(document.getElementById('mt-y').value);
  if (!x || !y || villageDb.length === 0) return;
  const match = villageDb.find(v => v.x === x && v.y === y);
  if (match) {
    document.getElementById('mt-name').value   = match.name;
    document.getElementById('mt-vid').value    = match.id;
    document.getElementById('mt-player').value = playerMap[match.playerId] || '';
  }
}

function dbAutoFillVillage() {
  const x = parseInt(document.getElementById('av-x').value);
  const y = parseInt(document.getElementById('av-y').value);
  if (!x || !y || villageDb.length === 0) return;
  const match = villageDb.find(v => v.x === x && v.y === y);
  if (match) {
    document.getElementById('av-name').value = match.name;
    document.getElementById('av-vid').value  = match.id;
  }
}

function parseReqLines(text, attacker) {
  const reqs = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Time is optional. Accept a window (HH:MM/HH:MM) or a single exact time (HH:MM).
    // A single time → timeFrom set, timeTo empty: land exactly at that time.
    const m = line.match(/^(off|ram|complete|1\/2|half|axe|snob|noble)\s*(?:(\d{1,2}:\d{2})(?:\s*[–\-\/]\s*(\d{1,2}:\d{2}))?)?/i);
    if (!m) continue;
    const typeRaw = m[1].toLowerCase();
    const unitType = (typeRaw === 'off' || typeRaw === 'ram' || typeRaw === 'complete') ? 'ram'
                   : (typeRaw === '1/2' || typeRaw === 'half' || typeRaw === 'axe')     ? 'axe'
                   : 'snob';
    reqs.push({ unitType, attacker, timeFrom: m[2] || '', timeTo: m[3] || '' });
  }
  return reqs;
}

function addTarget() {
  const x = parseInt(document.getElementById('at-x').value);
  const y = parseInt(document.getElementById('at-y').value);
  if (!x || !y) { alert(t('alert_coords_required')); return; }

  const targetType = document.getElementById('at-type').value;
  const attacker   = (DATA.settings.playerName || '').trim();
  const reqs       = targetType === 'off'
    ? parseReqLines(document.getElementById('at-reqs').value, attacker)
    : [];

  DATA.targets.push({
    id:         uid(),
    name:       document.getElementById('at-name').value.trim() || `${x}|${y}`,
    villageId:  document.getElementById('at-vid').value.trim() || '',
    player:     document.getElementById('at-player').value.trim() || '',
    x, y,
    targetType,
    requirements: reqs
  });
  ['at-x','at-y','at-name','at-vid','at-player'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('at-reqs').value = '';
  document.getElementById('at-type').value = 'off';
  document.getElementById('at-reqs-row').style.display = '';
  document.getElementById('add-target-panel').classList.remove('open');

  saveData();
  renderTargets();
  refreshDropdowns();
}

// ── Edit Target: requirements editor ──────────────────────────────
// Working copy of the edited target's requirements. editTarget deep-copies into this,
// the inline row handlers mutate it, and saveTarget writes a normalized copy back — so
// hitting Cancel discards every change. The structured rows (vs a textarea) are what let
// us round-trip the rich fields the per-player import sets — attacker, count, and the
// srcCoord/srcVillageId pin — instead of silently dropping them.
let mtReqs = [];

const MT_REQ_INPUT = 'background:#111008;border:1px solid #4a3010;color:#d4b483;padding:4px 6px;border-radius:4px;font-size:12px';

function renderMtReqs() {
  const host = document.getElementById('mt-reqs-list');
  if (!mtReqs.length) {
    host.innerHTML = `<p class="note" style="margin:2px 0">${t('mt_no_reqs')}</p>`;
    return;
  }
  host.innerHTML = mtReqs.map((r, i) => {
    const sel = v => r.unitType === v ? ' selected' : '';
    return `
    <div style="display:flex;gap:5px;align-items:center;margin-bottom:5px;flex-wrap:wrap">
      <select onchange="mtReqs[${i}].unitType=this.value" style="${MT_REQ_INPUT}">
        <option value="ram"${sel('ram')}>⚔ off</option>
        <option value="axe"${sel('axe')}>🪓 1/2</option>
        <option value="snob"${sel('snob')}>👑 snob</option>
        <option value="fake"${sel('fake')}>💨 fake</option>
      </select>
      <input type="text" value="${escHtml(r.attacker || '')}" oninput="mtReqs[${i}].attacker=this.value" placeholder="${t('lbl_player')}" style="${MT_REQ_INPUT};flex:1;min-width:100px">
      <input type="number" min="1" value="${r.count || 1}" oninput="mtReqs[${i}].count=parseInt(this.value)||1" title="${t('mt_count')}" style="${MT_REQ_INPUT};width:46px">
      <input type="date" value="${escHtml(r.dateISO || '')}" onchange="mtReqs[${i}].dateISO=this.value" title="${t('mt_date_title')}" style="${MT_REQ_INPUT};width:118px">
      <input type="text" value="${escHtml(r.timeFrom || '')}" oninput="mtReqs[${i}].timeFrom=this.value.trim()" placeholder="HH:MM" style="${MT_REQ_INPUT};width:58px">
      <input type="text" value="${escHtml(r.timeTo || '')}" oninput="mtReqs[${i}].timeTo=this.value.trim()" placeholder="HH:MM" style="${MT_REQ_INPUT};width:58px">
      <input type="text" value="${escHtml(r.srcCoord || '')}" oninput="mtReqs[${i}].srcCoord=this.value.trim()" placeholder="${t('mt_src')}" title="${t('mt_src_title')}" style="${MT_REQ_INPUT};width:66px">
      <button type="button" class="btn btn-danger btn-sm" onclick="mtReqRemove(${i})">✕</button>
    </div>`;
  }).join('');
}

function mtReqAdd() {
  mtReqs.push({ unitType: 'ram', attacker: (DATA.settings.playerName || '').trim(), timeFrom: '', timeTo: '', count: 1, srcCoord: '', srcVillageId: '' });
  renderMtReqs();
}

function mtReqRemove(i) {
  mtReqs.splice(i, 1);
  renderMtReqs();
}

function mtReqAssignAll() {
  const me = (DATA.settings.playerName || '').trim();
  if (!me) { alert(t('alert_no_my_player')); return; }
  mtReqs.forEach(r => { r.attacker = me; });
  renderMtReqs();
}

// Clean a working requirements list before saving: drop blank rows, keep the noble count only
// where it matters, and re-pin srcVillageId from srcCoord against the known villages (so an
// edited/typed origin coord still resolves to its real village ID; clearing the coord drops the
// pin). Pure — villages are passed in so the test harness can exercise it without the DOM.
function normalizeReqs(reqs, villages) {
  const byCoord = {};
  (villages || []).forEach(v => { byCoord[`${v.x}|${v.y}`] = v; });
  return (reqs || [])
    .filter(r => r && r.unitType)
    .map(r => {
      const out = {
        unitType: r.unitType,
        attacker: (r.attacker || '').trim(),
        timeFrom: (r.timeFrom || '').trim(),
        timeTo:   (r.timeTo || '').trim(),
      };
      // Per-requirement arrival date (multi-date plan imports / the editor's date field).
      // Kept only when it is a real, valid ISO date — Auto-Generate trusts it verbatim, and
      // a well-shaped garbage date ("2026-13-45") would throw inside landingISO.
      const dateISO = (r.dateISO || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateISO) && !Number.isNaN(new Date(dateISO + 'T00:00:00').getTime())) out.dateISO = dateISO;
      const cnt = Math.max(1, parseInt(r.count, 10) || 1);
      if (r.unitType === 'snob' || cnt > 1) out.count = cnt;
      // Catapult-target building from the plan import — carried through unchanged (the
      // editor has no field for it, and dropping it here would strip it on every save).
      const building = (r.building || '').trim();
      if (building) out.building = building;
      const srcCoord = (r.srcCoord || '').trim();
      if (srcCoord) {
        out.srcCoord = srcCoord;
        const v = byCoord[srcCoord];
        out.srcVillageId = v ? (v.villageId || '') : (r.srcVillageId || '');
      }
      return out;
    });
}

function editTarget(id) {
  const tg = DATA.targets.find(t => t.id === id);
  if (!tg) return;
  document.getElementById('mt-id').value     = tg.id;
  document.getElementById('mt-x').value      = tg.x;
  document.getElementById('mt-y').value      = tg.y;
  document.getElementById('mt-name').value   = tg.name;
  document.getElementById('mt-vid').value    = tg.villageId || '';
  document.getElementById('mt-player').value = tg.player || '';
  mtReqs = (tg.requirements || []).map(r => ({ ...r }));   // working copy — Cancel discards
  renderMtReqs();
  openModal('modal-target');
}

function saveTarget() {
  const id = document.getElementById('mt-id').value;
  const tg = DATA.targets.find(t => t.id === id);
  if (!tg) return;
  tg.x            = parseInt(document.getElementById('mt-x').value)   || 0;
  tg.y            = parseInt(document.getElementById('mt-y').value)   || 0;
  tg.name         = document.getElementById('mt-name').value.trim()   || `${tg.x}|${tg.y}`;
  tg.villageId    = document.getElementById('mt-vid').value.trim()    || '';
  tg.player       = document.getElementById('mt-player').value.trim() || '';
  tg.requirements = normalizeReqs(mtReqs, DATA.villages);
  closeModal('modal-target');
  saveData();
  renderTargets();
  refreshDropdowns();
  renderAttacks();
}

function deleteTarget(id) {
  if (!confirm(t('alert_delete_target'))) return;
  DATA.targets  = DATA.targets.filter(t => t.id !== id);
  DATA.attacks  = DATA.attacks.filter(a => a.targetId !== id);
  saveData();
  renderTargets();
  refreshDropdowns();
  renderAttacks();
}

function reqBadgeHtml(unitType) {
  const cls = unitType === 'ram' ? 'req-ram' : unitType === 'snob' ? 'req-snob' : unitType === 'fake' ? 'req-fake' : 'req-axe';
  const label = unitType === 'ram' ? '⚔ off' : unitType === 'snob' ? '👑 snob' : unitType === 'fake' ? '💨 fake' : '🪓 1/2';
  return `<span class="req-badge ${cls}">${label}</span>`;
}

// Display a landing time: "HH:MM–HH:MM" for a real window, plain "HH:MM" for an exact
// (single) time, "" when no time is set.
function fmtTimeWindow(from, to) {
  if (from && to && from !== to) return `${from}–${to}`;
  return from || '';
}

function renderRequirements(reqs) {
  if (!reqs || !reqs.length) return '<span class="text-dim">—</span>';
  return reqs.map(r => {
    const cnt  = (r.unitType === 'snob' && r.count > 1) ? `<small style="color:#d4b483;font-weight:bold">${r.count}× </small>` : '';
    // A requirement with its own arrival date (multi-date plan import) shows its day-of-month
    // before the window, mirroring the tribe-calculator export ("12 · 05:00–06:00").
    const day  = /^\d{4}-\d{2}-\d{2}$/.test(r.dateISO || '') ? parseInt(r.dateISO.slice(8), 10) : null;
    const tw   = fmtTimeWindow(r.timeFrom, r.timeTo);
    const win  = day != null ? (tw ? `${day} · ${tw}` : String(day)) : tw;
    const time = win ? `<span style="font-family:monospace;color:#6090c0;font-size:10px"> ${escHtml(win)}</span>` : '';
    // Catapult Mode: the imported "(→ Building)" objective of this off's riding catapults.
    const bldg = r.building ? `<small style="color:#c08040;font-size:10px;font-weight:bold"> → ${escHtml(r.building)}</small>` : '';
    const from = r.srcCoord ? `<small style="color:#6a7a4a;font-size:10px"> from ${escHtml(r.srcCoord)}</small>` : '';
    return `${cnt}${reqBadgeHtml(r.unitType)}<small style="color:#806838;font-size:10px"> ${escHtml(r.attacker)}</small>${time}${bldg}${from}`;
  }).join('<br>');
}

function renderTargets() {
  const tbody = document.getElementById('targets-tbody');
  if (DATA.targets.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${t('empty_targets')}</td></tr>`;
    return;
  }
  tbody.innerHTML = DATA.targets.map(t => {
    const typeBadge = t.targetType === 'off'
      ? `<span class="badge ttype-off">Off</span>`
      : t.targetType === 'fake'
        ? `<span class="badge ttype-fake">Fake</span>`
        : `<span class="text-dim">—</span>`;
    return `
    <tr>
      <td>${escHtml(t.name)}</td>
      <td class="coords">${escHtml(t.villageId||'-')}</td>
      <td class="coords">${t.x}|${t.y}</td>
      <td>${escHtml(stripBB(t.player)||'-')}</td>
      <td>${typeBadge}</td>
      <td style="font-size:12px;line-height:1.6">${renderRequirements(t.requirements)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-edit btn-sm" onclick="editTarget('${t.id}')">✎ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTarget('${t.id}')">✕</button>
      </td>
    </tr>
  `;
  }).join('');
}

