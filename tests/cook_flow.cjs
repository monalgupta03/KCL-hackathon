// Exercise the real frontend through FastAPI, with PostgreSQL and Gemini mocked in the bridge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
function setup(scenario) {
  const elements = {};
  const el=id=>elements[id] ||= {value:'',hidden:false,innerHTML:'',pause:()=>{},removeAttribute:()=>{}};
  const calls=[];
  const c=vm.createContext({console,Date,FormData,Blob,
    document:{getElementById:id=>id==='camera-video'?null:el(id),querySelectorAll:()=>[],addEventListener:()=>{}},
    window:{addEventListener:()=>{}},localStorage:{getItem:()=>JSON.stringify([{name:'STALE LOCAL SPINACH',qty:999}]),setItem:()=>{},removeItem:()=>{}}});
  for(const name of ['data','api','fridge','cook','add','app']) {
    let code=fs.readFileSync(path.join(root,`js/${name}.js`),'utf8');
    if(name==='app')code=code.replace(/\nshow\("fridge"\);\n/, '\n');
    vm.runInContext(code,c);
  }
  c.fetch=async(url,o={})=>{
    const route=new URL(url).pathname;
    assert.ok(['/inventory','/meals/recommend'].includes(route),'No unmocked request permitted');
    const request={path:route,method:o.method||'GET',body:o.body?JSON.parse(o.body):undefined,scenario};
    const result=JSON.parse(execFileSync(path.join(root,'backend/.venv/bin/python'),[path.join(root,'tests/cook_bridge.py')],{
      input:JSON.stringify(request),encoding:'utf8',env:process.env,stdio:['pipe','pipe','pipe']
    }));
    calls.push({request,result});
    return {ok:result.status>=200&&result.status<300,json:async()=>result.body};
  };
  return {c,calls,view:el('view')};
}
for(const minutes of [5,15,30]) {
  test(`complete Cook flow at ${minutes} minutes renders two feasible meals and opens cached details`,async()=>{
    const {c,calls,view}=setup();
    await c.actions.time({minutes:String(minutes)});
    assert.equal((view.innerHTML.match(/class='cook-recipe card'/g)||[]).length,2);
    assert.doesNotMatch(view.innerHTML,/No recipes fit|STALE LOCAL SPINACH|Missing ingredients/);
    assert.equal(calls[0].request.path,'/inventory');
    const meals=calls.filter(x=>x.request.path==='/meals/recommend');
    assert.equal(meals.length,1);assert.equal(meals[0].request.body.minutes,minutes);
    assert.equal(meals[0].result.gemini_calls,1);
    assert.match(view.innerHTML,/Gemini-generated meal/);
    assert.doesNotMatch(view.innerHTML,/Demo mode/);
    assert.equal(meals[0].result.body.recipes[0].ingredients[0].name,'spinach');
    for(const recipe of meals[0].result.body.recipes) {
      assert.ok(recipe.cooking_time_minutes<=minutes);
      assert.equal(recipe.missing_ingredients.length,0);
      assert.ok(recipe.ingredients.every(i=>i.in_stock));
    }
    const name=c.cookState.recipes[0].name;
    await c.actions['open-recipe']({index:'0'});
    assert.match(view.innerHTML,new RegExp(name));
    assert.match(view.innerHTML,/Cooking steps/);
    assert.doesNotMatch(view.innerHTML,/Cooking steps aren't available/);
    await c.actions['back-recipes']();
    assert.equal(calls.filter(x=>x.request.path==='/meals/recommend').length,1);
  });
}
for(const scenario of ['quota','malformed','overlimit','unavailable']) {
  for(const minutes of [5,15,30]) test(`${scenario} renders feasible Demo mode cards and instructions at ${minutes} minutes`,async()=>{
    const {c,calls,view}=setup(scenario);
    await c.actions.time({minutes:String(minutes)});
    assert.equal((view.innerHTML.match(/class='cook-recipe card'/g)||[]).length,2);
    assert.match(view.innerHTML,/Demo mode/);
    assert.doesNotMatch(view.innerHTML,/No recipes fit|No suitable meals|Gemini-generated meal/);
    assert.ok(c.cookState.recipes.every(recipe=>recipe.minutes<=minutes && recipe.missingIngredients.length===0));
    await c.actions['open-recipe']({index:'0'});
    assert.match(view.innerHTML,/Demo mode.*Predefined recipe/);
    assert.match(view.innerHTML,/Cooking steps/);
    assert.doesNotMatch(view.innerHTML,/Cooking steps aren't available/);
    assert.equal(calls.filter(x=>x.request.path==='/meals/recommend').length,1);
    if(scenario==='quota')assert.match(calls[1].result.body.notice,/quota/);
  });
}
test('missing quantities are shown on cards and details',async()=>{
  const {c,view}=setup('missing');await c.actions.time({minutes:'15'});
  assert.match(view.innerHTML,/Missing ingredients: 10 ml olive oil/);
  await c.actions['open-recipe']({index:'0'});
  assert.match(view.innerHTML,/Missing ingredients: 10 ml olive oil/);
  assert.match(view.innerHTML,/aria-hidden='true'>＋<\/span>/);
});
test('empty inventory never calls Gemini',async()=>{
  const {c,calls,view}=setup('empty');await c.show('cook');
  assert.match(view.innerHTML,/fridge is looking a little empty/);
  assert.equal(calls.length,1);assert.equal(calls[0].result.gemini_calls,0);
});
test('switching 5/15/30 in one session sends each limit and replaces the rendered meals',async()=>{
  const {c,calls,view}=setup();
  for(const minutes of [5,15,30]) {
    await c.actions.time({minutes:String(minutes)});
    assert.ok(c.cookState.recipes.every(r=>r.minutes<=minutes));
    assert.equal((view.innerHTML.match(/class='cook-recipe card'/g)||[]).length,2);
  }
  assert.equal(calls.filter(x=>x.request.path==='/meals/recommend').map(x=>x.request.body.minutes).join(','),'5,15,30');
});
test('past-dated food is not promoted in the Cook header',()=>{
  const {c}=setup();
  assert.doesNotMatch(c.cookHeader([{name:'expired milk',qty:1,expiryDate:'2000-01-01'}]),/expired milk/);
});
test('urgency message follows the actual earliest eligible ingredient',()=>{
  const {c}=setup();
  const dateAfter=days=>{const d=new Date();d.setDate(d.getDate()+days);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const html=c.cookHeader([{name:'spinach',qty:200,expiryDate:dateAfter(3)},{name:'mushrooms',qty:200,expiryDate:dateAfter(1)}]);
  assert.match(html,/Your mushrooms needs using soon/);
  assert.doesNotMatch(html,/Your spinach/);
});
test('dietary restrictions reach the backend and filter demo meals',async()=>{
  const {c,calls,view}=setup('quota');
  c.cookState.dietaryRestrictions=['vegan','gluten-free'];
  await c.actions.time({minutes:'30'});
  assert.match(view.innerHTML,/Demo mode/);
  assert.ok(c.cookState.recipes.length>0);
  for(const recipe of c.cookState.recipes) assert.ok(recipe.ingredients.every(i=>!['eggs','milk','cheese','pasta'].includes(i.name)));
  assert.equal(calls[1].request.body.dietary_restrictions.join(','),'vegan,gluten-free');
});
test('unsupported dietary restrictions give an honest empty demo state',async()=>{
  const {c,view}=setup('quota');
  c.cookState.dietaryRestrictions=['unrecognised medical restriction'];
  await c.actions.time({minutes:'15'});
  assert.match(view.innerHTML,/Demo mode/);
  assert.match(view.innerHTML,/No demo recipes fit/);
  assert.equal(c.cookState.recipes.length,0);
});
