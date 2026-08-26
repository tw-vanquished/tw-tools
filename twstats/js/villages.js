/* Villages locator — searchable, paginated list of all current villages.
   Classic script; needs common.js first. Loads villages.json (sorted by
   points desc). No column sorting: rank = load order. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var PAGE_SIZE = 100;

  var state = { data: [], filtered: [], query: "", page: 0 };

  function matches(r) {
    if (!state.query) return true;
    var hay = (r.name || "") + " " + r.x + "|" + r.y;
    return hay.toLowerCase().indexOf(state.query) !== -1;
  }

  function applyFilter() {
    state.filtered = state.data.filter(matches);
    state.page = 0;
  }

  function ownerCell(o) {
    if (!o) return '<span class="barb">Bárbaro</span>';
    return TW.playerLink(o.id, o.name);
  }
  function tribeCell(o) {
    if (o && o.tribe) return TW.tribeLink(o.tribe.id, o.tribe.tag);
    return '<span class="barb">—</span>';
  }

  function render() {
    var total = state.filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    var start = state.page * PAGE_SIZE;
    var slice = state.filtered.slice(start, start + PAGE_SIZE);

    var html = "";
    for (var i = 0; i < slice.length; i++) {
      var r = slice[i];
      html += "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td class='col-rank'>" + r._rank + ".</td>" +
        "<td>" + TW.villageCell(r) + "</td>" +
        "<td class='col-pts'>" + TW.commas(r.points) + "</td>" +
        "<td>" + ownerCell(r.owner) + "</td>" +
        "<td>" + tribeCell(r.owner) + "</td></tr>";
    }
    $("rows").innerHTML = html || "<tr class='r1'><td colspan='5' class='status'>Sin resultados.</td></tr>";

    $("pageInfo").textContent = total
      ? (start + 1) + "–" + Math.min(start + PAGE_SIZE, total) + " de " + total.toLocaleString()
      : "0";
    $("prev").disabled = state.page <= 0;
    $("next").disabled = state.page >= pages - 1;
    $("status").style.display = "none";
  }

  function init() {
    TW.renderNav("pueblos");
    TW.loadJSON("meta.json").then(function (m) { $("worldName").textContent = m.world || TW.WORLD; }).catch(function () {});

    TW.loadJSON("villages.json")
      .then(function (d) {
        for (var i = 0; i < d.length; i++) d[i]._rank = i + 1; // load order = points desc
        state.data = d;
        $("countNote").textContent = TW.commas(d.length) + " pueblos";
        applyFilter();
        render();
      })
      .catch(function (e) {
        $("status").textContent = "No se pudieron cargar los datos: " + e.message +
          "  (¿sirviendo por HTTP? file:// bloquea fetch)";
      });

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
