'use strict';
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..');
async function page(language='nl',options={}){
 const html=fs.readFileSync(path.join(root,'settings/index.html'),'utf8'),dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/settings/index.html'}),w=dom.window;
 const {DEFAULTS}=require('../../lib/ems-engine');const snapshot=structuredClone({...DEFAULTS,batteryCount:8,hvacCount:10,evCount:4,boilerCount:1,...options.snapshot});
 const writes=[],requests=[],alerts=[],errors=[];let ready;
 const done=new Promise(resolve=>ready=resolve);
 w.fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,'settings',String(url)),'utf8'))});
 w.setInterval=()=>0;w.clearInterval=()=>{};
 w.console={...console,error:(...args)=>errors.push(args.map(String).join(' ')),warn:()=>{}};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const script of [...w.document.querySelectorAll('script[src]')]){const name=script.getAttribute('src');if(name.startsWith('/'))continue;w.eval(fs.readFileSync(path.join(root,'settings',name),'utf8'));}
 w.eval([...w.document.querySelectorAll('script:not([src])')].map(s=>s.textContent).join('\n'));
 const Homey={on:()=>{},__:key=>key==='settings.language'?language:key,ready:()=>ready(),alert:text=>alerts.push(text),confirm:(text,style,cb)=>{if(typeof style==='function')style(true);else cb?.(true);},get:(key,cb)=>cb(null,snapshot[key]),set:(key,value,cb)=>{snapshot[key]=structuredClone(value);writes.push({key,value:structuredClone(value)});cb(null);},api:(method,url,body,cb)=>{if(typeof body==='function'){cb=body;body={};}requests.push({method,url,body});if(url==='/settings-snapshot')cb(null,structuredClone(snapshot));else if(url==='/status')cb(null,null);else if(url==='/auto-tune')cb(null,options.autoTune||{});else cb(null,{});}};
 await w.onHomeyReady(Homey);await done;await Promise.resolve();
 if(alerts.length)throw Error('Settings startup alert: '+alerts.join('; '));
 return {dom,w,doc:w.document,snapshot,writes,requests,alerts,errors,close:()=>w.close()};
}
module.exports={page};
