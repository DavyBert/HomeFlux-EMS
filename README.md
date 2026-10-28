# HomeFlux EMS

**Your energy, managed differently**

HomeFlux EMS manages home batteries around your tariff, PV forecast, self-consumption and grid limits. The hardware connection stays flexible through Homey Flow cards.

## Quick start

1. **Configure HomeFlux**  
   Add your battery count, capacity, battery limits, tariff periods and Peak Guard limit in Settings, then save the configuration. For a dynamic contract, select Homey, External Price 1 and/or External Price 2, then set their priority order and optional external-source names; fallback prices are aligned to the primary source including surcharges. For batteries with different power limits and/or capacities, enable the individual settings and enter each battery’s capacity in kWh and power limits in W.

2. **Feed the basic inputs through Flow**  
   Use **Set grid power**, **Set PV power** and **Set battery SoC**. For battery planning, also provide **Set remaining PV forecast** and **Set tomorrow PV forecast**. Grid power uses positive = import and negative = export. If you select an external price source, use **Read external prices JSON**, select the external source by its configured name (default **External Price 1** or **External Price 2**) and connect your provider’s JSON token. For arrays without timestamps, select the matching period; resolution follows your dynamic contract. Curves support up to 120 hours. Existing PBTH/external price Flows keep working as External Price 1; earlier generic source selections remain intact.

3. **Send the battery output to your battery integration**  
   Use **Battery commands are updated** for batteries that accept a power setpoint. If your battery requires separate charge/discharge modes and power values, enable Split Command and use the corresponding **Battery: switch to charge/discharge mode** and **Battery: charge/discharge power is updated** cards.

Once these inputs and outputs are connected, HomeFlux can perform the core battery control and planning. After reaching the charging target, a 2-percentage-point restart margin avoids small grid top-ups. In automatic mode, charging can restore Safety SoC outside tariff windows, subject to Peak Guard and battery limits.

Optional day and night planning maxima (default 100%) limit planned grid charging. Solar surplus can still charge above these planning limits within the battery safety limits.

An optional sunshine reserve limits normal battery discharging based on dated forecasts. Select the applicable tariffs under Energy contract (expensive/peak excluded by default), enable it in Settings and supply **Set expected sunshine probability today and tomorrow** through Flow.

Optional multi-battery efficiency optimization uses an individual optimal power target per battery and gradual SoC-based rotations. Enable it under Batteries when at least two batteries are configured.

Optional features include EV charging with automatic pause/resume detection, HVAC, boiler control, Hybrid EMS integration, dynamic-price inputs, Autotune, Savings with historical views and CSV export, diagnostics and dashboard widgets.

For the complete functionality, configuration and all Flow cards, see:  
https://github.com/DavyBert/HomeFlux-EMS/discussions/3

---

## HomeFlux EV Dashboard widget

Add **HomeFlux EV** to an official Homey Dashboard. Enable **Switch Status / Planning / Insights with buttons** to select one view at a time; **Status** is first and shows the EV and its central charging target/deadline without planning controls. Enable only **compact EV Status** and disable Scheduler/Insights for a small read-only widget. Each instance retains its own EV and tab selection. Switching is off by default; existing combined layouts remain supported. Configure each EV's SoC/kWh mode, three goals, three times and consumption in the existing EV settings tab. Tap a preset twice within five seconds to confirm. Guaranteed uses the existing EV deadline Flow handler and may include expensive periods when necessary; without a goal and deadline it remains a local draft.

Choose Standard or 1–7 days ahead and confirm twice within five seconds. The deadline is fixed in the local Homey time zone and survives midnight and restart. You can edit date and time within the chosen horizon. Max PV defaults to off and reserves only known solar after household demand and battery priority. Without an hourly forecast, a full day is not credited to a morning deadline. Guaranteed observes the latest safe start within physical limits. Only widget plans defer ordinary Flow mode overrides until clear or confirmed disconnect; the latest received override then resumes. On confirmed disconnect the Flow SoC/kWh goal that preceded the widget goal is also restored through the existing input handler. Manual clear still clears the goal. Existing Flow plans retain their behaviour. A completed widget goal stays visible and protected while the EV remains connected.

Peak Guard uses only the HomeFlux household-meter estimate for Mode control, and only fresh Flow current feedback for Current and Hybrid control. A configured or commanded charging current is not measured consumption. The EV widget Emergency button requires two confirmations, ends an active widget plan and selects the existing Emergency mode to 100%. Switching it off selects Smart charging. Existing Flow goals remain stored.

For Mode control, the house reference freezes at a successfully published Smart/Standard command and is released only by a successfully published Stop command. Session status, a computed Stop and disconnect alone do not release it. Publication receipts and the reference survive restart. See [Mode house-reference correction](docs/EV-HOUSE-PUBLICATION-1.2.5.md) for tests and the remaining historical STOP case.

