# HomeFlux EMS 1.1.12 — gerichte cache voor EV-doeltijden

22 oktober 2026. Aanvulling op EV-CPU-1.1.12.md. Versie blijft 1.1.12.

## Uitkomst en praktische beperking

De zuivere kalenderzoekfunctie hergebruikt nu maximaal 32 resultaten voor een identiek exact tijdstip, lokale doeltijd en tijdzone. De zoekregels, deadline-mutaties en regelarchitectuur zijn behouden. Alle retourdatums zijn nieuwe Date-objecten.

In de schedulerreplay met een actief Flow-SoC-doel daalt het aantal werkelijk uitgevoerde scans van 1.824 naar 300, bij 1.824 aanvragen; 1.524 aanvragen zijn cachetreffers. Tijdzoneconversies dalen van 2.075.406 naar 341.395. Volledige EV-/batterijpublicatietraces en sessiesnapshots zijn voor en na identiek.

**De replayklok staat tijdens één event stil. Die aanname versterkt de cachewinst.** Een controle met een voortlopende echte klok toont bij 100 zoekopdrachten met telkens een nieuwe Date 100 verschillende resultaten en geen vermeden scans. Mediaan CPU: 430,171 ms vóór en 489,765 ms na. Bij 100 aanvragen met hetzelfde vastgelegde tijdstip daalt de mediaan van 446,611 naar 22,559 ms; conversies 107.600 naar 1.076. Dit zijn drie losse processen per variant, met instrumentatie en koude Intl/JIT-kosten; geen nauwkeurige schatting van de kleine miss-overhead.

Daarom is deze wijziging een begrensde optimalisatie van identieke zoekopdrachten, **geen aangetoonde algemene oplossing voor de Homey-CPU-belasting of crashes**. Vooral getEvInstanceSettings leest zelf opnieuw Date.now(): opeenvolgende dure scans kunnen daardoor telkens verschillende tijdstippen gebruiken. De productiecode is hier bewust niet uitgebreid met het delen/afronden van kloktijdstippen. De gesimuleerde procentuele winst mag niet als verwachte Homey-winst worden gepresenteerd.

## Oorzaak en alle aanroeppaden

De oorspronkelijke findNextLocalTime zoekt maximaal 1.560 absolute minuten vooruit. Iedere kandidaat vraagt localParts met tijdzoneconversie. De kandidaat houdt de oorspronkelijke seconden en milliseconden. Een gevonden lokale minuut geeft dus geen afgeronde datum terug.

| Plaats | Aanleiding | Behouden bijwerking |
| --- | --- | --- |
| lib/flexible-loads.js, calculateEvDecision | Doeltijd bepalen als geen toekomstige expliciete kWh-/SoC-deadline beschikbaar is | Bestaande beslissingen en waarschuwingen |
| app.js:3374, getEvInstanceSettings | Actief kWh-plan met verstreken/ontbrekende deadline | deadlineAt vernieuwen |
| app.js:3404, getEvInstanceSettings | Actief Flow-SoC-plan | deadlineAt bij iedere opbouw berekenen/toewijzen |
| app.js:3592, boiler reset | Volgend lokaal resetmoment bepalen | Bestaande boilercyclus |
| app.js:8592, tickEvEnergyPlan | Energieplan/deadline doorschuiven | Bestaande kWh-administratie |
| app.js:8620, setEvEnergyPlan | Nieuwe Flow-energiedoelstelling | Bestaande sessie-/planningswijzigingen |
| app.js:8655, setEvSocPlan | Nieuwe Flow-SoC-doelstelling | Bestaande sessie-/planningswijzigingen |

De cache zit centraal rond de pure zoekfunctie en verandert geen van deze aanroepers. Ook de boiler krijgt alleen hergebruik als de complete zoeksleutel identiek is.

## Implementatie

- Module-lokale LRU met hoogstens 32 sleutels en numerieke resultaat-timestamps. Geen timers, polling, settings of plannen in de cache.
- Sleutel: exact getTime(), geparste lokale minuut, primitieve tijdzonestring. Equivalent geschreven geldige tijden zoals 7:00 en 07:00 mogen hetzelfde resultaat gebruiken; parsing gebeurt nog bij iedere aanvraag.
- Geen afronding op minuten, geen permanent gemaakte deadlineAt en geen hergebruik over een gewijzigd tijdstip heen.
- Een hit vernieuwt de LRU-positie; de oudste entry wordt bij overschrijding verwijderd.
- Miss: oorspronkelijke scan ongewijzigd uitvoeren en alleen een succesvol resultaat onthouden. De oorspronkelijke 24-uursfallback na 26 uur zoeken wordt eveneens exact behouden.
- Ongeldige lokale tijden volgen onmiddellijk de bestaande fallback. Ongeldige datums en niet-primitieve tijdzones volgen de oorspronkelijke zoek-/foutafhandeling zonder cache. Exceptions worden niet gecachet.
- Elke return levert een nieuw Date-object. Wijziging door een aanroeper vervuilt latere resultaten niet.

Het aantal entries is hard begrensd. Exact heapgebruik is runtimeafhankelijk: maximaal 32 sleutels en 32 numerieke waarden plus Map-overhead, niet een groeiende tijdreeks. Geen extra productieprofiler of diagnostische timer toegevoegd.

