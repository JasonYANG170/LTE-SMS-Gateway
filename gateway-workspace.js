const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const { QUERIES, parseResponse, identifiers } = require('./sim-parser');
const VERSION = '3.1.0';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const messageId = (port, message, iccid = '') => hash(JSON.stringify([iccid || port, message.pdu || '', message.phone || '', message.time || '', message.content || '']));
const UPDATE_FILES = ['gateway-workspace.js','sim-parser.js','server.js','public/style.css','public/studio.css','public/mail-workspace.css','public/theme.js','public/i18n.js','public/workspace.js','public/mail-workspace.js','public/app.js','public/login.html','public/index.html'];

function createWorkspace(ctx) {
  const root = ctx.root;
  const dataDir = path.join(root, 'workspace-data');
  const dirs = Object.fromEntries(['backups','snapshots','logs','uploads'].map(k => [k,path.join(dataDir,k)]));
  for (const dir of [dataDir,...Object.values(dirs)]) fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const dbFile = path.join(dataDir,'mail-state.enc');
  let db = { meta:{}, simCards:{}, simNumbers:{}, outbox:[], schedules:[], upgrade:{ state:'idle' } };
  if (fs.existsSync(dbFile)) { const raw=ctx.decrypt(fs.readFileSync(dbFile,'utf8')); if (!raw) throw new Error('工作台数据解密失败'); db={...db,...JSON.parse(raw)}; }
  for(const job of db.schedules) if(job.state==='sending') {job.state='uncertain';job.error='服务在发送期间重启，请核对发件记录，避免重复发送';}
  if(db.upgrade.state==='running') db.upgrade={...db.upgrade,state:'interrupted',error:'服务中断，请检查快照后重新导入'};
  const persist = () => { const temp=dbFile+'.tmp';fs.writeFileSync(temp,ctx.encrypt(JSON.stringify(db)),{mode:0o600});fs.renameSync(temp,dbFile); };
  persist();
  const queryLocks = new Set();
  const deferredCommands = new Map();
  const details = new Map();
  const inspections = new Map();
  let stopped=false;
  const logPath = port => path.join(dirs.logs,hash(port)+'.jsonl');
  const deploymentDir=path.join(root,'ui-backups');
  function deploymentStats(name) {
    const base=path.join(deploymentDir,name);const rows=[];let size=0;
    const walk=dir=>{for(const entry of fs.readdirSync(dir)){const file=path.join(dir,entry),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw new Error('快照包含符号链接');if(stat.isDirectory())walk(file);else if(stat.isFile()){size+=stat.size;rows.push([path.relative(base,file),stat.size,stat.mtimeMs]);}}};
    walk(base);return {size,stamp:hash(JSON.stringify(rows.sort())),created:fs.statSync(base).mtime.toISOString()};
  }
  const route = fn => async(req,res) => { try { await fn(req,res); } catch(e) { if(!res.headersSent) res.status(e.status || 400).json({success:false,error:e.message}); else res.destroy(); } };
  const fail = (message,status=400) => { const e=new Error(message);e.status=status;throw e; };
  const portOf = value => { const port = value?.startsWith('/dev/') ? value : '/dev/'+value; if(!ctx.modules[port]) fail('模块不存在'); return port; };
  const readEncrypted = file => { const plain=ctx.decrypt(fs.readFileSync(file,'utf8'));if(!plain) fail('文件解密失败');return JSON.parse(plain); };
  const writeEncrypted = (file,value) => {const temp=file+'.tmp';fs.writeFileSync(temp,ctx.encrypt(JSON.stringify(value)),{mode:0o600});fs.renameSync(temp,file);};
  function allMail() {
    const result=[],seen=new Set();
    const ports=new Set(Object.keys(ctx.modules));
    for(const file of fs.readdirSync(ctx.diskDir)) if(/^sms-[\w.-]+\.json$/.test(file)) ports.add('/dev/'+file.slice(4,-5));
    for(const port of ports) {
      const mod=ctx.modules[port] || {port};
      for(const message of [...(mod.messages||[]).map(m=>({...m,storageLocation:'sim'})),...ctx.loadDiskMessages(port)]) {
        const id=message.id || messageId(port,message,message.simIccid || mod.iccid);
        if(seen.has(id)) continue;seen.add(id);
        const meta=db.meta[id] || {};
        const unread=meta.read!==undefined ? !meta.read : ['0','REC UNREAD'].includes(String(message.status));
        const card=message.simIccid || mod.iccid || '';
        const recipientPhone=message.recipientPhone || db.simCards[card]?.phone || db.simNumbers[card] || '';
        result.push({...message,recipientPhone,id,port,iccid:message.simIccid || mod.iccid || '',operator:mod.operatorInfo?.oper || '',unread,favorite:Boolean(meta.favorite)});
      }
    }
    return result.sort((a,b)=>new Date(b.time || b.received || 0)-new Date(a.time || a.received || 0));
  }
  function recordLog(port,type,data) {
    try {
      const file=logPath(port);
      if(fs.existsSync(file) && fs.statSync(file).size>8*1024*1024) { fs.rmSync(file+'.1',{force:true}); fs.renameSync(file,file+'.1'); }
      fs.appendFileSync(file,JSON.stringify({port,type,data:String(data),time:new Date().toISOString()})+'\n',{mode:0o600});
    } catch(e) { console.error('工作台日志写入失败:',e.message); }
  }
  function recordSent(port,phone,content,result,source='manual') {
    db.outbox.unshift({id:crypto.randomUUID(),port,iccid:ctx.modules[port]?.iccid||'',phone,content,time:new Date().toISOString(),state:result.success?'sent':'failed',error:result.error||'',source});
    persist();
  }
  async function query(port,command) {
    const serial=ctx.serial[port];if(!serial?.isOpen) fail('串口未连接');
    return new Promise(resolve => {
      let buffer='',done=false;
      const finish=(state)=>{if(done)return;done=true;clearTimeout(timer);serial.removeListener('data',listener);resolve({state,raw:buffer});};
      const listener=data=>{buffer+=data.toString();if(buffer.length>16384) return finish('overflow');if(/(?:^|\r?\n)(?:OK|ERROR|\+CME ERROR:.*|\+CMS ERROR:.*)\s*(?:\r?\n|$)/.test(buffer))finish(!buffer.includes('ERROR')?'ok':/(?:^|\n)ERROR\s*(?:\r?\n|$)|\+CME ERROR:\s*(?:4|operation not supported)\s*(?:\r?\n|$)/i.test(buffer)?'unsupported':'error');};
      const timer=setTimeout(()=>finish('timeout'),2500);
      serial.on('data',listener);serial.write(command+'\r\n',e=>{if(e)finish('error');});
    });
  }
  async function collectSim(port) {
    if(restoreBusy||upgradeBusy||restartPending||queryLocks.has(port)||ctx.isSending(port)||!['ok','no_sim','module_ok'].includes(ctx.modules[port].status)) fail('模块正在初始化或执行其他任务，请稍后重试');
    queryLocks.add(port);
    try {
      const fields=[],card=ctx.modules[port].iccid;
      const previous=db.simCards[card]?.moduleIdentity===ctx.modules[port].imei?db.simCards[card]:null;
      for(const [key,label,command] of QUERIES) {
        if(stopped || ctx.modules[port].iccid!==card) break;
        const old=previous?.fields?.find(f=>f.key===key && f.state==='unsupported');
        if(old){fields.push(old);continue;}
        const response=await query(port,command);fields.push({key,label,command,...response,value:response.state==='ok'?parseResponse(key,response.raw):null});
      }
      const imsi=fields.find(f=>f.key==='imsi')?.value || '';
      const iccid=fields.find(f=>f.key==='iccid')?.value || ctx.modules[port].iccid;
      const result={port,iccid,imsi,moduleIdentity:ctx.modules[port].imei||fields.find(f=>f.key==='imei')?.value||'',identifiers:identifiers(iccid,imsi),fields,time:new Date().toISOString()};
      const phone=fields.find(f=>f.key==='number'&&f.state==='ok')?.value?.find(n=>n.number)?.number || '';
      result.phone=phone;
      if(!stopped && ctx.modules[port].iccid===card){details.set(port,result);if(iccid){db.simCards[iccid]=result;persist();}ctx.broadcast();}
      return result;
    } finally {
      queryLocks.delete(port);
      const deferred=deferredCommands.get(port)||[];deferredCommands.delete(port);
      deferred.forEach((command,index)=>setTimeout(()=>ctx.sendCommand?.(port,command),index*1000));
    }
  }
  function inspectSim(port) {
    if(inspections.has(port))return inspections.get(port);
    const promise=collectSim(port).finally(()=>inspections.delete(port));
    inspections.set(port,promise);return promise;
  }
  function cachedSim(port) {
    const card=ctx.modules[port]?.iccid;
    const cached=card ? (details.get(port)?.iccid===card?details.get(port):db.simCards[card]) || null : null;
    return cached && cached.moduleIdentity && ctx.modules[port].imei && cached.moduleIdentity!==ctx.modules[port].imei ? null : cached;
  }
  async function autoSim() {
    if(stopped)return;
    for(const [port,mod] of Object.entries(ctx.modules)) {
      if(stopped)break;
      if(mod.status!=='ok'||!mod.iccid||!ctx.serial[port]?.isOpen||ctx.isSending(port)||queryLocks.has(port))continue;
      const cached=cachedSim(port);
      if(cached && Date.now()-new Date(cached.time).getTime()<15*60*1000)continue;
      try {await inspectSim(port);}catch {} // Initialization and maintenance retry on the next cycle.
    }
  }
  const simTimer=setInterval(autoSim,15000);simTimer.unref();
  const logBuffer=[];
  function tailLogs(port) {
    const file=logPath(port);if(!fs.existsSync(file))return [];
    const fd=fs.openSync(file,'r');try {const size=fs.fstatSync(fd).size;const count=Math.min(size,256*1024);const buffer=Buffer.alloc(count);fs.readSync(fd,buffer,0,count,size-count);return buffer.toString().split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).slice(-1000);}finally{fs.closeSync(fd);}
  }
  function backupContent() { return {format:'lte-sms-backup',schema:1,created:new Date().toISOString(),messages:allMail(),outbox:db.outbox,meta:db.meta}; }
  function snapshot(label) {const name=Date.now()+'-'+crypto.randomUUID()+'.enc';writeEncrypted(path.join(dirs.snapshots,name),{...backupContent(),label});return name;}
  let restoreBusy=false,upgradeBusy=false,schedulerBusy=false,restartPending=false;
  async function streamBackup(res,content) {
    res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="LTE-SMS-${Date.now()}.jsonl"`);
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Accel-Buffering','no');
    async function line(value) { if(res.destroyed) throw new Error('下载已取消');if(!res.write(JSON.stringify(value)+'\n')) await new Promise((resolve,reject)=>{const clean=()=>{res.off('drain',drain);res.off('close',close);};const drain=()=>{clean();resolve();};const close=()=>{clean();reject(new Error('下载已取消'));};res.once('drain',drain);res.once('close',close);}); }
    await line({format:content.format,schema:1,created:content.created});
    for(const message of content.messages) await line({kind:'message',message});
    for(const message of content.outbox||[]) await line({kind:'sent',message});
    await line({kind:'metadata',meta:content.meta||{}});res.end();
  }
  function parseBackup(text) {
    const records=text.split('\n').filter(s=>s.trim()).map(s=>JSON.parse(s));
    const header=records.shift();if(header?.format!=='lte-sms-backup'||header.schema!==1)fail('不是兼容的短信备份（schema 1）');
    const messages=[],outbox=[];let meta={};
    for(const row of records) {
      if(row.kind==='message'||row.kind==='sent') {
        const m=row.message;
        if(!m||!/^\/dev\/[\w.-]+$/.test(m.port)||typeof m.content!=='string'||m.content.length>32768||typeof m.phone!=='string'||m.phone.length>100)fail('备份短信字段无效');
        if(row.kind==='message')messages.push(m);else outbox.push(m);
      } else if(row.kind==='metadata') {if(!row.meta||typeof row.meta!=='object'||Array.isArray(row.meta))fail('备份元数据无效');meta=row.meta;}
      else fail('备份包含未知记录');
    }
    for(const [id,value] of Object.entries(meta)) if(!/^[a-f\d]{64}$/.test(id)||!value||typeof value!=='object') fail('备份消息标识无效');
    return {messages,outbox,meta};
  }
  async function restoreText(text,targetPort) {
    if(restoreBusy||upgradeBusy||restartPending) fail('维护任务正在运行');
    const content=parseBackup(text); // Validate the entire upload before any writes.
    if(targetPort)portOf(targetPort);
    restoreBusy=true;
    try {
      const before=snapshot('恢复前快照');const grouped=new Map();let restored=0;
      for(const message of content.messages) {
        const port=targetPort||message.port;
        if(!grouped.has(port))grouped.set(port,ctx.loadDiskMessages(port));
        const list=grouped.get(port),id=message.id||messageId(port,message,message.iccid);
        if(list.some(m=>(m.id||messageId(port,m,m.simIccid))===id))continue;
        list.push({...message,id,simIccid:message.iccid,storageLocation:'disk'});restored++;
      }
      for(const [port,messages] of grouped) if(!ctx.saveDiskMessages(port,messages))fail('磁盘写入失败，恢复前快照已保留');
      const sentIds=new Set(db.outbox.map(m=>m.id));
      for(const m of content.outbox) if(!sentIds.has(m.id)) {db.outbox.push({...m,state:m.state==='sent'?'sent':'restored',source:'restore'});sentIds.add(m.id);}
      db.meta={...content.meta,...db.meta};persist();ctx.broadcast();return {restored,snapshot:before};
    } finally {restoreBusy=false;}
  }
  const uploads=new Map();
  function getUpload(id) {if(!/^[a-f\d-]{36}$/.test(id)||!uploads.has(id))fail('上传任务不存在');return uploads.get(id);}
  let cpuSample=os.cpus();
  let networkSample=new Map();
  async function deviceInfo() {
    const cpus=os.cpus(),sumTimes=list=>list.reduce((out,c)=>{out.idle+=c.times.idle;out.total+=Object.values(c.times).reduce((a,b)=>a+b,0);return out;},{idle:0,total:0});
    const prev=sumTimes(cpuSample),next=sumTimes(cpus);cpuSample=cpus;
    const read=async file=>{try{return (await fsp.readFile(file,'utf8')).replace(/\0/g,'').trim();}catch{return '';}};
    const release=await read('/etc/os-release');const model=await read('/proc/device-tree/model');
    const mem=await read('/proc/meminfo');const available=+(mem.match(/MemAvailable:\s*(\d+)/)?.[1]||0)*1024 || os.freemem();
    let storage=null;try{const stat=await fsp.statfs(root);storage={total:stat.blocks*stat.bsize,free:stat.bavail*stat.bsize,used:(stat.blocks-stat.bfree)*stat.bsize};}catch{}
    let temps=[];try {for(const entry of await fsp.readdir('/sys/class/thermal')) if(entry.startsWith('thermal_zone')) {const value=Number(await read('/sys/class/thermal/'+entry+'/temp'));if(value)temps.push({name:await read('/sys/class/thermal/'+entry+'/type'),celsius:value/1000});}}catch{}
    const network=[];const netData=await read('/proc/net/dev');const now=Date.now();
    for(const [name,addresses] of Object.entries(os.networkInterfaces())) {
      const counters=netData.split('\n').find(line=>line.trim().startsWith(name+':'))?.split(':')[1].trim().split(/\s+/).map(Number);
      const last=networkSample.get(name);const rx=counters?.[0]||0,tx=counters?.[8]||0;
      network.push({name,addresses:addresses.map(a=>a.address),mac:addresses[0]?.mac,state:await read('/sys/class/net/'+name+'/operstate'),rx,tx,rxRate:last?Math.max(0,(rx-last.rx)*1000/(now-last.time)):null,txRate:last?Math.max(0,(tx-last.tx)*1000/(now-last.time)):null});networkSample.set(name,{rx,tx,time:now});
    }
    const memValue=key=>+(mem.match(new RegExp(key+':\\s*(\\d+)'))?.[1]||0)*1024;
    return {hostname:os.hostname(),model:model||os.hostname(),serial:await read('/proc/device-tree/serial-number'),os:release.match(/^PRETTY_NAME="(.*)"$/m)?.[1]||os.type(),kernel:os.release(),architecture:os.arch(),uptime:os.uptime(),node:process.version,version:VERSION,cpu:{model:cpus[0]?.model,cores:cpus.length,load:os.loadavg(),usage:next.total===prev.total?null:100*(1-(next.idle-prev.idle)/(next.total-prev.total)),temperatures:temps},memory:{total:os.totalmem(),used:os.totalmem()-available,available,swapTotal:memValue('SwapTotal'),swapUsed:memValue('SwapTotal')-memValue('SwapFree')},storage,network};
  }
  async function tick() {
    if(schedulerBusy||upgradeBusy||restoreBusy||restartPending)return;schedulerBusy=true;
    try {
      for(const job of db.schedules.filter(j=>j.state==='queued'&&j.due<=Date.now())) {
        if(queryLocks.has(job.port)||ctx.isSending(job.port))continue;
        if(job.iccid && ctx.modules[job.port]?.iccid!==job.iccid) {job.state='failed';job.error='SIM 身份发生变化，已停止发送';persist();continue;}
        job.state='sending';persist();
        try {const result=await ctx.sendMessage(job.port,job.phone,job.content,'scheduled');job.state=result.success?'sent':'failed';job.error=result.error||'';}catch(e){job.state='failed';job.error=e.message;}
        job.completed=new Date().toISOString();persist();
      }
    } finally {schedulerBusy=false;}
  }
  const timer=setInterval(()=>tick().catch(e=>console.error('定时发件:',e.message)),5000);timer.unref();
  function register(app,auth) {
    const get=(url,fn)=>app.get('/api/workspace'+url,auth,route(fn));
    const post=(url,fn)=>app.post('/api/workspace'+url,auth,route(fn));
    get('/mail',(req,res)=>{autoSim();res.json({success:true,messages:allMail(),outbox:db.outbox,schedules:db.schedules});});
    post('/mail/meta',(req,res)=>{const {id,read,favorite}=req.body;if(!allMail().some(m=>m.id===id))fail('短信不存在');db.meta[id]={...db.meta[id],...(typeof read==='boolean'?{read}:{}),...(typeof favorite==='boolean'?{favorite}:{})};persist();res.json({success:true});});
    post('/mail/read-all',(req,res)=>{for(const m of allMail()) if(!req.body.port||m.port===req.body.port)db.meta[m.id]={...db.meta[m.id],read:true};persist();res.json({success:true});});
    get('/device',async(req,res)=>res.json({success:true,...await deviceInfo()}));
    get('/sim/:port',async(req,res)=>{const port=portOf(req.params.port),mod=ctx.modules[port];let detail=cachedSim(port);if(mod.status==='ok'&&mod.iccid&&(!detail||Date.now()-new Date(detail.time).getTime()>15*60*1000))detail=await inspectSim(port);res.json({success:true,module:mod,details:detail?{...detail,autoPhone:detail.phone,phone:detail.phone||db.simNumbers[mod.iccid]||''}:null,configuredPhone:db.simNumbers[mod.iccid]||'',identifiers:identifiers(mod.iccid)});});
    post('/sim/:port/number',(req,res)=>{const port=portOf(req.params.port),card=ctx.modules[port].iccid,phone=String(req.body.phone||'').trim();if(!card||req.body.iccid!==card)fail('SIM 已变更，请刷新后重试');if(phone&&!/^\+?\d{3,20}$/.test(phone))fail('请输入有效手机号');db.simNumbers[card]=phone;persist();ctx.broadcast();res.json({success:true});});
    post('/sim/:port/inspect',async(req,res)=>res.json({success:true,details:await inspectSim(portOf(req.params.port))}));
    get('/logs',(req,res)=>{const ports=req.query.port?[portOf(req.query.port)]:Object.keys(ctx.modules);res.json({success:true,logs:ports.flatMap(tailLogs).sort((a,b)=>a.time.localeCompare(b.time))});});
    post('/logs/clear',(req,res)=>{const port=portOf(req.body.port);fs.writeFileSync(logPath(port),'',{mode:0o600});ctx.modules[port].commandHistory=[];res.json({success:true});});
    post('/schedule',(req,res)=>{const {port,phone,content,due}=req.body;portOf(port);if(!/^\+?\d{3,20}$/.test(phone)||typeof content!=='string'||!content.trim()||content.length>70)fail('请输入有效号码与 1–70 字的定时短信');if(!Number.isFinite(due)||due<=Date.now())fail('发送时间必须在未来');if(db.schedules.filter(j=>j.state==='queued').length>=1000)fail('待发送任务过多');const job={id:crypto.randomUUID(),port,iccid:ctx.modules[port].iccid||'',phone,content,due,state:'queued',created:new Date().toISOString()};db.schedules.push(job);persist();res.json({success:true,job});});
    post('/schedule/:id/cancel',(req,res)=>{const job=db.schedules.find(j=>j.id===req.params.id);if(!job||job.state!=='queued')fail('只能取消等待中的任务');job.state='cancelled';persist();res.json({success:true});});
    get('/backup/download',async(req,res)=>streamBackup(res,backupContent()));
    post('/backup',(req,res)=>{const id=Date.now()+'-'+crypto.randomUUID()+'.enc';writeEncrypted(path.join(dirs.backups,id),backupContent());res.json({success:true,id});});
    get('/backup/:id/download',async(req,res)=>{if(!/^[\d]+-[a-f\d-]+\.enc$/.test(req.params.id))fail('备份标识无效');await streamBackup(res,readEncrypted(path.join(dirs.backups,req.params.id)));});
    post('/backup/:id/restore',async(req,res)=>{if(!/^[\d]+-[a-f\d-]+\.enc$/.test(req.params.id))fail('备份标识无效');const backup=readEncrypted(path.join(dirs.backups,req.params.id));const text=[{format:'lte-sms-backup',schema:1},...backup.messages.map(message=>({kind:'message',message})),...(backup.outbox||[]).map(message=>({kind:'sent',message})),{kind:'metadata',meta:backup.meta||{}}].map(x=>JSON.stringify(x)).join('\n');res.json({success:true,...await restoreText(text,req.body.port)});});
    post('/uploads',(req,res)=>{const size=Number(req.body.size);if(!Number.isSafeInteger(size)||size<1||size>128*1024*1024)fail('请选择 1 B–128 MiB 的文件');const id=crypto.randomUUID();const file=path.join(dirs.uploads,id);fs.writeFileSync(file,'',{mode:0o600});uploads.set(id,{file,size,offset:0,busy:false});res.json({success:true,id});});
    app.put('/api/workspace/uploads/:id',auth,route(async(req,res)=>{
      const upload=getUpload(req.params.id);if(upload.busy)fail('正在上传，请等待');if(+req.query.offset!==upload.offset)fail('上传偏移不匹配');upload.busy=true;let size=0;
      try {for await(const chunk of req) {size+=chunk.length;if(size>2*1024*1024||upload.offset+size>upload.size)fail('上传分块过大');await fsp.appendFile(upload.file,chunk);} upload.offset+=size;res.json({success:true,offset:upload.offset});}catch(e){await fsp.truncate(upload.file,upload.offset);throw e;}finally{upload.busy=false;}
    }));
    post('/restore',async(req,res)=>{const upload=getUpload(req.body.upload);if(upload.offset!==upload.size||upload.busy)fail('上传未完成');const text=await fsp.readFile(upload.file,'utf8');const result=await restoreText(text,req.body.port);await fsp.unlink(upload.file);uploads.delete(req.body.upload);res.json({success:true,...result});});
    get('/cache',(req,res)=>{
      const items=[];for(const kind of ['backups','snapshots','logs','uploads'])for(const name of fs.readdirSync(dirs[kind])){const file=path.join(dirs[kind],name);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())continue;items.push({kind,id:name,name,size:stat.size,created:stat.mtime.toISOString(),stamp:stat.mtimeMs,locked:kind==='logs'&&!name.endsWith('.1')||kind==='uploads'&&Boolean(uploads.get(name)?.busy)||kind==='snapshots'&&(restoreBusy||upgradeBusy)});}
      if(fs.existsSync(deploymentDir)){const names=fs.readdirSync(deploymentDir).filter(name=>/^\d{8}-\d{6}(?:-[\w-]+)?$/.test(name)&&!fs.lstatSync(path.join(deploymentDir,name)).isSymbolicLink()&&fs.statSync(path.join(deploymentDir,name)).isDirectory()).sort();for(const name of names){try{items.push({kind:'deployments',id:name,name,...deploymentStats(name),locked:name===names[names.length-1]||restoreBusy||upgradeBusy});}catch{}}}
      res.json({success:true,items});
    });
    post('/cache/clear',(req,res)=>{if(!Array.isArray(req.body.items)||req.body.items.length>500)fail('清理选择无效');let freed=0;const removed=[],skipped=[];for(const item of req.body.items){
      if(item.kind==='deployments') {
        if(!/^\d{8}-\d{6}(?:-[\w-]+)?$/.test(item.id))fail('部署快照标识无效');const file=path.join(deploymentDir,item.id);if(!fs.existsSync(file))continue;const names=fs.readdirSync(deploymentDir).filter(n=>/^\d{8}-\d{6}(?:-[\w-]+)?$/.test(n)).sort();const stat=fs.lstatSync(file);
        if(stat.isSymbolicLink()||!stat.isDirectory()||item.id===names[names.length-1]||restoreBusy||upgradeBusy){skipped.push(item.id);continue;}
        const current=deploymentStats(item.id);if(current.stamp!==item.stamp){skipped.push(item.id);continue;}fs.rmSync(file,{recursive:true});freed+=current.size;removed.push(item.id);continue;
      }
      if(!['backups','snapshots','logs','uploads'].includes(item.kind)||! /^[\w.-]+$/.test(item.id))fail('清理标识无效');const file=path.join(dirs[item.kind],item.id);if(!fs.existsSync(file))continue;const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.mtimeMs!==item.stamp||item.kind==='logs'&&!item.id.endsWith('.1')||item.kind==='uploads'&&uploads.get(item.id)?.busy||item.kind==='snapshots'&&(restoreBusy||upgradeBusy)){skipped.push(item.id);continue;}freed+=stat.size;fs.unlinkSync(file);uploads.delete(item.id);removed.push(item.id);}res.json({success:true,freed,removed,skipped});});
    get('/upgrade',(req,res)=>res.json({success:true,current:fs.existsSync(path.join(dataDir,'ui-version'))?fs.readFileSync(path.join(dataDir,'ui-version'),'utf8').trim():VERSION,backend:VERSION,task:db.upgrade,source:'JasonYANG170/LTE-SMS-Gateway',packageFormat:'lte-sms-ui-update',canRestart:Boolean(ctx.canRestart)}));
    post('/upgrade/check',async(req,res)=>{
      const response=await fetch('https://api.github.com/repos/JasonYANG170/LTE-SMS-Gateway/releases/latest',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
      if(response.status===404)return res.json({success:true,available:false,note:'更新源暂无正式 Release，可使用本地工作台升级包。'});
      if(!response.ok)fail('更新源暂时不可用');const release=await response.json();const asset=release.assets?.find(a=>a.name==='LTE-SMS-Gateway-update.json');res.json({success:true,version:release.tag_name,url:release.html_url,available:Boolean(asset),note:asset?'找到兼容升级包':'该 Release 未包含兼容的工作台升级包',asset:asset?.browser_download_url});
    });
    async function installBundle(bundle) {
      if(upgradeBusy||restoreBusy||restartPending)fail('存在运行中的维护任务');
      if(bundle?.format!=='lte-sms-ui-update'||!/^\d+\.\d+\.\d+$/.test(bundle.version)||!Array.isArray(bundle.files)||!bundle.files.length)fail('升级包格式无效');
      const seen=new Set();let bytes=0;
      for(const item of bundle.files){if(!UPDATE_FILES.includes(item.path)||seen.has(item.path)||typeof item.content!=='string'||hash(Buffer.from(item.content,'base64'))!==item.sha256)fail('升级文件路径或 SHA-256 校验失败');seen.add(item.path);bytes+=Buffer.from(item.content,'base64').length;}
      if(bytes>32*1024*1024||!seen.has('public/index.html'))fail('升级包不完整或过大');
      if(!bundle.files.find(f=>f.path==='public/index.html')||!bundle.files.some(f=>f.path==='public/mail-workspace.js'))fail('缺少工作台入口');
      const backend=bundle.files.some(f=>!f.path.startsWith('public/'));
      if(backend&&!ctx.canRestart)fail('当前部署尚未配置服务重启入口，不能安装含后端的升级包');
      if(backend&&['server.js','gateway-workspace.js','sim-parser.js'].some(file=>!seen.has(file)))fail('后端升级文件不完整');
      if(queryLocks.size||Object.keys(ctx.modules).some(ctx.isSending))fail('模块正在执行任务，请稍后升级');
      upgradeBusy=true;
      let staging;
      try {staging=await fsp.mkdtemp(path.join(dirs.uploads,'upgrade-'));for(const item of bundle.files.filter(f=>f.path.endsWith('.js'))) {const file=path.join(staging,path.basename(item.path));await fsp.writeFile(file,Buffer.from(item.content,'base64'));await run(process.execPath,['--check',file],{timeout:10000});}}catch(e){upgradeBusy=false;throw e;}finally{if(staging)await fsp.rm(staging,{recursive:true,force:true});}
      const id=Date.now()+'-'+crypto.randomUUID()+'.enc';
      const before=bundle.files.map(item=>({path:item.path,content:fs.existsSync(path.join(root,item.path))?fs.readFileSync(path.join(root,item.path)).toString('base64'):null}));
      writeEncrypted(path.join(dirs.snapshots,id),{kind:'ui-upgrade',created:new Date().toISOString(),files:before});
      db.upgrade={state:'running',version:bundle.version,progress:0,snapshot:id};persist();
      try {
        for(const [index,item] of bundle.files.entries()) {const file=path.join(root,item.path);fs.writeFileSync(file+'.upgrade',Buffer.from(item.content,'base64'));fs.renameSync(file+'.upgrade',file);db.upgrade.progress=Math.round((index+1)*100/bundle.files.length);}
        fs.writeFileSync(path.join(dataDir,'ui-version'),bundle.version);db.upgrade={...db.upgrade,state:'completed',progress:100};persist();
      } catch(e) {for(const old of before){const file=path.join(root,old.path);if(old.content===null)fs.rmSync(file,{force:true});else fs.writeFileSync(file,Buffer.from(old.content,'base64'));}db.upgrade={...db.upgrade,state:'failed',error:e.message};persist();throw e;}finally{upgradeBusy=false;}
      restartPending=backend;
      return {...db.upgrade,restart:backend};
    }
    post('/upgrade/install',async(req,res)=>{
      let bundle;
      if(req.body.source==='online') {
        const release=await fetch('https://api.github.com/repos/JasonYANG170/LTE-SMS-Gateway/releases/latest',{signal:AbortSignal.timeout(15000)}).then(r=>r.json());
        const asset=release.assets?.find(a=>a.name==='LTE-SMS-Gateway-update.json');if(!asset)fail('更新源没有兼容升级包');
        const url=new URL(asset.browser_download_url);if(url.protocol!=='https:'||url.hostname!=='github.com'||!url.pathname.startsWith('/JasonYANG170/LTE-SMS-Gateway/releases/download/'))fail('升级来源无效');
        const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)fail('升级包下载失败');let bytes=0,chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>48*1024*1024)fail('升级包过大');chunks.push(Buffer.from(chunk));}bundle=JSON.parse(Buffer.concat(chunks).toString());
      } else {const upload=getUpload(req.body.upload);if(upload.offset!==upload.size||upload.busy)fail('上传未完成');bundle=JSON.parse(await fsp.readFile(upload.file,'utf8'));}
      const task=await installBundle(bundle);res.json({success:true,task});if(task.restart)ctx.restart();
    });
  }
  function deferCommand(port,command) {const list=deferredCommands.get(port)||[];if(!list.includes(command))list.push(command);deferredCommands.set(port,list);}
  return {register,recordLog,recordSent,queryLocks,deferCommand,allMail,snapshot,tick,isMaintaining:()=>upgradeBusy||restoreBusy||restartPending,close:()=>{stopped=true;clearInterval(timer);clearInterval(simTimer);},parseBackup,restoreText,deviceInfo};
}
module.exports={createWorkspace,messageId,VERSION,UPDATE_FILES};
