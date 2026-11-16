> Historisch verslag van de oorspronkelijke 1.5.9. De aanvullingen op verzoek van de gebruiker staan in `validation/optional-chart-waf-1.5.9/RAPPORT.md`; die zijn leidend voor de brede grafiek, WAF-weergave, PV-dagreset en laagvolgorde.

# HomeFlux EMS 1.5.9 — technisch verslag

Uitgangsbestand: `HomeFlux-EMS-v1.5.8-SOC-Forecast-Replanning.zip`.
SHA-256: `0e6e3c3931f82b34c118c537d20114eb31df8c9fdf7da23bd51d3c7cb82d1f47`. Alle 784 bestanden uit de uitgepakte basis zijn byte voor byte tegen die ZIP gecontroleerd. Er is geen oudere bron of GitHub-code gebruikt.

Interne versie: **1.5.9**. Uitgevoerde controles: **Node.js v22.23.5**.

## Alleen de twee gevraagde correcties

De widget volgt Homey via één bestaande `Homey.__('widget.visual.catalog')`-vertaling. De vijf `locales/*.json` bevatten dezelfde 1282 volledige tekstsleutels, inclusief schrijfvarianten. De bestaande widgetConfig-boodschap geeft de actieve catalogus aan de ingesloten Visual Look door. Dezelfde pure exact/phrase/template-vertaalroutine als de bestaande instellingenweergave wordt gebruikt. Statische tekst, dynamische labels, dialogen, foutmeldingen, SVG-teksten en toegankelijke beschrijvingen worden vertaald. Apparaatnamen, ingestelde tariefnamen, technische gegevens en reeds vertaalde backendstatussen blijven behouden. De iframe-URL heeft een 1.5.9-revisie zodat de nieuwe presentatie wordt geladen. Beide CSS-blokken zijn byte-identiek aan 1.5.8; indeling, kleuren en profielen zijn niet gewijzigd.

SOC staat centraal in **`_savingsToday.houseLoadHistory`**, in dezelfde maximaal 720 punten en met dezelfde vijfminutenregistratie. De bestaande P1-aanroep van de grafiekobserver blijft de enige registratie-ingang. De gemiddelde SOC wordt alleen bij het afsluiten van zo’n interval gelezen, uit de al ontvangen batterijwaarden, met dezelfde pure gemiddeldeberekening als de app. Geldige waarden zijn 0–100%; alle ingestelde batterijen moeten ontvangen, geldige en maximaal vijf minuten oude SOC-invoer hebben. Ontbrekende, ongeldige, verouderde of toekomstige waarden worden niet aangevuld. Zonder verse SOC blijft het optionele veld leeg; zonder huisvermogen kan een geldige SOC wel worden opgeslagen.

Nieuwe rijvorm: `[houseAt, powerW|null, endAt|null, coveredMs|null, soc|null, socAt|null, cursorAt]`. `houseAt` en `socAt` behouden afzonderlijke tijdstempels. `cursorAt` voorkomt dat een SOC-only punt een later huisverbruikinterval overslaat. Oude rijen met twee of vier waarden blijven bruikbaar. Het API-pakket behoudt `at/powerW/endAt/coveredMs` en voegt optioneel `soc/socAt/cursorAt` toe. Een SOC-only pakket heeft **geen** fictief `powerW`-veld. Het bestaande `historyDate/historyAfter`-pad gebruikt de cursor en de bestaande iframe-uitwisseling. De omzetter voor huisverbruik negeert SOC-only punten.

SOC komt voor het historische grafiekdeel uitsluitend uit dit centrale pakket. De actieve localStorage-SOC-registratie en registratie vanuit live widgetstatussen zijn verwijderd. Middernacht scheidt de twee bronnen op hun eigen werkelijke meetdag volgens de Homey-tijdzone; een SOC bij middernacht krijgt geen huisvermogen van de vorige dag mee. Herstel gebruikt de bestaande huidige-dagopslag. Er is geen tweede opslagpad.

**AutoTune is volledig ongewijzigd.** Er is geen koppeling, nieuwe leerregel of wijziging van AutoTune-gedrag toegevoegd. De gegevens blijven als optionele waarden in de bestaande centrale meetpunten beschikbaar.

## Afbakening en prestaties

Van 519 appmethoden zijn er exact drie gewijzigd: `restoreSavingsState`, `recordVisualHouseLoadSample`, `getVisualHouseLoadHistory`. De overige 516 methoden, inclusief alle regel-, financiële, AutoTune-, EV-, HVAC-, boiler-, P1-Flow- en batterijcommandomethoden, zijn identiek. 51 van de 52 bibliotheekmodules zijn byte-identiek; alleen `lib/visual-house-history.js` bevat de noodzakelijke SOC-uitbreiding. De oorspronkelijke tijdgewogen huisverbruik-integrator is exact behouden. `widgets/status/api.js` is byte-identiek.

