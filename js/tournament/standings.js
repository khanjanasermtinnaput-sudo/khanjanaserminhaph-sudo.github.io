// Tournament V2 — group standings.
//
// The SERVER is authoritative: fn_event_standings decides who qualifies, and
// rpc_generate_knockout_from_qualifiers reads it directly. This module exists
// so the tie-break ladder is unit-testable and so the UI can re-sort a table
// locally without a round trip. It must stay in step with fn_event_standings.
//
// Ladder, in order:
//   1. match wins
//   2. head-to-head, but ONLY when exactly two entries are tied (three-way
//      head-to-head is frequently circular, so it is skipped)
//   3. game difference
//   4. point difference
//   5. games won
//   6. points won
//   7. entry id, purely for a stable order — a genuine tie at this depth is
//      flagged as is_tied for a playoff or an audited manual decision.
(function (root) {
  'use strict';

  // entries: [entryId]
  // matches: [{ entry_a_id, entry_b_id, winner_entry_id, games:[{score_a,score_b}] }]
  function computeStandings(entries, matches, advanceCount) {
    var rows = {};
    (entries || []).forEach(function (id) {
      rows[id] = {
        entry_id: id, played: 0, wins: 0, losses: 0,
        games_won: 0, games_lost: 0, points_won: 0, points_lost: 0
      };
    });

    var completed = (matches || []).filter(function (m) {
      return m.winner_entry_id != null && rows[m.entry_a_id] && rows[m.entry_b_id];
    });

    completed.forEach(function (m) {
      var a = rows[m.entry_a_id], b = rows[m.entry_b_id];
      a.played++; b.played++;
      if (m.winner_entry_id === m.entry_a_id) { a.wins++; b.losses++; }
      else { b.wins++; a.losses++; }

      (m.games || []).forEach(function (g) {
        a.points_won += g.score_a; a.points_lost += g.score_b;
        b.points_won += g.score_b; b.points_lost += g.score_a;
        if (g.score_a > g.score_b) { a.games_won++; b.games_lost++; }
        else if (g.score_b > g.score_a) { b.games_won++; a.games_lost++; }
      });
    });

    var list = Object.keys(rows).map(function (k) {
      var r = rows[k];
      r.game_diff = r.games_won - r.games_lost;
      r.point_diff = r.points_won - r.points_lost;
      return r;
    });

    // head-to-head applies only to a straight two-way tie on wins
    var byWins = {};
    list.forEach(function (r) { (byWins[r.wins] = byWins[r.wins] || []).push(r); });
    list.forEach(function (r) {
      r.h2h = 0;
      var peers = byWins[r.wins];
      if (peers.length !== 2) return;
      var other = peers[0] === r ? peers[1] : peers[0];
      for (var i = 0; i < completed.length; i++) {
        var m = completed[i];
        var pair = (m.entry_a_id === r.entry_id && m.entry_b_id === other.entry_id) ||
                   (m.entry_b_id === r.entry_id && m.entry_a_id === other.entry_id);
        if (pair) { r.h2h = m.winner_entry_id === r.entry_id ? 1 : 0; break; }
      }
    });

    function cmp(x, y) {
      return (y.wins - x.wins)
          || (y.h2h - x.h2h)
          || (y.game_diff - x.game_diff)
          || (y.point_diff - x.point_diff)
          || (y.games_won - x.games_won)
          || (y.points_won - x.points_won)
          || (x.entry_id - y.entry_id);
    }

    list.sort(cmp);

    var adv = advanceCount == null ? 1 : advanceCount;
    list.forEach(function (r, i) {
      r.rank = i + 1;
      r.qualifies = r.rank <= adv;
      var prev = list[i - 1], next = list[i + 1];
      r.is_tied = !!((prev && sameKey(prev, r)) || (next && sameKey(next, r)));
    });
    return list;
  }

  function sameKey(a, b) {
    return a.wins === b.wins && a.h2h === b.h2h
        && a.game_diff === b.game_diff && a.point_diff === b.point_diff
        && a.games_won === b.games_won && a.points_won === b.points_won;
  }

  var api = { computeStandings: computeStandings };
  root.TournamentStandings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
