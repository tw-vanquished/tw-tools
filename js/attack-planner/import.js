// attack-planner — mass target import (BB parsers — see the FORMAT CONTRACT in tribe-calculator js/plan.js).
// Classic script (5/9): no modules, shared global scope, load order matters — must work
// by double-click (file://). See the <script src> order in attack-planner.html.
'use strict';

// ══════════════════════════════════════════════
// MASS TARGET IMPORT
// ══════════════════════════════════════════════

// Catapult-target building label of an attack line: the "(→ Building)" parenthetical
// tribe-calculator stamps on off rows in Catapult Mode (the building the off's riding
// catapults aim at — FORMAT CONTRACT, plan.js catTargetLabel/planRowForumBB/
// playerPlanBBBlock). Also matches the "(N → Building)" form catapult-attack rows use.
// The arrow INSIDE the parens is what keeps every other parenthetical — "(FAKE)",
// "(1/2 off)", "(Split Off)", "([player]…)" — from ever matching. The label is the
// export's localized building name; it's carried verbatim (never translated back).
function buildingLabelOf(line) {
  const m = line.match(/\((?:\d+\s*)?→\s*([^)]+)\)/);
  return m ? m[1].trim() : '';
}

// Catapult count of a tribe-calculator catapult-attack row: the bold "(N)" / "(N → Building)"
// parenthetical after the icon (per-player export, FORMAT CONTRACT plan.js playerPlanBBBlock),
// falling back to the rally URL's "&catapult=N" preset. 0 = unknown (the forum export carries
// no count) — Auto-Generate then sends every catapult the source village owns.
function catCountOf(line) {
  const pm = line.match(/\((\d+)\s*(?:→[^)]*)?\)/);
  if (pm) return parseInt(pm[1], 10);
  const um = line.match(/[?&]catapult=(\d+)/);
  return um ? parseInt(um[1], 10) : 0;
}

// ARRIVAL DATE header of either export (EN "ARRIVAL DATE" / ES "FECHA DE LLEGADA"):
// null = not a date header; [] = a date header with no clean day list; else every
// day-of-month on it. Since tribe-calculator v5.12 one per-player block may list SEVERAL days
// ("Thursday 13 & Friday 14"). The line must be nothing but the label + a "&"-joined
// weekday/day list once tags are stripped, so the PM template's decorated date line (label +
// date + trailing prose) and a legacy free-text label yield [] — read as "no known day".
function arrivalDaysOf(line) {
  if (!/ARRIVAL DATE|FECHA DE LLEGADA/i.test(line)) return null;
  const tail = line.replace(/\[[^\]]*\]/g, ' ').replace(/^.*?(?:ARRIVAL DATE|FECHA DE LLEGADA)\s*:?/i, '');
  if (!/^[^0-9]*\d{1,2}(?:\s*&\s*[^0-9]*\d{1,2})*\s*$/.test(tail)) return [];
  return [...tail.matchAll(/\d{1,2}/g)].map(m => parseInt(m[0], 10));
}

