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
let state = null, tab = 'all', view = 'grid', shown = 0, selectedId = null, draftCover = '', initialForm = '', busy = false, coverBusy = false;
const PAGE_SIZES = [10, 50, 100];
const PAGE_SIZE_KEY = 'misha-page-size';
const defaultPageSize = () => window.matchMedia('(max-width:560px)').matches ? 10 : 50;
let pageSize = defaultPageSize();
try {
  const saved = localStorage.getItem(PAGE_SIZE_KEY);
  if (saved === 'all') pageSize = 'all';
  else if (PAGE_SIZES.includes(Number(saved))) pageSize = Number(saved);
} catch (error) {}
const resetShown = () => { shown = pageSize === 'all' ? Infinity : pageSize; };
resetShown();
const AUTO_LOAD_KEY = 'misha-autoload';
let autoLoad = true;
try { const savedAuto = localStorage.getItem(AUTO_LOAD_KEY); if (savedAuto !== null) autoLoad = savedAuto !== '0'; } catch (error) {}
const fields = ['title','author','isbn','publisher','year','series','pages','illustrator','category','quantity','status','reading','notes'];
const form = $('book-form');
const formField = key => form.elements.namedItem(key);
function message(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(message.timer); message.timer=setTimeout(()=>$('toast').hidden=true,4500); }
function setStatus(state,text) { const node=$('connection'); node.dataset.state=state; node.textContent=text; node.title=text; }
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
function spineFor(value) {
  const text=String(value || '');
  let hash=0;
  for(let index=0;index<text.length;index+=1)hash=(hash*33+text.charCodeAt(index))>>>0;
  return (hash%6)+1;
}
function coverHTML(book) {
  if(book.cover && /^data:image\/(jpeg|png|webp);base64,/.test(book.cover))return `<span class="book-cover"><img loading="lazy" src="${escapeHtml(book.cover)}" alt="Обложка: ${escapeHtml(book.title || book.isbn)}"></span>`;
  const initials=(book.author || book.title || 'ISBN').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  return `<span class="book-cover"><span class="placeholder">${escapeHtml(initials)}<small>обложки нет</small></span></span>`;
}
function badges(book) {
  const parts=[];
  if(book.pdf)parts.push('<span class="tag">PDF</span>');
  if(book.review)parts.push('<span class="tag warn">Уточнить</span>');
  if(book.quantity>1)parts.push(`<span>${book.quantity} экз.</span>`);
  if(book.reading && book.reading!=='Не читали')parts.push(`<span>${escapeHtml(book.reading)}</span>`);
  if(book.category)parts.push(`<span>${escapeHtml(book.category)}</span>`);
  return `<span class="book-meta">${parts.join('')}</span>`;
}
const heartMark='<span class="book-mark" aria-label="Любимая книга"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16.4S3.4 12.3 3.4 7.9a3.6 3.6 0 0 1 6.6-2 3.6 3.6 0 0 1 6.6 2c0 4.4-6.6 8.5-6.6 8.5z"/></svg></span>';
const fileSize = bytes => bytes ? (bytes/1048576).toFixed(1).replace('.0','')+' МБ' : '';
function pdfLinks(book) {
  if(!book.pdf)return '';
  const id=encodeURIComponent(book.id);
  return `<div class="pdf-links"><a class="link-button" href="/api/books/${id}/file" target="_blank" rel="noopener">Читать PDF</a><a class="link-button" href="/api/books/${id}/file?download=1">Скачать</a><span class="muted">${escapeHtml(fileSize(book.pdf.size))}</span></div>`;
}
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
  const all=filteredBooks();
  const limit=pageSize==='all'?all.length:Math.min(shown||pageSize,all.length);
  const books=all.slice(0,limit);
  const remaining=all.length-limit;
  $('result-count').innerHTML=!all.length?'Ничего не найдено':remaining>0?`Найдено ${all.length}<span class="count-range"> · показаны 1–${limit}</span>`:`Найдено ${all.length}`;
  $('results').className=view==='grid'?'grid':'table-wrap';
  if(!all.length){$('results').innerHTML='<div class="empty"><h2>Здесь пока нет книг</h2><p>Попробуйте другой запрос или сбросьте фильтры.</p><button id="reset-filters">Сбросить фильтры</button></div>';}
  else if(view==='grid')$('results').innerHTML=books.map(book=>`<button class="book" data-open="${escapeHtml(book.id)}" data-spine="${spineFor(book.category || book.title)}">${coverHTML(book)}${book.favorite?heartMark:''}<span class="book-copy"><span class="book-title">${escapeHtml(book.title || 'Книга по ISBN')}</span><span class="book-author">${escapeHtml(book.author || book.isbn || 'Автор не указан')}</span>${badges(book)}</span></button>`).join('');
  else $('results').innerHTML=`<table><thead><tr><th>Название</th><th>Автор</th><th>ISBN</th><th>Экз.</th><th>Статус</th></tr></thead><tbody>${books.map(book=>`<tr><td><button data-open="${escapeHtml(book.id)}">${book.favorite?'<span class="row-heart" aria-hidden="true">♥</span>':''}${escapeHtml(book.title || 'Книга по ISBN')}</button></td><td>${escapeHtml(book.author || '—')}</td><td class="isbn">${escapeHtml(book.isbn || '—')}</td><td>${book.quantity}</td><td>${book.review?'<span class="tag warn">Уточнить</span>':escapeHtml(book.status)}</td></tr>`).join('')}</tbody></table>`;
  $('pagination').innerHTML=remaining>0?`<button id="load-more" type="button">Показать ещё ${Math.min(pageSize,remaining)}</button>`:'';
  watchLoadMore();
}
let loadObserver=null;
function watchLoadMore(){
  if(loadObserver){loadObserver.disconnect();loadObserver=null;}
  const button=$('load-more');
  if(!button || !autoLoad || !('IntersectionObserver' in window))return;
  loadObserver=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting)){loadObserver.disconnect();loadObserver=null;loadMore();}
  },{rootMargin:'600px 0px'});
  loadObserver.observe(button);
}
function loadMore(){
  const all=filteredBooks();
  if(pageSize==='all' || shown>=all.length)return;
  shown=Math.min(shown+pageSize,all.length);
  render();
}
function bookById(id){return state.books.find(b=>b.id===id);}
function showBook(id) {
  const book=bookById(id);if(!book)return;selectedId=id;form.hidden=true;$('detail').hidden=false;$('dialog-title').textContent='Карточка книги';
  const metadata=[['ISBN',book.isbn],['Издательство',book.publisher],['Год',book.year],['Иллюстратор',book.illustrator],['Серия',book.series],['Страниц',book.pages],['Физических книг',book.quantity],['Наличие',book.status],['Чтение',book.reading||'Не читали'],['Источник описания',book.confidence]];
  $('detail').innerHTML=`<div class="detail-layout">${coverHTML(book)}<div><h3 class="detail-title">${escapeHtml(book.title || 'Книга по ISBN')}</h3><p class="detail-author">${escapeHtml(book.author || 'Автор не указан')}</p>${badges(book)}<dl class="metadata">${metadata.map(([k,v])=>`<div><dt>${k}</dt><dd>${escapeHtml(v || 'Не указано')}</dd></div>`).join('')}</dl></div></div>${book.notes?`<p class="detail-section-title">Заметки</p><div class="notes">${escapeHtml(book.notes)}</div>`:''}${pdfLinks(book)}<div class="form-actions"><button class="danger" id="delete-book">Удалить запись</button><button id="toggle-favorite">${book.favorite?'Убрать из любимых':'♡ В любимые'}</button><button class="primary" id="edit-book">Редактировать</button></div>`;
  if(!$('book-dialog').open)$('book-dialog').showModal();
  $('edit-book').onclick=()=>editBook(book);$('delete-book').onclick=()=>deleteBook(book);$('toggle-favorite').onclick=async()=>{if(await saveBooks(state.books.map(b=>b.id===id?{...b,favorite:!b.favorite,updatedAt:new Date().toISOString()}:b)))showBook(id);};
}
function editBook(book=null) {
  if(busy || coverBusy)return;selectedId=book?.id || null;form.reset();formField('id').value=selectedId || '';draftCover=book?.cover || '';$('cover-input').value='';$('pdf-input').value='';refreshPdf(book);
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
    state={...state,books,revision:result.revision};updateCategories();render();setStatus('saved','Сохранено · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));message('Изменения сохранены');return true;
  }catch(error){$('form-error').textContent=error.message;setStatus('error',error.message);message('Изменения не сохранены');return false;}
  finally{busy=false;controls.forEach(({element,disabled})=>element.disabled=disabled);}
}
async function deleteBook(book) {
  if(!await confirmation(`Удалить «${book.title || book.isbn}» из рабочего каталога? Исходный каталог останется без изменений.`,'Удалить'))return;
  if(await saveBooks(state.books.filter(b=>b.id!==book.id))){if(book.pdf)fetch('/api/books/'+encodeURIComponent(book.id)+'/file',{method:'DELETE'}).catch(()=>{});$('book-dialog').close();}
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
function refreshPdf(book){
  const pdf=book?.pdf;
  $('pdf-status').textContent=pdf?`Прикреплён: ${pdf.name} · ${fileSize(pdf.size)}`:'PDF не прикреплён';
  $('remove-pdf').hidden=!pdf;
  $('pdf-input').disabled=!book;
  $('pdf-input').title=book?'':'Сначала сохраните книгу, затем прикрепите PDF.';
}
async function refreshPdfFromState(){await freshState();refreshPdf(bookById(selectedId));}
$('pdf-input').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';
  if(!file || !selectedId)return;
  if(file.size>80*1024*1024){$('form-error').textContent='PDF больше 80 МБ.';return;}
  if(file.type && file.type!=='application/pdf'){$('form-error').textContent='Выберите PDF-файл.';return;}
  $('pdf-status').textContent='Загружаем PDF…';$('pdf-input').disabled=true;$('form-error').textContent='';
  try{const response=await fetch('/api/books/'+encodeURIComponent(selectedId)+'/file',{method:'POST',headers:{'Content-Type':'application/pdf','X-File-Name':encodeURIComponent(file.name)},body:file});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error || 'Не удалось загрузить PDF');
    await refreshPdfFromState();message('PDF прикреплён');}
  catch(error){$('form-error').textContent=error.message;refreshPdf(bookById(selectedId));}
  finally{$('pdf-input').disabled=false;}
});
$('remove-pdf').onclick=async()=>{
  if(!selectedId)return;
  if(!await confirmation('Удалить прикреплённый PDF?','Удалить'))return;
  try{const response=await fetch('/api/books/'+encodeURIComponent(selectedId)+'/file',{method:'DELETE'});
    if(!response.ok)throw new Error('Не удалось удалить PDF');
    await refreshPdfFromState();message('PDF удалён');}
  catch(error){$('form-error').textContent=error.message;}
};
formField('isbn').addEventListener('input',updateISBHint);
$('close-dialog').onclick=closeDialog;$('cancel-edit').onclick=closeDialog;$('book-dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
$('add').onclick=()=>state && editBook();
$('search').addEventListener('input',()=>{resetShown();render();});
for(const id of ['category','reading','sort'])$(id).addEventListener('change',()=>{resetShown();render();});
const pageSizeSelect=$('page-size');
pageSizeSelect.value=String(pageSize);
pageSizeSelect.addEventListener('change',()=>{
  pageSize=pageSizeSelect.value==='all'?'all':Number(pageSizeSelect.value);
  try{localStorage.setItem(PAGE_SIZE_KEY,String(pageSize));}catch(error){}
  resetShown();render();
});
const autoLoadBox=$('auto-load');
autoLoadBox.checked=autoLoad;
autoLoadBox.addEventListener('change',()=>{
  autoLoad=autoLoadBox.checked;
  try{localStorage.setItem(AUTO_LOAD_KEY,autoLoad?'1':'0');}catch(error){}
  render();
});
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;resetShown();document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});render();});
for(const type of ['grid','table'])$(type+'-view').onclick=()=>{view=type;for(const other of ['grid','table']){$(other+'-view').classList.toggle('selected',other===type);$(other+'-view').setAttribute('aria-pressed',String(other===type));}render();};
$('results').onclick=event=>{const button=event.target.closest('[data-open]');if(button)showBook(button.dataset.open);if(event.target.closest('#reset-filters')){$('search').value='';$('category').value='';$('reading').value='';tab='all';resetShown();document.querySelector('[data-tab="all"]').click();}};
$('pagination').onclick=event=>{if(event.target.closest('#load-more'))loadMore();};
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
function tableExport(current) {
 const columns=[['id','ID'],['title','Название'],['author','Автор'],['isbn','ISBN'],['alternate_isbn','Связанный ISBN'],['isbn10','ISBN-10'],['publisher','Издательство'],['year','Год'],['series','Серия'],['pages','Страниц'],['illustrator','Иллюстратор'],['quantity','Экземпляров'],['category','Категория'],['status','Наличие'],['reading','Чтение'],['review','Нужно уточнить'],['favorite','Любимая'],['language','Язык'],['contents','Содержание'],['notes','Заметки'],['confidence','Источник описания']];
 const cell=(value,key)=>{
  let text=Array.isArray(value)?value.join('; '):typeof value==='boolean'?(value?'Да':'Нет'):String(value??'');
  if(text && (['isbn','alternate_isbn','isbn10'].includes(key)||/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text)))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
 };
 return '\uFEFFsep=;\r\n'+[columns.map(([,label])=>cell(label,'')),...current.books.map(book=>columns.map(([key])=>cell(book[key],key)))].map(row=>row.join(';')).join('\r\n')+'\r\n';
}

