# HomeFlux EMS 1.1.12 — identieke EV-feedback

## Uitkomst en afbakening

Uitgangspunt: de bijgevoegde HomeFlux-EMS-v1.1.12-deadline(1).zip, inclusief de reeds aanwezige deadlinecache en EV-wijzigingsdetectie. Geen nieuwere externe repositoryversie opgehaald. Versienummer ongewijzigd in alle manifests.

De fout is aantoonbaar gereproduceerd bij `evControlType: mode`, verbonden EV, herhaalde 10 A, uitgestuurd STOP en P1 die geen passend actief modusprofiel bevestigt. Dit bewijst een concrete oorzaak die bij de aangeleverde tellers past; zonder de instellingen en runtime van de oorspronkelijke Homey is niet bewezen dat dit de enige oorzaak van precies 19,68% is. De current-/hybrid-route wordt niet gewijzigd.

## Volledig handlerpad en oorzaak

Genummerde, generieke en geconfigureerde Flowkaarten komen via de slot-/configured-adapters bij dezelfde handlers en `updateEvStatusInput()` uit. Ook de API gebruikt die helper.

1. De handler valideert de invoer en bepaalt of de verbinding verandert.
2. `updateEvStatusInput()` detecteert stroom-/verbindingswijzigingen, maar verwerkt daarnaast energietelling, eventuele dalende stroom voor batterijbescherming, timestamps, autotune en sessieregistratie.
3. `updateEvSessionFromCurrent()` werd ook bij ongewijzigde 10 A uitgevoerd. Het zette `state='charging'`, `detectionSource='current'`, `lastChargingAt=now`, `zeroCurrentSince=0` en `loadAbsent=false`.
4. De volgende P1-update roept `updateEvPortfolioLoadDetection()` aan. Bij modusbesturing en STOP kan er geen passend smart-/standard-profiel zijn. Die functie zet `loadAbsent=true`; na de observatietijd ook `state='paused'` en `detectionSource='house_load'`.
5. Deze overgang geeft `true` terug. De P1-handler vraagt onmiddellijk `requestContextEvaluate(true, 'ev_house_load_protection')`. De volgende identieke EV-input wist de toestand opnieuw. Er ontstaat dus een herhaalde wisselwerking buiten de bestaande EV-wijzigingsdetectie.

Daarom blijft `evInputEvaluationRequests` laag, terwijl het aantal contextevaluaties oploopt met de feedbackfrequentie. De start van de sessie wordt niet telkens opnieuw geregistreerd, maar de toestand wordt wel telkens teruggezet.

`grid_context` is afzonderlijk een normale, vertraagde contextaanvraag wanneer een flexibele last geconfigureerd is en de netwaarde voldoende verandert of een uitgang actief is. Deze aanvraag respecteert het slow interval. Een onmiddellijke `ev_house_load_protection` kan de verzamelde redenen meenemen; een reden bij een evaluatie betekent niet dat die reden zelfstandig de onmiddellijke uitvoering veroorzaakte. In de vaste reproductie was er slechts één `grid_context`, tegenover 180 onmiddellijke beschermingsaanvragen vóór de correctie.

## Waar wordt CPU verbruikt?

De indirecte trigger is de bovengenoemde sessieoverschrijving. Het dure werk zit vervolgens in `runContextEvaluation()` → EV-portfolio/evaluatie/publicatie, met `calculateEvPortfolioDecisions()` en `calculateEvDecision()`. Een Node CPU-profiel van de originele code toont vooral `localParts` en `zonedParts` als eigen rekentijd; deze worden gebruikt door onder meer `findNextLocalTime`, `countEvTariffMinutes` en tariefberekeningen. Het profiel bevat ook opstarttijd; inclusieve tijden van bovenliggende functies mogen niet worden opgeteld.

De bestaande exacte-timestamp-deadlinecache vermindert herhaald werk binnen dezelfde timestamp, maar voorkomt geen nieuwe contextberekeningen op iedere volgende seconde. Er is daarom geen extra cache of vertraging aan de P1-regeling toegevoegd.

## Gerichte correctie

Enige gewijzigde productiefunctie: `updateEvStatusInput()` in app.js.

