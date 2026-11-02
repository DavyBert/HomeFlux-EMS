# Meerdaagse EV-planning en Max PV — HomeFlux EMS 1.2.4

Gebaseerd op de volledige laatst geleverde 1.2.4-broncode, inclusief de recente 60-seconden-huisreferentie bij een modus-START. Het versienummer blijft **1.2.4**. De korte Nederlandse/Engelse release notes en de tekstvrije widgetpreview zijn behouden.

## Reikwijdte na de laatste verduidelijking

**Alleen een via de widget gemaakte of aangepaste planning krijgt de nieuwe eigendom, voorrang en disconnect-levensduur.** Gewone bestaande Flow-planningen blijven hun eerdere werking behouden: hun doel blijft opgeslagen bij loskoppelen en wordt volgens de bestaande regels opnieuw gebruikt bij aansluiten. Historische opgeslagen plannen bevatten geen betrouwbare herkomst; die krijgen daarom geen verzonnen widget-eigendom. Een bevestigde widgetwijziging maakt de herkomst vanaf dat moment expliciet.

Tijdens een verbonden widgetplanning wordt de laatst ontvangen gewone HomeFlux Flow-modusoverride per EV bewaard, vóór herbewapening, statuswijziging, contextaanvraag of uitgangswijziging. De laatste wint. Bij wissen of bevestigde disconnect verdwijnt eerst het widgetdoel; daarna wordt de bewaarde override via **de bestaande `setEvSessionOverrideFor()`-verwerking** weer actief. Als er tijdens het plan geen nieuwe override binnenkwam, wordt de bij aanvang actieve override hervat, of anders de ingestelde modus. De bewaarde override en laatste weergavestatus overleven een herstart.

Een expliciete nieuwe SoC-/kWh-plannings-Flow mag een widgetplan onmiddellijk vervangen. De bestaande wiskaart, connectie-/stroomfeedback, expliciete sessiebeëindiging en veiligheidsstops blijven werken. Een bereikt widgetdoel blijft zichtbaar en beschermd terwijl de auto aangesloten is; er volgen geen onnodige laadopdrachten. Een verlopen deadline blijft vast en resulteert in wachten/STOP met een melding; het doel schuift niet naar morgen. Beëindigen gebeurt bij wissen of echte disconnect.

De broncode heeft gewone **modusoverridekaarten** (`smart`, `soc_target`, `emergency`), geen afzonderlijke algemene Start-, Stop- of stroominstelactie voor de EV. HomeFlux kan geen rechtstreekse laadpaalcommando's onderscheppen die andere apps of eigen Flows buiten HomeFlux versturen. De bestaande sessie-eindkaart is veiligheids-/sessiefeedback en wordt niet geblokkeerd.

## Gedeelde invoer en één bestaande planner

De controle vóór implementatie volgde de geregistreerde `SlotFlowCards`-listeners in `registerFlowCards()` tot `setEvSocPlan()` en `setEvEnergyPlan()`. De EV-widget roept nog steeds precies deze geregistreerde listeners aan. Hun publieke Flow-argumenten en kaartdefinities zijn ongewijzigd. Een uitsluitend intern optioneel metadataargument geeft widgetopties door aan dezelfde centrale invoerfuncties. SoC/kWh-validatie en opslag blijven gedeeld.

Lezen van het actuele centrale doel, combineren van één wijziging en synchroon valideren/opslaan gebeuren zonder `await` ertussen. Een deadlinewijziging kan daardoor geen verouderde doelwaarde terugschrijven. Request-ID-deduplicatie en de begrensde bestaande aanvraagcache blijven behouden. Niet-doelwijzigingen behouden reeds geleverde kWh; een expliciete nieuwe doelinvoer behoudt de betekenis van een nieuwe laadopdracht.

`EvDeadlinePlanner` is de enige deadlineplanner. Anders dan bij de eerste widgetintroductie zijn de invoerfuncties en deze planner in deze vervolgopdracht **bewust inhoudelijk uitgebreid** voor de gevraagde widgetopties. Dit wordt niet als een ongewijzigde planner gepresenteerd. De legacy Flow-only regressieproef blijft identieke uitkomsten eisen. Fysieke allocatie, hardwarelimieten, commandotiming en de Peak Guard-formule zijn niet aangepast.

## Deadline en bediening

