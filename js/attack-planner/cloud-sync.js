// ══════════════════════════════════════════════════════════════
// CLOUD SYNC (hosted site only)
// ──────────────────────────────────────────────────────────────
// Cloud-saves a copy of the attack plan you build — your villages, targets and
// the generated schedule — so your work isn't lost to a browser/cache wipe and
// can be picked back up from another device. The saved copy is mirrored to cloud
// storage via a small Cloudflare endpoint.
//
// Classic <script src> (no modules) so double-click / file:// still works. This is
// the attack-planner's own copy of the cloud-sync helper (the tribe-calculator has a
// separate one under the flat js/ folder); they share the same endpoint + sitekey but
// resolve their save label differently, so they live apart to avoid name collisions.
// When opened locally (file://) this is a COMPLETE NO-OP: nothing is injected and no
// network request is made, so the tool keeps its "works by double-click, zero external
// dependencies" contract. Everything network-related is gated behind
// `TW_ENV === 'production'` (TW_ENV is defined in storage.js, which MUST load before
// this file — so this <script src> sits right after storage.js).
//
// The endpoint runs a lightweight Cloudflare check that the caller is a real browser,
// so we mint a fresh (single-use, ~5-min) token on demand via an unobtrusive,
// execute-on-demand widget.
'use strict';

// Endpoint hostnames. Some ISPs intermittently block the shared Cloudflare IP
// range behind *.workers.dev (in Spain: LaLiga-ordered blocks during match
// windows) — the pages.dev front serves the SAME endpoint on an unaffected
// range, so it goes first; workers.dev stays as the fallback for the day
// pages.dev is the blocked one.
const CLOUD_SYNC_HOSTS = [
  'https://tw-calc-proxy.pages.dev',
  'https://tw-calc-uploads.gdqshd.workers.dev',
];
const CLOUD_SYNC_SITEKEY = '0x4AAAAAADvKZN-ZLjRH8UQe'; // public site key (safe in client)

// fetch() against the sync endpoint with hostname failover. Only NETWORK
// failures fail over — an HTTP error is the endpoint answering, and it would
// answer the same on either host.
function _cloudFetch(pathQuery, opts) {
  const attempt = (i) => fetch(CLOUD_SYNC_HOSTS[i] + pathQuery, opts)
    .catch((e) => (i + 1 < CLOUD_SYNC_HOSTS.length ? attempt(i + 1) : Promise.reject(e)));
  return attempt(0);
}

let _guardId = null;
let _guardReady = false;
let _guardPending = null; // resolver for the currently-executing token request

// Inject the Cloudflare check's api.js and render one execute-on-demand widget.
// Runs after DOM ready (see the bottom of this file). Hosted-site only.
function _initCloudSync() {
  if (typeof TW_ENV === 'undefined' || TW_ENV !== 'production') return; // local = no-op
  if (typeof document === 'undefined') return;

  // Do NOT hide with display:none — a zero-size/hidden container makes the check's
  // telemetry (getBoundingClientRect on the widget) read all-zeros, which the server
  // rejects (400) and then retries every few seconds forever. With
  // appearance:'interaction-only' the widget stays out of the way on its own; we only
  // pin the container to a corner so that IF a rare interactive check is ever required
  // it's reachable, not hidden.
  const container = document.createElement('div');
  container.id = 'cloud-sync-guard';
  container.style.position = 'fixed';
  container.style.bottom = '0';
  container.style.right = '0';
  container.style.zIndex = '2147483647';
  document.body.appendChild(container);

  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true;
  // NOTE: do NOT call turnstile.ready() here — it throws when the api.js tag was
  // loaded async/defer (which a dynamically-injected script always is). Because this
  // runs in the script's own onload, the API is already available, so we render the
  // widget directly.
  s.onload = () => {
    if (typeof turnstile === 'undefined') return;
    try {
      _guardId = turnstile.render('#cloud-sync-guard', {
        sitekey: CLOUD_SYNC_SITEKEY,
        execution: 'execute',        // don't run the check until we call execute()
        appearance: 'interaction-only', // stays hidden unless a check needs interaction
        retry: 'never',              // a failed check fails once — never spam-retry
        callback: (token) => { if (_guardPending) { const r = _guardPending; _guardPending = null; r(token); } },
        'error-callback': () => { if (_guardPending) { const r = _guardPending; _guardPending = null; r(null); } },
      });
      _guardReady = true;
    } catch (_) { /* widget failed to render — sync just stays off */ }
  };
  document.head.appendChild(s);
}

