/*
 * Daily progress report for the owner: progress/progress.json → PDF.
 *
 *   node progress/report.mjs [output.pdf]
 *
 * Renders an A4 HTML report with Playwright's Chromium (already installed for
 * the e2e tests) and prints it to PDF. Update progress.json, then run this.
 * Default output: progress/out/CarmenBusinessWeb-progress-<asOf>.pdf
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../package.json"));
const { chromium } = require("playwright");

const P = JSON.parse(fs.readFileSync(path.join(here, "progress.json"), "utf8"));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

const mods = P.modules;
const done = mods.filter((m) => m.status === "done");
const left = mods.filter((m) => m.status !== "done");
const sum = (a) => a.reduce((n, m) => n + m.days, 0);
const pctDays = Math.round((sum(done) / sum(mods)) * 100);
const pctCount = Math.round((done.length / mods.length) * 100);
const ghLinks = (ns) => (ns ?? []).map((n) => `<a href="https://github.com/${P.repo}/pull/${n}">#${n}</a>`).join(", ");
const BADGE = { done: ["Done", "ok"], "code-done": ["Code done", "part"], "in-progress": ["In progress", "part"], "not-started": ["Not started", "todo"], remaining: ["Remaining", "todo"] };
const badge = (s) => `<span class="badge ${BADGE[s][1]}">${BADGE[s][0]}</span>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(P.project)} progress ${esc(P.asOf)}</title><style>
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
:root { --ink:#1f1f1f; --muted:#666; --line:#e4e4e4; --brand:#e50069; --tile:#f6f6f6; --ok:#1b7f3b; --part:#b26a00; }
* { box-sizing: border-box; }
body { font: 10pt/1.5 "Helvetica Neue", Arial, sans-serif; color: var(--ink); margin: 0; }
h1 { font: 500 24pt/1.15 Georgia, serif; margin: 0 0 4pt; }
h2 { font: 500 14pt/1.2 Georgia, serif; margin: 18pt 0 8pt; padding-bottom: 4pt; border-bottom: 2px solid var(--ink); break-after: avoid; }
p { margin: 0 0 6pt; }
.muted { color: var(--muted); }
.cover { border-bottom: 3px solid var(--brand); padding-bottom: 10pt; margin-bottom: 12pt; }
.kicker { color: var(--brand); text-transform: uppercase; letter-spacing: .1em; font-size: 8pt; font-weight: 700; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin: 10pt 0; }
.stat { background: var(--tile); border-radius: 4pt; padding: 8pt 10pt; }
.stat b { display: block; font: 600 18pt/1.1 Georgia, serif; }
.stat span { font-size: 8pt; color: var(--muted); }
.bar { height: 10pt; background: var(--line); border-radius: 5pt; overflow: hidden; margin: 6pt 0 2pt; }
.bar i { display: block; height: 100%; background: var(--brand); }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th, td { text-align: left; vertical-align: top; padding: 5pt 6pt; border-bottom: 1px solid var(--line); }
th { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
tr { break-inside: avoid; }
td.num { white-space: nowrap; }
.badge { display: inline-block; font-size: 7.5pt; font-weight: 700; padding: 1pt 6pt; border-radius: 8pt; white-space: nowrap; }
.badge.ok { background: #e3f3e8; color: var(--ok); }
.badge.part { background: #fdf0dc; color: var(--part); }
.badge.todo { background: #f0f0f0; color: #555; }
ul { margin: 0 0 6pt 14pt; padding: 0; } li { margin: 0 0 3pt; }
a { color: var(--ink); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }
.foot { margin-top: 16pt; font-size: 8pt; color: var(--muted); border-top: 1px solid var(--line); padding-top: 6pt; }
</style></head><body>
<section class="cover">
  <div class="kicker">Progress report #${esc(P.reportNumber)} · ${esc(day(P.asOf))}</div>
  <h1>${esc(P.project)}</h1>
  <p class="muted">${esc(P.subtitle)}</p>
</section>

<p>${esc(P.headline)}</p>
<div class="grid">
  <div class="stat"><b>${pctDays}%</b><span>of planned work done (by estimate: ${sum(done)} of ${sum(mods)} dev-days)</span></div>
  <div class="stat"><b>${done.length} / ${mods.length}</b><span>modules complete and merged</span></div>
  <div class="stat"><b>${P.milestones.filter((m) => m.status === "done").length} / ${P.milestones.length}</b><span>milestones done (M3 code-complete)</span></div>
  <div class="stat"><b>${P.decisions.open.length}</b><span>decisions waiting on the owner</span></div>
</div>
<div class="bar"><i style="width:${pctDays}%"></i></div>
<p class="muted" style="font-size:8pt">Remaining estimate: about ${sum(left)} dev-days (+20% contingency ≈ ${Math.round(sum(left) * 1.2)}), plus time waiting for content, accounts and decisions. By module count: ${pctCount}%.</p>
${P.changesSinceLast.length ? `<h2>Since the last report</h2><ul>${P.changesSinceLast.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}

<h2>Milestones</h2>
<table><thead><tr><th>#</th><th>Milestone</th><th>Status</th><th>Where it stands</th></tr></thead><tbody>
${P.milestones.map((m) => `<tr><td>${esc(m.id)}</td><td><b>${esc(m.name)}</b></td><td>${badge(m.status)}</td><td>${esc(m.detail)}</td></tr>`).join("")}
</tbody></table>

<h2>Completed modules (${done.length})</h2>
<table><thead><tr><th>PR</th><th>Module</th><th>Merged</th><th>GitHub</th><th>What it delivers</th></tr></thead><tbody>
${done.map((m) => `<tr><td>${esc(m.pr)}</td><td><b>${esc(m.name)}</b></td><td class="num">${esc(day(m.merged))}</td><td class="num">${ghLinks(m.github)}</td><td>${esc(m.delivered)}</td></tr>`).join("")}
</tbody></table>

<h2>Remaining modules (${left.length})</h2>
<table><thead><tr><th>PR</th><th>Module</th><th>Est.</th><th>What it will deliver</th><th>Waiting on</th></tr></thead><tbody>
${left.map((m) => `<tr><td>${esc(m.pr)}</td><td><b>${esc(m.name)}</b><br>${badge(m.status)}</td><td class="num">${m.days} days</td><td>${esc(m.scope)}</td><td>${esc(m.needs)}</td></tr>`).join("")}
</tbody></table>

<h2>Decisions</h2>
<div class="two">
<div><p><b>Waiting on the owner (${P.decisions.open.length})</b></p>
<table><thead><tr><th>#</th><th>Decision</th><th>Unblocks</th></tr></thead><tbody>
${P.decisions.open.map(([id, what, blocks]) => `<tr><td>${esc(id)}</td><td>${esc(what)}</td><td>${esc(blocks)}</td></tr>`).join("")}
</tbody></table></div>
<div><p><b>Already decided (${P.decisions.made.length})</b></p>
<table><thead><tr><th>#</th><th>Decision</th></tr></thead><tbody>
${P.decisions.made.map(([id, what]) => `<tr><td>${esc(id)}</td><td>${esc(what)}</td></tr>`).join("")}
</tbody></table></div>
</div>

<h2>Owner actions</h2>
<ul>${P.ownerActions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>

<div class="two">
<div><h2>Quality</h2>
<table><tbody>${P.quality.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num"><b>${esc(v)}</b></td></tr>`).join("")}</tbody></table>
<p class="muted" style="font-size:8pt;margin-top:4pt">Every module is merged only after all automated checks pass on GitHub.</p></div>
<div><h2>Notes</h2><ul>${P.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>
</div>

<p class="foot">Source: github.com/${esc(P.repo)} (branch main) and docs/02-implementation-backlog.md. Estimates are the plan's development-day estimates; percentages measure planned work, not calendar time.</p>
</body></html>`;

const out = path.resolve(process.argv[2] ?? path.join(here, "out", `CarmenBusinessWeb-progress-${P.asOf}.pdf`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out.replace(/\.pdf$/, ".html"), html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: out, format: "A4", printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate: `<div style="font:8px Arial;color:#888;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>${esc(P.project)} · progress report #${esc(P.reportNumber)} · ${esc(day(P.asOf))}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
});
await browser.close();
console.log(out);
