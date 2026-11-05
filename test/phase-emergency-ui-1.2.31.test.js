'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('settings/index.html','utf8'),nodes={};
const q=id=>nodes[id]||={value:'',checked:false,classList:{hidden:false,toggle(_name,value){this.hidden=value;}}};
q('phaseGuard').value='{}';q('gridConnectionPhases').value='3';
const context=vm.createContext({q,boolean:new Set(),numeric:new Set(),jsonArray:new Set()});
let start=html.indexOf('  function currentSettingValue('),end=html.indexOf('  function captureSettingsBaseline(',start);
vm.runInContext(html.slice(start,end),context);
assert.equal(context.currentSettingValue('phaseGuard').emergencyPriority,'ev_settings');
for(const priority of ['ev_settings','battery_first','shared','ev_first']){
 q('phaseEmergencyPriority').value=priority;
 assert.equal(context.currentSettingValue('phaseGuard').emergencyPriority,priority);
 assert(html.includes('<option value="'+priority+'">'));
}
start=html.indexOf('  function updatePhaseUi(');end=html.indexOf('    const value=HomeFluxPhaseCalculator.proposal',start);
vm.runInContext(html.slice(start,end)+'\n}',context);
for(const phases of ['1','3'])for(const on of [false,true]){
 q('gridConnectionPhases').value=phases;q('phaseGuardEnabled').checked=on;context.updatePhaseUi();
 assert.equal(q('phaseEmergencyPriorityRow').classList.hidden,phases!=='3'||!on);
}
const phrases=['Bij Emergency Charge voorrang geven aan','EV-instellingen volgen (standaard)','Verdelen (50/50)',
 'Emergency Charge wacht op bevestigde batterijreductie','Emergency Charge wacht op veilige fasecapaciteit',
 'Emergency Charge wacht op totale Peak Guard','Emergency Charge wacht op EV-terugkoppeling',
 'Bij Verdelen volgt de normale fasebewaking de netlaadprioriteit per EV.'];
const display=require('../lib/display-language');
for(const lang of ['nl','en','fr','es','de']){
 const bundle=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json','utf8'));
 for(const phrase of phrases){assert(bundle.exact[phrase]?.trim(),lang+'/'+phrase);assert.equal(display.translate(phrase,lang),bundle.exact[phrase]);}
}
assert.equal(require('../lib/phase-guard').defaults.emergencyPriority,'ev_settings');
console.log('Emergency settings: four choices, default/migration, conditional visibility and five-language UI/status translations passed.');