function parseOffPlanBB(text) {
  const targets = [];        // plus non-JSON .arrivalDay / .arrivalDays, as parsePlayerPlanBB
  // A target listed under several ARRIVAL DATE sections — tribe-calculator before v6.6.1
  // repeated a multi-wave plan's objective list once per wave, and those posts still sit in
  // forum threads — must ACCUMULATE every wave's requirements. Re-opening the same coord returns
  // the existing entry instead of a fresh one, otherwise the last section would silently replace
  // the earlier waves downstream (importOffTargets assigns `existing.requirements = p.requirements`).
  const byCoord = {};
  let current = null;
  // Requirement day (requirement.arrivalDay — importOffTargets resolves it like importPlayerPlan):
  // the line's own "<day> · " window prefix wins (v6.6.1+ posts list every wave of a target in
  // one objective under ONE header that " & "-joins every date, and stamp each line when there
  // are several — tribe-calculator planRowDayStamp, FORMAT CONTRACT); else the day of a
  // single-date header above it (each pre-v6.6.1 wave section had its own). A line under a
  // several-date header with no prefix stays undated rather than taking the first day.
  let sectionDay = null;
  const arrivalDays = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const days = arrivalDaysOf(line);
    if (days) {
      sectionDay = days.length === 1 ? days[0] : null;   // an unreadable header must not inherit the last wave's day
      days.forEach(d => { if (!arrivalDays.includes(d)) arrivalDays.push(d); });
      current = null;
      continue;
    }
    // Village line: "N. X|Y - Player." (optional spaces/trailing dot). The owner part is
    // optional: showPlanBB prints a barbarian target as a bare "N. X|Y".
    const vm = line.match(/^\d+\.\s+(\d+)\|(\d+)(?:\s*-\s*(.+?))?\.?\s*$/);
    if (vm) {
      const key = `${parseInt(vm[1])}|${parseInt(vm[2])}`;
      if (byCoord[key]) { current = byCoord[key]; continue; }
      current = { x: parseInt(vm[1]), y: parseInt(vm[2]), player: (vm[3] || '').replace(/\[\/?[^\]]+\]/g, '').trim(), requirements: [] };
      byCoord[key] = current;
      targets.push(current);
      continue;
    }
    if (!current) continue;
    // Attack line: [unit]TYPE[/unit] [player]NAME[/player] [b]HH:MM/HH:MM[/b]
    // The trailing time may be a window (HH:MM/HH:MM) or a single exact time (HH:MM).
    const am = line.match(/\[unit\](\w+)\[\/unit\].*?\[player\](.+?)\[\/player\].*?(\d{1,2}:\d{2})(?:\s*[\/\-–]\s*(\d{1,2}:\d{2}))?/);
    if (am) {
      // FAKE rows lead with the spy icon ([unit]spy[/unit][unit]ram[/unit] in the forum export);
      // record them as a 'fake' requirement so importOffTargets can mark an all-fake target.
      // Catapult-attack rows ([unit]catapult[/unit], tribe-calculator ≥ v3.16) import as a
      // 'catapult' requirement (v1.11.0) — the forum export names no count, so the sender
      // fires every catapult its village owns; "(→ Building)" is the demolition objective.
      // An escorted (split-off) train leads with the axe icon ([unit]axe[/unit][unit]snob[/unit])
      // — any snob tag makes it a 'snob' requirement. Same priority as parsePlayerPlanBB:
      // catapult, spy (fake), snob, else the first unit.
      const first = am[1].toLowerCase();
      const unitType = first === 'catapult' ? 'catapult'
                     : first === 'spy' ? 'fake'
                     : /\[unit\]snob\[\/unit\]/i.test(line) ? 'snob'
                     : first;
      const req = { unitType, attacker: am[2].trim(), timeFrom: normHHMM(am[3]), timeTo: normHHMM(am[4]) };
      if (unitType === 'catapult') { const n = catCountOf(line); if (n) req.count = n; }
      // Catapult Mode: the off row's "(→ Building)" objective for its riding catapults.
      const building = buildingLabelOf(line);
      if (building) req.building = building;
      // The "·" is what keeps a digit in a building label from ever reading as a day; tags are
      // stripped first so [color=…] hexes can't interfere.
      const dm = line.slice(line.indexOf('[/player]')).replace(/\[[^\]]*\]/g, ' ').match(/(\d{1,2})\s*·\s*\d{1,2}:\d{2}/);
      const day = dm ? parseInt(dm[1], 10) : sectionDay;
      if (day !== null) req.arrivalDay = day;
      current.requirements.push(req);
    }
  }
  targets.arrivalDay = arrivalDays.length ? arrivalDays[0] : null;
  targets.arrivalDays = arrivalDays;
  return targets;   // entries are pushed as they open, so nothing is left dangling here
}

