# HomeFlux EMS

**Your energy, arranged differently**  
**Jouw energie, anders geregeld.**

## English

HomeFlux EMS brings your home’s energy together in one smart system. It decides when to charge or use your home battery, when to make the most of solar power, and when flexible loads such as EV charging, heating, cooling or hot water can run most efficiently.

Instead of being tied to one brand or one type of installation, HomeFlux works around the devices you already have and the energy contract you use. It supports both dynamic energy contracts and fixed contracts with different tariff periods, such as peak, off-peak or multi-rate schedules.

It continuously balances comfort, self-consumption, battery reserve, electricity prices and grid limits, while Peak Guard keeps peak consumption under control.

The result is simple: **use more of your own energy, buy from the grid at better moments, avoid unnecessary peaks and let HomeFlux coordinate everything automatically.**

## Nederlands

HomeFlux EMS brengt de energie in je woning samen in één slim systeem. Het bepaalt wanneer je thuisbatterij wordt geladen of gebruikt, wanneer zonne-energie het best wordt benut en wanneer flexibele verbruikers zoals EV-laden, verwarming, koeling of warm water het efficiëntst kunnen draaien.

In plaats van gebonden te zijn aan één merk of één type installatie, werkt HomeFlux rond de toestellen die je al hebt en het energiecontract dat je gebruikt. Het ondersteunt zowel dynamische energiecontracten als vaste contracten met verschillende tariefperiodes, zoals piek-, dal- of meervoudige uurtarieven.

HomeFlux brengt comfort, zelfverbruik, batterijreserve, elektriciteitsprijzen en netlimieten voortdurend in balans, terwijl Peak Guard het piekverbruik onder controle houdt.

Het resultaat is eenvoudig: **gebruik meer van je eigen energie, koop stroom op betere momenten, vermijd onnodige pieken en laat HomeFlux alles automatisch coördineren.**

## Homey API permission

HomeFlux EMS requests `homey:manager:api` only to access Homey's own Energy information for dynamic electricity contracts. The app creates a local Homey API client to read the configured electricity price type/zone and to fetch Homey Energy dynamic electricity prices. Battery, PV, EV and HVAC integrations are not discovered or controlled through this permission; those integrations use explicit Homey Flow cards. HomeFlux EMS does not require an external HomeFlux cloud service for this functionality.

## Patch notes
### v0.4.5
- Fixed night/tariff boiler fallback being stopped merely because **Peak Guard** became active. Tariff heating may now continue while the battery supplies the required peak-shaving support.
- Peak Guard remains authoritative: HomeFlux predicts the grid import after the next effective battery command and stops tariff boiler heating when the configured hard grid limit still cannot be respected.
- The existing boiler tariff SoC hysteresis remains unchanged: start at the configured tariff-start SoC and continue down to the separate tariff-stop SoC.
- PV-surplus boiler heating keeps its previous safety behaviour and still yields immediately to Peak Guard.
- No additional polling loop or repeating timer was added.

### v0.4.4
- Manual battery modes are now true overrides: only **Automatic** uses charge planning, forecast targets and planned reserve floors. Self-consumption, Battery Save, Avoid grid import, Forced charging and Stand-by follow their direct operating meaning while hard SoC limits and Peak Guard remain authoritative.
- Added optional **different battery power limits** for mixed battery installations. When enabled, each configured battery can have its own minimum/maximum charge and discharge power.
- Small requests below an individual battery minimum are never rounded upward; HomeFlux uses 0 W for that battery or reallocates the request to another suitable battery.
- Existing installations keep the shared per-battery limits by default; enabling individual limits starts from the previously configured shared maxima.

### v0.4.2
- Split charge planning into two explicit configurable target times: a **night-planning morning target** (default 07:00) and a **day-planning daytime target** (default 17:00).
- Night planning now only considers allowed charging windows from the previous daytime target up to the configured morning target. It no longer plans through the following afternoon/evening.
- Day planning starts from the morning planning boundary and only plans up to the configured daytime target. Both production control and the Planning/simulation views use the same phase boundaries.
- Added a regression case for the common TOU pattern **Superdal 01:00–07:00 → morning peak 07:00–11:00 → daytime/evening periods** so the overnight Superdal block remains available to the night plan.
- No extra polling loop or repeating timer was added.

### v0.4.1
- Moved the large settings-page EN translation dictionaries out of `settings/index.html` into dedicated translation assets under `settings/translations/`.
- The settings page now loads only the selected language bundle before rendering. Existing Dutch-source UI translation behaviour remains unchanged, while new dynamic UI text can use keyed translations through the shared `t()` helper.
- Reduced `settings/index.html` by roughly 97 kB without changing EMS control, planning, polling or API behaviour.

