// Story-section QA script:
//   1. full-page screenshots of the hero + story at 1440 / 1100 / 375
//   2. render-loop pause proof at 1440 — the DEV frame counter
//      (window.__globeFrames) must advance near the top of the page, freeze
//      while the story covers the globe, and advance again after scrolling up.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const base = process.env.QA_URL || "http://localhost:5173/dashboard";
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "story");
mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1100", width: 1100, height: 900 },
  { name: "375", width: 375, height: 812 },
];

const browser = await chromium.launch();
const frames = () => page.evaluate(() => (window.__globeFrames ?? 0));

for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: "load", timeout: 90000 });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForSelector("#story-section", { timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${outDir}/${s.name}.png`, fullPage: true });
  console.log(`${s.name}: png written${errors.length ? " PAGE_ERRORS=" + errors.join(" | ") : ""}`);
  await page.close();
}

// ---- render-loop pause proof ----
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "load", timeout: 90000 });
await page.waitForSelector("#story-section", { timeout: 60000 });
await page.waitForTimeout(3000);

const a0 = await frames();
await page.waitForTimeout(1200);
const a1 = await frames();

await page.evaluate(() => document.querySelector("#story-section")?.scrollIntoView({ block: "start" }));
// Scroll deeper into the chapter so the story's top edge passes the hero's
// top — the moment the globe is fully covered and the loop must pause.
await page.evaluate(() => window.scrollBy(0, 600));
await page.waitForTimeout(350);
const b0 = await frames();
await page.waitForTimeout(1200);
const b1 = await frames();

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
const c0 = await frames();
await page.waitForTimeout(1200);
const c1 = await frames();

console.log(`[pause proof] top:  ${a0} -> ${a1} (delta ${a1 - a0})`);
console.log(`[pause proof] story: ${b0} -> ${b1} (delta ${b1 - b0})`);
console.log(`[pause proof] back:  ${c0} -> ${c1} (delta ${c1 - c0})`);

await browser.close();