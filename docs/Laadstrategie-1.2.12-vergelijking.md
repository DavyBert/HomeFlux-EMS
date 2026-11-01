# HomeFlux EMS 1.2.12 — Laadstrategie en vergelijking

De nieuwe laadstrategie is optioneel. Na upgrade blijven jaarstrategie, standaardspreiding en 0% extra vermogen actief. De bestaande energiebehoefte, doelen en veiligheidsgrenzen blijven leidend.

## Resultaat

- Dag en nacht kunnen onafhankelijk gespreid laden, met 0–100% extra gepland vermogen, of maximaal toegestaan laden vanaf het begin, zo laat mogelijk met 15 minuten reserve, of gecentreerd.
- Bij maximaal laden is de eerste nachtkeuze centreren en de eerste dagkeuze zo laat mogelijk. Opgeslagen keuzes blijven bewaard voor jaar, zomer en winter.
- Winter gebruikt de bestaande geselecteerde minimum-SoC-maanden; overige maanden zijn zomer. Dit werkt ook met uitgeschakelde minimum-SoC-opties en voegt geen tweede maandselectie toe.
- **Bij variabele en dynamische tarieven wordt alleen gecentreerd wanneer het volledige blok naar verwachting goedkoper is dan de standaardspreiding voor dezelfde resterende energie.** Anders blijft de standaardspreiding actief. Vaste prijzen behouden centrering in het midden van het venster.
- De berekening gebeurt uitsluitend in de bestaande trage context. Geen nieuwe timer, heartbeatplanner of planning bij iedere P1-update. De bestaande snelle regeling bewaakt PV-opvang, Peak Guard en uitgaande commando’s.

## Vermogensbudget en hergebruik

P1 plus het getekende laatst toegepaste batterijcommando reconstrueert de belasting zonder batterij. Laden heeft een negatief commando: bij P1 2.600 W en batterij −2.000 W blijft 600 W basisbelasting over. Zo wordt batterijvermogen eenmaal verwijderd.

Het netlaadbudget wordt begrensd door de bestaande batterijverdeling, geldige SoC, individuele en gezamenlijke laadlimieten, de bestaande EV/netafnamebeperking en Peak Guard inclusief gereserveerde andere belasting. Werkelijk P1-overschot blijft apart beschikbaar voor PV-opvang; toekomstige PV wordt niet als gegarandeerd laadvermogen verondersteld. Batterijen die tijdens het blok vol raken worden via dezelfde vermogensverdeler in de duurinschatting meegenomen.

Hergebruikt: `computeForecastTargetDetails`, `planningChargeTargetDetails`, `resolvePlanningPhaseBounds`, `resolvePlanningCycle`, `distributeCommand`, `getBatteryNightPlanningInputs`, `BatteryNightPlanner`, `prepareEvPriceCurve`, `buildSocPlan` en de bestaande P1/PV-feedback en Peak Guard. Bij dynamische centrering levert de bestaande nachtplanner ook de referentie voor de prijsvergelijking. Er draait geen tweede live regelaar.

Voorbeeld: Peak Guard 2.600 W, basislast 600 W, hardware 4.000 W geeft 2.000 W netlaadbudget. Voor 3 kWh is 90 minuten nodig. In 11:00–17:00 wordt uiterlijk 15:15 gestart, met geplande voltooiing 16:45. Starts worden zo nodig naar de voorafgaande trage context afgerond, maximaal vijf minuten vroeger.

## Eenmalige A/B-simulatie

De echte `ems-engine` en `BatteryNightPlanner` uit de volledige 1.2.11 en 1.2.12 zijn gebruikt. Het vergelijkingsscript staat buiten de regressiesuite. De resultaten en volledige ingevoerde kwartierprijzen staan in `validation/charge-strategy-ab-1.2.12.json`; alle hieronder genoemde metingen staan ook in CSV.

