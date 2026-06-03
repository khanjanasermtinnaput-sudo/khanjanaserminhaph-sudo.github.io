// ── 14. Avatar Builder ───────────────────────────
const AV_EM=['😎','🏸','🔥','💪','⚡','👑','🎯','🌟','🦁','🐯','🦊','🐼','🏆','💠','💎','🎮','🚀','🌈','⚔️','🛡️'];
const AV_CO=['#00f5a0','#00d9f5','#ffd700','#ff6b35','#b044f0','#48d1cc','#ff4757','#7bed9f','#ff9f43','#5352ed'];
let _avE=null,_avC=null;

function getCustomAvatar(pid){try{return JSON.parse(localStorage.getItem('bmt_av_'+pid)||'{}');}catch(e){return{};}}

// ── helper: rebuild animated avatar preview inside Avatar Builder ──
function _avbUpdatePreview() {
  const plMe = db.players.find(x=>x.id===currentUser.id) || {};
  const lsGacha = JSON.parse(localStorage.getItem('bmt_gacha_'+currentUser.id)||'{}');
  const myFrame = plMe.gachaFrame || lsGacha.gacha_frame || null;
  const myNameFx = plMe.gachaName || lsGacha.gacha_name || null;
  const baseCols = getAvatarColor(currentUser.id);
  const bg = _avC || baseCols[1];
  const content = _avE || getInitial(currentUser.name);
  const fs = _avE ? '1.8rem' : '1.2rem';
  // frame class + inner particles (solar → solaremperor backward compat)
  const _myFrameResolved = _resolveFrameKey(myFrame);
  const frameClass = (_myFrameResolved && (_myFrameResolved in GACHA_FRAME_INNER)) ? 'gf-'+_myFrameResolved : '';
  const frameInner = (_myFrameResolved && (_myFrameResolved in GACHA_FRAME_INNER)) ? GACHA_FRAME_INNER[_myFrameResolved] : '';
  // name class
  const _myNameResolved = _resolveNameKey(myNameFx);
  const nameClass = (_myNameResolved && ['void','halo','blaze','ice','thundergod','solaremperor'].includes(_myNameResolved)) ? 'gn-'+_myNameResolved : '';
  const wrap = document.getElementById('avPreviewWrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div id="avPreview" class="${frameClass}" style="width:76px;height:76px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:${fs};font-weight:700;color:#fff;position:relative;isolation:isolate;flex-shrink:0">${frameInner}${content}</div>
    ${nameClass ? `<span class="${nameClass}" style="font-family:'Rajdhani','Sarabun',sans-serif;font-size:1rem;font-weight:700;margin-top:6px;letter-spacing:1px">${currentUser.name}</span>` : `<span style="font-size:.85rem;color:var(--muted);margin-top:6px">${currentUser.name}</span>`}`;
}

function openAvatarBuilder(){
  const modal=document.getElementById('avatarBuilderModal');
  if(!modal||!currentUser) return;
  const sv=getCustomAvatar(currentUser.id);
  _avE=sv.emoji||null; _avC=sv.color||null;
  const baseCols=getAvatarColor(currentUser.id);
  // ดึงข้อมูล gacha ทั้งหมด
  const plMe = db.players.find(x=>x.id===currentUser.id) || {};
  const lsGacha = JSON.parse(localStorage.getItem('bmt_gacha_'+currentUser.id)||'{}');
  const myFrame  = plMe.gachaFrame || lsGacha.gacha_frame || null;
  const myNameFx = plMe.gachaName  || lsGacha.gacha_name  || null;
  const myGachaEmoji = plMe.gachaEmoji || lsGacha.gacha_emoji || null;
  // ดึง inventory ทั้งหมด (สะสม)
  const inv = getGachaInventory(currentUser.id);
  const allFrames = [...new Set([...(inv.frames||[]), ...(myFrame?[myFrame]:[])])];
  const allNames  = [...new Set([...(inv.names||[]),  ...(myNameFx?[myNameFx]:[])])];
  const allInvEmojis = [...new Set([...(inv.emojis||[]), ...(myGachaEmoji?[myGachaEmoji]:[])])];
  const frameLabels = {void:'🌑 Dark',halo:'✨ Light',blaze:'🔥 Blaze',ice:'❄️ Ice',rainbow:'🌈 Rainbow',robot:'⚙️ Robot'};
  // Section กรอบ — แสดงทุก item ที่สะสมไว้
  const frameSection = allFrames.length ? `
    <div style="font-size:.75rem;color:#c084fc;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:5px">🖼️ กรอบสะสม <span style="font-size:.65rem;color:var(--muted)">(${allFrames.length})</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${allFrames.map(f=>{
        const active=myFrame===f;
        return `<div onclick="equipGachaFrame('${f}')" style="padding:5px 11px;border-radius:20px;cursor:pointer;font-size:0.72rem;font-family:inherit;border:1px solid ${active?'rgba(168,85,247,0.8)':'rgba(168,85,247,0.3)'};background:${active?'rgba(168,85,247,0.2)':'rgba(168,85,247,0.07)'};color:${active?'#c084fc':'var(--muted)'};transition:all .2s">${frameLabels[f]||f}${active?' ✓':''}</div>`;
      }).join('')}
      ${myFrame?`<div onclick="removeGachaFrame()" style="padding:5px 10px;border-radius:20px;cursor:pointer;font-size:0.7rem;font-family:inherit;border:1px solid rgba(255,71,87,0.3);background:rgba(255,71,87,0.07);color:var(--muted);transition:all .2s">✕ ถอด</div>`:''}
    </div>` : '';
  // Section name effect
  const nameSection = allNames.length ? `
    <div style="font-size:.75rem;color:#c084fc;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:5px">✨ Name Effect สะสม <span style="font-size:.65rem;color:var(--muted)">(${allNames.length})</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${allNames.map(n=>{
        const active=myNameFx===n;
        return `<div onclick="equipGachaName('${n}')" style="padding:5px 11px;border-radius:20px;cursor:pointer;font-size:0.72rem;font-family:inherit;border:1px solid ${active?'rgba(168,85,247,0.8)':'rgba(168,85,247,0.3)'};background:${active?'rgba(168,85,247,0.2)':'rgba(168,85,247,0.07)'};color:${active?'#c084fc':'var(--muted)'};transition:all .2s">${frameLabels[n]||n} Name${active?' ✓':''}</div>`;
      }).join('')}
      ${myNameFx?`<div onclick="removeGachaName()" style="padding:5px 10px;border-radius:20px;cursor:pointer;font-size:0.7rem;font-family:inherit;border:1px solid rgba(255,71,87,0.3);background:rgba(255,71,87,0.07);color:var(--muted);transition:all .2s">✕ ถอด</div>`:''}
    </div>` : '';
  // รวม emoji — gacha emojis ขึ้นก่อน
  const baseOnlyEmojis = AV_EM.filter(e=>!allInvEmojis.includes(e));
  const allEmojis = [...allInvEmojis, ...baseOnlyEmojis];
  document.getElementById('avBuilderContent').innerHTML=`
    <div id="avPreviewWrap" style="display:flex;flex-direction:column;align-items:center;margin:0 0 16px;gap:0"></div>
    ${frameSection}${nameSection}
    <div style="font-size:.75rem;color:var(--muted);margin-bottom:6px">${allInvEmojis.length?`😎 Emoji สะสม (${allInvEmojis.length}) + ค่าเริ่มต้น`:'เลือก Emoji'}</div>
    <div class="av-builder-grid">${allEmojis.map(e=>`<div class="av-opt${_avE===e?' sel':''}${allInvEmojis.includes(e)?' style="border-color:rgba(168,85,247,0.5)"':''}" onclick="pickAvE('${e}',this)">${e}</div>`).join('')}</div>
    <div style="font-size:.75rem;color:var(--muted);margin-bottom:6px">สีพื้นหลัง</div>
    <div class="av-color-row">${AV_CO.map(c=>`<div class="av-swatch${_avC===c?' sel':''}" style="background:${c}" onclick="pickAvC('${c}',this)"></div>`).join('')}</div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="closeModal('avatarBuilderModal')">ยกเลิก</button>
      <button class="btn btn-primary btn-sm" onclick="saveAvatar()">💾 บันทึก</button>
    </div>`;
  _avbUpdatePreview();
  modal.classList.remove('hidden');
}

async function removeGachaFrame() {
  if (!currentUser) return;
  try { await dbUpdatePlayer(currentUser.id, { gacha_frame: null }); await loadPlayers(); } catch(e) {}
  const lsKey = 'bmt_gacha_' + currentUser.id;
  const d = JSON.parse(localStorage.getItem(lsKey)||'{}'); delete d.gacha_frame;
  localStorage.setItem(lsKey, JSON.stringify(d));
  toast('ถอดกรอบแล้ว', 'info'); openAvatarBuilder();
}
async function removeGachaName() {
  if (!currentUser) return;
  try { await dbUpdatePlayer(currentUser.id, { gacha_name: null }); await loadPlayers(); } catch(e) {}
  const lsKey = 'bmt_gacha_' + currentUser.id;
  const d = JSON.parse(localStorage.getItem(lsKey)||'{}'); delete d.gacha_name;
  localStorage.setItem(lsKey, JSON.stringify(d));
  toast('ถอดเอฟเฟกต์ชื่อแล้ว', 'info'); openAvatarBuilder();
}

function pickAvE(e,el){
  _avE=e;
  document.querySelectorAll('.av-opt').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');
  _avbUpdatePreview();
}
function pickAvC(c,el){
  _avC=c;
  document.querySelectorAll('.av-swatch').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');
  _avbUpdatePreview();
}
function saveAvatar(){
  if(!currentUser) return;
  const sv=getCustomAvatar(currentUser.id);
  if(_avE) sv.emoji=_avE; if(_avC) sv.color=_avC;
  localStorage.setItem('bmt_av_'+currentUser.id,JSON.stringify(sv));
  closeModal('avatarBuilderModal'); toast('🎨 Avatar บันทึกแล้ว!','success');
  _avE=null; _avC=null; renderProfile();
}

// ── Profile extras hook ──────────────────────────
const _renderProfileBase = renderProfile;
renderProfile = async function() {
  await _renderProfileBase();
  if (!currentUser) return;
  renderPersonalRecords(currentUser.id);
  renderMonthlyStats(currentUser.id);
  const pc=document.getElementById('profileCard');
  if(!pc) return;
  // ── King of Badminton special FX ──
  const p = db.players.find(x=>x.id===currentUser.id) || currentUser;
  const rank = getRank(p.pts, p.id);
  const isKing = rank.id === 'king';
  pc.classList.toggle('king-profile', isKing);
  if (isKing && !pc.querySelector('.king-banner')) {
    pc.insertAdjacentHTML('afterbegin',
      '<div class="king-banner">👑 KING OF BADMINTON 👑</div>' +
      '<span class="king-spark">✨</span>' +
      '<span class="king-spark">⭐</span>' +
      '<span class="king-spark">✨</span>' +
      '<span class="king-spark">⭐</span>' +
      '<span class="king-spark">✨</span>'
    );
  }
  // Avatar builder button
  if(!document.getElementById('avatarBuilderBtn')){
    const btn=document.createElement('button');
    btn.id='avatarBuilderBtn'; btn.className='btn btn-ghost btn-sm';
    btn.style.cssText='width:auto;margin-top:10px';
    btn.textContent='🎨 เปลี่ยน Avatar'; btn.onclick=openAvatarBuilder;
    pc.appendChild(btn);
  }
  // Update coin balance in profile gacha card
  const coinEl = document.getElementById('profileCoinBalance');
  if (coinEl) {
    const me = db.players.find(x => x.id === currentUser.id);
    coinEl.textContent = me ? (me.coins || 0) : 0;
  }
  // Hide gacha card if not logged in
  const gcCard = document.getElementById('gachaProfileCard');
  if (gcCard) gcCard.style.display = currentUser ? '' : 'none';
  // Load mailbox in profile
  await renderProfileMailbox();
  // Load gacha inventory
  if (typeof renderGachaInventory === 'function') renderGachaInventory();
};

async function renderProfileMailbox() {
  const card = document.getElementById('profileMailboxCard');
  const list = document.getElementById('profileMailboxList');
  if (!card || !list || !currentUser) return;
  try {
    const items = await dbGetMailbox(currentUser.id);
    if (!items || items.length === 0) { card.style.display = 'none'; return; }
    card.style.display = '';
    const typeLabel = { coins:'🪙 เหรียญ', elo:'📈 ELO', gacha_frame:'🖼️ Gacha Frame', gacha_name:'✨ Name Effect', gacha_emoji:'😎 Emoji', gacha_element:'✦ Element', gacha_effect:'⚡ Effect' };
    list.innerHTML = items.map(item => {
      const safeVal = String(item.item_value).replace(/'/g, "\\'");
      return `
      <div class="mailbox-item">
        <div class="mailbox-item-icon">${typeLabel[item.item_type]?.split(' ')[0] || '🎁'}</div>
        <div class="mailbox-item-body">
          <div class="mailbox-item-title">${typeLabel[item.item_type] || item.item_type}: <strong>${item.item_value}</strong></div>
          ${item.message ? `<div class="mailbox-item-msg">${item.message}</div>` : ''}
        </div>
        <button class="mailbox-item-claim" onclick="claimMailItemProfile(${item.id},'${item.item_type}','${safeVal}',this)">รับ</button>
      </div>`;
    }).join('');
  } catch(e) { card.style.display = 'none'; }
}

async function claimMailItemProfile(mailId, itemType, itemValue, btn) {
  await claimMailItem(mailId, itemType, itemValue, btn);
  await renderProfileMailbox();
  await renderProfile();
  if (typeof renderGachaInventory === 'function') renderGachaInventory();
  if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
}

// ═══════════════════════════════════════════════════════════
// ── FEATURE PACK v4: Divisions, Coins, Gacha, Mailbox,   ──
// ── Form, Best Day, Pity, First Blood, Tilt, Grand Final,──
// ── Tournament Bracket                                    ──
// ═══════════════════════════════════════════════════════════

