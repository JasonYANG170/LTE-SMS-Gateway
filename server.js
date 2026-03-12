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
const MODULE_SETTINGS_FILE = path.join(__dirname, 'module-settings.json');
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

// 保号配置文件路径
const KEEP_ALIVE_FILE = path.join(__dirname, 'keep-alive.json');

// 初始化模块设置文件
function initModuleSettings() {
  if (!fs.existsSync(MODULE_SETTINGS_FILE)) {
    const defaultSettings = {};
    fs.writeFileSync(MODULE_SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
    console.log('已创建默认模块设置文件');
  }
}

// 初始化保号配置
function initKeepAliveConfig() {
  if (!fs.existsSync(KEEP_ALIVE_FILE)) {
    const defaultConfig = {};
    fs.writeFileSync(KEEP_ALIVE_FILE, JSON.stringify(defaultConfig, null, 2));
    console.log('已创建默认保号配置文件');
  }
}

// 读取保号配置
function getKeepAliveConfig() {
  try {
    const data = fs.readFileSync(KEEP_ALIVE_FILE, 'utf8');
    const encryptedConfig = JSON.parse(data);
    
    // 解密敏感字段
    const decryptedConfig = {};
    for (const [port, config] of Object.entries(encryptedConfig)) {
      decryptedConfig[port] = {
        ...config,
        targetPhone: config.targetPhone ? decrypt(config.targetPhone) || '' : '',
        message: config.message ? decrypt(config.message) || '' : ''
      };
    }
    
    return decryptedConfig;
  } catch (error) {
    console.error('读取保号配置失败:', error.message);
    return {};
  }
}

// 保存保号配置
function saveKeepAliveConfig(config) {
  try {
    // 加密敏感字段
    const encryptedConfig = {};
    for (const [port, setting] of Object.entries(config)) {
      encryptedConfig[port] = {
        ...setting,
        targetPhone: setting.targetPhone ? encrypt(setting.targetPhone) : '',
        message: setting.message ? encrypt(setting.message) : ''
      };
    }
    
    fs.writeFileSync(KEEP_ALIVE_FILE, JSON.stringify(encryptedConfig, null, 2));
    console.log('保号配置已保存（敏感字段已加密）');
    return true;
  } catch (error) {
    console.error('保存保号配置失败:', error.message);
    return false;
  }
}

// 保号定时器
const keepAliveTimers = {};
// 保号定时器锁，防止重复创建
const keepAliveTimerLocks = {};

// 读取模块设置
function getModuleSettings() {
  try {
    const data = fs.readFileSync(MODULE_SETTINGS_FILE, 'utf8');
    const encryptedSettings = JSON.parse(data);
    
    // 解密敏感字段
    const decryptedSettings = {};
    for (const [port, settings] of Object.entries(encryptedSettings)) {
      decryptedSettings[port] = {
        ...settings,
        httpUrl: settings.httpUrl ? decrypt(settings.httpUrl) || '' : '',
        smsTarget: settings.smsTarget ? decrypt(settings.smsTarget) || '' : ''
      };
    }
    
    return decryptedSettings;
  } catch (error) {
    console.error('读取模块设置失败:', error.message);
    return {};
  }
}

// 保存模块设置
function saveModuleSettings(settings) {
  try {
    // 加密敏感字段
    const encryptedSettings = {};
    for (const [port, setting] of Object.entries(settings)) {
      encryptedSettings[port] = {
        ...setting,
        httpUrl: setting.httpUrl ? encrypt(setting.httpUrl) : '',
        smsTarget: setting.smsTarget ? encrypt(setting.smsTarget) : ''
      };
    }
    
    fs.writeFileSync(MODULE_SETTINGS_FILE, JSON.stringify(encryptedSettings, null, 2));
    console.log('模块设置已保存（敏感字段已加密）');
    return true;
  } catch (error) {
    console.error('保存模块设置失败:', error.message);
    return false;
  }
}

// 保存单个模块的设置
function saveModuleSetting(port, forwardSettings) {
  try {
    const allSettings = getModuleSettings();
    allSettings[port] = forwardSettings;
    return saveModuleSettings(allSettings);
  } catch (error) {
    console.error(`保存 ${port} 设置失败:`, error.message);
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
      // POST 请求 - token 保留在 URL 中，其他参数放到 body
      const urlObj = new URL(url);
      const tokenParam = urlObj.searchParams.get('token');
      
      // 构建新的 URL，只保留 token 参数
      const postUrl = `${urlObj.origin}${urlObj.pathname}${tokenParam ? '?token=' + tokenParam : ''}`;
      
      // 收集其他参数，将数字字符串转换为整数
      const bodyParams = {};
      urlObj.searchParams.forEach((value, key) => {
        if (key !== 'token') {
          // 尝试将数字字符串转换为整数（如 priority）
          const numValue = parseInt(value, 10);
          bodyParams[key] = !isNaN(numValue) && value.trim() === numValue.toString() ? numValue : value;
        }
      });
      
      // 对于 Gotify，使用 JSON 格式
      const response = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyParams)
      });
      console.log(`通知发送成功 (POST): ${response.status}`);
    }
  } catch (error) {
    console.error('发送登录失败通知失败:', error.message);
  }
}

// 发送存储容量警告通知
async function sendStorageWarningNotification(portPath, storageInfo) {
  const settings = moduleStates[portPath]?.forwardSettings;
  
  // 检查是否启用了存储警告
  if (!settings || !settings.storageWarningEnabled) {
    return;
  }
  
  // 检查是否达到警告阈值
  const threshold = settings.storageWarningThreshold || 80;
  if (storageInfo.percentage < threshold) {
    return;
  }
  
  const timestamp = new Date().toISOString();
  const message = `⚠️ 存储容量警告 - ${portPath}: 已使用 ${storageInfo.used}/${storageInfo.total} (${storageInfo.percentage}%)，时间: ${timestamp}`;
  
  console.log(`${portPath} 触发存储警告通知 (阈值: ${threshold}%, 当前: ${storageInfo.percentage}%)`);
  
  try {
    // HTTP转发
    if (settings.httpEnabled && settings.httpUrl) {
      try {
        const url = settings.httpUrl.replace('{sms}', encodeURIComponent(message));
        
        // 隐藏 URL 中的敏感信息（token）
        const urlObj = new URL(url);
        const safeUrl = `${urlObj.origin}${urlObj.pathname}${urlObj.searchParams.has('token') ? '?token=***' : ''}`;
        console.log(`${portPath} HTTP转发存储警告: ${safeUrl}`);
        
        if (settings.httpMethod === 'GET') {
          // GET请求
          const response = await fetch(url);
          console.log(`${portPath} 存储警告HTTP转发成功 (GET): ${response.status}`);
        } else {
          // POST请求 - token 保留在 URL 中，其他参数放到 body
          const urlObj = new URL(url);
          const tokenParam = urlObj.searchParams.get('token');
          
          // 构建新的 URL，只保留 token 参数
          const postUrl = `${urlObj.origin}${urlObj.pathname}${tokenParam ? '?token=' + tokenParam : ''}`;
          
          // 收集其他参数，将数字字符串转换为整数
          const bodyParams = {};
          urlObj.searchParams.forEach((value, key) => {
            if (key !== 'token') {
              // 尝试将数字字符串转换为整数（如 priority）
              const numValue = parseInt(value, 10);
              bodyParams[key] = !isNaN(numValue) && value.trim() === numValue.toString() ? numValue : value;
            }
          });
          
          // 对于 Gotify，使用 JSON 格式
          const response = await fetch(postUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyParams)
          });
          console.log(`${portPath} 存储警告HTTP转发成功 (POST): ${response.status}`);
        }
      } catch (error) {
        console.error(`${portPath} 存储警告HTTP转发失败:`, error.message);
      }
    }
    
    // SMS转发
    if (settings.smsEnabled && settings.smsTarget) {
      try {
        console.log(`${portPath} SMS转发存储警告到: ${settings.smsTarget}`);
        const result = await sendMessage(portPath, settings.smsTarget, message);
        
        if (result.success) {
          console.log(`${portPath} 存储警告SMS转发成功`);
        } else {
          console.error(`${portPath} 存储警告SMS转发失败:`, result.error);
        }
      } catch (error) {
        console.error(`${portPath} 存储警告SMS转发失败:`, error.message);
      }
    }
  } catch (error) {
    console.error(`${portPath} 发送存储容量警告通知失败:`, error.message);
  }
}

