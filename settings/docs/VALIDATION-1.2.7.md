# Gerichte validatie 1.2.7

## Uitgevoerd en geslaagd

- Syntaxcontrole van gewijzigde JavaScript-bestanden, inline scripts en JSON-bestanden.
- HVAC: 20 testgroepen, inclusief 150 vergelijkingstoestanden tegen de exact opgeleverde 1.2.6-broncode, tien kanalen, directe afbouw en één toename per interval, tarief/PV-matrix, gedeeld budget, Peak Guard, herstart, fout- en stale-publicaties, gegroepeerde installatie, afzonderlijk warmte-/koudevermogen, EV-blokkering, onstabiele/gemiste metingen, herbeoordeling en begrensde observatie over 60 minuten.
- UI: 80 combinaties van conditionele instellingen, unieke invoervelden voor tien kanalen, echte widget-renderfunctie in DOM-simulatie, drie kolommen, ontbrekende waarden, wachtstatus en nog niet gepubliceerd PV-doel.
- Bestaande gerichte tests: engine, flexible-loads, multi-flexible-loads, flow-slot-cards, configured-flow-cards, settings-runtime-audit, settings-startup, widget, performance-split-loop en ev-house-publication-1.2.5.
- Aansluitende instellingenvertalingen en planning-monitor-versiecontrole.
- Alle Flow-kaartdefinities en beide Athom-README-teksten bytegelijk aan de opgeleverde 1.2.6; manifest-Flow-definities inhoudelijk gelijk.
- Geslaagde tests zijn alleen herhaald na een relevante wijziging. Volledige bestaande testsuite blijft beschikbaar; nieuwe tests zijn aan package.json toegevoegd.

Een bestaande configured-flow-cards-test verwachtte ten onrechte dat ook de historische EV-selectie van get_savings_category alleen autocomplete-argumenten had. Dezelfde fout is op de ongewijzigde 1.2.6 gereproduceerd; de assertie respecteert nu deze bestaande uitzondering. Andere bestaande testaanpassingen volgen de nieuwe aantallen/versie en snapshotuitbreiding; er zijn geen tests verwijderd.

## Overgeslagen en risico's

De volledige regressiesuite en uitgebreide onafhankelijke batterij-, nacht-, prijs-, Savings-, boiler- en EV-planningregressies zijn niet uitgevoerd. De wijzigingen raken daar geen regelalgoritmen; gerichte engine-, portfolio-, Flow- en EV-publicatietests controleren de directe koppelingen. Langdurige integratie-effecten buiten deze scenario's blijven ongetest.

Er is geen Chromium-executable in deze omgeving; native visuele verificatie kon niet worden uitgevoerd. De daadwerkelijke instellingenlogica en widget-renderfunctie zijn daarom in VM/DOM-tests gecontroleerd. Fysieke Homey, toestelfeedback en live-installaties zijn niet getest. Zie UPDATE-1.2.7.md voor temperatuur- en meetbeperkingen.

De CPU-/heapmeting is uitsluitend een Node-simulatie met honderd portfolio-evaluaties per configuratie. De JSON vermeldt expliciet dat geen fysieke Homey is gemeten. Oudere validatierapporten in dit pakket horen bij hun eigen versies en gelden niet als een nieuwe volledige regressierun voor 1.2.7.

## Aanvulling: compacte HVAC-typografie

Waarden en toestelnamen volgen nu 11,5 px, kolomkoppen 9,5 px. Alleen widgetopmaak en release-documentatie gewijzigd; versie blijft 1.2.7. Inline JavaScript/JSON-syntax, bestaande HVAC-UI- en widgettests uitgevoerd, plus berekende CSS-maten voor lichte en donkere thema’s in DOM-simulatie. Onafhankelijke regellogica niet opnieuw getest. Native Homey-weergave blijft een praktijktest. De gebruiker bevestigde dat de instellingenpagina wel opent; hierin is geen opstartwijziging aangebracht.

## Aanvulling: HVAC-overzicht en instellingenindeling

Kop met rechts gekleurde tariefweergave; gekleurde warmte-/koeliconen naast de naam; Doel en Ruimte rechts uitgelijnd; tabelachtergrond volgt de overige widgetvelden. De nieuwe instellingen staan direct onder de activeringsschakelaar voor alle tien kanalen. Versie blijft 1.2.7.

Geslaagd: HVAC-UI (80 combinaties), widget, settings-startup, settings-runtime-audit (791 velden), settings-translations; inline-script-/JSON-syntax; zes thema-/tariefgevallen met de echte widget-renderfunctie in DOM-simulatie, en plaatsing bij tien kanalen. Regellogica en volledige regressiesuite overgeslagen omdat alleen presentatie is aangepast. Geen fysieke Homey- of native browsercontrole; eventuele visuele afwijkingen door Homey blijven een praktijktest.

