/* report-render.js — render a reportsExport.js record like the in-game report.
   Classic script, fully self-contained (no other module needed). Lives in the
   CALCULATOR's js/ and is served from tw-scripts/js/ in prod, where the twstats
   pages load it as ../js/report-render.js (same single-file pattern as
   reports-intel.js — one renderer, so the two sites can never drift).
   Consumers: the calculator's Enemy Villages "View report" modal, the twstats
   Entrantes badge-click modal and the Subir Informes local viewer.
   Pure: TWRR.reportHtml(record) returns HTML, no DOM access, no fetch.

   Icon paths default to '../icons/…' (right for the twstats pages, one level
   below tw-scripts/); the calculator sits next to icons/ and calls
   TWRR.setIconBase('icons/') before rendering.

   Faithful to the game's report layout (see Tribalwars/report_image.png):
   subject + battle time, luck bar + morale, Atacante/Defensor troop tables
   (all unit columns, zeros muted, Cantidad/Pérdidas rows), Espionaje
   (resources + building grid) and Unidades fuera. What reportsExport does
   not capture (result headline, haul, wall damage, loyalty) is not shown —
   nothing is invented.

   Known-empty vs unknown (mirrors js/reports-intel.js): a record with
   spy data (resources/buildings) but NO defenderTroops means the garrison
   was provably EMPTY (zeros row); no troops AND no spy data means the
   defender was never seen (e.g. all spies died) — rendered as "?".
   Unidades fuera is STRICTER: the game only shows that block when ≥90% of
   the attacking spies survived, so it renders only when the record has an
   away table or the spy run came back intact (spiesIntact) — otherwise the
   block is omitted, exactly like the game. */