### v0.4.0
- Added an optional **low-PV day → sunny day** promotion. When the average home-battery SoC remains at or above a configurable threshold for the configured number of minutes during the active solar day, HomeFlux stops applying low-PV Battery Save for the rest of that solar day.
- The promotion is one-way for the current solar day, resets for the next day/night plan, and never changes the PV forecast itself. If SoC drops below the threshold before the timer completes, the timer restarts.
- The feature is disabled by default and reuses the existing one-minute context heartbeat; no new polling loop, repeating timer or Homey API traffic was added.
- Updated the EN/NL product text and added the GitHub homepage and issue tracker as Homey metadata.

### v0.3.9
- Removed the incorrect 100 kWh upper limit from **Minimum hoeveelheid zon voor zelfconsumptie (kWh)**. The field now accepts any finite value of 0 kWh or higher; percentage/SoC fields remain limited to 0–100%.
- No EMS logic, timers, polling or API behaviour changed.

### v0.3.88
- Replaced the coupled selected-month kWh/% reserve inputs with one clear **absolute Minimum SoC for day planning (%)**. Users can enter any valid value from 0 to 100%; HomeFlux converts it to the required energy internally.
- Existing installations migrate the old usable reserve to the equivalent absolute SoC target, so for example an 88% reserve above a 12% Minimum SoC becomes a 100% day-planning minimum.
- Clarified that both selected-month and sunny-month minimum SoCs apply to **day planning when PV is actually producing**. Without PV, night planning remains authoritative unless **also use minimum SoCs for night planning** is enabled.
- Added explicit numeric settings validation before saving. Empty, non-numeric and out-of-range values are rejected with a clear message instead of being silently converted or persisted.
- Internal planning remains PV-first and still respects Safety SoC, Max SoC, EMS charge limits and Peak Guard. No extra polling, timers or Homey API calls were added.

### v0.3.86
- TOU-tarieven hebben nu aparte laadkeuzes voor **weekdagen** en **weekend**: niet gebruiken, alleen 's nachts, alleen overdag of altijd.
- Nacht en dag volgen de actieve HomeFlux nacht-/dagplanning en zijn dus niet aan vaste klokuren gekoppeld.
- Een tariefblok dat over middernacht loopt wisselt op zaterdag/zondag 00:00 automatisch naar de weekendkeuze en op maandag 00:00 terug naar de weekdagkeuze.
- De v0.3.85 dag/nacht-vinkjes worden bij upgrade automatisch naar beide nieuwe keuzelijsten gemigreerd, zodat bestaand gedrag niet onverwacht verandert.
- 'Vermijd alle netimport' blijft prioritair en forceert beide laadkeuzes voor dat tarief naar 'Niet gebruiken'. EV-laden op werkelijk PV-overschot blijft beschikbaar.
- Geen extra polling, timers of Homey API-calls toegevoegd; de keuze wordt alleen tijdens de bestaande tarief- en planningsberekening geëvalueerd.

### v0.3.85
- TOU-tarieven hebben drie expliciete EMS-keuzes: laden 's nachts, laden overdag en alle netimport vermijden.
- Nacht- en dagplanner gebruiken rechtstreeks hun eigen geselecteerde tariefblokken; de simulatie gebruikt exact dezelfde planning.
- 'Vermijd alle netimport' heeft voorrang en schakelt conflicterend netladen, Battery Save/forecast-ontladen, boiler-fallback en standaard EV-netladen voor dat tarief uit. EV-laden op werkelijk PV-overschot blijft beschikbaar.
- Geen extra regelkring of polling: de nieuwe tariefvlaggen worden alleen in de bestaande tariefcontext/planningcache gelezen.

### v0.3.84
- Added **Minimumwaarden ook toepassen in nachtplanning**. It is disabled on upgrade so existing installations keep their current charging behaviour until explicitly enabled.
- When enabled, the selected-month kWh reserve or the non-selected sunny-month minimum SoC also participates in night planning for the next peak.
- Night planning now avoids double-counting PV: expected forward energy demand and the requested peak reserve are added first, then the relevant PV forecast is subtracted once. Only the remaining shortage raises the overnight SoC target and is distributed over allowed cheap charging windows.
- Month selection during night planning follows the forecast/target solar day, including across a month boundary. Daytime PV-first reserve behaviour remains unchanged.

### v0.3.83
- Fixed the fast P1 loop interpreting an unrestricted EV/battery coordination cache (`null`) as a numeric 0 W limit. JavaScript's `Number(null) === 0` caused a valid battery charge to be published briefly and then cancelled on the next fast evaluation, including when EV control was disabled.
- Preserved a real numeric 0 W coordination limit as valid, while `null` and `undefined` now explicitly mean “no EV-imposed battery charge limit”.
- Added regression coverage for both the EV-disabled/unrestricted path and a genuine 0 W coordination cap.

