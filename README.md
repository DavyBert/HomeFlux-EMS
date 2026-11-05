# HomeFlux EMS

**Your energy, managed differently**

HomeFlux EMS manages home batteries around your tariff, PV forecast, self-consumption and grid limits. Connect your hardware through Homey Flow cards.

## Quick start

1. **Configure HomeFlux**  
   Set your battery count, capacity, power limits, energy contract and Peak Guard limit in Settings. For dynamic prices, select the available price source(s).

2. **Supply the basic inputs through Flow**  
   Connect **Set grid and phase powers** (total power is required; phase values are optional; existing **Set grid power** Flows remain supported), **Set PV power** and **Set battery SoC**. For battery planning, also connect **Set remaining PV forecast** and **Set tomorrow PV forecast**. P1 uses positive = import, negative = export, always relative to 0 W. An external dynamic price source additionally needs **Read external prices JSON**.

3. **Connect and enable battery output**  
   Connect **Battery commands are updated** to your battery integration. For batteries needing separate modes and power values, enable Split Command and use **Battery: switch to charge/discharge mode** and **Battery: charge/discharge power is updated**. Run the **100 W charge test** in Settings, verify the battery response and confirm success, then enable **EMS output active**.

An optional, on-demand battery response test helps choose the command interval and P1 averaging. It does not replace the charge/discharge test.

The core battery control and planning can now run. Optional day/night planning maxima limit planned grid charging; PV capture and Safety SoC recovery remain available. Optional night hysteresis and a fixed 00:00–02:00 PV forecast median can stabilize night planning; both are off by default.

The optional Charging strategy tab offers spread charging with a power correction, or maximum safe charging from the start, as late as possible with a 15-minute reserve, or centred on the cheapest interval. For variable prices, centring is used only if the full block is cheaper than the standard spread plan. Day/night and annual/seasonal settings are independent.

Optional phase monitoring can also limit current/Hybrid EV charging, with selectable battery/EV priority.

Optional features include EV charging and its dashboard widget, HVAC with up to 10 channels, optional direct/parallel tariff and PV control and shared heat sources, boiler control, Hybrid EMS integration, sunshine reserves, multi-battery efficiency optimization, Autotune, Savings history and CSV export. Savings categories, totals and EV Insights can also be read through Flow for a chosen number of days, weeks, months or years.

For the complete functionality, configuration and all Flow cards, see:  
https://github.com/DavyBert/HomeFlux-EMS/discussions/3

---

## Release notes

### 1.2.30

Fasebewaking laat het beschikbare batterijlaadvermogen direct toe, zonder extra opschaling in stappen van 100 W. Batterij en EV benutten herstelde faseruimte met behoud van de gekozen prioriteit en zonder onbevestigde laadruimte dubbel te gebruiken.

Phase monitoring allows the available battery charging power immediately, without an extra 100 W ramp. Battery and EV charging use restored phase capacity while respecting the selected priority and avoiding double use of unconfirmed capacity.

La surveillance des phases autorise immédiatement la puissance de charge disponible, sans progression supplémentaire par pas de 100 W. Batterie et VE utilisent la capacité rétablie selon la priorité choisie, sans compter deux fois une capacité non confirmée.

La supervisión de fases permite de inmediato la potencia de carga disponible, sin una subida adicional en pasos de 100 W. La batería y el VE aprovechan la capacidad recuperada según la prioridad elegida, sin contabilizar dos veces capacidad sin confirmar.

Die Phasenüberwachung gibt die verfügbare Batterieladeleistung sofort frei, ohne zusätzliche 100-W-Schritte. Batterie und EV nutzen wieder verfügbare Phasenkapazität gemäß der gewählten Priorität, ohne unbestätigte Kapazität doppelt anzurechnen.

### 1.2.29

Optionele fasebewaking begrenst nu ook EV-laden op ampère en Hybrid. Kies Batterij eerst laden (standaard), Verdelen of EV eerst laden. EV-terugkoppeling krijgt tijd; tijdens het wachten kan de batterij tijdelijk meer afbouwen. Live fasewaarden worden stabieler weergegeven met behoud van hun echte meettijd.

Optional phase monitoring now also limits current and Hybrid EV charging. Choose Battery first (default), Share or EV first. EV feedback is given time; the battery can temporarily reduce charging further while waiting. Live phase readings display more consistently while retaining their actual measurement time.

La surveillance facultative des phases limite aussi la charge VE en ampères et Hybrid. Choisissez Batterie en priorité (par défaut), Répartir ou VE en priorité. Le retour du VE dispose du temps nécessaire ; la batterie peut temporairement réduire davantage sa charge. L’affichage des phases est plus stable et conserve l’heure réelle des mesures.

La supervisión opcional de fases también limita la carga del VE por amperios y Hybrid. Elija Batería primero (predeterminado), Repartir o VE primero. Se da tiempo a la respuesta del VE; la batería puede reducir temporalmente más su carga. Las lecturas de fase se muestran de forma más estable y conservan su hora de medición real.

Die optionale Phasenüberwachung begrenzt jetzt auch EV-Laden nach Ampere und Hybrid. Wählbar sind Batterie zuerst (Standard), Verteilen oder EV zuerst. Der EV-Rückmeldung wird Zeit gegeben; die Batterie kann das Laden währenddessen vorübergehend stärker reduzieren. Live-Phasenwerte werden stabiler mit ihrer tatsächlichen Messzeit angezeigt.

### 1.2.28

Optionele P1-fasebewaking begrenst batterij laden per ingestelde batterijfase en kan laadvermogen over geschikte batterijen verdelen. Een handmatige detectietest helpt de fase bepalen. AutoTune beoordeelt ingestelde SoC-doelen en laadbeperkingen op recente meetdagen en geeft kleinere, verklaarbare planningsvoorstellen ter beoordeling. Heropbouw na fasebegrenzing hervat betrouwbaar, ook bij kleine laadstappen. Minder herhaalde berekeningen en actuele controle bij Split-uitvoer. Fasekeuze en opnieuw opslaan van dezelfde batterijconfiguratie behouden de richtingstest. Starten en bevestigen verwerken ook een ontbrekend API-antwoord veilig. Richtingstestknoppen blijven geblokkeerd tijdens publicatie; de status toont de vaste Split-wisselvertraging en voorkomt dubbele bevestigingen. Een popup meldt wanneer een gewijzigde batterijconfiguratie een nieuwe richtingstest vereist. Live status toont L1, L2 en L3, met rode waarden boven de fasegrens. Batterijsturing kan na een expliciete gebruikersverklaring zonder richtingstest worden hervat, met aparte goedkeuringsstatus. Energiebehoefte ondersteunt nu tot 5.000 kWh, inclusief grotere verbruiksdagen in AutoTune en de energiebalans. Safety-SoC-herstel vraagt maximaal toegestaan laadvermogen tot de veiligheidsreserve bereikt is, begrensd door Peak Guard, fasebewaking en batterijlimieten. Standaard permanente HVAC-sturing onthoudt het eerste bereikte comfortdoel per toestel. Tijdens batterijladen kan een gestarte comfortsessie dit doel afwerken zonder Peak Guard-uitschakeling; bij ontladen of na het bereiken van het doel geldt de bestaande afbouw opnieuw.

Optional P1 phase monitoring limits battery charging by each battery’s configured phase and can redistribute charging across suitable batteries. An on-demand detection test helps identify the phase. AutoTune evaluates configured SoC goals and charging constraints using recent daily evidence and offers smaller, explained planning suggestions for review. Recovery after phase limiting resumes reliably, including small charging steps. Fewer repeated calculations and fresh checks at Split output. Phase selection and saving the same battery configuration preserve the direction test. Starting and confirming safely handle missing API responses. Direction-test buttons stay locked during publication; status shows the fixed Split switching delay and prevents duplicate confirmations. A popup explains when a changed battery configuration requires a new direction test. Live status shows L1, L2 and L3, highlighting values above the phase limit in red. Battery control can resume after an explicit user declaration without a direction test, with a separate approval status. Energy demand now supports up to 5,000 kWh, including larger consumption days in AutoTune and the energy balance. Safety SoC recovery requests maximum allowed charging power until the safety reserve is reached, bounded by Peak Guard, phase monitoring and battery limits. Standard permanent HVAC control tracks the first reached comfort target per device. While batteries are charging, an acknowledged comfort session can reach this target without a Peak Guard shutdown; existing reductions apply again during discharge or after the target is reached.

