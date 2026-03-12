// WebSocket连接
let ws;
let reconnectInterval;
let heartbeatInterval;

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);
  
  ws.onopen = () => {
    clearInterval(reconnectInterval);
    
    // 启动心跳
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('ping');
      }
    }, 30000); // 每30秒发送一次心跳
  };
  
  ws.onmessage = (event) => {
    if (event.data === 'pong') {
      return;
    }
    
    try {
      const modules = JSON.parse(event.data);
      updateModules(modules);
      updateLastUpdateTime();
    } catch (error) {
      // 解析失败
    }
  };
  
  ws.onclose = () => {
    clearInterval(heartbeatInterval);
    reconnectInterval = setInterval(() => {
      connect();
    }, 3000);
  };
  
  ws.onerror = (error) => {
    // WebSocket错误
  };
}

function updateModules(modules) {
  const grid = document.getElementById('modulesGrid');
  grid.innerHTML = '';
  
  // 保存模块数据到全局变量
  window.modulesData = modules;
  
  modules.forEach((module, index) => {
    const card = createModuleCard(module, index + 1);
    grid.appendChild(card);
  });
}

function createModuleCard(module, index) {
  const card = document.createElement('div');
  card.className = 'module-card';
  
  const statusText = {
    'ok': '正常',
    'no_sim': '无SIM卡',
    'module_ok': '模块正常',
    'module_error': '模块错误',
    'error': '错误',
    'timeout': '超时',
    'waiting': '等待中',
    'initializing': '初始化中',
    'reconnecting': '重连中',
    'unknown': '未知'
  };
  
  card.innerHTML = `
    <div class="module-header">
      <div class="module-title">LTE模块 ${index}</div>
      <div class="status-badge status-${module.status}">
        ${statusText[module.status] || module.status}
        ${module.unreadCount > 0 ? ` <span style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 10px; font-size: 0.85em; margin-left: 4px;">${module.unreadCount}条新消息</span>` : ''}
      </div>
    </div>
    
    <div class="module-info">
      <!-- 基本信息 -->
      <div class="info-row">
        <div class="info-label">串口:</div>
        <div class="info-value">${module.port}</div>
      </div>
      
      <!-- 运营商和信号强度 -->
      ${module.operatorInfo && module.operatorInfo.oper ? `
        <div class="network-card">
          <div class="network-card-row">
            <span class="network-label">📡 运营商:</span>
            <span class="network-value">${escapeHtml(parseOperatorCode(module.operatorInfo.oper, module.operatorInfo.format))}</span>
          </div>
          <div class="network-card-row">
            <span class="network-label">🌐 网络:</span>
            <span class="network-value">
              ${getOperatorMode(module.operatorInfo.mode)}
              ${module.operatorInfo.act !== null ? ` · ${getNetworkType(module.operatorInfo.act)}` : ''}
            </span>
          </div>
          ${module.signalQuality && module.signalQuality.rssi !== null ? `
            <div class="network-card-row">
              <span class="network-label">📶 信号:</span>
              <span class="network-value ${getSignalClass(module.signalQuality.rssi)}">
                ${getSignalBars(module.signalQuality.rssi)} ${getSignalDbm(module.signalQuality.rssi)} (${getSignalText(module.signalQuality.rssi)})
              </span>
            </div>
          ` : ''}
        </div>
      ` : ''}
      
      <!-- 保号倒计时卡片 -->
      ${module.keepAlive && module.keepAlive.enabled ? `
        <div class="keep-alive-card">
          <div class="keep-alive-header">
            <span class="keep-alive-icon">📞</span>
            <span class="keep-alive-title">保号倒计时</span>
          </div>
          ${getKeepAliveCountdown(module.keepAlive)}
        </div>
      ` : ''}
      <!-- SIM卡信息折叠区域 -->
      ${(module.imei || module.iccid) ? `
        <div class="sim-info-section">
          <button class="toggle-sim-info" onclick="toggleSimInfo(this)">
            <span class="toggle-icon">▶</span>
            <span class="toggle-text">显示SIM卡信息</span>
          </button>
          <div class="sim-info-content" style="display: none;">
            ${module.imei ? `
              <div class="info-row">
                <div class="info-label">IMEI:</div>
                <div class="info-value" style="font-family: 'Courier New', monospace;">${module.imei}</div>
              </div>
            ` : ''}
            ${module.iccid ? `
              <div class="info-row">
                <div class="info-label">ICCID:</div>
                <div class="info-value" style="font-family: 'Courier New', monospace; font-size: 0.85em;">${module.iccid}</div>
              </div>
            ` : ''}
          </div>
        </div>
      ` : ''}
      <!-- 状态检测 -->
      <div class="status-section">
        <div class="status-item">
          <span class="status-icon ${module.moduleDetected ? 'icon-success' : 'icon-error'}">
            ${module.moduleDetected ? '✓' : '✗'}
          </span>
          <span>模块识别</span>
        </div>
        <div class="status-item">
          <span class="status-icon ${module.simDetected ? 'icon-success' : 'icon-error'}">
            ${module.simDetected ? '✓' : '✗'}
          </span>
          <span>SIM卡识别</span>
        </div>
      </div>
      
      <!-- 短信统计 -->
      ${module.simDetected ? `
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-value">${module.messages?.length || 0}</div>
            <div class="stat-label">总短信数</div>
          </div>
          <div class="stat-item">
            <div class="stat-value" style="color: #ef4444;">${module.unreadCount || 0}</div>
            <div class="stat-label">未读短信</div>
          </div>
        </div>
        
        <!-- 存储容量信息 -->
        ${module.storageInfo && module.storageInfo.total > 0 ? `
          <div style="background: ${module.storageInfo.percentage >= 90 ? '#fee2e2' : module.storageInfo.percentage >= 80 ? '#fef3c7' : '#f0fdf4'}; padding: 12px; border-radius: 8px; margin-top: 12px; border: 2px solid ${module.storageInfo.percentage >= 90 ? '#fca5a5' : module.storageInfo.percentage >= 80 ? '#fde047' : '#86efac'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 0.9em; color: ${module.storageInfo.percentage >= 90 ? '#991b1b' : module.storageInfo.percentage >= 80 ? '#92400e' : '#166534'}; font-weight: 600;">
                💾 存储容量
              </span>
              <span style="font-size: 0.85em; color: ${module.storageInfo.percentage >= 90 ? '#991b1b' : module.storageInfo.percentage >= 80 ? '#92400e' : '#166534'};">
                ${module.storageInfo.used}/${module.storageInfo.total} (${module.storageInfo.percentage}%)
              </span>
            </div>
            <div style="background: white; height: 8px; border-radius: 4px; overflow: hidden;">
              <div style="background: ${module.storageInfo.percentage >= 90 ? '#ef4444' : module.storageInfo.percentage >= 80 ? '#f59e0b' : '#10b981'}; height: 100%; width: ${module.storageInfo.percentage}%; transition: width 0.3s ease;"></div>
            </div>
            ${module.storageInfo.percentage >= 80 ? `
              <div style="margin-top: 8px; font-size: 0.85em; color: ${module.storageInfo.percentage >= 90 ? '#991b1b' : '#92400e'};">
                ${module.storageInfo.percentage >= 90 ? '⚠️ 存储空间严重不足，请及时清理' : '⚠️ 存储空间不足，建议清理'}
              </div>
            ` : ''}
          </div>
        ` : ''}
      ` : ''}
      
      <!-- 操作按钮 -->
      <div class="action-buttons">
        ${module.simDetected ? `
          <button class="action-button action-primary" onclick="showInbox('${module.port}', '${index}')">
            <span class="button-icon">📥</span>
            <span class="button-text">收件箱</span>
            ${module.unreadCount > 0 ? `<span class="button-badge">${module.unreadCount}</span>` : ''}
          </button>
          <button class="action-button action-primary" onclick="showCompose('${module.port}')">
            <span class="button-icon">📤</span>
            <span class="button-text">发件箱</span>
          </button>
          <button class="action-button action-secondary" onclick="showLogs('${module.port}', '${index}')">
            <span class="button-icon">📋</span>
            <span class="button-text">日志</span>
          </button>
          <button class="action-button action-secondary" onclick="showSettings('${module.port}', '${index}')">
            <span class="button-icon">⚙️</span>
            <span class="button-text">设置</span>
          </button>
        ` : ''}
        <button class="action-button action-warning" onclick="reconnectModule('${module.port}')" title="重新连接模块">
          <span class="button-icon">🔄</span>
          <span class="button-text">重连</span>
        </button>
      </div>
    </div>
  `;
  
  return card;
}

// 显示日志
function showLogs(port, moduleIndex) {
  const module = window.modulesData ? window.modulesData[moduleIndex - 1] : null;
  const commandHistory = module && Array.isArray(module.commandHistory) ? module.commandHistory : [];
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>📋 命令日志 - ${port}</h2>
        <button class="close-button" onclick="this.closest('.modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        ${commandHistory.length > 0 ? `
          <div style="margin-bottom: 16px;">
            <button class="send-button" onclick="clearCommandLogs('${port}')" style="background: #ef4444;">🗑️ 清空日志</button>
          </div>
          <div style="background: #1e293b; padding: 16px; border-radius: 8px; max-height: 500px; overflow-y: auto; font-family: 'Courier New', monospace;">
            ${commandHistory.map((cmd, idx) => {
              let color = '#94a3b8';
              let icon = '•';
              let bgColor = 'transparent';
              
              if (cmd.type === 'send') {
                color = '#60a5fa';
                icon = '→';
                bgColor = 'rgba(96, 165, 250, 0.1)';
              } else if (cmd.type === 'receive') {
                color = '#34d399';
                icon = '←';
                bgColor = 'rgba(52, 211, 153, 0.1)';
              } else if (cmd.type === 'error') {
                color = '#f87171';
                icon = '✗';
                bgColor = 'rgba(248, 113, 113, 0.1)';
              } else if (cmd.type === 'sms_sent') {
                color = '#a78bfa';
                icon = '📤';
                bgColor = 'rgba(167, 139, 250, 0.1)';
              } else if (cmd.type === 'sms_error') {
                color = '#fb923c';
                icon = '❌';
                bgColor = 'rgba(251, 146, 60, 0.1)';
              }
              
              return `
                <div style="display: flex; gap: 12px; padding: 8px; margin-bottom: 4px; background: ${bgColor}; border-radius: 4px; align-items: flex-start;">
                  <span style="color: #64748b; font-size: 0.85em; min-width: 80px; flex-shrink: 0;">${escapeHtml(cmd.timestamp)}</span>
                  <span style="color: ${color}; font-weight: bold; font-size: 1.1em; min-width: 20px; flex-shrink: 0;">${icon}</span>
                  <code style="color: ${color}; flex: 1; word-break: break-all; background: transparent; border: none; padding: 0;">${escapeHtml(cmd.data)}</code>
                </div>
              `;
            }).join('')}
          </div>
          <div style="margin-top: 12px; text-align: center; color: #666; font-size: 0.9em;">
            共 ${commandHistory.length} 条记录
          </div>
        ` : '<p style="text-align: center; color: #666;">暂无日志记录</p>'}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// 显示收件箱
async function showInbox(port, moduleIndex) {
  // 创建模态框
  const modal = document.createElement('div');
  modal.className = 'modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>📥 收件箱 - ${port}</h2>
        <button class="close-button" onclick="this.closest('.modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div style="text-align: center; padding: 20px; color: #10b981;">
          正在加载消息...
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // 清除未读数
  clearUnreadCount(port);
  
  try {
    // 从服务器获取最新消息
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/messages/${portName}`);
    const result = await response.json();
    
    if (!result.success) {
      modal.querySelector('.modal-body').innerHTML = `
        <p style="text-align: center; color: #ef4444;">加载失败: ${result.error}</p>
      `;
      return;
    }
    
    let messageList = result.messages || [];
    
    // 按接收时间倒序排列（最新的在前）
    messageList = messageList.slice().sort((a, b) => {
      return new Date(b.received) - new Date(a.received);
    });
    
    // 更新模态框内容
    modal.querySelector('.modal-body').innerHTML = `
      ${messageList.length > 0 ? `
        <div style="display: flex; gap: 12px; margin-bottom: 16px;">
          <button class="send-button" onclick="clearInbox('${port}')" style="background: #ef4444;">🗑️ 清空收件箱</button>
        </div>
        <div class="message-list">
          ${messageList.map((msg, idx) => `
            <div class="message-item">
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <strong style="color: #10b981;">📞 ${escapeHtml(msg.phone || '未知号码')}</strong>
                <span style="color: #666; font-size: 0.9em;">${escapeHtml(msg.time || msg.timestamp)}</span>
              </div>
              ${msg.content ? `
                <div style="background: white; padding: 12px; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 8px;">
                  <div style="color: #333; line-height: 1.6; word-break: break-word; white-space: pre-wrap;">${escapeHtml(msg.content)}</div>
                  ${msg.isMultipart ? '<div style="margin-top: 8px; color: #10b981; font-size: 0.85em;">📨 长短信</div>' : ''}
                </div>
              ` : '<div style="color: #999; font-style: italic;">无内容</div>'}
              <details style="margin-top: 8px;">
                <summary style="cursor: pointer; color: #666; font-size: 0.9em;">查看原始PDU</summary>
                <code style="display: block; margin-top: 8px; word-break: break-all; font-size: 0.85em;">${escapeHtml(msg.pdu || '')}</code>
              </details>
            </div>
          `).join('')}
        </div>
        <div style="margin-top: 12px; text-align: center; color: #666; font-size: 0.9em;">
          共 ${messageList.length} 条消息
        </div>
      ` : '<p style="text-align: center; color: #666;">暂无短信</p>'}
    `;
  } catch (error) {
    modal.querySelector('.modal-body').innerHTML = `
      <p style="text-align: center; color: #ef4444;">加载失败: ${error.message}</p>
    `;
  }
}