(function () {
  "use strict";

  // es100 unit roster, game column order (no archer/marcher on this world).
  var UNITS = ["spear", "sword", "axe", "spy", "light", "heavy", "ram", "catapult", "knight", "snob"];
  var UNIT_ES = {
    spear: "Lanza", sword: "Espada", axe: "Hacha", spy: "Espía", light: "Caballería ligera",
    heavy: "Caballería pesada", ram: "Ariete", catapult: "Catapulta", knight: "Paladín", snob: "Noble",
  };
  // Building key → [icon file (<base>buildings/), Spanish name], game order.
  var BLD = [
    ["main", "headquarters", "Edificio Principal"], ["barracks", "barracks", "Cuartel"],
    ["stable", "stable", "Cuadra"], ["garage", "workshop", "Taller"],
    ["snob", "academy", "Academia"],
    ["smith", "smithy", "Herrería"], ["place", "rally_point", "Plaza de reuniones"],
    ["statue", "statue", "Estatua"], ["market", "market", "Mercado"],
    ["wood", "timber_camp", "Leñador"], ["stone", "clay_pit", "Barrera"],
    ["iron", "iron_mine", "Mina de hierro"], ["farm", "farm", "Granja"],
    ["storage", "warehouse", "Almacén"], ["hide", "hiding_place", "Escondrijo"],
    ["wall", "wall", "Muralla"],
  ];
  // Small inline-SVG resource icons (self-contained — no game assets needed).
  var RES_ICONS = {
    wood: '<svg class="twrr-res" viewBox="0 0 14 14"><rect x="1" y="5" width="12" height="5" rx="2.5" fill="#8a5a2a"/><ellipse cx="12" cy="7.5" rx="1.8" ry="2.5" fill="#d9b380"/><path d="M2 6.2c2 1 6 1 8 0" stroke="#6e4520" stroke-width=".8" fill="none"/></svg>',
    clay:  '<svg class="twrr-res" viewBox="0 0 14 14"><path d="M2 11c0-4 2.5-7 5-7s5 3 5 7z" fill="#c86f32"/><path d="M4 10.6c.3-2.4 1.6-4.6 3-4.6" stroke="#e0965e" stroke-width=".9" fill="none"/></svg>',
    iron:  '<svg class="twrr-res" viewBox="0 0 14 14"><path d="M3 10.5 5 5h4l2 5.5z" fill="#8d9299"/><path d="M5.4 5.8 4.2 9.6" stroke="#c8cdd4" stroke-width=".9"/><rect x="2" y="10.5" width="10" height="1.6" rx=".8" fill="#5f646b"/></svg>',
  };
  var RES_ES = { wood: "Madera", clay: "Arcilla", iron: "Hierro" };

  // Where the unit/building icons live, relative to the page. Defaults suit
  // the twstats pages; the calculator overrides via setIconBase (see header).
  var ICON_BASE = "../icons/";
  function setIconBase(p) { if (p) ICON_BASE = p; }

  // Minutes per field. Defaults are the base unit speeds, which ARE the es100
  // values (world_speed 2 × unit_speed 0.5 ⇒ divisor 1 — measured to
  // 0.00025 min/field on 259 real attacks, see the Entrantes page). Pages
  // that load get_unit_info.xml can override via TWRR.setSpeeds.
  var SPEED = {
    spear: 18, sword: 22, axe: 18, archer: 18, spy: 9, light: 10, marcher: 10,
    heavy: 11, ram: 30, catapult: 30, knight: 10, snob: 35,
  };
  function setSpeeds(map) {
    for (var k in map) if (+map[k] > 0) SPEED[k] = +map[k];
  }

  // Slowest unit present in a troops map — an army travels at its slowest
  // unit's pace. null when empty or when it holds a unit we have no speed
  // for (no honest estimate then).
  function slowest(units) {
    var key = null;
    for (var u in units) {
      if (!(+units[u] > 0)) continue;
      if (SPEED[u] == null) return null;
      if (key === null || SPEED[u] > SPEED[key]) key = u;
    }
    return key;
  }

  // Derived send/return times. The report only records the battle moment, but
  // the full sent army is known, so: sent = battle − distance × slowest sent
  // unit. The survivors return AT THE SAME PACE they came (the command keeps
  // its sent speed — a ram+spy attack whose ram died still walks home at ram
  // speed); the return row exists only if ≥1 unit survived (sent − losses).
  function travelTimes(r) {
    if (!r || typeof r.attackerX !== "number" || typeof r.attackerY !== "number" ||
        typeof r.defenderX !== "number" || typeof r.defenderY !== "number" ||
        !+r.reportTimestamp || !r.attackerTroops) return null;
    var dx = r.attackerX - r.defenderX, dy = r.attackerY - r.defenderY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var sentBy = slowest(r.attackerTroops);
    if (!sentBy || !dist) return null;
    var out = { dist: dist, sentUnit: sentBy, sent: +r.reportTimestamp - dist * SPEED[sentBy] * 60000 };
    var survived = false;
    for (var u in r.attackerTroops) {
      if ((+r.attackerTroops[u] || 0) - ((r.attackerLosses && +r.attackerLosses[u]) || 0) > 0) {
        survived = true; break;
      }
    }
    if (survived) { out.retUnit = sentBy; out.ret = +r.reportTimestamp + dist * SPEED[sentBy] * 60000; }
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function n(x) { return Number(+x || 0).toLocaleString("en-US"); }
  function pad(x) { return (x < 10 ? "0" : "") + x; }
  // In-game style battle time: 03.08.26 17:06:04.
  // ⚠ TIMESTAMP CONTRACT (reportsExport.js parseTWDate): reportTimestamp is
  // the SERVER WALL-CLOCK the game page displayed, encoded via Date.UTC — it
  // is NOT a real instant. So render it back with the UTC getters and you get
  // the game's own string 1:1, from any device, in any timezone. Never convert
  // to a timezone here (viewer-local OR a hardcoded server zone both shift it),
  // and DST changes need NOTHING — the wall clock was baked in at export time.
  function fmtT(ms) {
    var d = new Date(+ms || 0);
    return pad(d.getUTCDate()) + "." + pad(d.getUTCMonth() + 1) + "." + String(d.getUTCFullYear()).slice(2) +
      " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  }
  function vil(name, x, y) {
    var c = (x != null && y != null) ? " (" + x + "|" + y + ")" : "";
    return esc(name || "—") + c + ((x != null && y != null) ? " " + cont(x, y) : "");
  }
  function cont(x, y) { return "K" + (Math.floor(y / 100) * 10 + Math.floor(x / 100)); }

  // One in-game troop table: icon header + Cantidad row (+ Pérdidas when the
  // side fought). `units`/`losses` are cleaned maps (zeros absent).
  // unknown=true renders "?" cells (defender never seen).
  function troopTable(units, losses, showLosses, unknown) {
    var h = '<table class="twrr-units"><tr><td class="twrr-label"></td>' + UNITS.map(function (u) {
      return '<td><img src="' + ICON_BASE + 'units/' + u + '.png" alt="" title="' + UNIT_ES[u] + '"></td>';
    }).join("") + "</tr>";
    var row = function (label, m) {
      return '<tr><td class="twrr-label">' + label + ":</td>" + UNITS.map(function (u) {
        if (unknown) return '<td class="twrr-z">?</td>';
        var v = (m && m[u]) || 0;
        return "<td" + (v ? "" : ' class="twrr-z"') + ">" + n(v) + "</td>";
      }).join("") + "</tr>";
    };
    h += row("Cantidad", units);
    if (showLosses) h += row("Pérdidas", losses);
    return h + "</table>";
  }

  function subjectLine(r) {
    var verb = r.reportType === "scout" ? "espía a" : "ataca a";
    return esc(r.attackerPlayerName || "—") + " (" + vil(r.attackerVillageName, r.attackerX, r.attackerY) + ") " +
      verb + " " + vil(r.defenderVillageName, r.defenderX, r.defenderY);
  }

  // The luck bar: a 100px track centered at 0, colored segment by sign.
  function luckHtml(luck) {
    var pct = Math.max(-25, Math.min(25, +luck || 0));
    var w = Math.abs(pct) * 2; // 25% luck = half the track
    var seg = pct >= 0
      ? '<div class="twrr-luck-seg twrr-luck-pos" style="left:50%;width:' + w + "%\"></div>"
      : '<div class="twrr-luck-seg twrr-luck-neg" style="right:50%;width:' + w + "%\"></div>";
    return '<div class="twrr-luckwrap"><span class="twrr-lucknum">' + (+luck > 0 ? "+" : "") + (+luck || 0) +
      '%</span><div class="twrr-luckbar">' + seg + '<div class="twrr-luck-mid"></div></div></div>';
  }

  // Mirrors riSpiesIntact in js/reports-intel.js: the game only renders the
  // units-outside block when at least 90% of the attacking spies survived.
  function spiesIntact(r) {
    var sent = r.attackerTroops ? +r.attackerTroops.spy || 0 : 0;
    if (!sent) return false;
    var lost = r.attackerLosses ? +r.attackerLosses.spy || 0 : 0;
    return (sent - lost) / sent >= 0.9;
  }

  function reportHtml(r) {
    if (!r || typeof r !== "object") return "";
    var spied = !!(r.resources || r.buildings);
    var h = '<div class="twrr">';

    // Subject + battle time (the report header block), plus the derived
    // send/return times (≈: computed, not in the report — see travelTimes).
    var tt = travelTimes(r);
    h += '<table class="twrr-head"><tr><th>Asunto</th><td>' + subjectLine(r) + "</td></tr>" +
      "<tr><th>Hora de batalla</th><td>" + fmtT(r.reportTimestamp) + "</td></tr>";
    if (tt) {
      var distTxt = tt.dist.toFixed(1) + " campos";
      h += '<tr><th>Envío ≈</th><td title="Hora de batalla − viaje (unidad más lenta enviada: ' +
        UNIT_ES[tt.sentUnit] + ", " + SPEED[tt.sentUnit] + " min/campo × " + distTxt + ')">' +
        fmtT(tt.sent) + "</td></tr>";
      if (tt.ret) {
        h += '<tr><th>Regreso ≈</th><td title="Hora de batalla + viaje (los supervivientes vuelven a la velocidad de ida: ' +
          UNIT_ES[tt.retUnit] + ", " + SPEED[tt.retUnit] + " min/campo × " + distTxt + ')">' +
          fmtT(tt.ret) + "</td></tr>";
      }
    }
    h += "</table>";

    // Luck + morale (attack/scout reports carry both).
    if (r.luck != null || r.morale != null) {
      h += '<div class="twrr-sec twrr-luckmoral">';
      if (r.luck != null) h += "<h4>Suerte del atacante</h4>" + luckHtml(r.luck);
      if (r.morale != null) h += "<h4>Moral: " + (+r.morale || 0) + "%</h4>";
      h += "</div>";
    }

    // Atacante
    if (r.attackerTroops) {
      h += '<div class="twrr-side"><table class="twrr-who"><tr><th>Atacante:</th><td>' +
        esc(r.attackerPlayerName || "—") + "</td></tr><tr><th>Origen:</th><td>" +
        vil(r.attackerVillageName, r.attackerX, r.attackerY) + "</td></tr></table>" +
        troopTable(r.attackerTroops, r.attackerLosses, true, false) + "</div>";
    }

    // Defensor — troops row absent + spied ⇒ known-empty (zeros); absent and
    // not spied ⇒ never seen ("?" cells, like when no spy survives).
    var defUnknown = !r.defenderTroops && !spied;
    h += '<div class="twrr-side"><table class="twrr-who"><tr><th>Defensor:</th><td>' +
      esc(r.defenderPlayerName || "—") + "</td></tr><tr><th>Destino:</th><td>" +
      vil(r.defenderVillageName, r.defenderX, r.defenderY) + "</td></tr></table>" +
      troopTable(r.defenderTroops, r.defenderLosses, !defUnknown, defUnknown) + "</div>";

    // Espionaje
    if (spied) {
      h += '<div class="twrr-sec"><h4 class="twrr-esp">Espionaje</h4>';
      if (r.resources) {
        h += '<table class="twrr-resrow"><tr><th>Recursos espiados:</th><td>' +
          ["wood", "clay", "iron"].map(function (k) {
            return '<span class="twrr-resitem" title="' + RES_ES[k] + '">' + RES_ICONS[k] + " " + n(r.resources[k]) + "</span>";
          }).join(" ") + "</td></tr></table>";
      }
      if (r.buildings) {
        var rows = BLD.filter(function (b) { return (+r.buildings[b[0]] || 0) > 0; });
        var half = Math.ceil(rows.length / 2);
        var col = function (list) {
          return '<table class="twrr-bld"><tr><th>Edificio</th><th>Nivel</th></tr>' + list.map(function (b) {
            return '<tr><td><img src="' + ICON_BASE + 'buildings/' + b[1] + '.webp" alt=""> ' + b[2] +
              "</td><td>" + (+r.buildings[b[0]]) + "</td></tr>";
          }).join("") + "</table>";
        };
        h += '<div class="twrr-bldcols">' + col(rows.slice(0, half)) + col(rows.slice(half)) + "</div>";
      }
      h += "</div>";
    }

    // Unidades fuera — shown when seen, or all-zero when a CLEAN spy run
    // proved nothing was outside (same known-empty logic as the classifier).
    // A mauled spy run (<90% survivors) had this block hidden in the game —
    // omit it here too.
    if (r.defenderTroopsAway || (spied && spiesIntact(r))) {
      h += '<div class="twrr-sec"><table class="twrr-away"><tr><th>Unidades fuera:</th></tr></table>' +
        troopTable(r.defenderTroopsAway || {}, null, false, false) + "</div>";
    }

    return h + "</div>";
  }

  // globalThis covers the browser (=== window), jsdom and the vm test
  // sandboxes in one expression — classic script, so this IS the global TWRR.
  (typeof globalThis !== "undefined" ? globalThis : window).TWRR = {
    reportHtml: reportHtml, subjectLine: subjectLine, fmtT: fmtT,
    travelTimes: travelTimes, setSpeeds: setSpeeds, setIconBase: setIconBase,
  };
})();
