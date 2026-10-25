# HomeFlux EMS 1.2.1 – Smarter Energy Insights

## Wat is toegevoegd

De bestaande EMS-statuswidget heeft een ronde energiebudgetindicator, afwisselende kritieke statusmeldingen en betekenisvolle statuskleuren. Drie onafhankelijke Homey-widgetinstellingen staan standaard aan. De bestaande dynamische hoogte, alle bestaande velden en de normale verversing om de 10 seconden blijven behouden.

## Exacte energiebudgetformule

Alle energietermen hieronder zijn in kWh. `C` is de effectieve batterijcapaciteit in kWh; SoC-grenzen zijn percentages.

```
uren = (bestaande planningChargeDeadlineAt - berekeningstijdstip) / 3.600.000
huisbehoefte = representatief niet-EV-dagverbruik / 24 × uren
WAF-batterijdoel = overdag ingestelde maximale SoC; 's nachts bestaand planningsdoel
vereistDoel = max(minimum-SoC, veiligheids-SoC, WAF-batterijdoel,
                  toepasselijke actieve maandreserve)
bestedingsgrens = max(vereistDoel, actuele ordinaryDischargeFloorSoc)
vrijeBatterij = max(0, C × (actueleSoC - bestedingsgrens) / 100)
batterijDoelTekort = max(0, C × (vereistDoel - actueleSoC) / 100)
WAF = PV-krediet + vrijeBatterij - batterijDoelTekort
      - huisbehoefte - EV-reserveringen
```

Het doel en de reserve worden eenmaal beschermd; `energyNeedKwh` uit het laadplan wordt niet nogmaals afgetrokken. Een Battery Save-ontlaadgrens kan besteding blokkeren zonder een nieuw laaddoel te creëren. Bijvoorbeeld in de nachtplanning: SoC 80%, planningsdoel 50%, actieve Battery Save-grens 90% betekent geen vrij besteedbare batterij-energie, maar ook geen verzonnen laadtekort tot 90%.

Gepland netladen wordt niet als gratis overschot opgeteld. HVAC en boiler zitten al in het huishoudelijke verbruik; er is geen tweede kWh-reservering toegevoegd op basis van hun vermogenswaarden zonder bekende looptijd. De indicator is een energiebudget, geen vermogensgarantie of efficiëntie-/verliesmodel.

Voorbeeld: 16,8 kWh dagelijks huisverbruik / 24 = 0,7 kW. Over 10 uur is 7 kWh nodig. Bij 12 kWh PV, een batterij van 10 kWh op 80% die nog 2 kWh tot de ingestelde 100% nodig heeft, en geen EV-reservering is het extra budget +3 kWh.

**Correctie binnen 1.2.1:** de dag-WAF gebruikt de ingestelde maximale SoC als aanvuldoel, dus gewoonlijk 100%. De lagere doelen en maxima voor gepland netladen mogen geen resterende batterijruimte als huishoudelijk PV-overschot vrijgeven. Bij 21,6 kWh capaciteit, 37,5% SoC en 60% netplanningsdoel is nog 13,50 kWh nodig tot 100%, niet slechts 4,86 kWh tot 60%. Bij 20,65 kWh resterende zon en 5,73 kWh verwacht huisverbruik volgt +1,42 kWh. Die 5,73 kWh is een expliciete testinvoer voor de vergelijking; de daadwerkelijke huishoudprognose van de installatie wordt nog steeds uit de bestaande daghistorie of ingestelde behoefte gehaald.

Het korte dagprincipe is: `resterende zon - batterij aanvullen tot maximale SoC - huisverbruik tot deadline - relevante EV-reserveringen`. De tekortformule heeft hetzelfde bedrag met omgekeerd teken. Extra PV verlaagt niet langer tegelijk het WAF-batterijdoel: bij verder gelijke invoer geeft 1 kWh extra zon precies 1 kWh extra dag-WAF. De bestaande nachtplanning gebruikt haar ochtenddoel; er wordt geen nachtelijke laadopdracht tot 100% geïntroduceerd.

## Herkomst en betrouwbaarheid

