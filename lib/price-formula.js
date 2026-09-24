'use strict';

// Homey exposes its dynamic import calculation via getDynamicElectricityPriceUserCosts
// (mathExpression). Parse arithmetic only: never execute code from an API response.
function compilePriceFormula(expression) {
  const text = String(expression || '').trim().replace(/\[\[(price|p|value)\]\]|\{\{(price|p|value)\}\}/gi, (_, a, b) => a || b);
  if (!text || text.length > 2048) throw new Error('Unsupported Homey price formula');
  const tokens = text.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|\*\*|[+\-*/^(),]/gi) || [];
  if (tokens.join('') !== text.replace(/\s/g, '') || tokens.length > 512) throw new Error('Unsupported Homey price formula');
  let pos = 0, depth = 0;
  const functions = { abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, pow: Math.pow, sqrt: Math.sqrt };
  const arity = { abs: [1,1], min: [1,16], max: [1,16], floor: [1,1], ceil: [1,1], round: [1,1], pow: [2,2], sqrt: [1,1] };
  function atom() {
    if (++depth > 32) throw new Error('Homey price formula is too deeply nested');
    const token = tokens[pos++]; let fn;
    if (token === '(') { fn = sum(); if (tokens[pos++] !== ')') throw new Error('Invalid Homey price formula'); }
    else if (/^(?:\d|\.)/.test(token || '')) { const n = Number(token); fn = () => n; }
    else if (Object.prototype.hasOwnProperty.call(functions, token) && tokens[pos] === '(') {
      pos++; const args = [sum()];
      while (tokens[pos] === ',') { pos++; args.push(sum()); }
      if (tokens[pos++] !== ')' || args.length < arity[token][0] || args.length > arity[token][1]) throw new Error('Invalid Homey price function');
      fn = p => functions[token](...args.map(arg => arg(p)));
    } else if (/^(p|x|price|value|marketPrice|spotPrice|electricityPrice)$/i.test(token || '')) fn = p => p;
    else throw new Error('Unsupported variable or function in Homey price formula');
    depth--; return fn;
  }
  function power() { const left = atom(); if (['^','**'].includes(tokens[pos])) { pos++; const right = unary(); return p => left(p) ** right(p); } return left; }
  function unary() { if (tokens[pos] === '+' || tokens[pos] === '-') { const sign = tokens[pos++] === '-' ? -1 : 1; const fn = unary(); return p => sign * fn(p); } return power(); }
  function product() { let left = unary(); while (['*','/'].includes(tokens[pos])) { const op = tokens[pos++], a = left, b = unary(); left = p => op === '*' ? a(p) * b(p) : a(p) / b(p); } return left; }
  function sum() { let left = product(); while (['+','-'].includes(tokens[pos])) { const op = tokens[pos++], a = left, b = product(); left = p => op === '+' ? a(p) + b(p) : a(p) - b(p); } return left; }
  const evaluate = sum();
  if (pos !== tokens.length) throw new Error('Invalid Homey price formula');
  return price => { const result = evaluate(price); if (!Number.isFinite(result)) throw new Error('Homey price formula returned an invalid price'); return result; };
}

function extractMathExpression(costs) {
  if (costs == null) return '';
  if (typeof costs === 'string') return costs.trim();
  if (typeof costs.mathExpression === 'string') return costs.mathExpression.trim();
  if (Object.prototype.hasOwnProperty.call(costs, 'mathExpression') && costs.mathExpression == null) return '';
  if (typeof costs === 'object' && Object.keys(costs).length === 0) return '';
  if (costs.value !== undefined) return extractMathExpression(costs.value);
  throw new Error('Unrecognized Homey price formula response');
}

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
function summaryPairs(payload, rows) {
  const values = rows.map(row => row.price);
  if (!values.length) return [];
  return [
    [Math.min(...values), payload?.lowestPriceWithUserCosts],
    [Math.max(...values), payload?.highestPriceWithUserCosts],
    [values.reduce((a,b) => a+b, 0) / values.length, payload?.averagePriceWithUserCosts],
  ].filter(pair => finite(pair[1])).map(([x,y]) => [x, Number(y)]);
}
function applyHomeyUserCosts(payload, rows, costs) {
  if (!rows.length) return rows;
  const expression = extractMathExpression(costs);
  const adjustedValue = row => row.raw?.valueWithUserCosts ?? row.raw?.priceWithUserCosts;
  let corrected, method;
  if (rows.every(row => finite(adjustedValue(row)))) {
    corrected = rows.map(row => Number(adjustedValue(row))); method = 'homey_slots';
  } else if (expression) {
    const formula = compilePriceFormula(expression);
    corrected = rows.map(row => formula(row.price)); method = 'homey_formula';
  } else {
    // Compatibility for API versions that expose only daily user-cost summaries.
    // Derive both a factor and an offset, checking every available summary.
    const pairs = summaryPairs(payload, rows);
    if (!pairs.length) { corrected = rows.map(row => row.price); method = 'market'; }
    else {
      const sorted = pairs.slice().sort((a,b) => a[0]-b[0]);
      const low = sorted[0], high = sorted[sorted.length-1];
      const spread = high[0]-low[0];
      const scale = spread > 1e-8 ? (high[1]-low[1])/spread : 1;
      const offset = low[1]-scale*low[0];
      if (!Number.isFinite(scale) || scale < 0 || pairs.some(([x,y]) => Math.abs(scale*x+offset-y) > 0.002)) throw new Error('Homey price costs cannot be derived reliably');
      corrected = rows.map(row => scale*row.price+offset); method = 'homey_summary';
    }
  }
  const actual = [Math.min(...corrected), Math.max(...corrected), corrected.reduce((a,b)=>a+b,0)/corrected.length];
  const expected = [payload?.lowestPriceWithUserCosts, payload?.highestPriceWithUserCosts, payload?.averagePriceWithUserCosts];
  if (expected.some((v,i) => finite(v) && Math.abs(Number(v)-actual[i]) > 0.002)) throw new Error('Homey price formula does not match its consumer-price summary');
  return rows.map((row,i) => ({...row, rawPrice: row.price, price: corrected[i], userCostAdder: corrected[i]-row.price, priceMethod: method}));
}
module.exports = { compilePriceFormula, extractMathExpression, applyHomeyUserCosts };
