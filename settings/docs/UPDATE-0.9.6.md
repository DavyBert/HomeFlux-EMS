# 0.9.6

PV variation is measured against the PV observation used for the last successfully published battery command. Fast and context evaluations no longer reset this reference. Before the first command, the first valid PV observation supplies the initial reference; missing PV does not count as zero.

Cumulative PV rises or falls that meet the configured threshold select current P1 instead of averaging. This also triggers a fresh evaluation during planned charging. The configured battery command interval is still enforced. A new calculation with no output, a paused command or a failed publication does not reset the PV reference. PV changes during asynchronous publication remain visible on the next calculation.

A zero PV threshold still disables PV-triggered live control. The change only selects the P1 sample source; it does not add PV delta to power or increase control gain.
