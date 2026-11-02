/* Shared read-only advice; never applies or changes a setting. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HomeFluxBatteryResponseGuidance=factory();})(typeof globalThis==='undefined'?this:globalThis,function(){
 'use strict';
 return function(result,settings,cadenceMs){
  if(!result||!Number.isFinite(result.responseMs)||!(result.cadenceMs>0))return null;
  const cadence=Math.max(result.cadenceMs,Number(cadenceMs)||0)/1000;
  const configured=Number(settings.gridControlWindowSeconds),samples=[3,5,7,10].includes(configured)?configured:configured===0?0:5;
  const recommendedSeconds=Math.ceil(result.responseMs/1000+Math.max(1,samples)*cadence);
  return{responseSeconds:result.responseMs/1000,cadenceSeconds:cadence,samples,recommendedSeconds,recommendedUpperSeconds:recommendedSeconds+Math.max(1,Math.ceil(cadence)),warning:Number(settings.commandIntervalSeconds)<recommendedSeconds};
 };
});
