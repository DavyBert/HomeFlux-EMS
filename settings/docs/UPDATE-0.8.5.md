# HomeFlux EMS 0.8.5

## Price sources

Energy contract now offers Homey Energy only, Homey Energy with external fallback,
external with Homey Energy fallback, and external only. Existing installations
retain their saved source choice. External services supply a timestamped full
price curve through the existing generic or PBTH Flow cards. A standalone live
price cannot replace that curve or override its normalized planning price.

The first source determines the price level. The secondary source is fitted to
simultaneous primary prices using a positive multiplier and an offset. This
accounts for different taxes, markups and units already normalized by the input
parser. At least four overlapping observations spanning 60 minutes and sufficient
price variation are required. The fit must have RMS error no larger than
0.002 EUR/kWh and maximum error no larger than 0.005 EUR/kWh; multipliers outside
0.1–10 are rejected. These conservative checks prevent unrelated curves from
becoming a misleading cheap fallback.

Calibration is persisted for up to 48 hours and is scoped to the source order,
Homey zone, timezone, decision interval and known Homey formula. A changed formula
or source context cannot silently reuse an old fit. If there is no reliable fit,
the secondary source is marked unavailable for control. The existing missing-price
safety behavior then applies when the primary is unavailable. Homey freshness
uses the existing 20-minute limit; an external day-ahead curve remains valid while
it covers the current interval. Recovery automatically restores the primary.

The status widget has independent primary and secondary price visibility options.
Secondary prices show their supplied value and their aligned value. It explicitly
shows when no secondary source is selected or alignment is still pending.

## Homey formulas

Both today's and tomorrow's imports use Homey's `mathExpression` when supplied by
`getDynamicElectricityPriceUserCosts`. The calculation operates on EUR/kWh values.
An unmodified base-price token (including `basisprijs`, `basePrice` and `base_price`)
returns the received interval price unchanged, including zero and negative prices.
Known price tokens are also accepted inside single/double square or curly brackets.
Diagnostics display the imported formula and preserve today’s error when tomorrow
is not yet published.
The arithmetic parser supports parentheses, addition/subtraction, multiplication,
division, powers, and abs/min/max/floor/ceil/round/pow/sqrt. It never executes API
text as JavaScript. Explicit per-slot consumer prices take precedence, so costs
are not added twice. Where older API responses supply only consumer-price daily
summaries, both a factor and offset are inferred and checked against the available
summaries. Unsupported formulas or inconsistent summaries produce an import error;
HomeFlux does not silently treat an unsupported formula as a zero surcharge.

A nonlinear formula may be usable for Homey import but cannot necessarily be
represented by the secondary-source multiplier and offset. In that case Homey
remains usable as primary while the reserve stays unavailable until a reliable
alignment exists.

## EV emergency charging

Each EV has independent emergency permissions per TOU tariff and per dynamic
category (Cheap/Normal/Expensive). Fixed contracts offer permissions inside and
outside the fixed charging window. These choices are independent of standard
charging, PV charging and PV grid top-up, and also apply to Flow emergency
overrides. Users can enable every tariff or disable them all. Emergency permission
can be enabled even on a tariff configured to avoid normal grid import; Peak
Guard remains a hard limit.

By default all emergency tariffs are enabled, preserving unrestricted emergency
charging for existing users. If the first 0.8.4 build's global tariff restriction
was enabled, migration copies those existing tariff permissions to the new
emergency choices once. Existing explicit choices are preserved. With missing
dynamic prices, a restricted selection waits; selecting all dynamic categories
still allows emergency charging without needing a price classification.

## Verification

- `npm run check`: complete existing suite plus 0.8.4 regressions.
- Regression coverage: both source orders, single-source modes, failover and
  recovery, formula changes, persistent calibration, missing/incompatible curves,
  different interval lengths, arithmetic and negative prices, today/tomorrow
  imports, read-only simulation, and zero-valued widget prices.
- All four EVs: emergency Flow overrides, all output-control types, allowed and
  blocked tariffs, missing prices, Peak Guard and default behavior.
- Fresh installation/restart and preservation of existing settings.
- Full settings-page DOM startup in Dutch, English and Swedish-to-English
  fallback; existing timeout and translation-loop tests; actual UI saving of the
  four source modes and independent emergency tariff choices for all four EVs.
- Public Athom descriptions and all existing Flow definitions compared with 0.8.3.

These are automated and simulated checks. No physical Homey, actual customer
formula response or Athom deployment was available during this build.

Full user documentation: https://github.com/DavyBert/HomeFlux-EMS/discussions/3
