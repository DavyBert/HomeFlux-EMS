# HomeFlux EMS 1.1.4: mediaan voor de nachtelijke PV-voorspelling

Gebaseerd op de laatst geleverde HomeFlux-EMS-v1.1.3.zip; app.js is vóór de aanpassing tegen dat archief geverifieerd.

## Eerst getest, daarna geïmplementeerd

Een replay gebruikt echte productie-initialisatie, settings/cache, forecast-Flow-kaarten, de contextscheduler, planning en batterijregeling. Alleen Homey-I/O en tijd zijn gesimuleerd. Het doel is niet handmatig vastgezet: `targetSocOverride` is null. De batterijcapaciteit is 21,6 kWh en de verwachte energievraag 20 kWh. Om het effect van de energievoorspelling zichtbaar te maken zijn aanvullende optionele zonkans- en maandreserves in deze proef uitgeschakeld.

Voorspellingen voor dezelfde actieve planningsdag, telkens na tien virtuele minuten: **8, 8, 8, 14, 2, 9, 7, 15, 1, 8, 8 kWh**.

| Uitkomst | 1.1.3 | 1.1.4 |
|---|---:|---:|
| Laagste SoC-doel | 33,1% | 65,6% |
| Hoogste SoC-doel | 98,0% | 65,6% |
| Spreiding | 64,9 procentpunt | 0 procentpunt |
| Som van de opeenvolgende absolute doelwijzigingen | 259,4 procentpunt | 0 procentpunt |

Eerst is een testvariant met een mediaan op de originele code uitgevoerd. Daarna is dezelfde reeks met de daadwerkelijke gewijzigde productiecode herhaald; die geeft hetzelfde stabiele doel. Dit bewijst een relevante verbetering voor uitschieters in deze gesimuleerde reeks, niet dat iedere echte nacht een constant doel krijgt.

Het benodigde laadvermogen blijft zich aanpassen aan de resterende tijd tot het doelmoment en aan de echte batterij-SoC. Er wordt dus geen statisch laadcommando ingevoerd.

## Werking

- Eén mediaan voor alle geldige, werkelijk aangeleverde energievoorspellingen die bij het actieve nachtplan en de betreffende kalenderdag horen.
- Bij de start telt hoogstens de ene reeds beschikbare geldige voorspelling als beginwaarde mee. Overdag ontvangen waarden worden niet als volledige historische reeks meegenomen.
- Voor middernacht betreft dit normaal de voorspelling voor morgen. Na middernacht telt 'resterend vandaag' voor diezelfde kalenderdag mee. Dezelfde historie blijft behouden; de bestaande promotie van morgen naar vandaag voegt geen extra waarneming toe.
- Voorspellingen voor een andere dag tellen niet mee.
- Iedere daadwerkelijke aanlevering telt eenmaal, ook als de waarde gelijk is aan de vorige aanlevering. Dat is noodzakelijk om een blijvende echte herziening uiteindelijk te laten doorwegen. Evaluaties, P1-updates en statusopvragen voegen niets toe.
- Bij een even aantal waarnemingen is de mediaan het gemiddelde van de twee middelste waarden. 0 kWh is geldig. Ontbrekende/ongeldige waarden zoals null, lege tekst, booleans en niet-eindige getallen worden niet meer als een nieuwe nulvoorspelling behandeld. De bestaande normalisatie van negatieve numerieke invoer naar nul blijft behouden.
- De bestaande startdetectie voor dagplanning, PV >= 5 W, wist de historie onmiddellijk. De dagplanning gebruikt vervolgens de gewone actuele waarde 'resterend vandaag'; de nachtmediaan speelt geen rol meer. Als nog geen resterend-vandaagwaarde beschikbaar is, blijft de bestaande fallback voor ontbrekende dagdata gelden.
- Een klokgrens of laaddeadline alleen wist de mediaan niet zolang de bestaande nachtplanning nog actief is.
- De eerstvolgende overgang van dag- naar nachtplan begint opnieuw. Ook de bestaande 20:00-fallback op een volledig donkere dag rolt naar een nieuwe planningsdag en wist de oude historie.
- De historie staat uitsluitend in geheugen. Een herstart begint opnieuw met de beschikbare geldige voorspelling; er worden geen historische medianen in settings geschreven of uit vorige nachten hersteld.

