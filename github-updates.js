'use strict';
const crypto=require('crypto');
const REPOSITORY='JasonYANG170/LTE-SMS-Gateway';
const API='https://api.github.com/repos/'+REPOSITORY+'/releases/latest';
const ASSET='LTE-SMS-Gateway-update.json';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function semver(value){const m=String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/);if(!m)throw Error('发布版本号无效');return m.slice(1).map(Number);}
function newer(a,b){const x=semver(a),y=semver(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
async function bytes(response,limit){if(!response.ok)throw Error('GitHub更新源暂时不可用');let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('发布文件超过大小限制');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
async function latest(fetcher=fetch){const response=await fetcher(API,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});if(response.status===404)return null;const release=JSON.parse((await bytes(response,2*1024*1024)).toString('utf8'));semver(release.tag_name);if(release.draft||release.prerelease)throw Error('仅支持正式发布版本');return release;}
function assetOf(release){const asset=release?.assets?.find(a=>a.name===ASSET);if(!asset)throw Error('发布中没有兼容升级包');const url=new URL(asset.browser_download_url);if(url.protocol!=='https:'||url.username||url.password||url.hostname!=='github.com'||url.port||!url.pathname.startsWith('/'+REPOSITORY+'/releases/download/')||url.search||url.hash)throw Error('升级来源无效');if(!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('GitHub未提供可信SHA-256摘要，拒绝安装');return asset;}
function verifyBundle(data,asset,tag){if(data.length>48*1024*1024||'sha256:'+digest(data)!==asset.digest)throw Error('发布文件SHA-256校验失败');const bundle=JSON.parse(data.toString('utf8'));if('v'+bundle.version!=='v'+String(tag).replace(/^v/,''))throw Error('升级包版本与GitHub发布不一致');return bundle;}
async function download(release,fetcher=fetch){const asset=assetOf(release),response=await fetcher(asset.browser_download_url,{signal:AbortSignal.timeout(60000)});return verifyBundle(await bytes(response,48*1024*1024),asset,release.tag_name);}
module.exports={REPOSITORY,ASSET,latest,download,assetOf,verifyBundle,newer,digest};