- Standaard kiest bij indienen het bestaande eerstvolgende HH:mm. Max PV staat standaard uit. Bestaande Flow-/instellingenplanning blijft rollen zoals voorheen; een nieuw widgetdoel is één specifieke laadopdracht.
- Bij 1–7 dagen telt de backend op het moment van de tweede bevestiging het aantal **lokale kalenderdagen** bij de actuele Homey-datum. HH:mm blijft behouden. Bijvoorbeeld 27 oktober + 3 dagen, 07:00 → 30 oktober 2026, 07:00.
- De gekozen absolute timestamp, kalenderdatum, oorspronkelijke horizon, doel en opties worden bij het bestaande centrale SoC- of kWh-plan opgeslagen. Middernacht en herstart verplaatsen die timestamp niet.
- Datum en tijd kunnen samen binnen de bevestigde horizon worden aangepast. Ongeldige/verstreken deadlines, onmogelijke kalenderdatums en een niet-bestaande lokale zomertijdtijd worden vóór wijziging geweigerd. De bestaande tijdzonehelper verwerkt 23- en 25-uursdagen.
- Dagen, datum/tijd, Max PV, Gegarandeerd en wissen gebruiken de bestaande dubbele bevestiging van vijf seconden. Eerste tik wijzigt geen plan; andere keuze, EV-wissel of verlaten annuleert bevestiging. Onvolledige invoer blijft lokaal concept.
- Stabiele EV-ID's 1–4, bestaande selectie, instellingen en de optionele Planning/Inzichten-tabs blijven behouden.

## Dezelfde informatie in beide widgets

`ev-dashboard.plan()` maakt één centrale projectie met doel, absolute deadline en Nederlandse/Engelse datumlabels. De EV-widget en het bestaande EMS-statusantwoord gebruiken deze functie. De widgets berekenen zelf geen einddatum. Planningswijzigingen gebruiken het bestaande `homeflux.ev.changed`-event. De EMS-widget heeft daarvoor één weergavesubscriptie; bij een lopende statusaanvraag wordt één vervolgaanvraag samengevoegd, zodat een vroeg antwoord niet de laatste wijziging blijft tonen. Bestaande periodieke statusverversing blijft bestaan.

De compacte EV-statusregel blijft behouden. Daaronder staat het actieve doel met datum; de planning bevat de dagenkeuze, handmatige datum/tijd, Max PV en wissen. Voorlopige plannen worden aangeduid. De tijdelijke melding over een bewaarde Flow-override vervalt via CSS en veroorzaakt geen nieuwe timer. Light/dark CSS, bestaande sectiekeuzes en alle Insights-gegevens blijven behouden.

## Max PV en tarieven

`ev-plan-resources.js` levert uitsluitend gecachete invoergegevens aan de bestaande planner. Het is geen extra laadplanner of energierecorder.

De bestaande prognose bevat resterend vandaag en eventueel het volledige totaal van morgen; er is **geen uurprognose of volledige zevendaagse verwachting**. Daarom wordt een dagtotaal alleen gecrediteerd wanneer die hele prognosedag vóór de deadline ligt. Een morgentotaal wordt bijvoorbeeld niet volledig toegekend aan een doel morgen om 07:00. Werkelijk actueel PV-overschot blijft via de bestaande PV-route bruikbaar, ook wanneer de toekomstige prognose te grof is om krediet te geven.

Eén gedeeld budget reserveert eerst het bestaande niet-EV-huisverbruik, vervolgens batterijruimte en andere EV-doelen. Batterijruimte tot het bestaande maximum wordt eenmaal voor vandaag gereserveerd; voor morgen wordt conservatief mogelijke volledige hervulling gereserveerd, omdat de batterij tussentijds kan ontladen. Aan Max-PV-EV's wordt de resterende bekende verwachting per deadlinevolgorde eenmaal toegewezen, begrensd door hun behoefte. Onbekende concurrerende behoeften of ontbrekende batterij-/huishoudgegevens geven geen fictief beschikbaar PV-budget. Een geplande netlading wordt nooit bij PV opgeteld.