### v0.3.82
- Fixed forced home-battery charging being briefly published and then reduced to 0 W when a connected EV had grid priority. A battery `manual_charge` override now receives the available PV/Peak Guard headroom first; EV charging may use only the remaining room.
- Fixed the specific case where the remaining Peak Guard room was below the EV charger's minimum current. That unusable EV reservation can no longer suppress a forced battery charge.
- Cleared cached EV/battery coordination immediately when the battery override changes, so the fast P1 loop cannot reuse a limit calculated for the previous mode.
- Live status now refreshes its action and wattage after normal EV/battery coordination reduces a battery request, preventing a stale `Netladen ... W` header above 0 W battery commands.

### v0.3.81
- Replaced the rolling 24-hour view for fixed and time-of-use contracts with one peak-aligned planning cycle: from the first usable charging tariff after the previous peak through the end of the target peak.
- Production control and Planning simulation now use the same cycle and the same remaining cheap minutes. Required grid-charging energy is distributed over all still-available cheap windows before the target peak.
- The Planning and Planning simulation tabs keep the complete cycle visible. Past windows are shown as unavailable, the active window shows only its remaining usable time, future windows remain available, and the target peak is displayed separately.
- Fixed the 14:50 simulation case where the final charging window was incorrectly truncated at 14:50 on the following day and therefore appeared as if it could never be used completely.

### v0.3.80
- Made day and night planning strictly mutually exclusive. The night plan now remains authoritative after PV ends and across midnight until actual PV production starts; the first observed PV production clears the night phase and activates the day plan immediately.
- Added an optional PV-first **minimum SoC for non-selected months (sunny months)**. Selected months keep the existing kWh peak reserve. The new option is disabled on upgrade and uses its own minimum SoC; remaining PV is credited before any protection or cheap grid charging is requested.
- Changed forced battery charging (`manual_charge`) to request the maximum available charging power within the configured total/per-battery EMS limits. The former separate manual watt limit is no longer used, while Peak Guard remains authoritative.
- Added a read-only **Planning simulation** tab with test inputs for battery SoC, target SoC, PV forecast, live PV and local time. It runs the real automatic planning engine without changing settings, app state, Flow outputs or device commands. Results are discarded when leaving the tab, while entered test values remain available during the current Settings session.

### v0.3.60
- Settings save now writes only values that actually changed since the page was loaded or last successfully saved, instead of rewriting the complete HomeFlux settings set.
- Immediate module toggles are included in the saved baseline, so pressing **Save settings** afterwards does not write them a second time.
- Tariffs and the weekly schedule are also compared against their last saved state and are written only when changed.
- The Settings page reports **No changes** when there is nothing to save and shows how many changed values were written after a successful save.

### v0.3.59
- Renamed the former HVAC comfort minimum/maximum fields to **Heating temperature** and **Cooling temperature**. These are now independent targets and may be identical.
- Kept **Heat below** and **Cool above** as the only room-temperature triggers that choose whether a new PV HVAC session starts in Heat or Cool.
- Added **Allowed deviation for energy control**. With **Comfort first**, HomeFlux follows the configured mode target; with **Minimize PV surplus**, Heat may target up to `heating temperature + deviation` and Cool down to `cooling temperature - deviation`.
- Existing installations migrate the new deviation from the previous comfort-band width, preserving the old default 21–23 °C behavior as a 2 °C energy deviation.

### v0.3.58
- Fixed HVAC battery continuation: an HVAC session that was started by PV can now keep following its HomeFlux comfort target on the home battery while SoC remains above the configured stop threshold. Battery continuation can never start HVAC by itself.
- The configured HVAC battery stop SoC now remains enforceable for the whole continued session; when the threshold is reached, HomeFlux restores the original HVAC state immediately.
- Renamed **Automatic HVAC control** in Settings to **Let HomeFlux control HVAC** to make clear that HomeFlux is an energy overlay, not the normal thermostat.
- Clarified HVAC Live status by separating received/current HVAC mode and setpoint from the last HomeFlux output.

### v0.3.55
- Fixed HVAC Live status showing `0.0 °C` when no setpoint output had been published yet.
- Live status now falls back to the received HVAC setpoint until HomeFlux publishes its own setpoint.
- Fixed null setpoints being interpreted as numeric zero in the device status.

### v0.3.54

- Marked the five pre-numbering HVAC 1 input cards as deprecated compatibility cards so Homey hides them from the **Add Card** picker while existing test Flows can still run.
- The only intentionally unnumbered HVAC input remains **HVAC outdoor temperature**, shared by HVAC 1–4.

### v0.3.52

