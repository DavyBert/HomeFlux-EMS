# HomeFlux EMS 1.1.2 — actieve geplande laadregeling

Gebaseerd op de nieuwste aangeleverde `HomeFlux-EMS-v1.1.1(1).zip`. Versie 1.1.2 is gemaakt op basis van de expliciete toestemming bij een aangetoonde reden.

## Bevestigde oorzaak

`fastIdleGuardBypassActiveSetpoint` veroorzaakt op zichzelf geen volledige snelle evaluatie. De idle guard bewijst alleen veilige nuluitvoer; actieve laadsetpoints horen via `canSkipBatteryFeedback` te worden gecontroleerd. De hoge bypass-teller was dus geen zelfstandig bewijs van een defecte idle guard.

De daadwerkelijk gereproduceerde herhaalroute zit in de onvoorwaardelijke afwijzing van `controlContextDirty` door de feedbackcontrole. Een structurele SoC-/planningsupdate zet deze vlag aan. De bestaande trage contextaanvraag mag pas op zijn al bepaalde tijdstip lopen. Ook wanneer de snelle regeling de nieuwste batterij-invoer al had doorgerekend en exact dezelfde individuele commando's bevestigde, bleef die vlag elke volgende feedbackcontrole blokkeren tot de trage pass plaatsvond. Daardoor ontstonden telkens weer volledige snelle evaluaties zonder nieuw commando.

Een tweede kostenpost was de bestaande feedbackpreflight zelf: ook bij exact eerder gecontroleerde P1-invoer werden opnieuw een evaluatiestatus opgebouwd, het laadminimum berekend en batterijen verdeeld. Dat gebeurt nu alleen als het bewijs niet meer geldt of de meetwaarde nog niet is gecontroleerd.

Deze oorzaak is vastgesteld in de echte productiecode en gereproduceerd via de echte API-/Flow-/schedulerroute. De opgegeven oorspronkelijke tellerstand is niet als exacte trace nagespeeld: de volledige oorspronkelijke meetreeks en alle contextredenen waren niet meegeleverd. De reproductie toont hetzelfde patroon: 277 volledige snelle evaluaties in vijf minuten, veelal zonder commandowijziging.

## Wijzigingen

- `markContextDirty` gebruikt nu `markControlContextDirty`, dat een revisie van de structurele contextwijziging bijhoudt. Dit is geen PV-waarnemingsrevisie. Gewone P1/PV-contextverversingen blijven niet-structureel.
- `rememberBatteryFeedbackMemo` onthoudt welke structurele revisie door de laatste evaluatie is verwerkt en of toen een trage contextpass wachtte.
- `isBatteryFeedbackContextCurrent` laat uitsluitend bij geplande laadregeling een vers bewijs voor diezelfde revisie hergebruiken terwijl de trage pass wacht. Iedere nieuwe structurele invalidatie vereist opnieuw een eerste evaluatie. De dirty-vlag wordt niet gewist en de geplande trage pass wordt niet verschoven of overgeslagen.
- `canSkipUnchangedChargingInput` staat vóór de nuluitvoer-idle-guard. Bij eerder bewezen identieke regelinvoer slaat deze zowel de volledige snelle evaluatie als de bestaande zwaardere preflight over.
- `getChargingInputSignature` en `rememberUnchangedChargingInput` houden alleen het bewijs voor de actuele strategie bij: relevante ruwe status/SoC/beschikbaarheid, werkelijke commando's, efficiëntiegegevens en maximaal acht exacte eerder gecontroleerde combinaties van ruwe en geselecteerde P1. Iedere ongeziene combinatie wordt direct door de bestaande numerieke feedbackcontrole beoordeeld. Dit voegt geen deadband of vertraging toe.
- `canSkipBatteryFeedback` behoudt zijn exacte vergelijking van de afzonderlijke commando's, laadminimum, Peak Guard, EV-doelen en Split-modustimers. Alleen het hergebruik van een reeds verwerkte openstaande contextrevisie en het bewaren van een geslaagd invoerbewijs zijn toegevoegd.

De algoritmen in `lib/ems-engine.js` zijn byte-identiek aan 1.1.1. Planning, verdeling, afronding, deadbands, hardwarelimieten en commandoverzending zijn niet gewijzigd.

## Wanneer blijft een berekening nodig?

Een nieuwe structurele wijziging, minuut-/tariefgrens, nieuwe context/runtime-instellingen of gewijzigd SoC-/beschikbaarheidsbewijs doorbreekt de cache. Een nieuwe P1-meetcombinatie gaat onmiddellijk naar de bestaande feedbackpreflight; die kan de volledige evaluatie overslaan als alle individuele commando's nog precies gelijk zijn. Werkelijke PV-opvang, terugval naar het minimum en Peak Guard lopen verder via de bestaande engine.