La surveillance facultative des phases P1 limite la charge selon la phase de chaque batterie et peut la répartir entre les batteries adaptées. Un test à la demande aide à identifier la phase. AutoTune tient compte des objectifs SoC et des contraintes de charge sur des journées récentes et propose de petits ajustements expliqués à vérifier. La reprise après limitation de phase fonctionne aussi avec de petits pas de charge. Moins de calculs répétés et contrôles actualisés à la sortie Split. Le choix de phase et la sauvegarde sans changement conservent le test de sens. Le démarrage et la confirmation gèrent une réponse API absente. Les boutons du test de sens restent bloqués pendant la publication ; le statut affiche le délai Split fixe et évite les confirmations doubles. Une fenêtre signale quand une modification des batteries exige un nouveau test de sens. Le statut affiche L1, L2 et L3, en rouge au-dessus de la limite de phase. Le pilotage des batteries peut reprendre après une déclaration explicite sans test de sens, avec un statut distinct. Le besoin énergétique accepte jusqu’à 5 000 kWh, y compris les journées de forte consommation dans AutoTune et le bilan. Le rétablissement du SoC de sécurité demande la puissance de charge maximale autorisée jusqu’à la réserve, sous les limites Peak Guard, de phase et des batteries. Le pilotage permanent standard du CVC suit le premier objectif de confort atteint par appareil. Pendant la charge des batteries, une session de confort confirmée peut atteindre cet objectif sans arrêt par Peak Guard ; la réduction habituelle reprend pendant la décharge ou après atteinte de l’objectif.

La supervisión opcional de fases P1 limita la carga según la fase de cada batería y permite repartirla entre baterías adecuadas. Una prueba manual ayuda a identificar la fase. AutoTune considera los objetivos SoC y las restricciones de carga con datos diarios recientes y propone pequeños ajustes explicados para su revisión. La recuperación tras limitar fases funciona también con pequeños pasos de carga. Menos cálculos repetidos y controles actualizados en la salida Split. La selección de fase y guardar la misma configuración conservan la prueba de dirección. El inicio y la confirmación gestionan respuestas API ausentes. Los botones de dirección permanecen bloqueados durante el envío; el estado muestra la demora Split fija y evita confirmaciones duplicadas. Un aviso indica cuándo cambiar la configuración de baterías requiere una nueva prueba de dirección. El estado muestra L1, L2 y L3 en rojo cuando superan el límite de fase. El control de baterías puede reanudarse tras una declaración explícita sin prueba de dirección, con un estado distinto. La demanda admite hasta 5.000 kWh, incluidos los días de alto consumo en AutoTune y el balance energético. La recuperación del SoC de seguridad solicita la máxima potencia de carga permitida hasta alcanzar la reserva, respetando Peak Guard, las fases y los límites de baterías. El control permanente estándar de climatización registra el primer objetivo de confort alcanzado por equipo. Durante la carga de baterías, una sesión de confort confirmada puede alcanzar ese objetivo sin que Peak Guard la apague; la reducción habitual vuelve a aplicarse durante la descarga o tras alcanzar el objetivo.

Die optionale P1-Phasenüberwachung begrenzt das Laden nach der eingestellten Phase jeder Batterie und kann Ladeleistung auf geeignete Batterien verteilen. Ein manueller Test hilft bei der Phasenerkennung. AutoTune berücksichtigt SoC-Ziele und Ladegrenzen anhand aktueller Tagesdaten und schlägt kleine, erklärte Planungsanpassungen zur Prüfung vor. Der Wiederaufbau nach Phasenbegrenzung funktioniert auch bei kleinen Ladeschritten zuverlässig. Weniger wiederholte Berechnungen und aktuelle Prüfungen bei der Split-Ausgabe. Phasenauswahl und unverändertes Speichern erhalten den Richtungstest. Start und Bestätigung behandeln fehlende API-Antworten sicher. Richtungstest-Tasten bleiben während der Veröffentlichung gesperrt; der Status zeigt die feste Split-Verzögerung und verhindert doppelte Bestätigungen. Ein Hinweis meldet, wenn eine geänderte Batteriekonfiguration einen neuen Richtungstest erfordert. Der Live-Status zeigt L1, L2 und L3 bei Überschreitung der Phasengrenze rot. Die Batteriesteuerung kann nach ausdrücklicher Erklärung ohne Richtungstest mit gesondertem Freigabestatus fortgesetzt werden. Der Energiebedarf unterstützt bis zu 5.000 kWh, einschließlich hoher Verbrauchstage in AutoTune und der Energiebilanz. Die Wiederherstellung des Sicherheits-SoC fordert bis zum Erreichen der Reserve die maximal zulässige Ladeleistung an, begrenzt durch Peak Guard, Phasenüberwachung und Batteriegrenzen. Die standardmäßige permanente HLK-Steuerung merkt sich das erstmals erreichte Komfortziel je Gerät. Beim Batterieladen kann eine bestätigte Komfortsitzung dieses Ziel ohne Abschaltung durch Peak Guard erreichen; beim Entladen oder nach Erreichen des Ziels gilt wieder die bisherige Abregelung.

### 1.2.27

HVAC aanhouden en uitschakelen op temperatuur zijn afzonderlijke opties. De temperatuurgrens staat standaard uit; bij inschakelen verschijnt de marge met standaard 1 °C en symmetrische hysterese.

Keeping HVAC on and switching off at a temperature limit are separate options. The limit is off by default; enabling it reveals a margin of 1 °C by default with symmetric hysteresis.

Maintenir le HVAC allumé et l’arrêter à une limite de température sont deux options distinctes. La limite est désactivée par défaut ; son activation affiche une marge par défaut de 1 °C avec hystérésis symétrique.

Mantener el HVAC encendido y apagarlo por temperatura son opciones separadas. El límite está desactivado por defecto; al activarlo aparece un margen predeterminado de 1 °C con histéresis simétrica.

HVAC eingeschaltet lassen und temperaturabhängig ausschalten sind getrennte Optionen. Die Grenze ist standardmäßig aus; bei Aktivierung erscheint ein Abstand mit Standardwert 1 °C und symmetrischer Hysterese.

### 1.2.26

Per HVAC kan permanent sturen het toestel ingeschakeld houden tot een instelbare temperatuurmarge voorbij het doel. Het HVAC-overzicht toont een icoon wanneer permanente sturing actief is.

Permanent control can keep each HVAC on until a configurable temperature margin beyond its target. The HVAC summary shows an icon when permanent control is active.

Le pilotage permanent peut maintenir chaque HVAC allumé jusqu’à une marge réglable au-delà de sa cible. L’aperçu indique le pilotage permanent actif par une icône.

El control permanente puede mantener cada HVAC encendido hasta un margen ajustable más allá del objetivo. El resumen muestra un icono cuando está activo.

Die permanente Regelung kann jedes HVAC-Gerät bis zu einem einstellbaren Abstand über das Temperaturziel hinaus eingeschaltet lassen. Ein Symbol zeigt die aktive permanente Regelung.

### 1.2.25

Het gezamenlijke HVAC-vermogensbudget telt uitsluitend HVAC-belasting, met één reservering per gedeelde installatie. Comfort- en tariefsturing kunnen zonder PV starten en hervatten zodra budget vrijkomt. Duidelijkere wachtredenen en gerichte afbouw; stappen van 0,5 °C gelden alleen voor normale permanente comfortsturing, met behoud van ingestelde tariefdoelen.

The combined HVAC power budget counts HVAC load only, with one reservation per shared installation. Comfort and tariff control can start without PV and resume when budget becomes available. Clearer waiting reasons and targeted reductions; 0.5 °C steps apply only to normal permanent comfort control, preserving configured tariff targets.

Le budget de puissance HVAC total ne compte que la charge HVAC, avec une réservation par installation partagée. Le confort et le pilotage tarifaire peuvent démarrer sans PV et reprendre quand le budget se libère. Motifs d’attente plus clairs et réduction ciblée ; les pas de 0,5 °C concernent uniquement le confort permanent normal, sans modifier les cibles tarifaires.

El presupuesto de potencia HVAC conjunto solo cuenta la carga HVAC, con una reserva por instalación compartida. El control de confort y por tarifa puede arrancar sin FV y reanudarse cuando haya presupuesto. Motivos de espera más claros y reducción selectiva; los pasos de 0,5 °C solo se aplican al confort permanente normal, conservando los objetivos por tarifa.

Das gemeinsame HVAC-Leistungsbudget zählt nur HVAC-Lasten, mit einer Reservierung je gemeinsamer Anlage. Komfort- und Tarifregelung können ohne PV starten und bei freiem Budget fortgesetzt werden. Klarere Wartegründe und gezielte Reduzierung; Schritte von 0,5 °C gelten nur für die normale permanente Komfortregelung, ohne eingestellte Tarifziele zu ändern.

