# 0.9.3

English translations now cover the missing settings labels and explanations for battery setup, PV allocation, EV tariffs, HVAC, boiler, Hybrid EMS, Savings and Autotune. Validation and output-test pop-ups use the same display translator.

Dynamic messages are translated at presentation boundaries: public status, API results, widgets, EMS device status and human-readable Flow tokens. This includes forecast-target discharge, Safety SoC recovery, EV allocation and charging delays, HVAC decisions and boiler heating reasons. Machine state IDs, numeric commands, stored settings, custom device names and user-defined tariff names retain their original values. English Flow text values now use Yes/No and On/Off; boolean and numeric tokens keep their types.

Unsupported Homey languages use English for presentation, while Dutch remains available. The translation observer retains its mutation guard. Translation handles complete parameterized messages and combined reasons; repeated processing preserves English, including words such as January.

Validation covers static UI text, representative dynamic messages, composite EV reasons, English idempotence, Dutch output, unsupported-language fallback, public status, Flow values and API errors. The previous settings startup/translation-loop regression and the full application test suite are included. Validation is automated; no physical Homey WebView session was used.
