/* Bumblebee Simulator - offscreen art baking.
 *
 * The rule that keeps this game at 60 fps: anything *textural* is drawn once
 * into an offscreen canvas and then blitted. Only things that move, articulate
 * or change with the light are drawn live, every frame.
 *
 * The most important routine here is bakeBee(): a bumblebee reads as a
 * bumblebee because of its fur, so each species gets 2000-4000 individual hair
 * strokes with jittered colour, length and angle - and the boundaries between
 * its colour bands are jittered too, so the stripes look like hairy edges
 * instead of vector shapes. That costs 40-140 ms, which is why it happens once
 * during a loading beat and never during play.
 */
(function (BB) {
  'use strict';

  var U = BB.Util;
  var TAU = U.TAU;

  var SS = 2;          /* supersample factor for baked sprites */
  var BASE_LEN = 74;   /* on-screen body length in px for sizeScale 1.0 */
  var LIGHT = [-0.5, -0.87];  /* default bake light direction, upper-left */

  var beeCache = {};
  var flowerCache = {};
  var layerCache = {};

  /* ==================================================================== */
  /*  Small drawing helpers                                               */
  /* ==================================================================== */

  function ellipse(ctx, cx, cy, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU);
  }

  /* A tapered, slightly curved hair. This single primitive is repeated
     thousands of times and is what makes the fur convincing. */
  function hair(ctx, bx, by, nx, ny, len, curl, width, color) {
    var tx = bx + nx * len;
    var ty = by + ny * len;
    var mx = bx + nx * len * 0.55 - ny * curl;
    var my = by + ny * len * 0.55 + nx * curl;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  /* Look up a species colour band at longitudinal position u, with the band
     edge deliberately smeared so the stripe boundary looks like fur. */
  function bandAt(bands, u, jitter) {
    var uu = u + jitter;
    for (var i = 0; i < bands.length; i++) {
      if (uu >= bands[i].from && uu < bands[i].to) return bands[i].hsl;
    }
    return bands[uu < 0 ? 0 : bands.length - 1].hsl;
  }

  /* Petal as a closed pair of cubic curves: base -> tip -> base. */
  function petalPath(ctx, cx, cy, ang, len, wid, tipPinch) {
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var tx = cx + ca * len, ty = cy + sa * len;
    var px = -sa, py = ca;
    var p = tipPinch === undefined ? 0.28 : tipPinch;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.bezierCurveTo(
      cx + ca * len * 0.24 + px * wid, cy + sa * len * 0.24 + py * wid,
      cx + ca * len * 0.82 + px * wid * p, cy + sa * len * 0.82 + py * wid * p,
      tx, ty
    );
    ctx.bezierCurveTo(
      cx + ca * len * 0.82 - px * wid * p, cy + sa * len * 0.82 - py * wid * p,
      cx + ca * len * 0.24 - px * wid, cy + sa * len * 0.24 - py * wid,
      cx, cy
    );
    ctx.closePath();
  }

  function stem(ctx, x0, y0, x1, y1, bend, width, color) {
    var mx = (x0 + x1) / 2 + bend;
    var my = (y0 + y1) / 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function leaf(ctx, x, y, len, ang, color, edge) {
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var wid = len * 0.34;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + ca * len * 0.3 - sa * wid, y + sa * len * 0.3 + ca * wid,
      x + ca * len * 0.8 - sa * wid * 0.5, y + sa * len * 0.8 + ca * wid * 0.5,
      x + ca * len, y + sa * len
    );
    ctx.bezierCurveTo(
      x + ca * len * 0.8 + sa * wid * 0.5, y + sa * len * 0.8 - ca * wid * 0.5,
      x + ca * len * 0.3 + sa * wid, y + sa * len * 0.3 - ca * wid,
      x, y
    );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (edge) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = edge;
      ctx.stroke();
      /* midrib */
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ca * len * 0.95, y + sa * len * 0.95);
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  /* ==================================================================== */
  /*  The bee                                                             */
  /* ==================================================================== */

  /* Body layout in units of body length, facing +x.
     u = 0 at the front of the face, u = 1 at the tip of the abdomen. */
  var HEAD   = { cx: 0.335, cy: -0.015, rx: 0.115, ry: 0.125 };
  var THORAX = { cx: 0.130, cy: 0.000, rx: 0.175, ry: 0.185 };
  var ABDO   = { cx: -0.235, cy: 0.020, rx: 0.320, ry: 0.200 };
  var U_FRONT = 0.46, U_SPAN = 1.05;

  function uOf(x) { return U.clamp((U_FRONT - x) / U_SPAN, 0, 1); }

  /* A teardrop, widest just behind the waist and tapering to a blunt point.
     A plain ellipse here reads as a ball and instantly looks like a cartoon. */
  function abdomenPath(ctx, P, Q, aspect) {
    var a = aspect;
    ctx.beginPath();
    ctx.moveTo(P(0.050), Q(-0.145 * a));
    ctx.bezierCurveTo(P(-0.060), Q(-0.218 * a), P(-0.300), Q(-0.208 * a), P(-0.510), Q(-0.082 * a));
    ctx.bezierCurveTo(P(-0.585), Q(-0.024 * a), P(-0.600), Q(0.048 * a), P(-0.562), Q(0.092 * a));
    ctx.bezierCurveTo(P(-0.440), Q(0.198 * a), P(-0.160), Q(0.238 * a), P(0.050), Q(0.155 * a));
    ctx.closePath();
  }

  /* Bake body, wings and blur envelopes for one species. */
  function bakeBee(species) {
    if (beeCache[species.id]) return beeCache[species.id];

    var rng = U.makeRng(0x8ee5 ^ species.id.charCodeAt(0) * 7919);
    var L = BASE_LEN * species.sizeScale;   /* on-screen body length */
    var S = L * SS;                          /* baked pixels per body length */
    var aspect = species.bodyAspect;

    /* Canvas big enough for the body plus the fur fringe. */
    var padX = 0.10, padY = 0.12;
    var localW = 1.34 + padX * 2;
    var localH = 0.70 * aspect + padY * 2;
    var buf = U.makeCanvas(localW * S, localH * S);
    var ctx = buf.ctx;
    var ox = (0.72 + padX) * S;
    var oy = (0.35 * aspect + padY) * S;

    function P(x) { return ox + x * S; }
    function Q(y) { return oy + y * S * aspect; }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var hairBase = 0.052 * species.hairLength;
    var widthScale = S / 106;

    /* One fur pass over one body part. `mode` picks undercoat / coat / rim. */
    function furPass(part, count, mode) {
      var i, lenMul, alpha, dl;
      if (mode === 'under') { lenMul = 1.3; alpha = 0.40; dl = -17; }
      else if (mode === 'rim') { lenMul = 0.85; alpha = 0.11; dl = 9; }
      else { lenMul = 1.0; alpha = 0.55; dl = 0; }

      if (mode === 'rim') ctx.globalCompositeOperation = 'lighter';

      for (i = 0; i < count; i++) {
        var th = rng() * TAU;
        var rr = 0.52 + 0.48 * Math.sqrt(rng());
        var bx = part.cx + part.rx * rr * Math.cos(th);
        var by = part.cy + part.ry * rr * Math.sin(th);

        /* Outward normal of the ellipse at this parameter angle. */
        var nx = Math.cos(th) / part.rx;
        var ny = Math.sin(th) / part.ry;
        var nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;

        var dot = nx * LIGHT[0] + ny * LIGHT[1];
        if (mode === 'rim' && dot < 0.25) continue;

        var band = bandAt(species.bands, uOf(bx), (rng() * 2 - 1) * 0.028);
        var shade = dl + dot * 15 - (by > part.cy ? 9 : 0);
        var col = U.hsl(
          band[0] + (rng() * 2 - 1) * 6,
          band[1] + (rng() * 2 - 1) * 9,
          band[2] + shade + (rng() * 2 - 1) * 8,
          alpha
        );

        var len = hairBase * lenMul * (0.65 + 0.75 * rng());
        var curl = (rng() * 2 - 1) * len * 0.4;
        hair(ctx,
          P(bx), Q(by),
          nx, ny * aspect,
          len * S,
          curl * S,
          (0.75 + 0.85 * rng()) * widthScale,
          col);
      }

      ctx.globalCompositeOperation = 'source-over';
    }

    /* Base fill for a part: soft radial gradient lit from the upper left. */
    function fillPart(part, isAbdomen) {
      var gx = P(part.cx - part.rx * 0.35);
      var gy = Q(part.cy - part.ry * 0.45);
      var gr = Math.max(part.rx, part.ry) * S * 1.5;
      var g = ctx.createRadialGradient(gx, gy, gr * 0.05, gx, gy, gr);
      var mid = bandAt(species.bands, uOf(part.cx), 0);
      g.addColorStop(0, U.hsl(mid[0], mid[1], mid[2] + 12, 1));
      g.addColorStop(0.55, U.hsl(mid[0], mid[1], mid[2], 1));
      g.addColorStop(1, U.hsl(mid[0], mid[1] + 4, mid[2] - 12, 1));

      if (isAbdomen) abdomenPath(ctx, P, Q, aspect);
      else ellipse(ctx, P(part.cx), Q(part.cy), part.rx * S, part.ry * S * aspect, 0);
      ctx.fillStyle = g;
      ctx.fill();

      /* Paint the colour bands across the fill so the fur has something to
         sit on rather than showing gradient through the gaps. */
      ctx.save();
      ctx.clip();
      for (var b = 0; b < species.bands.length; b++) {
        var band = species.bands[b];
        var x0 = U_FRONT - band.to * U_SPAN;
        var x1 = U_FRONT - band.from * U_SPAN;
        ctx.fillStyle = U.hsl(band.hsl[0], band.hsl[1], band.hsl[2], 0.85);
        ctx.fillRect(P(x0), 0, (x1 - x0) * S, buf.h);
      }
      ctx.restore();
    }

    var density = species.hairDensity;
    var nAbdo = Math.round(1500 * density);
    var nThorax = Math.round(1100 * density);
    var nHead = Math.round(420 * density);

    /* ---- abdomen ---- */
    furPass(ABDO, Math.round(nAbdo * 0.5), 'under');
    fillPart(ABDO, true);
    furPass(ABDO, nAbdo, 'coat');

    /* Faint segment creases across the abdomen. */
    ctx.save();
    abdomenPath(ctx, P, Q, aspect);
    ctx.clip();
    for (var seg = 1; seg <= 4; seg++) {
      var sx = -0.03 - seg * 0.115;
      ctx.beginPath();
      ctx.moveTo(P(sx), Q(-0.22 * aspect));
      ctx.quadraticCurveTo(P(sx - 0.03), Q(0), P(sx), Q(0.24 * aspect));
      ctx.lineWidth = 1.4 * widthScale;
      ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      ctx.stroke();
    }
    ctx.restore();
    furPass(ABDO, Math.round(nAbdo * 0.22), 'rim');

    /* ---- head (drawn before the thorax so thorax fur overlaps the joint) ---- */
    furPass(HEAD, Math.round(nHead * 0.5), 'under');
    fillPart(HEAD, false);
    furPass(HEAD, nHead, 'coat');
    bakeEye(ctx, P, Q, S, aspect, species, widthScale);

    /* Mandibles, just visible under the face. */
    ctx.beginPath();
    ctx.moveTo(P(0.40), Q(0.075 * aspect));
    ctx.quadraticCurveTo(P(0.455), Q(0.10 * aspect), P(0.43), Q(0.135 * aspect));
    ctx.lineWidth = 3.0 * widthScale;
    ctx.strokeStyle = 'rgba(38,26,14,0.85)';
    ctx.stroke();

    /* ---- thorax ---- */
    furPass(THORAX, Math.round(nThorax * 0.5), 'under');
    fillPart(THORAX, false);
    furPass(THORAX, nThorax, 'coat');
    furPass(THORAX, Math.round(nThorax * 0.25), 'rim');

    /* Wing bases: faint sockets on top of the thorax. Kept very subtle - drawn
       any darker they read as a pair of eyes in the middle of the back. */
    for (var wb = 0; wb < 2; wb++) {
      ellipse(ctx, P(0.10 - wb * 0.075), Q(-0.152 * aspect), 0.020 * S, 0.012 * S, -0.3);
      ctx.fillStyle = 'rgba(34,26,16,0.22)';
      ctx.fill();
    }

    var wing = bakeWing(species, L, rng);

    var sprite = {
      body: buf.canvas,
      ox: ox / SS,
      oy: oy / SS,
      w: buf.w / SS,
      h: buf.h / SS,
      lengthPx: L,
      wing: wing,
      /* Anatomy anchors in on-screen px relative to the body origin. Used by
         the live renderer for legs, wings, antennae and the proboscis. */
      anchors: {
        wingRoot:  { x: 0.10 * L, y: -0.155 * L * aspect },
        wingRoot2: { x: 0.025 * L, y: -0.150 * L * aspect },
        legFront:  { x: 0.235 * L, y: 0.135 * L * aspect },
        legMid:    { x: 0.115 * L, y: 0.165 * L * aspect },
        legHind:   { x: -0.015 * L, y: 0.170 * L * aspect },
        mouth:     { x: 0.435 * L, y: 0.085 * L * aspect },
        antenna:   { x: 0.405 * L, y: -0.045 * L * aspect },
        eye:       { x: 0.365 * L, y: -0.040 * L * aspect },
        sting:     { x: -0.585 * L, y: -0.030 * L * aspect }
      }
    };

    beeCache[species.id] = sprite;
    return sprite;
  }

  /* A compound eye: hundreds of facets for the price of one pattern fill.
     Speculars are deliberately left out and drawn live, so the eyes catch
     the sun as it moves across the day. */
  var facetTile = null;
  function getFacetTile() {
    if (facetTile) return facetTile;
    var t = U.makeCanvas(9, 8);
    var c = t.ctx;
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 0.7;
    for (var row = 0; row < 2; row++) {
      for (var col = 0; col < 2; col++) {
        var cx = col * 4.5 + (row % 2) * 2.25;
        var cy = row * 4 + 2;
        c.beginPath();
        for (var k = 0; k < 6; k++) {
          var a = k * TAU / 6;
          var x = cx + Math.cos(a) * 2.3;
          var y = cy + Math.sin(a) * 2.3;
          if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.closePath();
        c.stroke();
      }
    }
    facetTile = t.canvas;
    return facetTile;
  }

  function bakeEye(ctx, P, Q, S, aspect, species, widthScale) {
    var ex = 0.362, ey = -0.038, erx = 0.050, ery = 0.082;
    ctx.save();
    ellipse(ctx, P(ex), Q(ey), erx * S, ery * S * aspect, -0.22);
    var g = ctx.createRadialGradient(
      P(ex - erx * 0.4), Q(ey - ery * 0.5), erx * S * 0.1,
      P(ex), Q(ey), erx * S * 1.5);
    g.addColorStop(0, U.hsl(species.eyeHue, 30, 26, 1));
    g.addColorStop(0.6, U.hsl(species.eyeHue, 24, 14, 1));
    g.addColorStop(1, U.hsl(species.eyeHue, 20, 6, 1));
    ctx.fillStyle = g;
    ctx.fill();

    /* Facets, clipped to the eye. */
    ctx.clip();
    var pat = ctx.createPattern(getFacetTile(), 'repeat');
    if (pat) {
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = pat;
      ctx.fillRect(P(ex - erx * 1.4), Q(ey - ery * 1.6), erx * S * 3, ery * S * 3.4);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    /* Dark rim to imply curvature. */
    ellipse(ctx, P(ex), Q(ey), erx * S, ery * S * aspect, -0.22);
    ctx.lineWidth = 1.6 * widthScale;
    ctx.strokeStyle = 'rgba(12,8,4,0.55)';
    ctx.stroke();
  }

  /* ---- wings ---------------------------------------------------------- */

  /* Bake one crisp wing plus three motion-blur envelopes.
     A bumblebee beats its wings 130-200 times a second. At 60 fps that is up
     to three full strokes per frame, so animating a wing position is
     physically meaningless and reads as flicker. The honest answer is to draw
     the time-averaged envelope of the stroke and let the audio carry the
     actual frequency. */
  function bakeWing(species, L, rng) {
    var WL = 0.98 * L;           /* wing length in screen px */
    var pad = 8;
    var buf = U.makeCanvas((WL + pad * 2) * SS, (WL * 0.42 + pad * 2) * SS);
    var ctx = buf.ctx;
    var rootX = pad * SS, rootY = (WL * 0.21 + pad) * SS;
    var s = WL * SS;

    function outline(c) {
      c.beginPath();
      c.moveTo(rootX, rootY);
      c.bezierCurveTo(rootX + s * 0.30, rootY - s * 0.16,
        rootX + s * 0.72, rootY - s * 0.145, rootX + s * 0.985, rootY - s * 0.035);
      c.bezierCurveTo(rootX + s * 1.02, rootY + s * 0.005,
        rootX + s * 0.99, rootY + s * 0.055, rootX + s * 0.93, rootY + s * 0.075);
      c.bezierCurveTo(rootX + s * 0.62, rootY + s * 0.15,
        rootX + s * 0.26, rootY + s * 0.125, rootX + s * 0.03, rootY + s * 0.03);
      c.closePath();
    }

    outline(ctx);
    var g = ctx.createLinearGradient(rootX, rootY, rootX + s, rootY);
    g.addColorStop(0, 'rgba(226,236,252,0.26)');
    g.addColorStop(0.55, 'rgba(240,246,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    outline(ctx);
    ctx.clip();

    /* Iridescence: a few wide, faint colour washes. */
    var hues = [192, 284, 44];
    for (var i = 0; i < hues.length; i++) {
      var cx = rootX + s * (0.3 + i * 0.26);
      var cy = rootY + s * (i % 2 ? 0.04 : -0.03);
      var rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.34);
      rg.addColorStop(0, U.hsl(hues[i], 85, 62, 0.10));
      rg.addColorStop(1, U.hsl(hues[i], 85, 62, 0));
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = rg;
      ctx.fillRect(rootX, rootY - s * 0.25, s * 1.1, s * 0.5);
    }
    ctx.globalCompositeOperation = 'source-over';

    /* Longitudinal veins fanning from the root, plus cross veins. */
    ctx.lineCap = 'round';
    var veinCol = 'rgba(104,92,74,0.46)';
    for (var v = 0; v < 9; v++) {
      var spread = -0.13 + v * 0.032;
      var endY = rootY + s * (spread + 0.02);
      ctx.beginPath();
      ctx.moveTo(rootX + s * 0.02, rootY + s * (spread * 0.25));
      ctx.quadraticCurveTo(rootX + s * 0.45, rootY + s * (spread * 0.85),
        rootX + s * (0.72 + rng() * 0.26), endY);
      ctx.lineWidth = (0.9 - v * 0.05) * SS;
      ctx.strokeStyle = veinCol;
      ctx.stroke();
    }
    for (var cv = 0; cv < 5; cv++) {
      var t = 0.32 + cv * 0.13;
      ctx.beginPath();
      ctx.moveTo(rootX + s * t, rootY - s * (0.10 - cv * 0.012));
      ctx.lineTo(rootX + s * (t + 0.05), rootY + s * (0.04 + cv * 0.008));
      ctx.lineWidth = 0.65 * SS;
      ctx.strokeStyle = veinCol;
      ctx.stroke();
    }
    ctx.restore();

    /* Thickened leading edge - the part the eye actually tracks. */
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.bezierCurveTo(rootX + s * 0.30, rootY - s * 0.16,
      rootX + s * 0.72, rootY - s * 0.145, rootX + s * 0.985, rootY - s * 0.035);
    ctx.lineWidth = 1.5 * SS;
    ctx.strokeStyle = 'rgba(88,76,58,0.6)';
    ctx.stroke();

    var crisp = {
      canvas: buf.canvas,
      ox: rootX / SS, oy: rootY / SS,
      w: buf.w / SS, h: buf.h / SS
    };

    /* Blur envelopes: stamp the wing across the stroke arc. */
    function envelope(halfArc, samples) {
      var r = (WL + pad * 2);
      var e = U.makeCanvas(r * 2 * SS, r * 1.5 * SS);
      var ec = e.ctx;
      var eox = pad * SS, eoy = r * 0.75 * SS;
      for (var k = 0; k < samples; k++) {
        var a = -halfArc + (2 * halfArc) * (k / (samples - 1));
        ec.save();
        ec.translate(eox, eoy);
        ec.rotate(a);
        /* Fake pronation by squashing the chord near the stroke extremes. */
        var chord = 0.72 + 0.28 * Math.cos(a / halfArc * 1.35);
        ec.scale(1, chord);
        ec.globalAlpha = 0.135;
        ec.drawImage(buf.canvas, -rootX, -rootY);
        ec.restore();
      }
      /* Soften the whole envelope. */
      var soft = U.makeCanvas(e.w, e.h);
      var offs = [[0, 0, 0.7], [1.4, 0, 0.3], [-1.4, 0, 0.3], [0, 1.4, 0.24], [0, -1.4, 0.24]];
      for (var o = 0; o < offs.length; o++) {
        soft.ctx.globalAlpha = offs[o][2];
        soft.ctx.drawImage(e.canvas, offs[o][0] * SS, offs[o][1] * SS);
      }
      return {
        canvas: soft.canvas,
        ox: eox / SS, oy: eoy / SS,
        w: soft.w / SS, h: soft.h / SS
      };
    }

    return {
      crisp: crisp,
      envelopes: [
        envelope(0.26, 9),    /* hovering */
        envelope(0.46, 11),   /* cruising */
        envelope(0.66, 13)    /* sprinting */
      ]
    };
  }

  /* ==================================================================== */
  /*  Flowers                                                             */
  /* ==================================================================== */

  /* Each routine draws a whole plant with its base at (w/2, h) growing
     upward, and records where the bee should land. The stem is baked in and
     the whole sprite is rotated about its base at draw time to make it sway,
     which is cheap and reads correctly for a plant bending in wind. */
  var FLOWER_DRAW = {

    rosaceous: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      var topY = h * 0.22;
      stem(ctx, bx, by, bx + (rng() * 2 - 1) * 12, topY, -18 - rng() * 12, 4.4, t.stemColor);
      /* thorns */
      for (var k = 0; k < 6; k++) {
        var ty = by - (k + 1) * (h * 0.11);
        ctx.beginPath();
        ctx.moveTo(bx - 2, ty);
        ctx.lineTo(bx - 8 - rng() * 3, ty + 4);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#54682f';
        ctx.stroke();
      }
      leaf(ctx, bx + 2, by - h * 0.34, h * 0.2, -0.35, '#5f7a3c', '#465c2a');
      leaf(ctx, bx - 2, by - h * 0.52, h * 0.17, Math.PI + 0.45, '#688443', '#465c2a');

      var heads = [
        { x: bx + 4, y: topY + 6, r: h * 0.115 },
        { x: bx - h * 0.16, y: topY + h * 0.15, r: h * 0.085 }
      ];
      for (var i = 0; i < heads.length; i++) {
        var f = heads[i];
        for (var p = 0; p < 5; p++) {
          var a = p * TAU / 5 + rng() * 0.3;
          petalPath(ctx, f.x, f.y, a, f.r, f.r * 0.62, 0.72);
          var g = ctx.createLinearGradient(f.x, f.y, f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r);
          g.addColorStop(0, t.colorSecondary);
          g.addColorStop(0.5, t.colorPrimary);
          g.addColorStop(1, '#ffffff');
          ctx.fillStyle = g;
          ctx.fill();
          ctx.lineWidth = 0.7;
          ctx.strokeStyle = 'rgba(180,150,165,0.5)';
          ctx.stroke();
        }
        /* stamen boss */
        for (var s2 = 0; s2 < 26; s2++) {
          var sa = rng() * TAU, sl = f.r * (0.2 + rng() * 0.3);
          ctx.beginPath();
          ctx.moveTo(f.x, f.y);
          ctx.lineTo(f.x + Math.cos(sa) * sl, f.y + Math.sin(sa) * sl);
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = 'rgba(215,200,150,0.85)';
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(f.x + Math.cos(sa) * sl, f.y + Math.sin(sa) * sl, 1.1, 0, TAU);
          ctx.fillStyle = t.pollenColor;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * 0.2, 0, TAU);
        ctx.fillStyle = '#a8b06a';
        ctx.fill();
      }
      out.anchorX = heads[0].x - w / 2;
      out.anchorY = heads[0].y - h;
    },

    globe: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      var headY = h * 0.26;
      stem(ctx, bx, by, bx + (rng() * 2 - 1) * 5, headY + 6, (rng() * 2 - 1) * 6, 3.0, t.stemColor);
      /* trifoliate leaf */
      for (var l = 0; l < 3; l++) {
        leaf(ctx, bx, by - h * 0.3, h * 0.15, -0.4 - l * 0.9, '#5c8140', '#3f5d2a');
      }
      var r = h * 0.2;
      /* A clover head is a tight ball of forty-odd florets, each drained
         separately. Drawn sparse and long they read as a moth, so they are
         packed short and dense over a shaded core instead. */
      ctx.beginPath();
      ctx.ellipse(bx, headY, r * 0.86, r * 0.78, 0, 0, TAU);
      ctx.fillStyle = t.colorSecondary;
      ctx.fill();

      /* Short, densely packed florets. Long ones fan out and the head stops
         looking like a ball of flowers and starts looking like a shell. */
      var n = 150;
      for (var i = 0; i < n; i++) {
        var a = rng() * TAU;
        var rr = r * (0.30 + 0.70 * Math.sqrt(rng()));
        var fx = bx + Math.cos(a) * rr * 0.88;
        var fy = headY + Math.sin(a) * rr * 0.80;
        var dir = Math.atan2(fy - headY, (fx - bx) * 1.15);
        petalPath(ctx, fx - Math.cos(dir) * r * 0.14, fy - Math.sin(dir) * r * 0.14,
          dir, r * 0.24, r * 0.082, 0.45);
        /* a few florets on every head have already gone over */
        var browning = rng() < 0.10 && fy > headY;
        var shade = 1 - U.clamp((headY - fy) / (r * 1.4), -0.4, 0.6);
        ctx.fillStyle = browning ? '#bfa079'
          : (rng() < 0.55 ? t.colorPrimary : t.colorSecondary);
        ctx.globalAlpha = 0.72 + 0.28 * (1 - shade * 0.4);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* Shading so the head reads as a sphere rather than a flat disc. */
      var hg = ctx.createRadialGradient(bx - r * 0.34, headY - r * 0.42, r * 0.05,
        bx, headY, r * 1.05);
      hg.addColorStop(0, 'rgba(255,255,255,0.26)');
      hg.addColorStop(0.55, 'rgba(255,255,255,0)');
      hg.addColorStop(1, 'rgba(56,38,18,0.26)');
      ctx.beginPath();
      ctx.ellipse(bx, headY, r * 0.98, r * 0.9, 0, 0, TAU);
      ctx.fillStyle = hg;
      ctx.fill();
      out.anchorX = 0;
      out.anchorY = headY - h - r * 0.35;
    },

    star: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      stem(ctx, bx, by, bx + 14, h * 0.3, 20, 3.2, t.stemColor);
      leaf(ctx, bx + 6, by - h * 0.4, h * 0.19, -0.2, '#5f7040', '#44532c');
      leaf(ctx, bx + 3, by - h * 0.62, h * 0.15, Math.PI - 0.3, '#6a7c48', '#44532c');

      var heads = [
        { x: bx + 16, y: h * 0.31, r: h * 0.10 },
        { x: bx + 2, y: h * 0.42, r: h * 0.082 },
        { x: bx + 28, y: h * 0.44, r: h * 0.072 }
      ];
      for (var i = 0; i < heads.length; i++) {
        var f = heads[i];
        /* five sharply reflexed petals, swept back away from the anther cone */
        for (var p = 0; p < 5; p++) {
          var a = -Math.PI / 2 + p * TAU / 5 + 0.3;
          petalPath(ctx, f.x, f.y, a, f.r * 1.15, f.r * 0.3, 0.12);
          var g = ctx.createLinearGradient(f.x, f.y,
            f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r);
          g.addColorStop(0, t.colorSecondary);
          g.addColorStop(1, t.colorPrimary);
          ctx.fillStyle = g;
          ctx.fill();
          /* pale star at the base of each petal, as in the real flower */
          ctx.beginPath();
          ctx.arc(f.x + Math.cos(a) * f.r * 0.3, f.y + Math.sin(a) * f.r * 0.3, f.r * 0.09, 0, TAU);
          ctx.fillStyle = 'rgba(240,240,255,0.7)';
          ctx.fill();
        }
        /* the fused anther cone that holds the pollen hostage */
        ctx.beginPath();
        ctx.moveTo(f.x - f.r * 0.17, f.y);
        ctx.lineTo(f.x + f.r * 0.17, f.y);
        ctx.lineTo(f.x + f.r * 0.07, f.y + f.r * 1.05);
        ctx.lineTo(f.x - f.r * 0.07, f.y + f.r * 1.05);
        ctx.closePath();
        var cg = ctx.createLinearGradient(f.x - f.r * 0.2, f.y, f.x + f.r * 0.2, f.y);
        cg.addColorStop(0, '#c99b1c');
        cg.addColorStop(0.45, t.throatColor);
        cg.addColorStop(1, '#b8890f');
        ctx.fillStyle = cg;
        ctx.fill();
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = 'rgba(120,90,10,0.6)';
        ctx.stroke();
      }
      out.anchorX = heads[0].x - w / 2;
      out.anchorY = heads[0].y + heads[0].r * 0.5 - h;
    },

    spike: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      var spikeTop = h * 0.12, spikeBot = h * 0.46;
      stem(ctx, bx, by, bx, spikeBot, (rng() * 2 - 1) * 5, 2.6, t.stemColor);
      for (var l = 0; l < 4; l++) {
        var ly = by - h * (0.06 + l * 0.07);
        leaf(ctx, bx, ly, h * 0.1, l % 2 ? -0.5 : Math.PI + 0.5, '#7d8a6a', '#5f6b4c');
      }
      /* whorls of small tubular florets up the spike */
      var whorls = 8;
      for (var i = 0; i < whorls; i++) {
        var ty = spikeBot - (spikeBot - spikeTop) * (i / (whorls - 1));
        var scale = 1 - i / whorls * 0.45;
        /* bract */
        ctx.beginPath();
        ctx.moveTo(bx - 6 * scale, ty + 4);
        ctx.lineTo(bx, ty - 3);
        ctx.lineTo(bx + 6 * scale, ty + 4);
        ctx.closePath();
        ctx.fillStyle = '#6d6a8a';
        ctx.fill();
        var per = i < whorls - 2 ? 3 : 2;
        for (var f = 0; f < per; f++) {
          var side = (f - (per - 1) / 2);
          var fx = bx + side * 8 * scale;
          var fy = ty - 2;
          petalPath(ctx, fx, fy, -Math.PI / 2 + side * 0.5, 11 * scale, 4 * scale, 0.5);
          var g = ctx.createLinearGradient(fx, fy + 6, fx, fy - 8);
          g.addColorStop(0, t.colorSecondary);
          g.addColorStop(1, t.colorPrimary);
          ctx.fillStyle = g;
          ctx.fill();
          if (i < 4) {
            ctx.beginPath();
            ctx.arc(fx, fy - 8 * scale, 1.2, 0, TAU);
            ctx.fillStyle = t.throatColor;
            ctx.fill();
          }
        }
      }
      out.anchorX = 0;
      out.anchorY = (spikeBot + spikeTop) / 2 - h;
    },

    bugloss: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      stem(ctx, bx, by, bx + (rng() * 2 - 1) * 8, h * 0.14, (rng() * 2 - 1) * 10, 3.4, t.stemColor);
      /* bristles: this plant is famously rough to the touch */
      for (var b = 0; b < 26; b++) {
        var byy = by - rng() * h * 0.8;
        var side = rng() < 0.5 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(bx + side * 1.6, byy);
        ctx.lineTo(bx + side * 5, byy - 2);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(150,160,120,0.75)';
        ctx.stroke();
      }
      leaf(ctx, bx, by - h * 0.1, h * 0.16, -0.25, '#6d7a4e', '#4f5a36');
      leaf(ctx, bx, by - h * 0.22, h * 0.13, Math.PI + 0.3, '#77855a', '#4f5a36');

      var branches = 5;
      var firstX = null, firstY = null;
      for (var i = 0; i < branches; i++) {
        var side2 = i % 2 ? 1 : -1;
        var byy2 = h * (0.2 + i * 0.11);
        var bxx = bx + side2 * (10 + rng() * 8);
        stem(ctx, bx, byy2 + 10, bxx, byy2, side2 * 4, 1.8, t.stemColor);
        var per = 3;
        for (var f = 0; f < per; f++) {
          var fx = bxx + side2 * f * 7;
          var fy = byy2 - f * 5;
          var isBud = f === per - 1;
          /* funnel of five unequal lobes */
          for (var p = 0; p < 5; p++) {
            var a = -Math.PI / 2 + p * TAU / 5 + side2 * 0.4;
            petalPath(ctx, fx, fy, a, 7.5, 3.4, 0.6);
            ctx.fillStyle = isBud ? '#c876a8' : (p < 2 ? t.colorSecondary : t.colorPrimary);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(fx, fy, 2.2, 0, TAU);
          ctx.fillStyle = t.throatColor;
          ctx.fill();
          if (!isBud) {
            /* long red stamens sticking straight out of the throat */
            for (var s = 0; s < 4; s++) {
              var sa = -1.4 + s * 0.28 + side2 * 0.3;
              ctx.beginPath();
              ctx.moveTo(fx, fy);
              ctx.lineTo(fx + Math.cos(sa) * 11, fy + Math.sin(sa) * 11);
              ctx.lineWidth = 0.9;
              ctx.strokeStyle = '#c0407a';
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(fx + Math.cos(sa) * 11, fy + Math.sin(sa) * 11, 1.3, 0, TAU);
              ctx.fillStyle = t.pollenColor;
              ctx.fill();
            }
            if (firstX === null) { firstX = fx; firstY = fy; }
          }
        }
      }
      out.anchorX = (firstX === null ? bx : firstX) - w / 2;
      out.anchorY = (firstY === null ? h * 0.3 : firstY) - h;
    },

    bell_cluster: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      var topY = h * 0.2;
      stem(ctx, bx, by, bx + 6, topY + 10, -10, 5.0, t.stemColor);
      leaf(ctx, bx, by - h * 0.14, h * 0.26, -0.3, '#5c7040', '#3f512a');
      leaf(ctx, bx, by - h * 0.36, h * 0.21, Math.PI + 0.32, '#68804a', '#3f512a');
      leaf(ctx, bx + 3, by - h * 0.55, h * 0.15, -0.42, '#6f8850', '#3f512a');

      /* a one-sided curling cyme of hanging tubes */
      var n = 7, anchorSet = false;
      for (var i = 0; i < n; i++) {
        var tt = i / (n - 1);
        var cx = bx + 6 + Math.sin(tt * 2.4) * 22;
        var cy = topY + 12 + tt * h * 0.2;
        var len = 20 - tt * 6;
        var wid = 8.5 - tt * 2.2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(0.35 + tt * 0.25);
        /* tube */
        ctx.beginPath();
        ctx.moveTo(-wid * 0.45, 0);
        ctx.bezierCurveTo(-wid * 0.6, len * 0.55, -wid * 0.75, len * 0.85, -wid * 0.62, len);
        ctx.lineTo(wid * 0.62, len);
        ctx.bezierCurveTo(wid * 0.75, len * 0.85, wid * 0.6, len * 0.55, wid * 0.45, 0);
        ctx.closePath();
        var g = ctx.createLinearGradient(-wid, 0, wid, len);
        g.addColorStop(0, t.colorSecondary);
        g.addColorStop(0.5, t.colorPrimary);
        g.addColorStop(1, '#8f74b0');
        ctx.fillStyle = g;
        ctx.fill();
        /* flared mouth, dark inside - this is the depth cue */
        ctx.beginPath();
        ctx.ellipse(0, len, wid * 0.66, wid * 0.3, 0, 0, TAU);
        ctx.fillStyle = 'rgba(48,30,62,0.85)';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, len - 1, wid * 0.66, wid * 0.28, 0, Math.PI, TAU);
        ctx.fillStyle = t.throatColor;
        ctx.fill();
        /* calyx */
        ctx.beginPath();
        ctx.moveTo(-wid * 0.5, 2);
        ctx.lineTo(0, -5);
        ctx.lineTo(wid * 0.5, 2);
        ctx.closePath();
        ctx.fillStyle = '#5f7444';
        ctx.fill();
        ctx.restore();
        if (!anchorSet && i >= 1) {
          out.anchorX = cx - w / 2;
          out.anchorY = cy + len - h;
          anchorSet = true;
        }
      }
      if (!anchorSet) { out.anchorX = 6; out.anchorY = topY - h; }
    },

    foxglove: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      var topY = h * 0.06;
      stem(ctx, bx, by, bx + (rng() * 2 - 1) * 10, topY, (rng() * 2 - 1) * 8, 6.0, t.stemColor);
      leaf(ctx, bx, by - h * 0.04, h * 0.2, -0.22, '#55703a', '#3b5127');
      leaf(ctx, bx, by - h * 0.16, h * 0.16, Math.PI + 0.25, '#5f7a42', '#3b5127');

      /* the classic one-sided spike: big open bells low down, buds at the tip */
      var n = 10, anchorSet = false;
      for (var i = 0; i < n; i++) {
        var tt = i / (n - 1);
        var cy = h * 0.62 - tt * h * 0.52;
        var cx = bx + 4 + Math.sin(i * 1.7) * 4;
        var open = tt < 0.72;
        var len = (44 - tt * 26);
        var wid = (20 - tt * 12);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(0.72 - tt * 0.15);

        if (!open) {
          /* unopened bud */
          ctx.beginPath();
          ctx.ellipse(0, len * 0.3, wid * 0.34, len * 0.3, 0, 0, TAU);
          ctx.fillStyle = '#a2568c';
          ctx.fill();
          ctx.restore();
          continue;
        }

        /* the bell */
        ctx.beginPath();
        ctx.moveTo(-wid * 0.30, 0);
        ctx.bezierCurveTo(-wid * 0.52, len * 0.4, -wid * 0.60, len * 0.78, -wid * 0.50, len);
        ctx.bezierCurveTo(-wid * 0.2, len * 1.14, wid * 0.28, len * 1.12, wid * 0.50, len);
        ctx.bezierCurveTo(wid * 0.60, len * 0.78, wid * 0.52, len * 0.4, wid * 0.30, 0);
        ctx.closePath();
        var g = ctx.createLinearGradient(-wid * 0.6, 0, wid * 0.6, len);
        g.addColorStop(0, t.colorSecondary);
        g.addColorStop(0.45, t.colorPrimary);
        g.addColorStop(1, '#e0a3c8');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(120,50,100,0.4)';
        ctx.stroke();

        /* pale spotted throat - a landing runway painted for bumblebees */
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, len * 0.92, wid * 0.46, wid * 0.3, 0, 0, TAU);
        ctx.fillStyle = t.throatColor;
        ctx.fill();
        ctx.clip();
        for (var s = 0; s < 11; s++) {
          var sx = (rng() * 2 - 1) * wid * 0.36;
          var sy = len * 0.92 + (rng() * 2 - 1) * wid * 0.22;
          var sr = 1.1 + rng() * 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, sr + 0.9, 0, TAU);
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx, sy, sr, 0, TAU);
          ctx.fillStyle = '#8e2f5c';
          ctx.fill();
        }
        ctx.restore();

        /* the dark mouth you have to crawl into */
        ctx.beginPath();
        ctx.ellipse(0, len * 1.02, wid * 0.4, wid * 0.15, 0, 0, TAU);
        ctx.fillStyle = 'rgba(58,20,44,0.7)';
        ctx.fill();

        ctx.restore();

        if (!anchorSet && tt > 0.05) {
          out.anchorX = cx - w / 2;
          out.anchorY = cy + len * 0.95 - h;
          anchorSet = true;
        }
      }
      if (!anchorSet) { out.anchorX = 0; out.anchorY = h * 0.55 - h; }
    },

    honeysuckle: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      var topY = h * 0.16;
      stem(ctx, bx, by, bx + 10, topY + 14, 16, 3.6, '#6a5a3e');
      /* paired oval leaves up a twining stem */
      for (var l = 0; l < 4; l++) {
        var ly = by - h * (0.12 + l * 0.17);
        leaf(ctx, bx + l * 2, ly, h * 0.11, -0.15, '#5e7444', '#42542e');
        leaf(ctx, bx + l * 2, ly, h * 0.1, Math.PI + 0.15, '#688050', '#42542e');
      }
      /* a terminal whorl of long curved trumpets */
      var cx = bx + 12, cy = topY + 12;
      var n = 6, anchorSet = false;
      for (var i = 0; i < n; i++) {
        var a = -Math.PI * 0.92 + i * (Math.PI * 1.15 / (n - 1));
        var len = 34 + rng() * 8;
        var ex = cx + Math.cos(a) * len;
        var ey = cy + Math.sin(a) * len;
        /* tube */
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(
          cx + Math.cos(a) * len * 0.6 - Math.sin(a) * 6,
          cy + Math.sin(a) * len * 0.6 + Math.cos(a) * 6,
          ex, ey);
        ctx.lineWidth = 4.2;
        ctx.strokeStyle = i % 2 ? t.colorSecondary : t.colorPrimary;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = 'rgba(255,250,232,0.8)';
        ctx.stroke();
        /* two flared lips at the mouth */
        petalPath(ctx, ex, ey, a - 0.5, 11, 4, 0.4);
        ctx.fillStyle = t.throatColor;
        ctx.fill();
        petalPath(ctx, ex, ey, a + 0.55, 9, 3.4, 0.4);
        ctx.fillStyle = '#f2e2c4';
        ctx.fill();
        /* long stamens and style projecting well beyond the mouth */
        for (var s = 0; s < 5; s++) {
          var sa = a - 0.22 + s * 0.11;
          var sl = 15 + rng() * 5;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex + Math.cos(sa) * sl, ey + Math.sin(sa) * sl);
          ctx.lineWidth = 0.9;
          ctx.strokeStyle = '#efe0bc';
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex + Math.cos(sa) * sl, ey + Math.sin(sa) * sl, 1.4, 0, TAU);
          ctx.fillStyle = t.pollenColor;
          ctx.fill();
        }
        if (!anchorSet && i === 2) {
          out.anchorX = ex - w / 2;
          out.anchorY = ey - h;
          anchorSet = true;
        }
      }
      if (!anchorSet) { out.anchorX = 12; out.anchorY = cy - h; }
    },

    fuchsia: function (ctx, t, rng, w, h, out) {
      var bx = w / 2, by = h;
      var topY = h * 0.16;
      stem(ctx, bx, by, bx + (rng() * 2 - 1) * 8, topY, -12, 4.6, '#7a5c48');
      for (var l = 0; l < 4; l++) {
        var ly = by - h * (0.16 + l * 0.16);
        leaf(ctx, bx, ly, h * 0.13, -0.28, '#5d7346', '#41522f');
        leaf(ctx, bx, ly - h * 0.05, h * 0.11, Math.PI + 0.28, '#6a8050', '#41522f');
      }
      /* hanging flowers: reflexed red sepals over a purple corolla skirt,
         with the stamens and style dangling well below */
      var spots = [
        { x: bx - 16, y: topY + h * 0.10, s: 1.0 },
        { x: bx + 14, y: topY + h * 0.19, s: 0.86 },
        { x: bx - 4, y: topY + h * 0.30, s: 0.74 }
      ];
      for (var i = 0; i < spots.length; i++) {
        var f = spots[i], sc = f.s;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.scale(sc, sc);
        /* pedicel */
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(0, 0);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#8a5a4a';
        ctx.stroke();
        /* tube */
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.bezierCurveTo(-5, 9, -6, 14, -5, 17);
        ctx.lineTo(5, 17);
        ctx.bezierCurveTo(6, 14, 5, 9, 4, 0);
        ctx.closePath();
        ctx.fillStyle = t.colorPrimary;
        ctx.fill();
        /* four sepals swept sharply back and upward */
        for (var p = 0; p < 4; p++) {
          var a = -Math.PI / 2 + (p - 1.5) * 0.42;
          petalPath(ctx, 0, 15, a, 21, 6.5, 0.25);
          var g = ctx.createLinearGradient(0, 15, Math.cos(a) * 21, 15 + Math.sin(a) * 21);
          g.addColorStop(0, '#e8506f');
          g.addColorStop(1, t.colorPrimary);
          ctx.fillStyle = g;
          ctx.fill();
        }
        /* the purple corolla skirt hanging underneath */
        ctx.beginPath();
        ctx.moveTo(-7, 16);
        ctx.bezierCurveTo(-11, 24, -9, 33, -4, 35);
        ctx.bezierCurveTo(0, 37, 2, 37, 5, 35);
        ctx.bezierCurveTo(10, 32, 11, 23, 7, 16);
        ctx.closePath();
        var cg = ctx.createLinearGradient(0, 16, 0, 36);
        cg.addColorStop(0, '#8a5cc4');
        cg.addColorStop(1, t.colorSecondary);
        ctx.fillStyle = cg;
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(60,30,90,0.5)';
        ctx.stroke();
        /* eight stamens plus a longer style */
        for (var s = 0; s < 8; s++) {
          var sx = -5 + s * 1.4;
          var sl = 46 + (s % 3) * 6;
          ctx.beginPath();
          ctx.moveTo(sx * 0.4, 30);
          ctx.quadraticCurveTo(sx, 40, sx * 1.3, sl);
          ctx.lineWidth = 1.0;
          ctx.strokeStyle = '#e87290';
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sx * 1.3, sl, 1.6, 0, TAU);
          ctx.fillStyle = t.pollenColor;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(0, 32);
        ctx.quadraticCurveTo(2, 48, 1, 60);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#f0a0b8';
        ctx.stroke();
        ctx.restore();

        if (i === 0) {
          /* the bee hangs under the tube mouth to reach in */
          out.anchorX = f.x + 0 - w / 2;
          out.anchorY = f.y + 17 * sc - h;
        }
      }
    }
  };

  function flowerSprite(typeId, variant) {
    var key = typeId + ':' + variant;
    if (flowerCache[key]) return flowerCache[key];

    var t = BB.getFlowerType(typeId);
    var h = t.heightPx;
    var w = Math.max(120, h * 0.62);
    var buf = U.makeCanvas(w, h + 4);
    var rng = U.makeRng((typeId.charCodeAt(0) * 3571 + variant * 9176) >>> 0);
    var out = { anchorX: 0, anchorY: -h * 0.8 };

    buf.ctx.lineJoin = 'round';
    var draw = FLOWER_DRAW[t.shape];
    if (draw) draw(buf.ctx, t, rng, w, h, out);

    var sprite = {
      canvas: buf.canvas,
      w: w, h: h + 4,
      /* origin is bottom-centre: the point the plant is rooted at */
      ox: w / 2, oy: h,
      anchorX: out.anchorX,
      anchorY: out.anchorY
    };
    flowerCache[key] = sprite;
    return sprite;
  }

  /* ==================================================================== */
  /*  Background layers                                                   */
  /* ==================================================================== */

  var STRIP_W = 2048;

  function farHills() {
    if (layerCache.farHills) return layerCache.farHills;
    var buf = U.makeCanvas(STRIP_W, 420);
    var c = buf.ctx;
    var rng = U.makeRng(0x1234);
    for (var layer = 0; layer < 3; layer++) {
      var baseY = 150 + layer * 70;
      var amp = 70 - layer * 16;
      c.beginPath();
      c.moveTo(0, 420);
      for (var x = 0; x <= STRIP_W; x += 8) {
        var y = baseY
          + Math.sin(x / 420 + layer * 2.1) * amp
          + Math.sin(x / 137 + layer * 5.7) * amp * 0.3
          + Math.sin(x / 61 + layer) * amp * 0.1;
        c.lineTo(x, y);
      }
      c.lineTo(STRIP_W, 420);
      c.closePath();
      var g = c.createLinearGradient(0, baseY - amp, 0, 420);
      var l = 62 - layer * 9;
      g.addColorStop(0, U.hsl(155 + layer * 6, 18 + layer * 5, l, 1));
      g.addColorStop(1, U.hsl(150 + layer * 6, 22 + layer * 5, l - 12, 1));
      c.fillStyle = g;
      c.fill();
      /* a few hedge lines to give the hills scale */
      if (layer === 2) {
        for (var k = 0; k < 40; k++) {
          var hx = rng() * STRIP_W;
          c.beginPath();
          c.moveTo(hx, 240 + rng() * 100);
          c.lineTo(hx + 30 + rng() * 60, 250 + rng() * 100);
          c.lineWidth = 2;
          c.strokeStyle = 'rgba(40,60,35,0.25)';
          c.stroke();
        }
      }
    }
    layerCache.farHills = buf.canvas;
    return buf.canvas;
  }

  /* The hedgerow behind the meadow.
     This layer has to be genuinely opaque: it is what stops the player seeing
     sky through the ground between the horizon and the flowers. So the mass is
     filled solid first, and only then textured with leaves. */
  function treeLine() {
    if (layerCache.treeLine) return layerCache.treeLine;
    var H = 520;
    var buf = U.makeCanvas(STRIP_W, H);
    var c = buf.ctx;
    var rng = U.makeRng(0xbeef);

    /* An irregular top edge, built from a few sine terms so it never repeats
       visibly across the tile. */
    function edgeY(x) {
      return 214 +
        Math.sin(x / 191) * 44 +
        Math.sin(x / 71 + 1.7) * 21 +
        Math.sin(x / 33 + 4.1) * 9;
    }

    c.beginPath();
    c.moveTo(0, H);
    for (var x = 0; x <= STRIP_W; x += 6) c.lineTo(x, edgeY(x));
    c.lineTo(STRIP_W, H);
    c.closePath();
    var g = c.createLinearGradient(0, 150, 0, H);
    g.addColorStop(0, '#426032');
    g.addColorStop(0.45, '#2f4a26');
    g.addColorStop(1, '#1d3118');
    c.fillStyle = g;
    c.fill();

    /* A handful of taller trees standing out of the hedge. */
    for (var t = 0; t < 10; t++) {
      var tx = (t + 0.15 + rng() * 0.7) * (STRIP_W / 10);
      var crownY = 78 + rng() * 62;
      c.beginPath();
      c.moveTo(tx, H);
      c.quadraticCurveTo(tx + (rng() * 2 - 1) * 12, (H + crownY) / 2,
        tx + (rng() * 2 - 1) * 20, crownY + 46);
      c.lineWidth = 6 + rng() * 7;
      c.strokeStyle = 'rgba(48,39,30,0.9)';
      c.lineCap = 'round';
      c.stroke();

      /* Build the crown from several overlapping lobes. One even disc of
         leaves gives a lollipop; real canopies are lumpy. */
      var cr = 52 + rng() * 38;
      var lobes = [];
      var nLobes = 4 + Math.floor(rng() * 3);
      for (var lo = 0; lo < nLobes; lo++) {
        lobes.push({
          x: tx + (rng() * 2 - 1) * cr * 0.68,
          y: crownY + 34 + (rng() * 2 - 1) * cr * 0.44,
          r: cr * (0.42 + rng() * 0.42)
        });
      }
      for (var i = 0; i < 340; i++) {
        var lb = lobes[Math.floor(rng() * lobes.length)];
        var a = rng() * TAU, rr = Math.sqrt(rng()) * lb.r;
        var bx = lb.x + Math.cos(a) * rr;
        var by = lb.y + Math.sin(a) * rr * 0.82;
        var r = 3 + rng() * 5;
        /* Leaves lower in the crown sit in its shade. */
        var shade = U.clamp((by - crownY) / (cr * 1.6), 0, 1);
        c.beginPath();
        c.ellipse(bx, by, r, r * (0.62 + rng() * 0.5), rng() * TAU, 0, TAU);
        c.fillStyle = U.hsl(94 + rng() * 32, 28 + rng() * 26,
          26 - shade * 12 + rng() * 12, 0.95);
        c.fill();
      }
    }

    /* Leaf texture, concentrated near the top edge so the silhouette breaks up
       into foliage instead of staying a clean curve. */
    for (var k = 0; k < 5200; k++) {
      var lx = rng() * STRIP_W;
      var top = edgeY(lx);
      var depth = Math.pow(rng(), 1.8) * 210;
      var ly = top + depth - 12;
      var r2 = 2.6 + rng() * 4.2;
      c.beginPath();
      c.ellipse(lx, ly, r2, r2 * (0.6 + rng() * 0.5), rng() * TAU, 0, TAU);
      c.fillStyle = U.hsl(92 + rng() * 34, 26 + rng() * 28, 14 + rng() * 24, 0.9);
      c.fill();
    }

    layerCache.treeLine = buf.canvas;
    return buf.canvas;
  }

  function grassStrip(key, height, count, hueLo, hueHi, litLo, litHi, alpha, bladeLen) {
    if (layerCache[key]) return layerCache[key];
    var buf = U.makeCanvas(STRIP_W, height);
    var c = buf.ctx;
    var rng = U.makeRng(key.length * 7919 + height);
    c.lineCap = 'round';
    for (var i = 0; i < count; i++) {
      var x = rng() * STRIP_W;
      var len = bladeLen * (0.5 + rng() * 0.9);
      var lean = (rng() * 2 - 1) * len * 0.42;
      c.beginPath();
      c.moveTo(x, height);
      c.quadraticCurveTo(x + lean * 0.35, height - len * 0.6, x + lean, height - len);
      c.lineWidth = 1.1 + rng() * 1.9;
      c.strokeStyle = U.hsl(
        hueLo + rng() * (hueHi - hueLo),
        34 + rng() * 26,
        litLo + rng() * (litHi - litLo),
        alpha);
      c.stroke();
    }
    layerCache[key] = buf.canvas;
    return buf.canvas;
  }

  function midGrass() { return grassStrip('midGrass', 300, 2000, 88, 128, 24, 42, 0.92, 190); }
  /* Deliberately sparse and semi-transparent: this layer sits in front of the
     bee, and dense grass here hides the whole game. */
  function foreGrass() { return grassStrip('foreGrass', 230, 620, 82, 118, 12, 26, 0.7, 190); }

  function groundStrip() {
    if (layerCache.ground) return layerCache.ground;
    var buf = U.makeCanvas(STRIP_W, 260);
    var c = buf.ctx;
    var rng = U.makeRng(0x50ed);
    var g = c.createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, '#4a6b32');
    g.addColorStop(0.16, '#3c5628');
    g.addColorStop(0.5, '#4a3a26');
    g.addColorStop(1, '#33281a');
    c.fillStyle = g;
    c.fillRect(0, 0, STRIP_W, 260);
    /* pebbles and root flecks */
    for (var i = 0; i < 1400; i++) {
      var x = rng() * STRIP_W, y = 30 + rng() * 226;
      c.beginPath();
      c.ellipse(x, y, 1 + rng() * 3.4, 0.8 + rng() * 2.2, rng() * TAU, 0, TAU);
      c.fillStyle = U.hsl(28 + rng() * 30, 12 + rng() * 22, 14 + rng() * 22, 0.5);
      c.fill();
    }
    /* turf fringe along the top edge */
    for (var b = 0; b < 1800; b++) {
      var bx = rng() * STRIP_W;
      var bl = 8 + rng() * 22;
      c.beginPath();
      c.moveTo(bx, 12);
      c.quadraticCurveTo(bx + (rng() * 2 - 1) * 5, 12 - bl * 0.6, bx + (rng() * 2 - 1) * 9, 12 - bl);
      c.lineWidth = 1 + rng() * 1.6;
      c.strokeStyle = U.hsl(92 + rng() * 32, 38 + rng() * 22, 24 + rng() * 18, 0.95);
      c.stroke();
    }
    layerCache.ground = buf.canvas;
    return buf.canvas;
  }

  function cloudSprite(index) {
    var key = 'cloud' + index;
    if (layerCache[key]) return layerCache[key];
    var w = 460, h = 200;
    var buf = U.makeCanvas(w, h);
    var c = buf.ctx;
    var rng = U.makeRng(0xc10d + index * 977);
    for (var i = 0; i < 16; i++) {
      var cx = w * (0.14 + rng() * 0.72);
      var cy = h * (0.42 + rng() * 0.34);
      var r = 30 + rng() * 62;
      var g = c.createRadialGradient(cx, cy - r * 0.25, r * 0.15, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.92)');
      g.addColorStop(0.6, 'rgba(246,248,252,0.55)');
      g.addColorStop(1, 'rgba(240,244,250,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, r, 0, TAU);
      c.fill();
    }
    layerCache[key] = buf.canvas;
    return buf.canvas;
  }

  function starStrip() {
    if (layerCache.stars) return layerCache.stars;
    var buf = U.makeCanvas(STRIP_W, 700);
    var c = buf.ctx;
    var rng = U.makeRng(0x57a5);
    for (var i = 0; i < 460; i++) {
      var x = rng() * STRIP_W, y = rng() * 700;
      var r = rng() < 0.9 ? 0.6 + rng() * 0.8 : 1.4 + rng();
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fillStyle = 'rgba(255,255,255,' + (0.25 + rng() * 0.7).toFixed(2) + ')';
      c.fill();
    }
    layerCache.stars = buf.canvas;
    return buf.canvas;
  }

  /* The nest: a mossy tussock with a dark hole at its base. */
  function nestSprite() {
    if (layerCache.nest) return layerCache.nest;
    var w = 300, h = 190;
    var buf = U.makeCanvas(w, h);
    var c = buf.ctx;
    var rng = U.makeRng(0x9e57);
    /* mound */
    c.beginPath();
    c.moveTo(0, h);
    c.bezierCurveTo(w * 0.12, h * 0.42, w * 0.36, h * 0.12, w * 0.52, h * 0.14);
    c.bezierCurveTo(w * 0.72, h * 0.16, w * 0.9, h * 0.5, w, h);
    c.closePath();
    var g = c.createLinearGradient(0, h * 0.1, 0, h);
    g.addColorStop(0, '#5d7a3e');
    g.addColorStop(0.55, '#46602e');
    g.addColorStop(1, '#3a2c1e');
    c.fillStyle = g;
    c.fill();
    /* moss tufts */
    for (var i = 0; i < 1500; i++) {
      var x = rng() * w;
      var top = h - Math.sin((x / w) * Math.PI) * h * 0.82;
      var y = top + rng() * (h - top);
      if (y > h) continue;
      var len = 5 + rng() * 13;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + (rng() * 2 - 1) * 4, y - len * 0.6, x + (rng() * 2 - 1) * 7, y - len);
      c.lineWidth = 0.9 + rng() * 1.4;
      c.strokeStyle = U.hsl(88 + rng() * 36, 34 + rng() * 26, 20 + rng() * 20, 0.85);
      c.stroke();
    }
    /* the entrance */
    var hx = w * 0.5, hy = h * 0.80;
    c.beginPath();
    c.ellipse(hx, hy, 25, 17, -0.12, 0, TAU);
    var hg = c.createRadialGradient(hx, hy - 4, 2, hx, hy, 26);
    hg.addColorStop(0, '#000000');
    hg.addColorStop(0.7, '#120d07');
    hg.addColorStop(1, '#2b1f12');
    c.fillStyle = hg;
    c.fill();
    /* worn earth lip around it */
    c.beginPath();
    c.ellipse(hx, hy + 10, 32, 10, 0, 0, Math.PI);
    c.fillStyle = 'rgba(88,68,44,0.6)';
    c.fill();

    layerCache.nest = buf.canvas;
    return { canvas: buf.canvas, w: w, h: h, holeX: hx, holeY: hy };
  }

  /* ==================================================================== */

  BB.Art = {
    SS: SS,
    BASE_LEN: BASE_LEN,
    STRIP_W: STRIP_W,
    bakeBee: bakeBee,
    flowerSprite: flowerSprite,
    farHills: farHills,
    treeLine: treeLine,
    midGrass: midGrass,
    foreGrass: foreGrass,
    groundStrip: groundStrip,
    cloudSprite: cloudSprite,
    starStrip: starStrip,
    nestSprite: nestSprite,
    petalPath: petalPath,
    leaf: leaf,
    stem: stem,
    /* Used by the self test to prove nothing baked into an empty canvas. */
    _caches: { bee: beeCache, flower: flowerCache, layer: layerCache }
  };

})(window.BB = window.BB || {});
