# HomeFlux EMS 1.2.16 – gerichte verificatie

Uitgangspunt: laatst beschikbare volledige HomeFlux EMS 1.2.15. Er is niets op Homey geïnstalleerd of gepubliceerd.

## Wijzigingen

- Zo laat mogelijk laden behoudt de eindtijd op 15 minuten vóór het einde van het beschikbare laadvenster. Een kleiner restant of hoger beschikbaar vermogen verschuift de start, ook wanneer een ouder laadblok al liep. Dit kan lopend netladen tijdelijk pauzeren tot de nieuwe start. Bij een laadvenster tot 17:00 blijft de eindtijd 16:45. Bij onvoldoende capaciteit blijft de bestaande expliciete terugval met waarschuwing behouden; de reserve kan dan onhaalbaar zijn.
- De planningweergave gebruikt dezelfde geplande eindgrens, ook bij verschillende batterij-SoC’s en afnemend beschikbaar batterijlaadvermogen. Exacte grenzen worden door de bestaande gedeelde contexttimer afgehandeld. Geen extra timer, heartbeatplanning of fast-loopplanning.
- Per HVAC staat ‘Actie bij automatische sturing uit’: Uit of Stand-bytemperatuur. Een expliciete Nee-Flow stuurt eenmaal alleen de gekozen uitgang. Stand-by verandert alleen het setpoint en schakelt het toestel niet aan of uit. Een opgegeven Flow-temperatuur vervangt de opgeslagen waarde. Zonder geldige temperatuur wordt een stand-byopdracht geweigerd vóór automatische sturing uitgaat. Uit is de terugvalkeuze voor bestaande instellingen.
- Uitgangstoelatingen blijven gelden. Nieuwe automatische sturing via Ja hervat de bestaande veilige regeling. Expliciete opdrachten worden per HVAC op basis van publicatievoltooiing afgehandeld; gewone contextupdates kunnen ze niet overschrijven. Een volgende expliciete Nee stuurt opnieuw één commando, ook bij dezelfde gecachte waarde. Er is geen polling, timer, periodieke herhaling of automatische retry voor deze stopactie.
- De wachttekst bij Batterij sparen is ‘Batterij reserve behouden, laden later gepland.’

## Controle

25 gerichte suites geslaagd, inclusief 11 nieuwe scenariogroepen. De volledige lijst staat in `targeted-tests-1.2.16.json`.

- Syntax van alle gewijzigde JavaScript, JSON en beide gewijzigde inline scripts gecontroleerd.
- Echte app-, planner- en enginefuncties getest met virtuele tijd en nagebootst Homey-transport. Vast tarief, multitarief, uur- en kwartierprijzen; actief en toekomstig herplannen, gewijzigde deadlines, prijsdatagaten, onvoldoende capaciteit, doel bereikt, ongelijke batterij-SoC’s en beide Brusselse zomertijdwissels.
- De bestaande contexttimer activeert het exacte laadvenster; fast-loop en heartbeat bouwen geen laadstrategie. Bestaande Peak Guard-, planningslimiet-, batterij-isolatie-, Split-loop- en coalescingtests slagen.
- Uit/stand-by getest op alle tien HVAC-kanalen, herhaalde en overlappende Flow-aanroepen, bezette publicatie, tussentijdse gewone context, ontbrekende toestemming/temperatuur, oude wachtende beslissingen en herstart. Gewone contextuitvoeringen sturen de stopactie niet opnieuw en voegen hiervoor geen timers toe.
- Bestaande HVAC-regressies voor directe/parallelle tarief- en PV-sturing, vijf onafhankelijke warmtepompen, één gedeelde bron met vier thermostaten, leren, COP, veiligheidsgrenzen, budget, UI en migratie slagen. Instellingen worden correct opgeslagen en herladen.
- Flow-compatibiliteit, titels inclusief de optionele temperatuur, manifestsamenstelling, vertalingen, widget/Logic-beslissingen en uitgangstests slagen.
- Slogan, Athom-teksten en alle 155 deprecated Flow-kaarten zijn met 1.2.15 vergeleken en behouden. Geen bestaand bronbestand of test verwijderd.

## Overgeslagen en grenzen

De volledige regressiesuite en onafhankelijke suites voor Savings, Autotune, prijsimport en EV-planning zijn niet uitgevoerd. Hun interne gedrag is daardoor niet opnieuw geverifieerd; relevante gedeelde aansturing en flexibele-belastingtests zijn wel uitgevoerd. Geslaagde tests zijn alleen herhaald na een relevante code- of testwijziging.

Homey CLI-debugvalidatie en fysieke Homey-tests zijn niet uitgevoerd; de CLI is hier niet beschikbaar. Werkelijke apparaatreacties, Flow-doorlooptijd, CPU en geheugen op Homey blijven ter plaatse te controleren. Er wordt geen Homey-besparingspercentage geclaimd. Er zijn geen extra HVAC-achtergrondtaken toegevoegd.
