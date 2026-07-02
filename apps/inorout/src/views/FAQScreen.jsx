import { useState } from "react";
import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import { colors as C } from "@platform/core";
import { FAQ_ENTRIES } from "../data/faq.js";

export default function FAQScreen() {
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState("");

  const S = {
    page: { background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:680, margin:"0 auto",
      padding:"calc(32px + env(safe-area-inset-top)) 24px calc(60px + env(safe-area-inset-bottom))",
      fontFamily:"'DM Sans', sans-serif" },
    h1: { fontFamily:"Bebas Neue,sans-serif", fontSize:32, color:C.amber,
      letterSpacing:2, marginBottom:4 },
    sub: { fontFamily:"'DM Sans', sans-serif", fontSize:13, color:C.muted,
      marginBottom:20 },
    searchWrap: { display:"flex", alignItems:"center", gap:8,
      background:"var(--s2, rgba(255,255,255,0.04))", borderRadius:10,
      border:"0.5px solid var(--border-subtle, rgba(255,255,255,0.1))",
      padding:"10px 14px", marginBottom:20 },
    searchInput: { flex:1, background:"transparent", border:"none", outline:"none",
      color:C.text, fontFamily:"'DM Sans', sans-serif", fontSize:14 },
    item: { border:"0.5px solid var(--border-subtle, rgba(255,255,255,0.1))",
      borderRadius:10, marginBottom:10, overflow:"hidden" },
    question: { width:"100%", padding:"14px 16px", background:"transparent",
      border:"none", cursor:"pointer", textAlign:"left",
      display:"flex", alignItems:"center", justifyContent:"space-between", gap:10,
      fontFamily:"'DM Sans', sans-serif", fontSize:14, fontWeight:600, color:C.text,
      WebkitTapHighlightColor:"transparent" },
    answer: { padding:"0 16px 16px", fontFamily:"'DM Sans', sans-serif",
      fontSize:13, color:C.muted, lineHeight:1.6 },
    links: { display:"flex", flexWrap:"wrap", gap:8, marginTop:12 },
    link: { fontSize:12, fontWeight:600, color:C.amber, textDecoration:"none",
      border:`0.5px solid ${C.amber}`, borderRadius:8, padding:"6px 10px" },
    empty: { fontFamily:"'DM Sans', sans-serif", fontSize:13, color:C.muted,
      textAlign:"center", padding:"32px 0" },
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? FAQ_ENTRIES.filter(e =>
        e.question.toLowerCase().includes(q) ||
        e.answer.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q)))
    : FAQ_ENTRIES;

  return (
    <div style={S.page}>
      <div style={{ marginBottom:8 }}>
        <a href="/" style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12,
          color:C.muted, textDecoration:"none" }}>← Back to In or Out</a>
      </div>
      <div style={S.h1}>FAQ</div>
      <div style={S.sub}>Answers to common questions about how In or Out works.</div>

      <div style={S.searchWrap}>
        <MagnifyingGlass size={16} weight="thin" color={C.muted} />
        <input
          style={S.searchInput}
          placeholder="Search FAQs…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <div style={S.empty}>No FAQs match "{query}".</div>
      )}

      {filtered.map(entry => {
        const open = openId === entry.id;
        return (
          <div key={entry.id} style={S.item}>
            <button
              style={S.question}
              onClick={() => setOpenId(open ? null : entry.id)}
              aria-expanded={open}
            >
              <span>{entry.question}</span>
              <CaretDown size={16} weight="thin" color={C.muted}
                style={{ flexShrink:0, transform: open ? "rotate(180deg)" : "none",
                  transition:"transform 0.2s" }} />
            </button>
            {open && (
              <div style={S.answer}>
                {entry.answer}
                {entry.links?.length > 0 && (
                  <div style={S.links}>
                    {entry.links.map(l => (
                      <a key={l.path} href={l.path} style={S.link}>{l.label}</a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
