# P1 / EMS Control Loop Trace — diagnostic build 1.3.3

This opt-in diagnostic is available under **Settings > Diagnostics > P1 / EMS Control Loop Trace**.

1. Start the 15-minute recording while live P1 inputs arrive through `set_grid_power` or `set_grid_power_phases`.
2. View per-stage counts, settings snapshot counts and synchronous CPU/wall timings.
3. Stop the trace or let it expire, then select **Export JSON**.

The recording includes:

- Incoming P1 counts, phase-aware input counts and grid values (numeric only).
- Stages executed on each synchronous P1 path: Savings, Phase Guard, grid sampling, EV baseline/detection, HVAC observation, adaptive feedback, flexible-load safety, Hybrid watchdog (if applicable), EV/slow context gating and fast battery requests/evaluations.
- `getSettings()` copies attributed to the stage in which the copy was created.
- Fast evaluation requests, skipped/coalesced/scheduled decisions, battery candidate changes and output queue attempts; a queued command is **not** proof that the Flow action was executed.
- Explicit reasons for slow-context requests and separately counted deferred fast/context timer callbacks.
- Slow-context evaluations that happen *inside* a P1 call versus later/unattributed slow-context evaluations.
- Last 120 P1 cycles and aggregate stage timings. Counts remain cumulative during the session; old cycle detail rotates out.

## Timing cautions

Stage wall time and CPU are measured around synchronous function calls. Nested stages overlap and must not be summed (e.g. `battery_fast_evaluation` runs within `fast_request`). Process CPU during the full session is app-wide, not isolated P1 CPU. A timer's execution cannot reliably be assigned to the latest P1 measurement because many inputs and other triggers can share the same timer. Async Homey Flow completion is not included in synchronous timings. Recording itself adds measurement overhead and is deliberately limited to 15 minutes.

## Operational constraints

The trace is in-memory only, clears on app restart, has a single session-expiry timer and uses no new meter polling, control timer, setting writes, cache, battery commands or control decisions. When not started, the instrumentation only checks whether a recording exists. Existing diagnostics and Input Monitor & Loop Detection remain unchanged.

The app version stays **1.3.3** and Node.js stays **22**. The ZIP filename identifies this as a diagnostic build, not a new published release.
