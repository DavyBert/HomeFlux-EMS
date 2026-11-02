# Flow card migration - 0.7.12 (configured slots)

## English

All Battery, EV and HVAC slot selectors in newly offered Flow cards use dynamic autocomplete. The saved device counts determine which choices are offered: Battery 1 up to the configured count (maximum 8), EV 1 up to its count (maximum 4), and HVAC 1 up to its count (maximum 4). At count 0 the selector has no results. The app-wide Flow card itself remains in the new-card list.

EV and HVAC choices show the stable slot number plus the configured name. Changing a name does not change which channel a saved card addresses. Counts and names are read afresh for each selection query; save the settings and reopen the selector. A configured device remains selectable when disconnected or when its automatic control is temporarily off. This is necessary to feed its first measurement or enable it through Flow.

The 31 autocomplete replacements cover 13 input actions, 13 output/request triggers and 5 conditions. This includes the previously generic Set battery SoC action and EV/HVAC conditions. There are still 75 visible app-wide cards: 29 actions, 26 triggers and 20 conditions. Group battery commands, group setpoints, balance warnings and the shared HVAC outdoor-temperature input remain group functions.

Compatibility is retained at both levels. The 120 original numbered cards stay deprecated. The 31 fixed-dropdown cards from the first 0.7.12 build are now deprecated as well, with their original IDs, arguments, values, tokens and listeners unchanged. Only the new autocomplete cards are offered for new selections. Their IDs end in `_configured`. Existing Flows are not automatically rewritten and can keep their original cards.

New input cards reject a missing, invalid or no-longer-configured selection with a clear error; they never fall back to device 1. New conditions return false for such selections. Previously saved output selections continue matching their original slot so that a final STOP/0 W event can still be delivered when the engine emits one after a count reduction. The Flow adapter itself does not generate stop commands. Old compatibility cards retain their original behaviour.

When an output is emitted, the numbered, fixed-dropdown and autocomplete card routes are each notified once, without modifying the tokens or command sequencing. Do not keep several output Flows controlling the same equipment when migrating: replace the old card and reconnect its tokens, or disable the old duplicate Flow.

No physical/virtual devices, API permissions, dependencies, polling timers, planning rules or energy settings are added. The autocomplete provider reads HomeFlux settings, not device telemetry or another Homey app.

## Nederlands

Alle slotkeuzes in nieuw aangeboden Batterij-, EV- en HVAC-kaarten zijn dynamische zoeklijsten. Alleen de slots binnen de opgeslagen aantallen verschijnen. Bij 0 toestellen is de selectie leeg; de appbrede Flow-kaart zelf blijft zichtbaar. De ingestelde EV/HVAC-naam wordt naast het slotnummer getoond. Een naamswijziging wijzigt het gekoppelde kanaal niet.

Sla de aantallen eerst op en open daarna de selectie opnieuw. Een geconfigureerd toestel blijft selecteerbaar als het tijdelijk niet aangesloten is of automatische sturing uit staat. De selectie hangt niet af van ontbrekende meetgegevens, zodat de eerste input via Flow mogelijk blijft.

De oorspronkelijke genummerde kaarten en de vaste dropdownkaarten uit de eerste 0.7.12 blijven beschikbaar in bestaande Flows als verouderde compatibiliteitskaarten. Hun IDs, argumenten, tags en handlers zijn behouden. Bestaande Flows worden niet automatisch omgebouwd. Voor nieuwe Flows worden alleen de dynamische alternatieven aangeboden.

Een nieuwe inputkaart met een inmiddels verwijderd slot geeft een duidelijke fout en stuurt nooit een ander slot aan. Een nieuwe voorwaarde geeft dan false. Bestaande outputselecties blijven hun oorspronkelijke slot volgen zodat een eventueel laatste stopcommando niet door het filter wordt tegengehouden. Vervang bij handmatige migratie de oude uitvoerkaart en koppel de tags opnieuw; laat geen dubbele sturende Flows actief.

## Fixed dropdown to autocomplete mapping

