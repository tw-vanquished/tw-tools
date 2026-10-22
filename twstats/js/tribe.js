/* Tribe profile page. Classic script; needs common.js + chart.js first.
   Reads ?id=X, loads tribes/X.json (profile/series/memberList/gains/losses). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var CONQ_PAGE = 200;  // conquest rows per page (tribes can have 8,000+)
  var PAGE_SIZE = 100;
  var GALLY = "https://" + TW.WORLD + ".guerrastribales.es/page.php?page=inbound&screen=info_ally&id=";
  var vstate = { list: [], page: 0 };
  var hasInternal = false;  // any member→member transfer (shows the Internas section under "Todo")
  var arch = null;  // TW.playerArchive() map: archived owners link to their page here

  function qid() {
    var m = /[?&]id=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function row(label, valueHtml, star) {
    return "<tr><th class='pl'>" + TW.esc(label) + (star ? "&nbsp;*" : "") +
      "</th><td>" + valueHtml + "</td></tr>";
  }

  // A profile number that jumps to another tab (optionally with a conquest filter).
  function jump(tab, conq, text) {
    return '<a href="#" data-tab-go="' + tab + '"' +
      (conq ? ' data-conq="' + conq + '"' : "") + ">" + text + "</a>";
  }

  // build.py files a village passed between two members of the tribe in BOTH
  // gains and losses (the same record): show it once, as an internal transfer,
  // so the total doesn't count it twice and the losses are real losses.
  function splitConquests(d, id) {
    function tid(o) { return o && o.tribe ? o.tribe.id : null; }
    var gains = d.gains || [], losses = d.losses || [];
    return {
      gains: gains.filter(function (c) { return tid(c.oldOwner) !== id; }),
      losses: losses.filter(function (c) { return tid(c.newOwner) !== id; }),
      internal: gains.filter(function (c) { return tid(c.oldOwner) === id; }),
    };
  }

  // Conquistas = external gains + external losses + internal transfers; each
  // number opens the section that lists exactly those rows. An archived tribe
  // (p.current false) keeps its last snapshot: «Último …» rows and its date.
  function renderProfile(p, cs, lastSeen) {
    var gone = !p.current;
    var nG = cs.gains.length, nL = cs.losses.length, nI = cs.internal.length;
    var conq = jump("conquistas", "all", TW.commas(nG + nL + nI)) +
      " (" + jump("conquistas", "gain", "+" + TW.commas(nG)) +
      " " + jump("conquistas", "lose", "−" + TW.commas(nL)) +
      (nI ? " " + jump("conquistas", "internal", "⟳" + TW.commas(nI)) : "") + ")";
    var html = "";
    html += row(gone ? "Último ranking" : "Ranking", p.rank + ".");
    html += row("Nombre", TW.esc(p.name));
    html += row("Tag", TW.esc(p.tag));
    html += row(gone ? "Últimos miembros" : "Miembros", gone ? TW.commas(p.members) : jump("miembros", null, TW.commas(p.members)));
    html += row(gone ? "Últimos puntos" : "Puntos", TW.commas(p.points));
    html += row(gone ? "Últimos pueblos" : "Pueblos", gone ? TW.commas(p.villages) : jump("pueblos", null, TW.commas(p.villages)));
    if (gone && lastSeen) html += row("Visto por última vez", TW.fmtDayUTC(lastSeen));
    html += row("Promedio de puntos por pueblo", TW.commas(p.avg));
    html += row("Conquistas", conq);
    html += row("Primera vez visto", TW.fmtDayUTC(p.firstSeen), true);  // = first daily bucket
    html += row("Mejor clasificación", p.bestRank + ".", true);
    html += row("Mayoría de puntos", TW.commas(p.maxPoints), true);
    html += row("Mayoría de pueblos", TW.commas(p.maxVillages), true);
    html += row("Adv. vencidos (Totales)", TW.commas(p.od_total));
    html += row("Adv. vencidos (Atacante)", TW.commas(p.od_att));
    html += row("Adv. vencidos (Defensor)", TW.commas(p.od_def));
    html += row("Adv. vencidos (Apoyo)", TW.commas(p.od_sup));
    html += row("Perfil en el juego",
      '<a href="' + GALLY + TW.esc(p.id) + '" target="_blank" rel="noopener">Abrir en el juego ›</a>');
    $("profileBody").innerHTML = html;
  }

  var METRICS = [
    { key: "points", label: "Puntos" },
    { key: "members", label: "Miembros" },
    { key: "villages", label: "Pueblos" },
    { key: "od_total", label: "OD" },
    { key: "od_att", label: "ODA" },
    { key: "od_def", label: "ODD" },
    { key: "od_sup", label: "ODS" },
    { key: "rank", label: "Ranking", invert: true },
  ];

  // timeX: points sit at their time, so days without a snapshot stay a gap.
  function renderCharts(series) {
    TW.metricChart($("perfilChart"), series, METRICS, { width: 460, height: 200, timeX: true, daily: true });
    TW.metricChart($("histChart"), series, METRICS, { width: 900, height: 280, timeX: true, daily: true });
  }

  // OD history cell. The kill files list only OD > 0, so an absent OD is 0;
  // only the oldest row (no prev) keeps changeCell's "+" baseline.
  function odCell(s, prev, key) {
    return TW.changeCell(s[key] || 0, prev ? (prev[key] || 0) : null);
  }

  // History rows newest→oldest; change prefixes vs the previous (older) snapshot.
  function renderHistory(series) {
    var html = "";
    for (var i = series.length - 1, k = 0; i >= 0; i--, k++) {
      var s = series[i], prev = i > 0 ? series[i - 1] : null;
      html += "<tr class='" + (k % 2 ? "r2" : "r1") + "'>" +
        "<td>" + TW.fmtDayUTC(s.t) + "</td>" +
        TW.changeCell(s.rank, prev && prev.rank, { invert: true }) +
        TW.changeCell(s.members, prev && prev.members) +
        TW.changeCell(s.points, prev && prev.points) +
        TW.changeCell(s.villages, prev && prev.villages) +
        odCell(s, prev, "od_total") + odCell(s, prev, "od_att") +
        odCell(s, prev, "od_def") + odCell(s, prev, "od_sup") +
        "</tr>";
    }
    $("historyBody").innerHTML = html || "<tr class='r1'><td colspan='9' class='status'>Sin datos.</td></tr>";
  }

  // Members summary (twstats "miembros" page): position-in-tribe, name, points,
  // villages, per-weekday gain (last 7 days) + 7-day total of the «Comparar»
  // metric. Each row's w7[metric] = {d7, t7} (build.py); a file without w7
  // (built before it) only has the points d7/t7 and hides the select.
  var COMPARE = {
    points: "puntos", villages: "pueblos", od_total: "OD (adversarios vencidos)",
    od_att: "ODA (OD atacante)", od_def: "ODD (OD defensor)", od_sup: "ODS (OD apoyo)",
  };
  var mstate = { list: [], weekDays: [], metric: "points", sort: "pos", dir: "asc" };

  function memberWeek(m) {
    var w = m.w7 && m.w7[mstate.metric];
    return w || { d7: m.d7 || [], t7: m.t7 };
  }
  // Sort keys of the clickable headers; Pos. = the rank in the tribe (list order).
  var MEMBER_SORT = {
    pos: function (m) { return m._pos; },
    points: function (m) { return m.points; },
    total: function (m) { var t = memberWeek(m).t7; return t == null ? -Infinity : t; },
  };

  function memberHeadCell(key, label, cls) {
    var arrow = mstate.sort === key ? (mstate.dir === "asc" ? " ▲" : " ▼") : "";
    return "<th class='" + cls + " th-sort' data-msort='" + key + "'>" + label +
      "<span class='arrow'>" + arrow + "</span></th>";
  }

  function renderMembers() {
    var weekDays = mstate.weekDays;
    var head = "<tr>" + memberHeadCell("pos", "Pos.", "col-rank") + "<th>Nombre</th>" +
      memberHeadCell("points", "Puntos", "col-pts") + "<th class='col-pts'>Pueblos</th>";
    for (var w = 0; w < weekDays.length; w++) {
      head += "<th class='col-pts'>" + TW.weekdayUTC(weekDays[w]) + "</th>";
    }
    head += memberHeadCell("total", "Total", "col-pts") + "</tr>";
    $("membersHead").innerHTML = head;
    $("membersNote").textContent = "Columnas de día = ganancia de " + COMPARE[mstate.metric] +
      " ese día (últimos 7 días); Total = ganancia de 7 días.";

    var get = MEMBER_SORT[mstate.sort], mul = mstate.dir === "asc" ? 1 : -1;
    var list = mstate.list.slice().sort(function (a, b) {
      return (get(a) - get(b)) * mul || a._pos - b._pos;
    });
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var m = list[i], wk = memberWeek(m), d7 = wk.d7 || [], cells = "";
      for (var j = 0; j < d7.length; j++) cells += "<td class='col-pts'>" + TW.deltaCell(d7[j]) + "</td>";
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td class='col-rank'>" + m._pos + ".</td>" +
        "<td>" + TW.playerLink(m.id, m.name) + "</td>" +
        "<td class='col-pts'>" + TW.commas(m.points) + "</td>" +
        "<td class='col-pts'>" + TW.commas(m.villages) + "</td>" +
        cells + "<td class='col-pts'>" + TW.deltaCell(wk.t7) + "</td></tr>";
    }
    var span = 5 + weekDays.length;
    $("membersBody").innerHTML = html || "<tr class='r1'><td colspan='" + span + "' class='status'>Sin miembros.</td></tr>";
  }

  // ?cmp=<metric> keeps the «Comparar» choice in the URL (the hash is the tab's).
  function readCompare() {
    var m = /[?&]cmp=(\w+)/.exec(location.search);
    return m && COMPARE[m[1]] ? m[1] : "points";
  }
  function initMembers(list, weekDays) {
    mstate.list = (list || []).map(function (m, i) { return Object.assign({ _pos: i + 1 }, m); });
    mstate.weekDays = weekDays || [];
    var hasW7 = mstate.list.some(function (m) { return !!m.w7; });
    mstate.metric = hasW7 ? readCompare() : "points";
    $("memberCompare").hidden = !hasW7;
    $("memberMetric").value = mstate.metric;
    renderMembers();
  }
  function wireMembers() {
    $("memberMetric").addEventListener("change", function () {
      mstate.metric = COMPARE[this.value] ? this.value : "points";
      var q = location.search.replace(/([?&])cmp=\w*&?/, "$1").replace(/[?&]$/, "");
      if (mstate.metric !== "points") q += (q ? "&" : "?") + "cmp=" + mstate.metric;
      if (history.replaceState) history.replaceState(null, "", location.pathname + q + location.hash);
      renderMembers();
    });
    $("membersHead").addEventListener("click", function (e) {
      var th = e.target.closest ? e.target.closest("[data-msort]") : null;
      if (!th) return;
      var key = th.getAttribute("data-msort");
      if (key === mstate.sort) mstate.dir = mstate.dir === "asc" ? "desc" : "asc";
      else { mstate.sort = key; mstate.dir = key === "pos" ? "asc" : "desc"; }
      renderMembers();
    });
  }

  // Paginated Pueblos table (tribes can have 2000+ villages). Extra Jugador
  // column (owner → internal player page). Renders the current page + pager.
  function renderVillages() {
    var list = vstate.list;
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (vstate.page >= pages) vstate.page = pages - 1;
    if (vstate.page < 0) vstate.page = 0;
    var start = vstate.page * PAGE_SIZE;
    var slice = list.slice(start, start + PAGE_SIZE);

    var html = "";
    for (var i = 0; i < slice.length; i++) {
      var v = slice[i];
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td><a href='village.html?id=" + encodeURIComponent(v.id) + "'>" + TW.esc(v.name) + "</a></td>" +
        "<td class='col-pts'>" + TW.commas(v.points) + "</td>" +
        "<td class='coord'>" + v.x + "|" + v.y + "</td>" +
        "<td class='cont'>K" + v.k + "</td>" +
        "<td>" + TW.playerLink(v.owner.id, v.owner.name) + "</td></tr>";
    }
    $("villagesBody").innerHTML = html || "<tr class='r1'><td colspan='5' class='status'>Sin pueblos.</td></tr>";
    $("pageInfo").textContent = total
      ? (start + 1) + "–" + Math.min(start + PAGE_SIZE, total) + " de " + TW.commas(total)
      : "0";
    $("prev").disabled = vstate.page <= 0;
    $("next").disabled = vstate.page >= pages - 1;
  }

  function initVillages(list) {
    vstate.list = list || [];
    vstate.page = 0;
    $("villagesCount").textContent = "(" + TW.commas(vstate.list.length) + ")";
    renderVillages();
  }

  // One page of conquest rows (TW.pagedTable hands in the slice).
  function conquestRows(slice) {
    var html = "";
    for (var i = 0; i < slice.length; i++) {
      var r = slice[i];
      var pts = r.village.points != null ? TW.commas(r.village.points) : "?";
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td>" + TW.villageCell(r.village) + "</td>" +
        "<td class='col-pts'>" + pts + "</td>" +
        "<td>" + TW.ownerCell(r.oldOwner, arch) + "</td>" +
        "<td>" + TW.ownerCell(r.newOwner, arch) + "</td>" +
        "<td class='col-date'>" + TW.fmtStamp(r.t) + "</td></tr>";
    }
    return html || "<tr class='r1'><td colspan='5' class='status'>Ninguno.</td></tr>";
  }

  function countNote(list) { return "(" + TW.commas(list.length) + ")"; }

  // Rivales: per opposing tribe, villages won from them (gains by the old
  // owner's tribe) and lost to them (losses by the new owner's tribe), from the
  // external lists only (splitConquests drops the internal transfers). The
  // tribe is the one build.py resolved for the conquest day. Barbarian
  // villages and tribeless players get one row each. 7/30 days count back from
  // the newest data point, never from the viewer's clock.
  var rstate = { gains: [], losses: [], now: 0, days: 0, sort: null, dir: "desc" };

  function rivalKey(o) {
    if (!o) return { key: "barb", label: '<span class="barb">Bárbaros</span>', sortName: "￿1" };
    if (!o.tribe) return { key: "none", label: '<span class="barb">Sin tribu</span>', sortName: "￿2" };
    return { key: "t" + o.tribe.id, label: TW.tribeLink(o.tribe.id, o.tribe.tag),
      sortName: String(o.tribe.tag || "").toLowerCase() };
  }
  function rivalRows() {
    var since = rstate.days ? rstate.now - rstate.days * 86400 : -Infinity;
    var by = {}, rows = [];
    function add(c, owner, field) {
      if (c.t < since) return;
      var k = rivalKey(owner), r = by[k.key];
      if (!r) { r = by[k.key] = { label: k.label, sortName: k.sortName, won: 0, lost: 0, last: 0 }; rows.push(r); }
      r[field]++;
      if (c.t > r.last) { r.last = c.t; r.label = k.label; r.sortName = k.sortName; }   // newest tag wins
    }
    rstate.gains.forEach(function (c) { add(c, c.oldOwner, "won"); });
    rstate.losses.forEach(function (c) { add(c, c.newOwner, "lost"); });
    rows.forEach(function (r) { r.net = r.won - r.lost; });
    return rows;
  }
  var RIVAL_COLS = [
    { key: "name", label: "Tribu rival", cls: "", dir: "asc", get: function (r) { return r.sortName; } },
    { key: "won", label: "Ganados a ellos", cls: "col-pts", dir: "desc", get: function (r) { return r.won; } },
    { key: "lost", label: "Perdidos ante ellos", cls: "col-pts", dir: "desc", get: function (r) { return r.lost; } },
    { key: "net", label: "Neto", cls: "col-pts", dir: "desc", get: function (r) { return r.net; } },
    { key: "last", label: "Último", cls: "col-date", dir: "desc", get: function (r) { return r.last; } },
  ];
  function renderRivals() {
    var head = "<tr>";
    RIVAL_COLS.forEach(function (c) {
      var arrow = rstate.sort === c.key ? (rstate.dir === "asc" ? " ▲" : " ▼") : "";
      head += "<th class='" + c.cls + " th-sort' data-rsort='" + c.key + "'>" + c.label +
        "<span class='arrow'>" + arrow + "</span></th>";
    });
    $("rivalsHead").innerHTML = head + "</tr>";

    var rows = rivalRows();
    var col = RIVAL_COLS.filter(function (c) { return c.key === rstate.sort; })[0];
    var mul = rstate.dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      if (col) {
        var va = col.get(a), vb = col.get(b);
        if (va !== vb) return (va < vb ? -1 : 1) * mul;
      }
      return (b.won + b.lost) - (a.won + a.lost) || b.last - a.last;   // default: most conquests between both
    });
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td>" + r.label + "</td>" +
        "<td class='col-pts'>" + TW.commas(r.won) + "</td>" +
        "<td class='col-pts'>" + TW.commas(r.lost) + "</td>" +
        "<td class='col-pts'>" + TW.deltaCell(r.net) + "</td>" +
        "<td class='col-date' title='" + TW.fmtStamp(r.last) + "'>" + TW.relTime(r.last, rstate.now) + "</td></tr>";
    }
    $("rivalsBody").innerHTML = html || "<tr class='r1'><td colspan='5' class='status'>Sin conquistas en este periodo.</td></tr>";
    $("rivalsCount").textContent = "(" + TW.commas(rows.length) + ")";
    var segs = document.querySelectorAll(".rival-range .seg");
    for (var j = 0; j < segs.length; j++) {
      segs[j].classList.toggle("active", +segs[j].getAttribute("data-range") === rstate.days);
    }
  }
  function initRivals(cs, series) {
    rstate.gains = cs.gains; rstate.losses = cs.losses;
    var now = series.length ? series[series.length - 1].t : 0;
    [cs.gains, cs.losses].forEach(function (l) { if (l.length && l[0].t > now) now = l[0].t; });   // newest first
    rstate.now = now;
    renderRivals();
  }
  function wireRivals() {
    var segs = document.querySelectorAll(".rival-range .seg");
    for (var i = 0; i < segs.length; i++) {
      segs[i].addEventListener("click", function () { rstate.days = +this.getAttribute("data-range"); renderRivals(); });
    }
    $("rivalsHead").addEventListener("click", function (e) {
      var th = e.target.closest ? e.target.closest("[data-rsort]") : null;
      if (!th) return;
      var key = th.getAttribute("data-rsort");
      if (key === rstate.sort) rstate.dir = rstate.dir === "asc" ? "desc" : "asc";
      else {
        rstate.sort = key;
        rstate.dir = RIVAL_COLS.filter(function (c) { return c.key === key; })[0].dir;
      }
      renderRivals();
    });
  }

  // Conquest filter: "all" | "gain" | "lose" | "internal" — show/hide the sections.
  function setConqFilter(mode) {
    var g = $("gainsSection"), l = $("lossesSection"), n = $("internalSection");
    if (g) g.hidden = !(mode === "all" || mode === "gain");
    if (l) l.hidden = !(mode === "all" || mode === "lose");
    if (n) n.hidden = !(mode === "internal" || (mode === "all" && hasInternal));
    var segs = document.querySelectorAll(".conq-filter .seg");
    for (var i = 0; i < segs.length; i++) {
      segs[i].classList.toggle("active", segs[i].getAttribute("data-conq") === mode);
    }
  }

  function wireInteractions() {
    // Profile numbers that jump to another tab (+ optional conquest filter).
    $("content").addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest("[data-tab-go]") : null;
      if (!a) return;
      e.preventDefault();
      var btn = document.querySelector('.tab[data-tab="' + a.getAttribute("data-tab-go") + '"]');
      if (btn) btn.click();
      var conq = a.getAttribute("data-conq");
      if (conq) setConqFilter(conq);
    });
    // Conquest filter buttons.
    var segs = document.querySelectorAll(".conq-filter .seg");
    for (var i = 0; i < segs.length; i++) {
      (function (b) {
        b.addEventListener("click", function () { setConqFilter(b.getAttribute("data-conq")); });
      })(segs[i]);
    }
    // Pueblos pager.
    $("prev").addEventListener("click", function () { if (vstate.page > 0) { vstate.page--; renderVillages(); } });
    $("next").addEventListener("click", function () { vstate.page++; renderVillages(); });
  }

  function fail(msg) {
    $("status").textContent = msg + "  (¿sirviendo por HTTP? file:// bloquea fetch)";
    $("status").style.display = "block";
  }

  function init() {
    TW.renderNav("tribus");
    var id = qid();
    if (!id) { fail("Tribu no encontrada: falta el parámetro ?id."); return; }

    Promise.all([TW.loadJSON("tribes/" + encodeURIComponent(id) + ".json"), TW.playerArchive()])
      .then(function (res) {
        var d = res[0], p = d.profile, series = d.series || [];
        arch = res[1];
        var lastSeen = series.length ? series[series.length - 1].t : null;
        document.title = "es103 · " + p.tag;
        var badge = p.current ? "" : ' <span class="archived">(Archivada' +
          (lastSeen ? " — vista por última vez " + TW.fmtDayUTC(lastSeen) : "") + ")</span>";
        $("pageTitle").innerHTML = "Perfil de la Tribu: " + TW.esc(p.name) +
          ' <span class="tag-br">[' + TW.esc(p.tag) + "]</span>" + badge;
        var cs = splitConquests(d, p.id);
        hasInternal = cs.internal.length > 0;
        renderProfile(p, cs, lastSeen);
        renderCharts(d.series || []);
        renderHistory(d.series || []);
        initMembers(d.memberList, d.weekDays);
        $("memberCount").textContent = "(" + TW.commas((d.memberList || []).length) + ")";
        initVillages(d.villages || []);
        TW.pagedTable($("gainsBody"), $("gainsPager"), CONQ_PAGE, conquestRows).set(cs.gains);
        TW.pagedTable($("lossesBody"), $("lossesPager"), CONQ_PAGE, conquestRows).set(cs.losses);
        TW.pagedTable($("internalBody"), $("internalPager"), CONQ_PAGE, conquestRows).set(cs.internal);
        $("gainsCount").textContent = countNote(cs.gains);
        $("lossesCount").textContent = countNote(cs.losses);
        $("internalCount").textContent = countNote(cs.internal);
        initRivals(cs, d.series || []);
        $("status").style.display = "none";
        $("content").hidden = false;
        TW.initTabs();
        setConqFilter("all");
        wireInteractions();
        wireMembers();
        wireRivals();
      })
      .catch(function (e) {
        if (/HTTP 404/.test(e.message)) fail("Tribu no encontrada (id " + id + ").");
        else fail("No se pudieron cargar los datos: " + e.message);
      });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
