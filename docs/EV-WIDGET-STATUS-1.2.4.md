# HomeFlux EMS 1.2.4 — Compact EV Status tab

Gebaseerd op de laatst geleverde volledige 1.2.4-proefbuild (batterijopties, sessiemelding, EMS-tags en Peak Guard-correcties inbegrepen). De appversie blijft **1.2.4**.

## Bediening

De EV-widget ondersteunt **Status · Planning · Inzichten**, in die volgorde. Met **Status / Planning / Inzichten wisselen met knoppen** aan verschijnt Status als eerste tab. Nieuwe instanties openen daarop; een eerder opgeslagen geldige tabkeuze blijft behouden per widgetinstantie.

Status toont de geselecteerde EV, centrale laad-/aansluitstatus, het actieve laadschema en het laaddoel met deadline. Het doel wordt alleen uit het bestaande centrale plan of actieve schema overgenomen. SoC- en kWh-doelen, absolute meerdaagse deadlines en Emergency worden ondersteund. Emergency toont 100% zonder de opgeslagen standaarddeadline. Ontbrekende gegevens blijven onbekend. Een lokaal, onvolledig concept wordt nooit als actief doel getoond.

Er staan geen presets, Guaranteed-/Emergency-bediening, datumvelden of andere planningsinstellingen op Status. Een vertraagde klik van een inmiddels verborgen planningsknop kan daar geen opdracht versturen. Tabwisselen annuleert een openstaande bevestiging en maakt geen API-aanvraag of laadopdracht.

Voor een **compacte zelfstandige widget**: zet Compacte EV-status tonen aan en Scheduler en Insights uit. Met één zichtbare weergave vervallen de tabknoppen. Bij meerdere EV’s blijven de bestaande EV-selectieknoppen beschikbaar. De widget blijft de bestaande automatische hoogteaanpassing gebruiken.

De eerdere gecombineerde weergave blijft behouden wanneer wisselen uit staat. De nieuwe Status-samenvatting wordt daarin niet dubbel boven de Planning weergegeven. Ook een bestaande Insights-only indeling krijgt geen extra samenvattingskaart.

## Scope en behoud

Alle wijzigingen aan productiecode zijn beperkt tot de EV-widgetweergave, widgetinstellingen, het gegenereerde widgetmanifest en Nederlandse/Engelse vertalingen. README en de bestaande UI-tests zijn bijgewerkt.

`app.js`, de widget-API, `controller.js`, alle bestanden onder `lib/`, drivers, Flow-kaarten, instellingenpagina, WAF, Savings, batterijregeling en EV-planners zijn **bytegelijk aan de laatst geleverde ZIP**. Er is geen tweede statusmonitor, planner, polling of timer toegevoegd. Status leest dezelfde dashboardpayload als de bestaande widget.

De drie tabknoppen passen naast de titel bij normale widgetbreedtes. Onder 310 px schuiven ze naar een volledige rij onder de titel om te voorkomen dat labels elkaar verdringen. De bestaande licht-/donkerkleuren blijven gebruikt.

## Verificatie

**9 gerichte testbestanden geslaagd, 0 mislukt.** De UI-suite bevat **43 geslaagde scenario’s**, inclusief de eerdere planningsbediening en nieuwe controles voor:

- Status als eerste/default tab, centrale doelen en deadlines zonder planningsknoppen;
- alleen Status, met de wisseloptie aan en uit, in Nederlands en Engels;
- meerdere EV’s, behouden EV-selectie en opgeslagen tabkeuze per instantie;
- SoC, kWh, meerdaagse datum, Emergency en onbekende doelen;
- een verborgen/planningsconcept dat niet als actief doel verschijnt;
- annuleren van bevestiging bij tabwissel en geen GET/POST door tabwisselen;
- geen opdracht bij een achtergebleven klik op een Planning-knop terwijl Status actief is;
- bestaande gecombineerde, Planning-only en Insights-only modi.

Aanvullend slagen de algemene widget-, vertaling-, Help-, dashboard-, handler- en Emergency-controles. **Zeven bestaande Flow-planningssnapshots zijn identiek** aan de vorige ZIP. Het directe bronvergelijkingsrapport vermeldt geen gewijzigde EV-methoden of plannermodules. Het inline JavaScript is syntactisch gecontroleerd.

Testresultaten: `validation/ev-widget-status-1.2.4.json`, `validation/ev-widget-ui-1.2.4.json` en `validation/ev-widget-regression-1.2.4.json`. Bestandswijzigingen en checksums: `validation/ev-widget-status-source-audit-1.2.4.json`.

Alle tests zijn uitgevoerd met gesimuleerde DOM/Homey-I/O. **Niet uitgevoerd:** fysieke Homey/dashboard-/browserweergave, Store-/installatievalidatie en hardware-CPU/geheugenmetingen. De volledige 100-bestandensuite van de vorige wijzigingsronde is niet opnieuw uitgevoerd voor deze geïsoleerde UI-aanpassing; de backend is bytegelijk gebleven. De bestaande validatierapporten uit eerdere rondes zijn behouden en niet voorgesteld als nieuwe metingen.
