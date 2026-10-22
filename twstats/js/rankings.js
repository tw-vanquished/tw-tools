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

  // OD mode (?mode=od&who=players|tribes&kind=all|att|def|sup): «Adversarios
  // vencidos» rankings from the same players.json / tribes.json. v1 is
  // frontend-only: «Rango OD» is the position by that OD in the archived data
  // (competition ranking — ties share a place), not the official OD rank, and
  // there is no OD Δ7d (both would need build.py). No OD → bottom, «—».
  var OD_KINDS = {
    all: { key: "od_total", label: "Total" }, att: { key: "od_att", label: "Atacante" },
    def: { key: "od_def", label: "Defensor" }, sup: { key: "od_sup", label: "Apoyo" },
  };
  function odVal(r) {
    var v = r[OD_KINDS[state.kind].key];
    return v == null || v === "" ? null : +v;
  }
  function odCols(who, kind) {
    var nameCol = who === "tribes" ? COLS.tribes[1] : COLS.players[1];
    var cols = [
      { label: "Rango OD", cls: "col-rank", dir: "asc", nullLast: true,
        get: function (r) { return r._odRank; },
        cell: function (r) { return "<td class='col-rank'>" + (r._odRank == null ? '<span class="barb">—</span>' : r._odRank + ".") + "</td>"; } },
      nameCol,
    ];
    if (who === "players") cols.push(COLS.players[2]);   // Tribu
    cols.push({
      label: "OD " + OD_KINDS[kind].label, cls: "col-pts", dir: "desc", nullLast: true,
      get: odVal,
      cell: function (r) { var v = odVal(r); return v == null ? "<td class='col-pts'><span class='barb'>—</span></td>" : numTd(v); },
    });
    cols.push({ label: "Puntos", cls: "col-pts", dir: "desc", get: function (r) { return r.points; }, cell: ptsCell });
    return cols;
  }
  // Competition ranking by the current OD kind: 1, 2, 2, 4 …; no OD → null.
  function rankByOd(data) {
    var withOd = data.filter(function (r) { return odVal(r) != null; })
      .sort(function (a, b) { return odVal(b) - odVal(a); });
    data.forEach(function (r) { r._odRank = null; });
    for (var i = 0; i < withOd.length; i++) {
      withOd[i]._odRank = (i && odVal(withOd[i]) === odVal(withOd[i - 1])) ? withOd[i - 1]._odRank : i + 1;
    }
  }

  // Archivo mode (?mode=archive&who=players|tribes): the players / tribes that
  // left the world, from players-archive.json / tribes-archive.json (build.py:
  // last snapshot + bests), newest «Visto por última vez» first. lastSeen is a
  // daily bucket, so it is labelled by its UTC day. Names open the archived page.
  function lastSeenCol() {
    return { label: "Visto por última vez", cls: "col-date", dir: "desc",
      get: function (r) { return r.lastSeen; },
      cell: function (r) { return "<td class='col-date'>" + TW.fmtDayUTC(r.lastSeen) + "</td>"; } };
  }
  function numCol(label, key, dir) {
    return { label: label, cls: "col-pts", dir: dir || "desc", get: function (r) { return r[key]; },
      cell: function (r) { return numTd(r[key]); } };
  }
  var ARCH_TAIL = [
    numCol("Últimos puntos", "lastPoints"), numCol("Últimos pueblos", "lastVillages"),
    { label: "Mejor ranking", cls: "col-rank", dir: "asc", get: function (r) { return r.bestRank; },
      cell: function (r) { return "<td class='col-rank'>" + r.bestRank + ".</td>"; } },
    numCol("Máx. puntos", "maxPoints"), numCol("Conquistas", "conquests"), numCol("Perdidos", "lost"),
  ];
  var ARCH_COLS = {
    players: [lastSeenCol(), COLS.players[1],
      { label: "Última tribu", dir: "asc", get: function (r) { return r.lastTribe ? (r.lastTribe.tag || "").toLowerCase() : "￿"; },
        cell: function (r) { return "<td>" + (r.lastTribe ? TW.tribeLink(r.lastTribe.id, r.lastTribe.tag) : '<span class="barb">—</span>') + "</td>"; } },
    ].concat(ARCH_TAIL),
    tribes: [lastSeenCol(), COLS.tribes[1],
      { label: "Nombre", dir: "asc", get: function (r) { return (r.name || "").toLowerCase(); },
        cell: function (r) { return "<td>" + TW.esc(r.name || "") + "</td>"; } },
    ].concat(ARCH_TAIL),
  };

  var state = { mode: "players", who: "players", kind: "all", cols: null, data: [], filtered: [], sort: 0, dir: "asc", query: "", page: 0 };

  function readParam(name, allowed, dflt) {
    var m = new RegExp("[?&]" + name + "=(\\w+)").exec(location.search);
    return (m && allowed.indexOf(m[1]) !== -1) ? m[1] : dflt;
  }
  function readMode() { return readParam("mode", ["players", "tribes", "od", "archive"], "players"); }
  // players or tribes — in OD and Archivo mode the «… de» seg picks it.
  function entity() { return state.mode === "od" || state.mode === "archive" ? state.who : state.mode; }
  function fileName() { return entity() + (state.mode === "archive" ? "-archive" : "") + ".json"; }
  function modeUrl() {
    return "rankings.html?mode=" + state.mode +
      (state.mode === "od" ? "&who=" + state.who + "&kind=" + state.kind : "") +
      (state.mode === "archive" ? "&who=" + state.who : "");
  }

  function matches(r) {
    if (!state.query) return true;
    var tribe = r.tribe || r.lastTribe;   // archived players carry their last tribe
    var hay = (entity() === "tribes")
      ? (r.tag || "") + " " + (r.name || "")
      : (r.name || "") + " " + (tribe ? tribe.tag : "");
    return hay.toLowerCase().indexOf(state.query) !== -1;
  }

  function sortData() {
    var col = state.cols[state.sort], mul = state.dir === "asc" ? 1 : -1;
    state.filtered.sort(function (a, b) {
      var va = col.get(a), vb = col.get(b);
      // nullLast: a null value sinks in both directions (OD mode's «—» rows).
      if (col.nullLast && (va == null) !== (vb == null)) return va == null ? 1 : -1;
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return (a.rank || 0) - (b.rank || 0) || (+a.id) - (+b.id); // stable tiebreak (archive rows have no rank)
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
    var od = mode === "od", archive = mode === "archive", ent = entity();
    state.cols = od ? odCols(state.who, state.kind) : archive ? ARCH_COLS[ent] : COLS[mode];
    state.sort = 0; state.dir = state.cols[0].dir;
    $("modeTitle").textContent = od
      ? "Adversarios vencidos (" + OD_KINDS[state.kind].label.toLowerCase() + ") — " + (ent === "tribes" ? "tribus" : "jugadores")
      : archive ? "Archivo — " + (ent === "tribes" ? "tribus" : "jugadores")
      : (mode === "tribes" ? "Clasificación de tribus" : "Clasificación de jugadores");
    document.title = "es103 · " + (od ? "OD " + OD_KINDS[state.kind].label + " · " : archive ? "Archivo · " : "") +
      (ent === "tribes" ? "Tribus" : "Jugadores");
    $("modePlayers").classList.toggle("active", mode === "players");
    $("modeTribes").classList.toggle("active", mode === "tribes");
    if ($("modeOd")) $("modeOd").classList.toggle("active", od);
    if ($("modeArchive")) $("modeArchive").classList.toggle("active", archive);
    ["odWho", "odKind", "odNote"].forEach(function (id) { if ($(id)) $(id).hidden = !od; });
    ["archWho", "archNote"].forEach(function (id) { if ($(id)) $(id).hidden = !archive; });
    var segs = document.querySelectorAll("[data-who], [data-kind]");
    for (var i = 0; i < segs.length; i++) {
      var w = segs[i].getAttribute("data-who"), k = segs[i].getAttribute("data-kind");
      segs[i].classList.toggle("active", w ? w === state.who : k === state.kind);
    }
    TW.renderNav(ent === "tribes" ? "tribus" : "jugadores");
  }

  function load(mode) {
    setMode(mode);
    $("status").style.display = "block";
    $("status").textContent = "Cargando…";
    var file = fileName();
    TW.loadJSON(file)
      .then(function (d) {
        if (fileName() !== file) return;   // a newer switch is loading
        state.data = d;
        if (state.mode === "od") rankByOd(state.data);
        applyFilter();
        render();
      })
      .catch(function (e) {
        if (fileName() !== file) return;
        // Data built before the archive files existed: say so, empty table.
        if (state.mode === "archive" && /HTTP 404/.test(e.message)) {
          state.data = []; applyFilter(); render();
          $("status").style.display = "block";
          $("status").textContent = "El archivo aún no está disponible: se publica con la próxima actualización de los datos.";
          return;
        }
        $("status").textContent = "No se pudieron cargar los datos: " + e.message +
          "  (¿sirviendo por HTTP? file:// bloquea fetch)";
      });
  }

  function switchMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    history.replaceState(null, "", modeUrl());
    state.query = ""; $("search").value = "";
    load(mode);
  }
  // OD / Archivo segs: a new «OD de» / «Archivo de» reloads the other file; a
  // new «Tipo» only re-ranks the loaded rows (same file). The search box is kept.
  function setOd(who, kind) {
    if ((state.mode !== "od" && state.mode !== "archive") || (who === state.who && kind === state.kind)) return;
    var reload = who !== state.who;
    state.who = who; state.kind = kind;
    history.replaceState(null, "", modeUrl());
    if (reload) { state.data = []; load(state.mode); return; }
    setMode("od");
    rankByOd(state.data);
    applyFilter();
    render();
  }

  function init() {
    TW.loadJSON("meta.json").then(function (m) { $("worldName").textContent = m.world || TW.WORLD; }).catch(function () {});
    state.who = readParam("who", ["players", "tribes"], "players");
    state.kind = readParam("kind", ["all", "att", "def", "sup"], "all");
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
    if ($("modeOd")) $("modeOd").addEventListener("click", function () { switchMode("od"); });
    if ($("modeArchive")) $("modeArchive").addEventListener("click", function () { switchMode("archive"); });
    var segs = document.querySelectorAll("[data-who], [data-kind]");
    for (var i = 0; i < segs.length; i++) {
      segs[i].addEventListener("click", function () {
        setOd(this.getAttribute("data-who") || state.who, this.getAttribute("data-kind") || state.kind);
      });
    }
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
