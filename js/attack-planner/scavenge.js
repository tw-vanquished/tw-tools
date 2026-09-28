// attack-planner — Scavenging tab: bookmarklet + page parser + allocation optimizer + render.
// Classic script (8/9): no modules, shared global scope, load order matters — must work
// by double-click (file://). See the <script src> order in attack-planner.html.
'use strict';

// ══════════════════════════════════════════════
// SCAVENGING — model
// ══════════════════════════════════════════════
//
// Game formula (ScavengeScreen constants), verified against real es103 runs:
//   loot_i     = carry_i × LOOT[i]
//   seconds_i  = ( (loot_i² × 100)^0.45 + 1800 ) × worldFactor
// - empty squad → 1800 s × 2^-0.55 = "0:20:29" on a speed-2 world (page preview)
// - 271 spear + 28 sword on option 3 (loot 3597) → 2:43:56, observed ≈ 2 h 43 min
// Duration depends on the LOOT hauled, not on the option: the same troops take
// LONGER on a higher option because they bring more back (there is no per-option
// duration factor — an earlier version multiplied by 15/6/3/2² and was ~2.7× too
// slow on option 3). Equal loot ⇒ equal return time, which is where the classic
// 15:6:3:2 troop split comes from (carry ∝ 1/LOOT). Higher options still win per
// troop AND per hour (loot^0.9 grows slower than loot); splitting only pays because
// four runs go concurrently and each run's resources/hour has diminishing returns.

const SCAV_LOOT = [0.10, 0.25, 0.50, 0.75];
const SCAV_EXP  = 0.45;
const SCAV_INIT = 1800;

// Unit order as the game shows them; carry per unit is world-independent.
const SCAV_UNITS = ['spear', 'sword', 'axe', 'archer', 'light', 'marcher', 'heavy', 'knight'];
const SCAV_CARRY = { spear: 25, sword: 15, axe: 10, archer: 10, light: 80, marcher: 50, heavy: 50, knight: 100 };
// Units that have an icon in icons/units/ (archer/marcher don't — they render as text).
const SCAV_ICON  = { spear: 'spear', sword: 'sword', axe: 'axe', light: 'light', heavy: 'heavy', knight: 'knight' };

// World duration factor when the page didn't give us one: the game scales scavenging
// time by worldSpeed^-0.55 (es100/es103 speed 2 → 0.683).
function scavDefaultFactor(worldSpeed) {
  const ws = parseFloat(worldSpeed) || 1;
  return Math.pow(ws, -0.55);
}

function scavCarryOf(units) {
  let c = 0;
  for (const u of SCAV_UNITS) c += (parseInt(units && units[u]) || 0) * SCAV_CARRY[u];
  return c;
}

function scavSeconds(carry, opt, factor) {
  const loot = carry * SCAV_LOOT[opt];
  return (Math.pow(loot * loot * 100, SCAV_EXP) + SCAV_INIT) * factor;
}

// "h:mm:ss" / "mm:ss" → seconds (game countdowns and previews). null when unparsable.
function scavParseHMS(s) {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
}

