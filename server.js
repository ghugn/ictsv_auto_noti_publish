const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const BASE_URL = 'https://ctsv.hust.edu.vn/bknexus/';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load / Save Config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
  return {
    token: '',
    userName: '',
    accessToken: '',
    phone: '',
    note: '',
    autoBook: false,
    targetKeywords: '',
    pollInterval: 3000,
    monitorActive: false,
    telegram: { enabled: false, botToken: '', chatId: '' },
    soundAlert: true
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

let config = loadConfig();

// SSE Clients
let sseClients = [];

function broadcastSSE(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(payload);
    } catch (e) {
      // client disconnected
    }
  });
}

function logMessage(level, text, details = null) {
  const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const entry = { timestamp, level, text, details };
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${text}`);
  broadcastSSE('log', entry);
}

// Telegram Sender
async function sendTelegram(message) {
  if (!config.telegram || !config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    const data = await res.json();
    return data.ok;
  } catch (err) {
    console.error('Telegram notification error:', err.message);
    return false;
  }
}

// iCTSV API helpers
async function apiCall(endpoint, body = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const payload = {
    ...body,
    Token: config.token,
    UserName: config.userName
  };

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://ctsv.hust.edu.vn/'
      },
      body: JSON.stringify(payload)
    });
    const latency = Date.now() - start;
    const data = await res.json();
    return { success: true, latency, data };
  } catch (err) {
    const latency = Date.now() - start;
    return { success: false, latency, error: err.message };
  }
}

// Auto-refresh token if accessToken exists
async function tryRefreshToken() {
  if (!config.accessToken) return false;
  logMessage('info', 'Đang thử làm mới Token bằng Office 365 AccessToken...');
  try {
    const res = await fetch(`${BASE_URL}Lab/LoginByAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ AccessToken: config.accessToken })
    });
    const data = await res.json();
    if (data && data.RespCode === 0 && data.Token) {
      config.token = data.Token;
      saveConfig(config);
      logMessage('success', 'Đã tự động gia hạn TokenBKNexus thành công!');
      return true;
    }
  } catch (e) {
    logMessage('error', 'Gia hạn token thất bại: ' + e.message);
  }
  return false;
}

// Event state cache
let previousEventsMap = new Map();
let isPolling = false;
let pollTimer = null;

async function checkEventsCycle() {
  if (isPolling) return;
  isPolling = true;

  try {
    if (!config.token || !config.userName) {
      broadcastSSE('status', {
        active: false,
        warning: 'Chưa cấu hình Token hoặc MSSV (UserName)'
      });
      isPolling = false;
      return;
    }

    const { success, latency, data, error } = await apiCall('Event/GetEvents');
    broadcastSSE('ping', { latency, timestamp: Date.now() });

    if (!success) {
      logMessage('error', `Lỗi mạng khi kết nối iCTSV (${latency}ms): ${error}`);
      isPolling = false;
      return;
    }

    if (data.RespCode === 401) {
      logMessage('warning', 'Phiên đăng nhập không hợp lệ (401). Đang thử làm mới token...');
      const refreshed = await tryRefreshToken();
      if (!refreshed) {
        logMessage('error', 'Token đã hết hạn! Vui lòng cập nhật Token mới từ trang web ctsv.hust.edu.vn');
        broadcastSSE('auth_error', { message: 'Token đã hết hạn' });
      }
      isPolling = false;
      return;
    }

    if (data.RespCode !== 0) {
      logMessage('warning', `iCTSV trả lời lỗi [${data.RespCode}]: ${data.RespText || 'Không rõ'}`);
      isPolling = false;
      return;
    }

    const events = data.Events || [];
    broadcastSSE('events', { events, timestamp: Date.now() });

    // Compare with previous state
    for (const ev of events) {
      const prev = previousEventsMap.get(ev.Id);
      const isAvailable = ev.State === 'OPEN' && (ev.Capacity === 0 || (ev.Capacity > 0 && ev.Remaining > 0));
      const hasMyTicket = !!ev.MyTicket;

      let triggered = false;
      let reason = '';

      if (!prev) {
        // First time seeing this event or newly created
        if (isAvailable && !hasMyTicket) {
          triggered = true;
          reason = 'Sự kiện mới mở có vé';
        }
      } else {
        const prevAvailable = prev.State === 'OPEN' && (prev.Capacity === 0 || (prev.Capacity > 0 && prev.Remaining > 0));
        // Transition from NOT available to AVAILABLE
        if (!prevAvailable && isAvailable && !hasMyTicket) {
          triggered = true;
          reason = 'Vừa mở thêm vé / Có chỗ trống!';
        } else if (prev.Remaining === 0 && ev.Remaining > 0 && !hasMyTicket) {
          triggered = true;
          reason = `Có người nhả vé! (Còn ${ev.Remaining} chỗ)`;
        }
      }

      previousEventsMap.set(ev.Id, {
        Id: ev.Id,
        Title: ev.Title,
        State: ev.State,
        Capacity: ev.Capacity,
        Remaining: ev.Remaining,
        MyTicket: ev.MyTicket
      });

      if (triggered) {
        logMessage('alert', `🔔 [PHÁT HIỆN] ${reason}: "${ev.Title}" - Còn ${ev.Remaining}/${ev.Capacity} vé!`, ev);

        // Check keyword filter
        let matchFilter = true;
        if (config.targetKeywords && config.targetKeywords.trim() !== '') {
          const kwList = config.targetKeywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
          const fullText = `${ev.Title} ${ev.GroupName || ''}`.toLowerCase();
          matchFilter = kwList.some(kw => fullText.includes(kw));
        }

        // Send alert
        broadcastSSE('alert_event', {
          event: ev,
          reason,
          matchFilter
        });

        // Telegram alert
        const tgMsg = `🚨 <b>PHÁT HIỆN VÉ MỞ ICTSV!</b>\n` +
          `📌 <b>Sự kiện:</b> ${ev.Title}\n` +
          `👥 <b>Nhóm:</b> ${ev.GroupName || 'Không có'}\n` +
          `🎫 <b>Còn lại:</b> ${ev.Remaining}/${ev.Capacity} chỗ\n` +
          `⏰ <b>Thời gian:</b> ${ev.StartTime ? ev.StartTime.replace('T', ' ') : 'N/A'}\n` +
          `📍 <b>Địa điểm:</b> ${ev.Location || 'Trường Bách Khoa'}\n` +
          `ℹ️ <b>Lý do:</b> ${reason}\n\n` +
          (config.autoBook && matchFilter ? `⚡ <i>Đang kích hoạt chế độ TỰ ĐỘNG ĐẶT VÉ...</i>` : `👉 <i>Vào app hoặc web để bấm đặt vé ngay!</i>`);
        sendTelegram(tgMsg);

        // Auto Book if enabled and matches keyword
        if (config.autoBook && matchFilter && !hasMyTicket) {
          logMessage('info', `⚡ [AUTO-BOOK] Đang tiến hành đặt vé ngay lập tức cho sự kiện #${ev.Id}: "${ev.Title}"...`);
          await executeRegister(ev.Id, ev.Title);
        }
      }
    }
  } catch (err) {
    logMessage('error', 'Lỗi không xác định trong vòng lặp kiểm tra: ' + err.message);
  } finally {
    isPolling = false;
  }
}