- **Huishoudelijk verbruik:** `autoTuneRuntime.planning.days`, maximaal de bestaande 14 dagtotalen, plus een voldoende complete lopende dag. `estimatedDemandKwh` is de bestaande integratie van net + PV + batterijvermogen minus het gemeten EV-vermogen. Geen nieuwe meet- of leerfunctie.
- **Representatieve dagwaarde:** bestaande Autotune-methode: dagen met minstens 18 uur dekking, genormaliseerd naar 24 uur, mediaan van minstens twee bruikbare dagwaarden (positief, maximaal 100 kWh). Bij onvoldoende historie wordt de ingestelde `expectedEnergyNeedKwh` gebruikt. Die bron wordt zichtbaar vastgelegd in de status; het is dan een ingestelde verwachting, geen gemeten gemiddelde.
- **Batterij:** bestaande capaciteitsgewogen SoC en effectieve capaciteit. Alle geconfigureerde batterijen moeten een geldige SoC hebben. Battery Save en zonkansreserve worden overgenomen uit het al berekende `ordinaryDischargeFloorSoc`, naast de maximale SoC voor de dag-WAF (of het bestaande ochtenddoel voor de nacht-WAF) en de maandreserve. Er is geen tweede reservebeleid.
- **PV overdag:** bestaande `today_remaining`-waarde uit het werkelijke dagplan. De app heeft geen PV-prognose per uur. Dit blijft daarom dezelfde daginschatting als de planner: een deel kan bij een vroeg ingesteld dagdoel in werkelijkheid pas na dat doel worden geproduceerd. Er wordt geen fictieve productiecurve of schijnnauwkeurige tijdverdeling gemaakt. Een volledige-dagfallback zonder echte resterende prognose geeft `--`.
- **PV 's nachts:** nul PV-krediet vóór het ochtenddoel. De volledige prognose voor morgen mag niet worden opgeteld bij energie die vóór dat ochtenddoel beschikbaar is. De bestaande nachtmediaan blijft het batterijdoel bepalen; de indicator verandert die mediaan of dat doel niet. Ook eventuele productie kort vóór een zomer-ochtenddoel wordt conservatief niet ingeboekt.
- **EV:** bestaande actieve Flow-kWh- en SoC-doelen, gegarandeerde instellingen en SoC-doelmodus. Alleen ingeschakelde, aangesloten, niet beëindigde EV-sessies tellen mee. SoC gebruikt de bestaande versheidscontrole. Doelen vóór het batterijdoel reserveren hun resterende behoefte. Voor latere doelen worden alleen bestaande, bij de actuele doel-/instellingenrevisie passende laadslots tot het batterijdoel meegerekend. Ontbrekende betrouwbare deadline-/horizondata geeft `--`. Bestaande toegewezen nachtoverschotsturing wordt tot dit doel meegerekend; dezelfde energie voor een EV-minimum wordt daarbij niet tweemaal gereserveerd.

Alle waarden blijven schattingen: een gemiddeld huisverbruik voorspelt geen afzonderlijke toestellen of plotselinge pieken. Een positief budget garandeert geen onmiddellijke PV-dekking. Het volledige PV-dagtotaal kan met de huidige invoer niet exact op een vroeger doelmoment worden begrensd.

## Integratie, cache en herstart

`calculateBudget` wordt uitsluitend aangeroepen binnen `refreshPlanningInContext`, nadat de bestaande cache-/intervalcontrole een werkelijk nieuw `buildSocPlan` heeft uitgevoerd. Hoogstens één budgetberekening per zo'n plan. De bestaande planningstimers en intervallen veranderen niet.

De al bestaande reguliere `evaluate` in de contextpass staat direct vóór de planopbouw, zodat het plan de werkelijk geldende ontlaadgrens kan hergebruiken. Deze evaluatie wordt niet verdubbeld. Het snelle P1-pad, de engine, EV-portfolioberekeningen en EV-heartbeats krijgen geen WAF-berekening.

Het resultaat staat in `planningCache.value.plan.energyBudget`: waarde, berekeningstijd, WAF-batterijdoel, afzonderlijk netplanningsdoel, doelbron, geldigheid, dag-/nachtfase, gegevensbronnen en uitgesplitste energietermen. De API geeft uitsluitend een nog geldig opgeslagen resultaat door. De widget leest dit resultaat en verzorgt alleen opmaak, kleur en geldigheidsweergave.

