const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

function getBrowserPath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find(p => fs.existsSync(p));
}

let activeBrowserSession = null;

async function launchAutoLogin(onTokenFound, onLog) {
  if (activeBrowserSession) {
    if (onLog) onLog('warning', 'Đang có một cửa sổ đăng nhập đang mở sẵn rồi!');
    return false;
  }

  const executablePath = getBrowserPath();
  if (!executablePath) {
    if (onLog) onLog('error', 'Không tìm thấy trình duyệt Chrome hoặc Edge trên máy tính!');
    return false;
  }

  if (onLog) onLog('info', '🌐 Đang mở trình duyệt để bạn đăng nhập tài khoản Bách Khoa...');

  try {
    const browser = await puppeteer.launch({
      executablePath,
      headless: false,
      defaultViewport: null,
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });

    activeBrowserSession = browser;

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    await page.goto('https://ctsv.hust.edu.vn/dat-ve', { waitUntil: 'domcontentloaded' });

    if (onLog) onLog('info', '👉 Hãy đăng nhập Office 365 trên cửa sổ vừa mở. Hệ thống sẽ tự bắt Token ngay khi bạn vào!');

    let checkInterval = setInterval(async () => {
      try {
        if (!browser.isConnected()) {
          clearInterval(checkInterval);
          activeBrowserSession = null;
          return;
        }

        const cookies = await page.cookies();
        const tokenBKNexus = cookies.find(c => c.name === 'TokenBKNexus')?.value;
        const userName = cookies.find(c => c.name === 'UserName')?.value;

        // Also check localStorage
        const idtoken = await page.evaluate(() => localStorage.getItem('adal.idtoken')).catch(() => null);

        if (tokenBKNexus && userName) {
          clearInterval(checkInterval);
          if (onLog) onLog('success', `🎉 TỰ ĐỘNG BẮT ĐƯỢC TOKEN! MSSV: ${userName}`);

          if (onTokenFound) {
            onTokenFound({
              token: tokenBKNexus,
              userName,
              accessToken: idtoken || ''
            });
          }

          // Keep browser open for a few seconds to let user see success, then close
          setTimeout(async () => {
            try {
              await browser.close();
            } catch (e) {}
            activeBrowserSession = null;
          }, 3000);
        }
      } catch (err) {
        // Ignored during page navigation
      }
    }, 1500);

    browser.on('disconnected', () => {
      clearInterval(checkInterval);
      activeBrowserSession = null;
      if (onLog) onLog('info', 'Cửa sổ đăng nhập đã được đóng.');
    });

    return true;
  } catch (err) {
    if (onLog) onLog('error', 'Lỗi khi mở trình duyệt: ' + err.message);
    activeBrowserSession = null;
    return false;
  }
}

module.exports = {
  launchAutoLogin
};
