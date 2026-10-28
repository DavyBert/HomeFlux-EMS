'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const widget = fs.readFileSync(path.join(root, 'widgets/status/public/index.html'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'settings/index.html'), 'utf8');
const cases = [];
function extract(source, name, indent) {
  const marker = indent + 'function ' + name + '(';
  const start = source.indexOf(marker); assert(start >= 0, name);
  const end = source.indexOf('\n' + indent + 'function ', start + marker.length);
  assert(end > start, name + ' next function'); return source.slice(start, end);
}
function widgetContext(source, language) {
  const dictionary = require('../locales/' + language + '.json');
  const context = vm.createContext({ Date, Number, Math, String,
    tr: (homey, key, fallback) => key.split('.').reduce((value, part) => value?.[part], dictionary) || fallback });
  const names = ['reasonText','evReasonForWidget','evPlanningTargetText','evNextDecisionText','evState'];
  if (source.includes('function isEmergencyCharge(')) names.unshift('isEmergencyCharge');
  for (const name of names) vm.runInContext(extract(source, name, '    '), context);
  return context;
}
function settingsContext(language) {
  const host = { innerHTML: '', children: [], appendChild(node) { this.children.push(node); } };
  const context = vm.createContext({ uiLanguage: language, Date, Number, Math, String,
    q: () => host, escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
    document: { createElement: () => ({ innerHTML: '', className: '' }) } });
  for (const name of ['isEmergencyCharge','evEmergencyTargetHint','evEmergencyTargetHintHtml','evEmergencyReason','evModeLabel','renderEvPlanningStatus']) vm.runInContext(extract(settings, name, '  '), context);
  return { context, host };
}
function check(name, run) { run(); cases.push(name); }
const fred = { enabled:true, connected:true, mode:'emergency', source:'emergency', override:{active:true},
  received:{connected:true}, session:{state:'charging',startedAt:1000}, allowed:true, desiredCurrentA:16,
  planningSource:'settings',planningTargetSoc:30,planningTargetTime:'07:00', energyNeedKwh:6.8,
  deadlineAt:Date.UTC(2026,9,28,7), targetReachable:true,
  reason:'Emergency charge · maximaal vermogen',nextOutputReason:'Emergency charge · maximaal vermogen' };