| Kind | Deprecated fixed-dropdown ID | New autocomplete ID | Slots offered |
|---|---|---|---|
| actions | `set_battery_soc` | `set_battery_soc_configured` | configured battery slots only |
| actions | `set_ev_status_for` | `set_ev_status_for_configured` | configured ev slots only |
| actions | `set_ev_soc_for` | `set_ev_soc_for_configured` | configured ev slots only |
| actions | `set_ev_session_override_for` | `set_ev_session_override_for_configured` | configured ev slots only |
| actions | `set_ev_energy_deadline_for` | `set_ev_energy_deadline_for_configured` | configured ev slots only |
| actions | `set_ev_soc_deadline_for` | `set_ev_soc_deadline_for_configured` | configured ev slots only |
| actions | `clear_ev_soc_deadline_override_for` | `clear_ev_soc_deadline_override_for_configured` | configured ev slots only |
| actions | `end_ev_charging_session_for` | `end_ev_charging_session_for_configured` | configured ev slots only |
| actions | `set_hvac_room_temperature_for` | `set_hvac_room_temperature_for_configured` | configured hvac slots only |
| actions | `set_hvac_mode_for` | `set_hvac_mode_for_configured` | configured hvac slots only |
| actions | `set_hvac_setpoint_for` | `set_hvac_setpoint_for_configured` | configured hvac slots only |
| actions | `set_hvac_fan_speed_for` | `set_hvac_fan_speed_for_configured` | configured hvac slots only |
| actions | `set_hvac_automatic_control_for` | `set_hvac_automatic_control_for_configured` | configured hvac slots only |
| triggers | `ev_charge_current_updated_for` | `ev_charge_current_updated_for_configured` | configured ev slots only |
| triggers | `ev_charging_allowed_updated_for` | `ev_charging_allowed_updated_for_configured` | configured ev slots only |
| triggers | `ev_charge_mode_updated_for` | `ev_charge_mode_updated_for_configured` | configured ev slots only |
| triggers | `request_ev_soc_needed_for` | `request_ev_soc_needed_for_configured` | configured ev slots only |
| triggers | `hvac_power_updated_for` | `hvac_power_updated_for_configured` | configured hvac slots only |
| triggers | `hvac_mode_updated_for` | `hvac_mode_updated_for_configured` | configured hvac slots only |
| triggers | `hvac_setpoint_updated_for` | `hvac_setpoint_updated_for_configured` | configured hvac slots only |
| triggers | `hvac_fan_updated_for` | `hvac_fan_updated_for_configured` | configured hvac slots only |
| triggers | `request_battery_soc_needed_for` | `request_battery_soc_needed_for_configured` | configured battery slots only |
| triggers | `split_command_battery_charge_mode_for` | `split_command_battery_charge_mode_for_configured` | configured battery slots only |
| triggers | `split_command_battery_discharge_mode_for` | `split_command_battery_discharge_mode_for_configured` | configured battery slots only |
| triggers | `split_command_battery_charge_power_for` | `split_command_battery_charge_power_for_configured` | configured battery slots only |
| triggers | `split_command_battery_discharge_power_for` | `split_command_battery_discharge_power_for_configured` | configured battery slots only |
| conditions | `ev_charging_is_allowed` | `ev_charging_is_allowed_configured` | configured ev slots only |
| conditions | `ev_is_charging` | `ev_is_charging_configured` | configured ev slots only |
| conditions | `ev_is_connected` | `ev_is_connected_configured` | configured ev slots only |
| conditions | `ev_mode_is` | `ev_mode_is_configured` | configured ev slots only |
| conditions | `hvac_is_active` | `hvac_is_active_configured` | configured hvac slots only |

## Upgrade check on a real Homey

1. Keep representative saved numbered cards and fixed-dropdown cards before the update.
2. Install this revised 0.7.12 build. Confirm those saved Flows still load and execute.
3. Save counts of 3 batteries, 0 EVs and 1 HVAC. Open new input, output/request and condition cards: expect Battery 1-3, no EV results, and HVAC 1 only.
4. Change EV count to 2, assign different names, save and reopen a selector. Expect EV 1 and EV 2 with their names. Search by name or slot.
5. Trigger EV 2, HVAC 2 and Battery 2 outputs and verify that only the respective slot Flows execute.
6. When replacing an old output, reconnect its tokens and disable the old duplicate before enabling the new Flow.
7. Verify start and stop commands on actual equipment. Also check the error from a new input Flow after reducing the count below its saved slot.

Local tests use a mock Homey Flow manager. Homey-editor rendering, certification and physical-device operation need a real Homey test.

## SDK references

https://apps.developer.homey.app/the-basics/flow/arguments
https://apps.developer.homey.app/guides/how-to-breaking-changes
