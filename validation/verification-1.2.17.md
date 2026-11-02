# HomeFlux EMS 1.2.17 – import vermijden en lage-PV-strategie

Uitgangspunt: de volledige laatst aangeleverde 1.2.16. Geen installatie of publicatie op Homey.

## Vaststelling en correctie

De gewone lage-PV-regel was al ondergeschikt aan een multitarief met ‘Vermijd alle netimport’. Een toekomstige maximale laadplanning werd echter eerder beoordeeld dan die tariefkeuze. Daardoor kon HomeFlux in een duur tarief met 77,5% SoC en 1.533 W huisafname toch 0 W gewone ontlading vragen. De widget toonde dan Batterij sparen. Alleen Peak Guard kon nog batterijondersteuning vragen bij hogere belasting. Dit gebeurde ook bij een hoge of ontbrekende PV-voorspelling: de voorrang van de toekomstige laadplanning was de oorzaak.

De expliciete multitariefkeuze wordt nu vóór de maximale laadplanning toegepast. Wachten op een later laadblok kan de gekozen importvermijding niet meer onderdrukken. De toekomstige planning en haar vaste eindtijd worden behouden.

Bij dynamische hoge prijzen geeft een nog niet actief maximaal laadblok de gewone tariefregeling vrij. Een expliciet aangevinkte lage-PV-spaarregel voor dure dynamische uren blijft geldig. Een bewust actief dynamisch laadblok behoudt zijn bestaande werking; er is bij dynamische tarieven geen identiek multitariefvinkje voor alle netimport vermijden.

## Afbakening

- Safety SoC-herstel houdt voorrang. Gewone ontlading respecteert Safety SoC, vermogenslimieten, EV-bescherming en afzonderlijk geselecteerde zonkansreserve. Peak Guard behoudt zijn eigen harde minimum-SoC en vermogensgrenzen.
- Een handmatig geforceerde modus behoudt zijn voorrang. Een expliciet gekozen zonkansreserve op het hoge tarief kan gewone ontlading nog beperken. Netimport blijft mogelijk wanneer batterijvermogen of beschikbare SoC onvoldoende is.
- Goedkope toekomstige laadblokken blijven wachten; PV-overschot blijft opgevangen. Geen polling, extra timers, gewijzigde intervallen of nieuwe achtergrondtaken toegevoegd.

## Verificatie

20 gerichte suites geslaagd. Volledige lijst en uitkomsten: `targeted-tests-1.2.17.json`.

De nieuwe regressietest omvat acht groepen met 360 multitariefvergelijkingen, 16 dynamische uur-/kwartierprijsscenario’s en acht echte app-/uitsturingstraces met nagebootste fysieke P1-terugkoppeling. Alle 96 eerder afwijkende vergelijkingen uit deze matrix zijn hersteld. Dag- en nachtplanning, lage/hoge/ontbrekende forecast, SoC boven en onder het laaddoel, belasting onder en boven Peak Guard, vroege/late/gecentreerde laadkeuze en voorbereide snelle context worden meegenomen.

Aanvullend gecontroleerd: 11:00/17:00/22:00-tariefwissels met verlopen contextcache, gepland goedkoop laden, PV-opvang, expliciet gekozen zonkansreserve, Safety SoC, ontbrekende dynamische prijzen, bewuste actieve dynamische laadblokken, EV-batterijbescherming, netbudget inclusief EV4, herstart, nachtforecast, planningsgrenzen, batterij-isolatie, widget/Logic-weergave en bestaande CPU-coalescing/Split-loopwerking.

Syntax van alle gewijzigde JavaScript en JSON gecontroleerd. Versie in manifests en package-metadata is 1.2.17; runtime-logging en loopdetectie lezen de manifestversie. Athom-teksten, slogan en deprecated Flow-kaarten blijven gelijk. Geen bestaande test verwijderd of verzwakt.

## Overgeslagen en resterende risico’s

De volledige regressiesuite en onafhankelijke HVAC-, boiler-, Savings-, Autotune-, prijsimport- en EV-planningssuites zijn overgeslagen. Hun interne werking is niet opnieuw getest; relevante gedeelde batterij-, flexibele-belasting- en EV-beschermingspaden zijn wel getest. Geslaagde controles zijn alleen herhaald na een relevante wijziging.

Homey CLI-debugvalidatie is niet uitgevoerd omdat die CLI ontbreekt. Werkelijke hardware, Flow-doorlooptijd en CPU/geheugen op Homey zijn niet gemeten. Er wordt geen Homey-besparingspercentage geclaimd.
