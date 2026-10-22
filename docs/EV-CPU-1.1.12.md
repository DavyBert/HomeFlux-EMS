# HomeFlux EMS 1.1.12 — EV-invoer, P1 en CPU

## Basis en bewijs

De recentste remote main is gecontroleerd en opgehaald: `66dfb6906425ff4dc6fd6673f44fd864ae6c30ef` (Prepare release v1.1.11). Alle 469 bestanden komen overeen met het geleverde 1.1.11-pakket, afgezien van opmaak van app.json; de JSON-inhoud is gelijk. Er is niet gereset, gepusht of gepubliceerd. De gebruiker heeft expliciet 1.1.12 toegestaan bij een aangetoonde verbetering; dat gaat vóór de oudere versieregel in de bijgevoegde opdracht.

Het crashrapport bevestigt herhaalde beëindiging wegens CPU. De export van de tester bevat één proces-CPU-meetpunt van 25,009% over circa 60 seconden. Sectietijden zijn daar wandkloktijden, deels inclusief asynchroon wachten. Ze mogen niet bij elkaar worden opgeteld of als individuele CPU-kosten worden behandeld. De aangeleverde eigen installatie-export van 11:47:56–11:53:18 toont 1,05–1,62% CPU in de beschikbare meetvensters; de eerste vastgelegde 10 A-feedback ligt na het laatste CPU-meetvenster. De latere 4,81/5,72% en grafiekpiek van circa 20% staan als gerapporteerde observatie in de onderzoeksopdracht; de bijbehorende ruwe exports/grafiek zijn bij deze uitvoering niet aanwezig.

De exacte oorzaak van de externe CPU-crashes is niet gereproduceerd. De onderstaande overbodige aanvragen en publicaties zijn wél afzonderlijk bewezen en gericht hersteld. Dit is geen verklaring achteraf dat de PV-correctie bewezen de crashes veroorzaakte.

## Triggerketens

Onderstaande locaties verwijzen naar de definitieve app.js in 1.1.12. Functienamen zijn de werkelijke namen; er is geen requestFastEvaluate() of evaluateContext() in deze app.

| Aanleiding | Codepad en verwerking |
| --- | --- |
| P1 Flow, app.js:5664 | set_grid_power → administratie/P1-historie → recordEvBatteryHouseReference/updateEvPortfolioLoadDetection → checkFlexibleSafetyFromGrid → requestEvaluate (12837). Meterveranderingen/actieve flexibele lasten vragen daarnaast de bestaande gebundelde context aan. |
| PV Flow, app.js:5732 | set_pv_power → PV-/planningsadministratie → requestEvaluate; relevante PV-contextwijziging vraagt requestContextEvaluate aan. Geen nieuw regelinterval. |
| EV Flow, app.js:5797 en genummerde EV2–4 | updateEvStatusInput (10125) vernieuwt tijdstempels, telt energie vóór vervanging van de oude meting, verwerkt AutoTune en sessiestatus. Alleen relevante verandering vraagt context aan. |
| Generieke/configureerbare Flow-kaarten | lib/flow-slot-cards.js en lib/configured-flow-cards.js routeren naar dezelfde genummerde handler, zonder tweede beslisroute. |
| API, app.js:14786 | setInput gebruikt nu dezelfde updateEvStatusInput. Gelijkblijvende EV-status maakt de context niet opnieuw ongeldig; gelijkblijvende SoC wordt eveneens op waarde/freshness gecontroleerd. Force, andere invoervelden en grid-recovery behouden hun eigen werking. |
| Context, app.js:3038/3077/13280 | requestContextEvaluate bundelt op de bestaande slow deadline; runContextEvaluation → evaluateContextNow → batterijcontext/planning, EV-portfolio en flexibele uitvoer. Relevante settings kunnen de normale cadans doorbreken. |
| EV-heartbeat, app.js:12050 | Bestaande minuutheartbeat → runEvHeartbeat → geserialiseerde publishEvPortfolio (12035), zonder batterijplanning/HVAC/boiler-pass. |
| Batterijpublicatie | emitPending publiceert via bestaande interval/mutex. De gemarkeerde flexibele pass kan EV's evalueren; battery_output_changed vraagt een gebundelde context, geen nieuwe timer per ontvangen P1. |
| Batterij-SoC / EV-instelling | Waardewijziging maakt relevante context/planning ongeldig; EV-instellingen lopen via de bestaande settings-listener rond app.js:474–605. |
| Veiligheid, app.js:3173 | checkFlexibleSafetyFromGrid reageert direct op overgang naar piekdruk, PV-importstop en toepasselijke andere veiligheidsvoorwaarden. Een onveranderde piekstatus vraagt niet iedere P1 opnieuw een volledige context. |