// Function to register ticket
async function executeRegister(eventId, eventTitle = '') {
  const start = Date.now();
  const res = await apiCall('Event/Register', {
    EventId: eventId,
    Phone: config.phone || null,
    Note: config.note || null
  });
  const duration = Date.now() - start;

  if (res.success && res.data && res.data.RespCode === 0) {
    const ticket = res.data.Ticket || {};
    const successMsg = `🎉 ĐẶT VÉ THÀNH CÔNG! Mã vé: ${ticket.TicketCode || 'N/A'} (Số thứ tự: ${ticket.SeatNo || 'N/A'}) - Thời gian: ${duration}ms!`;
    logMessage('success', successMsg, ticket);

    broadcastSSE('booking_success', {
      eventId,
      eventTitle,
      ticket,
      duration
    });

    sendTelegram(`🎉 <b>ĐẶT VÉ THÀNH CÔNG!</b>\n` +
      `📌 <b>Sự kiện:</b> ${eventTitle || eventId}\n` +
      `🎟️ <b>Mã vé:</b> <code>${ticket.TicketCode || 'N/A'}</code>\n` +
      `🔢 <b>Số thứ tự ghế:</b> ${ticket.SeatNo || 'N/A'}\n` +
      `⚡ <b>Thời gian xử lý:</b> ${duration}ms\n` +
      `👤 <b>MSSV:</b> ${config.userName}`);
    return { success: true, data: res.data };
  } else {
    const errorText = res.data ? res.data.RespText : res.error;
    const failMsg = `❌ Đặt vé thất bại cho sự kiện #${eventId}: ${errorText || 'Không rõ'} (${duration}ms)`;
    logMessage('error', failMsg);

    sendTelegram(`❌ <b>ĐẶT VÉ THẤT BẠI</b>\n` +
      `📌 <b>Sự kiện:</b> ${eventTitle || eventId}\n` +
      `⚠️ <b>Lý do:</b> ${errorText || 'Lỗi không xác định'}\n` +
      `⚡ <b>Thời gian phản hồi:</b> ${duration}ms`);
    return { success: false, message: errorText };
  }
}

// Monitor loop controller
function startMonitor() {
  if (pollTimer) clearInterval(pollTimer);
  const interval = Math.max(1000, Number(config.pollInterval) || 3000);
  config.monitorActive = true;
  saveConfig(config);
  logMessage('info', `🚀 Đã BẬT giám sát iCTSV với tần suất ${interval}ms/lần`);
  checkEventsCycle();
  pollTimer = setInterval(checkEventsCycle, interval);
}

function stopMonitor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  config.monitorActive = false;
  saveConfig(config);
  logMessage('info', '🛑 Đã DỪNG giám sát iCTSV');
}

