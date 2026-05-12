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
  const { error } = await supabase.from("matches").insert(row);
  if (error) throw error;
}

// ─── Bib history ──────────────────────────────────────────────────────────────
export async function getBibHistory(teamId) {
  const { data, error } = await supabase
    .from("bib_history").select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(b => ({ name: b.name, date: b.date, returned: b.returned }));
}

export async function insertBib(bib, teamId) {
  const { error } = await supabase.from("bib_history").insert({
    name: bib.name, date: bib.date, returned: bib.returned, team_id: teamId,
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
  };
}

function matchToDb(m) {
  return {
    id: m.id, date: m.date, date_short: m.dateShort,
    team_a: m.teamA, team_b: m.teamB,
    winner: m.winner, score_a: m.scoreA, score_b: m.scoreB,
    scorers: m.scorers, motm: m.motm,
    bib_holder: m.bibHolder, payments: m.payments,
    cancelled: m.cancelled, cancel_reason: m.cancelReason,
  };
}

function dbToMatch(r) {
  return {
    id: r.id, date: r.date, dateShort: r.date_short,
    teamA: r.team_a || [], teamB: r.team_b || [],
    winner: r.winner, scoreA: r.score_a, scoreB: r.score_b,
    scorers: r.scorers || {}, motm: r.motm,
    bibHolder: r.bib_holder, payments: r.payments || {},
    cancelled: r.cancelled, cancelReason: r.cancel_reason,
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
  const { error } = await supabase.from("player_match").insert(rows);
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
export async function getLastMatchMeta(teamId) {
  console.log('[ioo] getLastMatchMeta called with teamId', teamId);
  const { data, error } = await supabase
    .from("matches")
    .select("motm, bib_holder")
    .eq("team_id", teamId)
    .not("winner", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  console.log('[ioo] getLastMatchMeta raw result', data, error);
  if (error || !data) return null;
  return { motm: data.motm || null, bibHolder: data.bib_holder || null };
}

// ─── Matches (update bib holder after result saved) ───────────────────────────
export async function updateMatchBibHolder(matchId, bibHolder) {
  const { error } = await supabase
    .from("matches")
    .update({ bib_holder: bibHolder })
    .eq("id", matchId);
  if (error) throw error;
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
