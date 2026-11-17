# HomeFlux EMS 1.5.10

Uitgangspunt: de laatst opgeleverde 1.5.9-ZIP inclusief de correctie van de widgetprognose tijdens geforceerd laden (SHA256 1a44498d4457e9802df0885fc6ad0b0085200d4e48ee0f8471483fb596a4f50d).

Uitsluitend releasewijzigingen: applicatie- en packageversies 1.5.10, zichtbare widgetversies, cacheversies voor de bestaande widgetbestanden, releaseversie in de bestaande test en nieuwe release notes in NL/EN/FR/DE/ES. Die nieuwe notes beschrijven alleen de laatste prognosecorrectie; oudere versienotities blijven historische vermeldingen. Slogan, Athom-teksten en Flow-kaarten zijn behouden.

Validatie onder Node.js 22.23.5: alle JSON-bestanden geldig; manifesten en package-lock consistent; bestaande vertaal-/centrale-SOC-tests en app → API → widget-integratietests geslaagd. De werkelijke besturingscode is byte-identiek. De prognosecode is identiek aan de laatst geleverde correctie; alleen versieteksten zijn veranderd. Logging en loopdiagnose halen hun versie reeds uit het manifest, zodat hiervoor geen codewijziging nodig was. Geen nieuwe timers, polling of berekeningen. Geen fysieke Homey-installatie of volledige projecttestsuite uitgevoerd voor deze releasewijziging.
