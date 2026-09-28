# HomeFlux EMS 1.0.0 — EV session pause and resume

A connected EV session distinguishes charging, paused and completed. Sixty seconds without matching mode-controlled charging power now shows **Charging paused**. This observation does not send Stop, finish the session, clear a temporary mode override or reset remaining kWh. A vehicle swap without disconnect/completion feedback can therefore resume the same tracked session.

For one connected mode-controlled EV, HomeFlux compares physical consumption above its learned house reference with the power configured for the published Smart or Standard mode. It uses the configured feedback tolerance (5/10/15/20%, default 15%), with a 250 W minimum margin. Battery power and PV are included in physical-load reconstruction. At least two fresh P1 samples spanning five seconds confirm a start or resumption. A gap longer than 60 seconds restarts observation; replayed samples do not advance it. No additional polling timer is used.

The EV grid allowance becomes zero when matching charging load disappears and stays zero while a resume is being confirmed. During that confirmation the observed load already counts as existing consumption for Peak Guard, so it cannot be counted twice and block its own restart. Confirmed EV attribution is capped at the configured mode power; additional house demand does not increase that cap.

A session completes only on the existing completion Flow card, fresh enabled SoC reaching the active goal, or delivery of the requested kWh as calculated from actual charging-current feedback. Emergency mode uses a 100% SoC goal. Reaching a SoC/kWh goal now stops this session even during favourable tariffs or available PV. An explicit disconnect clears session tracking and a reconnect arms the persistent target again. A new planning target or mode override can rearm a target-completed session. Tariff restrictions and Peak Guard can still command Stop without completing the session.

## Measurement boundaries

P1 load recognition is an estimate, not vehicle identification. Another load resembling the configured EV power can be indistinguishable on a shared meter. With multiple connected EVs, P1 remains a portfolio measurement and does not guess individual session transitions. The tested airfryer scenario uses three-phase 400 V, Smart 6 A (about 4.16 kW), Standard 16 A (about 11.09 kW), and a 2 kW switching appliance.

A kWh target needs actual charging-current reports: mode commands and inferred P1 load do not count as delivered energy. Current is integrated only for up to 60 seconds after each real report and never through a detected pause. Slower or missing current reporting can undercount energy; use fresh SoC or the explicit completion Flow where reliable current telemetry is unavailable. This is a calculation from current and configured voltage, not a cumulative energy-meter reading.

## Validation

`npm run check` includes the existing regression suites and `test/regressions-1.0.0.test.js`. The new scenarios cover Normal/Smart charging, an alternating 2 kW airfryer before/during/after a pause, automatic resume, a fast vehicle swap, missing/replayed P1, PV/battery reconstruction, fresh/stale SoC, kWh integration and completion, all four EV slots, and real portfolio Peak Guard/tariff decisions during pause and resume. Validation is simulated; no physical charger was used.
