# EV/batterijcorrecties binnen 1.1.9

## Basis en afbakening

Basis is de beschikbare 1.1.9-code met de SoC-doorlaadkeuze. De remote HEAD en main zijn opnieuw gecontroleerd en wijzen nog naar `2a0994756dfc8cd5c2ab4b3aa2ca9a611d4a98a3` (1.1.6). De lokale aangeleverde correcties uit 1.1.8 en de eerder gemaakte 1.1.9-uitbreiding zijn behouden. Er is niets gereset, gepusht of gepubliceerd en de versie blijft 1.1.9.

De oorspronkelijke audit is een vastlegging van de toestand vóór deze correctie. De oude auditassertions bevestigden foutgedrag; de nieuwe regressietests eisen juist de gewenste uitkomst.

## Oorzaak 1: toestemming en fysieke belasting werden gelijkgesteld

`markEvSessionEnded()` zette de sessielatch. `getEvMeasuredCurrent()` maakte vervolgens ook actuele stroomfeedback ongeldig. `getEvGridImportControlStatus()` sloeg de beëindigde sessie volledig over. Daardoor zag de batterijregeling het nog in P1 aanwezige EV-verbruik als gewone, te compenseren netafname.

### Correctie

- `getEvMeasuredCurrent()` bewaakt aansluiting, tijdstempel en de bestaande maximale meetleeftijd van 60 seconden. De logische sessielatch wist geen fysieke meting meer.
- Een kleine runtimeadministratie bewaart per EV de laatste daadwerkelijk toegestane laadverdeling. Deze komt uitsluitend uit de bestaande publicatieroutes, inclusief ongewijzigde geldige uitgangen. Een nieuwe kandidaat zonder gepubliceerde toestemming kan daarmee geen fictief restverbruik creëren.
- Na STOP of ingetrokken tarief-/netrechten kan deze verdeling alleen nog een verse, aanwezige fysieke belasting uit de batterijcorrectie houden. Ze komt niet in de laadallocator en geeft geen toestemming om opnieuw te starten.
- Een dalende stroommeting wacht bij de batterijboekhouding op een nieuwere P1-meting. Opeenvolgende dalingen verlengen de oorspronkelijke meetgeldigheid niet. Diagnosegegevens onderscheiden de actuele meting en de tijdelijk vastgehouden bijdrage.
- Loskoppelen kan uitsluitend de nog niet vernieuwde P1-meting overbruggen. Opnieuw aansluiten wist de oude administratie. Ontbrekende/verlopen stroomfeedback kan bij current/hybrid geen blijvende vrijstelling geven.
- Bij mode-sturing telt beschikbare positieve stroomfeedback direct mee. Zonder betrouwbare stroomfeedback kan alleen het eerder daadwerkelijk via P1 waargenomen modevermogen tijdelijk worden gebruikt, begrensd door live P1, de huisreferentie en maximaal 60 seconden. Dit wordt als afgeleid vermogen gelogd.

SoC-, kWh- en handmatige/Flow-voltooiing blijven hun bestaande stopuitgangen en sessielatch gebruiken. De SoC-doorlaadoptie blijft gewone Smart-regeling gebruiken; een daaropvolgende expliciete stop blijft definitief.

## Oorzaak 2: EV-PV en huishoudelijke batterijbijdrage raakten vermengd

Het gemeten EV-vermogen werd, afgezien van expliciete batterij-/nachtsteun, volledig als netgevoed geboekt. Tegelijk verwijderde de PV-poolberekening ook normale batterijondersteuning voor het huis. Daardoor kon herberekening huishoudelijke batterijondersteuning laten verdwijnen.

Ook de afronding op volledige ampère-/modestappen is relevant: een toegewezen PV-laadstap kan lager zijn dan het PV-vermogen dat een al ladende EV fysiek opneemt. Alleen het afgeronde `pvAllocatedW` aftrekken corrigeert het probleem niet volledig.

### Correctie

