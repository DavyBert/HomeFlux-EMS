# HomeFlux EMS

**Your energy, managed differently**  
**Jouw energie, anders geregeld**

## English

HomeFlux EMS is a Homey-based energy management system built to coordinate batteries, solar production and flexible loads around **the energy contract you actually have**. It is not limited to dynamic pricing: HomeFlux is specifically designed to work just as well with **fixed contracts that use two or more time-of-use tariff periods**, including peak/off-peak and multi-rate schedules.

HomeFlux decides when stored energy should be used, preserved or charged, when solar energy is best consumed locally, and when flexible loads such as EV charging, heating, cooling or hot water can run. It combines tariff periods, PV forecasts, battery reserve, self-consumption, grid limits and user priorities in one control strategy.

Instead of locking the EMS to one battery, inverter or charger brand, HomeFlux uses explicit Homey Flow cards as the integration layer. That keeps the energy strategy independent from the hardware underneath it and makes it possible to combine supported Homey integrations with custom local controllers.

**Peak Guard remains a hard safety layer**, while planning and tariff logic decide how the available energy is used. The goal is straightforward: increase useful self-consumption, buy energy at the right moments, protect the reserve you need later and avoid unnecessary grid peaks.

## Nederlands

HomeFlux EMS is een Homey-gebaseerd energiebeheersysteem dat batterijen, zonnepanelen en flexibele verbruikers aanstuurt rond **het energiecontract dat je werkelijk gebruikt**. Het is dus niet alleen bedoeld voor dynamische prijzen: HomeFlux is juist ontworpen om ook volwaardig te werken met **vaste contracten met twee of meer uurtarieven**, zoals piek/dal of andere meervoudige tariefperiodes.

HomeFlux beslist wanneer opgeslagen energie gebruikt, bewaard of geladen wordt, wanneer zonne-energie het best lokaal wordt benut en wanneer flexibele verbruikers zoals EV-laden, verwarming, koeling of warm water kunnen draaien. Tariefperiodes, PV-voorspelling, batterijreserve, zelfconsumptie, netlimieten en gebruikersprioriteiten komen samen in één regelstrategie.

In plaats van het EMS vast te koppelen aan één merk batterij, omvormer of laadpaal gebruikt HomeFlux expliciete Homey Flow-kaarten als integratielaag. Daardoor blijft de energiestrategie onafhankelijk van de onderliggende hardware en kunnen ondersteunde Homey-integraties gecombineerd worden met eigen lokale controllers.

**Peak Guard blijft een harde veiligheidslaag**, terwijl planning en tarieflogica bepalen hoe de beschikbare energie wordt ingezet. Het doel is duidelijk: meer nuttig zelfverbruik, energie op de juiste momenten inkopen, de nodige reserve voor later beschermen en onnodige netpieken vermijden.

## Homey API permission

HomeFlux EMS requests `homey:manager:api` only to access Homey's own Energy information for dynamic electricity contracts. The app creates a local Homey API client to read the configured electricity price type/zone and to fetch Homey Energy dynamic electricity prices. Battery, PV, EV and HVAC integrations are not discovered or controlled through this permission; those integrations use explicit Homey Flow cards. HomeFlux EMS does not require an external HomeFlux cloud service for this functionality.
