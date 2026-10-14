# Wachtende contextverversing — HomeFlux EMS 1.0.10

Basis: de laatst opgeleverde `HomeFlux-EMS-v1.0.9.zip` uit deze sessie, inclusief Idle Guard, bronweergave op de trage cyclus en de verwijderde UI-versienummers.
Bron-SHA256: `808155a7bb814072b78cab29d6a1dfa7c17e195b012c66cdf254ac3f424bdb88`.

## Gerichte wijziging

`markContextDirty` en `requestContextEvaluate` hebben een interne optie `invalidatesBatteryContext`, standaard `true`. Alleen expliciete meetverversingen, periodieke moduleverversingen en de moduleverversing na een batterijpublicatie gebruiken `false`. De aanvraag blijft de context en flexibele lasten als te verversen markeren en gebruikt dezelfde bestaande timer en deadline. Een eerdere echte batterij-invalidatie wordt nooit gewist.

Flow-P1/PV-meetverversingen gebruiken de lichte aanvraag. De API maakt onderscheid tussen meterinputs en overige contextinputs; gecombineerde payloads met SoC/forecast/EV/HVAC blijven conservatief structureel. In de heartbeat en bij het opnieuw inplannen van reentrante aanvragen wordt de bestaande invalidatiestatus meegenomen zonder een uitsluitend meterafhankelijke aanvraag alsnog te promoveren.

Na een batterijpublicatie maken de gewijzigde live commando-afhankelijkheden de oude memo ongeldig. Een daarna gevestigde nieuwe memo hoeft niet ongeldig te blijven tot de moduleverversing uitgevoerd is. De controles in `canSkipBatteryFeedback` en `canSkipBatteryIdle` zijn zelf niet versoepeld.

Instellingen, planning, operatoracties, boiler-resetgrenzen, urgente moduleveiligheid en onbekende contextaanvragen houden de standaard structurele invalidatie. Live SoC, beschikbaarheid, batterijverdeling, forecast, EV-netbudget, gepland batterijbudget, boilerreservering, contextreferentie, minuut/tariefgrenzen, output locks, Split Command en Peak Guard behouden hun bestaande controles. Er is geen moduleberekening naar de snelle route verplaatst en geen extra timer, polling, deadband of stuurvertraging toegevoegd.

## Verificatie

- `npm run check`: syntaxchecks en alle **48 testsuites geslaagd**. De nieuwe suite test echte Flow/API-aanvragen, één originele contextdeadline, structurele invalidatie na een lichte aanvraag, actuele vermogensbudgetten, SoC/forecast/beschikbaarheid, minuut-expiry, export/Peak Guard, pending/Split/Hybrid/stale input en reentrante aanvraagafhandeling.
- De bestaande enginevergelijker bevestigt **5.120 identieke engine-uitkomsten** voor vaste, TOU-, uur- en kwartiercontracten, dag/nacht, verschillende modi en berekeningen met/zonder voorbereide context.
- De nieuwe replay gebruikt de werkelijke `requestContextEvaluate`, pending timer, `runContextEvaluation`, heartbeat, snelle evaluator en output gates. Die zijn niet vervangen door tellende stubs. Alleen Homey I/O en de klok zijn gemockt.
- In **17 scenario’s**, ieder 600 virtuele seconden, zijn alle gepubliceerde individuele batterijcommando’s, totalen, modi, overrides en tijdstippen exact identiek aan 1.0.9. Ook contextuitvoertijden/force flags, geregistreerde pending contextdeadlines en de gevolgde EV/HVAC/boiler/PV-outputtraces zijn identiek.
- De actieve HVAC-fixture blijft actief bij alle 600 P1-inputs. De pending-outputfixture houdt daadwerkelijk een publicatie 20 seconden vast; de foutfixture weigert daadwerkelijk één publicatie en controleert herstel. De curtailment-fixture beperkt PV daadwerkelijk bij volle batterijen. De planningmaximum-fixture blijft PV laden boven het maximum voor geplande netlading.

| Replay | Snelle evaluaties 1.0.9 / 1.0.10 | Statuspublicaties 1.0.9 / 1.0.10 | Batterijpublicaties beide |
|---|---:|---:|---:|
| Netladen met kleine P1-variatie | 75 / 12 | 13 / 12 | 2 |
| Net + zon met kleine P1-variatie | 75 / 12 | 73 / 21 | 2 |
| Wisselende PV, PV-beperking aan | 640 / 120 | 560 / 140 | 11 |
| Actieve HVAC met wisselende PV | 640 / 120 | 560 / 140 | 11 |
| Wolken, huisverbruik en Peak Guard | 266 / 64 | 205 / 83 | 42 |
| SoC, batterijbeschikbaarheid en laadlimiet | 75 / 12 | 70 / 18 | 4 |
| Planning-, doel- en moduswijzigingen | 434 / 371 | 374 / 322 | 8 |
| Gewijzigde batterij-, boiler- en EV-budgetten | 114 / 51 | 142 / 90 | 42 |
| TOU-tariefgrens om 17:00 | 20 / 20 | 33 / 33 | 18 |
| Wachtende async batterijpublicatie | 278 / 75 | 213 / 91 | 40 |
| Mislukte batterijpublicatie en herstel | 266 / 64 | 204 / 82 | 42 |
| Stale P1 en herstel | 138 / 13 | 126 / 22 | 5 |
| Split Command | 85 / 85 | 171 / 171 | 82 |
| Geleidelijke efficiency-handover | 83 / 20 | 84 / 32 | 7 |
| Idle Guard met PV uit | 68 / 10 | 14 / 14 | 2 |
| PV-curtailment bij volle batterijen | 713 / 120 | 19 / 19 | 1 |
| PV-laden boven gepland maximum-SoC | 68 / 5 | 59 / 7 | 3 |

Echte structurele invalidaties blijven ook tijdens hun wachtperiode volledige controles afdwingen. Scenario’s zoals planningwijzigingen en Split Command hoeven daarom niet dezelfde daling te tonen als uitsluitend wachtende meetverversingen.

De volledige counters, sectietijden, contextaanvragen en outputtraces staan in `CONTEXT-CPU-COMPARISON-1.0.10.json`. Proces-CPU is gemeten met `process.cpuUsage`; sectietijden zijn overlappende wall-time-metingen. De budgetreplay injecteert gewijzigde control-inputbudgetten; de actieve HVAC-replay gebruikt de echte moduleberekening. Statische replays houden SoC constant om regelwerk te isoleren; afzonderlijke replays wijzigen batterijwaarden en planning. Deze tests draaien op Node v24.19.0 met gemockte Homey-I/O. Zij bewijzen geen CPU-percentage op een fysieke Homey.

## Herhalen

```sh
npm run check
node test/context-refresh-cpu-comparison.js /pad/naar/originele/HomeFlux-EMS-v1.0.9
node test/charge-cpu-comparison.js /pad/naar/originele/HomeFlux-EMS-v1.0.9
```

Versie 1.0.10 staat consequent in de manifests, eigen package-lockmetadata, opstartlog, diagnostiek en status/planningsmetadata. Dependencyversies zijn behouden. De README-basisinstructies blijven kort; alleen de nieuwe 1.0.10-feature-release notes zijn toegevoegd. Athom-webteksten, alle Flow-kaarten, slogan en verborgen UI-versieweergave zijn identiek aan de bron.
