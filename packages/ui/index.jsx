import { useState } from "react";
import { colors as C } from "@platform/core";

export const Badge = ({ text, color }) => (
  <span style={{ fontSize:10, fontFamily:"Inter,sans-serif", fontWeight:700, letterSpacing:0.5,
    padding:"2px 8px", borderRadius:4, background:(color||C.muted)+"20", color:color||C.muted }}>
    {text}
  </span>
);

export const Toggle = ({ on, onChange, color }) => (
  <div onClick={onChange} style={{ width:42, height:24, borderRadius:12, cursor:"pointer",
    position:"relative", background:on?(color||C.green):"#2a2a2a",
    transition:"background 0.2s", flexShrink:0 }}>
    <div style={{ position:"absolute", top:3, left:on?21:3, width:18, height:18,
      borderRadius:"50%", background:"#fff", transition:"left 0.2s" }}/>
  </div>
);

export const Btn = ({ label, color, fill, onClick, disabled, small, block, icon }) => (
  <button onClick={onClick} disabled={!!disabled} style={{
    width: block ? "100%" : small ? "auto" : "100%",
    padding: small ? "8px 14px" : "13px 0",
    borderRadius:6, border:`1.5px solid ${disabled?"#2a2a2a":color}`,
    background: fill && !disabled ? color : "transparent",
    color: disabled ? "#444" : fill ? "#000" : color,
    fontFamily:"Inter,sans-serif", fontSize: small?11:13, fontWeight:700,
    letterSpacing:0.3, cursor: disabled?"not-allowed":"pointer",
    display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
  }}>
    {icon && <span>{icon}</span>}{label}
  </button>
);

export const Card = ({ children, color, onClick, style = {} }) => (
  <div onClick={onClick} style={{ background:C.surface, border:`1px solid ${color||C.border}`,
    borderRadius:8, padding:"14px 16px", marginBottom:12,
    cursor:onClick?"pointer":"default", ...style }}>
    {children}
  </div>
);

export const SecTitle = ({ children, color, size }) => (
  <div style={{ fontFamily:"Inter,sans-serif", fontSize:size||11, fontWeight:800,
    color:color||C.muted, letterSpacing:1.5, textTransform:"uppercase", margin:"20px 0 12px" }}>
    {children}
  </div>
);

export const BackBtn = ({ onClick }) => (
  <button onClick={onClick} style={{ background:"none", border:"none", color:C.muted,
    fontSize:13, cursor:"pointer", fontFamily:"Inter,sans-serif", fontWeight:600,
    marginBottom:20, padding:0, display:"flex", alignItems:"center", gap:6 }}>
    ← Back
  </button>
);

export const FieldRow = ({ label, value, onChange, placeholder, type="text" }) => (
  <div style={{ marginBottom:14 }}>
    <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, color:C.muted,
      letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>{label}</div>
    <input type={type} value={value} onChange={e=>onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width:"100%", padding:"11px 13px", borderRadius:6,
        border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
        fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500,
        outline:"none", boxSizing:"border-box" }}/>
  </div>
);

export const CopyBtn = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} style={{ padding:"4px 10px", borderRadius:4,
      border:`1px solid ${C.border}`, background:"transparent",
      color:copied?C.green:C.muted, fontFamily:"Inter,sans-serif",
      fontSize:10, fontWeight:700, cursor:"pointer", flexShrink:0 }}>
      {copied ? "✓ Copied" : "Copy Link"}
    </button>
  );
};
