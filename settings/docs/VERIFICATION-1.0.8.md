# Verificatie HomeFlux EMS 1.0.8

Aanvulling op deze oorspronkelijke verificatie: wijzigingen die uitsluitend de net/zon-verdeling betreffen worden nu via de bestaande trage weergavecyclus verwerkt. De eerdere eis dat ook de fysieke bronverdeling exact gelijk moet zijn is daarvoor vervallen; de individuele batterijcommando’s worden nog steeds exact gecontroleerd. Zie `CHARGE-SOURCE-1.0.8.md` voor de nieuwe regressie- en replayresultaten.

Basis: laatst aangeleverde HomeFlux-EMS-v1.0.7.zip, versie 3 van 9 oktober 2026.
Bron-SHA256: `e5a23d8f975450e5fc3b5ea19ae46d4d0b272bf59cefda90ed46c0f626da3a30`.

## Wijziging

De bestaande feedbackmemo ondersteunt nu ook gepland laden (`charge`). De preflight en volledige evaluatie delen de bestaande berekening van gepland laadvermogen, P1-feedback, net/PV-bronverdeling en normalisatie van de engine-invoer. De preflight vergelijkt individuele afgeronde batterijcommando’s én geplande laadhoeveelheid en fysieke net/PV-verdeling. Alleen exact ongewijzigde uitkomsten worden overgeslagen.

De memo vervalt bij een nieuwe minuut, tariefgrens of nieuwe context. Gewijzigde SoC, forecast, planningsfase, vermogensbudget of batterijverdeling maken hem ongeldig. Pending/publicerende commando’s, Split Command-wissels, ontbrekende/verouderde netmeting, Safety SoC-herstel en Hybrid-sturing behouden hun bestaande evaluatiepaden. Handmatig laden gebruikt de bestaande route. Er zijn geen nieuwe timers, wachtrijen of stuurinstellingen toegevoegd.

De bestaande preflight voor zelfconsumptie blijft dezelfde afhankelijkheden en berekening gebruiken. De bestaande SoC-policy blijft waardegebaseerd: een oude, geldige batterij-SoC wordt niet op een nieuwe tijdslimiet afgekeurd. Batterijbeschikbaarheid en nieuwe SoC-waarden worden wel gecontroleerd.

Nieuwe geaggregeerde CPU-diagnosticsteller: `fastChargeUnchangedSkipped`. Deze telt alleen wanneer CPU-diagnostics actief zijn; geen logregel per P1-update.

## Testresultaten

- `npm run check`: geslaagd; syntaxcontroles en alle 46 testsuites, inclusief de nieuwe charge-regressie.
- 5.120 vergelijkingen met originele 1.0.7: alle engine-resultaten volledig identiek, met en zonder voorbereide context; vaste, TOU-, uur- en kwartiercontracten, dag/nacht, efficiency aan/uit, handmatig laden, zelfconsumptie en stand-by.
- Twee replays van elk 1.500 P1-updates (25 virtuele minuten), vier batterijen, 7 seconden commando-interval en contextverversing elke minuut: alle gepubliceerde batterijverdelingen, vermogens, modi, overrides en tijdstippen exact identiek.
- Wisselende replay omvat PV-start/uitval, hogere/lagere huishoudelijke belasting, Peak Guard, individuele SoC-veranderingen, een volle batterij en tijdelijke batterij-onbeschikbaarheid.

| Replay | Snelle evaluaties 1.0.7 | Snelle evaluaties 1.0.8 | Batterijpublicaties beide versies | Proces-CPU 1.0.7 / 1.0.8 |
|---|---:|---:|---:|---:|
| Stabiel gepland laden, ±3 W P1-ruis | 1351 | 51 | 26 | 713.5 / 233.9 ms |
| Wisselende PV en belasting | 322 | 148 | 62 | 227.8 / 193.8 ms |