// 显示发件箱
function showCompose(port) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>📤 发送短信 - ${port}</h2>
        <button class="close-button" onclick="this.closest('.modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>目标手机号:</label>
          <div style="display: flex; gap: 8px;">
            <select id="phoneCountryCode" style="width: 100px; padding: 10px 8px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em; flex-shrink: 0;">
              <option value="+86">+86 🇨🇳</option>
              <option value="+852">+852 🇭🇰</option>
              <option value="+853">+853 🇲🇴</option>
              <option value="+886">+886 🇹🇼</option>
              <option value="+1">+1 🇺🇸</option>
              <option value="+44">+44 🇬🇧</option>
              <option value="+81">+81 🇯🇵</option>
              <option value="+82">+82 🇰🇷</option>
              <option value="+65">+65 🇸🇬</option>
              <option value="+60">+60 🇲🇾</option>
              <option value="+61">+61 🇦🇺</option>
              <option value="+49">+49 🇩🇪</option>
              <option value="+33">+33 🇫🇷</option>
              <option value="+7">+7 🇷🇺</option>
              <option value="+91">+91 🇮🇳</option>
              <option value="+66">+66 🇹🇭</option>
              <option value="+84">+84 🇻🇳</option>
              <option value="+63">+63 🇵🇭</option>
              <option value="+62">+62 🇮🇩</option>
            </select>
            <input type="text" id="phoneInput" placeholder="例如: 13800138000" style="flex: 1;" />
          </div>
        </div>
        <div class="form-group">
          <label>短信内容:</label>
          <textarea id="messageInput" rows="5" placeholder="输入短信内容..."></textarea>
        </div>
        <button class="send-button" onclick="sendSMS('${port}')">发送</button>
        <div id="sendStatus"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// 发送短信
