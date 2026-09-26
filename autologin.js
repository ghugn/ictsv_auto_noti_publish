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

async function launchAutoLogin(credentials = {}, onTokenFound, onLog) {
  if (activeBrowserSession) {
    if (onLog) onLog('warning', 'Đang có một cửa sổ đăng nhập đang mở sẵn rồi!');
    return false;
  }

  const executablePath = getBrowserPath();
  if (!executablePath) {
    if (onLog) onLog('error', 'Không tìm thấy trình duyệt Chrome hoặc Edge trên máy tính!');
    return false;
  }

  // Persistent user profile directory so cookies/sessions are preserved
  const profileDir = path.join(__dirname, 'browser_profile');
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const isHeadless = credentials.headless === true ? 'new' : false;
  if (onLog) onLog('info', '🚀 Đang khởi động trình duyệt đăng nhập Bách Khoa...');

  try {
    const browser = await puppeteer.launch({
      executablePath,
      userDataDir: profileDir,
      headless: isHeadless,
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox'
      ]
    });

    activeBrowserSession = browser;

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    // Helper: Extract tokens from current page
    async function checkToken() {
      try {
        const cookies = await page.cookies();
        const tokenBKNexus = cookies.find(c => c.name === 'TokenBKNexus')?.value;
        const userName = cookies.find(c => c.name === 'UserName')?.value;
        const idtoken = await page.evaluate(() => localStorage.getItem('adal.idtoken')).catch(() => null);

        if (tokenBKNexus && userName) {
          return {
            token: tokenBKNexus,
            userName,
            accessToken: idtoken || ''
          };
        }
      } catch (e) {}
      return null;
    }

    if (onLog) onLog('info', '🌐 Đang kết nối tới cổng ctsv.hust.edu.vn/dat-ve...');
    await page.goto('https://ctsv.hust.edu.vn/dat-ve', { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Check if existing profile is already logged in
    let tokenData = await checkToken();
    if (tokenData) {
      if (onLog) onLog('success', `🎉 PHIÊN ĐÃ LƯU HỢP LỆ! Tự động nhận Token MSSV: ${tokenData.userName}`);
      if (onTokenFound) onTokenFound(tokenData);
      setTimeout(async () => {
        try { await browser.close(); } catch (e) {}
        activeBrowserSession = null;
      }, 1500);
      return true;
    }

    // If not logged in, try clicking the 'Đăng nhập Office 365' button
    if (onLog) onLog('info', '👉 Đang tự động click [Đăng nhập Office 365]...');
    try {
      await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('button, a')).some(b => 
          b.innerText.includes('Đăng nhập Office 365') || b.innerText.trim() === 'Đăng nhập'
        );
      }, { timeout: 8000 });

      await page.evaluate(() => {
        const btn365 = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Đăng nhập Office 365'));
        if (btn365) {
          btn365.click();
          return;
        }
        const btnLogin = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.trim() === 'Đăng nhập');
        if (btnLogin) btnLogin.click();
      });
    } catch (e) {
      // Button not found or already navigating
    }

    let attempts = 0;
    const maxAttempts = 60; // 60 * 1.5s = 90s
    let autoFilled = false;

    let checkInterval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts || !browser.isConnected()) {
        clearInterval(checkInterval);
        try { await browser.close(); } catch (e) {}
        activeBrowserSession = null;
        if (onLog && attempts > maxAttempts) onLog('warning', 'Hết thời gian chờ đăng nhập (90 giây).');
        return;
      }

      try {
        const currentUrl = page.url();

        // 1. Check if we received tokens
        tokenData = await checkToken();
        if (tokenData) {
          clearInterval(checkInterval);
          if (onLog) onLog('success', `🎉 ĐĂNG NHẬP THÀNH CÔNG! Đã lấy Token MSSV: ${tokenData.userName}`);

          if (onTokenFound) {
            onTokenFound(tokenData);
          }

          setTimeout(async () => {
            try { await browser.close(); } catch (e) {}
            activeBrowserSession = null;
          }, 2000);
          return;
        }

        // 2. If on ADFS login page (asso.hust.edu.vn)
        if (currentUrl.includes('asso.hust.edu.vn')) {
          const formExists = await page.evaluate(() => !!document.getElementById('userNameInput'));
          if (formExists && credentials.email && credentials.password && !autoFilled) {
            autoFilled = true;
            if (onLog) onLog('info', `✍️ Đang tự động điền tài khoản: ${credentials.email}...`);

            await page.evaluate((email, pass) => {
              const u = document.getElementById('userNameInput');
              const p = document.getElementById('passwordInput');
              const kmsi = document.getElementById('kmsiInput');
              if (u) {
                u.value = email;
                u.dispatchEvent(new Event('input', { bubbles: true }));
                u.dispatchEvent(new Event('change', { bubbles: true }));
              }
              if (p) {
                p.value = pass;
                p.dispatchEvent(new Event('input', { bubbles: true }));
                p.dispatchEvent(new Event('change', { bubbles: true }));
              }
              if (kmsi) {
                kmsi.checked = true;
              }
              const submit = document.getElementById('submitButton');
              if (submit) {
                submit.click();
              }
            }, credentials.email, credentials.password);

            if (onLog) onLog('info', '⚡ Đã tự động nhấn Đăng nhập trên trang Bách Khoa...');
          }
        }
      } catch (err) {
        // Ignored during page transitions
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
