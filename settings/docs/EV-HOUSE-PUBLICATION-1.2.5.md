# HomeFlux EMS 1.2.5 — huisreferentie bij gepubliceerde Mode-commando’s

Dit is een gerichte wijziging binnen **1.2.5**, gebaseerd op de laatst geleverde volledige 1.2.5-ZIP met Status, Planning en Inzichten. Bron-SHA-256: `3cf65de95d6d9378fa3d5eff0f088169077999f39a09bfa5da868995b1297599`. Alle widgetbestanden blijven bytegelijk. Bestaande instellingen, historiek en EV-energieregistratie blijven behouden.

## Aangetoonde oorzaak en bestaande beveiliging

De gewone Mode-leerpaden blokkeerden veel actieve laadmetingen al op basis van de gepubliceerde modus. Die bescherming was onvolledig: `endedLatched` kon het langetermijnleren vrijgeven, disconnect kon de gedeelde referentie wissen en opnieuw aansluiten kon haar vervangen voordat een STOP was verstuurd. Publicatievelden waren runtimegegevens en overleefden een herstart niet. Bij EV 1 kon het interne modusveld bovendien wijzigen zonder dat een modus-Flow-trigger beschikbaar was. Er bestond geen persistent bewijs dat het specifieke moduscommando daadwerkelijk gepubliceerd was.

De vroegere 60-secondenreferentie mocht bij een opgeslagen STOP-uitgang ook fysieke EV-restlast als conservatieve huisbovengrens opnemen. Deze wijziging respecteert de gevraagde grens: **een berekende STOP geeft niets vrij; een geslaagde STOP-publicatie mag nieuwe huiswaarneming weer starten**.

## Exact publicatiemoment

Uitsluitend bij **modussturing**:

1. Vóór het versturen van Smart/Standard wordt de bestaande betrouwbare kandidaat gelezen. P1-invoer tijdens het wachten op de echte Mode-trigger wordt tijdelijk uitgesloten van huisleren.
2. Zodra die specifieke Flow-trigger succesvol resolveert, wordt de laatste betrouwbare referentie vastgelegd en het publicatiebewijs opgeslagen. De langetermijnhistoriek, het 60-secondenvenster en overige huisreferentiepaden blijven beschermd.
3. Herhaald START, Smart/Standard-wissels, Emergency, onbekend laden, 0 A, `allowed: false`, sessie-einde en disconnect geven deze bescherming niet vrij en leggen geen hogere referentie vast.
4. Alleen een geslaagde STOP-modus-Flow-publicatie geeft het leren weer vrij. Het recente venster begint opnieuw met post-STOP-metingen; de bestaande eisen blijven gelden: zes geldige punten, minimaal 54 seconden dekking, maximaal tien seconden tussen punten en verse P1/PV. De laatst betrouwbare referentie blijft ondertussen behouden.
5. Een mislukte STOP laat het bestaande publicatiebewijs en de referentie intact. Slaagt de Mode-STOP maar mislukt een latere toestemmingspublicatie, dan blijft STOP terecht als verstuurd geregistreerd.
6. Een tokenwijziging of een modusveld zonder Mode-trigger geldt niet als publicatie. Ook de bestaande handmatige uitvoertest gebruikt ditzelfde bewijs wanneer hij werkelijk een Mode-commando verstuurt.

Er worden geen andere laadcommando’s, nieuwe fysieke device-reads, timers, planners of polling toegevoegd. Bestaande intervals, publicatiemutexen en noodstoproutes blijven van toepassing. Een failed START herstelt de vorige publicatiestatus; de tijdens de START-publicatie uitgesloten samples worden niet opnieuw als geldige huisdata gebruikt.

## Eén gedeelde referentie, meerdere EV’s en herstart

`_evModeHouseReference` bevat een klein intern versie-1-record: maximaal vier laatst geslaagde moduspublicaties met tijdstip en één gedeelde betrouwbare huisreferentie. Het bevat geen laadplanning, fictief vermogen of onafhankelijke energieregistratie. Het wordt op relevante publicatiewijzigingen opgeslagen, niet per P1-meting. Een identiek herhaald commando veroorzaakt geen extra opslag. Het instellingen-event voor dit interne record start geen nieuwe contextberekening.

Eén nog actieve Mode-publicatie houdt de gedeelde referentie beschermd, ook als een andere EV stopt. Ampère- en hybridesturing behouden hun meet- en leerpad; Mode-beveiliging verhindert wel dat een andere EV in een gemengde vloot de gedeelde beschermde referentie overschrijft.

