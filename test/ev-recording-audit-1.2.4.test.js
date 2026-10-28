'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.HEMS_AUDIT_ROOT||path.resolve(__dirname,'..');
const {boot,DEFAULTS}=require(root+'/test/startup-harness');
const savings=require(root+'/lib/savings'),{evPowerPerAmp}=require(root+'/lib/flexible-loads');
const {localDateTimeUtcMs}=require(root+'/lib/homey-energy');
const RealDate=Date;let clock=localDateTimeUtcMs('2026-10-27','10:00','Europe/Brussels');
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const rows=[];const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const evKey=(i,suffix)=>(i?'ev'+(i+1):'ev')+suffix;
const metric=a=>a.savings.today.ev?.total;
const csv=a=>{const lines=a.getSavingsCsv().split('\r\n').map(l=>l.split(','));return Object.fromEntries(lines[0].map((key,i)=>[key,lines.at(-1)[i]]));};
async function fresh({count=1,start='2026-10-27',time='10:00',extra={}}={}){
 clock=localDateTimeUtcMs(start,time,'Europe/Brussels');
 const config={...DEFAULTS,settingsSchemaVersion:70,evCount:count,batteryCount:0,controlEnabled:false,
  contractType:'fixed',fixedImportPrice:.3,fixedFeedInPrice:.03,peakShaveEnabled:false,exportLimitEnabled:false,...extra};
 for(let i=0;i<count;i++)Object.assign(config,{[evKey(i,'Enabled')]:true,[evKey(i,'ControlType')]:extra[evKey(i,'ControlType')]||'current',
  [evKey(i,'Phases')]:extra[evKey(i,'Phases')]??1,[evKey(i,'Voltage')]:extra[evKey(i,'Voltage')]??230,[evKey(i,'VoltageReference')]:extra[evKey(i,'VoltageReference')]||'phase',
  [evKey(i,'EnergyFeedbackScope')]:extra[evKey(i,'EnergyFeedbackScope')]||'individual'});
 const h=await boot(new Map(Object.entries(config)));attach(h);h.app.savings.today=savings.emptyDay(start);
 h.app.savings.history={};h.app.savings.inventory=savings.emptyInventory();h.app.savings.total=0;h.app.savings.lastSampleAt=clock;
 h.powers=Array(count).fill(0);return h;
}
function attach(h){const a=h.app;a.requestContextEvaluate=()=>{};a.requestFastEvaluate=()=>{};
 a.inputSeen.grid=true;a.inputSeen.pv=true;a.inputUpdatedAt.grid=clock;a.inputUpdatedAt.pv=clock;
 Object.assign(a.state,{gridPowerW:1000,pvPowerW:0,lastTotalCommandW:0});}
