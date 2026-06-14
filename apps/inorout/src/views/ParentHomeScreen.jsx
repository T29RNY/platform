import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";
import { getGuardianHomeFeed } from "@platform/core/storage/supabase.js";
import { Chats, User, House } from "@phosphor-icons/react";

function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleDateString("en-GB", {
    weekday:"short", day:"numeric", month:"short",
    hour:"2-digit", minute:"2-digit",
  });
}

function ChildCard({ child }) {
  const session = child.next_session;

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: "18px 18px 16px",
      marginBottom: 14,
    }}>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
        color:C.amber, letterSpacing:2, marginBottom:8 }}>
        {child.first_name} {child.last_name}
      </div>

      {session ? (
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:C.muted,
            letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
            NEXT SESSION
          </div>
          <div style={{ fontSize:14, color:C.text, fontWeight:600, marginBottom:2 }}>
            {session.title}
          </div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:2 }}>
            {session.club_name}
          </div>
          {session.location && (
            <div style={{ fontSize:12, color:C.muted, marginBottom:2 }}>
              {session.location}
            </div>
          )}
          <div style={{ fontSize:12, color:C.muted, marginBottom:12 }}>
            {formatDate(session.scheduled_at)}
          </div>
          {session.own_rsvp && (
            <div style={{ display:"inline-block", fontSize:11, fontWeight:700,
              letterSpacing:1, textTransform:"uppercase",
              color: session.own_rsvp === "attending" ? C.green : C.muted,
              background: C.bg, border:`1px solid ${C.border}`,
              borderRadius:6, padding:"3px 8px", marginBottom:12 }}>
              {session.own_rsvp === "attending" ? "✓ Going"
                : session.own_rsvp === "not_attending" ? "Not going"
                : session.own_rsvp === "maybe" ? "Maybe"
                : session.own_rsvp}
            </div>
          )}
          <div style={{ display:"flex", gap:8 }}>
            <button
              onClick={() => window.location.href = "/sessions"}
              style={{ flex:1, padding:"10px 0", borderRadius:8, border:`1px solid ${C.border}`,
                background:C.bg, color:C.text, fontFamily:"Inter,sans-serif",
                fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Sessions
            </button>
            <button
              onClick={() => window.location.href = `/follow-live/${child.profile_id}`}
              style={{ flex:1, padding:"10px 0", borderRadius:8, border:"none",
                background:C.amber, color:C.black, fontFamily:"Inter,sans-serif",
                fontSize:13, fontWeight:800, cursor:"pointer" }}>
              Follow Live →
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:12 }}>
            No upcoming sessions in the next two weeks.
          </div>
          <button
            onClick={() => window.location.href = `/follow-live/${child.profile_id}`}
            style={{ width:"100%", padding:"10px 0", borderRadius:8, border:"none",
              background:C.amber, color:C.black, fontFamily:"Inter,sans-serif",
              fontSize:13, fontWeight:800, cursor:"pointer" }}>
            Follow Live →
          </button>
        </div>
      )}
    </div>
  );
}

function BottomNav({ active }) {
  const items = [
    { key:"home",     label:"Home",     href:"/parent-home", Icon:House },
    { key:"sessions", label:"Sessions", href:"/sessions",    Icon:Chats },
    { key:"profile",  label:"Profile",  href:"/profile",     Icon:User  },
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
          <span style={{ fontFamily:"Inter,sans-serif", fontSize:10,
            fontWeight:600, marginTop:3, letterSpacing:0.5 }}>{label}</span>
        </a>
      ))}
    </div>
  );
}

export default function ParentHomeScreen() {
  const [children, setChildren] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    getGuardianHomeFeed()
      .then(c => setChildren(c))
      .catch(err => console.error("[parent-home] load failed", err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif",
      paddingBottom:72 }}>
      <div style={{ padding:"20px 18px 12px", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28,
          color:C.amber, letterSpacing:3 }}>IN OR OUT</div>
        <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>Your children's activity</div>
      </div>

      <div style={{ padding:"18px 18px 0" }}>
        {loading && (
          <div style={{ color:C.muted, fontSize:13, textAlign:"center", paddingTop:40 }}>
            Loading...
          </div>
        )}

        {!loading && children.length === 0 && (
          <div style={{ textAlign:"center", paddingTop:60 }}>
            <div style={{ fontSize:36, marginBottom:12 }}>👶</div>
            <div style={{ fontSize:14, color:C.muted }}>
              No children linked to your account yet.
            </div>
            <div style={{ fontSize:12, color:C.muted, marginTop:8 }}>
              Ask your club to link your child's membership.
            </div>
          </div>
        )}

        {!loading && children.map(child => (
          <ChildCard key={child.profile_id} child={child} />
        ))}
      </div>

      <BottomNav active="home" />
    </div>
  );
}
