/* Bumblebee Simulator - the meadow, the sky and the weather.
 *
 * The world is a side-on cross-section: x runs across the meadow, y is height
 * with the ground at GROUND_Y and smaller y meaning higher up. Seeing the
 * meadow in profile is what makes the flowers readable - you can see how deep a
 * foxglove bell actually is, and watch the proboscis go into it.
 */
(function (BB) {
  'use strict';

  var U = BB.Util;
  var Art = BB.Art;
  var TAU = U.TAU;

  var WIDTH = BB.WORLD_WIDTH;
  var GROUND_Y = 1200;
  var CEILING_Y = -520;
  var BUCKET = 256;

  var START_HOUR = 5.0;
  var END_HOUR = 21.0;
  var DAY_SECONDS = U.paramNum('daylen', 240);

  /* Seven authored days. The arc deliberately puts each species in and out of
     its comfort zone: day 4 is a cold snap that only the buff-tailed bumblebee
     enjoys, day 6 is a heatwave that punishes the Patagonian giant. */
  var DAY_SCRIPTS = [
    { tempMin: 7,  tempMax: 23, cloud: 0.18, wind: 0.30, rain: null,          birds: 1, label: 'Clear and still', forecast: 'A gentle first day. Warm by mid-morning.' },
    { tempMin: 8,  tempMax: 22, cloud: 0.34, wind: 1.00, rain: null,          birds: 1, label: 'Blustery',        forecast: 'Strong gusts tomorrow. Small species will be thrown about.' },
    { tempMin: 9,  tempMax: 20, cloud: 0.58, wind: 0.60, rain: [14.2, 16.4],  birds: 1, label: 'Rain by afternoon', forecast: 'Rain in the afternoon. Find shelter under a flower head.' },
    { tempMin: 4,  tempMax: 14, cloud: 0.50, wind: 0.50, rain: null,          birds: 1, label: 'Cold snap',      forecast: 'A cold snap. Warming your flight muscles will cost you.' },
    { tempMin: 10, tempMax: 24, cloud: 0.20, wind: 0.40, rain: null,          birds: 2, label: 'Spraying day',   forecast: 'The crop strip has been sprayed again. Its nectar is rich and poisoned.' },
    { tempMin: 14, tempMax: 32, cloud: 0.10, wind: 0.30, rain: null,          birds: 2, label: 'Heatwave',       forecast: 'A heatwave. Large dark bees will overheat.' },
    { tempMin: 8,  tempMax: 21, cloud: 0.45, wind: 0.80, rain: [17.6, 19.2],  birds: 3, label: 'The last long day', forecast: 'The last day of the season.' }
  ];

  /* Sky colours through the day: [hour, top, middle, horizon]. */
  var SKY_KEYFRAMES = [
    [0.0,  '#05070f', '#0b1220', '#131c2e'],
    [4.4,  '#0d1430', '#2a2a4a', '#4a3a52'],
    [5.4,  '#1e3a5f', '#7a5a7a', '#e8956b'],
    [6.6,  '#3d6b9e', '#9dbdd6', '#f5c58a'],
    [9.0,  '#4a86c8', '#8fbde0', '#cfe4ef'],
    [13.0, '#3f7fd0', '#7fb4e6', '#c7dff2'],
    [17.0, '#4a7fbe', '#94bcdc', '#dcd6c4'],
    [19.4, '#2a4a7a', '#c9705a', '#f2a15c'],
    [20.6, '#16203f', '#4a3a5e', '#8a5a62'],
    [21.6, '#070a16', '#0d1424', '#1a2236'],
    [24.0, '#05070f', '#0b1220', '#131c2e']
  ].map(function (k) {
    return { hour: k[0], top: U.hexToRgb(k[1]), mid: U.hexToRgb(k[2]), horizon: U.hexToRgb(k[3]) };
  });

  /* ==================================================================== */

  var state = {
    day: 1,
    script: DAY_SCRIPTS[0],
    elapsed: 0,
    hour: START_HOUR,
    dayOver: false,
    airTempC: 10,
    isRaining: false,
    rainIntensity: 0,
    rainWarned: false,
    wind: 0,
    gust: 0,
    gustTimer: 6,
    light: { elev: 0, intensity: 0, warmth: 1, dirX: -0.5, dirY: -0.87, tint: [0, 0, 0], tintAlpha: 0, night: 1 },
    plants: [],
    bgPlants: [],
    fgPlants: [],
    buckets: {},
    nest: null,
    seed: 1
  };

  var windNoise = U.makeNoise1D(0x5eed);
  var cloudDrift = 0;
  var renderClock = 0;

  /* -------------------------------------------------------- world build ---- */

  function makePlant(rng, typeId, x, layer) {
    var type = BB.getFlowerType(typeId);
    var variant = U.randInt(rng, 0, type.variants - 1);
    var sprite = Art.flowerSprite(typeId, variant);
    var zone = BB.zoneAt(x);
    var scale = layer === 'plants' ? U.rand(rng, 0.86, 1.12)
      : (layer === 'bg' ? U.rand(rng, 0.62, 0.82) : U.rand(rng, 1.16, 1.34));

    var plant = {
      typeId: typeId,
      type: type,
      x: x,
      baseY: GROUND_Y + U.rand(rng, -6, 10),
      variant: variant,
      sprite: sprite,
      scale: scale,
      phase: rng() * TAU,
      layer: layer,
      sprayed: !!zone.sprayed,
      nectarMax: type.nectarPool * (zone.sprayed ? 2 : 1),
      nectar: type.nectarPool * (zone.sprayed ? 2 : 1) * U.rand(rng, 0.55, 1),
      pollenLeft: type.pollenMg,
      spider: null,
      robbed: false,
      visits: 0,
      pollinated: false,
      anchorX: sprite.anchorX,
      anchorY: sprite.anchorY,
      /* Tall plants shelter a bee from rain and hide it from birds. */
      shelters: type.heightPx >= 170
    };
    return plant;
  }

  function buildWorld(seed, day) {
    var rng = U.makeRng(seed);
    state.plants = [];
    state.bgPlants = [];
    state.fgPlants = [];

    BB.ZONES.forEach(function (zone) {
      var x, ids = zone.flowers;

      /* the interactive band */
      for (x = zone.from + 20; x < zone.to; x += zone.spacing * U.rand(rng, 0.7, 1.3)) {
        var pickId = U.weightedPick(rng, ids, function (e) { return e[1]; })[0];
        state.plants.push(makePlant(rng, pickId, x + U.rand(rng, -12, 12), 'plants'));
      }
      /* hazier plants behind, purely for depth */
      for (x = zone.from; x < zone.to; x += zone.spacing * U.rand(rng, 1.1, 1.9)) {
        var bgId = U.weightedPick(rng, ids, function (e) { return e[1]; })[0];
        state.bgPlants.push(makePlant(rng, bgId, x + U.rand(rng, -20, 20), 'bg'));
      }
      /* a sparse screen of plants in front of the bee */
      for (x = zone.from; x < zone.to; x += zone.spacing * U.rand(rng, 2.6, 4.4)) {
        var fgId = U.weightedPick(rng, ids, function (e) { return e[1]; })[0];
        state.fgPlants.push(makePlant(rng, fgId, x + U.rand(rng, -20, 20), 'fg'));
      }
    });

    /* Spatial buckets over the landable plants, so finding the flower nearest
       the bee never walks the whole meadow. */
    state.buckets = {};
    state.plants.forEach(function (p, i) {
      var b = Math.floor(p.x / BUCKET);
      (state.buckets[b] || (state.buckets[b] = [])).push(i);
    });

    var nestArt = Art.nestSprite();
    state.nest = {
      x: 420,
      baseY: GROUND_Y,
      art: nestArt,
      holeX: 420 + (nestArt.holeX - nestArt.w / 2),
      holeY: GROUND_Y - (nestArt.h - nestArt.holeY)
    };
  }

  function init(seed, day) {
    state.seed = seed;
    buildWorld(seed, day);
    startDay(day);
  }

  function startDay(day) {
    state.day = day;
    state.script = DAY_SCRIPTS[Math.min(DAY_SCRIPTS.length - 1, day - 1)];
    state.elapsed = 0;
    state.hour = START_HOUR;
    state.dayOver = false;
    state.isRaining = false;
    state.rainIntensity = 0;
    state.rainWarned = false;
    state.gust = 0;
    state.gustTimer = U.rand(U.loose, 5, 12);

    /* Overnight the flowers refill and the spiders move. */
    state.plants.forEach(function (p) {
      p.nectar = p.nectarMax * U.rand(U.loose, 0.7, 1);
      p.pollenLeft = p.type.pollenMg;
      p.robbed = false;
    });
    updateEnvironment(0);
  }

  /* Jump straight to an hour - used by the ?hour= debug parameter. */
  function setHour(h) {
    state.elapsed = U.clamp((h - START_HOUR) / (END_HOUR - START_HOUR), 0, 1) * DAY_SECONDS;
    updateEnvironment(0);
  }

  /* ------------------------------------------------------- environment ---- */

  function skyAt(hour) {
    var a = SKY_KEYFRAMES[0], b = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
    for (var i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
      if (hour >= SKY_KEYFRAMES[i].hour && hour <= SKY_KEYFRAMES[i + 1].hour) {
        a = SKY_KEYFRAMES[i];
        b = SKY_KEYFRAMES[i + 1];
        break;
      }
    }
    var t = U.invLerp(a.hour, b.hour, hour);
    return {
      top: U.mixRgb(a.top, b.top, t),
      mid: U.mixRgb(a.mid, b.mid, t),
      horizon: U.mixRgb(a.horizon, b.horizon, t)
    };
  }

  function updateEnvironment(dt) {
    var s = state.script;
    var h = state.hour;

    /* Air temperature: cold at dawn, peaking in the early afternoon. */
    var curve = Math.max(0, Math.sin(Math.PI * (h - 4.5) / 15.5));
    var t = s.tempMin + (s.tempMax - s.tempMin) * Math.pow(curve, 0.9);
    t -= s.cloud * 3;

    /* Rain window, with a telegraph before it arrives. */
    var wasRaining = state.isRaining;
    if (s.rain) {
      var r0 = s.rain[0], r1 = s.rain[1];
      if (h >= r0 && h <= r1) {
        state.isRaining = true;
        /* fade in and out at the edges of the shower */
        var edge = Math.min(h - r0, r1 - h);
        state.rainIntensity = U.clamp(edge / 0.25, 0.25, 1);
      } else {
        state.isRaining = false;
        state.rainIntensity = U.approach(state.rainIntensity, 0, 2, dt);
      }
    }
    if (state.isRaining) t -= 4;
    state.airTempC = t;
    if (state.isRaining !== wasRaining) BB.Audio.setRain(state.isRaining);

    /* Wind: two slow noise octaves plus discrete gusts. */
    state.gustTimer -= dt;
    if (state.gustTimer <= 0) {
      state.gustTimer = U.rand(U.loose, 7, 18) / Math.max(0.3, s.wind);
      state.gust = U.rand(U.loose, -1, 1) * 130 * s.wind;
    }
    state.gust = U.approach(state.gust, 0, 0.45, dt);
    var base = (windNoise(state.elapsed * 0.14) * 0.7 + windNoise(state.elapsed * 0.53) * 0.3);
    state.wind = base * 90 * s.wind + state.gust;

    /* Light. The sun climbs from 05:30 to 20:30. */
    var sunT = U.clamp((h - 5.5) / 15, 0, 1);
    var elev = Math.sin(Math.PI * sunT);
    if (h < 5.5 || h > 20.5) elev = -0.15;
    var L = state.light;
    L.sunT = sunT;
    L.elev = elev;
    L.intensity = U.clamp(elev, 0, 1);
    L.night = U.clamp(1 - (elev + 0.12) * 3.2, 0, 1);
    L.warmth = U.clamp(1 - elev, 0, 1);
    /* Light comes from wherever the sun is. */
    var sunAngle = Math.PI * (1 - sunT);
    L.dirX = -Math.cos(sunAngle);
    L.dirY = -Math.max(0.18, Math.sin(sunAngle));
    var dl = Math.hypot(L.dirX, L.dirY) || 1;
    L.dirX /= dl; L.dirY /= dl;

    /* One full-screen tint carries the mood of the hour across baked and live
       art alike, which is far cheaper than tinting every sprite. */
    if (elev < 0.12) {
      var nightness = U.clamp((0.12 - elev) / 0.4, 0, 1);
      L.tint = [16, 26, 62];
      L.tintAlpha = 0.14 + nightness * 0.34;
    } else if (h < 8) {
      L.tint = [255, 168, 96];
      L.tintAlpha = 0.20 * (1 - U.clamp((h - 5.5) / 2.5, 0, 1));
    } else if (h > 18) {
      L.tint = [255, 138, 78];
      L.tintAlpha = 0.24 * U.clamp((h - 18) / 2.5, 0, 1);
    } else {
      L.tint = [255, 240, 200];
      L.tintAlpha = 0.04;
    }
    if (state.isRaining) {
      L.tint = [94, 108, 128];
      L.tintAlpha = Math.max(L.tintAlpha, 0.22 * state.rainIntensity);
    }
  }

  function update(dt) {
    if (!state.dayOver) {
      state.elapsed += dt;
      var frac = state.elapsed / DAY_SECONDS;
      state.hour = START_HOUR + frac * (END_HOUR - START_HOUR);
      if (state.hour >= END_HOUR) {
        state.hour = END_HOUR;
        state.dayOver = true;
      }
    }
    updateEnvironment(dt);
    cloudDrift += dt * 6;
    renderClock += dt;

    /* Flowers refill. Viper's bugloss does it fast enough to rework. */
    for (var i = 0; i < state.plants.length; i++) {
      var p = state.plants[i];
      if (p.nectar < p.nectarMax) {
        p.nectar = Math.min(p.nectarMax, p.nectar + p.type.nectarRegen / 60 * dt);
      }
      if (p.pollenLeft < p.type.pollenMg) {
        p.pollenLeft = Math.min(p.type.pollenMg, p.pollenLeft + p.type.pollenMg / 90 * dt);
      }
    }
  }

  /* ------------------------------------------------------------ queries ---- */

  function swayOf(p) {
    return (state.wind / 900) * p.type.swayFactor +
      Math.sin(renderClock * 1.15 + p.phase) * 0.024 * p.type.swayFactor;
  }

  /* Where the bee actually has to be to reach into this flower. */
  function anchorWorld(p) {
    var a = swayOf(p);
    var ca = Math.cos(a), sa = Math.sin(a);
    var dx = p.anchorX * p.scale, dy = p.anchorY * p.scale;
    return {
      x: p.x + dx * ca - dy * sa,
      y: p.baseY + dx * sa + dy * ca
    };
  }

  function nearestLandable(x, y, radius) {
    var best = null, bestD = radius * radius;
    var b0 = Math.floor((x - radius) / BUCKET);
    var b1 = Math.floor((x + radius) / BUCKET);
    for (var b = b0; b <= b1; b++) {
      var list = state.buckets[b];
      if (!list) continue;
      for (var i = 0; i < list.length; i++) {
        var p = state.plants[list[i]];
        if (!BB.isInBloom(p.type, state.hour)) continue;
        var a = anchorWorld(p);
        var d = U.dist2(x, y, a.x, a.y);
        if (d < bestD) {
          bestD = d;
          best = p;
          best._anchor = a;
        }
      }
    }
    return best;
  }

  /* Under a tall flower head: safe from rain, and out of a bird's sight. */
  function shelterAt(x, y) {
    var b0 = Math.floor((x - 80) / BUCKET);
    var b1 = Math.floor((x + 80) / BUCKET);
    for (var b = b0; b <= b1; b++) {
      var list = state.buckets[b];
      if (!list) continue;
      for (var i = 0; i < list.length; i++) {
        var p = state.plants[list[i]];
        if (!p.shelters) continue;
        if (Math.abs(p.x - x) > 46 * p.scale) continue;
        var headTop = p.baseY - p.type.heightPx * p.scale;
        if (y > headTop && y < p.baseY - 10) return true;
      }
    }
    /* The hedgerow around the nest counts as cover too. */
    if (x < 900 && y > GROUND_Y - 220) return true;
    return false;
  }

  function inSprayedZone(x) {
    var z = BB.zoneAt(x);
    return !!z.sprayed;
  }

  /* -------------------------------------------------------- rendering ---- */

  function tileStrip(ctx, img, screenY, height, parallax, camX, viewW, alpha) {
    var w = img.width;
    var offset = -(camX * parallax) % w;
    if (offset > 0) offset -= w;
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    for (var x = offset; x < viewW; x += w) {
      ctx.drawImage(img, 0, 0, w, img.height, Math.floor(x), Math.floor(screenY), w, height);
    }
    ctx.globalAlpha = 1;
  }

  function renderSky(ctx, cam) {
    var vw = cam.viewW, vh = cam.viewH;
    var sky = skyAt(state.hour);
    var horizonY = U.clamp(cam.toScreenY(GROUND_Y), vh * 0.24, vh * 1.6);

    var g = ctx.createLinearGradient(0, 0, 0, Math.max(horizonY, vh * 0.5));
    g.addColorStop(0, U.rgbStr(sky.top));
    g.addColorStop(0.55, U.rgbStr(sky.mid));
    g.addColorStop(1, U.rgbStr(sky.horizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    /* Stars, fading in as the light goes. */
    if (state.light.night > 0.02) {
      var stars = Art.starStrip();
      ctx.globalAlpha = state.light.night * 0.9;
      var sOff = -(cam.x * 0.04) % stars.width;
      if (sOff > 0) sOff -= stars.width;
      for (var sx = sOff; sx < vw; sx += stars.width) {
        ctx.drawImage(stars, Math.floor(sx), Math.min(0, horizonY - stars.height));
      }
      ctx.globalAlpha = 1;
    }

    /* Sun or moon on its arc. */
    var sunT = state.light.sunT;
    var bodyX = vw * (0.06 + 0.88 * sunT);
    var arc = Math.sin(Math.PI * sunT);
    var bodyY = horizonY - arc * Math.min(vh * 0.66, horizonY * 0.92);
    var isDay = state.hour > 5.3 && state.hour < 20.7;

    if (isDay) {
      var r = 34;
      var glow = ctx.createRadialGradient(bodyX, bodyY, r * 0.4, bodyX, bodyY, r * 7);
      var warm = state.light.warmth;
      glow.addColorStop(0, U.rgba(255, 244 - warm * 60, 210 - warm * 90, 0.55));
      glow.addColorStop(1, U.rgba(255, 200, 150, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(bodyX - r * 7, bodyY - r * 7, r * 14, r * 14);
      ctx.beginPath();
      ctx.arc(bodyX, bodyY, r, 0, TAU);
      ctx.fillStyle = U.rgba(255, 250 - warm * 34, 226 - warm * 80, 0.95);
      ctx.fill();
    } else {
      var mx = vw * (0.85 - 0.7 * ((state.hour < 5.3 ? state.hour + 3 : state.hour - 20.7) / 8));
      var my = vh * 0.2;
      ctx.beginPath();
      ctx.arc(mx, my, 22, 0, TAU);
      ctx.fillStyle = 'rgba(232,238,250,0.9)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx + 8, my - 5, 4, 0, TAU);
      ctx.arc(mx - 6, my + 6, 5.5, 0, TAU);
      ctx.fillStyle = 'rgba(198,208,226,0.7)';
      ctx.fill();
    }

    /* Clouds. */
    var cover = state.script.cloud + state.rainIntensity * 0.4;
    var nClouds = Math.round(2 + cover * 6);
    ctx.globalAlpha = U.clamp(0.32 + cover * 0.55, 0, 0.92) * (1 - state.light.night * 0.6);
    for (var c = 0; c < nClouds; c++) {
      var img = Art.cloudSprite(c % 3);
      var span = vw + img.width * 2;
      var cxp = ((cloudDrift * (0.5 + (c % 3) * 0.25) - cam.x * 0.07) + c * 620) % span;
      if (cxp < 0) cxp += span;
      var cy = vh * (0.05 + (c % 4) * 0.09);
      ctx.drawImage(img, cxp - img.width, cy);
    }
    ctx.globalAlpha = 1;
  }

  function renderParallax(ctx, cam) {
    var vw = cam.viewW;
    var groundScreenY = cam.toScreenY(GROUND_Y);
    var z = cam.zoom;

    /* Each strip is positioned so its base sits at or just below the ground
       line and the layer above overlaps it, leaving no seam of bare sky. */
    var hills = Art.farHills();
    tileStrip(ctx, hills, groundScreenY - 420 * z, 420 * z, 0.12, cam.x, vw, 0.9);

    var trees = Art.treeLine();
    tileStrip(ctx, trees, groundScreenY - 430 * z, 520 * z, 0.3, cam.x, vw, 1);

    var mid = Art.midGrass();
    tileStrip(ctx, mid, groundScreenY - 230 * z, 300 * z, 0.62, cam.x, vw, 0.95);
  }

  function renderGround(ctx, cam) {
    var vw = cam.viewW, vh = cam.viewH;
    var gy = cam.toScreenY(GROUND_Y);
    var z = cam.zoom;
    var strip = Art.groundStrip();
    tileStrip(ctx, strip, gy - 12 * z, 260 * z, 1.0, cam.x, vw, 1);
    /* Fill anything below the strip so the camera can never show a hole. */
    if (gy + 248 * z < vh) {
      ctx.fillStyle = '#2a2116';
      ctx.fillRect(0, gy + 246 * z, vw, vh - (gy + 246 * z));
    }
  }

  /* Draw one plant. The sprite is baked with its root at the origin, so the
     whole plant is rotated about that root to bend it in the wind. */
  function drawPlant(ctx, p) {
    var a = swayOf(p);
    ctx.save();
    ctx.translate(p.x, p.baseY);
    ctx.rotate(a);
    ctx.scale(p.scale, p.scale);
    ctx.drawImage(p.sprite.canvas, -p.sprite.ox, -p.sprite.oy);

    /* A flower that has been robbed carries the hole for the rest of the day. */
    if (p.robbed) {
      ctx.beginPath();
      ctx.arc(p.anchorX, p.anchorY + 4, 2.6, 0, TAU);
      ctx.fillStyle = 'rgba(40,20,10,0.75)';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlantList(ctx, cam, list, alpha, haze) {
    var x0 = cam.visible.x0 - 220, x1 = cam.visible.x1 + 220;
    ctx.globalAlpha = alpha;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.x < x0 || p.x > x1) continue;
      /* A plant that is shut - bramble before six in the morning, honeysuckle
         before the evening - is drawn dimmed. It cannot be landed on, so it
         must not look identical to one that can. */
      if (!BB.isInBloom(p.type, state.hour)) {
        ctx.globalAlpha = alpha * 0.5;
        drawPlant(ctx, p);
        ctx.globalAlpha = alpha;
        continue;
      }
      drawPlant(ctx, p);
    }
    ctx.globalAlpha = 1;

    /* Aerial perspective over the layer behind. The colour is taken from the
       sky at the horizon, so the haze stays pink at dusk and blue at noon
       instead of laying a cold grey film over a warm scene. */
    if (haze) {
      var hz = skyAt(state.hour).horizon;
      ctx.fillStyle = U.rgba(hz[0], hz[1], hz[2], 0.09);
      ctx.fillRect(x0, GROUND_Y - 470, x1 - x0, 480);
    }
  }

  function renderSprayHaze(ctx, cam) {
    for (var i = 0; i < BB.ZONES.length; i++) {
      var z = BB.ZONES[i];
      if (!z.sprayed) continue;
      if (z.to < cam.visible.x0 || z.from > cam.visible.x1) continue;
      var g = ctx.createLinearGradient(0, GROUND_Y - 300, 0, GROUND_Y);
      g.addColorStop(0, 'rgba(226,232,150,0)');
      g.addColorStop(0.55, 'rgba(220,228,140,0.16)');
      g.addColorStop(1, 'rgba(198,210,120,0.26)');
      ctx.fillStyle = g;
      ctx.fillRect(z.from, GROUND_Y - 300, z.to - z.from, 302);

      /* A small warning sign, so the strip is never a hidden trap. */
      var sx = z.from + 60;
      ctx.strokeStyle = '#6b5c40';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sx, GROUND_Y);
      ctx.lineTo(sx, GROUND_Y - 96);
      ctx.stroke();
      ctx.save();
      ctx.translate(sx, GROUND_Y - 116);
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(24, 20);
      ctx.lineTo(-24, 20);
      ctx.closePath();
      ctx.fillStyle = '#e8c93a';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#3a2f14';
      ctx.stroke();
      ctx.fillStyle = '#3a2f14';
      ctx.fillRect(-2.5, -12, 5, 18);
      ctx.beginPath();
      ctx.arc(0, 12, 2.8, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function renderNest(ctx, cam) {
    var n = state.nest;
    if (n.x + 200 < cam.visible.x0 || n.x - 200 > cam.visible.x1) return;
    ctx.drawImage(n.art.canvas, n.x - n.art.w / 2, n.baseY - n.art.h);
    /* A warm glow from inside the hole after dusk. */
    if (state.light.night > 0.1) {
      var g = ctx.createRadialGradient(n.holeX, n.holeY, 2, n.holeX, n.holeY, 60);
      g.addColorStop(0, 'rgba(255,196,96,' + (0.35 * state.light.night).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,196,96,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.holeX, n.holeY, 60, 0, TAU);
      ctx.fill();
    }
  }

  function renderRain(ctx, cam) {
    if (state.rainIntensity <= 0.01) return;
    var vw = cam.viewW, vh = cam.viewH;
    var n = Math.round(260 * state.rainIntensity);
    var lean = U.clamp(state.wind / 160, -1.1, 1.1);
    var t = renderClock;
    /* Every drop in one path: this is the difference between 2 ms and 12 ms. */
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var seedX = (i * 137.51) % 1;
      var seedY = (i * 61.803) % 1;
      var speed = 900 + seedY * 500;
      var x = (seedX * (vw + 260) + lean * 200 * seedY - cam.x * 0.9) % (vw + 260);
      if (x < 0) x += vw + 260;
      var y = ((seedY * vh) + t * speed) % (vh + 60);
      var len = 14 + seedY * 16;
      ctx.moveTo(x - 130, y - 30);
      ctx.lineTo(x - 130 + lean * len, y - 30 + len);
    }
    ctx.strokeStyle = 'rgba(198,216,238,' + (0.34 * state.rainIntensity).toFixed(3) + ')';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  function renderTint(ctx, cam) {
    var L = state.light;
    if (L.tintAlpha <= 0.002) return;
    ctx.fillStyle = U.rgba(L.tint[0], L.tint[1], L.tint[2], L.tintAlpha);
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
  }

  /* Everything behind the bee. Called with the canvas in screen space.
     The sky, the parallax strips and the ground are tiled in screen space;
     everything with a real position in the meadow is drawn under the world
     transform. Mixing the two up is the easiest way to break this file. */
  function renderBack(ctx, cam) {
    renderSky(ctx, cam);
    renderParallax(ctx, cam);
    renderGround(ctx, cam);

    ctx.save();
    cam.applyWorld(ctx);
    drawPlantList(ctx, cam, state.bgPlants, 0.8, true);
    drawPlantList(ctx, cam, state.plants, 1, false);
    /* Drawn after the meadow: the nest entrance is the one landmark the player
       must always be able to find, so nothing is allowed to grow in front of it. */
    renderNest(ctx, cam);
    renderSprayHaze(ctx, cam);
    ctx.restore();
  }

  /* Everything in front of the bee. */
  function renderFront(ctx, cam) {
    ctx.save();
    cam.applyWorld(ctx);
    drawPlantList(ctx, cam, state.fgPlants, 0.96, false);
    ctx.restore();

    var gy = cam.toScreenY(GROUND_Y);
    tileStrip(ctx, Art.foreGrass(), gy - 170 * cam.zoom, 230 * cam.zoom, 1.32, cam.x, cam.viewW, 0.8);

    renderRain(ctx, cam);
    renderTint(ctx, cam);
  }

  BB.World = {
    WIDTH: WIDTH,
    GROUND_Y: GROUND_Y,
    CEILING_Y: CEILING_Y,
    START_HOUR: START_HOUR,
    END_HOUR: END_HOUR,
    DAY_SECONDS: DAY_SECONDS,
    DAY_SCRIPTS: DAY_SCRIPTS,
    init: init,
    startDay: startDay,
    setHour: setHour,
    update: update,
    renderBack: renderBack,
    renderFront: renderFront,
    nearestLandable: nearestLandable,
    anchorWorld: anchorWorld,
    swayOf: swayOf,
    shelterAt: shelterAt,
    inSprayedZone: inSprayedZone,
    skyAt: skyAt,
    get state() { return state; },
    get hour() { return state.hour; },
    get airTempC() { return state.airTempC; },
    get light() { return state.light; },
    get wind() { return state.wind; },
    get isRaining() { return state.isRaining; },
    get dayOver() { return state.dayOver; },
    get plants() { return state.plants; },
    get nest() { return state.nest; }
  };

})(window.BB = window.BB || {});
