# Firebase Realtime Database 規則（階段 C）

此資料夾**不屬於網站檔案**，不會被網頁載入，只供 Firebase Console 使用。

## 目前提供的規則

- `database.rules.C1.json`：第一階段。**只要求登入（匿名帳號即可）**，阻擋未帶權杖的存取（例如爬蟲或直接用網址讀取）。
  - 注意：此階段**不做資料隔離**。任何人都能建立匿名帳號後讀取全部資料。
  - 第二階段（資料隔離、管理員白名單）尚未定案，不要提前部署。

## 設定步驟（請依序執行）

### 步驟 1：確認匿名登入已啟用
Firebase Console → Authentication → Sign-in method → 「匿名」已啟用（你已完成）。

### 步驟 2：取得網頁 API 金鑰
Firebase Console → 專案設定（齒輪）→ 一般 → 「網頁 API 金鑰」（格式如 `AIza...`）。

### 步驟 3：填入程式（規則仍維持開放，先驗證）
編輯 `shared/auth.js`，把：
```js
const FIREBASE_WEB_API_KEY = '';
```
改為：
```js
const FIREBASE_WEB_API_KEY = '你的金鑰';
```
重新部署網站。此時資料庫規則**不變**，網站應與之前完全相同。

### 步驟 4：驗證權杖有附加
1. 開啟前台，按 F12 → Network，篩選 `moon1-cb403`。
2. 網址應包含 `?auth=`，回應為 200。
3. Console 不應出現 `[auth]` 的警告。
4. 確認 `yuelao_auth_session_v1` 出現在 localStorage。

若看到 `匿名登入失敗`，代表步驟 1 未完成或金鑰錯誤，請先修正。

### 步驟 5：在規劃工具中測試 C1 規則
Realtime Database → 規則 → 「規則模擬器（Rules Playground）」：
- 位置 `/yuelao_users`，模擬 **讀取**，驗證身分選「未驗證」→ 應被拒絕。
- 同一位置，驗證身分選「已驗證（任意 uid）」→ 應允許。

### 步驟 6：發佈 C1 規則
1. 把 `database.rules.C1.json` 內容貼到規則編輯器。
2. 點「發佈」。
3. 立即用無權杖的請求測試（會得到 `Permission denied`，代表規則生效）：
   ```
   https://moon1-cb403-default-rtdb.asia-southeast1.firebasedatabase.app/yuelao_wish_wall.json
   ```
4. 重新整理前台，確認網站仍正常。

### 回退方式
若發佈後網站異常，立即把規則改回舊版（`now < 1797091200000` 的開放規則）即可恢復。

## 重要時程

- 舊版開放規則的到期時間：**2026-12-13**。階段 C 完成前，不要讓它到期。

## 第二階段（尚未定案）需要先決定的事項

1. **還原碼機制**：目前 `backupCode` 可由玩家 ID 公開推算，無法作為秘密。需要改為隨機產生的還原碼（以雜湊儲存），並決定舊的 133 位玩家的還原碼如何遷移。
2. **玩家與帳號的對應（ownerUid）**：決定新裝置如何證明自己是某位玩家，才能讀取該玩家的私有資料與 IG。
3. **管理員登入**：目前後台是密碼輸入，白名單需要穩定的 UID。建議改用 Firebase 電子郵件登入（免費），管理員帳號的 UID 加入 `yuelao_admin_uids/{uid}: true`。

---

## C2-a 部署順序（管理員 Email 登入 + UID 白名單）

檔案：`firebase/database.rules.C2a.json`。**請依序執行，順序不可對調。**

1. Realtime Database → 資料：新增 `yuelao_admin_uids/wI2NbSH9SKRfar6wckPJqeXcQwq2` = `true`（目前 C1 規則下可寫入）。
2. 部署網站（update.zip）。舊版後台使用匿名權杖寫入後台節點，先部署網站可避免寫入失敗。
3. 以管理員 Email 登入後台，確認可正常讀取與操作。
4. 規則模擬器測試：未驗證寫入 `yuelao_system_batch` 應拒絕；已驗證非白名單 UID 應拒絕；白名單 UID 應允許。
5. 發佈 `database.rules.C2a.json`。
6. 前台煙霧測試：註冊、送出聊天、許願、檢舉、配對；後台測試：批次設定、自訂活動建立。

回退：改回 `database.rules.C1.json` 即可（不需改程式）。

---

## 流量與聊天修復（v20261119o）部署順序

檔案：`firebase/database.rules.C1b.json`（C1 + `yuelao_users.backupCode` 索引，供通行碼精準還原）。

1. **先**發佈 `database.rules.C1b.json`（沒有索引時還原會下載整包 yuelao_users，流量爆炸）。
2. **再**部署網站（update.zip）。
3. ⚠️ 此包含 C2-a 的管理員 Email 登入程式。部署前必須先在資料庫新增 `yuelao_admin_uids/wI2NbSH9SKRfar6wckPJqeXcQwq2` = `true`，否則後台無法登入。

回退：改回舊規則與舊網站檔案即可。
