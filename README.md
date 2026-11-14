# HomeFlux EMS

**Your energy, managed differently**

HomeFlux EMS manages home batteries around your tariff, PV forecast, self-consumption and grid limits. Connect your hardware through Homey Flow cards. EV charging, HVAC and boiler control are optional.

1. Configure battery capacity, power limits, energy contract and Peak Guard in Settings.
2. Supply grid power, PV power, battery SoC and PV forecasts through Flow. Select and connect your price sources for dynamic contracts.
3. Connect the battery output Flows, complete the charge test and enable EMS output.

Use the ⓘ icons in Settings for explanations. Existing and deprecated Flow cards remain supported.

[Configuration and Flow cards](https://github.com/DavyBert/HomeFlux-EMS/discussions/3)

## Release notes — 1.5.2

**NL** — HVAC-prioriteit volgt de ingestelde controle-interval. Alleen een nieuwe, daadwerkelijke verwarmings- of koelstart kan één eerdere controle aanvragen zodra de laatste start oud genoeg is. Een reeds draaiende HVAC, PV-overschot zonder warmtevraag of een ongewijzigde wachtende aanvraag veroorzaakt geen extra controles. Het HVAC-regelinterval geldt nu per toestel. Na een werkelijk verzonden wijziging zijn vervolgacties gedurende 10 seconden direct mogelijk. Pas na 10 seconden zonder wijziging begint de ingestelde wachttijd. Identieke opdrachten herstarten die tijd niet en veiligheidsstops blijven onmiddellijk.

**EN** — HVAC priority follows the configured evaluation interval. Only a genuine new heating or cooling start can request one early check once the last start is old enough. Already running HVACs, PV surplus without heating demand and unchanged pending requests do not trigger repeated checks. The HVAC control interval now applies per device. After a successfully published change, follow-up actions are allowed immediately for 10 seconds. The configured wait starts only after 10 seconds without a change. Identical commands do not restart it, and safety stops remain immediate.

**FR** — La priorité HVAC respecte l’intervalle de contrôle configuré. Seul un nouveau démarrage réel de chauffage ou de refroidissement peut demander un contrôle anticipé après le délai depuis le dernier démarrage. Les unités déjà actives, le surplus photovoltaïque sans demande et les demandes en attente inchangées ne relancent pas les contrôles. L’intervalle de réglage HVAC s’applique désormais à chaque appareil. Après une modification réellement envoyée, les actions suivantes sont immédiates pendant 10 secondes. L’attente configurée ne commence qu’après 10 secondes sans modification. Les commandes identiques ne relancent pas ce délai et les arrêts de sécurité restent immédiats.

**DE** — Die HVAC-Priorität folgt dem eingestellten Prüfintervall. Nur ein tatsächlicher neuer Heiz- oder Kühlstart darf nach Ablauf der Wartezeit seit dem letzten Start eine vorzeitige Prüfung auslösen. Laufende HVACs, PV-Überschuss ohne Wärmebedarf und unveränderte wartende Anfragen lösen keine wiederholten Prüfungen aus. Das HVAC-Regelintervall gilt nun je Gerät. Nach einer tatsächlich gesendeten Änderung sind Folgeaktionen 10 Sekunden lang sofort möglich. Erst nach 10 Sekunden ohne Änderung beginnt die eingestellte Wartezeit. Identische Befehle starten sie nicht neu; Sicherheitsabschaltungen bleiben sofort wirksam.

**ES** — La prioridad HVAC sigue el intervalo de evaluación configurado. Solo un nuevo arranque real de calefacción o refrigeración puede solicitar una comprobación anticipada si ha transcurrido el plazo desde el último arranque. Las unidades ya activas, el excedente fotovoltaico sin demanda y las solicitudes pendientes sin cambios no provocan comprobaciones repetidas. El intervalo de control HVAC se aplica ahora por dispositivo. Tras un cambio realmente enviado, se permiten acciones posteriores inmediatas durante 10 segundos. La espera configurada comienza solo después de 10 segundos sin cambios. Los comandos idénticos no la reinician y las paradas de seguridad siguen siendo inmediatas.

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
