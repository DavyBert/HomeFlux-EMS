# HomeFlux EMS 1.2.9

## EV-deadline verlengen

De bestaande actieve kaart **Override EV mode for one charging session** heeft zeven extra keuzes: **Extend current plan by 1 day** tot **7 days**. Kaart-ID, EV-selectie, argumentnamen en de bestaande Smart-/SoC-/Emergency-keuzes blijven compatibel.

De gekozen lokale kalenderdagen worden bij de **bestaande deadline** opgeteld, niet bij vandaag. Het SoC-/kWh-doel, HH:mm, garantie, Max PV en reeds geleverde kWh blijven behouden. Herhaald verlengen telt bij de dan geldende deadline op. Zonder bestaand centraal SoC-/kWh-plan wordt niets aangemaakt. Een onmogelijke lokale zomertijd of een nog steeds verstreken einddatum wordt geweigerd.

De bestaande centrale meerdaagse planner en opslag worden hergebruikt. Een Flow-verlenging blijft bestaan bij pauze, loskoppelen, middernacht en herstart. Andere SoC-/kWh-planningsinvoer is geblokkeerd zolang de verlengde planning niet voltooid of expliciet gewist is. Ook bestaande actieve meerdaagse widgetplannen zijn beschermd tegen overschrijvende Flow-planningskaarten; hun eigen widgeteditor blijft werken.

Het doelbereik stopt de laadopdracht en heft de invoerblokkering op. De voltooide opdracht blijft als voltooid opgeslagen, zodat een herstart haar niet herbewapent. Een nieuwe expliciete opdracht kan vervolgens starten. **Clear EV planning** verwijdert het plan via de bestaande wisroute. Een Flow-verlenging houdt haar Flow-moduseigendom: bestaande Smart-/SoC-/Emergency-overrides blijven functioneren. Een expliciete modusoverride na voltooiing verwijdert eerst het voltooide verlengde doel. Peak Guard, elektrische limieten, fysieke vermogensverdeling en bestaande regeltimers blijven van toepassing.

Een gewone widgetplanning behoudt haar bestaande disconnect- en modusvoorrangsregels. De bijzondere levensduur tot doelbereik of wissen geldt voor de via Flow verlengde opdracht. Onbekende toekomstige tarieven/prognoses blijven voorlopig volgens de bestaande planner; verlengen verzint geen prijsvakken of PV-energie.

## Globale Logic-tags

Deze tags gebruiken bestaande controllerresultaten en het gecachete WAF-budget. Publicatie loopt via de bestaande geserialiseerde statusroute, uitsluitend bij waardeverschil. Er zijn geen extra timers, polling of regelberekeningen.

| Tag-ID | Inhoud |
|---|---|
| `emsdecision` | Actuele EMS-beslissing zoals in de statuswidget |
| `emsdecisionreasons` | Volledige beslisreden, zonder afkappen of het cosmetische label “Reason:” |
| `emswafstatus` | `red`, `orange` of `green`; leeg bij onbekend/verlopen WAF |
| `emswafcolor` | Exacte HSL-kleur van het bestaande WAF-verloop; leeg indien niet beschikbaar |
| `emsbatterypausereason` | Volledige reden voor batterijpauze |
| `emsbatterypausecode` | Bijbehorende stabiele reden-code |
| `emsinputready` | Of de benodigde invoer beschikbaar is |
| `emsmissinginputs` | Lijst ontbrekende invoer |
| `emscontrolenabled` | Of EMS-uitvoer is ingeschakeld |
| `emstariff` | Actief tarieflabel |
| `emsplanningphase` | Actuele planningsfase |
| `emsbatterydischargeblocked` | Of EV-laden de batterijontlading blokkeert |
| `emscriticalalert` | Actuele kritieke melding uit dezelfde widgetvoorwaarden |

WAF heeft in de widget een continu kleurverloop met rood bij −4 kWh, oranje bij +1 kWh en groen bij +7 kWh. De drie namen kiezen de dichtstbijzijnde van die kleuren op de bestaande hue-schaal: rood onder −1,5 kWh, oranje vanaf −1,5 tot onder +4 kWh, groen vanaf +4 kWh. `emswafcolor` geeft het volledige kleurverloop; de reeds bestaande `emswafavailable` geeft de beschikbaarheid aan. Teksttags volgen de app-taal; kleur- en reden-codes blijven stabiel.

Volledige gebruikersdocumentatie: https://github.com/DavyBert/HomeFlux-EMS/discussions/3
