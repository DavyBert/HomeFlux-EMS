'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const {boot,DEFAULTS}=require('./startup-harness'),H=require('../lib/hvac-permanent');
const html=fs.readFileSync('widgets/status/public/index.html','utf8'),dom=new JSDOM(html,{runScripts:'outside-only'});
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))dom.window.eval(m[1]);
const allIds=require('../widgets/status/widget.compose.json').settings.map(x=>x.id);
const settings=Object.fromEntries(allIds.map(x=>[x,false]));settings.showHvacSummary=true;settings.showHvacs=true;
async function main(){
 const s={...DEFAULTS,settingsSchemaVersion:71,hvacCount:10,batteryCount:0,evCount:0,controlEnabled:false};
 for(let i=0;i<10;i++)for(const [suffix,value] of Object.entries({Enabled:true,AutomaticControlEnabled:false,PermanentEnabled:false}))s[`hvac${i?i+1:''}${suffix}`]=value;
 const h=await boot(new Map(Object.entries(s))),a=h.app;assert.deepEqual(h.errors,[]);let evaluations=0;a.requestContextEvaluate=()=>evaluations++;
 const nativeNow=Date.now;let now=Date.UTC(2026,10,7,12);Date.now=()=>now;
 let checks=0;
 try{
  for(let i=0;i<10;i++){
   if(i){Object.assign(a.getExtraHvac(i),{lastPublishedPower:false,lastPublishedMode:'off',latestDecision:{currentMode:'off',reason:'Permanente HVAC-sturing uit'}});}
   else Object.assign(a,{lastPublishedHvacPower:false,lastPublishedHvacMode:'off',latestHvacDecision:{currentMode:'off',reason:'Permanente HVAC-sturing uit'}});
   const decision=JSON.stringify(i?a.getExtraHvac(i).latestDecision:a.latestHvacDecision);
   for(const mode of ['heat','off','cool','auto','off']){
    now+=1000;await h.cards.get('set_hvac_mode_for_configured').listener({hvac:{kind:'hvac',id:String(i+1)},mode});
    const status=a.getPublicStatus().hvacs[i];assert.equal(status.reportedMode,mode);assert.equal(status.modeFeedbackAt,now);assert.equal(status.received.mode,true);
    assert.equal(JSON.stringify(i?a.getExtraHvac(i).latestDecision:a.latestHvacDecision),decision,'reporting cannot alter the cached control decision');
    for(const lang of ['nl','en','fr','de','es']){
     const locale=require('../locales/'+lang+'.json'),Homey={__:key=>key.split('.').reduce((v,k)=>v?.[k],locale)||key};
     const out=dom.window.hvacState(status,Homey),expected=locale.widget.status[mode==='off'?'off':'on'];
     assert(out.startsWith(expected),`${lang}/${i}/${mode}: ${out}`);
     dom.window.renderStatus({hvacs:[status],settings:{}},settings,Homey);
     const row=dom.window.document.querySelector('.hvac-summary-name');assert(row.textContent.includes(expected));
     assert.equal(row.querySelector('svg.hvac-summary-icon-heat')!==null,mode==='heat');
     assert.equal(row.querySelector('svg.hvac-summary-icon-cool')!==null,mode==='cool');checks++;
    }
   }
  }
  const before=JSON.stringify(H.runtime(a));dom.window.renderStatus({hvacs:a.getPublicStatus().hvacs},settings,{__:key=>key});assert.equal(JSON.stringify(H.runtime(a)),before);
  console.log(`HVAC widget feedback: ${checks} rendered language/channel/mode checks passed, including external ON/OFF over stale commands, without a new decision, timer or listener.`);
 }finally{Date.now=nativeNow;dom.window.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
