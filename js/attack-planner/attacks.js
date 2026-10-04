// attack-planner — attacks CRUD, countdowns, dropdowns, settings, village import.
// Classic script (7/9): no modules, shared global scope, load order matters — must work
// by double-click (file://). See the <script src> order in attack-planner.html.
'use strict';

// ══════════════════════════════════════════════
// ATTACKS CRUD
// ══════════════════════════════════════════════

function addAttack() {
  const fromId     = document.getElementById('aa-from').value;
  const targetId   = document.getElementById('aa-target').value;
  const type       = document.getElementById('aa-type').value;
  const speed      = document.getElementById('aa-speed').value;
  const nobleCount = parseInt(document.getElementById('aa-nobles').value) || 1;
  const catCount   = parseInt(document.getElementById('aa-cats').value) || 0;   // 0 = all the village's catapults
  const landingVal = document.getElementById('aa-landing').value;

  if (!fromId)     { alert(t('alert_select_from'));   return; }
  if (!targetId)   { alert(t('alert_select_target')); return; }
  if (!landingVal) { alert(t('alert_set_landing'));   return; }

  DATA.attacks.push({
    id:          uid(),
    fromId,
    targetId,
    type,
    speed:       speed || '',   // '' = travel at the type's pace; sword/axe/lc override timing only
    nobleCount:  type === 'snob' ? nobleCount : 1,
    catCount:    type === 'catapult' ? catCount : 0,
    landingTime: new Date(landingVal).toISOString(),
    manual:      true,   // survives Auto-Generate (which replaces generated attacks)
    sent:        false
  });

  document.getElementById('add-attack-panel').classList.remove('open');
  saveData();
  renderAttacks();
}

function editAttack(id) {
  const a = DATA.attacks.find(a => a.id === id);
  if (!a) return;
  document.getElementById('ma-id').value      = a.id;
  document.getElementById('ma-type').value    = a.type;
  document.getElementById('ma-speed').value   = a.speed || '';
  document.getElementById('ma-nobles').value  = a.nobleCount || 1;
  document.getElementById('ma-cats').value    = a.catCount || 0;
  document.getElementById('ma-landing').value = localDatetimeValue(new Date(a.landingTime).getTime());

  // populate dropdowns
  refreshModalDropdowns();
  document.getElementById('ma-from').value   = a.fromId;
  document.getElementById('ma-target').value = a.targetId;

  // show/hide the noble-count / catapult-count rows for the attack's type
  onAttackTypeChange('ma-noble-row');

  openModal('modal-attack');
}

function saveAttack() {
  const id = document.getElementById('ma-id').value;
  const a  = DATA.attacks.find(a => a.id === id);
  if (!a) return;
  const landingVal = document.getElementById('ma-landing').value;
  a.fromId     = document.getElementById('ma-from').value;
  a.targetId   = document.getElementById('ma-target').value;
  a.type       = document.getElementById('ma-type').value;
  a.speed      = document.getElementById('ma-speed').value || '';
  a.nobleCount = parseInt(document.getElementById('ma-nobles').value) || 1;
  a.catCount   = a.type === 'catapult' ? (parseInt(document.getElementById('ma-cats').value) || 0) : 0;
  a.landingTime = new Date(landingVal).toISOString();
  closeModal('modal-attack');
  saveData();
  renderAttacks();
}

function deleteAttack(id) {
  if (!confirm(t('alert_delete_attack'))) return;
  DATA.attacks = DATA.attacks.filter(a => a.id !== id);
  saveData();
  renderAttacks();
}

function toggleSent(id) {
  const a = DATA.attacks.find(a => a.id === id);
  if (!a) return;
  a.sent = !a.sent;
  saveData();
  renderAttacks();
}

function clearAllAttacks() {
  if (!confirm(t('alert_delete_all'))) return;
  DATA.attacks = [];
  saveData();
  renderAttacks();
}

// ══════════════════════════════════════════════
// REPLACE SENDER — swap an attack's origin for another village that can still make it
// ══════════════════════════════════════════════

// Offensive-Plan requirement kinds that spend the same troops as an attack of each type: an
// off attack consumes a complete/half (ram/axe) requirement's village, a snob its noble
// train, a catapult attack its catapults, a fake only one ram + one spy (so a fake never
// makes its village "busy").
const REPLACE_REQ_UNITS = { off: ['ram', 'axe'], snob: ['snob'], fake: ['fake'], catapult: ['catapult'] };
// An off replacement must be a real off: weaker villages are never offered.
const REPLACE_MIN_OFF_POW = 300000;

// The My-Villages entry a pinned requirement names (rally-URL village ID first, coords second).
function pinnedVillage(req) {
  if (!req) return null;
  const vid = req.srcVillageId ? String(req.srcVillageId) : '';
  return (vid && DATA.villages.find(v => String(v.villageId) === vid))
      || (req.srcCoord && DATA.villages.find(v => `${v.x}|${v.y}` === req.srcCoord))
      || null;
}