## Aanvulling: twee TOU-tarieven

HVAC-tariefdoelen tonen alleen laag/hoog bij precies twee geconfigureerde TOU-tarieven. Normaal wordt verborgen; de opgeslagen waarde blijft behouden voor een latere contractwijziging. Drie tarieven en dynamische contracten behouden drie doelen. Alle tien kanalen verversen bij een gewijzigd contracttype of toegevoegd/verwijderd tarief. De bestaande engine classificeert minimumprijs als cheap en maximumprijs als expensive; geen regellogica gewijzigd.

Geslaagd: HVAC-UI met extra twee-/drie-/dynamische tarieftests, instellingenopstart, instellingenvertalingen, volledige instellingenopstart in DOM-simulatie en syntaxcontroles. Onafhankelijke regelregressies en volledige suite overgeslagen wegens uitsluitend UI-wijziging. Fysieke Homey-weergave niet getest. Versie blijft 1.2.7.

## Aanvulling: dubbele HVAC-PV-opties

Oude UsePvSurplus bestuurt de tijdelijke PV-boost; nieuwe PvEnabled kiest het permanente PV-doel. Bij PermanentEnabled en minstens één nieuwe optimalisatie worden de oude PV-optie, batterijdoorgang, stop-SoC, oude strategie/afwijking en snelle importreset verborgen. De gedeelde exportdrempels en minimale SoC blijven bij de nieuwe PV-optie zichtbaar. Bij beide nieuwe optimalisaties uit blijft de eerder vereiste legacy-terugval actief en zichtbaar. Opgeslagen oude instellingen blijven behouden. Alleen UI gewijzigd.

Geslaagd: 80 UI-combinaties inclusief zichtbaarheid oude/nieuwe PV-velden, instellingenopstart, runtime-audit (791 velden), DOM-opstart en syntaxcontrole. Regellogica en onafhankelijke regressies niet herhaald. Fysieke Homey-weergave niet getest. Versie blijft 1.2.7.

## Aanvulling: buitentemperatuurgrenzen

Geslaagd: 21 HVAC-testgroepen inclusief nieuwe grenzen bij verwarmen/koelen, directe afbouw, UIT/publicatie/hervatting, ontbrekende buitentemperatuur en ontbrekende aan/uit-toestemming; 150 legacy-vergelijkingen tegen 1.2.6. HVAC-UI met aanvullende grensvelden voor tien kanalen, instellingenopstart, runtime-audit (831 velden), instellingenvertalingen, flexible-loads en multi-flexible-loads; DOM-opstart en syntax/JSON-controles. Onafhankelijke EV-, batterij-, prijs-, nacht- en volledige regressiesuites overgeslagen; uitsluitend de HVAC-uitbreiding en instellingen zijn gewijzigd. Fysieke Homey, buitensensor en gekoppelde toestelrespons blijven praktijktests. Versie blijft 1.2.7.

## Aanvulling: bovenste uitschakelgrens en hysterese

22 HVAC-testgroepen geslaagd, met extra hoge/lage uitschakelgrens bij warmte en koeling, marges 0/1/2,5 °C, temperatuurbewegingen rond de grens, exacte vrijgavegrens en persistentie over herstart; bestaande 150 legacy-vergelijkingen behouden. Relevante UI-, instellingenopstart-, runtime-audit- (871 velden), vertaal-, flexible-loads- en multi-flexible-loads-tests geslaagd. Ook DOM-opstart, gewijzigde JS/inline-script-/JSON-syntax en ZIP-integriteit gecontroleerd. Onafhankelijke subsystemen en volledige regressiesuite overgeslagen. Geen fysieke Homey-/toesteltest. Versie blijft 1.2.7.

## Aanvulling: gespreide HVAC-initialisatie

Nieuwe migratietest controleert vijf pauzes van 2000 ms, geen vertraging bij volledige instellingen, behouden bestaande waarden, onderbroken schrijfactie en herstel, wijzigingen tijdens een pauze en de echte tweesecondentimer. De testharness modelleert uitsluitend deze nieuwe migratiepauze; andere regeltimers worden niet versneld of uitgevoerd. Geen bestaande tests verwijderd.

