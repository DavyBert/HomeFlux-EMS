# HomeFlux EMS 0.7.12 - dynamische slotselecties

## Basis en versie

Gebouwd op de eerder geleverde `HomeFlux-EMS-v0.7.12.zip` uit dit gesprek. Het appversienummer blijft **0.7.12**. De nieuwe download heet `HomeFlux-EMS-v0.7.12-configured-slots.zip` om hem te onderscheiden van de eerste build met vaste dropdowns.

## Werking

Alle 31 slotselecties in nieuw aangeboden kaarten gebruiken dynamische autocomplete: 13 inputacties, 13 output-/opvraagtriggers en 5 voorwaarden. De opgeslagen aantallen bepalen de keuzes: maximaal 8 batterijen, 4 EV's en 4 HVAC's. Bij aantal 0 zijn er geen keuzes. De appbrede kaarten zelf blijven zichtbaar.

Bij 3 batterijen, 0 EV's en 1 HVAC verschijnen Batterij 1-3, geen EV-keuzes en alleen HVAC 1. Na het opslaan van gewijzigde aantallen of namen worden die bij de volgende selectieopvraag gebruikt, zonder nieuwe polling of herstart van HomeFlux. Sluit een al geopende keuzelijst en open hem opnieuw om een nieuwe opvraag te doen.

EV- en HVAC-keuzes tonen het vaste slotnummer en de ingestelde naam. Een opgeslagen keuze blijft aan hetzelfde nummer gekoppeld na een naamswijziging. Tijdelijk niet aangesloten zijn of automatische sturing uitzetten verbergt een geconfigureerd slot niet; anders zou een eerste meting of een Flow om de sturing in te schakelen niet kunnen worden ingesteld.

## Compatibiliteit

De 120 genummerde legacy-kaarten blijven behouden. Ook de 31 vaste-dropdownkaarten uit de eerste 0.7.12 worden nu als deprecated behouden, zonder hun oorspronkelijke ID, argumenten, waarden, tags of handlers te wijzigen. De nieuwe autocompletekaarten hebben aparte IDs met `_configured` als achtervoegsel. Bestaande Flows worden niet automatisch omgebouwd.

De zichtbare lijst groeit niet: 29 acties, 26 triggers en 20 voorwaarden, totaal 75 appbrede kaarten. Alleen de huidige dynamische alternatieven worden voor nieuwe Flows aangeboden; de eerdere kaarten blijven voor bestaande Flows werken.

Nieuwe inputkaarten weigeren een ontbrekend, ongeldig of niet meer geconfigureerd slot met een duidelijke fout. Ze vallen nooit terug op slot 1. Nieuwe voorwaarden geven dan false. Outputselecties blijven hun oorspronkelijke nummer volgen, zodat een eventueel laatste STOP/0 W-commando na een verlaging van het aantal niet door het selectiefilter wordt tegengehouden. De adapter maakt zelf geen stopcommando's aan; dat blijft de bestaande regeling.

Laat bij handmatig overstappen niet meerdere output-Flows hetzelfde toestel aansturen. Vervang de oude kaart en verbind de tags opnieuw, of schakel de oude sturende Flow uit.

## Geautomatiseerde controles

`npm run check` is geslaagd onder Node.js 22.16.0. De bestaande engine-, EV-, HVAC-, planning-, veiligheid-, UI- en regressietests zijn uitgevoerd, inclusief 0.7.8, 0.7.9, 0.7.10, 0.7.11 en de eerdere kaartmigratie.

De extra tests controleren:

- Alle oorspronkelijke kaartdefinities uit de eerste 0.7.12 blijven gelijk, behalve de deprecated-markering van de 31 dropdownkaarten. Manifest en Homey Compose komen overeen.
- 716 selectieopvragen op de 31 kaarten, met aantallen van 0 tot hun maximum, zoekfilters, naamwijzigingen, countwijzigingen zonder herstart, Engelse/Nederlandse batterijnamen en ontbrekende live-data.
- 364 vergelijkingen van nieuwe inputhandlers met de oude afhandeling en 300 vergelijkingen van voorwaarden. Ook de bestaande 440 inputvergelijkingen blijven slagen.
- Alle 72 genummerde outputroutes met gelijktijdige genummerde, dropdown- en autocomplete-abonnees. Alleen de juiste geselecteerde slot-Flow wordt uitgevoerd. Tags, stopuitgangen, volgorde en foutisolatie blijven behouden.
- Ongeldige, ontbrekende, verkeerde-categorie- en verwijderde selecties veranderen geen ander slot. Het aantal gecachte adapters blijft begrensd op 31; bestaande timercontroles blijven slagen.

Een bronvergelijking bevestigt dat `app.js` na het terugdraaien van alleen de nieuwe Flow-adapter en selectieprovider exact gelijk is aan de basis. De oorspronkelijke handlers en regelalgoritmen zijn niet gewijzigd. Engine, flexibele-lastregeling, EV-sessielogica, opbrengstberekening, API, drivers, widgets, afhankelijkheden, rechten en slogan zijn behouden. Alleen de pakket-testcommando's zijn uitgebreid.

## Beperkingen en controle op echte Homey

Deze tests gebruiken een nagebootste Homey Flow-manager. Er is geen fysieke Homey of aangesloten hardware bediend. Homey-editorweergave, opgeslagen Flows na een echte appupdate en de certificeringsvalidatie moeten nog op een echte installatie worden gecontroleerd.

De Homey CLI is hier niet beschikbaar. Een poging om de CLI-versie via de npm-registry op te vragen mislukte door netwerk-/DNS-onbereikbaarheid. `homey app validate --level publish` is daarom niet uitgevoerd.

Controleer na installatie enkele bestaande Flows en een nieuwe input-, output- en voorwaardekaart met verschillende opgeslagen aantallen. De volledige mapping en upgradecheck staan in `docs/FLOW-MIGRATION-0.7.12.md`; de testuitvoer staat in `docs/TEST-RESULTS-0.7.12.txt`.

## SDK-referenties

https://apps.developer.homey.app/the-basics/flow/arguments
https://apps.developer.homey.app/guides/how-to-breaking-changes