async function sendSMS(port) {
  const countryCode = document.getElementById('phoneCountryCode').value;
  const phoneRaw = document.getElementById('phoneInput').value.trim();
  const message = document.getElementById('messageInput').value;
  const status = document.getElementById('sendStatus');
  
  if (!phoneRaw || !message) {
    status.innerHTML = '<p style="color: #ef4444;">请填写手机号和短信内容</p>';
    return;
  }
  
  // 拼接区号和手机号
  const phone = countryCode + phoneRaw;
  
  status.innerHTML = '<p style="color: #10b981;">发送中...</p>';
  
  try {
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ port, phone, message })
    });
    
    const result = await response.json();
    
    if (result.success) {
      status.innerHTML = '<p style="color: #10b981;">✓ 发送成功！</p>';
      setTimeout(() => {
        document.querySelector('.modal').remove();
      }, 2000);
    } else {
      status.innerHTML = `<p style="color: #ef4444;">✗ 发送失败: ${result.error}</p>`;
    }
  } catch (error) {
    status.innerHTML = `<p style="color: #ef4444;">✗ 发送失败: ${error.message}</p>`;
  }
}

// 刷新短信
async function refreshMessages(port) {
  try {
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/refresh/${portName}`);
    const result = await response.json();
  } catch (error) {
    // 刷新失败
  }
}

// 清除未读数
async function clearUnreadCount(port) {
  try {
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/clear-unread/${portName}`, {
      method: 'POST'
    });
    const result = await response.json();
  } catch (error) {
    // 清除未读数失败
  }
}