### Antwoord op de hoofdvraag

Een gewone P1-update voert niet standaard de volledige EV-planning/portfolioverdeling uit. De snelle lus gebruikt getEvGridImportControlStatus (10316), getPlannedBatteryGridLimitW (10203) en de nieuwste metingen voor fysieke vermogensboekhouding, netruimte en batterijbescherming. applyCachedEvBatteryCoordination gebruikt bestaande EV-beslissingen. calculateEvPortfolioDecisions (9310) hoort bij de context/portfolio-/publicatieroute. In de productiepadtest met 120 P1-updates en vaste EV-feedback iedere 10 seconden wordt het volledige EV-portfolio 6 keer berekend, inclusief bestaande context-/heartbeatmomenten.

P1 kan terecht een directe volledige pass veroorzaken bij een veiligheids-, aansluitings-/detectieovergang of ontbrekende context. De normale context bundelt meterverzoeken op de bestaande trage cadans. De EV-portfolio heeft een publicatiemutex; contextverzoeken worden gebundeld. Meerdere voorbereidings-/publicatieberekeningen rond één echte wijziging zijn niet automatisch een lus of fout. De CPU-vergelijking toont geen volledige EV-berekening per P1.

## Gerichte correcties

### Gelijke EV-feedback

Voorheen zette de API ieder geldig connected/current-veld op contextInputChanged, ook bij dezelfde waarde. De Flow-route controleerde het waardeverschil, maar zag een ontkoppelde current/hybrid-EV telkens als fysiek niet-verse meting: herhaald disconnected/0 A vroeg dus opnieuw context aan.

updateEvStatusInput maakt de waarde-/aansluitingsdetectie gelijk voor Flow/API en alle vier EV's. De bestaande tolerantie van 0,05 A blijft. Een identieke ontvangst vernieuwt de tijdstempels en bewaart noodzakelijke energie-integratie, AutoTune-feedback en sessiestatus. Alleen een aangesloten EV kan een relevante stale-to-fresh overgang maken; herhaald ontkoppeld 0 A doet dat niet. Betekenisvolle wijzigingen, eerste ontvangst en toepasselijke freshnessherstel blijven evalueren. Een kWh-doel kan bij constante stroom terecht een nieuwe STOP veroorzaken: in de test publiceert dat correct Stop/allowed=false.

Gewenst gedrag is dus niet bereikt door dezelfde waarde vroeg weg te gooien of de huidige stroom gelijk te stellen aan het gevraagde setpoint.

### Split-minimum en publicatie

De eigen diagnose bevat 19 maal candidate 0 W → effectieve split-opdracht −100 W, circa iedere 17 seconden. Split heeft minimum 100 W, nulmodus charge; de veiligheidsherhaling staat op 600 seconden en verklaart dit patroon niet. Het ruwe kandidaatvermogen werd met het al omgezette fysieke commando vergeleken en bleef daardoor verschillen.

getEffectiveSplitCommands (4790) projecteert de reeds bestaande uitvoeromzetting voor de vergelijking. commandChangedEnough (13568) onderdrukt een herhaling als alle effectieve individuele opdrachten identiek blijven. canSkipBatteryFeedback (12666) kan daarnaast een onveranderde preview bewijzen tegen dezelfde fysieke omzetting. Echte modus-/strategie-/overridewijzigingen en split-richtingstimers blijven vóór deze skip behandeld. Het minimumvermogen, anti-wisseltijden, vaste mode/power-overgang, publieke tekens en publicatie-implementatie zijn niet gewijzigd.

De zelfstandige periodieke modeherhaling blijft lopen. In de test: één gewone vermogenpublicatie en 26 modepublicaties over 180 seconden bij een safety-interval van 7 seconden. In de tienminutenproef van het diagnosepatroon vervallen 35 gewone herpublicaties; dezelfde effectieve −100 W blijft actief. Het onderdrukken van een herpublicatie is geen bevestiging dat hardware een vorige opdracht werkelijk heeft uitgevoerd; de expliciete veiligheidsherhaling blijft daarvoor beschikbaar.

