/* ============================================================
   MEDICAL INTERACTIVE PRESENTATION - JAVASCRIPT
   ระบบหายใจ และ ระบบไหลเวียนเลือดของมนุษย์
   ============================================================ */

/* ---- State ---- */
let currentSlide = 0;
let isAnimating = false;
const TOTAL_SLIDES = 8;

/* ---- Quiz State ---- */
const quizData = [
  {
    q: "อวัยวะใดที่ทำหน้าที่แลกเปลี่ยนก๊าซออกซิเจนและคาร์บอนไดออกไซด์?",
    opts: ["หัวใจ", "ถุงลม (Alveoli)", "หลอดลม", "ไต"],
    ans: 1
  },
  {
    q: "หัวใจของมนุษย์แบ่งออกเป็นกี่ห้อง?",
    opts: ["2 ห้อง", "3 ห้อง", "4 ห้อง", "5 ห้อง"],
    ans: 2
  },
  {
    q: "เลือดที่มีออกซิเจนสูง (Oxygenated Blood) มีสีอะไร?",
    opts: ["สีน้ำเงิน", "สีม่วง", "สีแดงสด", "สีส้ม"],
    ans: 2
  },
  {
    q: "ก๊าซใดที่ร่างกายหายใจเอาเข้าสู่ร่างกาย?",
    opts: ["คาร์บอนไดออกไซด์", "ไนโตรเจน", "ออกซิเจน", "ไฮโดรเจน"],
    ans: 2
  }
];
let quizAnswers = new Array(quizData.length).fill(null);
let currentQuestion = 0;
let quizDone = false;

/* ---- DOM References ---- */
const progressBar = document.getElementById('progress-bar');
const slideCounter = document.getElementById('slide-counter');
const dots = document.querySelectorAll('.dot');

/* ============================================================
   BACKGROUND PARTICLE SYSTEM
   ============================================================ */
function initBgCanvas() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < 80; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.5 + 0.3,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.5 + 0.1,
      color: Math.random() > 0.5 ? '0,212,255' : '74,158,255'
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
    });
    /* subtle connecting lines */
    ctx.strokeStyle = 'rgba(0,212,255,0.04)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < 120) {
          ctx.globalAlpha = 0.04 * (1 - d/120);
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
}

/* ============================================================
   GAS EXCHANGE CANVAS (Slide 3)
   ============================================================ */