Bij herstart worden het bewijs en de referentie vóór registratie van nieuwe meetgegevens hersteld. Zowel een geldige 0 W als een onbekende referentie blijven correct onderscheiden. Een opgeslagen oude STOP is bij onbekende/aangesloten EV op zichzelf geen nieuw bewijs over de fysieke toestand na herstart: het leren wacht op een nieuwe echte publicatie. Daardoor kan ook een herstart tijdens een onvoltooide START-publicatie niet simpelweg op basis van een oud STOP-veld beginnen te leren.

**Een geslaagde Flow-publicatie is geen onafhankelijke laadpaalbevestiging.** Na een geslaagde STOP kan de auto fysiek nog uitlopen of kan de verbonden Flow/hardware het commando niet uitvoeren. Volgens de gevraagde grens wordt het leren dan wel vrijgegeven; er is geen nieuwe fysieke STOP-detectie of extra wachttijd toegevoegd. De wijziging garandeert dus geen zuivere huismeting bij genegeerde STOP-commando’s.

## Gewijzigde functies en bestanden

Productiecode: alleen `app.js`.

Bestaande functies: `onInit()`, `recordEvHouseLoadSample()`, `recordRecentEvHouseLoadSample()`, `getEvStartHouseReference()`, `applyEvStartHouseReference()`, `handleEvDetectionConnectionTransition()`, `recordEvBatteryHouseReference()`, `publishEvDecision()`, `publishAdditionalEvDecision()`, `testEvOutput()`.

Kleine publicatiehulpfuncties: `restoreEvModeHouseReference()`, `hasEvModeHouseCommandLock()`, `isEvModeHouseLearningFrozen()`, `noteEvModeHousePublished()`, `trackEvModeHousePublication()`. Dit zijn registratie en leerbeveiliging rond de bestaande uitvoer, geen tweede EV-statusmachine of planner.

`calculateEvPortfolioDecisions()`, EV-planningsfuncties, vermogensschatter, uitgangspolitiek, batterijregeling en Savings-integrator zijn inhoudelijk ongewijzigd. Bronvergelijking bevestigt bytegelijke modules: `lib/flexible-loads.js`, `lib/ev-deadline-planner.js`, `lib/ev-output-policy.js`, `lib/ev-session.js`, `lib/ev-house-reference.js`, `lib/savings.js`, `lib/ev-energy-breakdown.js`, `lib/ev-dashboard.js`, `lib/battery-night-planner.js`, `lib/widget-energy-budget.js`, `lib/ems-engine.js`.

Documentatie/release: `README.md`, `.homeychangelog.json`, dit document en een verwijzing vanuit het historische registratieverslag. Alle versies blijven 1.2.5. `package.json` neemt de nieuwe publicatiesuite op.

Tests: nieuwe `test/ev-house-publication-1.2.5.test.js` en optionele `test/ev-house-log-reconstruction-1.2.5.cjs`. Bestaande fixtures zijn gericht aangepast: de kale app-fixture initialiseert publicatiegegevens; de huisreferentietest verstuurt echte gesimuleerde Mode-triggers; de directe toerekeningsfixture laat geen oude asynchrone tariefcontext haar expliciete toestand overschrijven; de fysieke proef gebruikt de echte referentie-updatefunctie in plaats van het beschermde veld rechtstreeks te muteren. De startup-harness ondersteunt een optionele I/O-hook om herstart vóór een afgeronde STOP te testen. De historische 1.2.4-bronvergelijking vermeldt nu expliciet de toegestane huisreferentiewijzigingen. Er zijn geen veiligheidsdrempels voor tests verlaagd.

## Tests

- **103/103 testbestanden geslaagd**, nul fouten in de volledige eindronde.
- **26 publicatiegroepen geslaagd**, inclusief START vóór laadherkenning; ontbrekende/0 A/afwijkende Mode-feedback; Mode-wissels; publicatiemutex; mislukte STOP; geslaagde STOP en nieuw venster; Waiting/Paused/Ended; disconnect/heraansluiting; meerdere EV’s; gelijktijdige START-publicaties in omgekeerde voltooiingsvolgorde; EV2-fout; fout ná geslaagde STOP; token zonder trigger; P1 tijdens START; failed START; herstart vóór STOP; oud STOP-bewijs na herstart; nul/onbekend; outputtests; geen opslag per P1; Ampère/Hybrid en gemengde vloot.
- **16 Mode-energieregistratiegroepen**, **20 netbudgetgroepen** en **22 fysieke EV-proefgroepen** geslaagd. Daaronder echte P1-overbelasting en dertien minuten gesimuleerd laden zonder onterechte onderbreking bij de bestaande gecontroleerde scenario’s.
- **12 financiële vergelijkingen met de vorige 1.2.5**: alle gecontroleerde financiële dagvelden, EV-energie, batterij-inventaris, Savings-totalen en commando’s zijn identiek bij vaste, TOU- en dynamische kwartiertarieven. Ook de bestaande vergelijking met de oorspronkelijke 1.2.4 slaagt.
- Negen gewijzigde/nieuwe JavaScript-bestanden slagen voor syntaxcontrole. Manifesten en pakketversies zijn consistent 1.2.5.

