# Controle fast control — HomeFlux EMS 1.0.6

## Basis en conclusie

Uitgangspunt: de nieuw aangeleverde `HomeFlux-EMS-v1.0.6(1).zip`. Onderzocht: de diagnostics-bestanden `Geplakte tekst(20261004-121554).txt` en `Geplakte tekst(20261004-121650).txt`. De appversie blijft 1.0.6.

Er zijn twee fouten met gerichte regressies aangetoond:

1. `shouldRunFastEvaluation` sloot `charge` uit van de feedbackmodi. De engine gebruikt bij gepland laden juist een laadvloer met live P1-feedback. Binnen een ongewijzigde import-/exportzone kon de scheduler die vereiste feedback vóór evaluatie blokkeren, zelfs bij honderden watt afwijking.
2. Een geforceerde aanvraag die moest wachten op de commando-cooldown eindigde in een timer die `requestEvaluate(false)` aanriep. De force-vlag ging verloren. Bij een stabiele meterwaarde kon die timer vervolgens zonder evaluatie verdwijnen, terwijl een geplande of SoC-gerelateerde correctie nog nodig was.

De reparatie beperkt zich tot de voorselectie en het behouden van de force-vlag in de bestaande timer. De centrale batterij-engine is bytegelijk aan de upload. Er zijn geen nieuwe regel- of pollingloops, geen afwijkende contractregels en geen versoepelde veiligheidsgrenzen toegevoegd.

De logs bewijzen niet welke afzonderlijke predicate iedere historische skip veroorzaakte: daarvoor ontbraken reden-counters en momentopnames. De twee fouten zijn bewezen in de aangeleverde code; de precieze koppeling met alle door de gebruiker waargenomen momenten blijft dus een gevolgtrekking, geen gemeten reconstructie.

## Wat de aangeleverde export werkelijk bevat

Beide logbestanden bevatten dezelfde onderstaande counters. De nieuwste export is gemaakt op 4 oktober 2026 om 14:15:47.490, tijdzone Europe/Brussels. De diagnostics-buffer startte om 14:13:45.104.

| Counter | Waarde |
| --- | ---: |
| gridInputs | 121 |
| fastRequests | 143 |
| fastSkipped | 130 |
| fastImmediate / fastEvaluations | 5 / 5 |
| fastScheduled | 2 |
| fastCoalesced | 6 |
| fastReasonZone | 12 |
| fastCommandChange / fastNoCommandChange | 4 / 1 |
| batteryCommandPublishes | 5 |
| contextEvaluations | 1 |
| errors | lege lijst |

`130 + 5 + 2 + 6 = 143`: alle aanvragen in deze export zijn ingedeeld als preflight-skip, onmiddellijke evaluatie, geplande timer of samenvoeging met een timer. Dit is een later meetbeeld dan de genoemde 15 gridInputs/17 fastRequests/17 fastSkipped zonder evaluatie. Dat eerdere nul-evaluatiebeeld is niet als afzonderlijke export in deze twee bestanden aanwezig.

`planning.events` is leeg in deze nieuwe sessie. De efficiëntiediagnose bevat wel uitgangen: om 14:15:29.644 is circa -2690 W over drie batterijen verdeeld. Dit toont een HomeFlux-publicatie, geen onafhankelijke bevestiging dat het batterijapparaat de opdracht fysiek heeft uitgevoerd. Een lege foutenlijst sluit een logische gate of een hangende externe Flow niet uit.

## Alle plaatsen waar fastSkipped wordt verhoogd

Er is precies **één** uitvoerende call: `app.js:requestEvaluate`, direct na een `false` uit `shouldRunFastEvaluation`. De eigenschap `fastEvaluationSkipped` wordt op dezelfde plaats opgehoogd. Een pauze, cooldown, coalescing of output-mutex verhoogt deze counter niet.

Hieronder staan alle `false`-paden van die predicate, inclusief hun duur en herstelgedrag.