- Renamed the EV 1 input Flow cards and their internal card IDs to the same explicit numbering convention as EV 2–4: `set_ev1_status`, `set_ev1_soc` and `set_ev1_session_override`.
- Updated Settings and Help references so EV 1 inputs/outputs are fully uniform. This intentionally breaks the temporary pre-release unnumbered EV input cards while HomeFlux remains in private testing.

### v0.3.51

- Renamed the instance-1 HVAC input Flow cards to **HVAC 1** for the same numbering convention as HVAC 2–4 and the output cards.
- Kept **HVAC outdoor temperature** intentionally unnumbered: it is now explicitly one shared climate input used by every active HVAC controller.
- Removed the redundant HVAC 2/3/4 outdoor-temperature input cards and made the runtime/status logic always feed the global outdoor value into every HVAC instance.

### v0.3.50

- Renamed the instance-1 EV output Flow cards to `EV 1` and the instance-1 HVAC output Flow cards to `HVAC 1`, matching instances 2–4. The EV 1 SoC request output is numbered as well. This intentionally breaks the temporary pre-release instance-1 card IDs for uniformity while the app remains in private testing.
- EV and HVAC counts can now be set to **0–4**. With count 0 the detailed module configuration is hidden and no module inputs are requested or outputs calculated.
- Added a **Boiler count** of **0–1**. At 0 the detailed boiler configuration and tariff options are hidden and the boiler controller is disabled.
- Existing inactive instance-1 placeholders migrate to count 0; configured active modules are preserved.
- Flow cards remain statically declared by Homey and therefore cannot be dynamically removed from Homey's Flow picker based on settings. Runtime behavior and Settings are nevertheless disabled/hidden for modules configured as 0.

### v0.3.49

- Added support for up to four independently configured EV chargers and four HVAC devices. Existing EV/HVAC settings and Flow cards remain instance 1 for backwards compatibility; instances 2–4 use numbered bilingual Flow cards.
- Added optional custom names while always retaining the EV/HVAC instance number for Flow troubleshooting. Multiple devices use compact subtabs in Settings and individual Live status cards.
- Added per-HVAC battery continuation protection: when HVAC may continue on the home battery, it can be stopped again below a configurable battery SoC.
- Renamed the HVAC strategies to **Comfort first** and **Minimize PV surplus**.
- Added a boiler/water-heater module with a simple boolean output, PV-first start conditions, start/stop SoC, configured power, cumulative heating-cycle time, one completed cycle per day and a configurable warm hold (7 h default).
- Added tariff fallback after a configurable number of days without a completed boiler cycle. Fixed, TOU and dynamic tariffs each have explicit boiler permissions.
- Added a low-frequency thermal-load priority manager for the boiler and enabled HVAC devices. EVs deliberately remain outside this list. The manager evaluates every 5 minutes by default, starts at most one new thermal load per evaluation and adds no new polling loop.
- Added bilingual Help documentation and output tests for all new numbered EV/HVAC Flow cards.

### v0.3.48

- HVAC Heat/Cool activation is now based on room temperature instead of outdoor temperature.
- Added a comfort band (default 21–23 °C) and wider activation thresholds (default heat below 20 °C / cool above 24 °C).
- Added Comfort priority versus Maximize PV recovery: Comfort targets the nearest comfort boundary; PV recovery uses the full comfort band as thermal storage.
- Outdoor temperature now only determines fan speed. Cooling and heating each have Slow / Normal / Fast fan-response profiles; on a 5-step scale Normal reaches the highest level at about a 5 °C relevant temperature difference.
- Added the Then card **Set HVAC automatic control** so user Flows can enable or disable automatic HVAC steering without adding polling.
- Kept the HomeFlux slogan exactly: **Jouw energie, anders geregeld.**

### v0.3.45

- Shows the temporary one-session EV override explicitly in Live status, including whether it is armed for the next connection or active for the current charging session.
- Adds a dedicated **EV override** status capability to the HomeFlux EMS device with its own icon.
- The device capability is added automatically to already paired HomeFlux EMS devices after the app update.

## v0.3.44
- Added a **Then** Flow card to override the EV operating mode (`Smart`, `SoC target` or `Emergency charge`) for exactly one EV connection session.
- The override does not change the stored EV setting: it lives only in runtime state, so normal configuration automatically resumes after the session.
- If the EV is already connected when the Flow runs, the override ends on the next disconnect. If it is disconnected, HomeFlux waits for the next connect → disconnect cycle before clearing it.
- Repeated disconnected status updates cannot consume an armed override; a real connected session must have started first.
- The Help catalog documents the new Flow card in English and Dutch.

