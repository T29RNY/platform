// Plain-English labels for audit_events actions + actor types. Shared by the views so
// raw snake_case (app_boot, match_teams_saved…) never reaches the operator.

export const ACTION_LABELS = {
  app_boot: "Opened the app",
  player_status_set: "Marked in/out",
  player_status_updated: "Status changed (by admin)",
  player_added: "Player added",
  player_deleted: "Player removed",
  player_disabled: "Player disabled",
  player_enabled: "Player re-enabled",
  player_priority_updated: "Priority changed",
  player_note_updated: "Note edited (admin)",
  player_note_updated_self: "Note edited (self)",
  player_nickname_updated_self: "Nickname set",
  player_vc_updated: "Vice-captain set",
  admin_reorder_reserves: "Reserves reordered",
  group_assigned: "Group assigned",
  groups_cleared: "Groups cleared",
  match_teams_saved: "Teams saved",
  match_teams_confirmed: "Teams confirmed",
  week_opened: "Week opened",
  week_reopened: "Week reopened",
  match_cancelled: "Match cancelled",
  match_result_saved: "Result entered",
  potm_vote_cast_self: "POTM vote cast",
  potm_voting_closed: "POTM voting closed",
  player_paid_confirmed: "Payment confirmed",
  player_paid_reset: "Payment reset",
  player_paid_self_declared: "Marked self as paid",
  player_injured_self_set: "Flagged injury (self)",
  player_injured_updated: "Injury updated (admin)",
  player_injured_set: "Flagged injury (admin)",
  guest_player_added_self: "Guest added",
  guest_player_removed_self: "Guest removed",
  guest_promoted: "Guest made permanent",
  guest_player_reactivated_self: "Guest brought back",
  player_joined_team_self: "Joined the squad",
  player_contact_updated_self: "Contact details set",
  push_subscription_registered: "Push notifications enabled",
  schedule_updated: "Schedule updated",
  settings_updated: "Settings updated",
  player_row_split: "Account record split (system)",
  // league / venue / ref side (may appear on competitive squads)
  ref_record_goal: "Goal recorded (ref)",
  ref_record_card: "Card recorded (ref)",
  ref_record_substitution: "Substitution (ref)",
  ref_record_own_goal: "Own goal recorded (ref)",
  ref_start_match: "Match started (ref)",
  ref_set_period: "Period changed (ref)",
  ref_confirm_full_time: "Full time confirmed (ref)",
  ref_undo_event: "Match event undone (ref)",
  lineup_submitted: "Lineup submitted",
};

// Humanise any action not in the map: "some_new_action" → "Some new action".
export function actionLabel(action) {
  if (!action) return "—";
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const s = action.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const ACTOR_LABELS = {
  team_admin: "Admin",
  vice_captain: "Vice-captain",
  player: "Player",
  referee: "Referee",
  venue_admin: "Venue",
  league_admin: "League",
  company_admin: "HQ",
  super_admin: "Platform",
  system: "System",
};
export function actorLabel(t) {
  return ACTOR_LABELS[t] || t || "—";
}
