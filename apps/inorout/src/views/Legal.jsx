import { useState } from "react";
import { colors as C, getAnalyticsConsent, setAnalyticsConsent } from "@platform/core";

const EFFECTIVE_DATE = "24 June 2026";
const CONTACT_EMAIL = "support@in-or-out.com";
const COMPANY = "In or Out";

// In-app analytics opt-in/out control — the "simple means of objecting"
// (and of granting) the app must offer. Reflects and updates the stored choice.
function AnalyticsConsentControl({ S }) {
  const [consent, setConsent] = useState(() => getAnalyticsConsent()); // 'granted' | 'denied' | null
  const on = consent === "granted";
  const apply = (granted) => { setAnalyticsConsent(granted); setConsent(granted ? "granted" : "denied"); };

  return (
    <div style={{
      border: `1px solid ${C.border || "rgba(255,255,255,0.12)"}`, borderRadius: 8,
      padding: 14, margin: "14px 0 12px", display: "flex", alignItems: "center",
      justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700, color: C.text }}>
          Usage analytics
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, color: C.muted, marginTop: 2 }}>
          {consent === null ? "You haven't chosen yet — analytics are off."
            : on ? "On — thank you for helping us improve."
            : "Off — no analytics are being collected."}
        </div>
      </div>
      <button
        onClick={() => apply(!on)}
        aria-pressed={on}
        aria-label="Usage analytics"
        style={{
          flexShrink: 0, width: 52, height: 30, borderRadius: 15, border: "none",
          cursor: "pointer", position: "relative",
          background: on ? C.amber : "rgba(255,255,255,0.18)", transition: "background 0.15s" }}>
        <span style={{
          position: "absolute", top: 3, left: on ? 25 : 3, width: 24, height: 24,
          borderRadius: "50%", background: C.text, transition: "left 0.15s" }} />
      </button>
    </div>
  );
}

