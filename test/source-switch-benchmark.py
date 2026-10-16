import subprocess,json,statistics,os,sys
from pathlib import Path
roots={'before':str(Path(sys.argv[1]).resolve()),'after':str(Path(sys.argv[2]).resolve())}
scenarios=['steady_free','steady_cap','flip_cap','flip_free','ramp_free','vary_cap']
results={s:{v:[] for v in roots} for s in scenarios}
for iteration in range(7):
 for s in (scenarios if iteration%2==0 else scenarios[::-1]):
  for version in (list(roots) if iteration%2==0 else list(roots)[::-1]):
   r=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('source-switch-cpu.cjs')),s],env={**os.environ,'EMS_ROOT':roots[version]},text=True))
   results[s][version].append(r)
 print('iteration',iteration+1,'done',flush=True)
summary={}
for s,pair in results.items():
 summary[s]={v:{'cpuMedianMs':statistics.median(x['cpuMs'] for x in rs),'cpuSamplesMs':[x['cpuMs'] for x in rs],
  'counts':rs[0]['counts'],'counters':rs[0]['counters'],'commands':rs[0]['commands']} for v,rs in pair.items()}
 print(s,{v:round(x['cpuMedianMs'],3) for v,x in summary[s].items()},flush=True)
Path('source-switch-1.1.3-cpu.json').write_text(json.dumps(summary,indent=2)+'\n')