Geslaagd: 30 upgrades vanaf 1.2.6 met herstarts en strikte Flow-schema’s, replay van de loginstellingen, 22 HVAC-regressiegroepen met 150 legacy-vergelijkingen, settings-startup, settings-runtime-audit, settings-cache-1.0.12 en app-control, plus syntax/JSON- en ZIP-controles. Ook een upgrade met echte wandklokpauzes is uitgevoerd: zes groepen met ongeveer twee seconden tussen groepen en circa tien seconden totale extra wachttijd. Onafhankelijke suites en volledige regressiesuite overgeslagen; de wijziging beperkt zich tot initialisatie van HVAC 5–10. Werkelijke CPU-winst en Homey-procesbewaking zijn niet in de simulatie vastgesteld. Versie blijft 1.2.7.

## Aanvulling: periodiek opwarmen

Geslaagd: 24 HVAC-testgroepen, waaronder cheap-only doelpublicatie, geen houdtijd tijdens opwarmen, houdtijd vanaf gemeten doelbereik, pauzeren/herstellen over tariefwissels, voltooiing, volgende interval, buitenbegrenzing, herstartbehoud zonder meetellen downtime en terugname bij uitschakelen van de optie. De 150 legacy-vergelijkingen blijven geslaagd. Relevante HVAC-UI-, instellingenopstart-, runtime-audit- (911 velden), vertaal-, migratie-, flexible-loads-, multi-flexible-loads- en app-control-tests uitgevoerd; DOM-opstart en syntax/JSON-/ZIP-controles geslaagd. De runtime-audit is uitgebreid met het nieuwe helperbestand, zonder bestaande controles te verwijderen.

De volledige suite en onafhankelijke batterij-, nacht-, prijs-, Savings- en EV-planningregressies zijn overgeslagen. Geen fysieke Homey-, sensor- of HVAC-test. Praktijkfeedback en meetfrequentie blijven bepalend voor de getelde houdtijd; onderbrekingen worden conservatief behandeld. Versie blijft 1.2.7.

## Aanvulling: HVAC CPU en contextcadans

25 gerichte HVAC-testgroepen geslaagd inclusief productiecontexten op dezelfde/snelle en trage cadans; meterpredicaten mogen geen HVAC-instellingenprojectie bouwen en P1-observatie mag geen volledige instellingen/EV-feedback lezen. Bestaande leerscenario’s voeren de nieuwe leerbeoordeling expliciet tijdens de trage minuutpass uit; per-P1 afronding is volgens de nieuwe eis verwijderd. Alle bestaande verstorings-, duur-, herstart- en legacy-pariteitcontroles blijven aanwezig.

Ook geslaagd: performance-split-loop, performance-architecture, flexible-loads, multi-flexible-loads, settings-cache-1.0.12, ev-house-publication-1.2.5 (26 groepen) en instellingen-runtimeaudit. Gewijzigde JS/JSON-syntax, ongewijzigde Flow-contracten en ZIP-integriteit gecontroleerd. Onafhankelijke volledige batterij-/nacht-/prijs-/Savings-/EV-planningsuites overgeslagen. Geen fysieke Homey-CPUvergelijking uitgevoerd; geen garantie dat de waargenomen 1 procentpunt volledig door deze wijziging verdwijnt. De nieuwe code begrenst aantoonbaar de genoemde HVAC-routes. Versie blijft 1.2.7.

## Aanvulling: EV-timers naar trage context

Geslaagd: performance-split-loop, performance-architecture, flexible-loads, multi-flexible-loads, context-refresh-1.0.10, app-control, settings-startup, ev-context-delay-1.1.13 (20 scenario’s), ev-work-1.1.15 (22 scenario’s), ev-work-1.1.16 (9 scenario’s), ev-deadline-integration-1.1.17 (10 groepen), ev-deadline-planner-1.1.17 (14 groepen), planning-monitor-1.1.16 (6 scenario’s), ev-house-publication-1.2.5 (26 groepen), ev-grid-permission-1.2.5 en 25 HVAC-groepen met 150 legacy-vergelijkingen.

Bestaande timertests zijn aangepast aan de expliciet gevraagde nieuwe uitvoerroute: geen portfolio op de korte timer, wel uitvoering/consumptie bij de volgende echte trage context. Reeds aanwezige scenario’s voor transienten, gedeelde aanvragen, generatieherstel, stopveiligheid, mode/current/hybrid, onderlinge publicatievergrendeling en deadlinecorrectheid blijven behouden. De mutex-test start de onderliggende publicatie expliciet om gelijktijdigheid te blijven testen; de productie-heartbeat vraagt een context aan. De monitoringtest bewijst dat een EV-only-aanvraag geen beslissingen of scans uitvoert vóór een daadwerkelijke context. Geen bestaande tests verwijderd.