// ── Per-player plan BB (tribe-calculator "Per-Player Orders" / combined "Per-Player All") ──
//
// ⚠ FORMAT CONTRACT with tribe-calculator js/plan.js: this parser consumes the BB emitted by
// playerPlanBBBlock / planRowWindowBB / snobOrderLineBB / unassignedPlanBBBlock (and
// bbDateLabelOf for the date header). Whenever that export changes shape, update this parser
// + tests/test_attack_import.js in the same change — there is a matching contract note above
// those functions in plan.js.
// To stay robust across cosmetic tweaks, anchor only on STRUCTURE (unit tags, "→ [coord]",
// [coord] targets, line order) — never on presentation such as [color=…] hexes or [b] nesting.
//
// Lines are grouped under a "========== SENDER (n) ==========" header naming the player who
// must SEND them. Each attack line becomes a REQUIREMENT on its target, attributed to the
// header sender. The user then sets "My Player" to their own name and runs Auto-Generate,
// which assigns their villages. The in-line "([player]…[/player])" is the TARGET owner
// (defender); a bare "src" coord before the arrow pins the exact origin village.
//
// Line shapes handled (EN and ES):
//   header  ========== Vanquished (4) ==========
//   date    [b][u]ARRIVAL DATE:[/u][/b] Thursday 18            → arrivalDay (day-of-month)
//           Since tribe-calculator v5.12 a multi-wave plan emits ONE block per player whose
//           header lists every arrival day (" & "-joined): "ARRIVAL DATE: Thursday 13 &
//           Friday 14". Every day on the line is captured; the days scope to the sender block
//           they head (older per-wave exports repeat header + date per wave — each of those
//           blocks is single-dated, so they too now import fully dated).
//   off     [unit]ram[/unit] 547|552 → [coord]583|524[/coord] ([player]Def[/player]) [b]…01:00…
//           In Catapult Mode the icon is followed by the off's catapult-target building —
//           "[b](→ Granja)[/b]" — which imports as requirement.building (buildingLabelOf)
//           so the Attacks table can show which building to pick on the confirm screen.
//           In a multi-date block the blue arrival window carries a "<day> · " day-of-month
//           prefix ("13 · 01:00-02:00", tribe-calculator planRowWindowBB) — that day dates the
//           attack's requirement individually (requirement.arrivalDay → dateISO on import).
//   fake    [unit]spy[/unit][unit]ram[/unit] [b](FAKE)[/b] 547|552 → [coord]583|524[/coord] …  (parses like an
//           off but classified 'fake' — the spy icon is its only reliable structural marker)
//   cat     [unit]catapult[/unit] [b](25 → Granja)[/b] 547|552 → [coord]583|524[/coord] …  (a catapult
//           attack from a defensive village: classified 'catapult', count = the "(N …)" paren
//           or the rally URL's &catapult=N, building = the demolition objective — v1.11.0)
//   launch  …LAUNCH TIME:… — [url=…]ATTACK URL▶[/url][/b]      (continuation line: rally URL
//           carrying the village=/target= IDs; old single-line exports put it on the off line)
//   snob    4x [unit]snob[/unit] ⚠ Prepare Snob Train for [coord]572|521[/coord] ⚠ ([player]Def[/player]) [b]…02:00-03:00…
//           (same "<day> · " prefix rule as off lines)
//
// Ignored on purpose: the "Objective N." context dump (its off rows have no "→ [coord]" and its
// snob rows carry no [coord] at all), "Villages in snob range" lines (bare coords), the
// UNASSIGNED block (bare "label → coord", no [coord] tag), and Per-Player Table [table] rows
// (no "→", no [unit]snob[/unit]).

// Arrival window = the FIRST "HH:MM" or "HH:MM-HH:MM" after the target's [/coord] on the
// attack/snob line itself, with every BB tag stripped first — so color hexes, [b] nesting, or
// any future presentation tag can neither gate nor pollute the match. Launch/continuation
// lines are never scanned for times, so the red launch span can't be mistaken for the arrival.
// `day` = the optional "<day> · " day-of-month prefix tribe-calculator (v5.12+) puts before
// the window when a player's block spans several arrival dates (planRowWindowBB — FORMAT
// CONTRACT, change in lockstep). The "·" separator is what keeps a trailing digit in a
// defender's name from ever matching as a day.
function windowAfterCoord(line) {
  const i = line.indexOf('[/coord]');
  if (i < 0) return { day: null, timeFrom: '', timeTo: '' };
  const tail = line.slice(i + 8).replace(/\[[^\]]*\]/g, ' ');
  const m = tail.match(/(?:(\d{1,2})\s*·\s*)?(\d{1,2}:\d{2})(?:\s*[\/\-–]\s*(\d{1,2}:\d{2}))?/);
  return { day: m && m[1] ? parseInt(m[1], 10) : null, timeFrom: m ? normHHMM(m[2]) : '', timeTo: m ? normHHMM(m[3]) : '' };
}

