# HomeFlux EMS 1.2.19 verification

## Changes

- Battery Save Autotune uses the median of qualified daily minimum SoCs instead of morning target-time SoCs. At least three valid daily minima are required; hard floors and existing confidence/rate limits remain in force.
- Daily minimum tracking includes accepted battery SoC updates between slow samples. The compact minimum is persisted only when a lower tenth-percent value or a new local day is observed. A restart retains that day's earlier minimum. No new sampling loop or timer was added.
- Separate on-demand battery response tool: one explicit click, five cycles of 0 W / 400 W TOTAL charging / 0 W, raw P1 detection with +/-40 W tolerance, and a persistent last successful result.
- Existing charge/discharge test methods and all existing Flow definitions are byte-identical to 1.2.18. The response tool never changes charge-test validation or the selected EMS mode.
- The response tool exclusively owns publication only while the user-started test runs. It returns to zero on stop, timeout, safety interruption, transport failure or restart cleanup, then requests a fresh normal EMS context where appropriate. No automatic repetition, daily test, extra polling or background regulation engine.
- Manual response pulses are excluded from Autotune control-noise learning; automatic tuning is deferred only while this user-started tool runs. The existing P1 cadence bookkeeping continues.
- One bounded safety timeout exists only while a manual test is active. An interrupted test is stopped on restart; its pulses are never restarted automatically.
- Read-only guidance combines the slowest measured charge/zero response and measured P1 cadence with the current averaging selection. Example: 4 s response + three 1 s P1 samples gives a 7 s lower recommendation. Orange advice appears beside the averaging setting and response tool when the chosen command interval is shorter. No setting is automatically applied.
- NL/EN/FR/ES/DE strings and release notes included. Website descriptions, slogan, deprecated cards and unrelated control/planning modules retained.

## Verification

- 20 targeted development suites passed, including Autotune and the new response diagnostic regression coverage.
- Existing 0.7.16 test mock lacked Homey log() and setTimeout(), also failing unchanged in 1.2.18. The mock was completed; its assertions were retained and the requested 2000 ms migration delay is asserted.
- 9 genuine app/engine/planner replay scenarios matched 1.2.18 exactly while the response tool was inactive: 2160 samples plus battery, EV, HVAC, boiler and PV commands/publication timestamps.
- 10 host-browser checks passed across all five languages at 393 and 1280 px: localized controls, orange warning, 4+3=7 guidance, changes to averaging/interval, single-click start/stop and no automatic setting writes.
- Changed JavaScript, inline Settings JavaScript and all JSON were syntax-checked. Placeholder checks passed for the new localized UI strings.
- Independent algorithm suites were skipped; their source was unchanged. No app was installed or published on a Homey.

## Limits

The timing test depends on stable P1/household/solar conditions and existing Flow integrations. An unrelated coincident load change cannot be ruled out using P1 alone. The recommendation is conservative guidance for the tested charge/zero path; discharge latency is not separately measured. Physical Homey/battery performance remains unverified.
