# HomeFlux EMS 1.2.2 — batterijvermogens tot 100.000 W

De maximaal instelbare laad- en ontlaadvermogens zijn verhoogd naar **100.000 W per instelling**. Dit geldt voor gedeelde limieten per batterij, de afzonderlijke limieten van batterij 1 t/m 8 en de totale batterijgroep. Alle waarden blijven in W. Bestaande waarden en standaardvermogens worden niet opgehoogd.

## Gevonden grenzen en wijziging

| Instellingen | Voorheen | Nu |
|---|---:|---:|
| `maxChargePerBatteryW`, `maxDischargePerBatteryW` | 10.000 W | 100.000 W |
| `battery1..8MaxChargeW`, `battery1..8MaxDischargeW` | 10.000 W | 100.000 W |
| `maxTotalChargeW`, `maxTotalDischargeW` | 50.000 W | 100.000 W |

Alle 20 betreffende numerieke velden hebben de nieuwe bovengrens. De bestaande minima, stappen en veldwaarden zijn behouden. De centrale `MAX_BATTERY_POWER_W` in de instellingenpagina past deze bovengrens eenmaal toe bij het openen. De HTML-attributen bevatten dezelfde grens als statische fallback. De bestaande `validateNumericSettings()` blijft de validatie uitvoeren: 100.000 W is geldig, 100.001 W blokkeert opslaan; ongeldige getallen en negatieve invoer blijven afgewezen.

De broncode had geen verborgen 10.000 W- of 50.000 W-afkapping in opslag, cache, backend, batterijplanning of publicatie. Wel stond de numerieke P1-invoerkaart `set_grid_power` op ±50.000 W. Dit meetbereik is verruimd tot ±200.000 W, zodat 100.000 W batterijvermogen plus ander installatieverbruik kan worden doorgegeven. Dit is uitsluitend een bereik voor meetwaarden, geen verruiming van Peak Guard of batterijcommando’s. Opslag, cache en regeling verwerken de ingestelde W-waarden al als getallen. Voor die routes is daarom geen nieuwe normalisatie of andere validatiepolitiek toegevoegd. De bestaande formuliercontrole blijft de toegestane invoer bewaken.

## Single en dual mode

- **Single mode:** één getekend vermogenscommando per batterij, via de bestaande Battery Command-tags en Flow-trigger. Intern is positief ontladen en negatief laden. De bestaande optie voor tekenomkering blijft gelden.
- **Dual mode:** in deze code is dit **Split Command**, geactiveerd met `splitCommandBatteryNEnabled`. Dezelfde gedeelde/individuele en groepslimieten worden gebruikt. De publicatie stuurt daarnaast aparte laad-/ontlaadmodi en vermogens via Flow. De bestaande vertraging van één seconde tussen een moduswissel en het vermogenscommando, omkeertimers en technische minimumvermogens blijven ongewijzigd.

Er bestaat dus geen tweede afzonderlijke set maximale laad-/ontlaadvelden voor dual mode. De 20 aangepaste velden bedienen beide modi.

## Audit van de verdere verwerking

- **Instellen en opslaan:** bestaande numerieke velden en de bestaande Homey-settings-schrijfacties; W-invoer wordt niet omgezet naar kW.
- **Opstart en migraties:** geldige bestaande waarden blijven staan; `ensureDefaults()` schrijft alleen ontbrekende waarden. Geen nieuwe migratie en geen wijziging aan standaardvermogens.
- **Cache:** dezelfde waarden worden door `getSettings()` en de bestaande cache doorgegeven. Geen extra settingsopbouw in het live pad.
- **Planning:** `buildSocPlan()` combineert de totale laadlimiet en de som van de bruikbare individuele limieten. Grotere waarden worden niet op 10.000 W afgeknipt.
- **Verdeling:** de bestaande `batteryPowerLimits()`, aggregatie en `distributeCommand()` behouden de afzonderlijke laad-/ontlaadlimieten per batterij en de bestaande groepslimieten.
- **Publicatie:** bestaande `emitPending()` en `publishSplitBatteryCommands()` geven de grotere waarden door via numerieke W-tags. Relevante Flow-outputtags hebben geen aanvullende 10.000 W-grens.
- **Weergaven:** bestaande wattweergave en numerieke Flow-tags verwerken de grotere getallen. Er is geen nieuwe W/kW-conversie nodig.
- **Nulwaarden:** 0 blijft geldige invoer; bestaande nulinstellingen blijven na herstart 0. Het normale regelresultaat blijft dan 0 wanneer de bestaande strategie dat voorschrijft. De afzonderlijke dual-instelling voor een technisch minimum bij 0 W houdt haar bestaande betekenis.

