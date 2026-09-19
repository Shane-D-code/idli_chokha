const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:5199/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(9000);
  const t = await page.evaluate(() => {
    const s = document.querySelector(".tt-storm");
    const st = s?.getBoundingClientRect();
    // sample the rendered pixels INSIDE + AROUND the storm for luminance contrast
    const dom = document.querySelector(".m-track-theatre-section");
    return {
      stormStyle: s?.style.width, stormSize: st ? { w: Math.round(st.width), h: Math.round(st.height) } : null,
      cloudCount: dom?.querySelectorAll(".tt-cloud").length,
      rimCount: dom?.querySelectorAll(".tt-rim").length,
      eye: dom?.querySelectorAll(".tt-eye").length,
    };
  });
  console.log(JSON.stringify(t));
  if (t?.stormSize) {
    const s = t.stormSize;
    await page.screenshot({
      path: "/tmp/storm-zoom.png",
      clip: { x: 640, y: s.w > 100 ? 1740 : 1720, width: 190, height: 150 },
    });
  }
  await browser.close();
})();