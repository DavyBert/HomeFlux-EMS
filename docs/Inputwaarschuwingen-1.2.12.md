# HomeFlux EMS 1.2.12 — inputwaarschuwingen

Oranje meldingen staan onder de bestaande EMS-beslissingsreden, naast de ongewijzigde WAF. Alleen gegevens die nodig zijn voor ingeschakelde regelingen of hun betrouwbaarheid worden gecontroleerd. De melding benoemt het betreffende toestel, de bekende ontvangstouderdom in afgeronde minuten en een herstelactie. Meer dan drie meldingen blijven toegankelijk via een uitklapbare samenvatting; opengeklapte meldingen blijven open bij verversen.

## Onderzochte grenzen en opvraagregeling

| Input | Bestaande opvraag/controle | Diagnose |
| --- | --- | --- |
| P1 | Externe push; bestaande harde geldigheid `max(60 s, 6 × batterij-stuurinterval)` | Dezelfde grens. Bestaande kritieke rode melding blijft voorop; de oranje duplicaat wordt verborgen zolang die kritieke weergave ingeschakeld is. |
| PV-vermogen | Flow-verzoek elke 15 s. Idle-optimalisatie vereist een ontvangst binnen 5 min, ook bij 0 W. Verschillende leer-/referentiefuncties hanteren 60 s. | Na 5 min zonder ontvangst een betrouwbaarheidsmelding; laatste waarde wordt niet ongeldig verklaard. Tijdens actief HVAC-leren wordt de reeds bestaande 60-secondenvoorwaarde voor dat leren vermeld. Een ontbrekende update bewijst geen nulproductie. |
| Batterij-SoC per batterij | Flow-verzoek elke 3 min. SoC blijft waardegebaseerd geldig; de idle-optimalisatie vereist ontvangst binnen 10 min. | Na 10 min een betrouwbaarheidsmelding per batterij. Geen uitsluiting uit de regeling en geen wijziging van SoC, doel of veiligheidsgrens. |
| EV-SoC | Flow-verzoek elke 3 min als SoC-ondersteuning aan staat; bestaande instelbare geldigheid 1–60 min, standaard 15 min. | Dezelfde ingestelde geldigheid, uitsluitend voor een actieve EV die SoC gebruikt. Geen SoC-melding bij uitgeschakelde SoC, een kWh-plan, Emergency of een afgehandelde/ongebruikte EV. |
| EV-laadstroom | Bestaande stroomfeedback is 60 s bruikbaar; geen aparte nieuwe opvraaglus. Modussturing gebruikt P1-schatting. | Dezelfde 60 s voor actieve Stroom-/Hybrid-sturing die laadfeedback nodig heeft. Geen stroomfeedbackwaarschuwing bij modussturing. |
| PV-forecast vandaag/morgen | Verzoek elke 30 min; bestaande geldigheid is kalender-/planningsdaggebonden, zonder algemene minutentimeout. | Alleen de gebruikte forecastrol; na 90 min zonder vernieuwing een informatieve melding over de betrouwbaarheid, geen nieuwe ongeldigheid. Ontbrekende dagdata krijgen na dagwisseling opnieuw kalendergratie. Een bewust vastgezette nachtmediaan wordt niet wegens ouderdom afgekeurd. |
| HVAC-ruimtetemperatuur | Ontvangsttimestamp, waardegebaseerd; geen bestaande harde vervaltijd. | Nieuwe **uitsluitend informatieve** grens `max(15 min, 3 × HVAC-regelinterval)`. Alleen wanneer de betreffende regeling de ruimtetemperatuur nodig heeft. |
| HVAC-buitentemperatuur | Eén gedeelde ontvangsttimestamp; waardegebaseerd, zonder harde vervaltijd. | Nieuwe **uitsluitend informatieve** grens `max(60 min, 3 × HVAC-regelinterval)`, gekozen uit de betrokken actieve toestellen. Alleen bij COP, buitentemperatuurrichting/-grenzen of fanregeling. Eén melding, met de betrokken toestellen. |
| HVAC-modus/setpoint | Stabiele toestandsinputs; legacy PV-regeling vereist ze als basisinput. | Alleen een ontbrekende noodzakelijke input na dezelfde HVAC-opstartgratie. Geen kunstmatige vervaltijd voor een onveranderde modus of setpoint. |
| Dynamische prijzen | Bestaande geselecteerde-bronstatus, actuele slotdekking, kalibratie en fallback bepalen bruikbaarheid. Een externe actuele prijs heeft bijvoorbeeld 20 min geldigheid; een bruikbare prijscurve heeft een andere geldigheid. | De bestaande geselecteerde bruikbaarheid is leidend. Geen generieke curve-timeout, geen waarschuwing uitsluitend voor een ongebruikte/verouderde secundaire bron terwijl de gekozen bron werkt. |

