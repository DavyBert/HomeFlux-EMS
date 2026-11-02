# 0.9.2

After a planned battery target has been reached (using the existing 0.25 percentage point completion tolerance), HomeFlux remembers that completion. Planned grid charging can restart when the SoC reaches target minus 2 percentage points. Once restarted, charging continues until the completion tolerance is reached again, subject to tariff eligibility and normal power limits.

For a target of 23.2%, a subsequent reading of 22.5% no longer starts a grid top-up. A reading of 21.2% releases the restart hold. Initial charging toward a target that has not been reached keeps its existing behavior. The normal dynamic-price charging ceiling has a separate completion state.

Small forecast changes do not erase the hold. A change of at least two percentage points in the target, or a transition between daytime and nighttime planning, starts a new target cycle. Midnight alone does not reset the nighttime hold. The state is persisted on transitions and survives app restarts.

In automatic mode, average battery SoC below Safety SoC activates recovery to Safety SoC even outside charging windows or without dynamic price data. Recovery bypasses the EV planning reservation and the restart hold, but respects Peak Guard, battery power limits, input readiness and disabled/standby control. Its power is based on a one-hour recovery, with a small usable minimum, bounded by hardware limits. Once Safety SoC is reached, the ordinary planning rules apply again. A held target does not itself request more energy above Safety SoC.

P1-based solar capture remains active during a restart hold. The change does not prevent using available PV.

Automated tests cover completion and restart, continued charging through the band, plan transitions, forecast changes, midnight, normal-price ceilings, PV capture, Safety SoC recovery, missing prices, Peak Guard, hardware limits, standby and persistent state. Full configuration and Flow documentation: https://github.com/DavyBert/HomeFlux-EMS/discussions/3
