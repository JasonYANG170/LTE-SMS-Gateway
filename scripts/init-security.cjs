// Initialize a fresh installation. Never overwrites existing credentials or keys.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcrypt');
const {createCrypto}=require('../security');
async function initialize(root,username,password){
  if(fs.existsSync(path.join(root,'credentials.json')))throw Error('Credentials already exist. Use the backed-up legacy migration for an existing installation.');
  if(typeof username!=='string'||!username.trim()||username.length>128||typeof password!=='string'||password.length<12||Buffer.byteLength(password)>72)throw Error('Use a username and a password of at least 12 characters, at most 72 UTF-8 bytes.');
  const dir=path.join(root,'.security');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'secrets.json');
  if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({encryptionKey:crypto.randomBytes(32).toString('hex'),sessionSecret:crypto.randomBytes(48).toString('hex')}),{flag:'wx',mode:0o600});
  const vault=createCrypto(root);fs.writeFileSync(path.join(root,'credentials.json'),JSON.stringify({username:vault.encrypt(username.trim()),password:await bcrypt.hash(password,12)}),{flag:'wx',mode:0o600});
}
async function main(){
  let username=process.env.GATEWAY_INITIAL_USERNAME,password=process.env.GATEWAY_INITIAL_PASSWORD;
  if(!username||!password){
    if(!process.stdin.isTTY)throw Error('Run npm run setup interactively, or set GATEWAY_INITIAL_USERNAME and GATEWAY_INITIAL_PASSWORD.');
    const {Writable}=require('stream');let muted=false;const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
    const rl=require('readline/promises').createInterface({input:process.stdin,output,terminal:true});
    try{username=await rl.question('Administrator username: ');process.stdout.write('Administrator password (12+ characters, hidden): ');muted=true;password=await rl.question('');muted=false;process.stdout.write('\n');}finally{rl.close();}
  }
  await initialize(path.join(__dirname,'..'),username,password);console.log('Security initialized. No default password is enabled.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={initialize};