### v0.3.43
- Prepared the package structure for later Homey App Store publication without adding public support or repository links while HomeFlux remains in private testing.
- Store README files are now concise App Store descriptions instead of release histories.
- `homey-api` is pinned to exact version `3.19.2` and the dependency tree is locked for reproducible HP2016-compatible builds.
- Removed the duplicate inline `pv_power_limit_updated` Compose definition; the dedicated Flow Compose file is now the single source of truth.
- Documented why `homey:manager:api` is required for Homey Energy dynamic-price access.

### v0.3.42
- Daytime peak-reserve activation is now selectable per **calendar month** instead of per season.
- Existing Winter/Spring/Summer/Autumn choices migrate automatically to the equivalent months, so upgrades keep the same behavior until the user changes individual months.
- Keeps the v0.3.41 single-snapshot settings startup and lazy Help rendering.

### v0.3.41
- Settings startup now loads the complete HomeFlux configuration through **one read-only cached snapshot API call** instead of roughly 194 individual `Homey.get()` bridge calls.
- The snapshot is served directly from the existing RAM settings cache and does **not** run an EMS evaluation or rebuild planning.
- The previous parallel settings reader remains only as a compatibility fallback if the snapshot endpoint cannot be reached.
- The Help catalog is now built **lazily on first opening the Help tab**, so its 125 documented Flow/Logic items no longer add DOM/translation work to normal settings startup.
- Saving behavior is unchanged in this patch; the optimization targets opening/loading the settings page only.

### v0.3.40
- Added a configurable split-battery **direction confirmation time** per battery (default 15 s). A charge→discharge or discharge→charge request must remain continuously present before the mode may switch.
- Direction confirmation is combined with the existing active-mode and between-switch locks; the switch occurs only when all applicable times have elapsed.
- The confirmation uses timestamps plus the existing single recheck mechanism: no extra polling loop and no per-second calculation timer.
- Expanded the existing mode-controlled EV stop hold into a general **minimum stop time before EV restart** (default 60 s). It now applies after any actual HomeFlux STOP, including PV hysteresis and Peak Guard.
- EV restart hold is timestamp-only and is released by normal EMS/P1 evaluations; no extra wake-up calculation is scheduled.

### v0.3.39
- EV-first export margin now only reduces **existing** export that is larger than the configured margin.
- The margin is inactive at or below the target export, at 0 W, and during net import, so it can never create artificial export.
- This keeps the sustained grid-import stop timer authoritative during PV-only EV charging; Peak Guard behaviour is unchanged.

### v0.3.38
- Added a bilingual Help tab with all HomeFlux EMS input cards, output cards, Homey Energy Logic conditions and global Logic tags.
- Flow-card names in Help are generated from the Homey Compose definitions so English and Dutch stay aligned with the cards shown in Homey.
- Added searchable, grouped explanations for battery, split control, EV, HVAC, PV/forecast, planning and Homey Energy integrations.

### v0.3.37
- Added TOU EV-PV hysteresis: the PV surplus threshold is now a **start threshold** instead of an immediate stop threshold.
- Added per-tariff **stop from grid import (W)** threshold (default 1000 W) with a fixed 60-second confirmation time.
- Once a PV-only EV session has started, HomeFlux keeps it alive while PV fluctuates and stops only after the real P1/grid meter exceeds the configured import threshold continuously for the configured duration.
- Peak Guard remains absolute and stops the EV immediately; it never waits for the PV stop timer.
- The hysteresis uses the existing EMS evaluation/P1 updates and adds no extra polling loop.
- Current control can continue modulating below the start threshold; mode control keeps Smart permission active until the stop condition is confirmed.

### v0.3.36
- Added per-TOU-tariff **EV charging with PV surplus** permission, separate from standard/grid charging.
- Added a per-tariff **minimum PV surplus (W)** threshold for Smart EV charging.
- Existing installations preserve previous behaviour: PV charging is enabled for every existing tariff with a 0 W threshold.
- PV that is available still offsets grid demand whenever charging is allowed for another reason (selected tariff or target guarantee).
- EV-first 500 W export margin remains limited to charge-mode control; current control never uses that margin.

### v0.3.35
- Added a configurable **minimum EV stop time after Peak Guard** for mode-controlled chargers (default 60 s, 0 = off).
- Peak Guard STOP is still published immediately and bypasses the normal EV output interval.
- After Peak Guard stops the EV, HomeFlux keeps STOP active for the configured hold time and then recalculates from fresh measurements before allowing Smart/Standard charging again.
- Keeps the optimized v0.3.33 control loop, v0.3.34 EV-first export margin and HP2016-compatible dependency policy.

