# HomeFlux EMS 1.1.9 — keuze na bereiken EV-SoC

## Bron en historische bevindingen

Basis is het aangeleverde `HomeFlux-EMS-v1.1.8-ev-fix(1).zip`, SHA-256
`acec1807c505bc870d04b72b63b67c48d807b75894f0d38d352152e88d013fae`.
Alle bronbestanden kwamen overeen met de bestaande 1.1.8-werkmap.
De remote `HEAD` en `main` zijn opnieuw gecontroleerd: beide wijzen naar
`2a0994756dfc8cd5c2ab4b3aa2ca9a611d4a98a3` (release 1.1.6).
De aangeleverde 1.1.8-correcties bovenop die commit zijn behouden.

| Versie / datum | Commit | Aantoonbare wijziging |
| --- | --- | --- |
| 0.7.2 / 13 september 2026 | `073bd2af776f297b1c6d4ff29e4e541526a1cf00` | `calculateEvDecision()` verwijderde de directe stop bij een bereikt minimum. De garantieverplichting verviel en tarief-/PV-laden kon doorgaan. De tekst "Minimumdoel bereikt" werd toegevoegd. |
| 0.7.12 / 16 september 2026 | `97a19b0` | De repository bevat vanaf deze commit `markEvSessionEnded()`; dit is de eerdere basis voor expliciete sessiebeëindiging. |
| 1.0.0 / 28 september 2026 | `1161a14047908f3b82ab617b70010b07b799afa4` | Een verse SoC op het doel of geleverde gevraagde kWh leverde `targetCompleted` op. De sessielatch voorkwam vervolgens hervatten op gunstige tarieven/PV. |
| 1.1.8 | aangeleverde broncode | Deze stopbeslissing was behouden. `lib/flexible-loads.js` is bytegewijs gelijk aan remote 1.1.6, inclusief de regels die `git blame` aan 1.0.0 toewijst. |

De reden is in zoverre aantoonbaar dat `docs/UPDATE-1.0.0.md` expliciet zegt:
"Reaching a SoC/kWh goal now stops this session even during favourable tariffs
or available PV." De wijziging maakte deel uit van het onderscheiden van
laden, pauzeren en voltooien. De bijbehorende tests in
`test/flexible-loads.test.js` en `test/regressions-1.0.0.test.js` eisen dezelfde
stopwerking. Het commitbericht zelf vermeldt alleen "Prepare release v1.0.0".
Een oorspronkelijke gebruikersopdracht of verdere motivatie is niet in deze
repository vastgelegd; daarover wordt geen oorzaak verzonnen.

Conclusie: de stopwerking is niet in 1.1.8 geïntroduceerd. De oudere
minimumdoeltekst verderop in de beslisfunctie was bij voltooiing onbereikbaar
door de vroege `targetCompleted`-return. Verschillende oude Flow-helpteksten
beloofden bovendien nog verder laden, ook bij kWh-doelen. Deze teksten zijn
bijgewerkt; kWh-sturing zelf is niet gewijzigd.

## Nieuwe keuze en standaard

Bij elk van de vier EV's staat onder de SoC-doelinstellingen:

- **Stoppen met laden** (`stop`, standaard).
- **Verder laden volgens ingestelde tarief- en PV-voorkeuren** (`preferences`).

De persistente sleutels zijn `evAfterSocTarget`, `ev2AfterSocTarget`,
`ev3AfterSocTarget` en `ev4AfterSocTarget`. Ontbrekende of ongeldige waarden
betekenen stoppen. Zo verandert een bestaande configuratie niet ongemerkt.
Nederlandse en Engelse UI-teksten, Flow-help en changelog zijn bijgewerkt.
Kaart-ID's en argumenten blijven gelijk, inclusief de oude Flow-kaarten.

### Stoppen

Een verse, ingeschakelde SoC op het doel beëindigt de sessie. Current-sturing
publiceert 0 A en niet toegestaan; modussturing Stop en niet toegestaan;
hybrid publiceert beide. De bestaande latch houdt de sessie beëindigd.

### Verder laden

Een bevestigd SoC-doel wordt eenmaal per sessie onthouden. De EV gaat daarna
naar de gewone Smart-verdeling: geselecteerde tarieven, PV-beleid, netbudget,
gewichten, batterijvoorkeuren en Peak Guard bepalen het vermogen. Er wordt
geen nieuwe laadvergunning buiten die voorkeuren gegeven. De deadline en
garantie zijn voor het afgeronde doel niet langer actief.

Een tijdelijke modusoverride wordt bij die voltooiing gewist. Een
geconfigureerde Emergency-modus blijft voor de afgeronde sessie eveneens
ondergeschikt aan Smart; Emergency behoudt tot voltooiing zijn bestaande
100%-doel. Een nieuw expliciet moduscommando activeert die modus weer.
Een voltooid Flow-SoC-doel blijft als doel opgeslagen voor de volgende
aansluiting, maar veroorzaakt in de afgeronde sessie geen herhaalde garantie.

