/* Bumblebee Simulator - the bee you fly.
 *
 * Two rules from the real animal drive almost everything here:
 *
 *  1. A bumblebee cannot fly until its flight muscles are near 30 C. It warms
 *     them by uncoupling the wings and shivering. So on a cold morning you sit
 *     on the ground and vibrate before you can leave, and the species differ
 *     sharply in how fast and how cheaply they manage it.
 *
 *  2. The tongue is a hard limit. If the corolla is deeper than your tongue the
 *     nectar is simply out of reach - unless you are a buff-tailed bumblebee,
 *     which bites a hole in the base of the flower and robs it.
 */
(function (BB) {
  'use strict';

  var U = BB.Util;
  var Art = BB.Art;
  var TAU = U.TAU;

  var GRAVITY = 900;
  var FLIGHT_TEMP = 30;          /* degrees C in the thorax needed to fly */

  /* Leg pose targets. Angles are radians from "forward"; PI/2 points straight
     down. `t` is the tucked-in flight pose, `e` the extended standing pose. */
  var LEGS = [
    { anchor: 'legFront', fem: [2.55, 1.05], tib: [1.55, 1.72], tar: [1.30, 2.05], len: [0.155, 0.140, 0.085] },
    { anchor: 'legMid',   fem: [2.70, 1.62], tib: [1.70, 1.86], tar: [1.45, 2.10], len: [0.170, 0.165, 0.095] },
    { anchor: 'legHind',  fem: [2.88, 2.08], tib: [1.85, 1.94], tar: [1.60, 2.18], len: [0.205, 0.215, 0.105] }
  ];

  function create(species, x, y) {
    var sprite = Art.bakeBee(species);
    var pollenRgb = U.hexToRgb('#d8c274');

    var bee = {
      species: species,
      sprite: sprite,
      L: sprite.lengthPx,

      x: x, y: y,
      prevX: x, prevY: y,
      vx: 0, vy: 0,
      facing: 1,
      pitch: 0,
      throttle: 0,

      energy: species.energyMax,
      energyMax: species.energyMax,
      thoraxC: 12,

      nectar: 0,
      pollen: 0,
      contaminated: 0,
      toxin: 0,
      pollenRgb: pollenRgb,

      state: 'GROUNDED',
      stateTime: 0,
      alive: true,

      flower: null,
      probeExtend: 0,
      robTimer: 0,
      drinking: false,
      shivering: false,
      sonicating: false,
      rejected: null,          /* {depth, reach} while a flower is out of reach */
      gotFromFlower: 0,

      lastFlowerId: null,
      streak: 0,

      legExtend: 0,
      wingBlend: 0,
      walkPhase: 0,
      antennaPhase: Math.random() * TAU,
      renderClock: 0,
      depositTimer: 0,
      grabTimer: 0,
      groundedTimer: 0,
      hitFlash: 0,

      /* Rolling per-day tallies used by the HUD. */
      tripNectar: 0,
      tripPollen: 0
    };

    return bee;
  }

  function loadFraction(bee) {
    var sp = bee.species;
    return U.clamp(
      0.6 * (bee.nectar / sp.nectarCapacity) + 0.4 * (bee.pollen / sp.pollenCapacity),
      0, 1);
  }

  /* Warm enough to get off the ground. */
  function canFly(bee) {
    return bee.thoraxC >= FLIGHT_TEMP && bee.energy > 0;
  }

  /* Warm enough to stay up. Deliberately three degrees lower than takeoff:
     working flight muscles generate their own heat, so a bee that is already
     airborne keeps flying, and the player never gets knocked out of the sky by
     a rounding error at exactly 30 degrees. */
  function canStayAirborne(bee) {
    return bee.thoraxC >= FLIGHT_TEMP - 3 && bee.energy > 0;
  }

  /* The temperature a bee leaves the nest with: it has been warming up inside,
     but loses a good part of that at the entrance. */
  function nestWarmth(airTempC) {
    return U.lerp(airTempC, FLIGHT_TEMP, 0.55);
  }

  /* ==================================================================== */
  /*  Simulation                                                          */
  /* ==================================================================== */

  function update(bee, dt, input, hooks) {
    var W = BB.World;
    var sp = bee.species;

    bee.prevX = bee.x;
    bee.prevY = bee.y;
    bee.stateTime += dt;
    bee.renderClock += dt;
    bee.hitFlash = Math.max(0, bee.hitFlash - dt * 2.5);

    var air = W.airTempC;
    var sheltered = W.shelterAt(bee.x, bee.y);

    /* ---- thermoregulation ---- */
    var cooling = 0.035 * (bee.thoraxC - air) *
      (W.isRaining && !sheltered ? 2.2 : 1) *
      (1 + Math.abs(W.wind) / 400);
    bee.thoraxC -= cooling * dt;
    if (!sheltered && !W.isRaining) {
      bee.thoraxC += sp.solarGain * W.light.intensity * 1.2 * dt;
    }
    if (bee.state === 'FLYING') bee.thoraxC += 0.9 * dt;

    bee.shivering = false;
    bee.sonicating = false;

    /* ---- state machine ---- */
    switch (bee.state) {

      case 'FLYING':
        flyingUpdate(bee, dt, input, hooks);
        break;

      case 'LANDING': {
        var a = bee.landTarget;
        var k = U.clamp(bee.stateTime / 0.24, 0, 1);
        bee.x = U.lerp(bee.landFrom.x, a.x, U.easeOutCubic(k));
        bee.y = U.lerp(bee.landFrom.y, a.y, U.easeOutCubic(k));
        bee.vx *= 0.7; bee.vy *= 0.7;
        bee.legExtend = U.approach(bee.legExtend, 1, 12, dt);
        bee.throttle = U.approach(bee.throttle, 0, 6, dt);
        if (k >= 1) setState(bee, 'LANDED');
        break;
      }

      case 'LANDED':
        landedUpdate(bee, dt, input, hooks);
        break;

      case 'GROUNDED':
        groundedUpdate(bee, dt, input, hooks);
        break;

      case 'DEPOSITING':
        bee.depositTimer -= dt;
        bee.throttle = 0;
        bee.legExtend = 1;
        if (bee.depositTimer <= 0) {
          finishDeposit(bee, hooks);
        }
        break;

      case 'FALLING':
        bee.vy += GRAVITY * 0.85 * dt;
        bee.vx = U.approach(bee.vx, W.wind * 0.3, 1.2, dt);
        bee.x += bee.vx * dt;
        bee.y += bee.vy * dt;
        bee.throttle = 0;
        bee.legExtend = U.approach(bee.legExtend, 1, 4, dt);
        if (bee.y >= W.GROUND_Y - bee.L * 0.16) {
          bee.y = W.GROUND_Y - bee.L * 0.16;
          bee.vy = 0;
          setState(bee, 'GROUNDED');
          hooks.toast('You dropped out of the air.', 'bad');
        }
        break;

      case 'GRABBED':
        bee.grabTimer -= dt;
        bee.throttle = 0;
        /* Struggling: any directional input shortens the hold. */
        if (Math.abs(input.ax) > 0.4 || Math.abs(input.ay) > 0.4) {
          bee.grabTimer -= dt * 2.2;
          bee.x += U.rand(U.loose, -2, 2);
          bee.y += U.rand(U.loose, -2, 2);
        }
        if (bee.grabTimer <= 0) {
          setState(bee, 'FLYING');
          bee.vy = -180;
          hooks.toast('You tore free.', 'info');
        }
        break;
    }

    /* ---- energy ---- */
    var speed = Math.hypot(bee.vx, bee.vy);
    var speedFrac = U.clamp(speed / sp.maxSpeed, 0, 1.4);
    var tempPenalty = 1 +
      0.06 * Math.max(0, sp.coldToleranceC - air) +
      0.05 * Math.max(0, air - sp.heatToleranceC);
    var drain;
    if (bee.state === 'FLYING') {
      drain = sp.energyDrain * (1 + 0.9 * speedFrac * speedFrac) *
        (1 + 0.45 * loadFraction(bee)) * tempPenalty;
    } else if (bee.shivering) {
      drain = sp.energyDrain * 2.2 * tempPenalty;
    } else if (bee.sonicating) {
      drain = sp.energyDrain * 1.8;
    } else {
      drain = sp.energyDrain * 0.22 * tempPenalty;
    }
    if (bee.toxin > 0.6) drain *= 1.6;
    bee.energy -= drain * dt;

    /* Drinking your own stores: the constant tension between surviving the
       flight home and actually having something to deliver. */
    if (input.sip && bee.nectar > 0 && bee.energy < bee.energyMax) {
      var sip = Math.min(bee.nectar, 9 * dt);
      bee.nectar -= sip;
      bee.energy = Math.min(bee.energyMax, bee.energy + sip * 0.62);
      if (!bee._sipSound) { BB.Audio.blip('sip'); bee._sipSound = 0.4; }
    }
    if (bee._sipSound) bee._sipSound = Math.max(0, bee._sipSound - dt);

    /* ---- toxins ---- */
    if (W.inSprayedZone(bee.x)) {
      bee.toxin = Math.min(1.2, bee.toxin + 0.11 * dt);
    } else {
      bee.toxin = Math.max(0, bee.toxin - 0.03 * dt);
    }
    if (bee.toxin >= 1.0 && bee.alive) {
      hooks.collapse('The pesticide load was too much. You could not find your way home.');
      return;
    }

    bee.energy = U.clamp(bee.energy, 0, bee.energyMax);
    bee.thoraxC = U.clamp(bee.thoraxC, -5, 46);

    /* Out of fuel in the air: you fall. */
    if (bee.energy <= 0 && (bee.state === 'FLYING')) {
      setState(bee, 'FALLING');
    }

    /* Out of fuel on the ground with nothing left to drink is the end. */
    if (bee.state === 'GROUNDED' && bee.energy <= 0.2 && bee.nectar <= 0.2) {
      bee.groundedTimer += dt;
      if (bee.groundedTimer > 12) {
        hooks.collapse('You ran out of energy on the ground, too cold to move.');
        return;
      }
    } else {
      bee.groundedTimer = 0;
    }

    /* Visual smoothing that has no effect on the simulation. */
    bee.walkPhase += dt * (bee.state === 'LANDED' ? 1.4 : 0.4);
    bee.antennaPhase += dt * 2.4;

    var targetBlend = bee.throttle < 0.25 ? 0 : (bee.throttle < 0.7 ? 1 : 2);
    bee.wingBlend = U.approach(bee.wingBlend, targetBlend, 8, dt);

    /* Sound. The frequency is the species' real wingbeat. */
    if (bee.state === 'FLYING' || bee.state === 'FALLING') {
      BB.Audio.setFlight(U.clamp(bee.throttle, 0.12, 1), sp.wingbeatHz, false);
    } else if (bee.shivering) {
      BB.Audio.setFlight(0.5, sp.wingbeatHz, true);
    } else if (bee.sonicating) {
      BB.Audio.sonicate(true);
    } else {
      BB.Audio.silenceFlight();
    }
  }

  function setState(bee, s) {
    bee.state = s;
    bee.stateTime = 0;
    if (s !== 'LANDED') {
      bee.drinking = false;
      bee.probeExtend = 0;
      bee.robTimer = 0;
      bee.rejected = null;
    }
  }

  function flyingUpdate(bee, dt, input, hooks) {
    var W = BB.World;
    var sp = bee.species;
    var load = loadFraction(bee);
    /* Already airborne, so the lower threshold applies. */
    var flyable = canStayAirborne(bee);

    if (!flyable) {
      setState(bee, 'FALLING');
      hooks.toast(bee.thoraxC < FLIGHT_TEMP - 3
        ? 'Your flight muscles have gone cold.'
        : 'You have no energy left to fly.', 'bad');
      return;
    }

    var accel = sp.accel * (1 - 0.30 * load);
    var ax = input.ax * accel;
    var ay = input.ay * accel;

    /* A little residual weight, so holding altitude is an active choice. */
    ay += GRAVITY * 0.13;

    /* Wind pushes a light bee around far more than a heavy one. */
    ax += W.wind * (0.9 / sp.massFactor);
    if (W.isRaining && !W.shelterAt(bee.x, bee.y)) {
      ay += 260 * W.state.rainIntensity;
      accel *= 0.7;
    }

    bee.vx += ax * dt;
    bee.vy += ay * dt;

    var dragK = 2.2 - sp.agility * 0.8;
    var damp = Math.exp(-dragK * dt);
    bee.vx *= damp;
    bee.vy *= damp;

    var maxV = sp.maxSpeed * (1 - 0.25 * load);
    var speed = Math.hypot(bee.vx, bee.vy);
    if (speed > maxV) {
      bee.vx *= maxV / speed;
      bee.vy *= maxV / speed;
    }

    bee.x += bee.vx * dt;
    bee.y += bee.vy * dt;

    /* World bounds. */
    bee.x = U.clamp(bee.x, 30, W.WIDTH - 30);
    if (bee.y < W.CEILING_Y) { bee.y = W.CEILING_Y; bee.vy = Math.max(0, bee.vy); }
    var floor = W.GROUND_Y - bee.L * 0.16;
    if (bee.y > floor) {
      bee.y = floor;
      bee.vy = Math.min(0, bee.vy);
      if (input.ay > 0.2) setState(bee, 'GROUNDED');
    }

    bee.throttle = U.approach(bee.throttle,
      U.clamp(Math.hypot(input.ax, input.ay) * 0.55 + speed / sp.maxSpeed * 0.6, 0.12, 1),
      7, dt);

    if (Math.abs(bee.vx) > 14) bee.facing = bee.vx > 0 ? 1 : -1;
    var pitchTarget = U.clamp(-bee.vy / sp.maxSpeed * 1.15, -0.42, 0.42)
      - U.clamp(Math.abs(bee.vx) / sp.maxSpeed, 0, 1) * 0.1;
    bee.pitch = U.approach(bee.pitch, pitchTarget, 8, dt);
    bee.legExtend = U.approach(bee.legExtend, 0.18, 5, dt);

    /* ---- landing on a flower, or diving into the nest ---- */
    var nest = W.nest;
    var nearNest = U.dist(bee.x, bee.y, nest.holeX, nest.holeY) < 74;
    if (nearNest && input.probe) {
      startDeposit(bee, hooks);
      return;
    }

    var target = W.nearestLandable(bee.x, bee.y, 44 + bee.L * 0.4);
    bee.nearFlower = target;
    if (target && input.probe && speed < 260) {
      bee.flower = target;
      bee.landFrom = { x: bee.x, y: bee.y };
      bee.landTarget = { x: target._anchor.x, y: target._anchor.y - bee.L * 0.10 };
      setState(bee, 'LANDING');
      BB.Audio.blip('land');
      /* Flower constancy: sticking to one species pollinates it properly. */
      if (bee.lastFlowerId === target.typeId) bee.streak += 1;
      else bee.streak = 1;
      bee.lastFlowerId = target.typeId;
      bee.gotFromFlower = 0;
      hooks.onLand(target);
    }
  }

  function landedUpdate(bee, dt, input, hooks) {
    var W = BB.World;
    var sp = bee.species;
    var f = bee.flower;

    bee.legExtend = U.approach(bee.legExtend, 1, 10, dt);
    bee.throttle = U.approach(bee.throttle, 0, 8, dt);
    bee.vx = bee.vy = 0;

    /* Stay attached to the flower as it sways. */
    if (f) {
      var a = W.anchorWorld(f);
      bee.x = a.x;
      bee.y = a.y - bee.L * 0.10;
      bee.pitch = U.approach(bee.pitch, W.swayOf(f) * 0.6, 6, dt);
    }

    /* Leaving. */
    if (!input.probe) {
      leaveFlower(bee, hooks);
      return;
    }

    if (!f) { setState(bee, 'FLYING'); return; }

    var reach = sp.tongueMm;
    var depth = f.type.corollaDepthMm;
    var reachable = reach >= depth;
    var canOpen = reachable || f.robbed;

    /* Shift while landed: vibrate. On a buzz-pollinated flower it shakes the
       pollen out; otherwise it warms up your flight muscles. */
    if (input.buzz) {
      if (f.type.buzzPollinated) {
        bee.sonicating = true;
      } else if (bee.thoraxC < 42) {
        bee.shivering = true;
        bee.thoraxC += sp.shiverRate * dt;
      }
    }

    /* Nectar. */
    bee.drinking = false;
    if (f.type.nectarPool > 0) {
      if (canOpen) {
        bee.probeExtend = U.approach(bee.probeExtend, 1, 6, dt);
        if (bee.probeExtend > 0.55 && f.nectar > 0.01 && bee.nectar < sp.nectarCapacity) {
          var rate = sp.probeRate * BB.yieldMultiplier(sp, f.type) * (f.robbed && !reachable ? sp.robYield : 1);
          var got = Math.min(rate * dt, f.nectar, sp.nectarCapacity - bee.nectar);
          f.nectar -= got;
          bee.nectar += got;
          bee.gotFromFlower += got;
          bee.tripNectar += got;
          bee.drinking = got > 0;
          if (f.sprayed) bee.contaminated += got;
        }
      } else if (sp.canRob) {
        /* Bite a hole through the base instead. */
        bee.probeExtend = U.approach(bee.probeExtend, 0.35, 6, dt);
        bee.robTimer += dt;
        bee.rejected = { depth: depth, reach: reach, robbing: true,
          progress: U.clamp(bee.robTimer / sp.robSeconds, 0, 1) };
        if (bee.robTimer >= sp.robSeconds) {
          f.robbed = true;
          bee.rejected = null;
          hooks.onRob(f);
        }
      } else {
        bee.probeExtend = U.approach(bee.probeExtend, 0.28, 6, dt);
        bee.rejected = { depth: depth, reach: reach, robbing: false, progress: 0 };
      }
    } else {
      bee.probeExtend = U.approach(bee.probeExtend, 0.2, 6, dt);
    }

    /* Pollen. Buzz-pollinated flowers give up nothing unless you vibrate. */
    if (bee.pollen < sp.pollenCapacity && f.pollenLeft > 0.001) {
      var pRate = sp.pollenRate;
      if (f.type.buzzPollinated) pRate = bee.sonicating ? sp.pollenRate * 3 : 0;
      else if (!reachable && !f.robbed) pRate *= 0.6;   /* scrabbling at the outside */
      if (pRate > 0) {
        var gotP = Math.min(pRate * dt, f.pollenLeft, sp.pollenCapacity - bee.pollen);
        f.pollenLeft -= gotP;
        bee.pollen += gotP;
        bee.tripPollen += gotP;
        if (gotP > 0) {
          /* The corbiculae visibly take on the colour of whatever you last
             worked, which is why a bugloss route turns them slate blue. */
          var target = U.hexToRgb(f.type.pollenColor);
          var w = U.clamp(gotP / Math.max(0.5, bee.pollen), 0, 1);
          bee.pollenRgb = U.mixRgb(bee.pollenRgb, target, w);
          if (f.type.buzzPollinated && bee.sonicating) bee._buzzHarvest = true;
        }
      }
    }
  }

  function groundedUpdate(bee, dt, input, hooks) {
    var W = BB.World;
    var sp = bee.species;
    bee.vx = U.approach(bee.vx, 0, 6, dt);
    bee.y = W.GROUND_Y - bee.L * 0.16;
    bee.legExtend = U.approach(bee.legExtend, 1, 8, dt);
    bee.throttle = U.approach(bee.throttle, 0, 8, dt);
    bee.pitch = U.approach(bee.pitch, 0, 6, dt);

    /* Crawl a little. */
    if (Math.abs(input.ax) > 0.2) {
      bee.x += input.ax * 46 * dt;
      bee.facing = input.ax > 0 ? 1 : -1;
      bee.walkPhase += dt * 7;
    }
    bee.x = U.clamp(bee.x, 30, W.WIDTH - 30);

    /* Shivering: the only way off the ground on a cold morning. */
    if (input.buzz && bee.thoraxC < 42) {
      bee.shivering = true;
      bee.thoraxC += sp.shiverRate * dt;
    }

    var nest = W.nest;
    if (U.dist(bee.x, bee.y, nest.holeX, nest.holeY) < 74 && input.probe) {
      startDeposit(bee, hooks);
      return;
    }

    /* Take off. */
    if (input.ay < -0.35 && canFly(bee)) {
      setState(bee, 'FLYING');
      bee.vy = -150;
      BB.Audio.blip('ui');
    }
  }

  function leaveFlower(bee, hooks) {
    var f = bee.flower;
    if (f) {
      f.visits += 1;
      /* Pollination only really works when you have been faithful to one
         species - the pollen on your fur has to match the next stigma. */
      var pollinated = bee.streak >= 2 && (bee.gotFromFlower > 0.2 || bee.tripPollen > 0);
      if (pollinated) f.pollinated = true;
      hooks.onLeave(f, pollinated, bee.streak);
    }
    bee.flower = null;
    setState(bee, 'FLYING');
    bee.vy = -120;
    bee.throttle = 0.5;
  }

  function startDeposit(bee, hooks) {
    if (bee.nectar < 0.5 && bee.pollen < 0.05) {
      hooks.toast('Nothing to unload yet.', 'info');
      return;
    }
    setState(bee, 'DEPOSITING');
    bee.depositTimer = 0.7;
    var nest = BB.World.nest;
    bee.x = nest.holeX;
    bee.y = nest.holeY - bee.L * 0.2;
    BB.Audio.blip('deposit');
  }

  function finishDeposit(bee, hooks) {
    hooks.onDeposit(bee.nectar, bee.pollen, bee.contaminated);
    bee.nectar = 0;
    bee.pollen = 0;
    bee.contaminated = 0;
    bee.tripNectar = 0;
    bee.tripPollen = 0;
    /* Being in the nest warms you back up. */
    bee.thoraxC = Math.max(bee.thoraxC, 31);
    setState(bee, 'FLYING');
    bee.vy = -160;
  }

  /* Something hit or caught the bee. */
  function hit(bee, energyCost, dropFraction, reason, hooks) {
    bee.energy -= energyCost;
    bee.hitFlash = 1;
    if (dropFraction > 0) {
      bee.nectar *= (1 - dropFraction);
      bee.pollen *= (1 - dropFraction);
    }
    BB.Audio.blip('hurt');
    hooks.onHit(reason);
  }

  function grab(bee, seconds) {
    bee.flower = null;
    setState(bee, 'GRABBED');
    bee.grabTimer = seconds;
    BB.Audio.blip('alarm');
  }

  /* ==================================================================== */
  /*  Rendering                                                           */
  /* ==================================================================== */

  function drawLeg(ctx, bee, leg, side, phase) {
    var A = bee.sprite.anchors[leg.anchor];
    var L = bee.L;
    var ext = bee.legExtend;
    var bob = Math.sin(bee.walkPhase * 2 + phase) * 0.13 * ext;

    var femA = U.lerp(leg.fem[0], leg.fem[1], ext) + bob;
    var tibA = U.lerp(leg.tib[0], leg.tib[1], ext) - bob * 0.8;
    var tarA = U.lerp(leg.tar[0], leg.tar[1], ext);

    var x0 = A.x, y0 = A.y + (side < 0 ? 1.5 : -0.5);
    var x1 = x0 + Math.cos(femA) * leg.len[0] * L;
    var y1 = y0 + Math.sin(femA) * leg.len[0] * L;
    var x2 = x1 + Math.cos(tibA) * leg.len[1] * L;
    var y2 = y1 + Math.sin(tibA) * leg.len[1] * L;
    var x3 = x2 + Math.cos(tarA) * leg.len[2] * L;
    var y3 = y2 + Math.sin(tarA) * leg.len[2] * L;

    var shade = side < 0 ? 0.45 : 1;
    ctx.strokeStyle = 'rgba(' + Math.round(28 * shade + 8) + ',' +
      Math.round(20 * shade + 6) + ',' + Math.round(12 * shade + 4) + ',' +
      (side < 0 ? 0.7 : 0.95) + ')';
    ctx.lineCap = 'round';

    ctx.lineWidth = 0.042 * L;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineWidth = 0.030 * L;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.lineWidth = 0.019 * L;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();

    /* Bristles. */
    if (side > 0) {
      ctx.lineWidth = 0.009 * L;
      for (var b = 0; b < 5; b++) {
        var t = 0.2 + b * 0.18;
        var bx = U.lerp(x1, x2, t), by = U.lerp(y1, y2, t);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(tibA + 1.5) * 0.035 * L, by + Math.sin(tibA + 1.5) * 0.035 * L);
        ctx.stroke();
      }
    }

    /* The hind tibia carries the pollen basket. */
    if (leg.anchor === 'legHind' && side > 0) {
      drawCorbicula(ctx, bee, U.lerp(x1, x2, 0.52), U.lerp(y1, y2, 0.52), tibA);
    }
  }

  /* The corbicula - the pollen basket on the outside of the hind tibia. It is
     the clearest readout in the game: it visibly grows and takes on the colour
     of whatever plant you have been working. */
  function drawCorbicula(ctx, bee, cx, cy, ang) {
    var frac = U.clamp(bee.pollen / bee.species.pollenCapacity, 0, 1);
    var L = bee.L;
    var c = bee.pollenRgb;

    /* Nine stiff hairs that hold the load in place. */
    ctx.lineWidth = 0.011 * L;
    ctx.strokeStyle = 'rgba(30,22,14,0.8)';
    for (var h = 0; h < 9; h++) {
      var a = ang + 1.5 + (h - 4) * 0.18;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 0.075 * L, cy + Math.sin(a) * 0.075 * L);
      ctx.stroke();
    }

    if (frac <= 0.004) return;

    var r = (0.028 + 0.078 * frac) * L;
    var px = cx + Math.cos(ang + 1.5) * r * 0.55;
    var py = cy + Math.sin(ang + 1.5) * r * 0.55;

    var g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.35, r * 0.1, px, py, r);
    g.addColorStop(0, U.rgbStr(U.mixRgb(c, [255, 255, 255], 0.4)));
    g.addColorStop(0.65, U.rgbStr(c));
    g.addColorStop(1, U.rgbStr(U.mixRgb(c, [0, 0, 0], 0.42)));
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * 0.86, ang, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    /* Packed grains. */
    var rng = U.makeRng(1234);
    ctx.fillStyle = U.rgbStr(U.mixRgb(c, [0, 0, 0], 0.25), 0.5);
    for (var i = 0; i < 22; i++) {
      var a2 = rng() * TAU, rr = Math.sqrt(rng()) * r * 0.82;
      ctx.beginPath();
      ctx.arc(px + Math.cos(a2) * rr, py + Math.sin(a2) * rr * 0.86, r * 0.09, 0, TAU);
      ctx.fill();
    }
  }

  function drawWingPair(ctx, bee, near) {
    var sprite = bee.sprite;
    var wing = sprite.wing;
    var folded = bee.state === 'LANDED' || bee.state === 'GROUNDED' ||
      bee.state === 'DEPOSITING' || bee.state === 'GRABBED';

    var root = near ? sprite.anchors.wingRoot : sprite.anchors.wingRoot2;
    var alpha = near ? 1 : 0.5;
    var scale = near ? 1 : 0.9;

    ctx.save();
    ctx.translate(root.x, root.y);

    if (folded) {
      /* Wings laid back over the abdomen. */
      ctx.globalAlpha = alpha * 0.65;
      ctx.rotate(2.86);
      ctx.scale(scale * 0.94, scale * 0.94);
      ctx.drawImage(wing.crisp.canvas, -wing.crisp.ox, -wing.crisp.oy,
        wing.crisp.w, wing.crisp.h);
      ctx.restore();
      return;
    }

    /* Wings sweep backwards over the abdomen, angled further up the harder the
       bee is working. Angles past PI point back and up, because y grows down. */
    var lean = 3.26 + bee.throttle * 0.24;
    ctx.rotate(lean);
    ctx.scale(scale, scale);

    /* Blend between the three baked blur envelopes rather than switching, so
       it never reads as flicker. */
    var blend = bee.wingBlend;
    var i0 = Math.floor(blend), i1 = Math.min(2, i0 + 1);
    var mix = blend - i0;
    /* A slow shimmer suggests vibration without aliasing against 60 fps. */
    var shimmer = 0.86 + 0.14 * Math.sin(bee.renderClock * 34);

    var e0 = wing.envelopes[i0], e1 = wing.envelopes[i1];
    ctx.globalAlpha = alpha * (1 - mix) * shimmer;
    ctx.drawImage(e0.canvas, -e0.ox, -e0.oy, e0.w, e0.h);
    if (mix > 0.01) {
      ctx.globalAlpha = alpha * mix * shimmer;
      ctx.drawImage(e1.canvas, -e1.ox, -e1.oy, e1.w, e1.h);
    }

    /* One crisp wing so the eye has a leading edge to latch onto. */
    ctx.globalAlpha = alpha * 0.34;
    ctx.rotate(Math.sin(bee.renderClock * 21) * 0.30);
    ctx.drawImage(wing.crisp.canvas, -wing.crisp.ox, -wing.crisp.oy,
      wing.crisp.w, wing.crisp.h);

    ctx.restore();
  }

  function drawAntennae(ctx, bee) {
    var A = bee.sprite.anchors.antenna;
    var L = bee.L;
    var wig = Math.sin(bee.antennaPhase) * 0.10;
    ctx.strokeStyle = 'rgba(26,18,10,0.9)';
    ctx.lineCap = 'round';
    /* Two antennae, elbowed like a real bee's: a straight scape, then a
       forward-curving flagellum. Kept well apart so they never read as one
       dark tuft. */
    for (var i = 0; i < 2; i++) {
      var up = i === 0 ? -1 : 1;
      var a0 = -0.62 + up * 0.34 + wig;
      var jx = A.x + Math.cos(a0) * 0.085 * L;
      var jy = A.y + Math.sin(a0) * 0.085 * L;
      var a1 = a0 + 0.62 + wig * 1.4;
      ctx.lineWidth = (i === 0 ? 0.020 : 0.017) * L;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(jx, jy);
      ctx.stroke();
      ctx.lineWidth = (i === 0 ? 0.015 : 0.013) * L;
      ctx.beginPath();
      ctx.moveTo(jx, jy);
      ctx.quadraticCurveTo(
        jx + Math.cos(a1) * 0.10 * L, jy + Math.sin(a1) * 0.10 * L,
        jx + Math.cos(a1 - 0.42) * 0.19 * L, jy + Math.sin(a1 - 0.42) * 0.19 * L);
      ctx.stroke();
    }
  }

  /* The proboscis. Its drawn length is the species' real tongue length, so a
     garden bumblebee visibly has more than twice the reach of a buff-tail. */
  function drawProboscis(ctx, bee) {
    if (bee.probeExtend <= 0.02) return;
    var A = bee.sprite.anchors.mouth;
    var L = bee.L;
    var lenPx = bee.species.tongueMm * 1.35 * bee.species.sizeScale * bee.probeExtend;
    var ang = 1.02;
    var tx = A.x + Math.cos(ang) * lenPx;
    var ty = A.y + Math.sin(ang) * lenPx;

    /* The sheath, then the glossa inside it. */
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.034 * L;
    ctx.strokeStyle = 'rgba(58,38,22,0.9)';
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(A.x + Math.cos(ang - 0.2) * lenPx * 0.5,
      A.y + Math.sin(ang - 0.2) * lenPx * 0.5, tx, ty);
    ctx.stroke();
    ctx.lineWidth = 0.016 * L;
    ctx.strokeStyle = 'rgba(148,104,64,0.95)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty, 0.022 * L, 0, TAU);
    ctx.fillStyle = 'rgba(168,120,74,0.95)';
    ctx.fill();
  }

  function drawEyeShine(ctx, bee) {
    var A = bee.sprite.anchors.eye;
    var L = bee.L;
    var light = BB.World.light;
    /* Highlight sits on whichever side the sun is. */
    var hx = A.x + light.dirX * bee.facing * 0.028 * L;
    var hy = A.y + light.dirY * 0.030 * L;
    var g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 0.05 * L);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.30 + light.intensity * 0.28).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, 0.05 * L, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, hy, 0.013 * L, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.55 + light.intensity * 0.4).toFixed(3) + ')';
    ctx.fill();
  }

  function renderShadow(ctx, bee) {
    var W = BB.World;
    var alt = U.clamp(W.GROUND_Y - bee.y, 0, 900);
    var f = 1 - alt / 900;
    if (f <= 0.02) return;
    var light = W.light;
    var sx = bee.x + light.dirX * alt * 0.35;
    var rx = bee.L * 0.46 * (0.55 + f * 0.6);
    ctx.beginPath();
    ctx.ellipse(sx, W.GROUND_Y - 2, rx, rx * 0.26, 0, 0, TAU);
    ctx.fillStyle = 'rgba(24,20,10,' + (0.30 * f * (0.4 + light.intensity * 0.6)).toFixed(3) + ')';
    ctx.fill();
  }

  function render(ctx, bee, interp) {
    var x = U.lerp(bee.prevX, bee.x, interp);
    var y = U.lerp(bee.prevY, bee.y, interp);

    renderShadow(ctx, bee);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-bee.pitch * bee.facing);
    ctx.scale(bee.facing, 1);

    drawWingPair(ctx, bee, false);
    for (var i = LEGS.length - 1; i >= 0; i--) drawLeg(ctx, bee, LEGS[i], -1, i * 1.9);

    var sp = bee.sprite;
    ctx.drawImage(sp.body, -sp.ox, -sp.oy, sp.w, sp.h);

    for (var j = LEGS.length - 1; j >= 0; j--) drawLeg(ctx, bee, LEGS[j], 1, j * 2.4 + 0.7);
    drawAntennae(ctx, bee);
    drawProboscis(ctx, bee);
    drawEyeShine(ctx, bee);
    drawWingPair(ctx, bee, true);

    if (bee.hitFlash > 0.01) {
      ctx.globalAlpha = bee.hitFlash * 0.45;
      ctx.fillStyle = '#ff5544';
      ctx.beginPath();
      ctx.ellipse(0, 0, bee.L * 0.44, bee.L * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    /* Shivering is worth showing: it is the bee trembling, not flying. */
    if (bee.shivering) {
      var j2 = Math.sin(bee.renderClock * 60) * bee.L * 0.03;
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.translate(x + j2, y);
      ctx.scale(bee.facing, 1);
      ctx.drawImage(sp.body, -sp.ox, -sp.oy, sp.w, sp.h);
      ctx.restore();
    }
  }

  BB.Bee = {
    create: create,
    update: update,
    render: render,
    hit: hit,
    grab: grab,
    setState: setState,
    canFly: canFly,
    canStayAirborne: canStayAirborne,
    nestWarmth: nestWarmth,
    loadFraction: loadFraction,
    FLIGHT_TEMP: FLIGHT_TEMP
  };

})(window.BB = window.BB || {});