De volledige prognose-, tariefnormalisatie- en PV-prognoseblokken zijn met vaste SHA-256-controles tegen 1.5.8 vergeleken en identiek. Alle numerieke resultaten van de 19 bestaande virtuele-dagsimulaties zijn identiek aan 1.5.8, afgezien van de gemeten uitvoeringstijd. Het laadplan, de werkelijke EMS-planning en tariefberekeningen zijn niet gewijzigd.

Er zijn geen timers, polling, listeners, API-aanroepen, Homey Settings-sleutels of Settings-schrijfacties toegevoegd. De bestaande prognosecache en minuutgrens blijven intact; geen nieuw prognoseberekeningsmoment. Vertalingen lopen mee met de bestaande weergavefuncties; ongewijzigde EV/HVAC-kaarten gebruiken hun bestaande cache. Het P1-pad doet alleen constante intervalboekhouding; de extra SOC-controle en gemiddeldeberekening gebeuren eenmaal per bestaand vijfminuteninterval en optionele velden bij de al bestaande opslag/overdracht. Bij afwezigheid van P1-berichten wordt niet gepolld; nieuwe punten volgen de volgende bestaande P1-beurt.

Opslag/geheugen blijven begrensd op 720 punten. Een concreet JSON-voorbeeld met SOC 70,5% voegt 9504 bytes toe bij 288 punten per dag (23760 bytes bij 720 punten); precieze grootte hangt af van de waarden. De vijf vertaalbestanden samen groeien ongecomprimeerd met 328757 bytes. De actieve widget gebruikt één taalcatalogus. **Er is geen fysieke Homey-CPU- of geheugentoename gemeten**; er wordt geen nulverbruik geclaimd.

## Tests

**27 van 32 gerichte suites slagen.** De vijf resterende historische suites verwachten expliciet versie 1.5.4 en falen eveneens op de originele 1.5.8. Ze zijn niet herschreven om de release groen te laten lijken.

| Historische suite | Oorzaak |
| --- | --- |
| `visual-compact-header-1.5.4.test.js` | Verwacht letterlijk versie 1.5.4; faalt ook op originele 1.5.8. |
| `visual-look-1.5.4.test.js` | Verwacht letterlijk versie 1.5.4; faalt ook op originele 1.5.8. |
| `visual-look-light-dark-1.5.4.test.js` | Verwacht letterlijk versie 1.5.4; faalt ook op originele 1.5.8. |
| `visual-look-single-status-1.5.4.test.js` | Verwacht letterlijk versie 1.5.4; faalt ook op originele 1.5.8. |
| `visual-mobile-transparency-release-1.5.4.test.js` | Verwacht letterlijk versie 1.5.4; faalt ook op originele 1.5.8. |

`visual-savings-rolling-1.5.4.test.js` gebruikt een vast dagboek van 15 november 2026 maar laat een deel van de daggrens van de echte klok afhangen. Met de echte datum 16 november geeft hij op beide versies 0 in plaats van 0,55. Ongewijzigd uitgevoerd met de bijbehorende virtuele klok (15 november 12:00) slaagt hij op zowel 1.5.8 als 1.5.9. De helper `fixture-clock.cjs` is uitsluitend voor die test; de app laadt hem niet. De no-EV-historiektest is geslaagd nadat de door die oude test verwachte uitvoermap `/mnt/data` beschikbaar was.

Geslaagde nieuwe controles omvatten alle vijf talen, dezelfde taal in het parent/iframe-pad via de Homey-vertalingen, alle twaalf informatiekiezer-tabbladen, EV/HVAC-details, lege toestanden, Savings-foutmeldingen, en controles op onvertaalde vaste tekst. Naam- en backendtekstbehoud zijn expliciet getest, ook met Nederlandstalige apparaatnamen op een Franse widget. Iedere taal heeft dezelfde complete verzameling tekstsleutels.

De centrale SOC-controles dekken vijfminutenregistratie, onveranderde tijdgewogen huisverbruikmetingen, echte ontvangsttijd, nul-SOC, ontbrekende/ongeldige/verouderde waarden, SOC zonder huisvermogen, twee afzonderlijke widgets met identieke SOC-historiek, hervatten na herstart, oude rijen, middernacht, zomer-/wintertijd en de limiet van 720 punten. De automatische Homey-naar-iframe-test bevestigt één bestaande history-, status- en profielopvraging bij openen per taal.

Ook de vier bestaande AutoTune-suites, dynamisch laaduitstel en appintegratie, EV-status/ledger-overdracht, cache/prestatietests, profielherstel en minuutverversingsisolatie slagen. Vijf bestaande testharnassen zijn alleen aangepast voor de vertaalfunctie/locale in hun mocks of voor de nieuwe centrale SOC-bron; hun controles op cache, timing, profielherstel en tariefkleuren blijven behouden. De exacte logs staan in `tests.json`. De volledige historische verzameling van 233 suites is niet volledig uitgevoerd; bovenstaande 32 zijn de gerichte selectie. Er zijn geen tests stilzwijgend overgeslagen in die selectie.

