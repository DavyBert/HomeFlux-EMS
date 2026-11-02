# 0.9.1

## Battery control during EV charging

EV import allowances now exclude the battery's own charging demand. P1 import plus the signed battery command represents site demand before battery control; export is included with its negative sign. This prevents an existing battery charge command from sustaining itself through an EV allowance when the EV no longer draws power. Existing EV feedback validation and mode-based load detection still bound the allowance.

Battery charging status uses the physical P1 balance to distinguish solar surplus from grid energy, including during transitions away from a previous charge command.

## Grid charging priorities

EV-first reserves usable EV charging steps before assigning the remaining grid budget to planned battery charging. Shared priority reserves up to half of the available budget for the EV; battery-first keeps the battery's planned demand ahead of the EV. Unusable current or mode steps leave their space available to the battery. Reservations end when a car disconnects, its session ends or tariff eligibility ends.

The EV portfolio no longer adds battery charging power on top of an already allocated site import budget. Pending battery charging increases reserve space; a planned battery reduction creates EV headroom only after it is reflected in P1. Peak Guard, hardware limits, SoC limits and solar-surplus capture continue to apply.

## Validation

Automated regression scenarios reproduce the stale -6,000 W battery command with a full car and echoed 16 A feedback. Repeated control cycles check all three priorities with current, hybrid and mode outputs. Tests also cover genuine zero-current feedback, disconnected cars, tariff changes, grid export and P1 solar capture. The existing application test suite is included.

These are software simulations; physical charger response still depends on real telemetry. Echoing a requested current does not measure the car's actual consumption. Full configuration and Flow documentation: https://github.com/DavyBert/HomeFlux-EMS/discussions/3
