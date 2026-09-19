import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const base = process.env.QA_URL || "http://localhost:5173/dashboard";
const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "load", timeout: 90000 });
await page.waitForSelector("#story-section", { timeout: 60000 });
await page.waitForTimeout(4000);

await page.addScriptTag({ content: axeSource });
const topResults = await page.evaluate(async () => {
  const r = await window.axe.run(document, { resultTypes: ["violations"] });
  return r.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    help: v.help,
    targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
  }));
});

console.log("=== AXE: at top of page ===");
const full = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations);
for (const v of full) {
  console.log(`[${v.impact}] ${v.id} (${v.nodes.length} nodes) — ${v.help}`);
  for (const n of v.nodes) console.log(`    at ${n.target.join(" ")} :: ${JSON.stringify(n.html.slice(0, 90))}`);
}
if (full.length === 0) console.log("no violations");

// Story-scoped: only nodes inside #story-section
const storyScoped = await page.evaluate(async () => {
  const r = await window.axe.run(document.querySelector("#story-section"), {
    runOnly: ["color-contrast", "aria-hidden-focus", "aria-valid-attr-value", "image-alt", "label", "landmark-one-main", "region"],
  });
  return r.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 8).map((n) => n.target.join(" ")),
  }));
});
console.log("=== AXE: story-scoped ===");
for (const v of storyScoped) {
  console.log(`[${v.impact}] ${v.id} (${v.nodes} nodes)`);
  for (const t of v.targets) console.log(`    at ${t}`);
}
if (storyScoped.length === 0) console.log("no violations");

// Scroll through the chapter — story-specific checks
await page.evaluate(() => document.querySelector("#story-section")?.scrollIntoView({ block: "start" }));
await page.waitForTimeout(300);
await page.addScriptTag({ content: axeSource });
const storyResults = await page.evaluate(async () => {
  const r = await window.axe.run(document, { resultTypes: ["violations"] });
  return r.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
  }));
});
console.log("=== AXE: at story ===");
for (const v of storyResults) console.log(`[${v.impact}] ${v.id} (${v.nodes} nodes)`);

await browser.close();