function initGasCanvas() {
  const canvas = document.getElementById('gas-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  let mols = [];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  function spawnMol() {
    const isO2 = Math.random() > 0.5;
    const side = isO2 ? -1 : 1;
    mols.push({
      x: cx + side * (80 + Math.random() * 200),
      y: cy + (Math.random() - 0.5) * 200,
      tx: cx + side * -80,
      ty: cy + (Math.random() - 0.5) * 60,
      r: 5 + Math.random() * 3,
      color: isO2 ? '0,212,255' : '255,59,107',
      label: isO2 ? 'O₂' : 'CO₂',
      alpha: 0,
      progress: 0,
      speed: 0.004 + Math.random() * 0.003,
      isO2
    });
  }
  for (let i = 0; i < 10; i++) spawnMol();

  setInterval(spawnMol, 800);

  function drawArrow(ctx, fromX, fromY, toX, toY, color) {
    const dx = toX - fromX, dy = toY - fromY;
    const len = Math.sqrt(dx*dx + dy*dy);
    const angle = Math.atan2(dy, dx);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - 8 * Math.cos(angle - 0.4), toY - 8 * Math.sin(angle - 0.4));
    ctx.lineTo(toX - 8 * Math.cos(angle + 0.4), toY - 8 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    /* Alveolus circle */
    const r = 70;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,212,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,212,255,0.06)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();

    /* Capillary */
    ctx.beginPath();
    ctx.rect(cx - 180, cy - 18, 360, 36);
    ctx.strokeStyle = 'rgba(255,100,100,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const capGrad = ctx.createLinearGradient(cx - 180, 0, cx + 180, 0);
    capGrad.addColorStop(0, 'rgba(255,59,107,0.08)');
    capGrad.addColorStop(0.5, 'rgba(255,100,100,0.03)');
    capGrad.addColorStop(1, 'rgba(0,212,255,0.08)');
    ctx.fillStyle = capGrad;
    ctx.fill();

    /* Direction arrows */
    drawArrow(ctx, cx - 180, cy, cx - 100, cy, 'rgba(255,59,107,0.7)');
    drawArrow(ctx, cx + 100, cy, cx + 180, cy, 'rgba(0,212,255,0.7)');

    /* Molecules */
    mols = mols.filter(m => m.alpha > -0.1);
    mols.forEach(m => {
      m.progress = Math.min(1, m.progress + m.speed);
      m.x += (m.tx - m.x) * m.speed * 8;
      m.y += (m.ty - m.y) * m.speed * 8;
      m.alpha = m.progress < 0.1 ? m.progress * 10
              : m.progress > 0.85 ? (1 - m.progress) * (1/0.15)
              : 1;

      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${m.color},${m.alpha * 0.85})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${m.color},${m.alpha * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      /* glow */
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 3);
      g.addColorStop(0, `rgba(${m.color},${m.alpha * 0.3})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 3, 0, Math.PI * 2);
      ctx.fill();
    });

    /* Labels */
    ctx.fillStyle = 'rgba(0,212,255,0.6)';
    ctx.font = '12px Space Grotesk, sans-serif';
    ctx.fillText('ถุงลม', cx - 18, cy + 4);

    requestAnimationFrame(draw);
  }
  draw();
}

/* ============================================================
   BLOOD FLOW CANVAS (Slide 5)
   ============================================================ */
function initFlowCanvas() {
  const canvas = document.getElementById('flow-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  const W = canvas.width, H = canvas.height;
  const cx = W * 0.48, cy = H * 0.5;

  /* Blood particle */
  let particles = [];
  function spawnBloodParticle() {
    const isRich = Math.random() > 0.45;
    const angle = Math.random() * Math.PI * 2;
    const r = isRich ? 100 + Math.random() * 60 : 60 + Math.random() * 40;
    particles.push({
      angle,
      radius: r,
      speed: (isRich ? 0.015 : 0.02) * (Math.random() * 0.5 + 0.75),
      size: 4 + Math.random() * 3,
      color: isRich ? '220,30,60' : '40,80,200',
      alpha: Math.random() * 0.6 + 0.4,
      isRich,
      trail: []
    });
  }
  for (let i = 0; i < 40; i++) {
    const p = { angle: Math.random() * Math.PI * 2, radius: Math.random() > 0.5 ? 100 + Math.random()*60 : 60 + Math.random()*40, speed: 0.01 + Math.random()*0.015, size: 4 + Math.random()*3, color: Math.random()>0.45?'220,30,60':'40,80,200', alpha: Math.random()*0.6+0.4, isRich: Math.random()>0.45, trail: [] };
    particles.push(p);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* Body outline */
    ctx.save();
    ctx.strokeStyle = 'rgba(74,158,255,0.08)';
    ctx.lineWidth = 1.5;
    /* head */
    ctx.beginPath();
    ctx.arc(cx, cy - 160, 45, 0, Math.PI * 2);
    ctx.stroke();
    /* torso */
    ctx.beginPath();
    ctx.roundRect(cx - 55, cy - 110, 110, 150, 10);
    ctx.stroke();
    /* legs */
    ctx.beginPath();
    ctx.roundRect(cx - 50, cy + 40, 40, 120, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(cx + 10, cy + 40, 40, 120, 8);
    ctx.stroke();
    ctx.restore();

    /* Heart glow */
    const hg = ctx.createRadialGradient(cx, cy - 30, 0, cx, cy - 30, 40);
    hg.addColorStop(0, 'rgba(255,59,107,0.2)');
    hg.addColorStop(1, 'transparent');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(cx, cy - 30, 40, 0, Math.PI * 2);
    ctx.fill();

    /* Vessels */
    /* Aorta */
    ctx.beginPath();
    ctx.moveTo(cx, cy - 30);
    ctx.quadraticCurveTo(cx + 30, cy - 80, cx + 10, cy - 150);
    ctx.strokeStyle = 'rgba(220,30,60,0.3)';
    ctx.lineWidth = 6;
    ctx.stroke();
    /* Pulmonary */
    ctx.beginPath();
    ctx.moveTo(cx, cy - 30);
    ctx.quadraticCurveTo(cx - 50, cy, cx - 50, cy + 80);
    ctx.strokeStyle = 'rgba(40,80,200,0.25)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 30);
    ctx.quadraticCurveTo(cx + 50, cy, cx + 50, cy + 80);
    ctx.strokeStyle = 'rgba(40,80,200,0.25)';
    ctx.lineWidth = 5;
    ctx.stroke();

    /* Blood particles */
    particles.forEach(p => {
      p.angle += p.speed;
      const x = cx + Math.cos(p.angle) * p.radius * (p.isRich ? 1 : 0.6);
      const y = (cy - 30) + Math.sin(p.angle) * p.radius * 0.55;

      p.trail.push({ x, y });
      if (p.trail.length > 6) p.trail.shift();

      /* trail */
      p.trail.forEach((pt, i) => {
        const ta = (i / p.trail.length) * p.alpha * 0.4;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, p.size * (i/p.trail.length), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${ta})`;
        ctx.fill();
      });

      /* particle */
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      ctx.fill();

      /* glow */
      const g = ctx.createRadialGradient(x, y, 0, x, y, p.size * 3);
      g.addColorStop(0, `rgba(${p.color},0.3)`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, p.size * 3, 0, Math.PI * 2);
      ctx.fill();
    });

    /* Lung glow */
    const lg = ctx.createRadialGradient(cx - 55, cy - 30, 0, cx - 55, cy - 30, 50);
    lg.addColorStop(0, 'rgba(0,212,255,0.12)');
    lg.addColorStop(1, 'transparent');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(cx - 55, cy - 30, 50, 0, Math.PI * 2);
    ctx.fill();
    const lg2 = ctx.createRadialGradient(cx + 55, cy - 30, 0, cx + 55, cy - 30, 50);
    lg2.addColorStop(0, 'rgba(0,212,255,0.12)');
    lg2.addColorStop(1, 'transparent');
    ctx.fillStyle = lg2;
    ctx.beginPath();
    ctx.arc(cx + 55, cy - 30, 50, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(draw);
  }
  draw();
}

