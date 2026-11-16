 'use strict';

// Display-only profiles. A single private Homey setting, excluded from the
// EMS control settings cache (DEFAULTS/getSettings) and all planning paths.
const STORAGE_KEY = '_emsVisualWidgetProfilesV1';
const IDS = Object.freeze(['hero','energyDayPanel','savingsSection','evSection','hvacSection','loadSection','infoExplorer']);
const NAMES = Object.freeze({hero:'EMS-beslissing',energyDayPanel:'Dagoverzicht energie',
  savingsSection:'Savings & voordeel',evSection:'EV-laadbeheer',hvacSection:'HVAC',
  loadSection:'Flexibele sturing',infoExplorer:'Alle EMS-informatie'});
// Every former metric, tariff and charging-plan field remains available inside
// the daily overview, with a separate on/off setting in each display profile.
const DAY_ITEMS = Object.freeze([
  'daySoc','dayTariff','dayWaf','dayChart','dayHouse','dayPv','dayBattery',
  'dayTariffTimeline','dayNextCharge','dayPlanSoc','dayGridPlanned','dayEnergyNeed','dayTargetSoc',
]);
const PROFILES = Object.freeze(['compact','medium','full']);
function theme() { return {background:null,cardBackground:null,backgroundBrightness:null,cardBrightness:null,graphTransparent:false,tariffColors:{cheap:null,normal:null,expensive:null},sections:{}}; }
// null retains the previous HomeFlux palette; 0 is pure black, 100 is white.
function brightness(value){if(value===null||value===undefined||value==='')return null;
  const v=Number(value);return Number.isFinite(v)?Math.round(Math.max(0,Math.min(100,v))):null;}
function baseProfile(name) {
  const hidden = name === 'compact'
    ? ['evSection','hvacSection','loadSection','infoExplorer']
    : name === 'medium' ? ['infoExplorer'] : [];
  const folded = name === 'compact'
    ? ['energyDayPanel','houseSavingsSplit','evSavingsSplit','infoExplorer']
    : name === 'medium'
      ? ['evSection','hvacSection','loadSection','infoExplorer']
      : ['infoExplorer'];
  return { order:[...IDS],hidden,folded,dayHidden:[],dayTimelineFolded:true,dayInfoScale:100,
    themes:{dark:theme(),light:theme()},configured:true };
}
// Visual card dimensions only. Never a setting of the EMS/planner.
function dayScale(value){if(value===null||value===undefined||value==='')return 100;const n=Number(value);return Number.isFinite(n)?Math.round(Math.max(50,Math.min(150,n))/5)*5:100;}
function cleanHex(value){return typeof value==='string'&&/^#[\da-f]{6}$/i.test(value.trim())?value.trim().toUpperCase():null;}
function uniqueIds(input,allowed){return Array.isArray(input)
  ? [...new Set(input.filter(item=>typeof item==='string'&&allowed.includes(item)))]:[];}
function normalizeTheme(input){
  const val=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const sections={};
  for(const id of IDS){ const color=cleanHex(val.sections?.[id]);if(color)sections[id]=color; }
  return {background:cleanHex(val.background),cardBackground:cleanHex(val.cardBackground),
    backgroundBrightness:brightness(val.backgroundBrightness),cardBrightness:brightness(val.cardBrightness),
    graphTransparent:val.graphTransparent===true,
    tariffColors:Object.fromEntries(['cheap','normal','expensive'].map(kind=>[kind,cleanHex(val.tariffColors?.[kind])])),sections};
}
function normalizeProfile(input,name){
  const base=baseProfile(name);
  const val=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const order=uniqueIds(val.order,IDS);
  // One-way migration from pre-consolidation profiles. Legacy panel settings
  // are display preferences, never EMS control configuration.
  const oldHidden=Array.isArray(val.hidden)?val.hidden:[];
  const legacyMap={
    metricsSection:['daySoc','dayTariff','dayWaf'],
    tariffSection:['dayTariffTimeline','dayNextCharge'],
    planStatsSection:['dayPlanSoc','dayGridPlanned','dayEnergyNeed','dayTargetSoc'],
  };
  const migratedDayHidden=oldHidden.flatMap(id=>legacyMap[id]||[]);
  const dayHidden=uniqueIds(Array.isArray(val.dayHidden)?val.dayHidden:migratedDayHidden,DAY_ITEMS);
  const oldFolded=Array.isArray(val.folded)?val.folded:[];
  const dayTimelineFolded=typeof val.dayTimelineFolded==='boolean'
    ?val.dayTimelineFolded:oldFolded.includes('tariffSection')?true:base.dayTimelineFolded;
  return {order:[...order,...IDS.filter(id=>!order.includes(id))],
    hidden:uniqueIds(val.hidden,IDS),
    folded:uniqueIds(val.folded,[...IDS,'houseSavingsSplit','evSavingsSplit']),
    dayHidden,dayTimelineFolded,dayInfoScale:dayScale(val.dayInfoScale),
    themes:{dark:normalizeTheme(val.themes?.dark),light:normalizeTheme(val.themes?.light)},
    configured:true};
}
function defaults(){return Object.fromEntries(PROFILES.map(name=>[name,baseProfile(name)]));}
function read(homey){
  const saved=homey.settings.get(STORAGE_KEY);
  const data=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};
  return Object.fromEntries(PROFILES.map(name=>[name,data[name]?normalizeProfile(data[name],name):baseProfile(name)]));
}
function get(homey,name){
  const id=PROFILES.includes(name)?name:'medium';
  const saved=homey.settings.get(STORAGE_KEY);
  const value=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved[id]:null;
  return {name:id,...(value?normalizeProfile(value,id):baseProfile(id))};
}
function save(homey,name,input){
  if(!PROFILES.includes(name))throw new Error('Onbekend EMS-widgetprofiel');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Ongeldig widgetprofiel');
  // Reject oversized/unknown payloads before touching persistent storage.
  if(JSON.stringify(input).length>12000)throw new Error('Widgetprofiel is te groot');
  const normalized=normalizeProfile(input,name);
  const previous=homey.settings.get(STORAGE_KEY);
  const next=previous&&typeof previous==='object'&&!Array.isArray(previous)?{...previous}:{};
  next[name]=normalized;
  homey.settings.set(STORAGE_KEY,next);
  return {name,...normalized};
}
module.exports={STORAGE_KEY,IDS,NAMES,DAY_ITEMS,PROFILES,defaults,read,get,save,normalizeProfile};
