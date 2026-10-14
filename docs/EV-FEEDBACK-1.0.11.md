# HomeFlux EMS 1.0.11 — EV-feedbackverificatie

Gebouwd op de aangeleverde HomeFlux-EMS-v1.0.10.zip (SHA-256 `3bc39b7607f5151e4fd528abbf1b5c52ac9d154703c0b8deeffd0785f0e56a2d`).

## Gedrag

Bij ampère- en hybride EV-sturing bepaalt de ontvangen werkelijke stroom per fase het gemeten EV-vermogen, met de bestaande fase- en spanningsconfiguratie. Er is geen vergelijking meer met de uitgestuurde ampèrelimiet, geen procentuele tolerantietoets en geen eis dat de meting na de laatste opdracht moet zijn ontvangen. Ook een wachtende EV-publicatie maakt een actuele meting niet ongeldig.

Bestaande toestemming voor EV-netladen en de actuele tarief-/netbudgetten blijven vereist. Een werkelijk gemeten vermogen boven de gevraagde laadlimiet is geldig, maar krijgt geen vrijgave buiten het toegestane netbudget. Ruwe P1 en Peak Guard blijven ongewijzigd. De fysieke bovengrens is `max(0, P1 + getekend batterijvermogen)`; batterijontladen is positief en laden negatief. Daardoor kan batterijladen geen eigen EV-vrijgave financieren. Bij meerdere EV's telt alleen de geldige meting van elke relevante EV mee; ontbrekende feedback van EV2 blokkeert niet automatisch EV1.

0 A draagt 0 W bij. Niet aangesloten, beëindigde sessies, ontbrekende metingen, ongeldige invoer en verlopen feedback leveren geen gemeten vrijgave. Ongeldige Flow/API-invoer vernieuwt de tijdstempel niet. Voor actuele stroom wordt dezelfde 60-secondenhorizon gebruikt als voor gemeten EV-energielevering; dit is een geldigheidsduur, geen wachttijd. Zodra actuele meting en toestemming beschikbaar zijn, kan de bestaande snelle regeling de vrijgave gebruiken. Er is geen polling of timer toegevoegd.

De oude percentage- en bypassinstellingen zijn verwijderd uit UI, publieke defaults en Autotune. Autotune leert de aankomsttijd van feedback zonder ampères met een opdracht te vergelijken. Voor uitsluitend modusgestuurde laders blijft de bestaande P1-detectie bestaan; bestaande toleranties voor die detectie blijven intern behouden. De instellingen-UI licht de gemeten stroom per fase en de geldigheidsduur toe.

## Uitgevoerde tests

- `npm run check`: alle 49 testsuites plus syntaxcontroles.
- 28 EV-scenario's met echte inputhandlers, contextaanvragen, contexttimer, contextuitvoering, EV-heartbeat, snelle batterijregeling en daadwerkelijke uitvoerhandlers. Alleen Homey-I/O, tijd en het fysieke gedrag van auto/woning zijn gesimuleerd. De gedeelde testhulp heeft voor deze tests geen vervangende batterij-netbudget- of laadtestroutine: de echte routines worden uitgevoerd, met een geldige laadtestsignatuur in de gemockte Homey-opslag.
- Vergelijking van 1.0.10 met 1.0.11 met dezelfde scenario's. De volledige individuele batterijcommando's, totalen, modi, overrides, verzendtijden, EV-uitvoer, Split-uitvoer en contextaanvragen/uitvoeringen staan in `EV-FEEDBACK-COMPARISON-1.0.11.json`.
- 17 eerdere context-/CPU-regressies opnieuw uitgevoerd: alle batterij- en module-uitvoer, contextuitvoering en pending deadlines zijn identiek aan de oorspronkelijke vergelijking. De uitvoertraces en aantallen volledige snelle evaluaties en statuspublicaties komen ook exact overeen met de opgeslagen resultaten van 1.0.10.
- Geldige/ongeldige stroominvoer gecontroleerd voor EV1–EV4; API-invoer vernieuwt geen stroommeting bij ontbrekende, ongeldige of negatieve waarden.

