// ══════════════════════════════════════════════════════════════
// REPORTS INTEL (pure logic — no DOM; UI lives in reports-ui.js)
// ──────────────────────────────────────────────────────────────
// Enemy-village intelligence built from reportsExport.js JSON exports
// (tw-reports-*.json). Each report contributes facts about up to two
// villages:
//   • the DEFENDER village: troops seen at home (defenderTroops), troops
//     away (defenderTroopsAway), and whether espionage succeeded
//     (resources/buildings present). Espionage is TIERED: resources/buildings
//     show up even when the spies took losses, but the game only renders the
//     units-outside block when ≥90% of the attacking spies survived. So spy
//     data with NO away table proves "nothing outside" (KNOWN-EMPTY) only
//     when the spies came back intact (riSpiesIntact); below that the game
//     HID the block — away stays unknown.
//   • the ATTACKER village: what it SENT (attackerTroops). A village that
//     fired a real off army is confirmed OFF even if never scouted — this
//     is the one signal defense reports give us about enemy villages.
//
// Classification adapts FastNotesByRaba's calc(): OFF pool = axe/light/
// marcher/ram, DEF pool = spear/sword/archer/heavy, thresholds 500 / 20000.
// `sure:false` marks the caveat the whole feature is designed around: a
// village showing only defence AT HOME, with its away troops unseen, might
// still be an off village whose army is outbound.
//
// The store is context-free (it also keeps facts about own-tribe villages);
// filtering "enemy only" and ownership-staleness checks happen at render
// time against the world DB. All ids are compared as STRINGS — villageDb
// keeps ids as strings while the report JSON carries numbers.
// ══════════════════════════════════════════════════════════════

const RI_MIN = 500;    // FastNotes minValue — an army worth talking about
const RI_MAX = 20000;  // FastNotes maxValue — a "blindado" (armored) stack
const RI_OFF_POOL = ['axe', 'light', 'marcher', 'ram'];
const RI_DEF_POOL = ['spear', 'sword', 'archer', 'heavy'];
// Farm pop per unit — the size metric behind `sentBig` (v5.8.0). Deliberately a LOCAL copy
// (constants.js POP): this file is also loaded standalone by the twstats pages, which don't
// load constants.js. Unknown units count 1 so a new unit never zeroes an army's size.
const RI_POP = { spear: 1, sword: 1, axe: 1, archer: 1, spy: 2, light: 4, marcher: 5, heavy: 6, ram: 5, catapult: 8, knight: 10, snob: 100 };
// `sentCat` (v5.8.0): an attack is a CATA STRIKE when it carries at least RI_CAT_MIN
// catapults WITHOUT being a regular ram off (ram >= RI_CAT_RAM_OFF) — def villages sending
// heavy+cats, cats alone (+spies), or an off split into building-damage slices all qualify;
// a real nuke's escort cats don't.
const RI_CAT_MIN = 50;
const RI_CAT_RAM_OFF = 200;
// `dead`/`alive` (2026-08-18, twstats "Tropas muertas"): a battle can prove a village's
// troops DEAD — as defender when the attacker won (every fought unit died) and the same
// report's clean espionage confirmed nothing outside; as attacker when its whole army was
// annihilated. Only a real army qualifies on the attacker side — the floor was raised
// 1000 → 5000 the same day (user call after auditing the first rebuild: 11% of flags came
// from 1-3k cat-splash fakes dying against stacks, which proves nothing about the village;
// half-nuke-or-bigger deaths are the intel). Retraction is deliberately EASIER than
// flagging (RI_ALIVE_MIN stays low): a wrong "dead" claim costs more than a lost flag.
// Facts stay observations: the client compares dead.t vs alive.t at render time.
const RI_DEAD_MIN = 5000;  // farm pop — only a half-nuke-or-bigger wipe flags a village
const RI_ALIVE_MIN = 1000; // farm pop — survivors above this retract a dead claim

function riSum(units, pool) {
  if (!units) return 0;
  return pool.reduce((s, u) => s + (+units[u] || 0), 0);
}
// Total farm pop of an army — `sentBig`'s ordering metric.
function riPop(units) {
  if (!units) return 0;
  return Object.keys(units).reduce((s, u) => s + (+units[u] || 0) * (RI_POP[u] || 1), 0);
}
function riTotal(units) {
  if (!units) return 0;
  return Object.keys(units).reduce((s, u) => s + (+units[u] || 0), 0);
}

function riEmptyStore() {
  return { ids: {}, villages: {} };
}

// Keep only positive numeric unit counts (report fields are all optional).
function riUnits(u) {
  const out = {};
  if (u) for (const k in u) { const n = +u[k]; if (n > 0) out[k] = n; }
  return out;
}