Gelijke omstandigheden: UTC 20 oktober 2026, nachtvenster 00:00–07:00, twee batterijen van 5 kWh, start 50%, doel 80%, 3 kWh behoefte, maximaal 2.000 W per batterij en 4.000 W gezamenlijk, Peak Guard 2.600 W zonder extra marge, huislast 600 W. Geen EV, geen PV, geen geplande ontlading; gewijzigde huislast vertegenwoordigt ook een extra EV-belasting op P1. De echte controller rekent iedere 15 seconden; de context iedere vijf minuten. A gebruikt echte tariefperiodes 00–02 €0,30, 02–05 €0,10, 05–07 €0,20 zonder kwartierprijzen. B/C gebruiken de expliciete synthetische kwartierprijzen uit het JSON-bestand; dit zijn geen actuele markttarieven.

De batterijsimulatie neemt ideale energieoverdracht aan. Er zijn geen betrouwbare efficiëntiegegevens gebruikt en geen besparingen door omzettingsrendement geclaimd. Werkelijke afgenomen energie verschilt enkele Wh door de bestaande afronding en stoptolerantie van 0,25 procentpunt. Daarom worden naast werkelijk gesimuleerde kosten ook kosten genormaliseerd naar **dezelfde 3 kWh** getoond. Een doel telt als gehaald binnen die bestaande tolerantie; alle scenario’s slagen.

### Kernvergelijking

Alle cellen tonen **1.2.11 → 1.2.12**. Negatieve kosten betekenen opbrengst in het synthetische prijsprofiel.


| Scenario | Start UTC | Einde UTC | Laadminuten | Gemiddeld W | Piek W | Net kWh | Werkelijke kosten € | Kosten voor gelijke 3 kWh € | Eind-SoC % | Peak Guard-episodes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-variabel-zonder-kwartierprijzen | 00:00:00 → 02:45:00 | 06:58:45 → 04:14:30 | 418,75 → 89,50 | 426 → 2000 | 640 → 2000 | 2,975 → 2,983 | 0,5524 → 0,2983 | 0,5570 → 0,3000 | 79,75 → 79,83 | 0 → 0 |
| B1-minimum-midden | 01:30:00 → 02:50:00 | 04:29:00 → 04:19:30 | 179,00 → 89,50 | 998 → 2000 | 1192 → 2000 | 2,977 → 2,983 | 0,6705 → 0,4570 | 0,6758 → 0,4596 | 79,77 → 79,83 | 0 → 0 |
| B2-minimum-begin | 00:00:00 → 00:00:00 | 04:14:00 → 04:14:00 | 179,00 → 179,00 | 998 → 998 | 1192 → 1192 | 2,977 → 2,977 | 0,6025 → 0,6025 | 0,6072 → 0,6072 | 79,77 → 79,77 | 0 → 0 |
| B2b-minimum-einde | 00:00:00 → 00:00:00 | 06:59:00 → 06:59:45 | 179,00 → 164,75 | 998 → 1085 | 1192 → 2000 | 2,977 → 2,980 | 0,6061 → 0,5606 | 0,6108 → 0,5644 | 79,77 → 79,80 | 0 → 0 |
| B3-gelijke-minima | 00:00:00 → 00:00:00 | 05:44:00 → 05:44:00 | 179,00 → 179,00 | 998 → 998 | 1192 → 1192 | 2,977 → 2,977 | 0,5979 → 0,5979 | 0,6026 → 0,6026 | 79,77 → 79,77 | 0 → 0 |
| B4-korte-prijspiek | 01:00:00 → 01:00:00 | 04:14:00 → 04:14:00 | 179,00 → 179,00 | 998 → 998 | 1192 → 1192 | 2,977 → 2,977 | 0,3298 → 0,3298 | 0,3323 → 0,3323 | 79,77 → 79,77 | 0 → 0 |
| B5-verspreid-goedkoop | 00:00:00 → 00:00:00 | 06:14:00 → 06:14:00 | 179,00 → 179,00 | 998 → 998 | 1192 → 1192 | 2,977 → 2,977 | 0,4261 → 0,4261 | 0,4294 → 0,4294 | 79,77 → 79,77 | 0 → 0 |
| B6-negatief | 01:00:00 → 02:20:00 | 03:59:00 → 03:49:30 | 179,00 → 89,50 | 998 → 2000 | 1192 → 2000 | 2,977 → 2,983 | 0,1380 → -0,2492 | 0,1391 → -0,2506 | 79,77 → 79,83 | 0 → 0 |
| C-2000W-reëel-versus-4000W-hardware | 01:30:00 → 02:50:00 | 04:29:00 → 04:19:30 | 179,00 → 89,50 | 998 → 2000 | 1192 → 2000 | 2,977 → 2,983 | 0,6705 → 0,4570 | 0,6758 → 0,4596 | 79,77 → 79,83 | 0 → 0 |
| C2-huisbelasting-wijzigt-om-03u | 01:30:00 → 02:50:00 | 05:57:30 → 05:58:45 | 267,50 → 188,75 | 668 → 946 | 1002 → 2000 | 2,976 → 2,977 | 0,7925 → 0,6803 | 0,7988 → 0,6856 | 79,76 → 79,77 | 0 → 0 |
| C3-belastingpiek-tussen-contexten | 01:30:00 → 02:50:00 | 06:12:15 → 04:28:30 | 282,25 → 98,50 | 633 → 1817 | 1002 → 2000 | 2,977 → 2,983 | 0,7994 → 0,4570 | 0,8056 → 0,4596 | 79,77 → 79,83 | 3 → 1 |

