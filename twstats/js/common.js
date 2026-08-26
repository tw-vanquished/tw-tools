/* Shared helpers for the twstats-style history site (Phase 2).
   Classic script — loaded FIRST on every page. Exposes a single global `TW`.
   No modules, no network deps beyond fetch() of the local JSON built by
   tw_world_data/build.py. Colours/theme live in css/twstats.css. */
(function () {
  "use strict";

  var WORLD = "es103";
  var DATA = "data/" + WORLD + "/";
  var GAME = "https://" + WORLD + ".guerrastribales.es/game.php?screen=";

  // Server time (Europe/Madrid); DST (CET/CEST) handled by Intl.
  var SRV_FMT = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  function parts(t) {
    var p = {};
    SRV_FMT.formatToParts(new Date(t * 1000)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  function fmtTime(t) {   // "YYYY-MM-DD HH:MM:SS"
    var p = parts(t);
    return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute + ":" + p.second;
  }
  function fmtStamp(t) {  // "YYYY-MM-DD - HH:MM:SS" (twstats ennoblements style)
    var p = parts(t);
    return p.year + "-" + p.month + "-" + p.day + " - " + p.hour + ":" + p.minute + ":" + p.second;
  }
  function fmtDate(t) {   // "YYYY-MM-DD"
    var p = parts(t);
    return p.year + "-" + p.month + "-" + p.day;
  }
  function fmtDateTime(t) {   // "YYYY-MM-DD HH:MM" (change-event rows)
    var p = parts(t);
    return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute;
  }
  // Inverse of fmtTime: a server-time (Europe/Madrid) wall clock → unix seconds.
  // Intl only converts epoch → wall clock, so invert it by measuring the offset
  // the guess lands in, then re-measuring once at the corrected instant (the
  // second pass is what makes DST-transition days come out right).
  function srvOffsetMs(tMs) {
    var p = {};
    SRV_FMT.formatToParts(new Date(tMs)).forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - tMs;
  }
  function srvEpoch(y, mo, d, h, mi, s) {
    var guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0);
    var t = guess - srvOffsetMs(guess);
    return Math.floor((guess - srvOffsetMs(t)) / 1000);
  }

  var WD_FMT = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short" });
  function weekday(t) {       // "Lun", "Mar", … (Spanish, server tz)
    var s = WD_FMT.format(new Date(t * 1000)).replace(/\.$/, "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function commas(n) { return Number(n).toLocaleString("en-US"); }
  function continent(x, y) { return "K" + (Math.floor(y / 100) * 10 + Math.floor(x / 100)); }

  function loadJSON(name) {
    return fetch(DATA + name).then(function (r) {
      if (!r.ok) throw new Error(name + ": HTTP " + r.status);
      return r.json();
    });
  }

  // --- internal navigation links (to our own profile pages) ---
  function playerLink(id, name) {
    var label = name ? esc(name) : "jugador " + esc(id);
    return '<a href="player.html?id=' + encodeURIComponent(id) + '">' + label + "</a>";
  }
  function tribeLink(id, tag) {
    if (id == null) return "";
    var label = tag ? esc(tag) : "tribu " + esc(id);
    return '<a href="tribe.html?id=' + encodeURIComponent(id) + '">' + label + "</a>";
  }

  // --- cell renderers ---
  // Village name links INTERNALLY to our own village page (village.html?id=).
  // Deleted villages (no coords, x==null) render as plain text, no link.
  function villageCell(v) {
    var name = v.name ? esc(v.name) : "(pueblo " + esc(v.id) + ")";
    if (v.x == null) return name;
    var loc = ' <span class="coord">(' + v.x + "|" + v.y + ')</span> <span class="cont">' + continent(v.x, v.y) + "</span>";
    return '<a href="village.html?id=' + encodeURIComponent(v.id) + '">' + name + "</a>" + loc;
  }
  function ownerCell(o) {
    if (!o) return '<span class="barb">Bárbaro</span>';
    if (!o.name) return '<span class="gone">— (id ' + esc(o.id) + ")</span>";
    var out = '<a class="playerlink" href="' + GAME + "info_player&id=" + esc(o.id) +
      '" target="_blank" rel="noopener">' + esc(o.name) + "</a>";
    if (o.tribe) {
      out += ' <span class="tribe-br">[<a class="tribelink" href="' + GAME + "info_ally&id=" +
        esc(o.tribe.id) + '" target="_blank" rel="noopener">' + esc(o.tribe.tag) + "</a>]</span>";
    }
    return out;
  }

  // Delta cell: +N green / −N red / — muted. Positive is "good" by default
  // (rank: a positive delta = climbed = good). invertGoodDown flips colours.
  function deltaCell(n, invertGoodDown) {
    if (n == null) return '<span class="delta delta-zero">—</span>';
    if (n === 0) return '<span class="delta delta-zero">0</span>';
    var good = invertGoodDown ? (n < 0) : (n > 0);
    var sign = n > 0 ? "+" : "−"; // U+2212 minus
    return '<span class="delta ' + (good ? "delta-up" : "delta-down") + '">' +
      sign + commas(Math.abs(n)) + "</span>";
  }

  // twstats history-table change cell. Shows the CURRENT value prefixed by a
  // change marker vs the previous (older) snapshot: "+" rose (green), "−" fell
  // (red), "=" unchanged (muted). Oldest row (prev == null) → treated as "+".
  // opts.invert: rank semantics (numerically lower = climbed = good "+").
  // Returns a full <td class="col-pts">…</td> so it drops into a history row.
  function changeCell(cur, prev, opts) {
    opts = opts || {};
    var cls, prefix;
    if (prev == null || cur === prev) {
      cls = prev == null ? "delta-up" : "delta-zero";
      prefix = prev == null ? "+" : "=";
    } else {
      var good = opts.invert ? (cur < prev) : (cur > prev);
      cls = good ? "delta-up" : "delta-down";
      prefix = good ? "+" : "−"; // U+2212 minus
    }
    return '<td class="col-pts"><span class="delta ' + cls + '">' +
      prefix + commas(cur) + "</span></td>";
  }

  // Relative time in Spanish (twstats "Ultima conquista" style):
  // "Hace X días y Y horas" / "Hace Y horas" / "Hace Z minutos" / "Hace un momento".
  function relTime(t, now) {
    var diff = Math.max(0, Math.floor(now - t));
    var days = Math.floor(diff / 86400);
    var hours = Math.floor((diff % 86400) / 3600);
    var mins = Math.floor((diff % 3600) / 60);
    function plur(n, s) { return n + " " + s + (n === 1 ? "" : "s"); }
    if (days > 0) return "Hace " + plur(days, "día") + " y " + plur(hours, "hora");
    if (hours > 0) return "Hace " + plur(hours, "hora");
    if (mins > 0) return "Hace " + plur(mins, "minuto");
    return "Hace un momento";
  }

  // Compact duration for the village "Tiempo" column: "45m", "2h", "3d 4h".
  function dur(seconds) {
    var s = Math.max(0, Math.round(seconds));
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    var d = Math.floor(s / 86400);
    var h = Math.round((s % 86400) / 3600);
    return h ? d + "d " + h + "h" : d + "d";
  }

  // Wire twstats-style tabs: [data-tab] buttons toggle sibling [data-panel]
  // sections. Default = first tab; honours & reflects location.hash.
  function initTabs(root) {
    root = root || document;
    var tabs = [].slice.call(root.querySelectorAll(".tab"));
    var panels = [].slice.call(root.querySelectorAll(".tab-panel"));
    if (!tabs.length) return;
    function show(name) {
      var found = false;
      for (var i = 0; i < tabs.length; i++) {
        var on = tabs[i].getAttribute("data-tab") === name;
        tabs[i].classList.toggle("active", on);
        if (on) found = true;
      }
      for (var j = 0; j < panels.length; j++) {
        panels[j].hidden = panels[j].getAttribute("data-panel") !== name;
      }
      return found;
    }
    for (var k = 0; k < tabs.length; k++) {
      (function (tab) {
        tab.addEventListener("click", function () {
          var name = tab.getAttribute("data-tab");
          show(name);
          if (history.replaceState) history.replaceState(null, "", "#" + name);
        });
      })(tabs[k]);
    }
    var initial = (location.hash || "").replace(/^#/, "");
    if (!initial || !show(initial)) show(tabs[0].getAttribute("data-tab"));
  }

  // Shared top nav. `active` = one of
  // inicio|jugadores|tribus|pueblos|ennoblecimientos|entrantes|historico|informes.
  var NAV = [
    { key: "inicio", href: "index.html", label: "Inicio" },
    { key: "jugadores", href: "rankings.html?mode=players", label: "Jugadores" },
    { key: "tribus", href: "rankings.html?mode=tribes", label: "Tribus" },
    { key: "pueblos", href: "villages.html", label: "Pueblos" },
    { key: "ennoblecimientos", href: "ennoblements.html", label: "Ennoblecimientos" },
    { key: "entrantes", href: "incomings.html", label: "Entrantes" },
    { key: "historico", href: "historico.html", label: "Histórico Informes" },
    { key: "informes", href: "informes.html", label: "Subir Informes" },
  ];
  function renderNav(active) {
    var el = document.querySelector("nav.mainnav");
    if (!el) return;
    var html = "";
    for (var i = 0; i < NAV.length; i++) {
      var n = NAV[i];
      html += '<a href="' + n.href + '"' + (n.key === active ? ' class="active"' : "") +
        ">" + esc(n.label) + "</a>";
    }
    el.innerHTML = html;
  }

  // Shared reports-DB API (tw-calc-uploads Worker) with hostname failover:
  // *.workers.dev sits on a shared Cloudflare IP range that Spanish ISPs
  // block intermittently (LaLiga court orders, match windows) — the browser
  // surfaces that as "Failed to fetch". tw-calc-proxy.pages.dev is a Pages
  // Function in front of the SAME Worker (service binding, responses
  // byte-identical) on an unaffected range, so it goes first; workers.dev
  // stays as the fallback for the day pages.dev is the blocked one. Only
  // NETWORK failures fail over — an HTTP error is the Worker answering,
  // and it would answer the same on either host.
  var API_HOSTS = [
    "https://tw-calc-proxy.pages.dev",
    "https://tw-calc-uploads.gdqshd.workers.dev",
  ];
  function apiFetch(pathQuery, opts) {
    function attempt(i) {
      return fetch(API_HOSTS[i] + pathQuery, opts).catch(function (e) {
        return i + 1 < API_HOSTS.length ? attempt(i + 1) : Promise.reject(e);
      });
    }
    return attempt(0);
  }

  window.TW = {
    WORLD: WORLD, DATA: DATA, GAME: GAME, SRV_FMT: SRV_FMT,
    apiFetch: apiFetch,
    fmtTime: fmtTime, fmtStamp: fmtStamp, fmtDate: fmtDate, fmtDateTime: fmtDateTime, weekday: weekday,
    srvEpoch: srvEpoch,
    esc: esc, commas: commas, continent: continent, loadJSON: loadJSON,
    playerLink: playerLink, tribeLink: tribeLink,
    villageCell: villageCell, ownerCell: ownerCell, deltaCell: deltaCell,
    changeCell: changeCell, relTime: relTime, dur: dur, initTabs: initTabs,
    renderNav: renderNav,
  };
})();
