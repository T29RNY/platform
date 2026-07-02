// FAQ content — plain data, no DB/RPC. Auto-maintained by the /faq-sync skill
// (see .claude/skills/faq-sync/SKILL.md): new features get an entry here, and
// existing entries are checked against the app for accuracy on a schedule.
//
// Shape (keep predictable — the sync skill reads/writes this exact structure):
//   { id: string (kebab-case, stable), question: string, answer: string,
//     tags: string[], links: [{ label: string, path: string }] }

export const FAQ_ENTRIES = [
  {
    id: "potm-voting",
    question: "How does Player of the Match (POTM) voting work?",
    answer: "After a game finishes, every player who played gets a short voting window to pick their Player of the Match. You can't vote for yourself. Once voting closes (or everyone's voted), the result appears on the match in Results. If there's a tie, an admin breaks it.",
    tags: ["potm", "voting", "results"],
    links: [{ label: "View Results", path: "/" }],
  },
  {
    id: "per-game-payment",
    question: "How do I pay for a game, and how does per-week payment tracking work?",
    answer: "Each week you play, your share of the pitch cost is tracked against that game. You can pay as you go — mark a week paid from My View or your profile's payment history — or settle your whole outstanding balance in one go. Admins can see and confirm payments per player, per week.",
    tags: ["payment", "money", "balance"],
    links: [{ label: "My View", path: "/" }, { label: "Payment history", path: "/profile" }],
  },
  {
    id: "casual-match-flow",
    question: "How does the casual match flow work — In / Out / Reserve?",
    answer: "Each week, tap In if you're playing or Out if you're not. Once the squad is full, anyone tapping In afterwards joins the Reserve list — if a confirmed player drops out, the next reserve is offered their spot automatically. Admins can lock the squad, open the game live, and record the result afterwards.",
    tags: ["casual", "in-out", "reserve", "squad"],
    links: [{ label: "My View", path: "/" }],
  },
  {
    id: "guest-players",
    question: "Can I bring a guest to play?",
    answer: "Yes — if guests are enabled for your squad, you can add one from My View when you're In. Your guest plays under your invite for that week; if you drop out, you'll be asked whether to keep your guest in, move them to reserve, or remove them.",
    tags: ["guests", "squad"],
    links: [{ label: "My View", path: "/" }],
  },
  {
    id: "injury-status",
    question: "How do I mark myself as injured?",
    answer: "Open your profile and tap Mark as injured. This flags your availability to admins and removes you from being auto-selected until you clear the injury from the same screen.",
    tags: ["injury", "profile", "availability"],
    links: [{ label: "Your profile", path: "/profile" }],
  },
];
