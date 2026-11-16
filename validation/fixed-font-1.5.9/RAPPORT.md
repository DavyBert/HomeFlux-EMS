# HomeFlux EMS 1.5.9 — vaste uurtekst 14

De uurtekst staat vast op **14 SVG-eenheden**: precies 30% kleiner dan de eerder gebruikte 20. De niet-gewenste dynamische koppeling aan de legenda is volledig teruggedraaid, inclusief de bijbehorende fontmetingen, herberekening op breedtewijzigingen en aparte asgroep. De statische grafiekrenderer is byte-identiek aan de eerder opgeleverde statische 20-variant, afgezien van de constante 20 → 14.

3/6-uursverdeling, 24 uur/AM/PM, grafiekruimte, brede weergave, WAF-kleuren, PV-dagreset en de EMS-laadstroken blijven behouden. Versie blijft 1.5.9.

Vier gerichte suites slagen met Node.js 22.23.5: uurtekst en tijdnotaties in alle vijf talen, rendering, centrale SOC/vertalingen en minuutverversingsisolatie. De bestaande fontassertie controleert nu de vaste waarde 14. Alle JavaScript en JSON zijn op syntax gecontroleerd.

`app.js`, de status-API en alle bibliotheekmodules blijven byte-identiek aan de vorige levering. De prognose-, PV- en centrale SOC-bronblokken zijn identiek. Geen nieuwe timers, listeners, polling, API-verzoeken of schrijfacties. Geen fysieke Homey-/pixel-/CPU-test; de volledige regressiesuite en numerieke dagsimulaties zijn voor deze constante letteraanpassing niet opnieuw uitgevoerd.

Gewijzigde bestanden:

- `.homeychangelog.json`
- `README.md`
- `test/widget-compact-hours-1.5.9.test.js`
- `test/widget-translations-central-soc-1.5.9.test.js`
- `validation/legend-font-1.5.9/RAPPORT.md`
- `widgets/status/public/index.html`
- `widgets/status/public/visual.html`

Logs: `tests.json`, `proof.json`, `changes.diff`. Syntax: 367 JS/CJS, 5 ingesloten scripts en 349 JSON. De legendakoppeling in de vorige validatiemap is een verworpen tussenvariant en maakt geen deel meer uit van de actieve code.
