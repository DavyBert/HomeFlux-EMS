# HomeFlux EMS 1.2.4 — EV Dashboard: Scheduler & Insights

## Resultaat en bronbasis

Volledige app op basis van de laatst aangeleverde, herstelde 1.2.3. De nieuwe widget **HomeFlux EV** heeft per instantie twee onafhankelijke opties: **Show EV Scheduler** en **Show EV Insights**, beide standaard aan. De EV-keuze is lokaal per widgetinstantie; doelen worden centraal beheerd. Selectie wordt, waar Web Storage beschikbaar is, per Homey-widget-ID onthouden. Er zijn EN/NL-vertalingen en lichte/donkere weergaven.

De verplichte codecontrole is vóór de Scheduler uitgevoerd en geslaagd. Er was geen architectuurwijziging aan de EV-planner nodig en de stopvoorwaarde werd niet geraakt. Zie `ev-widget-handler-audit-1.2.4.md` en de gate-test/-resultaten.

## 1. De bestaande handler, zonder tweede planner

Het nieuwe `widgets/ev/api.js` geeft een bevestigde wijziging door aan `app.setEvDashboard()` en de dunne adapter `lib/ev-dashboard.js/submit()`.

De adapter roept **de bestaande geregistreerde listener uit `app.slotFlowCards.actions`** aan: `set_evN_soc_deadline` of `set_evN_energy_deadline`. Dit zijn ook de listeners van de genummerde, selector- en geconfigureerde Flow-kaarten. Zij blijven de ongewijzigde centrale invoerfuncties `setEvSocPlan()` en `setEvEnergyPlan()` gebruiken.

- De bestaande validatie en betekenissen blijven gelden: 1–100% SoC, 0–250 kWh, HH:mm en dezelfde `yes`/`no` Guaranteed-parameter. Zero kWh blijft een actief, reeds voldaan doel, geen wisactie.
- De centrale handler bepaalt de kalenderdatum, deadline-occurrence, override, persistentie en vervolgverwerking. De widget berekent geen tariefvensters, datum, haalbaarheid of laadvermogen.
- De oorspronkelijke `evSocDeadlineOverrides` en `evEnergyDeadlineOverrides` blijven de enige persistente Flow-doelen. Herstel na herstart is ongewijzigd.
- Een herindiening van een gewijzigde kWh-deadline of Guaranteed kan het kWh-minimum opnieuw armeren, precies zoals dezelfde bestaande Flow-kaart. Er is geen afwijkende widgetbetekenis of stille wijziging van de kWh-voortgang gemaakt.
- Er worden geen rechtstreekse laadcommando's door de widget verstuurd. De bestaande planner, fysieke sturing, commandotiming, prioriteiten, PV-, batterij- en Peak Guard-interacties blijven de uitvoer bepalen.

De bronvergelijking bevestigt **149 bytegelijk gebleven bestaande EV-methoden**. `lib/flexible-loads.js`, `lib/ev-deadline-planner.js`, `lib/ev-session.js`, `lib/battery-night-planner.js`, de Flow-routeadapters en de WAF-module zijn volledig bytegelijk aan 1.2.3. `lib/ems-engine.js` is alleen uitgebreid met 48 nieuwe voorkeurdefaults; na verwijdering van dat ene blok is het bestand exact gelijk aan de basis. Zie `validation/ev-source-diff-1.2.4.json`.

## 2. Gelijktijdigheid, actuele parameters en bevestiging

De bestaande invoerfuncties zijn synchroon. De adapter leest het **actuele** actieve override en roept zonder een `await` daartussen de originele listener aan. Het lezen en committen gebeurt dus in één JavaScript-turn. Een deadlinepatch hergebruikt het nieuwste centrale doel en Guaranteed; een doelpatch behoudt de nieuwste deadline; een Guaranteed-patch behoudt beide.

Een actief plan accepteert uitsluitend één veranderde parameter per widgetopdracht. Een volledig lokaal concept mag alleen een ontbrekend plan aanmaken. Als een Flow ondertussen een plan heeft gemaakt, wordt dat concept geweigerd. De widget stuurt dus niet de oude 80% terug als een Flow inmiddels 90% heeft ingesteld.

De transportlaag heeft een begrensde cache van 128 request-ID's om herhaalde verzending tegen te houden. De originele idempotentie van de centrale handlers blijft ook actief. Er is geen nieuwe persistente opdrachtenhistoriek, lock of laadplanner.

