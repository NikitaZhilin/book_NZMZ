#!/usr/bin/python3
"""Pull only commits with a successful GitHub check. No inbound deploy credentials."""
import fcntl
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request

BASE=Path('/opt/book-nzmz')
REPO=BASE/'repo'
LOCK=(BASE/'update.lock').open('a')
fcntl.flock(LOCK,fcntl.LOCK_EX|fcntl.LOCK_NB)
def command(args,check=True):
    return subprocess.run(args,capture_output=True,text=True,check=check,timeout=240)
def user(args,check=True):
    return command(['runuser','-u','booklibrary','--',*args],check)
def git(*args,check=True):
    return user(['git','-C',str(REPO),*args],check)
remote=git('ls-remote','origin','refs/heads/main').stdout.strip()
if not remote: raise SystemExit(0)
sha=remote.split()[0]
if not re.fullmatch('[0-9a-f]{40}',sha):raise SystemExit('Invalid remote commit')
deployed=BASE/'deployed-sha'
if deployed.exists() and deployed.read_text().strip()==sha:raise SystemExit(0)
request=urllib.request.Request('https://api.github.com/repos/NikitaZhilin/book_NZMZ/actions/runs?head_sha='+sha+'&event=push',headers={'Accept':'application/vnd.github+json','User-Agent':'book-nzmz-updater'})
with urllib.request.urlopen(request,timeout=20) as response:runs=json.load(response)['workflow_runs']
if not any(run.get('head_sha')==sha and run.get('path')=='.github/workflows/deploy.yml' and run.get('conclusion')=='success' for run in runs):
    print('Waiting for successful GitHub checks.',flush=True)
    raise SystemExit(0)
git('fetch','--quiet','origin','main')
previous=git('rev-parse','--verify','HEAD',check=False).stdout.strip()
git('checkout','--quiet','--detach',sha)
try:
    user([str(BASE/'venv/bin/pip'),'install','--quiet','--disable-pip-version-check','-r',str(REPO/'requirements.txt')])
    (BASE/'release.env').write_text('APP_COMMIT='+sha+'\n')
    command(['systemctl','restart','book-nzmz.service'])
    for attempt in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8769/health',timeout=2) as response:
                if json.load(response).get('commit')==sha:
                    deployed.write_text(sha+'\n')
                    print('Deployed '+sha,flush=True)
                    raise SystemExit(0)
        except (OSError,ValueError):pass
        time.sleep(1)
    raise RuntimeError('Health check failed')
except Exception:
    if re.fullmatch('[0-9a-f]{40}',previous):
        git('checkout','--quiet','--detach',previous)
        user([str(BASE/'venv/bin/pip'),'install','--quiet','--disable-pip-version-check','-r',str(REPO/'requirements.txt')])
        (BASE/'release.env').write_text('APP_COMMIT='+previous+'\n')
        command(['systemctl','restart','book-nzmz.service'])
    raise
