# HomeFlux EMS 1.1.3: wisselend zonladen en zon- en netladen

## Bevestigde oorzaak en ingreep

Uitgangspunt is de eerder geleverde HomeFlux-EMS-v1.1.2.zip. De uitgepakte app.js en lib/ems-engine.js zijn bytegelijk aan de onderzochte 1.1.2. Er is geen bewijs voor twee tegenwerkende regelaars. `pv_charge` en `grid_and_pv_charge` blijven labels binnen `baseMode === 'charge'`.

Drie onnodige werkzaamheden zijn bevestigd:

1. `shouldRunFastEvaluation` stuurde iedere import/export-zonewisseling direct naar de volledige evaluator. Bij begrensd laden gaf dit in vijf virtuele minuten 35 snelle evaluaties en geen enkele batterijpublicatie. De laadroute probeert nu bij gelijkblijvende veiligheids-, EV-doel- en adaptieve toestand de bestaande numerieke feedbackpreview. Alleen exact gelijke afzonderlijke berekende én bevestigde batterijcommando's laten de evaluatie vervallen. Daarna kan de bestaande beperkte cache herhaalde, reeds bewezen meetparen afvangen. De zonecontrole blijft bestaan.
2. `requestEvaluate` bepaalde pas na de feedbackpreflight dat het commando-interval nog liep. Nu berekent deze functie diezelfde grens vooraf. De goedkope beslisroute blijft lopen; waar een laadpreview nodig zou zijn, wordt de voorbereiding uitgesteld tot de bestaande timer. Dit is geen bewijs om de aanvraag weg te gooien: de preflight retourneert juist dat een evaluatie nodig blijft, en de normale timer/coalescing behoudt de nieuwste invoer. Er zijn geen timers, intervallen of veiligheidsuitzonderingen veranderd.
3. `canSkipBatteryFeedback` bouwde evaluatiestatus op voordat bleek dat de memo nog bij de vorige uitgangstoestand hoorde. `getBatteryFeedbackOutputDependencies` controleert nu eerst het laatste totale en afzonderlijke vermogen en de efficiëntiestatus. Een verworpen memo leidt gewoon naar de bestaande evaluatie. De memo wordt niet achteraf als bewezen bijgewerkt bij een nieuw of mislukt commando. Ook een kandidaat die al van de bevestigde uitvoer verschilt hoeft geen onbruikbare preview te krijgen.

Een lokale preflight-status kan bovendien door `evaluateFastNow` worden hergebruikt wanneer deze direct in dezelfde synchrone aanvraag en dezelfde milliseconde volgt. Het settingssnapshot wordt in diezelfde aanvraag gedeeld. Deze gegevens worden nooit op de app of in een timer bewaard. Een later tijdstip, directe losse evaluatie of timeraanvraag bouwt de status opnieuw op. Geen nieuwe brede statuscache.

De vermogensallocator, planningengine, settingscache, P1-meetbronselectie, commandogates en publicatieafhandeling zijn niet gewijzigd. De bestaande bronweergave gebruikt na een bewezen skip de reeds aanwezige trage verversing. Daarom kan een bronlabel later zichtbaar veranderen dan in 1.1.2; er is geen wijziging van een batterijcommando nodig om dat label te verversen.

## Bewust behouden volledige evaluaties

Geen skipbewijs bij onder meer gewijzigde individuele commando's, gewijzigde SoC/structurele afhankelijkheden, een verlopen minuut-/tariefbewijs, gewijzigd regeldoel of adaptieve overgang, ruwe of voorspelde piekdruk, ongeldige input/uitvoer, Hybrid-eigenaarschap en relevante pending-/Split-/efficiëntieovergangen. Force-aanvragen blijven via de bestaande route lopen. De bestaande intervalgrens, publicatiemutex, veilige stop en gedeeltelijke/mislukte publicatieafhandeling zijn behouden.

Een numerieke preview kan in een veranderende situatie nog door een volledige evaluatie worden gevolgd. Er is geen generiek hergebruik van allocatorresultaten toegevoegd: engine-normalisatie, Peak Guard en uitgangsovergangen blijven eigendom van de bestaande code.

## Meting

Werkelijke `process.cpuUsage()` (user + system), Node v24.19.0 in deze container. Per scenario en versie zeven afzonderlijke processen, 180 seconden virtuele opwarming gevolgd door 300 seconden virtuele meting. Versies en scenario's worden afwisselend uitgevoerd; ieder proces wordt afgewacht. Productie-initialisatie, settings/cache, planning, regelroutes en uitvoergates zijn gebruikt. Alleen Homey-I/O en tijd zijn gesimuleerd. Functietellers draaien in beide versies; gedetailleerde V8-coverage is niet gebruikt voor de CPU-cijfers. Geen wall-time als CPU-bewijs.

De eerder genoemde absolute referentietijden zijn niet rechtstreeks met deze run vergeleken: onderstaande vergelijking meet beide versies opnieuw in dezelfde omgeving. De cijfers zijn geen gemeten Homey CPU-percentage.

