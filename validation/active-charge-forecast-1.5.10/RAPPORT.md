# HomeFlux EMS 1.5.10 — Actieve laadprognose

Uitgangspunt: `HomeFlux-EMS-v1.5.10-Forced-Charge-SOC-Forecast-Fix.zip`, SHA256 `8f0b97b966646147f6989ba5ccfd2c4e9152560a478a1b475c5bbe32f247cf0c`. Uitsluitend deze laatst opgeleverde 1.5.10 als codebasis. Node.js 22.23.5; versie blijft 1.5.10.

## Probleem en patch

Het bevestigde laadvenster werd wel weergegeven maar bepaalde niet rechtstreeks de laadenergie op de SOC-curve. Een afwijkende zelfstandige doelberekening of ontbrekende optionele tariefrechten kon daardoor een curve opleveren die het actieve netladen negeerde. In de gerichte foutinjectie bleef de originele 1.5.10 op 87,8% tot 17:00 én de volgende ochtend. De nieuwe regressietest faalt op die originele bron en slaagt met deze patch.

Alleen de presentatie is aangepast:

- Een daadwerkelijk actieve normale netlaadbeslissing volgt haar bevestigde laadvenster en actuele officiële doel. De vermogens-, tijd-, verlies-, PV- en Peak Guard-limieten blijven gelden. De volledige opgeslagen kWh worden niet opnieuw toegevoegd.
- Het officiële doel verankert uitsluitend de huidige planningsfase. Daarna wordt het toekomstige verloop opnieuw berekend uit de voorspelde SOC; een klein oud plan begrenst toekomstige herplanning niet.
- Een actuele ontlaadbescherming wordt slechts meegenomen tot het einde van het huidige tarief/de fase. Zij wordt niet over de volledige toekomst doorgetrokken.
- De bestaande TOU-cache bewaart ook de exacte datumgebonden laad-/ontlaadrechten als zelfstandige prognosecontext. Dezelfde statusaanvraag levert die mee. De client vult daarmee uitsluitend ontbrekende displayvelden aan; expliciete verboden blijven leidend. Geen afleiding uit kleur of goedkoopte.
- Een actief plan kan normale dynamische laadlimieten, verantwoord uitstel, actuele verboden, veiligheidsherstel, pauzes of externe overname niet omzeilen. PV-only laden wordt niet als netladen behandeld.
- Bij een vast contract respecteert de prognose ook het bestaande EMS-wachten op een volgend venster bij maximaal laden met een nog niet bereikt doel. Dit is uitsluitend een weergavecorrectie; de engine blijft identiek.

## Simulaties

Alle nieuwe scenario’s starten op 17 november 2026 om 16:25, Europe/Brussels, met 87,8% SOC en 21,6 kWh capaciteit. Het testplan loopt van 16:23 tot 16:45, met 1.800 W en 0,6 kWh als testwaarden; dagdoel 90%. De vermogenswaarde, toekomstige vraag en PV van morgen zijn simulatie-invoer en zijn niet uit de screenshots gemeten. Vraag: 0,6 kW; PV vandaag 4,4 kWh, resterend 0; PV morgen 4,4 kWh. PV-geval: vandaag 10 kWh, resterend 2. TOU gebruikt superdal/dal/piek 0,20/0,28/0,40 €/kWh met de bestaande weekregeling. Dynamische tests gebruiken bekende uren/kwartieren van 0,10/0,28/0,50 €/kWh, met tien goedkope en vijf dure uren in de gepubliceerde dagcurve. Het vaste contract gebruikt het expliciete venster 11:00–17:00 zonder maandreserve.

Virtuele SOC wordt in stappen van vijf minuten teruggevoerd aan de echte, ongewijzigde engine. Planner en dynamische nacht-/uitstelregels worden daarbij opnieuw gebruikt. Getallen hieronder zijn prognose / virtuele engine.

| Scenario | 17:00 | Volgende 07:00 | Volgende 17:00 | Grootste doelafwijking |
| --- | ---: | ---: | ---: | ---: |
| normal active charging | 90.00 / 89.98% | 94.98 / 94.98% | 90.09 / 89.68% | 0.414 pp |
| maximum/latest active charging | 90.00 / 89.94% | 95.00 / 93.59% | 90.00 / 89.85% | 1.407 pp |
| normal with missing display permissions | 90.00 / 89.98% | 94.98 / 94.98% | 90.09 / 89.68% | 0.414 pp |
| maximum with missing display permissions | 90.00 / 89.94% | 95.00 / 93.59% | 90.00 / 89.85% | 1.407 pp |
| maximum/early active charging | 90.00 / 90.03% | 95.00 / 93.68% | 91.28 / 91.18% | 1.321 pp |
| PV and grid charging | 92.87 / 92.23% | 95.00 / 94.73% | 90.00 / 89.43% | 0.639 pp |
| dynamic hourly active charging | 90.00 / 89.94% | 95.00 / 93.59% | 95.00 / 94.90% | 1.407 pp |
| dynamic quarterly active charging | 90.00 / 89.94% | 95.00 / 93.59% | 95.00 / 94.90% | 1.407 pp |
| fixed contract, active charging | 90.00 / 89.45% | 90.00 / 89.45% | 89.62 / 89.35% | 0.550 pp |

