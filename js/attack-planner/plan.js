// attack-planner — Auto-Generate attacks (assignment passes, origin pinning).
// Classic script (6/9): no modules, shared global scope, load order matters — must work
// by double-click (file://). See the <script src> order in attack-planner.html.
'use strict';

// ══════════════════════════════════════════════
// AUTO-GENERATE ATTACKS
// ══════════════════════════════════════════════

function openAutoGenerate() {
  if (!DATA.targets.length) { alert(t('alert_no_targets')); return; }
  if (!DATA.villages.length) { alert(t('alert_no_villages')); return; }
  const today = new Date().toISOString().slice(0, 10);
  // Pre-fill the landing date remembered from the last per-player plan import (if it's not
  // already in the past) — the plan's ARRIVAL DATE, not today, is almost always the answer.
  const planDate = DATA.settings.planDateISO || '';
  document.getElementById('ag-date').value = planDate >= today ? planDate : today;

  // Populate per-village divided-off checkboxes
  const container = document.getElementById('ag-divided-off-villages');
  const noble_vils = DATA.villages.filter(v => (v.nobles || 0) > 0);
  if (noble_vils.length) {
    container.innerHTML = noble_vils.map(v =>
      `<label style="cursor:pointer;color:#d4b483">
        <input type="checkbox" class="ag-dov-cb" data-vid="${v.id}">
        &nbsp;${v.name} (${v.x}|${v.y}) ${offTierBadge(calcOffPow(v))} — ${v.nobles} noble(s)
      </label>`
    ).join('');
  } else {
    container.innerHTML = `<em style="color:#5a3a18">${t('ag_no_nobles')}</em>`;
  }
  document.getElementById('ag-divided-off-all').checked = false;

  updateAutoGenPreview();
  openModal('modal-autogen');
}

function toggleAllDividedOff(checked) {
  document.querySelectorAll('.ag-dov-cb').forEach(cb => cb.checked = checked);
}

function updateAutoGenPreview() {
  const myName = (DATA.settings.playerName || '').trim().toLowerCase();
  const offTargets  = DATA.targets.filter(t => t.targetType === 'off');
  const fakeTargets = DATA.targets.filter(t => t.targetType === 'fake');

  let offCount = 0, snobCount = 0, pinnedFakes = 0;
  offTargets.forEach(t => {
    const reqs = (t.requirements || []).filter(r => !myName || r.attacker.toLowerCase() === myName);
    offCount  += reqs.filter(r => r.unitType === 'ram' || r.unitType === 'axe').length;
    snobCount += reqs.filter(r => r.unitType === 'snob').length;
  });
  // Pinned fakes (explicit fake requirements naming an origin) fire regardless of the spray
  // toggle, so count them separately across off + fake targets.
  [...offTargets, ...fakeTargets].forEach(t => {
    const reqs = (t.requirements || []).filter(r => !myName || r.attacker.toLowerCase() === myName);
    pinnedFakes += reqs.filter(r => r.unitType === 'fake' && r.srcCoord).length;
  });

  const includeFakes = document.getElementById('ag-include-fakes')?.checked ?? false;
  const vilsWithRams = DATA.villages.filter(v => (v.rams || 0) > 0).length;
  const fakeSlots    = vilsWithRams * 10;
  const fakeTargets2 = offTargets.length + fakeTargets.length;
  const fakeEst      = Math.min(fakeTargets2, fakeSlots);

  const nameNote = myName
    ? `Filtering to player <strong>${escHtml(DATA.settings.playerName)}</strong>`
    : `<span style="color:#c06030">⚠ No player name set — all requirements will be assigned</span>`;

  const pinnedPart = pinnedFakes ? ` · <strong>${pinnedFakes}</strong> pinned fake(s)` : '';
  const fakePart = pinnedPart + (includeFakes
    ? ` · up to <strong>${fakeEst}</strong> extra fakes across ${DATA.villages.length} village(s)`
    : (pinnedFakes ? '' : ` · <span style="color:#806838">fakes disabled</span>`));

  document.getElementById('ag-preview').innerHTML =
    `${nameNote}<br>` +
    `Expected: <strong>${offCount}</strong> off(s) · <strong>${snobCount}</strong> snob train(s)${fakePart}`;
}

