# EV Peak Guard – afzonderlijke proefbuild op basis van 1.2.4

## Basis en status

Gebaseerd op de laatst opgehaalde volledige HomeFlux EMS 1.2.4-broncode, opslagversie 22. SHA-256 oorspronkelijke ZIP: `0928b30d22ac43e1882d00a935f75fe2a66eb471708f4b514869feaebbca0ccf`. Het appversienummer blijft 1.2.4. De oorspronkelijke release en ZIP zijn niet vervangen. Deze volledige broncode wordt als afzonderlijke, duidelijk benoemde proef-ZIP geleverd.

Dit is een gerichte correctie van de gevonden meetpaden plus een gedeelde uitgangsprojectie. Er is geen nieuwe EV-planner, geen andere deadline-/tariefstrategie en geen extra device-read, polling, periodieke timer of energieboekhouding.

## Oorzaken en concrete correcties

### 1. Mode-huisreferentie zonder verplichte ampèrefeedback

De 60-secondenbuffer verlangde bij een aangesloten Mode-EV verse Flow-stroom, ook terwijl de uitgang STOP was. Daardoor werd een geldig waargenomen sitegemiddelde geweigerd met `ev_feedback_pending` en bleef bijvoorbeeld 4.000 W als oude referentie gelden bij een werkelijk stilstandsverbruik van 700 W.

`recordRecentEvHouseLoadSample()` behandelt Mode nu apart. Tijdens een gestopte Mode-uitgang worden P1 + PV + het bestaande getekende batterijvermogen gebruikt zonder Flow-ampères af te trekken. Eventuele nog aanwezige laadlast blijft in de sitewaarde inbegrepen. Deze waarde is dus een **bovengrens voor het huis**, geen claim van een afzonderlijke EV-vrije meetmeter. Een laadstaart kan de referentie conservatief te hoog laten blijven; hij kan door een fictieve Flow-aftrek niet kunstmatig te laag worden. Voldoende verse meetpunten en de bestaande tijdsdekking blijven vereist.

Tijdens actief Mode-laden wordt geen schijnonafhankelijke huisreferentie geleerd uit dezelfde oude baseline en haar daarvan afgeleide EV-delta: fallbackreden `mode_house_unobserved`. Current/Hybrid in een gemengde installatie blijven hun eigen verse gerapporteerde stroom gebruiken. Een nieuwe gemengde test sluit tegelijkertijd 3.000 en 4.000 W van deze twee meettypen correct uit van het huisgemiddelde.

`recordEvHouseLoadSample()` gebruikt Mode-ampèreplaceholders niet meer als meetbewijs. `recordEvBatteryHouseReference()` leert bij een aangesloten Mode-EV evenmin een huisreferentie uit Flow-ampères of een nog niet fysiek bevestigde STOP. Zo wordt een laadstaart niet via dat gemengde meetpad als huislast aangeleerd.

**Vóór/na-reproductie:** 90 seconden stilstand, elke seconde P1/PV, 700 W huis, oude referentie 4.000 W, geen vernieuwde Flow-stroom. Basis: fallback en STOP na starten. Proefbuild: 60 seconden geldige dekking, referentie 700 W, circa 11.085 W EV-krediet en laden toegestaan. Ruwe resultaten: `validation/ev-peak-proof-before-after-1.2.4.json`.

### 2. Een lagere opdracht verandert niet direct de fysieke observatie

Bij Emergency → Smart kon de P1-meting nog 16 A bevatten terwijl de observatie al op de nieuwe 6 A-opdracht werd begrensd. Bij 5.200 W PV en 700 W huis werd dan onterecht geen bruikbaar PV-budget meer gevonden.

De proefbuild bewaart uitsluitend een eerder werkelijk onderbouwde P1-observatie door zo’n verlaging heen. De vorige observatie moet nog geldig zijn, dezelfde fysieke configuratierevisie hebben en afkomstig zijn van een eerdere meterperiode. Er wordt geen vermogen uit een hogere nominale instelling gemaakt.