### 1.2.24

De HVAC-doeltemperatuur wordt wit zodra het ontvangen setpoint numeriek overeenkomt met Doel. Ontbrekende of afwijkende feedback blijft grijs; stuur- en terugmeldtijden blokkeren de bevestiging niet meer.

The HVAC target temperature turns white when the received setpoint numerically matches Target. Missing or differing feedback stays grey; command and feedback timestamps no longer block confirmation.

La température cible HVAC devient blanche lorsque la consigne reçue correspond numériquement à la cible. Un retour absent ou différent reste gris ; les horodatages ne bloquent plus la confirmation.

La temperatura objetivo HVAC se muestra en blanco cuando la consigna recibida coincide numéricamente con el objetivo. Si la respuesta falta o difiere, permanece gris; las marcas de tiempo ya no bloquean la confirmación.

Die HVAC-Zieltemperatur wird weiß, sobald der empfangene Sollwert numerisch mit dem Ziel übereinstimmt. Fehlende oder abweichende Rückmeldungen bleiben grau; Zeitstempel blockieren die Bestätigung nicht mehr.

### 1.2.23

Duidelijke gecombineerde HVAC-status bij uitgeschakelde permanente sturing. Het HVAC-overzicht toont het doel grijs tot recente toestelterugmelding het gevraagde setpoint bevestigt. Instelbare planningsmarge van 0–100% bij maximaal laden reserveert extra laadtijd zonder het SoC-doel te verhogen. Ontwikkeltests en validatierapporten worden uitgesloten van het Homey-app-package.

Clear combined HVAC status when permanent control is disabled. The HVAC overview shows targets in grey until recent device feedback confirms the requested setpoint. A configurable 0–100% planning margin for maximum-power charging reserves extra time without raising the SoC target. Development tests and validation reports are excluded from the Homey app package.

Statut HVAC combiné clair lorsque le pilotage permanent est désactivé. L’aperçu affiche les cibles en gris jusqu’à confirmation de la consigne par un retour récent de l’appareil. Une marge réglable de 0 à 100% réserve du temps supplémentaire à puissance maximale sans augmenter l’objectif SoC. Les tests de développement et rapports de validation sont exclus du paquet Homey.

Estado HVAC combinado claro con el control permanente desactivado. El resumen muestra los objetivos en gris hasta que una respuesta reciente del dispositivo confirme la consigna solicitada. Un margen ajustable de 0–100% reserva tiempo adicional de carga a potencia máxima sin elevar el objetivo SoC. Las pruebas de desarrollo y los informes de validación se excluyen del paquete Homey.

Klarer kombinierter HVAC-Status bei ausgeschalteter permanenter Steuerung. Die Übersicht zeigt Ziele grau, bis eine aktuelle Geräterückmeldung den angeforderten Sollwert bestätigt. Eine einstellbare Planungsreserve von 0–100% reserviert zusätzliche Ladezeit bei maximaler Leistung, ohne das SoC-Ziel anzuheben. Entwicklungstests und Validierungsberichte sind vom Homey-App-Paket ausgeschlossen.

### 1.2.22

De HVAC-Flow schakelt nu uitsluitend Permanent sturen. De algemene toestemming blijft behouden, zodat standaard PV-opvang na uitschakelen mogelijk blijft. De gekozen uit- of stand-byactie wordt direct één keer uitgevoerd.

The HVAC Flow now toggles Permanent control only. General control permission is preserved, allowing standard PV capture after disabling permanent control. The selected OFF or standby action is sent immediately once.

La carte Flow HVAC active ou désactive uniquement le pilotage permanent. L’autorisation générale est conservée afin de permettre la régulation solaire standard après désactivation. L’action arrêt ou veille choisie est envoyée immédiatement une seule fois.

La tarjeta Flow HVAC activa o desactiva únicamente el control permanente. Conserva el permiso general, permitiendo el aprovechamiento solar estándar tras desactivarlo. La acción de apagado o espera elegida se envía inmediatamente una sola vez.

Die HVAC-Flow-Karte schaltet nur die permanente Steuerung. Die allgemeine Freigabe bleibt erhalten, sodass die normale PV-Nutzung nach dem Deaktivieren möglich bleibt. Die gewählte Aus- oder Standby-Aktion wird sofort einmal gesendet.

### 1.2.21

Permanent sturen kan zonder tarief-, PV- of periodieke optimalisatie zelfstandig verwarmen of koelen op basis van de bestaande ruimtetemperatuurgrenzen en comfortdoelen. De regeling stopt bij het comfortdoel en respecteert de bestaande prioriteiten, stuurintervallen en veiligheidsgrenzen.

Permanent HVAC control can independently heat or cool using the existing room-temperature thresholds and comfort targets without tariff, PV or periodic optimization. Control stops at the comfort target and respects existing priorities, command intervals and safety limits.

Le pilotage permanent HVAC peut chauffer ou refroidir de façon autonome selon les seuils de température ambiante et les objectifs de confort existants, sans optimisation tarifaire, solaire ou périodique. Il s’arrête à l’objectif de confort et respecte les priorités, intervalles et limites de sécurité existants.

El control permanente HVAC puede calentar o enfriar de forma autónoma con los umbrales de temperatura ambiente y objetivos de confort existentes, sin optimización tarifaria, solar ni periódica. Se detiene al alcanzar el objetivo y respeta las prioridades, intervalos y límites de seguridad existentes.

Die permanente HVAC-Steuerung kann anhand der bestehenden Raumtemperaturschwellen und Komfortziele selbstständig heizen oder kühlen, ohne Tarif-, PV- oder periodische Optimierung. Sie stoppt am Komfortziel und beachtet bestehende Prioritäten, Steuerintervalle und Sicherheitsgrenzen.

### 1.2.20

De reactietest ondersteunt dual mode met 100 → 500 → 100 W laden (of het hogere ingestelde minimum plus 400 W). Bij meerdere batterijen blijft de totale meetstap 400 W.

The response test supports dual mode with 100 → 500 → 100 W charging (or the higher configured minimum plus 400 W). With multiple batteries, the total measured step remains 400 W.

Le test de réaction prend en charge le mode dual avec 100 → 500 → 100 W de charge (ou le minimum configuré supérieur plus 400 W). Avec plusieurs batteries, la variation totale reste de 400 W.

La prueba de respuesta admite modo dual con 100 → 500 → 100 W de carga (o el mínimo configurado superior más 400 W). Con varias baterías, el cambio total sigue siendo de 400 W.

Der Reaktionstest unterstützt den Dual-Modus mit 100 → 500 → 100 W Ladeleistung (oder dem höheren eingestellten Minimum plus 400 W). Bei mehreren Batterien bleibt der gesamte Messschritt 400 W.

### 1.2.19

Reactietest: gemiddeld tien afzonderlijke stuurreacties; terugkeer bevestigd bij minstens 300 W daling.

De reactietestknop wordt na afronden of stoppen automatisch bijgewerkt.

Reactietest: uitregeltijd na de 300 W-terugbevestiging telt niet mee in de reactiemeting.


Autotune gebruikt voor de ontlaadgrens van Batterij sparen de laagste dagelijkse SoC, ook bij later laden en na herstart. Nieuwe aparte batterijreactietest die alleen na een klik start met vijf 400 W-laadpulsen, blijvend resultaat en advies voor stuurinterval en P1-middeling. Een oranje waarschuwing helpt bij een te kort gekozen interval.

Autotune uses the daily minimum SoC for the Battery Save discharge floor, including later charging and restarts. Added a separate on-demand battery response test with five 400 W charging pulses, a persistent result and advice on the command interval and P1 averaging. An orange warning helps identify an interval that is too short.

Autotune utilise le SoC minimal quotidien pour le seuil de décharge en économie de batterie, y compris après une recharge ultérieure et un redémarrage. Ajout d’un test de réaction distinct déclenché uniquement par un clic avec cinq impulsions de recharge à 400 W, un résultat conservé et des conseils sur l’intervalle de commande et la moyenne P1. Un avertissement orange signale un intervalle trop court.

Autotune usa el SoC mínimo diario para el umbral de descarga del ahorro de batería, incluso tras una carga posterior y un reinicio. Se añade una prueba de respuesta independiente que solo se inicia al pulsar el botón con cinco pulsos de carga de 400 W, resultado persistente y consejos sobre el intervalo de control y el promedio P1. Una advertencia naranja señala un intervalo demasiado corto.

