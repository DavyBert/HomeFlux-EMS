# HomeFlux EMS 1.2.14 — consistente widgetweergave

Uitgangspunt is de laatst opgeslagen 1.2.13 met EV4-correctie en groene Laadstrategie-hovertekst. Versie, opstartlogging en loopdetectie zijn 1.2.14.

Bij uitgesteld netladen met 0 W toont de widget Batterij sparen. De reden verklaart dat netladen nu niet wordt gevraagd. PV laden en echte Peak Guard-acties krijgen hun eigen reden, boven een beschrijving van een toekomstig laadvenster. Beschikbare planningsdoelen en vensters blijven zichtbaar.

Ontbrekende invoer, veilige stop, uitgeschakelde/gepauzeerde batterij-uitvoer, externe besturing, wachtende uitsturing en Peak Guard zonder beschikbaar vermogen hebben consistente beslissingen/redenen. Tijdens een pauze blijft de laatst uitgestuurde waarde zichtbaar. Een noodzakelijk Safety-SoC-herstel wordt niet als reeds actief laden omschreven.

EV-details vervangen een expliciete uitgestuurde 0 A of geweigerde toestemming niet meer door de toekomstige gewenste waarde. Terugregelen door Peak Guard is onderscheiden van uitschakelen. Mode blijft zijn P1-vermogensobservatie gebruiken. Een expliciete uitgeschakelde boiler gaat boven een verouderde running-vlag.

13 gerichte testbestanden en syntaxcontroles geslaagd. De nieuwe test controleert 32 beslissing/reden-combinaties in NL/EN, de server- en widgetfallback, de werkelijke widget-DOM voor nulwaarden, PV/net/Peak Guard, pauze/uitgeschakeld/ontbrekende input, een echte nachtplanning overeenkomstig de gemelde situatie en statuslezingen zonder extra regel-/planningsberekeningen of timers. Zie tests.json voor de exacte lijst. De oude tags-testfixture is consistent gemaakt met zijn eigen gereedheids-/uitvoerstatus en verandert nu de daadwerkelijk getoonde reden; zijn bestaande assertions blijven behouden.

De controller-, planner-, EV/HVAC/boiler-enginebestanden en Flow-definities zijn byte-identiek aan 1.2.13. App.js wijzigt uitsluitend de leesbare statusprojectie en de volgorde waarin pauzegegevens daarvoor beschikbaar komen. Geen nieuwe polling of timers.

De volledige suite en onafhankelijke regel-, presentatie- en exporttests zijn niet herhaald. Geen fysieke Homey-/apparaat- of browserrendercontrole. Er is niets geïnstalleerd of gepubliceerd. Oudere CPU-metingen in deze bron blijven historische 1.2.13-metingen.
