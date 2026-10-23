# HomeFlux EMS 1.1.16 — EV-planning: audit en verificatie

## Startpunt en scope

Startpunt: laatst aangemaakte volledige **1.1.16 Planning Monitor**-pakket. Het versienummer, Flow-kaartschema, Athom-webtekst, batterijregeling, PV-prioriteit, algemene contextcadans en outputbeveiligingen blijven ongewijzigd.

## Onderzochte herhaling

De gemelde 39-secondenopname toont 46 `evSettingsBuild`, 15 `evSocDeadline`, twee `evDecision:context`, twee `evDecision:publication` en nul `evTariffScan`. Een bestaande aanpak die alleen EV-portfolioberekeningen telt, verklaart dus niet het instellingenwerk. In de geoptimaliseerde versie bouwden status, SoC-feedback en het geplande SoC-opvraagpad onnodig volledige EV-instellingen op.

## Aanpassingen

1. EV-status, planningstatus en periodieke SoC-aanvragen lezen de noodzakelijke configuratie direct. Bij status wordt geen toekomstige deadline of tariefscan uitgevoerd.
2. SoC-feedback controleert meetgeldigheid via alleen de ingestelde freshness-periode. De fysieke veiligheidscontrole blijft zelfstandig bestaan.
3. Een actieve SoC-Flow-deadline krijgt een per-EV/minuutmemo. De tijdzone-/kalenderopzoeking gebeurt maximaal eenmaal per minuut per doel/tijdzone; het oorspronkelijke millisecondenrestant wordt exact hersteld. De kalender wordt opnieuw geraadpleegd op de volgende minuut, bij een ander doel of andere tijdzone.
4. De tariefscan voor garantielading hergebruikt de **exact overlappende** tweede vijfminuten-suffix van de eerste scan, alleen binnen dezelfde synchrone beslissing en bij identieke deadline. Dit vermijdt één herhaalde volledige scan, maar deelt geen resultaten tussen EV's of na een asynchrone publicatie.
5. Relevante Flow-/SoC-/verbindings-/instellingenwijzigingen verhogen een per-EV revisie. De verwerking registreert de afgehandelde revisie zonder latere wijzigingen uit te wissen. Diagnostiek toont requests, handled en hergebruik apart van daadwerkelijk uitgevoerde plannerfuncties.
6. De Planning Monitor toont instellingenopbouwen expliciet vanuit context/publicatie/heartbeat waar een directe bron bekend is.

## Niet gewijzigd / resterend onderzoek

Het volledige EV-portfolio wordt **nog altijd** opnieuw doorgerekend in de publicatiefase wanneer de bestaande veiligheidsroute dat vereist. Alleen een per-EV revisie of boolean is niet voldoende om de actuele P1, fysieke restbelasting, Peak Guard, gedeeld budget en lopende batterijpublicaties correct te hervalideren. Er is geen permanente volledige laadbeslissingscache, geen nieuw pollinginterval en geen vervanging van het zelfstandige EV-pad. De revisies zijn momenteel registratie en invalidatiesignaal, **geen** algemene blokkade voor portfolio-evaluaties. Langetermijnplanning zonder dubbele context/publicatiescan blijft vervolgwerk als exacte pariteit bewezen kan worden.

## Metingen en tests

* Herhaalde voor/na-replay: **12 EV-scenario's**, elk **180 gesimuleerde seconden** per versie. Alle opgenomen EV- en batterij-uitvoer is gelijk, inclusief de outputtijdstippen.
* `getEvInstanceSettings()`-aanroepen: **6027 vóór**, **3507 na**, vermindering **2520 (41.8%)** in deze set. Het profiel 'disconnected' kreeg nul na-aanroepen; in de benchmarkuitvoer ontbreekt de teller dan en is die als nul geïnterpreteerd.
* De CPU-tijden in `comparison.json` zijn één afzonderlijke Node-hostrun per profiel; ze zijn alleen indicatief en niet bruikbaar als voorspelde Homey-CPU-percentages. Geneste timing van tariefscans niet optellen bij EV-beslissingstijd.
* Geslaagd: `ev-work-1.1.16`, `planning-monitor-1.1.16`, `ev-plan-1.1.15` (33 scenario's, 975 kalender/DST-cases), `ev-deadline-cache-1.1.12` (238), `ev-context-delay-1.1.13`, `ev-feedback-1.0.11`, `ev-battery-protection-1.1.6`, Input Monitor UI, `flexible-loads`, extra directe beslissingsequivalentie (32 combinaties) en deadline-memo (40 projecties).
* Enkele lange historische tests en de volledige gecombineerde suite zijn niet volledig afgerond binnen de uitvoeringslimiet; deze zijn **niet** als geslaagd gerapporteerd.

## Monitoring in productie

Start **Diagnostiek → Input Monitor & Loop Detection**, laat een actieve SoC- of kWh-planning draaien en exporteer de JSON. Vergelijk `evDecision`/`evTariffScan`/`evSettingsBuild`/`evSocDeadline` met `planningEvents`. Een event `unchanged_portfolio` betekent dat de huidige EV-revisie al afgehandeld was, **niet** dat er geen portefeuilleberekening plaatsvond. Gebruik de gemeten CPU-bereiktijd en walltime afzonderlijk. Die aantallen kunnen het resterende dubbel werk uit context en publicatie identificeren.