function scavFmtSeconds(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ══════════════════════════════════════════════
// SCAVENGING — optimizer
// ══════════════════════════════════════════════
//
// scavOptimize({ units, available, factor, mode, maxSeconds })
//   units      {spear: n, …}      troops we may send (after use/keep filtering)
//   available  [bool ×4]          option unlocked AND idle
//   factor     world duration factor
//   mode       'hour' → maximise Σ loot_i / seconds_i ; 'run' → maximise Σ loot_i
//   maxSeconds 0 = no cap, else every non-empty run must finish within it
// Local search over integer unit moves between the 4 options and "home" (slot 4), with
// descending step sizes (1000/100/10/1) and incremental scoring — a move only touches two
// slots. Starts from everything at home; res/hour always wants every troop out, res/run
// with a cap fills the top option first (every move that adds loot and stays feasible is
// accepted, and there is never a reason to send to a lower option while a higher one has
// room). Single-unit moves can leave a sub-0.5 % packing gap against a duration cap (a 25-carry
// spear vs an 80-carry LC at the ceiling) — irrelevant in-game, so no swap neighbourhood.
// Returns per-option allocations plus derived carry/loot/duration/rate.
function scavOptimize(input) {
  const units = {};
  for (const u of SCAV_UNITS) units[u] = Math.max(0, parseInt(input.units && input.units[u]) || 0);
  const available = (input.available || [true, true, true, true]).map(Boolean);
  const factor = input.factor > 0 ? input.factor : 1;
  const mode = input.mode === 'run' ? 'run' : 'hour';
  const cap = input.maxSeconds > 0 ? input.maxSeconds : 0;
  const HOME = 4;

  const alloc = [{}, {}, {}, {}, { ...units }];
  for (let i = 0; i < 4; i++) for (const u of SCAV_UNITS) alloc[i][u] = 0;
  const carry = [0, 0, 0, 0, 0];
  carry[HOME] = scavCarryOf(units);

  // Contribution of one option slot to the objective; -Infinity when it breaks the cap.
  const contrib = (i, c) => {
    if (i === HOME || c <= 0) return 0;
    const sec = scavSeconds(c, i, factor);
    if (cap && sec > cap) return -Infinity;
    const loot = c * SCAV_LOOT[i];
    return mode === 'hour' ? loot / sec * 3600 : loot;
  };
  const contribs = carry.map((c, i) => contrib(i, c));
  const EPS = 1e-9;
  const STEPS = [1000, 100, 10, 1];
  let guard = 0;

  for (;;) {
    let improved = false;
    for (const step of STEPS) {
      for (const u of SCAV_UNITS) {
        for (let from = 0; from <= HOME; from++) {
          if (alloc[from][u] <= 0) continue;
          for (let to = 0; to <= HOME; to++) {
            if (to === from) continue;
            if (to !== HOME && !available[to]) continue;
            const k = Math.min(step, alloc[from][u]);
            if (k <= 0) continue;
            const dc = k * SCAV_CARRY[u];
            const nf = contrib(from, carry[from] - dc);
            const nt = contrib(to, carry[to] + dc);
            if (nf + nt > contribs[from] + contribs[to] + EPS) {
              alloc[from][u] -= k; alloc[to][u] += k;
              carry[from] -= dc; carry[to] += dc;
              contribs[from] = nf; contribs[to] = nt;
              improved = true;
              if (++guard > 200000) improved = false; // safety valve, never expected
            }
          }
        }
      }
    }
    if (!improved) break;
  }

  const options = [];
  let totalLoot = 0, totalRate = 0, longest = 0;
  for (let i = 0; i < 4; i++) {
    const c = carry[i];
    const loot = c * SCAV_LOOT[i];
    const sec = c > 0 ? scavSeconds(c, i, factor) : 0;
    const rate = c > 0 ? loot / sec * 3600 : 0;
    totalLoot += loot; totalRate += rate; if (sec > longest) longest = sec;
    options.push({
      n: i + 1, available: available[i], units: alloc[i], carry: c,
      loot, perRes: Math.floor(loot / 3), seconds: sec, perHour: rate,
    });
  }
  return { options, home: alloc[HOME], totalLoot, totalPerHour: totalRate, longestSeconds: longest };
}

// ══════════════════════════════════════════════
// SCAVENGING — page parser (shared by file import; the bookmarklet mirrors it)
// ══════════════════════════════════════════════

// Parse a saved rally-point Scavenging page (Document) into an import record.
// Reads only what the page shows: units at home, the state of the four options,
// and the empty-squad duration preview (= 1800 s × world factor).
function parseScavengePage(doc, url) {
  const root = doc.getElementById('scavenge_screen') || doc.querySelector('.scavenge-screen-main-widget');
  if (!root) return null;
  const units = {};
  root.querySelectorAll('a.units-entry-all[data-unit]').forEach(a => {
    const m = /\d+/.exec(a.textContent || '');
    units[a.getAttribute('data-unit')] = m ? parseInt(m[0]) : 0;
  });
  if (!Object.keys(units).length) return null;

  let allEmpty = true;
  root.querySelectorAll('input.unitsInput').forEach(inp => { if ((parseInt(inp.value) || 0) > 0) allEmpty = false; });

  const options = [];
  root.querySelectorAll('.scavenge-option').forEach((o, i) => {
    let state = 'unlocking';
    if (o.querySelector('.inactive-view')) state = 'free';
    else if (o.querySelector('.active-view')) state = 'busy';
    else if (o.querySelector('.locked-view')) state = 'locked';
    const rc = o.querySelector('.return-countdown');
    const title = o.querySelector('.title');
    options.push({ n: i + 1, title: title ? title.textContent.trim() : '', state, returnIn: rc ? rc.textContent.trim() : '' });
  });

  let baseDuration = null;
  if (allEmpty) {
    const d = root.querySelector('.inactive-view .duration');
    if (d) baseDuration = d.textContent.trim();
  }

  const navLink = doc.querySelector('a[href*="mode=scavenge"]');
  const href = url || (navLink ? navLink.getAttribute('href') : '') || '';
  const vid = (/[?&]village=(\d+)/.exec(href) || [])[1] || '';
  const title = (doc.querySelector('title') || {}).textContent || '';
  const cm = /^(.*?)\s*\((\d+)\|(\d+)\)/.exec(title.trim());
  const village = { id: vid, name: cm ? cm[1].trim() : '', x: cm ? parseInt(cm[2]) : 0, y: cm ? parseInt(cm[3]) : 0 };
  const server = (/https?:\/\/([^/]+)/.exec(href) || [])[1] || '';
  return { kind: 'scavenge', server, village, units, options, baseDuration };
}

// Chrome "Webpage, Single File" (.mhtml) → the decoded HTML of its first text/html part.
// Quoted-printable: soft line breaks "=\r\n" vanish, "=XX" is a raw byte; bytes are UTF-8.
function decodeMhtmlHtml(text) {
  const bm = /boundary="?([^"\r\n;]+)"?/i.exec(text);
  if (!bm) return null;
  const parts = text.split('--' + bm[1]);
  for (const part of parts) {
    const hdrEnd = part.search(/\r?\n\r?\n/);
    if (hdrEnd < 0) continue;
    const headers = part.slice(0, hdrEnd);
    if (!/content-type:\s*text\/html/i.test(headers)) continue;
    let body = part.slice(hdrEnd).replace(/^\r?\n\r?\n/, '');
    if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
      body = body.replace(/=\r?\n/g, '');
      const bytes = [];
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(body.substr(i + 1, 2))) {
          bytes.push(parseInt(body.substr(i + 1, 2), 16)); i += 2;
        } else {
          const code = ch.charCodeAt(0);
          bytes.push(code < 256 ? code : 63);
        }
      }
      try { body = new TextDecoder('utf-8').decode(new Uint8Array(bytes)); }
      catch (_) { body = String.fromCharCode.apply(null, bytes); }
    } else if (/content-transfer-encoding:\s*base64/i.test(headers)) {
      try { body = new TextDecoder('utf-8').decode(Uint8Array.from(atob(body.replace(/\s+/g, '')), c => c.charCodeAt(0))); }
      catch (_) { /* leave as-is */ }
    }
    return body;
  }
  return null;
}