- De netvrijstelling trekt het aan de EV toegerekende PV-vermogen en expliciete batterij-/nachtsteun afzonderlijk af. Een hoger werkelijk EV-verbruik blijft beschermd als een lager setpoint/netbudget nog niet wordt gevolgd.
- De PV-pool onderscheidt gereconstrueerd huishoudelijk verbruik van EV-verbruik, wanneer actuele stroomfeedback voor de actieve EV's beschikbaar is. Alleen de reeds aanwezige, daarmee begrensde huishoudelijke batterijbijdrage wordt behouden. Batterijbijdrage aan de EV wordt daardoor geen PV.
- De bestaande verdeling blijft in laadstappen werken. Het overblijvende fysieke PV-deel binnen hetzelfde gedeelde budget krijgt een aparte boekhouding: `pvAttributedW`. Het wordt één keer over de EV's verdeeld, zonder extra laadvermogen of tariefrecht te verlenen.
- Mode/current/hybrid delen één PV-bovengrens. De gemeten PV-waarde begrenst de toerekening wanneer die volgens de bestaande vijfminutengrens actueel is.
- Een uit meetwaarden gereconstrueerde huisreferentie begrenst de EV-vrijstelling bij asynchrone metingen. Een negatieve of onbruikbare reconstructie vervangt de eerdere referentie niet. Tijdens de stopovergang wordt die referentie niet opnieuw geleerd uit de wegvallende EV-belasting.

De huisreferentie is een schatting uit P1, PV, batterijcommando en EV-stroom, geen afzonderlijke huismeting. De aan de EV toegerekende PV is evenmin rechtstreeks gemeten per laadpaal.

## Noodzakelijke meetbronafstemming

Een gemiddelde met oude EV-belasting mag niet worden vergeleken met uitsluitend de nieuwste, lagere EV-stroom. Tijdens een stop/daling gebruikt de bestaande meetbronselectie daarom tijdelijk live P1 (`live_ev_transition`), binnen de bestaande meetgeldigheid van 60 seconden.

Dit is een gerichte afhankelijkheid van de correctie. De P1-invoercadans, ingestelde batterij-/EV-intervallen, AutoTune, batterij-engine en publicatiegates zijn niet aangepast. Er zijn geen extra timers, polling of afzonderlijke regelkring toegevoegd. Buiten de overgang behoudt de bestaande PV-live/adaptieve/gemiddelde bronkeuze haar werking.

De snelle lus blijft dezelfde batterijregeling aanroepen. De extra administratie bestaat uit hoogstens vier EV-records; werk zonder actieve EV's wordt vroeg afgebroken.

## Validatie en bewijsniveaus

De nieuwe suite `test/ev-battery-transition-1.1.9.test.js` gebruikt de echte startup, Flow-invoer, context-/fast scheduler, allocator en publicatieroutes. Homey-I/O en tijd zijn virtueel. EV- en P1-feedback worden gecontroleerd aangeboden; dit is geen meting op een fysieke laadpaal/omvormer.

De oorspronkelijke twee gevallen zijn vóór de correctie opnieuw bevestigd. De nieuwe stop- en PV-regressies falen afzonderlijk op de ongewijzigde 1.1.9-basis. De oorspronkelijke auditlog en deze verwachte failures worden bij het bronpakket geleverd.

| Gecontroleerd geval | Vóór correctie | Na correctie |
| --- | --- | --- |
| STOP met nog circa 11.085 W EV-verbruik en 623 W huisverbruik | Berekende batterijontlading stijgt van 623 naar 6.000 W | Berekende batterijontlading blijft 623 W; STOP is gepubliceerd, fysieke feedback blijft geldig |
| Circa 11.085 W EV, 5.000 W PV en 623 W huisverbruik | Berekende huishoudelijke batterijbijdrage daalt naar circa 8 W | In de productiepublicatiereplay blijft circa 631 W gepubliceerd, binnen de bestaande regelmarge; actieve EV-netvrijstelling circa 6.085 W |