// TW renders the units-outside block only when the espionage was CLEAN: at
// least 90% of the attacking spies survived. Below that the report still
// shows resources/buildings but HIDES the away block, so a missing away
// table only proves "nothing outside" when the spies came back (nearly)
// intact. No spy count in the record ⇒ can't verify ⇒ never confirm.
function riSpiesIntact(r) {
  const sent = r.attackerTroops ? (+r.attackerTroops.spy || 0) : 0;
  if (!sent) return false;
  const lost = r.attackerLosses ? (+r.attackerLosses.spy || 0) : 0;
  return (sent - lost) / sent >= 0.9;
}

// Merge an array of reportsExport records into the store. Dedupe is by
// world:reportId (same report uploaded twice, or present in two exports).
// Per village, each SECTION keeps the newest observation independently —
// a fresh attack report updates `home` without wiping an older scout's
// `away`. `sent` instead keeps the LARGEST off pool seen (a later 1-ram
// fake from the same village must not erase its earlier nuke).
function riMergeReports(store, reports) {
  const stats = { added: 0, dupes: 0, invalid: 0 };
  if (!Array.isArray(reports)) reports = reports ? [reports] : [];

  for (const r of reports) {
    if (!r || typeof r !== 'object') { stats.invalid++; continue; }
    const key = (r.world || '?') + ':' + (r.reportId ||
      ((r.reportTimestamp || 0) + ':' + (r.defenderVillageId || r.attackerVillageId || '')));
    if (store.ids[key]) { stats.dupes++; continue; }
    const t = +r.reportTimestamp || 0;
    let used = false;

    // ── Defender village: what it HOLDS ──
    if (typeof r.defenderX === 'number' && typeof r.defenderY === 'number') {
      const v = riVillage(store, r.defenderX + '|' + r.defenderY);
      riIdentity(v, t, r.defenderVillageId, r.defenderVillageName, r.defenderPlayerId, r.defenderPlayerName);
      const spied = !!(r.resources || r.buildings);
      // A spied report with NO troops row means the garrison was EMPTY (zero
      // counts are dropped by reportsExport's clean()) — a successful spy
      // always reveals home troops, so that's known-empty, not unknown.
      if ((r.defenderTroops || spied) && (!v.home || t >= v.home.t)) {
        v.home = { units: riUnits(r.defenderTroops), t, spied };
      }
      if (r.defenderTroopsAway) {
        if (!v.away || t >= v.away.t) v.away = { units: riUnits(r.defenderTroopsAway), t };
      } else if (spied && riSpiesIntact(r)) {
        // clean spy run with no away table ⇒ confirmed nothing outside
        // (<90% survival means the game hid the block — away stays unknown)
        if (!v.away || t >= v.away.t) v.away = { units: {}, t, empty: true };
      }
      if (r.buildings && (!v.bld || t >= v.bld.t)) {
        const levels = {};
        for (const k in r.buildings) { const n = +r.buildings[k]; if (n > 0) levels[k] = n; }
        if (Object.keys(levels).length) v.bld = { levels, t };
      }
      // 💀 dead (defender side): every unit that fought died AND this same
      // report proves nothing was outside (clean-spy known-empty) — the whole
      // village's army is gone as of t. An away table with units, or any
      // survivor, records `alive` instead (survivors may be support — enough
      // to retract a dead claim, never proof of whose troops they are).
      const dq = riUnits(r.defenderTroops);
      const dl = r.defenderLosses || {};
      const dFought = Object.keys(dq).length > 0;
      const dAllDied = dFought && Object.keys(dq).every((u) => (+dl[u] || 0) >= dq[u]);
      if (dAllDied && !r.defenderTroopsAway && spied && riSpiesIntact(r)) {
        if (!v.dead || t >= v.dead.t) v.dead = { t, kind: 'def', pop: riPop(dq) };
      }
      if ((dFought && !dAllDied) || riTotal(riUnits(r.defenderTroopsAway)) > 0) {
        if (!v.alive || t >= v.alive.t) v.alive = { t };
      }
      used = true;
    }

    // ── Attacker village: what it SENDS ──
    // Three independent slots (each carries `pid` = the attacker player at send time, so
    // the Worker's protected-tribe filter can judge WHOSE army a section describes — these
    // slots outlive conquests, unlike home/away, which newest-wins replaces):
    //   sent    — largest OFF pool (a later 1-ram fake must not erase nuke evidence)
    //   sentBig — largest army by FARM POP regardless of type (v5.8.0: a def village's
    //             heavy+cats strike is invisible to `sent` — off ≈ 0 — yet it's exactly
    //             what the Village Reports row must surface)
    //   sentCat — largest CATA STRIKE (cat ≥ 50, ram < 200; see RI_CAT_MIN) + `n` = how
    //             many distinct reports showed one (feeds twstats' CATAS tag)
    if (typeof r.attackerX === 'number' && typeof r.attackerY === 'number' && r.attackerTroops) {
      const v = riVillage(store, r.attackerX + '|' + r.attackerY);
      riIdentity(v, t, r.attackerVillageId, r.attackerVillageName, r.attackerPlayerId, r.attackerPlayerName);
      const units = riUnits(r.attackerTroops);
      const pid = r.attackerPlayerId != null ? String(r.attackerPlayerId) : undefined;
      const off = riSum(units, RI_OFF_POOL);
      if (!v.sent || off > v.sent.off || (off === v.sent.off && t > v.sent.t)) {
        v.sent = { units, t, off, ...(pid ? { pid } : {}) };
      }
      const pop = riPop(units);
      if (!v.sentBig || pop > v.sentBig.pop || (pop === v.sentBig.pop && t > v.sentBig.t)) {
        v.sentBig = { units, t, pop, ...(pid ? { pid } : {}) };
      }
      const cat = +units.catapult || 0;
      if (cat >= RI_CAT_MIN && (+units.ram || 0) < RI_CAT_RAM_OFF) {
        const n = (v.sentCat ? (+v.sentCat.n || 0) : 0) + 1; // every qualifying report counts
        if (!v.sentCat || cat > v.sentCat.cat || (cat === v.sentCat.cat && t > v.sentCat.t)) {
          v.sentCat = { units, t, cat, n, ...(pid ? { pid } : {}) };
        } else {
          v.sentCat.n = n;
        }
      }
      // 💀 dead (attacker side): the defender won — the whole sent army died.
      // Only a real army (pop floor) proves anything; substantial survivors
      // coming home are living troops (`alive`), a surviving token fake is not.
      const aLost = r.attackerLosses || {};
      const surv = {};
      for (const k in units) { const s = units[k] - (+aLost[k] || 0); if (s > 0) surv[k] = s; }
      if (!Object.keys(surv).length) {
        if (pop >= RI_DEAD_MIN && (!v.dead || t >= v.dead.t)) v.dead = { t, kind: 'off', pop };
      } else if (riPop(surv) >= RI_ALIVE_MIN) {
        if (!v.alive || t >= v.alive.t) v.alive = { t };
      }
      used = true;
    }

    if (used) { store.ids[key] = 1; stats.added++; }
    else stats.invalid++;
  }
  return stats;
}