| Voorwaarde | Wanneer | Duur | Kan nieuwe P1 het beëindigen? | Kan grote netafwijking blijven bestaan? | Beoordeling |
| --- | --- | --- | --- | --- | --- |
| Geen controlContext, controlRuntimeSettings of latestResult | Initialisatie of ontbrekende/mislukte context | Tot een contextpass slaagt; geen vaste warm-upduur of harde timeout | Niet door de gewone predicate zelf; grid-herstel vraagt wel direct context aan, geforceerde evaluatie vraagt ontbrekende context ook aan | Ja, zolang context werkelijk ontbreekt | Logische prerequisite; geen langdurige startup-wachttimer gevonden. Fout in contextbouw kan herstel elders nodig maken |
| Geen geldige fast snapshot | Niet-finite interne gridwaarde | Tot geldige gridwaarde | Ja | Ja, maar HomeFlux heeft dan geen bruikbare meetwaarde | Veilig bedoelde gate. Ondersteunde Flow/API-inputs weigeren NaN/lege/null/boolean waarden vóór verwerking |
| Geen feedbackmodus, geen actuele Peak Guard-druk en geen peak_shave-override | Stand-by of vaste handmatige laadmodus; vóór reparatie ook charge | Tot modus-, zone-, piek-, live-PV- of andere relevante overgang | Gewoon blijven binnen dezelfde zone hielp vóór reparatie niet, ook niet bij een grote delta | Ja, bij gepland laden een fout; bij stand-by bewust 0 W, bij handmatig laden bepalen vermogenslimieten de vaste opdracht | `charge` toegevoegd aan de feedbackmodi; overige modussen behouden |
| Exact ongewijzigde batterijfeedback-preview | Buiten nulband, met bruikbare memo voor self_consumption/avoid_import/solar_capture | Alleen zolang alle memo/context/input/tijdvoorwaarden en alle uitgangen exact overeenkomen; uiterlijk tot volgende lokale strategie-minuut/contextgrens | Ja, zodra preview/output/dependency verandert | Ja, bijvoorbeeld bij volledig bereikte laadlimiet of SoC-grens waar nog meer vermogen onmogelijk is | Bedoeld. Er vindt hier al een lichte batterijberekening plaats; fastSkipped betekent dan geen volledige EMS-evaluatie |
| Geen zone-/piek-/EV-target-/live-PV-/adaptive-overgang en delta onder signaaldrempel | Gewone stabiele meterruis; bij feedbackmodus vooral binnen nulband | Tot voldoende verandering of geforceerde pass | Ja | Kort mogelijk wanneer raw P1 afwijkt maar het gekozen gemiddelde nog binnen de band ligt | Bedoelde filtering. Drempel max(50 W, commandDeadbandW, batteryCommandStepW); persistent geselecteerd export/import krijgt nu ook in charge feedback |

`force=true` passeert deze predicate altijd, maar kan de operatorpauze, outputinterval, SoC-limieten, Peak Guard en outputveiligheid niet omzeilen.

## Startup en diagnostics-start zijn verschillende gebeurtenissen

Er zijn geen aparte appReady/runtimeReady-vlaggen die een normale P1-evaluatie blokkeren. Het gaat om aanwezigheid van context/runtime-settings/latestResult. `onInit` maakt die context aan na instellingen, tokenregistratie, Flow-registratie en timerregistratie. Tussen Flow-registratie en de eerste contextbouw staat geen extra asynchrone warm-up-wachtstap; contextbouw zelf is synchroon binnen `runContextEvaluation`.

Vóór Flow-registratie kan tokenregistratie asynchroon wachten op Homey. Dat is geen pad dat via de nieuw geregistreerde grid-listener tegelijk tientallen fastRequests produceert. Een eerste geldige of herstelde meterwaarde met actieve sturing vraagt onmiddellijk context aan. PV/forecast zijn gedegradeerde informatie, geen harde vereisten voor veilig regelen op P1. Onbekende SoC sluit betreffende batterijen uit; alle onbekende SoC leidt tot geen actieve batterijregeling. Nieuwe gewijzigde SoC forceert evaluatie.

`startDiagnosticsSession` maakt een nieuwe buffer, met een nieuwe `runtimeStartedAt`, zonder de bestaande controlContext te verwijderen. Gelijke startedAt/runtimeStartedAt in de export bewijst dus geen app-herstart. Toegevoegd zijn passieve velden `session.appStartedAt` en `session.appInitializedAt`, zodat volgende exports dit onderscheid kunnen maken. Die timestamps introduceren geen nieuwe ready-gate.

Een mislukte contextbouw heeft geen afzonderlijke harde timeout. De normale startup is gereproduceerd en levert direct context; een lange init-gate is in de onderzochte log niet bewezen. Er is daarom geen nieuwe startupregeling of retryloop toegevoegd.

## Timers, planning en command-state

