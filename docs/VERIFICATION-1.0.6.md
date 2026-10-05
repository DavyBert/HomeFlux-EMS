# 1.0.6 verification

- `npm run check` passed: JavaScript syntax checks and 44 test suites.
- Existing battery, Peak Guard, PV, EV, HVAC, boiler, Hybrid EMS, Savings, Autotune, planning and performance regressions passed.
- New tests cover all 15 non-empty source subset/order combinations, migration of the four historical modes, three-stage calibrated fallback and rejection of unselected sources.
- Shared parser tested with 15/60-minute arrays and timestamped curves through 120 hours, malformed JSON, invalid arrays, period merging and 23/25-hour DST days.
- Actual generic and deprecated Flow listeners tested for separate source state, atomic rejection, independent saved curves and restoration after restart.
- UI controls tested for checkbox-only source selection, removal of the obsolete dropdown and event handler, priority swaps without duplicates, dynamic position count and retaining at least one selection.
- Widget API and DOM/SVG tests passed for separate external inputs, missing and future-only curves, unavailable source rows, null prices, NL/EN status reasons, stable priority numbers, up to three lines, visibility toggles and configured currency.
- App/package/Compose versions and generated Flow/widget schemas agree on 1.0.6.
- Athom `README.txt` and `README.nl.txt` exactly match the supplied 1.0.5 archive.

Validation was performed locally with Homey test doubles. Installation and live operation on a physical Homey were not performed here.

- Alignment/name tests cover current-day fitting versus divergent future forecasts, robust outliers, rejection of unrelated/flat/sparse data, common 15/60-minute resolution, Brussels timestamps and DST, all three requested failover orders, cache reuse/invalidation, restart persistence, custom-name defaults, live Flow suggestions and stable saved selections.
- The original external/PBTH deprecated Compose files match the preceding package byte-for-byte. The previous generic dropdown schema is retained, with only its deprecated flag added.
- Battery-engine behavior is unchanged: its source matches the preceding package after removing the two presentation-name defaults.

- The supplied 139/191-slot arrays reproduce hourly prices repeated in quarter-hour slots. Complete current-day hourly averages align with factor 0.999859 and offset 0.100035/kWh; fallback actually activates when the primary disappears. Original slots are preserved. Added coverage includes incomplete hours, genuine quarter data, half-hour-shifted repeats, missing slots, and repeated hourly data on 23/25-hour DST days.

- Fast-control audit: planned charging participates in meter feedback; forced evaluations preserve their intent across cooldown/coalescing. The 44-suite check includes real Flow/API input paths with Homey doubles, same-zone export/import, deliberate planning floors, day/night and fixed/TOU/dynamic contracts, timer force upgrades, output locks and safety limits. See FAST-CONTROL-AUDIT-1.0.6.md.

- Charging efficiency selection now mirrors the discharge incumbent hold, including the inclusive SoC deadband boundary, magnitude tie-breaking during handovers, real output ownership and settings resets. Tests cover full/unknown SoC exclusion, individual charge limits, immediate total-power changes and actual publication through a complete four-step handover.
