/* twstats · Histórico Informes — the shared reports DB's FULL history
   (GET /reports-hist on the tw-calc-uploads Worker: every unique report ever
   uploaded, verbatim), listed newest → oldest with a coordinate filter that
   matches EITHER side of a report (defender village or attack origin).
   Report bodies render lazily via report-render.js on first expand — the
   store holds thousands of records, only the summaries exist up front. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }

  var HIST_PATH = "/reports-hist?world=es103"; // fetched via TW.apiFetch (hostname failover)
  var INDEX_PATH = "/reports-hist-index?world=es103"; // segment list (see fetchHist)
  var PAGE = 200; // summaries appended per «Mostrar más»

  // Protected allies (es103: 13 = WC.. / 27 = WC) — mirrors the calculator's
  // RI_PROTECTED_ALLIES and the Worker's PROTECTED_ALLIES var. The hist store
  // is served UNstripped (user ruling 2026-08-09); the protection here is
  // UI-level: a coord lookup of a village these tribes own shows nothing.
  var PROTECTED_ALLIES = {}; // none yet on es103

  var all = [];       // every record, sorted newest → oldest
  var view = [];      // current filter's slice of `all` (same order)
  var shown = 0;      // how many of `view` have summary rows in the DOM
  var updated = null; // store freshness stamp (ISO) for the count line
  var protCoords = {}; // "x|y" → 1 for villages currently owned by a protected player

  function coordOf(x, y) {
    return (typeof x === "number" && typeof y === "number") ? x + "|" + y : null;
  }

  // Filter box → "x|y" or null. Forgiving separators (500|500 / 500 500 /
  // 500,500); anything else non-empty is reported as unparseable by render().
  function parseCoord(raw) {
    var m = String(raw || "").match(/(\d{1,3})\s*[|,;: ]\s*(\d{1,3})/);
    return m ? (+m[1]) + "|" + (+m[2]) : null;
  }

  function applyFilter() {
    var raw = $("histCoord").value.trim();
    var coord = parseCoord(raw);
    if (raw && !coord) {
      $("histStatus").textContent = "Coordenada no reconocida — formato 500|500.";
      return;
    }
    $("histStatus").textContent = "";
    view = !coord ? all
      : protCoords[coord] ? [] // protected village — its lookup shows nothing
      : all.filter(function (r) {
          return coordOf(r.attackerX, r.attackerY) === coord ||
                 coordOf(r.defenderX, r.defenderY) === coord;
        });
    shown = 0;
    $("histList").innerHTML = "";
    renderMore();
    var line = TW.commas(all.length) + " informes únicos";
    if (coord) line += " · " + view.length + " de " + coord;
    if (pending.length && all.length) {
      line += " · cargados desde el " + TWRR.fmtT(all[all.length - 1].reportTimestamp).slice(0, 8);
    }
    if (updated && typeof riAge === "function") {
      line += " · BD actualizada hace " + riAge(Date.now(), Date.parse(updated));
    }
    $("histLine").textContent = line + ".";
  }

  // Append the next PAGE summaries of `view`. Bodies stay unrendered until
  // the row is opened (histToggle) — data-i indexes into `view`.
  function renderMore() {
    var frag = "";
    var end = Math.min(view.length, shown + PAGE);
    for (var i = shown; i < end; i++) {
      var r = view[i];
      frag += '<details class="twrr-item" data-i="' + i + '"><summary>' +
        TWRR.fmtT(r.reportTimestamp) + " · " + TWRR.subjectLine(r) + "</summary></details>";
    }
    $("histList").insertAdjacentHTML("beforeend", frag);
    shown = end;
    $("histMoreWrap").hidden = shown >= view.length;
    $("histMore").textContent = "Mostrar más (" + (view.length - shown) + " restantes)";
  }

  function histToggle(e) {
    var d = e.target;
    if (!d || d.className !== "twrr-item" || !d.open || d.childElementCount > 1) return;
    var r = view[+d.getAttribute("data-i")];
    if (r) d.insertAdjacentHTML("beforeend", TWRR.reportHtml(r));
  }

  // Resolve the protected tribes' current villages from the public world-data
  // mirrors (same files the Worker's own filter reads). Best-effort: the raw
  // JSON is public regardless, so a failed load just skips the UI block —
  // never the page.
  function loadProtCoords() {
    return Promise.all([
      fetch("../data/es103/player.txt").then(function (r) { return r.ok ? r.text() : ""; }),
      fetch("../data/es103/village.txt").then(function (r) { return r.ok ? r.text() : ""; }),
    ]).then(function (res) {
      var members = {}; // playerId → 1 for members of the protected allies
      res[0].split("\n").forEach(function (line) {
        var p = line.split(",");
        if (p.length >= 3 && p[0] && PROTECTED_ALLIES[p[2].trim()]) members[p[0].trim()] = 1;
      });
      res[1].split("\n").forEach(function (line) {
        var p = line.split(","); // id,name,x,y,player,points
        if (p.length >= 5 && members[p[4].trim()]) protCoords[(+p[2]) + "|" + (+p[3])] = 1;
      });
    }).catch(function () { /* best-effort — see above */ });
  }

  // Timeouts + hostname failover live in TW.apiFetch (common.js).
  function getJson(pathQuery) {
    return TW.apiFetch(pathQuery).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  // The store is cut into half-month segments since 2026-09-24 (one 41 MB file
  // no longer fit the Worker): read the segment list, then the segments newest
  // first, SEG_PARALLEL at a time, until INITIAL reports are in — the rest
  // waits behind «Cargar meses anteriores» (the whole store is ~40 MB; most
  // lookups want recent battles). Not all at once: concurrent calls can share
  // one Worker isolate's memory, and ten parallel ~10 MB reads would rebuild
  // the very peak the split removed. A Worker without the index (older deploy
  // / pre-migration) answers 404 or no segments → the monolithic
  // GET /reports-hist, as before, with nothing left to load later.
  var SEG_PARALLEL = 2;
  var INITIAL = 10000;   // reports to have loaded before stopping (by index counts)
  var pending = [];      // older segments not loaded yet ({key, count}), newest first

  // Fetch `segs` (newest first) SEG_PARALLEL at a time → their reports
  // concatenated. `onBatch(reports, doneSegs, i)` fires as each batch lands so
  // the caller can absorb progressively; a failing batch rejects with
  // `err.remaining` = the segments not fetched yet (that batch included).
  function fetchSegs(segs, onBatch) {
    var reports = [];
    function batch(i) {
      if (i >= segs.length) return reports;
      var slice = segs.slice(i, i + SEG_PARALLEL);
      return Promise.all(slice.map(function (s) {
        return getJson(HIST_PATH + "&seg=" + encodeURIComponent(s.key));
      })).then(function (parts) {
        var got = [];
        parts.forEach(function (p) { if (p && Array.isArray(p.reports)) got = got.concat(p.reports); });
        reports = reports.concat(got);
        if (onBatch) onBatch(got, slice, i + slice.length);
        return batch(i + SEG_PARALLEL);
      }, function (e) {
        e.remaining = segs.slice(i);
        throw e;
      });
    }
    return batch(0);
  }

  // → { updated, reports, pending } (pending = the segments NOT fetched yet).
  function fetchHist() {
    return getJson(INDEX_PATH).catch(function () { return null; }).then(function (idx) {
      var segs = idx && idx.ok && Array.isArray(idx.segments) ? idx.segments : [];
      if (!segs.length) return getJson(HIST_PATH);
      var first = [], later = [], n = 0;
      segs.forEach(function (s) {
        if (n < INITIAL) { first.push(s); n += +s.count || 0; }
        else later.push(s);
      });
      return fetchSegs(first).then(function (reports) {
        return { updated: idx.updated || null, reports: reports, pending: later };
      });
    });
  }

  function pendingCount() {
    return pending.reduce(function (n, s) { return n + (+s.count || 0); }, 0);
  }
  function renderOlder() {
    var wrap = $("histOlderWrap");
    if (!wrap) return;
    wrap.hidden = !pending.length;
    if (pending.length) {
      $("histOlder").textContent = "Cargar meses anteriores (" + TW.commas(pendingCount()) + " informes)";
    }
  }
  function absorb(reports) {
    all = all.concat(reports.filter(function (r) { return r && r.reportTimestamp; }));
    all.sort(function (a, b) { return (b.reportTimestamp || 0) - (a.reportTimestamp || 0); });
  }
  function loadOlder() {
    if (!pending.length) return;
    var segs = pending; pending = [];
    var total = segs.reduce(function (n, s) { return n + (+s.count || 0); }, 0);
    $("histOlder").disabled = true;
    $("histOlder").textContent = "Cargando " + TW.commas(total) + " informes… 0/" + segs.length;
    // Each batch is absorbed as it arrives — what loaded stays loaded even if a
    // later segment fails or stalls; only the rest is offered again.
    fetchSegs(segs, function (reports, done, n) {
      absorb(reports);
      $("histOlder").textContent = "Cargando " + TW.commas(total) + " informes… " + n + "/" + segs.length;
      applyFilter();
    }).then(function () {
      $("histOlder").disabled = false;
      renderOlder();
      applyFilter();
    }).catch(function (e) {
      pending = e.remaining || segs;
      $("histOlder").disabled = false;
      renderOlder();
      applyFilter();
      $("histStatus").textContent = "No se pudieron cargar todos los meses anteriores (" + e.message + ") — vuelve a intentarlo.";
    });
  }

  var loadGen = 0; // only the LATEST load may write state (absorb appends)
  function load() {
    var gen = ++loadGen;
    loadProtCoords().then(fetchHist).then(function (db) {
      if (gen !== loadGen) return; // superseded by a newer load
      if (!db || !Array.isArray(db.reports)) throw new Error("respuesta inesperada");
      updated = db.updated || null;
      all = []; pending = Array.isArray(db.pending) ? db.pending : [];
      absorb(db.reports);
      renderOlder();
      applyFilter();
    }).catch(function (e) {
      $("histLine").textContent = "Histórico no disponible ahora mismo (" + e.message + ").";
    });
  }

  var debounce = null;
  function init() {
    TW.renderNav("historico");
    $("histCoord").addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(applyFilter, 200);
    });
    $("histClear").addEventListener("click", function () {
      $("histCoord").value = "";
      applyFilter();
    });
    $("histMore").addEventListener("click", renderMore);
    if ($("histOlder")) $("histOlder").addEventListener("click", loadOlder);
    $("histList").addEventListener("toggle", histToggle, true); // toggle doesn't bubble
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