| Onderdeel | Gate en maximale/normale duur | Rol van nieuwe input en grote afwijkingen |
| --- | --- | --- |
| commandIntervalSeconds | `requestEvaluate` wacht tot max(nextCommandAllowedAt, lastEmitAt + interval). Alleen een daadwerkelijk gestarte publicatie reserveert dit interval; hier 5 seconden | Eén timer, nieuwste P1 bij afloop. Nieuwe inputs verplaatsen de deadline niet. Een nieuwe echte publicatie kan de grens wel opschuiven |
| Coalescing/debounce | Bestaande timer geeft fastCoalesced; geen debounce die bij elke P1 opnieuw 5 seconden wacht | Nieuwe inputs vervangen de te gebruiken meetstaat, niet het tijdstip. Force-vlag wordt nu toegevoegd aan dezelfde timer en blijft behouden bij opnieuw wachten |
| Geforceerde pending evaluatie | Vóór reparatie werd force bij callback gewist en kon de aanvraag onbeperkt wachten op een volgende trigger | Hersteld met controlTimerForce. Werkt ook binnen de nulband, bij samenvoeging en een later gereserveerde commandogrens. Annulering/pauze/test/stop wist de vlag |
| commandPublishing | Alleen async outputserialisatie; evaluateFastNow blijft toegestaan | Een volgend resultaat blijft latest-wins pending. Token/Flow-promises hebben hier geen eigen harde timeout. Langdurige externe vertraging kan output vertragen, maar verklaart geen nul fastEvaluations met uitsluitend fastSkipped |
| pendingResult/safety stop | Geen preflight-skip-lock; een pending resultaat of actieve publisher verbiedt juist memo-skipping | Veiligheidsstop heeft voorrang en mag interval bypass’en; niet de publishing mutex |
| Slow context/planning | Slow cadence hier 240 s, planningminimum 5 min. Eén contexttimer; planning behoudt eerdere geldige plan | Deze timers blokkeren de fast battery-evaluatie niet. De gereproduceerde blokkade was de charge-predicate, niet een planningmutex |
| Laden uit net en zon | Dit is een action/presentatielabel; regelmodus blijft meestal charge | Plan blijft laadvloer. Export kan extra laden vereisen; onverwachte import kan eerdere extra PV-capture terugnemen, tot de bewust ingestelde laadvloer |
| Efficiëntie/rotatie | Sticky batterij- en aantalkeuze plus geleidelijke herverdeling. Eventuele vervolgpublicatie op normale commandogrens | Outputlaag schaalt eerst de bestaande mix naar het nieuwe totale vermogen. Ramp beperkt de verdeling tussen batterijen, niet de totale P1-correctie; geen fastSkipped-lock |
| Split Commands | Eigen richtingbevestiging/minimumtijden en 1 s tussen mode/power | Kunnen daadwerkelijke output beperken, maar niet de fast-request predicate. Alle split-outputs staan in deze configuratie uit |
| Operatorpauze | In deze log 23:58–00:01, dus niet actief om 14 uur | Nieuwe P1 heft een bewuste pauze niet op. Resume-timer bepaalt herstel. Nu apart als fastPaused geteld; geen fastSkipped |
| Hybrid EMS | Ownership kan output bewust aan externe EMS laten | Niet actief in deze log. Memo-skipping is bij geconfigureerde Hybrid juist uitgesloten; Peak Guard/watchdog behouden bestaande overname |

Er is geen andere globale mutex die `fastSkipped` ophoogt. Status-, EV-, HVAC- en PV-publicatiemutexen zijn afzonderlijke outputpaden. Volledige evaluatie is synchroon; er is geen afzonderlijke pending-fast-evaluation Promise-lock.

## Signaalselectie en grenzen

`gridControlWindowSeconds=5` betekent in deze versie **de laatste vijf ontvangen meetwaarden**, niet een wachttimer van vijf seconden. Tijdens een overgang kan dat gemiddelde enkele inputs achterlopen. Bij minder frequente inputs kan die overgang langer duren. Raw P1 blijft voor Peak Guard beschikbaar.

Adaptive live control is geen toelatingsvlag voor evaluatie. Het kiest tussen gemiddelde en live P1. De log bevat adaptiveSetpointDeltaW=800 en adaptiveSetpointWindowSeconds=60; twee voldoende grote veranderingen binnen dat venster kunnen de live-selectie activeren. De PV-delta-selectie gebruikt hier 25 W. Een niet-actieve adaptive-selectie mag met de reparatie geen blijvende charge-gate meer veroorzaken.

