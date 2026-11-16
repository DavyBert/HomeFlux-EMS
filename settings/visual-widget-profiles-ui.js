'use strict';

// The widget editor is deliberately outside the EMS settings snapshot.
// Loading and saving profiles performs API calls only on user interaction.
window.HomeFluxVisualWidgetProfiles = (() => {
  const IDS = ['hero','energyDayPanel','savingsSection','evSection','hvacSection','loadSection','infoExplorer'];
  const TITLES = ['EMS-beslissing','Dagoverzicht energie','Savings & voordeel','EV-laadbeheer',
    'HVAC','Flexibele sturing','Alle EMS-informatie'];
  const DAY_ITEM_GROUPS = [
    ['Direct inzicht',[
      ['daySoc','Batterij-SoC'],['dayTariff','Huidig tarief en prijs'],['dayWaf','WAF-reserve'],
    ]],
    ['Grafiek en prognose',[
      ['dayChart','Energiegrafiek'],['dayHouse','Gemeten huisverbruik'],
      ['dayPv','PV-verwachting'],['dayBattery','Batterij-SoC-prognose'],
    ]],
    ['Tarief en laadplanning',[
      ['dayTariffTimeline','Tariefverloop'],['dayNextCharge','Volgend laadvenster'],
      ['dayGridPlanned','Gepland netladen'],['dayEnergyNeed','Nog nodig tot doel'],
      ['dayPlanSoc','SOC nu (laadplan)'],['dayTargetSoc','Doel-SOC'],
    ]],
  ];
  const NAMES = {compact:'Compact',medium:'Medium',full:'Full'};
  const TARIFF_DEFAULT_COLORS = {cheap:'#5AD2A7',normal:'#6FB5E4',expensive:'#E5A07C'};
  const PALETTE = {
    black:['Zwart','#161A24'],charcoal:['Antraciet','#252C34'],graphite:['Grafiet','#242B38'],
    navy:['Marineblauw','#142E50'],blue:['Kobaltblauw','#244E88'],sky:['Hemelsblauw','#246E9E'],
    petrol:['Petrolblauw','#12556C'],teal:['Turkoois','#1A6669'],forest:['Donkergroen','#103D34'],
    green:['Smaragdgroen','#276A46'],olive:['Olijfgroen','#58613A'],sand:['Zand','#806345'],
    terracotta:['Terracotta','#8B4C42'],burgundy:['Bordeaux','#653147'],purple:['Nachtpaars','#35224D'],
    slate:['Leiblauw','#293F58'],
  };
  const $ = id => document.getElementById(id);
  const cleanHex = v => /^#[0-9A-Fa-f]{6}$/.test(String(v||'')) ? String(v).toUpperCase() : null;
  const clone = v => JSON.parse(JSON.stringify(v));
  const create = (tag,cls,text) => {
    const el=document.createElement(tag);
    if(cls) el.className=cls;
    if(text!==undefined)el.textContent=text;
    return el;
  };
  const field = (type,attrs) => {
    const input=document.createElement('input');input.type=type;
    for(const [k,v] of Object.entries(attrs||{})){
      if(k==='checked')input.checked=Boolean(v);
      else if(k==='value')input.value=v;
      else input.setAttribute(k,String(v));
    }
    return input;
  };
  const colorPicker = (title,color,scope,themeName,defaultColor='#1B4867') => {
    const wrap=create('div','vw-color-field');
    wrap.dataset.vwColorScope=scope;
    wrap.dataset.vwTheme=themeName;
    const titleEl=create('label','',title),controls=create('div','vw-color-inputs');
    const select=create('select','homey-form-input');
    select.setAttribute('aria-label',title+' · standaardkleur');
    const options=[['default','Standaard'],...Object.entries(PALETTE).map(([id,row])=>[id,row[0]]),['custom','Eigen kleur']];
    for(const [id,name] of options){const o=create('option','',name);o.value=id;select.append(o)}
    const picker=field('color',{'aria-label':title+' · kleurkiezer',value:defaultColor});
    const hex=field('text',{'aria-label':title+' · HEX',placeholder:'#RRGGBB',maxlength:'7',value:''});
    hex.className='homey-form-input';hex.spellcheck=false;
    if(color){
      const value=cleanHex(color);
      const preset=Object.entries(PALETTE).find(([,row])=>row[1].toUpperCase()===value);
      select.value=preset?.[0]||'custom';
      picker.value=value||'#1B4867';hex.value=value||'';
    }else{select.value='default';picker.value=defaultColor;}
    select.dataset.vwControl='preset';
    picker.dataset.vwControl='picker';
    hex.dataset.vwControl='hex';
    controls.append(select,picker,hex);wrap.append(titleEl,controls);
    return wrap;
  };
  const brightnessPicker=(title,value,scope,themeName)=>{
    const wrap=create('div','vw-brightness-field');wrap.dataset.vwBrightnessScope=scope;wrap.dataset.vwTheme=themeName;
    const heading=create('label','vw-brightness-title',title);
    const choice=create('label','vw-check vw-brightness-enable');
    const checked=value!==null&&value!==undefined&&Number.isFinite(Number(value));
    const enable=field('checkbox',{'data-vw-brightness-enable':'',checked});
    // Homey mobile webviews can hide native checkbox glyphs: render an explicit
    // indicator while keeping the accessible input/label and existing save logic.
    choice.append(enable,create('span','vw-native-check-indicator'));
    choice.append(document.createTextNode('Helderheid toepassen (gekozen kleurtint behouden)'));
    const controls=create('div','vw-brightness-controls');
    const amount=field('range',{min:'0',max:'100',step:'1',value:checked?String(value):String(themeName==='light'?90:12),'data-vw-brightness-range':''});
    amount.disabled=!checked;amount.setAttribute('aria-label',title+' van zwart tot wit');
    const output=create('output','vw-brightness-value',(checked?value:(themeName==='light'?90:12))+'%');
    controls.append(amount,output);wrap.append(heading,choice,controls);
    return wrap;
  };
  const graphTransparencySwitch=(themeName,enabled)=>{
    const title=themeName==='light'?'Lichte modus':'Donkere modus';
    const wrap=create('div','vw-brightness-field');
    const heading=create('label','vw-brightness-title',title+' · Grafiek');
    const choice=create('label','vw-check vw-graph-transparency');
    const input=field('checkbox',{'data-vw-graph-transparent':themeName,checked:enabled===true});
    choice.append(input,create('span','vw-native-check-indicator'));
    choice.append(document.createTextNode('Transparante grafiekachtergrond'));
    wrap.append(heading,choice);
    return wrap;
  };
  function init({api}){
    let profiles=null,defaults=null,active='medium',loadPending=null,busy=false;
    const setState=text=>{const x=$('vwProfileState');if(x)x.textContent=text};
    const list=()=>Array.from($('vwSectionList')?.querySelectorAll(':scope > .vw-profile-row')||[]);
    const getColor = root => {
      const preset=root.querySelector('[data-vw-control="preset"]');
      const hex=root.querySelector('[data-vw-control="hex"]');
      if(preset?.value==='default')return null;
      const value=cleanHex(hex?.value?.trim());
      if(!value)throw new Error('Ongeldige HEX-kleur: '+(hex?.value||''));
      return value;
    };
    const readForm = () => {
      const data=profiles[active];
      data.order=list().map(row=>row.dataset.vwId);
      data.hidden=list().filter(row=>!row.querySelector('[data-vw-show]').checked).map(row=>row.dataset.vwId);
      data.folded=[...list().filter(row=>row.querySelector('[data-vw-fold]').checked).map(row=>row.dataset.vwId),
        ...data.folded.filter(id=>['houseSavingsSplit','evSavingsSplit'].includes(id))];
      data.dayHidden=Array.from(document.querySelectorAll('#vwDayItems [data-vw-day-item]'))
        .filter(item=>!item.checked).map(item=>item.dataset.vwDayItem);
      data.wafValueFirst=Boolean($('vwWafValueFirst')?.checked);
      data.chartDisplayVersion=1;
      data.chartHourFormat=$('vwChartHourFormat')?.value==='12h'?'12h':'24h';
      data.dayChartFullWidth=Boolean($('vwDayChartFullWidth')?.checked);
      data.dayTimelineFolded=Boolean($('vwDayTimelineFolded')?.checked);
      data.dayInfoScale=Number($('vwDayInfoScale')?.value)||100;
      data.themes={dark:{background:null,cardBackground:null,backgroundBrightness:null,cardBrightness:null,graphTransparent:false,tariffColors:{cheap:null,normal:null,expensive:null},sections:{}},
        light:{background:null,cardBackground:null,backgroundBrightness:null,cardBrightness:null,graphTransparent:false,tariffColors:{cheap:null,normal:null,expensive:null},sections:{}}};
      for(const root of document.querySelectorAll('#vwBrightnessControls [data-vw-brightness-scope]')){
        const theme=root.dataset.vwTheme,scope=root.dataset.vwBrightnessScope;
        if(!['light','dark'].includes(theme)||!['background','cardBackground'].includes(scope))continue;
        const enable=root.querySelector('[data-vw-brightness-enable]');
        const range=root.querySelector('[data-vw-brightness-range]');
        data.themes[theme][scope==='background'?'backgroundBrightness':'cardBrightness']=
          enable?.checked?Number(range.value):null;
      }
      for(const input of document.querySelectorAll('#vwBrightnessControls [data-vw-graph-transparent]')){
        const theme=input.dataset.vwGraphTransparent;
        if(['light','dark'].includes(theme))data.themes[theme].graphTransparent=input.checked;
      }
      for(const root of document.querySelectorAll('#panel-ems-widget [data-vw-color-scope]')){
        const theme=root.dataset.vwTheme,scope=root.dataset.vwColorScope;
        if(!['dark','light'].includes(theme))continue;
        const color=getColor(root);
        if(scope==='background')data.themes[theme].background=color;
        else if(scope==='cardBackground')data.themes[theme].cardBackground=color;
        else if(scope.startsWith('tariff:')){
          const kind=scope.slice(7);
          if(['cheap','normal','expensive'].includes(kind))data.themes[theme].tariffColors[kind]=color;
        }
        else if(scope.startsWith('section:')&&color)data.themes[theme].sections[scope.slice(8)]=color;
      }
      return data;
    };
    const updateNumbers=()=>list().forEach((row,index)=>{
      row.querySelector('.vw-row-number').textContent=String(index+1);
      row.querySelector('[data-vw-up]').disabled=index===0;
      row.querySelector('[data-vw-down]').disabled=index===IDS.length-1;
    });
    const buildSectionRow=(id,profile) => {
      const row=create('div','vw-profile-row');row.dataset.vwId=id;
      const bar=create('div','vw-profile-row-line');
      const number=create('span','vw-row-number');
      const title=create('span','vw-row-title',TITLES[IDS.indexOf(id)]);
      const moves=create('div','vw-row-moves');
      const up=create('button','','↑'),down=create('button','','↓');
      up.type='button';down.type='button';up.dataset.vwUp='';down.dataset.vwDown='';
      up.setAttribute('aria-label',title.textContent+' omhoog');down.setAttribute('aria-label',title.textContent+' omlaag');
      moves.append(up,down);
      const show=create('label','vw-check');
      const showCheck=field('checkbox',{'data-vw-show':'',checked:!profile.hidden.includes(id)});
      show.append(showCheck,document.createTextNode('Tonen'));
      const fold=create('label','vw-check');
      const foldCheck=field('checkbox',{'data-vw-fold':'',checked:profile.folded.includes(id)});
      fold.append(foldCheck,document.createTextNode('Inklappen'));
      bar.append(number,title,moves,show,fold);
      const details=create('details','vw-section-colors');
      const summary=create('summary','','Kleur per onderdeel (optioneel)');
      const grid=create('div','vw-section-color-grid');
      for(const theme of ['light','dark'])grid.append(colorPicker(
        (theme==='light'?'Licht':'Donker')+' · '+title.textContent,
        profile.themes[theme]?.sections?.[id],`section:${id}`,theme));
      details.append(summary,grid);
      row.append(bar,details);
      return row;
    };
    function render(){
      if(!profiles||!defaults)return;
      const profile=profiles[active];
      $('vwEditorContents').hidden=false;
      $('vwEditorLoading').hidden=true;
      $('vwProfileName').textContent=NAMES[active];
      $('vwProfileTabs').querySelectorAll('[data-vw-profile]').forEach(b=>{
        b.classList.toggle('active',b.dataset.vwProfile===active);
        b.setAttribute('aria-pressed',String(b.dataset.vwProfile===active));
      });
      const rows=$('vwSectionList');rows.replaceChildren();
      for(const id of profile.order)rows.append(buildSectionRow(id,profile));
      updateNumbers();
      const day=$('vwDayItems');day.replaceChildren();
      for(const [groupName,items] of DAY_ITEM_GROUPS){
        const group=create('fieldset','vw-day-group');
        group.append(create('legend','',groupName));
        const checks=create('div','vw-day-checks');
        for(const [id,title] of items){
          const label=create('label','vw-check');
          const input=field('checkbox',{'data-vw-day-item':id,checked:!profile.dayHidden?.includes(id)});
          label.append(input,document.createTextNode(title));checks.append(label);
        }
        group.append(checks);day.append(group);
      }
      $('vwWafValueFirst').checked=profile.wafValueFirst!==false;
      $('vwDayChartFullWidth').checked=profile.dayChartFullWidth!==false;
      $('vwChartHourFormat').value=profile.chartHourFormat==='12h'?'12h':'24h';
      $('vwDayTimelineFolded').checked=profile.dayTimelineFolded!==false;
      $('vwDayInfoScale').value=String(profile.dayInfoScale??100);
      $('vwDayScaleValue').textContent=$('vwDayInfoScale').value+'%';
      const sliders=$('vwBrightnessControls');sliders.replaceChildren();
      for(const theme of ['light','dark']){
        const word=theme==='light'?'Lichte modus':'Donkere modus';
        sliders.append(brightnessPicker(word+' · Widgetachtergrond',profile.themes[theme]?.backgroundBrightness,'background',theme));
        sliders.append(brightnessPicker(word+' · Kaartachtergrond',profile.themes[theme]?.cardBrightness,'cardBackground',theme));
        sliders.append(graphTransparencySwitch(theme,profile.themes[theme]?.graphTransparent));
      }
      const tariffs=$('vwTariffColors');tariffs.replaceChildren();
      for(const theme of ['light','dark']){
        const group=create('fieldset','vw-day-group vw-tariff-palette');
        group.append(create('legend','',theme==='light'?'Lichte modus':'Donkere modus'));
        for(const [kind,label] of [['cheap','Goedkoop / Superdal'],['normal','Normaal / Dal'],['expensive','Duur / Piek']])
          group.append(colorPicker(label,profile.themes[theme]?.tariffColors?.[kind],
            'tariff:'+kind,theme,TARIFF_DEFAULT_COLORS[kind]));
        tariffs.append(group);
      }
      const root=$('vwGlobalColors');root.replaceChildren();
      for(const theme of ['light','dark']){
        const word=theme==='light'?'Licht':'Donker';
        root.append(colorPicker(word+' · Achtergrond',profile.themes[theme]?.background,'background',theme));
        root.append(colorPicker(word+' · Kaarten',profile.themes[theme]?.cardBackground,'cardBackground',theme));
      }
      setState('Profiel geladen · wijzigingen worden pas bij Opslaan bewaard');
    }
    async function load(){
      if(profiles)return;
      if(loadPending)return loadPending;
      loadPending=(async()=>{
        try{
          const result=await api('GET','/visual-widget-profiles');
          if(!result?.profiles||!result?.defaults)throw new Error('Ongeldig antwoord van de profiel-API');
          profiles=clone(result.profiles);defaults=clone(result.defaults);
          render();
        }catch(err){
          $('vwEditorLoading').textContent='Kon de EMS-widgetprofielen niet ophalen: '+String(err.message||err);
          throw err;
        }
      })().finally(()=>{loadPending=null});
      return loadPending;
    }
    $('vwProfileTabs').addEventListener('click',event=>{
      const btn=event.target.closest('[data-vw-profile]');
      if(!btn||!profiles||busy)return;
      if(btn.dataset.vwProfile===active)return;
      try{readForm()}catch(e){setState(e.message);return;}
      active=btn.dataset.vwProfile;render();
    });
    $('vwSectionList').addEventListener('click',event=>{
      const b=event.target.closest('[data-vw-up],[data-vw-down]');
      if(!b)return;
      const row=b.closest('.vw-profile-row'),rows=$('vwSectionList');
      if(!row||!rows)return;
      if(b.hasAttribute('data-vw-up')&&row.previousElementSibling)rows.insertBefore(row,row.previousElementSibling);
      else if(b.hasAttribute('data-vw-down')&&row.nextElementSibling)rows.insertBefore(row.nextElementSibling,row);
      updateNumbers();setState('Volgorde aangepast · nog niet opgeslagen');
    });
    $('vwBrightnessControls').addEventListener('change',event=>{
      if(event.target.matches('[data-vw-graph-transparent]')){
        setState('Transparantie grafiek aangepast · nog niet opgeslagen');return;
      }
      const block=event.target.closest('[data-vw-brightness-scope]');if(!block)return;
      const active=block.querySelector('[data-vw-brightness-enable]');
      const amount=block.querySelector('[data-vw-brightness-range]');
      amount.disabled=!active.checked;
      setState('Achtergrond aangepast · nog niet opgeslagen');
    });
    $('vwBrightnessControls').addEventListener('input',event=>{
      const block=event.target.closest('[data-vw-brightness-scope]');if(!block)return;
      const amount=block.querySelector('[data-vw-brightness-range]');
      block.querySelector('.vw-brightness-value').textContent=amount.value+'%';
      setState('Achtergrond aangepast · nog niet opgeslagen');
    });
    $('panel-ems-widget').addEventListener('change',event=>{
      const root=event.target.closest('[data-vw-color-scope]');
      if(!root){ if(event.target.matches('[data-vw-show],[data-vw-fold],[data-vw-day-item],#vwDayTimelineFolded,#vwDayChartFullWidth,#vwWafValueFirst,#vwChartHourFormat'))setState('Weergave aangepast · nog niet opgeslagen'); return; }
      const preset=root.querySelector('[data-vw-control="preset"]');
      const hex=root.querySelector('[data-vw-control="hex"]');
      const picker=root.querySelector('[data-vw-control="picker"]');
      if(event.target===preset){
        const selected=PALETTE[preset.value];
        if(selected){hex.value=selected[1];picker.value=selected[1];}
        if(preset.value==='default')hex.value='';
      } else if(event.target===picker){hex.value=picker.value.toUpperCase();preset.value='custom';}
      else if(event.target===hex){
        const color=cleanHex(hex.value.trim());
        if(color){picker.value=color;preset.value='custom';}
        else if(!hex.value.trim())preset.value='default';
      }
      hex.classList.toggle('invalid',Boolean(hex.value.trim())&&!cleanHex(hex.value.trim()));
      setState('Kleur aangepast · nog niet opgeslagen');
    });
    $('panel-ems-widget').addEventListener('input',event=>{
      if(event.target.id==='vwDayInfoScale'){
        $('vwDayScaleValue').textContent=event.target.value+'%';
        setState('Schaling aangepast · nog niet opgeslagen');
        return;
      }
      if(!event.target.matches('[data-vw-control="hex"]'))return;
      const color=cleanHex(event.target.value.trim());
      event.target.classList.toggle('invalid',Boolean(event.target.value.trim())&&!color);
      if(color){
        const root=event.target.closest('[data-vw-color-scope]');
        root.querySelector('[data-vw-control="picker"]').value=color;
        root.querySelector('[data-vw-control="preset"]').value='custom';
      }
    });
    $('vwSaveProfile').addEventListener('click',async()=>{
      if(!profiles||busy)return;
      let snapshot;
      try{snapshot=clone(readForm())}catch(e){setState(e.message);return;}
      busy=true;$('vwSaveProfile').disabled=true;setState('Opslaan…');
      try{
        const stored=await api('PUT','/visual-widget-profiles',{name:active,profile:snapshot});
        if(!stored?.order)throw new Error('Opslaan niet bevestigd');
        profiles[active]=clone(stored);
        setState(NAMES[active]+' opgeslagen · vernieuwingsverzoek naar de widget verstuurd');
      }catch(err){setState('Opslaan mislukt: '+String(err.message||err));}
      finally{busy=false;$('vwSaveProfile').disabled=false;}
    });
    $('vwResetProfile').addEventListener('click',()=>{
      if(!profiles||busy)return;
      profiles[active]=clone(defaults[active]);render();
      setState('Standaard hersteld in editor · klik Opslaan om te bewaren');
    });
    return {load};
  }
  return {init};
})();
