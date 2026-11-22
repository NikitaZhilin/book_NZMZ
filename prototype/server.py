"""Local library prototype. Python standard library; no installation required."""
import json
import datetime
import re
import uuid
import os
import shutil
import threading
import tempfile
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('MISHA_LIBRARY_DATA', str(ROOT / 'data')))
PORT = int(os.environ.get('MISHA_LIBRARY_PORT', '8768'))
LOCK = threading.Lock()

def validate(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError('Неверный формат библиотеки')
    books = value.get('books')
    if not isinstance(books, list) or len(books) > 20000:
        raise ValueError('Неверный список книг')
    ids = set()
    for book in books:
        if not isinstance(book, dict) or not isinstance(book.get('id'), str) or not book['id'] or book['id'] in ids:
            raise ValueError('Повторяющийся или пустой идентификатор')
        ids.add(book['id'])
        if type(book.get('quantity')) is not int or not 1 <= book['quantity'] <= 999:
            raise ValueError('Количество должно быть от 1 до 999')
        for key in ('title','author','isbn','publisher','year','series','pages','illustrator','category','notes','status','reading','confidence'):
            if not isinstance(book.get(key, ''), str) or len(book.get(key, '')) > 30000:
                raise ValueError('Неверное текстовое поле')
        if not book.get('title','').strip() and not book.get('isbn','').strip():
            raise ValueError('Укажите название или ISBN')
        cover = book.get('cover', '')
        if not isinstance(cover, str) or len(cover) > 3000000 or (cover and not cover.startswith(('data:image/jpeg;base64,','data:image/png;base64,','data:image/webp;base64,'))):
            raise ValueError('Неверная обложка')
    return value

def read_state():
    path = DATA / 'library.json'
    seed = ROOT / 'seed.json'
    if not path.exists() and not seed.exists():
        return {'schemaVersion': 1, 'revision': 0, 'books': []}
    return json.loads((path if path.exists() else seed).read_text(encoding='utf-8'))

def backup_files():
    folder = DATA / 'backups'
    return sorted((p for p in folder.glob('*.json') if p.is_file() and not p.is_symlink() and re.fullmatch(r'[A-Za-z0-9_.-]+\.json', p.name)), key=lambda p:p.name, reverse=True)

def backup_path(name):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+\.json', name): return None
    path = DATA / 'backups' / name
    return path if path.is_file() and not path.is_symlink() else None

def archive_state(raw):
    previous = validate(json.loads(raw))
    folder = DATA / 'backups'
    folder.mkdir(exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    name = stamp + '-r' + str(previous.get('revision', 0)) + '-' + uuid.uuid4().hex[:8] + '.json'
    with tempfile.NamedTemporaryFile(dir=folder, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    os.replace(temporary, folder / name)

def write_state(value):
    validate(value)
    DATA.mkdir(parents=True, exist_ok=True)
    path = DATA / 'library.json'
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=DATA, delete=False, suffix='.tmp') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
        temp = Path(stream.name)
    try:
        if path.exists():
            archive_state(path.read_bytes())
            shutil.copy2(path, DATA / 'library.previous.json')
        elif (ROOT / 'seed.json').exists():
            archive_state((ROOT / 'seed.json').read_bytes())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def allowed_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{PORT}', f'localhost:{PORT}')

    def do_GET(self):
        if not self.allowed_host():
            return self.reply(403, {'error':'Недопустимый адрес'})
        route = urlsplit(self.path).path
        if route == '/api/state':
            try:
                with LOCK:
                    self.reply(200, read_state())
            except Exception:
                self.reply(500, {'error':'Не удалось прочитать библиотеку. Файл данных сохранён без изменений.'})
        elif route == '/api/backups':
            with LOCK:
                self.reply(200, {'backups':[{'name':p.name,'size':p.stat().st_size} for p in backup_files()]})
        elif route.startswith('/api/backups/'):
            path = backup_path(route.removeprefix('/api/backups/'))
            if path is None: return self.reply(404, {'error':'Копия не найдена'})
            self.reply(200, json.loads(path.read_text('utf-8')))
        elif route == '/api/health':
            self.reply(200, {'app':'misha-library','version':1})
        elif route in ('/', '/index.html', '/app.js', '/style.css'):
            super().do_GET()
        elif route == '/help':
            self.path = '/help.html'
            super().do_GET()
        else:
            self.reply(404, {'error':'Не найдено'})

    def do_POST(self):
        if not self.allowed_host() or self.headers.get('Origin') not in (f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'):
            return self.reply(403, {'error':'Недопустимый источник запроса'})
        if self.path != '/api/state':
            return self.reply(404, {'error':'Не найдено'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 30 * 1024 * 1024:
                return self.reply(413, {'error':'Файл слишком большой (максимум 30 МБ)'})
            value = validate(json.loads(self.rfile.read(size)))
            with LOCK:
                current = read_state()
                if value.get('revision') != current.get('revision'):
                    return self.reply(409, {'error':'Библиотека изменена в другой вкладке. Сохраните введённый текст отдельно и обновите страницу.'})
                value['revision'] = current['revision'] + 1
                write_state(value)
            self.reply(200, {'revision':value['revision']})
        except (ValueError, TypeError, UnicodeDecodeError):
            self.reply(400, {'error':'Данные не прошли проверку. Проверьте формат, количество и идентификаторы.'})
        except Exception:
            self.reply(500, {'error':'Не удалось сохранить файл. Проверьте свободное место и доступ к папке.'})

if __name__ == '__main__':
    print(f'Библиотека Миши: http://127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
