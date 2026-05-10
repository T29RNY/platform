import { createClient } from "@supabase/supabase-js";

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Players ──────────────────────────────────────────────────────────────────
export async function getPlayers() {
  const { data, error } = await supabase.from("players").select("*").order("created_at");
  if (error) throw error;
  return data.map(dbToPlayer);
}

export async function upsertPlayer(player) {
  const { error } = await supabase.from("players").upsert(playerToDb(player));
  if (error) throw error;
}

export async function upsertPlayers(players) {
  const { error } = await supabase.from("players").upsert(players.map(playerToDb));
  if (error) throw error;
}

export async function deletePlayer(id) {
  const { error } = await supabase.from("players").delete().eq("id", id);
  if (error) throw error;
}

// ─── Matches ──────────────────────────────────────────────────────────────────
export async function getMatches() {
  const { data, error } = await supabase.from("matches").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(dbToMatch);
}

export async function insertMatch(match) {
  const { error } = await supabase.from("matches").insert(matchToDb(match));
  if (error) throw error;
}

// ─── Bib history ──────────────────────────────────────────────────────────────
export async function getBibHistory() {
  const { data, error } = await supabase.from("bib_history").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(b => ({ name: b.name, date: b.date, returned: b.returned }));
}

export async function insertBib(bib) {
  const { error } = await supabase.from("bib_history").insert({ name: bib.name, date: bib.date, returned: bib.returned });
  if (error) throw error;
}

// ─── Schedule ─────────────────────────────────────────────────────────────────
export async function getSchedule() {
  const { data, error } = await supabase.from("schedule").select("*").eq("id", "main").single();
  if (error && error.code !== "PGRST116") throw error;
  return data ? dbToSchedule(data) : null;
}

export async function upsertSchedule(schedule) {
  const { error } = await supabase.from("schedule").upsert(scheduleToDb(schedule));
  if (error) throw error;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function getSettings() {
  const { data, error } = await supabase.from("settings").select("*").eq("id", "main").single();
  if (error && error.code !== "PGRST116") throw error;
  return data ? { groupName: data.group_name } : null;
}

export async function upsertSettings(settings) {
  const { error } = await supabase.from("settings").upsert({ id: "main", group_name: settings.groupName });
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
    note: p.note, self_paid: p.selfPaid,
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
    note: r.note || "", selfPaid: r.self_paid,
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
    id: "main",
    day_of_week: s.dayOfWeek, kickoff: s.kickoff, venue: s.venue,
    opens_day: s.opensDay, opens_time: s.opensTime,
    priority_lead_mins: s.priorityLeadMins,
    price_per_player: s.pricePerPlayer,
    game_is_live: s.gameIsLive, squad_size: s.squadSize,
    game_date_time: s.gameDateTime,
    is_draft: s.isDraft, is_cancelled: s.isCancelled,
    cancel_reason: s.cancelReason,
  };
}

function dbToSchedule(r) {
  return {
    dayOfWeek: r.day_of_week, kickoff: r.kickoff, venue: r.venue,
    opensDay: r.opens_day, opensTime: r.opens_time,
    priorityLeadMins: r.priority_lead_mins,
    pricePerPlayer: r.price_per_player,
    gameIsLive: r.game_is_live, squadSize: r.squad_size,
    gameDateTime: r.game_date_time,
    isDraft: r.is_draft, isCancelled: r.is_cancelled,
    cancelReason: r.cancel_reason,
  };
}
