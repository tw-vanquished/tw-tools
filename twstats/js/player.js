/* Player profile page. Classic script; needs common.js + chart.js first.
   Reads ?id=X, loads players/X.json (profile/series/villages/gains/losses).
   Tabs: Perfil / Historial / Pueblos / Conquistas. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var CONQ_PAGE = 200;  // conquest rows per page (tribes can have 8,000+)
  var GPROF = "https://" + TW.WORLD + ".guerrastribales.es/page.php?page=inbound&screen=info_player&id=";
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

  // An archived player (left / deleted, p.current false) keeps the values of
  // the last snapshot: the rows say «Último …» and when that was.
  function renderProfile(p, lastSeen) {
    var gone = !p.current;
    var tribe = p.tribe ? TW.tribeLink(p.tribe.id, p.tribe.tag) : '<span class="barb">Sin tribu</span>';
    var total = (p.conquests || 0) + (p.lost || 0);
    var conq = jump("conquistas", "all", TW.commas(total)) +
      " (" + jump("conquistas", "gain", "+" + TW.commas(p.conquests)) +
      " " + jump("conquistas", "lose", "−" + TW.commas(p.lost)) + ")";
    var html = "";
    html += row(gone ? "Último ranking" : "Ranking", p.rank + ".");
    html += row("Nombre", TW.esc(p.name));
    html += row(gone ? "Última tribu" : "Tribu", tribe);
    html += row(gone ? "Últimos puntos" : "Puntos", TW.commas(p.points));
    html += row(gone ? "Últimos pueblos" : "Pueblos", gone ? TW.commas(p.villages) : jump("pueblos", null, TW.commas(p.villages)));
    if (gone && lastSeen) html += row("Visto por última vez", TW.fmtDayUTC(lastSeen));
    html += row("Promedio de puntos por pueblo", TW.commas(p.avg));
    html += row("Cambios de tribu", TW.commas(p.tribeChanges), true);
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
      '<a href="' + GPROF + TW.esc(p.id) + '" target="_blank" rel="noopener">Abrir en el juego ›</a>');
    $("profileBody").innerHTML = html;
  }

  var METRICS = [
    { key: "points", label: "Puntos" },
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
        TW.changeCell(s.points, prev && prev.points) +
        TW.changeCell(s.villages, prev && prev.villages) +
        odCell(s, prev, "od_total") + odCell(s, prev, "od_att") +
        odCell(s, prev, "od_def") + odCell(s, prev, "od_sup") +
        "</tr>";
    }
    $("historyBody").innerHTML = html || "<tr class='r1'><td colspan='8' class='status'>Sin datos.</td></tr>";
  }

  function renderVillages(list) {
    list = list || [];
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td><a href='village.html?id=" + encodeURIComponent(v.id) + "'>" + TW.esc(v.name) + "</a></td>" +
        "<td class='col-pts'>" + TW.commas(v.points) + "</td>" +
        "<td class='coord'>" + v.x + "|" + v.y + "</td>" +
        "<td class='cont'>K" + v.k + "</td></tr>";
    }
    $("villagesBody").innerHTML = html || "<tr class='r1'><td colspan='4' class='status'>Sin pueblos.</td></tr>";
    $("villagesCount").textContent = "(" + TW.commas(list.length) + ")";
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

  // Conquest filter: "all" | "gain" | "lose" — show/hide the two sections.
  function setConqFilter(mode) {
    var g = $("gainsSection"), l = $("lossesSection");
    if (g) g.hidden = (mode === "lose");
    if (l) l.hidden = (mode === "gain");
    var segs = document.querySelectorAll(".conq-filter .seg");
    for (var i = 0; i < segs.length; i++) {
      segs[i].classList.toggle("active", segs[i].getAttribute("data-conq") === mode);
    }
  }

  function fail(msg) {
    $("status").textContent = msg + "  (¿sirviendo por HTTP? file:// bloquea fetch)";
    $("status").style.display = "block";
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
  }

  function init() {
    TW.renderNav("jugadores");
    var id = qid();
    if (!id) { fail("Jugador no encontrado: falta el parámetro ?id."); return; }

    Promise.all([TW.loadJSON("players/" + encodeURIComponent(id) + ".json"), TW.playerArchive()])
      .then(function (res) {
        var d = res[0], p = d.profile, series = d.series || [];
        arch = res[1];
        var lastSeen = series.length ? series[series.length - 1].t : null;
        document.title = "es103 · " + p.name;
        var badge = p.current ? "" : ' <span class="archived">(Archivado' +
          (lastSeen ? " — visto por última vez " + TW.fmtDayUTC(lastSeen) : "") + ")</span>";
        $("pageTitle").innerHTML = "Perfil del Jugador: " + TW.esc(p.name) + badge;
        renderProfile(p, lastSeen);
        renderCharts(d.series || []);
        renderHistory(d.series || []);
        renderVillages(d.villages || []);
        TW.pagedTable($("gainsBody"), $("gainsPager"), CONQ_PAGE, conquestRows).set(d.gains);
        TW.pagedTable($("lossesBody"), $("lossesPager"), CONQ_PAGE, conquestRows).set(d.losses);
        $("gainsCount").textContent = countNote(d.gains || []);
        $("lossesCount").textContent = countNote(d.losses || []);
        $("status").style.display = "none";
        $("content").hidden = false;
        TW.initTabs();
        setConqFilter("all");
        wireInteractions();
      })
      .catch(function (e) {
        if (/HTTP 404/.test(e.message)) fail("Jugador no encontrado (id " + id + ").");
        else fail("No se pudieron cargar los datos: " + e.message);
      });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
