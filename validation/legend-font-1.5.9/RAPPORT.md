> Verworpen tussenvariant: de dynamische koppeling aan de legenda is verwijderd op verzoek van de gebruiker. De huidige vaste lettergrootte staat beschreven in `validation/fixed-font-1.5.9/RAPPORT.md`.

# HomeFlux EMS 1.5.9 — uurtekst even groot als de legenda

Basis: laatst opgeleverde 1.5.9 ZIP, SHA-256 `640a8b35a290365d03182f8b0bac62dcc1d93d3826288446c2c845f38d1b905d`. Versie blijft 1.5.9.

De uurtekst onder de SOC-grafiek volgt de werkelijk berekende CSS-lettergrootte van de legenda **EMS-laadplan / Widgetprognose** (normaal 9 CSS-pixels). De fontgrootte wordt omgerekend naar SVG-eenheden volgens de bestaande viewBox en de layoutbreedte. Daardoor ogen de uurtekst en legenda even groot, ook bij een smalle of brede widget. De bestaande legenda zelf is niet gewijzigd.

De bestaande hoogte-/resize-afhandeling past alleen het asgroepje aan wanneer de benodigde fontgrootte wijzigt. Geen nieuwe listener, timer, requestAnimationFrame, API-opvraging of achtergrondcyclus. Er is geen SOC-prognoseberekening nodig voor deze letteraanpassing. De 3/6-uursverdeling, 24-uurs-/AM/PM-keuze, begin/eindlabels en bestaande grafiekruimte blijven behouden.

Alle zes gerichte suites slagen onder Node.js 22.23.5. Tests controleren de gedeelde lettergrootte bij drie gesimuleerde viewportbreedtes, alle vijf talen, begrensde labelposities, bestaande instellingen, rendering, cache/minuutgrens en centrale SOC. De bestaande fontassertie is vervangen door een controle tegen de berekende legendagrootte; er zijn geen productinvarianten afgezwakt.

`app.js`, de status-API en alle bibliotheekmodules zijn byte-identiek aan de vorige levering. De SOC-prognosefuncties, PV-dagberekening, centrale SOC-registratie/gegevensverwerking, EMS-regeling en AutoTune zijn ongewijzigd. De grafiekgeometrie is exact behouden. De volledige historische suite en de numerieke dagsimulaties zijn voor deze letteraanpassing niet opnieuw uitgevoerd; de forecastbron is byte-identiek gecontroleerd. Geen fysieke Homey-installatie, fysieke CPU-meting of pixelcontrole in de Homey-WebView uitgevoerd.

## Gewijzigde bestanden

- `.homeychangelog.json`
- `README.md`
- `test/widget-compact-hours-1.5.9.test.js`
- `test/widget-translations-central-soc-1.5.9.test.js`
- `validation/adaptive-axis-1.5.9/RAPPORT.md`
- `widgets/status/public/index.html`
- `widgets/status/public/visual.html`

Logs en bewijzen: `tests.json`, `proof.json`, `changes.diff`. Syntaxcontrole: 367 JS/CJS, 5 ingesloten scripts en 346 JSON-bestanden. Eerdere validatieverslagen zijn historisch.