| Replay / versie | Sectie | Aantal | Totale looptijd | Gemiddeld | Maximum |
|---|---|---:|---:|---:|---:|
| Stabiel 1.0.7 | `fast_evaluation` | 1351 | 511.767 ms | 0.379 ms | 5.694 ms |
| Stabiel 1.0.7 | `fast_feedback_preflight` | 1500 | 0.540 ms | 0.000 ms | 0.059 ms |
| Stabiel 1.0.7 | `battery_command_publish` | 26 | 6.412 ms | 0.247 ms | 1.322 ms |
| Stabiel 1.0.8 | `fast_evaluation` | 51 | 34.443 ms | 0.675 ms | 2.508 ms |
| Stabiel 1.0.8 | `fast_feedback_preflight` | 1500 | 69.564 ms | 0.046 ms | 0.815 ms |
| Stabiel 1.0.8 | `battery_command_publish` | 26 | 5.792 ms | 0.223 ms | 1.120 ms |
| Wisselend 1.0.7 | `fast_evaluation` | 322 | 127.995 ms | 0.397 ms | 1.446 ms |
| Wisselend 1.0.7 | `fast_feedback_preflight` | 205 | 0.120 ms | 0.001 ms | 0.028 ms |
| Wisselend 1.0.7 | `battery_command_publish` | 62 | 5.710 ms | 0.092 ms | 0.303 ms |
| Wisselend 1.0.8 | `fast_evaluation` | 148 | 76.532 ms | 0.517 ms | 3.483 ms |
| Wisselend 1.0.8 | `fast_feedback_preflight` | 205 | 9.026 ms | 0.044 ms | 0.331 ms |
| Wisselend 1.0.8 | `battery_command_publish` | 62 | 6.565 ms | 0.106 ms | 0.671 ms |

CPU is gemeten met `process.cpuUsage()` over de replay; sectietijden zijn wall time met `performance.now()`. Secties kunnen overlappen en mogen niet worden opgeteld als CPU-tijd. Homey tokens/Flow-communicatie zijn gemockt; toestelwachttijd en een fysieke Homey-event-loop zijn hiermee niet gemeten. Testomgeving: Node v24.19.0, geen hardwaretest. Dit bewijst geen vast percentage CPU-winst op Homey en geen oplossing voor iedere mogelijke CPU-oorzaak.

## Dekking van de gevraagde scenario’s

| Scenario’s | Controles |
|---|---|
| 1–7: gepland laden | Nieuwe charge-regressie, context/minuut-expiry, target bereikt, 1.0.7-vergelijking en bestaande fast-control audit. |
| 8–14: PV en curtailment | Replay met PV-start/uitval; bestaande `pv-plan-feedback`, planning-limits en app-control tests voor PV-only, net+PV, planningmaximum en curtailment. |
| 15–20: batterijverdeling en modi | Nieuwe regressie met vier verschillende SoCs, individuele limieten en onbeschikbaarheid; bestaande efficiency/output-handover tests; engine-pariteit voor manual/auto/self-consumption/standby. |
| 21–26: versheid, overlap, wijzigingen en flexibele lasten | Nieuwe memo-invalidatie en async-publicatietest; bestaande startup/fast-control/EV/multi-flexible-load regressies. EV-budget en boiler-Peak Guard-reserve maken de memo ongeldig. HVAC-wijzigingen blijven via de bestaande context/P1-regeling verwerkt. |
| 27–28: langdurig stabiel en wisselend | Beide 1.500-update-replays met dezelfde publicatietijden, inclusief noodzakelijke periodieke herberekeningen. |

## Herhalen

```sh
npm run check
node test/charge-cpu-comparison.js /pad/naar/originele/HomeFlux-EMS-v1.0.7
```

De vergelijkingsrunner controleert eerst alle engine-uitkomsten en daarna alle batterijcommando’s met tijdstippen. Hij schrijft JSON op stdout; de oorspronkelijke 1.0.7 wordt afzonderlijk aangeleverd. De gemeten uitkomsten staan in `docs/CPU-COMPARISON-1.0.8.json`.

Athom-webteksten, Flow-kaarten, instellingen en EV/HVAC/boiler-modules zijn byte-identiek aan de aangeleverde bron. README is beoordeeld: geen nieuwe configuratie of Flow-kaart nodig; alleen de feature-release notes onderaan zijn toegevoegd.