De waarneming blijft begrensd door de actuele gemeten delta. Haar oorspronkelijke bestaande geldigheidsdeadline wordt niet verlengd op volgende samples. Zodra de gemeten last daalt, daalt de bruikbare observatie mee. Een gewone constante Smart-uitgang kan daardoor een nieuw huishoudelijk apparaat niet ineens als Standard-EV-last opvoeren. Er is geen nieuwe controlewachttijd of herstarthysteresis toegevoegd: de lagere opdracht volgt de bestaande timing, terwijl de meetobservatie haar eigen tijdsbetekenis behoudt.

Een eerste te ruime implementatie met altijd de Standard-bovengrens werd verworpen omdat bestaande huishoud-/airfryertests faalden. Die regressietests zijn **inhoudelijk ongewijzigd** gebleven en slagen met de uiteindelijke beperkte observatieoverbrugging.

**Vóór/na:** Smart-PV 6 A → Emergency 16 A → Smart-PV 6 A met achterlopende fysieke reactie. De basis maakte bij terugschakelen één STOP; de proefbuild schakelt zonder STOP terug naar 6 A. Zowel PV-vóór-P1 als P1-vóór-PV is opgenomen in de nieuwe tests.

### 3. Mode-laadstaart gebruikt P1-bewijs, geen Flow-ampères

De bestaande restlastboekhouding voor batterijbescherming kon bij Mode nog rechtstreeks Flow-stroom gebruiken. Dat pad gebruikt nu uitsluitend de bestaande bewaarde P1-Mode-observatie binnen de al bestaande geldigheid. Een Mode-Flow-daling creëert daar ook geen ampèregebaseerde pending-drop meer.

Deze restlast kan de batterij beschermen terwijl het oude fysieke verbruik nog in P1 aanwezig is. Zij geeft **geen laadpermission of herstartkrediet** aan de EV-allocator. De nieuwe test controleert 0 A én een onjuiste 30 A-Flow bij dezelfde fysieke laadstaart: geen extra EV-krediet, geen herstart en geen veronderstelde fysieke nul vóór de volgende P1-verandering. Zodra het echte P1-EV-deel wegvalt, verdwijnt de beschermde restlast.

## Eén gedeelde uitgangsbeoordeling

Nieuw `lib/ev-output-policy.js`, aangeroepen via `getEvOutputFor()`. De bestaande hoofdpublicatie, extra EV-slots en timingweergave gebruiken dezelfde projectie van het bestaande regelresultaat naar ampères, modus en permission. De oude modushelpers delegeren hiernaar. Deze functie doet geen planning of tweede vermogensverdeling.

De bestaande voorwaarden blijven gelden: module uit, disconnect, beleidsmatig/gepland stoppen, bereikt doel/sessie, geen geldige laadstap, bestaande herstartwachttijd en veiligheidsbegrenzing. Er is dus bewust geen regel ‘alleen een reeds gemeten overschrijding mag ooit stoppen’; die zou doelbereik en PV-only-beleid onwerkzaam maken en preventieve beveiliging uitschakelen.

De bestaande diagnostische uitgangsrecords krijgen `stopReason`, onder meer `disabled`, `disconnected`, `target_or_session`, `restart_hold`, `no_valid_charge_step`, `policy_or_measurement`, `insufficient_safe_budget` en `peak_guard`. Een aantoonbare P1-overschrijding van de veilige grens wordt onderscheiden van onvoldoende onderbouwd budget onder die grens. De oorspronkelijke menselijke beslisreden blijft aanwezig. Deze velden zijn diagnostiek en geen extra productinstellingen.

