// Offline execution of the real scripts, with DOM and HTTP boundaries mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
function setup() {
  const elements = {};
  const el = id => elements[id] ||= {value:'', checked:false, hidden:false, textContent:'', innerHTML:''};
  const c = vm.createContext({console, Date, FormData, Blob, setTimeout,
    document: {getElementById:el, querySelector:el, querySelectorAll:()=>[], addEventListener:()=>{}},
    window:{addEventListener:()=>{}}, FRIDGE:[], EVENTS:[], initializeDemoLeftover:()=>{},
    renderCook:()=>'', foodIcon:()=>'', saveInventory:()=>{}});
  for (const f of ['api', 'fridge', 'cook', 'add', 'app']) {
    let code = fs.readFileSync(`js/${f}.js`, 'utf8');
    if (f === 'app') code = code.replace(/initializeDemoLeftover\(\);\s*show\("fridge"\);\s*$/, '');
    vm.runInContext(code, c);
  }
  c.show = ()=>{};
  for (const [id,value] of Object.entries({'add-name':'Milk','add-qty':'1','add-unit':'pack','add-kind':'grocery','add-expiry-source':'unknown'})) el(id).value=value;
  return {c,el};
}
const response = (body, ok=true) => ({ok,json:async()=>body});
test('manual Add estimates once despite double click; POST then refresh, PATCH then refresh', async()=>{
  const {c,el}=setup(); const calls=[]; let saved;
  c.fetch=async(url, options={})=>{
    calls.push([url,options.method||'GET']);
    if(url.endsWith('estimate-expiry')) { await new Promise(r=>setTimeout(r,5)); return response({expiry_date:'2026-10-20',expiry_date_source:'estimated'}); }
    if(options.method==='POST') {saved={id:1,...JSON.parse(options.body)}; return response(saved);}
    if(options.method==='PATCH') {Object.assign(saved,JSON.parse(options.body),{expiry_date_confirmed:true}); return response(saved);}
    return response([saved]);
  };
  await Promise.all([c.actions.add(),c.actions.add()]);
  assert.equal(calls.length,2);
  let item=(await c.api.getInventory())[0];
  assert.match(c.renderGroceryCard(item,false), /Estimated/);
  el('expiry-edit-date').value='2026-10-21';
  await c.actions['confirm-expiry']({id:'1'});
  item=(await c.api.getInventory())[0];
  assert.equal(item.expiryDateSource,'estimated');
  assert.equal(item.expiryDateConfirmed,true);
  assert.doesNotMatch(c.renderGroceryCard(item,false), /<small>Estimated<\/small>/);
  assert.equal(item.expiryDate,'2026-10-21');
});
test('failed estimate HTTP response still POSTs unknown expiry',async()=>{
  const {c}=setup(); const posts=[];
  c.fetch=async(url,o)=> {
    if(url.endsWith('estimate-expiry')) return response({detail:'quota'},false);
    posts.push(JSON.parse(o.body)); return response({id:1});
  };
  await c.actions.add();
  assert.equal(posts.length,1);
  assert.equal(posts[0].expiry_date,null);
  assert.equal(posts[0].expiry_date_source,'unknown');
});
test('printed manual date bypasses estimation',async()=>{
  const {c,el}=setup(); el('add-expiry-source').value='printed';el('add-expiry-date').value='2026-10-20';el('printed-date-confirmed').checked=true;
  const calls=[]; c.fetch=async(u,o)=>{calls.push([u,JSON.parse(o.body)]); return response({id:1});};
  await c.actions.add(); assert.equal(calls.length,1);assert.equal(calls[0][1].expiry_date_source,'printed');
});
test('camera recognition and confirmation use one scan and no estimate',async()=>{
  const {c,el}=setup(); el('camera-photo').src='data:image/png;base64,mock';
  const calls=[];
  c.fetch=async(u,o={})=>{calls.push(u);
    if(u.startsWith('data:')) return {blob:async()=>new Blob(['mock'])};
    if(u.endsWith('/scan')) return response({items:[{name:'milk',quantity:1,expiry_date:'2026-10-20',expiry_date_source:'printed'},{name:'bread',quantity:1,expiry_date:'2026-10-21',expiry_date_source:'estimated'}]});
    const body=JSON.parse(o.body); assert.equal(body.expiry_date_source, calls.length===3?'printed':'estimated'); return response(body);
  };
  await c.recognizeAddPhoto(); await Promise.all([c.confirmDetectedItems(),c.confirmDetectedItems()]);
  assert.equal(calls.filter(u=>u.endsWith('/scan')).length,1);
  assert.equal(calls.filter(u=>u.endsWith('/inventory')).length,2);
  assert.equal(calls.some(u=>u.includes('estimate-expiry')),false);
});
test('camera partial-save retry does not resubmit successful items',async()=>{
  const {c}=setup();c.addPendingScanItems=[{name:'milk',quantity:1},{name:'bread',quantity:1}];
  const calls=[];let fail=true;
  c.api.scan=async(name)=>{calls.push(name);if(name==='bread'&&fail) throw Error('mock failure');};
  await c.confirmDetectedItems();fail=false;await c.confirmDetectedItems();
  assert.deepEqual(calls,['milk','bread','bread']);
});
test('dates reject impossible calendars and urgency sorts unknown last without stale days',()=>{
  const {c}=setup(); assert.equal(c.dateDayNumber('2026-02-30'),null);
  assert.equal(c.groceryUrgency({days:1}),Infinity);
  const sorted=c.sortGroceriesByExpiry([{id:'unknown'},{id:'late',expiryDate:'2026-10-25'},{id:'early',expiryDate:'2026-10-19'}]);
  assert.equal(sorted.map(x=>x.id).join(','),'early,late,unknown');
});

