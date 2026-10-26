# HomeFlux EMS 1.2.3 — doorlopende WAF

Deze volledige app is gebaseerd op de laatst aangeleverde 1.2.2. De eerdere WAF-formule, intensere kleuren, CPU-optimalisaties en batterijvermogens tot 100.000 W blijven behouden.

## Vastgestelde oorzaak

De oorzaak is niet een afzonderlijke blokkade voor een vast contract of een expliciete eis dat laden nodig moet zijn. In 1.2.2 stond de WAF-berekening **achter de cachecontrole van `buildSocPlan()`**. Bij een schone planningscache werd de WAF daardoor overgeslagen. Er bestond geen gegarandeerd vijfminuten-verversmoment voor een verder ongewijzigde installatie.

Daarnaast gebruikte de WAF altijd het doelmoment en de fase van het batterijplan. De batterijregeling houdt de nacht bewust actief tot echte PV-productie begint, ook na het ochtenddoel. De WAF wees een verstreken doelmoment af. Dat veroorzaakte `--` na 07:00 op donkere ochtenden en na het dagdoel zolang de nacht nog niet begonnen was.

Dit is gereproduceerd met de echte productiefuncties van 1.2.2. Het vijfminutenprobleem trad op bij vast, TOU en dynamisch; ook de wegvallende ochtend- en avondweergave is gereproduceerd. De geselecteerde vergelijkingsresultaten staan in `validation/waf-baseline-1.2.2.json`.

## Nieuwe doelperiodes

De tijden hieronder zijn de standaardinstellingen. Afwijkende ingestelde ochtend- en dagdoelen worden eveneens gevolgd.

| Situatie | WAF-doelmoment | Meegetelde zon |
|---|---|---|
| Nacht tot 07:00 | Ochtenddoel 07:00 | Geen krediet voor zonneproductie na het ochtenddoel |
| Vanaf 07:00, ook zonder eerste PV-productie | Dagdoel 17:00 | Ruwe voorspelling ‘resterend vandaag’ |
| Vanaf 17:00 zolang de nacht niet werkelijk gestart is | Volgend ochtenddoel 07:00 | Nog steeds ‘resterend vandaag’ |
| Bestaande echte nachtstart, ook vóór 17:00 in de winter | Volgend ochtenddoel | Bestaande nachtberekening zonder volgend-dag-PV als beschikbaar overschot |

De avondhorizon tot het volgende ochtenddoel is de in dit verzoek bevestigde keuze. Het huisverbruik wordt vanaf 17:00 dus eveneens tot dat ochtenddoel meegenomen. Er wordt niet met negatieve resterende uren gerekend en er wordt geen hele volgende PV-dag aan de avond toegekend.

De bestaande nachtstart blijft ongewijzigd: gemeten PV onder 5 W gedurende tien minuten, met de bestaande 20:00-fallback. De WAF verandert geen nachtmarker, PV-timer, mediaan, laadvenster of batterijdoel. Bij de ochtendovergang wordt de ruwe resterende voorspelling gelezen, omdat de batterijcontext dan nog de nachtmediaan in zijn forecastvelden kan bevatten.

## Eén berekeningspad

1. De bestaande trage context bouwt zijn regelgegevens eenmaal op en voert de bestaande regelberekening uit.
2. De WAF gebruikt die reeds berekende SoC-, doel- en reservegegevens. Er is geen tweede doelberekening of laadplanner voor de WAF.
3. Daarna wordt alleen wanneer de oorspronkelijke planningscache dat vereist het batterijplan opgebouwd.

`refreshPlanningInContext()` blijft het enige aanroeppunt van `calculateBudget()`. De WAF staat nu vóór de cachecontrole die het opbouwen van een nieuw batterijplan kan overslaan. De WAF wordt als één object in dezelfde contextcache bewaard; status en planpresentatie lezen dat object.

Er is één verversdeadline van vijf minuten, onafhankelijk van `planningMinIntervalMinutes`. Dezelfde bestaande contexttimer wordt gebruikt. Een eerder doelmoment of een structurele fase-/instellingenwijziging kan eerder verversen. Het plannen van een toekomstig WAF-moment maakt de huidige context niet onterecht vuil en lokt geen eerdere heartbeatberekening uit.

Op een stille installatie met actieve batterijregeling zorgt deze gedeelde timer ook zonder nieuwe meterinputs voor de volgende vijfminutenpass. Binnen een nog geldige WAF-periode berekenen gewone contextpasses geen nieuwe WAF-horizon. P1, widget/status, EV-heartbeat en portfolio roepen de WAF-berekening niet aan. Er zijn geen extra intervals of afzonderlijke periodieke WAF-timers toegevoegd.

De rekenformule zelf is ongewijzigd. Gepland netladen wordt niet als beschikbare energie toegevoegd. Bestaande huisverbruikmediaan, EV-reserveringen, SoC-reserves en bescherming van de werkelijke ontlaadvloer blijven behouden. Bij ontbrekende noodzakelijke brondata, onbekende EV-reserveringen of uitgeschakelde batterij-uitvoer gelden de bestaande onbekend-statussen; er wordt geen getal verzonnen. Nieuwe brondata kan via de vijfminutenpass herstellen zonder een nieuw batterijplan af te dwingen.

## Verificatie

- **84 testbestanden geslaagd** in de volledige regressiesuite, inclusief alle bestaande tests voor WAF, EV, vermogensverdeling en de 100.000 W-invoergrenzen.
- **14 nieuwe gerichte scenario’s geslaagd** met echte productiefuncties en de echte widgetformatter: vast/TOU/dynamisch met bereikt batterijdoel; vijfminutenverversing bij een schone 60-minuten-planningscache; WAF vóór optioneel batterijplan; 07:00 zonder PV en met een afwijkende nachtmediaan; 17:00 met resterende zon tot volgend ochtenddoel; echte PV-stop en winteravond; 20:00-fallback op een donkere dag; beide Brusselse DST-overgangen; afwijkende doeluren en middernacht; ontbrekende data en herstel; isolatie van het P1-/statuspad.
- In de stille-contractscenario’s: één WAF-verversing na exact 300.000 ms, **nul extra `buildSocPlan()`-aanroepen** en hergebruik van de bestaande plancache. De gedeelde contexttimer wordt opnieuw op het volgende WAF-moment gezet.
- 300 echte gesimuleerde P1-inputverwerkingen en 200 statuslezingen veroorzaken geen aanvullende WAF- of batterijplanberekening binnen de cacheperiode.
- De bestaande 1.2.2-batterijtest behoudt zijn 26 geslaagde scenario’s voor invoer, herstart, planning en single/dual-publicatie.
- Syntaxcontrole, JSON-/versieconsistentie en zip-integriteit zijn gecontroleerd. `lib/ems-engine.js`, batterij-nachtplanner, EV-planner, instellingenpagina en widget-HTML zijn byte voor byte gelijk aan de 1.2.2-basis.

Resultaten: `validation/tests-1.2.3.json`, `validation/waf-continuity-1.2.3.json`, `validation/syntax-1.2.3.json` en `validation/release-1.2.3.json`.

**Alle functionele controles gebruiken gesimuleerde Homey-I/O, tijd, timers en DOM. Er is geen fysieke Homey, omvormer of batterij aangestuurd, geen visuele browsertest uitgevoerd en geen Homey-CPU-percentage gemeten.**

Uitvoeren:

```sh
npm test
node test/waf-continuity-1.2.3.test.js
```