Insights subdivides the existing Savings daydata. Mode control records the existing valid HomeFlux P1/PV/battery estimate; Current and Hybrid use fresh Flow current. Commands and placeholder currents are never delivered energy. Missing/stale observations do not backfill energy. Energy from current feedback and common-bus source attribution is estimated; shared meters, stale feedback and unmeasured battery flows can leave unknown or incomplete data. Solar kilometres use charger input and do not deduct unknown charging losses. Solar charging cost includes forgone export compensation. No data is backfilled into historical days. The Savings CSV appends stored EV totals and EV 1–4 breakdowns, including source, known cost and estimated savings; missing historical EV data stays blank. The original 14 columns retain their meaning.

## Release notes

### 1.2.5

Mode-control EV energy is now recorded from the existing valid P1 estimate into the same Savings daydata and CSV. Emergency and active guaranteed charging retain grid permission independently of PV, within physical Peak Guard limits. The three EV tabs remain Status, Planning and Insights. See [validation and scope](docs/EV-REGISTRATION-1.2.5.md).

### 1.2.4

Added new widget: EV scheduling & insights.

Nieuwe widget toegevoegd: EV-planning & inzichten.

### 1.2.3

The WAF energy balance refreshes every five minutes independently of battery charge planning and EV goals or tariff horizons. It covers household demand, battery reserves and remaining solar; EV planning reservations are excluded. It stays available across morning and afternoon target times while preserving the real PV-based night transition.

### 1.2.2

Battery charging and discharging limits now support up to 100,000 W per battery and for the complete group, with single or split commands. Existing power settings and defaults remain unchanged.

### 1.2.1 – Smarter Energy Insights

- Added a household energy budget indicator showing estimated surplus after household demand and daytime battery charging to the configured maximum SoC.
- Added critical EMS status alerts to the widget, alternating with the current decision.
- Introduced intelligent status colors for easier interpretation of energy values.
- Added independent widget settings for the energy indicator, critical alerts, and status colors.
- All new widget options are enabled by default, including for existing widgets after updating.

Implementation and validation: [Smarter Energy Insights](docs/smarter-energy-insights-1.2.1.md).

### 1.1.20

Persistent EV Flow planning: SoC and kWh targets retain their deadline time and guarantee across app/Homey restarts until Clear EV planning or replacement by a new Flow target. Recent kWh progress is saved on normal shutdown; a completed target is not refilled merely by restarting with the EV connected. Zero kWh remains a completed Flow target. Fresh positive current feedback takes precedence over house-load estimates for mode-controlled EVs, so Peak Guard correctly accounts for power already drawn by the EV. Planning diagnostics expose the shared Peak Guard calculation.

Blijvende EV-Flow-planning: SoC- en kWh-doelen behouden hun tijd en garantie na een app-/Homey-herstart en verdwijnen alleen na Wis EV-planning of vervanging door een nieuw Flow-doel. Recente kWh-voortgang wordt bij normaal afsluiten opgeslagen; een voltooid doel wordt niet opnieuw gevuld door een herstart met aangesloten EV. Ook 0 kWh blijft een voltooid Flow-doel. Verse positieve laadstroomfeedback krijgt bij EV-modussturing voorrang op huislastschattingen, zodat Peak Guard werkelijk aanwezig EV-vermogen correct meerekent. De planningsdiagnostiek toont de gezamenlijke Peak Guard-berekening.

### 1.1.19

An evening restart without an observed PV start/end now aligns the inferred night with the following morning and tomorrow’s solar forecast. Observed night plans, dark-morning continuation and the existing PV transition remain authoritative.

Een herstart in de avond zonder waargenomen PV-start/-einde koppelt het afgeleide nachtplan aan de volgende ochtend en de PV-voorspelling van morgen.

Dynamic battery night planning compares known prices up to the morning target across midnight. The preferred cheap-hours duration expands when needed for the remaining energy; normal-price charging keeps its own SoC cap. SoC and solar forecasts keep updating the active plan. Day planning, fixed/TOU tariffs, EV deadline planning, solar capture and safety limits retain their existing rules.

Dynamische batterijnachtplanning vergelijkt bekende prijzen tot het ochtenddoel over middernacht heen. De voorkeursduur voor goedkoop laden wordt indien nodig uitgebreid voor de resterende energie; normaal laden behoudt zijn SoC-limiet. SoC en PV-voorspellingen blijven het actieve plan bijwerken.

### 1.1.18

Dynamic battery night planning compares known prices up to the morning target across midnight. The preferred cheap-hours duration expands when needed for the remaining energy; normal-price charging keeps its own SoC cap. SoC and solar forecasts keep updating the active plan. Day planning, fixed/TOU tariffs, EV deadline planning, solar capture and safety limits retain their existing rules.