De mediaan dempt uitschieters, maar reageert bewúst trager op een structureel veranderde voorspelling. Een test met drie waarden van 8 kWh gevolgd door vier waarden van 1 kWh laat zien dat de mediaan uiteindelijk naar 1 kWh beweegt. Er is geen extra vertragingstimer of gevoeligheidsinstelling toegevoegd.

## Implementatie

`getNightForecastRuntime`, `getNightForecastInputRuntime` en `addNightForecastSample` beheren de historie per doelkalenderdag. De reeks wordt met binaire invoegpositie bijgehouden bij echte forecast-input; de mediaan wordt dan eenmaal bijgewerkt. De gewone batterijroute leest alleen de opgeslagen waarde, zonder de reeks opnieuw te sorteren.

`updateForecastInput` en `updateForecastTomorrowInput` nemen echte waarnemingen op. Een veranderde mediaan geeft ook een wijziging door wanneer de nieuwste ruwe waarde gelijk is gebleven. De Flow- en API-routes gebruiken dezelfde inputfuncties.

`getEvaluationState` geeft tijdens nachtplanning de gekozen mediaan door aan de bestaande forecastvelden van de engine. Planning, strategiecontext en batterijregeling gebruiken zo dezelfde selectie. De oorspronkelijke ruwe forecastvelden en de bestaande dagelijkse maximumregistratie blijven beschikbaar in de appstaat. Bij dagplanning wordt die projectie niet toegepast.

`activateNightPlanning` en `updatePvPlanningState` bewaken de start/reset. De bestaande lokale datum wordt binnen `getEvaluationState` gedeeld door de fasecontroles; de nieuwe selectie introduceert geen herhaalde sortering of extra datumreconstructie per forecastwaarneming in de P1-route.

De engine en vermogensberekeningen zijn ongewijzigd. Settingscache, PV-live-meetbronkeuze en 1.1.3-optimalisaties blijven behouden. Geen nieuwe timers, polling, instellingen, afhankelijkheden, Flow-kaarten of permanente logging.

## Validatie

- `npm run check`: 54 testsuites inclusief syntaxcontroles en de nieuwe nachttests geslaagd.
- Gerichte tests op Flow/API, oneven/even mediaan, nul, ongeldige waarden, gelijke herhaalde aanleveringen, uitsluiten van andere voorspeldagen en geen waarnemingen toevoegen bij status-/regelopvragen.
- Overgangstests op middernacht, geen reset bij alleen de laaddeadline, PV onder/boven de bestaande 5 W-grens, directe terugkeer naar resterend vandaag, de echte PV-stopvertraging bij zonsondergang en een verse mediaan in het nieuwe nachtplan.
- Tests op een donkere dag met 20:00-rollover, een herstart en de overgang naar wintertijd in Europe/Brussels.
- Wijziging van de echte batterij-SoC blijft de benodigde laadenergie verminderen; ruwe P1 blijft Peak Guard activeren terwijl de nachtmediaan aanwezig is.
- Zes bestaande zon/net-replays en dertien laadreplays vergeleken met 1.1.3: individuele batterijcommando's, timing, contextmomenten en vastgelegde flexibele uitvoer gelijk. Deze scenario's herhalen stabiele voorspellingen of testen dagwerking; veranderende nachtvoorspellingen worden afzonderlijk getest als de bedoelde functionele wijziging.
- 28 EV-scenario's vergeleken met 1.1.3: batterij-, EV- en Split-publicaties inclusief timing, monsters, contextmomenten en eindtoestanden gelijk.
- Engine/lib, settings, vertalingen, drivers en widgets bytegelijk aan 1.1.3. Alle 229 Flow-kaarten behouden. Alleen versiecontroles in bestaande tests bijgewerkt.

Voor deze wijziging wordt geen CPU-winst geclaimd. De aangetoonde verbetering is de stabielere forecastafhankelijke nachtelijke SoC-doelstelling. Praktijkwerking is nog niet op een Homey gemeten; de bronbuild is niet geïnstalleerd of gepubliceerd.

## Reproduceren

- `node test/night-forecast-1.1.4.test.js`
- `node test/night-forecast-replay.cjs`
- Dezelfde replay tegen 1.1.3: `EMS_ROOT=/pad/naar/1.1.3 node test/night-forecast-replay.cjs`
- `npm run check`

De gemeten doelreeksen staan in NIGHT-FORECAST-1.1.4-comparison.json. De testlog en de vergelijking van bestaande routes zijn bijgevoegd.
