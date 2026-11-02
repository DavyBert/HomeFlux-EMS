# Controle prijsafstemming en bronnamen — 1.0.6

## Bevindingen vóór de wijziging

De formule bestond al in `lib/price-normalization.js`: `fitCalibration` bepaalde met gewogen lineaire regressie `alignedPrice = scale × sourcePrice + offset`. `app.js:getDynamicPriceSelection` riep deze methode aan voor iedere geselecteerde reservebron tegenover de eerste bron. Dat werkte in beide richtingen tussen alle drie de bron-ID’s. Een formule van Homey was geen voorwaarde voor deze regressie.

De oorspronkelijke grens was minimaal vier overlapparen en 60 minuten, met minstens 0.005/kWh spreiding in bronprijzen. Factoren buiten 0.1–10, RMSE boven 0.002/kWh of één afwijking boven 0.005/kWh werden afgekeurd.

Er waren reële blokkades:

- Alle overlap tot 120 uur telde mee. Verschillende forecasts voor latere dagen konden een juiste prijsrelatie voor vandaag afkeuren.
- Eén afwijkend blok kon de hele relatie afkeuren.
- Uurwaarden konden direct tegenover afzonderlijke kwartierwaarden worden vergeleken, terwijl het uurprijsniveau het gemiddelde van die kwartieren vertegenwoordigt.
- Zonder `startMs` werden lokale datum/tijdvelden als UTC behandeld.
- Cachecontrole keek naar update-timestamps. Een vervangen curve met dezelfde timestamp kon de vorige cache/afstemmingspoging hergebruiken. Een verlopen model kon zonder nieuwe update blijven wachten.
- De widget gebruikte voor diverse afwijzingen één algemene wachtmelding.

De aanvankelijke screenshot bood onvoldoende data om de exacte oorzaak vast te stellen. De later aangeleverde numerieke arrays reproduceerden een specifiek probleem: External Price 2 herhaalt uurprijzen vier keer, terwijl External Price 1 echte kwartierprijzen bevat. De bovenstaande gevallen zijn wel gereproduceerd. Zowel afwijkende forecasts ná vandaag als één uitschieter gaven vóór de wijziging `incompatible_curves` en na de wijziging een correcte factor 1.21 en opslag 0.12.

## Herstel van dezelfde centrale methode

`lib/price-normalization.js` blijft de enige afstemmingsmethode. Expliciete timestamps zijn leidend; lokale datum/tijdvelden gebruiken de ingestelde tijdzone. Vergelijking gebeurt op volledige blokken van de grofste bronresolutie. Hiervoor worden tijdelijke gewogen gemiddelden gemaakt; ontvangen brondata verandert niet.

Ook numerieke arrays op kwartierresolutie kunnen uurdata bevatten: minstens vier volledige klokuren met vier identieke kwartieren per uur en een consistent patroon over de curve worden als uurresolutie herkend voor de afstemming. Onvolledige begin-/einduren leveren geen gedeeltelijke uurgemiddelden op. Deze herkenning verandert uitsluitend de tijdelijke vergelijking; opgeslagen prijzen, widgetcurves en de interne planning behouden hun oorspronkelijke slots. Echte kwartierdata met slechts enkele vlakke uren wordt niet omgezet.

Alleen overlap binnen de huidige lokale kalenderdag bepaalt de correctie. Zo vervormen forecasts voor latere dagen de relatie niet. Er zijn minimaal **vier complete vergelijkbare blokken én 60 minuten** nodig:

- 15/15 minuten: minimaal één uur;
- 60/60 of 15/60 minuten: minimaal vier uur.

De gewone gewogen lineaire regressie blijft de eerste stap. Bij afwijkingen wordt een mediane helling uit meerdere punten gebruikt als robuuste start, gevolgd door dezelfde gewogen regressie op overeenkomende punten. Minimaal **80% van zowel het aantal blokken als de overlappende duur** moet de relatie ondersteunen. De bestaande fout- en factorgrenzen blijven gelden. Enkele uitschieters kunnen worden uitgesloten; een duidelijk ander prijsverloop wordt afgekeurd. Bekende uitschieters verdwijnen alleen uit de interne planningscurve, nooit uit opslag of grafiek.

Te vlakke of te korte data vormt geen bewijs voor een nieuwe correctie. Een geldige bestaande correctie mag worden hergebruikt, maar wordt ingetrokken als nieuwe overlap die correctie tegenspreekt. Zonder betrouwbare afstemming wordt de reservebron niet als gelijkwaardige fallback gebruikt.

## Aanroepen, caching en diagnostics

`app.js:getDynamicPriceSelection` levert prijskeuze voor runtimeplanning en prijsstatus. Elke reservebron krijgt een afzonderlijk model tegenover de primaire bron; `normalizeSecondary` maakt uitsluitend interne planningsrijen.

Herberekening volgt nieuwe prijsdata, een vervangen curve (ook bij gelijke update-timestamp), gewijzigde bronvolgorde, resolutie, tijdzone of Homey-prijsformule, een nieuwe lokale kalenderdag, herstel van beschikbaarheid en het verlopen van een model. Ongewijzigde succesvolle en mislukte pogingen worden gecachet. Er is geen extra timer of normale runtime-logstroom toegevoegd.

Modellen blijven maximaal 48 uur geldig en worden opgeslagen onder `_dynamicPriceCalibrations`, per paar van vaste bron-ID’s. De bestaande `_dynamicPriceCalibration` blijft voor compatibiliteit behouden. Externe curves blijven onafhankelijk opgeslagen onder `_externalPriceCurves`. Een herstart kan een geldige opgeslagen afstemming gebruiken wanneer de referentiebron tijdelijk ontbreekt.