### v0.3.34
- Smart EV PV priority **EV first** can keep a configurable export margin (500 W default) instead of squeezing home-battery charging completely.
- The margin activates only when Smart mode, charge-mode control and EV-first PV priority are active **and measured EV charge current is above 0 A**.
- At 0 A the existing priority behaviour remains unchanged, so HomeFlux does not create an export margin merely while waiting for the EV to start.
- Keeps the v0.3.33 performance optimizations and HP2016-compatible dependency policy.
### v0.3.33
- Cached Homey settings in RAM to avoid repeated settings reads throughout the fast EMS loop.
- Reused charge planning for up to one minute unless a relevant input invalidates it.
- Removed a duplicate battery-change check per EMS cycle and deduplicated concurrent identical charge-plan Flow publications.

### v0.3.32
- Settings now show localized, user-facing Homey Flow card titles instead of internal Flow IDs.
- Flow references are intentionally compact: one overview at Battery 1 split control, one in EV and one in HVAC instead of a reference below every setting.
- The displayed English and Dutch names are sourced from the Homey Compose Flow definitions, so they match the titles shown in Homey.

### v0.3.31
- Added an optional per-battery safety mode resend for split/dual control. It is off by default and resends only the currently active charge/discharge mode at the configured interval (default 10 min).
- Safety resends never change mode, never reset mode-switch timers and never replay an old power setpoint.
- Settings now show compact related Flow-card references per configurable item.
- English is the default/main settings language; Dutch remains available as the NL locale.
- Brand slogan kept as “Jouw energie, anders geregeld.” / “Your energy, arranged differently”
- Keeps the HP2016-compatible dependency policy.

### v0.3.30
- Split-mode timer recheck is now independent of wattage deadband, so a blocked charge/discharge switch is recalculated exactly when its lock expires.
- Live status now always shows Charge / Discharge / Idle per battery and shows pending split-mode switch time.
- Fixed an upgrade-state bug where EMS output was effectively off after an invalidated charge test, while a stale stored ON value could still block starting the required retest.
- The EMS output checkbox and safety text now always mirror the same current backend state.
- Settings startup is faster by loading individual Homey settings through a small bounded parallel pool instead of one-by-one sequentially.
- Keeps the v0.3.28 lightweight status polling and HP2016-compatible dependency policy.

### v0.3.28
- Live status is now read-only: the 2-second UI poll reuses the last real EMS calculation instead of running an extra preview evaluation.
- Current meter inputs and actual published battery/PV/EV/HVAC outputs still refresh in Live status.
- Status polling pauses while the settings page is hidden, reducing unnecessary work further on older Homey Pro models.
- Keeps the v0.3.27 HP2016-compatible dependency policy.

### v0.3.27
- Restored the Homey API dependency chain to the versions selected by `homey-api` itself for Homey Pro 2016 compatibility.
- Removed the forced `socket.io-client` and `engine.io-client` overrides after instability on Homey Pro 2016.
- Keeps all v0.3.26 variable-price cleanup and v0.3.25 status indicators.

### v0.3.26
- Removed the legacy manual/test dynamic-price input from Energy contract settings.
- Dynamic and variable contracts now show that HomeFlux uses Homey variable prices and always use Homey Energy as the price source.
- Legacy saved manual dynamic-price test slots are cleared during migration; there is no manual-price fallback.

### v0.3.25
- Added four high-priority HomeFlux EMS device indicators with dedicated icons: next charge plan, total battery command, EV status and HVAC status.
- Battery command is shown as a human-readable charge/discharge total; EV and HVAC show compact live operating states.
- Retains the tested dependency overrides for `homey-api` 3.19.2, `socket.io-client` 4.8.3 and `engine.io-client` 6.6.6.

### v0.3.24
- Corrected the EMS driver Store image resolutions required by Homey publish validation: 75x75, 500x500 and 1000x1000.
- App Store images remain at their required landscape resolutions; only driver images are square.

### v0.3.23
- Added the required Homey Store images to the EMS driver manifest for publish-level validation.
- Added dedicated EMS driver icon and small/large/xlarge image assets under `drivers/ems/assets/`.

### v0.3.22
- Added persistent Homey Logic output tags for split-command charge and discharge power for every configured battery (up to 8).
- Split power Logic tags are updated before the matching power Flow trigger, so they can be used directly in any action card.
- The inactive split direction is published as 0 W; disabling split command also clears both split power tags.

### v0.3.21
- Added a separate per-battery **minimum time between mode switches** for split-command batteries (60 s default).
- A charge/discharge mode change now requires both the active mode minimum time and the battery-wide switch interval to have elapsed.
- Split-command defaults now load explicitly in Settings: 60 s timers, 100 W minimum power and minimum-power retention enabled.

### v0.3.20
- Per-battery split command output (up to 8 batteries): separate charge/discharge mode and power Flow triggers.
- Independent minimum hold times for charge and discharge mode (60 s default), with power sent 1 second after a mode switch.
- Optional positive charge-power value for LUNA-style registers, configurable minimum power (100 W default, up to 10000 W), and selectable 0 W charge/discharge mode.
- Split-command output is included in the charge test and changing its output semantics requires a new charge-test confirmation.