// villageId → [{ targetId, kind }] for every village already committed as a SENDER: the origin
// of another off/snob attack in the Attack Plan (sent or not — its troops are spoken for), or
// pinned by a ram/axe/snob requirement of the Offensive Plan (Targets tab). Fakes never count
// (one ram + one spy leave the off at home). The attack being replaced (`excludeId`) and the
// plan requirement that produced it are ignored. A village absent from the map is FREE (🏠).
function assignedSenders(excludeId) {
  const map = new Map();
  const add = (vid, targetId, kind) => {
    if (!vid) return;
    if (!map.has(vid)) map.set(vid, []);
    const list = map.get(vid);
    if (!list.some(e => e.targetId === targetId && e.kind === kind)) list.push({ targetId, kind });
  };
  const excluded = DATA.attacks.find(a => a.id === excludeId) || null;
  DATA.attacks.forEach(a => {
    if (a.id === excludeId || !a.fromId || a.type === 'fake' || a.type === 'unassigned') return;
    add(a.fromId, a.targetId, a.type);
  });
  DATA.targets.forEach(tg => (tg.requirements || []).forEach(r => {
    if (!r.srcCoord && !r.srcVillageId) return;      // unpinned → Auto-Generate picks the village
    if (r.unitType === 'fake') return;
    const v = pinnedVillage(r);
    if (!v) return;
    // this attack's own plan pin — the village is exactly what we're replacing
    if (excluded && v.id === excluded.fromId && tg.id === excluded.targetId
        && (REPLACE_REQ_UNITS[excluded.type] || []).includes(r.unitType)) return;
    add(v.id, tg.id, r.unitType === 'snob' ? 'snob' : r.unitType === 'catapult' ? 'catapult' : 'off');
  }));
  return map;
}

// Every village that could take over `atk`: it holds the troops the attack type needs (a noble
// for a snob, a ram for a fake, the planned catapults — at least one — for a catapult attack,
// ≥ REPLACE_MIN_OFF_POW off power for an off), it isn't the current origin, and its
// send window is still open — sending NOW or LATER still lands inside the landing window
// (sendEndMs ≥ now). Free (🏠) villages come first, strongest first within each group.
// `late` counts the villages hidden because their send window has already closed.
function replaceCandidates(atk, now = Date.now()) {
  const target = DATA.targets.find(t => t.id === atk.targetId);
  const speedKey = (atk.speed && BASE_MIN[atk.speed]) ? atk.speed : atk.type;
  if (!target || !BASE_MIN[speedKey]) return { rows: [], late: 0 };
  const ws = DATA.settings.worldSpeed, us = DATA.settings.unitSpeed;
  const landMs = new Date(atk.landingTime).getTime();
  const span   = windowSpanMs(atk.windowFrom, atk.windowTo);
  const busy   = assignedSenders(atk.id);
  const holds = v => atk.type === 'snob'     ? (v.nobles || 0) > 0
                   : atk.type === 'fake'     ? (v.rams || 0) > 0
                   : atk.type === 'catapult' ? (v.cats || 0) >= Math.max(1, atk.catCount || 0)
                   : calcOffPow(v) >= REPLACE_MIN_OFF_POW;
  const rows = [];
  let late = 0;
  DATA.villages.forEach(v => {
    if (v.id === atk.fromId || !holds(v)) return;
    const d = dist(v, target);
    const tMs = travelMs(d, speedKey, ws, us);
    const sendMs = landMs - tMs;
    const sendEndMs = sendMs + span;
    if (sendEndMs < now) { late++; return; }
    const assignedTo = busy.get(v.id) || [];
    rows.push({ v, pow: calcOffPow(v), d, tMs, sendMs, sendEndMs, free: assignedTo.length === 0, assignedTo });
  });
  rows.sort((a, b) => a.free !== b.free ? (a.free ? -1 : 1) : b.pow - a.pow);
  return { rows, late };
}

// Make village `villageId` the sender of attack `attackId`. The Offensive-Plan requirement that
// pinned the OLD village for this target (same troop kind + landing window) is re-pinned to the
// new one, so the Targets tab agrees and a later Auto-Generate keeps the swap instead of
// reverting it. Returns the attack, or null when either side is unknown.
function applyReplace(attackId, villageId) {
  const a = DATA.attacks.find(x => x.id === attackId);
  const v = DATA.villages.find(x => x.id === villageId);
  if (!a || !v || a.type === 'unassigned') return null;
  const old    = DATA.villages.find(x => x.id === a.fromId) || null;
  const target = DATA.targets.find(x => x.id === a.targetId);
  if (old && target) {
    const units = REPLACE_REQ_UNITS[a.type] || [];
    const req = (target.requirements || []).find(r =>
      units.includes(r.unitType) && pinnedVillage(r) === old && (r.timeFrom || '') === (a.windowFrom || ''));
    if (req) { req.srcCoord = `${v.x}|${v.y}`; req.srcVillageId = String(v.villageId || ''); }
  }
  a.fromId = v.id;
  return a;
}

// Countdown cell of a candidate: "opens in …" until its send window opens, then SEND NOW with
// the time left inside the window — same colour thresholds as the Attack Plan countdown.
function replaceCountdown(row, now = Date.now()) {
  if (row.sendEndMs < now) return { cls: 'cd-late', html: t('status_late') };
  const diff = row.sendMs - now;
  if (diff <= 0) {
    return { cls: 'cd-now', html: `${t('status_send_now')} · <span style="color:#d0c030">${fmtDuration(row.sendEndMs - now)}</span> ${t('status_left')}` };
  }
  const cls = diff > 30 * 60000 ? 'cd-ok' : diff > 5 * 60000 ? 'cd-soon' : 'cd-urgent';
  return { cls, html: escHtml(t('rp_opens_in').replace('{t}', fmtDuration(diff))) };
}