Autotune verwendet den täglichen Mindest-SoC für die Entladegrenze beim Batteriesparen, auch nach späterem Laden und Neustarts. Neuer separater Batterie-Reaktionstest, der nur nach einem Klick startet mit fünf 400-W-Ladeimpulsen, dauerhaftem Ergebnis und Hinweisen zu Steuerintervall und P1-Mittelung. Eine orange Warnung weist auf ein zu kurzes Intervall hin.

### 1.2.18

More compact settings on mobile and desktop, with tighter spacing, less nested padding and a smaller save bar. Added French, Spanish and German for settings, Flow cards, widgets, status messages, app-store descriptions and release notes.

Compactere instellingen op mobiel en desktop, met minder tussenruimte, minder inspringing in geneste groepen en een kleinere opslagbalk. Frans, Spaans en Duits toegevoegd voor instellingen, Flow-kaarten, widgets, statusmeldingen, websitebeschrijvingen en release notes.

Paramètres plus compacts sur mobile et ordinateur, avec des espacements réduits, des groupes moins indentés et une barre d’enregistrement plus petite. Ajout du français, de l’espagnol et de l’allemand pour les paramètres, les cartes Flow, les widgets, les messages d’état, les descriptions de l’application et les notes de version.

Ajustes más compactos en móviles y ordenadores, con menos espacio entre elementos, menor sangría en los grupos y una barra de guardado más pequeña. Se añaden francés, español y alemán para los ajustes, las tarjetas Flow, los widgets, los mensajes de estado, las descripciones de la aplicación y las notas de versión.

Kompaktere Einstellungen auf Mobilgeräten und am Desktop mit kleineren Abständen, weniger Einrückung in verschachtelten Gruppen und einer kleineren Speicherleiste. Französisch, Spanisch und Deutsch für Einstellungen, Flow-Karten, Widgets, Statusmeldungen, App-Beschreibungen und Versionshinweise hinzugefügt.

### 1.2.17

Avoid all grid import now takes priority over battery saving and deferred charging while a future maximum-power charge plan is pending. During expensive dynamic intervals, waiting for a later charge block no longer prevents normal battery discharge; the explicit low-PV preference for expensive intervals remains effective.

Vermijd alle netimport krijgt ook bij een toekomstige maximale laadplanning voorrang op Batterij sparen en uitgesteld laden. Tijdens dure dynamische uren blokkeert het wachten op een later laadblok de normale batterijontlading niet meer; de expliciete lage-PV-keuze voor dure uren blijft gelden.

### 1.2.16

Latest battery charging keeps its end anchored 15 minutes before the selected charge window closes, including active replanning and unequal battery SoC. Per-HVAC automatic-control OFF Flows immediately send either the configured standby setpoint or OFF, once per explicit call, respecting output permissions. A Flow temperature can override the saved standby temperature. Shortened the battery-saving message while charging is scheduled for later.

Bij zo laat mogelijk laden blijft de eindtijd vast op 15 minuten vóór het einde van het gekozen laadvenster, ook bij actieve herplanning en ongelijke batterij-SoC. Per HVAC stuurt de Flow voor automatische sturing uit direct de gekozen stand-bytemperatuur of Uit, eenmaal per expliciete aanroep en met respect voor de uitgangstoelatingen. Een Flow-temperatuur kan de opgeslagen stand-bytemperatuur vervangen. De wachtmelding bij Batterij sparen met later gepland laden is verkort.

### 1.2.15

Per-HVAC direct tariff/PV switching and parallel dispatch of known loads share available power with a modulation margin, HVAC budget and Peak Guard. Linked thermostats reserve their shared heat source once. Manual learning waits for an isolated reliable measurement; direct and shared control disable separate automatic learning. The automatic-control Flow accepts an optional standby temperature and sends OFF when power control is permitted. Corrected the formatted automatic HVAC control Flow titles so the optional standby temperature passes app validation. Unknown HVAC power now uses a 300 W start estimate (360 W including the modulation margin), allowing initial tariff/PV control within limited grid headroom.

Direct schakelen per HVAC bij tariefwissel of stabiel PV-overschot en parallelle sturing van bekende verbruikers verdelen het beschikbare vermogen met modulatiemarge, HVAC-budget en Peak Guard. Gekoppelde thermostaten reserveren hun gedeelde warmtebron eenmaal. Handmatig leren wacht op een afzonderlijke betrouwbare meting; directe en gedeelde sturing schakelen afzonderlijk automatisch leren uit. De Flow voor automatische sturing aanvaardt een optionele stand-bytemperatuur en stuurt Uit wanneer aan/uit-sturing toegestaan is. De opgemaakte titels van de Flow voor automatische HVAC-sturing bevatten nu ook de optionele stand-bytemperatuur, zodat de appvalidatie slaagt. Voor HVAC’s zonder betrouwbaar bekend vermogen wordt een startraming van 300 W gebruikt (360 W met modulatiemarge), zodat de eerste tarief-/PV-aansturing bij beperkte netruimte mogelijk wordt.

### 1.2.14

The EMS widget shows Saving battery while grid charging is deferred. Decision titles and reasons now distinguish actual solar/grid charging, Peak Guard limits, paused or disabled battery control, missing inputs and pending output changes. Matching Logic tags use the same status selection. EV output keeps published zero values visible and distinguishes Peak Guard throttling from stopping; boiler status follows its published on/off state.

De EMS-widget toont Batterij sparen wanneer netladen is uitgesteld. Beslissing en reden onderscheiden actief laden uit zon/net, Peak Guard-begrenzing, gepauzeerde of uitgeschakelde batterijsturing, ontbrekende invoer en wachtende uitsturing. Bijbehorende Logic-tags gebruiken dezelfde statuskeuze. EV-uitvoer behoudt uitgestuurde nulwaarden en onderscheidt Peak Guard-terugregeling van stoppen; de boilerstatus volgt de uitgestuurde aan/uit-status.

### 1.2.13

Reduced duplicate preflight work while a battery control interval is pending. Boiler solar-day fallback calculations are reused until their next relevant time or settings boundary. Fresh measured EV consumption remains included in battery grid protection while a charger is temporarily commanded to 0 A, including EV4. Charging strategy option text turns green on hover.

Minder dubbele preflightberekeningen tijdens een lopend batterij-stuurinterval. Berekeningen voor de zonnedag-terugvalstatus van de boiler worden hergebruikt tot de volgende relevante tijdgrens of instellingenwijziging. Vers gemeten EV-verbruik blijft meetellen in de netbescherming van de batterij wanneer een laadpaal tijdelijk 0 A krijgt, ook bij EV4. Optietekst in Laadstrategie wordt groen bij aanwijzen.

### 1.2.12

Settings tabs now use green hover text.

Instellingentabbladen tonen groene tekst bij aanwijzen.

Orange warnings below the EMS decision reason identify relevant missing or unrefreshed inputs and explain how to restore updates.

Oranje meldingen onder de EMS-beslissingsreden tonen ontbrekende of niet-vernieuwde relevante inputs met hersteladvies.

New Charging strategy tab: spread charging with an optional power correction, or maximum safe charging with early, latest or centred positioning. Separate day/night and optional summer/winter profiles reuse the existing month selection. With variable prices, centring is used only when the full block is cheaper than the standard spread plan. Charging adapts to remaining energy and available grid capacity while retaining PV priority and Peak Guard.

Nieuw tabblad Laadstrategie: gespreid laden met optionele vermogenscorrectie, of maximaal veilig laden vanaf het begin, zo laat mogelijk of gecentreerd. Aparte dag-/nacht- en optionele zomer-/winterprofielen hergebruiken de bestaande maandselectie. Bij variabele prijzen wordt alleen gecentreerd als het volledige blok goedkoper is dan de standaardspreiding. Het laden past zich aan de resterende energiebehoefte en beschikbare netcapaciteit aan, met behoud van PV-voorrang en Peak Guard.

### 1.2.11

Peak Guard can take over battery control in every operating mode, including Standby. Standby otherwise remains idle without ordinary PV capture.

Peak Guard kan de batterijsturing in elke werkingsmodus overnemen, ook in Stand-by. Stand-by blijft verder in rust zonder gewone PV-opvang.

### 1.2.10

Reduced repeated battery calculations while discharge is blocked by a SoC limit or selected operating mode. Stable zero output is reused with immediate checks for new PV export and Peak Guard availability. Standby does not request battery support for Peak Guard or PV capture.

