# HomeFlux EMS 0.9.7

Laadplanberekeningen lopen uitsluitend in de trage contextregelkring, na het opbouwen van de actuele runtimecontext. De afzonderlijke planningtimer en directe berekeningen vanuit SoC-, forecast-, prijs- en statuspaden zijn verwijderd. De minimumtijd voor laadplanberekeningen blijft een extra ondergrens, geen tweede regelkring.

Gewone wijzigingen behouden het laatste geldige plan en de bestaande deadline. Een wachtende wijziging gebruikt de gedeelde contexttimer, ook wanneer daarna geen nieuwe input meer arriveert. Herhaalde updates schuiven de planningsdeadline niet op. De eerste bruikbare SoC, gewijzigde instellingen, handmatig vernieuwen en een dag-/nacht- of datumovergang kunnen via de contextregelkring meteen een nieuw plan opleveren. De lokale datum bepaalt de overgang van morgen naar vandaag.

GET-planning en apparaatstatus lezen alleen de cache; de expliciete vernieuwactie loopt via een volledige contextpass. Nachtelijke Flow-publicaties volgen die contextpass en blijven beperkt tot een gewijzigd plan of het starten van een nieuwe nachtperiode. Planning tijdens een batterij-stuurpauze blijft mogelijk zonder de pauze op te heffen. Een expliciete planningssimulatie blijft een afzonderlijke, door de gebruiker aangevraagde berekening.

De snelle P1/PV-regeling en de minimumtijd tussen batterijcommando’s blijven zelfstandig. Veiligheidsingrepen mogen de contextpass nog steeds vervroegen; zij heffen de minimumtijd van een gewoon gewijzigd laadplan niet op.

Validatie: geautomatiseerde tests voor timerbundeling, invoer zonder vervolgevents, alleen-lezen status, datum/faseovergangen, handmatig vernieuwen, publicatie en batterijpauze, plus de bestaande regressies. Geen meting van CPU/RAM of hardwaretest op een fysieke Homey.
