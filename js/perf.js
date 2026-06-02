// Badminton Club — Performance helpers
// Goal: keep every visual/animation identical, just stop doing work the user can't see.
// (1) Pause ALL CSS animations while the tab/app is backgrounded or the page is hidden.
//     They resume exactly where they were the moment the page becomes visible again,
//     so on-screen appearance never changes — we only reclaim GPU/CPU and battery.
// Off-screen-while-scrolling pausing is handled in CSS via `content-visibility:auto`
// on long list rows (.lb-item / .hist-item / .ach-list-item).
(function () {
  'use strict';
  var root = document.documentElement;
  var PAUSED = 'perf-anim-paused';

  function sync() {
    // document.hidden is true when the tab is in the background / app is minimized.
    if (document.hidden) root.classList.add(PAUSED);
    else root.classList.remove(PAUSED);
  }

  document.addEventListener('visibilitychange', sync, { passive: true });
  // pagehide/pageshow cover bfcache + iOS Safari where visibilitychange is unreliable.
  window.addEventListener('pagehide', function () { root.classList.add(PAUSED); }, { passive: true });
  window.addEventListener('pageshow', sync, { passive: true });

  sync();
})();
