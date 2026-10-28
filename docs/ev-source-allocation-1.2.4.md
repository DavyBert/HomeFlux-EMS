# EV-bronverdeling en actief laadschema — 1.2.4

Deze vervolgcorrectie is gebaseerd op de volledige voorgaande 1.2.4-build met de EV-registratiecorrectie en de tijdelijke Emergency-hint. Versie en korte release notes blijven ongewijzigd.

## Onderzoek en oorzaak

`app.recordSavingsSample()` bepaalt hetzelfde centrale interval voor Savings en EV. `lib/savings.js` bepaalt de bestaande directe PV- en netpools na export en batterijladen. `lib/ev-energy-breakdown.js` verdeelt uitsluitend die pools over de EV-subvelden van dezelfde dagdata.

De oude EV-bronvoorwaarde bevatte `!sources.batteryActive`: elk batterijcommando boven 0,5 W in laad- of ontlaadrichting maakte de **volledige** EV-herkomst onbekend. Daardoor kon goede EV-stroomfeedback wel EV-kWh opleveren, maar geen enkele PV-/net-kWh, zelfs met verse sitegegevens. Reproductie met echte productiefuncties: 6 kW PV + 3 kW net, 2 kW batterijladen, 5 kW EV en 2 kW overig huisverbruik leverde in vijf minuten 0,416667 kWh volledig onbekende EV-energie op.

De screenshot bewijst dat EV-energie wordt ontvangen maar niet waarom alle 0,2 kWh onbekend werd. Andere bestaande oorzaken blijven mogelijk: ontbrekende/verouderde P1-/PV-invoer, slechts gedeeltelijk verse EV-feedback, een onwaarschijnlijke EV-/sitevermogensbalans, gedeelde feedback, of een correctie door de bestaande importmeterkalibratie. Zonder een diagnose van datzelfde laadinterval kan de exacte oorzaak van die historische 0,2 kWh niet worden bewezen.

## Nieuwe geschatte toewijzing

1. Gebruik het EV-laadvermogen uit verse feitelijke ampèrefeedback × ingestelde spanning/fasen. Opdrachten en alleen laadherkenning uit woningverbruik worden niet in geleverde EV-kWh omgezet.
2. Gebruik de **bestaande** Savings-bronpools: `pvToLoadW` en `gridToLoadW`. Export en batterijladen zijn daar al afgetrokken.
3. Reserveer directe PV eerst voor overig huisverbruik: `max(0, loadW − totaalEVW)`.
4. Geef de EV’s maximaal de overblijvende directe PV: `min(totaalEVW, max(0, pvToLoadW − overigHuisW))`.
5. Geef de EV’s daarna maximaal de bestaande directe netpool, begrensd tot het nog niet toegewezen EV-vermogen.
6. Verdeel deze ene gezamenlijke EV-pool proportioneel naar de afzonderlijke EV-vermogens. Het onverklaarde restant blijft onbekend. Een batterijcommando wordt niet als gemeten batterij-naar-EV-energie gepresenteerd.

Dit wijzigt de **boekhoudkundige schatting van de EV-bron**, inclusief de eerdere huishoudelijke proportionele PV-verdeling. Het is geen fysieke bronmeting en verandert geen prioriteiten of laadbeslissingen van de EMS. Alle stroomafgeleide EV-kWh blijven `estimatedKwh`. De bestaande Savings-balans gebruikt batterijcommando’s als schatting; afwijkende werkelijke batterijvermogens kunnen dus ook deze bronverdeling beïnvloeden. `batteryKwh` blijft nul zonder betrouwbare aparte toewijzing.

Ontbrekende of verouderde bronmetingen blijven onbekend; een positieve EV-meting wordt niet automatisch volledig als net geboekt. Inconsistent hoge EV-stromen blijven eveneens onbekend. Er worden geen historische brongegevens achteraf uit een actuele meting afgeleid.

