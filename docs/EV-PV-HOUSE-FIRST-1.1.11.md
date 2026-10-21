# PV eerst voor het huis — HomeFlux EMS 1.1.11

## Basis en oorzaak

De bron is het eerder geleverde, bijgewerkte 1.1.10-pakket. Remote HEAD/main staan op `2a0994756dfc8cd5c2ab4b3aa2ca9a611d4a98a3` (1.1.6); de beschikbare lokale 1.1.10 bevat de latere EV/batterijcorrecties, SoC-doorlaadkeuze en split-modeherhaling in seconden. Deze zijn behouden. Omdat er een aangetoonde fout is hersteld, is de door de gebruiker toegestane versie 1.1.11 gebruikt. Er is niets gepusht of gepubliceerd.

De eerdere 1.1.9-correctie behield normale huishoudelijke batterijontlading door deze bijdrage opnieuw als ruimte in de PV-pool te behandelen. Daardoor kon PV volledig aan de EV worden toegerekend terwijl de thuisbatterij het huis bleef voeden. De huishoudelijke begrenzing in `getEvGridImportControlStatus()` reserveerde bovendien vrijwel het volledige huisverbruik totdat PV het EV-verbruik overtrof. Dit paste bij de eerdere testverwachting, maar niet bij de nu expliciet gevraagde volgorde.

## Gerichte correctie

1. `calculateEvPortfolioDecisions()` verwijdert alle bestaande batterijontlading uit de fysieke PV-pool. Ook huishoudelijke batterijontlading creëert geen PV-budget meer. Het huis verbruikt zo eerst PV; alleen het overschot bereikt de bestaande EV/batterijverdeling. De ampère-/modestappen, PV-percentages en vrijgave van ongebruikt batterijbudget blijven behouden.
2. `getEvGridImportControlStatus()` begrenst de gezamenlijke EV-PV-toerekening tot het actuele PV-overschot na de afgeleide huisreferentie. Dit gebeurt ook tussen allocatorberekeningen en bij fysieke restbelasting na STOP. De begrenzing wordt één keer op de gezamenlijke toerekening toegepast; mode/current/hybrid krijgen geen afzonderlijke kopieën van dezelfde PV.
3. Voor huishoudelijke batterijondersteuning wordt alleen `max(0, huisreferentie - actuele PV)` gereserveerd. Het volledige werkelijk gemeten EV-vermogen blijft beschermd, ook als het nieuwe EV-setpoint of netbudget lager is. Expliciete batterij-/nachtsteun wordt nog steeds afzonderlijk als batterijenergie geboekt.
4. `recordEvBatteryHouseReference()` leert geen nieuwe huisreferentie als alleen P1 sinds het vorige P1-sample is vernieuwd en PV nog niet. Het batterijcommando bij ontvangst wordt bij dat P1-sample onthouden. Bij directe EV-stroomfeedback kan een nieuwere P1-meting de oude PV-toerekening bovendien conservatief begrenzen met de vorige huisreferentie. Zo wordt een reeds in P1 zichtbare PV-daling niet met een oude hoge PV-waarde aan de EV toegerekend. Dit is een afgeleide begrenzing; mode-inferentie geldt hiervoor niet als stroommeting.

De huidige batterijontlading wordt hierdoor geen financieringsbron voor haar eigen voortzetting. `pvAllocatedW` blijft de laadallocatie in stappen; `pvAttributedW` houdt de fysieke PV-rest binnen hetzelfde gedeelde budget bij. De correctie geeft geen nieuwe tariefrechten of laadtoestemming.

## Metingen en beperkingen

Er is geen afzonderlijke gelijktijdige huismeter of gemeten batterijvermogen in deze interface. De bestaande huisreferentie is afgeleid uit:

`P1-netvermogen + PV + getekend gepubliceerd batterijcommando - gemeten EV-vermogen`.

EV-vermogen wordt uit laadstroom en de ingestelde fasen/spanning berekend. Ruwe P1-netafname wordt niet als huisverbruik gebruikt. De bestaande controles op aansluiting, meetleeftijd, volgorde van P1/EV-updates en stopovergangen blijven behouden; er is een extra afstemmingsvoorwaarde voor P1/PV toegevoegd. Tijdens onbetrouwbare reconstructie wordt de vorige geldige referentie gebruikt, of de bestaande detectiereferentie indien beschikbaar. Dit is een schatting, geen rechtstreeks gemeten huisverbruik. Ook PV per EV wordt toegerekend, niet afzonderlijk gemeten.

Mode-sturing zonder betrouwbare stroomfeedback behoudt de bestaande P1-detectie en begrensde tijdelijke inferentie; er is geen fictieve stroommeting toegevoegd. Ontbrekende/verlopen feedback, een gelijktijdige verandering van huisverbruik en batterijreactievertraging beperken de nauwkeurigheid. Een bron die oude meetwaarden met nieuwe tijdstempels stuurt, is niet betrouwbaar als vertraagd te herkennen.

## Vergelijking vóór/na

De nieuwe test is eerst uitgevoerd op de ongewijzigde 1.1.10-broncode. Hij faalde via de echte startup, scheduler, allocator en Flow-publicatieroute: 623 W huisverbruik en 5.000 W PV hielden 631 W batterijontlading en 5.000 W EV-PV-toerekening in stand. Op de gecorrigeerde code slaagt dezelfde gewenste-gedragassertie.