Twee andere groepen hebben bewust hun oude 10.000 W-invoergrens behouden: het **optimale vermogen voor efficiëntieoptimalisatie** en het **technische minimumvermogen van Split Command**. Dit zijn geen maximale laad-/ontlaadvermogens. De efficiëntieverdeler kan ook met een veel lagere optimale vermogensinstelling commando's van 15.000 W per batterij en 60.000 W totaal doorgeven; dit is expliciet getest. Overige voorkomens van `10000`, zoals time-outs en andere regelparameters, zijn ongemoeid gelaten.

## Tests en beperkingen

`test/battery-power-1.2.2.test.js` gebruikt echte productiefuncties: de formulier-range-initialisatie en validator, `setSetting()`/settingscache, volledige app-opstart, `evaluate()`, `buildSocPlan()`, `createSafetyResult()`, `emitPending()` en Split Command-publicatie. Homey-opslag, Flow-uitvoer, klok en timers zijn gesimuleerd.

26 gerichte scenario's zijn uitgevoerd:

- Alle 20 UI-velden: 0, 15.000, 20.000, 60.000 en 100.000 W geldig; 100.001 W, negatieve waarden en ongeldige tekst afgewezen door de bestaande validator.
- P1-meetbereik: manifest en Compose gelijk; echte Flow-handler ontvangt onder andere ±60.000, ±100.000 en ±150.000 W zonder afkapping of tekenwijziging.
- Single en dual, met zowel gedeelde als individuele batterijlimieten: één batterij 15.000/15.000 W; één batterij 20.000/15.000 W; vier batterijen van 15.000 W met 60.000 W totaal; vier batterijen met lagere groepslimieten van 37.000 W laden en 31.000 W ontladen; één batterij met 100.000 W laden/ontladen.
- Elke combinatie bewaart de waarden via de echte instellingenroute, start een nieuwe app met dezelfde opslag, en controleert planning en werkelijk gepubliceerde gesimuleerde Flow-commando's.
- Dual-modepublicatie behoudt de bestaande één-secondevertraging en getekende standaardlaadvermogens.
- Single en dual met efficiëntieoptimalisatie actief: 60.000 W totaal blijft beschikbaar en wordt niet door de 10.000 W-efficiëntiestreefwaarde afgekapt.
- Lagere bestaande vermogens, nulinstellingen, technische dual-minima, SoC-grenzen, Peak Guard en PV-opvang boven het netplanningsmaximum blijven werken.

De controller- en enginebronbestanden zijn byte voor byte gelijk aan de aangeleverde volledige 1.2.1 met WAF-correctie en intensere kleuren. De bestaande WAF-functionaliteit, PV-prioriteit, EV/HVAC/boilerregeling en CPU-optimalisaties blijven zo behouden. De volledige regressiesuite is daarnaast uitgevoerd: **83 van 83 testbestanden geslaagd**. Ook de 35 syntaxcontroles uit het bestaande check-script zijn geslaagd. Resultaten staan in `validation/tests-1.2.2.json`.

**Alle controles zijn simulaties. Er is geen fysieke Homey, omvormer of batterij met 15/100 kW aangestuurd.** De instellingenvalidatie is met een gesimuleerde DOM uitgevoerd; dit is geen visuele browsertest.

Uitvoeren:

```
npm test
node test/battery-power-1.2.2.test.js
```

Optionele vergelijking met de eerdere broncode op een lokale machine:

```
HEMS_BATTERY_BASELINE=/pad/naar/HomeFlux-EMS-1.2.1 node test/battery-power-1.2.2.test.js
```

Gewijzigde bestanden: `settings/index.html`, `.homeycompose/flow/actions/set_grid_power.json`, versievelden in `app.json`, `.homeycompose/app.json`, `package.json` en `package-lock.json`, `.homeychangelog.json`, `README.md`, de bestaande versieasserties in drie tests, de twee Flow-schemaverwachtingen voor uitsluitend het verruimde P1-meetbereik, de nieuwe batterijvermogenstest en dit rapport met bijbehorende validatiebestanden. De Homey-appbeschrijvingen `README.txt` en `README.nl.txt` zijn ongewijzigd.
