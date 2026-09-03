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

assert.equal(appCompose.compatibility, '>=12.3.0');
assert.equal(manifest.compatibility, appCompose.compatibility);
assert.equal(manifest.version, '0.4.10');
assert.deepEqual(manifest.widgets.savings, { ...compose, id: 'savings' }, 'generated widget manifest must match widget Compose');
assert.equal(compose.height, 150);
assert.deepEqual(compose.devices, { type: 'app', singular: true });

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

const refresh = compose.settings.find(item => item.id === 'refresh');
assert(refresh, 'refresh widget setting missing');
assert.equal(refresh.value, '5');
assert.deepEqual(refresh.values.map(item => item.id), ['1', '3', '5', '10', '15']);
assert.equal(refresh.title.en, 'Refresh interval');
assert.equal(refresh.title.nl, 'Updatefrequentie');

assert(html.includes('Homey.getSettings()'), 'widget must read its Homey widget settings');
assert(html.includes("Homey.api('GET'"), 'widget must read Savings through its local widget API');
assert(html.includes('Homey.ready({ height: combined ? 300 : 150 })'), 'widget must use full height for stacked combined charts and compact height for single charts');
assert(html.includes("['cost', 'profit', 'cost_profit', 'profit_cost']"), 'widget must support single and combined chart modes');
assert(html.includes('.content.multi { grid-template-rows: repeat(2, 150px); }'), 'combined charts must be stacked vertically');
assert(html.includes('grid-template-columns: 108px minmax(0, 1fr);'), 'combined chart panels must retain the full single-chart layout');
assert(!html.includes('.multi .donut-wrap'), 'combined charts must not shrink the donut');
assert(html.includes('renderSection(model, Homey, periodLabels[period])'), 'each stacked chart must render as a full standalone-style section');
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
