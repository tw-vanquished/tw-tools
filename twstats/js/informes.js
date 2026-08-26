/* twstats · Subir Informes — uploads tw-reports-*.json exports to the shared
   enemy-reports DB (tw-calc-uploads Worker). Entrantes and the calculator READ
   that DB (📄OFF/DEF badges, fake checker, Enemy Villages tab, map overlay);
   this page only writes to it and shows its current size/freshness.
   Moved out of incomings.js on 2026-08-03 (own nav tab). */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }

  // Worker endpoints, fetched via TW.apiFetch (hostname failover).
  var REPORTS_DB_PATH = "/reports?world=es103";
  var UPLOAD_PATH = "/";
  var TURNSTILE_SITEKEY = "0x4AAAAAADvKZN-ZLjRH8UQe";

  // Current DB stats line — informational only; a Worker outage degrades to a
  // note, uploads can still be attempted.
  function loadDbStats() {
    TW.apiFetch(REPORTS_DB_PATH).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (db) {
      if (!db || !db.villages || !db.ids) throw new Error("respuesta inesperada");
      var when = db.updated && typeof riAge === "function"
        ? " · actualizada hace " + riAge(Date.now(), Date.parse(db.updated)) : "";
      $("dbLine").textContent = "BD compartida: " + Object.keys(db.villages).length +
        " pueblos · " + Object.keys(db.ids).length + " informes" + when + ".";
    }).catch(function (e) {
      $("dbLine").textContent = "BD compartida no disponible ahora mismo (" + e.message + ").";
    });
  }

  // Turnstile: invisible execute-on-demand widget in a FIXED container on
  // <body> (a hidden/zero-size container makes the check's telemetry read
  // all-zeros and the server reject it in a retry loop). Injected on first use.
  var repGuardId = null, repGuardReady = false, repGuardPending = null, repGuardInit = null;
  function repInitGuard() {
    if (repGuardInit) return repGuardInit;
    repGuardInit = new Promise(function (resolve) {
      var host = document.createElement("div");
      host.id = "rep-guard";
      host.style.cssText = "position:fixed;bottom:0;right:0;z-index:2147483647;";
      document.body.appendChild(host);
      var s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = function () {
        try {
          repGuardId = window.turnstile.render("#rep-guard", {
            sitekey: TURNSTILE_SITEKEY,
            execution: "execute", appearance: "interaction-only", retry: "never",
            callback: function (tok) { if (repGuardPending) { var r = repGuardPending; repGuardPending = null; r(tok); } },
            "error-callback": function () { if (repGuardPending) { var r = repGuardPending; repGuardPending = null; r(null); } },
          });
          repGuardReady = true;
        } catch (e) { /* widget failed — upload stays off */ }
        resolve(repGuardReady);
      };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
    return repGuardInit;
  }
  function repGuardToken() {
    return repInitGuard().then(function (ok) {
      if (!ok) return null;
      return new Promise(function (resolve) {
        repGuardPending = resolve;
        try { window.turnstile.reset(repGuardId); } catch (e) {}
        try { window.turnstile.execute("#rep-guard"); } catch (e) { repGuardPending = null; resolve(null); return; }
        setTimeout(function () { if (repGuardPending) { var r = repGuardPending; repGuardPending = null; r(null); } }, 20000);
      });
    });
  }

  // Read + parse the chosen files AND the pasted JSON (2026-08-06) into one
  // record array (shared by Subir/Ver). Returns null only when NEITHER source
  // has anything — a paste alone is a full-fledged input, like the calculator's.
  function readChosen() {
    var input = $("repFiles");
    var files = input && input.files ? [].slice.call(input.files) : [];
    var pasted = ($("repPaste") && $("repPaste").value.trim()) || "";
    if (!files.length && !pasted) return Promise.resolve(null);
    return Promise.all(files.map(function (f) { return f.text(); })).then(function (texts) {
      var all = [];
      if (pasted) texts = texts.concat([pasted]);
      texts.forEach(function (t) {
        try { var d = JSON.parse(t); all = all.concat(Array.isArray(d) ? d : [d]); } catch (e) {}
      });
      return all;
    });
  }

  function repUpload() {
    var input = $("repFiles"), out = $("repStatus");
    readChosen().then(function (all) {
      if (all === null) { out.textContent = "Elige uno o más tw-reports-*.json (o pega el JSON) primero."; return; }
      if (!all.length) { out.textContent = "Ningún JSON válido — exporta con reportsExport.js."; return; }
      out.textContent = "Verificando navegador…";
      return repGuardToken().then(function (token) {
        if (!token) { out.textContent = "No se pudo verificar el navegador — inténtalo de nuevo."; return; }
        out.textContent = "Subiendo " + all.length + " informes…";
        return TW.apiFetch(UPLOAD_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "twstats", content: JSON.stringify(all), token: token,
                                 kind: "reports", ext: "json", world: "es103" }),
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.ok && res.db && !res.db.error) {
            out.textContent = "✔ +" + res.db.added + " nuevos, " + res.db.dupes +
              " duplicados — la BD cubre " + res.db.villages + " pueblos.";
            input.value = "";
            if ($("repPaste")) $("repPaste").value = "";
            loadDbStats();
            return;
          }
          out.textContent = "Error al subir" + (res && res.error ? ": " + res.error : ".");
        });
      });
    }).catch(function (e) { out.textContent = "Error: " + e.message; });
  }

  // === local viewer ("Ver") ================================================
  // Renders the chosen exports like the in-game reports (report-render.js).
  // Everything stays in the browser. Report bodies render LAZILY on first
  // expand — an export can hold a thousand records.
  var viewRecords = [];
  function repView() {
    var out = $("repStatus");
    readChosen().then(function (all) {
      if (all === null) { out.textContent = "Elige uno o más tw-reports-*.json (o pega el JSON) primero."; return; }
      var recs = all.filter(function (r) { return r && typeof r === "object" && r.reportTimestamp; });
      if (!recs.length) { out.textContent = "Ningún JSON válido — exporta con reportsExport.js."; return; }
      recs.sort(function (a, b) { return (b.reportTimestamp || 0) - (a.reportTimestamp || 0); });
      viewRecords = recs;
      out.textContent = "";
      $("viewerLine").textContent = recs.length + " informes — pulsa uno para verlo como en el juego.";
      $("viewerList").innerHTML = recs.map(function (r, i) {
        return '<details class="twrr-item" data-i="' + i + '"><summary>' +
          TWRR.fmtT(r.reportTimestamp) + " · " + TWRR.subjectLine(r) + "</summary></details>";
      }).join("");
      $("viewerWrap").hidden = false;
    });
  }
  function viewerToggle(e) {
    var d = e.target;
    if (!d || d.className !== "twrr-item" || !d.open || d.childElementCount > 1) return;
    var r = viewRecords[+d.getAttribute("data-i")];
    if (r) d.insertAdjacentHTML("beforeend", TWRR.reportHtml(r));
  }

  function init() {
    TW.renderNav("informes");
    $("repPasteBtn").addEventListener("click", function () {
      var w = $("repPasteWrap");
      w.hidden = !w.hidden;
      if (!w.hidden) $("repPaste").focus();
    });
    $("repUpload").addEventListener("click", repUpload);
    $("repView").addEventListener("click", repView);
    $("viewerList").addEventListener("toggle", viewerToggle, true); // toggle doesn't bubble
    loadDbStats();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