function autoGenerateAttacks(landingDateStr, criteria = { power: true, distance: true, window: false }, includeFakes = true, dividedOffVillages = new Set()) {
  const myName = (DATA.settings.playerName || '').trim().toLowerCase();

  function myReqs(target) {
    const reqs = target.requirements || [];
    return myName ? reqs.filter(r => r.attacker.toLowerCase() === myName) : reqs;
  }

  // A requirement lands on its OWN date when the import stamped one (multi-date plan);
  // the modal's landing date covers everything else.
  function landingISO(timeStr, dateISO) {
    return new Date(`${dateISO || landingDateStr}T${timeStr || '02:00'}:00`).toISOString();
  }

  const offTargets  = DATA.targets.filter(t => t.targetType === 'off');
  const fakeTargets = DATA.targets.filter(t => t.targetType === 'fake');
  const defaultTime = offTargets.find(t => (t.requirements||[]).length)?.requirements[0]?.timeFrom || '02:00';

  const vs = {};
  DATA.villages.forEach(v => {
    vs[v.id] = { noblesLeft: v.nobles || 0, usedForOff: false, fakeCount: 0 };
  });

  const attacks = [];

  // ── Pinned attacks (per-player plan: requirement names its exact origin) ──
  // When a requirement carries srcCoord/srcVillageId, the plan already decided which village
  // sends — so we honor it instead of running the assignment. Resolve to an existing village
  // (by ID then coords, keeping real troop counts); if it isn't in My Villages yet, create a
  // stub so the attack and its rally-point URL still work via the village IDs. Only the user's
  // own requirements reach here (myReqs filters by My Player), so no foreign villages are added.
  function resolvePinned(req) {
    if (!req.srcCoord) return null;
    const [sx, sy] = req.srcCoord.split('|').map(Number);
    const vid = req.srcVillageId || '';
    let v = (vid && DATA.villages.find(v => String(v.villageId) === String(vid)))
         || DATA.villages.find(v => v.x === sx && v.y === sy);
    if (!v) {
      v = { id: uid(), name: `(${sx}|${sy})`, villageId: vid || '', x: sx, y: sy, axes: 0, lc: 0, rams: 0, cats: 0, nobles: 0 };
      DATA.villages.push(v);
      vs[v.id] = { noblesLeft: v.nobles || 0, usedForOff: false, fakeCount: 0 };
    }
    return v;
  }

  // Pinned pass runs over BOTH off and fake targets: a FAKE target's requirements (from
  // tribe-calculator's per-player export) each name an exact origin, just like an off. Fakes
  // pinned here are tracked so the bulk "include fakes" spray below never doubles them.
  const pinnedFakeTargets = new Set();
  [...offTargets, ...fakeTargets].forEach(target => {
    myReqs(target).forEach(req => {
      const v = resolvePinned(req);
      if (!v) return;   // not pinned → handled by the assignment passes / fake spray below
      const iso = landingISO(req.timeFrom || defaultTime, req.dateISO);
      if (req.unitType === 'snob') {
        const nc = Math.max(1, req.count || 4);
        vs[v.id].noblesLeft = Math.max(0, vs[v.id].noblesLeft - nc);
        attacks.push({ id: uid(), fromId: v.id, targetId: target.id, type: 'snob', nobleCount: nc, landingTime: iso, windowFrom: req.timeFrom, windowTo: req.timeTo, dividedOff: dividedOffVillages.has(v.id), sent: false });
      } else if (req.unitType === 'fake') {
        // Explicit fake assignment (1 spy + 1 ram) from the planned village at its window —
        // honored ALWAYS, independent of the includeFakes spray toggle (it's a plan order, not
        // bulk noise). Counts toward the village's 10-fake cap so the spray stays in budget.
        vs[v.id].fakeCount++;
        pinnedFakeTargets.add(target.id);
        attacks.push({ id: uid(), fromId: v.id, targetId: target.id, type: 'fake', nobleCount: 1, landingTime: iso, windowFrom: req.timeFrom, windowTo: req.timeTo, sent: false });
      } else {
        // building = the Catapult Mode "(→ Building)" objective imported with the requirement
        // (undefined otherwise — JSON drops it), shown as the attack row's Building column.
        attacks.push({ id: uid(), fromId: v.id, targetId: target.id, type: 'off', nobleCount: 1, landingTime: iso, windowFrom: req.timeFrom, windowTo: req.timeTo, building: req.building, sent: false });
      }
    });
  });

  // ── Snob trains (unpinned: assign a village) ──
  let missedSnobs = [];
  offTargets.forEach(target => {
    const snobLines = myReqs(target).filter(r => r.unitType === 'snob' && !r.srcCoord);
    if (!snobLines.length) return;
    snobLines.forEach(req => {
      const iso = landingISO(req.timeFrom || defaultTime, req.dateISO);
      const wf = req.timeFrom, wt = req.timeTo;
      const v = DATA.villages
        .filter(v => vs[v.id].noblesLeft > 0)
        .sort(criteria.distance
          ? (a, b) => dist(a, target) - dist(b, target)
          : (a, b) => vs[b.id].noblesLeft - vs[a.id].noblesLeft
        )[0];
      if (!v) { missedSnobs.push({ targetId: target.id, unitType: 'snob', iso, windowFrom: wf, windowTo: wt }); return; }
      const nc = Math.min(req.count || 4, vs[v.id].noblesLeft);
      vs[v.id].noblesLeft  -= nc;
      vs[v.id].usedForSnob  = true;
      attacks.push({ id: uid(), fromId: v.id, targetId: target.id, type: 'snob', nobleCount: nc, landingTime: iso, windowFrom: wf, windowTo: wt, dividedOff: dividedOffVillages.has(v.id), sent: false });
    });
  });

  // ── Build off needs list (unpinned only) ──
  const offNeeds = [];
  offTargets.forEach(target => {
    myReqs(target).filter(r => r.unitType === 'ram' && !r.srcCoord).forEach(r => {
      const iso = landingISO(r.timeFrom || defaultTime, r.dateISO);
      offNeeds.push({ target, iso, windowFrom: r.timeFrom, windowTo: r.timeTo, building: r.building, minPow: TIER.tq, fallbackPow: TIER.half, unitType: 'off' });
    });
    myReqs(target).filter(r => r.unitType === 'axe' && !r.srcCoord).forEach(r => {
      const iso = landingISO(r.timeFrom || defaultTime, r.dateISO);
      offNeeds.push({ target, iso, windowFrom: r.timeFrom, windowTo: r.timeTo, building: r.building, minPow: TIER.half, fallbackPow: TIER.half, unitType: 'axe' });
    });
  });

  // ── Assign offs by combined criteria ──
  const offAssignments = assignOffsComposite(offNeeds, vs, criteria, dividedOffVillages);

  offAssignments.forEach(({ v, need }) => {
    attacks.push({ id: uid(), fromId: v.id, targetId: need.target.id, type: 'off', nobleCount: 1, landingTime: need.iso, windowFrom: need.windowFrom, windowTo: need.windowTo, building: need.building, sent: false });
  });

  const assignedNeeds = new Set(offAssignments.map(a => a.need));
  const missedOffs = offNeeds
    .filter(need => !assignedNeeds.has(need))
    .map(need => ({ targetId: need.target.id, unitType: need.unitType, iso: need.iso, windowFrom: need.windowFrom, windowTo: need.windowTo, building: need.building }));

  // ── Fakes (bulk spray) ──
  // Adds up-to-one extra fake per target across every off + fake target, round-robin over
  // villages with rams (≤10 each). Targets already handled by an explicit pinned fake above
  // are skipped so a planned fake is never doubled.
  if (includeFakes) {
    const allFakeTargets = [...offTargets, ...fakeTargets].filter(target => !pinnedFakeTargets.has(target.id));
    const vilsWithRams   = DATA.villages.filter(v => (v.rams || 0) > 0);
    let vi = 0;

    for (const target of allFakeTargets) {
      if (vilsWithRams.every(v => vs[v.id].fakeCount >= 10)) break;
      // A sprayed fake should ride with the target's real wave: on a multi-date plan the
      // target's requirements carry their own dateISO, so borrow the first one found.
      const tDate = ((target.requirements || []).find(r => r.dateISO) || {}).dateISO;
      const iso = landingISO(defaultTime, tDate);
      for (let attempt = 0; attempt < vilsWithRams.length; attempt++) {
        const v = vilsWithRams[(vi + attempt) % vilsWithRams.length];
        if (vs[v.id].fakeCount < 10) {
          vs[v.id].fakeCount++;
          vi = (vi + attempt + 1) % vilsWithRams.length;
          attacks.push({ id: uid(), fromId: v.id, targetId: target.id, type: 'fake', nobleCount: 1, landingTime: iso, sent: false });
          break;
        }
      }
    }
  }

  return { attacks, missedSnobs, missedOffs };
}

