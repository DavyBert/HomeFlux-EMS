# HomeFlux EMS 1.2.13 — gerichte CPU-optimalisaties

> Historische meting van de CPU-build vóór de aanvullende EV4-correctie en testopruiming binnen 1.2.13. Zie ../followup-1.2.13/REPORT.md voor de actuele wijzigingen en testuitslag. De gemeten C-bron is reproduceerbaar met A-to-B.patch en B-to-C.patch; de huidige app.js bevat daarnaast EV4-accounting.patch.

Uitgangspunt: de opnieuw aangeleverde volledige 1.2.12-ZIP. Slechts twee productieaanpassingen, beide in app.js. Geen installatie of publicatie op Homey.

## Behouden

- Aanvragen voor een reeds geplande batterijberekening worden tijdens het minimum stuurinterval vóór de preflight samengevoegd. De bestaande timer, geforceerde aanvraag en pauzecontrole blijven actief. Bij timeruitvoering worden interval, werkelijke publicaties en nieuwste invoer opnieuw gecontroleerd.
- De boiler bewaart één klein resultaat van zijn zonnedag-terugvalberekening. Geen lijst met 71 dagen wordt bewaard. Herberekening bij een lokale dagwissel, einde van een relevante zonnedag, klokterugloop, gewijzigde relevante instellingen of een gewijzigde voltooiings-/koudgrens. Koud worden op het ingestelde uur, elke dag op zon proberen, looptijdadministratie en vereiste stopcommando’s blijven actief. Het resultaat kan doorgaans tot de volgende dag/tijdgrens worden gebruikt; bij een wintertijdwissel kan een lokale dag 25 uur duren.

## Niet behouden

- Runtime-instellingen delen: in 180 EV-contexten daalde het aantal opbouwen van 540 naar 360, maar de mediane host-CPU-tijd van 1360,4 naar 1357,6 ms viel binnen de meetruis. De extra code is verwijderd.
- Volledige batterijcontext bij EV-aanvragen hergebruiken: geen voldoende goedkope en volledige invalidatie aangetoond voor alle tijd-, laad-, feedback- en veiligheidsafhankelijkheden.
- Extra prijsvenster-/kostenvergelijkingscache: bestaande prijsbron-, batteryNightCurve- en BatteryNightPlanner-caches blijven in gebruik. Een correcte vergelijking hangt ook van nu, energiebehoefte, beschikbaar vermogen en resterende laadduur af. De gerichte CPU-profilering mat 200 daadwerkelijke kostenvergelijkingen: circa 67 ms voor prepareChargeStrategy in A; daarvoor is geen eenvoudige aanvullende hergebruikregel met bewezen winst behouden.
- Vroege stop voor uitgeschakelde modules: geen statusvelden, voltooiingsadministratie of herstel-/stopcommando’s overgeslagen. De gemeten boilerkost is verholpen met het kleine tijdgebonden resultaat.

## Hostmetingen

A = ongewijzigde aangeleverde 1.2.12. B = alleen timeroptimalisatie. C = B plus boilerresultaat. De engine en planners zijn echte projectfuncties; alleen Homey-I/O en de klok worden gesimuleerd. Zeven meetronden na opwarming per scenario; de timercomponent is aanvullend in drie afwisselende procesvolgordes gemeten (21 ronden per variant). Proces-CPU, geen wachttijd of Homey-percentage.

| Batch | A mediaan ms | B mediaan ms | C mediaan ms |
| --- | ---: | ---: | ---: |
| 1800 P1-updates, wisselende belasting | 459.7 | 437.27 | 353.44 |
| 180 contexten, modules uit | 454.88 | 407.12 | 171.89 |
| 180 contexten, gecentreerd dynamisch laden | 578.73 | 463.6 | 253.62 |
| 180 contexten, dynamische EV-regeling | 1513.07 | 1360.38 | 1109.44 |
| 30000 samengevoegde timeraanvragen, uitsluitend dit onderdeel | 625.5 | 209.94 | 200.43 |

De spreiding staat in measurement-summary.json. Sommige volledige P1-batches en A/B-contextmetingen overlappen in CPU-tijd: daaruit wordt geen algemene timerbesparing afgeleid. De afzonderlijke timercomponent toont wel overtuigende CPU-winst. Die componentbatch simuleert veel herhaalde aanvragen binnen één wachtinterval en is geen gebruikelijke P1-frequentie.

In dezelfde wisselende P1-batch: preflights 1860 → 514 → 514, toestandsopbouwen 555 → 384 → 384, feedbackpreviews 69 → 17 → 17. De 317 engine-evaluaties en 60 contextvoorbereidingen zijn gelijk. Er wordt dus geen context of heartbeat overgeslagen.

