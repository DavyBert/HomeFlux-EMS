'use strict';
// Shared pure calculator for settings and local regression checks.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HomeFluxPhaseCalculator=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>({
 proposal(voltage,amps,percent=80){const vals=[voltage,amps,percent];if(vals.some(v=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))))return null;return voltage>=80&&voltage<=500&&amps>0&&amps<=1000&&percent>0&&percent<=100?Math.floor(voltage*amps*percent/100):null;}
}));
