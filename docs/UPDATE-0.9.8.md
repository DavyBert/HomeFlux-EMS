# HomeFlux EMS 0.9.8

De PV-live-selectie vergelijkt opeenvolgende geldige PV-metingen. Bij een absolute verandering vanaf de ingestelde drempel wordt actuele P1 gebruikt; bij een volgende verandering onder die drempel wordt opnieuw de ingestelde middeling gebruikt. Dit vervangt de cumulatieve referentie ten opzichte van het laatste batterijcommando uit 0.9.6.

De bestaande Autotune-statistiek levert het verwachte meetinterval. Voor invoer langzamer dan 60 seconden wordt de laatst waargenomen tussenpoos gebruikt, omdat die buiten het Autotune-leervenster valt. Zonder beschikbare tussenpoos geldt 15 seconden als uitgangspunt. De live-keuze vervalt na twee meetintervallen (minimaal 1 seconde, maximaal 10 minuten). De geldigheid wordt gecontroleerd bij de bestaande invoer-/regelactiviteiten; er is geen nieuwe timer, pollinglus of meethistoriek. Een eerste meting, ontbrekende invoer en echte 0 W worden onderscheiden.

Een nieuwe grote PV-verandering en de overgang tussen live en gemiddeld mogen één nieuwe snelle evaluatie aanvragen. Dezelfde reeds verwerkte PV-meting veroorzaakt bij P1 binnen de nulzone geen herhaalde evaluatie. Werkelijke netafwijkingen en Peak Guard blijven via de bestaande regeling actief.

De minimumtijd tussen batterijcommando’s blijft gelden. Tijdens deze wachttijd beslist de nieuwste PV-toestand welke P1-bron op het eerstvolgende stuurmoment wordt gebruikt. Een rustige meting of verlopen live-keuze wordt niet kunstmatig vastgehouden. Een geslaagd, vertraagd of mislukt batterijcommando verandert de PV-observatie niet. Directe P1-sturing en de afzonderlijke adaptieve live-optie blijven hun eigen instelling volgen.

Validatie: de cumulatieve PV-specificatie uit de 0.9.6-regressietest is vervangen door 0.9.8-tests voor stijgende/dalende PV, drempelgrenzen, alle middelingskeuzes, nul/ongeldige invoer, geen-data-terugval, invoercadans, nacht, herhaalde P1-input, commandowachttijd, asynchrone/mislukte publicatie en Flow/API-invoer. De bestaande 0.9.7-planningtests blijven actief. CPU/RAM-winst is niet gemeten op een fysieke Homey.
