// Tournament V2 — scoring presets.
//
// Scoring belongs to the EVENT. Pre-V2 the format was inferred from the
// commercial tier ("Super 1000" meant best-of-3) in three separate places:
// js/tournament.js, js/tournament-knockout.js and js/admin/scoring.js.
//
// This module mirrors the server's fn_v2_validate_games exactly. The server
// stays authoritative; this exists so the referee UI can decide when to show
// "finish game" and so the rules are unit-testable under `node --test`.
(function (root) {
  'use strict';

  var PRESETS = {
    bwf_standard: { points_to_win: 21, win_by: 2, cap: 30, max_games: 3, games_to_win: 2 },
    one_game_21:  { points_to_win: 21, win_by: 2, cap: 30, max_games: 1, games_to_win: 1 }
  };

  var PRESET_LABELS = {
    bwf_standard: 'BWF มาตรฐาน (3 เกม 21 แต้ม)',
    one_game_21:  'เกมเดียว 21 แต้ม',
    custom:       'กำหนดเอง'
  };

  function resolveConfig(preset, custom) {
    if (preset === 'bwf_standard' || preset === 'one_game_21') {
      return Object.assign({}, PRESETS[preset]);
    }
    if (preset !== 'custom') throw new Error('ERR_BAD_SCORING_PRESET');
    if (!custom) throw new Error('ERR_SCORING_CONFIG_REQUIRED');

    var points = custom.points_to_win == null ? 21 : Number(custom.points_to_win);
    var cap    = custom.cap == null ? points + 9 : Number(custom.cap);
    var max    = custom.max_games == null ? 1 : Number(custom.max_games);
    var winBy  = custom.win_by == null ? 2 : Number(custom.win_by);

    if (!(points >= 5 && points <= 50)) throw new Error('ERR_SCORING_POINTS_RANGE');
    if (cap < points) throw new Error('ERR_SCORING_CAP_TOO_LOW');
    if (!(max >= 1 && max <= 9)) throw new Error('ERR_SCORING_GAMES_RANGE');
    if (max % 2 === 0) throw new Error('ERR_SCORING_GAMES_MUST_BE_ODD');
    if (!(winBy >= 1 && winBy <= 5)) throw new Error('ERR_SCORING_WIN_BY_RANGE');

    return {
      points_to_win: points, win_by: winBy, cap: cap,
      max_games: max, games_to_win: Math.floor(max / 2) + 1
    };
  }

  // True once the running score means the game is over — used to reveal the
  // referee's "finish game" control, not to decide the result.
  function isGameOver(a, b, cfg) {
    var c = cfg || PRESETS.one_game_21;
    var hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi >= c.cap) return true;
    return hi >= c.points_to_win && (hi - lo) >= c.win_by;
  }

  // Validate one finished game. The three legal shapes below are what make a
  // cap score reachable only through deuce, so 30-10 is correctly impossible.
  function validateGame(a, b, cfg) {
    var c = cfg || PRESETS.one_game_21;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return 'ERR_BAD_SCORE';
    if (a === b) return 'ERR_GAME_NOT_DECIDED';

    var hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi > c.cap) return 'ERR_SCORE_ABOVE_CAP';
    if (hi < c.points_to_win) return 'ERR_GAME_NOT_FINISHED';

    if (hi === c.points_to_win) {
      if ((hi - lo) < c.win_by) return 'ERR_WIN_BY_MARGIN';
    } else if (hi === c.cap) {
      if ((hi - lo) !== 1) return 'ERR_IMPOSSIBLE_CAP_SCORE';
    } else {
      if ((hi - lo) !== c.win_by) return 'ERR_DEUCE_MUST_END_ON_MARGIN';
    }
    return null;
  }

  // Returns { ok, winner: 'a'|'b', code } for a whole match.
  function validateGames(games, cfg) {
    var c = cfg || PRESETS.one_game_21;
    if (!Array.isArray(games) || games.length === 0) return { ok: false, code: 'ERR_NO_GAMES' };
    if (games.length > c.max_games) return { ok: false, code: 'ERR_TOO_MANY_GAMES' };

    var wa = 0, wb = 0, decided = false;
    for (var i = 0; i < games.length; i++) {
      if (decided) return { ok: false, code: 'ERR_GAMES_AFTER_DECIDED' };
      var g = games[i];
      var code = validateGame(g.score_a, g.score_b, c);
      if (code) return { ok: false, code: code, game: i + 1 };
      if (g.score_a > g.score_b) wa++; else wb++;
      if (wa >= c.games_to_win || wb >= c.games_to_win) decided = true;
    }
    if (!decided) return { ok: false, code: 'ERR_MATCH_NOT_DECIDED' };
    return { ok: true, winner: wa > wb ? 'a' : 'b', games_a: wa, games_b: wb };
  }

  var api = {
    PRESETS: PRESETS,
    PRESET_LABELS: PRESET_LABELS,
    resolveConfig: resolveConfig,
    isGameOver: isGameOver,
    validateGame: validateGame,
    validateGames: validateGames
  };

  root.TournamentScoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
