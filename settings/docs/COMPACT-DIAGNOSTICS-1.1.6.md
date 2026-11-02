# HomeFlux EMS 1.1.6 – compacte diagnostiek en EV-beslisinformatie

## Uitkomst

Gebaseerd op de geleverde 1.1.5. Het oorspronkelijke app.js is bytegelijk gecontroleerd tegen HomeFlux-EMS-v1.1.5.zip. Alleen diagnostiek, bijbehorende helptekst, tests en release-/versiegegevens zijn aangepast.

De bestaande batterij- en EV-regeluitkomsten blijven behouden in de uitgevoerde vergelijkingen. Deze wijziging stelt geen oorzaak vast voor de eerder gemelde batterijontlading tijdens EV-laden. Ze maakt een volgende diagnose daarvan beter mogelijk.

## Settingshistoriek

De oude route kopieerde en serialiseerde bij ieder geregistreerd planningsmoment alle settings om wijzigingen te herkennen. Bij één gewijzigde instelling werd opnieuw een volledige configuratie opgeslagen. De export bevatte bovendien nog een volledige currentSettings-kopie.

1.1.6 legt bij de start van Planning-diagnostiek één uitgangssnapshot vast. Daarna melden de bestaande interne settingswrite en externe settingscachelistener uitsluitend de gewijzigde sleutel aan de recorder. Herhaalde gelijke waarden worden per sleutel onderdrukt. Arrays worden als gewijzigde waarde van hun sleutel opgeslagen; er is geen volledige settingskopie bij iedere planningpass, settingsread of P1-update.

Een expliciet verwijderde sleutel wordt via removed gerepresenteerd. Settings die door de productiecache op een bestaande standaardwaarde terugvallen, worden als die effectieve standaardwaarde vastgelegd. Gevoelige waarden blijven afgeschermd. Prijsslotarrays en diagnostieksettings worden uitgesloten.

De uitgangstoestand wordt opnieuw opgebouwd bij een appherstart of reset van het rapport. Als Planning later aansluit bij een al actieve CPU-diagnosesessie, wordt de bestaande eindtijd niet verlengd. Bij tijdelijk uitgeschakelde Planning worden tussenliggende settingswijzigingen eenmaal gereconcilieerd wanneer Planning weer wordt ingeschakeld.

## Diagnoseformaat en reconstructie

Het rapport gebruikt **homeflux-diagnostics-v2**. De ingebouwde UI toont de JSON-export en is gecontroleerd; zij vereist geen oude currentSettings-structuur. Externe lezers die specifiek v1-settingsnapshots verwachten moeten het nieuwe formaat ondersteunen.

- planning.configurationFormat is snapshot-and-changes-v1.
- planning.configurations begint met kind=snapshot en settings.
- Volgende records hebben kind=changes, changes, removed en previousId.
- Pas changes toe op de vorige toestand en verwijder daarna de sleutels uit removed.
- planning.currentConfigId verwijst naar de laatst vastgelegde configuratie.
- Planning- en EV-gebeurtenissen hebben een configId voor de bijbehorende configuratie.

Er blijven maximaal 50 configuratierecords behouden. Bij afkapping wordt de volgende revisie een nieuwe volledige basis. Gebeurtenissen die naar de vervallen configuratie verwijzen worden verwijderd en meegeteld. Zo blijft iedere behouden configuratieverwijzing reconstrueerbaar; er ontstaat geen onbeperkte afhankelijkheidsketen.

De bestaande planningbuffer blijft begrensd op 600 records. De nieuwe gecombineerde EV-/batterijgebeurtenissenbuffer bevat maximaal 600 records. Het rapport vermeldt verwijderde gebeurtenissen/configuraties. Eerdere aanvraag-ID's kunnen door bufferafkapping buiten het venster vallen; publicatie-uitkomsten bevatten daarom ook hun commandowaarden en requestRetained.

## Nieuwe EV-informatie