Dynamische batterijnachtplanning vergelijkt bekende prijzen tot het ochtenddoel over middernacht heen. De voorkeursduur voor goedkoop laden wordt indien nodig uitgebreid voor de resterende energie; normaal laden behoudt zijn SoC-limiet. SoC en PV-voorspellingen blijven het actieve plan bijwerken.

### 1.1.17

Active EV SoC/kWh targets compare available dynamic prices up to their deadline across calendar days. For an active deadline, “Cheap” selects the cheapest required charging energy within that EV window rather than the battery's daily price ranking. Small price differences can retain a contiguous or existing plan; unknown prices are never treated as cheap. Existing PV charging, deadline guarantee permissions, import limits and Peak Guard remain active. Without an active deadline, the configured tariff preferences are unchanged. Battery targets and midnight PV-forecast updates keep their own planning.

Actieve EV-SoC/kWh-doelen vergelijken beschikbare dynamische prijzen tot de deadline over kalenderdagen heen. “Goedkoop” kiest bij een actief doel de goedkoopste benodigde laadenergie binnen dat EV-venster. Kleine prijsverschillen kunnen een aaneengesloten of bestaand plan behouden. Onbekende prijzen zijn niet automatisch goedkoop. De batterij behoudt haar eigen doelmomenten en verwerking van nieuwe PV-voorspellingen na middernacht.

### 1.1.16

Physical EV control now reuses unchanged electrical configuration and tariff permissions between P1 measurements. Live power, tariff boundaries and safety checks remain current; relevant settings changes refresh the cached configuration.

Reduced EV CPU work during frequent P1 updates by replacing redundant full EV settings expansions with targeted electrical and tariff-permission reads. Diagnostics now distinguishes full settings expansion from physical settings reads by source.

More efficient EV charging plans: repeated SoC and kWh Flow targets avoid unnecessary updates, calendar work and tariff scans. Physical EV accounting and Live status now avoid redundant settings expansion. A heartbeat sharing an already completed, unchanged EV pass skips a duplicate allocation; a completed, still-connected session can remain quiet after STOP and physical load have settled. New input and time boundaries continue to trigger fresh checks.

Efficiëntere EV-laadplanning: herhaalde SoC- en kWh-doelen via Flow vermijden onnodige updates, kalenderwerk en tariefscans. De fysieke EV-vermogenscontrole en Live-status bouwen minder vaak volledige instellingen op. Een heartbeat kan een identieke, net afgehandelde EV-berekening overslaan; ook een beëindigde, nog aangesloten sessie blijft na STOP en het verdwijnen van restbelasting rustig. Nieuwe invoer en tijdsgrenzen blijven opnieuw controleren.

New 15-minute planning diagnostics show actual battery SoC plans, battery charge-power calculations, EV decisions, tariff-window scans, settings expansions and SoC deadline lookups. Each route has execution counts, frequency warnings and CPU/wall time, separately from incoming Flow loops. The JSON export contains the same measurements.

Nieuwe planningsdiagnostiek tijdens de bestaande opname van 15 minuten: werkelijk uitgevoerde batterij-SoC-plannen, batterijlaadvermogensberekeningen, EV-beslissingen, tariefvensterscans, instellingenopbouwen en SoC-deadlineopzoekingen. Per route zijn aantallen, frequentiewaarschuwingen en CPU-/rekentijd zichtbaar, apart van inkomende Flow-loops. De JSON-export bevat dezelfde meetgegevens.

Further EV planning improvements: SoC feedback and status displays avoid full EV settings expansion; Flow SoC deadlines use one calendar lookup per minute while preserving precise timing. A duplicate five-minute guarantee tariff-window suffix is reused within the same decision. The monitor adds per-EV plan revision requests, handled revisions, and reuse counts.

Verdere EV-planningsoptimalisatie: SoC-feedback en statusweergaven vermijden volledige instellingenopbouw; SoC-Flow-deadlines vragen slechts één kalenderopzoeking per minuut met behoud van exacte timing. Een overlappend garantietariefvenster van vijf minuten wordt binnen dezelfde beslissing hergebruikt. De monitor telt bijkomend planningsrevisies en hergebruik.

### 1.1.15

Reduced repeated EV physical checks and settings expansion within a synchronous fast-control request. Resolved EV context requests are discarded before timer execution and after waiting for another publication. Fully disconnected EVs skip unnecessary heartbeat calculations once outputs and physical safeguards are settled. Charging strategies, immediate safety responses, Input Monitor and the regular context interval are preserved.

