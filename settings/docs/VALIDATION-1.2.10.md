# Validatie HomeFlux EMS 1.2.10

Basis: de volledige laatst geleverde 1.2.9-ZIP, inclusief de op verzoek gearchiveerde twee verouderde tests. Functionele wijzigingen zijn beperkt tot de bestaande batterijmemos/preflight in `app.js` en de expliciete Stand-by-uitzondering bij batterij-Peak Guard in `lib/ems-engine.js`.

## Testresultaat

**45/45 gerichte testbestanden slagen.** De nieuwe test bevat 24 scenariogroepen, inclusief **384 volledige enginevergelijkingen met 1.2.9** voor actieve modi, vier contracttypes, verschillende SoC's en import/export. Deze engine-uitkomsten zijn identiek; Stand-by heeft apart de gevraagde berekende nuluitvoer bij hoge import en export; bij gewone vermogensuitvoer wordt ook werkelijk 0 W gepubliceerd. De ingestelde minima/richtingstimers van Split Command blijven hun eigen bestaande uitvoerbeleid volgen.

De volledige regelroute is getest voor Zelfconsumptie, Netimport vermijden en Batterij sparen, met manuele keuze, PV-productie en expliciet losgekoppelde EV's. Nieuwe PV-export veroorzaakt echte laaduitvoer. Peak Guard kan onder de strategische reserve nog energie tot de harde minimum-SoC inzetten. Verse SoC-feedback na een geblokkeerde piek maakt ondersteuning direct weer beschikbaar. Geen batterij mag door de cache onder het harde minimum worden gestuurd.

Andere nieuwe controles: boilerklokken en uitgeschakelde boilerpreviews, echte boileruitgang/Peak Guard-aanvraag, aangesloten/onbekende EV's, niet-nul EV-stroom/uitgang, loskoppeling die nog niet door een nieuwe P1 is bevestigd, uitstaande publicatie/timers, verouderde netmeting/SoC, ontbrekende PV-invoer, gewijzigde modus/context en het beginnen/eindigen van een piek.

Bestaande gerichte suites dekken daarnaast engine, planning, nacht/herstart, opdrachtintervallen en coalescing, source-/meterselectie, Safety SoC, efficiëntie/vermogenslimieten, Split Command, Hybrid/flexibele belasting, EV-netvrijgave/-batterijbeleid, de 1.2.9-functies en batterij/HVAC-instellingenisolatie. De twee eerder gepensioneerde tests blijven `.disabled`; zij zijn niet opnieuw geactiveerd. Er zijn geen bestaande regressiecontroles verwijderd of afgezwakt.

Een eerste controle signaleerde dat Stand-by zonder actuele SoC de diagnostische `predictedGridW` van 0 naar null liet veranderen. Dit is in de implementatie gecorrigeerd, met behoud van de nuluitvoer. De oorspronkelijke isolatie-/standaardwaardetest is ongewijzigd opnieuw geslaagd.

## Vergelijkende P1-proef

Elke rij gebruikt vier gesimuleerde minuten met **240 P1-metingen**, vier batterijen en de bestaande contextcadans. Werkelijke methodetoegang is geteld, onafhankelijk van de optionele diagnoseregistratie.

| Situatie | Vermogenspreviews 1.2.9 → 1.2.10 | Snelle volledige evaluaties 1.2.9 → 1.2.10 | Opbouw regeltoestand 1.2.9 → 1.2.10 |
|---|---:|---:|---:|
| Normale stabiele zelfconsumptie | 0 → 0 | 0 → 0 | 4 → 4 |
| Automatisch op ondergrens, PV 0 W | 72 → 0 | 4 → 4 | 80 → 8 |
| Automatisch op ondergrens, PV 200 W | 236 → 0 | 4 → 4 | 244 → 8 |
| Manuele Zelfconsumptie op ondergrens | 236 → 0 | 4 → 4 | 244 → 8 |
| Manueel Netimport vermijden op ondergrens | 236 → 0 | 4 → 4 | 244 → 8 |
| Manueel Batterij sparen op reservegrens | 236 → 0 | 4 → 4 | 244 → 8 |
| Ondergrens met losgekoppelde EV | 236 → 0 | 4 → 3 | 245 → 8 |
| Netpiek, alle batterijen op hard minimum | 0 → 0 | 240 → 4 | 244 → 8 |
| Stabiele Stand-by onder Peak Guard-grens | 0 → 0 | 0 → 0 | 4 → 4 |

Alle negen stabiele batterij-uitgangsvectoren blijven gelijk aan 1.2.9, zonder extra batterijpublicaties in de meetfase. Periodieke context-/tijdgrenscontroles blijven lopen. De aantallen geplande bestaande timers zijn per rij gelijk aan de referentie. Er is geen nieuw plannings- of publicatiemechanisme toegevoegd.

CPU- en heapmetingen staan in `validation/blocked-feedback-performance-1.2.10.json`. Het zijn afzonderlijke Node 24-processen met gemockte Homey-I/O en GC/JIT-ruis. De gemeten werkreductie wordt niet vertaald naar een gegarandeerd Homey-CPU-percentage. De memo blijft één bestaand, vervangen object met begrensde extra scalairen; de proeven voegen geen blijvende runtimehistorie toe. Een vierminutenproef bewijst geen langdurige lekvrijheid.

## Reikwijdte en beperkingen

Syntax/JSON en ZIP-integriteit worden gecontroleerd. Flow-definities, deprecated kaarten, Athom-teksten, EV-/HVAC-/boilerregelaars en bestaande apparaatkoppelingen zijn inhoudelijk behouden. README blijft beperkt tot de basisstart en korte optionele functies, met de nieuwe release notes onderaan.

De volledige regressiesuite is niet uitgevoerd: de onafhankelijke Savings/CSV-/historiekfuncties en overige ongewijzigde subsystemen zijn niet opnieuw uitgebreid getest. Hun eerdere validatiedocumenten blijven als historie aanwezig. Er is geen fysieke Homey-installatie, laadpaaltest of duurproef uitgevoerd. De eerdere niet herhaalde legacy-testresultaten worden door deze 45 gerichte successen niet vervangen door een claim dat de volledige suite slaagt.

Reproduceren: `npm run test:1.2.10`; optioneel `HEMS_BLOCKED_BASELINE=/pad/naar/1.2.9 npm run test:1.2.10` voor de oude engine als referentie. `npm run benchmark:1.2.10` voert de containerproef uit. Details: `validation/targeted-1.2.10.json`, `validation/blocked-feedback-1.2.10.json` en `validation/source-audit-1.2.10.json`.