// 显示设置界面
async function showSettings(port, moduleIndex) {
  const module = window.modulesData ? window.modulesData[moduleIndex - 1] : null;
  const settings = module?.forwardSettings || {
    httpEnabled: false,
    httpUrl: '',
    httpMethod: 'GET',
    smsEnabled: false,
    smsTarget: '',
    storageWarningEnabled: false,
    storageWarningThreshold: 80
  };
  
  // 拆分已保存的手机号区号
  const smsPhone = splitPhoneNumber(settings.smsTarget);
  
  // 获取保号配置
  let keepAliveConfig = {
    enabled: false,
    targetPhone: '',
    intervalDays: 30,
    message: '',
    lastSentTime: null
  };
  
  try {
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/keep-alive/${portName}`);
    const result = await response.json();
    if (result.success) {
      keepAliveConfig = result.config;
    }
  } catch (error) {
    console.error('获取保号配置失败:', error);
  }
  
  // 拆分保号手机号区号
  const keepAlivePhone = splitPhoneNumber(keepAliveConfig.targetPhone);
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>⚙️ 模块设置 - ${port}</h2>
        <button class="close-button" onclick="this.closest('.modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <!-- HTTP转发设置 -->
        <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <input type="checkbox" id="httpEnabled" ${settings.httpEnabled ? 'checked' : ''} style="width: 18px; height: 18px; margin-right: 8px;">
            <label for="httpEnabled" style="font-weight: 600; font-size: 1.1em;">🌐 HTTP转发</label>
          </div>
          
          <div class="form-group">
            <label>请求方式:</label>
            <select id="httpMethod" style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em;">
              <option value="GET" ${settings.httpMethod === 'GET' ? 'selected' : ''}>GET</option>
              <option value="POST" ${settings.httpMethod === 'POST' ? 'selected' : ''}>POST</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>URL地址 (使用 {sms} 代替短信内容):</label>
            <input type="text" id="httpUrl" value="${escapeHtml(settings.httpUrl)}" 
              placeholder="例如: http://example.com/api?message={sms}" 
              style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em;" />
          </div>
          
          <div style="margin-bottom: 12px;">
            <button class="send-button" onclick="testHttpForward('${port}')" style="background: #3b82f6; width: 100%;">
              🧪 测试 HTTP 转发
            </button>
            <div id="httpTestResult" style="margin-top: 8px;"></div>
          </div>
          
          <div style="background: #eff6ff; padding: 10px; border-radius: 6px; font-size: 0.9em; color: #1e40af;">
            <strong>说明:</strong><br>
            • GET模式: 直接请求URL，{sms} 会被替换为短信内容<br>
            • POST模式: token 参数保留在 URL 中，其他参数转换为 POST body 发送<br>
            • 测试按钮: 发送测试消息 "测试短信内容" 到配置的 URL
          </div>
        </div>
        
        <!-- SMS转发设置 -->
        <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <input type="checkbox" id="smsEnabled" ${settings.smsEnabled ? 'checked' : ''} style="width: 18px; height: 18px; margin-right: 8px;">
            <label for="smsEnabled" style="font-weight: 600; font-size: 1.1em;">📱 SMS转发</label>
          </div>
          
          <div class="form-group">
            <label>目标手机号:</label>
            <div style="display: flex; gap: 8px;">
              <select id="smsCountryCode" style="width: 100px; padding: 10px 8px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em; flex-shrink: 0;">
                <option value="+86" ${smsPhone.code === '+86' ? 'selected' : ''}>+86 🇨🇳</option>
                <option value="+852" ${smsPhone.code === '+852' ? 'selected' : ''}>+852 🇭🇰</option>
                <option value="+853" ${smsPhone.code === '+853' ? 'selected' : ''}>+853 🇲🇴</option>
                <option value="+886" ${smsPhone.code === '+886' ? 'selected' : ''}>+886 🇹🇼</option>
                <option value="+1" ${smsPhone.code === '+1' ? 'selected' : ''}>+1 🇺🇸</option>
                <option value="+44" ${smsPhone.code === '+44' ? 'selected' : ''}>+44 🇬🇧</option>
                <option value="+81" ${smsPhone.code === '+81' ? 'selected' : ''}>+81 🇯🇵</option>
                <option value="+82" ${smsPhone.code === '+82' ? 'selected' : ''}>+82 🇰🇷</option>
                <option value="+65" ${smsPhone.code === '+65' ? 'selected' : ''}>+65 🇸🇬</option>
                <option value="+60" ${smsPhone.code === '+60' ? 'selected' : ''}>+60 🇲🇾</option>
                <option value="+61" ${smsPhone.code === '+61' ? 'selected' : ''}>+61 🇦🇺</option>
                <option value="+49" ${smsPhone.code === '+49' ? 'selected' : ''}>+49 🇩🇪</option>
                <option value="+33" ${smsPhone.code === '+33' ? 'selected' : ''}>+33 🇫🇷</option>
                <option value="+7" ${smsPhone.code === '+7' ? 'selected' : ''}>+7 🇷🇺</option>
                <option value="+91" ${smsPhone.code === '+91' ? 'selected' : ''}>+91 🇮🇳</option>
                <option value="+66" ${smsPhone.code === '+66' ? 'selected' : ''}>+66 🇹🇭</option>
                <option value="+84" ${smsPhone.code === '+84' ? 'selected' : ''}>+84 🇻🇳</option>
                <option value="+63" ${smsPhone.code === '+63' ? 'selected' : ''}>+63 🇵🇭</option>
                <option value="+62" ${smsPhone.code === '+62' ? 'selected' : ''}>+62 🇮🇩</option>
              </select>
              <input type="text" id="smsTarget" value="${escapeHtml(smsPhone.number)}" 
                placeholder="例如: 13800138000" 
                style="flex: 1; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em;" />
            </div>
          </div>
          
          <div style="background: #fef3c7; padding: 10px; border-radius: 6px; font-size: 0.9em; color: #92400e;">
            <strong>提示:</strong> 收到的短信会自动转发到指定手机号
          </div>
        </div>
        
        <!-- 存储警告设置 -->
        <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 2px solid #fde047;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <input type="checkbox" id="storageWarningEnabled" ${settings.storageWarningEnabled ? 'checked' : ''} style="width: 18px; height: 18px; margin-right: 8px;">
            <label for="storageWarningEnabled" style="font-weight: 600; font-size: 1.1em;">⚠️ 存储容量警告</label>
          </div>
          
          <div class="form-group">
            <label>警告阈值 (%):</label>
            <input type="number" id="storageWarningThreshold" value="${settings.storageWarningThreshold || 80}" 
              min="50" max="95" step="5"
              placeholder="例如: 80" 
              style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em;" />
          </div>
          
          <div style="background: #fffbeb; padding: 10px; border-radius: 6px; font-size: 0.9em; color: #92400e;">
            <strong>说明:</strong><br>
            • 当存储使用率达到设定阈值时，自动发送警告通知<br>
            • 通知将通过上面配置的 HTTP 或 SMS 转发功能发送<br>
            • 建议设置为 80% 或更高，避免频繁通知<br>
            • 需要先启用 HTTP 转发或 SMS 转发功能
          </div>
          
          <div style="margin-top: 12px;">
            <button class="send-button" onclick="testStorageWarning('${port}')" style="background: #f59e0b; width: 100%;">
              🧪 测试存储警告通知
            </button>
            <div id="storageWarningTestResult" style="margin-top: 8px;"></div>
          </div>
        </div>
        
        <!-- 保号设置 -->
        <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 2px solid #86efac;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <input type="checkbox" id="keepAliveEnabled" ${keepAliveConfig.enabled ? 'checked' : ''} style="width: 18px; height: 18px; margin-right: 8px;">
            <label for="keepAliveEnabled" style="font-weight: 600; font-size: 1.1em;">📞 保号功能</label>
          </div>
          
          <div class="form-group">
            <label>目标手机号:</label>
            <div style="display: flex; gap: 8px;">
              <select id="keepAliveCountryCode" style="width: 100px; padding: 10px 8px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em; flex-shrink: 0;">
                <option value="+86" ${keepAlivePhone.code === '+86' ? 'selected' : ''}>+86 🇨🇳</option>
                <option value="+852" ${keepAlivePhone.code === '+852' ? 'selected' : ''}>+852 🇭🇰</option>
                <option value="+853" ${keepAlivePhone.code === '+853' ? 'selected' : ''}>+853 🇲🇴</option>
                <option value="+886" ${keepAlivePhone.code === '+886' ? 'selected' : ''}>+886 🇹🇼</option>
                <option value="+1" ${keepAlivePhone.code === '+1' ? 'selected' : ''}>+1 🇺🇸</option>
                <option value="+44" ${keepAlivePhone.code === '+44' ? 'selected' : ''}>+44 🇬🇧</option>
                <option value="+81" ${keepAlivePhone.code === '+81' ? 'selected' : ''}>+81 🇯🇵</option>
                <option value="+82" ${keepAlivePhone.code === '+82' ? 'selected' : ''}>+82 🇰🇷</option>
                <option value="+65" ${keepAlivePhone.code === '+65' ? 'selected' : ''}>+65 🇸🇬</option>
                <option value="+60" ${keepAlivePhone.code === '+60' ? 'selected' : ''}>+60 🇲🇾</option>
                <option value="+61" ${keepAlivePhone.code === '+61' ? 'selected' : ''}>+61 🇦🇺</option>
                <option value="+49" ${keepAlivePhone.code === '+49' ? 'selected' : ''}>+49 🇩🇪</option>
                <option value="+33" ${keepAlivePhone.code === '+33' ? 'selected' : ''}>+33 🇫🇷</option>
                <option value="+7" ${keepAlivePhone.code === '+7' ? 'selected' : ''}>+7 🇷🇺</option>
                <option value="+91" ${keepAlivePhone.code === '+91' ? 'selected' : ''}>+91 🇮🇳</option>
                <option value="+66" ${keepAlivePhone.code === '+66' ? 'selected' : ''}>+66 🇹🇭</option>
                <option value="+84" ${keepAlivePhone.code === '+84' ? 'selected' : ''}>+84 🇻🇳</option>
                <option value="+63" ${keepAlivePhone.code === '+63' ? 'selected' : ''}>+63 🇵🇭</option>
                <option value="+62" ${keepAlivePhone.code === '+62' ? 'selected' : ''}>+62 🇮🇩</option>
              </select>
              <input type="text" id="keepAlivePhone" value="${escapeHtml(keepAlivePhone.number)}" 
                placeholder="例如: 13800138000" 
                style="flex: 1; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em;" />
            </div>
          </div>
          
          <div class="form-group">
            <label>间隔天数:</label>
            <input type="number" id="keepAliveInterval" value="${keepAliveConfig.intervalDays}" 
              min="1" max="365"
              placeholder="例如: 30" 
              style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em;" />
          </div>
          
          <div class="form-group">
            <label>短信内容:</label>
            <textarea id="keepAliveMessage" rows="3" 
              placeholder="输入保号短信内容..." 
              style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em; resize: vertical;">${escapeHtml(keepAliveConfig.message)}</textarea>
          </div>
          
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button class="send-button" onclick="testKeepAlive('${port}')" style="background: #10b981; flex: 1;">
              🧪 测试发送
            </button>
          </div>
          
          <div style="background: #dbeafe; padding: 10px; border-radius: 6px; font-size: 0.9em; color: #1e40af;">
            <strong>说明:</strong><br>
            • 保号功能会按设定的间隔天数自动发送短信<br>
            • 首次启用后，将在设定的间隔天数后发送第一条短信<br>
            • 用于保持号码活跃状态，防止因长期不使用而被运营商回收<br>
            • 建议间隔设置为30天，短信内容可以是简单的问候语
          </div>
        </div>
        
        <div style="display: flex; gap: 12px;">
          <button class="send-button" onclick="saveSettings('${port}', ${moduleIndex})" style="flex: 1;">
            💾 保存设置
          </button>
          <button class="send-button" onclick="refreshMessages('${port}')" style="flex: 1; background: #6b7280;">
            🔄 刷新短信
          </button>
        </div>
        
        <div id="settingsStatus" style="margin-top: 12px;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// 保存设置
async function saveSettings(port, moduleIndex) {
  const status = document.getElementById('settingsStatus');
  
  const smsCountryCode = document.getElementById('smsCountryCode').value;
  const smsPhoneRaw = document.getElementById('smsTarget').value.trim();
  
  const settings = {
    httpEnabled: document.getElementById('httpEnabled').checked,
    httpUrl: document.getElementById('httpUrl').value,
    httpMethod: document.getElementById('httpMethod').value,
    smsEnabled: document.getElementById('smsEnabled').checked,
    smsTarget: smsPhoneRaw ? smsCountryCode + smsPhoneRaw : '',
    storageWarningEnabled: document.getElementById('storageWarningEnabled').checked,
    storageWarningThreshold: parseInt(document.getElementById('storageWarningThreshold').value) || 80
  };
  
  const keepAliveCountryCode = document.getElementById('keepAliveCountryCode').value;
  const keepAlivePhoneRaw = document.getElementById('keepAlivePhone').value.trim();
  
  const keepAliveSettings = {
    enabled: document.getElementById('keepAliveEnabled').checked,
    targetPhone: keepAlivePhoneRaw ? keepAliveCountryCode + keepAlivePhoneRaw : '',
    intervalDays: parseInt(document.getElementById('keepAliveInterval').value) || 30,
    message: document.getElementById('keepAliveMessage').value
  };
  
  status.innerHTML = '<p style="color: #10b981;">保存中...</p>';
  
  try {
    // 保存转发设置
    const response1 = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ port, settings })
    });
    
    const result1 = await response1.json();
    
    // 保存保号设置
    const portName = port.replace('/dev/', '');
    const response2 = await fetch(`/api/keep-alive/${portName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(keepAliveSettings)
    });
    
    const result2 = await response2.json();
    
    if (result1.success && result2.success) {
      status.innerHTML = '<p style="color: #10b981;">✓ 保存成功！</p>';
      setTimeout(() => {
        document.querySelector('.modal').remove();
      }, 1500);
    } else {
      const errors = [];
      if (!result1.success) errors.push(`转发设置: ${result1.error}`);
      if (!result2.success) errors.push(`保号设置: ${result2.error}`);
      status.innerHTML = `<p style="color: #ef4444;">✗ 保存失败: ${errors.join(', ')}</p>`;
    }
  } catch (error) {
    status.innerHTML = `<p style="color: #ef4444;">✗ 保存失败: ${error.message}</p>`;
  }
}