- Bepaalt afzonderlijk of de vorige fysieke stroommeting nog vers was.
- Identieke verse mode-feedback voert geen nieuwe sessieovergang uit en wist dus geen door P1 bepaalde `loadAbsent` meer.
- Een werkelijk actieve sessie behoudt updates van `lastChargingAt`.
- Gewijzigde stroom, gewijzigde verbinding en herstel na verlopen feedback volgen het bestaande sessiepad.
- Freshness-timestamps, energietelling vóór het overschrijven van de vorige meting, autotune, diagnostiektellers en registratie van dalende stroom blijven uitgevoerd.
- Current-/hybrid-besturing, P1-handler, scheduler, PV-regeling en fysieke batterijvermogenscontrole blijven ongewijzigd.

Een onvoorwaardelijke vroege return vóór alle verwerking zou energietelling, feedback-freshness en autotune verliezen. Daarom wordt uitsluitend de bewezen onnodige sessieoverschrijving overgeslagen. Het behouden van de P1-toestand is de bedoelde bugcorrectie.

## Werkelijke CPU-metingen

Node v24.19.0 op de beschikbare Linux-host, `process.cpuUsage()` (user + system), zonder profiler bij onderstaande meting. Elke proef voert 180 seconden virtuele bedrijfstijd versneld uit met P1 iedere seconde, dezelfde configuratie, echte applicatie-/Flow-/scheduler-code en gemockte Homey-I/O. Heartbeats worden iedere minuut uitgevoerd. Opstarten valt buiten het meetvenster. Dit zijn echte verbruikte CPU-milliseconden, geen gemeten Homey-CPU-percentages en geen realtime hardwaretest.

| Feedback | CPU vóór | CPU na | Context vóór → na | Portfolio vóór → na | Beschermingsaanvragen vóór → na |
| --- | ---: | ---: | ---: | ---: | ---: |
| Iedere 10 s | 583,192 ms | 202,565 ms | 19 → 3 | 41 → 9 | 18 → 2 |
| Iedere 1 s | 4595,442 ms | 210,655 ms | 181 → 3 | 365 → 9 | 180 → 2 |

Bij iedere seconde daalt de gemeten CPU-tijd circa 95,4%. Het resterende verschil tussen beide frequenties is 8,090 ms over 180 gesimuleerde seconden; kleine verschillen zijn gevoelig voor JIT/GC en meetruis. De structurele bevestiging is dat beide scenario's nu hetzelfde aantal context- en portfolioberekeningen uitvoeren. De twee overgangen betreffen eerste afwezigheidsdetectie en bevestiging na de observatietijd.

## Verificatie

- De volledige bestaande `npm test`-reeks slaagt; uitvoer staat in regression-results.txt.
- Daaronder: 14 batterijbeschermingsscenario's, 55 SoC-completion-scenario's, 33 EV-batterijovergangen, 72 PV/STOP-scenario's, 29 EV-input-work-scenario's en 238 deadlinecachecontroles.
- Nieuwe `test/ev-duplicate-cpu-1.1.12.test.js` slaagt afzonderlijk en is toegevoegd aan `test` en `check` in package.json.
- Nieuwe regressie controleert beide feedbackfrequenties, STOP-uitgang, begrensd batterijvermogen, verse timestamps, geen herhaalde beschermingsaanvragen, veranderende stroom, stale recovery en disconnect.
- `node --check app.js` slaagt.

Reproductie met gecorrigeerde broncode: `node test/ev-duplicate-cpu-1.1.12.test.js`.
Vergelijking met een uitgepakte originele broncode: `BASELINE=1 node test/ev-duplicate-cpu-1.1.12.test.js /absoluut/pad/naar/origineel`.

## Nog nodig op Homey

De oorspronkelijke 4–5% versus 19,68% kan hier niet als hardwaremeting worden herhaald. Vergelijk na installatie onder gelijke omstandigheden opnieuw 10 s en 1 s, met dezelfde P1-cadans en CPU-diagnostiek. Controleer vooral `contextEvaluations`, `ev_house_load_protection`, EV-uitgangen en batterijvermogen. Een aangesloten Homey en volledige oorspronkelijke configuratie waren hier niet beschikbaar; de hostmetingen mogen niet als nieuwe Homey-percentages worden voorgesteld.