function parsePlayerPlanBB(text) {
  const targets = [];        // [{ x, y, villageId, player, requirements }] — plus a non-JSON
                             // .arrivalDay property (first ARRIVAL DATE day-of-month seen).
                             // Each requirement carries its OWN arrivalDay (day-of-month) when
                             // one is knowable: the "<day> · " window prefix wins, else the
                             // single day of the sender block's ARRIVAL DATE header, else null.
  const byKey   = {};        // coord/id key → target (merge lines that hit the same target)
  let sender = '';           // current "========== SENDER (n) ==========" block owner
  let arrivalDay = null;
  const arrivalDays = [];   // every distinct ARRIVAL DATE day seen, in order (multi-date plans)
  let blockDays = null;     // the day(s) named by the CURRENT sender block's ARRIVAL DATE line

  const attackRe = /→\s*\[coord\](\d{1,3}\|\d{1,3})\[\/coord\]/;   // off / cat attack line
  const coordRe  = /\[coord\](\d{1,3}\|\d{1,3})\[\/coord\]/;       // any tagged coord (snob line)

  // Pass 1 — classify lines into attack records. Newer exports span TWO lines per off: the
  // "village → target + window" line followed by a "LAUNCH TIME" line carrying the rally URL.
  // Coalesce the URL line into its record so the village-ID pins still bind; the arrival
  // window is captured from the attack line itself, up front, so nothing on a continuation
  // line can ever corrupt it. Old single-line exports parse identically.
  const records = [];        // [{ sender, kind: 'attack'|'snob', text, day, timeFrom, timeTo }]
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const hm = line.match(/^=+\s*(.+?)\s*\(\d+\)\s*=+$/);
    if (hm) { sender = hm[1].trim(); cur = null; blockDays = null; continue; }
    if (/^=+.*=+$/.test(line)) { sender = ''; cur = null; blockDays = null; continue; } // other dividers (UNASSIGNED)
    // ARRIVAL DATE header (arrivalDaysOf) — every day on it, scoped to the current sender
    // block. An undecorated-day line (PM template, legacy label) falls through ignored, exactly
    // as before. Older per-wave exports (one header per block, one day each) scope naturally:
    // each block's single day dates its requirements.
    const hdrDays = arrivalDaysOf(line);
    if (hdrDays) {
      if (hdrDays.length) {
        blockDays = hdrDays;
        for (const d of blockDays) if (!arrivalDays.includes(d)) arrivalDays.push(d);
        if (arrivalDay === null) arrivalDay = blockDays[0];
      }
      continue;
    }
    if (attackRe.test(line)) {
      const win = windowAfterCoord(line);
      if (win.day == null && blockDays && blockDays.length === 1) win.day = blockDays[0];
      records.push({ sender, kind: 'attack', text: line, ...win });  // start of a new attack
      // Open for its LAUNCH TIME line only when the URL is still to come: an old single-line
      // export, or a window-less ("??:??") order, already carries it — and the next URL line
      // (e.g. a Per-Player Table row) would otherwise fold in and re-type the attack.
      cur = line.includes('[url=') ? null : records[records.length - 1];
    } else if (/\[unit\]snob\[\/unit\]/i.test(line) && coordRe.test(line)
               && !/SNOBS NEED RECRUITING|NECESITAS RECLUTAR NOBLES/i.test(line)) {
      // Snob-train order line ("Prepare Snob Train for [coord]…"). No origin, no URL — the
      // requirement stays unpinned and Auto-Generate picks a noble village. The objective-
      // context dump's snob rows carry NO [coord] (their target is the group header line),
      // so they can never match here and double-import. Legacy v2.4–v3.11 exports flagged
      // display-only recruiting notes with [SNOBS NEED RECRUITING] / [NECESITAS RECLUTAR
      // NOBLES] (sometimes with a [coord]); those are never orders, so old pastes skip them.
      const win = windowAfterCoord(line);
      if (win.day == null && blockDays && blockDays.length === 1) win.day = blockDays[0];
      records.push({ sender, kind: 'snob', text: line, ...win });
      cur = null;
    } else if (cur && line.includes('[url=') && !line.startsWith('[*]')) {   // never a [table] row
      cur.text += ' ' + line;                                        // continuation: the LAUNCH TIME line carrying the rally URL
      cur = null;                                                    // an attack has exactly one launch line — close it so a later
                                                                     // URL-bearing line (e.g. a "needs recruiting" note) can't attach here
    }
    // Any other line (objective context, snob-range list, display-only notes) is ignored —
    // never folded into the previous attack, so it can't corrupt its unit/time.
  }

  // Pass 2 — records → targets + requirements
  for (const rec of records) {
    const line = rec.text, sender = rec.sender;

    let tx, ty, srcCoord = '', unitType;
    if (rec.kind === 'snob') {
      const tm = line.match(coordRe);
      [tx, ty] = tm[1].split('|').map(Number);
      unitType = 'snob';
    } else {
      const tm = line.match(attackRe);                               // target coord
      [tx, ty] = tm[1].split('|').map(Number);
      const sm = line.match(/(\d{1,3}\|\d{1,3})\s*→\s*\[coord\]/);   // pinned source coord — must
      srcCoord = sm ? sm[1] : '';                                    // precede "[coord]" so a
                                                                     // "(→ Building)" label can't match
      // Unit: CATAPULT first — a catapult-attack row ([unit]catapult[/unit], from a defensive
      // village) has its own tier (v1.11.0; the unit-classify below would otherwise fall to
      // 'axe'). Then FAKE — tribe-calculator's fake rows ride a lone ram behind a spy icon
      // ([unit]spy[/unit][unit]ram[/unit]), so the spy tag (which no other row type uses) must
      // be tested BEFORE ram or a fake would mis-type as a real ram off. Then snob (incl.
      // old-format escorted "[unit]axe[/unit][unit]snob[/unit]" attack lines), else ram, else
      // axe. Ram vs axe stay distinct — different power tiers.
      unitType = /\[unit\]catapult\[\/unit\]/i.test(line) ? 'catapult'
               : /\[unit\]spy\[\/unit\]/i.test(line)  ? 'fake'
               : /\[unit\]snob\[\/unit\]/i.test(line) ? 'snob'
               : /\[unit\]ram\[\/unit\]/i.test(line)  ? 'ram'
               : 'axe';
    }

    // "4x " train size for snob lines; for a catapult attack the count is its catapult number
    // ("(25 → Granja)" / &catapult=25) — 1 when unknown (normalizeReqs keeps 1 as "unset").
    const cm    = line.match(/^(\d+)\s*x\s+/i);
    const count = unitType === 'catapult' ? (catCountOf(line) || 1) : (cm ? parseInt(cm[1], 10) : 1);

    const pm = line.match(/\(\[player\](.+?)\[\/player\]\)/);          // target owner (defender)
    const defender = pm ? pm[1].trim() : '';

    const timeFrom = rec.timeFrom;                         // captured from the attack line in pass 1
    const timeTo   = rec.timeTo;

    let srcVid = '', tgtVid = '', srcT = '';                         // village IDs from rally URL
    const um = line.match(/\[url=([^\]]+)\]/);
    if (um) {
      const vM = um[1].match(/[?&]village=(\d+)/);
      const tM = um[1].match(/[?&]target=(\d+)/);
      // tribe-calculator ≥ v6.3.1: a sitted player's rally URL carries their account id (t=,
      // the game's sitter parameter) — Auto-Generate puts it on the sending village (v1.11.2).
      const sM = um[1].match(/[?&]t=(\d+)(?:&|$)/);
      srcVid = vM ? vM[1] : '';
      tgtVid = tM ? tM[1] : '';
      srcT   = sM ? sM[1] : '';
    }

    // Merge by rally-URL village ID when present, and ALWAYS by coords too — a URL-less snob
    // order and a URL-carrying off on the SAME target must land on one entry (two entries
    // would upsert the same coords twice in importPlayerPlan, the second wiping the first's
    // requirements).
    let tg = (tgtVid && byKey['id:' + tgtVid]) || byKey[`${tx}|${ty}`];
    if (!tg) {
      tg = { x: tx, y: ty, villageId: tgtVid, player: defender, requirements: [] };
      targets.push(tg);
    } else {
      if (tgtVid && !tg.villageId) tg.villageId = tgtVid;
      if (defender && !tg.player)  tg.player = defender;
    }
    byKey[`${tx}|${ty}`] = tg;
    if (tgtVid) byKey['id:' + tgtVid] = tg;
    // srcCoord + srcVillageId pin the exact origin so Auto-Generate sends from this village.
    // arrivalDay (day-of-month or null) is transient: importPlayerPlan resolves it to a real
    // per-requirement dateISO on multi-date pastes and then drops it.
    const req = { unitType, attacker: sender, timeFrom, timeTo, count, srcCoord, srcVillageId: srcVid, arrivalDay: rec.day };
    if (srcT && srcCoord) req.srcT = srcT;
    // Catapult Mode: an off line's "(→ Building)" objective. Only attack lines carry one
    // (snob order lines never do), and buildingLabelOf's paren-anchored arrow can't match
    // the bare "src → [coord]" arrow or anything on a coalesced launch line.
    if (rec.kind === 'attack') {
      const building = buildingLabelOf(line);
      if (building) req.building = building;
    }
    tg.requirements.push(req);
  }

  targets.arrivalDay = arrivalDay;   // array property — invisible to JSON/length, callers opt in
  targets.arrivalDays = arrivalDays;
  return targets;
}

