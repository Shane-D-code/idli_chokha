// Section 03 — HazardsPage QA + screenshots
// Probes the rebuilt impact workspace: map primary + intel rail, outlook
// cards, ranked exposure, surge-unavailable state, and the district drawer.
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const base = process.env.QA_URL || "http://localhost:5176/";
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "sec03");
mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1024", width: 1024, height: 768 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
];

const browser = await chromium.launch();
const errors = [];

async function snapshot(width, height, capture = true) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(base + "hazards", { waitUntil: "load", timeout: 90000 });
  await page.waitForSelector(".hz-workspace", { timeout: 60000 });
  await page.waitForTimeout(3500);

  const probe = await page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    const ws = $(".hz-workspace");
    const grid = ws ? getComputedStyle(ws).gridTemplateColumns.split(" ").length : 0;
    const mapWrap = $(".hz-map-wrap");
    const intel = $(".hz-intel");
    const mapBox = $(".hz-map-wrap .map-box");
    const canvas = $(".hz-map-wrap canvas");
    const isStacked = ws && getComputedStyle(ws).gridTemplateColumns === "1fr";
    let activeToggles = 0;
    let totalOptions = 0;
    if (typeof window === "object" && window.document) {
      document.querySelectorAll(".layer-item").forEach((el) => {
        totalOptions++;
        if (!el.classList.contains("disabled")) activeToggles++;
      });
    }
    return {
      gridCols: grid,
      stacked: grid === 1,
      mapWrapWidth: mapWrap ? Math.round(mapWrap.getBoundingClientRect().width) : 0,
      intelWidth: intel ? Math.round(intel.getBoundingClientRect().width) : 0,
      mapHeight: mapBox ? Math.round(mapBox.getBoundingClientRect().height) : 0,
      hasCanvas: !!canvas,
      canvasWidth: canvas ? canvas.width : 0,
      summaryRows: document.querySelectorAll(".hz-sum__row").length,
      topRows: document.querySelectorAll(".hz-top-row").length,
      impactCards: document.querySelectorAll(".m-impact-card").length,
      unavailable: document.querySelectorAll(".m-impact-card--unavail").length,
      surgeUnavail: [...document.querySelectorAll(".hz-sum__unavail")].some((e) =>
        /MODEL UNAVAILABLE/.test(e.textContent),
      ),
      windZones: document.querySelectorAll(".hz-wind__zone").length,
      legendChips: document.querySelectorAll(".hz-legend__chip").length,
      drawer: !!document.querySelector(".hz-drawer"),
      totalOptions,
      activeToggles,
      header: $(".tf-header__title")?.textContent,
    };
  });

  // Open the layer panel and count groups + availability gating.
  const layers = await page.evaluate(() => {
    document.querySelector(".map-layer-btn")?.click();
    return new Promise((res) => setTimeout(() => {
      const panel = document.querySelector(".layer-panel");
      res({
        panel: !!panel,
        groups: panel ? [...panel.querySelectorAll(".layer-group h4")].map((h) => h.textContent) : [],
        items: panel ? [...panel.querySelectorAll(".layer-item")].map((el) => el.textContent) : [],
      });
    }, 250));
  });
  const disabled = (layers.items ?? []).filter((t) => /UNAVAILABLE/.test(t));

  // Toggle rainfall off then on to confirm hazard layer cleanup doesn't error.
  let toggleErrors = 0;
  if (width >= 1024) {
    const rainItem = page.locator(".layer-item", { hasText: "Rainfall Bands" });
    await rainItem.getByRole("checkbox").uncheck();
    await page.waitForTimeout(500);
    await rainItem.getByRole("checkbox").check();
    await page.waitForTimeout(500);
  }
  toggleErrors = errors.length;

console.log(
    `[${width}x${height}] gridCols=${probe.gridCols} stacked=${probe.stacked} ` +
      `mapW=${probe.mapWrapWidth} intelW=${probe.intelWidth} mapH=${probe.mapHeight} ` +
      `canvas=${probe.canvasWidth}px sum=${probe.summaryRows} top=${probe.topRows} ` +
      `cards=${probe.impactCards} unavail=${probe.unavailable} surgeUnavail=${probe.surgeUnavail} ` +
      `windZones=${probe.windZones} legend=${probe.legendChips} opts=${probe.totalOptions} avail=${probe.activeToggles} ` +
      `panelGroups=${layers.groups.join("+")} panelItems=${layers.items.length} panelDisabled=${disabled.length}`,
  );

  if (capture) {
    await page.screenshot({
      path: resolve(outDir, `hazards-${width}x${height}.png`),
      fullPage: /\b(768|390)\b/.test(String(width)) ? false : true,
    });
  }

  // Drawer probe (desktop only): click first ranked row.
  if (width >= 1024 && probe.topRows > 0) {
    await page.click(".hz-top-row");
    await page.waitForTimeout(600);
    const drawer = await page.evaluate(() => {
      const d = document.querySelector(".hz-drawer");
      return {
        present: !!d,
        title: d?.querySelector(".hz-drawer__title")?.textContent,
        values: document.querySelectorAll(".hz-drawer__value").length,
        backdrop: !!document.querySelector(".hz-drawer-backdrop"),
      };
    });
    console.log(`  drawer: present=${drawer.present} title="${drawer.title}" values=${drawer.values} backdrop=${drawer.backdrop}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => !document.querySelector(".hz-drawer"));
    console.log(`  drawer-escape-closed=${closed}`);
    await page.screenshot({ path: resolve(outDir, `hazards-drawer-${width}.png`) });
  }

  await page.close();
}

for (const s of sizes) await snapshot(s.width, s.height);
await browser.close();

if (errors.length) {
  console.log("\nJS/console errors:");
  [...new Set(errors)].slice(0, 12).forEach((e) => console.log("  -", e.slice(0, 220)));
} else {
  console.log("\nNo JS/console errors.");
}