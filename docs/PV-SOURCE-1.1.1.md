# HomeFlux EMS 1.1.1 — PV-live-onderzoek en validatie

Gebaseerd op de aangeleverde `HomeFlux-EMS-v1.0.12(2).zip`.

## Gevonden en verwijderd werk

1. `noteAutoTunePvSample` verhoogde bij iedere geldige PV-waarneming een revisieteller. `shouldRunFastEvaluation` liet een gewijzigde PV-live-selectie of een nieuwe actieve PV-revisie rechtstreeks door naar `evaluateFastNow`, vóór de normale feedbackcontrole. Ook als de geselecteerde P1-waarde en alle batterijcommando's gelijk bleven. Die uitzondering, de teller en `fastReasonPvLive` zijn verwijderd.
2. De meetbronselectie stond tweemaal uitgeschreven. `getGridControlSelection` deelt nu dezelfde lichte keuze tussen de snelle signaalcontrole en `getEvaluationState`. Er wordt geen volledige evaluatie of planning gebruikt om PV-live te kiezen. Het ingestelde gemiddelde hoeft niet meer te worden berekend wanneer live P1 gekozen is, afgezien van het bestaande diagnostische vijfmetingengemiddelde in de evaluatiestatus.
3. De tekstuele `controlGridSource` maakte het batterijfeedbackmemo ongeldig. Die tekst is geen invoer voor het berekenen van batterijvermogen. De bestaande feedbackcontrole rekent met de geselecteerde numerieke P1-waarde en controleert nog steeds ieder afzonderlijk batterijcommando. Daarom is alleen de bronnaam uit de afhankelijkheden verwijderd. Status en bronnaam verversen bij de volgende reguliere evaluatie; een bronlabel veroorzaakt zelf geen publicatie.

Een gewone PV-Flow of API-invoer mag nog `requestEvaluate` aanvragen. Die aanvraag is geen volledige evaluatie: de gewone signaal-, feedback- en uitvoercontroles bepalen of er werk nodig is. Een PV-waarneming wordt niet opnieuw als revisie-aanleiding gebruikt bij volgende P1-updates.

## Regelroute

PV-Flow/API → bestaande invoerregistratie en PV-detectie → `requestEvaluate` → lichte keuze van actuele P1 of ingesteld gemiddelde → bestaande zone-/feedback-/veiligheidscontrole → zo nodig `evaluateFastNow` → bestaande commando- en publicatiewachtrij.

De gekozen P1-waarde wordt vóór de beslissing om over te slaan gebruikt. In de productieroutetest is het gemiddelde 0 W en live P1 −900 W. Zonder PV-live blijft de regelwaarde 0 W; bij een echte PV-verandering kiest de regelroute −900 W en volgt direct de normale laadcorrectie. Bij het verstrijken van de bestaande geldigheid keert de keuze terug naar 0 W. Een onafhankelijke adaptieve live-periode blijft live P1 kiezen.

PV-live is geen afzonderlijke regelkring. De bestaande relevante PV-contextaanvraag voor planning/PV-begrenzing/flexibele lasten blijft bestaan. Onderzoek toont geen planningopbouw in de snelle route; er is daarom geen vermeende dubbele planning verwijderd. Contextmomenten zijn vóór en na identiek.

## Voor/na-replay

Per scenario: 10 virtuele minuten opwarming, daarna 30 virtuele minuten met 1.800 P1-inputs en 120 PV-inputs. Vier batterijen. De werkelijke productiecode verzorgt startup, settingscache, settingssnapshots, planning, regelroutes, feedbackmemo, timers en publicatiegates. Alleen tijd, fysieke invoer en Homey-I/O zijn gesimuleerd. Het nieuwe harnas vervangt `getSettings`, laadtestvalidatie en EV-netbudgetten niet door fixtures.

Vijf afzonderlijke processen per versie en scenario, afwisselende volgorde. CPU is `process.cpuUsage()` (user + system), uitsluitend over de gemeten replay; de tabel toont de mediaan in milliseconden. `wallMs` is niet gebruikt als CPU-bewijs. Runtime: Node v24.19.0 in deze container. Alle losse CPU-metingen, tellers en methodeaantallen staan in `PV-SOURCE-1.1.1-results.json`.