Gewijzigde JavaScript-/JSON-syntax, ongewijzigde Flow-definities/Athom-teksten en ZIP-integriteit gecontroleerd. Volledige suite en uitgebreide onafhankelijke batterij-, nacht-, Savings-, boiler- en widgetregressies overgeslagen. Deze wijziging raakt EV-scheduling; gerichte EV-/context-/veiligheidsregressies zijn daarom breed uitgevoerd. Fysieke Homey-CPUbelasting en laadpaalgedrag blijven praktijktests. Versie blijft 1.2.7.

## Aanvulling: HVAC-doelen tot 99 °C

Geslaagd: 27 gerichte HVAC-groepen inclusief 150 vergelijkingen met de 1.2.6-regeling, tarief/PV/na-PV-doelen voor alle tien kanalen, 5–99 °C begrenzing, publicatie en Flow-feedback van 55/99 °C voor kanalen 1–10, herstartbehoud en periodieke warmwaterdoelen met voltooiing van de houdtijd. Klassieke verwarmings-/koeldoelen en PV-afwijking worden eveneens op 99 °C begrensd.

Ook geslaagd: HVAC-UI, configured-flow-cards, output-tests (inclusief 99 °C en afwijzen van ongeldige waarden), settings-startup, settings-runtime-audit, multi-flexible-loads en app-control. Alle 110 relevante formuliervelden accepteren 55/98,5/99 °C en weigeren waarden boven 99 °C; DOM-opstart van de instellingen, gewijzigde JavaScript/inline-script/JSON-syntax en ZIP-integriteit gecontroleerd. De bestaande Flow-contracttest staat uitsluitend de twee gevraagde hogere maximumwaarden van actieve HVAC-feedbackkaarten toe; deprecated kaarten blijven exact gelijk.

De volledige suite en onafhankelijke uitgebreide EV-, batterij-, nacht-, Savings- en prijsregressies zijn overgeslagen: hun code is niet gewijzigd. Geen fysieke Homey- of warmwaterinstallatie getest; de ondersteunde doeltemperatuur van het gekoppelde toestel blijft installatieafhankelijk. Versie blijft 1.2.7.

## Aanvulling: keuze binnentemperatuur of buitentemperatuur

Geslaagd: 30 HVAC-regressiegroepen, inclusief 150 vergelijkingen met 1.2.6 bij de standaard binnenbron. Nieuwe dekking: alle tien kanalen, verwarmen onder 16 °C, koelen boven 25 °C, behoud van de actuele modus op/tussen grenzen, instelbare alternatieve grenzen, geen nieuwe modus in de neutrale band zonder bekende modus, voorrang van vaste richting, ontbrekende buitenfeedback, interval-/modusmachtiging, verouderd wachtend buitencommando, herstart en periodiek opwarmen tijdens buitenafhankelijk koelen. Ook de optionele buitenbron bij niet-permanente PV-activering getest.

HVAC-UI controleert 1920 combinaties van permanente opties, netbudget, richting en bron, naast bestaande scenario’s. Comfort-/activatievelden verbergen hun waarden niet uit de opslag; relevante velden blijven bereikbaar. DOM-opstart met tien kanalen controleert daadwerkelijk laden en opslaan van de gegroepeerde configuratie, afwijzen van ongeldige buitengrenzen, omschakelen van bron/richting/budget en geen extra schrijfactie bij opnieuw opslaan zonder wijzigingen.

Ook geslaagd: HVAC-migratie, settings-startup, settings-runtime-audit, settings-translations, settings-cache-1.0.12, multi-flexible-loads en app-control. De cachetest vond tijdens ontwikkeling een V8-prestatiegrens bij dertig extra losse instellingen. De definitieve configuratie bewaart de drie waarden per kanaal als één object. De bestaande cachecode en cachetest zijn ongewijzigd; de test slaagt weer met snelle eigenschappen. Geen bestaande regressietests verwijderd of versoepeld. Gewijzigde JavaScript-/inline-script-/JSON-syntax, ZIP-integriteit en behoud van versie, Flow-definities en Athom-teksten gecontroleerd.

De volledige suite en uitgebreide onafhankelijke EV-, batterij-, nacht-, Savings- en prijsregressies overgeslagen. De gedeelde cache-implementatie en scheduler zijn niet gewijzigd; relevante instellingen- en HVAC-afhankelijkheden zijn getest. Geen fysieke Homey-/HVAC-test of CPU-meting uitgevoerd. Versie blijft 1.2.7.

## Aanvulling: COP-gerelateerde tariefdoelen

