// Resolve the saved preference before paint, including restricted storage contexts.
(() => {
  let preference = 'system';
  try { preference = localStorage.getItem('lte-gateway-theme') || 'system'; } catch (_) {}
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  window.setGatewayTheme = (value) => {
    preference = ['light', 'dark', 'system'].includes(value) ? value : 'system';
    document.documentElement.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    try { localStorage.setItem('lte-gateway-theme', preference); } catch (_) {}
  };
  window.getGatewayTheme = () => preference;
  media.addEventListener('change', () => window.setGatewayTheme(preference));
  window.setGatewayTheme(preference);
})();
