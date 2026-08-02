/* Bumblebee Simulator - shared helpers.
   Loaded first; every other file expects window.BB to exist. */
(function (BB) {
  'use strict';

  BB.VERSION = '1.0.0';

  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------ math ---- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOutCubic(t) { t = clamp(t, 0, 1); var u = 1 - t; return 1 - u * u * u; }

  /* Frame-rate independent exponential smoothing. */
  function approach(current, target, rate, dt) {
    return target + (current - target) * Math.exp(-rate * dt);
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function angleLerp(a, b, t) { return a + wrapAngle(b - a) * t; }

  function dist(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function dist2(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  }

  /* ------------------------------------------------------------- rng ---- */

  /* mulberry32: small, fast, and seedable so a world can be reproduced. */
  function makeRng(seed) {
    var s = seed >>> 0;
    if (s === 0) s = 0x9e3779b9;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A default stream for cosmetic randomness that nobody needs to reproduce. */
  var loose = makeRng((Date.now() ^ 0x5f3759df) >>> 0);

  function rand(rng, lo, hi) { return lo + (hi - lo) * rng(); }
  function randInt(rng, lo, hi) { return Math.floor(lo + (hi - lo + 1) * rng()); }
  function pick(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }

  /* Pick from [{weight:n, ...}] style lists. */
  function weightedPick(rng, items, weightOf) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += weightOf(items[i]);
    var r = rng() * total;
    for (i = 0; i < items.length; i++) {
      r -= weightOf(items[i]);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /* Smooth 1D value noise - used for wind and cloud drift. */
  function makeNoise1D(seed) {
    var rng = makeRng(seed);
    var table = new Float32Array(256);
    for (var i = 0; i < 256; i++) table[i] = rng() * 2 - 1;
    return function (x) {
      var xi = Math.floor(x), f = x - xi;
      var a = table[xi & 255], b = table[(xi + 1) & 255];
      return lerp(a, b, smoothstep(f));
    };
  }

  /* ----------------------------------------------------------- color ---- */

  function hsl(h, s, l, a) {
    h = ((h % 360) + 360) % 360;
    return 'hsla(' + h.toFixed(1) + ',' + clamp(s, 0, 100).toFixed(1) + '%,' +
      clamp(l, 0, 100).toFixed(1) + '%,' + (a === undefined ? 1 : clamp(a, 0, 1).toFixed(3)) + ')';
  }

  /* Jitter an [h,s,l] triple. Used thousands of times while baking fur. */
  function jitterHsl(rng, band, dh, ds, dl, a) {
    return hsl(
      band[0] + (rng() * 2 - 1) * dh,
      band[1] + (rng() * 2 - 1) * ds,
      band[2] + (rng() * 2 - 1) * dl,
      a
    );
  }

  function rgba(r, g, b, a) {
    return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' +
      (a === undefined ? 1 : clamp(a, 0, 1).toFixed(3)) + ')';
  }

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mixRgb(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  function rgbStr(c, a) { return rgba(c[0], c[1], c[2], a); }

  /* ---------------------------------------------------------- canvas ---- */

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    var ctx = c.getContext('2d');
    return { canvas: c, ctx: ctx, w: c.width, h: c.height };
  }

  /* True when a baked sprite actually contains pixels. Guards the classic
     "baked into an empty canvas" bug, which is otherwise invisible. */
  function canvasHasInk(canvas) {
    try {
      var ctx = canvas.getContext('2d');
      var step = Math.max(1, Math.floor(canvas.width / 64));
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (var y = 0; y < canvas.height; y += step) {
        for (var x = 0; x < canvas.width; x += step) {
          if (data[(y * canvas.width + x) * 4 + 3] > 4) return true;
        }
      }
      return false;
    } catch (err) {
      return true; /* getImageData blocked - assume fine rather than fail loudly */
    }
  }

  /* ---------------------------------------------------------- format ---- */

  /* Hours as a float (13.5) into "13:30". */
  function formatClock(hour) {
    var h = Math.floor(hour) % 24;
    var m = Math.floor((hour - Math.floor(hour)) * 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function formatNum(v, digits) {
    return v.toFixed(digits === undefined ? 0 : digits);
  }

  /* 12345 -> "12,345" */
  function commas(v) {
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ------------------------------------------------------- url params ---- */

  /* Query parameters exist so a specific situation can be reached instantly:
     ?species=dahlbomii&day=4&hour=19.5&debug=1&selftest=1 */
  var params = (function () {
    var out = {};
    try {
      var q = (window.location.search || '').replace(/^\?/, '');
      if (!q) return out;
      q.split('&').forEach(function (pair) {
        if (!pair) return;
        var idx = pair.indexOf('=');
        var k = idx < 0 ? pair : pair.slice(0, idx);
        var v = idx < 0 ? '1' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
        out[k] = v;
      });
    } catch (err) { /* file:// with no search string */ }
    return out;
  })();

  function paramNum(name, fallback) {
    var v = parseFloat(params[name]);
    return isFinite(v) ? v : fallback;
  }

  function paramFlag(name) {
    return params[name] === '1' || params[name] === 'true';
  }

  BB.Util = {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    invLerp: invLerp,
    smoothstep: smoothstep,
    easeOutCubic: easeOutCubic,
    approach: approach,
    wrapAngle: wrapAngle,
    angleLerp: angleLerp,
    dist: dist,
    dist2: dist2,
    makeRng: makeRng,
    loose: loose,
    rand: rand,
    randInt: randInt,
    pick: pick,
    weightedPick: weightedPick,
    makeNoise1D: makeNoise1D,
    hsl: hsl,
    jitterHsl: jitterHsl,
    rgba: rgba,
    hexToRgb: hexToRgb,
    mixRgb: mixRgb,
    rgbStr: rgbStr,
    makeCanvas: makeCanvas,
    canvasHasInk: canvasHasInk,
    formatClock: formatClock,
    formatNum: formatNum,
    commas: commas,
    params: params,
    paramNum: paramNum,
    paramFlag: paramFlag
  };

})(window.BB = window.BB || {});
