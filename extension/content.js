// iCTSV Auto Sync Token Content Script
(function() {
  function getCookie(name) {
    const v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
    return v ? v[2] : null;
  }

  let lastSyncedToken = null;

  function syncToken() {
    const token = getCookie('TokenBKNexus') || localStorage.getItem('TokenBKNexus');
    const user = getCookie('UserName') || localStorage.getItem('UserName');
    const idtoken = localStorage.getItem('adal.idtoken');

    if (token && user && token !== lastSyncedToken) {
      lastSyncedToken = token;
      
      const payload = JSON.stringify({ Token: token, UserName: user, idtoken: idtoken || null });
      const endpoints = [
        'http://localhost:3000/api/auth/save-token',
        'https://ictsv-sniper.onrender.com/api/auth/save-token'
      ];

      endpoints.forEach(url => {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        }).then(r => r.json()).then(data => {
          console.log(`[iCTSV Auto Sync] Đã đồng bộ sang ${url}!`, data);
          showBanner(`✅ Đã tự động đồng bộ Token (MSSV: ${user}) sang App Sniper!`);
        }).catch(err => {
          // Endpoint might be offline or sleeping
        });
      });
    }
  }

  function showBanner(msg) {
    if (document.getElementById('ictsv-sync-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'ictsv-sync-banner';
    banner.style.position = 'fixed';
    banner.style.bottom = '20px';
    banner.style.right = '20px';
    banner.style.backgroundColor = '#10b981';
    banner.style.color = '#fff';
    banner.style.padding = '12px 20px';
    banner.style.borderRadius = '8px';
    banner.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
    banner.style.zIndex = '999999';
    banner.style.fontSize = '14px';
    banner.style.fontWeight = 'bold';
    banner.innerText = msg;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
  }

  // Run on load and periodically in case user logs in
  syncToken();
  setInterval(syncToken, 5000);
})();