De 13 deterministische batterijscenario's zonder actieve EV zijn daarnaast vergeleken met de oorspronkelijke 1.1.9. Settings-/evaluatieaantallen, opdrachten, schedulertraces, contexten en samples zijn identiek. Dit is geen fysieke CPU-meting of garantie van identieke rekentijd tijdens EV-laden.

De aanvullende scenario's omvatten:

- SoC-, kWh- en Flow-stops voor current/mode/hybrid, met intervallen van 7 en 55 seconden.
- EV-feedback vóór P1 en P1 vóór EV-feedback, herhaalde feedback en het verlopen/ontbreken ervan.
- PV/netladen, veranderend PV tijdens een stop en het stoppen van één van twee EV's.
- Loskoppelen vóór de nieuwe P1-meting en opnieuw aansluiten.
- SoC-voltooiing naar Smart-voorkeuren, gevolgd door een expliciete stop.
- Ingetrokken tariefrechten, nul netbudget, expliciete batterij-/nachtsteun en Peak Guard.
- Mode-restbelasting zonder stroomfeedback, plus EV-laden zonder batterij en met batterij-EMS uit.

De bestaande suites blijven bovendien onder meer geselecteerde/niet-geselecteerde tarieven, alleen PV, vaste/dynamische/TOU-tarieven, vier EV's, Emergency, batterijgrenzen, publicatiefouten en CPU-optimalisaties controleren.

Eindcontrole: `npm run check` op de definitieve code is geslaagd (exit 0): syntaxcontrole en 59 suites, inclusief 33 aanvullende EV/batterijscenario's, 55 SoC-voltooiingsscenario's en 14 EV-batterijbeschermingsscenario's. De 13 vergelijkingsscenario's zijn deterministisch identiek aan de basis. `git diff --check` is geslaagd. De patch is toegepast op de broncode uit het eerder geleverde 1.1.9-zipbestand en reconstrueert alle bijgewerkte bronbestanden byte-identiek. Alle oudere changelogvermeldingen zijn behouden.

## Grenzen en fysieke bevestiging

- Een succesvol gepubliceerde opdracht bewijst niet dat de laadpaal of omvormer die heeft uitgevoerd.
- Bij ontbrekende/verlopen stroomfeedback is geen exact EV-restverbruik bekend. Mode-sturing zonder stroommeting blijft minder nauwkeurig, vooral met meerdere EV's of gelijktijdig veranderende huishoudelijke lasten.
- P1, PV, EV-stroom en batterijcommando hebben verschillende meet-/reactiemomenten. Als de bron oude waarden met nieuwe tijdstempels doorstuurt, kan EMS die vertraging niet betrouwbaar herkennen.
- Het batterijvermogen in deze installatie-interface is een commando, geen gegarandeerd gelijktijdig gemeten vermogen. Trage uitvoering kan de reconstructie tijdelijk vertekenen.
- Correcte fase- en spanningsinstellingen blijven nodig voor de omzetting van gemeten ampère naar vermogen. Er is geen automatische faseherkenning toegevoegd.
- De correctie verandert de ingestelde intervallen niet. Een bestaand commando kan nog tot de volgende toegestane publicatie blijven gelden; een fysieke belasting kan tussen twee metingen al wegvallen. Dat kan niet volledig met softwareboekhouding worden uitgesloten.
- Peak Guard blijft actuele P1 gebruiken. Als een laadpaal een reductie/STOP negeert, betekent een correct begrensde opdracht niet dat de fysieke netafname al onder de limiet ligt. De bestaande batterij-peakshaving kan daarbij expliciet ingrijpen.

Bevestig op een installatie met diagnosegegevens de stopuitgangen, gemeten EV-stroom, ruwe P1, geselecteerde meetbron, beschermde PV/restbelasting en de daadwerkelijke batterijrespons. De correctie wordt niet gepresenteerd als bewijs van Freds volledige eerdere tijdlijn.