De zeer lichte invoerroute is conservatief uitgesloten bij EV-configuratie, Hybrid, Split-commando's, efficiëntieovergangen, een geforceerde timer of veiligheidsaanvraag. Zij controleert de geldigheid van P1, uitvoertoestemming en laadtest. Een mislukte/onbevestigde publicatie is geen bewijs van geldige uitvoer.

Tijdens een lopende publicatie wordt alleen exact reeds berekende invoer overgeslagen als de overeenkomstige berekening daadwerkelijk in-flight of pending is. Nieuwe invoer, een ander pending resultaat of een veiligheidsstop doorbreekt dit bewijs. De uitvoerwachtrij en het minimuminterval blijven intact.

De bestaande minuut-/tariefvervaldatum blijft gelden. De optimalisatie houdt geen gepland vermogen voor onbepaalde tijd vast.

## Regressietests: vijf minuten per scenario

Alle nieuwe scenario's draaien met echte startup, settingscache, settingssnapshots, planning, regelroutes, scheduler, veiligheidsresultaten en publicatiegates. Alleen Homey-I/O, de fysieke meetinvoer en tijd zijn gesimuleerd. `getSettings`, laadtestvalidatie en EV-netbudgetten zijn niet vervangen door fixturefuncties.

De invoer bevat gewone P1-/PV-Flows en periodieke API-SoC-rapporten die een bestaande, uitgestelde structurele contextaanvraag veroorzaken. Bij zon/net is PV 1.200 W en huislast 600 W; bij circa 1.383 W batterijladen leveren zon en net beide aantoonbaar meer dan 25 W aan het laden. Puur netladen gebruikt 0 W PV en een geldig nachtlaadvenster; gedurende de volledige meetperiode moet de modus actief laden en het geplande minimum positief blijven.

| Scenario | Snelle evaluaties 1.1.1 → 1.1.2 | Evaluaties zonder commandoverandering | Batterijpublicaties | Statuspublicaties | Exacte waarden en timing gelijk |
| --- | ---: | ---: | ---: | ---: | --- |
| Puur gepland netladen | 277 → 13 | 277 → 13 | 3 → 3 | 11 → 10 | Ja |
| Gecombineerd zon- en netladen | 277 → 13 | 277 → 13 | 3 → 3 | 14 → 13 | Ja |
| Zon/net met kleine P1-schommelingen | 277 → 13 | 277 → 13 | 3 → 3 | 263 → 20 | Ja |
| Extra PV en later wegvallende PV | 184 → 18 | 178 → 12 | 9 → 9 | 25 → 24 | Ja |
| Piek in huisverbruik / Peak Guard | 261 → 32 | 259 → 30 | 6 → 6 | 24 → 22 | Ja |
| Gewijzigd gepland minimumvermogen | 265 → 16 | 265 → 16 | 5 → 5 | 18 → 16 | Ja |
| SoC, volle en onbeschikbare batterij | 132 → 18 | 125 → 11 | 9 → 9 | 21 → 19 | Ja |
| Laden → rust → ontladen → laden | 172 → 14 | 170 → 12 | 7 → 7 | 18 → 15 | Ja |
| PV-live en onafhankelijke adaptieve live | 266 → 16 | 266 → 16 | 4 → 4 | 19 → 17 | Ja |
| Vertraagde publicatie, gelijke invoer | 69 → 10 | 46 → 6 | 5 → 5 | 16 → 14 | Ja |
| Vertraagde publicatie, nieuwe invoer | 69 → 11 | 46 → 6 | 5 → 5 | 17 → 15 | Ja |
| Uitschakelen tijdens publicatie | 281 → 237 | 275 → 235 | 3 → 3 | 15 → 14 | Ja |
| Falende publicatie en herstel | 50 → 10 | 46 → 6 | 4 → 4 | 14 → 13 | Ja |

De planningsberekeningen en contextmomenten blijven gelijk; bronpresentatie blijft op de bestaande trage housekeeping-cyclus verversen. Minder volledige evaluaties kunnen ook minder overbodige statuspublicaties geven.

In alle 13 scenario's zijn alle individuele batterijcommando's, hun volgorde en exacte virtuele verzendtijden gelijk. Ook de contextmomenten, flexibele uitvoer en vastgelegde regel-/bron-/planningsmonsters zijn exact gelijk. Vergelijking gebeurt met assertions, niet uitsluitend via een gelijke totaalsom.

De vele evaluaties in het scenario met uitgeschakelde uitvoer blijven bewust via de bestaande veiligheidsroute lopen; dat scenario is geen gewone actieve laadregeling. De nieuwe optimalisatie probeert deze veiligheidsroute niet te verkorten.

Aanvullende tests bewijzen dat een tweede structurele invalidatie opnieuw een berekening afdwingt terwijl de eerste nog wacht, dat de trage deadline gelijk blijft, dat het bewijs op de bestaande minuutgrens verloopt en dat verouderde P1-data de veilige stop bereikt.

