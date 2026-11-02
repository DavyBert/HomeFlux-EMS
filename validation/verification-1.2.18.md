# HomeFlux EMS 1.2.18 verification

- Compact Settings layout on mobile and desktop; original control markup retained.
- French, Spanish and German added for Settings, Flow metadata, widgets, status/errors, Athom descriptions and release notes.
- Original EN/NL locale files and Athom descriptions preserved. New website descriptions contain no release notes.
- Original Flow schemas, including deprecated cards, preserved; translation fields are additive.
- Controller, planner, HVAC coordination and EV control sources compared byte-for-byte with 1.2.17.
- 23 targeted suites passed, including the new localization test (8,175 strings, 2,953 metadata objects, placeholders and Flow argument/error handling).
- Syntax checks: 509 JSON files, 10 changed JavaScript files and 2 changed inline scripts passed.
- Host browser: 340 tab comparisons across 5 languages and 4 widths passed. Visible control values and availability retained; no new overflowing controls or script errors.
- Full and independent algorithm suites skipped because their code is unchanged. Relevant control-boundary regression suites were run.
- No installation or publication on a Homey. Actual Homey WebView rendering remains unverified; no native-speaker review of every translated help paragraph.
