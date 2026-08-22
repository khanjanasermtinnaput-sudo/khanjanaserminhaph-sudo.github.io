// Admin V2 — fuzzy-match a parsed roster entry against existing players
// (js/admin/roster-match.js). Pure functions, unit-tested. Never merges or
// overwrites a player automatically — always returns a confidence tier, and
// only 'exact' is auto-accepted in the UI; everything else requires the
// admin to resolve it (see the plan's "fuzzy matching" section).
(function (root) {
  'use strict';

  function normalize(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  // Simple Levenshtein distance — small strings (names), no need for a
  // fancier algorithm.
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      }
    }
    return d[m][n];
  }

  function similarity(a, b) {
    const na = normalize(a), nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const dist = levenshtein(na, nb);
    return 1 - dist / Math.max(na.length, nb.length);
  }

  // parsed: { fullName, firstName, lastName, nickname, classLabel }
  // players: normalized player objects (id, name, nickname, classLabel)
  // Returns { tier: 'exact'|'high'|'low'|'none', candidates: [{player, score, reason}] }
  function matchPlayer(parsed, players) {
    const candidates = [];
    for (const p of players) {
      let best = 0, reason = '';
      const nameSim = similarity(parsed.fullName, p.name);
      if (nameSim > best) { best = nameSim; reason = 'name'; }
      if (parsed.nickname && p.nickname) {
        const nickSim = similarity(parsed.nickname, p.nickname);
        if (nickSim > best) { best = nickSim; reason = 'nickname'; }
      }
      // Same nickname + same class is a very strong signal even if the
      // legal name spelling differs (transliteration variance is common).
      if (parsed.nickname && p.nickname && normalize(parsed.nickname) === normalize(p.nickname)
          && parsed.classLabel && p.classLabel && parsed.classLabel === p.classLabel) {
        best = Math.max(best, 0.97);
        reason = 'nickname+class';
      }
      if (best > 0.4) candidates.push({ player: p, score: best, reason });
    }
    candidates.sort((a, b) => b.score - a.score);

    if (!candidates.length) return { tier: 'none', candidates: [] };
    const top = candidates[0];
    if (top.score >= 0.97) return { tier: 'exact', candidates };
    if (top.score >= 0.75) return { tier: 'high', candidates: candidates.slice(0, 5) };
    return { tier: 'low', candidates: candidates.slice(0, 5) };
  }

  const RosterMatch = { normalize, levenshtein, similarity, matchPlayer };

  if (typeof window !== 'undefined') {
    window.AdminV2 = window.AdminV2 || {};
    window.AdminV2.rosterMatch = RosterMatch;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RosterMatch;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
