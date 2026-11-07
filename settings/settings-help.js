/* Presentation-only disclosures. Existing render paths call refresh; no observers,
   timers, requests, settings writes or replacement of form controls. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HomeFluxSettingsHelp=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const documents=new WeakMap();
 const selector='[data-hf-help],.hvac-settings-note,.hvac-limit-example';
 const protectedSelector='[data-hf-help-keep],.hvac-behavior,.hvac-permanent-legend,.warning,.danger-note,.warning-note,[role="alert"],.output-test-card,[id*="Warning"],[id*="warning"]';
 function visibleSource(receipt){
  const source=receipt.node;
  if(!source.textContent.trim())return false;
  for(const n of [source,...receipt.ancestors])if(n.nodeType===1&&(n.classList.contains('hidden')||n.style.display==='none'||n.hidden&&!n.classList.contains('hf-help-panel')))return false;
  return true;
 }
 function anchorFor(source,doc,labels){
  let target=source.dataset.hfHelpFor?doc.getElementById(source.dataset.hfHelpFor):null;
  if(target?.matches('input,select,textarea'))target=target.closest('label')||labels.get(target.id);
  if(target&&!target.closest('.hvac-original-anchors'))return target;
  for(let parent=source.parentElement;parent&&!parent.classList.contains('panel');parent=parent.parentElement){
   if(parent.classList.contains('homey-form-group')){const label=[...parent.children].find(n=>n.tagName==='LABEL')||parent.querySelector(':scope > .hf-help-title-row > label');if(label)return label;}
   const heading=[...parent.children].find(n=>n.matches('h2,h3,h4,legend,summary,.help-item-title,.hvac-settings-heading,.rate-policy-title'))||parent.querySelector(':scope > .cluster-header > h4,:scope > .cluster-header > h3');
   if(heading)return heading;
  }
  return null;
 }
 function nameOf(anchor){return [...anchor.childNodes].filter(n=>!n.classList?.contains('hf-help-toggle')).map(n=>n.textContent).join(' ').replace(/\s+/g,' ').trim();}
 function sync(bundle,state){
  let available=false;for(const source of bundle.sources){const shown=visibleSource(source);source.wrapper.hidden=!shown;available ||= shown;}
  if(bundle.button.hidden===available)bundle.button.hidden=!available;
  if(!available&&bundle.button.getAttribute('aria-expanded')==='true'){bundle.button.setAttribute('aria-expanded','false');bundle.panel.hidden=true;}
  const name=state.translate('Toelichting bij {0}').replace('{0}',nameOf(bundle.anchor)||state.translate('Instellingen'));
  if(bundle.button.getAttribute('aria-label')!==name)bundle.button.setAttribute('aria-label',name);
 }
 function refresh(root){
  if(!root)return;const doc=root.nodeType===9?root:root.ownerDocument,state=documents.get(doc);if(!state)return;
  // Discard receipts for removed/rebuilt sections; the new nodes start closed.
  for(const bundle of state.bundles)if(!bundle.anchor.isConnected||!bundle.button.isConnected||!bundle.panel.isConnected){state.bundles.delete(bundle);for(const source of bundle.sources)state.sources.delete(source.node);}
  const labels=new Map([...doc.querySelectorAll('label[for]')].map(label=>[label.htmlFor,label]));
  const candidates=[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)];
  for(const source of candidates){
   if(state.sources.has(source)||source.closest(protectedSelector)||source.querySelector('input,select,textarea,button,.warning,[role="alert"]')||source.closest('.hvac-original-anchors'))continue;
   const anchor=anchorFor(source,doc,labels);if(!anchor||anchor.closest('label')&&anchor.tagName!=='LABEL')continue;
   const parent=source.parentElement,ancestors=[];for(let p=parent;p;p=p.parentElement)ancestors.push(p);
   let bundle=state.anchors.get(anchor);
   if(!bundle||!bundle.button.isConnected||!bundle.panel.isConnected){
    const panel=doc.createElement('div');panel.className='hf-help-panel';panel.hidden=true;
    do{panel.id='hf-help-'+(++state.sequence);}while(doc.getElementById(panel.id));
    const button=doc.createElement('button');button.type='button';button.className='hf-help-toggle';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',panel.id);
    const glyph=doc.createElement('span');glyph.className='hf-help-glyph';glyph.textContent='ⓘ';glyph.setAttribute('aria-hidden','true');button.appendChild(glyph);
    if(anchor.matches('legend,summary')){anchor.appendChild(button);anchor.after(panel);}
    else{let row=anchor.parentElement;if(!row.classList.contains('hf-help-title-row')){row=doc.createElement('div');row.className='hf-help-title-row';anchor.parentElement.insertBefore(row,anchor);row.appendChild(anchor);}row.appendChild(button);if(anchor.tagName==='LABEL'&&parent===row.parentElement)parent.insertBefore(panel,source);else row.after(panel);}
    bundle={anchor,button,panel,sources:[]};state.anchors.set(anchor,bundle);state.bundles.add(bundle);state.buttons.set(button,bundle);
   }
   const wrapper=doc.createElement('div');wrapper.className='hf-help-source';wrapper.appendChild(source);bundle.panel.appendChild(wrapper);bundle.sources.push({node:source,ancestors,wrapper});state.sources.set(source,bundle);
  }
  for(const bundle of state.bundles)if(root.nodeType===9||root.contains(bundle.anchor)||root.contains(bundle.panel))sync(bundle,state);
 }
 function initialize(doc,translate=value=>value){
  let state=documents.get(doc);if(state){state.translate=translate;refresh(doc);return;}
  state={translate,sequence:0,bundles:new Set(),anchors:new WeakMap(),sources:new WeakMap(),buttons:new WeakMap()};documents.set(doc,state);
  // A native button supplies Enter/Space activation. Capture stops the click
  // before any label, summary, save or module-toggle handler can receive it.
  doc.addEventListener('click',event=>{const button=event.target.closest?.('.hf-help-toggle');const bundle=button&&state.buttons.get(button);if(!bundle)return;event.preventDefault();event.stopImmediatePropagation();const open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));bundle.panel.hidden=!open;},true);
  refresh(doc);
 }
 return {initialize,refresh};
});
