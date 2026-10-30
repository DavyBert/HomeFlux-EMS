'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { boot } = require('./startup-harness');
const options = require('../lib/ev-plan-options');
const tags = require('../lib/ems-status-tags');
const { localDateTimeUtcMs: at, shiftDateKey, localParts } = require('../lib/homey-energy');
const { calculateEvDecision } = require('../lib/flexible-loads');
const RealDate = Date, realNow = Date.now, zone = 'Europe/Brussels';
let clock = at('2026-10-30','12:00',zone);
global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [Date.now()])); } };
Date.now = () => clock;
const results = [];
async function check(name, fn) { await fn(); results.push(name); }
async function fixture(store) {
  const h = await boot(store || new Map(Object.entries({ evCount:4,evEnabled:true,ev2Enabled:true,ev3Enabled:true,ev4Enabled:true,
    evSocEnabled:true,ev2SocEnabled:true,ev3SocEnabled:true,ev4SocEnabled:true,batteryCount:0,controlEnabled:false })));
  h.app.requestContextEvaluate = () => {};
  for(let n=0;h.app.statusPublishing && n<500;n++)await Promise.resolve();
  assert.equal(h.app.statusPublishing,false); return h;
}
const flow = (h,i,type,value,time='06:00') => h.cards.get(`set_ev${i+1}_${type==='soc'?'soc':'energy'}_deadline`)
  .listener({[type==='soc'?'target_soc':'energy']:value,time,guarantee:'yes'});