Minder herhaalde batterijberekeningen wanneer ontladen door een SoC-grens of gekozen modus wordt geblokkeerd. Stabiele nuluitvoer wordt hergebruikt met directe controle op nieuwe PV-export en beschikbare Peak Guard-ondersteuning. Stand-by vraagt geen batterijsturing voor Peak Guard of PV-opvang.

### 1.2.9

Extend an existing EV plan by 1–7 days through the session override card, preserving its goal and progress across restarts. Active multi-day plans are protected against replacement until completion or clear. EMS decision reasons, WAF color/status and additional control statuses are now available as change-only global Logic tags.

Verleng een bestaande EV-planning met 1–7 dagen via de sessie-overridekaart, met behoud van doel en voortgang over herstarts. Actieve meerdaagse plannen zijn beschermd tegen overschrijven tot voltooiing of wissen. EMS-beslisredenen, WAF-kleur/status en extra regelstatussen zijn beschikbaar als globale Logic-tags die alleen bij wijzigingen worden gepubliceerd.

### 1.2.8

Reduced temporary startup and battery-control memory allocations by separating HVAC-only settings from battery planning and control settings.

### 1.2.7

Added up to 10 HVAC channels with optional permanent, tariff and solar temperature control, heat/cool direction, staggered activation and a shared extra grid budget. Separate heat/cool power learning supports re-evaluation. Added an optional compact HVAC summary to the EMS widget, with matching typography, coloured tariff/mode icons and aligned temperatures. New HVAC settings are grouped with activation; two-rate TOU contracts show only low and high temperature targets. Active permanent control shows only its relevant PV options and offers optional outdoor temperature limits with adjustable shutdown hysteresis. Upgrade initialization of additional HVAC channels is spread over time. Optional periodic heating runs during cheap tariff periods. HVAC control and learning assessment follow the slow context cadence. EV timer-driven planning also uses the shared slow context. HVAC temperature targets now support up to 99 °C, including periodic water heating. HVAC comfort and activation fields adapt to the selected control. Automatic heating/cooling can also use outdoor temperature. Optional COP-related cold-weather targets can adjust each HVAC tariff goal. Fixed-direction permanent control supports setpoint-only devices; HVAC status reflects permanent/COP control and its actual waiting reason.

### 1.2.6

Added a Savings category Flow action with totals, rolling day/week/month/year periods and a choice of kWh, kWh with price or price only. Optional night SoC hysteresis and a restart-safe 00:00–02:00 PV forecast median hold reduce night charging changes. Autotune battery output intervals are limited to 4–17 seconds, with evidence-based grid-band recommendations centred on zero and sized for battery power steps. The same Flow action also reads EV Insights for all EVs or EV 1–4, including source energy, known costs, estimated solar savings and solar-kilometre tokens, with explicit data availability.

### 1.2.5

Mode-control EV energy is now recorded from the existing valid P1 estimate into the same Savings daydata and CSV. Emergency and active guaranteed charging retain grid permission independently of PV, within physical Peak Guard limits. The three EV tabs remain Status, Planning and Insights. See [validation and scope](docs/EV-REGISTRATION-1.2.5.md).

### 1.2.4

Added new widget: EV scheduling & insights.

Nieuwe widget toegevoegd: EV-planning & inzichten.

### 1.2.3

The WAF energy balance refreshes every five minutes independently of battery charge planning and EV goals or tariff horizons. It covers household demand, battery reserves and remaining solar; EV planning reservations are excluded. It stays available across morning and afternoon target times while preserving the real PV-based night transition.

### 1.2.2

Battery charging and discharging limits now support up to 100,000 W per battery and for the complete group, with single or split commands. Existing power settings and defaults remain unchanged.

### 1.2.1 – Smarter Energy Insights

- Added a household energy budget indicator showing estimated surplus after household demand and daytime battery charging to the configured maximum SoC.
- Added critical EMS status alerts to the widget, alternating with the current decision.
- Introduced intelligent status colors for easier interpretation of energy values.
- Added independent widget settings for the energy indicator, critical alerts, and status colors.
- All new widget options are enabled by default, including for existing widgets after updating.

Implementation and validation: [Smarter Energy Insights](docs/smarter-energy-insights-1.2.1.md).

### 1.1.20

Persistent EV Flow planning: SoC and kWh targets retain their deadline time and guarantee across app/Homey restarts until Clear EV planning or replacement by a new Flow target. Recent kWh progress is saved on normal shutdown; a completed target is not refilled merely by restarting with the EV connected. Zero kWh remains a completed Flow target. Fresh positive current feedback takes precedence over house-load estimates for mode-controlled EVs, so Peak Guard correctly accounts for power already drawn by the EV. Planning diagnostics expose the shared Peak Guard calculation.

Blijvende EV-Flow-planning: SoC- en kWh-doelen behouden hun tijd en garantie na een app-/Homey-herstart en verdwijnen alleen na Wis EV-planning of vervanging door een nieuw Flow-doel. Recente kWh-voortgang wordt bij normaal afsluiten opgeslagen; een voltooid doel wordt niet opnieuw gevuld door een herstart met aangesloten EV. Ook 0 kWh blijft een voltooid Flow-doel. Verse positieve laadstroomfeedback krijgt bij EV-modussturing voorrang op huislastschattingen, zodat Peak Guard werkelijk aanwezig EV-vermogen correct meerekent. De planningsdiagnostiek toont de gezamenlijke Peak Guard-berekening.

### 1.1.19

An evening restart without an observed PV start/end now aligns the inferred night with the following morning and tomorrow’s solar forecast. Observed night plans, dark-morning continuation and the existing PV transition remain authoritative.

Een herstart in de avond zonder waargenomen PV-start/-einde koppelt het afgeleide nachtplan aan de volgende ochtend en de PV-voorspelling van morgen.

Dynamic battery night planning compares known prices up to the morning target across midnight. The preferred cheap-hours duration expands when needed for the remaining energy; normal-price charging keeps its own SoC cap. SoC and solar forecasts keep updating the active plan. Day planning, fixed/TOU tariffs, EV deadline planning, solar capture and safety limits retain their existing rules.

Dynamische batterijnachtplanning vergelijkt bekende prijzen tot het ochtenddoel over middernacht heen. De voorkeursduur voor goedkoop laden wordt indien nodig uitgebreid voor de resterende energie; normaal laden behoudt zijn SoC-limiet. SoC en PV-voorspellingen blijven het actieve plan bijwerken.

### 1.1.18

Dynamic battery night planning compares known prices up to the morning target across midnight. The preferred cheap-hours duration expands when needed for the remaining energy; normal-price charging keeps its own SoC cap. SoC and solar forecasts keep updating the active plan. Day planning, fixed/TOU tariffs, EV deadline planning, solar capture and safety limits retain their existing rules.

Dynamische batterijnachtplanning vergelijkt bekende prijzen tot het ochtenddoel over middernacht heen. De voorkeursduur voor goedkoop laden wordt indien nodig uitgebreid voor de resterende energie; normaal laden behoudt zijn SoC-limiet. SoC en PV-voorspellingen blijven het actieve plan bijwerken.

### 1.1.17

Active EV SoC/kWh targets compare available dynamic prices up to their deadline across calendar days. For an active deadline, “Cheap” selects the cheapest required charging energy within that EV window rather than the battery's daily price ranking. Small price differences can retain a contiguous or existing plan; unknown prices are never treated as cheap. Existing PV charging, deadline guarantee permissions, import limits and Peak Guard remain active. Without an active deadline, the configured tariff preferences are unchanged. Battery targets and midnight PV-forecast updates keep their own planning.

Actieve EV-SoC/kWh-doelen vergelijken beschikbare dynamische prijzen tot de deadline over kalenderdagen heen. “Goedkoop” kiest bij een actief doel de goedkoopste benodigde laadenergie binnen dat EV-venster. Kleine prijsverschillen kunnen een aaneengesloten of bestaand plan behouden. Onbekende prijzen zijn niet automatisch goedkoop. De batterij behoudt haar eigen doelmomenten en verwerking van nieuwe PV-voorspellingen na middernacht.

### 1.1.16

Physical EV control now reuses unchanged electrical configuration and tariff permissions between P1 measurements. Live power, tariff boundaries and safety checks remain current; relevant settings changes refresh the cached configuration.

Reduced EV CPU work during frequent P1 updates by replacing redundant full EV settings expansions with targeted electrical and tariff-permission reads. Diagnostics now distinguishes full settings expansion from physical settings reads by source.

