"""Server deployment; access policy is configured at the reverse proxy."""
import json
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from prototype import server as storage

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = os.environ.get('PUBLIC_ORIGIN', 'http://127.0.0.1:8769').rstrip('/')
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

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
    return {'app':'misha-library','version':2,'commit':os.environ.get('APP_COMMIT','unknown')}

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