De geldigheid loopt tot het bestaande doelmoment. Ontbrekende of verlopen data geeft een neutrale `--`. Dit geldt ook bij niet beschikbare batterijregeling, externe Hybrid-aansturing, standby of onbekende EV-reserveringen. Het plan is, net als voorheen, een geheugen-cache. Na een herstart verschijnt geen oude WAF-waarde; alleen een normale bestaande nieuwe planningsberekening kan weer een waarde leveren. Widgetopeningen en statusuitlezingen plannen niets opnieuw.

## Geselecteerde bestaande waarschuwingen

| Prioriteit | Bestaande bron | Activering en herstel | Werkelijke invloed |
|---|---|---|---|
| 1 | `getInputReadiness().ready/missing` | Netmeting ontbreekt, ongeldig of verouderd; herstelt wanneer dezelfde bestaande controle weer gereed is | Harde blokkering van normale EMS-uitvoer |
| 2 | `latestResult.safetySocRecoveryActive` | Bestaande automatische herstelmodus onder veiligheids-SoC; vervalt wanneer de productiecode die status opheft | Veiligheidsherstel krijgt voorrang op gewone tariefplanning |
| 3 | `balanceMonitor.warningActive/warningText` | Bestaande groeiende SoC-spreiding, ingestelde drempels en bevestigingstijd; herstel volgens `updateBalanceHealth` | Aandacht voor foutieve Flow-koppeling of verslechterende balans; op zichzelf geen nieuwe uitvoerblokkering |

De widget kiest de eerste actieve conditie en toont een korte NL/EN-waarschuwing. De bestaande details blijven als tooltip beschikbaar. Er wordt geen nieuwe foutconditie bedacht. Alleen de weergave van de reeds bestaande veiligheidsstatus is nieuw.

Uitgesloten: gewone laad-/ontlaadbeslissingen, tariefwisselingen, doel nog niet bereikt, informatieve planningsregels, optionele ontbrekende PV-data, prijsdiagnostiek, normale EV-wachtstanden, handmatig uitgeschakelde regeling en gewone kleine SoC-verschillen. Er bestaat geen betrouwbare algemene batterijcommunicatiefout in deze code: een oude SoC blijft bewust geldig en wordt niet als communicatiestoring geïnterpreteerd.

Normale beslissing en hoogste waarschuwing wisselen lokaal om de 5 seconden. Zonder actieve toegestane waarschuwing bestaat geen wisseltimer. De API-verversing blijft 10 seconden. Bij herstel verdwijnt de waarschuwing op de volgende normale statusupdate. De WAF-cirkel blijft staan. De tekstindeling reserveert ruimte voor beide berichten, zodat de wissel geen hoogtewijziging veroorzaakt. Timers stoppen bij verborgen widgets/pagehide en worden op hervatten enkelvoudig gestart; listeners worden bij unload opgeruimd.

## Statuskleuren

| Bestaand veld | Toekenning |
|---|---|
| Batterij-SoC | Rood op/onder minimum-SoC; oranje boven minimum maar op/onder veiligheids-SoC; groen op/boven het relevante planningsdoel; anders neutraal. Onder een nog te bereiken doel is geen fout. Onbekende SoC blijft neutraal en wordt als `—` getoond. |
| EMS-uitvoer/batterijcommando | Alleen laden: groen; ontladen of gemengde actieve richtingen: blauw; rust: neutraal. De expliciete interne commandorichting bepaalt de kleur, niet het eventueel geïnverteerde gepubliceerde watt-teken. |
| Batterijdoel | Groen wanneer bereikt; anders neutraal. |
| PV in plan / nog verwachte PV | Goud bij een bestaande bruikbare positieve prognose; anders neutraal. |
| Peak Guard | Oranje bij de bestaande actieve Peak Guard-status; normale bewaking neutraal. Geen rood uitsluitend door een wattwaarde. |
| EV-status | Groen bij aangesloten EV met werkelijk gepubliceerde laad-toestemming en positieve gepubliceerde stroom; wachten/stoppen neutraal. |
| Kritieke wisselmelding | Rode tekst, altijd met expliciet waarschuwingswoord, ook herkenbaar met kleuren uit. |
| WAF | Doorlopende HSL-schaal: rood bij ≤ -4 kWh, via oranje bij +1 kWh naar groen bij ≥ +7 kWh; geen abrupte kleurstappen. Donkere gevulde cirkel met witte tekst. |

