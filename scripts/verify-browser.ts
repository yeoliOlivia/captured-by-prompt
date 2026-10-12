import { createPlaygroundServer } from '../playground/server.ts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const dir = await mkdtemp(join(tmpdir(),'captured-ui-context-'));
for (const [i,color] of ['red','blue','green'].entries()) {
 const bytes=await sharp({create:{width:600,height:400,channels:3,background:color}}).jpeg().toBuffer();
 const id=createHash('sha256').update(bytes).digest('hex'), x=[.8,.4,.1][i];
 await writeFile(join(dir,id+'.jpg'),bytes);await writeFile(join(dir,id+'.json'),JSON.stringify({id,name:color+'.jpg',model:'gemini-embedding-2',embedding:Array.from({length:3072},(_,j)=>j===0?x:j===1?Math.sqrt(1-x*x):0)}));
}
let texts=0;
const server=await createPlaygroundServer({datasetDir:dir,providerFactory:()=>({
 image:async()=>[],text:async()=>{texts++;return Array.from({length:3072},(_,i)=>i===0?1:0);},
 plan:async(query)=>{if(query==='failure') throw new Error('mock model error'); return {visualQuery:'people',references:query.toLowerCase().includes('mark')?[{term:'Mark',kind:'person'}]:[]};},
 verify:async(query,images,context)=>({requirements:[query],results:images.map((p,i)=>({id:p.id,checks:[{status:context?.facts.entities.some(m=>m.photoIds.includes(p.id))?'pass':'uncertain',evidence:'Mock assessment for interface testing'}]}))}),
})});
await server.listen({host:'127.0.0.1',port:0});
const url=`http://127.0.0.1:${(server.server.address() as {port:number}).port}`;
let browser;
try { browser=await chromium.launch({headless:true}); } catch(error) { await server.close(); throw error; }
try {
 const page=await browser.newPage({viewport:{width:1200,height:950}});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/');
 await page.locator('#key').fill('test-only-key-not-a-real-key');await page.locator('#connect').click();
 await page.waitForFunction(()=>document.querySelector('#key-form').hidden);
 await page.locator('#prompt').fill('a dog');await page.locator('#search').click();
 await page.waitForFunction(()=>document.querySelector('#results-subtitle').textContent.includes('1 matches'));
 assert.equal(await page.locator('#gallery [data-similarity]').count(),0); assert.equal(await page.locator('#threshold-value').count(),0);
 await page.locator('#scan').click();await page.waitForFunction(()=>!document.querySelector('#scan').disabled);assert.equal(await page.locator('#gallery .photo').count(),1);
 const before=texts;
 await page.locator('#threshold').fill('0');await page.waitForFunction(()=>document.querySelectorAll('#gallery .photo').length===3);assert.equal(texts,before);
 await page.locator('#threshold').fill('1');assert.equal(await page.locator('#gallery .photo').count(),1);
 await page.locator('#threshold-reset').click();
 await page.locator('#prompt').fill('Mark');await page.locator('#search').click();await page.locator('#clarification').waitFor({state:'visible'});
 assert.equal(await page.locator('#gallery .photo').count(),0);
 await page.waitForTimeout(1700);assert.equal(await page.locator('#gallery .photo').count(),0);
 await page.route('**/context/save',async route=>{const response=await route.fetch();await new Promise(r=>setTimeout(r,1700));await route.fulfill({response});});
 await page.locator('#new-context').click();await page.locator('#memory-qualifier').fill('from college');await page.locator('#pick-photos').click();await page.locator('#picker-grid button').first().click();await page.locator('#picker-done').click();await page.locator('#save-memory').click();
 await page.waitForFunction(()=>document.querySelector('#context-used').textContent.includes('Mark'));
 await page.unroute('**/context/save');
 assert.equal(await page.locator('#gallery .photo').count(),1);
 await page.locator('#uncertain').check();await page.locator('#threshold').fill('0');assert.equal(await page.locator('#gallery .photo').count(),3);await page.locator('#uncertain').uncheck();await page.locator('#threshold-reset').click();
 await page.locator('#add-memory').click();await page.locator('#memory-name').fill('Mark');await page.locator('#memory-qualifier').fill('from soccer');await page.locator('#pick-photos').click();await page.locator('#picker-grid button').nth(1).click();await page.locator('#picker-done').click();await page.locator('#save-memory').click();
 await page.waitForFunction(()=>document.querySelector('#memory-form').hidden);
 await page.locator('#search').click();await page.locator('#clarification').waitFor({state:'visible'});
 assert.equal(await page.locator('#context-choices button').count(),2);await page.locator('#context-choices button').filter({hasText:'college'}).click();
 await page.waitForFunction(()=>document.querySelector('#clarification').hidden && document.querySelector('#context-used').textContent.includes('college'));
 await page.screenshot({path:join(dir,'desktop.png'),fullPage:true});
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.memory-row').length===2);
 assert.equal(await page.locator('#gallery .photo').count(),0);assert(await page.locator('#threshold').isDisabled());
 await page.locator('#prompt').fill('failure');await page.locator('#search').click();await page.waitForFunction(()=>document.querySelector('#notice').dataset.error==='true');
 assert.equal(await page.locator('#gallery .photo').count(),0);
 await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelectorAll('#gallery .photo').length===3);
 assert(await page.locator('#threshold').isDisabled());
 await page.route('**/search',async route=>{const photos=(await (await page.request.get(url+'/state')).json()).photos;await route.fulfill({json:{verified:false,results:Array.from({length:140},(_,i)=>({...photos[0],similarity:i<65?.8:.2})),contextUsed:[]}});});
 await page.locator('#prompt').fill('pagination');await page.locator('#search').click();await page.waitForFunction(()=>document.querySelector('#results-subtitle').textContent.includes('65 matches'));
 assert.equal(await page.locator('#gallery .photo').count(),60);await page.locator('#more').click();assert.equal(await page.locator('#gallery .photo').count(),65);assert(await page.locator('#more').isHidden());
 assert.equal(await page.locator('#gallery [data-similarity]').count(),0); assert.equal(await page.locator('#threshold-value').count(),0);
 await page.locator('#threshold').fill('1');assert.equal(await page.locator('#gallery .photo').count(),60); // 65 tied best scores, paged
 await page.unroute('**/search');
 let searchRequests=0;
 await page.route('**/search',async route=>{searchRequests++;const photos=(await (await page.request.get(url+'/state')).json()).photos;const empty=route.request().postDataJSON().query==='below baseline';await route.fulfill({json:{verified:false,results:Array.from({length:100},(_,i)=>({...photos[0],id:String(i),similarity:empty?.0001:.001+i*.00009})).reverse(),contextUsed:[]}});});
 await page.locator('#prompt').fill('narrow distribution');await page.locator('#search').click();await page.waitForFunction(()=>document.querySelector('#results-subtitle').textContent.includes('1 matches'));
 await page.locator('#threshold-reset').click();assert.equal(await page.locator('#gallery .photo').count(),25);
 await page.locator('#threshold').fill('0.6');assert.equal(await page.locator('#gallery .photo').count(),16);
 await page.locator('#threshold').fill('0');assert.equal(await page.locator('#gallery .photo').count(),60);await page.locator('#more').click();assert.equal(await page.locator('#gallery .photo').count(),100);
 await page.locator('#threshold').fill('1');assert.equal(await page.locator('#gallery .photo').count(),1);assert.equal(searchRequests,1);
 await page.locator('#prompt').fill('below baseline');await page.locator('#search').click();await page.waitForFunction(()=>document.querySelector('#results-subtitle').textContent.includes('0 matches'));
 await page.locator('#threshold').fill('0');assert.equal(await page.locator('#gallery .photo').count(),0);
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.locator('#memory-panel summary').click();await page.screenshot({path:join(dir,'mobile.png'),fullPage:true});
 // Audit: a failed state request must not permanently lock uploads.
 await page.locator('#reset').click();
 let failState=true;
 await page.route('**/state',async route=>{if(failState)await route.abort();else await route.continue();});
 await page.locator('#files').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:await sharp({create:{width:20,height:20,channels:3,background:'yellow'}}).png().toBuffer()});
 await page.waitForFunction(()=>document.querySelector('#notice').dataset.error==='true');
 failState=false;await page.unroute('**/state');
 await page.waitForFunction(()=>!document.querySelector('#files').disabled);
 await page.locator('#files').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:await sharp({create:{width:20,height:20,channels:3,background:'yellow'}}).png().toBuffer()});
 await page.waitForFunction(()=>document.querySelector('#upload-status').textContent.includes('1 saved'));
 // Audit: changing providers from another client must discard the old ranking.
 await page.locator('#prompt').fill('a dog');await page.locator('#search').click();
 await page.waitForFunction(()=>document.querySelectorAll('#gallery .photo').length>0);
 const csrf=await page.locator('meta[name="playground-session"]').getAttribute('content');
 await page.request.post(url+'/connect',{headers:{'x-playground-session':csrf!},data:{key:'qwen-test-key-long-enough',provider:'qwen'}});
 await page.waitForFunction(()=>document.querySelector('#gallery .empty')?.textContent.includes('changed'));
 assert.equal(await page.locator('#gallery .photo').count(),0);
 await page.request.post(url+'/connect',{headers:{'x-playground-session':csrf!},data:{key:'gemini-test-key-long-enough',provider:'gemini'}});
 await page.waitForFunction(()=>!document.querySelector('#search').disabled);
 await page.locator('#search').click();await page.waitForFunction(()=>document.querySelectorAll('#gallery .photo').length>0);
 // Audit: context edits from another client invalidate displayed matches too.
 await page.request.post(url+'/context/save',{headers:{'x-playground-session':csrf!},data:{kind:'place',name:'Home',notes:'A blue kitchen'}});
 await page.waitForFunction(()=>document.querySelector('#gallery .empty')?.textContent.includes('changed'));
 assert.equal(await page.locator('#gallery .photo').count(),0);
 console.log('PASS audit: upload recovery, cross-client provider switching and context edits invalidate stale results.');
 assert.deepEqual(errors,[]);console.log('PASS browser: distribution-aware slider, concentrated scores, baseline, ties, and pagination, no extra calls, scan preserves filtering, clarification/polling/error/reload never expose unfiltered photos, explicit collection browsing, context flow, mobile layout, no JS errors. Provider mocked.');
} finally {await browser.close();await server.close();}