// The bookmarklet — runs on TW's rally point → Scavenging page and copies the same record
// parseScavengePage() builds (plus game_data village info when the page exposes it).
// Read-only: it never touches inputs, never sends anything.
const SCAVENGE_BOOKMARKLET = `(function(){var root=document.getElementById('scavenge_screen');if(!root){alert('Open the Rally Point → Scavenging page first.');return;}var units={};root.querySelectorAll('a.units-entry-all[data-unit]').forEach(function(a){var m=/\\d+/.exec(a.textContent||'');units[a.getAttribute('data-unit')]=m?parseInt(m[0]):0;});var allEmpty=true;root.querySelectorAll('input.unitsInput').forEach(function(i){if((parseInt(i.value)||0)>0)allEmpty=false;});var options=[];root.querySelectorAll('.scavenge-option').forEach(function(o,i){var st='unlocking';if(o.querySelector('.inactive-view'))st='free';else if(o.querySelector('.active-view'))st='busy';else if(o.querySelector('.locked-view'))st='locked';var rc=o.querySelector('.return-countdown');var t=o.querySelector('.title');options.push({n:i+1,title:t?t.textContent.trim():'',state:st,returnIn:rc?rc.textContent.trim():''});});var base=null;if(allEmpty){var d=root.querySelector('.inactive-view .duration');if(d)base=d.textContent.trim();}var vid=(/[?&]village=(\\d+)/.exec(location.search)||[])[1]||'';var cm=/^(.*?)\\s*\\((\\d+)\\|(\\d+)\\)/.exec(document.title.trim());var village={id:vid,name:cm?cm[1].trim():'',x:cm?parseInt(cm[2]):0,y:cm?parseInt(cm[3]):0};try{if(window.game_data&&game_data.village){village.id=String(game_data.village.id);village.name=game_data.village.name;village.x=parseInt(game_data.village.x);village.y=parseInt(game_data.village.y);}}catch(e){}var json=JSON.stringify({kind:'scavenge',server:location.hostname,village:village,units:units,options:options,baseDuration:base,capturedAt:new Date().toISOString()},null,2);navigator.clipboard.writeText(json).then(function(){alert('Copied scavenging data for '+(village.name||'this village')+' to clipboard! Go paste it in the Attack Planner → Scavenging tab.');}).catch(function(){alert('Could not copy to clipboard. Try Chrome or Edge.');});})();`;