// Resolve to a fresh single-use verification token, or null if unobtainable.
function _getSyncToken() {
  return new Promise((resolve) => {
    if (!_guardReady || _guardId === null || typeof turnstile === 'undefined') { resolve(null); return; }
    _guardPending = resolve;
    try { turnstile.reset(_guardId); } catch (_) {}
    try {
      turnstile.execute('#cloud-sync-guard');
    } catch (_) {
      _guardPending = null; resolve(null); return;
    }
    // Safety net: never let a stuck check hang the flow.
    setTimeout(() => { if (_guardPending) { const r = _guardPending; _guardPending = null; r(null); } }, 20000);
  });
}

// Stable save label = whose plan this is, resolved from the DATA — NOT from the
// "My Player" text field (which the player can type wrong). Two passes:
//   1) The owner of the loaded "My Villages", looked up in the world DB by village
//      id (then coords) → player. Whoever owns the most loaded villages wins, so the
//      SAME player always yields the SAME filename (the newest copy overwrites cleanly;
//      snapshots group under one op).
//   2) If no villages resolve yet (e.g. only a target plan has been imported), the
//      dominant sender across the targets' requirements — the player set to launch the
//      most attacks — which for a personal plan paste is the player themselves.
// Falls back to 'planner' when nothing resolves (keeps a sane name in every case).
function _cloudLabel() {
  try {
    if (typeof DATA !== 'undefined' && Array.isArray(DATA.villages) && DATA.villages.length
        && typeof villageDb !== 'undefined' && Array.isArray(villageDb) && villageDb.length) {
      const counts = {};
      for (const v of DATA.villages) {
        let dbv = null;
        if (v.villageId) dbv = villageDb.find(d => String(d.id) === String(v.villageId));
        if (!dbv && v.x && v.y) dbv = villageDb.find(d => d.x === v.x && d.y === v.y);
        const owner = (dbv && typeof playerMap !== 'undefined') ? (playerMap[dbv.playerId] || '') : '';
        if (owner) counts[owner] = (counts[owner] || 0) + 1;
      }
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      if (top) return top;
    }
  } catch (_) {}
  try {
    if (typeof DATA !== 'undefined' && Array.isArray(DATA.targets)) {
      // Exclude the "My Player" field's value: importPlayerPlan backfills blank
      // attackers with DATA.settings.playerName, so counting it would let the
      // untrusted input field become the label (exactly what we must never do). A
      // real sender from the plan's "===== NAME =====" headers is kept; a headerless
      // self-paste with nothing else to go on falls through to 'planner'.
      const me = ((DATA.settings && DATA.settings.playerName) || '').trim();
      const counts = {};
      for (const tg of DATA.targets) {
        for (const r of (tg.requirements || [])) {
          const a = (r.attacker || '').trim();
          if (a && a !== me) counts[a] = (counts[a] || 0) + 1;
        }
      }
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      if (top) return top;
    }
  } catch (_) {}
  return 'planner';
}

// Active game world → the storage folder the sync lands in. Derived from the configured
// server URL (es103.guerrastribales.es → es103). Falls back to es103 (the only world so
// far) so the path stays stable if nothing is set yet.
function _cloudWorld() {
  try {
    const url = (typeof DATA !== 'undefined' && DATA.settings && DATA.settings.serverUrl)
      ? String(DATA.settings.serverUrl) : '';
    const m = url.match(/([a-z]{2}\d+)/i);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return 'es103';
}

// Cloud-save the full attack-plan state — the exact object the manual "↓ Export"
// button serialises (DATA: villages, targets, attacks, settings). Best-effort:
// never alerts, never blocks the UI, swallows every error. When opened locally it
// returns immediately (no network, keeps file:// clean). MINIFIED (no indent) to
// keep the payload small against the endpoint's size cap.
async function cloudSyncPlan() {
  if (typeof TW_ENV === 'undefined' || TW_ENV !== 'production') return; // local = no-op
  if (typeof DATA === 'undefined') return;
  let jsonText;
  try { jsonText = JSON.stringify(DATA); }
  catch (_) { return; } // couldn't serialise the state — skip
  if (!jsonText || !jsonText.trim()) return;
  try {
    const token = await _getSyncToken();
    if (!token) return; // couldn't verify a real browser — skip
    const payload = { name: _cloudLabel(), content: jsonText, token, kind: 'attack_plan', world: _cloudWorld() };
    // NOTE: do NOT set keepalive:true here. Browsers cap keepalive fetch bodies at
    // 64 KB total; a full plan export can exceed that, and keepalive then makes
    // fetch() throw before the request ever leaves the browser (swallowed below → the
    // endpoint never receives it). A normal fetch has no size cap. The sync fires
    // right after a save while the player is using the tool, so the tab staying open
    // long enough isn't a concern.
    await _cloudFetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) { /* best-effort sync — ignore all failures */ }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initCloudSync);
  } else {
    _initCloudSync();
  }
}
