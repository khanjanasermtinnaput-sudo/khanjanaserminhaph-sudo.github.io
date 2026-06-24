// ── 1. Daily Challenge ───────────────────────────
const DC_QUESTS = [
  { id:'q0', text:'🏸 เล่น 1 แมตช์วันนี้',         coins:4, type:'plays',      goal:1 },
  { id:'q1', text:'🏆 ชนะ 1 แมตช์วันนี้',           coins:4, type:'wins',       goal:1 },
  { id:'q2', text:'⭐ บันทึกคะแนนครั้งแรกของวัน', coins:4, type:'first_save', goal:1 },
];

function _dcKey(pid) { return 'bmt_dc_'+(pid||currentUser?.id||0)+'_'+new Date().toISOString().slice(0,10); }
function getDCDone(pid) { try{return JSON.parse(localStorage.getItem(_dcKey(pid))||'{}');}catch(e){return{};} }
function _dcTodayCountKey(pid) { return 'bmt_dct_'+(pid||currentUser?.id||0)+'_'+new Date().toISOString().slice(0,10); }
function getDCToday(pid) { try{return JSON.parse(localStorage.getItem(_dcTodayCountKey(pid))||'{"plays":0,"wins":0,"first_save":0}');}catch(e){return{plays:0,wins:0,first_save:0};} }
function saveDCToday(d, pid) { localStorage.setItem(_dcTodayCountKey(pid), JSON.stringify(d)); }

function getDCProg(q, pid) {
  const tc = getDCToday(pid);
  if (q.type==='plays') return tc.plays||0;
  if (q.type==='wins') return tc.wins||0;
  if (q.type==='first_save') return tc.first_save||0;
  return 0;
}

