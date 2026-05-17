import { createClient } from "@supabase/supabase-js";
import { hasGoalData, resolveDominantType } from "../engine/scoring.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Team resolution ──────────────────────────────────────────────────────────
export async function getTeamByAdminToken(token) {
  const { data, error } = await supabase
    .from("teams").select("*").eq("admin_token", token).single();
  if (error) return null;
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

export async function upsertPlayer(player) {
  const { error } = await supabase.from("players").upsert(playerToDb(player));
  if (error) throw error;
}

export async function upsertPlayers(players, teamId) {
  if (!players.length) return;
  const { error } = await supabase.from("players").upsert(players.map(playerToDb));
  if (error) throw error;
  // Ensure all players are linked to team
  if (teamId) {
    const links = players.map(p => ({ team_id: teamId, player_id: p.id }));
    await supabase.from("team_players").upsert(links, { onConflict: "team_id,player_id" });
  }
}

export async function deletePlayer(id) {
  await supabase.from("team_players").delete().eq("player_id", id);
  const { error } = await supabase.from("players").delete().eq("id", id);
  if (error) throw error;
}

export async function getPlayerByToken(token) {
  const { data, error } = await supabase
    .from("players").select("*").eq("token", token).single();
  if (error) return null;
  return dbToPlayer(data);
}

export async function resetPlayerToken(playerId) {
  const token = "p_" + Math.random().toString(36).slice(2, 18);
  const { error } = await supabase.from("players").update({ token }).eq("id", playerId);
  if (error) throw error;
  return token;
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

export async function insertMatch(match, teamId) {
  const row = { ...matchToDb(match), team_id: teamId };
  // ignoreDuplicates: stub matches from lineup lock already exist — skip silently
  const { error } = await supabase.from("matches").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
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

export async function insertBib(bib, teamId) {
  const { error } = await supabase.from("bib_history").upsert(
    { name: bib.name, match_date: bib.matchDate, returned: bib.returned, team_id: teamId },
    { onConflict: "team_id,match_date" }
  );
  if (error) throw error;
}

// ─── Schedule ─────────────────────────────────────────────────────────────────
export async function getSchedule(teamId) {
  const { data, error } = await supabase
    .from("schedule").select("*").eq("team_id", teamId).single();
  if (error && error.code !== "PGRST116") throw error;
  return data ? dbToSchedule(data) : null;
}

export async function upsertSchedule(schedule, teamId) {
  const row = { ...scheduleToDb(schedule), team_id: teamId };
  const { error } = await supabase.from("schedule").upsert(row);
  if (error) throw error;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function getSettings(teamId) {
  const { data, error } = await supabase
    .from("settings").select("*").eq("team_id", teamId).single();
  if (error && error.code !== "PGRST116") throw error;
  return data ? { groupName: data.group_name } : null;
}

export async function upsertSettings(settings, teamId) {
  // Find existing settings row for this team
  const { data: existing } = await supabase
    .from("settings").select("id").eq("team_id", teamId).single();
  const id = existing?.id || ("sett_" + teamId);
  const { error } = await supabase.from("settings").upsert({
    id, team_id: teamId, group_name: settings.groupName,
  });
  if (error) throw error;
}

// ─── Shape converters ─────────────────────────────────────────────────────────
function playerToDb(p) {
  return {
    id: p.id, name: p.name, type: p.type,
    disabled: p.disabled, priority: p.priority, is_vice_captain: p.isViceCaptain,
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
export async function getPlayerTeams(playerId) {
  const { data, error } = await supabase
    .from("team_players")
    .select("team_id")
    .eq("player_id", playerId);
  if (error || !data?.length) return [];
  const teamIds = data.map(r => r.team_id);
  const { data: teams, error: tErr } = await supabase
    .from("teams")
    .select("id, name, admin_token")
    .in("id", teamIds);
  if (tErr) return [];
  return teams || [];
}

// ─── Join team by join code ───────────────────────────────────────────────────
export async function getTeamByJoinCode(code) {
  // Try join_code first, then fall back to team id
  const { data, error } = await supabase
    .from("teams").select("*").eq("join_code", code).single();
  if (!error && data) return data;
  // Try by team id
  const { data: byId } = await supabase
    .from("teams").select("*").eq("id", code).single();
  return byId || null;
}

export async function addPlayerToTeam(name, teamId, options = {}) {
  const id    = "p_" + Math.random().toString(36).slice(2, 10);
  const token = "p_" + Math.random().toString(36).slice(2, 18);

  const row = {
    id, name: name.trim(),
    type:            options.type          || "regular",
    priority:        options.priority      || false,
    is_vice_captain: options.isViceCaptain || false,
    disabled:false, status:"none", paid:false, owes:0,
    goals:0, motm:0, attended:0, total:0,
    bib_count:0, team:null, w:0, l:0, d:0,
    pay_count:0, late_dropouts:0, note:"", self_paid:false,
    token, user_id: null,
  };
  const { error: pErr } = await supabase.from("players").insert(row);
  if (pErr) throw pErr;

  const { error: tErr } = await supabase
    .from("team_players").insert({ team_id: teamId, player_id: id });
  if (tErr) throw tErr;

  return dbToPlayer(row);
}

// ─── Guest players ────────────────────────────────────────────────────────────
export async function addGuestPlayer(hostPlayerId, guestName, teamId, selfPaid = false) {
  const id = "p_" + Math.random().toString(36).slice(2, 10);
  const row = {
    id, name: guestName.trim(), type: "regular",
    disabled: false, priority: false, is_vice_captain: false,
    status: "in", paid: false, owes: 0,
    goals: 0, motm: 0, attended: 0, total: 0,
    bib_count: 0, team: null, w: 0, l: 0, d: 0,
    pay_count: 0, late_dropouts: 0, note: "", self_paid: selfPaid,
    token: null, is_guest: true, guest_of: hostPlayerId,
  };
  const { error: pErr } = await supabase.from("players").insert(row);
  if (pErr) throw pErr;
  const { error: tErr } = await supabase
    .from("team_players").insert({ team_id: teamId, player_id: id });
  if (tErr) throw tErr;
  return dbToPlayer(row);
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

export async function addCoverPlayer(teamId, name) {
  const id = "c_" + Math.random().toString(36).slice(2, 10);
  const { error } = await supabase.from("cover_pool").insert({
    id, team_id: teamId, name: name.trim(), played: 0, owes: 0,
  });
  if (error) throw error;
  return { id, name: name.trim(), played: 0, owes: 0 };
}

export async function removeCoverPlayer(id) {
  const { error } = await supabase.from("cover_pool").delete().eq("id", id);
  if (error) throw error;
}

export async function updateCoverPlayer(id, updates) {
  const { error } = await supabase.from("cover_pool").update(updates).eq("id", id);
  if (error) throw error;
}

// ─── Push subscriptions ───────────────────────────────────────────────────────
export async function savePushSubscription(playerId, teamId, subscription, playerToken) {
  const id = "sub_" + Math.random().toString(36).slice(2, 12);
  // Upsert — one active subscription per player
  const { error } = await supabase.from("push_subscriptions").upsert(
    { id, player_id: playerId, player_token: playerToken, team_id: teamId, subscription },
    { onConflict: "player_id" }
  );
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

// ─── Player match rows ────────────────────────────────────────────────────────
// winner: 'A'|'B'|'D'  scorers: { [playerId]: goalCount }
export async function writePlayerMatchRows(matchId, teamId, players, winner, motmId, bibHolderName, scoreA, scoreB, scorers = {}, pricePerPlayer = null) {
  const rows = players
    .filter(p => !p.isGuest)
    .map(p => {
      let result;
      if (winner === 'D') {
        result = 'd';
      } else if (p.team === 'A') {
        result = winner === 'A' ? 'w' : 'l';
      } else if (p.team === 'B') {
        result = winner === 'B' ? 'w' : 'l';
      } else {
        result = 'd';
      }
      return {
        team_id:          teamId,
        match_id:         matchId,
        player_id:        p.id,
        team_assignment:  p.team || null,
        result,
        attended:         true,
        late_cancel:      false,
        injury_absence:   p.injured === true,
        was_motm:         p.id === motmId,
        had_bibs:         p.name === bibHolderName,
        goals:            scorers[p.id] || 0,
        is_guest:         false,
        paid:             p.paid || false,
        paid_at:          p.paidAt || null,
        amount:           pricePerPlayer || null,
      };
    });
  if (!rows.length) return;
  const { error } = await supabase.from("player_match").upsert(rows, { onConflict: "match_id,player_id" });
  if (error) throw error;
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

// ─── Bib-eligible players — two-query pattern, non-guests only ───────────────
export async function getBibEligiblePlayers(matchId, teamId) {
  const { data: pmRows, error: pmErr } = await supabase
    .from("player_match")
    .select("player_id")
    .eq("match_id", matchId)
    .eq("team_id", teamId)
    .eq("is_guest", false);
  if (pmErr) throw pmErr;
  if (!pmRows?.length) return [];

  const playerIds = pmRows.map(r => r.player_id);
  const { data: players, error: plErr } = await supabase
    .from("players")
    .select("id, name, nickname")
    .in("id", playerIds);
  if (plErr) throw plErr;

  return (players || []).map(p => ({ id: p.id, name: p.name, nickname: p.nickname || null }));
}

// ─── Save result fields without touching motm/voting columns ──────────────────
// Used by ScoreScreen so that a pre-set motm (from voting) is never overwritten.
export async function saveMatchResult(matchId, teamId, match) {
  const fields = {
    match_date: match.matchDate,
    team_a: match.teamA, team_b: match.teamB,
    winner: match.winner,
    score_a: match.scoreA !== undefined ? match.scoreA : null,
    score_b: match.scoreB !== undefined ? match.scoreB : null,
    scorers: match.scorers || {},
    payments: match.payments || {},
    bib_holder: null, // bibs handled separately by saveBibHolder
    score_type: match.scoreType || null,
    last_goal_scorer: match.lastGoalScorer || null,
  };
  const { data: existing } = await supabase.from("matches").select("id").eq("id", matchId).single();
  if (existing) {
    const { error } = await supabase.from("matches").update(fields).eq("id", matchId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("matches").insert({ ...fields, id: matchId, team_id: teamId, voting_open: false });
    if (error) throw error;
  }
  // Update player_match payment fields for lineup-locked games (rows exist from cron stub)
  const payEntries = Object.entries(match.payments || {});
  if (payEntries.length > 0) {
    await Promise.all(payEntries.map(([playerId, info]) => {
      const paid = info?.paid || false;
      return supabase.from("player_match")
        .update({
          paid,
          amount: info?.amount || 0,
          paid_at: paid ? new Date().toISOString() : null,
        })
        .eq("match_id", matchId)
        .eq("player_id", playerId);
    }));
  }
}

// ─── Career bib count — sum across all player records for this user ───────────
export async function updateCareerBibCount(userId) {
  if (!userId) return;
  const { data: rows, error } = await supabase
    .from("players")
    .select("id, bib_count")
    .eq("user_id", userId);
  if (error || !rows?.length) return;
  const total    = rows.reduce((sum, r) => sum + (r.bib_count || 0), 0);
  const playerId = rows[0].id;
  await supabase.from("player_career")
    .upsert({ player_id: playerId, total_bib_count: total }, { onConflict: "player_id" });
}

// ─── Bibs — atomic write (bib_holder stores player_id post-migration) ─────────
export async function saveBibHolder(matchId, teamId, playerId, playerName) {
  if (playerId) {
    // a. Close any open bib_history rows for this team
    await supabase.from("bib_history")
      .update({ returned: true })
      .eq("team_id", teamId)
      .eq("returned", false);

    // b. Upsert bib_history row — conflict on (team_id, match_date) updates in place
    const { error: e1 } = await supabase.from("bib_history").upsert(
      { team_id: teamId, name: playerName, player_id: playerId, match_date: new Date().toISOString().split('T')[0], returned: false },
      { onConflict: "team_id,match_date" }
    );
    if (e1) throw e1;

    // c. Store player_id on match
    const { error: e2 } = await supabase.from("matches")
      .update({ bib_holder: playerId })
      .eq("id", matchId);
    if (e2) throw e2;

    // increment bib_count on players row (source for Bib Duty leaderboard + updateCareerBibCount)
    const { data: pData } = await supabase.from("players").select("bib_count").eq("id", playerId).single();
    const { error: e3 } = await supabase.from("players")
      .update({ bib_count: (pData?.bib_count || 0) + 1 })
      .eq("id", playerId);
    if (e3) throw e3;

    // d. Update career total
    const { data: playerRow } = await supabase
      .from("players").select("user_id").eq("id", playerId).single();
    await updateCareerBibCount(playerRow?.user_id || null);

    // e. Authoritative had_bibs flags — corrects any writePlayerMatchRows mismatch
    await supabase.from("player_match")
      .update({ had_bibs: true })
      .eq("match_id", matchId)
      .eq("player_id", playerId);
    await supabase.from("player_match")
      .update({ had_bibs: false })
      .eq("match_id", matchId)
      .neq("player_id", playerId);
  } else {
    // No Bibs — close open history rows and null out match
    await supabase.from("bib_history")
      .update({ returned: true })
      .eq("team_id", teamId)
      .eq("returned", false);

    const { error } = await supabase.from("matches")
      .update({ bib_holder: null })
      .eq("id", matchId);
    if (error) throw error;

    // clear had_bibs for all players in this match
    await supabase.from("player_match")
      .update({ had_bibs: false })
      .eq("match_id", matchId);
  }
}

// ─── PWA welcome — find player token by email via secure RPC ─────────────────
// Requires the find_player_by_email(lookup_email text) SQL function in Supabase.
// Returns [{ token, player_id, player_name, team_id, team_name }] — one row per team.
export async function findPlayerByEmail(email) {
  const { data, error } = await supabase.rpc("find_player_by_email", {
    lookup_email: email.toLowerCase().trim(),
  });
  if (error) throw error;
  return data || [];
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

// Find player already linked to this auth user
export async function findPlayerByUserId(userId) {
  const { data, error } = await supabase
    .from("players")
    .select("id, name, goals, attended, token, team_players(team_id, teams(name))")
    .eq("user_id", userId)
    .single();
  if (error) return null;
  return {
    id: data.id, name: data.name, goals: data.goals,
    attended: data.attended, token: data.token,
    teamName: data.team_players?.[0]?.teams?.name || "Unknown team",
  };
}

// Link an existing player record to an auth user
export async function linkPlayerToUser(playerId, userId) {
  const { error } = await supabase
    .from("players").update({ user_id: userId }).eq("id", playerId);
  if (error) throw error;
}

// Find unlinked legacy players by name (for "Is this you?" flow)
export async function findPlayersByName(name) {
  const { data: players, error } = await supabase
    .from("players")
    .select("id, name, goals, attended, token, team_players(team_id, teams(name))")
    .ilike("name", `%${name.split(" ")[0]}%`)
    .is("user_id", null)
    .limit(5);
  if (error) return [];
  return (players || []).map(p => ({
    id: p.id, name: p.name, goals: p.goals, attended: p.attended, token: p.token,
    teamName: p.team_players?.[0]?.teams?.name || "Unknown team",
  }));
}

// Legacy helper — kept for compatibility
export async function getPlayerByUserId(userId) {
  const result = await findPlayerByUserId(userId);
  return result;
}

// ─── Player injuries ──────────────────────────────────────────────────────────
export async function insertPlayerInjury(playerId, teamId, markedBy = null) {
  const id  = "inj_" + Math.random().toString(36).slice(2, 12);
  const now = new Date().toISOString();
  const { error: injErr } = await supabase.from("player_injuries").insert({
    id, player_id: playerId, team_id: teamId,
    injured_at: now, cleared_at: null, marked_by: markedBy,
  });
  if (injErr) throw injErr;
  const { error: pErr } = await supabase.from("players")
    .update({ injured: true, injured_since: now }).eq("id", playerId);
  if (pErr) throw pErr;
}

export async function clearPlayerInjury(playerId, teamId) {
  const now = new Date().toISOString();
  const { data, error: fetchErr } = await supabase
    .from("player_injuries").select("id")
    .eq("player_id", playerId).eq("team_id", teamId)
    .is("cleared_at", null)
    .order("injured_at", { ascending: false }).limit(1);
  if (fetchErr) throw fetchErr;
  if (data?.length) {
    const { error: updErr } = await supabase.from("player_injuries")
      .update({ cleared_at: now }).eq("id", data[0].id);
    if (updErr) throw updErr;
  }
  const { error: pErr } = await supabase.from("players")
    .update({ injured: false, injured_since: null }).eq("id", playerId);
  if (pErr) throw pErr;
}

export async function getPlayerInjuries(playerId) {
  const { data, error } = await supabase
    .from("player_injuries").select("*")
    .eq("player_id", playerId)
    .order("injured_at", { ascending: false });
  if (error) throw error;
  return data || [];
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
      is_vice_captain: false, nickname: null,
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
  await supabase.from("demo_sessions")
    .update({ last_interaction: new Date().toISOString() })
    .eq("id", "main");
}

// ─── IO Intelligence queries ───────────────────────────────────────────────────

export async function getPlayerMatchStats(playerId, teamId) {
  try {
    const { data, error } = await supabase
      .from("player_match")
      .select("match_id, attended, result, was_motm, had_bibs, late_cancel, goals")
      .eq("player_id", playerId)
      .eq("team_id", teamId);
    if (error) return null;
    const rows = data || [];

    // Goals only count for exact-score matches (or legacy null score_type)
    const matchIds = [...new Set(rows.map(r => r.match_id))];
    let exactMatchIds = new Set();
    if (matchIds.length > 0) {
      const { data: matchData } = await supabase
        .from("matches").select("id, score_type").in("id", matchIds);
      exactMatchIds = new Set(
        (matchData || [])
          .filter(m => !m.score_type || m.score_type === "exact")
          .map(m => m.id)
      );
    }

    const attended = rows.filter(r => r.attended).length;
    const attendedRows = rows.filter(r => r.attended);
    return {
      games: rows.length,
      goals: rows.reduce((s, r) => s + (exactMatchIds.has(r.match_id) ? (r.goals || 0) : 0), 0),
      motm: rows.filter(r => r.was_motm).length,
      wins: attendedRows.filter(r => r.result === "w").length,
      losses: attendedRows.filter(r => r.result === "l").length,
      draws: attendedRows.filter(r => r.result === "d").length,
      attended,
      bibs: rows.filter(r => r.had_bibs).length,
      lateDropouts: rows.filter(r => r.late_cancel).length,
      totalInvited: rows.length,
      potmVotesReceived: rows.filter(r => r.was_motm).length,
    };
  } catch (e) { return null; }
}

export async function getWinRate(playerId, teamId) {
  try {
    const { data, error } = await supabase
      .from("player_match")
      .select("result")
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .eq("attended", true);
    if (error) return null;
    const rows = data || [];
    const wins = rows.filter(r => r.result === "w").length;
    const losses = rows.filter(r => r.result === "l").length;
    const draws = rows.filter(r => r.result === "d").length;
    const total = rows.length;
    return { winRate: total > 0 ? Math.round((wins / total) * 100) : 0, wins, draws, losses };
  } catch (e) { return null; }
}

export async function getCurrentRun(playerId, teamId) {
  try {
    const { data, error } = await supabase
      .from("player_match")
      .select("result")
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .eq("attended", true)
      .order("created_at", { ascending: false });
    if (error || !data?.length) return null;
    let unbeaten = 0;
    for (const r of data) {
      if (r.result === "w" || r.result === "d") unbeaten++;
      else break;
    }
    if (unbeaten > 0) return { type: "unbeaten", length: unbeaten };
    let losing = 0;
    for (const r of data) {
      if (r.result === "l") losing++;
      else break;
    }
    return { type: "losing", length: losing };
  } catch (e) { return null; }
}

export async function getReliabilityScore(playerId, teamId) {
  try {
    const { data, error } = await supabase
      .from("players")
      .select("attended, total, late_dropouts")
      .eq("id", playerId)
      .single();
    if (error || !data) return null;
    const base = data.total > 0 ? (data.attended / data.total) * 100 : 0;
    const score = Math.max(0, Math.min(100, Math.round(base - (data.late_dropouts || 0) * 5)));
    const label = score >= 80 ? "Very reliable" : score >= 60 ? "Reliable" : "Room to improve";
    return { score, label };
  } catch (e) { return null; }
}

export async function getMostPlayedWith(playerId, teamId) {
  try {
    const { data: myRows, error: e1 } = await supabase
      .from("player_match")
      .select("match_id, team_assignment")
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .eq("attended", true);
    if (e1 || !myRows?.length) return null;
    const myTeam = {};
    myRows.forEach(r => { myTeam[r.match_id] = r.team_assignment; });
    const { data: others, error: e2 } = await supabase
      .from("player_match")
      .select("match_id, player_id, team_assignment")
      .eq("team_id", teamId)
      .in("match_id", myRows.map(r => r.match_id))
      .neq("player_id", playerId)
      .eq("attended", true);
    if (e2) return null;
    const counts = {};
    for (const r of (others || [])) {
      if (r.team_assignment === myTeam[r.match_id]) counts[r.player_id] = (counts[r.player_id] || 0) + 1;
    }
    const top3 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
    if (!top3.length) return null;
    const { data: players } = await supabase.from("players").select("id, name, nickname").in("id", top3);
    return top3.map(id => {
      const pl = (players || []).find(p => p.id === id);
      return { playerId: id, name: pl?.name || "Unknown", nickname: pl?.nickname || null, games: counts[id] };
    });
  } catch (e) { return null; }
}

export async function getOpponentStats(playerId, teamId) {
  try {
    const { data: myRows } = await supabase
      .from("player_match")
      .select("match_id, team_assignment")
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .eq("attended", true);
    if (!myRows?.length) return null;
    const myTeam = {};
    myRows.forEach(r => { myTeam[r.match_id] = r.team_assignment; });
    const { data: others } = await supabase
      .from("player_match")
      .select("match_id, player_id, team_assignment")
      .eq("team_id", teamId)
      .in("match_id", myRows.map(r => r.match_id))
      .neq("player_id", playerId)
      .eq("attended", true);
    const counts = {};
    for (const r of (others || [])) {
      if (r.team_assignment !== myTeam[r.match_id]) counts[r.player_id] = (counts[r.player_id] || 0) + 1;
    }
    const top3 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
    if (!top3.length) return null;
    const { data: players } = await supabase.from("players").select("id, name").in("id", top3);
    return top3.map(id => ({ playerId: id, name: (players || []).find(p => p.id === id)?.name || "Unknown", games: counts[id] }));
  } catch (e) { return null; }
}

export async function getNemesis(playerId, teamId) {
  try {
    const { data: myRows } = await supabase
      .from("player_match")
      .select("match_id, team_assignment, result")
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .eq("attended", true);
    if (!myRows?.length) return null;
    const myByMatch = {};
    myRows.forEach(r => { myByMatch[r.match_id] = r; });
    const { data: others } = await supabase
      .from("player_match")
      .select("match_id, player_id, team_assignment")
      .eq("team_id", teamId)
      .in("match_id", myRows.map(r => r.match_id))
      .neq("player_id", playerId)
      .eq("attended", true);
    const h2h = {};
    for (const r of (others || [])) {
      const my = myByMatch[r.match_id];
      if (!my || r.team_assignment === my.team_assignment) continue;
      if (!h2h[r.player_id]) h2h[r.player_id] = { wins: 0, losses: 0, draws: 0, games: 0 };
      h2h[r.player_id].games++;
      if (my.result === "w") h2h[r.player_id].wins++;
      else if (my.result === "l") h2h[r.player_id].losses++;
      else h2h[r.player_id].draws++;
    }
    const qualified = Object.entries(h2h)
      .filter(([, v]) => v.games >= 3)
      .map(([id, v]) => ({ playerId: id, lossRate: Math.round((v.losses / v.games) * 100), ...v }))
      .sort((a, b) => b.lossRate - a.lossRate)
      .slice(0, 3);
    if (!qualified.length) return null;
    const { data: players } = await supabase.from("players").select("id, name, nickname").in("id", qualified.map(q => q.playerId));
    return qualified.map(q => {
      const pl = (players || []).find(p => p.id === q.playerId);
      return { ...q, name: pl?.name || "Unknown", nickname: pl?.nickname || null };
    });
  } catch (e) { return null; }
}

export async function getBestPartnership(playerId, teamId) {
  try {
    const { data: myRows } = await supabase
      .from("player_match")
      .select("match_id, team_assignment, result")
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .eq("attended", true);
    if (!myRows?.length) return null;
    const myByMatch = {};
    myRows.forEach(r => { myByMatch[r.match_id] = r; });
    const { data: others } = await supabase
      .from("player_match")
      .select("match_id, player_id, team_assignment")
      .eq("team_id", teamId)
      .in("match_id", myRows.map(r => r.match_id))
      .neq("player_id", playerId)
      .eq("attended", true);
    const pairs = {};
    for (const r of (others || [])) {
      const my = myByMatch[r.match_id];
      if (!my || r.team_assignment !== my.team_assignment) continue;
      if (!pairs[r.player_id]) pairs[r.player_id] = { wins: 0, games: 0 };
      pairs[r.player_id].games++;
      if (my.result === "w") pairs[r.player_id].wins++;
    }
    const qualified = Object.entries(pairs)
      .filter(([, v]) => v.games >= 3)
      .map(([id, v]) => ({ playerId: id, winRate: Math.round((v.wins / v.games) * 100), games: v.games }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 3);
    if (!qualified.length) return null;
    const { data: players } = await supabase.from("players").select("id, name, nickname").in("id", qualified.map(q => q.playerId));
    return qualified.map(q => {
      const pl = (players || []).find(p => p.id === q.playerId);
      return { ...q, name: pl?.name || "Unknown", nickname: pl?.nickname || null };
    });
  } catch (e) { return null; }
}

export async function getPlayerImpact(playerId, teamId) {
  try {
    const { data: myRows, error: e1 } = await supabase
      .from("player_match")
      .select("match_id, result")
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .eq("attended", true);
    if (e1 || !myRows?.length) return null;
    const attended = new Set(myRows.map(r => r.match_id));
    const withRate = Math.round((myRows.filter(r => r.result === "w").length / myRows.length) * 100);
    const { data: allRows, error: e2 } = await supabase
      .from("player_match")
      .select("match_id, result")
      .eq("team_id", teamId)
      .neq("player_id", playerId)
      .eq("attended", true);
    if (e2) return { withRate, withoutRate: null, diff: null };
    const withoutMap = {};
    for (const r of (allRows || [])) {
      if (!attended.has(r.match_id) && !withoutMap[r.match_id]) withoutMap[r.match_id] = r.result;
    }
    const withoutVals = Object.values(withoutMap);
    if (withoutVals.length < 3) return { withRate, withoutRate: null, diff: null };
    const withoutRate = Math.round((withoutVals.filter(r => r === "w").length / withoutVals.length) * 100);
    return { withRate, withoutRate, diff: withRate - withoutRate };
  } catch (e) { return null; }
}

export async function getPOTMVoteStats(playerId, teamId) {
  try {
    const { data: votes, error: vErr } = await supabase
      .from("potm_votes")
      .select("nominee_id")
      .eq("team_id", teamId)
      .eq("nominee_id", playerId);
    if (vErr) return null;

    const { data: wins, error: wErr } = await supabase
      .from("player_match")
      .select("was_motm")
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .eq("was_motm", true);
    if (wErr) return null;

    return {
      votesReceived: (votes || []).length,
      matchesWon:    (wins  || []).length,
    };
  } catch (e) { return null; }
}

// ─── POTM Voting ──────────────────────────────────────────────────────────────

export async function submitPOTMVote(matchId, teamId, voterId, nomineeId) {
  const { error } = await supabase.from("potm_votes").insert({
    match_id: matchId, team_id: teamId, voter_id: voterId, nominee_id: nomineeId,
  });
  if (error) {
    if (error.code === "23505") return { error: "already_voted" };
    throw error;
  }
  return { ok: true };
}

export async function getPOTMVotes(matchId) {
  const { data, error } = await supabase
    .from("potm_votes")
    .select("voter_id, nominee_id")
    .eq("match_id", matchId);
  if (error) throw error;
  return data || [];
}

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

export async function tallyPOTMVotes(matchId, teamId) {
  const votes = await getPOTMVotes(matchId);
  if (!votes.length) return { winner: null, voteCount: 0, totalVoters: 0, isTie: false, tiedCandidates: [] };
  const counts = {};
  for (const v of votes) {
    counts[v.nominee_id] = (counts[v.nominee_id] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topCount = sorted[0][1];
  const tied = sorted.filter(([, c]) => c === topCount).map(([id]) => id);
  const isTie = tied.length > 1;
  return {
    winner: isTie ? null : tied[0],
    voteCount: topCount,
    totalVoters: votes.length,
    isTie,
    tiedCandidates: isTie ? tied : [],
  };
}

export async function closePOTMVoting(matchId, winnerId, wasAdminDecided = false) {
  const { data: pData } = await supabase.from("players").select("motm").eq("id", winnerId).single();

  const { error: mErr } = await supabase.from("matches").update({
    voting_open: false,
    motm: winnerId,
    was_admin_decided: wasAdminDecided,
    admin_decision_pending: false,
  }).eq("id", matchId);
  if (mErr) throw mErr;

  const { error: pmErr } = await supabase.from("player_match")
    .update({ was_motm: true })
    .eq("match_id", matchId)
    .eq("player_id", winnerId);
  if (pmErr) throw pmErr;

  // Increment motm counter — best-effort
  if (pData) {
    await supabase.from("players").update({ motm: (pData.motm || 0) + 1 }).eq("id", winnerId);
  }
}

export async function openPOTMVoting(matchId, teamId, closesAt, totalVoters) {
  const { error } = await supabase.from("matches").update({
    voting_open: true,
    voting_closes_at: closesAt,
    total_voters: totalVoters,
  }).eq("id", matchId).eq("team_id", teamId);
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

export async function setPlayerNickname(playerId, teamId, nickname) {
  const trimmed = nickname ? nickname.trim() : null;
  if (trimmed) {
    const { data: tpRows } = await supabase
      .from("team_players").select("player_id").eq("team_id", teamId);
    const teamIds = (tpRows || []).map(r => r.player_id);
    if (teamIds.length) {
      const { data: clash } = await supabase
        .from("players").select("id")
        .in("id", teamIds)
        .eq("nickname", trimmed)
        .neq("id", playerId)
        .maybeSingle();
      if (clash) { const e = new Error("nickname_taken"); e.code = "nickname_taken"; throw e; }
    }
  }
  const { error } = await supabase
    .from("players").update({ nickname: trimmed || null }).eq("id", playerId);
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

// ─── Cancel Week helpers ───────────────────────────────────────────────────────

/**
 * Resets all non-disabled players on a team to a clean between-weeks state.
 * Called by cancelWeek() immediately before drafting next week.
 * Two-step: players have no direct team_id column; relationship is via team_players.
 */
export async function bulkResetPlayerStatuses(teamId) {
  const { data: links, error: linkErr } = await supabase
    .from("team_players")
    .select("player_id")
    .eq("team_id", teamId);
  if (linkErr) throw linkErr;
  const ids = (links || []).map(r => r.player_id);
  if (!ids.length) return { count: 0 };
  const { data, error } = await supabase
    .from("players")
    .update({ status: 'none', paid: false, self_paid: false, paid_by: null, paid_at: null })
    .in("id", ids)
    .eq("disabled", false)
    .select("id");
  if (error) throw error;
  return { count: (data || []).length };
}

/**
 * For each player who was IN for a cancelled match:
 * - Issues a 'refund' ledger entry if they had already paid (status='paid')
 *   or self-paid pending confirmation (status='unpaid' + self_paid=true),
 *   and clears their payment flags on the players row.
 * - Always writes a 'cancelled' ledger entry as an audit record.
 *
 * REQUIRES DB CHECK constraint update in Supabase before this function
 * will succeed. Run in the Supabase SQL editor:
 *
 *   ALTER TABLE payment_ledger DROP CONSTRAINT payment_ledger_type_check;
 *   ALTER TABLE payment_ledger ADD CONSTRAINT payment_ledger_type_check
 *     CHECK (type IN ('game_fee','guest_fee','debt_payment','waiver','refund','cancelled'));
 *
 *   ALTER TABLE payment_ledger DROP CONSTRAINT payment_ledger_status_check;
 *   ALTER TABLE payment_ledger ADD CONSTRAINT payment_ledger_status_check
 *     CHECK (status IN ('paid','unpaid','waived','disputed','refunded','cancelled'));
 */
export async function bulkCancelLedgerEntries(teamId, matchId, affectedPlayerIds, pricePerPlayer) {
  let refunded = 0;
  let cancelled = 0;
  const paidAt = new Date().toISOString();

  for (const playerId of affectedPlayerIds) {
    const existing = await findMatchLedgerEntry(playerId, teamId, matchId, 'game_fee');

    if (existing?.status === 'paid') {
      await createLedgerEntry({
        teamId, playerId, matchId, amount: pricePerPlayer,
        type: 'refund', status: 'refunded', method: 'admin',
        paidBy: 'admin', paidAt, note: 'Match cancelled',
      });
      const { error } = await supabase
        .from("players")
        .update({ paid: false, self_paid: false, paid_by: null, paid_at: null })
        .eq("id", playerId);
      if (error) throw error;
      refunded++;
    } else if (existing?.status === 'unpaid') {
      const { data: p, error: pErr } = await supabase
        .from("players").select("self_paid").eq("id", playerId).single();
      if (pErr) throw pErr;
      if (p?.self_paid === true) {
        await createLedgerEntry({
          teamId, playerId, matchId, amount: pricePerPlayer,
          type: 'refund', status: 'refunded', method: 'admin',
          paidBy: 'admin', paidAt, note: 'Match cancelled',
        });
        const { error } = await supabase
          .from("players")
          .update({ self_paid: false, paid_by: null, paid_at: null })
          .eq("id", playerId);
        if (error) throw error;
        refunded++;
      }
    }

    // Always write a cancellation audit record — plain insert, no upsert
    await createLedgerEntry({
      teamId, playerId, matchId, amount: 0,
      type: 'cancelled', status: 'cancelled',
      method: null, paidBy: null, paidAt: null, note: 'Match cancelled',
    });
    cancelled++;
  }

  return { refunded, cancelled };
}

/** Removes all player_match rows for a cancelled match. Safe to call even if none exist. */
export async function deletePlayerMatchRows(matchId, teamId) {
  const { data, error } = await supabase
    .from("player_match")
    .delete()
    .eq("match_id", matchId)
    .eq("team_id", teamId)
    .select("id");
  if (error) throw error;
  return { count: (data || []).length };
}

// ─── Team Selection ───────────────────────────────────────────────────────────

export async function saveTeamsDraft(matchId, teamId, draft, changedBy = null) {
  try {
    const { error } = await supabase
      .from('matches')
      .update({ teams_draft: draft })
      .eq('id', matchId)
      .eq('team_id', teamId);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    console.error('saveTeamsDraft error:', error);
    return { error };
  }
}

export async function confirmTeams(matchId, teamId, teamA, teamB, changedBy = null) {
  try {
    const { error } = await supabase
      .from('matches')
      .update({ team_a: teamA, team_b: teamB, teams_draft: null })
      .eq('id', matchId)
      .eq('team_id', teamId);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    console.error('confirmTeams error:', error);
    return { error };
  }
}

// ─── Vice captain + player management ────────────────────────────────────────

export async function toggleViceCaptain(playerId, value, changedBy = null) {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('players')
      .select('is_guest')
      .eq('id', playerId)
      .single();
    if (fetchErr) throw fetchErr;
    if (existing?.is_guest === true) {
      return { error: 'guests_cannot_be_vc' };
    }
    const { error } = await supabase
      .from('players')
      .update({ is_vice_captain: !!value })
      .eq('id', playerId);
    if (error) throw error;
    // changedBy reserved for Phase 2 audit log (unused now)
    return { ok: true };
  } catch (error) {
    console.error('toggleViceCaptain error:', error);
    return { error };
  }
}

export async function disablePlayer(playerId, teamId, disabled, changedBy = null) {
  try {
    const { error } = await supabase
      .from('players')
      .update({ disabled: !!disabled })
      .eq('id', playerId);
    if (error) throw error;
    // teamId + changedBy reserved for Phase 2 audit log (unused now)
    return { ok: true };
  } catch (error) {
    console.error('disablePlayer error:', error);
    return { error };
  }
}

// ─── League table ─────────────────────────────────────────────────────────────
// period: 'all' | 'month' | 'season'
// Returns players sorted: ranked (played>=3) by points/goals/winRate/potm, then unranked by name.
export async function getPlayerLeagueTable(teamId, period = 'all') {
  try {
    // Step 1 — Date cutoff
    const now = new Date();
    let cutoff = null;
    if (period === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    } else if (period === 'season') {
      cutoff = `${now.getFullYear()}-01-01`;
    }

    // Step 2 — Matches within period (for stats)
    let matchQuery = supabase
      .from('matches')
      .select('id, match_date, score_type')
      .eq('team_id', teamId)
      .neq('cancelled', true);
    if (cutoff) matchQuery = matchQuery.gte('match_date', cutoff);
    const { data: matchData, error: matchErr } = await matchQuery;
    if (matchErr) throw matchErr;
    const matches = matchData || [];
    if (!matches.length) return { players: [], totalGamesInPeriod: 0 };

    const matchMap = {};
    for (const m of matches) matchMap[m.id] = { matchDate: m.match_date, scoreType: m.score_type };
    const matchIds = Object.keys(matchMap);

    // Step 3 — player_match rows for those match IDs
    const { data: pmData, error: pmErr } = await supabase
      .from('player_match')
      .select('player_id, match_id, attended, result, goals, was_motm, had_bibs, late_cancel, team_assignment')
      .eq('team_id', teamId)
      .in('match_id', matchIds);
    if (pmErr) throw pmErr;
    const pmRows = pmData || [];
    if (!pmRows.length) return { players: [], totalGamesInPeriod: matches.length };

    // Step 4 — All uncancelled match dates for reliability denominator (not period-filtered)
    let allTeamMatchDates;
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

    // Step 5 — Player details (created_at used as join date for reliability)
    const allPlayerIds = [...new Set(pmRows.map(r => r.player_id))];
    const { data: playerData, error: playerErr } = await supabase
      .from('players')
      .select('id, name, nickname, injured, disabled, is_guest, created_at')
      .in('id', allPlayerIds);
    if (playerErr) throw playerErr;
    const playerMap = {};
    for (const p of (playerData || [])) playerMap[p.id] = p;

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
      const reliability = played >= 3 && totalTeamGames > 0
        ? Math.round((played / totalTeamGames) * 100)
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

export async function getHeadToHead(meId, themId, teamId) {
  try {
    // Query 1 — all uncancelled matches for this team
    const { data: matchData, error: matchErr } = await supabase
      .from('matches')
      .select('id, match_date, score_a, score_b, winner, score_type, cancelled')
      .eq('team_id', teamId)
      .neq('cancelled', true);
    if (matchErr) throw matchErr;

    const matchMap = {};
    for (const m of (matchData || [])) {
      matchMap[m.id] = {
        matchDate: m.match_date,
        scoreA:    m.score_a,
        scoreB:    m.score_b,
        winner:    m.winner,
        scoreType: m.score_type,
      };
    }

    // Detect dominant scoring style (last 20 matches, 70% threshold)
    const dominantType = resolveDominantType(matchData);

    // Query 2 — all attended rows for both players
    const { data: pmData, error: pmErr } = await supabase
      .from('player_match')
      .select('player_id, match_id, team_assignment, result, goals, was_motm, had_bibs')
      .eq('team_id', teamId)
      .in('player_id', [meId, themId])
      .eq('attended', true);
    if (pmErr) throw pmErr;

    const meRows   = (pmData || []).filter(r => r.player_id === meId);
    const themRows = (pmData || []).filter(r => r.player_id === themId);

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
