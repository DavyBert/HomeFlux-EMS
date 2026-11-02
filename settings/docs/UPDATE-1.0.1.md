# HomeFlux EMS 1.0.1 — batterijfeedback

## Wijziging

Een lichte controle vergelijkt de nieuwe batterijuitgang met de berekende kandidaat én alle werkelijk gepubliceerde batterijcommando’s. Deze controle deelt de feedbackformule, verdeling, SoC-begrenzing, Peak Guard-berekening en definitieve vermogensafronding met de engine. Alleen exact gelijke uitgangen mogen de volledige fast evaluation overslaan. Dit geldt voor self_consumption, avoid_import en solar_capture. Gepland/handmatig laden en stand-by houden hun bestaande evaluatiepad.

De vorige beslissing vervalt bij gewijzigde relevante invoer, instellingen, EV-doel, regelbron of context, en uiterlijk bij de volgende minuut- of tariefgrens. Actieve en voorspelde piekdruk, zonewissels, verse PV-live-signalen, adaptieve live-wissels, geforceerde evaluaties, onveilige invoer, wachtende/lopende publicatie en Split Command-moduswissels worden niet onderdrukt. Bij geconfigureerde Hybrid EMS wordt deze optimalisatie conservatief niet toegepast.

Iedere P1-invoer blijft de bestaande metingen, EV-lastdetectie, EV-importveiligheid en flexibele veiligheidscontroles doorlopen. De bestaande batterij-uitvoerintervallen blijven bepalend. De detectiesnapshot gebruikt voortaan dezelfde EV-doelcorrectie als de engine; ruwe P1 blijft beschikbaar voor Peak Guard.

Diagnostiek telt fastFeedbackUnchangedSkipped en fastReasonPeakTransition, fastReasonPeakActive, fastReasonZone, fastReasonEvTarget, fastReasonPvLive en fastReasonFeedback. Redenen tellen aanvragen, niet uitsluitend uitgevoerde evaluaties. De aparte CPU-sectie fast_feedback_preflight meet ook de nieuwe controle, zodat het werk zichtbaar blijft naast fast_evaluation.

## Aanleiding

Door de gebruiker aangeleverde casus: **2999 P1 → 2414 fast evaluates → 2413 zonder command change**. Dit zijn geaggregeerde tellers; de oorspronkelijke meetreeks/configuratie was niet beschikbaar voor een exacte replay.

## Validatie

- De volledige bestaande `npm run check` is geslaagd, inclusief batterij-, EV-, HVAC-, boiler-, Hybrid-, PV-live-, planning-, veiligheids- en publicatietests.
- Een aanvullende synthetische reeks met 2999 P1-metingen op 1 seconde, 580–620 W import en SoC onder de spaargrens gaf 50 volledige fast evaluations en 2949 overgeslagen evaluaties. De 50 hercontroles vallen op minuutgrenzen; de nuluitgang bleef gelijk.
- 1800 gegenereerde enginegevallen zijn volledig vergeleken met de originele v1.0.0-engine: identieke resultaten. Daaronder 900 vergelijkingen van de feedbackcontrole met de volledige engine, met verschillende modi, SoC’s, batterijenaantallen, profielen, vermogensstappen en limieten.
- Gerichte toegangstests: piek, exportzone, SoC, forecast, context, stale P1, uitgeschakelde sturing, laadtest, wachtende/lopende uitvoer, Split Command, Hybrid, PV-live, adaptieve live-regeling, EV-doel, gereserveerde belasting, geforceerde evaluatie en tijdgrenzen.
- Via echte app-Flow-handlers met gesimuleerd Homey-transport: Peak Guard inschakelen/opheffen, export opvangen en veilige nuluitgang bij stale P1. Het eerst toegestane commandomoment na zeven seconden bleef behouden.
- Athom-teksten en Flow-kaartdefinities zijn bytegewijs gelijk gebleven. Alleen de appversie veranderde in de manifests; README.md en changelog kregen de 1.0.1-release notes.

Validatie vond plaats in Node.js v24.19.0 met de bestaande Homey-simulatie. Er is geen fysieke Homey, batterij of laadpaal aangestuurd. De gemeten vermindering van volledige evaluaties is geen voorspelling van hetzelfde percentage totale Homey-CPU-winst. De aanvullende tests zijn buiten de distributie gehouden.

## Aanvulling: onafhankelijke EV-heartbeat (zelfde versie 1.0.1)

De bestaande minuut-heartbeat voert ook een zelfstandige EV-portfolioevaluatie uit. Deze gebruikt de gedeelde EV-berekening en publicatiefuncties; batterij-, planning-, HVAC- en boiler-evaluatie wordt hiervoor niet gestart. Iedere EV behoudt zijn ingestelde minimuminterval, stopwachttijd en onderdrukking van ongewijzigde commando’s. P1-veiligheidsingrepen blijven via het directe pad lopen. Gelijktijdige EV-portfoliopasses worden geserialiseerd en een wachtende heartbeat leest de actuele gegevens opnieuw.

De algemene blokkade voor EV-verhogingen tijdens een uitgestelde batterijopdracht is vervangen door een beoordeling van de beschikbare fysieke ruimte. Wachtende en lopende batterijlaadopdrachten, inclusief Split Command-minimumvermogen, reserveren hun benodigde netruimte. Geplande toekomstige batterijontlading creëert geen fictieve ruimte voor de onafhankelijke EV-start. De gewone Split Command-batterijregeling zelf is niet gewijzigd.

Aanvullend gesimuleerd met de aangeleverde configuratie: emergency start via de heartbeat bij batterij sparen, 0 W berekend en 100 W Split Command-minimum, ook tijdens een lopende batterijpublicatie. De test bevestigt behoud van het 900-secondeninterval, geen herhaling van gelijke opdrachten, onmiddellijke P1-piekdetectie/veiligheidsstop, geen fictieve toekomstige batterijondersteuning, reservering van pending/in-flight laden, stop bij stale P1, verse tariefkeuze, alle vier EV-slots en current/hybrid/mode-uitvoer, stopwachttijd en gelijktijdige dispatch.

De volledige `npm run check` en de eerdere feedbackcontroles zijn opnieuw geslaagd. Geen fysieke hardware aangestuurd. De nieuwe tests blijven buiten de distributie.