Onderstaande waarden zijn gestabiliseerde gepubliceerde opdrachten uit een productiepadreplay met virtuele Homey-I/O en tijd. Het EV-verbruik is gecontroleerd als circa 11.085 W aangeboden; dit zijn geen fysieke installatieproeven.

| Huis | PV | Huishoudelijk tekort | Gepubliceerd batterijcommando na correctie | PV aan EV toegerekend |
| --- | --- | --- | --- | --- |
| 623 W | 5.000 W | 0 W | circa 8 W | 4.377 W |
| 623 W | 200 W | 423 W | circa 431 W | 0 W |
| 623 W | 0 W | 623 W | circa 631 W | 0 W |
| 263 W | 1.153 W | 0 W | circa 8 W | 890 W |

De circa 8 W offset volgt uit de bestaande nulpuntmarge en afronding. Die regeling is niet veranderd. In het vierde voorbeeld blijft de 890 W beschikbaar voor EV/batterij volgens de prioriteiten; batterijoplading is toegestaan. De PV-only-prioriteitstests bevestigen ook daadwerkelijke publicatie van batterijoplaadopdrachten in de replay.

De oude verwachtingen in `test/ev-battery-transition-1.1.9.test.js` en `test/app-control.test.js` zijn gericht aangepast: PV die het huis dekt, hoeft niet tegelijk volledig aan de EV te worden toegerekend met behoud van volledige huishoudelijke batterijontlading. De oorspronkelijke STOP-asserties en meting-boven-setpointbescherming blijven gelden.

## Validatie

- Nieuwe suite `test/ev-pv-house-first-1.1.11.test.js`: 72 bewolkings-, STOP-, prioriteits-, onafhankelijkheids- en gemengde portfoliogevallen via de echte scheduler/publicatieroutes. Daarin staan de vier voorbeelden, PV boven/rond/onder huisverbruik, terugkerende ondersteuning, stabiele plateaus zonder pendelen, intervallen 7/55 seconden, current/mode/hybrid, twee EV's en één gestopte EV naast een doorladende EV. Vier aanvullende overgangen laten P1 en PV in beide volgorden aankomen, bij zowel stijgende als dalende PV. De P1-eerst-regressie faalde afzonderlijk vóór de extra meetafstemming. PV-only testen volgen de gepubliceerde laaduitgangen in de aangeboden stroomfeedback; andere proeven houden de fysieke belasting gecontroleerd boven een eventueel lager setpoint.
- Bestaande 33 EV/batterijovergangsscenario's behouden onder meer SoC-, kWh- en Flow-stops, SoC-doorladen gevolgd door handmatige stop, asynchrone P1/EV-feedback, herhaalde en verlopen feedback, ontkoppelen/heraansluiten, expliciete batterij-/nachtsteun en Peak Guard.
- De volledige `npm run check` omvat syntaxcontrole en 61 suites, inclusief 55 SoC-scenario's, 14 EV-batterijbeschermingsscenario's, PV-/tarief-/vermogensrechten en split-mode-secondenmigratie.
- De 13 deterministische productiecache-/batterijscenario's zonder actieve EV zijn opnieuw met 1.1.10 vergeleken. Settings-/evaluatieaantallen, diagnosetellers, commando's, scheduler-/contexttraces en samples zijn identiek. Dit is geen fysieke CPU-benchmark.
- De batterij-engine, SoC/EV-sessielogica, AutoTune, meetbronselectie, publicatiegates, split-modeconfiguratie en instellingenpagina zijn behouden. Er is geen polling, extra regelkring of timer toegevoegd. Settingsschema blijft 71.

## Afzonderlijk fysiek bevestigen

Een berekend commando, gepubliceerde Flow-opdracht en werkelijk uitgevoerd vermogen zijn verschillende bewijsniveaus. De tests controleren de eerste twee, met gesimuleerde feedback. Bevestig op de installatie de werkelijke PV-, EV-, P1- en batterijrespons bij bewolking, EV-STOP en herstart, in het bijzonder bij mode-sturing zonder stroommeting en bij meerdere EV's.

De ingestelde commando-intervallen blijven van kracht: een eerder huishoudelijk batterijcommando kan bij een plotselinge PV-stijging blijven staan tot de volgende toegestane publicatie. De test met 55 seconden maakt dit onderscheid expliciet en controleert apart dat de nieuwe berekening het EV-verbruik niet overneemt. Meetvertraging, Flow-publicatie en fysieke reactie van laadpaal/omvormer kunnen daarnaast tijdelijke afwijkingen veroorzaken. Peak Guard mag volgens zijn bestaande veiligheidsrechten ingrijpen; dat is geen gewone huishoudelijke of onbedoelde EV-bijdrage.

## English release explanation

Solar power now covers the household before the flexible EV/battery pool. Existing battery discharge can no longer finance its own continued household support by being credited as solar headroom. The battery correction reserves only the remaining household shortfall and caps the portfolio's solar attribution after household demand. Actual EV demand remains protected above a reduced setpoint and during a STOP transition. Explicit EV battery/night support, Peak Guard, SoC preferences and split-mode resend in seconds are retained. No polling, control cadence, AutoTune or command intervals were changed. Household demand remains an estimate from P1, solar, published battery commands and EV-current feedback; physical response still needs installation validation.
