// Notification engine — shared across all products

export async function requestNotifPerm() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  return await Notification.requestPermission();
}

export function notify(title, body) {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/icons/icon-192.png" });
  }
}

// Scheduled notification helpers (manual triggers for prototype)
// Wire to a real scheduler (cron/Supabase Edge Functions) when backend is ready
export const notificationTemplates = {
  gameOpen:       (day)    => ({ title: "⚽ In or Out", body: `This week's game is open — are you in ${day}?` }),
  priorityPing:   ()       => ({ title: "⚽ Early Access", body: "You're first pick — are you in this week?" }),
  slotsAvailable: ()       => ({ title: "⚽ In or Out", body: "We still need players — in or out?" }),
  squadFull:      (day)    => ({ title: "⚽ In or Out", body: `Squad is full! See you ${day}.` }),
  teamsConfirmed: ()       => ({ title: "⚽ In or Out", body: "Teams are set — open the app to see yours." }),
  coverNeeded:    (name)   => ({ title: "⚽ In or Out", body: `${name} — we need cover this week, are you free?` }),
  payReminder:    (amount) => ({ title: "💰 In or Out", body: `Don't forget — you owe £${amount} from last week.` }),
  lateDropout:    (name)   => ({ title: "⚠️ Late dropout", body: `${name} has dropped out less than 24hrs before kickoff.` }),
  gameCancelled:  (reason) => ({ title: "❌ Game cancelled", body: reason || "This week's game has been cancelled." }),
  nextWeekDraft:  ()       => ({ title: "📋 Next week drafted", body: "Review and go live when ready." }),
};

export function sendTemplate(templateFn, ...args) {
  const { title, body } = templateFn(...args);
  notify(title, body);
}
