// TEMP-DIAGNOSTIC PROBE (section 3 of the review) — remove after diagnosis.
// Captures / and /dashboard, dumps console + scene graph + label geometry
// + canvas paints for the OpsGlobe/GlobeScene route so storms can be checked
// by pixel arithmetic.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const OUT = path.resolve("diagnostics");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
});

async function inspect(route, file, waitMs) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    logs.push("[goto] " + e.message);
  }
  await page.waitForTimeout(waitMs);

  const sceneDump = await page.evaluate(() => {
    const out = [];
    const hook = window.__TOOFAN_SCENE_HOOK__;
    if (typeof hook !== "function") return out;
    try {
      hook((api) => {
        const { renderer, scene, camera, canvasOffset, project } = api;
        const off = canvasOffset();
        const programs = (renderer.info.programs || []).map((p) => ({
          name: p.name || "?",
          usedTimes: p.usedTimes,
          fragLog: p.diagnostics?.fragmentShader?.log
            ? p.diagnostics.fragmentShader.log.split("\n").slice(0, 6)
            : null,
          vertLog: p.diagnostics?.vertexShader?.log
            ? p.diagnostics.vertexShader.log.split("\n").slice(0, 6)
            : null,
        }));
        const entry = {
          offset: off,
          cameraPos: camera.position.toArray().map((v) => +v.toFixed(3)),
          rendererInfo: {
            render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
            memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
            programs,
          },
          scene: [],
          stormScreen: null,
        };
        out.push(entry);
        const uniformsOf = (mm) => {
          if (typeof mm.uniforms !== "object" || !mm.uniforms) return null;
          const pick = {};
          for (const k of ["uSeed", "uIntensity01", "uNow", "uTime", "uOpacity"]) {
            if (mm.uniforms[k]) pick[k] = mm.uniforms[k].value;
          }
          return pick;
        };
        scene.traverse((o) => {
          const m = o.material;
          const mats = Array.isArray(m) ? m : m ? [m] : [];
          if (o.userData?.layer === "sat-storm" && o.isMesh && o.userData?.stormCenter) {
            entry.stormScreen = project(o.userData.stormCenter);
          }
          entry.scene.push({
            type: o.type,
            name: o.name || null,
            layer: o.userData?.layer ?? null,
            visible: o.visible,
            renderOrder: o.renderOrder,
            position: o.position
              ? [+o.position.x.toFixed(3), +o.position.y.toFixed(3), +o.position.z.toFixed(3)]
              : null,
            materials: mats.map((mm) => ({
              type: mm.type,
              transparent: mm.transparent,
              opacity: mm.opacity,
              blending: mm.blending,
              depthWrite: mm.depthWrite,
              depthTest: mm.depthTest,
              side: mm.side,
              wireframe: mm.wireframe,
              color: mm.color ? "#" + mm.color.getHexString() : null,
              uniforms: uniformsOf(mm),
            })),
            dbg: o.userData?._dbg ?? null,
          });
          if (o.isMesh && o.geometry?.attributes?.position) {
            const g = o.geometry;
            const bs = g.boundingSphere;
            o.userData._dbg = {
              posCount: g.attributes.position.count,
              bs: bs ? { center: bs.center.toArray().map((v) => +v.toFixed(3)), r: +bs.radius.toFixed(3) } : null,
            };
          }
        });
      });
    } catch (e) {
      out.push({ hookError: String(e) });
    }
    return out;
  });

  const labelRects = await page.evaluate(() => {
    const res = [];
    const canvases = [...document.querySelectorAll("canvas")].map((c) => {
      const r = c.getBoundingClientRect();
      return { w: r.width, h: r.height, x: r.x, y: r.y };
    });
    const containers = document.querySelectorAll("div");
    for (const c of containers) {
      const s = getComputedStyle(c);
      if (s.position !== "absolute") continue;
      const r = c.getBoundingClientRect();
      if (!c.textContent || r.width < 8 || r.height < 4) continue;
      const text = c.textContent.replace(/\s+/g, " ").trim().slice(0, 70);
      if (!text) continue;
      res.push({
        text,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        textTransform: s.textTransform,
        background: s.backgroundColor,
      });
    }
    return { canvases, rects: res.slice(0, 120) };
  });

  await page.screenshot({ path: path.join(OUT, file) });
  console.log("--- canvases:", JSON.stringify(labelRects.canvases));
  console.log("--- labels (" + labelRects.rects.length + "):");
  for (const l of labelRects.rects.slice(0, 30)) console.log(JSON.stringify(l));
  fs.writeFileSync(path.join(OUT, file + ".json"), JSON.stringify({ route, sceneDump, labelRects, logs }, null, 1));
  console.log(`\n=== ${route} -> ${OUT}/${file}`);
  console.log("--- console:");
  console.log(logs.slice(0, 40).join("\n") || "(none)");
  const rgh = logs.filter((l) => l.includes("RGH_SCENE") || l.includes("SHADER-ERROR"));
  console.log("--- rgh/shader lines (last 10):");
  console.log(rgh.slice(-10).join("\n") || "(none)");
  const hookOut = sceneDump.find((d) => d.scene) || null;
  if (hookOut) {
    console.log("--- canvas offset:", JSON.stringify(hookOut.offset), "cameraPos:", JSON.stringify(hookOut.cameraPos), "stormScreen:", JSON.stringify(hookOut.stormScreen));
    console.log("--- programs (all):");
    for (const p of hookOut.rendererInfo.programs) console.log("   ", JSON.stringify(p));
    console.log("--- scene objects (" + hookOut.scene.length + "):");
    for (const o of hookOut.scene) console.log(JSON.stringify(o));
  } else {
    console.log("--- no scene hook fired on this route");
  }
  console.log("--- labels (" + labelRects.rects.length + "):");
  for (const l of labelRects.rects.slice(0, 30)) console.log(JSON.stringify(l));
  await page.close();
}

await inspect("/", "home-mission.png", 12000);
await inspect("/dashboard", "dashboard.png", 12000);
await browser.close();
console.log("\nPROBE-DONE");