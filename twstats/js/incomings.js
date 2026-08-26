/* "Entrantes" — paste what is attacking you and flag the likely fakes: villages
   with too few points, or conquered recently (troops not rebuilt yet).
   Classic script; needs common.js first.

   Two input formats, auto-detected:
     · coords    — a bare list of coordinates ("573|525 572|527 …"). The
                   conquest test is relative to NOW.
     · attacks   — the in-game incomings BB-code dump ([b]Pueblo:[/b] headers +
                   [command]attack[/command] lines). One row per attack command,
                   and the conquest test is relative to that attack's SENT time,
                   which is the whole point: an attack with 60 h of travel was
                   launched from a village whose state 60 h ago is what matters.

   In attack mode the dump is mined for everything it will give, so this page
   covers most of what RedAlert's in-game "Incomings Overview" shows (see
   Tribalwars/.claude/PLAN-twstats-es103.md §5.1 for the full comparison):
     · troop class per attack, from duration ÷ distance — the icon is NOT in the
       dump, but min/field identifies the SLOWEST unit exactly, which is more
       useful: it makes noble trains unambiguous (they are the slowest thing in
       the game) and separates ram nukes from fast fakes.
     · command trains (same target, consecutive arrivals ~attack_gap apart)
     · AS i/n duplicate numbering per origin village
     · totals, arrival histogram, origin/destination combinations
     · your attacked villages' wall / loyalty / troops, straight from the dump

   Data: villages.json + conquers.json (twstats data, fetched once on page load)
   and the world's get_config.xml / get_unit_info.xml, which live one level up in
   the calculators' data folder and are what make the speed maths possible. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var LS_POINTS = "tw.entrantes.minPoints";
  var LS_DAYS = "tw.entrantes.maxDays";
  var LS_BLINDADO = "tw.entrantes.blindado";
  var LS_ESQUIVAR = "tw.entrantes.esquivar";
  // The static world files are served from the calculators' data dir, a sibling
  // of twstats/ — NOT from twstats' own data/ (which the build rsyncs --delete).
  var WORLD_DATA = "../data/" + TW.WORLD + "/";

  var UNIT_ES = {
    spear: "Lanza", sword: "Espada", axe: "Hacha", archer: "Arquero",
    spy: "Espía", light: "CL", marcher: "Arq. caballo", heavy: "CP",
    ram: "Ariete", catapult: "Catapulta", knight: "Paladín", snob: "Noble",
  };

  // Which units count as defence vs offence when judging one of YOUR villages.
  // spy / knight / snob are neither.
  var DEF_UNITS = { spear: 1, sword: 1, archer: 1, heavy: 1 };
  var OFF_UNITS = { axe: 1, light: 1, marcher: 1, ram: 1, catapult: 1 };

  var state = {
    ready: null,        // Promise resolved when both datasets are indexed
    byCoord: {},        // "x|y" -> village record {id,name,x,y,points,owner}
    lastConquer: {},    // village id -> {t, oldOwner, newOwner}
    cfg: null,          // world config (speeds, attack_gap, snob max_dist)
    mode: "coords",     // "coords" | "attacks"
    rows: [],           // last analysis result (all rows)
    targets: {},        // attack mode: target coord -> {wall, loyalty, def}
    reports: null,      // coord -> village facts from the shared reports DB (null = unavailable)
    reportsMeta: null,  // { villages, reports, updated } when the DB loaded
    orders: null,       // optional incoming_orders*.json upload («.json Órdenes»)
    bonus: {},          // "x|y" -> bonus_id (only the ids BONUS_META knows)
    filters: {},        // attack mode table filters
  };

  // Bonus-village icons (Origen del ataque): recruit-speed and farm bonuses
  // change what an origin can field — resource bonuses (ids 1-3, 8-9) don't,
  // so they deliberately get no icon. bonus_id mapping = the standard TW
  // village.txt column (same table as tw_world_data's notify_bonus_barbs.py).
  var BONUS_META = {
    4: { icon: "farm", title: "Pueblo bonificado: +10% de población (granja)" },
    5: { icon: "barracks", title: "Pueblo bonificado: reclutamiento un 33% más rápido (cuartel)" },
    6: { icon: "stable", title: "Pueblo bonificado: reclutamiento un 33% más rápido (establo)" },
    7: { icon: "workshop", title: "Pueblo bonificado: reclutamiento un 50% más rápido (taller)" },
  };

  // === shared reports DB (tribe-calculator Enemy Villages pipeline) =========
  // Per-village facts merged server-side from everyone's reportsExport.js
  // uploads (troops seen at home / away / sent, spied buildings). Classified
  // client-side by ../js/reports-intel.js — the SAME file the calculator
  // ships, loaded by incomings.html, so the verdicts can never diverge.
  var REPORTS_DB_PATH = "/reports?world=es103"; // fetched via TW.apiFetch (hostname failover)

  // === world config ========================================================
  // Travel minutes per field = base_speed / (world_speed × unit_speed).
  // On es103 that divisor is 1, so min/field IS the raw unit speed.
  function parseWorldConfig(cfgXml, unitXml) {
    function num(doc, tag) {
      var el = doc.getElementsByTagName(tag)[0];
      return el ? parseFloat(el.textContent) : null;
    }
    var speed = num(cfgXml, "speed") || 1;
    var unitSpeed = num(cfgXml, "unit_speed") || 1;
    var snobEl = cfgXml.getElementsByTagName("snob")[0];
    var maxDist = snobEl && snobEl.getElementsByTagName("max_dist")[0]
      ? parseFloat(snobEl.getElementsByTagName("max_dist")[0].textContent) : null;

    var units = [], root = unitXml.documentElement;
    for (var i = 0; i < root.children.length; i++) {
      var u = root.children[i];
      var sp = u.getElementsByTagName("speed")[0];
      if (!sp) continue;
      var pop = u.getElementsByTagName("pop")[0];
      units.push({
        key: u.tagName,
        name: UNIT_ES[u.tagName] || u.tagName,
        minPerField: parseFloat(sp.textContent) / (speed * unitSpeed),
        pop: pop ? parseFloat(pop.textContent) : 1,
        role: DEF_UNITS[u.tagName] ? "def" : (OFF_UNITS[u.tagName] ? "off" : null),
      });
    }
    // Units sharing a speed are indistinguishable from travel time alone, so
    // classify into speed GROUPS and label them honestly ("Ariete/Catapulta").
    var groups = [], byMpf = {};
    units.forEach(function (u) {
      var k = u.minPerField.toFixed(4);
      if (!byMpf[k]) { byMpf[k] = { minPerField: u.minPerField, units: [], keys: [] }; groups.push(byMpf[k]); }
      byMpf[k].units.push(u.name);
      byMpf[k].keys.push(u.key);
    });
    groups.forEach(function (g) {
      g.label = g.units.join("/");
      g.isNoble = g.keys.indexOf("snob") !== -1;
      // Siege/noble pace = the slow, heavy commands. A fake is cheap to send
      // fast; dragging rams or a noble across the map usually means business.
      g.isSiege = g.keys.indexOf("ram") !== -1 || g.keys.indexOf("catapult") !== -1;
      g.isHeavy = g.isNoble || g.isSiege;
    });
    groups.sort(function (a, b) { return a.minPerField - b.minPerField; });

    return {
      speed: speed, unitSpeed: unitSpeed,
      attackGap: num(cfgXml, "attack_gap") || 100,
      snobMaxDist: maxDist,
      units: units, groups: groups,
    };
  }

  // Unit names as they show up in command labels, so a tagged incoming
  // ("Ariete", "Nobles", "Fake CL") yields its travel speed even when the line
  // carries no sent / duration / return at all.
  var UNIT_ALIASES = {
    spear: ["lanza", "lanzas", "spear"],
    sword: ["espada", "espadas", "sword"],
    axe: ["hacha", "hachas", "axe", "axes"],
    archer: ["arquero", "arqueros", "archer"],
    spy: ["explorador", "exploradores", "espia", "spy", "scout"],
    light: ["cl", "lc", "ligera", "caballeria ligera", "light"],
    marcher: ["arquero a caballo", "marcher"],
    heavy: ["cp", "pesada", "caballeria pesada", "heavy"],
    ram: ["ariete", "arietes", "ram", "rams"],
    catapult: ["catapulta", "catapultas", "cata", "catas", "catapult"],
    knight: ["paladin", "knight"],
    snob: ["noble", "nobles", "nobleza", "snob"],
  };
  function deaccent(s) {
    return String(s).toLowerCase()
      .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
      .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n");
  }
  // A command moves at its SLOWEST unit, so when a label names several, the
  // slowest one is the honest choice ("nobles + arietes" travels at noble pace).
  function speedFromLabel(label) {
    if (!state.cfg || !label) return null;
    var txt = deaccent(label), best = null;
    state.cfg.groups.forEach(function (g) {
      g.keys.forEach(function (key) {
        var aliases = UNIT_ALIASES[key] || [key];
        for (var i = 0; i < aliases.length; i++) {
          var re = new RegExp("(^|[^a-z])" + aliases[i].replace(/ /g, "\\s+") + "([^a-z]|$)");
          if (re.test(txt) && (!best || g.minPerField > best.minPerField)) { best = g; return; }
        }
      });
    });
    return best;
  }

  // Tolerance in min/field. Durations are whole seconds and distances exact, so
  // real commands land within ~0.001 of a unit speed; 0.15 is generous but still
  // far below the smallest gap between adjacent classes (9 → 10).
  var SPEED_TOL = 0.15;
  function classifySpeed(minPerField) {
    if (!state.cfg || !isFinite(minPerField)) return null;
    var best = null, bestD = Infinity;
    state.cfg.groups.forEach(function (g) {
      var d = Math.abs(g.minPerField - minPerField);
      if (d < bestD) { bestD = d; best = g; }
    });
    return bestD <= SPEED_TOL ? best : null;
  }

  // === parsing =============================================================
  // A coord is simply "<1-3 digits>|<1-3 digits>"; any separator works.
  function parseCoords(text) {
    var re = /(\d{1,3})\|(\d{1,3})/g, seen = {}, out = [], m;
    while ((m = re.exec(text)) !== null) {
      var key = Number(m[1]) + "|" + Number(m[2]);
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ key: key, x: Number(m[1]), y: Number(m[2]) });
    }
    return out;
  }

  function isAttackDump(text) { return /\[command\]attack\[\/command\]/i.test(text); }

  // An attack line is parsed FIELD BY FIELD, not with one rigid pattern: real
  // dumps vary in which of sent / return / duration they carry, and a single
  // all-or-nothing regex silently DROPPED any line missing one of them.
  //
  // The arrival ("Hora de llegada") is the anchor — it is the only timestamp
  // with a year, and the incomings screen always has it. Everything else is
  // recoverable from it, because on a verified 259-attack dump both identities
  // hold exactly, to the second:
  //     arrival = sent + duration        return = arrival + duration
  // so ANY ONE of {sent, duration, return} plus the arrival gives the rest.
  var ATTACK_LINE_RE = /\[command\]attack\[\/command\]/i;
  var RE_LABEL = /\[command\]attack\[\/command\]\s*(.*?)\s*(?:\||\[coord\])/i;
  var RE_PLAYER = /\|\s*player\s+(.+?)\s+\|/i;
  var RE_SENT = /\bsent\s+(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?\s+(\d{1,2}):(\d{2}):(\d{2})/i;
  var RE_RETURN = /\breturn\s+(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?\s+(\d{1,2}):(\d{2}):(\d{2})/i;
  var RE_DURATION = /\bduration\s+(\d{1,4}):(\d{2}):(\d{2})/i;
  var RE_ORIGIN = /\[coord\](\d{1,3})\|(\d{1,3})\[\/coord\]/i;
  // A full date-time WITH a year — matched globally, and the LAST one on the
  // line wins, so a "sent 26.07.26 …" variant can never be mistaken for it.
  var RE_STAMP = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,3}))?/g;

  function hhmmssToSec(h, m, s) { return Number(h) * 3600 + Number(m) * 60 + Number(s); }

  // A dd.MM time with no year, dated from the arrival it belongs to. `dir` is
  // -1 for `sent` (never after the arrival) and +1 for `return` (never before).
  function datedAgainst(m, arrivalYear, arrivalMonth, dir) {
    var day = Number(m[1]), month = Number(m[2]);
    var year = m[3] ? (m[3].length <= 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    if (year == null) {
      year = arrivalYear;
      if (dir < 0 && month > arrivalMonth) year--;        // sent crossed New Year
      if (dir > 0 && month < arrivalMonth) year++;        // return crosses it
    }
    return TW.srvEpoch(year, month, day, Number(m[4]), Number(m[5]), Number(m[6]));
  }
  // A "[b]…[/b] [coord]x|y[/coord]" line = the village being attacked. Matched
  // structurally (not by the Spanish word "Pueblo") so other locales still work.
  var TARGET_RE = /\[b\][^\]]*\[\/b\][^\n]*?\[coord\](\d{1,3})\|(\d{1,3})\[\/coord\]/i;
  // "[b]<label>:[/b] <numbers>" — wall level, loyalty, or the defender troop row.
  var TARGET_FIELD_RE = /\[b\]([^\[]*)\[\/b\]\s*([\d\s]+)\s*$/i;

  function parseAttacks(text) {
    var lines = text.split(/\r?\n/), out = [], targets = {}, cur = null;
    var skipped = [], inconsistent = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (ATTACK_LINE_RE.test(line)) {
        var origin = RE_ORIGIN.exec(line);
        // Take the LAST year-bearing timestamp on the line: that's the arrival.
        RE_STAMP.lastIndex = 0;
        var st, arrM = null;
        while ((st = RE_STAMP.exec(line)) !== null) arrM = st;
        if (!origin || !arrM) { skipped.push(line.trim()); continue; }

        var aYear = arrM[3].length <= 2 ? 2000 + Number(arrM[3]) : Number(arrM[3]);
        var aMonth = Number(arrM[2]);
        var arrival = TW.srvEpoch(aYear, aMonth, Number(arrM[1]),
          Number(arrM[4]), Number(arrM[5]), Number(arrM[6]));

        var sm = RE_SENT.exec(line), rm = RE_RETURN.exec(line), dm = RE_DURATION.exec(line);
        var sentExplicit = sm ? datedAgainst(sm, aYear, aMonth, -1) : null;
        var retExplicit = rm ? datedAgainst(rm, aYear, aMonth, +1) : null;

        // duration, from whichever of the three is present (all agree)
        var durSec = null, sentSource = null;
        if (dm) durSec = hhmmssToSec(dm[1], dm[2], dm[3]);
        else if (sentExplicit != null) durSec = arrival - sentExplicit;
        else if (retExplicit != null) durSec = retExplicit - arrival;

        var sent = sentExplicit;
        if (sent != null) sentSource = "explicit";
        else if (durSec != null) { sent = arrival - durSec; sentSource = dm ? "duration" : "return"; }

        // Both stated? Then they must agree, or something is being misread.
        if (sentExplicit != null && dm != null &&
            Math.abs((sentExplicit + hhmmssToSec(dm[1], dm[2], dm[3])) - arrival) > 2) {
          inconsistent++;
        }

        var lm = RE_LABEL.exec(line), pm = RE_PLAYER.exec(line);
        out.push({
          label: lm ? lm[1] : "",
          player: pm ? pm[1].trim() : "?",
          origin: { key: Number(origin[1]) + "|" + Number(origin[2]), x: Number(origin[1]), y: Number(origin[2]) },
          target: cur,
          sent: sent,
          sentSource: sentSource,
          returnT: retExplicit != null ? retExplicit : (durSec != null ? arrival + durSec : null),
          durationMin: durSec != null ? durSec / 60 : null,
          arrival: arrival,
          arrivalMs: arrM[7] ? Number((arrM[7] + "00").slice(0, 3)) : 0,
        });
        continue;
      }

      var t = TARGET_RE.exec(line);
      if (t) {
        var key = Number(t[1]) + "|" + Number(t[2]);
        cur = targets[key] || (targets[key] = {
          key: key, x: Number(t[1]), y: Number(t[2]),
          wall: null, loyalty: null, def: null,
        });
        continue;
      }

      // Wall / loyalty / defender rows belong to the target block above them.
      var f = cur && TARGET_FIELD_RE.exec(line);
      if (f) {
        var label = f[1].toLowerCase();
        var nums = f[2].trim().split(/\s+/).map(Number);
        if (nums.length >= 5) cur.def = nums;
        else if (/muralla|wall/.test(label)) cur.wall = nums[0];
        else if (/lealtad|loyalt|moral/.test(label)) cur.loyalty = nums[0];
        else if (cur.wall == null) cur.wall = nums[0];
        else if (cur.loyalty == null) cur.loyalty = nums[0];
      }
    }
    return { attacks: out, targets: targets, skipped: skipped, inconsistent: inconsistent };
  }

  // === derived attack facts ================================================
  function enrichAttacks(attacks) {
    // distance + troop class
    attacks.forEach(function (a) {
      if (a.target && a.durationMin != null) {
        a.distance = Math.sqrt(Math.pow(a.origin.x - a.target.x, 2) +
                               Math.pow(a.origin.y - a.target.y, 2));
        a.minPerField = a.distance ? a.durationMin / a.distance : null;
        a.speed = classifySpeed(a.minPerField);
      } else if (a.target) {
        // No timings at all. Distance is still known, so the arrival alone can
        // still yield a sent time IF we can pin the travel speed:
        //   · the label names a unit  → exact, given that tag is honest
        //   · it doesn't             → bracket it between the slowest and
        //                              fastest units; never invent one number
        a.distance = Math.sqrt(Math.pow(a.origin.x - a.target.x, 2) +
                               Math.pow(a.origin.y - a.target.y, 2));
        a.minPerField = null; a.speed = null;

        var tagged = speedFromLabel(a.label);
        if (tagged && a.distance) {
          a.durationMin = tagged.minPerField * a.distance;
          a.sent = a.arrival - Math.round(a.durationMin * 60);
          a.returnT = a.arrival + Math.round(a.durationMin * 60);
          a.sentSource = "unit-tag";
          a.speed = tagged;
          a.speedFromTag = true;          // assumed, not measured — render says so
          a.minPerField = tagged.minPerField;
        } else if (state.cfg && a.distance) {
          var groups = state.cfg.groups;
          var slowest = groups[groups.length - 1], fastest = groups[0];
          a.sentMin = a.arrival - Math.round(slowest.minPerField * a.distance * 60);
          a.sentMax = a.arrival - Math.round(fastest.minPerField * a.distance * 60);
          a.sentSource = "range";
        }
      } else {
        a.distance = null; a.minPerField = null; a.speed = null;
      }
    });

    // AS i/n — duplicates from the same origin village, ordered by arrival.
    // (The dump's own "AS:" labels may be stale; this is recomputed fresh.)
    var byOrigin = {};
    attacks.forEach(function (a) { (byOrigin[a.origin.key] = byOrigin[a.origin.key] || []).push(a); });
    Object.keys(byOrigin).forEach(function (k) {
      var list = byOrigin[k].slice().sort(function (p, q) { return p.arrival - q.arrival; });
      list.forEach(function (a, i) { a.dupIndex = i + 1; a.dupTotal = list.length; });
    });

    // Command trains: same target, consecutive arrivals ~attack_gap apart. This
    // is RedAlert's noble signature, but scoped per target (a global scan pairs
    // unrelated commands) and cross-checked against the troop class below.
    var gap = state.cfg ? state.cfg.attackGap : 100;
    var byTarget = {};
    attacks.forEach(function (a) {
      if (a.target) (byTarget[a.target.key] = byTarget[a.target.key] || []).push(a);
    });
    var trainId = 0;
    Object.keys(byTarget).forEach(function (k) {
      var list = byTarget[k].slice().sort(function (p, q) {
        return (p.arrival - q.arrival) || (p.arrivalMs - q.arrivalMs);
      });
      var run = [list[0]];
      function flush() {
        if (run.length >= 2) {
          trainId++;
          var allNoble = run.every(function (a) { return a.speed && a.speed.isNoble; });
          var inRange = state.cfg && state.cfg.snobMaxDist != null
            ? run.every(function (a) { return a.distance <= state.cfg.snobMaxDist; })
            : true;
          run.forEach(function (a) {
            a.train = { id: trainId, size: run.length, noble: allNoble && inRange };
          });
        }
        run = [];
      }
      for (var i = 1; i < list.length; i++) {
        var prev = list[i - 1], curA = list[i];
        var dMs = (curA.arrival - prev.arrival) * 1000 + (curA.arrivalMs - prev.arrivalMs);
        if (dMs >= 0 && dMs <= gap * 1.5) run.push(curA);
        else { flush(); run = [curA]; }
      }
      flush();
    });
    return attacks;
  }

  // === órdenes .json (incomingOrders exporter, optional) ===================
  // The BB dump never carries the army inside a command — the incomingOrders
  // userscript export does (real per-unit counts + the game's small/medium/
  // large size icon). Uploading one is optional; each dump row is matched by
  // target village + origin village + EXACT arrival: the arrival (with its
  // milliseconds) is the command's identity in-game, so two exports taken at
  // different moments still agree on it. Nothing is guessed — an unmatched
  // row simply shows no units.
  var ORD_STAMP_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,3}))?$/;
  function ordArrival(s) {
    var m = ORD_STAMP_RE.exec(String(s || "").trim());
    if (!m) return null;
    var year = m[3].length <= 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return {
      t: TW.srvEpoch(year, Number(m[2]), Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])),
      ms: m[7] ? Number((m[7] + "00").slice(0, 3)) : 0,
    };
  }
  function ordCoord(s) {
    var m = /^(\d{1,3})\|(\d{1,3})$/.exec(String(s || "").trim());
    return m ? Number(m[1]) + "|" + Number(m[2]) : null;
  }
  function parseOrders(json) {
    if (!json || !Array.isArray(json.targets)) {
      throw new Error("no parece un incoming_orders*.json (falta la lista targets)");
    }
    var exact = {}, bySec = {}, n = 0;
    json.targets.forEach(function (t) {
      var tKey = ordCoord(t.coords);
      (t.commands || []).forEach(function (c) {
        if (c.type && c.type !== "attack") return;   // supports never match dump rows
        var oKey = ordCoord(c.origin_coords);
        var arr = ordArrival(c.arrival);
        if (!tKey || !oKey || !arr || !c.units) return;
        n++;
        var kSec = tKey + ">" + oKey + "@" + arr.t;
        exact[kSec + ":" + arr.ms] = c;
        (bySec[kSec] = bySec[kSec] || []).push(c);
      });
    });
    if (!n) throw new Error("el archivo no contiene ningún comando de ataque legible");
    return { exact: exact, bySec: bySec, commands: n, file: "" };
  }
  function orderFor(a) {
    if (!state.orders || !a.target) return null;
    var kSec = a.target.key + ">" + a.origin.key + "@" + a.arrival;
    var hit = state.orders.exact[kSec + ":" + a.arrivalMs];
    if (hit) return hit;
    // One side missing the milliseconds (older exports): a second-level match
    // is accepted only when it is unambiguous — trains 100 ms apart share the
    // same second, and picking one would show the WRONG army as fact.
    var cands = state.orders.bySec[kSec];
    return (cands && cands.length === 1) ? cands[0] : null;
  }
  // Attach the matched command to every analysed row (cached on the attack so
  // sorting/filtering re-renders don't re-match) and surface the tally. Runs
  // after every analysis and again when a .json is uploaded mid-session.
  function matchOrders() {
    var el = $("ordersNote");
    if (!state.orders) { el.hidden = true; buildOrdersFilters(); return; }
    var total = 0, matched = 0;
    state.rows.forEach(function (r) {
      if (!r.attack) return;
      total++;
      r.attack.order = orderFor(r.attack);
      if (r.attack.order) matched++;
    });
    el.textContent = "Órdenes .json" + (state.orders.file ? " (" + state.orders.file + ")" : "") +
      ": " + state.orders.commands + " comandos cargados" +
      (total ? " · " + matched + " de " + total +
        " ataques emparejados (objetivo + origen + hora de llegada exacta)"
             : " — se emparejarán al analizar tus entrantes");
    el.hidden = false;
    buildOrdersFilters();
  }

  // Units of a matched command: the game's size icon + one chip per nonzero
  // unit, in the canonical unit order. Icons live in the calculators' shared
  // ../icons/units/ (same set the hover card uses).
  var ORD_UNIT_ORDER = ["spear", "sword", "axe", "archer", "spy", "light",
                        "marcher", "heavy", "ram", "catapult", "knight", "snob"];
  var ORD_SIZE_ES = { small: "pequeño", medium: "mediano", large: "grande" };
  function ordersCellHtml(c) {
    var chips = ORD_UNIT_ORDER.filter(function (u) { return (c.units[u] || 0) > 0; })
      .map(function (u) {
        return '<span class="ord-unit" title="' + TW.esc(UNIT_ES[u] || u) +
          '"><img class="ord-ic" src="../icons/units/' + u + '.png" alt="' +
          TW.esc(UNIT_ES[u] || u) + '">' + TW.commas(c.units[u]) + "</span>";
      });
    var size = ORD_SIZE_ES[c.size]
      ? '<img class="ord-ic ord-size" src="../icons/units/attack_' + c.size +
        '.webp" alt="' + c.size + '" title="Ataque ' + ORD_SIZE_ES[c.size] +
        ' (icono del juego)">'
      : "";
    if (!chips.length && !size) return "";
    return '<span class="ord-units" title="Unidades según el .json de órdenes' +
      (c.label ? " · " + TW.esc(c.label) : "") + '">' + size + chips.join("") + "</span>";
  }

  // «Filtros de órdenes» (2026-08-21): with a .json loaded, what it revealed is
  // itself filterable — the game's size icon, armies bigger than the 2-unit
  // token fake (1 espía + 1 ariete/catapulta), and «Tropas desconocidas» (rows
  // the .json could NOT identify). One checkbox per state PRESENT in the rows
  // (with counts), OR-combined with each other exactly like the flag filters
  // and AND-combined with everything else — «desconocidas» sits in the same OR
  // group on purpose: "grande + mediano + desconocidas" = everything that could
  // still be real. Built from matchOrders, not buildAttackFilters, because a
  // .json can arrive mid-session without a re-analysis.
  var ORD_FILTERS = [
    { key: "small", label: "Ataque pequeño", icon: true },
    { key: "medium", label: "Ataque mediano", icon: true },
    { key: "large", label: "Ataque grande", icon: true },
    { key: "multi", label: "Más de 2 unidades",
      title: "Más de 2 unidades en total según el .json: no puede ser el fake típico de 1 espía + 1 ariete/catapulta" },
    { key: "unknown", label: "Tropas desconocidas",
      title: "Sin orden emparejada en el .json: las tropas del comando se desconocen" },
  ];
  function ordUnitTotal(c) {
    var n = 0;
    for (var u in c.units) n += c.units[u] || 0;
    return n;
  }
  function ordFilterHit(a, want) {
    if (want === "unknown") return !a.order;
    if (!a.order) return false;
    if (want === "multi") return ordUnitTotal(a.order) > 2;
    return a.order.size === want;
  }
  function buildOrdersFilters() {
    var box = $("fOrders");
    if (!box) return;   // nothing analysed yet — the filter grid doesn't exist
    if (!state.orders || state.mode !== "attacks" || !state.rows.length) {
      box.innerHTML = ""; box.hidden = true; return;
    }
    var counts = {};
    state.rows.forEach(function (r) {
      ORD_FILTERS.forEach(function (d) {
        if (ordFilterHit(r.attack, d.key)) counts[d.key] = (counts[d.key] || 0) + 1;
      });
    });
    var boxes = ORD_FILTERS.filter(function (d) { return counts[d.key]; })
      .map(function (d) {
        var ic = d.icon
          ? '<img class="ord-ic ord-size" src="../icons/units/attack_' + d.key + '.webp" alt=""> '
          : "";
        return '<label class="fflag"' + (d.title ? ' title="' + TW.esc(d.title) + '"' : "") +
          '><input type="checkbox" class="fOrd" value="' + d.key + '"> ' + ic +
          TW.esc(d.label) + " (" + counts[d.key] + ")</label>";
      }).join(" ");
    box.innerHTML = boxes ? '<span class="fflags-h">Filtros de órdenes:</span> ' + boxes : "";
    box.hidden = !boxes;
  }

  // === your attacked villages: Blindado / Esquivar =========================
  // Judged from the dump's own "Defensor:" row, decoded against the world's
  // unit order. Troop COUNTS drive the thresholds (that is how players think
  // about "30k de defensa"), but off-vs-def village shape is judged by farm
  // POPULATION, since a heavy cavalry is 6 pop and an axe is 1 — counts alone
  // would call a 5k-heavy village "small".
  function gradeTarget(t, opts) {
    t.defTroops = null; t.offTroops = null; t.status = null;
    if (!t.def || !state.cfg) return;
    var units = state.cfg.units;
    if (t.def.length !== units.length) return;   // can't trust the decode

    var defN = 0, offN = 0, defPop = 0, offPop = 0;
    for (var i = 0; i < units.length; i++) {
      var n = t.def[i] || 0, u = units[i];
      if (u.role === "def") { defN += n; defPop += n * u.pop; }
      else if (u.role === "off") { offN += n; offPop += n * u.pop; }
    }
    t.defTroops = defN; t.offTroops = offN;
    t.defPop = defPop; t.offPop = offPop;
    t.isOffensive = offPop > defPop;

    if (defN >= opts.blindado) t.status = "blindado";
    else if (defN < opts.esquivar || t.isOffensive) t.status = "esquivar";
    else t.status = "media";   // between the two bars — say so, don't stay silent
  }

  var STATUS_TEXT = {
    blindado: function (t, opts) {
      return "Blindado (" + TW.commas(t.defTroops) + " tropas def. ≥ " + TW.commas(opts.blindado) + ")";
    },
    esquivar: function (t, opts) {
      if (t.defTroops < opts.esquivar) {
        return "Esquivar (" + (t.defTroops ? "solo " + TW.commas(t.defTroops) + " tropas def."
                                           : "sin defensa") + ")";
      }
      return "Esquivar (pueblo ofensivo: " + TW.commas(t.offTroops) + " tropas of. vs " +
        TW.commas(t.defTroops) + " def.)";
    },
    media: function (t) {
      return "Defensa media (" + TW.commas(t.defTroops) + " tropas def.)";
    },
  };

  // === data ================================================================
  function indexData(villages, conquers) {
    var i, v;
    for (i = 0; i < villages.length; i++) {
      v = villages[i];
      if (v.x == null) continue;
      state.byCoord[v.x + "|" + v.y] = v;
    }
    for (i = 0; i < conquers.length; i++) {
      var c = conquers[i], id = c.village.id;
      var prev = state.lastConquer[id];
      if (!prev || c.t > prev.t) {
        state.lastConquer[id] = { t: c.t, oldOwner: c.oldOwner, newOwner: c.newOwner };
      }
      // Fallback locator: a village missing from villages.json (data lag or
      // deleted) still resolves to an id via its last conquest record.
      if (c.village.x != null && !state.byCoord[c.village.x + "|" + c.village.y]) {
        state.byCoord[c.village.x + "|" + c.village.y] = {
          id: id, name: c.village.name, x: c.village.x, y: c.village.y,
          points: null, owner: c.newOwner, _stale: true,
        };
      }
    }
  }

  // Shared reports DB — degrades gracefully: an unreachable Worker only
  // costs the report badges, never the page.
  function loadReportsDb() {
    return TW.apiFetch(REPORTS_DB_PATH).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (db) {
      if (db && db.villages && db.ids) {
        state.reports = db.villages;
        state.reportsMeta = {
          villages: Object.keys(db.villages).length,
          reports: Object.keys(db.ids).length,
          updated: db.updated || null,
        };
      }
    }).catch(function (e) {
      state.reports = null;
      if (window.console) console.warn("Entrantes: sin BD de informes:", e.message);
    });
  }

  // Verdict for a coord from the reports DB, or null (the DB is the ONLY
  // source since 2026-08-03 — the hand-made notes file was retired). Ownership-checked
  // against the CURRENT owner in villages.json: intel observed under a previous
  // owner comes back as {stale:true} — rendered as an explicit "old owner" tag,
  // never as a verdict, never feeding the flags.
  // Sections observed BEFORE the village's last conquest belong to the
  // previous owner — everything resets, so they are dropped from verdicts,
  // badge age, hover card and flags alike. riStale catches "the NEWEST report
  // is from the old owner"; this catches the mixed case: newest report is
  // current-owner but an older section (say, a `sent` from 22 days ago)
  // predates the conquest. Returns null when nothing current-era remains;
  // `maxT` = newest kept observation (drives the inline badge age).
  function reportFactsOf(coord) {
    var v = state.reports && state.reports[coord];
    if (!v) return null;
    var cv = state.byCoord[coord];
    var conqT = (cv && state.lastConquer[cv.id]) ? state.lastConquer[cv.id].t * 1000 : 0;
    var out = null;
    ["home", "away", "bld", "sent", "sentBig", "sentCat", "dead", "alive"].forEach(function (k) {
      if (v[k] && (+v[k].t || 0) >= conqT) {
        if (!out) out = { lastT: v.lastT, id: v.id, name: v.name, playerId: v.playerId, playerName: v.playerName, maxT: 0 };
        out[k] = v[k];
        if ((+v[k].t || 0) > out.maxT) out.maxT = +v[k].t || 0;
      }
    });
    return out;
  }

  function reportTypeOf(coord) {
    if (!state.reports || typeof riClassify !== "function") return null;
    var v = state.reports[coord];
    if (!v) return null;
    var cv = state.byCoord[coord];
    if (cv && cv.owner && cv.owner.id != null && riStale(v, cv.owner.id)) {
      return { stale: true, t: v.lastT || 0, oldOwner: v.playerName || "" };
    }
    var fv = reportFactsOf(coord);
    if (!fv) return null; // everything predates the last conquest
    var verdict = riClassify(fv);
    if (verdict.cls === "off" || verdict.cls === "def" || verdict.cls === "mixed" || verdict.cls === "empty") {
      return { type: verdict.cls === "mixed" ? "MIXED" : verdict.cls.toUpperCase(), sure: verdict.sure, t: fv.maxT || v.lastT || 0 };
    }
    return null;
  }

  function reportAgeTxt(t) {
    return (t && typeof riAge === "function") ? riAge(Date.now(), t) : "";
  }

  // === report hover card ===================================================
  // Rich hover card for the 📄 badges — the same sections the tribe-calculator
  // shows when hovering a village on its map (js/map.js reportTooltipHtml):
  // verdict + age, troops seen in the village / outside / biggest off sent
  // (power lines + unit chips) and the five spied building levels. This IS the
  // report rendered: the DB keeps the newest observation per section, so the
  // card shows everything that survives of the underlying reports.
  // Power maths mirror the calculator's constants.js / data-load.js — RC_
  // prefix because this file's own OFF_UNITS/DEF_UNITS are pop-shape maps.
  var RC_UNITS = ["spear", "sword", "axe", "spy", "light", "heavy", "ram", "catapult", "knight", "snob"];
  var RC_ATT  = { spear: 10, sword: 25, axe: 40, spy: 35, light: 130, heavy: 150, ram: 2,  catapult: 100, knight: 150, snob: 30 };
  var RC_DINF = { spear: 15, sword: 50, axe: 10, spy: 2,  light: 30,  heavy: 200, ram: 20, catapult: 100, knight: 250, snob: 100 };
  var RC_DCAV = { spear: 45, sword: 25, axe: 10, spy: 1,  light: 40,  heavy: 80,  ram: 50, catapult: 50,  knight: 400, snob: 100 };
  var RC_OFF_POOL = ["axe", "light", "ram", "catapult", "snob"];
  var RC_DEF_POOL = ["spear", "sword", "heavy", "knight"];
  var RC_CLS = { OFF: "#e06040", DEF: "#6f9fe0", MIXED: "#b08fd0", EMPTY: "#999" };
  var RC_BLD = [["main", "headquarters", "Edificio Principal"], ["snob", "academy", "Academia"],
                ["smith", "smithy", "Herrería"], ["farm", "farm", "Granja"], ["wall", "wall", "Muralla"]];

  function rcIc(k) { return '<img class="rc-ic" src="../icons/units/' + k + '.png" alt="">'; }
  function rcRow(k, v) { return '<div class="rc-row"><span class="rc-k">' + k + '</span><span class="rc-v">' + v + "</span></div>"; }
  function rcAgeTag(t) { return ' <span class="rc-age">· ' + reportAgeTxt(t) + "</span>"; }

  // One troop block: Off/Def power lines (zero lines dropped) + unit chips.
  function rcBlock(title, units) {
    var offP = 0, defP = 0;
    RC_OFF_POOL.forEach(function (u) { offP += (units[u] || 0) * RC_ATT[u]; });
    RC_DEF_POOL.forEach(function (u) { defP += (units[u] || 0) * (RC_DINF[u] + RC_DCAV[u]); });
    var h = '<div class="rc-sec"><div class="rc-h">' + title + "</div>";
    if (offP > 0) h += rcRow(rcIc("off") + " Pod. Off", TW.commas(offP));
    if (defP > 0) h += rcRow(rcIc("def") + " Pod. Def", TW.commas(defP));
    var chips = RC_UNITS.filter(function (u) { return (units[u] || 0) > 0; }).map(function (u) {
      return '<span class="rc-unit" title="' + (UNIT_ES[u] || u) + '">' + rcIc(u) + TW.commas(units[u]) + "</span>";
    });
    if (chips.length) h += '<div class="rc-units">' + chips.join("") + "</div>";
    return h + "</div>";
  }

  function reportCardHtml(coord) {
    // Conquest-filtered view: only current-era sections render (a pre-conquest
    // `sent` or scout must not show under the new owner).
    var v = reportFactsOf(coord);
    var rt = reportTypeOf(coord);
    if (!rt) return "";
    if (!v && !rt.stale) return "";

    var head, sub;
    if (rt.stale) {
      head = '<span class="rc-old">⌛ ANTIGUO — cambió de dueño</span>';
      sub = "El pueblo cambió de dueño después del último informe" +
        (rt.oldOwner ? " (era de " + TW.esc(rt.oldOwner) + ")" : "") + " — sin datos del dueño actual";
    } else {
      head = '<span style="color:' + (RC_CLS[rt.type] || "#999") + ';font-weight:700;">' +
        (rt.type === "EMPTY" ? "—" : rt.type) + (rt.sure ? "" : "?") + "</span>";
      sub = "Tipo según la BD de informes compartida · informe de hace " + reportAgeTxt(rt.t) +
        (rt.sure ? "" : " · tropas fuera nunca vistas: podría ser OFF con el ejército de viaje");
    }
    var h = '<div class="rc-head">📄 Informe · ' + head + rcAgeTag(rt.t) + "</div>" +
      '<div class="rc-sub">' + sub + "</div>";

    // Ownership-stale intel: everything resets on a conquest, so the old
    // owner's troop sections are irrelevant — the card stops at the ⌛
    // header + old-owner note (user's call, 2026-08-03).
    if (rt.stale) return h;

    // Troops seen in the village — a spied empty garrison is a fact, not absence.
    if (v.home) {
      var hasUnits = RC_UNITS.some(function (u) { return (v.home.units[u] || 0) > 0; });
      if (hasUnits) {
        h += rcBlock("En la aldea" + rcAgeTag(v.home.t), v.home.units);
      } else {
        h += '<div class="rc-sec"><div class="rc-h">En la aldea' + rcAgeTag(v.home.t) +
          '</div><div class="rc-none">sin unidades vistas</div></div>';
      }
    } else if (v.away) {
      h += '<div class="rc-sec">' + rcRow("En la aldea", '<span class="rc-unk">no vistas</span>') + "</div>";
    }

    // Units outside: seen / confirmed-empty (spy data, no away table) / never seen.
    if (v.away && !v.away.empty) {
      h += rcBlock("Unidades fuera" + rcAgeTag(v.away.t), v.away.units);
    } else if (v.away && v.away.empty) {
      h += '<div class="rc-sec">' + rcRow("Unidades fuera", '<span class="rc-empty">nada fuera (espiado)</span>') + "</div>";
    } else if (v.home) {
      h += '<div class="rc-sec">' + rcRow("Unidades fuera", '<span class="rc-unk">no vistas</span>') + "</div>";
    }

    // Biggest army sent regardless of type (sentBig; the old largest-off `sent`
    // is the fallback for records merged before 2026-08-06), + the CATAS line
    // when the village has qualifying catapult strikes on record.
    var sentShow = v.sentBig || v.sent;
    if (sentShow) h += rcBlock("Mayor ejército enviado" + rcAgeTag(sentShow.t), sentShow.units);
    if (v.sentCat) {
      h += '<div class="rc-sec">' + rcRow("Catapultas",
        '<span class="rc-catas">💥 suele enviar catas — máx ' + v.sentCat.cat +
        " (" + v.sentCat.n + "×)" + rcAgeTag(v.sentCat.t) + "</span>") + "</div>";
    }

    // 💀 dead troops — only while no newer living-troops observation exists.
    if (v.dead && (!v.alive || v.dead.t >= v.alive.t)) {
      h += '<div class="rc-sec">' + rcRow("Tropas",
        '<span class="rc-dead">💀 muertas ' + (v.dead.kind === "def"
          ? "(arrasado defendiendo)" : "(ejército aniquilado atacando)") +
        rcAgeTag(v.dead.t) + "</span>") + "</div>";
    }

    // Always all five spied buildings — 0 = unbuilt/destroyed (muted).
    if (v.bld) {
      h += '<div class="rc-sec"><div class="rc-h">Edificios' + rcAgeTag(v.bld.t) + '</div><div class="rc-units">' +
        RC_BLD.map(function (b) {
          var lv = v.bld.levels[b[0]] || 0;
          return '<span class="rc-unit" title="' + b[2] + '"><img class="rc-ic" src="../icons/buildings/' + b[1] + '.webp" alt="">' +
            "<span" + (lv ? "" : ' class="rc-lv0"') + ">" + lv + "</span></span>";
        }).join("") + "</div></div>";
    }
    return h;
  }

  // === full-report modal (click on a 📄 badge) =============================
  // The shared FULL-report store (db-full.json — newest raw report per
  // village) is heavier than the facts DB, so it is fetched lazily on the
  // first click and cached for the session. Rendered by report-render.js.
  var REPORTS_FULL_PATH = "/reports-full?world=es103"; // via TW.apiFetch too
  var fullDbP = null;
  function loadFullDb() {
    if (!fullDbP) {
      fullDbP = TW.apiFetch(REPORTS_FULL_PATH).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (db) { return (db && db.villages) ? db.villages : {}; })
        .catch(function () { fullDbP = null; return null; }); // retry next click
    }
    return fullDbP;
  }

  function closeReportModal() {
    var bg = $("reportModalBg");
    if (bg) bg.parentNode.removeChild(bg);
  }
  function openReportModal(coord) {
    rcHide();
    closeReportModal();
    var bg = document.createElement("div");
    bg.id = "reportModalBg";
    bg.className = "twrr-modal-bg";
    bg.innerHTML = '<div class="twrr-modal"><div class="twrr-modal-title"><span>📄 Informes de ' +
      TW.esc(coord) + '</span><button type="button" class="twrr-modal-close" id="reportModalClose">✕</button></div>' +
      '<div id="reportModalBody" class="tz-note">Cargando informe…</div></div>';
    bg.addEventListener("click", function (e) { if (e.target === bg) closeReportModal(); });
    document.body.appendChild(bg);
    $("reportModalClose").addEventListener("click", closeReportModal);
    loadFullDb().then(function (villages) {
      var body = $("reportModalBody");
      if (!body) return; // modal already closed
      if (!villages) { body.textContent = "No se pudo cargar la BD de informes completos."; return; }
      var v = villages[coord];
      if (!v || (!v.rep && !v.sentRep) || typeof TWRR === "undefined") {
        body.textContent = "Sin informe completo guardado para este pueblo.";
        return;
      }
      // STRICTLY current-owner reports (the stores keep intel across
      // conquests — `sentRep` especially holds the largest attack EVER
      // sent). Everything resets on a conquest, so a past owner's report is
      // irrelevant here and is DROPPED, not banner-marked (user's call,
      // 2026-08-03). Same rule as riStale, applied per record to the owner
      // this village had in it: rep = defender side, sentRep = attacker side.
      var cv = state.byCoord[coord];
      var curId = (cv && cv.owner && cv.owner.id != null) ? String(cv.owner.id) : null;
      var fresh = function (pid) { return curId == null || pid == null || String(pid) === curId; };
      var rep = (v.rep && fresh(v.rep.defenderPlayerId)) ? v.rep : null;
      var sentRep = (v.sentRep && fresh(v.sentRep.attackerPlayerId)) ? v.sentRep : null;
      var h = "";
      if (rep) {
        h += '<div class="twrr-srchead">Último informe sobre este pueblo:</div>' + TWRR.reportHtml(rep);
      }
      if (sentRep && !(rep && sentRep.reportId === rep.reportId)) {
        h += '<div class="twrr-srchead">Mayor ataque enviado por este pueblo:</div>' + TWRR.reportHtml(sentRep);
      }
      if (!h) {
        body.textContent = "Sin informe del dueño actual — el pueblo cambió de dueño y todo se resetea.";
        return;
      }
      body.className = "";
      body.innerHTML = h;
    });
  }

  // One floating card, repositioned per badge; pointer-events:none in CSS so
  // it can never trap the cursor (hover off the badge = card gone).
  var rcEl = null;
  function rcHide() { if (rcEl) rcEl.style.display = "none"; }
  function rcShowFor(badge) {
    var html = reportCardHtml(badge.getAttribute("data-rc"));
    if (!html) return;
    if (!rcEl) {
      rcEl = document.createElement("div");
      rcEl.id = "reportCard";
      rcEl.className = "report-card";
      document.body.appendChild(rcEl);
    }
    rcEl.innerHTML = html;
    rcEl.style.display = "block";
    // Below the badge, clamped to the viewport's right edge.
    var r = badge.getBoundingClientRect();
    var sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
    var x = r.left + sx, y = r.bottom + sy + 6;
    var vw = document.documentElement.clientWidth || 0;
    var w = rcEl.offsetWidth || 0;
    if (vw && x + w + 8 > sx + vw) x = Math.max(8, sx + vw - w - 8);
    rcEl.style.left = x + "px";
    rcEl.style.top = y + "px";
  }

  function loadXML(name) {
    return fetch(WORLD_DATA + name).then(function (r) {
      if (!r.ok) throw new Error(name + ": HTTP " + r.status);
      return r.text();
    }).then(function (txt) {
      return new DOMParser().parseFromString(txt, "text/xml");
    });
  }

  function loadAll() {
    // The world config is optional: without it the troop-class and train
    // features degrade to "—" rather than taking the whole page down.
    var cfgP = Promise.all([loadXML("get_config.xml"), loadXML("get_unit_info.xml")])
      .then(function (x) {
        state.cfg = parseWorldConfig(x[0], x[1]);
        // Feed the measured per-unit speeds to the report renderer (its
        // built-in defaults are the same values on es103).
        if (typeof TWRR !== "undefined" && state.cfg && state.cfg.units) {
          var mpf = {};
          state.cfg.units.forEach(function (u) { mpf[u.key] = u.minPerField; });
          TWRR.setSpeeds(mpf);
        }
      })
      .catch(function (e) {
        state.cfg = null;
        if (window.console) console.warn("Entrantes: sin configuración del mundo:", e.message);
      });

    // Bonus villages: villages.json drops the bonus_id column, but the raw
    // village.txt in the calculators' mirrored world data keeps it
    // (id,name,x,y,player,points,bonus_id). Best-effort — without it only
    // the bonus icons are missing.
    var bonusP = fetch(WORLD_DATA + "village.txt").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (txt) {
      txt.split("\n").forEach(function (line) {
        var p = line.split(",");
        if (p.length >= 7 && BONUS_META[+p[6]]) state.bonus[+p[2] + "|" + +p[3]] = +p[6];
      });
    }).catch(function (e) {
      if (window.console) console.warn("Entrantes: sin village.txt (iconos de bonificación):", e.message);
    });

    state.ready = Promise.all([
      TW.loadJSON("villages.json"),
      TW.loadJSON("conquers.json"),
      cfgP,
      loadReportsDb(),
      bonusP,
    ]).then(function (res) {
      indexData(res[0], res[1]);
      $("status").textContent = "Listo. Pega las coordenadas (o tus entrantes) y pulsa «Analizar»." +
        (state.reportsMeta ? " · BD de informes: " + state.reportsMeta.villages + " pueblos." : "");
    }).catch(function (e) {
      $("status").textContent = "No se pudieron cargar los datos: " + e.message +
        "  (¿sirviendo por HTTP? file:// bloquea fetch)";
      throw e;
    });
    return state.ready;
  }

  // === analysis ============================================================
  // `refT` is the instant the conquest is judged against: the attack's sent
  // time in attack mode, "now" in coord mode.
  function analyzeVillage(coord, refT, opts, range) {
    var v = state.byCoord[coord.key];
    if (range) refT = Math.round((range.min + range.max) / 2);
    var row = { coord: coord, village: v || null, flags: [], unknown: !v, refT: refT, range: range || null };
    if (!v) return row;

    row.conquer = state.lastConquer[v.id] || null;

    // Resolved only through the conquest log → no current points to judge.
    // Must not read as "OK": it's a partial answer, so it gets its own flag.
    if (v.points == null) {
      row.flags.push({ cls: "stale", text: "Sin puntos actuales (no está en los datos del mundo)" });
    } else if (v.points < opts.minPoints) {
      row.flags.push({
        cls: "low",
        text: "Pocos puntos (" + TW.commas(v.points) + " < " + TW.commas(opts.minPoints) + ")",
      });
    }

    if (row.conquer && opts.maxDays > 0) {
      var win = opts.maxDays * 86400;
      function verdict(t) {
        var age = t - row.conquer.t;
        return age < 0 ? "after" : (age < win ? "new" : "old");
      }
      if (range) {
        // The sent time is only bracketed, so the two ends can disagree. Say
        // "posible" when they do rather than picking an end and sounding sure.
        var vMin = verdict(range.min), vMax = verdict(range.max);
        if (vMin === vMax && vMin === "new") {
          row.flags.push({ cls: "new", text: "Conquistado poco antes del envío (estimado por distancia)" });
        } else if (vMin === vMax && vMin === "after") {
          row.flags.push({ cls: "after", text: "Conquistado tras el envío (estimado por distancia)" });
        } else if (vMin !== "old" || vMax !== "old") {
          row.flags.push({ cls: "maybe", text: "Posiblemente conquistado poco antes del envío (envío solo estimado)" });
        }
      } else {
        var age = refT - row.conquer.t;
        if (age < 0) {
          // Conquered after this attack left: the troops in the air belong to
          // the previous owner. Not the same as "recently taken".
          row.flags.push({ cls: "after", text: "Conquistado tras el envío (" + TW.dur(-age) + " después)" });
        } else if (age < win) {
          row.flags.push({
            cls: "new",
            text: state.mode === "attacks"
              ? "Conquistado " + TW.dur(age) + " antes del envío"
              : "Conquistado hace " + TW.dur(age),
          });
        }
      }
    }
    return row;
  }

  // === render: table =======================================================
  function conquerCell(row) {
    if (!row.village) return "";
    if (!row.conquer) return '<span class="barb">Nunca (desde el inicio del mundo)</span>';
    var c = row.conquer;
    // Uses the analysis-time reference so the relative age can never disagree
    // with the flag computed from it (a later re-render must not drift).
    var rel = state.mode === "attacks"
      ? (row.refT >= c.t ? TW.dur(row.refT - c.t) + " antes del envío"
                         : TW.dur(c.t - row.refT) + " después del envío")
      : TW.relTime(c.t, row.refT);
    return '<span class="conq-when">' + TW.fmtDateTime(c.t) + "</span>" +
      ' <span class="conq-ago">(' + rel + ")</span>" +
      '<br><span class="conq-who">' + TW.ownerCell(c.oldOwner) + " → " + TW.ownerCell(c.newOwner) + "</span>";
  }

  function verdictCell(row) {
    var out = [];
    if (row.unknown) out.push("<span class='flag flag-unknown'>Desconocido</span>");
    row.flags.forEach(function (f) {
      out.push("<span class='flag flag-" + f.cls + "'>" + TW.esc(f.text) + "</span>");
    });
    if (!out.length) out.push("<span class='flag flag-ok'>Sin señales</span>");
    return out.join(" ");
  }

  function speedCell(a) {
    if (!a.speed) {
      return a.minPerField
        ? '<span class="barb" title="' + a.minPerField.toFixed(2) + ' min/campo">?</span>'
        : '<span class="barb">—</span>';
    }
    // A class taken from the label is an assumption, not a measurement — it is
    // marked so it can't be read as "the travel time proves this".
    var assumed = a.speedFromTag;
    return "<span class='flag flag-" + (a.speed.isNoble ? "noble" : "type") +
      (assumed ? " flag-assumed" : "") + "' title='" +
      (assumed ? "Según la etiqueta del comando, no medido (" + a.minPerField.toFixed(2) + " min/campo)"
               : a.minPerField.toFixed(2) + " min/campo") + "'>" +
      TW.esc(a.speed.label) + (assumed ? " (etiq.)" : "") + "</span>";
  }

  function villageCellOf(row) {
    var html;
    if (row.village) html = TW.villageCell(row.village);
    else html = '<span class="coord">' + row.coord.key + '</span> <span class="cont">' +
      TW.continent(row.coord.x, row.coord.y) + "</span>";
    // Bonus village: icon right after the name/coord, before the report badges.
    var bId = state.bonus[row.coord.key];
    if (bId && BONUS_META[bId]) {
      html += ' <img class="bonus-ic" src="../icons/buildings/' + BONUS_META[bId].icon +
        '.webp" alt="' + BONUS_META[bId].icon + '" title="' + TW.esc(BONUS_META[bId].title) + '">';
    }
    var rt = reportTypeOf(row.coord.key);
    if (rt) {
      var ageTxt = reportAgeTxt(rt.t);
      // No title attr — the hover card (reportCardHtml) carries those texts.
      if (rt.stale) {
        html += " <span class='note-badge note-old' data-rc='" + row.coord.key +
          "'>📄⌛" + (ageTxt ? " " + ageTxt : "") + "</span>";
      } else {
        html += " <span class='note-badge note-" + rt.type.toLowerCase() +
          (rt.sure ? "" : " note-unsure") + "' data-rc='" + row.coord.key + "'>📄" +
          TW.esc(rt.type) + (rt.sure ? "" : "?") + (ageTxt ? " · " + ageTxt : "") + "</span>";
      }
    }
    // CATAS tag (2026-08-06): the village has qualifying catapult strikes on
    // record (≥50 cats without a regular ram off — see sentCat in the reports
    // DB). Independent of the OFF/DEF verdict — a village can carry both
    // badges. Ownership-stale intel never tags (rt.stale covers the newest-
    // report check; reportFactsOf already applies the conquest cutoff).
    if (!(rt && rt.stale)) {
      var fvC = reportFactsOf(row.coord.key);
      if (fvC && fvC.sentCat) {
        html += " <span class='note-badge note-catas' data-rc='" + row.coord.key + "'>💥CATAS · " +
          reportAgeTxt(fvC.sentCat.t) + "</span>";
      }
    }
    if (row.attack && row.attack.dupTotal > 1) {
      html += " <span class='as-badge' title='Ataques desde este mismo pueblo'>AS " +
        row.attack.dupIndex + "/" + row.attack.dupTotal + "</span>";
    }
    return html;
  }
  function pointsCellOf(row) {
    if (!row.village) return "—";
    return row.village.points != null ? TW.commas(row.village.points) : "?";
  }

  // Column definitions drive both the header (with sort affordances) and the
  // sort comparators, so the two can't drift apart.
  var HEADS = {
    coords: [
      { label: "#", cls: "col-rank" },
      { label: "Pueblo", key: "coord" },
      { label: "Puntos", cls: "col-pts", key: "points" },
      { label: "Dueño", key: "owner" },
      { label: "Última conquista", key: "conquest" },
      { label: "Aviso", cls: "col-verdict", key: "verdict" },
    ],
    attacks: [
      { label: "#", cls: "col-rank" },
      { label: "Origen del ataque", key: "coord" },
      { label: "Puntos", cls: "col-pts", key: "points" },
      { label: "Dueño", key: "owner" },
      { label: "Tropa", key: "speed" },
      { label: "Objetivo", key: "target" },
      { label: "Envío / Llegada", cls: "col-date", key: "arrival", title: "Ordenar por hora de llegada" },
      { label: "Última conquista", key: "conquest" },
      { label: "Aviso", cls: "col-verdict", key: "verdict" },
    ],
  };

  // Each comparator returns [hasValue, value] so missing data always sinks to
  // the bottom, in both directions, instead of clumping at whichever end.
  // Not every flag is a warning. "Blindado" is reassurance — it must not redden
  // the row, count as "marcado", or survive the «Solo marcados» filter.
  var ALERT_FLAGS = {
    low: 1, "new": 1, after: 1, maybe: 1, stale: 1, nosent: 1, esquivar: 1, nuke: 1, notedef: 1, catas: 1, dead: 1,
  };
  function isAlert(r) {
    if (r.unknown) return true;
    for (var i = 0; i < r.flags.length; i++) if (ALERT_FLAGS[r.flags[i].cls]) return true;
    return false;
  }

  var SEVERITY = {
    nuke: 8, esquivar: 7, dead: 6.9, catas: 6.8, notedef: 6.5, after: 6, "new": 5, maybe: 4, low: 3,
    nosent: 2, stale: 2, unknown: 1, media: 0.5, blindado: 0,
  };
  var SORTERS = {
    coord: function (r) { return [1, r.coord.x * 1000 + r.coord.y]; },
    points: function (r) {
      var p = r.village && r.village.points;
      return p == null ? [0, 0] : [1, p];
    },
    owner: function (r) {
      var o = r.village && r.village.owner;
      return o && o.name ? [1, o.name.toLowerCase()] : [0, ""];
    },
    speed: function (r) {
      var mpf = r.attack && r.attack.minPerField;
      return mpf ? [1, mpf] : [0, 0];
    },
    target: function (r) {
      var t = r.attack && r.attack.target;
      return t ? [1, t.x * 1000 + t.y] : [0, 0];
    },
    arrival: function (r) { return r.attack ? [1, r.attack.arrival * 1000 + r.attack.arrivalMs] : [0, 0]; },
    conquest: function (r) { return r.conquer ? [1, r.conquer.t] : [0, 0]; },
    verdict: function (r) {
      var best = r.unknown ? SEVERITY.unknown : 0;
      r.flags.forEach(function (f) { best = Math.max(best, SEVERITY[f.cls] || 0); });
      return [1, best];
    },
  };

  function sortRows(rows) {
    var s = state.sort;
    if (!s || !s.key || !SORTERS[s.key]) return rows;
    var fn = SORTERS[s.key], dir = s.dir === "desc" ? -1 : 1;
    // decorate-sort-undecorate keeps the original order as a stable tiebreak
    return rows.map(function (r, i) { return { r: r, i: i, k: fn(r) }; })
      .sort(function (a, b) {
        if (a.k[0] !== b.k[0]) return b.k[0] - a.k[0];          // missing last, always
        if (a.k[1] < b.k[1]) return -1 * dir;
        if (a.k[1] > b.k[1]) return 1 * dir;
        return a.i - b.i;
      })
      .map(function (x) { return x.r; });
  }

  // Grouping is applied AFTER sorting: rows keep their sorted order, and each
  // target's block appears at the position of its first (best-sorted) row.
  function groupRows(rows) {
    var order = [], buckets = {};
    rows.forEach(function (r) {
      var k = r.attack && r.attack.target ? r.attack.target.key : "";
      if (!buckets[k]) { buckets[k] = []; order.push(k); }
      buckets[k].push(r);
    });
    var out = [];
    order.forEach(function (k) { out = out.concat(buckets[k]); });
    return out;
  }

  function renderHead() {
    var defs = HEADS[state.mode], s = state.sort || {};
    $("head").innerHTML = "<tr>" + defs.map(function (d) {
      if (!d.key) return "<th class='" + (d.cls || "") + "'>" + d.label + "</th>";
      var on = s.key === d.key;
      var arrow = on ? (s.dir === "desc" ? " ▼" : " ▲") : "";
      return "<th class='" + (d.cls || "") + " sortable" + (on ? " sorted" : "") +
        "' data-sort='" + d.key + "' title='" + TW.esc(d.title || ("Ordenar por " + d.label)) +
        "'>" + d.label + "<span class='sort-arrow'>" + arrow + "</span></th>";
    }).join("") + "</tr>";

    var ths = $("head").querySelectorAll("th.sortable");
    for (var i = 0; i < ths.length; i++) {
      ths[i].addEventListener("click", function () {
        var key = this.getAttribute("data-sort");
        if (state.sort && state.sort.key === key) {
          state.sort = { key: key, dir: state.sort.dir === "asc" ? "desc" : "asc" };
        } else {
          // Points, conquest recency and severity read best biggest-first;
          // coords, owners and arrival times read best smallest-first.
          var descFirst = { points: 1, conquest: 1, verdict: 1 };
          state.sort = { key: key, dir: descFirst[key] ? "desc" : "asc" };
        }
        render();
      });
    }
  }

  function passesFilters(r) {
    if ($("onlyflagged").checked && !isAlert(r)) return false;
    if (state.mode !== "attacks") return true;
    var f = state.filters, a = r.attack;
    // «Filtros de aviso»: when any flag classes are checked, keep only rows
    // carrying at least one of them (OR semantics; `unknown` is its own class).
    if (f.flags && f.flags.length) {
      var has = false;
      for (var i = 0; i < f.flags.length && !has; i++) {
        var want = f.flags[i];
        if (want === "unknown" && r.unknown) has = true;
        else has = r.flags.some(function (fl) { return fl.cls === want; });
      }
      if (!has) return false;
    }
    // «Filtros de órdenes»: same OR semantics over what the matched .json said
    // — the game's size icon, >2-unit armies, or rows with no matched order.
    if (f.ords && f.ords.length) {
      var hasOrd = false;
      for (var j = 0; j < f.ords.length && !hasOrd; j++) hasOrd = ordFilterHit(a, f.ords[j]);
      if (!hasOrd) return false;
    }
    if (f.player && a.player !== f.player) return false;
    if (f.type && (a.speed ? a.speed.label : "?") !== f.type) return false;
    if (f.origin && a.origin.key !== f.origin) return false;
    if (f.dest && (!a.target || a.target.key !== f.dest)) return false;
    if (f.from != null && a.arrival < f.from) return false;
    if (f.to != null && a.arrival > f.to) return false;
    return true;
  }

  function render() {
    var grouped = state.mode === "attacks" && $("groupbytarget").checked;
    var shown = sortRows(state.rows.filter(passesFilters));
    if (grouped) shown = groupRows(shown);
    var cols = HEADS[state.mode].length;
    renderHead();

    var html = "", n = 0, lastTarget = null;
    for (var i = 0; i < shown.length; i++) {
      var r = shown[i];
      var cls = (n % 2 ? "r2" : "r1") + (isAlert(r) ? " row-flagged" : "") + (r.unknown ? " row-unknown" : "");
      n++;

      if (grouped) {
        var tKey = r.attack.target ? r.attack.target.key : null;
        if (tKey !== lastTarget) {
          lastTarget = tKey;
          // Resolve the target through the world data so it links to its village
          // page like every other village reference on the site.
          var tv = tKey ? state.byCoord[tKey] : null;
          var label;
          if (tv) label = TW.villageCell(tv);
          else if (tKey) label = "<b>" + tKey + "</b> <span class='cont'>" +
            TW.continent(r.attack.target.x, r.attack.target.y) + "</span>";
          else label = "<span class='barb'>(sin cabecera de pueblo)</span>";
          html += "<tr class='group-row'><td colspan='" + cols + "'>Objetivo: " + label + "</td></tr>";
        }
      }

      var targetCell = "";
      if (state.mode === "attacks") {
        var tg = r.attack.target;
        var tgv = tg ? state.byCoord[tg.key] : null;
        targetCell = "<td>" + (tgv ? TW.villageCell(tgv)
          : tg ? TW.esc(tg.key) : "<span class='barb'>—</span>") + "</td>";
      }

      var timeCell = "";
      if (state.mode === "attacks") {
        var tr = r.attack.train
          ? " <span class='flag flag-" + (r.attack.train.noble ? "noble" : "train") + "'>Tren ×" +
            r.attack.train.size + (r.attack.train.noble ? " ¡nobles!" : "") + "</span>"
          : "";
        // Arrival is shown to the second (plus ms): seconds are what you time a
        // snipe or a dodge against, and dropping them would also make two
        // commands in the same minute look out of order once sorted.
        // A derived sent time is marked "≈" and says what it came from, so it
        // is never mistaken for one the dump actually stated.
        var src = r.attack.sentSource;
        var DERIVED_FROM = {
          duration: "la duración", "return": "la hora de regreso",
          "unit-tag": "la etiqueta «" + TW.esc(String(r.attack.label).trim()) + "» y la distancia",
        };
        var sentTxt;
        if (src === "explicit") {
          sentTxt = TW.fmtDateTime(r.attack.sent);
        } else if (src === "range") {
          // Bracketed, not guessed: slowest unit … fastest unit.
          sentTxt = "<span class='derived' title='Sin datos de tiempo ni unidad etiquetada: " +
            "rango entre la unidad más lenta y la más rápida a " + r.attack.distance.toFixed(1) +
            " campos'>≈ " + TW.fmtDateTime(r.attack.sentMin) + " … " +
            TW.fmtDateTime(r.attack.sentMax) + "</span>";
        } else if (r.attack.sent != null) {
          sentTxt = "<span class='derived' title='Deducido de " + DERIVED_FROM[src] + "'>≈ " +
            TW.fmtDateTime(r.attack.sent) + "</span>";
        } else {
          sentTxt = "<span class='barb' title='La línea no trae envío, duración ni regreso, " +
            "y no hay objetivo para medir la distancia'>envío desconocido</span>";
        }
        timeCell = "<td class='col-date'>" + sentTxt +
          "<br><span class='conq-ago'>→ " + TW.fmtTime(r.attack.arrival) +
          "." + String(r.attack.arrivalMs).padStart(3, "0") + "</span>" + tr + "</td>";
      }

      html += "<tr class='" + cls + "'>" +
        "<td class='col-rank'>" + n + ".</td>" +
        "<td>" + villageCellOf(r) + "</td>" +
        "<td class='col-pts'>" + pointsCellOf(r) + "</td>" +
        "<td>" + (r.village ? TW.ownerCell(r.village.owner) : "<span class='barb'>—</span>") + "</td>" +
        (state.mode === "attacks"
          ? "<td>" + speedCell(r.attack) +
            (r.attack.order ? "<br>" + ordersCellHtml(r.attack.order) : "") + "</td>"
          : "") +
        targetCell + timeCell +
        "<td class='col-conq'>" + conquerCell(r) + "</td>" +
        "<td class='col-verdict'>" + verdictCell(r) + "</td></tr>";
    }

    $("rows").innerHTML = html ||
      "<tr class='r1'><td colspan='" + cols + "' class='status'>Sin resultados.</td></tr>";
    $("tableWrap").hidden = false;
    updateShowing(shown.length);
  }

  function updateShowing(shownCount) {
    var el = $("showing");
    if (!el) return;
    el.textContent = shownCount === state.rows.length
      ? ""
      : " · mostrando " + shownCount + " de " + state.rows.length;
  }

  // === render: panels ======================================================
  function countBy(list, keyFn) {
    var m = {};
    list.forEach(function (x) { var k = keyFn(x); if (k != null) m[k] = (m[k] || 0) + 1; });
    return m;
  }
  function sortedEntries(obj) {
    return Object.keys(obj).map(function (k) { return [k, obj[k]]; })
      .sort(function (a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0])); });
  }

  // Attacker names are resolved to real profile links through players.json when
  // possible (the dump carries no player ids).
  function playerLinkByName(name) {
    var p = state.playersByName && state.playersByName[name];
    return p ? TW.playerLink(p.id, name) : TW.esc(name);
  }

  function buildTotals(attacks) {
    var players = sortedEntries(countBy(attacks, function (a) { return a.player; }));
    var origins = sortedEntries(countBy(attacks, function (a) { return a.origin.key; }));
    var dests = sortedEntries(countBy(attacks, function (a) { return a.target ? a.target.key : null; }));
    var types = sortedEntries(countBy(attacks, function (a) { return a.speed ? a.speed.label : "?"; }));

    var playersHtml = players.map(function (e) {
      return '<span class="player-chip">' + playerLinkByName(e[0]) + " <b>(" + e[1] + ")</b></span>";
    }).join(" ");

    var typesHtml = types.map(function (e) {
      var pct = (100 * e[1] / attacks.length).toFixed(1);
      var isNoble = /Noble/.test(e[0]);
      return "<tr><td><span class='flag flag-" + (isNoble ? "noble" : "type") + "'>" +
        TW.esc(e[0]) + "</span></td><td class='col-pts'>" + e[1] + "/" + attacks.length +
        "</td><td class='col-pts'>" + pct + "%</td></tr>";
    }).join("");

    $("totals").innerHTML =
      '<table class="vis widget"><tbody>' +
      "<tr class='r1'><td><b>Ataques totales</b></td><td>" + TW.commas(attacks.length) + "</td></tr>" +
      "<tr class='r2'><td><b>Jugadores atacantes (" + players.length + ")</b></td><td>" + playersHtml + "</td></tr>" +
      "<tr class='r1'><td><b>Pueblos objetivo (" + dests.length + ")</b></td><td><textarea class='coord-dump' readonly rows='2'>" +
      dests.map(function (e) { return e[0]; }).join(" ") + "</textarea></td></tr>" +
      "<tr class='r2'><td><b>Pueblos de origen (" + origins.length + ")</b></td><td><textarea class='coord-dump' readonly rows='2'>" +
      origins.map(function (e) { return e[0]; }).join(" ") + "</textarea></td></tr>" +
      "<tr class='r1'><td><b>Tipo de tropa</b><br><span class='conq-ago'>deducido de duración ÷ distancia</span></td><td>" +
      (state.cfg ? "<table class='vis inner'><tbody>" + typesHtml + "</tbody></table>"
                 : "<span class='barb'>sin configuración del mundo</span>") +
      "</td></tr></tbody></table>";
  }

  // Arrivals bucketed by day+hour, exactly like RedAlert's "OP Spotter": a wave
  // shows up as a spike. Rendered by quickchart.io (the page's only external
  // dependency — if it fails to load the table below still carries the numbers).
  function buildOpSpotter(attacks) {
    var buckets = {};
    attacks.forEach(function (a) {
      var p = TW.fmtDateTime(a.arrival);            // "YYYY-MM-DD HH:MM"
      var k = p.slice(8, 10) + "/" + p.slice(5, 7) + " " + p.slice(11, 13) + "H";
      buckets[k] = (buckets[k] || 0) + 1;
    });
    var keys = Object.keys(buckets).sort(function (a, b) {
      function ord(s) { return s.slice(3, 5) + s.slice(0, 2) + s.slice(6, 8); }
      return ord(a).localeCompare(ord(b));
    });
    var vals = keys.map(function (k) { return buckets[k]; });

    var chart = {
      type: "bar",
      data: { labels: keys, datasets: [{ label: "Llegadas por hora", data: vals }] },
    };
    var src = "https://quickchart.io/chart?bkg=white&w=500&h=300&c=" +
      encodeURIComponent(JSON.stringify(chart));

    var rows = keys.map(function (k, i) {
      return "<tr class='" + (i % 2 ? "r2" : "r1") + "'><td>" + k +
        "</td><td class='col-pts'>" + vals[i] + "</td></tr>";
    }).join("");

    $("opSpotter").innerHTML =
      '<img class="op-chart" alt="Llegadas por hora" src="' + src + '" ' +
      'onerror="this.style.display=\'none\';var n=document.getElementById(\'opChartNote\');if(n)n.hidden=false;">' +
      '<p class="tz-note" id="opChartNote" hidden>Gráfico no disponible (sin conexión a quickchart.io). La tabla tiene los mismos datos.</p>' +
      '<div class="table-wrap op-table"><table class="vis widget"><thead><tr><th>Llegada</th>' +
      "<th class='col-pts'>Ataques</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function buildCombos(attacks) {
    function tbl(title, entries, linkify) {
      var rows = entries.map(function (e, i) {
        var v = state.byCoord[e[0]];
        var cell = linkify && v ? TW.villageCell(v) : TW.esc(e[0]);
        return "<tr class='" + (i % 2 ? "r2" : "r1") + "'><td>" + cell +
          "</td><td class='col-pts'>" + e[1] + "</td></tr>";
      }).join("");
      return '<div class="table-wrap"><table class="vis widget"><thead><tr><th>' + title +
        "</th><th class='col-pts'>Ataques</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
    }
    var origins = sortedEntries(countBy(attacks, function (a) { return a.origin.key; }));
    var dests = sortedEntries(countBy(attacks, function (a) { return a.target ? a.target.key : null; }));
    $("combos").innerHTML =
      tbl("Pueblo de origen (" + origins.length + ")", origins, true) +
      tbl("Pueblo objetivo (" + dests.length + ")", dests, true);
  }

  // Wall / loyalty / troops come from the dump itself — a SNAPSHOT as of export,
  // not live. The troop column order is the world's own unit order
  // (get_unit_info.xml); if the count doesn't line up the raw row is shown.
  function buildOwnVillages(attacks) {
    var counts = countBy(attacks, function (a) { return a.target ? a.target.key : null; });
    var keys = Object.keys(state.targets).sort(function (a, b) {
      return (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b);
    });
    if (!keys.length) { $("ownVillages").innerHTML = ""; $("panelOwn").hidden = true; return; }
    $("panelOwn").hidden = false;

    var units = state.cfg ? state.cfg.units : [];
    var anyDef = keys.some(function (k) { return state.targets[k].def; });
    var mismatch = keys.some(function (k) {
      var d = state.targets[k].def;
      return d && units.length && d.length !== units.length;
    });

    var head = "<tr><th>Pueblo</th><th class='col-pts'>Puntos</th><th class='col-pts'>Ataques</th>" +
      "<th>Estado</th><th class='col-pts' title='Lanza + Espada + Arquero + CP'>Def.</th>" +
      "<th class='col-pts' title='Hacha + CL + Arq. caballo + Ariete + Catapulta'>Of.</th>" +
      "<th class='col-pts'>Muralla</th><th class='col-pts'>Lealtad</th>" +
      (anyDef && units.length && !mismatch
        ? units.map(function (u) { return "<th class='col-pts' title='" + TW.esc(u.name) + "'>" +
            TW.esc(u.name) + "</th>"; }).join("")
        : (anyDef ? "<th>Defensor (sin descodificar)</th>" : "")) + "</tr>";

    var body = keys.map(function (k, i) {
      var t = state.targets[k], v = state.byCoord[k];
      var defCells;
      if (!anyDef) defCells = "";
      else if (units.length && !mismatch) {
        defCells = units.map(function (u, ui) {
          var n = t.def ? t.def[ui] : null;
          return "<td class='col-pts" + (n ? "" : " zero") + "'>" + (n != null ? TW.commas(n) : "—") + "</td>";
        }).join("");
      } else {
        defCells = "<td>" + (t.def ? t.def.join(" ") : "—") + "</td>";
      }
      var estado = t.status
        ? "<span class='flag flag-" + t.status + "'>" +
          ({ blindado: "Blindado", esquivar: "Esquivar", media: "Defensa media" }[t.status]) + "</span>" +
          (t.status === "esquivar" && t.isOffensive ? " <span class='conq-ago'>ofensivo</span>" : "")
        : (t.defTroops == null ? "<span class='barb'>—</span>" : "<span class='flag flag-ok'>—</span>");

      return "<tr class='" + (i % 2 ? "r2" : "r1") + "'>" +
        "<td>" + (v ? TW.villageCell(v) : TW.esc(k)) + "</td>" +
        "<td class='col-pts'>" + (v && v.points != null ? TW.commas(v.points) : "—") + "</td>" +
        "<td class='col-pts'>" + (counts[k] || 0) + "</td>" +
        "<td>" + estado + "</td>" +
        "<td class='col-pts'>" + (t.defTroops != null ? TW.commas(t.defTroops) : "—") + "</td>" +
        "<td class='col-pts'>" + (t.offTroops != null ? TW.commas(t.offTroops) : "—") + "</td>" +
        "<td class='col-pts'>" + (t.wall != null ? t.wall : "—") + "</td>" +
        "<td class='col-pts'>" + (t.loyalty != null ? t.loyalty : "—") + "</td>" +
        defCells + "</tr>";
    }).join("");

    $("ownVillages").innerHTML =
      '<p class="tz-note">Muralla, lealtad y tropas salen del propio volcado: son una <b>instantánea del momento en que lo exportaste</b>, no datos en vivo.' +
      (mismatch ? " El número de columnas de tropa no coincide con las unidades del mundo, así que se muestra la fila en bruto." : "") +
      '</p><div class="table-wrap"><table class="vis widget own-villages"><thead>' + head +
      "</thead><tbody>" + body + "</tbody></table></div>";
  }

  function buildAttackFilters(attacks) {
    function opts(entries, fmt) {
      return '<option value="">Todos</option>' + entries.map(function (e) {
        return '<option value="' + TW.esc(e[0]) + '">' + TW.esc(fmt ? fmt(e[0]) : e[0]) +
          " (" + e[1] + ")</option>";
      }).join("");
    }
    var players = sortedEntries(countBy(attacks, function (a) { return a.player; }));
    var types = sortedEntries(countBy(attacks, function (a) { return a.speed ? a.speed.label : "?"; }));
    var origins = sortedEntries(countBy(attacks, function (a) { return a.origin.key; }));
    var dests = sortedEntries(countBy(attacks, function (a) { return a.target ? a.target.key : null; }));

    var arrivals = attacks.map(function (a) { return a.arrival; }).sort(function (p, q) { return p - q; });
    // Second-resolution prefill (2026-08-21 fix): arrivals carry seconds, so a
    // minute-truncated "hasta" silently dropped anything arriving after :00 in
    // the final minute — the latest row vanished on every «Aplicar filtros».
    var from = TW.fmtTime(arrivals[0]), to = TW.fmtTime(arrivals[arrivals.length - 1]);

    // «Filtros de aviso» (2026-08-06): filter rows by the flag classes they
    // raised — one checkbox per class PRESENT in the current rows (with its
    // count), multi-select, OR-combined: keep rows carrying ANY checked flag.
    // Built from state.rows (flags live on rows, not attacks); `unknown` rows
    // carry no flag object, so they get a pseudo-class of their own.
    var flagCounts = {};
    state.rows.forEach(function (r) {
      var seen = {};
      r.flags.forEach(function (f) { seen[f.cls] = 1; });
      if (r.unknown) seen.unknown = 1;
      Object.keys(seen).forEach(function (c) { flagCounts[c] = (flagCounts[c] || 0) + 1; });
    });
    var FLAG_LABELS = {
      nuke: "Posible nuke/tren real", esquivar: "Esquivar", dead: "Tropas muertas (💀)", catas: "Catas (💥)",
      notedef: "Fake probable (pueblo DEF/vacío)", after: "Conquistado tras el envío",
      "new": "Conquista reciente", maybe: "Posible conquista reciente", low: "Pocos puntos",
      nosent: "Sin hora de envío", stale: "Sin puntos actuales", unknown: "Desconocido",
      media: "Defensa media", blindado: "Blindado",
    };
    var flagBoxes = Object.keys(flagCounts)
      .sort(function (a, b) { return (SEVERITY[b] || 0) - (SEVERITY[a] || 0); })
      .map(function (c) {
        return '<label class="fflag"><input type="checkbox" class="fFlag" value="' + c + '"> ' +
          TW.esc(FLAG_LABELS[c] || c) + " (" + flagCounts[c] + ")</label>";
      }).join(" ");

    $("attackFilters").innerHTML =
      '<div class="filter-grid">' +
      '<div class="f"><label for="fPlayer">Jugador</label><select id="fPlayer">' + opts(players) + "</select></div>" +
      '<div class="f"><label for="fType">Tropa</label><select id="fType">' + opts(types) + "</select></div>" +
      '<div class="f"><label for="fOrigin">Pueblo de origen</label><select id="fOrigin">' + opts(origins) + "</select></div>" +
      '<div class="f"><label for="fDest">Pueblo objetivo</label><select id="fDest">' + opts(dests) + "</select></div>" +
      '<div class="f"><label for="fFrom">Llegada desde</label><input type="text" id="fFrom" value="' + from + '"></div>' +
      '<div class="f"><label for="fTo">Llegada hasta</label><input type="text" id="fTo" value="' + to + '"></div>' +
      "</div>" +
      (flagBoxes ? '<div class="fflags"><span class="fflags-h">Filtros de aviso:</span> ' + flagBoxes + "</div>" : "") +
      // Filled by buildOrdersFilters (via matchOrders) once a .json de órdenes
      // is loaded — a fresh analysis rebuilds the grid, so the placeholder must
      // always exist here even when no file is loaded yet.
      '<div class="fflags" id="fOrders" hidden></div>' +
      '<div class="filter-actions"><button type="button" id="fApply">Aplicar filtros</button>' +
      '<button type="button" id="fReset">Quitar filtros</button></div>';

    function checkedVals(sel) {
      var out = [];
      var boxes = document.querySelectorAll(sel);
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) out.push(boxes[i].value);
      return out;
    }
    $("fApply").addEventListener("click", function () {
      state.filters = {
        player: $("fPlayer").value, type: $("fType").value,
        origin: $("fOrigin").value, dest: $("fDest").value,
        from: parseDateTime($("fFrom").value), to: parseDateTime($("fTo").value),
        flags: checkedVals(".fFlag"), ords: checkedVals(".fOrd"),
      };
      render();
    });
    $("fReset").addEventListener("click", function () {
      ["fPlayer", "fType", "fOrigin", "fDest"].forEach(function (id) { $(id).value = ""; });
      $("fFrom").value = from; $("fTo").value = to;
      var boxes = document.querySelectorAll(".fFlag, .fOrd");
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
      state.filters = {};
      render();
    });
  }

  // "YYYY-MM-DD HH:MM[:SS]" in server time → unix seconds (null if unparseable).
  function parseDateTime(s) {
    var m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(s || "");
    if (!m) return null;
    return TW.srvEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
  }

  // === summary / warnings ==================================================
  function summarize() {
    var total = state.rows.length, flagged = 0, unknown = 0;
    var n = { low: 0, "new": 0, after: 0, maybe: 0, stale: 0, nosent: 0, blindado: 0, esquivar: 0, media: 0, nuke: 0, notedef: 0, catas: 0, dead: 0 };
    for (var i = 0; i < total; i++) {
      var r = state.rows[i];
      if (r.unknown) { unknown++; continue; }
      if (isAlert(r)) flagged++;
      for (var j = 0; j < r.flags.length; j++) {
        if (n[r.flags[j].cls] != null) n[r.flags[j].cls]++;
      }
    }
    var parts;
    if (state.mode === "attacks") {
      var targets = {}, origins = {};
      state.rows.forEach(function (r) {
        if (r.attack.target) targets[r.attack.target.key] = 1;
        origins[r.coord.key] = 1;
      });
      parts = [total + " ataque" + (total === 1 ? "" : "s"),
        Object.keys(targets).length + " objetivo" + (Object.keys(targets).length === 1 ? "" : "s"),
        Object.keys(origins).length + " pueblo" + (Object.keys(origins).length === 1 ? "" : "s") + " de origen",
        flagged + " marcado" + (flagged === 1 ? "" : "s")];
    } else {
      parts = [total + " coordenada" + (total === 1 ? "" : "s"),
        flagged + " marcada" + (flagged === 1 ? "" : "s")];
    }
    if (n.low) parts.push(n.low + " con pocos puntos");
    if (n.new) parts.push(n.new + " conquistad" + (state.mode === "attacks" ? "o" : "a") +
      (n.new === 1 ? "" : "s") + " hace poco");
    if (n.after) parts.push(n.after + " conquistad" + (state.mode === "attacks" ? "o" : "a") +
      (n.after === 1 ? "" : "s") + " tras el envío");
    if (n.notedef) parts.push(n.notedef + " desde pueblo DEF/vacío");
    if (n.dead) parts.push(n.dead + " con tropas muertas");
    if (n.catas) parts.push(n.catas + " de lanzadores de catas");
    if (n.nuke) parts.push(n.nuke + " posible" + (n.nuke === 1 ? "" : "s") + " real" + (n.nuke === 1 ? "" : "es"));
    if (n.esquivar) parts.push(n.esquivar + " a esquivar");
    if (n.blindado) parts.push(n.blindado + " sobre pueblo blindado");
    if (n.stale) parts.push(n.stale + " sin puntos actuales");
    if (unknown) parts.push(unknown + " sin datos");
    var el = $("summary");
    el.innerHTML = TW.esc(parts.join(" · ")) + '<span id="showing"></span>';
    el.hidden = false;
  }

  function buildWarnings(attacks, parsed) {
    var warns = [];

    // Be explicit about which sent times were stated vs reconstructed, and
    // never let a dropped line pass unmentioned.
    function bySource(s) {
      return attacks.filter(function (a) { return a.sentSource === s; }).length;
    }
    var derived = bySource("duration") + bySource("return");
    var tagged = bySource("unit-tag");
    var ranged = bySource("range");
    var noSent = attacks.filter(function (a) {
      return a.sent == null && a.sentMin == null;
    }).length;
    if (derived) {
      warns.push(derived + " hora" + (derived === 1 ? "" : "s") + " de envío deducida" +
        (derived === 1 ? "" : "s") + " de la duración/regreso (marcadas con ≈)");
    }
    if (tagged) {
      warns.push(tagged + " hora" + (tagged === 1 ? "" : "s") + " de envío calculada" +
        (tagged === 1 ? "" : "s") + " con la unidad de la etiqueta y la distancia " +
        "(depende de que la etiqueta sea correcta)");
    }
    if (ranged) {
      warns.push("⚠ " + ranged + " ataque" + (ranged === 1 ? "" : "s") +
        " sin tiempos ni unidad etiquetada: envío acotado entre la unidad más lenta y la más rápida");
    }
    if (noSent) {
      warns.push("⚠ " + noSent + " ataque" + (noSent === 1 ? "" : "s") +
        " sin envío, duración ni regreso: su conquista se compara con AHORA");
    }
    if (parsed && parsed.skipped.length) {
      warns.push("⚠ " + parsed.skipped.length + " línea" + (parsed.skipped.length === 1 ? "" : "s") +
        " de ataque ilegible" + (parsed.skipped.length === 1 ? "" : "s") +
        " (sin coordenada u hora de llegada)");
    }
    if (parsed && parsed.inconsistent) {
      warns.push("⚠ " + parsed.inconsistent + " ataque" + (parsed.inconsistent === 1 ? "" : "s") +
        " con envío + duración que no cuadran con la llegada");
    }
    var trains = {};
    attacks.forEach(function (a) { if (a.train && a.train.noble) trains[a.train.id] = a.train.size; });
    var nTrains = Object.keys(trains).length;
    if (nTrains) {
      warns.push("⚠ " + nTrains + " posible" + (nTrains === 1 ? "" : "s") + " tren" +
        (nTrains === 1 ? "" : "es") + " de nobles (llegadas espaciadas " +
        (state.cfg ? state.cfg.attackGap : 100) + " ms, a velocidad de noble y dentro del alcance)");
    }
    var untagged = attacks.filter(function (a) { return /^(ataque|attack)$/i.test((a.label || "").trim()); }).length;
    if (untagged) warns.push(untagged + " ataque" + (untagged === 1 ? "" : "s") + " sin etiquetar");
    if (!state.cfg) {
      // Trains still work (attack_gap defaults to the near-universal 100 ms) but
      // without unit speeds none of them can be confirmed as noble trains.
      warns.push("No se pudo cargar la configuración del mundo: sin tipo de tropa; " +
        "los trenes se detectan con el valor por defecto de 100 ms y no pueden confirmarse como nobles");
    }
    var el = $("warnLine");
    el.innerHTML = warns.length ? warns.map(TW.esc).join(" · ") : "";
    el.hidden = !warns.length;
  }

  // === wiring ==============================================================
  function readOpts() {
    function num(id, dflt) {
      var v = parseFloat($(id).value);
      return (isFinite(v) && v >= 0) ? v : dflt;
    }
    var opts = {
      minPoints: num("minpoints", 0), maxDays: num("maxdays", 0),
      blindado: num("blindado", 30000), esquivar: num("esquivar", 2000),
    };
    try {
      localStorage.setItem(LS_POINTS, String(opts.minPoints));
      localStorage.setItem(LS_DAYS, String(opts.maxDays));
      localStorage.setItem(LS_BLINDADO, String(opts.blindado));
      localStorage.setItem(LS_ESQUIVAR, String(opts.esquivar));
    } catch (e) { /* private mode */ }
    return opts;
  }

  function fail(msg) {
    $("status").textContent = msg;
    $("status").style.display = "";
    $("summary").hidden = true;
    $("modeNote").hidden = true;
    $("warnLine").hidden = true;
    $("panels").hidden = true;
    $("tableWrap").hidden = true;
  }

  // An exception used to escape the click handler and leave the page looking
  // like the button did nothing. Anything that goes wrong must SAY so.
  function reportError(e) {
    if (window.console) console.error("Entrantes:", e);
    var stale = typeof TW.srvEpoch !== "function" || typeof TW.apiFetch !== "function";
    $("status").textContent = stale
      ? "Tu navegador está usando una versión antigua de js/common.js en caché. " +
        "Recarga con Ctrl+F5 (o Cmd+Shift+R) y vuelve a intentarlo."
      : "Algo falló al analizar: " + (e && e.message ? e.message : e) +
        "  (detalles en la consola del navegador)";
    $("status").style.display = "";
    $("summary").hidden = true;
    $("modeNote").hidden = true;
    $("panels").hidden = true;
    $("tableWrap").hidden = true;
  }

  function analyze() {
    try { analyzeInner(); } catch (e) { reportError(e); }
  }

  function analyzeInner() {
    var text = $("coords").value;
    var parsed = isAttackDump(text) ? parseAttacks(text) : null;
    var coords = parsed ? null : parseCoords(text);

    if (parsed && !parsed.attacks.length) {
      return fail("Se detectaron órdenes de ataque pero no se pudo leer ninguna. " +
        "¿Es el texto completo de la pantalla de entrantes?");
    }
    if (coords && !coords.length) {
      return fail("No se han encontrado coordenadas válidas (formato 500|600).");
    }

    var modeChanged = state.mode !== (parsed ? "attacks" : "coords");
    state.mode = parsed ? "attacks" : "coords";
    state.filters = {};
    // Default: earliest arrival first — what lands next is what you act on.
    // A sort the user picked survives a re-analysis within the same mode.
    if (modeChanged || !state.sort) {
      state.sort = state.mode === "attacks" ? { key: "arrival", dir: "asc" } : { key: null };
    }
    var opts = readOpts();
    $("status").textContent = "Analizando…";
    $("status").style.display = "";

    state.ready.then(function () {
      // Errors thrown in here would otherwise be swallowed by the .catch below.
      try { finish(); } catch (e) { reportError(e); }
    }).catch(function () { /* status already shows the load error */ });

    function finish() {
      var now = Math.floor(Date.now() / 1000);
      if (parsed) {
        state.targets = parsed.targets;
        Object.keys(state.targets).forEach(function (k) { gradeTarget(state.targets[k], opts); });
        var attacks = enrichAttacks(parsed.attacks);
        state.rows = attacks.map(function (a) {
          // No sent time and nothing to derive it from → the conquest test
          // falls back to NOW, which is a weaker answer, so the row says so
          // rather than looking identical to a launch-time verdict.
          var range = (a.sent == null && a.sentMin != null) ? { min: a.sentMin, max: a.sentMax } : null;
          var row = analyzeVillage(a.origin, a.sent != null ? a.sent : now, opts, range);
          row.attack = a;
          if (a.sent == null && !range && !row.unknown) {
            row.flags.push({ cls: "nosent", text: "Sin hora de envío — comparado con ahora" });
          }
          // A plausible REAL hit: heavy/slow troop class (rams, cats or a
          // noble), the attacker shows no fake indicator, and your village
          // isn't armoured enough to shrug it off. Suppressed when the origin
          // already looks like a fake — the two readings would contradict.
          // Only SURE report verdicts drive the flags — a "DEF?" (away troops
          // never seen) or stale (owner changed) intel must not call a
          // possible nuke a probable fake.
          var rt = reportTypeOf(a.origin.key);
          var originNote = (rt && !rt.stale && rt.sure) ? rt.type : null;
          // CATAS (2026-08-06): the origin has qualifying catapult strikes on
          // record (sentCat: ≥50 cats, no regular ram off) AND this command
          // travels at a pace that could carry them (siege/noble speed; an
          // unknown speed can't rule them out). Direct observed evidence, so
          // it doesn't require a `sure` verdict.
          var fvA = (rt && rt.stale) ? null : reportFactsOf(a.origin.key);
          var catInfo = (fvA && fvA.sentCat && (!a.speed || a.speed.isHeavy)) ? fvA.sentCat : null;
          if (catInfo) {
            row.flags.push({
              cls: "catas",
              text: "💥 Suele enviar catas: máx " + catInfo.cat + " (" + catInfo.n +
                "×, informe de hace " + reportAgeTxt(catInfo.t) + ")",
            });
          }
          // 💀 Tropas muertas (2026-08-18): the newest battle evidence says
          // this village's troops are DEAD — defending (everything at home
          // wiped and a clean spy run saw nothing outside) or attacking (its
          // whole real army annihilated; a dead 1-ram fake never qualifies —
          // the merge applies the pop floor). Any NEWER living-troops
          // observation retracts it; facts stay pure, the comparison is here.
          var deadInfo = (fvA && fvA.dead && (!fvA.alive || fvA.dead.t >= fvA.alive.t)) ? fvA.dead : null;
          if (deadInfo) {
            row.flags.push({
              cls: "dead",
              text: "💀 Tropas muertas " + (deadInfo.kind === "def"
                ? "(arrasado defendiendo)" : "(su ejército aniquilado atacando)") +
                " — hace " + reportAgeTxt(deadInfo.t),
            });
          }
          // notedef is SUPPRESSED by catas: "fake probable" and "known cata
          // striker" contradict — a def village's slow command with a cata
          // record is a building strike, not a fake (the user's whole point).
          if (!catInfo && (originNote === "DEF" || originNote === "EMPTY") && a.speed && a.speed.isHeavy) {
            row.flags.push({
              cls: "notedef",
              text: "Fake probable: pueblo " + (originNote === "EMPTY" ? "vacío" : "DEF") +
                " enviando tropa lenta (informe de hace " + reportAgeTxt(rt.t) + ")",
            });
          }
          // Dead troops count as a fake signal: a village whose army just
          // died can't be sending the real thing (suppresses the nuke flag).
          var looksFake = row.flags.some(function (f) {
            return f.cls === "low" || f.cls === "new" || f.cls === "notedef" || f.cls === "dead";
          });
          var heavy = a.speed && a.speed.isHeavy;
          var armoured = a.target && a.target.status === "blindado";
          // A cata striker that is NOT off-confirmed reads as a cata strike, not
          // a nuke — the catas flag replaces the nuke one there. An OFF-confirmed
          // village keeps both readings (it genuinely might be either).
          if (heavy && !looksFake && !armoured && !(catInfo && originNote !== "OFF")) {
            row.flags.push({
              cls: "nuke",
              text: "⚠ Posible " + (a.speed.isNoble ? "tren de nobles" : "nuke") + " real" +
                (originNote === "OFF" ? " — pueblo OFF confirmado (informe de hace " + reportAgeTxt(rt.t) + ")" : "") +
                (a.speedFromTag ? " (tropa según etiqueta)" : ""),
            });
          }

          // Verdict about YOUR village, not the attacker: worth carrying onto
          // every incoming, because "dodge" or "ignore" is decided per command.
          if (a.target && a.target.status) {
            row.flags.push({
              cls: a.target.status,
              text: STATUS_TEXT[a.target.status](a.target, opts),
            });
          }
          return row;
        });
      } else {
        state.targets = {};
        state.rows = coords.map(function (c) { return analyzeVillage(c, now, opts); });
      }

      $("status").style.display = "none";
      $("modeNote").textContent = state.mode === "attacks"
        ? "Modo órdenes de ataque: cada conquista se compara con la hora de ENVÍO de su ataque."
        : "Modo lista de coordenadas: cada conquista se compara con AHORA.";
      $("modeNote").hidden = false;

      if (state.mode === "attacks") {
        var all = state.rows.map(function (r) { return r.attack; });
        buildTotals(all);
        buildOpSpotter(all);
        buildCombos(all);
        buildOwnVillages(all);
        buildAttackFilters(all);
        buildWarnings(all, parsed);
        $("panels").hidden = false;
      } else {
        $("panels").hidden = true;
        $("warnLine").hidden = true;
      }

      matchOrders();
      summarize();
      render();
    }
  }

  function init() {
    TW.renderNav("entrantes");

    // This page needs a common.js new enough to have TW.srvEpoch AND
    // TW.apiFetch. The ?v=20260826.1 on the script tags should guarantee that, but a
    // proxy or an odd cache can still pair a new incomings.js with an old
    // common.js — fail loudly, not silently.
    if (typeof TW.srvEpoch !== "function" || typeof TW.apiFetch !== "function") {
      $("status").textContent = "Tu navegador está usando una versión antigua de " +
        "js/common.js en caché. Recarga con Ctrl+F5 (o Cmd+Shift+R).";
      $("analyze").disabled = true;
      return;
    }

    try {
      [[LS_POINTS, "minpoints"], [LS_DAYS, "maxdays"],
       [LS_BLINDADO, "blindado"], [LS_ESQUIVAR, "esquivar"]].forEach(function (pair) {
        var v = localStorage.getItem(pair[0]);
        if (v !== null) $(pair[1]).value = v;
      });
    } catch (e) { /* private mode */ }

    TW.loadJSON("meta.json").then(function (m) {
      $("worldName").textContent = m.world || TW.WORLD;
      $("metaLine").textContent = TW.commas(m.villageCount) + " pueblos · " +
        TW.commas(m.conquers) + " ennoblecimientos archivados · datos obtenidos " +
        TW.fmtTime(m.pulledUnix);
    }).catch(function () { $("metaLine").textContent = ""; });

    // Attacker names → profile links (the dump carries no player ids).
    state.playersByName = {};
    TW.loadJSON("players.json").then(function (list) {
      list.forEach(function (p) { if (p.name) state.playersByName[p.name] = p; });
    }).catch(function () { /* links degrade to plain text */ });

    loadAll();

    $("analyze").addEventListener("click", analyze);
    $("clear").addEventListener("click", function () {
      $("coords").value = "";
      state.rows = []; state.targets = {}; state.filters = {};
      $("summary").hidden = true;
      $("modeNote").hidden = true;
      $("warnLine").hidden = true;
      $("panels").hidden = true;
      $("tableWrap").hidden = true;
      $("status").style.display = "";
      $("status").textContent = "Pega las coordenadas (o tus entrantes) y pulsa «Analizar».";
      matchOrders();   // a loaded .json survives Limpiar — back to "se emparejarán"
      $("coords").focus();
    });
    // «.json Órdenes» — optional incoming_orders*.json upload. The file never
    // leaves the browser; parse errors report themselves in the note line.
    $("ordersBtn").addEventListener("click", function () { $("ordersFile").click(); });
    $("ordersFile").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";   // re-choosing the same file must fire change again
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          state.orders = parseOrders(JSON.parse(reader.result));
          state.orders.file = f.name;
          matchOrders();
          if (state.rows.length) render();
        } catch (e) {
          // A bad file must not wipe a good one already loaded — report and keep.
          var el = $("ordersNote");
          el.textContent = "No se pudo leer el .json de órdenes: " + (e && e.message ? e.message : e);
          el.hidden = false;
        }
      };
      reader.onerror = function () {
        var el = $("ordersNote");
        el.textContent = "No se pudo leer el archivo .json de órdenes.";
        el.hidden = false;
      };
      reader.readAsText(f);
    });
    $("onlyflagged").addEventListener("change", function () {
      if (state.rows.length) render();
    });
    $("groupbytarget").addEventListener("change", function () {
      if (state.rows.length) render();
    });
    // Re-run on setting change so the thresholds feel live once analysed.
    $("minpoints").addEventListener("change", function () { if (state.rows.length) analyze(); });
    $("maxdays").addEventListener("change", function () { if (state.rows.length) analyze(); });
    $("blindado").addEventListener("change", function () { if (state.rows.length) analyze(); });
    $("esquivar").addEventListener("change", function () { if (state.rows.length) analyze(); });
    // Ctrl/Cmd+Enter in the textarea = Analizar.
    $("coords").addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); analyze(); }
    });
    // 📄 badge hover → report card (delegated: rows re-render on every analyze).
    document.addEventListener("mouseover", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".note-badge[data-rc]") : null;
      if (b) rcShowFor(b); else rcHide();
    });
    // 📄 badge click → full report modal (lazy-fetches db-full.json once).
    document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".note-badge[data-rc]") : null;
      if (b) openReportModal(b.getAttribute("data-rc"));
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeReportModal();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