function riVillage(store, coord) {
  if (!store.villages[coord]) store.villages[coord] = { lastT: 0 };
  return store.villages[coord];
}
// Newest report touching the village defines its identity snapshot (owner at
// observation time — the input for the ownership-staleness check).
function riIdentity(v, t, id, name, playerId, playerName) {
  if (t >= (v.lastT || 0)) {
    v.lastT = t;
    if (id != null) v.id = String(id);
    if (name) v.name = name;
    if (playerId != null) v.playerId = String(playerId);
    if (playerName) v.playerName = playerName;
  }
}

// ── Classification (FastNotes ladder + the away-unknown caveat) ──
// Returns { cls: 'off'|'def'|'mixed'|'spy'|'empty'|'unknown', sure: bool }.
// `sure` is false whenever the verdict could flip if the unseen away troops
// turned out to be an off army.
function riClassify(v) {
  if (!v) return { cls: 'unknown', sure: false };
  const home = v.home ? v.home.units : null;
  const awayKnown = !!v.away;                       // seen, or confirmed-empty via spy data
  const away = awayKnown ? v.away.units : null;

  const offSent = v.sent ? v.sent.off : 0;
  const offAway = riSum(away, RI_OFF_POOL), defAway = riSum(away, RI_DEF_POOL);
  const offHome = riSum(home, RI_OFF_POOL), defHome = riSum(home, RI_DEF_POOL);
  const off = offHome + offAway, def = defHome + defAway;

  // Direct evidence first — each alone settles the question.
  if (offSent >= RI_MIN) return { cls: 'off', sure: true };   // it fired a real off army
  if (offAway >= RI_MIN) return { cls: 'off', sure: true };
  if (defAway >= RI_MIN) return { cls: 'def', sure: true };   // its def is out supporting

  if (!home && !awayKnown) return { cls: 'unknown', sure: false };

  // Only rams/cats (+spies) at home while away is unseen: FastNotes reads this
  // as the village's def being out supporting (def villages hold a few rams) —
  // likely DEF, but never certain.
  if (home && !awayKnown) {
    const th = riTotal(home);
    const rc = (home.ram || 0) + (home.catapult || 0) + (home.spy || 0);
    // require real rams/cats — a pure-spy village belongs to the SPY case below
    if (th > 0 && rc === th && (home.ram || 0) + (home.catapult || 0) > 0) return { cls: 'def', sure: false };
  }

  if (off >= RI_MIN && def >= RI_MAX) return { cls: 'off', sure: true };       // armored off
  if (off >= RI_MIN && def >= RI_MIN) return { cls: 'mixed', sure: awayKnown };
  if (off >= RI_MIN) return { cls: 'off', sure: true };                        // off at home is proof enough
  if (def >= RI_MAX) return { cls: 'def', sure: true };                        // a 20k+ stack IS the identity
  if (def >= RI_MIN) return { cls: 'def', sure: awayKnown };                   // the user's caveat

  // Small numbers.
  if (home && (home.spy || 0) >= 100 && off < RI_MIN && def < RI_MIN) return { cls: 'spy', sure: false };
  if (off === 0 && def === 0) {
    return { cls: 'empty', sure: !!(home && v.home.spied && awayKnown) };
  }
  if (def > off) return { cls: 'def', sure: awayKnown };
  if (off > def) return { cls: 'off', sure: false };
  return { cls: 'unknown', sure: false };
}