Geslaagd: 33 HVAC-regressiegroepen, inclusief 150 vergelijkingen met 1.2.6 bij niet-permanente standaardregeling. Nieuwe dekking controleert de drie onafhankelijke tariefregels voor alle tien kanalen, zowel verwarmen als koelen, strikt onder/op/boven de grens, een grens van 0 °C en negatieve buitentemperaturen, ontbrekende feedback en onvolledige/ongeldige regels, de 99 °C-uitvoergrens, onmiddellijke verwarmingsverlaging, intervalgebonden herstel, herstartbehoud en het afwijzen van wachtende commando’s na gewijzigde buitenmeting of configuratie. PV, na-PV en periodiek opwarmen behouden aantoonbaar hun eigen prioriteit/doel.

Ook geslaagd: HVAC-UI inclusief gegroepeerde COP-opslag en alle zestig nieuwe velden, settings-startup, settings-runtime-audit, settings-translations, settings-cache-1.0.12, multi-flexible-loads en app-control. De DOM-proef controleert daadwerkelijk laden/opslaan van bestaande bronkeuze met COP-regels, geen schrijven zonder wijzigingen, afwijzen van halve veldparen en doelen boven 99 °C en uitschakelen door beide velden leeg te maken zonder de bronkeuze te veranderen. De ongewijzigde cachetest blijft geslaagd; deze feature voegt geen cachesleutels toe.

Gewijzigde JavaScript-/inline-script-/JSON-syntax, ZIP-integriteit en behoud van versie, Flow-definities en Athom-teksten gecontroleerd. Volledige suite en onafhankelijke uitgebreide EV-, batterij-, nacht-, Savings-, prijs- en widgetregressies overgeslagen. Geen migratietest herhaald: er is geen nieuw topniveau-instellingsveld of wijziging in de migratie; oude buitenregelobjecten zonder optionele COP-regels zijn getest. Geen fysieke Homey-/HVAC-, werkelijke COP- of besparingsmeting. Versie blijft 1.2.7.

## Aanvulling: gerichte correctie COP-publicatie

Gereproduceerde oorzaak: permanente vaste-richtingssturing behandelde ontbrekende/auto/uit-modusfeedback als een verplichte moduswissel. Zonder toestemming voor modusuitvoer werd ook het toegestane COP-setpoint geblokkeerd. De COP-opslag en keuze zelf bleken correct. De widget gaf ook na een geslaagde permanente COP-publicatie ten onrechte Wacht op overschot weer. De nieuwste log toont bovendien dat modussturing later werd aangezet; de precieze fysieke HVAC-invoer is niet in de log opgenomen. De codecorrectie richt zich op de bewezen blokkade en de statusfout; er is geen onbewezen COP-overschrijving aangepast.

Geslaagd: 35 HVAC-regressiegroepen inclusief 150 legacy-vergelijkingen met 1.2.6. De nieuwe volledige ketentest gebruikt echte TOU-tariefherkenning, de bestaande buitentemperatuur-Flow, de gewone berekening/publicatie en de configureerbare setpointtrigger: 180 publicaties over tien kanalen, drie tarieven, onder/op/boven de grens en beide vaste richtingen, met auto/uit/ontbrekende modusfeedback. COP-doelen 5, 55 en 99 °C worden exact gepubliceerd; bij/op/boven de grens geldt het juiste gewone tariefdoel. Er wordt geen verboden moduscommando gepubliceerd of als gepubliceerd geregistreerd.

Nieuwe veiligheidsdekking controleert behouden interval, budget, Peak Guard, buitenlimiet, bekende conflicterende modus ondanks oudere publicatiebevestiging, veranderd modusfeedback vóór publicatie en behoud van uitschakelen door buitengrens bij een modusconflict. De bestaande PV-/periodieke prioriteiten, weers-/configuratierevalidatie, feedback en herstartscenario’s blijven geslaagd.

Ook geslaagd: HVAC-UI met permanente/COP-/periodieke labels en echte wachtreden, multi-flexible-loads, app-control, settings-cache-1.0.12 en widget. JavaScript-, widget-inline-script- en JSON-syntax, ZIP-integriteit en behoud van versie, Flow-definities, Athom-teksten en overige productiecode gecontroleerd. De volledige suite en onafhankelijke uitgebreide EV-, batterij-, nacht-, Savings-, prijs- en migratieregressies zijn overgeslagen. Geen wijzigingen aan scheduler, cache, instellingenopslag, migratie, logging of achtergrondverwerking. Geen fysieke Homey-/HVAC-test; de log bevat onvoldoende HVAC-meet- en publicatiegegevens om elk waargenomen toestelgedrag achteraf te bewijzen. Versie blijft 1.2.7.