Iedere doel-, tijd- of Guaranteed-wijziging vereist een eerste selectie en een tweede tik op dezelfde knop binnen vijf seconden. Een andere knop, EV-wissel, verbergen/verlaten of herladen annuleert de bevestiging. Slepen/swipen bevestigt niet. Tijdens verzending worden dubbele acties geblokkeerd. Succes wordt pas na een positieve handlerrespons getoond. Validatiefouten behouden de vorige geldige planning.

Zonder volledig centraal plan blijven bevestigde doel-, tijd- en Guaranteed-keuzes lokale concepten totdat doel en deadline compleet zijn. Alleen Guaranteed creëert geen plan. Een respons voor een eerdere EV/periode kan de nieuwe selectie niet overschrijven.

## 3. EV-identiteit en instellingen

Identiteiten zijn de bestaande slots **1–4**, niet de wijzigbare namen. Interne index = slot − 1. Eén geconfigureerde EV wordt automatisch geselecteerd; bij meerdere EV's zijn de bestaande namen selecteerbaar, ook in Insights-only of Scheduler-only. Elke widget houdt haar eigen selectie en zichtbaarheid. Andere instanties lezen dezelfde centrale plannen via gedeelde statusupdates.

Alle nieuwe instellingen staan per EV in het bestaande EV-tabblad. EV 1 gebruikt prefix `ev`, EV 2–4 `ev2` t/m `ev4`.

| Suffix | Standaard | Betekenis |
|---|---|---|
| `WidgetPresetMode` | `soc` | Alleen widgetinvoer: `soc` of `kwh` |
| `WidgetSoc1..3` | 60 / 80 / 100 | Drie doelpresets in procent |
| `WidgetKwh1..3` | 5 / 10 / 20 | Drie presets met de bestaande Flow-kWh-betekenis |
| `WidgetTime1..3` | 07:00 / 12:00 / 17:00 | Onbewerkte HH:mm-invoer voor de bestaande handler |
| `ConsumptionKwhPer100Km` | 18 | Alleen afgeleide zonnekilometers |
| `EnergyFeedbackScope` | `individual` | `individual`, `shared` of `unavailable` voor rapportage |

Deze 48 sleutels zijn expliciet uitgezonderd van EV-planningsrevisies, fysieke cache-invalidation en batterijmemo-invalidation. Veranderen ervan vraagt geen context-/laadberekening aan. De test controleert dat voor alle sleutels, inclusief interne writes en Homey-settings-events. Bestaande sleutels volgen hun oorspronkelijke verwerking.

SoC blijft onbekend wanneer die ontbreekt of niet beschikbaar is. De widget maakt geen eigen SoC-schatting of fallback. De laadstatus komt rechtstreeks uit de bestaande centrale EV-sessie (`getEvSessionDetectionRuntime()`), net als de sessiestatus van het EMS-overzicht. De widget leidt die niet zelfstandig af uit laadstroom, laadcommando’s of toekomstige planningsslots.

## 4. Eén centrale dagregistratie

De bestaande `recordSavingsSample()` en `lib/savings.js/integrateInterval()` blijven het enige financiële/energie-registratiepad. De EV-uitsplitsing is een pure suballocatie binnen dat interval. Zij heeft geen eigen timer, polling, database, persistentieklok of widgetaccumulatie.

Het bestaande `tickEvEnergyPlan()` blijft uitsluitend de oorspronkelijke kWh-doelvoortgang bijhouden. Die voortgang is geen financiële historie en is ongewijzigd. De nieuwe dagdata telt geen doel- of commandokWh als gemeten levering.

Het nieuwe optionele dagveld is:

```text
day.ev = {
  version: 1,
  seconds,        // dekking van bestaande centrale meetintervallen
  sharedKwh,      // gezamenlijke EV-meter, niet aan één EV toegewezen
  total: metric,
  byId: { "1": metric, ..., "4": metric }
}
metric = {
  kwh, pvKwh, gridKwh, batteryKwh, unknownKwh, estimatedKwh,
  gridCost, solarValue, solarSavings, unpricedKwh, missingSeconds
}
```

De bestaande normalisatie, compactie, dagarchivering, optelling en instellingen `_savingsToday`/`_savingsHistory` bewaren die velden. Oude dagen zonder EV-velden blijven leesbaar en worden niet aangevuld met fictieve nullen. Bestaande vijfjaarretentie en periodieke opslag blijven behouden. De bestaande gedeelde gesloten-dagcache bedient zowel Savings als Insights; ook de oudste datum voor “All” wordt gedeeld gecachet.

Een nieuwe EV-currentinput sluit eerst het voorgaande **bestaande** meetinterval af. Dit geldt voor genummerde/selector-Flow-routes én het bestaande geneste EV-API-invoerpad. Gelijke timestamps leveren geen extra interval op. Herstart hervat vanaf de bestaande recorderklok; de offlineperiode wordt niet opnieuw geïntegreerd.

