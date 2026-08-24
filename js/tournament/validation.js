// Tournament V2 — event configuration validation.
//
// Mirrors the checks inside rpc_admin_create_series_with_events so the wizard
// can show errors inline instead of round-tripping to the server for each one.
// The server remains authoritative; nothing here is a substitute for it.
(function (root) {
  'use strict';

  // Team size is a property of the category and is never editable in the UI.
  var EVENT_KINDS = [
    { id: 'ms', label: 'ชายเดี่ยว', team_size: 1 },
    { id: 'ws', label: 'หญิงเดี่ยว', team_size: 1 },
    { id: 'md', label: 'ชายคู่',     team_size: 2 },
    { id: 'wd', label: 'หญิงคู่',     team_size: 2 },
    { id: 'xd', label: 'คู่ผสม',      team_size: 2 }
  ];

  var STRUCTURES = {
    groups_knockout: 'รอบแบ่งกลุ่ม → รอบน็อกเอาต์',
    knockout_only:   'น็อกเอาต์โดยตรง',
    groups_only:     'รอบแบ่งกลุ่มอย่างเดียว'
  };

  var PRESETS = {
    '2x4':    { label: '2 กลุ่ม × 4 ทีม', group_count: 2, teams_per_group: 4, advance_per_group: 2 },
    '2x2':    { label: '2 กลุ่ม × 2 ทีม', group_count: 2, teams_per_group: 2, advance_per_group: 1 },
    'custom': { label: 'กำหนดเอง' }
  };

  var LIMITS = { group_count: [1, 8], teams_per_group: [2, 8] };

  function teamSizeFor(kind, override) {
    var found = EVENT_KINDS.filter(function (k) { return k.id === kind; })[0];
    if (found) return found.team_size;
    if (kind === 'custom') return override == null ? 1 : override;
    return null;
  }

  // The five standard events, all enabled, all independently configurable.
  function buildDefaultEvents(purpose) {
    return EVENT_KINDS.map(function (k) {
      var e = {
        event_kind: k.id,
        event_label: k.label,
        enabled: true,
        team_size: k.team_size,
        structure: 'groups_knockout',
        preset: '2x4',
        group_count: 2,
        teams_per_group: 4,
        advance_per_group: 2,
        scoring_preset: 'one_game_21',
        capacity: null
      };
      if (purpose === 'selection') { e.selected_count = 2; e.reserve_count = 1; }
      return e;
    });
  }

  function applyPreset(event, presetId) {
    var p = PRESETS[presetId];
    var next = Object.assign({}, event, { preset: presetId });
    if (p && presetId !== 'custom') {
      next.group_count = p.group_count;
      next.teams_per_group = p.teams_per_group;
      next.advance_per_group = p.advance_per_group;
    }
    return next;
  }

  function validateEvent(event, purpose) {
    var errors = [], warnings = [];
    var hasGroups = event.structure === 'groups_knockout' || event.structure === 'groups_only';

    if (!STRUCTURES[event.structure]) errors.push({ field: 'structure', code: 'ERR_BAD_STRUCTURE' });
    if (teamSizeFor(event.event_kind, event.team_size) == null) {
      errors.push({ field: 'event_kind', code: 'ERR_BAD_EVENT_KIND' });
    }

    if (hasGroups) {
      var g = event.group_count, t = event.teams_per_group, a = event.advance_per_group;
      if (!(g >= LIMITS.group_count[0] && g <= LIMITS.group_count[1])) {
        errors.push({ field: 'group_count', code: 'ERR_GROUP_COUNT_RANGE' });
      }
      if (!(t >= LIMITS.teams_per_group[0] && t <= LIMITS.teams_per_group[1])) {
        errors.push({ field: 'teams_per_group', code: 'ERR_TEAMS_PER_GROUP_RANGE' });
      }
      if (!(a >= 1)) {
        errors.push({ field: 'advance_per_group', code: 'ERR_ADVANCE_RANGE' });
      } else if (t >= 2 && a > t) {
        errors.push({ field: 'advance_per_group', code: 'ERR_ADVANCE_EXCEEDS_TEAMS' });
      }
      if (event.structure === 'groups_knockout' && g >= 1 && a >= 1 && (g * a) < 2) {
        errors.push({ field: 'advance_per_group', code: 'ERR_TOO_FEW_QUALIFIERS' });
      }
    }

    if (purpose === 'selection') {
      if (!(event.selected_count >= 1)) {
        errors.push({ field: 'selected_count', code: 'ERR_SELECTION_COUNT_REQUIRED' });
      } else if (hasGroups && event.selected_count > event.group_count * event.teams_per_group) {
        warnings.push({ field: 'selected_count', code: 'WARN_SELECTION_EXCEEDS_FIELD' });
      }
    }

    // The app holds no reliable gender field on players, so mixed-doubles
    // composition cannot be checked automatically. Per spec this is an
    // admin-acknowledged warning rather than invented data.
    if (event.event_kind === 'xd') {
      warnings.push({ field: 'event_kind', code: 'WARN_XD_GENDER_UNVERIFIED' });
    }

    return { errors: errors, warnings: warnings, ok: errors.length === 0 };
  }

  function validateSeries(series, events) {
    var errors = [], warnings = [], perEvent = {};

    if (!series || !String(series.name || '').trim()) {
      errors.push({ field: 'name', code: 'ERR_SERIES_NAME_REQUIRED' });
    }
    if (series && series.purpose && ['championship', 'selection'].indexOf(series.purpose) === -1) {
      errors.push({ field: 'purpose', code: 'ERR_BAD_PURPOSE' });
    }

    var enabled = (events || []).filter(function (e) { return e.enabled !== false; });
    if (enabled.length === 0) errors.push({ field: 'events', code: 'ERR_NO_EVENTS' });

    var seen = {};
    enabled.forEach(function (e) {
      if (e.event_kind !== 'custom') {
        if (seen[e.event_kind]) errors.push({ field: 'events', code: 'ERR_DUPLICATE_EVENT_KIND' });
        seen[e.event_kind] = true;
      }
      var r = validateEvent(e, series && series.purpose);
      perEvent[e.event_kind] = r;
      if (!r.ok) errors.push({ field: 'events', code: 'ERR_EVENT_INVALID', event_kind: e.event_kind });
      warnings = warnings.concat(r.warnings.map(function (w) {
        return Object.assign({ event_kind: e.event_kind }, w);
      }));
    });

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
      events: perEvent,
      enabled_count: enabled.length
    };
  }

  // A doubles entry is only valid with exactly two distinct members.
  function validateEntry(entry, teamSize) {
    var ids = (entry && entry.player_ids) || [];
    if (ids.length !== teamSize) return { ok: false, code: 'ERR_MEMBER_COUNT' };
    if (teamSize === 2 && ids[0] === ids[1]) return { ok: false, code: 'ERR_DOUBLES_DUPLICATE_MEMBER' };
    return { ok: true };
  }

  function findDuplicatePlayers(entries) {
    var seen = {}, dupes = [];
    (entries || []).forEach(function (e) {
      (e.player_ids || []).forEach(function (id) {
        if (seen[id]) { if (dupes.indexOf(id) === -1) dupes.push(id); }
        seen[id] = true;
      });
    });
    return dupes;
  }

  var api = {
    EVENT_KINDS: EVENT_KINDS,
    STRUCTURES: STRUCTURES,
    PRESETS: PRESETS,
    LIMITS: LIMITS,
    teamSizeFor: teamSizeFor,
    buildDefaultEvents: buildDefaultEvents,
    applyPreset: applyPreset,
    validateEvent: validateEvent,
    validateSeries: validateSeries,
    validateEntry: validateEntry,
    findDuplicatePlayers: findDuplicatePlayers
  };

  root.TournamentValidation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