// TRANSFER_CORE_END


function downloadFile(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadJSON(value,name){downloadFile(JSON.stringify(value,null,2),name,'application/json');}
$('table-export').onclick=async()=>{try{downloadFile(tableExport(await freshState()),'misha-table-'+new Date().toISOString().slice(0,10)+'.csv','text/csv;charset=utf-8');}catch(e){message(e.message);}};
async function freshState(){const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw Error('Не удалось получить свежий каталог');state=await response.json();updateCategories();render();return state;}
$('export').onclick=()=>state && $('export-dialog').showModal();
$('close-export').onclick=()=>$('export-dialog').close();
$('full-export').onclick=async()=>{try{downloadJSON({...await freshState(),exportedAt:new Date().toISOString()},'misha-full-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');}catch(e){message(e.message);}};
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
  try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('Библиотека недоступна');state=await response.json();if(state.schemaVersion!==1 || !Array.isArray(state.books))throw new Error('Неверный формат библиотеки');updateCategories();render();setStatus('saved','Изменения сохраняются автоматически');for(const id of ['add','export','import','ai-export'])$(id).disabled=false;}
  catch{setStatus('error','Не удалось открыть библиотеку. Обновите страницу; если ошибка остаётся, проверьте соединение или запуск сервера.');}
}
start();

// Меню «Данные»
(function dataMenu(){
  const details=$('data-menu');
  if(!details)return;
  document.addEventListener('click',event=>{if(details.open && !details.contains(event.target))details.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && details.open)details.open=false;});
  details.addEventListener('click',event=>{if(event.target.closest('.menu-panel button,.menu-panel a'))details.open=false;});
})();