// The export's ARRIVAL DATE header only carries a weekday + day-of-month ("Thursday 18") —
// resolve the day to the NEXT calendar date with that day-of-month (today counts), which is
// always right for an op pasted up to ~4 weeks ahead. `now` is injectable for the test harness.
function arrivalDayToISO(day, now = new Date()) {
  if (!day || day < 1 || day > 31) return '';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let m = 0; m < 3; m++) {
    const d = new Date(today.getFullYear(), today.getMonth() + m, day);
    if (d.getDate() !== day || d < today) continue;   // month overflow (Feb 31st) or already past
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return '';
}

// A target's type from its imported requirements: 'fake' only when it has requirements and
// every one is a fake (tribe-calculator's per-player/forum exports never mix a real off/snob
// with a fake on one target); otherwise 'off'. An empty list stays 'off' (the legacy default).
// Catapult requirements are real troops, so a catapult-only target is an 'off' target too —
// the CATAPULT distinction lives on the attack rows, not the target.
function targetTypeFor(requirements) {
  const reqs = requirements || [];
  return reqs.length && reqs.every(r => r.unitType === 'fake') ? 'fake' : 'off';
}

// Resolve a parsed plan's transient day-of-month stamps (parsePlayerPlanBB / parseOffPlanBB)
// into real dates, shared by both BB importers. planDateISO = the plan's headline ARRIVAL DATE
// — the caller remembers it so openAutoGenerate pre-fills its landing date instead of today.
// Multi-date paste (tribe-calculator v5.12 merged per-player blocks, several single-dated wave
// blocks pasted together, or a multi-wave Forum post): every requirement gets its OWN dateISO
// from its arrivalDay, and Auto-Generate lands it on that date regardless of the date input
// (which then only covers requirements without one). Single-date pastes deliberately store NO
// per-requirement date — there the Auto-Generate date input keeps full control, so moving the
// whole op a day still works by just changing it. The transient arrivalDay never reaches
// DATA.targets. "Multi-date" is judged from the headers AND from the per-line day stamps — a
// fragment pasted without its ARRIVAL DATE header still carries "<day> · " prefixes, and those
// must not be silently discarded. `now` is injectable for the test harness.
function resolveArrivalDates(parsed, now = new Date()) {
  const planDateISO = arrivalDayToISO(parsed.arrivalDay, now);
  const lineDays = new Set();
  parsed.forEach(p => p.requirements.forEach(r => { if (r.arrivalDay != null) lineDays.add(r.arrivalDay); }));
  const multiDate = (parsed.arrivalDays || []).length > 1 || lineDays.size > 1;
  let undated = 0;
  parsed.forEach(p => p.requirements.forEach(r => {
    if (multiDate) {
      const iso = arrivalDayToISO(r.arrivalDay, now);
      if (iso) r.dateISO = iso; else undated++;
    }
    delete r.arrivalDay;
  }));
  const dayList = ((parsed.arrivalDays || []).length ? parsed.arrivalDays : [...lineDays]).join(', ');
  return { planDateISO, multiDate, undated, dayList };
}

