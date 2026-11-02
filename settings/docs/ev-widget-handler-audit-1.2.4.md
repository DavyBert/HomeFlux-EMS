# Verplichte Scheduler-codecontrole — vóór implementatie uitgevoerd

Uitgangspunt: volledige, gecontroleerde HomeFlux EMS 1.2.3 (614 bestanden).

**Conclusie: veilig herbruikbaar via een dunne invoeradapter. Geen wijziging aan EV-planning of fysieke sturing nodig.** De gate-test `test/ev-widget-handler-audit-1.2.4.test.js` is vóór de Scheduler-implementatie uitgevoerd en geslaagd. De vier bevindingen staan in het gelijknamige validatiebestand.

## Bestaand pad

- `app.js/registerFlowCards`: genummerde `set_evN_soc_deadline` en `set_evN_energy_deadline` listeners controleren het geconfigureerde aantal en roepen `setEvSocPlan(index, target_soc, time, guarantee)` respectievelijk `setEvEnergyPlan(index, energy, time, guarantee)` aan.
- `lib/flow-slot-cards.js/SlotFlowCards`: de selector-kaarten gebruiken dezelfde listeners uit `slotFlowCards.actions`; slots zijn stabiel 1–4, interne index is slot minus één.
- `lib/configured-flow-cards.js/ConfiguredFlowCards`: autocomplete `{kind:'ev', id:'N', name:...}` wordt gevalideerd en naar dezelfde slotroute geleid. Namen zijn geen identiteit.
- `app.js/setEvSocPlan`: bestaand bereik 1–100%, HH:mm-validatie, `yes`/boolean Guaranteed; validatie vóór mutatie. Legt SoC-doel vast en schakelt het kWh-override uit.
- `app.js/setEvEnergyPlan`: bestaande eindige numerieke invoer 0–250 kWh, HH:mm en Guaranteed; validatie vóór mutatie. `energy` betekent het ingediende kWh-minimum (`targetKwh`), niet de afnemende `remainingKwh`. Legt kWh-doel vast en schakelt het SoC-override uit.
- De bestaande `findNextLocalTime` in deze centrale invoerfuncties bepaalt de doeloccurrence. De widget mag zelf geen deadline-datum berekenen.
- `persistEvSocPlanOverrides`/`persistEvEnergyPlanOverrides` schrijven bestaande `evSocDeadlineOverrides`/`evEnergyDeadlineOverrides`; de bestaande restorefuncties herstellen die bij opstart.
- `markEvPlanChanged` en `requestContextEvaluate` vragen daarna de bestaande contextverwerking aan. Beslissingen worden genomen door de bestaande deadlineplanner, tarief- en EV-controlfuncties; de invoeradapter mag die niet vervangen.

## Veiligheid en gelijktijdigheid

Beide centrale invoerfuncties zijn synchroon. De async Flow-listener roept die onmiddellijk aan, zonder `await` vóór het committen. Een widgetadapter kan dus de actuele centrale parameters lezen en onmiddellijk de geregistreerde listener aanroepen; geen andere Flow/widgetaanroep kan daartussen in dezelfde JavaScript-eventloop binnenkomen. Er is geen nieuwe lock of plannerarchitectuur nodig.

De adapter dient alleen de bevestigde gewijzigde parameter in; de overige parameters worden server-side uit het actuele actieve override gelezen. Een volledig lokaal concept mag alleen een ontbrekend plan aanmaken. Als een Flow intussen een plan heeft gemaakt, wordt dat concept afgewezen in plaats van teruggeschreven. Een begrensde request-ID-cache voorkomt dubbele API-verwerking. De widget stuurt geen directe EV-commando's.

Het bestaande herindienen van een veranderd kWh-doel/deadline/Guaranteed kan het kWh-minimum opnieuw armeren. Dat is de bestaande Flow-betekenis van `setEvEnergyPlan` en wordt niet stilzwijgend veranderd. Er worden geen interne progressvelden rechtstreeks gewijzigd.

De tests tonen synchrone zichtbaarheid vóór het awaiten, behoud van een nieuwer 90%-Flow-doel bij een deadlinepatch, afwijzing vóór mutatie, EV-isolatie en herstel van beide soorten overrides na herstart zonder thuisbatterij of actieve batterijregeling. Planner- en sturingsfuncties blijven bij oplevering via exacte bronvergelijking gecontroleerd.
