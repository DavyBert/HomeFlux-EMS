'use strict';
const assert=require('node:assert/strict');
const api=require('../api');
const widgetProfiles=require('../lib/visual-widget-profiles');

(async()=>{
  const values=new Map(),calls=[];
  const homey={
    app:{localizeDisplay:v=>v,translateDisplay:v=>v},
    settings:{
      get:key=>values.has(key)?structuredClone(values.get(key)):null,
      set:(key,value)=>values.set(key,structuredClone(value)),
    },
    api:{realtime:async(event,payload)=>{calls.push({event,payload});}},
  };
  const name='medium';
  const profile=widgetProfiles.get(homey,name);
  profile.dayHidden=['dayChart','dayWaf'];
  const stored=await api.setVisualWidgetProfile({homey,body:{name,profile}});
  assert.deepEqual(stored.dayHidden,profile.dayHidden);
  assert.deepEqual(calls,[{event:'homeflux.visual.refresh',payload:{reason:'profile',name}}]);
  assert.deepEqual(widgetProfiles.get(homey,name).dayHidden,profile.dayHidden);
  const result=await api.requestVisualWidgetRefresh({homey});
  assert.deepEqual(result,{requested:false,reason:'profile_only'});
  assert.equal(calls.length,1,'generic EMS Save must never emit a Visual Look refresh');
  const before=calls.length;
  await assert.rejects(()=>api.setVisualWidgetProfile({homey,body:{name:'invalid',profile}}));
  assert.equal(calls.length,before,'failed saves must not request widget refresh');
  // A missing subscriber must not prevent a profile from being persisted.
  homey.api.realtime=async()=>{throw new Error('dashboard offline')};
  const beforeLog=console.warn;
  try{
    console.warn=()=>{};
    const saved=await api.setVisualWidgetProfile({homey,body:{name:'compact',profile:widgetProfiles.defaults().compact}});
    assert.equal(saved.name,'compact');
  }finally{console.warn=beforeLog;}
  assert.equal(widgetProfiles.get(homey,'compact').configured,true);
  console.log('PASS Visual Look refresh: only profile saves notify, generic saves ignored, invalid profile no event, no dashboard tolerated');
})().catch(err=>{console.error(err);process.exitCode=1;});
