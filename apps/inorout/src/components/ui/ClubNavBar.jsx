import { Chats, CalendarCheck, Barbell, IdentificationCard, User } from "@phosphor-icons/react";
import NavBar from "./NavBar.jsx";
import { deriveClubContext } from "../../lib/deriveContext.js";
import { getDisciplineLabels } from "../../lib/disciplineLabels.js";

// Shared bottom nav for the club-membership context (multi-context nav, Phase 1).
// Unstrands the /sessions and /profile screens, which had no nav. Tabs are the
// real, working club routes only — Sessions, Pass (deep-links to the selected
// club's pass token), Profile. ("Classes" is intentionally omitted until a
// /classes route exists — a no-op tab would read as broken.)
//
// Props:
//   active    — "sessions" | "classes" | "pass" | "profile"
//   passToken — selected club's venue_membership pass token (from active_clubs);
//               when absent the Pass tab is hidden rather than dead.
//   clubEntry — optional active_clubs entry. Drives the descriptor AND, when it
//               carries a club_id, threads ?club=<id> into the Sessions/Profile
//               hrefs so a multi-club member keeps the club they're viewing when
//               moving between club screens via the bottom nav (Phase 1 bug fix —
//               without it those tabs dropped the selection and reset to club[0]).
export default function ClubNavBar({ active, passToken = null, clubEntry = null }) {
  const ctx = deriveClubContext(clubEntry || {}); // descriptor (Phase 1 — club context)
  // Tab wording comes from the club's discipline (mig 355). Absent → 'football'
  // defaults, so the casual/football nav label set is byte-identical to before.
  const labels = getDisciplineLabels(ctx.discipline);
  const go = (href) => { window.location.href = href; };
  const clubId = clubEntry?.club_id ?? null;
  const withClub = (path) => clubId ? `${path}?club=${encodeURIComponent(clubId)}` : path;

  const tabs = [
    { id: "sessions", label: labels.sessionsTab, Icon: Chats, active: active === "sessions", onSelect: () => go(withClub("/sessions")) },
  ];
  // Classes tab (gym/boxing Phase 1, mig 356) — lit only for non-football disciplines,
  // where venue classes / sparring nights live. Football clubs keep the original tab set
  // (Sessions · Pass · Profile), byte-identical to before, so the casual flow is untouched.
  if (ctx.discipline && ctx.discipline !== "football") {
    tabs.push({
      id: "classes", label: labels.classesTab, Icon: CalendarCheck,
      active: active === "classes", onSelect: () => go(withClub("/classes")),
    });
  }
  // Train tab (gym/boxing Phase 3, mig 358) — lit only for PT disciplines
  // (gym/boxing/martial_arts/fitness via labels.hasPT) → /book, the 1-on-1
  // appointment booking surface. Football (hasPT=false) never renders it, so the
  // casual nav stays byte-identical.
  if (labels.hasPT) {
    tabs.push({
      id: "book", label: labels.trainTab, Icon: Barbell,
      active: active === "book", onSelect: () => go(withClub("/book")),
    });
  }
  if (passToken) {
    tabs.push({
      id: "pass", label: "Pass", Icon: IdentificationCard,
      active: active === "pass", onSelect: () => go(`/m/${passToken}`),
    });
  }
  tabs.push({ id: "profile", label: "Profile", Icon: User, active: active === "profile", onSelect: () => go(withClub("/profile")) });

  return <NavBar tabs={tabs} />;
}
