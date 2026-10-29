# Admin: staff accounts, sign-in and security

PR 8. **D10 (owner, 29 Oct 2026): Carmen is the owner, and every account (Payfast, Netlify, Supabase, Resend, domain) is in her name.** Developers are invited with the least access they need.

## 1. Roles

| Role | Who | Can |
|---|---|---|
| **owner** | Carmen | Everything, including staff accounts, refunds (PR 7) and the activity log |
| **admin** | Trusted helpers | Products, coupons and orders (PRs 9–10), and the activity log |
| **support** | Customer support | Read orders, resend emails and renew links (PR 10). No catalogue or money changes |

The database enforces these roles (RLS: an `admin_profiles` row **and** a session that completed MFA, `aal2`). Every admin function checks them again before doing anything (`netlify/lib/auth.mts`).

## 2. Carmen's first sign-in

1. **Developer or owner runs** (with the production `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SITE_URL`):

```bash
node scripts/grant-admin.mts --email carmen@… --role owner --name "Carmen"
```

2. **The command prints a one-time link** (valid about an hour). Send it to Carmen privately.
3. **Carmen opens it and chooses a password:** at least 12 characters, with upper- and lower-case letters and a number.
4. **The admin requires an authenticator app** (Google Authenticator, Microsoft Authenticator, 1Password …). She scans the QR code and enters the 6-digit code. **Nothing in the admin is visible before this step.**
5. **From then on:** she signs in at `<shop>/admin/` with her email, password and a code from the app.

The session lives only in that browser tab and ends after **30 minutes without activity**. Each sign-in is recorded in the activity log.

## 3. Day-to-day staff management (owner)

| Task | Command |
|---|---|
| Add staff | `node scripts/grant-admin.mts --email … --role admin` (or `support`), plus `--name "…"`. Prints their one-time link |
| Change a role | Run the same command with the new role |
| Forgotten password or lost phone | `node scripts/grant-admin.mts --email … --reset`: removes the authenticator and prints a new link |
| Remove someone | `node scripts/grant-admin.mts --email … --revoke`: access ends **immediately** and the account can't sign in |

There is no sign-up page and no way to grant yourself a role (tested). Every change above is written to the audit log.

## 4. Production settings (Supabase dashboard, at go-live, PR 13)

- **Authentication → URL Configuration:**
  - *Site URL* = the shop's origin;
  - *Redirect URLs* include `https://<shop>/admin/`.
- **Authentication → Sign In / Providers:**
  - email provider **on**;
  - **"Allow new users to sign up" off**;
  - minimum password length 12, with lower, upper and digits (matches `supabase/config.toml`).
- **Authentication → Multi-Factor:** TOTP **enabled**.
- **Netlify environment:** `SUPABASE_ANON_KEY` (public) is also given to functions; the admin uses it as the API key when it queries with a staff token.

## 5. Security model (for reviewers)

- **Every admin request** carries the staff member's access token. The server:
  1. asks Supabase Auth to validate it (signature, expiry and a live session), so forged, tampered, expired and signed-out tokens are rejected;
  2. requires `aal2`;
  3. reads the role fresh from `admin_profiles`.

  Data queries then run **with the staff token**, so RLS applies a second time.
- **The admin page is static** (`/admin/`) and served with a strict CSP (generated per environment into `_headers`):
  - `default-src 'none'; script-src 'self'; connect-src 'self' <supabase>`;
  - `frame-ancestors 'none'`;
  - `noindex`;
  - `no-store`.

  It never uses `innerHTML`: everything from the server is set as text.
- **Admin actions that aren't row changes** (sign-ins, grants, revocations, MFA resets) are recorded through `record_admin_action()`. Row changes are recorded by the audit triggers. The log is append-only, even for the database owner.
