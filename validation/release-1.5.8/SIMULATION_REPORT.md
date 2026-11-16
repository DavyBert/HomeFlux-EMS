# HomeFlux EMS 1.5.8 — SOC-prognose en simulaties

Basis: uitsluitend **HomeFlux-EMS-v1.5.7-Widget-History-Performance.zip**, de laatst opgeleverde versie uit deze thread. De eerdere aparte SOC-Target-Forecast-Fix-build is niet gebruikt.

De widget bepaalt de laadbehoefte opnieuw met haar voorspelde SOC, het toekomstige fase-doel en de resterende laaduren. Het huidige EMS-plan blijft een herkenbare momentopname en wordt niet nogmaals bij de voorspelde lading opgeteld. De blokkade `authoritativeUntil` is verwijderd.

Pure regels voor dynamisch uitstel, de nachtvensterselectie en laadstrategieën zijn als zelfstandige presentatiekopieën opgenomen. De productiebestanden blijven intact; een test vergelijkt de gekopieerde bron en 120 uitsteluitkomsten rechtstreeks met de productieregels. De grens van €0,01/kWh, volledige prijsdekking, normale laadgrens, 85% toekomstige capaciteitsruimte en reserve voor dure tussenblokken blijven behouden.

Om toekomstige SOC en herplanning correct te vergelijken zijn in de prognose ook twee ontbrekende beschermingen aangevuld: de bestaande maandreserve buiten dure/importvermijdingsblokken en de bestaande uitstelreserve tijdens normaal tarief. Dat verandert geen werkelijke batterijbeslissing. Kalendergrenzen gebruiken verstreken milliseconden voor energie en lokale klokuren voor de grafiek.

## Resultaat en toetsmethode

**19 virtuele dagen: alle doelmomenten binnen 3 procentpunt. Grootste afwijking: 1.574 procentpunt.**

De widgetvoorspelling wordt één keer bij de begintijd berekend. De virtuele EMS ontwikkelt daarna haar eigen SOC uit de echte `evaluate()`-batterijcommando’s. Elke vijf minuten worden `prepareDynamicChargeDeferral()`, de nachtvensterplanner, `prepareChargeStrategy()` en `buildSocPlan()` opnieuw met die virtuele SOC gevoed. Kalenderfase en productie-SOC worden onafhankelijk van de voorspelde SOC bepaald. Beide krijgen dezelfde deterministische vraag en PV-verdeling. De simulator gebruikt 95% netlaad-, 92% PV-laad- en 93% ontlaadefficiëntie.

Bij maximumvermogen kan één vijfminutenstap de laadgrens voorbijgaan voordat de virtuele engine haar nieuwe SOC ziet. Daardoor bereikt die grove simulatie soms 96,57% bij een doel van 95%, tegenover 95% in de begrensde widgetcurve. Dit verklaart de maximale afwijking van 1,574 punt; de uitkomst is niet achteraf naar het doel teruggezet. De echte snelle P1-cyclus is hier niet fysiek nagebootst.

Alle voorbeelden gebruiken Europe/Brussels, 21,6 kWh capaciteit, minimum 12%, veiligheids-SOC 14%, maximum 100%, ochtenddoel maximaal 95% en dagdoel maximaal 90%. Maandminimum 95% met nachtreserve is ingeschakeld, behalve in de zonnige-PV-casus. Huishoudelijke vraag is standaard 1 kW; in de hoge-SOC-regressie 1,6 kW. Vermogen is 6 kW, met apart geteste beperkingen.

## Overzicht doelmomenten