for (const language of ['nl','en']) {
  const c = widgetContext(widget, language);
  check(language + ': Fred emergency card hides fallback target, deadline, kWh and feasibility; short timed hint replaces planning target', () => {
    const target = c.evPlanningTargetText(fred, {}), next = c.evNextDecisionText(fred, {});
    assert.equal(target, '', 'timed hint is separate from persistent target/reasons');
    const hint = require('../locales/' + language + '.json').widget.status.evEmergencyTargetHint;
    assert(hint.includes(language === 'nl' ? 'gegarandeerd laden' : 'guaranteed charging'));
    assert(hint.includes('100%'));
    assert(!target.includes('30%'));assert(!target.includes('07:00'));assert(!next.includes('6.8'));
    assert(!next.includes('28-10'));assert(!next.includes(language === 'nl' ? 'haalbaar' : 'feasible'));
    assert.equal(next, '', 'no duplicate reason or generic active-decision clutter');
    assert.equal(c.evState(fred, {}), language === 'nl' ? 'Emergency charge tot 100%' : 'Emergency charge to 100%');
  });
  check(language + ': real output delay, Peak Guard and tariff blocking stay visible', () => {
    const ev = { ...fred, nextOutputPending:true,nextOutputCurrentA:16,nextOutputAllowed:true,
      nextOutputWaitingForInterval:true,nextOutputRemainingSeconds:45,stopHoldRemainingSeconds:12,
      nextOutputReason:'Peak Guard · begrensd' };
    const next = c.evNextDecisionText(ev, {});assert(next.includes('45'));assert(next.includes('12'));
    assert(next.includes('16 A'));assert(next.includes('Peak Guard'));assert(!next.includes('6.8'));
    assert(c.evState({ ...fred, emergencyTariffBlocked:true }, {}).includes(language==='nl'?'geselecteerd':'selected'));
    assert(c.evState({ ...fred, peakLimited:true }, {}).includes('Peak Guard'));
    assert.equal(c.evState({ ...fred, session:{state:'paused'} }, {}),require('../locales/'+language+'.json').widget.status.evChargingPaused);
  });
  check(language + ': effective Emergency mode hides saved Flow goals without changing their data', () => {
    for(const planningSource of ['flow_soc','flow_energy']){
      const ev={...fred,planningSource,planningTargetSoc:80,planningTargetKwh:20,planningRemainingKwh:12};
      const before=JSON.stringify(ev);assert(!c.evPlanningTargetText(ev,{}).includes('80%'));
      assert(!c.evPlanningTargetText(ev,{}).includes('20 kWh'));assert.equal(JSON.stringify(ev),before);
    }
    assert(!c.isEmergencyCharge({...fred,mode:'smart',source:'pv',configuredMode:'emergency'}));
    assert(c.isEmergencyCharge({...fred,mode:'smart',source:'emergency'}));
  });
  check(language + ': settings EV planning cards suppress irrelevant deadline and feasibility while preserving source split', () => {
    const {context,host}=settingsContext(language);
    context.renderEvPlanningStatus({evs:[{...fred,name:'Fred EV',pvRequestPowerW:2000,gridRequestPowerW:3000}]});
    const html=host.children[0].innerHTML;assert(html.includes('Emergency charge'));
    assert(html.includes('emergency-target-hint'));assert(html.includes('animation-delay:'));assert(html.includes(language==='nl'?'gegarandeerd laden':'guaranteed charging'));assert(!html.includes('X%'));assert(html.includes('2000 W'));assert(html.includes('3000 W'));
    assert(!html.includes('Deadline'));assert(!html.includes('6.8'));assert(!html.includes('07:00'));
  });
  check(language + ': short hint keeps a shared phase across repeated renders and the next 30-second cycle', () => {
    const {context} = settingsContext(language);
    for (const now of [0, 1000, 24999, 25000, 29999, 30000, 55000, 60000]) {
      context.Date = class extends Date { static now() { return now; } };
      const html = context.evEmergencyTargetHintHtml();
      assert(html.includes(`animation-delay:${-((now % 30000) / 1000)}s`));
      assert(html.includes('emergency-target-hint'));
      assert(!html.includes('setTimeout')); assert(!html.includes('setInterval'));
    }
    const reason = context.evEmergencyReason('Emergency charge · maximaal vermogen · Peak Guard');
    assert.equal(reason, (language==='nl'?'Emergency charge tot 100%':'Emergency charge to 100%')+' · Peak Guard');
    assert(c.reasonText('Emergency charge · maximaal vermogen · Peak Guard', {}).includes('100% · Peak Guard'));
  });
  check(language + ': normal Smart/SoC plans retain existing targets, deadline and guarantee presentation', () => {
    let old=null;
    if(process.env.HEMS_EMERGENCY_UI_BASELINE)old=widgetContext(fs.readFileSync(path.join(process.env.HEMS_EMERGENCY_UI_BASELINE,'widgets/status/public/index.html'),'utf8'),language);
    for(const mode of ['smart','soc_target'])for(const planningSource of ['settings','flow_soc','flow_energy']){
      const ev={...fred,mode,source:mode==='smart'?'tariff':'soc_target',planningSource,planningTargetSoc:80,
        planningTargetKwh:20,planningRemainingKwh:12,planningGuarantee:true};
      assert(c.evNextDecisionText(ev,{}).includes('6.8'));
      if(old)for(const name of ['evPlanningTargetText','evNextDecisionText','evState'])assert.equal(c[name](ev,{}),old[name](ev,{}));
      const {context,host}=settingsContext(language);context.renderEvPlanningStatus({evs:[ev]});
      assert(host.children[0].innerHTML.includes('Deadline'));assert(host.children[0].innerHTML.includes('6.8 kWh'));
    }
  });
}
check('both views use a 30-second CSS cycle with five visible seconds; no extra JavaScript timers', () => {
  for(const source of [settings,widget]) {
    const rule = source.match(/@keyframes emergency-target-hint-cycle \{([\s\S]*?)\n\}/)[1];
    const visibleStart = Number(rule.match(/([\d.]+)%, 100%/)[1]);
    assert(Math.abs((100-visibleStart)/100*30-5)<1e-10);
    assert(rule.includes('max-height: 0; visibility: hidden'));
    assert(rule.includes('visibility: visible'));
    assert(source.includes('30s steps(1, end) infinite'));
  }
  assert(widget.includes("contentResizeObserver?.disconnect()"));
  assert(widget.includes("contentResizeObserver?.observe(document.getElementById('widget'))"));
  assert(!extract(settings, 'evEmergencyTargetHintHtml', '  ').includes('setInterval')); 
});
const inline = (settings + widget).match(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g) || [];
for (const block of inline) new vm.Script(block.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,''));
assert(settings.includes('!isEmergencyCharge(ev)&&Number.isFinite(Number(ev.energyNeedKwh))'));
fs.writeFileSync(path.join(root,'validation/ev-emergency-presentation-1.2.4.json'),JSON.stringify({
  passed:cases.length,cases,productionPresentationFunctions:true,simulatedInputs:true,
  originalNonEmergencyPresentationCompared:Boolean(process.env.HEMS_EMERGENCY_UI_BASELINE),nativeHomeyTested:false,browserAnimationTested:false,cssTimingAndRenderPhaseSimulated:true,
},null,2)+'\n');
console.log('Emergency charge presentation:',cases.length,'cases passed');
