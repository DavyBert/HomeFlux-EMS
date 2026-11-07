'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const css=fs.readFileSync('settings/settings-help.css','utf8'),doc=new JSDOM('<style>'+css+'</style>').window.document,rules=[...doc.styleSheets[0].cssRules];
const light=rules.find(r=>r.selectorText==='.hf-help-toggle,.hf-help-panel'),dark=[...rules.find(r=>r.conditionText==='(prefers-color-scheme:dark)').cssRules][0];assert(light&&dark);
const luminance=color=>color.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const results=[];for(const [name,rule]of [['light',light],['dark',dark]]){const value=key=>rule.style.getPropertyValue('--hf-info-'+key).trim();for(const [a,b,min]of [['fg','bg',4.5],['focus','bg',3],['border','bg',3]]){const ratio=contrast(value(a),value(b));assert(ratio>=min,`${name}: ${a}/${b} = ${ratio}`);results.push({theme:name,pair:a+'/'+b,ratio:Number(ratio.toFixed(2))});}}
assert(css.includes('min-width:44px'));assert(css.includes('min-height:44px'));assert(css.includes(':focus-visible'));assert(css.includes('overflow-wrap:anywhere'));assert(css.includes('.hf-help-panel[hidden]'));assert(css.includes('display:none!important'));assert(!/position\s*:\s*(?:absolute|fixed)|max-height|overflow\s*:\s*hidden/.test(css));
console.log('Settings help styles 1.2.37: '+JSON.stringify(results)+'; 44 px targets, focus, normal flow, wrapping and collapsed-zero-space rules passed.');
