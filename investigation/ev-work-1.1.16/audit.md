# HomeFlux EMS 1.1.16 — EV work audit

Source: the newly uploaded `HomeFlux-EMS-v1.1.16.zip` (not an older working tree). Version remains **1.1.16**.

## Evidence and changes

- A normal EV mode lookup previously expanded the entire EV policy and time-dependent Flow goals. It now reads only the actual EV mode, while preserving the completion and session override priorities.
- Pure electrical measurements, EV current feedback attribution, commanded-power attribution and slow SoC-freshness checks now read the few necessary properties instead of cloning all EV settings and TOU rates.
- Physical EV allocation remains freshly budgeted against P1, PV and battery commands. A single synchronous portfolio pass only expands the settings for each EV when actually required and never saves this expanded snapshot across asynchronous I/O.
- Each Live-status call creates one private observation shared by its physical-accounting, EV display and output-timing fields; a later status request always reads fresh inputs and status requests never publish commands.
- The minute heartbeat can skip a duplicate allocation **only when it actually waited** for a just-completed EV publication, no relevant input or settings changed during that publication, current values and freshness still match, and no pending I/O, urgent action or time boundary requires service. The gate stores only an input identity, never a cached charging decision. A new P1 or target requires fresh allocation.
- A Flow-ended, still-connected EV can skip heartbeat work after STOP was applied, no residual current/mode attribution is present and no output/recovery work remains. Reconnection and new plans still use their existing handlers.
- The already-existing cancelable 15-second EV context timer and its revalidation are untouched.
- The existing v1.1.16 Flow SoC/kWh deduplication, exact deadline resolution and within-decision tariff-window reuse are retained. **No cross-context tariff-window cache** was introduced because evolving dynamic tariff snapshots and differing EV target windows would require stronger identity proofs; scans remain mandatory in independent/changed decisions.

## 180-second virtual Homey replay (function counts)

Real production paths and Flow/P1 handlers, simulated clock and Homey I/O. Each variant uses one paired replay (`before` = exact uploaded ZIP; `after` = patched 1.1.16). In each profile, all EV output events, battery output events, final commands and timestamps are deep-equal. Counts are not CPU percentages.

| Scenario | EV settings builds before | After | Change | Portfolio calculations before/after |
|---|---:|---:|---:|---:|
| connected-stop | 405 | 378 | -7% | 3 / 3 |
| disconnected | 183 | 180 | -2% | 0 / 0 |
| connected-jitter | 405 | 378 | -7% | 3 / 3 |
| identical-feedback | 421 | 386 | -8% | 4 / 4 |
| live-status | 765 | 468 | -39% | 3 / 3 |
| disconnected-status | 453 | 270 | -40% | 0 / 0 |
| two-current | 1956 | 1266 | -35% | 13 / 13 |
| two-hybrid | 1072 | 855 | -20% | 10 / 10 |
| no-battery | 885 | 424 | -52% | 10 / 10 |
| battery-disabled | 885 | 424 | -52% | 10 / 10 |
| pv-only | 1121 | 620 | -45% | 14 / 14 |
| diagnostics-off | 405 | 378 | -7% | 3 / 3 |

Portfolio calculations can remain equal because different contexts and actual electrical budgets must be checked afresh. The targeted concurrent heartbeat test separately proves that two overlapping requests share one completed pass. The ended-session test proves no heartbeat calculation when STOP and physical conditions are quiet, and does not suppress contradictory measured current.

## Runtime measurements

The replay JSON also records **host-process CPU milliseconds** (`process.cpuUsage`) and elapsed **wall time** (`performance.now`), separately. It is one pass per profile, subject to startup, JIT, GC and host contention; the numbers must **not** be translated into Homey CPU percentages. Homey I/O waiting is not CPU consumption. See `investigation/ev-work-1.1.16/replay-180s.json` for raw results. CPU benefit is not asserted on the strength of function-call counts alone.

## Regression checks

- Added `test/ev-work-1.1.16.test.js`: **9 passed scenarios** covering simultaneous heartbeat/publication (one/two EVs), a new P1 reading or a real SoC Flow goal arriving during Homey I/O, minute boundary, ended still-connected session, contradictory physical current, and read-only Live status for current/mode/hybrid.
- Existing `test/ev-work-1.1.15.test.js`: 22 scenarios, including withdrawal of the 15-second pending context and real per-input measurements.
- Existing `test/ev-plan-1.1.15.test.js`: 33 scenarios, 975 calendar/DST comparisons, SoC and kWh Flow goals and deadline rollover.
- All **70 test scripts** registered in the `npm test` command passed in sequence of verified groups. A single uninterrupted `npm test` invocation exceeded the execution-time limit after `test/idle-guard-1.0.8.test.js` (47 scripts had passed); the remaining 23 were executed separately, all reporting successful exit (including the 13 heavier scripts in the final regression batch). No assertions failed. The two older tests that hard-coded `1.1.15` despite this source already being `1.1.16` were updated to expect the actual unchanged version.

## Scope

No changes to battery charging strategy, tariffs or battery planning, PV capture, curtailment, HVAC/boiler, charger command formats, existing Flow cards, app webpage, version, or slogan. README quick-start stays deliberately short; feature release notes remain at the bottom.