Minder herhaalde fysieke EV-controles en instellingenopbouw binnen dezelfde snelle verwerkingsgang. Vervallen EV-contextaanvragen worden vóór timeruitvoering en na wachten op een andere publicatie verwijderd. Volledig losgekoppelde EV’s slaan onnodige heartbeatberekeningen over zodra uitgangen en fysieke beveiligingen zijn afgehandeld. Laadstrategieën, onmiddellijke veiligheidsreacties, Input Monitor en het reguliere contextinterval blijven behouden.

### 1.1.9

Choose per EV whether to stop at the SoC target (default) or continue with the configured tariff and PV preferences. This also applies to SoC Flow targets. Explicit session stops and kWh targets keep stopping.

### 1.1.6

Compact diagnostic settings history and targeted EV decision and command details.

### 1.1.5

EV control now also works with battery output disabled or without configured home batteries.

### 1.1.4

Night planning uses the median of relevant PV forecasts until solar production starts.

### 1.1.3

Reduced redundant battery-control work during changing solar and grid charging.

### 1.1.2

Reduced redundant battery evaluations during planned charging while a slow context update is pending.

### 1.1.1

PV-live now only selects the grid measurement, avoiding redundant battery evaluations.

### 1.0.12

Reduced CPU usage through more efficient settings processing.

### 1.0.11

EV current and hybrid control now use the actual measured charging current for permitted grid import, independently of the commanded ampere limit. Lower charging current no longer leaves the home battery compensating that allowed EV load. Missing or expired feedback withdraws the measured allowance; tariff permissions, grid budgets and Peak Guard remain active. Settings immediately highlight that actual charging current must be reported at least every 50 seconds, even when unchanged.

### 1.0.10

Reduced redundant fast battery evaluations while slow PV or flexible-load updates are pending. Meter and periodic module refreshes can reuse valid battery feedback when individual setpoints and safety checks remain unchanged.

### 1.0.9

When individual battery commands remain unchanged during planned charging, changes in the grid/solar share no longer trigger a full fast evaluation. Source values and status text refresh on the existing slow cycle. Diagnostics separately count source-only skips and source-presentation updates.

### 1.0.8

Reduced redundant fast battery evaluations during stable planned grid charging and combined grid/solar charging. Diagnostics separately count skipped planned-charge evaluations when the battery commands and charging source remain unchanged. An idle guard reduces battery-control work when normal discharging is blocked and all battery commands are confirmed at zero. Diagnostics report idle skips and bypass reasons.


### 1.0.7

Added independent maximum SoC settings for day and night planned charging (default 100%). Solar surplus can continue charging beyond the planning limit. Planning energy need and the PV threshold are grouped at the top of energy planning. The status widget identifies active planning limits and discharge floors; EV PV-allocation details appear only when solar surplus actually contributes.

### 1.0.6

Select and prioritize Homey, External Price 1 and External Price 2 independently. External JSON curves support up to 120 hours of hourly or quarter-hour prices, with one generic source-selectable Flow input. Fallback sources share existing price alignment and validation. Status and planning diagnostics identify the active source and skipped-source reasons. The EMS widget shows up to three available prices and curves. External curves are retained across app restarts. Price-source selection uses checkboxes followed by priority dropdowns. Selected widget sources stay visible when data is missing; available future curves retain their priority numbers. Price alignment compares current-day overlap at a shared resolution and tolerates isolated outliers while rejecting unreliable matches. External sources can have custom names in settings, the widget and the new Flow source picker. The chart preserves received price blocks, including quarter-hour values with an hourly planning contract. Hourly prices repeated across four quarter-hour slots are recognized and aligned against complete hourly averages. Price-curve legend labels use the matching curve colors. Planned charging now continues live P1 feedback within the same import/export zone. Forced recalculations retain their force flag while waiting for the command interval. Diagnostics identify fast-control skip reasons and distinguish app startup from diagnostics startup. Battery efficiency optimization now also retains the charging battery until its SoC is more than the configured balance margin above the lowest available battery (minimum 2 percentage points), including during gradual handovers.

### 1.0.5

Discharge selection now keeps the current battery preferred until it is more than 2 percentage points below the highest available battery, including during a gradual handover, so near-equal SoCs no longer cause repeated battery swapping. Active-battery-count selection now has a wider sticky power hysteresis around efficiency thresholds and preserves the desired count while a gradual handover is in progress. With equal 1000 W targets, one battery remains selected through 1700 W and two batteries remain selected down through 1300 W, preventing P1 feedback around roughly 1450-1500 W from repeatedly switching between one and two batteries.

### 1.0.4

Multi-battery efficiency rotations now transfer power gradually between the outgoing and incoming batteries instead of switching the full setpoint at once. The gradual handover is enforced at the final battery-output boundary and is independent of the normal total-command deadband, so a large deadband can no longer collapse the rotation into one jump. A complete handover normally uses about four battery-command steps, while the requested total battery power can still change immediately for P1 regulation and Peak Guard. Safety limits such as per-battery SoC availability remain immediate.

