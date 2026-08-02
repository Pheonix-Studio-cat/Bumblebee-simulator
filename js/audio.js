/* Bumblebee Simulator - all sound synthesised in the browser, no audio files.
 *
 * The wingbeat is the point of this file. A bumblebee beats its wings 130-200
 * times a second, which a 60 fps display can never show. So the frequency is
 * carried by sound instead: two detuned sawtooths at the species' real
 * wingbeat rate, which is why the giant Bombus dahlbomii at 130 Hz sounds
 * audibly deeper and heavier than the little carder bee at 190 Hz.
 */
(function (BB) {
  'use strict';

  var U = BB.Util;

  var ctx = null;
  var master = null;
  var buzz = null;          /* the sustained flight tone */
  var rain = null;
  var muted = false;
  var started = false;
  var currentHz = 170;

  function supported() {
    return typeof window.AudioContext !== 'undefined' ||
      typeof window.webkitAudioContext !== 'undefined';
  }

  /* Browsers refuse to start audio until the user has interacted, so this is
     called from the first keypress or tap rather than at load. */
  function start() {
    if (started || !supported()) return;
    started = true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      buildBuzz();
    } catch (err) {
      ctx = null;
    }
  }

  function buildBuzz() {
    if (!ctx) return;
    var oscA = ctx.createOscillator();
    var oscB = ctx.createOscillator();
    var sub = ctx.createOscillator();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();

    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    sub.type = 'sine';
    oscA.frequency.value = currentHz;
    oscB.frequency.value = currentHz * 1.011;   /* slight detune gives the beating roughness */
    sub.frequency.value = currentHz / 2;

    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 3.5;

    gain.gain.value = 0;

    oscA.connect(filter);
    oscB.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    oscA.start();
    oscB.start();
    sub.start();

    buzz = { oscA: oscA, oscB: oscB, sub: sub, filter: filter, gain: gain };
  }

  /* Called every frame from the bee. `level` 0..1 is how hard it is working;
     `hz` is the species wingbeat; `shiver` adds the tremolo of a bee warming
     its flight muscles without turning its wings. */
  function setFlight(level, hz, shiver) {
    if (!buzz || !ctx) return;
    var t = ctx.currentTime;
    currentHz = hz;
    var target = hz * (0.86 + 0.24 * level);
    if (shiver) target = hz * 0.55;
    try {
      buzz.oscA.frequency.setTargetAtTime(target, t, 0.05);
      buzz.oscB.frequency.setTargetAtTime(target * 1.011, t, 0.05);
      buzz.sub.frequency.setTargetAtTime(target / 2, t, 0.05);
      buzz.filter.frequency.setTargetAtTime(560 + level * 1500, t, 0.08);
      var g = shiver ? 0.10 : 0.035 + level * 0.15;
      buzz.gain.gain.setTargetAtTime(g, t, 0.06);
    } catch (err) { /* an closed context - ignore */ }
  }

  function silenceFlight() {
    if (!buzz || !ctx) return;
    try {
      buzz.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    } catch (err) { /* ignore */ }
  }

  /* Short one-shot sounds. */
  function blip(kind) {
    if (!ctx || muted) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var f0 = 440, f1 = 660, dur = 0.14, vol = 0.16, type = 'sine';

    if (kind === 'sip')      { f0 = 300; f1 = 520; dur = 0.20; type = 'triangle'; }
    else if (kind === 'deposit') { f0 = 220; f1 = 700; dur = 0.34; vol = 0.22; type = 'triangle'; }
    else if (kind === 'land')    { f0 = 180; f1 = 120; dur = 0.10; vol = 0.12; type = 'sine'; }
    else if (kind === 'reject')  { f0 = 200; f1 = 130; dur = 0.22; vol = 0.16; type = 'square'; }
    else if (kind === 'alarm')   { f0 = 700; f1 = 200; dur = 0.36; vol = 0.24; type = 'sawtooth'; }
    else if (kind === 'good')    { f0 = 520; f1 = 900; dur = 0.24; vol = 0.18; type = 'triangle'; }
    else if (kind === 'hurt')    { f0 = 160; f1 = 70;  dur = 0.42; vol = 0.26; type = 'sawtooth'; }
    else if (kind === 'ui')      { f0 = 620; f1 = 640; dur = 0.06; vol = 0.09; type = 'sine'; }

    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /* Buzz pollination: a hard, low, rattling vibration. */
  function sonicate(on) {
    if (!buzz || !ctx) return;
    try {
      var t = ctx.currentTime;
      if (on) {
        buzz.oscA.frequency.setTargetAtTime(400, t, 0.02);
        buzz.oscB.frequency.setTargetAtTime(404, t, 0.02);
        buzz.filter.frequency.setTargetAtTime(2200, t, 0.03);
        buzz.gain.gain.setTargetAtTime(0.20, t, 0.03);
      }
    } catch (err) { /* ignore */ }
  }

  function setRain(active) {
    if (!ctx) return;
    if (active && !rain) {
      var len = Math.floor(ctx.sampleRate * 2);
      var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var chan = buffer.getChannelData(0);
      for (var i = 0; i < len; i++) chan[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      var filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 1400;
      filt.Q.value = 0.6;
      var gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filt);
      filt.connect(gain);
      gain.connect(master);
      src.start();
      rain = { src: src, gain: gain };
    }
    if (rain) {
      try {
        rain.gain.gain.setTargetAtTime(active && !muted ? 0.11 : 0, ctx.currentTime, 0.6);
      } catch (err) { /* ignore */ }
    }
  }

  function setMuted(m) {
    muted = !!m;
    if (master && ctx) {
      try {
        master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
      } catch (err) { /* ignore */ }
    }
    return muted;
  }

  BB.Audio = {
    start: start,
    setFlight: setFlight,
    silenceFlight: silenceFlight,
    sonicate: sonicate,
    blip: blip,
    setRain: setRain,
    setMuted: setMuted,
    toggleMute: function () { return setMuted(!muted); },
    get muted() { return muted; },
    get ready() { return !!ctx; }
  };

})(window.BB = window.BB || {});