// The import alert's date lines for resolveArrivalDates' result: the pre-filled date, and on a
// multi-date plan either "each attack keeps its own day" or a warning naming the undated ones.
function arrivalDatesAlert(d) {
  return (d.planDateISO ? '\n' + t('alert_plan_date').replace('{date}', d.planDateISO) : '')
    + (d.multiDate
        ? '\n' + t(d.undated ? 'alert_plan_multi_date' : 'alert_plan_dates_applied')
            .replace('{days}', d.dayList)
            .replace('{undated}', String(d.undated))
        : '');
}

function importPlayerPlan(text) {
  const parsed = parsePlayerPlanBB(text);
  if (!parsed.length) { alert(t('alert_no_targets_found')); return; }

  const dates = resolveArrivalDates(parsed);
  if (dates.planDateISO) DATA.settings.planDateISO = dates.planDateISO;

  // A paste of just YOUR OWN block usually lacks the "========== NAME ==========" header, so
  // its requirements come back with a blank attacker — and the My-Player filter in
  // Auto-Generate would then silently drop every one of them. Attribute blanks to My Player.
  const me = (DATA.settings.playerName || '').trim();
  if (me) parsed.forEach(p => p.requirements.forEach(r => { if (!r.attacker) r.attacker = me; }));

  let added = 0, updated = 0, fakes = 0, cats = 0;
  parsed.forEach(p => {
    // A target whose every requirement is a fake is a FAKE target (tribe-calculator never mixes
    // real offs and fakes on one target); anything with a real off/snob stays an off target.
    const tt = targetTypeFor(p.requirements);
    if (tt === 'fake') fakes++;   // counted for the summary regardless of added-vs-updated
    cats += p.requirements.filter(r => r.unitType === 'catapult').length;
    const existing = (p.villageId && DATA.targets.find(t => String(t.villageId) === String(p.villageId)))
                  || DATA.targets.find(t => t.x === p.x && t.y === p.y);
    if (existing) {
      if (p.villageId && !existing.villageId) existing.villageId = p.villageId;
      if (p.player) existing.player = p.player;
      existing.targetType   = tt;
      existing.requirements = p.requirements;
      updated++;
    } else {
      DATA.targets.push({
        id: uid(), name: `${p.x}|${p.y}`, villageId: p.villageId || '',
        x: p.x, y: p.y, player: p.player || '',
        targetType: tt, requirements: p.requirements
      });
      added++;
    }
  });

  const senders = new Set();
  parsed.forEach(p => p.requirements.forEach(r => { if (r.attacker) senders.add(r.attacker); }));
  const names = [...senders];
  const senderList = names.slice(0, 6).join(', ') + (names.length > 6 ? ` (+${names.length - 6})` : '');

  enrichTargetsSilent();
  saveData();
  if (typeof cloudSyncPlan === 'function') cloudSyncPlan(); // hosted-site: cloud-save on targets loaded
  renderTargets();
  refreshDropdowns();
  document.getElementById('import-off-text').value = '';
  closePanel('import-off-panel');
  alert(t('alert_plan_imported')
    .replace('{added}', added)
    .replace('{updated}', updated)
    .replace('{fakes}', fakes)
    .replace('{players}', senders.size)
    .replace('{senders}', senderList)
    + (cats ? '\n' + t('alert_plan_cats').replace('{n}', String(cats)) : '')
    + arrivalDatesAlert(dates));
}

