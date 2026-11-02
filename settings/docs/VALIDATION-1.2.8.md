# Validatie HomeFlux EMS 1.2.8

De gedeelde normalisatie voor batterijplanning, regelcontext en evaluatie is gewijzigd. Daarom is de volledige bestaande regressiesuite uitgevoerd, aangevuld met één gerichte isolatietest. Geen tests verwijderd of controles versoepeld. Drie bestaande tests hebben alleen hun expliciete versieverwachting van 1.2.7 naar 1.2.8 bijgewerkt.

## Resultaat

102 van 109 testbestanden geslaagd, na het gericht herhalen van twee aanvankelijk nog op 1.2.7 controlerende tests. De overige zeven falen ook met bytegelijk dezelfde foutuitvoer (afgezien van de werkpadnaam) in de ongewijzigde 1.2.7. Er is in deze vergelijking geen nieuwe regressie vastgesteld. De suite is dus niet volledig groen.

Bestaande falingen:

- regressions-0.7.16: minimale testharness mist app.log voor de bestaande HVAC-migratie.
- independent-ev-1.1.5: EV-startverwachting faalt.
- diagnostics-1.1.6: verwachte EV-publicatie ontbreekt.
- ev-battery-protection-1.1.6: bescherming tegen batterijontlading faalt in een replay.
- soc-completion-1.1.9: EV-verwachting na SoC-doel faalt.
- ev-peak-1.1.20: een diagnose-/vervolgevaluatieverwachting faalt na zeven geslaagde scenariogroepen.
- ev-physical-proof-1.2.4: stroomverwachting faalt na dertien geslaagde scenariogroepen.

Deze resultaten zijn niet stilzwijgend als verouderde tests aangemerkt: of de EV-falingen een eerdere gedragswijziging of een bestaand productprobleem weerspiegelen is buiten deze gerichte geheugenoptimalisatie niet opgelost. De falende tests kunnen latere controles binnen datzelfde bestand niet bereiken. Dit blijft een beperking van de regressiezekerheid.

## Nieuwe dekking

48 contract-/tijd-/netvermogensscenario’s geven identieke resultaten aan 1.2.7 voor regelcontext, batterijcommando en SoC-planning. Elke HVAC-invoergetter werpt daarbij bewust een fout; geen van deze getters wordt gelezen door de batterijberekeningen. Gedeeltelijke instellingen behouden de bestaande batterijdefaults. Een geblokkeerde migratiepauze bewijst dat de eerste batterijcontext pas start na volledige initialisatie. Opgeslagen kanaalnamen en COP-objecten blijven behouden. De bestaande 35 HVAC-groepen, 180 COP-Flow-publicaties en de migratietest zijn eveneens geslaagd binnen de volledige suite.

## Geheugenproeven

De som van bemonsterde tijdelijke allocaties in cache-opbouw, regelcontext, evaluatie, SoC-planning en de nieuwe normalisatiehelper daalt in de lokale proef van circa 6,09 naar 1,77 MiB. Een afzonderlijke opstartproef toont circa 19,84 naar 15,89 MiB heap vóór expliciete garbage collection; na garbage collection ongeveer 12,53 respectievelijk 12,46 MiB. De nieuwe herstart zonder migratie meet circa 15,64 MiB vóór en 12,47 MiB na garbage collection. Dit zijn afzonderlijke gesimuleerde Node v24-processen; het is geen piekmeting van de fysieke Homey en geen garantie dat de gemelde crash hiermee verdwenen is.

De volledige instellingenbundel en migratieschrijfacties blijven bewust behouden voor compatibiliteit. De verbetering zit in de herhaalde batterijberekeningen, die nu geen HVAC-velden overnemen. De bestaande tweesecondenpauzes tussen extra HVAC-kanalen blijven gelden.

## Overige controles en grenzen

Gewijzigde JavaScript-syntax en alle gewijzigde JSON-bestanden gecontroleerd. Versie 1.2.8 is gelijk in beide manifesten, package en lockfile. Flow-definities, Athom-webteksten, slogan, HVAC-/EV-sturing en schedulerproductiecode zijn bytegelijk aan de laatst geleverde 1.2.7. ZIP-integriteit gecontroleerd. Historische validatiebestanden zijn niet door de nieuwe meetresultaten overschreven; actuele uitkomsten staan in de twee 1.2.8-validatiebestanden.

Er zijn geen onafhankelijke tests overgeslagen binnen de geregistreerde volledige suite. Geslaagde tests zijn niet herhaald; herhalingen betroffen gewijzigde versiecontroles, falingen voor baselinevergelijking en nieuwe meetvarianten. Fysieke Homey-/apparaatwerking en het verdwijnen van Memory Warning Limit Reached blijven praktijktests.