## Voor/na-metingen

300 virtuele seconden per run, P1 iedere seconde en EV-feedback 10 A iedere 10 seconden. Drie afzonderlijke Node-processen per versie/scenario/diagnostiekstand, volgorde vóór/na afgewisseld. Echte proces-CPU; Homey-I/O en tijd gesimuleerd. De no-argument Date-constructor is eveneens aan de virtuele klok gekoppeld, zodat deadlines en publicatietiming rechtstreeks vergelijkbaar zijn. Metingen omvatten dezelfde lichte functie-instrumentatie aan beide kanten.

| Scenario | CPU-/planningsdiagnostiek | Mediaan proces-CPU vóór (ms) | Na (ms) | Vermindering |
| --- | --- | ---: | ---: | ---: |
| flow | aan | 8156.647 | 1792.306 | 78.0% |
| flow | uit | 8118.230 | 1560.030 | 80.8% |
| plain | aan | 271.203 | 231.974 | 14.5% |
| plain | uit | 262.442 | 220.809 | 15.9% |

Flow met diagnostiek aan: mediaan CPU in de zoekfunctie 7.815,197 → 1.488,780 ms. De 1.824 aanvragen komen in dit scenario uit getEvInstanceSettings; calculateEvDecision gebruikt de expliciete Flow-deadline en heeft hier geen extra scan nodig.

Zonder Flow-doel: 15 zoekaanvragen, 15 → 5 scans, 10 hits; hier komt de zoektocht uit calculateEvDecision. Het aantal aanvragen verandert niet, alleen het kalenderwerk. De ruwe JSON bevat CPU-ranges, conversies, bronverdeling en alle traces. Geneste functie-CPU niet bij de totale proces-CPU optellen.

## Validatie

De nieuwe cachetest vergelijkt tegen het oorspronkelijke algoritme en faalt op de oorspronkelijke code: identieke aanvragen voeren daar nog tijdzoneconversies uit. Na de wijziging slagen 238 controles:

- Exact dezelfde datum en herhaalde aanvragen.
- Andere seconden/milliseconden in dezelfde minuut.
- Voor, op en na de doelminuut; middernacht en volgende dag.
- UTC, Brussel, New York, Kathmandu en Lord Howe.
- Zomer-/wintertijd, waaronder ontbrekende en dubbele lokale tijden in Brussel.
- Wijziging van doeltijd/tijdzone, ongeldige tijden/datums/tijdzones en bestaande foutmeldingen.
- Een gewijzigd retour-Date-object; bounded eviction en correct opnieuw berekenen.

De integratiereplays gebruiken de echte scheduler, Flow-kaarten en publicatieroutes uit de broncode. Alleen Homey-I/O en klok zijn nagebootst. Zij vergelijken vóór/na iedere batterijpublicatie, EV-stroom-, modus- en toestemmingspublicatie met tijdstip, plus sessiesnapshots. Scenario's: actief Flow-doel, nieuw/gewist doel, kWh-plan, handmatige stop, SoC-stop, SoC-doorladen plus latere stop, ontkoppelen/heraansluiten, PV-overgangen, Peak Guard, meerdere EV's met verschillende doelen, current/mode/hybrid en 7/55 seconden. Niet ieder scenario is met iedere combinatie gekruist; de matrix staat in de meegeleverde meetgegevens.

De volledige projectcontrole is geslaagd: syntaxcontroles en 63 testsuites. Ook alle tien aanvullende vóór/na-integratieparen geven identieke publicatietraces en sessiesnapshots. De bestaande tests dekken daarnaast batterij-/EV-restbelasting, asynchrone en verlopen feedback, batterijloze/uitgeschakelde EMS, PV-eerst, plan-SoC/PV-grenzen en split-herhaling. Gepubliceerde opdrachten in deze tests zijn geen gemeten fysieke laadreacties.

## Afbakening en fysiek vervolg

app.js, de batterij-engine, instellingen, Flow-definities en actieve versies zijn bytegelijk aan de oorspronkelijke 1.1.12. De codewijziging zit uitsluitend in lib/flexible-loads.js. Toegevoegd zijn gerichte tests/meetrunner, documentatie en aanvullende NL/EN-changelogtekst. Vorige changelogvermeldingen blijven behouden.

Geen EV-beslissingen, portfolio's, vermogensboekhouding of toestemmingen gecachet. Geen wijziging P1-cadans, AutoTune, regel-/commando-intervallen, deadlinebeleid, tariefrechten of bestaande feedbackfiltering. Niet gepusht of gepubliceerd.

Op een fysieke Homey moet worden vastgesteld hoe vaak exacte timestamps werkelijk herhaald worden en wat de invloed is op langdurige proces-CPU, geheugen en cpuwarn. Vergelijk dezelfde installatie/configuratie, actieve doelen en diagnostiekcondities. Bevestig normale start/stop, SoC-voltooiing en batterijgedrag.

Als daadwerkelijke klokmetingen onvoldoende cachetreffers tonen, is een afzonderlijk onderbouwde vervolgstap nodig: één expliciet, consistent tijdstip binnen een evaluatiesnapshot gebruiken. Dat is hier niet uitgevoerd. Zonder die bevestiging deze wijziging niet aanprijzen als oplossing voor de gemelde CPU-crashes.
