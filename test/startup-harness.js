const Module=require('node:module'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'..');
const original=Module._load;
Module._load=function(n,p,m){if(n==='homey')return {App:class {}};if(n==='homey-api')return {HomeyAPI:{}};return original.call(this,n,p,m)};
const App=require(root+'/app');Module._load=original;
const {DEFAULTS}=require(root+'/lib/ems-engine');
async function boot(store=new Map()) {
 const app=new App(),errors=[],logs=[],timers=[],cards=new Map(),tokens=new Map();
 function card(id){if(!cards.has(id))cards.set(id,{registerRunListener(fn){this.listener=fn;return this},registerArgumentAutocompleteListener(){return this},trigger:async()=>{}});return cards.get(id)}
 app.homey={clock:{getTimezone:()=> 'Europe/Brussels'},i18n:{getLanguage:()=> 'en'},settings:{get:k=>store.has(k)?store.get(k):null,set:(k,v)=>store.set(k,structuredClone(v)),on:()=>{}},
 flow:{getToken:k=>tokens.get(k),createToken:async(k)=>{const t={setValue:async()=>{},unregister:async()=>{}};tokens.set(k,t);return t},getTriggerCard:card,getActionCard:card,getConditionCard:card},
 setTimeout:(fn,ms)=>{timers.push({fn,ms,type:'timeout'});return timers.length},setInterval:(fn,ms)=>{timers.push({fn,ms,type:'interval'});return timers.length},clearTimeout:()=>{},clearInterval:()=>{},manifest:JSON.parse(fs.readFileSync(root+'/app.json'))};
 app.log=(...v)=>logs.push(v.join(' '));app.error=(...v)=>errors.push(v.map(x=>x.stack||x).join(' '));
 await app.onInit();
 return {app,store,errors,logs,timers,cards,tokens};
}
module.exports = { boot, DEFAULTS };
