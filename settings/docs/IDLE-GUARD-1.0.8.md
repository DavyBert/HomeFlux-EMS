# Idle Guard-verificatie — HomeFlux EMS 1.0.8

Basis: de laatst beschikbare 1.0.8, inclusief de eerder aangebrachte charge/PV-optimalisatie. Appversie blijft 1.0.8.
Bron-ZIP SHA256: `3629ab22e7c74ceb04716ce24dc96113cede325f7fb3f692b9baf8d3ba166ea8`.

## Gerichte wijzigingen

- `rememberBatteryFeedbackMemo`: het volledige resultaat kan een beperkt idle-bewijs bevatten als alle batterijen door de bestaande ontlaadgrens geblokkeerd zijn, de volledige engine nulcommando’s geeft en geen laadactie of gereserveerde Peak Guard-belasting nodig is.
- `canSkipBatteryIdle`: vóór snapshot-opbouw en feedback-preflight; leest individuele interne setpoints, openstaande verwerking, rauwe P1, SoC/PV-versheid en een compacte afhankelijkheidssignatuur. Geen verdelingsberekening, kalender-/tariefscan of tweede regelengine.
- Succesvolle uitvoer: een referentie naar de bestaande `lastEmittedCommands` wordt pas na voltooide Flow/token-publicatie bevestigd. De referentie wordt vóór een nieuwe poging gewist. Een app-herstart, een mislukte publicatie en een onbekende uitvoer leveren geen idle-bewijs op. Er wordt geen tweede setpointkopie bijgehouden.
- Interne persistence zoals `_autoTuneLearning` wist geen feedbackmemo meer; daadwerkelijke publieke stuurinstellingen doen dat wel. Gewijzigde engine-/moduledata worden daarnaast door afhankelijkheden/context gecontroleerd.
- De opstartlog vermeldt nu de aanwezige appversie 1.0.8; hij vermeldde nog 1.0.7. Dit wijzigt geen sturing.

## Veiligheidsvoorwaarden en grenzen

- Alle afzonderlijke setpoints én het interne totaal moeten exact nul zijn. Een niet-nulbatterij of een mix van laden/ontladen met totaal nul passeert de guard.
- Het bewijs geldt maximaal 60 seconden, met dezelfde periodieke controlecadans. Een eerdere tarief-/laadvenstergrens, lokale middernacht, nieuwe context of relevante toestand beëindigt het bewijs. Geforceerde aanvragen blijven volledig uitgevoerd. De extra snelle berekening op de UTC-minuut naast de contextcadans wordt in deze beperkte rusttoestand vermeden.
- Raw P1 blijft tegen de bestaande Peak Guard-softgrens gecontroleerd. Raw/averaged export en nieuw PV-vermogen verlaten de guard. Oude exportsamples in het gemiddelde worden niet verborgen door nieuwe netimport.
- Alleen ontvangen, geldige SoC-waarden kwalificeren. Voor deze optimalisatie moeten SoC-updates maximaal 10 minuten oud en de 0 W-PV-meting maximaal 5 minuten oud zijn. Anders volgt de oorspronkelijke verwerking: er is geen nieuwe fysieke SoC-stopregel ingevoerd.
- Geconfigureerde EV’s, Hybrid EMS, Split Command, actieve/pending batterijpublicaties, handover-/controltimers en flexibele publicaties nemen conservatief het bestaande pad. Boiler-/HVAC-toestanden zitten in de afhankelijkheden. Hun onafhankelijke timers en slow control blijven draaien.
- Normale batterijintegratie heeft geen afzonderlijke fysieke vermogensbevestiging. De guard gebruikt daarom de bestaande succesvol gepubliceerde commando’s en geldige SoC-invoer. Externe vermogensfeedback bestaat voor Hybrid EMS, dat van de guard is uitgesloten.
- Peak Guard behoudt de technische minimum-SoC: als de batterij daar geen vermogen mag leveren, wordt dat niet door de guard vrijgegeven. Actieve setpoints behouden ook de al bestaande feedback-/charge-preflightoptimalisatie; alleen de nieuwe Idle Guard weigert ze categorisch.

## Diagnostiek

`fastIdleGuardSkipped`, `fastIdleGuardBypassPeakGuard`, `fastIdleGuardBypassActiveSetpoint`, `fastIdleGuardBypassPendingCommand`, `fastIdleGuardBypassStateChange` en de wall-time-sectie `fast_idle_guard`.

`StateChange` omvat een gewijzigd, verlopen, ontbrekend of niet aantoonbaar veilig idle-bewijs. Bestaande counters blijven dezelfde gebeurtenissen betekenen. Er zijn geen afzonderlijke P1-logregels of nieuwe polling-/wachttimers.

## Tests en vergelijking

