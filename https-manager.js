'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),https=require('https'),tls=require('tls'),net=require('net');
const {execFile}=require('child_process');
const {promisify}=require('util');
const run=promisify(execFile);
function validateMaterial(value,now=Date.now()) {
  if(typeof value?.cert!=='string'||Buffer.byteLength(value.cert)>65536||typeof value.key!=='string'||Buffer.byteLength(value.key)>16384)throw Error('证书或私钥格式/大小无效');
  const blocks=value.cert.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if(!blocks?.length||blocks.length>8)throw Error('请提供 PEM 格式证书链');
  const certificates=blocks.map(pem=>new crypto.X509Certificate(pem)),leaf=certificates[0],key=crypto.createPrivateKey(value.key);
  const a=crypto.createPublicKey(key).export({type:'spki',format:'der'}),b=leaf.publicKey.export({type:'spki',format:'der'});
  if(!a.equals(b))throw Error('证书与私钥不匹配');
  if(!['rsa','rsa-pss','ec','ed25519','ed448'].includes(key.asymmetricKeyType)||key.asymmetricKeyDetails?.modulusLength<2048)throw Error('私钥算法或强度不满足要求');
  if(Date.parse(leaf.validFrom)>now||Date.parse(leaf.validTo)<=now+300000)throw Error('证书尚未生效或已经到期');
  if(leaf.ca)throw Error('请导入服务器证书，不能直接使用 CA 根证书');
  if(!leaf.subjectAltName)throw Error('证书必须包含域名或IP的Subject Alternative Name');
  if(leaf.keyUsage?.length&&!leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'))throw Error('证书不允许用于TLS服务器认证');
  for(let i=0;i<certificates.length-1;i++){const issuer=certificates[i+1];if(!issuer.ca||Date.parse(issuer.validFrom)>now||Date.parse(issuer.validTo)<=now||!certificates[i].verify(issuer.publicKey))throw Error('证书链顺序、有效期或签名无效');}

  tls.createSecureContext({key:value.key,cert:value.cert,minVersion:'TLSv1.2'});
  return {subject:leaf.subject,issuer:leaf.issuer,validFrom:leaf.validFrom,validTo:leaf.validTo,fingerprint:leaf.fingerprint256,san:leaf.subjectAltName||'',selfSigned:leaf.issuer===leaf.subject&&leaf.verify(leaf.publicKey)};
}
function createHttpsManager({app,vault,security,runtimeConfig,httpPort,attach}) {
  const configFile=path.join(vault.dir,'https.json'),materialFile=path.join(vault.dir,'https-material.enc'),previousFile=path.join(vault.dir,'https-previous.enc');
  let config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{enabled:false,port:httpPort<65535?httpPort+1:5824,redirectHttp:false};
  const read=file=>{if(!fs.existsSync(file))return null;const plain=vault.decrypt(fs.readFileSync(file,'utf8'));if(plain===null)throw Error('证书存储校验失败');return JSON.parse(plain);};
  let material=read(materialFile),server=null,lastError='',busy=false;
  const write=(file,value,encrypted=false)=>{fs.writeFileSync(file+'.tmp',encrypted?vault.encrypt(JSON.stringify(value)):JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  const close=(instance,grace=0)=>{if(!instance)return;instance.close();const destroy=()=>{for(const socket of instance.gatewaySockets)socket.destroy();};if(grace){const timer=setTimeout(destroy,grace);timer.unref();}else destroy();};
  async function apply(next,nextMaterial=material,persist=true) {
    if(typeof next.enabled!=='boolean'||typeof next.redirectHttp!=='boolean'||!Number.isInteger(next.port)||next.port<1024||next.port>65535||next.port===httpPort)throw Error('HTTPS 端口必须为1024–65535且不同于HTTP端口');
    if(next.enabled&&!nextMaterial)throw Error('请先导入或生成证书');
    if(nextMaterial)validateMaterial(nextMaterial);
    const old=server,oldMaterial=material;let replacement=null,swapped=false;
    try {
      if(next.enabled) {
        if(old&&next.port===config.port){old.setSecureContext({key:nextMaterial.key,cert:nextMaterial.cert,minVersion:'TLSv1.2'});replacement=old;swapped=true;}
        else {
          replacement=https.createServer({key:nextMaterial.key,cert:nextMaterial.cert,minVersion:'TLSv1.2'},app);replacement.gatewaySockets=new Set();
          replacement.on('connection',socket=>{replacement.gatewaySockets.add(socket);socket.on('close',()=>replacement.gatewaySockets.delete(socket));});
          replacement.on('tlsClientError',()=>{});attach?.(replacement);
          await new Promise((resolve,reject)=>{replacement.once('error',reject);replacement.listen(next.port,runtimeConfig.bindHost||'::',()=>{replacement.removeListener('error',reject);resolve();});});
          replacement.on('error',()=>{lastError='HTTPS监听发生错误，请检查端口与证书配置';});
        }
      }
      if(persist) {
        if(nextMaterial!==material){if(material)write(previousFile,material,true);write(materialFile,nextMaterial,true);}
        write(configFile,next);
      }
      server=replacement;config={...next};material=nextMaterial;lastError='';if(old!==replacement)close(old,500);
    }catch(e){if(replacement&&replacement!==old)close(replacement);if(swapped&&oldMaterial)old.setSecureContext({key:oldMaterial.key,cert:oldMaterial.cert,minVersion:'TLSv1.2'});throw e;}
  }
  function status(){let certificate=null;try{if(material)certificate=validateMaterial(material);}catch(e){lastError=e.message;}
    return {success:true,...config,httpPort,active:Boolean(server),certificate,hasPrevious:fs.existsSync(previousFile),error:lastError};}
  function redirect(req,res,next) {
    if(!config.enabled||!server||!config.redirectHttp||req.secure)return next();
    if(!['GET','HEAD'].includes(req.method))return res.status(426).json({success:false,error:'请改用 HTTPS 地址访问'});
    const host=req.hostname.replace(/^\[|\]$/g,'');if(!validHost(host))return res.status(400).end();
    res.redirect(308,'https://'+(net.isIP(host)===6?'['+host+']':host)+':'+config.port+req.originalUrl);
  }
  const route=fn=>async(req,res)=>{if(busy)return res.status(409).json({success:false,error:'正在更新证书，请稍后重试'});busy=true;try{if(!await security.authorizeMaintenance(req,res))return;await fn(req,res);}catch(e){res.status(400).json({success:false,error:e.message});}finally{busy=false;}};
  app.get('/api/security/https',security.requireAuth,(req,res)=>res.json(status()));
  app.get('/api/security/https/certificate',security.requireAuth,(req,res)=>{if(!material)return res.status(404).json({success:false,error:'暂无证书'});res.type('application/x-pem-file').attachment('gateway-certificate.pem').send(material.cert);});
  app.post('/api/security/https',security.requireAuth,route(async(req,res)=>{
    const operation=req.body.operation;let nextMaterial=material;
    if(operation==='import') {
      if(!req.secure&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw Error('私钥导入需使用 HTTPS，首次配置请通过 SSH 本机隧道访问');
      nextMaterial={cert:req.body.cert,key:req.body.key};validateMaterial(nextMaterial);
    } else if(operation==='generate') {
      const hosts=req.body.hosts;if(!Array.isArray(hosts)||!hosts.length||hosts.length>10||hosts.some(h=>typeof h!=='string'||!validHost(h)))throw Error('请填写有效IP或域名，最多10项');
      const temp=fs.mkdtempSync(path.join(vault.dir,'certificate-'));fs.chmodSync(temp,0o700);
      try {
        await run('openssl',['req','-x509','-newkey','rsa:3072','-sha256','-nodes','-days','365','-keyout',path.join(temp,'key.pem'),'-out',path.join(temp,'cert.pem'),'-subj','/CN='+hosts[0],'-addext','basicConstraints=critical,CA:FALSE','-addext','keyUsage=critical,digitalSignature,keyEncipherment','-addext','extendedKeyUsage=serverAuth','-addext','subjectAltName='+hosts.map(h=>(net.isIP(h)?'IP:':'DNS:')+h).join(',')],{timeout:30000,windowsHide:true,maxBuffer:8192});
        nextMaterial={cert:fs.readFileSync(path.join(temp,'cert.pem'),'utf8'),key:fs.readFileSync(path.join(temp,'key.pem'),'utf8')};
      }catch{throw Error('生成自签名证书失败，请确认主机已安装 OpenSSL');}finally{fs.rmSync(temp,{recursive:true,force:true});}
    } else if(operation==='rollback') {nextMaterial=read(previousFile);if(!nextMaterial)throw Error('没有上一份证书');}
    else if(operation!=='configure')throw Error('未知证书操作');
    const next={enabled:req.body.enabled===undefined?config.enabled:req.body.enabled,port:req.body.port===undefined?config.port:req.body.port,redirectHttp:req.body.redirectHttp===undefined?config.redirectHttp:req.body.redirectHttp};
    await apply(next,nextMaterial);res.json(status());
  }));
  return {status,redirect,start:()=>apply(config,material,false).catch(e=>{lastError=e.message;console.error('HTTPS启动失败:',e.message);}),close:()=>close(server),apply};
}
function validHost(host){return typeof host==='string'&&host.length<=253&&(net.isIP(host)!==0||/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host));}
module.exports={createHttpsManager,validateMaterial,validHost};