Alle controles gebruiken echte productiefuncties met gesimuleerde Homey-I/O, klok en fysieke invoer. Er zijn geen fysieke Homey-/laadpaaltests en geen Athom CLI-validatie uitgevoerd.

## Logs van 27 en 28 oktober: resterende STOP

De twee eerder aangeleverde diagnosebestanden zijn opnieuw onderzocht met de gewijzigde code. Ze bevatten geen complete ruwe P1/PV-stroom of volledige 60-secondenhuisbuffer. Dit is daarom een **reconstructie per opgenomen beslismoment**, met de vastgelegde huisreferentie en gepubliceerde Mode-toestand, verse PV als expliciete aanname en geen verzonnen toekomstige batterijopdracht.

- **27 oktober:** 46 Emergency-momenten. Eén opgenomen actieve uitgang geeft nog STOP: **16:03:52 Belgische tijd, evt-79**. Daarnaast worden zeven budgetblokkeringen en achttien bestaande herstartwachttijdmomenten gereproduceerd; dit zijn geen 25 nieuwe fysieke stops of cycli.
- **28 oktober:** 24 Emergency-momenten; geen STOP-uitgang in deze reconstructie.

Het resterende grensgeval houdt de oude referentie van **7.113,40 W** vast. P1 is 8.608 W, PV 763 W en de batterij laadt met 100 W. De gereconstrueerde locatiebelasting is 9.271 W, zodat slechts circa 2.158 W restlast boven de referentie staat. Dat ligt onder de bestaande Mode-herkenningsdrempel van circa 3.326 W. Het mee te tellen EV-vermogen is daarom 0 W. Het budget wordt `19.500 − 10 − 8.608 = 10.882 W`, terwijl Smart én Standard hier 16 A, circa 11.085 W, vereisen. De ongewijzigde uitgangspolitiek kiest nog steeds `insufficient_safe_budget` en de echte publicatiefunctie verstuurt in gesimuleerde I/O STOP.

**Deze wijziging corrigeert geen reeds foutieve of onzekere historische huisreferentie en verandert de stopstrategie niet.** Zonder de ontbrekende prehistorie kan niet bewezen worden welke referentie deze nieuwe versie vanaf het begin van de echte laadsessie zou hebben vastgelegd. Er wordt daarom niet geclaimd dat alle vroegere Start/Stop-problemen opgelost zijn.

Reproductie met de originele uploads buiten de appbron:

```sh
npm test
node test/ev-house-log-reconstruction-1.2.5.cjs /pad/naar/de/twee/originele/logs
```

## Gemeten CPU-/geheugeneffect

Vijf profielen, vijf gepaarde runs, elk 180 seconden gesimuleerde tijd: 50 replays. De uitvoervolgorde wisselt; de medianen hieronder gebruiken de laatste drie paren na twee warm-up-paren. Alle 25 paren hebben identieke controle-uitgangen en diagnostische tellers. Geen nieuwe timer, polling of vermenigvuldiging van centrale berekeningen.

| Profiel | CPU vóór (ms) | CPU na (ms) | Behouden heap vóór (bytes) | Behouden heap na (bytes) |
|---|---:|---:|---:|---:|
| disconnected | 32.833 | 38.090 | 11992 | 19720 |
| disconnected-status | 120.528 | 122.320 | 13096 | 57992 |
| two-current | 274.040 | 209.880 | 40224 | 51872 |
| battery-disabled | 195.171 | 213.136 | 39848 | 4176 |
| pv-only | 311.554 | 361.786 | 63216 | 82168 |

Dit zijn Node-containerprocesmetingen met gesimuleerde I/O, geen Homey CPU-percentages of apparaatgeheugenmetingen. Enkele medianen stijgen, andere dalen; GC/JIT en de testruntime beïnvloeden de uitkomst. Er wordt geen prestatieverbetering of exact ongewijzigd Homey-verbruik geclaimd. De nieuwe gegevens blijven begrensd tot vier publicatiebewijzen, bijbehorende vaste vlaggen en één referentie. Tijdens gelijktijdige START-publicaties bewaart één tijdelijke kandidaat de betrouwbare waarde van vóór het versturen, ook als EV 2 eerder klaar is dan EV 1.

Bewijsbestanden: `validation/release-house-publication-1.2.5.json`, `validation/ev-house-publication-1.2.5.json`, `validation/ev-house-financial-comparison-1.2.5.json`, `validation/ev-house-log-reconstruction-1.2.5.json` en `validation/ev-house-performance-1.2.5.json`.
