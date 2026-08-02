/* Bumblebee Simulator - the nest.
 *
 * You are the queen. Real bumblebee queens found a colony alone: they forage,
 * build the wax pots and raise the first brood single-handed, and only then do
 * workers take over the flying. That is the whole arc of the game - each day
 * the colony needs more than the day before, and the only way to keep up is to
 * get daughters into the air.
 *
 * Bumblebees do not hoard honey. They keep a few days of nectar in small pots,
 * which is why one bad week can starve a nest, and why the day quota below is
 * unforgiving.
 */
(function (BB) {
  'use strict';

  var U = BB.Util;

  var SEASON_DAYS = 7;

  var state = null;

  function reset() {
    state = {
      day: 1,
      nectarStore: 60,
      pollenStore: 8,
      workers: 0,
      brood: [],              /* [{age}] - larvae waiting to become workers */
      gynes: 0,               /* new queens: the actual point of a colony */
      health: 100,
      lives: 3,
      missedQuotas: 0,

      /* Lifetime tallies for score and the report. */
      nectarLifetime: 0,
      pollenLifetime: 0,
      flowersPollinated: 0,
      speciesVisited: {},
      hazardHits: 0,
      robberies: 0,
      buzzHarvests: 0,

      /* Reset every dawn. */
      dayNectar: 0,
      dayPollen: 0,
      dayPollinated: 0,
      dayContaminated: 0,
      dayTrips: 0,

      finished: false,
      won: false
    };
    return state;
  }

  /* What the nest needs delivered today. It climbs steeply, because a growing
     brood eats more every day. */
  function quotaFor(day) {
    return {
      nectar: Math.round(110 * Math.pow(1.24, day - 1)),
      pollen: Math.round(13 * Math.pow(1.24, day - 1))
    };
  }

  function quota() { return quotaFor(state.day); }

  /* The bee has flown home and unloaded. */
  function deposit(nectar, pollen, contaminated) {
    state.nectarStore += nectar;
    state.pollenStore += pollen;
    state.dayNectar += nectar;
    state.dayPollen += pollen;
    state.nectarLifetime += nectar;
    state.pollenLifetime += pollen;
    state.dayContaminated += contaminated || 0;
    if (nectar > 0.5 || pollen > 0.05) state.dayTrips += 1;
  }

  function registerVisit(flowerId, pollinated) {
    state.speciesVisited[flowerId] = (state.speciesVisited[flowerId] || 0) + 1;
    BB.Storage.discoverFlower(flowerId);
    if (pollinated) {
      state.flowersPollinated += 1;
      state.dayPollinated += 1;
    }
  }

  function distinctSpecies() {
    return Object.keys(state.speciesVisited).length;
  }

  function score() {
    return Math.round(
      state.nectarLifetime * 1.0 +
      state.pollenLifetime * 9 +
      state.flowersPollinated * 22 +
      distinctSpecies() * 40 +
      state.workers * 180 +
      state.gynes * 650 +
      (state.day - 1) * 120 +
      state.robberies * 6 +
      state.buzzHarvests * 14 -
      state.hazardHits * 20
    );
  }

  /* Dusk. Settle the day's books and decide whether the colony survives it. */
  function endOfDay() {
    var q = quota();
    var report = {
      day: state.day,
      quota: q,
      delivered: { nectar: state.dayNectar, pollen: state.dayPollen },
      trips: state.dayTrips,
      pollinated: state.dayPollinated,
      contaminated: state.dayContaminated,
      workerYield: { nectar: 0, pollen: 0 },
      consumed: { nectar: 0, pollen: 0 },
      hatched: 0,
      laid: 0,
      newGynes: 0,
      quotaMet: false,
      starved: false,
      poisoned: state.dayContaminated > 0,
      notes: []
    };

    /* Daughters already flying bring their own load home. */
    if (state.workers > 0) {
      report.workerYield.nectar = Math.round(state.workers * 26);
      report.workerYield.pollen = Math.round(state.workers * 3.2 * 10) / 10;
      state.nectarStore += report.workerYield.nectar;
      state.pollenStore += report.workerYield.pollen;
      state.dayNectar += report.workerYield.nectar;
      state.dayPollen += report.workerYield.pollen;
      state.nectarLifetime += report.workerYield.nectar;
      state.pollenLifetime += report.workerYield.pollen;
      report.notes.push(state.workers + (state.workers === 1 ? ' worker' : ' workers') +
        ' foraged alongside you.');
    }

    report.delivered.nectar = state.dayNectar;
    report.delivered.pollen = state.dayPollen;
    report.quotaMet = state.dayNectar >= q.nectar && state.dayPollen >= q.pollen;

    /* The nest eats. */
    report.consumed.nectar = Math.round(20 + 8 * state.workers + 5 * state.brood.length);
    report.consumed.pollen = Math.round((6 * state.brood.length) * 10) / 10;
    state.nectarStore -= report.consumed.nectar;
    state.pollenStore -= report.consumed.pollen;

    if (state.nectarStore < 0 || state.pollenStore < 0) {
      report.starved = true;
      state.nectarStore = Math.max(0, state.nectarStore);
      state.pollenStore = Math.max(0, state.pollenStore);
      state.health -= 30;
      report.notes.push('The wax pots ran dry overnight. The colony went hungry.');
    }

    if (report.quotaMet) {
      report.laid = 1 + Math.floor(state.workers / 3);
      for (var i = 0; i < report.laid; i++) {
        if (state.brood.length < 10) state.brood.push({ age: 0 });
      }
      report.notes.push('You met the day\'s needs, so you laid ' + report.laid +
        (report.laid === 1 ? ' more egg.' : ' more eggs.'));
    } else {
      state.missedQuotas += 1;
      state.health -= 18;
      report.notes.push('You fell short of what the brood needed. ' +
        (state.missedQuotas >= 2 ? 'The colony cannot take another day like this.'
          : 'One more shortfall and the nest is finished.'));
    }

    /* Larvae grow up if there is pollen to feed them. */
    var survivors = [];
    for (var b = 0; b < state.brood.length; b++) {
      var larva = state.brood[b];
      larva.age += 1;
      if (larva.age >= 2 && state.pollenStore >= 8) {
        state.pollenStore -= 8;
        state.workers += 1;
        report.hatched += 1;
      } else {
        survivors.push(larva);
      }
    }
    state.brood = survivors;
    if (report.hatched > 0) {
      report.notes.push(report.hatched + (report.hatched === 1 ? ' larva' : ' larvae') +
        ' hatched into workers.');
    }

    /* Genuine surplus, late in the season, becomes new queens - the only thing
       that actually carries the colony's genes into next spring. */
    while (state.day >= 4 && state.nectarStore >= 90 && state.pollenStore >= 22 && state.gynes < 8) {
      state.nectarStore -= 90;
      state.pollenStore -= 22;
      state.gynes += 1;
      report.newGynes += 1;
    }
    if (report.newGynes > 0) {
      report.notes.push('Your surplus raised ' + report.newGynes +
        (report.newGynes === 1 ? ' new queen.' : ' new queens.'));
    }

    /* Sublethal pesticide effects accumulate in the nest, not just in the bee. */
    if (state.dayContaminated > 0) {
      var harm = Math.min(22, state.dayContaminated * 0.22);
      state.health -= harm;
      report.notes.push('Contaminated nectar went into the pots. The brood is weaker for it.');
    }

    state.health = U.clamp(state.health, 0, 100);
    report.health = state.health;
    report.stores = { nectar: Math.round(state.nectarStore), pollen: Math.round(state.pollenStore * 10) / 10 };
    report.workers = state.workers;
    report.brood = state.brood.length;
    report.gynes = state.gynes;
    report.score = score();

    /* Reset the daily books. */
    state.dayNectar = 0;
    state.dayPollen = 0;
    state.dayPollinated = 0;
    state.dayContaminated = 0;
    state.dayTrips = 0;

    /* Outcome. */
    if (state.health <= 0 || state.missedQuotas >= 2) {
      state.finished = true;
      state.won = false;
      report.outcome = 'lost';
    } else if (state.day >= SEASON_DAYS) {
      state.finished = true;
      state.won = state.gynes > 0;
      report.outcome = state.won ? 'won' : 'survived';
    } else {
      state.day += 1;
      report.outcome = 'continue';
    }

    report.nextQuota = quotaFor(state.day);
    return report;
  }

  function loseLife(reason) {
    state.lives -= 1;
    state.hazardHits += 1;
    if (state.lives <= 0) {
      state.finished = true;
      state.won = false;
    }
    return { lives: state.lives, reason: reason, dead: state.lives <= 0 };
  }

  BB.Colony = {
    SEASON_DAYS: SEASON_DAYS,
    reset: reset,
    deposit: deposit,
    registerVisit: registerVisit,
    endOfDay: endOfDay,
    loseLife: loseLife,
    quota: quota,
    quotaFor: quotaFor,
    score: score,
    distinctSpecies: distinctSpecies,
    get state() { return state; }
  };

})(window.BB = window.BB || {});
