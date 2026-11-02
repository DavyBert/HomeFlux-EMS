# EV STOP → START: recente huisreferentie — 1.2.4

Deze correctie is gebouwd op de volledige laatste 1.2.4-build, inclusief EV-bronverdeling, compacte widget, export, WAF en eerdere CPU-correcties. De versie, korte release notes, app-pagina en bestaande instellingen blijven behouden.

## Onderzoek vóór implementatie

De oude code is eerst gelezen en het probleem is gereproduceerd zonder wijzigingen aan productiecode. De relevante keten is:

- P1-Flow en de bestaande P1-API-route → `recordEvHouseLoadSample()`.
- `lib/ev-session.js`: `recordMinuteSample()` bewaart maximaal **40 minuutbuckets**. Dit is geen 30-minutenvenster. Binnen elke minuut wordt een rekenkundig gemiddelde opgebouwd.
- `getRobustAverageW()` selecteert de beschikbare minuutgemiddelden uit die 40 minuten. Vanaf tien buckets wordt aan beide kanten 10% weggelaten; de resterende minuutgemiddelden krijgen hetzelfde gewicht.
- `getLearnedEvHouseBaselineW()` gebruikt dat resultaat. Alleen zonder bruikbare historie is `evIdleHouseLoadW` de bestaande startupfallback. De ingestelde 4.000 W is geen bovengrens voor een geleerde huisreferentie.
- `handleEvDetectionConnectionTransition()` zet de gedeelde `portfolioBaselineW` vast wanneer een auto aansluit en er nog geen andere aangesloten EV met een bruikbare referentie is.
- Bij STOP, wachten of een volgende START binnen dezelfde verbinding wordt die vastgezette referentie niet opnieuw gekozen. De minuutgeschiedenis kan tijdens stilstand wel bijleren, maar dat wijzigt de al vastgezette portfolioreferentie niet.
- Tijdens laden kan `recordEvBatteryHouseReference()` met coherente verse stroom-/P1-/PV-metingen een aparte directe huisreferentie vormen. Zonder bevestigde stroom kan dit niet. Dat verklaart waarom een moduslader zonder actuele positieve stroomfeedback afhankelijk blijft van de oude referentie.
- `updateEvPortfolioLoadDetection()` vergelijkt het gereconstrueerde locatieverbruik met deze referentie om één modusgestuurde EV te herkennen. Een onjuiste hoge referentie kan dus `detectedEvLoadW = 0` en later `houseLoadHold = true` opleveren.

### De aangeleverde diagnose

De daadwerkelijk gelezen diagnose bevat 12.782 W voor zowel `houseBaselineW` als `houseReferenceW`, 4.670 W locatieverbruik, 0 W bevestigd EV-vermogen en een actieve `house_load_hold`. De batterijopdracht is **−100 W**. De berekening is daarom correct getekend:

`1.697 W P1 + 3.073 W PV − 100 W batterijladen = 4.670 W locatieverbruik`.

12.782 W is de behouden huisreferentie, geen uitkomst van deze actuele drie vermogens. Het grote verschil laat de bestaande laadherkenning niets als EV-last herkennen. De diagnose bevat geen oorspronkelijke 40-minutenhistorie of eerder aansluitmoment; de precieze losse metingen die 12.782 W opleverden zijn daardoor niet achteraf aantoonbaar.

Een losse lage locatieopname bewijst op zichzelf nog geen representatieve huisreferentie. De implementatievoorwaarde is daarom met een afzonderlijke productieproef bevestigd: de echte bestaande minuutregistratie wordt met 12.782 W gevuld, aansluiten legt die waarde vast, daarna volgen 65 seconden met 4.670 W huisverbruik. De oude build houdt 12.782 W bij START. Bij werkelijk EV-laden van ongeveer 6.582 W en gelijktijdig 6.000 W batterijladen wordt dit EV-vermogen vervolgens niet herkend. Peak Guard ziet daardoor geen actief EV-vermogen om één keer mee te tellen en vraagt ten onrechte STOP. Deze proef gebruikt constante, gesimuleerde fysieke stromen; het is geen reconstructie van alle niet-opgenomen events van de gebruiker.

De bronformule van Peak Guard is correct en blijft intact. De aantoonbare fout zit in de verouderde moduslaadherkenning die zijn input kan beïnvloeden. `houseLoadHold` zelf stuurt geen START/STOP; het beperkt laadherkenning en de EV-vrijstelling in de batterijregeling.