// 测试保号短信
async function testKeepAlive(port) {
  const countryCode = document.getElementById('keepAliveCountryCode').value;
  const phoneRaw = document.getElementById('keepAlivePhone').value.trim();
  const message = document.getElementById('keepAliveMessage').value;
  
  if (!phoneRaw || !message) {
    alert('⚠️ 请先填写目标手机号和短信内容');
    return;
  }
  
  const targetPhone = countryCode + phoneRaw;
  
  if (!confirm(`确定要发送测试短信到 ${targetPhone} 吗？\n\n内容: ${message}`)) {
    return;
  }
  
  try {
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/keep-alive/${portName}/send`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (result.success) {
      alert('✓ 测试短信发送成功！');
    } else {
      alert(`✗ 测试短信发送失败: ${result.error}`);
    }
  } catch (error) {
    alert(`✗ 测试短信发送失败: ${error.message}`);
  }
}

// 测试存储警告通知
async function testStorageWarning(port) {
  const resultDiv = document.getElementById('storageWarningTestResult');
  
  const storageWarningEnabled = document.getElementById('storageWarningEnabled').checked;
  const httpEnabled = document.getElementById('httpEnabled').checked;
  const smsEnabled = document.getElementById('smsEnabled').checked;
  
  if (!storageWarningEnabled) {
    resultDiv.innerHTML = '<p style="color: #f59e0b;">⚠️ 请先启用存储容量警告功能</p>';
    return;
  }
  
  if (!httpEnabled && !smsEnabled) {
    resultDiv.innerHTML = '<p style="color: #f59e0b;">⚠️ 请先启用 HTTP 转发或 SMS 转发功能</p>';
    return;
  }
  
  resultDiv.innerHTML = '<p style="color: #10b981;">🧪 发送测试通知中...</p>';
  
  try {
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/test-storage-warning/${portName}`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (result.success) {
      let details = [];
      if (result.httpSent) details.push('HTTP转发成功');
      if (result.smsSent) details.push('SMS转发成功');
      
      resultDiv.innerHTML = `
        <div style="background: #d1fae5; padding: 10px; border-radius: 6px; border-left: 4px solid #10b981;">
          <p style="color: #065f46; margin: 0; font-weight: 600;">✓ 测试通知发送成功</p>
          <p style="color: #065f46; margin: 4px 0 0 0; font-size: 0.85em;">
            ${details.join(' · ')}
          </p>
        </div>
      `;
    } else {
      resultDiv.innerHTML = `
        <div style="background: #fee2e2; padding: 10px; border-radius: 6px; border-left: 4px solid #ef4444;">
          <p style="color: #991b1b; margin: 0; font-weight: 600;">✗ 测试失败</p>
          <p style="color: #991b1b; margin: 4px 0 0 0; font-size: 0.85em;">
            ${result.error || '未知错误'}
          </p>
        </div>
      `;
    }
  } catch (error) {
    resultDiv.innerHTML = `
      <div style="background: #fee2e2; padding: 10px; border-radius: 6px; border-left: 4px solid #ef4444;">
        <p style="color: #991b1b; margin: 0; font-weight: 600;">✗ 测试失败</p>
        <p style="color: #991b1b; margin: 4px 0 0 0; font-size: 0.85em;">
          ${error.message}
        </p>
      </div>
    `;
  }
}

