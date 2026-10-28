# HomeFlux EMS 1.2.5 — EV registration and grid-permission validation

> Historical report for the initial 1.2.5 build. The later same-version house-reference publication correction is documented in [EV-HOUSE-PUBLICATION-1.2.5.md](EV-HOUSE-PUBLICATION-1.2.5.md). The source-diff and test counts below describe the initial build.

## Source and scope

Based exclusively on `HomeFlux-EMS-v1.2.4-proef-EV-PeakGuard.zip`, saved version 2, SHA-256 `1905add875fb5bb750c3f0b51b13356ac252807a271619a0ea1c11bdc8a9bc1a`. This is the last supplied 1.2.4 source containing the three EV tabs **Status / Planning / Insights**. All widget files are byte-identical to that source. All existing fixes in that build are retained. App, Compose, package and lockfile versions are 1.2.5.

## Corrected recording source

The existing `getEvSavingsReadings()` used Flow current for every control type. Repeated 0 A gave valid zero coverage, even when HomeFlux's physical Mode observation showed charging. Missing current also produced zero energy. The CSV `estimated` field did not identify P1 as its source.

Mode recording now consumes the existing, centrally divided `modePowerSnapshot` written by `updateEvPortfolioLoadDetection()`. No second estimate is calculated. The detector exposes recording-quality metadata: `usable` and `recordingValidUntil`. This metadata does not alter its control output, watt allocation or existing control validity.

- Integration covers only the overlap of the completed Savings interval with the original observation's validity. Widget/CSV reads do not extend it.
- A valid zero differs from unavailable P1/PV/baseline or ambiguous competing EV feedback. Missing observations add missing coverage and never nominal charger energy.
- With mixed Mode and Current/Hybrid EVs, recording also expires with the fresh Flow measurement used to exclude the competing load.
- Mode ignores its own Flow amperes, including positive values and repeated 0 A. The Flow feedback scope does not disable the independently available, already divided P1 estimate.
- Current and Hybrid keep the original fresh Flow recording path, including shared-meter behaviour.
- Multiple Mode EVs share the existing P1 pool once. Per-car allocation remains an estimate, not separate metering.
- Source attribution, financial values and CSV use the same central daydata. PV to EV remains a subset of PV direct. Battery energy that cannot be reliably assigned stays unknown.
- Existing history is retained. No historical energy is reconstructed. Restart discards runtime observations and does not integrate downtime.

The P1 estimate still has its existing limitations: house baseline uncertainty, source timing and use of effective battery command/reported EMS setpoint rather than an independent battery power meter. It is labelled estimated. A STOP can leave an old physical observation valid until its original expiry or the next P1 invalidation; no command is treated as delivered energy. A stopped connected EV without usable physical evidence has incomplete coverage. The integration uses existing sample-and-hold semantics, not retrospective endpoint interpolation.

## Emergency, Guaranteed and Peak Guard

No incorrect PV-only limit was reproduced in the latest source's Emergency or active guarantee allocation. Consequently the existing budget formulas, planner and output policy are unchanged.

Emergency uses remaining shared physical Peak Guard room after PV allocation, subject to its configured emergency tariff permissions. Guaranteed **ON** retains the existing meaning: the planner activates the all-tariff guarantee when needed for the deadline; it does not immediately permit unrestricted charging at every moment. Once `guaranteeActive` is true, it can use the remaining Peak Guard room independently of ordinary tariff allowance or PV. Ordinary PV-only Smart retains its stop rules when solar disappears.

Before existing conservative reservations/hardware quantisation, the shared accounting is:

`EV peak budget = current observed EV watts + (Peak Guard limit − margin − current P1 import)`

The existing battery-discharge exclusion and physical reservations remain in place. PV is not added again. The example P1 8,287 W, existing EV 4,416 W and limit 17,500 W gives 13,629 W before margins; with the tested 100 W margin it gives **13,529 W**. At 3-phase 400 V, current-controlled allocation gives 19 A within that budget. The real portfolio test verifies these exact numbers. Effective measured P1 overload still stops charging when no safe charging step fits.

Twenty targeted groups cover Mode/Current/Hybrid, no PV, ordinary grid allowance 0 W, PV-only to Emergency/Guaranteed transitions, clouds, fixed/TOU contracts, four EVs sharing one peak budget, the exact example and genuine overload. The existing dynamic/quarter-price planner tests also pass. No new delay, hysteresis or workaround was added.

## Changes

Production:

- `app.js`: Mode readings in `getEvSavingsReadings()`; recording-quality metadata only in `updateEvPortfolioLoadDetection()`.
- `settings/index.html`, `settings/translations/en.json`, `settings/translations/nl.json`, `locales/en.json`, `locales/nl.json`: accurate bilingual explanation of the recording sources.
- `app.json`, `.homeycompose/app.json`, `package.json`, `package-lock.json`: version 1.2.5; package scripts include the two new targeted suites.
- `.homeychangelog.json`, `README.md`, this document: release/scope documentation.