## Nieuwe recente referentie

Er is één kleine runtimebuffer in dezelfde centrale `evSessionDetection`, alleen als minstens één ingestelde EV **ControlType = mode** gebruikt. Dit betreft de sturingsinterface Stop/Smart/Standard, niet uitsluitend de werkingsmodus Slim laden. Emergency charge en SoC-doel gebruiken dezelfde veilige referentievernieuwing wanneer ze een echte modus-START publiceren. Alleen Current/Hybrid-installaties krijgen deze buffer of referentiewijziging niet.

De buffer wordt door de bestaande P1-events gevuld, zonder polling, fysieke device-reads of nieuwe timers. Maximaal één punt per seconde en **64 punten** worden bewaard. Snellere/gelijke timestamps maken geen extra meetdekking; een onbetrouwbaar punt kan niet door een duplicaat in dezelfde seconde worden uitgewist.

Per geldig punt wordt dezelfde fysieke locatiebelasting als voordien gebruikt:

`locatie = max(0, P1 + PV + batterijopdracht)`

Daar wordt **één keer** het totale actuele bevestigde EV-vermogen van alle ingestelde ingeschakelde EV’s afgetrokken. Het resultaat is niet-EV-huisverbruik. Het batterijteken blijft positief ontladen / negatief laden. De bestaande batterijopdracht is nog steeds een schatting van werkelijk batterijvermogen; er wordt geen nieuwe batterijmeting verzonnen.

Het gemiddelde is tijdgewogen over de meetintervallen tussen de bewaarde P1-punten, met de voorgaande waarde tot het volgende punt. Alleen bij een werkelijke STOP/ongestuurde uitgang → Smart/Standard-publicatie wordt het maximaal 60 seconden brede venster uitgelezen. Er wordt niet bij iedere contextupdate de hele buffer doorgerekend.

Een kandidaat wordt vlak vóór de bestaande moduspublicatie gelezen, nadat commandotiming en publicatiemutex de START toestaan. Pas nadat de modus-Flow-trigger succesvol is uitgevoerd, wordt de bruikbare referentie toegepast. Een mislukte publicatie wijzigt de referentie niet. Een te trage publicatie of intussen gewijzigde fysieke configuratie maakt de kandidaat onbruikbaar.

### Kwaliteit en fallback

Voor gebruik zijn nodig:

- Minimaal zes geldige P1-punten en **54 seconden dekking** van de laatste 60 seconden.
- Laatste P1-punt maximaal vijf seconden oud; geen gat tussen meetpunten groter dan tien seconden en geen onbetrouwbaar interval in het gebruikte venster.
- Bekende, niet-toekomstige P1-/PV-invoer; PV maximaal 60 seconden oud voor dit leerproces.
- Bekende EV-aansluiting. Niet aangesloten EV’s worden niet afgetrokken; oude positieve feedback na loskoppelen maakt de referentie dus niet kunstmatig laag.
- Voor aangesloten EV’s verse bestaande stroomfeedback, ontvangen ná de laatste eigen uitgangspublicatie. Positieve stroom moet bovendien maximaal tien seconden oud zijn en bij een daadwerkelijk actieve uitgang horen.
- Een STOP-uitgang met nog positieve feedback wordt uitgesloten. Een actieve modusuitgang met alleen 0 A wordt eveneens uitgesloten: dit kan een modusintegratie zonder echte stroommeter zijn. Tijdens zo’n pauze/startrespons geldt veilige fallback.
- Geen onwaarschijnlijk EV-vermogen boven de gereconstrueerde locatiebelasting en geen wijziging van fysieke EV-configuratie binnen het meetvenster.

Bij twijfel blijven de bestaande referentie en beveiligingen behouden. Er wordt geen onbekende meettijd als 0 W ingevuld. Een herstart heeft geen recent venster en begint met de bestaande fallback. De nieuwe buffer wordt niet persistent opgeslagen en raakt de daghistoriek niet.