const extend = (h,i,d) => h.cards.get('set_ev_session_override_for_configured').listener({ev:{kind:'ev',id:String(i+1)},mode:`extend_plan_${d}_days`});
(async()=>{try {
  const h = await fixture(), a = h.app;
  await check('All 1–7 day options, four EV slots and both goals preserve original deadline time, target, guarantee and kWh progress',async()=>{
    for(let i=0;i<4;i++)for(const type of ['soc','kwh'])for(let d=1;d<=7;d++){
      a.clearEvSocPlan(i);assert.equal(await flow(h,i,type,type==='soc'?60:20),true);
      const p=options.current(a,i), original=p.deadlineAt;
      if(type==='kwh')p.remainingKwh=12.5;
      assert.equal(await extend(h,i,d),true);
      assert.equal(p.deadlineAt,at(shiftDateKey(localParts(new Date(original),zone).dateKey,d),'06:00',zone));
      assert.equal(p.targetTime,'06:00');assert.equal(type==='soc'?p.targetSoc:p.targetKwh,type==='soc'?60:20);
      if(type==='kwh')assert.equal(p.remainingKwh,12.5);
      assert.equal(p.guarantee,true);assert.equal(options.protectedPlan(a,i),true);
      assert.equal(a.getEvInstanceSettings(i).evWidgetPlan.deadlineAt,p.deadlineAt);
    }
  });
  await check('Without an active plan, completed plan, invalid option or impossible DST time there is no new goal or mutation',async()=>{
    a.clearEvSocPlan(0);const before=JSON.stringify(a.evSocPlans);assert.equal(await extend(h,0,1),false);assert.equal(JSON.stringify(a.evSocPlans),before);
    assert.equal(await h.cards.get('set_ev_session_override_for_configured').listener({ev:{kind:'ev',id:'1'},mode:'extend_plan_8_days'}),false);
    assert.equal(a.getEvSessionOverrideFor(0).mode,null);
    await flow(h,0,'kwh',0);assert.equal(await extend(h,0,1),false);a.clearEvSocPlan(0);
    clock=at('2027-03-27','00:30',zone);await flow(h,0,'soc',60,'02:30');
    const snapshot=JSON.stringify(options.current(a,0));assert.equal(await extend(h,0,1),false);assert.equal(JSON.stringify(options.current(a,0)),snapshot);
    a.clearEvSocPlan(0);clock=at('2026-10-30','12:00',zone);
  });
  await check('Extension uses the saved deadline rather than today; repeated actions add to the current deadline',async()=>{
    await flow(h,0,'soc',60);const p=options.current(a,0), original=p.deadlineAt;
    await extend(h,0,2);await extend(h,0,3);assert.equal(p.deadlineAt,original+5*86400000);
  });
  await check('Every legacy, generic and configured SoC/kWh input is blocked while an extended plan is active',async()=>{
    for(let i=0;i<4;i++){
      const p=options.current(a,i), before=JSON.stringify(p);
      for(const type of ['soc','energy']){
        const args={target_soc:99,energy:100,time:'23:00',guarantee:'no'};
        assert.equal(await h.cards.get(`set_ev${i+1}_${type}_deadline`).listener(args),false);
        assert.equal(await h.cards.get(`set_ev_${type}_deadline_for`).listener({...args,ev:String(i+1)}),false);
        assert.equal(await h.cards.get(`set_ev_${type}_deadline_for_configured`).listener({...args,ev:{kind:'ev',id:String(i+1)}}),false);
      }
      assert.equal(JSON.stringify(p),before);
    }
  });
  await check('Existing widget multi-day plans also block competing Flow inputs while keeping their own editor available',async()=>{
    const x=await fixture(),b=x.app;
    await b.setEvDashboard({evId:'1',requestId:'existing_multiday_129',change:{target:{type:'soc',value:60},time:'06:00',days:3}});
    assert(options.protectedPlan(b,0));assert.equal(await flow(x,0,'kwh',30),false);
    await b.setEvDashboard({evId:'1',requestId:'existing_multiday_edit_129',change:{guaranteed:true}});
    assert.equal(options.current(b,0).targetSoc,60);assert.equal(options.current(b,0).guarantee,true);
    b.markEvSessionEnded(0,'soc_target');assert.equal(await flow(x,0,'kwh',30),true);
  });
  await check('Restart, midnight, expired deadline, disconnect/reconnect and pauses preserve fixed deadlines and remaining energy',async()=>{
    const expected=[0,1,2,3].map(i=>JSON.parse(JSON.stringify(options.current(a,i))));
    clock+=86400000;const x=await fixture(new Map(h.store));
    for(let i=0;i<4;i++){
      let p=options.current(x.app,i);assert.equal(p.deadlineAt,expected[i].deadlineAt);assert(options.protectedPlan(x.app,i));
      const remaining=p.remainingKwh;
      x.app.updateEvStatusInput(i,true,0);x.app.updateEvStatusInput(i,false,0);x.app.updateEvStatusInput(i,true,0);
      p=options.current(x.app,i);assert(p);assert.equal(p.deadlineAt,expected[i].deadlineAt);assert.equal(p.remainingKwh,remaining);
    }
    clock=at('2026-12-01','12:00',zone);
    const b=(await fixture(new Map(x.store))).app;
    for(let i=0;i<4;i++){const deadline=options.current(b,i).deadlineAt;b.getEvInstanceSettings(i);assert.equal(options.current(b,i).deadlineAt,deadline);assert(options.protectedPlan(b,i));}
    clock=at('2026-10-30','12:00',zone);
  });
  await check('Goal completion releases input protection and survives restart without rearming the completed goal',async()=>{
    for(const type of ['soc','kwh']){
      const x=await fixture(), b=x.app;await flow(x,0,type,type==='soc'?60:20);await extend(x,0,3);
      b.updateEvStatusInput(0,true,0);
      if(type==='kwh')b.evEnergyPlans[0].remainingKwh=0;
      b.markEvSessionEnded(0,type==='soc'?'soc_target':'energy_target');
      assert(options.widget(b,0).completed);assert.equal(options.protectedPlan(b,0),false);
      const restarted=await fixture(new Map(x.store));assert(options.widget(restarted.app,0).completed);
      assert.equal(options.protectedPlan(restarted.app,0),false);
      assert.equal(await flow(restarted,0,'soc',75),true);assert.equal(options.current(restarted.app,0).targetSoc,75);
    }
  });
  await check('Existing Clear EV Plan cancels only selected EV and remains clear through restart',async()=>{
    const x=await fixture(new Map(h.store));
    assert.equal(await x.cards.get('clear_ev_soc_deadline_override_for_configured').listener({ev:{kind:'ev',id:'1'}}),true);
    assert.equal(options.current(x.app,0),null);assert(options.current(x.app,1));
    const b=(await fixture(new Map(x.store))).app;assert.equal(options.current(b,0),null);
    assert.equal(options.protectedPlan(b,0),false);assert.equal(await flow(x,0,'kwh',10),true);
  });
  await check('Local calendar extension preserves clock time across 23-hour and 25-hour DST days',async()=>{
    for(const [date,next,hours] of [['2027-03-27','2027-03-28',23],['2026-10-24','2026-10-25',25]]){
      clock=at(date,'00:00',zone);const x=await fixture();await flow(x,0,'soc',60);
      const p=options.current(x.app,0), before=p.deadlineAt;await extend(x,0,1);
      assert.equal(p.deadlineAt,at(next,'06:00',zone));assert.equal((p.deadlineAt-before)/3600000,hours);
    }
    clock=at('2026-10-30','12:00',zone);
  });
  await check('Existing override modes remain available and legacy single-day Flow targets retain replacement semantics',async()=>{
    const x=await fixture();
    for(const mode of ['smart','soc_target','emergency']){
      assert.equal(await x.cards.get('set_ev_session_override_for_configured').listener({ev:{kind:'ev',id:'1'},mode}),true);
      assert.equal(x.app.getEvSessionOverrideFor(0).mode,mode);
    }
    await flow(x,0,'soc',60);assert.equal(await flow(x,0,'kwh',12),true);assert.equal(options.current(x.app,0).targetKwh,12);
  });
  await check('Flow extensions retain configured and session mode ownership, including Emergency, without deferred or stale mode restoration',async()=>{
    const x=await fixture(),b=x.app;
    for(let i=0;i<4;i++){
      await flow(x,i,'soc',60);await extend(x,i,2);
      assert.equal(b.getEvDashboard().evs[i].plan.owner,'flow');
      for(const mode of ['smart','soc_target','emergency']){
        assert.equal(await x.cards.get('set_ev_session_override_for_configured').listener({ev:{kind:'ev',id:String(i+1)},mode}),true);
        assert.equal(b.getEffectiveEvModeFor(i),mode);assert.equal(b.getEvInstanceSettings(i).evMode,mode);
        assert.equal(options.current(b,i).targetSoc,60);assert(options.protectedPlan(b,i));
      }
      b.clearEvSocPlan(i);assert.equal(b.getEffectiveEvModeFor(i),'emergency');
    }
  });
  await check('Completed extended goals remain stopped across restart but cannot block a later explicit Emergency override',async()=>{
    const x=await fixture();await flow(x,0,'soc',60);await extend(x,0,2);
    x.app.updateEvStatusInput(0,true,0);x.app.markEvSessionEnded(0,'soc_target');
    const restarted=await fixture(new Map(x.store)),b=restarted.app;assert(options.widget(b,0).completed);
    await restarted.cards.get('set_ev_session_override_for_configured').listener({ev:{kind:'ev',id:'1'},mode:'emergency'});
    assert.equal(options.current(b,0),null);assert.equal(b.getEvInstanceSettings(0).evWidgetPlan,undefined);
    assert.equal(b.getEffectiveEvModeFor(0),'emergency');
  });
  await check('Full decision reasons match widget selection in both languages, including all fallback branches and long explanations',()=>{
    const html=fs.readFileSync(path.join(__dirname,'../widgets/status/public/index.html'),'utf8');
    const source=html.slice(html.indexOf('    function emsDecision(status, Homey)'),html.indexOf('    function batteryTargetText'));
    for(const language of ['en','nl']){
      const locale=require('../locales/'+language+'.json');const c=vm.createContext({tr:(_,key,fallback)=>key.split('.').reduce((v,k)=>v?.[k],locale)||fallback,Number,String});vm.runInContext(source,c);
      const list=[{modeLabel:'Charging · '+('Detailed reason · '.repeat(100))}, {warningText:'Warning'},
        ...['peak_shave','grid_charge','grid_and_pv_charge','pv_charge','avoid_grid_import','discharge','idle'].map(action=>({action})),
        ...['solar_capture','charge','manual_charge','avoid_import','standby','self_consumption'].map(baseMode=>({baseMode})),
        {batteryDischargeBlockedByEv:true}, ...['planning_floor','discharge_floor','minimum_soc'].map(batteryPauseCode=>({batteryPauseCode,batteryDischargeFloorSoc:30})),{batteryPauseReason:'Custom pause'}];
      for(const s of list){const value=tags.values(s,null,language,clock);assert.equal(value.emsdecision,c.emsDecision(s,{}));
        assert.equal(value.emsdecisionreasons,c.emsDecisionReason(s,{}));}
    }
  });
  await check('WAF uses exact existing widget gradient and publishes red/orange/green plus empty unavailable state',()=>{
    const html=fs.readFileSync(path.join(__dirname,'../widgets/status/public/index.html'),'utf8');
    const source=html.slice(html.indexOf('    function known('),html.indexOf('    function criticalAlertText('));const c=vm.createContext({Date,Math,Number});vm.runInContext(source,c);
    for(const [valueKwh,status] of [[-8,'red'],[-4,'red'],[-2,'red'],[1,'orange'],[3,'orange'],[7,'green'],[12,'green']]){
      const budget={ready:true,valueKwh,calculatedAt:clock-1,validUntil:clock+10000};assert.equal(tags.waf(budget,clock).status,status);
      assert.equal(tags.waf(budget,clock).color,c.budgetView(budget,true,clock).background);
      assert.equal(tags.waf(budget,clock+10000).status,'');
    }
    for(const valueKwh of [null,undefined,'',NaN])assert.equal(tags.waf({ready:true,valueKwh,calculatedAt:clock-1,validUntil:clock+1000},clock).status,'');
  });
  await check('Every extra tag is global, changed-only, clears when irrelevant and uses the same reason as the status API without new timers',async()=>{
    const x=await fixture(),b=x.app,writes=new Map(),timerCount=x.timers.length;
    for(const [id] of tags.definitions){assert(b.tokens.has(id));b.lastStatusTokenValues.delete(id);b.tokens.get(id).setValue=async v=>{const row=writes.get(id)||[];row.push(v);writes.set(id,row);};}
    const r={...(b.latestResult||{}),inputReady:true,controlEnabled:true,modeLabel:'Test · Full explanation',statusText:'Stable',tariff:{label:'Low'},planningPhase:'night',batteryPauseReason:'Pause',batteryPauseCode:'planning_floor'};
    b.planningCache={energyBudget:{ready:true,valueKwh:7,calculatedAt:clock,validUntil:clock+1000}};
    const signature=b.getStatusResultSignature(r);
    for(let n=0;n<30;n++){b.pendingStatusResult=r;await b.publishPendingStatus();}
    for(const [id] of tags.definitions)assert.equal((writes.get(id)||[]).length,1,id);
    b.latestResult=r;assert.equal(b.getPublicStatus().decisionReason,writes.get('emsdecisionreasons')[0]);
    const changed={...r,modeLabel:'Test · A different full explanation'};
    assert.notEqual(b.getStatusResultSignature(changed),signature);
    b.pendingStatusResult=changed;await b.publishPendingStatus();assert.equal(writes.get('emsdecisionreasons').length,2);
    assert.equal(writes.get('emswafstatus').length,1);
    clock+=1001;b.pendingStatusResult={...changed,batteryPauseReason:'',batteryPauseCode:'',inputReady:false,missingInputs:['grid']};
    await b.publishPendingStatus();assert.equal(writes.get('emswafstatus').at(-1),'');assert.equal(writes.get('emsbatterypausereason').at(-1),'');assert.equal(writes.get('emsinputready').at(-1),false);
    assert.equal(writes.get('emsmissinginputs').at(-1),'grid');assert(writes.get('emscriticalalert').at(-1));
    assert.equal(x.timers.length,timerCount);assert.deepEqual(x.errors,[]);clock-=1001;
  });
  await check('Active card options are additive; all deprecated card manifests and existing arguments remain byte-for-byte compatible',()=>{
    const root=path.join(__dirname,'..'),base=process.env.HEMS_129_BASELINE;
    const current=JSON.parse(fs.readFileSync(path.join(root,'app.json'))), old=base&&JSON.parse(fs.readFileSync(path.join(base,'app.json')));
    const card=current.flow.actions.find(c=>c.id==='set_ev_session_override_for_configured');assert.equal(card.args.find(a=>a.name==='mode').values.length,10);
    if(old){for(const group of Object.keys(old.flow))for(const c of old.flow[group]){
      const next=current.flow[group].find(x=>x.id===c.id);assert(next,c.id);if(c.deprecated)assert.deepEqual(next,c,c.id);
      if(['set_ev_soc_deadline_for_configured','set_ev_energy_deadline_for_configured'].includes(c.id)){
        assert.deepEqual({...next,hint:c.hint},c,c.id);assert(next.hint.en.includes('active multi-day plan'));
      } else if(c.id!=='set_ev_session_override_for_configured')assert.deepEqual(next,c,c.id);
      else {assert.deepEqual(next.args[0],c.args[0]);assert.deepEqual(next.args[1].values.slice(0,3),c.args[1].values);assert.equal(next.args[1].name,c.args[1].name);}
    }assert.equal(current.flow.actions.length,old.flow.actions.length);}
  });
  fs.writeFileSync(path.join(__dirname,'../validation/features-1.2.9.json'),JSON.stringify({version:'1.2.9',simulatedHomey:true,passed:results.length,results},null,2)+'\n');
  console.log('1.2.9: '+results.length+' scenario groups passed (56 EV extension combinations plus lifecycle, tags and compatibility).');
}finally{global.Date=RealDate;Date.now=realNow;}})().catch(e=>{console.error('FAILED after '+results.length+' groups',e);process.exitCode=1;});