Het gecrediteerde PV-deel verlaagt uitsluitend de te plannen netbehoefte. Een lagere forecast invalideert dit budget en heropent noodzakelijk netladen. Zonder Gegarandeerd verruimt Max PV goedkope dynamische uren niet om alsnog een tekort met dure uren op te vullen; dure TOU-slots worden eveneens uitgesloten. De overige bestaande tariefkeuzes en netlimieten blijven van toepassing. Met Gegarandeerd blijft de laatst veilige start gebaseerd op de **volledige** resterende energiebehoefte en beschikbare capaciteit, inclusief de bestaande marge van vijf minuten. De planner blijft dus niet tot na die grens op verwachte zon wachten. Fysieke beschikbaarheid, Peak Guard, fasen en hardware blijven altijd begrenzen.

Vaste en TOU-contracten krijgen bij de nieuwe meerdaagse/Max-PV-opties een gecachete curve uit hun werkelijk geconfigureerde tarieven en exacte overgangen. Dynamische contracten gebruiken de bestaande werkelijk gepubliceerde prijscurve. Onbekende toekomstige prijzen leveren geen goedkoop laadslot op. Nieuwe prijzen/forecasts bereiken de bestaande contextevaluatie; er wordt geen meerdaagse planning vanuit de snelle P1-regellus opgebouwd. De prognose blijft voorlopig waar dekking ontbreekt. Er worden daarom geen schijnexacte toekomstige PV/net-kWh in de widget getoond.

## Persistentie en feedback

De bestaande `evSocDeadlineOverrides` en `evEnergyDeadlineOverrides` krijgen alleen voor widgetdoelen een genest `widgetPlan`-object met dagen, Max PV, datum/horizon, vaste timestamp, aanmaakmoment, voltooid en ooit bevestigd aangesloten. De bestaande kWh-resterende waarde blijft de voortgangsbron. `_evWidgetPlanRuntime` bewaart per EV alleen de te hervatten gewone override, de gecoalescete melding en de laatste weergavefeedback. Interne opslagevents starten geen tweede context- of tariefevaluatie. Opslag vindt bij acties/statusovergangen plaats; gelijkblijvende feedback wordt maximaal eenmaal per vijf minuten gecontroleerd opgeslagen, niet bij iedere P1-update.

Laatst bekende status wordt na herstart als verouderd getoond, ook in de EMS-weergave. Er worden géén live `seen`-vlaggen, stroommetingen, verbindingstijdstippen of fysieke laadbewijzen uit deze weergavegegevens hersteld. Eerst actuele feedback ontvangen blijft vereist. Onbekend/null is geen disconnect. Vooraf een doel instellen terwijl de auto nog niet aangesloten is blijft mogelijk: een losse false vóór de eerste bevestigde verbinding verbruikt dat doel niet. Na een bevestigde verbinding beëindigt een expliciete false de widgetplanning, ook als dit de eerste feedback na herstart is. Pauze, nul stroom en logisch doelbereik zijn geen fysieke disconnect.

## Gewijzigde bestanden

Productie/invoer/weergave: `app.js`, `lib/ev-dashboard.js`, `lib/ev-deadline-planner.js`, `lib/flexible-loads.js`, nieuw `lib/ev-plan-options.js` en `lib/ev-plan-resources.js`, `widgets/ev/public/index.html`, `widgets/status/public/index.html`.

Vertaling/documentatie: `locales/en.json`, `locales/nl.json`, `settings/index.html`, `settings/translations/en.json`, `settings/translations/nl.json`, `README.md` en dit rapport.

