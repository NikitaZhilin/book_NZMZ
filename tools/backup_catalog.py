"""Keep independent, immutable copies of changed server data on this computer."""
import datetime, hashlib, json, os, tempfile, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'.local/server-backups'
def run_backup():
 DEST.mkdir(parents=True,exist_ok=True)
 with urllib.request.urlopen('https://144-31-78-141.sslip.io/api/state',timeout=20) as response:
  raw=response.read(31*1024*1024)
 if len(raw)>30*1024*1024:raise ValueError('Catalog exceeds backup limit')
 data=json.loads(raw)
 if data.get('schemaVersion')!=1 or not isinstance(data.get('books'),list):raise ValueError('Invalid catalog')
 digest=hashlib.sha256(raw).hexdigest()
 marker=DEST/'last.sha256'
 if marker.exists() and marker.read_text()==digest:return
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 path=DEST/(stamp+'-r'+str(data.get('revision',0))+'.json')
 with tempfile.NamedTemporaryFile(dir=DEST,delete=False) as f:
  f.write(raw);f.flush();os.fsync(f.fileno());temp=Path(f.name)
 os.replace(temp,path)
 marker.write_text(digest)
 print('Independent catalog copy saved: '+path.name)
if __name__=='__main__':run_backup()
