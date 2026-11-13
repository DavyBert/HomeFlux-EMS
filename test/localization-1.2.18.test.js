'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),languages=['fr','es','de'];
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const tokens=text=>String(text).match(/\[\[[^\]]+\]\]|\{\d+\}|\{[A-Za-z_]+\}|__[A-Za-z_]+__|%[sdif]/g)?.sort()||[];
const leaves=(v,p='')=>typeof v==='string'?[[p,v]]:Object.entries(v).flatMap(([k,x])=>leaves(x,p?p+'.'+k:k));
const pick=(v,p)=>p.split('.').reduce((x,k)=>x?.[k],v);
const en=read('locales/en.json'),source=read('settings/translations/en.json');let strings=0,metadata=0;
for(const language of languages){
 const locale=read(`locales/${language}.json`),bundle=read(`settings/translations/${language}.json`);
 assert.deepEqual(leaves(locale).map(([k])=>k),leaves(en).map(([k])=>k));
 assert.equal(locale.settings.language,language);assert.equal(locale.evWidget.language,language);assert.equal(bundle.language,language);
 for(const [key,value]of leaves(en)){
  const target=pick(locale,key);assert.equal(typeof target,'string');if(value)assert(target.trim(),`${language}/${key}`);
  assert.deepEqual(tokens(target),tokens(value),`${language}/${key}: placeholders`);strings++;
 }
 for(const section of ['exact','phrases','templates','strings'])for(const [key,value]of Object.entries(source[section]||{})){
  const target=bundle[section][key];assert.equal(typeof target,'string',`${language}/${section}/${key}`);
  if(value)assert(target.trim());assert.deepEqual(tokens(target),tokens(value),`${language}/${section}/${key}: placeholders`);strings++;
 }
 for(const key of Object.keys(source))assert(Object.hasOwn(bundle,key),`missing original bundle key ${key}`);
 for(const section of ['exact','phrases','templates'])for(const [key,target]of Object.entries(bundle[section]||{}))assert(!/[\uFFFD\u00C3\u00C2]|981000\d+|[-]{12}/.test(target),`${language}/${key}: invalid text`);
 const translate=require('../settings/display-language').createTranslator(bundle);
 for(const text of ['Choose heating/cooling using','Indoor temperature (existing behaviour)','Standby temperature must be between 5 and 99 °C.'])assert.notEqual(translate(text),text,`${language}: untranslated runtime text`);
 const website=fs.readFileSync(path.join(root,`README.${language}.txt`),'utf8');assert(website.length>1000);assert(website.startsWith('Your energy, managed differently'));assert(!/release notes|notes de version|Versionshinweise|notas de versión/i.test(website));
 assert(read('.homeychangelog.json')['1.2.18'][language].length>100);
 assert(fs.readFileSync(path.join(root,'README.md'),'utf8').includes(read('.homeychangelog.json')[read('app.json').version][language]));
}
function scan(value,where){
 if(Array.isArray(value))return value.forEach((x,i)=>scan(x,where+'/'+i));
 if(!value||typeof value!=='object')return;
 if(typeof value.en==='string'||Array.isArray(value.en)){
  for(const language of languages){
   assert.equal(typeof value[language],typeof value.en,where+'/'+language);
   if(typeof value.en==='string'){assert(value[language].trim()||!value.en);assert.deepEqual(tokens(value[language]),tokens(value.en),where+'/'+language);}
   else {assert.equal(value[language].length,value.en.length);assert(value[language].every(x=>typeof x==='string'));}
  }metadata++;
 }else for(const [k,v]of Object.entries(value))scan(v,where+'/'+k);
}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.json')?[path.join(dir,e.name)]:[]);}
for(const folder of ['.homeycompose','drivers','widgets'])for(const file of files(path.join(root,folder)))scan(JSON.parse(fs.readFileSync(file,'utf8')),path.relative(root,file));
const manifest=read('app.json');scan(manifest,'app.json');scan(read('.homeychangelog.json'),'changelog');
for(const kind of ['actions','conditions','triggers'])for(const card of manifest.flow[kind]){
 assert.deepEqual(card,{id:card.id,...read(`.homeycompose/flow/${kind}/${card.id}.json`)});
 if(card.titleFormatted)for(const language of languages)assert.deepEqual(tokens(card.titleFormatted[language]),tokens(card.titleFormatted.en),card.id+'/'+language);
}
const display=require('../lib/display-language'),tags=require('../lib/ems-status-tags');
const expected={fr:'Réserve de batterie préservée, recharge prévue plus tard.',es:'Reserva de batería conservada; carga programada para más tarde.',de:'Batteriereserve erhalten, Laden für später geplant.'};
const status={inputReady:true,controlEnabled:true,baseMode:'charge',action:'idle',tariff:{chargeStrategy:{mode:'maximum',active:false,missingKwh:0,reserveMissed:false}}};
for(const language of languages){
 assert.equal(display.normalizeLanguage(language+'-XX'),language);assert.equal(tags.values(status,null,language).emsdecisionreasons,expected[language]);
 const input={reason:'Netimport vermijden',name:'Mijn HVAC',id:'avoid_import',mode:'heat',commands:[100,-200],settings:{reason:'Niet vertalen'}};
 const snapshot=JSON.stringify(input),out=display.localizeDisplay(input,language);
 assert.notEqual(out.reason,input.reason);assert.equal(out.name,input.name);assert.equal(out.mode,input.mode);assert.equal(out.id,input.id);assert.deepEqual(out.commands,input.commands);assert.equal(out.settings,input.settings);assert.equal(JSON.stringify(input),snapshot);
 const values=display.localizeTokens({reason:'Netimport vermijden',current:16,state_value:0},language);assert.equal(values.current,16);assert.equal(values.state_value,0);
}
assert.equal(display.normalizeLanguage('zz'),'en');
const label=require('../lib/ev-plan-options').label(Date.parse('2026-11-02T16:00:00Z'),'Europe/Brussels');
assert.equal(label.dateKey,'2026-11-02');assert.equal(label.time,'17:00');assert.equal(label.nl,'ma 02/11/2026 · 17:00');assert.equal(label.en,'Mon 02/11/2026 · 17:00');
for(const language of languages)assert(label[language].endsWith('17:00'));
async function main(){
 const {localizeFlowErrors}=require('../lib/flow-language');
 for(const language of languages){
  const cards=new Map(),raw={getActionCard(id){if(!cards.has(id))cards.set(id,{registerRunListener(fn){this.listener=fn;return this;}});return cards.get(id);}};
  const flow=localizeFlowErrors(raw,()=>language);let calls=0;const args={enabled:'no',standby_temperature:17},state={hvac:'2'};
  flow.getActionCard('ok').registerRunListener((a,s)=>{calls++;assert.equal(a,args);assert.equal(s,state);return true;});assert.equal(cards.get('ok').listener(args,state),true);assert.equal(calls,1);
  const error=new Error('Stand-bytemperatuur moet tussen 5 en 99 °C liggen.');flow.getActionCard('bad').registerRunListener(async()=>{throw error;});
  await assert.rejects(()=>cards.get('bad').listener(args,state),e=>e===error&&!e.message.startsWith('Stand-bytemperatuur moet'));
 }
 const previous=process.env.HOMEFLUX_PREVIOUS_SOURCE;
 if(previous){
  const a=fs.readFileSync(path.join(previous,'settings/index.html'),'utf8'),b=fs.readFileSync(path.join(root,'settings/index.html'),'utf8');
  const form=s=>[...s.matchAll(/<(?:input|select|textarea|option|button)\b[^>]*>/g)].map(x=>x[0]);assert.deepEqual(form(b),form(a),'original form schema changed');
  for(const file of ['lib/ems-engine.js','lib/flexible-loads.js','lib/hvac-permanent.js','lib/hvac-coordination.js','lib/battery-night-planner.js','lib/ev-deadline-planner.js','settings/charge-strategy.js','widgets/ev/public/controller.js'])assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(path.join(previous,file),'utf8'),file+' must be unchanged');
  const original=v=>Array.isArray(v)?v.map(original):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!languages.includes(k)).map(([k,x])=>[k,k==='version'&&x==='1.2.18'?'1.2.17':original(x)])):v;
  for(const folder of ['.homeycompose','drivers','widgets','test/fixtures'])for(const file of files(path.join(root,folder))){const old=path.join(previous,path.relative(root,file));if(fs.existsSync(old))assert.deepEqual(original(JSON.parse(fs.readFileSync(file,'utf8'))),JSON.parse(fs.readFileSync(old,'utf8')),'original metadata/schema changed: '+path.relative(root,file));}
  for(const file of ['README.txt','README.nl.txt','locales/en.json','locales/nl.json','settings/translations/en.json'])assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(path.join(previous,file),'utf8'),file+' must retain original content');
 }
 fs.writeFileSync(path.join(root,'validation/localization-1.2.18.json'),JSON.stringify({version:'1.2.18',languages,translatedStringsChecked:strings,metadataObjectsChecked:metadata,placeholdersPreserved:true,originalFormSchemaPreserved:Boolean(previous),controllerSourcesUnchanged:Boolean(previous)},null,2)+'\n');
 console.log(`Localization 1.2.18: ${strings} strings, ${metadata} metadata objects, Flow errors and unchanged control sources passed.`);
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
