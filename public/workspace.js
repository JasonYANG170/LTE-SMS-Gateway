let gatewayView = 'all';
let gatewayHasData = false;
const viewTitles = { all: window.GatewayI18n.t('网关概览'), unread: window.GatewayI18n.t('未读短信'), issues: window.GatewayI18n.t('异常模块') };
const issueStatuses = new Set(['no_sim', 'module_error', 'error', 'timeout', 'unknown', 'reconnecting']);

function updateGatewayConnection(state) {
  const labels = { connecting: window.GatewayI18n.t('正在连接网关…'), connected: window.GatewayI18n.t('实时连接已建立'), disconnected: window.GatewayI18n.t('连接已断开，正在重试…') };
  document.documentElement.dataset.connection = state;
  document.getElementById('connectionText').textContent = labels[state];
  document.getElementById('sidebarConnection').textContent = state === 'connected' ? window.GatewayI18n.t('网关已连接') : state === 'disconnected' ? window.GatewayI18n.t('等待重连') : window.GatewayI18n.t('正在连接');
  if (!gatewayHasData) document.querySelector('#emptyState h3').textContent = state === 'disconnected' ? window.GatewayI18n.t('暂时无法连接网关') : window.GatewayI18n.t('正在等待网关数据');
}

function updateGatewayOverview(modules) {
  gatewayHasData = true;
  document.getElementById('totalModules').textContent = modules.length;
  document.getElementById('onlineModules').textContent = modules.filter(m => m.status === 'ok').length;
  document.getElementById('storedMessages').textContent = modules.reduce((n,m) => n + (m.messages?.length || 0) + (Number(m.diskMessageCount) || 0), 0);
  window.MailWorkspace?.onModules(modules);
}

const themeSelect = document.getElementById('themeSelect');
themeSelect.value = window.getGatewayTheme();
themeSelect.addEventListener('change', () => window.setGatewayTheme(themeSelect.value));

// Keep existing dynamically generated dialogs accessible without changing their actions.
new MutationObserver(records => {
  records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType !== 1 || !node.matches('.modal')) return;
    const previousFocus = document.activeElement;
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-label', node.querySelector('h2')?.textContent || window.GatewayI18n.t('网关操作'));
    node.querySelector('.close-button')?.setAttribute('aria-label', window.GatewayI18n.t('关闭弹窗'));
    node.querySelector('input, button, select, textarea')?.focus();
    node.addEventListener('keydown', event => {
      if (event.key === 'Escape') { node.remove(); previousFocus?.focus(); }
      if (event.key !== 'Tab') return;
      const controls = [...node.querySelectorAll('button, input, select, textarea, a[href]')].filter(control => !control.disabled && control.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    new MutationObserver((_, observer) => {
      if (!node.isConnected) { observer.disconnect(); previousFocus?.focus(); }
    }).observe(document.body, { childList: true });
  }));
}).observe(document.body, { childList: true });
