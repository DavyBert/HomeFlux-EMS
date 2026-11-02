# HomeFlux EMS 1.1.13 — uitgestelde EV-contextaanvragen

## Uitkomst

Uitgangspunt is de recentste beschikbare lokale broncode: de eerder gecorrigeerde 1.1.12, inclusief de deadlinecache, settingscache, input-wijzigingsdetectie en correctie voor identieke modusfeedback. Geen nieuwere externe repositoryversie opgehaald. Versie 1.1.13 is aangemaakt omdat het aantal volledige contextevaluaties aantoonbaar daalt en de gecontroleerde EV-uitgangen op hetzelfde moment of eerder worden gepubliceerd.

Geen instellingen, Flow-kaarten, migraties, vermogensverdeling of laadstrategieën toegevoegd of gewijzigd. Alle productieaanpassingen voor de regeling staan in app.js en betreffen EV-aanvragen, EV-uitvoertimers en hun afhandeling. De manifests, interne versievermeldingen en versiecontroles in tests zijn bijgewerkt naar 1.1.13. Geen nieuwe appstore-releasebeschrijving toegevoegd.

## Analyse van de aanroeproutes

1. De P1-handler vroeg bij een actieve EV op vrijwel elke meting opnieuw `grid_context` aan. De algemene scheduler combineerde die aanvragen al tot het normale interval; de vele aanvragen betekenden dus niet evenveel uitvoeringen. Voor installaties waar alleen EV deze metercontext nodig heeft, wordt een reeds geregistreerde gelijke reden nu aan de ingang samengevoegd. De bestaande normale timer en zijn uitvoermoment blijven bestaan. Als exportbegrenzing, HVAC of boiler deze route nodig heeft, blijft ook de oude aanroepstructuur behouden.
2. `scheduleEvPublish()` en `scheduleAdditionalEvPublish()` vroegen bij hun uitvoerdeadline een onmiddellijke volledige EMS-context aan. Daarbij werden batterijplanning, PV-context en overige flexibele modules meegenomen terwijl een EV-uitvoer wachtte. Ze gebruiken nu hetzelfde zelfstandige, fysieke multi-EV-pad als de bestaande EV-heartbeat. Hun uitvoerwachttijd wordt niet met 15 seconden verlengd.
3. Meerdere EV-uitvoertimers konden elk een verse portfoliopass veroorzaken. Een daadwerkelijke publicatiepass bedient alle EV's, ruimt de oude uitvoerwakeups op en laat de bestaande uitvoerpoorten uitsluitend nog noodzakelijke timers heractiveren.
4. Werkelijk gewijzigde stroomfeedback ging naar de algemene contextaanvraag. De niet-kritieke feedbackaanvraag kan nu met andere EV-aanvragen in één timer worden samengevoegd. Identieke feedback bereikt deze aanvraagroute niet.
5. `calculateEvDecision()` en `calculateEvPortfolioDecisions()` blijven de bestaande strategie en allocatie uitvoeren. De berekening bij voorbereiding en die bij fysieke publicatie zijn niet zonder bewijs gelijk: pending/in-flight batterijcommando's en inmiddels gewijzigde metingen kunnen andere headroom geven. Deze noodzakelijke controleberekeningen zijn bewust behouden; er is geen algemene portfoliocache toegevoegd.
6. `getEvGridImportControlStatus()` en de werkelijk gemeten EV-stroom blijven de bestaande batterijbescherming bepalen. Deze functie, `updateEvStatusInput()` en de snelle batterij-evaluatie zijn inhoudelijk ongewijzigd. De oudere correctie voor herhaalde 10 A modusfeedback is dus behouden.

## De timer van 15 seconden

