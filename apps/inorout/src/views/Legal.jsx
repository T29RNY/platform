import { useState } from "react";
import { colors as C } from "@platform/core";

const EFFECTIVE_DATE = "10 May 2026";
const CONTACT_EMAIL = "hello@in-or-out.com";
const COMPANY = "In or Out";

export default function Legal() {
  const [tab, setTab] = useState(
    window.location.hash === "#privacy" ? "privacy" : "terms"
  );

  const S = {
    page: { background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:680, margin:"0 auto", padding:"32px 24px 60px",
      fontFamily:"Inter,sans-serif" },
    h1: { fontFamily:"Bebas Neue,sans-serif", fontSize:32, color:C.amber,
      letterSpacing:2, marginBottom:4 },
    h2: { fontFamily:"Inter,sans-serif", fontSize:16, fontWeight:800,
      color:C.text, margin:"24px 0 8px" },
    p: { fontFamily:"Inter,sans-serif", fontSize:14, color:"#aaa",
      lineHeight:1.7, marginBottom:12 },
    ul: { fontFamily:"Inter,sans-serif", fontSize:14, color:"#aaa",
      lineHeight:1.7, marginBottom:12, paddingLeft:20 },
    tab: (active) => ({
      padding:"10px 20px", borderRadius:6, border:"none", cursor:"pointer",
      fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700,
      background: active ? C.amber : "transparent",
      color: active ? "#000" : C.muted,
    }),
  };

  return (
    <div style={S.page}>
      <div style={{ marginBottom:8 }}>
        <a href="/" style={{ fontFamily:"Inter,sans-serif", fontSize:12,
          color:C.muted, textDecoration:"none" }}>← Back to In or Out</a>
      </div>
      <div style={S.h1}>IN OR OUT</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
        color:C.muted, marginBottom:28 }}>Legal — effective {EFFECTIVE_DATE}</div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:32,
        borderBottom:`1px solid ${C.border}`, paddingBottom:16 }}>
        <button style={S.tab(tab==="terms")} onClick={() => setTab("terms")}>
          Terms of Service
        </button>
        <button style={S.tab(tab==="privacy")} onClick={() => setTab("privacy")}>
          Privacy Policy
        </button>
      </div>

      {tab === "terms" && (
        <div>
          <h2 style={S.h2}>1. About In or Out</h2>
          <p style={S.p}>In or Out is a web application that helps people organise recurring casual sports games. By using the app you agree to these terms.</p>

          <h2 style={S.h2}>2. Using the App</h2>
          <p style={S.p}>You must be 13 or older to use In or Out. You are responsible for any content you submit, including your name and any notes you add. You agree not to misuse the service or attempt to access it in unauthorised ways.</p>

          <h2 style={S.h2}>3. Your Data</h2>
          <p style={S.p}>We store your name, email address (if you sign in), and your game-related activity such as availability responses, payments, and statistics. See our Privacy Policy for full details.</p>

          <h2 style={S.h2}>4. Service Availability</h2>
          <p style={S.p}>We aim to keep In or Out available at all times but cannot guarantee uninterrupted access. We may update, suspend or discontinue the service with reasonable notice.</p>

          <h2 style={S.h2}>5. Payments</h2>
          <p style={S.p}>In or Out tracks game fee payments between players as a convenience tool. We do not process payments ourselves and are not responsible for any financial disputes between players and organisers.</p>

          <h2 style={S.h2}>6. Limitation of Liability</h2>
          <p style={S.p}>In or Out is provided as-is. We are not liable for any loss or damage arising from your use of the service.</p>

          <h2 style={S.h2}>7. Changes</h2>
          <p style={S.p}>We may update these terms. Continued use of the app after changes means you accept the new terms.</p>

          <h2 style={S.h2}>8. Contact</h2>
          <p style={S.p}>Questions? Email us at <a href={`mailto:${CONTACT_EMAIL}`}
            style={{ color:C.amber }}>{CONTACT_EMAIL}</a></p>
        </div>
      )}

      {tab === "privacy" && (
        <div>
          <h2 style={S.h2}>What We Collect</h2>
          <p style={S.p}>We collect the following information when you use In or Out:</p>
          <ul style={S.ul}>
            <li>Your name (provided by you when joining a team)</li>
            <li>Your email address (if you sign in with Google or email)</li>
            <li>Your availability responses (in, out, maybe)</li>
            <li>Game statistics (goals, attendance, payments)</li>
            <li>Usage data (pages visited, actions taken) via PostHog analytics</li>
            <li>Device type and browser (collected automatically)</li>
          </ul>

          <h2 style={S.h2}>How We Use It</h2>
          <ul style={S.ul}>
            <li>To provide the app — showing your availability, stats, and team info</li>
            <li>To identify you across multiple games if you sign in</li>
            <li>To improve the app using anonymised usage analytics</li>
            <li>To help organisers manage their teams</li>
          </ul>

          <h2 style={S.h2}>Who Can See Your Data</h2>
          <ul style={S.ul}>
            <li>Your team organiser can see your name, availability, and payment status</li>
            <li>Other players in your team can see your name and availability</li>
            <li>Your email address is never visible to other players or organisers</li>
            <li>We do not sell your data to third parties</li>
          </ul>

          <h2 style={S.h2}>Third Party Services</h2>
          <ul style={S.ul}>
            <li><strong style={{color:C.text}}>Supabase</strong> — our database provider, stores your data securely</li>
            <li><strong style={{color:C.text}}>Google OAuth</strong> — used for sign in if you choose it</li>
            <li><strong style={{color:C.text}}>PostHog</strong> — anonymised usage analytics</li>
            <li><strong style={{color:C.text}}>Vercel</strong> — hosts the application</li>
          </ul>

          <h2 style={S.h2}>Data Retention</h2>
          <p style={S.p}>We keep your data for as long as your team exists on the platform. You can request deletion at any time by emailing us.</p>

          <h2 style={S.h2}>Your Rights</h2>
          <p style={S.p}>You have the right to access, correct or delete your personal data. Email us at <a href={`mailto:${CONTACT_EMAIL}`} style={{color:C.amber}}>{CONTACT_EMAIL}</a> and we will respond within 30 days.</p>

          <h2 style={S.h2}>Cookies</h2>
          <p style={S.p}>We use minimal cookies required for authentication and analytics. No advertising cookies are used.</p>

          <h2 style={S.h2}>Contact</h2>
          <p style={S.p}>For any privacy questions or data requests: <a href={`mailto:${CONTACT_EMAIL}`} style={{color:C.amber}}>{CONTACT_EMAIL}</a></p>
        </div>
      )}
    </div>
  );
}