### Betekenis en verschillen

- A: concentreren in het laagste tarief bespaart circa €0,257 per 3 kWh en 329,25 laadminuten ten opzichte van spreiden over alle toegestane tarieven.
- B1: een goedkoop kwartier met gunstige buurkwartieren geeft circa €0,216 voordeel per 3 kWh; de laadduur daalt van 179 naar 89,5 minuten.
- B2 begin, gelijke minima, de korte prijspiek en verspreide goedkope kwartieren: het volledige gecentreerde blok is aanvankelijk duurder dan spreiden. De nieuwe prijsvoorwaarde behoudt de standaardspreiding. Zonder die voorwaarde zou het oude algoritme in deze profielen goedkoper zijn geweest.
- B2 einde: de oorspronkelijke gecentreerde kandidaat is duurder; later kan centreren voor een kleiner restant wel voordelig worden. De bestaande trage context beoordeelt dit opnieuw. De gerapporteerde kosten omvatten de volledige nacht, inclusief de eerdere spreiding.
- B6: in dit profiel benut het kortere blok de negatieve prijzen beter. Dit is uitsluitend een uitkomst voor deze ingevoerde tarieven.
- C: de duur wordt met 2.000 W berekend, niet met 4.000 W hardwaremaximum. C2 verhoogt huislast vanaf 03:00 naar 1.600 W: het laadbudget wordt 1.000 W en het resterende blok wordt via de context aangepast.
- C3 verhoogt de huislast van 03:02 tot 03:20, tussen contexten. Peak Guard grijpt onmiddellijk in de bestaande snelle regeling in. De tabel telt afzonderlijke episodes; het JSON-bestand bevat ook het aantal controlestappen met ingreep. Geen overschrijding van de gehanteerde veilige netlaadgrens na regeling.
- Centreren rond één minimumkwartier is dus niet altijd verstandig. De prijsvoorwaarde voorkomt aantoonbaar ongunstige kandidaten; er wordt geen andere goedkoopste periode stilzwijgend gekozen. Bij gebrek aan een betrouwbare volledige kostenvergelijking wordt de standaardspreiding behouden.

## Validatie