export default function Legal() {
  const [tab, setTab] = useState(
    window.location.hash === "#privacy" ? "privacy" : "terms"
  );

  const S = {
    page: { background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:680, margin:"0 auto",
      padding:"calc(32px + env(safe-area-inset-top)) 24px calc(60px + env(safe-area-inset-bottom))",
      fontFamily:"'DM Sans', sans-serif" },
    h1: { fontFamily:"Bebas Neue,sans-serif", fontSize:32, color:C.amber,
      letterSpacing:2, marginBottom:4 },
    h2: { fontFamily:"'DM Sans', sans-serif", fontSize:16, fontWeight:800,
      color:C.text, margin:"24px 0 8px" },
    p: { fontFamily:"'DM Sans', sans-serif", fontSize:14, color:C.muted,
      lineHeight:1.7, marginBottom:12 },
    ul: { fontFamily:"'DM Sans', sans-serif", fontSize:14, color:C.muted,
      lineHeight:1.7, marginBottom:12, paddingLeft:20 },
    tab: (active) => ({
      padding:"10px 20px", borderRadius:6, border:"none", cursor:"pointer",
      fontFamily:"'DM Sans', sans-serif", fontSize:13, fontWeight:700,
      background: active ? C.amber : "transparent",
      color: active ? C.black : C.muted,
    }),
  };

  return (
    <div style={S.page}>
      <div style={{ marginBottom:8 }}>
        <a href="/" style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12,
          color:C.muted, textDecoration:"none" }}>← Back to In or Out</a>
      </div>
      <div style={S.h1}>
        <span style={{ color:C.green }}>IN</span>
        <span style={{ color:C.text }}> OR </span>
        <span style={{ color:C.red }}>OUT</span>
      </div>
      <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13,
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
          <p style={S.p}>{COMPANY} is an app that helps people organise recurring casual sports games — tracking availability, squads, payments between players, and stats. The service is operated by an individual (a sole trader) based in the United Kingdom, trading as “{COMPANY}”. By using the app you agree to these Terms.</p>

          <h2 style={S.h2}>2. Eligibility and Age</h2>
          <p style={S.p}>You must be at least 13 years old to use {COMPANY}. If you are under 18, you may only use the app if a parent or guardian has set it up for you and supervises your use. We do not knowingly collect personal data from children under 13. If you believe a child under 13 has provided us with data, contact us and we will delete it.</p>

          <h2 style={S.h2}>3. Your Account and Responsibilities</h2>
          <p style={S.p}>You are responsible for the information you provide (such as your name and any notes) and for activity that takes place through your access link or sign-in. Keep your sign-in details and any personal team links private. You agree not to misuse the service, disrupt it, or attempt to access it in unauthorised ways.</p>

          <h2 style={S.h2}>4. Your Data</h2>
          <p style={S.p}>How we handle your personal data is explained in our Privacy Policy (see the tab above). Please read it before using the app.</p>

          <h2 style={S.h2}>5. Payments</h2>
          <p style={S.p}>{COMPANY} can help organisers collect game fees, memberships and bookings for real-world activities (such as pitch hire, club membership or sessions). Where payment collection is enabled, payments are processed by our payment providers (Stripe and/or GoCardless) — not by us directly. Organisers set their own fees, and any refund or financial dispute is between you and the organiser. We are not a party to those arrangements and are not responsible for them.</p>

          <h2 style={S.h2}>6. Acceptable Use</h2>
          <p style={S.p}>You agree not to upload unlawful, abusive or infringing content, impersonate others, or use the app in a way that harms other users or the service. We may suspend or remove access that breaches these Terms.</p>

          <h2 style={S.h2}>7. Service Availability</h2>
          <p style={S.p}>We aim to keep {COMPANY} available at all times but cannot guarantee uninterrupted access. We may update, suspend or discontinue features or the service with reasonable notice.</p>

          <h2 style={S.h2}>8. Limitation of Liability</h2>
          <p style={S.p}>{COMPANY} is provided “as is”. To the extent permitted by law, we are not liable for any loss or damage arising from your use of, or inability to use, the service. Nothing in these Terms excludes liability that cannot be excluded under UK law.</p>

          <h2 style={S.h2}>9. Deleting Your Account</h2>
          <p style={S.p}>You can delete your account at any time from within the app, on your profile screen — this removes your personal account and associated personal data. You can also email us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color:C.amber }}>{CONTACT_EMAIL}</a> to request deletion. See the Privacy Policy for what is removed and what may be retained.</p>

          <h2 style={S.h2}>10. Changes to These Terms</h2>
          <p style={S.p}>We may update these Terms from time to time. If we make material changes we will update the effective date above. Continued use of the app after changes means you accept the updated Terms.</p>

          <h2 style={S.h2}>11. Governing Law</h2>
          <p style={S.p}>These Terms are governed by the laws of England and Wales, and any disputes are subject to the courts of England and Wales.</p>

          <h2 style={S.h2}>12. Contact</h2>
          <p style={S.p}>Questions about these Terms? Email us at <a href={`mailto:${CONTACT_EMAIL}`}
            style={{ color:C.amber }}>{CONTACT_EMAIL}</a></p>
        </div>
      )}

      {tab === "privacy" && (
        <div>
          <h2 style={S.h2}>Who We Are</h2>
          <p style={S.p}>{COMPANY} is operated by an individual (a sole trader) based in the United Kingdom, trading as “{COMPANY}”, who is the data controller for the personal data described here. You can contact the data controller at <a href={`mailto:${CONTACT_EMAIL}`} style={{color:C.amber}}>{CONTACT_EMAIL}</a>. This policy explains what we collect, why, and your rights under UK data protection law (UK GDPR).</p>

          <h2 style={S.h2}>What We Collect</h2>
          <ul style={S.ul}>
            <li>Your name (provided when you join a team or squad)</li>
            <li>Your email address (if you sign in with Google or by email)</li>
            <li>Your availability responses (in, out, maybe) and squad activity</li>
            <li>Game and membership data (attendance, stats, fees owed/paid, bookings)</li>
            <li>Payment-related information processed by our payment providers (we do not store full card or bank details — see Payments below)</li>
            <li>Push notification tokens, if you choose to enable notifications</li>
            <li>Usage data (screens visited, actions taken) via PostHog analytics — only if you agree to analytics when we ask</li>
            <li>A minimal record of app sessions (which app, device type, when, and the last screen reached) that we keep to run and support the service — see “Cookies and Analytics” below</li>
            <li>Device type and browser, collected automatically</li>
          </ul>

          <h2 style={S.h2}>How We Use It and Our Legal Basis</h2>
          <ul style={S.ul}>
            <li><strong style={{color:C.text}}>To provide the app</strong> — showing availability, stats, squads, bookings and payments (legal basis: performance of our contract with you)</li>
            <li><strong style={{color:C.text}}>To identify you</strong> across multiple games if you sign in (performance of contract)</li>
            <li><strong style={{color:C.text}}>To improve the app</strong> using usage analytics (legal basis: your consent — we ask before any analytics are collected, and you can withdraw at any time on this page)</li>
            <li><strong style={{color:C.text}}>To run, secure and support the service</strong> using a minimal session record — who opened the app, on what device, when, and the last screen reached (legal basis: our legitimate interests in operating a reliable service; this is never shared with third parties and is deleted after 90 days)</li>
            <li><strong style={{color:C.text}}>To send notifications</strong> you have opted into (legal basis: your consent)</li>
          </ul>

          <h2 style={S.h2}>Who Can See Your Data</h2>
          <ul style={S.ul}>
            <li>Your team organiser can see your name, availability, payment status and stats</li>
            <li>Other players in your team can see your name and availability</li>
            <li>Your email address is never visible to other players or organisers</li>
            <li>We do not sell your personal data to anyone</li>
          </ul>

          <h2 style={S.h2}>Payments</h2>
          <p style={S.p}>Where an organiser collects fees, memberships or bookings, payments are handled by <strong style={{color:C.text}}>Stripe</strong> and/or <strong style={{color:C.text}}>GoCardless</strong>. Your card or bank details are entered with, and held by, those providers under their own privacy policies — we do not receive or store full payment-instrument details. We receive confirmation of payment status so the app can show what has been paid.</p>

          <h2 style={S.h2}>Push Notifications</h2>
          <p style={S.p}>If you enable notifications, we store a notification token for your device so we can send reminders (for example, when availability is needed or a game is on). You can turn notifications off at any time in your device or browser settings, and we will stop sending them.</p>

          <h2 style={S.h2}>Apple Health Data (iOS app only, optional)</h2>
          <p style={S.p}>If you use the {COMPANY} iOS app on Apple Watch or iPhone and choose to attach a workout to a game, we read a summary of that workout from Apple Health — duration, active energy, distance, and average and maximum heart rate — only for the specific workout you pick within the game's time window. We never access any other Health data, and we never read data continuously or in the background — access happens only when you actively attach a workout.</p>
          <p style={S.p}>We store a summary of that workout against your account so you (and, if you choose, your teammates) can see your match fitness stats. We do not store your raw Apple Health records, do not sync this data to iCloud, do not use it for advertising, and do not sell or share it with any third party. This is special category health data under UK GDPR, so we only process it with your explicit consent — you choose whether to attach a workout each time, and whether to share your fitness summaries with teammates via a toggle in your profile (default off). This feature is not available to users under 18.</p>
          <p style={S.p}>Where teammates have turned this sharing on, you may also see their match-fitness summaries compared with yours — head-to-head against a specific opponent and on a squad fitness board — for casual games you have both played. You only ever see a teammate's figures if they have explicitly chosen to share, are 18 or over, and enough of your squad has opted in; anyone can turn sharing off at any time and immediately drops out of these comparisons. These comparisons are shown within your team only and are never used to rank you against people outside your squad.</p>
          <p style={S.p}>You can delete this data at any time by deleting your account on your profile screen, which permanently removes your stored workout summaries along with the rest of your personal data.</p>

          <h2 style={S.h2}>Service Providers</h2>
          <p style={S.p}>We use trusted providers to run the service. Each only processes data needed for its role:</p>
          <ul style={S.ul}>
            <li><strong style={{color:C.text}}>Supabase</strong> — secure database and authentication</li>
            <li><strong style={{color:C.text}}>Vercel</strong> — hosting of the application</li>
            <li><strong style={{color:C.text}}>Google</strong> — Google sign-in, if you choose it</li>
            <li><strong style={{color:C.text}}>Apple</strong> — Sign in with Apple, if you choose it</li>
            <li><strong style={{color:C.text}}>PostHog</strong> — usage analytics (hosted in the EU)</li>
            <li><strong style={{color:C.text}}>Resend</strong> — sending transactional emails</li>
            <li><strong style={{color:C.text}}>Twilio</strong> — sending text-message notifications, where used</li>
            <li><strong style={{color:C.text}}>Stripe</strong> and <strong style={{color:C.text}}>GoCardless</strong> — payment processing, where enabled</li>
            <li><strong style={{color:C.text}}>OpenStreetMap (Nominatim)</strong> — looking up venue names and addresses when a game or club is set up (the address you type is sent to find a match)</li>
          </ul>

          <h2 style={S.h2}>International Transfers</h2>
          <p style={S.p}>Some of our providers are based outside the UK (for example in the EU or the United States). Where your data is transferred outside the UK, we rely on appropriate safeguards such as the UK International Data Transfer Agreement, UK Addendum to the EU Standard Contractual Clauses, or an equivalent approved mechanism.</p>

          <h2 style={S.h2}>Data Retention</h2>
          <p style={S.p}>We keep your personal data for as long as your account or team remains active on the platform, and for a short period afterwards as needed for legal, security or accounting purposes. When you delete your account, your personal data is removed; some records may be retained in anonymised or aggregated form, or where we are legally required to keep them.</p>

          <h2 style={S.h2}>Your Rights</h2>
          <p style={S.p}>Under UK data protection law you have the right to access, correct, delete, restrict or object to the processing of your personal data, and to data portability. You can delete your account directly in the app on your profile screen. For any other request, email us at <a href={`mailto:${CONTACT_EMAIL}`} style={{color:C.amber}}>{CONTACT_EMAIL}</a> and we will respond within 30 days.</p>

          <h2 style={S.h2}>Children’s Privacy</h2>
          <p style={S.p}>{COMPANY} is intended for people aged 13 and over. If you are under 18, you may only use the app if a parent or guardian has set it up for you and supervises your use. We do not knowingly collect personal data from children under 13. If you believe a child under 13 has given us personal data, contact us and we will delete it.</p>
          {/* The "no analytics profiles of under-18s" statement is deliberately
              NOT shipped here yet — see PR #6, which wires the minor-detection
              that ENFORCES it (forcing known-minors permanently opted-out so it
              holds even for autocapture, which does not pass through track()).
              A written claim about children's data must not precede its
              enforcement. */}

          <h2 style={S.h2}>Cookies and Analytics</h2>
          <p style={S.p}>We use storage that is strictly necessary for signing you in and keeping the app working. This is always on because the app cannot function without it.</p>
          <p style={S.p}>We also use privacy-first usage analytics (PostHog), hosted in the EU, to understand how the app is used and improve it. <strong style={{color:C.text}}>These analytics are off until you agree.</strong> We ask you once, on first use, and nothing is sent to our analytics processor unless you say yes. You can change your choice at any time using the control below. We do not use advertising cookies, do not sell your data, do not track you across other sites, and never send personal details (such as your name or email) to our analytics processor. Whichever choice you make, the app works exactly the same.</p>
          <p style={S.p}>Separately, and to run and support the service, we keep a minimal operational record of app sessions — which app was opened, on what device, when, and the last screen reached. This contains no message content and no special-category data, is never shared with third parties, and is automatically deleted after 90 days (and immediately when you delete your account). We rely on our legitimate interests for this operational record.</p>

          <AnalyticsConsentControl S={S} />


          <h2 style={S.h2}>Complaints</h2>
          <p style={S.p}>If you are in the UK and you are unhappy with how we have handled your personal data, you can complain to the Information Commissioner’s Office (ICO) at <a href="https://ico.org.uk" style={{color:C.amber}}>ico.org.uk</a>. We would appreciate the chance to address your concerns first.</p>

          <h2 style={S.h2}>Changes to This Policy</h2>
          <p style={S.p}>We may update this Privacy Policy from time to time. If we make material changes we will update the effective date shown above.</p>

          <h2 style={S.h2}>Contact</h2>
          <p style={S.p}>For any privacy question or data request: <a href={`mailto:${CONTACT_EMAIL}`} style={{color:C.amber}}>{CONTACT_EMAIL}</a></p>
        </div>
      )}
    </div>
  );
}