## Gekozen architectuur

Behoud de bestaande eventgestuurde invoer, gebundelde context en EV-heartbeat. Meterinvoer, timestamps en fysieke veiligheid blijven direct. Tarief-/deadline-/portfolioverdeling blijft in de bestaande context en heartbeat, met directe veiligheids- en operatorovergangen. Alles naar een vaste 60 seconden schuiven zou onder meer Peak Guard, STOP-restbelasting en respons op PV-/aansluitingswijzigingen verslechteren. Een nieuwe zelfstandige EV-regelkring zou extra coördinatie en timers toevoegen zonder aangetoonde noodzaak. Een grote herwerking is daarom niet uitgevoerd.

P1-cadans, AutoTune, batterij-/EV-intervallen, instellingen en Flow-schema's zijn gelijk gebleven. Het settingsschema blijft 71. De 1.1.11 PV-eerst-voor-het-huisboekhouding en alle 1.1.9 STOP/SoC-correcties zijn behouden.

## CPU en diagnostiek

Bestaande minuutmetingen van process.cpuUsage blijven bestaan. Met CPU-diagnostiek aan meten uitsluitend de synchrone context-, snelle evaluatie-, feedbackpreflight-, planning- en heartbeatsecties nu ook proces-CPU-delta's. Async publicatie-/Flow-secties blijven alleen wall time rapporteren. Nested/inclusieve CPU-secties zijn niet optelbaar; proces-CPU kan ook garbage collection omvatten. Buiten ingeschakelde CPU-diagnostiek worden deze extra CPU-reads niet uitgevoerd.

Nieuwe tellers: evFeedbackInputs, evFeedbackUnchanged, evInputEvaluationRequests, evPortfolioCalculations, evPhysicalAccountingChecks, contextRequestsCoalesced, evContextFromMeter/evContextFromInput/evContextFromBattery en batterySplitIdenticalOutputSkipped. De evContextFrom-tellers tellen contextpasses met die redenen; zij zijn geen aantallen directe P1- of portfolio-evaluaties. Werkelijke portfolio- en fysieke controles hebben afzonderlijke tellers en breken zonder geconfigureerde EV vroeg af.

De bestaande Homey cpuwarn-gebeurtenis schrijft een kleine momentopname van beschikbare tellers, laatste CPU-meetpunt en publicatie/contextstatus naar het crashlog. Geen volledige settingsdump, extra polling, opslaglus of timer. Hiermee kan een volgend fysiek CPU-incident gerichter worden beoordeeld.

### Gemeten proces-CPU in de lokale replay

Node v24.19.0 in deze container; geen Homey-hardwarebenchmark. Productiestartup, scheduler en beslis-/publicatieroutes zijn echt, Homey-I/O en tijd zijn gesimuleerd. Per scenario 600 virtuele seconden met P1 iedere seconde, zeven afzonderlijke processen per versie, afwisselende versievolgorde. De mediaan van echte user+system CPU-tijd staat hieronder. CPU-diagnostiek is in beide versies actief; de nieuwe synchrone detailmeting is dus ook in de nameting inbegrepen. API/Flow-proeven hebben identieke individuele batterijcommando's op identieke tijdstippen. Bij split is juist de dubbele publicatie verwijderd; de effectieve eindopdracht blijft gelijk.

| Scenario | CPU ms 1.1.11 | CPU ms 1.1.12 | Verschil |
| --- | --- | --- | --- |
| api | 434.145 | 443.899 | +2.2% |
| flow | 425.834 | 447.114 | +5.0% |
| split | 181.539 | 144.7 | -20.3% |

Bij gewone stabiele feedback is geen CPU-winst bewezen: de mediaan stijgt circa 2,2% voor API en 5,0% voor Flow in deze meting, inclusief uitgebreidere ingeschakelde diagnostiek en meetvariatie. Bij API dalen onnodige structurele contextinvalidaties wel van 60 naar 1 (de eerste echte stroomwijziging); het aantal uiteindelijke portfolio-/batterijevaluaties blijft hier gelijk door bestaande bundeling. De duidelijke winst zit in het split-patroon: ongeveer 20,3% lagere proces-CPU in deze replay, met 35 → 0 herpublicaties na de initiële opdracht. Deze percentages zijn geen voorspelling van het totale CPU-percentage of de crashkans op Homey.

