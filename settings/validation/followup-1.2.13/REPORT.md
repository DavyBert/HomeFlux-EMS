# HomeFlux EMS 1.2.13 — EV4-netbudget en testopruiming

Versie blijft 1.2.13. De eerder geleverde timer- en boileroptimalisatie blijft behouden.

Vers gemeten Current/Hybrid-verbruik blijft in de fysieke batterij-netbescherming opgenomen wanneer de gedeelde EV-regeling tijdelijk 0 A vraagt. Dit corrigeert de ontbrekende EV4-bijdrage in het vier-EV-scenario. Een budgetreservering geeft geen laadtoestemming of nieuw laadcommando. Stale/ontbrekende feedback, sessiestop, tarieftoestemming en de fysieke vermogensgrenzen blijven gelden. Mode blijft uitsluitend zijn P1-observatie gebruiken.

De drie oude falende suites zijn op verzoek uit npm test/check gehaald en als .disabled bewaard. De actuele EV-netbudgettest behoudt de bruikbare attributie- en 14 schedulerscenario’s uit de oude batterijbeschermingstest. Hij accepteert 0 A alleen voor de uitdrukkelijk geblokkeerde gespreide start en controleert nog steeds het totale EV-netbudget en batterijvermogen. Daarnaast controleert hij EV4-feedback, nulverbruik, veroudering, tariefblokkering, nulbudget, disconnect en sessiestop. De ongewijzigde 1.2.12 faalt op de strikte fysieke vier-EV-beschermingsassertie; de correctie slaagt.

Laadstrategie toont groene hovertekst voor de keuze- en correctielabels en de knop naar de maandselectie. CSS-regels en inline JavaScript zijn statisch gecontroleerd. Een browser-/Homey-rendercontrole is niet uitgevoerd.

16 gerichte testbestanden geslaagd, plus syntax-/statische controles. Uitvoer en uitgevoerde bestanden staan in followup-tests.json en followup-ev-budget.log. Onafhankelijke batterijplanning-, HVAC/boiler-, presentatie-/dashboard- en exporttests en de volledige suite zijn niet herhaald. Er is niets op een Homey geïnstalleerd of gepubliceerd.

De eerdere CPU-metingen in validation/cpu-1.2.13 beschrijven de build vóór deze EV4-correctie. Hun gemeten bron blijft reproduceerbaar via de daarin bewaarde patches; EV4-accounting.patch beschrijft de aanvullende productieaanpassing. Er worden geen nieuwe CPU-besparingen voor deze aanvulling geclaimd.