Tests: `test/ev-mode-recording-1.2.5.test.js`, `test/ev-grid-permission-1.2.5.test.js`, optional baseline comparison `test/ev-recording-comparison-1.2.5.cjs`; one Mode expectation updated in `test/ev-recording-audit-1.2.4.test.js`; version assertions updated in `test/settings-startup.test.js`, `test/widget.test.js` and `test/planning-monitor-1.1.16.test.js`. Generated evidence is in `validation/`.

Byte comparison verifies that the only changed app methods are the two above. EV scheduling/Flow handlers, `publishEvDecision()`, `publishAdditionalEvDecision()`, `calculateEvPortfolioDecisions()`, physical Peak Guard/output policy, battery planning, Savings integrator and energy source allocation modules are unchanged.

## Tests and reproducibility

- Exact 1.2.4 baseline: **100/100 existing test files passed**.
- 1.2.5: **102/102 test files passed**, including the two new suites. Three initial failures were obsolete hardcoded version assertions; they were corrected and targeted reruns passed. The former BMW characterization was changed from expecting zero energy despite positive P1 evidence to expecting the valid physical estimate.
- Mode recording: **16 groups**, including absent/zero/false-positive Flow values, valid zero, both feedback scopes, source balance, battery charge/discharge, export, expired observations, a missing competing meter, mixed-source expiry, missing baseline, midnight, repeated reads, disconnect and reboot.
- Grid permission: **20 groups**, as above.
- Before/after comparison: **12 scenarios** across fixed, TOU and dynamic quarter-price contracts. General Savings fields, battery inventory, total Savings, output commands and modes are identical; the previously missing Mode EV energy is now present. Energy-balance invariants pass.
- Eight changed/new JavaScript files passed syntax checks; 403 JSON files parsed at the validation stage. Existing widget UI suite: **43 cases passed**, including all three tabs and compact Status.

Commands from app root:

```sh
npm test
node test/ev-recording-comparison-1.2.5.cjs /path/to/exact-1.2.4-source
EV_WORK_RUNS=5 EV_WORK_SECONDS=180 EV_WORK_FILTER='two-current|battery-disabled|disconnected|pv-only' EV_WORK_OUTPUT=/tmp/ev-performance.json node --expose-gc test/ev-work-benchmark-1.1.15.js /path/to/exact-1.2.4-source
```

All functional tests use real production functions with simulated Homey I/O, time and physical input. They are **not** a historical replay of 27/28 October and do not establish that the user's EV charged on 28 October. No physical Homey/charger tests, Athom CLI validation or device-specific CPU/memory measurements were available.

## Measured performance

Node container benchmark: five profiles, five paired runs each, 180 simulated seconds per replay, 50 replays total. Execution order alternates; reported medians exclude the first two warm-up pairs. Actual production handlers/regulation run with simulated I/O. Control outputs, counters and existing context/timer activity match before/after in each pair. No new polling, timer, recorder, planner or history scan was introduced.

| Profile | CPU before (ms) | CPU after (ms) | Retained heap before (bytes) | Retained heap after (bytes) |
|---|---:|---:|---:|---:|
| disconnected | 51.312 | 36.731 | 9952 | 37440 |
| disconnected-status | 114.067 | 99.596 | 26960 | 46600 |
| two-current | 273.681 | 227.442 | 67616 | 24112 |
| battery-disabled | 212.472 | 225.376 | 37152 | 27576 |
| pv-only | 351.172 | 326.776 | 48592 | 69776 |

The Mode/battery-disabled profile rose about 6.1% in this short host measurement; other medians were lower. This is timing/GC/JIT-sensitive container evidence, not a claimed performance improvement or proof of unchanged Homey CPU. The small additional work is reading validity metadata and the existing estimate inside the already running day recorder; the snapshot remains bounded by the existing maximum four EVs.

Detailed evidence: `validation/release-1.2.5.json`, `validation/ev-mode-recording-1.2.5.json`, `validation/ev-grid-permission-1.2.5.json`, `validation/ev-recording-comparison-1.2.5.json`, `validation/ev-performance-1.2.5.json`.

## Nederlandse toelichting

De bestaande P1-schatting wordt nu ook voor de EV-energieregistratie bij modussturing gebruikt. Ontbrekende of 0 A-Flowfeedback blokkeert die geldige schatting niet meer. Planning en fysieke sturing blijven ongewijzigd. Emergency en actief gegarandeerd laden zijn getest zonder zon en met 0 W normale tariefruimte; zij benutten de bestaande P1-ruimte onder Peak Guard. Een echte overschrijding blijft ingrijpen. De drie EV-tabbladen blijven behouden. Bestaande instellingen en historiek worden niet omgezet of opgehoogd. De controles zijn simulaties met productiecode; praktijktesten op Homey zijn nog nodig.
