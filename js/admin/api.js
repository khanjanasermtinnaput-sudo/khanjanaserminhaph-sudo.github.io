// Admin V2 — thin wrappers over supaFetch for the new admin RPCs (js/admin/api.js)
// Everything here calls supaFetch (js/db.js), so it inherits the same
// x-player-token auth and error surfacing as the rest of the app.
window.AdminV2 = window.AdminV2 || {};

(function () {

  AdminV2.api = {
    // Unlike loadPlayers() (js/db.js), this does NOT filter out soft-deleted
    // players — Admin needs to see and restore them.
    async listPlayersAll() {
      const rows = await supaFetch('players?select=' + PLAYER_PUBLIC_COLS + '&order=pts.desc');
      return rows.map(normalizePlayer);
    },

    async adjustPoints(playerId, delta, reason) {
      return supaFetch('rpc/rpc_admin_adjust_points', {
        method: 'POST',
        body: JSON.stringify({ p_player: playerId, p_delta: delta, p_reason: reason }),
      });
    },

    async setPlayerFields(playerId, patch, reason) {
      return supaFetch('rpc/rpc_admin_set_player_fields', {
        method: 'POST',
        body: JSON.stringify({ p_player: playerId, p_patch: patch, p_reason: reason }),
      });
    },

    async softDeletePlayer(playerId, reason) {
      return supaFetch('rpc/rpc_admin_soft_delete_player', {
        method: 'POST',
        body: JSON.stringify({ p_player: playerId, p_reason: reason }),
      });
    },

    async restorePlayer(playerId) {
      return supaFetch('rpc/rpc_admin_restore_player', {
        method: 'POST',
        body: JSON.stringify({ p_player: playerId }),
      });
    },

    // Bounded to the same 500-row window as legacy history (js/leaderboard.js
    // renderHistory) — fine at this club's match volume (~90 total).
    async recentMatchesForPlayer(playerId) {
      const rows = await supaFetch('matches?order=played_at.desc&limit=500');
      const matches = rows.map(normalizeMatch);
      return matches.filter(m =>
        (m.teamA || []).some(p => p.id === playerId) ||
        (m.teamB || []).some(p => p.id === playerId)
      );
    },

    async listMatches(status) {
      const rows = await supaFetch('matches?status=eq.' + status + '&order=played_at.desc&limit=200');
      return rows.map(m => ({ ...normalizeMatch(m), status: m.status, voidedAt: m.voided_at, voidedBy: m.voided_by, voidReason: m.void_reason }));
    },

    async voidMatch(matchId, reason) {
      return supaFetch('rpc/rpc_admin_void_match', {
        method: 'POST',
        body: JSON.stringify({ p_match: matchId, p_reason: reason }),
      });
    },

    async listSeries() {
      return supaFetch('tournament_series?order=created_at.desc');
    },

    async createSeries(fields) {
      const rows = await supaFetch('tournament_series', {
        method: 'POST', prefer: 'return=representation',
        body: JSON.stringify(fields),
      });
      return rows[0];
    },

    async listAllTournaments() {
      return supaFetch('tournaments?order=created_at.desc');
    },

    // series_id/event_kind/event_label are plain columns on `tournaments`,
    // already admin-PATCHable under the existing tournaments_update_admin RLS
    // policy — the same policy the legacy client already relies on to PATCH
    // `groups`/`reward_overrides` directly. No new RPC needed for this part.
    async setTournamentEventMeta(tournamentId, patch) {
      return supaFetch('tournaments?id=eq.' + tournamentId, {
        method: 'PATCH', prefer: 'return=minimal',
        body: JSON.stringify(patch),
      });
    },

    async registerEntrant(tournamentId, group, slotIdx, subIdx, targetPlayerId, reason) {
      return supaFetch('rpc/rpc_admin_register_entrant', {
        method: 'POST',
        body: JSON.stringify({ p_tournament_id: tournamentId, p_group: group, p_slot_idx: slotIdx, p_sub_idx: subIdx, p_target_player: targetPlayerId, p_reason: reason }),
      });
    },

    async unregisterEntrant(tournamentId, targetPlayerId, reason) {
      return supaFetch('rpc/rpc_admin_unregister_entrant', {
        method: 'POST',
        body: JSON.stringify({ p_tournament_id: tournamentId, p_target_player: targetPlayerId, p_reason: reason }),
      });
    },
  };

})();
