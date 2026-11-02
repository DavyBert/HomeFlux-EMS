# HomeFlux EMS 1.2.10

De bestaande optimalisatie voor bewezen nuluitvoer is uitgebreid naar geblokkeerd ontladen in **Zelfconsumptie**, **Netimport vermijden** en **Batterij sparen**. Dezelfde veilige uitkomst hoeft niet bij iedere P1-meting opnieuw door de vermogensverdeler te worden berekend.

- De nuluitvoer-cache kan ook bij een expliciet gekozen modus en gemelde PV-productie worden gebruikt. De actuele P1 en het bestaande gemiddelde worden eerst gecontroleerd; nieuwe export gaat onmiddellijk terug naar de gewone regelaar.
- Geconfigureerde EV's die expliciet losgekoppeld zijn en geen stroom, actieve uitgang of nog niet door P1 bevestigde loskoppeling hebben, blokkeren deze optimalisatie niet meer. Aangesloten/onbekende EV's en resterende fysieke laadregistratie houden hun bestaande rekenroute.
- Boekhoudklokken van de boiler maken de batterijcache niet meer onnodig ongeldig. Een uitgeschakelde boiler zonder actieve uitgang of Peak Guard-aanvraag levert geen irrelevante statusafhankelijkheid meer op. Werkelijke uitgangs-/ondersteuningswijzigingen blijven de cache verbreken.
- Bij blijvende hoge netimport mag een bewezen nulvector worden hergebruikt wanneer **alle batterijen op of onder hun harde minimum-SoC staan**. Een nieuwe piek wordt eerst volledig beoordeeld. Nieuwe SoC-feedback, gewijzigde grens of het verdwijnen van de piek verbreekt het bewijs direct.
- **Stand-by houdt de berekende batterijopdracht op 0 W**, zowel bij PV-export als bij een netpiek. Batterijondersteuning voor Peak Guard is in deze modus uitgeschakeld. De zelfstandige veiligheidsbegrenzing van EV's wordt hierdoor niet verwijderd.

Geen nieuwe instellingen of Flow-kaarten zijn nodig. Het bestaande memo en de bestaande klok-/contextgrenzen worden hergebruikt; er zijn geen extra timers, pollinglussen of onbeperkte caches. Split Command, Hybrid-eigendom, uitstaande opdrachten, verouderde invoer en andere niet bewezen situaties volgen de bestaande controlepaden. Normale batterijplanning en opdrachtintervallen blijven van toepassing.

Volledige gebruikersdocumentatie: https://github.com/DavyBert/HomeFlux-EMS/discussions/3

Bij Split Command blijven het ingestelde hardwareminimum en de bestaande richtingstimers gelden; de optimalisatie omzeilt deze uitvoerinstellingen niet. De nuluitvoerproef gebruikt de gewone vermogensuitvoer zonder zo’n minimum.
