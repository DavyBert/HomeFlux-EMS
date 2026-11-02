'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const savings = require('../lib/savings'), history = require('../lib/savings-history');
const baseline = process.env.HEMS_EV_BASELINE ? require(path.join(process.env.HEMS_EV_BASELINE,'lib/savings')) : null;
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { boot } = require('./startup-harness');
const { localDateTimeUtcMs } = require('../lib/homey-energy');
const cases = [], near = (a,b) => assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const metric = d => d.ev.total;
function run({pv=0,grid=0,battery=0,readings=[],prices=[.3,.03],seconds=300}={}) {
  const day=savings.emptyDay('2026-10-26'), inv=savings.emptyInventory();
  const oldDay=baseline?.emptyDay('2026-10-26'), oldInv=baseline?.emptyInventory();
  for(let i=0;i<12;i++){
    const args={seconds,gridW:grid,pvW:pv,batteryW:battery,importPrice:prices[0],feedInPrice:prices[1],
      tariff:{id:'test',label:'Test'},capacityKwh:40};
    savings.integrateInterval({...args,day,inventory:inv,evs:readings});
    if(baseline)baseline.integrateInterval({...args,day:oldDay,inventory:oldInv});
  }
  if(baseline){const {ev,...common}=day;assert.deepEqual(common,oldDay);assert.deepEqual(inv,oldInv);}
  if(day.ev){const e=metric(day);near(e.pvKwh+e.gridKwh+e.batteryKwh+e.unknownKwh,e.kwh);
    assert(e.pvKwh<=day.directPvKwh+1e-8);
    assert(Object.values(day.ev.byId).reduce((s,m)=>s+m.kwh,0)<=e.kwh+1e-8);
    near(Object.values(day.ev.byId).reduce((s,m)=>s+m.pvKwh,0)+(day.ev.sharedKwh?e.pvKwh:0),e.pvKwh);
  }
  return day;
}
const reading=(id,w,extra={})=>({id:String(id),powerW:w,coveredSeconds:300,scope:'individual',...extra});
const check=(name,fn)=>{fn();cases.push(name);};
(async()=>{
  check('Only PV, only grid, mixed PV/grid: total conservation and no additional Savings kWh or money',()=>{
    const a=run({pv:5000,readings:[reading(1,5000)]});near(metric(a).pvKwh,5);
    const b=run({grid:5000,readings:[reading(1,5000)]});near(metric(b).gridKwh,5);near(metric(b).gridCost,1.5);
    const c=run({pv:5000,grid:2000,readings:[reading(1,7000)]});near(metric(c).pvKwh,5);near(metric(c).gridKwh,2);
  });
  check('Two EVs 3+4 kW share a 5-kW direct PV pool once',()=>{
    const d=run({pv:5000,grid:2000,readings:[reading(1,3000),reading(2,4000)]});
    near(metric(d).pvKwh,5);near(d.ev.byId['1'].pvKwh,5*3/7);near(d.ev.byId['2'].pvKwh,5*4/7);
  });
  check('Solar serves other household loads first; EVs receive the remaining solar and available grid',()=>{
    const d=run({pv:5000,grid:5000,readings:[reading(1,3000),reading(2,4000)]});
    near(metric(d).pvKwh,2);near(metric(d).gridKwh,5);near(d.directPvKwh,5);
  });
  check('15 kWh PV direct contains 9 kWh EV solar plus 6 kWh other loads, never 24 kWh',()=>{
    const d=run({pv:15000,readings:[reading(1,9000)]});near(d.directPvKwh,15);near(metric(d).pvKwh,9);near(d.directPvKwh-metric(d).pvKwh,6);
  });
  check('Battery discharge stays unknown while real direct solar can still be attributed',()=>{
    const d=run({pv:3000,battery:4000,readings:[reading(1,7000)]});near(metric(d).unknownKwh,4);near(metric(d).pvKwh,3);near(metric(d).batteryKwh,0);
  });
  check('Simultaneous battery charging no longer blocks solar/grid EV allocation; source pools exclude battery charging',()=>{
    const d=run({pv:6000,grid:3000,battery:-2000,readings:[reading(1,5000)]});near(metric(d).pvKwh,4);near(metric(d).gridKwh,1);near(metric(d).unknownKwh,0);
  });
  check('PV export while charging only credits actual direct-PV-to-load pool',()=>{
    const d=run({pv:10000,grid:-3000,readings:[reading(1,5000)]});near(metric(d).pvKwh,5);near(d.directPvExportKwh,3);
  });
  check('PV, battery and two EVs obey conservation and cannot double count',()=>{
    const d=run({pv:3000,grid:1000,battery:3000,readings:[reading(1,3000),reading(2,4000)]});near(metric(d).kwh,7);near(metric(d).pvKwh,3);near(metric(d).gridKwh,1);near(metric(d).unknownKwh,3);
  });
  check('Household-first solar: PV 5 kW, house 3 kW, EV 7 kW credits only the remaining 2 kW solar',()=>{
    const d=run({pv:5000,grid:5000,readings:[reading(1,7000)]});
    near(metric(d).pvKwh,2);near(metric(d).gridKwh,5);near(metric(d).unknownKwh,0);
  });
  check('Grid-only charging while the battery charges removes battery grid demand once',()=>{
    const d=run({grid:10000,battery:-2000,readings:[reading(1,6000)]});
    near(metric(d).gridKwh,6);near(metric(d).unknownKwh,0);near(d.gridChargeKwh,2);
  });
  check('Two EVs share one residual solar pool proportionally after household demand',()=>{
    const d=run({pv:5000,grid:5000,readings:[reading(1,3000),reading(2,4000)]});
    near(metric(d).pvKwh,2);near(d.ev.byId['1'].pvKwh,2*3/7);near(d.ev.byId['2'].pvKwh,2*4/7);
    near(metric(d).gridKwh,5);near(metric(d).kwh,7);
  });
  check('PV that only covers the household cannot generate fictitious solar kilometres',()=>{
    const d=run({pv:2000,grid:8000,readings:[reading(1,7000)]});
    near(metric(d).pvKwh,0);near(metric(d).gridKwh,7);near(metric(d).unknownKwh,0);
  });
  check('Mixed valid/partial feedback never redistributes the same EV solar share twice',()=>{
    const d=run({pv:5000,grid:5000,readings:[reading(1,3000),reading(2,4000,{sourceUsable:false,coveredSeconds:150})]});
    near(metric(d).pvKwh,2*3/7);near(metric(d).gridKwh,5*3/7);near(metric(d).unknownKwh,4);
  });
  check('One shared EV meter is central group energy and is not assigned to either vehicle',()=>{
    const d=run({pv:5000,grid:2000,readings:[reading(1,7000,{scope:'shared'}),reading(2,4000)]});
    near(metric(d).kwh,7);near(d.ev.sharedKwh,7);near(d.ev.byId['1'].kwh+d.ev.byId['2'].kwh,0);
  });
  check('Ambiguous multiple shared meters and absent feedback never invent exact energy',()=>{
    const d=run({grid:7000,readings:[reading(1,0,{coveredSeconds:0}),reading(2,0,{coveredSeconds:0})]});near(metric(d).kwh,0);assert(metric(d).missingSeconds>0);
    const e=run({grid:7000,readings:[reading(1,7000,{scope:'shared'}),reading(2,7000,{scope:'shared'})]});near(metric(e).kwh,0);assert(e.ev.byId['2'].missingSeconds>0);
  });
  check('Delayed/partial current feedback cannot receive precise PV attribution',()=>{
    const d=run({pv:5000,readings:[reading(1,2500,{coveredSeconds:150,sourceUsable:false})]});near(metric(d).kwh,2.5);near(metric(d).unknownKwh,2.5);assert(metric(d).missingSeconds>0);
  });
  check('Physically inconsistent currents are unknown rather than claiming excess PV',()=>{
    const d=run({pv:1000,readings:[reading(1,4000),reading(2,4000)]});near(metric(d).pvKwh,0);near(metric(d).unknownKwh,8);
  });
  check('All charger-current energy is explicitly estimated, including solar kilometres',()=>{
    const d=run({pv:8400,readings:[reading(1,8400)]});near(metric(d).estimatedKwh,8.4);near(Math.round(metric(d).pvKwh/18*100),47);
  });
  check('Fixed, TOU and dynamic signed interval prices; solar includes lost export value',()=>{
    for(const prices of [[.34,.03],[.45,.12],[-.15,-.02]]){
      const d=run({pv:4000,grid:3000,readings:[reading(1,7000)],prices});
      near(metric(d).gridCost,3*prices[0]);near(metric(d).solarValue,4*prices[1]);near(metric(d).solarSavings,4*(prices[0]-prices[1]));
    }
    const d=savings.emptyDay('2026-10-26'),inv=savings.emptyInventory();
    for(const price of [.4,.1])savings.integrateInterval({day:d,inventory:inv,seconds:300,gridW:12000,pvW:0,batteryW:0,importPrice:price,evs:[reading(1,12000)]});
    near(metric(d).gridCost,.5); // never reprice old energy at the latest price
  });
  check('Existing import-energy calibration conservatively moves disallowed EV grid attribution to unknown',()=>{
    const d=run({grid:5000,readings:[reading(1,5000)]});d.importedEnergyKnown=true;d.importedEnergyKwh=2;
    const e=savings.calibrateEnergy(d);near(metric(e).gridKwh,2);near(metric(e).unknownKwh,3);near(metric(e).kwh,5);
    assert(metric(e).gridKwh<=e.directGridKwh+1e-8);
  });
  check('Historical days without EV fields remain readable and EV fields survive compact/expand/add',()=>{
    assert.equal(savings.normalizeDay({date:'2020-01-01',directPvKwh:15}).ev,undefined);
    const d=run({pv:5000,readings:[reading(1,5000)]});const c=history.compactDay(d,d.date),e=history.expandDay(c,d.date);
    near(metric(e).pvKwh,5);const aggregate=savings.emptyDay('');savings.addDays(aggregate,e);savings.addDays(aggregate,e);near(metric(aggregate).pvKwh,10);
  });
  check('Repeated timestamps integrate no second energy and explicit stopped feedback records no command-based delivery',()=>{
    const d=run({grid:5000,readings:[reading(1,5000)],seconds:0});assert.equal(d.ev,undefined);
    const e=run({grid:5000,readings:[reading(1,0)]});near(metric(e).kwh,0);
  });
  check('Missing interval prices are flagged unpriced, not retroactively valued at a current price',()=>{
    const d=savings.emptyDay('2026-10-26');savings.integrateInterval({day:d,inventory:savings.emptyInventory(),seconds:300,
      gridW:12000,pvW:0,batteryW:0,importPrice:0,evPriceKnown:false,evs:[reading(1,12000)]});
    near(metric(d).kwh,1);near(metric(d).unpricedKwh,1);near(metric(d).gridCost,0);
    const e=savings.emptyDay('2026-10-26');savings.integrateInterval({day:e,inventory:savings.emptyInventory(),seconds:300,
      gridW:0,pvW:12000,batteryW:0,importPrice:0,feedInPrice:.03,evPriceKnown:false,evs:[reading(1,12000)]});
    near(metric(e).solarValue,.03);near(metric(e).unpricedKwh,1);near(metric(e).solarSavings,0);
  });
  check('Mixed PV/grid/battery cases conserve every EV kWh and never exceed existing Savings source pools',()=>{
    for(const pv of [0,1000,5000,10000])for(const grid of [-3000,0,1000,7000,12000])for(const battery of [-4000,0,3000]) {
      const load=pv+grid+battery;if(load<=0)continue;
      for(const ratio of [.25,.75,1,1.1]) {
        const ev=load*ratio;
        const d=run({pv,grid,battery,readings:[reading(1,ev*3/7),reading(2,ev*4/7)]});
        const e=metric(d);assert(e.gridKwh<=d.directGridKwh+1e-8);
        assert(e.pvKwh<=d.directPvKwh+1e-8);near(e.estimatedKwh,e.kwh);
        for(const value of [e.kwh,e.pvKwh,e.gridKwh,e.unknownKwh])assert(value>=-1e-8);
      }
    }
  });
  const realNow=Date.now, restore=installVirtualClearTimeout();
  try{
    const start=localDateTimeUtcMs('2026-10-26','23:59','Europe/Brussels')+50000;
    const h=await setup(undefined,{evCount:1,evEnabled:true,evPhases:1,evVoltage:230,evVoltageReference:'phase',batteryCount:0,controlEnabled:false},start,0),a=h.app;
    a.savings.today=savings.emptyDay('2026-10-26');a.savings.history={};a.savings.lastSampleAt=start;
    Object.assign(a.state,{gridPowerW:2300,pvPowerW:0,evConnected:true,evChargeCurrentA:10});
    a.inputSeen.ev.connected=true;a.inputSeen.ev.chargeCurrent=true;a.inputUpdatedAt.ev.chargeCurrent=start;
    a.inputUpdatedAt.grid=start;a.inputSeen.grid=true;a.inputSeen.pv=true;
    h.setNow(start+20000);a.inputUpdatedAt.grid=h.now();a.recordSavingsSample(h.now());
    cases.push('Actual central recorder splits midnight once for BOTH Savings and EV data, without a second integration path');
    near(a.savings.history['2026-10-26'].ev.total.kwh,2300/1000*10/3600);near(a.savings.today.ev.total.kwh,2300/1000*10/3600);
    const before=JSON.stringify(a.savings.today);a.recordSavingsSample(h.now());assert.equal(JSON.stringify(a.savings.today),before);
    a.persistSavingsState(h.now(),true);const reboot=await boot(new Map(h.store));
    near(reboot.app.savings.today.ev.total.kwh,a.savings.today.ev.total.kwh);
    cases.push('Central existing persistence restores EV daydata without reintegrating the offline period');
    const physical=a.getEvSavingsReadings(start,start+120000,a.getSettings())[0];
    near(physical.coveredSeconds,60);near(physical.powerW,1150);assert(!physical.sourceUsable);
    cases.push('Real app feedback horizon clips delivery at 60 seconds; an estimate is not a delivery command');
    a.requestContextEvaluate=()=>{};
    h.setNow(h.now()+10000);a.inputUpdatedAt.grid=h.now();
    const beforeStop=a.savings.today.ev.total.kwh;
    await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});
    near(a.savings.today.ev.total.kwh-beforeStop,2300/1000*10/3600);
    const stopped=a.savings.today.ev.total.kwh;h.setNow(h.now()+10000);a.inputUpdatedAt.grid=h.now();a.recordSavingsSample(h.now());
    near(a.savings.today.ev.total.kwh,stopped);
    cases.push('Actual EV stop input settles preceding energy once, then records no further charging');
    a.setInput({ev:{connected:true,chargeCurrentA:10}});
    h.setNow(h.now()+10000);a.inputUpdatedAt.grid=h.now();
    const apiBefore=a.savings.today.ev.total.kwh;
    a.setInput({ev:{connected:true,chargeCurrentA:0}});
    near(a.savings.today.ev.total.kwh-apiBefore,2300/1000*10/3600);
    cases.push('Actual nested EV API input settles the same central interval before replacing feedback');
    a.setSetting('contractType','dynamic');a.latestResult={};
    a.state.evChargeCurrentA=10;a.inputUpdatedAt.ev.chargeCurrent=h.now();
    h.setNow(h.now()+10000);a.inputUpdatedAt.grid=h.now();a.recordSavingsSample(h.now());
    assert(a.savings.today.ev.total.unpricedKwh>0);
    cases.push('Actual missing dynamic price is explicitly unpriced in central daydata');
    a.setSetting('evEnergyFeedbackScope','unavailable');
    const unavailable=a.getEvSavingsReadings(h.now(),h.now()+10000,a.getSettings())[0];
    near(unavailable.powerW,0);near(unavailable.coveredSeconds,0);
    cases.push('Mode-command estimates or unreliable phase/current feedback can be explicitly excluded without changing EV control');
    const saved=a.savings.today.ev.total.pvKwh;a.setSetting('evConsumptionKwhPer100Km',25);a.getEvDashboard();near(a.savings.today.ev.total.pvKwh,saved);
    cases.push('Consumption changes only recomputed range, never stored energy');
    let scans=0;const source=a.savings.history;a.savings.history=new Proxy(source,{ownKeys(t){scans++;return Reflect.ownKeys(t);}});a.savingsHistoryCache.clear();
    a.getEvDashboard('all');const count=scans;for(let i=0;i<100;i++)a.getEvDashboard('all');assert.equal(scans,count);
    cases.push('100 Insights widgets/reads reuse the SAME central historical aggregate and oldest-date cache');
    for(const [day,next,hours]of[['2026-03-29','2026-03-30',23],['2026-10-25','2026-10-26',25]])near((localDateTimeUtcMs(next,'00:00','Europe/Brussels')-localDateTimeUtcMs(day,'00:00','Europe/Brussels'))/3600000,hours);
    cases.push('Local-day coverage uses 23/25 elapsed hours at both DST transitions');
  }finally{Date.now=realNow;restore();}
  fs.writeFileSync(path.join(__dirname,'../validation/ev-energy-1.2.4.json'),JSON.stringify({passed:cases.length,cases,baselineFinancialComparison:Boolean(baseline),simulatedHomey:true},null,2)+'\n');
  console.log('EV energy:',cases.length,'cases passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