- 32 bestaande relevante testbestanden geslaagd; de volledige suite is niet uitgevoerd. Gewijzigde kernpaden zijn gedekt door de bestaande batterij-, PV-, Peak Guard-, verdelings-, nachtplan-, context-, EV-coördinatie- en instellingenregressies.
- Twee nieuwe blijvende testbestanden: 18 functionele testgroepen en een echte app-integratietest. 270 configuraties vergelijken volledige engine- en planningsresultaten met 1.2.11; daarnaast is een volledige dynamische nacht met standaardinstellingen exact gelijk gereplayed.
- Gedekt: 0/10/50/100% correctie, dag/nacht-defaults, seizoenkeuze onafhankelijk van minimum-SoC, herstart, wijziging tijdens laden, verschillende batterijen en volle/ontbrekende SoC, P1 inclusief batterij, veranderende huis/EV-last, prijsvoordeel inclusief negatieve prijzen en dure buren, vaste/TOU/dynamische prijzen, prijs-gaten, PV tijdens uitstel, doel bereikt, onvoldoende capaciteit, 15-minutenreserve, middernacht en beide DST-wissels.
- Complete instellingen-DOM in Nederlands en Engels: laden, zichtbaarheidsregels, alle profielen, keuzebehoud, validatie, opslaan, geen ongewijzigde writes en opnieuw openen.
- Syntaxcontroles op gewijzigde JavaScriptbestanden, inline instellingen-JavaScript en JSON geslaagd. Metadata is 1.2.12; Athom-omschrijving, slogan en bestaande Flow-definities zijn behouden.
- Eén bestaande geïsoleerde UI-validatortest kreeg uitsluitend een mock voor de nieuwe editorafhankelijkheid. Bestaande controles zijn behouden. Drie tests kregen alleen de verwachte nieuwe versiewaarde.
- Zie `validation/charge-strategy-regression-1.2.12.json`, `charge-strategy-functional-1.2.12.json`, `charge-strategy-ui-1.2.12.json`, `charge-strategy-memory-1.2.12.json` en `charge-strategy-syntax-1.2.12.json`.

## CPU, geheugen en grenzen

Een hostreplay van 600 P1-updates in 20 virtuele minuten geeft voor standaard 1.2.11 en 1.2.12 dezelfde zes contexten en 150 fast-evaluaties. De gemeten proces-CPU-tijd was respectievelijk ongeveer 259 en 258 ms; dit ene hostresultaat is geen precieze Homey-CPU-meting. Maximaal uitgesteld laden houdt de bestaande korte feedbackroute beschikbaar. Ook dynamische centrering gebruikt slechts de bestaande contexttimer. Er worden geen volledige prijscurves naar de snelle status gekopieerd.

Na 3.000 contextverversingen bleef de extra behouden heap in de geteste varianten onder 1 MB. Er is één extra, genest instellingenobject; geen explosie van vlakke instellingen. De waarden en configuratie staan in het geheugenrapport. Dit bewijst geen langdurige geheugenvrijheid op een echte Homey.

Geen praktijktest op batterijhardware/Homey uitgevoerd. Werkelijke batterijrespons, meetvertraging, Split Command-timers, rendement en toekomstige belastingswissels kunnen de voltooiing beïnvloeden. De bestaande grenzen en timers blijven beslissend; een onhaalbaar doel of reserve wordt zichtbaar gemeld. Batterij-SoC behoudt de bestaande waardegebaseerde geldigheid; er is geen nieuwe SoC-vervaltijd ingevoerd. De onafhankelijke brede HVAC-, boiler-, savings- en overige historische suites zijn overgeslagen; hun specifieke functies zijn niet opnieuw volledig getest.

## Gewijzigde bronbestanden

- `lib/charge-strategy.js` (nieuw): profielselectie, laadblokpositionering en compacte runtimepolicy.
- `lib/ems-engine.js`: trage voorbereiding, bestaand vermogensbudget/verdeling, duurinschatting, prijsvergelijking, gepland vermogen en plannings-/statusweergave. Standaard 0% gebruikt het bestaande pad.
- `app.js`: aansluiting op de bestaande context en expliciete instellingen-simulatie; gedeeld gebruik van gevalideerde prijscurve en bestaande nachtplanner.
- `settings/charge-strategy.js` (nieuw), `settings/index.html`, `settings/translations/en.json`: nieuw tabblad, voorwaardelijke velden en één persistent configuratieobject.
- `test/charge-strategy-1.2.12.test.js` en `test/charge-strategy-control-1.2.12.test.js` (nieuw), plus de hierboven genoemde gerichte testaanpassingen.
- App-/pakketmetadata, changelog, README en dit vergelijkingsrapport. Geen nieuwe Flow-kaart.
