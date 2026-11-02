import subprocess,json,statistics
from pathlib import Path
script='diagnostics-work/test/diagnostics-1.1.6.test.js'
roots={'before':'ev-work','after':'diagnostics-work','off':'diagnostics-work'}
runs={k:[]for k in roots}
for i in range(7):
 for name in (['before','after','off']if i%2==0 else ['off','after','before']):
  args=['node',script,'--replay',roots[name],'--cpu-only']
  if name=='off':args+=['--disabled']
  r=json.loads(subprocess.check_output(args,text=True))
  assert not r['recordingFailures']
  runs[name].append({k:v for k,v in r.items()if k!='result'})
 print('completed isolated repetition',i+1,flush=True)
summary={name:{'medianCpuMs':statistics.median(r['cpuUs']for r in values)/1000,
 'minCpuMs':min(r['cpuUs']for r in values)/1000,'maxCpuMs':max(r['cpuUs']for r in values)/1000,
 **{k:values[-1][k]for k in ['configurationBytes','exportBytes','snapshots','configurationRecords','evEvents']}}
 for name,values in runs.items()}
Path('analysis/diagnostics-benchmark.json').write_text(json.dumps({'runs':runs,'summary':summary},indent=2)+'\n')
print(json.dumps(summary,indent=2),flush=True)
