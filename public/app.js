// iCTSV Ticket Sniper & Notifier Client Script

let appState = {
  config: {},
  events: [],
  filter: 'all',
  searchQuery: '',
  soundEnabled: true,
  autoScrollLogs: true,
  currentModalEvent: null
};

// Web Audio Synthesizer for alerts (Zero external audio file dependency)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playAlertSound(type = 'chime') {
  if (!appState.soundEnabled) return;
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'alert') {
      // Rapid double beep
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } else if (type === 'success') {
      // Victory chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2); // G5
      osc.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.3); // C6
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.6);
    } else {
      // Normal soft chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    }
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// Toast Notifications
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'info-circle';
  if (type === 'success') icon = 'check-circle';
  if (type === 'error') icon = 'exclamation-triangle';
  if (type === 'alert') icon = 'bell';

  toast.innerHTML = `
    <div class="toast-icon"><i class="fas fa-${icon}"></i></div>
    <div class="toast-message">${message}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventListeners();
  loadInitialConfig();
  connectSSE();
  fetchEventsManual(true);
});

// Setup Navigation Tabs
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

// Fetch Initial Config
async function loadInitialConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.success && data.config) {
      applyConfigToUI(data.config);
    }
  } catch (err) {
    showToast('Không tải được cấu hình hệ thống: ' + err.message, 'error');
  }
}

function applyConfigToUI(cfg) {
  appState.config = cfg;

  // Header user info
  const userDisplay = document.getElementById('userNameDisplay');
  const authDot = document.getElementById('authDot');
  if (cfg.userName) {
    userDisplay.innerText = `MSSV: ${cfg.userName}`;
    authDot.classList.add('verified');
  } else {
    userDisplay.innerText = 'Chưa thiết lập MSSV';
    authDot.classList.remove('verified');
  }

  // Monitor toggle button
  updateMonitorUI(cfg.monitorActive);

  // Automation tab inputs
  document.getElementById('cfgAutoBook').checked = !!cfg.autoBook;
  document.getElementById('cfgKeywords').value = cfg.targetKeywords || '';
  document.getElementById('cfgPhone').value = cfg.phone || '';
  document.getElementById('cfgInterval').value = cfg.pollInterval || 3000;
  document.getElementById('cfgNote').value = cfg.note || '';

  // Telegram inputs
  if (cfg.telegram) {
    document.getElementById('cfgTgEnabled').checked = !!cfg.telegram.enabled;
    document.getElementById('cfgTgBotToken').value = cfg.telegram.botToken || '';
    document.getElementById('cfgTgChatId').value = cfg.telegram.chatId || '';
  }

  // Auth tab inputs
  document.getElementById('authUserName').value = cfg.userName || '';
  document.getElementById('authToken').value = cfg.token || '';
  document.getElementById('authAccessToken').value = cfg.accessToken || '';
  if (document.getElementById('authEmail')) document.getElementById('authEmail').value = cfg.email || '';
  if (document.getElementById('authPassword')) document.getElementById('authPassword').value = cfg.password || '';
  if (document.getElementById('authRenderUrl')) document.getElementById('authRenderUrl').value = cfg.renderUrl || '';
  if (document.getElementById('authAutoRelogin')) document.getElementById('authAutoRelogin').checked = cfg.autoRelogin !== false;
}

function updateMonitorUI(isActive) {
  const btn = document.getElementById('startStopBtn');
  const icon = document.getElementById('startStopIcon');
  const text = document.getElementById('startStopText');
  const indicator = document.getElementById('statusIndicator');
  const statusTitle = document.getElementById('statusTitle');
  const statusDesc = document.getElementById('statusDesc');

  if (isActive) {
    btn.classList.add('running');
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    icon.className = 'fas fa-stop';
    text.innerText = 'DỪNG GIÁM SÁT';
    indicator.classList.add('active');
    statusTitle.innerText = 'ĐANG GIÁM SÁT LIÊN TỤC';
    statusDesc.innerText = `Hệ thống đang quét vé mỗi ${appState.config.pollInterval || 3000}ms`;
  } else {
    btn.classList.remove('running');
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
    icon.className = 'fas fa-play';
    text.innerText = 'BẬT GIÁM SÁT';
    indicator.classList.remove('active');
    statusTitle.innerText = 'HỆ THỐNG ĐANG DỪNG';
    statusDesc.innerText = 'Bấm nút bên cạnh để bắt đầu quét vé tự động';
  }
}

// Connect SSE Stream
function connectSSE() {
  const eventSource = new EventSource('/api/stream');

  eventSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    if (data.config) applyConfigToUI(data.config);
  });

  eventSource.addEventListener('ping', (e) => {
    const data = JSON.parse(e.data);
    const badge = document.getElementById('pingValue');
    if (badge) {
      badge.innerText = `${data.latency} ms`;
      if (data.latency < 200) {
        badge.style.color = '#10b981';
      } else if (data.latency < 500) {
        badge.style.color = '#f59e0b';
      } else {
        badge.style.color = '#ef4444';
      }
    }
  });

  eventSource.addEventListener('events', (e) => {
    const data = JSON.parse(e.data);
    appState.events = data.events || [];
    renderEvents();
    renderMyTickets();
  });

  eventSource.addEventListener('log', (e) => {
    const log = JSON.parse(e.data);
    appendLogLine(log);
  });

  eventSource.addEventListener('alert_event', (e) => {
    const data = JSON.parse(e.data);
    playAlertSound('alert');
    showToast(`🚨 PHÁT HIỆN VÉ: "${data.event.Title}" (${data.reason})!`, 'alert', 7000);
  });

  eventSource.addEventListener('booking_success', (e) => {
    const data = JSON.parse(e.data);
    playAlertSound('success');
    showToast(`🎉 SĂN VÉ THÀNH CÔNG: Mã vé ${data.ticket.TicketCode || ''}!`, 'success', 8000);
    // Refresh events
    fetchEventsManual();
  });

  eventSource.addEventListener('auth_error', (e) => {
    const data = JSON.parse(e.data);
    showToast(`⚠️ ${data.message}: Hãy cập nhật lại Token!`, 'error', 6000);
  });

  eventSource.addEventListener('config_updated', (e) => {
    const data = JSON.parse(e.data);
    if (data.config) {
      applyConfigToUI(data.config);
      showToast('Đã tự động cập nhật Token mới từ trình duyệt!', 'success');
    }
  });

  eventSource.onerror = () => {
    console.warn('SSE stream disconnected, reconnecting in 3s...');
  };
}

// Log line append
function appendLogLine(log) {
  const consoleEl = document.getElementById('logsConsole');
  if (!consoleEl) return;

  const row = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML = `
    <span class="log-time">[${log.timestamp}]</span>
    <span class="log-level ${log.level}">${log.level}</span>
    <span class="log-text">${escapeHtml(log.text)}</span>
  `;

  consoleEl.appendChild(row);

  if (appState.autoScrollLogs) {
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
}

// Render Events Grid
function renderEvents() {
  const grid = document.getElementById('eventsGrid');
  const countBadge = document.getElementById('eventCountBadge');
  if (!grid) return;

  let filtered = [...appState.events];

  // Apply search query
  if (appState.searchQuery.trim()) {
    const q = appState.searchQuery.toLowerCase();
    filtered = filtered.filter(ev =>
      (ev.Title && ev.Title.toLowerCase().includes(q)) ||
      (ev.GroupName && ev.GroupName.toLowerCase().includes(q)) ||
      (ev.Location && ev.Location.toLowerCase().includes(q))
    );
  }

  // Apply chip filter
  if (appState.filter === 'available') {
    filtered = filtered.filter(ev => ev.State === 'OPEN' && (ev.Capacity === 0 || ev.Remaining > 0));
  } else if (appState.filter === 'my') {
    filtered = filtered.filter(ev => !!ev.MyTicket);
  } else if (appState.filter === 'closed') {
    filtered = filtered.filter(ev => ev.State !== 'OPEN' || (ev.Capacity > 0 && ev.Remaining === 0));
  }

  countBadge.innerText = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-search empty-icon"></i>
        <h3>Không tìm thấy sự kiện nào</h3>
        <p>Thử đổi bộ lọc hoặc bấm "Làm mới" để tải lại từ iCTSV.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(ev => {
    const isMine = !!ev.MyTicket;
    const isAvailable = ev.State === 'OPEN' && (ev.Capacity === 0 || ev.Remaining > 0);
    const capacity = ev.Capacity || 0;
    const registered = ev.Registered || 0;
    const remaining = ev.Remaining || 0;
    const pct = capacity > 0 ? Math.min(100, Math.round((registered / capacity) * 100)) : 0;

    let stateClass = 'state-closed';
    let stateLabel = ev.StateText || 'Đã đóng';

    if (isMine) {
      stateClass = 'state-mine';
      stateLabel = '<i class="fas fa-check"></i> Đã có vé';
    } else if (isAvailable) {
      stateClass = 'state-open';
      stateLabel = `Còn ${remaining} chỗ`;
    }

    const startTimeFormatted = formatTime(ev.StartTime);
    const endTimeFormatted = formatTime(ev.EndTime);

    return `
      <div class="event-card ${isMine ? 'is-mine' : ''}">
        <div class="event-top">
          <span class="event-group">${escapeHtml(ev.GroupName || 'Sự kiện sinh viên')}</span>
          <span class="state-badge ${stateClass}">${stateLabel}</span>
        </div>

        <h3 class="event-title" title="${escapeHtml(ev.Title)}">${escapeHtml(ev.Title)}</h3>

        <div class="event-meta">
          <div class="meta-item">
            <i class="fas fa-clock"></i>
            <span>${startTimeFormatted} ${endTimeFormatted ? '– ' + endTimeFormatted : ''}</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-map-marker-alt"></i>
            <span>${escapeHtml(ev.Location || 'Trường ĐH Bách Khoa Hà Nội')}</span>
          </div>
        </div>

        <div class="capacity-box">
          <div class="capacity-labels">
            <span>Đã đăng ký: <b>${registered}/${capacity > 0 ? capacity : '∞'}</b></span>
            <span>${capacity > 0 ? pct + '%' : 'Không giới hạn'}</span>
          </div>
          <div class="capacity-progress">
            <div class="progress-fill ${pct >= 100 ? 'full' : pct < 80 ? 'good' : ''}" style="width: ${capacity > 0 ? pct : 0}%"></div>
          </div>
        </div>

        <div class="event-actions">
          ${isMine ? `
            <button class="btn btn-secondary btn-small btn-book" onclick="openQrModal(${ev.Id})">
              <i class="fas fa-qrcode"></i> Xem vé & QR
            </button>
            ${ev.AllowCancel ? `
              <button class="btn btn-danger btn-small" onclick="handleCancelTicket(${ev.Id})">
                <i class="fas fa-times"></i> Huỷ
              </button>
            ` : ''}
          ` : `
            <button class="btn btn-primary btn-book ${!isAvailable ? 'disabled' : ''}" 
              ${!isAvailable ? 'disabled' : ''} 
              onclick="openRegisterModal(${ev.Id})">
              <i class="fas fa-bolt"></i> ${isAvailable ? '⚡ Đăng ký ngay' : 'Hết vé'}
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// Render My Tickets
function renderMyTickets() {
  const container = document.getElementById('myTicketsList');
  const countBadge = document.getElementById('myTicketCountBadge');
  if (!container) return;

  const mine = appState.events.filter(ev => !!ev.MyTicket);
  countBadge.innerText = mine.length;

  if (mine.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-ticket empty-icon"></i>
        <h3>Bạn chưa có vé nào</h3>
        <p>Các vé đặt thành công sẽ hiển thị tại đây cùng mã QR để check-in.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = mine.map(ev => {
    const t = ev.MyTicket;
    return `
      <div class="ticket-pass">
        <div class="ticket-header">
          <span class="event-group">${escapeHtml(ev.GroupName || 'Hoạt động Bách Khoa')}</span>
          <h3 class="event-title">${escapeHtml(ev.Title)}</h3>
          <div class="ticket-code-tag">${t.TicketCode || 'N/A'}</div>
        </div>

        <div class="ticket-body-details">
          <div class="seat-box">
            <small style="color: var(--text-dim); display: block;">SỐ THỨ TỰ</small>
            <span class="seat-num">${t.SeatNo || '--'}</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-clock"></i>
            <span>${formatTime(ev.StartTime)}</span>
          </div>
        </div>

        <div class="event-actions">
          <button class="btn btn-secondary btn-small" style="flex: 1" onclick="openQrModal(${ev.Id})">
            <i class="fas fa-qrcode"></i> Mở mã QR Check-in
          </button>
          ${ev.AllowCancel ? `
            <button class="btn btn-danger btn-small" onclick="handleCancelTicket(${ev.Id})">
              <i class="fas fa-times"></i> Huỷ vé
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Helper: Format Time string
function formatTime(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    return str.replace('T', ' ').slice(0, 16);
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} ${day}/${month}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Register Modal Logic
window.openRegisterModal = function(eventId) {
  const ev = appState.events.find(e => e.Id === eventId);
  if (!ev) return;
  appState.currentModalEvent = ev;

  document.getElementById('modalEventTitle').innerText = ev.Title;
  document.getElementById('modalEventDetails').innerHTML = `
    <div><i class="fas fa-clock"></i> ${formatTime(ev.StartTime)}</div>
    <div><i class="fas fa-map-marker-alt"></i> ${ev.Location || 'Trường Bách Khoa'}</div>
    <div><i class="fas fa-ticket-alt"></i> Còn lại: <b>${ev.Remaining}</b> chỗ</div>
  `;

  document.getElementById('modalPhone').value = appState.config.phone || '';
  document.getElementById('modalNote').value = appState.config.note || '';

  document.getElementById('registerModal').classList.add('open');
};

// QR Code Modal Logic
window.openQrModal = function(eventId) {
  const ev = appState.events.find(e => e.Id === eventId);
  if (!ev || !ev.MyTicket) return;

  const t = ev.MyTicket;
  document.getElementById('qrEventTitle').innerText = ev.Title;
  document.getElementById('qrTicketCode').innerText = t.TicketCode || 'N/A';
  document.getElementById('qrSeatNo').innerText = t.SeatNo || '--';
  document.getElementById('qrMssv').innerText = appState.config.userName || '--';

  const qrContainer = document.getElementById('qrCodeContainer');
  qrContainer.innerHTML = '';

  if (window.QRCode && t.TicketCode) {
    new QRCode(qrContainer, {
      text: t.TicketCode,
      width: 180,
      height: 180,
      colorDark: '#0a0f1d',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  document.getElementById('qrModal').classList.add('open');
};

// Cancel Ticket
window.handleCancelTicket = async function(eventId) {
  if (!confirm('Bạn có chắc chắn muốn huỷ vé tham gia sự kiện này không?')) return;
  try {
    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId })
    });
    const data = await res.json();
    if (data.success && data.data && data.data.RespCode === 0) {
      showToast('Đã huỷ vé thành công!', 'success');
      fetchEventsManual();
    } else {
      showToast('Huỷ vé thất bại: ' + (data.data?.RespText || data.error), 'error');
    }
  } catch (err) {
    showToast('Lỗi khi gửi yêu cầu huỷ vé: ' + err.message, 'error');
  }
};

// Fetch Events Manually
async function fetchEventsManual(silent = false) {
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('fa-spin');
  try {
    const res = await fetch('/api/events');
    const result = await res.json();
    if (result.success && result.data && result.data.RespCode === 0) {
      appState.events = result.data.Events || [];
      renderEvents();
      renderMyTickets();
      if (!silent) showToast('Đã cập nhật danh sách sự kiện!', 'success');
    } else {
      if (!silent) {
        showToast('Không lấy được sự kiện: ' + (result.data?.RespText || result.error || 'Token không hợp lệ'), 'error');
      }
      const container = document.getElementById('eventsList');
      if (container && (!appState.events || appState.events.length === 0)) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-exclamation-circle empty-icon" style="color: #ef4444;"></i>
            <h3>Chưa tải được sự kiện</h3>
            <p>${result.data?.RespText || result.error || 'Token chưa cấu hình hoặc đã hết hạn.'}</p>
          </div>
        `;
      }
    }
  } catch (err) {
    if (!silent) showToast('Lỗi kết nối: ' + err.message, 'error');
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Monitor Toggle Button
  document.getElementById('startStopBtn').addEventListener('click', async () => {
    const willActive = !appState.config.monitorActive;
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorActive: willActive })
      });
      const data = await res.json();
      if (data.success) {
        applyConfigToUI(data.config);
        showToast(willActive ? 'Đã bắt đầu giám sát iCTSV!' : 'Đã dừng giám sát!', 'info');
      }
    } catch (e) {
      showToast('Lỗi thay đổi trạng thái giám sát: ' + e.message, 'error');
    }
  });

  // Manual Refresh Button
  document.getElementById('manualRefreshBtn').addEventListener('click', () => fetchEventsManual(false));

  // Sound Toggle
  document.getElementById('toggleSoundBtn').addEventListener('click', () => {
    appState.soundEnabled = !appState.soundEnabled;
    const btn = document.getElementById('toggleSoundBtn');
    btn.innerHTML = appState.soundEnabled ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
    showToast(appState.soundEnabled ? 'Đã bật âm thanh cảnh báo' : 'Đã tắt âm thanh cảnh báo', 'info');
    if (appState.soundEnabled) playAlertSound('chime');
  });

  // Search input
  document.getElementById('eventSearchInput').addEventListener('input', (e) => {
    appState.searchQuery = e.target.value;
    renderEvents();
  });

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      appState.filter = chip.dataset.filter;
      renderEvents();
    });
  });

  // Save Automation Config
  document.getElementById('saveAutoConfigBtn').addEventListener('click', async () => {
    const payload = {
      autoBook: document.getElementById('cfgAutoBook').checked,
      targetKeywords: document.getElementById('cfgKeywords').value.trim(),
      phone: document.getElementById('cfgPhone').value.trim(),
      pollInterval: Number(document.getElementById('cfgInterval').value) || 3000,
      note: document.getElementById('cfgNote').value.trim(),
      telegram: {
        enabled: document.getElementById('cfgTgEnabled').checked,
        botToken: document.getElementById('cfgTgBotToken').value.trim(),
        chatId: document.getElementById('cfgTgChatId').value.trim()
      }
    };

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        applyConfigToUI(data.config);
        showToast('Đã lưu cấu hình tự động & Telegram thành công!', 'success');
      }
    } catch (e) {
      showToast('Lỗi lưu cấu hình: ' + e.message, 'error');
    }
  });

  // Test Telegram
  document.getElementById('testTelegramBtn').addEventListener('click', async () => {
    const botToken = document.getElementById('cfgTgBotToken').value.trim();
    const chatId = document.getElementById('cfgTgChatId').value.trim();
    if (!botToken || !chatId) {
      showToast('Vui lòng nhập Bot Token và Chat ID trước khi test!', 'warning');
      return;
    }
    showToast('Đang gửi tin nhắn thử nghiệm...', 'info');
    try {
      const res = await fetch('/api/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken, chatId })
      });
      const data = await res.json();
      if (data.ok) {
        showToast('Tin nhắn Telegram đã được gửi thành công! Kiểm tra app Telegram của bạn.', 'success');
      } else {
        showToast('Gửi tin thất bại: ' + (data.description || 'Lỗi không xác định'), 'error');
      }
    } catch (e) {
      showToast('Lỗi kết nối Telegram: ' + e.message, 'error');
    }
  });

  // Save Auth Form
  document.getElementById('saveAuthBtn').addEventListener('click', async () => {
    let userName = document.getElementById('authUserName').value.trim().replace(/['"]/g, '');
    let token = document.getElementById('authToken').value.trim().replace(/['"]/g, '');
    let accessToken = document.getElementById('authAccessToken').value.trim().replace(/['"]/g, '');
    let email = document.getElementById('authEmail') ? document.getElementById('authEmail').value.trim() : '';
    let password = document.getElementById('authPassword') ? document.getElementById('authPassword').value : '';
    let renderUrl = document.getElementById('authRenderUrl') ? document.getElementById('authRenderUrl').value.trim() : '';
    let autoRelogin = document.getElementById('authAutoRelogin') ? document.getElementById('authAutoRelogin').checked : true;

    document.getElementById('authUserName').value = userName;
    document.getElementById('authToken').value = token;
    document.getElementById('authAccessToken').value = accessToken;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName, token, accessToken, email, password, renderUrl, autoRelogin })
      });
      const data = await res.json();
      if (data.success) {
        applyConfigToUI(data.config);
        showToast('Đã lưu thông tin tài khoản!', 'success');
        fetchEventsManual();
      }
    } catch (e) {
      showToast('Lỗi lưu thông tin tài khoản: ' + e.message, 'error');
    }
  });

  // Test Auth Connection
  document.getElementById('testAuthBtn').addEventListener('click', async () => {
    showToast('Đang kiểm tra kết nối với máy chủ iCTSV Bách Khoa...', 'info');
    await fetchEventsManual();
  });

  // 1-Click Auto Login Browser Launcher
  document.getElementById('autoLoginBtn').addEventListener('click', async () => {
    const btn = document.getElementById('autoLoginBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tự động đăng nhập...';
    try {
      const res = await fetch('/api/auth/auto-login', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Đang chạy tự động đăng nhập! Hệ thống sẽ tự nhận diện và bắt Token.', 'info', 7000);
      } else {
        showToast('Không mở được trình duyệt: ' + data.message, 'error');
      }
    } catch (e) {
      showToast('Lỗi: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-bolt"></i> ⚡ TỰ ĐỘNG ĐĂNG NHẬP 100% (ZERO-CLICK)';
    }
  });

  // Copy Snippet Code Button
  document.getElementById('copySnippetBtn').addEventListener('click', () => {
    const code = document.getElementById('syncSnippetCode').innerText;
    navigator.clipboard.writeText(code).then(() => {
      showToast('Đã copy đoạn mã! Hãy mở Console (F12) trên trang CTSV và dán vào.', 'success');
    }).catch(() => {
      showToast('Không thể copy tự động, vui lòng chọn và copy thủ công', 'warning');
    });
  });

  // Handle Quick Paste JSON
  function parseAndApplyTokenData(rawText) {
    try {
      const parsed = JSON.parse(rawText.trim());
      if (parsed.Token || parsed.UserName) {
        const u = String(parsed.UserName || '').replace(/['"]/g, '').trim();
        const t = String(parsed.Token || '').replace(/['"]/g, '').trim();
        const idt = String(parsed.idtoken || '').replace(/['"]/g, '').trim();

        if (u) document.getElementById('authUserName').value = u;
        if (t) document.getElementById('authToken').value = t;
        if (idt && idt !== 'null') document.getElementById('authAccessToken').value = idt;

        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: u,
            token: t,
            accessToken: idt !== 'null' ? idt : ''
          })
        }).then(r => r.json()).then(data => {
          if (data.success) {
            applyConfigToUI(data.config);
            showToast(`🎉 Đã nhận diện MSSV: ${u}!`, 'success');
            fetchEventsManual();
          }
        });
        return true;
      }
    } catch (e) {
      showToast('Dữ liệu dán vào không đúng định dạng JSON: ' + e.message, 'error');
    }
    return false;
  }

  // 1-Click Paste from Clipboard Button
  document.getElementById('pasteClipboardBtn').addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          parseAndApplyTokenData(text);
          return;
        }
      }
      showToast('Trình duyệt chặn đọc clipboard, hãy click ô dưới và ấn Ctrl+V!', 'warning');
      document.getElementById('quickPasteInput').focus();
    } catch (err) {
      showToast('Hãy click vào ô bên dưới rồi ấn Ctrl+V để dán!', 'warning');
      document.getElementById('quickPasteInput').focus();
    }
  });

  // Quick Paste Input Box (Ctrl+V)
  document.getElementById('quickPasteInput').addEventListener('input', (e) => {
    const val = e.target.value;
    if (val && val.includes('{')) {
      if (parseAndApplyTokenData(val)) {
        e.target.value = '';
      }
    }
  });

  // Confirm Manual Register
  document.getElementById('confirmRegisterBtn').addEventListener('click', async () => {
    if (!appState.currentModalEvent) return;
    const ev = appState.currentModalEvent;
    const phone = document.getElementById('modalPhone').value.trim();
    const note = document.getElementById('modalNote').value.trim();

    const btn = document.getElementById('confirmRegisterBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đăng ký...';

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: ev.Id,
          title: ev.Title,
          phone,
          note
        })
      });
      const data = await res.json();
      if (data.success && data.data && data.data.RespCode === 0) {
        showToast(`🎉 Đặt vé thành công! Mã vé: ${data.data.Ticket?.TicketCode || ''}`, 'success');
        document.getElementById('registerModal').classList.remove('open');
        fetchEventsManual();
      } else {
        showToast('Đặt vé không thành công: ' + (data.message || data.data?.RespText || 'Đã hết chỗ'), 'error');
      }
    } catch (e) {
      showToast('Lỗi gửi yêu cầu đăng ký: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> ĐĂNG KÝ VÉ NGAY';
    }
  });

  // Close modals
  document.getElementById('closeRegisterModal').addEventListener('click', () => {
    document.getElementById('registerModal').classList.remove('open');
  });
  document.getElementById('cancelModalBtn').addEventListener('click', () => {
    document.getElementById('registerModal').classList.remove('open');
  });
  document.getElementById('closeQrModal').addEventListener('click', () => {
    document.getElementById('qrModal').classList.remove('open');
  });

  // Auto scroll logs toggle
  document.getElementById('autoScrollCheck').addEventListener('change', (e) => {
    appState.autoScrollLogs = e.target.checked;
  });

  // Clear logs button
  document.getElementById('clearLogsBtn').addEventListener('click', () => {
    const consoleEl = document.getElementById('logsConsole');
    if (consoleEl) consoleEl.innerHTML = '';
    showToast('Đã xóa log', 'info');
  });
}
