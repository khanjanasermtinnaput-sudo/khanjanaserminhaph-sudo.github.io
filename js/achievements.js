// ============================================================
// ===== FEATURE: ACHIEVEMENT SYSTEM =====
// ============================================================
const ACHIEVEMENTS_DEF = [
  {
    id: 'prime_of_month',
    icon: '👑',
    title: 'Prime of Month',
    desc: 'Win Rate สูงสุดของเดือน (ต้องเล่น >5 แมตช์, rank Master ขึ้นไป)',
    color: '#ffd700',
    glow: 'rgba(255,215,0,0.4)',
    check: (p, allPlayers, allMatches) => {
      const rank = getRankByPts(p.pts);
      if (rank.id !== 'master' && rank.id !== 'king') return false;

      const now = new Date();
      const monthMatches = allMatches.filter(m => {
        const d = new Date(m.date || m.played_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      });

      const myMonthMatches = monthMatches.filter(m => [...m.teamA, ...m.teamB].some(x => x.id === p.id));
      if (myMonthMatches.length <= 5) return false; // ต้องมากกว่า 5 ตา

      const myWins = myMonthMatches.filter(m => {
        const inA = m.teamA.some(x => x.id === p.id);
        return (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
      }).length;
      const myWR = myWins / myMonthMatches.length;

      // Check if highest WR among master+ players with >5 games
      for (const other of allPlayers) {
        if (other.id === p.id) continue;
        const otherRank = getRankByPts(other.pts);
        if (otherRank.id !== 'master' && otherRank.id !== 'king') continue;
        const otherMonthM = monthMatches.filter(m => [...m.teamA, ...m.teamB].some(x => x.id === other.id));
        if (otherMonthM.length <= 5) continue; // ต้องมากกว่า 5 ตาเช่นกัน
        const otherWins = otherMonthM.filter(m => {
          const inA = m.teamA.some(x => x.id === other.id);
          return (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
        }).length;
        if (otherWins / otherMonthM.length > myWR) return false;
      }
      return true;
    }
  },
  {
    id: 'hardworker',
    icon: '🎯',
    title: 'ขยันเล่นนะมึงอะ',
    desc: 'เล่นมากที่สุดในสัปดาห์ (ต้องเล่น ≥5 แมตช์, ตัดสินผลวันอาทิตย์)',
    color: '#00f5a0',
    glow: 'rgba(0,245,160,0.4)',
    check: (p, allPlayers, allMatches) => {
      const now = new Date();
      // ต้องเป็นวันอาทิตย์เท่านั้นถึงจะ unlock ได้
      if (now.getDay() !== 0) return false;

      // นับตั้งแต่จันทร์ของสัปดาห์นี้ (วันอาทิตย์ - 6 วัน) ถึงวันอาทิตย์วันนี้
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 6); // จันทร์
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(now);
      weekEnd.setHours(23, 59, 59, 999); // สิ้นสุดวันอาทิตย์

      const weekMatches = allMatches.filter(m => {
        const d = new Date(m.date || m.played_at);
        return d >= weekStart && d <= weekEnd;
      });

      const countMap = {};
      allPlayers.forEach(pl => { countMap[pl.id] = 0; });
      weekMatches.forEach(m => {
        [...m.teamA, ...m.teamB].forEach(x => { if (countMap[x.id] !== undefined) countMap[x.id]++; });
      });

      const myCount = countMap[p.id] || 0;
      if (myCount < 5) return false; // ต้องเล่นอย่างน้อย 5 ตา
      return !Object.entries(countMap).some(([id, cnt]) => parseInt(id) !== p.id && cnt > myCount);
    }
  },
  {
    id: 'master_player',
    icon: '🔥',
    title: 'Master Player',
    desc: 'ไต่ขึ้นถึง rank Master',
    color: '#ff6b35',
    glow: 'rgba(255,107,53,0.4)',
    check: (p) => {
      const rank = getRankByPts(p.pts);
      return rank.id === 'master' || rank.id === 'king';
    }
  },
  {
    id: 'conqueror',
    icon: '👑',
    title: 'Conqueror',
    desc: 'ไต่ขึ้นถึง rank King of Badminton!',
    color: '#ffd700',
    glow: 'rgba(255,215,0,0.5)',
    check: (p) => {
      const rank = getRank(p.pts, p.id);
      return rank.id === 'king';
    }
  }
];

// [NEW] Tournament achievement definitions — check via customAch (awarded by admin on declare champion)
const TOURNAMENT_ACHIEVEMENTS_DEF = [
  {
    id: 'sys_tour_regular',
    icon: '🏆', title: 'Tournament Champion',
    desc: 'ชนะ Regular Tournament',
    color: '#cd7f32', glow: 'rgba(205,127,50,0.5)',
    check: (p) => (p.customAch || []).some(a => a.id === 'sys_tour_regular')
  },
  {
    id: 'sys_tour_s500',
    icon: '🥈', title: 'Super 500 Champion',
    desc: 'ชนะ Super 500 Tournament',
    color: '#c8c8c8', glow: 'rgba(192,192,192,0.5)',
    check: (p) => (p.customAch || []).some(a => a.id === 'sys_tour_s500')
  },
  {
    id: 'sys_tour_s1000',
    icon: '👑', title: 'Super 1000 Champion',
    desc: 'ชนะ Super 1000 Tournament',
    color: '#ffd700', glow: 'rgba(255,215,0,0.6)',
    check: (p) => (p.customAch || []).some(a => a.id === 'sys_tour_s1000')
  },
  {
    id: 'sys_tour_doubles',
    icon: '⚔️', title: 'Doubles Champion',
    desc: 'ชนะ Tournament โหมด 2v2',
    color: '#8a9fff', glow: 'rgba(138,159,255,0.5)',
    check: (p) => (p.customAch || []).some(a => a.id === 'sys_tour_doubles')
  },
];

function getAchievements(playerId) {
  const p = db.players.find(x => x.id === playerId);
  if (!p) return [];
  // [NEW] Merge built-in ACHIEVEMENTS_DEF + tournament achievements
  const allDefs = [...ACHIEVEMENTS_DEF, ...TOURNAMENT_ACHIEVEMENTS_DEF];
  return allDefs.map(ach => ({
    ...ach,
    unlocked: ach.check(p, db.players, db.matches)
  }));
}

// Achievement unlock queue (show popup)
let _achQueue = [];
let _achShowing = false;

function checkNewAchievements(playerId) {
  const key = `badminton_ach_${playerId}`;
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  const achievements = getAchievements(playerId);
  achievements.forEach(ach => {
    if (ach.unlocked && !seen[ach.id]) {
      seen[ach.id] = Date.now();
      _achQueue.push(ach);
    }
  });
  try { localStorage.setItem(key, JSON.stringify(seen)); } catch(e) {}
  if (!_achShowing && _achQueue.length > 0) _processAchQueue();
}

function _processAchQueue() {
  if (_achQueue.length === 0) { _achShowing = false; return; }
  // Don't show achievement while a rank-up overlay is actually visible (self-healing — check DOM, not just flag)
  const ru = document.getElementById('rankUpOverlay');
  const kru = document.getElementById('kingRankUpOverlay');
  const ruVisible  = ru  && ru.classList.contains('ru-show');
  const kruVisible = kru && kru.classList.contains('kru-show');
  if (ruVisible || kruVisible) { setTimeout(_processAchQueue, 1000); return; }
  if (!ruVisible && !kruVisible) _ruShowing = false;
  _achShowing = true;
  const ach = _achQueue.shift();

  // Clone entire overlay to reset ALL CSS animations (sweep, bg-glow, center)
  const overlay = document.getElementById('achOverlay');
  const fresh = overlay.cloneNode(true);
  fresh.querySelector('#achParticles').innerHTML = '';
  overlay.parentNode.replaceChild(fresh, overlay);

  // Set CSS color var + background glow
  fresh.style.setProperty('--ach-color', ach.color);
  const bgGlow = fresh.querySelector('#achBgGlow');
  if (bgGlow) bgGlow.style.background = `radial-gradient(ellipse 60% 60% at 50% 50%, ${ach.glow || 'rgba(255,215,0,0.25)'} 0%, transparent 70%)`;

  // Set content
  fresh.querySelector('#achIcon').textContent = ach.icon;
  fresh.querySelector('#achTitle').textContent = ach.title;
  const descEl = fresh.querySelector('#achDesc');
  if (descEl) descEl.textContent = ach.desc;

  // Spawn particles
  const pCont = fresh.querySelector('#achParticles');
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  for (let i = 0; i < 45; i++) {
    const p = document.createElement('div');
    p.className = 'ru-particle';
    const size = 3 + Math.random() * 8;
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 230;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 60;
    const dur = 1.2 + Math.random() * 1.2;
    const delay = Math.random() * 0.5;
    p.style.cssText = `width:${size}px;height:${size}px;background:${Math.random()>0.4?ach.color:'#fff'};left:${cx}px;top:${cy}px;--tx:${tx}px;--ty:${ty}px;--dur:${dur}s;animation-delay:${delay}s;`;
    pCont.appendChild(p);
  }

  fresh.classList.add('ach-show');
  document.body.dataset.achLock = '1';
  document.body.style.overflow = 'hidden';
}

function closeAchievement() {
  const overlay = document.getElementById('achOverlay');
  overlay.style.transition = 'opacity 0.4s ease';
  overlay.style.opacity = '0';
  setTimeout(() => {
    overlay.classList.remove('ach-show');
    overlay.style.opacity = '';
    overlay.style.transition = '';
    document.getElementById('achParticles').innerHTML = '';
    delete document.body.dataset.achLock;
    if (!document.body.dataset.ruLock && !document.body.dataset.ppLock && !document.body.dataset.refLock) {
      document.body.style.overflow = '';
    }
    _achShowing = false;
    setTimeout(_processAchQueue, 300);
  }, 400);
}

function renderAchievements(playerId) {
  const container = document.getElementById('achListContainer');
  if (!container) return;

  const p = db.players.find(x => x.id === playerId);
  if (!p) return;

  const key = `badminton_ach_${playerId}`;
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  const achievements = ACHIEVEMENTS_DEF.map(ach => ({
    ...ach,
    unlocked: ach.check(p, db.players, db.matches),
    unlockedAt: seen[ach.id]
  }));

  container.innerHTML = achievements.map(ach => `
    <div class="ach-list-item ${ach.unlocked ? 'unlocked' : ''}">
      <div class="ach-list-icon ${ach.unlocked ? '' : 'locked'}">${ach.icon}</div>
      <div class="ach-list-info">
        <div class="ach-list-name ${ach.unlocked ? '' : 'locked-name'}" style="${ach.unlocked ? `color:${ach.color}` : ''}">${ach.title}</div>
        <div class="ach-list-desc">${ach.desc}</div>
      </div>
      <div>${ach.unlocked
        ? `<div class="ach-list-date">✅ ได้แล้ว</div>`
        : `<div class="ach-list-lock">🔒</div>`
      }</div>
    </div>
  `).join('');
}

// ============================================================
// Patch into existing renderProfile to add achievements + nemesis + winrate chart
// ============================================================
const _origRenderProfile = renderProfile;
renderProfile = async function() {
  await _origRenderProfile();
  if (!currentUser) return;

  // Render achievements (display only, no popup here)
  renderAchievements(currentUser.id);

  // Add nemesis info to profile card
  const nemesis = getNemesis(currentUser.id);
  if (nemesis && document.getElementById('profileCard')) {
    const existingNem = document.getElementById('profileNemesis');
    if (!existingNem) {
      const div = document.createElement('div');
      div.id = 'profileNemesis';
      div.style.marginTop = '12px';
      div.innerHTML = `<div class="pp2-sec" style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin:0 0 7px;display:flex;align-items:center;gap:6px;">⚔️ ศัตรูตัวฉกาจ<div style="flex:1;height:1px;background:var(--glass-border);margin-left:6px;"></div></div>
        <div class="nemesis-card">
          <div style="font-size:1.8rem">⚔️</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:0.92rem;color:var(--red)">${nemesis.name}</div>
            <div style="font-size:0.73rem;color:var(--muted)">แพ้ ${nemesis.losses} ครั้ง · ชนะ ${nemesis.wins} ครั้ง</div>
          </div>
          <span class="nemesis-badge">😈 คู่ปรับ</span>
        </div>`;
      document.getElementById('profileCard').appendChild(div);
    }
  }

  // Add win rate sparkline chart to profile card
  const chartHtml = buildWinRateChart(currentUser.id, 100, 36);
  if (chartHtml) {
    const existing = document.getElementById('profileWRChart');
    if (!existing) {
      const div = document.createElement('div');
      div.id = 'profileWRChart';
      div.style.marginTop = '12px';
      div.innerHTML = `<div class="pp2-sec" style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin:0 0 7px;display:flex;align-items:center;gap:6px;">📊 Win Rate Trend<div style="flex:1;height:1px;background:var(--glass-border);margin-left:6px;"></div></div>${chartHtml}`;
      document.getElementById('profileCard').appendChild(div);
    }
  }
};

// ============================================================
// Patch leaderboard render to show nemesis + streak + win rate sparkline
// ============================================================
const _origRenderLB = renderLeaderboard;
renderLeaderboard = function(data, animate = true) {
  _origRenderLB(data, animate);
  // Season banner
  renderSeasonBanner();
};

// Patch openPlayerProfile to show nemesis + streak + win rate
const _origOpenProfile = openPlayerProfile;
openPlayerProfile = function(playerId) {
  _origOpenProfile(playerId);
  // Add nemesis section after sheet renders
  setTimeout(() => {
    const sheet = document.getElementById('ppSheet2');
    if (!sheet) return;

    const nemesis = getNemesis(playerId);
    const streak = getPlayerStreak(playerId);
    const wrChart = buildWinRateChart(playerId, 120, 40);

    // Add streak indicator to avatar
    const av = sheet.querySelector('.pp2-av');
    if (av && streak >= 5) av.classList.add('streak-fire');

    // Find body div to append nemesis + win rate
    const body = sheet.querySelector('.pp2-body');
    if (!body) return;

    // Win rate trend
    if (wrChart) {
      const wrDiv = document.createElement('div');
      wrDiv.innerHTML = `<div class="pp2-sec">📊 Win Rate Trend</div>${wrChart}`;
      const h2hSec = body.querySelector('.pp2-sec');
      if (h2hSec) body.insertBefore(wrDiv, h2hSec);
    }

    // Nemesis
    if (nemesis) {
      const nemDiv = document.createElement('div');
      nemDiv.innerHTML = `<div class="pp2-sec">⚔️ ศัตรูตัวฉกาจ</div>
        <div class="nemesis-card">
          <div style="font-size:1.6rem">⚔️</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:0.88rem;color:var(--red)">${nemesis.name}</div>
            <div style="font-size:0.72rem;color:var(--muted)">แพ้ ${nemesis.losses} ครั้ง · ชนะ ${nemesis.wins} ครั้ง</div>
          </div>
          <span class="nemesis-badge">😈 คู่ปรับ</span>
        </div>`;
      body.appendChild(nemDiv);
    }

    // Achievements mini in profile sheet
    const p = db.players.find(x => x.id === playerId);
    if (p) {
      const key = `badminton_ach_${playerId}`;
      let seen = {};
      try { seen = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
      const unlockedAchs = ACHIEVEMENTS_DEF.filter(ach => ach.check(p, db.players, db.matches));
      if (unlockedAchs.length > 0) {
        const achDiv = document.createElement('div');
        achDiv.innerHTML = `<div class="pp2-sec">🏅 Achievements</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${unlockedAchs.map(a =>
            `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:50px;background:rgba(255,255,255,0.06);border:1px solid ${a.color}33;font-size:0.75rem;color:${a.color}">${a.icon} ${a.title}</div>`
          ).join('')}</div>`;
        body.appendChild(achDiv);
      }
    }
  }, 100);
};

// Patch leaderboard row to show streak fire on avatars
// Override the lb-br row innerHTML to add streak fire on avatar
const _origRenderLBRows = typeof renderLBRows !== 'undefined' ? renderLBRows : null;

// Post-process leaderboard: add streak fire to avatars
function patchLBStreaks() {
  if (!db.players || !db.matches) return;
  db.players.forEach(p => {
    if (hasStreakFire(p.id)) {
      // Find avatar in leaderboard
      const rows = document.querySelectorAll('.lb-br');
      rows.forEach(row => {
        const nameEl = row.querySelector('.lb-rn');
        if (nameEl && nameEl.textContent.includes(p.name)) {
          const av = row.querySelector('.lb-rav');
          if (av) av.classList.add('streak-fire');
        }
      });
      // Podium
      const podCells = document.querySelectorAll('.lb-pc');
      podCells.forEach(pc => {
        const nameEl = pc.querySelector('.lb-pod-name');
        if (nameEl && nameEl.textContent.trim() === p.name) {
          const av = pc.querySelector('.lb-pod-av');
          if (av) av.classList.add('streak-fire');
        }
      });
    }
  });
}

// Patch renderLeaderboard to call patchLBStreaks after render
const _rlb2 = renderLeaderboard;
renderLeaderboard = function(data, animate = true) {
  _rlb2(data, animate);
  renderSeasonBanner();
  setTimeout(patchLBStreaks, 500);
};

// After login / loadAll, check for nemesis badges in LB
const _origShowSection = showSection;
showSection = function(s) {
  _origShowSection(s);
  if (s === 'leaderboard') setTimeout(patchLBStreaks, 600);
};