De bestaande statuswidget heeft geen afzonderlijke velden voor live netvermogen en live PV-vermogen. Er zijn geen extra meetvelden toegevoegd. Energiebehoefte, geplande netenergie en gewone tarief-/wachtinformatie blijven neutraal.

Alleen de numerieke/statuswaarden krijgen accentkleur. Gewone velden krijgen geen nieuwe gekleurde achtergronden. De statuskleuren zijn verzadigder gemaakt en gekleurde waarden hebben fontgewicht 800. De WAF-cirkel gebruikt 96% verzadiging met een doorlopende helderheidsaanpassing voor leesbare witte tekst. Licht/donker hebben afzonderlijke CSS-paletten; de bestaande Homey-achtergrond- en tekstvariabelen blijven gebruikt. De WAF-cirkel is 52 × 52 px en krimpt niet tot een ovaal. De tooltip vermeldt ook tot welke SoC voor de batterij wordt gereserveerd, zodat het verschil met het netplanningsdoel duidelijk is.

## Instellingen en migratie

| ID | Nederlands | Engels | Default |
|---|---|---|---|
| `showEnergyBudget` | WAF-energie-indicator tonen | Show WAF energy indicator | `true` |
| `showCriticalAlerts` | Kritieke EMS-waarschuwingen tonen | Show critical EMS alerts | `true` |
| `statusColors` | Kleuren in widget | Colors in widget | `true` |

De bestaande Homey-widgetinstellingen blijven de enige opslag. Ontbrekende nieuwe waarden worden als `true` gelezen; expliciet `false` blijft `false`. Er is geen overschrijvende migratie of extra app-instelling. Herstarten of opnieuw openen schrijft niets terug. Met kleuren uit zijn gewone waarden en de WAF neutraal; alle getallen en waarschuwingsteksten blijven aanwezig. Met WAF uit verdwijnt alleen de cirkel. Met waarschuwingen uit blijft de normale beslissing staan. Een expliciete bestaande keuze om de beslissing te verbergen blijft behouden; de WAF kan onafhankelijk zichtbaar blijven.

## Validatie

De reproduceerbare uitvoer staat onder `validation/widget-*.json`. Uitvoeren:

```
npm test
node --expose-gc test/widget-insights-1.2.1.test.js
node test/widget-insights-lifecycle-1.2.1.test.js
node test/widget-insights-control-1.2.1.cjs /pad/naar/originele/HomeFlux-EMS
```

De laatste opdracht vergelijkt met de aangeleverde ongewijzigde 1.1.20-bron.

- Volledige regressiesuite: **82 van 82 testbestanden geslaagd**; resultaten in `widget-release-suite-1.2.1.json`.
- Budget-/widgettests: positieve/negatieve budgetten, screenshotreproductie met +1,42 kWh, onafhankelijkheid van netplanningsdoelen/-slots, instelbare maximale SoC, enkelvoudig PV-krediet, daggemiddelde, reserves zonder dubbel tellen, actuele Battery Save-grens, EV-kWh/SoC-kaarten, nacht/dag, ontbrekende data, verlopen cache, middernacht, Belgische wintertijdomslag, echte app-herstart en NL/EN-DOM-weergave.
- Instrumentatie: één geforceerd echt plan geeft één WAF-berekening; 300 echte P1-inputs, 100 statusuitlezingen, EV-heartbeat-/portfolio-aanroepen en ongewijzigde cache geven samen nul extra WAF-berekeningen.
- Levenscyclus: bestaande 10-secondenpolling, lokale 5-secondenwissel zonder API-verzoek, herstel, kleuren uit, verborgen widget, pagehide/pageshow en listeneropruiming.
- A/B: 12 scenario's (current/hybrid/mode × één/vier EV's × 0/3000 W PV), inclusief echte Flow-doelen. Batterij-/EV-publicaties, beslissingen en bestaande planinhoud zijn exact gelijk aan 1.1.20.
- Een bestaande EV-test gebruikte `Date.now()` als virtuele klok maar `new Date()` als werkelijke hostdatum. Die test faalde ook op de originele ZIP. Met een consistente virtuele `Date` slagen alle 14 oorspronkelijke scenario's. Alleen de testklok is aangepast; assertions en productieregels zijn behouden.

