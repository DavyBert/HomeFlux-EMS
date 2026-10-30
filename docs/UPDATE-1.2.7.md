# HomeFlux EMS 1.2.7

Basis: de laatst opgeleverde volledige 1.2.6-broncode, inclusief EV Insights in de Savings-Flow. De aangeleverde HVAC-uitbreiding is bovenop deze versie toegepast.

## Gebruik en regeling

Maximaal tien HVAC-kanalen hebben eigen naam, metingen, doelen, richting en leerwaarden. De bestaande configureerbare HVAC-Flow-kaarten selecteren ook kanaal 5–10. De oude genummerde kaarten blijven voor kanaal 1–4 bestaan; de IDs, overige argumenten en tokens blijven behouden. Alleen de maximumwaarden van de actieve configureerbare temperatuur- en setpointfeedbackkaarten zijn verruimd naar 99 °C; deprecated kaarten blijven ongewijzigd.

Permanent sturen staat standaard uit. Binnen deze optie zijn tariefdoelen en PV-doel onafhankelijk inschakelbaar. Alleen PV gebruikt het na-PV-doel; tarief plus PV valt terug op het actuele tariefdoel. Beide optimalisaties uit gebruikt de bestaande regeling. Verwarmen, koelen of automatisch kiezen zijn instelbaar. Gedeelde fysieke installaties kunnen via dezelfde groepsnaam aan één eigenaar volgens de bestaande prioriteiten worden toegewezen; de app kan fysieke koppelingen via generieke Flows niet zelf ontdekken.

De centrale matrix vergelijkt het gewenste doel met de laatst succesvol gepubliceerde waarde en modus. Verwarming verlagen en koeling verhogen worden direct gepubliceerd, ook wanneer de ruimte het doel al bereikt heeft. Verwarming verhogen, koeling verlagen en moduswisselingen worden gespreid: maximaal één vermogensverhogende wijziging per bestaand HVAC-regelinterval. Prioriteiten, verse P1-data, PV-marges en Peak Guard blijven bepalend. Wachtende wijzigingen worden opnieuw beoordeeld; mislukte publicaties worden niet als uitgevoerd opgeslagen. Publicatie betekent een geslaagde Homey-Flow-trigger en is geen fysieke ontvangstbevestiging van het toestel.

Een optioneel gezamenlijk budget beperkt de geschatte extra HVAC-netafname voor warmte- of koudeopslag. Huishoudelijk basisverbruik wordt niet tegen dit budget geboekt. Bestaande extra HVAC-vraag wordt conservatief gereserveerd. Noodzakelijk comfort passeert dit optionele budget, maar blijft aan Peak Guard gebonden. Zonder betrouwbare leerwaarde wordt een conservatieve vermogensraming gebruikt; het budget is geen afzonderlijk gemeten of gegarandeerd fysiek verbruikslimiet.

## Vermogensleren

De bestaande EV/P1-minuutreferentie levert zowel de uitgangssituatie als de vervolgmetingen; HVAC maakt geen tweede huishoudreferentie. Een succesvol gepubliceerd commando opent één observatie tot het volgende reguliere HVAC-moment. Voltooide minuutvakken worden eenmaal verwerkt, met begrensde opslag. Er is geen extra P1-, leer- of HVAC-observatietimer toegevoegd: bestaande meterinvoer en de bestaande samengevoegde contextscheduler volstaan.

Leren vereist dat alle geconfigureerde EV's aantoonbaar afgekoppeld zijn. Onbekend of aangesloten, ook met 0 A, blokkeert leren. Ontbrekende/verouderde P1 of PV, Hybrid-delegatie, niet-nul batterijcommando's, meetgaten, andere HVAC-wijzigingen of instabiele vermogenswaarden verwerpen de observatie. De stabiele eindfase bepaalt het extra vermogen, niet de startpiek. Korte intervallen onder vijf minuten leveren geen nieuwe waarde op; vijf minuten blijft standaard en minimaal aanbevolen voor warmtepompen.

Verwarmen en koelen bewaren afzonderlijke waarden en statussen, ook na herstart. Opnieuw evalueren bewaart het verzoek zonder het toestel te activeren; de oude waarde blijft zichtbaar maar wordt niet meer als betrouwbare budgetwaarde gebruikt totdat een geldige natuurlijke observatie slaagt. Ongeldige metingen vervangen een eerder betrouwbare waarde niet.

