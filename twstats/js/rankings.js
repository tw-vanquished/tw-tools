/* Rankings page — sortable, paginated table of all players or tribes.
   Classic script; needs common.js first. ?mode=players (default) | tribes. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var PAGE_SIZE = 100;

  // Column configs. get()=sort value; cell()=html; dir="asc"|"desc" default.
  function numTd(v) { return "<td class='col-pts'>" + TW.commas(v) + "</td>"; }
  function ptsCell(row) { return numTd(row.points); }
  // Δ points over 7 days — its own sortable column (nulls sink on desc).
  var DP7 = {
    label: "Δ 7d", cls: "col-pts", dir: "desc",
    get: function (r) { return r.dp7 == null ? -Infinity : r.dp7; },
    cell: function (r) { return "<td class='col-pts'>" + TW.deltaCell(r.dp7) + "</td>"; },
  };
  var COLS = {
    players: [
      { label: "Ranking", cls: "col-rank", dir: "asc", get: function (r) { return r.rank; }, cell: function (r) { return "<td class='col-rank'>" + r.rank + ".</td>"; } },
      { label: "Jugador", dir: "asc", get: function (r) { return (r.name || "").toLowerCase(); }, cell: function (r) { return "<td>" + TW.playerLink(r.id, r.name) + "</td>"; } },
      { label: "Tribu", dir: "asc", get: function (r) { return r.tribe ? (r.tribe.tag || "").toLowerCase() : "￿"; }, cell: function (r) { return "<td>" + (r.tribe ? TW.tribeLink(r.tribe.id, r.tribe.tag) : '<span class="barb">—</span>') + "</td>"; } },
      { label: "Puntos", cls: "col-pts", dir: "desc", get: function (r) { return r.points; }, cell: ptsCell },
      DP7,
      { label: "Pueblos", cls: "col-pts", dir: "desc", get: function (r) { return r.villages; }, cell: function (r) { return numTd(r.villages); } },
      { label: "OD Total", cls: "col-pts", dir: "desc", get: function (r) { return r.od_total; }, cell: function (r) { return numTd(r.od_total); } },
      { label: "OD Att", cls: "col-pts", dir: "desc", get: function (r) { return r.od_att; }, cell: function (r) { return numTd(r.od_att); } },
      { label: "OD Def", cls: "col-pts", dir: "desc", get: function (r) { return r.od_def; }, cell: function (r) { return numTd(r.od_def); } },
      { label: "OD Sup", cls: "col-pts", dir: "desc", get: function (r) { return r.od_sup; }, cell: function (r) { return numTd(r.od_sup); } },
    ],
    tribes: [
      { label: "Ranking", cls: "col-rank", dir: "asc", get: function (r) { return r.rank; }, cell: function (r) { return "<td class='col-rank'>" + r.rank + ".</td>"; } },
      { label: "Tribu", dir: "asc", get: function (r) { return (r.tag || "").toLowerCase(); }, cell: function (r) { return "<td>" + TW.tribeLink(r.id, r.tag) + "</td>"; } },
      { label: "Miembros", cls: "col-pts", dir: "desc", get: function (r) { return r.members; }, cell: function (r) { return numTd(r.members); } },
      { label: "Puntos", cls: "col-pts", dir: "desc", get: function (r) { return r.points; }, cell: ptsCell },
      DP7,
      { label: "Pueblos", cls: "col-pts", dir: "desc", get: function (r) { return r.villages; }, cell: function (r) { return numTd(r.villages); } },
      { label: "OD Total", cls: "col-pts", dir: "desc", get: function (r) { return r.od_total; }, cell: function (r) { return numTd(r.od_total); } },
      { label: "OD Att", cls: "col-pts", dir: "desc", get: function (r) { return r.od_att; }, cell: function (r) { return numTd(r.od_att); } },
      { label: "OD Def", cls: "col-pts", dir: "desc", get: function (r) { return r.od_def; }, cell: function (r) { return numTd(r.od_def); } },
      { label: "OD Sup", cls: "col-pts", dir: "desc", get: function (r) { return r.od_sup; }, cell: function (r) { return numTd(r.od_sup); } },
    ],
  };

  var state = { mode: "players", cols: null, data: [], filtered: [], sort: 0, dir: "asc", query: "", page: 0 };

  function readMode() {
    var m = /[?&]mode=(\w+)/.exec(location.search);
    return (m && m[1] === "tribes") ? "tribes" : "players";
  }

  function matches(r) {
    if (!state.query) return true;
    var hay = (state.mode === "tribes")
      ? (r.tag || "") + " " + (r.name || "")
      : (r.name || "") + " " + (r.tribe ? r.tribe.tag : "");
    return hay.toLowerCase().indexOf(state.query) !== -1;
  }

  function sortData() {
    var col = state.cols[state.sort], mul = state.dir === "asc" ? 1 : -1;
    state.filtered.sort(function (a, b) {
      var va = col.get(a), vb = col.get(b);
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return a.rank - b.rank; // stable tiebreak
    });
  }

  function applyFilter() {
    state.filtered = state.data.filter(matches);
    sortData();
    state.page = 0;
  }

  function renderHead() {
    var html = "<tr>";
    for (var i = 0; i < state.cols.length; i++) {
      var c = state.cols[i];
      var arrow = i === state.sort ? (state.dir === "asc" ? " ▲" : " ▼") : "";
      html += "<th class='" + (c.cls || "") + " th-sort' data-col='" + i + "'>" +
        TW.esc(c.label) + "<span class='arrow'>" + arrow + "</span></th>";
    }
    html += "</tr>";
    $("thead").innerHTML = html;
  }

  function render() {
    renderHead();
    var total = state.filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var start = state.page * PAGE_SIZE;
    var slice = state.filtered.slice(start, start + PAGE_SIZE);

    var html = "";
    for (var i = 0; i < slice.length; i++) {
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>";
      for (var j = 0; j < state.cols.length; j++) html += state.cols[j].cell(slice[i]);
      html += "</tr>";
    }
    var span = state.cols.length;
    $("rows").innerHTML = html || "<tr class='r1'><td colspan='" + span + "' class='status'>Sin resultados.</td></tr>";

    $("pageInfo").textContent = total
      ? (start + 1) + "–" + Math.min(start + PAGE_SIZE, total) + " de " + total.toLocaleString()
      : "0";
    $("prev").disabled = state.page <= 0;
    $("next").disabled = state.page >= pages - 1;
    $("status").style.display = "none";
  }

  function setMode(mode) {
    state.mode = mode;
    state.cols = COLS[mode];
    state.sort = 0; state.dir = state.cols[0].dir;
    $("modeTitle").textContent = mode === "tribes" ? "Clasificación de tribus" : "Clasificación de jugadores";
    document.title = "es103 · " + (mode === "tribes" ? "Tribus" : "Jugadores");
    $("modePlayers").classList.toggle("active", mode === "players");
    $("modeTribes").classList.toggle("active", mode === "tribes");
    TW.renderNav(mode === "tribes" ? "tribus" : "jugadores");
  }

  function load(mode) {
    setMode(mode);
    $("status").style.display = "block";
    $("status").textContent = "Cargando…";
    TW.loadJSON(mode + ".json")
      .then(function (d) {
        state.data = d;
        applyFilter();
        render();
      })
      .catch(function (e) {
        $("status").textContent = "No se pudieron cargar los datos: " + e.message +
          "  (¿sirviendo por HTTP? file:// bloquea fetch)";
      });
  }

  function switchMode(mode) {
    if (mode === state.mode) return;
    history.replaceState(null, "", "rankings.html?mode=" + mode);
    state.query = ""; $("search").value = "";
    load(mode);
  }

  function init() {
    TW.loadJSON("meta.json").then(function (m) { $("worldName").textContent = m.world || TW.WORLD; }).catch(function () {});
    load(readMode());

    $("thead").addEventListener("click", function (e) {
      var th = e.target.closest ? e.target.closest(".th-sort") : null;
      if (!th) return;
      var i = +th.getAttribute("data-col");
      if (i === state.sort) state.dir = state.dir === "asc" ? "desc" : "asc";
      else { state.sort = i; state.dir = state.cols[i].dir; }
      sortData(); state.page = 0; render();
    });
    $("modePlayers").addEventListener("click", function () { switchMode("players"); });
    $("modeTribes").addEventListener("click", function () { switchMode("tribes"); });
    $("prev").addEventListener("click", function () { if (state.page > 0) { state.page--; render(); } });
    $("next").addEventListener("click", function () { state.page++; render(); });
    var t;
    $("search").addEventListener("input", function () {
      clearTimeout(t);
      var self = this;
      t = setTimeout(function () { state.query = self.value.trim().toLowerCase(); applyFilter(); render(); }, 180);
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
