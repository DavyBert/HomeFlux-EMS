'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../lib/hvac-presentation');
const s={hvacEnabled:true,hvacAutomaticControlEnabled:true,hvacPermanentEnabled:false,hvacUsePvSurplus:true};
const cases=[
 [{reason:'HVAC PV-sturing pas boven 99% batterij'},'PV-opvang wacht op batterij-SoC 99%'],
 [{reason:'Ruimtetemperatuur binnen activatiemarge 16.0–25.0 °C · geen HVAC-start'},'PV-opvang niet nodig (ruimtetemperatuur bereikt)'],
 [{reason:'Wachten op voldoende PV-overschot'},'PV-opvang wacht op voldoende PV-overschot'],
 [{reason:'PV-sturing',boostActive:true,energySource:'pv'},'PV-opvang actief'],
 [{reason:'Permanente HVAC-sturing uit'},'PV-opvang wacht op volgende beoordeling'],
 [{reason:'Peak Guard · HVAC direct terug naar normaal'},'Peak Guard · HVAC direct terug naar normaal']
];
for(const [d,text] of cases){const before=JSON.stringify(d);assert.equal(P.reason(s,d),'Permanente sturing uit · '+text);assert.equal(JSON.stringify(d),before);assert.equal(P.reason({...s,hvacPermanentEnabled:true},d),d.reason);}
const {translate}=require('../lib/display-language');
for(const lang of ['nl','en','fr','es','de']){
 const bundle=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json','utf8'));
 const text=translate(P.reason(s,cases[0][0]),lang);
 assert(text.includes('99%'));assert(text.startsWith(bundle.exact['Permanente sturing uit']));
 assert.equal(JSON.parse(fs.readFileSync('locales/'+lang+'.json','utf8')).widget.status.hvacTarget,lang==='nl'?'Doel':{en:'Target',fr:'Cible',es:'Objetivo',de:'Ziel'}[lang]);
}
const html=fs.readFileSync('widgets/status/public/index.html','utf8');
const extract=name=>{const a=html.indexOf('    function '+name+'('),b=html.indexOf('\n    function ',a+12);assert(a>=0);return html.slice(a,b);};
const ctx=vm.createContext({Date,reasonText:x=>x,tr:(_,k,f)=>f});vm.runInContext(extract('hvacGoalValue')+extract('hvacGoalConfirmed')+extract('hvacState'),ctx);
const now=1000000,h={received:{setpoint:true},setpointC:21.5,outputSetpointRequestedC:21.5,outputSetpointRequestedAt:now-2000,setpointFeedbackAt:now-1000,outputSetpointC:21.5};
assert.equal(ctx.hvacGoalValue(h),21.5);assert(ctx.hvacGoalConfirmed(h,21.5,now));
for(const bad of [{setpointC:null},{setpointC:undefined},{setpointC:''},{setpointC:'invalid'},{setpointC:20},{received:{setpoint:false}},{received:{}}])assert.equal(ctx.hvacGoalConfirmed({...h,...bad},21.5),false,JSON.stringify(bad));
// 1.2.24: only numeric received feedback matters; command and feedback timestamps do not gate color.
for(const metadata of [{setpointFeedbackAt:null},{setpointFeedbackAt:now-300001},{setpointFeedbackAt:now+1},{setpointFeedbackAt:now-2000},{outputSetpointRequestedAt:null},{outputSetpointRequestedC:22}])assert(ctx.hvacGoalConfirmed({...h,...metadata},21.5),JSON.stringify(metadata));
assert(ctx.hvacGoalConfirmed({received:{setpoint:true},setpointC:'21.5'},21.5),'no publication metadata required');
for(const value of [null,undefined,'',NaN,Infinity])assert.equal(ctx.hvacGoalConfirmed(h,value),false);
assert.equal(ctx.hvacGoalConfirmed({...h,setpointC:21.62},21.5),false);
assert(ctx.hvacGoalConfirmed({...h,setpointC:21.6},21.5,now));
const pending={...h,permanent:true,permanentControlEnabled:true,desiredSetpointC:22};assert.equal(ctx.hvacGoalValue(pending),22);assert.equal(ctx.hvacGoalConfirmed(pending,22,now),false);
const fresh={...pending,outputSetpointRequestedC:22,outputSetpointRequestedAt:now,setpointC:22};assert(ctx.hvacGoalConfirmed(fresh,22),'matching feedback is sufficient regardless of timestamps');assert(ctx.hvacGoalConfirmed({...fresh,setpointFeedbackAt:now+1000},22,now+1000));
assert.equal(ctx.hvacGoalValue({}),null);
assert(html.includes("goal.style.color=hvacGoalConfirmed(h,goalValue)?'var(--homey-text-color, inherit)':'var(--hf-muted)'"));
for(const [d,text] of cases)assert.equal(ctx.hvacState({enabled:true,automaticControlEnabled:true,permanentControlEnabled:false,reason:P.reason(s,d)},{}),'Permanente sturing uit · '+text);
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
const nativeNow=Date.now;const {setup,clock}=require('./hvac-coordination-1.2.15.test');
async function main(){
 const test=await setup(2,{hvacUsePvSurplus:true,hvac2UsePvSurplus:true}),a=test.app;
 for(let i=0;i<2;i++){
  await a.setHvacAutomaticControlFor(i,{enabled:'no',standby_temperature:17});
  let status=a.getPublicStatus().hvacs[i];assert(status.reason.startsWith('Permanent control disabled · '));
  // Publish through the real app, then feed back through existing Flow inputs.
  const d={powerCommand:null,modeCommand:null,setpointCommand:21.5,fanTarget:null,fanAction:null,reason:'Test'};
  await a.publishHvacDecisionFor(i,d);status=a.getPublicStatus().hvacs[i];const requestAt=status.outputSetpointRequestedAt;
  assert.equal(status.outputSetpointRequestedC,21.5);assert.equal(ctx.hvacGoalConfirmed(status,21.5,clock.now()),false);
  clock.set(clock.now()+1000);await test.cards.get('set_hvac_setpoint_for_configured').listener({hvac:{kind:'hvac',id:String(i+1)},setpoint:21.5});
  status=a.getPublicStatus().hvacs[i];assert(status.setpointFeedbackAt>requestAt);assert(ctx.hvacGoalConfirmed(status,21.5,clock.now()));
  await a.publishHvacDecisionFor(i,{...d,setpointCommand:22});status=a.getPublicStatus().hvacs[i];assert.equal(ctx.hvacGoalConfirmed(status,22,clock.now()),false);
 }
 console.log('HVAC presentation: combined reasons, unchanged permanent reasons, numeric device feedback, timestamp independence, missing/mismatched/new targets, tolerance, both publication paths and real feedback Flow passed.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>Date.now=nativeNow);