Syntaxcontrole: 365 JavaScript/CJS-bestanden, 5 ingesloten scripts en 333 JSON-bestanden gecontroleerd. De definitieve aantallen staan in `scope-proof.json`. Manifesten/package/lock gebruiken 1.5.9; logging en loopdetectie lezen dezelfde manifestversie. Bestaande manifestteksten, slogan, deprecated Flow-kaarten, eerdere vertalingen en eerdere release notes zijn inhoudelijk gelijk gebleven. De nieuwe release notes in vijf talen noemen alleen de twee correcties.

Niet uitgevoerd: installatie op een fysieke Homey, Homey App Store/CLI-validatie, visuele pixelcontrole in een echte Homey WebView, fysieke batterijproeven en een CPU/geheugenmeting op het toestel. De taal- en interactiecontroles zijn uitgevoerd tegen de echte HTML/JavaScript in jsdom, met gesimuleerde Homey-gegevens; dit is geen hardwaretest.

## Ongewijzigde prognose: bestaande simulaties

| Scenario | Start | Start-SOC | Grootste afwijking widget versus virtuele EMS |
| --- | --- | --- | --- |
| TOU hoog SOC, bestaand plan 0.4 kWh | 2026-11-16T17:00:00+01:00 | 93.3% | 0.000 pp |
| TOU laag SOC | 2026-11-16T22:00:00+01:00 | 20% | 0.000 pp |
| TOU onvoldoende capaciteit | 2026-11-16T22:00:00+01:00 | 20% | 0.002 pp |
| TOU weekend | 2026-11-21T16:00:00+01:00 | 65% | 0.000 pp |
| Dynamisch uur, aansluitend goedkoper | 2026-11-16T01:00:00+01:00 | 35% | 0.014 pp |
| Dynamisch kwartier, kort duur blok | 2026-11-16T01:00:00+01:00 | 14% | 0.019 pp |
| Dynamisch lang duur blok | 2026-11-16T01:00:00+01:00 | 18% | 0.019 pp |
| Dynamisch ontbrekende toekomst | 2026-11-16T01:00:00+01:00 | 35% | 0.000 pp |
| Zonnige dag | 2026-11-16T07:00:00+01:00 | 30% | 0.001 pp |
| Overgang 07 en 17 zonder PV-meting | 2026-11-16T06:00:00+01:00 | 85% | 0.000 pp |
| Zomertijd 23 uur | 2026-03-28T17:00:00+01:00 | 80% | 0.000 pp |
| Wintertijd 25 uur | 2026-10-24T17:00:00+02:00 | 80% | 0.000 pp |
| Vast contract, maximum centrum binnen laadvenster | 2026-11-16T22:00:00+01:00 | 35% | 1.574 pp |
| TOU twee nachttarieven toegestaan | 2026-11-16T22:00:00+01:00 | 20% | 0.000 pp |
| Maximum vroeg | 2026-11-16T22:00:00+01:00 | 35% | 1.574 pp |
| Maximum laatst | 2026-11-16T22:00:00+01:00 | 35% | 1.574 pp |
| Maximum centrum | 2026-11-16T22:00:00+01:00 | 35% | 0.000 pp |
| Peak Guard laadruimte | 2026-11-16T22:00:00+01:00 | 35% | 0.000 pp |
| Dynamisch avond, aansluitend goedkoper | 2026-11-16T15:00:00+01:00 | 30% | 0.000 pp |

De maximale afwijking is 1.574 procentpunt, dezelfde als in 1.5.8. Dit is een regressiecontrole, geen nieuwe prognoselogica. Volledige invoer, laadvensters en vijfminutentraces staan in `simulations.json`.

## Gewijzigde bestanden

- `.homeychangelog.json`
- `.homeycompose/app.json`
- `README.md`
- `app.js`
- `app.json`
- `lib/visual-house-history.js`
- `locales/de.json`
- `locales/en.json`
- `locales/es.json`
- `locales/fr.json`
- `locales/nl.json`
- `package-lock.json`
- `package.json`
- `test/visual-minute-refresh-isolation-1.5.4.test.js`
- `test/visual-next-tariff-no-flicker-1.5.4.test.js`
- `test/visual-performance-1.5.4.test.js`
- `test/visual-profile-startup-recovery-1.5.4.test.js`
- `test/visual-tariff-palette-soc-history-1.5.4.test.js`
- `test/widget-language-bridge-1.5.9.test.js`
- `test/widget-translations-central-soc-1.5.9.test.js`
- `widgets/status/public/index.html`
- `widgets/status/public/visual.html`

Nieuwe verificatiebestanden staan uitsluitend onder `validation/release-1.5.9/`: dit verslag, scopebewijzen, bestandslijsten/hashes, diff, testlogs, simulatie-uitvoer en de testklok. Er zijn geen bestanden verwijderd. Buiten de twee gevraagde onderwerpen, noodzakelijke vertaal-/historiektests en releasewijzigingen zijn geen functionele wijzigingen vastgesteld.