Dit blijft een vermogensschatting uit de bestaande huishoudreferentie. Gelijktijdige ongemeten huishoudelijke wijzigingen kunnen niet perfect aan HVAC worden toegeschreven. Een nul batterijcommando bewijst evenmin fysiek nul batterijvermogen; de app claimt geen aanvullende batterijmeting.

## Instellingen en widget

Instellingen tonen tien kanalen, conditionele tarief-/PV-velden, het globale extra budget en afzonderlijke verwarmings-/koelvermogens met herbeoordelingsknoppen. De bestaande EMS-widget heeft een standaard uitgeschakeld HVAC-overzicht per widgetinstantie: exact drie kolommen met toestel/statusiconen, laatst succesvol gepubliceerd doel en actuele temperatuur. Een wachtend of nog niet gepubliceerd PV-doel wordt niet groen. SVG-iconen volgen het thema; lange namen worden afgekapt. Woningreferentie heet in de gebruikersinterface nu Referentie.

HVAC-doeltemperaturen ondersteunen 5–99 °C, ook voor tarief/PV-sturing, terugval, klassieke verwarming/koeling, periodiek opwarmen en de output-test. De actieve configureerbare setpointfeedbackkaart ondersteunt 5–99 °C; temperatuurfeedback behoudt -20 °C als ondergrens en ondersteunt nu tot 99 °C. Deprecated kaarten blijven met hun bestaande grenzen behouden. Buitentemperatuurgrenzen en hysterese zijn niet verruimd.

README bevat alleen een korte optionele vermelding en release notes. De Athom-webteksten zijn onveranderd. Volledige gebruikersdocumentatie: https://github.com/DavyBert/HomeFlux-EMS/discussions/3

## Verificatie en resterende risico's

Zie VALIDATION-1.2.7.md en de twee HVAC-JSON-bestanden in validation. De tests dekken de centrale matrix, prioriteiten, tien dynamische kanalen, herstart, mislukte publicaties, budget, leren, UI en legacy-pariteit. EV-modussturing is via de gerichte publicatieregressie gecontroleerd. Onafhankelijke subsystemen zijn niet volledig opnieuw getest.

De Node-simulatie meet honderd echte portfolio-evaluaties: circa 157 ms CPU zonder HVAC en 251 ms met tien kanalen; vastgehouden heapverschil circa -28 kB respectievelijk +54 kB na garbage collection. Dit is geen fysieke Homey-meting en geen zuivere vergelijking met 1.2.6. Native browser- en Homey-weergave, fysieke toestellen en werkelijke CPU/geheugenbelasting blijven praktijktests.

## Optionele buitentemperatuurgrenzen

Per permanente HVAC-regeling zijn twee standaard uitgeschakelde grenzen beschikbaar, voor verwarmen en koelen. Boven de instelbare bovengrens geen verhoging van energievraag (verwarmen: hoger doel; koelen: lager doel; ook inschakelen/moduswisselen). Afbouw blijft beschikbaar. Onder de ondergrens stuurt HomeFlux UIT via de bestaande aan/uit-kaart, mits aan/uit-sturing is toegestaan. Zonder toestemming volgt een wachtreden, geen alternatieve modus of setpoint. De inschakeling van een uitschakelgrens is strikt: onder de ondergrens of boven de bovengrens. Een actieve blokkering gebruikt de ingestelde hysterese bij vrijgave.

De bestaande gedeelde buitentemperatuurinvoer is vereist als een grens actief is. Ontbrekende invoer blokkeert verhogingen; er wordt geen buitentemperatuur verondersteld en geen UIT gestuurd zonder meting. Een eerder succesvol door deze optie uitgeschakeld toestel kan weer aan zodra de temperatuur en overige voorwaarden dit toelaten, via het bestaande interval, prioriteiten en energiemarges. De uitschakelstatus blijft bewaard na herstart. De bovengrens voert geen reeds gepubliceerde verhoging terug. Geen nieuwe Flow-kaarten of timers.

### Boven- en ondergrens met hysterese

