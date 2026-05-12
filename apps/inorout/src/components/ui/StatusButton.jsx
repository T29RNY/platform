const ACTIVE_STYLES = {
  in: {
    bg:     "linear-gradient(160deg,rgba(61,220,106,0.32) 0%,rgba(61,220,106,0.12) 60%,rgba(20,80,40,0.2) 100%)",
    border: "0.5px solid rgba(61,220,106,0.5)",
    shadow: "0 0 14px rgba(61,220,106,0.22),inset 0 0 20px rgba(61,220,106,0.1)",
  },
  out: {
    bg:     "linear-gradient(160deg,rgba(255,64,64,0.32) 0%,rgba(255,64,64,0.12) 60%,rgba(80,20,20,0.2) 100%)",
    border: "0.5px solid rgba(255,64,64,0.5)",
    shadow: "0 0 14px rgba(255,64,64,0.22),inset 0 0 20px rgba(255,64,64,0.1)",
  },
  maybe: {
    bg:     "linear-gradient(160deg,rgba(255,176,32,0.32) 0%,rgba(255,176,32,0.12) 60%,rgba(80,60,10,0.2) 100%)",
    border: "0.5px solid rgba(255,176,32,0.5)",
    shadow: "0 0 14px rgba(255,176,32,0.22),inset 0 0 20px rgba(255,176,32,0.1)",
  },
  reserve: {
    bg:     "linear-gradient(160deg,rgba(176,96,240,0.32) 0%,rgba(176,96,240,0.12) 60%,rgba(60,20,80,0.2) 100%)",
    border: "0.5px solid rgba(176,96,240,0.5)",
    shadow: "0 0 14px rgba(176,96,240,0.22),inset 0 0 20px rgba(176,96,240,0.1)",
  },
};

// icon: React element, e.g. <Check size={18} weight="thin" />
// status: 'in'|'out'|'maybe'|'reserve' — used to pick active gradient
export default function StatusButton({ label, icon, active, status, onClick, disabled }) {
  const a = active ? ACTIVE_STYLES[status] : null;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding:"10px 4px 8px",
        textAlign:"center",
        cursor: disabled ? "not-allowed" : "pointer",
        border:        a ? a.border : "0.5px solid var(--border-subtle)",
        borderRadius:  "var(--r-button)",
        background:    a ? a.bg     : "rgba(255,255,255,0.04)",
        boxShadow:     a ? a.shadow : "none",
        color:         a ? "#fff"   : "var(--t2)",
        fontFamily:"var(--font-body)",
        fontSize:10, fontWeight:400,
        letterSpacing:"0.06em", textTransform:"uppercase",
        display:"flex", flexDirection:"column", alignItems:"center", gap:4,
        transition:"all 0.2s",
        width:"100%",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
