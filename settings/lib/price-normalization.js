'use strict';
const { inferIntervalMinutes, localParts, localDateTimeUtcMs } = require('./homey-energy');
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MIN_SAMPLES = 4, MIN_MINUTES = 60, MAX_ERROR = 0.005, MAX_RMSE = 0.002;
const MIN_INLIER_SHARE = 0.8;
const number = value => value !== null && value !== undefined && Number.isFinite(Number(value));
function sourceOrder(mode, selected) {
  if (Array.isArray(selected)) return [...new Set(selected.filter(id => ['homey','external','external2'].includes(id)))];
  if (mode === 'external_homey_fallback') return ['external','homey'];
  if (mode === 'external') return ['external',null];
  return ['homey',mode === 'homey_external_fallback' ? 'external' : null];
}
function rowStartMs(row, timezone) {
  return number(row.startMs) ? Number(row.startMs) : localDateTimeUtcMs(row.dateKey,
    `${String(Math.floor(Number(row.minute)/60)).padStart(2,'0')}:${String(Number(row.minute)%60).padStart(2,'0')}`,timezone);
}
function intervals(rows, timezone = 'UTC') {
  const duration = inferIntervalMinutes(rows, 15) * 60000;
  return rows.filter(row => number(row.price)).map(row => {
    const start = rowStartMs(row,timezone);
    return {start, end:start+duration, price:Number(row.price)};
  }).filter(row => number(row.start)).sort((a,b)=>a.start-b.start);
}
function aggregateIntervals(items, duration, anchor) {
  const groups = new Map();
  for (const item of items) {
    for(let start=anchor+Math.floor((item.start-anchor)/duration)*duration; start<item.end; start+=duration) {
      const weight=Math.max(0,Math.min(start+duration,item.end)-Math.max(start,item.start));
      const group=groups.get(start) || {start,end:start+duration,total:0,weight:0};
      group.total+=item.price*weight;group.weight+=weight;groups.set(start,group);
    }
  }
  // Compare complete common-resolution blocks, never a partial-hour mean.
  return [...groups.values()].filter(group=>Math.abs(group.weight-duration)<1)
    .map(group=>({start:group.start,end:group.end,price:group.total/group.weight})).sort((a,b)=>a.start-b.start);
}
function calibrationResolution(items, timezone) {
  const duration=items.length ? items[0].end-items[0].start : 15*60000;
  if(duration!==15*60000)return {duration,repeatedHourly:false};
  // Some providers expose hourly prices as four identical quarter-hour values.
  // Infer this only from a consistent clock-hour pattern across the curve;
  // a few coincidentally flat quarters must not change genuine quarter data.
  const groups=new Map();
  for(const item of items) {
    const minute=localParts(new Date(item.start),timezone).minuteOfDay%60;
    const start=item.start-minute*60000;
    const group=groups.get(start)||[];group.push(item);groups.set(start,group);
  }
  let complete=0,anchor=null;
  const starts=[...groups.keys()],first=starts[0],last=starts.at(-1);
  for(const [start,group] of groups) {
    if(group.some((item,i)=>Math.abs(item.price-group[0].price)>1e-10
      || (i>0 && item.start!==group[i-1].end)))return {duration,repeatedHourly:false};
    if(group.length===4 && group[0].start===start && group[3].end===start+3600000) {
      complete++;anchor=start;
    } else if(start!==first && start!==last) {
      return {duration,repeatedHourly:false};
    }
  }
  return complete>=4 ? {duration:3600000,repeatedHourly:true,anchor} : {duration,repeatedHourly:false};
}
function overlapInfo(primary, secondary, {timezone='UTC',commonResolution=false} = {}) {
  let p = intervals(primary,timezone), s = intervals(secondary,timezone);
  const primaryResolution=commonResolution ? calibrationResolution(p,timezone) : {duration:p[0]?.end-p[0]?.start,repeatedHourly:false};
  const secondaryResolution=commonResolution ? calibrationResolution(s,timezone) : {duration:s[0]?.end-s[0]?.start,repeatedHourly:false};
  const comparisonDuration=Math.max(primaryResolution.duration,secondaryResolution.duration);
  if(commonResolution && p.length && s.length) {
    const pd=p[0].end-p[0].start,sd=s[0].end-s[0].start,duration=comparisonDuration;
    const anchor=primaryResolution.repeatedHourly ? primaryResolution.anchor
      : secondaryResolution.repeatedHourly ? secondaryResolution.anchor : (pd>=sd?p:s)[0].start;
    if(pd<duration)p=aggregateIntervals(p,duration,anchor);
    if(sd<duration)s=aggregateIntervals(s,duration,anchor);
  }
  const pairs=[];let i=0,j=0;
  while (i<p.length && j<s.length) {
    const start=Math.max(p[i].start,s[j].start), end=Math.min(p[i].end,s[j].end);
    if(end>start) pairs.push({x:s[j].price,y:p[i].price,w:(end-start)/60000,start,end});
    if(p[i].end<=s[j].end) i++;else j++;
  }
  return {pairs,primaryResolutionMinutes:primaryResolution.duration/60000,
    secondaryResolutionMinutes:secondaryResolution.duration/60000,comparisonResolutionMinutes:comparisonDuration/60000,
    primaryRepeatedHourly:primaryResolution.repeatedHourly,secondaryRepeatedHourly:secondaryResolution.repeatedHourly};
}
function overlapPairs(primary, secondary, options = {}) {
  return overlapInfo(primary,secondary,options).pairs;
}
const minutesOf = pairs => pairs.reduce((sum,pair)=>sum+pair.w,0);
function hasVariation(pairs) {
  return pairs.length && Math.max(...pairs.map(pair=>pair.x))-Math.min(...pairs.map(pair=>pair.x))>=0.005;
}
function regression(pairs) {
  const minutes=minutesOf(pairs),mx=pairs.reduce((sum,p)=>sum+p.x*p.w,0)/minutes,my=pairs.reduce((sum,p)=>sum+p.y*p.w,0)/minutes;
  const variance=pairs.reduce((sum,p)=>sum+p.w*(p.x-mx)**2,0);
  const scale=pairs.reduce((sum,p)=>sum+p.w*(p.x-mx)*(p.y-my),0)/variance;
  const offset=my-scale*mx;
  const errors=pairs.map(p=>Math.abs(scale*p.x+offset-p.y));
  return {scale,offset,rmse:Math.sqrt(pairs.reduce((sum,p,i)=>sum+p.w*errors[i]**2,0)/minutes),maxError:Math.max(...errors)};
}
const acceptable = fit => Number.isFinite(fit.scale) && fit.scale>=0.1 && fit.scale<=10 && fit.rmse<=MAX_RMSE && fit.maxError<=MAX_ERROR;
function median(values) {
  const sorted=values.sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
function fitCalibration(primary, secondary, now, {timezone='UTC'} = {}) {
  const {pairs:all,...resolution}=overlapInfo(primary,secondary,{timezone,commonResolution:true});
  const dateKey=localParts(new Date(now),timezone).dateKey;
  const dayStart=localDateTimeUtcMs(dateKey,'00:00',timezone);
  const nextDate=new Date(`${dateKey}T00:00:00Z`);nextDate.setUTCDate(nextDate.getUTCDate()+1);
  const dayEnd=localDateTimeUtcMs(nextDate.toISOString().slice(0,10),'00:00',timezone);
  // Future forecast differences must not invalidate an otherwise reliable
  // current-day tax/surcharge relation. Only today's shared blocks calibrate it.
  const pairs=all.filter(p=>p.start>=dayStart && p.end<=dayEnd);
  const minutes=minutesOf(pairs);
  const details={...resolution,samples:pairs.length,minutes,totalOverlapSamples:all.length,totalOverlapMinutes:minutesOf(all),
    windowStartAt:dayStart,windowEndAt:dayEnd,minSamples:MIN_SAMPLES,minMinutes:MIN_MINUTES,
    inliers:pairs.length,outliers:0,inlierMinutes:minutes,method:'weighted_linear',rmse:null,maxError:null};
  const fail=reason=>({model:null,reason,details});
  if(pairs.length<MIN_SAMPLES || minutes<MIN_MINUTES)return fail('insufficient_overlap');
  if(!hasVariation(pairs))return fail('insufficient_variation');
  let used=pairs,fit=regression(used);
  details.rmse=fit.rmse;details.maxError=fit.maxError;
  if(!acceptable(fit)) {
    // A median pairwise slope supplies an outlier-resistant seed. Refit only
    // when >=80% of both blocks and duration support the same linear relation.
    const slopes=[];
    for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++) {
      const dx=pairs[j].x-pairs[i].x;
      if(Math.abs(dx)>=0.005)slopes.push((pairs[j].y-pairs[i].y)/dx);
    }
    if(!slopes.length)return fail('insufficient_variation');
    const scale=median(slopes),offset=median(pairs.map(p=>p.y-scale*p.x));
    used=pairs.filter(p=>Math.abs(scale*p.x+offset-p.y)<=MAX_ERROR);
    details.method='robust_weighted_linear';
    details.inliers=used.length;details.outliers=pairs.length-used.length;details.inlierMinutes=minutesOf(used);
    if(used.length<MIN_SAMPLES || details.inlierMinutes<MIN_MINUTES
      || used.length/pairs.length<MIN_INLIER_SHARE || details.inlierMinutes/minutes<MIN_INLIER_SHARE || !hasVariation(used))return fail('incompatible_curves');
    fit=regression(used);
  }
  details.rmse=fit.rmse;details.maxError=fit.maxError;
  if(!acceptable(fit))return fail('incompatible_curves');
  const usedSet=new Set(used);
  const excludedIntervals=pairs.filter(pair=>!usedSet.has(pair)).map(({start,end})=>({start,end}));
  return {model:{scale:fit.scale,offset:fit.offset,learnedAt:now,validUntil:now+MAX_AGE_MS,
    samples:used.length,minutes:minutesOf(used),rmse:fit.rmse,details,excludedIntervals},reason:'ready',details};
}
function validCalibration(model, now) {
  return model && number(model.scale) && number(model.offset) && Number(model.scale)>=0.1 && Number(model.scale)<=10
    && number(model.learnedAt) && now>=Number(model.learnedAt) && now<=Number(model.validUntil)
    && Number(model.validUntil)<=Number(model.learnedAt)+MAX_AGE_MS;
}
function calibrationAgrees(model, primary, secondary, details, timezone) {
  // Sparse/flat new input cannot establish a new fit. It can still disprove
  // a cached fit, so do not retain a correction contradicted by today's data.
  const pairs=overlapPairs(primary,secondary,{timezone,commonResolution:true})
    .filter(pair=>pair.start>=details.windowStartAt && pair.end<=details.windowEndAt
      && !(model.excludedIntervals || []).some(range=>pair.start>=range.start && pair.end<=range.end));
  return pairs.every(pair=>Math.abs(Number(model.scale)*pair.x+Number(model.offset)-pair.y)<=MAX_ERROR);
}
function normalizeSecondary(rows,model,{timezone='UTC'}={}) {
  return rows.filter(row=> {
    const start=rowStartMs(row,timezone);
    return !(model.excludedIntervals || []).some(range=>start>=range.start && start<range.end);
  })
    .map(row=>({...row,sourcePrice:row.price,price:Number(row.price)*model.scale+model.offset}));
}
module.exports={sourceOrder,fitCalibration,validCalibration,calibrationAgrees,normalizeSecondary,overlapPairs,MAX_AGE_MS};