- `evContextRefresh` bewaart één timer, een verzameling redenen, een referentie van de laatst berekende EV-context en een generatienummer.
- De bestaande Flow-P1-handler en de API-P1-route roepen `updateEvMeterContextRequest()` aan. Dit leest uitsluitend reeds aanwezige meetwaarden, verbindingen en sessiestatus. De bestaande 100 W-grens blijft gebruikt. De vergelijking neemt de huidige batterijbijdrage mee zodat alleen de batterijrespons op P1 geen nieuwe aanvraag vormt. De nieuwe snelle controle roept geen tariefberekening, settingsuitbreiding of portfolioberekening aan.
- `requestEvStatusContext()` behandelt gewone gewijzigde feedback per EV. Een verbindingsovergang gaat rechtstreeks naar de bestaande onmiddellijke contextregeling.
- `setEvContextRefreshRequest()` start bij de eerste geldige reden één timer op 15.000 ms. Latere redenen voegen zich daarbij; P1-metingen of andere EV's wijzigen de deadline niet.
- Als een reden verdwijnt, vervalt die afzonderlijk. Als geen reden overblijft, wordt de timer direct geannuleerd. Een P1-afwijking die vanzelf herstelt, voert dus geen extra EV-context uit.
- Bij aflopen wordt eenmaal `refreshEvOnlyContext()` aangevraagd. Dit voert de bestaande fysieke EV-portfolioberekening uit en publiceert via de ongewijzigde stroom-/modus-/veiligheidsregels.
- Een gewone context, EV-heartbeat of uitvoerpass die het actuele portfolio al heeft berekend, roept `completeEvContextRefresh()` aan. Daarmee wordt de wachtende aanvraag afgehandeld en de referentie bijgewerkt. Ook het pad zonder actieve Smart-allocaties wordt afgehandeld.
- Bij een bezette publicatie wordt opnieuw gecontroleerd of de uitgestelde aanvraag nog geldig is. Een generatienummer voorkomt dat een oude wachtende taak of zijn afhandeling een nieuwe aanvraag uitvoert of wist.
- Verwijderen van de laatste EV en afsluiten van de app ruimen de aanvraag op. Er is geen nieuwe intervaltimer of pollingloop.

De normale scheduler, het geconfigureerde slow interval, de bestaande heartbeat en urgente aanvragen blijven behouden. De 15 seconden gelden alleen voor extra gewone EV-optimalisatie tussen de reguliere evaluaties. Een reeds verschuldigde normale evaluatie mag eerder uitvoeren en de aanvraag daarmee afhandelen.

## Veiligheid en bestaande functionaliteit

De bestaande directe routes voor Peak Guard, netmeetveiligheid, EV-sessiestop, verbindingsovergang, EV-SoC-doel, tarief-/PV-importbeveiliging en P1-belastingdetectie worden niet achter de nieuwe timer geplaatst. De bestaande per-EV regels voor veiligheidsverlagingen blijven hun uitvoerinterval omzeilen. Fysieke stroomcontrole, pending-P1-bescherming, PV-eerst-voor-het-huis, expliciet toegestane batterijondersteuning en nachtoverschot blijven in de bestaande berekeningen aanwezig.

PV-, dynamisch/tarief-, deadline- en multi-EV-laden blijven dezelfde berekeningen en gewichten gebruiken. De API verwerkt een compleet invoerpakket voordat zij een EV-aanvraag doet. Een pakket met meerdere verbindingsovergangen veroorzaakt één onmiddellijke aanvraag. EV-besturing zonder batterij of met uitgeschakelde batterijregeling blijft via het bestaande zelfstandige EV-pad werken.

## Metingen

Node v24.19.0, Linux-host, werkelijke `process.cpuUsage()`-metingen. 28 bestaande productiereplays van elk 240 virtuele seconden: stroom/modus/hybrid, één en meerdere EV's, ontbrekende/verouderde feedback, tarieven, PV, Peak Guard, expliciete batterijondersteuning, Split Command en wachtende publicaties. Drie afzonderlijke vóór/na-paren. Dezelfde applicatie-, Flow-, scheduler- en publicatiecode draait; Homey-I/O, tijd en fysieke respons zijn gesimuleerd. CPU-metingen bevatten de opstart van iedere replay. Dit zijn geen Homey-CPU-percentages of metingen op een echte laadpaal.