// Combine two fact records for the SAME village (e.g. the local store's and
// the shared DB's) into one view: per section the newer observation wins,
// except `sent` which keeps the larger off pool (same rule as the merge).
// Non-mutating; either side may be null/undefined.
function riCombineVillages(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const newer = (x, y) => (!x ? y : (!y ? x : (((y.t || 0) > (x.t || 0)) ? y : x)));
  const idSrc = ((b.lastT || 0) >= (a.lastT || 0)) ? b : a;
  const out = { lastT: Math.max(a.lastT || 0, b.lastT || 0) };
  if (idSrc.id != null) out.id = idSrc.id;
  if (idSrc.name) out.name = idSrc.name;
  if (idSrc.playerId != null) out.playerId = idSrc.playerId;
  if (idSrc.playerName) out.playerName = idSrc.playerName;
  const home = newer(a.home, b.home); if (home) out.home = home;
  const away = newer(a.away, b.away); if (away) out.away = away;
  const bld = newer(a.bld, b.bld); if (bld) out.bld = bld;
  const dead = newer(a.dead, b.dead); if (dead) out.dead = dead;
  const alive = newer(a.alive, b.alive); if (alive) out.alive = alive;
  if (a.sent || b.sent) {
    out.sent = !a.sent ? b.sent : !b.sent ? a.sent
      : ((b.sent.off > a.sent.off || (b.sent.off === a.sent.off && (b.sent.t || 0) > (a.sent.t || 0))) ? b.sent : a.sent);
  }
  // sentBig / sentCat combine on the same metric that keeps them in the merge
  // (pop / cat count, ties → newer). sentCat's `n` counts reports each SIDE saw;
  // local uploads are a subset of the shared DB after a share round-trip, so the
  // honest combined count is the max, never the sum (that would double-count).
  if (a.sentBig || b.sentBig) {
    out.sentBig = !a.sentBig ? b.sentBig : !b.sentBig ? a.sentBig
      : ((b.sentBig.pop > a.sentBig.pop || (b.sentBig.pop === a.sentBig.pop && (b.sentBig.t || 0) > (a.sentBig.t || 0))) ? b.sentBig : a.sentBig);
  }
  if (a.sentCat || b.sentCat) {
    const win = !a.sentCat ? b.sentCat : !b.sentCat ? a.sentCat
      : ((b.sentCat.cat > a.sentCat.cat || (b.sentCat.cat === a.sentCat.cat && (b.sentCat.t || 0) > (a.sentCat.t || 0))) ? b.sentCat : a.sentCat);
    const n = Math.max((a.sentCat ? +a.sentCat.n || 0 : 0), (b.sentCat ? +b.sentCat.n || 0 : 0));
    out.sentCat = n !== (+win.n || 0) ? { ...win, n } : win;
  }
  return out;
}

// Ownership-staleness: intel observed under a previous owner is deprecated.
// currentPlayerId comes from the world DB (string; '0'/falsy = barbarian).
function riStale(v, currentPlayerId) {
  if (!v || v.playerId == null || currentPlayerId == null) return false;
  return String(currentPlayerId) !== String(v.playerId);
}

// Compact age label: '12m', '5h', '3d'. Pure (caller passes `now`).
function riAge(now, t) {
  if (!t) return '?';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h';
  return Math.floor(h / 24) + 'd';
}