| Scenario | Begintijd / start-SOC | Doelmoment | Widget | Virtuele EMS | Afwijking |
|---|---|---|---:|---:|---:|
| 1. TOU hoog SOC, bestaand plan 0.4 kWh | 2026-11-16T17:00:00+01:00 / 93.3% | 17/11 07:00 | 94.96% | 94.96% | 0.000 pp |
| 1. TOU hoog SOC, bestaand plan 0.4 kWh | 2026-11-16T17:00:00+01:00 / 93.3% | 17/11 17:00 | 89.98% | 89.98% | 0.000 pp |
| 2. TOU laag SOC | 2026-11-16T22:00:00+01:00 / 20.0% | 17/11 07:00 | 94.93% | 94.93% | 0.000 pp |
| 2. TOU laag SOC | 2026-11-16T22:00:00+01:00 / 20.0% | 17/11 17:00 | 89.99% | 89.99% | 0.000 pp |
| 3. TOU onvoldoende capaciteit | 2026-11-16T22:00:00+01:00 / 20.0% | 17/11 07:00 | 35.83% | 35.83% | 0.000 pp |
| 3. TOU onvoldoende capaciteit | 2026-11-16T22:00:00+01:00 / 20.0% | 17/11 17:00 | 31.75% | 31.76% | 0.002 pp |
| 4. TOU weekend | 2026-11-21T16:00:00+01:00 / 65.0% | 21/11 17:00 | 89.78% | 89.78% | 0.000 pp |
| 4. TOU weekend | 2026-11-21T16:00:00+01:00 / 65.0% | 22/11 07:00 | 94.79% | 94.79% | 0.000 pp |
| 4. TOU weekend | 2026-11-21T16:00:00+01:00 / 65.0% | 22/11 17:00 | 94.79% | 94.79% | 0.000 pp |
| 5. Dynamisch uur, aansluitend goedkoper | 2026-11-16T01:00:00+01:00 / 35.0% | 16/11 07:00 | 35.00% | 35.00% | 0.000 pp |
| 5. Dynamisch uur, aansluitend goedkoper | 2026-11-16T01:00:00+01:00 / 35.0% | 16/11 17:00 | 89.94% | 89.93% | 0.014 pp |
| 6. Dynamisch kwartier, kort duur blok | 2026-11-16T01:00:00+01:00 / 14.0% | 16/11 07:00 | 16.01% | 16.01% | 0.000 pp |
| 6. Dynamisch kwartier, kort duur blok | 2026-11-16T01:00:00+01:00 / 14.0% | 16/11 17:00 | 89.92% | 89.90% | 0.019 pp |
| 7. Dynamisch lang duur blok | 2026-11-16T01:00:00+01:00 / 18.0% | 16/11 07:00 | 27.07% | 27.07% | 0.000 pp |
| 7. Dynamisch lang duur blok | 2026-11-16T01:00:00+01:00 / 18.0% | 16/11 17:00 | 89.92% | 89.90% | 0.019 pp |
| 8. Dynamisch ontbrekende toekomst | 2026-11-16T01:00:00+01:00 / 35.0% | 16/11 07:00 | 94.92% | 94.92% | 0.000 pp |
| 8. Dynamisch ontbrekende toekomst | 2026-11-16T01:00:00+01:00 / 35.0% | 16/11 17:00 | 94.92% | 94.92% | 0.000 pp |
| 9. Zonnige dag | 2026-11-16T07:00:00+01:00 / 30.0% | 16/11 17:00 | 100.00% | 100.00% | 0.000 pp |
| 9. Zonnige dag | 2026-11-16T07:00:00+01:00 / 30.0% | 17/11 07:00 | 62.37% | 62.37% | 0.001 pp |
| 9. Zonnige dag | 2026-11-16T07:00:00+01:00 / 30.0% | 17/11 17:00 | 100.00% | 100.00% | 0.000 pp |
| 10. Overgang 07 en 17 zonder PV-meting | 2026-11-16T06:00:00+01:00 / 85.0% | 16/11 07:00 | 94.95% | 94.95% | 0.000 pp |
| 10. Overgang 07 en 17 zonder PV-meting | 2026-11-16T06:00:00+01:00 / 85.0% | 16/11 17:00 | 89.99% | 89.99% | 0.000 pp |
| 11. Zomertijd 23 uur | 2026-03-28T17:00:00+01:00 / 80.0% | 29/03 07:00 | 94.98% | 94.98% | 0.000 pp |
| 11. Zomertijd 23 uur | 2026-03-28T17:00:00+01:00 / 80.0% | 29/03 17:00 | 94.98% | 94.98% | 0.000 pp |
| 12. Wintertijd 25 uur | 2026-10-24T17:00:00+02:00 / 80.0% | 25/10 07:00 | 94.77% | 94.77% | 0.000 pp |
| 12. Wintertijd 25 uur | 2026-10-24T17:00:00+02:00 / 80.0% | 25/10 17:00 | 94.77% | 94.77% | 0.000 pp |
| 13. Vast contract, maximum centrum binnen laadvenster | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 07:00 | 95.00% | 96.57% | 1.574 pp |
| 13. Vast contract, maximum centrum binnen laadvenster | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 17:00 | 95.00% | 95.00% | 0.000 pp |
| 14. TOU twee nachttarieven toegestaan | 2026-11-16T22:00:00+01:00 / 20.0% | 17/11 07:00 | 94.95% | 94.96% | 0.000 pp |
| 14. TOU twee nachttarieven toegestaan | 2026-11-16T22:00:00+01:00 / 20.0% | 17/11 17:00 | 89.99% | 89.99% | 0.000 pp |
| 15. Maximum vroeg | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 07:00 | 95.00% | 96.57% | 1.574 pp |
| 15. Maximum vroeg | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 17:00 | 90.00% | 89.86% | 0.143 pp |
| 16. Maximum laatst | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 07:00 | 95.00% | 96.57% | 1.574 pp |
| 16. Maximum laatst | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 17:00 | 90.00% | 89.87% | 0.134 pp |
| 17. Maximum centrum | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 07:00 | 94.95% | 94.95% | 0.000 pp |
| 17. Maximum centrum | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 17:00 | 89.99% | 89.99% | 0.000 pp |
| 18. Peak Guard laadruimte | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 07:00 | 75.90% | 75.90% | 0.000 pp |
| 18. Peak Guard laadruimte | 2026-11-16T22:00:00+01:00 / 35.0% | 17/11 17:00 | 89.97% | 89.97% | 0.000 pp |
| 19. Dynamisch avond, aansluitend goedkoper | 2026-11-16T15:00:00+01:00 / 30.0% | 16/11 17:00 | 30.00% | 30.00% | 0.000 pp |
| 19. Dynamisch avond, aansluitend goedkoper | 2026-11-16T15:00:00+01:00 / 30.0% | 17/11 07:00 | 94.77% | 94.77% | 0.000 pp |
| 19. Dynamisch avond, aansluitend goedkoper | 2026-11-16T15:00:00+01:00 / 30.0% | 17/11 17:00 | 94.77% | 94.77% | 0.000 pp |