Validatie: `package.json` (alleen testcommando's), `test/ev-widget-ui-1.2.4.test.js`, `test/ev-widget-regression-1.2.4.test.js`, nieuw `test/ev-multiday-1.2.4.test.js`, `test/ev-multiday-control-1.2.4.test.js`, `test/ev-multiday-benchmark.cjs` en de bijbehorende/hernieuwde `validation/*.json`. De definitieve volledige bestands- en methodediff staat in `validation/ev-multiday-source-audit-1.2.4.json`.

De EV-Flow-manifests, fysieke drivers, vermogensverdeler, Peak Guard-formule, batterijplanner/engine, Savings/dagregistratie, bronverdeling, CSV en de recente huisreferentiemodule zijn bytegelijk aan de vorige volledige build. Daardoor blijft er één energieboekhouding en één daghistoriek; deze uitbreiding voegt geen energietotalen toe.

## Tests en praktische beperkingen

De volledige suite, gerichte scenario's, methodediff en reproduceerbare meetuitkomsten staan in `validation/ev-multiday-suite-1.2.4.json`, `ev-multiday-1.2.4.json`, `ev-multiday-control-1.2.4.json`, `ev-widget-ui-1.2.4.json`, `ev-widget-regression-1.2.4.json` en `ev-multiday-performance-1.2.4.json`.

Alle Homey-I/O, klok, P1-/EV-/PV-feedback en persistentie in deze tests zijn **gesimuleerd**, met echte productiefuncties, geregistreerde Flow-listeners en de bestaande centrale regelroute. De nieuwe UI-tests draaien het echte widgetscript en de bevestigingscontroller in een gesimuleerde DOM. Niet uitgevoerd: installatie/duurproef op fysieke Homey Pro 2019/2023, werkelijk voertuig, fysieke laadpaal, echte cloudherstart en browser/screenshotcontrole. De lokale Playwright-bibliotheek is aanwezig, maar de Chromium-runtime ontbreekt. Er wordt geen fysieke CPU- of compatibiliteitsclaim uit containersimulaties afgeleid.

De zeven legacy Flow-invoeren worden afzonderlijk voor/na met dezelfde productieplanner vergeleken. De nieuwe proeven omvatten kalenderhorizon 1–7, handmatige validatie, DST, statusgelijkheid, kWh-voortgang, gelijktijdige Flow/widgetwijzigingen, legacy versus widget-disconnect, laatste-override-hervatting, herstart met onbekende/completed/expired status, veiligheids-eindfeedback, gedeelde PV-reservering, onbekende behoeften, prognoseverlaging, goedkope/dure vensters en alle drie fysieke EV-sturingstypes. Een 120-events-P1-proef bij vier meerdaagse EV-plannen bouwt geen nieuw horizonplan op; Peak Guard blijft begrenzen. De bestaande suites controleren daarnaast WAF, batterijen, Savings/CSV, Peak Guard, HVAC en boiler.

CPU- en geheugencijfers zijn **containerbenchmarks**, geen Homey-devicepercentages. De bestaande P1/Flow-voor/na-proef rapporteert gelijke evaluatietellers, contextaantallen en fysieke uitgangswijzigingen; CPU/heapmetingen zijn ruisgevoelig. De nieuwe vier-EV/zevendagenproef meet zowel koude curveopbouw als 4.000 cache-evaluaties, met nul extra planbuilds en nul nieuwe timers. De concrete cijfers staan in de meet-JSON en de definitieve opleveringscontrole. De curve is begrensd op acht lokale kalenderdagen/maximaal 1.200 intervallen per EV; het PV-budget en de ownershipstatus zijn begrensd op vier EV's. Bestaande timers worden hergebruikt. Er wordt geen exact ongewijzigd CPU-/geheugengebruik of prestatieverbetering geclaimd.

## Definitieve meetuitkomsten

Alle **95 testbestanden slagen** (0 mislukt). Daarbinnen: 25 nieuwe plannings-/persistentiegroepen, 6 nieuwe volledige laadroutegroepen, 31 widget-UI-controles, de bestaande 26 Scheduler-controles en 19 huisreferentiecontroles. De laatste weergave-/beëindigingsaanpassingen zijn aanvullend met de betreffende gerichte tests opnieuw gecontroleerd. De syntax van alle gewijzigde JavaScript, inline widgetscripts en JSON is gecontroleerd.

| P1/Flow-vergelijking met 1.000 opwarm- en 600 meetstappen | Vorige volledige build | Nieuwe build |
|---|---:|---:|
| CPU (ms) | 775.956 | 722.644 |
| Behoudende heapdelta na GC (bytes, ruisgevoelig) | 132712 | 134832 |
| Extra contextpasses | 1 | 1 |
| Extra fysieke uitgangswijzigingen | 0 | 0 |

De gevolgde evaluatietellers zijn gelijk en alle zeven legacy Flow-snapshots zijn identiek. Een enkele timing-/heapvergelijking bewijst geen verbetering of exact gelijk CPU-/geheugengebruik.

Nieuwe vier-EV/zevendagen-TOU-proef: koude CPU **3.299 ms**, 4.000 herhaalde productie-evaluaties **172.133 ms CPU**, **0** extra planbuilds, **0** nieuwe timers. Deze constante TOU-configuratie heeft één interval per EV; gedeelde cache-inhoud als JSON **1010 bytes**. De gemeten retained-heapdelta **131840 bytes** omvat JIT/GC-ruis en is geen universele cachegrootte. Fysieke Homey-CPU/geheugen en echte installatie zijn niet gemeten.
