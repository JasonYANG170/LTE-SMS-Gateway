const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const express=require('express');
const {EventEmitter}=require('events');
const {WebSocketServer}=require('ws');
const {createWorkspace}=require('../gateway-workspace');
const encrypt=plain=>{const iv=crypto.randomBytes(16);const cipher=crypto.createCipheriv('aes-256-cbc',Buffer.alloc(32,7),iv);return iv.toString('hex')+':'+Buffer.concat([cipher.update(plain),cipher.final()]).toString('hex');};
const decrypt=value=>{const [iv,data]=value.split(':');const cipher=crypto.createDecipheriv('aes-256-cbc',Buffer.alloc(32,7),Buffer.from(iv,'hex'));return Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString();};
class Serial extends EventEmitter {
  isOpen=true;
  write(command,callback) {
    const cmd=command.trim();this.commands??=[];this.commands.push(cmd);
    if(cmd==='AT+CNUM'&&this.noNumber){setTimeout(()=>this.emit('data',Buffer.from('OK\r\n')),1);callback?.();return;}
    if(cmd==='AT+CSMS?'){setTimeout(()=>this.emit('data',Buffer.from('ERROR\r\n')),1);callback?.();return;}
    const replies={'AT+CIMI':'460001234567890','AT+CGSN':'860123456789012','AT+ICCID':'+ICCID: 8986001234567890123','AT+CPMS?':'+CPMS: "SM",1,50,"SM",1,50,"SM",1,50','AT+CPMS=?':'+CPMS: ("SM","ME"),("SM","ME"),("SM","ME")','AT+CSQ':'+CSQ: 22,0','AT+CPIN?':'+CPIN: READY','AT+CNUM':'+CNUM: "","+8613800000000",145','AT+CPBS?':'+CPBS: "SM",2,250','AT+CGDCONT?':'+CGDCONT: 1,"IP","cmnet","10.0.0.1"','AT+CEREG?':'+CEREG: 2,1,"1234","abcd"','AT+CSCA?':'+CSCA: "+8613800100500",145'};
    setTimeout(()=>this.emit('data',Buffer.from((replies[cmd]||'fixture')+'\r\nOK\r\n')),1);callback?.();
  }
}
async function createFixture(options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lte-workspace-test-'));
  fs.cpSync(path.join(__dirname,'../public'),path.join(root,'public'),{recursive:true});
  const diskDir=path.join(root,'disk-sms');fs.mkdirSync(diskDir);
  const now=new Date().toISOString();
  const modules={'/dev/ttyACM0':{port:'/dev/ttyACM0',status:'ok',iccid:'8986001234567890123',imei:'860123456789012',simDetected:true,moduleDetected:true,operatorInfo:{oper:'46000',format:2,mode:0,act:7},signalQuality:{rssi:22},storageInfo:{used:1,total:50,percentage:2},messages:[{pdu:'001122',phone:'+8613800000001',content:'测试来信 <script>安全显示</script>',status:'0',time:now,received:now}],diskMessageCount:0,commandHistory:[],keepAlive:{enabled:true,intervalDays:30,lastSentTime:Date.now()-31*86400000}},'/dev/ttyACM1':{port:'/dev/ttyACM1',status:'no_sim',iccid:'',messages:[],storageInfo:{used:0,total:0},commandHistory:[]}};
  const disk={};const serial={'/dev/ttyACM0':new Serial()};
  serial['/dev/ttyACM0'].noNumber=Boolean(options.noNumber);
  const ctx={root,diskDir,modules,serial,encrypt,decrypt,loadDiskMessages:port=>disk[port]||[],saveDiskMessages:(port,messages)=>{disk[port]=messages;fs.writeFileSync(path.join(diskDir,'sms-'+port.slice(5)+'.json'),encrypt(JSON.stringify(messages)));return true;},isSending:()=>false,broadcast:()=>{},sendMessage:async(port,phone,content,source)=>{const result={success:true};workspace.recordSent(port,phone,content,result,source);return result;}};
  const workspace=createWorkspace(ctx);
  const app=express();app.use(express.json());
  const auth=(req,res,next)=>req.headers.cookie?.includes('test-auth=1')?next():res.status(401).json({success:false,error:'未授权'});
  app.post('/api/login',(req,res)=>{res.cookie('test-auth','1');res.json({success:true});});
  app.post('/api/logout',(req,res)=>res.json({success:true}));
  app.get('/api/keep-alive/:port',(req,res)=>res.json({success:true,config:{enabled:true,targetPhone:'+8613800000002',message:'保号',intervalDays:30,lastSentTime:Date.now()-31*86400000}}));
  app.get('/api/notification-config',(req,res)=>res.json({success:true,config:{enabled:false,url:'',method:'POST'}}));
  app.get('/api/login-logs',(req,res)=>res.json({success:true,logs:'测试登录日志'}));
  app.post('/api/send',async(req,res)=>res.json(await ctx.sendMessage(req.body.port,req.body.phone,req.body.message)));
  for(const endpoint of ['/api/settings','/api/notification-config','/api/update-credentials','/api/keep-alive/:port','/api/auto-clear-sim/:port'])app.post(endpoint,(req,res)=>res.json({success:true}));
  workspace.register(app,auth);
  app.use(express.static(path.join(root,'public')));
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const wss=new WebSocketServer({server});
  wss.on('connection',ws=>ws.send(JSON.stringify(Object.values(modules))));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=async(url,body,headers={})=>{const response=await fetch(origin+url,{headers:{Cookie:'test-auth=1',...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
  return {root,modules,workspace,ctx,origin,request,close:async()=>{workspace.close();for(const client of wss.clients)client.terminate();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}};
}
module.exports={createFixture};
