// Focused regression checks for the final product pass; no network or real storage.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {test}=require('node:test');
function setup(){
  const elements={},listeners={},storage=new Map();
  const el=id=>elements[id] ||= {value:'',hidden:false,checked:false,textContent:'',innerHTML:'',setAttribute(k,v){this[k]=v;}};
  const c=vm.createContext({console,Date,FormData,Blob,setTimeout,clearTimeout,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{getElementById:el,querySelector:el,querySelectorAll:()=>[],addEventListener:(event,fn)=>(listeners[event] ||= []).push(fn)},
    window:{addEventListener:()=>{}}});
  for(const name of ['data','api','fridge','cook','add','app'])vm.runInContext(fs.readFileSync(`js/${name}.js`,'utf8').replace(/\nshow\("fridge"\);\n/,'\n'),c);
  c.stopAddCamera=()=>{};
  return {c,el,listeners,storage};
}
const response=(body,ok=true)=>({ok,json:async()=>body});
test('fresh browser has no invented groceries, activity or seeded leftovers',()=>{
 const {c}=setup();assert.equal(c.FRIDGE.length,0);assert.equal(c.EVENTS.length,0);
});
test('saving a leftover never overwrites a cloud grocery with the same name',async()=>{
 const {c,storage}=setup();c.FRIDGE=[{id:'1',name:'pasta',qty:500,unit:'g',category:'grocery'}];
 const result=await c.api.addInventoryItem({id:'local-1',name:'pasta',qty:2,unit:'servings',category:'leftover'});
 assert.equal(result.ok,true);assert.equal(c.FRIDGE.length,2);assert.equal(c.FRIDGE[0].qty,500);
 assert.equal(JSON.parse(storage.get('fridgeflow.inventory')).length,2);
});
test('failed browser storage rolls back leftovers and reports failure',async()=>{
 const {c}=setup();c.localStorage.setItem=()=>{throw Error('blocked');};
 const result=await c.api.addInventoryItem({id:'local-1',name:'soup',qty:1,category:'leftover'});
 assert.equal(result.ok,false);assert.equal(c.FRIDGE.length,0);
});
test('cooking cannot fabricate a persisted consumption response',async()=>{
 const {c}=setup();c.FRIDGE=[{name:'pasta',qty:500}];
 await assert.rejects(c.api.cook({needs:{pasta:100}}),/Edit or Mark as Eaten/);
 assert.equal(c.FRIDGE[0].qty,500);
 const html=c.renderCookDetails({name:'Pasta',minutes:15,steps:['Boil'],source:'demo'},[]);
 assert.doesNotMatch(html,/confirm-cook|Ingredients removed/);assert.match(html,/Back to pantry/);
});
test('Add offers photo upload and accurately labels browser-only leftovers alongside the restored Smart Fridge card',async()=>{
 const {c}=setup();const html=await c.renderAdd();
 assert.match(html,/grocery-photo-upload/);assert.match(html,/browser only/);assert.match(html,/Smart Fridge/);assert.match(html,/Sync from Fridge/);
 assert.doesNotMatch(html,/hardware status unknown|smart-status/);
});
test('concurrent pantry reads share a single request',async()=>{
 const {c}=setup();let requests=0;
 c.fetch=async()=>{requests++;await new Promise(r=>setTimeout(r,5));return response([{id:1,name:'rice',quantity:500,unit:'g'}]);};
 await Promise.all([c.api.getInventory(),c.api.getInventory()]);assert.equal(requests,1);assert.equal(c.FRIDGE[0].qty,500);
});
test('a slow screen response cannot overwrite a newer navigation',async()=>{
 const {c,el}=setup();c.renderers.cook=async()=>{await new Promise(r=>setTimeout(r,10));return 'OLD COOK';};c.renderers.add=async()=>'<p>NEW ADD</p>';
 await Promise.all([c.show('cook'),c.show('add')]);assert.equal(el('view').innerHTML,'<p>NEW ADD</p>');assert.equal(el('view')['aria-busy'],'false');
});
test('rendered success and error messages escape untrusted text',async()=>{
 const {c,el}=setup();c.renderers.add=async()=>'';await c.show('add','<img src=x onerror=alert(1)>');
 assert.doesNotMatch(el('view').innerHTML,/<img/);assert.match(el('view').innerHTML,/&lt;img/);
});
test('returning to a recently used time filter reuses meals for unchanged pantry',async()=>{
 const {c}=setup();c.api.getInventory=async()=>[{id:'1',name:'rice',qty:500,unit:'g'}];let calls=0;
 c.api.recommend=async()=>{calls++;const result=[];result.source='gemini';return result;};
 for(const minutes of [5,15,30,15]){c.cookState.minutes=minutes;await c.renderCook();}
 assert.equal(calls,3);
});
test('quick Add suppresses double submissions',async()=>{
 const {c}=setup();let calls=0;c.show=()=>{};c.api.scan=async()=>{calls++;await new Promise(r=>setTimeout(r,5));};
 await Promise.all([c.actions.quick({name:'tomato'}),c.actions.quick({name:'tomato'})]);assert.equal(calls,1);
});
test('recognised count quantities reject fractions instead of rounding them',()=>{
 const {c}=setup();for(const value of [0,-1,.1,1.5,NaN,1000001])assert.equal(c.parseDetectedQuantity(value),null);
 assert.equal(c.parseDetectedQuantity('2'),2);
});
test('API validation details become useful text rather than object strings',async()=>{
 const {c}=setup();await assert.rejects(c.inventoryResponse(response({detail:[{msg:'Quantity must be positive'}]},false)),/Quantity must be positive/);
});
test('photo recognition suppresses repeated Use Photo submissions',async()=>{
 const {c,el}=setup();el('camera-photo').src='data:mock';el('camera-photo').hidden=false;let calls=0;
 c.fetch=async url=>{if(url==='data:mock'){await new Promise(r=>setTimeout(r,5));return {blob:async()=>new Blob(['mock'])};}calls++;return response({items:[]});};
 await Promise.all([c.recognizeAddPhoto(),c.recognizeAddPhoto()]);assert.equal(calls,1);
});
test('recognition returning after navigation cannot change pending items',async()=>{
 const {c,el}=setup();el('camera-photo').src='data:mock';el('camera-photo').hidden=false;
 c.fetch=async url=>url==='data:mock'?{blob:async()=>new Blob(['mock'])}:(await new Promise(r=>setTimeout(r,5)),response({items:[{name:'OLD PHOTO',quantity:1}]}));
 const request=c.recognizeAddPhoto();c.addPhotoRequest++;c.addPendingScanItems=[{name:'NEW PHOTO'}];await request;
 assert.equal(c.addPendingScanItems[0].name,'NEW PHOTO');
});
test('an inventory read started before a write cannot replace fresh saved data',async()=>{
 const {c}=setup();let finishOld,reads=0;
 c.fetch=async(url,options={})=>{
   if(options.method==='POST')return response({id:2,name:'new grocery'});
   reads++;if(reads===1)return new Promise(resolve=>{finishOld=()=>resolve(response([{id:1,name:'old grocery',quantity:1}]));});
   return response([{id:1,name:'old grocery',quantity:1},{id:2,name:'new grocery',quantity:2}]);
 };
 const read=c.api.getInventory();await c.api.scan('new grocery',2);finishOld();await read;
 assert.equal(c.FRIDGE.length,2);assert.equal(c.FRIDGE[1].name,'new grocery');assert.equal(reads,2);
});
test('Estimated badge uses the item ID and the existing editor, then unchanged date saves as Confirmed after refresh',async()=>{
 const {c,el,listeners}=setup();
 const rows=[
   {id:1,name:'milk',quantity:1,unit:'pack',expiry_date:'2026-10-20',expiry_date_source:'estimated',expiry_date_confirmed:false},
   {id:2,name:'milk',quantity:2,unit:'pack',expiry_date:'2026-10-21',expiry_date_source:'estimated',expiry_date_confirmed:false}
 ];
 let patches=0,scrolled=0,focused='';
 c.fetch=async(url,options={})=>{
   if(options.method==='PATCH'){
     assert.match(url,/\/inventory\/2$/);patches++;
     const body=JSON.parse(options.body);assert.equal(body.expiry_date,'2026-10-21');
     Object.assign(rows[1],body,{expiry_date_confirmed:true});return response({id:2,ok:true});
   }
   return response(rows);
 };
 const fields=Object.fromEntries(Object.entries({name:'milk',qty:'2',unit:'pack',expiry:'2026-10-21'}).map(([name,value])=>[name,{value,focus(){focused=name;}}]));
 c.document.querySelector=()=>c.fridgeViewState.editingGroceryId?{scrollIntoView(){scrolled++;},querySelector:selector=>fields[selector.match(/name='([^']+)'/)[1]]}:null;
 await c.show('fridge');
 const item=c.FRIDGE.find(i=>i.id==='2');
 for(const editable of [false,true]){
   const card=c.renderGroceryCard(item,editable);
   assert.match(card,/<button class='expiry-label[^>]+data-action='edit-grocery' data-id='2' data-focus='expiry'/);
 }
 listeners.click[0]({target:{closest:()=>({dataset:{action:'edit-grocery',id:'2',focus:'expiry'}})}});
 await new Promise(r=>setTimeout(r,5));
 assert.equal(c.fridgeViewState.editingGroceryId,'2');assert.equal(focused,'expiry');assert.equal(scrolled,1);
 assert.match(el('view').innerHTML,/name='expiry' type='date' value='2026-10-21'/);
 assert.equal((el('view').innerHTML.match(/<form /g)||[]).length,1);
 await c.actions['save-grocery']({id:'2'});assert.equal(patches,1);
 c.FRIDGE=[];await c.api.getInventory();
 const refreshed=c.FRIDGE.find(i=>i.id==='2');
 assert.equal(refreshed.expiryDate,'2026-10-21');assert.equal(refreshed.expiryDateSource,'estimated');assert.equal(refreshed.expiryDateConfirmed,true);
 assert.equal(c.FRIDGE.find(i=>i.id==='1').expiryDateConfirmed,false);
 assert.match(c.renderGroceryCard(refreshed,true),/<small>Confirmed<\/small>/);
 assert.doesNotMatch(c.renderGroceryCard(refreshed,true),/<small>Estimated<\/small>/);
});
test('normal Edit still opens the same form and focuses the name field',async()=>{
 const {c}=setup();let focused='';
 c.show=async()=>{};
 c.document.querySelector=()=>({scrollIntoView(){},querySelector:selector=>({focus(){focused=selector;}})});
 await c.actions['edit-grocery']({id:'9'});
 assert.equal(c.fridgeViewState.editingGroceryId,'9');assert.equal(focused,"[name='name']");
});
