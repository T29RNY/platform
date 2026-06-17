import { Chats, IdentificationCard, User } from "@phosphor-icons/react";
import NavBar from "./NavBar.jsx";
import { deriveClubContext } from "../../lib/deriveContext.js";

// Shared bottom nav for the club-membership context (multi-context nav, Phase 1).
// Unstrands the /sessions and /profile screens, which had no nav. Tabs are the
// real, working club routes only — Sessions, Pass (deep-links to the selected
// club's pass token), Profile. ("Classes" is intentionally omitted until a
// /classes route exists — a no-op tab would read as broken.)
//
// Props:
//   active    — "sessions" | "pass" | "profile"
//   passToken — selected club's venue_membership pass token (from active_clubs);
//               when absent the Pass tab is hidden rather than dead.
//   clubEntry — optional active_clubs entry (drives the descriptor; reserved).
export default function ClubNavBar({ active, passToken = null, clubEntry = null }) {
  deriveClubContext(clubEntry || {}); // descriptor (Phase 1 — club context)
  const go = (href) => { window.location.href = href; };

  const tabs = [
    { id: "sessions", label: "Sessions", Icon: Chats, active: active === "sessions", onSelect: () => go("/sessions") },
  ];
  if (passToken) {
    tabs.push({
      id: "pass", label: "Pass", Icon: IdentificationCard,
      active: active === "pass", onSelect: () => go(`/m/${passToken}`),
    });
  }
  tabs.push({ id: "profile", label: "Profile", Icon: User, active: active === "profile", onSelect: () => go("/profile") });

  return <NavBar tabs={tabs} />;
}