### Expliciete daggrenscorrectie

Een noodzakelijk grensgeval in de bestaande centrale recorder is gecorrigeerd: 1.2.3 boekte een interval over lokale middernacht volledig op de nieuwe dag. Nu wordt hetzelfde interval eenmaal op de lokale daggrens gesplitst voor **zowel Savings als EV Insights**. Bijvoorbeeld 20 seconden bij 2.300 W: 10 seconden op beide dagen, samen nog steeds 0,012777… kWh. Dit kan de toekomstige dagverdeling op de grens wijzigen; het verandert de som over beide dagen niet en herschrijft geen opgeslagen historische dagen. De oorspronkelijke rekenregels per interval blijven gelijk.

## 5. Energieherkomst, meetkwaliteit en invarianten

HomeFlux ontvangt in deze broncode EV-stroomfeedback in ampère, geen afzonderlijke EV-kWh- of wattmeter. De geregistreerde EV-kWh zijn dus **schattingen uit feitelijke stroomfeedback × ingestelde spanning/fasen**, niet gemeten batterij-energie. Een opdracht is geen leveringsbewijs. De bestaande leveringshorizon van 60 seconden wordt ook hier gerespecteerd.

- Bij individuele feedback bepaalt de centrale recorder één bronverdeling uit de bestaande Savings-balans. Directe zon dekt in de EV-rapportage eerst het overige huisverbruik. Alleen het resterende directe PV-aandeel gaat naar de EV’s, gevolgd door het beschikbare directe netaandeel. Meerdere EV’s delen deze ene EV-pool naar hun geregistreerde stroomvermogen. Dit is een **geschatte boekhoudkundige toewijzing**, geen fysieke meting van de bron per auto en geen wijziging aan de PV-/laadsturing.
- Bij actieve thuisbatterijstromen blijft de bestaande Savings-balans de basis van de schatting. Batterijladen en export zijn al uit de directe bronpools verwijderd. Een batterijactie blokkeert de volledige EV-verdeling niet meer. Het restant dat niet uit de beschikbare directe PV-/netpools kan worden verklaard blijft onbekend; `batteryKwh` wordt zonder betrouwbare bronmeting niet fictief gevuld. Onjuiste of achterlopende batterijcommando’s kunnen ook de geschatte bronverdeling beïnvloeden.
- Een gedeelde EV-meter wordt eenmaal centraal geteld en niet volledig aan één auto toegewezen. Individuele Insights blijven voor dat aandeel onvolledig. Meerdere dubbelzinnige gedeelde meters worden niet bij elkaar opgeteld.
- Markeer een gezamenlijke meting als **Shared EV meter**. De bestaande Flow-invoer bevat geen meter-ID; HomeFlux kan niet automatisch herkennen dat dezelfde stroommeting tweemaal onder verschillende EV-slots is aangeboden.
- Bij alleen moduscommando's, onbetrouwbare stroom-/fasefeedback of geschat commandopower kan **No reliable current feedback** gekozen worden. De rapportage verzint dan geen geleverde kWh. De bestaande laadsturing verandert niet.
- Ontbrekende stroomfeedback wordt gemarkeerd met ontbrekende tijd/dekking; een onbekende hoeveelheid kWh wordt niet als een exact bekend getal uitgevonden. Gedeeltelijk bekende stroom, onwaarschijnlijke vermogens of onvoldoende betrouwbare bronverdeling leveren onbekende herkomst of onvolledige periodegegevens op.

Geteste invarianten, met floating-pointtolerantie 1e-8:

```text
Som(PV naar EV's) <= PV direct totaal
Som(individuele EV-kWh) <= centrale EV-kWh
PV + net + batterij + onbekend = geregistreerde EV-kWh
```

De EV-velden zijn onderverdelingen, geen toevoegingen aan de bestaande Savings-totalen. 15 kWh direct PV met 9 kWh naar EV blijft 15 kWh, waarvan 6 kWh overig direct verbruik.

## 6. Kosten, besparingen en zonnekilometers

De geselecteerde prijzen komen uit de ongewijzigde `getSavingsTariffSnapshot()`: vast, TOU of de bestaande dynamische/externe prijsselectie. Er is geen tweede tariefkiezer. Ieder interval bewaart zijn bedragen; historie wordt niet achteraf met een actuele prijs herrekend.

