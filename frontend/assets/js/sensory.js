(() => {
  'use strict';

  const LEGACY_KEY = 'usaSpendingWatch.sensory';
  const MOTION_KEY = 'usaSpendingWatch.motion';
  const FEEDBACK_KEY = 'usaSpendingWatch.feedback';
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
  let motionEnabled = loadToggle(MOTION_KEY, !motionReduced());
  let feedbackEnabled = loadToggle(FEEDBACK_KEY, !motionReduced());
  let lastHoverAt = 0;
  let lastTapAt = 0;

  function motionReduced() {
    return Boolean(reduceMotionQuery && reduceMotionQuery.matches);
  }

  function storedValue(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function loadToggle(key, fallback) {
    const stored = storedValue(key);
    const legacy = storedValue(LEGACY_KEY);
    if (stored === 'on') return true;
    if (stored === 'off') return false;
    if (legacy === 'on') return true;
    if (legacy === 'off') return false;
    return fallback;
  }

  function saveToggle(key, value) {
    try {
      window.localStorage.setItem(key, value ? 'on' : 'off');
    } catch (error) {
      // Private browsing or blocked storage: keep runtime-only state.
    }
  }

  function getAudioContext() {
    if (!feedbackEnabled || !AudioCtx) return null;
    if (!audioContext) {
      audioContext = new AudioCtx();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.42;
      masterGain.connect(audioContext.destination);
    }
    return audioContext;
  }

  function withAudio(run) {
    const ctx = getAudioContext();
    if (!ctx || !masterGain) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => run(ctx)).catch(() => {});
      return;
    }
    run(ctx);
  }

  function tone({ freq, endFreq = freq, duration = 0.05, type = 'triangle', gain = 0.035, delay = 0 }) {
    if (!feedbackEnabled) return;
    withAudio((ctx) => {
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
    });
  }

  function vibrate(kind) {
    if (!feedbackEnabled || !navigator.vibrate) return false;
    const patterns = {
      map: [10, 32, 22],
      success: [14, 32, 20],
      toggleOn: [12, 26, 18],
      toggleOff: 28,
      close: [22, 22, 12],
      nav: 10,
      tap: 8
    };
    try {
      return navigator.vibrate(patterns[kind] || patterns.tap);
    } catch (error) {
      return false;
    }
  }

  function play(kind) {
    if (!feedbackEnabled) return;
    if (kind === 'hover') {
      if (!audioContext) return;
      tone({ freq: 960, endFreq: 1280, duration: 0.018, type: 'sine', gain: 0.012 });
      return;
    }
    if (kind === 'map') {
      tone({ freq: 196, endFreq: 392, duration: 0.085, type: 'triangle', gain: 0.058 });
      tone({ freq: 392, endFreq: 740, duration: 0.12, type: 'sine', gain: 0.044, delay: 0.06 });
      return;
    }
    if (kind === 'success' || kind === 'toggleOn') {
      tone({ freq: 440, endFreq: 660, duration: 0.075, type: 'triangle', gain: 0.05 });
      tone({ freq: 660, endFreq: 990, duration: 0.11, type: 'sine', gain: 0.037, delay: 0.055 });
      return;
    }
    if (kind === 'toggleOff' || kind === 'close') {
      tone({ freq: 520, endFreq: 260, duration: 0.075, type: 'triangle', gain: 0.04 });
      return;
    }
    if (kind === 'nav') {
      tone({ freq: 392, endFreq: 560, duration: 0.045, type: 'triangle', gain: 0.036 });
      return;
    }
    tone({ freq: 680, endFreq: 540, duration: 0.04, type: 'triangle', gain: 0.036 });
  }

  function pulse(kind = 'tap') {
    if (!feedbackEnabled) return;
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

  function updateMotionToggle() {
    const button = document.getElementById('sensoryToggle');
    document.documentElement.dataset.motion = motionEnabled ? 'on' : 'off';
    syncHeroVideo();
    if (!button) return;
    button.textContent = motionEnabled ? 'FX on' : 'FX off';
    button.dataset.enabled = String(motionEnabled);
    button.setAttribute('aria-pressed', String(motionEnabled));
    button.title = motionEnabled ? 'Visual effects on' : 'Visual effects off';
  }

  function updateSoundToggle() {
    const button = document.getElementById('soundToggle');
    if (!button) return;
    button.dataset.enabled = String(feedbackEnabled);
    button.setAttribute('aria-pressed', String(feedbackEnabled));
    button.setAttribute('aria-label', feedbackEnabled ? 'Sound and haptic feedback on' : 'Sound and haptic feedback off');
    button.title = feedbackEnabled
      ? 'Sound and haptic feedback on'
      : 'Sound and haptic feedback off';
    document.documentElement.dataset.feedback = feedbackEnabled ? 'on' : 'off';
  }

  function syncHeroVideo() {
    const video = document.querySelector('.hero-bg-video');
    if (!video) return;
    const source = video.dataset.src;

    if (motionEnabled && source) {
      document.documentElement.dataset.videoMotion = 'loading';
      if (!video.getAttribute('src')) {
        video.defaultMuted = true;
        video.muted = true;
        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', '');
        video.setAttribute('loop', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('src', source);
        video.load();
      }
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.dataset.enabled = 'true';
      const playResult = video.play();
      if (playResult && typeof playResult.catch === 'function') {
        playResult
          .then(() => {
            document.documentElement.dataset.videoMotion = 'playing';
          })
          .catch(() => {
            document.documentElement.dataset.videoMotion = 'blocked';
          });
      } else {
        document.documentElement.dataset.videoMotion = 'playing';
      }
      return;
    }

    video.dataset.enabled = 'false';
    document.documentElement.dataset.videoMotion = 'off';
    video.pause();
    if (video.getAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  }

  function setMotionEnabled(nextEnabled) {
    motionEnabled = Boolean(nextEnabled);
    saveToggle(MOTION_KEY, motionEnabled);
    updateMotionToggle();
  }

  function setFeedbackEnabled(nextEnabled) {
    const wasEnabled = feedbackEnabled;
    if (wasEnabled && !nextEnabled) {
      vibrate('toggleOff');
      play('toggleOff');
    }
    feedbackEnabled = Boolean(nextEnabled);
    saveToggle(FEEDBACK_KEY, feedbackEnabled);
    updateSoundToggle();
    if (feedbackEnabled) {
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
    const motionToggle = document.getElementById('sensoryToggle');
    const soundToggle = document.getElementById('soundToggle');

    if (motionToggle) {
      motionToggle.addEventListener('click', () => setMotionEnabled(!motionEnabled));
    }
    if (soundToggle) {
      soundToggle.addEventListener('click', () => setFeedbackEnabled(!feedbackEnabled));
    }

    updateMotionToggle();
    updateSoundToggle();

    document.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const target = closestFrom(event.target, interactiveSelector);
      if (!target || target.id === 'sensoryToggle' || target.id === 'soundToggle' || isDisabled(target)) return;
      const now = performance.now();
      if (now - lastTapAt < 42) return;
      lastTapAt = now;
      pulse(kindFor(target));
    }, { passive: true });

    document.addEventListener('pointerenter', (event) => {
      if (!finePointerQuery || !finePointerQuery.matches || !feedbackEnabled) return;
      const target = closestFrom(event.target, '.btn-map,.btn-sec,.feedback-btn,.sensory-toggle,.sound-toggle,.fc,.stb,.pi,.map-label');
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
    setMotionEnabled,
    setFeedbackEnabled,
    setEnabled: setFeedbackEnabled,
    isMotionEnabled: () => motionEnabled,
    isFeedbackEnabled: () => feedbackEnabled,
    isEnabled: () => feedbackEnabled
  };
})();
