'use strict';

// The application uses both Date.now() and new Date(). A Date.now-only mock
// lets real wall time leak into price freshness checks and source selection.
// Follow the harness's Date.now clock for zero-argument construction too.
function installVirtualDate() {
  const originalDate = global.Date, originalNow = originalDate.now;
  let virtualDate;
  virtualDate = new Proxy(originalDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [virtualDate.now()], newTarget);
    },
    apply(target) {
      return new target(virtualDate.now()).toString();
    },
  });
  global.Date = virtualDate;
  return () => { originalDate.now = originalNow; global.Date = originalDate; };
}
module.exports = { installVirtualDate };
