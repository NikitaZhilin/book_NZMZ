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
$('export').onclick=()=>{if(!state)return;const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`misha-library-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onclick=()=>state && $('import-input').click();
$('import-input').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{if(file.size>30*1024*1024)throw new Error('Копия больше 30 МБ.');const imported=JSON.parse(await file.text());if(imported.schemaVersion!==1 || !Array.isArray(imported.books))throw new Error('Выберите копию, сохранённую кнопкой «Скачать копию».');if(!await confirmation(`Заменить рабочий каталог (${state.books.length} записей) содержимым копии (${imported.books.length} записей)? Перед загрузкой рекомендуется скачать текущую копию.`,'Загрузить копию'))return;await saveBooks(imported.books);}catch(error){message(error.message);}
};
async function start(){
  for(const id of ['add','export','import'])$(id).disabled=true;
  try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('Библиотека недоступна');state=await response.json();if(state.schemaVersion!==1 || !Array.isArray(state.books))throw new Error('Неверный формат библиотеки');updateCategories();render();$('connection').className='notice success';$('connection').textContent='Библиотека открыта · изменения сохраняются автоматически';for(const id of ['add','export','import'])$(id).disabled=false;}
  catch{$('connection').textContent='Не удалось открыть библиотеку. Обновите страницу; если ошибка остаётся, проверьте соединение или запуск сервера.';}
}
start();
