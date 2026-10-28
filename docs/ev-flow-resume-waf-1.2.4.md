# HomeFlux EMS 1.2.4 – Flow-doel na disconnect en onafhankelijke WAF

Deze vervolgcorrectie is gebaseerd op de laatst beschikbare volledige ZIP: HomeFlux EMS 1.2.4, opgeslagen versie 21, SHA-256 `832aceb483f3494a45f860d26ddcae7c04214b531864b02402e2e7308775b505`. Het appversienummer blijft **1.2.4**. Alle eerdere correcties, inclusief meetbronselectie voor Peak Guard en de Emergency-widgetknop, zijn behouden.

## Gevonden oorzaken

1. `ev-plan-options.install()` bewaarde bij het aanmaken van een widgetdoel alleen de bestaande gewone Flow-**modusoverride** (`resumeMode`). Het centrale SoC-/kWh-doel werd vervangen en de oorspronkelijke invoerwaarden werden niet bewaard. `feedback()` beëindigde het widgetdoel correct na een bevestigde disconnect, maar `resume()` kon uitsluitend die modus herstellen. Het eerdere Flow-**planningsdoel** bleef dus weg.
2. `refreshPlanningInContext()` bouwde voor WAF een lijst van EV-reserveringen. `calculateBudget()` maakte de hele WAF ongeldig bij onbekende EV-behoefte/deadline (`ev_reservation_unknown`) of een EV-deadline voorbij de WAF-horizon zonder beschikbare laadslots (`ev_horizon_unknown`). Hierdoor kon een normale batterij-/huis-/zonbalans verdwijnen vanwege een niet-berekenbaar EV-plan.

De vóór/na-proef met de productiefuncties staat in `validation/ev-flow-resume-waf-before-after-1.2.4.json`: vóór de correctie was het plan na disconnect `null` en de WAF `ev_horizon_unknown`; erna is het oorspronkelijke Flow-doel **83% tegen 07:00, Gegarandeerd Ja** terug en toont dezelfde WAF-invoer **+3,0 kWh**.

## Gedrag van plannen

- Wanneer de widget een actief Flow-doel voor het eerst overneemt, worden uitsluitend de oorspronkelijke invoerwaarden bewaard: type SoC/kWh, doelwaarde, HH:mm en Gegarandeerd. Dit gebeurt vóór vervanging van het centrale doel. Het is geen tweede actieve planning en bevat geen aparte voortgangsadministratie.
- De kleine input-snapshot staat per EV als `resumePlan` in de bestaande `_evWidgetPlanRuntime`-instelling en overleeft een herstart. Latere wijzigingen aan het widgetdoel overschrijven die oorspronkelijke Flow-invoer niet.
- Een **bevestigde disconnect** na een echte verbinding beëindigt het widgetdoel en dient die bewaarde Flow-invoer opnieuw in bij de bestaande centrale `setEvSocPlan()` of `setEvEnergyPlan()`. Die voeren dezelfde validatie, deadlinekeuze, opslag, herbewapening en contextaanvraag uit als de bestaande Flow-listeners. Er is daarna één centraal actief doel, met eigenaar Flow.
- HH:mm wordt opnieuw door de bestaande invoerfunctie naar de juiste eerstvolgende lokale deadline vertaald. Een kWh-doel krijgt het volledige minimum voor de volgende echte laadsessie, conform de bestaande Flow-semantiek. Ook 0 kWh blijft een geldige, voldane doelwaarde.
- De reeds bestaande hervatting van de laatst ontvangen gewone Flow-modusoverride blijft behouden. Een expliciete nieuwe SoC-/kWh-Flow mag nog steeds direct het widgetplan vervangen. Een volgend widgetplan bewaart dan dát nieuwste Flow-doel.
- **Handmatig ‘Planning wissen’ blijft wissen.** Dit herstelt geen oud Flow-doel. Ook de expliciete Emergency-actie behoudt haar bestaande wisgedrag; een latere disconnect brengt dan geen oud doel terug. De bestaande Flow-wiskaart werkt hetzelfde.
- Pauze, nul stroom en onbekende/null connectie beëindigen het widgetplan niet. Een false vóór de eerste echte verbinding verbruikt een vooraf ingestelde widgetplanning niet. Een eerste expliciete disconnect na herstart beëindigt een eerder aangesloten widgetplan wel.
- Andere EV’s en bestaande Flow-plannen zonder widget blijven behouden. EV-identificatie en de dubbele widgetbevestiging zijn ongewijzigd.

**Overgangsbeperking:** de vorige build bewaarde een al overschreven Flow-doel niet volledig. Bij een widgetplan dat al vóór deze correctie actief was, kunnen verloren parameters niet betrouwbaar achteraf worden gereconstrueerd. Daar wordt geen doel voor verzonnen. Laat de gewenste Flow-planningskaart eenmaal uitvoeren **vóór een nieuwe widgetplanning**; vanaf dat moment kan het Flow-doel correct worden bewaard en na disconnect terugkomen.

## WAF zonder EV-planningsafhankelijkheid

De WAF rekent uitsluitend de bestaande balans van **niet-EV-huisverbruik, batterijbehoefte/reserve en resterende zon**. De verzamellus voor EV-plandoelen en -slots is uit de WAF-route verwijderd. Bekende én onbekende EV-reserveringen worden niet meer afgetrokken. De WAF hoeft geen EV-SoC, laaddeadline, prijshorizon of toekomstig laadslot te kennen en roept daarvoor geen EV-planner aan. Het bestaande diagnostische veld `evReservedKwh` blijft compatibel aanwezig met waarde 0.

