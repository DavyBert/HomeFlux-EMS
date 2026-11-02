# HomeFlux EMS 1.2.6

Basis: de nieuw aangeleverde `HomeFlux-EMS-v1.2.5(3).zip`.

## Exportcontrole

De aangeleverde savingsregistratie gebruikt al de echte P1-waarde, met **0 W als grens**: positief is import, negatief export. `set_grid_power` bewaart de ruwe waarde; `recordSavingsSample` geeft die via `getGridFreshness().value` door aan `integrateInterval`. De savingsberekening gebruikt geen `gridZeroMinW`, `gridZeroMaxW`, middelpunt of EV-regeloffset. De ingestelde netband blijft uitsluitend een regelparameter.

Gecontroleerd met echte Flow-invoer en een netband van −600 tot −300 W, voor P1-waarden −750, −600, −450, −300, −100, −1, 0, +1 en +100 W. Ook export **binnen** de band wordt geregistreerd. PV-export, export uit een netgeladen batterij en export uit onbekende batterijvoorraad behouden hun afzonderlijke registratie. Er is daarom geen onbewezen wijziging aan de energietoerekening aangebracht.

De bestaande beperkingen blijven relevant bij een verschil met de fysieke teller: ongeldige/verouderde P1- of PV-data leveren geen betrouwbare siteverdeling op; lange ontbrekende meetintervallen worden niet aangevuld. Batterijvermogen in deze registratie is het laatst bekende EMS-commando en geen afzonderlijk gemeten batterijvermogen. De expliciete dagelijkse import/exporttellers blijven de bestaande dagkalibratie uitvoeren. Een negatieve netband verklaart op zichzelf geen ontbrekende export in deze bronversie.

## Dan-kaart: Lees savings per categorie

Voorbeeld: **Haal PV in batterij geladen (kWh) op van de laatste 5 dagen als kWh**.

Kies een categorie, een positief geheel aantal, dagen/weken/maanden/jaren en precies één van drie uitvoerkeuzes:

1. **kWh** — bijvoorbeeld `12,5 kWh`.
2. **kWh met prijs** — bijvoorbeeld `12,5 kWh · € 3,75`.
3. **Alleen prijs** — bijvoorbeeld `€ 3,75`.

De tag **Gekozen resultaat** volgt deze keuze en gebruikt de Homey-taal en ingestelde valuta. De numerieke tags **Energie (kWh)** en **Besparing / kosten (valuta)** blijven apart beschikbaar voor verdere Flow-berekeningen.

Categorieën: totale besparing, direct PV-verbruik, PV in batterij geladen, PV via batterij totaal/naar woning/geïnjecteerd, directe en totale PV-injectie, tariefverschuiving totaal/naar woning/geïnjecteerd, direct netverbruik, netladen van de batterij en totaal batterijladen. Geldwaarden bij kostencategorieën zijn kosten; bij besparingscategorieën de bestaande geboekte besparing/opbrengst. Negatieve waarden blijven behouden.

**PV in batterij geladen** geeft de geladen kWh. Er wordt bij het opslaan geen fictieve besparing toegekend: `Geldwaarde beschikbaar = nee`, numerieke waarde 0. Bij een prijsuitvoer staat daarom `Bedrag niet beschikbaar`. De gerealiseerde waarde verschijnt pas bij verbruik/injectie in de bestaande categorieën. Totale kWh telt direct PV-verbruik/injectie en batterijafgifte eenmaal; het is niet alle netafname of alle batterijlading.

De laatste N dagen omvatten vandaag tot nu. Een week is zeven dagen; maanden en jaren worden als voortschrijdende kalenderperiodes teruggeteld vanaf de dag na vandaag, met maandultimo-correctie. Geen uurrecords, geen nieuwe periodieke integratie en geen aanvullende savingsdatabase. De bestaande dagcache wordt hergebruikt. Maximale aanvraag: 1827 dagen, 260 weken, 60 maanden of 5 jaren.

Tags voor periode en beschikbaarheid: eerste dag, laatste dag inclusief vandaag, beschikbare geregistreerde dagen, gevraagde dagen en of alle gevraagde dagrecords aanwezig zijn. Dat laatste betekent aanwezigheid van dagrecords, niet dat elke dag 24 uur meetdekking heeft. Ontbrekende historie wordt niet als gemeten nul voorgesteld of achteraf gereconstrueerd.

## EV Insights via dezelfde Dan-kaart

De categorieën zijn altijd zichtbaar, ook zonder EV-records: EV totaal geladen/bekende kosten, zonne-energie/laadkosten uit zon, netenergie/kosten, aangetoonde batterij-energie, onbekende energiebron en zonne-energie/geschatte besparing. De extra EV-keuze selecteert alle EV’s of de vaste historische slotnummers EV 1–4. Die keuze geldt alleen voor EV-categorieën; bestaande kaartinstanties zonder EV-argument gebruiken alle EV’s.

De drie uitvoerformaten blijven kWh, kWh met prijs en alleen prijs. Kosten en besparingen komen uit de bestaande Insight-dagvelden: totale bekende laadkosten zijn netkosten plus de misgelopen injectievergoeding van directe zonne-energie. Geschatte zonnebesparing gebruikt het bestaande veld `solarSavings`. Batterijcommando’s leveren geen bewezen batterij-energie op; de bestaande onbekende toerekening blijft behouden.

