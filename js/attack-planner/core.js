// attack-planner — DATA state + math/formulas.
// Classic script (2/9): no modules, shared global scope, load order matters — must work
// by double-click (file://). See the <script src> order in attack-planner.html.
'use strict';

// ══════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════

let DATA = {
  settings: { worldSpeed: 2, unitSpeed: 0.5, serverUrl: 'es103.guerrastribales.es', playerName: '', lang: 'en' },
  villages: [],
  targets:  [],
  attacks:  [],
  scavenge: { villages: [], settings: null }   // Scavenging tab (see scavenge.js ensureScavengeState)
};

let villageDb   = [];   // { id, name, x, y, playerId, points }
let playerMap   = {};   // playerId → playerName
let fileHandle  = null;
let dbDirHandle = null;
let dbSearchTimer = null;
let attackSortCol = 'sendAt';
let attackSortDir = 1;

const LS_KEY    = 'tw_attack_planner';
const IDB_FILE  = 'apFileHandle';
const IDB_DB    = 'apDbDir';

// ══════════════════════════════════════════════
// MATH / FORMULAS
// ══════════════════════════════════════════════

// Base minutes/field at world-speed 1, unit-speed 1.
//  off/fake travel at ram speed (30), snob at noble speed (35).
//  sword/axe/lc are optional per-attack timing overrides (see atk.speed) so the
//  user can compute send/landing times at a faster unit's pace — timing only,
//  the send-URL army is unchanged.
const BASE_MIN = { off: 30, fake: 30, snob: 35, axe: 18, sword: 22, lc: 10 };
// Short tags shown next to a row's type badge when a timing-speed override is set.
const SPEED_LABEL = { axe: 'Axe', sword: 'Sword', lc: 'LC' };

// Off power weights (standard TW attack values)
const ATT = { axe: 40, lc: 130, rams: 2, cats: 100, nobles: 30 };
// Tier thresholds
const TIER = { complete: 500000, tq: 350000, half: 250000 };

function calcOffPow(v) {
  return (v.axes||0)*ATT.axe + (v.lc||0)*ATT.lc + (v.rams||0)*ATT.rams + (v.cats||0)*ATT.cats + (v.nobles||0)*ATT.nobles;
}

function offTierBadge(pow) {
  if (pow >= TIER.complete) return `<span class="badge badge-complete">Complete</span>`;
  if (pow >= TIER.tq)       return `<span class="badge badge-tq">3/4</span>`;
  if (pow >= TIER.half)     return `<span class="badge badge-half">1/2</span>`;
  if (pow > 0)              return `<span class="badge badge-low">Low</span>`;
  return `<span class="badge badge-low">—</span>`;
}

function dist(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function travelMs(d, type, ws, us) {
  return d * BASE_MIN[type] / (ws * us) * 60000;
}

// Length of an attack's landing window in ms (0 when no real window — missing, malformed, or
// from === to). Landing time is anchored at windowFrom, so the whole send window is the same
// span shifted back by travel: [sendMs, sendMs + span]. A to < from window (23:00-01:00)
// wraps past midnight.
function windowSpanMs(from, to) {
  const mins = s => { const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim()); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const a = mins(from), b = mins(to);
  if (a == null || b == null || a === b) return 0;
  return ((b - a + 1440) % 1440) * 60000;
}

function computeAttackRow(atk) {
  const village = DATA.villages.find(v => v.id === atk.fromId);
  const target  = DATA.targets.find(t => t.id === atk.targetId);
  const ws = DATA.settings.worldSpeed;
  const us = DATA.settings.unitSpeed;

  if (!village || !target) return null;

  const d      = dist(village, target);
  // Optional per-attack speed override (sword/axe/lc) for timing only; falls back to the type's pace.
  const speedKey = (atk.speed && BASE_MIN[atk.speed]) ? atk.speed : atk.type;
  const tMs    = travelMs(d, speedKey, ws, us);
  const landMs = new Date(atk.landingTime).getTime();
  const sendMs = landMs - tMs;
  // Latest acceptable send: landing anywhere inside the window is on time, so the send window
  // ends a full window-span after the earliest send. Windowless attacks: sendEndMs === sendMs.
  const sendEndMs = sendMs + windowSpanMs(atk.windowFrom, atk.windowTo);
  const url    = buildAttackUrl(
    DATA.settings.serverUrl,
    village.villageId,
    target.villageId,
    atk.type,
    village,
    atk.nobleCount,
    atk.dividedOff
  );
  return { d, tMs, sendMs, sendEndMs, landMs, url };
}

function buildAttackUrl(server, fromVillageId, targetVillageId, type, village, nobleCount, dividedOff = false) {
  const base = `https://${server}/game.php?village=${fromVillageId}&screen=place&target=${targetVillageId}&attack=true`;
  if (type === 'fake') {
    return `${base}&spy=1&ram=1`;
  }
  if (type === 'off') {
    return `${base}&axe=${village.axes||0}&light=${village.lc||0}&ram=${village.rams||0}&catapult=${village.cats||0}`;
  }
  // snob — always send 1 noble per URL; escort = troops divided by noble count
  const nc = Math.max(1, nobleCount || 1);
  return `${base}&snob=1&axe=${Math.floor((village.axes||0)/nc)}&light=${Math.floor((village.lc||0)/nc)}`;
}

function fmtDuration(ms) {
  if (ms < 0) ms = -ms;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function fmtDateLocal(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

function localDatetimeValue(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