De numerieke gezamenlijke Peak Guard zit nog steeds in **dezelfde ongewijzigde** `calculateEvPortfolioDecisions()`. Ook `getEvCurrentForPower()` is ongewijzigd. Er wordt geen PV boven op netto P1 toegevoegd. Negatieve ruimte boven Peak Guard blijft het totale EV-budget verminderen. Fase-/hardwaregrenzen, gewichten, batterijondersteuning en prioriteiten blijven hun bestaande regelpaden volgen.

## Grenzen van de proefbuild

- Een gedeelde P1-meter blijft een schatting van het EV-aandeel. Gelijktijdige veranderingen van huisverbruik en EV zijn zonder extra meetbron niet altijd uniek te onderscheiden.
- Zonder voldoende betrouwbare stilstandshistoriek blijft een conservatieve fallback mogelijk. Een oude hoge referentie wordt tijdens actief laden niet door zelfbevestigende rekenregels ‘waar’ gemaakt en niet vervangen door fictieve nominale ampères. De proefbuild claimt dus geen gegarandeerde volle laadsnelheid bij iedere koude start zonder betrouwbare voorgeschiedenis.
- De observatieoverbrugging gebruikt bestaande meetgeldigheid. Een extreem trage of onvoorspelbare fysieke reactie kan daarom opnieuw veilige beperking vereisen; de geldigheid wordt niet eindeloos verlengd.
- P1/PV en de getekende batterijopdracht blijven de bestaande locatie-reconstructie vormen. Dit is geen nieuwe fysieke batterij- of EV-meter.
- EV-planning, kWh-voortgang en status-/connectie-Flow-invoer behouden hun bestaande betekenis. Alleen de hierboven beschreven fysieke Mode-vermogens- en huisreferentieboekhouding zijn als bronpad gecorrigeerd.

## Verificatie

**99 testbestanden geslaagd; 0 mislukt; 0 niet uitgevoerd binnen de suite.** Uitvoeringstijd circa 196 seconden. Nieuwe test: `test/ev-physical-proof-1.2.4.test.js`, **22 productiefunctie-testgroepen**.

Daaronder:

- 12 gesloten simulaties van telkens 13 minuten: Mode, Current en Hybrid × Smart/Standard 6/16 of 16/16 A × Smart/tarief of Emergency. Alle blijven op 16 A zonder een onterechte STOP; er wordt geen terugval naar 6 A als succes geaccepteerd.
- Mode zonder vernieuwde ampèrefeedback, verkeerde Flow-ampères, juiste onafhankelijke recente referentie en veilige fallback bij actief niet-onafhankelijk waarneembaar huisverbruik.
- Smart-PV → Emergency → Smart-PV voor alle drie sturingstypen, vertraagde fysieke reactie en beide P1/PV-eventvolgorden.
- Werkelijke Peak Guard-overschrijding stopt; PV-only zonder voldoende zon blijft een geldige niet-Peak-Guard-stop.
- Meerdere Mode-EV’s delen één pool; PV en getekende batterijbijdrage worden eenmaal verwerkt.
- Alle vier EV-slots gebruiken de gedeelde uitgangsprojectie. Bestaande doelen, disconnects en stopwachttijden blijven gezaghebbend.
- Mode-restlast na STOP wordt niet door 0/30 A-Flow-feedback tot nul of een fictief hoger verbruik gemaakt en financiert geen herstart.

Aanvullend: **55.296 vergelijkingen** van de werkelijke oude en nieuwe productiemethoden voor modussignalen, met nul verschillen. Dit verifieert het centraliseren van de uitgangsprojectie, niet de bewust gewijzigde meetbronnen. **Zeven bestaande Flow-planningssnapshots zijn vóór/na gelijk.** De eerdere 33 EV/batterij-overgangsscenario’s en 72 PV/huis-/wolken-/STOP-scenario’s slagen.

De oude huisreferentietests die Flow-stroom bij een actieve Mode-EV als onafhankelijke huiswaarneming gebruikten zijn expliciet aangepast aan de gevraagde bronregel: zij eisen nu fallback in die onbewijsbare situatie. Het positieve bewijs voor exclusie van werkelijk gemeten EV-verbruik is behouden in een extra gemengde Current/Hybrid-test. De suite voor de recente huisreferentie bevat nu 20 gevallen. Er zijn geen tests overgeslagen en de bestaande beveiligingstests tegen huishoudelijk verbruik zijn niet versoepeld.

