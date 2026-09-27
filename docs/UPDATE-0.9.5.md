# 0.9.5

Optional sunshine reserve for normal battery discharge. It is off by default.

Enable it in Settings under planning and connect **Set expected sunshine probability today and tomorrow** to your weather source. Supply percentages for local calendar days. Refresh the input daily or when the forecast changes. Values are stored against actual dates and survive restart; after midnight the former tomorrow value remains valid for its date. Expired or missing forecasts add no extra reserve.

Four editable ranges cover 0–100% without gaps or overlaps. The first range includes zero; subsequent ranges exclude their lower boundary and include their upper boundary. Initial minimum SoCs are Safety SoC +30, +20, +10 and +0 percentage points for 0–10%, >10–30%, >30–50% and >50–100% sunshine respectively. Once saved, these fields are absolute minimum SoCs. The effective reserve is clamped between Safety SoC and Maximum SoC and never lowers an existing discharge floor.

Day planning uses today's probability. Evening night planning after PV ends uses tomorrow's probability; after local midnight it uses today's probability. This follows the existing PV-end/night-planning transition, not a new astronomical sunset trigger.

The reserve limits ordinary discharging; it does not increase the charging target or independently request grid charging. PV charging and Safety SoC recovery remain available. Peak Guard can use energy below the sunshine reserve within existing technical limits. Manual modes retain their existing priority. The settings status shows the selected forecast date, probability and reserve; battery status explains when the reserve stops discharge.

Full configuration and Flow documentation: https://github.com/DavyBert/HomeFlux-EMS/discussions/3

## Tariff selection

Under Energy contract, select sunshine reserve separately for each fixed time-of-use tariff, for each dynamic price class (cheap/normal/expensive), or for the single fixed tariff. Expensive/peak periods are excluded by default; explicitly selecting one applies the reserve there too. With the reserve excluded, existing tariff and Safety SoC rules govern discharge. The same tariff selection governs EV battery support and night surplus.
