import { createClient } from "@supabase/supabase-js";

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
  return (data || []).map(b => ({ name: b.name, matchDate: b.match_date, returned: b.returned }));
}

export async function insertBib(bib, teamId) {
  const { error } = await supabase.from("bib_history").insert({
    name: bib.name, match_date: bib.matchDate, returned: bib.returned, team_id: teamId,
  });
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
    disabled: p.disabled, priority: p.priority, deputy: p.deputy,
    status: p.status, paid: p.paid, owes: p.owes,
    goals: p.goals, motm: p.motm, attended: p.attended, total: p.total,
    bib_count: p.bibCount, team: p.team,
    w: p.w, l: p.l, d: p.d,
    pay_count: p.payCount, late_dropouts: p.lateDropouts,
    note: p.note || "", self_paid: p.selfPaid || false, paid_by: p.paidBy || null,
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
    disabled: r.disabled, priority: r.priority, deputy: r.deputy,
    status: r.status, paid: r.paid, owes: r.owes,
    goals: r.goals, motm: r.motm, attended: r.attended, total: r.total,
    bibCount: r.bib_count, team: r.team,
    w: r.w, l: r.l, d: r.d,
    payCount: r.pay_count, lateDropouts: r.late_dropouts,
    note: r.note || "", selfPaid: r.self_paid, paidBy: r.paid_by || null,
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

export async function addPlayerToTeam(name, teamId, userId = null) {
  const id    = "p_" + Math.random().toString(36).slice(2, 10);
  const token = "p_" + Math.random().toString(36).slice(2, 18);

  const { error: pErr } = await supabase.from("players").insert({
    id, name: name.trim(), type:"regular",
    disabled:false, priority:false, deputy:false,
    status:"none", paid:false, owes:0,
    goals:0, motm:0, attended:0, total:0,
    bib_count:0, team:null, w:0, l:0, d:0,
    pay_count:0, late_dropouts:0, note:"", self_paid:false,
    token, user_id: userId,
  });
  if (pErr) throw pErr;

  const { error: tErr } = await supabase
    .from("team_players").insert({ team_id: teamId, player_id: id });
  if (tErr) throw tErr;

  return { id, name, token };
}

// ─── Guest players ────────────────────────────────────────────────────────────
export async function addGuestPlayer(hostPlayerId, guestName, teamId, selfPaid = false) {
  const id = "p_" + Math.random().toString(36).slice(2, 10);
  const row = {
    id, name: guestName.trim(), type: "regular",
    disabled: false, priority: false, deputy: false,
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

// ─── Player match rows ────────────────────────────────────────────────────────
// winner: 'A'|'B'|'D'  scorers: { [playerId]: goalCount }
export async function writePlayerMatchRows(matchId, teamId, players, winner, motmId, bibHolderName, scoreA, scoreB, scorers = {}) {
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

    // b. Insert new bib_history row (name string — historical log, unchanged)
    const { error: e1 } = await supabase.from("bib_history")
      .insert({ team_id: teamId, name: playerName, match_date: new Date().toISOString().split('T')[0], returned: false });
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
    const { data, error } = await supabase
      .from("potm_votes")
      .select("vote_for, is_runner_up")
      .eq("team_id", teamId);
    if (error) return null;
    const mine = (data || []).filter(v => v.vote_for === playerId);
    return { votesReceived: mine.length, timesNominated: mine.length, timesRunnerUp: mine.filter(v => v.is_runner_up).length };
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
