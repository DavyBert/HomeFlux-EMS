/* Shared, presentation-only translations. No control state is modified. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeFluxDisplayLanguage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createTranslator(bundle) {
    const exact = bundle.exact || {};
    const phrases = Object.entries(bundle.phrases || {}).sort((a, b) => b[0].length - a[0].length);
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const templates = Object.entries(bundle.templates || {}).map(([source, target]) => {
      const indices = [];
      const parts = source.split(/(\{\d+\})/g);
      const pattern = parts.map(part => {
        const match = /^\{(\d+)\}$/.exec(part);
        if (!match) return escape(part);
        indices.push(Number(match[1]));
        return source === '{0} over {1}' && match[1] === '1' ? '([0-9].*?)' : '(.*?)';
      }).join('');
      return { regex: new RegExp('^' + pattern + '$', 's'), target, indices, size: source.replace(/\{\d+\}/g, '').length };
    }).sort((a, b) => b.size - a.size);
    const englishExact = new Set(Object.values(exact));
    const cache = new Map();
    function core(text, depth = 0) {
      if (Object.prototype.hasOwnProperty.call(exact, text)) return exact[text];
      if (englishExact.has(text)) return text;
      if (depth < 4) {
        for (const item of templates) {
          const match = item.regex.exec(text);
          if (!match) continue;
          const values = {};
          item.indices.forEach((index, n) => { values[index] = core(match[n + 1], depth + 1); });
          return item.target.replace(/\{(\d+)\}/g, (_, n) => values[n] ?? '');
        }
      }
      let out = text;
      for (const [from, to] of phrases) {
        if (!from || !out.includes(from)) continue;
        out = /^[A-Za-z]+$/.test(from)
          ? out.replace(new RegExp('\\b' + escape(from) + '\\b', 'g'), () => to)
          : out.split(from).join(to);
      }
      if (depth < 4 && out.includes(' · ')) return out.split(' · ').map(part => core(part, depth + 1)).join(' · ');
      if (depth < 4 && out.includes(', ')) return out.split(', ').map(part => core(part, depth + 1)).join(', ');
      return out;
    }
    return function translate(value) {
      const raw = String(value ?? '');
      if (!raw.trim()) return raw;
      if (cache.has(raw)) return cache.get(raw);
      const lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
      const result = lead + core(raw.trim()) + tail;
      if (cache.size >= 1024) cache.clear();
      cache.set(raw, result);
      return result;
    };
  }
  return { createTranslator };
});