| Veld | Definitie |
|---|---|
| `gridCost` | Toegewezen net-kWh × importprijs van het interval |
| `solarValue` | Toegewezen directe PV-kWh × injectievergoeding van het interval: gemiste exportopbrengst |
| Bekende laadkosten | `gridCost + solarValue`; batterij-/onbekende kosten worden niet verzonnen |
| `solarSavings` | Directe PV-kWh × (importprijs − injectievergoeding) |
| `unpricedKwh` | Energie waarvoor de importprijs niet betrouwbaar beschikbaar was; geen retroactieve prijsinvulling |

Negatieve import-/exportprijzen blijven getekend. De bestaande Savings-widget houdt zijn eigen bestaande bruto vermeden PV-inkoopwaarde; de EV-nettobesparing trekt de gemiste injectievergoeding af. Deze EV-bedragen worden **niet nogmaals bij algemene Savings opgeteld**. Bestaande importmeterkalibratie kan ongedekte EV-nettoewijzing conservatief naar onbekend verplaatsen, zonder EV-energie te maken of te verwijderen.

`solarKm = pvKwh / ConsumptionKwhPer100Km × 100`. Bij 8,4 kWh en 18 kWh/100 km is dat afgerond 47 km. Dit is geschatte mogelijke actieradius op basis van AC-laderinvoer, vóór onbekende laadverliezen. Het is geen gereden afstand. Veranderen van verbruik past alleen deze afgeleide schatting aan, geen historische energie.

## 7. Interface, updates en performance

Scheduler en Insights werken samen of afzonderlijk. De widget toont EV-naam, bekende aansluiting, beschikbare laadstatus, SoC, centraal doel/tijd/Guaranteed en compacte presets. Insights toont zonnekilometers, een bronbalk, PV/net/ongekend, zonne-aandeel, bekende laadkosten en geschatte besparing voor Day/Week/Month/All. Onvolledige data wordt als zodanig aangeduid.

Er is **geen pollinginterval in de widget**. Eén SDK-realtime-abonnement gebruikt updates vanuit de bestaande trage housekeeping en planningswijzigingen. Initieel laden, EV-/periodekeuze, succesvolle bediening en hervatten lezen de centrale API. Lezen voert geen EMS, planner, energieregistratie of laadcommando uit. Verbergen/verlaten maakt callbacks inactief, annuleert bevestigingstimers en negeert oude antwoorden. Een view registreert één abonnement; Homey beheert de levensduur van de widgetview. Er is alleen een lokale vijfseconden-bevestigingstimeout.

De meetvergelijking gebruikt twee afzonderlijke Node-processen, echte productiefuncties, gesimuleerde Homey-I/O, twee EV's met 10/8 A feedback, 1.000 gelijke opwarminputs en 600 gemeten P1-stappen. Teller- en commandogelijkheid wordt afgedwongen; klok-/CPU-/GC-waarden worden gerapporteerd zonder verbetering te claimen.

| Indicator | 1.2.3 | 1.2.4 |
|---|---:|---:|
| Gemeten P1-stappen | 600 | 600 |
| Opwarminputs | 1000 | 1000 |
| Node CPU-tijd (ms) | 347.31 | 394.09 |
| Verstreken tijd (ms) | 315.91 | 356.24 |
| Behouden heapdelta na GC (bytes) | 114816 | 129496 |
| Extra contextpasses in meetdeel | 1 | 1 |
| Extra fysieke flexible-load writes in meetdeel | 0 | 0 |
| `gridInputs` | 1603 | 1603 |
| `fastEvaluations` | 1603 | 1603 |
| `contextEvaluations` | 20 | 20 |
| `planningCalculations` | 1 | 1 |
| `widgetEnergyBudgetCalculations` | 1 | 1 |


Deze procesmetingen zijn geen Homey CPU-percentages of langdurige Homey-geheugenmetingen. Variatie door JIT, GC en containerbelasting blijft mogelijk. De nieuwe energie-uitsplitsing heeft noodzakelijke rekenkosten. Voor bekende nulvermogens worden tijdelijke metriekobjecten overgeslagen; zonder EV's wordt de extra prijs-/EV-verwerking overgeslagen. Er is geen extra regelcyclus of EV-commandotimer.

## 8. Tests, niet-uitgevoerde controles en beperkingen

