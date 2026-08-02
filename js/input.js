/* Bumblebee Simulator - keyboard and touch input.
   Gameplay code only ever reads the normalised state below, never raw events. */
(function (BB) {
  'use strict';

  var U = BB.Util;

  var held = Object.create(null);      /* e.code -> true */
  var pressQueue = Object.create(null);/* e.code -> count of unconsumed presses */

  var state = {
    ax: 0,          /* -1 .. 1 horizontal intent */
    ay: 0,          /* -1 .. 1 vertical intent, negative is up */
    probe: false,   /* land / drink / unload */
    buzz: false,    /* vibrate: sonicate, or shiver when cold */
    sip: false,     /* drink from your own honey stomach */
    anyHeld: false,
    touchActive: false
  };

  var touch = { ax: 0, ay: 0, probe: false, buzz: false, sip: false };
  var listeners = [];

  /* Keys the page must not act on itself. */
  var SWALLOW = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    Space: 1, Tab: 1, F3: 1
  };

  function onKeyDown(e) {
    BB.Audio.start();
    if (SWALLOW[e.code]) e.preventDefault();
    if (!held[e.code]) {
      pressQueue[e.code] = (pressQueue[e.code] || 0) + 1;
      for (var i = 0; i < listeners.length; i++) listeners[i](e.code);
    }
    held[e.code] = true;
  }

  function onKeyUp(e) {
    if (SWALLOW[e.code]) e.preventDefault();
    held[e.code] = false;
  }

  /* Without this the bee flies off forever after an alt-tab, because the
     keyup never arrives. */
  function flush() {
    held = Object.create(null);
    touch.ax = touch.ay = 0;
    touch.probe = touch.buzz = touch.sip = false;
    resetKnob();
  }

  function isHeld() {
    for (var i = 0; i < arguments.length; i++) {
      if (held[arguments[i]]) return true;
    }
    return false;
  }

  /* True once per physical press. */
  function consumePress() {
    for (var i = 0; i < arguments.length; i++) {
      var code = arguments[i];
      if (pressQueue[code]) {
        pressQueue[code] = 0;
        return true;
      }
    }
    return false;
  }

  function clearPresses() {
    pressQueue = Object.create(null);
  }

  function update() {
    var ax = 0, ay = 0;
    if (isHeld('KeyA', 'ArrowLeft')) ax -= 1;
    if (isHeld('KeyD', 'ArrowRight')) ax += 1;
    if (isHeld('KeyW', 'ArrowUp')) ay -= 1;
    if (isHeld('KeyS', 'ArrowDown')) ay += 1;

    ax += touch.ax;
    ay += touch.ay;

    /* Normalise so diagonals are not faster than straight lines. */
    var len = Math.hypot(ax, ay);
    if (len > 1) { ax /= len; ay /= len; }

    state.ax = ax;
    state.ay = ay;
    state.probe = isHeld('Space') || touch.probe;
    state.buzz = isHeld('ShiftLeft', 'ShiftRight') || touch.buzz;
    state.sip = isHeld('KeyQ') || touch.sip;
    state.anyHeld = Math.abs(ax) > 0.01 || Math.abs(ay) > 0.01 || state.probe || state.buzz;
  }

  /* ------------------------------------------------------------- touch ---- */

  var stickEl = null, knobEl = null, stickId = null;
  var stickOrigin = { x: 0, y: 0 };
  var STICK_RANGE = 46;

  function resetKnob() {
    if (knobEl) knobEl.style.transform = 'translate(0px, 0px)';
  }

  function stickStart(e) {
    var t = e.changedTouches ? e.changedTouches[0] : e;
    stickId = e.changedTouches ? t.identifier : 'mouse';
    var rect = stickEl.getBoundingClientRect();
    stickOrigin.x = rect.left + rect.width / 2;
    stickOrigin.y = rect.top + rect.height / 2;
    stickMove(e);
    e.preventDefault();
  }

  function stickMove(e) {
    var list = e.changedTouches || [e];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var id = e.changedTouches ? t.identifier : 'mouse';
      if (id !== stickId) continue;
      var dx = t.clientX - stickOrigin.x;
      var dy = t.clientY - stickOrigin.y;
      var len = Math.hypot(dx, dy);
      if (len > STICK_RANGE) { dx *= STICK_RANGE / len; dy *= STICK_RANGE / len; }
      touch.ax = U.clamp(dx / STICK_RANGE, -1, 1);
      touch.ay = U.clamp(dy / STICK_RANGE, -1, 1);
      if (knobEl) knobEl.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    }
    e.preventDefault();
  }

  function stickEnd(e) {
    var list = e.changedTouches || [e];
    for (var i = 0; i < list.length; i++) {
      var id = e.changedTouches ? list[i].identifier : 'mouse';
      if (id === stickId) {
        stickId = null;
        touch.ax = 0;
        touch.ay = 0;
        resetKnob();
      }
    }
  }

  function wireButtons() {
    var btns = document.querySelectorAll('#touch-buttons .touch-btn');
    Array.prototype.forEach.call(btns, function (btn) {
      var action = btn.getAttribute('data-action');
      function down(e) {
        BB.Audio.start();
        btn.classList.add('held');
        if (action === 'pause') {
          pressQueue.KeyP = (pressQueue.KeyP || 0) + 1;
        } else {
          touch[action] = true;
        }
        e.preventDefault();
      }
      function up(e) {
        btn.classList.remove('held');
        if (action !== 'pause') touch[action] = false;
        if (e) e.preventDefault();
      }
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up, { passive: false });
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
      btn.addEventListener('mouseleave', up);
    });
  }

  function hasTouch() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  function attach() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) flush();
    });

    stickEl = document.getElementById('stick');
    knobEl = document.getElementById('stick-knob');
    if (stickEl) {
      stickEl.addEventListener('touchstart', stickStart, { passive: false });
      stickEl.addEventListener('touchmove', stickMove, { passive: false });
      stickEl.addEventListener('touchend', stickEnd, { passive: false });
      stickEl.addEventListener('touchcancel', stickEnd, { passive: false });
    }
    wireButtons();

    if (hasTouch()) {
      state.touchActive = true;
      var el = document.getElementById('touch');
      if (el) el.classList.remove('hidden');
    }
  }

  function showTouch(show) {
    var el = document.getElementById('touch');
    if (el && state.touchActive) el.classList.toggle('hidden', !show);
  }

  BB.Input = {
    attach: attach,
    update: update,
    flush: flush,
    isHeld: isHeld,
    consumePress: consumePress,
    clearPresses: clearPresses,
    onKey: function (fn) { listeners.push(fn); },
    showTouch: showTouch,
    state: state
  };

})(window.BB = window.BB || {});
