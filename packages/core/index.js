// Core engine — barrel export
// Import from here in any product: import { notify, groupByStatus } from "@platform/core"

export * from "./constants/colors.js";
export * from "./constants/roles.js";
export * from "./engine/notifications.js";
export * from "./engine/availability.js";
export * from "./engine/attendance.js";
export * from "./engine/payments.js";
export * from "./engine/squad.js";
export * from "./engine/scoring.js";
export * from "./engine/groupBalancer.js";
export * from "./engine/deeperIntel.js";
export { storage } from "./storage/localStorage.js";
export {
  resolveBibHolder,
  createLedgerEntry,
  updateLedgerEntry,
  getLedgerForPlayer,
  getLedgerForTeam,
  adminGetPlayerLedger,
  confirmPayment,
  getOutstandingBalance,
  getRecentNotification,
  getPlayerLeagueTable,
  saveTeamsDraft,
  confirmTeams,
  toggleViceCaptain,
  disablePlayer,
  addPlayerToTeam,
  playerJoinTeam,
  removeGuestPlayer,
  getHeadToHead,
  getPOTMVotingState,
  getPlayerTeams,
  getPlayerTeamsByToken,
  setPlayerGroup,
  clearAllGroups,
  saveGroupLabels,
  reopenWeek,
  goLive,
  getGafferBriefing,
  askGafferQuestion,
  adminSetPlayerStatus,
  adminReorderReserves,
  createTeam,
  superadminWhoami,
  superadminListTeams,
  superadminTeamDetail,
  superadminRecentActivity,
  superadminCreateVenue,
  venueGetState,
  leagueGetState,
  joinGetLeagueByCode,
  getLeagueStandingsForPlayer,
  getFixtureStateByRefToken,
  refStartMatch,
  refRecordGoal,
  refRecordCard,
  refRecordSubstitution,
  refSetPeriod,
  refUndoEvent,
  refConfirmFullTime,
  venueCreateSeason,
  venueGenerateFixtures,
  venueAssignPitch,
  venueAssignRef,
  venueUpdateFixtureStatus,
  venueUpdateFixtureResult,
  joinRegisterTeam,
  venueApproveTeamRegistration,
  venueRejectTeamRegistration,
  venueWithdrawTeam,
  venueExpelTeam,
  venueAddPitch,
  venueUpdatePitch,
  venueAddRef,
  venueUpdateRef,
  venueListActiveTeams,
  getLeagueConfig,
  getCompanyByDomain,
  searchBookableVenues,
  getPitchFreeSlots,
  getTeamBookings,
  bookPitchAdhoc,
  bookPitchSeries,
  cancelBooking,
  cancelBookingSeries,
  venueCreateBooking,
  venueConfirmBooking,
  venueDeclineBooking,
  getPitchOccupancy,
  venueUpdateBookingSettings,
} from "./storage/supabase.js";
export { generateRoundRobin } from "./engine/roundRobin.js";
export { generateCupBracket } from "./engine/cupBracket.js";
export { usePersistedState } from "./hooks/usePersistedState.js";
export { useLeagueConfig } from "./hooks/useLeagueConfig.js";
export {
  sendNotification,
  registerProvider,
  TEMPLATES as NOTIFY_TEMPLATES,
  getSendLog as getNotifyLog,
  clearSendLog as clearNotifyLog,
} from "./notifications/notify.js";
