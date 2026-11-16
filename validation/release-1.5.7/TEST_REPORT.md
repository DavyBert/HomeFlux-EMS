# HomeFlux EMS 1.5.7 — technisch testrapport

Basis: uitsluitend de aangeleverde `HomeFlux-EMS-v1.5.6-EV-Widget-Fix (2)(1).zip`.
De eerdere Shared P1-build is niet als bron gebruikt. Versies, changelog en README zijn bijgewerkt naar 1.5.7; release notes blijven in NL/EN/FR/DE/ES aanwezig.

## Resultaat

- De SoC-prognose gebruikt één genormaliseerde tarieftijdlijn, één reserveberekening achteruit en één energiebalans vooruit. Geen volledige simulatie per laadvenster. Hergebruik bij dezelfde invoer; normale grafiekcadans blijft maximaal eenmaal per minuut. Alleen de eerste historiekontvangst mag de initiële grafiek meteen aanvullen.
- Alleen PV-overschot en werkelijk geplande of afzonderlijk voorspelde laadenergie verhogen de curve. Geen geforceerde stijging naar een doel; minimale SoC wordt niet kunstmatig opgeteld. Vermogenslimieten gelden gezamenlijk voor PV en netladen. EMS-laadblokken en widgetschattingen hebben afzonderlijke markering.
- Laadplanregels komen uitsluitend uit `planningCache`. Een gewijzigde revisie levert een compacte snapshot; ongewijzigde regels worden niet opnieuw verzonden. De planner wordt hiervoor niet aangeroepen. De revisie voorkomt botsingen na een normale appherstart.
- Huisverbruik gebruikt uitsluitend `evSessionDetection.physicalSiteLoadW`, na de bestaande P1-observatie. Dit pad berekent de fysieke last ook zonder EV. Geen aparte reconstructie, EV-statushistoriek, listener of timer voor de widget.
- Vijfminutenpunten bevatten een tijdgewogen gemiddelde plus werkelijke meetduur. Ongeldige PV en meetgaten van meer dan 60 seconden worden niet ingevuld; een bekende nul-PV blijft bruikbaar. Oude tweekolomspunten blijven leesbaar en krijgen geen fictieve vijfminutenduur. De limiet blijft 720 punten, met dezelfde bestaande opslagkey en opslagcadans.
- Eén volledige historiekopvraging per widgetinstantie. Daarna alleen nieuwe punten via de bestaande `/status`-aanvragen, met deduplicatie en dagwisseling. Een mislukte eerste uitlezing start geen herhaallus. Geen volledige reeks bij gewone EV/HVAC/boilerstatuswijzigingen.
- Drie uitgelijnde informatierijen, vier afzonderlijk instelbare laadplanwaarden en unieke contractnamen in de legenda. Alle tekstvelden in de dagkaarten blijven binnen hun kolombreedte. De ingestelde schaal is de voorkeursgrootte; langere tekst wordt zo nodig kleiner. De vier laadplanvakjes hebben lagere titelrijen en minder witruimte. Meting gebeurt binnen de bestaande presentatieronde, uitsluitend bij gewijzigde tekst, profiel of schermbreedte.

## Controles

| Controle | Resultaat |
|---|---|
| Syntax en JSON | 361 JavaScriptbestanden, 5 inline scripts en 325 JSON-bestanden gecontroleerd |
| Volledige oorspronkelijke 1.5.6-suite | 214/229 geslaagd; 15 bestaande fouten |
| Volledige 1.5.7-suite vóór de laatste opmaakcorrectie | 217/231 geslaagd; 14 fouten, allemaal ook aanwezig op de oorspronkelijke basis |
| Nieuwe 1.5.7-controles | 105 gerichte checks plus API-cache/revisiecontroles; geslaagd |
| Productie-DOM van de widget | Na de opmaakcorrectie opnieuw geslaagd: grafiek, contractnamen, EV/HVAC en alle 16 zichtbaarheidscombinaties van het laadplan |
| Opmaakcorrectie: tekstpassing | 48 combinaties van schaal en veldbreedte gecontroleerd; ongewijzigde tekst veroorzaakt geen nieuwe maatmetingen, grotere ruimte herstelt de voorkeursgrootte |
| Opmaakcorrectie: presentatie-isolatie | Bestaande performance- en minuutverversingstests opnieuw geslaagd; syntax gecontroleerd |
| Dynamische regressies | 6/6 suites geslaagd, inclusief uitstel na ochtend- en avonddoel, uur- en kwartierprijzen en tussenliggende dure blokken |
| Timers en listeners | Aantal ongewijzigd in app, API en beide widgetbestanden; geen nieuwe achtergrondlus |
| Werkelijke sturing | Engine, overige regelmodules, drivers en Flow-definities byte voor byte gelijk aan de originele ZIP |
| Savings | Boekhoudfunctie exact gelijk na verwijdering van uitsluitend de oude widgetregistratie |

