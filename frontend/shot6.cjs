const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:5199/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(9000);
  const r = await page.evaluate(() => {
    const s = document.querySelector(".tt-storm")?.getBoundingClientRect();
    return s ? { x: Math.round(s.x), y: Math.round(s.top), w: Math.round(s.width), h: Math.round(s.height) } : null;
  });
  console.log("storm:", JSON.stringify(r));
  if (r) {
    await page.screenshot({
      path: "/tmp/storm-zoom.png",
      clip: { x: r.x - 60, y: r.y - 60, width: r.w + 120, height: r.h + 120 },
    });
  }
  await browser.close();
})();