| Scenario | Snelle berekeningen | Statuspublicaties | Batterijpublicaties | Context-/planningspasses | Proces-CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| P1 rond nul, wisselende PV | 120 → 0 | 30 → 0 | 0 → 0 | 0 → 0 | 322.8 → 144.6 |
| Gepland laden op laadondergrens | 120 → 30 | 30 → 30 | 0 → 0 | 0 → 0 | 418.4 → 360.8 |
| Wisselende PV, laden en ontladen | 360 → 240 | 360 → 360 | 150 → 150 | 30 → 30 | 696.1 → 558.9 |
| Wisselende PV met Peak Guard | 345 → 255 | 375 → 375 | 165 → 165 | 30 → 30 | 715.2 → 607.3 |

Alle individuele batterijcommando's, hun volgorde en exacte virtuele verzendtijden zijn vóór en na gelijk. Dit is expliciet vergeleken, niet alleen de totaalsom. De contextmomenten zijn eveneens exact gelijk. Het bestaande minimuminterval van 7 seconden wordt in de replays gecontroleerd. Bij gepland laden blijven 30 reguliere berekeningen rond het vervallen van het bestaande minuutmemo nodig; die zijn behouden.

Deze synthetische metingen tonen minder werk en lagere mediane proces-CPU voor deze scenario's. De losse CPU-metingen variëren. Ze zijn geen Homey-CPU-percentages, voorspellen geen exacte besparing op de doelhardware en bewijzen niet dat PV-live de oorzaak was van de gemelde hogere CPU thuis. De doel-Homey en de echte asynchrone apparaten zijn hier niet fysiek getest.

## Regressiecontrole en behouden gedrag

- Alle 50 bestaande testsuites en syntaxcontroles slagen; de nieuwe `pv-source-1.1.1.test.js` slaagt ook en is opgenomen in `npm test` en `npm run check`.
- Het historische PV-testbestand is aangepast waar het eerder een evaluatie uitsluitend vanwege een bronwisseling of nieuwe PV-waarneming verplicht stelde. De tests voor detectie, drempels, geldigheid, verschillende gemiddelden, foutieve invoer, cooldown en falende/langzame publicaties blijven bestaan.
- Nieuwe tests gebruiken echte startup/settings/cache en echte Flow/API-routes: gelijke PV-metingen, veranderende PV met dezelfde regelwaarde, expiry, live versus gemiddelde, onafhankelijke adaptieve live-regeling, ruwe P1 bij Peak Guard, SoC 0/100%, pending asynchrone batterijpublicatie en exact 7 seconden coalescing.
- Alle 28 bestaande EV-replays zijn ook vóór/na vergeleken: batterij-, EV- en Split-publicaties, contextmomenten, aanvraagdeadlines en meetmonsters zijn exact gelijk. Deze extra vergelijking gebruikt het bestaande EV-harnas; de nieuwe PV-replays hierboven gebruiken de werkelijke settingscache.
- De bestaande settingscache-regressie slaagt met werkelijke startup en snelle V8-properties; de cachemethoden zijn byte voor byte ongewijzigd.
- De enginebibliotheken, alle 229 Flow-kaarten, settings-UI, widgets en vertalingen zijn byte voor byte ongewijzigd. Er zijn geen intervallen, gevoeligheden, timers, polling of permanente logs toegevoegd of gewijzigd.
- Gepland laden, PV-opvang, ontladen, individuele verdeling, SoC-grenzen, Peak Guard, EV-correcties en hybride/split/pending-publicatie blijven via de bestaande productiecode lopen.

## Herhalen

Vanuit de uitgepakte map:

```sh
npm run check
node test/pv-source-replay.js /pad/naar/originele-1.0.12 active
node test/pv-source-replay.js . active
```

Scenario's: `quiet`, `planned`, `active`, `peak`. Elke replay schrijft JSON met CPU-tijd, tellers, afzonderlijke commando's en virtuele timing naar stdout. Het originele pakket moet beschikbaar zijn voor een voor/na-vergelijking.

## Korte release note

PV-live kiest nu uitsluitend de P1-meetwaarde en vermijdt overbodige batterijberekeningen.
