> Historisch verslag: de uurtekst volgt inmiddels de lettergrootte van de legenda. Zie `validation/legend-font-1.5.9/RAPPORT.md`.

# HomeFlux EMS 1.5.9 — adaptieve en grotere uurtekst

Basis: laatst opgeleverde 1.5.9 ZIP, SHA-256 `7085eb19b98968e524436f2e7db5f40588d488a6bc25e78820853696a5d76b8f`. Versie blijft 1.5.9.

De SOC-grafiek toont bij een bereik tot en met 24 uur standaard iedere drie uur een tijdlabel. Een weergave tot 17h krijgt bijvoorbeeld 0h, 3h, 6h, 9h, 12h, 15h en 17h. Bij een langere tijdlijn blijft de basisafstand zes uur. Begin en einde blijven zichtbaar. Als de grotere AM/PM-tekst niet past, worden bij voorkeur tussenliggende drie-uurslabels weggelaten, met behoud van de zes-uursankers en het eindtijdstip.

De uurtekst onder de SOC-grafiek is van 10 naar 20 SVG-eenheden vergroot. De bestaande ondermarge wordt gebruikt: viewBox, grafiekhoogte, tekenvlak en profielschaling veranderen niet. De tekstbreedte wordt conservatief geschat op basis van tekens; labels worden binnen de beschikbare breedte geplaatst en onderling gescheiden. De echte tijdposities van de rasterlijnen blijven behouden. Er zijn geen extra DOM-metingen of timers. De aparte tarieftijdlijn blijft iedere zes uur gelabeld en behoudt zijn eigen lettergrootte.

De bestaande 24-uurs-/AM/PM-keuze, standaard brede grafiek, WAF-kleuren, PV-dagreset en zichtbare EMS-laadstroken blijven behouden. Geen nieuwe instellingen of opslagacties.

**8 van 8 gerichte suites slagen onder Node.js 22.23.5**, inclusief vijf talen, korte/lange tijdvensters, beide uurformaten, grotere tekst binnen de grafiekgrenzen, einde/begin zichtbaar, instellingen, centrale SOC-historiek en cache/minuutgrens. De 19 virtuele-dagsimulaties geven identieke numerieke resultaten als de vorige levering. De vaste appfixture voor 16 november gebruikt nu ook een bijbehorende vaste API-dagklok; zonder die testklok werd de dagopvraging op 17 november leeg. Er is hiervoor geen productiecode aangepast.

`app.js`, de status-API en alle bibliotheekmodules zijn byte-identiek aan de vorige levering. SOC-prognose, PV-dagweergaveberekening, centrale SOC-opslag en EMS-/AutoTune-/tarief-/EV-/HVAC-/boilerfuncties blijven ongewijzigd. De nieuwe logica is uitsluitend aslayout en tekstgrootte in de bestaande rendercyclus. Geen extra polling, achtergrondprocessen, P1-listeners of prognoseberekeningsmomenten.

Niet uitgevoerd: fysieke Homey-installatie, pixelcontrole in een echte Homey-WebView en fysieke CPU-/geheugenmeting. De labels zijn gecontroleerd in de echte HTML/JavaScript onder jsdom en met begrensde breedteschattingen; de volledige historische testsuite is niet opnieuw uitgevoerd.

## Gewijzigde bestanden

- `.homeychangelog.json`
- `README.md`
- `test/widget-compact-hours-1.5.9.test.js`
- `test/widget-translations-central-soc-1.5.9.test.js`
- `validation/compact-hours-1.5.9/RAPPORT.md`
- `widgets/status/public/index.html`
- `widgets/status/public/visual.html`

Bewijzen: `proof.json`, `tests.json`, `simulations.json`, `changes.diff`. Syntax: 367 JS/CJS, 5 ingesloten scripts, 343 JSON. Oudere verslagen beschrijven eerdere aanvullingen; dit is het actuele aslayoutverslag.
