# HomeFlux EMS

**Your energy, managed differently**  
**Jouw energie, anders geregeld**

## English

HomeFlux EMS is a Homey-based energy management system built to coordinate batteries, solar production and flexible loads around **the energy contract you actually have**. It is not limited to dynamic pricing: HomeFlux is specifically designed to work just as well with **fixed contracts that use two or more time-of-use tariff periods**, including peak/off-peak and multi-rate schedules.

HomeFlux decides when stored energy should be used, preserved or charged, when solar energy is best consumed locally, and when flexible loads such as EV charging, heating, cooling or hot water can run. It combines tariff periods, PV forecasts, battery reserve, self-consumption, grid limits and user priorities in one control strategy.

Instead of locking the EMS to one battery, inverter or charger brand, HomeFlux uses explicit Homey Flow cards as the integration layer. That keeps the energy strategy independent from the hardware underneath it and makes it possible to combine supported Homey integrations with custom local controllers.

**Peak Guard remains a hard safety layer**, while planning and tariff logic decide how the available energy is used. The goal is straightforward: increase useful self-consumption, buy energy at the right moments, protect the reserve you need later and avoid unnecessary grid peaks.

### EMS device and widgets

Add the **HomeFlux EMS device** in Homey for quick operational changes without building an extra Flow and for an at-a-glance view of the active override, **who currently owns battery control (HomeFlux or an external EMS)**, EV status and EV planning. HomeFlux also includes an **EMS status widget** for live strategy/planning information and a **Savings widget** for cost and savings visualization.

For EV planning, the existing SoC-by-time and kWh-by-time Flow cards can provide a persistent **minimum target**. A guaranteed target may use any tariff when that is required to secure the deadline; a non-guaranteed target keeps trying on favourable PV/tariff moments. If no Flow target has been supplied, HomeFlux clearly falls back to the EV target and time configured in settings.

### Autotune and Savings

Autotune can observe the control signals HomeFlux already receives and recommend safe, non-critical tuning changes without adding extra polling. Automatic management is explicit opt-in: the global confidence threshold defaults to **95%**, and every managed parameter can have its own confidence threshold plus an allowed minimum/maximum range. When permission is first granted, that range defaults to 50% below and 50% above the current value.

Savings includes direct PV use, PV energy later used from the battery, load shifting and **PV export/feed-in**. Fixed and multi-rate contracts can define a feed-in price per tariff. For dynamic export prices, a Flow card can provide the current export price. The sign convention is intentionally simple: **positive = compensation received; negative = a cost to inject**. A separate Flow input can provide the cumulative exported energy for today to calibrate the calculated export total against the real meter.

## Nederlands

HomeFlux EMS is een Homey-gebaseerd energiebeheersysteem dat batterijen, zonnepanelen en flexibele verbruikers aanstuurt rond **het energiecontract dat je werkelijk gebruikt**. Het is dus niet alleen bedoeld voor dynamische prijzen: HomeFlux is juist ontworpen om ook volwaardig te werken met **vaste contracten met twee of meer uurtarieven**, zoals piek/dal of andere meervoudige tariefperiodes.

HomeFlux beslist wanneer opgeslagen energie gebruikt, bewaard of geladen wordt, wanneer zonne-energie het best lokaal wordt benut en wanneer flexibele verbruikers zoals EV-laden, verwarming, koeling of warm water kunnen draaien. Tariefperiodes, PV-voorspelling, batterijreserve, zelfconsumptie, netlimieten en gebruikersprioriteiten komen samen in één regelstrategie.

In plaats van het EMS vast te koppelen aan één merk batterij, omvormer of laadpaal gebruikt HomeFlux expliciete Homey Flow-kaarten als integratielaag. Daardoor blijft de energiestrategie onafhankelijk van de onderliggende hardware en kunnen ondersteunde Homey-integraties gecombineerd worden met eigen lokale controllers.

**Peak Guard blijft een harde veiligheidslaag**, terwijl planning en tarieflogica bepalen hoe de beschikbare energie wordt ingezet. Het doel is duidelijk: meer nuttig zelfverbruik, energie op de juiste momenten inkopen, de nodige reserve voor later beschermen en onnodige netpieken vermijden.

### EMS-apparaat en widgets

Voeg het **HomeFlux EMS-apparaat** toe in Homey voor snelle operationele aanpassingen zonder extra Flow en voor een overzicht van de actieve override, **wie de batterijregeling in handen heeft (HomeFlux of een externe EMS)**, EV-status en EV-planning. HomeFlux bevat daarnaast een **EMS-statuswidget** voor live strategie/planning en een **Winst-widget** voor kost- en besparingsvisualisatie.

Voor EV-planning kunnen de bestaande Flow-kaarten voor SoC-tegen-tijd en kWh-tegen-tijd een blijvend **minimumdoel** instellen. Een gegarandeerd doel mag elk tarief gebruiken wanneer dat nodig is om de deadline te verzekeren; een niet-gegarandeerd doel blijft proberen op gunstige PV-/tariefmomenten. Is geen Flow-doel ingestuurd, dan valt HomeFlux zichtbaar terug op het EV-doel en tijdstip uit de instellingen.

### Autotune en Winst

Autotune kan de regelsignalen observeren die HomeFlux toch al ontvangt en veilige, niet-kritische afstellingen aanbevelen zonder extra polling. Automatisch beheer blijft expliciet opt-in: de globale vertrouwensdrempel staat standaard op **95%**, en elke beheerde parameter kan een eigen vertrouwensdrempel en toegestane minimum-/maximumwaarde krijgen. Bij de eerste toestemming staat die band standaard op 50% onder en 50% boven de huidige waarde.

Winst neemt rechtstreeks PV-gebruik, PV uit de batterij, laadverschuiving en **PV-export/injectie** mee. Bij vaste en meervoudige tarieven kan per tarief een injectieprijs worden ingesteld. Voor dynamische exportprijzen kan een Flow-kaart de actuele exportprijs aanleveren. De tekenconventie is bewust eenvoudig: **positief = vergoeding die je ontvangt; negatief = kost om te injecteren**. Een aparte Flow-input kan de cumulatieve geëxporteerde energie van vandaag aanleveren om de berekende export te kalibreren met de echte meterstand.

## Homey API permission

HomeFlux EMS requests `homey:manager:api` only to access Homey's own Energy information for dynamic electricity contracts. The app creates a local Homey API client to read the configured electricity price type/zone and to fetch Homey Energy dynamic electricity prices. Battery, PV, EV and HVAC integrations are not discovered or controlled through this permission; those integrations use explicit Homey Flow cards. HomeFlux EMS does not require an external HomeFlux cloud service for this functionality.
