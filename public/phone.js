/* Shared validation for browser forms and modem requests. Separators never reach AT/PDU commands. */
(function(root){
  function normalize(value,callingCode='') {
    if(typeof value!=='string')throw Error('请输入有效手机号');
    const input=value.trim();
    if(!/^\+?[0-9][0-9 -]*$/.test(input))throw Error('请输入有效手机号');
    let phone=input.replace(/[ -]/g,'');
    if(!phone.startsWith('+')&&callingCode){if(!/^\+[1-9][0-9]{0,2}$/.test(callingCode))throw Error('请选择有效区号');phone=callingCode+phone;}
    if(!(phone.startsWith('+')?/^\+[1-9][0-9]{2,14}$/:/^[0-9]{3,20}$/).test(phone))throw Error('请输入有效手机号');
    return phone;
  }
  const api={normalize};if(typeof module==='object'&&module.exports)module.exports=api;else root.GatewayPhone=api;
})(typeof window==='object'?window:globalThis);