Gedekte EV-situaties: 16/14/8/6 A, éénfase/driefase, hybride EV-sturing, hogere gemeten stroom, begrensde netvrijgave bij een wachtende contextverversing, nieuwe opdracht met eerdere actuele feedback, 0 A, ontkoppelen, sessie beëindigen, ontbreken/verlopen/herstellen van feedback, verboden tarief, tarief- en budgetwijzigingen, echte tariefgrens, PV-/huisverbruikwissels, gepland batterijladen, Peak Guard, expliciete batterijondersteuning, oude bypasswaarden, uitsluitend modussturing, Split Command, Hybrid-batterijsturing, meerdere EV's en een wachtende EV-publicatie.

## Concrete vergelijking

Huisverbruik 623 W, tenzij het scenario expliciet anders vermeldt. De circa 8 W extra ontlading komt van de bestaande nulbandinstelling; die is niet aangepast.

| Scenario | EV-vrijgave 1.0.10 → 1.0.11 | Batterijontlading 1.0.10 → 1.0.11 |
| --- | ---: | ---: |
| 16 A gevraagd / 16 A gemeten | 11085 → 11085 W | 631 → 631 W |
| 16 A gevraagd / 8 A gemeten | 0 → 5543 W | 6000 → 631 W |
| 16 A gevraagd / 6 A gemeten | 0 → 4157 W | 4787 → 631 W |
| Eénfase, 16 A gevraagd / 8 A gemeten | 0 → 1840 W | 2471 → 631 W |
| Hybride EV, 16 A gevraagd / 8 A gemeten | 0 → 5543 W | 6000 → 630 W |
| 16 A gevraagd / 20 A gemeten, budget toegestaan | 0 → 13856 W | 6000 → 631 W |

Bij het budgetscenario wordt een verse hogere meting tijdens de wachtende contextverversing tot exact 5.000 W vrijgegeven. Als de gesimuleerde auto vervolgens de begrensde/stopopdracht blijft negeren, blijft het budget gelden; HomeFlux geeft geen onbeperkt netverbruik vrij. Bij 0 A, ontkoppelen, beëindigen, ontbrekende/verouderde feedback en ingetrokken toestemming vervalt de relevante vrijgave.

Normaal 16 A laden, verboden netladen en uitsluitend modussturing behouden exact dezelfde volledige batterij- en EV-uitvoertraces. Gepland batterijladen en expliciete batterijondersteuning behouden in deze vergelijking ook exact dezelfde batterijtraces. Gewijzigde batterijtraces in de probleemgevallen zijn de beoogde correctie en staan volledig in het JSON-rapport.

## Integriteit en reproduceerbaarheid

Dependencyversies en alle lockfilegegevens behalve de eigen pakketversie zijn gelijk. Manifestwijzigingen betreffen alleen de versie. 279 beschermde bestanden zijn bytegelijk gecontroleerd, waaronder Athom-teksten, Flow-kaarten, locales, widgets en assets. README-introductie en eerdere releasegeschiedenis zijn behouden. Versies in manifests, pakketverwijzingen, opstartlog, diagnostiek, status en planning zijn 1.0.11; de instellingen-UI toont geen versienummer.

Reproduceer de EV-vergelijking met:

```sh
node test/ev-feedback-comparison-1.0.11.js /pad/naar/originele/HomeFlux-EMS-v1.0.10
```

De tests bewijzen applicatiegedrag bij gesimuleerde I/O. Zij bewijzen geen hardware-CPU-percentage of een hardwarelaadtest.

## Duidelijke melding bij selectie van laadsturing

Bij EV1–EV4 verschijnt direct onder de keuze voor ampère- of hybride sturing een opvallend omlijnde melding, in Nederlands of Engels. Deze vraagt minstens elke 50 seconden de werkelijke stroom per fase door te geven, ook als de waarde niet verandert, en legt uit dat bij uitblijven van feedback na 60 seconden de EV-netvrijgave vervalt en de batterij het EV-verbruik opnieuw kan gaan voeden. De melding verschijnt direct bij selectie en bij het openen van bestaande instellingen; ze is niet van toepassing op uitsluitend modussturing. De stuurcode, geldigheidsduur en versie zijn hiervoor niet aangepast.

De aanvullende UI-controle omvat 72 combinaties van EV1–EV4, Nederlands/Engels, drie laadsturingstypes en drie werkingsmodi. De zichtbaarheid is direct gecontroleerd met de echte `updateEvInstanceUi`-functie. Alle inline scripts compileren. Settings-startup, vertalingen, runtime-audit en de bestaande 0.8.3-/0.9.3-UI-regressies slagen.