// ══════════════════════════════════════════════
// SCAVENGING — state
// ══════════════════════════════════════════════

function scavDefaultSettings() {
  const use = {}, keep = {};
  for (const u of SCAV_UNITS) { use[u] = u !== 'knight'; keep[u] = 0; }
  return { mode: 'hour', maxHours: 0, factorOverride: null, use, keep, selected: '' };
}

// Called from loadData()/handleImport(): make DATA.scavenge well-formed.
function ensureScavengeState() {
  if (!DATA.scavenge || typeof DATA.scavenge !== 'object') DATA.scavenge = {};
  if (!Array.isArray(DATA.scavenge.villages)) DATA.scavenge.villages = [];
  const def = scavDefaultSettings();
  const s = DATA.scavenge.settings = { ...def, ...(DATA.scavenge.settings || {}) };
  s.use  = { ...def.use,  ...(s.use  || {}) };
  s.keep = { ...def.keep, ...(s.keep || {}) };
  if (s.mode !== 'run') s.mode = 'hour';
  s.maxHours = Math.max(0, parseFloat(s.maxHours) || 0);
  // v1.9.0 stored the override as a WORLD SPEED (a typed "2" doubled every duration —
  // 116 spears on option 1 read 1:43:33 instead of the game's 0:35:22); v1.9.1 redefined the
  // field as a duration factor but left the old value in place. Drop any override saved
  // before that change; the stamp keeps this a one-time migration.
  if (s.factorVersion !== 2) { s.factorOverride = null; s.factorVersion = 2; }
  return DATA.scavenge;
}

// Merge one import record (bookmarklet JSON or parsed page) into DATA.scavenge.villages.
// Villages are keyed by villageId, falling back to coords. Returns the stored village.
function upsertScavengeVillage(rec) {
  const st = ensureScavengeState();
  const v = rec.village || {};
  const id = String(v.id || '');
  const x = parseInt(v.x) || 0, y = parseInt(v.y) || 0;
  const units = {};
  for (const u of SCAV_UNITS) if (rec.units && rec.units[u] !== undefined) units[u] = parseInt(rec.units[u]) || 0;
  const baseSec = scavParseHMS(rec.baseDuration);
  const entry = {
    villageId: id,
    name: v.name || (x && y ? `(${x}|${y})` : ''),
    x, y,
    units,
    options: Array.isArray(rec.options) && rec.options.length ? rec.options.map((o, i) => ({
      n: o.n || i + 1, title: o.title || '', state: o.state || 'free', returnIn: o.returnIn || '',
    })) : [1, 2, 3, 4].map(n => ({ n, title: '', state: 'free', returnIn: '' })),
    baseDurationSec: baseSec,
    server: rec.server || '',
    capturedAt: rec.capturedAt || new Date().toISOString(),
  };
  const idx = st.villages.findIndex(e => (id && e.villageId === id) || (x && y && e.x === x && e.y === y));
  if (idx >= 0) st.villages[idx] = entry; else st.villages.push(entry);
  st.settings.selected = entry.villageId || `${x}|${y}`;
  return entry;
}