Een betrouwbare nieuwe START-referentie vervangt de behouden portfolioreferentie en de aparte batterij-huisreferentie. Een oude huis-load-hold wordt vrijgegeven, maar de EV wordt **niet automatisch als ladend gemarkeerd** en krijgt geen fictieve actieve netvrijstelling. Positieve stroomfeedback of de bestaande bevestiging met minstens twee P1-monsters over vijf seconden blijft vereist. Stop-hold, commandotiming, tariefbeleid, EV-hardwarelimieten en veiligheids-STOP worden niet opgeheven.

Er wordt niet steeds opnieuw herijkt tijdens een actieve modusuitgang. Daardoor kan het groeiende EV-verbruik niet in zijn eigen START-referentie terechtkomen. Tijdens laden wordt de recente niet-EV-belasting wel bijgehouden voor een toekomstige START, voor zover de metingen betrouwbaar zijn. Bij uitsluitend fysieke voertuigpauze zonder een eigen STOP→START blijft de bestaande centrale sessie bepalend.

## Beperkte wijzigingen en diagnostiek

Bestaande productiemethoden gewijzigd:

1. `recordEvHouseLoadSample()` roept naast het ongewijzigde langetermijnpad het beperkte recente meetpad aan.
2. `publishEvDecision()` leest een kandidaat en past die bij een succesvol gepubliceerde modus-START toe.
3. `publishAdditionalEvDecision()` doet hetzelfde voor EV 2–4.
4. `getEvGridImportControlStatus()` geeft de laatste START-selectie als beperkte diagnostische metadata door.

Nieuwe appmethoden: `recordRecentEvHouseLoadSample()`, `getEvStartHouseReference()` en `applyEvStartHouseReference()`. `lib/ev-house-reference.js` bevat alleen de begrensde buffer en het tijdgewogen gemiddelde.

De bestaande `ev_command_component_published`-diagnostiek bevat bij de modus-START een `houseReference`-object. Het bestaande batterij-/EV-overzicht bevat dezelfde laatste selectie als `houseStartReference`. Die selectie bevat bron, toegepaste waarde, recent gemiddelde, eerdere baseline, aantallen, vensterduur, geldige dekking, fallback en fallbackreden. Het is een **momentopname van de laatste START**, niet een nieuwe volledige meting bij ieder P1-event. De actuele bestaande `houseReferenceW` en `houseLoadHold` blijven daarnaast zichtbaar en kunnen later veranderen door normale metingen.

De bestaande diagnose-coalescing blijft intact. Er wordt geen per-P1-eventlog toegevoegd. Geen wijzigingen aan Flow-kaarten, planner/deadlines, tariefkeuze, energieregistratie, widgets, PV-prioriteiten, vermogensverdeling of de Peak Guard-formule. De expliciet gevraagde correctie raakt wel de vier genoemde meet-/publicatiemethoden; die worden in de diffcontrole als toegestane afwijkingen gerapporteerd.

## Verificatie en prestaties

Alle **93 testbestanden slagen**, inclusief **19 gerichte scenario’s** met echte P1-/EV-Flow-listeners, registratie, moduspublicatie en de bestaande allocator. Meetgerichte fixtures isoleren de achtergrond-evaluatie; de foutreproductie, expliciete START-route en bestaande complete regressies testen tevens de echte sturing. Alleen Homey-I/O, fysieke feedback en klok zijn gesimuleerd.

De oude en nieuwe build zijn met identieke invoer gereproduceerd:

| Indicator | Voor correctie | Na correctie |
|---|---:|---:|
| Vastgelegde referentie bij aansluiten | 12.782 W | 12.782 W |
| Referentie bij START na betrouwbare stille meetminuut | 12.782 W | 4.670 W |
| Herkend actief EV-vermogen na hervatten | 0 W | circa 6.582 W |
| EV-verzoek in de gereproduceerde situatie | STOP / 0 A | Standard / 10 A |

De 19 testgroepen omvatten het gemelde verschil, een stilstaande EV, 7 kW gemeten laden bij 12 kW locatieverbruik, variabele meetintervallen, STOP/herstart, vertraagde feedback, onvoldoende dekking, P1-gaten, twee EV’s, veranderende PV, wisselende batterijrichting, ontbrekende PV en herstel, configuratiewijziging, trage/mislukte publicatie, Peak Guard, stop-hold, commandotiming, loskoppelen/heraansluiten, Slim laden met modussturing, een gepauzeerde auto met onzekere nulfeedback, Current/Hybrid zonder nieuwe buffer, en de harde geheugenbegrenzing.

