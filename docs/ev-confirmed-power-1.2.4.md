# HomeFlux EMS 1.2.4 – EV-meetbronnen en Emergency-widget

Deze oplevering blijft versie **1.2.4** en is gebaseerd op de eerder aangeleverde volledige 1.2.4-broncode (ZIP-versie 20). Dit rapport beschrijft uitsluitend de laatste aanpassing en vervangt voor deze wijziging eerdere uitspraken over ongewijzigde meetfuncties.

## Oorzaak en correctie

De oude fysieke EV-boekingshelper kon na het verlopen van stroomfeedback terugvallen op de laatst gepubliceerde stroomopdracht. Mode kon bovendien een positieve Flow-stroom of de ingestelde Smart/Standard-stroom als daadwerkelijk aanwezig vermogen boeken. Bij meerdere Mode-EV’s kon dezelfde locatiebelasting zo onvoldoende onderscheidend worden behandeld. Een ingestelde of verzonden 10 A is geen bewijs dat de auto 10 A afneemt.

Een reproduceerbare oude situatie: P1 13.000 W, Peak Guard 17.500 W, marge 100 W en nulfeedback die na 60 seconden verloopt. Een opdracht van 6 A kon na het verlopen van de feedback als reeds aanwezig EV-vermogen worden geboekt, waardoor ten onrechte ruimte voor 10 A ontstond. De nieuwe productietest laat deze fictieve bijdrage op 0 W en de laadopdracht binnen de echte beschikbare 4.400 W.

| Sturing | Bron voor fysiek EV-vermogen / terug te tellen bestaande EV-belasting |
|---|---|
| Mode | Bestaande HomeFlux P1-detectie, gecorrigeerd voor PV, getekend batterijvermogen en huisreferentie |
| Current | Actuele via de bestaande status-Flow gerapporteerde stroom |
| Hybrid | Actuele via de bestaande status-Flow gerapporteerde stroom |

Nulfeedback blijft nul. Ontbrekende of verlopen Current/Hybrid-feedback geeft geen krediet voor reeds aanwezig EV-vermogen; de bestaande geldigheidsduur is 60 seconden. Een hogere opdracht creëert nooit fysieke meetfeedback. Het actuele P1-signaal en alle bestaande Peak Guard-, fase-, hardware- en veiligheidsgrenzen blijven bepalend. PV wordt niet nogmaals bij de netto P1-laadruimte opgeteld.

Mode hergebruikt de bestaande P1-handler en schrijft één kleine cache voor maximaal vier EV’s. De locatiebelasting bevat EV-verbruik; de bestaande huisreferentie wordt eenmaal afgetrokken. In een gemengde installatie wordt de verse Flow-belasting van Current/Hybrid eerst van de gemeten EV-pool afgetrokken. Onbekende concurrerende Flow-belasting blokkeert Mode-toewijzing. Meerdere Mode-EV’s delen de resterende pool één keer, met bestaande nominale vermogens als bovengrens en verdeelgewicht. Deze vermogens vormen nooit zelfstandig bewijs van verbruik. Een minimumlast en de bestaande detectiebevestiging/pauzevertraging blijven gelden.

**Beperking:** Mode blijft een begrensde schatting uit de woningmeting. Een gedeelde P1-meter kan individuele auto’s of gelijktijdige huishoudelijke veranderingen niet exact onderscheiden. De onderlinge verdeling is geschat en mag niet als afzonderlijke EV-meting worden beschouwd. Een hoge/onzekere huisreferentie kan conservatief tot 0 W krediet leiden; Flow-ampères omzeilen die Mode-beveiliging voortaan niet. De bestaande recente 60-seconden START-huisreferentie is in deze wijziging inhoudelijk ongewijzigd.

De EMS-statuswidget onderscheidt nu **Woningmeting: … W**, **Teruggemeld: … A** en **Opdracht: … A**. Daardoor wordt een ingestelde opdracht niet als gemeten laadstroom gepresenteerd.

## Emergency in de EV-widget

De Scheduler heeft een Emergency-knop, met dezelfde twee bewuste tikken, vijf seconden bevestigingstijd, annuleerregels en bescherming tegen dubbele verzending als de presets. Eerste tik wijzigt niets. Zonder doel of deadline is Emergency beschikbaar zonder fictieve planning.

ON roept de bestaande geregistreerde `set_evN_session_override`-listener aan met `mode: emergency`. Zoals expliciet gekozen, wordt een actief **widgetplan voor die geselecteerde EV** eerst beëindigd via de bestaande centrale `clearEvSocPlan`. Wissen en doorgeven aan de bestaande modehandler gebeuren zonder await-onderbreking in dezelfde JavaScript-beurt. Andere EV’s blijven onaangeraakt. Gewone Flow-doelen worden niet gewist en behouden hun bestaande prioriteitsregels. OFF kiest de bestaande Smart-modus en herstelt geen beëindigd widgetplan.

De widget toont bij Emergency 100% en geen misleidende standaarddeadline. Dit is de bestaande Emergency-modus, geen nieuwe SoC-stopregel: de auto/laadpaal en hun eigen limieten blijven bepalend. De widget verstuurt geen directe laadcommando’s. Bestaande planner, Flow-listeners, fysieke commandopublicatie en commandotiming zijn inhoudelijk behouden.

## Gerichte codecontrole