Er is geen fysieke Homey-test uitgevoerd. Browsergebaseerde visuele controle kon in deze omgeving niet worden uitgevoerd: de benodigde browser was niet aanwezig en kon niet worden opgehaald. DOM-gedrag, tekstrotatie, instellingen en CSS-opbouw zijn gecontroleerd; feitelijke mobiele widgetbreedtes en Homey-themadoorgifte moeten nog op een Homey-dashboard worden bekeken.

## CPU en geheugen

De gerichte meting staat in `widget-insights-1.2.1.json`. De laatste run: 10,000 budgetberekeningen in 11.68 ms wandtijd en 19.69 ms proces-CPU (circa 1.97 microseconde CPU per budgetberekening). Het geteste gecachte budget is 513 bytes als JSON. Na geforceerde GC was de heapdelta -55672 bytes; die waarde is GC-ruis en geen langetermijngarantie. De microbenchmark meet uitsluitend de budgetfunctie, niet een volledig Homey-regelinterval. De opgeslagen cachegrootte is gemeten als JSON; dit is geen meting van JavaScript-heapgebruik op Homey. Allocatie-/GC-delta's uit de container zijn niet geschikt om een Homey-CPU-percentage of langdurig geheugengebruik te voorspellen.

De architectuurtest is hier het belangrijkste bewijs: geen WAF-rekenwerk in de snelle regeling of status-/EV-paden en geen extra planningscycli, polling of EV-portfolioberekeningen door deze uitbreiding. De bestaande engine, flexibele-load-logica en hardware-uitvoerfuncties zijn niet gewijzigd. De A/B-replays en bestaande regressietests controleren het behoud van batterijsturing, EV, HVAC, boiler, veiligheidsgrenzen en PV-prioriteit.

## Gewijzigde bestanden

- `app.js`: koppeling met echte planning, hergebruik actuele ontlaadgrens, gecachte budgetstatus, selectie bestaande kritieke toestanden, minimum-SoC voor presentatie.
- `lib/widget-energy-budget.js`: uitsluitend tijdens echte planning gebruikte budgetfunctie en hergebruik bestaande huishoudhistorie.
- `widgets/status/public/index.html`: cirkel, lokale tekstwissel, kleuren, defaults, opmaak en timer-/listenerbeheer.
- `widgets/status/widget.compose.json`, `app.json`: drie widgetopties en overeenkomstig gegenereerd manifest.
- `locales/en.json`, `locales/nl.json`: korte waarschuwingen en budgetomschrijving.
- `.homeycompose/app.json`, `package.json`, `package-lock.json`: consistente releaseversie; testcommando's in `package.json`.
- `.homeychangelog.json`, `README.md`: uitsluitend nieuwe functionaliteit als release notes; de appbeschrijvingen `README.txt` en `README.nl.txt` zijn ongewijzigd.
- `test/widget-insights-1.2.1.test.js`, `test/widget-insights-lifecycle-1.2.1.test.js`, `test/widget-insights-control-1.2.1.cjs`: reproduceerbare feature-, lifecycle- en A/B-tests.
- `test/ev-battery-protection-1.1.6.test.js`: consistente virtuele testdatum.
- `test/widget.test.js`, `test/settings-startup.test.js`, `test/planning-monitor-1.1.16.test.js`: bestaande versieasserties aangepast naar 1.2.1 en opnieuw geslaagd.
- Dit document en `validation/widget-*`: implementatierapport en testresultaten.

## Intensere widgetkleuren binnen 1.2.1

De groene, oranje, rode, blauwe en gouden accenten zijn krachtiger gemaakt. Donkere weergave gebruikt heldere verzadigde kleuren. Alleen waarden met ingeschakelde statuskleur krijgen extra vetdruk. Met kleuren uit blijft de neutrale weergave behouden. De WAF-schaal en betekenis blijven gelijk; de kleurvulling is verzadigder. De drie bestaande widgettests slagen. Gemeten contrast: alle statuskleuren minstens 4,5:1 tegen de geteste lichte/donkere rijachtergrond; WAF minstens 4,97:1 met witte tekst over 1.201 kleurstappen. Meetwaarden: `validation/widget-colors-1.2.1.json`.
