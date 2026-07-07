const RGB = {
  green:  [61,  220, 106],
  red:    [255, 64,  64 ],
  amber:  [255, 176, 32 ],
  purple: [176, 96,  240],
};

// colour: 'green'|'red'|'amber'|'purple'
// icon:   emoji string or React element (shown in left column)
// label:  e.g. "In", "Maybe", "Out", "Reserve"
// count:  number
// children: Avatar components rendered in the right section
export default function Tile({ colour, icon, label, count, children }) {
  const [r, g, b] = RGB[colour] ?? RGB.green;

  return (
    <div style={{
      borderRadius:"var(--rs)",
      overflow:"hidden",
      display:"flex",
      alignItems:"stretch",
      minHeight:62,
      background:`linear-gradient(135deg,rgba(${r},${g},${b},0.26) 0%,rgba(${r},${g},${b},0.08) 45%,rgba(10,10,8,0.65) 100%)`,
      border:`0.5px solid rgba(${r},${g},${b},0.38)`,
      boxShadow:`0 0 18px rgba(${r},${g},${b},0.12),inset 0 0 30px rgba(${r},${g},${b},0.06)`,
    }}>

      {/* Left column */}
      <div style={{
        padding:"10px 12px",
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        minWidth:56,
        borderRight:"0.5px solid rgba(255,255,255,0.06)",
        flexShrink:0,
      }}>
        <span style={{ fontSize:13, marginBottom:1 }}>{icon}</span>
        <span style={{
          fontSize:9, fontWeight:400,
          letterSpacing:"0.08em", textTransform:"uppercase",
          color:"var(--white)",
        }}>
          {label}
        </span>
        <span style={{ fontFamily:"var(--font-display)", fontSize:28, lineHeight:1, color:"var(--t1)" }}>
          {count}
        </span>
      </div>

      {/* Right: avatar chips */}
      <div style={{
        flex:1, padding:"8px 10px",
        display:"flex", flexWrap:"wrap",
        gap:"5px 9px", alignContent:"center",
      }}>
        {children}
      </div>
    </div>
  );
}
