# HomeFlux EMS 1.2.4 — EV-batterijopties, sessiemelding, widget en tags

Gebaseerd op de laatst geleverde **1.2.4-proefbuild met EV Peak Guard-correcties**, bron-ZIP SHA-256 `5d2a369a53f93b5b2841d82c6ce15b8909ff5bf37abfe0027a22baedcb2463ef`. De appversie blijft **1.2.4**. De bevroren oorspronkelijke release is niet vervangen. Dit rapport beschrijft de opvolgende aanpassingen; eerdere validatierapporten in de ZIP horen bij hun eigen wijzigingsronde.

## Twee algemene EV-instellingen

Onder Instellingen → EV-laders staan twee afzonderlijke selectievakjes, beide standaard **uit**:

1. **Batterijontlading blokkeren tijdens EV-laden bij meer dan 50% netenergie.**
2. **Batterijontlading altijd blokkeren tijdens EV-laden.**

De tweede optie heeft voorrang. De blokkering betreft positieve interne batterijcommando’s (ontladen). Negatieve commando’s blijven via de bestaande laad-, SoC-, vermogens- en Peak Guard-grenzen lopen. **PV-overschot kan dus de batterij blijven laden.** Bestaande geplande of veiligheidslaadacties zijn niet uitgeschakeld. De opties vergroten geen vermogensinstellingen en veranderen geen bestaande standaardinstellingen.

De blokkering geldt voor de volledige geconfigureerde batterijgroep, ook voor ondersteuning van huisverbruik, EV en Peak Guard. Een EV mag geen nieuwe laadruimte krijgen uit batterijondersteuning die door deze optie verboden wordt. De eigen EV-Peak Guard blijft actief en kan de EV begrenzen of stoppen. Er wordt geen virtuele netruimte gecreëerd door een toekomstige batterijopdracht.

De bestaande energieregistratie in `lib/savings.js` bewaart `inventory.pvKwh`, `inventory.unknownKwh` en per tarief `inventory.grid[...].kwh`. De nieuwe helper leest die voorraad zonder hem te wijzigen. Het netaandeel wordt gedeeld door de grootste van de geregistreerde voorraad en de op capaciteit/SoC gebaseerde huidige batterij-inhoud. Zo wordt niet-geregistreerde beginenergie niet ongemerkt als bekende herkomst behandeld. Precies 50% activeert de optie niet. Een ontbrekende SoC of onvoldoende aangetoonde netenergie maakt geen meerderheid. Dit blijft een **schatting**, gebaseerd op de bestaande setpointregistratie; geen fysieke meting van de herkomst en geen afzonderlijke herkomst per batterij.

Actief EV-laden gebruikt dezelfde bestaande fysieke bronnen: Mode gebruikt HomeFlux’ actuele P1-vermogenswaarneming; Current/Hybrid gebruiken verse werkelijke stroomfeedback via Flow. Geconfigureerde laadstroom of een gevraagd commando bewijst geen laden. Bij ontbrekende/verouderde waarneming wordt niet zelf een laadvermogen verzonnen. De normale detectie- en reactietijd blijft dus van toepassing.

De beperking loopt door de echte batterijverdeler en diens feedbackpreview. Een laatste publicatiecontrole voorkomt dat een oude positieve opdracht of efficiëntiehandover alsnog ontlaadt. Split-sturing kan geen positieve minimumontlading terugplaatsen: ook na de bestaande seconde wachttijd vóór het vermogenscommando wordt opnieuw gecontroleerd. Richtingsvergrendelingen en commandotiming blijven bestaan. Hybrid EMS blijft onder HomeFlux-besturing zolang de beperking actief is, zodat de externe zelfconsumptieregeling haar niet omzeilt.

## Onhaalbaar doel: maximaal één melding per sessie

De actuele bron bevat geen Flow-ID `auto_target_unreachable`; de bestaande kaart heet **`ev_target_cannot_be_reached`**. Die kaart is aangepast, met behoud van ID, parameters en tokens.