Alle 51 bestaande suites en de nieuwe suite met 13 scenario's/bewijsgrenzen slagen, evenals de syntaxcontroles. De bestaande settingscachetest controleert ook echte startup en snelle V8-properties. Alle 28 bestaande EV-replays zijn daarnaast vóór/na vergeleken: batterij-, EV- en Split-publicaties, context-/aanvraagdeadlines en meetmonsters blijven exact gelijk. Die aanvullende EV-vergelijking gebruikt het bestaande EV-harnas; de nieuwe laadtests gebruiken de productiecache.

## Werkelijke proces-CPU

Per scenario: tien virtuele minuten opwarming en daarna dertig virtuele minuten met 1.800 P1-inputs. Vijf afzonderlijke processen per versie, na elkaar, in afwisselende volgorde. Er liepen geen andere regressietests tijdens de CPU-meting. Node v24.19.0 in deze container.

CPU is uitsluitend `process.cpuUsage()` user + system over de gemeten replay. De tabel toont de mediaan; `wallMs` is niet gebruikt als CPU-bewijs.

| Scenario | CPU 1.1.1 ms | CPU 1.1.2 ms | Verschil | Volledige snelle evaluaties |
| --- | ---: | ---: | ---: | ---: |
| Puur gepland netladen | 5892.5 | 668.7 | 88.7% | 1281 → 63 |
| Gecombineerd zon- en netladen | 4766.9 | 753.6 | 84.2% | 1261 → 66 |
| Zon/net met kleine P1-schommelingen | 4931.1 | 1240.1 | 74.9% | 1254 → 67 |

Alle individuele batterijcommando's/timing, contextmomenten, flexibele uitvoer en monsters blijven ook in alle langere CPU-replays exact gelijk. Alle losse CPU-metingen en tellers staan in `ACTIVE-CHARGE-1.1.2-cpu.json`; de volledige vijfminutenvergelijkingen staan in `ACTIVE-CHARGE-1.1.2-comparison.json`.

Dit zijn proces-CPU-kosten voor de opgegeven synthetische invoer, geen Homey-CPU-percentages. De echte Homey, Node-versie en apparaten zijn hier niet fysiek getest. Er wordt geen exacte CPU-besparing op de doelhardware beloofd en de 4.669 ms uit de diagnose wordt niet als CPU-tijd geïnterpreteerd.

## Diagnostiek

Alle bestaande counters blijven beschikbaar. Nieuw:

- `fastChargeInputSkipped`: eerder bewezen ongewijzigde laadinput; geen statusopbouw, allocator of volledige evaluatie nodig.
- `fastChargePendingContextSkipped`: laadfeedback hergebruikt voor een reeds verwerkte structurele revisie terwijl de trage contextpass wacht.
- `fastChargePendingInputSkipped`: identieke reeds berekende invoer tijdens een lopende publicatie.
- `fastChargeInputChanged`: een nog niet bewezen meetcombinatie of gewijzigde relevante invoer; dit betekent dat de bestaande preflight wordt geraadpleegd, niet automatisch dat een volledige evaluatie nodig is.

`fastFeedbackUnchangedSkipped` en `fastChargeUnchangedSkipped` tellen ook de lichte route. `fastChargeSourceOnlySkipped` blijft de bestaande numerieke broncontrole tellen. `fastReasonFeedback`, `fastNoCommandChange`, `fastCommandChange` en de idle-bypass-counters blijven hun bestaande betekenis houden. Na de nieuwe laadinputcontrole wordt de idle guard alleen nog bezocht als die eerste controle geen bewijs levert. Er is geen permanente logging toegevoegd.

## Behouden en herhalen

Settingscachemethoden, PV-live-detectie/geldigheidsduur/meetbronselectie, enginebibliotheken, alle 229 Flow-kaarten, UI, widgets en vertalingen zijn byte voor byte gelijk. Er zijn geen nieuwe timers/polling, langere intervallen of lagere gevoeligheden toegevoegd. PV-live blijft uitsluitend een meetbronkeuze; adaptieve live blijft onafhankelijk.

Vanuit de uitgepakte map:

```sh
npm run check
node test/compare-active-charge.js /pad/naar/originele-1.1.1 . > vergelijking.json
node test/measure-active-charge.js /pad/naar/originele-1.1.1 . > cpu.json
```

Een losse replay kan met `node test/active-charge-1.1.2.test.js . stable 300 0`. Scenario's staan in de geëxporteerde `cases`-lijst. CPU-scenario's gebruiken standaard 600 seconden opwarming, 1.800 seconden meting en vijf herhalingen per versie.

Release note: Minder overbodige batterijberekeningen tijdens gepland laden terwijl een trage contextupdate wacht.
