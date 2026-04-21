(() => {
  'use strict';

  const STORE_KEY = 'usaSpendingWatch.sensory';
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const reduceMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const finePointerQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  const interactiveSelector = [
    'a',
    'button',
    '[role="button"]',
    'select',
    '.fc',
    '.stb',
    '.pi',
    '.map-label',
    '.legend-btn',
    '.feedback-submit',
    '.modal-close',
    '.pager-btn',
    '.package-row-link'
  ].join(',');

  let audioContext = null;
  let masterGain = null;
  let enabled = loadPreference();
  let lastHoverAt = 0;
  let lastTapAt = 0;

  function motionReduced() {
    return Boolean(reduceMotionQuery && reduceMotionQuery.matches);
  }

  function loadPreference() {
    try {
      const stored = window.localStorage.getItem(STORE_KEY);
      if (stored === 'on') return true;
      if (stored === 'off') return false;
    } catch (error) {
      return !motionReduced();
    }
    return !motionReduced();
  }

  function savePreference() {
    try {
      window.localStorage.setItem(STORE_KEY, enabled ? 'on' : 'off');
    } catch (error) {
      // Private browsing or blocked storage: keep runtime-only state.
    }
  }

  function getAudioContext() {
    if (!enabled || !AudioCtx) return null;
    if (!audioContext) {
      audioContext = new AudioCtx();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.2;
      masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function tone({ freq, endFreq = freq, duration = 0.05, type = 'triangle', gain = 0.035, delay = 0 }) {
    const ctx = getAudioContext();
    if (!ctx || !masterGain) return;

    const start = ctx.currentTime + delay;
    const stop = start + duration;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, start);
    if (endFreq !== freq) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), stop);
    }

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, stop);

    oscillator.connect(envelope);
    envelope.connect(masterGain);
    oscillator.start(start);
    oscillator.stop(stop + 0.02);
  }

  function vibrate(kind) {
    if (!enabled || !navigator.vibrate) return;
    const patterns = {
      map: [8, 28, 18],
      success: [12, 30, 18],
      toggleOn: [10, 24, 16],
      toggleOff: 24,
      close: [22, 22, 10],
      nav: 8,
      tap: 7
    };
    try {
      navigator.vibrate(patterns[kind] || patterns.tap);
    } catch (error) {
      // Unsupported devices are expected. Sensory feedback must stay best-effort.
    }
  }

  function play(kind) {
    if (!enabled) return;
    if (kind === 'hover') {
      if (!audioContext) return;
      tone({ freq: 880, endFreq: 1120, duration: 0.018, type: 'sine', gain: 0.009 });
      return;
    }
    if (kind === 'map') {
      tone({ freq: 196, endFreq: 392, duration: 0.08, type: 'triangle', gain: 0.036 });
      tone({ freq: 392, endFreq: 588, duration: 0.11, type: 'sine', gain: 0.026, delay: 0.06 });
      return;
    }
    if (kind === 'success' || kind === 'toggleOn') {
      tone({ freq: 440, endFreq: 660, duration: 0.07, type: 'triangle', gain: 0.03 });
      tone({ freq: 660, endFreq: 880, duration: 0.1, type: 'sine', gain: 0.023, delay: 0.055 });
      return;
    }
    if (kind === 'toggleOff' || kind === 'close') {
      tone({ freq: 520, endFreq: 260, duration: 0.07, type: 'triangle', gain: 0.026 });
      return;
    }
    if (kind === 'nav') {
      tone({ freq: 392, endFreq: 520, duration: 0.04, type: 'triangle', gain: 0.021 });
      return;
    }
    tone({ freq: 620, endFreq: 520, duration: 0.035, type: 'triangle', gain: 0.022 });
  }

  function pulse(kind = 'tap') {
    if (!enabled) return;
    vibrate(kind);
    play(kind);
  }

  function isDisabled(element) {
    return Boolean(element && (element.disabled || element.getAttribute('aria-disabled') === 'true'));
  }

  function isTypingTarget(element) {
    return Boolean(element && (element.matches('input, textarea') || element.isContentEditable));
  }

  function kindFor(element) {
    if (!element) return 'tap';
    if (element.closest('.btn-map')) return 'map';
    if (element.closest('.btn-sec,.scroll-cue,.legend-btn,.fc,.stb,.pager-btn')) return 'nav';
    if (element.closest('.feedback-submit')) return 'success';
    if (element.closest('.modal-close,[aria-label*="Close"]')) return 'close';
    return 'tap';
  }

  function closestFrom(eventTarget, selector) {
    return eventTarget instanceof Element ? eventTarget.closest(selector) : null;
  }

  function updateToggle() {
    const button = document.getElementById('sensoryToggle');
    if (!button) return;
    button.textContent = enabled ? 'SFX on' : 'SFX off';
    button.dataset.enabled = String(enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? 'Sound and haptic feedback on' : 'Sound and haptic feedback off';
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    savePreference();
    updateToggle();
    if (enabled) {
      pulse('toggleOn');
    } else {
      try {
        navigator.vibrate && navigator.vibrate(0);
      } catch (error) {
        // no-op
      }
    }
  }

  function bind() {
    const toggle = document.getElementById('sensoryToggle');
    if (toggle) {
      toggle.addEventListener('click', () => setEnabled(!enabled));
    }
    updateToggle();

    document.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const target = closestFrom(event.target, interactiveSelector);
      if (!target || target.id === 'sensoryToggle' || isDisabled(target)) return;
      const now = performance.now();
      if (now - lastTapAt < 42) return;
      lastTapAt = now;
      pulse(kindFor(target));
    }, { passive: true });

    document.addEventListener('pointerenter', (event) => {
      if (!finePointerQuery || !finePointerQuery.matches || !enabled) return;
      const target = closestFrom(event.target, '.btn-map,.btn-sec,.feedback-btn,.sensory-toggle,.fc,.stb,.pi,.map-label');
      if (!target || isDisabled(target)) return;
      const now = performance.now();
      if (now - lastHoverAt < 180) return;
      lastHoverAt = now;
      play('hover');
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = closestFrom(event.target, interactiveSelector);
      if (!target || isTypingTarget(target) || isDisabled(target)) return;
      pulse(kindFor(target));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  window.Sensory = {
    pulse,
    setEnabled,
    isEnabled: () => enabled
  };
})();