// Structural routing between the two BB importers: per-player exports have
// "========== NAME (n) ==========" sender headers and/or "src → [coord]tgt[/coord]" attack
// lines; the forum export has neither (its only arrows are inside "(→ Building)" catapult-mode
// labels, with no [coord] after them). A bare "includes('→')" check would misroute those.
function looksLikePlayerPlan(text) {
  return /^=+\s*.+\(\d+\)\s*=+\s*$/m.test(text)
      || /→\s*\[coord\]\d{1,3}\|\d{1,3}\[\/coord\]/.test(text);
}

function importOffTargets() {
  const text = document.getElementById('import-off-text').value.trim();
  if (!text) return;
  if (looksLikePlayerPlan(text)) { importPlayerPlan(text); return; }
  const parsed = parseOffPlanBB(text);
  if (!parsed.length) { alert(t('alert_no_targets_found')); return; }
  // Each requirement's day ("<day> · " prefix, else a single-date header) resolves exactly as in importPlayerPlan.
  const dates = resolveArrivalDates(parsed);
  if (dates.planDateISO) DATA.settings.planDateISO = dates.planDateISO;
  let added = 0, updated = 0, cats = 0;
  parsed.forEach(p => {
    const tt = targetTypeFor(p.requirements);
    cats += p.requirements.filter(r => r.unitType === 'catapult').length;
    const existing = DATA.targets.find(t => t.x === p.x && t.y === p.y);
    if (existing) {
      if (p.player) existing.player = p.player;
      existing.targetType   = tt;
      existing.requirements = p.requirements;
      updated++;
    } else {
      DATA.targets.push({
        id: uid(), name: `${p.x}|${p.y}`, villageId: '',
        x: p.x, y: p.y, player: p.player,
        targetType: tt, requirements: p.requirements
      });
      added++;
    }
  });
  enrichTargetsSilent();
  saveData();
  if (typeof cloudSyncPlan === 'function') cloudSyncPlan(); // hosted-site: cloud-save on targets loaded
  renderTargets();
  refreshDropdowns();
  document.getElementById('import-off-text').value = '';
  closePanel('import-off-panel');
  alert(t('alert_off_imported').replace('{added}', added).replace('{updated}', updated)
    + (cats ? '\n' + t('alert_plan_cats').replace('{n}', String(cats)) : '')
    + arrivalDatesAlert(dates));
}