// API Routes
app.get('/api/config', (req, res) => {
  res.json({ success: true, config });
});

app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  const oldActive = config.monitorActive;
  const oldInterval = config.pollInterval;

  config = {
    ...config,
    ...newConfig
  };
  saveConfig(config);

  if (config.monitorActive && (!oldActive || oldInterval !== config.pollInterval)) {
    startMonitor();
  } else if (!config.monitorActive && oldActive) {
    stopMonitor();
  }

  res.json({ success: true, config });
});

// Endpoint called by Bookmarklet or console script directly from ctsv.hust.edu.vn
app.post('/api/auth/save-token', (req, res) => {
  const { Token, UserName, idtoken, phone } = req.body;
  if (!Token && !UserName) {
    return res.status(400).json({ success: false, message: 'Dữ liệu token không hợp lệ' });
  }

  if (Token) config.token = Token;
  if (UserName) config.userName = UserName;
  if (idtoken) config.accessToken = idtoken;
  if (phone) config.phone = phone;

  saveConfig(config);
  logMessage('success', `Đã đồng bộ thông tin đăng nhập tự động từ trình duyệt! MSSV: ${config.userName}`);
  broadcastSSE('config_updated', { config });
  res.json({ success: true, message: 'Đã lưu token thành công!' });
});

// Health check endpoint for Cloud platforms (Render, Koyeb, UptimeRobot)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    monitorActive: config.monitorActive,
    userName: config.userName || null
  });
});

// Direct Events Fetch
app.get('/api/events', async (req, res) => {
  const result = await apiCall('Event/GetEvents');
  res.json(result);
});

// Auto-Login Browser Launcher
const { launchAutoLogin } = require('./autologin');

app.post('/api/auth/auto-login', async (req, res) => {
  const started = await launchAutoLogin((tokenData) => {
    config.token = tokenData.token;
    config.userName = tokenData.userName;
    if (tokenData.accessToken) config.accessToken = tokenData.accessToken;
    saveConfig(config);
    logMessage('success', `Đã tự động cập nhật Token vào hệ thống! MSSV: ${config.userName}`);
    broadcastSSE('config_updated', { config });
  }, (level, msg) => {
    logMessage(level, msg);
  });

  res.json({ success: started, message: started ? 'Đang mở trình duyệt...' : 'Không thể mở trình duyệt' });
});

// Manual 1-Click Register
app.post('/api/register', async (req, res) => {
  const { eventId, title, phone, note } = req.body;
  if (!eventId) {
    return res.status(400).json({ success: false, message: 'Thiếu eventId' });
  }
  logMessage('info', `[THỦ CÔNG] Đang đặt vé cho sự kiện #${eventId}...`);
  const result = await executeRegister(eventId, title || `Sự kiện #${eventId}`);
  res.json(result);
});

// Cancel Ticket
app.post('/api/cancel', async (req, res) => {
  const { eventId } = req.body;
  if (!eventId) {
    return res.status(400).json({ success: false, message: 'Thiếu eventId' });
  }
  logMessage('info', `Đang gửi yêu cầu huỷ vé cho sự kiện #${eventId}...`);
  const result = await apiCall('Event/CancelTicket', { EventId: eventId });
  if (result.success && result.data && result.data.RespCode === 0) {
    logMessage('success', `Đã huỷ vé sự kiện #${eventId} thành công!`);
  } else {
    logMessage('error', `Huỷ vé thất bại: ${result.data?.RespText || result.error}`);
  }
  res.json(result);
});

// Test Telegram
app.post('/api/test-telegram', async (req, res) => {
  const { botToken, chatId } = req.body;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🔔 <b>Thử nghiệm kết nối Bot Telegram thành công!</b>\nỨng dụng iCTSV Noti đã kết nối sẵn sàng để bắn thông báo và săn vé cho bạn.',
        parse_mode: 'HTML'
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, description: err.message });
  }
});

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send initial config & state
  res.write(`event: init\ndata: ${JSON.stringify({ config, monitorActive: config.monitorActive })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// Self keep-alive ping (Anti-sleep for Cloud platforms like Render)
function startKeepAlive() {
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderExternalUrl) {
    console.log(`[Keep-Alive] Đã phát hiện Render URL: ${renderExternalUrl}. Tự động ping mỗi 10 phút!`);
    setInterval(() => {
      fetch(`${renderExternalUrl}/health`)
        .then(r => r.json())
        .then(d => console.log(`[Keep-Alive] Ping thành công lúc ${new Date().toLocaleTimeString('vi-VN')}`))
        .catch(e => console.warn(`[Keep-Alive] Ping lỗi:`, e.message));
    }, 10 * 60 * 1000); // 10 minutes
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  HỆ THỐNG GIÁM SÁT & SĂN VÉ ICTSV HUST ĐANG CHẠY!`);
  console.log(`  Giao diện Web Dashboard: http://localhost:${PORT}`);
  console.log(`====================================================`);

  if (config.monitorActive) {
    startMonitor();
  }

  startKeepAlive();
});
