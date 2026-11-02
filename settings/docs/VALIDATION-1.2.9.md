# Validatie HomeFlux EMS 1.2.9

Basis: de volledige laatst aangeleverde 1.2.8-ZIP. Alleen de centrale EV-planningsinvoer/-metadata, de bestaande override-route, de read-only widgetprojectie en globale statuspublicatie zijn functioneel aangepast. De aanvullende Flow-dropdownkeuzes staan alleen op de actieve bestaande kaart. Verouderde kaartdefinities zijn behouden.

## Resultaat

**Historische validatieronde: 28 van 30 gerichte testbestanden slaagden.** Op expliciet verzoek zijn de twee onderstaande verouderde tests uit de actieve suite verwijderd: hun aannames horen bij de eerdere sturing. Hun bronbestanden blijven als `.disabled`-archief behouden; zij worden niet meer door `npm test`, `npm run check` of normale `*.test.js`-detectie uitgevoerd. De 28 eerder geslaagde tests zijn voor deze wijziging van uitsluitend de testsuite niet opnieuw uitgevoerd. De eerdere foutuitvoer was identiek aan 1.2.8:

- `ev-peak-1.1.20.test.js`: de laatste controle vindt het verwachte uitgebreide diagnostiekevent niet. De eerdere Peak Guard-scenario's in dat bestand zijn uitgevoerd.
- `ev-physical-proof-1.2.4.test.js`: na 13 geslaagde groepen verwacht het Smart-PV → Emergency → Smart-scenario 6 A en ziet het 0 A. Latere groepen in dat bestand worden daardoor niet bereikt.

De verwijdering is een bewuste opschoning op verzoek van de gebruiker en geen correctie in de appregelcode. Het historische resultaat in `validation/targeted-1.2.9.json` is behouden; de uitsluiting en controles staan in `validation/test-suite-cleanup-1.2.9.json`. De eerdere volledige 1.2.8-validatie blijft als historische informatie in het pakket aanwezig.

De nieuwe featuretests slagen met **16 scenariogroepen**, waaronder 56 combinaties van EV 1–4, SoC/kWh en 1–7 dagen. Zij controleren vaste lokale deadlines, laaddoel, garantie, kWh-voortgang, zomer-/wintertijd, onmogelijke zomertijd, herstart, middernacht, verlopen deadline, loskoppelen/heraansluiten, invoerblokkering, doelbereik, annuleren en ontbrekende planning. Er is ook dekking voor de bestaande widget-meerdaagse invoerblokkering en behoud van Flow-moduseigendom.

Vier nieuwe volledige regelroutegroepen controleren Current-, Hybrid- en Mode-sturing met vier EV's, gedeeld Peak Guard-budget, absolute veiligheidsstop, behoud van het beschermde plan, behoud van Emergency en voltooiing via verse SoC-feedback. Een expliciete Emergency na voltooiing kan de voltooide opdracht verlaten en weer laden. 120 snelle P1-events bouwen geen nieuw meerdaags plan.

De bestaande gerichte suites omvatten daarnaast deadlineplanner/integratie/cache, persistentie, centrale planinvoer, EV-dashboard/widget, energievoortgang, Flow-routering/autocomplete, EV-netvrijgave, WAF/tags, statuscoalescing, opstart, instellingen-cache en architectuur. De batterij-isolatietest uit 1.2.8 blijft slagen. Een afzonderlijke vergelijking met 1.2.8 houdt zeven gewone Flow-planningssnapshots en de gevolgde evaluatie-/uitgangstellers identiek.

Voor de 13 aanvullende globale tags zijn beide talen, alle bestaande beslisreden-fallbacks, lange volledige teksten, de exacte WAF-kleur, verlopen/ontbrekende WAF, wissen van oude statuswaarden en uitsluitend gewijzigde publicatie getest. Bestaande globale tags en opgeslagen Flow-argumenten blijven compatibel.

## Geheugen en belasting

De reproduceerbare containerproef staat in `test/features-memory-1.2.9.cjs`; de meetgegevens staan in `validation/memory-1.2.9.json`. Beide versies kregen vier meerdaagse EV-plannen, 4.000 statuspasses en 4.000 planneroproepen.

| Meting | 1.2.8 | 1.2.9 |
|---|---:|---:|
| Heap na opstart en GC | 13.122.768 bytes | 13.265.680 bytes |
| Globale tokens | 29 | 42 |
| Waardecache statuspublicatie | 23 | 36 |
| Extra timers tijdens de proef | 0 | 0 |
| Herpublicaties van ongewijzigde tags | 0 | 0 |
| Nieuwe plannerbuilds bij herhaalde invoer | 0 | 0 |
| Opgeslagen metadata vier plannen | 2.375 bytes | 2.055 bytes |

De circa **0,14 MiB** extra gemeten opstartheap past bij de vaste uitbreiding van 13 tags en de tekstprojectie. De meetlussen behouden ongeveer 0,10 MiB respectievelijk 0,085 MiB na GC, inclusief JIT-/GC-ruis. Zij voegen geen groeiende historie of onbeperkte cache toe. Statusprojectie/publicatie gebruikt in deze kunstmatige proef ongeveer 71 ms extra CPU over 4.000 passes (circa 18 µs per pass). De plannercijfers variëren door proces-/JIT-ruis; hieruit wordt geen prestatieverbetering afgeleid.

Dit zijn lokale Node 24.22.1-metingen met gesimuleerde Homey-I/O. Zij meten geen Homey-geheugenlimiet, fysieke CPU-percentages of langdurige lekvrijheid en garanderen niet dat de eerder gemelde Homey-geheugencrash hiermee verdwijnt. De batterij/HVAC-instellingenisolatie uit 1.2.8 is behouden.

## Uitgevoerd en overgeslagen

Syntaxcontroles omvatten alle gewijzigde JavaScript-/testbestanden, inline scripts van instellingen en statuswidget en de gewijzigde JSON. De ZIP wordt gecontroleerd op CRC, volledige aanwezigheid van alle oorspronkelijke pakketbestanden, versienummers en behoud van de Athom-teksten, oude Flow-schema's en onaangeroerde regelmodules.

De volledige regressiesuite is bewust niet uitgevoerd. Onafhankelijke HVAC-/boilerregels, Savings/CSV, historische boekhouding en batterijstrategieën zijn functioneel niet gewijzigd; hun uitgebreide suites zijn overgeslagen. Een fysieke Homey-upgrade, echte herstart met laadpaal, apparaatuitvoer en duurproef zijn niet uitgevoerd. De twee genoemde tests behoren niet meer tot de actieve suite. De eerder gedocumenteerde overige, niet herhaalde 1.2.8-resultaten blijven historisch beschikbaar. Het verwijderen van deze tests bewijst op zichzelf geen nieuwe fysieke laad- of veiligheidsdekking.

Gerichte nieuwe tests: `npm run test:1.2.9`. Geheugenproef: `npm run benchmark:1.2.9`. Volledig overzicht: `validation/targeted-1.2.9.json`; broncontrole: `validation/source-audit-1.2.9.json`.
