import assert from 'node:assert/strict';
import { test } from 'node:test';
import scoring from '../js/admin/scoring.js';

const { isGameOver, isValidFinalScore, winnerOf, winsNeededForTier, matchWinnerFromGames } = scoring;

test('isGameOver: normal 21-point win', () => {
  assert.equal(isGameOver(21, 15), true);
  assert.equal(isGameOver(21, 19), true);
  assert.equal(isGameOver(20, 19), false); // not yet — no one has 21+
});

test('isGameOver: deuce past 20-20 requires win by 2, does not auto-end at 20-20', () => {
  assert.equal(isGameOver(20, 20), false);
  assert.equal(isGameOver(21, 20), false); // only +1, not yet won
  assert.equal(isGameOver(22, 20), true);
});

test('isGameOver: hard cap at 30, sudden death from 29-29', () => {
  assert.equal(isGameOver(29, 29), false);
  assert.equal(isGameOver(30, 29), true);
});

test('isValidFinalScore: accepts the spec examples', () => {
  assert.equal(isValidFinalScore(21, 18), true);
  assert.equal(isValidFinalScore(22, 20), true);
  assert.equal(isValidFinalScore(30, 29), true);
});

test('isValidFinalScore: rejects an impossible 30-cap score (bug fix vs. old validator)', () => {
  assert.equal(isValidFinalScore(30, 28), false);
  assert.equal(isValidFinalScore(30, 10), false);
});

test('isValidFinalScore: rejects under-21 "wins", ties, and over-30', () => {
  assert.equal(isValidFinalScore(20, 18), false);
  assert.equal(isValidFinalScore(21, 21), false);
  assert.equal(isValidFinalScore(31, 29), false);
});

test('winnerOf agrees with isValidFinalScore', () => {
  assert.equal(winnerOf(21, 18), 'A');
  assert.equal(winnerOf(18, 21), 'B');
  assert.equal(winnerOf(30, 28), null);
});

test('winsNeededForTier: best-of-3 only for Super 1000', () => {
  assert.equal(winsNeededForTier('Super 1000'), 2);
  assert.equal(winsNeededForTier('Super 500'), 1);
  assert.equal(winsNeededForTier('Regular'), 1);
});

test('matchWinnerFromGames: best-of-3, 2-1 in games', () => {
  const games = [{ a: 21, b: 18 }, { a: 19, b: 21 }, { a: 21, b: 15 }];
  assert.equal(matchWinnerFromGames(games, 2), 'A');
});

test('matchWinnerFromGames: no winner yet with only 1 of 2 needed games won', () => {
  const games = [{ a: 21, b: 18 }];
  assert.equal(matchWinnerFromGames(games, 2), null);
});
