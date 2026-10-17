const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),https=require('https'),crypto=require('crypto'),express=require('express');
const {createCrypto}=require('../security'),{initialize}=require('../scripts/init-security.cjs'),{createHttpsManager,validateMaterial,validHost}=require('../https-manager'),updates=require('../github-updates');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-management-test-'));let manager,http;
 try {
  await initialize(root,'fixture-admin','Synthetic-only-management-password');await assert.rejects(initialize(root,'fixture-admin','Synthetic-only-management-password'),/already exist/);
  const vault=createCrypto(root),app=express();app.use(express.json({limit:'100kb'}));
  const security={requireAuth:(req,res,next)=>req.headers['x-test-auth']==='fixture'?next():res.status(401).json({success:false}),authorizeMaintenance:async(req,res)=>{if(req.body.password!=='Synthetic-only-management-password'){res.status(403).json({success:false});return false;}return true;}};
  let redirects;app.use((req,res,next)=>redirects?redirects(req,res,next):next());
  http=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  // Reserve a free TLS port, then release it before manager.listen.
  const probe=await new Promise(resolve=>{const s=require('net').createServer().listen(0,'127.0.0.1',()=>resolve(s));});const port=probe.address().port;await new Promise(r=>probe.close(r));
  manager=createHttpsManager({app,vault,security,runtimeConfig:{bindHost:'127.0.0.1'},httpPort:http.address().port,attach:()=>{}});redirects=manager.redirect;
  app.get('/health',(req,res)=>res.json({secure:req.secure}));
  const base='http://127.0.0.1:'+http.address().port;
  const api=async(body,auth=true)=>{const r=await fetch(base+'/api/security/https',{headers:{...(auth?{'x-test-auth':'fixture'}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify({password:'Synthetic-only-management-password',...body})}:{})});return {status:r.status,data:await r.json()};};
  assert.equal((await api(undefined,false)).status,401);assert.equal((await api({operation:'configure',enabled:false,port,redirectHttp:false,password:'wrong'})).status,403);
  assert.equal(validHost('bad/name'),false);assert.equal(validHost('127.0.0.1'),true);
  assert.equal((await api({operation:'generate',hosts:['invalid\nDNS:evil'],enabled:false,port})).status,400);
  let result=await api({operation:'generate',hosts:['127.0.0.1','localhost'],enabled:false,port});assert.equal(result.status,200);assert.equal(result.data.certificate.selfSigned,true);
  const first=result.data.certificate.fingerprint;assert.ok(!JSON.stringify(result.data).includes('PRIVATE KEY'));
  const material=JSON.parse(vault.decrypt(fs.readFileSync(path.join(vault.dir,'https-material.enc'),'utf8')));validateMaterial(material);assert.ok(!fs.readFileSync(path.join(vault.dir,'https-material.enc'),'utf8').includes('PRIVATE KEY'));
  const other=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});assert.throws(()=>validateMaterial({...material,key:other}),/匹配/);assert.throws(()=>validateMaterial(material,Date.parse(result.data.certificate.validTo)+1000),/到期/);
  result=await api({operation:'configure',enabled:true,port,redirectHttp:false});assert.equal(result.data.active,true);
  const tlsRequest=(cert=material.cert)=>new Promise((resolve,reject)=>{https.get('https://127.0.0.1:'+port+'/health',{ca:cert,agent:false},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>resolve(JSON.parse(b)));}).on('error',reject);});assert.equal((await tlsRequest()).secure,true);
  // TLS cookies and WebSocket auth are covered by full-server security checks; context change is tested here.
  result=await api({operation:'generate',hosts:['127.0.0.1'],enabled:true,port});assert.equal(result.data.active,true);assert.notEqual(result.data.certificate.fingerprint,first);assert.equal(result.data.hasPrevious,true);const rotated=JSON.parse(vault.decrypt(fs.readFileSync(path.join(vault.dir,'https-material.enc'),'utf8')));assert.equal((await tlsRequest(rotated.cert)).secure,true);
  result=await api({operation:'rollback',enabled:true,port});assert.equal(result.data.certificate.fingerprint,first);assert.equal((await tlsRequest()).secure,true);
  result=await api({operation:'configure',enabled:true,port,redirectHttp:true});assert.equal(result.status,200);const redirect=await fetch(base+'/health',{redirect:'manual'});assert.equal(redirect.status,308);assert.match(redirect.headers.get('location'),/^https:/);
  // Return via HTTPS to disable forced redirection.
  await manager.apply({enabled:false,port,redirectHttp:false});assert.equal(manager.status().active,false);
  const data=Buffer.from(JSON.stringify({version:'3.2.1'})),asset={digest:'sha256:'+updates.digest(data),name:updates.ASSET,browser_download_url:'https://github.com/JasonYANG170/LTE-SMS-Gateway/releases/download/v3.2.1/'+updates.ASSET};
  assert.equal(updates.verifyBundle(data,asset,'v3.2.1').version,'3.2.1');assert.throws(()=>updates.verifyBundle(Buffer.from('{}'),asset,'v3.2.1'),/SHA-256/);assert.throws(()=>updates.verifyBundle(data,asset,'v3.2.2'),/版本/);
  assert.throws(()=>updates.assetOf({assets:[{...asset,browser_download_url:'https://evil.example/update'}]}),/来源/);assert.throws(()=>updates.assetOf({assets:[{...asset,digest:null}]}),/摘要/);assert.equal(updates.newer('v3.2.1','3.2.0'),true);assert.equal(updates.newer('v3.1.0','3.2.0'),false);
  console.log('PASS: unique bootstrap, HTTPS authentication, host/certificate/key/expiry validation, encrypted private key, trusted TLS handshake, certificate hot replacement/rollback, HTTP redirect, official source/digest/version validation');
 }finally{manager?.close();if(http)await new Promise(r=>http.close(r));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