### 1.0.3

Optional multi-battery efficiency optimization concentrates charging and discharging around an individually configurable power target for each battery (default 1000 W), selecting batteries by SoC. The power distribution follows each active battery’s target and respects its power limits. Existing installations retain their previous shared target as the default. It is available from two batteries and uses a minimum 2% balance deadband. Planning diagnostics show individual targets and battery rotations.

### 1.0.2

Savings now retains compact daily history for up to five years. The Savings tab adds rolling periods, selectable historical calendar months and years, storage details and CSV export with clipboard copy. The Savings widget adds This month, Previous month and configurable Rolling days, with shared cached historical totals. The settings tab bar now folds into a compact active-tab selector and closes automatically after a tab is chosen.

### 1.0.1

EV charging now has an independent one-minute heartbeat for evaluation and changed-command publication, without waiting for a battery command. Per-EV minimum command intervals and stop holds remain active; urgent safety reductions retain their immediate path. Independent decisions use current tariff and meter data, reserve pending battery charging including Split Command minimum power, and do not count future battery discharge as available headroom.

Battery feedback now skips full evaluations when a lightweight check confirms exactly the same published battery commands. The check reuses battery limits, SoC protection, balancing and power rounding; Peak Guard, EV target changes, live-PV changes, zone transitions and safety events retain their existing control paths. Fast detection now uses the same EV-adjusted grid target as battery control. CPU diagnostics include feedback preflight time, skipped evaluations and evaluation reasons.

### 1.0.0

EV sessions now distinguish charging, paused and completed. Missing mode-controlled charging power for 60 seconds pauses tracking without a Stop latch; sustained P1 load matching the configured mode resumes it automatically. Paused EVs release no grid budget, and household load above the configured mode power cannot inflate EV attribution. Sessions complete through the completion Flow card, a fresh SoC reaching its target, or measured current delivering the requested kWh. Pause preserves targets and session overrides. Live status and widgets show the pause and completion reason.

### 0.9.9

Autotune automatic evaluation now runs through the shared slow context loop. P1, PV and EV measurements still update the lightweight learning statistics immediately, while recommendation decisions remain bounded by the existing 30-minute minimum interval. Background Autotune planning samples, Savings housekeeping and EMS-device refreshes now follow the configured slow-context cadence instead of every 60-second heartbeat; the heartbeat remains responsible for time-critical planning boundaries, freshness and safety checks. Added opt-in diagnostics for Planning, CPU, Errors and Memory. Planning reports include the configuration used for each planning calculation, CPU diagnostics measure the major control/output paths, and all diagnostics automatically switch off after 48 hours.

### 0.9.8

PV live control now follows changes between consecutive PV readings. Large changes select current P1; a subsequent change below the threshold restores the configured averaging. Live PV selection also expires when fresh PV input stops, using the observed input cadence without an extra timer. Repeated P1 readings no longer trigger calculations solely because of the same PV change. The next permitted battery command uses the latest input state.

### 0.9.7

Charge planning now runs in the shared slow context loop. Ordinary SoC, forecast and price updates are combined while respecting the minimum planning interval. Status and widget reads reuse the cached plan. Manual refresh and planning day/phase changes use the same context path; pending updates are processed even without further input.

### 0.9.6
- Corrected cumulative PV-change detection: intermediate calculations no longer reset the reference before a battery command is published.
- Significant PV changes use live P1 at the next permitted command moment, including planned charging.

### 0.9.5
- Choose which tariffs use the sunshine reserve; expensive/peak periods are excluded by default.
- Added an optional sunshine-based discharge reserve with four configurable probability ranges and minimum SoC values.
- Added a dated today/tomorrow sunshine forecast Flow input, automatic day selection and Dutch/English status text.

### 0.9.4
- Corrected English dynamic tariff labels with prices and price classifications.
- Completed English translations in settings, validation messages, live status, widgets and readable Flow values.
- Added shared translation of dynamic battery, EV, HVAC, boiler and Safety SoC messages.

### 0.9.2
- Added a persistent 2-percentage-point restart margin after reaching a battery charging target.
- Automatic Safety SoC recovery bypasses the restart margin and tariff windows within power limits.
- Solar-surplus capture remains available inside the restart margin.

### 0.9.1
- Corrected EV grid-import accounting to prevent unwanted continued battery charging.
- Coordinated EV-first, battery-first and shared grid charging within one site import budget.
- Battery charging status now distinguishes grid energy from measured solar surplus.

### 0.8.9
- Planned charging keeps capturing solar surplus using P1 feedback, including when the grid meter reaches zero.
- Optional grid charging during normal dynamic price hours, capped by a separate maximum SoC and the planning target.
- Charge planning includes allowed normal-price windows before the deadline.

