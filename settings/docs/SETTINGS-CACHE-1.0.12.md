# HomeFlux EMS 1.0.12 — verification

Based on the supplied 1.0.11 build. Only settings-cache construction changed, together with version metadata and short release notes.

The four private mode-only EV tolerance fields are declared when creating the cache. All 565 production settings and values remain identical.

- All 50 test suites and syntax checks passed (`npm run check`).
- The new genuine-startup cache regression test fails on original 1.0.11 and passes on 1.0.12, including legacy mode tolerances and cache rebuilds.
- All 28 EV scheduler scenarios retain identical complete battery/EV/Split/context outputs and timing versus 1.0.11.
- Three 30-minute replay scenarios retain identical counters, method-call counts, timed I/O and pending/publication behaviour.

| Container replay | 1.0.11 CPU ms | 1.0.12 CPU ms |
| --- | ---: | ---: |
| quiet | 2417 | 719 |
| polling | 3771 | 1816 |
| delayed | 2204 | 725 |

These are process-CPU costs in Node 24.19.0 with synthetic input, virtual time and mocked Homey I/O, after ten virtual warmup minutes. They are not Homey CPU percentages. The target Homey uses Node 22.23.3; hardware CPU improvement still requires confirmation there.

Dependency versions, engine algorithms, timers, Flow cards, widgets, store texts, UI and prior release history are unchanged. The settings UI version remains hidden.

Release note: Reduced CPU usage through more efficient settings processing.