function scavVillageKey(v) { return v.villageId || `${v.x}|${v.y}`; }

function scavSelectedVillage() {
  const st = ensureScavengeState();
  if (!st.villages.length) return null;
  return st.villages.find(v => scavVillageKey(v) === st.settings.selected) || st.villages[0];
}

// World factor for a village: the page's empty-squad preview wins, then a manual override,
// then worldSpeed^-0.55 from the top bar.
function scavFactorFor(v) {
  const s = ensureScavengeState().settings;
  if (s.factorOverride > 0) return { factor: s.factorOverride, source: 'override' };
  if (v && v.baseDurationSec > 0) return { factor: v.baseDurationSec / SCAV_INIT, source: 'page' };
  return { factor: scavDefaultFactor(DATA.settings.worldSpeed), source: 'speed' };
}

// Troops actually sent for a village under the current use/keep toggles.
function scavSendableUnits(v) {
  const s = ensureScavengeState().settings;
  const out = {};
  for (const u of SCAV_UNITS) {
    if (!v.units || v.units[u] === undefined) continue;
    const have = parseInt(v.units[u]) || 0;
    out[u] = s.use[u] ? Math.max(0, have - (parseInt(s.keep[u]) || 0)) : 0;
  }
  return out;
}

// Full computation for one village under the current settings → what the table renders.
function computeScavengePlan(v) {
  const s = ensureScavengeState().settings;
  const { factor, source } = scavFactorFor(v);
  const sendable = scavSendableUnits(v);
  const available = [0, 1, 2, 3].map(i => {
    const o = (v.options || [])[i];
    return o ? o.state === 'free' : true;
  });
  const maxSeconds = s.maxHours > 0 ? s.maxHours * 3600 : 0;
  const result = scavOptimize({ units: sendable, available, factor, mode: s.mode, maxSeconds });
  // Comparison: everything into the best free option (what most people do).
  let topIdx = -1;
  for (let i = 3; i >= 0; i--) if (available[i]) { topIdx = i; break; }
  let allIn = null;
  if (topIdx >= 0) {
    const c = scavCarryOf(sendable);
    if (c > 0) {
      const sec = scavSeconds(c, topIdx, factor);
      allIn = { n: topIdx + 1, loot: c * SCAV_LOOT[topIdx], seconds: sec, perHour: c * SCAV_LOOT[topIdx] / sec * 3600 };
    }
  }
  return { ...result, sendable, available, factor, factorSource: source, maxSeconds, allIn };
}

// ══════════════════════════════════════════════
// SCAVENGING — import actions
// ══════════════════════════════════════════════

function initScavengeBookmarklet() {
  const link = document.getElementById('bm-scav-link');
  if (link) link.href = 'javascript:' + SCAVENGE_BOOKMARKLET;
}

function copyScavengeBookmarklet() {
  const code = 'javascript:' + SCAVENGE_BOOKMARKLET;
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

function pasteScavenge() {
  navigator.clipboard.readText()
    .then(text => processScavengeJSON(text))
    .catch(() => {
      const text = prompt(t('scav_paste_prompt'));
      if (text) processScavengeJSON(text);
    });
}

function processScavengeJSON(text) {
  let rec;
  try { rec = JSON.parse(text); }
  catch (e) { alert(t('alert_parse_error') + e.message); return; }
  if (!rec || rec.kind !== 'scavenge' || !rec.units) { alert(t('scav_alert_invalid')); return; }
  const v = upsertScavengeVillage(rec);
  if (rec.server && !DATA.settings.serverUrl) DATA.settings.serverUrl = rec.server;
  saveData();
  renderScavenge();
  alert(t('scav_alert_imported').replace('{name}', v.name || v.villageId));
}

function importScavengeFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let html = e.target.result;
    if (/\.mhtml?$/i.test(file.name) || /^From:|^MIME-Version:/m.test(html.slice(0, 2000))) {
      const decoded = decodeMhtmlHtml(html);
      if (decoded) html = decoded;
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Content-Location / canonical link carries the village id when the file was saved from TW.
    const locM = /Content-Location:\s*(\S+)/i.exec(e.target.result.slice(0, 4000));
    const rec = parseScavengePage(doc, locM ? locM[1] : '');
    event.target.value = '';
    if (!rec) { alert(t('scav_alert_invalid')); return; }
    const v = upsertScavengeVillage(rec);
    saveData();
    renderScavenge();
    alert(t('scav_alert_imported').replace('{name}', v.name || v.villageId));
  };
  reader.readAsText(file, 'UTF-8');
}

