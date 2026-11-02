# HomeFlux EMS 1.1.10 — split-modeherhaling in seconden

Basis: de bijgewerkte 1.1.9 met de SoC-keuze en EV/batterijcorrecties. De eerdere EV-, PV-, batterij- en CPU-correcties zijn behouden. Er is niets gepusht of gepubliceerd.

Bij alle acht batterijen gebruikt de periodieke safety-herhaling van de actieve split-modus nu seconden:

- Minimum: 1 seconde, in gehele seconden instelbaar.
- Standaard: 600 seconden, gelijk aan de eerdere 10 minuten.
- Maximum: 86.400 seconden, gelijk aan de eerdere 1.440 minuten.
- De functie blijft standaard uitgeschakeld.

De labels, helptekst, opslag en Engelse vertaling zijn aangepast. De actieve instelling heet `splitCommandBattery{1..8}SafetyModeResendSeconds`.

## Eenmalige upgrade

Settingsschema 71 zet de oude waarde `SafetyModeResendMinutes` om naar `SafetyModeResendSeconds`. Voorbeelden: 1 minuut wordt 60 seconden; 5 minuten wordt 300 seconden; 10 minuten wordt 600 seconden. Een ontbrekende of niet-numerieke oude waarde krijgt de bestaande standaard van 10 minuten, nu 600 seconden. De oude minimale effectieve waarde van 1 minuut blijft bij nul/negatieve oude waarden behouden als 60 seconden.

Een reeds aanwezige geldige secondenwaarde wordt behouden, ook bij een gedeeltelijk uitgevoerde upgrade. Herhaald migreren of opnieuw starten vermenigvuldigt de waarde niet nogmaals. De oude minutensleutel blijft opgeslagen maar wordt na migratie niet gebruikt voor de regeling of instellingenpagina.

## Werking

De bestaande timer gebruikt het secondeninterval maal 1.000. Er wordt alleen de op dat moment actieve laad- of ontlaadmodus opnieuw gestuurd. De herhaling stuurt geen vermogenswaarde, wisselt de modus niet en reset geen anti-wisseltijden of richtingbevestiging. Wijzigen van het interval vervangt de bestaande timer; uitschakelen verwijdert deze.

De bestaande voorwaarden blijven gelden: split control en de optie moeten actief zijn; EMS-uitvoer en de laadtest moeten geldig zijn. Batterijpauze of overdracht aan een externe EMS onderdrukt de herhaling. Zoals voordien wordt pas na afhandeling van de vorige herhaling een volgende timer gepland; trage Flow-uitvoering kan het werkelijke interval verlengen.

## Validatie

`test/split-resend-seconds-1.1.10.test.js` controleert de echte startupmigratie, alle acht batterijen, herstart, gedeeltelijke migratie, standaard-/grenswaarden, UI-opslag en NL/EN-labels. De timertests controleren 1 seconde, periodiek herplannen, de actuele modus bij afvuren, intervalwijziging, uitschakelen, ongewijzigde anti-wisseltijden en onderdrukking door de bestaande uitvoervoorwaarden. Homey-I/O en tijd worden hierbij gesimuleerd.

De bestaande regressietests blijven deel uitmaken van `npm run check`. Op een fysieke Homey moet bij gebruik nog worden bevestigd dat de aangesloten omvormer en Flows de gekozen herhalingsfrequentie verwerken.

De volledige eindcontrole is geslaagd: `npm run check` (exit 0), inclusief syntaxcontrole en 60 testsuites. De bestaande 55 SoC- en 33 EV/batterijovergangsscenario's slagen eveneens. De EV-regeling, AutoTune en batterijberekeningen zijn ongewijzigd; in de batterij-engine is alleen de standaardinstelling van minuten naar seconden omgezet. De meegeleverde patch is getest op de bijgewerkte 1.1.9-broncode en reconstrueert de 1.1.10-broncode exact.
