/* Conquers / ennoblements browser — Phase 1 of the twstats-style history site.
   Classic script (no modules). Loads decoded conquer JSON built by tw_world_data/build.py.
   Layout/columns/filters reproduced from es.twstats.com ennoblements page.
   Shared helpers now live in js/common.js (global TW), loaded before this file. */
(function () {
  "use strict";

  var WORLD = TW.WORLD;
  var PAGE_SIZE = 100;

  var state = {
    scope: "recent",   // "recent" | "all"
    all: null,
    recent: null,
    filtered: [],
    query: "", minp: null, maxp: null, tribe: 0,
    page: 0,
  };

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl, statusEl, pageInfo;

  // --- formatting / cell renderers (shared) ---
  var fmtTime = TW.fmtTime, fmtStamp = TW.fmtStamp;
  var esc = TW.esc, commas = TW.commas, continent = TW.continent;
  var villageHtml = TW.villageCell, ownerHtml = TW.ownerCell;
  var loadJSON = TW.loadJSON;

  // --- filtering ---
  function tribeOf(o) { return o && o.tribe ? o.tribe.id : null; }
  function matches(r) {
    if (state.tribe && state.tribe !== "0") {
      if (String(tribeOf(r.oldOwner)) !== state.tribe && String(tribeOf(r.newOwner)) !== state.tribe) return false;
    }
    var pts = r.village.points;
    if (state.minp != null) { if (pts == null || pts < state.minp) return false; }
    if (state.maxp != null) { if (pts == null || pts > state.maxp) return false; }
    var q = state.query;
    if (q) {
      var hay = (r.village.name || "");
      if (r.village.x != null) hay += " " + r.village.x + "|" + r.village.y + " " + continent(r.village.x, r.village.y);
      [r.oldOwner, r.newOwner].forEach(function (o) {
        if (o) hay += " " + (o.name || "") + " " + (o.tribe ? o.tribe.tag : "");
      });
      if (hay.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }
  function applyFilter() {
    var src = state.scope === "all" ? state.all : state.recent;
    state.filtered = src ? src.filter(matches) : [];
    state.page = 0;
  }

  // --- render ---
  function render() {
    var total = state.filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var start = state.page * PAGE_SIZE;
    var slice = state.filtered.slice(start, start + PAGE_SIZE);

    var html = "";
    for (var i = 0; i < slice.length; i++) {
      var r = slice[i];
      var pts = r.village.points != null ? commas(r.village.points) : "?";
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td>" + villageHtml(r.village) + "</td>" +
        "<td class='col-pts'>" + pts + "</td>" +
        "<td>" + ownerHtml(r.oldOwner) + "</td>" +
        "<td>" + ownerHtml(r.newOwner) + "</td>" +
        "<td class='col-date'>" + fmtStamp(r.t) + "</td></tr>";
    }
    rowsEl.innerHTML = html || "<tr class='r1'><td colspan='5' class='status'>Sin resultados.</td></tr>";

    pageInfo.textContent = total
      ? (start + 1) + "–" + Math.min(start + PAGE_SIZE, total) + " de " + total.toLocaleString()
      : "0";
    $("prev").disabled = state.page <= 0;
    $("next").disabled = state.page >= pages - 1;
    statusEl.style.display = "none";
  }

  // --- data loading ---
  function ensureLoaded(scope) {
    if (scope === "all" && !state.all) {
      statusEl.style.display = "block";
      statusEl.textContent = "Cargando historial completo…";
      return loadJSON("conquers.json").then(function (d) { state.all = d; });
    }
    return Promise.resolve();
  }
  function setScope(scope) {
    state.scope = scope;
    $("scopeRecent").classList.toggle("active", scope === "recent");
    $("scopeAll").classList.toggle("active", scope === "all");
    ensureLoaded(scope).then(function () { applyFilter(); render(); });
  }

  function fillTribes(tribes) {
    if (!tribes || !tribes.length) return;
    var sel = $("filtertribe"), html = '<option value="0">Sin filtro</option>';
    for (var i = 0; i < tribes.length; i++) {
      html += '<option value="' + esc(tribes[i].id) + '">' + esc(tribes[i].tag) + "</option>";
    }
    sel.innerHTML = html;
  }

  // --- wire up ---
  function init() {
    TW.renderNav("ennoblecimientos");
    rowsEl = $("rows"); statusEl = $("status"); pageInfo = $("pageInfo");

    Promise.all([loadJSON("meta.json"), loadJSON("conquers-recent.json")])
      .then(function (res) {
        var meta = res[0];
        state.recent = res[1];
        $("worldName").textContent = meta.world || WORLD;
        fillTribes(meta.tribes);
        var pulled = meta.pulledUnix ? fmtTime(meta.pulledUnix) : (meta.newestConquer ? fmtTime(meta.newestConquer) : "?");
        var newest = meta.newestConquer ? fmtTime(meta.newestConquer) : "?";
        $("metaLine").textContent = meta.conquers.toLocaleString() +
          " ennoblecimientos archivados · datos obtenidos " + pulled +
          " · último ennoblecimiento " + newest;
        applyFilter();
        render();
      })
      .catch(function (e) {
        statusEl.textContent = "No se pudieron cargar los datos: " + e.message +
          "  (¿sirviendo por HTTP? file:// bloquea fetch)";
      });

    function num(v) { v = v.trim(); return v === "" ? null : (isNaN(+v) ? null : +v); }
    function refilter() { applyFilter(); render(); }
    var t;
    $("search").addEventListener("input", function () {
      clearTimeout(t);
      var self = this;
      t = setTimeout(function () { state.query = self.value.trim().toLowerCase(); refilter(); }, 180);
    });
    $("minpoints").addEventListener("input", function () { state.minp = num(this.value); refilter(); });
    $("maxpoints").addEventListener("input", function () { state.maxp = num(this.value); refilter(); });
    $("filtertribe").addEventListener("change", function () { state.tribe = this.value; refilter(); });
    $("scopeRecent").addEventListener("click", function () { setScope("recent"); });
    $("scopeAll").addEventListener("click", function () { setScope("all"); });
    $("prev").addEventListener("click", function () { if (state.page > 0) { state.page--; render(); } });
    $("next").addEventListener("click", function () { state.page++; render(); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