// Combined composite assignment — lexicographic priority: Power (×10000) → Distance (×100) → Window (×1)
function assignOffsComposite(needs, vs, criteria, dividedOffVillages = new Set()) {
  const result = [];
  const ws = DATA.settings.worldSpeed;
  const us = DATA.settings.unitSpeed;

  needs.forEach(need => {
    const avail = pow => DATA.villages.filter(v =>
      !vs[v.id].usedForOff &&
      !dividedOffVillages.has(v.id) &&
      calcOffPow(v) >= pow
    );

    const score = v => {
      let s = 0;
      const pow = calcOffPow(v);
      const d   = dist(v, need.target);

      if (criteria.power) {
        // ram: strongest first (higher score = better); axe: weakest qualifying first (lower power = better)
        const powScore = need.unitType === 'axe' ? 1 - pow / 1000000 : pow / 1000000;
        s += powScore * 10000;
      }

      if (criteria.distance) {
        s += Math.max(0, 1 - d / 200) * 100;
      }

      if (criteria.window && need.windowFrom && need.windowTo) {
        const tMs    = travelMs(d, 'off', ws, us);
        const sendMs = new Date(need.iso).getTime() - tMs;
        const base   = need.iso.slice(0, 10); // YYYY-MM-DD
        const fromMs = new Date(`${base}T${need.windowFrom}:00`).getTime();
        const toMs   = new Date(`${base}T${need.windowTo}:00`).getTime();
        const midMs  = (fromMs + toMs) / 2;
        const span   = Math.max(toMs - fromMs, 1800000);
        s += Math.max(0, 1 - Math.abs(sendMs - midMs) / (span * 4)) * 1;
      }

      return s;
    };

    const byScore = (a, b) => score(b) - score(a);

    const v = avail(need.minPow).sort(byScore)[0]
           || avail(need.fallbackPow).sort(byScore)[0];

    if (!v) return;
    vs[v.id].usedForOff = true;
    result.push({ v, need });
  });
  return result;
}

