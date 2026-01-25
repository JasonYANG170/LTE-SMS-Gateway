const express = require('express');
const { SerialPort } = require('serialport');
const WebSocket = require('ws');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5823;

// 解析JSON请求体
app.use(express.json());

// 会话配置
app.use(session({
  secret: 'lte-gateway-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // 如果使用HTTPS，设置为true
    maxAge: 24 * 60 * 60 * 1000 // 24小时
  }
}));

// 用户凭据文件路径
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
const LOGIN_LOG_FILE = path.join(__dirname, 'login.log');
const NOTIFICATION_CONFIG_FILE = path.join(__dirname, 'notification.json');
const ENCRYPTION_KEY = crypto.scryptSync('lte-gateway-encryption-key', 'salt', 32);
const IV_LENGTH = 16;

// 加密函数
function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// 解密函数
function decrypt(text) {
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('解密失败:', error.message);
    return null;
  }
}

// 初始化默认凭据
async function initCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    const defaultPassword = await bcrypt.hash('password', 10);
    const credentials = {
      username: encrypt('root'),
      password: defaultPassword
    };
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
    console.log('已创建默认凭据文件（已加密）');
  }
}

// 读取凭据
function getCredentials() {
  try {
    const data = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    const encrypted = JSON.parse(data);
    const username = decrypt(encrypted.username);
    
    if (!username) {
      throw new Error('凭据解密失败');
    }
    
    return {
      username: username,
      passwordHash: encrypted.password
    };
  } catch (error) {
    console.error('读取凭据失败:', error.message);
    return null;
  }
}

// 保存凭据
async function saveCredentials(username, password) {
  try {
    const credentials = getCredentials();
    if (!credentials) {
      throw new Error('无法读取现有凭据');
    }
    
    const newCredentials = {
      username: username ? encrypt(username) : encrypt(credentials.username),
      password: password ? await bcrypt.hash(password, 10) : credentials.passwordHash
    };
    
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(newCredentials, null, 2));
    console.log('凭据已更新（已加密）');
    return true;
  } catch (error) {
    console.error('保存凭据失败:', error.message);
    return false;
  }
}

// 初始化凭据
initCredentials();

// 获取客户端 IP 地址
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         'unknown';
}

// 记录登录日志
function logLogin(ip, username, success, error = '') {
  const timestamp = new Date().toISOString();
  const status = success ? 'SUCCESS' : 'FAILED';
  const logEntry = `[${timestamp}] IP: ${ip} | User: ${username} | Status: ${status}${error ? ` | Error: ${error}` : ''}\n`;
  
  try {
    fs.appendFileSync(LOGIN_LOG_FILE, logEntry);
    console.log(`登录日志: ${logEntry.trim()}`);
  } catch (error) {
    console.error('写入登录日志失败:', error.message);
  }
}

// 初始化通知配置
function initNotificationConfig() {
  if (!fs.existsSync(NOTIFICATION_CONFIG_FILE)) {
    const defaultConfig = {
      enabled: false,
      url: '',
      method: 'POST'
    };
    fs.writeFileSync(NOTIFICATION_CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    console.log('已创建默认通知配置文件');
  }
}

// 读取通知配置
function getNotificationConfig() {
  try {
    const data = fs.readFileSync(NOTIFICATION_CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('读取通知配置失败:', error.message);
    return { enabled: false, url: '', method: 'POST' };
  }
}

// 保存通知配置
function saveNotificationConfig(config) {
  try {
    fs.writeFileSync(NOTIFICATION_CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('通知配置已更新');
    return true;
  } catch (error) {
    console.error('保存通知配置失败:', error.message);
    return false;
  }
}

// 发送登录失败通知
async function sendLoginFailureNotification(ip, username, error) {
  const config = getNotificationConfig();
  
  if (!config.enabled || !config.url) {
    return;
  }
  
  try {
    const timestamp = new Date().toISOString();
    const message = `登录失败 - IP: ${ip}, 用户名: ${username}, 错误: ${error}, 时间: ${timestamp}`;
    
    // 替换 {login} 占位符
    let url = config.url.replace('{login}', encodeURIComponent(message));
    
    console.log(`发送登录失败通知: ${url}`);
    
    if (config.method === 'GET') {
      // GET 请求
      const response = await fetch(url);
      console.log(`通知发送成功 (GET): ${response.status}`);
    } else {
      // POST 请求 - 将 URL 参数转换为 body
      const urlObj = new URL(url);
      const params = {};
      urlObj.searchParams.forEach((value, key) => {
        params[key] = value;
      });
      
      const response = await fetch(urlObj.origin + urlObj.pathname, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      });
      console.log(`通知发送成功 (POST): ${response.status}`);
    }
  } catch (error) {
    console.error('发送登录失败通知失败:', error.message);
  }
}

// 初始化通知配置
initNotificationConfig();

// 认证中间件
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ success: false, error: '未授权' });
}

// 静态文件 - 登录页面不需要认证
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'style.css'));
});

// 主页需要认证
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.redirect('/login.html');
  }
});

// 其他静态文件需要认证
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') && !filePath.endsWith('login.html')) {
      // HTML文件需要认证检查
    }
  }
}));

