#!/usr/bin/python3
import datetime
import json
from pathlib import Path
import os
import tempfile
ROOT=Path('/var/lib/book-nzmz')
source=ROOT/'library.json'
if not source.exists(): raise SystemExit(0)
data=source.read_bytes()
json.loads(data)
backup=ROOT/'backups'
backup.mkdir(exist_ok=True)
destination=backup/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')+'.json')
with tempfile.NamedTemporaryFile(dir=backup,delete=False) as stream:
    stream.write(data)
    temporary=Path(stream.name)
os.replace(temporary,destination)
for stale in sorted(backup.glob('????-??-??.json'))[:-30]:
    stale.unlink()
