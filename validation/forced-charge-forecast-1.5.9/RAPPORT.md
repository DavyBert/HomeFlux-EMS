# HomeFlux EMS 1.5.9 — Prognose tijdens geforceerd laden

Uitgangspunt: `HomeFlux-EMS-v1.5.9-Visual-Translations-Central-SOC.zip`, SHA256 `e216c0a06ace98de2052079e217a5a8b48d539d9384a238930bf52324ca0fcc4`. Geen GitHub-code en geen versie-bump. Node.js 22.23.5.

## Vaststelling en correctie

De widget zette voor alle niet-Auto-modi de voorspelde netlading op nul. Bij `manual_charge` blokkeerde hij bovendien toekomstige ontlading gedurende de volledige horizon. Het reeds gepubliceerde `forcedModeResumeAt` werd niet verwerkt. Daardoor kon de curve tijdens geforceerd laden vlak blijven, hoewel de werkelijke EMS later normaal doorgaat.

Alleen `widgets/status/public/visual.html` is functioneel gewijzigd: geforceerd laden vult de voorspelde batterij tot het ingestelde maximum, begrensd door bestaand laadvermogen, beschikbare netruimte en verliezen. PV en net delen dezelfde limiet; het actuele batterijcommando wordt niet naar de toekomst doorgetrokken. Op het bestaande EMS-terugkeermoment wordt Auto geprojecteerd. Zonder ingestelde/gemelde terugkeer wordt geen terugkeer verzonnen. Vol raken beëindigt op zichzelf de geforceerde modus in de productiecode niet.

Wanneer het optionele WAF-budget ontbreekt, gebruikt de prognose de bestaande EMS-verbruiksraming (`visualPlanner.expectedEnergyNeedKwh`). Dit is toekomstige geschatte vraag, geen nieuw of fictief historisch meetpunt.

## Instelling op het screenshot

`Laden met maximaal toegestaan vermogen` is `chargeStrategy.*.*.mode=maximum`, met de gekozen positie `latest` en bestaande marge. Deze instelling is afzonderlijk van `forcedMode=manual_charge`. Onderzoek en integratietests tonen niet dat maximaal laden zichzelf naar die geforceerde modus schakelt. In de onderzochte code loopt het instellen van een geforceerde modus via `setForcedMode` (apparaat/Flow). Zonder gebeurtenislog van de installatie kan niet worden vastgesteld welke bediening of Flow de waargenomen modus heeft geselecteerd. Het gedrag is niet aangepast.

## Validatie

De nieuwe regressietest faalt op de originele widget doordat geforceerd laden geen stijgende curve oplevert; na correctie slaagt hij.

| Nieuwe simulatie | Maximale SOC-afwijking van echte engine |
| --- | ---: |
| forced TOU, return to Auto | 0.0012 procentpunt |
| forced TOU with PV | 0.0030 procentpunt |
| forced TOU with Peak Guard | 0.0037 procentpunt |
| forced TOU, configured maximum 80% | 0.0012 procentpunt |
| forced charge remains selected without automatic resume | 0.0000 procentpunt |
| forced dynamic, known prices | 0.0012 procentpunt |
| forced dynamic, unknown prices | 0.0000 procentpunt |
| resume between five-minute boundaries | 0.0006 procentpunt |

Virtuele SOC-feedback in stappen van vijf minuten, met extra grens op het werkelijke terugkeermoment. Vergelijking vanaf 13:00 tot 20:00 op 16 november 2026; Europa/Brussel. SOC-curves worden over hun bestaande horizon berekend. De volledige tijdreeksen staan in `forced-simulations.json`.

Geslaagde tests:

- 19 bestaande dagsimulaties tegenover de echte EMS-engine en 120 exacte vergelijkingen van dynamische uitstelregels. Alle 19 automatische prognoses zijn exact gelijk aan vóór deze correctie, inclusief standaard en maximaal laden.
- 8 nieuwe simulaties hierboven; cachebehoud, wijziging terugkeermoment, ontbrekend WAF-budget, normaal en maximum vroeg/laat/gecentreerd.
- Werkelijke app-/apparaatmodus → widget-API → ingesloten renderer, voor standaard en maximum/laatste laadstrategie. Geen settingswrites, vervanging van echt laadplan, batterijcommando’s of extra regeltimers door het lezen/renderen.
- Widgetrenderer, vijf talen, centrale SOC-historiek, herstart/middernacht, 720-puntenlimiet, volledige-breedtegrafiek, dagelijkse PV-reset en compacte tijdas.
- Bestaande minuutpoort: geen nieuwe polling, timers, listeners, opslag of herberekenmomenten.

De bestaande vertaal-/historiektest bevatte een bronhash die nog exact de oude prognose vereiste. Alleen deze verwachte hash en de bijbehorende toelichting zijn bijgewerkt voor de uitdrukkelijk gevraagde prognosecorrectie; de prijs- en PV-hashes zijn behouden.

## Scope en beperkingen

Bytevergelijking: `app.js`, alle bestaande bestanden onder `lib/`, `drivers/`, `settings/`, `locales/`, widget-API en oorspronkelijke configuraties zijn ongewijzigd. Dus geen wijziging aan EMS-regeling, laadplanning, commando’s, tarieven, AutoTune, Savings, EV/HVAC/boiler of centrale SOC-opslag. Versie blijft 1.5.9. Alleen de widgetprognose plus bijbehorende tests/dit verslag zijn gewijzigd.

Geen fysieke Homey-, batterij- of CPU-meting uitgevoerd; geen volledige projecttestsuite of Homey CLI-validatie uitgevoerd. CPU-impact: uitsluitend enkele constante controles binnen de bestaande widgetberekening; server- en opslagfrequentie blijven gelijk. De prognose blijft afhankelijk van bekende gegevens en schattingen; plotselinge nieuwe informatie wordt niet voorspeld.

## Gewijzigde bestanden

- `test/widget-translations-central-soc-1.5.9.test.js`
- `widgets/status/public/visual.html`
- `test/widget-forced-charge-integration-1.5.9.test.js`
- `test/widget-forced-charge-forecast-1.5.9.test.js`
- `validation/forced-charge-forecast-1.5.9/*` (dit verslag, vergelijking en simulatieresultaten).
