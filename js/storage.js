/* Bumblebee Simulator - saved progress.
   localStorage can throw outright (Safari on file://, private mode, quota), so
   every access is wrapped and the game simply runs without persistence if it
   is unavailable. */
(function (BB) {
  'use strict';

  var KEY = 'bumblebeeSimulator.save.v1';

  function blank() {
    return {
      version: 1,
      bestScore: 0,
      bestSpeciesId: null,
      runs: 0,
      wins: 0,
      bestBySpecies: {},
      flowersDiscovered: [],
      factsSeen: [],
      settings: { muted: false }
    };
  }

  var data = blank();
  var available = true;

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) {
          data = parsed;
          /* Fill in anything a newer build expects. */
          var fresh = blank();
          Object.keys(fresh).forEach(function (k) {
            if (data[k] === undefined) data[k] = fresh[k];
          });
        }
      }
    } catch (err) {
      available = false;
    }
    return data;
  }

  function save() {
    if (!available) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (err) {
      available = false;
    }
  }

  /* Record the outcome of a finished run. */
  function recordRun(speciesId, score, daysSurvived, won, nectarTotal, pollenTotal) {
    data.runs += 1;
    if (won) data.wins += 1;
    if (score > data.bestScore) {
      data.bestScore = score;
      data.bestSpeciesId = speciesId;
    }
    var s = data.bestBySpecies[speciesId];
    if (!s) {
      s = data.bestBySpecies[speciesId] = {
        bestScore: 0, bestDay: 0, runs: 0, wins: 0, nectarTotal: 0, pollenTotal: 0
      };
    }
    s.runs += 1;
    if (won) s.wins += 1;
    s.bestScore = Math.max(s.bestScore, score);
    s.bestDay = Math.max(s.bestDay, daysSurvived);
    s.nectarTotal += nectarTotal;
    s.pollenTotal += pollenTotal;
    save();
  }

  function discoverFlower(id) {
    if (data.flowersDiscovered.indexOf(id) < 0) {
      data.flowersDiscovered.push(id);
    }
  }

  /* Rotate through the fact list without repeating until all are seen. */
  function nextFactIndex() {
    var total = BB.FACTS.length;
    if (data.factsSeen.length >= total) data.factsSeen = [];
    for (var i = 0; i < total; i++) {
      if (data.factsSeen.indexOf(i) < 0) {
        data.factsSeen.push(i);
        return i;
      }
    }
    return 0;
  }

  BB.Storage = {
    load: load,
    save: save,
    recordRun: recordRun,
    discoverFlower: discoverFlower,
    nextFactIndex: nextFactIndex,
    get data() { return data; },
    get available() { return available; }
  };

})(window.BB = window.BB || {});
