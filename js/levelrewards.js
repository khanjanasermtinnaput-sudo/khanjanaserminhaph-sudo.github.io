/* ═══════════════════════════════════════════════════════════════
   LEVEL REWARDS PAGE — full Lv5–100 ladder as an animated timeline.
   Reuses LEVEL_REWARDS / dbClaimLevelReward / claimLevelRewardUI from
   js/levels.js (must load before this file). Zero DB writes of its own —
   claiming goes through the same server-authoritative RPC as the Profile
   card's inline claim buttons.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function injectStyles() {
    if (document.getElementById('lr-styles')) return;
    const s = document.createElement('style');
    s.id = 'lr-styles';
    s.textContent = `
      .lr-hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
      .lr-ring{--p:0;width:96px;height:96px;border-radius:50%;flex-shrink:0;
        background:conic-gradient(var(--gold,#ffd700) calc(var(--p)*1%),rgba(255,255,255,.08) 0);
        display:grid;place-items:center;position:relative;transition:--p .8s ease}
      .lr-ring::after{content:'';position:absolute;inset:8px;border-radius:50%;background:var(--card-bg,var(--bg2))}
      .lr-ring-num{position:relative;z-index:1;font-family:'Fredoka One',cursive;font-size:1.3rem;line-height:1}
      .lr-ring-sub{position:relative;z-index:1;font-size:.58rem;color:var(--muted);letter-spacing:1px}
      .lr-hero-meta{flex:1;min-width:150px}
      .lr-hero-meta h3{font-family:'Fredoka One',cursive;letter-spacing:1px;margin:0 0 4px;font-size:1.1rem}
      .lr-timeline{position:relative;margin-top:18px;padding-left:34px}
      .lr-timeline::before{content:'';position:absolute;left:13px;top:6px;bottom:6px;width:2px;background:linear-gradient(var(--glass-border),var(--glass-border))}
      .lr-node{position:relative;margin-bottom:16px;animation:lrNodeIn .4s ease both}
      .lr-node:nth-child(n){animation-delay:calc(var(--i,0) * 0.04s)}
      .lr-node-dot{position:absolute;left:-34px;top:2px;width:28px;height:28px;border-radius:50%;
        display:grid;place-items:center;font-size:.85rem;border:2px solid var(--glass-border);
        background:var(--card);z-index:1;transition:all .3s ease}
      .lr-node.claimed .lr-node-dot{background:var(--gold);border-color:var(--gold);box-shadow:0 0 12px rgba(255,215,0,.5)}
      .lr-node.unlocked .lr-node-dot{background:var(--neon);border-color:var(--neon);box-shadow:0 0 12px rgba(0,245,160,.5)}
      .lr-node.locked .lr-node-dot{opacity:.5}
      .lr-node-body{border-radius:14px;padding:12px 14px;border:1px solid var(--glass-border);background:rgba(255,255,255,.02)}
      .lr-node.unlocked .lr-node-body{border-color:rgba(0,245,160,.4);background:rgba(0,245,160,.05)}
      .lr-node.claimed .lr-node-body{border-color:rgba(255,215,0,.35);background:rgba(255,215,0,.04)}
      .lr-node.locked .lr-node-body{opacity:.55;filter:grayscale(.4)}
      .lr-node-title{font-weight:700;font-size:.88rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .lr-node-status{font-size:.68rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:10px}
      .lr-node.locked .lr-node-status{background:rgba(255,255,255,.08);color:var(--muted)}
      .lr-node.unlocked .lr-node-status{background:rgba(0,245,160,.15);color:var(--neon)}
      .lr-node.claimed .lr-node-status{background:rgba(255,215,0,.15);color:var(--gold)}
      .lr-node-desc{font-size:.76rem;color:var(--muted);margin-top:4px}
      @keyframes lrNodeIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
    `;
    document.head.appendChild(s);
  }

  function renderTab() {
    injectStyles();
    const sec = document.getElementById('levelrewardsSection');
    if (!sec || typeof LEVEL_REWARDS === 'undefined') return;
    if (typeof currentUser === 'undefined' || !currentUser) {
      sec.innerHTML = `<main><div class="card"><div class="text-muted" style="text-align:center;padding:24px">${typeof t === 'function' ? t('login_tab') : 'Please log in'}</div></div></main>`;
      return;
    }
    const p = db.players.find(x => x.id === currentUser.id);
    if (!p) return;
    const claimed = p.rewardClaimed || [];
    const claimedCount = LEVEL_REWARDS.filter(r => claimed.includes(r.id)).length;
    const pct = Math.round((claimedCount / LEVEL_REWARDS.length) * 100);
    const nextReward = LEVEL_REWARDS.find(r => !claimed.includes(r.id));

    let html = `<main>
      <div class="lb-hero"><div class="lb-hero-title"><small>Badminton Club</small>🏆 ${t('reward_ladder')}</div></div>
      <div class="card">
        <div class="lr-hero">
          <div class="lr-ring" style="--p:${pct}">
            <span class="lr-ring-num">${pct}%</span>
            <span class="lr-ring-sub">${claimedCount}/${LEVEL_REWARDS.length}</span>
          </div>
          <div class="lr-hero-meta">
            <h3>Lv.${p.level} ${p.prestige > 0 ? `· 👑 Prestige ${p.prestige}` : ''}</h3>
            <div style="font-size:.75rem;color:var(--muted);margin-bottom:2px">${t('next_reward')}</div>
            <div style="font-size:.85rem;font-weight:700;color:var(--neon)">${nextReward ? `Lv.${nextReward.level} — ${esc(_lang === 'en' ? nextReward.label_en : nextReward.label_th)}` : '🎉 ' + t('claimed')}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="lr-timeline">
          ${LEVEL_REWARDS.map((r, i) => {
            const isClaimed = claimed.includes(r.id);
            const isUnlocked = !isClaimed && p.level >= r.level;
            const state = isClaimed ? 'claimed' : isUnlocked ? 'unlocked' : 'locked';
            const icon = isClaimed ? '✓' : isUnlocked ? '🎁' : '🔒';
            const statusLabel = isClaimed ? t('claimed') : isUnlocked ? t('unlocked') : t('locked');
            return `<div class="lr-node ${state}" style="--i:${i}">
              <div class="lr-node-dot">${icon}</div>
              <div class="lr-node-body">
                <div class="lr-node-title">
                  <span>Lv.${r.level}</span>
                  <span>${esc(_lang === 'en' ? r.label_en : r.label_th)}</span>
                  <span class="lr-node-status">${statusLabel}</span>
                </div>
                <div class="lr-node-desc">${r.type === 'title' ? (_lang === 'en' ? 'Title reward' : 'รางวัลฉายา') : (_lang === 'en' ? 'Cosmetic reward' : 'รางวัลของแต่งตัว')}</div>
                ${isUnlocked ? `<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="claimLevelRewardUI('${r.id}').then(()=>{ if(typeof levelRewardsRefresh==='function') levelRewardsRefresh(); })">🎁 ${t('claim')}</button>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </main>`;

    sec.innerHTML = html;
    requestAnimationFrame(() => {
      const ring = sec.querySelector('.lr-ring');
      if (ring) { ring.style.setProperty('--p', '0'); requestAnimationFrame(() => ring.style.setProperty('--p', pct)); }
    });
  }
  window.levelRewardsRenderTab = renderTab;

  // Refresh an already-open Level Rewards tab after a claim (mirrors
  // collectionRefresh/economyRefresh — no-op if the tab isn't visible).
  window.levelRewardsRefresh = function () {
    const sec = document.getElementById('levelrewardsSection');
    if (sec && sec.classList.contains('active')) renderTab();
  };

  function patchRouter() {
    if (window.__lrRouted) return;
    if (typeof showSection !== 'function') return;
    window.__lrRouted = true;
    const orig = showSection;
    showSection = function (name) {
      orig(name);
      if (name === 'levelrewards') renderTab();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchRouter);
  else patchRouter();
})();