- `npm run check`: syntaxchecks en alle **47 testsuites geslaagd**, inclusief de eerdere charge/PV-regressies en de nieuwe Idle Guard-suite.
- De nieuwe suite controleert stabiele/sterk wisselende P1, Peak Guard, harde versus strategische SoC-grenzen, actieve/mengsetpoints, PV, oud gemiddelde, ontbrekende/verouderde data, mislukte uitvoer, pending opdrachten, planningstart/-stop, tariefgrenzen, lokale middernacht, interne boekhouding en module-/moduswijzigingen.
- Drie replays van elk 1.500 P1-updates (25 virtuele minuten), vier batterijen, 7 seconden commando-interval en contextverversing elke minuut. Alle batterijcommando’s, per-batterijverdelingen, modi, overrides en verzendtijdstippen zijn exact identiek aan de oorspronkelijke 1.0.8.

| Replay | Fast evaluations vóór / na | Idle Guard-skips | Publicaties vóór / na | Proces-CPU vóór / na |
|---|---:|---:|---:|---:|
| 1.200 W met ±20 W ruis | 52 / 27 | 1475 | 1 / 1 | 212.5 / 122.5 ms |
| Idem, interne boekhouding elke 15 s | 102 / 27 | 1475 | 1 / 1 | 187.4 / 96.1 ms |
| Gaming-belasting, PV, SoC en Peak Guard | 176 / 162 | 457 | 46 / 46 | 275.6 / 242.0 ms |

| Replay / versie | Sectie | Calls | Totale wall time | Gemiddeld | Maximaal |
|---|---|---:|---:|---:|---:|
| Stabiel Vóór | `fast_evaluation` | 52 | 29.441 ms | 0.566 ms | 3.627 ms |
| Stabiel Vóór | `fast_feedback_preflight` | 1500 | 66.734 ms | 0.044 ms | 1.220 ms |
| Stabiel Na | `fast_evaluation` | 27 | 21.068 ms | 0.780 ms | 3.803 ms |
| Stabiel Na | `fast_feedback_preflight` | 25 | 0.143 ms | 0.006 ms | 0.112 ms |
| Stabiel Na | `fast_idle_guard` | 1500 | 17.006 ms | 0.011 ms | 0.261 ms |
| Boekhouding Vóór | `fast_evaluation` | 102 | 42.764 ms | 0.419 ms | 1.577 ms |
| Boekhouding Vóór | `fast_feedback_preflight` | 1500 | 53.075 ms | 0.035 ms | 0.847 ms |
| Boekhouding Na | `fast_evaluation` | 27 | 13.022 ms | 0.482 ms | 0.863 ms |
| Boekhouding Na | `fast_feedback_preflight` | 25 | 0.040 ms | 0.002 ms | 0.020 ms |
| Boekhouding Na | `fast_idle_guard` | 1500 | 15.369 ms | 0.010 ms | 0.222 ms |
| Wisselend Vóór | `fast_evaluation` | 176 | 102.523 ms | 0.583 ms | 1.721 ms |
| Wisselend Vóór | `fast_feedback_preflight` | 578 | 30.973 ms | 0.054 ms | 0.190 ms |
| Wisselend Na | `fast_evaluation` | 162 | 96.356 ms | 0.595 ms | 3.891 ms |
| Wisselend Na | `fast_feedback_preflight` | 139 | 9.636 ms | 0.069 ms | 0.365 ms |
| Wisselend Na | `fast_idle_guard` | 1517 | 8.525 ms | 0.006 ms | 0.055 ms |

CPU is gemeten met `process.cpuUsage()` over de complete replay; sectietijden zijn wall time en kunnen overlappen. Tokens/Flow-communicatie zijn gemockt. De tests draaien op Node v24.19.0 en zijn geen fysieke Homey-/Marstektest. Zij verklaren niet welke specifieke calls op Homey gemiddeld 7,24 ms duurden en garanderen geen vast CPU-percentage op Homey. Wel is structureel aangetoond dat snapshot-opbouw, evaluatiestatus, SoC-/tariefhelpers en allocator in de bevestigde idle-toestand niet meer per P1 nodig zijn.

## Herhalen

```sh
npm run check
node test/idle-cpu-comparison.js /pad/naar/vorige/HomeFlux-EMS-v1.0.8
```

De oorspronkelijke bron blijft als afzonderlijke baseline nodig. De vergelijkingsrunner schrijft JSON op stdout; deze run staat in `docs/IDLE-CPU-COMPARISON-1.0.8.json`.

README-basisuitleg, Athom-appteksten, instellingen, vertalingen, widgets en Flow-kaarten blijven ongewijzigd. Alleen de 1.0.8-feature-release notes zijn aangevuld. Er zijn geen nieuwe dependencies of stuurparameters.