let replaceRows = [];   // candidates shown in the open Replace modal (live countdown ticks)

function openReplace(id) {
  const a = DATA.attacks.find(a => a.id === id);
  if (!a || a.type === 'unassigned') return;
  const target = DATA.targets.find(t => t.id === a.targetId);
  const cur    = DATA.villages.find(v => v.id === a.fromId);
  const now    = Date.now();
  document.getElementById('mr-id').value = a.id;

  const win  = fmtTimeWindow(a.windowFrom, a.windowTo);
  const tgt  = target
    ? `<span class="coords">${target.x}|${target.y}</span>${stripBB(target.player) ? ` (${escHtml(stripBB(target.player))})` : ''}`
    : '—';
  const from = cur ? `${escHtml(cur.name)} (${cur.x}|${cur.y})` : '—';
  document.getElementById('mr-head').innerHTML =
    `<span class="badge badge-${a.type}">${a.type.toUpperCase()}</span> → ${tgt} · ${t('lbl_landing')} ` +
    `<span style="font-family:monospace">${escHtml(fmtDateLocal(a.landingTime))}</span>` +
    (win ? ` <span style="color:#6090c0">(${escHtml(win)})</span>` : '') +
    `<br>${t('rp_current')}: <strong>${from}</strong>`;

  const { rows, late } = replaceCandidates(a, now);
  replaceRows = rows;
  document.getElementById('mr-tbody').innerHTML = rows.length
    ? rows.map(r => replaceRowHtml(a, r, now)).join('')
    : `<tr class="empty-row"><td colspan="8">${t('rp_none')}</td></tr>`;
  document.getElementById('mr-note').textContent = late ? t('rp_late_note').replace('{n}', late) : '';
  openModal('modal-replace');
}

function replaceRowHtml(atk, r, now) {
  const v = r.v;
  const tgtCoord = id => { const tg = DATA.targets.find(t => t.id === id); return tg ? `${tg.x}|${tg.y}` : '?'; };
  const status = r.free
    ? `<span class="rp-free">${t('rp_free')}</span>`
    : r.assignedTo.map(e =>
        `<span class="rp-busy" title="${escHtml(t('rp_busy_title'))}">${e.kind === 'snob' ? '👑' : e.kind === 'catapult' ? '💥' : '⚔'} → ${tgtCoord(e.targetId)}</span>`
      ).join(' ');
  const powCell = `${r.pow.toLocaleString()} ${offTierBadge(r.pow)}`
    + (atk.type === 'snob' ? ` <small style="color:#d0c040">👑×${v.nobles || 0}</small>` : '')
    + (atk.type === 'catapult' ? ` <small style="color:#c080f0">💥×${v.cats || 0}</small>` : '');
  const sp = n => String(n).padStart(2, '0');
  const fmtSend = ms => { const d = new Date(ms); return `${sp(d.getDate())}/${sp(d.getMonth() + 1)} ${sp(d.getHours())}:${sp(d.getMinutes())}:${sp(d.getSeconds())}`; };
  let sendCell = fmtSend(r.sendMs);
  if (r.sendEndMs > r.sendMs) sendCell += `<br><small style="color:#6090c0;font-size:10px">–${fmtSend(r.sendEndMs)}</small>`;
  const cd = replaceCountdown(r, now);
  return `<tr class="${r.free ? '' : 'rp-row-busy'}">
    <td>${escHtml(v.name)} <span class="coords">${v.x}|${v.y}</span></td>
    <td>${status}</td>
    <td>${powCell}</td>
    <td>${fmtDistNum(r.d)}</td>
    <td style="font-family:monospace;font-size:12px">${fmtMs(r.tMs)}</td>
    <td style="font-family:monospace;font-size:12px">${sendCell}</td>
    <td id="mr-cd-${v.id}" class="${cd.cls}">${cd.html}</td>
    <td><button class="btn btn-replace btn-sm" onclick="pickReplace('${v.id}')">♻ ${t('btn_use')}</button></td>
  </tr>`;
}

function pickReplace(villageId) {
  const id = document.getElementById('mr-id').value;
  if (!applyReplace(id, villageId)) return;
  closeModal('modal-replace');
  replaceRows = [];
  saveData();
  renderAttacks();
  renderTargets();   // the re-pinned requirement now shows its new "from" origin
}

// Live tick for the open Replace modal (called from updateCountdowns every second).
function updateReplaceCountdowns() {
  if (!replaceRows.length) return;
  const modal = document.getElementById('modal-replace');
  if (!modal || !modal.classList.contains('open')) return;
  const now = Date.now();
  replaceRows.forEach(r => {
    const el = document.getElementById('mr-cd-' + r.v.id);
    if (!el) return;
    const cd = replaceCountdown(r, now);
    el.className = cd.cls;
    el.innerHTML = cd.html;
  });
}

