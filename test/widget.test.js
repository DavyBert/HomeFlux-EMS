'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const widgetRoot = path.join(root, 'widgets', 'savings');
const compose = JSON.parse(fs.readFileSync(path.join(widgetRoot, 'widget.compose.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const appCompose = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose', 'app.json'), 'utf8'));
const html = fs.readFileSync(path.join(widgetRoot, 'public', 'index.html'), 'utf8');
const statusWidgetRoot = path.join(root, 'widgets', 'status');
const statusCompose = JSON.parse(fs.readFileSync(path.join(statusWidgetRoot, 'widget.compose.json'), 'utf8'));
const statusHtml = fs.readFileSync(path.join(statusWidgetRoot, 'public', 'index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

assert.equal(appCompose.compatibility, '>=12.3.0');
assert.equal(manifest.compatibility, appCompose.compatibility);
assert.equal(manifest.version, '0.4.14');
assert.equal(appCompose.version, '0.4.14');
assert.equal(packageJson.version, '0.4.14');
assert.equal(packageLock.version, '0.4.14');
assert.equal(packageLock.packages[''].version, '0.4.14');
assert.deepEqual(manifest.widgets.savings, { ...compose, id: 'savings' }, 'generated widget manifest must match widget Compose');
assert.deepEqual(manifest.widgets.status, { ...statusCompose, id: 'status' }, 'generated status widget manifest must match widget Compose');
for (const id of ['showReasons', 'showTariff', 'showNextTariff', 'showPriceStatus', 'showNextCharge', 'showPlanningPhase', 'showPlanningForecast', 'showPlanningNeed', 'showPlanningGrid', 'showPlanningSolar']) {
  assert(statusCompose.settings.some(item => item.id === id), `status widget setting ${id} missing`);
}
assert(statusHtml.includes("enabled(settings, 'showTariff')"), 'status widget must allow current tariff to be selected');
assert(statusHtml.includes("enabled(settings, 'showNextTariff')"), 'status widget must allow next tariff to be selected');
assert(statusHtml.includes("enabled(settings, 'showPriceStatus')"), 'status widget must allow price freshness to be selected');
assert(statusHtml.includes("enabled(settings, 'showNextCharge')"), 'status widget must allow next charge to be selected');
assert(statusHtml.includes("enabled(settings, 'showPlanningPhase')"), 'status widget must allow active planning phase to be selected');
assert(statusHtml.includes("enabled(settings, 'showPlanningForecast')"), 'status widget must allow planning forecast to be selected');
assert(statusHtml.includes("enabled(settings, 'showPlanningNeed')"), 'status widget must allow remaining planning need to be selected');
assert(statusHtml.includes("enabled(settings, 'showPlanningGrid')"), 'status widget must allow planned grid energy to be selected');
assert(statusHtml.includes("enabled(settings, 'showPlanningSolar')"), 'status widget must allow expected PV energy to be selected');
assert(statusHtml.includes("enabled(settings, 'showReasons')"), 'status widget must allow decision reasons to be selected');
assert(statusHtml.includes('emsDecisionReason(status)'), 'status widget must render the existing EMS decision reason');
assert(statusHtml.includes('reasonText(ev.reason, Homey)'), 'status widget must render the existing EV reason');
assert(statusHtml.includes('reasonText(hvac.reason, Homey)'), 'status widget must render the existing HVAC reason');
assert(statusHtml.includes('reasonText(status.boiler.reason, Homey)'), 'status widget must render the existing boiler reason');
assert(statusHtml.includes('nextTariffText(status)'), 'status widget must render the next tariff');
assert(statusHtml.includes('priceDataText(status, Homey)'), 'status widget must render price-data freshness');
assert(statusHtml.includes('nextChargeText(status, Homey)'), 'status widget must render next-charge status');
assert.equal(compose.height, 150);
assert.equal(compose.devices, undefined, 'savings widget must not require a device selection');
assert.equal(statusCompose.devices, undefined, 'status widget must not require a device selection');

const chart = compose.settings.find(item => item.id === 'chart');
assert(chart, 'chart widget setting missing');
assert.deepEqual(chart.values.map(item => item.id), ['cost', 'profit', 'cost_profit', 'profit_cost']);
assert.deepEqual(chart.values.map(item => item.title.nl), ['Kost', 'Netto winst', 'Kost + winst', 'Winst + kost']);
assert.equal(chart.title.en, 'Chart');
assert.equal(chart.title.nl, 'Grafiek');

const period = compose.settings.find(item => item.id === 'period');
assert(period, 'period widget setting missing');
assert.deepEqual(period.values.map(item => item.id), ['day', 'month', 'year']);
assert.equal(period.title.en, 'Period');
assert.equal(period.title.nl, 'Periode');

const showProgress = compose.settings.find(item => item.id === 'showProgress');
assert(showProgress, 'percentage bar widget setting missing');
assert.equal(showProgress.type, 'dropdown');
assert.equal(showProgress.value, 'show');
assert.deepEqual(showProgress.values.map(item => item.id), ['show', 'hide']);
assert.deepEqual(showProgress.values.map(item => item.title.nl), ['Tonen', 'Verbergen']);
assert.equal(showProgress.title.en, 'Percentage bar');
assert.equal(showProgress.title.nl, 'Percentagebalk');

const combinedProgressTarget = compose.settings.find(item => item.id === 'combinedProgressTarget');
assert(combinedProgressTarget, 'combined percentage bar target setting missing');
assert.equal(combinedProgressTarget.type, 'dropdown');
assert.equal(combinedProgressTarget.value, 'profit');
assert.deepEqual(combinedProgressTarget.values.map(item => item.id), ['cost', 'profit']);
assert.deepEqual(combinedProgressTarget.values.map(item => item.title.nl), ['Tonen bij kost', 'Tonen bij winst']);
assert.equal(combinedProgressTarget.title.en, 'Percentage bar in combined chart');
assert.equal(combinedProgressTarget.title.nl, 'Percentagebalk bij dubbele grafiek');

const combineGridCharging = compose.settings.find(item => item.id === 'combineGridCharging');
assert(combineGridCharging, 'combine grid charging widget setting missing');
assert.equal(combineGridCharging.type, 'dropdown');
assert.equal(combineGridCharging.value, 'no');
assert.deepEqual(combineGridCharging.values.map(item => item.id), ['no', 'yes']);
assert.deepEqual(combineGridCharging.values.map(item => item.title.nl), ['Nee', 'Ja']);
assert.equal(combineGridCharging.title.en, 'Combine grid charging');
assert.equal(combineGridCharging.title.nl, 'Combineer netladen');

const refresh = compose.settings.find(item => item.id === 'refresh');
assert(refresh, 'refresh widget setting missing');
assert.equal(refresh.value, '5');
assert.deepEqual(refresh.values.map(item => item.id), ['1', '3', '5', '10', '15']);
assert.equal(refresh.title.en, 'Refresh interval');
assert.equal(refresh.title.nl, 'Updatefrequentie');

assert(html.includes('Homey.getSettings()'), 'widget must read its Homey widget settings');
assert(html.includes("Homey.api('GET'"), 'widget must read Savings through its local widget API');
assert(html.includes("const showProgress = String(settings.showProgress || 'show') !== 'hide';"), 'widget must allow the percentage bar to be shown or hidden');
assert(html.includes("const combinedProgressTarget = ['cost', 'profit'].includes(String(settings.combinedProgressTarget))"), 'combined widget must read which chart should show the percentage bar');
assert(html.includes("const shouldShowProgress = key => showProgress && (!combined || key === combinedProgressTarget);"), 'single widgets must keep show/hide while combined widgets show the bar on only the selected chart');
assert(html.includes("return key === 'cost' ? 220 : 180;"), 'cost widget must reserve extra height so its percentage bar cannot overlap the longer legend');
assert(html.includes('const widgetHeight = chartKeys.reduce((sum, key) => sum + getSectionHeight(key, shouldShowProgress(key)), 0);'), 'widget height must sum chart-specific progress heights');
assert(html.includes('Homey.ready({ height: widgetHeight })'), 'widget must publish the exact calculated height to Homey');
assert(html.includes("content.style.gridTemplateRows = models.map(model => `${getSectionHeight(model.key, shouldShowProgress(model.key))}px`).join(' ');"), 'stacked widget rows must use the selected percentage-bar target height');
assert(html.includes("['cost', 'profit', 'cost_profit', 'profit_cost']"), 'widget must support single and combined chart modes');
assert(html.includes('.content.multi { grid-template-rows: repeat(2, 150px); }'), 'combined charts must be stacked vertically');
assert(html.includes('grid-template-columns: 108px minmax(0, 1fr);'), 'combined chart panels must retain the full single-chart layout');
assert(!html.includes('.multi .donut-wrap'), 'combined charts must not shrink the donut');
assert(html.includes('renderSection(model, Homey, periodLabels[period], shouldShowProgress(model.key))'), 'each stacked chart must render with progress only on its selected target');
assert(html.includes("widget.savings.directGrid"), 'cost widget must include direct grid use');
assert(html.includes("widget.savings.pvToBatteryFree"), 'cost widget must include free PV-to-battery energy');
assert(html.includes("const combineGridCharging = String(settings.combineGridCharging || 'no') === 'yes';"), 'widget must read the combine grid charging setting');
assert(html.includes('tariffCharging.reduce((sum, item) => sum + (Number(item.kwh) || 0), 0)'), 'combined grid charging must sum tariff kWh');
assert(html.includes("const chargePalette = ['#c084fc','#8b5cf6','#5b21b6'"), 'separate grid charging tariffs must use a higher-contrast palette');
assert(html.includes('.chart-section.with-progress .legend { max-height: none; }'), 'only the chart that shows a percentage bar may expand its legend');
assert(html.includes("widget.savings.avoidedEnergyCost"), 'cost widget must label the avoided energy cost bar');
assert(html.includes("widget.savings.avoidedCosts"), 'profit widget must label the avoided costs bar');
assert(html.includes('if (showProgress) renderProgress(details, model.progress, Homey, model.progressKey, model.progressFallback);'), 'widget percentage bars must render outside the clipped legend when enabled');
assert(html.includes("[1, 3, 5, 10, 15].includes(Number(settings.refresh))"), 'widget must validate refresh setting');
assert(html.includes('setInterval(() => {'), 'widget must refresh at the selected interval');
assert(html.includes('refreshMinutes * 60 * 1000'), 'widget refresh interval must be expressed in selected minutes');
assert(html.includes('if (!document.hidden) refresh();'), 'widget must skip refresh calls while hidden');
assert(!html.includes('setTimeout('), 'widget must not add extra one-shot polling timers');

function readPngHeader(filename) {
  const data = fs.readFileSync(filename);
  assert.equal(data.toString('hex', 0, 8), '89504e470d0a1a0a', `${path.basename(filename)} must be PNG`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25],
  };
}
for (const name of ['preview-light.png', 'preview-dark.png']) {
  const header = readPngHeader(path.join(widgetRoot, name));
  assert.equal(header.width, 1024, `${name} width`);
  assert.equal(header.height, 1024, `${name} height`);
  assert.equal(header.colorType, 6, `${name} must be RGBA for transparent background support`);
}

const widgetApi = require('../widgets/savings/api');
(async () => {
  const calls = [];
  const homey = { app: { getSavingsStatus: args => { calls.push(args); return { period: args.period }; } } };
  assert.deepEqual(await widgetApi.getSavings({ homey, query: { period: 'month' } }), { period: 'month' });
  assert.deepEqual(await widgetApi.getSavings({ homey, query: { period: 'year' } }), { period: 'year' });
  assert.deepEqual(await widgetApi.getSavings({ homey, query: { period: 'week' } }), { period: 'day' });
  assert.deepEqual(calls, [{ period: 'month' }, { period: 'year' }, { period: 'day' }]);
  console.log('widget tests passed');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