// Strategy 1: per-target greedy, closest available village
// Tiebreak on power: axe (1/2 off) → weakest first; ram (complete) → strongest first
function assignOffsShortest(needs, vs) {
  const result = [];
  needs.forEach(need => {
    const byDist = (a, b) => {
      const dd = dist(a, need.target) - dist(b, need.target);
      if (dd !== 0) return dd;
      return need.unitType === 'axe' ? calcOffPow(a) - calcOffPow(b) : calcOffPow(b) - calcOffPow(a);
    };
    const avail  = pow => DATA.villages.filter(v => !vs[v.id].usedForOff && calcOffPow(v) >= pow);
    // Prefer villages not already committed to a snob train
    const v = avail(need.minPow).filter(v => !vs[v.id].usedForSnob).sort(byDist)[0]
           || avail(need.minPow).sort(byDist)[0]
           || avail(need.fallbackPow).filter(v => !vs[v.id].usedForSnob).sort(byDist)[0]
           || avail(need.fallbackPow).sort(byDist)[0];
    if (!v) return;
    vs[v.id].usedForOff = true;
    result.push({ v, need });
  });
  return result;
}

// Strategy 2: highest off power — strongest available village per complete off, weakest qualifying per 1/2 off
function assignOffsHighestPower(needs, vs) {
  const result = [];
  needs.forEach(need => {
    // axe (1/2 off): weakest qualifying first — preserve strong villages for complete-off targets
    // ram (complete off): strongest first
    const byPow = need.unitType === 'axe'
      ? (a, b) => calcOffPow(a) - calcOffPow(b)
      : (a, b) => calcOffPow(b) - calcOffPow(a);
    const avail  = pow => DATA.villages.filter(v => !vs[v.id].usedForOff && calcOffPow(v) >= pow);
    const v = avail(need.minPow).filter(v => !vs[v.id].usedForSnob).sort(byPow)[0]
           || avail(need.minPow).sort(byPow)[0]
           || avail(need.fallbackPow).filter(v => !vs[v.id].usedForSnob).sort(byPow)[0]
           || avail(need.fallbackPow).sort(byPow)[0];
    if (!v) return;
    vs[v.id].usedForOff = true;
    result.push({ v, need });
  });
  return result;
}

// Strategy 3: minimize range of send-at times using sliding-window bipartite matching
function assignOffsMinWindow(needs, vs) {
  if (!needs.length) return [];

  const eligible = v => !vs[v.id].usedForOff && needs.some(n => calcOffPow(v) >= n.minPow || calcOffPow(v) >= n.fallbackPow);
  // Prefer villages not already committed to a snob train; fall back to all eligible if not enough
  let cands = DATA.villages.filter(v => eligible(v) && !vs[v.id].usedForSnob);
  if (cands.length < needs.length) cands = DATA.villages.filter(eligible);
  if (cands.length < needs.length) return assignOffsShortest(needs, vs);

  // All (village, need) pairs sorted by distance asc
  const pairs = [];
  cands.forEach((v, vi) => {
    const pow = calcOffPow(v);
    needs.forEach((need, ni) => {
      if (pow >= need.minPow || pow >= need.fallbackPow)
        pairs.push({ vi, ni, v, need, d: dist(v, need.target) });
    });
  });
  pairs.sort((a, b) => a.d - b.d);

  const N = needs.length;
  let bestResult = null;
  let bestRange  = Infinity;

  for (let lo = 0; lo <= pairs.length - N; lo++) {
    for (let hi = lo + N - 1; hi < pairs.length; hi++) {
      const assignment = offBipartiteMatch(pairs, lo, hi, cands.length, N);
      if (assignment) {
        const range = pairs[hi].d - pairs[lo].d;
        if (range < bestRange) { bestRange = range; bestResult = assignment; }
        break; // found tightest hi for this lo
      }
    }
    if (bestRange === 0) break; // can't do better
  }

  if (!bestResult) return assignOffsShortest(needs, vs);
  bestResult.forEach(({ v }) => { vs[v.id].usedForOff = true; });
  return bestResult;
}