// 测试 HTTP 转发
async function testHttpForward(port) {
  const httpUrl = document.getElementById('httpUrl').value;
  const httpMethod = document.getElementById('httpMethod').value;
  const resultDiv = document.getElementById('httpTestResult');
  
  if (!httpUrl) {
    resultDiv.innerHTML = '<p style="color: #f59e0b;">⚠️ 请先输入 URL 地址</p>';
    return;
  }
  
  resultDiv.innerHTML = '<p style="color: #10b981;">🧪 测试中...</p>';
  
  try {
    // 通过服务器端代理发送请求，避免 CORS 问题
    const response = await fetch('/api/test-http-forward', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: httpUrl,
        method: httpMethod
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      resultDiv.innerHTML = `
        <div style="background: #d1fae5; padding: 10px; border-radius: 6px; border-left: 4px solid #10b981;">
          <p style="color: #065f46; margin: 0; font-weight: 600;">✓ 测试成功</p>
          <p style="color: #065f46; margin: 4px 0 0 0; font-size: 0.85em;">
            状态码: ${result.status} ${result.statusText}<br>
            响应时间: ${result.duration}ms<br>
            请求方式: ${result.method}<br>
            测试消息: ${result.testMessage}
          </p>
          ${result.responseText ? `
            <details style="margin-top: 8px;">
              <summary style="cursor: pointer; color: #065f46; font-size: 0.85em;">查看响应内容</summary>
              <pre style="margin-top: 4px; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 0.75em; overflow-x: auto; color: #065f46;">${escapeHtml(result.responseText)}</pre>
            </details>
          ` : ''}
        </div>
      `;
    } else {
      const errorMsg = result.error || '请求失败';
      resultDiv.innerHTML = `
        <div style="background: #fee2e2; padding: 10px; border-radius: 6px; border-left: 4px solid #ef4444;">
          <p style="color: #991b1b; margin: 0; font-weight: 600;">✗ 测试失败</p>
          <p style="color: #991b1b; margin: 4px 0 0 0; font-size: 0.85em;">
            ${result.status ? `状态码: ${result.status} ${result.statusText}<br>响应时间: ${result.duration}ms<br>` : ''}
            错误: ${errorMsg}<br>
            ${errorMsg === 'fetch failed' || errorMsg.includes('ENOTFOUND') ? '提示: 请检查 URL 是否正确，服务器是否可访问' : ''}
            ${errorMsg.includes('ECONNREFUSED') ? '提示: 服务器拒绝连接，请检查服务是否运行' : ''}
          </p>
          ${result.responseText ? `
            <details style="margin-top: 8px;">
              <summary style="cursor: pointer; color: #991b1b; font-size: 0.85em;">查看响应内容</summary>
              <pre style="margin-top: 4px; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 0.75em; overflow-x: auto; color: #991b1b;">${escapeHtml(result.responseText)}</pre>
            </details>
          ` : ''}
        </div>
      `;
    }
  } catch (error) {
    resultDiv.innerHTML = `
      <div style="background: #fee2e2; padding: 10px; border-radius: 6px; border-left: 4px solid #ef4444;">
        <p style="color: #991b1b; margin: 0; font-weight: 600;">✗ 测试失败</p>
        <p style="color: #991b1b; margin: 4px 0 0 0; font-size: 0.85em;">
          错误: ${error.message}<br>
          请检查网络连接或联系管理员
        </p>
      </div>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 从带区号的手机号中拆分区号和号码
function splitPhoneNumber(fullPhone) {
  if (!fullPhone) return { code: '+86', number: '' };
  
  const knownCodes = ['+886', '+852', '+853', '+86', '+82', '+81', '+66', '+65', '+63', '+62', '+61', '+60', '+91', '+84', '+49', '+44', '+33', '+1', '+7'];
  
  for (const code of knownCodes) {
    if (fullPhone.startsWith(code)) {
      return { code: code, number: fullPhone.substring(code.length) };
    }
  }
  
  return { code: '+86', number: fullPhone };
}

// 切换SIM卡信息显示/隐藏
function toggleSimInfo(button) {
  const content = button.nextElementSibling;
  const icon = button.querySelector('.toggle-icon');
  const text = button.querySelector('.toggle-text');
  
  if (content.style.display === 'none') {
    // 展开
    content.style.display = 'block';
    icon.textContent = '▼';
    text.textContent = '隐藏SIM卡信息';
    button.classList.add('active');
  } else {
    // 收起
    content.style.display = 'none';
    icon.textContent = '▶';
    text.textContent = '显示SIM卡信息';
    button.classList.remove('active');
  }
}

// 获取运营商模式文本
function getOperatorMode(mode) {
  const modes = {
    0: '自动',
    1: '手动',
    2: '退网',
    3: '仅格式',
    4: '手动/自动'
  };
  return modes[mode] || '未知';
}

// 解析运营商编码 (MCC+MNC)
function parseOperatorCode(oper, format) {
  // format=2 表示数字型，格式为 MCC(3位) + MNC(2或3位)
  if (format === 2 && oper && oper.match(/^\d{5,6}$/)) {
    const mcc = oper.substring(0, 3);
    const mnc = oper.substring(3);
    
    // 中国运营商映射
    const operatorMap = {
      '46000': '中国移动',
      '46002': '中国移动',
      '46004': '中国移动',
      '46007': '中国移动',
      '46008': '中国移动',
      '46001': '中国联通',
      '46006': '中国联通',
      '46009': '中国联通',
      '46003': '中国电信',
      '46005': '中国电信',
      '46011': '中国电信',
      '46020': '中国铁通'
    };
    
    const operatorName = operatorMap[oper] || '未知运营商';
    return `${operatorName} (${mcc}-${mnc})`;
  }
  
  // format=0 或 1 表示字母数字型，直接返回
  return oper;
}

// 获取网络类型文本
function getNetworkType(act) {
  const types = {
    0: 'GSM',
    1: 'GSM Compact',
    2: 'UTRAN',
    3: 'GSM w/EGPRS',
    4: 'UTRAN w/HSDPA',
    5: 'UTRAN w/HSUPA',
    6: 'UTRAN w/HSDPA+HSUPA',
    7: 'E-UTRAN',
    8: 'UTRAN HSPA+'
  };
  return types[act] || '未知';
}

// 计算信号强度 dBm
// 公式: dBm = rssi * 2 - 113
function getSignalDbm(rssi) {
  if (rssi === 99) return '未知';
  if (rssi === 0) return '≤-115 dBm';
  if (rssi === 1) return '-111 dBm';
  if (rssi === 31) return '≥-51 dBm';
  
  const dbm = rssi * 2 - 113;
  return `${dbm} dBm`;
}

// 获取信号强度文本
function getSignalText(rssi) {
  if (rssi === 99) return '未知';
  if (rssi === 0) return '很弱';
  if (rssi >= 20) return '优秀';
  if (rssi >= 15) return '良好';
  if (rssi >= 10) return '一般';
  if (rssi >= 5) return '较弱';
  return '很弱';
}

// 获取信号强度图标
function getSignalBars(rssi) {
  if (rssi === 99) return '■';
  if (rssi === 0) return '□';
  if (rssi >= 20) return '■■■■';
  if (rssi >= 15) return '■■■□';
  if (rssi >= 10) return '■■□□';
  if (rssi >= 5) return '■□□□';
  return '□';
}

// 获取信号强度样式类
function getSignalClass(rssi) {
  if (rssi === 99 || rssi === 0) return 'signal-unknown';
  if (rssi >= 15) return 'signal-good';
  if (rssi >= 10) return 'signal-fair';
  return 'signal-poor';
}

// 计算保号倒计时
function getKeepAliveCountdown(keepAlive) {
  if (!keepAlive.lastSentTime) {
    return `
      <div class="keep-alive-content">
        <div class="keep-alive-status waiting">
          <div class="keep-alive-days">配置中</div>
          <div class="keep-alive-hint">保号功能已启用，正在初始化</div>
        </div>
      </div>
    `;
  }
  
  const now = Date.now();
  const lastSent = keepAlive.lastSentTime;
  const intervalMs = keepAlive.intervalDays * 24 * 60 * 60 * 1000;
  const nextSendTime = lastSent + intervalMs;
  const remainingMs = nextSendTime - now;
  
  if (remainingMs <= 0) {
    return `
      <div class="keep-alive-content">
        <div class="keep-alive-status sending">
          <div class="keep-alive-days">准备发送</div>
          <div class="keep-alive-hint">即将发送保号短信</div>
        </div>
      </div>
    `;
  }
  
  const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const remainingHours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  
  let statusClass = 'normal';
  if (remainingDays <= 3) {
    statusClass = 'warning';
  } else if (remainingDays <= 7) {
    statusClass = 'attention';
  }
  
  // 计算进度百分比（已过时间 / 总时间）
  const elapsedMs = now - lastSent;
  const progressPercent = Math.max(0, Math.min(100, (elapsedMs / intervalMs) * 100));
  
  return `
    <div class="keep-alive-content">
      <div class="keep-alive-status ${statusClass}">
        <div class="keep-alive-days">
          <span class="days-number">${remainingDays}</span>
          <span class="days-unit">天</span>
          ${remainingHours > 0 ? `<span class="hours-number">${remainingHours}</span><span class="hours-unit">小时</span>` : ''}
        </div>
        <div class="keep-alive-hint">距离下次发送</div>
      </div>
      <div class="keep-alive-progress">
        <div class="keep-alive-progress-bar" style="width: ${progressPercent}%"></div>
      </div>
      <div class="keep-alive-info">
        <div class="keep-alive-info-item">
          <span class="info-label">间隔周期:</span>
          <span class="info-value">${keepAlive.intervalDays} 天</span>
        </div>
        <div class="keep-alive-info-item">
          <span class="info-label">下次发送:</span>
          <span class="info-value">${new Date(nextSendTime).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>
    </div>
  `;
}

function updateLastUpdateTime() {
  const now = new Date();
  const timeString = now.toLocaleTimeString('zh-CN');
  document.getElementById('lastUpdate').textContent = `最后更新: ${timeString}`;
}

// 显示系统设置
async function showSystemSettings() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  
  // 获取通知配置
  let notificationConfig = { enabled: false, url: '', method: 'POST' };
  try {
    const response = await fetch('/api/notification-config');
    const result = await response.json();
    if (result.success) {
      notificationConfig = result.config;
    }
  } catch (error) {
    // 使用默认配置
  }
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 700px;">
      <div class="modal-header">
        <h2>⚙️ 系统设置</h2>
        <button class="close-button" onclick="this.closest('.modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <!-- 标签页 -->
        <div class="settings-tabs">
          <button class="settings-tab active" onclick="switchSettingsTab(event, 'credentials')">登录凭据</button>
          <button class="settings-tab" onclick="switchSettingsTab(event, 'notification')">登录通知</button>
          <button class="settings-tab" onclick="switchSettingsTab(event, 'logs')">登录日志</button>
        </div>
        
        <!-- 登录凭据设置 -->
        <div id="credentials-tab" class="settings-tab-content active">
          <h3 style="margin-bottom: 16px; color: #374151;">修改登录凭据</h3>
          
          <div class="form-group">
            <label>新用户名:</label>
            <input type="text" id="newUsername" placeholder="输入新用户名" />
          </div>
          
          <div class="form-group">
            <label>新密码:</label>
            <input type="password" id="newPassword" placeholder="输入新密码" />
          </div>
          
          <div class="form-group">
            <label>确认密码:</label>
            <input type="password" id="confirmPassword" placeholder="再次输入新密码" />
          </div>
          
          <button class="send-button" onclick="updateCredentials()">保存修改</button>
          <div id="settingsStatus" style="margin-top: 12px;"></div>
        </div>
        
        <!-- 登录通知设置 -->
        <div id="notification-tab" class="settings-tab-content">
          <h3 style="margin-bottom: 16px; color: #374151;">登录失败通知</h3>
          
          <div class="form-group">
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="notificationEnabled" ${notificationConfig.enabled ? 'checked' : ''} style="width: auto;">
              <span>启用登录失败通知</span>
            </label>
          </div>
          
          <div class="form-group">
            <label>请求方式:</label>
            <select id="notificationMethod" style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.95em;">
              <option value="GET" ${notificationConfig.method === 'GET' ? 'selected' : ''}>GET</option>
              <option value="POST" ${notificationConfig.method === 'POST' ? 'selected' : ''}>POST</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>通知URL (使用 {login} 代替登录信息):</label>
            <input type="text" id="notificationUrl" value="${notificationConfig.url}" 
              placeholder="例如: http://example.com/api?message={login}" />
          </div>
          
          <div style="background: #eff6ff; padding: 12px; border-radius: 6px; font-size: 0.9em; color: #1e40af; margin-bottom: 16px;">
            <strong>说明:</strong><br>
            • {login} 会被替换为: "登录失败 - IP: xxx, 用户名: xxx, 错误: xxx, 时间: xxx"<br>
            • GET模式: 直接请求URL<br>
            • POST模式: token 参数保留在 URL 中，其他参数以 JSON 格式发送到 body
          </div>
          
          <div style="margin-bottom: 12px;">
            <button class="send-button" onclick="testLoginNotification()" style="background: #3b82f6; width: 100%;">
              🧪 测试登录通知
            </button>
            <div id="notificationTestResult" style="margin-top: 8px;"></div>
          </div>
          
          <button class="send-button" onclick="updateNotificationConfig()">保存通知设置</button>
          <div id="notificationStatus" style="margin-top: 12px;"></div>
        </div>
        
        <!-- 登录日志 -->
        <div id="logs-tab" class="settings-tab-content">
          <h3 style="margin-bottom: 16px; color: #374151;">登录日志</h3>
          <div style="display: flex; gap: 12px; margin-bottom: 16px;">
            <button class="send-button" onclick="loadLoginLogs()" style="flex: 1; background: #6b7280;">🔄 刷新日志</button>
            <button class="send-button" onclick="clearLoginLogs()" style="flex: 1; background: #ef4444;">🗑️ 清空日志</button>
          </div>
          <div id="loginLogs" style="background: #1e293b; padding: 16px; border-radius: 8px; max-height: 400px; overflow-y: auto; font-family: 'Courier New', monospace; color: #e2e8f0; font-size: 0.85em;">
            点击"刷新日志"加载...
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// 更新登录凭据
async function updateCredentials() {
  const newUsername = document.getElementById('newUsername').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const status = document.getElementById('settingsStatus');
  
  if (!newUsername && !newPassword) {
    status.innerHTML = '<p style="color: #f59e0b;">请至少填写一项需要修改的内容</p>';
    return;
  }
  
  if (newPassword && newPassword !== confirmPassword) {
    status.innerHTML = '<p style="color: #ef4444;">两次输入的密码不一致</p>';
    return;
  }
  
  status.innerHTML = '<p style="color: #10b981;">保存中...</p>';
  
  try {
    const response = await fetch('/api/update-credentials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        username: newUsername || undefined,
        password: newPassword || undefined
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      status.innerHTML = '<p style="color: #10b981;">✓ 保存成功！请使用新凭据重新登录</p>';
      setTimeout(() => {
        document.querySelector('.modal').remove();
        handleLogout();
      }, 2000);
    } else {
      status.innerHTML = `<p style="color: #ef4444;">✗ 保存失败: ${result.error}</p>`;
    }
  } catch (error) {
    status.innerHTML = `<p style="color: #ef4444;">✗ 保存失败: ${error.message}</p>`;
  }
}

// 切换设置标签页
function switchSettingsTab(event, tabName) {
  // 移除所有活动状态
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.settings-tab-content').forEach(content => {
    content.classList.remove('active');
  });
  
  // 激活当前标签
  event.target.classList.add('active');
  document.getElementById(`${tabName}-tab`).classList.add('active');
  
  // 如果切换到日志标签，自动加载日志
  if (tabName === 'logs') {
    loadLoginLogs();
  }
}

// 更新通知配置
async function updateNotificationConfig() {
  const enabled = document.getElementById('notificationEnabled').checked;
  const url = document.getElementById('notificationUrl').value;
  const method = document.getElementById('notificationMethod').value;
  const status = document.getElementById('notificationStatus');
  
  status.innerHTML = '<p style="color: #10b981;">保存中...</p>';
  
  try {
    const response = await fetch('/api/notification-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ enabled, url, method })
    });
    
    const result = await response.json();
    
    if (result.success) {
      status.innerHTML = '<p style="color: #10b981;">✓ 保存成功！</p>';
      setTimeout(() => {
        status.innerHTML = '';
      }, 3000);
    } else {
      status.innerHTML = `<p style="color: #ef4444;">✗ 保存失败: ${result.error}</p>`;
    }
  } catch (error) {
    status.innerHTML = `<p style="color: #ef4444;">✗ 保存失败: ${error.message}</p>`;
  }
}

// 测试登录通知
async function testLoginNotification() {
  const url = document.getElementById('notificationUrl').value;
  const method = document.getElementById('notificationMethod').value;
  const resultDiv = document.getElementById('notificationTestResult');
  
  if (!url) {
    resultDiv.innerHTML = '<p style="color: #f59e0b;">⚠️ 请先输入通知 URL</p>';
    return;
  }
  
  resultDiv.innerHTML = '<p style="color: #10b981;">🧪 测试中...</p>';
  
  try {
    // 通过服务器端代理发送请求
    const response = await fetch('/api/test-login-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: url,
        method: method
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      resultDiv.innerHTML = `
        <div style="background: #d1fae5; padding: 10px; border-radius: 6px; border-left: 4px solid #10b981;">
          <p style="color: #065f46; margin: 0; font-weight: 600;">✓ 测试成功</p>
          <p style="color: #065f46; margin: 4px 0 0 0; font-size: 0.85em;">
            状态码: ${result.status} ${result.statusText}<br>
            响应时间: ${result.duration}ms<br>
            请求方式: ${result.method}<br>
            测试消息: ${result.testMessage}
          </p>
          ${result.responseText ? `
            <details style="margin-top: 8px;">
              <summary style="cursor: pointer; color: #065f46; font-size: 0.85em;">查看响应内容</summary>
              <pre style="margin-top: 4px; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 0.75em; overflow-x: auto; color: #065f46;">${escapeHtml(result.responseText)}</pre>
            </details>
          ` : ''}
        </div>
      `;
    } else {
      const errorMsg = result.error || '请求失败';
      resultDiv.innerHTML = `
        <div style="background: #fee2e2; padding: 10px; border-radius: 6px; border-left: 4px solid #ef4444;">
          <p style="color: #991b1b; margin: 0; font-weight: 600;">✗ 测试失败</p>
          <p style="color: #991b1b; margin: 4px 0 0 0; font-size: 0.85em;">
            ${result.status ? `状态码: ${result.status} ${result.statusText}<br>响应时间: ${result.duration}ms<br>` : ''}
            错误: ${errorMsg}<br>
            ${errorMsg === 'fetch failed' || errorMsg.includes('ENOTFOUND') ? '提示: 请检查 URL 是否正确，服务器是否可访问' : ''}
            ${errorMsg.includes('ECONNREFUSED') ? '提示: 服务器拒绝连接，请检查服务是否运行' : ''}
          </p>
          ${result.responseText ? `
            <details style="margin-top: 8px;">
              <summary style="cursor: pointer; color: #991b1b; font-size: 0.85em;">查看响应内容</summary>
              <pre style="margin-top: 4px; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 0.75em; overflow-x: auto; color: #991b1b;">${escapeHtml(result.responseText)}</pre>
            </details>
          ` : ''}
        </div>
      `;
    }
  } catch (error) {
    resultDiv.innerHTML = `
      <div style="background: #fee2e2; padding: 10px; border-radius: 6px; border-left: 4px solid #ef4444;">
        <p style="color: #991b1b; margin: 0; font-weight: 600;">✗ 测试失败</p>
        <p style="color: #991b1b; margin: 4px 0 0 0; font-size: 0.85em;">
          错误: ${error.message}<br>
          请检查网络连接或联系管理员
        </p>
      </div>
    `;
  }
}

// 加载登录日志
async function loadLoginLogs() {
  const logsDiv = document.getElementById('loginLogs');
  logsDiv.innerHTML = '<p style="color: #10b981;">加载中...</p>';
  
  try {
    const response = await fetch('/api/login-logs');
    const result = await response.json();
    
    if (result.success && result.logs.length > 0) {
      logsDiv.innerHTML = result.logs.map(log => {
        const isSuccess = log.includes('SUCCESS');
        const color = isSuccess ? '#10b981' : '#ef4444';
        const icon = isSuccess ? '✓' : '✗';
        return `<div style="margin-bottom: 8px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 3px solid ${color};">
          <span style="color: ${color}; margin-right: 8px;">${icon}</span>${escapeHtml(log)}
        </div>`;
      }).join('');
    } else {
      logsDiv.innerHTML = '<p style="color: #94a3b8;">暂无登录日志</p>';
    }
  } catch (error) {
    logsDiv.innerHTML = `<p style="color: #ef4444;">加载失败: ${error.message}</p>`;
  }
}

// 清空登录日志
async function clearLoginLogs() {
  if (!confirm('确定要清空所有登录日志吗？此操作不可恢复！')) {
    return;
  }
  
  const logsDiv = document.getElementById('loginLogs');
  logsDiv.innerHTML = '<p style="color: #10b981;">清空中...</p>';
  
  try {
    const response = await fetch('/api/clear-login-logs', {
      method: 'POST'
    });
    const result = await response.json();
    
    if (result.success) {
      logsDiv.innerHTML = '<p style="color: #10b981;">✓ 日志已清空</p>';
      setTimeout(() => {
        loadLoginLogs();
      }, 1000);
    } else {
      logsDiv.innerHTML = `<p style="color: #ef4444;">✗ 清空失败: ${result.error}</p>`;
    }
  } catch (error) {
    logsDiv.innerHTML = `<p style="color: #ef4444;">✗ 清空失败: ${error.message}</p>`;
  }
}

// 清空收件箱
async function clearInbox(port) {
  if (!confirm('确定要清空该模块的所有短信吗？\n\n⚠️ 此操作将从 SIM 卡中永久删除所有短信（包括未读），不可恢复！')) {
    return;
  }
  
  try {
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/clear-messages/${portName}`, {
      method: 'POST'
    });
    const result = await response.json();
    
    if (result.success) {
      // 关闭模态框并重新打开以刷新
      document.querySelector('.modal').remove();
      alert('✓ 收件箱已清空\n所有短信已从 SIM 卡中删除');
    } else {
      alert(`✗ 清空失败: ${result.error}`);
    }
  } catch (error) {
    alert(`✗ 清空失败: ${error.message}`);
  }
}

