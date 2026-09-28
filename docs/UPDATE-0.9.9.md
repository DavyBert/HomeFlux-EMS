# HomeFlux EMS 0.9.9

## Autotune scheduling

Autotune measurement intake remains live and lightweight. P1, PV and EV inputs continue to update the existing rolling aggregates immediately; no raw measurement history or extra polling loop is added.

Automatic recommendation evaluation is no longer started from the one-minute heartbeat. When an automatic Autotune check becomes due, the heartbeat only requests the existing slow context scheduler. The recommendation calculation then runs inside that shared context path. The existing 30-minute minimum between automatic Autotune checks remains unchanged, so the change can only coalesce work and cannot increase the automatic evaluation frequency.

Immediate/safety context passes do not independently create a faster Autotune loop. A scheduled `autotune_due` context pass may still execute the due check, and startup may initialize the normal automatic state. Manual Autotune actions remain user-driven.
## Diagnostics

HomeFlux EMS now includes four independent, opt-in diagnostic channels: Planning, CPU, Errors and Memory. Diagnostics are disabled by default and are intended for temporary troubleshooting only. Enabling the first channel starts one diagnostic session with a fixed maximum duration of 48 hours. Enabling or disabling another channel does not extend that deadline. When the deadline is reached, all four diagnostic switches are turned off automatically, including across app restarts.

Planning diagnostics are recorded only when a real plan recalculation occurs. Each event references a deduplicated configuration snapshot so the plan can be analysed together with the HomeFlux settings that produced it. Relevant runtime inputs and the calculated plan are included. Sensitive token, password, credential, API-key, authorization and cookie fields are redacted; external dynamic price slot payloads are excluded from the configuration snapshot.

CPU diagnostics collect per-minute process CPU samples, counters for the fast P1/control path and timings for the major evaluation/output paths. Memory diagnostics sample Node.js memory metrics once per minute. Error diagnostics retain a bounded buffer of HomeFlux errors and stack traces. All buffers are bounded and remain in memory so diagnostics do not add periodic storage writes; after an app restart the measurement buffer starts fresh while the original 48-hour expiry remains in force.

The diagnostics settings listener is isolated from the EMS dirty/context scheduling path. Turning diagnostics on or off therefore does not request a planning recalculation, change the P1 cadence or alter battery command timing.

