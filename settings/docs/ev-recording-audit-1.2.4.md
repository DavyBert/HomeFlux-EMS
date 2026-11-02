# EV-energieregistratie — onderzoek en correctie binnen 1.2.4

## Conclusie op basis van de aangeleverde gegevens

De aangeleverde diagnose van 27 oktober toont bij de BMW **0 A ontvangen laadstroom**, 107,273 tot 118,512 seconden oud en als niet-vers aangemerkt. De **10 A / 6.582 W** zijn berekende/gevraagde waarden. De regeling herkent een EV-last via de woningmeting; dat is geen afzonderlijke stroommeting van de auto. In deze opname staat het meetbereik op `individual` (Afzonderlijke EV), dus uitsluiting via `unavailable` verklaart deze opname niet.

De CSV-structuur werkt: `ev_data_available = 1`, `ev_coverage_seconds = 10352.391` en `ev1_missing_feedback_seconds = 3376.117`, met 0 EV-kWh. De diagnose bevat geen verse positieve stroomfeedback die voor die opname positieve geregistreerde laadenergie zou moeten opleveren. Een aangevraagd vermogen wordt niet als levering geboekt. De inputmonitor bevat in zijn korte opname P1- en PV-updates, maar geen EV-statusupdate. Het volledige verloop van de ruim 56 minuten ontbrekende feedback kan uit deze korte opnames niet gereconstrueerd worden.

**Deze correctie zorgt dus niet dat de BMW zonder bruikbare laadstroomfeedback ineens energie registreert.** Het bestaande EV-status-Flow-invoerpad moet de werkelijk gemeten laadstroom blijven ontvangen, ook wanneer die gelijk blijft. Zonder betrouwbare individuele meting is een exacte energiehoeveelheid uit alleen de laadmodus of woningmeting niet aangetoond. Historische ontbrekende energie wordt niet achteraf ingevuld.

## Afzonderlijk aangetoonde fout en minimale correctie

De bestaande centrale Savings-recorder sloeg een volledig interval over wanneer P1- of PV-invoer ontbrak, P1 verouderd was of positieve PV-invoer ouder dan vijf minuten was. Daardoor ging ook **wel geldige EV-stroomfeedback** verloren. Dit is met de echte productiefuncties gereproduceerd: 3.600 W, 60 seconden en ontbrekende PV-invoer leverden vóór de correctie geen EV-dagdata op, terwijl 0,06 kWh geleverd was volgens de EV-feedback.

Nu roept dezelfde centrale recorder dezelfde intervalfunctie eenmaal aan met een intern kenmerk `siteKnown`. Bij onbekende sitegegevens registreert uitsluitend de bestaande EV-uitsplitsing de geldige EV-laadenergie, volledig onder **onbekende herkomst**. De algemene Savings-buckets, kosten en batterijvoorraad worden voor dat interval niet bijgewerkt. Bij terugkeer van de sitegegevens wordt de normale verdeling hervat, zonder dubbele integratie of terugvulling.

Getest voor ontbrekende P1, verouderde P1, ontbrekende PV, verouderde positieve PV en ongeldige PV: de EV-laadenergie blijft behouden, bronnen blijven onbekend en algemene energiebuckets en batterijvoorraad blijven identiek. De normale verwerking met bruikbare sitegegevens is inhoudelijk ongewijzigd. Er is geen aparte energierecorder, timer, polling, database of extra planning toegevoegd.

## Volledige registratieketen

1. De genummerde EV-statuskaarten (`set_ev1_status` t/m `set_ev4_status`) en de bestaande selector-/geconfigureerde kaarten ontvangen `connected` en `charge_current`. De API gebruikt dezelfde bestaande invoer via `setInput()` met `ev`/`evs`.
2. De listener rekent het voorgaande interval af voordat de nieuwe EV-feedback wordt opgeslagen. `updateEvStatusInput()` bewaart de stroom, ontvangsttijd en seen-flags en onderhoudt de bestaande sessiedetectie. De aparte kWh-doelvoortgang blijft ongewijzigd.
3. `recordSavingsSample()` is de enige centrale integratieklok. P1/PV-events, bestaande opslagmomenten en export-/statusaanvragen gebruiken deze functie. Dezelfde tijdstempel telt nooit twee keer. Er wordt niet over een herstart/offlineperiode geëxtrapoleerd.
4. `getEvSavingsReadings()` gebruikt uitsluitend bestaande EV-feedback: positieve stroom × `evPowerPerAmp()` volgens de ingestelde spanning, fasen en spanningsreferentie. Er is geen nieuwe W-Flow of kWh-teller ingevoerd. Testvermogens in W zijn voor het bestaande Flow-invoerpad naar ampères omgerekend.
5. `lib/savings.js/integrateInterval()` roept `lib/ev-energy-breakdown.js/integrate()` aan voor dezelfde meetperiode. Bij ontbrekende sitegegevens is de bronverdeling onbekend; bij bruikbare data blijft de bestaande conservatieve verdeling gelden.
6. `day.ev.total` en `day.ev.byId` worden in `_savingsToday`/`_savingsHistory` bewaard, genormaliseerd en gecompacteerd. De widget en `getSavingsCsv()` lezen deze centrale data. `lib/savings-history.js/toCsv()` koppelt de EV-kolommen aan deze geregistreerde waarden, zonder extra integratie.

