# Session Status — TOOFAN Frontend

> This file is the continuity record for the opencode working session. Read it fully before doing anything.

## Last Session Closed While... (current state)
The MULTI-HAZARD IMPACT CONSOLE task was completed and fully verified on Sep 19, 2026 (fourth scoped task this session, after Overview, Genesis and Forecast):
- `npm run lint` (tsc --noEmit): PASSES clean
- `npm run build` (tsc -b && vite build): PASSES (2306 modules, ~7.7 s)

The Impact page (`/impact`) is now the multi-hazard console — TOP outlook (storm/basin/horizon/pipeline/overall severity), 4 hazard modules (rain/water, wind with the honest "WIND FIELD / PROVIDER REQUIRED" gate, flood, landslide), UNIFIED HAZARD ENGINE verdict section, and a RISK MAP whose layer toggles only appear when backend spatial data exists. Task COMPLETE and verified. Next move = report completion to the user and offer a browser visual QA pass.

## One-Line Summary
Four scoped page-polish closeouts in one session, all building clean under the `command.css` dark console system, frontend-only, zero backend changes: Overview (`/dashboard`), Genesis scientific console, Forecast complete-module UI (dominant map), and the Multi-Hazard Impact Console — each preserving the honesty invariant (NOT_AVAILABLE never becomes LOW, ERROR never becomes 0, no demo values in LIVE).

## Go Forward Should Include... (Active / Blocked)
- **ACTIVE**: none — Overview, Genesis, Forecast and Impact tasks are all verified and complete.
- **BLOCKED**: none.
- Keep the honesty invariant: in LIVE mode NO fabricated values — absent backend signals render NOT_AVAILABLE; only backend/model-registry-operational models are ever labelled ACTIVE.
- Do not open closed themes again unless asked (all four command-center pages are now polished — no obvious remaining page target worth touching unprompted).
- CommandCenterData has NO `provenance` field — provenance labels must be derived from `mode` or report fields.

## Critical Instructions / Constraints
- **User (hard):** DO NOT modify backend/API code (Python in `backend/`, `src/`, model folders). Frontend-only, in `frontend/`.
- No full-frontend redesigns — page-scoped improvements only (Overview, then Genesis were the two scoped tasks).
- `tsconfig` sets `noUnusedLocals: true` → every import MUST be used; lint is `tsc --noEmit`.
- Verified facts to reuse:
  - `GenesisReport`: `status: PredictionStatus` (`status`/`message`/`timestamp`), `subModels: GenesisSubModel[]`, `threshold?` (e.g. 0.24), `calibrated?` (false → prototype "UNCALIBRATED"), `scientificStatus?` ("prototype").
  - `GenesisSubModel`: `modelId` (e.g. `genesis-lightgbm`), `name`, `role` ("PRIMARY"|"ENSEMBLE"), `status: ModelOperationalStatus`, `probability24h/48h/72h`, `weight` (0.4/0.35/0.25), `message`.
  - Model registry: `toofanService.getModels()` (demo → `mock.mockModels`); genesis entries `genesis-lightgbm` (LightGBM, artifact `models/genesis_lightgbm.txt`, 34 features), `genesis-xgboost`, `genesis-rf` (scikit-learn), `genesis-ensemble` (framework "Ensemble", output "Genesis probability (weighted)", `lastInference`). Join via `modelId`. Demo: all AVAILABLE.
  - Drivers: `mockEnvironmentDrivers` (missionMock.ts) — ids `sst, sst-anomaly, tchp, ohc700, shear, rh, vorticity`; grouped THERMODYNAMIC (sst/sst-anomaly/tchp/ohc700/rh), DYNAMIC (shear/vorticity), GEOGRAPHIC (lat/lon from `cyclone`). Demo satellite data source: `{ id:"satellite", name:"Satellite", category:"Imagery", status:"STALE", coverage:"Regional" }` → satellite available ONLY if `CONNECTED`/`AVAILABLE`; STALE ⇒ NOT_AVAILABLE + "Source not connected".
  - Helpers `lib/moduleStatus.ts`: `moduleStatusColor()`, `moduleStatusFrame()`, `PIPELINE_MODULES`, `ModuleKey`; `severityColor/severityFrame`.
  - `useModuleStatuses()` → `Record<ModuleKey, {status, reason?, active?}>`; genesis entry used for the page's pipeline status.
  - Genesis view-model `mission/genesis/genesisModel.ts`: `horizonsFrom(sub)` returns `{h24,h48,h72}` weighted soft-vote; `probabilityBand`, `bandTone`, `pct`, `thresholdState`, `genesisMeta`, `genesisProvenance`, `genesisReason`, `GenesisReport`… all pure + honest.
