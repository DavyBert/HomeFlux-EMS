# HomeFlux EMS

**Your energy, managed differently**  
**Jouw energie, anders geregeld**

HomeFlux EMS manages home batteries around your tariff, PV forecast, self-consumption and grid limits. The hardware connection stays flexible through Homey Flow cards.

## Quick start

1. **Configure HomeFlux**
   Add your battery count, battery limits, tariff periods and Peak Guard limit in Settings, then save the configuration.

2. **Feed the basic inputs through Flow**
   Use **Set grid power**, **Set PV power** and **Set battery SoC**. For battery planning, also provide **Set remaining PV forecast** and **Set tomorrow PV forecast**. Grid power uses positive = import and negative = export.

3. **Send the battery output to your battery integration**
   Use **Battery commands are updated** for batteries that accept a power setpoint. If your battery requires separate charge/discharge modes and power values, enable Split Command and use the corresponding **Battery: switch to charge/discharge mode** and **Battery: charge/discharge power is updated** cards.

Once these inputs and outputs are connected, HomeFlux can perform the core battery control and planning.

Optional features include EV charging, HVAC, boiler control, Hybrid EMS integration, dynamic-price inputs, Autotune, Savings and dashboard widgets.

For the complete functionality, configuration and all Flow cards, see:
https://github.com/DavyBert/HomeFlux-EMS/discussions/3

---

HomeFlux EMS beheert thuisbatterijen op basis van je tarief, PV-voorspelling, zelfconsumptie en netlimieten. De hardwarekoppeling blijft flexibel via Homey Flow-kaarten.

## Snel starten

1. **Configureer HomeFlux**
   Stel het aantal batterijen, de batterijlimieten, tariefperiodes en Peak Guard-limiet in en sla de configuratie op.

2. **Stuur de basisinputs via Flow**
   Gebruik **Stel netvermogen in**, **Stel PV-vermogen in** en **Stel batterij-SoC in**. Voor de batterijplanning stuur je ook **Stel resterende PV-voorspelling in** en **Stel PV-voorspelling morgen in**. Netvermogen gebruikt positief = afname en negatief = injectie.

3. **Stuur de batterij-output naar je batterij-integratie**
   Gebruik **Batterijcommando's zijn bijgewerkt** voor batterijen die rechtstreeks een vermogenssetpoint aanvaarden. Vereist je batterij aparte laad-/ontlaadmodi en vermogenswaarden, schakel dan Split Command in en gebruik de bijbehorende kaarten **Batterij: schakel naar laad-/ontlaadmodus** en **Batterij: laad-/ontlaadvermogen is bijgewerkt**.

Zodra deze inputs en outputs gekoppeld zijn, kan HomeFlux de basisbatterijsturing en planning uitvoeren.

Optionele mogelijkheden zijn onder andere EV-laden, HVAC, boilersturing, Hybrid EMS, dynamische prijsinputs, Autotune, Winst en dashboardwidgets.

Voor de volledige functionaliteit, configuratie en alle Flow-kaarten:
https://github.com/DavyBert/HomeFlux-EMS/discussions/3