### v0.3.19
- Mobile settings/status cards are now more compact on phones: less padding, smaller metrics, smaller badges and tighter spacing so more live information fits on screen at once.
- EMS, EV, HVAC, Planning and Live status stay in two columns on typical phone widths and only collapse to one column on very narrow screens.
- The tweak focuses especially on Planning and Live status, where the status blocks were visually too tall on mobile.

### v0.3.18
- Renamed the PV-first reserve setting to **Minimumreserve voor volgende dag piek**.
- The reserve is now explicitly a **solar-day protection layer**, not a second night planner.
- During the solar day, HomeFlux always subtracts **remaining PV today** before protecting or cheaply topping up any reserve shortfall.
- During night planning the day-reserve function is automatically disabled; the normal energy/night plan remains authoritative.
- Added activation selection for the daytime reserve. Current versions expose this per calendar month and follow the Homey timezone.
- Planning now shows whether the day reserve is active, disabled by the current season, or disabled because night planning is active.
- Added regression tests for PV-first reserve handling, summer disablement, winter activation and night-planning separation.

### v0.3.17
- **PV always first for peak reserve:** the configured peak-period minimum no longer acts as an unconditional SoC floor. HomeFlux first credits the active remaining PV forecast and only plans/protects the shortfall that PV can no longer provide.
- Planning shows how much PV is credited toward the peak reserve and how much reserve remains to be covered after PV.
- A promoted full-day forecast can temporarily serve as the current-day fallback before a fresh remaining-today forecast arrives.

### v0.3.16
- Forward energy planning now uses **remaining PV today** during the active solar day. Energy already produced earlier in the day is represented by the current battery SoC and is no longer counted a second time.
- Battery Save/day classification deliberately continues to use the **full-day PV forecast**, so a good solar day does not become a low-forecast day merely because the day progresses.
- After PV production ends/night planning starts, both energy planning and day strategy use **tomorrow's PV forecast**.
- Added **Minimum peak reserve** next to Expected energy need. The reserve can be entered in kWh or as a percentage of total battery capacity; both fields stay synchronized.
- Peak reserve is calculated as usable energy above Minimum SoC, is protected before/after expensive tariff periods, and becomes available for normal discharge during the expensive price category. Peak Guard can still use reserve down to Minimum SoC when required.
- The charge target is now the highest of Safety SoC, forward energy target and peak-reserve target.
- Planning now shows separate **Energy-planning forecast** and **Strategy forecast** roles and the individual target components.

### v0.3.15
- Settings are reorganised into semantic groups: related minimum/maximum values stay together, long master settings can span the full width, and dependent fields are visually grouped below them.
- EMS battery SoC limits, charge/discharge power limits, output formatting, controller timing, battery control pause, grid target band and PV limiting are grouped more clearly.
- EV charging-current limits and timing are grouped; long operating-mode/control-type explanations use the full width.
- HVAC now groups activation, outdoor thresholds, cooling/heating comfort ranges, PV boost/reduction and fan scaling.
- Planning adds a **Charging strategy** block showing the configured energy need and cheapest charging hours. For dynamic contracts it explicitly explains that HomeFlux uses the cheapest known price slots to reach the forecast target and does not schedule grid charging in expensive slots.

### v0.3.14
- EMS, EV, HVAC, Planning and Live status keep a two-column layout at normal Homey settings widths; they only collapse to one column on genuinely narrow screens.
- HomeFlux dark/green colors are now force-applied to prevent Homey theme CSS from making the title, cards or buttons unreadable.
- Planning now shows **PV today (full day)**, **remaining today** and **PV tomorrow** at the same time.
- The forecast currently used by the EMS is highlighted as **Active**, with a separate decision forecast value and explanation of why that forecast is being used.
- Added regression tests to verify that night planning uses tomorrow while solar-day planning prefers today’s full-day forecast over the remaining-today value.

### v0.3.12
- Per tarief kan Batterij sparen nu toch ontladen tot het berekende forecast-doel SoC.
- Op het forecast-doel stopt normale ontlading; gepland netladen en Peak Guard houden voorrang.
- Beschikbaar voor vaste tijdstarieven, vaste contracten en dynamische prijscategorieën.

### v0.3.10
- PV exportbuffer volgt nu dezelfde instelbare batterij-SoC-drempel als PV-curtailment. Onder die drempel mikt de batterijregeling niet meer bewust op negatieve netexport.
- Mode-only EV-sturing: Slim via PV geeft `smart`; geselecteerd tarief/doelgarantie geeft `standard`; Emergency/SoC-doel blijft `standard`.