- Volledige suite: **89 testbestanden geslaagd**.
- Verplichte voorafgaande handlergate: 4 bevindingen geslaagd.
- Scheduler/API/controller: **21 scenario's**, waaronder beide doeltypes, meerdere EV's, onvolledige concepten, Guaranteed, bevestigingen, verouderde doelen, gelijktijdige Flow/widget, deduplicatie, herstart, ontbrekende SoC/aansluiting, nul batterijen, batterijregeling uit en isolatie van alle 48 voorkeuren.
- Centrale energie/financiën: **28 scenario's**, waaronder PV/net/mengvormen, batterijstromen, export, individuele en gedeelde meters, afwezige/vertraagde/geschatte feedback, echte Flow-/API-stopinputs, prijzen en ontbrekende prijzen, kalibratie, historische data, centrale persistentie, middernacht, DST, verbruikswijziging en gedeelde cache.
- Widget-UI: **17 gesimuleerde DOM-scenario's**, beide talen, alle zichtbaarheidscombinaties, één/meerdere/geen EV, dubbele bevestiging, slepen, afloop, EV-wissel, vertraagde responses, levenscyclus en per-widgetselectie na herladen.
- **7 identieke echte Flow/planner-snapshots** vóór/na; **149 bestaande EV-methoden exact gelijk**.
- **18 statische CSS-renders** van de werkelijke widget-DOM: licht/donker, drie weergavemodi, breedtes 280/360/600 px. Beide SDK-previewafbeeldingen zijn meegeleverd.
- Bestaande WAF-, batterijlimiet-, dag-/nacht-, PV-prioriteit-, Peak Guard-, EV-, HVAC-, boiler-, Savings-, overige widget-, diagnostiek- en persistentietests blijven onderdeel van de volledige suite.

**Niet uitgevoerd:** installatie op een fysieke Homey, daadwerkelijke EV-/batterijaansturing, SDK-/native Dashboard-validatie op Homey, een echte browsertest en langdurige apparaat-CPU-/geheugenmetingen. Chromium was hier niet beschikbaar; het downloaden van de testbrowser mislukte. De statische WeasyPrint-rendercontrole vervangt geen native browsertest. Interactie en SDK-aanroepen zijn met de echte widgetcode en gesimuleerde DOM/SDK getest.

De rapportage kan geen aparte EV-meter, batterijstroommeting, automatisch fasewisselsignaal of ontbrekende historische stroomdata uitvinden. Configureer meetbereik, spanning/fasen en consumptie passend. Onbekende perioden en bronnen blijven zichtbaar. De werking van alleen modusgestuurde laders is behouden; zonder betrouwbare stroomfeedback zijn hun energie-Inzichten onvolledig.

## 9. Gewijzigde bestanden en controleerbare resultaten

- Gewijzigd: `.homeychangelog.json`
- Gewijzigd: `.homeycompose/app.json`
- Gewijzigd: `README.md`
- Gewijzigd: `app.js`
- Gewijzigd: `app.json`
- Gewijzigd: `lib/ems-engine.js`
- Gewijzigd: `lib/savings-history.js`
- Gewijzigd: `lib/savings.js`
- Gewijzigd: `locales/en.json`
- Gewijzigd: `locales/nl.json`
- Gewijzigd: `package-lock.json`
- Gewijzigd: `package.json`
- Gewijzigd: `settings/index.html`
- Gewijzigd: `settings/translations/en.json`
- Gewijzigd: `test/planning-monitor-1.1.16.test.js`
- Gewijzigd: `test/settings-startup.test.js`
- Gewijzigd: `test/widget.test.js`
- Nieuw: `docs/ev-dashboard-1.2.4.md`
- Nieuw: `docs/ev-widget-handler-audit-1.2.4.md`
- Nieuw: `lib/ev-dashboard-config.js`
- Nieuw: `lib/ev-dashboard.js`
- Nieuw: `lib/ev-energy-breakdown.js`
- Nieuw: `test/ev-dashboard-1.2.4.test.js`
- Nieuw: `test/ev-energy-1.2.4.test.js`
- Nieuw: `test/ev-widget-comparison-worker.cjs`
- Nieuw: `test/ev-widget-handler-audit-1.2.4.test.js`
- Nieuw: `test/ev-widget-regression-1.2.4.test.js`
- Nieuw: `test/ev-widget-ui-1.2.4.test.js`
- Nieuw: `validation/ev-dashboard-1.2.4.json`
- Nieuw: `validation/ev-energy-1.2.4.json`
- Nieuw: `validation/ev-source-diff-1.2.4.json`
- Nieuw: `validation/ev-widget-handler-audit-1.2.4.json`
- Nieuw: `validation/ev-widget-regression-1.2.4.json`
- Nieuw: `validation/ev-widget-ui-1.2.4.json`
- Nieuw: `validation/ev-widget-visual-1.2.4.json`
- Nieuw: `validation/regressions-1.2.4/battery-night-1.1.18.json`
- Nieuw: `validation/regressions-1.2.4/ev-deadline-integration.json`
- Nieuw: `validation/regressions-1.2.4/ev-peak-1.1.20.json`
- Nieuw: `validation/regressions-1.2.4/waf-continuity-1.2.3.json`
- Nieuw: `validation/regressions-1.2.4/widget-insights-1.2.1.json`
- Nieuw: `validation/release-1.2.4.json`
- Nieuw: `validation/syntax-1.2.4.json`
- Nieuw: `validation/tests-1.2.4.json`
- Nieuw: `widgets/ev/api.js`
- Nieuw: `widgets/ev/preview-dark.png`
- Nieuw: `widgets/ev/preview-light.png`
- Nieuw: `widgets/ev/public/controller.js`
- Nieuw: `widgets/ev/public/index.html`
- Nieuw: `widgets/ev/widget.compose.json`

