/* Village history page. Classic script; needs common.js + chart.js first.
   Reads ?id=X, loads villages/X.json (profile/series/conquests).
   Mirrors player.js structure (profile / chart / history / conquests). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var vid = null;   // current village id (localStorage key prefix)
  var nowUnix = 0;  // "now" for relative times (meta.pulledUnix, else latest t)

  function qid() {
    var m = /[?&]id=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function mejoraKey(t) { return "twstats.mejora." + vid + "." + t; }
  function loadMejora(t) {
    try { return localStorage.getItem(mejoraKey(t)); } catch (e) { return null; }
  }
  function saveMejora(t, v) {
    try {
      if (v) localStorage.setItem(mejoraKey(t), v);
      else localStorage.removeItem(mejoraKey(t));
    } catch (e) { /* storage unavailable / full — ignore */ }
  }

  function row(label, valueHtml, star) {
    return "<tr><th class='pl'>" + TW.esc(label) + (star ? "&nbsp;*" : "") +
      "</th><td>" + valueHtml + "</td></tr>";
  }

  function gameVillageLink(id, label) {
    return '<a href="' + TW.GAME + "info_village&id=" + TW.esc(id) +
      '" target="_blank" rel="noopener">' + label + "</a>";
  }

  function renderProfile(p) {
    var owner = p.owner
      ? TW.playerLink(p.owner.id, p.owner.name)
      : '<span class="barb">Bárbaro</span>';
    var ownerTribe = (p.owner && p.owner.tribe)
      ? TW.tribeLink(p.owner.tribe.id, p.owner.tribe.tag)
      : "—";
    var loc = gameVillageLink(p.id, TW.esc(p.x) + "|" + TW.esc(p.y));

    var html = "";
    html += row("Nombre", TW.esc(p.name));
    html += row("Ubicación", loc);
    html += row("Continente", "K" + TW.esc(p.k));
    html += row("Puntos", TW.commas(p.points));
    html += row("Dueño", owner);
    html += row("Tribu del dueño", ownerTribe);
    html += row("Primera vez visto", TW.fmtDate(p.firstSeen), true);
    html += row("Última conquista", p.lastConquest != null ? TW.relTime(p.lastConquest, nowUnix) : "—");
    html += row("Conquistas totales", TW.commas(p.conquestCount));
    html += row("Ver en el juego", gameVillageLink(p.id, "Abrir en el juego ›"));
    $("profileBody").innerHTML = html;
  }

  function renderChart(series) {
    TW.metricChart($("charts"), series, [{ key: "points", label: "Puntos" }],
      { width: 460, height: 220, timeX: true });
  }

  // "Posibles mejoras" cell for a positive delta: a <select> of candidate
  // (building, level) upgrades, plus a "—" option; the choice persists in
  // localStorage. No candidates → static "Desconocido"; baseline row → "—".
  function mejoraCell(delta, t) {
    if (delta == null) return "<td class='col-mejora'>—</td>";
    var cands = TW.mejoras(delta);
    if (!cands.length) return "<td class='col-mejora'><span class='barb'>Desconocido</span></td>";
    if (cands.length === 1) {
      return "<td class='col-mejora'>" + TW.esc(cands[0].name + " nivel " + cands[0].level) + "</td>";
    }
    var saved = loadMejora(t);
    var opts = '<option value="">—</option>';
    for (var i = 0; i < cands.length; i++) {
      var label = cands[i].name + " nivel " + cands[i].level;
      var sel = saved === label ? " selected" : "";
      opts += '<option value="' + TW.esc(label) + '"' + sel + ">" + TW.esc(label) + "</option>";
    }
    return "<td class='col-mejora'><select class='mejora-select' data-t='" + t + "'>" +
      opts + "</select> <span class='mejora-count'>(" + cands.length + ")</span></td>";
  }

  // History rows newest→oldest. Tiempo = gap since the previous (older) change.
  function renderHistory(series) {
    var html = "";
    for (var i = series.length - 1, k = 0; i >= 0; i--, k++) {
      var s = series[i];
      var delta = i > 0 ? s.points - series[i - 1].points : null;
      var gap = i > 0 ? (s.t - series[i - 1].t) : null;
      html += "<tr class='" + (k % 2 ? "r2" : "r1") + "'>" +
        "<td class='col-date'>" + TW.fmtDateTime(s.t) + "</td>" +
        "<td class='col-pts'>" + TW.commas(s.points) + "</td>" +
        "<td class='col-pts'>" + TW.deltaCell(delta) + "</td>" +
        "<td class='col-pts'>" + (gap != null ? TW.dur(gap) : "—") + "</td>" +
        mejoraCell(delta, s.t) + "</tr>";
    }
    $("historyBody").innerHTML = html || "<tr class='r1'><td colspan='5' class='status'>Sin datos.</td></tr>";
    var body = $("historyBody");
    body.addEventListener("change", function (e) {
      var sel = e.target;
      if (sel && sel.classList && sel.classList.contains("mejora-select")) {
        saveMejora(sel.getAttribute("data-t"), sel.value);
      }
    });
  }

  function renderConquests(list) {
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td class='col-date'>" + TW.fmtStamp(r.t) + "</td>" +
        "<td>" + TW.ownerCell(r.newOwner) + "</td>" +
        "<td>" + TW.ownerCell(r.oldOwner) + "</td></tr>";
    }
    $("conquestsBody").innerHTML = html ||
      "<tr class='r1'><td colspan='3' class='status'>Sin conquistas registradas.</td></tr>";
    $("conqCount").textContent = "(" + TW.commas(list.length) + ")";
  }

  function fail(msg) {
    $("status").textContent = msg + "  (¿sirviendo por HTTP? file:// bloquea fetch)";
    $("status").style.display = "block";
  }

  function init() {
    TW.renderNav("pueblos");
    var id = qid();
    if (!id) { fail("Pueblo no encontrado: falta el parámetro ?id."); return; }
    vid = id;

    // meta.json gives "now" for relative times; tolerate its absence.
    var meta = TW.loadJSON("meta.json").catch(function () { return null; });
    Promise.all([TW.loadJSON("villages/" + encodeURIComponent(id) + ".json"), meta])
      .then(function (res) {
        var d = res[0], m = res[1];
        var series = d.series || [];
        nowUnix = (m && m.pulledUnix) ? m.pulledUnix
          : (series.length ? series[series.length - 1].t : Math.floor(Date.now() / 1000));
        var p = d.profile;
        document.title = "es103 · " + p.name;
        $("pageTitle").innerHTML = "Historial del pueblo: " + TW.esc(p.name);
        renderProfile(p);
        renderChart(series);
        renderHistory(series);
        renderConquests(d.conquests || []);
        $("status").style.display = "none";
        $("content").hidden = false;
      })
      .catch(function (e) {
        if (/HTTP 404/.test(e.message)) fail("Pueblo no encontrado (id " + id + ").");
        else fail("No se pudieron cargar los datos: " + e.message);
      });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
