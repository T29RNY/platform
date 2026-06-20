import { House, ChartBar, ClockCounterClockwise, Gear, Brain } from "@phosphor-icons/react";

// Inject nav styles — pseudo-elements can't be done with inline styles
if (typeof document !== "undefined" && !document.getElementById("ioo-nav-styles")) {
  const el = document.createElement("style");
  el.id = "ioo-nav-styles";
  el.textContent = `
    .ioo-ni {
      flex:1; display:flex; flex-direction:column; align-items:center;
      gap:3px; cursor:pointer; padding:4px; border-radius:10px;
      margin:0 3px; transition:all 0.2s; position:relative;
      -webkit-tap-highlight-color:transparent;
    }
    .ioo-ni.active {
      background:rgba(232,160,32,0.04);
    }
    .ioo-ni.active::after {
      content:''; position:absolute; inset:0; border-radius:10px; padding:0.5px;
      background:linear-gradient(180deg,
        rgba(232,160,32,0.9) 0%, rgba(232,160,32,0.7) 8%,
        rgba(232,160,32,0.3) 22%, rgba(232,160,32,0.05) 40%,
        transparent 55%);
      -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
      -webkit-mask-composite:xor; mask-composite:exclude;
      pointer-events:none;
    }
    .ioo-ni-dot {
      width:3px; height:3px; background:var(--gold);
      border-radius:50%; margin-top:1px; display:none;
      box-shadow:0 0 5px var(--gold);
    }
    .ioo-ni.active .ioo-ni-dot { display:block; }
  `;
  document.head.appendChild(el);
}

const BASE_TABS = [
  { id:"my-view", label:"My View", Icon:House               },
  { id:"stats",   label:"Stats",   Icon:ChartBar            },
  { id:"history", label:"Results", Icon:ClockCounterClockwise },
];

const MY_IO_TAB = { id:"my-io", label:"MY IO", Icon:Brain, myio:true };

function MyIOLabel() {
  return (
    <span style={{ fontSize:9, letterSpacing:"0.07em", textTransform:"uppercase", lineHeight:1 }}>
      <span style={{ color:"var(--t2)", fontWeight:400 }}>MY </span>
      <span style={{ color:"var(--green)", fontWeight:400 }}>I</span>
      <span style={{ color:"var(--red)", fontWeight:400 }}>O</span>
    </span>
  );
}

// Build the squad (footballer) tab set from the legacy props — the unchanged
// casual/competitive behaviour. Kept as a builder so the render path below is a
// single dumb renderer over a tabs array (multi-context nav, Phase 1).
function buildSquadTabs({ activeTab, onTabChange, onAdminClick }) {
  const base = onAdminClick
    ? [...BASE_TABS, MY_IO_TAB, { id:"admin", label:"Admin", Icon:Gear }]
    : [...BASE_TABS, MY_IO_TAB];
  return base.map((t) => ({
    ...t,
    active: activeTab === t.id,
    onSelect: t.id === "admin" ? onAdminClick : () => onTabChange?.(t.id),
  }));
}

// Config-driven NavBar. Pass an explicit `tabs` array
// ([{ id, label, Icon, myio?, active, onSelect }]) for club/guardian contexts;
// omit it and pass the legacy activeTab/onTabChange/onAdminClick props to get
// the unchanged squad bar.
export default function NavBar({ tabs, activeTab, onTabChange, onAdminClick }) {
  const resolvedTabs = tabs ?? buildSquadTabs({ activeTab, onTabChange, onAdminClick });

  return (
    <nav style={{
      position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth:430,
      background:"rgba(8,8,6,0.97)",
      backdropFilter:"blur(30px)", WebkitBackdropFilter:"blur(30px)",
      display:"flex",
      paddingTop:10, paddingLeft:0, paddingRight:0,
      // Home-indicator clearance: 26px floor on non-notch, grows to the device
      // safe-area inset on devices that have one (Stage 5.2 finding F1).
      paddingBottom:"max(26px, env(safe-area-inset-bottom))",
      zIndex:100,
      borderTop:"0.5px solid rgba(255,255,255,0.1)",
    }}>
      {/* Top glow line */}
      <div style={{
        position:"absolute", top:-1, left:"5%", right:"5%", height:1,
        background:"linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.18) 25%,rgba(255,255,255,0.25) 50%,rgba(255,255,255,0.18) 75%,transparent 100%)",
        pointerEvents:"none",
      }} />

      {resolvedTabs.map(({ id, label, Icon, myio, active, onSelect }) => {
        const glow = active ? { filter:"drop-shadow(0 0 5px rgba(232,160,32,0.75)) drop-shadow(0 0 12px rgba(232,160,32,0.35))" } : undefined;
        const TabIcon = myio ? Brain : Icon;
        return (
          <div
            key={id}
            className={`ioo-ni${active ? " active" : ""}`}
            onClick={onSelect}
          >
            <TabIcon size={22} weight="thin" color={active ? "var(--gold)" : "var(--t2)"} style={glow} />
            {myio ? <MyIOLabel /> : (
              <span style={{
                fontSize:9, fontWeight:400,
                letterSpacing:"0.07em", textTransform:"uppercase",
                color: active ? "var(--gold)" : "var(--t2)",
              }}>
                {label}
              </span>
            )}
            <span className="ioo-ni-dot" />
          </div>
        );
      })}
    </nav>
  );
}
