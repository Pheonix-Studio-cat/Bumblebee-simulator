/* Bumblebee Simulator - the things that want to eat you.
 *
 * Both hazards here are real. Birds take bumblebees on the wing, and the crab
 * spider Misumena vatia sits colour-matched on pale flowers and ambushes bees
 * far larger than itself. Both are given a deliberate tell, so being caught is
 * always the player's mistake rather than bad luck.
 */
(function (BB) {
  'use strict';

  var U = BB.Util;
  var TAU = U.TAU;

  var birds = [];
  var spiders = [];
  var relocateTimer = 0;

  /* ==================================================================== */
  /*  Crab spiders                                                        */
  /* ==================================================================== */

  function placeSpiders(count) {
    spiders = [];
    var plants = BB.World.plants;
    if (!plants.length) return;
    var rng = U.loose;
    var tries = 0;
    while (spiders.length < count && tries < count * 60) {
      tries++;
      var p = plants[Math.floor(rng() * plants.length)];
      if (!p || p.spider) continue;
      /* They favour pale, open flowers - which is exactly where the bee wants
         to be, and why the tell matters. */
      if (rng() > p.type.spiderChance * 4) continue;
      var s = {
        plant: p,
        /* Real crab spiders shift colour over days to match their flower. */
        hue: p.type.colorPrimary,
        alert: 0,
        cooldown: 0,
        legPhase: rng() * TAU
      };
      p.spider = s;
      spiders.push(s);
    }
  }

  function relocateSpiders() {
    spiders.forEach(function (s) { if (s.plant) s.plant.spider = null; });
    placeSpiders(spiders.length || 5);
  }

  /* ==================================================================== */
  /*  Birds                                                              */
  /* ==================================================================== */

  function spawnBirds(count) {
    birds = [];
    var W = BB.World;
    for (var i = 0; i < count; i++) {
      var homeX = 900 + (i + 0.5) * (W.WIDTH - 1400) / count;
      birds.push({
        x: homeX,
        y: W.GROUND_Y - 420 - i * 90,
        vx: 130,
        vy: 0,
        homeX: homeX,
        range: 900,
        facing: 1,
        state: 'PATROL',
        stateTime: 0,
        cooldown: 12,          /* no chasing for the first few seconds of a day */
        flap: 0,
        chaseTime: 0
      });
    }
  }

  function updateBird(b, dt, bee) {
    var W = BB.World;
    b.stateTime += dt;
    b.cooldown = Math.max(0, b.cooldown - dt);
    b.flap += dt * (b.state === 'CHASE' ? 17 : 8);

    var altitude = W.GROUND_Y - bee.y;
    var airborne = bee.state === 'FLYING' || bee.state === 'FALLING';
    var sheltered = W.shelterAt(bee.x, bee.y);
    var d = U.dist(b.x, b.y, bee.x, bee.y);

    if (b.state === 'PATROL') {
      /* Lazy patrol along a stretch of the meadow. */
      if (b.x < b.homeX - b.range) b.vx = Math.abs(b.vx);
      if (b.x > b.homeX + b.range) b.vx = -Math.abs(b.vx);
      b.vx = U.approach(b.vx, b.vx > 0 ? 140 : -140, 1.2, dt);
      b.vy = U.approach(b.vy, Math.sin(b.stateTime * 0.7) * 30, 1.5, dt);

      if (b.cooldown <= 0 && airborne && !sheltered && altitude > 150 && d < 900) {
        b.state = 'CHASE';
        b.stateTime = 0;
        b.chaseTime = 0;
        BB.Audio.blip('alarm');
      }
    } else if (b.state === 'CHASE') {
      b.chaseTime += dt;
      /* Fast but clumsy: a bird turns at about 1.4 rad/s where the bee turns
         several times quicker, so tight turns are the counterplay. */
      var want = Math.atan2(bee.y - b.y, bee.x - b.x);
      var cur = Math.atan2(b.vy, b.vx);
      var turned = U.wrapAngle(want - cur);
      var maxTurn = 1.4 * dt;
      cur += U.clamp(turned, -maxTurn, maxTurn);
      var sp = 420;
      b.vx = Math.cos(cur) * sp;
      b.vy = Math.sin(cur) * sp;

      /* Diving into flower cover makes it give up. */
      if (sheltered || !airborne) {
        if (b.stateTime > 0.9) breakOff(b);
      } else if (b.chaseTime > 9 || d > 1500) {
        breakOff(b);
      }
    } else {
      /* BREAK_OFF: climb away and lose interest. */
      b.vy = U.approach(b.vy, -80, 1.2, dt);
      b.vx = U.approach(b.vx, b.facing * 190, 1.0, dt);
      if (b.stateTime > 4) {
        b.state = 'PATROL';
        b.stateTime = 0;
      }
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.y = U.clamp(b.y, W.CEILING_Y - 100, W.GROUND_Y - 90);
    b.x = U.clamp(b.x, 100, W.WIDTH - 100);
    if (Math.abs(b.vx) > 20) b.facing = b.vx > 0 ? 1 : -1;

    return d;
  }

  function breakOff(b) {
    b.state = 'BREAK_OFF';
    b.stateTime = 0;
    b.cooldown = 25;
  }

  /* ==================================================================== */

  function init(day) {
    var script = BB.World.DAY_SCRIPTS[Math.min(6, day - 1)];
    spawnBirds(script.birds);
    placeSpiders(4 + Math.min(3, Math.floor(day / 2)));
    relocateTimer = 45;
  }

  function update(dt, bee, hooks) {
    var i;

    /* ---- birds ---- */
    for (i = 0; i < birds.length; i++) {
      var b = birds[i];
      var d = updateBird(b, dt, bee);
      if (b.state === 'CHASE' && d < bee.L * 0.7 + 26 && bee.alive) {
        BB.Bee.hit(bee, 32, 0.4, 'A bird struck you in mid-air.', hooks);
        /* Knocked out of the sky. */
        bee.vx += b.vx * 0.35;
        bee.vy += 220;
        breakOff(b);
      }
    }

    /* ---- spiders ---- */
    relocateTimer -= dt;
    if (relocateTimer <= 0) {
      relocateTimer = 45;
      relocateSpiders();
    }

    for (i = 0; i < spiders.length; i++) {
      var s = spiders[i];
      s.legPhase += dt * 1.6;
      s.cooldown = Math.max(0, s.cooldown - dt);

      var onIt = bee.flower === s.plant &&
        (bee.state === 'LANDED' || bee.state === 'LANDING');

      if (onIt && s.cooldown <= 0) {
        /* Half a second of visible rearing before the strike. */
        s.alert += dt;
        if (s.alert > 0.15 && s.alert - dt <= 0.15) {
          hooks.toast('A crab spider is on this flower!', 'bad');
          BB.Audio.blip('alarm');
        }
        if (s.alert > 0.65) {
          s.alert = 0;
          s.cooldown = 8;
          BB.Bee.hit(bee, 26, 1.0, 'A crab spider had you. You lost your whole load.', hooks);
          BB.Bee.grab(bee, 1.1);
        }
      } else {
        s.alert = Math.max(0, s.alert - dt * 2);
      }
    }
  }

  /* ==================================================================== */
  /*  Rendering                                                           */
  /* ==================================================================== */

  function drawBird(ctx, b) {
    var flapAng = Math.sin(b.flap) * 0.9;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(b.facing, 1);

    /* far wing */
    ctx.save();
    ctx.rotate(-flapAng * 0.8);
    ctx.beginPath();
    ctx.moveTo(-2, -2);
    ctx.quadraticCurveTo(-26, -16, -46, -6);
    ctx.quadraticCurveTo(-28, 4, -2, 4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(48,44,40,0.85)';
    ctx.fill();
    ctx.restore();

    /* tail */
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-34, -7);
    ctx.lineTo(-33, 5);
    ctx.closePath();
    ctx.fillStyle = '#4a4238';
    ctx.fill();

    /* body */
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 11, 0.08, 0, TAU);
    var g = ctx.createLinearGradient(0, -11, 0, 11);
    g.addColorStop(0, '#5c5346');
    g.addColorStop(0.55, '#6b6154');
    g.addColorStop(1, '#c8bda6');
    ctx.fillStyle = g;
    ctx.fill();

    /* head and beak */
    ctx.beginPath();
    ctx.arc(17, -5, 8, 0, TAU);
    ctx.fillStyle = '#584f42';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(24, -5);
    ctx.lineTo(35, -3);
    ctx.lineTo(24, -1);
    ctx.closePath();
    ctx.fillStyle = '#2e2822';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20, -7, 1.9, 0, TAU);
    ctx.fillStyle = '#100c08';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20.6, -7.6, 0.7, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();

    /* near wing */
    ctx.save();
    ctx.rotate(flapAng);
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.quadraticCurveTo(-24, -22, -50, -10);
    ctx.quadraticCurveTo(-26, 2, 0, 3);
    ctx.closePath();
    var wg = ctx.createLinearGradient(0, -18, -40, 2);
    wg.addColorStop(0, '#6e6455');
    wg.addColorStop(1, '#413a31');
    ctx.fillStyle = wg;
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  function drawSpider(ctx, s) {
    var p = s.plant;
    if (!p) return;
    var a = BB.World.anchorWorld(p);
    var rear = U.clamp(s.alert / 0.65, 0, 1);
    var sz = 7 + rear * 3;

    ctx.save();
    ctx.translate(a.x, a.y - 3);

    var body = U.hexToRgb(s.hue);
    var legCol = U.rgbStr(U.mixRgb(body, [90, 80, 40], 0.35), 0.95);

    /* Eight legs, the front two pairs long and held out like a crab's claws.
       Those pale tips are the tell you can spot from a distance. */
    ctx.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      for (var side = -1; side <= 1; side += 2) {
        var isFront = i < 2;
        var len = isFront ? sz * (2.3 - i * 0.3) : sz * 1.15;
        var base = isFront ? (-0.75 - i * 0.35) : (0.5 + i * 0.45);
        var ang = base * side + (side < 0 ? Math.PI : 0);
        var wob = Math.sin(s.legPhase + i) * 0.06;
        var kx = Math.cos(ang + wob) * len * 0.6;
        var ky = Math.sin(ang + wob) * len * 0.6 - (isFront ? rear * 5 : 0);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(kx, ky, kx * 1.5, ky * 1.5 + len * 0.28);
        ctx.lineWidth = isFront ? 1.7 : 1.3;
        ctx.strokeStyle = legCol;
        ctx.stroke();
      }
    }

    /* flattened abdomen */
    ctx.beginPath();
    ctx.ellipse(0, 1, sz * 0.95, sz * 0.78, 0, 0, TAU);
    var g = ctx.createRadialGradient(-sz * 0.3, -sz * 0.3, sz * 0.1, 0, 0, sz);
    g.addColorStop(0, U.rgbStr(U.mixRgb(body, [255, 255, 255], 0.35)));
    g.addColorStop(1, U.rgbStr(U.mixRgb(body, [120, 110, 60], 0.4)));
    ctx.fillStyle = g;
    ctx.fill();
    /* the two red streaks Misumena often carries */
    ctx.fillStyle = 'rgba(190,70,70,0.5)';
    ctx.beginPath();
    ctx.ellipse(-sz * 0.4, 2, sz * 0.2, sz * 0.5, 0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sz * 0.4, 2, sz * 0.2, sz * 0.5, -0.2, 0, TAU);
    ctx.fill();

    /* cephalothorax and eyes */
    ctx.beginPath();
    ctx.ellipse(0, -sz * 0.72, sz * 0.5, sz * 0.4, 0, 0, TAU);
    ctx.fillStyle = U.rgbStr(U.mixRgb(body, [200, 190, 130], 0.3));
    ctx.fill();
    ctx.fillStyle = 'rgba(20,16,10,0.9)';
    for (var e = 0; e < 4; e++) {
      ctx.beginPath();
      ctx.arc(-sz * 0.3 + e * sz * 0.2, -sz * 0.95, 0.8, 0, TAU);
      ctx.fill();
    }

    if (rear > 0.1) {
      ctx.beginPath();
      ctx.arc(0, 0, sz * 2.4, 0, TAU);
      ctx.strokeStyle = 'rgba(255,70,60,' + (rear * 0.5).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  function render(ctx, cam) {
    var i;
    for (i = 0; i < spiders.length; i++) {
      var s = spiders[i];
      if (!s.plant) continue;
      if (s.plant.x < cam.visible.x0 - 100 || s.plant.x > cam.visible.x1 + 100) continue;
      drawSpider(ctx, s);
    }
    for (i = 0; i < birds.length; i++) {
      var b = birds[i];
      if (b.x < cam.visible.x0 - 120 || b.x > cam.visible.x1 + 120) continue;
      drawBird(ctx, b);
    }
  }

  /* Is a bird currently hunting? The HUD warns the player. */
  function threatLevel(bee) {
    var worst = 0;
    for (var i = 0; i < birds.length; i++) {
      if (birds[i].state !== 'CHASE') continue;
      var d = U.dist(birds[i].x, birds[i].y, bee.x, bee.y);
      worst = Math.max(worst, U.clamp(1 - d / 900, 0, 1));
    }
    return worst;
  }

  BB.Hazards = {
    init: init,
    update: update,
    render: render,
    threatLevel: threatLevel,
    get birds() { return birds; },
    get spiders() { return spiders; }
  };

})(window.BB = window.BB || {});
