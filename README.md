# HomeFlux EMS

**Your energy, managed differently**

HomeFlux EMS manages home batteries around your tariff, PV forecast, self-consumption and grid limits. Connect your hardware through Homey Flow cards. EV charging, HVAC and boiler control are optional.

1. Configure battery capacity, power limits, energy contract and Peak Guard in Settings.
2. Supply grid power, PV power, battery SoC and PV forecasts through Flow. Select and connect your price sources for dynamic contracts.
3. Connect the battery output Flows, complete the charge test and enable EMS output.

Use the ⓘ icons in Settings for explanations. Existing and deprecated Flow cards remain supported.

[Configuration and Flow cards](https://github.com/DavyBert/HomeFlux-EMS/discussions/3)

## Release notes — 1.5.8

**NL** — De SOC-widgetprognose berekent toekomstige laadbehoefte opnieuw met de voorspelde SOC; een klein actueel laadplan begrenst de voorspelling niet meer.
Dag- en nachtdoelen, beschikbare laadcapaciteit en de bestaande dynamische uitstelvoorwaarden worden in de prognose gevolgd.
Verbeterde voorspelling rond 07:00/17:00, ontbrekende prijsgegevens en zomer- en wintertijd. De werkelijke EMS-regeling blijft ongewijzigd.

**EN** — The SoC widget forecast recalculates future charging needs from the predicted SoC; a small current charging plan no longer caps the forecast.
The projection follows day/night targets, available charging capacity and the existing dynamic charging deferral conditions.
Improved forecasts around 07:00/17:00, missing price data and daylight-saving transitions. Actual EMS control remains unchanged.

**FR** — La prévision SoC du widget recalcule les besoins futurs à partir du SoC prévu ; un petit plan actuel ne limite plus la prévision.
La projection respecte les objectifs jour/nuit, la capacité de recharge disponible et les conditions existantes de report dynamique.
Prévision améliorée autour de 07:00/17:00, des prix manquants et des changements d’heure. La régulation EMS réelle reste inchangée.

**DE** — Die SoC-Widget-Prognose berechnet den künftigen Ladebedarf aus dem vorhergesagten SoC neu; ein kleiner aktueller Ladeplan begrenzt die Prognose nicht mehr.
Die Vorschau berücksichtigt Tages- und Nachtziele, verfügbare Ladeleistung und die bestehenden Bedingungen für dynamischen Ladeaufschub.
Verbesserte Prognose bei 07:00/17:00, fehlenden Preisen und Zeitumstellungen. Die tatsächliche EMS-Regelung bleibt unverändert.

**ES** — La previsión SoC del widget recalcula la carga futura a partir del SoC previsto; un pequeño plan actual ya no limita la previsión.
La proyección sigue los objetivos de día/noche, la capacidad de carga disponible y las condiciones existentes de aplazamiento dinámico.
Previsión mejorada alrededor de las 07:00/17:00, con precios ausentes y cambios de hora. El control EMS real no cambia.

## Release notes — 1.5.7

**NL** — Zelfstandige SoC-prognose op basis van energiestromen, met toekomstige laadvensters en onderscheid tussen bestaande EMS-plannen en widgetschattingen.
Compact uitgelijnd dagoverzicht en laadplan, met contractafhankelijke tarieflegenda.
Gedeelde P1-huisverbruikshistoriek met tijdgewogen vijfminutenmetingen en incrementele updates.
Hergebruik van prognosegegevens en compacte planningssnapshots vermindert herhaalde widgetverwerking.

**EN** — Independent energy-based SoC forecast with future charging windows and a clear distinction between existing EMS plans and widget estimates.
Compact aligned daily overview and charging values, with contract-specific tariff legends.
Shared P1 house-load history with time-weighted five-minute samples and incremental updates.
Cached forecast inputs and compact planning snapshots reduce repeated widget processing.

**FR** — Prévision SoC indépendante fondée sur les flux d’énergie, avec fenêtres de charge futures et distinction entre plans EMS existants et estimations du widget.
Vue journalière et valeurs de charge compactes et alignées, avec légende tarifaire adaptée au contrat.
Historique partagé de consommation P1, moyennes pondérées sur cinq minutes et mises à jour incrémentales.
Réutilisation des données de prévision et instantanés de planification compacts pour réduire les traitements répétés.

**DE** — Eigenständige SoC-Prognose aus Energieflüssen mit zukünftigen Ladefenstern und klarer Unterscheidung zwischen EMS-Plänen und Widget-Schätzungen.
Kompakte, ausgerichtete Tagesübersicht und Ladewerte mit vertragsabhängiger Tariflegende.
Gemeinsamer P1-Hausverbrauchsverlauf mit zeitgewichteten Fünf-Minuten-Mittelwerten und inkrementellen Updates.
Zwischengespeicherte Prognosedaten und kompakte Planungsschnappschüsse reduzieren wiederholte Widget-Verarbeitung.

**ES** — Previsión SoC independiente basada en flujos de energía, con futuras ventanas de carga y distinción entre planes EMS y estimaciones del widget.
Resumen diario y valores de carga compactos y alineados, con leyenda de tarifas según el contrato.
Historial compartido de consumo P1 con medias ponderadas de cinco minutos y actualizaciones incrementales.
Reutilización de datos de previsión e instantáneas de planificación compactas para reducir el procesamiento repetido.

## Release notes — 1.5.6

**NL** — Visual Look-widget: volledige EV-historiek komt mee in hetzelfde statuspakket als de woningsavings, voor alle periodes en ingestelde EV’s. Zonnevoordeel, netkosten en laadenergie worden rechtstreeks ingelezen, zonder aparte EV-opvraging.

**EN** — Visual Look widget: complete EV history is included in the same status snapshot as house Savings, for all periods and configured EVs. Solar savings, grid costs and charging energy are read directly without a separate EV request.

**FR** — Widget Visual Look : l’historique complet des VE est inclus dans le même statut que les économies de la maison, pour toutes les périodes et tous les VE configurés. Valeurs solaires, coûts réseau et énergie sont lus directement, sans requête VE séparée.

**DE** — Visual-Look-Widget: Der vollständige EV-Verlauf wird für alle Zeiträume und eingerichteten Fahrzeuge im selben Statuspaket wie die Hauseinsparungen geliefert. Solarvorteil, Netzkosten und Ladeenergie werden ohne separate EV-Abfrage direkt eingelesen.

**ES** — Widget Visual Look: el historial completo de los VE llega en la misma instantánea de estado que el ahorro del hogar, para todos los periodos y vehículos configurados. El ahorro solar, los costes de red y la energía se leen directamente sin otra solicitud de VE.

## Release notes — 1.5.5

**NL** — Dynamische uur- en kwartierprijzen: netladen voor het ochtend- en avonddoel kan worden uitgesteld naar aantoonbaar goedkopere uren.
Bij dure tussenliggende uren blijft batterijreserve voorzien. Alle contracttypes starten de dagplanning op het ingestelde ochtenddoelmoment, ook zonder ontvangen PV-productie. De veiligheidsregeling blijft behouden. De resterende minuten van het actuele goedkope uur of kwartier blijven meetellen voor de laadspreiding.

**EN** — Dynamic hourly and 15-minute tariffs: grid charging for morning and evening targets may be deferred to demonstrably cheaper hours.
Battery reserve is provided for intervening expensive periods. All contract types start daytime planning at the configured morning target time, even without received PV production. Safety controls remain unchanged. The remaining minutes of the current cheap hour or quarter-hour stay available for charge spreading.

**FR** — Tarifs dynamiques horaires et au quart d’heure : la recharge réseau peut être reportée après les objectifs matin et soir si les heures suivantes sont moins chères.
Une réserve batterie est prévue pour les périodes chères intermédiaires. Tous les contrats démarrent la planification de jour à l’heure cible du matin, même sans production photovoltaïque reçue. Les sécurités sont conservées. Les minutes restantes de l’heure ou du quart d’heure bon marché en cours restent disponibles pour répartir la recharge.

**DE** — Dynamische Stunden- und Viertelstundenpreise: Netzladen für Morgen- und Abendziele kann auf nachweislich günstigere Zeitfenster verschoben werden.
Für teure Zwischenzeiten wird Batteriereserve vorgesehen. Alle Vertragsarten starten die Tagesplanung zur eingestellten Morgenzielzeit, auch ohne empfangene PV-Produktion. Schutzfunktionen bleiben erhalten. Die verbleibenden Minuten der aktuellen günstigen Stunde oder Viertelstunde werden weiter für die Ladeverteilung berücksichtigt.

**ES** — Tarifas dinámicas por hora y cuarto de hora: la carga de red para los objetivos de mañana y tarde puede aplazarse a horas más baratas.
Se prevé una reserva de batería para los periodos caros intermedios. Todos los contratos inician la planificación diurna a la hora objetivo de la mañana, incluso sin datos de producción fotovoltaica. Se mantienen los controles de seguridad. Los minutos restantes de la hora o cuarto de hora barato actual siguen contando para distribuir la carga.

## Release notes — 1.5.4

**NL** — Nieuwe Visual Look in de EMS Status-widget: live energieoverzicht met SOC-prognose, tarieven, WAF en Savings.
Instelbare kleuren en transparantie per thema, met indicatie ‘Externe EMS’.

**EN** — New Visual Look in the EMS Status widget: live energy overview with SoC forecast, tariffs, WAF and Savings.
Custom colors and transparency for both themes, with an “Externe EMS” indicator.

**FR** — Nouveau Visual Look dans le widget EMS Status : bilan en direct, prévision SoC, tarifs et économies.
Couleurs et transparence par thème, avec indication « Externe EMS ».

**DE** — Neuer Visual Look im EMS Status Widget: Live-Energieübersicht, SoC-Prognose, Tarife und Einsparungen.
Farben und Transparenz je Design anpassbar, mit „Externe EMS“-Hinweis.

**ES** — Nuevo Visual Look en el widget EMS Status: energía en directo, previsión de SoC, tarifas y ahorros.
Colores y transparencia por tema, con indicador «Externe EMS».

## Release notes — 1.5.3

**NL** — Dynamische tarieven: de volgende tariefwisseling gebruikt de echte, datumgebonden prijzen van morgen. De actuele en volgende tarieven worden consistent weergegeven; zonder morgenprijzen wordt geen onjuiste volgende prijs getoond.

**EN** — Dynamic tariffs: the next tariff transition uses actual date-stamped prices for tomorrow. Current and upcoming tariffs are displayed consistently; no incorrect future price is shown when tomorrow prices are unavailable.

**FR** — Tarifs dynamiques : la prochaine transition utilise les prix réels datés de demain. Les tarifs actuels et suivants sont affichés de manière cohérente ; aucun prix futur incorrect ne s’affiche si ceux de demain sont indisponibles.

**DE** — Dynamische Tarife: Der nächste Tarifwechsel verwendet die tatsächlichen datierten Preise von morgen. Aktuelle und folgende Tarife werden konsistent angezeigt; wenn die Preise für morgen fehlen, wird kein falscher Folgepreis angezeigt.

**ES** — Tarifas dinámicas: el siguiente cambio de tarifa utiliza los precios reales fechados de mañana. Los precios actuales y siguientes se muestran de forma coherente; si faltan los precios de mañana, no se muestra un precio futuro incorrecto.

## Release notes — 1.5.2

**NL** — HVAC-prioriteit volgt de ingestelde controle-interval. Alleen een nieuwe, daadwerkelijke verwarmings- of koelstart kan één eerdere controle aanvragen zodra de laatste start oud genoeg is. Een reeds draaiende HVAC, PV-overschot zonder warmtevraag of een ongewijzigde wachtende aanvraag veroorzaakt geen extra controles. Het HVAC-regelinterval geldt nu per toestel. Na een werkelijk verzonden wijziging zijn vervolgacties gedurende 10 seconden direct mogelijk. Pas na 10 seconden zonder wijziging begint de ingestelde wachttijd. Identieke opdrachten herstarten die tijd niet en veiligheidsstops blijven onmiddellijk. Dynamische tarieven: de volgende tariefwisseling gebruikt de werkelijke, gedateerde prijzen van morgen in plaats van de prijzen van het begin van vandaag. De bestaande dagelijkse indeling, EV- en batterijplanning blijven behouden. Zonder morgenprijzen wordt geen volgende prijs verzonnen.

**EN** — HVAC priority follows the configured evaluation interval. Only a genuine new heating or cooling start can request one early check once the last start is old enough. Already running HVACs, PV surplus without heating demand and unchanged pending requests do not trigger repeated checks. The HVAC control interval now applies per device. After a successfully published change, follow-up actions are allowed immediately for 10 seconds. The configured wait starts only after 10 seconds without a change. Identical commands do not restart it, and safety stops remain immediate. Dynamic tariffs: the next tariff transition now uses actual date-stamped prices for tomorrow instead of repeating the start of today. Existing daily classification, EV and battery planning remain unchanged. Missing tomorrow prices are never invented.

**FR** — La priorité HVAC respecte l’intervalle de contrôle configuré. Seul un nouveau démarrage réel de chauffage ou de refroidissement peut demander un contrôle anticipé après le délai depuis le dernier démarrage. Les unités déjà actives, le surplus photovoltaïque sans demande et les demandes en attente inchangées ne relancent pas les contrôles. L’intervalle de réglage HVAC s’applique désormais à chaque appareil. Après une modification réellement envoyée, les actions suivantes sont immédiates pendant 10 secondes. L’attente configurée ne commence qu’après 10 secondes sans modification. Les commandes identiques ne relancent pas ce délai et les arrêts de sécurité restent immédiats. Tarifs dynamiques : la prochaine transition utilise les prix réels datés de demain, au lieu de répéter les premiers prix d’aujourd’hui. Le classement quotidien et la planification VE/batterie restent inchangés. Aucun prix futur n’est inventé si ceux de demain manquent.

**DE** — Die HVAC-Priorität folgt dem eingestellten Prüfintervall. Nur ein tatsächlicher neuer Heiz- oder Kühlstart darf nach Ablauf der Wartezeit seit dem letzten Start eine vorzeitige Prüfung auslösen. Laufende HVACs, PV-Überschuss ohne Wärmebedarf und unveränderte wartende Anfragen lösen keine wiederholten Prüfungen aus. Das HVAC-Regelintervall gilt nun je Gerät. Nach einer tatsächlich gesendeten Änderung sind Folgeaktionen 10 Sekunden lang sofort möglich. Erst nach 10 Sekunden ohne Änderung beginnt die eingestellte Wartezeit. Identische Befehle starten sie nicht neu; Sicherheitsabschaltungen bleiben sofort wirksam. Dynamische Tarife: Der nächste Tarifwechsel nutzt die tatsächlichen datierten Preise von morgen, statt den Tagesanfang von heute zu wiederholen. Die tägliche Einstufung sowie EV- und Batterieplanung bleiben unverändert. Fehlende Preise für morgen werden nicht erfunden.

**ES** — La prioridad HVAC sigue el intervalo de evaluación configurado. Solo un nuevo arranque real de calefacción o refrigeración puede solicitar una comprobación anticipada si ha transcurrido el plazo desde el último arranque. Las unidades ya activas, el excedente fotovoltaico sin demanda y las solicitudes pendientes sin cambios no provocan comprobaciones repetidas. El intervalo de control HVAC se aplica ahora por dispositivo. Tras un cambio realmente enviado, se permiten acciones posteriores inmediatas durante 10 segundos. La espera configurada comienza solo después de 10 segundos sin cambios. Los comandos idénticos no la reinician y las paradas de seguridad siguen siendo inmediatas. Tarifas dinámicas: el siguiente cambio usa los precios reales fechados de mañana, en lugar de repetir los del comienzo de hoy. Se mantienen la clasificación diaria y la planificación de VE y batería. Si faltan precios de mañana, no se inventan.

## Release notes — 1.5.1

**NL** — HVAC-prioriteit: een nieuwe startvraag wordt meteen beoordeeld als er sinds de appstart nog geen prioriteitsstart was of de ingestelde wachttijd sinds de laatste echte start verstreken is. Een controle zonder start verlengt de wachttijd niet.

**EN** — HVAC priority: a new start request is assessed immediately if no priority start has occurred since app startup or the configured interval since the last actual start has elapsed. A check without a start does not extend the wait.

**FR** — Priorité HVAC : une nouvelle demande de démarrage est évaluée immédiatement si aucun démarrage prioritaire n’a eu lieu depuis le lancement ou si l’intervalle configuré depuis le dernier démarrage effectif est écoulé. Un contrôle sans démarrage ne prolonge pas l’attente.

**DE** — HVAC-Priorität: Eine neue Startanforderung wird sofort geprüft, wenn seit dem App-Start noch kein priorisierter Start erfolgt ist oder das eingestellte Intervall seit dem letzten tatsächlichen Start abgelaufen ist. Prüfungen ohne Start verlängern die Wartezeit nicht.

**ES** — Prioridad HVAC: una nueva solicitud de arranque se evalúa de inmediato si no se ha producido un arranque prioritario desde el inicio o si ha transcurrido el intervalo configurado desde el último arranque real. Las comprobaciones sin arranque no prolongan la espera.

## Release notes — 1.3.6

**NL** — HVAC-vermogensleren gebruikt nu het actuele HomeFlux-batterijcommando of de laatst gerapporteerde externe EMS-waarde. Een aparte batterijvermogensmeting is niet langer vereist; wijzigingen tijdens het leren worden meegenomen.

**EN** — HVAC power learning now uses the current HomeFlux battery command or the latest external EMS report. A separate battery power measurement is no longer required; changes during learning are taken into account.

**FR** — L'apprentissage de la puissance HVAC utilise désormais la commande batterie HomeFlux actuelle ou la dernière valeur transmise par l’EMS externe. Une mesure de puissance batterie distincte n’est plus nécessaire ; les changements pendant l’apprentissage sont pris en compte.

**DE** — Das HVAC-Leistungslernen verwendet jetzt den aktuellen HomeFlux-Batteriebefehl oder den zuletzt gemeldeten Wert des externen EMS. Eine separate Batterieleistungsmessung ist nicht mehr erforderlich; Änderungen während des Lernens werden berücksichtigt.

**ES** — El aprendizaje de potencia HVAC utiliza ahora la orden actual de batería de HomeFlux o el último valor comunicado por el EMS externo. Ya no requiere una medición independiente de potencia de batería; los cambios durante el aprendizaje se tienen en cuenta.

## Release notes — 1.4.5

**NL** — AutoTune: alle voorstellen ondersteunen nu automatisch beheren, nu toepassen of niet meer controleren. Beheerde parameters blijven zichtbaar en kunnen opnieuw handmatig worden gezet.

**EN** — AutoTune: every recommendation now supports auto-manage, apply now or do not check again. Managed parameters stay visible and can be switched back to manual.

**FR** — AutoTune : toutes les recommandations proposent désormais la gestion automatique, l’application immédiate ou l’arrêt du contrôle. Les paramètres gérés restent visibles et peuvent repasser en mode manuel.

**DE** — AutoTune: Alle Empfehlungen bieten jetzt automatische Verwaltung, sofortiges Anwenden oder keine weitere Prüfung. Verwaltete Parameter bleiben sichtbar und können wieder auf manuell gestellt werden.

**ES** — AutoTune: todas las recomendaciones permiten gestión automática, aplicar ahora o dejar de comprobar. Los parámetros gestionados permanecen visibles y pueden volver al modo manual.


### EMS-widget · Visual Look-profielen (1.5.4)

De EMS-statuswidget heeft een keuze **Visual Look aan/uit** en **Profiel: Compact, Medium of Full**. Bewerk de drie profielen via **HomeFlux EMS → Instellingen → EMS-widget**: positie (pijlen), tonen/verbergen, standaard inklappen, achtergrond, kaarten en optionele onderdeelkleuren, apart voor licht/donker. Standaardkleuren, een kleurkiezer en eigen HEX zijn beschikbaar. Klik **Profiel opslaan**; open daarna het dashboard opnieuw.

De drie profielen worden gezamenlijk opgeslagen onder de afzonderlijke private Homey-sleutel `_emsVisualWidgetProfilesV1`. Dit is **niet** onderdeel van `getSettings()` en triggert geen EMS-regel- of planningsupdate. Alle dashboardwidgets die hetzelfde profiel selecteren, gebruiken dezelfde configuratie. Klassieke tekstwidgetinstellingen blijven beschikbaar en ongewijzigd; de oudere afzonderlijke Visual Look-widget blijft voor bestaande dashboards bestaan. Bestaande per-widget opgeslagen Visual Look-indelingen worden niet automatisch overgenomen.