Uitschakelen boven buitentemperatuur is optioneel toegevoegd. Beide uitschakelgrenzen hebben een eigen hysterese van standaard 1 °C, instelbaar van 0 tot 10 °C. Na UIT onder 5 °C wordt de onderblokkering bij 1 °C hysterese pas vrijgegeven vanaf 6 °C. Na UIT boven 25 °C wordt de bovenblokkering pas vrijgegeven vanaf 24 °C. Bij overlappende grenzen moeten beide blokkeringen vrijgegeven zijn. Hervatten vereist daarnaast de bestaande interval-, energie- en prioriteitsvoorwaarden. De oorzaak van een succesvol gepubliceerd UIT-commando wordt bewaard, zodat de hysterese ook na herstart geldt. De optie voor alleen geen extra energievraag boven een grens blijft afzonderlijk beschikbaar.

## Gespreid aanmaken van extra HVAC-instellingen

De ontbrekende standaardinstellingen voor HVAC 5–10 worden per kanaal opgeslagen, met twee seconden asynchrone pauze tussen kanalen. Bij zes ontbrekende kanalen zijn dit vijf pauzes, samen circa tien seconden extra eerste opstarttijd. Dit gebeurt vóór de normale Flow-registratie en regeling. Bestaande waarden worden behouden, ook wanneer ze tijdens een pauze zijn opgeslagen. Een afgebroken upgrade vult bij de volgende start alleen nog ontbrekende waarden aan. Als alle waarden aanwezig zijn, zijn er geen pauzes. Dit voegt geen periodieke regel- of P1-timer toe. Het spreidt de schrijfacties; de gemelde Homey-crash is hiermee niet bewezen verklaard of opgelost.

## Periodiek opwarmen tijdens dalmomenten

Per permanente HVAC-regeling: standaard uit, elke 1–365 dagen, 0,1–48 uur op temperatuur houden en een doel van 5–99 °C. Standaard 7 dagen, 1 uur en 30 °C.

Dal betekent de goedkope tariefklasse van HomeFlux (cheap), ook bij dynamische contracten. Normaal en duur zijn niet toegestaan voor deze cyclus. Bij drie TOU-prijzen is dit alleen de goedkoopste klasse; een middelste tarief met de naam Dal is niet automatisch cheap. De eerste cyclus wordt bij de eerstvolgende goedkope gelegenheid aangevraagd; daarna loopt de periode vanaf het voltooien van de vorige cyclus (dagen van 24 uur).

De duur telt pas vanaf een succesvol gepubliceerd opwarmdoel én gemeten temperatuur op of boven het doel (met dezelfde 0,25 °C tolerantie als het overzicht). Opwarmtijd telt niet mee. De houdtijd loopt alleen tijdens cheap, met temperatuurfeedback van hoogstens vijf minuten oud. Bij een lagere temperatuur, onvoldoende verse feedback of buiten cheap pauzeert de teller. De telling gebruikt de bestaande evaluaties en telt ontbrekende observatiegaten conservatief niet mee. Bij uitschakeling door buitengrenzen telt geen houdtijd door. Dit meet beschikbare temperatuurfeedback, niet fysiek bevestigd continu verwarmingsvermogen.

De cyclus vraagt verwarmingsmodus aan, ook als de normale regeling koelt; een noodzakelijke moduswissel vereist bestaande toestemming. Buiten cheap, bij voltooiing of uitschakelen van de periodieke optie gaat het doel terug naar de gewone regeling. Een verwarmingsdoel wordt eerst veilig teruggenomen voordat een latere koelmodus wordt overwogen. Peak Guard, het optionele extra netbudget, gedeelde-installatie-eigenaars, prioriteiten, gespreide activering en buitengrenzen blijven gelden. De normale oude regeling blijft beschikbaar wanneer alle permanente optimalisaties en de periodieke optie uit zijn; een nog toegepast periodiek doel wordt eerst teruggenomen.

Voortgang en voltooiing worden compact in de bestaande HVAC-runtimeopslag bewaard. Downtime na herstart telt niet als houdtijd. Er is geen nieuwe P1- of periodieke timer: de cyclus wordt alleen tijdens de bestaande trage contextcadans gecontroleerd, inclusief vervolgstappen en het volgende vervalmoment.

## HVAC alleen op de trage contextcadans

Analyse van de CPU-routes: vermogensleren gebruikte op ieder P1-bericht safeMeter (inclusief een volledige instellingenkopie en EV-controle) en een scan van bestaande minuutvakken. Periodiek opwarmen vroeg per berekening een eigen context aan (bij actieve cyclus om de minuut en anders voor het vervalmoment). Ook een vervroegde volledige context voor EV of invoer herberekende de volledige HVAC-portfolio. Dit zijn concrete extra kosten; zonder vergelijkbare fysieke metingen is niet bewezen welk aandeel ze hebben in de gemelde stijging van circa 1 procentpunt.