De nulband [-20,20] is de geselecteerde regelband. `commandDeadbandW=25` geldt voor het totale groepssetpoint, niet per batterij. Buiten de raw nulband mag iedere echte berekende totaalcorrectie vanaf 1 W door de bestaande outputfilter; batterijstappen, laadruimte, SoC, vermogenslimieten en Peak Guard blijven toepasselijk. Bij import geldt tijdens charge nog steeds de geplande laadvloer: HomeFlux hoeft doelbewuste netlading niet naar 0 W te reduceren.

## Diagnostische interpretatie na de wijziging

- fastSkipped: aanvraag vóór volledige evaluatie afgewezen.
- fastSkipContextUnavailable / fastSkipInvalidGrid / fastSkipNonFeedbackMode / fastSkipStableSignal: concrete categorie van dat besluit.
- fastFeedbackUnchangedSkipped: bestaande lichte preview bewijst exact dezelfde veilige outputs; valt onder fastSkipped.
- fastPaused: bewust operator-pauzevenster, apart van fastSkipped.
- fastScheduled / fastCoalesced: één wachtende evaluatie, geen weggegooide aanvraag.
- fastEvaluations: volledige fast-pass betreden. Deze kan nog context/safety/pauze afhandelen.
- fastCommandChange: publiceerbare berekende wijziging; de queue kan nog wachten/serialiseren.
- fastNoCommandChange: fast-evaluatie uitgevoerd, maar geen reguliere outputwijziging aangevraagd; kan ook niet-publiceerbaar of gedelegeerd resultaat betreffen.
- batteryCommandPublishes: HomeFlux begint een publicatie; dit is geen hardware-ack.

De nieuwe counters gebruiken uitsluitend de bestaande optionele CPU-diagnostiek; bij uitgeschakelde diagnostiek worden geen extra counters of metingen geregistreerd en ontstaan geen extra timers of evaluaties. Er wordt geen normale runtime-logstroom toegevoegd.

## Verificatie en praktische grenzen

De nieuwe `test/fast-control-audit-1.0.6.test.js` gebruikt Homey-testdoubles met de echte Flow/API-inputs, scheduler, centrale engine, veiligheidsresultaat, outputqueue en publicatiemutex. Afhankelijkheidstimers zijn handmatig aangestuurd; er zijn geen echte batterijapparaten bediend.

Getest: -600 W export met charge (-1000 naar -1600 W), +600 W onverwachte import (-2000 naar -1400 W), dezelfde zone, aanhoudende export, efficiency aan/uit, vaste/TOU/dynamische uur- en kwartiercontracten, dag- en nachtfase, 5-inputsgemiddelde, stabiele nulband, laadlimiet zonder nieuw commando, behoud van bewuste planningsvloer, Peak Guard, cooldown/coalescing, geforceerde timer binnen nulband, force-upgrade van bestaande timer, later gereserveerde grens, outputmutex, init/context, operatorpauze, ongeldige meting, onbekende/full SoC en Hybrid ownership.

De oude regression-0.8.2-test die charge categorisch uitsloot is aangepast: charge moet bij buiten-band P1 de engine mogen bereiken; de echte planningsvloer en het ontbreken van een onnodige publicatie worden nu apart getest. De statische performance-check is aangepast aan de behouden force-vlag. De overige regressies blijven van toepassing.

Volledige syntax- en regressiecontrole: `npm run check`, 44 testsuites. Geen wijziging aan prijsparser/normalisatie, widgetkleuren, batterij-engine, Athom-webteksten, deprecated Flow-schemas of versienummers. De README blijft kort; alleen feature-notities onderaan zijn bijgewerkt. Fysieke Homey/Flow/batterijbevestiging blijft buiten deze lokale verificatie.

## Latere aanvulling binnen 1.0.6: stabiele laadselectie

Na deze fast-control-audit is op verzoek de laadselectie gespiegeld aan de bestaande ontlaadselectie. De eerdere vermelding van een bytegelijke batterij-engine geldt voor de fast-control-reparatie zelf; deze aanvullende feature past uitsluitend de rendementsverdeling bij laden aan. De laadende voorkeursbatterij blijft behouden tot haar SoC méér dan de ingestelde marge (minimaal 2 procentpunten) boven de laagste beschikbare batterij komt. Een apart laadgeheugen volgt de gepubliceerde commando’s tijdens een geleidelijke wissel; de grens is inclusief. Volle/onbeschikbare batterijen blijven uitgesloten en totaalvermogen, Peak Guard en overige laadplanning blijven leidend. De bestaande efficiëntiesuite bevat aanvullende engine- en publicatieregressies.