Alle tests gebruiken echte productiefuncties met gesimuleerde Homey-I/O, tijd en fysieke laadreacties. **Niet uitgevoerd:** fysieke Homey Pro 2019/2023, echte laadpaal/auto, Homey-installatie/Store-validatie, praktijkmeting van CPU/geheugen en een langlopende hardwaretest. De ZIP is een volledige geteste broncode-proefbuild, geen fysieke certificering.

## CPU, geheugen en werkindicatoren

Drie afwisselende vóór/na-runs per scenario in Node, 1.500 opwarmstappen en 400 gemeten P1+PV-stappen. Alle gecontroleerde diagnostische tellers zijn per vergelijkingspaar gelijk. Steeds 7 contextevaluaties, 0 nieuwe uitgangsevents en 7 bestaande ingeplande timers in het meetvenster; geen extra planner-/portfolio-evaluaties of instellingenexpansies.

| Scenario | Mediane CPU vóór (ms) | Mediane CPU na (ms) | Heapdelta na GC vóór/na (bytes) | Mode-cache JSON vóór/na (bytes) |
|---|---:|---:|---:|---:|
| mode, 1 EV | 396.710 | 388.506 | -53000/-54200 | 153/216 |
| mode, 4 EV | 432.099 | 429.998 | -24352/-24792 | 201/282 |
| current, 4 EV | 432.064 | 428.679 | -17024/-16144 | 0/0 |

De extra cachevelden zijn begrensde arrays voor maximaal vier EV’s. JSON-grootte is geen exacte V8-objectgrootte. De GC-delta’s zijn ruisgevoelig; een negatieve waarde is geen aangetoonde geheugenbesparing. De gemeten CPU-tijden liggen in deze proeven dicht bij elkaar; dit onderbouwt geen algemene prestatiewinst of gelijkblijvend CPU-gebruik op Homey. Ruwe gegevens: `validation/ev-peak-proof-performance-1.2.4.json`.

## Bestanden, behoud en herhalen

Productie: `app.js`, nieuw `lib/ev-output-policy.js`. Tests: nieuw `test/ev-physical-proof-1.2.4.test.js`, twee losse reproductieworkers, expliciet bijgewerkte `test/ev-house-reference-1.2.4.test.js` en de toegestane methodediff in `test/ev-widget-regression-1.2.4.test.js`. Verder alleen testcommando’s in `package.json`, een proefbuildvermelding in README, dit rapport en validatiebestanden.

De EV-deadlineplanner, fysieke vermogensallocator en gezamenlijke Peak Guard-formule, doel-/Flow-invoerfuncties, Flow-herstel bij disconnect, batterijengine, huisbufferhelper, Savings/dagdata, WAF, widgets, instellingen, vertalingen, Flow-manifesten, drivers en korte release notes zijn behouden. De volledige lijst gewijzigde bestanden en methoden, beschermde ongewijzigde bestanden en SHA-256-waarden staan in `validation/ev-peak-proof-source-audit-1.2.4.json`.

Herhalen vanuit de uitgepakte appmap:

```sh
npm test
HEMS_EV_BASELINE=/pad/naar/ongewijzigde/1.2.4/HomeFlux-EMS node test/ev-widget-regression-1.2.4.test.js
node test/ev-idle-reference-proof.cjs . stale
node test/ev-peak-proof-replay.cjs . mode pv_transitions zero_once 300 6 700 700 5200 180
```

De afzonderlijke reproductieworkers tonen meetuitkomsten; de assertions voor gewenst gedrag staan in de nieuwe productiefunctietest. De bevroren oorspronkelijke ZIP blijft apart beschikbaar.
