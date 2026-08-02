/* Bumblebee Simulator - the loop that ties it all together.
   Loaded last: every other file has already attached itself to window.BB. */
(function (BB) {
  'use strict';

  var U = BB.Util;
  var TAU = U.TAU;

  var FIXED_DT = 1 / 60;
  var MAX_STEPS = 5;

  var canvas = null;
  var ctx = null;

  var mode = 'menu';          /* menu | playing | paused | report | over */
  var bee = null;
  var seed = U.paramNum('seed', 20260730) | 0;
  var worldReady = false;
  var lastTime = 0;
  var accumulator = 0;
  var duskWarned = false;
  var overReason = '';

  var stats = { fps: 60, frameMs: 0, updateMs: 0, renderMs: 0, samples: [] };
  var showDebug = U.paramFlag('debug');
  var ambientPan = 0;

  /* ------------------------------------------------------------- camera ---- */

  var cam = {
    x: 700, y: 900, zoom: 1,
    viewW: 800, viewH: 600, dpr: 1,
    visible: { x0: 0, x1: 800, y0: 0, y1: 600 },
    toScreenX: function (wx) { return cam.viewW / 2 + (wx - cam.x) * cam.zoom; },
    toScreenY: function (wy) { return cam.viewH / 2 + (wy - cam.y) * cam.zoom; },
    applyWorld: function (c) {
      c.translate(cam.viewW / 2, cam.viewH / 2);
      c.scale(cam.zoom, cam.zoom);
      c.translate(-cam.x, -cam.y);
    },
    refresh: function () {
      var hw = cam.viewW / 2 / cam.zoom;
      var hh = cam.viewH / 2 / cam.zoom;
      cam.visible.x0 = cam.x - hw;
      cam.visible.x1 = cam.x + hw;
      cam.visible.y0 = cam.y - hh;
      cam.visible.y1 = cam.y + hh;
    }
  };

  function resize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    cam.dpr = Math.min(window.devicePixelRatio || 1, 2);
    /* Very large logical sizes at dpr 2 exceed old mobile texture limits. */
    while (w * cam.dpr > 4096 && cam.dpr > 1) cam.dpr -= 0.25;
    cam.viewW = w;
    cam.viewH = h;
    canvas.width = Math.round(w * cam.dpr);
    canvas.height = Math.round(h * cam.dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    cam.refresh();
  }

  function updateCamera(dt) {
    var W = BB.World;
    if (!bee) {
      /* Slow drift across the meadow behind the menus. */
      ambientPan += dt * 26;
      cam.x = 500 + (ambientPan % (W.WIDTH - 1200));
      cam.y = W.GROUND_Y - 320;
      cam.zoom = 1;
      cam.refresh();
      return;
    }

    var targetZoom = 1;
    var speed = Math.hypot(bee.vx, bee.vy);
    if (bee.state === 'LANDED' || bee.state === 'GROUNDED' || bee.state === 'DEPOSITING') {
      targetZoom = 1.32;   /* lean in when the anatomy is worth looking at */
    } else if (speed > 300) {
      targetZoom = 0.88;
    }
    cam.zoom = U.approach(cam.zoom, targetZoom, 3, dt);

    var tx = bee.x + bee.vx * 0.28;
    var ty = bee.y + bee.vy * 0.20 - 40;
    var k = 1 - Math.exp(-6 * dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;

    var hw = cam.viewW / 2 / cam.zoom;
    var hh = cam.viewH / 2 / cam.zoom;
    /* Only a little bare soil below the ground line is ever worth showing. */
    var lowest = W.GROUND_Y + 60;
    cam.x = U.clamp(cam.x, hw, W.WIDTH - hw);
    cam.y = U.clamp(cam.y, W.CEILING_Y - 80 + hh, lowest - hh);
    if (hh * 2 > lowest - (W.CEILING_Y - 80)) {
      cam.y = (lowest + W.CEILING_Y - 80) / 2;
    }
    cam.refresh();
  }

  /* ---------------------------------------------------------- particles ---- */

  var particles = [];
  var MAX_PARTICLES = 400;

  function spawnParticle(x, y, vx, vy, life, r, color, grav) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push({ x: x, y: y, vx: vx, vy: vy, life: life, maxLife: life, r: r, color: color, grav: grav || 0 });
  }

  function puff(x, y, count, color, spread) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * TAU;
      var s = Math.random() * spread;
      spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s - 20,
        0.5 + Math.random() * 0.7, 1 + Math.random() * 2.2, color, 60);
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
    }
  }

  function renderParticles(c) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      c.globalAlpha = U.clamp(p.life / p.maxLife, 0, 1) * 0.85;
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, TAU);
      c.fillStyle = p.color;
      c.fill();
    }
    c.globalAlpha = 1;
  }

  /* --------------------------------------------------------------- hooks ---- */

  var hooks = {
    toast: function (msg, kind) { BB.Hud.toast(msg, kind); },

    onLand: function (flower) {
      var a = BB.World.anchorWorld(flower);
      puff(a.x, a.y, 6, flower.type.pollenColor, 40);
    },

    onLeave: function (flower, pollinated, streak) {
      BB.Colony.registerVisit(flower.typeId, pollinated);
      if (pollinated) {
        var a = BB.World.anchorWorld(flower);
        puff(a.x, a.y, 10, flower.type.pollenColor, 55);
      }
    },

    onRob: function (flower) {
      BB.Colony.state.robberies += 1;
      BB.Hud.toast('You bit through the base of the ' +
        flower.type.commonName.toLowerCase() + ' and robbed it. No pollination, ' +
        'but the nectar is yours.', 'info');
      BB.Audio.blip('good');
    },

    onDeposit: function (nectar, pollen, contaminated) {
      BB.Colony.deposit(nectar, pollen, contaminated);
      BB.Hud.toast('Unloaded ' + Math.round(nectar) + ' mg of nectar and ' +
        pollen.toFixed(1) + ' mg of pollen into the wax pots.', 'good');
      var n = BB.World.nest;
      puff(n.holeX, n.holeY, 12, '#f0c860', 70);
    },

    onHit: function (reason) {
      BB.Colony.state.hazardHits += 1;
      BB.Hud.toast(reason, 'bad');
    },

    collapse: function (reason) {
      var res = BB.Colony.loseLife(reason);
      if (res.dead) {
        endRun(reason);
      } else {
        BB.Hud.toast(reason + ' You have ' + res.lives +
          (res.lives === 1 ? ' life left.' : ' lives left.'), 'bad');
        respawn();
      }
    }
  };

  function respawn() {
    var W = BB.World;
    bee.x = W.nest.holeX;
    bee.y = W.nest.holeY - bee.L * 0.3;
    bee.vx = bee.vy = 0;
    bee.energy = bee.energyMax * 0.6;
    bee.thoraxC = 31;
    bee.nectar = 0;
    bee.pollen = 0;
    bee.contaminated = 0;
    bee.toxin = 0;
    bee.flower = null;
    bee.groundedTimer = 0;
    BB.Bee.setState(bee, 'FLYING');
    BB.Hud.setSpeciesTag(bee.species, BB.Colony.state.lives);
  }

  /* ---------------------------------------------------------- run control ---- */

  function startRun(speciesId) {
    var W = BB.World;
    BB.Colony.reset();
    var species = BB.getSpecies(speciesId);

    var startDay = Math.round(U.paramNum('day', 1));
    startDay = U.clamp(startDay, 1, BB.Colony.SEASON_DAYS);
    BB.Colony.state.day = startDay;

    W.startDay(startDay);
    var startHour = U.paramNum('hour', NaN);
    if (isFinite(startHour)) W.setHour(startHour);

    BB.Hazards.init(startDay);

    bee = BB.Bee.create(species, W.nest.holeX + 40, W.GROUND_Y - 30);
    bee.thoraxC = BB.Bee.nestWarmth(W.airTempC);
    BB.Bee.setState(bee, 'GROUNDED');

    particles.length = 0;
    duskWarned = false;
    overReason = '';
    mode = 'playing';
    BB.Hud.clearToasts();
    BB.Hud.showScreen(null);
    BB.Hud.setSpeciesTag(species, BB.Colony.state.lives);

    var q = BB.Colony.quota();
    BB.Hud.toast('Day ' + startDay + '. The brood needs ' + q.nectar + ' mg of nectar and ' +
      q.pollen + ' mg of pollen by dusk.', 'info');
    if (bee.thoraxC < BB.Bee.FLIGHT_TEMP) {
      BB.Hud.toast('You are too cold to fly. Hold Shift to shiver your flight ' +
        'muscles up to 30 °C.', 'info');
    }
  }

  function beginNextDay() {
    var W = BB.World;
    var day = BB.Colony.state.day;
    W.startDay(day);
    BB.Hazards.init(day);
    respawn();
    bee.thoraxC = BB.Bee.nestWarmth(W.airTempC);
    BB.Bee.setState(bee, 'GROUNDED');
    bee.energy = bee.energyMax;
    particles.length = 0;
    duskWarned = false;
    mode = 'playing';
    BB.Hud.clearToasts();
    BB.Hud.showScreen(null);
    var q = BB.Colony.quota();
    BB.Hud.toast('Day ' + day + ' – ' + W.state.script.label + '. The brood needs ' +
      q.nectar + ' mg of nectar and ' + q.pollen + ' mg of pollen.', 'info');
  }

  function closeDay() {
    /* Being caught out at dusk costs you. */
    if (bee.nectar > 0.5 || bee.pollen > 0.05) {
      var lost = 0.35;
      bee.nectar *= (1 - lost);
      bee.pollen *= (1 - lost);
      BB.Colony.deposit(bee.nectar, bee.pollen, bee.contaminated);
      BB.Hud.toast('Night caught you in the open. You lost a third of your load ' +
        'getting home in the cold.', 'bad');
    }
    bee.nectar = 0; bee.pollen = 0; bee.contaminated = 0;

    var report = BB.Colony.endOfDay();
    mode = 'report';
    BB.Hud.showReport(report, BB.World);
  }

  function endRun(reason) {
    var c = BB.Colony.state;
    overReason = reason || overReason;
    mode = 'over';
    BB.Storage.recordRun(bee.species.id, BB.Colony.score(), c.day, c.won,
      c.nectarLifetime, c.pollenLifetime);
    BB.Audio.silenceFlight();
    BB.Audio.setRain(false);
    BB.Hud.showGameOver(c, bee, overReason);
    BB.Hud.refreshBestLine();
  }

  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    BB.Audio.silenceFlight();
    BB.Hud.showPause(bee, BB.Colony.state);
  }

  function resume() {
    if (mode !== 'paused') return;
    mode = 'playing';
    BB.Input.clearPresses();
    BB.Hud.showScreen(null);
  }

  /* ---------------------------------------------------------- the prompt ---- */

  function updatePrompt() {
    var W = BB.World;
    var sp = bee.species;

    if (bee.state === 'GRABBED') {
      BB.Hud.setPrompt('Caught! Hammer the movement keys to tear free.', 'bad');
      return;
    }

    if (BB.Hazards.threatLevel(bee) > 0.15) {
      BB.Hud.setPrompt('A bird is hunting you. Turn hard, or dive into flower cover.', 'bad');
      return;
    }

    if (bee.thoraxC < BB.Bee.FLIGHT_TEMP &&
      (bee.state === 'GROUNDED' || bee.state === 'LANDED')) {
      BB.Hud.setPrompt('Thorax ' + bee.thoraxC.toFixed(1) + ' °C – you need 30 °C to fly. ' +
        'Hold <kbd>Shift</kbd> to shiver.', 'warn');
      return;
    }

    /* Warm at last: say so, or the player keeps shivering out of habit. */
    if (bee.state === 'GROUNDED') {
      var carrying = bee.nectar > 0.5 || bee.pollen > 0.05;
      var atNest = U.dist(bee.x, bee.y, W.nest.holeX, W.nest.holeY) < 110;
      if (!(atNest && carrying)) {
        BB.Hud.setPrompt('Warm enough to fly. Press <kbd>W</kbd> to take off.');
        return;
      }
    }

    if (bee.state === 'LANDED' && bee.flower) {
      var f = bee.flower;
      if (bee.rejected && !bee.rejected.robbing) {
        BB.Hud.setPrompt('This corolla is ' + f.type.corollaDepthMm +
          ' mm deep and your tongue is ' + sp.tongueMm + ' mm. Out of reach.', 'bad');
        return;
      }
      if (bee.rejected && bee.rejected.robbing) {
        BB.Hud.setPrompt('Too deep at ' + f.type.corollaDepthMm + ' mm – biting a hole ' +
          'through the base… ' + Math.round(bee.rejected.progress * 100) + '%', 'warn');
        return;
      }
      if (f.type.buzzPollinated) {
        BB.Hud.setPrompt('No nectar here. Hold <kbd>Shift</kbd> to buzz the pollen loose.',
          'warn');
        return;
      }
      if (f.nectar < 0.05) {
        BB.Hud.setPrompt(f.type.commonName + ' – drained. It refills in about ' +
          Math.round(f.nectarMax / f.type.nectarRegen * 60) + ' s.', 'warn');
        return;
      }
      BB.Hud.setPrompt('Drinking ' + f.type.commonName.toLowerCase() + ' – ' +
        Math.round(f.nectar) + ' mg left');
      return;
    }

    if (bee.energy / bee.energyMax < 0.25 && bee.nectar > 1) {
      BB.Hud.setPrompt('Energy low. Hold <kbd>Q</kbd> to drink from your own honey stomach.',
        'warn');
      return;
    }

    var nest = W.nest;
    if (U.dist(bee.x, bee.y, nest.holeX, nest.holeY) < 110) {
      if (bee.nectar > 0.5 || bee.pollen > 0.05) {
        BB.Hud.setPrompt('Hold <kbd>Space</kbd> to unload into the nest.');
      } else {
        BB.Hud.setPrompt('The nest. Come back here with a full load.');
      }
      return;
    }

    var near = bee.nearFlower;
    if (near && bee.state === 'FLYING') {
      var reachable = sp.tongueMm >= near.type.corollaDepthMm;
      var label = near.type.commonName + ' · corolla ' + near.type.corollaDepthMm + ' mm';
      if (near.type.buzzPollinated) {
        BB.Hud.setPrompt(label + ' · buzz-pollinated · <kbd>Space</kbd> to land');
      } else if (reachable) {
        BB.Hud.setPrompt(label + ' · within reach · <kbd>Space</kbd> to land');
      } else if (sp.canRob) {
        BB.Hud.setPrompt(label + ' · too deep for your ' + sp.tongueMm +
          ' mm tongue · land and hold <kbd>Space</kbd> to rob it', 'warn');
      } else {
        BB.Hud.setPrompt(label + ' · too deep for your ' + sp.tongueMm + ' mm tongue', 'bad');
      }
      return;
    }

    if (W.isRaining && !W.shelterAt(bee.x, bee.y)) {
      BB.Hud.setPrompt('Rain is pushing you down. Shelter under a tall flower head.', 'warn');
      return;
    }

    BB.Hud.setPrompt(null);
  }

  /* ---------------------------------------------------------------- loop ---- */

  function updatePlaying(dt) {
    var W = BB.World;
    var input = BB.Input.state;

    W.update(dt);
    BB.Bee.update(bee, dt, input, hooks);
    if (mode !== 'playing') return;      /* a hook may have ended the run */
    BB.Hazards.update(dt, bee, hooks);
    updateParticles(dt);

    /* Pollen dust while working a flower. */
    if (bee.drinking && Math.random() < 0.25) {
      var a = W.anchorWorld(bee.flower);
      puff(a.x, a.y, 1, bee.flower.type.pollenColor, 18);
    }
    if (bee.sonicating && Math.random() < 0.7) {
      var a2 = W.anchorWorld(bee.flower);
      puff(a2.x, a2.y, 2, bee.flower.type.pollenColor, 60);
    }
    if (bee._buzzHarvest) {
      bee._buzzHarvest = false;
      BB.Colony.state.buzzHarvests += 1;
    }

    if (!duskWarned && W.hour >= 20) {
      duskWarned = true;
      BB.Hud.toast('The light is going. Get home before ' +
        U.formatClock(W.END_HOUR) + '.', 'warn');
    }

    if (W.dayOver) {
      closeDay();
      return;
    }

    if (BB.Colony.state.finished) {
      endRun(overReason);
    }
  }

  function render(interp) {
    var c = ctx;
    c.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    c.clearRect(0, 0, cam.viewW, cam.viewH);

    if (!worldReady) {
      c.fillStyle = '#0d1014';
      c.fillRect(0, 0, cam.viewW, cam.viewH);
      return;
    }

    BB.World.renderBack(c, cam);

    c.save();
    cam.applyWorld(c);
    BB.Hazards.render(c, cam);
    if (bee) BB.Bee.render(c, bee, interp);
    renderParticles(c);
    c.restore();

    BB.World.renderFront(c, cam);
    if (bee && mode === 'playing') renderNestCompass(c);
  }

  /* The meadow is 6400 px wide and the nest is a single hole in it, so when it
     is off-screen an arrow at the edge points the way home. */
  function renderNestCompass(c) {
    var nest = BB.World.nest;
    var sx = cam.toScreenX(nest.holeX);
    var sy = cam.toScreenY(nest.holeY);
    var margin = 58;
    if (sx > margin && sx < cam.viewW - margin) return;

    var onLeft = sx <= margin;
    var x = onLeft ? margin : cam.viewW - margin;
    var y = U.clamp(sy, 110, cam.viewH - 130);
    var dist = Math.round(Math.abs(nest.holeX - bee.x));
    var carrying = bee.nectar > 0.5 || bee.pollen > 0.05;

    c.save();
    c.translate(x, y);
    c.globalAlpha = 0.9;

    c.beginPath();
    c.arc(0, 0, 21, 0, TAU);
    c.fillStyle = carrying ? 'rgba(242,181,46,0.24)' : 'rgba(16,14,10,0.42)';
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = carrying ? 'rgba(255,212,105,0.85)' : 'rgba(247,241,226,0.4)';
    c.stroke();

    c.rotate(onLeft ? Math.PI : 0);
    c.beginPath();
    c.moveTo(11, 0);
    c.lineTo(-5, -8);
    c.lineTo(-5, 8);
    c.closePath();
    c.fillStyle = carrying ? '#ffd469' : 'rgba(247,241,226,0.75)';
    c.fill();
    c.restore();

    c.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(247,241,226,0.75)';
    /* Nudged inwards so the label never runs off the screen edge. */
    c.fillText('nest ' + U.commas(dist), U.clamp(x, 52, cam.viewW - 52), y + 36);
  }

  function frame(now) {
    window.requestAnimationFrame(frame);
    if (!lastTime) lastTime = now;
    var frameDt = Math.min((now - lastTime) / 1000, 0.25);
    lastTime = now;

    var t0 = now;
    BB.Input.update();

    /* Global keys. */
    if (BB.Input.consumePress('KeyM')) {
      var m = BB.Audio.toggleMute();
      BB.Hud.toast(m ? 'Sound muted.' : 'Sound on.', 'info');
    }
    if (BB.Input.consumePress('F3')) showDebug = !showDebug;
    if (BB.Input.consumePress('KeyP', 'Escape')) {
      if (mode === 'playing') pause();
      else if (mode === 'paused') resume();
    }

    accumulator += frameDt;
    var steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
      if (mode === 'playing' && worldReady) {
        updatePlaying(FIXED_DT);
      } else if (worldReady) {
        /* Menus and reports keep the meadow alive in the background. */
        BB.World.update(FIXED_DT * 0.35);
        updateParticles(FIXED_DT);
      }
      updateCamera(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0;

    var tUpdate = performance.now();
    stats.updateMs = tUpdate - t0;

    render(accumulator / FIXED_DT);
    stats.renderMs = performance.now() - tUpdate;
    stats.frameMs = frameDt * 1000;

    stats.samples.push(frameDt);
    if (stats.samples.length > 40) stats.samples.shift();
    var sum = 0;
    for (var i = 0; i < stats.samples.length; i++) sum += stats.samples[i];
    stats.fps = stats.samples.length / Math.max(0.0001, sum);

    if (mode === 'playing' && bee) {
      BB.Hud.update(bee, BB.Colony.state, BB.World);
      updatePrompt();
      BB.Hud.setStreak(bee.streak, bee.lastFlowerId
        ? BB.getFlowerType(bee.lastFlowerId).commonName : '');
    }

    BB.Hud.setDebug(showDebug ? debugText() : null);
  }

  function debugText() {
    var W = BB.World;
    var lines = [
      'Bumblebee Simulator ' + BB.VERSION,
      'fps ' + stats.fps.toFixed(1) + '  upd ' + stats.updateMs.toFixed(1) +
        'ms  ren ' + stats.renderMs.toFixed(1) + 'ms',
      'dpr ' + cam.dpr.toFixed(2) + '  view ' + cam.viewW + 'x' + cam.viewH +
        '  zoom ' + cam.zoom.toFixed(2),
      'mode ' + mode + '  seed ' + seed,
      'cam ' + cam.x.toFixed(0) + ',' + cam.y.toFixed(0),
      'hour ' + U.formatClock(W.hour) + '  air ' + W.airTempC.toFixed(1) + 'C' +
        '  wind ' + W.wind.toFixed(0),
      'plants ' + W.plants.length + '  particles ' + particles.length +
        '  birds ' + BB.Hazards.birds.length + '  spiders ' + BB.Hazards.spiders.length
    ];
    if (bee) {
      var near = bee.nearFlower;
      lines.push('bee ' + bee.state + '  ' + bee.x.toFixed(0) + ',' + bee.y.toFixed(0));
      lines.push('  v ' + bee.vx.toFixed(0) + ',' + bee.vy.toFixed(0) +
        '  throttle ' + bee.throttle.toFixed(2));
      lines.push('  energy ' + bee.energy.toFixed(1) + '/' + bee.energyMax +
        '  thorax ' + bee.thoraxC.toFixed(1) + 'C');
      lines.push('  nectar ' + bee.nectar.toFixed(1) + '  pollen ' + bee.pollen.toFixed(2) +
        '  toxin ' + bee.toxin.toFixed(2));
      lines.push('  tongue ' + bee.species.tongueMm + 'mm  nearest ' +
        (near ? near.typeId + ' ' + near.type.corollaDepthMm + 'mm' : '-'));
      lines.push('  streak ' + bee.streak + '  lives ' + BB.Colony.state.lives);
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------ self test ---- */

  function selfTest() {
    var failures = [];
    function check(cond, msg) { if (!cond) failures.push(msg); }

    /* --- data integrity --- */
    BB.SPECIES.forEach(function (sp) {
      ['id', 'commonName', 'latinName', 'blurb'].forEach(function (k) {
        check(typeof sp[k] === 'string' && sp[k].length > 0, sp.id + ' missing ' + k);
      });
      ['bodyLengthMm', 'tongueMm', 'maxSpeed', 'accel', 'nectarCapacity',
        'pollenCapacity', 'energyMax', 'coldToleranceC', 'shiverRate'
      ].forEach(function (k) {
        check(typeof sp[k] === 'number' && isFinite(sp[k]) && sp[k] > 0,
          sp.id + '.' + k + ' is not a positive number');
      });
      check(sp.bands.length > 0, sp.id + ' has no colour bands');
      var covered = 0;
      sp.bands.forEach(function (b) { covered += b.to - b.from; });
      check(Math.abs(covered - 1) < 0.02, sp.id + ' bands do not cover the body (' +
        covered.toFixed(3) + ')');
    });

    BB.FLOWERS.forEach(function (f) {
      check(f.corollaDepthMm > 0, f.id + ' has no corolla depth');
      check(typeof f.colorPrimary === 'string' && f.colorPrimary.charAt(0) === '#' &&
        (f.colorPrimary.length === 4 || f.colorPrimary.length === 7),
        f.id + ' colorPrimary is not a hex colour: ' + f.colorPrimary);
      check(!!BB.Art.flowerSprite(f.id, 0), f.id + ' has no sprite');
      check(f.bloomHours[0] < f.bloomHours[1], f.id + ' bloom hours are inverted');
    });

    /* --- the reach ladder: this is the thesis of the design, so it is
           asserted directly rather than left to trust --- */
    function reachCount(flowerId) {
      var f = BB.getFlowerType(flowerId);
      var n = 0;
      BB.SPECIES.forEach(function (sp) { if (BB.canReach(sp, f)) n++; });
      return n;
    }
    check(reachCount('white_clover') === 5, 'all five species should reach white clover, got ' +
      reachCount('white_clover'));
    check(reachCount('red_clover') === 4, 'exactly four species should reach red clover, got ' +
      reachCount('red_clover'));
    check(reachCount('comfrey') === 2, 'exactly two species should reach comfrey, got ' +
      reachCount('comfrey'));
    check(reachCount('foxglove') === 2, 'exactly two species should reach foxglove, got ' +
      reachCount('foxglove'));
    check(reachCount('fuchsia') === 1, 'only Bombus dahlbomii should reach fuchsia, got ' +
      reachCount('fuchsia'));
    check(BB.canReach(BB.getSpecies('dahlbomii'), BB.getFlowerType('fuchsia')),
      'dahlbomii must reach fuchsia');
    check(!BB.canReach(BB.getSpecies('terrestris'), BB.getFlowerType('red_clover')),
      'terrestris must not reach red clover');

    /* --- baked art really contains pixels --- */
    BB.SPECIES.forEach(function (sp) {
      var s = BB.Art.bakeBee(sp);
      check(s.body.width > 4 && s.body.height > 4, sp.id + ' body sprite is degenerate');
      check(U.canvasHasInk(s.body), sp.id + ' body sprite baked empty');
      check(U.canvasHasInk(s.wing.crisp.canvas), sp.id + ' wing sprite baked empty');
      check(s.wing.envelopes.length === 3, sp.id + ' should have 3 blur envelopes');
      check(U.canvasHasInk(s.wing.envelopes[1].canvas), sp.id + ' wing envelope baked empty');
    });
    BB.FLOWERS.forEach(function (f) {
      var sprite = BB.Art.flowerSprite(f.id, 0);
      check(U.canvasHasInk(sprite.canvas), f.id + ' sprite baked empty');
    });
    check(U.canvasHasInk(BB.Art.treeLine()), 'tree line baked empty');
    check(U.canvasHasInk(BB.Art.midGrass()), 'mid grass baked empty');
    check(U.canvasHasInk(BB.Art.groundStrip()), 'ground baked empty');
    check(U.canvasHasInk(BB.Art.nestSprite().canvas), 'nest baked empty');

    /* --- the sky is defined at every hour, with no gap between keyframes --- */
    for (var h = 0; h <= 24; h += 0.5) {
      var s2 = BB.World.skyAt(h);
      check(s2 && s2.top.length === 3 && isFinite(s2.top[0]),
        'sky undefined at hour ' + h);
    }

    /* --- a headless flight: 60 seconds of scripted input --- */
    var testBee = BB.Bee.create(BB.getSpecies('terrestris'), 600, BB.World.GROUND_Y - 200);
    testBee.thoraxC = 34;
    BB.Bee.setState(testBee, 'FLYING');
    var fakeInput = { ax: 1, ay: -0.35, probe: false, buzz: false, sip: false };
    var quietHooks = {
      toast: function () {}, onLand: function () {}, onLeave: function () {},
      onRob: function () {}, onDeposit: function () {}, onHit: function () {},
      collapse: function () {}
    };
    for (var step = 0; step < 3600; step++) {
      if (step === 1800) { fakeInput.ax = -1; fakeInput.ay = 0.4; }
      BB.Bee.update(testBee, FIXED_DT, fakeInput, quietHooks);
      if (!isFinite(testBee.x) || !isFinite(testBee.y) ||
        !isFinite(testBee.vx) || !isFinite(testBee.vy) || !isFinite(testBee.energy)) {
        check(false, 'bee simulation produced a non-finite value at step ' + step);
        break;
      }
    }
    check(testBee.x >= 0 && testBee.x <= BB.World.WIDTH, 'bee escaped the world in x');
    check(testBee.y <= BB.World.GROUND_Y + 5, 'bee sank through the ground');
    check(testBee.energy < BB.getSpecies('terrestris').energyMax,
      'flying for a minute should cost energy');

    /* --- colony arithmetic. This runs before any real run starts, and leaves
           the colony freshly reset behind it. --- */
    BB.Colony.reset();
    var q1 = BB.Colony.quotaFor(1), q7 = BB.Colony.quotaFor(7);
    check(q7.nectar > q1.nectar * 2, 'the season should get significantly harder');
    BB.Colony.deposit(q1.nectar, q1.pollen, 0);
    var rep = BB.Colony.endOfDay();
    check(rep.quotaMet === true, 'meeting the quota exactly should count as met');
    check(rep.laid >= 1, 'meeting the quota should produce an egg');
    BB.Colony.reset();

    var result = { pass: failures.length === 0, failures: failures, checks: true };
    window.__SELFTEST__ = result;
    if (result.pass) {
      window.console.log('%cselfTest: all checks passed', 'color:#5c5');
    } else {
      window.console.error('selfTest failed:\n - ' + failures.join('\n - '));
    }
    return result;
  }

  /* ---------------------------------------------------------------- boot ---- */

  function boot() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    ctx.lineJoin = 'round';

    BB.Storage.load();
    if (BB.Storage.data.settings && BB.Storage.data.settings.muted) BB.Audio.setMuted(true);

    resize();
    window.addEventListener('resize', function () {
      window.requestAnimationFrame(resize);
    });
    window.addEventListener('orientationchange', function () {
      window.setTimeout(resize, 120);
    });

    BB.Input.attach();
    BB.Hud.init({
      onStart: function (speciesId) { startRun(speciesId); },
      onResume: resume,
      onQuit: function () {
        endRun('You abandoned the nest.');
      },
      onNextDay: function () {
        if (BB.Colony.state.finished) endRun(overReason);
        else beginNextDay();
      }
    });

    window.requestAnimationFrame(frame);

    /* Building the meadow bakes every plant sprite and the parallax strips, so
       it happens one frame after the title screen is already on-screen. */
    window.requestAnimationFrame(function () {
      var t0 = performance.now();
      BB.World.init(seed, 1);
      BB.Colony.reset();
      BB.Hazards.init(1);
      worldReady = true;
      window.console.log('world built in ' + (performance.now() - t0).toFixed(0) + ' ms');

      /* Optional shortcuts for testing a specific situation. The self test runs
         first because it resets the colony, which would wipe a started run. */
      if (U.paramFlag('selftest')) {
        window.setTimeout(selfTest, 30);
      }
      var wantSpecies = U.params.species;
      if (wantSpecies) {
        window.setTimeout(function () {
          BB.Hud.selectSpecies(wantSpecies);
          startRun(wantSpecies);
        }, 140);
      }
    });
  }

  BB.Game = {
    boot: boot,
    startRun: startRun,
    pause: pause,
    resume: resume,
    get mode() { return mode; },
    get bee() { return bee; },
    get cam() { return cam; },
    get particles() { return particles; }
  };

  BB.Debug = {
    selfTest: selfTest,
    get stats() { return stats; },
    get fpsAvg() { return stats.fps; },
    toggle: function () { showDebug = !showDebug; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.BB = window.BB || {});
