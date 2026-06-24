import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";
import { getUnifiedHomeFeed } from "@platform/core/storage/supabase.js";
import { House, Lightning, Chats, User } from "@phosphor-icons/react";

function formatWhen(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = d - now;
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 0 && diffMins > -120)  return "now";
  if (diffMins < 60)                    return `in ${diffMins}m`;
  if (diffMins < 1440) {
    const h = Math.floor(diffMins / 60);
    return `in ${h}h`;
  }
  return d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" });
}

function EventCard({ event, onClick }) {
  const typeLabel = {
    squad_game:           "SQUAD GAME",
    club_session:         "SESSION",
    competition_fixture:  "FIXTURE",
    child_event:          "CHILD",
  }[event.type] ?? event.type.toUpperCase();

  const isLive = event.is_live;

  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface,
        border: `1px solid ${isLive ? C.amber : C.border}`,
        borderRadius: 12,
        padding: "16px 18px",
        marginBottom: 12,
        cursor: onClick ? "pointer" : "default",
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = C.amber; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = isLive ? C.amber : C.border; }}
    >
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
        <div>
          <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:18,
            color: isLive ? C.amber : C.text, letterSpacing:1.5, lineHeight:1.1 }}>
            {event.title}
          </div>
          {event.subtitle && (
            <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12,
              color: C.muted, marginTop:3 }}>{event.subtitle}</div>
          )}
          {event.child_name && (
            <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12,
              color: C.muted, marginTop:3 }}>For {event.child_name}</div>
          )}
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11, fontWeight:700,
            color: isLive ? C.amber : C.muted, letterSpacing:1.5,
            textTransform:"uppercase" }}>
            {isLive ? "● LIVE" : typeLabel}
          </div>
          <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12, color:C.muted, marginTop:4 }}>
            {formatWhen(event.when_at)}
          </div>
        </div>
      </div>
    </div>
  );
}

function BottomNav({ active }) {
  const items = [
    { key:"feed",     label:"Feed",     href:"/feed",     Icon:House },
    { key:"sessions", label:"Sessions", href:"/sessions", Icon:Chats },
    { key:"profile",  label:"Profile",  href:"/profile",  Icon:User  },
  ];
  return (
    <div style={{
      position:"fixed", bottom:0, left:0, right:0,
      background:C.bg, borderTop:`1px solid ${C.border}`,
      display:"flex", maxWidth:430, margin:"0 auto",
      paddingBottom:"env(safe-area-inset-bottom,0)",
    }}>
      {items.map(({ key, label, href, Icon }) => (
        <a key={key} href={href} style={{
          flex:1, display:"flex", flexDirection:"column", alignItems:"center",
          padding:"10px 0", textDecoration:"none",
          color: active === key ? C.amber : C.muted,
        }}>
          <Icon size={22} weight="thin" />
          <span style={{ fontFamily:"'DM Sans', sans-serif", fontSize:10,
            fontWeight:600, marginTop:3, letterSpacing:0.5 }}>{label}</span>
        </a>
      ))}
    </div>
  );
}

export default function UnifiedFeedScreen() {
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUnifiedHomeFeed()
      .then(e => setEvents(e))
      .catch(err => console.error("[feed] load failed", err))
      .finally(() => setLoading(false));
  }, []);

  function handleTap(event) {
    if (event.type === "squad_game")    { window.location.href = `/p/${event.entity_id}`; return; }
    if (event.type === "club_session")  { window.location.href = "/sessions"; return; }
    if (event.type === "child_event") {
      if (event.child_profile_id) {
        window.location.href = `/follow-live/${event.child_profile_id}`;
      } else {
        window.location.href = "/sessions";
      }
    }
    // competition_fixture — no tap action in Phase 0
  }

  const liveEvents   = events.filter(e => e.is_live);
  const upcomingEvents = events.filter(e => !e.is_live);

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"'DM Sans', sans-serif",
      paddingBottom: 72 }}>
      <div style={{ padding:"calc(20px + env(safe-area-inset-top)) 18px 12px", borderBottom:`1px solid ${C.border}` }}>
        {/* Brand lockup — IN green · OR neutral · OUT red (matches PageHeader). */}
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28, letterSpacing:3 }}>
          <span style={{ color:C.green }}>IN</span>
          <span style={{ color:C.text }}> OR </span>
          <span style={{ color:C.red }}>OUT</span>
        </div>
        <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>What's coming up</div>
      </div>

      <div style={{ padding:"18px 18px 0" }}>
        {loading && (
          <div style={{ color:C.muted, fontSize:13, textAlign:"center", paddingTop:40 }}>
            Loading...
          </div>
        )}

        {!loading && liveEvents.length > 0 && (
          <>
            <div style={{ fontSize:11, fontWeight:800, color:C.amber,
              letterSpacing:1.5, textTransform:"uppercase", marginBottom:12 }}>
              ● RIGHT NOW
            </div>
            {liveEvents.map((e, i) => (
              <EventCard key={i} event={e} onClick={() => handleTap(e)} />
            ))}
            {upcomingEvents.length > 0 && (
              <div style={{ fontSize:11, fontWeight:800, color:C.muted,
                letterSpacing:1.5, textTransform:"uppercase", marginBottom:12, marginTop:20 }}>
                COMING UP
              </div>
            )}
          </>
        )}

        {!loading && upcomingEvents.map((e, i) => (
          <EventCard
            key={i}
            event={e}
            onClick={["squad_game","club_session","child_event"].includes(e.type)
              ? () => handleTap(e) : null}
          />
        ))}

        {!loading && events.length === 0 && (
          <div style={{ textAlign:"center", paddingTop:60 }}>
            <div style={{ fontSize:36, marginBottom:12 }}>📅</div>
            <div style={{ fontSize:14, color:C.muted }}>Nothing coming up in the next two weeks.</div>
          </div>
        )}
      </div>

      <BottomNav active="feed" />
    </div>
  );
}