function fmtDatetimeExport(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function exportToNotepad() {
  const rows = DATA.attacks
    .map(a => ({ atk: a, c: computeAttackRow(a) }))
    .filter(r => r.c)
    .sort((a, b) => a.c.sendMs - b.c.sendMs);

  if (!rows.length) { alert(t('alert_no_attacks_export')); return; }

  let out = '[table]\n';
  out += '[**]#[||]Source[||]Target[||]Target Player[||]Type[||]Send time[||]Arrival time[||]Attack URL[/**]\n';

  rows.forEach(({ atk, c }, i) => {
    const village = DATA.villages.find(v => v.id === atk.fromId);
    const target  = DATA.targets.find(t => t.id === atk.targetId);
    const src     = `[coord]${village.x}|${village.y}[/coord]`;
    const tgt     = `[coord]${target.x}|${target.y}[/coord]`;
    const player  = target.player ? `[player]${target.player}[/player]` : '-';
    const url     = `[url=${c.url}]open[/url]`;
    out += `[*]${i+1}[|]${src}[|]${tgt}[|]${player}[|]${atk.type}[|]${fmtDatetimeExport(c.sendMs)}[|]${fmtDatetimeExport(c.landMs)}[|]${url}[|]\n`;
  });

  out += '[/table]';

  document.getElementById('export-text').value = out;
  openModal('modal-export');
}

function copyExportText() {
  const ta = document.getElementById('export-text');
  navigator.clipboard.writeText(ta.value)
    .then(() => { const btn = event.target; const orig = btn.textContent; btn.textContent = t('btn_copied'); setTimeout(() => btn.textContent = orig, 1500); })
    .catch(() => { ta.select(); document.execCommand('copy'); });
}

function clearSent() {
  if (!confirm(t('alert_clear_sent'))) return;
  DATA.attacks = DATA.attacks.filter(a => !a.sent);
  saveData();
  renderAttacks();
}

function clearVillages() {
  if (!confirm(t('alert_clear_villages'))) return;
  DATA.villages = [];
  saveData();
  renderVillages();
  refreshDropdowns();
}

function clearTargets() {
  if (!confirm(t('alert_clear_targets'))) return;
  DATA.targets = [];
  saveData();
  renderTargets();
  refreshDropdowns();
}

function copyUrl(id) {
  const a = DATA.attacks.find(a => a.id === id);
  if (!a) return;
  const row = computeAttackRow(a);
  if (!row) return;
  navigator.clipboard.writeText(row.url).then(() => {
    const btn = document.getElementById('copy-btn-' + id);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  });
}

function fmtDistNum(d) {
  return d.toFixed(1);
}

function setAttackSort(col) {
  if (attackSortCol === col) attackSortDir = -attackSortDir;
  else { attackSortCol = col; attackSortDir = 1; }
  renderAttacks();
}

function renderAttacks() {
  const tbody = document.getElementById('attack-tbody');

  const rows = DATA.attacks.map(a => {
    const computed = computeAttackRow(a);
    const village  = DATA.villages.find(v => v.id === a.fromId);
    const target   = DATA.targets.find(t => t.id === a.targetId);
    return { atk: a, computed, village, target };
  });

  // ── Filter ──
  const fv = id => { const el = document.getElementById(id); return el ? el.value.trim().toLowerCase() : ''; };
  const fFrom   = fv('af-from');
  const fTarget = fv('af-target');
  const fVname  = fv('af-villageName');
  const fPlayer = fv('af-playerName');
  const fType   = fv('af-type');

  const filtered = rows.filter(({ atk, village, target }) => {
    if (fFrom   && !(village?.name  || '').toLowerCase().includes(fFrom))        return false;
    if (fTarget && !`${target?.x||''}|${target?.y||''}`.includes(fTarget))       return false;
    if (fVname  && !(target?.name   || '').toLowerCase().includes(fVname))       return false;
    if (fPlayer && !(target?.player || '').toLowerCase().includes(fPlayer))      return false;
    if (fType   && !atk.type.toLowerCase().includes(fType))                      return false;
    return true;
  });

  // ── Sort ──
  const sortVal = ({ atk, computed, village, target }) => {
    switch (attackSortCol) {
      case 'from':        return (village?.name  || '').toLowerCase();
      case 'target':      return target ? `${target.x}|${target.y}` : '';
      case 'villageName': return (target?.name   || '').toLowerCase();
      case 'playerName':  return (target?.player || '').toLowerCase();
      case 'type':        return atk.type;
      case 'offPow':      return (atk.type === 'off' && village) ? calcOffPow(village) : -1;
      case 'building':    return (atk.building || '').toLowerCase();
      case 'dist':        return computed ? computed.d    : Infinity;
      case 'travel':      return computed ? computed.tMs  : Infinity;
      case 'landing':     return new Date(atk.landingTime).getTime();
      case 'sendAt':      return computed ? computed.sendMs : 0;
      default: return 0;
    }
  };

  filtered.sort((a, b) => {
    if (a.atk.sent !== b.atk.sent) return a.atk.sent ? 1 : -1;
    const va = sortVal(a), vb = sortVal(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return cmp * attackSortDir;
  });

  // ── Update sort icons ──
  ['from','target','villageName','playerName','type','offPow','building','dist','travel','landing','sendAt'].forEach(col => {
    const el = document.getElementById('si-' + col);
    if (el) el.textContent = col === attackSortCol ? (attackSortDir === 1 ? '▲' : '▼') : '';
  });

  if (filtered.length === 0) {
    const hasFilter = fFrom || fTarget || fVname || fPlayer || fType;
    tbody.innerHTML = `<tr class="empty-row"><td colspan="14">${hasFilter ? t('empty_attacks_filtered') : t('empty_attacks')}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(({ atk: a, computed: c, village, target }) => {
    const server   = DATA.settings.serverUrl;
    const twLink   = (href, content, cls = '') =>
      `<a href="${escHtml(href)}" target="_blank" rel="noopener" class="tw-link${cls ? ' ' + cls : ''}">${content}</a>`;
    const villageUrl = id => `https://${server}/game.php?screen=info_village&id=${id}`;
    const playerUrl  = id => `https://${server}/game.php?screen=info_player&id=${id}`;

    // From village
    const fromLabel = village ? escHtml(village.name) : `<span class="text-dim">Unknown</span>`;
    const fromName  = village?.villageId ? twLink(villageUrl(village.villageId), fromLabel) : fromLabel;

    // Target coords
    const coordSpan   = target ? `<span class="coords">${target.x}|${target.y}</span>` : `<span class="text-dim">—</span>`;
    const targetCoord = target?.villageId ? twLink(villageUrl(target.villageId), `${target.x}|${target.y}`, 'coords') : coordSpan;

    // Village name — fall back to DB lookup if name is just "X|Y"
    const rawVName = (() => {
      if (!target) return null;
      if (target.name && target.name !== `${target.x}|${target.y}`) return target.name;
      // Live DB lookup: prefer villageId match, fall back to coords
      const db = (target.villageId ? villageDb.find(v => String(v.id) === String(target.villageId)) : null)
              || villageDb.find(v => v.x === parseInt(target.x) && v.y === parseInt(target.y));
      return db ? db.name : null;
    })();
    const vnLabel    = rawVName ? escHtml(rawVName) : `<span class="text-dim">—</span>`;
    const villageName = (rawVName && target?.villageId) ? twLink(villageUrl(target.villageId), escHtml(rawVName)) : vnLabel;

    // Player name — strip BB-code, link via playerMap reverse lookup
    const rawPlayer  = target ? stripBB(target.player) : '';
    const playerId   = rawPlayer ? Object.keys(playerMap).find(id => playerMap[id] === rawPlayer) : null;
    const pLabel     = rawPlayer ? escHtml(rawPlayer) : `<span class="text-dim">—</span>`;
    const playerName = (rawPlayer && playerId) ? twLink(playerUrl(playerId), escHtml(rawPlayer)) : pLabel;
    // ── Unassigned placeholder row ──
    if (a.type === 'unassigned') {
      const unitLabel = a.unitType === 'snob' ? '👑 snob' : a.unitType === 'axe' ? '🪓 1/2' : a.unitType === 'catapult' ? '💥 cat' : '⚔ off';
      const unitCls   = a.unitType === 'snob' ? 'req-snob' : a.unitType === 'axe' ? 'req-axe' : a.unitType === 'catapult' ? 'req-catapult' : 'req-ram';
      const winText   = fmtTimeWindow(a.windowFrom, a.windowTo);
      const winLabel  = winText
        ? `<span style="font-family:monospace;color:#6090c0;font-size:11px">${escHtml(winText)}</span>`
        : '<span class="text-dim">—</span>';
      return `<tr id="row-${a.id}" class="row-unassigned">
        <td><span style="color:#e05050;font-weight:bold">⚠ Unassigned</span></td>
        <td>${targetCoord}</td>
        <td>${villageName}</td>
        <td>${playerName}</td>
        <td><span class="req-badge ${unitCls}">${unitLabel}</span></td>
        <td><span class="text-dim">—</span></td>
        <td>${a.building ? `<span style="color:#c08040;font-weight:bold">${escHtml(a.building)}</span>` : '<span class="text-dim">—</span>'}</td>
        <td><span class="text-dim">—</span></td>
        <td><span class="text-dim">—</span></td>
        <td>${winLabel}</td>
        <td><span class="text-dim">—</span></td>
        <td></td>
        <td><span class="text-dim">—</span></td>
        <td style="white-space:nowrap">
          <button class="btn btn-danger btn-sm" onclick="deleteAttack('${a.id}')">✕</button>
        </td>
      </tr>`;
    }

    const typeBadge   = `<span class="badge badge-${a.type}">${a.type.toUpperCase()}</span>`;

    let distCell = '-', travelCell = '-', landingCell = '-', sendCell = '-';
    if (c) {
      distCell    = fmtDistNum(c.d);
      travelCell  = fmtMs(c.tMs);
      // Show the window sub-label only for a real window; an exact time is already the landing.
      const winSub = (a.windowFrom && a.windowTo && a.windowFrom !== a.windowTo)
        ? `<br><small style="color:#6090c0;font-size:10px">${escHtml(a.windowFrom)}–${escHtml(a.windowTo)}</small>` : '';
      landingCell = fmtDateLocal(a.landingTime) + winSub;
      const sp = n => String(n).padStart(2,'0');
      const sendParts = ms => { const d = new Date(ms); return { day: `${sp(d.getDate())}/${sp(d.getMonth()+1)}`, time: `${sp(d.getHours())}:${sp(d.getMinutes())}:${sp(d.getSeconds())}` }; };
      const s0 = sendParts(c.sendMs);
      sendCell = `${s0.day} ${s0.time}`;
      // Windowed attack: any send inside [sendMs, sendEndMs] lands in the window — show the
      // whole bracket, mirroring the Landing column's window sub-label. The end repeats its
      // date only when the send window crosses midnight.
      if (c.sendEndMs > c.sendMs) {
        const s1 = sendParts(c.sendEndMs);
        sendCell += `<br><small style="color:#6090c0;font-size:10px">–${s1.day === s0.day ? '' : s1.day + ' '}${s1.time}</small>`;
      }
    }

    const attackBtns = c
      ? `<a class="btn btn-attack btn-sm" href="${escHtml(c.url)}" target="_blank" rel="noopener">${t('btn_send')}</a>
         <button class="btn btn-copy btn-sm" id="copy-btn-${a.id}" onclick="copyUrl('${a.id}')">${t('btn_copy_url')}</button>`
      : `<span class="text-dim">—</span>`;

    const sentLabel = a.sent ? t('btn_unmark_sent') : t('btn_mark_sent');
    const sentClass = a.sent ? 'btn-ghost' : 'btn-sent';

    return `<tr id="row-${a.id}" class="${a.sent ? 'row-sent' : ''}">
      <td>${fromName}</td>
      <td>${targetCoord}</td>
      <td>${villageName}</td>
      <td>${playerName}</td>
      <td>${typeBadge}${a.type === 'snob' ? ` <small style="color:#6090e0">×${a.nobleCount}</small>` : ''}${a.type === 'catapult' ? ` <small style="color:#c080f0">×${a.catCount || (village ? (village.cats || 0) : '?')}</small>` : ''}${a.speed && BASE_MIN[a.speed] ? ` <small style="color:#c0a060">@${SPEED_LABEL[a.speed] || a.speed}</small>` : ''}</td>
      <td>${a.type === 'off' && village ? `${calcOffPow(village).toLocaleString()} ${offTierBadge(calcOffPow(village))}` : '<span class="text-dim">—</span>'}</td>
      <td>${a.building ? `<span style="color:#c08040;font-weight:bold">${escHtml(a.building)}</span>` : '<span class="text-dim">—</span>'}</td>
      <td>${distCell}</td>
      <td style="font-family:monospace;font-size:12px">${travelCell}</td>
      <td style="font-family:monospace;font-size:12px">${landingCell}</td>
      <td style="font-family:monospace;font-size:12px">${sendCell}</td>
      <td id="cd-${a.id}"></td>
      <td style="white-space:nowrap">${attackBtns}</td>
      <td style="white-space:nowrap">
        <button class="btn ${sentClass} btn-sm" onclick="toggleSent('${a.id}')">${sentLabel}</button>
        <button class="btn btn-edit btn-sm" onclick="editAttack('${a.id}')">✎</button>
        <button class="btn btn-replace btn-sm" onclick="openReplace('${a.id}')" title="${escHtml(t('btn_replace_title'))}">♻</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAttack('${a.id}')">✕</button>
      </td>
    </tr>`;
  }).join('');

  // immediately tick
  updateCountdowns();
}

// ══════════════════════════════════════════════
// COUNTDOWNS — live, no full re-render
// ══════════════════════════════════════════════

function updateCountdowns() {
  const now = Date.now();
  updateReplaceCountdowns();
  DATA.attacks.forEach(a => {
    const cdEl  = document.getElementById('cd-' + a.id);
    const rowEl = document.getElementById('row-' + a.id);
    if (!cdEl || !rowEl) return;

    if (a.sent) {
      cdEl.textContent  = t('status_sent');
      cdEl.className    = 'cd-sent';
      rowEl.className   = 'row-sent';
      return;
    }

    const c = computeAttackRow(a);
    if (!c) {
      cdEl.textContent = '—';
      cdEl.className   = '';
      return;
    }

    const diff    = c.sendMs - now;                    // ms until the send window opens
    const endDiff = (c.sendEndMs || c.sendMs) - now;   // ms until it closes (== diff when windowless)

    // Remove existing state classes
    rowEl.className = '';

    if (diff <= 0 && endDiff > 0) {
      // Inside the send window: still on time — SEND NOW plus how long the window stays open
      // (time-left in the cd-soon yellow so it reads apart from the red SEND NOW).
      // Windowless attacks never get here (endDiff === diff) and fall to LATE as before.
      cdEl.innerHTML   = `${t('status_send_now')} · <span style="color:#d0c030">${fmtDuration(endDiff)}</span> ${t('status_left')}`;
      cdEl.className   = 'cd-now';
      rowEl.className  = 'row-now';
    } else if (diff > 30 * 60000) {
      // > 30 min: green
      cdEl.textContent = fmtDuration(diff);
      cdEl.className   = 'cd-ok';
    } else if (diff > 5 * 60000) {
      // 5-30 min: yellow
      cdEl.textContent = fmtDuration(diff);
      cdEl.className   = 'cd-soon';
      rowEl.className  = 'row-urgent';
    } else if (diff > 60000) {
      // 1-5 min: orange
      cdEl.textContent = fmtDuration(diff);
      cdEl.className   = 'cd-urgent';
      rowEl.className  = 'row-urgent';
    } else if (diff > 0) {
      // <1 min: red blinking SEND NOW
      cdEl.textContent = t('status_send_now');
      cdEl.className   = 'cd-now';
      rowEl.className  = 'row-now';
    } else {
      // past the send window (its end for windowed attacks, the exact time otherwise)
      const late = -endDiff;
      cdEl.textContent = `${t('status_late')} ${fmtDuration(late)}`;
      cdEl.className   = 'cd-late';
      rowEl.className  = 'row-now';
    }
  });
}

// ══════════════════════════════════════════════
// DROPDOWNS
// ══════════════════════════════════════════════

function refreshDropdowns() {
  const villageOptions = DATA.villages.map(v =>
    `<option value="${v.id}">${escHtml(v.name)} (${v.x}|${v.y})</option>`
  ).join('');
  const targetOptions = DATA.targets.map(t =>
    `<option value="${t.id}">${escHtml(t.name)} (${t.x}|${t.y})</option>`
  ).join('');

  const emptyVillage = `<option value="">-- Select Village --</option>`;
  const emptyTarget  = `<option value="">-- Select Target --</option>`;

  document.getElementById('aa-from').innerHTML   = emptyVillage + villageOptions;
  document.getElementById('aa-target').innerHTML = emptyTarget  + targetOptions;
}

function refreshModalDropdowns() {
  const villageOptions = DATA.villages.map(v =>
    `<option value="${v.id}">${escHtml(v.name)} (${v.x}|${v.y})</option>`
  ).join('');
  const targetOptions = DATA.targets.map(t =>
    `<option value="${t.id}">${escHtml(t.name)} (${t.x}|${t.y})</option>`
  ).join('');

  document.getElementById('ma-from').innerHTML   = villageOptions;
  document.getElementById('ma-target').innerHTML = targetOptions;
}

// ══════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════

function applySettings() {
  document.getElementById('cfg-server').value = DATA.settings.serverUrl   || 'es103.guerrastribales.es';
  document.getElementById('cfg-ws').value     = DATA.settings.worldSpeed  || 2;
  document.getElementById('cfg-us').value     = DATA.settings.unitSpeed   || 0.5;
  document.getElementById('cfg-player').value = DATA.settings.playerName  || '';
}

function bindSettings() {
  document.getElementById('cfg-server').addEventListener('input', e => {
    DATA.settings.serverUrl = e.target.value;
    saveData();
    renderAttacks();
  });
  document.getElementById('cfg-ws').addEventListener('change', e => {
    DATA.settings.worldSpeed = parseFloat(e.target.value) || 2;
    saveData();
    renderAttacks();
    if (typeof renderScavenge === 'function') renderScavenge(); // auto world factor follows speed
  });
  document.getElementById('cfg-us').addEventListener('change', e => {
    DATA.settings.unitSpeed = parseFloat(e.target.value) || 0.5;
    saveData();
    renderAttacks();
  });
  document.getElementById('cfg-player').addEventListener('input', e => {
    DATA.settings.playerName = e.target.value.trim();
    saveData();
  });
}

// ══════════════════════════════════════════════
// VILLAGE IMPORT (bookmarklet + paste)
// ══════════════════════════════════════════════

const ATTACK_BOOKMARKLET = `(function(){var tbodies=document.querySelectorAll('tbody.row_marker');if(!tbodies.length){alert('No villages found. Make sure you are on the Mass Recruit page (Overview Villages \u2192 Recruit).');return;}var villages=[];tbodies.forEach(function(tbody){var anyInp=tbody.querySelector('input[name^="units["]');if(!anyInp)return;var m=anyInp.name.match(/units\\[(\\d+)\\]/);if(!m)return;var vid=m[1];var link=tbody.querySelector('td a');if(!link)return;var txt=link.textContent.trim();var cm=txt.match(/\\((\\d+)\\|(\\d+)\\)/);if(!cm)return;var name=txt.replace(/\\s*\\(.*/,'').trim();function get(unit){var inp=tbody.querySelector('input[name="units['+vid+']['+unit+']"]');return inp?parseInt(inp.getAttribute('data-existing'))||0:0;}villages.push({id:vid,name:name,x:parseInt(cm[1]),y:parseInt(cm[2]),axes:get('axe'),lc:get('light'),rams:get('ram'),cats:get('catapult'),nobles:get('snob')});});if(!villages.length){alert('Could not parse any village data.');return;}var json=JSON.stringify({server:location.hostname,villages:villages},null,2);navigator.clipboard.writeText(json).then(function(){alert('Copied '+villages.length+' villages to clipboard! Go paste it in the Attack Planner.');}).catch(function(){alert('Could not copy to clipboard. Try Chrome or Edge.');});})();`;

function initBookmarklet() {
  const link = document.getElementById('bm-link');
  if (link) link.href = 'javascript:' + ATTACK_BOOKMARKLET;
}

function copyBookmarklet() {
  const code = 'javascript:' + ATTACK_BOOKMARKLET;
  navigator.clipboard.writeText(code)
    .then(() => alert(t('alert_bm_copied')))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert(t('alert_bm_copied'));
    });
}

