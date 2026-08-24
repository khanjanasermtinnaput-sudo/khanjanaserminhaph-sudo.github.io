// Tournament V2 — the shared data service.
//
// Every V2 read and write goes through here, so Admin Tournament Studio and the
// public Tournament Hub cannot drift apart the way the pre-V2 admin panel and
// public tab did (two knockout paths behind near-identical Thai button labels).
//
// Built on supaFetch (js/db.js), so it inherits the same x-player-token auth.
// Errors are re-thrown as Error objects carrying `.code` (an ERR_* string) and
// `.detail`, ready for TournamentErrors.toThai().
(function (root) {
  'use strict';

  // ── error normalisation ───────────────────────────────────────────────────
  // PostgREST returns a JSON body for a RAISE; supaFetch throws with that text
  // embedded. Pull the ERR_* code out so callers never see raw Postgres.
  function wrap(err) {
    var codes = root.TournamentErrors;
    var e = new Error((err && err.message) || String(err));
    e.code = codes ? codes.codeOf(err) : null;
    e.thai = codes ? codes.toThai(err) : null;
    e.original = err;
    var m = String((err && err.message) || '').match(/"details?"\s*:\s*"([^"]*)"/);
    e.detail = m ? m[1] : null;
    return e;
  }

  async function rpc(name, body) {
    try {
      return await supaFetch('rpc/' + name, {
        method: 'POST',
        body: JSON.stringify(body || {})
      });
    } catch (err) {
      throw wrap(err);
    }
  }

  async function get(path) {
    try {
      return await supaFetch(path);
    } catch (err) {
      throw wrap(err);
    }
  }

  // ── shaping ───────────────────────────────────────────────────────────────
  // A doubles entry is ONE competitor, so it is shaped as one object with a
  // members array. Nothing downstream may treat members[0] as "the player" the
  // way the retired anchor-player convention did.
  function shapeEntry(row, playersById) {
    var members = (row.tournament_entry_members || [])
      .slice()
      .sort(function (a, b) { return a.member_order - b.member_order; })
      .map(function (m) {
        var p = playersById && playersById[m.player_id];
        return {
          player_id: m.player_id,
          name: (p && (p.nickname || p.name)) || ('#' + m.player_id),
          full_name: (p && p.name) || ('#' + m.player_id),
          member_order: m.member_order,
          invite_status: m.invite_status
        };
      });

    return {
      id: row.id,
      tournament_id: row.tournament_id,
      entry_type: row.entry_type,
      status: row.status,
      source: row.source,
      seed: row.seed,
      lock_version: row.lock_version,
      members: members,
      // one display name for the whole team, never just the first member
      display_name: row.display_name ||
        (members.length ? members.map(function (m) { return m.name; }).join(' / ') : '—'),
      complete: members.length === (row.entry_type === 'doubles' ? 2 : 1) &&
        members.every(function (m) { return m.invite_status !== 'declined'; }),
      awaiting_partner: members.some(function (m) { return m.invite_status === 'pending'; })
    };
  }

  var ENTRY_SELECT =
    'id,tournament_id,entry_type,display_name,seed,status,source,lock_version,' +
    'tournament_entry_members(player_id,member_order,invite_status,invited_by)';

  var svc = {
    // ── series ──────────────────────────────────────────────────────────────
    async listSeries(opts) {
      var o = opts || {};
      var q = 'tournament_series?select=*&order=created_at.desc';
      if (o.limit) q += '&limit=' + o.limit;
      return get(q);
    },

    async getSeries(seriesId) {
      var rows = await get('tournament_series?id=eq.' + seriesId + '&select=*');
      return rows[0] || null;
    },

    async listEvents(seriesId) {
      return get('tournaments?series_id=eq.' + seriesId +
        '&select=*&order=event_kind.asc');
    },

    async getEvent(eventId) {
      var rows = await get('tournaments?id=eq.' + eventId + '&select=*');
      return rows[0] || null;
    },

    // Everything the Tournament Hub and the ops dashboard need for one event,
    // in one place, so callers do not each invent their own fetch order.
    async getEventBundle(eventId, playersById) {
      var event = await svc.getEvent(eventId);
      if (!event) return null;
      var results = await Promise.all([
        svc.listEntries(eventId, playersById),
        svc.listGroups(eventId),
        svc.listMatches(eventId),
        svc.standings(eventId)
      ]);
      return {
        event: event,
        entries: results[0],
        groups: results[1],
        matches: results[2],
        standings: results[3]
      };
    },

    async createSeriesWithEvents(series, events) {
      return rpc('rpc_admin_create_series_with_events', {
        p_series: series,
        p_events: events
      });
    },

    async updateEventConfig(eventId, expectedVersion, config) {
      return rpc('rpc_admin_update_event_config', {
        p_event_id: eventId, p_expected_version: expectedVersion, p_config: config
      });
    },

    async setLifecycle(eventId, nextStatus, expectedVersion, reason) {
      return rpc('rpc_admin_set_event_lifecycle', {
        p_event_id: eventId, p_next_status: nextStatus,
        p_expected_version: expectedVersion, p_reason: reason || null
      });
    },

    // ── entries ─────────────────────────────────────────────────────────────
    async listEntries(eventId, playersById) {
      var rows = await get('tournament_entries?tournament_id=eq.' + eventId +
        '&select=' + ENTRY_SELECT + '&order=seed.asc.nullslast,id.asc');
      return rows.map(function (r) { return shapeEntry(r, playersById); });
    },

    async importEntries(eventId, entries, expectedVersion, replace) {
      return rpc('rpc_admin_import_entries', {
        p_event_id: eventId, p_entries: entries,
        p_expected_version: expectedVersion, p_replace: !!replace
      });
    },

    async setEntryStatus(entryId, status, reason) {
      return rpc('rpc_admin_set_entry_status', {
        p_entry_id: entryId, p_status: status, p_reason: reason
      });
    },

    async substituteMember(entryId, outPlayer, inPlayer, reason) {
      return rpc('rpc_admin_substitute_member', {
        p_entry_id: entryId, p_out_player: outPlayer,
        p_in_player: inPlayer, p_reason: reason
      });
    },

    // ── self-service registration ───────────────────────────────────────────
    // No player id is ever sent: the server derives identity from the session.
    async register(eventId, partnerId) {
      return rpc('rpc_register_event', {
        p_event_id: eventId, p_partner_id: partnerId || null
      });
    },

    async respondToInvite(entryId, decision) {
      return rpc('rpc_respond_partner_invite', {
        p_entry_id: entryId, p_decision: decision
      });
    },

    async withdraw(eventId) {
      return rpc('rpc_withdraw_event', { p_event_id: eventId });
    },

    // Which events the signed-in player is in, and what they must do next.
    async myEntries(playerId, seriesId) {
      if (!playerId) return [];
      var q = 'tournament_entry_members?player_id=eq.' + playerId +
        '&entry_active=is.true&select=entry_id,invite_status,member_order,tournament_id';
      var mine = await get(q);
      if (!mine.length) return [];

      var ids = mine.map(function (m) { return m.tournament_id; });
      var events = await get('tournaments?id=in.(' + ids.join(',') + ')&select=*' +
        (seriesId ? '&series_id=eq.' + seriesId : ''));
      var byId = {};
      events.forEach(function (e) { byId[e.id] = e; });

      return mine
        .filter(function (m) { return byId[m.tournament_id]; })
        .map(function (m) {
          return {
            entry_id: m.entry_id,
            event: byId[m.tournament_id],
            invite_status: m.invite_status,
            needs_my_answer: m.invite_status === 'pending'
          };
        });
    },

    // ── groups, draw ────────────────────────────────────────────────────────
    async listGroups(eventId) {
      return get('tournament_groups?tournament_id=eq.' + eventId +
        '&select=id,letter,sort_order,advance_count,' +
        'tournament_group_entries(id,entry_id,slot,seed)&order=sort_order.asc');
    },

    async assignGroups(eventId, assignments, drawSeed, expectedVersion, method) {
      return rpc('rpc_admin_assign_groups', {
        p_event_id: eventId, p_assignments: assignments,
        p_draw_seed: drawSeed, p_expected_version: expectedVersion,
        p_draw_method: method || 'random'
      });
    },

    async publishDraw(eventId, drawVersion) {
      return rpc('rpc_admin_publish_draw', {
        p_event_id: eventId, p_draw_version: drawVersion
      });
    },

    async listDrawVersions(eventId) {
      return get('tournament_draw_versions?tournament_id=eq.' + eventId +
        '&select=*&order=version.desc');
    },

    // ── fixtures and results ────────────────────────────────────────────────
    async generateGroupMatches(eventId, idempotencyKey) {
      return rpc('rpc_generate_group_matches', {
        p_event_id: eventId, p_idempotency_key: idempotencyKey
      });
    },

    async generateKnockout(eventId, idempotencyKey) {
      return rpc('rpc_generate_knockout_from_qualifiers', {
        p_event_id: eventId, p_idempotency_key: idempotencyKey
      });
    },

    async listMatches(eventId, stage) {
      var q = 'tournament_matches?tournament_id=eq.' + eventId +
        '&select=*,tournament_match_games(game_no,score_a,score_b,winner_side)' +
        '&order=stage.asc,round_index.asc,match_no.asc';
      if (stage) q += '&stage=eq.' + stage;
      return get(q);
    },

    // Server-authoritative. The client never decides who qualified.
    async standings(eventId) {
      return rpc('rpc_compute_event_standings', { p_event_id: eventId });
    },

    async submitResult(matchId, games, opts) {
      var o = opts || {};
      return rpc('rpc_submit_match_result', {
        p_match_id: matchId,
        p_games: games,
        p_outcome: o.outcome || 'normal',
        p_duration_seconds: o.duration == null ? null : o.duration,
        p_idempotency_key: o.idempotencyKey || svc.newIdempotencyKey(matchId),
        p_winner_entry_id: o.winnerEntryId || null
      });
    },

    async correctResult(matchId, games, reason, opts) {
      var o = opts || {};
      return rpc('rpc_admin_correct_match_result', {
        p_match_id: matchId, p_games: games, p_reason: reason,
        p_outcome: o.outcome || 'normal',
        p_winner_entry_id: o.winnerEntryId || null
      });
    },

    // Stable per submission attempt so a retry after a dropped response is a
    // replay rather than a second result.
    newIdempotencyKey(matchId) {
      return 'm' + matchId + '-' + Date.now() + '-' +
        Math.random().toString(36).slice(2, 8);
    },

    // ── helpers shared by the admin and public renderers ────────────────────
    scoringConfigFor(event) {
      if (event && event.scoring_config) return event.scoring_config;
      var preset = (event && event.scoring_preset) || 'one_game_21';
      try {
        return root.TournamentScoring.resolveConfig(preset, null);
      } catch (e) {
        return root.TournamentScoring.PRESETS.one_game_21;
      }
    },

    entryLabel(entries, entryId) {
      if (entryId == null) return null;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].id === entryId) return entries[i].display_name;
      }
      return '#' + entryId;
    },

    LIFECYCLE_LABELS: {
      draft: 'ฉบับร่าง',
      roster_ready: 'รายชื่อพร้อม',
      draw_ready: 'จับสายแล้ว (ยังไม่เผยแพร่)',
      published: 'เผยแพร่แล้ว',
      group_stage: 'รอบแบ่งกลุ่ม',
      knockout: 'รอบน็อกเอาต์',
      completed: 'จบการแข่งขัน',
      selection_completed: 'ประกาศผลคัดตัวแล้ว',
      cancelled: 'ยกเลิก'
    },

    MATCH_STATUS_LABELS: {
      pending: 'รอคู่แข่ง',
      ready: 'พร้อมแข่ง',
      live: 'กำลังแข่ง',
      bye: 'บาย',
      walkover: 'ชนะบาย',
      completed: 'จบแล้ว',
      cancelled: 'ยกเลิก',
      retired: 'ขอถอนกลางแมตช์',
      disqualified: 'ปรับแพ้'
    },

    // The next action an admin should take, derived from lifecycle rather than
    // guessed by each screen. Returns null when nothing is pending.
    nextAdminAction(event) {
      switch (event && event.lifecycle_status) {
        case 'draft':        return { to: 'roster_ready', label: 'ยืนยันรายชื่อ' };
        case 'roster_ready': return { to: 'draw',         label: 'จับสายการแข่งขัน' };
        case 'draw_ready':   return { to: 'publish',      label: 'เผยแพร่สาย' };
        case 'published':    return { to: 'start',        label: 'เริ่มรอบแบ่งกลุ่ม' };
        case 'group_stage':  return { to: 'knockout',     label: 'สร้างรอบน็อกเอาต์' };
        default:             return null;
      }
    }
  };

  // exposed for unit tests of the pure shaping helpers
  svc._shapeEntry = shapeEntry;
  svc._wrap = wrap;
  svc._ENTRY_SELECT = ENTRY_SELECT;

  root.TournamentService = svc;
  if (typeof module !== 'undefined' && module.exports) module.exports = svc;
})(typeof window !== 'undefined' ? window : globalThis);