In de gerichte CPU-profielrun met 200 werkelijke contexten daalden de boilerkalender-opbouwen van 14200 naar 0 na opwarming. De inclusieve boilerstatus-CPU daalde van circa 275,6 naar 3,1 ms. Het resultaat was in die tijd nog geldig; de grenstests controleren heropbouw bij vervallen geldigheid. Overlappende profielsecties mogen niet worden opgeteld.

Geheugen: in zeven GC-meetronden is geen extra blijvende groei ten opzichte van A/B aangetoond. Er blijft één klein boilerresultaat bewaard; geen groeiende kalendercache. De replayharness wist zijn eigen log-/tracehistorie tijdens geheugenmetingen. Langdurig Homey-geheugengedrag is niet gemeten.

## Functionele vergelijking en tests

Alle commando’s, publicatietijden en bemonsterde regeluitkomsten zijn exact gelijk tussen A, B en C in 11 scenario’s (2640 bemonsterde toestanden per variant): stabiel, nulregeling, batterij sparen, PV-overgangen en curtailment, Peak Guard, EV-start/stop in Current/Mode/Hybrid, meerdaags plannen en wissen, actieve HVAC/COP en boiler, dag-/maandgrens, ontbrekende/verouderde invoer en gewijzigde instellingen. replay-summary.json vermeldt de daadwerkelijk vastgelegde Flow-uitgangen; de volledige gelijke trace zit gecomprimeerd in replay-A-equal-B-equal-C.json.gz.

56 gerichte bestaande/nieuwe testbestanden uitgevoerd: 53 geslaagd, 3 faalden ook op ongewijzigde 1.2.12. Daarnaast syntaxcontroles van de gewijzigde JavaScript-bestanden, JSON-/metadata-controles en echte startupcontrole van logging- en loopdetectieversie 1.2.13. De strikte versieassertie van settings-startup is bijgewerkt naar 1.2.13.

De nieuwe regressie controleert timercoalescing/force/nieuwe input/gewijzigde intervallen/tussentijdse publicatie/pauze en 5790 zonnedag-/wintertijd-/instellingen-/cachevergelijkingen, inclusief het ingestelde dagelijkse koud-uur. Bestaande gerichte suites controleren onder meer herstarts, Split-timers, alle batterijmodi/Peak Guard, laadstrategie, deadlines, EV-energietoewijzing, meerdaagse plannen, HVAC/COP, boilerprioriteit, WAF, waarschuwingen en statuspublicatie.

Bestaande fouten (niet gewijzigd of verborgen):

- soc-completion-1.1.9.test.js: Mode, vier EV’s, preferences/tariff, EV3 krijgt niet de verwachte toestemming.
- ev-battery-protection-1.1.6.test.js: TOU/Hybrid/vier EV’s meldt in de simulatie onverwachte batterijontlading bij 160 s.
- diagnostics-1.1.6.test.js: een verwacht ev_command_published-event ontbreekt.

Dit zijn testbevindingen die nader onderzoek verdienen; ze worden niet als bewust gewijzigde werking geaccepteerd en leveren geen volledig groene regressieset op. Geen afwijking A/B/C waargenomen in de acceptatiereplay. Tests en foutdetails staan in tests.json.

Onafhankelijke UI-, vertaal-, dashboardpresentatie-, catalogus- en exporttests zijn niet herhaald; exacte lijst in skipped-tests.json. Het volledige regressiepakket is niet uitgevoerd. Bijgevolg zijn die onaangeroerde onderdelen en fysieke Homey-/apparaatinteracties niet opnieuw integraal getest.

## Reproduceren

Gebruik de aangeleverde ZIP voor A. Pas A-to-B.patch op app.js toe voor B en daarna B-to-C.patch voor C. De exacte bron- en app-hashes staan in provenance.json. De huidige volledige bron bevat ook de latere aanvulling; de gemeten C-bron is via de patches te reconstrueren.

Vanuit een geschikte Node-omgeving:

```sh
node --expose-gc test/cpu-comparison-1.2.13.cjs /absoluut/pad/naar/variant bench /tmp/meting.json
node --expose-gc test/cpu-comparison-1.2.13.cjs /absoluut/pad/naar/variant replay /tmp/replay.json
node test/cpu-coalescing-1.2.13.test.js
```

De afzonderlijke timer- en contextprofielscripts staan naast dit rapport. bench-C2.json meet dezelfde app.js-bytes als de geaccepteerde C; bench-C1.json en bench-C.json zijn de niet-behouden runtime-experimenten. Er zijn geen nieuwe productieafhankelijkheden, pollinglussen of timers toegevoegd.