// Augmenting-path bipartite matching over pairs[lo..hi]
function offBipartiteMatch(pairs, lo, hi, numV, numN) {
  const adj = Array.from({ length: numN }, () => []);
  for (let i = lo; i <= hi; i++) adj[pairs[i].ni].push(pairs[i].vi);

  const matchN = new Array(numN).fill(-1);
  const matchV = new Array(numV).fill(-1);
  let matched  = 0;

  function dfs(ni, seen) {
    for (const vi of adj[ni]) {
      if (seen[vi]) continue;
      seen[vi] = true;
      if (matchV[vi] === -1 || dfs(matchV[vi], seen)) {
        matchN[ni] = vi; matchV[vi] = ni; return true;
      }
    }
    return false;
  }

  for (let ni = 0; ni < numN; ni++) {
    if (dfs(ni, new Array(numV).fill(false))) matched++;
  }
  if (matched < numN) return null;

  const result = [];
  for (let ni = 0; ni < numN; ni++) {
    const vi = matchN[ni];
    for (let i = lo; i <= hi; i++) {
      if (pairs[i].vi === vi && pairs[i].ni === ni) { result.push({ v: pairs[i].v, need: pairs[i].need }); break; }
    }
  }
  return result;
}

function runAutoGenerate() {
  const dateStr  = document.getElementById('ag-date').value;
  if (!dateStr) { alert(t('alert_pick_date')); return; }
  const criteria = {
    power:    document.getElementById('ag-crit-power').checked,
    distance: document.getElementById('ag-crit-distance').checked,
    window:   document.getElementById('ag-crit-window').checked,
  };
  const includeFakes = document.getElementById('ag-include-fakes').checked;
  const dividedOffVillages = new Set(
    [...document.querySelectorAll('.ag-dov-cb:checked')].map(cb => cb.dataset.vid)
  );

  const { attacks, missedSnobs, missedOffs } = autoGenerateAttacks(dateStr, criteria, includeFakes, dividedOffVillages);
  const unassigned = [
    ...missedSnobs.map(m => ({ id: uid(), fromId: null, targetId: m.targetId, type: 'unassigned', unitType: m.unitType, landingTime: m.iso, windowFrom: m.windowFrom, windowTo: m.windowTo, sent: false })),
    ...missedOffs.map(m =>  ({ id: uid(), fromId: null, targetId: m.targetId, type: 'unassigned', unitType: m.unitType, landingTime: m.iso, windowFrom: m.windowFrom, windowTo: m.windowTo, building: m.building, sent: false })),
  ];

  if (!attacks.length && !unassigned.length) {
    alert(t('alert_no_attacks_generated'));
    return;
  }

  // Replace any previously generated attacks (re-generating is the common action; appending
  // would stack duplicates). Manual one-off attacks are preserved.
  DATA.attacks = DATA.attacks.filter(a => a.manual);
  DATA.attacks.push(...attacks, ...unassigned);
  saveData();
  if (typeof cloudSyncPlan === 'function') cloudSyncPlan(); // hosted-site: cloud-save on plan generated
  renderVillages();   // pinned per-player attacks may have created stub source villages
  renderAttacks();
  refreshDropdowns();
  closeModal('modal-autogen');

  const offs  = attacks.filter(a => a.type === 'off').length;
  const snobs = attacks.filter(a => a.type === 'snob').length;
  const fakes = attacks.filter(a => a.type === 'fake').length;
  let msg = t('alert_generated')
    .replace('{total}', attacks.length)
    .replace('{offs}', offs)
    .replace('{snobs}', snobs)
    .replace('{fakes}', fakes);
  if (unassigned.length) {
    msg += t('alert_generated_unassigned').replace('{n}', unassigned.length);
  }
  alert(msg);
}

