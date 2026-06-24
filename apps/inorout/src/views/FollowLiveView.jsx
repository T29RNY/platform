import { useState, useEffect, useRef } from "react";
import { colors as C } from "@platform/core";
import { getChildLiveMatch } from "@platform/core/storage/supabase.js";
import { supabase } from "@platform/core/storage/supabase.js";
import { ArrowLeft } from "@phosphor-icons/react";

const EVENT_LABELS = {
  goal:        "⚽ Goal",
  own_goal:    "⚽ Own goal",
  yellow_card: "🟨 Yellow card",
  red_card:    "🟥 Red card",
  substitution:"🔄 Sub",
  sin_bin:     "⏱ Sin bin",
  penalty:     "⚽ Penalty",
};

function ScoreBoard({ fixture }) {
  const myTeamId  = fixture.my_team_id;
  const homeIsMe  = fixture.home_team_id === myTeamId;
  const awayIsMe  = fixture.away_team_id === myTeamId;

  return (
    <div style={{ background:C.surface, border:`1px solid ${C.amber}`,
      borderRadius:12, padding:"20px 18px", marginBottom:16 }}>
      <div style={{ fontSize:10, fontWeight:700, color:C.amber,
        letterSpacing:2, textTransform:"uppercase", textAlign:"center",
        marginBottom:12 }}>
        ● LIVE — {fixture.competition}
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
        <div style={{ flex:1, textAlign:"center" }}>
          <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:16,
            color: homeIsMe ? C.amber : C.text, letterSpacing:1.5,
            lineHeight:1.2 }}>
            {fixture.home_team_name}
          </div>
        </div>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:48,
          color:C.amber, letterSpacing:4, minWidth:100, textAlign:"center" }}>
          {fixture.home_score ?? 0} – {fixture.away_score ?? 0}
        </div>
        <div style={{ flex:1, textAlign:"center" }}>
          <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:16,
            color: awayIsMe ? C.amber : C.text, letterSpacing:1.5,
            lineHeight:1.2 }}>
            {fixture.away_team_name}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventRow({ event }) {
  const label = EVENT_LABELS[event.event_type] ?? event.event_type;
  const minute = event.minute != null ? `${event.minute}'` : "";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0",
      borderBottom:`1px solid ${C.border}` }}>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:15,
        color:C.amber, width:32, flexShrink:0 }}>{minute}</div>
      <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13, color:C.text }}>
        {label}
      </div>
    </div>
  );
}

export default function FollowLiveView({ profileId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const channelRef            = useRef(null);

  async function load() {
    try {
      const result = await getChildLiveMatch(profileId);
      setData(result);
      if (result?.ok && result?.venue_id && !channelRef.current) {
        channelRef.current = supabase
          .channel(`venue_live:${result.venue_id}`)
          .on("broadcast", { event:"venue_update" }, async () => {
            const fresh = await getChildLiveMatch(profileId).catch(() => null);
            if (fresh) setData(fresh);
          })
          .subscribe();
      }
    } catch (err) {
      console.error("[follow-live] load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [profileId]);

  const noMatch = !loading && (!data?.ok);

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"'DM Sans', sans-serif" }}>
      <div style={{ padding:"16px 18px 12px", borderBottom:`1px solid ${C.border}`,
        display:"flex", alignItems:"center", gap:12 }}>
        <button
          onClick={() => window.history.length > 1
            ? window.history.back()
            : window.location.href = "/parent-home"}
          style={{ background:"none", border:"none", padding:0, cursor:"pointer",
            color:C.muted, display:"flex", alignItems:"center" }}>
          <ArrowLeft size={20} weight="thin" />
        </button>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
          color:C.amber, letterSpacing:2 }}>FOLLOW LIVE</div>
      </div>

      <div style={{ padding:"18px 18px 0" }}>
        {loading && (
          <div style={{ color:C.muted, fontSize:13, textAlign:"center", paddingTop:60 }}>
            Loading...
          </div>
        )}

        {noMatch && (
          <div style={{ textAlign:"center", paddingTop:60 }}>
            <div style={{ fontSize:40, marginBottom:16 }}>📡</div>
            <div style={{ fontSize:15, color:C.text, fontWeight:600, marginBottom:8 }}>
              No live match right now
            </div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:32 }}>
              {data?.reason === "no_live_match"
                ? "Check back when a match is in progress."
                : "This player's account isn't linked yet — ask their club to connect it."}
            </div>
            <button
              onClick={() => window.location.href = "/parent-home"}
              style={{ padding:"12px 28px", borderRadius:8, border:`1px solid ${C.border}`,
                background:C.bg, color:C.text, fontFamily:"'DM Sans', sans-serif",
                fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Back to home
            </button>
          </div>
        )}

        {!loading && data?.ok && (
          <>
            <ScoreBoard fixture={data.fixture} />

            {data.events?.length > 0 && (
              <>
                <div style={{ fontSize:11, fontWeight:800, color:C.muted,
                  letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
                  MATCH EVENTS
                </div>
                {[...data.events].reverse().map((e, i) => (
                  <EventRow key={i} event={e} />
                ))}
              </>
            )}

            {data.events?.length === 0 && (
              <div style={{ fontSize:13, color:C.muted, textAlign:"center", paddingTop:20 }}>
                No events recorded yet.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