function importFakeTargets() {
  const text = document.getElementById('import-fake-text').value.trim();
  if (!text) return;
  let added = 0, skipped = 0;
  for (const m of text.matchAll(/(\d+)\|(\d+)/g)) {
    const x = parseInt(m[1]), y = parseInt(m[2]);
    if (DATA.targets.find(t => t.x === x && t.y === y)) { skipped++; continue; }
    DATA.targets.push({
      id: uid(), name: `${x}|${y}`, villageId: '',
      x, y, player: '', targetType: 'fake', requirements: []
    });
    added++;
  }
  enrichTargetsSilent();
  saveData();
  if (typeof cloudSyncPlan === 'function') cloudSyncPlan(); // hosted-site: cloud-save on targets loaded
  renderTargets();
  refreshDropdowns();
  document.getElementById('import-fake-text').value = '';
  closePanel('import-fake-panel');
  alert(t('alert_fake_imported').replace('{added}', added).replace('{skipped}', skipped));
}

function enrichTargetsSilent() {
  if (!villageDb.length) return;
  DATA.targets.forEach(t => {
    if (t.villageId) return;
    const match = villageDb.find(v => v.x === t.x && v.y === t.y);
    if (match) {
      t.villageId = match.id;
      if (!t.name || t.name === `${t.x}|${t.y}`) t.name = match.name;
      if (!t.player) t.player = playerMap[match.playerId] || '';
    }
  });
}

