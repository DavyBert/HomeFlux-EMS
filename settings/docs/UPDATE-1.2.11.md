# HomeFlux EMS 1.2.11

**Ingeschakelde Peak Guard kan de batterijsturing in elke modus overnemen, ook in Stand-by.** De uitzondering op Peak Guard uit 1.2.10 is verwijderd.

Stand-by gebruikt normaal een berekende batterijopdracht van 0 W en vangt geen gewone PV-export op. Bij een netpiek mag Peak Guard ontladen binnen de beschikbare batterijcapaciteit en vermogenslimieten. Wanneer de ondersteuning niet meer nodig is, wordt de berekende Stand-by-opdracht weer 0 W. Harde minimum-SoC, apparaatlimieten, bestaande opdrachtintervallen en Split Command-uitvoerinstellingen blijven gelden.

De CPU-optimalisaties voor geblokkeerd ontladen in Zelfconsumptie, Netimport vermijden en Batterij sparen blijven aanwezig. EV-, HVAC- en boilerfuncties krijgen geen nieuwe regelroute of timer.