### v0.3.9
- Added an EV charger control type for integrations such as Smappee that expose **Stop**, **Smart** and **Standard** actions instead of a current setpoint.
- New Flow trigger **EV-laadmodus is bijgewerkt** publishes `stop`, `smart` or `standard`.
- HomeFlux **Slim** maps to charger `smart`; **Emergency charge** and **Op SoC-doel** map to `standard`; no permission maps to `stop`.
- Peak Guard remains absolute: a mode-only charger is stopped whenever safe operation would require a reduced current that cannot be expressed through Stop/Smart/Standard.
- EV SoC remains completely optional; with SoC disabled, the EV-SoC request schedule stays removed.

### v0.3.8
- EV-SoC is now optional for chargers/integrations such as Smappee that cannot report vehicle SoC.
- EV status and EV SoC are split into separate Flow inputs; EV-SoC has its own request trigger. When SoC support is disabled, that request schedule is removed completely.
- Added EV operating modes: **Slim**, **Op SoC-doel** and **Emergency charge**. Emergency charge starts immediately at the maximum possible current while Peak Guard remains absolute.
- Smart EV charging now has separate priorities for PV surplus and simultaneous planned grid charging: home battery first, EV first, or (for grid charging) shared.

### v0.3.7
- PV-begrenzing is nu pas toegestaan vanaf een instelbare gemiddelde batterij-SoC (standaard 95%). Onder de drempel of zonder geldige SoC wordt 100% PV vrijgegeven.
- Dynamische contracten gebruiken nu uitsluitend actuele Homey Energy-prijzen; handmatige testprijzen zijn uit de normale gebruikersinterface verwijderd.
- Settings compacter gemaakt met waar mogelijk twee kolommen en minder verticale witruimte.
- Batterij-stuurpauze verduidelijkt voor batterijen die bepaalde periodes niet in hun laadschema kunnen opnemen.
- Discrete Support-tab toegevoegd met de vrijwillige Buy Me a Coffee-link.

### v0.3.6
- Added an optional daily battery-command pause, defaulting to 23:59–00:00 when enabled. During the pause HomeFlux holds the last battery setpoint and does not calculate or publish a new one; control resumes immediately after the window with fresh measurements.

### v0.3.5
- Batterijregeling mikt bij een overschrijding van de nulpuntband voortaan op het **midden tussen onder- en bovengrens**. Een band van 5–25 W geeft dus een doel van 15 W. Binnen de band blijft het laatste setpoint behouden. Dit vermindert kleine opeenvolgende correcties.
- App metadata bijgewerkt: auteur **Davy Bert**, brand color `#4F8A10` en de HomeFlux-slogan toegevoegd.
- Korte Homey Store-readmes toegevoegd in Engels (`README.txt`) en Nederlands (`README.nl.txt`).

### v0.3.4
- EV-tab volgt automatisch het contracttype en de tariefselecties uit Energiecontract.

### v0.3.3
- Configureerbare HVAC-ventilatorschaal met minimum, maximum en stapgrootte.

### v0.3.2
- EV- en HVAC-inputwaarden verversen live terwijl het tabblad openstaat.

### v0.3.0
- Optionele EV- en HVAC-modules toegevoegd met Peak Guard als absolute prioriteit.


## Changelog

### v0.3.57

- Separated the meter-driven battery regulator from the slow EMS context loop.
- The fast loop now handles only current grid/PV input, battery safety and the required battery setpoint.
- EV, HVAC, boiler, tariff, forecast, Homey Energy and device/status context are consolidated behind one adjustable slow scheduler (default 60 seconds), while urgent safety actions remain immediate.
- Added a configurable minimum interval between charge-plan calculations (default 5 minutes). The last valid plan remains active while changes are throttled; manual refresh and key planning transitions can still force an immediate rebuild.
- Read-only Live status reuses cached runtime context, and unchanged Flow/device output is skipped.

### v0.3.56
- Boiler warm-state is now reset at a fixed local clock time (default 07:00) instead of a relative cooldown duration. A daytime PV cycle therefore remains warm through the night until the next reset boundary.
- Boiler tariff heating now has SoC hysteresis: start only when the battery reserve reaches 40% by default, then continue until 30% before stopping. It will not restart until 40% is reached again, preventing on/off cycling while the batteries are charging.

### v0.3.53
- Added a separate **Boiler warmed** output card with a boolean Yes/No token.
- The warmed state becomes true after a completed cumulative heating cycle and automatically returns to false when the configured warm-hold period expires.

### 0.3.47
- Fixed the EV/HVAC output-test layout on narrow settings screens. Mode selectors and their test buttons now stack cleanly instead of overflowing the card.
- No control logic or Flow output behavior changed.

### 0.3.46
- Added manual EV and HVAC output-test controls in Settings.