### 0.8.6

Choose Homey Energy, an external price service, or either as primary with the other as fallback. Secondary prices are aligned to the primary price level. Homey price formulas, including complete {{ … }} expressions with [[price]] tags, and unmodified base prices are supported; unpublished next-day prices do not block today’s curve. The status widget can show both source prices. Each EV has independent emergency-charging permissions per tariff, allowing all tariffs to be selected separately from standard and PV charging.

### 0.8.3

Fixed a settings-page translation loop affecting English and other non-Dutch languages. Added startup time-outs with a settings fallback and a visible error when loading fails. Corrected battery power and HVAC defaults for new installations.

### 0.8.2

Battery feedback now re-evaluates a persistent grid deviation outside the configured zero band, even when the meter changes by less than the signal threshold.

### 0.8.1

The minimum battery command interval now runs from the last published command. A calculation that sends no command no longer restarts the waiting time, allowing a new P1 deviation to be handled as soon as the command interval has expired.

### 0.7.16

Added phase-specific voltage choices for each EV: 230 V by default for single phase and 230 V line-to-line for three phases, with automatic current/power conversion. Current/power conversion, charging plans and Peak Guard checks use the configured voltage. Individual battery settings now include storage capacity in kWh; power sharing, Battery Balance and group SoC/planning account for different capacities while respecting each battery’s power and SoC limits.

### 0.7.15

Mode-only EV grid import is now capped by the configured Smart/Standard mode power as well as detected EV load and the configured EV grid-import allowance, so unrelated household loads cannot increase the EV budget. Renamed the external Hybrid EMS feedback Flow card to “Report external EMS battery power” while keeping the existing card ID and Flow compatibility.

### 0.7.14

Autotune now increases the Low-PV threshold only after a usable learning day actually dropped below 20% battery SoC. If the battery remained at or above 20%, the threshold may still be lowered when the learned PV/outcome data shows it is unnecessarily high.

### 0.7.13

Seasonal summer/winter minimum SoC values now act only as lower floors for day planning and, when enabled, night planning. Forecast demand is always calculated from the technical Minimum SoC, so the seasonal floor is no longer added to the calculated energy shortfall. Autotune will no longer increase Expected energy need unless a usable learning day actually dropped below 20% battery SoC, and automatic management of this parameter now includes a configurable desired battery SoC target.

### 0.7.12

Consolidated numbered Battery, EV and HVAC Flow cards into generic cards. All 31 slot selectors now dynamically offer only configured slots, including inputs, outputs, SoC requests and conditions. EV/HVAC names are shown; zero configured devices gives an empty selection. Numbered cards and previous fixed-dropdown cards remain deprecated but functional for existing Flows.

### 0.7.11

Added a per-EV night-planning option to use only home-battery energy above the calculated night target SoC. Charging starts only when the remaining time and available battery surplus allow more than 1.0 kWh to reach that EV; after start it may continue until the battery target is reached. This source never grants grid import, remains bounded by Peak Guard and battery limits, and works across EV 1 through EV 4.

### 0.7.10

Added EV session start/end tracking for EV 1 through EV 4, with an explicit end-of-session Flow card and status in Live view, the EMS device and status widget. Mode-controlled grid charging now learns a bounded forty-minute physical house-load reference from existing P1/PV inputs, releases only detected EV load above that reference, and restores normal battery control after one minute near the reference. Multi-EV handling remains portfolio-based and Peak Guard stays absolute.

### 0.7.9

Fixed EV PV coordination after a STOP: stale current or mode feedback can no longer finance an immediate restart. External Hybrid EMS battery charging now keeps its physical PV share, and SoC-target mode control can fall back to Smart without creating unauthorized grid demand. Shared limits are verified for one to four EVs across Current, Mode and Hybrid control.

### 0.7.8

Safety and reliability fixes: stale grid measurements can no longer start or keep HVAC/boiler loads running, delayed HVAC Flow outputs are serialized with a bounded latest-wins queue, tomorrow pricing uses the next local calendar day, queued status updates can no longer get stranded, negative purchase prices remain signed in Savings, stale measurements no longer keep accumulating costs, and invalid null/blank grid inputs no longer refresh the meter as 0 W.

### 0.7.7

Version bump of the final 0.7.6 candidate with no additional functional changes.

### 0.7.6

