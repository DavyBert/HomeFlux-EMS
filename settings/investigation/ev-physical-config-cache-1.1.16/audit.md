# HomeFlux EMS 1.1.16 — Physical EV configuration memo audit

## Exact source

The source is the latest `HomeFlux-EMS-1.1.16-EV-P1-instellingenoptimalisatie.zip` archive. Version remains **1.1.16**. The EV decision algorithm, actual meter/feedback sampling, output publishers, tariffs, battery and PV strategy, Flow cards and Athom app web text are unchanged.

## Finding and safe design

The previous optimization already avoided full EV-plan expansion on the fast P1 path, but it still rebuilt a small electrical/tariff-rights projection for physical import accounting. A global unconditional memo was NOT used, because other functions can pass independently modified settings snapshots.

The final change caches only per-EV physical configuration when `requestEvaluate()` creates its **own synchronous P1 observation** from `getSettings()`. A fresh observation is created on every input; only the *configuration* is shared between them. The helper still produces a fresh projection in contexts, status requests, publisher calls and externally constructed snapshots.

The memo is invalidated immediately for relevant Homey settings updates, including electrical limits, control type, priority, EV enable, contract type and TOU rates. It is also invalidated for synchronous `setSetting()` writes, prior to the asynchronous settings event. SoC targets and feedback do not invalidate electrical configuration. Current tariff eligibility, meter power, EV feedback and age/validity, physical detection, Peak Guard and EV/battery headroom are read and checked as before on every P1. The memo does **not** contain a charging decision or a tariff-period verdict. No timers or polling loops were added.

A wider proposed cache with per-call inspection of every field was dropped after benchmarking: the validity checks could cost as much as rebuilding the small projection. The final narrow trusted-P1 design avoids those checks while preserving direct-read behavior for all other callers.

## Matched 90-second simulated Homey replays

All 12 profiles were compared against the exact input ZIP: EV/battery commands, final control state and publication timestamps were **identical**. These are counts of focused `evPhysicalSettingsRead` calculations, not full EV `evSettingsBuild` expansions (already optimized in the input version).

| Profile | Focused physical builds before | After | P1 configuration cache hits |
|---|---:|---:|---:|
| connected-stop | 92 | 2 | 90 |
| disconnected | 0 | 0 | 0 |
| connected-jitter | 92 | 2 | 90 |
| identical-feedback | 94 | 4 | 90 |
| live-status | 137 | 47 | 90 |
| disconnected-status | 0 | 0 | 0 |
| two-current | 376 | 16 | 360 |
| two-hybrid | 192 | 12 | 180 |
| no-battery | 96 | 6 | 90 |
| battery-disabled | 96 | 6 | 90 |
| pv-only | 188 | 8 | 180 |
| diagnostics-off | 92 | 2 | 90 |

The `evSettingsBuild` full EV-plan expansions did not change. The no-physical-EV scenarios have zero cache hits because no physical settings projection is needed. Physical safety/accounting still executes at the original cadence.

### Repeated host CPU samples

Three alternating 90-second pairs were completed for these three cases (median CPU milliseconds; Node host simulation, **not projected Homey CPU**):

| Scenario | Before | After |
|---|---:|---:|
| two-current | 211.8 ms | 186.3 ms |
| no-battery | 215.5 ms | 211.1 ms |
| pv-only | 362.4 ms | 359.7 ms |

Host CPU results varied by run, and a fixed Homey CPU percentage reduction is **not** asserted. Counts and exact control-output parity are more reliable evidence than host timing alone. Full data (including every recorded command and timestamp) are in both benchmark JSONs.

## Verification

Passed: new physical-config cache tests (separate EVs, actual internal/external settings invalidation, TOU changes, scenario snapshot isolation, unchanged SoC goal, passive monitor); existing physical settings/tariff parity (648 assertions); EV work 1.1.16 (9); EV plan centralization (32); planning monitor (6); EV battery protection (14); PV house-first (72); EV battery transitions (33); EV context delay (20); EV work 1.1.15 (22); EV feedback 1.0.11; EV deadline-cache 1.1.12 (238). The old `ev-input-work-1.1.12` run exceeded the execution limit and was not counted as passed. A complete uninterrupted `npm test` run was not completed.

## Deployment check

Start the 15-minute Planning Monitor with EV1 actively configured. Normal P1 processing should now produce `planningEvents.physical_config_reused:ev1` and far fewer `evPhysicalSettingsRead:grid_import_control` events. Editing phases, current limits or TOU rights must lead to a fresh physical build. EV commands, actual power and Peak Guard must still respond with the original timing.
