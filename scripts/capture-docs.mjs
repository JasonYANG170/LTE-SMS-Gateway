import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createFixture} from '../tests/fixture.cjs';
// Documentation images use explicit demo data; never connect to a deployed gateway.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'docs','screenshots');await fs.mkdir(output,{recursive:true});
const fixture=await createFixture();
const timestamp='2026-01-01T08:00:00Z';
const samples=[
 {id:'a'.repeat(64),phone:'138****1001',recipientPhone:'138****0001',content:'演示短信：这是一条用于界面展示的示例消息，不包含真实短信内容。',port:'/dev/ttyACM0',iccid:'DEMO-SIM-A',operator:'46000',time:timestamp,storageLocation:'sim',unread:true,favorite:false},
 {id:'b'.repeat(64),phone:'139****2002',recipientPhone:'139****0002',content:'演示通知：短信备份已完成。你可以在备份与恢复页面下载示例档案。',port:'/dev/ttyACM1',iccid:'DEMO-SIM-B',operator:'46001',time:timestamp,storageLocation:'disk',unread:false,favorite:true},
 {id:'c'.repeat(64),phone:'示例发送方',recipientPhone:'138****0001',content:'欢迎使用 LTE Gateway。所有号码、卡片标识与消息均为演示数据。',port:'/dev/ttyACM0',iccid:'DEMO-SIM-A',operator:'46000',time:timestamp,storageLocation:'disk',unread:false,favorite:false}
];
Object.assign(fixture.modules['/dev/ttyACM0'],{iccid:'DEMO-SIM-A',imei:'DEMO-MODULE-A',messages:[],diskMessageCount:2,storageInfo:{used:8,total:50},keepAlive:{enabled:false}});
Object.assign(fixture.modules['/dev/ttyACM1'],{status:'ok',iccid:'DEMO-SIM-B',imei:'DEMO-MODULE-B',operatorInfo:{oper:'46001',format:2,act:7},messages:[],diskMessageCount:1,storageInfo:{used:12,total:50},keepAlive:{enabled:false}});
const browser=await chromium.launch({channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
 await page.clock.install({time:new Date(timestamp)});
 await page.route('**/api/workspace/mail',route=>route.fulfill({json:{success:true,messages:samples,outbox:[{id:'demo-sent',port:'/dev/ttyACM0',phone:'138****9000',content:'演示发件：此消息仅用于截图，没有实际发送。',time:timestamp,state:'sent'}],schedules:[]}}));
 await page.route('**/api/keep-alive/*',route=>route.fulfill({json:{success:true,config:{enabled:false,targetPhone:'138****9000',intervalDays:30,message:'演示保号短信'}}}));
 async function capture(name){
  const text=await page.locator('body').innerText();
  if(/\b1[3-9]\d{9}\b|\b\d{15,22}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text))throw Error('Unmasked identifier in screenshot: '+name);
  if(name==='login' && (await page.locator('#username').inputValue() || await page.locator('#password').inputValue()))throw Error('Login must remain empty');
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:name==='outbox'});
 }
 await page.goto(fixture.origin+'/login.html');await page.locator('#themeSelect').selectOption('light');await capture('login');
 await page.context().addCookies([{name:'test-auth',value:'1',url:fixture.origin}]);await page.goto(fixture.origin);await page.waitForFunction(()=>MailWorkspace.state.modules.length===2);await page.waitForFunction(()=>MailWorkspace.state.mail.messages.length===3);
 await capture('overview-light');
 await page.evaluate(()=>MailWorkspace.open('inbox'));await page.locator('[data-message]').first().waitFor();await page.evaluate(()=>{MailWorkspace.state.selected='a'.repeat(64);MailWorkspace.state.mail.messages[0].unread=false;});await page.locator('[data-message]').first().click();await capture('inbox');
 await page.evaluate(()=>MailWorkspace.open('outbox'));await page.locator('#sendPhone').fill('138****9000');await page.locator('#sendContent').fill('这是一条用于界面展示的演示短信，不会实际发送。');await capture('outbox');
 await page.evaluate(()=>MailWorkspace.open('all'));await page.locator('#themeSelect').selectOption('dark');await capture('overview-dark');
 await page.locator('#themeSelect').selectOption('light');await page.setViewportSize({width:390,height:960});await page.evaluate(()=>MailWorkspace.open('inbox'));await capture('mobile');
 console.log('Generated six documentation screenshots from masked demo data only.');
}finally{await browser.close();await fixture.close();}
