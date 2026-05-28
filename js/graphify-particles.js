/* ===== GRAPHIFY PARTICLES — Lightweight canvas particle system ===== */
(function() {
  'use strict';

  const CFG = {
    count: 55,
    speed: 0.35,
    radius: 1.8,
    lineLen: 130,
    fps: 30,
  };

  let canvas, ctx, particles = [], raf, lastFrame = 0, paused = false;

  function isLiteMode() {
    return document.documentElement.dataset.style === 'lite';
  }
  function isDark() {
    return document.documentElement.dataset.theme !== 'light';
  }

  function getColors() {
    return isDark()
      ? { dot: 'rgba(0,245,160,0.6)', line: 'rgba(0,217,245,0.12)' }
      : { dot: 'rgba(0,153,100,0.5)', line: 'rgba(0,136,170,0.08)' };
  }

  function init() {
    if (isLiteMode()) return;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'gfParticles';
      document.body.insertBefore(canvas, document.body.firstChild);
      ctx = canvas.getContext('2d');
    }
    resize();
    spawnParticles();
    requestAnimationFrame(() => {
      canvas.classList.add('gf-ready');
      loop(0);
    });

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      paused = document.hidden;
      if (!paused) loop(0);
    });
  }

  function resize() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function spawnParticles() {
    particles = [];
    for (let i = 0; i < CFG.count; i++) {
      particles.push({
        x:  Math.random() * canvas.width,
        y:  Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * CFG.speed,
        vy: (Math.random() - 0.5) * CFG.speed,
        r:  CFG.radius * (0.6 + Math.random() * 0.8),
      });
    }
  }

  function loop(ts) {
    if (paused || isLiteMode()) return;
    raf = requestAnimationFrame(loop);
    if (ts - lastFrame < 1000 / CFG.fps) return;
    lastFrame = ts;
    draw();
  }

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const col = getColors();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = col.dot;
      ctx.fill();

      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CFG.lineLen) {
          const alpha = (1 - dist / CFG.lineLen) * 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = col.line.replace('0.12)', alpha * 0.25 + ')');
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
  }

  /* Restart when style changes (glass ↔ lite) */
  const _origSetStyle = window.setStyle;
  if (typeof _origSetStyle === 'function') {
    window.setStyle = function(s) {
      _origSetStyle(s);
      if (s === 'glass' && !canvas) { init(); }
      else if (s === 'lite' && canvas) {
        cancelAnimationFrame(raf);
        canvas.classList.remove('gf-ready');
      } else if (s === 'glass' && canvas) {
        canvas.classList.add('gf-ready');
        loop(0);
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();