Fixed EV configuration visibility and strengthened multi-EV safety: Smart, SoC-target and Emergency now share one physical Peak Guard budget according to EV weights, candidate battery commands can no longer create virtual EV headroom, guaranteed EV grid charging correctly shifts the battery meter target, and Hybrid EMS stays under HomeFlux ownership whenever EV grid import is intentionally allowed. EV Settings now also show Peak Guard charging headroom from an optional idle-house-load estimate, including the usable current or mode for Battery Save/no-reserve and self-consumption scenarios without adding runtime polling. Boiler tariff fallback now counts fully missed solar-day windows instead of elapsed 24-hour time since the last cycle, so a missed day can unlock the selected night tariff without the fallback clock drifting with the previous completion time; the status widget also shows the solar-day count and countdown to fallback.

### 0.7.5

Follow-up test fixes: EV settings now only show configured EVs. Autotune keeps dropdown-backed values UI-safe and uses realistic parameter-specific automatic-management ranges that respect configured SoC, EV and hard safety limits.

### 0.7.4

Fixed Autotune handling for dropdown-backed settings and replaced the temporary +/-50% auto-management ranges with realistic parameter-specific defaults. SoC-related ranges respect the configured Maximum SoC, while user-defined ranges remain adjustable. Recommendations, one-off changes and automatic management only use values that the Settings UI can represent.

### 0.7.3

Autotune now uses a configurable confidence threshold (95% by default) plus per-parameter confidence and minimum/maximum boundaries for automatic changes. Savings now includes PV export/feed-in value, supports exported-energy calibration and a live export-price Flow input, with signed export prices for fixed and multi-rate tariffs.

### 0.7.2

Added persistent guaranteed EV minimum targets by SoC or required kWh, with clear settings fallback and favourable-charging behaviour after the minimum is reached. Hybrid ownership is now more visible in the status widget and EMS device. Improved device/widget guidance in battery configuration and documentation.

### 0.7.1

Reorganized EMS configuration, added two-step battery direction testing, renamed Finetuning to Autotune, introduced Hybrid EMS for external self-consumption control with one or multiple batteries, and changed the license to GPL-3.0-only.

### 0.6.7

Improved Automatic Finetuning interaction. Permission now belongs to the parameter itself, so a recommendation that disappears between rendering and clicking no longer causes an invalid-parameter error. Each recommendation now has Apply this time for a one-off adjustment and Do not check again to suppress future checks. Suppressed parameters are listed at the bottom of the Finetuning tab and can be re-enabled at any time.

### 0.6.6

Added an optional battery support mode for essential tariff boiler heating. When enabled, planned battery grid charging yields first and the battery may temporarily discharge to keep the boiler within Peak Guard while respecting the boiler stop reserve, minimum SoC and discharge limits. If the battery cannot bring import back under the hard limit within a bounded response window, Peak Guard still switches the boiler off. Also fixed the status widget so a running boiler supported by Peak Guard is shown as heating, not as disabled.

### 0.6.5

Improved self-consumption status so HomeFlux clearly explains when battery discharge is paused by an applicable SoC floor. Essential tariff boiler heating now gets priority over planned grid battery charging: battery charge power dynamically yields to reserve Peak Guard headroom, then automatically increases again after the boiler finishes. Peak Guard remains a hard safety limit.

### 0.6.4

Expanded Automatic Finetuning to recommend more non-hard-limit control parameters, with special planning intelligence for the low-PV threshold and expected energy need. HomeFlux now learns from up to 14 compact daily summaries to relate PV forecast to achieved battery SoC and estimate non-EV daily demand, helping the battery reach roughly 90–100% during useful solar hours while reducing unnecessary overnight grid charging. Also added recommendations for grid zero-band width, Battery Save discharge floor, battery/PV command cadence, adaptive control parameters and multi-battery balancing. Planning-derived automatic changes are limited to once per day. Hard safety limits and user intent remain protected.

### 0.6.3

Added: Automatic Finetuning with transparent opt-in recommendations for safe, non-critical tuning parameters. It reuses existing P1, PV and EV observations without extra polling, shows only meaningful deviations, and can auto-manage individually approved parameters within conservative limits. Safety limits and user intent such as Peak Guard, minimum SoC, power limits, tariffs, deadlines, comfort settings and priorities are never changed.

### 0.6.2

Fixed battery planning minimum SoC handling. During day planning, the selected-month minimum is now a hard floor only in selected months, while non-selected months use the separate sunny-month minimum only when that option is enabled. When night minimums are enabled, the same applicable monthly minimum is also enforced in night planning. PV forecasts can no longer reduce these absolute minimum floors.

### 0.6.1

Added: per-EV tariff selection, PV charging hysteresis and configurable grid top-up, Current/Mode/Hybrid EV control, deadline planning by SoC or required kWh with optional use of unselected tariffs and warning Flow output. Updated: EV planning is visible in Planning, Live status and the EMS widget. Moved EV and boiler tariff settings to their own tabs without losing existing settings. Added: configurable boiler tariff fallback day/night window. Peak Guard remains absolute.