- Proven authoring pattern: `style={{ ["--cm-dot" as string]: color }}` for CSS-var dots; `clampPct(v)` guards plot widths 0–100%.

## Relevant Code / Tests / Scripts
- Lint: `npm run lint` (tsc --noEmit). Build: `npm run build` (tsc -b && vite build). Dev: `npm run dev`. (From `frontend/`.)
- NEW Genesis page has its own bespoke CSS section in `command.css`: `.cm-table__group` (driver group bands), `.cm-ens*` (entradas ensemble member cards + mini horizon bars via `--cm-hz`), `.cm-plot*` (threshold plot: `.cm-plot__fill` + white `.cm-plot__mark` at threshold%), `.cm-prov-grid` (auto-fit 2-col grid reused for Threshold + Provenance), everything tinting on existing tokens.
- Beware UX collision: `PipelineStatusStrip` renders once in `AppShell` (top) AND once in the Genesis Pipeline Status card AND once in the Overview bottom card — three instances is intentional (each in its own context).
- The page fetches the model registry once on mount via `toofanService.getModels()` and indexes by id — do not re-fetch per render.

## Recent Progress (the working session)
Impact page complete module console (this session, fourth half):
1. Rewrote `ImpactPage.tsx` into the MULTI-HAZARD IMPACT CONSOLE:
   - **TOP · MULTI-HAZARD IMPACT OUTLOOK**: 4 tiles (STORM, BASIN, FORECAST HORIZON, OVERALL HAZARD SEVERITY — the latter a large severityColor text + score/engine; NOT_AVAILABLE never coerced) + PIPELINE STATUS lane of routable chips RAIN→WIND→FLOOD→LANDSLIDE→HAZARD ENGINE→UNIFIED RISK, dot-colored by `useModuleStatuses()` each showing its raw status.
   - **HAZARD GRID · 4 modules**, each a `HazardCard` (title + CmSev risk + status pill + MODEL/TIME footer; not-ok → `ModuleGate`):
     - RAINFALL: amount (peak mm), forecast window, peak exposure (±radius @ mm), risk, spatial map flag, district table (top 5), baseline notice.
     - WIND: max zone wind, Direction → **NOT REPORTED** (no backend field — never invented), spatial wind-field flag, risk-threshold zones table; when backend reports unavailable the card shows the exact **"WIND FIELD / PROVIDER REQUIRED"** gate + backend reason — NO wind map is fabricated.
     - FLOOD: max flood probability, overall risk, affected-region count, spatial grid cells flag, districts table (prob % + CmSev).
     - LANDSLIDE: susceptibility class, affected regions, Rainfall driver derived from class (DYNAMIC→"CYCLONE-RAINFALL TRIGGERED", STATIC→"STATIC TERRAIN"), risk, georeferenced map flag, regions table; gate when `staticSusceptibility.available` false.
   - **UNIFIED HAZARD ENGINE** (major section id="hazard-engine"): big OVERALL HAZARD SEVERITY card (severity text + confidence score + engine + verdict basis) + 2×2 COMPONENT RISKS tiles (CmSev + status + score pts) + ASSESSMENT CONTEXT card (Affected Region pills, Uncertainty = risk.reason or honest fallback, Provenance = SIMULATED/BACKEND by mode, Last Updated from system) + WARNINGS footer (only HIGH/VERY_HIGH/EXTREME → pills, else NONE ACTIVE).
   - **RISK MAP** (id="risk-map"): layer toggles rendered ONLY for data the backend actually supplies (rainfall rings+district pts from peak window radii, flood district cells via TRACK_PLACES registry, landslide georeferenced region pts, wind zone rings gated by windOk). Each toggle is a `cm-chip-btn` on/off; if NO spatial data exists a `ModuleGate` "RISK MAP / NOT_AVAILABLE" renders instead of a map. Map = CycloneMap(forecast, current, hazardLayers, recenterMode "cyclone", isDemo from useApp). Plus Affected Region card.
   - All honest-status rules enforced by `isOk()` (excludes NOT_AVAILABLE/ERROR/MODEL_MISSING/RUNTIME_REQUIRED/UNAVAILABLE) and `worstRisk()` (never promotes NONE/LOW from absence).