Registratie vereist een geconfigureerde en ingeschakelde EV, een bruikbare aansluitstatus en verse laadstroomfeedback, met passend meetbereik. Er is **geen** vereiste voor een actief Flow-doel, EV-planning, gepubliceerd laadcommando, batterij of ingeschakelde batterijregeling.

## Betekenis van beschikbaarheid en ontbrekende feedback

- `ev_data_available`: er bestaat EV-dagdata; dit bewijst geen positieve laadenergie of volledige meetdekking.
- `ev_coverage_seconds`: duur van de centraal beoordeelde EV-intervallen, ook als de stroomfeedback ontbreekt. Dit is geen teller van uitsluitend geldige ampèremetingen.
- `missing_feedback_seconds`: beoordeelde tijd zonder bruikbare individuele stroom-/aansluitfeedback. Dit is **niet uitsluitend tijd tijdens een bewezen actieve laadsessie**. De groepswaarde telt de ontbrekende tijd over betrokken EV-metingen op.
- Een herhaalde, actuele 0 A bij een aangesloten EV is geldig en geeft 0 kWh zonder ontbrekende feedback. Ook 0 A moet opnieuw worden gemeld; de bestaande stroomhorizon blijft 60 seconden.
- Een onbekende aansluiting of ontbrekende/verouderde stroom geeft ontbrekende dekking. Een expliciet ontkoppelde EV geldt als bekend uitgeschakeld en krijgt geen verzonnen energie of ontbrekende stroomdekking.
- Een centrale sessiestatus “Laden” of “Beëindigd” vervangt geen vermogensmeting. De widget neemt die centrale laadstatus over; de boekhouding blijft op de bruikbare metingen gebaseerd.
- Bij `unavailable` wordt stroomfeedback bewust uitgesloten. Bij één gedeelde meter wordt de energie eenmaal als groep geboekt en niet opnieuw aan individuele EV’s toegewezen.

De definities, nulwaarden en geldigheidsduur van bestaande tellers zijn behouden. De correctie zorgt dat ook een interval met geldige EV-feedback en onbekende sitegegevens centraal beoordeeld kan worden.

## Bronnen, energie en geld

Energie uit stroom × spanning × fasen blijft gemarkeerd als **geschatte energie**. Directe PV naar EV is onderdeel van het bestaande directe-PV-totaal, niet extra energie. Eén gemeenschappelijke pool wordt over meerdere EV’s verdeeld. Batterijcommando’s zijn geen betrouwbare batterijmeting; bestaande batterijgevallen blijven daarom onbekend en worden niet als directe PV geboekt.

De invarianten blijven gelden: PV naar EV ≤ directe PV; som individuele EV-energie ≤ EV-groepstotaal; PV + net + batterij + onbekend = EV-totaal. Ontbrekende metingen worden niet gebruikt om willekeurige bronpercentages of positieve kosten te fabriceren. Onbekende herkomst levert geen toegeschreven net-/PV-kosten of besparingen op; ontbrekende tarieven blijven via `unpricedKwh` zichtbaar. Bestaande getekende intervalprijzen, injectievergoeding en Savings-definities blijven behouden.

## Testresultaten

**92/92 testbestanden geslaagd**, geen onverwachte mislukte tests. De oorspronkelijke reproductie zonder PV-invoer faalde vóór de correctie zoals verwacht. De definitieve centrale registratieaudit omvat **21 scenario’s** met echte productiefuncties en gesimuleerde Homey-I/O.

