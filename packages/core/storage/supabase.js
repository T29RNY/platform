import { createClient } from "@supabase/supabase-js";
import { hasGoalData, resolveDominantType, periodCutoff } from "../engine/scoring.js";
import { cookieAuthStorage } from "./cookieAuthStorage.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Phase 0e cross-app SSO. Custom storage that writes the auth session to a
    // cookie scoped to the shared parent domain when VITE_AUTH_COOKIE_DOMAIN is
    // set, so one sign-in carries across every *.in-or-out.com app. When the env
    // is unset it transparently delegates to localStorage → behaviour is byte-
    // identical to the supabase-js default (safe to merge dark). See
    // cookieAuthStorage.js. (storageKey is left to the SDK default —
    // `sb-<ref>-auth-token`, already identical across all apps.)
    storage: cookieAuthStorage,
    // Make the previously-implicit defaults explicit. supabase-js owns token
    // refreshing — the app must NOT also force a refreshSession() on boot/resume
    // (that races the SDK's auto-refresh, revokes the live token, and in a
    // WKWebView where storage doesn't round-trip becomes a 1/sec refresh storm →
    // 429 → logout). flowType is deliberately LEFT at the SDK default: the native
    // shell returns an implicit `#access_token` hash that detectSessionInUrl
    // consumes, and web sign-in works on the default too — changing it would
    // break one of the two paths.
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  realtime: {
    // iOS suspends the PWA and tears down the realtime WebSocket when
    // backgrounded. A short, capped backoff gets the socket rejoined fast on
    // foreground instead of the SDK's default long ramp, so live updates
    // resume streaming quickly after the app returns from the background.
    reconnectAfterMs: (tries) => Math.min(tries * 1000, 5000),
    timeout: 20000,
  },
});

// ─── Team resolution ──────────────────────────────────────────────────────────
export async function getTeamByAdminToken(token) {
  const { data, error } = await supabase.rpc('get_team_by_admin_token', { p_admin_token: token });
  if (error || !data) return null;
  return data;
}

export async function getTeamByPlayerToken(token) {
  // Find player, then find their team
  const { data: player } = await supabase
    .from("players").select("id").eq("token", token).single();
  if (!player) return null;
  const { data: tp } = await supabase
    .from("team_players").select("team_id").eq("player_id", player.id).single();
  if (!tp) return null;
  const { data: team } = await supabase
    .from("teams").select("*").eq("id", tp.team_id).single();
  return team || null;
}

// ─── Players ──────────────────────────────────────────────────────────────────
export async function getPlayers(teamId) {
  const { data, error } = await supabase
    .from("team_players").select("player_id").eq("team_id", teamId);
  if (error || !data?.length) return [];
  const ids = data.map(r => r.player_id);
  const { data: players, error: pErr } = await supabase
    .from("players").select("*").in("id", ids).order("name");
  if (pErr) throw pErr;
  return (players || []).map(dbToPlayer);
}

export async function setPlayerStatus(token, status) {
  const { error } = await supabase.rpc('set_player_status', { p_token: token, p_status: status });
  if (error) throw error;
}

export async function setPlayerInjured(token, injured) {
  const { error } = await supabase.rpc('set_player_injured', { p_token: token, p_injured: injured });
  if (error) throw error;
}

export async function setPlayerNote(token, note) {
  const { error } = await supabase.rpc('set_player_note', { p_token: token, p_note: note ?? null });
  if (error) throw error;
}

// Phase 9 (finish) — player self contact-capture + notification preference.
// channel ∈ push|email|sms|whatsapp; sms/whatsapp require a phone. Returns {ok, phone, notification_channel}.
export async function setPlayerContact(token, phone, channel) {
  const { data, error } = await supabase.rpc('set_player_contact', {
    p_token: token, p_phone: phone ?? null, p_channel: channel ?? 'push',
  });
  if (error) { console.error('[player] set_player_contact failed', error); throw error; }
  return data;
}

// Prefill for the notification-preference UI: { phone, notification_channel, has_linked_email }.
export async function getMyContact(token) {
  const { data, error } = await supabase.rpc('get_my_contact', { p_token: token });
  if (error) { console.error('[player] get_my_contact failed', error); throw error; }
  return data;
}

export async function deletePlayer(adminToken, id) {
  const { error } = await supabase.rpc('admin_delete_player', { p_admin_token: adminToken, p_player_id: id });
  if (error) throw error;
}

export async function getPlayerByToken(token) {
  const { data, error } = await supabase.rpc('get_player_by_token', { p_token: token });
  if (error || !data) return null;
  return dbToPlayer({ ...data, token });
}

export async function resetPlayerToken(adminToken, playerId) {
  const { data, error } = await supabase.rpc('admin_reset_player_token', { p_admin_token: adminToken, p_player_id: playerId });
  if (error) throw error;
  return data.token;
}

// ─── Matches ──────────────────────────────────────────────────────────────────
export async function getMatches(teamId) {
  const { data, error } = await supabase
    .from("matches").select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(dbToMatch);
}

// ─── Bib history ──────────────────────────────────────────────────────────────
export async function getBibHistory(teamId) {
  const { data, error } = await supabase
    .from("bib_history").select("*")
    .eq("team_id", teamId)
    .order("match_date", { ascending: false });
  if (error) throw error;
  return (data || []).map(b => ({ name: b.name, playerId: b.player_id, matchDate: b.match_date, returned: b.returned }));
}

export async function getBibStats(teamId, squadPlayers) {
  const { data, error } = await supabase
    .from("bib_history").select("*")
    .eq("team_id", teamId);
  if (error) throw error;
  const rows = data || [];
  const now  = new Date();
  const ago  = days => new Date(now - days * 86400000);

  return (squadPlayers || [])
    .filter(p => !p.disabled && !p.isGuest)
    .map(p => {
      const mine   = r => (r.player_id && r.player_id === p.id) || (!r.player_id && r.name === p.name);
      const all    = rows.filter(mine);
      const inBand = (r, fromDays, toDays) => {
        if (!r.match_date) return false;
        const d = new Date(r.match_date);
        return d >= ago(fromDays) && (toDays == null || d < ago(toDays));
      };
      return {
        id:          p.id,
        name:        p.name,
        nickname:    p.nickname,
        allTime:     all.length,
        bucket0to3:  all.filter(r => inBand(r,  90, null)).length,
        bucket3to6:  all.filter(r => inBand(r, 180,  90)).length,
        bucket6to9:  all.filter(r => inBand(r, 270, 180)).length,
        bucket9to12: all.filter(r => inBand(r, 365, 270)).length,
      };
    })
    .filter(p => p.allTime > 0)
    .sort((a, b) => b.allTime - a.allTime);
}

// ─── Schedule ─────────────────────────────────────────────────────────────────
export async function getSchedule(teamId) {
  const { data, error } = await supabase
    .from("schedule").select("*").eq("team_id", teamId).single();
  if (error && error.code !== "PGRST116") throw error;
  return data ? dbToSchedule(data) : null;
}

export async function upsertSchedule(adminToken, schedule) {
  const { error } = await supabase.rpc('admin_upsert_schedule', {
    p_admin_token:        adminToken,
    p_day_of_week:        schedule.dayOfWeek,
    p_kickoff:            schedule.kickoff,
    p_venue:              schedule.venue || null,
    p_city:               schedule.city || null,
    p_squad_size:         schedule.squadSize,
    p_price_per_player:   schedule.pricePerPlayer,
    p_bibs_enabled:       schedule.bibsEnabled ?? true,
    p_opens_day:          schedule.opensDay || null,
    p_opens_time:         schedule.opensTime || null,
    p_priority_lead_mins: schedule.priorityLeadMins || null,
    p_reminders_config:   schedule.remindersConfig || null,
    p_one_off_date:       schedule.oneOffDate || null,
    p_game_is_live:       schedule.gameIsLive ?? null,
  });
  if (error) throw error;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function getSettings(teamId) {
  const { data, error } = await supabase
    .from("settings").select("*").eq("team_id", teamId).single();
  if (error && error.code !== "PGRST116") throw error;
  return data
    ? { groupName: data.group_name, groupLabels: data.group_labels ?? {} }
    : null;
}

export async function upsertSettings(adminToken, groupName, groupLabels = null) {
  const { error } = await supabase.rpc('admin_upsert_settings', {
    p_admin_token:  adminToken,
    p_group_name:   groupName,
    p_group_labels: groupLabels,
  });
  if (error) throw error;
}

export async function saveGroupLabels(adminToken, groupName, groupLabels) {
  // Convenience wrapper — same RPC as upsertSettings, but the call site reads
  // semantically as a group-labels save. groupName is required by the RPC
  // (NOT NULL constraint server-side), so the caller threads it through.
  return upsertSettings(adminToken, groupName, groupLabels);
}

// ─── Shape converters ─────────────────────────────────────────────────────────
function playerToDb(p) {
  return {
    id: p.id, name: p.name, type: p.type,
    disabled: p.disabled, priority: p.priority,
    status: p.status, paid: p.paid, owes: p.owes,
    goals: p.goals, motm: p.motm, attended: p.attended, total: p.total,
    bib_count: p.bibCount, team: p.team,
    w: p.w, l: p.l, d: p.d,
    pay_count: p.payCount, late_dropouts: p.lateDropouts,
    note: p.note || "", self_paid: p.selfPaid || false, paid_by: p.paidBy || null,
    paid_at: p.paidAt || null,
    token: p.token,
    is_guest: p.isGuest || false,
    guest_of: p.guestOf || null,
    injured: p.injured || false,
    injured_since: p.injuredSince || null,
    nickname: p.nickname || null,
  };
}

function dbToPlayer(r) {
  return {
    id: r.id, name: r.name, type: r.type,
    disabled: r.disabled, priority: r.priority, isViceCaptain: r.is_vice_captain ?? false,
    status: r.status, paid: r.paid, owes: r.owes,
    goals: r.goals, motm: r.motm, attended: r.attended, total: r.total,
    bibCount: r.bib_count, team: r.team,
    w: r.w, l: r.l, d: r.d,
    payCount: r.pay_count, lateDropouts: r.late_dropouts,
    note: r.note || "", selfPaid: r.self_paid, paidBy: r.paid_by || null,
    paidAt: r.paid_at || null,
    token: r.token,
    isGuest: r.is_guest || false,
    guestOf: r.guest_of || null,
    hostDropoutAck: r.host_dropout_ack || false,
    pendingApproval: r.pending_approval || false,
    injured: r.injured || false,
    injuredSince: r.injured_since || null,
    nickname: r.nickname || null,
    userId: r.user_id || null,
    groupNumber: r.group_number ?? null,
    reservePriorityOrder: r.reserve_priority_order ?? null,
    adminLockedIn: r.admin_locked_in || false,
    isSelf: r.is_self ?? false,
  };
}

function matchToDb(m) {
  return {
    id: m.id, match_date: m.matchDate,
    team_a: m.teamA, team_b: m.teamB,
    winner: m.winner, score_a: m.scoreA, score_b: m.scoreB,
    scorers: m.scorers, motm: m.motm,
    bib_holder: m.bibHolder, payments: m.payments,
    cancelled: m.cancelled, cancel_reason: m.cancelReason,
    voting_open: m.votingOpen || false,
    voting_closes_at: m.votingClosesAt || null,
    vote_count: m.voteCount || 0,
    total_voters: m.totalVoters || 0,
    was_admin_decided: m.wasAdminDecided || false,
    admin_decision_pending: m.adminDecisionPending || false,
    tied_candidates: m.tiedCandidates || null,
    score_type: m.scoreType || null,
    last_goal_scorer: m.lastGoalScorer || null,
    teams_draft: m.teamsDraft ?? null,
  };
}

function dbToMatch(r) {
  return {
    id: r.id, matchDate: r.match_date,
    teamA: r.team_a || [], teamB: r.team_b || [],
    winner: r.winner, scoreA: r.score_a, scoreB: r.score_b,
    scorers: r.scorers || {}, motm: r.motm,
    bibHolder: r.bib_holder, payments: r.payments || {},
    cancelled: r.cancelled, cancelReason: r.cancel_reason,
    resultNote: r.result_note || null,
    votingOpen: r.voting_open || false,
    votingClosesAt: r.voting_closes_at || null,
    voteCount: r.vote_count || 0,
    totalVoters: r.total_voters || 0,
    wasAdminDecided: r.was_admin_decided || false,
    adminDecisionPending: r.admin_decision_pending || false,
    tiedCandidates: r.tied_candidates || null,
    scoreType: r.score_type || null,
    lastGoalScorer: r.last_goal_scorer || null,
    teamsDraft: r.teams_draft ?? null,
    teamSwitches: r.team_switches || null,
    predictedWinner: r.predicted_winner ?? null,
    predictedConfidence: r.predicted_confidence ?? null,
    balanceScore: r.balance_score ?? null,
    refPlayerId: r.ref_player_id || null,   // mig 369 casual ref slot; surfaced for the admin ref-assign toggle
    kickoffTime: r.kickoff_time || null,    // "HH:MM:SS" wall-clock; present on player-token route (to_jsonb(m.*))
    teamId: r.team_id || null,             // team_id from to_jsonb(m.*); used by PerMatchFitnessCard to key venue preference
  };
}

function scheduleToDb(s) {
  return {
    id: s.id || "main",
    day_of_week: s.dayOfWeek, kickoff: s.kickoff, venue: s.venue,
    opens_day: s.opensDay, opens_time: s.opensTime,
    priority_lead_mins: s.priorityLeadMins,
    price_per_player: s.pricePerPlayer,
    game_is_live: s.gameIsLive, squad_size: s.squadSize,
    game_date_time: s.gameDateTime,
    is_draft: s.isDraft, is_cancelled: s.isCancelled,
    cancel_reason: s.cancelReason,
    city: s.city || null,
    reminders_config: s.remindersConfig || null,
    lineup_locked: s.lineupLocked || false,
    active_match_id: s.activeMatchId || null,
    voting_open: s.votingOpen || false,
    voting_closes_at: s.votingClosesAt || null,
    bibs_enabled: s.bibsEnabled ?? true,
    season_id: s.seasonId || null,
    active: s.active ?? true,
    auto_open_pending: s.autoOpenPending ?? true,
  };
}

function dbToSchedule(r) {
  return {
    id: r.id,
    dayOfWeek: r.day_of_week, kickoff: r.kickoff, venue: r.venue,
    opensDay: r.opens_day, opensTime: r.opens_time,
    priorityLeadMins: r.priority_lead_mins,
    pricePerPlayer: r.price_per_player,
    gameIsLive: r.game_is_live, squadSize: r.squad_size,
    gameDateTime: r.game_date_time,
    isDraft: r.is_draft, isCancelled: r.is_cancelled,
    cancelReason: r.cancel_reason,
    city: r.city || null,
    remindersConfig: r.reminders_config || null,
    lineupLocked: r.lineup_locked || false,
    activeMatchId: r.active_match_id || null,
    votingOpen: r.voting_open || false,
    votingClosesAt: r.voting_closes_at || null,
    bibsEnabled: r.bibs_enabled ?? true,
    seasonId: r.season_id || null,
    active: r.active ?? true,
    autoOpenPending: r.auto_open_pending ?? true,
  };
}

// ─── Get all teams for a player ───────────────────────────────────────────────
// Returns all squads the authenticated player belongs to via player_get_teams RPC.
export async function getPlayerTeams() {
  const { data, error } = await supabase.rpc("player_get_teams");
  if (error) throw error;
  return data || [];
}

// Adopt any superadmin-created squad shells whose admin_email matches the signed-in user's
// verified email (mig 240). Idempotent + safe (only claims squads with no existing admin).
// Returns { claimed: [{team_id, name}] }. Call after sign-in; never throws fatally.
export async function claimMyAdminTeams() {
  const { data, error } = await supabase.rpc("claim_my_admin_teams");
  if (error) {
    console.error("[claim] claim_my_admin_teams failed", error);
    throw error;
  }
  return data || { claimed: [] };
}

// Token-based variant for PWA users whose auth session does not survive the
// iOS Safari→home-screen-app storage partition. Resolves the user_id from
// the supplied player token server-side. Same return shape as getPlayerTeams.
export async function getPlayerTeamsByToken(token) {
  if (!token) return [];
  const { data, error } = await supabase.rpc("player_get_teams_by_token", { p_token: token });
  if (error) throw error;
  return data || [];
}

// ─── Join team by join code ───────────────────────────────────────────────────
export async function getTeamByJoinCode(code) {
  const { data, error } = await supabase.rpc('get_team_by_join_code', { p_code: code });
  if (error || !data) return null;
  return data;
}

// ─── QR / invite_links routing layer (mig 248) ────────────────────────────────
// Resolve a scanned /q/<code> to its action + minimal destination. Read-only.
export async function resolveInviteLink(code) {
  const { data, error } = await supabase.rpc("resolve_invite_link", { p_code: code });
  if (error) { console.error('[invite] resolve failed', error); return null; }
  return data;
}

// Count a use of an invite code (call AFTER the action succeeds). Write.
export async function redeemInviteLink(code) {
  const { data, error } = await supabase.rpc("redeem_invite_link", { p_code: code });
  if (error) { console.error('[invite] redeem failed', error); throw error; }
  return data;
}

// Atomic QR check-in: marks the player IN for the fixture linked by the code (mig 253).
export async function checkinViaInvite(code, playerToken) {
  const { data, error } = await supabase.rpc("checkin_via_invite", {
    p_code:         code,
    p_player_token: playerToken,
  });
  if (error) { console.error('[invite] checkin failed', error); throw error; }
  return data;
}

// Public "what's on at this venue" for the /q/<venue_code> landing (mig 249).
export async function getVenueLanding(venueId) {
  const { data, error } = await supabase.rpc("get_venue_landing", { p_venue_id: venueId });
  if (error) { console.error('[invite] venue landing failed', error); return null; }
  return data;
}

// The reception display's venue_landing QR code+url (read-only, mig 252).
export async function getDisplayLandingCode(displayToken) {
  const { data, error } = await supabase.rpc("get_display_landing_code", { p_display_token: displayToken });
  if (error) { console.error('[invite] display landing code failed', error); return null; }
  return data;
}

// Get-or-create the canonical QR code for an entity (venue QR view, mig 251). Write.
export async function venueEnsureInviteLink(credential, entityType, entityId, action) {
  const { data, error } = await supabase.rpc("venue_ensure_invite_link", {
    p_credential:  credential,
    p_entity_type: entityType,
    p_entity_id:   entityId,
    p_action:      action,
  });
  if (error) { console.error('[invite] ensure failed', error); throw error; }
  return data;
}

// ─── invite-link management (venue dashboard slice 7, mig 254) ────────────────
// List every code the venue owns (its landing + teams' join + fixtures' check-in)
// with use_count / active / label / target_name. Read-only.
export async function venueListInviteLinks(credential) {
  const { data, error } = await supabase.rpc("venue_list_invite_links", { p_credential: credential });
  if (error) { console.error('[invite] list failed', error); throw error; }
  return data;
}

// Mint a NEW code for an entity (distinct from ensure's get-or-create). Write.
export async function venueCreateInviteLink(credential, entityType, entityId, action, label = null) {
  const { data, error } = await supabase.rpc("venue_create_invite_link", {
    p_credential:  credential,
    p_entity_type: entityType,
    p_entity_id:   entityId,
    p_action:      action,
    p_label:       label,
  });
  if (error) { console.error('[invite] create failed', error); throw error; }
  return data;
}

// Toggle a code on/off. Write.
export async function venueSetInviteLinkActive(credential, code, active) {
  const { data, error } = await supabase.rpc("venue_set_invite_link_active", {
    p_credential: credential,
    p_code:       code,
    p_active:     active,
  });
  if (error) { console.error('[invite] set-active failed', error); throw error; }
  return data;
}

// Re-point a code to a new destination (may cross entity types). Write.
export async function venueRepointInviteLink(credential, code, entityType, entityId, action) {
  const { data, error } = await supabase.rpc("venue_repoint_invite_link", {
    p_credential:  credential,
    p_code:        code,
    p_entity_type: entityType,
    p_entity_id:   entityId,
    p_action:      action,
  });
  if (error) { console.error('[invite] repoint failed', error); throw error; }
  return data;
}

export async function getTeamStateByPlayerToken(token) {
  const { data, error } = await supabase.rpc('get_team_state_by_player_token', { p_token: token });
  if (error || !data) return null;
  return {
    teamId:         data.team_id || data.schedule?.team_id || null,
    player:         dbToPlayer({ ...data.player, token }),
    squad:          (data.squad || []).map(dbToPlayer),
    schedule:       data.schedule ? dbToSchedule(data.schedule) : null,
    matches:        (data.matches || []).map(dbToMatch),
    bibHistory:     (data.bib_history || []).map(b => ({ name: b.name, playerId: b.player_id, matchDate: b.match_date, returned: b.returned })),
    settings:       data.settings ? {
      groupName:   data.settings.group_name,
      groupLabels: data.settings.group_labels ?? {},
      // join_code (mig 483) — non-sensitive public invite code, powers the
      // WhatsApp share-sheet /join CTA on My View. Nested under settings so
      // PlayerView keeps its existing settings?. access pattern.
      joinCode:    data.settings.join_code ?? null,
    } : null,
    coverPool:      data.cover_pool || [],
    liveChannelKey: data.live_channel_key,
    // Context descriptor fields (mig 349) — drives deriveContext()
    teamType:       data.team_type ?? null,
    isCompetitive:  data.is_competitive ?? false,
    clubId:         data.club_id ?? null,
    clubName:       data.club_name ?? null,
    stats: data.stats ? {
      matchStats: {
        games:    data.stats.match_stats?.games    || 0,
        goals:    data.stats.match_stats?.goals    || 0,
        motm:     data.stats.match_stats?.motm     || 0,
        wins:     data.stats.match_stats?.wins     || 0,
        losses:   data.stats.match_stats?.losses   || 0,
        draws:    data.stats.match_stats?.draws    || 0,
        attended: data.stats.match_stats?.attended || 0,
        bibs:     data.stats.match_stats?.bibs     || 0,
      },
      winRate: {
        played:  data.stats.win_rate?.played  || 0,
        wins:    data.stats.win_rate?.wins    || 0,
        draws:   data.stats.win_rate?.draws   || 0,
        losses:  data.stats.win_rate?.losses  || 0,
        winRate: data.stats.win_rate?.played > 0
          ? Math.round((data.stats.win_rate.wins /
              data.stats.win_rate.played) * 100)
          : 0,
      },
      currentRun: (() => {
        const run = data.stats.current_run;
        if (!run || !run.length) return null;
        const first = run[0];
        let len = 0;
        for (const r of run) {
          if (first === 'l') {
            if (r !== 'l') break;
          } else {
            if (r === 'l') break;
          }
          len++;
        }
        return len >= 2
          ? { type: first === 'l' ? 'losing' : 'unbeaten', length: len }
          : null;
      })(),
      reliability: (() => {
        const r = data.stats.reliability;
        if (!r || !r.totalGames) return null;
        return Math.round((r.attended / r.totalGames) * 100);
      })(),
      leagueRaw:          data.stats.league_raw || [],
      ledger:             (data.stats.ledger || []).map(dbToLedger),
      outstandingBalance: data.stats.outstanding_balance ?? 0,
      lastMatchMeta: data.stats.last_match_meta ? {
        motm:      data.stats.last_match_meta.motm || null,
        bibHolder: data.stats.last_match_meta.bib_holder || null,
        matchDate: data.stats.last_match_meta.match_date || null,
      } : null,
      playerForm:         data.stats.player_form || [],
    } : null,
  };
}

export async function getTeamStateByAdminToken(token) {
  const { data, error } = await supabase.rpc('get_team_state_by_admin_token', { p_admin_token: token });
  if (error || !data) return null;
  return {
    teamId:         data.team?.id || null,
    team:           data.team || null,
    squad:          (data.squad || []).map(dbToPlayer),
    schedule:       data.schedule ? dbToSchedule(data.schedule) : null,
    matches:        (data.matches || []).map(dbToMatch),
    bibHistory:     (data.bib_history || []).map(b => ({ name: b.name, playerId: b.player_id, matchDate: b.match_date, returned: b.returned })),
    settings:       data.settings ? {
      groupName:   data.settings.group_name,
      groupLabels: data.settings.group_labels ?? {},
      // join_code for the My View share CTA — the admin RPC already returns it
      // on the team object (mig 349), so no RPC change is needed here; we just
      // surface it under settings to match the player-token mapper's shape so
      // PlayerView's settings?.joinCode works on the /admin route too.
      joinCode:    data.team?.join_code ?? null,
    } : null,
    coverPool:      data.cover_pool || [],
    liveChannelKey: data.live_channel_key,
    // Context descriptor fields (mig 349) — drives deriveContext()
    teamType:       data.team_type ?? null,
    isCompetitive:  data.is_competitive ?? false,
    clubId:         data.club_id ?? null,
    clubName:       data.club_name ?? null,
  };
}

export async function createTeam(params) {
  const { data, error } = await supabase.rpc('create_team', {
    p_admin_email:        params.adminEmail ?? null,
    p_team_name:          params.teamName,
    p_day_of_week:        params.dayOfWeek,
    p_kickoff:            params.kickoff,
    p_squad_size:         params.squadSize,
    p_venue:              params.venue ?? null,
    p_city:               params.city ?? null,
    p_price:              params.price ?? 0,
    p_bibs_enabled:       params.bibsEnabled ?? true,
    p_player_names:       params.playerNames ?? [],
    p_opens_day:          params.opensDay ?? null,
    p_opens_time:         params.opensTime ?? null,
    p_priority_lead_mins: params.priorityLeadMins ?? null,
    p_team_type:          params.teamType ?? 'casual',
  });
  if (error) throw error;
  return data;
}

export async function addPlayerToTeam(adminToken, name, type = 'regular', priority = false) {
  const { data, error } = await supabase.rpc('admin_add_player', {
    p_admin_token: adminToken,
    p_name:        name.trim(),
    p_type:        type,
    p_priority:    priority,
  });
  if (error) throw error;
  return dbToPlayer(data);
}

// ─── Guest players ────────────────────────────────────────────────────────────
// adminToken: pass the admin token when an admin adds a guest from an /admin
// route — the guest is approved straight in. Player-added guests (no admin
// token) enter pending_approval and take no squad spot until an admin approves.
export async function addGuestPlayer(hostToken, guestName, adminToken = null) {
  const { data, error } = await supabase.rpc('add_guest_player', {
    p_token:       hostToken,
    p_guest_name:  guestName,
    p_admin_token: adminToken,
  });
  if (error) throw error;
  return dbToPlayer(data);
}

// Admin approves a pending plus-one. Squad-full → guest placed on reserve,
// otherwise in. Returns the updated guest (mapped).
export async function adminApproveGuest(adminToken, guestId) {
  const { data, error } = await supabase.rpc('admin_approve_guest', {
    p_admin_token: adminToken,
    p_guest_id:    guestId,
  });
  if (error) throw error;
  return dbToPlayer(data);
}

// Admin declines a pending plus-one → guest goes dormant (recoverable).
export async function adminDeclineGuest(adminToken, guestId) {
  const { data, error } = await supabase.rpc('admin_decline_guest', {
    p_admin_token: adminToken,
    p_guest_id:    guestId,
  });
  if (error) throw error;
  return data;
}

export async function removeGuestPlayer(hostToken, guestId) {
  const { data, error } = await supabase.rpc('remove_guest_player', {
    p_token:    hostToken,
    p_guest_id: guestId,
  });
  if (error) throw error;
  return data;
}

// Persistent guests S2: bring back a dormant team guest, re-attached to this host.
// Returns the now-active guest (mapped) so the caller can swap the dormant row.
export async function reactivateGuestPlayer(hostToken, guestId) {
  const { data, error } = await supabase.rpc('reactivate_guest_player', {
    p_token:    hostToken,
    p_guest_id: guestId,
  });
  if (error) throw error;
  return dbToPlayer(data);
}

// Persistent guests S3: admin promotes a guest to a permanent member (same row,
// history kept). Returns the updated (now non-guest) player, mapped.
export async function promoteGuest(adminToken, guestId) {
  const { data, error } = await supabase.rpc('admin_promote_guest', {
    p_admin_token: adminToken,
    p_guest_id:    guestId,
  });
  if (error) throw error;
  return dbToPlayer(data);
}

// Admin "Keep IN" on an orphaned guest (host dropped out): persist the decision
// so the AdminView banner stops reappearing on reload. Per-week — reset on the
// next weekly rollover (admin_go_live). Guest stays linked to its host.
export async function ackOrphanGuest(adminToken, guestId) {
  const { data, error } = await supabase.rpc('admin_ack_orphan_guest', {
    p_admin_token: adminToken,
    p_guest_id:    guestId,
  });
  if (error) throw error;
  return data;
}

// ─── Cover pool ───────────────────────────────────────────────────────────────
export async function getCoverPool(teamId) {
  const { data, error } = await supabase
    .from("cover_pool").select("*")
    .eq("team_id", teamId)
    .order("created_at");
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id, name: r.name, played: r.played, owes: r.owes,
  }));
}

// ─── Push subscriptions ───────────────────────────────────────────────────────
// platform: 'web' (browser/PWA VAPID sub, default) | 'ios' | 'android' (native
// APNs/FCM device token). For native, `subscription` is { token: '<device>' }.
export async function savePushSubscription(playerToken, subscription, platform = 'web') {
  const { error } = await supabase.rpc('register_push_subscription', {
    p_token:        playerToken,
    p_subscription: subscription,
    p_platform:     platform,
  });
  if (error) throw error;
}

// Server truth for "does this player already have a push subscription?" — used
// to suppress the casual opt-in banner when a token is already on file (any
// platform), independent of the client-side localStorage flag. Read-only,
// token-scoped (mig 514). Returns a bare boolean.
export async function playerHasPushSubscription(playerToken) {
  const { data, error } = await supabase.rpc('player_has_push_subscription', {
    p_token: playerToken,
  });
  if (error) throw error;
  return data?.subscribed === true;
}

// Member (club manager / member) push — keyed on auth.uid() not a player token
// (mig 422). Same subscription shapes as savePushSubscription. Authenticated only.
export async function saveMemberPushSubscription(subscription, platform = 'web') {
  const { error } = await supabase.rpc('register_member_push_subscription', {
    p_subscription: subscription,
    p_platform:     platform,
  });
  if (error) throw error;
}

// platform null = remove every platform for the signed-in member ("turn off").
export async function removeMemberPushSubscription(platform = null) {
  const { error } = await supabase.rpc('unregister_member_push_subscription', {
    p_platform: platform,
  });
  if (error) throw error;
}

// ─── Notification log ─────────────────────────────────────────────────────────
export async function alreadyNotified(teamId, type, gameDate) {
  const { data } = await supabase
    .from("notification_log")
    .select("id")
    .eq("team_id", teamId)
    .eq("type", type)
    .eq("game_date", gameDate)
    .not("sent_at", "is", null)
    .limit(1);
  return (data?.length || 0) > 0;
}

export async function getRecentNotification(teamId, type, gameDate, withinMinutes) {
  try {
    const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('notification_log')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('type', type)
      .eq('game_date', gameDate)
      .gte('sent_at', cutoff);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}


// ─── Player form (last 5 results per player for teams tile) ───────────────────
export async function getPlayerMatchForm(teamId, playerIds) {
  if (!playerIds.length) return {};
  const { data, error } = await supabase
    .from("player_match")
    .select("player_id, result, created_at")
    .eq("team_id", teamId)
    .in("player_id", playerIds)
    .order("created_at", { ascending: false });
  if (error) return {};
  const form = {};
  (data || []).forEach(row => {
    if (!form[row.player_id]) form[row.player_id] = [];
    if (form[row.player_id].length < 5) form[row.player_id].push(row.result);
  });
  return form;
}

// ─── Last match meta (MOTM + bib holder for teams tile) ──────────────────────
// bib_holder stores player_id post-migration; falls back to raw value for legacy name strings.
export function resolveBibHolder(bibValue, players) {
  if (!bibValue) return null;
  const match = (players || []).find(p => p.id === bibValue);
  if (match) return match.nickname || match.name;
  return bibValue;
}

export async function getLastMatchMeta(teamId) {
  const { data, error } = await supabase
    .from("matches")
    .select("motm, bib_holder, match_date")
    .eq("team_id", teamId)
    .eq("cancelled", false)
    .not("winner", "is", null);
  if (error || !data?.length) return null;
  const sorted = [...data].sort((a, b) => new Date(b.match_date) - new Date(a.match_date));
  const match = sorted[0];
  return { motm: match.motm || null, bibHolder: match.bib_holder || null };
}

// ─── Matches (update bib holder after result saved) ───────────────────────────
export async function updateMatchBibHolder(matchId, bibHolder) {
  const { error } = await supabase
    .from("matches")
    .update({ bib_holder: bibHolder })
    .eq("id", matchId);
  if (error) throw error;
}

export async function saveMatchResult(adminToken, match) {
  const { error } = await supabase.rpc('admin_save_match_result', {
    p_admin_token:      adminToken,
    p_match_id:         match.id || null,
    p_score_type:       match.scoreType || 'exact',
    p_score_a:          match.scoreA ?? null,
    p_score_b:          match.scoreB ?? null,
    p_winner:           match.winner || null,
    p_margin:           match.margin ?? null,
    p_team_a:           match.teamA || [],
    p_team_b:           match.teamB || [],
    p_scorers:          match.scorers || {},
    p_motm:             match.motm || null,
    p_last_goal_scorer: match.lastGoalScorer || null,
    p_bib_holder:       match.bibHolder || null,
    p_team_switches:    match.teamSwitches || null,
    p_result_note:      match.resultNote ?? null,
  });
  if (error) throw error;
}

export async function saveBibHolder(adminToken, matchId, playerId) {
  const { error } = await supabase.rpc('admin_save_bib_holder', {
    p_admin_token: adminToken,
    p_match_id:    matchId,
    p_player_id:   playerId || null,
  });
  if (error) throw error;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Telemetry — one row per app boot in audit_events. Fire-and-forget,
// never throws (server-side swallows; this wrapper double-protects).
export async function logAppBoot(token, routeType, displayMode, sessionPresent) {
  try {
    await supabase.rpc('log_app_boot', {
      p_token:           token || null,
      p_route_type:      routeType || 'unknown',
      p_display_mode:    displayMode || 'unknown',
      p_session_present: !!sessionPresent
    });
  } catch (e) {
    // Telemetry must never break boot. Swallow.
  }
}

// Link an existing player record to an auth user
export async function linkPlayerToUser(token) {
  const { error } = await supabase.rpc('link_player_to_user', { p_token: token });
  if (error) throw error;
}

export async function playerJoinTeam(teamId, name) {
  const { data, error } = await supabase.rpc('player_join_team', {
    p_team_id: teamId,
    p_name: name.trim()
  });
  if (error) throw error;
  return dbToPlayer(data);
}

// ─── Player injuries ──────────────────────────────────────────────────────────
export async function insertPlayerInjury(adminToken, playerId) {
  const { error } = await supabase.rpc('admin_set_player_injured', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_injured:     true,
  });
  if (error) throw error;
}

export async function clearPlayerInjury(adminToken, playerId) {
  const { error } = await supabase.rpc('admin_set_player_injured', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_injured:     false,
  });
  if (error) throw error;
}

export async function getPlayerInjuries(playerId) {
  const { data, error } = await supabase
    .from("player_injuries").select("*")
    .eq("player_id", playerId)
    .order("injured_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Player-token-authed read of own injury history (PlayerProfile player mode).
export async function getMyInjuries(token) {
  const { data, error } = await supabase.rpc('get_my_injuries', {
    p_token: token,
  });
  if (error) throw error;
  return data || [];
}

// Player-token-authed read of own payment ledger (PlayerProfile player mode).
export async function getMyPaymentHistory(token, limit = 50) {
  const { data, error } = await supabase.rpc('get_my_payment_history', {
    p_token: token,
    p_limit: limit,
  });
  if (error) throw error;
  return (data || []).map(dbToLedger);
}

// Authenticated unified money view (mig 404, Phase 2). One auth.uid()-scoped read
// aggregating the signed-in human's whole money picture: own + guardian memberships
// (with paid/owed ledger charges, pence) and casual match fees (payment_ledger,
// whole-pounds — returned in a separate array, never summed across streams). Casual
// rows use the same shape as getMyPaymentHistory so dbToLedger maps them unchanged.
export async function getMyMoney() {
  const { data, error } = await supabase.rpc('get_my_money');
  if (error) throw error;
  return {
    ok: !!data?.ok,
    personId: data?.person_id || null,
    profileId: data?.profile_id || null,
    memberships: data?.memberships || [],
    charges: data?.charges || [],
    casual: (data?.casual || []).map(dbToLedger),
    summary: data?.summary || { owed_pence: 0, paid_count: 0, upcoming_count: 0 },
  };
}

// Soft-remove self from current squad. Throws { code: 'debt_owed', owes }
// if the player has outstanding debt.
export async function leaveSquad(token) {
  const { data, error } = await supabase.rpc('leave_squad', { p_token: token });
  if (error) {
    const msg = error.message || '';
    if (msg.startsWith('debt_owed:')) {
      const owes = Number(msg.slice('debt_owed:'.length));
      const e = new Error('debt_owed'); e.code = 'debt_owed'; e.owes = owes;
      throw e;
    }
    throw error;
  }
  return data;
}

// Hard-delete account via edge function (RPC anonymise + auth deletion).
// Throws { code: 'last_admin', teamIds: [...] } when blocked by the
// last-admin guard.
export async function deleteMyAccount(token) {
  const res = await fetch("/api/delete-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body?.error === 'last_admin') {
      const e = new Error('last_admin'); e.code = 'last_admin'; e.teamIds = body.teamIds || [];
      throw e;
    }
    const e = new Error(body?.error || 'delete_failed');
    e.code = body?.error || 'delete_failed';
    throw e;
  }
  // Clear any live Supabase auth session so a signed-in player who deletes via the
  // token path (PlayerProfile) isn't left logged in against a now-anonymised row
  // (matches the authenticated deleteMyAccountAuth path). No-op for a pure-anon player.
  try { await supabase.auth.signOut(); } catch (e) { console.error(e); }
  return body;
}

// Authenticated account deletion (no token) — for a signed-in user who has no
// player token (a fresh Sign-in-with-Apple identity, or a club-member-only
// account). delete_my_account_auth() (mig 370) anonymises any linked player +
// member_profile PII and removes the user_profile via auth.uid(); then the
// service-role API deletes the auth.users row, verifying identity from the
// caller's own access token (never a client-supplied id). Throws
// { code:'last_admin', teamIds } when blocked by the last-admin guard.
export async function deleteMyAccountAuth() {
  const { data, error } = await supabase.rpc('delete_my_account_auth');
  if (error) {
    const msg = error.message || '';
    if (msg.startsWith('last_admin:')) {
      const e = new Error('last_admin');
      e.code = 'last_admin';
      e.teamIds = msg.slice('last_admin:'.length).split(',').filter(Boolean);
      throw e;
    }
    const e = new Error(msg || 'delete_failed');
    e.code = msg || 'delete_failed';
    throw e;
  }
  // Data is anonymised. Delete the auth.users row server-side (service role).
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess?.session?.access_token;
  try {
    await fetch('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
  } catch (e) {
    console.error('[deleteMyAccountAuth] auth-row delete request failed', e);
  }
  try { await supabase.auth.signOut(); } catch (e) { console.error(e); }
  return data;
}

// ─── Demo data helpers ────────────────────────────────────────────────────────
// Current-week response spread for the demo squad (p_demo_01..25), so the App-Store
// reviewer's demo links show a live, populated game. Squad cap is 10; 8 confirmed +
// Alex = 9 (1 spot left), plus maybes/outs and the rest no-response.
const DEMO_WEEK_STATUS = {
  p_demo_01: 'in',    p_demo_02: 'in',    p_demo_03: 'in',    p_demo_04: 'in',
  p_demo_05: 'in',    p_demo_06: 'in',    p_demo_07: 'in',    p_demo_08: 'in',
  p_demo_09: 'maybe', p_demo_10: 'maybe', p_demo_11: 'out',   p_demo_12: 'out',
};
const DEMO_WEEK_PAID = new Set(['p_demo_01', 'p_demo_02', 'p_demo_03', 'p_demo_04', 'p_demo_05', 'p_demo_06']);

const DEMO_BASELINE = [
  { id:"p_demo_01", goals:18, motm:6, attended:20, w:13, l:5, d:2, bib_count:2, pay_count:20, late_dropouts:1, owes:0, injured:false },
  { id:"p_demo_02", goals:8,  motm:9, attended:19, w:12, l:5, d:2, bib_count:3, pay_count:18, late_dropouts:2, owes:0, injured:false },
  { id:"p_demo_03", goals:6,  motm:3, attended:18, w:11, l:5, d:2, bib_count:8, pay_count:16, late_dropouts:3, owes:0, injured:false },
  { id:"p_demo_04", goals:4,  motm:2, attended:22, w:14, l:6, d:2, bib_count:1, pay_count:22, late_dropouts:0, owes:0, injured:false },
  { id:"p_demo_05", goals:3,  motm:1, attended:12, w:7,  l:3, d:2, bib_count:1, pay_count:10, late_dropouts:5, owes:0, injured:false },
  { id:"p_demo_06", goals:5,  motm:1, attended:16, w:10, l:4, d:2, bib_count:2, pay_count:12, late_dropouts:7, owes:0, injured:false },
  { id:"p_demo_07", goals:3,  motm:2, attended:20, w:13, l:5, d:2, bib_count:3, pay_count:19, late_dropouts:1, owes:0, injured:false },
  { id:"p_demo_08", goals:4,  motm:1, attended:17, w:10, l:5, d:2, bib_count:2, pay_count:10, late_dropouts:3, owes:15, injured:false },
  { id:"p_demo_09", goals:7,  motm:3, attended:15, w:8,  l:5, d:2, bib_count:2, pay_count:14, late_dropouts:2, owes:0, injured:false },
  { id:"p_demo_10", goals:0,  motm:0, attended:22, w:14, l:6, d:2, bib_count:4, pay_count:22, late_dropouts:0, owes:0, injured:false },
  { id:"p_demo_11", goals:2,  motm:0, attended:10, w:6,  l:3, d:1, bib_count:1, pay_count:10, late_dropouts:1, owes:0, injured:false },
  { id:"p_demo_12", goals:4,  motm:1, attended:8,  w:5,  l:2, d:1, bib_count:1, pay_count:8,  late_dropouts:0, owes:0, injured:false },
  { id:"p_demo_13", goals:3,  motm:1, attended:14, w:9,  l:4, d:1, bib_count:2, pay_count:13, late_dropouts:2, owes:0, injured:false },
  { id:"p_demo_14", goals:1,  motm:0, attended:8,  w:5,  l:2, d:1, bib_count:0, pay_count:6,  late_dropouts:1, owes:0, injured:false },
  { id:"p_demo_15", goals:11, motm:4, attended:18, w:11, l:5, d:2, bib_count:2, pay_count:17, late_dropouts:1, owes:0, injured:false },
  { id:"p_demo_16", goals:6,  motm:2, attended:20, w:13, l:5, d:2, bib_count:1, pay_count:20, late_dropouts:0, owes:0, injured:false },
  { id:"p_demo_17", goals:5,  motm:2, attended:14, w:8,  l:4, d:2, bib_count:2, pay_count:12, late_dropouts:3, owes:0, injured:false },
  { id:"p_demo_18", goals:3,  motm:1, attended:13, w:8,  l:3, d:2, bib_count:1, pay_count:10, late_dropouts:5, owes:0, injured:false },
  { id:"p_demo_19", goals:14, motm:3, attended:16, w:10, l:4, d:2, bib_count:1, pay_count:15, late_dropouts:1, owes:0, injured:false },
  { id:"p_demo_20", goals:7,  motm:2, attended:18, w:12, l:4, d:2, bib_count:2, pay_count:17, late_dropouts:1, owes:0, injured:false },
  { id:"p_demo_21", goals:5,  motm:2, attended:17, w:10, l:5, d:2, bib_count:3, pay_count:16, late_dropouts:2, owes:0, injured:false },
  { id:"p_demo_22", goals:4,  motm:1, attended:16, w:11, l:3, d:2, bib_count:2, pay_count:15, late_dropouts:1, owes:0, injured:false },
  { id:"p_demo_23", goals:3,  motm:1, attended:19, w:12, l:5, d:2, bib_count:1, pay_count:19, late_dropouts:0, owes:0, injured:false },
  { id:"p_demo_24", goals:4,  motm:1, attended:11, w:7,  l:3, d:1, bib_count:1, pay_count:10, late_dropouts:2, owes:0, injured:false },
  { id:"p_demo_25", goals:6,  motm:2, attended:18, w:11, l:5, d:2, bib_count:1, pay_count:18, late_dropouts:1, owes:0, injured:false },
];

// [matchId, winner, teamA_nums[], teamB_nums[], {scorer_num:goals}, motm_num, bib_num]
// Nums: Hassan=1,Dave=2,Mike=3,Steve=4,Jordan=5,Liam=6,Callum=7,Chris=8,Robbie=9,
//       Finbar=10,Paul=11,Tom=12,Kieran=13,Declan=14,Sarah=15,Priya=16,Maya=17,
//       Aisha=18,Marcus=19,Danny=20,Ryan=21,Aaron=22,Luke=23,Gav=24,Tarny=25
const DEMO_MATCH_DATA = [
  ['m_demo_01','A',[1,20,4,10,15,16,7],[2,3,23,25,13,21,9],{1:2,20:1,15:1,2:1,21:1},1,3],
  ['m_demo_02','A',[2,4,10,19,13,22,23],[1,20,7,3,16,25,21],{2:2,19:1,1:1,20:1},2,3],
  ['m_demo_03','A',[1,20,4,10,19,15,16],[2,3,7,23,25,21,5],{1:2,19:2,15:1,2:1,21:1},19,3],
  ['m_demo_04','B',[1,20,4,10,16,6,7],[2,3,23,25,13,11,21],{1:1,20:1,2:2,21:1},2,23],
  ['m_demo_05','A',[1,20,4,10,16,24,15],[2,3,7,23,25,13,21],{1:2,20:1,15:1,2:1},1,3],
  ['m_demo_06','B',[2,4,10,9,22,23,25],[1,20,7,3,16,15,21],{22:1,1:1,20:1,15:2},15,7],
  ['m_demo_07','A',[2,1,4,10,19,24,16],[3,20,7,23,25,21,13],{2:2,1:1,19:1,3:1,21:1},2,3],
  ['m_demo_09','A',[2,4,10,3,12,23,25],[1,20,7,16,15,5,21],{2:2,3:1,1:1,20:1},2,10],
  ['m_demo_10','A',[1,20,4,10,19,16,13],[2,3,7,23,25,21,18],{1:2,19:2,2:1},1,3],
  ['m_demo_11','A',[1,20,4,10,15,16,8],[2,3,7,23,25,21,14],{1:1,20:2,2:1,21:1},20,3],
  ['m_demo_12','A',[2,4,10,19,24,22,23],[1,20,7,3,16,25,21],{2:2,19:1,1:1,21:1},2,2],
  ['m_demo_13','A',[1,20,4,10,15,16,13],[2,3,7,23,25,21,9],{1:2,20:1,15:1,2:1,9:1},1,25],
  ['m_demo_14','A',[1,20,4,10,15,16,11],[2,3,7,23,25,21,6],{15:2,1:1,2:1},15,4],
  ['m_demo_16','A',[2,4,10,19,13,22,23],[1,20,7,3,16,25,21],{2:2,19:2,1:2,20:1},2,16],
  ['m_demo_17','A',[1,20,4,10,19,16,13],[2,3,7,24,23,25,21],{19:3,1:1,20:1,2:2,21:1},19,23],
  ['m_demo_18','A',[1,20,4,10,15,16,13],[2,3,7,23,25,21,9],{1:3,15:1,2:1,21:1},1,7],
  ['m_demo_19','B',[1,20,4,10,19,16,13],[2,3,7,22,23,25,21],{1:2,20:1,3:2,2:1,21:1},3,3],
  ['m_demo_20','A',[2,4,10,9,24,23,25],[1,20,7,3,16,15,21],{2:3,9:1,1:1,15:1},2,9],
  ['m_demo_21','A',[1,20,4,10,15,16,19],[2,3,7,23,25,21,22],{20:2,1:1,15:1,2:1,3:1},20,10],
  ['m_demo_22','A',[1,20,4,10,15,16,14],[2,3,7,24,23,25,21],{15:2,1:1,2:1,3:1},15,25],
];

export async function resetDemoData() {
  const pid = n => `p_demo_${String(n).padStart(2, '0')}`;

  // 1. Delete and re-insert player_match rows
  await supabase.from('player_match').delete().eq('team_id', 'team_demo');
  const pmRows = [];
  for (const [mid, winner, ta, tb, scorers, motm, bib] of DEMO_MATCH_DATA) {
    const push = (ids, side) => ids.forEach(n => pmRows.push({
      team_id: 'team_demo', match_id: mid, player_id: pid(n),
      team_assignment: side,
      result: winner === 'D' ? 'd' : (side === winner ? 'w' : 'l'),
      attended: true, was_motm: n === motm, had_bibs: n === bib,
      goals: scorers[n] || 0, is_guest: false, late_cancel: false, injury_absence: false,
    }));
    push(ta, 'A');
    push(tb, 'B');
  }
  for (let i = 0; i < pmRows.length; i += 50)
    await supabase.from('player_match').insert(pmRows.slice(i, i + 50));

  // 2. Delete and re-insert Gav's injury history
  await supabase.from('player_injuries').delete().eq('team_id', 'team_demo');
  await supabase.from('player_injuries').insert([
    { id:'inj_demo_01', player_id:'p_demo_24', team_id:'team_demo', injured_at:'2025-09-28', cleared_at:'2025-10-12', marked_by:'player' },
    { id:'inj_demo_02', player_id:'p_demo_24', team_id:'team_demo', injured_at:'2025-11-16', cleared_at:'2025-11-30', marked_by:'player' },
    { id:'inj_demo_03', player_id:'p_demo_24', team_id:'team_demo', injured_at:'2026-01-11', cleared_at:'2026-02-01', marked_by:'admin' },
    { id:'inj_demo_04', player_id:'p_demo_24', team_id:'team_demo', injured_at:'2026-03-22', cleared_at:'2026-04-06', marked_by:'player' },
  ]);

  // 3. Remove any guest players added to team_demo during a demo session
  const { data: tpRows } = await supabase
    .from('team_players').select('player_id').eq('team_id', 'team_demo');
  if (tpRows?.length) {
    const allIds = tpRows.map(r => r.player_id);
    const { data: guests } = await supabase
      .from('players').select('id').in('id', allIds).eq('is_guest', true);
    if (guests?.length) {
      const guestIds = guests.map(g => g.id);
      await supabase.from('team_players').delete()
        .eq('team_id', 'team_demo').in('player_id', guestIds);
      await supabase.from('players').delete().in('id', guestIds);
    }
  }

  // 4. Remove any extra matches added during the demo
  await supabase.from('matches').delete()
    .eq('team_id', 'team_demo')
    .not('id', 'like', 'm_demo_%');

  // 5. Reset each player to baseline stats. A realistic CURRENT-WEEK response
  //    spread (DEMO_WEEK_STATUS / DEMO_WEEK_PAID) is applied so the demo links the
  //    App-Store reviewer opens (/demoadmin + /p/) show a LIVE, populated game — not
  //    an empty "sign-ups not open" board. Anyone not in the spread stays 'none'.
  for (const p of DEMO_BASELINE) {
    const status = DEMO_WEEK_STATUS[p.id] || 'none';
    const paid = DEMO_WEEK_PAID.has(p.id);
    await supabase.from('players').update({
      status, paid, self_paid: false, paid_by: null,
      owes: p.owes, note: null, injured: false, injured_since: null,
      nickname: null,
      goals: p.goals, motm: p.motm, attended: p.attended,
      w: p.w, l: p.l, d: p.d, bib_count: p.bib_count,
      pay_count: p.pay_count, late_dropouts: p.late_dropouts,
    }).eq('id', p.id);
  }
  // Alex (the reviewer's player link, not in DEMO_BASELINE) — confirmed + paid so
  // /p/p_demo_alex_token shows the live In/Out grid in a positive state.
  await supabase.from('players')
    .update({ status: 'in', paid: true, injured: false })
    .eq('id', 'p_demo_alex');

  // 6. Reset schedule voting state + make THIS week's game live (so the In/Out grid
  //    and a populated Live Board show on the demo links, not the "sign-ups closed" card).
  await supabase.from('schedule')
    .update({ voting_open: false, voting_closes_at: null, game_is_live: true, is_cancelled: false })
    .eq('team_id', 'team_demo');

  // 7. Stamp reset time
  await supabase.from('demo_sessions')
    .update({ last_reset: new Date().toISOString(), last_interaction: new Date().toISOString() })
    .eq('id', 'main');
}

export async function updateDemoInteraction() {
  await supabase.rpc('update_demo_interaction', { p_session_id: 'main' });
}

// ─── POTM Voting ──────────────────────────────────────────────────────────────

export async function submitPOTMVote(token, matchId, teamId, nomineeId) {
  const { data, error } = await supabase.rpc('submit_potm_vote', {
    p_token:      token,
    p_match_id:   matchId,
    p_team_id:    teamId,
    p_nominee_id: nomineeId,
  });
  if (error) throw error;
  return data;
}

export async function getPOTMVotingState(token, matchId, teamId) {
  const { data, error } = await supabase.rpc('get_potm_voting_state', {
    p_token:    token,
    p_match_id: matchId,
    p_team_id:  teamId,
  });
  if (error) throw error;
  return {
    eligible:     data.eligible      || [],
    existingVote: data.existing_vote || null,
    votes:        data.votes         || [],
    voterId:      data.voter_id      || null,
  };
}

// Running POTM tally for players — counts only, NEVER voter identities.
// Server-gated: returns { voted: false } until the caller has cast their own
// vote for this match; once voted, { voted: true, tally: [{nominee_id, votes}]
// sorted winner-first, total_votes }. Backed by mig 242 get_potm_tally_public.
export async function getPOTMTallyPublic(token, matchId, teamId) {
  const { data, error } = await supabase.rpc('get_potm_tally_public', {
    p_token:    token,
    p_match_id: matchId,
    p_team_id:  teamId,
  });
  if (error) throw error;
  return {
    voted:      !!data?.voted,
    tally:      data?.tally       || [],
    totalVotes: data?.total_votes || 0,
  };
}

// Deprecated — use getPOTMVotingState instead.
// Will be removed once PlayerView is updated.
export async function getPOTMVotes(matchId) {
  const { data, error } = await supabase
    .from("potm_votes")
    .select("voter_id, nominee_id")
    .eq("match_id", matchId);
  if (error) throw error;
  return data || [];
}

// Deprecated — use getPOTMVotingState instead.
// Will be removed once PlayerView is updated.
export async function getPOTMEligiblePlayers(matchId, teamId) {
  const { data: pmRows, error: pmErr } = await supabase
    .from("player_match")
    .select("player_id, team_assignment")
    .eq("match_id", matchId)
    .eq("team_id", teamId)
    .eq("attended", true)
    .eq("is_guest", false);
  if (pmErr) throw pmErr;
  if (!pmRows?.length) return [];

  const playerIds = pmRows.map(r => r.player_id);
  const { data: players, error: plErr } = await supabase
    .from("players")
    .select("id, name, nickname")
    .in("id", playerIds);
  if (plErr) throw plErr;

  const byId = Object.fromEntries((players || []).map(p => [p.id, p]));
  return pmRows.map(r => ({
    id: r.player_id,
    name: byId[r.player_id]?.name || r.player_id,
    nickname: byId[r.player_id]?.nickname || null,
    team: r.team_assignment,
  }));
}

export async function closePOTMVoting(adminToken, matchId, winnerId, wasAdminDecided = false) {
  const { error } = await supabase.rpc('admin_close_potm_voting', {
    p_admin_token:       adminToken,
    p_match_id:          matchId,
    p_winner_id:         winnerId,
    p_was_admin_decided: wasAdminDecided,
  });
  if (error) throw error;
}


export async function getTeamPlayerNames(teamId) {
  const { data: tpRows } = await supabase
    .from("team_players").select("player_id").eq("team_id", teamId);
  const ids = (tpRows || []).map(r => r.player_id);
  if (!ids.length) return [];
  const { data } = await supabase
    .from("players").select("id, name, nickname").in("id", ids);
  return data || [];
}

export async function setPlayerNickname(adminToken, playerId, nickname) {
  const { error } = await supabase.rpc('admin_update_player_name', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_name:        null,
    p_nickname:    nickname ? nickname.trim() : '',
  });
  if (error) throw error;
}

// Player editing their OWN nickname from My View (token-authenticated).
// Distinct from setPlayerNickname (admin-only). Throws an error whose .code
// is 'nickname_taken' when another teammate already uses that nickname.
export async function setMyNickname(token, nickname) {
  const { error } = await supabase.rpc('set_my_nickname', {
    p_token:    token,
    p_nickname: nickname ? nickname.trim() : '',
  });
  if (error) {
    const e = new Error(error.message || 'set_my_nickname failed');
    e.code = error.message;
    throw e;
  }
}

export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data || null;
}

export async function updateUserProfile(userId, updates) {
  const { error } = await supabase
    .from("user_profiles")
    .upsert({ user_id: userId, ...updates, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

// ─── Payment ledger ───────────────────────────────────────────────────────────

function dbToLedger(r) {
  return {
    id:        r.id,
    teamId:    r.team_id,
    playerId:  r.player_id,
    matchId:   r.match_id,
    amount:    r.amount,
    type:      r.type,
    status:    r.status,
    method:    r.method,
    paidBy:    r.paid_by,
    paidAt:    r.paid_at,
    claimedAt: r.claimed_at,
    claimedBy: r.claimed_by,
    note:      r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createLedgerEntry(entry) {
  // Insert with conflict recovery — if partial unique index
  // rejects a duplicate (23505), find + update the existing row.
  // PostgREST cannot target partial indexes via .upsert(), so
  // we handle conflicts in application code.
  const row = {
    team_id:   entry.teamId,
    player_id: entry.playerId,
    match_id:  entry.matchId  || null,
    amount:    entry.amount,
    type:      entry.type,
    status:    entry.status,
    method:    entry.method   || null,
    paid_by:   entry.paidBy   || null,
    paid_at:   entry.paidAt   || null,
    note:      entry.note     || null,
  };
  const { data, error } = await supabase
    .from("payment_ledger")
    .insert(row)
    .select()
    .single();
  if (!error) return dbToLedger(data);
  if (error.code !== '23505') throw error;
  // Unique violation — a concurrent write raced us; find and update.
  const existing = await findMatchLedgerEntry(entry.playerId, entry.teamId, entry.matchId || null, entry.type);
  if (!existing) throw error;
  return updateLedgerEntry(existing.id, {
    status: entry.status,
    method: entry.method,
    paidBy: entry.paidBy,
    paidAt: entry.paidAt,
    note:   entry.note,
  });
}

export async function updateLedgerEntry(id, updates) {
  const patch = {};
  if (updates.status  !== undefined) patch.status    = updates.status;
  if (updates.method  !== undefined) patch.method    = updates.method;
  if (updates.paidBy  !== undefined) patch.paid_by   = updates.paidBy;
  if (updates.paidAt  !== undefined) patch.paid_at   = updates.paidAt;
  if (updates.note    !== undefined) patch.note      = updates.note;
  if (updates.matchId !== undefined) patch.match_id  = updates.matchId;
  const { data, error } = await supabase
    .from("payment_ledger")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return dbToLedger(data);
}

export async function getLedgerForPlayer(playerId, teamId, limit = 20) {
  const { data, error } = await supabase
    .from("payment_ledger")
    .select("*")
    .eq("player_id", playerId)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(dbToLedger);
}

export async function adminGetPlayerLedger(adminToken, playerId, limit = 20) {
  const { data, error } = await supabase.rpc('admin_get_player_ledger', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_limit:       limit,
  });
  if (error) throw error;
  return (data || []).map(dbToLedger);
}

export async function confirmPayment(adminToken, playerId, matchId) {
  const { error } = await supabase.rpc('admin_confirm_payment', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_match_id:    matchId || null,
  });
  if (error) throw error;
}

// Admin settles a player's WHOLE outstanding casual balance (all unpaid game_fee weeks →
// owes 0, paid). The whole-player "claims paid · CONFIRM"; per-week confirm is confirmPayment.
export async function adminSettlePlayer(adminToken, playerId) {
  const { error } = await supabase.rpc('admin_settle_player', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
  });
  if (error) throw error;
}

// Admin home "Payment Confirmations" banner: every player awaiting confirmation —
// a per-week claim (claimed ledger row) OR the whole-player self_paid flag.
export async function adminListPendingClaims(adminToken) {
  const { data, error } = await supabase.rpc('admin_list_pending_claims', {
    p_admin_token: adminToken,
  });
  if (error) throw error;
  return (data || []).map(r => ({
    playerId:     r.player_id,
    name:         r.name,
    nickname:     r.nickname,
    selfPaid:     r.self_paid,
    paidBy:       r.paid_by,
    owes:         r.owes,
    claimedWeeks: r.claimed_weeks,
    claimedTotal: r.claimed_total,
  }));
}

// Admin confirms a player's claim: whole balance if self_paid, else just the claimed weeks.
export async function adminConfirmClaims(adminToken, playerId) {
  const { error } = await supabase.rpc('admin_confirm_claims', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
  });
  if (error) throw error;
}

// Player self-declares cash payment — a PENDING CLAIM (mig 211): flags self_paid,
// does NOT clear owes. An admin confirms via confirmPayment to settle the debt.
export async function setPlayerPaid(token) {
  const { error } = await supabase.rpc('set_player_paid', { p_token: token });
  if (error) throw error;
}

// Host/guest declares a guest's cash payment.
export async function setGuestPayment(hostToken, guestId, paidBy = 'host') {
  const { error } = await supabase.rpc('set_guest_payment', {
    p_host_token: hostToken,
    p_guest_id:   guestId,
    p_paid_by:    paidBy,
  });
  if (error) throw error;
}

// Admin undoes a payment — restores owes if it was a CONFIRMED payment (mig 211).
export async function resetPayment(adminToken, playerId, matchId) {
  const { error } = await supabase.rpc('admin_reset_payment', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_match_id:    matchId || null,
  });
  if (error) throw error;
}

// Player marks ONE specific unpaid game_fee ledger row as a CLAIM (mig 459) — awaiting
// admin confirmation. Does NOT change owes; the admin confirm is the money event.
// Returns the updated ledger row (mapped) so the caller can reconcile optimistic state.
export async function claimLedgerPayment(token, ledgerId) {
  const { data, error } = await supabase.rpc('claim_ledger_payment', {
    p_token:     token,
    p_ledger_id: ledgerId,
  });
  if (error) throw error;
  return data?.ledger ? dbToLedger(data.ledger) : null;
}

// Admin rejects a false claim (mig 459) — clears claimed_at/claimed_by; status stays
// 'unpaid' and owes is untouched (the debt persists).
export async function adminRejectClaim(adminToken, playerId, ledgerId) {
  const { data, error } = await supabase.rpc('admin_reject_claim', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_ledger_id:   ledgerId,
  });
  if (error) throw error;
  return data?.ledger ? dbToLedger(data.ledger) : null;
}

// Admin waives a player's outstanding debt to zero.
export async function waiveDebt(adminToken, playerId, note) {
  const { error } = await supabase.rpc('admin_waive_debt', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_note:        note || null,
  });
  if (error) throw error;
}

// Targeted lookup to avoid duplicate ledger entries on Mark Paid / Reset.
// Handles null matchId (no lineup lock) by querying IS NULL — avoids maybeSingle()
// errors when pre-existing duplicates are present.
export async function findMatchLedgerEntry(playerId, teamId, matchId, type) {
  let query = supabase
    .from("payment_ledger")
    .select("id, status")
    .eq("player_id", playerId)
    .eq("team_id", teamId)
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(1);
  query = matchId ? query.eq("match_id", matchId) : query.is("match_id", null);
  const { data, error } = await query;
  if (error) {
    console.error('[findMatchLedgerEntry] query error:', error, { playerId, teamId, matchId, type });
    return null;
  }
  const row = data?.[0];
  return row ? { id: row.id, status: row.status } : null;
}

// (213/214 cleanup) getLedgerForTeam + getOutstandingBalance removed — no consumers,
// and they were direct payment_ledger reads that RLS blocks for anon/most roles. The
// admin outstanding total comes from the squad payload (players.owes); per-player
// ledger history goes through adminGetPlayerLedger / get_my_payment_history (RPCs).

// ─── Team Selection ───────────────────────────────────────────────────────────

export async function saveTeamsDraft(adminToken, matchId, teamA, teamB) {
  const { error } = await supabase.rpc('admin_save_teams', {
    p_admin_token: adminToken,
    p_match_id:    matchId,
    p_team_a:      teamA || [],
    p_team_b:      teamB || [],
    p_confirm:     false,
  });
  if (error) throw error;
  return { ok: true };
}

export async function confirmTeams(
  adminToken, matchId, teamA, teamB,
  predictedWinner = null,
  predictedConfidence = null,
  balanceScore = null,
) {
  const { error } = await supabase.rpc('admin_save_teams', {
    p_admin_token:          adminToken,
    p_match_id:             matchId,
    p_team_a:               teamA || [],
    p_team_b:               teamB || [],
    p_confirm:              true,
    p_predicted_winner:     predictedWinner,
    p_predicted_confidence: predictedConfidence,
    p_balance_score:        balanceScore,
  });
  if (error) throw error;
  return { ok: true };
}

// ─── Group Balancer ──────────────────────────────────────────────────────────

export async function setPlayerGroup(adminToken, playerId, groupNumber) {
  // groupNumber: 1–5, or null to clear the assignment
  const { data, error } = await supabase.rpc('admin_set_player_group', {
    p_admin_token:  adminToken,
    p_player_id:    playerId,
    p_group_number: groupNumber,
  });
  if (error) throw error;
  return data;
}

export async function clearAllGroups(adminToken) {
  const { data, error } = await supabase.rpc('admin_clear_all_groups', {
    p_admin_token: adminToken,
  });
  if (error) throw error;
  return data;
}

// ─── Vice captain + player management ────────────────────────────────────────

export async function toggleViceCaptain(adminToken, playerId, value) {
  const { error } = await supabase.rpc('admin_set_vice_captain', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_is_vc:       !!value,
  });
  if (error) throw error;
  return { ok: true };
}

export async function disablePlayer(adminToken, playerId, disabled, reason = null) {
  const { error } = await supabase.rpc('admin_disable_player', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_disabled:    !!disabled,
    p_reason:      reason || null,
  });
  if (error) throw error;
  return { ok: true };
}

// Reopen a cancelled week. Inserts a fresh matches row and points
// schedule.active_match_id at it; the cancelled match stays in history.
// Resolves the bug where upsertSchedule alone couldn't undo a cancel.
export async function reopenWeek(adminToken) {
  const { data, error } = await supabase.rpc('admin_reopen_week', {
    p_admin_token: adminToken,
  });
  if (error) throw error;
  return data; // { ok, match_id, prev_match_id }
}

// First-time go-live (non-cancelled path). Inserts the initial matches
// row and points schedule.active_match_id at it. Idempotent: re-calling
// reuses the existing non-cancelled match. Without this, brand-new
// squads hit "No Active Match" in Make Teams on first go-live because
// admin_upsert_schedule only sets game_is_live and never creates the
// match row.
export async function goLive(adminToken) {
  const { data, error } = await supabase.rpc('admin_go_live', {
    p_admin_token: adminToken,
  });
  if (error) throw error;
  return data; // { ok, match_id, reused_existing }
}

export async function adminCancelMatch(adminToken, cancelReason) {
  const { error } = await supabase.rpc('admin_cancel_match', {
    p_admin_token:   adminToken,
    p_cancel_reason: cancelReason || null,
  });
  if (error) throw error;
}

export async function adminSetPlayerPriority(adminToken, playerId, priority) {
  const { error } = await supabase.rpc('admin_set_player_priority', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_priority:    priority,
  });
  if (error) throw error;
}

// Admin sets a player's status (in/out/maybe/reserve/none). Setting 'in'
// also flips admin_locked_in=true so the player can't self-restore IN until
// admin sets them away from 'in'. RPC enforces squad-cap on 'in'.
export async function adminSetPlayerStatus(adminToken, playerId, status) {
  const { data, error } = await supabase.rpc('admin_set_player_status', {
    p_admin_token: adminToken,
    p_player_id:   playerId,
    p_status:      status,
  });
  if (error) throw error;
  return data;
}

// Admin reorders reserves. Takes the full ordered list of player IDs that
// are currently status='reserve' on the admin's team. RPC validates and
// atomically writes positions 0..N-1, audits, broadcasts. Rejects on
// duplicates, non-reserves, or stale set (reserve count changed mid-flight).
export async function adminReorderReserves(adminToken, reserveIds) {
  const { data, error } = await supabase.rpc('admin_reorder_reserves', {
    p_admin_token: adminToken,
    p_reserve_ids: reserveIds,
  });
  if (error) throw error;
  return data;
}

// ─── Payment reliability (StatsView card) ─────────────────────────────────────
// Payment reliability is derived from payment_ledger (paid game_fee rows / total
// game_fee rows, all-time) — NOT the dead players.pay_count flat column, which no
// server-side RPC increments (see migration 576). Returns the four aggregates the
// card renders: { team_id, player_count, avg_reliability, always_pays, usually_pays,
// owes_money } or null on failure. Accepts an admin token OR a player token so the
// card works on both the admin and player Stats views. Reliability is all-time /
// period-independent (like attendance reliability).
export async function getTeamPaymentReliability(adminToken = null, playerToken = null) {
  try {
    const { data, error } = await supabase.rpc('get_team_payment_reliability', {
      p_admin_token: adminToken,
      p_token:       playerToken,
    });
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error('getTeamPaymentReliability failed:', e);
    return null;
  }
}

// ─── League table ─────────────────────────────────────────────────────────────
// period: 'all' | 'month' | 'season'
// Returns players sorted: ranked (played>=3) by points/goals/winRate/potm, then unranked by name.
export async function getPlayerLeagueTable(teamId, period = 'all', adminToken = null, playerToken = null, includeGuests = false) {
  // includeGuests is a BALANCER-ONLY channel (default OFF). When true, guest
  // players with real history (played ≥ 3) are emitted so the ADMIN-ONLY team
  // balancer (playerRating.js) can rate them instead of treating them as a flat
  // 0.5 unknown. They are tagged `isGuest`, never `ranked`, and never carry a
  // reliability figure — so they can never surface as a visible league entry.
  // Every player-facing / StatsView caller leaves this OFF (Persistent-Guests
  // exclusion intact); only AdminView's balancer fetch turns it on.
  try {
    // Data source — token paths route via SECURITY DEFINER RPC so anon-context
    // routes can read past RLS. adminToken covers admin / /demoadmin (mig 041 /
    // 042); playerToken covers /p/<token> player routes (mig 348). Same RLS gap
    // as getHeadToHead — player_match has no anon/authenticated select policy.
    let matches, pmRows, allTimeData, allTeamMatchDates, playerMap;
    if (adminToken || playerToken) {
      const { data: raw, error: rpcErr } = adminToken
        ? await supabase.rpc('get_player_league_table_raw_by_admin_token',
            { p_admin_token: adminToken, p_period: period })
        : await supabase.rpc('get_player_league_table_raw_by_player_token',
            { p_token: playerToken, p_period: period });
      if (rpcErr) throw rpcErr;
      matches = raw?.period_matches || [];
      if (!matches.length) return { players: [], totalGamesInPeriod: 0 };

      pmRows = raw?.player_match_rows || [];
      if (!pmRows.length) return { players: [], totalGamesInPeriod: matches.length };

      // playedAllTime built from the pre-aggregated array
      allTimeData = [];
      for (const row of (raw?.all_time_attended || [])) {
        for (let i = 0; i < row.n; i++) allTimeData.push({ player_id: row.player_id });
      }

      allTeamMatchDates = (raw?.all_team_match_dates || []).map(d => d.match_date);

      playerMap = {};
      for (const p of (raw?.players || [])) playerMap[p.id] = p;
    } else {
      // Direct-read path — authenticated players in team_players
      const cutoff = periodCutoff(period);
      let matchQuery = supabase
        .from('matches')
        .select('id, match_date, score_type')
        .eq('team_id', teamId)
        .neq('cancelled', true);
      if (cutoff) matchQuery = matchQuery.gte('match_date', cutoff);
      const { data: matchData, error: matchErr } = await matchQuery;
      if (matchErr) throw matchErr;
      matches = matchData || [];
      if (!matches.length) return { players: [], totalGamesInPeriod: 0 };

      const matchIds = matches.map(m => m.id);

      const { data: pmData, error: pmErr } = await supabase
        .from('player_match')
        .select('player_id, match_id, attended, result, goals, was_motm, had_bibs, late_cancel, team_assignment')
        .eq('team_id', teamId)
        .in('match_id', matchIds);
      if (pmErr) throw pmErr;
      pmRows = pmData || [];
      if (!pmRows.length) return { players: [], totalGamesInPeriod: matches.length };

      const { data: allTimeDataRaw } = await supabase
        .from('player_match')
        .select('player_id')
        .eq('team_id', teamId)
        .eq('attended', true);
      allTimeData = allTimeDataRaw || [];

      if (!cutoff) {
        allTeamMatchDates = matches.map(m => m.match_date);
      } else {
        const { data: allMatchData } = await supabase
          .from('matches')
          .select('match_date')
          .eq('team_id', teamId)
          .neq('cancelled', true);
        allTeamMatchDates = (allMatchData || []).map(m => m.match_date);
      }

      const allPlayerIds = [...new Set(pmRows.map(r => r.player_id))];
      const { data: playerData, error: playerErr } = await supabase
        .from('players')
        .select('id, name, nickname, injured, disabled, is_guest, created_at')
        .in('id', allPlayerIds);
      if (playerErr) throw playerErr;
      playerMap = {};
      for (const p of (playerData || [])) playerMap[p.id] = p;
    }

    // Common downstream computation — reads `matches`, `pmRows`,
    // `allTimeData`, `allTeamMatchDates`, `playerMap` regardless of source.
    const matchMap = {};
    for (const m of matches) matchMap[m.id] = { matchDate: m.match_date, scoreType: m.score_type };

    const playedAllTime = {};
    for (const r of allTimeData) {
      playedAllTime[r.player_id] = (playedAllTime[r.player_id] || 0) + 1;
    }

    // Step 6 — Compute per player
    const exactMatchIds = new Set(
      Object.entries(matchMap)
        .filter(([, m]) => !m.scoreType || m.scoreType === 'exact')
        .map(([id]) => id)
    );

    const rowsByPlayer = {};
    for (const r of pmRows) {
      if (!rowsByPlayer[r.player_id]) rowsByPlayer[r.player_id] = [];
      rowsByPlayer[r.player_id].push(r);
    }

    const entries = [];
    for (const [playerId, rows] of Object.entries(rowsByPlayer)) {
      const player = playerMap[playerId];
      if (!player || player.disabled) continue;
      const isGuest = !!player.is_guest;
      // Guests are excluded from the visible league table / reliability / POTM
      // (Persistent-Guests exclusion). The balancer-only includeGuests channel
      // lets a guest through so playerRating.js can rate them — but see the
      // tagging below (never ranked, never a reliability figure).
      if (isGuest && !includeGuests) continue;

      const attended = rows.filter(r => r.attended);
      const played   = attended.length;
      // A guest earns a real balancer rating only with ≥ 3 games of history;
      // below that they stay a neutral unknown (dropped here → treated as 0.5).
      if (isGuest && played < 3) continue;
      const wins     = attended.filter(r => r.result === 'w').length;
      const draws    = attended.filter(r => r.result === 'd').length;
      const losses   = attended.filter(r => r.result === 'l').length;
      const points   = (wins * 3) + draws;
      const winRate  = played > 0 ? Math.round((wins / played) * 100) : 0;
      const goals    = rows.reduce((s, r) =>
        s + (exactMatchIds.has(r.match_id) ? (r.goals || 0) : 0), 0);
      const potm         = rows.filter(r => r.was_motm).length;
      const bibCount     = rows.filter(r => r.had_bibs).length;
      const lateDropouts = rows.filter(r => r.late_cancel).length;

      const joinDate       = player.created_at ? new Date(player.created_at) : null;
      const totalTeamGames = joinDate
        ? allTeamMatchDates.filter(d => new Date(d) >= joinDate).length
        : allTeamMatchDates.length;
      const allTimePlayed = playedAllTime[playerId] || 0;
      // Reliability is never computed for guests (Persistent-Guests exclusion).
      const reliability = (!isGuest && allTimePlayed >= 3 && totalTeamGames > 0)
        ? Math.round((allTimePlayed / totalTeamGames) * 100)
        : null;

      const last5 = [...attended]
        .sort((a, b) =>
          new Date(matchMap[b.match_id]?.matchDate) -
          new Date(matchMap[a.match_id]?.matchDate))
        .slice(0, 5)
        .reverse()                           // oldest left, newest right
        .map(r => r.result.toUpperCase());

      // Guests are never ranked — they carry no league position, so even in the
      // balancer-only copy they sort into the unranked pool (rank = null).
      const ranked = !isGuest && played >= 3;

      entries.push({
        playerId, name: player.name, nickname: player.nickname || null,
        injured: player.injured || false,
        played, wins, draws, losses, points,
        winRate, goals, potm, bibCount, lateDropouts, reliability,
        form: last5, ranked, isGuest,
      });
    }

    // Step 7 — Sort: ranked first by points/goals/winRate/potm, then unranked by name
    const rankedEntries   = entries.filter(e => e.ranked);
    const unrankedEntries = entries.filter(e => !e.ranked);

    rankedEntries.sort((a, b) =>
      b.points  - a.points  ||
      b.goals   - a.goals   ||
      b.winRate - a.winRate ||
      b.potm    - a.potm    ||
      a.name.localeCompare(b.name)
    );
    unrankedEntries.sort((a, b) => a.name.localeCompare(b.name));

    // Step 8 — Assign ranks; tied players share rank, next rank skips
    let rank = 1;
    for (let i = 0; i < rankedEntries.length; i++) {
      if (i > 0) {
        const prev = rankedEntries[i - 1];
        const curr = rankedEntries[i];
        const tied =
          prev.points  === curr.points  &&
          prev.goals   === curr.goals   &&
          prev.winRate === curr.winRate &&
          prev.potm    === curr.potm;
        if (!tied) rank = i + 1;
      }
      rankedEntries[i].rank = rank;
    }
    for (const u of unrankedEntries) u.rank = null;

    // NOTE: return shape changed from array to { players, totalGamesInPeriod }
    // PlayerLeagueTable must be updated to read .players (Execute B)
    //
    // ADDITIVE (Smart Teams rating engine): thread the raw player_match rows +
    // the exact-score match id set so the ADMIN-ONLY balancer (playerRating.js)
    // can reconstruct every historical A-vs-B composition for Bradley-Terry and
    // gate goals on real scorelines. These fields are for the balancer only —
    // the visible league table reads only `.players`. matchRows carries guests
    // and unranked players (they are valid latents for team-strength inference),
    // but only players present in `.players` get a surfaced rating.
    return {
      players: [...rankedEntries, ...unrankedEntries],
      totalGamesInPeriod: matches.length,
      matchRows: pmRows,
      exactMatchIds: [...exactMatchIds],
    };
  } catch (e) {
    return { players: [], totalGamesInPeriod: 0 };
  }
}

export async function getHeadToHead(meId, themId, teamId, period = 'all', adminToken = null, playerToken = null) {
  try {
    const cutoff = periodCutoff(period);

    // Data source — both token paths route the three reads through a
    // SECURITY DEFINER RPC, because player_match has RLS enabled with no
    // select policy/grant for anon or authenticated, so direct .from() reads
    // return zero rows for every non-admin caller. adminToken covers admin /
    // /demoadmin routes (migration 041); playerToken covers /p/<token> player
    // routes (migration 348) — without it H2H always shows the empty state.
    // opponentRows — opposing-side attended players in together-matches, each
    // carrying the OPPONENT's own result ('w' = they beat the pair). Powers the
    // bogey-opponent aggregation below. Absent when the pre-504 RPC is still
    // live → stays [] → bogey resolves to null → the callout hides (safe to
    // ship this client before migration 504 applies).
    let allTimeMatchData, matchData, pmData, opponentRows = [];
    if (adminToken) {
      const { data: raw, error: rpcErr } = await supabase.rpc(
        'get_head_to_head_raw_by_admin_token',
        { p_admin_token: adminToken, p_me_id: meId, p_them_id: themId, p_period: period }
      );
      if (rpcErr) throw rpcErr;
      allTimeMatchData = raw?.all_time_matches  || [];
      matchData        = raw?.period_matches    || [];
      pmData           = raw?.player_match_rows || [];
      opponentRows     = raw?.opponent_rows     || [];
    } else if (playerToken) {
      const { data: raw, error: rpcErr } = await supabase.rpc(
        'get_head_to_head_raw_by_player_token',
        { p_token: playerToken, p_me_id: meId, p_them_id: themId, p_period: period }
      );
      if (rpcErr) throw rpcErr;
      allTimeMatchData = raw?.all_time_matches  || [];
      matchData        = raw?.period_matches    || [];
      pmData           = raw?.player_match_rows || [];
      opponentRows     = raw?.opponent_rows     || [];
    } else {
      // Direct-read path — used for authenticated player sessions where the
      // caller is in team_players and RLS allows the reads.
      const { data: allTimeMatchDataRaw, error: allTimeErr } = await supabase
        .from('matches')
        .select('id, match_date, score_a, score_b, winner, score_type, cancelled')
        .eq('team_id', teamId)
        .neq('cancelled', true);
      if (allTimeErr) throw allTimeErr;
      allTimeMatchData = allTimeMatchDataRaw || [];

      let matchQuery = supabase
        .from('matches')
        .select('id, match_date, score_a, score_b, winner, score_type, cancelled')
        .eq('team_id', teamId)
        .neq('cancelled', true);
      if (cutoff) matchQuery = matchQuery.gte('match_date', cutoff);
      const { data: matchDataRaw, error: matchErr } = await matchQuery;
      if (matchErr) throw matchErr;
      matchData = matchDataRaw || [];

      const { data: pmDataRaw, error: pmErr } = await supabase
        .from('player_match')
        .select('player_id, match_id, team_assignment, result, goals, was_motm, had_bibs')
        .eq('team_id', teamId)
        .in('player_id', [meId, themId])
        .eq('attended', true);
      if (pmErr) throw pmErr;
      pmData = pmDataRaw || [];

      // Direct-path parity with the RPCs' opponent_rows: read every attended
      // player_match row for the team, plus a name map, and build the
      // opposing-side roster of together-matches in JS below. Same RLS gate as
      // pmData — returns nothing for a caller player_match won't expose.
      const { data: allPmRaw, error: allPmErr } = await supabase
        .from('player_match')
        .select('player_id, match_id, team_assignment, result')
        .eq('team_id', teamId)
        .eq('attended', true);
      if (allPmErr) throw allPmErr;
      const { data: nameRows, error: nameErr } = await supabase
        .from('players')
        .select('id, name, nickname');
      if (nameErr) throw nameErr;
      const nameMap = {};
      for (const p of (nameRows || [])) nameMap[p.id] = (p.nickname || p.name);

      // Pair's shared side per together-match (me+them same team_assignment)
      const meSide   = {};
      const themSide = {};
      for (const r of (allPmRaw || [])) {
        if (r.player_id === meId   && r.team_assignment) meSide[r.match_id]   = r.team_assignment;
        if (r.player_id === themId && r.team_assignment) themSide[r.match_id] = r.team_assignment;
      }
      const pairSide = {};
      for (const mid of Object.keys(meSide)) {
        if (themSide[mid] && themSide[mid] === meSide[mid]) pairSide[mid] = meSide[mid];
      }
      opponentRows = (allPmRaw || [])
        .filter(r => pairSide[r.match_id]
                  && r.player_id !== meId && r.player_id !== themId
                  && r.team_assignment
                  && r.team_assignment !== pairSide[r.match_id])
        .map(r => ({ player_id: r.player_id, match_id: r.match_id, result: r.result, name: nameMap[r.player_id] }));
    }

    // Detect dominant scoring style from all-time data
    const dominantType = resolveDominantType(allTimeMatchData);

    const matchMap = {};
    for (const m of matchData) {
      matchMap[m.id] = {
        matchDate: m.match_date,
        scoreA:    m.score_a,
        scoreB:    m.score_b,
        winner:    m.winner,
        scoreType: m.score_type,
      };
    }

    let meRows   = (pmData || []).filter(r => r.player_id === meId);
    let themRows = (pmData || []).filter(r => r.player_id === themId);

    // Restrict to period-filtered matches so all downstream counts are period-scoped
    meRows   = meRows.filter(r => matchMap[r.match_id]);
    themRows = themRows.filter(r => matchMap[r.match_id]);

    const meMatchIds   = new Set(meRows.map(r => r.match_id));
    const themMatchIds = new Set(themRows.map(r => r.match_id));
    const meByMatch    = {};
    const themByMatch  = {};
    for (const r of meRows)   meByMatch[r.match_id]   = r;
    for (const r of themRows) themByMatch[r.match_id] = r;

    // Shared matches — both attended
    const sharedMatchIds = [...meMatchIds].filter(id => themMatchIds.has(id));

    const togetherMatches = [];
    const againstMatches  = [];
    for (const id of sharedMatchIds) {
      const me   = meByMatch[id];
      const them = themByMatch[id];
      const md   = matchMap[id] || {};
      if (me.team_assignment && them.team_assignment && me.team_assignment === them.team_assignment) {
        togetherMatches.push({ matchId: id, me, them, ...md });
      } else {
        againstMatches.push({ matchId: id, me, them, ...md });
      }
    }

    // ── Bogey opponent ──────────────────────────────────────────────────────
    // Over the period-scoped together-matches, find the opponent who beats the
    // pair most often. opponentRows carry each opponent's OWN result
    // ('w' = they beat me+them). Threshold: ≥3 meetings AND a winning record vs
    // the pair (pairLosses*2 > meetings). Rank by pair-loss rate, tie-break by
    // meetings. Returns null (callout hides) when no opponent qualifies.
    const togetherIds = new Set(togetherMatches.map(m => m.me.match_id));
    const oppAgg = {};
    for (const r of (opponentRows || [])) {
      if (!togetherIds.has(r.match_id)) continue;
      const key = r.player_id;
      if (!oppAgg[key]) oppAgg[key] = { name: r.name || 'Opponent', meetings: 0, pairLosses: 0, pairWins: 0 };
      const a = oppAgg[key];
      a.meetings += 1;
      if (r.result === 'w') a.pairLosses += 1;      // opponent won → pair lost
      else if (r.result === 'l') a.pairWins += 1;   // opponent lost → pair won
    }
    let bogey = null;
    for (const a of Object.values(oppAgg)) {
      if (a.meetings < 3) continue;
      if (a.pairLosses * 2 <= a.meetings) continue;  // must have the winning record
      const rate = a.pairLosses / a.meetings;
      if (!bogey) { bogey = { ...a, rate }; continue; }
      if (rate > bogey.rate || (rate === bogey.rate && a.meetings > bogey.meetings)) {
        bogey = { ...a, rate };
      }
    }
    if (bogey) delete bogey.rate;

    // ── Section 1: Together ─────────────────────────────────────────────────
    const gamesTogether  = togetherMatches.length;
    const winsTogether   = togetherMatches.filter(m => m.me.result === 'w').length;
    const drawsTogether  = togetherMatches.filter(m => m.me.result === 'd').length;
    const lossesTogether = togetherMatches.filter(m => m.me.result === 'l').length;
    const winRateTogether = gamesTogether > 0
      ? Math.round((winsTogether / gamesTogether) * 100) : 0;

    const exactTogetherMatches = togetherMatches.filter(m => hasGoalData(m.scoreType));
    const myGoalsTogether    = exactTogetherMatches.reduce((s, m) => s + (m.me.goals   || 0), 0);
    const theirGoalsTogether = exactTogetherMatches.reduce((s, m) => s + (m.them.goals || 0), 0);
    const combinedGoals      = myGoalsTogether + theirGoalsTogether;
    const bibsTogether       = togetherMatches.filter(m => m.me.had_bibs || m.them.had_bibs).length;
    const potmMeTogether     = togetherMatches.filter(m => m.me.was_motm).length;
    const potmThemTogether   = togetherMatches.filter(m => m.them.was_motm).length;

    const scoredTogetherMatches = togetherMatches.filter(m => m.scoreA != null && m.scoreB != null);
    const outcomeSum = scoredTogetherMatches.reduce((s, m) => {
      const diff = m.me.team_assignment === 'A'
        ? (m.scoreA - m.scoreB)
        : (m.scoreB - m.scoreA);
      return s + diff;
    }, 0);
    const outcomeAvg = scoredTogetherMatches.length > 0
      ? Math.round((outcomeSum / scoredTogetherMatches.length) * 10) / 10
      : null;

    const togetherTotalGoals = exactTogetherMatches.reduce((s, m) => {
      const sa = m.scoreA != null ? m.scoreA : 0;
      const sb = m.scoreB != null ? m.scoreB : 0;
      return s + sa + sb;
    }, 0);
    const goalThreatTogetherCount = exactTogetherMatches.length;
    const goalThreatTogether = goalThreatTogetherCount > 0
      ? Math.round((togetherTotalGoals / goalThreatTogetherCount) * 10) / 10
      : null;

    // "Apart" = matches where only me attended (not them)
    const meOnlyMatchIds = [...meMatchIds].filter(id => !themMatchIds.has(id));
    const exactMeOnlyMatchIds = meOnlyMatchIds.filter(id => hasGoalData(matchMap[id]?.scoreType));
    const apartTotalGoals = exactMeOnlyMatchIds.reduce((s, id) => {
      const md = matchMap[id];
      if (!md) return s;
      return s + (md.scoreA != null ? md.scoreA : 0) + (md.scoreB != null ? md.scoreB : 0);
    }, 0);
    const goalThreatApartCount = exactMeOnlyMatchIds.length;
    const goalThreatApart = goalThreatApartCount > 0
      ? Math.round((apartTotalGoals / goalThreatApartCount) * 10) / 10
      : null;

    // ── Section 2: Against ──────────────────────────────────────────────────
    const gamesAgainst    = againstMatches.length;
    const gamesBothPlayed = gamesTogether + gamesAgainst;
    const meWins          = againstMatches.filter(m => m.me.result === 'w').length;
    const againstDraws    = againstMatches.filter(m => m.me.result === 'd').length;
    const theirWins       = againstMatches.filter(m => m.me.result === 'l').length;
    const exactAgainstMatches = againstMatches.filter(m => hasGoalData(m.scoreType));
    const myGoalsAgainst  = exactAgainstMatches.reduce((s, m) => s + (m.me.goals   || 0), 0);
    const theirGoalsAgainst = exactAgainstMatches.reduce((s, m) => s + (m.them.goals || 0), 0);

    // Streak — sort against games newest first, walk until streak breaks
    const sortedAgainst = [...againstMatches].sort((a, b) =>
      new Date(b.matchDate || 0) - new Date(a.matchDate || 0)
    );
    let streakPlayer = null;
    let streakLength = 0;
    for (const m of sortedAgainst) {
      const winner = m.me.result === 'w' ? 'me' : m.me.result === 'l' ? 'them' : null;
      if (winner === null) break;
      if (streakPlayer === null) {
        streakPlayer = winner;
        streakLength = 1;
      } else if (winner === streakPlayer) {
        streakLength++;
      } else {
        break;
      }
    }

    // ── Section 3: Chemistry ────────────────────────────────────────────────
    const sharedSet    = new Set(sharedMatchIds);
    const meNonShared  = meRows.filter(r => !sharedSet.has(r.match_id));
    const themNonShared = themRows.filter(r => !sharedSet.has(r.match_id));

    const meWithoutWins   = meNonShared.filter(r => r.result === 'w').length;
    const themWithoutWins = themNonShared.filter(r => r.result === 'w').length;

    // "Apart" = NOT on my team: games they played while I sat out (non-shared)
    // PLUS games where we were on opposing sides (against). A head-to-head loss
    // counts as "apart" — being AGAINST me is not being helped by me. Without
    // this, a game where they beat me falls into neither "with" nor "without"
    // and silently vanishes from the chemistry maths. meWins / theirWins are
    // already each player's against-game wins (Section 2, above).
    const themApartGames = themNonShared.length + gamesAgainst;
    const themApartWins  = themWithoutWins + theirWins;
    const myApartGames   = meNonShared.length + gamesAgainst;
    const myApartWins    = meWithoutWins + meWins;

    // Their win rate WITH me = on same team (togetherMatches)
    const theirWinRateWithMe = gamesTogether > 0
      ? Math.round((winsTogether / gamesTogether) * 100) : null;
    const theirWinRateWithoutMe = themApartGames > 0
      ? Math.round((themApartWins / themApartGames) * 100) : null;

    // My win rate WITH them = same (same team = same result)
    const myWinRateWithThem = gamesTogether > 0
      ? Math.round((winsTogether / gamesTogether) * 100) : null;
    const myWinRateWithoutThem = myApartGames > 0
      ? Math.round((myApartWins / myApartGames) * 100) : null;

    // POTM in all shared games
    const myPotm    = [...togetherMatches, ...againstMatches].filter(m => m.me.was_motm).length;
    const theirPotm = [...togetherMatches, ...againstMatches].filter(m => m.them.was_motm).length;

    // ── Section 5: Recent shared matches ────────────────────────────────────
    const allShared = [...togetherMatches, ...againstMatches].map(m => ({
      matchDate: m.matchDate,
      scoreA:    m.scoreA,
      scoreB:    m.scoreB,
      type:      togetherMatches.includes(m) ? 'together' : 'against',
      myResult:  m.me.result,
    }));
    allShared.sort((a, b) => new Date(b.matchDate || 0) - new Date(a.matchDate || 0));
    const recentShared = allShared.slice(0, 5);

    // ── H2H fun additions: full ledger + all-time form (PR#1 data foundation) ──
    // ledger[] = every shared game, enriched, newest-first. It is the single rich
    // structure the momentum / biggest-worst / rivalry-ledger UI all reduce over
    // client-side (no per-feature wrapper maths). Carries a stable matchId per
    // entry (future-proofs tap-through, dedup, and the PR7 per-match opponent
    // join at zero extra cost). Additive only — recentShared above is unchanged.
    // NOTE (Hard Rule 14): ledger[] is explicitly designed as the future
    // gaffer_get_context_h2h payload — a later reshape must not silently break the
    // Gaffer H2H briefing. Recorded in RPCS.md.
    const ledger = [...togetherMatches, ...againstMatches].map(m => {
      const scoreA = m.scoreA != null ? m.scoreA : null;
      const scoreB = m.scoreB != null ? m.scoreB : null;
      // Margin from my side's perspective — reuse the verbatim Section-1 formula.
      // null when the game has no numeric score (win-only / margin-typed games).
      const margin = (scoreA != null && scoreB != null)
        ? (m.me.team_assignment === 'A' ? (scoreA - scoreB) : (scoreB - scoreA))
        : null;
      return {
        matchId:         m.matchId,
        matchDate:       m.matchDate,
        type:            togetherMatches.includes(m) ? 'together' : 'against',
        myResult:        m.me.result,
        scoreA,
        scoreB,
        scoreType:       m.scoreType,
        team_assignment: m.me.team_assignment,
        myGoals:         m.me.goals   != null ? m.me.goals   : null,
        themGoals:       m.them.goals != null ? m.them.goals : null,
        wasMotmMe:       !!m.me.was_motm,
        wasMotmThem:     !!m.them.was_motm,
        margin,
      };
    });
    ledger.sort((a, b) => new Date(b.matchDate || 0) - new Date(a.matchDate || 0));

    // All-time last-5 form per player — "last 5, all-time" (deliberately bypasses
    // the period pill; form is inherently each player's own recent games). Built
    // from raw all-time pmData joined to all_time_matches for dates — NOT from
    // ledger[] (that's shared-games-only → wrong denominator). meRows/themRows are
    // period-scoped by this point, so pmData is the correct all-time source.
    const allTimeMatchDateById = {};
    for (const m of (allTimeMatchData || [])) allTimeMatchDateById[m.id] = m.match_date;
    const buildForm = (pid) => (pmData || [])
      .filter(r => r.player_id === pid && r.result && allTimeMatchDateById[r.match_id])
      .map(r => ({ result: r.result, matchDate: allTimeMatchDateById[r.match_id] }))
      .sort((a, b) => new Date(b.matchDate || 0) - new Date(a.matchDate || 0))
      .slice(0, 5);
    const formMe   = buildForm(meId);
    const formThem = buildForm(themId);

    // ── Verdicts ─────────────────────────────────────────────────────────────
    const totalSharedGames = sharedMatchIds.length;
    let mainVerdict = 'early_days';
    if (gamesTogether >= 3 && winRateTogether > 55) {
      mainVerdict = 'better_together';
    } else if (gamesAgainst >= 3 && theirWins > meWins * 1.5) {
      mainVerdict = 'nemesis';
    } else if (gamesAgainst >= 3 && meWins > theirWins * 1.5) {
      mainVerdict = 'you_own_them';
    } else if (totalSharedGames >= 3) {
      mainVerdict = 'dead_even';
    }

    const myEffectDelta   = theirWinRateWithMe   !== null && theirWinRateWithoutMe  !== null
      ? theirWinRateWithMe   - theirWinRateWithoutMe  : null;
    const themEffectDelta = myWinRateWithThem    !== null && myWinRateWithoutThem   !== null
      ? myWinRateWithThem    - myWinRateWithoutThem   : null;

    let chemistryVerdict;
    if (gamesTogether < 3 || myApartGames < 3 || themApartGames < 3) {
      chemistryVerdict = 'building';
    } else if (myEffectDelta >= 10 && themEffectDelta >= 10) {
      chemistryVerdict = 'good_luck_charm';
    } else if (myEffectDelta <= -10 && themEffectDelta <= -10) {
      chemistryVerdict = 'bad_influence';
    } else if (Math.sign(myEffectDelta) !== Math.sign(themEffectDelta) &&
               (Math.abs(myEffectDelta) >= 10 || Math.abs(themEffectDelta) >= 10)) {
      chemistryVerdict = 'asymmetric';
    } else {
      chemistryVerdict = 'no_effect';
    }

    return {
      together: {
        games:                     gamesTogether,
        wins:                      winsTogether,
        draws:                     drawsTogether,
        losses:                    lossesTogether,
        winRate:                   winRateTogether,
        combinedGoals,
        myGoals:                   myGoalsTogether,
        theirGoals:                theirGoalsTogether,
        bibs:                      bibsTogether,
        goalThreatTogether,
        goalThreatTogetherCount,
        goalThreatApart,
        goalThreatApartCount,
        potmMe:                    potmMeTogether,
        potmThem:                  potmThemTogether,
        outcomeAvg,
        gamesBothPlayed,
      },
      against: {
        games:       gamesAgainst,
        meWins,
        draws:       againstDraws,
        theirWins,
        myGoals:     myGoalsAgainst,
        theirGoals:  theirGoalsAgainst,
        goalsCount:  exactAgainstMatches.length,
        streak: { player: streakPlayer, length: streakLength },
      },
      chemistry: {
        theirWinRateWithMe,
        theirWinRateWithoutMe,
        myWinRateWithThem,
        myWinRateWithoutThem,
        myEffectDelta,
        themEffectDelta,
        myPotm,
        theirPotm,
      },
      recentShared,
      bogey,
      ledger,
      formMe,
      formThem,
      mainVerdict,
      chemistryVerdict,
      dominantType,
      totalSharedGames,
    };
  } catch (e) {
    return null;
  }
}

// ─── Ask the Gaffer — AI agent layer ─────────────────────────────────────────
// Edge function lives at /api/gaffer (apps/inorout/api/gaffer.js).
// These wrappers POST to that endpoint and return the JSON shape:
//   { content, briefingId, cached, surface, model, tokensIn, tokensOut, costPence, generatedAt }
// On error returns: { error: 'string_code', message?: '...' }
// Spec: GAFFER.md

const GAFFER_ENDPOINT = "/api/gaffer";

async function callGafferEdge(body) {
  try {
    const res = await fetch(GAFFER_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: json?.error || `http_${res.status}`, message: json?.message };
    }
    return json;
  } catch (e) {
    console.error("[gaffer] edge call failed:", e?.message);
    return { error: "network_error", message: e?.message };
  }
}

export async function getGafferBriefing(adminToken, surface, opts = {}) {
  if (!adminToken || !surface) return { error: "missing_args" };
  return callGafferEdge({
    adminToken,
    surface,
    forceRefresh: !!opts.forceRefresh,
  });
}

export async function askGafferQuestion(adminToken, question, opts = {}) {
  if (!adminToken || !question) return { error: "missing_args" };
  return callGafferEdge({
    adminToken,
    surface: "qa",
    question,
    forceRefresh: !!opts.forceRefresh,
  });
}

// Gaffer action-flow (GAFFER_ACTION_FLOW_HANDOFF.md PR-C) — "Do it for you".
// Two-step: propose (records intent, returns a server-computed preview) then
// confirm (re-validates, dispatches, audits). Both throw on error — the
// caller (Gaffer/index.jsx) catches and renders a plain-English message per
// the RPC's error code, same pattern as every other admin_* write call.
export async function gafferProposeAction(adminToken, actionKey, nudgeKey, source) {
  const { data, error } = await supabase.rpc('gaffer_propose_action', {
    p_admin_token: adminToken,
    p_action_key: actionKey,
    p_nudge_key: nudgeKey ?? null,
    p_source: source || 'nudge',
  });
  if (error) throw error;
  return data;
}

export async function gafferConfirmAction(adminToken, gafferActionId, actionKey) {
  const { data, error } = await supabase.rpc('gaffer_confirm_action', {
    p_admin_token: adminToken,
    p_gaffer_action_id: gafferActionId,
    p_action_key: actionKey,
  });
  if (error) throw error;
  return data;
}

// ─── Superadmin (apps/superadmin) ────────────────────────────────────────────
// All four wrappers call SECURITY DEFINER RPCs gated by is_platform_admin().
// Caller must be in the platform_admins table (migration 045).

export async function superadminWhoami() {
  const { data, error } = await supabase.rpc("superadmin_whoami");
  if (error) {
    console.error("[superadmin] whoami failed", error);
    throw error;
  }
  return data;
}

export async function superadminListTeams() {
  const { data, error } = await supabase.rpc("superadmin_list_teams");
  if (error) {
    console.error("[superadmin] list_teams failed", error);
    throw error;
  }
  return data || [];
}

export async function superadminTeamDetail(teamId) {
  const { data, error } = await supabase.rpc("superadmin_team_detail", { p_team_id: teamId });
  if (error) {
    console.error("[superadmin] team_detail failed", error);
    throw error;
  }
  return data;
}

export async function superadminRecentActivity({ limit = 100, sinceHours = 24 } = {}) {
  const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
  const { data, error } = await supabase.rpc("superadmin_recent_activity", {
    p_limit: limit,
    p_since: since,
  });
  if (error) {
    console.error("[superadmin] recent_activity failed", error);
    throw error;
  }
  return data || [];
}

// Granular engagement analytics for the superadmin Engagement tab (mig 235).
// p_from / p_to are UK calendar dates (YYYY-MM-DD), inclusive.
export async function superadminEngagement(from, to) {
  const { data, error } = await supabase.rpc("superadmin_engagement", {
    p_from: from,
    p_to: to,
  });
  if (error) {
    console.error("[superadmin] engagement failed", error);
    throw error;
  }
  return data;
}

// Squad-health analytics for the superadmin Health tab (mig 236): activation funnel,
// notification reach, install/sign-in health, response/ghost rate.
export async function superadminHealth(from, to) {
  const { data, error } = await supabase.rpc("superadmin_health", {
    p_from: from,
    p_to: to,
  });
  if (error) {
    console.error("[superadmin] health failed", error);
    throw error;
  }
  return data;
}

export async function getLeagueConfig(leagueId = null) {
  const { data, error } = await supabase.rpc("get_league_config", { p_league_id: leagueId });
  if (error) {
    console.error("[league_config] get_league_config failed", error);
    throw error;
  }
  return data;
}

export async function getCompanyByDomain(domain) {
  if (!domain) return null;
  const { data, error } = await supabase.rpc("get_company_by_domain", { p_domain: domain });
  if (error) {
    console.error("[company_domains] get_company_by_domain failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 6 HQ dashboard (apps/hq) ────────────────────────────
// Authenticated-only (OAuth, no token); RPCs resolve the caller via auth.uid() →
// company_admins (mig 171). companyAdminWhoami gates the app; the three hq_* wrappers
// read/write company state. Consumers: apps/hq (VenueHealthGrid, VenueDetail, AlertsActions).

export async function companyAdminWhoami() {
  const { data, error } = await supabase.rpc("company_admin_whoami");
  if (error) {
    console.error("[hq] company_admin_whoami failed", error);
    throw error;
  }
  return data;
}

export async function hqGetCompanyState(companyId) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc("hq_get_company_state", { p_company_id: companyId });
  if (error) {
    console.error("[hq] get_company_state failed", error);
    throw error;
  }
  return data;
}

export async function hqGetVenueDetail(companyId, venueId) {
  if (!companyId || !venueId) return null;
  const { data, error } = await supabase.rpc("hq_get_venue_detail", {
    p_company_id: companyId,
    p_venue_id: venueId,
  });
  if (error) {
    console.error("[hq] get_venue_detail failed", error);
    throw error;
  }
  return data;
}

export async function hqResolveIncident(companyId, incidentId, resolutionNote = null) {
  const { data, error } = await supabase.rpc("hq_resolve_incident", {
    p_company_id: companyId,
    p_incident_id: incidentId,
    p_resolution_note: resolutionNote,
  });
  if (error) {
    console.error("[hq] resolve_incident failed", error);
    throw error;
  }
  return data;
}

// Cross-venue escalation inbox (mig 463). Region-scoped for regional_admin;
// analyst allowed (read-only). Optional escalated_at date range.
export async function hqListEscalatedIncidents(companyId, { dateFrom = null, dateTo = null } = {}) {
  if (!companyId) return [];
  const { data, error } = await supabase.rpc("hq_list_escalated_incidents", {
    p_company_id: companyId, p_date_from: dateFrom, p_date_to: dateTo });
  if (error) { console.error("[hq] list_escalated_incidents failed", error); throw error; }
  return data;
}

export async function hqGetAnalytics(companyId, dateFrom = null, dateTo = null) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc("hq_get_analytics", {
    p_company_id: companyId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) {
    console.error("[hq] get_analytics failed", error);
    throw error;
  }
  return data;
}

export async function hqGetUtilisation(companyId, dateFrom = null, dateTo = null) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc("hq_get_utilisation", {
    p_company_id: companyId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) {
    console.error("[hq] get_utilisation failed", error);
    throw error;
  }
  return data;
}

// Classes + Room Hire Phase 8 (mig 345). Waitlist intelligence (class types
// consistently >90% full), instructor utilisation, and revenue per class type
// across the company's venues. Authenticated, resolve_company_caller-gated,
// region-scoped. Also a Gaffer/Phase-7 AI context source (Hard Rule #14).
export async function hqGetClassInsights(companyId) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc("hq_get_class_insights", { p_company_id: companyId });
  if (error) {
    console.error("[hq] get_class_insights failed", error);
    throw error;
  }
  return data;
}

// Membership health rolled up across the company's venues (Phase 6, mig 278).
// Returns {ok, venues:[{venue_id, venue_name, region, active, paused, ending,
// due_soon, mrr_pence, cancelled_30d, pending_requests}], total:{…}}.
export async function hqGetMembershipRollup(companyId) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc("hq_get_membership_rollup", { p_company_id: companyId });
  if (error) {
    console.error("[hq] get_membership_rollup failed", error);
    throw error;
  }
  return data;
}

export async function hqSetDashboardConfig(companyId, config) {
  const { data, error } = await supabase.rpc("hq_set_dashboard_config", {
    p_company_id: companyId,
    p_config: config,
  });
  if (error) {
    console.error("[hq] set_dashboard_config failed", error);
    throw error;
  }
  return data;
}

export async function hqGetActivity(companyId) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc("hq_get_activity", { p_company_id: companyId });
  if (error) {
    console.error("[hq] get_activity failed", error);
    throw error;
  }
  return data;
}

export async function hqGeneratePreviewToken(companyId) {
  const { data, error } = await supabase.rpc("hq_generate_preview_token", { p_company_id: companyId });
  if (error) {
    console.error("[hq] generate_preview_token failed", error);
    throw error;
  }
  return data;
}

// Anon-callable (the token is the secret) — no session required.
export async function getHqPreviewState(token) {
  if (!token) return null;
  const { data, error } = await supabase.rpc("get_hq_preview_state", { p_token: token });
  if (error) {
    console.error("[hq] get_hq_preview_state failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 2 superadmin onboarding ─────────────────────────────
// superadmin_create_venue is the operator-led venue onboarding RPC. Gated by
// is_platform_admin() server-side. Self-serve signup is deferred to year 2.

export async function superadminCreateVenue({
  name,
  operatorEmail,
  sport = "football",
  firstLeague = null,
} = {}) {
  const { data, error } = await supabase.rpc("superadmin_create_venue", {
    p_name: name,
    p_operator_email: operatorEmail,
    p_sport: sport,
    p_first_league: firstLeague,
  });
  if (error) {
    console.error("[superadmin] create_venue failed", error);
    throw error;
  }
  return data;
}

// superadmin_create_club (mig 578, DF Sports Onboarding PR #1) is the OPERATOR-LED
// twin of self_serve_create_club (mig 518): a platform admin mints a venueless
// club FOR a customer. is_platform_admin()-gated. In one atomic transaction it
// mints a trial / verification_status='pending' / origin='self_serve' shell venue
// + the owner's venue_admins row as a PENDING INVITE (user_id NULL, status=
// 'invited', keyed by ownerEmail — bound + activated on the owner's first verified
// sign-in via venue_claim_memberships) + a clubs row (id from name, club_id_taken
// guard) + the club_venues link. ownerEmail is the invite target + contact
// metadata, never a trust signal. NEVER returns venue_admin_token. No abuse cap —
// the platform-admin gate is the control. Returns { ok, club_id, venue_id,
// owner_email, owner_status:'invited', verification_status, origin }.
// Consumer (HR#14): apps/superadmin onboarding UI (DF Sports PR #2).
export async function superadminCreateClub({
  name,
  ownerEmail,
  shortName = null,
  sport = "football",
} = {}) {
  const { data, error } = await supabase.rpc("superadmin_create_club", {
    p_name: name,
    p_owner_email: ownerEmail,
    p_short_name: shortName,
    p_sport: sport,
  });
  if (error) {
    console.error("[superadmin] create_club failed", error);
    throw error;
  }
  return data;
}

// superadmin_import_club_roster (mig 581, DF Sports Onboarding PR #4) is the
// OPERATOR-LED bulk roster importer: a platform admin pastes a club's children +
// guardians and it provisions them in one atomic call — unclaimed child shells
// into member_profiles, guardian shells + accepted parent↔child links into
// member_guardians, and one age-band membership per child into venue_memberships
// (cohort_id auto-placed via _cohort_for_dob). is_platform_admin()-gated.
// SAFETY (bulk minor PII): NO consent/auth column is ever set (unclaimed shells);
// any row/guardian carrying a forbidden identity/consent key is rejected
// (consent_fields_forbidden); all stripe_*/gc_* left NULL (cash membership, no
// card charge); upsert-by-natural-key (child = name+dob within this venue;
// guardian = email within this club) so a re-run UPDATES, never duplicates;
// row-level partial failure inside one transaction. rows = [{first_name, last_name,
// dob, gender?, medical_conditions?, allergies?, medications?, ec1_*?, guardians:
// [{first_name, last_name?, email?, phone?, relationship?, is_primary?, can_collect?}] }].
// period ∈ monthly|quarterly|annual|season; status ∈ active|paused (default active).
// The tier must exist for the venue with a 'standard' venue_tier_prices price for
// the period. Returns { ok, import_batch_id, summary:{...counts}, rows:[...], warnings:[...] }.
// Consumer (HR#14): apps/superadmin import UI (future PR) + platform-admin console.
export async function superadminImportClubRoster({
  venueId,
  tierId,
  period,
  rows,
  status = "active",
} = {}) {
  const { data, error } = await supabase.rpc("superadmin_import_club_roster", {
    p_venue_id: venueId,
    p_tier_id: tierId,
    p_period: period,
    p_rows: rows,
    p_status: status,
  });
  if (error) {
    console.error("[superadmin] import_club_roster failed", error);
    throw error;
  }
  return data;
}

// superadmin_list_venues (Venue Setup Wizard W5, mig 488) — the new-signup ALERT
// surface. is_platform_admin()-gated read; lists recent venues (newest first) with
// origin + verification_status + bookable_count so the platform can monitor self-serve
// signups (trust-but-monitor, Decision #5) and act on the takedown list.
export async function superadminListVenues() {
  const { data, error } = await supabase.rpc("superadmin_list_venues");
  if (error) {
    console.error("[superadmin] list_venues failed", error);
    throw error;
  }
  return data;
}

// superadmin_set_venue_verification (mig 488) — the rejected TAKEDOWN / restore
// override. is_platform_admin()-gated; the ONLY path that can set or lift 'rejected'.
export async function superadminSetVenueVerification({ venueId, status } = {}) {
  const { data, error } = await supabase.rpc("superadmin_set_venue_verification", {
    p_venue_id: venueId,
    p_status: status,
  });
  if (error) {
    console.error("[superadmin] set_venue_verification failed", error);
    throw error;
  }
  return data;
}

// self_serve_create_venue is the DE-GATED twin of superadmin_create_venue
// (mig 484, Self-Serve Multi-Vertical PR3 ownership foundation). SECURITY DEFINER,
// authenticated-only. Creates a trial / verification_status='pending' / origin='self_serve'
// venue SHELL and grants the CALLER (auth.uid(), derived server-side) its first
// venue_admins(role='owner') row — the unlock that makes every downstream club/discipline/
// class RPC work unchanged. p_contact_email is contact metadata only, never a trust signal.
// NEVER returns venue_admin_token. Abuse cap: max 3 self-serve venues per user still pending.
// Returns { ok, venue_id, verification_status, origin }.
export async function selfServeCreateVenue({
  name,
  contactEmail,
  sport = "football",
} = {}) {
  const { data, error } = await supabase.rpc("self_serve_create_venue", {
    p_name: name,
    p_contact_email: contactEmail,
    p_sport: sport,
  });
  if (error) {
    console.error("[selfServe] create_venue failed", error);
    throw error;
  }
  return data;
}

// self_serve_create_club is the venueless-club twin of selfServeCreateVenue
// (mig 518, Club Console Consolidation PR #4). SECURITY DEFINER, authenticated-only.
// In one atomic transaction it mints a shell venue (trial / verification_status=
// 'pending' / origin='self_serve') + the CALLER's venue_admins(role='owner') row
// (auth.uid(), server-derived) + a clubs row + the club_venues link — so a club
// that runs no physical facility is addressable through the one venue-keyed spine.
// p_contact_email is contact metadata only, never a trust signal. NEVER returns
// venue_admin_token. Abuse cap: max 3 self-serve shells per user still pending.
// Returns { ok, club_id, venue_id, verification_status, origin }.
// Consumer (HR#14): SELF_SERVE_MULTI_VERTICAL PR5 (club self-serve onboarding).
export async function selfServeCreateClub({
  name,
  contactEmail,
  shortName = null,
  sport = "football",
} = {}) {
  const { data, error } = await supabase.rpc("self_serve_create_club", {
    p_name: name,
    p_contact_email: contactEmail,
    p_short_name: shortName,
    p_sport: sport,
  });
  if (error) {
    console.error("[selfServe] create_club failed", error);
    throw error;
  }
  return data;
}

// Self-serve tournament creation (mig 489). Authenticated consumer, no club/venue:
// finds-or-creates a hidden personal-host venue, inserts the tournament (status
// 'open') + a default competition, and returns { ok, tournament_id, slug,
// venue_id, competition_id }. venue_id is the Stage-1b management token for the
// existing venue_* tournament wrappers — never the master venue_admin_token.
export async function selfServeCreateTournament({
  name,
  sport = "football",
  format = "knockout",
  eventDate = null,
} = {}) {
  const { data, error } = await supabase.rpc("self_serve_create_tournament", {
    p_name: name,
    p_sport: sport,
    p_format: format,
    p_event_date: eventDate,
  });
  if (error) {
    console.error("[selfServe] create_tournament failed", error);
    throw error;
  }
  return data;
}

// Self-serve tournament score entry (mig 490). The organiser passes the
// tournament's venue_id in the venueToken slot (Stage-1b, re-checked on
// auth.uid()); sets the fixture final score AND advances the knockout bracket in
// one transaction. Returns { ok, fixture_id, home_score, away_score, status }.
export async function selfServeEnterResult(venueToken, { fixtureId, home, away } = {}) {
  const { data, error } = await supabase.rpc("self_serve_enter_result", {
    p_venue_token: venueToken,
    p_fixture_id: fixtureId,
    p_home: home,
    p_away: away,
  });
  if (error) {
    console.error("[selfServe] enter_result failed", error);
    throw error;
  }
  return data;
}

// Self-serve straight-knockout seeder (mig 491). Builds a tournament-mode
// single-elimination bracket from the competition's active teams — the tournament
// twin of venue_seed_knockout (which is groups→KO only). The organiser passes the
// tournament's venue_id in the venueToken slot (Stage-1b, re-checked on auth.uid()).
// Requires a power-of-2 field (raises bracket_size_not_supported otherwise — the UI
// steers odd counts to round_robin / group_stage). Returns { ok, total_teams,
// knockout_rounds }. Fixtures it writes are advance-compatible with selfServeEnterResult.
export async function selfServeSeedSingleElim(venueToken, tournamentEventId, competitionId) {
  const { data, error } = await supabase.rpc("self_serve_seed_single_elim", {
    p_venue_token: venueToken,
    p_tournament_event_id: tournamentEventId,
    p_competition_id: competitionId,
  });
  if (error) {
    console.error("[selfServe] seed_single_elim failed", error);
    throw error;
  }
  return data;
}

// Seed a "Groups, then knockout" group stage (mig 498): snake-draws the approved teams
// into numGroups balanced groups (letters A/B/C…) and generates per-group all-play-all
// fixtures (group_label set, unscheduled). numGroups ∈ {2,4,8}, qualifiersPerGroup ∈ {1,2}
// (top-1 → smaller/robust bracket, top-2 → classic); the bracket size numGroups×qpg must be
// a power of 2 (always is for these sets). Requires team_count ≥ numGroups×(qpg+1). Records
// qualifiersPerGroup in competitions.config so venueSeedKnockout (mig 500) picks the top-N.
// Returns { ok, total_teams, num_groups, qualifiers_per_group, bracket_size, fixtures_created }.
// Once every group fixture is scored, call venueSeedKnockout to seed the cross-seeded bracket.
export async function selfServeSeedGroupStage(venueToken, tournamentEventId, competitionId, numGroups, qualifiersPerGroup) {
  const { data, error } = await supabase.rpc("self_serve_seed_group_stage", {
    p_venue_token: venueToken,
    p_tournament_event_id: tournamentEventId,
    p_competition_id: competitionId,
    p_num_groups: numGroups,
    p_qualifiers_per_group: qualifiersPerGroup,
  });
  if (error) {
    console.error("[selfServe] seed_group_stage failed", error);
    throw error;
  }
  return data;
}

// Retire a no-show group team (mig 499): flips the registration to 'withdrawn' and walks
// over its outstanding GROUP fixtures as completed results (opponent 3-0; 0-0 if the
// opponent is also retired). Clears venueSeedKnockout's incomplete_group_fixtures gate
// without fabricated real scores. Returns { ok, competition_id, status, walkover_count }.
export async function selfServeRetireGroupTeam(venueToken, competitionTeamId) {
  const { data, error } = await supabase.rpc("self_serve_retire_group_team", {
    p_venue_token: venueToken,
    p_competition_team_id: competitionTeamId,
  });
  if (error) {
    console.error("[selfServe] retire_group_team failed", error);
    throw error;
  }
  return data;
}

// The self-serve organiser's own tournaments (mig 492) — resolved from
// tournament_events.created_by_user = auth.uid(), NOT from the operator role
// (the hidden personal-host venue is deliberately excluded from get_my_world by
// mig 493). Each row carries venue_id — the Stage-1b management token the venue_*
// wrappers expect. Returns [] when the signed-in user has created none.
export async function getMyTournaments() {
  const { data, error } = await supabase.rpc("get_my_tournaments");
  if (error) {
    console.error("[selfServe] get_my_tournaments failed", error);
    throw error;
  }
  return data ?? [];
}

// Owner reverse path (mig 495, Apple 5.1.1(v)) — the creator cancels their own
// tournament (created_by_user = auth.uid()). Soft 'cancelled' status; the public
// page then returns not_found. Returns { ok, status }.
export async function selfServeCancelTournament(tournamentId) {
  const { data, error } = await supabase.rpc("self_serve_cancel_tournament", {
    p_tournament_id: tournamentId,
  });
  if (error) {
    console.error("[selfServe] cancel_tournament failed", error);
    throw error;
  }
  return data;
}

// Public report affordance (mig 495, Apple 1.2) — anyone (incl. signed-out
// spectators) flags a tournament. reason ∈ offensive|inappropriate|spam|
// impersonation|other. Writes to the tournament_reports moderation inbox.
export async function tournamentReport(slug, reason, note = null) {
  const { data, error } = await supabase.rpc("tournament_report", {
    p_slug: slug,
    p_reason: reason,
    p_note: note,
  });
  if (error) {
    console.error("[tournament] report failed", error);
    throw error;
  }
  return data;
}

// Platform takedown (mig 495) — is_platform_admin() soft-hides/unhides a
// tournament from the public page (hidden_at). The apps/superadmin moderation
// action; the report inbox is the queue it acts on. Returns { ok, hidden }.
export async function adminHideTournament(tournamentId, hidden, reason = null) {
  const { data, error } = await supabase.rpc("admin_hide_tournament", {
    p_tournament_id: tournamentId,
    p_hidden: hidden,
    p_reason: reason,
  });
  if (error) {
    console.error("[admin] hide_tournament failed", error);
    throw error;
  }
  return data;
}

// Moderation queue (mig 497) — is_platform_admin() lists every tournament with >=1
// report, aggregated (counts by reason, total, latest report time, current hidden
// state, recent notes). Powers the apps/superadmin Moderation screen; the hide
// action is adminHideTournament. Returns an array (newest report first).
export async function adminListTournamentReports() {
  const { data, error } = await supabase.rpc("get_tournament_reports");
  if (error) {
    console.error("[admin] list_tournament_reports failed", error);
    throw error;
  }
  return data ?? [];
}

// Operator-led casual squad creation (mig 239). Creates the squad shell (team + schedule +
// settings + admin_token); no members. Returns {team_id, admin_token, join_code, name}.
export async function superadminCreateTeam({
  name,
  adminEmail,
  dayOfWeek,
  kickoff,
  squadSize,
  venue = null,
  price = 0,
} = {}) {
  const { data, error } = await supabase.rpc("superadmin_create_team", {
    p_team_name: name,
    p_admin_email: adminEmail,
    p_day_of_week: dayOfWeek,
    p_kickoff: kickoff,
    p_squad_size: squadSize,
    p_venue: venue,
    p_price: price,
  });
  if (error) {
    console.error("[superadmin] create_team failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 2 Cycle 2.2 read RPCs ───────────────────────────────

export async function venueGetState(venueToken) {
  if (!venueToken) return null;
  const { data, error } = await supabase.rpc("venue_get_state", {
    p_venue_token: venueToken,
  });
  if (error) {
    console.error("[venue] get_state failed", error);
    throw error;
  }
  return data;
}

export async function leagueGetState(leagueToken) {
  if (!leagueToken) return null;
  const { data, error } = await supabase.rpc("league_get_state", {
    p_league_token: leagueToken,
  });
  if (error) {
    console.error("[league] get_state failed", error);
    throw error;
  }
  return data;
}

// League dashboard companions — mig 199 (teams) + mig 200 (standings).
export async function leagueListTeams(leagueToken) {
  const { data, error } = await supabase.rpc("league_list_teams", {
    p_league_token: leagueToken,
  });
  if (error) {
    console.error("[league] list_teams failed", error);
    throw error;
  }
  return data;
}

export async function leagueGetStandings(leagueToken, competitionId) {
  const { data, error } = await supabase.rpc("league_get_standings", {
    p_league_token: leagueToken,
    p_competition_id: competitionId,
  });
  if (error) {
    console.error("[league] get_standings failed", error);
    throw error;
  }
  return data;
}

// League write — correct a completed fixture's score (mig 201).
export async function leagueUpdateFixtureResult(leagueToken, fixtureId, homeScore, awayScore, reason) {
  const { data, error } = await supabase.rpc("league_update_fixture_result", {
    p_league_token: leagueToken,
    p_fixture_id: fixtureId,
    p_home_score: homeScore,
    p_away_score: awayScore,
    p_reason: reason,
  });
  if (error) {
    console.error("[league] update_fixture_result failed", error);
    throw error;
  }
  return data;
}

// League write — postpone/void/walkover/forfeit (mig 202).
export async function leagueUpdateFixtureStatus(leagueToken, fixtureId, newStatus, metadata) {
  const { data, error } = await supabase.rpc("league_update_fixture_status", {
    p_league_token: leagueToken,
    p_fixture_id: fixtureId,
    p_new_status: newStatus,
    p_metadata: metadata || {},
  });
  if (error) {
    console.error("[league] update_fixture_status failed", error);
    throw error;
  }
  return data;
}

// League write — reschedule a fixture's date/time (mig 203).
export async function leagueRescheduleFixture(leagueToken, fixtureId, scheduledDate, kickoffTime, reason) {
  const { data, error } = await supabase.rpc("league_reschedule_fixture", {
    p_league_token: leagueToken,
    p_fixture_id: fixtureId,
    p_scheduled_date: scheduledDate,
    p_kickoff_time: kickoffTime,
    p_reason: reason || null,
  });
  if (error) {
    console.error("[league] reschedule_fixture failed", error);
    throw error;
  }
  return data;
}

export async function joinGetLeagueByCode(leagueCode) {
  if (!leagueCode) return null;
  const { data, error } = await supabase.rpc("join_get_league_by_code", {
    p_league_code: leagueCode,
  });
  if (error) {
    console.error("[join] get_league_by_code failed", error);
    throw error;
  }
  return data;
}

export async function getLeagueStandingsForPlayer(playerToken) {
  if (!playerToken) return null;
  const { data, error } = await supabase.rpc("get_league_standings_for_player", {
    p_token: playerToken,
  });
  if (error) {
    console.error("[league_standings] get_for_player failed", error);
    throw error;
  }
  return data;
}

// League Mode Phase 5 Cycle 5.3 — player-facing competition fixtures.
// filter: 'upcoming' | 'past' | 'all'. Casual tokens return { fixtures: [] }.
export async function getPlayerCompetitionFixtures(playerToken, filter = "all") {
  if (!playerToken) return null;
  const { data, error } = await supabase.rpc("get_player_competition_fixtures", {
    p_token: playerToken,
    p_filter: filter,
  });
  if (error) {
    console.error("[competition_fixtures] get_for_player failed", error);
    throw error;
  }
  return data;
}

// League Mode Phase 5 Cycle 5.4 — fixture detail + opposition intel.
// Token-gated to the player's own competitions; a foreign fixture id throws.
export async function getPlayerFixtureDetail(playerToken, fixtureId) {
  if (!playerToken || !fixtureId) return null;
  const { data, error } = await supabase.rpc("get_player_fixture_detail", {
    p_token: playerToken,
    p_fixture_id: fixtureId,
  });
  if (error) {
    console.error("[fixture_detail] get_for_player failed", error);
    throw error;
  }
  return data;
}

export async function getFixtureOppositionIntel(playerToken, fixtureId) {
  if (!playerToken || !fixtureId) return null;
  const { data, error } = await supabase.rpc("get_fixture_opposition_intel", {
    p_token: playerToken,
    p_fixture_id: fixtureId,
  });
  if (error) {
    console.error("[opposition_intel] get_for_player failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 3 Cycle 3.1 ref pre-match read ──────────────────────

export async function getFixtureStateByRefToken(refToken) {
  if (!refToken) return null;
  const { data, error } = await supabase.rpc("get_fixture_state_by_ref_token", {
    p_ref_token: refToken,
  });
  if (error) {
    console.error("[ref] get_fixture_state failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 3 Cycle 3.2 ref live-match writes (mig 120) ─────────
// All RPCs are SECURITY DEFINER + token-gated. Every successful write triggers
// notify_team_change broadcasts for both teams (home + away) so each side's
// admin tab updates in real time via App.jsx's team_live:* subscriber.
// clientEventId is a UUID generated per tap — duplicates are idempotent (the
// server upserts on conflict) so offline replay is safe.

export async function refStartMatch(refToken, clientEventId, localTimestamp) {
  const { data, error } = await supabase.rpc("ref_start_match", {
    p_ref_token:       refToken,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] start_match failed", error); throw error; }
  return data;
}

export async function refRecordGoal(refToken, { playerId, minute, period, clientEventId, ownGoal = false, localTimestamp }) {
  const { data, error } = await supabase.rpc("ref_record_goal", {
    p_ref_token:       refToken,
    p_player_id:       playerId,
    p_minute:          minute,
    p_period:          period,
    p_client_event_id: clientEventId,
    p_own_goal:        ownGoal,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] record_goal failed", error); throw error; }
  return data;
}

export async function refRecordCard(refToken, { playerId, minute, period, colour, clientEventId, localTimestamp }) {
  const { data, error } = await supabase.rpc("ref_record_card", {
    p_ref_token:       refToken,
    p_player_id:       playerId,
    p_minute:          minute,
    p_period:          period,
    p_colour:          colour,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] record_card failed", error); throw error; }
  return data;
}

export async function refRecordSubstitution(refToken, { onPlayerId, offPlayerId, minute, period, clientEventId, localTimestamp }) {
  const { data, error } = await supabase.rpc("ref_record_substitution", {
    p_ref_token:       refToken,
    p_on_player_id:    onPlayerId,
    p_off_player_id:   offPlayerId,
    p_minute:          minute,
    p_period:          period,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] record_substitution failed", error); throw error; }
  return data;
}

export async function refSetPeriod(refToken, period, clientEventId, localTimestamp) {
  const { data, error } = await supabase.rpc("ref_set_period", {
    p_ref_token:       refToken,
    p_period:          period,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] set_period failed", error); throw error; }
  return data;
}

export async function refUndoEvent(refToken, clientEventId) {
  const { data, error } = await supabase.rpc("ref_undo_event", {
    p_ref_token:       refToken,
    p_client_event_id: clientEventId,
  });
  if (error) { console.error("[ref] undo_event failed", error); throw error; }
  return data;
}

export async function refConfirmFullTime(refToken) {
  const { data, error } = await supabase.rpc("ref_confirm_full_time", {
    p_ref_token: refToken,
  });
  if (error) { console.error("[ref] confirm_full_time failed", error); throw error; }
  return data;
}

// Phase 11 Cycle 11.2 — knockout decider. Called when a cup tie is level at full time
// (refConfirmFullTime returned { needs_decider: true }). Pass aet (extra-time aggregate)
// and/or pens scores; the winner must match the higher of whichever decider is given.
export async function refRecordKnockoutDecider(refToken, { aetHome = null, aetAway = null, pensHome = null, pensAway = null, winnerTeamId }) {
  const { data, error } = await supabase.rpc("ref_record_knockout_decider", {
    p_ref_token: refToken,
    p_aet_home: aetHome, p_aet_away: aetAway,
    p_pens_home: pensHome, p_pens_away: pensAway,
    p_winner_team_id: winnerTeamId,
  });
  if (error) { console.error("[ref] record_knockout_decider failed", error); throw error; }
  return data;
}

// ─── Ref V2 (RefSix-killer, migs 264/267) — clock pause, incident note, sin bin,
// added time, and the league match-format config write. Same idempotent-on-clientEventId
// contract as the Phase 3 ref writes; all broadcast venue_live so the big screen reacts.

export async function refSetClock(refToken, action, clientEventId, localTimestamp) {
  const { data, error } = await supabase.rpc("ref_set_clock", {
    p_ref_token:       refToken,
    p_action:          action, // 'pause' | 'resume'
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] set_clock failed", error); throw error; }
  return data;
}

export async function refRecordNote(refToken, { text, playerId = null, minute, period, clientEventId, localTimestamp }) {
  const { data, error } = await supabase.rpc("ref_record_note", {
    p_ref_token:       refToken,
    p_text:            text,
    p_player_id:       playerId,
    p_minute:          minute,
    p_period:          period,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] record_note failed", error); throw error; }
  return data;
}

export async function refRecordSinBin(refToken, { playerId, minute, period, durationMin, clientEventId, localTimestamp }) {
  const { data, error } = await supabase.rpc("ref_record_sin_bin", {
    p_ref_token:       refToken,
    p_player_id:       playerId,
    p_minute:          minute,
    p_period:          period,
    p_duration_min:    durationMin,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] record_sin_bin failed", error); throw error; }
  return data;
}

export async function refSetAddedTime(refToken, { period, minutes, clientEventId, localTimestamp }) {
  const { data, error } = await supabase.rpc("ref_set_added_time", {
    p_ref_token:       refToken,
    p_period:          period,
    p_minutes:         minutes,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] set_added_time failed", error); throw error; }
  return data;
}

// ─── Phase 0d (mig 374) — live-match single-writer clock-owner lock ───────────
// Among the devices holding the SAME ref_token (phone apps/ref + the future
// watch), only ONE owns the clock at a time (lease-based, 30s). Replaces today's
// last-write-wins jitter. SHIPS DORMANT: the clock-write RPCs do not yet REJECT a
// non-owner — these wrappers drive the ⌚CTRL badge + auto-claim; server-side
// enforcement is flipped on after the real phone+watch concurrency rehearsal.
// CONSUMERS (Hard Rule #14): apps/ref (now) + watchOS companion (later).

export async function refClaimClock(refToken, deviceId, deviceKind = "ref", force = false) {
  const { data, error } = await supabase.rpc("ref_claim_clock", {
    p_ref_token:   refToken,
    p_device_id:   deviceId,
    p_device_kind: deviceKind, // 'phone' | 'watch' | 'ref'
    p_force:       force,       // explicit "take control" from another device
  });
  if (error) { console.error("[ref] claim_clock failed", error); throw error; }
  return data; // { ok, granted, owner: { owner_id, owner_kind, claimed_at, expires_at, is_live } }
}

export async function refHeartbeatClock(refToken, deviceId) {
  const { data, error } = await supabase.rpc("ref_heartbeat_clock", {
    p_ref_token: refToken,
    p_device_id: deviceId,
  });
  if (error) { console.error("[ref] heartbeat_clock failed", error); throw error; }
  return data; // { ok, granted, owner }  — granted=false means this device lost control
}

export async function refReleaseClock(refToken, deviceId) {
  const { data, error } = await supabase.rpc("ref_release_clock", {
    p_ref_token: refToken,
    p_device_id: deviceId,
  });
  if (error) { console.error("[ref] release_clock failed", error); throw error; }
  return data; // { ok, released, owner }
}

export async function refCheckClockOwner(refToken, deviceId = null) {
  const { data, error } = await supabase.rpc("ref_check_clock_owner", {
    p_ref_token: refToken,
    p_device_id: deviceId,
  });
  if (error) { console.error("[ref] check_clock_owner failed", error); throw error; }
  return data; // { ok, owner, has_live_owner, is_owner }
}

// Casual-ref activation validator (mig 374) — lists casual refs assigned
// (matches.ref_player_id) whose player account is not yet linked, so an operator
// can chase activation. Admin-token-scoped, read-only. Consumer: inorout admin.
export async function validateCasualRefActivations(adminToken) {
  const { data, error } = await supabase.rpc("validate_casual_ref_activations", {
    p_admin_token: adminToken,
  });
  if (error) { console.error("[admin] validate_casual_ref_activations failed", error); throw error; }
  return data; // { ok, team_id, unactivated_count, unactivated: [...] }
}

// ── watchOS companion — identity layer (mig 369) ─────────────────────────────
// Net-new ref/official identity. The watch (supabase-swift) calls these RPCs
// directly; these JS wrappers exist for the web admin surfaces (casual ref-slot
// toggle in inorout, official-link + cohort-official in the venue dashboard) and
// to keep raw RPC names confined to this file. See RPCS.md (consumer = watchOS).

// Resolver — auth.uid() → next relevant game across league + casual (+ ref_token).
// Shape: { ok, game_count, next: <game|null>, games: [<game>...] }.
// Thin wrapper over get_my_assignments (mig 372); Swift-locked shape preserved.
export async function getMyNextAssignment(roleFilter = null) {
  const { data, error } = await supabase.rpc("get_my_next_assignment", {
    p_role_filter: roleFilter,
  });
  if (error) { console.error("[watch] get_my_next_assignment failed", error); throw error; }
  return data;
}

// Shared ref-assignment list (mig 372) — the ONE source both apps/ref and watchOS consume.
// Shape: { ok, game_count, games: [<game>...] }. Same per-game shape as getMyNextAssignment.
export async function getMyAssignments(roleFilter = null) {
  const { data, error } = await supabase.rpc("get_my_assignments", {
    p_role_filter: roleFilter,
  });
  if (error) { console.error("[spine] get_my_assignments failed", error); throw error; }
  return data;
}

// Completed officiated games for the signed-in ref (mig 441) — the read-only "Past"
// arm of RefFixtures. SEPARATE from get_my_assignments (Swift-locked, live+upcoming
// only). Shape: { ok, game_count, games: [<game + home_score/away_score>...] }.
// Consumer: apps/inorout RefFixtures.jsx.
export async function getMyOfficiatingHistory(limit = 50) {
  const { data, error } = await supabase.rpc("get_my_officiating_history", {
    p_limit: limit,
  });
  if (error) { console.error("[spine] get_my_officiating_history failed", error); throw error; }
  return data;
}

// Referee PR #4 (mig 443) — the signed-in ref's TOURNAMENT assignments (Event OS
// fixtures, home_competition_team_id NOT NULL). SEPARATE parallel reader to the
// Swift-locked get_my_assignments (untouched); identical per-game shape with
// context='tournament'. Merged client-side into RefFixtures alongside league/casual.
export async function getMyTournamentAssignments() {
  const { data, error } = await supabase.rpc("get_my_tournament_assignments", {});
  if (error) { console.error("[spine] get_my_tournament_assignments failed", error); throw error; }
  return data;
}

// Referee PR #3 (mig 442) — the ref's own accept/decline responses + upcoming
// unavailability windows. Merged client-side into RefFixtures (the Swift-locked
// get_my_assignments stays untouched). Shape: { ok, responses:[...], unavailability:[...] }.
export async function getMyRefStatus() {
  const { data, error } = await supabase.rpc("get_my_ref_status", {});
  if (error) { console.error("[ref] get_my_ref_status failed", error); throw error; }
  return data;
}

// Ref accepts or declines a specific assignment (context = 'league' | 'casual',
// gameId = fixtures.id / matches.id, response = 'accepted' | 'declined'). mig 442.
export async function refRespondToAssignment(context, gameId, response) {
  const { data, error } = await supabase.rpc("ref_respond_to_assignment", {
    p_context:  context,
    p_game_id:  gameId,
    p_response: response,
  });
  if (error) { console.error("[ref] ref_respond_to_assignment failed", error); throw error; }
  return data;
}

// Ref adds a blackout date range (start/end are 'YYYY-MM-DD'). mig 442.
export async function refAddUnavailability(start, end, note = null) {
  const { data, error } = await supabase.rpc("ref_add_unavailability", {
    p_start: start,
    p_end:   end,
    p_note:  note,
  });
  if (error) { console.error("[ref] ref_add_unavailability failed", error); throw error; }
  return data;
}

// Ref removes one of their own unavailability windows by id. mig 442.
export async function refRemoveUnavailability(id) {
  const { data, error } = await supabase.rpc("ref_remove_unavailability", {
    p_id: id,
  });
  if (error) { console.error("[ref] ref_remove_unavailability failed", error); throw error; }
  return data;
}

// Operator surface (mig 442) — per-fixture ref accept/decline + each official's
// upcoming unavailability for the venue's league fixtures. Merged into venue state.
export async function venueGetRefResponses(venueToken) {
  const { data, error } = await supabase.rpc("venue_get_ref_responses", {
    p_venue_token: venueToken,
  });
  if (error) { console.error("[ref] venue_get_ref_responses failed", error); throw error; }
  return data;
}

// Ref self-claims every match_officials card matching their verified auth email.
export async function refLinkSelfToOfficial() {
  const { data, error } = await supabase.rpc("ref_link_self_to_official", {});
  if (error) { console.error("[watch] ref_link_self_to_official failed", error); throw error; }
  return data;
}

// Operator binds an official card to whichever auth user owns p_email.
export async function venueLinkOfficialToUser(venueToken, officialId, email) {
  const { data, error } = await supabase.rpc("venue_link_official_to_user", {
    p_venue_token: venueToken,
    p_official_id: officialId,
    p_email:       email,
  });
  if (error) { console.error("[watch] venue_link_official_to_user failed", error); throw error; }
  return data;
}

// Assign (or clear, playerId=null) a squad member as the active casual match's ref.
export async function assignCasualMatchRef(adminToken, matchId, playerId) {
  const { data, error } = await supabase.rpc("assign_casual_match_ref", {
    p_admin_token: adminToken,
    p_match_id:    matchId,
    p_player_id:   playerId,
  });
  if (error) { console.error("[watch] assign_casual_match_ref failed", error); throw error; }
  return data;
}

// Set (or clear, officialId=null) a club cohort's default official.
export async function clubAdminAssignCohortOfficial(venueToken, cohortId, officialId) {
  const { data, error } = await supabase.rpc("club_admin_assign_cohort_official", {
    p_venue_token: venueToken,
    p_cohort_id:   cohortId,
    p_official_id: officialId,
  });
  if (error) { console.error("[watch] club_admin_assign_cohort_official failed", error); throw error; }
  return data;
}

// ── watchOS companion — Phase 4 match-health storage (mig 375) ────────────────
// The watch posts an Apple "Outdoor Football" workout SUMMARY (never the raw stream —
// UK-GDPR special category) on Full Time; inorout reads it back for the fitness surface.
// Both RPCs are authenticated-only (auth.uid()). Consumers: watchOS (writer) + inorout (reader).

// Watch → DB. Idempotent upsert keyed on (auth.uid(), clientSessionId) so an offline
// replay never double-writes. matchContext ∈ 'league'|'casual'|'cohort'. Returns { ok, id, updated }.
export async function saveMatchHealthSummary({
  matchContext, matchRef, clientSessionId,
  durationSeconds = null, activeEnergyKcal = null, distanceMeters = null,
  avgHr = null, maxHr = null, hrZones = null, startedAt = null, endedAt = null,
  source = null, route = null,
}) {
  const { data, error } = await supabase.rpc("save_match_health_summary", {
    p_match_context:      matchContext,
    p_match_ref:          matchRef,
    p_client_session_id:  clientSessionId,
    p_duration_seconds:   durationSeconds,
    p_active_energy_kcal: activeEnergyKcal,
    p_distance_meters:    distanceMeters,
    p_avg_hr:             avgHr,
    p_max_hr:             maxHr,
    p_hr_zones:           hrZones,
    p_started_at:         startedAt,
    p_ended_at:           endedAt,
    p_source:             source,   // mig 456: 'apple_health_manual' | 'watch_app'
    p_route:              route,    // mig 456: heatmap track jsonb (outdoor only) → match_health_routes
  });
  if (error) { console.error("[health] save_match_health_summary failed", error); throw error; }
  return data;
}

// Read-back for the inorout "Your match fitness" surface. Returns { ok, sessions:[…], totals:{…} };
// empty for a non-signed-in / token-only caller (so the surface self-hides).
export async function getMyMatchHealth() {
  const { data, error } = await supabase.rpc("get_my_match_health", {});
  if (error) { console.error("[health] get_my_match_health failed", error); throw error; }
  return data;
}

// Per-match fitness card (mig 456). Returns { ok, rows:[{ session_id, is_self, player_name, … ,
// source, has_route, started_at, ended_at }…] }: own row always (first); teammate rows ONLY when
// the match is casual AND that player set share_match_fitness. Ships DARK (self-hides when empty).
export async function getMatchHealthForMatch(matchRef) {
  const { data, error } = await supabase.rpc("get_match_health_for_match", { p_match_ref: matchRef });
  if (error) { console.error("[health] get_match_health_for_match failed", error); throw error; }
  return data;
}

// Heatmap track for one session (mig 456), OWN session only. Returns { ok, track: <jsonb|null> }
// (null when not the owner or no route stored — outdoor games only).
export async function getMatchRoute(sessionId) {
  const { data, error } = await supabase.rpc("get_match_route", { p_session_id: sessionId });
  if (error) { console.error("[health] get_match_route failed", error); throw error; }
  return data;
}

// Teammate-sharing consent (mig 457). Returns { ok, share_match_fitness } — the caller's current
// global consent (bool_or across their player rows). Returns OFF for token-only/unauth callers.
export async function getMyShareMatchFitness() {
  const { data, error } = await supabase.rpc("get_my_share_match_fitness", {});
  if (error) { console.error("[health] get_my_share_match_fitness failed", error); throw error; }
  return data;
}

// Sets the caller's global match-fitness sharing consent across ALL their player rows (mig 457).
// Returns { ok, share_match_fitness, rows_updated }.
export async function setShareMatchFitness(value) {
  const { data, error } = await supabase.rpc("set_share_match_fitness", { p_value: value });
  if (error) { console.error("[health] set_share_match_fitness failed", error); throw error; }
  return data;
}

// Fitness-in-balancing consent (mig 502) — SEPARATE from the display consent above. A distinct
// default-OFF switch permitting a player's match fitness to be used as an admin-only team-balancing
// signal (new DPIA Purpose 3). Global across the caller's player rows (bool_or). Ships dark until
// PR #5 reads it. Returns { ok, use_fitness_for_balancing }.
export async function getMyUseFitnessForBalancing() {
  const { data, error } = await supabase.rpc("get_my_use_fitness_for_balancing", {});
  if (error) { console.error("[health] get_my_use_fitness_for_balancing failed", error); throw error; }
  return data;
}

// Sets the caller's global fitness-in-balancing consent across ALL their player rows (mig 502).
// Returns { ok, use_fitness_for_balancing, rows_updated }.
export async function setUseFitnessForBalancing(value) {
  const { data, error } = await supabase.rpc("set_use_fitness_for_balancing", { p_value: value });
  if (error) { console.error("[health] set_use_fitness_for_balancing failed", error); throw error; }
  return data;
}

// ADMIN-ONLY fitness reader for the team balancer's second axis (mig 503). Returns per-player
// NORMALISED 0–1 fitness scalars — NEVER raw HR/kcal/distance — for consented adults only (guests +
// U18 excluded server-side). team_id derived from the admin token. Returns
// { ok, team_id, players:[{player_id, fitness, games}] }. The fitness scalar must NEVER ride a
// player-visible return (Hard Rule #12 leakage) — read at exactly one admin call site (AdminView).
export async function getSquadFitnessForBalancer(adminToken) {
  if (!adminToken) return { ok: false, players: [] };
  const { data, error } = await supabase.rpc("get_squad_fitness_for_balancer", { p_admin_token: adminToken });
  if (error) { console.error("[health] get_squad_fitness_for_balancer failed", error); throw error; }
  return data;
}

// Per-opponent fitness compare over the casual games you BOTH played (mig 475). Returns
// { ok, opponent_consented, shared_games, me:{…}, them:{…}|null, buckets[] } — `them` populated
// only when you actually co-played AND the opponent consented AND is 18+ (anti-probing). `buckets`
// is YOUR own monthly series (period_start + source_counts) across the shared games. Distances in
// metres — format with formatDistance. period ∈ 'month'|'season'|'all'.
export async function getH2hMatchFitness(opponentPlayerId, period = "all") {
  const { data, error } = await supabase.rpc("get_h2h_match_fitness", {
    p_opponent_player_id: opponentPlayerId,
    p_period:             period,
  });
  if (error) { console.error("[health] get_h2h_match_fitness failed", error); throw error; }
  return data;
}

// The recurring squad's fitness board (mig 475). Returns { ok, min_cohort_met, rows:[{ player_id,
// player_name, is_self, games, avg_distance, total_distance, avg_kcal, avg_hr, most_improved_pct }…],
// buckets[] }. Own row always; other members only when consented + 18+; below the min-N floor the
// board collapses to the self row. Membership is verified server-side. period ∈ 'month'|'season'|'all'.
// monthAnchor ('YYYY-MM', mig 575) scopes the board to that exact month when period === 'month';
// null (the default / every non-month caller) keeps the legacy current-month / current-year / all-time
// behaviour. Consumers: apps/inorout MatchFitnessSection (Stats tab).
export async function getSquadFitnessLeaderboard(teamId, period = "all", monthAnchor = null) {
  const { data, error } = await supabase.rpc("get_squad_fitness_leaderboard", {
    p_team_id:      teamId,
    p_period:       period,
    p_month_anchor: monthAnchor,
  });
  if (error) { console.error("[health] get_squad_fitness_leaderboard failed", error); throw error; }
  return data;
}

// Detach a wrongly-attached workout (mig 475; re-keyed to the session uuid in mig 476 — the handle
// get_match_health_for_match returns). Own-row-only DELETE; the route row cascades away; a
// server-side audit row is written. Returns { ok, deleted, id }. Throws 'not_found' if the session
// isn't the caller's.
export async function deleteMatchHealthSession(sessionId) {
  const { data, error } = await supabase.rpc("delete_match_health_session", {
    p_session_id: sessionId,
  });
  if (error) { console.error("[health] delete_match_health_session failed", error); throw error; }
  return data;
}

// ── Tournament match-day RPCs (Phase 5 Event OS) ──────────────────────────────
// Score tracked on fixtures.home_score/away_score directly — no match_events rows.
// match_events.team_id FK to teams blocks tournament competition_team ids.

export async function refStartTournamentMatch(refToken, clientEventId, localTimestamp) {
  const { data, error } = await supabase.rpc("ref_start_tournament_match", {
    p_ref_token:       refToken,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] start_tournament_match failed", error); throw error; }
  return data;
}

export async function refSetTournamentPeriod(refToken, period, clientEventId, localTimestamp) {
  const { data, error } = await supabase.rpc("ref_set_tournament_period", {
    p_ref_token:       refToken,
    p_period:          period,
    p_client_event_id: clientEventId,
    p_local_timestamp: localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] set_tournament_period failed", error); throw error; }
  return data;
}

export async function refRecordTournamentGoal(refToken, { side, minute, period, clientEventId, playerId = null, playerNameOverride = null, ownGoal = false, localTimestamp }) {
  const { data, error } = await supabase.rpc("ref_record_tournament_goal", {
    p_ref_token:            refToken,
    p_side:                 side,
    p_minute:               minute,
    p_period:               period,
    p_client_event_id:      clientEventId,
    p_player_id:            playerId,
    p_player_name_override: playerNameOverride,
    p_own_goal:             ownGoal,
    p_local_timestamp:      localTimestamp ?? new Date().toISOString(),
  });
  if (error) { console.error("[ref] record_tournament_goal failed", error); throw error; }
  return data;
}

export async function refUndoTournamentGoal(refToken, side) {
  const { data, error } = await supabase.rpc("ref_undo_tournament_goal", {
    p_ref_token: refToken,
    p_side:      side,
  });
  if (error) { console.error("[ref] undo_tournament_goal failed", error); throw error; }
  return data;
}

export async function refConfirmTournamentMatch(refToken) {
  const { data, error } = await supabase.rpc("ref_confirm_tournament_match", {
    p_ref_token: refToken,
  });
  if (error) { console.error("[ref] confirm_tournament_match failed", error); throw error; }
  return data;
}

export async function clubAdminGetStandings(tournamentEventId, competitionId) {
  const { data, error } = await supabase.rpc("club_admin_get_standings", {
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
  });
  if (error) { console.error("[club] get_standings failed", error); throw error; }
  return data;
}

export async function clubAdminSeedKnockout(tournamentEventId, competitionId) {
  const { data, error } = await supabase.rpc("club_admin_seed_knockout", {
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
  });
  if (error) { console.error("[club] seed_knockout failed", error); throw error; }
  return data;
}

export async function clubAdminSeedDoubleElimination(tournamentEventId, competitionId) {
  const { data, error } = await supabase.rpc("club_admin_seed_double_elimination", {
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
  });
  if (error) { console.error("[club] seed_double_elimination failed", error); throw error; }
  return data;
}

export async function refRecordTournamentCard(refToken, competitionTeamId, playerName, cardType, minuteVal, period) {
  const { data, error } = await supabase.rpc("ref_record_tournament_card", {
    p_ref_token:           refToken,
    p_competition_team_id: competitionTeamId,
    p_player_name:         playerName,
    p_card_type:           cardType,
    p_minute:              minuteVal,
    p_period:              period,
  });
  if (error) { console.error("[ref] record_tournament_card failed", error); throw error; }
  return data;
}

export async function getTournamentSuspensionList(tournamentEventId, competitionId) {
  const { data, error } = await supabase.rpc("get_tournament_suspension_list", {
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
  });
  if (error) { console.error("[club] get_suspension_list failed", error); throw error; }
  return data;
}

// Match-format config write — callable by a venue admin/staff token OR a super admin
// (resolve_venue_caller handles both). league-tier of the layered match_format resolution.
export async function updateLeagueConfig(token, leagueId, config) {
  const { data, error } = await supabase.rpc("update_league_config", {
    p_token:     token,
    p_league_id: leagueId,
    p_config:    config,
  });
  if (error) { console.error("[league] update_league_config failed", error); throw error; }
  return data;
}

// Phase 11 Cycle 11.3 — read a competition's full single-elim bracket (rounds → ties,
// scores, decider detail, champion). Public match data, keyed by competition_id; used by
// the venue bracket/scheduling UI, the player bracket view, and the display board.
export async function getCupBracket(competitionId) {
  const { data, error } = await supabase.rpc("get_cup_bracket", { p_competition_id: competitionId });
  if (error) { console.error("[cup] get_cup_bracket failed", error); throw error; }
  return data;
}

// Phase 11 Cycle 11.2 — venue schedules a 'ready' next-round cup tie (date/time/pitch).
export async function venueScheduleCupTie(venueToken, tieId, scheduledDate, kickoffTime, playingAreaId = null) {
  const { data, error } = await supabase.rpc("venue_schedule_cup_tie", {
    p_venue_token: venueToken,
    p_tie_id: tieId,
    p_scheduled_date: scheduledDate,
    p_kickoff_time: kickoffTime,
    p_playing_area_id: playingAreaId,
  });
  if (error) { console.error("[venue] schedule_cup_tie failed", error); throw error; }
  return data;
}

// ─── League Mode — Phase 2 Cycle 2.3 season setup ────────────────────────────

export async function venueCreateSeason(venueToken, season) {
  const { data, error } = await supabase.rpc("venue_create_season", {
    p_venue_token: venueToken,
    p_season: season,
  });
  if (error) {
    console.error("[venue] create_season failed", error);
    throw error;
  }
  return data;
}

export async function venueGenerateFixtures(venueToken, competitionId, fixtures) {
  const { data, error } = await supabase.rpc("venue_generate_fixtures", {
    p_venue_token: venueToken,
    p_competition_id: competitionId,
    p_fixtures: fixtures,
  });
  if (error) {
    console.error("[venue] generate_fixtures failed", error);
    throw error;
  }
  return data;
}

// Phase 11 Cycle 11.1 — single-elimination cup: server builds the whole bracket
// (cup_rounds + cup_ties + round-1 fixtures) from the seeded team order. Used instead
// of venueGenerateFixtures for single_elimination cups. seedTeamIds is the ordered seed
// list (top seeds first); unseeded active teams are appended server-side.
export async function venuePersistCupBracket(venueToken, competitionId, scheduledDate, kickoffTime, playingAreaIds, seedTeamIds) {
  const { data, error } = await supabase.rpc("venue_persist_cup_bracket", {
    p_venue_token: venueToken,
    p_competition_id: competitionId,
    p_scheduled_date: scheduledDate,
    p_kickoff_time: kickoffTime,
    p_playing_area_ids: playingAreaIds || [],
    p_seed_team_ids: seedTeamIds || null,
  });
  if (error) {
    console.error("[venue] persist_cup_bracket failed", error);
    throw error;
  }
  return data;
}

// Phase 11 Cycle 11.4a — group-stage cup: server draws active teams into N groups
// (snake by registration order, or operator-supplied groupAssignments {team_id: 'A'})
// and generates a round-robin per group. Used instead of venuePersistCupBracket for
// the group_stage format. The knockout half is seeded later (11.4b) from group results.
export async function venuePersistGroupStage(venueToken, competitionId, numGroups, qualifiersPerGroup, scheduledDate, kickoffTime, playingAreaIds, groupAssignments = null) {
  const { data, error } = await supabase.rpc("venue_persist_group_stage", {
    p_venue_token: venueToken,
    p_competition_id: competitionId,
    p_num_groups: numGroups,
    p_qualifiers_per_group: qualifiersPerGroup,
    p_scheduled_date: scheduledDate,
    p_kickoff_time: kickoffTime,
    p_playing_area_ids: playingAreaIds || [],
    p_group_assignments: groupAssignments || null,
  });
  if (error) { console.error("[venue] persist_group_stage failed", error); throw error; }
  return data;
}

// Phase 11 Cycle 11.4a — per-group mini-league tables for a group_stage cup.
// Returns { groups:[{group_label, qualifiers_per_group, standings:[...]}], all_groups_complete }.
export async function getGroupStandings(competitionId) {
  const { data, error } = await supabase.rpc("get_group_standings", { p_competition_id: competitionId });
  if (error) { console.error("[cup] get_group_standings failed", error); throw error; }
  return data;
}

// Phase 11 Cycle 11.4b — operator "Build knockout": seeds the knockout bracket from final
// group standings (cross-group). Only valid once every group fixture is completed.
export async function venueSeedKnockoutFromGroups(venueToken, competitionId, scheduledDate, kickoffTime, playingAreaIds = []) {
  const { data, error } = await supabase.rpc("venue_seed_knockout_from_groups", {
    p_venue_token: venueToken,
    p_competition_id: competitionId,
    p_scheduled_date: scheduledDate,
    p_kickoff_time: kickoffTime,
    p_playing_area_ids: playingAreaIds || [],
  });
  if (error) { console.error("[venue] seed_knockout_from_groups failed", error); throw error; }
  return data;
}

// ─── League Mode — Phase 2 Cycle 2.4 fixture management ──────────────────────

export async function venueAssignPitch(venueToken, fixtureId, playingAreaId) {
  const { data, error } = await supabase.rpc("venue_assign_pitch", {
    p_venue_token: venueToken,
    p_fixture_id: fixtureId,
    p_playing_area_id: playingAreaId,
  });
  if (error) {
    console.error("[venue] assign_pitch failed", error);
    throw error;
  }
  return data;
}

// ─── Pitch Booking (Stages 3–5) ─────────────────────────────────────────────

export async function searchBookableVenues(query) {
  const { data, error } = await supabase.rpc("search_bookable_venues", { p_query: query ?? "" });
  if (error) { console.error("[booking] search_bookable_venues failed", error); throw error; }
  return data;
}

export async function getPitchFreeSlots(venueId, date, playingAreaId = null, slotLength = null) {
  const { data, error } = await supabase.rpc("get_pitch_free_slots", {
    p_venue_id: venueId,
    p_date: date,
    p_playing_area_id: playingAreaId,
    p_slot_length: slotLength,
  });
  if (error) { console.error("[booking] get_pitch_free_slots failed", error); throw error; }
  return data;
}

// Weekly-block free slots (mig 228): only slots free across ALL N weekly
// occurrences from startDate, so a block booking never fails on a later week.
// slot_start is week 1 — pass it straight to bookPitchSeries.
export async function getPitchFreeSlotsSeries(venueId, startDate, weeks, slotLength = null) {
  const { data, error } = await supabase.rpc("get_pitch_free_slots_series", {
    p_venue_id: venueId,
    p_start_date: startDate,
    p_weeks: weeks,
    p_slot_length: slotLength,
  });
  if (error) { console.error("[booking] get_pitch_free_slots_series failed", error); throw error; }
  return data;
}

export async function getTeamBookings(teamId) {
  const { data, error } = await supabase.rpc("get_team_bookings", { p_team_id: teamId });
  if (error) { console.error("[booking] get_team_bookings failed", error); throw error; }
  return data;
}

// Renewal right-of-first-refusal: team "keep my slot" on a held renewal series.
// Flips the held weeks to 'requested' (venue re-approves via the inbox).
export async function confirmRenewal(seriesId) {
  const { data, error } = await supabase.rpc("confirm_renewal", { p_series_id: seriesId });
  if (error) { console.error("[booking] confirm_renewal failed", error); throw error; }
  return data;
}

export async function bookPitchAdhoc(teamId, playingAreaId, bookingDate, kickoffTime, slotMinutes = null) {
  const { data, error } = await supabase.rpc("book_pitch_adhoc", {
    p_team_id: teamId,
    p_playing_area_id: playingAreaId,
    p_booking_date: bookingDate,
    p_kickoff_time: kickoffTime,
    p_slot_minutes: slotMinutes,
  });
  if (error) { console.error("[booking] book_pitch_adhoc failed", error); throw error; }
  return data;
}

export async function bookPitchSeries(teamId, playingAreaId, kickoffTime, startDate, weeks, slotMinutes = null) {
  const { data, error } = await supabase.rpc("book_pitch_series", {
    p_team_id: teamId,
    p_playing_area_id: playingAreaId,
    p_kickoff_time: kickoffTime,
    p_start_date: startDate,
    p_weeks: weeks,
    p_slot_minutes: slotMinutes,
  });
  if (error) { console.error("[booking] book_pitch_series failed", error); throw error; }
  return data;
}

// Cancel a booking. The optional `opts` carries the venue operator's
// cancellation reason/note and refund decision (mig 222): decision is
// 'full' | 'partial' | 'none' and acts on the booking's charge server-side.
// withinPolicy is the client's policy check (booking time vs cancellation_policy),
// recorded for the audit log. Existing 2-arg callers are unaffected (opts={}).
export async function cancelBooking(bookingId, venueToken = null, opts = {}) {
  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
    p_venue_token: venueToken,
    p_reason: opts.reason ?? null,
    p_note: opts.note ?? null,
    p_decision: opts.decision ?? null,
    p_within_policy: opts.withinPolicy ?? null,
  });
  if (error) { console.error("[booking] cancel_booking failed", error); throw error; }
  return data;
}

// Venue cancellations audit log (mig 222) — booking_cancelled rows for this
// venue with joined pitch/team/reason/refund detail, newest first.
export async function venueListCancellations(venueToken, limit = 200) {
  const { data, error } = await supabase.rpc("venue_list_cancellations", { p_venue_token: venueToken, p_limit: limit });
  if (error) { console.error("[booking] venue_list_cancellations failed", error); throw error; }
  return data;
}

// Venue customers / booker directory (mig 223, venue-domain only) — bookers at
// this venue (teams or walk-ins) aggregated from pitch_bookings + venue_charges:
// bookings_count, total_paid/outstanding pence, recency-based nudge_status.
// No casual-team data (ins/contacts) is read.
export async function venueListCustomers(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_customers", { p_venue_token: venueToken });
  if (error) { console.error("[booking] venue_list_customers failed", error); throw error; }
  return data;
}

// One customer's bookings at this venue (mig 226) — newest first, with charge
// (paid/due) and live in/target on upcoming team sessions. Venue-domain.
export async function venueGetCustomer(venueToken, bookerKey) {
  const { data, error } = await supabase.rpc("venue_get_customer", { p_venue_token: venueToken, p_booker_key: bookerKey });
  if (error) { console.error("[booking] venue_get_customer failed", error); throw error; }
  return data?.bookings ?? [];
}

// Live "ins" per upcoming team booking (mig 225) — map of booking_id →
// { team_id, in_count, target }. Counts only; no player identities. Refetch on
// a 'booking_ins_changed' venue broadcast for live updates.
export async function venueGetBookingIns(venueToken) {
  const { data, error } = await supabase.rpc("venue_get_booking_ins", { p_venue_token: venueToken });
  if (error) { console.error("[booking] venue_get_booking_ins failed", error); throw error; }
  return data?.ins ?? {};
}

// Request a nudge to a team booker (mig 224, server-side send). Records the
// request; the cron resolves the team admin contact + sends. Returns
// {ok, recipients} or {ok:false, reason:'no_contact'} (walk-ins / no contact).
export async function venueRequestNudge(venueToken, bookerKey, template = null) {
  const { data, error } = await supabase.rpc("venue_request_nudge", {
    p_venue_token: venueToken, p_booker_key: bookerKey, p_template: template,
  });
  if (error) { console.error("[booking] venue_request_nudge failed", error); throw error; }
  return data;
}

// ── Membership Phase 2 — per-person customer identity (venue_customers, mig 270) ──
// People directory — DISTINCT from venueListCustomers (which is booking-derived).
// Venue-ops authed (venue token / staff login venue_id). Read open to any member.
export async function venueListCustomersPeople(venueToken, includeErased = false) {
  const { data, error } = await supabase.rpc("venue_list_customers_people", {
    p_venue_token: venueToken, p_include_erased: includeErased,
  });
  if (error) { console.error("[membership] venue_list_customers_people failed", error); throw error; }
  return data?.customers ?? [];
}

// Shared 360Player-style registration fields (mig 282) → p_* params. Used by
// venueCreateCustomer / venueUpdateCustomer / memberSelfSignup so the three
// write paths stay in lockstep. Any field left undefined maps to null.
function registrationParams(r = {}) {
  const n = (v) => (v === undefined ? null : v);
  return {
    p_gender: n(r.gender),
    p_address_line1: n(r.addressLine1), p_address_line2: n(r.addressLine2),
    p_address_city: n(r.addressCity),   p_address_postcode: n(r.addressPostcode),
    p_emergency_name: n(r.emergencyName), p_emergency_relationship: n(r.emergencyRelationship),
    p_emergency_phone: n(r.emergencyPhone),
    p_medical_conditions: n(r.medicalConditions), p_allergies: n(r.allergies),
    p_medications: n(r.medications), p_gp_details: n(r.gpDetails),
    p_guardian_name: n(r.guardianName), p_guardian_relationship: n(r.guardianRelationship),
    p_guardian_phone: n(r.guardianPhone), p_guardian_email: n(r.guardianEmail),
    p_consent_data_processing: n(r.consentDataProcessing),
    p_consent_terms: n(r.consentTerms),
    p_consent_photo: n(r.consentPhoto),
    p_consent_medical: n(r.consentMedical),
  };
}

// Create a person (gated: manage_memberships). Throws 'customer_exists' (existing
// id in error DETAIL) on email de-dup; 'first_name_required' on blank name;
// 'consent_required' / 'guardian_required' / 'medical_consent_required' on the
// registration gates (mig 282).
export async function venueCreateCustomer(venueToken, reg = {}) {
  const { firstName, lastName = null, email = null, phone = null, dob = null, householdId = null, consentMarketing = false } = reg;
  const { data, error } = await supabase.rpc("venue_create_customer", {
    p_venue_token: venueToken, p_first_name: firstName, p_last_name: lastName,
    p_email: email, p_phone: phone, p_dob: dob, p_household_id: householdId,
    p_consent_marketing: consentMarketing,
    ...registrationParams(reg),
  });
  if (error) { console.error("[membership] venue_create_customer failed", error); throw error; }
  return data;
}

// Partial update — a null field is left UNCHANGED. (gated: manage_memberships)
export async function venueUpdateCustomer(venueToken, customerId, reg = {}) {
  const { firstName = null, lastName = null, email = null, phone = null, dob = null, householdId = null, consentMarketing = null, notes = null } = reg;
  const { data, error } = await supabase.rpc("venue_update_customer", {
    p_venue_token: venueToken, p_customer_id: customerId, p_first_name: firstName,
    p_last_name: lastName, p_email: email, p_phone: phone, p_dob: dob,
    p_household_id: householdId, p_consent_marketing: consentMarketing, p_notes: notes,
    ...registrationParams(reg),
  });
  if (error) { console.error("[membership] venue_update_customer failed", error); throw error; }
  return data;
}

// GDPR right-to-erasure — scrubs PII, keeps the row (status='erased'). (gated)
export async function venueEraseCustomer(venueToken, customerId) {
  const { data, error } = await supabase.rpc("venue_erase_customer", {
    p_venue_token: venueToken, p_customer_id: customerId,
  });
  if (error) { console.error("[membership] venue_erase_customer failed", error); throw error; }
  return data;
}

// ── Membership Phase 3 — tiers, pricing, enrolment, freeze, fees (mig 271) ──
// Tiers + per-cadence prices.
// prices = [{period:'monthly'|'quarterly'|'annual'|'season', price_pence, price_type?:'standard'|'family'|'sibling'}]
// audience ∈ 'all'|'adult'|'junior'|'child'; pricingModel ∈ 'recurring'|'season'
export async function venueCreateMembershipTier(venueToken, name, benefits = {}, prices = [], {
  audience = "all", pricingModel = "recurring", seasonStart = null, seasonEnd = null,
  prorationBasis = "none", joiningFeePence = 0,
} = {}) {
  const { data, error } = await supabase.rpc("venue_create_membership_tier", {
    p_venue_token: venueToken, p_name: name, p_benefits: benefits, p_prices: prices,
    p_audience: audience, p_pricing_model: pricingModel,
    p_season_start: seasonStart, p_season_end: seasonEnd,
    p_proration_basis: prorationBasis, p_joining_fee_pence: joiningFeePence,
  });
  if (error) { console.error("[membership] venue_create_membership_tier failed", error); throw error; }
  return data;
}

export async function venueUpdateMembershipTier(venueToken, tierId, {
  name = null, benefits = null, active = null, prices = null,
  audience = null, pricingModel = null, seasonStart = null, seasonEnd = null,
  prorationBasis = null, joiningFeePence = null,
} = {}) {
  const { data, error } = await supabase.rpc("venue_update_membership_tier", {
    p_venue_token: venueToken, p_tier_id: tierId, p_name: name, p_benefits: benefits,
    p_active: active, p_prices: prices,
    p_audience: audience, p_pricing_model: pricingModel,
    p_season_start: seasonStart, p_season_end: seasonEnd,
    p_proration_basis: prorationBasis, p_joining_fee_pence: joiningFeePence,
  });
  if (error) { console.error("[membership] venue_update_membership_tier failed", error); throw error; }
  return data;
}

export async function venueListMembershipTiers(venueToken, includeInactive = false) {
  const { data, error } = await supabase.rpc("venue_list_membership_tiers", {
    p_venue_token: venueToken, p_include_inactive: includeInactive,
  });
  if (error) { console.error("[membership] venue_list_membership_tiers failed", error); throw error; }
  return data?.tiers ?? [];
}

// Enrol a person (gated). period ∈ monthly|quarterly|annual. Throws 'already_member',
// 'price_not_set', 'customer_not_found', 'tier_not_found'. Mints the first charge.
export async function venueEnrolMembership(venueToken, customerId, tierId, period) {
  const { data, error } = await supabase.rpc("venue_enrol_membership", {
    p_venue_token: venueToken, p_customer_id: customerId, p_tier_id: tierId, p_period: period,
  });
  if (error) { console.error("[membership] venue_enrol_membership failed", error); throw error; }
  return data;
}

// Freeze (pause, no charge while frozen; renews_at pushed out). until = ISO date.
export async function venueFreezeMembership(venueToken, membershipId, until) {
  const { data, error } = await supabase.rpc("venue_freeze_membership", {
    p_venue_token: venueToken, p_membership_id: membershipId, p_until: until,
  });
  if (error) { console.error("[membership] venue_freeze_membership failed", error); throw error; }
  return data;
}

// Cancel — immediate=true ends now; false = end-of-period (status 'ending').
export async function venueCancelMembership(venueToken, membershipId, immediate = false) {
  const { data, error } = await supabase.rpc("venue_cancel_membership", {
    p_venue_token: venueToken, p_membership_id: membershipId, p_immediate: immediate,
  });
  if (error) { console.error("[membership] venue_cancel_membership failed", error); throw error; }
  return data;
}

export async function venueListMembers(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_members", { p_venue_token: venueToken });
  if (error) { console.error("[membership] venue_list_members failed", error); throw error; }
  return data?.members ?? [];
}

// Fees (team/booker level). plan period also allows 'weekly'.
export async function venueCreateFeePlan(venueToken, name, amountPence, period, sport = null) {
  const { data, error } = await supabase.rpc("venue_create_fee_plan", {
    p_venue_token: venueToken, p_name: name, p_amount_pence: amountPence, p_period: period, p_sport: sport,
  });
  if (error) { console.error("[membership] venue_create_fee_plan failed", error); throw error; }
  return data;
}

// Enrol a booker (memberKey = team id or booked-by name; teamId set when a team).
export async function venueEnrolFee(venueToken, planId, memberKey, teamId = null) {
  const { data, error } = await supabase.rpc("venue_enrol_fee", {
    p_venue_token: venueToken, p_plan_id: planId, p_member_key: memberKey, p_team_id: teamId,
  });
  if (error) { console.error("[membership] venue_enrol_fee failed", error); throw error; }
  return data;
}

export async function venueCancelFee(venueToken, subscriptionId) {
  const { data, error } = await supabase.rpc("venue_cancel_fee", {
    p_venue_token: venueToken, p_subscription_id: subscriptionId,
  });
  if (error) { console.error("[membership] venue_cancel_fee failed", error); throw error; }
  return data;
}

export async function venueListFeePlans(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_fee_plans", { p_venue_token: venueToken });
  if (error) { console.error("[membership] venue_list_fee_plans failed", error); throw error; }
  return data?.fee_plans ?? [];
}

// Member pass — PUBLIC read by the secret pass token (Phase 5, mig 272). Powers
// the member's /m/<token> PWA pass page. Returns {ok:false} for unknown/cancelled.
export async function getMemberPass(passToken) {
  const { data, error } = await supabase.rpc("get_member_pass", { p_token: passToken });
  if (error) { console.error("[membership] get_member_pass failed", error); throw error; }
  return data;
}

// Reception check-in (Phase 5, mig 274) — the display scans a member's pass QR and
// calls this with its own display token + the scanned value (full /m/ URL or bare
// token). Venue-bound server-side; returns a greeting payload {ok, first_name,
// tier_name, status, visit_count, already_checked_in} or {ok:false, reason}.
export async function memberCheckIn(displayToken, passToken) {
  const { data, error } = await supabase.rpc("member_check_in", { p_display_token: displayToken, p_pass_token: passToken });
  if (error) { console.error("[membership] member_check_in failed", error); throw error; }
  return data;
}

// Member self-signup (Phase 5, mig 275) — PUBLIC. A prospective member on the
// venue's /q/<code> landing taps "Join as a member"; this creates a `pending`
// venue_customers person the venue then approves. Idempotent on email. Returns
// {ok, already_registered, status} or {ok:false, reason}.
export async function memberSelfSignup(code, reg = {}) {
  const { firstName, lastName = null, email = null, phone = null, consentMarketing = false, tierId = null, dob = null } = reg;
  const { data, error } = await supabase.rpc("member_self_signup", {
    p_code: code, p_first_name: firstName, p_last_name: lastName,
    p_email: email, p_phone: phone, p_consent_marketing: consentMarketing, p_tier_id: tierId,
    p_dob: dob,
    ...registrationParams(reg),
  });
  if (error) { console.error("[membership] member_self_signup failed", error); throw error; }
  return data;
}

// The tier menu for the /q signup page (Phase 5+, mig 280) — PUBLIC, keyed by the
// venue's /q code. Returns {ok, tiers:[{tier_id, name, benefits, is_free, prices[]}]}.
export async function getVenueSignupTiers(code) {
  const { data, error } = await supabase.rpc("get_venue_signup_tiers", { p_code: code });
  if (error) { console.error("[membership] get_venue_signup_tiers failed", error); throw error; }
  return data;
}

// One-tap approve a pending self-signup AND enrol them on a tier (mig 280) — gated
// manage_memberships. Free tier → £0 active membership; paid → membership + charge.
export async function venueApproveAndEnrol(venueToken, customerId, tierId, period) {
  const { data, error } = await supabase.rpc("venue_approve_and_enrol", {
    p_venue_token: venueToken, p_customer_id: customerId, p_tier_id: tierId, p_period: period,
  });
  if (error) { console.error("[membership] venue_approve_and_enrol failed", error); throw error; }
  return data;
}

// Venue approve/reject a pending self-signup person (Phase 5, mig 275) — gated
// manage_memberships. p_approve=true → active, false → archived. Returns {ok, status}.
export async function venueApproveCustomer(venueToken, customerId, approve = true) {
  const { data, error } = await supabase.rpc("venue_approve_customer", { p_venue_token: venueToken, p_customer_id: customerId, p_approve: approve });
  if (error) { console.error("[membership] venue_approve_customer failed", error); throw error; }
  return data;
}

// ── Membership Phase 6 — partner perks + reporting (mig 273) ──
export async function venueCreatePartner(venueToken, name, contact = null) {
  const { data, error } = await supabase.rpc("venue_create_partner", { p_venue_token: venueToken, p_name: name, p_contact: contact });
  if (error) { console.error("[membership] venue_create_partner failed", error); throw error; }
  return data;
}

// tierIds = null/[] → all members; else only those tiers. code = null → show-your-pass.
export async function venueCreateOffer(venueToken, partnerId, title, { description = null, code = null, tierIds = null } = {}) {
  const { data, error } = await supabase.rpc("venue_create_offer", {
    p_venue_token: venueToken, p_partner_id: partnerId, p_title: title,
    p_description: description, p_code: code, p_tier_ids: tierIds,
  });
  if (error) { console.error("[membership] venue_create_offer failed", error); throw error; }
  return data;
}

export async function venueSetOfferActive(venueToken, offerId, active) {
  const { data, error } = await supabase.rpc("venue_set_offer_active", { p_venue_token: venueToken, p_offer_id: offerId, p_active: active });
  if (error) { console.error("[membership] venue_set_offer_active failed", error); throw error; }
  return data;
}

export async function venueListPartners(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_partners", { p_venue_token: venueToken });
  if (error) { console.error("[membership] venue_list_partners failed", error); throw error; }
  return data?.partners ?? [];
}

export async function venueMembershipSummary(venueToken) {
  const { data, error } = await supabase.rpc("venue_membership_summary", { p_venue_token: venueToken });
  if (error) { console.error("[membership] venue_membership_summary failed", error); throw error; }
  return data?.summary ?? {};
}

// Member-facing: log + reveal an offer's code (public, keyed by pass token).
export async function redeemMemberOffer(passToken, offerId) {
  const { data, error } = await supabase.rpc("redeem_member_offer", { p_pass_token: passToken, p_offer_id: offerId });
  if (error) { console.error("[membership] redeem_member_offer failed", error); throw error; }
  return data;
}

export async function cancelBookingSeries(seriesId, venueToken = null) {
  const { data, error } = await supabase.rpc("cancel_booking_series", { p_series_id: seriesId, p_venue_token: venueToken });
  if (error) { console.error("[booking] cancel_booking_series failed", error); throw error; }
  return data;
}

// Venue-operator booking writes (venue-token authed; consumed by apps/venue BookingsPanel).
export async function venueCreateBooking(venueToken, playingAreaId, bookingDate, kickoffTime, slotMinutes = null, teamId = null, bookedByName = null, contactEmail = null, contactPhone = null) {
  const { data, error } = await supabase.rpc("venue_create_booking", {
    p_venue_token: venueToken,
    p_playing_area_id: playingAreaId,
    p_booking_date: bookingDate,
    p_kickoff_time: kickoffTime,
    p_slot_minutes: slotMinutes,
    p_team_id: teamId,
    p_booked_by_name: bookedByName,
    p_contact_email: contactEmail,
    p_contact_phone: contactPhone,
  });
  if (error) { console.error("[booking] venue_create_booking failed", error); throw error; }
  return data;
}

// Venue-side weekly block (mig 232) — team-only; contact required. Mirrors the
// arg order of the RPC: (token, pitch, time, startDate, weeks, teamId, slot?, email?, phone?).
export async function venueCreateBookingSeries(venueToken, playingAreaId, kickoffTime, startDate, weeks, teamId, slotMinutes = null, contactEmail = null, contactPhone = null) {
  const { data, error } = await supabase.rpc("venue_create_booking_series", {
    p_venue_token: venueToken,
    p_playing_area_id: playingAreaId,
    p_kickoff_time: kickoffTime,
    p_start_date: startDate,
    p_weeks: weeks,
    p_team_id: teamId,
    p_slot_minutes: slotMinutes,
    p_contact_email: contactEmail,
    p_contact_phone: contactPhone,
  });
  if (error) { console.error("[booking] venue_create_booking_series failed", error); throw error; }
  return data;
}

export async function venueConfirmBooking(venueToken, bookingId) {
  const { data, error } = await supabase.rpc("venue_confirm_booking", { p_venue_token: venueToken, p_booking_id: bookingId });
  if (error) { console.error("[booking] venue_confirm_booking failed", error); throw error; }
  return data;
}

export async function venueDeclineBooking(venueToken, bookingId) {
  const { data, error } = await supabase.rpc("venue_decline_booking", { p_venue_token: venueToken, p_booking_id: bookingId });
  if (error) { console.error("[booking] venue_decline_booking failed", error); throw error; }
  return data;
}

// Confirm an ENTIRE weekly block in one transaction (mig 236). The per-booking
// venue_confirm_booking loop only reached the in-window weeks (occupancy is
// today..+90d) so a >12wk block was confirmed partially; this confirms every
// still-requested booking in the series + raises a charge per booking. Mirrors
// the whole-series cancel_booking_series path. Consumed by RequestsInbox.
export async function venueConfirmBookingSeries(venueToken, seriesId) {
  const { data, error } = await supabase.rpc("venue_confirm_booking_series", { p_venue_token: venueToken, p_series_id: seriesId });
  if (error) { console.error("[booking] venue_confirm_booking_series failed", error); throw error; }
  return data;
}

// ── Venue staff logins (mig 237) ─────────────────────────────────────────
// Post-login identity: which venues this signed-in user is a member of + role.
export async function venueWhoami() {
  const { data, error } = await supabase.rpc("venue_whoami");
  if (error) { console.error("[venue] venue_whoami failed", error); throw error; }
  return data;
}

// On first sign-in, bind any pending email invites to this user (verified email).
export async function venueClaimMemberships() {
  const { data, error } = await supabase.rpc("venue_claim_memberships");
  if (error) { console.error("[venue] venue_claim_memberships failed", error); throw error; }
  return data;
}

// ── Venue access management (mig 238) — Owner/Manager only (manage_logins) ──
export async function venueListAdmins(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_admins", { p_venue_token: venueToken });
  if (error) { console.error("[venue] venue_list_admins failed", error); throw error; }
  return data;
}
// Assignable staff for incident triage (mig 465): active accepted admins (user_id + name).
// Un-gated so any venue caller can populate the Assign picker.
export async function venueListAssignableStaff(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_assignable_staff", { p_venue_token: venueToken });
  if (error) { console.error("[venue] venue_list_assignable_staff failed", error); throw error; }
  return data;
}
export async function venueInviteAdmin(venueToken, email, role, capsGrant = [], capsDeny = []) {
  const { data, error } = await supabase.rpc("venue_invite_admin", {
    p_venue_token: venueToken, p_email: email, p_role: role, p_caps_grant: capsGrant, p_caps_deny: capsDeny,
  });
  if (error) { console.error("[venue] venue_invite_admin failed", error); throw error; }
  return data;
}
export async function venueUpdateAdmin(venueToken, adminId, role = null, capsGrant = null, capsDeny = null) {
  const { data, error } = await supabase.rpc("venue_update_admin", {
    p_venue_token: venueToken, p_admin_id: adminId, p_role: role, p_caps_grant: capsGrant, p_caps_deny: capsDeny,
  });
  if (error) { console.error("[venue] venue_update_admin failed", error); throw error; }
  return data;
}
export async function venueRevokeAdmin(venueToken, adminId) {
  const { data, error } = await supabase.rpc("venue_revoke_admin", { p_venue_token: venueToken, p_admin_id: adminId });
  if (error) { console.error("[venue] venue_revoke_admin failed", error); throw error; }
  return data;
}

// Venue calendar/inbox read (active occupancy + fixture/booking/maintenance detail) over a date range.
export async function getPitchOccupancy(venueToken, from, to) {
  const { data, error } = await supabase.rpc("get_pitch_occupancy", { p_venue_token: venueToken, p_from: from, p_to: to });
  if (error) { console.error("[booking] get_pitch_occupancy failed", error); throw error; }
  return data;
}

// Unified cross-site calendar feed: occupancy + pitches for EVERY venue the caller's
// operator runs (same venues.company_id), grouped by venue. Drives the ground switcher.
// Returns { ok, venues: [{ venue_id, venue_name, venue_address, is_self, pitches[], occupancy[] }] }.
export async function getOperatorPitchOccupancy(venueToken, from, to) {
  const { data, error } = await supabase.rpc("get_operator_pitch_occupancy", { p_venue_token: venueToken, p_from: from, p_to: to });
  if (error) { console.error("[booking] get_operator_pitch_occupancy failed", error); throw error; }
  return data;
}

// Unified resource calendar feed (Phase 1, read-only): one normalised occupancy[] across
// pitches + rooms (room hires ∪ class sessions) + trainers, for EVERY venue the caller's
// operator runs (same venues.company_id). Returns { ok, venues: [{ venue_id, venue_name,
// is_self, pitches[], rooms[], trainers[], occupancy[] }] }. Equipment is read separately
// via getEquipmentAvailability (quantity-over-time strip, not a lane).
export async function getVenueResourceOccupancy(venueToken, from, to) {
  const { data, error } = await supabase.rpc("get_venue_resource_occupancy", { p_venue_token: venueToken, p_from: from, p_to: to });
  if (error) { console.error("[booking] get_venue_resource_occupancy failed", error); throw error; }
  return data;
}

// Venue booking settings: bookings_enabled toggle + cancellation_policy text.
export async function venueUpdateBookingSettings(venueToken, updates) {
  const { data, error } = await supabase.rpc("venue_update_booking_settings", { p_venue_token: venueToken, p_updates: updates });
  if (error) { console.error("[booking] venue_update_booking_settings failed", error); throw error; }
  return data;
}

// ── Venue Setup Hub write path (mig 486) — consumed by BOTH apps/venue SetupHub
//    and apps/inorout /hub OperatorSetup (Venue Setup Wizard W3). ─────────────
// Partial-jsonb update of venue branding/contact (name/address/city/postcode/
// logo_url/primary_colour/secondary_colour/contact_email/contact_phone).
export async function venueUpdateDetails(venueToken, updates) {
  const { data, error } = await supabase.rpc("venue_update_details", { p_venue_token: venueToken, p_updates: updates });
  if (error) { console.error("[setup] venue_update_details failed", error); throw error; }
  return data;
}
// Replace venue-level weekly opening hours (array of {day_of_week 0-6,...}); null clears.
export async function venueUpdateHours(venueToken, hours) {
  const { data, error } = await supabase.rpc("venue_update_hours", { p_venue_token: venueToken, p_hours: hours });
  if (error) { console.error("[setup] venue_update_hours failed", error); throw error; }
  return data;
}
// Add/remove a setup step id from the dismissal set ("skip for now" persistence).
export async function venueSetSetupDismissed(venueToken, stepId, dismissed) {
  const { data, error } = await supabase.rpc("venue_set_setup_dismissed", { p_venue_token: venueToken, p_step_id: stepId, p_dismissed: dismissed });
  if (error) { console.error("[setup] venue_set_setup_dismissed failed", error); throw error; }
  return data;
}
// Go-live flip (Venue Setup Wizard W5, mig 488). Server re-checks the required set
// (details present + >=1 pitch/space) and flips verification_status pending->verified;
// idempotent when already verified. Consumed by both the web SetupHub and the native
// OperatorSetup go-live tiles. Returns { ok, verification_status, slug, already_live? }.
export async function venueFinalizeSetup(venueToken) {
  const { data, error } = await supabase.rpc("venue_finalize_setup", { p_venue_token: venueToken });
  if (error) { console.error("[setup] venue_finalize_setup failed", error); throw error; }
  return data;
}

// Venue Stripe Connect onboarding (Venue Setup Wizard W4). Forwards the owner's
// Supabase JWT as a Bearer header so /api/stripe-connect can authorise a token-less
// self-serve owner via Stage-1b (getUser + venue_admins), while a no-session
// master-token caller still resolves via the server-side fallback. `surface`
// ('setup' | 'integrations') controls where the Stripe hosted flow returns.
// Cross-origin from apps/venue → the inorout API (VITE_INOROUT_API_URL).
export async function venueStripeConnect(venueToken, { action = "onboard", surface = "integrations" } = {}) {
  const base = import.meta.env.VITE_INOROUT_API_URL ?? "";
  const headers = { "Content-Type": "application/json" };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  } catch { /* no session → the endpoint's master-token fallback path handles it */ }
  const res = await fetch(`${base}/api/stripe-connect`, {
    method: "POST", headers, body: JSON.stringify({ venueToken, action, surface }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "stripe_connect_error");
  return json;
}

// ── Venue Payments Ledger (migs 180/181) — charges + instalments ─────────────
export async function venueGetCharges(venueToken, { status = null, sourceType = null, limit = 200 } = {}) {
  const { data, error } = await supabase.rpc("venue_get_charges", {
    p_venue_token: venueToken, p_status: status, p_source_type: sourceType, p_limit: limit });
  if (error) { console.error("[payments] venue_get_charges failed", error); throw error; }
  return data;
}

// ── Equipment Hire catalogue (mig 256, Cycle 1) — sport-agnostic kit the venue owns ──
// venue_list_equipment: catalogue + per-item live counts + summary. Venue-domain.
export async function venueListEquipment(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_equipment", { p_venue_token: venueToken });
  if (error) { console.error("[equipment] venue_list_equipment failed", error); throw error; }
  return data;
}

// Create (id null) or edit a catalogue item. Amounts in pence. Returns { ok, is_new, equipment }.
export async function venueUpsertEquipment(venueToken, {
  id = null, name, category, quantity,
  defaultFeePence = 0, depositPence = 0, hireUnit = "per_session",
  purchasePricePence = null, acquiredOn = null, condition = "good", active = true,
} = {}) {
  const { data, error } = await supabase.rpc("venue_upsert_equipment", {
    p_venue_token: venueToken, p_id: id, p_name: name, p_category: category, p_quantity: quantity,
    p_default_fee_pence: defaultFeePence, p_deposit_pence: depositPence, p_hire_unit: hireUnit,
    p_purchase_price_pence: purchasePricePence, p_acquired_on: acquiredOn,
    p_condition: condition, p_active: active });
  if (error) { console.error("[equipment] venue_upsert_equipment failed", error); throw error; }
  return data;
}

// ── Hireable Spaces (mig 338, Classes+Room-Hire Phase 1) — bookable facilities ──
// venue_list_spaces: caller's spaces + upcoming_session_count/upcoming_hire_count
// (counts are 0 until Phases 2/5 land their tables). Returns a jsonb array.
export async function venueListSpaces(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_spaces", { p_venue_token: venueToken });
  if (error) { console.error("[spaces] venue_list_spaces failed", error); throw error; }
  return data;
}

// Create a space. space_type ∈ studio|room|hall|outdoor. Returns { ok, space_id }.
export async function venueCreateSpace(venueToken, {
  name, capacity, spaceType, description = null,
  isEnquiryOnly = false, enquiryContactName = null, enquiryContactEmail = null,
} = {}) {
  const { data, error } = await supabase.rpc("venue_create_space", {
    p_venue_token: venueToken, p_name: name, p_capacity: capacity, p_space_type: spaceType,
    p_description: description, p_is_enquiry_only: isEnquiryOnly,
    p_enquiry_contact_name: enquiryContactName, p_enquiry_contact_email: enquiryContactEmail });
  if (error) { console.error("[spaces] venue_create_space failed", error); throw error; }
  return data;
}

// Partial update via a jsonb patch (only supplied keys change). Returns { ok, space_id }.
export async function venueUpdateSpace(venueToken, spaceId, updates = {}) {
  const { data, error } = await supabase.rpc("venue_update_space", {
    p_venue_token: venueToken, p_space_id: spaceId, p_updates: updates });
  if (error) { console.error("[spaces] venue_update_space failed", error); throw error; }
  return data;
}

// ── Room hire (mig 342, Classes+Room-Hire Phase 5) ───────────────────────────
// Venue-side: list requests/hires, confirm (prices + charges), cancel, record deposit.
export async function venueListRoomHires(venueToken, status = null) {
  const { data, error } = await supabase.rpc("venue_list_room_hires", {
    p_venue_token: venueToken, p_status: status });
  if (error) { console.error("[roomhire] venue_list_room_hires failed", error); throw error; }
  return data;
}

// Confirm a requested hire: price it (pence) + optional deposit. Creates a 'room_hire'
// charge (if price > 0) and notifies the booker. Returns { ok, hire_id, charge_id }.
export async function venueConfirmRoomHire(venueToken, hireId, pricePence, depositPence = null) {
  const { data, error } = await supabase.rpc("venue_confirm_room_hire", {
    p_venue_token: venueToken, p_hire_id: hireId, p_price_pence: pricePence, p_deposit_pence: depositPence });
  if (error) { console.error("[roomhire] venue_confirm_room_hire failed", error); throw error; }
  return data;
}

// Cancel a hire: refunds its charge, cancels equipment add-ons, returns a held deposit,
// notifies the booker. Returns { ok, refunded, deposit_status }.
export async function venueCancelRoomHire(venueToken, hireId, reason = null) {
  const { data, error } = await supabase.rpc("venue_cancel_room_hire", {
    p_venue_token: venueToken, p_hire_id: hireId, p_reason: reason });
  if (error) { console.error("[roomhire] venue_cancel_room_hire failed", error); throw error; }
  return data;
}

// Transition the deposit lifecycle: none|held|returned|forfeited. Returns { ok, deposit_status }.
export async function venueRecordHireDeposit(venueToken, hireId, depositStatus) {
  const { data, error } = await supabase.rpc("venue_record_hire_deposit", {
    p_venue_token: venueToken, p_hire_id: hireId, p_deposit_status: depositStatus });
  if (error) { console.error("[roomhire] venue_record_hire_deposit failed", error); throw error; }
  return data;
}

// Operator ad-hoc room hire straight to 'confirmed' (mig 423, calendar Phase 2b). Either a
// member (pass memberProfileId → contact pulled from the profile) or a walk-in (bookerName).
// Reuses _space_is_available under a row lock; creates a 'room_hire' charge when priced.
// Returns { ok, hire_id, charge_id, status } or { ok:false, reason:'space_unavailable' }.
export async function venueCreateRoomHire(venueToken, spaceId, startsAt, endsAt, purpose, {
  pricePence = 0, bookerName = null, bookerEmail = null, bookerPhone = null,
  depositPence = null, attendeeCount = null, memberProfileId = null } = {}) {
  const { data, error } = await supabase.rpc("venue_create_room_hire", {
    p_venue_token: venueToken, p_space_id: spaceId, p_starts_at: startsAt, p_ends_at: endsAt,
    p_purpose: purpose, p_price_pence: pricePence, p_booker_name: bookerName,
    p_booker_email: bookerEmail, p_booker_phone: bookerPhone, p_deposit_pence: depositPence,
    p_attendee_count: attendeeCount, p_member_profile_id: memberProfileId });
  if (error) { console.error("[roomhire] venue_create_room_hire failed", error); throw error; }
  return data;
}

// ── Classes (mig 339, Classes+Room-Hire Phase 2) — class catalogue + scheduling ──
// Class types (catalogue): list returns each type + upcoming_session_count + space_name.
export async function venueListClassTypes(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_class_types", { p_venue_token: venueToken });
  if (error) { console.error("[classes] venue_list_class_types failed", error); throw error; }
  return data;
}

// Create a class type. category ∈ fitness|yoga|dance|martial_arts|other.
// isSparring marks a sparring/open-mat session (gym/boxing Phase 1, mig 356) —
// a class type is EITHER a technical class OR a sparring session. Returns { ok, class_type_id }.
// membersOnly (mig 360) defaults true: a class type is member-only unless the operator
// opens it. members_only=false + price 0 = a free open / trial class (account still required).
// isCamp (mig 534/535, Holiday Camps P9.2) marks a camp-flavour class type: it carries camp detail
// (campInfo, campDietary, pickup/dropoff time+location), a bookingMode ('per_day' | 'block'), and an
// audience ('all' | 'team' + targetTeamId — a camp visible to every guardian, or only children active
// in one club team). audience='team' REQUIRES targetTeamId (a team of a club linked to this venue).
// Sessions are emitted separately via venueCreateCamp.
export async function venueCreateClassType(venueToken, {
  name, spaceId, durationMinutes, defaultCapacity, category,
  cancellationCutoffHours = 2, firstSessionFree = false, description = null, isSparring = false,
  membersOnly = true,
  isCamp = false, campInfo = null, campDietary = null, pickupTime = null, dropoffTime = null,
  pickupLocation = null, dropoffLocation = null, bookingMode = "per_day", audience = "all",
  targetTeamId = null,
} = {}) {
  const { data, error } = await supabase.rpc("venue_create_class_type", {
    p_venue_token: venueToken, p_name: name, p_space_id: spaceId,
    p_duration_minutes: durationMinutes, p_default_capacity: defaultCapacity, p_category: category,
    p_cancellation_cutoff_hours: cancellationCutoffHours, p_first_session_free: firstSessionFree,
    p_description: description, p_is_sparring: isSparring, p_members_only: membersOnly,
    p_is_camp: isCamp, p_camp_info: campInfo, p_camp_dietary: campDietary,
    p_pickup_time: pickupTime, p_dropoff_time: dropoffTime,
    p_pickup_location: pickupLocation, p_dropoff_location: dropoffLocation,
    p_booking_mode: bookingMode, p_audience: audience, p_target_team_id: targetTeamId });
  if (error) { console.error("[classes] venue_create_class_type failed", error); throw error; }
  return data;
}

// Emit a camp's bookable sessions from its (is_camp) class type. booking_mode is DERIVED from the
// type: per_day -> one venue_class_sessions row per day dateFrom..dateTo (space-clash days skipped);
// block -> ONE row spanning end_date=dateTo. dailyStartTime is a 'HH:MM' wall-clock (Europe/London).
// Returns { ok, class_type_id, booking_mode, sessions_created, sessions_skipped }.
export async function venueCreateCamp(venueToken, {
  classTypeId, instructorId, dateFrom, dateTo, dailyStartTime, pricePence, paymentMode,
} = {}) {
  const { data, error } = await supabase.rpc("venue_create_camp", {
    p_venue_token: venueToken, p_class_type_id: classTypeId, p_instructor_id: instructorId,
    p_date_from: dateFrom, p_date_to: dateTo, p_daily_start_time: dailyStartTime,
    p_price_pence: pricePence, p_payment_mode: paymentMode });
  if (error) { console.error("[classes] venue_create_camp failed", error); throw error; }
  return data;
}

// Partial update via a jsonb patch (only supplied keys change). Returns { ok, class_type_id }.
export async function venueUpdateClassType(venueToken, classTypeId, updates = {}) {
  const { data, error } = await supabase.rpc("venue_update_class_type", {
    p_venue_token: venueToken, p_class_type_id: classTypeId, p_updates: updates });
  if (error) { console.error("[classes] venue_update_class_type failed", error); throw error; }
  return data;
}

// Sessions: list within an optional window. booked_count/waitlist_count are 0 until Phase 3.
export async function venueListClassSessions(venueToken, { from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc("venue_list_class_sessions", {
    p_venue_token: venueToken, p_from: from, p_to: to });
  if (error) { console.error("[classes] venue_list_class_sessions failed", error); throw error; }
  return data;
}

// Single session detail + attendee list. Each attendee carries dob + age (mig 362),
// ordered status then youngest-first for age-grouping a club session. Returns an object.
export async function venueGetClassSessionDetail(venueToken, sessionId) {
  const { data, error } = await supabase.rpc("venue_get_class_session_detail", {
    p_venue_token: venueToken, p_session_id: sessionId });
  if (error) { console.error("[classes] venue_get_class_session_detail failed", error); throw error; }
  return data;
}

// Venue-token manual check-in: mark a confirmed class/camp booking attended/not (mig 552).
// manage_facility gated server-side. Toggles checked_in_at.
export async function venueClassMarkAttended(venueToken, bookingId, attended) {
  const { data, error } = await supabase.rpc("venue_class_mark_attended", {
    p_venue_token: venueToken, p_booking_id: bookingId, p_attended: attended });
  if (error) { console.error("[classes] venue_class_mark_attended failed", error); throw error; }
  return data;
}

// Schedule a one-off session. payment_mode ∈ prepay|door|both. Rejects on space conflict
// ('space_unavailable'). Returns { ok, session_id, ends_at }.
export async function venueScheduleClassSession(venueToken, {
  classTypeId, instructorId, startsAt, pricePence, paymentMode,
} = {}) {
  const { data, error } = await supabase.rpc("venue_schedule_class_session", {
    p_venue_token: venueToken, p_class_type_id: classTypeId, p_instructor_id: instructorId,
    p_starts_at: startsAt, p_price_pence: pricePence, p_payment_mode: paymentMode });
  if (error) { console.error("[classes] venue_schedule_class_session failed", error); throw error; }
  return data;
}

// Pre-generate a recurring block. day_of_week 0=Sun…6=Sat. Conflicting slots are skipped.
// Returns { ok, series_id, sessions_created, sessions_skipped }.
export async function venueCreateClassSeries(venueToken, {
  classTypeId, instructorId, dayOfWeek, startTime, seriesStart, seriesEnd = null, pricePence, paymentMode,
} = {}) {
  const { data, error } = await supabase.rpc("venue_create_class_series", {
    p_venue_token: venueToken, p_class_type_id: classTypeId, p_instructor_id: instructorId,
    p_day_of_week: dayOfWeek, p_start_time: startTime, p_series_start: seriesStart,
    p_series_end: seriesEnd, p_price_pence: pricePence, p_payment_mode: paymentMode });
  if (error) { console.error("[classes] venue_create_class_series failed", error); throw error; }
  return data;
}

// Cancel a single session — no cutoff (venue-side). Voids/refunds prepaid charges + notifies
// booked members (both no-ops until Phase 3). Returns { ok, session_id, refunded, notified }.
export async function venueCancelClassSession(venueToken, sessionId, reason = null) {
  const { data, error } = await supabase.rpc("venue_cancel_class_session", {
    p_venue_token: venueToken, p_session_id: sessionId, p_reason: reason });
  if (error) { console.error("[classes] venue_cancel_class_session failed", error); throw error; }
  return data;
}

// Cancel all remaining future scheduled sessions of a series; same refund+notify cascade.
// Returns { ok, series_id, sessions_cancelled, refunded }.
export async function venueCancelClassSeries(venueToken, seriesId, reason = null) {
  const { data, error } = await supabase.rpc("venue_cancel_class_series", {
    p_venue_token: venueToken, p_series_id: seriesId, p_reason: reason });
  if (error) { console.error("[classes] venue_cancel_class_series failed", error); throw error; }
  return data;
}

// Reassign a scheduled session's instructor. Returns { ok, session_id, instructor_id }.
export async function venueReassignClassInstructor(venueToken, sessionId, newInstructorId) {
  const { data, error } = await supabase.rpc("venue_reassign_class_instructor", {
    p_venue_token: venueToken, p_session_id: sessionId, p_new_instructor_id: newInstructorId });
  if (error) { console.error("[classes] venue_reassign_class_instructor failed", error); throw error; }
  return data;
}

// Mark a session completed. Flips un-checked-in confirmed bookings → no_show + bumps no_show_count
// (both no-ops until Phase 3). Returns { ok, session_id, no_show_count }.
export async function venueMarkClassCompleted(venueToken, sessionId) {
  const { data, error } = await supabase.rpc("venue_mark_class_completed", {
    p_venue_token: venueToken, p_session_id: sessionId });
  if (error) { console.error("[classes] venue_mark_class_completed failed", error); throw error; }
  return data;
}

// QR check-in (Phase 6, mig 343). passToken is the scanned member-pass value — the
// full "/m/<token>" URL or the bare token; the RPC normalises either. Stamps the
// member's booking checked_in_at (and promotes a waitlist/offered slot to confirmed).
// Returns graceful { ok:false, reason } for per-scan misses (pass_not_found,
// wrong_venue, not_booked, booking_cancelled, no_token) and { ok:true,
// already_checked_in, member_name, status, promoted } on success.
export async function venueClassCheckin(venueToken, sessionId, passToken) {
  const { data, error } = await supabase.rpc("venue_class_checkin", {
    p_venue_token: venueToken, p_session_id: sessionId, p_pass_token: passToken });
  if (error) { console.error("[classes] venue_class_checkin failed", error); throw error; }
  return data;
}

// ── Class packages (Phase 7, mig 344) — venue admin surface ──────────────────
// Create a purchasable class pass (N sessions for a price; optional valid_days
// expiry). Returns { ok:true, package_id }.
export async function venueCreateClassPackage(venueToken, { name, sessionCount, pricePence, validDays = null }) {
  const { data, error } = await supabase.rpc("venue_create_class_package", {
    p_venue_token: venueToken, p_name: name, p_session_count: sessionCount,
    p_price_pence: pricePence, p_valid_days: validDays });
  if (error) { console.error("[classes] venue_create_class_package failed", error); throw error; }
  return data;
}

// Packages for the venue, each with a nested `balances` array of active member
// balances (member_name/email, sessions_remaining, expires_at) for the UI.
export async function venueListClassPackages(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_class_packages", { p_venue_token: venueToken });
  if (error) { console.error("[classes] venue_list_class_packages failed", error); return []; }
  return data ?? [];
}

// ── Equipment Hire flow (mig 257, Cycle 2) — quantity-aware availability + hires ──
// Free units for each active item across a window (peak-concurrent aware). from/to ISO.
export async function getEquipmentAvailability(venueToken, from, to, category = null) {
  const { data, error } = await supabase.rpc("get_equipment_availability", {
    p_venue_token: venueToken, p_from: from, p_to: to, p_category: category });
  if (error) { console.error("[equipment] get_equipment_availability failed", error); throw error; }
  return data;
}

// Create a pre-confirmed hire + auto-charge. Returns { ok:true, hire_id, charge_id, fee_pence }
// OR { ok:false, reason:'insufficient_quantity', free, wanted } (a logged turn-away — check ok).
export async function venueCreateEquipmentHire(venueToken, {
  equipmentId, qty, startAt, endAt, teamId = null, bookedByName = null,
  dueBackAt = null, bookingId = null, fixtureId = null,
  contactEmail = null, contactPhone = null, amountPence = null,
} = {}) {
  const { data, error } = await supabase.rpc("venue_create_equipment_hire", {
    p_venue_token: venueToken, p_equipment_id: equipmentId, p_qty: qty,
    p_start_at: startAt, p_end_at: endAt, p_team_id: teamId, p_booked_by_name: bookedByName,
    p_due_back_at: dueBackAt, p_booking_id: bookingId, p_fixture_id: fixtureId,
    p_contact_email: contactEmail, p_contact_phone: contactPhone, p_amount_pence: amountPence });
  if (error) { console.error("[equipment] venue_create_equipment_hire failed", error); throw error; }
  return data;
}

// Cancel a hire and refund (void) its charge. Idempotent ({ ok, already }).
export async function venueCancelEquipmentHire(venueToken, hireId) {
  const { data, error } = await supabase.rpc("venue_cancel_equipment_hire", {
    p_venue_token: venueToken, p_hire_id: hireId });
  if (error) { console.error("[equipment] venue_cancel_equipment_hire failed", error); throw error; }
  return data;
}

// Hires for this venue (newest first) with booker + charge + deposit/return state +
// derived is_overdue, plus a board `summary` (out_now/overdue/due_today). (mig 257; 259).
export async function venueListEquipmentHires(venueToken, { status = null, limit = 200 } = {}) {
  const { data, error } = await supabase.rpc("venue_list_equipment_hires", {
    p_venue_token: venueToken, p_status: status, p_limit: limit });
  if (error) { console.error("[equipment] venue_list_equipment_hires failed", error); throw error; }
  return data;
}

// Hand kit over: confirmed → out (mig 259). Idempotent.
export async function venueMarkEquipmentOut(venueToken, hireId) {
  const { data, error } = await supabase.rpc("venue_mark_equipment_out", {
    p_venue_token: venueToken, p_hire_id: hireId });
  if (error) { console.error("[equipment] venue_mark_equipment_out failed", error); throw error; }
  return data;
}

// Receive kit back: confirmed/out → returned (mig 259). Optional condition (written back
// to the asset) + forfeitDeposit (held → forfeited, else released).
export async function venueMarkEquipmentReturned(venueToken, hireId, { condition = null, forfeitDeposit = false } = {}) {
  const { data, error } = await supabase.rpc("venue_mark_equipment_returned", {
    p_venue_token: venueToken, p_hire_id: hireId, p_condition: condition, p_forfeit_deposit: forfeitDeposit });
  if (error) { console.error("[equipment] venue_mark_equipment_returned failed", error); throw error; }
  return data;
}

// ── Equipment intelligence (mig 260, Cycle 5) — the data-product tail ──
// ROI per asset (lifetime), usage over range, and procurement signal from demand
// misses. from/to are dates (YYYY-MM-DD); null → trailing 90 days. Read-only.
// Returns { range, note, summary, roi[], usage[], procurement[] }.
export async function venueEquipmentInsights(venueToken, { from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc("venue_equipment_insights", {
    p_venue_token: venueToken, p_from: from, p_to: to });
  if (error) { console.error("[equipment] venue_equipment_insights failed", error); throw error; }
  return data;
}

export async function venueGetBillingStatus(venueToken) {
  const { data, error } = await supabase.rpc("venue_get_billing_status", { p_venue_token: venueToken });
  if (error) { console.error("[integrations] venue_get_billing_status failed", error); throw error; }
  return data;
}

export async function venueStripeDisconnect(venueToken) {
  const { data, error } = await supabase.rpc("venue_stripe_disconnect", { p_venue_token: venueToken });
  if (error) { console.error("[integrations] venue_stripe_disconnect failed", error); throw error; }
  return data;
}

export async function venueRecordPayment(venueToken, chargeId, amountPence, method, { externalRef = null, note = null } = {}) {
  const { data, error } = await supabase.rpc("venue_record_payment", {
    p_venue_token: venueToken, p_charge_id: chargeId, p_amount_pence: amountPence,
    p_method: method, p_external_ref: externalRef, p_note: note });
  if (error) { console.error("[payments] venue_record_payment failed", error); throw error; }
  return data;
}

// Record a MANUAL (non-Stripe) refund — money handed back in cash/bank/other (mig 555). Mirror of
// venueRecordPayment. Partial allowed; a full refund flips the charge to 'refunded'. Returns
// { ok, payment_id, charge_id, charge_status, refunded_pence }.
export async function venueRecordRefund(venueToken, chargeId, amountPence, method, { note = null } = {}) {
  const { data, error } = await supabase.rpc("venue_record_refund", {
    p_venue_token: venueToken, p_charge_id: chargeId, p_amount_pence: amountPence,
    p_method: method, p_note: note });
  if (error) { console.error("[payments] venue_record_refund failed", error); throw error; }
  return data;
}

export async function venueVoidPayment(venueToken, paymentId) {
  const { data, error } = await supabase.rpc("venue_void_payment", { p_venue_token: venueToken, p_payment_id: paymentId });
  if (error) { console.error("[payments] venue_void_payment failed", error); throw error; }
  return data;
}

export async function venueSetChargeDue(venueToken, chargeId, amountPence) {
  const { data, error } = await supabase.rpc("venue_set_charge_due", {
    p_venue_token: venueToken, p_charge_id: chargeId, p_amount_pence: amountPence });
  if (error) { console.error("[payments] venue_set_charge_due failed", error); throw error; }
  return data;
}

// ── Venue Payments Ledger V3.1 (mig 183) — per-fixture charge add/void ────────
export async function venueAddFixtureCharge(venueToken, fixtureId, teamId, amountPence = null) {
  const { data, error } = await supabase.rpc("venue_add_fixture_charge", {
    p_venue_token: venueToken, p_fixture_id: fixtureId, p_team_id: teamId, p_amount_pence: amountPence });
  if (error) { console.error("[payments] venue_add_fixture_charge failed", error); throw error; }
  return data;
}

export async function venueVoidCharge(venueToken, chargeId) {
  const { data, error } = await supabase.rpc("venue_void_charge", { p_venue_token: venueToken, p_charge_id: chargeId });
  if (error) { console.error("[payments] venue_void_charge failed", error); throw error; }
  return data;
}

// ── Mass invoicing — bulk one-off charge engine (mig 405, Stripe Phase 3) ────────
// Cohorts resolve to a set of active memberships; one charge per included member,
// source_type='membership' so it surfaces in the payer's getMyMoney. preview is
// read-only; commit writes the billing run + charges; void soft-voids the run.
export async function venueBulkChargePreview(venueToken, { cohortType, cohortRef, label, amountPence, dueDate = null, prorate = false }) {
  const { data, error } = await supabase.rpc("venue_bulk_charge_preview", {
    p_venue_token: venueToken, p_cohort_type: cohortType, p_cohort_ref: cohortRef,
    p_label: label, p_amount_pence: amountPence, p_due_date: dueDate, p_prorate: prorate });
  if (error) { console.error("[payments] venue_bulk_charge_preview failed", error); throw error; }
  return data;
}

export async function venueBulkChargeCommit(venueToken, { cohortType, cohortRef, label, amountPence, dueDate = null, prorate = false, payOnline = false, excludedIds = [] }) {
  const { data, error } = await supabase.rpc("venue_bulk_charge_commit", {
    p_venue_token: venueToken, p_cohort_type: cohortType, p_cohort_ref: cohortRef,
    p_label: label, p_amount_pence: amountPence, p_due_date: dueDate, p_prorate: prorate,
    p_pay_online: payOnline, p_excluded_ids: excludedIds });
  if (error) { console.error("[payments] venue_bulk_charge_commit failed", error); throw error; }
  return data;
}

export async function venueVoidBillingRun(venueToken, runId) {
  const { data, error } = await supabase.rpc("venue_void_billing_run", { p_venue_token: venueToken, p_run_id: runId });
  if (error) { console.error("[payments] venue_void_billing_run failed", error); throw error; }
  return data;
}

export async function venueListBillingRuns(venueToken, limit = 50) {
  const { data, error } = await supabase.rpc("venue_list_billing_runs", { p_venue_token: venueToken, p_limit: limit });
  if (error) { console.error("[payments] venue_list_billing_runs failed", error); throw error; }
  return data;
}

// Phase 6 #6.3 — operator reconciliation (read-only): raised/paid/outstanding/overdue +
// collection rate + Stripe-vs-manual by_method split, over an optional due_date window.
export async function venuePaymentReconciliation(venueToken, { from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc("venue_payment_reconciliation", {
    p_venue_token: venueToken, p_from: from, p_to: to,
  });
  if (error) { console.error("[payments] venue_payment_reconciliation failed", error); throw error; }
  return data;
}

// ── Lifecycle: bulk price change + refunds (mig 407, Stripe Phase 5) ─────────────
// preview is read-only; commit updates CASH members' ledger amount immediately and returns
// the Stripe sub members as stripe_targets (the caller then POSTs /api/stripe-price-change to
// push the new price). Refund-resolve is the read used to show refundable / pro-rated-unused
// before the operator confirms; the actual refund goes via /api/stripe-refund.
export async function venuePriceChangePreview(venueToken, { cohortType, cohortRef, newPricePence, effectiveDate = null }) {
  const { data, error } = await supabase.rpc("venue_price_change_preview", {
    p_venue_token: venueToken, p_cohort_type: cohortType, p_cohort_ref: cohortRef,
    p_new_price_pence: newPricePence, p_effective_date: effectiveDate });
  if (error) { console.error("[payments] venue_price_change_preview failed", error); throw error; }
  return data;
}

export async function venueBulkPriceChangeCommit(venueToken, { cohortType, cohortRef, newPricePence, effectiveDate = null, excludedIds = [] }) {
  const { data, error } = await supabase.rpc("venue_bulk_price_change_commit", {
    p_venue_token: venueToken, p_cohort_type: cohortType, p_cohort_ref: cohortRef,
    p_new_price_pence: newPricePence, p_effective_date: effectiveDate, p_excluded_ids: excludedIds });
  if (error) { console.error("[payments] venue_bulk_price_change_commit failed", error); throw error; }
  return data;
}

export async function venueRefundChargeResolve(venueToken, chargeId) {
  const { data, error } = await supabase.rpc("venue_refund_charge_resolve", {
    p_venue_token: venueToken, p_charge_id: chargeId });
  if (error) { console.error("[payments] venue_refund_charge_resolve failed", error); throw error; }
  return data;
}

// ── Venue incident lifecycle (mig 231) — log + resolve from the Operations panel ──
export async function venueLogIncident(venueToken, description, severity, fixtureId = null) {
  const { data, error } = await supabase.rpc("venue_log_incident", {
    p_venue_token: venueToken, p_description: description, p_severity: severity, p_fixture_id: fixtureId });
  if (error) { console.error("[incidents] venue_log_incident failed", error); throw error; }
  return data;
}

// p_outcome (mig 437): one of fixed | safe | contractor | nofault, or null for a
// free-text-only resolution (desktop). Stored on incidents.outcome for the record.
export async function venueResolveIncident(venueToken, incidentId, outcome = null, note = null) {
  const { data, error } = await supabase.rpc("venue_resolve_incident", {
    p_venue_token: venueToken, p_incident_id: incidentId, p_outcome: outcome, p_resolution_note: note });
  if (error) { console.error("[incidents] venue_resolve_incident failed", error); throw error; }
  return data;
}

// Incident triage (mig 462) — venue-owned triage + escalation.
// Pass only the fields being changed; omitted args leave the column unchanged.
// p_acknowledge=true stamps acknowledged_at (idempotent). Cross-venue writes blocked server-side.
export async function venueTriageIncident(venueToken, incidentId, { category = null, priority = null, assignedTo = null, acknowledge = false } = {}) {
  const { data, error } = await supabase.rpc("venue_triage_incident", {
    p_venue_token: venueToken, p_incident_id: incidentId,
    p_category: category, p_priority: priority, p_assigned_to: assignedTo, p_acknowledge: acknowledge });
  if (error) { console.error("[incidents] venue_triage_incident failed", error); throw error; }
  return data;
}

// Escalate an open incident up to HQ. Idempotent — re-escalation throws already_escalated.
export async function venueEscalateIncident(venueToken, incidentId, reason = null) {
  const { data, error } = await supabase.rpc("venue_escalate_incident", {
    p_venue_token: venueToken, p_incident_id: incidentId, p_reason: reason });
  if (error) { console.error("[incidents] venue_escalate_incident failed", error); throw error; }
  return data;
}

// Safeguarding module (mig 467) — flag / unflag. Flagging is the low-friction
// one-way door INTO safeguarding: any venue caller can flag; it atomically
// evicts the incident from the ops queue and routes it to designated Leads only.
// Unflagging is Lead-only (server enforces via _venue_is_safeguarding_lead —
// throws not_a_safeguarding_lead for non-leads). v1 stores NO free-text.
export async function venueFlagSafeguarding(venueToken, incidentId) {
  const { data, error } = await supabase.rpc("venue_flag_safeguarding", {
    p_venue_token: venueToken, p_incident_id: incidentId });
  if (error) { console.error("[incidents] venue_flag_safeguarding failed", error); throw error; }
  return data;
}

export async function venueUnflagSafeguarding(venueToken, incidentId) {
  const { data, error } = await supabase.rpc("venue_unflag_safeguarding", {
    p_venue_token: venueToken, p_incident_id: incidentId });
  if (error) { console.error("[incidents] venue_unflag_safeguarding failed", error); throw error; }
  return data;
}

// Safeguarding module (mig 468) — Lead-ONLY list of flagged incidents. The
// server enforces the Lead gate (_venue_is_safeguarding_lead) and throws
// not_a_safeguarding_lead for non-leads — flagged bodies never transit a
// non-lead client. Every call writes a read-audit row server-side (LD#7).
// Returns { ok, incidents: [...], count }.
export async function venueListSafeguardingIncidents(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_safeguarding_incidents", {
    p_venue_token: venueToken });
  if (error) { console.error("[incidents] venue_list_safeguarding_incidents failed", error); throw error; }
  return data;
}

// League Mode Phase 4 — Reception Display (mig 164–167).
// Display token is the auth signal (read-only, on the TV); never the venue_admin_token.
export async function getDisplayState(displayToken) {
  if (!displayToken) return null;
  const { data, error } = await supabase.rpc("get_display_state", { p_display_token: displayToken });
  if (error) { console.error("[display] get_display_state failed", error); throw error; }
  return data;
}

export async function checkDisplayPin(displayToken, pin) {
  const { data, error } = await supabase.rpc("check_display_pin", { p_display_token: displayToken, p_pin: pin ?? null });
  if (error) { console.error("[display] check_display_pin failed", error); throw error; }
  return data;
}

// Operator-only (venue_admin_token). p_display_pin: null = leave PIN, '' = clear, else 4–8 digits.
export async function venueUpdateDisplayConfig(venueToken, config, displayPin = null) {
  const { data, error } = await supabase.rpc("venue_update_display_config", {
    p_venue_token: venueToken, p_config: config, p_display_pin: displayPin,
  });
  if (error) { console.error("[display] venue_update_display_config failed", error); throw error; }
  return data;
}

// Sponsor creative upload → public `venue-media` bucket (mig 246). Storage
// RLS requires an authenticated venue-staff session AND a `<venue_id>/...`
// object path; legacy shared-token (anon) operators cannot upload until they
// have logins. Returns the public URL to persist via
// venueUpdateDisplayConfig({ sponsor_image_url }).
export async function uploadVenueMedia(venueId, file) {
  if (!venueId || !file) throw new Error("upload_missing_args");
  const ext = (file.name?.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${venueId}/sponsor-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("venue-media").upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type || undefined,
  });
  if (error) { console.error("[display] venue-media upload failed", error); throw error; }
  const { data } = supabase.storage.from("venue-media").getPublicUrl(path);
  return data?.publicUrl || null;
}

// Club page media upload (Modular Epic B — Phase 5). Public bucket `club-media`;
// the mig-444 storage policy scopes writes to an active club manager and requires
// the object path's first folder to be the club id (`<club_id>/...`). `kind`
// namespaces the file (crest/hero/sponsor/post). Returns the public URL to
// persist via the Phase-3 write RPCs (clubSetPage / clubAddSponsor / clubCreatePost).
export async function uploadClubMedia(clubId, file, kind = "img") {
  if (!clubId || !file) throw new Error("upload_missing_args");
  const ext = (file.name?.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${clubId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("club-media").upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type || undefined,
  });
  if (error) { console.error("[club-page] club-media upload failed", error); throw error; }
  const { data } = supabase.storage.from("club-media").getPublicUrl(path);
  return data?.publicUrl || null;
}

// Orphan cleanup for club-media. Given a public URL we own, derive the object
// path and remove it. Best-effort: a failed delete leaves an orphan, never throws
// into the caller's save flow. Only acts on club-media URLs.
export async function removeClubMedia(publicUrl) {
  try {
    if (!publicUrl || typeof publicUrl !== "string") return;
    const marker = "/club-media/";
    const i = publicUrl.indexOf(marker);
    if (i === -1) return; // not one of ours (e.g. external URL) — leave it
    const path = decodeURIComponent(publicUrl.slice(i + marker.length).split("?")[0]);
    if (!path) return;
    const { error } = await supabase.storage.from("club-media").remove([path]);
    if (error) console.error("[club-page] club-media remove failed", error);
  } catch (e) {
    console.error("[club-page] removeClubMedia failed", e);
  }
}

export async function venueAssignRef(venueToken, fixtureId, officialId) {
  const { data, error } = await supabase.rpc("venue_assign_ref", {
    p_venue_token: venueToken,
    p_fixture_id: fixtureId,
    p_official_id: officialId,
  });
  if (error) {
    console.error("[venue] assign_ref failed", error);
    throw error;
  }
  return data;
}

export async function venueUpdateFixtureStatus(venueToken, fixtureId, newStatus, metadata) {
  const { data, error } = await supabase.rpc("venue_update_fixture_status", {
    p_venue_token: venueToken,
    p_fixture_id: fixtureId,
    p_new_status: newStatus,
    p_metadata: metadata ?? {},
  });
  if (error) {
    console.error("[venue] update_fixture_status failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 3 Cycle 3.6 venue admin result override (mig 127) ──
// Only path for correcting a ref-confirmed score. Fixture must be in this
// venue and in status='completed'. Audit-logged with previous + new scores
// + the operator-supplied reason. Broadcasts to both teams + venue + league.

export async function venueUpdateFixtureResult(venueToken, { fixtureId, homeScore, awayScore, reason }) {
  const { data, error } = await supabase.rpc("venue_update_fixture_result", {
    p_venue_token: venueToken,
    p_fixture_id:  fixtureId,
    p_home_score:  homeScore,
    p_away_score:  awayScore,
    p_reason:      reason,
  });
  if (error) {
    console.error("[venue] update_fixture_result failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 2 Cycle 2.5a team registration ──────────────────────

export async function joinRegisterTeam(leagueCode, competitionId, team) {
  const { data, error } = await supabase.rpc("join_register_team", {
    p_league_code: leagueCode,
    p_competition_id: competitionId,
    p_team: team,
  });
  if (error) {
    console.error("[join] register_team failed", error);
    throw error;
  }
  return data;
}

export async function venueApproveTeamRegistration(venueToken, competitionTeamId) {
  const { data, error } = await supabase.rpc("venue_approve_team_registration", {
    p_venue_token: venueToken,
    p_competition_team_id: competitionTeamId,
  });
  if (error) {
    console.error("[venue] approve_team_registration failed", error);
    throw error;
  }
  return data;
}

export async function venueRejectTeamRegistration(venueToken, competitionTeamId, reason) {
  const { data, error } = await supabase.rpc("venue_reject_team_registration", {
    p_venue_token: venueToken,
    p_competition_team_id: competitionTeamId,
    p_reason: reason,
  });
  if (error) {
    console.error("[venue] reject_team_registration failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 5 Cycle 5.6 teamsheet (line-up) ─────────────────────

export async function getTeamNextFixtureLineup(adminToken) {
  if (!adminToken) return null;
  const { data, error } = await supabase.rpc("get_team_next_fixture_lineup", {
    p_admin_token: adminToken,
  });
  if (error) {
    console.error("[league] get_team_next_fixture_lineup failed", error);
    throw error;
  }
  return data;
}

export async function submitTeamLineup(adminToken, fixtureId, lineup, overridePlayerIds = []) {
  const { data, error } = await supabase.rpc("team_admin_submit_lineup", {
    p_admin_token: adminToken,
    p_fixture_id: fixtureId,
    p_lineup: lineup,
    p_override_player_ids: overridePlayerIds,
  });
  if (error) {
    console.error("[league] submit_team_lineup failed", error);
    throw error;
  }
  return data;
}

// Cycle 5.7 — read-only pre-submit eligibility check. Returns per-player flags
// (in_squad / double_registered / suspended / registration_status / suspension_until)
// plus the league's min_starting / max_subs bounds, so the Teamsheet screen can badge
// players and gate the submit before the authoritative server check in submitTeamLineup.
export async function checkTeamLineupEligibility(adminToken, fixtureId, playerIds) {
  const { data, error } = await supabase.rpc("team_admin_check_eligibility", {
    p_admin_token: adminToken,
    p_fixture_id: fixtureId,
    p_player_ids: playerIds,
  });
  if (error) {
    console.error("[league] check_eligibility failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 2 Cycle 2.5b mid-season team exits ──────────────────

export async function venueWithdrawTeam(venueToken, competitionTeamId, reason) {
  const { data, error } = await supabase.rpc("venue_withdraw_team", {
    p_venue_token: venueToken,
    p_competition_team_id: competitionTeamId,
    p_reason: reason,
  });
  if (error) {
    console.error("[venue] withdraw_team failed", error);
    throw error;
  }
  return data;
}

export async function venueExpelTeam(venueToken, competitionTeamId, reason) {
  const { data, error } = await supabase.rpc("venue_expel_team", {
    p_venue_token: venueToken,
    p_competition_team_id: competitionTeamId,
    p_reason: reason,
  });
  if (error) {
    console.error("[venue] expel_team failed", error);
    throw error;
  }
  return data;
}

// ─── League Mode — Phase 2 Cycle 2.6 refs + pitches CRUD ─────────────────────

export async function venueAddPitch(venueToken, pitch) {
  const { data, error } = await supabase.rpc("venue_add_pitch", {
    p_venue_token: venueToken,
    p_pitch: pitch,
  });
  if (error) {
    console.error("[venue] add_pitch failed", error);
    throw error;
  }
  return data;
}

export async function venueUpdatePitch(venueToken, pitchId, updates) {
  const { data, error } = await supabase.rpc("venue_update_pitch", {
    p_venue_token: venueToken,
    p_pitch_id: pitchId,
    p_updates: updates,
  });
  if (error) {
    console.error("[venue] update_pitch failed", error);
    throw error;
  }
  return data;
}

// Pitch priority Phase 1 — reserved windows are advisory time bands held for the
// club's own use (config + calendar shading only; NO enforcement until Phase 2).
export async function venueSetPitchReservedWindows(venueToken, pitchId, windows) {
  const { data, error } = await supabase.rpc("venue_set_pitch_reserved_windows", {
    p_venue_token: venueToken,
    p_pitch_id: pitchId,
    p_windows: windows,
  });
  if (error) {
    console.error("[venue] set_pitch_reserved_windows failed", error);
    throw error;
  }
  return data;
}

// Every reserved window across the operator's same-company venues (one read powers
// the editor + the calm calendar shading on both the single-site and all-grounds grids).
export async function venueListPitchReservedWindows(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_pitch_reserved_windows", {
    p_venue_token: venueToken,
  });
  if (error) {
    console.error("[venue] list_pitch_reserved_windows failed", error);
    throw error;
  }
  return data;
}

// Pitch priority Phase 2 — rank-bump proposals. When a higher-ranked club team takes a
// contested slot, the bumped team's event goes tentative + gets a suggested alternative.
// These surface + resolve those proposals (venue-token + club-manager auth.uid variants).
export async function venueListBumpProposals(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_bump_proposals", {
    p_venue_token: venueToken,
  });
  if (error) {
    console.error("[venue] list_bump_proposals failed", error);
    throw error;
  }
  return data;
}

// Coach pitch REQUEST inbox (mig 566): the owner's operator-wide list of requested
// club_sessions (pitch_status='requested', which hold no occupancy so aren't in the grid).
export async function venueListCoachRequests(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_coach_requests", {
    p_venue_token: venueToken,
  });
  if (error) { console.error("[venue] list_coach_requests failed", error); throw error; }
  return data;
}

// Approve a coach pitch request (mig 566): re-run the reserve. Returns {ok:true,
// pitch_status:'allocated'} on success, or {ok:false, reason:'slot_taken'} if the slot is
// still held by a non-bumpable booking (owner clears it or declines — never auto-evicted).
export async function venueApproveCoachRequest(venueToken, sessionId) {
  const { data, error } = await supabase.rpc("venue_approve_coach_request", {
    p_venue_token: venueToken, p_session_id: sessionId,
  });
  if (error) { console.error("[venue] approve_coach_request failed", error); throw error; }
  return data;
}

// Decline a coach pitch request (mig 566): pitch_status 'requested' → 'none'. The session
// stays scheduled ("pitch TBC") and the coach is notified to re-pick.
export async function venueDeclineCoachRequest(venueToken, sessionId) {
  const { data, error } = await supabase.rpc("venue_decline_coach_request", {
    p_venue_token: venueToken, p_session_id: sessionId,
  });
  if (error) { console.error("[venue] decline_coach_request failed", error); throw error; }
  return data;
}

export async function venueResolveBump(venueToken, proposalId, action) {
  const { data, error } = await supabase.rpc("venue_resolve_bump", {
    p_venue_token: venueToken,
    p_proposal_id: proposalId,
    p_action: action,
  });
  if (error) {
    console.error("[venue] resolve_bump failed", error);
    throw error;
  }
  return data;
}

export async function clubManagerListBumpProposals() {
  const { data, error } = await supabase.rpc("club_manager_list_bump_proposals", {});
  if (error) {
    console.error("[club] list_bump_proposals failed", error);
    throw error;
  }
  return data;
}

export async function clubManagerResolveBump(proposalId, action) {
  const { data, error } = await supabase.rpc("club_manager_resolve_bump", {
    p_proposal_id: proposalId,
    p_action: action,
  });
  if (error) {
    console.error("[club] resolve_bump failed", error);
    throw error;
  }
  return data;
}

export async function venueAddRef(venueToken, ref) {
  const { data, error } = await supabase.rpc("venue_add_ref", {
    p_venue_token: venueToken,
    p_ref: ref,
  });
  if (error) {
    console.error("[venue] add_ref failed", error);
    throw error;
  }
  return data;
}

export async function venueListActiveTeams(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_active_teams", {
    p_venue_token: venueToken,
  });
  if (error) {
    console.error("[venue] list_active_teams failed", error);
    throw error;
  }
  return data;
}

// ── Venue staff (reception / managers / admins / groundstaff) — mig 195 ──
export async function venueListStaff(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_staff", {
    p_venue_token: venueToken,
  });
  if (error) {
    console.error("[venue] list_staff failed", error);
    throw error;
  }
  return data;
}

export async function venueAddStaff(venueToken, staff) {
  const { data, error } = await supabase.rpc("venue_add_staff", {
    p_venue_token: venueToken,
    p_staff: staff,
  });
  if (error) {
    console.error("[venue] add_staff failed", error);
    throw error;
  }
  return data;
}

export async function venueUpdateStaff(venueToken, staffId, updates) {
  const { data, error } = await supabase.rpc("venue_update_staff", {
    p_venue_token: venueToken,
    p_staff_id: staffId,
    p_updates: updates,
  });
  if (error) {
    console.error("[venue] update_staff failed", error);
    throw error;
  }
  return data;
}

// ── Team roster (team management depth) — mig 196 ──
export async function venueGetTeamRoster(venueToken, teamId) {
  const { data, error } = await supabase.rpc("venue_get_team_roster", {
    p_venue_token: venueToken,
    p_team_id: teamId,
  });
  if (error) {
    console.error("[venue] get_team_roster failed", error);
    throw error;
  }
  return data;
}

// ── League standings (Table view) — mig 197 ──
export async function venueGetStandings(venueToken, competitionId) {
  const { data, error } = await supabase.rpc("venue_get_standings", {
    p_venue_token: venueToken,
    p_competition_id: competitionId,
  });
  if (error) {
    console.error("[venue] get_standings failed", error);
    throw error;
  }
  return data;
}

// ── All club teams across the venue's clubs (Teams page — Club teams tab) — mig 409 ──
export async function venueListClubTeams(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_club_teams", {
    p_venue_token: venueToken,
  });
  if (error) {
    console.error("[venue] list_club_teams failed", error);
    throw error;
  }
  return data;
}

// ── Set / clear a team's contact, primary or secondary (Teams page — mig 411) ──
// teamKind: 'league' | 'club'. teamId is text (league teams.id, or club_teams.id as
// a string). contactRank: 'primary' | 'secondary'. contactId NULL clears that slot.
// For league teams the contact is a venue_customers id; for club teams it's a
// member_profiles id (an active manager/coach of that team). Returns
// { ok, contact_rank, contact_id, name, contact_kind }.
export async function venueSetTeamMainContact(venueToken, teamKind, teamId, contactRank, contactId = null) {
  const { data, error } = await supabase.rpc("venue_set_team_main_contact", {
    p_venue_token: venueToken,
    p_team_kind: teamKind,
    p_team_id: String(teamId),
    p_contact_rank: contactRank,
    p_contact_id: contactId,
  });
  if (error) {
    console.error("[venue] set_team_main_contact failed", error);
    throw error;
  }
  return data;
}

// ── All players across the venue's teams (Players view) — mig 198 ──
export async function venueListPlayers(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_players", {
    p_venue_token: venueToken,
  });
  if (error) {
    console.error("[venue] list_players failed", error);
    throw error;
  }
  return data;
}

export async function venueUpdateRef(venueToken, refId, updates) {
  const { data, error } = await supabase.rpc("venue_update_ref", {
    p_venue_token: venueToken,
    p_ref_id: refId,
    p_updates: updates,
  });
  if (error) {
    console.error("[venue] update_ref failed", error);
    throw error;
  }
  return data;
}

// ── Membership V2 — member account RPCs (migs 286–289) ───────────────────────

export async function clubCreate(fields) {
  const { data, error } = await supabase.rpc("club_create", {
    p_name:             fields.name,
    p_short_name:       fields.short_name       ?? null,
    p_contact_email:    fields.contact_email     ?? null,
    p_contact_phone:    fields.contact_phone     ?? null,
    p_id_mandate:       fields.id_mandate        ?? false,
    p_safeguarding_config: fields.safeguarding_config ?? null,
  });
  if (error) {
    console.error("[member] club_create failed", error);
    throw error;
  }
  return data;
}

export async function venueListClubs(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_clubs", {
    p_venue_token: venueToken,
  });
  if (error) { console.error("[member] venue_list_clubs failed", error); throw error; }
  return data ?? [];
}

export async function venueSetClubDiscipline(venueToken, clubId, discipline) {
  const { data, error } = await supabase.rpc("venue_set_club_discipline", {
    p_venue_token: venueToken,
    p_club_id: clubId,
    p_discipline: discipline,
  });
  if (error) {
    console.error("[venue] set_club_discipline failed", error);
    throw error;
  }
  return data;
}

// ── Grading / belts (Gym vertical Phase 2, mig 357) ──────────────────────────
export async function venueCreateGradingScheme(venueToken, clubId, name, ageBand = "all", discipline = null) {
  const { data, error } = await supabase.rpc("venue_create_grading_scheme", {
    p_venue_token: venueToken, p_club_id: clubId, p_name: name,
    p_age_band: ageBand, p_discipline: discipline,
  });
  if (error) { console.error("[venue] venue_create_grading_scheme failed", error); throw error; }
  return data;
}

export async function venueAddGrade(venueToken, schemeId, name, rankOrder, colourHex = null, maxStripes = 0) {
  const { data, error } = await supabase.rpc("venue_add_grade", {
    p_venue_token: venueToken, p_scheme_id: schemeId, p_name: name,
    p_rank_order: rankOrder, p_colour_hex: colourHex, p_max_stripes: maxStripes,
  });
  if (error) { console.error("[venue] venue_add_grade failed", error); throw error; }
  return data;
}

export async function venueAwardGrade(venueToken, membershipId, gradeId, stripes = 0, note = null) {
  const { data, error } = await supabase.rpc("venue_award_grade", {
    p_venue_token: venueToken, p_membership_id: membershipId, p_grade_id: gradeId,
    p_stripes: stripes, p_note: note,
  });
  if (error) { console.error("[venue] venue_award_grade failed", error); throw error; }
  return data;
}

export async function venueListGradingSchemes(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_list_grading_schemes", {
    p_venue_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[venue] venue_list_grading_schemes failed", error); throw error; }
  return data ?? { ok: false, schemes: [] };
}

export async function memberGetGradeHistory(passToken) {
  const { data, error } = await supabase.rpc("member_get_grade_history", { p_token: passToken });
  if (error) { console.error("[membership] member_get_grade_history failed", error); throw error; }
  return data ?? { ok: false, history: [] };
}

// ── Fight record / bouts (gym/boxing vertical, Phase 4, mig 359) ─────────────
export async function venueRecordBout(venueToken, membershipId, {
  boutDate, result, opponentName = null, eventName = null, method = null,
  rounds = null, isSparring = false, stats = null, note = null,
} = {}) {
  const { data, error } = await supabase.rpc("venue_record_bout", {
    p_venue_token: venueToken, p_membership_id: membershipId, p_bout_date: boutDate,
    p_result: result, p_opponent_name: opponentName, p_event_name: eventName,
    p_method: method, p_rounds: rounds, p_is_sparring: isSparring, p_stats: stats, p_note: note,
  });
  if (error) { console.error("[venue] venue_record_bout failed", error); throw error; }
  return data;
}

export async function venueUpdateBout(venueToken, boutId, {
  boutDate = null, result = null, opponentName = null, eventName = null, method = null,
  rounds = null, isSparring = null, stats = null, note = null,
} = {}) {
  const { data, error } = await supabase.rpc("venue_update_bout", {
    p_venue_token: venueToken, p_bout_id: boutId, p_bout_date: boutDate,
    p_result: result, p_opponent_name: opponentName, p_event_name: eventName,
    p_method: method, p_rounds: rounds, p_is_sparring: isSparring, p_stats: stats, p_note: note,
  });
  if (error) { console.error("[venue] venue_update_bout failed", error); throw error; }
  return data;
}

export async function venueDeleteBout(venueToken, boutId, voidIt = true) {
  const { data, error } = await supabase.rpc("venue_delete_bout", {
    p_venue_token: venueToken, p_bout_id: boutId, p_void: voidIt,
  });
  if (error) { console.error("[venue] venue_delete_bout failed", error); throw error; }
  return data;
}

export async function venueListMemberBouts(venueToken, membershipId) {
  const { data, error } = await supabase.rpc("venue_list_member_bouts", {
    p_venue_token: venueToken, p_membership_id: membershipId,
  });
  if (error) { console.error("[venue] venue_list_member_bouts failed", error); throw error; }
  return data ?? { ok: false, bouts: [] };
}

export async function memberGetFightRecord(passToken) {
  const { data, error } = await supabase.rpc("member_get_fight_record", { p_token: passToken });
  if (error) { console.error("[membership] member_get_fight_record failed", error); throw error; }
  return data ?? { ok: false, bouts: [] };
}

export async function venueListClubVenues(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_list_club_venues", {
    p_venue_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[member] venue_list_club_venues failed", error); throw error; }
  return data ?? { ok: false };
}

export async function venueAddClubVenue(venueToken, clubId, targetVenueId) {
  const { data, error } = await supabase.rpc("venue_add_club_venue", {
    p_venue_token: venueToken, p_club_id: clubId, p_target_venue_id: targetVenueId,
  });
  if (error) { console.error("[member] venue_add_club_venue failed", error); throw error; }
  return data;
}

export async function venueRemoveClubVenue(venueToken, clubId, targetVenueId) {
  const { data, error } = await supabase.rpc("venue_remove_club_venue", {
    p_venue_token: venueToken, p_club_id: clubId, p_target_venue_id: targetVenueId,
  });
  if (error) { console.error("[member] venue_remove_club_venue failed", error); throw error; }
  return data;
}

export async function venueSearch(venueToken, query, clubId = null) {
  const { data, error } = await supabase.rpc("venue_search", {
    p_venue_token: venueToken, p_query: query, p_club_id: clubId ?? null,
  });
  if (error) { console.error("[member] venue_search failed", error); throw error; }
  return data ?? { ok: false };
}

export async function venueUpdateClubSettings(venueToken, clubId, { idMandate = null, safeguardingConfig = null } = {}) {
  const { data, error } = await supabase.rpc("venue_update_club_settings", {
    p_venue_token: venueToken, p_club_id: clubId,
    p_id_mandate: idMandate, p_safeguarding_config: safeguardingConfig,
  });
  if (error) { console.error("[member] venue_update_club_settings failed", error); throw error; }
  return data;
}

export async function memberCreateProfile(venueId, fields) {
  const { data, error } = await supabase.rpc("member_create_profile", {
    p_venue_id:           venueId,
    p_first_name:         fields.first_name,
    p_last_name:          fields.last_name          ?? null,
    p_email:              fields.email               ?? null,
    p_dob:                fields.dob                 ?? null,
    p_phone:              fields.phone               ?? null,
    p_source_customer_id: fields.source_customer_id  ?? null,
  });
  if (error) {
    console.error("[member] member_create_profile failed", error);
    throw error;
  }
  return data;
}

// Claim-on-sign-in for MEMBERS (mig 586) — the twin of venueClaimMemberships
// (mig 564), which does the same for an admin's pending venue invite. Binds an
// imported/admin-created member shell to this login by VERIFIED email so an
// imported family can actually get in; without it they land on the squad-less
// welcome screen and a later self-signup DUPLICATES them. Takes no arguments on
// purpose: everything is derived from auth.uid() server-side. Best-effort +
// idempotent — no-ops for ~every user, and REFUSES (claims nothing) when the email
// match is ambiguous rather than risk handing an adult a child's record.
export async function memberClaimShellOnSignin() {
  const { data, error } = await supabase.rpc("member_claim_shell_on_signin");
  if (error) { console.error("[member] member_claim_shell_on_signin failed", error); throw error; }
  return data;
}

export async function memberClaimProfile(profileId) {
  const { data, error } = await supabase.rpc("member_claim_profile", {
    p_profile_id: profileId,
  });
  if (error) {
    console.error("[member] member_claim_profile failed", error);
    throw error;
  }
  return data;
}

export async function memberGetSelf() {
  const { data, error } = await supabase.rpc("member_get_self");
  if (error) {
    console.error("[member] member_get_self failed", error);
    throw error;
  }
  return data;
}

export async function memberGetVenueMembershipPass(inviteCode) {
  const { data, error } = await supabase.rpc("member_get_venue_membership_pass", { p_invite_code: inviteCode });
  if (error) { console.error("[member] member_get_venue_membership_pass failed", error); throw error; }
  return data;
}

export async function memberUpdateSelf(updates) {
  const { data, error } = await supabase.rpc("member_update_self", {
    p_updates: updates,
  });
  if (error) {
    console.error("[member] member_update_self failed", error);
    throw error;
  }
  return data;
}

export async function memberRegisterChild({ first_name, last_name, dob, relationship }) {
  const { data, error } = await supabase.rpc("member_register_child", {
    p_first_name:   first_name,
    p_last_name:    last_name,
    p_dob:          dob ?? null,
    p_relationship: relationship ?? null,
  });
  if (error) {
    console.error("[member] member_register_child failed", error);
    throw error;
  }
  return data;
}

export async function memberListChildren() {
  const { data, error } = await supabase.rpc("member_list_children");
  if (error) {
    console.error("[member] member_list_children failed", error);
    throw error;
  }
  return data;
}

export async function memberUpdateChild(childProfileId, updates) {
  const { data, error } = await supabase.rpc("member_update_child", {
    p_child_profile_id: childProfileId,
    p_updates:          updates,
  });
  if (error) {
    console.error("[member] member_update_child failed", error);
    throw error;
  }
  return data;
}

// ── Membership V2 Phase 5 — Consent documents + e-sign (mig 293) ─────────────

export async function venueCreatePolicyDocument(venueToken, clubId, title, body) {
  const { data, error } = await supabase.rpc("venue_create_policy_document", {
    p_venue_token: venueToken, p_club_id: clubId, p_title: title, p_body: body,
  });
  if (error) { console.error("[member] venue_create_policy_document failed", error); throw error; }
  return data;
}

export async function venuePublishPolicyVersion(venueToken, documentId, body, title = null) {
  const { data, error } = await supabase.rpc("venue_publish_policy_version", {
    p_venue_token: venueToken, p_document_id: documentId, p_body: body, p_title: title,
  });
  if (error) { console.error("[member] venue_publish_policy_version failed", error); throw error; }
  return data;
}

export async function venueListPolicyDocuments(venueToken, clubId, allVersions = false) {
  const { data, error } = await supabase.rpc("venue_list_policy_documents", {
    p_venue_token: venueToken, p_club_id: clubId, p_all_versions: allVersions,
  });
  if (error) { console.error("[member] venue_list_policy_documents failed", error); throw error; }
  return data;
}

export async function memberAcceptConsent(documentId, typedSignature, { onBehalfOfProfileId = null, ipAddress = null, userAgent = null } = {}) {
  const { data, error } = await supabase.rpc("member_accept_consent", {
    p_document_id:               documentId,
    p_typed_signature:           typedSignature,
    p_on_behalf_of_profile_id:   onBehalfOfProfileId,
    p_ip_address:                ipAddress,
    p_user_agent:                userAgent,
  });
  if (error) { console.error("[member] member_accept_consent failed", error); throw error; }
  return data;
}

export async function memberGetPendingConsents() {
  const { data, error } = await supabase.rpc("member_get_pending_consents");
  if (error) { console.error("[member] member_get_pending_consents failed", error); throw error; }
  return data;
}

export async function memberListConsents() {
  const { data, error } = await supabase.rpc("member_list_consents");
  if (error) { console.error("[member] member_list_consents failed", error); throw error; }
  return data;
}

// ── ID document upload (Phase 6) ─────────────────────────────────────────────

export async function uploadMemberIdDoc(memberProfileId, file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${memberProfileId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("member-id-docs").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) { console.error("[member] id doc upload failed", error); throw error; }
  return path;
}

export async function getMemberIdDocUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from("member-id-docs")
    .createSignedUrl(storagePath, 3600);
  if (error) { console.error("[member] id doc signed url failed", error); throw error; }
  return data.signedUrl;
}

export async function memberSubmitIdDocument(clubId, documentType, storagePath) {
  const { data, error } = await supabase.rpc("member_submit_id_document", {
    p_club_id: clubId, p_document_type: documentType, p_storage_path: storagePath,
  });
  if (error) { console.error("[member] member_submit_id_document failed", error); throw error; }
  return data;
}

export async function memberListIdDocuments() {
  const { data, error } = await supabase.rpc("member_list_id_documents");
  if (error) { console.error("[member] member_list_id_documents failed", error); throw error; }
  return data;
}

export async function venueListIdSubmissions(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_id_submissions", {
    p_venue_token: venueToken,
  });
  if (error) { console.error("[membership] venue_list_id_submissions failed", error); throw error; }
  return data;
}

export async function venueVerifyIdDocument(venueToken, documentId, action, rejectionReason = null) {
  const { data, error } = await supabase.rpc("venue_verify_id_document", {
    p_venue_token: venueToken, p_document_id: documentId,
    p_action: action, p_rejection_reason: rejectionReason,
  });
  if (error) { console.error("[membership] venue_verify_id_document failed", error); throw error; }
  return data;
}

// Remove ID object(s) from the private bucket via the Storage API (retention purge —
// direct SQL DELETE on storage.objects is blocked by Supabase's protect_objects_delete).
export async function removeMemberIdDoc(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  const { error } = await supabase.storage.from("member-id-docs").remove(list);
  if (error) { console.error("[member] id doc remove failed", error); throw error; }
  return true;
}

// ── Guardian Documents (mig 431) ─────────────────────────────────────────────
// Per-child requirement manifest (sign / upload / review) + guardian-routed writes.
// SIGN reuses the existing memberAcceptConsent (already supports on-behalf-of child).

export async function guardianListChildDocuments(childProfileId) {
  const { data, error } = await supabase.rpc("guardian_list_child_documents", {
    p_child_profile_id: childProfileId,
  });
  if (error) { console.error("[guardian] guardian_list_child_documents failed", error); throw error; }
  return data;
}

export async function guardianSubmitIdDocument(forProfileId, clubId, documentType, storagePath) {
  const { data, error } = await supabase.rpc("guardian_submit_id_document", {
    p_for_profile_id: forProfileId, p_club_id: clubId,
    p_document_type: documentType, p_storage_path: storagePath,
  });
  if (error) { console.error("[guardian] guardian_submit_id_document failed", error); throw error; }
  return data;
}

export async function guardianConfirmRecordReview(forProfileId, reviewKind = "medical") {
  const { data, error } = await supabase.rpc("guardian_confirm_record_review", {
    p_for_profile_id: forProfileId, p_review_kind: reviewKind,
  });
  if (error) { console.error("[guardian] guardian_confirm_record_review failed", error); throw error; }
  return data;
}

export async function guardianPurgeIdDocument(documentId) {
  const { data, error } = await supabase.rpc("guardian_purge_id_document", {
    p_document_id: documentId,
  });
  if (error) { console.error("[guardian] guardian_purge_id_document failed", error); throw error; }
  return data;
}

// Club notices (guardian inbox) — read-only consumption of club_announcements scoped to the
// CHILD's clubs/teams, + a mark-as-read that drives the unread badge (mig 434).
export async function guardianListChildNotices(childProfileId) {
  const { data, error } = await supabase.rpc("guardian_list_child_notices", {
    p_child_profile_id: childProfileId,
  });
  if (error) { console.error("[guardian] guardian_list_child_notices failed", error); throw error; }
  return data;
}

export async function guardianMarkNoticeRead(announcementId, forProfileId) {
  const { data, error } = await supabase.rpc("guardian_mark_notice_read", {
    p_announcement_id: announcementId, p_for_profile_id: forProfileId,
  });
  if (error) { console.error("[guardian] guardian_mark_notice_read failed", error); throw error; }
  return data;
}

// Guardian "Team" screen (mig 436) — the child's team(s): header + own W/D/L record,
// coaches, and squad (read-only). Team broadcasts come from guardianListChildNotices.
export async function guardianListChildTeam(childProfileId) {
  const { data, error } = await supabase.rpc("guardian_list_child_team", {
    p_child_profile_id: childProfileId,
  });
  if (error) { console.error("[guardian] guardian_list_child_team failed", error); throw error; }
  return data;
}

// ── Phase 7 — /q signup rebuild (mig 296) ────────────────────────────────────

// Create member's own profile at /q signup (authenticated, fails if profile exists).
export async function memberSelfCreateProfile({ firstName, lastName, email, dob, phone } = {}) {
  const { data, error } = await supabase.rpc("member_self_create_profile", {
    p_first_name: firstName,
    p_last_name:  lastName  ?? null,
    p_email:      email     ?? null,
    p_dob:        dob       ?? null,
    p_phone:      phone     ?? null,
  });
  if (error) { console.error("[member] member_self_create_profile failed", error); throw error; }
  return data;
}

// Enrol authenticated member (or their child) onto a membership tier.
// forProfileId = child's member_profile_id; null = enrolling self.
export async function memberEnrolMembership(inviteCode, tierId, period, forProfileId = null) {
  const { data, error } = await supabase.rpc("member_enrol_membership", {
    p_invite_code:    inviteCode,
    p_tier_id:        tierId,
    p_period:         period,
    p_for_profile_id: forProfileId,
  });
  if (error) { console.error("[member] member_enrol_membership failed", error); throw error; }
  return data;
}

// Phase 3 Stripe: create a Checkout session on the venue's connected account.
// Returns { checkout_url } which the caller redirects to via window.location.href.
// Dormant (503) until STRIPE_SECRET_KEY is set server-side.
export async function stripeInitMemberCheckout({ inviteCode, tierId, period, forProfileId = null, returnCode = null }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("not_authenticated");
  const res = await fetch("/api/stripe-member-checkout", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body:    JSON.stringify({ inviteCode, tierId, period, forProfileId, returnCode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || "checkout_failed");
  }
  return res.json();
}

// Phase 5 Stripe: open the hosted Billing Portal so a member self-serves their saved card /
// cancels their subscription. Returns { portal_url } to redirect to. Dormant (503) until keys set.
export async function stripeInitBillingPortal({ membershipId, returnPath = "/" }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("not_authenticated");
  const res = await fetch("/api/stripe-billing-portal", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body:    JSON.stringify({ membershipId, returnPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || "portal_failed");
  }
  return res.json();
}

// Phase 1 Guardian Membership: member-initiated "Pay now" for ONE outstanding venue_charge
// (membership or class). Mints/reuses a Stripe hosted invoice and returns { pay_url } to open.
// Reconciles via the existing invoice.paid webhook. Dormant (503) until keys set.
export async function stripeInitChargeCheckout({ chargeId }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("not_authenticated");
  const res = await fetch("/api/stripe-charge-checkout", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body:    JSON.stringify({ chargeId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || "checkout_failed");
  }
  return res.json();
}

// Flag that the family intends to pay a charge by cash/bank (BookPaySheet's cash/bank taps,
// mig 550) — the operator sees a "says cash/bank" pill on their payments view. Caller must own
// the charge (member OR membership payer OR accepted guardian; enforced server-side). Best-effort.
export async function memberFlagChargePayIntent(chargeId, method) {
  const { data, error } = await supabase.rpc("member_flag_charge_pay_intent", {
    p_charge_id: chargeId, p_method: method,
  });
  if (error) { console.error("[pay] member_flag_charge_pay_intent failed", error); throw error; }
  return data;
}

// ── Phase 10 — Club Attendance admin RPCs (mig 298) ──────────────────────────

export async function clubCreateCohort(venueToken, clubId, { name, description = null, minAge = null, maxAge = null, category = null } = {}) {
  const { data, error } = await supabase.rpc("club_create_cohort", {
    p_venue_token: venueToken, p_club_id: clubId, p_name: name,
    p_description: description, p_min_age: minAge, p_max_age: maxAge, p_category: category,
  });
  if (error) { console.error("[club] club_create_cohort failed", error); throw error; }
  return data;
}

export async function clubListCohorts(venueToken, clubId, includeInactive = false) {
  const { data, error } = await supabase.rpc("club_list_cohorts", {
    p_venue_token: venueToken, p_club_id: clubId, p_include_inactive: includeInactive,
  });
  if (error) { console.error("[club] club_list_cohorts failed", error); throw error; }
  return data;
}

export async function clubUpdateCohort(venueToken, cohortId, { name = null, description = null, minAge = null, maxAge = null, active = null, category = null } = {}) {
  const { data, error } = await supabase.rpc("club_update_cohort", {
    p_venue_token: venueToken, p_cohort_id: cohortId, p_name: name,
    p_description: description, p_min_age: minAge, p_max_age: maxAge, p_active: active, p_category: category,
  });
  if (error) { console.error("[club] club_update_cohort failed", error); throw error; }
  return data;
}

// ── Club Structure — team RPCs (mig 389) ─────────────────────────────────────
export async function clubCreateTeam(venueToken, clubId, { cohortId, name, gender = null, priorityRank = null } = {}) {
  const { data, error } = await supabase.rpc("club_create_team", {
    p_venue_token: venueToken, p_club_id: clubId, p_cohort_id: cohortId,
    p_name: name, p_gender: gender, p_priority_rank: priorityRank,
  });
  if (error) { console.error("[club] club_create_team failed", error); throw error; }
  return data;
}

export async function clubUpdateTeam(venueToken, teamId, { name = null, gender = null, priorityRank = null, cohortId = null } = {}) {
  const { data, error } = await supabase.rpc("club_update_team", {
    p_venue_token: venueToken, p_team_id: teamId, p_name: name,
    p_gender: gender, p_priority_rank: priorityRank, p_cohort_id: cohortId,
  });
  if (error) { console.error("[club] club_update_team failed", error); throw error; }
  return data;
}

export async function clubListTeams(venueToken, clubId, includeArchived = false) {
  const { data, error } = await supabase.rpc("club_list_teams", {
    p_venue_token: venueToken, p_club_id: clubId, p_include_archived: includeArchived,
  });
  if (error) { console.error("[club] club_list_teams failed", error); throw error; }
  return data;
}

export async function clubArchiveTeam(venueToken, teamId) {
  const { data, error } = await supabase.rpc("club_archive_team", {
    p_venue_token: venueToken, p_team_id: teamId,
  });
  if (error) { console.error("[club] club_archive_team failed", error); throw error; }
  return data;
}

// ── Club League + home/away fixtures (mig 394) — venue-token operator surface.
// A club's own league container holding free-text-opponent home/away games with
// assigned pitch + ref. The #8 opposition-coach link reads these via share_code.
export async function venueCreateClubLeague(venueToken, clubId, { name, seasonLabel = null } = {}) {
  const { data, error } = await supabase.rpc("venue_create_club_league", {
    p_venue_token: venueToken, p_club_id: clubId, p_name: name, p_season_label: seasonLabel,
  });
  if (error) { console.error("[league] venue_create_club_league failed", error); throw error; }
  return data;
}

export async function venueUpdateClubLeague(venueToken, leagueId, { name = null, seasonLabel = null, archived = null, faEmbedCode = null, faSourceUrl = null } = {}) {
  const { data, error } = await supabase.rpc("venue_update_club_league", {
    p_venue_token: venueToken, p_league_id: leagueId, p_name: name,
    p_season_label: seasonLabel, p_archived: archived, p_fa_embed_code: faEmbedCode,
    p_fa_source_url: faSourceUrl,
  });
  if (error) { console.error("[league] venue_update_club_league failed", error); throw error; }
  return data;
}

export async function venueListClubLeagues(venueToken, clubId = null) {
  const { data, error } = await supabase.rpc("venue_list_club_leagues", {
    p_venue_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[league] venue_list_club_leagues failed", error); throw error; }
  return data;
}

export async function venueUpsertClubFixture(venueToken, {
  fixtureId = null, leagueId = null, clubTeamId = null, clubTeamName = null,
  opponentName = null, isHome = null, scheduledDate = null, kickoffTime = null,
  playingAreaId = null, officialId = null, refName = null,
  homeScore = null, awayScore = null, status = null, notes = null, location = null } = {}) {
  const { data, error } = await supabase.rpc("venue_upsert_club_fixture", {
    p_venue_token: venueToken, p_fixture_id: fixtureId, p_league_id: leagueId,
    p_club_team_id: clubTeamId, p_club_team_name: clubTeamName, p_opponent_name: opponentName,
    p_is_home: isHome, p_scheduled_date: scheduledDate, p_kickoff_time: kickoffTime,
    p_playing_area_id: playingAreaId, p_official_id: officialId, p_ref_name: refName,
    p_home_score: homeScore, p_away_score: awayScore, p_status: status, p_notes: notes,
    p_location: location,
  });
  if (error) { console.error("[league] venue_upsert_club_fixture failed", error); throw error; }
  return data;
}

export async function venueDeleteClubFixture(venueToken, fixtureId) {
  const { data, error } = await supabase.rpc("venue_delete_club_fixture", {
    p_venue_token: venueToken, p_fixture_id: fixtureId,
  });
  if (error) { console.error("[league] venue_delete_club_fixture failed", error); throw error; }
  return data;
}

export async function venueListClubFixtures(venueToken, leagueId) {
  const { data, error } = await supabase.rpc("venue_list_club_fixtures", {
    p_venue_token: venueToken, p_league_id: leagueId,
  });
  if (error) { console.error("[league] venue_list_club_fixtures failed", error); throw error; }
  return data;
}

export async function venueSetMatchdayInfo(venueToken, info) {
  const { data, error } = await supabase.rpc("venue_set_matchday_info", {
    p_venue_token: venueToken, p_info: info,
  });
  if (error) { console.error("[league] venue_set_matchday_info failed", error); throw error; }
  return data;
}

export async function venueGetMatchdayInfo(venueToken) {
  const { data, error } = await supabase.rpc("venue_get_matchday_info", {
    p_venue_token: venueToken,
  });
  if (error) { console.error("[league] venue_get_matchday_info failed", error); throw error; }
  return data;
}

// Phase 2 (mig 390) — get-or-create the canonical join_club_team invite code
// for a club team. The QR encodes /q/<code>; resolve_invite_link returns the
// club/cohort/team context for the (Phase 3) membership-gated join flow.
export async function clubEnsureTeamInviteLink(venueToken, teamId) {
  const { data, error } = await supabase.rpc("club_ensure_team_invite_link", {
    p_venue_token: venueToken, p_team_id: teamId,
  });
  if (error) { console.error("[club] club_ensure_team_invite_link failed", error); throw error; }
  return data;
}

// Phase 3 (mig 391) — resolve a scanned join_club_team code into its team/cohort/
// club context + the club venue's public venue_landing code (used to drive the
// existing 360 membership wizard), plus the signed-in caller's membership/on-team
// status for self + accepted children. anon + authenticated.
export async function clubTeamJoinContext(code) {
  const { data, error } = await supabase.rpc("club_team_join_context", { p_code: code });
  if (error) { console.error("[club] club_team_join_context failed", error); return null; }
  return data;
}

// Phase 3 (mig 391) — membership-gated assignment of self (or an accepted child)
// onto a club team. Authenticated only; the RPC enforces an active membership at
// the team's venue and is idempotent. forProfileId null = join as self.
export async function memberJoinClubTeam(code, forProfileId = null) {
  const { data, error } = await supabase.rpc("member_join_club_team", {
    p_code: code, p_for_profile_id: forProfileId ?? null,
  });
  if (error) { console.error("[member] member_join_club_team failed", error); throw error; }
  return data;
}

export async function clubCreateSession(venueToken, clubId, { title, scheduledAt, cohortId = null, location = null, notes = null, capacity = null, venueId = null, playingAreaId = null } = {}) {
  const { data, error } = await supabase.rpc("club_create_session", {
    p_venue_token: venueToken, p_club_id: clubId, p_title: title,
    p_scheduled_at: scheduledAt, p_cohort_id: cohortId ?? null,
    p_location: location, p_notes: notes, p_capacity: capacity,
    p_venue_id: venueId, p_playing_area_id: playingAreaId,
  });
  if (error) { console.error("[club] club_create_session failed", error); throw error; }
  return data;
}

export async function clubUpdateSession(venueToken, sessionId, { title = null, scheduledAt = null, location = null, notes = null, capacity = null, venueId = null, playingAreaId = null } = {}) {
  const { data, error } = await supabase.rpc("club_update_session", {
    p_venue_token: venueToken, p_session_id: sessionId, p_title: title,
    p_scheduled_at: scheduledAt, p_location: location, p_notes: notes, p_capacity: capacity,
    p_venue_id: venueId, p_playing_area_id: playingAreaId,
  });
  if (error) { console.error("[club] club_update_session failed", error); throw error; }
  return data;
}

export async function clubCancelSession(venueToken, sessionId, reason = null) {
  const { data, error } = await supabase.rpc("club_cancel_session", {
    p_venue_token: venueToken, p_session_id: sessionId, p_reason: reason,
  });
  if (error) { console.error("[club] club_cancel_session failed", error); throw error; }
  return data;
}

export async function clubListSessions(venueToken, clubId, { cohortId = null, from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc("club_list_sessions", {
    p_venue_token: venueToken, p_club_id: clubId,
    p_cohort_id: cohortId, p_from: from, p_to: to,
  });
  if (error) { console.error("[club] club_list_sessions failed", error); throw error; }
  return data;
}

export async function clubGetSessionRsvps(venueToken, sessionId) {
  const { data, error } = await supabase.rpc("club_get_session_rsvps", {
    p_venue_token: venueToken, p_session_id: sessionId,
  });
  if (error) { console.error("[club] club_get_session_rsvps failed", error); throw error; }
  return data;
}

export async function clubMarkAttendance(venueToken, sessionId, attendances) {
  const { data, error } = await supabase.rpc("club_mark_attendance", {
    p_venue_token: venueToken, p_session_id: sessionId, p_attendances: attendances,
  });
  if (error) { console.error("[club] club_mark_attendance failed", error); throw error; }
  return data;
}

export async function clubCreateSessionSeries(venueToken, clubId, {
  title, sessionType, dayOfWeek, startTime, fromDate, toDate,
  cohortId = null, teamId = null, location = null, notes = null, capacity = null,
  venueId = null, playingAreaId = null,
} = {}) {
  const { data, error } = await supabase.rpc("club_create_session_series", {
    p_venue_token: venueToken, p_club_id: clubId, p_title: title,
    p_session_type: sessionType, p_day_of_week: dayOfWeek, p_start_time: startTime,
    p_from_date: fromDate, p_to_date: toDate,
    p_cohort_id: cohortId, p_team_id: teamId,
    p_location: location, p_notes: notes, p_capacity: capacity,
    p_venue_id: venueId, p_playing_area_id: playingAreaId,
  });
  if (error) { console.error("[club] club_create_session_series failed", error); throw error; }
  return data;
}

export async function clubCancelSessionSeries(venueToken, seriesId, reason = null) {
  const { data, error } = await supabase.rpc("club_cancel_session_series", {
    p_venue_token: venueToken, p_series_id: seriesId, p_reason: reason,
  });
  if (error) { console.error("[club] club_cancel_session_series failed", error); throw error; }
  return data;
}

export async function memberListUpcomingSessions(clubId, cohortId = null) {
  const { data, error } = await supabase.rpc("member_list_upcoming_sessions", {
    p_club_id: clubId, p_cohort_id: cohortId,
  });
  if (error) { console.error("[member] member_list_upcoming_sessions failed", error); throw error; }
  return data;
}

// Club Leagues fixtures (club_fixtures, operator-created) for the caller's managed teams
// in this club. READ-ONLY (Calendar & Mobile Phase 3a) — folded into the manager Agenda
// alongside member_list_upcoming_sessions. Returns [] for non-managers / no fixtures.
export async function memberListClubFixtures(clubId) {
  const { data, error } = await supabase.rpc("member_list_club_fixtures", {
    p_club_id: clubId,
  });
  if (error) { console.error("[member] member_list_club_fixtures failed", error); throw error; }
  return data;
}

// Calendar & Mobile Phase 3b — HOME-team manager edits a Club League fixture's logistics
// (pitch / referee / kickoff). Options reader feeds the edit form's pitch + official pickers;
// the fixture row carries the current values. Manager + is_home gated server-side.
export async function clubManagerGetHomeFixtureOptions(fixtureId) {
  const { data, error } = await supabase.rpc("club_manager_get_home_fixture_options", {
    p_fixture_id: fixtureId,
  });
  if (error) { console.error("[manager] club_manager_get_home_fixture_options failed", error); throw error; }
  return data;
}

// Guarded write: sets pitch (playingAreaId), referee (officialId OR free-text refName) and
// kickoff (kickoffTime, "HH:MM" or null). All other fields stay operator-owned. Throws on
// slot_unavailable / pitch_not_in_venue / ref_not_in_venue / not_a_manager / away_read_only.
export async function clubManagerUpdateHomeFixture(fixtureId, {
  playingAreaId = null, officialId = null, refName = null, kickoffTime = null, location = null, notes = null,
} = {}) {
  const { data, error } = await supabase.rpc("club_manager_update_home_fixture", {
    p_fixture_id: fixtureId,
    p_playing_area_id: playingAreaId,
    p_official_id: officialId,
    p_ref_name: refName,
    p_kickoff_time: kickoffTime,
    p_location: location,
    p_notes: notes,
  });
  if (error) { console.error("[manager] club_manager_update_home_fixture failed", error); throw error; }
  return data;
}

// Modular Epic C — C3: team-manager "Fixtures & availability" (/hub league tab).
// Param-less reader: derives every active-managed team from auth.uid server-side and
// returns each team's upcoming (scheduled) + recent (completed) club_fixtures. Each
// upcoming fixture carries the availability roster + counts (in/out/maybe/pending).
// Source-agnostic — FA-imported auto-opened fixtures appear automatically. Throws
// not_authorised when the caller manages no active team.
export async function clubManagerListTeamFixtures() {
  const { data, error } = await supabase.rpc("club_manager_list_team_fixtures", {});
  if (error) { console.error("[manager] club_manager_list_team_fixtures failed", error); throw error; }
  return data;
}

// ── matchday (mig 516) — coach picks XI + logs per-player stats/POTM + result.
// Coach-auth (auth.uid → club_team_managers for the fixture's own team). Consumer:
// apps/inorout /hub TeamManagerMatchday.jsx. Club Manager epic PR #8.
export async function clubManagerGetFixtureDetail(fixtureId) {
  const { data, error } = await supabase.rpc("club_manager_get_fixture_detail", { p_fixture_id: fixtureId });
  if (error) { console.error("[manager] club_manager_get_fixture_detail failed", error); throw error; }
  return data;
}

// selections = [{ member_profile_id, is_starter, position, sort_order }]
export async function clubManagerSetFixtureLineup(fixtureId, selections) {
  const { data, error } = await supabase.rpc("club_manager_set_fixture_lineup", {
    p_fixture_id: fixtureId, p_selections: selections,
  });
  if (error) { console.error("[manager] club_manager_set_fixture_lineup failed", error); throw error; }
  return data;
}

// stats = [{ member_profile_id, goals, assists, yellow_cards, red_cards, minutes, is_potm }]
export async function clubManagerRecordFixtureStats(fixtureId, stats, { homeScore = null, awayScore = null, status = "completed" } = {}) {
  const { data, error } = await supabase.rpc("club_manager_record_fixture_stats", {
    p_fixture_id: fixtureId, p_stats: stats,
    p_home_score: homeScore, p_away_score: awayScore, p_status: status,
  });
  if (error) { console.error("[manager] club_manager_record_fixture_stats failed", error); throw error; }
  return data;
}

// Club team reliability + Smart-Teams (mig 517). Returns the NEUTRAL engine input
// shape ({ players, matchRows, exactMatchIds, totalGamesInPeriod }) so
// computePlayerRatings + generateBalancedTeams (packages/core/engine/*) run unchanged,
// PLUS a per-player reliability (turnout %). Coach-auth. Consumer: apps/inorout /hub
// TeamManagerSquad.jsx. Club Manager epic PR #7a.
export async function clubManagerGetTeamRatings(teamId) {
  const { data, error } = await supabase.rpc("club_manager_get_team_ratings_table", { p_team_id: teamId });
  if (error) { console.error("[manager] club_manager_get_team_ratings_table failed", error); throw error; }
  return data;
}

// Per-player COMPLIANCE doc-status for a coach's squad (Holiday-hub P10, mig 538): for each
// active team member, whether their consents (current policy_documents), ID proof (id_mandate
// clubs) and medical review (within 12mo) are done / due / submitted / na. STATUS FLAGS ONLY —
// no medical content (that stays guardian-only). Coach-auth (club_team_managers). Consumer:
// apps/inorout /hub coach doc-status screen. Returns { ok, team, requirements, summary, members }.
export async function clubManagerGetTeamDocStatus(teamId) {
  const { data, error } = await supabase.rpc("club_manager_get_team_doc_status", { p_team_id: teamId });
  if (error) { console.error("[manager] club_manager_get_team_doc_status failed", error); throw error; }
  return data;
}

// Adult-member SELF reliability/POTM (mig 519). Self-scoped twin of the coach board:
// member-auth (auth.uid -> member_profiles.id), returns ONLY the caller's own row per
// club team they're an active member of ({ ok, teams: [...] }). Consumer: apps/inorout
// /hub MemberReliability.jsx (member "Stats" tab). Club Console PR #6 Phase B.
export async function clubMemberGetSelfReliability() {
  const { data, error } = await supabase.rpc("club_member_get_self_reliability", {});
  if (error) { console.error("[member] club_member_get_self_reliability failed", error); throw error; }
  return data;
}

export async function memberRsvpSession(sessionId, status, { forProfileId = null, note = null } = {}) {
  const { data, error } = await supabase.rpc("member_rsvp_session", {
    p_session_id: sessionId, p_status: status,
    p_for_profile_id: forProfileId, p_note: note,
  });
  if (error) { console.error("[member] member_rsvp_session failed", error); throw error; }
  return data;
}

export async function memberGetSessionRsvpBoard(sessionId) {
  const { data, error } = await supabase.rpc("member_get_session_rsvp_board", {
    p_session_id: sessionId,
  });
  if (error) { console.error("[member] member_get_session_rsvp_board failed", error); throw error; }
  return data;
}

// Coach ROSTER-AWARE session board (mig 528) — like member_get_session_rsvp_board but keyed
// on the session's TEAM roster (club_team_members), so a member with no RSVP lands in
// 'pending' (No reply) exactly as matches compute it. Coach-gated (auth.uid → the session's
// team via club_team_managers). Read-only. Consumer: apps/inorout SessionRsvpSheet.jsx.
export async function clubManagerGetSessionBoard(sessionId) {
  const { data, error } = await supabase.rpc("club_manager_get_session_board", {
    p_session_id: sessionId,
  });
  if (error) { console.error("[club-manager] club_manager_get_session_board failed", error); throw error; }
  return data;
}

// Coach camp roster (mig 544) — the team's upcoming camp/class sessions, each with its booked
// roster embedded (member_name/age/status/payment_status/waitlist_position — same attendee
// contract as the desktop venue_get_class_session_detail). Coach-authed (club_team_managers).
// Returns { ok, team_id, team_name, camps:[{session_id, class_name, starts_at, booked_count, roster:[...]}] }.
export async function clubManagerGetTeamCamps(teamId) {
  const { data, error } = await supabase.rpc("club_manager_get_team_camps", { p_team_id: teamId });
  if (error) { console.error("[club-manager] club_manager_get_team_camps failed", error); throw error; }
  return data;
}

// Coach marks a camp/class booking attended/not (mig 552). Scope-verified server-side (the camp
// must be the coach's team's OR audience='all' at the team's venue). Toggles checked_in_at.
export async function clubManagerMarkCampAttended(teamId, bookingId, attended) {
  const { data, error } = await supabase.rpc("club_manager_mark_camp_attended", {
    p_team_id: teamId, p_booking_id: bookingId, p_attended: attended,
  });
  if (error) { console.error("[club-manager] club_manager_mark_camp_attended failed", error); throw error; }
  return data;
}

// Guardian app Phase 1 (mig 426) — read a child's FA grassroots league fixtures.
// Returns { ok, child_profile_id, upcoming:[...], recent:[...] }; each upcoming
// fixture carries own_rsvp_status (in|out|maybe|null). Guardian-gated server-side.
export async function guardianListChildFixtures(childProfileId) {
  const { data, error } = await supabase.rpc("guardian_list_child_fixtures", {
    p_child_profile_id: childProfileId,
  });
  if (error) { console.error("[guardian] guardian_list_child_fixtures failed", error); throw error; }
  return data;
}

// Guardian app Phase 1 (mig 426) — parent marks a child available/unavailable for
// a league fixture. status ∈ in|out|maybe. forProfileId = the child (omit/self for
// a member marking their own). Throws on not_guardian / not_on_team / fixture_not_found.
export async function guardianSetFixtureAvailability(fixtureId, status, { forProfileId = null } = {}) {
  const { data, error } = await supabase.rpc("guardian_set_fixture_availability", {
    p_fixture_id: fixtureId, p_status: status, p_for_profile_id: forProfileId,
  });
  if (error) { console.error("[guardian] guardian_set_fixture_availability failed", error); throw error; }
  return data;
}

// Guardian app Phase 1, screen 2 (mig 428) — read a child's grassroots league(s).
// Returns { ok, child_profile_id, leagues:[...] }; each league carries fa_embed_code/
// fa_source_url (official FA Full-Time table source), a computed team `form`
// (played/won/drawn/lost/gf/ga/gd/points/last5), and `fixtures`/`results` arrays.
// Grassroots club_fixtures cannot yield a real computed league table — form is the
// child's own TEAM record, never a league rank. Guardian-gated server-side.
export async function guardianListChildLeagues(childProfileId) {
  const { data, error } = await supabase.rpc("guardian_list_child_leagues", {
    p_child_profile_id: childProfileId,
  });
  if (error) { console.error("[guardian] guardian_list_child_leagues failed", error); throw error; }
  return data;
}

// Guardian app Phase 1, screen 3 (mig 429) — bookable upcoming extra classes at the
// venue(s) the child's club runs at. Returns { ok, child_profile_id, options:[...] }
// (session_id, class_name, starts_at, price_pence, payment_mode, members_only,
// spots_left, already_booked). Read-only, guardian-gated server-side.
export async function guardianListChildClassOptions(childProfileId) {
  const { data, error } = await supabase.rpc("guardian_list_child_class_options", {
    p_child_profile_id: childProfileId,
  });
  if (error) { console.error("[guardian] guardian_list_child_class_options failed", error); throw error; }
  return data;
}

// Guardian app Phase 1, screen 3 (mig 429) — book a paid extra class FOR A CHILD.
// forProfileId = the child (omit/self for a member booking their own). Writes into
// venue_class_bookings + the venue_charges ledger (same desktop place). Returns
// { ok, booking_id, status, payment_status, ... } or { ok:false, reason } for
// already_booked / suspended / payment_method_unavailable. Throws not_guardian etc.
export async function guardianBookClassSession(sessionId, { forProfileId = null } = {}) {
  const { data, error } = await supabase.rpc("guardian_book_class_session", {
    p_session_id: sessionId, p_for_profile_id: forProfileId,
  });
  if (error) { console.error("[guardian] guardian_book_class_session failed", error); throw error; }
  return data;
}

export async function clubManagerCreateSession(teamId, {
  title, scheduledAt, sessionType = 'training',
  location = null, notes = null, capacity = null,
  meetTime = null, opponentName = null, homeAway = null,
  opponentVenueName = null, opponentAddress = null,
  venueId = null, playingAreaId = null,
} = {}) {
  const { data, error } = await supabase.rpc("club_manager_create_session", {
    p_team_id: teamId, p_title: title, p_scheduled_at: scheduledAt,
    p_session_type: sessionType, p_location: location, p_notes: notes,
    p_capacity: capacity, p_meet_time: meetTime, p_opponent_name: opponentName,
    p_home_away: homeAway, p_opponent_venue_name: opponentVenueName,
    p_opponent_address: opponentAddress,
    p_venue_id: venueId, p_playing_area_id: playingAreaId,
  });
  if (error) { console.error("[club-manager] club_manager_create_session failed", error); throw error; }
  return data;
}

export async function clubManagerCreateSessionSeries(teamId, {
  title, dayOfWeek, startTime, fromDate, toDate,
  sessionType = 'training', location = null, notes = null, capacity = null,
  venueId = null, playingAreaId = null,
} = {}) {
  const { data, error } = await supabase.rpc("club_manager_create_session_series", {
    p_team_id: teamId, p_title: title, p_day_of_week: dayOfWeek,
    p_start_time: startTime, p_from_date: fromDate, p_to_date: toDate,
    p_session_type: sessionType, p_location: location, p_notes: notes,
    p_capacity: capacity,
    p_venue_id: venueId, p_playing_area_id: playingAreaId,
  });
  if (error) { console.error("[club-manager] club_manager_create_session_series failed", error); throw error; }
  return data;
}

// Coach pitch-availability reader (mig 558): busy blocks + pitches for a ground the
// coach's club is linked to, so the /hub booking sheet can show free slots. Coaches
// have no venue token — auth is auth.uid() → active club_team_manager of p_team_id.
export async function clubManagerPitchAvailability(teamId, venueId, from, to) {
  const { data, error } = await supabase.rpc("club_manager_pitch_availability", {
    p_team_id: teamId, p_venue_id: venueId, p_from: from, p_to: to,
  });
  if (error) { console.error("[club-manager] club_manager_pitch_availability failed", error); throw error; }
  return data;
}

// Coach pitch WRITE path (mig 560): create the session status='scheduled' + try to
// allocate the pitch. Empty slot / worse-ranked clash → pitch_status='allocated'
// (reserved, incumbent auto-bumped); a non-bumpable clash → pitch_status='requested'
// (held, no error — the session stays visible as "pitch being confirmed"). Auth is
// auth.uid() → active club_team_manager of teamId. Returns {ok, session_id,
// pitch_status, session_type}.
export async function clubManagerBookPitch(teamId, {
  venueId, playingAreaId, scheduledAt, title,
  sessionType = "training", durationMins = 60,
  location = null, notes = null, capacity = null, meetTime = null,
} = {}) {
  const { data, error } = await supabase.rpc("club_manager_book_pitch", {
    p_team_id: teamId, p_venue_id: venueId, p_playing_area_id: playingAreaId,
    p_scheduled_at: scheduledAt, p_title: title, p_session_type: sessionType,
    p_duration_mins: durationMins, p_location: location, p_notes: notes,
    p_capacity: capacity, p_meet_time: meetTime,
  });
  if (error) { console.error("[club-manager] club_manager_book_pitch failed", error); throw error; }
  return data;
}

// Coach pitch WRITE path — weekly recurring (mig 560). Per-occurrence book-or-request:
// each week allocates if free / bumps a worse-ranked incumbent, or is held as a request
// on a non-bumpable clash; the run never rolls back whole. Returns {ok, series_id,
// allocated_count, requested_count, weeks[]}. Manager-gated (auth.uid → team manager).
export async function clubManagerBookPitchSeries(teamId, {
  venueId, playingAreaId, title, dayOfWeek, startTime, fromDate, toDate,
  sessionType = "training", durationMins = 60,
  location = null, notes = null, capacity = null,
} = {}) {
  const { data, error } = await supabase.rpc("club_manager_book_pitch_series", {
    p_team_id: teamId, p_venue_id: venueId, p_playing_area_id: playingAreaId, p_title: title,
    p_day_of_week: dayOfWeek, p_start_time: startTime, p_from_date: fromDate, p_to_date: toDate,
    p_session_type: sessionType, p_duration_mins: durationMins,
    p_location: location, p_notes: notes, p_capacity: capacity,
  });
  if (error) { console.error("[club-manager] club_manager_book_pitch_series failed", error); throw error; }
  return data;
}

// Manager-gated list of the grounds a Manager can book a pitch on (mig 565): the team's
// club's linked club_venues, as [{venue_id, venue_name}] — same shape as active_clubs[]
// .venues but keyed on the manager relationship (not membership), so it populates for a
// Manager who isn't also a paying club member.
export async function clubManagerListBookableVenues(teamId) {
  const { data, error } = await supabase.rpc("club_manager_list_bookable_venues", {
    p_team_id: teamId,
  });
  if (error) { console.error("[club-manager] club_manager_list_bookable_venues failed", error); throw error; }
  return data;
}

// Withdraw a pending pitch REQUEST (mig 563): pitch_status 'requested' → 'none'. The
// session stays scheduled (visible, RSVPs kept) as "pitch TBC". Manager-gated; a
// session tied to a pending bump proposal must be resolved via the bump card instead.
export async function clubManagerWithdrawPitchRequest(sessionId) {
  const { data, error } = await supabase.rpc("club_manager_withdraw_pitch_request", {
    p_session_id: sessionId,
  });
  if (error) { console.error("[club-manager] club_manager_withdraw_pitch_request failed", error); throw error; }
  return data;
}

export async function clubManagerCancelSession(sessionId, reason = null) {
  const { data, error } = await supabase.rpc("club_manager_cancel_session", {
    p_session_id: sessionId, p_reason: reason,
  });
  if (error) { console.error("[club-manager] club_manager_cancel_session failed", error); throw error; }
  return data;
}

// Edit / reschedule / re-pitch a scheduled session (mig 567). Occupancy is handled by
// the shipped tg_sync_club_session_occupancy trigger; a non-bumpable clash on the new
// slot returns { ok:false, reason:'slot_taken' } (booking left unchanged). Pass only the
// fields that change (null = keep); clearPitch:true un-books the pitch.
export async function clubManagerUpdateSession(sessionId, {
  title = null, scheduledAt = null, durationMins = null, venueId = null, playingAreaId = null,
  location = null, notes = null, capacity = null, meetTime = null, clearPitch = false,
} = {}) {
  const { data, error } = await supabase.rpc("club_manager_update_session", {
    p_session_id: sessionId, p_title: title, p_scheduled_at: scheduledAt,
    p_duration_mins: durationMins, p_venue_id: venueId, p_playing_area_id: playingAreaId,
    p_location: location, p_notes: notes, p_capacity: capacity, p_meet_time: meetTime,
    p_clear_pitch: clearPitch,
  });
  if (error) { console.error("[club-manager] club_manager_update_session failed", error); throw error; }
  return data;
}

// Cancel the whole recurring block (mig 567) — every future, still-scheduled occurrence
// sharing the session's series_id (or just this one if it has no series). Occupancy is
// released per occurrence by the trigger. Returns { ok, series_id, cancelled_count }.
export async function clubManagerCancelSeries(sessionId, reason = null) {
  const { data, error } = await supabase.rpc("club_manager_cancel_series", {
    p_session_id: sessionId, p_reason: reason,
  });
  if (error) { console.error("[club-manager] club_manager_cancel_series failed", error); throw error; }
  return data;
}

export async function clubManagerGetTeamMembers(teamId, sessionId = null) {
  const { data, error } = await supabase.rpc("club_manager_get_team_members", {
    p_team_id: teamId, p_session_id: sessionId,
  });
  if (error) { console.error("[club-manager] club_manager_get_team_members failed", error); throw error; }
  return data;
}

export async function clubManagerAddSessionGuest(sessionId, guestProfileId) {
  const { data, error } = await supabase.rpc("club_manager_add_session_guest", {
    p_session_id: sessionId, p_guest_profile_id: guestProfileId,
  });
  if (error) { console.error("[club-manager] club_manager_add_session_guest failed", error); throw error; }
  return data;
}

export async function clubManagerRemoveSessionGuest(sessionId, guestProfileId) {
  const { data, error } = await supabase.rpc("club_manager_remove_session_guest", {
    p_session_id: sessionId, p_guest_profile_id: guestProfileId,
  });
  if (error) { console.error("[club-manager] club_manager_remove_session_guest failed", error); throw error; }
  return data;
}

export async function clubManagerMarkAttendance(sessionId, attendances) {
  const { data, error } = await supabase.rpc("club_manager_mark_attendance", {
    p_session_id: sessionId, p_attendances: attendances,
  });
  if (error) { console.error("[club-manager] club_manager_mark_attendance failed", error); throw error; }
  return data;
}

export async function clubManagerGetMemberDetail(memberProfileId) {
  const { data, error } = await supabase.rpc("club_manager_get_member_detail", {
    p_member_profile_id: memberProfileId,
  });
  if (error) { console.error("[club-manager] club_manager_get_member_detail failed", error); throw error; }
  return data;
}

export async function venueAssignTeamManager(venueToken, teamId, memberProfileId, role) {
  const { data, error } = await supabase.rpc("venue_assign_team_manager", {
    p_token: venueToken, p_team_id: teamId,
    p_member_profile_id: memberProfileId, p_role: role,
  });
  if (error) { console.error("[club-staff] venue_assign_team_manager failed", error); throw error; }
  return data;
}

export async function venueRemoveTeamManager(venueToken, teamId, memberProfileId) {
  const { data, error } = await supabase.rpc("venue_remove_team_manager", {
    p_token: venueToken, p_team_id: teamId, p_member_profile_id: memberProfileId,
  });
  if (error) { console.error("[club-staff] venue_remove_team_manager failed", error); throw error; }
  return data;
}

export async function venueListClubStaff(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_list_club_staff", {
    p_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[club-staff] venue_list_club_staff failed", error); throw error; }
  return data ?? [];
}

// Per-member COMPLIANCE doc-status for the whole club (Holiday-hub P10c, mig 539): the
// venue-token (admin/owner, manage_facility) twin of the coach reader — for each active club
// member (venue_memberships) whether consents / ID proof / medical review are done/due/
// submitted/na. STATUS FLAGS ONLY (no medical content). Consumer: apps/venue SafeguardingBoard.
// Returns { ok, club, requirements, summary, members }.
export async function venueGetClubDocStatus(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_get_club_doc_status", {
    p_venue_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[club-docs] venue_get_club_doc_status failed", error); throw error; }
  return data;
}

// Venue-token committee reader (mig 521) — the club-admin /hub twin of
// club_list_committee (which is coach-auth). Returns the club's committee "who's who".
export async function venueListClubCommittee(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_list_club_committee", {
    p_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[club-committee] venue_list_club_committee failed", error); throw error; }
  return data ?? [];
}

export async function venueUpsertStaffDbs(venueToken, memberProfileId, clubId, {
  checkType, status, certificateNumber = null, issuedDate = null,
  expiryDate = null, notes = null,
} = {}) {
  const { data, error } = await supabase.rpc("venue_upsert_staff_dbs", {
    p_token: venueToken, p_member_profile_id: memberProfileId, p_club_id: clubId,
    p_check_type: checkType, p_status: status,
    p_certificate_number: certificateNumber, p_issued_date: issuedDate,
    p_expiry_date: expiryDate, p_notes: notes,
  });
  if (error) { console.error("[club-staff] venue_upsert_staff_dbs failed", error); throw error; }
  return data;
}

// ── Club-level (TEAM-LESS) coach roster — DF Sports PR #5, mig 582 ──
// The coaching-academy session model (mig 362): coaches are club-level session staff,
// NOT one-coach-owns-a-team. These three sit ALONGSIDE the team-scoped
// venue_assign/remove_team_manager + venue_list_club_staff — a team-less coach fits
// neither venue_admins nor club_team_managers. DBS for these coaches reuses
// venueUpsertStaffDbs (already keyed member_profile_id + club_id, team-less).
// Consumers: apps/venue SafeguardingBoard; apps/inorout ClubAdminSafeguarding + ClubAdminPeople.

export async function venueUpsertClubCoach(venueToken, memberProfileId, clubId, role = "coach") {
  const { data, error } = await supabase.rpc("venue_upsert_club_coach", {
    p_token: venueToken, p_member_profile_id: memberProfileId, p_club_id: clubId, p_role: role,
  });
  if (error) { console.error("[club-coach] venue_upsert_club_coach failed", error); throw error; }
  return data;
}

export async function venueRemoveClubCoach(venueToken, memberProfileId, clubId) {
  const { data, error } = await supabase.rpc("venue_remove_club_coach", {
    p_token: venueToken, p_member_profile_id: memberProfileId, p_club_id: clubId,
  });
  if (error) { console.error("[club-coach] venue_remove_club_coach failed", error); throw error; }
  return data;
}

// Team-less coach roster + DBS, returned as its OWN array (NEVER null-UNIONed into
// venue_list_club_staff — a team-less coach has no cohort_id, so a UNION would let a
// DBS-less coach escape the cohort-keyed youth warning). Each row carries a
// server-computed serves_youth flag so the youth-DBS warning is authoritative.
export async function venueListClubCoaches(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_list_club_coaches", {
    p_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[club-coach] venue_list_club_coaches failed", error); throw error; }
  return data ?? [];
}

// Create a brand-new session coach (mig 583) — mints a lightweight IDENTITY-ONLY
// member_profile (first name required; last/email/phone optional; no consent/medical/
// login), OR reuses an existing profile by email (no duplicate person), AND adds them
// to the team-less coach roster in ONE atomic call. Same manage_memberships-gated
// venue-token surface as venueUpsertClubCoach. The "create" half of the ClubAdminPeople
// Add-coach sheet (venueUpsertClubCoach is the "pick" half). DBS stays a separate step
// (venueUpsertStaffDbs). Returns { ok, coach_id, member_profile_id, reused }.
export async function venueCreateCoachProfile(venueToken, clubId, { firstName, lastName = null, email = null, phone = null, role = "coach" } = {}) {
  const { data, error } = await supabase.rpc("venue_create_coach_profile", {
    p_token: venueToken, p_club_id: clubId, p_first_name: firstName,
    p_last_name: lastName, p_email: email, p_phone: phone, p_role: role,
  });
  if (error) { console.error("[club-coach] venue_create_coach_profile failed", error); throw error; }
  return data;
}

export async function clubSendAnnouncement(venueToken, clubId, title, body, audience, cohortId = null, teamId = null) {
  const { data, error } = await supabase.rpc("club_send_announcement", {
    p_token: venueToken, p_club_id: clubId, p_title: title, p_body: body,
    p_audience: audience, p_cohort_id: cohortId, p_team_id: teamId,
  });
  if (error) { console.error("[club-comms] club_send_announcement failed", error); throw error; }
  return data;
}

// Club-admin sent-history (mig 529) — venue-token reader returning the club's sent
// announcements (ALL audiences; the admin sees everything). Authorises like the other
// club-admin readers (resolve_venue_caller → club linked to the caller's venue). Read-only.
// Consumer: apps/inorout ClubAdminComms.jsx (/hub club-admin Comms — sent history).
export async function venueListClubAnnouncements(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_list_club_announcements", {
    p_venue_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[club-comms] venue_list_club_announcements failed", error); throw error; }
  return data?.announcements ?? [];
}

// Team-manager-scoped announcement (Phase 4). Authenticated manager-of-team only;
// queues a club_announcements row delivered to the team's players + accepted guardians
// by the existing club-broadcast cron.
export async function clubManagerSendAnnouncement(teamId, title, body) {
  const { data, error } = await supabase.rpc("club_manager_send_announcement", {
    p_team_id: teamId, p_title: title, p_body: body,
  });
  if (error) { console.error("[club-manager] club_manager_send_announcement failed", error); throw error; }
  return data;
}

// Coach paid/unpaid roster (mig 398) — a team manager sees who's paid / who owes
// for their own team. Authenticated; manager-scoped server-side. Read-only.
export async function clubManagerTeamPayments(teamId) {
  const { data, error } = await supabase.rpc("club_manager_team_payments", {
    p_team_id: teamId,
  });
  if (error) { console.error("[club-manager] club_manager_team_payments failed", error); throw error; }
  return data;
}

// Coach-auth team join link (mig 527) — get-or-create the shareable 'join_club_team'
// invite code for a team the caller ACTIVELY manages (coach-gated via auth.uid →
// club_team_managers). Idempotent: returns the existing active code if present. Same
// invite_links row space as the venue-token twin (club_ensure_team_invite_link), so the
// code resolves through the same public /q/<code> → club_team_join_context flow. Consumer:
// apps/inorout TeamManagerPeople.jsx (/hub people — "Share join link").
export async function clubManagerEnsureTeamInviteLink(teamId) {
  const { data, error } = await supabase.rpc("club_manager_ensure_team_invite_link", {
    p_team_id: teamId,
  });
  if (error) { console.error("[club-manager] club_manager_ensure_team_invite_link failed", error); throw error; }
  return data;
}

// Returns the FULL object { announcements, unread_count } (mig 551 added read-state) — callers
// read `.announcements`. Was a bare array pre-551; both call sites updated in the same commit.
export async function memberListClubAnnouncements(clubId) {
  const { data, error } = await supabase.rpc("member_list_club_announcements", {
    p_club_id: clubId,
  });
  if (error) { console.error("[club-comms] member_list_club_announcements failed", error); throw error; }
  return data ?? { announcements: [], unread_count: 0 };
}

// Mark ONE club announcement read for the calling member (coach-safe visibility gate; mig 551).
export async function memberMarkAnnouncementRead(announcementId) {
  const { data, error } = await supabase.rpc("member_mark_announcement_read", { p_announcement_id: announcementId });
  if (error) { console.error("[club-comms] member_mark_announcement_read failed", error); throw error; }
  return data;
}

// Mark ALL visible club announcements read for the calling member (mig 551).
export async function memberMarkAllAnnouncementsRead(clubId) {
  const { data, error } = await supabase.rpc("member_mark_all_announcements_read", { p_club_id: clubId });
  if (error) { console.error("[club-comms] member_mark_all_announcements_read failed", error); throw error; }
  return data;
}

// ── Phase 9 — Club Merchandise (mig 309) ─────────────────────────────────────

export async function venueUpsertMerchandise(venueToken, clubId, {
  name, category, pricePence, id = null, description = null, stockQty = null, active = true,
} = {}) {
  const { data, error } = await supabase.rpc("venue_upsert_merchandise", {
    p_venue_token: venueToken, p_club_id: clubId, p_name: name,
    p_category: category, p_price_pence: pricePence,
    p_id: id, p_description: description, p_stock_qty: stockQty, p_active: active,
  });
  if (error) { console.error("[merch] venue_upsert_merchandise failed", error); throw error; }
  return data;
}

export async function venueListMerchandise(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_list_merchandise", {
    p_venue_token: venueToken, p_club_id: clubId,
  });
  if (error) { console.error("[merch] venue_list_merchandise failed", error); throw error; }
  return data?.items ?? [];
}

export async function venueListPurchases(venueToken, clubId, status = null) {
  const { data, error } = await supabase.rpc("venue_list_purchases", {
    p_venue_token: venueToken, p_club_id: clubId, p_status: status,
  });
  if (error) { console.error("[merch] venue_list_purchases failed", error); throw error; }
  return data?.purchases ?? [];
}

export async function venueFulfilPurchase(venueToken, purchaseId, notes = null) {
  const { data, error } = await supabase.rpc("venue_fulfil_purchase", {
    p_venue_token: venueToken, p_purchase_id: purchaseId, p_notes: notes,
  });
  if (error) { console.error("[merch] venue_fulfil_purchase failed", error); throw error; }
  return data;
}

export async function venueCancelPurchase(venueToken, purchaseId, reason = null) {
  const { data, error } = await supabase.rpc("venue_cancel_purchase", {
    p_venue_token: venueToken, p_purchase_id: purchaseId, p_reason: reason,
  });
  if (error) { console.error("[merch] venue_cancel_purchase failed", error); throw error; }
  return data;
}

export async function memberGetMerchandise(clubId) {
  const { data, error } = await supabase.rpc("member_get_merchandise", {
    p_club_id: clubId,
  });
  if (error) { console.error("[merch] member_get_merchandise failed", error); throw error; }
  return data?.items ?? [];
}

export async function memberPurchaseMerchandise(itemId, qty = 1, notes = null) {
  const { data, error } = await supabase.rpc("member_purchase_merchandise", {
    p_item_id: itemId, p_qty: qty, p_notes: notes,
  });
  if (error) { console.error("[merch] member_purchase_merchandise failed", error); throw error; }
  return data;
}

export async function memberListMyPurchases(clubId = null) {
  const { data, error } = await supabase.rpc("member_list_my_purchases", {
    p_club_id: clubId,
  });
  if (error) { console.error("[merch] member_list_my_purchases failed", error); throw error; }
  return data?.purchases ?? [];
}

// ── Classes Booking — Phase 3 member booking & timetable (mig 340) ────────────
// member_list_class_sessions is callable by anon (public "What's on" timetable);
// the rest are authenticated-only. All raw RPC names appear here exclusively.

export async function memberListClassSessions(venueId, { from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc("member_list_class_sessions", {
    p_venue_id: venueId, p_from: from, p_to: to,
  });
  if (error) { console.error("[classes] member_list_class_sessions failed", error); return []; }
  return data ?? [];
}

export async function memberBookClassSession(sessionId) {
  const { data, error } = await supabase.rpc("member_book_class_session", { p_session_id: sessionId });
  if (error) { console.error("[classes] member_book_class_session failed", error); throw error; }
  return data;
}

export async function memberCancelClassBooking(bookingId) {
  const { data, error } = await supabase.rpc("member_cancel_class_booking", { p_booking_id: bookingId });
  if (error) { console.error("[classes] member_cancel_class_booking failed", error); throw error; }
  return data;
}

export async function memberListMyClassBookings(venueId = null) {
  const { data, error } = await supabase.rpc("member_list_my_class_bookings", { p_venue_id: venueId });
  if (error) { console.error("[classes] member_list_my_class_bookings failed", error); return []; }
  return data ?? [];
}

// Phase 4 (mig 341): claim a waitlist spot the caller has been offered. Atomic —
// returns { ok:false, reason:'spot_taken' } if the claim window lapsed or the seat
// was taken; { ok:true, status:'confirmed', ... } on success.
export async function memberClaimWaitlistSpot(sessionId) {
  const { data, error } = await supabase.rpc("member_claim_waitlist_spot", { p_session_id: sessionId });
  if (error) { console.error("[classes] member_claim_waitlist_spot failed", error); throw error; }
  return data;
}

// ── Class packages (Phase 7, mig 344) — member surface ───────────────────────
// Public menu of a venue's active passes (no login). Drives the "Buy a class pass"
// sheet; purchase itself is auth-gated.
export async function memberListClassPackages(venueId) {
  const { data, error } = await supabase.rpc("member_list_class_packages", { p_venue_id: venueId });
  if (error) { console.error("[classes] member_list_class_packages failed", error); return []; }
  return data ?? [];
}

// Buy a pass (authenticated). Grants the balance immediately + raises an unpaid
// class_package charge. Returns { ok:true, balance_id, sessions_remaining, ... } or
// { ok:false, reason:'membership_required' }.
export async function memberPurchaseClassPackage(packageId) {
  const { data, error } = await supabase.rpc("member_purchase_class_package", { p_package_id: packageId });
  if (error) { console.error("[classes] member_purchase_class_package failed", error); throw error; }
  return data;
}

// The caller's active (unexpired, non-empty) class-pass balances. venueId=null
// returns all venues (member pass); a venue id scopes to one (timetable).
export async function memberGetPackageBalance(venueId = null) {
  const { data, error } = await supabase.rpc("member_get_package_balance", { p_venue_id: venueId });
  if (error) { console.error("[classes] member_get_package_balance failed", error); return []; }
  return data ?? [];
}

// ── PT / 1-on-1 appointment booking (Phase 3 gym/boxing vertical, mig 358) ───
// A trainer is a bookable resource with recurring weekly availability; a member
// books a single slot; money rides the shared venue_charges ledger (source_type
// 'pt', door path). Two independent levers decide who can book: an account is
// ALWAYS required (auth.uid); members_only adds the paid-membership requirement.

// Operator: create or edit a trainer. trainerId=null creates; otherwise edits.
// adminId optionally links a venue_admins staff login (null = no-login card).
// Returns { ok:true, trainer_id }.
export async function venueUpsertTrainer(venueToken, {
  trainerId = null, displayName, bio = null, adminId = null, defaultSessionMinutes = 60,
  pricePence = 0, cancelCutoffHours = 0, membersOnly = true, active = true,
} = {}) {
  const { data, error } = await supabase.rpc("venue_upsert_trainer", {
    p_venue_token: venueToken, p_trainer_id: trainerId, p_display_name: displayName,
    p_bio: bio, p_admin_id: adminId, p_default_session_minutes: defaultSessionMinutes,
    p_price_pence: pricePence, p_cancel_cutoff_hours: cancelCutoffHours,
    p_members_only: membersOnly, p_active: active });
  if (error) { console.error("[pt] venue_upsert_trainer failed", error); throw error; }
  return data;
}

// Operator: replace ALL recurring availability windows for a trainer. windows is
// an array of { dayOfWeek, startTime, endTime, slotMinutes, seriesStart, seriesEnd }.
// Returns { ok:true, trainer_id, windows }.
export async function venueSetTrainerAvailability(venueToken, trainerId, windows = []) {
  const p_windows = (windows ?? []).map((w) => ({
    day_of_week: w.dayOfWeek, start_time: w.startTime, end_time: w.endTime,
    slot_minutes: w.slotMinutes ?? 60, series_start: w.seriesStart ?? null, series_end: w.seriesEnd ?? null,
  }));
  const { data, error } = await supabase.rpc("venue_set_trainer_availability", {
    p_venue_token: venueToken, p_trainer_id: trainerId, p_windows });
  if (error) { console.error("[pt] venue_set_trainer_availability failed", error); throw error; }
  return data;
}

// Operator: trainers + nested availability + upcoming appointment counts.
export async function venueListTrainers(venueToken) {
  const { data, error } = await supabase.rpc("venue_list_trainers", { p_venue_token: venueToken });
  if (error) { console.error("[pt] venue_list_trainers failed", error); return { ok: false, trainers: [] }; }
  return data ?? { ok: false, trainers: [] };
}

// Operator: appointments in a time range (joined trainer + member names).
export async function venueListAppointments(venueToken, { from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc("venue_list_appointments", {
    p_venue_token: venueToken, p_from: from, p_to: to });
  if (error) { console.error("[pt] venue_list_appointments failed", error); return { ok: false, appointments: [] }; }
  return data ?? { ok: false, appointments: [] };
}

// Operator: QR check-in for a PT appointment (clone of venueClassCheckin). passToken
// is the scanned "/m/<token>" URL or bare token. Returns graceful { ok:false, reason }
// for per-scan misses and { ok:true, member_name } on success.
export async function venuePtCheckin(venueToken, appointmentId, passToken) {
  const { data, error } = await supabase.rpc("venue_pt_checkin", {
    p_venue_token: venueToken, p_appointment_id: appointmentId, p_pass_token: passToken });
  if (error) { console.error("[pt] venue_pt_checkin failed", error); throw error; }
  return data;
}

// Operator: mark a confirmed appointment completed, or a no-show (bumps the member's
// no_show_count + keeps the charge). Returns { ok, status, no_show_count }.
export async function venueMarkAppointmentCompleted(venueToken, appointmentId, noShow = false) {
  const { data, error } = await supabase.rpc("venue_mark_appointment_completed", {
    p_venue_token: venueToken, p_appointment_id: appointmentId, p_no_show: noShow });
  if (error) { console.error("[pt] venue_mark_appointment_completed failed", error); throw error; }
  return data;
}

// Operator books an EXISTING member into a trainer slot straight to 'confirmed' (mig 423,
// calendar Phase 2b). No availability-window enforcement (ad-hoc override); inlined overlap
// guard. endsAt defaults to the trainer's default_session_minutes, pricePence to the
// trainer's price. Returns { ok, appointment_id, ... } or { ok:false, reason:'slot_taken' }.
export async function venueCreateAppointment(venueToken, trainerId, memberProfileId, startsAt, {
  endsAt = null, pricePence = null } = {}) {
  const { data, error } = await supabase.rpc("venue_create_appointment", {
    p_venue_token: venueToken, p_trainer_id: trainerId, p_member_profile_id: memberProfileId,
    p_starts_at: startsAt, p_ends_at: endsAt, p_price_pence: pricePence });
  if (error) { console.error("[pt] venue_create_appointment failed", error); throw error; }
  return data;
}

// Member: active trainers at a venue + whether the caller can book each (bookable
// = open trainer OR caller holds an active membership). Returns { ok, is_member, trainers }.
export async function memberListTrainers(venueId) {
  const { data, error } = await supabase.rpc("member_list_trainers", { p_venue_id: venueId });
  if (error) { console.error("[pt] member_list_trainers failed", error); return { ok: false, trainers: [] }; }
  return data ?? { ok: false, trainers: [] };
}

// Member: bookable slots for a trainer between two dates (availability minus booked,
// future only, capped 62 days). Returns { ok, slots:[{starts_at, ends_at, ...}] }.
export async function memberListTrainerSlots(trainerId, { from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc("member_list_trainer_slots", {
    p_trainer_id: trainerId, p_from: from, p_to: to });
  if (error) { console.error("[pt] member_list_trainer_slots failed", error); return { ok: false, slots: [] }; }
  return data ?? { ok: false, slots: [] };
}

// Member: book a slot (writes a venue_charges 'pt' row when priced). Returns
// { ok:true, appointment_id, ... } or graceful { ok:false, reason:'slot_taken'|'suspended' }.
export async function memberBookAppointment(trainerId, startsAt) {
  const { data, error } = await supabase.rpc("member_book_appointment", {
    p_trainer_id: trainerId, p_starts_at: startsAt });
  if (error) { console.error("[pt] member_book_appointment failed", error); throw error; }
  return data;
}

// Member: cancel own appointment (honours the trainer's cutoff window, refunds the
// charge, frees the slot). Returns { ok:true, refunded }.
export async function memberCancelAppointment(appointmentId) {
  const { data, error } = await supabase.rpc("member_cancel_appointment", { p_appointment_id: appointmentId });
  if (error) { console.error("[pt] member_cancel_appointment failed", error); throw error; }
  return data;
}

// Member: the caller's own upcoming/recent appointments (from yesterday on),
// optionally scoped to one venue. Returns { ok, appointments:[...] }.
export async function memberListMyAppointments(venueId = null) {
  const { data, error } = await supabase.rpc("member_list_my_appointments", { p_venue_id: venueId });
  if (error) { console.error("[pt] member_list_my_appointments failed", error); return { ok: false, appointments: [] }; }
  return data ?? { ok: false, appointments: [] };
}

// ── Room hire (mig 342, Phase 5) — member/public surface ─────────────────────
// Public read of hireable spaces for the "Hire a space" cards (no login needed).
export async function memberListHireableSpaces(venueId) {
  const { data, error } = await supabase.rpc("member_list_hireable_spaces", { p_venue_id: venueId });
  if (error) { console.error("[roomhire] member_list_hireable_spaces failed", error); return []; }
  return data ?? [];
}

// Self-serve hire request (authenticated). equipmentIds optional add-ons.
// Returns { ok:true, hire_id } or { ok:false, reason:'space_unavailable'|'too_many_requests' }.
export async function memberRequestRoomHire(spaceId, { startsAt, endsAt, purpose, attendeeCount = null, equipmentIds = null } = {}) {
  const { data, error } = await supabase.rpc("member_request_room_hire", {
    p_space_id: spaceId, p_starts_at: startsAt, p_ends_at: endsAt, p_purpose: purpose,
    p_attendee_count: attendeeCount, p_equipment_ids: equipmentIds });
  if (error) { console.error("[roomhire] member_request_room_hire failed", error); throw error; }
  return data;
}

// Anon enquiry for an enquiry-only space (works logged-out or in). Returns { ok, hire_id }.
export async function publicEnquireRoomHire(spaceId, { name, email, phone = null, startsAt, endsAt, purpose, attendeeCount = null } = {}) {
  const { data, error } = await supabase.rpc("public_enquire_room_hire", {
    p_space_id: spaceId, p_name: name, p_email: email, p_phone: phone,
    p_starts_at: startsAt, p_ends_at: endsAt, p_purpose: purpose, p_attendee_count: attendeeCount });
  if (error) { console.error("[roomhire] public_enquire_room_hire failed", error); throw error; }
  return data;
}

// The caller's room hires (upcoming + history). Returns [] when no member profile.
export async function memberListMyRoomHires(venueId = null) {
  const { data, error } = await supabase.rpc("member_list_my_room_hires", { p_venue_id: venueId });
  if (error) { console.error("[roomhire] member_list_my_room_hires failed", error); return []; }
  return data ?? [];
}

// ── Phase 0 — Event OS: Account Relationship Routing (mig 314) ───────────────

export async function getUserRelationships() {
  const { data, error } = await supabase.rpc("get_user_relationships");
  if (error) { console.error("[event-os] get_user_relationships failed", error); throw error; }
  return data;
}

// ── Phase 0b — Unified Identity & Sync Spine: one "my world" resolver (mig 372) ──
// Everything for the signed-in person in one call: player_fixtures {league, casual},
// ref_assignments, club_memberships, guardian_of (+ children's sessions), admin_roles,
// coaching, and conflicts (playing vs reffing within 2h). Consumer = apps/inorout hub.
export async function getMyWorld() {
  const { data, error } = await supabase.rpc("get_my_world");
  if (error) { console.error("[spine] get_my_world failed", error); throw error; }
  return data;
}

// ── Unified Login (Step 1 — account → admin bridge, mig 376) ──
// Every team the signed-in account is a verified admin of, WITH its admin_token,
// so the account-based landing can open the admin view without the user pasting
// the secret /admin/<token> URL. Server-side the RPC only returns a token to a
// caller already recorded as that team's admin (team_admins.user_id = auth.uid()).
export async function getMyAdminTeams() {
  const { data, error } = await supabase.rpc("get_my_admin_teams");
  if (error) { console.error("getMyAdminTeams failed", error); return []; }
  return (data || []).map((r) => ({
    teamId: r.team_id,
    teamName: r.team_name,
    adminToken: r.admin_token,
  }));
}

// ── Unified Login (Step 1b — Option A auto-enrol, mig 377) ──
// Call when a signed-in user opens a valid /admin/<token> link: records them as a
// real account-admin so their LOGIN alone grants admin access from then on. No-op
// if already an admin or not signed in. Fire-and-forget — never blocks admin entry.
export async function claimTeamAdmin(adminToken) {
  try {
    const { data, error } = await supabase.rpc("claim_team_admin", { p_admin_token: adminToken });
    if (error) { console.error("claimTeamAdmin failed", error); return null; }
    return data;
  } catch (e) {
    console.error("claimTeamAdmin threw", e);
    return null;
  }
}

export async function getUnifiedHomeFeed() {
  const { data, error } = await supabase.rpc("get_unified_home_feed");
  if (error) { console.error("[event-os] get_unified_home_feed failed", error); throw error; }
  return data?.events ?? [];
}

export async function getGuardianHomeFeed() {
  const { data, error } = await supabase.rpc("get_guardian_home_feed");
  if (error) { console.error("[event-os] get_guardian_home_feed failed", error); throw error; }
  return data?.children ?? [];
}

export async function getChildLiveMatch(playerProfileId) {
  const { data, error } = await supabase.rpc("get_child_live_match", {
    p_player_profile_id: playerProfileId,
  });
  if (error) { console.error("[event-os] get_child_live_match failed", error); throw error; }
  return data;
}

// Per-team feature flags (mig 351). Returns { multi_context_nav } — the
// kill-switch for the new context-aware nav on squad routes. Fails safe to
// flags-off so a failed lookup never enables a half-built path.
export async function getTeamFeatureFlags(teamId) {
  if (!teamId) return { multi_context_nav: false };
  const { data, error } = await supabase.rpc("get_team_feature_flags", { p_team_id: teamId });
  if (error) { console.error("[nav] get_team_feature_flags failed", error); return { multi_context_nav: false }; }
  return data ?? { multi_context_nav: false };
}

// Modular feature flags for the venue console (mig 399). Returns the merged
// on/off set for a venue: its own facility features (venue_features) ∪ the org
// features of every club operating there (club_features). Drives the rail nav +
// route gates (server RPCs enforce the same flags independently). Fails OPEN —
// an all-true fallback so a transient lookup error never hides a paid feature.
const ALL_FEATURES_ON = {
  bookings: true, spaces: true, room_hire: true, equipment: true,
  memberships: true, competition: true, coaching: true, tournaments: true, public_web: true,
  disciplines: [],   // mig 400: distinct clubs.discipline at the venue (relevance axis)
};
export async function getVenueFeatureFlags(credential) {
  if (!credential) return { ...ALL_FEATURES_ON };
  const { data, error } = await supabase.rpc("get_venue_feature_flags", { p_credential: credential });
  if (error) { console.error("[nav] get_venue_feature_flags failed", error); return { ...ALL_FEATURES_ON }; }
  return data ?? { ...ALL_FEATURES_ON };
}

// Operator feature-toggle settings (mig 400). Full per-venue + per-club flag state
// for the FeaturesView toggle screen: { venue:{bookings,...}, clubs:[{club_id,name,
// discipline,memberships,...}] }. manage_facility-gated server-side. Throws on error
// (the screen shows a load error rather than silently rendering wrong toggle state).
export async function venueGetFeatureSettings(venueToken) {
  const { data, error } = await supabase.rpc("venue_get_feature_settings", { p_venue_token: venueToken });
  if (error) { console.error("[nav] venue_get_feature_settings failed", error); throw error; }
  return data ?? { venue: {}, clubs: [] };
}

// Toggle a VENUE (facility) feature on/off (mig 400). Returns { ok, applied:{...} }.
export async function venueSetVenueFeature(venueToken, feature, enabled) {
  const { data, error } = await supabase.rpc("venue_set_venue_feature", {
    p_venue_token: venueToken, p_feature: feature, p_enabled: enabled,
  });
  if (error) { console.error("[nav] venue_set_venue_feature failed", error); throw error; }
  return data;
}

// Toggle a CLUB (org) feature on/off (mig 400). Enforces the dependency graph
// server-side (enabling coaching auto-enables memberships; disabling memberships
// while coaching is on throws 'dependency_required'). Returns { ok, applied:{...} }.
export async function venueSetClubFeature(venueToken, clubId, feature, enabled) {
  const { data, error } = await supabase.rpc("venue_set_club_feature", {
    p_venue_token: venueToken, p_club_id: clubId, p_feature: feature, p_enabled: enabled,
  });
  if (error) { console.error("[nav] venue_set_club_feature failed", error); throw error; }
  return data;
}

// Package presets (mig 402): apply a whole flag bundle at once. `flags` is a jsonb
// object of the features to set (absent keys unchanged); the club RPC enforces the
// dependency closure (coaching on → memberships forced on). Atomic + audited.
export async function venueSetVenueFeatures(venueToken, flags) {
  const { data, error } = await supabase.rpc("venue_set_venue_features", {
    p_venue_token: venueToken, p_flags: flags,
  });
  if (error) { console.error("[nav] venue_set_venue_features failed", error); throw error; }
  return data;
}

export async function venueSetClubFeatures(venueToken, clubId, flags) {
  const { data, error } = await supabase.rpc("venue_set_club_features", {
    p_venue_token: venueToken, p_club_id: clubId, p_flags: flags,
  });
  if (error) { console.error("[nav] venue_set_club_features failed", error); throw error; }
  return data;
}

// Guardian: every child's upcoming training + matches across ALL their clubs
// (mig 350). Returns [{ profile_id, first_name, last_name, sessions:[...] }].
export async function guardianListChildrenSessions() {
  const { data, error } = await supabase.rpc("guardian_list_children_sessions");
  if (error) { console.error("[event-os] guardian_list_children_sessions failed", error); throw error; }
  return data?.children ?? [];
}

export async function clubAdminCreateTournament(clubId, venueId, name, slug, eventDate, opts = {}) {
  const { data, error } = await supabase.rpc("club_admin_create_tournament", {
    p_club_id: clubId,
    p_venue_id: venueId,
    p_name: name,
    p_slug: slug,
    p_event_date: eventDate,
    p_event_end_date: opts.eventEndDate ?? null,
    p_entry_fee_pence: opts.entryFeePence ?? 0,
    p_entry_fee_payer: opts.entryFeePayer ?? "per_team",
    p_registration_deadline: opts.registrationDeadline ?? null,
  });
  if (error) { console.error("[event-os] club_admin_create_tournament failed", error); throw error; }
  return data;
}

export async function clubAdminListTournaments(clubId) {
  const { data, error } = await supabase.rpc("club_admin_list_tournaments", {
    p_club_id: clubId,
  });
  if (error) { console.error("[event-os] club_admin_list_tournaments failed", error); throw error; }
  return data ?? [];
}

export async function clubAdminGetTournament(slug) {
  const { data, error } = await supabase.rpc("club_admin_get_tournament", {
    p_slug: slug,
  });
  if (error) { console.error("[event-os] club_admin_get_tournament failed", error); throw error; }
  return data;
}

export async function getTournamentPublic(slug) {
  const { data, error } = await supabase.rpc("get_tournament_public", {
    p_slug: slug,
  });
  if (error) { console.error("[event-os] get_tournament_public failed", error); throw error; }
  return data;
}

// Public, no-login opposition-coach matchday link (mig 395) — keyed on a
// club_fixtures share_code. Anon-readable; the code is the auth signal.
export async function getClubFixtureMatchday(shareCode) {
  const { data, error } = await supabase.rpc("get_club_fixture_matchday", {
    p_share_code: shareCode,
  });
  if (error) { console.error("[matchday] get_club_fixture_matchday failed", error); throw error; }
  return data;
}

// Public, no-login embeddable league widget (mig 397) — a club's fixtures +
// results, keyed on club_leagues.embed_code. Rendered chrome-free for iframing.
export async function getClubLeaguePublic(embedCode) {
  const { data, error } = await supabase.rpc("get_club_league_public", {
    p_embed_code: embedCode,
  });
  if (error) { console.error("[embed] get_club_league_public failed", error); throw error; }
  return data;
}

// Public, no-login club home page (Modular Epic B, mig 445) — keyed on a
// club_pages.slug. Anon-readable; returns {found:false} when missing/unpublished.
// Identity + branding + teams (safeguarded rosters) + leagues/fixtures + sponsors
// + published news + tournament-hub links. Consumer: Phase 4 ClubPublicScreen.
export async function getClubPublic(slug) {
  const { data, error } = await supabase.rpc("get_club_public", {
    p_slug: slug,
  });
  if (error) { console.error("[club-page] get_club_public failed", error); throw error; }
  return data;
}

// ── Club page admin writes (Modular Platform Epic B — Phase 3, mig 446) ─────────
// Club-manager auth (auth.uid) + public_web feature gate + audit, server-side.

// Club-manager admin read of the page record for the setup wizard / edit dashboard
// (mig 448). Returns the page row at ANY published state (NO safeguarding transform),
// the club identity, and the safeguarding config to prefill the wizard. page=null
// when no page set up yet. Consumer: P5 ClubSettingsScreen.
export async function clubGetPage(clubId) {
  const { data, error } = await supabase.rpc("club_get_page", { p_club_id: clubId });
  if (error) { console.error("[club-page] club_get_page failed", error); throw error; }
  return data;
}

export async function clubSetPage(clubId, { slug, primaryColour = null, secondaryColour = null, accentColour = null, crestUrl = null, heroUrl = null, tagline = null, about = null, socials = null, sections = null, links = null } = {}) {
  const { data, error } = await supabase.rpc("club_set_page", {
    p_club_id:          clubId,
    p_slug:             slug,
    p_primary_colour:   primaryColour,
    p_secondary_colour: secondaryColour,
    p_accent_colour:    accentColour,
    p_crest_url:        crestUrl,
    p_hero_url:         heroUrl,
    p_tagline:          tagline,
    p_about:            about,
    p_socials:          socials,
    p_sections:         sections,
    p_links:            links,
  });
  if (error) { console.error("[club-page] club_set_page failed", error); throw error; }
  return data;
}

export async function clubPublishPage(clubId, published) {
  const { data, error } = await supabase.rpc("club_publish_page", {
    p_club_id:   clubId,
    p_published: published,
  });
  if (error) { console.error("[club-page] club_publish_page failed", error); throw error; }
  return data;
}

// ── venue-token twins (mig 515) — the apps/clubmanager venue-admin console edits the
// club page as a VENUE-ADMIN (venue-token), not a club-manager (auth.uid). Same return
// shapes as clubGetPage/clubSetPage/clubPublishPage above, so the console UI reuses the
// same prefill/save flow. Consumer: apps/clubmanager ClubPage.jsx. See DECISIONS.md
// 2026-07-08 (arch decision A) + Club Manager epic PR #10.
export async function venueGetClubPage(venueToken, clubId) {
  const { data, error } = await supabase.rpc("venue_get_club_page", {
    p_venue_token: venueToken,
    p_club_id:     clubId,
  });
  if (error) { console.error("[club-page] venue_get_club_page failed", error); throw error; }
  return data;
}

export async function venueSetClubPage(venueToken, clubId, { slug, primaryColour = null, secondaryColour = null, accentColour = null, crestUrl = null, heroUrl = null, tagline = null, about = null, socials = null, sections = null, links = null } = {}) {
  const { data, error } = await supabase.rpc("venue_set_club_page", {
    p_venue_token:      venueToken,
    p_club_id:          clubId,
    p_slug:             slug,
    p_primary_colour:   primaryColour,
    p_secondary_colour: secondaryColour,
    p_accent_colour:    accentColour,
    p_crest_url:        crestUrl,
    p_hero_url:         heroUrl,
    p_tagline:          tagline,
    p_about:            about,
    p_socials:          socials,
    p_sections:         sections,
    p_links:            links,
  });
  if (error) { console.error("[club-page] venue_set_club_page failed", error); throw error; }
  return data;
}

export async function venuePublishClubPage(venueToken, clubId, published) {
  const { data, error } = await supabase.rpc("venue_publish_club_page", {
    p_venue_token: venueToken,
    p_club_id:     clubId,
    p_published:   published,
  });
  if (error) { console.error("[club-page] venue_publish_club_page failed", error); throw error; }
  return data;
}

export async function clubAddSponsor(clubId, name, logoUrl = null, websiteUrl = null, displayOrder = 0, tier = null) {
  const { data, error } = await supabase.rpc("club_add_sponsor", {
    p_club_id:       clubId,
    p_name:          name,
    p_logo_url:      logoUrl,
    p_website_url:   websiteUrl,
    p_display_order: displayOrder,
    p_tier:          tier,
  });
  if (error) { console.error("[club-page] club_add_sponsor failed", error); throw error; }
  return data;
}

export async function clubUpdateSponsor(sponsorId, { name = null, logoUrl = null, websiteUrl = null, displayOrder = null, active = null, tier = null } = {}) {
  const { data, error } = await supabase.rpc("club_update_sponsor", {
    p_sponsor_id:    sponsorId,
    p_name:          name,
    p_logo_url:      logoUrl,
    p_website_url:   websiteUrl,
    p_display_order: displayOrder,
    p_active:        active,
    p_tier:          tier,
  });
  if (error) { console.error("[club-page] club_update_sponsor failed", error); throw error; }
  return data;
}

export async function clubRemoveSponsor(sponsorId) {
  const { data, error } = await supabase.rpc("club_remove_sponsor", {
    p_sponsor_id: sponsorId,
  });
  if (error) { console.error("[club-page] club_remove_sponsor failed", error); throw error; }
  return data;
}

export async function clubListSponsors(clubId) {
  const { data, error } = await supabase.rpc("club_list_sponsors", {
    p_club_id: clubId,
  });
  if (error) { console.error("[club-page] club_list_sponsors failed", error); throw error; }
  return data ?? [];
}

export async function clubCreatePost(clubId, { slug, title, body = null, heroUrl = null, authorName = null } = {}) {
  const { data, error } = await supabase.rpc("club_create_post", {
    p_club_id:     clubId,
    p_slug:        slug,
    p_title:       title,
    p_body:        body,
    p_hero_url:    heroUrl,
    p_author_name: authorName,
  });
  if (error) { console.error("[club-page] club_create_post failed", error); throw error; }
  return data;
}

export async function clubUpdatePost(postId, { title = null, body = null, heroUrl = null, authorName = null } = {}) {
  const { data, error } = await supabase.rpc("club_update_post", {
    p_post_id:     postId,
    p_title:       title,
    p_body:        body,
    p_hero_url:    heroUrl,
    p_author_name: authorName,
  });
  if (error) { console.error("[club-page] club_update_post failed", error); throw error; }
  return data;
}

export async function clubDeletePost(postId) {
  const { data, error } = await supabase.rpc("club_delete_post", {
    p_post_id: postId,
  });
  if (error) { console.error("[club-page] club_delete_post failed", error); throw error; }
  return data;
}

export async function clubPublishPost(postId, published) {
  const { data, error } = await supabase.rpc("club_publish_post", {
    p_post_id:   postId,
    p_published: published,
  });
  if (error) { console.error("[club-page] club_publish_post failed", error); throw error; }
  return data;
}

export async function clubListPosts(clubId) {
  const { data, error } = await supabase.rpc("club_list_posts", {
    p_club_id: clubId,
  });
  if (error) { console.error("[club-page] club_list_posts failed", error); throw error; }
  return data ?? [];
}

export async function clubSetSafeguarding(clubId, { minPublicAge = null, hidePublicRosters = null } = {}) {
  const { data, error } = await supabase.rpc("club_set_safeguarding", {
    p_club_id:             clubId,
    p_min_public_age:      minPublicAge,
    p_hide_public_rosters: hidePublicRosters,
  });
  if (error) { console.error("[club-page] club_set_safeguarding failed", error); throw error; }
  return data;
}

// ── Phase 5b club page modules: committee, documents, events, POTM (mig 449) ──
// All club-manager auth + public_web gate + audit server-side; authenticated-only.
export async function clubAddCommitteeMember(clubId, { role, name, email = null, isWelfare = false, displayOrder = 0 } = {}) {
  const { data, error } = await supabase.rpc("club_add_committee_member", {
    p_club_id: clubId, p_role: role, p_name: name, p_email: email,
    p_is_welfare: isWelfare, p_display_order: displayOrder,
  });
  if (error) { console.error("[club-page] club_add_committee_member failed", error); throw error; }
  return data;
}

export async function clubUpdateCommitteeMember(committeeId, { role = null, name = null, email = null, isWelfare = null, displayOrder = null } = {}) {
  const { data, error } = await supabase.rpc("club_update_committee_member", {
    p_committee_id: committeeId, p_role: role, p_name: name, p_email: email,
    p_is_welfare: isWelfare, p_display_order: displayOrder,
  });
  if (error) { console.error("[club-page] club_update_committee_member failed", error); throw error; }
  return data;
}

export async function clubRemoveCommitteeMember(committeeId) {
  const { data, error } = await supabase.rpc("club_remove_committee_member", { p_committee_id: committeeId });
  if (error) { console.error("[club-page] club_remove_committee_member failed", error); throw error; }
  return data;
}

export async function clubListCommittee(clubId) {
  const { data, error } = await supabase.rpc("club_list_committee", { p_club_id: clubId });
  if (error) { console.error("[club-page] club_list_committee failed", error); throw error; }
  return data ?? [];
}

export async function clubAddDocument(clubId, { title, url, docType = null, sizeLabel = null, displayOrder = 0 } = {}) {
  const { data, error } = await supabase.rpc("club_add_document", {
    p_club_id: clubId, p_title: title, p_url: url,
    p_doc_type: docType, p_size_label: sizeLabel, p_display_order: displayOrder,
  });
  if (error) { console.error("[club-page] club_add_document failed", error); throw error; }
  return data;
}

export async function clubUpdateDocument(documentId, { title = null, url = null, docType = null, sizeLabel = null, displayOrder = null } = {}) {
  const { data, error } = await supabase.rpc("club_update_document", {
    p_document_id: documentId, p_title: title, p_url: url,
    p_doc_type: docType, p_size_label: sizeLabel, p_display_order: displayOrder,
  });
  if (error) { console.error("[club-page] club_update_document failed", error); throw error; }
  return data;
}

export async function clubRemoveDocument(documentId) {
  const { data, error } = await supabase.rpc("club_remove_document", { p_document_id: documentId });
  if (error) { console.error("[club-page] club_remove_document failed", error); throw error; }
  return data;
}

export async function clubListDocuments(clubId) {
  const { data, error } = await supabase.rpc("club_list_documents", { p_club_id: clubId });
  if (error) { console.error("[club-page] club_list_documents failed", error); throw error; }
  return data ?? [];
}

export async function clubAddEvent(clubId, { title, eventDate = null, blurb = null, displayOrder = 0 } = {}) {
  const { data, error } = await supabase.rpc("club_add_event", {
    p_club_id: clubId, p_title: title, p_event_date: eventDate,
    p_blurb: blurb, p_display_order: displayOrder,
  });
  if (error) { console.error("[club-page] club_add_event failed", error); throw error; }
  return data;
}

export async function clubUpdateEvent(eventId, { title = null, eventDate = null, blurb = null, displayOrder = null } = {}) {
  const { data, error } = await supabase.rpc("club_update_event", {
    p_event_id: eventId, p_title: title, p_event_date: eventDate,
    p_blurb: blurb, p_display_order: displayOrder,
  });
  if (error) { console.error("[club-page] club_update_event failed", error); throw error; }
  return data;
}

export async function clubRemoveEvent(eventId) {
  const { data, error } = await supabase.rpc("club_remove_event", { p_event_id: eventId });
  if (error) { console.error("[club-page] club_remove_event failed", error); throw error; }
  return data;
}

export async function clubListEvents(clubId) {
  const { data, error } = await supabase.rpc("club_list_events", { p_club_id: clubId });
  if (error) { console.error("[club-page] club_list_events failed", error); throw error; }
  return data ?? [];
}

export async function clubSetPotm(teamId, { name, month = null } = {}) {
  const { data, error } = await supabase.rpc("club_set_potm", {
    p_team_id: teamId, p_name: name, p_month: month,
  });
  if (error) { console.error("[club-page] club_set_potm failed", error); throw error; }
  return data;
}

export async function clubRemovePotm(teamId) {
  const { data, error } = await supabase.rpc("club_remove_potm", { p_team_id: teamId });
  if (error) { console.error("[club-page] club_remove_potm failed", error); throw error; }
  return data;
}

export async function clubListPotm(clubId) {
  const { data, error } = await supabase.rpc("club_list_potm", { p_club_id: clubId });
  if (error) { console.error("[club-page] club_list_potm failed", error); throw error; }
  return data ?? [];
}

// Public self-serve team registration from the Tournament Hub (anon + authenticated).
// Allowed only while the event is OPEN; creates a pending team awaiting club-admin approval.
export async function tournamentRegisterTeam(slug, competitionId, teamName, contactEmail) {
  const { data, error } = await supabase.rpc("tournament_register_team", {
    p_slug: slug,
    p_competition_id: competitionId,
    p_team_name: teamName,
    p_contact_email: contactEmail || null,
  });
  if (error) { console.error("[event-os] tournament_register_team failed", error); throw error; }
  return data;
}

export async function clubAdminUpdateTournamentStatus(slug, status) {
  const { data, error } = await supabase.rpc("club_admin_update_tournament_status", {
    p_slug: slug,
    p_status: status,
  });
  if (error) { console.error("[event-os] club_admin_update_tournament_status failed", error); throw error; }
  return data;
}

// Mobile tournament/Cups (mig 439). Venue-scoped tournament index for the operator
// /hub screens — operators carry a venue_id (pass role.entityId); resolve_venue_caller
// (stage-1b) gates. The spectator screen still reads getTournamentPublic(slug).
export async function listVenueTournaments(venueToken) {
  const { data, error } = await supabase.rpc("list_venue_tournaments", { p_venue_token: venueToken });
  if (error) { console.error("[event-os] list_venue_tournaments failed", error); throw error; }
  return data;
}

// Persisted "follow a team" for the mobile spectator screen (mig 439). Keyed on
// auth.uid() server-side — works for every signed-in role.
export async function tournamentSetTeamFollow(competitionTeamId, follow) {
  const { data, error } = await supabase.rpc("tournament_set_team_follow", {
    p_competition_team_id: competitionTeamId,
    p_follow: follow,
  });
  if (error) { console.error("[event-os] tournament_set_team_follow failed", error); throw error; }
  return data;
}

export async function tournamentListMyFollows(tournamentEventId) {
  const { data, error } = await supabase.rpc("tournament_list_my_follows", { p_tournament_event_id: tournamentEventId });
  if (error) { console.error("[event-os] tournament_list_my_follows failed", error); throw error; }
  return data?.competition_team_ids ?? [];
}

export async function clubAdminAddCompetition(tournamentEventId, name, type, format = null) {
  const { data, error } = await supabase.rpc("club_admin_add_competition", {
    p_tournament_event_id: tournamentEventId,
    p_name: name,
    p_type: type,
    p_format: format,
  });
  if (error) { console.error("[event-os] club_admin_add_competition failed", error); throw error; }
  return data;
}

export async function clubAdminRegisterTeam(tournamentEventId, competitionId, teamName) {
  const { data, error } = await supabase.rpc("club_admin_register_team", {
    p_tournament_event_id: tournamentEventId,
    p_competition_id: competitionId,
    p_team_name: teamName,
  });
  if (error) { console.error("[event-os] club_admin_register_team failed", error); throw error; }
  return data;
}

export async function clubAdminSendTeamInvite(tournamentEventId, competitionId, email = null) {
  const { data, error } = await supabase.rpc("club_admin_send_team_invite", {
    p_tournament_event_id: tournamentEventId,
    p_competition_id: competitionId,
    p_email: email,
  });
  if (error) { console.error("[event-os] club_admin_send_team_invite failed", error); throw error; }
  return data;
}

export async function clubAdminApproveTeam(competitionTeamId) {
  const { data, error } = await supabase.rpc("club_admin_approve_team", {
    p_competition_team_id: competitionTeamId,
  });
  if (error) { console.error("[event-os] club_admin_approve_team failed", error); throw error; }
  return data;
}

export async function clubAdminRejectTeam(competitionTeamId, reason = null) {
  const { data, error } = await supabase.rpc("club_admin_reject_team", {
    p_competition_team_id: competitionTeamId,
    p_reason: reason,
  });
  if (error) { console.error("[event-os] club_admin_reject_team failed", error); throw error; }
  return data;
}

export async function tournamentJoinViaInvite(code, teamName) {
  const { data, error } = await supabase.rpc("tournament_join_via_invite", {
    p_code: code,
    p_team_name: teamName,
  });
  if (error) { console.error("[event-os] tournament_join_via_invite failed", error); throw error; }
  return data;
}

export async function clubAdminGenerateSchedule(tournamentEventId, competitionId, slotMinutes, startTime, startDate, playingAreaIds = []) {
  const { data, error } = await supabase.rpc("club_admin_generate_schedule", {
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
    p_slot_minutes:        slotMinutes,
    p_start_time:          startTime,
    p_start_date:          startDate,
    p_playing_area_ids:    playingAreaIds,
  });
  if (error) { console.error("[event-os] club_admin_generate_schedule failed", error); throw error; }
  return data;
}

export async function clubAdminGetSchedule(tournamentEventId) {
  const { data, error } = await supabase.rpc("club_admin_get_schedule", {
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] club_admin_get_schedule failed", error); throw error; }
  return data;
}

export async function clubAdminAssignFixtureSlot(fixtureId, scheduledDate, kickoffTime, playingAreaId, slotMinutes) {
  const { data, error } = await supabase.rpc("club_admin_assign_fixture_slot", {
    p_fixture_id:      fixtureId,
    p_scheduled_date:  scheduledDate,
    p_kickoff_time:    kickoffTime,
    p_playing_area_id: playingAreaId,
    p_slot_minutes:    slotMinutes,
  });
  if (error) { console.error("[event-os] club_admin_assign_fixture_slot failed", error); throw error; }
  return data;
}

// ---- Epic D1 (mig 452) — venue-operator tournament create/build/manage ----
// Venue-token siblings of the club_admin_* tournament chain. Auth resolves off the
// venue admin token (resolve_venue_caller) + a manage_facility OR manage_tournaments
// cap, NOT a club manager. A tournament's club is optional (venue-owned ⇒ club_id NULL).
// Consumers: apps/venue (D2 Competition tab — create form + manage panel). See RPCS.md.
export async function venueCreateTournament(venueToken, name, slug, eventDate, opts = {}) {
  const { data, error } = await supabase.rpc("venue_create_tournament", {
    p_venue_token:           venueToken,
    p_name:                  name,
    p_slug:                  slug,
    p_event_date:            eventDate,
    p_event_end_date:        opts.eventEndDate ?? null,
    p_entry_fee_pence:       opts.entryFeePence ?? 0,
    p_entry_fee_payer:       opts.entryFeePayer ?? "per_team",
    p_registration_deadline: opts.registrationDeadline ?? null,
    p_club_id:               opts.clubId ?? null,
  });
  if (error) { console.error("[event-os] venue_create_tournament failed", error); throw error; }
  return data;
}

export async function venueAddCompetition(venueToken, tournamentEventId, name, type, format = null) {
  const { data, error } = await supabase.rpc("venue_add_competition", {
    p_venue_token:        venueToken,
    p_tournament_event_id: tournamentEventId,
    p_name:               name,
    p_type:               type,
    p_format:             format,
  });
  if (error) { console.error("[event-os] venue_add_competition failed", error); throw error; }
  return data;
}

export async function venueRegisterTeam(venueToken, tournamentEventId, competitionId, teamName) {
  const { data, error } = await supabase.rpc("venue_register_team", {
    p_venue_token:        venueToken,
    p_tournament_event_id: tournamentEventId,
    p_competition_id:     competitionId,
    p_team_name:          teamName,
  });
  if (error) { console.error("[event-os] venue_register_team failed", error); throw error; }
  return data;
}

export async function venueSendTeamInvite(venueToken, tournamentEventId, competitionId, email = null) {
  const { data, error } = await supabase.rpc("venue_send_team_invite", {
    p_venue_token:        venueToken,
    p_tournament_event_id: tournamentEventId,
    p_competition_id:     competitionId,
    p_email:              email,
  });
  if (error) { console.error("[event-os] venue_send_team_invite failed", error); throw error; }
  return data;
}

export async function venueApproveTeam(venueToken, competitionTeamId) {
  const { data, error } = await supabase.rpc("venue_approve_team", {
    p_venue_token:         venueToken,
    p_competition_team_id: competitionTeamId,
  });
  if (error) { console.error("[event-os] venue_approve_team failed", error); throw error; }
  return data;
}

export async function venueRejectTeam(venueToken, competitionTeamId, reason = null) {
  const { data, error } = await supabase.rpc("venue_reject_team", {
    p_venue_token:         venueToken,
    p_competition_team_id: competitionTeamId,
    p_reason:              reason,
  });
  if (error) { console.error("[event-os] venue_reject_team failed", error); throw error; }
  return data;
}

export async function venueGenerateSchedule(venueToken, tournamentEventId, competitionId, slotMinutes, startTime, startDate, playingAreaIds = []) {
  const { data, error } = await supabase.rpc("venue_generate_schedule", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
    p_slot_minutes:        slotMinutes,
    p_start_time:          startTime,
    p_start_date:          startDate,
    p_playing_area_ids:    playingAreaIds,
  });
  if (error) { console.error("[event-os] venue_generate_schedule failed", error); throw error; }
  return data;
}

export async function venueAssignFixtureSlot(venueToken, fixtureId, scheduledDate, kickoffTime, playingAreaId, slotMinutes) {
  const { data, error } = await supabase.rpc("venue_assign_fixture_slot", {
    p_venue_token:     venueToken,
    p_fixture_id:      fixtureId,
    p_scheduled_date:  scheduledDate,
    p_kickoff_time:    kickoffTime,
    p_playing_area_id: playingAreaId,
    p_slot_minutes:    slotMinutes,
  });
  if (error) { console.error("[event-os] venue_assign_fixture_slot failed", error); throw error; }
  return data;
}

export async function venueSeedKnockout(venueToken, tournamentEventId, competitionId) {
  const { data, error } = await supabase.rpc("venue_seed_knockout", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
  });
  if (error) { console.error("[event-os] venue_seed_knockout failed", error); throw error; }
  return data;
}

export async function venueSeedDoubleElimination(venueToken, tournamentEventId, competitionId) {
  const { data, error } = await supabase.rpc("venue_seed_double_elimination", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
  });
  if (error) { console.error("[event-os] venue_seed_double_elimination failed", error); throw error; }
  return data;
}

export async function venueUpdateTournamentStatus(venueToken, slug, status) {
  const { data, error } = await supabase.rpc("venue_update_tournament_status", {
    p_venue_token: venueToken,
    p_slug:        slug,
    p_status:      status,
  });
  if (error) { console.error("[event-os] venue_update_tournament_status failed", error); throw error; }
  return data;
}

export async function venueGetTournament(venueToken, slug) {
  const { data, error } = await supabase.rpc("venue_get_tournament", {
    p_venue_token: venueToken,
    p_slug:        slug,
  });
  if (error) { console.error("[event-os] venue_get_tournament failed", error); throw error; }
  return data;
}

export async function venueGetSchedule(venueToken, tournamentEventId) {
  const { data, error } = await supabase.rpc("venue_get_schedule", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] venue_get_schedule failed", error); throw error; }
  return data;
}

export async function venueGetTournamentStandings(venueToken, tournamentEventId, competitionId) {
  const { data, error } = await supabase.rpc("venue_get_tournament_standings", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_competition_id:      competitionId,
  });
  if (error) { console.error("[event-os] venue_get_tournament_standings failed", error); throw error; }
  return data;
}

// ---- Epic D3 (mig 453) — venue-operator tournament COMMERCIAL + SPORTS-DAY ----
// Venue-token siblings of the club_admin_* commercial chain (mig 327) and the
// performance/sports-day chain (migs 326/328). Auth resolves off the venue admin token
// via the shared _authorise_venue_tournament helper (manage_facility OR manage_tournaments;
// owner role always; club gate only when club-owned). Consumers: apps/venue
// (TournamentsView Commercial + Sports-day panels). See RPCS.md session-227/D3.
export async function venueAddSponsor(venueToken, tournamentEventId, name, opts = {}) {
  const { data, error } = await supabase.rpc("venue_add_sponsor", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_name:                name,
    p_logo_url:            opts.logoUrl ?? null,
    p_website_url:         opts.websiteUrl ?? null,
    p_display_order:       opts.displayOrder ?? 0,
  });
  if (error) { console.error("[event-os] venue_add_sponsor failed", error); throw error; }
  return data;
}

export async function venueListSponsors(venueToken, tournamentEventId) {
  const { data, error } = await supabase.rpc("venue_list_sponsors", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] venue_list_sponsors failed", error); throw error; }
  return data;
}

export async function venueRemoveSponsor(venueToken, sponsorId) {
  const { data, error } = await supabase.rpc("venue_remove_sponsor", {
    p_venue_token: venueToken,
    p_sponsor_id:  sponsorId,
  });
  if (error) { console.error("[event-os] venue_remove_sponsor failed", error); throw error; }
  return data;
}

export async function venueSetBranding(venueToken, tournamentEventId, primaryColour = null, secondaryColour = null, customLogoUrl = null) {
  const { data, error } = await supabase.rpc("venue_set_branding", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_primary_colour:      primaryColour,
    p_secondary_colour:    secondaryColour,
    p_custom_logo_url:     customLogoUrl,
  });
  if (error) { console.error("[event-os] venue_set_branding failed", error); throw error; }
  return data;
}

export async function venueSetPlayerOfTournament(venueToken, tournamentEventId, name, teamName = null) {
  const { data, error } = await supabase.rpc("venue_set_player_of_tournament", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_name:                name,
    p_team_name:           teamName,
  });
  if (error) { console.error("[event-os] venue_set_player_of_tournament failed", error); throw error; }
  return data;
}

export async function venueGetEquipmentForTournament(venueToken, tournamentEventId) {
  const { data, error } = await supabase.rpc("venue_get_equipment_for_tournament", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] venue_get_equipment_for_tournament failed", error); throw error; }
  return data;
}

export async function venueBookEquipmentForTournament(venueToken, tournamentEventId, equipmentId, qty, startAt, endAt, dueBackAt = null) {
  const { data, error } = await supabase.rpc("venue_book_equipment_for_tournament", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_equipment_id:        equipmentId,
    p_qty:                 qty,
    p_start_at:            startAt,
    p_end_at:              endAt,
    p_due_back_at:         dueBackAt,
  });
  if (error) { console.error("[event-os] venue_book_equipment_for_tournament failed", error); throw error; }
  return data;
}

export async function venueListTournamentEquipmentBookings(venueToken, tournamentEventId) {
  const { data, error } = await supabase.rpc("venue_list_tournament_equipment_bookings", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] venue_list_tournament_equipment_bookings failed", error); throw error; }
  return data;
}

export async function venueCancelEquipmentBooking(venueToken, bookingId) {
  const { data, error } = await supabase.rpc("venue_cancel_equipment_booking", {
    p_venue_token: venueToken,
    p_booking_id:  bookingId,
  });
  if (error) { console.error("[event-os] venue_cancel_equipment_booking failed", error); throw error; }
  return data;
}

export async function venueSetPerformanceConfig(venueToken, tournamentEventId, pointsConfig) {
  const { data, error } = await supabase.rpc("venue_set_performance_config", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
    p_points_config:       pointsConfig,
  });
  if (error) { console.error("[event-os] venue_set_performance_config failed", error); throw error; }
  return data;
}

export async function venueAddPerformanceEvent(venueToken, tournamentEventId, name, measurementType, unit, attemptsPerAthlete = 1, category = null, scheduledTime = null, displayOrder = null) {
  const { data, error } = await supabase.rpc("venue_add_performance_event", {
    p_venue_token:          venueToken,
    p_tournament_event_id:  tournamentEventId,
    p_name:                 name,
    p_measurement_type:     measurementType,
    p_unit:                 unit,
    p_attempts_per_athlete: attemptsPerAthlete,
    p_category:             category,
    p_scheduled_time:       scheduledTime,
    p_display_order:        displayOrder,
  });
  if (error) { console.error("[event-os] venue_add_performance_event failed", error); throw error; }
  return data;
}

export async function venueListPerformanceEvents(venueToken, tournamentEventId) {
  const { data, error } = await supabase.rpc("venue_list_performance_events", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] venue_list_performance_events failed", error); throw error; }
  return data;
}

export async function venueRecordResult(venueToken, performanceEventId, athleteName, competitionTeamId, value, attemptNumber = 1, status = "recorded") {
  const { data, error } = await supabase.rpc("venue_record_result", {
    p_venue_token:          venueToken,
    p_performance_event_id: performanceEventId,
    p_athlete_name:         athleteName,
    p_competition_team_id:  competitionTeamId,
    p_value:                value,
    p_attempt_number:       attemptNumber,
    p_status:               status,
  });
  if (error) { console.error("[event-os] venue_record_result failed", error); throw error; }
  return data;
}

export async function venueGetPerformanceResults(venueToken, performanceEventId) {
  const { data, error } = await supabase.rpc("venue_get_performance_results", {
    p_venue_token:          venueToken,
    p_performance_event_id: performanceEventId,
  });
  if (error) { console.error("[event-os] venue_get_performance_results failed", error); throw error; }
  return data;
}

export async function venueGetSportsDayStandings(venueToken, tournamentEventId) {
  const { data, error } = await supabase.rpc("venue_get_sports_day_standings", {
    p_venue_token:         venueToken,
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] venue_get_sports_day_standings failed", error); throw error; }
  return data;
}

// Referee PR #4 (mig 443) — assign (or clear, official=null) a referee on a TOURNAMENT
// fixture. Club-admin auth (mirrors club_admin_assign_fixture_slot); emits the same
// fixture_ref_assigned/_changed/_cleared audit action venue_assign_ref does, so the
// PR #1 push-on-assign cron notifies the ref. Consumer: apps/inorout SessionsScreen.
export async function clubAdminAssignTournamentRef(fixtureId, officialId) {
  const { data, error } = await supabase.rpc("club_admin_assign_tournament_ref", {
    p_fixture_id:  fixtureId,
    p_official_id: officialId,
  });
  if (error) { console.error("[event-os] club_admin_assign_tournament_ref failed", error); throw error; }
  return data;
}

// ── Phase 6: Performance Events ────────────────────────────────────────────────

export async function clubAdminSetPerformanceConfig(tournamentEventId, pointsConfig) {
  const { data, error } = await supabase.rpc("club_admin_set_performance_config", {
    p_tournament_event_id: tournamentEventId,
    p_points_config:       pointsConfig,
  });
  if (error) { console.error("[event-os] club_admin_set_performance_config failed", error); throw error; }
  return data;
}

export async function clubAdminAddPerformanceEvent(tournamentEventId, name, measurementType, unit, attemptsPerAthlete = 1, category = null, scheduledTime = null, displayOrder = null) {
  const { data, error } = await supabase.rpc("club_admin_add_performance_event", {
    p_tournament_event_id:  tournamentEventId,
    p_name:                 name,
    p_measurement_type:     measurementType,
    p_unit:                 unit,
    p_attempts_per_athlete: attemptsPerAthlete,
    p_category:             category,
    p_scheduled_time:       scheduledTime,
    p_display_order:        displayOrder,
  });
  if (error) { console.error("[event-os] club_admin_add_performance_event failed", error); throw error; }
  return data;
}

export async function clubAdminListPerformanceEvents(tournamentEventId) {
  const { data, error } = await supabase.rpc("club_admin_list_performance_events", {
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] club_admin_list_performance_events failed", error); throw error; }
  return data;
}

export async function clubAdminRecordResult(performanceEventId, athleteName, competitionTeamId, value, attemptNumber = 1, status = "recorded") {
  const { data, error } = await supabase.rpc("club_admin_record_result", {
    p_performance_event_id: performanceEventId,
    p_athlete_name:         athleteName,
    p_competition_team_id:  competitionTeamId,
    p_value:                value,
    p_attempt_number:       attemptNumber,
    p_status:               status,
  });
  if (error) { console.error("[event-os] club_admin_record_result failed", error); throw error; }
  return data;
}

export async function clubAdminGetPerformanceResults(performanceEventId) {
  const { data, error } = await supabase.rpc("club_admin_get_performance_results", {
    p_performance_event_id: performanceEventId,
  });
  if (error) { console.error("[event-os] club_admin_get_performance_results failed", error); throw error; }
  return data;
}

export async function clubAdminGetSportsDayStandings(tournamentEventId) {
  const { data, error } = await supabase.rpc("club_admin_get_sports_day_standings", {
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] club_admin_get_sports_day_standings failed", error); throw error; }
  return data;
}

// ── Phase 7 Commercial RPCs ────────────────────────────────────────────────────

export async function clubAdminAddSponsor(tournamentEventId, name, logoUrl = null, websiteUrl = null, displayOrder = 0) {
  const { data, error } = await supabase.rpc("club_admin_add_sponsor", {
    p_tournament_event_id: tournamentEventId,
    p_name:                name,
    p_logo_url:            logoUrl,
    p_website_url:         websiteUrl,
    p_display_order:       displayOrder,
  });
  if (error) { console.error("[event-os] club_admin_add_sponsor failed", error); throw error; }
  return data;
}

export async function clubAdminListSponsors(tournamentEventId) {
  const { data, error } = await supabase.rpc("club_admin_list_sponsors", {
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] club_admin_list_sponsors failed", error); throw error; }
  return data ?? [];
}

export async function clubAdminRemoveSponsor(sponsorId) {
  const { data, error } = await supabase.rpc("club_admin_remove_sponsor", {
    p_sponsor_id: sponsorId,
  });
  if (error) { console.error("[event-os] club_admin_remove_sponsor failed", error); throw error; }
  return data;
}

export async function clubAdminSetBranding(tournamentEventId, { primaryColour = null, secondaryColour = null, customLogoUrl = null, tagline = null, heroUrl = null } = {}) {
  const { data, error } = await supabase.rpc("club_admin_set_branding", {
    p_tournament_event_id: tournamentEventId,
    p_primary_colour:      primaryColour,
    p_secondary_colour:    secondaryColour,
    p_custom_logo_url:     customLogoUrl,
    p_tagline:             tagline,
    p_hero_url:            heroUrl,
  });
  if (error) { console.error("[event-os] club_admin_set_branding failed", error); throw error; }
  return data;
}

export async function clubAdminSetPlayerOfTournament(tournamentEventId, name, teamName = null) {
  const { data, error } = await supabase.rpc("club_admin_set_player_of_tournament", {
    p_tournament_event_id: tournamentEventId,
    p_name:                name,
    p_team_name:           teamName,
  });
  if (error) { console.error("[event-os] club_admin_set_player_of_tournament failed", error); throw error; }
  return data;
}

export async function clubAdminGetEquipmentForTournament(tournamentEventId) {
  const { data, error } = await supabase.rpc("club_admin_get_equipment_for_tournament", {
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] club_admin_get_equipment_for_tournament failed", error); throw error; }
  return data ?? [];
}

export async function clubAdminBookEquipmentForTournament(tournamentEventId, equipmentId, qty, startAt, endAt, dueBackAt = null) {
  const { data, error } = await supabase.rpc("club_admin_book_equipment_for_tournament", {
    p_tournament_event_id: tournamentEventId,
    p_equipment_id:        equipmentId,
    p_qty:                 qty,
    p_start_at:            startAt,
    p_end_at:              endAt,
    p_due_back_at:         dueBackAt,
  });
  if (error) { console.error("[event-os] club_admin_book_equipment_for_tournament failed", error); throw error; }
  return data;
}

export async function clubAdminListTournamentEquipmentBookings(tournamentEventId) {
  const { data, error } = await supabase.rpc("club_admin_list_tournament_equipment_bookings", {
    p_tournament_event_id: tournamentEventId,
  });
  if (error) { console.error("[event-os] club_admin_list_tournament_equipment_bookings failed", error); throw error; }
  return data ?? [];
}

export async function clubAdminCancelEquipmentBooking(bookingId) {
  const { data, error } = await supabase.rpc("club_admin_cancel_equipment_booking", {
    p_booking_id: bookingId,
  });
  if (error) { console.error("[event-os] club_admin_cancel_equipment_booking failed", error); throw error; }
  return data;
}

// ── GoCardless Phases 5–8 (mig 337) ──────────────────────────────────────────

export async function venueGcDisconnect(venueToken) {
  const { data, error } = await supabase.rpc("venue_gc_disconnect", { p_venue_token: venueToken });
  if (error) { console.error("[integrations] venue_gc_disconnect failed", error); throw error; }
  return data;
}

export async function gcInitMemberMandate({ inviteCode, tierId, period, forProfileId = null }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("not_authenticated");
  const res = await fetch("/api/gocardless-mandate", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body:    JSON.stringify({ inviteCode, tierId, period, forProfileId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || "gc_mandate_failed");
  }
  return res.json();
}

// ── UNIVERSAL AGENT ───────────────────────────────────────────────────────
// Unified caller-context resolver (Pillar D). Uses the existing authenticated/
// anon client — required for the signed-in (auth.uid) path; the service-role
// invocation lives in the edge function (apps/inorout/api/_agent.js) when built.
// RPC: resolve_agent_caller (migration 454). Returns the caller-context jsonb,
// or null on any error.
export async function resolveAgentCaller(credential) {
  try {
    const { data, error } = await supabase.rpc(
      'resolve_agent_caller',
      { p_credential: credential }
    );
    if (error) {
      console.error('[agent] resolveAgentCaller failed:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('[agent] resolveAgentCaller threw:', e?.message);
    return null;
  }
}
