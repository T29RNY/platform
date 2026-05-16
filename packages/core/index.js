// Core engine — barrel export
// Import from here in any product: import { notify, groupByStatus } from "@platform/core"

export * from "./constants/colors.js";
export * from "./constants/roles.js";
export * from "./engine/notifications.js";
export * from "./engine/availability.js";
export * from "./engine/attendance.js";
export * from "./engine/payments.js";
export * from "./engine/squad.js";
export { storage } from "./storage/localStorage.js";
export {
  resolveBibHolder,
  createLedgerEntry,
  updateLedgerEntry,
  getLedgerForPlayer,
  getLedgerForTeam,
  getOutstandingBalance,
  bulkResetPlayerStatuses,
  bulkCancelLedgerEntries,
  deletePlayerMatchRows,
  getRecentNotification,
  getPlayerLeagueTable,
  saveTeamsDraft,
  confirmTeams,
  toggleViceCaptain,
  disablePlayer,
  addPlayerToTeam,
  getHeadToHead,
} from "./storage/supabase.js";
export { usePersistedState } from "./hooks/usePersistedState.js";
