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

  function load() {
    loadProtCoords().then(function () { return TW.apiFetch(HIST_PATH); }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (db) {
      if (!db || !Array.isArray(db.reports)) throw new Error("respuesta inesperada");
      updated = db.updated || null;
      all = db.reports.filter(function (r) { return r && r.reportTimestamp; });
      all.sort(function (a, b) { return (b.reportTimestamp || 0) - (a.reportTimestamp || 0); });
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
    $("histList").addEventListener("toggle", histToggle, true); // toggle doesn't bubble
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