P1 bewaart nu uitsluitend korte observatiegegevens bij een actieve leermeting: de laatste meettijd en een onbetrouwbaarheidsvlag bij een meetgat, batterijcommando of ontbrekende PV. Geen instellingenkopie, EV-lus, minuutvakscan, leerresultaat, opslag of scheduler-aanvraag in die route. De gewone EV/P1-huisreferentie blijft de bron. De trage HVAC-pass verzamelt beschikbare minuutvakken, beoordeelt de observatie en bewaart het resultaat.

HVAC-besluiten worden vanuit normale productiecontexten hoogstens eenmaal per ingestelde trage EMS-cadans berekend. Vroege EV-/invoercontexten hergebruiken het vorige HVAC-besluit. De bestaande heartbeat vraagt een gewone trage context aan wanneer actieve HVAC-kanalen aan de beurt zijn. Periodiek opwarmen, publicatieherstel en het globale HVAC-stuurinterval maken geen eigen HVAC-wake-ups meer. De intervalgrens wordt tijdens de volgende trage context gecontroleerd; uitvoering kan daardoor tot één contextperiode later zijn. De houdtijd ondersteunt ook een contextcadans langer dan een minuut, zonder downtime mee te tellen.

Bestaande urgente veiligheidscontexten voor Peak Guard en legacy fast reset blijven mogelijk. Deze lopen door de bestaande contextregeling; de snelle batterij-/P1-route publiceert zelf geen HVAC-besluit. De ingestelde HVAC-uitvoerintervallen en prioriteiten blijven naast de trage contextcadans gelden. Instellingenpredicaten voor metercontext lezen uitsluitend de relevante Enabled-waarden, zonder per HVAC een grote instellingenprojectie te maken.

## EV-berekeningen via trage context

De EV-heartbeat en uitvoertimers roepen geen afzonderlijke EV-portfolio meer aan. refreshEvOnlyContext vraagt nu uitsluitend de bestaande gedeelde context aan. Ook het verlopen van de vijftienseconden-debounce voor meter-/feedbackwijzigingen markeert alleen een aanvraag voor die context. De werkelijke contextpass verbruikt de aanvraag; een timer wist deze niet voortijdig. Hierdoor worden geen tariefscans of EV-beslissingen uitgevoerd door die timer zelf.

Gewone EV-bijsturing kan daardoor tot de volgende ingestelde trage cyclus wachten. De bestaande directe veiligheidscontexten voor Peak Guard, ontkoppelen en relevante Flow-/moduswijzigingen blijven behouden. De bestaande EV-deadlinewakeup vraagt een grenscontext aan om deadlines niet door de gewone wachttijd te missen. De bestaande fysieke revalidatie, onderlinge EV-vermogensverdeling, minimale uitvoerintervallen en validatie na asynchrone publicatie blijven binnen de context-/uitvoerketen actief.

De EV-only-route neemt zelfstandig geen runtime-tarief meer op en bouwt geen portfolio. Reguliere contextberekeningen en uitvoerrevalidatie kunnen nog afzonderlijke EV-berekeningen binnen dezelfde contextketen opleveren; dit zijn geen onafhankelijke timerevaluaties. De monitor noemt de normale uitvoerroute nu context_output en telt aanvragen als evSlowContextRequests en evHeartbeatContextRequests. Er zijn geen nieuwe timers of Flow-kaarten toegevoegd. De werkelijke Homey-CPUwinst is niet gemeten.

## HVAC-temperaturen tot 99 °C

Alle tien HVAC-kanalen ondersteunen de hogere doeltemperatuur van maximaal 99 °C voor warmwatersturing. De halvegraadsstappen en de bestaande minimumtemperaturen blijven behouden. Tarief/PV-doelen, periodiek opwarmen, gewone doelen en output-tests gebruiken dezelfde nieuwe bovengrens. Actieve configureerbare Flow-feedback voor temperatuur en setpoint ondersteunt eveneens 99 °C; bestaande kaartidentiteiten, tokens en deprecated kaarten blijven behouden. Deze wijziging maakt geen nieuwe timer of contextaanvraag. De fysieke installatie kan een eigen lagere temperatuurgrens hebben.