### Voorbeelden per uur bij constante waarden

| PV | Net | Batterij | EV | Overig huis | EV-zon | EV-net | EV-onbekend |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 kW | 10 kW | 2 kW laden | 6 kW | 2 kW | 0 kWh | 6 kWh | 0 kWh |
| 5 kW | 5 kW | 0 kW | 7 kW | 3 kW | 2 kWh | 5 kWh | 0 kWh |
| 6 kW | 3 kW | 2 kW laden | 5 kW | 2 kW | 4 kWh | 1 kWh | 0 kWh |
| 3 kW | 1 kW | 3 kW ontladen | 7 kW | 0 kW | 3 kWh | 1 kWh | 3 kWh |

Dit zijn gesimuleerde stationaire meetintervallen, geen gegevens van een echte Homey.

## Behoud van energiebalans, kosten en historie

- Som van EV-PV blijft maximaal algemene directe PV; EV-net blijft maximaal het bestaande directe netaandeel.
- PV + net + batterij + onbekend blijft de geregistreerde EV-energie.
- De algemene Savings-energiebuckets, bedragen, batterij-inventaris en prijsselectie zijn inhoudelijk ongewijzigd. Tests vergelijken deze velden rechtstreeks met de voorgaande build.
- EV-kosten en besparing gebruiken dezelfde prijs van ieder meetinterval en de bestaande gemiste injectievergoeding. De EV-bedragen zijn uitsplitsingen en worden niet extra aan Savings toegevoegd.
- Bestaande dagen en eerder als onbekend opgeslagen energie blijven bewaard. Het nieuwe beleid geldt vanaf de volgende geregistreerde intervallen. De 0,2 kWh uit de screenshot wordt niet zonder brongegevens herschreven. De bestaande importmeterkalibratie blijft bij latere meterupdates wel haar normale weergavecorrectie doen.
- CSV-velden, opslagformaat, gedeelde daghistoriek, timers, polling en centrale recorder blijven gelijk.

## Compacte widget en actief plan

De bovenste statusregel toont de EV-naam, de bestaande centrale laadstatus en de werkelijk bekende aansluitstatus naast elkaar. Lange EV-namen mogen binnen de beschikbare breedte worden afgekapt; de volledige naam blijft als titel aanwezig.

De volgende regel toont de effectieve centrale modus en het actuele schema: bijvoorbeeld `Slim laden · 80% tegen 07:00 · gegarandeerd`, een kWh-doel, of `Emergency charge tot 100%`. Zonder Flow-doel kunnen de bestaande instellingen als actief doel getoond worden. Zonder SoC-configuratie wordt geen fictief SoC-doel ingevuld. Centraal voltooid of verderladen volgens voorkeuren wordt expliciet weergegeven. Beschikbare SoC blijft op deze regel staan. De schemaregel blijft één regel; bij erg lange tekst wordt afgekapt met de volledige schematekst als titel.

`lib/ev-dashboard.js` leest de bestaande effectieve modus, opgeslagen Flow-plannen en centrale sessie. De widget berekent geen laadslots, deadline of status en voert geen settings-expansie uit die plannergegevens zou wijzigen. De bestaande invoerfunctie `plan()`/`submit()`, Flow-listeners, bevestiging, persistentie en fysieke EV-sturing zijn ongewijzigd. De extra `schedule`-projectie wordt alleen voor de weergave gebruikt en is ook beschikbaar bij alleen Insights.

## Verificatie

Alle **92 testbestanden** slagen. De eerste volledige run had één verouderde CSV-testverwachting: die verwachtte nog dat alle EV-energie bij batterijactiviteit onbekend bleef. Die verwachting is aangepast aan het nieuwe beleid, met een extra CSV-bronverdelingstest; de bijgewerkte test slaagt. De energie-/backendcode veranderde niet tussen de volledige run en deze gerichte hertest. Een laatste compacte CSS-/tekstindeling van de schemaregel is daarna met de 29 widgettests opnieuw gecontroleerd.

