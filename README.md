# HomeFlux EMS

**Your energy, managed differently**

HomeFlux EMS manages home batteries around your tariff, PV forecast, self-consumption and grid limits. The hardware connection stays flexible through Homey Flow cards.

## Quick start

1. **Configure HomeFlux**  
   Add your battery count, capacity, battery limits, tariff periods and Peak Guard limit in Settings, then save the configuration. For batteries with different power limits and/or capacities, enable the individual settings and enter each battery’s capacity in kWh and power limits in W.

2. **Feed the basic inputs through Flow**  
   Use **Set grid power**, **Set PV power** and **Set battery SoC**. For battery planning, also provide **Set remaining PV forecast** and **Set tomorrow PV forecast**. Grid power uses positive = import and negative = export.

3. **Send the battery output to your battery integration**  
   Use **Battery commands are updated** for batteries that accept a power setpoint. If your battery requires separate charge/discharge modes and power values, enable Split Command and use the corresponding **Battery: switch to charge/discharge mode** and **Battery: charge/discharge power is updated** cards.

Once these inputs and outputs are connected, HomeFlux can perform the core battery control and planning.

Optional features include EV charging, HVAC, boiler control, Hybrid EMS integration, dynamic-price inputs, Autotune, Savings and dashboard widgets.

For the complete functionality, configuration and all Flow cards, see:  
https://github.com/DavyBert/HomeFlux-EMS/discussions/3

---

## Release notes

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