Eén oorspronkelijke omgevingsfout verdween na het beschikbaar maken van de door een bestaande test gebruikte uitvoermap. Geen nieuwe falende suite tegenover de oorspronkelijke ZIP. De volledige testset is dus **niet volledig groen**. De onderliggende oorzaken van de bestaande fouten zijn niet binnen deze wijziging opgelost. Deze tests zijn niet onderdrukt of uitgeschakeld.

Overblijvende suites:

- `ev-recording-audit-1.2.4.test.js`
- `injection-mode-1.3.1.test.js`
- `performance-split-loop.test.js`
- `phase-reception-1.3.1.test.js`
- `savings-p1-fallback-1.5.4.test.js`
- `settings-startup.test.js`
- `visual-compact-header-1.5.4.test.js`
- `visual-look-1.5.4.test.js`
- `visual-look-light-dark-1.5.4.test.js`
- `visual-look-single-status-1.5.4.test.js`
- `visual-mobile-transparency-release-1.5.4.test.js`
- `visual-savings-rolling-1.5.4.test.js`
- `widget-insights-lifecycle-1.2.1.test.js`
- `widget.test.js`

## Lokale prestatiemeting

Node v24.22.1, jsdom 29.1.1. Scenario: 192 kwartierblokken, 21,6 kWh batterij en dynamisch contract. 300 berekeningen na 50 opwarmrondes.

| Berekening | Originele 1.5.6 | 1.5.7 |
|---|---:|---:|
| Prognose bij gewijzigde SoC | 4.096 ms | 1.000 ms |
| Dezelfde invoer opnieuw | 4.056 ms | 0.061 ms |

Dit meet de lokale JavaScript-prognose, niet de Homey-app-CPU. De P1-observatie doet alleen begrensde rekenstappen met één accumulator; opslag gebeurt niet per P1-bericht. Er is geen fysieke CPU-/geheugenmeting of installatie op een Homey uitgevoerd. De schermcontrole was geblokkeerd door de browseromgeving; DOM-gedrag is getest, pixelweergave op 320/375 px is niet visueel bevestigd. De prognose blijft een indicatie op basis van beschikbare prijs-, PV- en verbruiksgegevens, zonder garantie op toekomstige werkelijke SoC.

## Bestanden en herkomst

De volledige bestandsdiff staat in `changes.diff` naast dit rapport.

Gewijzigd (17):

- `.homeychangelog.json`
- `.homeycompose/app.json`
- `README.md`
- `app.js`
- `app.json`
- `lib/visual-widget-profiles.js`
- `package-lock.json`
- `package.json`
- `settings/visual-widget-profiles-ui.js`
- `test/visual-house-history-1.5.4.test.js`
- `test/visual-look-1.5.3.test.js`
- `test/visual-minute-refresh-isolation-1.5.4.test.js`
- `test/visual-next-soc-goal-1.5.4.test.js`
- `test/visual-tariff-palette-soc-history-1.5.4.test.js`
- `widgets/status/api.js`
- `widgets/status/public/index.html`
- `widgets/status/public/visual.html`

Toegevoegd (3, naast dit rapport en de diff):

- `lib/visual-house-history.js`
- `test/widget-consolidation-1.5.7.test.js`
- `test/widget-render-1.5.7.test.js`

SHA-256 basis-ZIP: `78e3628048f64a7142bfef12c43ccff1c29e9ee106918b90f8327db6928beaeb`

SHA-256 ongewijzigde `lib/ems-engine.js`: `560a67f63f034e3a2539b359c6432cf57ed6d94502390a06f22d083ec2f1830b`