function renderDailyChallenge() {
  const card=document.getElementById('dailyChallengeCard');
  const wrap=document.getElementById('dcContent');
  if(!card||!wrap||!currentUser){if(card)card.style.display='none';return;}
  const done=getDCDone();
  const allDone=DC_QUESTS.every(q=>done[q.id]);
  card.style.display='';
  card.className=card.className.replace(' done','')+(allDone?' done':'');
  wrap.innerHTML=DC_QUESTS.map(q=>{
    const prog=done[q.id]?q.goal:getDCProg(q);
    const isDone=done[q.id]||prog>=q.goal;
    const pct=Math.min(100,Math.round(prog/q.goal*100));
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <span style="font-size:.83rem;font-weight:600">${q.text}</span>
        <span style="font-size:.72rem;font-weight:700;color:${isDone?'var(--neon)':'var(--neon2)'};white-space:nowrap;margin-left:6px">${isDone?'✅ รับแล้ว':'🪙 +'+q.coins+' เหรียญ'}</span>
      </div>
      <div class="dc-bar-bg"><div class="dc-bar" style="width:${pct}%;${isDone?'background:var(--neon)':''}"></div></div>
    </div>`;
  }).join('');
}

// ให้รางวัล Daily Quest กับผู้เล่นคนหนึ่ง (ตาม progress ที่บันทึกไว้ของคนนั้น)
// notify=true เฉพาะตอนเป็น currentUser เพื่อไม่ให้ toast เด้งรัวจากผู้เล่นคนอื่น
async function checkDCRewardsFor(pid, notify) {
  const pl = db.players.find(p=>p.id===pid);
  if (!pl) return;
  const done = getDCDone(pid);
  let granted = false;
  for (const q of DC_QUESTS) {
    if (done[q.id]) continue;
    if (getDCProg(q, pid) >= q.goal) {
      done[q.id] = true;
      granted = true;
      await dbAddCoins(pid, q.coins);
      // localStorage shadow copy — getEffectiveCoins falls back to it when the DB coins column is missing
      _setLsCoins(pid, _lsCoins(pid) + q.coins);
      if (notify) {
        toast('🎯 Daily Quest สำเร็จ! +'+q.coins+' 🪙', 'success');
        const pcEl = document.getElementById('profileCoinBalance');
        if (pcEl) pcEl.textContent = getEffectiveCoins(pid);
      }
    }
  }
  if (granted) {
    localStorage.setItem(_dcKey(pid), JSON.stringify(done));
    if (notify) renderDailyChallenge();
  }
}

// ── 13. Player of the Day ────────────────────────
function renderPotd() {
  const card=document.getElementById('potdCard');
  const wrap=document.getElementById('potdContent');
  if(!card||!wrap) return;
  const today=new Date().toISOString().slice(0,10);
  const td=db.matches.filter(m=>new Date(m.date).toISOString().slice(0,10)===today);
  if(!td.length){card.style.display='none';return;}
  const gains={};
  td.forEach(m=>(m.winTeam==='A'?m.teamA:m.teamB).forEach(p=>{gains[p.id]=(gains[p.id]||0)+(m.pts?.gain||0);}));
  if(!Object.keys(gains).length){card.style.display='none';return;}
  const maxGain=Math.max(...Object.values(gains));
  const topIds=Object.keys(gains).filter(id=>gains[id]===maxGain).map(Number);
  const topPlayers=topIds.map(id=>db.players.find(p=>p.id===id)).filter(Boolean);
  if(!topPlayers.length){card.style.display='none';return;}
  card.style.display='';
  const isTie=topPlayers.length>1;
  const titleEl=document.getElementById('potdCard').querySelector('.card-title');
  if(titleEl) titleEl.textContent=isTie?`🏅 ${t('potd_title')} (${topPlayers.length}${t('people_unit') ? ' '+t('people_unit') : ''})`:'🏅 Player of the Day';
  wrap.innerHTML=topPlayers.map(pl=>{
    const cols=getAvatarColor(pl.id);
    const av=getAvatar(pl.id,pl.name);
    const wins=td.filter(m=>(m.winTeam==='A'?m.teamA:m.teamB).some(p=>p.id===pl.id)).length;
    return `<div style="display:flex;align-items:center;gap:12px${isTie?';padding:8px 0;border-bottom:1px solid var(--glass-border)':''}">
      <div class="${getGachaFrameClass(pl)}" style="width:46px;height:46px;border-radius:50%;background:${av.bg};color:${av.fg};display:flex;align-items:center;justify-content:center;font-size:${av.fs||'1.1rem'};font-weight:700;border:2px solid rgba(255,215,0,.4);flex-shrink:0;position:relative;isolation:isolate">${getGachaFrameInner(pl)}${av.content}</div>
      <div style="flex:1"><div style="font-weight:700" class="${getGachaNameClass(pl)}">${esc(pl.name)}</div><div style="font-size:.73rem;color:var(--muted)">${t('wins_bar')} ${wins} ${t('matches_unit')} · +${gains[pl.id]||0} ELO ${t('today_label')}</div></div>
      <div style="font-family:'Rajdhani';font-size:1.6rem;font-weight:700;color:var(--gold)">+${gains[pl.id]||0}</div>
    </div>`;
  }).join('');
}

// ── 10. Today's History ──────────────────────────
function renderTodayHist() {
  const card=document.getElementById('todayHistCard');
  const wrap=document.getElementById('todayHistContent');
  if(!card||!wrap) return;
  const today=new Date().toISOString().slice(0,10);
  const ms=db.matches.filter(m=>new Date(m.date).toISOString().slice(0,10)===today);
  if(!ms.length){card.style.display='none';return;}
  card.style.display='';
  wrap.innerHTML=ms.slice(0,6).map(m=>{
    const w=m.winTeam==='A'?formatTeamNames(m.teamA):formatTeamNames(m.teamB);
    const timeStr=new Date(m.date).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--glass-border);font-size:.78rem">
      <span style="color:var(--muted);font-size:.65rem;flex-shrink:0">${timeStr}</span>
      <span style="flex:1"><b>${w}</b> ชนะ ${m.scoreA}-${m.scoreB}${m.mood ? ' ' + m.mood : ''}</span>
      <span>${m.type==='doubles'?'👥':'👤'}</span></div>`;
  }).join('')+(ms.length>6?`<div style="font-size:.7rem;color:var(--muted);text-align:center;margin-top:5px">+${ms.length-6} แมตช์</div>`:'');
}

// Hook into lbRenderBoard to trigger new leaderboard features
const _lbRenderBoardBase = lbRenderBoard;
lbRenderBoard = function(data, animate) {
  _lbRenderBoardBase(data, animate);
  renderDailyChallenge();
  renderPotd();
  renderTodayHist();
  renderLiveTbl();
};

// ── 5. Rematch Button ────────────────────────────
let _lastMatchData = null;