De **149 overige bestaande EV-methoden** zijn bytegelijk aan de vorige volledige 1.2.4-build. De vier bewust gewijzigde methoden staan hierboven en in de regressie-JSON. De EV-Flow/plannerproef geeft **zeven identieke uitkomsten**. De eigenlijke planner, deadlines, vermogensverdeler, Peak Guard-formule, `lib/ev-session.js`, batterijplanning, prijzen, Savings, CSV en alle widgets zijn ongewijzigd. De gewone scenario’s behouden hun gedrag; alleen het aantoonbaar foutieve herstartgeval verandert zoals gevraagd.

### CPU en geheugen

Er is extra, begrensde verwerking; CPU en geheugen worden dus niet als exact ongewijzigd voorgesteld. Vijf afwisselende voor/na-processen meten telkens 50.000 aanroepen van de echte P1-huisregistratie na 5.000 opwarmaanroepen. Er is één modus-EV met verse 7 kW feedback, 5 kW huisverbruik en gesimuleerde 1-seconde-P1-tijd.

| Mediaan microbenchmark | Vorige build | Nieuwe build |
|---|---:|---:|
| CPU-tijd voor 50.000 aanroepen | 48.560 ms | 120.439 ms |
| CPU per aanroep | 0.971 µs | 2.409 µs |
| Nieuwe timers | 0 | 0 |
| Recente punten | 0 | 64 |

Het gemeten verschil is circa **1.438 µs CPU per meetaanroep** in deze container. De buffer telt ook na 10.000 punten nooit meer dan 64 entries. De gevulde buffer is als JSON 3841 bytes; dit is geen meting van de exacte JavaScript-heapgrootte. De behouden heapdelta’s na GC zijn ruisgevoelig en worden niet gebruikt om een geheugenverbetering te claimen.

De bredere bestaande P1/Flow-vergelijking met 1.000 opwarminputs en 600 gemeten stappen meldt CPU 627.838 → 607.109 ms en behouden heapdelta 130112 → 132888 bytes. Het is een gewone Current-route, dus vooral een algemene regressiemeting. Contextpasses, fysieke uitgangswijzigingen en alle gevolgde evaluatietellers zijn gelijk gebleven.

Dit zijn Node-containermetingen, geen Homey CPU-percentages. Een fysieke belasting-/duurstest op Homey Pro 2019 of 2023 en een echte laadpaaltest zijn niet uitgevoerd. Het bestaande Node-/Homey-compatibiliteitsbereik en de afhankelijkheden blijven gelijk. Er zijn geen nieuwe timers, polling of fysieke reads. Zie `validation/ev-house-reference-*.json` en de optionele reproduceerbare microbenchmark `test/ev-house-reference-benchmark.cjs`.

### Beperkingen

- Zonder een voldoende betrouwbare EV-/PV-/P1-meetminuut geldt bewust fallback. Een actieve modusuitgang met alleen nulfeedback wordt niet als zeker stilstaand beschouwd.
- De batterijcomponent blijft de bestaande gepubliceerde opdracht; afwijking van werkelijk batterijvermogen kan de referentieschatting beïnvloeden.
- De buffer vervangt geen stroommeter en schat geen onbekend EV-vermogen uit een opdracht.
- Een nieuwe START-referentie vereist een door HomeFlux zelf gepubliceerde modusovergang; een externe of uitsluitend fysieke voertuigpauze is geen extra stuurpad.
- De exacte oorspronkelijke meetreeks die in de korte diagnose tot 12.782 W leidde ontbreekt. Het behoud van die waarde en het verkeerde herstartgedrag zijn wel met echte productiefuncties gereproduceerd.

## Gewijzigde bestanden

- `app.js`
- `docs/ev-dashboard-1.2.4.md`
- `docs/ev-house-reference-1.2.4.md`
- `lib/ev-house-reference.js`
- `package.json`
- `test/ev-house-reference-1.2.4.test.js`
- `test/ev-house-reference-benchmark.cjs`
- `test/ev-widget-regression-1.2.4.test.js`
- `validation/ev-house-reference-1.2.4.json`
- `validation/ev-house-reference-performance-1.2.4.json`
- `validation/ev-house-reference-regression-1.2.4.json`
- `validation/ev-house-reference-reproduction-1.2.4.json`
- `validation/ev-house-reference-suite-1.2.4.json`