Ook onderzocht: gedateerde zonkansvoorspellingen en Hybrid-watchdogstatus. Er wordt geen ontvangstouderdom verzonnen voor gegevens zonder ontvangsttimestamp en geen wijzigingstijd van een setpoint als ontvangsttijd gebruikt. Hun bestaande kalender-/watchdoglogica en meldingen blijven bestaan.

Voor ontbrekende inputs wordt minimaal de toepasselijke opstartgrens afgewacht. Een nieuwe EV-verbinding gebruikt de bestaande sessie-verbindingstijd voor deze gratie. Bij een herstelde kalenderforecast zonder ontvangsttimestamp wordt geen fictieve ouderdom getoond; na de gratie verschijnt expliciet dat de ontvangsttijd onbekend is. Een verzoek vernieuwt nooit de ontvangsttijd.

## Plaatsing en afbakening

`lib/input-warnings.js` leest bestaande velden en timestamps. Alleen `widgets/status/api.js` roept dit aan bij de al bestaande widget-GET. Het widgetscherm ververst al iedere tien seconden zolang het zichtbaar is; daardoor verschijnt een melding ook zonder nieuwe Flow-input. Er is geen nieuwe timer, pollinglus of werk in P1, heartbeat, fast evaluation of planning.

De bestaande inputlisteners vernieuwen hun timestamps al bij iedere succesvol ontvangen geldige waarde, ook bij dezelfde waarde. Deze listeners zijn niet gewijzigd. Ook `app.js`, alle regelmodules, Laadstrategie, settings-interface, Flow-definities en appmetadata zijn byte-identiek aan de voorafgaande volledige 1.2.12. Versie, slogan en Athom-omschrijving blijven behouden.

Gewijzigd: nieuw diagnosebestand, statuswidget-API en -HTML, EN/NL-locales, bestaande release notes in README/changelog, testscripts en twee nieuwe gerichte testbestanden. Geen nieuwe instelling, Flow-kaart, notificatie of Logic-tag.

## Uitgevoerde controles

- `input-warnings-1.2.12.test.js`: 13 gerichte groepen voor periodieke gelijke waarden, uitblijven/herstel, opstartgratie, batterij-identificatie, EV-/HVAC-relevantie, huidige forecastrol, vastgezette mediaan, kalenderwisseling, prijsbronstatus, deduplicatie en zuiver lezen.
- `input-warnings-widget-1.2.12.test.js`: echte Flow-ontvangst van steeds dezelfde 0 W en SoC, herstel met identieke waarde, ongeldige ontvangst, widgetverversing zonder input, bestaande P1-prioriteit, vertalingen, uitklapbare meldingen en volledige gelijkheid van bestaande status-/WAF-velden. Geen extra regel-/planningsaanroep of timer bij widgetlezen.
- Bestaande gerichte regressies: `widget`, `waf-continuity-1.2.3`, `hvac-ui-1.2.7` en `features-1.2.9`: alle vier geslaagd.
- Volledige widget-DOM in Nederlands/Engels: plaatsing onder de reden, herstel, uitklappen en behoud bij verversing, P1-prioriteit en ongewijzigde WAF-waarde én -kleur.
- Syntaxcontroles op gewijzigde JavaScript, inline widget-JavaScript en JSON geslaagd.
- Hostmicrobenchmark met 8 batterijen, 4 EV's en 10 HVAC's: gemiddeld 0,013–0,028 ms per diagnoseaanvraag; ook bij 30 meldingen. Na 10.000 aanvragen bleef extra behouden heap in de meting onder 51 kB. Geen achtergrondwerk of extra regelberekeningen. Dit is geen absolute CPU-meting op Homey; meerdere zichtbare widgets voeren ieder hun bestaande GET uit.

De volledige regressiesuite en onaangeroerde batterij-, Laadstrategie-, EV-, boiler- en savings-algoritmetests zijn niet herhaald. Beschermde bronbestanden zijn gecontroleerd op gelijkheid met de volledige laatst aangeleverde 1.2.12; eerdere Laadstrategie-resultaten blijven in de ZIP aanwezig. Geen praktijktest op Homey uitgevoerd. Informatieve temperatuur- en forecastgrenzen zijn signaleringskeuzes, geen bewijs dat een sensor of laatste waarde fout is.