function pasteVillages() {
  navigator.clipboard.readText()
    .then(text => processVillagesJSON(text))
    .catch(() => {
      const text = prompt('Paste the village JSON here:');
      if (text) processVillagesJSON(text);
    });
}

function processVillagesJSON(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed.villages || !Array.isArray(parsed.villages)) {
      alert(t('alert_invalid_format'));
      return;
    }
    if (parsed.server && !DATA.settings.serverUrl) {
      DATA.settings.serverUrl = parsed.server;
      const inp = document.getElementById('server-url');
      if (inp) inp.value = parsed.server;
    }
    let added = 0, updated = 0;
    parsed.villages.forEach(pv => {
      const existing = DATA.villages.find(v =>
        (pv.id && v.villageId === String(pv.id)) ||
        (v.x === parseInt(pv.x) && v.y === parseInt(pv.y))
      );
      if (existing) {
        if (pv.axes   !== undefined) existing.axes   = pv.axes   || 0;
        if (pv.lc     !== undefined) existing.lc     = pv.lc     || 0;
        if (pv.rams   !== undefined) existing.rams   = pv.rams   || 0;
        if (pv.cats   !== undefined) existing.cats   = pv.cats   || 0;
        if (pv.nobles !== undefined) existing.nobles = pv.nobles || 0;
        updated++;
      } else {
        DATA.villages.push({
          id:         uid(),
          name:       pv.name || `(${pv.x}|${pv.y})`,
          villageId:  String(pv.id || ''),
          x:          parseInt(pv.x) || 0,
          y:          parseInt(pv.y) || 0,
          axes:       pv.axes   || 0,
          lc:         pv.lc     || 0,
          rams:       pv.rams   || 0,
          cats:       pv.cats   || 0,
          nobles:     pv.nobles || 0,
        });
        added++;
      }
    });

    // Auto-detect player name from Village DB if not yet set
    if (!DATA.settings.playerName && villageDb.length) {
      const firstId = String(parsed.villages[0]?.id || '');
      const dbEntry = firstId ? villageDb.find(v => v.id === firstId) : null;
      if (dbEntry) {
        const name = playerMap[dbEntry.playerId] || '';
        if (name) {
          DATA.settings.playerName = name;
          document.getElementById('cfg-player').value = name;
        }
      }
    }

    saveData();
    if (typeof cloudSyncPlan === 'function') cloudSyncPlan(); // hosted-site: cloud-save on villages loaded
    renderVillages();
    refreshDropdowns();
    alert(t('alert_import_villages_ok').replace('{added}', added).replace('{updated}', updated));
  } catch(e) {
    alert(t('alert_parse_error') + e.message);
  }
}

