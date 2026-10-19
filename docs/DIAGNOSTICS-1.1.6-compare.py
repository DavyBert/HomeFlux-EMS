import os,json,subprocess
from pathlib import Path
base=str(Path('ev-work').resolve())
new=str(Path('diagnostics-work').resolve())
results={}
def run(args,root):
 return json.loads(subprocess.check_output(['node',*args],env={**os.environ,'EMS_ROOT':root},text=True))
for name in ['steady_free','steady_cap','flip_cap','flip_free','ramp_free','vary_cap']:
 pair=[run(['analysis/source-switch-compare.cjs',name],r) for r in [base,new]]
 for k in ['commands','flexible','contexts']:
  assert pair[0][k]==pair[1][k],(name,k)
 results[name]=pair
 print(name,'commands/timing/context/flexible identical',flush=True)
for name in ['grid_only','stable','noise','pv_capture','peak','plan','soc','modes','live','pending','pending_changed','pending_safety','failed_output']:
 pair=[run(['source-switch-work/test/active-charge-1.1.2.test.js',r,name],r) for r in [base,new]]
 for k in ['traces','contexts','flexible']:
  assert pair[0][k]==pair[1][k],(name,k)
 for old,updated in zip(pair[0]['samples'],pair[1]['samples']):
  for k in ['second','commands','command','planned','override','source']:
   assert old[k]==updated[k],(name,k,old,updated)
 results[name]=pair
 print(name,'commands/timing/safety/live/plan identical',flush=True)
Path('analysis/diagnostics-active-regression-results.json').write_text(json.dumps(results,indent=2)+'\n')
# Both builds run in separate processes with the current EV scenarios and assertions.
code="require('./source-switch-work/test/ev-feedback-1.0.11.test.js').run(process.env.EMS_ROOT).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1})"
pair=[json.loads(subprocess.check_output(['node','-e',code],env={**os.environ,'EMS_ROOT':r},text=True)) for r in [base,new]]
for a,b in zip(*pair):
 for k in ['batteryPublishes','evPublishes','splitPublishes','samples','contexts','final']:
  assert a[k]==b[k],(a['name'],k)
Path('analysis/diagnostics-active-results.json').write_text(json.dumps(pair,indent=2)+'\n')
print('EV:',len(pair[0]),'scenarios: individual commands, Split timing and final states identical',flush=True)
