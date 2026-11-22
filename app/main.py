"""Server deployment; access policy is configured at the reverse proxy."""
import datetime
import json
import os
import re
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from prototype import server as storage

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = os.environ.get('PUBLIC_ORIGIN', 'http://127.0.0.1:8769').rstrip('/')
FILE_LIMIT = 80 * 1024 * 1024
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

def files_dir():
    folder = storage.DATA / 'files'
    folder.mkdir(parents=True, exist_ok=True)
    return folder

def book_by_id(book_id):
    state = storage.read_state()
    for book in state.get('books', []):
        if book.get('id') == book_id:
            return state, book
    return state, None

def safe_name(book):
    name = (book.get('pdf') or {}).get('name') or (book.get('title') or 'kniga') + '.pdf'
    name = re.sub(r'[\\/:*?"<>|\r\n]+', ' ', name).strip() or 'kniga.pdf'
    return name if name.lower().endswith('.pdf') else name + '.pdf'

@app.middleware('http')
async def secure_headers(request: Request, call_next):
    if request.method not in ('GET','HEAD','OPTIONS') and request.headers.get('origin') != ORIGIN:
        return JSONResponse({'error':'Недопустимый источник запроса'}, status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'same-origin'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    response.headers['Cache-Control'] = 'no-store'
    return response

@app.get('/health')
@app.get('/api/health')
def health():
    return {'app':'misha-library','version':3,'commit':os.environ.get('APP_COMMIT','unknown')}

@app.get('/')
@app.get('/index.html')
def index(): return FileResponse(ROOT / 'prototype' / 'index.html')

@app.get('/help')
def help_page(): return FileResponse(ROOT / 'prototype' / 'help.html')

@app.get('/app.js')
def script(): return FileResponse(ROOT / 'prototype' / 'app.js', media_type='text/javascript')

@app.get('/style.css')
def styles(): return FileResponse(ROOT / 'prototype' / 'style.css', media_type='text/css')

@app.get('/api/backups')
def backups():
    with storage.LOCK:
        return {'backups':[{'name':p.name,'size':p.stat().st_size} for p in storage.backup_files()]}

@app.get('/api/backups/{name}')
def download_backup(name: str):
    path = storage.backup_path(name)
    if path is None: return JSONResponse({'error':'Копия не найдена'},status_code=404)
    return FileResponse(path,media_type='application/json',filename=name)

@app.get('/api/state')
def get_state():
    try:
        with storage.LOCK: return storage.read_state()
    except Exception:
        return JSONResponse({'error':'Не удалось прочитать библиотеку.'}, status_code=500)

@app.post('/api/state')
async def update_state(request: Request):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 30 * 1024 * 1024:
            return JSONResponse({'error':'Копия больше 30 МБ'}, status_code=413)
        chunks.append(chunk)
    try:
        value = storage.validate(json.loads(b''.join(chunks)))
        with storage.LOCK:
            current = storage.read_state()
            if value.get('revision') != current.get('revision'):
                return JSONResponse({'error':'Библиотека изменена в другой вкладке. Скопируйте введённый текст и обновите страницу.'}, status_code=409)
            value['revision'] = current['revision'] + 1
            storage.write_state(value)
        return {'revision':value['revision']}
    except (ValueError, TypeError, UnicodeDecodeError):
        return JSONResponse({'error':'Некорректные данные библиотеки'}, status_code=400)
    except Exception:
        return JSONResponse({'error':'Сохранение не удалось. Изменения не подтверждены.'}, status_code=500)

@app.post('/api/books/{book_id}/file')
async def upload_book_file(book_id: str, request: Request):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', book_id):
        return JSONResponse({'error':'Некорректный идентификатор книги'}, status_code=400)
    state, book = book_by_id(book_id)
    if book is None:
        return JSONResponse({'error':'Книга не найдена'}, status_code=404)
    from urllib.parse import unquote
    original = unquote(request.headers.get('x-file-name', '') or '').strip()
    folder = files_dir()
    temporary = folder / (book_id + '.part')
    size = 0
    try:
        with temporary.open('wb') as stream:
            async for chunk in request.stream():
                size += len(chunk)
                if size > FILE_LIMIT:
                    stream.close()
                    temporary.unlink(missing_ok=True)
                    return JSONResponse({'error':'PDF больше 80 МБ'}, status_code=413)
                stream.write(chunk)
        with temporary.open('rb') as stream:
            head = stream.read(5)
        if head != b'%PDF-':
            temporary.unlink(missing_ok=True)
            return JSONResponse({'error':'Это не PDF-файл'}, status_code=400)
        os.replace(temporary, folder / (book_id + '.pdf'))
    except Exception:
        temporary.unlink(missing_ok=True)
        return JSONResponse({'error':'Не удалось сохранить файл'}, status_code=500)
    with storage.LOCK:
        state = storage.read_state()
        book = next((b for b in state.get('books', []) if b.get('id') == book_id), None)
        if book is None:
            (folder / (book_id + '.pdf')).unlink(missing_ok=True)
            return JSONResponse({'error':'Книга не найдена'}, status_code=404)
        book['pdf'] = {
            'name': original or safe_name(book),
            'size': size,
            'uploadedAt': datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z'),
        }
        state['revision'] = state.get('revision', 0) + 1
        storage.write_state(state)
    return {'revision': state['revision'], 'pdf': book['pdf']}

@app.get('/api/books/{book_id}/file')
def get_book_file(book_id: str, download: int = 0):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', book_id):
        return JSONResponse({'error':'Некорректный идентификатор книги'}, status_code=400)
    state, book = book_by_id(book_id)
    if book is None:
        return JSONResponse({'error':'Книга не найдена'}, status_code=404)
    path = storage.DATA / 'files' / (book_id + '.pdf')
    if not path.is_file():
        return JSONResponse({'error':'PDF не прикреплён'}, status_code=404)
    return FileResponse(path, media_type='application/pdf', filename=safe_name(book),
                        content_disposition_type='attachment' if download else 'inline')

@app.delete('/api/books/{book_id}/file')
def delete_book_file(book_id: str):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', book_id):
        return JSONResponse({'error':'Некорректный идентификатор книги'}, status_code=400)
    path = storage.DATA / 'files' / (book_id + '.pdf')
    path.unlink(missing_ok=True)
    with storage.LOCK:
        state = storage.read_state()
        book = next((b for b in state.get('books', []) if b.get('id') == book_id), None)
        if book is None:
            return JSONResponse({'error':'Книга не найдена'}, status_code=404)
        if 'pdf' in book:
            del book['pdf']
            state['revision'] = state.get('revision', 0) + 1
            storage.write_state(state)
    return {'revision': state.get('revision', 0)}
