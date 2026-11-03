'use strict';
// Read-only display projection. Never used to authorize or schedule HVAC output.
function reason(settings, decision = {}) {
 const original=String(decision?.reason||'');
 if(!settings.hvacEnabled||settings.hvacAutomaticControlEnabled===false||settings.hvacPermanentEnabled)return original;
 const prefix='Permanente sturing uit · ';
 if(original.startsWith(prefix))return original;
 if(!settings.hvacUsePvSurplus)return prefix+'PV-opvang uitgeschakeld';
 const soc=/^HVAC PV-sturing pas boven ([\d.,]+)% batterij$/.exec(original);
 if(soc)return prefix+`PV-opvang wacht op batterij-SoC ${soc[1]}%`;
 if(original.startsWith('Ruimtetemperatuur binnen activatiemarge')||original.startsWith('Comfortdoel bereikt')||original==='Geen HVAC-modus nodig')return prefix+'PV-opvang niet nodig (ruimtetemperatuur bereikt)';
 if(original==='Wachten op voldoende PV-overschot')return prefix+'PV-opvang wacht op voldoende PV-overschot';
 if(original.startsWith('Permanente HVAC-sturing uit'))return prefix+'PV-opvang wacht op volgende beoordeling';
 if(decision.boostActive&&!decision.waiting&&decision.energySource==='pv'&&decision.powerCommand!==false)return prefix+'PV-opvang actief';
 // Keep priority, battery continuation, input warnings and safety details.
 return prefix+(original||'PV-opvang wacht op volgende beoordeling');
}
module.exports={reason};