More efficient EV charging plans: repeated SoC and kWh Flow targets avoid unnecessary updates, calendar work and tariff scans. Physical EV accounting and Live status now avoid redundant settings expansion. A heartbeat sharing an already completed, unchanged EV pass skips a duplicate allocation; a completed, still-connected session can remain quiet after STOP and physical load have settled. New input and time boundaries continue to trigger fresh checks.

Efficiëntere EV-laadplanning: herhaalde SoC- en kWh-doelen via Flow vermijden onnodige updates, kalenderwerk en tariefscans. De fysieke EV-vermogenscontrole en Live-status bouwen minder vaak volledige instellingen op. Een heartbeat kan een identieke, net afgehandelde EV-berekening overslaan; ook een beëindigde, nog aangesloten sessie blijft na STOP en het verdwijnen van restbelasting rustig. Nieuwe invoer en tijdsgrenzen blijven opnieuw controleren.

New 15-minute planning diagnostics show actual battery SoC plans, battery charge-power calculations, EV decisions, tariff-window scans, settings expansions and SoC deadline lookups. Each route has execution counts, frequency warnings and CPU/wall time, separately from incoming Flow loops. The JSON export contains the same measurements.

Nieuwe planningsdiagnostiek tijdens de bestaande opname van 15 minuten: werkelijk uitgevoerde batterij-SoC-plannen, batterijlaadvermogensberekeningen, EV-beslissingen, tariefvensterscans, instellingenopbouwen en SoC-deadlineopzoekingen. Per route zijn aantallen, frequentiewaarschuwingen en CPU-/rekentijd zichtbaar, apart van inkomende Flow-loops. De JSON-export bevat dezelfde meetgegevens.

Further EV planning improvements: SoC feedback and status displays avoid full EV settings expansion; Flow SoC deadlines use one calendar lookup per minute while preserving precise timing. A duplicate five-minute guarantee tariff-window suffix is reused within the same decision. The monitor adds per-EV plan revision requests, handled revisions, and reuse counts.

Verdere EV-planningsoptimalisatie: SoC-feedback en statusweergaven vermijden volledige instellingenopbouw; SoC-Flow-deadlines vragen slechts één kalenderopzoeking per minuut met behoud van exacte timing. Een overlappend garantietariefvenster van vijf minuten wordt binnen dezelfde beslissing hergebruikt. De monitor telt bijkomend planningsrevisies en hergebruik.

### 1.1.15

Reduced repeated EV physical checks and settings expansion within a synchronous fast-control request. Resolved EV context requests are discarded before timer execution and after waiting for another publication. Fully disconnected EVs skip unnecessary heartbeat calculations once outputs and physical safeguards are settled. Charging strategies, immediate safety responses, Input Monitor and the regular context interval are preserved.

Minder herhaalde fysieke EV-controles en instellingenopbouw binnen dezelfde snelle verwerkingsgang. Vervallen EV-contextaanvragen worden vóór timeruitvoering en na wachten op een andere publicatie verwijderd. Volledig losgekoppelde EV’s slaan onnodige heartbeatberekeningen over zodra uitgangen en fysieke beveiligingen zijn afgehandeld. Laadstrategieën, onmiddellijke veiligheidsreacties, Input Monitor en het reguliere contextinterval blijven behouden.

### 1.1.9

Choose per EV whether to stop at the SoC target (default) or continue with the configured tariff and PV preferences. This also applies to SoC Flow targets. Explicit session stops and kWh targets keep stopping.

### 1.1.6

Compact diagnostic settings history and targeted EV decision and command details.

### 1.1.5

EV control now also works with battery output disabled or without configured home batteries.

### 1.1.4

Night planning uses the median of relevant PV forecasts until solar production starts.

### 1.1.3

Reduced redundant battery-control work during changing solar and grid charging.

### 1.1.2

Reduced redundant battery evaluations during planned charging while a slow context update is pending.

### 1.1.1

PV-live now only selects the grid measurement, avoiding redundant battery evaluations.

### 1.0.12

Reduced CPU usage through more efficient settings processing.

### 1.0.11

EV current and hybrid control now use the actual measured charging current for permitted grid import, independently of the commanded ampere limit. Lower charging current no longer leaves the home battery compensating that allowed EV load. Missing or expired feedback withdraws the measured allowance; tariff permissions, grid budgets and Peak Guard remain active. Settings immediately highlight that actual charging current must be reported at least every 50 seconds, even when unchanged.

### 1.0.10

Reduced redundant fast battery evaluations while slow PV or flexible-load updates are pending. Meter and periodic module refreshes can reuse valid battery feedback when individual setpoints and safety checks remain unchanged.

### 1.0.9

When individual battery commands remain unchanged during planned charging, changes in the grid/solar share no longer trigger a full fast evaluation. Source values and status text refresh on the existing slow cycle. Diagnostics separately count source-only skips and source-presentation updates.

### 1.0.8

Reduced redundant fast battery evaluations during stable planned grid charging and combined grid/solar charging. Diagnostics separately count skipped planned-charge evaluations when the battery commands and charging source remain unchanged. An idle guard reduces battery-control work when normal discharging is blocked and all battery commands are confirmed at zero. Diagnostics report idle skips and bypass reasons.


### 1.0.7

Added independent maximum SoC settings for day and night planned charging (default 100%). Solar surplus can continue charging beyond the planning limit. Planning energy need and the PV threshold are grouped at the top of energy planning. The status widget identifies active planning limits and discharge floors; EV PV-allocation details appear only when solar surplus actually contributes.

### 1.0.6

Select and prioritize Homey, External Price 1 and External Price 2 independently. External JSON curves support up to 120 hours of hourly or quarter-hour prices, with one generic source-selectable Flow input. Fallback sources share existing price alignment and validation. Status and planning diagnostics identify the active source and skipped-source reasons. The EMS widget shows up to three available prices and curves. External curves are retained across app restarts. Price-source selection uses checkboxes followed by priority dropdowns. Selected widget sources stay visible when data is missing; available future curves retain their priority numbers. Price alignment compares current-day overlap at a shared resolution and tolerates isolated outliers while rejecting unreliable matches. External sources can have custom names in settings, the widget and the new Flow source picker. The chart preserves received price blocks, including quarter-hour values with an hourly planning contract. Hourly prices repeated across four quarter-hour slots are recognized and aligned against complete hourly averages. Price-curve legend labels use the matching curve colors. Planned charging now continues live P1 feedback within the same import/export zone. Forced recalculations retain their force flag while waiting for the command interval. Diagnostics identify fast-control skip reasons and distinguish app startup from diagnostics startup. Battery efficiency optimization now also retains the charging battery until its SoC is more than the configured balance margin above the lowest available battery (minimum 2 percentage points), including during gradual handovers.

### 1.0.5

Discharge selection now keeps the current battery preferred until it is more than 2 percentage points below the highest available battery, including during a gradual handover, so near-equal SoCs no longer cause repeated battery swapping. Active-battery-count selection now has a wider sticky power hysteresis around efficiency thresholds and preserves the desired count while a gradual handover is in progress. With equal 1000 W targets, one battery remains selected through 1700 W and two batteries remain selected down through 1300 W, preventing P1 feedback around roughly 1450-1500 W from repeatedly switching between one and two batteries.

### 1.0.4

Multi-battery efficiency rotations now transfer power gradually between the outgoing and incoming batteries instead of switching the full setpoint at once. The gradual handover is enforced at the final battery-output boundary and is independent of the normal total-command deadband, so a large deadband can no longer collapse the rotation into one jump. A complete handover normally uses about four battery-command steps, while the requested total battery power can still change immediately for P1 regulation and Peak Guard. Safety limits such as per-battery SoC availability remain immediate.

### 1.0.3

Optional multi-battery efficiency optimization concentrates charging and discharging around an individually configurable power target for each battery (default 1000 W), selecting batteries by SoC. The power distribution follows each active battery’s target and respects its power limits. Existing installations retain their previous shared target as the default. It is available from two batteries and uses a minimum 2% balance deadband. Planning diagnostics show individual targets and battery rotations.

### 1.0.2

Savings now retains compact daily history for up to five years. The Savings tab adds rolling periods, selectable historical calendar months and years, storage details and CSV export with clipboard copy. The Savings widget adds This month, Previous month and configurable Rolling days, with shared cached historical totals. The settings tab bar now folds into a compact active-tab selector and closes automatically after a tab is chosen.

### 1.0.1

EV charging now has an independent one-minute heartbeat for evaluation and changed-command publication, without waiting for a battery command. Per-EV minimum command intervals and stop holds remain active; urgent safety reductions retain their immediate path. Independent decisions use current tariff and meter data, reserve pending battery charging including Split Command minimum power, and do not count future battery discharge as available headroom.

