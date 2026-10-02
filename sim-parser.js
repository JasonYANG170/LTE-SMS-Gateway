const QUERIES = [
  ['manufacturer', '厂商', 'AT+CGMI'], ['model', '模块型号', 'AT+CGMM'], ['firmware', '固件版本', 'AT+CGMR'],
  ['imei', 'IMEI', 'AT+CGSN'], ['iccid', 'ICCID', 'AT+ICCID'], ['imsi', 'IMSI', 'AT+CIMI'],
  ['number', '本机号码', 'AT+CNUM'], ['pin', 'PIN 状态', 'AT+CPIN?'], ['operator', '运营商', 'AT+COPS?'],
  ['signal', '信号质量', 'AT+CSQ'], ['storage', '短信存储', 'AT+CPMS?'], ['storageTypes', '存储类型', 'AT+CPMS=?'],
  ['smsc', '短信中心', 'AT+CSCA?'], ['smsService', '短信服务', 'AT+CSMS?'],
  ['registration', '网络注册', 'AT+CREG?'], ['packetRegistration', '分组注册', 'AT+CGREG?'],
  ['lteRegistration', 'LTE 注册', 'AT+CEREG?'], ['attached', '分组附着', 'AT+CGATT?'],
  ['contexts', '数据上下文 / APN', 'AT+CGDCONT?'], ['phonebook', '电话簿容量', 'AT+CPBS?'],
  ['clock', '网络时间', 'AT+CCLK?'],
];
function clean(raw) { return String(raw || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && s !== 'OK' && !s.startsWith('AT+')).join('\n'); }
function parseResponse(key, raw) {
  const text = clean(raw);
  if (key === 'storage') return [...text.matchAll(/"(\w+)",(\d+),(\d+)/g)].map(m => ({ memory: m[1], used: +m[2], total: +m[3] }));
  if (key === 'phonebook') { const m = text.match(/"(\w+)",(\d+),(\d+)/); return m ? { memory: m[1], used: +m[2], total: +m[3] } : null; }
  if (key === 'signal') { const m = text.match(/CSQ:\s*(\d+),(\d+)/); return m ? { rssi: +m[1], ber: +m[2], dbm: +m[1] === 99 ? null : +m[1] * 2 - 113 } : null; }
  if (['imsi','imei','iccid'].includes(key)) return text.match(/\d{14,22}/)?.[0] || '';
  if (key === 'number') return [...text.matchAll(/\+CNUM:\s*"([^"]*)","([^"]*)",(\d+)/g)].map(m => ({ name:m[1], number:m[2], type:+m[3] }));
  if (key === 'smsc') return text.match(/"([^"]+)"/)?.[1] || '';
  if (key === 'pin') return text.replace(/^\+CPIN:\s*/, '');
  if (/Registration$/.test(key) || key === 'registration') {
    const m = text.match(/\+C(?:G|E)?REG:\s*(\d+)(?:,(\d+))?(?:,"([^"]*)","([^"]*)")?/);
    if (!m) return null;
    const state = +(m[2] ?? m[1]);
    return { state, meaning: ['未注册','已注册（本地）','正在搜索','注册被拒绝','未知','已注册（漫游）'][state] || `状态 ${state}`, area: m[3] || '', cell: m[4] || '' };
  }
  if (key === 'contexts') return [...text.matchAll(/\+CGDCONT:\s*(\d+),"([^"]*)","([^"]*)","([^"]*)"/g)].map(m => ({ id:+m[1], type:m[2], apn:m[3], address:m[4] }));
  if (key === 'attached') return text.match(/CGATT:\s*(\d+)/)?.[1] === '1' ? '已附着' : text.includes('CGATT:') ? '未附着' : null;
  return text;
}
function identifiers(iccid = '', imsi = '') {
  const value = String(iccid).replace(/\D/g,'');
  let sum = 0;
  for (let i=value.length-1, double=false;i>=0;i--,double=!double) { let n=+value[i]; if(double) {n*=2;if(n>9)n-=9;} sum+=n; }
  return {
    iccid: { value, industry: value.startsWith('89') ? '电信（89）' : '未识别', length:value.length, checksum: value ? sum%10===0 : null },
    imsi: { value:String(imsi), mcc:String(imsi).slice(0,3), mnc: String(imsi).startsWith('460') ? String(imsi).slice(3,5) : '', subscriber: String(imsi).startsWith('460') ? String(imsi).slice(5) : '', note:'MNC 为 2 或 3 位；非 460 MCC 不推断长度。ICCID 发卡机构及归属以运营商信息为准。' },
  };
}
module.exports = { QUERIES, parseResponse, identifiers };