### 0.5.5

Added: optional external dynamic-price fallback through generic Flow cards for current price and JSON price curves. Updated: EMS status widget shows price fallback health and the next EV decision/wait state.

### 0.5.3

Fixed: EV feedback validation now tolerates configurable reporting deviations of 5%, 10%, 15% or 20%. Fresh EV measurements within tolerance no longer pull the requested charging setpoint backward.

### 0.5.2

Improved: EMS status widget now shows a reason for every battery decision, displays the next tariff with both clock time and remaining time, and shows estimated time to the battery target while charging or to Safety SoC while discharging. No battery-control logic changes.

### 0.5.1

Reworked: EV charging now follows real meter headroom and is controlled through EV setpoints, with weighted multi-EV sharing, optional total EV grid-import limits per tariff and optional home-battery support for extra EV charging power without overriding normal battery control. Fixed: battery discharge no longer creates false EV charging headroom when EV battery support is disabled; permitted EV grid import is released only after the lower charger setpoint has been sent and given a short response grace period. Updated: Live status and the EMS widget now explain temporary/intentional battery discharge during EV charging. Added: configurable direct/5/7/10-second grid regulation with PV-delta and adaptive live control for repeating large load changes, plus read-only EMS/EV/HVAC/boiler Flow condition cards. Updated slogan: Your energy, managed differently / Jouw energie, anders geregeld.

### 0.4.18

Reworked: EV charging now follows real meter headroom and is controlled through EV setpoints, with weighted multi-EV sharing, optional total EV grid-import limits per tariff and optional home-battery support for extra EV charging power without overriding normal battery control. Fixed: battery discharge no longer creates false EV charging headroom when EV battery support is disabled; permitted EV grid import is released only after the lower charger setpoint has been sent and given a short response grace period. Updated: Live status and the EMS widget now explain temporary/intentional battery discharge during EV charging. Added: configurable direct/5/7/10-second grid regulation with PV-delta and adaptive live control for repeating large load changes, plus read-only EMS/EV/HVAC/boiler Flow condition cards. Updated slogan: Your energy, managed differently / Jouw energie, anders geregeld.

### 0.4.17

Fixed: EMS status widget preview images are now fully text-free. No functional EMS logic changes.

### 0.4.16

Fixed: removed obsolete legacy EV/HVAC Flow card definitions from the publishable app manifest.

### 0.4.15

Fixed: exclude generated build output and development metadata from published app packages to prevent obsolete Flow card metadata from being submitted.

### 0.4.14

Updated: EMS status widget planning information. Fixed: removed remaining deprecated HVAC input cards and aligned Flow Help catalog.

### 0.4.13

Added: configurable EMS status widget for tariff, EMS decision/output, battery, Peak Guard, EV, HVAC and boiler status. Fixed: boiler PV-surplus detection now excludes battery-created export. Fixed: PV day/night switching keeps the 10-minute PV-stop delay.

### 0.4.12

Bugfix is savings progress bar

### 0.4.11

Enhanced energy insights for widget. New input card for imported energy today.

### 0.4.10

Added: Savings widget with selectable cost/profit charts, day/month/year views and adjustable refresh intervals. Added: EV Peak Guard support using the home battery during normal and emergency charging. Fixed: Split Command battery feedback and incorrect PV charging classification. Updated: Removed legacy unnumbered EV/HVAC flow cards and improved Savings widget layout.

### 0.4.9

Added: Savings dashboard with daily, weekly, monthly and yearly financial insights. Added: Track savings from direct solar use, battery-stored solar energy and tariff shifting. Added: Homey Insights values for savings today and total savings.

### 0.4.8

Slogan Fix

### 0.4.7

Fixed: per-battery charge and discharge limits are now handled correctly when batteries have different specifications.

### 0.4.6

Language corrections.

### 0.4.5

Added: maximum battery power for each battery. Changes to boiler behavour. Manual modes does not follow plan limits.

### 0.4.3

Minor fix

### 0.4.2

Added: convert low-pv day in a sun day. Updated: improved scheduling.

### 0.3.88

Added: select a daytime hour to ensure safe batterylevel for the evening.

### 0.3.87

Added: adjutable day target hour for charging requirements.

### 0.3.85

Rework of schedules, better and more control.

### 0.3.9

Better feature explanation.

General EV settings offer two optional battery-discharge restrictions: protect a majority grid-charged inventory, or block discharge during any detected EV charging. Both default to off; solar-surplus charging remains available. The existing Savings inventory estimates the origin for the complete battery group. Missing initial energy remains unknown. EMS status tiles, including Full to target and Active SoC bounds, can be hidden independently. Global Flow tags expose current EMS issues, the last runtime error and the cached WAF balance with an availability flag; see Settings → Help for definitions.

