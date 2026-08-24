// Scoring presets — mirrors the server's fn_v2_validate_games.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../js/tournament/scoring-presets.js');

const one = S.PRESETS.one_game_21;
const bwf = S.PRESETS.bwf_standard;

test('presets are decoupled from tier', () => {
  assert.equal(one.max_games, 1);
  assert.equal(one.games_to_win, 1);
  assert.equal(bwf.max_games, 3);
  assert.equal(bwf.games_to_win, 2);
});

test('a straight 21-point win is valid', () => {
  assert.equal(S.validateGame(21, 10, one), null);
  assert.equal(S.validateGame(21, 19, one), null);
});

test('21-20 is rejected: the margin must be two', () => {
  assert.equal(S.validateGame(21, 20, one), 'ERR_WIN_BY_MARGIN');
});

test('deuce must end exactly on the two-point margin', () => {
  assert.equal(S.validateGame(22, 20, one), null);
  assert.equal(S.validateGame(24, 22, one), null);
  assert.equal(S.validateGame(29, 27, one), null);
  assert.equal(S.validateGame(25, 20, one), 'ERR_DEUCE_MUST_END_ON_MARGIN');
});

test('the 30-point cap is only reachable as 30-29', () => {
  assert.equal(S.validateGame(30, 29, one), null);
  // 30-10 was accepted by the pre-V2 validator; a game cannot pass 21 without
  // going to deuce, so any other cap score is impossible.
  assert.equal(S.validateGame(30, 10, one), 'ERR_IMPOSSIBLE_CAP_SCORE');
  assert.equal(S.validateGame(30, 28, one), 'ERR_IMPOSSIBLE_CAP_SCORE');
});

test('scores above the cap are rejected', () => {
  assert.equal(S.validateGame(31, 29, one), 'ERR_SCORE_ABOVE_CAP');
});

test('unfinished and tied games are rejected', () => {
  assert.equal(S.validateGame(15, 10, one), 'ERR_GAME_NOT_FINISHED');
  assert.equal(S.validateGame(21, 21, one), 'ERR_GAME_NOT_DECIDED');
  assert.equal(S.validateGame(-1, 21, one), 'ERR_BAD_SCORE');
});

test('isGameOver tracks a running score', () => {
  assert.equal(S.isGameOver(20, 18, one), false);
  assert.equal(S.isGameOver(21, 19, one), true);
  assert.equal(S.isGameOver(21, 20, one), false);
  assert.equal(S.isGameOver(30, 29, one), true);
});

test('a one-game event refuses a second game', () => {
  const r = S.validateGames([{ score_a: 21, score_b: 10 }, { score_a: 21, score_b: 9 }], one);
  assert.equal(r.code, 'ERR_TOO_MANY_GAMES');
});

test('best of three resolves 2-0 and 2-1', () => {
  const straight = S.validateGames([{ score_a: 21, score_b: 10 }, { score_a: 21, score_b: 9 }], bwf);
  assert.equal(straight.ok, true);
  assert.equal(straight.winner, 'a');

  const three = S.validateGames([
    { score_a: 21, score_b: 10 }, { score_a: 9, score_b: 21 }, { score_a: 21, score_b: 19 }
  ], bwf);
  assert.equal(three.ok, true);
  assert.equal(three.winner, 'a');
  assert.equal(three.games_a, 2);
  assert.equal(three.games_b, 1);
});

test('a dead rubber after the match is decided is rejected', () => {
  const r = S.validateGames([
    { score_a: 21, score_b: 10 }, { score_a: 21, score_b: 9 }, { score_a: 21, score_b: 8 }
  ], bwf);
  assert.equal(r.code, 'ERR_GAMES_AFTER_DECIDED');
});

test('an undecided best-of-three is rejected', () => {
  assert.equal(S.validateGames([{ score_a: 21, score_b: 10 }], bwf).code, 'ERR_MATCH_NOT_DECIDED');
  assert.equal(S.validateGames([], one).code, 'ERR_NO_GAMES');
});

test('side B can win', () => {
  const r = S.validateGames([{ score_a: 10, score_b: 21 }], one);
  assert.equal(r.winner, 'b');
});

test('custom presets are validated', () => {
  const c = S.resolveConfig('custom', { points_to_win: 15, max_games: 3, cap: 21 });
  assert.equal(c.games_to_win, 2);
  assert.equal(S.validateGame(15, 13, c), null);
  assert.equal(S.validateGame(15, 14, c), 'ERR_WIN_BY_MARGIN');
  assert.equal(S.validateGame(21, 20, c), null); // cap reached at 21-20

  assert.throws(() => S.resolveConfig('custom', { max_games: 2 }), /ERR_SCORING_GAMES_MUST_BE_ODD/);
  assert.throws(() => S.resolveConfig('custom', { points_to_win: 99 }), /ERR_SCORING_POINTS_RANGE/);
  assert.throws(() => S.resolveConfig('custom', { points_to_win: 21, cap: 10 }), /ERR_SCORING_CAP_TOO_LOW/);
  assert.throws(() => S.resolveConfig('nonsense'), /ERR_BAD_SCORING_PRESET/);
});
