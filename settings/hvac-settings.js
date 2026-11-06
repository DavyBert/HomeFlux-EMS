/* HVAC settings grouping and behavior summary. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HomeFluxHvacSettings=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const summaryFields=new Set(['TariffAutoModeEnabled','Direction','Enabled','AutomaticControlEnabled','PermanentEnabled','TariffEnabled','PvEnabled','UsePvSurplus','PeriodicHeatEnabled','KeepOnEnabled','KeepOnLimitEnabled','KeepOnMarginC','EssentialEnabled','AllowPowerControl','AllowSetpointControl','OutdoorOffEnabled','OutdoorOffAboveEnabled','OutdoorNoIncreaseEnabled']);
 const groups={base:'Activering en basisregeling',goal:'Gedrag bij doeltemperatuur',tariff:'Tariefsturing',pv:'PV-overschot en opvang',comfort:'Comfort en regelrichting',outdoor:'Buitentemperatuur en beveiligingen',advanced:'Aanvullend en geavanceerd'};
 const text={
 selected:'Geselecteerde instellingen; wijzigingen zijn mogelijk nog niet opgeslagen.',
 enable:'Activeren maakt dit kanaal beschikbaar. Toestemming voor HomeFlux-sturing en permanent sturen zijn afzonderlijke keuzes.',
 permanent:'Permanent sturen laat HomeFlux de actieve strategie evalueren; het betekent niet dat het toestel voortdurend ingeschakeld blijft.',
 goal:'Ingeschakeld houden voorkomt stoppen alleen omdat het doel is bereikt. De optionele temperatuurgrens gebruikt het gekozen doel, ook bij tarief- en PV-sturing.',
 exception:'De temperatuurgrens geldt niet tijdens periodiek opwarmen of leermetingen. Andere stop- en veiligheidsvoorwaarden blijven gelden.',
 tariff:'Tariefdoelen en COP-correcties horen bij permanente sturing. Direct schakelen slaat alleen de bestaande prioriteitswachttijd over; budgetten en beveiligingen blijven gelden.',
 pv:'Bij permanente sturing kiest PV een temperatuurdoel. Zonder permanente sturing gebruikt PV-opvang de bestaande overschotregeling en herstelt zij de eerdere regeling na afbouw.',
 comfort:'Standaard permanente comfortsturing gebruikt de ruimte-activatiegrenzen en comfortdoelen. Tarief- en PV-doelen vervangen deze standaard doelregeling.',
 outside:'Geen verhoging begrenst het doel zonder noodzakelijk UIT te sturen. Uitschakelen boven of onder een buitengrens kan wel een UIT-commando geven.',
 budget:'Het gezamenlijke vermogensbudget boven de toestelkeuze geldt voor alle kanalen. De onderlinge startvolgorde staat in het tabblad Prioriteiten.',
 flow:'De Flow-kaart voor permanente sturing schakelt permanent sturen. De ingestelde uitschakelactie en uitgangsrechten bepalen het directe commando; PV-opvang blijft afzonderlijk beschikbaar.'
 };
 function describe(c){
  let regulation,temperature,goal;
  const standard=c.permanent&&!c.tariff&&!c.pv&&!c.periodic;
  if(!c.enabled){regulation='HVAC-kanaal uitgeschakeld.';temperature='Geen nieuwe automatische temperatuursturing.';goal='Bestaande aansturing kan volgens de bestaande afbouwregels worden beëindigd.';}
  else if(!c.automatic){regulation='Automatische HomeFlux-sturing uitgeschakeld.';temperature='Geen nieuwe automatische temperatuursturing.';goal='Bij uitschakelen via Flow gelden de ingestelde uitschakelactie en uitgangsrechten.';}
  else if(!c.permanent){regulation=c.legacyPv?'Niet-permanent: PV-opvang volgens de overschotregeling.':'Niet-permanent: PV-opvang uitgeschakeld.';temperature='PV-opvang gebruikt de bestaande toestelinstelling en comfortgrenzen; permanente tarief- en PV-doelen zijn niet actief.';goal='Bij wegvallend overschot of stopvoorwaarden wordt de eerdere regeling hersteld; UIT hangt af van eigenaarschap en uitgangsrechten.';}
  else{
   regulation=c.tariff&&c.pv?'Permanent: tariefsturing en PV-doelen.':c.tariff?'Permanent: tariefsturing.':c.pv?'Permanent: PV-afhankelijke temperatuurdoelen.':c.periodic?'Permanent: comfortdoelen met periodiek opwarmen.':'Permanent: standaard comfortregeling op ruimtetemperatuur.';
   temperature=c.tariff&&c.pv?'PV-doel bij voldoende overschot en batterij-SoC; anders tariefdoel, eventueel met COP-correctie.':c.tariff?'Doel per tariefperiode; een ingestelde COP-correctie kan gelden.':c.pv?'PV-doel bij voldoende overschot en batterij-SoC; anders de temperatuur na PV-overschot.':'Verwarmen naar het comfortminimum, koelen naar het comfortmaximum; standaard comfort start via de ruimte-activatiegrenzen.';
   goal=c.keep&&c.limit?'De temperatuurgrens gebruikt het gekozen doel plus/min de marge; een UIT-commando vereist aan/uit-toestemming.':c.keep?'Geen UIT uitsluitend omdat het doel is bereikt; andere stopvoorwaarden blijven gelden.':standard?'Na het eerste bereiken van het comfortdoel volgt de bestaande stop- of terugregelactie, voor zover de uitgangen dit toestaan.':'Geen automatisch UIT uitsluitend doordat het doel bereikt is.';
  }
  const limits=['Bestaande veiligheids-, interval- en Flowvoorwaarden blijven gelden.'];
  if(c.enabled&&c.automatic){
   if(c.outdoor)limits.push('Buitentemperatuurvoorwaarden actief.');
   if(c.essential)limits.push('Essentieel: uitgesloten van Peak Guard-afbouw en HVAC-budget; Flow-UIT en andere stopvoorwaarden blijven gelden.');
   else if(c.budget)limits.push('Gezamenlijk HVAC-vermogensbudget actief.');
   if(c.periodic&&c.permanent)limits.push('Periodiek opwarmen kan tijdelijk een eigen doel en herstel gebruiken.');
   if(!c.power)limits.push('Aan/uit-uitgang niet toegestaan.');
   if(!c.setpoint)limits.push('Setpointuitgang niet toegestaan.');
  }
  return {regulation,temperature,goal,limits};
 }
 function config(doc,stem){
  const checked=suffix=>Boolean(doc.getElementById(stem+suffix)?.checked);
  return {enabled:checked('Enabled'),automatic:checked('AutomaticControlEnabled'),permanent:checked('PermanentEnabled'),tariff:checked('TariffEnabled'),pv:checked('PvEnabled'),legacyPv:checked('UsePvSurplus'),periodic:checked('PeriodicHeatEnabled'),keep:checked('KeepOnEnabled'),limit:checked('KeepOnLimitEnabled'),power:checked('AllowPowerControl'),setpoint:checked('AllowSetpointControl'),outdoor:checked('OutdoorOffEnabled')||checked('OutdoorOffAboveEnabled')||checked('OutdoorNoIncreaseEnabled'),essential:checked('EssentialEnabled'),budget:Boolean(doc.getElementById('hvacExtraGridBudgetEnabled')?.checked)};
 }
 function element(doc,tag,cls,label,t){const n=doc.createElement(tag);n.className=cls;if(label)n.textContent=t(label);return n;}
 function initialize(panel,stem,t){
  const doc=panel.ownerDocument,q=id=>doc.getElementById(stem+id),original=[...panel.children];
  const inherited=new Map();
  // Record visibility ancestry before moving any node. The original updater
  // remains authoritative for every source container's hidden class.
  for(const n of panel.querySelectorAll('*')){const ids=[];for(let p=n.parentElement;p&&p!==panel;p=p.parentElement)if(p.id)ids.push(p.id);inherited.set(n,ids);}
  const mounts=[];const layout=element(doc,'div','hvac-settings-layout');
  const sections={};
  for(const [key,label]of Object.entries(groups)){
   const n=element(doc,key==='advanced'?'details':'section','hvac-settings-group');n.dataset.hvacGroup=key;
   n.appendChild(element(doc,key==='advanced'?'summary':'h3','hvac-settings-heading',label,t));sections[key]=n;layout.appendChild(n);
  }
  function sub(key,title){const n=element(doc,'section','hvac-settings-subgroup');n.dataset.hvacSubgroup=key;n.appendChild(element(doc,'h4','hvac-settings-heading',title,t));sections.advanced.appendChild(n);sections[key]=n;}
  sub('periodic','Periodiek opwarmen');sub('power','Vermogen en gedeelde installatie');sub('technical','Regeltechniek');sub('outputs','Uitgangen en Flow-integratie');sub('diagnostics','Diagnostiek');
  function move(node,key){
   if(!node)return;
   const wrapper=element(doc,'div','hvac-setting-mount');wrapper.dataset.visibilitySources=(inherited.get(node)||[]).join(',');wrapper.appendChild(node);sections[key].appendChild(wrapper);mounts.push(wrapper);
  }
  const atom=suffix=>{const n=q(suffix),group=q(suffix+'Group');return group?.contains(n)?group:n?.closest('label.homey-form-checkbox')||n?.closest('.homey-form-group')||n;};
  function fields(key,names){for(const name of names)move(atom(name),key);}
  fields('base',['Name','Enabled','AutomaticControlEnabled','PermanentEnabled','Direction','EssentialEnabled']);
  fields('goal',['KeepOnEnabled']);move(q('KeepOnLimitOptions'),'goal');
  fields('tariff',['TariffEnabled','DirectTariffEnabled']);move(q('TariffAutoModeGroup'),'tariff');
  for(const rate of ['Cheap','Normal','Expensive']){fields('tariff',[rate+'TargetC',rate+'CopOutsideBelowC',rate+'CopTargetC']);move(q(rate+'CopHelp'),'tariff');}
  const pvPermanent=element(doc,'section','hvac-pv-section hvac-permanent-block');pvPermanent.dataset.hvacSubgroup='pvPermanent';pvPermanent.appendChild(element(doc,'h4','hvac-settings-heading','PV-doelen tijdens permanent sturen',t));sections.pv.appendChild(pvPermanent);sections.pvPermanent=pvPermanent;
  const pvCapture=element(doc,'section','hvac-pv-section');pvCapture.dataset.hvacSubgroup='pvCapture';pvCapture.appendChild(element(doc,'h4','hvac-settings-heading','PV-opvang buiten permanent sturen',t));sections.pv.appendChild(pvCapture);sections.pvCapture=pvCapture;
  fields('pvPermanent',['PvEnabled','PvTargetC','AfterPvTargetC']);
  fields('pvCapture',['UsePvSurplus','AllowOnBattery','StopBatterySoc','FastResetImportW']);
  fields('pv',['DirectPvEnabled','MinBatterySoc','SurplusStartW','SurplusStopW']);
  sections.pvCapture.appendChild(element(doc,'p','muted hvac-settings-note','Deze PV-opvang geldt uitsluitend wanneer permanent sturen uit staat, ook na uitschakelen via Flow. Beide PV-opties kunnen tegelijk ingesteld blijven.',t));
  move(q('ComfortActivationGroup'),'comfort');move(q('DirectionTemperatureSourceGroup'),'comfort');move(q('OutdoorDirectionOptions'),'comfort');
  fields('outdoor',['OutdoorOffAboveEnabled','OutdoorOffAboveC','OutdoorOffAboveHysteresisC','OutdoorNoIncreaseEnabled','OutdoorNoIncreaseAboveC','OutdoorOffEnabled','OutdoorOffBelowC','OutdoorOffBelowHysteresisC']);
  fields('periodic',['PeriodicHeatEnabled']);move(q('PeriodicHeatOptions'),'periodic');
  fields('power',['SharedPowerEnabled','SharedPowerWith','PhysicalGroup','Priority']);
  fields('technical',['EnergyDeviationC','ControlIntervalMinutes','CoolingFanProfile','HeatingFanProfile']);
  move(q('FanMinValue')?.closest('.setting-cluster'),'technical');
  for(const key of ['goal','tariff','outdoor','periodic'])sections[key].classList.add('hvac-permanent-block');
  sections.base.appendChild(element(doc,'p','hvac-permanent-legend','Alle blokken met een groene achtergrond gelden uitsluitend tijdens permanent sturen.',t));
  const permission=q('AllowPowerControl')?.closest('fieldset');move(permission,'outputs');fields('outputs',['AutomaticOffAction','StandbyTemperatureC']);move(q('FlowReference'),'outputs');
  move(q('LearnheatGroup'),'diagnostics');move(q('LearncoolGroup'),'diagnostics');move(q('LearnNow'),'diagnostics');move(q('LearnStatus'),'diagnostics');move(q('InputStatusCard'),'diagnostics');move(panel.querySelector('.output-test-card'),'diagnostics');
  for(const [key,note]of [['base',text.enable],['base',text.permanent],['base','Een essentieel toestel telt als vast huisverbruik: Peak Guard en het HVAC-budget bouwen het niet af. Flow-UIT en andere stopvoorwaarden blijven gelden.'],['goal',text.goal],['goal',text.exception],['tariff',text.tariff],['tariff','Automatisch leren is uit bij directe sturing.'],['pv',text.pv],['comfort',text.comfort],['outdoor',text.outside],['power',text.budget],['power','Deelt de warmtebron met een andere HVAC. Geen aparte vermogensmeting.'],['outputs',text.flow]])sections[key].appendChild(element(doc,'p','muted hvac-settings-note',note,t));
  const summary=element(doc,'section','hvac-behavior');summary.appendChild(element(doc,'h4','hvac-settings-heading','Ingesteld regelgedrag',t));summary.appendChild(element(doc,'p','muted hvac-settings-note',text.selected,t));
  for(const [key,label]of [['regulation','Regeling'],['temperature','Temperatuur'],['goal','Bij doeltemperatuur'],['limits','Beperkingen']]){
   const row=element(doc,'div','hvac-behavior-row');row.appendChild(element(doc,'strong','',label,t));const value=element(doc,'span','');value.dataset.hvacBehavior=key;row.appendChild(value);summary.appendChild(row);
  }
  sections.base.appendChild(summary);const example=element(doc,'p','muted hvac-limit-example');sections.goal.appendChild(example);
  const anchors=element(doc,'div','hvac-original-anchors');anchors.setAttribute('aria-hidden','true');for(const n of original)if(n.parentElement===panel)anchors.appendChild(n);
  panel.appendChild(layout);panel.appendChild(anchors);
  // Only hidden serialization fields may remain in the original skeleton.
  // They keep their IDs and are still read by the original load/save code.
  panel._hvacPresentation={mounts,summary,example,translate:t};
  const changed=event=>{const id=event.target.id||'';if(id.startsWith(stem)&&summaryFields.has(id.slice(stem.length)))render(panel,stem);};
  panel.addEventListener('input',changed);panel.addEventListener('change',changed);
 }
 function render(panel,stem){
  const {mounts,summary,example,translate:t}=panel._hvacPresentation,doc=panel.ownerDocument;
  const q=suffix=>doc.getElementById(stem+suffix);
  for(const m of mounts){const hidden=m.dataset.visibilitySources.split(',').filter(Boolean).some(id=>doc.getElementById(id)?.classList.contains('hidden'));if(m.classList.contains('hidden')!==hidden)m.classList.toggle('hidden',hidden);}
  // Hide empty headings too; control visibility still comes exclusively from
  // the original updater and the recorded ancestor containers.
  for(const group of panel.querySelectorAll('[data-hvac-group]:not([data-hvac-group="base"]):not([data-hvac-group="advanced"]),[data-hvac-subgroup]')){
   const visible=[...group.querySelectorAll('.hvac-setting-mount')].some(node=>node.classList.contains('hvac-setting-mount')&&!node.classList.contains('hidden')&&!node.firstElementChild?.classList.contains('hidden'));
   if(group.classList.contains('hidden')===visible)group.classList.toggle('hidden',!visible);
  }
  const c=config(doc,stem),description=describe(c);
  for(const [key,value]of Object.entries(description)){
   const next=Array.isArray(value)?value.map(t).join(' '):t(value),node=summary.querySelector(`[data-hvac-behavior="${key}"]`);if(node.textContent!==next)node.textContent=next;
  }
  let next='';
  if(c.permanent&&c.keep&&c.limit){
   const raw=q('KeepOnMarginC')?.value,margin=Number(raw);
   if(raw!==''&&Number.isFinite(margin)&&margin>=0&&margin<=10){
    const template='Voorbeeld bij doel {0} °C en marge {1} °C: verwarmen uit vanaf {2} °C, weer aan vanaf {3} °C; koelen uit vanaf {3} °C, weer aan vanaf {2} °C.';
    const format=v=>Number(v).toLocaleString(doc.documentElement.lang||'en',{maximumFractionDigits:2});
    const values=[23,margin,23+margin,23-margin].map(format);next=t(template).replace(/\{([0-3])\}/g,(_,i)=>values[i]);
    if(margin===0)next+=' '+t('Bij 0 °C vallen de grenzen samen: op de grens blijft UIT leidend; herstart gebeurt pas aan de vraagzijde.');
   }else next=t('Vul een geldige temperatuurmarge in om het voorbeeld te tonen.');
  }
  if(example.textContent!==next)example.textContent=next;
 }
 function update(instance,t=value=>value,doc=typeof document!=='undefined'?document:null){
  if(!doc)return;const stem='hvac'+(instance===1?'':instance),panel=doc.getElementById('hvacInstancePanel'+instance);if(!panel)return;
  if(!panel._hvacPresentation)initialize(panel,stem,t);else panel._hvacPresentation.translate=t;
  render(panel,stem);
 }
 function reveal(field){
  if(!field)return;const doc=field.ownerDocument,panel=field.closest('[data-hvac-instance]');
  if(panel){doc.querySelector('[data-tab="hvac"]')?.click();doc.getElementById('hvacInstanceTab'+panel.dataset.hvacInstance)?.click();}
  for(let p=field.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
 }
 return {update,describe,config,reveal};
});