Battery feedback now skips full evaluations when a lightweight check confirms exactly the same published battery commands. The check reuses battery limits, SoC protection, balancing and power rounding; Peak Guard, EV target changes, live-PV changes, zone transitions and safety events retain their existing control paths. Fast detection now uses the same EV-adjusted grid target as battery control. CPU diagnostics include feedback preflight time, skipped evaluations and evaluation reasons.

### 1.0.0

EV sessions now distinguish charging, paused and completed. Missing mode-controlled charging power for 60 seconds pauses tracking without a Stop latch; sustained P1 load matching the configured mode resumes it automatically. Paused EVs release no grid budget, and household load above the configured mode power cannot inflate EV attribution. Sessions complete through the completion Flow card, a fresh SoC reaching its target, or measured current delivering the requested kWh. Pause preserves targets and session overrides. Live status and widgets show the pause and completion reason.

### 0.9.9

Autotune automatic evaluation now runs through the shared slow context loop. P1, PV and EV measurements still update the lightweight learning statistics immediately, while recommendation decisions remain bounded by the existing 30-minute minimum interval. Background Autotune planning samples, Savings housekeeping and EMS-device refreshes now follow the configured slow-context cadence instead of every 60-second heartbeat; the heartbeat remains responsible for time-critical planning boundaries, freshness and safety checks. Added opt-in diagnostics for Planning, CPU, Errors and Memory. Planning reports include the configuration used for each planning calculation, CPU diagnostics measure the major control/output paths, and all diagnostics automatically switch off after 48 hours.

### 0.9.8

PV live control now follows changes between consecutive PV readings. Large changes select current P1; a subsequent change below the threshold restores the configured averaging. Live PV selection also expires when fresh PV input stops, using the observed input cadence without an extra timer. Repeated P1 readings no longer trigger calculations solely because of the same PV change. The next permitted battery command uses the latest input state.

### 0.9.7

Charge planning now runs in the shared slow context loop. Ordinary SoC, forecast and price updates are combined while respecting the minimum planning interval. Status and widget reads reuse the cached plan. Manual refresh and planning day/phase changes use the same context path; pending updates are processed even without further input.

### 0.9.6
- Corrected cumulative PV-change detection: intermediate calculations no longer reset the reference before a battery command is published.
- Significant PV changes use live P1 at the next permitted command moment, including planned charging.

### 0.9.5
- Choose which tariffs use the sunshine reserve; expensive/peak periods are excluded by default.
- Added an optional sunshine-based discharge reserve with four configurable probability ranges and minimum SoC values.
- Added a dated today/tomorrow sunshine forecast Flow input, automatic day selection and Dutch/English status text.

### 0.9.4
- Corrected English dynamic tariff labels with prices and price classifications.
- Completed English translations in settings, validation messages, live status, widgets and readable Flow values.
- Added shared translation of dynamic battery, EV, HVAC, boiler and Safety SoC messages.

### 0.9.2
- Added a persistent 2-percentage-point restart margin after reaching a battery charging target.
- Automatic Safety SoC recovery bypasses the restart margin and tariff windows within power limits.
- Solar-surplus capture remains available inside the restart margin.

### 0.9.1
- Corrected EV grid-import accounting to prevent unwanted continued battery charging.
- Coordinated EV-first, battery-first and shared grid charging within one site import budget.
- Battery charging status now distinguishes grid energy from measured solar surplus.

### 0.8.9
- Planned charging keeps capturing solar surplus using P1 feedback, including when the grid meter reaches zero.
- Optional grid charging during normal dynamic price hours, capped by a separate maximum SoC and the planning target.
- Charge planning includes allowed normal-price windows before the deadline.

### 0.8.6

Choose Homey Energy, an external price service, or either as primary with the other as fallback. Secondary prices are aligned to the primary price level. Homey price formulas, including complete {{ … }} expressions with [[price]] tags, and unmodified base prices are supported; unpublished next-day prices do not block today’s curve. The status widget can show both source prices. Each EV has independent emergency-charging permissions per tariff, allowing all tariffs to be selected separately from standard and PV charging.

### 0.8.3

Fixed a settings-page translation loop affecting English and other non-Dutch languages. Added startup time-outs with a settings fallback and a visible error when loading fails. Corrected battery power and HVAC defaults for new installations.

### 0.8.2

Battery feedback now re-evaluates a persistent grid deviation outside the configured zero band, even when the meter changes by less than the signal threshold.

### 0.8.1

The minimum battery command interval now runs from the last published command. A calculation that sends no command no longer restarts the waiting time, allowing a new P1 deviation to be handled as soon as the command interval has expired.

### 0.7.16

Added phase-specific voltage choices for each EV: 230 V by default for single phase and 230 V line-to-line for three phases, with automatic current/power conversion. Current/power conversion, charging plans and Peak Guard checks use the configured voltage. Individual battery settings now include storage capacity in kWh; power sharing, Battery Balance and group SoC/planning account for different capacities while respecting each battery’s power and SoC limits.

### 0.7.15

Mode-only EV grid import is now capped by the configured Smart/Standard mode power as well as detected EV load and the configured EV grid-import allowance, so unrelated household loads cannot increase the EV budget. Renamed the external Hybrid EMS feedback Flow card to “Report external EMS battery power” while keeping the existing card ID and Flow compatibility.

### 0.7.14

Autotune now increases the Low-PV threshold only after a usable learning day actually dropped below 20% battery SoC. If the battery remained at or above 20%, the threshold may still be lowered when the learned PV/outcome data shows it is unnecessarily high.

### 0.7.13

Seasonal summer/winter minimum SoC values now act only as lower floors for day planning and, when enabled, night planning. Forecast demand is always calculated from the technical Minimum SoC, so the seasonal floor is no longer added to the calculated energy shortfall. Autotune will no longer increase Expected energy need unless a usable learning day actually dropped below 20% battery SoC, and automatic management of this parameter now includes a configurable desired battery SoC target.

### 0.7.12

Consolidated numbered Battery, EV and HVAC Flow cards into generic cards. All 31 slot selectors now dynamically offer only configured slots, including inputs, outputs, SoC requests and conditions. EV/HVAC names are shown; zero configured devices gives an empty selection. Numbered cards and previous fixed-dropdown cards remain deprecated but functional for existing Flows.

### 0.7.11

Added a per-EV night-planning option to use only home-battery energy above the calculated night target SoC. Charging starts only when the remaining time and available battery surplus allow more than 1.0 kWh to reach that EV; after start it may continue until the battery target is reached. This source never grants grid import, remains bounded by Peak Guard and battery limits, and works across EV 1 through EV 4.

### 0.7.10

Added EV session start/end tracking for EV 1 through EV 4, with an explicit end-of-session Flow card and status in Live view, the EMS device and status widget. Mode-controlled grid charging now learns a bounded forty-minute physical house-load reference from existing P1/PV inputs, releases only detected EV load above that reference, and restores normal battery control after one minute near the reference. Multi-EV handling remains portfolio-based and Peak Guard stays absolute.

### 0.7.9

Fixed EV PV coordination after a STOP: stale current or mode feedback can no longer finance an immediate restart. External Hybrid EMS battery charging now keeps its physical PV share, and SoC-target mode control can fall back to Smart without creating unauthorized grid demand. Shared limits are verified for one to four EVs across Current, Mode and Hybrid control.

### 0.7.8

Safety and reliability fixes: stale grid measurements can no longer start or keep HVAC/boiler loads running, delayed HVAC Flow outputs are serialized with a bounded latest-wins queue, tomorrow pricing uses the next local calendar day, queued status updates can no longer get stranded, negative purchase prices remain signed in Savings, stale measurements no longer keep accumulating costs, and invalid null/blank grid inputs no longer refresh the meter as 0 W.

### 0.7.7

Version bump of the final 0.7.6 candidate with no additional functional changes.

### 0.7.6

Fixed EV configuration visibility and strengthened multi-EV safety: Smart, SoC-target and Emergency now share one physical Peak Guard budget according to EV weights, candidate battery commands can no longer create virtual EV headroom, guaranteed EV grid charging correctly shifts the battery meter target, and Hybrid EMS stays under HomeFlux ownership whenever EV grid import is intentionally allowed. EV Settings now also show Peak Guard charging headroom from an optional idle-house-load estimate, including the usable current or mode for Battery Save/no-reserve and self-consumption scenarios without adding runtime polling. Boiler tariff fallback now counts fully missed solar-day windows instead of elapsed 24-hour time since the last cycle, so a missed day can unlock the selected night tariff without the fallback clock drifting with the previous completion time; the status widget also shows the solar-day count and countdown to fallback.

