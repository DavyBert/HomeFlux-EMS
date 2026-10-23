# HomeFlux EMS 1.1.16 - P1 EV settings optimization audit

## Starting point and scope

- Input: `HomeFlux-EMS-1.1.16-EV-planning-gerichte-optimalisatie.zip` (the exact latest uploaded project archive; byte-for-byte source baseline).
- Retained app version: **1.1.16**.
- No EV decision algorithm, PV priority, battery strategy, safety threshold, public setting or Flow schema changed.
- Source: `app.js`; targeted diagnostics in the existing 15-minute Input Monitor; new test `test/ev-physical-settings-1.1.16.test.js`.

## Root cause reproduced with production handlers

For an active SoC Flow target, 180 simulated seconds, with a P1 input and EV status/SoC feedback every second, instrumenting `getEvInstanceSettings()` directly produced **244** full expansions. Stack traces attribute **180** to `getEvGridImportControlStatus()` reached via the fast `getFastControlSnapshot()` P1 preflight. Seven more occurred via the ordinary evaluation-state path; other expansions occurred for actual context/publication and display/output bookkeeping.

The production snapshot supplied to physical grid-accounting was being cloned into full per-EV settings, including target/deadline and TOU transformations, when the caller only needed physical/electrical details and tariff permissions. Thus the heavy settings expansion executed independently of actual EV planning/portfolio decisions. The original field diagnostic (426 full runtime expansions during 101 seconds, process CPU 537.774 ms attributed to them) was the trigger, **not** an assumed exact outcome of this separately configured replay.

Detailed traces are in `callers-before-180s.json` and `callers-after-180s.json`.

## Change

1. Added `getEvPhysicalAccountingSettingsFor()`: a fresh, focused projection of enabled state, electrical/current configuration, per-EV tariff selection/PV top-up permissions and EV grid-allocation priority/weight. It does not read/expand SoC, kWh, deadline, sessions or complete plan data. For TOU it retains exactly the permission/fallback normalization used by the original full settings. There is no cross-request cache and no async I/O.
2. Added `getEvPhysicalObservationSettings()`: optional per-synchronous-observation reuse, with exact identity/time guards, for physical import control and planned battery grid limit. `getEvObservationSettings()` remains in use for full Live status, which needs full planning fields.
3. The mode-only P1 load detector reads targeted electrical settings plus the same mode tolerance, not the full EV settings. Status/current updates, physical supply attribution, automatic tuning power estimation and mode output activity likewise avoid full expansion where they only need one or a few fields.
4. During active monitoring, the new `evPhysicalSettingsRead` calculation records `grid_import_control` and `battery_grid_limit` separately; `evElectricalSettingsRead` records `p1_load_detection`. Full status expansions use `status`. Counts, frequency and CPU/wall durations remain separate from app-wide process CPU. Monitoring is passive, synchronous, and off outside an active session.
5. Release notes updated in `.homeychangelog.json` and the README's 1.1.16 section; Quick Start and external support link unchanged.

## Comparable 180-second before/after production replays

All 12 profiles reproduced with unmodified benchmark/fixture and **identical battery and EV commands, final states and publication timestamps**. One alternating pair per profile (so host CPU numbers are indicative, not stable Homey CPU predictions).

| Scenario | Before full expansions | After full expansions |
|---|---:|---:|
| Connected, not outputting | 198 | 6 |
| Disconnected | 0 | 0 |
| Connected P1 jitter | 198 | 6 |
| Identical 10 A feedback | 206 | 8 |
| Live status read every 2 s | 288 | 96 |
| Disconnected + Live status | 90 | 90 |
| Two EVs, current | 906 | 62 |
| Two EVs, hybrid | 495 | 47 |
| No battery | 244 | 20 |
| Battery control disabled | 244 | 20 |
| PV-only | 440 | 28 |
| Diagnostics off | 198 | 6 |
| **Total** | **3507** | **389 (-88.9%)** |

The 180-second caller probe decreased from **244** to **20** full expansions, with the same one-second P1 and repeated feedback cadence. That probe uses stack acquisition, so its process CPU result should not be compared against uninstrumented app CPU.

Three additional alternated 90-second replays each for two-current, no-battery and PV-only, again with equal output traces:

| Profile | Before host process CPU median (ms) | After median (ms) |
|---|---:|---:|
| Two current-controlled EVs | 356.3 | 247.5 |
| EV without battery | 239.2 | 184.2 |
| PV-only | 415.4 | 325.4 |

Full raw output: `comparison-180s.json` (CPU, wall, settings count, counters, every published command). Baseline is the **exact latest input ZIP**, not the older intermediate project folder. These are host Node process measurements, not Homey CPU forecasts. The mixed results of one-off host CPU samples should not be treated as proof of a fixed percentage reduction. The physical validation path is still executed every P1 input; only settings expansion was replaced.

## Tests and limits

Passed: 648 electrical/tariff parity comparisons covering two EVs, mode/current/hybrid and TOU/fixed/dynamic/dynamic-quarter plus 180 physical-accounting calls under active SoC Flow goal; EV work 1.1.16 (9), EV battery protection (14), EV transitions (33), PV house-first (72), planning centralization (32), monitor 1.1.16 (6), EV work 1.1.15 (22), fast-control audit, v0.7.10 regressions, EV-independent 1.1.5 (55), EV feedback 1.0.11 (28), EV context delay (20), deadline-cache 1.1.12 (238), duplicate CPU, 1.1.14 monitor + UI tests.

One long-running historical input-work test exceeded an earlier per-test timeout; it was **not counted as passed**. The complete aggregate `npm test` run was not run to completion in this task.

To validate on Homey: run the existing 15-minute Input Monitor with a connected, active-SoC EV and compare full `evSettingsBuild` rows versus the new `evPhysicalSettingsRead:grid_import_control` and `evElectricalSettingsRead:p1_load_detection` rows. The recorded counts should not be conflated with actual EV tariff scans and decisions.
