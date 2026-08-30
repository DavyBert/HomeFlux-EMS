const fs = require('fs');
const path = require('path');
const assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'settings', 'index.html'), 'utf8');
const prefix = '  const FLOW_HELP_CATALOG = ';
const start = html.indexOf(prefix);
const end = html.indexOf(';\n  let uiLanguage', start);
assert(start >= 0 && end > start, 'Help catalog JSON must be embedded in settings');
const catalog = JSON.parse(html.slice(start + prefix.length, end));
for (const kind of ['actions','triggers','conditions']) {
  const dir = path.join(__dirname, '..', '.homeycompose', 'flow', kind);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const visibleFiles = files.filter(file => {
    const card = JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
    return card.deprecated !== true;
  });
  assert.strictEqual(catalog[kind].length, visibleFiles.length, `Help ${kind} count must match non-deprecated Compose`);
  for (const file of visibleFiles) {
    const id = file.replace(/\.json$/, '');
    const card = JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
    const help = catalog[kind].find(item => item.id === id);
    assert(help, `Help catalog misses ${kind}/${id}`);
    assert(card.title && card.title.en && card.title.nl, `${id} must have EN/NL Compose titles`);
    assert.strictEqual(help.title.en, card.title.en, `${id} English Help title must match Compose`);
    assert.strictEqual(help.title.nl, card.title.nl, `${id} Dutch Help title must match Compose`);
    assert(help.description && help.description.en && help.description.nl, `${id} must have EN/NL Help descriptions`);
  }
}
assert(Array.isArray(catalog.logicTags) && catalog.logicTags.length >= 1, 'Help must contain global Logic tags');
for (const tag of catalog.logicTags) {
  assert(tag.title && tag.description?.en && tag.description?.nl, `Logic tag ${tag.title || '?'} must be bilingual`);
}
assert(catalog.logicTags.some(tag => tag.title === 'HomeFlux EMS - Total Command (W)'), 'Total Command Logic tag must be documented');
console.log(`help-catalog tests passed (${catalog.actions.length} inputs, ${catalog.triggers.length} outputs, ${catalog.conditions.length} conditions, ${catalog.logicTags.length} tags)`);
