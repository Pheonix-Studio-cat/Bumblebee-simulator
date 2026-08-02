/* Bumblebee Simulator - the DOM interface layer.
   The canvas draws the world; all text lives here, where the browser can lay
   it out crisply and screen readers can reach it. */
(function (BB) {
  'use strict';

  var U = BB.Util;

  var el = {};
  var screens = {};
  var currentScreen = null;
  var toastTimers = [];
  var selectedSpeciesId = null;
  var callbacks = {};

  function $(id) { return document.getElementById(id); }

  function cacheDom() {
    ['hud', 'overlay', 'toast-stack', 'prompt', 'streak', 'debug', 'species-tag',
      'species-cards', 'btn-start', 'best-line', 'pause-stats', 'report-title',
      'report-eyebrow', 'report-note', 'report-forage', 'report-colony',
      'over-title', 'over-eyebrow', 'over-note', 'over-stats', 'loading-note',
      'bar-nectar', 'bar-pollen', 'bar-energy', 'bar-thorax',
      'val-nectar', 'val-pollen', 'val-energy', 'val-thorax',
      'val-day', 'val-clock', 'val-temp', 'val-weather',
      'val-workers', 'val-larvae', 'val-gynes', 'val-score'
    ].forEach(function (id) { el[id] = $(id); });

    screens.title = $('screen-title');
    screens.guide = $('screen-guide');
    screens.species = $('screen-species');
    screens.pause = $('screen-pause');
    screens.report = $('screen-report');
    screens.gameover = $('screen-gameover');
    screens.loading = $('screen-loading');
  }

  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('hidden', k !== name);
    });
    currentScreen = name || null;
    el.hud.classList.toggle('hidden', !!name);
    BB.Input.showTouch(!name);
  }

  /* ==================================================================== */
  /*  Species cards                                                       */
  /* ==================================================================== */

  function pips(value, lo, hi) {
    var n = Math.round(U.clamp(U.invLerp(lo, hi, value), 0, 1) * 4) + 1;
    var html = '<span class="pip-row">';
    for (var i = 0; i < 5; i++) {
      html += '<span class="pip' + (i < n ? ' on' : '') + '"></span>';
    }
    return html + '</span>';
  }

  /* A small portrait of the species, drawn from the same baked sprite the game
     itself flies, so what you pick is what you get. */
  function drawPortrait(canvas, species) {
    var sprite = BB.Art.bakeBee(species);
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    /* Scaled so the largest species fits with its wings, which means the size
       difference between the species stays visible on the cards. */
    var scale = w / (BB.Art.BASE_LEN * 1.62 * 2.3);
    ctx.save();
    ctx.translate(w * 0.46, h * 0.58);
    ctx.scale(scale, scale);

    var env = sprite.wing.envelopes[1];
    var root = sprite.anchors.wingRoot;
    ctx.save();
    ctx.translate(root.x, root.y);
    ctx.rotate(3.34);   /* swept back over the abdomen, as in flight */
    ctx.globalAlpha = 0.8;
    ctx.drawImage(env.canvas, -env.ox, -env.oy, env.w, env.h);
    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.drawImage(sprite.body, -sprite.ox, -sprite.oy, sprite.w, sprite.h);

    /* Antennae and a leg or two, so the portrait is not a bare torso. */
    var L = sprite.lengthPx;
    var A = sprite.anchors.antenna;
    ctx.strokeStyle = 'rgba(26,18,10,0.9)';
    ctx.lineCap = 'round';
    for (var i = 0; i < 2; i++) {
      var a0 = -0.6 + i * 0.4;
      var jx = A.x + Math.cos(a0) * 0.075 * L, jy = A.y + Math.sin(a0) * 0.075 * L;
      ctx.lineWidth = 0.026 * L;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(jx, jy); ctx.stroke();
      ctx.lineWidth = 0.018 * L;
      ctx.beginPath();
      ctx.moveTo(jx, jy);
      ctx.quadraticCurveTo(jx + 0.08 * L, jy + 0.05 * L, jx + 0.15 * L, jy + 0.03 * L);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(28,20,12,0.9)';
    [['legFront', 1.1], ['legMid', 1.55], ['legHind', 2.0]].forEach(function (pair) {
      var an = sprite.anchors[pair[0]];
      ctx.lineWidth = 0.045 * L;
      ctx.beginPath();
      ctx.moveTo(an.x, an.y);
      ctx.lineTo(an.x + Math.cos(pair[1]) * 0.15 * L, an.y + Math.sin(pair[1]) * 0.15 * L);
      ctx.stroke();
    });

    ctx.restore();
  }

  function speciesCardHtml(sp) {
    return '' +
      '<canvas width="320" height="150" aria-hidden="true"></canvas>' +
      '<div class="species-name">' + sp.commonName + '</div>' +
      '<div class="species-latin">' + sp.latinName + '</div>' +
      '<dl class="species-stats">' +
      '<dt>Tongue</dt><dd>' + sp.tongueMm + ' mm &middot; ' + BB.tongueLabel(sp) + '</dd>' +
      '<dt>Body</dt><dd>' + sp.bodyLengthMm + ' mm</dd>' +
      '<dt>Speed</dt><dd>' + pips(sp.maxSpeed, 260, 390) + '</dd>' +
      '<dt>Agility</dt><dd>' + pips(sp.agility, 0.36, 0.94) + '</dd>' +
      '<dt>Load</dt><dd>' + pips(sp.nectarCapacity, 85, 270) + '</dd>' +
      '<dt>Cold-hardy</dt><dd>' + pips(-sp.coldToleranceC, -12.5, -5.5) + '</dd>' +
      '</dl>' +
      '<p class="species-blurb">' + sp.blurb + '</p>';
  }

  /* Baking fur is expensive, so the five species are prepared one per frame
     with the loading screen up rather than in one long freeze. */
  function buildSpeciesCards(done) {
    var host = el['species-cards'];
    host.innerHTML = '';
    var index = 0;

    showScreen('loading');
    el['loading-note'].textContent = 'Drawing every hair on five bumblebees.';

    function step() {
      if (index >= BB.SPECIES.length) {
        showScreen('species');
        if (done) done();
        return;
      }
      var sp = BB.SPECIES[index];
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'species-card';
      card.setAttribute('data-species', sp.id);
      card.innerHTML = speciesCardHtml(sp);
      host.appendChild(card);

      drawPortrait(card.querySelector('canvas'), sp);

      card.addEventListener('click', function () {
        selectSpecies(sp.id);
      });

      index++;
      el['loading-note'].textContent = 'Growing fur: ' + index + ' of ' + BB.SPECIES.length + '.';
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function selectSpecies(id) {
    selectedSpeciesId = id;
    var cards = document.querySelectorAll('.species-card');
    Array.prototype.forEach.call(cards, function (c) {
      c.classList.toggle('selected', c.getAttribute('data-species') === id);
    });
    el['btn-start'].disabled = false;
    BB.Audio.blip('ui');
  }

  /* ==================================================================== */
  /*  Live HUD                                                            */
  /* ==================================================================== */

  function setBar(barEl, valEl, frac, text, lowAt) {
    barEl.style.width = (U.clamp(frac, 0, 1) * 100).toFixed(1) + '%';
    barEl.classList.toggle('low', lowAt !== undefined && frac < lowAt);
    valEl.textContent = text;
  }

  function update(bee, colony, world) {
    var sp = bee.species;

    setBar(el['bar-nectar'], el['val-nectar'],
      bee.nectar / sp.nectarCapacity,
      Math.round(bee.nectar) + ' / ' + sp.nectarCapacity + ' mg');

    setBar(el['bar-pollen'], el['val-pollen'],
      bee.pollen / sp.pollenCapacity,
      bee.pollen.toFixed(1) + ' / ' + sp.pollenCapacity + ' mg');

    setBar(el['bar-energy'], el['val-energy'],
      bee.energy / bee.energyMax,
      Math.round(bee.energy / bee.energyMax * 100) + '%', 0.25);

    /* Thorax gauge is scaled over the range that actually matters: from
       freezing to the 30 C a bumblebee needs before it can fly. */
    var tFrac = U.invLerp(0, 36, bee.thoraxC);
    setBar(el['bar-thorax'], el['val-thorax'], tFrac,
      bee.thoraxC.toFixed(1) + ' °C' +
      (bee.thoraxC < BB.Bee.FLIGHT_TEMP ? ' – too cold' : ''),
      BB.Bee.FLIGHT_TEMP / 36);

    el['val-day'].textContent = colony.day + ' / ' + BB.Colony.SEASON_DAYS;
    el['val-clock'].textContent = U.formatClock(world.hour);
    el['val-temp'].textContent = world.airTempC.toFixed(0) + ' °C';
    el['val-weather'].textContent = world.isRaining ? 'Rain' : world.state.script.label;
    el['val-workers'].textContent = String(colony.workers);
    el['val-larvae'].textContent = String(colony.brood.length);
    el['val-gynes'].textContent = colony.gynes + ' / 3';
    el['val-score'].textContent = U.commas(BB.Colony.score());
  }

  function setSpeciesTag(sp, lives) {
    el['species-tag'].classList.remove('hidden');
    el['species-tag'].innerHTML = sp.commonName + ' &middot; <i>' + sp.latinName +
      '</i> &middot; tongue ' + sp.tongueMm + ' mm &middot; lives ' + lives;
  }

  /* Telling a phone player to "press Space" is useless - there is no Space key
     in their hands. Every hint goes through here so it names whichever control
     the player actually has. */
  var KEY_LABELS = {
    probe: 'Space', buzz: 'Shift', sip: 'Q', up: 'W', pause: 'P'
  };
  var TOUCH_LABELS = {
    probe: 'Land &amp; feed', buzz: 'Buzz', sip: 'Sip nectar',
    up: 'the stick upwards', pause: 'Pause'
  };

  function key(action) {
    return BB.Input.state.touchActive
      ? '<b>' + TOUCH_LABELS[action] + '</b>'
      : '<kbd>' + KEY_LABELS[action] + '</kbd>';
  }

  function setPrompt(text, kind) {
    var p = el.prompt;
    if (!text) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    p.className = kind ? kind : '';
    p.innerHTML = text;
  }

  function setStreak(count, flowerName) {
    var s = el.streak;
    if (!count || count < 2) { s.classList.add('hidden'); return; }
    s.classList.remove('hidden');
    s.innerHTML = 'Flower constancy &times;' + count + ' &middot; ' + flowerName;
  }

  function toast(message, kind) {
    var stack = el['toast-stack'];
    var node = document.createElement('div');
    node.className = 'toast ' + (kind || 'info');
    node.innerHTML = message;
    stack.appendChild(node);
    /* Never let toasts pile up past a readable handful. */
    while (stack.children.length > 4) stack.removeChild(stack.firstChild);
    var t1 = window.setTimeout(function () { node.classList.add('fade'); }, 2600);
    var t2 = window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 3100);
    toastTimers.push(t1, t2);
  }

  function clearToasts() {
    toastTimers.forEach(window.clearTimeout);
    toastTimers = [];
    el['toast-stack'].innerHTML = '';
  }

  function setDebug(text) {
    if (!text) { el.debug.classList.add('hidden'); return; }
    el.debug.classList.remove('hidden');
    el.debug.textContent = text;
  }

  /* ==================================================================== */
  /*  Panels                                                              */
  /* ==================================================================== */

  function statRows(rows) {
    return rows.map(function (r) {
      var cls = r[2] ? ' ' + r[2] : '';
      return '<div class="stat' + cls + '"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');
  }

  function showPause(bee, colony) {
    var sp = bee.species;
    el['pause-stats'].innerHTML = statRows([
      ['Species', sp.commonName],
      ['Tongue', sp.tongueMm + ' mm'],
      ['Carrying', Math.round(bee.nectar) + ' mg nectar, ' + bee.pollen.toFixed(1) + ' mg pollen'],
      ['Day', colony.day + ' of ' + BB.Colony.SEASON_DAYS],
      ['Workers', String(colony.workers)],
      ['New queens', String(colony.gynes)],
      ['Lives left', String(colony.lives)],
      ['Score', U.commas(BB.Colony.score())]
    ]);
    showScreen('pause');
  }

  function showReport(report, world) {
    var q = report.quota;
    var nOk = report.delivered.nectar >= q.nectar;
    var pOk = report.delivered.pollen >= q.pollen;

    el['report-eyebrow'].textContent = 'Dusk – ' + U.formatClock(world.END_HOUR);
    el['report-title'].textContent = report.quotaMet
      ? 'Day ' + report.day + ': the brood is fed'
      : 'Day ' + report.day + ': the nest went short';

    var factIdx = BB.Storage.nextFactIndex();
    el['report-note'].innerHTML = report.notes.join(' ') +
      '<br><br><b>Did you know?</b> ' + BB.FACTS[factIdx];

    el['report-forage'].innerHTML = statRows([
      ['Nectar delivered', Math.round(report.delivered.nectar) + ' / ' + q.nectar + ' mg',
        nOk ? 'good' : 'bad'],
      ['Pollen delivered', report.delivered.pollen.toFixed(1) + ' / ' + q.pollen + ' mg',
        pOk ? 'good' : 'bad'],
      ['Trips home', String(report.trips)],
      ['Flowers pollinated', String(report.pollinated)],
      ['Workers foraging', report.workerYield.nectar > 0
        ? '+' + report.workerYield.nectar + ' mg nectar' : 'none yet'],
      ['Contaminated nectar', report.contaminated > 0
        ? Math.round(report.contaminated) + ' mg' : 'none',
        report.contaminated > 0 ? 'bad' : 'good']
    ]);

    el['report-colony'].innerHTML = statRows([
      ['Eaten overnight', report.consumed.nectar + ' mg nectar, ' +
        report.consumed.pollen + ' mg pollen'],
      ['In the wax pots', report.stores.nectar + ' mg nectar, ' +
        report.stores.pollen + ' mg pollen', report.starved ? 'bad' : ''],
      ['Eggs laid', String(report.laid)],
      ['Larvae', String(report.brood)],
      ['Workers', String(report.workers), report.hatched > 0 ? 'good' : ''],
      ['New queens raised', String(report.gynes), report.newGynes > 0 ? 'good' : ''],
      ['Colony health', Math.round(report.health) + '%', report.health < 50 ? 'bad' : 'good'],
      ['Score', U.commas(report.score)]
    ]);

    var btn = $('btn-next-day');
    if (report.outcome === 'continue') {
      btn.textContent = 'Sleep until dawn – day ' + (report.day + 1);
      btn.classList.remove('hidden');
      el['report-note'].innerHTML += '<br><br><b>Tomorrow:</b> ' +
        world.DAY_SCRIPTS[Math.min(6, report.day)].forecast +
        ' The brood will need ' + report.nextQuota.nectar + ' mg of nectar and ' +
        report.nextQuota.pollen + ' mg of pollen.';
    } else {
      btn.textContent = 'See how the season ended';
    }
    showScreen('report');
  }

  function showGameOver(colony, bee, reason) {
    var won = colony.won;
    el['over-eyebrow'].textContent = won ? 'The season closes' : 'The nest falls silent';
    el['over-title'].textContent = won
      ? 'Your colony raised ' + colony.gynes + (colony.gynes === 1 ? ' new queen' : ' new queens')
      : 'The colony did not make it';
    el['over-note'].innerHTML = won
      ? 'Those young queens will mate, dig in for the winter and each start a nest ' +
        'of their own next spring. Everything else you built – the workers, the ' +
        'wax pots, you – dies with the autumn. That is how it really works: the ' +
        'whole summer exists to produce a handful of queens.'
      : (reason || 'Without enough nectar and pollen coming in, the brood could not be fed.');

    var best = BB.Storage.data.bestScore;
    var score = BB.Colony.score();
    el['over-stats'].innerHTML = statRows([
      ['Species', bee.species.commonName],
      ['Days survived', colony.day + ' of ' + BB.Colony.SEASON_DAYS],
      ['Nectar carried home', U.commas(colony.nectarLifetime) + ' mg'],
      ['Pollen carried home', colony.pollenLifetime.toFixed(1) + ' mg'],
      ['Flowers pollinated', String(colony.flowersPollinated)],
      ['Plant species worked', BB.Colony.distinctSpecies() + ' of ' + BB.FLOWERS.length],
      ['Workers raised', String(colony.workers)],
      ['New queens', String(colony.gynes), colony.gynes > 0 ? 'good' : 'bad'],
      ['Final score', U.commas(score), score >= best ? 'good' : ''],
      ['Personal best', U.commas(Math.max(best, score))]
    ]);
    showScreen('gameover');
  }

  function refreshBestLine() {
    var d = BB.Storage.data;
    if (!d.bestScore) {
      el['best-line'].textContent = BB.Storage.available
        ? 'No season completed yet.'
        : 'Scores cannot be saved in this browser, but the game plays normally.';
      return;
    }
    var sp = d.bestSpeciesId ? BB.getSpecies(d.bestSpeciesId) : null;
    el['best-line'].textContent = 'Best score ' + U.commas(d.bestScore) +
      (sp ? ' as the ' + sp.commonName.toLowerCase() : '') +
      ' · ' + d.runs + (d.runs === 1 ? ' season' : ' seasons') + ' attempted' +
      (d.wins ? ', ' + d.wins + ' won' : '');
  }

  /* ==================================================================== */

  function init(cbs) {
    callbacks = cbs || {};
    cacheDom();

    $('btn-play').addEventListener('click', function () {
      BB.Audio.start();
      buildSpeciesCards();
    });
    $('btn-guide').addEventListener('click', function () { showScreen('guide'); });
    $('btn-guide-back').addEventListener('click', function () { showScreen('title'); });
    $('btn-species-back').addEventListener('click', function () { showScreen('title'); });
    $('btn-start').addEventListener('click', function () {
      if (selectedSpeciesId && callbacks.onStart) callbacks.onStart(selectedSpeciesId);
    });
    $('btn-resume').addEventListener('click', function () {
      if (callbacks.onResume) callbacks.onResume();
    });
    $('btn-quit').addEventListener('click', function () {
      if (callbacks.onQuit) callbacks.onQuit();
    });
    $('btn-next-day').addEventListener('click', function () {
      if (callbacks.onNextDay) callbacks.onNextDay();
    });
    $('btn-again').addEventListener('click', function () {
      buildSpeciesCards();
    });
    $('btn-title').addEventListener('click', function () {
      refreshBestLine();
      showScreen('title');
    });

    refreshBestLine();
    showScreen('title');
  }

  BB.Hud = {
    init: init,
    key: key,
    showScreen: showScreen,
    buildSpeciesCards: buildSpeciesCards,
    selectSpecies: selectSpecies,
    update: update,
    setSpeciesTag: setSpeciesTag,
    setPrompt: setPrompt,
    setStreak: setStreak,
    toast: toast,
    clearToasts: clearToasts,
    setDebug: setDebug,
    showPause: showPause,
    showReport: showReport,
    showGameOver: showGameOver,
    refreshBestLine: refreshBestLine,
    get currentScreen() { return currentScreen; },
    get selectedSpeciesId() { return selectedSpeciesId; }
  };

})(window.BB = window.BB || {});