2. Provenance join: `toofanService.getModels()` registry fetched once → rainfall/wind/flood/landslide model names in card footers.
3. No new CSS required — reuses `.cm-chip-btn`, `.cm-maphead`, `.cm-mapfoot`, `.cm-gate`, `.cm-tile`, `.cm-kv`, `.cm-card__head/foot`, `.cm-flow__lane`.
4. Fixed along the way: `data.provenance` does not exist on CommandCenterData → provenance label derived from `mode`; HazardCard `status` typed `ModelOperationalStatus|null` (ModuleGate contract); simplified rainfall peak computation (peak region `{radiusKm, expectedMm}` + `peakWindow` by value match); removed not-found `cm-card--deep`.
5. Verified: `npm run lint` clean, `npm run build` clean (~7.7 s, 2306 modules).

Before that (this session): COMPLETE Overview rewrite (masthead + eventstrip + 6-lane `PipelineFlow` + 10-tile LIVE metrics + operational map + MODEL HEALTH/DATA PROVIDERS/PIPELINE STATUS), the Genesis 7-section scientific console, and the Forecast map-dominant module UI — all lint/build/dev verified; `trackPlaces.ts` extended with real district centroids (Srikakulam, Vizianagaram, Ganjam, East/West Godavari, Krishna, Guntur, Nellore, Rayagada, Koraput).
Prior sessions: shipped the Rp.2 four-page redesign (Genesis/Forecast/Impact/Overview), RailSidebar, TopBar mode pill, AppShell + PipelineStatusStrip, /genesis /forecast /impact routes, main.tsx importing command.css; fixed all lint errors; rewrote `PipelineFlow.tsx` topology to DATA→GENESIS→CYCLONE PATH→[INTENSITY|RI|RECURVATURE]→[RAIN|WIND|LANDSLIDE]→FLOOD→HAZARD ENGINE.

## Prior-Session Context Snapshot (kept short)
- `command.css` dark design system: tokens `--cm-card`, `--cm-card-deep`, `--cm-line`, `--cm-line-soft`, `--cm-accent*`, `--cm-ink-1..4`; components card/grid/tile/section/kv/gate/table/pill/chip/flow/eventstrip/maphead/healthrow/horizon/ens/plot/prov/mapfoot — plus `.cm-tile`, `.cm-horizon`, `.cm-hz--low/moderate/high`, `.cm-sev--*`, `.cm-gate`, `.cm-notavail`, `.cm-table__group`, `.cm-chip-btn`, `.cm-mono/.cm-num`, responsive media queries.
- ImpactPage, ForecastPage, GenesisPage(then-old), Overview — all shipped; `.cm-flow__node__result` result line on flow nodes.
- No backend/Python changes were made during any of these closeouts.

## Key Files
- `frontend/src/pages/ImpactPage.tsx` (TODAY'S REWRITE — multi-hazard impact console)
- `frontend/src/pages/ForecastPage.tsx` (map-dominant module UI, earlier this session)
- `frontend/src/styles/command.css` (TODAY'S ADDITIONS: `.cm-mapfoot`, `.cm-chip-btn`, `.cm-chip-btn.is-active`; earlier `.cm-table__group`, `.cm-ens*`, `.cm-plot*`, `.cm-prov-grid`)
- `frontend/src/pages/GenesisPage.tsx` (7-section console rewrite, earlier this session)
- `frontend/src/pages/DashboardPage.tsx` (Overview rewrite, earlier this session)
- `frontend/src/utils/trackPlaces.ts` (extended district registry)
- Supporting: `frontend/src/components/map/CycloneMap.tsx` (`hazardLayers`/`HazardLayerData`, `height`, `interactive`, `recenterMode`, `isDemo`), `frontend/src/components/overview/{PageHead,ModuleGate,CmSev}.tsx`, `frontend/src/hooks/useModuleStatuses.ts` (per-module status for the pipeline lane), `frontend/src/state/AppContext.ts` (`useApp()` mode), `frontend/src/lib/moduleStatus.ts` (`moduleStatusColor`, `severityColor`), `frontend/src/services/toofanService.ts`, `frontend/src/hooks/useCommandCenterData.ts`, `frontend/src/data/mock/MOCK.ts` (`mockRainfall/mockWind/mockFlood/mockLandslide/mockOverallRisk/mockHazards/mockModels`), `frontend/src/types/index.ts` + `mission.ts`.
- Impact-specific honesty facts: WindReport has NO direction/timestamp fields (Direction + wind TIME show NOT REPORTED); LandslideReport has no modelName (footer uses registry name); `LS classification` DYNAMIC = cyclone-rainfall driven.

## Do / Don't
- DO continue only what's asked; DO ask before touching other pages or backend.
- DON'T invent values in LIVE mode; DON'T re-open closed themes (all four command-center pages — Overview/Genesis/Forecast/Impact — are now polished).
- DON'T commit unless the user explicitly requests.