async function feedback(h,i,power,connected=true){h.powers[i]=connected?power:0;
 const amps=power/evPowerPerAmp(h.app.getEvElectricalSettingsFor(i,h.app.getSettings()));
 assert(await h.cards.get(`set_ev${i+1}_status`).listener({connected:connected?'yes':'no',charge_current:amps}));
 await h.cards.get('set_grid_power').listener({power:1000+h.powers.reduce((a,b)=>a+b,0)});
}
async function run(h,seconds,{refresh=true,grid=null}={}){
 for(let t=0;t<seconds;t++){
  clock+=1000;await h.cards.get('set_grid_power').listener({power:grid??1000+h.powers.reduce((a,b)=>a+b,0)});
  if(refresh&&(t+1)%30===0)for(let i=0;i<h.powers.length;i++)await feedback(h,i,h.powers[i]);
 }
}
async function check(name,fn){const data=await fn();rows.push({name,...data});console.log('PASS',name);}
(async()=>{try{
 await check('A: connected EV, repeated 0-W feedback for 60 minutes',async()=>{const h=await fresh();await feedback(h,0,0);await run(h,3600);near(metric(h.app).kwh,0);near(metric(h.app).missingSeconds,0);return{energyKwh:metric(h.app).kwh,missingSeconds:metric(h.app).missingSeconds};});
 await check('B/H: 3,600 W for 60 minutes, real Flow inputs without a goal or charging commands',async()=>{const h=await fresh();await feedback(h,0,3600);await run(h,3600);const m=metric(h.app);near(m.kwh,3.6);near(m.missingSeconds,0);near(m.gridKwh,3.6);near(Number(csv(h.app).ev1_kwh),3.6);assert(!h.app.evEnergyPlans[0].active&&!h.app.evSocPlans[0].active);near(h.app.lastPublishedEvCurrentA||0,0);return{energyKwh:m.kwh,csvEv1Kwh:csv(h.app).ev1_kwh,planningActive:false};});
 await check('C: four 15-minute periods at 1/2/3/0 kW',async()=>{const h=await fresh();for(const w of [1000,2000,3000,0]){await feedback(h,0,w);await h.cards.get('set_grid_power').listener({power:1000+w});await run(h,900);}near(metric(h.app).kwh,1.5);near(metric(h.app).missingSeconds,0);return{energyKwh:metric(h.app).kwh};});
 await check('D: missing feedback expires at 60 seconds, without invented delivery',async()=>{const h=await fresh();await feedback(h,0,3600);await run(h,180,{refresh:false});near(metric(h.app).kwh,.06);near(metric(h.app).missingSeconds,120);return{energyKwh:metric(h.app).kwh,missingSeconds:metric(h.app).missingSeconds};});
 await check('E: persistence and reboot during charging retain history and do not integrate downtime',async()=>{let h=await fresh();await feedback(h,0,3600);await run(h,1800);near(metric(h.app).kwh,1.8);h.app.persistSavingsState(clock,true);const store=new Map(h.store);clock+=120000;const next=await boot(store);attach(next);next.powers=[0];h=next;near(metric(h.app).kwh,1.8);assert(!h.app.inputSeen.ev.chargeCurrent);await feedback(h,0,3600);await run(h,1800);near(metric(h.app).kwh,3.6);return{energyKwh:metric(h.app).kwh,downtimeSeconds:120};});
 await check('F: 23:30–00:30 splits 3.6-kW charging across local midnight',async()=>{const h=await fresh({time:'23:30'});await feedback(h,0,3600);await run(h,3600);near(h.app.savings.history['2026-10-27'].ev.total.kwh,1.8);near(metric(h.app).kwh,1.8);return{previousDayKwh:h.app.savings.history['2026-10-27'].ev.total.kwh,newDayKwh:metric(h.app).kwh};});
 await check('G: two independent EVs keep individual and central totals without double counting',async()=>{const h=await fresh({count:2});await feedback(h,0,3000);await feedback(h,1,4000);await run(h,3600);const ev=h.app.savings.today.ev;near(ev.total.kwh,7);near(ev.byId['1'].kwh,3);near(ev.byId['2'].kwh,4);near(ev.total.pvKwh+ev.total.gridKwh+ev.total.batteryKwh+ev.total.unknownKwh,7);return{totalKwh:ev.total.kwh,ev1Kwh:ev.byId['1'].kwh,ev2Kwh:ev.byId['2'].kwh};});
 await check('G shared: one declared joint meter is counted once, not once per EV',async()=>{const h=await fresh({count:2,extra:{evEnergyFeedbackScope:'shared'}});await feedback(h,0,7000);await feedback(h,1,4000);await run(h,600,{grid:8000});const ev=h.app.savings.today.ev;near(ev.total.kwh,7/6);near(ev.sharedKwh,7/6);near(ev.byId['1'].kwh+ev.byId['2'].kwh,0);return{groupKwh:ev.total.kwh,sharedKwh:ev.sharedKwh};});
 await check('Battery/EMS combinations do not gate EV recording',async()=>{const result=[];for(const [batteryCount,controlEnabled]of [[0,false],[0,true],[1,false],[1,true]]){const h=await fresh({extra:{batteryCount,controlEnabled}});await feedback(h,0,3600);await run(h,600);near(metric(h.app).kwh,.6);result.push({batteryCount,controlEnabled,energyKwh:metric(h.app).kwh});}return{combinations:result};});
 await check('Unknown, stopped and disconnected feedback have distinct coverage meanings',async()=>{const h=await fresh();await run(h,60,{refresh:false});near(metric(h.app).missingSeconds,60);await feedback(h,0,0);await run(h,60);near(metric(h.app).missingSeconds,60);await feedback(h,0,0,false);await run(h,120,{refresh:false});near(metric(h.app).missingSeconds,60);near(metric(h.app).kwh,0);return{missingSeconds:metric(h.app).missingSeconds,disconnectedAddsMissing:false};});
 await check('Unavailable feedback scope explicitly excludes even otherwise positive current',async()=>{const h=await fresh({extra:{evEnergyFeedbackScope:'unavailable'}});await feedback(h,0,3600);await run(h,120);near(metric(h.app).kwh,0);near(metric(h.app).missingSeconds,120);return{energyKwh:metric(h.app).kwh,missingSeconds:metric(h.app).missingSeconds};});
 await check('Duplicate recorder calls and refreshes never integrate the same timestamp twice',async()=>{const h=await fresh();await feedback(h,0,3600);await run(h,60);const before=JSON.stringify(h.app.savings.today);for(let i=0;i<100;i++){h.app.recordSavingsSample(clock);h.app.getEvDashboard();h.app.getSavingsCsv();}assert.equal(JSON.stringify(h.app.savings.today),before);return{energyKwh:metric(h.app).kwh,repeatedReads:100};});
 await check('Phase conversion uses configured electrical settings at each completed interval',async()=>{const h=await fresh();await feedback(h,0,2300);await run(h,1800);h.app.setSetting('evPhases',3);await feedback(h,0,6900);await h.cards.get('set_grid_power').listener({power:7900});await run(h,1800);near(metric(h.app).kwh,4.6);return{energyKwh:metric(h.app).kwh};});
 // Characterize existing source prerequisites separately from the reported 0-A case.
 await check('Source prerequisite characterization: valid EV current with missing PV measurement',async()=>{const h=await fresh();await feedback(h,0,3600);h.app.inputSeen.pv=false;await run(h,60);near(metric(h.app)?.kwh??0,.06);near(metric(h.app)?.unknownKwh??0,.06);return{energyKwh:metric(h.app)?.kwh??null,unknownKwh:metric(h.app)?.unknownKwh??null,evDayPresent:Boolean(h.app.savings.today.ev)};});
 await check('Absent/stale P1 or PV preserves fresh EV energy as unknown without changing site Savings or battery inventory',async()=>{
  const results=[];
  for(const mode of ['missing_grid','stale_grid','missing_pv','stale_pv','invalid_pv']){
   const h=await fresh();await feedback(h,0,3600);const originalDay=structuredClone(h.app.savings.today),inventory=JSON.stringify(h.app.savings.inventory);
   for(let t=1;t<=120;t++){
    clock+=1000;const a=h.app;
    if(mode==='missing_grid')a.inputSeen.grid=false;
    if(mode==='stale_grid')a.inputUpdatedAt.grid=clock-600000;
    if(mode==='missing_pv')a.inputSeen.pv=false;
    if(mode==='stale_pv'){a.state.pvPowerW=500;a.inputUpdatedAt.pv=clock-600000;}
    if(mode==='invalid_pv')a.state.pvPowerW=null;
    a.recordSavingsSample(clock);
    if(t%30===0)await feedback(h,0,3600);
   }
   const m=metric(h.app),{ev,...common}=h.app.savings.today;
   near(m.kwh,.12);near(m.unknownKwh,.12);near(m.missingSeconds,0);near(m.pvKwh+m.gridKwh+m.batteryKwh,0);
   near(m.gridCost+m.solarValue+m.solarSavings,0);assert.deepEqual(common,originalDay);assert.equal(JSON.stringify(h.app.savings.inventory),inventory);
   const record=csv(h.app);near(Number(record.ev_kwh),.12);near(Number(record.ev_unknown_kwh),.12);
   results.push({mode,energyKwh:m.kwh,unknownKwh:m.unknownKwh,siteSavingsUnchanged:true});
  }return{conditions:results};
 });
 await check('Unknown source does not invent energy or feedback coverage for an unmeasured EV',async()=>{const h=await fresh();for(let i=0;i<120;i++){clock+=1000;h.app.inputSeen.pv=false;h.app.inputUpdatedAt.grid=clock;h.app.recordSavingsSample(clock);}near(metric(h.app).kwh,0);near(metric(h.app).missingSeconds,120);return{energyKwh:0,missingSeconds:120};});
 await check('Expired positive feedback and confirmed zero current still remain bounded when site meters are absent',async()=>{const h=await fresh();await feedback(h,0,3600);for(let i=0;i<120;i++){clock+=1000;h.app.inputSeen.pv=false;h.app.recordSavingsSample(clock);}near(metric(h.app).kwh,.06);near(metric(h.app).unknownKwh,.06);near(metric(h.app).missingSeconds,60);await feedback(h,0,0);h.app.inputSeen.pv=false;clock+=1000;h.app.recordSavingsSample(clock);near(metric(h.app).kwh,.06);return{energyKwh:.06,missingSeconds:60};});
 await check('New unknown-source intervals obey midnight splitting in the same central ledger',async()=>{const h=await fresh({time:'23:59'});await feedback(h,0,3600);for(let i=1;i<=120;i++){clock+=1000;h.app.inputSeen.pv=false;h.app.recordSavingsSample(clock);if(i%30===0)await feedback(h,0,3600);}near(h.app.savings.history['2026-10-27'].ev.total.unknownKwh,.06);near(metric(h.app).unknownKwh,.06);return{previousDayKwh:.06,nextDayKwh:.06};});
 await check('Spring and autumn daylight-saving transitions integrate elapsed time only',async()=>{const result=[];for(const [date,startAt]of [['2026-03-29','2026-03-29T00:30:00Z'],['2026-10-25','2026-10-25T00:30:00Z']]){const h=await fresh({start:date});clock=RealDate.parse(startAt);h.app.savings.lastSampleAt=clock;h.app.inputUpdatedAt.grid=clock;await feedback(h,0,3600);await run(h,3600);near(metric(h.app).kwh,3.6);assert.equal(h.app.savings.today.date,date);result.push({date,kwh:metric(h.app).kwh});}return{days:result};});
 await check('Site-meter recovery does not double-count EV energy or backfill site Savings',async()=>{const h=await fresh();await feedback(h,0,3600);await run(h,60);for(let t=1;t<=60;t++){clock+=1000;h.app.inputSeen.pv=false;h.app.recordSavingsSample(clock);if(t%30===0)await feedback(h,0,3600);}h.app.inputSeen.pv=true;h.app.state.pvPowerW=0;await feedback(h,0,3600);await run(h,60);const m=metric(h.app);near(m.kwh,.18);near(m.unknownKwh,.06);near(m.gridKwh,.12);near(h.app.savings.today.directGridKwh,4.6*120/3600);return{energyKwh:m.kwh,gridKwh:m.gridKwh,unknownKwh:m.unknownKwh};});
 await check('Diagnostic BMW reproduction: house-load charging and a 10-A request do not fabricate delivered energy from stale 0 A',async()=>{const h=await fresh({extra:{evControlType:'mode',evPhases:3,evVoltage:380,evVoltageReference:'line',evModeStandardCurrentA:10,evIdleHouseLoadW:3000}});await feedback(h,0,0);h.app.lastPublishedEvChargeMode='standard';h.app.lastPublishedEvAllowed=true;h.app.evSessionDetection.portfolioBaselineW=3000;for(let n=0;n<180;n++){clock+=1000;h.app.recordSavingsSample(clock);h.app.state.gridPowerW=10000;h.app.inputUpdatedAt.grid=clock;h.app.updateEvPortfolioLoadDetection(10000,clock,h.app.getSettings());}assert.equal(h.app.getEvSessionDetectionRuntime(0).state,'charging');assert.equal(h.app.getEvSessionDetectionRuntime(0).detectionSource,'house_load');near(metric(h.app).kwh,0);near(metric(h.app).missingSeconds,120);return{centralSession:'charging',detection:'house_load',receivedCurrentA:0,energyKwh:0,missingSeconds:120};});
 }finally{global.Date=RealDate;}
 const result={sourceRoot:root,passed:rows.length,scenarios:rows,simulatedHomey:true,physicalHomeyTested:false};
 fs.writeFileSync(path.join(root,'validation/ev-recording-audit-1.2.4.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})().catch(e=>{global.Date=RealDate;console.error(e.stack);process.exitCode=1;});
