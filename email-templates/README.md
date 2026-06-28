# Auth email templates

Source-of-truth copies of the Supabase auth email templates for In or Out. The live
versions live in the **Supabase dashboard** (Authentication → Emails → Templates); keep
these in sync so the design is version-controlled.

| File | Supabase template | Who gets it |
|------|-------------------|-------------|
| `confirm-signup.html` | **Confirm signup** | brand-new email users (first sign-up) |
| `magic-link.html` | **Magic Link** | returning email users (sign-in OTP) |

## Rules (don't break these)

- **Code-only — never re-add the `{{ .ConfirmationURL }}` magic-link button.** That link
  points at `/auth/callback`, which is **not** an AASA universal-link path (only `/p`,
  `/admin`, `/m` are), so inside the native iOS wrapper it opens in **Safari** — the
  session lands there and the app stays logged out. The `{{ .Token }}` code works on web
  AND native, so it is the only call-to-action. (This is the bug fixed across SignIn /
  EmailCaptureOverlay / JoinTeam in session — see `APP_STORE_REJECTION_HANDOFF.md`.)
- **`{{ .Token }}` is mandatory in both.** The Supabase *default* Confirm-signup template
  ships with only a link and no code — paste ours so new users actually get a code.
- The in-app code input tolerates **6–10 digits** (the OTP is currently 8), so the copy
  never hard-codes a digit count.

## Sender / SMTP

Custom SMTP via **Resend** (separate In-or-Out Resend account, `in-or-out.com` verified):
host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key, sender
`noreply@in-or-out.com`, sender name `In or Out`.

## Subjects

- Confirm signup: `Welcome to In or Out — your code inside`
- Magic Link: `Your In or Out sign-in code`