Ruwe herhalingen en tellers staan in validation/cpu-comparison.json. Reproducer: node test/ev-input-cpu-1.1.12.cjs /pad/naar/bron api (of flow/split).

## Regressie 1.1.10 → 1.1.11

De exacte geleverde bronversies zijn beschikbaar en vergeleken. Functionele appwijzigingen zijn beperkt tot calculateEvPortfolioDecisions, recordEvBatteryHouseReference en getEvGridImportControlStatus, plus actieve versievermeldingen. Die wijziging introduceerde geen nieuwe timer, listener, inputhandler of scheduler. De hierboven gerepareerde dubbele invoeraanvragen en split-vergelijking bestonden al in 1.1.10. Zij kunnen overbodig werk veroorzaken, maar verklaren op zichzelf niet waarom de tester pas sinds 1.1.11 CPU-crashes meldt. De PV-first-regels worden niet teruggedraaid.

## Tests en oplevering

- De nieuwe gewenste-gedragtests falen op de ongewijzigde 1.1.11: 40 herhaalde ontkoppelde Flow-statussen geven 40 onnodige aanvragen; de split-test publiceert dezelfde effectieve opdracht opnieuw.
- Na correctie slagen 29 nieuwe scenario's: vier EV's, current/mode/hybrid, genummerde/generieke/configureerbare Flow en API, aangesloten/ontkoppeld, veranderde stroom, freshnessherstel, kWh-voltooiing, P1/10s-feedback en onafhankelijke split-modeherhaling.
- De volledige npm run check slaagt: syntaxcontrole en 62 suites. Bevat 72 PV-first-overgangen, 55 SoC-scenario's, 33 EV/batterijovergangen, 14 EV-batterijbeschermingsscenario's, EV zonder batterij/EMS, PV-prioriteiten, Peak Guard, tarief-/deadlinewisselingen en split-migratie vanaf minuten.
- De batterij-engine, lib/flexible-loads.js, EV-sessielibrary, instellingen, vertalingen en de eerdere veiligheids-/PV-tests zijn bytegelijk aan 1.1.11. De bestaande CPU-diagnostiektest is bewust bijgewerkt voor synchrone CPU-delta's, met expliciete controles dat async secties geen CPU-toerekening krijgen en uitgeschakelde diagnostiek geen CPU-reads doet.
- Het bronpakket bevat een toepasbare patch, ruwe voor/na-logs, proces-CPU-metingen, bronhashes en een behoudsrapport. Eerdere changelogvermeldingen zijn behouden.

## Nog fysiek te bevestigen

Test 1.1.12 op de betreffende Homey met bestaande Flows, zonder de ingestelde intervallen te veranderen. Vergelijk CPU-minuutmetingen én grafiekpieken bij dezelfde vaste terugkoppeling en bij echte laadstroom. Een synthetische 10 A is voor EMS fysieke verbruiksinformatie en mag niet als onafhankelijke bewijsmeting van de laadpaal worden gepresenteerd. Controleer mode/current/hybrid, echte EV-STOP, PV-wisselingen en split-minimum/safety-herhaling. Gepubliceerde Flow-opdrachten zijn geen bewijs van uitgevoerd laad-/batterijvermogen. Bevestig met de nieuwe CPU-velden en eventuele cpuwarn-momentopname of de externe CPU-crashes uitblijven en waar resterende kosten liggen.

## English release note

Repeated EV telemetry now shares change detection across Flow and API inputs while retaining freshness, delivered-energy accounting and session/AutoTune feedback. Disconnected zero-current updates no longer repeatedly invalidate the controller. Split control compares effective hardware commands, avoiding repeated publication of an unchanged minimum-power output while retaining mode locks and the independent safety resend. Synchronous diagnostic scopes now include process CPU deltas; asynchronous Flow scopes remain wall-time-only. The existing fast safety/accounting path and slow EV planning architecture are preserved. The reported external CPU crash has not been reproduced or proven resolved on hardware.
