# Hướng Dẫn Sử Dụng & Deploy iCTSV Sniper

---

## 1. Hướng Dẫn Lấy & Dán Token (Chỉ làm 1 lần)

1. Mở trình duyệt, truy cập: **[https://ctsv.hust.edu.vn/dat-ve](https://ctsv.hust.edu.vn/dat-ve)**
   *(Bắt buộc đăng nhập bằng tài khoản **Office 365** của trường: `tên.mssv@sis.hust.edu.vn`)*.
2. Bấm phím **F12** (chọn tab **Console**), dán đoạn mã sau vào rồi ấn **Enter**:

```javascript
(function(){function g(n){let v=document.cookie.match('(^|;) ?'+n+'=([^;]*)(;|$)');return v?v[2]:null;}const t=g('TokenBKNexus')||localStorage.getItem('TokenBKNexus');const u=g('UserName')||localStorage.getItem('UserName');const i=localStorage.getItem('adal.idtoken');const data=JSON.stringify({Token:t,UserName:u,idtoken:i});if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(data).then(()=>{alert('ĐÃ COPY TOKEN VÀO CLIPBOARD!\n\n Giờ hãy sang tab web Sniper và bấm [DÁN TỪ CLIPBOARD]!');}).catch(()=>{prompt('Copy đoạn mã này:',data);});}else{prompt('Copy đoạn mã này:',data);}})();
```

3. Màn hình hiện thông báo đã copy vào Clipboard.
4. Mở trang web ứng dụng Sniper của bạn (trên link Render hoặc `http://localhost:3000`), vào tab **Tài khoản & Token**:
   - Bấm nút **` DÁN TỪ CLIPBOARD (1-CLICK)`** (hoặc click vào ô dán nhanh rồi ấn `Ctrl + V`).
5. Sang tab **Auto-Book & Bot**:
   - Điền số điện thoại.
   - Bật công tắc **Bật Tự Động Đặt Vé**.
   - Bấm **Lưu cấu hình tự động**.
6. Bấm nút **BẬT GIÁM SÁT** ở trên cùng.

---

## 2. Hướng Dẫn Deploy Lên Render (Chạy Online 24/7)

1. Bấm nút **`Fork`** ở góc trên bên phải trang GitHub này để lưu mã nguồn về tài khoản GitHub của bạn.
2. Truy cập: **[https://dashboard.render.com](https://dashboard.render.com)** (Đăng nhập bằng GitHub).
3. Bấm **`New +`** -> Chọn **`Web Service`**.
4. Bấm **Connect** tại repository `ictsv_auto_noti_publish` vừa Fork trong tài khoản của bạn.
5. Điền cấu hình:
   - **Name:** `ictsv-sniper` (hoặc tên tùy thích).
   - **Region:** `Singapore`.
   - **Runtime:** `Node`.
   - **Build Command:** `npm install`.
   - **Start Command:** `npm start`.
   - **Instance Type:** `Free` ($0).
6. Bấm **`Deploy Web Service`**.
7. Sau khi Render deploy xong (khoảng 1 phút), Render sẽ cấp cho bạn một đường link HTTPS (dạng `https://ten-ban-chon.onrender.com`).
   *(Mã nguồn đã tích hợp sẵn cơ chế tự động ping `/health` giữ server thức 24/24, bạn không cần cài thêm gì cả).*

Xong! Bạn có thể tắt máy tính hoàn toàn, bot sẽ tự chạy ngầm trên đám mây và săn vé liên tục 24/7.