function parseRecruitHTML(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const villages = [];
  const seen = new Set();

  doc.querySelectorAll('a[href*="screen=overview"]').forEach(link => {
    const href = link.getAttribute('href') || '';
    const idMatch = href.match(/[?&]village=(\d+)/);
    if (!idMatch) return;
    const villageId = idMatch[1];
    if (seen.has(villageId)) return;
    seen.add(villageId);

    const text = link.textContent.trim();
    const coordMatch = text.match(/\((\d+)\|(\d+)\)/);
    if (!coordMatch) return;

    const getUnit = unit => {
      const inp = doc.querySelector(`input[name="units[${villageId}][${unit}]"]`);
      return inp ? (parseInt(inp.getAttribute('data-existing') || '0') || 0) : 0;
    };

    villages.push({
      id:     villageId,
      name:   text,
      x:      parseInt(coordMatch[1]),
      y:      parseInt(coordMatch[2]),
      axes:   getUnit('axe'),
      lc:     getUnit('light'),
      rams:   getUnit('ram'),
      cats:   getUnit('catapult'),
      nobles: getUnit('snob'),
    });
  });

  return villages;
}

function importFromRecruitHTML(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const villages = parseRecruitHTML(e.target.result);
    if (!villages.length) {
      alert(t('alert_invalid_format'));
      event.target.value = '';
      return;
    }
    let added = 0, updated = 0;
    villages.forEach(pv => {
      const existing = DATA.villages.find(v =>
        (pv.id && v.villageId === pv.id) ||
        (v.x === pv.x && v.y === pv.y)
      );
      if (existing) {
        existing.axes   = pv.axes;
        existing.lc     = pv.lc;
        existing.rams   = pv.rams;
        existing.cats   = pv.cats;
        existing.nobles = pv.nobles;
        updated++;
      } else {
        DATA.villages.push({
          id:        uid(),
          name:      pv.name,
          villageId: pv.id,
          x:         pv.x,
          y:         pv.y,
          axes:      pv.axes,
          lc:        pv.lc,
          rams:      pv.rams,
          cats:      pv.cats,
          nobles:    pv.nobles,
        });
        added++;
      }
    });
    saveData();
    if (typeof cloudSyncPlan === 'function') cloudSyncPlan(); // hosted-site: cloud-save on villages loaded
    renderVillages();
    refreshDropdowns();
    alert(t('alert_import_villages_ok').replace('{added}', added).replace('{updated}', updated));
    event.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