## Conditionele comfort- en activatievelden

Bij actieve permanente sturing toont de instellingenpagina alleen relevante comfort- en activatievelden. Zonder extra HVAC-netbudget of periodiek opwarmen zijn de gewone comfortdoelen niet nodig voor de permanente tarief/PV-regeling en worden ze verborgen. Bij automatische regelrichting op binnentemperatuur blijven de binnenactivatiegrenzen zichtbaar voor de keuze tussen verwarmen en koelen; bij buitentemperatuur worden de afzonderlijke buitengrenzen getoond. Bij een vaste permanente richting zijn beide keuzes verborgen. Zonder zichtbare velden verdwijnt het volledige blok. Een aangepaste titel en uitleg verduidelijken de betekenis voor permanente sturing.

Het extra netbudget en periodiek opwarmen houden de comfortdoelen zichtbaar, omdat de bestaande regeling ze gebruikt als basis voor extra vermogen, gewone doelen en herstel. Permanent aan zonder actieve tarief/PV/periodieke optie gebruikt nog de oude regeling en behoudt daarom het volledige blok. Wijzigen van de opties, richting of het globale netbudget werkt de zichtbaarheid direct bij. Verbergen bewaart de bestaande waarden; de sturingslogica is niet gewijzigd.

## Binnen- of buitentemperatuur voor de regelrichting

Per HVAC-kanaal kan de automatische richting kiezen op binnentemperatuur (bestaande werking, blijft de standaard) of buitentemperatuur. De aparte buitengrenzen zijn instelbaar van -50 tot 70 °C met stappen van 0,5 °C; verwarmen onder 16 °C en koelen boven 25 °C zijn de standaardwaarden. De verwarmingsgrens moet lager zijn dan de koelgrens. Op de grenzen en daartussen behoudt permanente sturing de actuele modus, of de laatst gepubliceerde modus wanneer geen actuele modus bekend is. Wanneer in deze tussenband nog geen verwarmings-/koelmodus bekend is, wacht de regeling op een grensoverschrijding of modusfeedback. Dit voorkomt dat de bereikte comforttemperatuur de buitenafhankelijke richting vastzet. De ruimtetemperatuur blijft nodig voor comfort-/budgetbeoordeling en periodieke houdtijd.

De uitleg vermeldt dat binnentemperatuur bedoeld is voor niet-permanente PV-overschotsturing. Buitensturing kan eveneens voor de activatie van de niet-permanente PV-regeling gekozen worden; zonder overschot start deze regeling niet. Een vaste verwarmings-/koelrichting heeft bij permanente regeling voorrang op de bronkeuze. Tussen de buitengrenzen start de oude PV-regeling geen nieuwe cyclus; een bestaande cyclus volgt de bestaande stop-/comfortregels.

De bestaande gedeelde buitentemperatuur-Flow levert de meting voor alle kanalen. Ontbrekende buitenfeedback blokkeert nieuwe normale vermogensverhogingen bij automatische permanente buitensturing; noodzakelijke verlagingen blijven beschikbaar. Een gewijzigde buitenmeting invalideert een nog wachtend buitenafhankelijk permanent commando vóór publicatie. Bestaande buitengrenzen voor uitschakelen/geen extra vraag blijven onafhankelijk gelden. Periodiek opwarmen vraagt tijdelijk verwarmingsmodus, ook wanneer de buitenregeling koelen zou kiezen, en behoudt de bestaande toestemming, planning en beveiligingen.

De berekeningen blijven in de bestaande HVAC-pass van de trage context; geen nieuwe timer of continue evaluatie. De nieuwe instellingen worden met de bestaande upgrade-aanpak aangemaakt; reeds opgeslagen instellingen en de 99 °C-doelen blijven behouden. Versie blijft 1.2.7.

De drie nieuwe bron-/grenswaarden worden per kanaal als één object opgeslagen. Zo blijft de bestaande V8-instellingencache in zijn snelle vorm; de cachecode zelf is niet veranderd.

## COP-gerelateerd koudweerdoel per tarief

Bij de permanente tariefdoelen heeft elk HVAC-kanaal per goedkoop/normaal/duur tarief twee optionele velden: een buitentemperatuurgrens (-50 tot 70 °C) en een alternatief doel (5 tot 99 °C). Beide zijn standaard leeg, zodat de bestaande werking behouden blijft. Beide moeten samen worden ingevuld of leeggemaakt. Bij twee TOU-tarieven worden alleen laag en hoog getoond, inclusief hun eigen COP-velden; het opgeslagen normale tarief blijft bewaard.

