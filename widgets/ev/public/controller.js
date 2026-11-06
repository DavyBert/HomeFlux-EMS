'use strict';
// UI state only. No charging decisions or energy integration lives here.
(function(root) {
  function create({ send, now = () => Date.now(), changed = () => {}, nonce = () => Math.random().toString(36).slice(2) }) {
    let selected = null, current = null, pending = null, busy = false, epoch = 0;
    let draft = {}, sequence = 0;
    function cancel(notify = true) { pending = null; if (notify) changed(); }
    function select(id) { selected = id; epoch++; draft = {}; current = null; cancel(); }
    function update(plan) { current = plan; }
    async function tap(key, change) {
      if (busy || !selected) return { ignored: true };
      if (!pending || pending.key !== key || now() >= pending.expiresAt || (Object.keys(change).length && JSON.stringify(pending.change) !== JSON.stringify(change))) {
        pending = { key, change, expiresAt: now() + 5000 }; changed(); return { confirm: true };
      }
      const input = pending.change; pending = null;
      const token = epoch, id = selected;
      const modeAction = Object.hasOwn(input, 'mode');
      if (!current && !modeAction) {
        draft = { ...draft, ...input };
        if (Object.hasOwn(input, 'days')) { delete draft.deadline; delete draft.dateKey; }
        if (!draft.target || !(draft.deadline?.time || draft.time)) { changed(); return { draft: true }; }
      }
      busy = true; changed();
      try {
        const result = await send({ evId: id, change: current || modeAction ? input : { ...draft }, createOnly: !current && !modeAction,
          requestId: `${nonce()}_${++sequence}_${now()}` });
        if (token !== epoch) return { stale: true };
        if (result?.accepted !== true) throw new Error('evWidget.errors.input');
        if (!modeAction && !input.clear && !result.plan) throw new Error('evWidget.errors.save');
        const deadline = (current ? input : draft).deadline;
        if (deadline && (result.plan?.deadlineLabel?.dateKey !== deadline.dateKey || result.plan.time !== deadline.time)) throw new Error('evWidget.errors.save');
        draft = {}; current = result.plan;
        return { success: true, result };
      } finally { busy = false; changed(); }
    }
    return { select, update, tap, cancel, invalidate: () => { epoch++; cancel(); },
      snapshot: () => ({ selected, current, pending, busy, draft: { ...draft } }) };
  }
  if (typeof module !== 'undefined') module.exports = { create };
  else root.HomeFluxEvController = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