De gewijzigde bestaande appmethoden zijn: `updateEvPortfolioLoadDetection`, `getEvCommandedPowerW`, `updateEvStatusInput`, `getEvControlCurrentA`, `getEvGridImportControlStatus`, `getPublicStatus`. Nieuw is `getEvModeObservedPowerW`. `getPublicStatus` levert uitsluitend extra meetbron-/versheidsvelden voor de weergave. De overige wijzigingen koppelen de fysieke boekingshelpers aan de juiste bron en vernieuwen/invalideren de cache vanuit bestaande meetevents.

De hoofdmodules voor EV-planning, batterijregeling, huisreferentie, centrale energieboekhouding/Savings en nachtplanning zijn bytegelijk aan de uitgangscode. Ook Flow-kaarten, drivers, widgetvoorbeelden en korte release notes zijn behouden. Er is geen nieuwe planner, polling, energierecorder of periodieke timer toegevoegd. Het bestands- en methodeoverzicht en de SHA-256-waarden staan in `validation/ev-confirmed-power-source-audit-1.2.4.json`.

## Testresultaten

- De volledige bestaande en uitgebreide suite: **97 testbestanden geslaagd, 0 mislukt, 0 overgeslagen** (`validation/ev-confirmed-power-suite-1.2.4.json`). Na de laatste cache-optimalisatie zijn de gerichte meetbron- en detectieregressies opnieuw geslaagd.
- Nieuwe meetbrontests: **18 groepen**, waaronder alle drie sturingstypen in Emergency/Smart/SoC, verouderde feedback, afwijkende opdracht versus meting, meerdere en gemengde EV’s, PV/batterij, configuratieverversing en disconnect.
- Nieuwe Emergency-tests: **7 groepen**, waaronder bestaande handler, geen doel, widgetplan beëindigen, EV-isolatie, Smart terugschakelen, Flow-doel behouden, invoerfouten en deduplicatie.
- Widget UI: **33 tests**, inclusief NL/EN Emergency en bevestiging in de echte widget-JavaScriptcode met gesimuleerde DOM.
- Zeven bestaande Flow-snapshots vóór/na zijn identiek bij gelijke fysieke feedback; de daadwerkelijke EV-plannermodules zijn ongewijzigd. De huidige-bronvergelijking is opnieuw uitgevoerd met de vorige ZIP als basis.
- De huisreferentie-, centrale energieregistratie-, Savings-, batterij-, Peak Guard-, WAF-, deadline- en eerdere EV-tests slagen binnen de volledige suite.

Enkele oude tests veronderstelden bewust een opdracht als fysieke terugmelding of gebruikten een oud tijdstip als ‘verse’ feedback. Die fixtures zijn aangepast aan echte P1-detectie of verse Flow-feedback, en verwachtingen voor fictief krediet zijn expliciet 0 W geworden. Een oude Mode-test die positieve Flow-feedback gebruikte om een onzekere huisreferentie te omzeilen, verwacht nu conservatief gedrag; de aparte test met juiste huisreferentie blijft gedeeltelijke werkelijke EV-belasting controleren. Er zijn geen tests stilzwijgend overgeslagen.

Alle bovenstaande tests gebruiken echte productiefuncties met gesimuleerde Homey-I/O en een virtuele klok waar nodig. **Niet uitgevoerd:** fysieke Homey Pro 2019/2023, echte laadpaal/auto, installatie-/praktijkproef en visuele controle in een echte Homey Dashboard-browser. De ZIP-controle betreft broncode, manifesten en archiefintegriteit; er wordt geen fysieke certificering geclaimd.

## CPU en geheugen

Vergelijking in Node, drie afwisselende vóór/na-runs, 1.500 opwarmstappen en 400 gemeten P1+PV-stappen per run. Werkelijke Flow-feedback is in beide versies gelijk; de commandowaarde verschilt bewust van de gemeten stroom.

| Scenario | Mediane CPU vóór | Mediane CPU na | Contexten vóór/na | Uitgangsevents vóór/na | Ingeplande timers vóór/na |
|---|---:|---:|---:|---:|---:|
| 1 EV, mode | 681.601 ms | 755.934 ms | 7/7 | 0/0 | 7/7 |
| 4 EV, mode | 1438.483 ms | 1067.328 ms | 7/7 | 0/0 | 7/7 |
| 4 EV, current | 992.431 ms | 939.363 ms | 7/7 | 0/0 | 7/7 |

Alle diagnostische tellers zijn per vergelijkingspaar gelijk, inclusief fast-evaluaties, portfolio-/instellingenberekeningen en feedbackevents. De extra Mode-cache is 153 bytes (één EV) of 201 bytes (vier EV’s) als JSON; dit is geen exacte V8-objectgrootte. Bij uitsluitend Current wordt geen Mode-cache aangemaakt. De mediane heapverandering na expliciete GC was voor/na respectievelijk -50.808/-51.560 bytes, -21.136/-24.472 bytes en -15.744/-17.088 bytes. Negatieve en variabele GC-delta’s zijn geen bewijs van geheugenbesparing.

De CPU-uitkomsten variëren sterk tussen runs: één Mode-EV is mediaan ongeveer 11% hoger (circa 0,19 ms extra per gesimuleerde P1+PV-stap), terwijl vier Mode-EV’s en vier Current-EV’s lager uitkomen. Dit onderbouwt **geen** algemene prestatiewinst of regressievrij CPU-gebruik. Er is geen fysieke Homey-CPU of langlopende geheugenmeting beschikbaar. Wel zijn geen extra evaluatierondes, commando’s of timers gemeten in deze scenario’s. Alle ruwe waarden staan in `validation/ev-confirmed-power-performance-1.2.4.json`.