function removeScavengeVillage() {
  const st = ensureScavengeState();
  const v = scavSelectedVillage();
  if (!v) return;
  if (!confirm(t('scav_confirm_remove').replace('{name}', v.name || v.villageId))) return;
  st.villages = st.villages.filter(e => e !== v);
  st.settings.selected = st.villages.length ? scavVillageKey(st.villages[0]) : '';
  saveData();
  renderScavenge();
}

function clearScavenge() {
  if (!confirm(t('scav_confirm_clear'))) return;
  ensureScavengeState().villages = [];
  ensureScavengeState().settings.selected = '';
  saveData();
  renderScavenge();
}

// ══════════════════════════════════════════════
// SCAVENGING — settings handlers (all re-render live)
// ══════════════════════════════════════════════

function scavSelectVillage(key) {
  ensureScavengeState().settings.selected = key;
  saveData();
  renderScavenge();
}
function scavSetMode(mode) {
  ensureScavengeState().settings.mode = mode === 'run' ? 'run' : 'hour';
  saveData();
  renderScavenge();
}
function scavSetMaxHours(val) {
  ensureScavengeState().settings.maxHours = Math.max(0, parseFloat(val) || 0);
  saveData();
  renderScavenge(true);
}
function scavSetFactorOverride(val) {
  const f = parseFloat(val);
  ensureScavengeState().settings.factorOverride = f > 0 ? f : null;
  saveData();
  renderScavenge(true);
}
function scavToggleUnit(unit, on) {
  ensureScavengeState().settings.use[unit] = !!on;
  saveData();
  renderScavenge();
}
function scavSetKeep(unit, val) {
  ensureScavengeState().settings.keep[unit] = Math.max(0, parseInt(val) || 0);
  saveData();
  renderScavenge(true);
}
function scavUseAll(on) {
  const s = ensureScavengeState().settings;
  for (const u of SCAV_UNITS) s.use[u] = !!on;
  saveData();
  renderScavenge();
}

// ══════════════════════════════════════════════
// SCAVENGING — render
// ══════════════════════════════════════════════

function scavUnitLabel(u) { return t('scav_unit_' + u); }
function scavUnitIcon(u) {
  return SCAV_ICON[u]
    ? `<img class="scav-unit-icon" src="icons/units/${SCAV_ICON[u]}.png" alt="" title="${escHtml(scavUnitLabel(u))}"> `
    : '';
}
function scavOptionName(v, i) {
  const o = (v && v.options || [])[i];
  return (o && o.title) || t('scav_opt_' + (i + 1));
}
function scavStateBadge(state, returnIn) {
  if (state === 'free')   return `<span class="badge badge-complete">${t('scav_state_free')}</span>`;
  if (state === 'busy')   return `<span class="badge badge-half">${t('scav_state_busy')}${returnIn ? ' · ' + escHtml(returnIn) : ''}</span>`;
  if (state === 'locked') return `<span class="badge badge-low">${t('scav_state_locked')}</span>`;
  return `<span class="badge badge-tq">${t('scav_state_unlocking')}</span>`;
}
function scavFmtNum(n) { return Math.round(n).toLocaleString(currentLang === 'es' ? 'es-ES' : 'en-US'); }
function scavAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!(ms >= 0)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 60) return t('scav_age_min').replace('{n}', m);
  const h = Math.floor(m / 60);
  if (h < 48) return t('scav_age_h').replace('{n}', h);
  return t('scav_age_d').replace('{n}', Math.floor(h / 24));
}

