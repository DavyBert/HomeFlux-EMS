# HomeFlux EMS 1.2.8

Basis: de laatst opgeleverde volledige 1.2.7, inclusief de COP-/setpointcorrectie.

## Aanleiding en wijziging

De Homey-crashmelding noemt Memory Warning Limit Reached. De migratie was afgerond vóór de initialisatiemelding; het probleem is niet bewezen veroorzaakt door het lezen van ontbrekende instellingen. De bestaande initialisatiebarrière blijft daarom intact: eerst migratie en defaults, daarna cache, herstel, Flow-registratie en de eerste batterijcontext.

De uitbreiding naar tien HVAC-kanalen vergrootte de algemene instellingenbundel tot circa duizend velden. De batterij-engine voegde die volledige bundel herhaaldelijk samen met de invoer, ook voor niet-geconfigureerde HVAC-kanalen. Een lokale allocatieprofielmeting wees deze objectconstructies aan als belangrijke bron van tijdelijke geheugenbelasting.

De batterij-engine gebruikt nu een afzonderlijke standaardbundel zonder HVAC-velden. Alleen niet-HVAC-instellingen worden in batterijplanning, regelcontext en de actuele evaluatie overgenomen. HVAC-waarden worden daarbij niet gelezen, ook niet wanneer zij als getters zijn aangeboden. Alle overige eigen invoervelden, ook runtime-planningsvelden, blijven beschikbaar; gedeeltelijke instellingen krijgen dezelfde batterijdefaults.

De volledige oorspronkelijke DEFAULTS blijven beschikbaar voor de app, migratie, instellingenpagina en HVAC-regeling. Opgeslagen instellingen worden niet verwijderd of hernoemd. De bestaande gespreide initialisatie van HVAC 5–10, COP, periodiek opwarmen, trage contextcadans, Flow-kaarten, veiligheidsvoorwaarden en regeltimers blijven behouden. Er is geen extra timer, achtergrondtaak of logging toegevoegd.

## Betekenis van de meting

De optimalisatie vermindert aantoonbaar de betreffende allocaties in de lokale simulatie. Het is geen garantie dat iedere Memory Warning Limit Reached op een fysieke Homey hiermee verdwijnt. De SDK, gebruikersdata, echte apparaten en Homey-geheugenbewaking zijn niet volledig door de testharness gemodelleerd.
