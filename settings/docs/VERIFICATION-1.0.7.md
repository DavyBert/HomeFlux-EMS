# HomeFlux EMS 1.0.7 — verification

Based on the latest available 1.0.6 source, including sticky charging and the fast-control fixes.

## Scope

- Independent day/night planned-charge SoC maxima, both 100% by default.
- A shared cap applied after the existing energy-target calculation in schedules and runtime evaluation. The original energy target remains available to the existing discharge/EV strategies.
- Planned charging stops at the phase cap; live solar capture retains the existing battery limits. Safety recovery and manual charging keep their independent paths.
- Planning energy need and the PV threshold moved to the top of energy planning, with persistent explanations and NL/EN translations.
- Status shows the planned target and active SoC bounds. Timing uses the existing discharge floor, current tariff charging bound, or global maximum for PV/manual charging.
- EV PV-allocation text is hidden unless the existing physical PV budget actually contributes to that EV. EV commands and allocation calculations are unchanged.

## Tests

`npm run check`: all 45 suites passed, including syntax checks.

New regression coverage: day/night caps across fixed, TOU, hourly dynamic and quarter-hour dynamic contracts; capped energy requirements; changed forecasts/settings; full and cached evaluations; phase changes; reached-target hysteresis; PV above the cap; clouds; global battery limits; Safety recovery; manual charging; Peak Guard; protected discharge floors; settings migration/restart; NL/EN widget bounds and EV PV/grid/battery display scenarios.

A direct comparison against the original 1.0.6 engine produced identical existing outputs at 100% defaults for 2,304 battery evaluations and 384 schedules. Added reporting fields were excluded from this comparison.

Existing EV tariff, emergency, smart, standard, SoC/deadline, pause/resume and physical-budget suites also passed. One existing price restart test now freezes its fixture clock during startup so its curves do not expire when run on a later date.

Integrity checks confirmed unchanged Athom descriptions, all Flow-card definitions (including deprecated cards), and EV control modules. All application/package manifests report 1.0.7.

Tests use Homey test doubles and simulated measurements; physical battery/EV hardware was not exercised.