// `keepFocus` = the change came from a text input being typed in: rebuild only the results,
// leave the settings/unit panel DOM alone so the caret stays where it is.
function renderScavenge(keepFocus) {
  const tab = document.getElementById('tab-scavenge');
  if (!tab) return;
  const st = ensureScavengeState();
  const s = st.settings;
  const v = scavSelectedVillage();

  const selEl = document.getElementById('scav-village-select');
  const emptyEl = document.getElementById('scav-empty');
  const bodyEl = document.getElementById('scav-body');
  if (!v) {
    if (selEl) selEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    if (bodyEl) bodyEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (bodyEl) bodyEl.style.display = '';

  if (selEl && !keepFocus) {
    selEl.innerHTML = st.villages.map(e => {
      const key = scavVillageKey(e);
      const label = `${e.name || key} (${e.x}|${e.y})`;
      return `<option value="${escHtml(key)}"${e === v ? ' selected' : ''}>${escHtml(label)}</option>`;
    }).join('');
  }
  const metaEl = document.getElementById('scav-village-meta');
  if (metaEl) {
    metaEl.textContent = `${t('scav_captured')} ${scavAge(v.capturedAt)}` + (v.server ? ` · ${v.server}` : '');
  }

  const plan = computeScavengePlan(v);

  // ── Settings panel (mode / cap / factor) ──
  if (!keepFocus) {
    const hourEl = document.getElementById('scav-mode-hour');
    const runEl  = document.getElementById('scav-mode-run');
    if (hourEl) hourEl.checked = s.mode === 'hour';
    if (runEl)  runEl.checked  = s.mode === 'run';
    const mh = document.getElementById('scav-max-hours');
    if (mh) mh.value = s.maxHours > 0 ? s.maxHours : '';
    const fo = document.getElementById('scav-factor');
    if (fo) fo.value = s.factorOverride > 0 ? s.factorOverride : '';
  }
  const fInfo = document.getElementById('scav-factor-info');
  if (fInfo) {
    const src = plan.factorSource === 'page' ? t('scav_factor_from_page')
      : plan.factorSource === 'override' ? t('scav_factor_override') : t('scav_factor_from_speed');
    // A factor > 1 on a speed > 1 world is almost certainly a world speed typed by mistake.
    const ws = parseFloat(DATA.settings.worldSpeed) || 1;
    const suspicious = plan.factorSource === 'override' && ws > 1 && plan.factor > 1;
    fInfo.textContent = `${plan.factor.toFixed(4)} — ${src}` + (suspicious ? ` ⚠ ${t('scav_factor_looks_speed')}` : '');
    fInfo.classList.toggle('text-warn', suspicious);
  }

  // ── Units panel: one column per unit type the page had ──
  const unitsEl = document.getElementById('scav-units');
  const unitList = SCAV_UNITS.filter(u => v.units && v.units[u] !== undefined);
  if (unitsEl && !keepFocus) {
    unitsEl.innerHTML = unitList.map(u => {
      const have = parseInt(v.units[u]) || 0;
      const on = !!s.use[u];
      return `<div class="scav-unit${on ? '' : ' scav-unit-off'}">
        <label class="scav-unit-head" title="${escHtml(scavUnitLabel(u))}">
          <input type="checkbox" ${on ? 'checked' : ''} onchange="scavToggleUnit('${u}', this.checked)">
          ${scavUnitIcon(u)}<span>${escHtml(scavUnitLabel(u))}</span>
        </label>
        <div class="scav-unit-have">${scavFmtNum(have)} <span class="text-dim">× ${SCAV_CARRY[u]}</span></div>
        <div class="scav-unit-keep">
          <span>${t('scav_keep')}</span>
          <input type="number" min="0" value="${parseInt(s.keep[u]) || 0}" oninput="scavSetKeep('${u}', this.value)" ${on ? '' : 'disabled'}>
        </div>
        <div class="scav-unit-send" id="scav-send-${u}"></div>
      </div>`;
    }).join('');
  }
  for (const u of unitList) {
    const el = document.getElementById('scav-send-' + u);
    if (el) el.innerHTML = `${t('scav_sending')} <strong>${scavFmtNum(plan.sendable[u] || 0)}</strong>`;
  }

  // ── Results table ──
  const tbody = document.getElementById('scav-results-tbody');
  const thead = document.getElementById('scav-results-thead');
  if (thead) {
    thead.innerHTML = `<tr>
      <th>${t('scav_col_option')}</th>
      ${unitList.map(u => `<th class="scav-col-unit">${scavUnitIcon(u)}${SCAV_ICON[u] ? '' : escHtml(scavUnitLabel(u))}</th>`).join('')}
      <th>${t('scav_col_carry')}</th>
      <th>${t('scav_col_loot')}</th>
      <th>${t('scav_col_duration')}</th>
      <th>${t('scav_col_rate')}</th>
    </tr>`;
  }
  if (tbody) {
    const rows = plan.options.map((o, i) => {
      const optState = (v.options || [])[i] || { state: 'free' };
      const empty = o.carry <= 0;
      const unitCells = unitList.map(u => `<td class="scav-num${o.units[u] ? '' : ' text-dim'}">${o.units[u] ? scavFmtNum(o.units[u]) : '—'}</td>`).join('');
      return `<tr class="${o.available ? '' : 'scav-row-unavailable'}">
        <td><div class="scav-opt-name">${escHtml(scavOptionName(v, i))}</div>${scavStateBadge(optState.state, optState.returnIn)}</td>
        ${unitCells}
        <td class="scav-num">${empty ? '—' : scavFmtNum(o.carry)}</td>
        <td class="scav-num">${empty ? '—' : `<strong>${scavFmtNum(o.loot)}</strong><div class="scav-perres">${scavFmtNum(o.perRes)} / ${scavFmtNum(o.perRes)} / ${scavFmtNum(o.perRes)}</div>`}</td>
        <td class="scav-num">${empty ? '—' : scavFmtSeconds(o.seconds)}</td>
        <td class="scav-num">${empty ? '—' : scavFmtNum(o.perHour)}</td>
      </tr>`;
    });
    const homeCells = unitList.map(u => `<td class="scav-num text-dim">${plan.home[u] ? scavFmtNum(plan.home[u]) : '—'}</td>`).join('');
    const homeAny = unitList.some(u => plan.home[u] > 0);
    if (homeAny) {
      rows.push(`<tr class="scav-row-home"><td>${t('scav_row_home')}</td>${homeCells}<td class="scav-num text-dim">${scavFmtNum(scavCarryOf(plan.home))}</td><td></td><td></td><td></td></tr>`);
    }
    rows.push(`<tr class="scav-row-total"><td>${t('scav_row_total')}</td>${unitList.map(() => '<td></td>').join('')}
      <td class="scav-num">${scavFmtNum(plan.options.reduce((a, o) => a + o.carry, 0))}</td>
      <td class="scav-num"><strong>${scavFmtNum(plan.totalLoot)}</strong></td>
      <td class="scav-num">${plan.longestSeconds > 0 ? scavFmtSeconds(plan.longestSeconds) : '—'}</td>
      <td class="scav-num"><strong>${scavFmtNum(plan.totalPerHour)}</strong></td></tr>`);
    tbody.innerHTML = rows.join('');
  }

  // ── Summary / comparison line ──
  const sumEl = document.getElementById('scav-summary');
  if (sumEl) {
    const parts = [];
    if (plan.options.every(o => o.carry <= 0)) {
      parts.push(plan.available.some(Boolean) ? t('scav_no_troops') : t('scav_no_options'));
    } else {
      if (plan.allIn && plan.allIn.perHour > 0) {
        const gain = plan.totalPerHour / plan.allIn.perHour - 1;
        parts.push(t('scav_vs_allin')
          .replace('{opt}', scavOptionName(v, plan.allIn.n - 1))
          .replace('{rate}', scavFmtNum(plan.allIn.perHour))
          .replace('{loot}', scavFmtNum(plan.allIn.loot))
          .replace('{dur}', scavFmtSeconds(plan.allIn.seconds))
          .replace('{gain}', (gain >= 0 ? '+' : '') + Math.round(gain * 100) + '%'));
      }
      if (plan.maxSeconds > 0 && plan.options.some(o => o.carry > 0 && o.seconds > plan.maxSeconds + 1)) {
        parts.push(t('scav_cap_violated'));
      } else if (plan.maxSeconds > 0 && Object.values(plan.home).some(n => n > 0)) {
        parts.push(t('scav_cap_home'));
      }
    }
    sumEl.innerHTML = parts.map(p => `<p>${p}</p>`).join('');
  }
}
