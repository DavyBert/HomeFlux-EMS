'use strict';

// Settings editor only: no timers, API calls or control calculations.
window.HomeFluxChargeStrategy = (() => {
  let root;
  const profiles = ['year', 'summer', 'winter'];
  function mount(element) {
    root = element;
    const label = (text, input) => {
      const el = document.createElement('label'); el.className = 'homey-form-checkbox';
      el.append(input, document.createTextNode(' ' + text)); return el;
    };
    const radio = (name, value, text, checked) => {
      const el = document.createElement('input'); el.type = 'radio'; el.name = name; el.value = value; el.checked = checked;
      return label(text, el);
    };
    const selector = document.createElement('div'); selector.className = 'setting-cluster';
    const seasonTitle=document.createElement('h4');seasonTitle.id='strategy-season-title';seasonTitle.textContent='Seizoensindeling';selector.appendChild(seasonTitle);
    selector.append(radio('chargeStrategySeason', 'year', 'Dezelfde laadstrategie het hele jaar door', true),
      radio('chargeStrategySeason', 'seasonal', 'Afzonderlijke laadstrategie voor zomer- en wintermaanden', false));
    root.append(selector);
    const months = document.createElement('p'); months.className = 'muted';months.dataset.hfHelp='';months.dataset.hfHelpFor=seasonTitle.id; months.dataset.strategyMonths = '';
    months.textContent = 'Winter gebruikt de geselecteerde maanden bij het seizoensminimum-SoC in EMS; de overige maanden zijn zomer. Deze indeling blijft gelden als het minimum-SoC uit staat.';
    const link = document.createElement('button'); link.type = 'button'; link.className = 'homey-button-secondary';
    link.textContent = 'Bestaande maandselectie openen'; link.dataset.strategyMonths = '';
    link.addEventListener('click', () => {
      document.querySelector('.tab[data-tab="ems"]').click();
      document.getElementById('peakReserveMonth1').closest('[data-setting-id]').scrollIntoView({ block: 'center' });
    });
    root.append(months, link);
    for (const profile of profiles) {
      const group = document.createElement('div'); group.dataset.strategyProfile = profile;
      const heading = document.createElement('h3'); heading.textContent = { year: 'Het hele jaar', summer: 'Zomer', winter: 'Winter' }[profile]; group.append(heading);
      for (const phase of ['night', 'day']) {
        const prefix = `strategy-${profile}-${phase}`;
        const card = document.createElement('fieldset'); card.className = 'homey-form-fieldset'; card.dataset.strategyPhase = phase;
        const legend = document.createElement('legend'); legend.className = 'homey-form-legend'; legend.textContent = phase === 'night' ? 'Nachtplanning' : 'Dagplanning'; card.append(legend);
        card.append(radio(prefix + '-mode', 'standard', 'Standaard laadstrategie', true));
        const correction = document.createElement('div'); correction.className = 'setting-cluster'; correction.dataset.strategyStandard = '';
        const input = document.createElement('input'); input.type = 'number'; input.className = 'homey-form-input';
        input.min = '0'; input.max = '100'; input.step = '1'; input.value = '0'; input.id = prefix + '-extra';
        const text = document.createElement('label'); text.htmlFor = input.id; text.textContent = 'Extra laadvermogen boven standaardplanning (%)';
        correction.append(text, input); card.append(correction);
        card.append(radio(prefix + '-mode', 'maximum', 'Laden met maximaal toegestaan vermogen', false));
        const positions = document.createElement('div'); positions.className = 'setting-cluster'; positions.dataset.strategyMaximum = '';
        for (const [value, text] of [['early', 'Vanaf begin laadvenster'], ['latest', 'Zo laat mogelijk — 15 minuten tijdreserve'], ['center', 'Laadblok centreren rond goedkoopste kwartier / midden goedkoopste tariefperiode']]) {
          positions.append(radio(prefix + '-position', value, text, value === (phase === 'night' ? 'center' : 'latest')));
        }
        const margin = document.createElement('input'); margin.type = 'number'; margin.className = 'homey-form-input';
        margin.min = '0'; margin.max = '100'; margin.step = '1'; margin.value = '0'; margin.id = prefix + '-margin';
        const marginLabel = document.createElement('label'); marginLabel.htmlFor = margin.id; marginLabel.textContent = 'Extra planningsmarge voor laadverliezen (%)';
        const marginHelp = document.createElement('p'); marginHelp.className = 'muted';marginHelp.dataset.hfHelp='';marginHelp.dataset.hfHelpFor=margin.id;
        marginHelp.textContent = 'Alleen bij maximaal vermogen. 20% reserveert 20% meer laadtijd. Het SoC-doel blijft gelijk; de resterende planning krimpt met de actuele SoC. Standaard 0%.';
        positions.append(marginLabel, margin, marginHelp);
        card.append(positions); group.append(card);
      }
      root.append(group);
    }
    root.addEventListener('change', update);
    update();
  }
  function update() {
    const seasonal = root.querySelector('[name="chargeStrategySeason"]:checked').value === 'seasonal';
    root.querySelectorAll('[data-strategy-months]').forEach(el => el.classList.toggle('hidden', !seasonal));
    root.querySelectorAll('[data-strategy-profile]').forEach(group => {
      group.classList.toggle('hidden', seasonal ? group.dataset.strategyProfile === 'year' : group.dataset.strategyProfile !== 'year');
      group.querySelectorAll('[data-strategy-phase]').forEach(card => {
        const maximum = card.querySelector('[name$="-mode"]:checked').value === 'maximum';
        card.querySelector('[data-strategy-standard]').classList.toggle('hidden', maximum);
        card.querySelector('[data-strategy-maximum]').classList.toggle('hidden', !maximum);
      });
    });
    if(typeof HomeFluxSettingsHelp!=='undefined')HomeFluxSettingsHelp.refresh(root);
  }
  function load(config = {}) {
    root.querySelector(`[name="chargeStrategySeason"][value="${config?.seasonal ? 'seasonal' : 'year'}"]`).checked = true;
    for (const profile of profiles) for (const phase of ['day', 'night']) {
      const prefix = `strategy-${profile}-${phase}`, value = config?.[profile]?.[phase];
      const mode = value?.mode === 'maximum' ? 'maximum' : 'standard';
      const position = ['early', 'latest', 'center'].includes(value?.position) ? value.position : phase === 'night' ? 'center' : 'latest';
      root.querySelector(`[name="${prefix}-mode"][value="${mode}"]`).checked = true;
      root.querySelector(`[name="${prefix}-position"][value="${position}"]`).checked = true;
      root.querySelector('#' + prefix + '-extra').value = Number.isFinite(value?.extraPercent) ? value.extraPercent : 0;
      root.querySelector('#' + prefix + '-margin').value = Number.isFinite(value?.planningMarginPercent) ? value.planningMarginPercent : 0;
    }
    update();
  }
  function read() {
    const config = { seasonal: root.querySelector('[name="chargeStrategySeason"]:checked').value === 'seasonal' };
    for (const profile of profiles) {
      config[profile] = {};
      for (const phase of ['day', 'night']) {
        const prefix = `strategy-${profile}-${phase}`;
        config[profile][phase] = { mode: root.querySelector(`[name="${prefix}-mode"]:checked`).value,
          extraPercent: Number(root.querySelector('#' + prefix + '-extra').value),
          planningMarginPercent: Number(root.querySelector('#' + prefix + '-margin').value),
          position: root.querySelector(`[name="${prefix}-position"]:checked`).value };
      }
    }
    return config;
  }
  function validate() {
    for (const input of root.querySelectorAll('input[type="number"]')) if (!input.value.trim() || !input.checkValidity()) return input;
    return null;
  }
  return { mount, load, read, validate };
})();
