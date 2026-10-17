// Run with the application stopped and an external, private backup already made.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
if(!process.argv.includes('--backup-confirmed'))throw new Error('Stop the service and create a private backup, then pass --backup-confirmed');
const root=process.argv[2];if(!root)throw new Error('Installation path required');
const dir=path.join(root,'.security');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const keyPath=path.join(dir,'secrets.json');
if(!fs.existsSync(keyPath)){const check=d=>{for(const ent of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','.git','public','ui-backups'].includes(ent.name))continue;const f=path.join(d,ent.name);if(ent.isSymbolicLink())continue;if(ent.isDirectory())check(f);else if(/\.(json|enc|jsonl)$/.test(ent.name)){const fd=fs.openSync(f,'r');try{const b=Buffer.alloc(4096);const n=fs.readSync(fd,b,0,b.length,0);if(b.subarray(0,n).toString().includes('v2:'))throw Error('Existing v2 data found without its deployment key; restore the key backup');}finally{fs.closeSync(fd);}}}};check(root);}
if(!fs.existsSync(keyPath))fs.writeFileSync(keyPath,JSON.stringify({encryptionKey:crypto.randomBytes(32).toString('hex'),sessionSecret:crypto.randomBytes(48).toString('hex')}),{mode:0o600,flag:'wx'});
const vault=require('../security').createCrypto(root);
const legacyKey=crypto.scryptSync('lte-gateway-encryption-key','salt',32);
function legacy(text){const [iv,data]=text.split(':');const d=crypto.createDecipheriv('aes-256-cbc',legacyKey,Buffer.from(iv,'hex'));return Buffer.concat([d.update(Buffer.from(data,'hex')),d.final()]).toString('utf8');}
let values=0,files=0;
function convert(v){if(typeof v==='string'&&/^[a-f0-9]{32}:(?:[a-f0-9]{32})+$/.test(v)){const plain=legacy(v),next=vault.encrypt(plain);if(vault.decrypt(next)!==plain)throw new Error('Migration roundtrip failed');values++;return next;}if(Array.isArray(v))return v.map(convert);if(v&&typeof v==='object'){for(const k of Object.keys(v))v[k]=convert(v[k]);}return v;}
function migrate(file,notification=false){const ownership=fs.statSync(file);const before=fs.readFileSync(file,'utf8');let after;
 if(/\.jsonl(?:\.1)?$/.test(file)){after=before.split('\n').filter(Boolean).map(line=>{if(line.startsWith('v2:')){if(vault.decrypt(line)===null)throw new Error('Log authentication failed');return line;}JSON.parse(line);const next=vault.encrypt(line);if(vault.decrypt(next)!==line)throw new Error('Log roundtrip failed');values++;return next;}).join('\n')+'\n';fs.writeFileSync(file+'.migration',after,{mode:0o600});fs.chownSync(file+'.migration',ownership.uid,ownership.gid);fs.renameSync(file+'.migration',file);files++;return;}
 if(before.startsWith('v2:')){if(vault.decrypt(before)===null)throw new Error('Existing v2 data invalid');return;}
 if(/^[a-f0-9]{32}:/.test(before)){const plain=legacy(before);after=vault.encrypt(plain);if(vault.decrypt(after)!==plain)throw new Error('Roundtrip failed');values++;}
 else{const old=JSON.parse(before),next=convert(old);after=JSON.stringify(next,null,2);if(notification){after=vault.encrypt(after);if(vault.decrypt(after)===null)throw new Error('Notification encryption failed');}}
 fs.writeFileSync(file+'.migration',after,{mode:0o600});fs.chownSync(file+'.migration',ownership.uid,ownership.gid);fs.renameSync(file+'.migration',file);files++;
}
for(const name of ['credentials.json','module-settings.json','keep-alive.json','notification.json'])if(fs.existsSync(path.join(root,name)))migrate(path.join(root,name),name==='notification.json');
for(const name of ['disk-sms','workspace-data']){const dir=path.join(root,name);if(!fs.existsSync(dir))continue;const walk=d=>{for(const ent of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,ent.name);if(ent.isSymbolicLink())throw new Error('Symlink in migration target');if(ent.isDirectory())walk(f);else if(ent.isFile()&&(ent.name.endsWith('.enc')||/\.jsonl(?:\.1)?$/.test(ent.name)||name==='disk-sms'&&ent.name.endsWith('.json')))migrate(f);}};walk(dir);}
console.log(JSON.stringify({migratedFiles:files,encryptedValues:values,roundtripVerified:true}));