| Scenario | Proces-CPU ms 1.1.2 → 1.1.3 | Verschil | Snelle evaluaties | Evaluatiestatussen | Previews | Batterijpublicaties | Statuspublicaties |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stabiel zon/net | 74.680 → 73.226 | -1.9% | 6 → 6 | 15 → 7 | 0 → 0 | 1 → 1 | 6 → 6 |
| Stabiel, vaste laadlimiet | 69.333 → 64.416 | -7.1% | 5 → 5 | 7 → 7 | 1 → 1 | 0 → 0 | 5 → 5 |
| Bron wisselt, vaste laadlimiet | 166.196 → 114.046 | -31.4% | 35 → 5 | 40 → 20 | 0 → 10 | 0 → 0 | 30 → 10 |
| Wisselende PV, echte correcties | 454.354 → 184.300 | -59.4% | 44 → 44 | 256 → 49 | 0 → 2 | 42 → 42 | 88 → 88 |
| Geleidelijk wisselende PV | 469.269 → 213.179 | -54.6% | 40 → 40 | 265 → 55 | 10 → 10 | 35 → 35 | 80 → 80 |
| Zelfde bron, wisselende meetwaarden | 204.136 → 209.571 | +2.7% | 5 → 5 | 74 → 74 | 64 → 64 | 0 → 0 | 10 → 10 |

Dezelfde-bronproef toont geen aantoonbare verbetering: het berekeningsaantal blijft gelijk en de mediane CPU is 2,7% hoger in deze herhalingen. De optimalisatie richt zich op bewezen overbodig werk bij bronwisselingen en tijdens commando-intervallen. Alle ruwe CPU-herhalingen staan in de bijgevoegde JSON.

Bij abrupt wisselende PV blijven 44 snelle evaluaties en 42 noodzakelijke batterijpublicaties behouden, maar statusopbouw daalt van 256 naar 49. De laadpreflight wordt 309 keer licht uitgesteld tijdens het bestaande interval; 37 verouderde uitgangsmemo's worden vroeg herkend en twee statussen worden synchroon hergebruikt. Bij geleidelijk wisselende PV daalt statusopbouw van 265 naar 55. Planningberekeningen zijn in alle meetvensters nul in beide versies; bestaande contextverversingen blijven op dezelfde tijdstippen lopen. Dubbele zware planning is niet gevonden.

## Validatie

- Volledige `npm run check`: syntaxcontroles en 52 bestaande testsuites, plus de nieuwe productiecache-regressietest voor 1.1.3.
- Zes vijfminuten-zon/net-replays tegenover originele 1.1.2: exacte afzonderlijke batterijcommando's, publicatietijdstippen, contextmomenten en vastgelegde flexibele uitvoer gelijk.
- Dertien laadreplays: netladen, stabiel laden, ruis, extra PV/wegvallen PV, Peak Guard, gewijzigde planning, SoC/beschikbaarheid, laden/ontladen/rust, PV-live/adaptief, lopende/gewijzigde/veilige-stop-publicatie en transportfout. Afzonderlijke commando's, timing, planwaarden en geselecteerde P1-bronnen gelijk.
- 28 EV-replays: volledige batterij-, EV- en Split-publicaties inclusief tijdstippen, monsters, contextmomenten en eindtoestanden gelijk. Omvat Hybrid, ontbrekende/verouderde feedback, tariefwissels, Peak Guard en lopende EV-publicatie.
- Nieuwe gerichte test: herhaalde nuldoorgang bij vaste laadlimiet zonder volle evaluatie, ruwe Peak Guard, verouderde uitgangsmemo vóór statusopbouw, SoC-wijziging met eenmalige statusopbouw, nieuwste P1/SoC bij bestaande timer en verlopen bewijzen.
- Bestaande PV-brontests dekken duidelijke live/gemiddelde-verschillen, verlopen PV-live, onafhankelijke adaptieve regeling en ruwe piekbescherming. Settingscachetest controleert werkelijke startup en V8 fast properties.
- Engine/lib, settings, vertalingen, drivers en widgets bytegelijk aan 1.1.2. Alle 229 Flow-kaarten gelijk. Geen afhankelijkheden gewijzigd.

Twee bronstructuurtests zijn aangepast aan de extra lokale preflight-parameter; versietests zijn bijgewerkt naar 1.1.3. Er zijn geen controles op functionele uitkomsten afgezwakt.

## Diagnostiek en reproductie

Bestaande counters blijven behouden. Nieuwe counters:

- `fastChargeZoneUnchangedSkipped`: een zonewisseling heeft met de bestaande preview exact gelijke commando's bewezen.
- `fastChargePreflightDeferred`: zware laadvoorbereiding uitgesteld tot het bestaande toegestane commandomoment.
- `fastChargeOutputMemoRejected`: oude uitgangsafhankelijkheden vóór statusopbouw verworpen.
- `fastEvaluationStateReused`: status uitsluitend binnen dezelfde synchrone aanvraag hergebruikt.

`fastReasonFeedback` en `fastReasonZone` blijven aanvragen tellen, ook wanneer de bestaande timer ze coalescet; gebruik die tellers niet als aantal uitgevoerde berekeningen. `fastNoCommandChange` en `fastEvaluations` blijven werkelijk uitgevoerde snelle evaluaties tellen.

Gerichte test: `node test/source-switch-1.1.3.test.js`.
Eén CPU-replay: `node test/source-switch-cpu.cjs flip_cap` (eventueel `EMS_ROOT=/pad/naar/andere/build`).
Gepaarde benchmark: `python3 test/source-switch-benchmark.py /pad/naar/1.1.2 /pad/naar/1.1.3`.
Volledige controle: `npm run check`.

De app is als bronbuild opgeleverd, niet op een Homey geïnstalleerd. Praktijkbevestiging van de CPU-winst op Homey blijft nodig.