Resultaten staan onder `validation/*1.2.4.json`, inclusief bronvergelijking, gate, functionele scenario's, performance, syntax en releasecontrole. Oude validatierapporten worden als historische bron behouden; opnieuw uitgevoerde oude suites krijgen een aparte 1.2.4-kopie.

Gebruik:

```sh
npm test
HEMS_EV_BASELINE=/pad/naar/HomeFlux-EMS-1.2.3 node test/ev-widget-regression-1.2.4.test.js
```

SDK-referenties: [Widgets](https://apps.developer.homey.app/the-basics/widgets), [ManagerApi.realtime](https://apps-sdk-v3.developer.homey.app/ManagerApi.html). Er zijn geen runtimeafhankelijkheden toegevoegd. Alle versievelden zijn 1.2.4; de EN/NL-release notes staan in de changelog, niet in de app-paginabeschrijvingen.

## Visuele verfijning binnen 1.2.4

Het laaddoel en de deadline zijn verkleind van 27 naar 21 px (19 px op smalle widgets). De vaste toelichting over schattingen uit laadstroom, spanning en fasen, laadverliezen en gemiste injectievergoeding staat nu bij de EV-dashboardinstellingen van iedere EV, in Nederlands en Engels. Alleen relevante meldingen over onvolledige gegevens, ontbrekende tarieven of gedeelde meters blijven onder de widget staan. EV-planning, sturing en energieregistratie zijn ongewijzigd.

Gerichte hercontrole: 17 bestaande gesimuleerde DOM-scenario’s geslaagd; instellingenvertaling, instellingenopstart en bestaande widgettests geslaagd. Zes statische renders gemaakt (280/360/600 px, licht/donker); de 360 px-renders zijn visueel gecontroleerd. Geen nieuwe Homey- of hardwaretest uitgevoerd. De eerder gerapporteerde volledige suite en prestatiemeting horen bij de voorafgaande 1.2.4-build; deze zijn voor deze uitsluitend visuele wijziging niet herhaald.

## Optionele wisselweergave binnen 1.2.4

Schakel bij het configureren van de widget **Planning / Inzichten wisselen met knoppen** in. Als beide onderdelen aanstaan, verschijnen naast HOMEFLUX EV twee knoppen en is steeds één onderdeel zichtbaar. Zonder deze optie blijven beide onderdelen onder elkaar staan; bij slechts één ingeschakeld onderdeel zijn wisselknoppen verborgen. De optie staat standaard uit, zodat bestaande widgets hun indeling behouden.

De gekozen weergave wordt, waar Web Storage beschikbaar is, per widgetinstantie onthouden. De EV-keuze, periode en lokale conceptinvoer blijven behouden bij het wisselen. Een openstaande bevestiging wordt geannuleerd. Wisselen gebruikt de reeds ontvangen gegevens, zonder extra statusaanvraag, polling, planning of laadopdracht. De bestaande planner, handler, fysieke sturing en energieboekhouding zijn bytegelijk aan de voorafgaande 1.2.4-build.

Gerichte tests: **25 gesimuleerde DOM-scenario’s** (de bestaande 17 plus 8 uitbreidingen) en **21 Scheduler-scenario’s** geslaagd, evenals de bestaande widget- en instellingenvertalingstests. Nederlandse en Engelse teksten en het samengestelde widgetmanifest zijn gecontroleerd. Statische renders controleren beide wisselweergaven op 280/360/600 px in licht en donker; de Nederlandse 280 px-weergaven zijn aanvullend gecontroleerd. Geen native Homey-, browser- of hardwaretest en geen nieuwe prestatiemeting uitgevoerd. De eerder beschreven volledige suite betreft de oorspronkelijke 1.2.4-build.

## CSV-exportcorrectie binnen 1.2.4

De bestaande `/savings/export`-route en `getSavingsCsv()` blijven ongewijzigd. Alleen `lib/savings-history.js/toCsv()` is uitgebreid. De oorspronkelijke 14 kolommen blijven exact vooraan staan, met dezelfde betekenis, bedragen, volgorde, dagselectie en CRLF-regelafbrekingen. De export heeft nu 77 kolommen. Er is geen wijziging in registratie, opslag, planning of sturing en geen extra periodieke verwerking.

Na de bestaande kolommen volgen `ev_data_available` (1 bij aanwezige EV-dagdata, anders 0), `ev_coverage_seconds` (centraal geregistreerde intervalduur) en `ev_shared_kwh` (groepsenergie zonder betrouwbare individuele toewijzing). Daarna volgen dezelfde 12 velden met prefix `ev_` voor het groepstotaal en `ev1_` tot en met `ev4_` voor de bestaande stabiele EV-slots:

| Suffix | Betekenis |
|---|---|
| `kwh` | Geregistreerde laadenergie |
| `pv_kwh`, `grid_kwh`, `battery_kwh`, `unknown_kwh` | Bestaande bronuitsplitsing; samen de geregistreerde laadenergie |
| `estimated_kwh` | Energie gebaseerd op een schatting, zoals stroom × spanning × fasen |
| `grid_cost_<valuta>` | Opgeslagen netkosten volgens intervaltarief |
| `solar_value_<valuta>` | Opgeslagen gemiste injectievergoeding |
| `known_charging_cost_<valuta>` | Som van bekende netkosten en gemiste injectievergoeding; kan onvolledig zijn |
| `estimated_savings_<valuta>` | Opgeslagen geschatte PV-besparing, na gemiste injectievergoeding |
| `unpriced_kwh` | Geregistreerde energie met ontbrekend intervaltarief |
| `missing_feedback_seconds` | Ontbrekende feedbackduur; groepswaarde is de som over EV-metingen |

Dagen zonder EV-dagdata hebben lege EV-metingen, dus geen verzonnen nulverbruik of historische terugvulling. Een afwezige individuele EV heeft lege velden; een werkelijk geregistreerde nul blijft 0. Gedeelde meterenergie wordt alleen in het groepstotaal meegenomen. Namen of huidige EV-configuraties worden niet achteraf op historische slots toegepast. De CSV bevat energie- en geldwaarden uit de dagdata; zonnekilometers blijven de widgetafleiding met het configureerbare verbruik. EV-uitsplitsingen worden nooit opnieuw bij algemene Savings geteld. Negatieve prijzen en bedragen blijven behouden.

Verificatie: **8 gerichte exportscenario’s** met echte productiefuncties, **28 bestaande energiescenario’s**, de bestaande Savings-suite en widget-suite geslaagd. De eerste 14 kolommen zijn voor gemengde oude/nieuwe testdagen en meerdere valuta’s bytegelijk vergeleken met de exportfunctie uit de voorafgaande 1.2.4-build. De app-ingang is getest met gesimuleerde Homey-I/O en centrale dagdata; geen native Homey- of hardwaretest uitgevoerd. De volledige appsuite en prestatiemeting zijn voor deze exportcorrectie niet opnieuw uitgevoerd.

## Gedeelde centrale laadstatus binnen 1.2.4

De EV-widget leest uitsluitend de bestaande centrale sessiestatus per EV. `charging`, `paused`, `waiting`, `idle` en `ended` worden vertaald weergegeven; bij ontbrekende of onbekende sessiestatus verschijnt “Status onbekend”. Er zijn geen eigen laadstroomcontroles, bewaking van deadlines of inspecties van toekomstige laadslots meer om een laadstatus te bepalen. Doel, deadline en Guaranteed blijven apart zichtbaar. Bestaande herkenning via laadstroom én woningmeting wordt volledig overgenomen; een hoog commando of een gepland tijdslot kan een centraal gepauzeerde of beëindigde sessie niet overschrijven.

De wijziging zit alleen in de uitlezing van `lib/ev-dashboard.js`. De centrale detectie, sessieovergangen, EV-planner, fysieke sturing, energieboekhouding en `app.js` blijven bytegelijk aan de vorige build. Er is geen nieuwe listener, polling, timer of registratiepad toegevoegd. De korte EN/NL-release notes, tekstvrije previews en eerdere exportcorrectie blijven behouden.

Gerichte verificatie: **24 backend-/Scheduler-scenario’s** en **27 gesimuleerde widget-DOM-scenario’s** geslaagd. De BMW-situatie is gesimuleerd met de echte centrale productiefuncties: 0 A stroomfeedback, één EV met modussturing en P1-huislastdetectie leiden centraal tot `charging`; de widget kopieert die status. Na de bestaande detectieduur bij weggevallen last wordt `paused` overgenomen. Afzonderlijke EV-statussen, laden via normale stroomfeedback, ontkoppelen/einde sessie, ontbrekende status en geen detectie- of regelwerk tijdens herhaalde widgetreads zijn gecontroleerd. Geen fysieke Homey-/EV-test, volledige nieuwe appsuite of nieuwe apparaatprestatiemeting uitgevoerd.

## Emergency charge: duidelijke status binnen 1.2.4

Tijdens actieve Emergency charge toont de EMS-statuswidget geen normaal minimumdoel, instellingenfallback, resterende plannings-kWh, deadline of haalbaarheid. De actieve laadstatus heet “Emergency charge tot 100%”; de bestaande reden, Peak Guard, tariefblokkade, sessiestatus, batterijcoördinatie en wachttijd voor echte uitgangen blijven zichtbaar. De identieke dubbele actieve reden en de generieke melding “Huidige EV-beslissing is actief” vervallen alleen in deze weergave. De EV-plannings- en Live-statuskaarten in de instellingen verbergen eveneens de niet-toepasselijke planningsgegevens.

De korte EN/NL-hint luidt “Hint: gebruik een Flow met gegarandeerd laden als je niet tot 100% wilt laden.” Hij verschijnt 5 seconden per cyclus van 30 seconden, in de Live-status, planningskaarten en EMS-statuswidget. De overige 25 seconden is de hint ingeklapt. Een gedeelde klokfase voorkomt dat statusverversingen de cyclus herstarten. CSS verzorgt de timing; er komt geen EMS-timer of extra gegevensopvraag bij. De statuswidget past zijn hoogte bij een formaatwijziging aan via één ResizeObserver die bij verbergen/verlaten wordt losgekoppeld. Dit is een minimumdoel, geen nieuwe harde laadlimiet. De bestaande instelling voor stoppen of verderladen na doelbereik blijft gelden. Er wordt niet beweerd dat een auto altijd 100% haalt; de eigen voertuig-/laderlimiet blijft relevant.

Dit is uitsluitend presentatie: app.js, centrale EV-status, Flow-handlers, doelen, persistentie, planner en fysieke sturing blijven bytegelijk aan de voorgaande build. Echte Flow-doelen worden tijdens Emergency charge niet verwijderd of veranderd; bij terugkeer naar een gewone modus zijn hun gegevens weer normaal zichtbaar. Andere weergavemodi behouden hun eerdere tekst. Korte release notes en tekstvrije previews blijven ongewijzigd.

Verificatie: 10 gerichte EN/NL-scenario’s met echte productieweergavefuncties slagen. De regressiegevallen vergelijken normale Smart-/SoC-modus met instellingen-, SoC- en kWh-doelen exact met de vorige build. Freds voorbeeld (30% tegen 07:00, 6,8 kWh, deadline en haalbaarheid tijdens Emergency) wordt onderdrukt. Outputtimer, Peak Guard, tariefblokkade, pauzeren, gescheiden EV-configuraties en gegevensbehoud blijven getest. Geen fysieke Homey-/EV-test uitgevoerd.

## Onderzoek EV-registratie binnen 1.2.4

Verse EV-stroomfeedback blijft nu ook bij ontbrekende of verouderde P1/PV-data behouden als energie met onbekende herkomst, binnen dezelfde centrale intervalfunctie. Algemene Savings en batterijvoorraad worden in zo’n interval niet aangepast. De nulwaarde in de aangeleverde BMW-diagnose hangt samen met ontvangen 0 A en verouderde feedback; er wordt geen energie uit een laadcommando of alleen woningmeting verzonnen. Zie [volledig onderzoek en testresultaten](ev-recording-audit-1.2.4.md). De uiteindelijke controle omvat 92 geslaagde testbestanden en 21 gerichte centrale registratiescenario’s.

## EV-bronverdeling en compact actief laadschema

Zie [de vervolgcontrole van bronverdeling en actief laadschema](ev-source-allocation-1.2.4.md). Deze correctie binnen 1.2.4 vervangt de eerdere volledige blokkade bij een actief batterijcommando en de eerdere proportionele huishoudelijke PV-verdeling. De EV-widget toont naam, centrale laadstatus en aansluiting op één regel, met de effectieve modus en het actuele doel/schema eronder.

## Recente huisreferentie bij modus-START

De volgende beperkte correctie binnen dezelfde versie vernieuwt een aantoonbaar verouderde referentie bij STOP→START, mits de laatste meetminuut betrouwbaar is. Zie [onderzoek, voorwaarden en tests](ev-house-reference-1.2.4.md). De bestaande EV-planning, widgetbediening, bronverdeling en P1-gebaseerde Peak Guard-formule blijven behouden.
