// Mission-landing story QA:
//   1. dump the story DOM + key classnames to verify chapter 01 renders
//   2. geometry proof: hero is sticky, story overlaps it, z-order correct
//   3. render-loop pause proof via window.__missionGlobeFrames
//   4. responsive/entrance probes at 1440 / 1100 / 375
//   5. screenshots of the story at 1440 / 1100 / 375
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const base = process.env.QA_URL || "http://localhost:5176/";
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "story");
mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1100", width: 1100, height: 900 },
  { name: "375", width: 375, height: 812 },
];

const browser = await chromium.launch();

async function probe(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: "load", timeout: 90000 });
  await page.waitForSelector("#story-section", { timeout: 60000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => document.querySelector(".story-chapter")?.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(1000);
  const entered = await page.evaluate(() =>
    document.querySelector(".story-chapter").classList.contains("story-chapter--visible"),
  );
  const geom = await page.evaluate(() => {
    const hero = document.getElementById("ops-hero");
    const story = document.getElementById("story-section");
    return {
      heroTop: Math.round(hero.getBoundingClientRect().top),
      storyTop: Math.round(story.getBoundingClientRect().top),
      heroPosition: getComputedStyle(hero).position,
    };
  });
  const chapterGrid = await page.evaluate(() => {
    const cols = getComputedStyle(document.querySelector(".story-chapter")).gridTemplateColumns.split(" ");
    return cols.length === 3 ? "3-col" : cols.join(" | ");
  });
  const cardsOverflowX = await page.evaluate(
    () => getComputedStyle(document.querySelector(".story-cards-row")).overflowX,
  );
  const ringLabel = await page.evaluate(
    () => document.querySelector(".story-ring")?.getAttribute("aria-label"),
  );
  console.log(
    `[${width}x${height}] entered=${entered} heroTop=${geom.heroTop} storyTop=${geom.storyTop} heroPosition=${geom.heroPosition} grid=${chapterGrid} cardsOverflowX=${cardsOverflowX} ringLabel="${ringLabel}"${errors.length ? " ERRORS=" + errors.join("|") : ""}`,
  );
  return page;
}

// ---- 1 + 2 + 3 on a single page ----
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base, { waitUntil: "load", timeout: 90000 });
await page.waitForSelector("#story-section", { timeout: 60000 });
await page.waitForTimeout(4000);

const frames = () => page.evaluate(() => (window.__missionGlobeFrames ?? 0));

const dump = await page.evaluate(() => {
  const $ = (s) => document.querySelector(s);
  const story = $("#story-section");
  const hero = $("#ops-hero");
  const sim = $(".story-sim-badge");
  const chapter = $(".story-chapter");
  const cards = [...document.querySelectorAll(".story-metric-card")];
  const rows = [...document.querySelectorAll(".story-condition-row")];
  const ring = $(".story-ring");
  const visual = $(".story-imagery");
  const cta = $(".story-cta");

  const storyTop = story.getBoundingClientRect().top;
  const heroRect = hero.getBoundingClientRect();

  const txt = (el) => el?.textContent?.trim().replace(/\s+/g, " ");
  return {
    hasHeroSticky: hero.className,
    heroHeight: Math.round(heroRect.height),
    heroTopAtLoad: Math.round(heroRect.top),
    storyTopAtLoad: Math.round(storyTop),
    storyStaticClass: story.className,
    simBadge: txt(sim),
    chapterIds: [...document.querySelectorAll(".story-chapter")].map((c) => c.id),
    chapterVisible: chapter.classList.contains("story-chapter--visible"),
    kicker: txt(chapter?.querySelector(".story-kicker")),
    title: txt(chapter?.querySelector(".story-title")),
    numeral: txt(chapter?.querySelector(".story-numeral")),
    body: txt(chapter?.querySelector(".story-body")),
    cardLabels: cards.map((c) => txt(c.querySelector(".story-metric-card__label"))),
    cardValues: cards.map((c) => txt(c.querySelector(".story-metric-card__value"))),
    cardSublabels: cards.map((c) => txt(c.querySelector(".story-metric-card__sublabel"))),
    rings: rings => !!ring,
    panelTitle: txt(document.querySelector(".story-data-panel__title")),
    panelScope: txt(document.querySelector(".story-data-panel__scope")),
    rowLabels: rows.map((r) => txt(r.querySelector(".story-condition-row__label"))),
    rowValues: rows.map((r) => txt(r.querySelector(".story-condition-row__value"))),
    rowAriaLabels: rows.map((r) => r.getAttribute("aria-label")),
    imageryCaption: txt(document.querySelector(".story-imagery__caption")),
    cta: txt(cta),
    storyZ: getComputedStyle(story).zIndex,
    heroZ: getComputedStyle(hero).zIndex,
    mainZ: getComputedStyle(document.querySelector(".m-main")).zIndex,
    anchorPos: getComputedStyle(document.querySelector(".m-story-anchor")).position,
  };
});
console.log("=== MISSION STORY DUMP ===");
console.log(JSON.stringify(dump, null, 2));
console.log("PAGE_ERRORS:", errors.length ? errors.join(" | ") : "none");

// ---- render-loop pause proof ----
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(600);
const a0 = await frames();
await page.waitForTimeout(1200);
const a1 = await frames();

await page.evaluate(() => document.querySelector("#story-section")?.scrollIntoView({ block: "start" }));
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(400);
const b0 = await frames();
await page.waitForTimeout(1200);
const b1 = await frames();

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
const c0 = await frames();
await page.waitForTimeout(1200);
const c1 = await frames();

console.log("=== PAUSE PROOF (mission globe __missionGlobeFrames) ===");
console.log(`top:   ${a0} -> ${a1} (delta ${a1 - a0})`);
console.log(`story: ${b0} -> ${b1} (delta ${b1 - b0})`);
console.log(`back:  ${c0} -> ${c1} (delta ${c1 - c0})`);
await page.close();

// ---- screenshots: scroll story into view enough to capture the chapter, clipped ----
for (const s of sizes) {
  const pg = await probe(s.width, s.height);
  await pg.evaluate(() => {
    const el = document.querySelector(".story-chapter");
    const y = el.getBoundingClientRect().top + window.scrollY - 24;
    window.scrollTo(0, y);
  });
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: `${outDir}/${s.name}.png`, clip: { x: 0, y: 0, width: s.width, height: Math.min(s.height, 900) } });
  console.log(`${s.name}: chapter screenshot written`);
  await pg.close();
}

await browser.close();