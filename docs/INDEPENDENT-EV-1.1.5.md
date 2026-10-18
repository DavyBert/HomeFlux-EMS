# HomeFlux EMS 1.1.5 – zelfstandige EV-sturing

## Uitkomst en uitgangspunt

Gebaseerd op de laatst geleverde HomeFlux-EMS-v1.1.4.zip. app.js is vóór de wijzigingen bytegelijk gecontroleerd tegen die ZIP.

Het probleem is opnieuw bevestigd: de gewone EV-publicatieroute kon laden toestaan met `controlEnabled = false`, terwijl de EV-heartbeat diezelfde sessie stopte vanwege die instelling. De nieuwe regressietest faalt op de oorspronkelijke 1.1.4 bij de eerste zelfstandige EV-start/heartbeat en slaagt op 1.1.5.

Met ingeschakelde EMS-uitvoer, geconfigureerde batterijen en een geldige batterijtest blijven de geldige bestaande regeluitkomsten behouden. Dit is gecontroleerd met exacte vergelijkingen van afzonderlijke commando's en tijdstippen, niet uitsluitend van totaalvermogen.

## Gewijzigde werking

| Batterijen | Batterij-/EMS-uitvoer | EV-module | Werking |
|---|---|---|---|
| 0 | Aan of uit | Ingeschakeld | Zelfstandige EV-regeling |
| Meer dan 0 | Uit | Ingeschakeld | EV-regeling actief; bestaande batterijstop behouden |
| Meer dan 0 | Aan en geldig getest | Ingeschakeld | Bestaande gezamenlijke batterij-/EV-regeling |
| Willekeurig | Willekeurig | Uitgeschakeld of verwijderd | Actieve betrokken EV-uitvoer stoppen |

Een ingeschakelde EV-module mag starten en doorladen wanneer haar eigen voorwaarden dit toestaan. Het uitschakelen van batterij-uitvoer veroorzaakt geen periodieke EV-stop meer. De batterijtest blijft verplicht voor batterijcommando's, maar niet voor zelfstandige EV-sturing. De Homey-app moet hiervoor blijven draaien.

## Bevestigde oorzaak en aangepaste functies

### `publishEvPortfolioNow`

De voormalige `heartbeatInputSafe`-controle koppelde alleen de heartbeat aan `controlEnabled`. De gewone route had deze afhankelijkheid niet. De routes gebruiken nu dezelfde P1-geldigheid als EV-voorwaarde, onafhankelijk van de batterijschakelaar of het batterijaantal.

Vóór het toestaan van een EV-uitgang worden ook de EV-configuratie, verbinding en beëindigde sessie gecontroleerd. Na een eerdere asynchrone EV-publicatie worden voor de volgende EV de actuele settings en input opnieuw gelezen. Bestaande stopbeslissingen en hun redenen blijven intact.

Zonder geldige actieve batterij-uitvoer wordt voor EV-budgetten de fysieke route gebruikt. Een berekend batterijcommando uit simulatie telt niet als toekomstig vermogen. Echte pending-/in-flight-batterijpublicaties blijven hun importerendste uitkomst reserveren, inclusief bestaande Split-minimumvermogens.

### `calculateEvPortfolioDecisions`

Batterijondersteuning, nachtoverschot, reserveringen voor gepland batterij-netladen en berekende PV-overname zijn alleen bruikbaar wanneer de batterij-uitvoer daadwerkelijk ingeschakeld, geconfigureerd en geldig getest is.

Zonder die batterij-uitvoer krijgt de EV beschikbare PV zelfstandig toegewezen. PV die een batterij fysiek nog opneemt wordt niet als overdraagbaar EV-vermogen beloofd: eerst moet de echte meetruimte beschikbaar komen. De bestaande gezamenlijke PV-verdeling blijft gelden wanneer de batterijregeling actief is.

### Overige functies en status

- `shouldUseEvBatterySupport` en `getEvNightSurplusStatus` schakelen bij uitgeschakelde batterij-uitvoer geen nieuwe batterijondersteuning in.
- `getBatteryDisabledStatusText`, `createSafetyResult` en `getPublicStatus` maken duidelijk wanneer batterij-uitvoer uit staat terwijl zelfstandige EV-regeling is ingeschakeld. Deze toestand krijgt geen algemene SIMULATIE-status die ook de EV-uitvoer zou suggereren.
- Bij de batterijschakelaar staat een korte NL/EN-toelichting dat de EV-module onafhankelijk werkt en via haar eigen configuratie wordt uitgeschakeld.

Geen nieuwe instellingen, Flow-kaarten, afhankelijkheden, timers, polling of permanente logging. De batterijengine, EV-strategie-engine en bestaande batterijcommandogates zijn niet gewijzigd.

