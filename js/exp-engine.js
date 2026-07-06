// ── EXP / Level math — pure, DOM-free ─────────────────────────────────────
// Mirrors the SQL formula in supabase_level_system.sql (_exp_apply) exactly.
// requiredExp(L) = EXP needed to advance from level L to L+1.
// cumExp(L)      = total EXP needed to reach level L from zero.
(function (root) {
  const LEVEL_CAP = 10000; // safety bound; matches the DB RPC's cap

  function requiredExp(level) {
    return 100 * level * level;
  }

  function cumExp(level) {
    const n = level - 1;
    return (100 * n * level * (2 * level - 1)) / 6;
  }

  function levelFromTotal(total) {
    total = Number(total) || 0;
    let level = 1;
    while (level < LEVEL_CAP && cumExp(level + 1) <= total) level++;
    return level;
  }

  function expProgress(total) {
    total = Number(total) || 0;
    const level = levelFromTotal(total);
    const currentExp = total - cumExp(level);
    const required = requiredExp(level);
    const pct = required > 0 ? Math.min(100, (currentExp / required) * 100) : 0;
    return { level, currentExp, requiredExp: required, totalExp: total, pct };
  }

  const expEngine = { requiredExp, cumExp, levelFromTotal, expProgress };
  root.expEngine = expEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = expEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
