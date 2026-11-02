# EV-audit 1.1.9 — 21 oktober 2026

> Historische audit vóór de correctie. De bevindingen zijn inmiddels aangepakt binnen 1.1.9; zie `EV-BATTERY-FIX-1.1.9.md`. De oorspronkelijke foutassertions zijn vervangen door regressies die de gewenste werking eisen.

Onderzocht: de lokale 1.1.9-broncode van de opgeleverde SoC-keuze, met vergelijking tegen de aangeleverde 1.1.8. Geen productiecode, instellingen, versie of releasepakket gewijzigd. Niet gepubliceerd.

## 1. Hoog: sessiestop trekt fysieke EV-bescherming te vroeg in

Codepad: `applyEvSessionEndLatch()` → `markEvSessionEnded()` → `getEvMeasuredCurrent()` / `getEvGridImportControlStatus()` → `getEvaluationState()` → batterij-engine `evaluate()`.

Een beëindigde sessie maakt de stroomfeedback ongeldig via `!session?.endedLatched`, ook wanneer de tijdstempel actueel is en het voertuig nog aangesloten is. De netdoelcorrectie wordt eveneens direct nul. Een stopbesluit bewijst echter niet dat de fysieke belasting al verdwenen is.

Gecontroleerde reproductie: EV circa 11.085 W, huis 623 W, geen PV, batterij levert 623 W, P1 11.085 W. Voor beëindiging bedraagt het berekende batterijcommando 623 W. Na het latchen van `soc_target`, met dezelfde metingen, wordt het **6.000 W ontladen**, de ingestelde maximumwaarde in de fixture.

Dit bewijst een berekeningsprobleem onder deze omstandigheden. Publicatie hangt daarnaast af van outputgates en timing. Als het EV-verbruik intussen wegvalt, kan een reeds toegepast ontlaadcommando tijdelijk export veroorzaken. Dat laatste is een gevolgtrekking; deze proef meet geen echte omvormer en bewijst niet de volledige tijdlijn van Fred.

Oplossingsrichting: onderscheid laadtoestemming en fysieke restbelasting. STOP blijft definitief voor de sessie, maar actuele fysieke stroom mag niet alleen wegens die STOP uit de vermogensboekhouding verdwijnen. De overgang moet aflopen op actuele metingen en bestaande freshnessgrenzen, zonder oude EV-stroom als nieuwe laadvergunning te gebruiken.

## 2. Middel: gemengd PV/netladen kan huisverbruik naar het net verschuiven

Codepad: `getEvGridImportControlStatus()`, berekening `confirmedEvGridPowerW` en `Math.max(requestedTargetW, confirmedEvGridPowerW)`.

Gemeten EV-vermogen wordt volledig als netgevoed beschouwd, behalve expliciete batterij-/nachtsteun. Het PV-deel wordt hier niet afgetrokken. De fysieke bovengrens voorkomt een onbegrensd fictief doel, maar kan daardoor het gehele netto siteverbruik als EV-vrijstelling behandelen, inclusief het huis.

Reproductie: EV 11.085 W, PV 5.000 W, huis 623 W, batterij 623 W, P1 6.085 W. Het aangevraagde EV-netdoel is 6.085 W. De actieve vrijstelling wordt **6.708 W**. De batterij-engine ziet daardoor -623 W en verlaagt het berekende ontlaadcommando van 623 naar **8 W**. Bij opvolging van die opdracht zou circa 615 W huisverbruik extra uit het net komen.

Oplossingsrichting: behoud de bescherming van werkelijk EV-verbruik boven een verlaagd setpoint, maar onderscheid daarbij het PV- en netdeel. Alleen het geplande EV-netbudget als harde bovengrens gebruiken zou de eerdere ongewenste batterijbijdrage aan de EV terugbrengen.

## Herkomst en testdekking

Beide gevallen zijn met dezelfde assertions gereproduceerd op 1.1.9 en op de aangeleverde 1.1.8. `getEvMeasuredCurrent()` en `getEvGridImportControlStatus()` zijn tussen die versies identiek. Dit zijn geen bewezen regressies van de nieuwe SoC-keuze.

Reproducer: `node test/ev-audit-1.1.9.repro.js [pad-naar-broncode]`. Deze assertions bevestigen het bestaande probleemgedrag; het bestand is bewust geen geslaagde correctietest en is niet aan `npm test` toegevoegd. De Homey-startupfixture en echte regelmethoden worden gebruikt; de specifieke inputtoestand en laadbeslissing worden gecontroleerd ingesteld. Er wordt geen fysieke laadpaal nagebootst met een gesloten terugkoppeling.

De bestaande SoC-tests omvatten beide keuzes, tarieven/PV, current/mode/hybrid, meerdere EV's, herhaalde updates, handmatige stops, nieuwe doelen en Peak Guard. De batterijbeschermingstests bevatten onder meer stabiel laden boven een netbudget. Zij bewijzen niet dat bovenstaande twee overgangs-/attributiegevallen goed werken.

Validatie op 21 oktober: volledige `npm run check` opnieuw geslaagd (exit 0), inclusief 58 bestaande suites, 55 SoC-completion-scenario's en 14 EV-batterijbeschermingsscenario's. Beide aanvullende auditreproducties slagen op zowel 1.1.9 als 1.1.8 doordat zij het probleemgedrag expliciet aantonen. `git diff --check` geslaagd.

Voor correcties zijn aanvullende regressietests nodig met echte scheduler/publicatie: vertraagd stoppende EV, P1 vóór/na EV-feedback, tariefovergang, meerdere EV's waarvan één stopt, PV-veranderingen, en expliciete batterijsteun. Bevestig daarna op een installatie de gemeten stroom, P1 en batterijrespons; een gepubliceerde Flow-opdracht is geen bevestiging van fysieke uitvoering.