## Behouden voorwaarden

P1-geldigheid en versheid, fysieke Peak Guard, tarief- en netbudgetten, EV-PV-voorwaarden en hysterese, SoC-doelen en deadlines, verbinding en sessiebeëindiging, bestaande laadstroomfeedbackregels, min/max-stroom, fasen/spanningsreferentie, publicatie-intervallen, mutexen, stopwachttijden en gedeelde multi-EV-verdeling blijven actief.

De gewijzigde koppeling aan batterij-uitvoer versoepelt geen EV-veiligheidsvoorwaarde. Een uitgeschakelde EV-module, ontbrekende/verouderde P1, een relevante piek, tariefverbod, ontkoppeling, bereikte doel-SoC of expliciete sessiestop kan het laden nog steeds stoppen.

## Validatie

Alle tests gebruiken de productiecode. Nieuwe scenario's gebruiken echte startup, settingscache, geconfigureerde Flow-inputs, contextscheduler, batterij-/EV-berekeningen en publicatiegates. Homey-I/O, tijd en fysieke terugmeldingen worden gesimuleerd. De startup-harness kan nu ook de echte geregistreerde settingslistener aanroepen voor instellingsovergangen; productie-settingsfuncties worden niet vervangen.

- **55 testsuites** via `npm run check`, inclusief syntaxcontroles en alle voorgaande regressies.
- **55 nieuwe productiecache-scenario's**: alle combinaties van 0/4 batterijen, batterij-uitvoer aan/uit en current/mode/hybrid; starten met uitgeschakelde batterij-uitvoer; omschakelen uit/aan tijdens laden; geen herhaalde identieke publicaties; ontbrekende en verouderde P1; Peak Guard; tariefverbod; disconnect; EV-module uit; bereikte EV-SoC; expliciete sessiestop; PV-start en wegvallen van overschot; ontbrekende batterijtest en batterij-SoC; simulatie- versus echte pending-batterijbudgetten; daadwerkelijk stoppen van actieve batterijen zonder EV-stop; lopende en mislukte EV-publicaties; multi-EV en verlaging van het EV-aantal tot nul.
- **28 bestaande EV-replays tegenover 1.1.4:** de volledige vastgelegde resultaten zijn exact gelijk, inclusief batterij-, EV- en Split-publicaties, volgorde/tijdstippen, monsters, contextmomenten, regelverzoeken, evaluatieaantallen en statuspublicatieaantallen. Omvat onder andere gepland batterij-laden, expliciete batterijondersteuning, Hybrid-batterijregeling, meerdere EV's en lopende EV-publicatie.
- **6 zon/net-replays en 13 laadreplays tegenover 1.1.4:** afzonderlijke batterijcommando's, timing, contextplanning en vastgelegde flexibele uitvoer gelijk. Ook de geregistreerde snelle evaluaties, planningberekeningen, batterijpublicaties, statuspublicaties en fast requests zijn vergeleken en gelijk.
- Engine/lib, drivers, widgets en locales bytegelijk aan 1.1.4. Appmanifest en alle **229 Flow-kaarten** gelijk, afgezien van de versie. De **524 bestaande UI-settings** blijven behouden.

Drie oudere unitbestanden hadden onvolledige fixtures voor actieve batterijallocatie: `controlEnabled`, validatievelden en de testsignatuur ontbraken. Die fixtures geven nu expliciet geldige actieve batterij-uitvoer op. De oorspronkelijke vermogens- en veiligheidsasserties zijn behouden. De nieuwe startup-/PV-harness ondersteunt ook werkelijk uitgeschakelde batterij-uitvoer en een ongeldige batterijtest.

Voor de gewijzigde zelfstandige situaties zijn de EV-uitkomsten bewust anders dan 1.1.4: een heartbeat stopt een geldige EV niet meer uitsluitend omdat batterij-uitvoer uit staat. Ook onbeschikbare theoretische batterijondersteuning of PV-overname wordt dan niet meer aangeboden. Deze wijzigingen zijn beperkt tot die onafhankelijke/onveilige situaties.

Er wordt geen CPU-winst geclaimd. De bestaande CPU-optimalisaties en settingscache blijven behouden; de geregistreerde evaluatie- en publicatieaantallen zijn voor de bestaande actieve scenario's gelijk. De tests zijn in een container uitgevoerd; er is geen Homey-installatie of publicatie verricht.

## Reproduceren

- `npm run check`
- `node test/independent-ev-1.1.5.test.js`
- Dezelfde regressietest tegen originele code: `node test/independent-ev-1.1.5.test.js /pad/naar/1.1.4` (verwacht te falen bij de zelfstandige EV-start/heartbeat).

Testlogs en de actieve vergelijkingsresultaten zijn meegeleverd in deze docs-map.