| Metriek, per reeks van 28 replays | Vóór | Na |
| --- | ---: | ---: |
| Volledige EMS-contextaanroepen vanuit de replay, exclusief interne opstartpasses | 253 | 168 |
| Aanroepen algemene contextaanvraag vanuit de replay | 5.487 | 192 |
| Portfoliofunctie-aanroepen, inclusief lege opstartpasses | 728 | 602 |
| Werkelijke niet-lege EV-portfolioberekeningen, bestaande teller | 618 | 492 |
| Fysieke EV-accountingcontroles, bestaande teller | 14.993 | 14.964 |
| Ontvangen EV-feedbackupdates | 1.301 | 1.301 |
| Als ongewijzigd herkende EV-feedbackupdates | 1.236 | 1.236 |
| Werkelijk gewijzigde EV-inputs | 65 | 65 |
| Planningberekeningen | 56 | 56 |
| Batterijpublicaties | 82 | 82 |
| Mediane totale proces-CPU, ms | 8.560,456 | 7.787,950 |

Daarmee dalen volledige contextpasses circa 34%, niet-lege portfolioberekeningen circa 20% en de mediane totale proces-CPU circa 9%. De meetruis is zichtbaar: totale vóórwaarden 8.354,714–8.755,847 ms; nawaarden 7.226,417–8.532,222 ms. De structurele aantallen zijn in alle drie de runs gelijk. De 192 algemene aanvragen zijn geen totaal van alle nieuwe EV-signalen: daarnaast worden 683 lichte EV-signalen gecombineerd tot 47 timers; 40 lopen af en voeren één EV-pass uit, 7 worden eerder door een andere actuele pass afgehandeld. Deze brede replay bevat geen volledig ingetrokken timer; de aparte regressie controleert dat expliciet.

Synchrone functieprofielen, medianen over dezelfde drie runs (ms). Geneste tijden niet optellen:

| Functie | Aanroepen vóór → na | CPU vóór | CPU na |
| --- | ---: | ---: | ---: |
| `evaluateContextNow()` | 308 → 223 | 2.895,828 | 1.965,870 |
| `calculateEvDecision()` | 644 → 511 | 2.058,901 | 1.684,435 |
| `calculateEvPortfolioDecisions()` | 728 → 602 | 2.489,515 | 2.039,821 |
| `getEvGridImportControlStatus()` | 15048 → 15019 | 1.630,182 | 1.664,259 |
| `updateEvStatusInput()` | 1301 → 1301 | 93,563 | 92,215 |

De fysieke controles zijn niet weggecachet. De kleine afname volgt uit minder overbodige contextpasses; hun P1-veiligheidsroute blijft intact. Ook een scenario dat niet profiteert is zichtbaar in de ruwe data: bij een inactieve EV met niet-toegestaan tarief is er één extra EV-pass. De winst geldt voor de gemeten totale werklast en is geen garantie voor elk individueel profiel.

Alle gecontroleerde eindwaarden van de 28 replays zijn gelijk. De EV-uitvoerreeksen hebben dezelfde stroom-, modus- en toestemmingswaarden; 26 reeksen hebben exact dezelfde tijdstippen. In twee reeksen wordt een gewone veilige laadstart/verhoging al op seconde 16 uitgevoerd in plaats van seconde 60. Geen gecontroleerde EV-uitgang wordt later gepubliceerd. De Peak Guard-stop blijft op seconde 90 van de betreffende replay.

## Regressies en afbakening

`npm run check` slaagt volledig, inclusief syntaxcontroles en alle bestaande tests. De nieuwe `ev-context-delay-1.1.13.test.js` is opgenomen in zowel `test` als `check` en slaagt met 20 scenario's:

- 300 identieke 10 A-updates om de seconde voor elk van current, mode en hybrid, met werkelijke P1-verwerking en de normale heartbeats;
- ruis onder de bestaande grens, kortstondige PV-afwijking, annulering vóór 15 seconden en onschadelijke oude callback;
- een aanhoudende aanvraag, precies één evaluatie en geen herstart door dezelfde afgehandelde situatie;
- een normale contextberekening tijdens een wachtende aanvraag;
- gelijktijdige feedback van twee EV's, behoud van de oorspronkelijke deadline en verdwijnen van slechts één reden;
- onmiddellijke Peak Guard-stop met twee EV's voor alle drie besturingstypen;
- onmiddellijke disconnect via Flow en via een API-batch met twee EV's;
- twee gelijktijdige uitvoertimers die op hun oorspronkelijke deadline één portfolio en geen volledige context uitvoeren;
- intrekken van een verlopen aanvraag terwijl publicatie bezet is, plus behoud van een nieuwe generatie;
- stoppen van de app en verwijderen van de laatste EV;
- EV-laden met nul batterijen en bij uitgeschakelde batterijregeling.

De bestaande suite controleert onder meer 55 onafhankelijke-EV-scenario's, 14 batterijbeschermingsscenario's, 55 SoC-completion-scenario's, 33 EV/batterij-overgangen, 72 PV/bewolkings-/STOP-scenario's en de bestaande deadlinecachecontroles.

Daarnaast zijn vijf replays met EV uitgeschakeld rechtstreeks tegen de eerdere broncode vergeleken: batterijzelfverbruik, PV/exportbegrenzing, actieve HVAC, actieve boiler en gecombineerde modules. Hun volledige batterij-/flexibele uitvoerreeksen en contextmomenten zijn exact gelijk. De controller-, settings-, widget-, driver- en Flow-bestanden (267 bestanden) zijn bytegelijk. Negentien belangrijke methodes in app.js zijn tekstgelijk, inclusief de normale scheduler, heartbeat, snelle batterij-evaluatie, gewone contextevaluatie, fysieke EV-accounting, feedbackverwerking en HVAC-/boiler-/PV-berekeningen. Zie `ev-context-scope-audit.json`.

Twee eerdere tests zijn inhoudelijk aangepast aan de gevraagde nieuwe EV-aanroepstructuur: de uitvoertimer verwacht een verse EV-portfoliopass in plaats van de hele EMS-context; de input-work-test herkent een geldige uitgestelde aanvraag naast een algemene contextaanvraag. Versieasserties zijn naar 1.1.13 bijgewerkt. Veiligheids- en vermogensasserties zijn behouden.

## Bestanden en herhalen

- `ev-context-regression-results.txt`: volledige geslaagde syntax-/testuitvoer.
- `ev-context-before-1.json` t/m `-3.json`, `ev-context-after-1.json` t/m `-3.json`: ruwe herhaalde CPU-metingen en EV-uitvoerreeksen.
- `ev-context-summary.json`: totalen, CPU-medianen en verschillen in uitvoertijdstippen.
- `ev-context-unrelated-comparison.json`: directe vergelijking van de vijf overige-regelingenreplays.
- `ev-context-scope-audit.json` en `ev-context-app.patch`: broncodecontrole en reviewbare productiewijziging.

Vanaf de projectmap: `npm run check`. Voor een vergelijking met een apart uitgepakte gecorrigeerde 1.1.12: `node test/ev-context-cpu-comparison.cjs /pad/naar/1.1.12` en dezelfde opdracht met `.`; voor overige regelingen `node test/ev-context-unrelated-comparison.cjs /pad/naar/1.1.12`.

De resterende verificatie is een echte Homey-meting onder de eigen laadpaal-, Flow- en PV-belasting. De gemeten hostwinst mag niet worden omgezet in een voorspeld Homey-percentage.