// 检查存储容量
async function checkStorageCapacity(portPath) {
  return new Promise((resolve) => {
    const serial = serialConnections[portPath];
    if (!serial || !serial.isOpen) {
      resolve(false);
      return;
    }

    let buffer = '';
    let timeout;

    const dataHandler = (data) => {
      buffer += data.toString();

      if (buffer.includes('+CPMS:')) {
        console.log(`${portPath} checkStorageCapacity 收到响应: ${buffer}`);
        
        // 返回格式：+CPMS: <mem1>,<used1>,<total1>,<mem2>,<used2>,<total2>,<mem3>,<used3>,<total3>
        // 我们使用 mem3（接收短信的存储器）的容量信息
        
        // 尝试完整格式（带引号）
        let match = buffer.match(/\+CPMS:\s*"[^"]+",(\d+),(\d+),"[^"]+",(\d+),(\d+),"[^"]+",(\d+),(\d+)/);
        
        // 如果没匹配，尝试简化格式（不带引号）
        if (!match) {
          match = buffer.match(/\+CPMS:\s*(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
          if (match) {
            // 使用最后一组数据（mem3）
            const used = parseInt(match[5]);
            const total = parseInt(match[6]);
            const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
            
            moduleStates[portPath].storageInfo = {
              used: used,
              total: total,
              percentage: percentage
            };
            
            console.log(`${portPath} 存储容量更新: ${used}/${total} (${percentage}%)`);
            
            // 如果存储使用率超过 80%，发送通知
            if (percentage >= 80) {
              sendStorageWarningNotification(portPath, moduleStates[portPath].storageInfo);
            }
          }
        } else {
          // 使用 mem3 的容量（接收短信存储器）
          const used = parseInt(match[5]);
          const total = parseInt(match[6]);
          const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
          
          moduleStates[portPath].storageInfo = {
            used: used,
            total: total,
            percentage: percentage
          };
          
          console.log(`${portPath} 存储容量更新: ${used}/${total} (${percentage}%)`);
          
          // 如果存储使用率超过 80%，发送通知
          if (percentage >= 80) {
            sendStorageWarningNotification(portPath, moduleStates[portPath].storageInfo);
          }
        }
      }

      if (buffer.includes('OK') || buffer.includes('ERROR')) {
        clearTimeout(timeout);
        serial.removeListener('data', dataHandler);
        resolve(true);
      }
    };

    serial.on('data', dataHandler);
    serial.write('AT+CPMS?\r\n');

    timeout = setTimeout(() => {
      serial.removeListener('data', dataHandler);
      resolve(false);
    }, 3000);
  });
}

// 初始化通知配置
initNotificationConfig();

// 初始化模块设置
initModuleSettings();

// 初始化保号配置
initKeepAliveConfig();

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
      const tokenParam = urlObj.searchParams.get('token');
      
      // 构建新的 URL，只保留 token 参数
      const postUrl = `${urlObj.origin}${urlObj.pathname}${tokenParam ? '?token=' + tokenParam : ''}`;
      
      // 收集其他参数，将数字字符串转换为整数
      const bodyParams = {};
      urlObj.searchParams.forEach((value, key) => {
        if (key !== 'token') {
          // 尝试将数字字符串转换为整数（如 priority）
          const numValue = parseInt(value, 10);
          bodyParams[key] = !isNaN(numValue) && value.trim() === numValue.toString() ? numValue : value;
        }
      });
      
      // 对于 Gotify，使用 JSON 格式
      response = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyParams)
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

// 测试登录通知API
app.post('/api/test-login-notification', requireAuth, async (req, res) => {
  const { url, method } = req.body;
  
  if (!url) {
    return res.json({ success: false, error: 'URL 不能为空' });
  }
  
  try {
    const testMessage = '登录失败 - IP: 192.168.1.100, 用户名: testuser, 错误: 测试通知, 时间: ' + new Date().toISOString();
    const testUrl = url.replace('{login}', encodeURIComponent(testMessage));
    
    console.log(`测试登录通知: ${method} ${testUrl}`);
    
    const startTime = Date.now();
    let response;
    
    if (method === 'GET') {
      // GET 请求
      response = await fetch(testUrl);
    } else {
      // POST 请求 - token 保留在 URL 中，其他参数放到 body
      const urlObj = new URL(testUrl);
      const tokenParam = urlObj.searchParams.get('token');
      
      // 构建新的 URL，只保留 token 参数
      const postUrl = `${urlObj.origin}${urlObj.pathname}${tokenParam ? '?token=' + tokenParam : ''}`;
      
      // 收集其他参数，将数字字符串转换为整数
      const bodyParams = {};
      urlObj.searchParams.forEach((value, key) => {
        if (key !== 'token') {
          // 尝试将数字字符串转换为整数（如 priority）
          const numValue = parseInt(value, 10);
          bodyParams[key] = !isNaN(numValue) && value.trim() === numValue.toString() ? numValue : value;
        }
      });
      
      // 对于 Gotify，使用 JSON 格式
      response = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyParams)
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
    
    console.log(`登录通知测试完成: ${response.status} ${response.statusText} (${duration}ms)`);
    
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
    console.error('登录通知测试失败:', error.message);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// 测试存储警告通知API
app.post('/api/test-storage-warning/:port', requireAuth, async (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  
  if (!moduleStates[portPath]) {
    return res.json({ success: false, error: '模块不存在' });
  }
  
  const settings = moduleStates[portPath].forwardSettings;
  
  if (!settings || !settings.storageWarningEnabled) {
    return res.json({ success: false, error: '存储警告功能未启用' });
  }
  
  if (!settings.httpEnabled && !settings.smsEnabled) {
    return res.json({ success: false, error: '请先启用 HTTP 转发或 SMS 转发功能' });
  }
  
  try {
    const testStorageInfo = {
      used: 45,
      total: 50,
      percentage: 90
    };
    
    const timestamp = new Date().toISOString();
    const message = `⚠️ 存储容量警告（测试）- ${portPath}: 已使用 ${testStorageInfo.used}/${testStorageInfo.total} (${testStorageInfo.percentage}%)，时间: ${timestamp}`;
    
    let httpSent = false;
    let smsSent = false;
    let errors = [];
    
    // HTTP转发测试
    if (settings.httpEnabled && settings.httpUrl) {
      try {
        const url = settings.httpUrl.replace('{sms}', encodeURIComponent(message));
        
        console.log(`${portPath} 测试存储警告HTTP转发`);
        
        if (settings.httpMethod === 'GET') {
          const response = await fetch(url);
          if (response.ok) {
            httpSent = true;
            console.log(`${portPath} 测试存储警告HTTP转发成功 (GET): ${response.status}`);
          } else {
            errors.push(`HTTP转发失败: ${response.status} ${response.statusText}`);
          }
        } else {
          const urlObj = new URL(url);
          const tokenParam = urlObj.searchParams.get('token');
          const postUrl = `${urlObj.origin}${urlObj.pathname}${tokenParam ? '?token=' + tokenParam : ''}`;
          
          const bodyParams = {};
          urlObj.searchParams.forEach((value, key) => {
            if (key !== 'token') {
              const numValue = parseInt(value, 10);
              bodyParams[key] = !isNaN(numValue) && value.trim() === numValue.toString() ? numValue : value;
            }
          });
          
          const response = await fetch(postUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyParams)
          });
          
          if (response.ok) {
            httpSent = true;
            console.log(`${portPath} 测试存储警告HTTP转发成功 (POST): ${response.status}`);
          } else {
            errors.push(`HTTP转发失败: ${response.status} ${response.statusText}`);
          }
        }
      } catch (error) {
        errors.push(`HTTP转发失败: ${error.message}`);
        console.error(`${portPath} 测试存储警告HTTP转发失败:`, error.message);
      }
    }
    
    // SMS转发测试
    if (settings.smsEnabled && settings.smsTarget) {
      try {
        console.log(`${portPath} 测试存储警告SMS转发到: ${settings.smsTarget}`);
        const result = await sendMessage(portPath, settings.smsTarget, message);
        
        if (result.success) {
          smsSent = true;
          console.log(`${portPath} 测试存储警告SMS转发成功`);
        } else {
          errors.push(`SMS转发失败: ${result.error}`);
        }
      } catch (error) {
        errors.push(`SMS转发失败: ${error.message}`);
        console.error(`${portPath} 测试存储警告SMS转发失败:`, error.message);
      }
    }
    
    if (httpSent || smsSent) {
      res.json({
        success: true,
        httpSent: httpSent,
        smsSent: smsSent
      });
    } else {
      res.json({
        success: false,
        error: errors.join('; ')
      });
    }
  } catch (error) {
    console.error(`${portPath} 测试存储警告通知失败:`, error.message);
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
      
      // 更新存储容量
      setTimeout(() => {
        checkStorageCapacity(portPath);
      }, 1000);
      
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
  
  // 为每个模块添加保号配置信息
  const keepAliveConfig = getKeepAliveConfig();
  modules.forEach(module => {
    const config = keepAliveConfig[module.port];
    if (config && config.enabled) {
      module.keepAlive = {
        enabled: true,
        intervalDays: config.intervalDays,
        lastSentTime: config.lastSentTime,
        targetPhone: config.targetPhone
      };
    } else {
      module.keepAlive = {
        enabled: false
      };
    }
  });
  
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
    console.log(`PDU解码 - DCS: 0x${dcs.toString(16).toUpperCase()}, UDL: ${udl}, UserData长度: ${userData.length}`);
    
    // 判断编码类型
    // DCS 的 bit 2-3 表示字符集:
    // 00 = GSM 7-bit default alphabet
    // 01 = 8-bit data
    // 10 = UCS2 (16-bit)
    // 11 = Reserved
    const charset = (dcs >> 2) & 0x03;
    
    if (charset === 0 || dcs === 0x00 || dcs === 0x01) {
      // 7-bit编码 (GSM默认字符集)
      console.log(`使用 7-bit 解码`);
      content = decode7bit(userData, udl);
      
      // 智能检测：如果 7-bit 解码后大部分是不可打印字符或乱码，尝试 UCS2
      const printableCount = content.split('').filter(c => {
        const code = c.charCodeAt(0);
        return (code >= 32 && code <= 126) || code >= 0x4E00; // ASCII 可打印字符或中文
      }).length;
      const printableRatio = content.length > 0 ? printableCount / content.length : 0;
      
      console.log(`7-bit 解码可读性: ${(printableRatio * 100).toFixed(1)}% (${printableCount}/${content.length})`);
      
      // 如果可读性低且数据足够长，尝试 UCS2
      if (printableRatio < 0.3 && content.length >= 20) {
        console.log(`7-bit 解码结果可读性低，尝试 UCS2 解码`);
        // 尝试 UCS2 解码
        const charCount = Math.floor(udl / 2);
        let ucs2Content = '';
        for (let i = 0; i < charCount && i * 4 < userData.length; i++) {
          const code = parseInt(userData.substr(i * 4, 4), 16);
          if (code) {
            ucs2Content += String.fromCharCode(code);
          }
        }
        
        // 检查 UCS2 解码结果
        const ucs2PrintableCount = ucs2Content.split('').filter(c => {
          const code = c.charCodeAt(0);
          return (code >= 32 && code <= 126) || code >= 0x4E00;
        }).length;
        const ucs2PrintableRatio = ucs2Content.length > 0 ? ucs2PrintableCount / ucs2Content.length : 0;
        
        console.log(`UCS2 解码可读性: ${(ucs2PrintableRatio * 100).toFixed(1)}% (${ucs2PrintableCount}/${ucs2Content.length})`);
        
        if (ucs2PrintableRatio > printableRatio) {
          console.log(`✓ 使用 UCS2 解码结果（可读性更高）`);
          content = ucs2Content;
        } else {
          console.log(`✗ 保留 7-bit 解码结果`);
        }
      }
    } else if (charset === 2 || dcs === 0x08 || dcs === 0x18) {
      // UCS2编码 (16-bit Unicode)
      console.log(`使用 UCS2 解码`);
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
      console.log(`使用 8-bit 解码`);
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
      
      // 隐藏 URL 中的敏感信息（token）
      const urlObj = new URL(url);
      const safeUrl = `${urlObj.origin}${urlObj.pathname}${urlObj.searchParams.has('token') ? '?token=***' : ''}`;
      console.log(`${portPath} HTTP转发: ${safeUrl}`);
      
      if (settings.httpMethod === 'GET') {
        // GET请求
        const response = await fetch(url);
        console.log(`${portPath} HTTP转发成功 (GET): ${response.status}`);
      } else {
        // POST请求 - token 保留在 URL 中，其他参数放到 body
        const urlObj = new URL(url);
        const tokenParam = urlObj.searchParams.get('token');
        
        // 构建新的 URL，只保留 token 参数
        const postUrl = `${urlObj.origin}${urlObj.pathname}${tokenParam ? '?token=' + tokenParam : ''}`;
        
        // 收集其他参数，将数字字符串转换为整数
        const bodyParams = {};
        urlObj.searchParams.forEach((value, key) => {
          if (key !== 'token') {
            // 尝试将数字字符串转换为整数（如 priority）
            const numValue = parseInt(value, 10);
            bodyParams[key] = !isNaN(numValue) && value.trim() === numValue.toString() ? numValue : value;
          }
        });
        
        // 对于 Gotify，使用 JSON 格式
        const response = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(bodyParams)
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

// 初始化所有模块的监听（轮询模式）
let currentInitializingPortIndex = 0;
let initializationQueue = [];

function initializeModuleListeners() {
  // 加载保存的模块设置
  const savedSettings = getModuleSettings();
  
  // 初始化所有模块状态
  ports.forEach(portPath => {
    // 获取该模块保存的设置，如果没有则使用默认值
    const savedForwardSettings = savedSettings[portPath] || {
      httpEnabled: false,
      httpUrl: '',
      httpMethod: 'GET',
      smsEnabled: false,
      smsTarget: '',
      storageWarningEnabled: false, // 存储警告开关
      storageWarningThreshold: 80 // 存储警告阈值（百分比）
    };
    
    moduleStates[portPath] = {
      port: portPath,
      status: 'waiting',
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
      storageInfo: { // 存储信息
        used: 0,
        total: 0,
        percentage: 0
      },
      forwardSettings: savedForwardSettings, // 使用保存的设置
      multipartMessages: {} // 存储长短信片段
    };
    
    console.log(`${portPath} 已加载转发设置 (HTTP: ${savedForwardSettings.httpEnabled ? '启用' : '禁用'}, SMS: ${savedForwardSettings.smsEnabled ? '启用' : '禁用'})`);
  });
  
  // 初始化队列
  initializationQueue = [...ports];
  currentInitializingPortIndex = 0;
  
  // 开始轮询初始化
  console.log('=== 开始轮询初始化模块 ===');
  initializeNextPort();
}

// 初始化下一个端口
function initializeNextPort() {
  if (currentInitializingPortIndex >= initializationQueue.length) {
    console.log('=== 所有模块初始化完成 ===');
    broadcastUpdate();
    return;
  }
  
  const portPath = initializationQueue[currentInitializingPortIndex];
  console.log(`\n>>> 开始初始化 ${portPath} (${currentInitializingPortIndex + 1}/${initializationQueue.length}) <<<`);
  moduleStates[portPath].status = 'initializing';
  broadcastUpdate();
  
  // 启动监听
  startPortListener(portPath);
}

// 标记端口初始化完成，继续下一个
function markPortInitialized(portPath) {
  console.log(`>>> ${portPath} 初始化完成 <<<\n`);
  currentInitializingPortIndex++;
  
  // 延迟 2 秒后初始化下一个端口，避免冲突
  setTimeout(() => {
    initializeNextPort();
  }, 2000);
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
    let commandTimeout = null;
    let retryCount = {}; // 记录每个步骤的重试次数

    // 命令超时处理函数
    function setCommandTimeout(step, nextCommand, delay = 3000) {
      if (commandTimeout) {
        clearTimeout(commandTimeout);
      }
      
      // 初始化重试计数
      if (!retryCount[step]) {
        retryCount[step] = 0;
      }
      
      commandTimeout = setTimeout(() => {
        retryCount[step]++;
        
        if (retryCount[step] >= 5) {
          console.log(`${portPath} 步骤 ${step} 重试超过 5 次，放弃初始化`);
          addCommandHistory(portPath, 'error', `步骤 ${step} 超时重试 5 次失败`);
          
          // 关闭串口
          if (serial && serial.isOpen) {
            serial.close();
          }
          
          // 标记为错误状态
          moduleStates[portPath].status = 'error';
          broadcastUpdate();
          
          // 继续下一个模块
          markPortInitialized(portPath);
          return;
        }
        
        console.log(`${portPath} 步骤 ${step} 超时，重试 ${retryCount[step]}/5...`);
        if (nextCommand) {
          sendCommand(portPath, nextCommand);
          // 再次设置超时
          setCommandTimeout(step, nextCommand, delay);
        }
      }, delay);
    }

    serial.open((err) => {
      if (err) {
        console.error(`无法打开 ${portPath}:`, err.message);
        moduleStates[portPath].status = 'error';
        broadcastUpdate();
        
        // 标记此端口初始化完成（失败），继续下一个
        markPortInitialized(portPath);
        return;
      }

      console.log(`${portPath} 已打开，开始初始化...`);
      serialConnections[portPath] = serial;

      // 初始化序列 - 延长等待时间
      setTimeout(() => {
        // 0. 设置PDU模式
        initStep = 0.5;
        sendCommand(portPath, 'AT+CMGF=0');
        setCommandTimeout(0.5, 'AT+CMGF=0', 3000);
      }, 1000); // 从500ms延长到1000ms
    });

    serial.on('data', (data) => {
      const rawData = data.toString();
      buffer += rawData;
      
      // 实时打印接收到的原始数据
      console.log(`[${portPath}] RAW: ${rawData.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}`);
      
      // 检查是否有完整的行
      if (buffer.includes('\n')) {
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留最后不完整的部分
        
        lines.forEach(line => {
          line = line.trim();
          if (!line) return;
          
          console.log(`[${portPath}] PARSED: ${line}`);
          
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
          
          // 解析存储容量信息
          if (line.includes('+CPMS:') && initStep !== 5) {
            console.log(`${portPath} 收到 CPMS 查询响应: ${line}`);
            
            // 返回格式：+CPMS: <mem1>,<used1>,<total1>,<mem2>,<used2>,<total2>,<mem3>,<used3>,<total3>
            // 我们使用 mem3（接收短信的存储器）的容量信息
            
            // 尝试完整格式（带引号）
            let match = line.match(/\+CPMS:\s*"[^"]+",(\d+),(\d+),"[^"]+",(\d+),(\d+),"[^"]+",(\d+),(\d+)/);
            
            // 如果没匹配，尝试简化格式（不带引号）
            if (!match) {
              match = line.match(/\+CPMS:\s*(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
              if (match) {
                // 使用最后一组数据（mem3）
                const used = parseInt(match[5]);
                const total = parseInt(match[6]);
                const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
                
                moduleStates[portPath].storageInfo = {
                  used: used,
                  total: total,
                  percentage: percentage
                };
                
                console.log(`${portPath} 存储容量: ${used}/${total} (${percentage}%)`);
                
                // 如果存储使用率超过 80%，发送通知
                if (percentage >= 80) {
                  sendStorageWarningNotification(portPath, moduleStates[portPath].storageInfo);
                }
                
                // 广播更新以显示存储信息
                if (initStep === 0) {
                  broadcastUpdate();
                }
              }
            } else {
              // 使用 mem3 的容量（接收短信存储器）
              const used = parseInt(match[5]);
              const total = parseInt(match[6]);
              const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
              
              moduleStates[portPath].storageInfo = {
                used: used,
                total: total,
                percentage: percentage
              };
              
              console.log(`${portPath} 存储容量: ${used}/${total} (${percentage}%)`);
              
              // 如果存储使用率超过 80%，发送通知
              if (percentage >= 80) {
                sendStorageWarningNotification(portPath, moduleStates[portPath].storageInfo);
              }
              
              // 广播更新以显示存储信息
              if (initStep === 0) {
                broadcastUpdate();
              }
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
                  // 检查存储容量
                  setTimeout(() => {
                    checkStorageCapacity(portPath);
                  }, 1000);
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
            clearTimeout(commandTimeout);
            retryCount[0.5] = 0; // 清除重试计数
            initStep = 1;
            setTimeout(() => {
              sendCommand(portPath, 'AT');
              setCommandTimeout(1, 'AT', 3000);
            }, 500); // 延长间隔到500ms
          } else if (initStep === 1 && line.includes('OK')) {
            clearTimeout(commandTimeout);
            retryCount[1] = 0; // 清除重试计数
            moduleStates[portPath].moduleDetected = true;
            initStep = 2;
            setTimeout(() => {
              sendCommand(portPath, 'AT+ICCID');
              setCommandTimeout(2, 'AT+ICCID', 3000);
            }, 500);
          } else if (initStep === 2) {
            if (line.includes('+ICCID:')) {
              const match = line.match(/\+ICCID:\s*(\d+)/);
              if (match) {
                moduleStates[portPath].iccid = match[1];
              }
            } else if (line.includes('OK')) {
              clearTimeout(commandTimeout);
              retryCount[2] = 0; // 清除重试计数
              moduleStates[portPath].simDetected = true;
              initStep = 3;
              setTimeout(() => {
                sendCommand(portPath, 'AT+CGSN');
                setCommandTimeout(3, 'AT+CGSN', 3000);
              }, 500);
            } else if (line.includes('ERROR')) {
              // SIM卡检测失败，但模块正常
              clearTimeout(commandTimeout);
              retryCount[2] = 0; // 清除重试计数
              console.log(`${portPath} SIM卡检测失败，继续尝试其他命令...`);
              moduleStates[portPath].simDetected = false;
              initStep = 3;
              setTimeout(() => {
                sendCommand(portPath, 'AT+CGSN');
                setCommandTimeout(3, 'AT+CGSN', 3000);
              }, 500);
            }
          } else if (initStep === 3) {
            const imeiMatch = line.match(/^(\d{15})$/);
            if (imeiMatch) {
              moduleStates[portPath].imei = imeiMatch[1];
            } else if (line.includes('OK') || line.includes('ERROR')) {
              clearTimeout(commandTimeout);
              retryCount[3] = 0; // 清除重试计数
              initStep = 4;
              // 设置短信通知模式
              setTimeout(() => {
                sendCommand(portPath, 'AT+CNMI=2,1,0,0,0');
                setCommandTimeout(4, 'AT+CNMI=2,1,0,0,0', 3000);
              }, 500);
            }
          } else if (initStep === 4 && (line.includes('OK') || line.includes('ERROR'))) {
            clearTimeout(commandTimeout);
            retryCount[4] = 0; // 清除重试计数
            initStep = 5;
            // 设置短信存储位置为SIM卡
            // 注意：根据模块文档，目前仅支持"SM"存储类型
            // SM = SIM Message (SIM卡存储)
            // 返回格式：+CPMS: <mem1>,<used1>,<total1>,<mem2>,<used2>,<total2>,<mem3>,<used3>,<total3>
            setTimeout(() => {
              sendCommand(portPath, 'AT+CPMS="SM","SM","SM"');
              setCommandTimeout(5, 'AT+CPMS="SM","SM","SM"', 3000);
            }, 500);
          } else if (initStep === 5) {
            // 解析存储容量信息
            if (line.includes('+CPMS:')) {
              console.log(`${portPath} 收到 CPMS 响应: ${line}`);
              
              // 返回格式：+CPMS: <mem1>,<used1>,<total1>,<mem2>,<used2>,<total2>,<mem3>,<used3>,<total3>
              // 我们使用 mem3（接收短信的存储器）的容量信息
              
              // 尝试完整格式（带引号）
              let match = line.match(/\+CPMS:\s*"[^"]+",(\d+),(\d+),"[^"]+",(\d+),(\d+),"[^"]+",(\d+),(\d+)/);
              
              // 如果没匹配，尝试简化格式（不带引号）
              if (!match) {
                match = line.match(/\+CPMS:\s*(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
                if (match) {
                  console.log(`${portPath} 使用简化格式解析 CPMS`);
                  // 使用最后一组数据（mem3）
                  const used = parseInt(match[5]);
                  const total = parseInt(match[6]);
                  moduleStates[portPath].storageInfo = {
                    used: used,
                    total: total,
                    percentage: total > 0 ? Math.round((used / total) * 100) : 0
                  };
                  console.log(`${portPath} 存储容量: ${used}/${total} (${moduleStates[portPath].storageInfo.percentage}%)`);
                }
              } else {
                console.log(`${portPath} 使用完整格式解析 CPMS`);
                // 使用 mem3 的容量（接收短信存储器）
                const used = parseInt(match[5]);
                const total = parseInt(match[6]);
                moduleStates[portPath].storageInfo = {
                  used: used,
                  total: total,
                  percentage: total > 0 ? Math.round((used / total) * 100) : 0
                };
                console.log(`${portPath} 存储容量: ${used}/${total} (${moduleStates[portPath].storageInfo.percentage}%)`);
              }
              
              // 如果存储使用率超过 80%，发送通知
              if (moduleStates[portPath].storageInfo && moduleStates[portPath].storageInfo.percentage >= 80) {
                sendStorageWarningNotification(portPath, moduleStates[portPath].storageInfo);
              }
            }
            
            if (line.includes('OK') || line.includes('ERROR')) {
              clearTimeout(commandTimeout);
              retryCount[5] = 0; // 清除重试计数
              initStep = 6;
              // 查询运营商信息
              setTimeout(() => {
                sendCommand(portPath, 'AT+COPS?');
                setCommandTimeout(6, 'AT+COPS?', 3000);
              }, 500);
            }
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
              clearTimeout(commandTimeout);
              retryCount[6] = 0; // 清除重试计数
              initStep = 7;
              // 查询信号强度
              setTimeout(() => {
                sendCommand(portPath, 'AT+CSQ');
                setCommandTimeout(7, 'AT+CSQ', 3000);
              }, 500);
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
              clearTimeout(commandTimeout);
              retryCount[7] = 0; // 清除重试计数
              // 基本初始化完成，立即广播状态让前端显示卡片
              moduleStates[portPath].status = moduleStates[portPath].simDetected ? 'ok' : 'no_sim';
              console.log(`${portPath} 基本初始化完成，状态: ${moduleStates[portPath].status}`);
              broadcastUpdate(); // 立即广播，让前端显示卡片
              
              // 异步加载短信（不阻塞界面显示）
              initStep = 8;
              setTimeout(() => {
                sendCommand(portPath, 'AT+CMGL=4');
                setCommandTimeout(8, null, 5000); // 短信列表可能需要更长时间
              }, 500);
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
            } else if (line.includes('OK') || line.includes('ERROR')) {
              clearTimeout(commandTimeout);
              retryCount[8] = 0; // 清除重试计数
              initStep = 0; // 短信加载完成
              console.log(`${portPath} 短信加载完成，未读: ${moduleStates[portPath].unreadCount}, 短信数: ${moduleStates[portPath].messages.length}`);
              broadcastUpdate(); // 再次广播，更新短信数据
              
              // 标记此端口初始化完成，继续下一个
              markPortInitialized(portPath);
            }
          }
        });
      }
    });

    serial.on('close', () => {
      console.log(`${portPath} 已关闭`);
      delete serialConnections[portPath];
      
      // 如果是在初始化过程中关闭，标记为错误并继续下一个
      if (initStep > 0) {
        moduleStates[portPath].status = 'error';
        broadcastUpdate();
        markPortInitialized(portPath);
      }
    });

    serial.on('error', (err) => {
      console.error(`${portPath} 错误:`, err.message);
      addCommandHistory(portPath, 'error', err.message);
    });

  } catch (err) {
    console.error(`启动 ${portPath} 监听失败:`, err.message);
    moduleStates[portPath].status = 'error';
    broadcastUpdate();
    
    // 标记此端口初始化完成（失败），继续下一个
    markPortInitialized(portPath);
  }
}

// 发送短信锁（每个端口一个锁）
const sendMessageLocks = {};

// 将字符串转换为 UCS2 编码（用于中文短信）
function stringToUCS2(str) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const hex = code.toString(16).toUpperCase().padStart(4, '0');
    result += hex;
  }
  return result;
}

// 检测字符串是否包含中文或其他非 GSM 字符
function needsUCS2Encoding(str) {
  // GSM 7-bit 字符集支持的字符
  const gsmChars = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà\^{}\\\[~\]|€]*$/;
  return !gsmChars.test(str);
}

// GSM 7-bit 打包编码
// 将每个 7-bit 字符打包成 8-bit 字节流
function encodeGSM7bit(str) {
  // GSM 默认字母表映射（ASCII 子集直接映射，特殊字符需要转换）
  const gsm7bitMap = {
    '@': 0, '£': 1, '$': 2, '¥': 3, 'è': 4, 'é': 5, 'ù': 6, 'ì': 7,
    'ò': 8, 'Ç': 9, '\n': 10, 'Ø': 11, 'ø': 12, '\r': 13, 'Å': 14, 'å': 15,
    'Δ': 16, '_': 17, 'Φ': 18, 'Γ': 19, 'Λ': 20, 'Ω': 21, 'Π': 22, 'Ψ': 23,
    'Σ': 24, 'Θ': 25, 'Ξ': 26, 'Æ': 29, 'æ': 30, 'ß': 31, 'É': 32,
    ' ': 32, '!': 33, '"': 34, '#': 35, '¤': 36, '%': 37, '&': 38, "'": 39,
    '(': 40, ')': 41, '*': 42, '+': 43, ',': 44, '-': 45, '.': 46, '/': 47,
    '0': 48, '1': 49, '2': 50, '3': 51, '4': 52, '5': 53, '6': 54, '7': 55,
    '8': 56, '9': 57, ':': 58, ';': 59, '<': 60, '=': 61, '>': 62, '?': 63,
    '¡': 64, 'A': 65, 'B': 66, 'C': 67, 'D': 68, 'E': 69, 'F': 70, 'G': 71,
    'H': 72, 'I': 73, 'J': 74, 'K': 75, 'L': 76, 'M': 77, 'N': 78, 'O': 79,
    'P': 80, 'Q': 81, 'R': 82, 'S': 83, 'T': 84, 'U': 85, 'V': 86, 'W': 87,
    'X': 88, 'Y': 89, 'Z': 90, 'Ä': 91, 'Ö': 92, 'Ñ': 93, 'Ü': 94, '§': 95,
    '¿': 96, 'a': 97, 'b': 98, 'c': 99, 'd': 100, 'e': 101, 'f': 102, 'g': 103,
    'h': 104, 'i': 105, 'j': 106, 'k': 107, 'l': 108, 'm': 109, 'n': 110, 'o': 111,
    'p': 112, 'q': 113, 'r': 114, 's': 115, 't': 116, 'u': 117, 'v': 118, 'w': 119,
    'x': 120, 'y': 121, 'z': 122, 'ä': 123, 'ö': 124, 'ñ': 125, 'ü': 126, 'à': 127
  };

  // 将字符串转换为 septet 数组
  const septets = [];
  for (let i = 0; i < str.length; i++) {
    const code = gsm7bitMap[str[i]];
    septets.push(code !== undefined ? code : 63); // 未知字符用 '?' 替代
  }

  // 将 7-bit septets 打包为 8-bit octets
  const octets = [];
  let bits = 0;
  let current = 0;

  for (let i = 0; i < septets.length; i++) {
    // 将当前 septet 左移 bits 位，与 current 合并
    current |= (septets[i] << bits);
    bits += 7;

    while (bits >= 8) {
      octets.push(current & 0xFF);
      current >>= 8;
      bits -= 8;
    }
  }

  // 如果还有剩余 bits，写入最后一个 octet
  if (bits > 0) {
    octets.push(current & 0xFF);
  }

  return octets.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

// 生成 PDU 格式短信
function generatePDU(phone, message) {
  // SMSC（短信中心号码）- 使用默认，长度为 00
  let pdu = '00';
  
  // PDU 类型：SMS-SUBMIT，TP-VPF=relative
  pdu += '11'; // 00010001
  
  // TP-MR（消息参考）
  pdu += '00';
  
  // 目标号码长度
  const phoneDigits = phone.replace(/\+/g, '');
  pdu += phoneDigits.length.toString(16).padStart(2, '0').toUpperCase();
  
  // 目标号码类型（国际号码 91，国内号码 81）
  const phoneType = phone.startsWith('+') ? '91' : '81';
  pdu += phoneType;
  
  // 目标号码（交换每对数字，奇数长度末尾补 F）
  let phoneHex = phoneDigits;
  if (phoneHex.length % 2 !== 0) {
    phoneHex += 'F';
  }
  let swappedPhone = '';
  for (let i = 0; i < phoneHex.length; i += 2) {
    swappedPhone += phoneHex[i + 1] + phoneHex[i];
  }
  pdu += swappedPhone;
  
  // TP-PID（协议标识）
  pdu += '00';
  
  // TP-DCS（数据编码方案）
  const useUCS2 = needsUCS2Encoding(message);
  if (useUCS2) {
    pdu += '08'; // UCS2 编码
  } else {
    pdu += '00'; // GSM 7-bit 编码
  }
  
  // TP-VP（有效期）- 相对格式，167 = 24小时
  pdu += 'A7';
  
  // TP-UDL（用户数据长度）和 TP-UD（用户数据）
  if (useUCS2) {
    const ucs2Data = stringToUCS2(message);
    const udl = ucs2Data.length / 2; // UCS2 中每个字符 2 字节
    pdu += udl.toString(16).padStart(2, '0').toUpperCase();
    pdu += ucs2Data;
  } else {
    // GSM 7-bit 打包编码
    const udl = message.length; // 字符数（septet 数）
    pdu += udl.toString(16).padStart(2, '0').toUpperCase();
    pdu += encodeGSM7bit(message);
  }
  
  return pdu;
}

// 发送短信
async function sendMessage(portPath, phone, message) {
  // 检查是否有正在进行的发送任务
  if (sendMessageLocks[portPath]) {
    console.log(`${portPath} 有正在进行的短信发送任务，拒绝新请求`);
    return {
      success: false,
      error: '有正在进行的短信发送任务，请稍后再试',
      steps: []
    };
  }
  
  // 设置锁
  sendMessageLocks[portPath] = true;
  
  try {
    return await new Promise((resolve) => {
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
      let pduData = '';

      const dataHandler = (data) => {
        buffer += data.toString();

        if (step === 1 && buffer.includes('OK')) {
          // PDU 模式设置成功
          buffer = '';
          step = 2;
          result.steps.push('设置PDU模式');
          
          // 生成 PDU 数据
          pduData = generatePDU(phone, message);
          const pduLength = (pduData.length / 2) - 1; // 减去 SMSC 长度字节
          
          console.log(`${portPath} 发送PDU短信，号码: ${phone}, PDU长度: ${pduLength}, PDU: ${pduData}, 内容: ${message.substring(0, 20)}...`);
          
          // 发送 AT+CMGS 命令
          serial.write(`AT+CMGS=${pduLength}\r\n`);
        } else if (step === 2 && buffer.includes('>')) {
          // 收到提示符，发送 PDU 数据
          buffer = '';
          step = 3;
          result.steps.push(`发送PDU数据到 ${phone}`);
          serial.write(pduData + String.fromCharCode(26)); // PDU + Ctrl-Z
        } else if (step === 3 && buffer.includes('+CMGS:')) {
          // 发送成功
          if (buffer.includes('OK')) {
            // +CMGS 和 OK 在同一数据包中
            clearTimeout(timeout);
            result.success = true;
            result.steps.push('发送成功');
            addCommandHistory(portPath, 'sms_sent', `发送到 ${phone}: ${message}`);
            serial.removeListener('data', dataHandler);
            resolve(result);
          } else {
            // 等待 OK
            step = 4;
          }
        } else if ((step === 3 || step === 4) && buffer.includes('OK')) {
          clearTimeout(timeout);
          result.success = true;
          result.steps.push('发送成功');
          
          // 记录发送的短信到命令历史
          addCommandHistory(portPath, 'sms_sent', `发送到 ${phone}: ${message}`);
          
          serial.removeListener('data', dataHandler);
          resolve(result);
        } else if (buffer.includes('ERROR') || buffer.includes('+CMS ERROR:')) {
          clearTimeout(timeout);
          
          // 提取错误信息
          const errorMatch = buffer.match(/\+CMS ERROR:\s*(\d+)/);
          result.error = errorMatch ? `发送失败 (错误码: ${errorMatch[1]})` : '发送失败';
          
          // 记录发送失败
          addCommandHistory(portPath, 'sms_error', `发送失败 ${phone}: ${message} - ${result.error}`);
          
          serial.removeListener('data', dataHandler);
          resolve(result);
        }
      };

      serial.on('data', dataHandler);

      // 开始发送 - 设置为 PDU 模式
      step = 1;
      result.steps.push('设置PDU模式');
      serial.write('AT+CMGF=0\r\n');

      timeout = setTimeout(() => {
        result.error = '超时';
        serial.removeListener('data', dataHandler);
        resolve(result);
      }, 15000); // 增加超时时间到 15 秒
    });
  } finally {
    // 释放锁
    delete sendMessageLocks[portPath];
  }
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
  
  // 保存到内存
  moduleStates[port].forwardSettings = settings;
  console.log(`${port} 转发设置已更新 (HTTP: ${settings.httpEnabled ? '启用' : '禁用'}, SMS: ${settings.smsEnabled ? '启用' : '禁用'})`);
  
  // 保存到文件
  const saved = saveModuleSetting(port, settings);
  if (!saved) {
    console.error(`${port} 设置保存到文件失败`);
  }
  
  // 广播更新
  broadcastUpdate();
  
  res.json({ success: true });
});

// 启动保号定时任务
function startKeepAliveTask(portPath, config) {
  // 检查是否正在创建定时器（防止并发）
  if (keepAliveTimerLocks[portPath]) {
    console.log(`${portPath} 正在创建保号定时器，跳过重复调用`);
    return;
  }
  
  keepAliveTimerLocks[portPath] = true;
  
  try {
    // 清除旧的定时器
    if (keepAliveTimers[portPath]) {
      console.log(`${portPath} 清除旧的保号定时器 (ID: ${keepAliveTimers[portPath]})`);
      clearTimeout(keepAliveTimers[portPath]);
      delete keepAliveTimers[portPath];
    }
    
    if (!config.enabled) {
      console.log(`${portPath} 保号功能已禁用`);
      return;
    }
    
    if (!config.targetPhone || !config.intervalDays || !config.message) {
      console.log(`${portPath} 保号配置不完整`);
      return;
    }
    
    const intervalDays = parseInt(config.intervalDays);
    if (isNaN(intervalDays) || intervalDays <= 0) {
      console.error(`${portPath} intervalDays 无效: ${config.intervalDays}`);
      return;
    }
    
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
    
    console.log(`${portPath} 启动保号任务: 每${intervalDays}天向${config.targetPhone}发送短信`);
    
    // 检查上次发送时间，计算下次发送的延迟
    const now = Date.now();
    const lastSent = config.lastSentTime || 0;
    let nextDelay;
    
    if (lastSent === 0) {
      // 首次启用，从现在开始计时
      console.log(`${portPath} 首次启用保号功能，将在${intervalDays}天后发送`);
      nextDelay = intervalMs;
      
      // 记录启用时间
      const allConfig = getKeepAliveConfig();
      allConfig[portPath] = { ...config, intervalDays, lastSentTime: now };
      saveKeepAliveConfig(allConfig);
    } else {
      const timeSinceLastSent = now - lastSent;
      
      if (timeSinceLastSent >= intervalMs) {
        // 已超过间隔，立即发送
        console.log(`${portPath} 距离上次发送已超过${intervalDays}天，立即发送`);
        nextDelay = 0;
      } else {
        nextDelay = intervalMs - timeSinceLastSent;
        const remainingHours = Math.round(nextDelay / 1000 / 60 / 60);
        console.log(`${portPath} 下次保号短信将在${remainingHours}小时后发送`);
      }
    }
    
    // 使用 setTimeout 链式调用代替 setInterval
    // 因为 setInterval 的延迟超过 2^31-1 (约24.8天) 时会立即触发！
    scheduleKeepAlive(portPath, config, nextDelay);
    
  } finally {
    delete keepAliveTimerLocks[portPath];
  }
}

// 使用 setTimeout 链式调度保号任务（避免 setInterval 溢出问题）
// setTimeout/setInterval 的最大安全延迟为 2^31-1 = 2147483647ms ≈ 24.8天
// 超过此值会被截断为1，导致立即触发
const MAX_TIMEOUT_DELAY = 2147483647; // 约24.8天

function scheduleKeepAlive(portPath, config, delayMs) {
  // 清除旧的定时器
  if (keepAliveTimers[portPath]) {
    clearTimeout(keepAliveTimers[portPath]);
    delete keepAliveTimers[portPath];
  }
  
  // 再次检查配置是否启用
  const currentConfig = getKeepAliveConfig()[portPath];
  if (!currentConfig || !currentConfig.enabled) {
    console.log(`${portPath} 保号功能已禁用，不再调度`);
    return;
  }
  
  const intervalMs = (parseInt(config.intervalDays) || 30) * 24 * 60 * 60 * 1000;
  
  if (delayMs > MAX_TIMEOUT_DELAY) {
    // 延迟超过最大安全值，分段等待
    console.log(`${portPath} 保号延迟${Math.round(delayMs / 1000 / 60 / 60)}小时，分段等待中...`);
    keepAliveTimers[portPath] = setTimeout(() => {
      scheduleKeepAlive(portPath, config, delayMs - MAX_TIMEOUT_DELAY);
    }, MAX_TIMEOUT_DELAY);
  } else {
    // 延迟在安全范围内，直接设置
    const delayHours = Math.round(delayMs / 1000 / 60 / 60);
    console.log(`${portPath} 保号定时器已设置，${delayMs <= 0 ? '立即执行' : `${delayHours}小时后执行`}`);
    
    keepAliveTimers[portPath] = setTimeout(async () => {
      console.log(`${portPath} 保号定时器触发`);
      await sendKeepAliveSMS(portPath, config);
      
      // 发送完成后，调度下一次
      scheduleKeepAlive(portPath, config, intervalMs);
    }, Math.max(delayMs, 0));
  }
}

// 停止保号定时任务
function stopKeepAliveTask(portPath) {
  if (keepAliveTimers[portPath]) {
    console.log(`${portPath} 停止保号定时器`);
    clearTimeout(keepAliveTimers[portPath]);
    delete keepAliveTimers[portPath];
  }
}

// 停止所有保号定时任务
function stopAllKeepAliveTasks() {
  console.log('停止所有保号定时器...');
  const timerCount = Object.keys(keepAliveTimers).length;
  
  for (const portPath in keepAliveTimers) {
    if (keepAliveTimers[portPath]) {
      try {
        clearTimeout(keepAliveTimers[portPath]);
        console.log(`${portPath} 定时器已停止`);
      } catch (error) {
        console.error(`${portPath} 停止定时器失败:`, error.message);
      }
      delete keepAliveTimers[portPath];
    }
  }
  
  console.log(`已停止 ${timerCount} 个保号定时器`);
}

// 发送保号短信
async function sendKeepAliveSMS(portPath, config) {
  // 再次检查配置是否启用（防止配置更改后定时器未停止）
  const currentConfig = getKeepAliveConfig()[portPath];
  if (!currentConfig || !currentConfig.enabled) {
    console.log(`${portPath} 保号功能已禁用，停止定时器`);
    stopKeepAliveTask(portPath);
    return;
  }
  
  // 检查串口是否连接
  const serial = serialConnections[portPath];
  if (!serial || !serial.isOpen) {
    console.log(`${portPath} 串口未连接，跳过本次保号短信发送`);
    // 不发送短信，但不停止定时器，等待下次触发时再检查
    return;
  }
  
  // 检查模块状态
  const moduleState = moduleStates[portPath];
  if (!moduleState || !moduleState.simDetected) {
    console.log(`${portPath} SIM卡未检测到，跳过本次保号短信发送`);
    return;
  }
  
  console.log(`${portPath} 发送保号短信到: ${config.targetPhone}`);
  
  const result = await sendMessage(portPath, config.targetPhone, config.message);
  
  if (result.success) {
    console.log(`${portPath} 保号短信发送成功`);
    
    // 更新最后发送时间
    const allConfig = getKeepAliveConfig();
    allConfig[portPath] = {
      ...currentConfig,
      lastSentTime: Date.now()
    };
    saveKeepAliveConfig(allConfig);
    
    // 广播更新
    broadcastUpdate();
  } else {
    console.error(`${portPath} 保号短信发送失败:`, result.error);
  }
}

// 初始化所有保号任务
function initializeKeepAliveTasks() {
  console.log('初始化保号任务...');
  
  // 先停止所有现有定时器
  stopAllKeepAliveTasks();
  
  const config = getKeepAliveConfig();
  
  for (const [portPath, portConfig] of Object.entries(config)) {
    console.log(`${portPath} 保号配置: enabled=${portConfig.enabled}, intervalDays=${portConfig.intervalDays}`);
    if (portConfig.enabled) {
      startKeepAliveTask(portPath, portConfig);
    } else {
      console.log(`${portPath} 保号功能未启用，跳过`);
    }
  }
  
  console.log(`保号任务初始化完成，活跃定时器数量: ${Object.keys(keepAliveTimers).length}`);
}

// 获取保号配置API
app.get('/api/keep-alive/:port', requireAuth, (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  const config = getKeepAliveConfig();
  
  res.json({
    success: true,
    config: config[portPath] || {
      enabled: false,
      targetPhone: '',
      intervalDays: 30,
      message: '',
      lastSentTime: null
    }
  });
});

// 保存保号配置API
app.post('/api/keep-alive/:port', requireAuth, (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  const { enabled, targetPhone, intervalDays, message } = req.body;
  
  console.log(`${portPath} 收到保号配置保存请求: enabled=${enabled}, intervalDays=${intervalDays}`);
  
  try {
    const allConfig = getKeepAliveConfig();
    
    // 保留上次发送时间
    const oldConfig = allConfig[portPath] || {};
    
    allConfig[portPath] = {
      enabled: enabled || false,
      targetPhone: targetPhone || '',
      intervalDays: parseInt(intervalDays) || 30,
      message: message || '',
      lastSentTime: oldConfig.lastSentTime || null
    };
    
    const success = saveKeepAliveConfig(allConfig);
    
    if (success) {
      // 如果禁用，停止定时器；如果启用，重新启动保号任务
      if (!enabled) {
        console.log(`${portPath} 保号功能已禁用，停止定时器`);
        stopKeepAliveTask(portPath);
      } else {
        console.log(`${portPath} 保号功能已启用，重新启动定时器`);
        startKeepAliveTask(portPath, allConfig[portPath]);
      }
      
      // 广播更新
      broadcastUpdate();
      
      res.json({ success: true });
    } else {
      res.json({ success: false, error: '保存失败' });
    }
  } catch (error) {
    console.error('保存保号配置失败:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 手动触发保号短信API
app.post('/api/keep-alive/:port/send', requireAuth, async (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  const config = getKeepAliveConfig();
  const portConfig = config[portPath];
  
  if (!portConfig || !portConfig.targetPhone || !portConfig.message) {
    return res.json({ success: false, error: '保号配置不完整' });
  }
  
  try {
    await sendKeepAliveSMS(portPath, portConfig);
    res.json({ success: true });
  } catch (error) {
    console.error('手动发送保号短信失败:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 查看保号定时器状态API（调试用）
app.get('/api/keep-alive-timers', requireAuth, (req, res) => {
  const timers = {};
  const config = getKeepAliveConfig();
  
  // 遍历所有端口
  for (const portPath of ports) {
    const portConfig = config[portPath];
    const hasTimer = !!keepAliveTimers[portPath];
    const hasLock = !!keepAliveTimerLocks[portPath];
    
    timers[portPath] = {
      hasTimer: hasTimer,
      timerId: hasTimer ? keepAliveTimers[portPath] : null,
      hasLock: hasLock,
      config: {
        enabled: portConfig?.enabled || false,
        intervalDays: portConfig?.intervalDays || 0,
        targetPhone: portConfig?.targetPhone || '',
        lastSentTime: portConfig?.lastSentTime ? new Date(portConfig.lastSentTime).toLocaleString('zh-CN') : '从未发送',
        lastSentTimestamp: portConfig?.lastSentTime || null
      }
    };
    
    // 计算下次发送时间
    if (hasTimer && portConfig?.lastSentTime && portConfig?.intervalDays) {
      const nextSendTime = portConfig.lastSentTime + (portConfig.intervalDays * 24 * 60 * 60 * 1000);
      const remainingMs = nextSendTime - Date.now();
      const remainingHours = Math.round(remainingMs / 1000 / 60 / 60);
      
      timers[portPath].nextSend = {
        time: new Date(nextSendTime).toLocaleString('zh-CN'),
        remainingHours: remainingHours,
        remainingDays: Math.round(remainingHours / 24)
      };
    }
  }
  
  res.json({ 
    success: true, 
    timers,
    totalTimers: Object.keys(keepAliveTimers).length,
    totalLocks: Object.keys(keepAliveTimerLocks).length
  });
});

// 紧急停止所有保号定时器API
app.post('/api/keep-alive-stop-all', requireAuth, (req, res) => {
  try {
    stopAllKeepAliveTasks();
    res.json({ success: true, message: '所有保号定时器已停止' });
  } catch (error) {
    console.error('停止保号定时器失败:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 重连模块API
app.post('/api/reconnect/:port', requireAuth, async (req, res) => {
  const portPath = `/dev/${req.params.port}`;
  
  if (!moduleStates[portPath]) {
    return res.json({ success: false, error: '模块不存在' });
  }
  
  console.log(`手动重连 ${portPath}`);
  
  try {
    // 关闭现有连接
    const serial = serialConnections[portPath];
    if (serial && serial.isOpen) {
      serial.close();
      delete serialConnections[portPath];
    }
    
    // 重置模块状态
    moduleStates[portPath] = {
      port: portPath,
      status: 'reconnecting',
      iccid: '',
      imei: '',
      moduleDetected: false,
      simDetected: false,
      unreadCount: 0,
      messages: [],
      pendingMessages: [],
      readingMessage: false,
      commandHistory: [],
      operatorInfo: {
        mode: null,
        format: null,
        oper: null,
        act: null
      },
      signalQuality: {
        rssi: null,
        ber: null
      },
      forwardSettings: moduleStates[portPath].forwardSettings || {
        httpEnabled: false,
        httpUrl: '',
        httpMethod: 'GET',
        smsEnabled: false,
        smsTarget: ''
      },
      multipartMessages: {}
    };
    
    // 广播更新
    broadcastUpdate();
    
    // 延迟2秒后重新启动监听
    setTimeout(() => {
      startPortListener(portPath);
    }, 2000);
    
    res.json({ success: true, message: '正在重连...' });
  } catch (error) {
    console.error(`重连 ${portPath} 失败:`, error.message);
    res.json({ success: false, error: error.message });
  }
});

// 启动HTTP服务器
const server = app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  // 初始化模块监听
  initializeModuleListeners();
  // 初始化保号任务
  setTimeout(() => {
    initializeKeepAliveTasks();
  }, 5000); // 等待5秒让模块初始化完成
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