Wanneer de bekende gedeelde buitentemperatuur strikt lager is dan de gekozen grens, wordt voor dat tarief het alternatieve doel gebruikt. Voorbeeld: gewoon doel 23 °C, COP-grens 6 °C, aangepast doel 21 °C: onder 6 °C wordt 21 °C gekozen; vanaf 6 °C geldt weer 23 °C. Zonder buitenfeedback of bij een onvolledige/ongeldige configuratie blijft het gewone tariefdoel gelden. Dit is een door de gebruiker ingestelde correctie voor koudere omstandigheden, geen berekening of meting van de werkelijke COP. Het alternatief geldt voor het tariefdoel in de gekozen verwarmings-/koelmodus; de COP-optie verandert die modus niet.

PV-overschot gebruikt zijn bestaande PV-doel. Het na-PV-doel zonder actieve tariefsturing blijft behouden. Periodiek opwarmen heeft voorrang en houdt zijn eigen doel; de terugname gebruikt de bestaande herstelroute. Buitentemperatuurbeveiligingen, Peak Guard, extra netbudget, toestemming, prioriteiten en de bestaande regelintervallen blijven gelden. Verlaging van een verwarmingsdoel kan direct; een verhoging bij terugkeer naar het gewone doel volgt het normale interval. Een buitenverandering invalideert een nog wachtend COP-afhankelijk commando vóór publicatie.

De velden worden samen met de bestaande buitenregelconfiguratie per HVAC opgeslagen. Er komen geen extra sleutels in de snelle instellingencache en geen extra timers of evaluaties buiten de trage HVAC-context. Oude opgeslagen configuraties zonder COP-velden blijven bruikbaar. Versie blijft 1.2.7.

## Correctie COP-publicatie bij alleen-setpointsturing

De COP-keuze wordt na de gewone tariefkeuze toegepast en vóór publicatie opnieuw gevalideerd. Een replay van de logconfiguratie bevestigde dat de opgeslagen Piek-regel (buiten onder 40 °C, doel 5 °C) correct wordt gelezen. Er is geen onbedoelde overschrijving door de gewone tariefstreefwaarde vastgesteld. De bestaande grens van 5–99 °C blijft behouden; oude comfort-/activatiegrenzen begrenzen dit permanente COP-doel niet.

Wel gereproduceerd: bij vaste verwarmings-/koelrichting, toegestane setpointsturing en uitgeschakelde modussturing kon onbekende/auto/uit-modusfeedback ten onrechte een verplichte moduswissel veroorzaken en daardoor het setpoint blokkeren. Alleen in deze vaste richting mag nu het setpoint gepubliceerd worden zonder een niet-toegestaan moduscommando. Een bekende tegengestelde verwarmings-/koelmodus blijft geblokkeerd, ook bij een oudere publicatiebevestiging of bij gewijzigde feedback vóór publicatie. Automatische richtingswissels en periodiek omschakelen vanuit een tegengestelde vaste richting behouden hun bestaande toestemmingseis.

Ontbrekende moduszekerheid blijft conservatief als een vermogensverhoging behandeld: regelinterval, prioriteiten, Peak Guard, netbudget, verse P1-data en buitengrenzen worden niet overgeslagen. Een setpointcommando is geen fysieke aan/uit- of modusbevestiging. PV- en periodieke doelen behouden hun bestaande prioriteit. De wijziging voegt geen timer, logging of achtergrondtaak toe.

De widget had daarnaast een concrete weergavefout: niet-herkende permanente statussen vielen terug op Wacht op overschot, zelfs na geslaagde COP-publicatie. Permanente sturing toont nu het COP-doel, periodiek opwarmen, permanente temperatuursturing of de bestaande echte wachtreden. De oude niet-permanente PV-weergave blijft behouden.

De diagnoselogs bevatten de COP-waarden in configuratiewijzigingen, maar geen volledige HVAC-invoer-/uitvoerhistoriek. Daardoor is niet bewezen welke feedback op elk moment op het fysieke toestel aanwezig was. De correctie richt zich op de aantoonbaar gereproduceerde blokkade en de onjuiste statusweergave. Versie blijft 1.2.7.
