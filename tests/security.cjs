const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawn}=require('child_process');
const project=path.join(__dirname,'..');
const {base32,hotp,matchTotp,createCrypto,createLoginGuard}=require('../security');
const vectors=[[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']];
for(const [time,code]of vectors)assert.equal(hotp(base32(Buffer.from('12345678901234567890')),Math.floor(time/30),8),code);
assert.equal(matchTotp(base32(Buffer.alloc(20)),123456),null);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lte-security-test-'));
fs.mkdirSync(path.join(tmp,'.security'),{mode:0o700});fs.writeFileSync(path.join(tmp,'.security/secrets.json'),JSON.stringify({encryptionKey:crypto.randomBytes(32).toString('hex'),sessionSecret:crypto.randomBytes(48).toString('hex')}));
const guardDir=path.join(tmp,'guard-fixture');fs.mkdirSync(guardDir);let now=100000000;let guard=createLoginGuard(guardDir,()=>now);const req={ip:'test-client'},response={set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
assert.deepEqual(guard.getPolicy(),{maxFailures:3,lockMinutes:15});assert.equal(guard.failed(req,response),true);assert.equal(guard.failed(req,response),true);assert.equal(guard.failed(req,response),false);assert.equal(response.code,429);assert.equal(response.body.retryAfter,900);
guard=createLoginGuard(guardDir,()=>now);assert.equal(guard.check(req,response),false);now+=900001;assert.equal(guard.check(req,response),true);guard.failed(req,response);guard.success(req);assert.equal(guard.failed(req,response),true);guard.setPolicy({maxFailures:2,lockMinutes:1});assert.equal(guard.failed(req,response),false);assert.equal(response.body.retryAfter,60);now+=60001;assert.equal(guard.check(req,response),true);
const vault=createCrypto(tmp);const encrypted=vault.encrypt('sensitive message');assert.equal(vault.decrypt(encrypted),'sensitive message');assert.equal(vault.decrypt(encrypted.slice(0,-2)+'ff'),null);
for(const name of ['server.js','security.js','https-manager.js','github-updates.js','gateway-workspace.js','sim-parser.js','package.json'])fs.copyFileSync(path.join(project,name),path.join(tmp,name));
fs.symlinkSync(path.join(project,'node_modules'),path.join(tmp,'node_modules'),process.platform==='win32'?'junction':'dir');fs.cpSync(path.join(project,'public'),path.join(tmp,'public'),{recursive:true});
const testPort=15000+crypto.randomInt(40000),marker=crypto.randomUUID();
fs.writeFileSync(path.join(tmp,'public','test-fixture-marker.txt'),marker);
fs.writeFileSync(path.join(tmp,'gateway-config.json'),JSON.stringify({port:testPort,bindHost:'127.0.0.1'}));
fs.writeFileSync(path.join(tmp,'credentials.json'),JSON.stringify({username:vault.encrypt('security-test'),password:require('bcrypt').hashSync('Fixture-password-very-long',10)}));
fs.writeFileSync(path.join(tmp,'login.log'),'[2026-10-01T00:00:00.000Z] IP: 192.0.2.99 | User: old-user | Status: FAILED | Error: bad password\n');
// Prevent test execution from opening production serial ports or sending messages.
fs.writeFileSync(path.join(tmp,'fake-serial.cjs'),`const Module=require('module'),EventEmitter=require('events');const load=Module._load;class Fake extends EventEmitter{constructor(){super();this.isOpen=false;}static async list(){return [];}open(cb){if(cb)cb(new Error('No hardware in security test'));}close(cb){if(cb)cb();}write(data,cb){if(cb)cb(new Error('No hardware'));}}Module._load=function(name,...rest){return name==='serialport'?{SerialPort:Fake}:load.call(this,name,...rest)};`);
const child=spawn(process.execPath,['--require',path.join(tmp,'fake-serial.cjs'),path.join(tmp,'server.js')],{cwd:tmp,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',d=>errors+=d);child.stdout.resume();
const base='http://127.0.0.1:'+testPort;let cookie='',csrf='';
async function request(url,body,extra={}){const r=await fetch(base+url,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),Origin:base,...(body!==undefined?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];let v;try{v=await r.json();}catch{}return {r,v};}
async function token(){csrf=(await request('/api/security/csrf')).v.token;}
async function login(code){return request('/api/login',{username:'security-test',password:'Fixture-password-very-long',code});}
async function wsStatus(headers,url=base.replace('http:','ws:'),options={}){return new Promise((resolve,reject)=>{const ws=new(require('ws'))(url,{headers,...options});const t=setTimeout(()=>{ws.terminate();reject(new Error('WebSocket timeout'));},3000);ws.on('unexpected-response',(_,r)=>{clearTimeout(t);r.resume();resolve(r.statusCode);});ws.on('open',()=>{clearTimeout(t);ws.close();resolve(101);});ws.on('error',()=>{});});}
(async()=>{
 let ready=false;for(let n=0;n<60;n++){if(child.exitCode!==null)throw Error('Fixture server exited before startup');try{const response=await fetch(base+'/test-fixture-marker.txt');if(await response.text()===marker){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'Isolated fixture identity must be verified before authentication tests');
 assert.equal((await request('/api/security/login-failures')).r.status,401);assert.equal((await request('/api/modules')).r.status,401);assert.equal((await request('/index.html')).r.status,302);
 assert.equal(await wsStatus({Origin:base}),401);assert.equal(await wsStatus({Origin:'https://evil.example'}),403);
 assert.equal((await request('/api/login',{})).r.status,403);
 await token();assert.equal((await login()).v.success,true);await token();
 const tlsPort=testPort+1,tlsOrigin='https://127.0.0.1:'+tlsPort;
 const tlsSetup=await request('/api/security/https',{operation:'generate',hosts:['127.0.0.1'],port:tlsPort,enabled:true,redirectHttp:false,password:'Fixture-password-very-long'});assert.equal(tlsSetup.v.active,true);
 const certificate=await (await fetch(base+'/api/security/https/certificate',{headers:{Cookie:cookie}})).text();
 assert.equal(await wsStatus({Origin:tlsOrigin},tlsOrigin.replace('https:','wss:'),{ca:certificate}),401);
 async function tlsCall(url,body){return new Promise((resolve,reject)=>{const r=require('https').request(tlsOrigin+url,{ca:certificate,agent:false,method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:tlsOrigin,...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf})}},response=>{let text='';response.on('data',d=>text+=d);response.on('end',()=>{if(response.headers['set-cookie'])cookie=response.headers['set-cookie'][0].split(';')[0];resolve({status:response.statusCode,headers:response.headers,value:JSON.parse(text)});});});r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));});}
 const tlsLogin=await tlsCall('/api/login',{username:'security-test',password:'Fixture-password-very-long'});assert.equal(tlsLogin.value.success,true);assert.ok(tlsLogin.headers['set-cookie'][0].includes('Secure'));
 csrf=(await tlsCall('/api/security/csrf')).value.token;assert.equal(await wsStatus({Origin:tlsOrigin,Cookie:cookie},tlsOrigin.replace('https:','wss:'),{ca:certificate}),101);
 assert.equal((await tlsCall('/api/security/https',{operation:'configure',enabled:false,port:tlsPort,redirectHttp:false,password:'Fixture-password-very-long'})).value.active,false);
 cookie='';await token();assert.equal((await login()).v.success,true);await token();
 assert.equal((await request('/api/security/login-policy')).v.maxFailures,3);
 assert.equal((await request('/api/security/login-policy',{maxFailures:2,lockMinutes:1})).r.status,403);
 assert.equal((await request('/api/security/login-policy',{maxFailures:2,lockMinutes:1,password:'Fixture-password-very-long'})).v.success,true);
 assert.equal((await request('/api/security/login-policy')).v.maxFailures,2);
 assert.equal((await request('/api/modules')).r.status,200);assert.equal(await wsStatus({Origin:base,Cookie:cookie}),101);
 assert.equal((await request('/api/send',{port:'/dev/ttyACM0',phone:'+65;AT',message:'test'})).r.status,400);
   assert.equal((await request('/api/workspace/upgrade/install',{})).r.status,403);
 assert.equal((await request('/api/logout',{}, {Origin:'https://evil.example'})).r.status,403);
 assert.equal((await request('/api/update-credentials',{username:'hijacked'})).r.status,403);
 const setup=(await request('/api/security/totp/setup',{password:'Fixture-password-very-long'})).v;assert.ok(setup.qr.startsWith('data:image/png;base64,'));
 const counter=Math.floor(Date.now()/30000),enabled=await request('/api/security/totp/enable',{code:hotp(setup.secret,counter-1)});assert.equal(enabled.v.success,true);assert.equal(enabled.v.recoveryCodes.length,10);
 assert.equal((await request('/api/security/totp')).v.enabled,true);assert.ok(!fs.readFileSync(path.join(tmp,'.security/totp.enc'),'utf8').includes(setup.secret));
 await request('/api/logout',{});cookie='';await token();assert.equal((await login()).v.requiresTotp,true);assert.equal((await login('000000')).r.status,401);
 assert.equal((await login(hotp(setup.secret,counter))).v.success,true);await token();
 await request('/api/logout',{});cookie='';await token();assert.equal((await login(hotp(setup.secret,counter))).r.status,401);
 assert.equal((await login(enabled.v.recoveryCodes[0])).v.success,true);await token();await request('/api/logout',{});cookie='';await token();assert.equal((await login(enabled.v.recoveryCodes[0])).r.status,401);
 assert.equal((await login(enabled.v.recoveryCodes[1])).v.success,true);await token();assert.equal((await request('/api/security/totp/disable',{password:'Fixture-password-very-long',code:enabled.v.recoveryCodes[2]})).v.success,true);
 assert.equal((await request('/api/security/totp')).v.enabled,false);
 const audit=await request('/api/security/login-failures');assert.equal(audit.v.success,true);assert.ok(audit.v.records.some(r=>r.ip==='192.0.2.99'&&r.source==='legacy'));assert.ok(audit.v.records.some(r=>r.reason==='totp'));assert.ok(!JSON.stringify(audit.v).includes('Fixture-password'));assert.ok(!JSON.stringify(audit.v).includes(enabled.v.recoveryCodes[0]));assert.ok(audit.v.ips.some(r=>r.ip==='127.0.0.1'&&r.consecutiveFailures===0));
 assert.ok(fs.readFileSync(path.join(tmp,'.security/login-failures.enc'),'utf8').startsWith('v2:'));assert.ok(!fs.readFileSync(path.join(tmp,'.security/login-failures.enc'),'utf8').includes('192.0.2.99'));
 const checks=[];for(let n=0;n<12;n++){await token();checks.push((await request('/api/login',{username:'security-test',password:'Wrong-password'})).r.status);}assert.equal(checks[0],200);assert.equal(checks[1],429);assert.equal((await login()).r.status,429);assert.equal((await request('/api/security/login-status')).v.locked,true);const lockedAudit=(await request('/api/security/login-failures')).v;assert.ok(lockedAudit.ips.some(r=>r.ip==='127.0.0.1'&&r.lockedUntil>Date.now()));assert.ok(lockedAudit.records[0].time>=lockedAudit.records[lockedAudit.records.length-1].time);
 console.log('PASS: RFC 6238 vectors, AES-GCM tamper rejection, unauthenticated HTTP/WebSocket, CSRF/origin checks, authenticated WebSocket/WSS, Secure HTTPS session cookies, TLS disable response, upgrade denial, credential step-up, TOTP enrollment/login/replay/recovery/disable, configurable failed-login lockout, persisted state, fake-clock expiry, successful-login reset, active lockout blocks correct passwords, authenticated failure audit, historical import, post-success history retention, IP grouping and encrypted audit storage');
})().catch(e=>{console.error(e);console.error(errors);process.exitCode=1;}).finally(()=>{child.kill();child.once('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));});
