import os, subprocess, sys, time
from pathlib import Path

WORKSPACE=Path(__file__).resolve().parents[2]
STATIONS_ROOT=next(p for p in WORKSPACE.iterdir() if p.is_dir() and any(c.name.startswith('002-') for c in p.iterdir()))
ROOT=next(p for p in STATIONS_ROOT.iterdir() if p.name.startswith('004-'))
REWORK=next(p for p in STATIONS_ROOT.iterdir() if p.name.startswith('005-'))/'rework_2d_agent.py'
def station(number): return next(p for p in ROOT.iterdir() if p.is_dir() and p.name.startswith(f'({number:02d})'))
PYTHONW=Path(r"C:\Users\tianj\AppData\Local\Programs\Python\Python38\pythonw.exe")
SCRIPTS=[
 ROOT/'wave_solder_heartbeat_agent.py', station(1)/'pda_heartbeat_agent.py',
 station(2)/'aoi_quality_agent.py', station(3)/'ict_agent.py',
 station(4)/'fct_agent.py', station(5)/'depanel_heartbeat_agent.py',
 station(6)/'qrbinding.py', station(7)/'assembly_ate_agent.py',
 station(8)/'supersonic_agent.py', station(9)/'aging_cab_agent.py',
 station(10)/'hivolt_ate_agent.py', station(11)/'packing_ate_agent.py',
 station(12)/'outer_box_binding_agent.py', station(13)/'pallet_binding_agent.py', REWORK,
]
env=os.environ.copy();env.update({'FACTORY_DOMAIN':'manual','LINE_DOMAIN':'manual',
 'MES_API':'http://127.0.0.1:8080/api','MES_API_URL':'http://127.0.0.1:8080/api/pda/events',
 'MES_NEW_API':'http://127.0.0.1:8080/api','PDA_EVENT_URL':'http://127.0.0.1:8080/api/pda/events',
 'ICT_WATCH_DIR':r'D:\RUIJING_TEST\MANUAL\ICT','FCT_WATCH_DIR':r'D:\RUIJING_TEST\MANUAL\FCT',
 'ASSEMBLY_ATE_WATCH_DIR':r'D:\RUIJING_TEST\MANUAL\ASSEMBLY_ATE',
 'HIVOLT_ATE_WATCH_DIR':r'D:\RUIJING_TEST\MANUAL\HIVOLT_ATE',
 'PACKING_ATE_WATCH_DIR':r'D:\RUIJING_TEST\MANUAL\PACKING_ATE',
 'ICT_SCANNER_TCP_PORT':'13003','FCT_SCANNER_TCP_PORT':'13004'})
for key in ('ICT_WATCH_DIR','FCT_WATCH_DIR','ASSEMBLY_ATE_WATCH_DIR','HIVOLT_ATE_WATCH_DIR','PACKING_ATE_WATCH_DIR'):
 Path(env[key]).mkdir(parents=True,exist_ok=True)
 # Keep child GUI agents detached from this launcher and suppress every console
 # window.  A short stagger prevents startup alarms from fighting for focus.
flags=(getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0)
       |getattr(subprocess,'DETACHED_PROCESS',0)
       |getattr(subprocess,'CREATE_NO_WINDOW',0))
try:
 START_DELAY_SECONDS=max(0.5,float(os.environ.get('STATION_START_DELAY_SECONDS','2.5')))
except ValueError:
 START_DELAY_SECONDS=2.5
requested={value.lower() for value in sys.argv[1:]}
started=0
for script in SCRIPTS:
 if requested and script.stem.lower() not in requested and script.parent.name.lower() not in requested:continue
 p=subprocess.Popen([str(PYTHONW),str(script)],cwd=str(script.parent),env=env,stdin=subprocess.DEVNULL,
  stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags,close_fds=True)
 print('STARTED',p.pid,script)
 started+=1
 if started:
  time.sleep(START_DELAY_SECONDS)
