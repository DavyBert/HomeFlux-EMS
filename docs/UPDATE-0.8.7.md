# 0.8.7

Under Energy contract, enable grid charging during normal dynamic price hours and choose its maximum SoC (default 50%). The option is disabled by default and preserves existing behavior. Charging stops at the lower of the planning target and this ceiling. Cheap-price charging and PV capture retain their existing limits. Peak Guard and hardware limits remain enforced.

Normal-price charging windows are included before the configured planning deadline. Windows entirely after the deadline are omitted. Only supplied price slots are used; future prices are not invented. The existing setting to use the battery during normal hours controls discharge independently.
