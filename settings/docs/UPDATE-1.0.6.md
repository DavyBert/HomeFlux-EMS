# 1.0.6 — Independent dynamic price sources

Tick the allowed price sources under Energy contract, then choose the priority order below. The old combined-source dropdown has been removed. Changing a priority swaps the two positions; each source appears once. At least one source stays selected.

Use the new **Read external prices JSON** card with its dynamic source picker; it displays your configured external-source names and keeps the `external` / `external2` IDs. Blank names fall back to External Price 1 / External Price 2. Timestamped JSON defines its own times. For numeric arrays, match the provider period (This day, Tomorrow or Next hours); resolution follows the 15-minute/hourly dynamic contract. Next hours supports up to 120 hours. Today/tomorrow arrays merge with the same source’s existing curve.

The retained current-price, external-curve and PBTH cards are deprecated and keep their IDs, arguments and listeners. They continue writing External Price 1. The previous generic dropdown card is also retained unchanged apart from its deprecated marker; it continues writing whichever source was selected in the saved Flow. Current-price input remains informational; planning needs a curve. Existing source settings map as follows:

| Previous mode | Sources in priority order |
| --- | --- |
| Homey | Homey |
| Homey + external | Homey → External Price 1 |
| External + Homey | External Price 1 → Homey |
| External only | External Price 1 |

External Price 2 starts disabled. Existing valid calibration is reused. Both fallback sources must have reliable alignment to the primary price basis before planning can use them; differing VAT/surcharges are accounted for by the existing calibration. External freshness follows current-slot coverage, while Homey retains its 20-minute refresh rule and calibration retains its 48-hour validity. An invalid update is rejected without destroying the last valid curve.

Each external source has separate persisted curve data and resampling cache. Timestamped imports replace only that source’s curve; numeric period imports merge only with the same source. Both use the shared parser and the 120-hour horizon. The planning engine receives the selected curve with the full retained horizon; its existing planning window remains in effect.

Status and opt-in planning diagnostics expose selected source order, active source and reasons for skipping higher-priority sources. The EMS status widget can display Price 1, Price 2 and Price 3 in the configured priority order. A selected source with missing data stays visible as unavailable, with a distinction between no received curve and no price covering the current time. Available original curves are shown even when they only contain future prices. Price numbers stay tied to source priority, including when another source has no curve. Aligned current fallback prices are shown separately with an arrow.

Each external source needs its own JSON input: use **Read external prices JSON** with the matching source dropdown for each provider. Selecting External Price 2 alone does not copy External Price 1's data; deprecated input cards still write External Price 1.

Price alignment uses today’s overlapping price blocks and a shared comparison resolution. At least four complete comparable blocks and 60 minutes are required (one hour for quarter-hour pairs, four hours for hourly/mixed pairs). A weighted linear fit estimates factor and offset. If needed, a robust median-slope seed removes isolated outliers; at least 80% of blocks and duration must support the fit. Error limits remain 0.002/kWh RMSE and 0.005/kWh maximum residual. Known outlier blocks are excluded only from aligned planning data. Source prices and persisted curves stay original. See [the implementation report](PRICE-ALIGNMENT-1.0.6.md) for diagnostics and test details.

Hourly prices can arrive as four repeated quarter-hour values. A consistent clock-hour pattern across at least four complete hours is recognized for calibration; true quarter-hour prices are then averaged over complete matching hours. Partial boundary hours are excluded from fitting. Original curves and their planning resolution are preserved. Alignment diagnostics expose effective source resolutions, repeated-hour detection, and the shared comparison resolution.
