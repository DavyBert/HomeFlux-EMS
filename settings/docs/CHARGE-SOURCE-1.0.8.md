# Net/zon-bronweergave — HomeFlux EMS 1.0.8

Basis: de laatst aangepaste 1.0.8 uit deze sessie, met Idle Guard en de verwijderde UI-versienummers. De appversie blijft 1.0.8.

## Oorzaak en wijziging

`canSkipBatteryFeedback` vereiste eerder dat ook `gridChargeAssistW` en `pvChargeW` exact overeenkwamen. Bij gecombineerd laden leidde 3 W P1-variatie daardoor tot een nieuwe volledige snelle evaluatie en gewijzigde statustekst, terwijl alle afzonderlijke batterijcommando’s gelijk bleven.

De preflight controleert nog steeds het geplande laadvermogen, alle individuele afgeronde commando’s, Peak Guard, context/minuutgrenzen, SoC-/forecast-/budgetafhankelijkheden, uitvoervergrendelingen en Split Command-timers. Alleen een verschil in de net/zon-bronverdeling is geen reden meer voor de volledige snelle evaluator.

`refreshBatteryChargeSourcePresentation` draait vanuit de bestaande `runSlowHeartbeatHousekeeping`-cadans. De methode hergebruikt `refreshBatteryPresentationAfterCoordination` voor bronwaarden, actielabel en statustekst. De minimale actiedrempel sluit aan op die van de engine, ook bij een command-deadband onder 25 W. Zonder noodzakelijke herberekening kunnen deze weergavewaarden dus tot de volgende trage update achterlopen. Een noodzakelijke snelle of context-evaluatie blijft de broninformatie eveneens vernieuwen.

De weergave-update gebruikt uitsluitend succesvol gepubliceerde individuele commando’s die exact overeenkomen met het actuele resultaat en het interne totaal. Pending/publicerende opdrachten, onbevestigde uitvoer, stale P1, uitgeschakelde sturing, Hybrid en Peak Guard worden geweigerd. De update verandert geen batterijcommando’s, rekent geen planning of allocator opnieuw uit, vraagt geen context-evaluatie aan en introduceert geen eigen timer.

Nieuwe CPU-diagnosticstellers: `fastChargeSourceOnlySkipped` en `chargeSourcePresentationUpdates`. De bestaande charge-skipcounter blijft alle succesvolle charge-preflights tellen. Counters veroorzaken geen logregels per P1-update.

## Verificatie

- `npm run check`: syntaxcontroles en alle 47 bestaande testsuites geslaagd. De charge-regressie is uitgebreid met bron-only skips, trage weergave-updates, dubbele-updatefiltering, ontbrekende uitvoerbevestiging, stale/pending/Hybrid-uitsluitingen en actiedrempels bij kleine deadbands.
- De bestaande enginevergelijker bevestigt 5.120 identieke volledige engine-uitkomsten met/zonder voorbereide context, voor vaste, TOU-, uur- en kwartiercontracten, dag/nacht en meerdere modi. De engine is niet aangepast.
- De nieuwe bron-replay vergelijkt zes scenario’s met ieder 600 echte Flow-P1-inputaanroepen, vier batterijen, 7 s commando-interval, periodieke contextverversing en de bestaande slow housekeeping. Ieder gepubliceerd individueel commando, totaal, baseMode, override en tijdstip is exact identiek aan de voorafgaande 1.0.8.
- Fixture: 13 oktober 2026, 12:46 lokale tijd, vier gelijke SoCs van 57,8%, doel 80%, 21,6 kWh, 623 W huisverbruik, 1495 W PV bij gemengd laden en 2650 W Peak Guard. De eerste laadopdracht is 1133 W. Statische scenario’s houden SoC constant om bronwijzigingen te isoleren; de aparte SoC/modusreplay wijzigt batterijwaarden, beschikbaarheid en modus.

| Scenario | Snelle evaluaties vóór / na | Statuspublicaties vóór / na | Batterijpublicaties vóór / na |
|---|---:|---:|---:|
| Netladen, ±3 W P1-ruis | 21 / 21 | 21 / 21 | 11 / 11 |
| Net + zon, ±3 W P1-ruis | 541 / 21 | 550 / 29 | 11 / 11 |
| Net + zon met TOU-contract | 541 / 21 | 550 / 29 | 11 / 11 |
| PV wisselt iedere 10 s met ±50 W | 591 / 71 | 551 / 90 | 11 / 11 |
| Wolken, huishoudelijke belasting en Peak Guard | 185 / 63 | 208 / 87 | 42 / 42 |
| SoC, batterijbeschikbaarheid en moduswissels | 113 / 9 | 116 / 15 | 5 / 5 |

De volledige counters, sectietijden en getimede batterijtraces staan in `CHARGE-SOURCE-CPU-COMPARISON-1.0.8.json`. Proces-CPU is gemeten met `process.cpuUsage`; secties zijn overlappende wall-time-metingen. Homey Flow/token-I/O is gemockt. Dit is geen fysieke Homey-test en voorspelt geen vast CPU-percentage op het toestel.

## Herhalen

```sh
npm run check
node test/charge-source-cpu-comparison.js /pad/naar/vorige/HomeFlux-EMS-v1.0.8
node test/charge-cpu-comparison.js /pad/naar/vorige/HomeFlux-EMS-v1.0.8
```

README is beoordeeld: voor deze optimalisatie zijn geen nieuwe instellingen of Flow-kaarten nodig. De korte basisinstructies blijven intact; de bestaande 1.0.8-release notes onderaan zijn aangevuld, evenals de Nederlandse/Engelse Homey-changelog. Athom-webteksten en alle Flow-kaarten zijn byte-identiek aan de laatst aangepaste bron.
