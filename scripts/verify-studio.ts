import { createPlaygroundServer } from '../playground/server.js';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = await mkdtemp(join(tmpdir(), 'captured-studio-ui-'));
let observations = 0, searches = 0, imageCalls = 0;
for (const color of ['red','blue','green']) {
  const bytes = await sharp({create:{width:400,height:300,channels:3,background:color}}).jpeg().toBuffer();
  const id = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(dir,`${id}.jpg`),bytes);
  await writeFile(join(dir,`${id}.json`),JSON.stringify({id,name:`${color}.jpg`}));
}
const server = await createPlaygroundServer({datasetDir:dir,providerFactory:()=>({
  image:async()=>{imageCalls++;return Array.from({length:3072},(_,i)=>i===0?1:0);},
  plan:async query=>({visualQuery:query,references:[]}),text:async query=>{ searches++;if(query==='failure') throw new Error('mock search failure');return Array.from({length:3072},(_,i)=>i===0?1:0); },
  observe:async photos=>{observations++;return {results:photos.map(p=>({id:p.id,scene:'people',activities:['walking'],vibes:['warm light'],aesthetic:75,smilesVisible:true,facesClear:true,evidence:'Test fixture, not live inference.'}))};},
  verify:async(query,photos)=>({requirements:[query],results:photos.map(p=>({id:p.id,checks:[{status:'pass',evidence:'Mocked match for browser testing.'}]}))}),
})});
let browser: any;
try {
  await server.listen({host:'127.0.0.1',port:0});
  const url = `http://127.0.0.1:${(server.server.address() as {port:number}).port}`;
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  const errors: string[]=[];page.on('pageerror',(error: Error)=>errors.push(error.message));
  page.on('dialog',async(dialog:any)=>dialog.accept());
  // Exercise the browser flow without ever opening an app or reading Apple Photos.
  let companionLaunches = 0;
  await page.route('**/api/studio/mac/launch', async (route:any) => {
    companionLaunches++;
    assert.equal(route.request().method(), 'POST');
    assert(route.request().headers()['x-playground-session']);
    await route.fulfill({ status: companionLaunches === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(companionLaunches === 1 ? { message: 'Build the Mac companion with npm run build:mac, then try again.' } : { opened: true }) });
  });
  await page.goto(url+'/studio');
  await page.waitForFunction(()=>document.querySelectorAll('.memory-card').length===24);
  assert.equal(companionLaunches, 0, 'Browsing must not open the Photos companion.');
  await page.locator('.memory-open').first().click();
  assert(await page.locator('#photo-dialog').isVisible());
  await page.getByRole('button',{name:'Close photo details'}).click();
  await page.locator('[data-filter="scenery"]').click();
  assert((await page.locator('.memory-card').count())>0 && (await page.locator('.memory-card').count())<24);
  await page.locator('.photo-select input').first().check();
  const downloaded = page.waitForEvent('download'); await page.locator('#export-selection').click();
  const download = await downloaded;assert(download.suggestedFilename().endsWith('.json'));
  await page.locator('#connect-apple-photos').click();
  await page.waitForFunction(()=>document.querySelector('#photos-connect-error')?.textContent?.includes('Build the Mac companion'));
  assert.equal(companionLaunches, 1);
  assert(await page.locator('#photos-connect-dialog').isVisible());
  assert((await page.locator('#photos-connect-dialog').textContent()).includes('No Apple password'));
  assert((await page.locator('#photos-connect-dialog').textContent()).includes('does not run AI'));
  await page.locator('#photos-launch-retry').click();
  await page.waitForFunction(()=>document.querySelector('#photos-connect-status')?.textContent?.includes('The Mac companion was opened'));
  assert.equal(await page.locator('#photos-connect-error').textContent(), '');
  assert.equal(companionLaunches, 2, 'Only explicit retry should launch the companion again.');
  await page.locator('#photos-import-refresh').click();
  await page.waitForFunction(()=>document.querySelector('[data-mode="live"]')?.getAttribute('aria-pressed')==='true' && !!document.querySelector('#refresh-trips'));
  assert.equal(await page.locator('.trip-list-card').count(), 0);
  const token=await page.locator('meta[name="playground-session"]').getAttribute('content');
  const workspace=(await (await page.request.get(url+'/state')).json());
  // Simulate a completed companion import through the same persistent trip store.
  const imported=await page.request.post(url+'/api/studio/trips',{ headers:{'x-playground-session':token!}, data:{title:'Photos album import',place:'A local album',members:[],photoIds:[workspace.photos[0].id]} });
  assert(imported.ok());
  const refreshed=page.waitForResponse((response:any)=>response.url()===url+'/api/studio/trips' && response.request().method()==='GET');
  await page.locator('#refresh-trips').click();
  await refreshed;
  await page.getByRole('button').filter({hasText:'Photos album import'}).waitFor();
  assert.equal(companionLaunches, 2);
  assert.deepEqual([imageCalls,observations,searches],[0,0,0], 'Launching, importing, and refreshing must not run AI.');
  await mkdir('artifacts/local',{recursive:true});
  await page.screenshot({path:'artifacts/local/studio-apple-photos-desktop.png',fullPage:true});
  await page.locator('#create-trip').click();
  await page.locator('#trip-form input[name="title"]').fill('Browser trip');
  await page.locator('#trip-form input[name="members"]').fill('Mark, Olivia');
  await page.locator('#import-photos input').first().check();
  await page.locator('#import-photos input').nth(1).check();
  await page.locator('#trip-form [type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#breadcrumb-trip')?.textContent==='Browser trip');
  assert.equal(await page.locator('.memory-card').count(),2);
  await page.locator('#ai-connect').click();
  await page.locator('#ai-key').fill('test-only-key-not-real');
  await page.locator('#ai-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#ai-dialog')?.hasAttribute('open'));
  assert.equal(await page.locator('#ai-key').inputValue(),'');
  await page.locator('#prepare-photos').click();
  await page.waitForFunction(()=>document.querySelector('#analysis-notice')?.textContent?.includes('Your latest preparation'));
  assert.equal(observations,1);assert.equal(imageCalls,2);
  await page.locator('.memory-open').first().click();
  await page.locator('.annotation-editor summary').click();
  await page.locator('.person-confirm input').first().check();
  await page.getByRole('button',{name:'Save my correction'}).click();
  await page.waitForFunction(()=>!document.querySelector('#photo-dialog')?.hasAttribute('open'));
  const trips=(await (await page.request.get(url+'/api/studio/trips')).json()).trips;
  const detail=await (await page.request.get(url+`/api/studio/trips/${trips.find((trip:any)=>trip.title==='Browser trip').id}`)).json();
  assert.equal(detail.photos.filter((photo:any)=>photo.annotation?.provenance==='user').length,1);
  assert.equal(detail.coverage.annotatedPhotos,2);
  await page.locator('#photo-query').fill('people walking');
  await page.locator('.search-submit').click();
  await page.waitForFunction(()=>document.querySelectorAll('.memory-card').length===2 && !document.querySelector('.search-submit')?.hasAttribute('disabled'));
  await page.waitForFunction(()=>document.querySelector('#search-disclosure')?.textContent?.includes('Search uses saved image embeddings'));
  assert.equal(searches,1);
  await page.locator('#photo-query').fill('failure');
  await page.locator('.search-submit').click();
  await page.waitForFunction(()=>document.querySelectorAll('.memory-card').length===0 && document.querySelector('.empty-state')?.textContent?.includes('search'));
  assert.equal(await page.locator('.memory-card').count(),0);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#breadcrumb-trip')?.textContent==='Browser trip' && document.querySelectorAll('.memory-card').length===2);
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(250);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'← All my trips'}).click();
  await page.locator('#import-apple-photos').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'artifacts/local/studio-apple-photos-mobile.png',fullPage:true});
  assert.equal(companionLaunches, 2, 'Reload and list refresh must not launch the companion.');
  assert.deepEqual(errors,[]);
  console.log('PASS studio browser: demo, filters, manifest download, Apple Photos launch error/retry, imported album refresh without AI, scoped trip creation, AI connection UI, missing image embeddings, scene analysis, identity correction, scoped visual search, persisted reload and mobile layout. Companion launch and provider responses mocked; no Photos access or paid calls.');
} finally { if(browser) await browser.close();await server.close();await rm(dir,{recursive:true,force:true}); }