Nieuwe gegevens worden alleen verzameld wanneer de bestaande optie Planning-diagnostiek actief is. Er zijn geen nieuwe schakelaars of timers.

- ev_decision: relevante wijziging van toestemming, laadmodus/-stroom, doel, deadline, tarieftoestemming, actieve garantie, PV/net/batterijverdeling, feedbackgeldigheid of wacht-/veiligheidstoestand.
- ev_portfolio_budget: gedeeld PV-/netbudget, netlimiet, Peak Guard-budget, garantieaandeel en batterijcommandotoestand. EV-beslissingen verwijzen naar dit gedeelde record.
- ev_grid_allowance_transition: overgang in de vrijstelling voor EV-netverbruik zoals de bestaande batterijregeling die toepast, inclusief waiting_response en herstel van terugkoppeling.
- ev_command_request, waiting en publishing: koppeling tussen aanvraag, interval/mutex en publicatiepoging.
- ev_command_component_published, published en failed: afzonderlijke stroom-, modus- en toestemmingsuitkomsten, inclusief gedeeltelijke publicaties en mislukte pogingen.
- battery_command_requested, published en failed: batterijcommando's met de door de bestaande engine gebruikte P1-regelwaarde en bron, zodat compensatie van EV-verbruik onderzocht kan worden.

De beslisrecords bevatten ontvangen laadstroom, tijdstip/ouderdom/geldigheid van die feedback, actuele P1/PV, doel, deadline, tarief-/garantieflags, Peak Guard-/stroomlimieten en verdeling over PV, net, expliciete batterijondersteuning en nachtoverschot. De laatste werkelijke toepassing van een batterijmeetdoel heeft een eigen tijdstip; dit wordt niet voorgesteld als een nieuwe preview van de EV-beslissing.

Berekende, aangevraagde, lopende en succesvol gepubliceerde waarden blijven onderscheiden. Batterijvermogens in deze velden zijn uitdrukkelijk commando's, geen gemeten of door de hardware bevestigde vermogens. Een geslaagde publicatie betekent dat de bestaande Homey-token-/Flow-route voltooid is; het is geen fysieke laadbevestiging.

## Belasting begrenzen

De recorder voert geen nieuwe vermogensverdeling, tariefselectie, planning of EV-netvrijstellingsberekening uit. De bestaande getEvaluationState-route levert haar al berekende vrijstellingsstatus aan. Op die route worden alleen een referentie en enkele scalars bijgehouden en een compacte overgangssignatuur vergeleken; een uitgebreid record wordt uitsluitend bij een relevante overgang gemaakt.

Ruwe P1-fluctuaties vormen geen eigen logtrigger. Stabiele heartbeats/beslissingen worden samengevat met repeats en lastObservedAt. Voor diagnostische numerieke allocatiewijzigingen geldt een resolutie van 100 W; dit verandert geen gevoeligheid, afronding of deadband van de regeling. Commandowijzigingen en hun deelpublicaties blijven exact vastgelegd. Verlopen en herstelde feedback blijft zichtbaar, ook als een commando niet verandert.

Geen extra timers, polling, regelpasses, nieuwe instellingen, Flow-kaarten of permanente logging. De bestaande engines onder lib, drivers, widgets en locales zijn bytegelijk gebleven. Het appmanifest is gelijk afgezien van het versienummer. De bestaande UI-velden en Flow-kaarten zijn behouden.

## Tests