Instellingen en de bestaande optionele planningsdiagnostiek tonen referentie/bron, overlapblokken en minuten, factor/opslag, fitmethode, uitschieters, foutmaten en reden van afwijzing. De diagnose bevat ook `primaryResolutionMinutes`, `secondaryResolutionMinutes`, `comparisonResolutionMinutes`, `primaryRepeatedHourly` en `secondaryRepeatedHourly`. Bij vroege afwijzing wegens onvoldoende overeenkomende punten blijven de foutmaten van de eerste regressie beschikbaar. De widget onderscheidt gereed, onvoldoende overlap, onvoldoende prijsvariatie, onvoldoende overeenkomende curves, verlopen afstemming, ontbrekende/verouderde data en een afwijkend actueel blok.

## Namen en Flow-compatibiliteit

Namen worden als strings opgeslagen in `externalPrice1Name` en `externalPrice2Name`. Standaard: **External Price 1** en **External Price 2**. Lege waarden vallen daarop terug; namen worden getrimd en beperkt tot 80 tekens. Interne ID’s blijven **external** en **external2**. Namen veranderen geen bronvolgorde, parser, prijsbasis of opgeslagen curve.

De namen verschijnen in vinkjes, prioriteiten, prijsstatus, widget-prijsregels, actieve-bronstatus, grafieklegenda, diagnostics en de nieuwe Flow-keuzelijst. Naamvelden zijn zichtbaar voor geselecteerde externe bronnen. Naamwijzigingen worden overal toegepast na opslaan.

Homey heeft vaste `dropdown`-waarden en dynamische `autocomplete`-keuzes. Daarom heeft de nieuwe kaart `read_external_prices_json_named` een dynamische bronkeuze, met de bestaande titel **Read external prices JSON / Lees externe prijzen JSON**. Iedere query leest de actuele namen. Resultaten bevatten de vaste `id`, zichtbare `name` en een standaardbeschrijving om gelijke namen te onderscheiden. Een opgeslagen selectie blijft correct werken na hernoemen; de opgeslagen zichtbare tekst kan blijven staan totdat die bron opnieuw wordt geselecteerd.

De eerdere `read_external_prices_json`-kaart behoudt haar ID, stringargumenten, dropdownwaarden en werking, en is nu deprecated. Alle eerder deprecated kaarten blijven ongewijzigd. Zowel de nieuwe als de behouden kaarten gebruiken `readExternalPrices` en dezelfde JSON-parser. Bestaande Flows hoeven niet opnieuw te worden opgebouwd.

## Originele grafiek en regressiecontrole

`widgets/status/api.js` leest de ontvangen bronrijen rechtstreeks. Het endpoint gebruikt geen resampled of aligned planningscurve voor de grafiek. Kwartierwaarden blijven kwartierwaarden bij een uurcontract. De widget houdt de eigen intervalduur en prioriteitsnummering aan. Originele prijs, afgestemde prijs en afstemmingsstatus worden afzonderlijk weergegeven.

`npm run check` slaagt met syntaxcontroles en **43 testsuites**. Nieuwe tests omvatten de drie gevraagde bronvolgordes A/B/C, formuleloze afstemming, uitval en terugkeer van de primaire bron, ontbrekende derde bron, later aangeleverde/gewijzigde curves, caching, herstart, stabiele Flow-ID’s na hernoemen, 15/60-minutenvergelijking, Belgische tijdzone en zomertijd, onbetrouwbare overlap, uitschieters en ongewijzigde originele grafiekdata.

Bestaande tests voor vaste/multi-tarief/dynamische planning, Cheap/Normal/Expensive, EV, HVAC, boiler, batterij, Hybrid EMS, Savings, valuta, Peak Guard, PV, Autotune en performance slagen. De batterij-engine bevat alleen twee nieuwe naamdefaults; de beslissingscode is bytegelijk aan de vorige 1.0.6. Athom-webteksten blijven bytegelijk. Versies blijven 1.0.6. Tests gebruiken Homey-testdoubles; installatie en live gebruik op een fysieke Homey zijn hier niet uitgevoerd.

## Controle met de aangeleverde curves

De arrays bevatten 139 prijzen voor External Price 1 en 191 voor External Price 2. Zonder timestamps is de starttijd afhankelijk van de Flow-periode en ontvangsttijd. Voor de reproducerende test krijgen beide dezelfde `next_hours`-start om 13:15 op 4 oktober 2026 in Europe/Brussels. De tien volledige uren van vandaag (14:00–24:00) voldoen vrijwel exact aan `External Price 1 uurgemiddelde = External Price 2 + 0.10/kWh`. De fit geeft factor 0.999859, opslag 0.100035/kWh, RMSE 0.000024/kWh en maximale fout 0.000045/kWh. Rechtstreekse kwartiervergelijking geeft RMSE circa 0.013494/kWh en wordt terecht niet als kwartierrelatie geaccepteerd. Afwijkende forecasts van morgen worden niet meegenomen in de correctie voor vandaag.

De tests gebruiken de volledige aangeleverde arrays via de centrale parser, controleren fit en daadwerkelijke fallback in beide richtingen, ongewijzigde brondata, gedeeltelijke uren, echte kwartierprijzen, verkeerd uitgelijnde herhalingen, ontbrekende kwartieren en 23-/25-uursdagen. Deze lokale simulatie bewijst niet welke ontvangsttijd of eerder bewaarde brondata op de fysieke Homey aanwezig is.