// 登录API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const clientIP = getClientIP(req);
  const credentials = getCredentials();
  
  if (!credentials) {
    logLogin(clientIP, username, false, '系统错误');
    return res.json({ success: false, error: '系统错误，请联系管理员' });
  }
  
  try {
    // 验证用户名和密码
    const usernameMatch = username === credentials.username;
    const passwordMatch = await bcrypt.compare(password, credentials.passwordHash);
    
    if (usernameMatch && passwordMatch) {
      req.session.authenticated = true;
      req.session.username = username;
      logLogin(clientIP, username, true);
      res.json({ success: true });
    } else {
      const error = '用户名或密码错误';
      logLogin(clientIP, username, false, error);
      
      // 发送登录失败通知
      await sendLoginFailureNotification(clientIP, username, error);
      
      res.json({ success: false, error });
    }
  } catch (error) {
    console.error('登录验证失败:', error.message);
    logLogin(clientIP, username, false, error.message);
    res.json({ success: false, error: '登录失败，请重试' });
  }
});

// 退出登录API
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 更新凭据API
app.post('/api/update-credentials', requireAuth, async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const success = await saveCredentials(username, password);
    if (success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: '保存失败' });
    }
  } catch (error) {
    console.error('更新凭据失败:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 获取通知配置API
app.get('/api/notification-config', requireAuth, (req, res) => {
  const config = getNotificationConfig();
  res.json({ success: true, config });
});

// 更新通知配置API
app.post('/api/notification-config', requireAuth, (req, res) => {
  const { enabled, url, method } = req.body;
  
  try {
    const config = {
      enabled: enabled || false,
      url: url || '',
      method: method || 'POST'
    };
    
    const success = saveNotificationConfig(config);
    if (success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: '保存失败' });
    }
  } catch (error) {
    console.error('更新通知配置失败:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 获取登录日志API
app.get('/api/login-logs', requireAuth, (req, res) => {
  try {
    if (fs.existsSync(LOGIN_LOG_FILE)) {
      const logs = fs.readFileSync(LOGIN_LOG_FILE, 'utf8');
      const logLines = logs.trim().split('\n').filter(line => line).reverse(); // 最新的在前
      res.json({ success: true, logs: logLines.slice(0, 100) }); // 最多返回100条
    } else {
      res.json({ success: true, logs: [] });
    }
  } catch (error) {
    console.error('读取登录日志失败:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 测试 HTTP 转发API
app.post('/api/test-http-forward', requireAuth, async (req, res) => {
  const { url, method } = req.body;
  
  if (!url) {
    return res.json({ success: false, error: 'URL 不能为空' });
  }
  
  try {
    const testMessage = '测试短信内容 - Test SMS Content';
    const testUrl = url.replace('{sms}', encodeURIComponent(testMessage));
    
    console.log(`测试 HTTP 转发: ${method} ${testUrl}`);
    
    const startTime = Date.now();
    let response;
    
    if (method === 'GET') {
      // GET 请求
      response = await fetch(testUrl);
    } else {
      // POST 请求 - token 保留在 URL 中，其他参数放到 body
      const urlObj = new URL(testUrl);
      const params = new URLSearchParams();
      const tokenParam = urlObj.searchParams.get('token');
      
      // 构建新的 URL，只保留 token 参数
      const postUrl = `${urlObj.origin}${urlObj.pathname}${tokenParam ? '?token=' + tokenParam : ''}`;
      
      // 其他参数放到 body 中
      urlObj.searchParams.forEach((value, key) => {
        if (key !== 'token') {
          params.append(key, value);
        }
      });
      
      response = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
    }
    
    const duration = Date.now() - startTime;
    
    // 尝试读取响应内容
    let responseText = '';
    try {
      responseText = await response.text();
    } catch (e) {
      responseText = '无法读取响应内容';
    }
    
    // 确保 responseText 不是 undefined
    if (!responseText) {
      responseText = '';
    }
    
    console.log(`HTTP 转发测试完成: ${response.status} ${response.statusText} (${duration}ms)`);
    
    res.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      duration: duration,
      method: method,
      testMessage: testMessage,
      responseText: responseText.substring(0, 500) // 限制响应长度
    });
  } catch (error) {
    console.error('HTTP 转发测试失败:', error.message);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// 清空登录日志API
app.post('/api/clear-login-logs', requireAuth, (req, res) => {
  try {
    if (fs.existsSync(LOGIN_LOG_FILE)) {
      fs.writeFileSync(LOGIN_LOG_FILE, '');
      console.log('登录日志已清空');
    }
    res.json({ success: true });
  } catch (error) {
    console.error('清空登录日志失败:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 清空指定模块的短信API
app.post('/api/clear-messages/:port', requireAuth, async (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  
  if (!moduleStates[portPath]) {
    return res.json({ success: false, error: '模块不存在' });
  }
  
  const serial = serialConnections[portPath];
  if (!serial || !serial.isOpen) {
    return res.json({ success: false, error: '串口未连接' });
  }
  
  console.log(`清空 ${portPath} 的短信（使用 AT+CMGD）`);
  
  try {
    // 使用 AT+CMGD=1,4 删除所有短信（包括未读）
    const result = await deleteAllMessages(portPath);
    
    if (result.success) {
      // 清空内存中的记录
      moduleStates[portPath].messages = [];
      moduleStates[portPath].unreadCount = 0;
      moduleStates[portPath].multipartMessages = {};
      
      // 广播更新
      broadcastUpdate();
      
      res.json({ success: true });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error(`清空 ${portPath} 短信失败:`, error.message);
    res.json({ success: false, error: error.message });
  }
});

// 清空指定模块的命令日志API
app.post('/api/clear-command-logs/:port', requireAuth, (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  
  if (!moduleStates[portPath]) {
    return res.json({ success: false, error: '模块不存在' });
  }
  
  console.log(`清空 ${portPath} 的命令日志`);
  moduleStates[portPath].commandHistory = [];
  
  // 广播更新
  broadcastUpdate();
  
  res.json({ success: true });
});

// 4个串口配置
const ports = [
  '/dev/ttyACM0',
  '/dev/ttyACM1',
  '/dev/ttyACM2',
  '/dev/ttyACM3'
];

// 存储每个模块的状态和串口连接
const moduleStates = {};
const serialConnections = {};
let wsClients = [];

// 广播更新到所有WebSocket客户端
function broadcastUpdate() {
  const modules = Object.values(moduleStates);
  const data = JSON.stringify(modules);
  console.log(`广播更新到 ${wsClients.length} 个客户端，模块数量: ${modules.length}`);
  
  wsClients.forEach((ws, index) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      console.log(`已发送到客户端 ${index + 1}`);
    }
  });
}

// 添加命令历史记录
function addCommandHistory(portPath, type, data) {
  if (!moduleStates[portPath]) return;
  
  const history = {
    type: type, // 'send' or 'receive' or 'error' or 'sms_sent' or 'sms_error'
    data: data,
    timestamp: new Date().toLocaleTimeString('zh-CN')
  };
  
  moduleStates[portPath].commandHistory.push(history);
  
  // 只保留最近20条记录
  if (moduleStates[portPath].commandHistory.length > 20) {
    moduleStates[portPath].commandHistory.shift();
  }
}

// 发送命令并记录
function sendCommand(portPath, command) {
  const serial = serialConnections[portPath];
  if (!serial || !serial.isOpen) {
    console.error(`${portPath} 串口未打开，无法发送命令: ${command}`);
    return;
  }
  
  console.log(`[${portPath}] 发送: ${command}`);
  addCommandHistory(portPath, 'send', command);
  serial.write(command + '\r\n');
}

// 解析PDU格式短信
// 解析PDU格式短信
function parsePDU(pdu) {
  try {
    let pos = 0;
    
    // 1. SMSC长度和地址
    const smscLen = parseInt(pdu.substr(pos, 2), 16);
    pos += 2 + smscLen * 2;
    
    // 2. PDU类型
    const pduType = parseInt(pdu.substr(pos, 2), 16);
    pos += 2;
    
    // 3. 发件人地址长度
    const senderLen = parseInt(pdu.substr(pos, 2), 16);
    pos += 2;
    
    // 4. 发件人地址类型
    const senderType = parseInt(pdu.substr(pos, 2), 16);
    pos += 2;
    
    // 5. 发件人号码
    let senderDigits = Math.ceil(senderLen / 2) * 2;
    let sender = pdu.substr(pos, senderDigits);
    pos += senderDigits;
    
    // 交换每对数字
    let phone = '';
    for (let i = 0; i < sender.length; i += 2) {
      let pair = sender.substr(i, 2);
      phone += pair[1] + pair[0];
    }
    phone = phone.replace(/F/g, '');
    
    // 如果是国际号码，添加+号
    if (senderType === 0x91) {
      phone = '+' + phone;
    }
    
    // 6. 协议标识
    pos += 2;
    
    // 7. 数据编码方案
    const dcs = parseInt(pdu.substr(pos, 2), 16);
    pos += 2;
    
    // 8. 时间戳 (7字节，14个十六进制字符)
    let timestamp = pdu.substr(pos, 14);
    pos += 14;
    
    // 解析时间戳
    let time = '';
    for (let i = 0; i < 12; i += 2) {
      let pair = timestamp.substr(i, 2);
      time += pair[1] + pair[0];
    }
    // 格式: YYYY/MM/DD HH:MM:SS
    let year = parseInt(time.substr(0, 2));
    if (year > 50) {
      year = 1900 + year;
    } else {
      year = 2000 + year;
    }
    time = `${year}/${time.substr(2, 2)}/${time.substr(4, 2)} ${time.substr(6, 2)}:${time.substr(8, 2)}:${time.substr(10, 2)}`;
    
    // 9. 用户数据长度
    let udl = parseInt(pdu.substr(pos, 2), 16);
    pos += 2;
    
    // 10. 用户数据
    let userData = pdu.substr(pos);
    let udhLength = 0;
    let udhInfo = null;
    
    // 检查是否有用户数据头 (PDU类型的bit 6)
    if (pduType & 0x40) {
      // 有UDH
      udhLength = parseInt(userData.substr(0, 2), 16);
      const udhData = userData.substr(2, udhLength * 2);
      
      // 解析UDH
      let udhPos = 0;
      while (udhPos < udhData.length) {
        const iei = parseInt(udhData.substr(udhPos, 2), 16);
        const iedl = parseInt(udhData.substr(udhPos + 2, 2), 16);
        
        if (iei === 0x00 || iei === 0x08) {
          // 长短信标识
          if (iei === 0x00) {
            // 8-bit参考号
            const refNum = parseInt(udhData.substr(udhPos + 4, 2), 16);
            const totalParts = parseInt(udhData.substr(udhPos + 6, 2), 16);
            const partNum = parseInt(udhData.substr(udhPos + 8, 2), 16);
            udhInfo = { refNum, totalParts, partNum };
          } else {
            // 16-bit参考号
            const refNum = parseInt(udhData.substr(udhPos + 4, 4), 16);
            const totalParts = parseInt(udhData.substr(udhPos + 8, 2), 16);
            const partNum = parseInt(udhData.substr(udhPos + 10, 2), 16);
            udhInfo = { refNum, totalParts, partNum };
          }
          console.log(`长短信: ${udhInfo.partNum}/${udhInfo.totalParts}, 参考号: ${udhInfo.refNum}`);
          break;
        }
        
        udhPos += 2 + 2 + iedl * 2;
      }
      
      // 跳过UDH (长度字节 + UDH内容)
      userData = userData.substr((udhLength + 1) * 2);
      
      // 如果是7-bit编码，需要调整UDL
      if (dcs === 0x00 || dcs === 0x01) {
        // 7-bit编码时，UDL包含UDH，需要减去
        const udhSeptets = Math.ceil((udhLength + 1) * 8 / 7);
        udl = udl - udhSeptets;
      } else {
        // 8-bit或16-bit编码
        udl = udl - (udhLength + 1);
      }
    }
    
    // 解码内容
    let content = '';
    if (dcs === 0x00 || dcs === 0x01) {
      // 7-bit编码
      content = decode7bit(userData, udl);
    } else if (dcs === 0x08 || dcs === 0x18) {
      // UCS2编码 (16-bit Unicode)
      // UDL 是字节数，每个字符占2字节
      const charCount = Math.floor(udl / 2);
      for (let i = 0; i < charCount && i * 4 < userData.length; i++) {
        const code = parseInt(userData.substr(i * 4, 4), 16);
        if (code) {
          content += String.fromCharCode(code);
        }
      }
    } else {
      // 8-bit编码或其他
      for (let i = 0; i < userData.length && i < udl * 2; i += 2) {
        const code = parseInt(userData.substr(i, 2), 16);
        if (code) {
          content += String.fromCharCode(code);
        }
      }
    }
    
    return {
      phone: phone,
      time: time,
      content: content,
      udh: udhInfo
    };
  } catch (error) {
    console.error('PDU解析错误:', error);
    return {
      phone: '解析失败',
      time: new Date().toLocaleString('zh-CN'),
      content: ''
    };
  }
}

// 7-bit解码
function decode7bit(data, length) {
  let result = '';
  let shift = 0;
  let carry = 0;
  
  // 逐字节处理
  for (let i = 0; i < Math.ceil(length * 7 / 8); i++) {
    const byte = parseInt(data.substr(i * 2, 2), 16);
    
    // 提取当前字符（7位）
    const char = ((byte << shift) | carry) & 0x7F;
    result += String.fromCharCode(char);
    
    // 计算进位
    carry = byte >> (7 - shift);
    shift++;
    
    // 如果shift达到7，说明carry中有完整的一个字符
    if (shift === 7) {
      result += String.fromCharCode(carry);
      shift = 0;
      carry = 0;
    }
    
    // 如果已经解码了足够的字符，停止
    if (result.length >= length) {
      break;
    }
  }
  
  return result.substr(0, length);
}

module.exports = { parsePDU };

// 转发短信
async function forwardMessage(portPath, message) {
  const settings = moduleStates[portPath].forwardSettings;
  
  if (!settings) return;
  
  // HTTP转发
  if (settings.httpEnabled && settings.httpUrl) {
    try {
      const url = settings.httpUrl.replace('{sms}', encodeURIComponent(message.content));
      
      console.log(`${portPath} HTTP转发: ${url}`);
      
      if (settings.httpMethod === 'GET') {
        // GET请求
        const response = await fetch(url);
        console.log(`${portPath} HTTP转发成功 (GET): ${response.status}`);
      } else {
        // POST请求 - token 保留在 URL 中，其他参数放到 body
        const urlObj = new URL(url);
        const params = new URLSearchParams();
        const tokenParam = urlObj.searchParams.get('token');
        
        // 构建新的 URL，只保留 token 参数
        const postUrl = `${urlObj.origin}${urlObj.pathname}${tokenParam ? '?token=' + tokenParam : ''}`;
        
        // 其他参数放到 body 中
        urlObj.searchParams.forEach((value, key) => {
          if (key !== 'token') {
            params.append(key, value);
          }
        });
        
        const response = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
        console.log(`${portPath} HTTP转发成功 (POST): ${response.status}`);
      }
    } catch (error) {
      console.error(`${portPath} HTTP转发失败:`, error.message);
    }
  }
  
  // SMS转发
  if (settings.smsEnabled && settings.smsTarget) {
    try {
      console.log(`${portPath} SMS转发到: ${settings.smsTarget}`);
      const forwardContent = `[转发自${message.phone}] ${message.content}`;
      const result = await sendMessage(portPath, settings.smsTarget, forwardContent);
      
      if (result.success) {
        console.log(`${portPath} SMS转发成功`);
      } else {
        console.error(`${portPath} SMS转发失败:`, result.error);
      }
    } catch (error) {
      console.error(`${portPath} SMS转发失败:`, error.message);
    }
  }
}

// 初始化所有模块的监听
function initializeModuleListeners() {
  ports.forEach(portPath => {
    moduleStates[portPath] = {
      port: portPath,
      status: 'unknown',
      iccid: '',
      imei: '',
      moduleDetected: false,
      simDetected: false,
      unreadCount: 0,
      messages: [],
      pendingMessages: [],
      readingMessage: false,
      commandHistory: [],
      operatorInfo: { // 运营商信息
        mode: null,
        format: null,
        oper: null,
        act: null
      },
      signalQuality: { // 信号强度
        rssi: null,
        ber: null
      },
      forwardSettings: {
        httpEnabled: false,
        httpUrl: '',
        httpMethod: 'GET',
        smsEnabled: false,
        smsTarget: ''
      },
      multipartMessages: {} // 存储长短信片段
    };
    
    // 启动监听
    startPortListener(portPath);
  });
}

// 启动串口监听
function startPortListener(portPath) {
  try {
    const serial = new SerialPort({
      path: portPath,
      baudRate: 115200,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false
    });

    let buffer = '';
    let initStep = 0;

    serial.open((err) => {
      if (err) {
        console.error(`无法打开 ${portPath}:`, err.message);
        moduleStates[portPath].status = 'error';
        // 5秒后重试
        setTimeout(() => startPortListener(portPath), 5000);
        return;
      }

      console.log(`${portPath} 已打开，开始初始化...`);
      serialConnections[portPath] = serial;

      // 初始化序列
      setTimeout(() => {
        // 0. 设置PDU模式
        initStep = 0.5;
        sendCommand(portPath, 'AT+CMGF=0');
      }, 500);
    });

    serial.on('data', (data) => {
      buffer += data.toString();
      
      // 检查是否有完整的行
      if (buffer.includes('\n')) {
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留最后不完整的部分
        
        lines.forEach(line => {
          line = line.trim();
          if (!line) return;
          
          console.log(`[${portPath}] ${line}`);
          
          // 记录接收的数据到命令历史
          if (line && !line.match(/^(AT|OK|\r)$/)) {
            addCommandHistory(portPath, 'receive', line);
          }
          
          // 检测短信通知
          if (line.includes('+CMTI:')) {
            const match = line.match(/\+CMTI:\s*"([^"]+)",\s*(\d+)/);
            if (match) {
              const index = match[2];
              console.log(`${portPath} 收到新短信通知，索引: ${index}`);
              
              // 记录短信通知（不立即增加未读数，等解析后再判断）
              if (!moduleStates[portPath].pendingMessages) {
                moduleStates[portPath].pendingMessages = [];
              }
              moduleStates[portPath].pendingMessages.push(index);
              
              // 读取短信内容
              setTimeout(() => {
                console.log(`${portPath} 读取短信 ${index}`);
                sendCommand(portPath, `AT+CMGR=${index}`);
              }, 100);
            }
          }
          
          // 读取短信响应 - 短信头
          if (line.includes('+CMGR:')) {
            console.log(`${portPath} 收到短信头: ${line}`);
            moduleStates[portPath].readingMessage = true;
            
            // 解析PDU模式短信头
            // +CMGR: <stat>,[<alpha>],<length>
            const pduMatch = line.match(/\+CMGR:\s*(\d+),[^,]*,(\d+)/);
            if (pduMatch) {
              moduleStates[portPath].currentMessageInfo = {
                status: pduMatch[1],
                length: pduMatch[2]
              };
              console.log(`${portPath} PDU模式短信 - 状态: ${pduMatch[1]}, 长度: ${pduMatch[2]}`);
            }
          } 
          // 列举短信响应 - 短信头
          else if (line.includes('+CMGL:')) {
            console.log(`${portPath} 收到短信列表项: ${line}`);
            moduleStates[portPath].readingMessage = true;
            
            // 解析PDU模式列表
            // +CMGL: <index>,<stat>,[<alpha>],<length>
            const pduMatch = line.match(/\+CMGL:\s*(\d+),\s*(\d+),[^,]*,(\d+)/);
            if (pduMatch) {
              moduleStates[portPath].currentMessageInfo = {
                index: pduMatch[1],
                status: pduMatch[2],
                length: pduMatch[3]
              };
              console.log(`${portPath} PDU模式短信列表 - 索引: ${pduMatch[1]}, 状态: ${pduMatch[2]}, 长度: ${pduMatch[3]}`);
              
              // 统计未读 (status=0表示未读)
              if (pduMatch[2] === '0' && initStep === 0) {
                moduleStates[portPath].unreadCount++;
              }
            }
          }
          // 读取短信响应 - PDU数据
          else if (moduleStates[portPath].readingMessage && line.match(/^[0-9A-F]{20,}$/i)) {
            console.log(`${portPath} 收到PDU数据: ${line.substring(0, 50)}...`);
            
            const msgInfo = moduleStates[portPath].currentMessageInfo || {};
            
            // 解析PDU
            const parsed = parsePDU(line);
            
            // 处理长短信
            if (parsed.udh) {
              const key = `${parsed.phone}_${parsed.udh.refNum}`;
              
              if (!moduleStates[portPath].multipartMessages[key]) {
                moduleStates[portPath].multipartMessages[key] = {
                  parts: {},
                  totalParts: parsed.udh.totalParts,
                  phone: parsed.phone,
                  time: parsed.time
                };
              }
              
              // 保存这一片段
              moduleStates[portPath].multipartMessages[key].parts[parsed.udh.partNum] = parsed.content;
              
              console.log(`${portPath} 收到长短信片段 ${parsed.udh.partNum}/${parsed.udh.totalParts}, 内容: ${parsed.content?.substring(0, 20)}...`);
              
              // 检查是否收集齐所有片段
              const multipart = moduleStates[portPath].multipartMessages[key];
              const receivedParts = Object.keys(multipart.parts).length;
              
              if (receivedParts === multipart.totalParts) {
                // 合并所有片段
                let fullContent = '';
                for (let i = 1; i <= multipart.totalParts; i++) {
                  if (multipart.parts[i]) {
                    fullContent += multipart.parts[i];
                  }
                }
                
                console.log(`${portPath} 长短信合并完成，总长度: ${fullContent.length}`);
                
                // 去重已关闭
                const isDuplicate = false;
                
                console.log(`${portPath} 去重检查已关闭: isDuplicate=${isDuplicate}, phone=${multipart.phone}, contentLength=${fullContent.length}`);
                
                if (!isDuplicate) {
                  // 保存完整短信
                  const message = {
                    pdu: `multipart_${key}`,
                    phone: multipart.phone,
                    time: multipart.time,
                    content: fullContent,
                    status: msgInfo.status || 'unknown',
                    timestamp: new Date().toLocaleString('zh-CN'),
                    received: new Date().toISOString(),
                    isMultipart: true
                  };
                  
                  moduleStates[portPath].messages.push(message);
                  console.log(`${portPath} 长短信已保存到messages数组，当前总数: ${moduleStates[portPath].messages.length}`);
                  
                  // 如果是未读短信，增加未读数（只增加一次）
                  if (initStep === 0 && msgInfo.status === '0') {
                    moduleStates[portPath].unreadCount++;
                    console.log(`${portPath} 未读数增加到: ${moduleStates[portPath].unreadCount}`);
                  }
                  
                  // 执行转发
                  if (initStep === 0 && fullContent && msgInfo.status === '0') {
                    forwardMessage(portPath, message);
                  }
                  
                  // 通知客户端
                  if (initStep === 0) {
                    console.log(`${portPath} 长短信合并完成，广播更新`);
                    broadcastUpdate();
                  }
                } else {
                  console.log(`${portPath} 长短信重复，跳过保存`);
                }
                
                // 清理已合并的长短信
                delete moduleStates[portPath].multipartMessages[key];
              }
            } else {
              // 普通短信 - 去重已关闭
              const isDuplicate = false;
              
              if (!isDuplicate) {
                const message = {
                  pdu: line,
                  phone: parsed.phone || '未知',
                  time: parsed.time || new Date().toLocaleString('zh-CN'),
                  content: parsed.content || '',
                  status: msgInfo.status || 'unknown',
                  timestamp: new Date().toLocaleString('zh-CN'),
                  received: new Date().toISOString()
                };
                
                moduleStates[portPath].messages.push(message);
                console.log(`${portPath} PDU短信已保存，来自: ${parsed.phone}, 内容: ${parsed.content?.substring(0, 20)}...`);
                
                // 如果是未读短信，增加未读数
                if (initStep === 0 && msgInfo.status === '0') {
                  moduleStates[portPath].unreadCount++;
                }
                
                // 执行转发（仅在非初始化阶段且有内容时）
                if (initStep === 0 && parsed.content && msgInfo.status === '0') {
                  forwardMessage(portPath, message);
                }
                
                // 如果不在初始化阶段，立即通知客户端
                if (initStep === 0) {
                  broadcastUpdate();
                }
              } else {
                console.log(`${portPath} 跳过重复短信`);
              }
            }
            
            moduleStates[portPath].readingMessage = false;
            moduleStates[portPath].currentMessageInfo = null;
          }
          
          // 初始化步骤响应
          if (initStep === 0.5 && line.includes('OK')) {
            // PDU模式设置成功
            initStep = 1;
            setTimeout(() => sendCommand(portPath, 'AT'), 300);
          } else if (initStep === 1 && line.includes('OK')) {
            moduleStates[portPath].moduleDetected = true;
            initStep = 2;
            setTimeout(() => sendCommand(portPath, 'AT+ICCID'), 300);
          } else if (initStep === 2) {
            if (line.includes('+ICCID:')) {
              const match = line.match(/\+ICCID:\s*(\d+)/);
              if (match) {
                moduleStates[portPath].iccid = match[1];
              }
            } else if (line.includes('OK')) {
              moduleStates[portPath].simDetected = true;
              initStep = 3;
              setTimeout(() => sendCommand(portPath, 'AT+CGSN'), 300);
            }
          } else if (initStep === 3) {
            const imeiMatch = line.match(/^(\d{15})$/);
            if (imeiMatch) {
              moduleStates[portPath].imei = imeiMatch[1];
            } else if (line.includes('OK')) {
              initStep = 4;
              // 设置短信通知模式
              setTimeout(() => sendCommand(portPath, 'AT+CNMI=2,1,0,0,0'), 300);
            }
          } else if (initStep === 4 && line.includes('OK')) {
            initStep = 5;
            // 设置短信存储位置为SIM卡
            setTimeout(() => sendCommand(portPath, 'AT+CPMS="SM","SM","SM"'), 300);
          } else if (initStep === 5 && line.includes('OK')) {
            initStep = 6;
            // 查询运营商信息
            setTimeout(() => sendCommand(portPath, 'AT+COPS?'), 300);
          } else if (initStep === 6) {
            if (line.includes('+COPS:')) {
              // 解析运营商信息: +COPS: <mode>[,<format>,<oper>[,<AcT>]]
              const match = line.match(/\+COPS:\s*(\d+)(?:,(\d+),"([^"]+)"(?:,(\d+))?)?/);
              if (match) {
                moduleStates[portPath].operatorInfo = {
                  mode: parseInt(match[1]),
                  format: match[2] ? parseInt(match[2]) : null,
                  oper: match[3] || null,
                  act: match[4] ? parseInt(match[4]) : null
                };
                console.log(`${portPath} 运营商信息:`, moduleStates[portPath].operatorInfo);
              }
            }
            
            if (line.includes('OK') || line.includes('ERROR')) {
              initStep = 7;
              // 查询信号强度
              setTimeout(() => sendCommand(portPath, 'AT+CSQ'), 300);
            }
          } else if (initStep === 7) {
            if (line.includes('+CSQ:')) {
              // 解析信号强度: +CSQ: <rssi>,<ber>
              const match = line.match(/\+CSQ:\s*(\d+),(\d+)/);
              if (match) {
                moduleStates[portPath].signalQuality = {
                  rssi: parseInt(match[1]),
                  ber: parseInt(match[2])
                };
                console.log(`${portPath} 信号强度:`, moduleStates[portPath].signalQuality);
              }
            }
            
            if (line.includes('OK') || line.includes('ERROR')) {
              initStep = 8;
              // 检查所有短信（包括已读和未读）
              setTimeout(() => sendCommand(portPath, 'AT+CMGL=4'), 300);
            }
          } else if (initStep === 8) {
            if (line.includes('+CMGL:')) {
              const match = line.match(/\+CMGL:\s*(\d+),\s*(\d+)/);
              if (match) {
                const index = match[1];
                const status = match[2]; // 0=未读, 1=已读, 2=未发送, 3=已发送
                if (status === '0') {
                  moduleStates[portPath].unreadCount++;
                }
                console.log(`${portPath} 发现短信，索引: ${index}, 状态: ${status}`);
              }
            } else if (line.match(/^[0-9A-F]{20,}$/i) && initStep === 8) {
              // 初始化时读取的短信PDU - 需要解析
              const parsed = parsePDU(line);
              
              // 处理长短信
              if (parsed.udh) {
                const key = `${parsed.phone}_${parsed.udh.refNum}`;
                
                if (!moduleStates[portPath].multipartMessages[key]) {
                  moduleStates[portPath].multipartMessages[key] = {
                    parts: {},
                    totalParts: parsed.udh.totalParts,
                    phone: parsed.phone,
                    time: parsed.time
                  };
                }
                
                // 保存这一片段
                moduleStates[portPath].multipartMessages[key].parts[parsed.udh.partNum] = parsed.content;
                
                console.log(`${portPath} 初始化-收到长短信片段 ${parsed.udh.partNum}/${parsed.udh.totalParts}`);
                
                // 检查是否收集齐所有片段
                const multipart = moduleStates[portPath].multipartMessages[key];
                const receivedParts = Object.keys(multipart.parts).length;
                
                if (receivedParts === multipart.totalParts) {
                  // 合并所有片段
                  let fullContent = '';
                  for (let i = 1; i <= multipart.totalParts; i++) {
                    if (multipart.parts[i]) {
                      fullContent += multipart.parts[i];
                    }
                  }
                  
                  console.log(`${portPath} 初始化-长短信合并完成，总长度: ${fullContent.length}`);
                  
                  // 保存完整短信
                  moduleStates[portPath].messages.push({
                    pdu: `multipart_${key}`,
                    phone: multipart.phone,
                    time: multipart.time,
                    content: fullContent,
                    timestamp: new Date().toLocaleString('zh-CN'),
                    received: new Date().toISOString(),
                    isMultipart: true
                  });
                  
                  // 清理已合并的长短信
                  delete moduleStates[portPath].multipartMessages[key];
                }
              } else {
                // 普通短信
                moduleStates[portPath].messages.push({
                  pdu: line,
                  phone: parsed.phone || '未知',
                  time: parsed.time || new Date().toLocaleString('zh-CN'),
                  content: parsed.content || '',
                  timestamp: new Date().toLocaleString('zh-CN'),
                  received: new Date().toISOString()
                });
              }
              
              console.log(`${portPath} 保存短信，总数: ${moduleStates[portPath].messages.length}`);
            } else if (line.includes('OK')) {
              initStep = 0; // 初始化完成
              moduleStates[portPath].status = moduleStates[portPath].simDetected ? 'ok' : 'no_sim';
              console.log(`${portPath} 初始化完成，状态: ${moduleStates[portPath].status}, 未读: ${moduleStates[portPath].unreadCount}, 短信数: ${moduleStates[portPath].messages.length}`);
              broadcastUpdate();
            }
          }
        });
      }
    });

    serial.on('close', () => {
      console.log(`${portPath} 已关闭，5秒后重连...`);
      delete serialConnections[portPath];
      setTimeout(() => startPortListener(portPath), 5000);
    });

    serial.on('error', (err) => {
      console.error(`${portPath} 错误:`, err.message);
    });

  } catch (err) {
    console.error(`启动 ${portPath} 监听失败:`, err.message);
    setTimeout(() => startPortListener(portPath), 5000);
  }
}

// 发送短信
async function sendMessage(portPath, phone, message) {
  return new Promise((resolve) => {
    const result = {
      success: false,
      error: null,
      steps: []
    };

    const serial = serialConnections[portPath];
    if (!serial || !serial.isOpen) {
      result.error = '串口未连接';
      resolve(result);
      return;
    }

    let buffer = '';
    let step = 0;
    let timeout;

    const dataHandler = (data) => {
      buffer += data.toString();

      if (step === 1 && buffer.includes('OK')) {
        buffer = '';
        step = 2;
        result.steps.push('设置TEXT模式');
        serial.write('AT+CMGF=1\r\n');
      } else if (step === 2 && buffer.includes('OK')) {
        buffer = '';
        step = 3;
        result.steps.push(`发送短信到 ${phone}`);
        serial.write(`AT+CMGS="${phone}"\r\n`);
      } else if (step === 3 && buffer.includes('>')) {
        buffer = '';
        step = 4;
        serial.write(message + String.fromCharCode(26)); // Ctrl-Z
      } else if (step === 4 && buffer.includes('OK')) {
        clearTimeout(timeout);
        result.success = true;
        result.steps.push('发送成功');
        
        // 记录发送的短信到命令历史（包含完整内容）
        addCommandHistory(portPath, 'sms_sent', `发送到 ${phone}: ${message}`);
        
        serial.removeListener('data', dataHandler);
        resolve(result);
      } else if (buffer.includes('ERROR')) {
        clearTimeout(timeout);
        result.error = '发送失败';
        
        // 记录发送失败
        addCommandHistory(portPath, 'sms_error', `发送失败 ${phone}: ${message}`);
        
        serial.removeListener('data', dataHandler);
        resolve(result);
      }
    };

    serial.on('data', dataHandler);

    // 开始发送
    step = 1;
    result.steps.push('设置编码格式');
    serial.write('AT+CSCS="GSM"\r\n');

    timeout = setTimeout(() => {
      result.error = '超时';
      serial.removeListener('data', dataHandler);
      resolve(result);
    }, 10000);
  });
}

// 删除所有短信
async function deleteAllMessages(portPath) {
  return new Promise((resolve) => {
    const result = {
      success: false,
      error: null
    };

    const serial = serialConnections[portPath];
    if (!serial || !serial.isOpen) {
      result.error = '串口未连接';
      resolve(result);
      return;
    }

    let buffer = '';
    let timeout;

    const dataHandler = (data) => {
      buffer += data.toString();

      if (buffer.includes('OK')) {
        clearTimeout(timeout);
        result.success = true;
        console.log(`${portPath} 所有短信已删除（AT+CMGD=1,4）`);
        
        // 记录到命令历史
        addCommandHistory(portPath, 'send', 'AT+CMGD=1,4 (删除所有短信)');
        
        serial.removeListener('data', dataHandler);
        resolve(result);
      } else if (buffer.includes('ERROR')) {
        clearTimeout(timeout);
        result.error = '删除失败';
        console.error(`${portPath} 删除短信失败`);
        
        serial.removeListener('data', dataHandler);
        resolve(result);
      }
    };

    serial.on('data', dataHandler);

    // 发送 AT+CMGD=1,4 删除所有短信（包括未读）
    console.log(`${portPath} 发送: AT+CMGD=1,4`);
    addCommandHistory(portPath, 'send', 'AT+CMGD=1,4');
    serial.write('AT+CMGD=1,4\r\n');

    timeout = setTimeout(() => {
      result.error = '超时';
      serial.removeListener('data', dataHandler);
      resolve(result);
    }, 5000);
  });
}

// API端点
app.get('/api/modules', requireAuth, async (req, res) => {
  res.json(Object.values(moduleStates));
});

// 获取指定模块的消息
app.get('/api/messages/:port', requireAuth, async (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  
  if (!moduleStates[portPath]) {
    return res.json({ success: false, error: '模块不存在' });
  }
  
  res.json({
    success: true,
    messages: moduleStates[portPath].messages || [],
    unreadCount: moduleStates[portPath].unreadCount || 0
  });
});

// 手动刷新短信
app.get('/api/refresh/:port', requireAuth, async (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  const serial = serialConnections[portPath];
  
  if (!serial || !serial.isOpen) {
    return res.json({ success: false, error: '串口未连接' });
  }
  
  console.log(`手动刷新 ${portPath} 的短信`);
  
  // 清空现有短信和计数
  moduleStates[portPath].messages = [];
  moduleStates[portPath].unreadCount = 0;
  moduleStates[portPath].multipartMessages = {}; // 清空长短信缓存
  
  // 读取所有短信（参数4表示所有状态）
  sendCommand(portPath, 'AT+CMGL=4');
  
  res.json({ success: true, message: '已发送读取命令' });
});

// 清除未读数
app.post('/api/clear-unread/:port', requireAuth, async (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  
  if (!moduleStates[portPath]) {
    return res.json({ success: false, error: '模块不存在' });
  }
  
  console.log(`清除 ${portPath} 的未读数`);
  moduleStates[portPath].unreadCount = 0;
  
  // 广播更新
  broadcastUpdate();
  
  res.json({ success: true });
});

// 发送短信
app.post('/api/send', requireAuth, async (req, res) => {
  const { port, phone, message } = req.body;
  const result = await sendMessage(port, phone, message);
  res.json(result);
});

// 保存转发设置
app.post('/api/settings', requireAuth, async (req, res) => {
  const { port, settings } = req.body;
  
  if (!moduleStates[port]) {
    return res.json({ success: false, error: '模块不存在' });
  }
  
  // 保存设置
  moduleStates[port].forwardSettings = settings;
  console.log(`${port} 转发设置已更新:`, settings);
  
  // 广播更新
  broadcastUpdate();
  
  res.json({ success: true });
});

// 启动HTTP服务器
const server = app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  // 初始化模块监听
  initializeModuleListeners();
});

// WebSocket服务器（用于实时更新）
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('客户端已连接');
  wsClients.push(ws);
  
  // 立即发送当前状态
  const initialData = JSON.stringify(Object.values(moduleStates));
  console.log('发送初始状态给新客户端:', initialData);
  ws.send(initialData);
  
  // 处理客户端消息
  ws.on('message', (message) => {
    if (message.toString() === 'ping') {
      ws.send('pong');
    }
  });
  
  ws.on('close', () => {
    console.log('客户端已断开');
    wsClients = wsClients.filter(client => client !== ws);
  });
});

// 定期广播状态更新（每5秒）
setInterval(() => {
  if (wsClients.length > 0) {
    console.log('定期广播状态更新');
    broadcastUpdate();
  }
}, 5000);
