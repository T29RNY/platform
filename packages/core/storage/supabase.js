import { createClient } from "@supabase/supabase-js";
import { hasGoalData, resolveDominantType, periodCutoff } from "../engine/scoring.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

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
    injured: r.injured || false,
    injuredSince: r.injured_since || null,
    nickname: r.nickname || null,
    userId: r.user_id || null,
    groupNumber: r.group_number ?? null,
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
    } : null,
    coverPool:      data.cover_pool || [],
    liveChannelKey: data.live_channel_key,
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
    } : null,
    coverPool:      data.cover_pool || [],
    liveChannelKey: data.live_channel_key,
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
export async function addGuestPlayer(hostToken, guestName) {
  const { data, error } = await supabase.rpc('add_guest_player', {
    p_token:      hostToken,
    p_guest_name: guestName,
  });
  if (error) throw error;
  return dbToPlayer(data);
}

export async function removeGuestPlayer(hostToken, guestId) {
  const { data, error } = await supabase.rpc('remove_guest_player', {
    p_token:    hostToken,
    p_guest_id: guestId,
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
export async function savePushSubscription(playerToken, subscription) {
  const { error } = await supabase.rpc('register_push_subscription', {
    p_token:        playerToken,
    p_subscription: subscription,
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
  return body;
}

// ─── Demo data helpers ────────────────────────────────────────────────────────
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

  // 5. Reset each player to baseline stats
  for (const p of DEMO_BASELINE) {
    await supabase.from('players').update({
      status: 'none', paid: false, self_paid: false, paid_by: null,
      owes: p.owes, note: null, injured: false, injured_since: null,
      nickname: null,
      goals: p.goals, motm: p.motm, attended: p.attended,
      w: p.w, l: p.l, d: p.d, bib_count: p.bib_count,
      pay_count: p.pay_count, late_dropouts: p.late_dropouts,
    }).eq('id', p.id);
  }

  // 6. Reset schedule voting state
  await supabase.from('schedule')
    .update({ voting_open: false, voting_closes_at: null })
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

export async function getLedgerForTeam(teamId) {
  const { data, error } = await supabase
    .from("payment_ledger")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(dbToLedger);
}

export async function getOutstandingBalance(playerId, teamId) {
  const { data, error } = await supabase
    .from("payment_ledger")
    .select("amount")
    .eq("player_id", playerId)
    .eq("team_id", teamId)
    .eq("status", "unpaid");
  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

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

// ─── League table ─────────────────────────────────────────────────────────────
// period: 'all' | 'month' | 'season'
// Returns players sorted: ranked (played>=3) by points/goals/winRate/potm, then unranked by name.
export async function getPlayerLeagueTable(teamId, period = 'all', adminToken = null) {
  try {
    // Data source — admin-token path routes via SECURITY DEFINER RPC so
    // /demoadmin and any anon admin route can read past RLS. Same pattern
    // as getHeadToHead (migration 041 / 042).
    let matches, pmRows, allTimeData, allTeamMatchDates, playerMap;
    if (adminToken) {
      const { data: raw, error: rpcErr } = await supabase.rpc(
        'get_player_league_table_raw_by_admin_token',
        { p_admin_token: adminToken, p_period: period }
      );
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
      if (!player || player.is_guest || player.disabled) continue;

      const attended = rows.filter(r => r.attended);
      const played   = attended.length;
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
      const reliability = allTimePlayed >= 3 && totalTeamGames > 0
        ? Math.round((allTimePlayed / totalTeamGames) * 100)
        : null;

      const last5 = [...attended]
        .sort((a, b) =>
          new Date(matchMap[b.match_id]?.matchDate) -
          new Date(matchMap[a.match_id]?.matchDate))
        .slice(0, 5)
        .reverse()                           // oldest left, newest right
        .map(r => r.result.toUpperCase());

      const ranked = played >= 3;

      entries.push({
        playerId, name: player.name, nickname: player.nickname || null,
        injured: player.injured || false,
        played, wins, draws, losses, points,
        winRate, goals, potm, bibCount, lateDropouts, reliability,
        form: last5, ranked,
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
    return { players: [...rankedEntries, ...unrankedEntries], totalGamesInPeriod: matches.length };
  } catch (e) {
    return { players: [], totalGamesInPeriod: 0 };
  }
}

export async function getHeadToHead(meId, themId, teamId, period = 'all', adminToken = null) {
  try {
    const cutoff = periodCutoff(period);

    // Data source — when an adminToken is provided, route the three reads
    // through a SECURITY DEFINER RPC. This fixes /demoadmin and any other
    // anon-context admin route, where direct .from() reads are RLS-blocked
    // and silently return zero rows.
    let allTimeMatchData, matchData, pmData;
    if (adminToken) {
      const { data: raw, error: rpcErr } = await supabase.rpc(
        'get_head_to_head_raw_by_admin_token',
        { p_admin_token: adminToken, p_me_id: meId, p_them_id: themId, p_period: period }
      );
      if (rpcErr) throw rpcErr;
      allTimeMatchData = raw?.all_time_matches  || [];
      matchData        = raw?.period_matches    || [];
      pmData           = raw?.player_match_rows || [];
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
        togetherMatches.push({ me, them, ...md });
      } else {
        againstMatches.push({ me, them, ...md });
      }
    }

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

    // Their win rate WITH me = on same team (togetherMatches)
    const theirWinRateWithMe = gamesTogether > 0
      ? Math.round((winsTogether / gamesTogether) * 100) : null;
    const theirWinRateWithoutMe = themNonShared.length > 0
      ? Math.round((themWithoutWins / themNonShared.length) * 100) : null;

    // My win rate WITH them = same (same team = same result)
    const myWinRateWithThem = gamesTogether > 0
      ? Math.round((winsTogether / gamesTogether) * 100) : null;
    const myWinRateWithoutThem = meNonShared.length > 0
      ? Math.round((meWithoutWins / meNonShared.length) * 100) : null;

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
    if (gamesTogether < 3 || meNonShared.length < 3 || themNonShared.length < 3) {
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
