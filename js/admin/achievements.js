// Admin V2 — Achievement Studio (js/admin/achievements.js)
// Manages achievements in admin_achievements (supabase_admin_v2_achievements.sql).
// The legacy admin-created catalog that used to live packed into
// players.prime_titles (js/season.js __catalog:/__cach: sentinels) has been
// migrated in — see supabase_admin_v2_achievements_migration.sql — as
// ordinary rows with legacy_id set (badged "ย้ายจากระบบเดิม" below); that
// migration never touched prime_titles itself, so the legacy admin page
// keeps reading and working exactly as before. The hardcoded, always-live-
// recomputed ACHIEVEMENTS_DEF/TOURNAMENT_ACHIEVEMENTS_DEF (js/achievements.js)
// are NOT migrated — they're code, not data — but are shown read-only below
// (builtInSectionHTML) so this screen shows the complete picture.
//
// The rule builder only ever produces {field, operator, value} — a plain
// data comparison the server whitelists (supabase_admin_v2_achievements.sql),
// never a free-text expression, let alone eval().
window.AdminV2 = window.AdminV2 || {};

(function () {

  const RULE_FIELDS = [
    { id: 'wins', label: 'จำนวนชนะ (wins)' },
    { id: 'losses', label: 'จำนวนแพ้ (losses)' },
    { id: 'pts', label: 'คะแนน ELO (pts)' },
    { id: 'level', label: 'เลเวล (level)' },
    { id: 'coins', label: 'เหรียญ (coins)' },
    { id: 'consecutive_wins', label: 'ชนะติดต่อกัน' },
    { id: 'best_win_streak', label: 'สถิติชนะติดต่อกันสูงสุด' },
  ];
  const RULE_OPS = [
    { id: '>=', label: '≥ มากกว่าหรือเท่ากับ' }, { id: '<=', label: '≤ น้อยกว่าหรือเท่ากับ' },
    { id: '>', label: '> มากกว่า' }, { id: '<', label: '< น้อยกว่า' }, { id: '==', label: '= เท่ากับ' },
  ];
  const RARITIES = ['bronze', 'silver', 'gold', 'legendary'];

  let list = [];

  function ruleText(rule) {
    if (!rule) return 'ไม่มีเงื่อนไข (มอบด้วยมือเท่านั้น)';
    const f = RULE_FIELDS.find(x => x.id === rule.field);
    const o = RULE_OPS.find(x => x.id === rule.operator);
    return `${f ? f.label : rule.field} ${o ? o.id : rule.operator} ${rule.value}`;
  }

  function cardHTML(a) {
    return `<div class="card" data-ach="${a.id}">
      <div class="card-title">${escapeHtml(a.icon || '🏅')} ${escapeHtml(a.title)} <span class="av2-badge av2-badge-gold">${escapeHtml(a.rarity)}</span>${a.hidden ? ' <span class="av2-badge">ซ่อน</span>' : ''}${a.repeatable ? ' <span class="av2-badge">รับซ้ำได้</span>' : ''}${a.legacy_id ? ' <span class="av2-badge">ย้ายจากระบบเดิม</span>' : ''}</div>
      ${a.description ? `<div class="av2-muted">${escapeHtml(a.description)}</div>` : ''}
      <div class="av2-muted" style="margin-top:6px">เงื่อนไข: ${escapeHtml(ruleText(a.rule))}</div>
      ${a.reward ? `<div class="av2-muted">รางวัล: ${a.reward.coins ? '+' + a.reward.coins + ' เหรียญ ' : ''}${a.reward.elo ? '+' + a.reward.elo + ' ELO' : ''}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-ghost btn-sm" style="width:auto" data-grant="${a.id}">🎁 มอบให้ผู้เล่น</button>
        <button class="btn btn-ghost btn-sm" style="width:auto" data-view-grants="${a.id}">👥 ดูผู้ที่ได้รับ</button>
        <button class="btn btn-ghost btn-sm" style="width:auto;color:var(--red)" data-archive="${a.id}">🗄️ เก็บเข้าคลัง</button>
      </div>
    </div>`;
  }

  function renderCreateForm() {
    return `<div class="card">
      <div class="card-title">➕ สร้าง Achievement ใหม่</div>
      <div class="form-group"><label>ไอคอน (emoji)</label><input class="inp" id="av2AchIcon" placeholder="🏆" maxlength="4" style="width:80px"></div>
      <div class="form-group"><label>ชื่อ</label><input class="inp" id="av2AchTitle" placeholder="เช่น นักสู้ 10 นัด"></div>
      <div class="form-group"><label>คำอธิบาย</label><input class="inp" id="av2AchDesc"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group"><label>ระดับความหายาก</label><select class="inp" id="av2AchRarity">${RARITIES.map(r => `<option value="${r}">${r}</option>`).join('')}</select></div>
        <div class="form-group" style="display:flex;gap:16px;align-items:center;padding-top:22px">
          <label class="av2-checkbox-label"><input type="checkbox" id="av2AchHidden"> ซ่อน</label>
          <label class="av2-checkbox-label"><input type="checkbox" id="av2AchRepeatable"> รับซ้ำได้</label>
        </div>
      </div>
      <div class="card-title" style="font-size:0.88rem;margin-top:14px">เงื่อนไข (ไม่บังคับ — ใช้เป็นแนวทางสำหรับมอบด้วยมือ)</div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">
        <select class="inp" id="av2AchRuleField"><option value="">— ไม่มีเงื่อนไข —</option>${RULE_FIELDS.map(f => `<option value="${f.id}">${escapeHtml(f.label)}</option>`).join('')}</select>
        <select class="inp" id="av2AchRuleOp">${RULE_OPS.map(o => `<option value="${o.id}">${escapeHtml(o.id)}</option>`).join('')}</select>
        <input class="inp" id="av2AchRuleValue" type="number" placeholder="ค่า">
      </div>
      <div class="card-title" style="font-size:0.88rem;margin-top:14px">รางวัล (ไม่บังคับ — มอบให้อัตโนมัติตอนกด "มอบให้ผู้เล่น")</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input class="inp" id="av2AchRewardCoins" type="number" placeholder="เหรียญ (เช่น 20)">
        <input class="inp" id="av2AchRewardElo" type="number" placeholder="ELO (เช่น 5)">
      </div>
      <button class="btn btn-primary btn-sm" id="av2AchCreateBtn" style="margin-top:12px;width:auto">สร้าง Achievement</button>
    </div>`;
  }

  // Read-only — ACHIEVEMENTS_DEF/TOURNAMENT_ACHIEVEMENTS_DEF (js/achievements.js,
  // both plain globals already loaded on every page, no fetch needed) are
  // developer-authored check() closures, always recomputed live, never stored
  // as a grant anywhere. There's nothing here to create/grant/revoke/archive —
  // this section exists purely so "what achievements exist in this system"
  // shows the complete picture in one place, per the spec.
  function builtInSectionHTML() {
    const defs = [
      ...(typeof ACHIEVEMENTS_DEF !== 'undefined' ? ACHIEVEMENTS_DEF : []),
      ...(typeof TOURNAMENT_ACHIEVEMENTS_DEF !== 'undefined' ? TOURNAMENT_ACHIEVEMENTS_DEF : []),
    ];
    if (!defs.length) return '';
    return `<div class="card">
      <div class="card-title">🔧 Achievement ในตัว (โค้ด — แก้ไข/มอบด้วยมือไม่ได้)</div>
      <div class="av2-muted" style="margin-bottom:8px">ปลดล็อกอัตโนมัติตามเงื่อนไขในโค้ด ไม่ใช่ข้อมูลที่มอบให้ผู้เล่นทีละคน</div>
      ${defs.map(d => `<div class="av2-hist-row">${escapeHtml(d.icon || '🏅')} <strong>${escapeHtml(d.title)}</strong>${d.desc ? ` <span class="av2-muted">— ${escapeHtml(d.desc)}</span>` : ''}</div>`).join('')}
    </div>`;
  }

  async function render(container) {
    AdminV2.state(container, 'loading', {});
    try {
      list = await AdminV2.api.listAchievements();
      await loadAll();
      const body = document.createElement('div');
      body.className = 'av2-panel';
      body.innerHTML = renderCreateForm() + builtInSectionHTML() + list.map(cardHTML).join('') + (list.length ? '' : '<div class="card"><div class="av2-muted" style="text-align:center;padding:16px">ยังไม่มี Achievement ที่สร้างผ่าน Admin V2</div></div>');
      container.innerHTML = '';
      container.appendChild(body);
      wire(container);
    } catch (e) {
      AdminV2.state(container, 'error', { message: e.message, retry: () => render(container) });
    }
  }

  function wire(container) {
    document.getElementById('av2AchCreateBtn').onclick = async () => {
      const title = document.getElementById('av2AchTitle').value.trim();
      if (!title) { toast('กรุณากรอกชื่อ Achievement', 'error'); return; }
      const field = document.getElementById('av2AchRuleField').value;
      const rule = field ? { field, operator: document.getElementById('av2AchRuleOp').value, value: Number(document.getElementById('av2AchRuleValue').value) || 0 } : null;
      const coins = Number(document.getElementById('av2AchRewardCoins').value) || 0;
      const elo = Number(document.getElementById('av2AchRewardElo').value) || 0;
      const reward = (coins || elo) ? { coins, elo } : null;
      try {
        await AdminV2.api.createAchievement({
          title, description: document.getElementById('av2AchDesc').value.trim(),
          icon: document.getElementById('av2AchIcon').value.trim(),
          rarity: document.getElementById('av2AchRarity').value,
          hidden: document.getElementById('av2AchHidden').checked,
          repeatable: document.getElementById('av2AchRepeatable').checked,
          rule, reward,
        });
        toast('สร้าง Achievement สำเร็จ ✅', 'success');
        render(container);
      } catch (e) { toast('สร้างไม่สำเร็จ: ' + e.message, 'error'); }
    };

    container.querySelectorAll('[data-grant]').forEach(btn => {
      btn.onclick = () => openGrantFlow(container, Number(btn.dataset.grant));
    });
    container.querySelectorAll('[data-archive]').forEach(btn => {
      btn.onclick = () => {
        AdminV2.confirm({
          level: 'confirm', title: 'ยืนยันเก็บเข้าคลัง', body: 'Achievement นี้จะไม่แสดงในรายการอีก (ผู้เล่นที่ได้รับแล้วยังคงมีอยู่)',
          onConfirm: async () => {
            try { await AdminV2.api.archiveAchievement(Number(btn.dataset.archive)); toast('เก็บเข้าคลังสำเร็จ ✅', 'success'); render(container); }
            catch (e) { toast('ไม่สำเร็จ: ' + e.message, 'error'); }
          },
        });
      };
    });
    container.querySelectorAll('[data-view-grants]').forEach(btn => {
      btn.onclick = () => openGrantsList(Number(btn.dataset.viewGrants));
    });
  }

  function openGrantFlow(container, achievementId) {
    const ach = list.find(a => a.id === achievementId);
    const host = document.createElement('div');
    AdminV2.drawer({
      title: `🎁 มอบ "${ach.title}"`,
      body: `<div class="form-group"><label>ผู้เล่น</label>
        <select class="inp" id="av2GrantPlayer">${[...db.players].sort((a, b) => b.pts - a.pts).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>หมายเหตุ (ไม่บังคับ)</label><input class="inp" id="av2GrantNote"></div>`,
      actions: `<button class="btn btn-ghost" id="av2GrantCancel">ยกเลิก</button><button class="btn btn-primary" id="av2GrantGo">มอบ Achievement</button>`,
      onMount: () => {
        document.getElementById('av2GrantCancel').onclick = () => AdminV2.closeDrawer();
        document.getElementById('av2GrantGo').onclick = async () => {
          const pid = Number(document.getElementById('av2GrantPlayer').value);
          const note = document.getElementById('av2GrantNote').value.trim();
          try {
            await AdminV2.api.grantAchievement(achievementId, pid, note);
            toast('มอบ Achievement สำเร็จ ✅', 'success');
            AdminV2.closeDrawer();
            render(container);
          } catch (e) { toast('มอบไม่สำเร็จ: ' + e.message, 'error'); }
        };
      },
    });
  }

  async function openGrantsList(achievementId) {
    const ach = list.find(a => a.id === achievementId);
    const grants = await AdminV2.api.listGrantsForAchievement(achievementId);
    const playerName = (id) => (db.players.find(p => p.id === id) || {}).name || ('#' + id);
    AdminV2.drawer({
      title: `👥 ผู้ที่ได้รับ "${ach.title}"`,
      body: grants.length
        ? grants.map(g => `<div class="av2-hist-row">${escapeHtml(playerName(g.player_id))} <span class="av2-muted">· ${new Date(g.granted_at).toLocaleDateString('th-TH')}</span>
            <button class="btn btn-ghost btn-sm" style="margin-left:8px;width:auto;color:var(--red)" data-revoke="${g.id}">เพิกถอน</button></div>`).join('')
        : '<div class="av2-muted">ยังไม่มีผู้ได้รับ</div>',
      onMount: (host) => {
        host.querySelectorAll('[data-revoke]').forEach(btn => {
          btn.onclick = () => {
            const reason = window.prompt('เหตุผลในการเพิกถอน (จำเป็น):', '');
            if (!reason || !reason.trim()) { toast('ต้องกรอกเหตุผล', 'error'); return; }
            AdminV2.api.revokeAchievement(Number(btn.dataset.revoke), reason.trim())
              .then(() => { toast('เพิกถอนสำเร็จ ✅', 'success'); AdminV2.closeDrawer(); })
              .catch(e => toast('ไม่สำเร็จ: ' + e.message, 'error'));
          };
        });
      },
    });
  }

  AdminV2.achievements = { render };

})();