/* ============================================================
   SLIDE NAVIGATION
   ============================================================ */
function updateUI() {
  /* Progress bar */
  progressBar.style.width = ((currentSlide + 1) / TOTAL_SLIDES * 100) + '%';

  /* Counter */
  slideCounter.textContent = `${currentSlide + 1} / ${TOTAL_SLIDES}`;

  /* Dots */
  dots.forEach((d, i) => {
    d.classList.toggle('active', i === currentSlide);
  });
}

function goToSlide(index, direction = 1) {
  if (isAnimating || index === currentSlide || index < 0 || index >= TOTAL_SLIDES) return;
  isAnimating = true;

  const slides = document.querySelectorAll('.slide');
  const current = slides[currentSlide];
  const next = slides[index];

  const xOut = direction > 0 ? '-60px' : '60px';
  const xIn  = direction > 0 ? '60px'  : '-60px';

  /* Animate out current */
  gsap.to(current, {
    opacity: 0, x: xOut, duration: 0.5, ease: 'power2.in',
    onComplete: () => {
      current.classList.remove('active');
      gsap.set(current, { x: 0 });
    }
  });

  /* Animate in next */
  gsap.fromTo(next,
    { opacity: 0, x: xIn },
    {
      opacity: 1, x: 0, duration: 0.6, ease: 'power2.out', delay: 0.1,
      onStart: () => {
        next.classList.add('active');
        currentSlide = index;
        updateUI();
        onSlideEnter(index);
      },
      onComplete: () => {
        isAnimating = false;
      }
    }
  );
}

function nextSlide() { goToSlide(currentSlide + 1, 1); }
function prevSlide() { goToSlide(currentSlide - 1, -1); }

/* Called when a slide becomes visible */
function onSlideEnter(index) {
  if (index === 2) initGasCanvas();   /* Gas Exchange */
  if (index === 4) initFlowCanvas();  /* Blood Flow */
  if (index === 6) renderQuiz();      /* Quiz */
}

/* ============================================================
   QUIZ LOGIC
   ============================================================ */
function renderQuiz() {
  const container = document.getElementById('quiz-area');
  if (!container) return;

  if (quizDone) { showScore(); return; }

  const q = quizData[currentQuestion];
  container.innerHTML = `
    <div class="mb-4">
      <div style="display:flex;gap:8px;margin-bottom:20px;">
        ${quizData.map((_, i) => `
          <div class="quiz-progress-dot ${i < currentQuestion ? (quizAnswers[i]===quizData[i].ans?'done':'wrong') : i===currentQuestion?'curr':''}"></div>
        `).join('')}
      </div>
      <p style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--accent-cyan);margin-bottom:10px;">
        คำถามที่ ${currentQuestion + 1} จาก ${quizData.length}
      </p>
      <p style="font-size:clamp(1rem,2vw,1.15rem);font-weight:500;line-height:1.5;margin-bottom:24px;color:var(--text-primary);">
        ${q.q}
      </p>
    </div>
    <div>
      ${q.opts.map((opt, i) => `
        <button class="quiz-option" onclick="answerQuiz(${i})" id="opt-${i}">
          <span style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.06);
            display:flex;align-items:center;justify-content:center;font-size:12px;
            font-weight:600;flex-shrink:0;">${['A','B','C','D'][i]}</span>
          ${opt}
        </button>
      `).join('')}
    </div>
  `;
}

