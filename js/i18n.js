// ── LANGUAGE / I18N ────────────────────────────────────────────
const I18N = {
  th: {
    nav_lb:'อันดับ', nav_match:'แมตช์', nav_hist:'ประวัติ', nav_profile:'โปรไฟล์',
    hi:'สวัสดี', logout:'ออก',
    pts:'คะแนน', wins:'ชนะ', losses:'แพ้', total_matches:'แมตช์ทั้งหมด',
    win_rate:'Win Rate', rank:'อันดับ',
    login_sub:'ระบบจัดการแบดมินตันเพื่อน',
    login_tab:'เข้าสู่ระบบ', reg_tab:'สมัครสมาชิก',
    login_btn:'เข้าสู่ระบบ', reg_btn:'สมัครสมาชิก',
    name_label:'ชื่อผู้ใช้', pin_label:'PIN 4 หลัก',
    name_ph:'ชื่อจริงของคุณ',
    reg_name_label:'ชื่อจริง', reg_pin_label:'PIN 4 หลัก (ตั้งรหัส)',
    reg_name_ph:'ชื่อที่ต้องการใช้',
    ql_hi:'👋 สวัสดีกลับมา!', ql_q:'แอคเคาท์นี้ใช้ของคุณไหม?',
    ql_yes:'✅ ใช่, เข้าเลย!', ql_no:'ไม่ใช่บัญชีฉัน', ql_sep:'หรือเข้าด้วยรหัส',
    cur_rank:'แรงค์ปัจจุบัน', peak_rank:'แรงค์สูงสุด',
    form_10:'🎯 ฟอร์ม 10 เกมล่าสุด',
    ranking_hist:'📈 Ranking History', elo_timeline:'📈 ELO Timeline',
    h2h:'⚔️ Head-to-Head', best_partner:'🤝 พาร์ทเนอร์ที่ดีที่สุด',
    recent_hist:'📋 ประวัติล่าสุด',
    no_data:'ยังไม่มีข้อมูล', no_doubles:'ยังไม่มีข้อมูล Doubles', no_match:'ยังไม่มีแมตช์',
    win_label:'🏆 ชนะ', lose_label:'💔 แพ้',
    rank_progress:'ความคืบหน้า', rank_max:'(ระดับสูงสุด)',
    elo_x2:'⚡ ELO x2 MODE เปิดใช้งาน — คะแนนทุกแมตช์คูณ 2!',
    matches_with:'แมตช์ด้วยกัน', won:'ชนะ',
    // leaderboard
    rank_p1:'อันดับ 1', rank_p2:'อันดับ 2', rank_p3:'อันดับ 3',
    me:'(ฉัน)', pts_col:'คะแนน', wl_col:'ชนะ/แพ้',
    // match setup
    select_ph:'-- เลือก --', no_players:'ยังไม่มีผู้เล่น',
    max_2:'เลือกได้แค่ทีมละ 2 คน',
    team_a:'🔵 ทีม A', team_b:'🔴 ทีม B',
    start_match:'▶ เริ่มแมตช์',
    // history
    loading:'กำลังโหลด...', all_players:'👥 ทุกคน',
    no_history:'ยังไม่มีประวัติ', total_all:'📋 ทั้งหมด', load_fail:'❌ โหลดไม่ได้',
    win_badge:'✅ ชนะ', lose_badge:'❌ แพ้',
    // profile
    rank_pos:'อันดับ #', total_m:'แมตช์ทั้งหมด',
    // admin
    players_stat:'ผู้เล่น', matches_stat:'แมตช์', total_wins:'ชนะรวม', top_score:'คะแนนสูงสุด',
    edit_btn:'✏️ แก้ไข', no_players_list:'ไม่มีผู้เล่น',
    // pending
    no_pending:'ไม่มีรายการรอยืนยัน', unknown:'ไม่ทราบ', submitted_by:'ส่งโดย',
    hrs:'ช.ม.', mins:'น.', expire_in:'หมดอายุใน',
    approve:'✅ ยืนยัน', reject:'❌ ปฏิเสธ',
    win_team:'🏆 ชนะ',
    // season banner
    days_left:'วัน', no_reset:'ไม่โดนรี', prime_awarded:'🏅 คว้า Prime',
    // potd
    potd_title:'Players of the Day', people_unit:'คน',
    // today hist
    today_label:'วันนี้', matches_unit:'แมตช์',
    // monthly
    wins_bar:'ชนะ', losses_bar:'แพ้',
    // personal records
    streak_label:'Win Streak ยาวสุด', biggest_win:'ชนะขาดสุด (แต้ม)',
    peak_elo_m:'ELO สูงสุด/แมตช์', wins_day:'ชนะมากสุด/วัน',
    // profile rank stats
    cur_rank_pos:'อันดับปัจจุบัน', peak_rank_pos:'อันดับสูงสุด', days_played:'วันที่เล่น',
  },
  en: {
    nav_lb:'Ranking', nav_match:'Match', nav_hist:'History', nav_profile:'Profile',
    hi:'Hi', logout:'Logout',
    pts:'Points', wins:'Wins', losses:'Losses', total_matches:'Total Matches',
    win_rate:'Win Rate', rank:'Rank',
    login_sub:'Badminton club management',
    login_tab:'Sign In', reg_tab:'Register',
    login_btn:'Sign In', reg_btn:'Register',
    name_label:'Username', pin_label:'4-digit PIN',
    name_ph:'Your name',
    reg_name_label:'Full Name', reg_pin_label:'Set 4-digit PIN',
    reg_name_ph:'Display name',
    ql_hi:'👋 Welcome back!', ql_q:'Is this your account?',
    ql_yes:'✅ Yes, sign me in!', ql_no:'Not my account', ql_sep:'Or sign in with PIN',
    cur_rank:'Current Rank', peak_rank:'Peak Rank',
    form_10:'🎯 Last 10 Games',
    ranking_hist:'📈 Ranking History', elo_timeline:'📈 ELO Timeline',
    h2h:'⚔️ Head-to-Head', best_partner:'🤝 Best Partner',
    recent_hist:'📋 Recent History',
    no_data:'No data yet', no_doubles:'No Doubles data', no_match:'No matches yet',
    win_label:'🏆 Win', lose_label:'💔 Loss',
    rank_progress:'Progress', rank_max:'(Max Level)',
    elo_x2:'⚡ ELO x2 MODE Active — All match points ×2!',
    matches_with:'matches together', won:'won',
    // leaderboard
    rank_p1:'Rank 1', rank_p2:'Rank 2', rank_p3:'Rank 3',
    me:'(me)', pts_col:'Points', wl_col:'W/L',
    // match setup
    select_ph:'-- Select --', no_players:'No players yet',
    max_2:'Max 2 players per team',
    team_a:'🔵 Team A', team_b:'🔴 Team B',
    start_match:'▶ Start Match',
    // history
    loading:'Loading...', all_players:'👥 Everyone',
    no_history:'No history yet', total_all:'📋 Total', load_fail:'❌ Failed to load',
    win_badge:'✅ Win', lose_badge:'❌ Loss',
    // profile
    rank_pos:'Rank #', total_m:'Total Matches',
    // admin
    players_stat:'Players', matches_stat:'Matches', total_wins:'Total Wins', top_score:'Top Score',
    edit_btn:'✏️ Edit', no_players_list:'No players',
    // pending
    no_pending:'No pending matches', unknown:'Unknown', submitted_by:'By',
    hrs:'hr', mins:'min', expire_in:'Expires in',
    approve:'✅ Approve', reject:'❌ Reject',
    win_team:'🏆 Won',
    // season banner
    days_left:'days', no_reset:'Protected', prime_awarded:'🏅 Prime awarded',
    // potd
    potd_title:'Players of the Day', people_unit:'',
    // today hist
    today_label:'Today', matches_unit:'Matches',
    // monthly
    wins_bar:'Wins', losses_bar:'Losses',
    // personal records
    streak_label:'Longest Win Streak', biggest_win:'Biggest Win (pts)',
    peak_elo_m:'Peak ELO/Match', wins_day:'Most Wins/Day',
    // profile rank stats
    cur_rank_pos:'Current Rank', peak_rank_pos:'Highest Rank', days_played:'Days Played',
  }
};
let _lang = localStorage.getItem('badminton_lang') || 'th';
function t(k) { return (I18N[_lang]||I18N.th)[k] || k; }
function toggleLang() {
  _lang = _lang === 'th' ? 'en' : 'th';
  localStorage.setItem('badminton_lang', _lang);
  applyLang();
  const active = document.querySelector('.section.active');
  if (!active) return;
  const sid = active.id.replace('Section','');
  if (sid==='leaderboard') renderLeaderboard();
  else if (sid==='match') { try { renderMatchSetup(); } catch(e){} }
  else if (sid==='history') { try { renderHistory(); } catch(e){} }
  else if (sid==='profile') renderProfile();
  else if (sid==='admin') renderAdmin();
}
function applyLang() {
  const L = I18N[_lang]||I18N.th;
  const btn = document.getElementById('langToggleBtn');
  if (btn) btn.textContent = _lang==='th' ? '🌐 EN' : '🌐 ไทย';
  const nb = [['navLb','🏆 '+L.nav_lb],['navMatch','⚔️ '+L.nav_match],['navHist','📋 '+L.nav_hist],['navProfile','👤 '+L.nav_profile]];
  nb.forEach(([id,txt])=>{ const el=document.getElementById(id); if(el) el.textContent=txt; });
  const map = {
    navHiLabel:L.hi, navLogoutBtn:L.logout,
    loginSubEl:L.login_sub,
    loginTabBtn:L.login_tab, regTabBtn:L.reg_tab,
    loginBtnEl:L.login_btn, regBtnEl:L.reg_btn,
    loginNameLabel:L.name_label, loginPinLabel:L.pin_label,
    regNameLabel:L.reg_name_label, regPinLabel:L.reg_pin_label,
    qlHiEl:L.ql_hi, qlQEl:L.ql_q, qlYesBtn:L.ql_yes, qlNoBtn:L.ql_no, qlSepEl:L.ql_sep,
    eloX2Banner:L.elo_x2,
  };
  for (const [id,txt] of Object.entries(map)) { const el=document.getElementById(id); if(el) el.textContent=txt; }
  const phMap = { loginName:L.name_ph, regName:L.reg_name_ph };
  for (const [id,ph] of Object.entries(phMap)) { const el=document.getElementById(id); if(el) el.placeholder=ph; }
}
// ───────────────────────────────────────────────────────────────
