'use strict';
const { inferIntervalMinutes } = require('./homey-energy');
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const number = value => value !== null && value !== undefined && Number.isFinite(Number(value));
function sourceOrder(mode) {
  if (mode === 'external_homey_fallback') return ['external','homey'];
  if (mode === 'external') return ['external',null];
  return ['homey',mode === 'homey_external_fallback' ? 'external' : null];
}
function intervals(rows) {
  const duration = inferIntervalMinutes(rows, 15) * 60000;
  return rows.filter(row => number(row.price)).map(row => {
    const start = number(row.startMs) ? Number(row.startMs) : Date.parse(`${row.dateKey}T00:00:00Z`) + Number(row.minute)*60000;
    return {start, end:start+duration, price:Number(row.price)};
  }).filter(row => Number.isFinite(row.start)).sort((a,b)=>a.start-b.start);
}
function overlapPairs(primary, secondary) {
  const p = intervals(primary), s = intervals(secondary), pairs=[];
  let i=0,j=0;
  while (i<p.length && j<s.length) {
    const start=Math.max(p[i].start,s[j].start), end=Math.min(p[i].end,s[j].end);
    if(end>start) pairs.push({x:s[j].price,y:p[i].price,w:(end-start)/60000});
    if(p[i].end<=s[j].end) i++;else j++;
  }
  return pairs;
}
function fitCalibration(primary, secondary, now) {
  const pairs=overlapPairs(primary,secondary), minutes=pairs.reduce((n,p)=>n+p.w,0);
  if(pairs.length<4 || minutes<60) return {model:null, reason:'insufficient_overlap'};
  const meanX=pairs.reduce((n,p)=>n+p.x*p.w,0)/minutes, meanY=pairs.reduce((n,p)=>n+p.y*p.w,0)/minutes;
  const variance=pairs.reduce((n,p)=>n+p.w*(p.x-meanX)**2,0);
  if(Math.max(...pairs.map(p=>p.x))-Math.min(...pairs.map(p=>p.x))<0.005) return {model:null,reason:'insufficient_variation'};
  const scale=pairs.reduce((n,p)=>n+p.w*(p.x-meanX)*(p.y-meanY),0)/variance;
  const offset=meanY-scale*meanX;
  const errors=pairs.map(p=>Math.abs(scale*p.x+offset-p.y));
  const rmse=Math.sqrt(pairs.reduce((n,p,i)=>n+p.w*errors[i]**2,0)/minutes);
  if(!Number.isFinite(scale) || scale<0.1 || scale>10 || rmse>0.002 || Math.max(...errors)>0.005) return {model:null,reason:'incompatible_curves'};
  return {model:{scale,offset,learnedAt:now,validUntil:now+MAX_AGE_MS,samples:pairs.length,minutes,rmse},reason:'ready'};
}
function validCalibration(model, now) {
  return model && number(model.scale) && number(model.offset) && Number(model.scale)>=0.1 && Number(model.scale)<=10
    && number(model.learnedAt) && now>=Number(model.learnedAt) && now<=Number(model.validUntil)
    && Number(model.validUntil)<=Number(model.learnedAt)+MAX_AGE_MS;
}
function normalizeSecondary(rows,model) { return rows.map(row=>({...row,sourcePrice:row.price,price:Number(row.price)*model.scale+model.offset})); }
module.exports={sourceOrder,fitCalibration,validCalibration,normalizeSecondary,overlapPairs,MAX_AGE_MS};