Extra tags: **EV-gegevens beschikbaar**, **Volledige EV-gegevens**, **Zonne-kilometers (geschat)**, **Zonne-kilometers beschikbaar** en **Zonaandeel (%)**. Zonne-kilometers gebruiken dezelfde ingestelde kWh/100 km als de widget. Voor alle EV’s worden de individueel berekende kilometers opgeteld. Bij niet-toewijsbare gedeelde zonne-energie of ontbrekend verbruik wordt geen fictieve kilometerwaarde verstrekt: controleer de beschikbaarheidstag.

Bij ontbrekende EV-historiek geeft Gekozen resultaat `Geen EV-gegevens`; numerieke tags zijn 0 met EV-gegevens beschikbaar = nee. Een expliciet geregistreerde nul blijft wel een geldige nul. Bij EV-categorieën tellen Beschikbare dagen en Alle gevraagde dagrecords aanwezig alleen de dagen met bruikbare data voor de gekozen EV. Volledige EV-gegevens vereist daarnaast voldoende bestaande ledgerdekking en geen ontbrekende, onbekende, ongeprijsde of gedeelde energie. De dekking is afhankelijk van de beschikbare Insight-dagvelden, zonder extra meetdatabase of reconstructie van oude dagen.

Er is geen wijziging aan de registratie, laadsturing, planning of widget. De follow-up is uitsluitend uitlezing. Actuele gerichte validatie: `VALIDATION-EV-FLOW-1.2.6.txt`.

## Optionele nachthysterese

Onder batterijplanning staan twee onafhankelijke opties; beide staan standaard **uit**.

- **Nachthysterese inschakelen**: een instelbare SoC-marge van standaard 3 procentpunten, bereik 0,5–20. Kleine nachtelijke forecastwijzigingen behouden het bestaande geplande laaddoel; bij een verschil vanaf de marge wordt het doel vernieuwd. Een expliciet doel en de ingestelde maxima blijven gelden. Na het bereiken van het doel wordt binnen een toegelaten laadvenster geen normale ontlading voor de woning gestart om die energie meteen weer bij te laden. Pas bij een SoC-daling tot het doel minus de marge wordt opnieuw netladen toegestaan. Buiten dat laadvenster mag de batterij de woning blijven ondersteunen volgens de bestaande strategie. Overdag en met de optie uit blijft de bestaande herstartmarge van 2 procentpunten behouden. Peak Guard, Safety SoC-herstel en het opvangen van PV blijven actief. De toestand gebruikt de bestaande herstartbestendige laadbandregistratie.
- **PV-mediaan van 00:00–02:00 vasthouden**: verzamel actuele forecastwaarnemingen in dat lokale tijdvak en gebruik vanaf 02:00 hun mediaan voor de rest van die nacht. Maximaal de laatste waarneming per minuut, dus 120 compacte meetpunten. Avondwaarden en waarden vanaf 02:00 tellen niet mee in deze vaste mediaan. Zowel meetpunten als de vastgehouden waarde overleven een herstart. Zonder waarnemingen in dat tijdvak blijft de bestaande doorlopende nachtmediaan actief. Echte PV-productie beëindigt de nachtfase; de volgende nacht krijgt een eigen datum. De ruwe forecastinvoer blijft beschikbaar. Met de optie uit volgt de planning het bestaande algoritme.

De live batterijstatus toont bij een actieve stilstand `Nachtplanning · laaddoel bereikt`, met pauzecode `night_hysteresis` en bijbehorende reden.

## Autotune

- Alle Autotune-paden voor het batterij-stuurinterval gebruiken harde grenzen van **4–17 seconden**, ook bij oudere opgeslagen toegestane bereiken en bij het inschakelen van automatisch beheer. Handmatige batterij-instellingen buiten Autotune behouden hun bestaande bereik.
- Een netbandadvies vereist minstens 160 P1-waarnemingen én een concrete reden: een te kleine marge, duidelijke afwijking van het nulpunt, sterke ruis of een aantoonbaar overgrote band na meer waarnemingen.
- Advies is altijd een symmetrisch paar rond **0 W**. Minimale halve breedte is 75 W of viermaal de ingestelde batterijstap, begrensd op het bestaande configuratiebereik van 1000 W. Voor een stap van 1 W is de minimale aanbeveling −75/+75 W; voor 100 W −400/+400 W. Meer meetruis kan een bredere band rechtvaardigen.
- Eénmalig toepassen wijzigt beide grenzen samen. Automatisch toepassen vereist toestemming voor beide grenzen, voldoende vertrouwen en passende bereiken voor beide. Onverenigbare bereiken leveren geen half toegepast, verschoven paar op.

## Documentatie en verificatie

README bevat de korte basisstart, de noodzakelijke basis-Flow-kaarten en de laadtest/uitvoeractivering. Geavanceerde functies blijven kort vermeld; volledige configuratie verwijst naar https://github.com/DavyBert/HomeFlux-EMS/discussions/3. Releasenotes staan onderaan. De Athom-webteksten in `README.txt` en `README.nl.txt`, de slogan en alle bestaande deprecated Flow-kaarten zijn bytegelijk behouden.

Zie `VALIDATION-1.2.6.txt` voor de geautomatiseerde validatie. Dit is een broncodepakket; geen installatie op een fysieke Homey uitgevoerd.