Een bestaande SoC-meting van vóór opnieuw aansluiten kan de nieuwe
doorlaadsessie niet meteen voltooid verklaren. Nieuwe voltooiing vraagt een
bruikbare SoC-bevestiging voor die aansluiting. Een eenmaal bevestigd doel
blijft in dezelfde sessie onthouden als SoC daarna verloopt of iets daalt.
Ontbrekende/verlopen SoC vóór voltooiing behoudt de bestaande fallback.

Een nieuw doel, een expliciete gewijzigde modus of een gewijzigde
SoC-doelinstelling activeert doelberekening opnieuw. Het ongewijzigd opslaan
van een instelling doet dat niet. Loskoppelen wist de voltooiingsmarkering;
opnieuw aansluiten activeert het opgeslagen doel opnieuw. De markering volgt
de bestaande sessieruntime en is niet apart persistent na een appherstart.
Na herstart kan actuele SoC het doel opnieuw bevestigen.

Een expliciete handmatige/Flow-sessiestop blijft een harde beëindiging.
De doorlaadoptie heft die niet op. kWh-doelen behouden hun bestaande
voltooiing en stopwerking, ook wanneer de SoC-doorlaadoptie aan staat.

## Code en prestaties

- `lib/flexible-loads.js`: doelbereik met de nieuwe keuze en gewone Smart-policy.
- `app.js`: mapping voor alle EV's, eenmalige sessiemarkering, reset bij een
  nieuw doel/aansluiting en effectieve Smart-modus na voltooiing.
- `lib/ems-engine.js`: uitsluitend defaults en mapping voor de nieuwe keuze;
  geen wijziging aan de batterijberekening.
- `lib/compact-diagnostics.js`: gekozen beleid en SoC-voltooiing staan in de
  bestaande compacte beslisgebeurtenissen.

Geen extra timers, polling, dependencies of regelkring. AutoTune, P1-cadans,
P1-bronselectie, batterij-outputplanning en de bestaande bescherming op basis
van verse gemeten EV-stroom zijn ongewijzigd. Het pakket bevat een
bronvergelijking van deze beschermde methoden.

## Validatie en praktische grenzen

De nieuwe `test/soc-completion-1.1.9.test.js` is opgenomen in `test` en `check`.
Deze controleert de beide keuzen, ontbrekende/ongeldige configuratie,
geselecteerde/niet-geselecteerde tarieven, PV, vaste en dynamische tarieven,
current/mode/hybrid, één/vier EV's, Flow-doelen, herhaalde SoC, verlopen SoC,
nieuwe doelen/modi, wisselen van de keuze, heraansluiten, expliciete stop en
Peak Guard. De bestaande kWh-completiontests blijven lopen.

De featuretest faalt zoals verwacht op de aangeleverde 1.1.8-code. Dat log is
alleen bewijs dat het een nieuwe keuze betreft, geen mislukte 1.1.9-validatie.
De volledige 1.1.9-uitkomst staat in `validation/version-1.1.9-full-check.log`.

Daarnaast zijn 13 batterijreplays rechtstreeks met het aangeleverde
1.1.8-pakket vergeleken: commando's, publicatietijden, contextmomenten,
evaluatiecounters, previewcalls en flexibele uitgangen zijn exact gelijk.
CPU-tijd is niet als gelijkheidscriterium gebruikt; er is geen nieuwe fysieke
Homey-CPU-meting gedaan.

Alle laaduitgangen in de tests zijn gepubliceerde opdrachten in de bestaande
productie-harness, met gesimuleerde feedback. Dit bewijst niet dat een fysieke
lader ze uitvoert. Test op Homey nog beide keuzen bij het bereiken van het
SoC-doel, de werkelijke stopactie via de laadpaal-Flows, eventueel fasewisselen
en hervatten met een nieuw doel/aansluiting.

Deze wijziging verklaart op zichzelf niet Freds gemelde 6 A na een doel of
het verschil tussen een gemelde P1-input per seconde en AutoTune-cadans.
Daarvoor blijft een volledige actuele diagnose nodig. Deze opdracht heeft
die afzonderlijke meet- of uitvoeringsproblemen niet gewijzigd.

Geen installatie, publicatie of push uitgevoerd.

## Aanvullende EV/batterijcorrectie binnen 1.1.9

Na de SoC-uitbreiding zijn de twee gereproduceerde EV/batterijproblemen aangepakt.
De bronkeuze tijdens stopovergangen en de fysieke EV/PV-boekhouding zijn gericht
aangepast; de batterij-engine zelf blijft ongewijzigd. Zie
`docs/EV-BATTERY-FIX-1.1.9.md` voor oorzaken, tests en meetbeperkingen.
