import json
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app, storage, ORIGIN

class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_data = storage.DATA
        storage.DATA = Path(self.temp.name)
        self.initial = {'schemaVersion':1,'revision':0,'books':[
            {'id':'test','title':'Тестовая книга','isbn':'978-0-06-240452-7','quantity':12,'cover':''}
        ]}
        storage.write_state(self.initial)
        self.client = TestClient(app)
    def tearDown(self):
        self.client.close()
        storage.DATA = self.previous_data
        self.temp.cleanup()
    def post(self,value):
        return self.client.post('/api/state',json=value,headers={'Origin':ORIGIN})
    def test_save_reload_backup_conflict(self):
        state = self.client.get('/api/state').json()
        self.assertEqual(state['books'][0]['quantity'],12)
        state['books'][0]['notes']='Изменено'
        self.assertEqual(self.post(state).status_code,200)
        self.assertEqual(self.post(state).status_code,409)
        self.assertEqual(self.client.get('/api/state').json()['books'][0]['notes'],'Изменено')
        self.assertTrue((storage.DATA/'library.previous.json').exists())
    def test_invalid_cannot_overwrite(self):
        value=json.loads(json.dumps(self.initial))
        value['books'][0]['quantity']=0
        self.assertEqual(self.post(value).status_code,400)
        self.assertEqual(storage.read_state(),self.initial)
        value['books'][0]['quantity']=1
        value['books'][0]['cover']='javascript:alert(1)'
        self.assertEqual(self.post(value).status_code,400)
    def test_origin_and_private_files(self):
        self.assertEqual(self.client.post('/api/state',json=self.initial).status_code,403)
        for url in ('/data/library.json','/seed.json','/server.py','/.env','/docs'):
            self.assertEqual(self.client.get(url).status_code,404)
    def test_static_headers(self):
        for url in ('/','/app.js','/theme.js','/style.css','/favicon.ico','/favicon.svg','/apple-touch-icon.png','/health','/help'):
            response=self.client.get(url)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.headers['X-Frame-Options'],'DENY')
            self.assertIn("default-src 'self'",response.headers['Content-Security-Policy'])

    def test_fonts_are_local_and_cached(self):
        response=self.client.get('/fonts/literata-cyrillic.woff2')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['content-type'],'font/woff2')
        self.assertIn('immutable',response.headers['cache-control'])
        for url in ('/fonts/missing.woff2','/fonts/../library.json','/fonts/theme.js'):
            self.assertNotEqual(self.client.get(url).status_code,200)
        self.assertEqual(self.client.get('/style.css').headers['cache-control'],'no-store')

    def test_index_links_icons_and_theme(self):
        page=self.client.get('/').text
        for marker in ('rel="icon" href="/favicon.svg"','rel="icon" href="/favicon.ico"',
                       'rel="apple-touch-icon"','/theme.js','data-theme="auto"','prefers-color-scheme',
                       'id="page-size"','id="result-count"','id="pagination"'):
            self.assertIn(marker,page)

    def test_help_page(self):
        response=self.client.get('/help')
        self.assertEqual(response.status_code,200)
        self.assertIn('text/html',response.headers['content-type'])
        self.assertIn('Инструкция',response.text)
        self.assertIn('/style.css',response.text)

    def test_pdf_upload_serve_delete(self):
        book=self.client.get('/api/state').json()['books'][0]
        payload=b'%PDF-1.4\n% test file\n'
        response=self.client.post(f"/api/books/{book['id']}/file",content=payload,
                                  headers={'Origin':ORIGIN,'Content-Type':'application/pdf','X-File-Name':'test.pdf'})
        self.assertEqual(response.status_code,200)
        state=self.client.get('/api/state').json()
        self.assertEqual(state['books'][0]['pdf']['name'],'test.pdf')
        self.assertEqual(state['books'][0]['pdf']['size'],len(payload))
        served=self.client.get(f"/api/books/{book['id']}/file")
        self.assertEqual(served.status_code,200)
        self.assertEqual(served.content,payload)
        self.assertEqual(served.headers['content-type'],'application/pdf')
        self.assertIn('inline',served.headers['content-disposition'])
        self.assertEqual(self.client.post(f"/api/books/{book['id']}/file",content=b'not a pdf',
                                          headers={'Origin':ORIGIN}).status_code,400)
        self.assertEqual(self.client.post(f"/api/books/{book['id']}/file",content=payload).status_code,403)
        self.assertEqual(self.client.delete(f"/api/books/{book['id']}/file").status_code,403)
        self.assertEqual(self.client.delete(f"/api/books/{book['id']}/file",headers={'Origin':ORIGIN}).status_code,200)
        state=self.client.get('/api/state').json()
        self.assertNotIn('pdf',state['books'][0])
        self.assertEqual(self.client.get(f"/api/books/{book['id']}/file").status_code,404)

    def test_archive_download_and_restore(self):
        original=self.client.get('/api/state').json()
        changed=json.loads(json.dumps(original))
        changed['books'][0]['title']='Changed'
        self.assertEqual(self.post(changed).status_code,200)
        entries=self.client.get('/api/backups').json()['backups']
        copies=[self.client.get('/api/backups/'+b['name']).json() for b in entries]
        saved=next(v for v in copies if v==original)
        saved['revision']=self.client.get('/api/state').json()['revision']
        self.assertEqual(self.post(saved).status_code,200)
        self.assertEqual(self.client.get('/api/state').json()['books'],original['books'])
        self.assertGreater(len(self.client.get('/api/backups').json()['backups']),len(entries))
        self.assertEqual(self.client.get('/api/backups/missing.json').status_code,404)
        self.assertIsNone(storage.backup_path('../library.json'))

    def test_backup_failure_prevents_save(self):
        from unittest.mock import patch
        value=self.client.get('/api/state').json()
        value['books'][0]['title']='Must not save'
        with patch.object(storage,'archive_state',side_effect=OSError('Disk full')):
            self.assertEqual(self.post(value).status_code,500)
        self.assertEqual(storage.read_state(),self.initial)

if __name__=='__main__': unittest.main()