De vijfminutenverversing blijft via de bestaande trage contextregeling lopen, vóór de eventuele batterijplanning. De bestaande dag-/nachthorizon, overgangen rond ochtend-/avonddoel, resterend vandaag en zonsondergang blijven behouden. Er is geen nieuwe timer, polling, device-read of energierecorder.

Essentiële WAF-invoer blijft vereist: geldige batterijgegevens, capaciteit en huisverbruiksbasis, en overdag een geldige resterende zonneprognose. Ontbrekende basisgegevens blijven eerlijk onbekend. Gepland netladen wordt niet als extra beschikbare energie meegeteld. EV-laadplanning, Max PV, Peak Guard en centrale energieboekhouding behouden hun eigen bestaande werking; deze wijziging verandert alleen hun afhankelijkheid richting de WAF.

## Gewijzigde functies en bestanden

Productie: `app.js` (`clearEvSocPlan`, `setEvSocPlan`, `setEvEnergyPlan`, `refreshPlanningInContext`), `lib/ev-plan-options.js` (input-snapshot en herstel) en `lib/widget-energy-budget.js` (geen EV-reserveringspad). De oorspronkelijke wisfunctie laat na succesvol herstel de centrale setter de persistente doelen en contextverversing afronden.

Documentatie/tests: `README.md`, dit rapport, `package.json` met de nieuwe test in beide bestaande testcommando’s, `test/ev-flow-resume-waf-1.2.4.test.js`, de expliciet aangepaste EV-reserveringsverwachtingen in `test/widget-insights-1.2.1.test.js` en bijbehorende validatieresultaten. De oude test die EV-kWh van WAF aftrok is vervangen door gelijkheid van de huishoudbalans bij bekende en onbekende EV-reserveringen; de overige formule-, veiligheids- en meetdatatests blijven aanwezig.

De EV-deadlineplannermodule, fysieke sturing/verdeling, commandopublicatie/timing, Peak Guard-meetbronnen, recente huisreferentie, batterijengine, nachtplanning, Savings/dagdata, energieallocatie, CSV, widgetcode, Flow-manifesten, drivers, vertalingen en korte release notes zijn bytegelijk aan de vorige ZIP. Een volledige bestands- en methodevergelijking staat in `validation/ev-flow-resume-waf-source-audit-1.2.4.json`.

## Tests

- **98 testbestanden geslaagd; 0 mislukt; 0 niet uitgevoerd binnen de bestaande suite.** Resultaat: `validation/ev-flow-resume-waf-suite-1.2.4.json`.
- **16 nieuwe productiefunctie-testgroepen**: alle combinaties SoC/kWh-Flow met SoC/kWh-widget, widgetwijzigingen, herstart vóór/na disconnect, handmatig wissen, Emergency, nieuwste expliciete Flow, ongeldige invoer, andere EV, modusoverride, nul/unknown/pauze, 0 kWh, voltooid doel, opnieuw aansluiten en oude widgetmetadata zonder verzonnen herstel.
- Echte contextuitvoering bij **fixed, TOU en dynamic_quarter** met aangesloten EV en onbekende SoC: WAF beschikbaar, exact eenmaal vernieuwd na vijf minuten en geen extra batterijplan. Een afzonderlijke gedwongen WAF-verversing laat alle EV-invoer-/plannerfuncties bewust falen als ze toch worden aangeroepen; die proef slaagt zonder EV-reads.
- De bestaande ochtend-/avond-/zonsondergang-/DST-continuïteitstests slagen. Ook de eerdere Peak Guard-meetbron-, Emergency-, batterij-, EV-, Savings- en energieboekhoudingstests slagen.
- **Zeven bestaande Flow-snapshots zijn vóór/na identiek** bij gelijke invoer. Dit geldt voor gewone Flow-planning, niet voor de bewust gecorrigeerde widget-disconnect en WAF-semantiek.

Alle tests gebruiken echte productiefuncties met gesimuleerde Homey-I/O en waar nodig virtuele tijd. Niet uitgevoerd: fysieke Homey Pro 2019/2023, echte laadpaal/auto, installatieproef of praktijkmeting op hardware. Er wordt geen fysieke certificering of gemeten Homey-prestatiegarantie geclaimd.

## CPU en geheugen

De bestaande Node-vergelijkingsproef gebruikt 1.000 opwarminputs en 600 meetinputs met twee EV’s. Vóór/na blijven alle gecontroleerde werkindicatoren gelijk: één extra contextevaluatie, nul extra uitgangsevents, en dezelfde aantallen gridinputs, fast-evaluaties, contexten, batterijplannen en WAF-berekeningen. De WAF-verversing zelf doorloopt geen EV-lus meer. De nieuwe opgeslagen invoersnapshot bevat maximaal vier kleine parameterrecords en verandert alleen bij een widgetplanactie/einde; er is geen nieuwe periodieke berekening.

CPU-tijd vóór/na: **337.965/380.794 ms**. Verstreken tijd: **303.166/342.181 ms**. Gemeten retained-heapdelta: **150112/135256 bytes**.

Dit is één containervergelijking met GC-/JIT-variatie; de cijfers bewijzen geen algemene CPU- of geheugenwinst. Fysieke Homey-CPU, langdurig geheugenverloop en installatiegedrag zijn niet gemeten. Ruwe meetwaarden en het resultaat van de Flow-vergelijking staan in `validation/ev-widget-regression-1.2.4.json`.