De volledige SOC-, laad-, ontlaad- en PV-tijdreeksen staan in `simulations.json`. Het TOU-geval volgt de actieve lading naar circa 90% en toont vervolgens de ontlading volgens de bekende tarieven. Een PV-overschot mag de batterij boven het lagere netlaaddoel vullen, tot de ingestelde maximale SOC. Bij maximaal laden in het vaste contract houdt de echte EMS tijdens het wachten energie vast; de prognose volgt dat gedrag.

Aanvullende controles slagen: onvoldoende laadvermogen; afwijkend synthetisch doel tegenover het officiële doel; geen dubbeltelling bij gewijzigde oude plankWh; geen verzonnen dynamische prijzen; expliciete importvermijding en laadverboden; juiste tarief-ID/tijd bij herstel van rechten; geen actieve-planvoorrang voor PV-only, pending, pauze, uitgeschakelde/externe sturing of veiligheidsherstel; dynamisch uitstel blijft leidend; cachehergebruik en invalideren bij relevante laadstatuswijziging.

## Overige validatie

- 19 bestaande virtuele dagen plus 120 exacte dynamische-uitstelvergelijkingen slagen. Alle 19 oorspronkelijke SOC-punten en doelwaarden zijn exact gelijk gebleven.
- De 8 geforceerd-ladensimulaties uit de voorgaande correctie slagen eveneens.
- Werkelijke app met gemockte Homey-I/O → widget-API → ingesloten renderer is getest voor normale en maximale actieve lading, inclusief weggehaalde optionele displayrechten. De zelfstandige cachecontext herstelt ze. Twee statuslezingen gebruiken dezelfde cache en doen samen één bestaande tariefopbouw.
- Classic status bouwt deze optionele context niet. Geen instellingenwrites, echte planvervanging, batterijcommando’s of extra regeltimers door API/widget.
- Bestaande integratietest voor geforceerd laden, vijf talen, centrale SOC-historiek, herstart/middernacht, 720-puntenlimiet, brede grafiek, PV-dagreset, compacte tijdas en minuutpoort slagen.
- De bronhash van de betreffende prognoseregio in de bestaande regressietest is bijgewerkt wegens de expliciet gevraagde wijziging; de tariefnormalisatie- en PV-displayhash blijven onveranderd.

## Scope, prestaties en grenzen

Bytevergelijking bevestigt: `app.js`, alle bestaande `lib/`, `drivers/`, `settings/`, `locales/`, manifest- en packagebestanden zijn ongewijzigd. Dus geen aanpassing aan echte EMS-regeling, batterijcommando’s, laadplanning, tariefberekeningen, P1, huisverbruik, Savings, AutoTune, EV, HVAC of boiler. Layout/profielen/kleuren en centrale historie zijn ongewijzigd. Alleen prognosecode, read-only widget-API-context, widget-cacheversie, bijbehorende tests en de huidige vijf release notes zijn gewijzigd.

Geen nieuwe timers, listeners, HTTP-verzoeken, opslagacties of herberekenmomenten. Extra context wordt eenmalig opgebouwd binnen de bestaande minuutcache. Bij een standaard TOU-schema bevat die 12 blokken en circa 3.580 JSON-bytes; de tariefopbouw blijft begrensd op maximaal 128 blokken. De al bestaande widgetberekening blijft maximaal eenmaal per minuut plaatsvinden. Dit is kleine extra geheugen-/overdrachts- en rekenlast; fysieke Homey-CPU is niet gemeten.

Geen fysieke Homey-/batterijtest, volledige projecttestsuite of Homey CLI-validatie uitgevoerd. De precieze oorspronkelijke veldinhoud op de telefoon is niet vastgelegd; de gereproduceerde oorzaak is dus niet bewezen als enige oorzaak op die installatie. De patch verhelpt de aangetoonde foutklasse en de tegenspraak tussen actuele EMS-lading en zelfstandige prognose. Bij werkelijk onbekende toekomstige rechten/prijzen wordt geen toekomstig laadrecht of goedkoop tarief verzonnen.

## Bestanden

- `.homeychangelog.json`
- `README.md`
- `test/widget-translations-central-soc-1.5.9.test.js`
- `widgets/status/api.js`
- `widgets/status/public/index.html`
- `widgets/status/public/visual.html`
- `test/widget-active-charge-integration-1.5.10.test.js`
- `test/widget-active-charge-forecast-1.5.10.test.js`
- `validation/active-charge-forecast-1.5.10/*` — dit verslag, bewijs, diff en simulatieresultaten.
