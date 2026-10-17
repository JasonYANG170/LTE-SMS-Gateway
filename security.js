'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const bcrypt = require('bcrypt');
const {ServerResponse} = require('http');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function base32(bytes) {
  let bits=0,value=0,result='';
  for(const byte of bytes) {value=(value<<8)|byte;bits+=8;while(bits>=5){result+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value>>>(bits-5))&31];bits-=5;}}
  if(bits)result+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value<<(5-bits))&31];return result;
}
function unbase32(text) {
  let bits=0,value=0,bytes=[];
  for(const char of text){const n='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);if(n<0)throw new Error('Invalid TOTP secret');value=(value<<5)|n;bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
  return Buffer.from(bytes);
}
function hotp(secret,counter,digits=6) {
  const data=Buffer.alloc(8);data.writeBigUInt64BE(BigInt(counter));const hmac=crypto.createHmac('sha1',unbase32(secret)).update(data).digest();const offset=hmac[19]&15;
  return String((hmac.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');
}
function matchTotp(secret,code,last=-1,now=Date.now()) {
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  const counter=Math.floor(now/30000);
  for(const step of [0,-1,1])if(counter+step>last&&equal(hotp(secret,counter+step),code))return counter+step;
  return null;
}
function createLoginGuard(dir,clock=Date.now) {
  const policyFile=path.join(dir,'login-policy.json'),stateFile=path.join(dir,'login-attempts.json');
  let policy=fs.existsSync(policyFile)?JSON.parse(fs.readFileSync(policyFile,'utf8')):{maxFailures:3,lockMinutes:15};
  const rows=new Map(fs.existsSync(stateFile)?Object.entries(JSON.parse(fs.readFileSync(stateFile,'utf8'))):[]);
  const write=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  const persist=()=>write(stateFile,Object.fromEntries(rows));
  const blocked=(res,until)=>{const retryAfter=Math.max(1,Math.ceil((until-clock())/1000));res.set('Retry-After',String(retryAfter));res.status(429).json({success:false,locked:true,retryAfter,error:`登录错误次数过多，请等待 ${Math.ceil(retryAfter/60)} 分钟后重试`});return false;};
  function check(req,res) {
    const row=rows.get(req.ip);if(row?.lockedUntil>clock())return blocked(res,row.lockedUntil);
    if(row&&row.expires<=clock()){rows.delete(req.ip);persist();}
    return true;
  }
  function failed(req,res) {
    const now=clock();for(const [key,row]of rows)if(row.expires<=now)rows.delete(key);
    if(rows.size>=5000&&!rows.has(req.ip)){res.status(503).json({success:false,error:'登录服务繁忙，请稍后重试'});return false;}
    const row=rows.get(req.ip)||{failures:0};row.failures++;
    if(row.failures>=policy.maxFailures){row.lockedUntil=now+policy.lockMinutes*60000;row.expires=row.lockedUntil;}
    else row.expires=now+15*60000;
    rows.set(req.ip,row);persist();if(row.lockedUntil>now)return blocked(res,row.lockedUntil);return true;
  }
  function success(req){if(rows.delete(req.ip))persist();}
  function setPolicy(value){if(!Number.isInteger(value.maxFailures)||value.maxFailures<1||value.maxFailures>10||!Number.isInteger(value.lockMinutes)||value.lockMinutes<1||value.lockMinutes>60)throw new Error('错误次数需为1–10，等待时间需为1–60分钟');policy={maxFailures:value.maxFailures,lockMinutes:value.lockMinutes};write(policyFile,policy);}
  return {check,failed,success,setPolicy,getPolicy:()=>({...policy}),getState:()=>Object.fromEntries([...rows].filter(([,r])=>r.expires>clock()).map(([ip,r])=>[ip,{failures:r.failures,lockedUntil:r.lockedUntil>clock()?r.lockedUntil:null}]))};
}
function createCrypto(root) {
  const dir=path.join(root,'.security');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'secrets.json');
  // Refuse to create a replacement key if an existing installation lost its key.
  if(!fs.existsSync(file))throw new Error('Missing deployment encryption key; restore .security/secrets.json');
  const secrets=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!/^[a-f0-9]{64}$/.test(secrets.encryptionKey)||!/^[a-f0-9]{96}$/.test(secrets.sessionSecret))throw new Error('Invalid deployment secrets');
  const key=Buffer.from(secrets.encryptionKey,'hex');
  function encrypt(text) {const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return ['v2',iv.toString('hex'),cipher.getAuthTag().toString('hex'),data.toString('hex')].join(':');}
  function decrypt(text) {try {const [v,iv,tag,data,...extra]=text.split(':');if(v!=='v2'||extra.length||!/^[a-f0-9]{24}$/.test(iv)||!/^[a-f0-9]{32}$/.test(tag)||!/^([a-f0-9]{2})*$/.test(data))return null;const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'hex'));decipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(data,'hex')),decipher.final()]).toString('utf8');}catch{return null;}}
  return {encrypt,decrypt,sessionSecret:secrets.sessionSecret,dir};
}
function installSecurity(app,{root,runtimeConfig,vault}) {
  process.umask(0o077);app.disable('x-powered-by');
  // Forwarded headers are trusted only from explicitly configured reverse proxies.
  app.set('trust proxy',runtimeConfig.trustedProxies || ['loopback']);
  const store=new session.MemoryStore();
  const middleware=session({name:'gateway.sid',secret:vault.sessionSecret,store,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'strict',secure:'auto',maxAge:8*60*60*1000}});
  const credentialPath=path.join(root,'credentials.json'),totpPath=path.join(vault.dir,'totp.enc');
  const readTotp=()=>{if(!fs.existsSync(totpPath))return {enabled:false,version:'initial'};const plain=vault.decrypt(fs.readFileSync(totpPath,'utf8'));if(!plain)throw new Error('TOTP data authentication failed');return JSON.parse(plain);};
  const saveTotp=value=>{fs.writeFileSync(totpPath+'.tmp',vault.encrypt(JSON.stringify(value)),{mode:0o600});fs.renameSync(totpPath+'.tmp',totpPath);};
  const version=()=>sha(fs.readFileSync(credentialPath,'utf8')+readTotp().version);
  const valid=s=>Boolean(s?.authenticated&&s.authVersion===version()&&s.cookie?.expires&&new Date(s.cookie.expires)>new Date());
  function originAllowed(req) {
    if(!req.headers.origin)return !['cross-site','same-site'].includes(req.headers['sec-fetch-site']);
    const proxy=app.get('trust proxy fn');
    const secure=Boolean(req.secure||req.socket.encrypted||(proxy?.(req.socket.remoteAddress,0)&&String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https'));
    try {const origin=new URL(req.headers.origin);return ['http:','https:'].includes(origin.protocol)&&(runtimeConfig.allowedOrigins ? runtimeConfig.allowedOrigins.includes(origin.origin) : origin.host===req.headers.host && origin.protocol===(secure?'https:':'http:'));}catch{return false;}
  }
  const buckets=new Map();
  const loginGuard=createLoginGuard(vault.dir),loginBusy=new Set();
  const auditFile=path.join(vault.dir,'login-failures.enc');
  const normalizeIP=ip=>String(ip||'unknown').replace(/^::ffff:/,'');
  let failureAudit=[];
  const saveFailureAudit=()=>{fs.writeFileSync(auditFile+'.tmp',vault.encrypt(JSON.stringify(failureAudit)),{mode:0o600});fs.renameSync(auditFile+'.tmp',auditFile);};
  if(fs.existsSync(auditFile)) {
    const plain=vault.decrypt(fs.readFileSync(auditFile,'utf8'));if(plain===null)throw new Error('Login failure audit authentication failed');failureAudit=JSON.parse(plain);
  } else {
    const legacy=path.join(root,'login.log');
    if(fs.existsSync(legacy)) {
      const fd=fs.openSync(legacy,'r');try{const size=fs.fstatSync(fd).size,count=Math.min(size,256*1024),buffer=Buffer.alloc(count);fs.readSync(fd,buffer,0,count,size-count);
        for(const line of buffer.toString('utf8').split('\n')){const m=line.match(/^\[([^\]]+)\] IP: ([^|]+) \| User: .*? \| Status: FAILED(?: \| Error: (.*))?$/);if(m&&Number.isFinite(Date.parse(m[1])))failureAudit.push({id:crypto.randomUUID(),time:new Date(m[1]).toISOString(),ip:normalizeIP(m[2].trim()),reason:'legacy',source:'legacy'});}
      }finally{fs.closeSync(fd);}
    }
    failureAudit=failureAudit.slice(-1000);saveFailureAudit();
  }
  function loginFailed(req,res,reason='credentials') {
    failureAudit.push({id:crypto.randomUUID(),time:new Date().toISOString(),ip:normalizeIP(req.ip),reason:reason==='totp'?'totp':'credentials',source:'verified'});
    failureAudit=failureAudit.slice(-2000);saveFailureAudit();return loginGuard.failed(req,res);
  }

  function limit(req,res,kind='login') {
    if(kind==='login') {
      if(!loginGuard.check(req,res))return false;
      if(loginBusy.has(req.ip)){res.set('Retry-After','1');res.status(429).json({success:false,retryAfter:1,error:'正在验证登录，请稍后重试'});return false;}
      loginBusy.add(req.ip);res.once('finish',()=>loginBusy.delete(req.ip));return true;
    }
    const now=Date.now(),key=kind+':'+req.ip;let b=buckets.get(key);
    if(!b||b.until<=now){b={n:0,until:now+15*60*1000};buckets.set(key,b);}
    if(++b.n>(kind==='bootstrap'?100:10)){res.set('Retry-After',String(Math.ceil((b.until-now)/1000)));res.status(429).json({success:false,error:'尝试次数过多，请15分钟后重试'});return false;}
    return true;
  }
  const cleanup=setInterval(()=>{for(const [k,b] of buckets)if(b.until<Date.now())buckets.delete(k);store.all((e,rows)=>{if(!e)for(const [id,s]of Object.entries(rows||{}))if(new Date(s.cookie.expires)<=new Date())store.destroy(id);});},60000);cleanup.unref();
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
    if(req.secure)res.set('Strict-Transport-Security','max-age=31536000');
    if(buckets.size>10000)return res.status(503).json({success:false,error:'服务繁忙'});
    next();
  });
  app.use(middleware);
  app.get('/api/security/login-status',(req,res)=>{if(loginGuard.check(req,res))res.json({success:true,locked:false});});
  app.get('/api/security/csrf',(req,res)=>{if(!limit(req,res,'bootstrap'))return;if(Object.keys(store.sessions).length>=5000&&!store.sessions[req.sessionID])return res.status(503).json({success:false,error:'服务繁忙'});if(!req.session.csrf)req.session.csrf=crypto.randomBytes(32).toString('hex');res.json({success:true,token:req.session.csrf});});
  app.use('/api',(req,res,next)=>{
    if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
    if(!originAllowed(req)||!equal(req.session.csrf,req.headers['x-csrf-token']))return res.status(403).json({success:false,error:'请求校验失败，请刷新页面后重试'});
    next();
  });
  function requireAuth(req,res,next) {try{if(valid(req.session))return next();}catch{}res.status(401).json({success:false,error:'登录已失效，请重新登录'});}
  function consumeTotp(code) {
    const config=readTotp();if(!config.enabled)return true;
    const counter=matchTotp(config.secret,code,config.lastCounter);
    if(counter!==null){config.lastCounter=counter;saveTotp(config);return true;}
    if(typeof code!=='string')return false;
    const index=(config.recovery||[]).findIndex(h=>equal(h,sha(code.trim().toUpperCase())));
    if(index<0)return false;config.recovery.splice(index,1);saveTotp(config);return true;
  }
  async function checkPassword(password) {if(typeof password!=='string'||Buffer.byteLength(password)>72)return false;const c=JSON.parse(fs.readFileSync(credentialPath,'utf8'));return bcrypt.compare(password,c.password);}
  const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('Security operation failed:',e.message);if(!res.headersSent)res.status(400).json({success:false,error:'安全设置操作失败，请重试'});}};
  app.get('/api/security/login-failures',requireAuth,(req,res)=>{
    const page=Math.max(1,Math.min(40,parseInt(req.query.page,10)||1)),size=50,state=loginGuard.getState(),now=Date.now(),byIP=new Map();
    for(const event of failureAudit){const old=byIP.get(event.ip);byIP.set(event.ip,{ip:event.ip,totalFailures:(old?.totalFailures||0)+1,lastFailure:event.time});}
    const locks=new Map(Object.entries(state).map(([ip,row])=>[normalizeIP(ip),row]));
    const ips=[...byIP.values()].map(row=>({...row,consecutiveFailures:locks.get(row.ip)?.failures||0,lockedUntil:locks.get(row.ip)?.lockedUntil||null})).sort((a,b)=>b.lastFailure.localeCompare(a.lastFailure));
    res.json({success:true,page,pageSize:size,total:failureAudit.length,retention:2000,serverTime:now,ips,records:failureAudit.slice().reverse().slice((page-1)*size,page*size)});
  });
  app.get('/api/security/login-policy',requireAuth,(req,res)=>res.json({success:true,...loginGuard.getPolicy()}));
  app.post('/api/security/login-policy',requireAuth,route(async(req,res)=>{
    if(!limit(req,res,'security'))return;
    if(!await checkPassword(req.body.password)||!consumeTotp(req.body.code))return res.status(403).json({success:false,error:'当前密码或验证码错误'});
    const {maxFailures,lockMinutes}=req.body;
    if(!Number.isInteger(maxFailures)||maxFailures<1||maxFailures>10||!Number.isInteger(lockMinutes)||lockMinutes<1||lockMinutes>60)return res.status(400).json({success:false,error:'错误次数需为1–10，等待时间需为1–60分钟'});
    loginGuard.setPolicy({maxFailures,lockMinutes});res.json({success:true,...loginGuard.getPolicy()});
  }));
  app.get('/api/security/totp',requireAuth,(req,res)=>{const c=readTotp();res.json({success:true,enabled:c.enabled,recoveryRemaining:(c.recovery||[]).length});});
  app.post('/api/security/totp/setup',requireAuth,route(async(req,res)=>{
    if(!limit(req,res,'security'))return;if(!await checkPassword(req.body.password))return res.status(403).json({success:false,error:'当前密码错误'});
    if(readTotp().enabled)return res.status(409).json({success:false,error:'已启用双重验证'});
    const secret=base32(crypto.randomBytes(20));req.session.pendingTotp={secret,expires:Date.now()+5*60*1000};
    const account=vault.decrypt(JSON.parse(fs.readFileSync(credentialPath,'utf8')).username);
    const uri=`otpauth://totp/${encodeURIComponent('LTE SMS Gateway:'+account)}?secret=${secret}&issuer=LTE%20SMS%20Gateway&algorithm=SHA1&digits=6&period=30`;
    const qr=await require('qrcode').toDataURL(uri,{errorCorrectionLevel:'M',width:240});res.json({success:true,secret,uri,qr});
  }));
  app.post('/api/security/totp/enable',requireAuth,route(async(req,res)=>{
    if(!limit(req,res,'security'))return;const pending=req.session.pendingTotp;
    if(readTotp().enabled||!pending||pending.expires<Date.now())return res.status(400).json({success:false,error:'绑定已过期，请重新开始'});
    const counter=matchTotp(pending.secret,req.body.code);if(counter===null)return res.status(403).json({success:false,error:'验证码错误，请检查手机时间'});
    const codes=Array.from({length:10},()=>crypto.randomBytes(10).toString('hex').toUpperCase());
    saveTotp({enabled:true,version:crypto.randomUUID(),secret:pending.secret,lastCounter:counter,recovery:codes.map(sha)});
    delete req.session.pendingTotp;req.session.authVersion=version();res.json({success:true,recoveryCodes:codes});
  }));
  app.post('/api/security/totp/disable',requireAuth,route(async(req,res)=>{
    if(!limit(req,res,'security'))return;
    if(!await checkPassword(req.body.password)||!consumeTotp(req.body.code))return res.status(403).json({success:false,error:'密码或验证码错误'});
    saveTotp({enabled:false,version:crypto.randomUUID()});req.session.authVersion=version();res.json({success:true});
  }));
  function attachWebSocket(server,wss) {
    server.on('upgrade',(req,socket,head)=>{
      if(!originAllowed(req)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      middleware(req,new ServerResponse(req),()=>{
        let authorized=false;try{authorized=valid(req.session);}catch{}
        if(!authorized){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
        wss.handleUpgrade(req,socket,head,ws=>{ws.sessionID=req.sessionID;wss.emit('connection',ws,req);});
      });
    });
  }
  async function authorizeMaintenance(req,res) {
    if(!limit(req,res,'security'))return false;
    if(!await checkPassword(req.body.password)||!consumeTotp(req.body.code)){res.status(403).json({success:false,error:'当前密码或验证码错误'});return false;}return true;
  }
  function sendSocket(ws,data) {store.get(ws.sessionID,(err,s)=>{let authorized=false;try{authorized=!err&&valid(s);}catch{}if(!authorized){ws.close(1008,'Session expired');return;}if(ws.readyState===1)ws.send(data);});}
  return {authorizeMaintenance,middleware,requireAuth,limit,version,valid,consumeTotp,readTotp,checkPassword,attachWebSocket,sendSocket,loginFailed,loginSucceeded:loginGuard.success,endLogin:req=>loginBusy.delete(req.ip)};
}
module.exports={createCrypto,installSecurity,base32,hotp,matchTotp,createLoginGuard};