test('recipe urgency uses persisted dates, without NaN scores from stale days',()=>{
  const {c}=setup();
  const value=new Date();value.setDate(value.getDate()+1);
  const date=[value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
  c.FRIDGE=[{name:'milk',qty:1,expiryDate:date}];
  c.RECIPES=[{name:'milk recipe',minutes:5,needs:{milk:1}}];
  const recipe=c.scoreRecipes(15)[0];assert.equal(recipe.score,4);
  assert.equal(c.cookSoonIngredient(recipe,c.FRIDGE).name,'milk');
});
test('switching from leftover form without expiry inputs still saves grocery',async()=>{
  const {c,el}=setup();const original=c.document.getElementById;
  c.document.getElementById=id=>['add-expiry-source','add-expiry-date','printed-date-confirmed'].includes(id)?null:original(id);
  const calls=[];c.fetch=async(u,o)=>{calls.push(u);return response(u.endsWith('estimate-expiry')?{expiry_date:null,expiry_date_source:'unknown'}:{id:1});};
  await c.actions.add();assert.equal(calls.length,2);
});
test('grocery cards have exactly Edit and Mark as Eaten actions, also in attention lists',()=>{
  const {c}=setup();
  for(const editable of [false,true]) {
    const html=c.renderGroceryCard({id:'1',name:'milk',qty:2},editable);
    assert.equal((html.match(/<button /g)||[]).length,2);
    assert.match(html,/>Edit</);assert.match(html,/>Mark as Eaten</);
    assert.doesNotMatch(html,/data-action='edit-expiry'/);
  }
});
test('Edit and Eaten persist once under double submission and refresh pantry',async()=>{
  const {c,el}=setup();const fields={name:{value:'milk edited'},qty:{value:'2.25'},unit:{value:'packs'},expiry:{value:'2026-10-22'}};
  c.document.querySelector=()=>({querySelector:s=>fields[s.match(/name='(.*?)'/)[1]]});
  let refreshes=0;c.show=async()=>{refreshes++;};const calls=[];
  c.fetch=async(u,o)=>{calls.push([u,o]);await new Promise(r=>setTimeout(r,5));return response({ok:true});};
  await Promise.all([c.actions['save-grocery']({id:'1'}),c.actions['save-grocery']({id:'1'})]);
  assert.equal(calls.length,1);assert.equal(calls[0][1].method,'PATCH');
  assert.deepEqual(JSON.parse(calls[0][1].body),{name:'milk edited',quantity:2.25,unit:'packs',expiry_date:'2026-10-22'});
  await Promise.all([c.actions['eat-grocery']({id:'1'}),c.actions['eat-grocery']({id:'1'})]);
  assert.equal(calls.length,2);assert.match(calls[1][0],/\/inventory\/1\/eaten$/);assert.equal(refreshes,2);
  for(const quantity of ['0','-1','NaN','0.001','1000001']) {
    fields.qty.value=quantity;await c.actions['save-grocery']({id:'1'});
  }
  assert.equal(calls.length,2);assert.match(el('grocery-edit-message').textContent,/positive quantity/);
});
test('editing an item shown in Use Soon creates only one editor',()=>{
  const {c}=setup();c.fridgeViewState.editingGroceryId='1';
  const item={id:'1',name:'milk',qty:1};
  const html=c.renderGroceryCard(item,false)+c.renderGroceryCard(item,true);
  assert.equal((html.match(/<form /g)||[]).length,1);
});
