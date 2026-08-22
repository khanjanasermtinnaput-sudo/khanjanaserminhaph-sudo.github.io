// Admin V2 — deterministic Thai roster parser (js/admin/roster-parse.js)
// Pure functions, no DOM — unit-tested with `node --test`
// (tests/admin-roster-parse.test.mjs) against the spec's clean/messy/doubles
// samples. AI NEVER writes the database (see the plan): this module only
// gets from pasted text to a structured, human-reviewable preview. An
// optional LLM fallback for genuinely messy input is designed for but not
// wired up yet — it needs a new edge function deployed, which was
// deliberately held back rather than done without asking (it spends real
// API quota).
(function (root) {
  'use strict';

  const EVENT_LABELS = {
    'ชายเดี่ยว': { kind: 'ms', doubles: false },
    'หญิงเดี่ยว': { kind: 'ws', doubles: false },
    'ชายคู่': { kind: 'md', doubles: true },
    'หญิงคู่': { kind: 'wd', doubles: true },
    'คู่ผสม': { kind: 'xd', doubles: true },
  };
  const EVENT_LABEL_LIST = Object.keys(EVENT_LABELS);
  const HONORIFICS = ['นาย', 'นาง', 'นางสาว', 'น.ส.', 'ด.ช.', 'ด.ญ.'];
  // Matched against a whole whitespace-delimited TOKEN, never a raw
  // substring — a substring match would let the "ม" prefix option eat the
  // trailing "ม" off a nickname like "โอม" sitting right before the class.
  const CLASS_TOKEN_RE = /^ม\.?(\d{1,2}\/\d{1,2})$/;
  const PLAIN_CLASS_TOKEN_RE = /^(\d{1,2}\/\d{1,2})$/;

  function findEventLabelIn(line) {
    for (const label of EVENT_LABEL_LIST) {
      if (line.includes(label)) return label;
    }
    return null;
  }

  // Strips an event label if it appears anywhere in the line (handles the
  // "messy" case where it's glued to a player line, before or after), and a
  // leading standalone pair/seed number ("1", "2", ...).
  function stripEventLabelAndSeed(line) {
    let s = line;
    const label = findEventLabelIn(s);
    if (label) s = s.replace(label, ' ');
    s = s.trim();
    const m = s.match(/^(\d+)\s+(.+)$/);
    if (m) s = m[2];
    return { text: s.trim(), eventLabel: label };
  }

  // Operates on an ALREADY-SPLIT token array — finds the first token that is
  // wholly a class label (optionally ม-prefixed) and removes just that token.
  function extractClassLabel(tokens) {
    for (let i = 0; i < tokens.length; i++) {
      const mWithM = tokens[i].match(CLASS_TOKEN_RE);
      const mPlain = tokens[i].match(PLAIN_CLASS_TOKEN_RE);
      const m = mWithM || mPlain;
      if (m) return { classLabel: m[1], rest: [...tokens.slice(0, i), ...tokens.slice(i + 1)] };
    }
    return { classLabel: null, rest: tokens };
  }

  function parsePlayerLine(rawLine) {
    const warnings = [];
    const { text: afterSeed, eventLabel } = stripEventLabelAndSeed(rawLine);
    let tokens = afterSeed.split(/\s+/).filter(Boolean);
    if (tokens[0] && HONORIFICS.includes(tokens[0])) tokens = tokens.slice(1);

    const { classLabel, rest: tokensAfterClass } = extractClassLabel(tokens);
    if (!classLabel) warnings.push('missing_class');
    tokens = tokensAfterClass;

    let firstName = null, lastName = null, nickname = null;
    if (tokens.length >= 3) {
      firstName = tokens[0];
      lastName = tokens[1];
      nickname = tokens.slice(2).join(' ');
    } else if (tokens.length === 2) {
      firstName = tokens[0];
      lastName = tokens[1];
    } else if (tokens.length === 1) {
      firstName = tokens[0];
      warnings.push('incomplete_name');
    } else {
      warnings.push('empty_line');
    }

    return {
      raw: rawLine,
      eventLabel,
      firstName, lastName, nickname,
      fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
      classLabel,
      warnings,
    };
  }

  // Splits on blank lines into blocks, but does NOT rely on blank lines for
  // pair grouping (doubles pairs are grouped as every 2 consecutive parsed
  // player-lines within a doubles event, per the spec's examples) — blank
  // lines are just visual separators in real pasted rosters.
  function parseRosterText(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const events = [];
    let current = null; // { kind, label, doubles, players: [] }
    const warnings = [];

    function ensureEvent(label) {
      const meta = EVENT_LABELS[label];
      if (current && current.label === label) return current;
      current = { kind: meta.kind, label, doubles: meta.doubles, players: [] };
      events.push(current);
      return current;
    }

    for (const line of lines) {
      // A line that is *only* an event label (no player info) just switches context.
      if (EVENT_LABEL_LIST.includes(line)) { ensureEvent(line); continue; }

      const parsed = parsePlayerLine(line);
      if (parsed.eventLabel) ensureEvent(parsed.eventLabel);

      if (!current) {
        warnings.push({ line, code: 'no_event_context', message: 'ไม่พบว่าอยู่ในประเภทใด (ไม่มีหัวข้อประเภทการแข่งขันนำหน้า)' });
        continue;
      }
      if (!parsed.firstName) {
        warnings.push({ line, code: 'unparseable_line', message: 'แยกชื่อไม่ได้' });
        continue;
      }
      current.players.push(parsed);
    }

    // Group into pairs for doubles events.
    for (const ev of events) {
      if (!ev.doubles) continue;
      ev.pairs = [];
      for (let i = 0; i < ev.players.length; i += 2) {
        const p1 = ev.players[i], p2 = ev.players[i + 1];
        if (!p2) {
          warnings.push({ line: p1.raw, code: 'unpaired_player', message: `${p1.fullName} ไม่มีคู่ (จำนวนผู้เล่นในประเภทคู่เป็นเลขคี่)` });
          ev.pairs.push([p1, null]);
        } else {
          ev.pairs.push([p1, p2]);
        }
      }
    }

    for (const ev of events) {
      for (const p of ev.players) {
        for (const w of p.warnings) {
          if (w === 'missing_class') warnings.push({ line: p.raw, code: 'missing_class', message: `${p.fullName || p.raw} ไม่มีข้อมูลห้อง` });
          if (w === 'incomplete_name') warnings.push({ line: p.raw, code: 'incomplete_name', message: `"${p.raw}" มีแค่ชื่อเดียว ไม่แน่ใจว่าเป็นชื่อจริงหรือนามสกุล` });
        }
      }
    }

    return { events, warnings };
  }

  const RosterParse = { parseRosterText, parsePlayerLine, extractClassLabel, EVENT_LABELS };

  if (typeof window !== 'undefined') {
    window.AdminV2 = window.AdminV2 || {};
    window.AdminV2.rosterParse = RosterParse;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RosterParse;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