function answerQuiz(chosen) {
  const q = quizData[currentQuestion];
  quizAnswers[currentQuestion] = chosen;

  const opts = document.querySelectorAll('.quiz-option');
  opts.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.ans) btn.classList.add('correct');
    else if (i === chosen && chosen !== q.ans) btn.classList.add('wrong');
  });

  setTimeout(() => {
    currentQuestion++;
    if (currentQuestion >= quizData.length) {
      quizDone = true;
      showScore();
    } else {
      renderQuiz();
    }
  }, 1200);
}

function showScore() {
  const container = document.getElementById('quiz-area');
  if (!container) return;
  const score = quizAnswers.reduce((acc, ans, i) => acc + (ans === quizData[i].ans ? 1 : 0), 0);
  const pct = Math.round(score / quizData.length * 100);

  const emoji = score === quizData.length ? '🏆' : score >= quizData.length * 0.75 ? '⭐' : score >= quizData.length * 0.5 ? '👍' : '📚';
  const msg   = score === quizData.length ? 'ยอดเยี่ยมมาก! คุณเข้าใจเนื้อหาได้อย่างสมบูรณ์แบบ'
              : score >= quizData.length * 0.75 ? 'ดีมาก! คุณเข้าใจเนื้อหาเป็นอย่างดี'
              : score >= quizData.length * 0.5 ? 'ผ่านได้ ลองทบทวนเนื้อหาอีกครั้ง'
              : 'ลองศึกษาเนื้อหาใหม่อีกครั้งนะ';

  container.innerHTML = `
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:3rem;margin-bottom:12px;">${emoji}</div>
      <div class="score-display gradient-text-cyan">${score}/${quizData.length}</div>
      <div style="font-size:2rem;font-weight:700;color:var(--accent-cyan);margin:4px 0;">${pct}%</div>
      <p style="color:var(--text-secondary);font-size:15px;margin:16px 0 24px;">${msg}</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;">
        ${quizData.map((q, i) => `
          <div style="padding:8px 14px;border-radius:10px;font-size:13px;
            background:${quizAnswers[i]===q.ans?'rgba(0,255,157,0.1)':'rgba(255,59,107,0.1)'};
            border:1px solid ${quizAnswers[i]===q.ans?'rgba(0,255,157,0.3)':'rgba(255,59,107,0.3)'};
            color:${quizAnswers[i]===q.ans?'var(--accent-green)':'var(--accent-red)'};">
            ข้อ ${i+1} ${quizAnswers[i]===q.ans?'✓':'✗'}
          </div>
        `).join('')}
      </div>
      <button onclick="retryQuiz()" style="padding:12px 32px;border-radius:50px;
        background:linear-gradient(135deg,var(--accent-cyan),var(--accent-blue));
        border:none;color:#000;font-weight:600;font-size:14px;cursor:pointer;
        font-family:'Prompt',sans-serif;">
        ทำใหม่อีกครั้ง
      </button>
    </div>
  `;
}

function retryQuiz() {
  quizAnswers = new Array(quizData.length).fill(null);
  currentQuestion = 0;
  quizDone = false;
  renderQuiz();
}

/* ============================================================
   KEYBOARD & TOUCH NAVIGATION
   ============================================================ */
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); nextSlide(); }
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')                    { e.preventDefault(); prevSlide(); }
  if (e.key >= '1' && e.key <= '8') goToSlide(parseInt(e.key) - 1);
});

/* Touch swipe */
let touchStartX = 0, touchStartY = 0;
document.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
    dx < 0 ? nextSlide() : prevSlide();
  }
}, { passive: true });

/* Mouse wheel */
let wheelTimeout = null;
document.addEventListener('wheel', e => {
  if (wheelTimeout) return;
  e.deltaY > 0 ? nextSlide() : prevSlide();
  wheelTimeout = setTimeout(() => { wheelTimeout = null; }, 800);
}, { passive: true });

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initBgCanvas();

  /* Show first slide */
  const first = document.querySelector('.slide');
  if (first) {
    first.classList.add('active');
    gsap.fromTo(first, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.2, ease: 'power2.out' });
  }

  /* Animate intro elements */
  gsap.from('#intro-title',    { opacity: 0, y: 40, duration: 1,   delay: 0.3, ease: 'power2.out' });
  gsap.from('#intro-subtitle', { opacity: 0, y: 30, duration: 0.9, delay: 0.6, ease: 'power2.out' });
  gsap.from('#intro-meta',     { opacity: 0, y: 20, duration: 0.8, delay: 0.9, ease: 'power2.out' });
  gsap.from('#intro-btn',      { opacity: 0, y: 20, scale: 0.9, duration: 0.8, delay: 1.1, ease: 'back.out(1.7)' });

  updateUI();
});
