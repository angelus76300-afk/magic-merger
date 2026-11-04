// The API's growth, the part the Worker cannot do (3.4.2, worker/evolve.ts).
//
// 1. Helpers the designer wrote are trials until their example program passes
//    the test run (src/sim/check.ts, with the promise of the spells that
//    lacked it). Spell code cannot run in a Cloudflare Worker, so it runs here,
//    in Node, and the verdict goes back to /api/admin/helper-check.
// 2. Engine proposals (the simulation itself must change) become GitHub
//    issues labelled api-gap, for a developer to review, once each.
//
//   npm run evolve        with MM_URL and MM_TOKEN (the ADMIN_TOKEN) set;
//                         GITHUB_TOKEN and GITHUB_REPOSITORY to open issues.
//
// Also a step of the daily "Judge" GitHub workflow. Costs nothing: no Claude call.
import { runCheck } from "../src/sim/check";
import type { Tier } from "../shared/tiers";
import { adminApi } from "./admin-api";

const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!url || !token) {
  console.error("Set MM_URL (the game's address) and MM_TOKEN (its ADMIN_TOKEN).");
  process.exit(1);
}

const api = adminApi(url, token!);

// 1. Helpers.
const helpers = await api<{ id: number; name: string; code: string; intents: string[] }[]>("/api/admin/helpers");
console.log(`${helpers.length} helpers to test`);
for (const h of helpers) {
  // Tested at two reaches: a helper has to work for a house and for a valley.
  const tiers: Tier[] = ["minor", "grand"];
  const results = tiers.map((tier) => ({ tier, r: runCheck({ key: `helper:${h.name}`, name: h.name, tier, code: h.code, intents: h.intents }) }));
  const failed = results.find((x) => !x.r.ok);
  const detail = failed ? `${failed.tier}: ${failed.r.detail}` : results.map((x) => `${x.tier}: ${x.r.detail}`).join(" ");
  const { status } = await api<{ status: string }>("/api/admin/helper-check", { id: h.id, ok: !failed, detail });
  console.log(`lib.${h.name} (#${h.id}): ${status}. ${detail}`);
}

// 2. Engine proposals.
interface Proposal {
  id: number;
  name: string;
  signature: string;
  doc: string;
  spec: string;
  issue: string | null;
}
const proposals = (await api<Proposal[]>("/api/admin/proposals")).filter((p) => !p.issue);
const gh = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
console.log(`${proposals.length} engine proposals without an issue`);
for (const p of proposals) {
  if (!gh || !repo) {
    console.log(`#${p.id} ${p.name}: ${p.spec}`);
    continue;
  }
  const body = [
    `Spells kept lacking an ability that the World API cannot give with a helper, so the designer proposes a change to the simulation.`,
    ``,
    `**Proposed call:** \`${p.signature || p.name}\``,
    ``,
    p.spec,
    ``,
    `Extension #${p.id}. The spells that lacked it are listed by \`GET /api/admin/evolution\`. When it ships, close it with \`POST /api/admin/extension {"id": ${p.id}, "status": "done"}\`.`,
  ].join("\n");
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${gh}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify({ title: `API proposal: ${p.name}`, body, labels: ["api-gap"] }),
  });
  const issue = (await res.json().catch(() => null)) as { html_url?: string } | null;
  if (!res.ok || !issue?.html_url) {
    console.error(`#${p.id} ${p.name}: the issue could not be opened (${res.status})`);
    continue;
  }
  await api("/api/admin/extension", { id: p.id, issue: issue.html_url });
  console.log(`#${p.id} ${p.name}: ${issue.html_url}`);
}
