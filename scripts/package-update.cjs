const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {VERSION,UPDATE_FILES}=require('../gateway-workspace');
const root=path.join(__dirname,'..');
const bundle={format:'lte-sms-ui-update',version:VERSION,files:UPDATE_FILES.map(file=>{const data=fs.readFileSync(path.join(root,file));return {path:file,content:data.toString('base64'),sha256:crypto.createHash('sha256').update(data).digest('hex')};})};
const output=path.join(root,'dist','LTE-SMS-Gateway-update.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(bundle));console.log(output);
