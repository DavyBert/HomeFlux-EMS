# HomeFlux EMS 1.1.7 — EV-verbruik en batterijregeling

## Bron en vorige werkstatus

Basis: de nieuwste beschikbare `origin/main`, commit
`2a0994756dfc8cd5c2ab4b3aa2ca9a611d4a98a3` (19 oktober 2026).
De remote HEAD is tijdens deze werkzaamheden opnieuw gecontroleerd en bleef gelijk.
Het versienummer is op verzoek verhoogd naar **1.1.7**. De basiscommit is versie 1.1.6.

De vorige afgeronde wijziging was de compacte diagnostiek, vastgelegd in
`docs/COMPACT-DIAGNOSTICS-1.1.6.md`. Deze staat al in de repository en is behouden.
De eerdere hypothese over het begrenzen van werkelijk EV-verbruik door het
netbudget is teruggevonden. Een eerder afgeronde correctie of bijbehorende
tests voor deze fout is niet teruggevonden. Eventuele niet-opgeslagen wijzigingen
uit de vorige sessie zijn niet beschikbaar in deze nieuwe werkomgeving.

## Reproductie

De bestaande real-scheduler-replay is gebruikt: drie fasen, 400 V lijnspanning,
16 A werkelijk teruggekoppeld, 623 W huisverbruik, geen PV, EV-netbudget 7000 W,
geen expliciete batterijondersteuning. Vanaf seconde 90 blijft de lader 16 A
terugkoppelen ondanks een lager stroomcommando.

| Grootheid | Oorspronkelijke code | Met correctie, na verwerking |
| --- | --- | --- |
| Werkelijk EV-vermogen volgens stroomfeedback | circa 11.085 W | circa 11.085 W |
| Vrijstelling voor EV-verbruik bij 7 kW budget | maximaal 7000 W | circa 11.085 W, fysiek begrensd |
| Batterijontlading bij nog actieve EV-beslissing | circa 4716 W | circa 631 W voor het huis |
| Na volgende herberekening, oorspronkelijke replay | EV-beslissing kon naar 0 A gaan; batterij 6000 W | EV krijgt een lager, budgetconform commando; huis blijft circa 631 W |

631 W bij 623 W huisverbruik valt binnen de bestaande regelband. Dit zijn
gesimuleerde meterwaarden en gepubliceerde batterijcommando's; geen metingen
van een fysieke batterij. Een falende regressietest is vóór de productiewijziging
uitgevoerd.

## Oorzaak en correctie

1. `getEvGridImportControlStatus()` begrensde de meetcorrectie voor de batterij
   met het EV-netbudget. Wanneer de lader meer gebruikte dan gevraagd, zag de
   batterijregeling het verschil als te compenseren huisverbruik.
   Verse gemeten EV-belasting bepaalt nu de correctie, ook boven dat budget.
   De EV-regeling blijft lagere, budgetconforme stroomcommando's sturen.
2. `getEvCommandedPowerW()` gebruikte voor fysieke portfolio-accounting nog
   het gepubliceerde stroomcommando. Het verschil met werkelijke stroom kon
   daardoor bij een herberekening opnieuw als huisverbruik worden aangemerkt.
   Deze route gebruikt nu verse stroomfeedback, ook zolang een lager/STOP-commando
   fysiek nog niet is gevolgd. Zonder verse feedback blijven de bestaande
   commandofallback en toestemmingscontrole gelden. De afzonderlijke
   toestemmingscontrole voor de PV-pool blijft behouden.
3. In een gemengd portfolio kon een huisverbruikblokkade van een mode-only-EV
   ook de verse meting van een current/hybrid-EV onderdrukken. De blokkade
   beperkt nu alleen het afgeleide mode-only-aandeel. Zuivere mode-only-sturing
   behoudt haar bestaande detectie en vermogensplafond.

De batterijcorrectie blijft begrensd door het fysiek gereconstrueerde netverbruik:
P1 plus het laatst gepubliceerde, getekende batterijcommando. Netladen van de
batterij wordt daarmee verwijderd; een theoretisch EV-budget kan geen extra
netladen of export door de batterij veroorzaken.

Expliciet toegewezen batterijondersteuning en nachtoverschot worden afgetrokken
van de gemeten EV-bescherming. De aanvullende diagnostiekwaarde
`confirmedEvGridPowerW` maakt dit onderscheid zichtbaar.

Een ingetrokken tarieftoestemming, nul netbudget, verlopen feedback, ontkoppelen
of beëindigde sessie behoudt de bestaande uitsluitingsregels. Deadline- en
Emergency-toestemming blijven via de bestaande beslislogica lopen.
Peak Guard gebruikt nog steeds de ruwe P1-meting en kan voor een echte piek
batterijvermogen vragen. De vrijstelling is dus geen verhoging van het toegestane
EV-setpoint of de fysieke pieklimiet.

## Behoud van gedrag en prestaties

Geen nieuwe settings, migratie, Flow-kaarten, dependencies, timers, polling of
regelcycli. De batterij-engine, PV-verdeling, PV-opvang, planningsgrenzen,
settingscache, snelle evaluatie en feedbackmemo's zijn niet herschreven.
Bestaande intervallen en contextmomenten blijven gelden; de correctie maakt
asynchrone hardwarefeedback niet ogenblikkelijk.

13 bestaande laadreplays zijn rechtstreeks met de oorspronkelijke commit
vergeleken: individuele commando's, publicatietijdstippen, contextmomenten,
evaluatiecounters en feedback-previewcalls zijn exact gelijk. CPU-tijd is niet
als gelijkheidscriterium gebruikt. Er is geen nieuwe Homey-CPU-meting verricht.

## Validatie en overdracht

Resultaat: **`npm run check` geslaagd: 57 testsuites plus syntaxcontroles**.
Ook de oorspronkelijke, ongewijzigde code heeft vóór de correctie haar volledige
56-suitescontrole doorlopen. Het pakket bevat beide checklogs, de patch en de
vergelijkingsuitkomst van de 13 batterijlaadreplays.

Reproduceer met:

```sh
npm run check
node test/ev-battery-protection-1.1.6.test.js
```

De nieuwe suite controleert 14 scheduler-scenario's: twee gerichte replays plus
12 combinaties van TOU/vast/dynamisch kwartier, current/hybrid en 1/4 EV's via
de echte startup/settingscache/Flow-input/control/output-routes. Daarnaast zijn
fysieke begrenzing, getekend batterijvermogen, expliciete batterijondersteuning,
nachtoverschot, deadline/Emergency, gemengde mode/current-portefeuilles,
tariefintrekking, nul netbudget, verlopen/herstelde feedback en verse 0 A
gericht gecontroleerd.

De bestaande 28 EV-feedbackscenario's blijven opgenomen. Alleen de oude
assertions die de foutieve 5 kW-meetbegrenzing eisten zijn aangepast aan de
nieuwe gewenste uitkomst. De bestaande PV-, Peak Guard-, zelfstandige EV-,
Split-, hybride batterij-, scheduler-, cache- en stabiliteitstests blijven lopen.

Geen installatie, publicatie of push uitgevoerd. De oorspronkelijke
testerinstallatie is niet toegankelijk. Deze reproductie gebruikt gesimuleerde
feedback; de volledige praktijklog is daarbij niet geanalyseerd. De reproduceerbare
codefout is aangetoond, de exacte oorzaak van dat specifieke praktijkincident
moet nog met die log worden bevestigd.

Lokale werkbranch: `fix/ev-measured-grid-protection`.
Voor hervatten: gebruik de meegeleverde broncode en deze overdracht als werkstatus.
