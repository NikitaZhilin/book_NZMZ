import json, shutil, subprocess, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class TransferTests(unittest.TestCase):
 def test_transfer_rules(self):
  node=shutil.which('node')
  if not node:
   node=json.loads((ROOT/'.local/runtime.json').read_text('utf-8'))['node']
  source=(ROOT/'prototype/app.js').read_text('utf-8').split('// TRANSFER_CORE_START')[1].split('// TRANSFER_CORE_END')[0]
  checks=r"""
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const normalizeISBN=s=>String(s||'').replace(/[^0-9X]/g,'');
const fold=s=>String(s||'').toLowerCase();
const isbnParts=s=>String(s||'').split('/').map(s=>s.replace(/[^0-9X]/g,'')).filter(Boolean);
const current={revision:4,books:[{id:'one',title:'First',isbn:'123',quantity:12,cover:'data:image/jpeg;base64,abc',sourceRaw:{important:true}},{id:'two',title:'Second',isbn:'456',quantity:2}]};
const exported=aiExport(current);
assert.equal(exported.books.length,2);assert.equal(exported.books[0].cover,undefined);
const p=planTransfer(current,{...exported,books:[{id:'one',title:'Changed'}]});
assert.equal(p.books.length,2);assert.equal(p.books[0].quantity,12);assert.equal(p.books[0].cover,current.books[0].cover);assert.deepEqual(p.books[0].sourceRaw,{important:true});
assert.equal(current.books[0].title,'First');
assert.throws(()=>planTransfer(current,{...exported,baseRevision:3}));
assert.throws(()=>planTransfer(current,[{id:'one',quantity:0}]));
assert.throws(()=>planTransfer(current,[{id:'one',title:null}]));
assert.throws(()=>planTransfer(current,[{id:'one'},{id:'one'}]));
assert.throws(()=>planTransfer(current,[{title:'First',quantity:1}]));
assert.throws(()=>planTransfer(current,[{id:'new',title:'New edition',isbn:'123',quantity:1}]));
assert.equal(planTransfer(current,[{title:'New',quantity:1}]).books.length,3);
assert.equal(planTransfer(current,[]).books.length,2);
const restore=planTransfer(current,{schemaVersion:1,books:[current.books[0]]},true);
assert.equal(restore.books.length,1);assert.equal(restore.changes.at(-1).kind,'Удаление при восстановлении');
const csv=tableExport({books:[{id:'x',title:'=SUM(1;2)',isbn:'9780062404527',notes:'First "quote";\nSecond',quantity:12}]});
assert.ok(csv.startsWith('\uFEFFsep=;\r\n'));
assert.ok(csv.includes("\"'9780062404527\""));
assert.ok(csv.includes("\"'=SUM(1;2)\""));
assert.ok(csv.includes('""quote""'));
assert.ok(csv.includes('"12"'));
console.log('Transfer preservation, conflicts, duplicates and restore: OK');
"""
  result=subprocess.run([node,'-e',source+'\n'+checks],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
  self.assertEqual(result.returncode,0,result.stderr)