- **npm run check: 56 testsuites en syntaxcontroles geslaagd.** Omvat de eerdere settingscache-, PV-live-, actieve laadregeling-, bronwissel-, nachtmediaan- en zelfstandige EV-regressies.
- **37 nieuwe gerichte checks** via werkelijke startup, settingscache/listener, plannings-/EV-/publicatieroutes. Homey-I/O, klok en fysieke terugmeldingen worden gesimuleerd.
- Settings: één basis, gelijke writes, scalaire/arraywijzigingen, verwijderingen en afscherming, geen herhaalde snapshots, reconstructie, 50-configuratiegrens, 600-eventgrens, reset/herstart en tijdelijk uitschakelen/heraansluiten.
- EV: 0/4 batterijen × batterij-uitvoer aan/uit × current/mode/hybrid; start/stop, verlopen/herstelde stroomfeedback, tariefverbod/herstel, PV-budget, Peak Guard, meerdere EV's, interval/mutex, gedeeltelijke mislukking, retry en overlappende aanvragen. Uitgeschakelde diagnostiek maakt geen recorder of settingsnapshot aan.
- **1.000 stabiele P1-updates met kleine fluctuaties:** geen extra EV-gebeurtenissen, settingsnapshots of commandopublicaties.
- **28 bestaande EV-replays tegenover 1.1.5:** de volledige vastgelegde resultaten zijn exact gelijk, inclusief individuele EV-/batterij-/Split-commando's, volgorde/tijdstippen, contextmomenten en eindtoestanden.
- **6 zon/net- en 13 laadreplays tegenover 1.1.5:** individuele commando's en timing gelijk, evenals de vastgelegde evaluatie-, planning- en publicatiecounters.
- Een aparte productiecache-replay met 30 settingswijzigingen vergelijkt 1.1.5, 1.1.6 en uitgeschakelde diagnostiek. Individuele commando's, timing, contextuitvoering en timers zijn gelijk. Ook de counters van de ingeschakelde versies zijn gelijk.

## Metingen

Scenario: vijf minuten gesimuleerde EV-werking na opwarming, 300 P1-updates en 30 settingswijzigingen. De CPU-run schakelt aanvullende test-traceregistratie uit. Elke herhaling draait in een apart proces; de uitvoervolgorde wisselt. Exportserialisatie valt buiten het gemeten CPU-interval. De gewone productie-diagnostiek blijft onderdeel van de meting.

| Maatstaf | 1.1.5 | 1.1.6 |
|---|---:|---:|
| Volledige settingsnapshots in historiek | 31 | 1 |
| Settingshistoriek, compacte JSON | 550.545 bytes | 23.592 bytes |
| Volledige export, ingesprongen JSON | 907.165 bytes | 158.765 bytes |
| EV-/batterijgebeurtenissen in deze replay | 0 | 14 |
| Proces-CPU, mediaan van 7 geïsoleerde herhalingen | 339,802 ms | 338,515 ms |
| Proces-CPU, minimum–maximum | 315,945–351,040 ms | 305,929–342,824 ms |

De settingshistoriek is in deze replay **95,7% kleiner**; de totale export is **82,5% kleiner**, inclusief nieuwe EV-informatie. De CPU-mediaan verschilt slechts 0,4% met overlappende spreiding: **geen overtuigend aangetoonde CPU-winst**. Met uitgeschakelde diagnostiek was de CPU-mediaan 329,025 ms. Dit zijn container-procesmetingen met process.cpuUsage(), geen Homey-CPU-percentages of bewijs van een gewijzigde regelreactietijd. Er is geen Homey-installatie of publicatie uitgevoerd.

## Bestanden en reproductie

- Productie: app.js, lib/compact-diagnostics.js, bestaande diagnostiekhelptekst en EN-vertaling.
- Tests: test/diagnostics-1.1.6.test.js; enkele oude assertions volgen nu het expliciete v2-formaat en 1.1.6-versienummer.
- npm run check
- node test/diagnostics-1.1.6.test.js
- node test/diagnostics-1.1.6.test.js --replay /pad/naar/build --cpu-only

Bijgevoegd zijn testlogs, vergelijkingstabellen, zeven benchmarkherhalingen, het vergelijkings-/benchmarkscript en een gesimuleerd voorbeeldrapport. Dat voorbeeld bevat feedbackverval en herstel; het is niet de eerder gemelde gebruikersinstallatie.