function doRematch() {
  if (!_lastMatchData) return;
  closeModal('finishModal');
  currentMatch = { type:_lastMatchData.type, teamA:_lastMatchData.teamA, teamB:_lastMatchData.teamB, scoreA:0, scoreB:0 };
  const htmlA = formatTeamNames(currentMatch.teamA), htmlB = formatTeamNames(currentMatch.teamB);
  document.getElementById('teamAName').innerHTML = htmlA;
  document.getElementById('teamBName').innerHTML = htmlB;
  ['scoreA','scoreB'].forEach(k=>{ document.getElementById(k).textContent='0'; });
  document.getElementById('refHalfNameA').innerHTML = htmlA;
  document.getElementById('refHalfNameB').innerHTML = htmlB;
  document.getElementById('refHalfScoreA').textContent='0';
  document.getElementById('refHalfScoreB').textContent='0';
  document.getElementById('matchPlaying').classList.remove('hidden');
  document.getElementById('modePicker').classList.remove('hidden');
  document.getElementById('classicMode').classList.add('hidden');
  showSection('match');
  toast('🔁 Rematch! เตรียมพร้อม', 'success');
}

const _saveMatchBase = saveMatch;
saveMatch = async function() {
  // Snapshot before save clears currentMatch
  let matchSnap = null;
  if (currentMatch) {
    _lastMatchData = { type:currentMatch.type, teamA:currentMatch.teamA.slice(), teamB:currentMatch.teamB.slice() };
    const wt = currentMatch._winTeam || (currentMatch.scoreA > currentMatch.scoreB ? 'A' : 'B');
    matchSnap = { winTeam: wt, teamA: currentMatch.teamA.slice(), teamB: currentMatch.teamB.slice() };
  }
  await _saveMatchBase();
  stopMatchTimer();
  const btn = document.getElementById('rematchBtn');
  if (btn) btn.style.display = '';
  // Update daily challenge counters — ให้กับ "ทุกคนที่อยู่ในแมตช์" (ติกในหน้าแมตช์)
  // ไม่ใช่แค่คนที่กดบันทึก — เหรียญเข้าผู้เล่นจริงในแมตช์เท่านั้น
  if (matchSnap) {
    const winners = matchSnap['team'+matchSnap.winTeam].map(p=>p.id);
    const allInMatch = [...matchSnap.teamA, ...matchSnap.teamB].map(p=>p.id);
    const seen = new Set();
    for (const pid of allInMatch) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const today = getDCToday(pid);
      today.plays = (today.plays||0) + 1;
      if (winners.includes(pid)) today.wins = (today.wins||0) + 1;
      if (!today.first_save) today.first_save = 1;
      saveDCToday(today, pid);
      // toast เฉพาะ currentUser เพื่อไม่ให้เด้งรัว
      await checkDCRewardsFor(pid, currentUser && pid === currentUser.id);
    }
  }
};

// ── 12. Match Mood/Reaction ──────────────────────
let _selectedMood = null;

function selectMood(emoji, el) {
  _selectedMood = emoji;
  document.querySelectorAll('.mood-btn').forEach(b=>b.classList.remove('sel'));
  el.classList.add('sel');
}

const _confirmFinishBase = confirmFinish;
confirmFinish = function() {
  _confirmFinishBase();
  _selectedMood = null;
  setTimeout(() => {
    const c = document.getElementById('finishModalContent');
    if (c && !c.querySelector('.mood-picker')) {
      c.insertAdjacentHTML('beforeend', `<div style="font-size:.78rem;color:var(--muted);margin:10px 0 5px;font-weight:600">😄 บรรยากาศแมตช์นี้</div>
        <div class="mood-picker">${['😄','🔥','💪','😤','😅','🥳','😢','🤩'].map(e=>`<button class="mood-btn" onclick="selectMood('${e}',this)">${e}</button>`).join('')}</div>`);
    }
  }, 80);
};

