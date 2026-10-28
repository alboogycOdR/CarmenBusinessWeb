"use strict";
/* Repository guard rails (PR 0). These keep the supply chain pinned and
 * secrets out of git, and keep process docs complete. They fail CI when a
 * convention is broken, so the convention does not depend on reviewers noticing. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

test(".env.example documents variables without leaking values", () => {
  const vars = read(".env.example").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l));
  assert.ok(vars.length >= 10, "expected the documented variable list");
  for (const line of vars) {
    const [key, value] = [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)];
    if (/KEY|SECRET|TOKEN|PASSWORD|HOOK/.test(key)) assert.strictEqual(value, "", `${key} must be blank in .env.example`);
    else assert.ok(value === "" || /^\d+$/.test(value), `${key} may only carry a numeric default`);
  }
});

test("env files are ignored but the example is tracked", () => {
  const ignored = (f) => { try { git("check-ignore", "-q", f); return true; } catch { return false; } };
  assert.ok(ignored(".env"), ".env must be git-ignored");
  assert.ok(ignored(".env.production"), ".env.* must be git-ignored");
  assert.ok(!ignored(".env.example"), ".env.example must stay tracked");
  assert.ok(ignored("node_modules/x"), "node_modules must be git-ignored");
  const tracked = git("ls-files").split("\n").filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"));
  assert.deepStrictEqual(tracked, [], "no env files may be committed");
});

test("dependencies are pinned and Node versions agree", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version, got ${v}`);
  }
  assert.ok(fs.existsSync(path.join(root, "package-lock.json")), "lockfile must be committed");
  const nvm = read(".nvmrc").trim();
  assert.match(pkg.engines.node, new RegExp(`>=${nvm}\\.`), "engines.node must match .nvmrc major");
});

test("CI workflow pins actions to commit SHAs and runs every gate", () => {
  const ci = read(".github/workflows/ci.yml");
  const uses = [...ci.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `action not pinned to a SHA: ${u}`);
  for (const step of ["npm run typecheck", "npm test", "npm run test:e2e", "npm audit", "gitleaks git", "npm run db:start", "npm run test:db", "git diff --exit-code -- types/database.ts"]) {
    assert.ok(ci.includes(step), `CI is missing: ${step}`);
  }
  assert.match(ci, /GITLEAKS_SHA256: [0-9a-f]{64}/, "gitleaks download must be checksum-verified");
  assert.match(ci, /sha256sum -c/, "checksum must be enforced");
  assert.match(ci, /permissions:\s*\n\s*contents: read/, "workflow token must be read-only");
  assert.match(ci, /fetch-depth: 0/, "secret scan must see full history");
});

test("PR template carries the sections the spec requires", () => {
  const t = read(".github/pull_request_template.md");
  for (const h of ["## Scope", "## Out of scope", "## Decisions / assumptions", "## Acceptance evidence", "## Screenshots", "## Migration and rollback", "## Security checklist", "## Reviewer checklist"]) {
    assert.ok(t.includes(h), `missing section ${h}`);
  }
});

test("ADR index lists every ADR", () => {
  const dir = path.join(root, "docs/adr");
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-.+\.md$/.test(f));
  const index = read("docs/adr/README.md");
  assert.ok(files.length >= 8);
  for (const f of files) {
    assert.ok(index.includes(`(${f})`), `ADR index missing ${f}`);
    assert.match(fs.readFileSync(path.join(dir, f), "utf8"), /## Context[\s\S]+## Decision[\s\S]+## Consequences/, `${f} structure`);
  }
});
