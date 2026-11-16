> Historisch verslag. De nieuwste 3/6-uursverdeling en grotere uurtekst staan in `validation/adaptive-axis-1.5.9/RAPPORT.md`.

# HomeFlux EMS 1.5.9 — rustige tijdlabels en brede grafiek standaard aan

Gebaseerd op de laatst opgeleverde 1.5.9 ZIP, SHA-256 `c44fdf80bdd1d2b970f20fcf1ec2769cb9a89e1db4b87c496ffb4437be8517c2`. Versie blijft 1.5.9.

Onder **HomeFlux EMS → EMS-widget**, per profiel:

- Brede grafiek met schaalbadges staat na upgrade standaard aan. Een ontbrekende private `chartDisplayVersion` markeert een oud profiel; dit wordt bij het lezen naar de nieuwe standaard omgezet, ook als de oude standaardwaarde nog uit was. Er gebeurt hierbij geen automatische Settings-schrijfactie. Na opslaan bevat het profiel versie 1 van deze weergavevoorkeur en blijft een expliciete keuze om de brede grafiek uit te zetten behouden.
- Nieuwe keuze **Tijdnotatie tijdlijn**: **24 uur** (`0h`, `6h`, `12h`, `18h`) of **AM/PM** (`12AM`, `6AM`, `12PM`, `6PM`). Middernacht is 0h/12AM en de middag 12h/12PM. Standaard 24 uur. De oude HH:mm-asnotatie is vervangen, geen derde keuze voor de oude as.
- Gewone aslabels worden om de zes uur verdeeld. Het eindtijdstip van de SOC-grafiek blijft zichtbaar; een nabijgelegen zes-uurslabel wordt weggelaten om overlap te voorkomen. De M en + voor volgende-dag-aslabels zijn verwijderd. Een doel op een niet-heel uur blijft nauwkeurig als bijvoorbeeld 7h30 of 7:30AM.
- De tarieftijdlijn gebruikt echte zes-uurskloktijden op hun correcte positie binnen het bestaande voortschrijdende 24-uursvenster. De tariefblokken zelf zijn onveranderd. De labels zijn ook bij zomer-/wintertijd getest.

Alleen de tijdassen gebruiken deze nieuwe instelling. Gedetailleerde tijdstippen in statusvelden/tooltips blijven nauwkeurig; instellingen voor werkelijke laad- en doelmomenten worden niet gewijzigd. Alle nieuwe instellingslabels hebben nl/en/fr/de/es-vertalingen.

De reeds geleverde PV-dagreset, centrale SOC-historiek, WAF-omwisseling met bijpassende kleuren en EMS-laadstroken op de voorgrond blijven behouden.

## Controle

**16 van 16 gerichte tests geslaagd onder Node.js 22.23.5.** Nieuwe tests dekken upgrade van oude profielen, blijvend uitschakelen na opslaan, beide klokformaten, middernacht/middag, zes-uursverdeling, eindlabels zonder M, juiste positie in de tarieftijdlijn, zomer-/wintertijd en taalvarianten. De bestaande renderer-test heeft nu een vaste testklok: zijn oude prijsfixture voor één dag was vlak voor middernacht afhankelijk van de werkelijke klok. De testverwachtingen zijn niet afgezwakt.

De 19 bestaande virtuele-dagsimulaties hebben identieke numerieke uitkomsten als de vorige 1.5.9 (uitvoeringstijd uitgezonderd). `app.js`, de bestaande status-API en alle control-/tarief-/Savings-/AutoTune-bibliotheken zijn byte-identiek. Alleen de private presentatieprofielmodule is uitgebreid. De centrale SOC-registratie, samenvoeging en SOC-prognosefuncties zijn ongewijzigd. De PV-dagberekening in de grafiek blijft exact dezelfde als in de vorige levering.

Kloknotatie wisselen tekent opnieuw met de al berekende prognose; het roept geen SOC-prognoseberekening aan. Geen extra P1-listeners, timers, polling, API-verzoeken of opslagcycli. De twee nieuwe velden en migratiemarkering staan binnen het bestaande private widgetprofiel. De bestaande refresh na een expliciete profielsave blijft bestaan.

Geen fysieke Homey-installatie, pixeltest in de Homey-WebView of fysieke CPU/geheugenmeting uitgevoerd. De 16 gerichte suites en 19 simulaties zijn uitgevoerd; de volledige historische testsuite is niet opnieuw gedraaid.

## Gewijzigde bestanden

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
- `test/widget-compact-hours-1.5.9.test.js`
- `test/widget-render-1.5.7.test.js`
- `test/widget-translations-central-soc-1.5.9.test.js`
- `test/widget-wide-scales-pv-reset-1.5.9.test.js`
- `validation/optional-chart-waf-1.5.9/RAPPORT.md`
- `widgets/status/public/index.html`
- `widgets/status/public/visual.html`

Logs: `tests.json`, `proof.json` en `simulations.json`. Syntaxcontrole: 367 JS/CJS, 5 ingesloten scripts, 339 JSON-bestanden. Diff: `changes.diff`. Oudere verslagen in andere validatiemappen zijn historisch; dit verslag beschrijft de huidige aanvulling.
