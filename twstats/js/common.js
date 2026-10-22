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
  var WD_FMT_UTC = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short" });
  function wdName(fmt, t) {
    var s = fmt.format(new Date(t * 1000)).replace(/\.$/, "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function weekday(t) { return wdName(WD_FMT, t); }   // "Lun", "Mar", … (Spanish, server tz)

  // DAILY-bucket labels. build.py keeps the latest snapshot of each UTC day
  // (typically 21:00-23:59Z = already tomorrow in Madrid), so a daily point is
  // labelled by its UTC day — in Madrid time two buckets could share a date.
  // Real moments (conquests, first seen, village changes) stay in Madrid.
  function fmtDayUTC(t) { return new Date(t * 1000).toISOString().slice(0, 10); }  // "YYYY-MM-DD"
  function weekdayUTC(t) { return wdName(WD_FMT_UTC, t); }

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

  // players-archive.json (build.py: the players who left the world, with an
  // archived page) as { id: row }, fetched once per page. Resolves null when
  // the file is missing (data built before it) or unreadable, so callers
  // simply render without it.
  var playerArchiveP = null;
  function playerArchive() {
    if (!playerArchiveP) {
      playerArchiveP = loadJSON("players-archive.json").then(function (rows) {
        if (!Array.isArray(rows)) return null;
        var map = {};
        for (var i = 0; i < rows.length; i++) map[rows[i].id] = rows[i];
        return map;
      }, function () { return null; });
    }
    return playerArchiveP;
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
  // `arch` (optional, from playerArchive()): an owner who left the world but
  // has an archived page links to player.html (the game's page is gone) under
  // the name the archive knows, instead of a bare '— (id X)'.
  function ownerCell(o, arch) {
    if (!o) return '<span class="barb">Bárbaro</span>';
    var a = arch && o.id != null ? arch[o.id] : null;
    if (!o.name && !a) return '<span class="gone">— (id ' + esc(o.id) + ")</span>";
    var out = a
      ? '<a class="playerlink" href="player.html?id=' + encodeURIComponent(o.id) +
        '" title="Archivado — visto por última vez ' + fmtDayUTC(a.lastSeen) + '">' + esc(o.name || a.name) +
        '</a> <span class="gone">(archivado)</span>'
      : '<a class="playerlink" href="' + GAME + "info_player&id=" + esc(o.id) +
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
  // Rounds ONCE at the output unit, then splits — so 59m50s is "1h" (not
  // "60m"), 23h50m is "1d" and 1d 23h40m is "2d" (not "24h" / "1d 24h").
  function dur(seconds) {
    var s = Math.max(0, Math.round(seconds));
    if (s < 3570) return Math.max(1, Math.round(s / 60)) + "m";
    var hrs = Math.round(s / 3600);
    if (hrs < 24) return hrs + "h";
    var d = Math.floor(hrs / 24), h = hrs % 24;
    return h ? d + "d " + h + "h" : d + "d";
  }

  // Paged table: `size` rows of a list per page into <tbody> `body`, rendered
  // by rowsHtml(slice) — which must also return the "empty" row for []. The
  // `pager` element holds [data-pg=prev|info|next] and hides itself when the
  // list fits on one page. Returns { set(list) } (back to page 1).
  function pagedTable(body, pager, size, rowsHtml) {
    var st = { list: [], page: 0 };
    var q = function (w) { return pager.querySelector('[data-pg="' + w + '"]'); };
    function render() {
      var total = st.list.length, pages = Math.max(1, Math.ceil(total / size));
      st.page = Math.max(0, Math.min(st.page, pages - 1));
      var start = st.page * size;
      body.innerHTML = rowsHtml(st.list.slice(start, start + size));
      q("info").textContent = (start + 1) + "–" + Math.min(start + size, total) + " de " + commas(total);
      q("prev").disabled = st.page <= 0;
      q("next").disabled = st.page >= pages - 1;
      pager.hidden = pages <= 1;
    }
    q("prev").addEventListener("click", function () { st.page--; render(); });
    q("next").addEventListener("click", function () { st.page++; render(); });
    return { set: function (list) { st.list = list || []; st.page = 0; render(); } };
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
  // NETWORK failures (and hangs — see below) fail over — an HTTP error is the
  // Worker answering, and it would answer the same on either host.
  var API_HOSTS = [
    "https://tw-calc-proxy.pages.dev",
    "https://tw-calc-uploads.gdqshd.workers.dev",
  ];
  // A host that never ANSWERS (seen 2026-09-24: pages.dev held a 1 KB index
  // request open for 90 s while both hosts answered a fresh call in <1 s) is
  // failed over too: each attempt gets API_TIMEOUT_MS via AbortController,
  // and a timeout counts as a network failure. The caller's own opts.signal
  // still aborts everything. TW.API_TIMEOUT_MS is read at call time (tests).
  var API_TIMEOUT_MS = 20000;
  function apiFetch(pathQuery, opts) {
    var limit = (window.TW && +window.TW.API_TIMEOUT_MS) || API_TIMEOUT_MS;
    function attempt(i) {
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var timedOut = false;
      var timer = ctl && setTimeout(function () { timedOut = true; ctl.abort(); }, limit);
      if (ctl && opts && opts.signal) opts.signal.addEventListener("abort", function () { ctl.abort(); });
      var o = opts ? Object.assign({}, opts) : {};
      if (ctl) o.signal = ctl.signal;
      return fetch(API_HOSTS[i] + pathQuery, o).then(function (r) {
        if (timer) clearTimeout(timer);
        return r;
      }, function (e) {
        if (timer) clearTimeout(timer);
        if (opts && opts.signal && opts.signal.aborted) return Promise.reject(e); // the caller gave up
        var err = timedOut ? new Error("sin respuesta en " + Math.round(limit / 1000) + " s") : e;
        return i + 1 < API_HOSTS.length ? attempt(i + 1) : Promise.reject(err);
      });
    }
    return attempt(0);
  }

  window.TW = {
    WORLD: WORLD, DATA: DATA, GAME: GAME, SRV_FMT: SRV_FMT,
    apiFetch: apiFetch,
    fmtTime: fmtTime, fmtStamp: fmtStamp, fmtDate: fmtDate, fmtDateTime: fmtDateTime, weekday: weekday,
    fmtDayUTC: fmtDayUTC, weekdayUTC: weekdayUTC,
    srvEpoch: srvEpoch,
    esc: esc, commas: commas, continent: continent, loadJSON: loadJSON, playerArchive: playerArchive,
    playerLink: playerLink, tribeLink: tribeLink,
    villageCell: villageCell, ownerCell: ownerCell, deltaCell: deltaCell,
    changeCell: changeCell, relTime: relTime, dur: dur, initTabs: initTabs, pagedTable: pagedTable,
    renderNav: renderNav,
  };
})();
