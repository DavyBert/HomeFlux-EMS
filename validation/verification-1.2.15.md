# HomeFlux EMS 1.2.15 – gerichte verificatie

## Wijzigingen

- Direct schakelen per HVAC bij tariefwissel en stabiel PV-overschot, zonder nieuwe timers of achtergrondlus. Bestaande contextfrequentie blijft gelden; P1 markeert eenmaal dat stabiel overschot een bestaande context mag vervroegen.
- Parallelle toelating voor bekende verbruikers en directe aanvragen, met één gezamenlijke reservering, 20% modulatiemarge, HVAC-budget en Peak Guard. Onbekende afzonderlijke verbruikers behouden de gespreide terugvalregeling. Gekoppelde thermostaten reserveren het volledige gedeelde bronvermogen eenmaal.
- Handmatig leren via Nu leren; één onafhankelijke HVAC tegelijk, uitsluitend bij een stabiele referentie, geen aangesloten EV of actieve boiler, verse P1/PV en bestaande minimale leerduur. Meetverstoringen verklaren de meting ongeldig. Geldige oude meetresultaten blijven behouden.
- Actieve automatische-sturing-Flow met optionele temperatuur per Flow. De temperatuur wordt voor het gekozen kanaal bewaard; leeg gebruikt de bewaarde instelling. Bij Nee volgt het toegestane stand-bysetpoint en de toegestane uit-Flow. Ontbrekende toestemming onderdrukt de bijbehorende uitgang.
- De widget en HVAC-statustekst volgen de gepubliceerde uit-status en het gepubliceerde setpoint.

## Tests

20 gerichte bestaande/nieuwe suites geslaagd. De HVAC-suites omvatten 25 nieuwe en 34 bestaande scenariogroepen, UI-combinaties en migratie/herstart.

- `test/hvac-permanent-1.2.7.test.js`
- `test/hvac-coordination-1.2.15.test.js`
- `test/hvac-ui-1.2.7.test.js`
- `test/hvac-migration-1.2.7.test.js`
- `test/flow-slot-cards.test.js`
- `test/configured-flow-cards.test.js`
- `test/help-catalog.test.js`
- `test/settings-startup.test.js`
- `test/settings-runtime-audit.test.js`
- `test/battery-settings-isolation-1.2.8.test.js`
- `test/settings-translations.test.js`
- `test/engine.test.js`
- `test/multi-flexible-loads.test.js`
- `test/app-control.test.js`
- `test/output-tests.test.js`
- `test/features-control-1.2.9.test.js`
- `test/cpu-coalescing-1.2.13.test.js`
- `test/widget.test.js`
- `test/widget-decision-1.2.14.test.js`
- `test/ev-grid-budget-1.2.13.test.js`

Syntax: gewijzigde JavaScript-bestanden, gewijzigde JSON en inline scripts van Settings en de statuswidget gecontroleerd.

Overgeslagen: volledige regressiesuite en onafhankelijke suites voor onder andere Savings, prijsimport en Autotune. Er is niet geïnstalleerd of gepubliceerd op Homey.

## Hostmetingen

Node-host, echte HVAC-berekening en publicatieketen met nagebootst Homey-transport en identieke inputs/tijdstappen. Geen fysieke Homey-/warmtepompmetingen. Per geval 100 opwarmcontextpasses, 7 afwisselend geordende meetrondes van 250 contextpasses per versie; CPU uit process.cpuUsage.

| HVAC’s / scenario | 1.2.14 CPU mediaan | 1.2.15 CPU mediaan | Setpointcommando’s per ronde, oud → nieuw |
|---|---:|---:|---:|
| 0 / stabiele doelen | 13.0 ms | 15.0 ms | 0 → 0 |
| 5 / stabiele doelen | 168.2 ms | 115.5 ms | 0 → 0 |
| 5 / tariefwissels | 245.3 ms | 276.9 ms | 250 → 1250 |
| 10 / stabiele doelen | 274.0 ms | 228.0 ms | 0 → 0 |
| 10 / tariefwissels | 589.7 ms | 477.2 ms | 250 → 2500 |

Tariefwissels hebben bewust een ander uitvoerpatroon: bekende HVAC’s worden in dezelfde contextpass aangepast. Het geval met vijf toestellen vergt daardoor iets meer CPU ondanks minder berekeningen. Minder functieaanroepen worden niet als zelfstandig CPU-bewijs gebruikt. Ruwe rondemetingen, aantallen instellingenopbouwen/berekeningen en geheugendelta’s staan in `hvac-host-1.2.15.json`.

Aanvullend geheugen: na 500 opwarmpasses volgen 4.000 wisselende contextpasses met tien HVAC’s en GC op vaste meetpunten. Netto behouden heapverschil: -52.7 KiB; meetbereik: 222.9 KiB. Deze hostreeks toont geen blijvende groei en bewijst geen lekvrijheid op Homey.

## Resterende risico’s

- Geen hardwaremeting: Flow-ontvangst, fysieke responstijden, werkelijke COP en modulatie hangen af van de gekoppelde toestellen. Geen Homey-besparingspercentage geclaimd.
- Gedeeld bronvermogen is een conservatieve reservering met marge. Onbekende bronnen gebruiken een terugvalraming; werkelijk netvermogen blijft leidend voor veiligheidsafbouw.
- Zonder rechtstreekse HVAC-meting kan de budgetbewaking een toename van ander huishoudelijk verbruik conservatief als verlies van thermische marge behandelen.
- Handmatig leren kan wachten totdat een toestel in rust is en betrouwbare referentiegegevens beschikbaar zijn. Storing kan een nieuwe geschikte gelegenheid vereisen.
- Niet-uitgevoerde onafhankelijke suites zijn niet opnieuw bevestigd; hun code bleef ongewijzigd.
