# HomeFlux EMS

**Your energy, managed differently**

HomeFlux EMS manages home batteries around your tariff, PV forecast, self-consumption and grid limits. Connect your hardware through Homey Flow cards. EV charging, HVAC and boiler control are optional.

1. Configure battery capacity, power limits, energy contract and Peak Guard in Settings.
2. Supply grid power, PV power, battery SoC and PV forecasts through Flow. Select and connect your price sources for dynamic contracts.
3. Connect the battery output Flows, complete the charge test and enable EMS output.

Use the ⓘ icons in Settings for explanations. Existing and deprecated Flow cards remain supported.

[Configuration and Flow cards](https://github.com/DavyBert/HomeFlux-EMS/discussions/3)

## Release notes — 1.3.3

**NL** — Minder herhaalde verwerking van dynamische prijscurves door hergebruik van bestaande plannerresultaten voor status, EMS-apparaatupdates en EV-planning. Het actuele prijssegment en de bronvaliditeit worden licht gecontroleerd zonder de dagrangschikking en prijsnormalisatie opnieuw uit te voeren.

**EN** — Reduced repeated processing of dynamic price curves by reusing existing planner results for status, EMS device updates and EV planning. The current price segment and source validity are checked without repeating daily ranking and price normalization.

**FR** — Réduction des traitements répétés des courbes de prix dynamiques grâce à la réutilisation des résultats du planificateur pour le statut, les appareils EMS et la planification du VE. Le créneau actuel et la validité des sources sont vérifiés sans répéter le classement quotidien ni la normalisation des prix.

**DE** — Weniger wiederholte Verarbeitung dynamischer Preiskurven durch Wiederverwendung vorhandener Planungsergebnisse für Status, EMS-Geräte und EV-Planung. Das aktuelle Preisintervall und die Gültigkeit der Quellen werden ohne erneute Tagesrangfolge und Preisnormalisierung geprüft.

**ES** — Menos procesamiento repetido de curvas de precios dinámicos al reutilizar los resultados del planificador para el estado, los dispositivos EMS y la planificación del VE. El intervalo actual y la validez de las fuentes se comprueban sin repetir la clasificación diaria ni la normalización de precios.