// 清空命令日志
async function clearCommandLogs(port) {
  if (!confirm('确定要清空该模块的命令日志吗？此操作不可恢复！')) {
    return;
  }
  
  try {
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/clear-command-logs/${portName}`, {
      method: 'POST'
    });
    const result = await response.json();
    
    if (result.success) {
      // 关闭模态框并重新打开以刷新
      document.querySelector('.modal').remove();
      alert('✓ 命令日志已清空');
    } else {
      alert(`✗ 清空失败: ${result.error}`);
    }
  } catch (error) {
    alert(`✗ 清空失败: ${error.message}`);
  }
}

// 退出登录
async function handleLogout() {
  try {
    await fetch('/api/logout', {
      method: 'POST'
    });
  } catch (error) {
    // 忽略错误
  }
  
  // 跳转到登录页
  window.location.href = '/login.html';
}

// 重连模块
async function reconnectModule(port) {
  if (!confirm(`确定要重新连接 ${port} 吗？\n\n这将关闭当前连接并重新初始化模块。`)) {
    return;
  }
  
  try {
    const portName = port.replace('/dev/', '');
    const response = await fetch(`/api/reconnect/${portName}`, {
      method: 'POST'
    });
    const result = await response.json();
    
    if (result.success) {
      alert(`✓ ${port} 正在重新连接...\n\n请稍等片刻，模块将自动重新初始化。`);
    } else {
      alert(`✗ 重连失败: ${result.error}`);
    }
  } catch (error) {
    alert(`✗ 重连失败: ${error.message}`);
  }
}

// 启动连接
connect();
