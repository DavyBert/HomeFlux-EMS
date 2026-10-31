# Validatie HomeFlux EMS 1.2.11

Gebaseerd op de volledige laatst aangeleverde 1.2.10-ZIP. De functionele correctie herstelt de algemene Peak Guard-aanroep in de batterij-engine en de bijbehorende snelle P1-detectie. Stand-by wordt nergens meer als uitzondering op batterij-Peak Guard gebruikt. De volledige `lib/ems-engine.js` is na deze correctie bytegelijk aan 1.2.9.

**12/12 gerichte testbestanden slagen.** De nieuwe test bevat 18 scenariogroepen: Peak Guard in alle zeven modi, beschikbare capaciteit, harde minimum-SoC, vermogensgrenzen, gewone Stand-by zonder PV-opvang, het expliciete aan/uit-vinkje van Peak Guard, echte P1-overname/terugkeer en een overgang van laden naar Stand-by.

De matrix omvat **448 volledige enginevergelijkingen met 1.2.9**, inclusief Stand-by, vier contracttypes, vier SoC-niveaus en vier import-/exportsituaties. Alle resultaten zijn identiek aan die oorspronkelijke engine. Bij onvoldoende SoC/vermogen blijft Peak Guard een veiligheidsbeslissing; hij kan geen energie uit een batterij onder de harde minimumgrens halen.

Daarnaast zijn de bestaande 24 geblokkeerde-uitvoerscenario's opnieuw uitgevoerd met de gecorrigeerde Stand-by-verwachting. Peak Guard mag daar bij hoge import ondersteunen en moet na de piek terugkeren naar 0 W. De overige cache-/PV-/SoC-controles blijven behouden. Andere uitgevoerde suites: engine, snelle veiligheids-/opdrachtsturing, idle guard, app-control, batterij/HVAC-isolatie, flexibele belastingen, opstart/versiemetadata, widget/planningmonitor en EV-netvrijgave.

Syntax/JSON, versienummers, volledige ZIP-aanwezigheid en CRC worden gecontroleerd. De bestaande Flow-definities, deprecated kaarten, Athom-teksten en de bewaarde gepensioneerde tests blijven behouden. README is alleen met de nieuwe release notes aangevuld.

De eerdere 1.2.10-optimalisatieproeven zijn niet herhaald: de drie geoptimaliseerde modi en hun cachevoorwaarden zijn niet gewijzigd. Onafhankelijke subsystemen en de volledige regressiesuite zijn overgeslagen. Historische 1.2.10-documenten beschrijven die toen geleverde build; voor de gecorrigeerde Stand-by-regel geldt dit document. Fysieke Homey-/laadpaaltests en een duurproef zijn niet uitgevoerd.

Details: `validation/targeted-1.2.11.json`, `validation/peak-guard-all-modes-1.2.11.json`, `validation/blocked-feedback-correction-1.2.11.json` en `validation/source-audit-1.2.11.json`. Nieuwe proeven: `npm run test:1.2.11`. Voor de externe referentie: `HEMS_PEAK_BASELINE=/pad/naar/1.2.9 npm run test:1.2.11`.
