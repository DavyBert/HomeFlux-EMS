'use strict';
// Translate listener errors only; control arguments, dispatch and results pass through.
const {normalizeLanguage,translate}=require('./display-language');
function localizeFlowErrors(flow,getLanguage){
 const cards=new Map();
 return new Proxy(flow,{get(target,key){
  if(key!=='getActionCard'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
  return id=>{
   if(cards.has(id))return cards.get(id);
   const raw=target.getActionCard(id);
   const card=new Proxy(raw,{get(object,property){
    if(property==='registerRunListener')return listener=>object.registerRunListener(function(...args){
     const language=normalizeLanguage(getLanguage());
     if(language==='nl'||language==='en')return listener.apply(this,args);
     const fail=error=>{if(error&&typeof error.message==='string')error.message=translate(error.message,language);throw error;};
     try{const result=listener.apply(this,args);return result&&typeof result.then==='function'?result.catch(fail):result;}catch(error){return fail(error);}
    });
    const value=Reflect.get(object,property);return typeof value==='function'?value.bind(object):value;
   }});cards.set(id,card);return card;
  };
 }});
}
module.exports={localizeFlowErrors};
