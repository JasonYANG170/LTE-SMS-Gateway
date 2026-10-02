import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createFixture} from './fixture.cjs';
const fixture=await createFixture();
const browser=await chromium.launch(process.env.UI_BROWSER_PATH?{executablePath:process.env.UI_BROWSER_PATH}:{channel:'chrome'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.context().addCookies([{name:'test-auth',value:'1',url:fixture.origin}]);
 await page.goto(fixture.origin);await page.waitForFunction(()=>document.getElementById('totalModules').textContent==='2');
 await page.waitForFunction(()=>document.getElementById('navUnread').textContent==='1');
 const go=async view=>{await page.locator(`[data-view="${view}"]`).click();await page.waitForFunction(view=>window.MailWorkspace.state.view===view && (view==='all'||document.querySelector('#featurePage .ws-panel')||document.querySelector('#featurePage .ws-sim-grid')),view);};
 await page.locator('#themeSelect').selectOption('dark');
 await go('unread');await page.locator('[data-message]').waitFor();assert.equal(await page.locator('#featurePage .module-card').count(),0);assert.match(await page.locator('#mailRows').textContent(),/测试来信/);
 await page.waitForFunction(()=>window.MailWorkspace.state.mail.messages[0].recipientPhone==='+8613800000000');assert.match(await page.locator('#mailRows').textContent(),/\+8613800000000/);await page.locator('[data-favorite]').click();await page.waitForFunction(()=>window.MailWorkspace.state.mail.messages[0].favorite);
 await go('favorites');await page.locator('[data-message]').waitFor();assert.equal(await page.locator('[data-message]').count(),1);
 await page.locator('[data-message]').click();await page.waitForFunction(()=>window.MailWorkspace.state.mail.messages[0].unread===false);assert.match(await page.locator('#mailDetail').textContent(),/<script>安全显示<\/script>/);assert.equal(await page.locator('#mailDetail script').count(),0);
 await go('unread');assert.equal(await page.locator('[data-message]').count(),0);
 for(const view of ['device','sim-overview','sim-details','outbox','forwarding','logs','backup','cache','upgrade','settings']) {
  await go(view);await page.locator('#featurePage .ws-panel').first().waitFor();
  assert.equal(await page.locator('.modal').count(),0,view+' renders as page');
  for(const width of [1440,390]) {await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' '+width);}
  await page.setViewportSize({width:1440,height:1000});
 }
 await page.locator('#accountUser').fill('draft-survives');await page.evaluate(()=>updateModules(window.modulesData));assert.equal(await page.locator('#accountUser').inputValue(),'draft-survives');
 await go('sim-details');assert.equal(await page.locator('[data-action="inspect-sim"]').count(),0);await page.waitForFunction(()=>document.getElementById('featurePage').textContent.includes('460001234567890'));assert.match(await page.locator('#featurePage').textContent(),/\+8613800000000/);assert.equal(await page.locator('#featurePage').getByText('短信服务',{exact:true}).count(),0);
 await go('outbox');await page.locator('#sendPhone').waitFor();
 for(const theme of ['light','dark']) {await page.locator('#themeSelect').selectOption(theme);const colors=await page.locator('.keep-alive-status.sending').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el.querySelector('.keep-alive-days')).color}));assert.notEqual(colors.bg,colors.fg);}
 await go('inbox');await page.locator('[data-message]').waitFor();await page.locator('[data-message]').click();await page.screenshot({path:'docs/workspace-mail.png',fullPage:true});
 await go('all');await page.screenshot({path:'docs/workspace-overview.png',fullPage:true});
 await page.locator('#languageSelect').selectOption('en');await page.waitForFunction(()=>document.documentElement.lang==='en');await page.waitForFunction(()=>document.getElementById('totalModules').textContent==='2');
 assert.match(await page.locator('[data-view="settings"]').textContent(),/Settings/);
 await go('inbox');await page.locator('[data-message]').waitFor();assert.match(await page.locator('#mailRows').textContent(),/测试来信/);assert.match(await page.locator('#mailRows').textContent(),/Receiving SIM/);
 for(const view of ['device','sim-overview','sim-details','outbox','forwarding','logs','backup','cache','upgrade','settings']){await go(view);assert.equal(await page.locator('.modal').count(),0);}
 await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.goto(fixture.origin+'/login.html');assert.equal(await page.locator('#languageSelect').inputValue(),'en');assert.match(await page.locator('h1').textContent(),/Sign in/);
 await page.locator('#languageSelect').selectOption('zh');await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');assert.match(await page.locator('h1').textContent(),/登录工作台/);
 const missing=await createFixture({noNumber:true});try{const p=await browser.newPage();await p.context().addCookies([{name:'test-auth',value:'1',url:missing.origin}]);await p.goto(missing.origin);await p.waitForFunction(()=>MailWorkspace.state.modules.length===2);await p.locator('[data-view="sim-details"]').click();await p.locator('#simPhone').waitFor();await p.locator('#simPhone').fill('+8613900000000');await p.locator('[data-form="sim-number"] [type="submit"]').click();await p.waitForFunction(()=>MailWorkspace.state.mail.messages[0].recipientPhone==='+8613900000000');await p.locator('[data-view="unread"]').click();assert.match(await p.locator('#mailRows').textContent(),/\+8613900000000/);await p.close();}finally{await missing.close();}
 assert.deepEqual(errors,[]);console.log('Workspace browser checks passed: all standalone pages, mailbox/favorites/read state, escaped SMS, live form retention, SIM parsing, themes and mobile layouts.');
} finally {await browser.close();await fixture.close();}