- EV-energie: **34** scenario’s, inclusief PV/net/batterijcombinaties, huishoudelijke PV-reservering, twee EV’s, gedeelde en ontbrekende feedback, geldinvarianten en bronpoolgrenzen. Algemene Savings-velden en inventaris worden tegenover de vorige 1.2.4-build vergeleken.
- Dashboard/handler: **26** scenario’s; centrale sessie, bestaande Flow-handler, verse gedeeltelijke invoer en actieve-planprojectie.
- Widgetweergave en interactie: **29** scenario’s in NL/EN, inclusief alleen Insights en Emergency zonder standaarddoel in de schemaregel.
- CSV: **9** scenario’s, met ongewijzigde eerste 14 algemene kolommen tegenover de oudere export.
- Registratie-audit: **21** scenario’s; onbekende sitebron, herstart, daggrens, tijdzone/DST en ontbrekende EV-feedback blijven behouden.
- Emergency-presentatie: **13** scenario’s; de korte hint met bestaande 5/30-secondenweergave blijft behouden.

Alle **153 bestaande EV-methoden in app.js** en **7 Flow-/planneruitkomsten** zijn identiek aan de voorgaande 1.2.4-build. De volledige app.js, de planner-/sturingsmodules, centrale Savings-intervalberekening en CSV-productiecode zijn bytegelijk; alleen de bronuitsplitsing en dashboardpresentatie wijzigen.

De gerichte tests gebruiken echte productiefuncties met gesimuleerde Homey-I/O. De statische kaartweergave is op 320 px breed gecontroleerd via een lokale HTML/CSS-renderer. Een native Homey-/mobiele-browsertest en een test op fysieke laadapparatuur zijn niet uitgevoerd.

### Containervergelijking

Gelijke invoer, twee EV’s, 1.000 opwarminputs en 600 gemeten P1-stappen, afzonderlijke Node-processen. Dit zijn eenmalige containermetingen, geen Homey CPU-percentages of bewijs van een prestatieverbetering.

| Indicator | Vorige 1.2.4 | Nieuwe 1.2.4 |
|---|---:|---:|
| CPU-tijd | 456.394 ms | 419.651 ms |
| Behouden heapdelta na GC | 130456 bytes | 129080 bytes |
| Extra contextpasses | 1 | 1 |
| Extra fysieke EV/flex-uitgangen | 0 | 0 |

Alle gemeten event-/berekeningstellers zijn gelijk: gridInputs 1603, fastEvaluations 1603, contextEvaluations 20, planningCalculations 1 en widgetEnergyBudgetCalculations 1. Er zijn geen nieuwe polling-, registratie- of commandotimers toegevoegd. Zie `validation/ev-source-allocation-suite-1.2.4.json` en `validation/ev-source-allocation-performance-1.2.4.json`.

## Gewijzigde bestanden

- `docs/ev-dashboard-1.2.4.md`
- `docs/ev-recording-audit-1.2.4.md`
- `docs/ev-source-allocation-1.2.4.md`
- `lib/ev-dashboard.js`
- `lib/ev-energy-breakdown.js`
- `locales/en.json`
- `locales/nl.json`
- `test/ev-dashboard-1.2.4.test.js`
- `test/ev-energy-1.2.4.test.js`
- `test/ev-savings-export-1.2.4.test.js`
- `test/ev-widget-ui-1.2.4.test.js`
- `validation/ev-dashboard-1.2.4.json`
- `validation/ev-energy-1.2.4.json`
- `validation/ev-savings-export-1.2.4.json`
- `validation/ev-source-allocation-performance-1.2.4.json`
- `validation/ev-source-allocation-suite-1.2.4.json`
- `validation/ev-widget-ui-1.2.4.json`
- `widgets/ev/public/index.html`
