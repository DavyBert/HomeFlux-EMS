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
// Different price units, taxes or provider margins may make an otherwise
// matching curve fall outside the narrow absolute-fit limits. Only the price
// source alignment path uses this alternative (never the fast P1 path).
function matchingTrend(pairs, fit, resolution, timezone) {
  if (!Number.isFinite(fit.scale) || fit.scale < 1e-6 || fit.scale > 1e6
    || !Number.isFinite(fit.offset) || !Number.isFinite(fit.rmse) || !Number.isFinite(fit.maxError)) return null;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for (const pair of pairs) {
    if (pair.x<minX) minX=pair.x;
    if (pair.x>maxX) maxX=pair.x;
    if (pair.y<minY) minY=pair.y;
    if (pair.y>maxY) maxY=pair.y;
  }
  const spanX=maxX-minX, spanY=maxY-minY;
  if (!(spanX>=1e-5 && spanY>=1e-5)) return null;
  const maxRmse=Math.max(MAX_RMSE,Math.min(0.01,spanY*0.035));
  const maxError=Math.max(MAX_ERROR,Math.min(0.03,spanY*0.10));
  if (fit.rmse>maxRmse || fit.maxError>maxError) return null;
  // Relaxed fits must not treat sampled quarter-hour prices at :15/:30/:45
  // as hourly market prices. Real hourly blocks start on the local clock hour.
  if (resolution.comparisonResolutionMinutes>=60
    && pairs.some(pair=>localParts(new Date(pair.start),timezone).minuteOfDay%60!==0)) return null;
  const minutes=minutesOf(pairs);
  // Incomplete quarter-hours must never be mistaken for an hourly trend.
  const spanMinutes=(pairs[pairs.length-1].end-pairs[0].start)/60000;
  if (!(minutes/spanMinutes>=0.95)) return null;
  const meanY=pairs.reduce((sum,p)=>sum+p.y*p.w,0)/minutes;
  const varianceY=pairs.reduce((sum,p)=>sum+p.w*(p.y-meanY)**2,0);
  const rSquared=1-(fit.rmse**2*minutes)/varianceY;
  if (!(rSquared>=0.99)) return null;
  // An almost exact affine transformation needs no additional direction test.
  // For approximate matches, require real rises AND falls at aligned times;
  // a merely monotonic but unrelated curve must not qualify as the same trend.
  let matchingMoves=0, differingMoves=0, rises=0, falls=0;
  if (fit.rmse>MAX_RMSE || fit.maxError>MAX_ERROR) {
    if (pairs.length<8 || spanY<0.005) return null;
    const minMoveX=spanX*0.04,minMoveY=spanY*0.04;
    for(let i=1;i<pairs.length;i++) {
      const dx=pairs[i].x-pairs[i-1].x,dy=pairs[i].y-pairs[i-1].y;
      if(Math.abs(dx)<minMoveX && Math.abs(dy)<minMoveY) continue;
      if(Math.abs(dx)>=minMoveX && Math.abs(dy)>=minMoveY && dx*dy>0) {
        matchingMoves++;
        if(dx>0) rises++;else falls++;
      } else differingMoves++;
    }
    if(rises<1 || falls<1 || matchingMoves<4 || matchingMoves/(matchingMoves+differingMoves)<0.85) return null;
  }
  return {rSquared,matchingMoves,differingMoves,maxRmse,maxError};
}
// The precise trend fit remains the first choice. If two providers expose
// the same broad hourly market shape but differ in quarter-hour noise or step
// resolution, compare complete shared hours instead of demanding near-exact
// point-by-point equality. Calibration still uses the original aligned prices.
// This is called only when source curves change, never in the fast P1 loop.
function matchingBroadTrend(pairs, fit, resolution, timezone) {
  if (pairs.length < 8 || !Number.isFinite(fit.scale) || fit.scale <= 0
    || fit.scale > 1e6 || !Number.isFinite(fit.offset)
    || !Number.isFinite(fit.rmse) || !Number.isFinite(fit.maxError)) return null;
  const minutes = minutesOf(pairs);
  const spanMinutes = (pairs[pairs.length - 1].end - pairs[0].start) / 60000;
  if (!spanMinutes || minutes / spanMinutes < 0.95) return null;
  // Retain the existing protection against treating partial quarter-hours as
  // complete hourly market prices.
  if (resolution.comparisonResolutionMinutes >= 60
    && pairs.some(pair => localParts(new Date(pair.start), timezone).minuteOfDay % 60 !== 0)) return null;
  const hours = new Map();
  for (const pair of pairs) {
    const start = Math.floor(pair.start / 3600000) * 3600000;
    const hour = hours.get(start) || {start, end:start + 3600000, w:0, x:0, y:0};
    hour.w += pair.w;
    hour.x += pair.x * pair.w;
    hour.y += pair.y * pair.w;
    hours.set(start, hour);
  }
  const hourly = [...hours.values()].filter(hour => Math.abs(hour.w - 60) < 1e-6)
    .sort((a, b) => a.start - b.start)
    .map(hour => ({...hour, x:hour.x / hour.w, y:hour.y / hour.w}));
  if (hourly.length < 8 || minutesOf(hourly) < 8 * 60) return null;
  const xs = hourly.map(p => p.x), ys = hourly.map(p => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
  if (spanX < 0.012 || spanY < 0.012) return null;
  const coarseFit = regression(hourly);
  if (!(coarseFit.scale > 0) || !Number.isFinite(coarseFit.rmse)) return null;
  const meanY = hourly.reduce((sum, p) => sum + p.y, 0) / hourly.length;
  const varianceY = hourly.reduce((sum, p) => sum + (p.y - meanY) ** 2, 0);
  const rSquared = 1 - coarseFit.rmse ** 2 * hourly.length / varianceY;
  if (!(rSquared >= 0.90)) return null;
  // Permit a modest gap between the hourly trend and the original noisy data,
  // but never permit arbitrarily inaccurate corrected prices.
  const maxRmse = Math.max(MAX_RMSE, Math.min(0.025, spanY * 0.17));
  const maxError = Math.max(MAX_ERROR, Math.min(0.05, spanY * 0.40));
  if (fit.rmse > maxRmse || fit.maxError > maxError) return null;
  let matchingMoves = 0, differingMoves = 0, rises = 0, falls = 0;
  const minMoveX = spanX * 0.06, minMoveY = spanY * 0.06;
  for (let i = 1; i < hourly.length; i++) {
    const dx = hourly[i].x - hourly[i-1].x, dy = hourly[i].y - hourly[i-1].y;
    if (Math.abs(dx) < minMoveX && Math.abs(dy) < minMoveY) continue;
    if (Math.abs(dx) >= minMoveX && Math.abs(dy) >= minMoveY && dx * dy > 0) {
      matchingMoves++;
      if (dx > 0) rises++; else falls++;
    } else differingMoves++;
  }
  if (!rises || !falls || matchingMoves < 4
    || matchingMoves / (matchingMoves + differingMoves) < 0.75) return null;
  return {rSquared, matchingMoves, differingMoves, maxRmse, maxError};
}
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
  let used=pairs,fit=regression(used);
  let trend=acceptable(fit)?null:(matchingTrend(used,fit,resolution,timezone)
    || matchingBroadTrend(used,fit,resolution,timezone));
  if(!hasVariation(pairs) && !trend)return fail('insufficient_variation');
  details.rmse=fit.rmse;details.maxError=fit.maxError;
  if(!acceptable(fit) && !trend) {
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
  if(!acceptable(fit)) {
    trend=matchingTrend(used,fit,resolution,timezone)
      || matchingBroadTrend(used,fit,resolution,timezone);
    if(!trend)return fail('incompatible_curves');
    details.method=details.method==='robust_weighted_linear'?'trend_robust_weighted_linear':'trend_weighted_linear';
    details.trendRSquared=trend.rSquared;
    details.trendMatchingMoves=trend.matchingMoves;
    details.trendDifferingMoves=trend.differingMoves;
    details.trendMaxErrorTolerance=trend.maxError;
  }
  const usedSet=new Set(used);
  const excludedIntervals=pairs.filter(pair=>!usedSet.has(pair)).map(({start,end})=>({start,end}));
  return {model:{scale:fit.scale,offset:fit.offset,learnedAt:now,validUntil:now+MAX_AGE_MS,
    samples:used.length,minutes:minutesOf(used),rmse:fit.rmse,details,excludedIntervals},reason:'ready',details};
}
function validCalibration(model, now) {
  const scale=Number(model?.scale);
  const trendModel=model?.trendAligned===true || model?.details?.method==='trend_weighted_linear' || model?.details?.method==='trend_robust_weighted_linear';
  return model && number(model.scale) && number(model.offset)
    && ((scale>=0.1 && scale<=10) || (trendModel && scale>=1e-6 && scale<=1e6))
    && number(model.learnedAt) && now>=Number(model.learnedAt) && now<=Number(model.validUntil)
    && Number(model.validUntil)<=Number(model.learnedAt)+MAX_AGE_MS;
}
function calibrationAgrees(model, primary, secondary, details, timezone) {
  // Sparse/flat new input cannot establish a new fit. It can still disprove
  // a cached fit, so do not retain a correction contradicted by today's data.
  const pairs=overlapPairs(primary,secondary,{timezone,commonResolution:true})
    .filter(pair=>pair.start>=details.windowStartAt && pair.end<=details.windowEndAt
      && !(model.excludedIntervals || []).some(range=>pair.start>=range.start && pair.end<=range.end));
  const tolerance=model.details?.method?.startsWith('trend_')
    ? Math.max(MAX_ERROR,Math.min(0.03,Number(model.details.trendMaxErrorTolerance)||MAX_ERROR)) : MAX_ERROR;
  return pairs.every(pair=>Math.abs(Number(model.scale)*pair.x+Number(model.offset)-pair.y)<=tolerance);
}
function normalizeSecondary(rows,model,{timezone='UTC'}={}) {
  return rows.filter(row=> {
    const start=rowStartMs(row,timezone);
    return !(model.excludedIntervals || []).some(range=>start>=range.start && start<range.end);
  })
    .map(row=>({...row,sourcePrice:row.price,price:Number(row.price)*model.scale+model.offset}));
}
module.exports={sourceOrder,fitCalibration,validCalibration,calibrationAgrees,normalizeSecondary,overlapPairs,MAX_AGE_MS};
