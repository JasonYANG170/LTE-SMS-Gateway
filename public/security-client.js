/* Same-origin CSRF transport and authenticator enrollment. No third-party assets. */
(() => {
  const originalFetch=window.fetch.bind(window);let tokenPromise;
  const token=()=>tokenPromise ||= originalFetch('/api/security/csrf',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('无法获取安全令牌');return (await r.json()).token;}).catch(e=>{tokenPromise=null;throw e;});
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),method=String(options.method||input.method||'GET').toUpperCase();
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(method)){
      options={...options,headers:new Headers(options.headers||input.headers)};options.headers.set('X-CSRF-Token',await token());
    }
    const response=await originalFetch(input,options);
    if(url.pathname==='/api/login'||url.pathname==='/api/logout')tokenPromise=null;
    return response;
  };
  async function api(path,body) {const r=await fetch('/api/security/totp'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok||!v.success)throw new Error(v.error||'操作失败');return v;}
  window.openGatewaySecurity=async()=>{
    const modal=document.createElement('div');modal.className='modal';
    modal.innerHTML='<div class="modal-content" style="max-width:600px"><div class="modal-header"><h2>双重验证 (TOTP)</h2><button class="close-button" type="button">✕</button></div><div class="modal-body"><p id="securityState">正在加载…</p><form id="securityForm"><div class="form-group"><label>当前登录密码<input id="securityPassword" type="password" autocomplete="current-password" required></label></div><div id="securityEnrollment" hidden><p>用验证器扫描二维码，或手动输入密钥（仅显示于本机）。</p><img id="securityQr" alt="验证器绑定二维码" width="240" height="240"><pre id="securitySecret" style="white-space:pre-wrap;word-break:break-all"></pre></div><div class="form-group" id="securityCodeGroup" hidden><label>验证码或恢复码<input id="securityCode" autocomplete="one-time-code"></label></div><button class="send-button" id="securityAction" type="submit">开始绑定</button></form><p id="securityResult" role="status" style="white-space:pre-wrap;word-break:break-all"></p><button id="securityDownload" class="send-button" hidden>下载恢复码</button></div></div>';
    document.body.append(modal);const $=id=>modal.querySelector('#'+id);modal.querySelector('.close-button').onclick=()=>modal.remove();
    let enabled=false,pending=false;
    try {enabled=(await api('')).enabled;$('securityState').textContent=enabled?'已启用。登录时需要密码和动态验证码。':'尚未启用。绑定验证器并验证成功后才会开启。';$('securityAction').textContent=enabled?'关闭双重验证':'开始绑定';$('securityCodeGroup').hidden=!enabled;}catch(e){$('securityResult').textContent=e.message;return;}
    $('securityForm').onsubmit=async event=>{
      event.preventDefault();const button=$('securityAction');button.disabled=true;$('securityResult').textContent='';
      try {
        if(enabled){await api('/disable',{password:$('securityPassword').value,code:$('securityCode').value.trim()});$('securityResult').textContent='双重验证已关闭。';$('securityForm').hidden=true;}
        else if(!pending){const v=await api('/setup',{password:$('securityPassword').value});$('securityQr').src=v.qr;$('securitySecret').textContent=v.secret;$('securityEnrollment').hidden=false;$('securityCodeGroup').hidden=false;$('securityAction').textContent='确认验证码并启用';pending=true;$('securityCode').focus();}
        else {const v=await api('/enable',{code:$('securityCode').value.trim()});$('securityForm').hidden=true;$('securityState').textContent='双重验证已启用。';$('securityResult').textContent='请立即保存恢复码。每条只能使用一次，关闭窗口后无法再次查看。\n'+v.recoveryCodes.join('\n');$('securityDownload').hidden=false;$('securityDownload').onclick=()=>{const blob=new Blob(['LTE SMS Gateway 一次性恢复码\n'+v.recoveryCodes.join('\n')],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='LTE-SMS-recovery-codes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};}
      }catch(e){$('securityResult').textContent=e.message;}finally{button.disabled=false;}
    };
  };

  window.openLoginPolicy=async()=>{
    const modal=document.createElement('div');modal.className='modal';
    modal.innerHTML='<div class="modal-content" style="max-width:560px"><div class="modal-header"><h2>密码错误等待设置</h2><button class="close-button" type="button">✕</button></div><div class="modal-body"><p>按来源 IP 统计连续登录错误，密码或验证码错误均计入。15 分钟没有新错误会重置未锁定计数；成功登录也会清零。达到次数后开始等待，等待期间正确密码也不能登录。</p><form id="policyForm"><div class="form-group"><label>错误次数（1–10）<input id="policyFailures" type="number" min="1" max="10" required></label></div><div class="form-group"><label>等待分钟数（1–60）<input id="policyMinutes" type="number" min="1" max="60" required></label></div><div class="form-group"><label>当前密码<input id="policyPassword" type="password" autocomplete="current-password" required></label></div><div class="form-group"><label>TOTP 验证码或恢复码（已启用时必填）<input id="policyCode" autocomplete="one-time-code"></label></div><button class="send-button" type="submit">保存设置</button></form><p id="policyResult" role="status"></p></div></div>';
    document.body.append(modal);modal.querySelector('.close-button').onclick=()=>modal.remove();const $=id=>modal.querySelector('#'+id);
    const policyApi=async body=>{const r=await fetch('/api/security/login-policy',body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),v=await r.json();if(!r.ok||!v.success)throw new Error(v.error||'保存失败');return v;};
    try{const v=await policyApi();$('policyFailures').value=v.maxFailures;$('policyMinutes').value=v.lockMinutes;}catch(e){$('policyResult').textContent=e.message;return;}
    $('policyForm').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await policyApi({maxFailures:Number($('policyFailures').value),lockMinutes:Number($('policyMinutes').value),password:$('policyPassword').value,code:$('policyCode').value.trim()});$('policyPassword').value='';$('policyCode').value='';$('policyResult').textContent='设置已保存；已有等待状态会持续到原定结束时间。';}catch(e){$('policyResult').textContent=e.message;}finally{b.disabled=false;}};
  };

  window.openLoginFailures=async()=>{
    const modal=document.createElement('div');modal.className='modal';
    modal.innerHTML='<div class="modal-content" style="max-width:960px"><div class="modal-header"><h2>登录失败 IP 记录</h2><button class="close-button" type="button">✕</button></div><div class="modal-body" style="max-height:72vh;overflow:auto"><p>仅记录 IP、失败时间和失败类型，不记录输入的密码或验证码。成功登录不会删除历史记录。最多保留最近 2000 条，旧记录自动淘汰。</p><button class="send-button" id="failureRefresh">刷新记录</button><p id="failureStatus" role="status"></p><h3>IP 汇总</h3><div id="failureIps" style="overflow:auto"></div><h3>最近失败记录</h3><div id="failureEvents" style="overflow:auto"></div><div style="display:flex;gap:12px;margin-top:12px"><button class="send-button" id="failurePrevious">上一页</button><span id="failurePage"></span><button class="send-button" id="failureNext">下一页</button></div><p class="muted">历史记录来自原登录日志，其 IP 使用当时的记录方式；新记录仅接受可信代理提供的来源 IP。</p></div></div>';
    document.body.append(modal);modal.querySelector('.close-button').onclick=()=>modal.remove();const $=id=>modal.querySelector('#'+id);let page=1,loading=false;
    function table(target,headers,rows){const t=document.createElement('table');t.className='ws-table';t.style.width='100%';const head=t.createTHead().insertRow();for(const text of headers){const cell=document.createElement('th');cell.textContent=text;head.append(cell);}const body=t.createTBody();for(const values of rows){const row=body.insertRow();for(const value of values){const cell=row.insertCell();cell.textContent=String(value);cell.style.padding='8px';}}if(!rows.length){const row=body.insertRow(),cell=row.insertCell();cell.colSpan=headers.length;cell.textContent='暂无登录失败记录';}target.replaceChildren(t);}
    const date=value=>new Date(value).toLocaleString();
    async function load(){if(loading)return;loading=true;$('failureRefresh').disabled=true;try{const r=await fetch('/api/security/login-failures?page='+page),v=await r.json();if(!r.ok||!v.success)throw new Error(v.error||'加载失败');if(!modal.isConnected)return;
      table($('failureIps'),['来源 IP','累计失败（保留记录内）','最近失败','连续错误','当前状态'],v.ips.map(x=>[x.ip,x.totalFailures,date(x.lastFailure),x.consecutiveFailures,x.lockedUntil?'锁定至 '+date(x.lockedUntil):'未锁定']));
      table($('failureEvents'),['时间','来源 IP','失败类型'],v.records.map(x=>[date(x.time),x.ip,({credentials:'账号或密码错误',totp:'验证码或恢复码错误',legacy:'登录失败（历史记录）'})[x.reason]||'登录失败']));
      $('failureStatus').textContent='共 '+v.total+' 条失败记录，涉及 '+v.ips.length+' 个 IP';$('failurePage').textContent=page+' / '+Math.max(1,Math.ceil(v.total/v.pageSize));$('failurePrevious').disabled=page<=1;$('failureNext').disabled=page*v.pageSize>=v.total;
    }catch(e){$('failureStatus').textContent=e.message;}finally{loading=false;$('failureRefresh').disabled=false;}}
    $('failureRefresh').onclick=()=>load();$('failurePrevious').onclick=()=>{if(page>1){page--;load();}};$('failureNext').onclick=()=>{page++;load();};await load();
  };
})();