## Rapport per simulatie

Onderstaande vensters zijn samengevoegde aaneengesloten intervallen, met hun totale energie. De volledige bij aanvang berekende SOC-curve en de onafhankelijk bereikte EMS-curve staan in `simulations.json` en `curves.csv`. Alle prijsintervallen en per-stap herplanningsdoelen zijn eveneens in de JSON opgenomen.

### 1. TOU hoog SOC, bestaand plan 0.4 kWh

Begintijd **2026-11-16T17:00:00+01:00**, start-SOC **93.3%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 17/11 01:00–17/11 07:00 (9.43 kWh); 17/11 11:00–17/11 17:00 (6.11 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 16/11 17:00–16/11 22:00 (8.60 kWh); 17/11 07:00–17/11 11:00 (6.88 kWh).
- Netladen virtuele EMS: 17/11 01:00–17/11 07:00 (9.43 kWh); 17/11 11:00–17/11 17:00 (6.11 kWh).
- Ontlading virtuele EMS: 16/11 17:00–16/11 22:00 (8.60 kWh); 17/11 07:00–17/11 11:00 (6.88 kWh).

Het bij aanvang beschikbare plan bevat slechts 0,4 kWh. De prognose daalt vóór superdal naar ongeveer 53,5% en vult daarna aan tot ongeveer 94,96% om 07:00. De virtuele EMS bereikt hetzelfde doel binnen 0,001 procentpunt.

### 2. TOU laag SOC

Begintijd **2026-11-16T22:00:00+01:00**, start-SOC **20.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 17/11 01:00–17/11 07:00 (17.04 kWh); 17/11 11:00–17/11 17:00 (3.40 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 17/11 07:00–17/11 11:00 (4.30 kWh).
- Netladen virtuele EMS: 17/11 01:00–17/11 07:00 (17.04 kWh); 17/11 11:00–17/11 17:00 (3.40 kWh).
- Ontlading virtuele EMS: 17/11 07:00–17/11 11:00 (4.30 kWh).

### 3. TOU onvoldoende capaciteit

Begintijd **2026-11-16T22:00:00+01:00**, start-SOC **20.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 17/11 01:00–17/11 07:00 (3.60 kWh); 17/11 11:00–17/11 17:00 (3.60 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 17/11 07:00–17/11 11:00 (4.30 kWh).
- Netladen virtuele EMS: 17/11 01:00–17/11 07:00 (3.60 kWh); 17/11 11:00–17/11 17:00 (3.60 kWh).
- Ontlading virtuele EMS: 17/11 07:00–17/11 11:00 (4.30 kWh).

Beperkt tot 600 W: het doel van 95% is fysiek onhaalbaar. De voorspelling toont circa 35,83% bij 07:00, zonder geforceerde doelstijging.

### 4. TOU weekend

Begintijd **2026-11-21T16:00:00+01:00**, start-SOC **65.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 21/11 16:00–21/11 17:00 (5.63 kWh); 22/11 02:00–22/11 06:50 (1.14 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: Geen.
- Netladen virtuele EMS: 21/11 16:00–21/11 17:00 (5.63 kWh); 22/11 02:00–22/11 06:50 (1.14 kWh).
- Ontlading virtuele EMS: Geen.

### 5. Dynamisch uur, aansluitend goedkoper

Begintijd **2026-11-16T01:00:00+01:00**, start-SOC **35.0%**, contract **dynamic_hour**, prijzen **€0.08/kWh, €0.30/kWh, €0.65/kWh**.

- Voorspeld netladen: 16/11 07:00–16/11 12:00 (12.49 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: Geen.
- Netladen virtuele EMS: 16/11 07:00–16/11 11:00 (12.49 kWh).
- Ontlading virtuele EMS: Geen.

### 6. Dynamisch kwartier, kort duur blok

Begintijd **2026-11-16T01:00:00+01:00**, start-SOC **14.0%**, contract **dynamic_quarter**, prijzen **€0.08/kWh, €0.30/kWh, €0.65/kWh**.

- Voorspeld netladen: 16/11 01:00–16/11 04:40 (0.46 kWh); 16/11 07:30–16/11 12:30 (17.26 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 16/11 07:00–16/11 07:25 (0.43 kWh).
- Netladen virtuele EMS: 16/11 01:00–16/11 04:40 (0.46 kWh); 16/11 07:30–16/11 11:30 (17.26 kWh).
- Ontlading virtuele EMS: 16/11 07:00–16/11 07:30 (0.54 kWh).

### 7. Dynamisch lang duur blok

Begintijd **2026-11-16T01:00:00+01:00**, start-SOC **18.0%**, contract **dynamic_quarter**, prijzen **€0.08/kWh, €0.30/kWh, €0.65/kWh**.

- Voorspeld netladen: 16/11 01:00–16/11 04:55 (2.06 kWh); 16/11 10:00–16/11 15:00 (17.26 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 16/11 07:00–16/11 09:40 (2.82 kWh).
- Netladen virtuele EMS: 16/11 01:00–16/11 04:55 (2.06 kWh); 16/11 10:00–16/11 14:00 (17.26 kWh).
- Ontlading virtuele EMS: 16/11 07:00–16/11 10:00 (3.23 kWh).

### 8. Dynamisch ontbrekende toekomst

Begintijd **2026-11-16T01:00:00+01:00**, start-SOC **35.0%**, contract **dynamic_hour**, prijzen **€0.30/kWh, €0.65/kWh**.

- Voorspeld netladen: 16/11 01:00–16/11 05:00 (13.62 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: Geen.
- Netladen virtuele EMS: 16/11 01:00–16/11 05:00 (13.62 kWh).
- Ontlading virtuele EMS: Geen.

De prijsdekking tussen 07:00 en 08:00 ontbreekt. Uitstel kan niet bewezen worden en wordt niet toegepast; onbekende prijzen worden niet als goedkoop ingevuld.

### 9. Zonnige dag

Begintijd **2026-11-16T07:00:00+01:00**, start-SOC **30.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: Geen.
- Voorspeld PV-laden: 16/11 08:15–16/11 17:00 (23.34 kWh); 17/11 08:15–17/11 17:00 (23.34 kWh).
- Voorspelde ontlading: 16/11 07:00–16/11 08:15 (0.87 kWh); 16/11 17:00–17/11 01:00 (8.13 kWh); 17/11 07:00–17/11 08:15 (0.87 kWh).
- Netladen virtuele EMS: 16/11 08:50–16/11 09:00 (0.00 kWh); 16/11 12:05–16/11 12:15 (0.00 kWh); 16/11 13:00–16/11 13:35 (0.00 kWh); 17/11 08:50–17/11 09:00 (0.00 kWh).
- Ontlading virtuele EMS: 16/11 07:00–16/11 08:15 (0.87 kWh); 16/11 17:00–17/11 01:00 (8.13 kWh); 17/11 07:00–17/11 08:15 (0.87 kWh).

### 10. Overgang 07 en 17 zonder PV-meting

Begintijd **2026-11-16T06:00:00+01:00**, start-SOC **85.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 16/11 06:00–16/11 07:00 (2.26 kWh); 16/11 11:00–16/11 17:00 (3.40 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 16/11 07:00–16/11 11:00 (4.30 kWh).
- Netladen virtuele EMS: 16/11 06:00–16/11 07:00 (2.26 kWh); 16/11 11:00–16/11 17:00 (3.40 kWh).
- Ontlading virtuele EMS: 16/11 07:00–16/11 11:00 (4.30 kWh).

PV-input en PV-prognose zijn onbekend. De virtuele fysieke omgeving heeft nul PV, met geldige P1-vraag. De voorspelling kent geen fictieve PV-opbrengst toe en gebruikt de bestaande veiligheids-/maandreserve.

### 11. Zomertijd 23 uur

Begintijd **2026-03-28T17:00:00+01:00**, start-SOC **80.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 29/03 01:00–29/03 07:00 (3.41 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: Geen.
- Netladen virtuele EMS: 29/03 01:00–29/03 07:00 (3.41 kWh).
- Ontlading virtuele EMS: Geen.

### 12. Wintertijd 25 uur

Begintijd **2026-10-24T17:00:00+02:00**, start-SOC **80.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 25/10 01:00–25/10 06:55 (3.36 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: Geen.
- Netladen virtuele EMS: 25/10 01:00–25/10 06:55 (3.36 kWh).
- Ontlading virtuele EMS: Geen.

### 13. Vast contract, maximum centrum binnen laadvenster

Begintijd **2026-11-16T22:00:00+01:00**, start-SOC **35.0%**, contract **fixed**, prijzen **€0.30/kWh**.

- Voorspeld netladen: 17/11 04:40–17/11 07:00 (13.64 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: Geen.
- Netladen virtuele EMS: 17/11 02:55–17/11 05:15 (14.00 kWh).
- Ontlading virtuele EMS: 17/11 07:00–17/11 07:20 (0.36 kWh).

### 14. TOU twee nachttarieven toegestaan

Begintijd **2026-11-16T22:00:00+01:00**, start-SOC **20.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 16/11 22:00–17/11 07:00 (17.04 kWh); 17/11 11:00–17/11 17:00 (3.40 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 17/11 07:00–17/11 11:00 (4.30 kWh).
- Netladen virtuele EMS: 16/11 22:00–17/11 07:00 (17.04 kWh); 17/11 11:00–17/11 17:00 (3.40 kWh).
- Ontlading virtuele EMS: 17/11 07:00–17/11 11:00 (4.30 kWh).

Zowel dal als superdal is hier expliciet voor de nacht toegestaan. De bestaande productie-EMS spreidt standaard over beide vensters; de widget volgt diezelfde spreiding. Dit is geen nieuwe voorkeur voor dal. Alleen wanneer uitsluitend superdal is toegestaan, sluit de EMS dal volledig uit.

### 15. Maximum vroeg

Begintijd **2026-11-16T22:00:00+01:00**, start-SOC **35.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 17/11 01:00–17/11 03:20 (13.64 kWh); 17/11 11:00–17/11 11:35 (3.39 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 17/11 07:00–17/11 11:00 (4.30 kWh).
- Netladen virtuele EMS: 17/11 01:00–17/11 03:20 (14.00 kWh); 17/11 11:00–17/11 11:30 (3.00 kWh).
- Ontlading virtuele EMS: 17/11 07:00–17/11 11:00 (4.30 kWh).

### 16. Maximum laatst

Begintijd **2026-11-16T22:00:00+01:00**, start-SOC **35.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 17/11 04:40–17/11 07:00 (13.64 kWh); 17/11 16:15–17/11 16:50 (3.39 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 17/11 07:00–17/11 11:00 (4.30 kWh).
- Netladen virtuele EMS: 17/11 04:40–17/11 07:00 (14.00 kWh); 17/11 16:20–17/11 16:50 (3.00 kWh).
- Ontlading virtuele EMS: 17/11 07:00–17/11 11:00 (4.30 kWh).

### 17. Maximum centrum

Begintijd **2026-11-16T22:00:00+01:00**, start-SOC **35.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 17/11 01:00–17/11 07:00 (13.63 kWh); 17/11 11:00–17/11 17:00 (3.40 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 17/11 07:00–17/11 11:00 (4.30 kWh).
- Netladen virtuele EMS: 17/11 01:00–17/11 07:00 (13.63 kWh); 17/11 11:00–17/11 17:00 (3.40 kWh).
- Ontlading virtuele EMS: 17/11 07:00–17/11 11:00 (4.30 kWh).

### 18. Peak Guard laadruimte

Begintijd **2026-11-16T22:00:00+01:00**, start-SOC **35.0%**, contract **tou**, prijzen **€0.20/kWh, €0.30/kWh, €0.50/kWh**.

- Voorspeld netladen: 17/11 01:00–17/11 07:00 (9.30 kWh); 17/11 11:00–17/11 17:00 (7.73 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 17/11 07:00–17/11 11:00 (4.30 kWh).
- Netladen virtuele EMS: 17/11 01:00–17/11 07:00 (9.30 kWh); 17/11 11:00–17/11 17:00 (7.72 kWh).
- Ontlading virtuele EMS: 17/11 07:00–17/11 11:00 (4.30 kWh).

Netgrens 2.650 W, zachte marge 100 W en 1.000 W huisvraag beperken de beschikbare netlading tot 1.550 W. Daardoor is 95% vóór 07:00 niet haalbaar; beide modellen komen rond 75,90% uit.

### 19. Dynamisch avond, aansluitend goedkoper

Begintijd **2026-11-16T15:00:00+01:00**, start-SOC **30.0%**, contract **dynamic_quarter**, prijzen **€0.08/kWh, €0.30/kWh, €0.65/kWh**.

- Voorspeld netladen: 16/11 17:15–16/11 21:15 (15.04 kWh); 17/11 00:00–17/11 03:55 (1.95 kWh).
- Voorspeld PV-laden: Geen.
- Voorspelde ontlading: 16/11 17:00–16/11 17:15 (0.27 kWh); 16/11 22:15–17/11 00:00 (1.88 kWh).
- Netladen virtuele EMS: 16/11 17:15–16/11 21:15 (15.04 kWh); 17/11 00:00–17/11 03:55 (1.95 kWh).
- Ontlading virtuele EMS: 16/11 17:00–16/11 17:15 (0.27 kWh); 16/11 22:15–17/11 00:00 (1.88 kWh).

## Prestaties, grenzen en integriteit

De prognose draait uitsluitend via de bestaande trage widgetverversing. Ongewijzigde invoer hergebruikt de volledige cache; alleen een gewijzigde EV-status maakt die prognose niet ongeldig. Geen nieuwe timers, listeners, polling, opslagkeys of instellingen. Pure voorbereiding en virtuele herplanning gebeuren uitsluitend in de widgetbrowser. De read-only widgetstatus draagt alleen de benodigde bestaande configuratie over; de TOU-presentatietijdlijn reikt nu 49 uur vooruit, via dezelfde bestaande resolver en minuutcache.

De lokale koude berekening kostte in deze Node v22.23.5-VM-metingen 18.9–108.6 ms per scenario. Dit is geen Homey-CPU-meting en geen snelheidsvergelijking met 1.5.7; het model berekent nu ook toekomstige herplanning. Een fysieke Homey-installatie, communicatievertragingen, onvoorziene verbruikers en werkelijk nieuwe PV-/prijsinformatie zijn niet getest. Er is geen universele nauwkeurigheidsgarantie buiten de beschreven invoer.

Uitgevoerd: 19 dagsimulaties; 120 exacte uitstelvergelijkingen; bronvergelijking van de drie pure regelkopieën; veiligheids-/SOC-grenzen; toegestane vensters; ontbrekende prijzen; cachehergebruik; 11 gerichte bestaande regressies (alle geslaagd); syntax- en JSON-controles met Node.js 22.23.5. De historische volledige suite is voor deze afgebakende presentatiewijziging niet opnieuw uitgevoerd. Twee bestaande testfixtures zijn inhoudelijk aangepast: toekomstige herplanning binnen de actieve fase moet nu juist worden toegestaan, en een DOM-test gebruikt een toekomstige deadline in plaats van een vast tijdstip dat na 17:00 verouderd is.

**320 besturings-/configuratiebestanden zijn byte voor byte ongewijzigd**, waaronder `app.js`, alle `lib`-bestanden, de echte planners, Savings, P1-registratie, EV/HVAC/boiler, guards, drivers, instellingen, Flow-kaarten en de widgettransportcode. `app.json`, Compose en packagebestanden wijzigen uitsluitend van versie 1.5.7 naar 1.5.8. Exacte SHA-256-waarden staan in `integrity.json`; de bestandsdiff staat in `changes.diff`.

Gewijzigde bestanden:

- `.homeychangelog.json`
- `.homeycompose/app.json`
- `README.md`
- `app.json`
- `package-lock.json`
- `package.json`
- `test/widget-consolidation-1.5.7.test.js`
- `test/widget-render-1.5.7.test.js`
- `widgets/status/api.js`
- `widgets/status/public/visual.html`

Toegevoegd: `test/widget-soc-replanning-1.5.8.test.js` en deze release-evidence.
