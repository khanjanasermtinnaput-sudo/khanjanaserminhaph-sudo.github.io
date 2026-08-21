// Admin V2 — shared BWF scoring rules (js/admin/scoring.js)
// Pure functions, no DOM access, so this can be unit-tested with `node --test`
// (see tests/admin-scoring.test.mjs) and loaded as a plain browser script.
//
// This exists to end a real divergence: today there are 3 separate client
// scoring engines (js/leaderboard.js checkBWFWin, js/tournament.js
// _refGameOver, js/tournament-knockout.js _koRefGameOver) plus the
// server-side validator in rpc_tournament_submit_knockout_result — and only
// the server one is fully correct. This module mirrors the server exactly
// and becomes the one place the client-side callers delegate to.
(function (root) {
  'use strict';

  // Is the CURRENT live score a finished game? Used point-by-point while a
  // game is in progress — sufficient on its own because scores only ever
  // increase by 1, so a hi===30 state can only be reached as 30-29 (the
  // win-by-2 rule already ends the game earlier at any smaller gap).
  function isGameOver(a, b) {
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi >= 30) return true;
    if (hi >= 21 && hi - lo >= 2) return true;
    return false;
  }

  // Is (a, b) a legal FINAL score on its own, with no incremental history to
  // rely on (manual entry, AI-imported results, corrections)? Stricter than
  // isGameOver: also rejects a 30 that isn't 30-29, which the old
  // js/leaderboard.js _isValidBadmintonFinalScore did not check (bug fixed
  // here — 30-10 was previously accepted as "valid").
  function isValidFinalScore(a, b) {
    if (a === b) return false;
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi > 30) return false;
    if (hi < 21) return false;
    if (hi === 30) return lo === 29;
    return (hi - lo) >= 2;
  }

  function winnerOf(a, b) {
    if (!isValidFinalScore(a, b)) return null;
    return a > b ? 'A' : 'B';
  }

  // Best-of-N: how many games must a side win? Mirrors the existing
  // js/tournament.js convention (tier==='Super 1000' -> best of 3, else
  // single game) so the new Referee Center agrees with the group-stage one.
  function winsNeededForTier(tier) {
    return tier === 'Super 1000' ? 2 : 1;
  }

  // Given a completed array of {a,b} games, has either side already reached
  // winsNeeded? Returns 'A' | 'B' | null.
  function matchWinnerFromGames(games, winsNeeded) {
    let winsA = 0, winsB = 0;
    for (const g of games) {
      const w = winnerOf(g.a, g.b);
      if (w === 'A') winsA++;
      else if (w === 'B') winsB++;
    }
    if (winsA >= winsNeeded) return 'A';
    if (winsB >= winsNeeded) return 'B';
    return null;
  }

  const AdminV2Scoring = { isGameOver, isValidFinalScore, winnerOf, winsNeededForTier, matchWinnerFromGames };

  if (typeof window !== 'undefined') {
    window.AdminV2 = window.AdminV2 || {};
    window.AdminV2.scoring = AdminV2Scoring;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdminV2Scoring;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
