/* Main page — twstats-style world landing. Classic script; needs js/common.js first.
   Two mini ranking tables (top 12 players + top 12 tribes) and a combined search. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var TOP = 12, MAX_RESULTS = 20;
  var players = [], tribes = [];

  function playerRows(list) {
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td class='col-rank'>" + p.rank + ".</td>" +
        "<td>" + TW.playerLink(p.id, p.name) + "</td>" +
        "<td class='col-pts'>" + TW.commas(p.points) + "</td>" +
        "<td class='col-pts'>" + TW.commas(p.villages) + "</td></tr>";
    }
    return html;
  }
  function tribeRows(list) {
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var tr = list[i];
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td class='col-rank'>" + tr.rank + ".</td>" +
        "<td>" + TW.tribeLink(tr.id, tr.tag) + "</td>" +
        "<td class='col-pts'>" + TW.commas(tr.points) + "</td>" +
        "<td class='col-pts'>" + TW.commas(tr.villages) + "</td></tr>";
    }
    return html;
  }

  function search(q) {
    var box = $("searchResults");
    q = q.trim().toLowerCase();
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    var html = "";
    var pl = players.filter(function (p) { return (p.name || "").toLowerCase().indexOf(q) !== -1; }).slice(0, MAX_RESULTS);
    var tb = tribes.filter(function (t) {
      return (t.tag || "").toLowerCase().indexOf(q) !== -1 || (t.name || "").toLowerCase().indexOf(q) !== -1;
    }).slice(0, MAX_RESULTS);
    if (pl.length) {
      html += '<div class="sr-group"><div class="sr-head">Jugadores</div>';
      for (var i = 0; i < pl.length; i++) {
        html += '<div class="sr-item">' + TW.playerLink(pl[i].id, pl[i].name) +
          ' <span class="sr-meta">' + TW.commas(pl[i].points) + " pts · #" + pl[i].rank + "</span></div>";
      }
      html += "</div>";
    }
    if (tb.length) {
      html += '<div class="sr-group"><div class="sr-head">Tribus</div>';
      for (var j = 0; j < tb.length; j++) {
        html += '<div class="sr-item">' + TW.tribeLink(tb[j].id, tb[j].tag) +
          ' <span class="sr-meta">' + TW.esc(tb[j].name) + " · " + TW.commas(tb[j].points) +
          " pts · #" + tb[j].rank + "</span></div>";
      }
      html += "</div>";
    }
    box.innerHTML = html || '<div class="sr-item sr-meta">Sin resultados.</div>';
    box.hidden = false;
  }

  function init() {
    TW.renderNav("inicio");
    Promise.all([TW.loadJSON("meta.json"), TW.loadJSON("players.json"), TW.loadJSON("tribes.json")])
      .then(function (res) {
        var meta = res[0];
        players = res[1]; tribes = res[2];
        $("worldName").textContent = meta.world || TW.WORLD;
        var pulled = meta.pulledUnix ? TW.fmtTime(meta.pulledUnix) : "?";
        $("metaLine").textContent = TW.commas(players.length) + " jugadores · " +
          TW.commas(tribes.length) + " tribus · " + TW.commas(meta.conquers) +
          " ennoblecimientos archivados · datos obtenidos " + pulled;
        $("rowsPlayers").innerHTML = playerRows(players.slice(0, TOP));
        $("rowsTribes").innerHTML = tribeRows(tribes.slice(0, TOP));
        $("status").style.display = "none";
      })
      .catch(function (e) {
        $("status").textContent = "No se pudieron cargar los datos: " + e.message +
          "  (¿sirviendo por HTTP? file:// bloquea fetch)";
      });

    var t;
    $("search").addEventListener("input", function () {
      clearTimeout(t);
      var self = this;
      t = setTimeout(function () { search(self.value); }, 150);
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
