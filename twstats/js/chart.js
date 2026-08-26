/* Hand-rolled inline-SVG line charts. No library, offline-safe.
   - TW.seriesPoints(series, key) -> [{t, v}] (skips null values).
   - TW.lineChart(points, opts) -> static SVG string (kept for back-compat).
   - TW.metricChart(mountEl, series, metrics, opts) -> interactive chart with a
     metric toggle bar, hover crosshair + dot, and a positioned tooltip.
   Theme-aware: strokes/fills come from css/twstats.css variables. */
(function () {
  "use strict";
  if (!window.TW) window.TW = {};
  var TW = window.TW;

  // Build [{t, v}] from a daily/event series + a numeric key.
  function seriesPoints(series, key) {
    var out = [];
    for (var i = 0; i < series.length; i++) {
      var v = series[i][key];
      if (v == null) continue;
      out.push({ t: series[i].t, v: +v });
    }
    return out;
  }

  // Core geometry + SVG builder. Returns { svg, coords:[{px,py,t,v}], geom }.
  // opts: {width, height, invert, timeX, color, label, interactive}.
  function buildChart(points, opts) {
    opts = opts || {};
    var W = opts.width || 600, H = opts.height || 150;
    var invert = !!opts.invert;
    var color = opts.color || "var(--link-color)";
    var padL = 52, padR = 12, padT = opts.label ? 20 : 10, padB = 22;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var geom = { W: W, H: H, padL: padL, padT: padT, plotW: plotW, plotH: plotH };

    if (!points || !points.length) {
      var empty = '<svg class="chart" width="' + W + '" height="' + H +
        '" viewBox="0 0 ' + W + " " + H + '" role="img">' +
        '<text x="' + (W / 2) + '" y="' + (H / 2) +
        '" text-anchor="middle" class="chart-empty">Sin datos</text></svg>';
      return { svg: empty, coords: [], geom: geom };
    }

    var min = Infinity, max = -Infinity;
    for (var i = 0; i < points.length; i++) {
      if (points[i].v < min) min = points[i].v;
      if (points[i].v > max) max = points[i].v;
    }
    var span = max - min;
    var n = points.length;
    var t0 = points[0].t, tSpan = points[n - 1].t - t0;
    function xFor(idx) {
      if (opts.timeX && tSpan) return padL + ((points[idx].t - t0) / tSpan) * plotW;
      return n === 1 ? padL + plotW / 2 : padL + (idx / (n - 1)) * plotW;
    }
    function yFor(v) {
      var frac = span ? (v - min) / span : 0.5;
      return invert ? (padT + frac * plotH) : (padT + (1 - frac) * plotH);
    }

    var coords = [];
    var pts = "";
    for (var j = 0; j < n; j++) {
      var px = xFor(j), py = yFor(points[j].v);
      coords.push({ px: px, py: py, t: points[j].t, v: points[j].v });
      pts += (j ? " " : "") + px.toFixed(1) + "," + py.toFixed(1);
    }

    var svg = '<svg class="chart" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + " " + H + '" role="img"' +
      (opts.label ? ' aria-label="' + TW.esc(opts.label) + '"' : "") + ">";
    if (opts.label) {
      svg += '<text x="' + padL + '" y="13" class="chart-title">' + TW.esc(opts.label) + "</text>";
    }
    svg += '<line class="chart-axis" x1="' + padL + '" y1="' + padT + '" x2="' + padL +
      '" y2="' + (padT + plotH) + '"/>';
    svg += '<line class="chart-axis" x1="' + padL + '" y1="' + (padT + plotH) +
      '" x2="' + (padL + plotW) + '" y2="' + (padT + plotH) + '"/>';

    svg += '<polyline class="chart-line" fill="none" stroke="' + color +
      '" points="' + pts + '"/>';
    svg += '<circle class="chart-dot" fill="' + color + '" cx="' + xFor(0).toFixed(1) +
      '" cy="' + yFor(points[0].v).toFixed(1) + '" r="2"/>';
    svg += '<circle class="chart-dot" fill="' + color + '" cx="' + xFor(n - 1).toFixed(1) +
      '" cy="' + yFor(points[n - 1].v).toFixed(1) + '" r="2.5"/>';

    svg += '<text x="' + (padL - 6) + '" y="' + (yFor(max) + 3).toFixed(1) +
      '" text-anchor="end" class="chart-vlabel">' + TW.commas(max) + "</text>";
    if (span) {
      svg += '<text x="' + (padL - 6) + '" y="' + (yFor(min) + 3).toFixed(1) +
        '" text-anchor="end" class="chart-vlabel">' + TW.commas(min) + "</text>";
    }

    svg += '<text x="' + padL + '" y="' + (H - 6) + '" class="chart-dlabel">' +
      TW.fmtDate(points[0].t) + "</text>";
    if (n > 1) {
      svg += '<text x="' + (padL + plotW) + '" y="' + (H - 6) +
        '" text-anchor="end" class="chart-dlabel">' + TW.fmtDate(points[n - 1].t) + "</text>";
    }

    if (opts.interactive) {
      svg += '<line class="chart-crosshair" x1="0" y1="' + padT + '" x2="0" y2="' +
        (padT + plotH) + '" style="display:none"/>';
      svg += '<circle class="chart-hoverdot" r="3.2" fill="' + color +
        '" cx="0" cy="0" style="display:none"/>';
    }

    svg += "</svg>";
    return { svg: svg, coords: coords, geom: geom };
  }

  // Back-compat static chart (SVG string only).
  function lineChart(points, opts) {
    return buildChart(points, opts).svg;
  }

  // Interactive metric chart. `metrics` = [{key, label, invert}]; first active.
  // opts: {width, height, timeX, color}. Village passes a single-metric array
  // (no toggle bar rendered). Hover shows crosshair + dot + tooltip.
  function metricChart(mount, series, metrics, opts) {
    opts = opts || {};
    var W = opts.width || 640, H = opts.height || 220;

    var wrap = document.createElement("div");
    wrap.className = "metric-chart";

    var buttons = [];
    if (metrics.length > 1) {
      var bar = document.createElement("div");
      bar.className = "chart-metrics";
      for (var i = 0; i < metrics.length; i++) {
        (function (idx) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "cm-btn" + (idx === 0 ? " active" : "");
          b.textContent = metrics[idx].label;
          b.addEventListener("click", function () { draw(idx); });
          bar.appendChild(b);
          buttons.push(b);
        })(i);
      }
      wrap.appendChild(bar);
    }

    var holder = document.createElement("div");
    holder.className = "chart-interactive";
    var tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    holder.appendChild(tip);
    wrap.appendChild(holder);

    mount.innerHTML = "";
    mount.appendChild(wrap);

    var cur = { coords: [], geom: null, metric: null, svg: null, cross: null, dot: null };

    function draw(idx) {
      for (var b = 0; b < buttons.length; b++) buttons[b].classList.toggle("active", b === idx);
      var m = metrics[idx];
      var built = buildChart(seriesPoints(series, m.key), {
        width: W, height: H, invert: m.invert, timeX: opts.timeX,
        color: opts.color, label: m.label, interactive: true,
      });
      var old = holder.querySelector("svg");
      if (old) holder.removeChild(old);
      holder.insertAdjacentHTML("afterbegin", built.svg);
      cur.coords = built.coords;
      cur.geom = built.geom;
      cur.metric = m;
      cur.svg = holder.querySelector("svg");
      cur.cross = cur.svg.querySelector(".chart-crosshair");
      cur.dot = cur.svg.querySelector(".chart-hoverdot");
      hide();
    }

    function hide() {
      tip.hidden = true;
      if (cur.cross) cur.cross.style.display = "none";
      if (cur.dot) cur.dot.style.display = "none";
    }

    function hover(clientX) {
      if (!cur.coords.length || !cur.svg) return;
      var rect = cur.svg.getBoundingClientRect();
      if (!rect.width) return;
      var vbX = (clientX - rect.left) / rect.width * cur.geom.W;
      var best = 0, bd = Infinity;
      for (var i = 0; i < cur.coords.length; i++) {
        var d = Math.abs(cur.coords[i].px - vbX);
        if (d < bd) { bd = d; best = i; }
      }
      var c = cur.coords[best];
      if (cur.cross) {
        cur.cross.setAttribute("x1", c.px.toFixed(1));
        cur.cross.setAttribute("x2", c.px.toFixed(1));
        cur.cross.style.display = "";
      }
      if (cur.dot) {
        cur.dot.setAttribute("cx", c.px.toFixed(1));
        cur.dot.setAttribute("cy", c.py.toFixed(1));
        cur.dot.style.display = "";
      }
      var when = opts.timeX ? TW.fmtDateTime(c.t) : TW.fmtDate(c.t);
      tip.innerHTML = '<span class="tip-date">' + when + '</span>' +
        '<span class="tip-val">' + TW.esc(cur.metric.label) + ": " + TW.commas(c.v) + "</span>";
      tip.hidden = false;
      var cxPx = (c.px / cur.geom.W) * rect.width;
      var cyPx = (c.py / cur.geom.H) * rect.height;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = Math.max(2, Math.min(cxPx - tw / 2, rect.width - tw - 2));
      var top = cyPx - th - 10;
      if (top < 0) top = cyPx + 14;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }

    holder.addEventListener("mousemove", function (e) { hover(e.clientX); });
    holder.addEventListener("mouseleave", hide);
    holder.addEventListener("touchstart", function (e) {
      if (e.touches && e.touches[0]) hover(e.touches[0].clientX);
    }, { passive: true });
    holder.addEventListener("touchmove", function (e) {
      if (e.touches && e.touches[0]) hover(e.touches[0].clientX);
    }, { passive: true });

    draw(0);
  }

  TW.lineChart = lineChart;
  TW.buildChart = buildChart;
  TW.metricChart = metricChart;
  TW.seriesPoints = seriesPoints;
})();
