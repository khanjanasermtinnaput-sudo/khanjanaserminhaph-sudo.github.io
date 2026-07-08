// NET WORTH ONLINE — landing/login page interactions.
// Scope: #loginSection + #themeControls only. Does not touch post-login UI.

(function () {
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // ── Numeric-only PIN filter (both forms) ──
  function wireNumericPin(pinId) {
    const pinEl = document.getElementById(pinId);
    if (!pinEl) return;
    pinEl.addEventListener('input', () => {
      const digitsOnly = pinEl.value.replace(/\D/g, '').slice(0, 4);
      if (digitsOnly !== pinEl.value) pinEl.value = digitsOnly;
    });
  }

  // ── Enter-to-submit for the register form only — the login form and the
  // quick-login card already have a global Enter handler in leaderboard.js,
  // so wiring it again here would double-submit login(). ──
  function wireEnterSubmit(nameId, pinId, submitFn) {
    const nameEl = document.getElementById(nameId);
    const pinEl = document.getElementById(pinId);
    if (!nameEl || !pinEl) return;
    [nameEl, pinEl].forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitFn(); }
      });
    });
  }

  // ── Settings popover (⚙️ top-right) ──
  function nwoToggleSettings(forceOpen) {
    const btn = document.getElementById('nwoSettingsBtn');
    const panel = document.getElementById('nwoSettingsPanel');
    if (!btn || !panel) return;
    const willOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.hasAttribute('hidden');
    if (willOpen) {
      panel.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
    } else {
      panel.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
    }
  }
  window.nwoToggleSettings = nwoToggleSettings;

  document.addEventListener('click', e => {
    const wrap = document.querySelector('.nwo-settings-wrap');
    const panel = document.getElementById('nwoSettingsPanel');
    if (!wrap || !panel || panel.hasAttribute('hidden')) return;
    if (!wrap.contains(e.target)) nwoToggleSettings(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') nwoToggleSettings(false);
  });

  // ── Floating background particles (skipped under reduced-motion) ──
  function spawnParticles() {
    const host = document.getElementById('nwoParticles');
    if (!host || prefersReducedMotion) return;
    const COUNT = 16;
    for (let i = 0; i < COUNT; i++) {
      const p = document.createElement('span');
      p.className = 'nwo-particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.setProperty('--nwo-drift', (Math.random() * 40 - 20).toFixed(1) + 'px');
      p.style.setProperty('--nwo-dur', (14 + Math.random() * 12).toFixed(1) + 's');
      p.style.setProperty('--nwo-delay', (-Math.random() * 20).toFixed(1) + 's');
      p.style.setProperty('--nwo-size', (2 + Math.random() * 3).toFixed(1) + 'px');
      host.appendChild(p);
    }
  }

  onReady(() => {
    wireNumericPin('loginPin');
    wireNumericPin('regPin');
    wireEnterSubmit('regName', 'regPin', () => register());
    spawnParticles();
  });
})();
