'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fold = value => String(value || '').toLocaleLowerCase('ru').replace(/ё/g,'е');
const normalizeISBN = value => String(value || '').replace(/[\s\-–—]/g,'').replace(/х/ig,'X').toUpperCase();
const isbnParts = value => String(value || '').split(/[\/;,\n]+/).map(normalizeISBN).filter(Boolean);
function validISBN(value) {
  const s = normalizeISBN(value);
  if (/^\d{9}[\dX]$/.test(s)) return [...s].reduce((sum,c,i)=>sum+(c==='X'?10:Number(c))*(10-i),0)%11===0;
  return /^\d{13}$/.test(s) && [...s].reduce((sum,c,i)=>sum+Number(c)*(i%2?3:1),0)%10===0;
}
let state = null, tab = 'all', view = 'grid', page = 1, selectedId = null, draftCover = '', initialForm = '', busy = false, coverBusy = false;
const PAGE_SIZE = 36;
const fields = ['title','author','isbn','publisher','year','series','pages','illustrator','category','quantity','status','reading','notes'];
const form = $('book-form');
const formField = key => form.elements.namedItem(key);
function message(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(message.timer); message.timer=setTimeout(()=>$('toast').hidden=true,4500); }
function confirmation(text, label='Продолжить') {
  return new Promise(resolve=>{
    const dialog=$('confirm-dialog'); $('confirm-text').textContent=text; $('confirm-yes').textContent=label;
    const finish=value=>{dialog.close();$('confirm-yes').onclick=null;$('confirm-no').onclick=null;dialog.oncancel=null;resolve(value);};
    $('confirm-yes').onclick=()=>finish(true);$('confirm-no').onclick=()=>finish(false);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.showModal();$('confirm-no').focus();
  });
}
function currentForm() {return JSON.stringify([...fields.map(k=>formField(k).value),formField('favorite').checked,formField('review').checked,draftCover]);}
async function closeDialog() {
  if(busy || coverBusy)return;
  if(!form.hidden && currentForm()!==initialForm && !await confirmation('Закрыть карточку без сохранения введённых изменений?','Закрыть'))return;
  $('book-dialog').close();
}
function coverHTML(book) {
  if(book.cover && /^data:image\/(jpeg|png|webp);base64,/.test(book.cover))return `<div class="cover"><img loading="lazy" src="${escapeHtml(book.cover)}" alt="Обложка: ${escapeHtml(book.title || book.isbn)}"></div>`;
  const initials=(book.author || book.title || 'ISBN').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  return `<div class="cover"><div class="placeholder">${escapeHtml(initials)}<small>Обложка не добавлена</small></div></div>`;
}
function badges(book) {return `<div class="badges">${book.review?'<span class="badge amber">Нужно уточнить</span>':''}${book.quantity>1?`<span class="badge">${book.quantity} экз.</span>`:''}${book.reading && book.reading!=='Не читали'?`<span class="badge">${escapeHtml(book.reading)}</span>`:''}${book.category?`<span class="badge">${escapeHtml(book.category)}</span>`:''}</div>`;}
function filteredBooks() {
  if(!state)return [];
  const query=fold($('search').value.trim()), isbnQuery=normalizeISBN(query), category=$('category').value, reading=$('reading').value;
  return state.books.filter(book=>{
    if(tab==='shelf' && book.status!=='Есть на полке')return false;
    if(tab==='review' && !book.review)return false;
    if(tab==='favorite' && !book.favorite)return false;
    if(category && book.category!==category)return false;
    if(reading && (book.reading || 'Не читали')!==reading)return false;
    return !query || fold([book.title,book.author,book.isbn,book.publisher,book.illustrator,book.series,book.notes].join(' ')).includes(query) || (isbnQuery.length>3 && normalizeISBN(book.isbn).includes(isbnQuery));
  }).sort((a,b)=>{
    if($('sort').value==='recent')return String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')) || a.title.localeCompare(b.title,'ru');
    const key=$('sort').value==='author'?'author':'title';return String(a[key]).localeCompare(String(b[key]),'ru',{numeric:true}) || String(a.title).localeCompare(String(b.title),'ru');
  });
}
function updateCategories() {
  const previous=$('category').value;
  const categories=[...new Set(state.books.map(b=>b.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('category').innerHTML='<option value="">Все категории</option>'+categories.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
  $('category').value=categories.includes(previous)?previous:'';
  $('categories').innerHTML=categories.map(x=>`<option value="${escapeHtml(x)}"></option>`).join('');
}
function render() {
  if(!state)return;
  $('total').textContent=state.books.length;$('review-count').textContent=state.books.filter(b=>b.review).length;$('favorite-count').textContent=state.books.filter(b=>b.favorite).length;
  const all=filteredBooks(), pages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));page=Math.min(page,pages);
  const books=all.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  $('result-count').textContent=`Найдено: ${all.length} · ${books.length?`${(page-1)*PAGE_SIZE+1}–${(page-1)*PAGE_SIZE+books.length}`:'0'} из ${all.length}`;
  $('results').className=view==='grid'?'grid':'table-wrap';
  if(!all.length){$('results').innerHTML='<div class="empty"><h2>Здесь пока нет книг</h2><p>Попробуйте другой запрос или сбросьте фильтры.</p><button id="reset-filters">Сбросить фильтры</button></div>';}
  else if(view==='grid')$('results').innerHTML=books.map(book=>`<button class="book" data-open="${escapeHtml(book.id)}">${coverHTML(book)}${book.favorite?'<span class="star" aria-label="Любимая">♥</span>':''}<div class="book-copy"><h3>${escapeHtml(book.title || 'Книга по ISBN')}</h3><div class="author">${escapeHtml(book.author || book.isbn || 'Автор не указан')}</div>${badges(book)}</div></button>`).join('');
  else $('results').innerHTML=`<table><thead><tr><th>Название</th><th>Автор</th><th>ISBN</th><th>Экз.</th><th>Статус</th></tr></thead><tbody>${books.map(book=>`<tr><td><button data-open="${escapeHtml(book.id)}">${book.favorite?'♥ ':''}${escapeHtml(book.title || 'Книга по ISBN')}</button></td><td>${escapeHtml(book.author || '—')}</td><td>${escapeHtml(book.isbn || '—')}</td><td>${book.quantity}</td><td>${escapeHtml(book.review?'Нужно уточнить':book.status)}</td></tr>`).join('')}</tbody></table>`;
  $('pagination').innerHTML=pages>1?`<button data-page="${page-1}" ${page===1?'disabled':''}>← Назад</button><span>${page} / ${pages}</span><button data-page="${page+1}" ${page===pages?'disabled':''}>Далее →</button>`:'';
}
function bookById(id){return state.books.find(b=>b.id===id);}
function showBook(id) {
  const book=bookById(id);if(!book)return;selectedId=id;form.hidden=true;$('detail').hidden=false;$('dialog-title').textContent='Карточка книги';
  const metadata=[['ISBN',book.isbn],['Издательство',book.publisher],['Год',book.year],['Иллюстратор',book.illustrator],['Серия',book.series],['Страниц',book.pages],['Физических книг',book.quantity],['Наличие',book.status],['Чтение',book.reading||'Не читали'],['Источник описания',book.confidence]];
  $('detail').innerHTML=`<div class="detail-layout">${coverHTML(book)}<div><h3 class="detail-title">${escapeHtml(book.title || 'Книга по ISBN')}</h3><p>${escapeHtml(book.author || 'Автор не указан')}</p>${badges(book)}<dl class="metadata">${metadata.map(([k,v])=>`<div><dt>${k}</dt><dd>${escapeHtml(v || 'Не указано')}</dd></div>`).join('')}</dl></div></div>${book.notes?`<h3>Заметки</h3><div class="notes">${escapeHtml(book.notes)}</div>`:''}<div class="form-actions"><button class="danger" id="delete-book">Удалить запись</button><button id="toggle-favorite">${book.favorite?'Убрать из любимых':'♡ В любимые'}</button><button class="primary" id="edit-book">Редактировать</button></div>`;
  if(!$('book-dialog').open)$('book-dialog').showModal();
  $('edit-book').onclick=()=>editBook(book);$('delete-book').onclick=()=>deleteBook(book);$('toggle-favorite').onclick=async()=>{if(await saveBooks(state.books.map(b=>b.id===id?{...b,favorite:!b.favorite,updatedAt:new Date().toISOString()}:b)))showBook(id);};
}
function editBook(book=null) {
  if(busy || coverBusy)return;selectedId=book?.id || null;form.reset();formField('id').value=selectedId || '';draftCover=book?.cover || '';$('cover-input').value='';
  for(const key of fields){const value=book?.[key] ?? (key==='quantity'?1:key==='status'?'Есть на полке':key==='reading'?'Не читали':'');const input=formField(key);if(input.tagName==='SELECT' && ![...input.options].some(o=>o.value===String(value)))input.add(new Option(String(value),String(value)));input.value=value;}
  formField('favorite').checked=!!book?.favorite;formField('review').checked=!!book?.review;
  $('dialog-title').textContent=book?'Редактирование книги':'Новая книга';$('detail').hidden=true;form.hidden=false;$('form-error').textContent='';updateCoverPreview();updateISBHint();initialForm=currentForm();
  if(!$('book-dialog').open)$('book-dialog').showModal();formField('title').focus();
}
function updateCoverPreview() {$('cover-preview').hidden=!draftCover;$('remove-cover').hidden=!draftCover;if(draftCover)$('cover-preview').src=draftCover;else $('cover-preview').removeAttribute('src');}
function updateISBHint() {
  const input=formField('isbn').value, parts=isbnParts(input), invalid=parts.filter(x=>!validISBN(x));
  $('isbn-hint').textContent=invalid.length?'В номере есть ошибка формата или контрольной суммы. Можно сохранить для уточнения.':'';
  const duplicates=state.books.filter(b=>b.id!==selectedId && isbnParts(b.isbn).some(x=>parts.includes(x)));
  $('duplicates').hidden=!duplicates.length;$('duplicates').textContent=duplicates.length?`Этот ISBN уже есть: ${duplicates.map(b=>`${b.title || b.isbn} (${b.quantity} экз.)`).join('; ')}. Если это ещё один экземпляр, измените количество в существующей карточке.`:'';
  return {invalid,duplicates};
}
async function saveBooks(books) {
  if(busy)return false;busy=true;
  const controls=[...document.querySelectorAll('button,input,select,textarea')].map(element=>({element,disabled:element.disabled}));
  controls.forEach(({element})=>element.disabled=true);
  try{
    const response=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state,books})});
    const result=await response.json();if(!response.ok)throw new Error(result.error || 'Не удалось сохранить');
    state={...state,books,revision:result.revision};updateCategories();render();$('connection').className='notice success';$('connection').textContent='Сохранено · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});message('Изменения сохранены');return true;
  }catch(error){$('form-error').textContent=error.message;$('connection').className='notice';$('connection').textContent=error.message;message('Изменения не сохранены');return false;}
  finally{busy=false;controls.forEach(({element,disabled})=>element.disabled=disabled);}
}
async function deleteBook(book) {
  if(!await confirmation(`Удалить «${book.title || book.isbn}» из рабочего каталога? Исходный каталог останется без изменений.`,'Удалить'))return;
  if(await saveBooks(state.books.filter(b=>b.id!==book.id)))$('book-dialog').close();
}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy || coverBusy)return;$('form-error').textContent='';
  const values=Object.fromEntries(fields.map(k=>[k,formField(k).value.trim()]));values.quantity=Number(values.quantity);
  if(!values.title && !values.isbn){$('form-error').textContent='Укажите название или ISBN.';return;}
  if(!Number.isInteger(values.quantity) || values.quantity<1 || values.quantity>999){$('form-error').textContent='Количество должно быть целым числом от 1 до 999.';return;}
  const {invalid,duplicates}=updateISBHint();
  if(duplicates.length && !await confirmation('Такой ISBN уже записан. Сохранить отдельную запись? Если куплен второй экземпляр, лучше увеличить количество в существующей карточке.','Сохранить отдельно'))return;
  const existing=selectedId?bookById(selectedId):null;
  const book={...existing,...values,id:existing?.id || crypto.randomUUID(),favorite:formField('favorite').checked,review:formField('review').checked || invalid.length>0,cover:draftCover,confidence:existing?.confidence || 'Добавлено вручную',updatedAt:new Date().toISOString()};
  const next=existing?state.books.map(b=>b.id===book.id?book:b):[...state.books,book];
  if(await saveBooks(next)){initialForm=currentForm();showBook(book.id);}
});
$('cover-input').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){$('form-error').textContent='Выберите JPG, PNG или WebP размером до 10 МБ.';event.target.value='';return;}
  coverBusy=true;$('save-book').disabled=true;$('cover-input').disabled=true;
  try{const bitmap=await createImageBitmap(file);const ratio=Math.min(1,900/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);draftCover=canvas.toDataURL('image/jpeg',.85);bitmap.close();updateCoverPreview();$('form-error').textContent='';}
  catch{$('form-error').textContent='Не удалось прочитать изображение. Выберите другой файл.';}finally{coverBusy=false;$('save-book').disabled=false;$('cover-input').disabled=false;}
});
$('remove-cover').onclick=()=>{draftCover='';$('cover-input').value='';updateCoverPreview();};
formField('isbn').addEventListener('input',updateISBHint);
$('close-dialog').onclick=closeDialog;$('cancel-edit').onclick=closeDialog;$('book-dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
$('add').onclick=()=>state && editBook();
$('search').addEventListener('input',()=>{page=1;render();});
for(const id of ['category','reading','sort'])$(id).addEventListener('change',()=>{page=1;render();});
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;page=1;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});render();});
for(const type of ['grid','table'])$(type+'-view').onclick=()=>{view=type;for(const other of ['grid','table']){$(other+'-view').classList.toggle('selected',other===type);$(other+'-view').setAttribute('aria-pressed',String(other===type));}render();};
$('results').onclick=event=>{const button=event.target.closest('[data-open]');if(button)showBook(button.dataset.open);if(event.target.closest('#reset-filters')){$('search').value='';$('category').value='';$('reading').value='';tab='all';page=1;document.querySelector('[data-tab="all"]').click();}};
$('pagination').onclick=event=>{const button=event.target.closest('[data-page]');if(button&&!button.disabled){page=Number(button.dataset.page);render();$('results').scrollIntoView({block:'start',behavior:'instant'});}};
// TRANSFER_CORE_START
const transferFields=['title','author','isbn','publisher','year','series','pages','illustrator','quantity','category','notes','status','reading','review','favorite','confidence','alternate_isbn','isbn10','language','contents'];
function aiExport(current) {
 return {format:'misha-library-edit-v1',baseRevision:current.revision,exportedAt:new Date().toISOString(),
 instructions:'Редактируйте books. Сохраняйте id существующих книг. Для новой книги уберите id. quantity — физические экземпляры: не суммировать при уточнении. Отсутствующее поле сохраняется; пустая строка явно очищает поле. Не выдумывайте метаданные. review=true для сомнений. Не меняйте format/baseRevision. Отсутствующие книги не удаляются. Обложки и история сохраняются на сайте.',
 books:current.books.map(b=>Object.fromEntries(['id',...transferFields].filter(k=>b[k]!==undefined).map(k=>[k,b[k]])))};
}
function planTransfer(current, input, replace=false) {
 const full=input?.schemaVersion===1 && Array.isArray(input.books);
 const ai=input?.format==='misha-library-edit-v1';
 const incoming=Array.isArray(input)?input:input?.books;
 if(!Array.isArray(incoming)||(!Array.isArray(input)&&!full&&!ai))throw Error('Нужен массив книг, полная копия или файл «Для ИИ».');
 if(ai && input.baseRevision!==current.revision)throw Error('После выгрузки каталог изменился. Скачайте свежий файл для ИИ и перенесите правки в него.');
 if(replace&&!full)throw Error('Полное восстановление доступно только для полной копии.');
 const next=new Map(current.books.map(b=>[b.id,b])), seen=new Set(), changes=[];
 const fieldsAllowed=new Set(['id',...transferFields]);
 for(const raw of incoming){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Каждая книга должна быть объектом.');
  if(Object.keys(raw).some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('Недопустимое поле.');
  if(!full && Object.keys(raw).some(k=>!fieldsAllowed.has(k)))throw Error('Неизвестное поле в файле для редактирования. Используйте поля из выгрузки «Для ИИ».');
  if(raw.id!==undefined && (typeof raw.id!=='string'||!raw.id))throw Error('Некорректный id книги.');
  if(full&&!raw.id)throw Error('В полной копии у каждой книги должен быть id.');
  const id=raw.id||crypto.randomUUID();
  if(seen.has(id))throw Error('Повтор id в файле: '+id);seen.add(id);
  const old=next.get(id);
  const defaults={title:'',author:'',isbn:'',quantity:1,status:'Есть на полке',reading:'Не читали',review:true,favorite:false,cover:''};
  const book=full&&replace?{...raw}:{...defaults,...old,...raw,id};
  for(const k of transferFields){
   if(book[k]===undefined)continue;
   if(k==='quantity'){if(!Number.isInteger(book[k])||book[k]<1||book[k]>999)throw Error('Количество должно быть целым числом от 1 до 999.');}
   else if(['review','favorite'].includes(k)){if(typeof book[k]!=='boolean')throw Error(k+' должно быть true или false.');}
   else if(k==='contents'){if(!Array.isArray(book[k])||book[k].some(v=>typeof v!=='string'))throw Error('contents должен быть массивом строк.');}
   else if(typeof book[k]!=='string')throw Error(k+' должно быть строкой (числа года и страниц — в кавычках).');
  }
  if(!book.title?.trim()&&!book.isbn?.trim())throw Error('У книги должно быть название или ISBN.');
  if(!old || normalizeISBN(old.isbn)!==normalizeISBN(book.isbn)){
   const same=[...next.values()].filter(b=>b.id!==id).find(b=>(book.isbn && isbnParts([b.isbn,b.alternate_isbn,b.isbn10].filter(Boolean).join('/')).some(x=>isbnParts(book.isbn).includes(x))) || (book.title && fold(book.title.trim())===fold((b.title||'').trim())));
   if(same)throw Error('Возможный дубль «'+(same.title||same.isbn)+'». Для обновления используйте его id: '+same.id);
  }
  const changed=[...new Set([...Object.keys(book),...Object.keys(old||{})])].filter(k=>k!=='updatedAt' && JSON.stringify(book[k])!==JSON.stringify(old?.[k]));
  if(changed.length){changes.push({id,title:book.title||book.isbn,kind:old?'Обновление':'Добавление',fields:changed.map(k=>({key:k,before:old?.[k],after:book[k]}))});book.updatedAt=new Date().toISOString();}
  next.set(id,book);
 }
 const missing=current.books.filter(b=>!seen.has(b.id));
 if(replace)for(const b of missing){next.delete(b.id);changes.push({id:b.id,title:b.title||b.isbn,kind:'Удаление при восстановлении',fields:[]});}
 return {books:[...next.values()],changes,kept:replace?0:missing.length,full};
}
// TRANSFER_CORE_END


function downloadJSON(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function freshState(){const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw Error('Не удалось получить свежий каталог');state=await response.json();updateCategories();render();return state;}
$('export').onclick=async()=>{try{downloadJSON({...await freshState(),exportedAt:new Date().toISOString()},'misha-full-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');}catch(e){message(e.message);}};
$('ai-export').onclick=async()=>{try{downloadJSON(aiExport(await freshState()),'misha-for-ai-'+new Date().toISOString().slice(0,10)+'.json');}catch(e){message(e.message);}};
let pendingTransfer=null, transferPlan=null;
function previewTransfer(){
 try{
  transferPlan=planTransfer(state,pendingTransfer,$('restore-exact').checked);
  $('transfer-summary').textContent=transferPlan.changes.length+' изменённых карточек. Сохранено вне файла: '+transferPlan.kept+'. Перед записью сервер сохранит текущую версию.';
  const short=value=>value===undefined?'(не было)':typeof value==='string'&&value.startsWith('data:image/')?'[Обложка]':JSON.stringify(value);
  $('transfer-details').innerHTML=transferPlan.changes.map(c=>'<details><summary>'+escapeHtml(c.kind+': '+c.title)+'</summary>'+c.fields.map(f=>'<p><strong>'+escapeHtml(f.key)+'</strong><br>Было: '+escapeHtml(short(f.before))+'<br>Станет: '+escapeHtml(short(f.after))+'</p>').join('')+'</details>').join('');
  $('apply-transfer').disabled=!transferPlan.changes.length;
 }catch(e){transferPlan=null;$('transfer-summary').textContent=e.message;$('transfer-details').textContent='';$('apply-transfer').disabled=true;}
}
$('import').onclick=()=>state && $('import-input').click();
$('import-input').onchange=async event=>{
 const file=event.target.files[0];event.target.value='';if(!file)return;
 try{if(file.size>30*1024*1024)throw Error('Файл больше 30 МБ.');pendingTransfer=JSON.parse(await file.text());await freshState();$('restore-exact').checked=false;$('restore-option').hidden=!(pendingTransfer?.schemaVersion===1);previewTransfer();$('transfer-dialog').showModal();}catch(e){message(e.message);}
};
$('restore-exact').onchange=previewTransfer;
$('cancel-transfer').onclick=()=>$('transfer-dialog').close();
$('apply-transfer').onclick=async()=>{
 if(!transferPlan||busy)return;
 if(!await confirmation('Применить '+transferPlan.changes.length+' изменений? '+($('restore-exact').checked?'Полное восстановление удалит записи, отсутствующие в копии.':'Книги, отсутствующие в файле, останутся.'),'Применить'))return;
 if(await saveBooks(transferPlan.books))$('transfer-dialog').close();
};
$('backups').onclick=async()=>{
 $('backup-dialog').showModal();$('backup-list').textContent='Загружаем список…';
 try{const response=await fetch('/api/backups',{cache:'no-store'});if(!response.ok)throw Error('Список копий недоступен. Полную копию можно скачать кнопкой вверху.');
 const value=await response.json();$('backup-list').innerHTML=value.backups.length?value.backups.map(b=>'<p><a href="/api/backups/'+encodeURIComponent(b.name)+'" download>'+escapeHtml(b.name)+'</a> · '+Math.ceil(b.size/1024)+' КБ</p>').join(''):'История появится после следующего сохранения. Скачайте полную копию сейчас.';
 }catch(e){$('backup-list').textContent=e.message;}
};
$('close-backups').onclick=()=>$('backup-dialog').close();

async function start(){
  for(const id of ['add','export','import','ai-export'])$(id).disabled=true;
  try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('Библиотека недоступна');state=await response.json();if(state.schemaVersion!==1 || !Array.isArray(state.books))throw new Error('Неверный формат библиотеки');updateCategories();render();$('connection').className='notice success';$('connection').textContent='Библиотека открыта · изменения сохраняются автоматически';for(const id of ['add','export','import','ai-export'])$(id).disabled=false;}
  catch{$('connection').textContent='Не удалось открыть библиотеку. Обновите страницу; если ошибка остаётся, проверьте соединение или запуск сервера.';}
}
start();
