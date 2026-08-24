// Tournament V2 — server error codes to Thai messages.
//
// Every V2 RPC raises a stable ERR_* code instead of leaking raw Postgres text.
// This is the single place those codes become something a person can read.
// tests/tournament-errors.test.mjs asserts that every code raised anywhere in
// the supabase_tournament_v2_*.sql files has an entry here.
(function (root) {
  'use strict';

  var MESSAGES = {
    // authorization / session
    ERR_NOT_AUTHENTICATED: 'กรุณาเข้าสู่ระบบก่อน',
    ERR_NOT_ADMIN: 'เฉพาะผู้ดูแลระบบเท่านั้น',
    ERR_NOT_A_PARTICIPANT: 'คุณไม่ได้อยู่ในแมตช์นี้',

    // series / event configuration
    ERR_SERIES_NAME_REQUIRED: 'กรุณาตั้งชื่อรายการแข่งขัน',
    ERR_BAD_PURPOSE: 'รูปแบบรายการไม่ถูกต้อง',
    ERR_NO_EVENTS: 'ต้องเปิดอย่างน้อย 1 ประเภทการแข่งขัน',
    ERR_TOO_MANY_EVENTS: 'เปิดประเภทการแข่งขันมากเกินไป',
    ERR_BAD_EVENT_KIND: 'ประเภทการแข่งขันไม่ถูกต้อง',
    ERR_DUPLICATE_EVENT_KIND: 'มีประเภทการแข่งขันซ้ำกันในรายการเดียว',
    ERR_BAD_STRUCTURE: 'รูปแบบการแข่งขันไม่ถูกต้อง',
    ERR_GROUP_COUNT_RANGE: 'จำนวนกลุ่มต้องอยู่ระหว่าง 1 ถึง 8',
    ERR_TEAMS_PER_GROUP_RANGE: 'จำนวนทีมต่อกลุ่มต้องอยู่ระหว่าง 2 ถึง 8',
    ERR_ADVANCE_RANGE: 'จำนวนทีมที่ผ่านเข้ารอบต้องอย่างน้อย 1',
    ERR_ADVANCE_EXCEEDS_TEAMS: 'จำนวนทีมที่ผ่านเข้ารอบมากกว่าจำนวนทีมในกลุ่ม',
    ERR_TOO_FEW_QUALIFIERS: 'ต้องมีผู้ผ่านเข้ารอบอย่างน้อย 2 ทีมจึงจะจัดรอบน็อกเอาต์ได้',
    ERR_SELECTION_COUNT_REQUIRED: 'โหมดคัดตัวต้องระบุจำนวนผู้ที่จะถูกคัดเลือก',
    ERR_EVENT_NOT_FOUND: 'ไม่พบประเภทการแข่งขันนี้',
    ERR_EVENT_FINALIZED: 'ประเภทการแข่งขันนี้ปิดผลแล้ว แก้ไขไม่ได้',
    ERR_STRUCTURE_LOCKED: 'แก้โครงสร้างไม่ได้ เพราะการแข่งขันเริ่มไปแล้ว',
    ERR_VERSION_CONFLICT: 'มีคนอื่นแก้ไขข้อมูลนี้ไปแล้ว กรุณารีเฟรชแล้วลองใหม่',
    ERR_BAD_TRANSITION: 'ยังข้ามไปสถานะนี้ไม่ได้',
    ERR_TOO_FEW_ENTRIES: 'ผู้เข้าแข่งขันน้อยเกินไป',
    ERR_INCOMPLETE_ENTRIES: 'มีทีมที่ยังไม่ครบผู้เล่น',

    // scoring configuration
    ERR_BAD_SCORING_PRESET: 'รูปแบบการนับคะแนนไม่ถูกต้อง',
    ERR_SCORING_CONFIG_REQUIRED: 'กรุณาตั้งค่าการนับคะแนน',
    ERR_SCORING_POINTS_RANGE: 'แต้มต่อเกมต้องอยู่ระหว่าง 5 ถึง 50',
    ERR_SCORING_CAP_TOO_LOW: 'แต้มสูงสุดต้องไม่น้อยกว่าแต้มที่ใช้ชนะ',
    ERR_SCORING_GAMES_RANGE: 'จำนวนเกมต้องอยู่ระหว่าง 1 ถึง 9',
    ERR_SCORING_GAMES_MUST_BE_ODD: 'จำนวนเกมต้องเป็นเลขคี่',
    ERR_SCORING_WIN_BY_RANGE: 'ต้องชนะห่างระหว่าง 1 ถึง 5 แต้ม',

    // entries and registration
    ERR_BAD_PAYLOAD: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
    ERR_ROSTER_LOCKED: 'ปิดรับรายชื่อแล้ว',
    ERR_MEMBER_COUNT: 'จำนวนผู้เล่นในทีมไม่ถูกต้อง',
    ERR_SINGLES_MEMBER_COUNT: 'ประเภทเดี่ยวต้องมีผู้เล่น 1 คน',
    ERR_DOUBLES_MEMBER_COUNT: 'ประเภทคู่ต้องมีผู้เล่น 2 คน',
    ERR_DOUBLES_DUPLICATE_MEMBER: 'ผู้เล่นคนเดียวกันซ้ำในทีมเดียว',
    ERR_PLAYER_NOT_FOUND: 'ไม่พบผู้เล่นคนนี้',
    ERR_PLAYER_ALREADY_ENTERED: 'ผู้เล่นคนนี้ลงประเภทนี้ไปแล้ว',
    ERR_ENTRY_NOT_FOUND: 'ไม่พบรายการสมัครนี้',
    ERR_ENTRY_NOT_ELIGIBLE: 'รายการสมัครนี้ไม่มีสิทธิ์เข้าร่วม',
    ERR_ALREADY_REGISTERED: 'คุณสมัครประเภทนี้ไปแล้ว',
    ERR_REGISTRATION_CLOSED: 'ปิดรับสมัครแล้ว',
    ERR_REGISTRATION_DEADLINE_PASSED: 'เลยกำหนดปิดรับสมัครแล้ว',
    ERR_PARTNER_REQUIRED: 'ประเภทคู่ต้องเลือกคู่ของคุณ',
    ERR_PARTNER_ALREADY_REGISTERED: 'คู่ที่เลือกสมัครประเภทนี้ไปแล้ว',
    ERR_INVITE_NOT_FOUND: 'ไม่พบคำเชิญนี้',
    ERR_INVITE_ALREADY_ANSWERED: 'คำเชิญนี้ตอบไปแล้ว',
    ERR_BAD_DECISION: 'คำตอบไม่ถูกต้อง',
    ERR_NOT_REGISTERED: 'คุณยังไม่ได้สมัครประเภทนี้',
    ERR_EVENT_LOCKED: 'การแข่งขันเริ่มแล้ว กรุณาติดต่อผู้ดูแล',
    ERR_BAD_ENTRY_STATUS: 'สถานะผู้สมัครไม่ถูกต้อง',
    ERR_MEMBER_NOT_FOUND: 'ไม่พบผู้เล่นในทีมนี้',
    ERR_REASON_REQUIRED: 'กรุณาระบุเหตุผล',

    // draw and fixtures
    ERR_DRAW_NOT_ALLOWED: 'ยังจับสายไม่ได้ กรุณายืนยันรายชื่อก่อน',
    ERR_NO_GROUP_STAGE: 'รูปแบบนี้ไม่มีรอบแบ่งกลุ่ม',
    ERR_BAD_DRAW_METHOD: 'วิธีจับสายไม่ถูกต้อง',
    ERR_GROUP_NOT_FOUND: 'ไม่พบกลุ่มนี้',
    ERR_GROUP_OVERFULL: 'กลุ่มนี้มีทีมเกินจำนวนที่กำหนด',
    ERR_ENTRY_IN_TWO_GROUPS: 'มีทีมถูกจัดลงมากกว่าหนึ่งกลุ่ม',
    ERR_DRAW_NOT_READY: 'ยังไม่มีสายที่พร้อมเผยแพร่',
    ERR_DRAW_VERSION_NOT_FOUND: 'ไม่พบสายเวอร์ชันนี้',
    ERR_DRAW_NOT_PUBLISHED: 'ต้องเผยแพร่สายก่อน',
    ERR_IDEMPOTENCY_KEY_REQUIRED: 'ข้อมูลไม่ครบ กรุณาลองใหม่',
    ERR_GROUP_MATCHES_EXIST: 'สร้างตารางรอบแบ่งกลุ่มไปแล้ว',
    ERR_NO_FIXTURES_GENERATED: 'สร้างตารางแข่งไม่สำเร็จ',
    ERR_NO_KNOCKOUT_STAGE: 'รูปแบบนี้ไม่มีรอบน็อกเอาต์',
    ERR_KNOCKOUT_EXISTS: 'สร้างสายน็อกเอาต์ไปแล้ว',
    ERR_GROUP_STAGE_NOT_ACTIVE: 'ยังไม่ถึงรอบแบ่งกลุ่ม',
    ERR_GROUP_STAGE_INCOMPLETE: 'ยังแข่งรอบแบ่งกลุ่มไม่ครบทุกคู่',
    ERR_NO_QUALIFIERS: 'ยังไม่มีทีมที่ผ่านเข้ารอบ',
    ERR_TOO_MANY_ENTRIES: 'รองรับได้สูงสุด 32 ทีม',

    // results
    ERR_MATCH_NOT_FOUND: 'ไม่พบแมตช์นี้',
    ERR_MATCH_ALREADY_COMPLETED: 'แมตช์นี้บันทึกผลไปแล้ว',
    ERR_MATCH_NOT_READY: 'แมตช์นี้ยังไม่พร้อมแข่ง',
    ERR_MATCH_NOT_COMPLETED: 'แมตช์นี้ยังไม่มีผลการแข่งขัน',
    ERR_BAD_OUTCOME: 'ผลการแข่งขันไม่ถูกต้อง',
    ERR_WINNER_REQUIRED: 'กรุณาระบุผู้ชนะ',
    ERR_WINNER_NOT_IN_MATCH: 'ผู้ชนะไม่ได้อยู่ในแมตช์นี้',
    ERR_NO_GAMES: 'กรุณากรอกคะแนนอย่างน้อย 1 เกม',
    ERR_TOO_MANY_GAMES: 'จำนวนเกมเกินที่กำหนดไว้',
    ERR_GAMES_AFTER_DECIDED: 'มีเกมเกินมาหลังจากรู้ผลแพ้ชนะแล้ว',
    ERR_BAD_SCORE: 'คะแนนไม่ถูกต้อง',
    ERR_GAME_NOT_DECIDED: 'คะแนนเสมอกัน เกมยังไม่จบ',
    ERR_GAME_NOT_FINISHED: 'คะแนนยังไม่ถึงเกณฑ์ชนะเกม',
    ERR_SCORE_ABOVE_CAP: 'คะแนนเกินเพดานสูงสุด',
    ERR_WIN_BY_MARGIN: 'ต้องชนะห่างอย่างน้อย 2 แต้ม',
    ERR_DEUCE_MUST_END_ON_MARGIN: 'ช่วงดิวซ์ต้องจบด้วยการชนะห่าง 2 แต้ม',
    ERR_IMPOSSIBLE_CAP_SCORE: 'คะแนนนี้เป็นไปไม่ได้ เพดาน 30 แต้มต้องจบที่ 30-29',
    ERR_MATCH_NOT_DECIDED: 'ยังไม่มีฝ่ายใดชนะครบตามจำนวนเกม',
    ERR_DOWNSTREAM_LOCKED: 'แก้ผลไม่ได้ เพราะแมตช์รอบถัดไปเริ่มแล้ว',
    ERR_REWARDS_ALREADY_GRANTED: 'แก้ผลไม่ได้ เพราะแจกรางวัลไปแล้ว',

    // selection mode
    ERR_SELECTION_NOT_ENABLED: 'ประเภทนี้ไม่ได้เปิดโหมดคัดตัว',
    ERR_SELECTION_COUNT_MISMATCH: 'จำนวนผู้ถูกคัดเลือกไม่ตรงกับที่ตั้งค่าไว้',
    ERR_SELECTION_ENTRY_INVALID: 'มีรายชื่อที่ไม่ได้อยู่ในประเภทนี้',
    ERR_SELECTION_ALREADY_FINALIZED: 'ประกาศผลคัดตัวไปแล้ว',

    // raised client-side by js/tournament/validation.js
    ERR_EVENT_INVALID: 'ประเภทการแข่งขันนี้ตั้งค่าไม่ถูกต้อง'
  };

  var FALLBACK = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';

  // PostgREST wraps a RAISE as { message, details, hint, code }. The ERR_* code
  // is the message text; details carry the human-useful specifics.
  function codeOf(err) {
    if (!err) return null;
    if (typeof err === 'string') return extract(err);
    return extract(err.message || err.msg || err.error || '');
  }

  function extract(text) {
    var m = String(text).match(/ERR_[A-Z0-9_]+/);
    return m ? m[0] : null;
  }

  function toThai(err) {
    var code = codeOf(err);
    return (code && MESSAGES[code]) || FALLBACK;
  }

  var api = { MESSAGES: MESSAGES, FALLBACK: FALLBACK, codeOf: codeOf, toThai: toThai };
  root.TournamentErrors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
