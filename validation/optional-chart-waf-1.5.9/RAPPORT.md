> Historisch verslag. De nieuwste standaardinstelling en tijdnotatie worden beschreven in `validation/compact-hours-1.5.9/RAPPORT.md`.

# Aanvulling HomeFlux EMS 1.5.9

Basis: de eerder opgeleverde `HomeFlux-EMS-v1.5.9-Visual-Translations-Central-SOC.zip` (SHA-256 b5e3961252894415aaa5552fa2b21d36fcd9555c42ad4ddf2f95b53ae1c5d1f4). Versie blijft 1.5.9. Geen andere codebasis gebruikt.

## Instellingen

Onder **HomeFlux EMS → EMS-widget**, per profiel Compact/Medium/Full:

- **Grafiek over volledige breedte met schaalbadges**: standaard uit. Inschakelen geeft 402 in plaats van 310 SVG-eenheden plotbreedte, ongeveer 30% meer. De drie zijschalen verhuizen naar knoppen boven de grafiek. Tikken toont een schaal binnen het diagram, opnieuw tikken verbergt die. De bestaande grafiektooltip gebruikt de juiste nieuwe coördinaten. Verbergen van de grafiek verbergt de badges mee.
- **WAF-waarde groot weergeven**: standaard aan, ook als dit veld nog ontbreekt in een bestaand profiel. De gemeten reserve staat dan groot, met het oordeel eronder. Beide volgen dezelfde WAF-kleur, inclusief het bestaande contrast voor lichte kaarten. Uitschakelen bewaart de oude tekst-eerst-weergave. Een opgeslagen expliciete uit-keuze blijft behouden. De aparte netruimteweergave wijzigt niet.

Beide opties staan in de bestaande private profielopslag; er is geen extra Homey Settings-sleutel en geen automatische opslagslag. Opslaan/resetten gebruikt de bestaande profielknoppen.

## Grafiekcorrecties

De cumulatieve PV-balken beginnen vanaf de getekende 00:00 van de volgende dag opnieuw op nul. De nieuwe dag toont alleen haar eigen beschikbare PV-prognose. Dagtotalen en tooltip-interpolatie zijn gescheiden; onbekende PV voor morgen krijgt geen verzonnen balken of voortzetting van vandaag. Dit raakt uitsluitend de displayfunctie `cumulativePvBars` en de bijbehorende tooltip-uitlezing, niet de PV-invoer of SOC-berekening.

Bij overlappende laadstroken wordt de widgetschatting eerst getekend en de bevestigde EMS-planning als laatste. De EMS-strook ligt daardoor zichtbaar bovenop. Er is geen wijziging aan laadvensters of hun berekende energie.

## Scope en controles

`app.js`, `widgets/status/api.js`, `lib/visual-house-history.js` en alle andere control-/AutoTune-/tarief-/Savings-bibliotheken zijn byte-identiek aan de oorspronkelijke 1.5.9. Alleen de private presentatieprofielmodule is uitgebreid. De SOC-prognose en tariefnormalisatie in de widget zijn exact behouden. De centrale SOC-registratie en gegevenssamenvoeging zijn ongewijzigd.

De 19 bestaande virtuele-dagsimulaties leveren exact dezelfde numerieke resultaten op (uitvoeringstijd uitgezonderd). Alle 16 geselecteerde suites slagen met Node.js 22.23.5. Ze dekken alle vijf talen, de nieuwe configuratie, daadwerkelijke profiel-editor met opslaan/resetten/migratie, schaalbadges, touchcoördinaten, WAF-omwisseling en kleurselectoren, ongewijzigde netruimtemodus, EMS-stroken boven schattingen, PV-dagreset, ontbrekende morgenprognose, centrale SOC-historiek, bestaande cache/minuutgrens en AutoTune.

Een profiel-/schaalwissel gebruikt de al berekende prognose voor het tekenen. Het aantikken van schaalbadges of de tooltip roept geen SOC-prognoseberekening aan. Er is één noodzakelijke UI-klikafhandeling voor de schaalbadges toegevoegd. Geen nieuwe achtergrondtimer, P1-listener, batterijpolling, API-verzoek of opslagcyclus. De bestaande refresh na een expliciete profielsave blijft behouden.

Alle nieuwe teksten hebben vertalingen in nl/en/fr/de/es. Release notes vermelden de nieuwe presentatieopties en grafiekcorrecties. Slogan, Athom-manifestteksten, Flow-kaarten en versienummer zijn behouden.

Geen fysieke Homey-installatie, pixelcontrole in de echte Homey-WebView of CPU-meting uitgevoerd; de DOM-/interactietests gebruiken de echte HTML/JavaScript in jsdom. De volledige historische testsuite is niet opnieuw gedraaid; de 16 relevante suites en de 19 simulaties wel. De eerdere historische versiegebonden testbeperkingen blijven gedocumenteerd in het oorspronkelijke verslag.

## Gewijzigde bestanden ten opzichte van de oorspronkelijke 1.5.9

- `.homeychangelog.json`
- `README.md`
- `lib/visual-widget-profiles.js`
- `locales/de.json`
- `locales/en.json`
- `locales/es.json`
- `locales/fr.json`
- `locales/nl.json`
- `settings/index.html`
- `settings/translations/de.json`
- `settings/translations/en.json`
- `settings/translations/es.json`
- `settings/translations/fr.json`
- `settings/visual-widget-profiles-ui.js`
- `test/widget-translations-central-soc-1.5.9.test.js`
- `test/widget-wide-scales-pv-reset-1.5.9.test.js`
- `validation/release-1.5.9/RAPPORT.md`
- `widgets/status/public/index.html`
- `widgets/status/public/visual.html`

Bewijzen en logs: `proof.json`, `tests.json`, `simulations.json`, `changed-files.json` en `changes.diff` in deze map. Syntaxcontrole: 366 JS/CJS, 5 ingesloten scripts en 335 JSON-bestanden.