De oude controle vergeleek de volledige waarschuwingstekst en wiste haar geheugen zodra de waarschuwing verdween. Veranderende kWh en wisselende haalbaarheid konden zo opnieuw melden. Een aparte vergrendeling per EV voorkomt dat nu, ook bij overlappende aanroepen. Zij wordt vóór de asynchrone triggeraanroep vastgelegd in `_evTargetWarningSent` en overleeft herstart. Alleen een **bevestigde disconnect** maakt de melding voor die EV opnieuw vrij. Een pauze, nieuwe doelwaarde, haalbare tussenfase of een app-herstart doet dat niet. Een mislukt triggerverzoek wordt niet eindeloos herhaald binnen dezelfde sessie.

Met sessie wordt hier de aansluitperiode bedoeld. Er zijn maximaal vier vlaggen; alleen bij de eerste waarschuwing of het resetten na disconnect volgt een opslagactie. Geen extra periodieke controle.

## EMS-widget

Alle **21 algemene vakken** zijn afzonderlijk functioneel getest met de echte widget-renderfunctie. Twee nog gekoppelde/ongestuurde vakken hebben nu eigen opties:

- **Actieve SoC-grenzen**, los van het planningsdoel.
- **Vol tot doel / ontlaadtijd**, dus ook afzonderlijk uit te schakelen.

Voor het actieve plan en de PV-bron bestonden rendercontroles, maar ontbraken de configuratievelden. Ook die zijn toegevoegd. De bestaande opties voor prijzen, EV, HVAC en boiler blijven behouden. De nieuwe opties staan op een logische plaats bij de batterij- en planningsvelden. De statusreden vermeldt een actieve EV-ontlaadblokkering in Nederlands en Engels.

## Globale Flow-tags

| Tag | Type | Betekenis |
|---|---|---|
| `HomeFlux EMS - Errors` | Tekst | Actuele ontbrekende invoer, herstel van de veiligheidsreserve en Battery Balance-waarschuwingen; leeg wanneer afwezig. |
| `HomeFlux EMS - Last Error` | Tekst | Laatste uitvoeringsfout sinds app-herstart, ook zonder actieve diagnostische registratie. Geen historisch foutenarchief. |
| `HomeFlux EMS - WAF Energy Balance (kWh)` | Getal | Exacte bestaande gecachte WAF-balans; positief is overschot, negatief tekort. |
| `HomeFlux EMS - WAF Available` | Ja/nee | Of de WAF-waarde momenteel geldig is. Bij niet beschikbaar staat de getaltag op 0; controleer deze vlag om dat van een echte nulbalans te onderscheiden. |

De reeds bestaande Warning-tag blijft behouden. De tags staan beschreven in Instellingen → Help. Een gewijzigde WAF-cachewaarde telt mee in de bestaande statuspublicatie; gelijke waarden worden niet opnieuw geschreven. Widget- of taggebruik start geen tweede WAF-berekening of batterijplanning.

## Tests en behoud

**100 testbestanden geslaagd, 0 mislukt, 0 overgeslagen**, in circa 193 seconden. De nieuwe `test/ev-battery-options-1.2.4.test.js` bevat **12 testgroepen** met echte productiefuncties en gesimuleerde Homey-I/O/tijd:

- beide defaults uit en herstel van opgeslagen opties zonder veranderde vermogenslimieten;
- netaandeel boven, op en onder 50%, onbekende/beginnende voorraad en ontbrekende SoC;
- voorrang van altijd blokkeren, meerdere EV’s, verse/nul/verouderde/losgekoppelde feedback;
- Mode-P1-bron in plaats van ingestelde of via Flow genoemde ampères;
- ontlaadblokkering in de batterijengine en feedbackpreview, PV-opname en individuele maxima;
- actieve Peak Guard zonder fictief voorspeld batterijvermogen;
- split-minimum, richtingsvergrendeling en EV-start tijdens vertraagde split-publicatie;
- werkelijk context-/fast-loop-, batterijpublicatie- en Hybrid-eigenaarschapspad;
- 85 wisselende doelwaarschuwingen, gelijktijdige acties, andere doelen en disconnect/reconnect;
- herstart met sessievergrendeling;
- WAF-publicatie, gewijzigde/gelijkblijvende cachewaarden, verlopen/negatieve waarden en runtimefout zonder diagnostiek;
- alle 21 algemene widgetvakjes, waaronder het verbergen van Vol tot doel zonder het doel te verbergen.

Zeven bestaande Flow-planningssnapshots zijn vóór/na identiek bij uitgeschakelde opties. De EV-planner, centrale EV-vermogensallocator, EV-uitgangsprojectie en fysieke EV-uitgangsfuncties zijn inhoudelijk ongewijzigd. Vijftien geselecteerde kernmethoden en 36 beschermde bestanden zijn bytegelijk aan de vorige proefbuild, inclusief Savings/dagdata, EV-widgets, WAF-berekening, batterij-nachtplanner en deadlineplanner. Bestaande batterij-, Peak Guard-, PV-, HVAC-, boiler-, WAF-, Flow-herstel- en widgettests slagen.

De twee historische Flow-schema-tests zijn alleen voor de gewijzigde uitleg van deze ene trigger uitgebreid: alle overige kaartvelden blijven exact vergeleken. De regressiecontrole noemt expliciet de vier gewijzigde bestaande methoden met EV-betrokkenheid; identieke Flow-planningsresultaten blijven daadwerkelijk gecontroleerd.

Alle bestands- en methodewijzigingen, plus SHA-256-waarden, staan in `validation/ev-options-source-audit-1.2.4.json`. Testresultaten: `validation/ev-options-suite-1.2.4.json`, `validation/ev-battery-options-1.2.4.json` en `validation/ev-widget-regression-1.2.4.json`.

## CPU en geheugen

Afwisselend drie runs per variant in Node, vier EV’s en vier batterijen, 1.500 opwarmstappen en 400 gemeten stappen met de bestaande P1/PV/Flow-invoer. Hieronder medianen; dit zijn **geen Homey CPU-percentages**.

| Variant | CPU (ms) | Verstreken (ms) | Heapdelta na GC (bytes) | Batterijuitvoer einde (W) |
|---|---:|---:|---:|---:|
| Vóór, opties uit | 294.067 | 243.126 | -7584 | 2000 |
| Na, opties uit | 254.792 | 211.498 | -6184 | 2000 |
| Na, altijd blokkeren | 244.053 | 207.854 | -10656 | 0 |
| Na, netaandeel >50% | 263.045 | 218.930 | -9304 | 0 |

In iedere variant: 7 contextevaluaties, 0 nieuwe EV-uitgangsevents en 13 bestaande geplande timers in het meetvenster. De opties voegen geen polling, energierecorder, planner, historieherberekening of timer toe. Met de opties aan wordt alleen de bestaande kleine voorraad/batterijgroep/EV-groep geraadpleegd. JIT/GC en timing variëren; negatieve heapdelta betekent geen bewezen geheugenbesparing en deze meting bewijst geen prestatiewinst of gelijkblijvende belasting op echte Homey-hardware. Ruwe metingen en herhaalbare worker: `validation/ev-battery-options-performance-1.2.4.json` en `test/ev-battery-options-benchmark.cjs`.

**Niet uitgevoerd:** echte Homey Pro/EV/batterijtesten, echte dashboardweergave, Store-/installatievalidatie en hardware-CPU/geheugenmeting. Browser-rendering kon hier niet worden gestart omdat het Chromium-programma ontbrak; de widget is functioneel via zijn echte DOM-renderfunctie getest. De ZIP is volledig en byte-/CRC-gecontroleerd, maar blijft een proefbuild.
