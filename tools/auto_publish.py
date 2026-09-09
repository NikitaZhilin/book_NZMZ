"""Watch code changes, test stable snapshots, then commit and push."""
from backup_catalog import run_backup
import hashlib
import json
import msvcrt
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
LOCAL=ROOT/'.local'
LOCAL.mkdir(exist_ok=True)
LOCK=(LOCAL/'publish.lock').open('a+')
try: msvcrt.locking(LOCK.fileno(),msvcrt.LK_NBLCK,1)
except OSError: raise SystemExit('Another publisher is already running')
STOP=LOCAL/'stop-publish'
CONFIG=json.loads((LOCAL/'runtime.json').read_text('utf-8'))
GIT=CONFIG['git']
NODE=CONFIG['node']
PYTHON=str(ROOT/'.venv'/'Scripts'/'python.exe')
SAFE='safe.directory='+ROOT.as_posix()
ROOT_FILES={'README.md','AGENTS.md','.gitignore','requirements.txt','requirements-dev.txt','START_AUTO_PUBLISH.cmd','STOP_AUTO_PUBLISH.cmd'}
PROTOTYPE={'index.html','style.css','app.js','server.py','README.md','START_LIBRARY.cmd','start.ps1'}

def log(message):
    with (LOCAL/'auto-publish.log').open('a',encoding='utf-8') as stream:
        stream.write(time.strftime('%Y-%m-%d %H:%M:%S ')+message+'\n')
def run(command):
    return subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'Never'},timeout=180)
def git(*args): return run([GIT,'-c',SAFE,*args])
def allowed(path):
    p=Path(path)
    return path in ROOT_FILES or (len(p.parts)==2 and p.parts[0]=='prototype' and p.name in PROTOTYPE) or (p.parts[0] in ('app','tests','tools','deploy','.github') and p.suffix in ('.py','.ps1','.sh','.service','.timer','.yml','.yaml','.md','.example') and '__pycache__' not in p.parts)
def source_paths():
    for folder, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in {'.git','.venv','.local','data','backups','__pycache__','node_modules'}]
        for name in files:
            yield Path(folder)/name

def snapshot():
    files={}
    for path in source_paths():
        relative=path.relative_to(ROOT).as_posix()
        if path.is_file() and allowed(relative):
            files[relative]=hashlib.sha256(path.read_bytes()).hexdigest()
    return files
def tracked_changes():
    result=git('status','--porcelain=v1','-z','--untracked-files=all')
    if result.returncode: raise RuntimeError('git status failed')
    values=result.stdout.split('\0'); names=[]; i=0
    while i<len(values):
        value=values[i];i+=1
        if not value:continue
        if 'R' in value[:2] or 'C' in value[:2]:
            raise RuntimeError('Rename detected; publish manually')
        path=value[3:]
        if allowed(path):names.append(path)
    return names
def check_secrets(paths):
    for path in paths:
        file=ROOT/path
        if not file.exists():continue
        content=file.read_text('utf-8')
        if any(marker in content for marker in ('-----BEGIN '+'PRIVATE KEY-----','-----BEGIN '+'OPENSSH PRIVATE KEY-----','gh'+'p_','github_'+'pat_')):
            raise RuntimeError('Possible secret in '+path)

log('Started. Only allowlisted code is published; data and credentials are excluded.')
last=snapshot();changed_at=time.monotonic();last_attempt=None;retry_at=0
backup_at=0
while not STOP.exists():
    try:
        if time.monotonic()>=backup_at:
            backup_at=time.monotonic()+900
            try: run_backup()
            except Exception as error: log('Independent backup failed: '+str(error))
        current=snapshot()
        if current!=last: last=current;changed_at=time.monotonic()
        if time.monotonic()-changed_at>=12 and current!=last_attempt:
            last_attempt=current.copy()
            changes=tracked_changes()
            if changes:
                if git('diff','--cached','--quiet').returncode:
                    raise RuntimeError('Staged changes exist; automatic commit paused')
                check_secrets(changes)
                for command in ([PYTHON,'-m','unittest','discover','-s','tests','-v'],[NODE,'--check','prototype/app.js']):
                    result=run(command)
                    if result.returncode:raise RuntimeError('Checks failed: '+result.stdout[-1500:]+result.stderr[-1500:])
                if snapshot()!=current:
                    last_attempt=None
                    continue
                if git('add','-A','--',*changes).returncode:raise RuntimeError('git add failed')
                commit=git('commit','-m','Update library '+time.strftime('%Y-%m-%d %H:%M:%S'))
                if commit.returncode:raise RuntimeError('git commit failed: '+commit.stderr[-600:])
                log('Checks passed; created commit.')
                retry_at=0
        if time.monotonic()>=retry_at:
            retry_at=time.monotonic()+30
            ahead=git('rev-list','--count','origin/main..HEAD')
            if ahead.returncode==0 and int(ahead.stdout.strip() or 0)>0:
                result=git('push','origin','main')
                log('Pushed to GitHub; deployment starts automatically.' if not result.returncode else 'Push failed; retry in 30 seconds. '+result.stderr[-800:])
    except Exception as error:log(str(error))
    time.sleep(2)
log('Stopped.')
