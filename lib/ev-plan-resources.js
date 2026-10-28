'use strict';
// Cached inputs to the EXISTING deadline planner; no timers, commands or device reads.
const { localParts, shiftDateKey, localDateTimeUtcMs } = require('./homey-energy');
const { findCurrentTariff, computeAverageSoc, computeEffectiveCapacityKwh } = require('./ems-engine');
const { isEvTariffSelected } = require('./flexible-loads');
const { householdDaily } = require('./widget-energy-budget');
const options = require('./ev-plan-options');
const HOUR=3600000;
function configuredCurve(app,index,settings,now) {
  const today=localParts(new Date(now),settings.timezone||'UTC').dateKey;
  app.evConfiguredDeadlineCurves ||= [];
  const key=today+'|'+(app.evDeadlineSettingsRevision||0);
  if(app.evConfiguredDeadlineCurves[index]?.key===key)return app.evConfiguredDeadlineCurves[index].curve;
  const end=localDateTimeUtcMs(shiftDateKey(today,8),'00:00',settings.timezone||'UTC');
  let at=localDateTimeUtcMs(today,'00:00',settings.timezone||'UTC');
  const intervals=[];
  // Advance by the tariff engine's actual next transition, including arbitrary
  // minute boundaries, weekends and local daylight-saving transitions.
  while(at<end && intervals.length<1200) {
    const tariff=findCurrentTariff(new Date(at),settings);
    const next=Number(tariff.nextAt?.getTime?.() ?? tariff.nextAt);
    const endAt=Math.min(end,Number.isFinite(next)&&next>at?next:tariff.kind==='tou' && tariff.nextAt===null ? end : at+15*60000);
    if(tariff.price!==null && Number.isFinite(Number(tariff.price))) intervals.push({startAt:at,endAt,price:Number(tariff.price),
      className:tariff.className,rateId:tariff.rateId,allowed:isEvTariffSelected(settings,tariff)});
    at=endAt;
  }
  const curve={intervals,fingerprint:key,configured:true};
  app.evConfiguredDeadlineCurves[index]={key,curve};
  return curve;
}
function need(app,index,settings,now) {
  const p=options.current(app,index);
  if(!p)return null;
  if(app.evEnergyPlans?.[index]===p)return Math.max(0,Number(p.remainingKwh)||0);
  const freshness=app.getEvSocFreshness(index,{evSocEnabled:settings[app.getEvSettingKey(index,'SocEnabled')],
    evSocFreshnessMinutes:settings[app.getEvSettingKey(index,'SocFreshnessMinutes')]},now);
  const soc=app.getEvInputSnapshot(index)?.soc;
  const cap=Number(settings[app.getEvSettingKey(index,'BatteryCapacityKwh')]);
  return freshness.fresh && Number.isFinite(Number(soc)) && cap>0 ? Math.max(0,cap*(Number(p.targetSoc)-Number(soc))/100) : null;
}
function pvCredits(app,now) {
  const settings=app.getSettings(),state=app.state,timezone=settings.timezone||'UTC';
  const today=localParts(new Date(now),timezone).dateKey, tomorrow=shiftDateKey(today,1);
  const key=JSON.stringify([Math.floor(now/300000),app.evDeadlineSettingsRevision,app.evDeadlineGoalRevision,
    state.forecastRemainingKwh,state.forecastTomorrowKwh,state.forecastDailyMaxDate,state.forecastTomorrowDate]);
  if(app.evMaxPvBudget?.key===key)return app.evMaxPvBudget;
  const result={key,credits:[0,0,0,0],provisional:true,reason:'forecast_or_reservation_unavailable',builtAt:now};
  app.evMaxPvBudget=result;
  const demand=householdDaily(app.autoTuneRuntime?.planning,settings.expectedEnergyNeedKwh);
  if(!demand)return result;
  const tomorrowAt=localDateTimeUtcMs(tomorrow,'00:00',timezone);
  const afterTomorrowAt=localDateTimeUtcMs(shiftDateKey(today,2),'00:00',timezone);
  const segments=[];
  if(app.inputSeen?.forecast && state.forecastDailyMaxDate===today && state.forecastRemainingKwh!==null
    && Number.isFinite(Number(state.forecastRemainingKwh))) segments.push({endAt:tomorrowAt,hours:(tomorrowAt-now)/HOUR,kwh:Math.max(0,Number(state.forecastRemainingKwh))});
  if(app.inputSeen?.forecastTomorrow && state.forecastTomorrowDate===tomorrow && state.forecastTomorrowKwh!==null
    && Number.isFinite(Number(state.forecastTomorrowKwh))) segments.push({endAt:afterTomorrowAt,hours:(afterTomorrowAt-tomorrowAt)/HOUR,kwh:Math.max(0,Number(state.forecastTomorrowKwh))});
  if(!segments.length)return result;
  let batteryReserve=0,batteryCapacity=0;
  if(Number(settings.batteryCount)>0) {
    const count=Number(settings.batteryCount),socs=state.batterySoc?.slice(0,count)||[];
    if(socs.length!==count || socs.some(s=>s===null || !Number.isFinite(Number(s))))return result;
    const soc=computeAverageSoc(state,settings),cap=computeEffectiveCapacityKwh(state,settings);
    if(soc===null || !(cap>0) || !Number.isFinite(Number(settings.maxSoc)))return result;
    // PV fills the existing battery maximum first. Planned grid energy is
    // never counted as extra PV; reserve this room once across all EVs/days.
    batteryCapacity=cap;
    batteryReserve=cap*Math.max(0,Number(settings.maxSoc)-soc)/100;
  }
  const evs=[];
  for(let i=0;i<app.getEvCount(settings);i++) {
    if(!settings[app.getEvSettingKey(i,'Enabled')])continue;
    const p=options.current(app,i);
    if(!p || p.widgetPlan?.completed || !(p.deadlineAt>now))continue;
    const kwh=need(app,i,settings,now);
    if(kwh===null)return result; // An unknown competing goal cannot finance PV credit.
    evs.push({index:i,deadlineAt:p.deadlineAt,need:kwh,maxPv:Boolean(p.widgetPlan?.maxPv)});
  }
  // Non-Max-PV goals have priority on this one shared forecast pool. They may
  // consume live PV too; reserving them prevents a second forecast allocation.
  let otherReserve=evs.filter(e=>!e.maxPv).reduce((n,e)=>n+e.need,0);
  evs.sort((a,b)=>a.deadlineAt-b.deadlineAt||a.index-b.index);
  for(const segment of segments) {
    if(segment.endAt>tomorrowAt) batteryReserve=Math.max(batteryReserve,batteryCapacity);
    let pool=Math.max(0,segment.kwh-demand.kwh/24*segment.hours);
    const battery=Math.min(pool,batteryReserve);pool-=battery;batteryReserve-=battery;
    const other=Math.min(pool,otherReserve);pool-=other;otherReserve-=other;
    for(const ev of evs) {
      if(!ev.maxPv || ev.deadlineAt<segment.endAt)continue; // no invented intraday profile
      const share=Math.min(pool,Math.max(0,ev.need-result.credits[ev.index]));
      result.credits[ev.index]+=share;pool-=share;
    }
  }
  result.reason='known_forecast_after_house_battery_and_other_evs';
  // App only has remaining-today and a full tomorrow total, not an hourly or
  // seven-day forecast. Keep this explicit even when the conservative credit is useful.
  return result;
}
module.exports={configuredCurve,pvCredits,need};