### 0.7.5

Follow-up test fixes: EV settings now only show configured EVs. Autotune keeps dropdown-backed values UI-safe and uses realistic parameter-specific automatic-management ranges that respect configured SoC, EV and hard safety limits.

### 0.7.4

Fixed Autotune handling for dropdown-backed settings and replaced the temporary +/-50% auto-management ranges with realistic parameter-specific defaults. SoC-related ranges respect the configured Maximum SoC, while user-defined ranges remain adjustable. Recommendations, one-off changes and automatic management only use values that the Settings UI can represent.

### 0.7.3

Autotune now uses a configurable confidence threshold (95% by default) plus per-parameter confidence and minimum/maximum boundaries for automatic changes. Savings now includes PV export/feed-in value, supports exported-energy calibration and a live export-price Flow input, with signed export prices for fixed and multi-rate tariffs.

### 0.7.2

Added persistent guaranteed EV minimum targets by SoC or required kWh, with clear settings fallback and favourable-charging behaviour after the minimum is reached. Hybrid ownership is now more visible in the status widget and EMS device. Improved device/widget guidance in battery configuration and documentation.

### 0.7.1

Reorganized EMS configuration, added two-step battery direction testing, renamed Finetuning to Autotune, introduced Hybrid EMS for external self-consumption control with one or multiple batteries, and changed the license to GPL-3.0-only.

### 0.6.7

Improved Automatic Finetuning interaction. Permission now belongs to the parameter itself, so a recommendation that disappears between rendering and clicking no longer causes an invalid-parameter error. Each recommendation now has Apply this time for a one-off adjustment and Do not check again to suppress future checks. Suppressed parameters are listed at the bottom of the Finetuning tab and can be re-enabled at any time.

### 0.6.6

Added an optional battery support mode for essential tariff boiler heating. When enabled, planned battery grid charging yields first and the battery may temporarily discharge to keep the boiler within Peak Guard while respecting the boiler stop reserve, minimum SoC and discharge limits. If the battery cannot bring import back under the hard limit within a bounded response window, Peak Guard still switches the boiler off. Also fixed the status widget so a running boiler supported by Peak Guard is shown as heating, not as disabled.

### 0.6.5

Improved self-consumption status so HomeFlux clearly explains when battery discharge is paused by an applicable SoC floor. Essential tariff boiler heating now gets priority over planned grid battery charging: battery charge power dynamically yields to reserve Peak Guard headroom, then automatically increases again after the boiler finishes. Peak Guard remains a hard safety limit.

### 0.6.4

Expanded Automatic Finetuning to recommend more non-hard-limit control parameters, with special planning intelligence for the low-PV threshold and expected energy need. HomeFlux now learns from up to 14 compact daily summaries to relate PV forecast to achieved battery SoC and estimate non-EV daily demand, helping the battery reach roughly 90–100% during useful solar hours while reducing unnecessary overnight grid charging. Also added recommendations for grid zero-band width, Battery Save discharge floor, battery/PV command cadence, adaptive control parameters and multi-battery balancing. Planning-derived automatic changes are limited to once per day. Hard safety limits and user intent remain protected.

### 0.6.3

Added: Automatic Finetuning with transparent opt-in recommendations for safe, non-critical tuning parameters. It reuses existing P1, PV and EV observations without extra polling, shows only meaningful deviations, and can auto-manage individually approved parameters within conservative limits. Safety limits and user intent such as Peak Guard, minimum SoC, power limits, tariffs, deadlines, comfort settings and priorities are never changed.

### 0.6.2

Fixed battery planning minimum SoC handling. During day planning, the selected-month minimum is now a hard floor only in selected months, while non-selected months use the separate sunny-month minimum only when that option is enabled. When night minimums are enabled, the same applicable monthly minimum is also enforced in night planning. PV forecasts can no longer reduce these absolute minimum floors.

### 0.6.1

Added: per-EV tariff selection, PV charging hysteresis and configurable grid top-up, Current/Mode/Hybrid EV control, deadline planning by SoC or required kWh with optional use of unselected tariffs and warning Flow output. Updated: EV planning is visible in Planning, Live status and the EMS widget. Moved EV and boiler tariff settings to their own tabs without losing existing settings. Added: configurable boiler tariff fallback day/night window. Peak Guard remains absolute.

### 0.5.5

Added: optional external dynamic-price fallback through generic Flow cards for current price and JSON price curves. Updated: EMS status widget shows price fallback health and the next EV decision/wait state.

### 0.5.3

Fixed: EV feedback validation now tolerates configurable reporting deviations of 5%, 10%, 15% or 20%. Fresh EV measurements within tolerance no longer pull the requested charging setpoint backward.

### 0.5.2

Improved: EMS status widget now shows a reason for every battery decision, displays the next tariff with both clock time and remaining time, and shows estimated time to the battery target while charging or to Safety SoC while discharging. No battery-control logic changes.

### 0.5.1

Reworked: EV charging now follows real meter headroom and is controlled through EV setpoints, with weighted multi-EV sharing, optional total EV grid-import limits per tariff and optional home-battery support for extra EV charging power without overriding normal battery control. Fixed: battery discharge no longer creates false EV charging headroom when EV battery support is disabled; permitted EV grid import is released only after the lower charger setpoint has been sent and given a short response grace period. Updated: Live status and the EMS widget now explain temporary/intentional battery discharge during EV charging. Added: configurable direct/5/7/10-second grid regulation with PV-delta and adaptive live control for repeating large load changes, plus read-only EMS/EV/HVAC/boiler Flow condition cards. Updated slogan: Your energy, managed differently / Jouw energie, anders geregeld.

### 0.4.18

Reworked: EV charging now follows real meter headroom and is controlled through EV setpoints, with weighted multi-EV sharing, optional total EV grid-import limits per tariff and optional home-battery support for extra EV charging power without overriding normal battery control. Fixed: battery discharge no longer creates false EV charging headroom when EV battery support is disabled; permitted EV grid import is released only after the lower charger setpoint has been sent and given a short response grace period. Updated: Live status and the EMS widget now explain temporary/intentional battery discharge during EV charging. Added: configurable direct/5/7/10-second grid regulation with PV-delta and adaptive live control for repeating large load changes, plus read-only EMS/EV/HVAC/boiler Flow condition cards. Updated slogan: Your energy, managed differently / Jouw energie, anders geregeld.

### 0.4.17

Fixed: EMS status widget preview images are now fully text-free. No functional EMS logic changes.

### 0.4.16

Fixed: removed obsolete legacy EV/HVAC Flow card definitions from the publishable app manifest.

### 0.4.15

Fixed: exclude generated build output and development metadata from published app packages to prevent obsolete Flow card metadata from being submitted.

### 0.4.14

Updated: EMS status widget planning information. Fixed: removed remaining deprecated HVAC input cards and aligned Flow Help catalog.

### 0.4.13

Added: configurable EMS status widget for tariff, EMS decision/output, battery, Peak Guard, EV, HVAC and boiler status. Fixed: boiler PV-surplus detection now excludes battery-created export. Fixed: PV day/night switching keeps the 10-minute PV-stop delay.

### 0.4.12

Bugfix is savings progress bar

### 0.4.11

Enhanced energy insights for widget. New input card for imported energy today.

### 0.4.10

Added: Savings widget with selectable cost/profit charts, day/month/year views and adjustable refresh intervals. Added: EV Peak Guard support using the home battery during normal and emergency charging. Fixed: Split Command battery feedback and incorrect PV charging classification. Updated: Removed legacy unnumbered EV/HVAC flow cards and improved Savings widget layout.

### 0.4.9

Added: Savings dashboard with daily, weekly, monthly and yearly financial insights. Added: Track savings from direct solar use, battery-stored solar energy and tariff shifting. Added: Homey Insights values for savings today and total savings.

### 0.4.8

Slogan Fix

### 0.4.7

Fixed: per-battery charge and discharge limits are now handled correctly when batteries have different specifications.

### 0.4.6

Language corrections.

### 0.4.5

Added: maximum battery power for each battery. Changes to boiler behavour. Manual modes does not follow plan limits.

### 0.4.3

Minor fix

### 0.4.2

Added: convert low-pv day in a sun day. Updated: improved scheduling.

### 0.3.88

Added: select a daytime hour to ensure safe batterylevel for the evening.

### 0.3.87

Added: adjutable day target hour for charging requirements.

### 0.3.85

Rework of schedules, better and more control.

### 0.3.9

Better feature explanation.