// ── 3. Monthly Stats Chart ───────────────────────
function renderMonthlyStats(pid) {
  const el = document.getElementById('monthlyStatsContent');
  if (!el) return;
  const now = new Date();
  const months = Array.from({length:6},(_,i)=>{
    const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);
    return {y:d.getFullYear(),m:d.getMonth(),lbl:d.toLocaleString('th-TH',{month:'short'})};
  });
  const stats = months.map(({y,m,lbl})=>{
    const ms=db.matches.filter(mx=>{const d=new Date(mx.date);return d.getFullYear()===y&&d.getMonth()===m&&[...mx.teamA,...mx.teamB].some(p=>p.id===pid);});
    const w=ms.filter(mx=>{const ia=mx.teamA.some(p=>p.id===pid);return(ia&&mx.winTeam==='A')||(!ia&&mx.winTeam==='B');}).length;
    return {lbl,w,l:ms.length-w};
  });
  const mx=Math.max(1,...stats.map(s=>s.w+s.l));
  el.innerHTML=`<div class="mbar-chart">${stats.map(s=>`<div class="mbar-grp">
    <div class="mbar-inner"><div style="width:11px;background:var(--neon);border-radius:2px 2px 0 0;min-height:${s.w?'2px':'0'};height:${s.w?Math.max(3,Math.round(s.w/mx*52)):0}px"></div>
    <div style="width:11px;background:var(--red);border-radius:2px 2px 0 0;min-height:${s.l?'2px':'0'};height:${s.l?Math.max(3,Math.round(s.l/mx*52)):0}px"></div></div>
    <div style="font-size:.6rem;color:var(--muted)">${s.lbl}</div></div>`).join('')}</div>
  <div style="display:flex;gap:12px;margin-top:7px;font-size:.7rem">
    <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;background:var(--neon);border-radius:2px;display:inline-block"></span>${t('wins_bar')}</span>
    <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;background:var(--red);border-radius:2px;display:inline-block"></span>${t('losses_bar')}</span>
  </div>`;
}

// ── 4. Personal Records ──────────────────────────
function renderPersonalRecords(pid) {
  const el = document.getElementById('personalRecordsContent');
  if (!el) return;
  const myMs=db.matches.filter(m=>[...m.teamA,...m.teamB].some(p=>p.id===pid));
  let mx=0,cur=0;
  [...myMs].reverse().forEach(m=>{const ia=m.teamA.some(p=>p.id===pid);const w=(ia&&m.winTeam==='A')||(!ia&&m.winTeam==='B');if(w){cur++;mx=Math.max(mx,cur);}else cur=0;});
  const myW=myMs.filter(m=>{const ia=m.teamA.some(p=>p.id===pid);return(ia&&m.winTeam==='A')||(!ia&&m.winTeam==='B');});
  const bM=myW.reduce((b,m)=>Math.max(b,Math.abs(m.scoreA-m.scoreB)),0);
  const bG=myW.reduce((b,m)=>Math.max(b,m.pts?.gain||0),0);
  const byD={};myW.forEach(m=>{const d=new Date(m.date).toISOString().slice(0,10);byD[d]=(byD[d]||0)+1;});
  const bD=Object.values(byD).length?Math.max(...Object.values(byD)):0;
  el.innerHTML=`<div class="records-row">${[['🔥 '+t('streak_label'),mx],['⚡ '+t('biggest_win'),bM],['📈 '+t('peak_elo_m'),'+'+bG],['🏆 '+t('wins_day'),bD]].map(([lbl,val])=>`
    <div class="rec-item"><div class="rec-val">${val}</div><div class="rec-lbl">${lbl}</div></div>`).join('')}</div>`;
}

// ── 6. Achievement Hints ─────────────────────────
const _renderAchBase = renderAchievements;
renderAchievements = function(pid) {
  _renderAchBase(pid);
  setTimeout(() => {
    const ct=document.getElementById('achListContainer');
    if(!ct) return;
    const pl=db.players.find(p=>p.id===pid);
    if(!pl) return;
    ct.querySelectorAll('.ach-list-item:not(.unlocked)').forEach((item,i) => {
      if(item.querySelector('.ach-hint')) return;
      const ach=ACHIEVEMENTS_DEF[i];
      if(!ach) return;
      let hint='';
      if(ach.id==='hardworker'){
        const now=new Date(),ws=new Date(now);ws.setDate(now.getDate()-now.getDay());
        const wm=db.matches.filter(m=>new Date(m.date)>=ws&&[...m.teamA,...m.teamB].some(p=>p.id===pid));
        hint=`เล่นแล้ว ${wm.length}/5 แมตช์สัปดาห์นี้`;
      } else if(ach.id==='prime_of_month'){
        hint='เล่น >5 แมตช์เดือนนี้ + WR สูงสุดใน Master+';
      } else if(ach.id==='master'||ach.id==='master_player'){
        hint=`${pl.pts} pts → ต้องการ 1,501`;
      } else if(ach.id==='conqueror'||ach.id==='king'){
        hint=`${pl.pts} pts → ต้องการ 2,000 + อันดับ 1`;
      }
      if(hint){
        const h=document.createElement('div');h.className='ach-hint';h.textContent='💡 '+hint;
        const info=item.querySelector('.ach-list-info');if(info) info.appendChild(h);
      }
    });
  }, 120);
};

