# 0.8.9

Under Energy contract, enable grid charging during normal dynamic price hours and choose its maximum SoC (default 50%). The option is disabled by default and preserves existing behavior. Charging stops at the lower of the planning target and this ceiling. Cheap-price charging and PV capture retain their existing limits. Peak Guard and hardware limits remain enforced.

Normal-price charging windows are included before the configured planning deadline. Windows entirely after the deadline are omitted. Only supplied price slots are used; future prices are not invented. The existing setting to use the battery during normal hours controls discharge independently.

## P1 feedback during planned charging

The charge plan sets the required charging power. P1 feedback can increase charging to capture surplus and retains that power when the meter reaches its configured zero band. A return to zero no longer resets charging to the lower planned power. When generation falls or household demand rises, P1 feedback reduces the extra charging again. Grid charging supplies the plan's remaining need within existing limits. The separate inverter reading does not cap measured surplus.

Applies to fixed, time-of-use and dynamic charging plans. Existing SoC ceilings, per-battery limits, Peak Guard, meter filtering and EV grid allowances remain in force. PV capture may continue above the planned grid-charge target up to the battery's normal maximum SoC.