| Vereist geval | Uitkomst |
|---|---|
| A: 60 minuten actuele 0 W | 0 kWh, 0 ontbrekende seconden |
| B/H: 60 minuten 3.600 W, zonder planning/commandopublicatie | 3,6 kWh; CSV EV1 = 3,6 kWh |
| C: 15 minuten 1/2/3/0 kW | 1,5 kWh |
| D: 3.600 W, daarna geen nieuwe feedback gedurende 180 s | 0,06 kWh tot de 60-s-horizon; 120 s ontbrekende feedback |
| E: 30 minuten laden, herstart met 120 s offline, 30 minuten laden | 3,6 kWh; historische energie behouden; geen energie voor offlineperiode |
| F: 23:30–00:30 bij 3.600 W | 1,8 kWh per lokale kalenderdag |
| G: twee EV’s van 3 en 4 kW, 60 minuten | 3 + 4 = 7 kWh; geen dubbele bronpool |
| G gedeeld: één gezamenlijke meting van 7 kW, 10 minuten | 1,1667 kWh als groep; individuele toewijzing 0 |
| Alle vier combinaties batterij 0/1 en EMS aan/uit | Steeds 0,6 kWh in 10 minuten |
| Ontbrekende/verouderde sitegegevens met verse EV-feedback | Energie behouden als onbekend; site Savings en batterijvoorraad onveranderd |
| Herstel sitegegevens | Geen dubbeltelling of terugvulling van site Savings |
| Zomer-/wintertijd | 3,6 kWh per daadwerkelijk verstreken uur bij beide overgangen |
| 1-/3-fasenconfiguratie na afgerekende meetgrens | 4,6 kWh in twee halve uren bij 2,3/6,9 kW |
| 100 herhaalde recorder-/widget-/exportreads op dezelfde tijdstempel | Geen extra energie |
| BMW-reproductie: woningmeting herkent laden; ontvangen 0 A veroudert | Status “Laden” via woningmeting, 0 kWh, terecht ontbrekende feedback |

Alle **153 bestaande EV-methoden** in app.js zijn bytegelijk aan de voorgaande 1.2.4-build. Alleen `recordSavingsSample()` veranderde in app.js. Zeven echte Flow-/planningssnapshots blijven identiek, evenals de geteste evaluatie- en commandotellers. De bestaande brede suites omvatten onder meer batterijplanning, WAF, EV-sturing, Peak Guard, Savings, HVAC, boiler, persistentie en widgets.

## Prestatiecontrole

Eén afzonderlijke vergelijking na afloop van de tests: twee EV’s, 1.000 gelijke opwarminputs en 600 gemeten P1-stappen, dezelfde productiecode met gesimuleerde Homey-I/O en GC voor/na. Dit meet de normale route met bruikbare sitegegevens. Bij ontbrekende sitegegevens doet de nieuwe route noodzakelijk registratie die eerder werd overgeslagen.

| Indicator | Vorige 1.2.4 | Correctie |
|---|---:|---:|
| Gemeten stappen | 600 | 600 |
| Node CPU-tijd (ms) | 484.622 | 425.640 |
| Verstreken tijd (ms) | 448.477 | 390.494 |
| Behouden heapdelta na GC (bytes) | 130400 | 129224 |
| Extra contextpasses | 1 | 1 |
| Extra fysieke flexible-load writes | 0 | 0 |
| `gridInputs` | 1603 | 1603 |
| `fastEvaluations` | 1603 | 1603 |
| `contextEvaluations` | 20 | 20 |
| `planningCalculations` | 1 | 1 |
| `widgetEnergyBudgetCalculations` | 1 | 1 |


De evaluatiefrequentie en fysieke schrijftellers zijn gelijk. De tijdmetingen variëren met Node/JIT/GC en bewijzen geen snelheidsverbetering of apparaatpercentage. Er zijn geen nieuwe timers, polling of listeners. Er is geen CPU-percentage of langdurig geheugenverloop op een fysieke Homey gemeten.

## Grenzen en oplevering

Geen fysieke Homey-installatie of echte EV-/batterijtest uitgevoerd. Werkelijke laadenergie bij de BMW kan pas met actuele betrouwbare laadstroomfeedback worden bevestigd. Woningmeting en een aangevraagd setpoint mogen daarvoor niet achteraf als exacte meting worden gebruikt. De volledige 56 minuten ontbrekende feedback zijn niet gereconstrueerd en worden niet kunstmatig ingevuld.

Productieaanpassing: `app.js/recordSavingsSample()` en de private intervaloptie in `lib/savings.js/integrateInterval()`. Verder zijn een gerichte test, validatierapporten, deze documentatie en de testcommando’s toegevoegd. Versie blijft **1.2.4**; bestaande korte EN/NL-release notes, previews, instellingen en historische data blijven behouden.

## Latere correctie binnen dezelfde versie

De eerdere volledige onbekend-markering bij een batterijactie is nadien vervangen door een geschatte uitsplitsing uit de bestaande Savings-bronpools. Zie [EV-bronverdeling en actief laadschema](ev-source-allocation-1.2.4.md). De meetkwaliteit, ontbrekende-feedbackdefinities en site-uitvalcorrectie uit deze audit blijven behouden.
