# HomeFlux EMS 1.1.16 – planning function monitor audit

## Purpose

Additional diagnostics in the existing 15-minute Input Monitor & Loop Detection, for measuring *executed* work before and during battery/EV planning. No control decisions, output timing, Flow schemas, timer rates or battery/PV strategies are changed. Existing input-loop counters remain independent.

## New counters and observation points

- `batterySocPlan:context` – every actual `buildSocPlan()` invocation by `refreshPlanningInContext` (not cache hits); `batterySocPlan:simulation` – read-only planning simulator.
- `batteryChargeTarget:fast/context/fastPreview/simulation` – every actual `computeChargePlanW()` invocation in the charging feedback engine and its preview. Skips when recovery follows a separate safety formula. It is a much lighter calculation than full `buildSocPlan`.
- `evSettingsBuild:runtime:EVn` – every `getEvInstanceSettings` expansion, **including before any EV portfolio evaluation or via read-only Live status**.
- `evSocDeadline:settings:EVn` or `summary` – actual `getEvSocPlanDeadlineAt` lookup. This captures the calendar/deadline work done inside EV settings before a portfolio evaluation.
- `evDecision:context/publication/deferred/heartbeat/single/legacy/simulation:EVn` – every actual `calculateEvDecision()` call, including per-EV decisions inside one portfolio.
- `evTariffScan:[matching route]:EVn` – every actual `countEvTariffMinutes()` scan inside the EV decision; a decision may contain more than one scan or no scan.

Counters are separated per planner/function, origin/route and EV instance. `calculationSummary.total` counts function invocations (including nested work), not unique EMS evaluations or command publications. The schemaVersion remains 1 with additive JSON fields `calculationSummary`, `calculations` and `calculationAttribution`.

## Frequency and timing

The existing single recording/session timer advances 1-second buckets. For one identical function + route + EV, >=2 completed invocations per second for five consecutive seconds flags `possible_repetition` and emits a bounded event. This must not be called a proven Flow loop: multiple legitimate calculations are possible. No extra meter polling, EV timer or action card is introduced.

Each row shows executions, instantaneous and peak count/s, average count/s, timestamp, max and cumulative synchronous wall-time, and cumulative synchronous process CPU time. CPU and wall totals **are not additive between nested `evDecision` and `evTariffScan`, or nested `evSettingsBuild` and `evSocDeadline`**. The app-wide CPU in the JSON includes the instrumentation overhead and unrelated app work; it is not a predicted Homey CPU percentage. The monitor does not correlate asynchronous work with a preceding Flow input when the causal link is not supported.

Rows/events are bounded (64 calculation categories and 256 combined events). No user payloads, arbitrary text or settings snapshots are stored in calculation records. Everything is cleared on monitor clear/app restart; stop or expiry freezes the report.

## Verification

- New `test/planning-monitor-1.1.16.test.js`: isolated high-rate recurrence / separate EV attribution, auto-expiry, frozen snapshot, real battery planner, two-EV portfolio and tariff scans, cached status (without planning recomputation), SoC deadline before portfolio, and identical battery preview with/without observer.
- Existing Input Monitor core and UI suites passed (19 core scenarios; UI polling, visibility, warnings, expiry, download and cleanup).
- `test/ev-work-1.1.16.test.js`: 9 concurrent heartbeat, changed P1, changed Flow target, deadline and Live status scenarios passed.
- `test/ev-plan-1.1.15.test.js`: 33 scenarios and 975 exact calendar/DST comparisons passed.
- `test/performance-split-loop.test.js`: fast/slow boundary passed; only the assertion for the new optional read-only observer argument was updated.
- `test/soc-completion-1.1.9.test.js` reported 55 passing scenarios in its log (the long aggregate command exceeded its tool timeout).
- Other captured regression suites passed through the historical 0.9.9 tests. The full monolithic `npm run check` timed out during a historical test; do not interpret it as full-suite approval.

### Command equivalence – 90-second replay with inactive monitor

The benchmark's `outputsIdentical` checks compare every battery and EV published output and its timestamp, against the last supplied 1.1.16 optimisation package. The host CPU timings are single-run measurements, not statistical evidence of CPU benefit.

| Profile | Outputs/times identical | Settings calls before | Settings calls after |
|---|---|---:|---:|
| live-status | Yes | 231 | 231 |
| two-current | Yes | 612 | 612 |
| no-battery | Yes | 206 | 206 |
| pv-only | Yes | 298 | 298 |

The monitor is observational; comparing on/off monitor CPU cost would require separate repeated Homey runs. No percentages from the host simulation are projected to the device.

## Files and release constraints

Updated `app.js`, `lib/ems-engine.js`, `lib/flexible-loads.js`, `lib/input-monitor.js`, `settings/input-monitor.js`, `settings/index.html`, the historical split-loop source assertion, README 1.1.16 feature release notes, `.homeychangelog.json` feature note, and `package.json` test registration. Added this audit and focused test. Version remains **1.1.16**. Athom web-page copy, app.json description, deprecated Flow cards, settings schemas, battery strategy, PV priority, general context cadence and output command logic were not modified.
