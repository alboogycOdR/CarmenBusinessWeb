/*
 * Carmen admin (PR 8): sign-in, mandatory authenticator (TOTP) and the staff
 * dashboard. Plain JavaScript against Supabase Auth's REST API; no framework,
 * no third-party code (CSP: script-src 'self').
 *
 * Security model (spec §4.3):
 *  - nothing from the admin API is requested or shown below aal2 (MFA done);
 *  - every admin request carries the staff token; the server re-checks the
 *    session, aal2 and the role (netlify/lib/auth.mts) and the database
 *    enforces the same again (RLS);
 *  - the session lives in sessionStorage (this tab only) and ends after
 *    30 minutes without activity;
 *  - all text is set with textContent: nothing from the server becomes markup.
 */
(function () {
  "use strict";

  const CFG = window.ADMIN_CONFIG || {};
  const AUTH = (CFG.supabaseUrl || "") + "/auth/v1";
  const KEY = "cw_admin_session";
  const IDLE_MS = 30 * 60 * 1000;
  const app = document.getElementById("app");
  const who = document.getElementById("who");

  /* ---------- tiny DOM helper (text only) ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  function show(...nodes) { app.replaceChildren(...nodes); const f = app.querySelector("input, button"); if (f) f.focus(); }

  /* ---------- session ---------- */
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { session = null; }
  function save(s) {
    session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) } : null;
    try { if (session) sessionStorage.setItem(KEY, JSON.stringify(session)); else sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked: memory only */ }
  }
  function claims(token) {
    try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return {}; }
  }

  async function auth(path, opts) {
    const o = opts || {};
    const headers = { apikey: CFG.anonKey, "Content-Type": "application/json" };
    if (o.token) headers.Authorization = "Bearer " + o.token;
    const res = await fetch(AUTH + path, { method: o.method || "GET", headers, body: o.body ? JSON.stringify(o.body) : undefined });
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      const err = new Error((body && (body.msg || body.message || body.error_description || body.error)) || "HTTP " + res.status);
      err.status = res.status;
      err.code = body && (body.error_code || body.code);
      throw err;
    }
    return body;
  }

  async function freshToken() {
    if (!session) return null;
    if (session.expires_at - Date.now() / 1000 > 60) return session.access_token;
    try {
      save(await auth("/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } }));
      return session.access_token;
    } catch (e) {
      save(null);
      return null;
    }
  }

  async function api(path, opts) {
    const token = await freshToken();
    if (!token) { signedOut("Your session ended. Please sign in again."); throw new Error("signed out"); }
    const o = opts || {};
    const res = await fetch(path, { method: o.method || "GET", headers: { Authorization: "Bearer " + token, Accept: "application/json" }, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { save(null); signedOut("Your session ended. Please sign in again."); throw new Error("401"); }
    if (!res.ok) { const err = new Error(body.error || "HTTP " + res.status); err.status = res.status; err.code = body.error; throw err; }
    return body;
  }

  /* ---------- idle sign-out ---------- */
  let idleTimer = null;
  function touch() {
    clearTimeout(idleTimer);
    if (session) idleTimer = setTimeout(() => signOut("You were signed out after 30 minutes without activity."), IDLE_MS);
  }
  ["click", "keydown", "pointermove"].forEach((ev) => document.addEventListener(ev, touch, { passive: true }));

  async function signOut(message) {
    const token = session && session.access_token;
    save(null);
    who.hidden = true;
    who.replaceChildren();
    if (token) { try { await auth("/logout?scope=local", { method: "POST", token }); } catch (e) { /* already ended */ } }
    signedOut(message || "You are signed out.");
  }

  /* ---------- screens ---------- */
  function errorLine() { return h("p", { class: "error", role: "alert" }); }

  function busy(form, on) { form.querySelectorAll("button, input").forEach((el) => { el.disabled = on; }); }

  function signedOut(message) { loginScreen(message); }

  function loginScreen(message) {
    const err = errorLine();
    const form = h("form", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      busy(form, true);
      try {
        save(await auth("/token?grant_type=password", { method: "POST", body: { email: form.email.value.trim(), password: form.password.value } }));
        touch();
        await afterPassword();
      } catch (ex) {
        busy(form, false);
        err.textContent = ex.status === 400 ? "Email or password is incorrect." : ex.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Sign-in failed. Please try again.";
      }
    } },
      h("label", { for: "email" }, "Email"),
      h("input", { id: "email", name: "email", type: "email", autocomplete: "username", required: true }),
      h("label", { for: "password" }, "Password"),
      h("input", { id: "password", name: "password", type: "password", autocomplete: "current-password", required: true }),
      h("button", { type: "submit" }, "Sign in"),
      err);
    show(h("section", { class: "card" }, h("h1", {}, "Sign in"), message ? h("p", { class: "muted" }, message) : null, form,
      h("p", { class: "muted small" }, "Staff accounts are created by the shop owner. Forgotten your password or lost your phone? Ask the owner for a new sign-in link.")));
  }

  function setPasswordScreen(token) {
    const err = errorLine();
    const form = h("form", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      const pw = form.pw.value;
      if (pw !== form.pw2.value) { err.textContent = "The passwords don't match."; return; }
      if (pw.length < 12 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) { err.textContent = "Use at least 12 characters, with upper- and lower-case letters and a number."; return; }
      busy(form, true);
      try {
        await auth("/user", { method: "PUT", token, body: { password: pw } });
        await afterPassword();
      } catch (ex) {
        busy(form, false);
        err.textContent = ex.code === "weak_password" ? "That password is too weak. Please choose another." : "Couldn't save the password. The link may have expired; ask the owner for a new one.";
      }
    } },
      h("label", { for: "pw" }, "New password"),
      h("input", { id: "pw", name: "pw", type: "password", autocomplete: "new-password", required: true, minlength: "12" }),
      h("label", { for: "pw2" }, "Repeat it"),
      h("input", { id: "pw2", name: "pw2", type: "password", autocomplete: "new-password", required: true }),
      h("button", { type: "submit" }, "Save password"),
      err);
    show(h("section", { class: "card" }, h("h1", {}, "Choose your password"),
      h("p", { class: "muted" }, "At least 12 characters, with upper- and lower-case letters and a number. Next you'll set up an authenticator app."), form));
  }

  /* After a password sign-in (aal1): enrol or challenge TOTP. */
  async function afterPassword() {
    const user = await auth("/user", { token: session.access_token });
    const verified = (user.factors || []).find((f) => f.factor_type === "totp" && f.status === "verified");
    if (verified) return challengeScreen(verified.id);
    // Remove half-finished enrolments so a new QR code can be issued.
    for (const f of user.factors || []) {
      if (f.status !== "verified") { try { await auth("/factors/" + f.id, { method: "DELETE", token: session.access_token }); } catch (e) { /* ignore */ } }
    }
    const enrol = await auth("/factors", { method: "POST", token: session.access_token, body: { factor_type: "totp", friendly_name: "Authenticator " + new Date().toISOString().slice(0, 16) } });
    enrolScreen(enrol);
  }

  function codeForm(factorId, label, onDone) {
    const err = errorLine();
    const form = h("form", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      const code = form.code.value.replace(/\s/g, "");
      if (!/^\d{6}$/.test(code)) { err.textContent = "Enter the 6-digit code from your authenticator app."; return; }
      busy(form, true);
      try {
        const ch = await auth("/factors/" + factorId + "/challenge", { method: "POST", token: session.access_token, body: {} });
        save(await auth("/factors/" + factorId + "/verify", { method: "POST", token: session.access_token, body: { challenge_id: ch.id, code } }));
        touch();
        await onDone();
      } catch (ex) {
        busy(form, false);
        form.code.value = "";
        form.code.focus();
        err.textContent = ex.status === 429 ? "Too many attempts. Please wait a minute." : "That code didn't work. Check your phone's clock and try the newest code.";
      }
    } },
      h("label", { for: "code" }, label),
      h("input", { id: "code", name: "code", class: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", required: true }),
      h("button", { type: "submit" }, "Verify"),
      err);
    return form;
  }

  function enrolScreen(enrol) {
    const qr = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(enrol.totp.qr_code);
    show(h("section", { class: "card" },
      h("h1", {}, "Set up your authenticator"),
      h("p", {}, "Admin access needs a second step every time you sign in. Use an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password."),
      h("ol", { class: "steps" },
        h("li", {}, "Open the app and add an account."),
        h("li", {}, "Scan this QR code, or type the key below."),
        h("li", {}, "Enter the 6-digit code the app shows.")),
      h("img", { class: "qr", src: qr, alt: "QR code for your authenticator app", width: "200", height: "200" }),
      h("p", { class: "secret", "aria-label": "Setup key" }, enrol.totp.secret.replace(/(.{4})/g, "$1 ").trim()),
      codeForm(enrol.id, "6-digit code", enterAdmin)));
  }

  function challengeScreen(factorId) {
    show(h("section", { class: "card" }, h("h1", {}, "Two-step check"),
      h("p", { class: "muted" }, "Open your authenticator app and enter the current code."),
      codeForm(factorId, "6-digit code", enterAdmin),
      h("p", { class: "small" }, h("button", { type: "button", class: "link", onclick: () => signOut() }, "Use a different account"))));
  }

  /* aal2 reached: register the sign-in, then the dashboard. */
  async function enterAdmin() {
    let me;
    try {
      me = await api("/api/admin/session", { method: "POST" });
    } catch (ex) {
      if (ex.code === "not_staff" || ex.code === "forbidden") {
        const token = session && session.access_token;
        save(null);
        if (token) { try { await auth("/logout?scope=local", { method: "POST", token }); } catch (e) { /* ignore */ } }
        return show(h("section", { class: "card" }, h("h1", {}, "No admin access"), h("p", {}, "This account isn't a staff account. Ask the shop owner if you need access."),
          h("button", { type: "button", onclick: () => loginScreen() }, "Back to sign in")));
      }
      if (ex.code === "mfa_required") return afterPassword();
      throw ex;
    }
    who.hidden = false;
    who.replaceChildren(h("span", {}, me.displayName || me.email), h("span", { class: "pill role" }, me.role),
      h("button", { type: "button", class: "link", onclick: () => signOut() }, "Sign out"));
    dashboard(me);
  }

  function dashboard(me) {
    const can = (roles) => roles.includes(me.role);
    const activity = h("div", {}, h("p", { class: "muted" }, "Loading recent activity…"));
    show(
      h("h1", {}, "Welcome, " + (me.displayName || me.email)),
      h("p", { class: "muted" }, "Signed in with your authenticator · role: " + me.role + (me.role === "support" ? " (read-only)" : "")),
      h("div", { class: "grid" },
        h("div", { class: "tile" }, h("h3", {}, "Products"), h("p", { class: "muted small" }, "Managing products, files and coupons arrives with the next admin update.")),
        h("div", { class: "tile" }, h("h3", {}, "Orders"), h("p", { class: "muted small" }, "Searching orders, resending emails and renewing links arrives with the next admin update."))),
      can(["owner", "admin"]) ? h("section", {}, h("h2", {}, "Recent activity"), activity) : null);
    if (!can(["owner", "admin"])) return;
    api("/api/admin/audit?limit=25").then((r) => {
      if (!r.entries.length) return activity.replaceChildren(h("p", { class: "muted" }, "No activity yet."));
      activity.replaceChildren(h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Who"), h("th", {}, "What"))),
        h("tbody", {}, r.entries.map((e) => h("tr", {},
          h("td", {}, new Date(e.at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" })),
          h("td", {}, e.who), h("td", {}, e.label || e.what))))));
    }).catch(() => activity.replaceChildren(h("p", { class: "error" }, "Couldn't load recent activity.")));
  }

  /* ---------- boot ---------- */
  async function boot() {
    if (!CFG.supabaseUrl || !CFG.anonKey) return show(h("section", { class: "card" }, h("h1", {}, "Admin unavailable"), h("p", {}, "The admin isn't configured for this site yet.")));
    // A password link from the owner lands here with the session in the URL fragment.
    const frag = new URLSearchParams(location.hash.slice(1));
    if (frag.get("error_code") || frag.get("error")) {
      history.replaceState(null, "", location.pathname);
      return loginScreen(frag.get("error_code") === "otp_expired" ? "That sign-in link has expired. Ask the owner for a new one." : "That sign-in link didn't work. Ask the owner for a new one.");
    }
    if (frag.get("type") === "recovery" && frag.get("access_token")) {
      history.replaceState(null, "", location.pathname); // keep tokens out of history
      save({ access_token: frag.get("access_token"), refresh_token: frag.get("refresh_token"), expires_in: Number(frag.get("expires_in")) || 3600 });
      touch();
      return setPasswordScreen(session.access_token);
    }
    if (!session) return loginScreen();
    const token = await freshToken();
    if (!token) return loginScreen("Your session ended. Please sign in again.");
    touch();
    try {
      if (claims(token).aal === "aal2") await enterAdmin();
      else await afterPassword();
    } catch (e) {
      save(null);
      loginScreen("Please sign in again.");
    }
  }

  boot();
})();
