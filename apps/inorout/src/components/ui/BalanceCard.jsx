// Flush to NavBar: top-rounded only, no bottom border.
// owes:     outstanding debt in £ (number)
// status:   player status ('in'|'out'|...)
// paid:     admin-confirmed payment
// selfPaid: player flagged as paid, pending admin confirmation
// onSelfPay: callback for "I've paid" button
export default function BalanceCard({ owes, status, paid, selfPaid, onSelfPay }) {
  const hasDebt    = (owes || 0) > 0;
  const showButton = status === "in" && !paid && !selfPaid;
  const showPending = selfPaid && !paid;

  return (
    <div style={{
      borderRadius:"var(--rs) var(--rs) 0 0",
      overflow:"hidden",
      background:"linear-gradient(160deg,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0.04) 40%,rgba(20,20,18,0.8) 100%)",
      border:"0.5px solid rgba(255,255,255,0.14)",
      borderBottom:"none",
      boxShadow:"0 0 20px rgba(255,255,255,0.04),inset 0 0 30px rgba(255,255,255,0.03)",
    }}>
      <div style={{
        padding:"10px 14px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        gap:12,
      }}>
        {/* Left: label + amount + sub */}
        <div>
          <div style={{
            fontSize:10, fontWeight:300,
            letterSpacing:"0.1em", textTransform:"uppercase",
            color:"var(--t2)", marginBottom:2,
          }}>
            Your Balance
          </div>
          <div style={{
            fontFamily:"var(--font-display)", fontSize:26, lineHeight:1,
            color: hasDebt ? "var(--red)" : "var(--green)",
          }}>
            {hasDebt ? `−£${(owes).toFixed(2)}` : "All clear"}
          </div>
          <div style={{ fontSize:11, fontWeight:300, color:"var(--t2)", marginTop:1 }}>
            {hasDebt ? "You still owe from last week" : "You’re all square ✓"}
          </div>
        </div>

        {/* Right: state-dependent action */}
        {showPending && (
          <div style={{
            padding:"7px 12px",
            background:"var(--amber2)", border:"0.5px solid var(--amberb)",
            borderRadius:8, fontSize:11, color:"var(--amber)", flexShrink:0,
            whiteSpace:"nowrap",
          }}>
            Pending ⏳
          </div>
        )}
        {showButton && (
          <button
            onClick={onSelfPay}
            style={{
              background:"var(--gold)", color:"#000",
              border:"none", borderRadius:8,
              padding:"9px 14px", fontSize:12, fontWeight:500,
              fontFamily:"var(--font-body)", cursor:"pointer",
              flexShrink:0, whiteSpace:"nowrap",
            }}
          >
            I&apos;ve paid
          </button>
        )}
      </div>
    </div>
  );
}
