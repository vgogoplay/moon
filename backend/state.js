/* backend/state.js - 後台管理員驗證、分頁切換、系統開關、信箱發送與禁止規則 */

const FIELD_LABELS = {
    gender: '性別', mbti: 'MBTI', ageRange: '年齡範圍', region: '居住地區', city: '居住縣市',
    height: '身高', hasPet: '養寵物', smoking: '抽煙', drinking: '喝酒', lookingFor: '想找關係'
};

const BAN_FIELD_NAMES = {
    ig: 'IG 帳號', nickname: '暱稱', bio: '自我介紹', all: '全部文字欄位'
};

let lastUsersSnapshot = '';
let lastReportsSnapshot = '';
let lastSystemSnapshot = '';
let lastChatsAdminSnapshot = '';
let lastMatchLogsAdminSnapshot = '';
let lastOverviewRenderSig = '';
let rosterPageSize = '5';
let currentRosterPage = 1;
let rosterSearchKeyword = '';

function onRosterSearchInput(val) {
    rosterSearchKeyword = String(val || '').trim();
    const clearBtn = document.getElementById('clearRosterSearchBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', rosterSearchKeyword === '');
    }
    currentRosterPage = 1;
    renderAdminAll();
}

function clearRosterSearch() {
    rosterSearchKeyword = '';
    const inputEl = document.getElementById('rosterSearchInput');
    if (inputEl) inputEl.value = '';
    const clearBtn = document.getElementById('clearRosterSearchBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    currentRosterPage = 1;
    renderAdminAll();
}

// ==================== ⚡ 後台記憶體快取（減少重複 JSON.parse 負擔） ====================
const AdminMemoryCache = {
    usersRaw: null,
    users: null,
    reportsRaw: null,
    reports: null,
    systemRaw: null,
    system: null,
    mailboxRaw: null,
    mailbox: null,
    bannedRulesRaw: null,
    bannedRules: null,
    forceRulesRaw: null,
    forceRules: null,
    chatsRaw: null,
    chats: null,
    regHistoryRaw: null,
    regHistory: null,
    invalidate(key) {
        if (!key) {
            this.usersRaw = this.reportsRaw = this.systemRaw = this.mailboxRaw = this.bannedRulesRaw = this.forceRulesRaw = this.chatsRaw = this.regHistoryRaw = null;
            this.users = this.reports = this.system = this.mailbox = this.bannedRules = this.forceRules = this.chats = this.regHistory = null;
            return;
        }
        this[key + 'Raw'] = null;
        this[key] = null;
    }
};

function onRosterPageSizeChange(newSize) {
    const val = ['5', '10', '50', 'all'].includes(String(newSize)) ? String(newSize) : '5';
    rosterPageSize = val;
    currentRosterPage = 1;
    renderAdminAll();
}
const ADMIN_TAB_STORAGE_KEY = 'yuelao_admin_active_tab';

function switchAdminTab(tabName) {
    const validTabs = ['roster', 'custom-activities', 'ops-tools'];
    const targetTab = validTabs.includes(tabName) ? tabName : 'roster';
    sessionStorage.setItem(ADMIN_TAB_STORAGE_KEY, targetTab);

    document.querySelectorAll('.admin-tab-panel').forEach(panel => {
        panel.classList.add('hidden');
    });
    const rosterBottom = document.getElementById('admin-tab-roster-bottom');
    if (rosterBottom) {
        rosterBottom.classList.toggle('hidden', targetTab !== 'roster');
    }

    const activePanel = document.getElementById(`admin-tab-${targetTab}`);
    if (activePanel) {
        activePanel.classList.remove('hidden');
    }

    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.adminTabBtn === targetTab);
    });
}

function onRosterFilterChange() {
    currentRosterPage = 1;
    renderAdminAll();
}

function goToRosterPage(pageNum) {
    const targetPage = parseInt(pageNum, 10);
    if (isNaN(targetPage) || targetPage < 1) return;
    currentRosterPage = targetPage;
    renderAdminAll();
}

// 共用 shared/schedule.js 的屆數與場次排程函數

let lastRenderedBatchNumber = calcAutoBatchNumber(new Date());

function getSystemConfig() {
    const autoBatch = calcAutoBatchNumber(new Date());
    const raw = localStorage.getItem(SYSTEM_STATE_KEY) || '{}';
    let sys;
    if (raw === AdminMemoryCache.systemRaw && AdminMemoryCache.system) {
        sys = AdminMemoryCache.system;
    } else {
        try {
            sys = JSON.parse(raw);
        } catch (e) {
            sys = {};
        }
        AdminMemoryCache.systemRaw = raw;
        AdminMemoryCache.system = sys;
    }
    const batchOffset = Number(sys.batchOffset || 0);
    const effectiveBatch = Math.max(1, autoBatch + batchOffset);
    return {
        currentBatch: effectiveBatch,
        autoBatch: autoBatch,
        batchOffset: batchOffset,
        registrationOpen: sys.registrationOpen !== undefined ? Boolean(sys.registrationOpen) : true,
        profileLocked: sys.profileLocked !== undefined ? Boolean(sys.profileLocked) : false,
        genderLimitEnabled: sys.genderLimitEnabled !== undefined ? Boolean(sys.genderLimitEnabled) : false,
        genderLimitMax: sys.genderLimitMax !== undefined ? Math.max(1, Number(sys.genderLimitMax)) : 30
    };
}

function setSystemConfig(patch) {
    const current = getSystemConfig();
    const updated = { ...current, ...patch };
    const serialized = JSON.stringify(updated);
    AdminMemoryCache.systemRaw = serialized;
    AdminMemoryCache.system = updated;
    localStorage.setItem(SYSTEM_STATE_KEY, serialized);
    if (typeof CloudSync !== 'undefined') {
        if (CloudSync.initialized && typeof CloudSync.patchNode === 'function') {
            CloudSync.patchNode(SYSTEM_STATE_KEY, patch);
        } else {
            CloudSync.putNode(SYSTEM_STATE_KEY, updated);
        }
    }
    return updated;
}

function getCurrentBatch() {
    return getSystemConfig().currentBatch;
}

function setCurrentBatch(num) {
    const autoBatch = calcAutoBatchNumber(new Date());
    setSystemConfig({ batchOffset: Number(num) - autoBatch });
}

function toggleRegistrationSwitch() {
    const cfg = getSystemConfig();
    const nextState = !cfg.registrationOpen;
    setSystemConfig({ registrationOpen: nextState });
    const label = nextState ? '🟢 開始報名' : '🚫 人數已滿 不可報名';
    appendLog(`<span class="text-pink-300">[前台開關連動]</span> 活動報名狀態已切換為：<strong>${label}</strong>`);
    renderAdminAll();
}

function toggleProfileLockSwitch() {
    const cfg = getSystemConfig();
    const nextLock = !cfg.profileLocked;
    setSystemConfig({ profileLocked: nextLock });
    const label = nextLock ? '🔒 不讓玩家填寫資料（所有欄位反灰鎖定，隱私設定仍可修改）' : '🟢 開放填寫個人資料';
    appendLog(`<span class="text-amber-300">[前台開關連動]</span> 個人資料表單狀態已切換為：<strong>${label}</strong>`);
    renderAdminAll();
}

function toggleGenderLimitSwitch() {
    const cfg = getSystemConfig();
    const inputVal = Math.max(1, parseInt(document.getElementById('genderLimitMaxInput').value, 10) || cfg.genderLimitMax || 30);
    const nextEnabled = !cfg.genderLimitEnabled;
    setSystemConfig({ genderLimitEnabled: nextEnabled, genderLimitMax: inputVal });
    const label = nextEnabled
        ? `🟢 已開啟男生人數限制（男生上限 ${inputVal} 人 ／ 女生不限人數）`
        : '⚪ 已關閉男生人數限制（男女生皆不限制）';
    appendLog(`<span class="text-pink-300">[男生人數限制]</span> ${label}`);
    renderAdminAll();
}

function updateGenderLimitMax() {
    const rawVal = parseInt(document.getElementById('genderLimitMaxInput').value, 10);
    const validMax = (!isNaN(rawVal) && rawVal >= 1) ? rawVal : 30;
    document.getElementById('genderLimitMaxInput').value = validMax;
    setSystemConfig({ genderLimitMax: validMax });
    appendLog(`<span class="text-pink-300">[男生人數上限更新]</span> 男生人數上限已調整為 <strong>${validMax} 人</strong>（女生不限人數）。`);
    renderAdminAll();
}


// ==================== 🔑 玩家專屬固定唯一 5 碼英數備份／還原通行碼產生與複製（供玩家遺忘時提供） ====================
// 共用 shared/schema.js 的 5 碼英數通行碼演算法
function generatePlayerBackupCode(userObj, allUsers = null) {
    if (!userObj || !userObj.id) return '';
    return deriveFixedBackupCode(userObj.id);
}

async function copyTextToClipboardAdmin(textVal, successLabel = '已複製') {
    if (!textVal) return false;
    let copied = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(textVal);
            copied = true;
        }
    } catch (e) {}

    if (!copied) {
        const tmp = document.createElement('textarea');
        tmp.value = textVal;
        tmp.style.position = 'fixed';
        tmp.style.opacity = '0';
        document.body.appendChild(tmp);
        tmp.focus();
        tmp.select();
        try {
            copied = document.execCommand('copy');
        } catch (e) {}
        document.body.removeChild(tmp);
    }
    return copied;
}

async function copyPlayerBackupCode(playerId) {
    const users = getUsers();
    const u = users.find(item => String(item.id) === String(playerId));
    if (!u) return;

    const code = generatePlayerBackupCode(u, users);
    if (u.backupCode !== code) {
        u.backupCode = code;
        saveUsers(users);
    }

    const ok = await copyTextToClipboardAdmin(code);
    appendLog(`<span class="text-pink-300">[備份碼查詢]</span> 已取得玩家 <strong>${u.nickname} (ID:${u.id})</strong> 的 5 碼通行碼 <strong>${code}</strong>${ok ? ' 並複製到剪貼簿' : ''}。`);
    if (ok) {
        alert(`✅ 已複製玩家「${u.nickname} (ID:${u.id})」的 5 碼專屬通行碼：【${code}】\n\n可直接傳送給該玩家於前台「個人與隱私 → 備份/還原碼」輸入讀取紀錄。`);
    } else {
        viewPlayerDetail(playerId);
    }
}

function getUsers() {
    const raw = localStorage.getItem(USERS_KEY) || '[]';
    if (raw === AdminMemoryCache.usersRaw && Array.isArray(AdminMemoryCache.users)) {
        return AdminMemoryCache.users;
    }

    let users;
    try {
        users = JSON.parse(raw);
        if (!Array.isArray(users)) users = [];
    } catch (e) {
        users = [];
    }

    let migrated = false;
    const migratedUsersMap = new Map();
    users.forEach(u => {
        if (!u || typeof u !== 'object') return;
        let userMigrated = false;
        if (Array.isArray(u.registeredSessions)) {
            const norm = Array.from(new Set(u.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
            if (JSON.stringify(norm) !== JSON.stringify(u.registeredSessions)) {
                u.registeredSessions = norm;
                userMigrated = true;
            }
        } else {
            u.registeredSessions = [];
        }
        if (Object.prototype.hasOwnProperty.call(u, 'registeredSession')) {
            delete u.registeredSession;
            userMigrated = true;
        }
        if (u.matchedSession) {
            const normMatched = normalizeSessionLabel(u.matchedSession);
            if (normMatched !== u.matchedSession) {
                u.matchedSession = normMatched;
                userMigrated = true;
            }
        }
        if (Array.isArray(u.matchedHistory)) {
            u.matchedHistory.forEach(h => {
                if (h.session) {
                    const normHist = normalizeSessionLabel(h.session);
                    if (normHist !== h.session) {
                        h.session = normHist;
                        userMigrated = true;
                    }
                }
            });
        }
        if (u.id) {
            const expectedCode = generatePlayerBackupCode(u, users);
            if (expectedCode && u.backupCode !== expectedCode) {
                u.backupCode = expectedCode;
                userMigrated = true;
            }
        }
        if (userMigrated) {
            migrated = true;
            if (u.id) migratedUsersMap.set(String(u.id), u);
        }
    });
    if (migrated) {
        const nextRaw = JSON.stringify(users);
        AdminMemoryCache.usersRaw = nextRaw;
        AdminMemoryCache.users = users;
        localStorage.setItem(USERS_KEY, nextRaw);
        if (typeof CloudSync !== 'undefined' && CloudSync.initialized && CloudSync.inFlightWrites === 0) {
            migratedUsersMap.forEach(mu => {
                if (!CloudSync.isUserDeleted(mu.id)) {
                    CloudSync.upsertUser(mu, false, { isMatchMutation: false });
                }
            });
        }
    } else {
        AdminMemoryCache.usersRaw = raw;
        AdminMemoryCache.users = users;
    }
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.reconcileSymmetricMatches === 'function') {
        if (CloudSync.reconcileSymmetricMatches(users, false)) {
            const healedRaw = JSON.stringify(users);
            AdminMemoryCache.usersRaw = healedRaw;
            AdminMemoryCache.users = users;
            localStorage.setItem(USERS_KEY, healedRaw);
        }
    }
    return users;
}

function saveUsers(users, options = { isMatchMutation: false }) {
    if (Array.isArray(users)) {
        users.forEach(u => {
            if (u && u.id) {
                u.backupCode = generatePlayerBackupCode(u, users);
            }
        });
    }
    const nextRaw = JSON.stringify(users);
    AdminMemoryCache.usersRaw = nextRaw;
    AdminMemoryCache.users = users;
    localStorage.setItem(USERS_KEY, nextRaw);
    CloudSync.syncUsersArray(users, options);
    renderAdminAll(true);
}

function saveSingleUserPatch(users, targetUser, patchFields) {
    if (!targetUser || !targetUser.id) return;
    targetUser.backupCode = generatePlayerBackupCode(targetUser, users);
    const fullPatch = { ...patchFields, backupCode: targetUser.backupCode };
    const nextRaw = JSON.stringify(users);
    AdminMemoryCache.usersRaw = nextRaw;
    AdminMemoryCache.users = users;
    localStorage.setItem(USERS_KEY, nextRaw);
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.patchUserFields === 'function') {
        CloudSync.patchUserFields(targetUser.id, fullPatch, targetUser);
    } else if (typeof CloudSync !== 'undefined') {
        CloudSync.upsertUser(targetUser, false, { isMatchMutation: false });
    }
    renderAdminAll(true);
}

function getMailbox() {
    const raw = localStorage.getItem(MAILBOX_KEY) || '[]';
    if (raw === AdminMemoryCache.mailboxRaw && Array.isArray(AdminMemoryCache.mailbox)) {
        return AdminMemoryCache.mailbox;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) parsed = [];
    } catch (e) {
        parsed = [];
    }
    AdminMemoryCache.mailboxRaw = raw;
    AdminMemoryCache.mailbox = parsed;
    return parsed;
}

function saveMailbox(mails) {
    const nextRaw = JSON.stringify(mails);
    AdminMemoryCache.mailboxRaw = nextRaw;
    AdminMemoryCache.mailbox = mails;
    localStorage.setItem(MAILBOX_KEY, nextRaw);
    renderAdminAll(true);
}

function getAdminChatsMap() {
    const raw = localStorage.getItem(CHATS_KEY) || '{}';
    if (raw === AdminMemoryCache.chatsRaw && AdminMemoryCache.chats && typeof AdminMemoryCache.chats === 'object') {
        return AdminMemoryCache.chats;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
    } catch (e) {
        parsed = {};
    }
    AdminMemoryCache.chatsRaw = raw;
    AdminMemoryCache.chats = parsed;
    return parsed;
}

function getActivityRegHistory() {
    const keyName = (typeof REG_HISTORY_KEY !== 'undefined') ? REG_HISTORY_KEY : 'yuelao_activity_reg_history';
    const raw = localStorage.getItem(keyName) || '{}';
    if (raw === AdminMemoryCache.regHistoryRaw && AdminMemoryCache.regHistory && typeof AdminMemoryCache.regHistory === 'object') {
        return AdminMemoryCache.regHistory;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
    } catch (e) {
        parsed = {};
    }
    AdminMemoryCache.regHistoryRaw = raw;
    AdminMemoryCache.regHistory = parsed;
    return parsed;
}

function sendAdminMailboxMessage() {
    const rawTarget = document.getElementById('mailTargetPlayerId').value.trim();
    const title = document.getElementById('mailTitleInput').value.trim();
    const content = document.getElementById('mailContentInput').value.trim();

    if (!title || !content) {
        alert('請輸入信件標題與文字內容！');
        return;
    }

    const targetId = (!rawTarget || rawTarget.toUpperCase() === 'ALL') ? 'ALL' : rawTarget;
    const users = getUsers();
    const targetUser = targetId === 'ALL' ? null : users.find(u => String(u.id) === String(targetId));
    const targetLabel = targetId === 'ALL'
        ? '全體玩家'
        : (targetUser ? `${targetUser.nickname} (ID:${targetId})` : `玩家 ID:${targetId}`);

    const mails = getMailbox();
    const newMail = {
        id: 'MAIL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        targetId: targetId,
        targetLabel: targetLabel,
        title: title,
        content: content,
        ts: Date.now(),
        createdAt: new Date().toLocaleString('zh-TW')
    };
    mails.unshift(newMail);
    saveMailbox(mails);
    CloudSync.putNode(`${MAILBOX_KEY}/${newMail.id}`, newMail);

    document.getElementById('mailTitleInput').value = '';
    document.getElementById('mailContentInput').value = '';
    appendLog(`<span class="text-pink-300">[信件已發送]</span> 已發送信件「<strong>${title}</strong>」給 <strong>${targetLabel}</strong>，前台玩家可於信件欄位點開查看。`);
}

function deleteMailboxMessage(mailId) {
    saveMailbox(getMailbox().filter(m => m.id !== mailId));
    CloudSync.deleteNode(`${MAILBOX_KEY}/${mailId}`);
}

function getBannedRules() {
    const raw = localStorage.getItem(BANNED_RULES_KEY);
    if (!raw) {
        const initial = [{ id: 'BR_DEFAULT_1', field: 'ig', keyword: 'gak' }];
        const initRaw = JSON.stringify(initial);
        AdminMemoryCache.bannedRulesRaw = initRaw;
        AdminMemoryCache.bannedRules = initial;
        localStorage.setItem(BANNED_RULES_KEY, initRaw);
        return initial;
    }
    if (raw === AdminMemoryCache.bannedRulesRaw && Array.isArray(AdminMemoryCache.bannedRules)) {
        return AdminMemoryCache.bannedRules;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) parsed = [];
    } catch (e) {
        parsed = [];
    }
    AdminMemoryCache.bannedRulesRaw = raw;
    AdminMemoryCache.bannedRules = parsed;
    return parsed;
}

function saveBannedRules(rules) {
    const nextRaw = JSON.stringify(rules);
    AdminMemoryCache.bannedRulesRaw = nextRaw;
    AdminMemoryCache.bannedRules = rules;
    localStorage.setItem(BANNED_RULES_KEY, nextRaw);
    CloudSync.putNode(BANNED_RULES_KEY, rules);
    renderAdminAll(true);
}

function getForceRules() {
    const raw = localStorage.getItem(FORCE_KEY) || '[]';
    if (raw === AdminMemoryCache.forceRulesRaw && Array.isArray(AdminMemoryCache.forceRules)) {
        return AdminMemoryCache.forceRules;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) parsed = [];
    } catch (e) {
        parsed = [];
    }
    AdminMemoryCache.forceRulesRaw = raw;
    AdminMemoryCache.forceRules = parsed;
    return parsed;
}

function saveForceRules(rules) {
    const nextRaw = JSON.stringify(rules);
    AdminMemoryCache.forceRulesRaw = nextRaw;
    AdminMemoryCache.forceRules = rules;
    localStorage.setItem(FORCE_KEY, nextRaw);
    CloudSync.putNode(FORCE_KEY, rules);
    renderAdminAll(true);
}

function getReports() {
    const raw = localStorage.getItem(REPORTS_KEY) || '[]';
    if (raw === AdminMemoryCache.reportsRaw && Array.isArray(AdminMemoryCache.reports)) {
        return AdminMemoryCache.reports;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) parsed = [];
    } catch (e) {
        parsed = [];
    }
    AdminMemoryCache.reportsRaw = raw;
    AdminMemoryCache.reports = parsed;
    return parsed;
}

function appendLog(html) {
    // 20:00 自動配對演算法執行日誌區塊已移除，保留空函式以相容其他模組的呼叫
}

function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}


const ADMIN_AUTH_KEY = 'yuelao_admin_auth';
const VALID_ADMIN_USER = 'roy';
const VALID_ADMIN_PASS = 'tff456';

function isAdminAuthenticated() {
    return sessionStorage.getItem(ADMIN_AUTH_KEY) === 'roy_authenticated';
}

async function unlockAdminUI() {
    document.getElementById('adminLoginOverlay').classList.add('hidden');
    document.getElementById('adminMainContent').classList.remove('hidden');
    // 多頁面架構已改由左側選單切換頁面
    await CloudSync.init(() => {
        renderAdminAll();
    });
    checkAutoSchedule2000();
    renderAdminAll();
}

async function handleAdminLogin(e) {
    e.preventDefault();
    const acc = document.getElementById('adminLoginAccount').value.trim();
    const pwd = document.getElementById('adminLoginPassword').value;
    const errBox = document.getElementById('adminLoginError');

    if (acc === VALID_ADMIN_USER && pwd === VALID_ADMIN_PASS) {
        errBox.classList.add('hidden');
        sessionStorage.setItem(ADMIN_AUTH_KEY, 'roy_authenticated');
        unlockAdminUI();
    } else {
        errBox.classList.remove('hidden');
        document.getElementById('adminLoginPassword').value = '';
        document.getElementById('adminLoginPassword').focus();

        // 記錄登入失敗日誌（包含嘗試取得當前 IP）
        try {
            let ip = 'Unknown IP';
            try {
                const res = await fetch('https://api.ipify.org?format=json');
                if (res.ok) {
                    const data = await res.json();
                    ip = data.ip || 'Unknown IP';
                }
            } catch (err) {
                console.warn('Failed to fetch IP', err);
            }
            
            const logEntry = {
                id: 'AL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                accountTried: acc,
                ipAddress: ip,
                userAgent: navigator.userAgent || 'Unknown Browser',
                ts: Date.now(),
                createdAt: new Date().toLocaleString('zh-TW')
            };

            const logs = JSON.parse(localStorage.getItem('yuelao_admin_login_logs') || '[]');
            logs.unshift(logEntry);
            // 只保留最近 10 筆失敗紀錄（同步清理雲端與本地超過 10 筆的舊紀錄）
            const removedLogs = logs.length > 10 ? logs.slice(10) : [];
            const keptLogs = logs.slice(0, 10);
            localStorage.setItem('yuelao_admin_login_logs', JSON.stringify(keptLogs));
            
            if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
                CloudSync.putNode(`yuelao_admin_login_logs/${logEntry.id}`, logEntry);
                removedLogs.forEach(oldItem => {
                    if (oldItem && oldItem.id) {
                        CloudSync.deleteNode(`yuelao_admin_login_logs/${oldItem.id}`);
                    }
                });
            }
        } catch (logErr) {}
    }
}

function logoutAdmin() {
    sessionStorage.removeItem(ADMIN_AUTH_KEY);
    const mainEl = document.getElementById('adminMainContent');
    if (mainEl) mainEl.classList.add('hidden');
    const pBody = document.getElementById('playersTableBody');
    if (pBody) pBody.innerHTML = '';
    const rBody = document.getElementById('reportsTableBody');
    if (rBody) rBody.innerHTML = '';
    const accEl = document.getElementById('adminLoginAccount');
    if (accEl) accEl.value = '';
    const pwdEl = document.getElementById('adminLoginPassword');
    if (pwdEl) pwdEl.value = '';
    const errEl = document.getElementById('adminLoginError');
    if (errEl) errEl.classList.add('hidden');
    const overlayEl = document.getElementById('adminLoginOverlay');
    if (overlayEl) overlayEl.classList.remove('hidden');
}

function pollSharedStorageChanges() {
    if (!isAdminAuthenticated()) return;
    if (typeof CloudSync !== 'undefined' && !CloudSync.initialized) return;
    const curUsers = localStorage.getItem(USERS_KEY) || '';
    const curReports = localStorage.getItem(REPORTS_KEY) || '';
    const curSys = localStorage.getItem(SYSTEM_STATE_KEY) || '';
    const curChats = localStorage.getItem(CHATS_KEY) || '';
    const curMatchLogs = localStorage.getItem(MATCH_LOGS_KEY) || '';
    const curBatch = getCurrentBatch();
    if (curUsers !== lastUsersSnapshot || curReports !== lastReportsSnapshot || curSys !== lastSystemSnapshot || curChats !== lastChatsAdminSnapshot || curMatchLogs !== lastMatchLogsAdminSnapshot || curBatch !== lastRenderedBatchNumber) {
        renderAdminAll(false);
    }
}

window.addEventListener('storage', (e) => {
    if (!isAdminAuthenticated()) return;
    if (typeof CloudSync !== 'undefined' && !CloudSync.initialized) return;
    if ([USERS_KEY, REPORTS_KEY, SYSTEM_STATE_KEY, MAILBOX_KEY, CUSTOM_ACTIVITIES_KEY, CHATS_KEY, REG_HISTORY_KEY, 'yuelao_admin_login_logs', MATCH_LOGS_KEY].includes(e.key)) {
        renderAdminAll(false);
    }
});

window.addEventListener('focus', pollSharedStorageChanges);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollSharedStorageChanges();
});

setInterval(() => {
    if (!isAdminAuthenticated()) return;
    if (typeof CloudSync !== 'undefined' && !CloudSync.initialized) return;
    checkAutoSchedule2000();
    pollSharedStorageChanges();
}, 1000);

// 由 backend/layout.js 渲染側邊欄骨架後自動檢查登入狀態


function renderAdminSharedOverview(forceUpdate = false) {
    lastUsersSnapshot = localStorage.getItem(USERS_KEY) || '';
    lastReportsSnapshot = localStorage.getItem(REPORTS_KEY) || '';
    lastSystemSnapshot = localStorage.getItem(SYSTEM_STATE_KEY) || '';
    lastChatsAdminSnapshot = localStorage.getItem(CHATS_KEY) || '';
    lastMatchLogsAdminSnapshot = localStorage.getItem(MATCH_LOGS_KEY) || '';

    const sysCfg = getSystemConfig();
    const batch = sysCfg.currentBatch;
    lastRenderedBatchNumber = batch;
    const currentSched = getBatchScheduleInfo(batch);
    const users = getUsers();
    const reports = getReports();
    const chatsMap = getAdminChatsMap();
    const customActsList = (typeof getCustomActivities === 'function')
        ? getCustomActivities()
        : JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');

    const regCount = users.filter(u => (Array.isArray(u.registeredSessions) && u.registeredSessions.length > 0) || (u.customActivityRegs && Object.keys(u.customActivityRegs).length > 0)).length;
    const totalHistoryLinks = users.reduce((acc, u) => acc + (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0 ? u.matchedHistory.length : (u.matchedWithId ? 1 : 0)), 0);
    const matchedPairs = Math.floor(totalHistoryLinks / 2);
    const openCustomActs = customActsList.filter(a => Boolean(a && a.isOpen)).length;
    const pendingReps = reports.filter(r => r && r.status === '待處理').length;
    const activeChatRooms = Object.keys(chatsMap).filter(k => Array.isArray(chatsMap[k]) && chatsMap[k].length > 0).length;

    const overviewSig = `${currentSched.batchPrefix}|${users.length}|${regCount}|${matchedPairs}|${reports.length}|${customActsList.length}|${openCustomActs}|${pendingReps}|${activeChatRooms}`;
    if (!forceUpdate && overviewSig === lastOverviewRenderSig) {
        return;
    }
    lastOverviewRenderSig = overviewSig;

    const batchBadge = document.getElementById('adminCurrentBatchBadge');
    if (batchBadge) {
        batchBadge.textContent = `目前系統：${currentSched.batchPrefix}（${currentSched.wedDateStr}(三) / ${currentSched.satDateStr}(六)）`;
    }

    const statTotalEl = document.getElementById('statTotal');
    if (statTotalEl) statTotalEl.textContent = `${users.length} 人`;

    const statRegEl = document.getElementById('statRegistered');
    if (statRegEl) statRegEl.textContent = `${regCount} 人`;

    const statMatchedEl = document.getElementById('statMatched');
    if (statMatchedEl) statMatchedEl.textContent = `${matchedPairs} 對`;

    const statRepEl = document.getElementById('statReports');
    if (statRepEl) statRepEl.textContent = `${reports.length} 則`;

    // Update Sidebar badges
    const customBadge = document.getElementById('sidebarCustomActBadge');
    if (customBadge) {
        if (customActsList.length > 0) {
            customBadge.textContent = openCustomActs > 0 ? `${openCustomActs} 開啟` : `${customActsList.length}`;
            customBadge.classList.remove('hidden');
        } else {
            customBadge.classList.add('hidden');
        }
    }

    const chatBadge = document.getElementById('sidebarChatRoomsBadge');
    if (chatBadge) {
        if (activeChatRooms > 0) {
            chatBadge.textContent = `${activeChatRooms}`;
            chatBadge.classList.remove('hidden');
        } else {
            chatBadge.classList.add('hidden');
        }
    }

    const repBadge = document.getElementById('sidebarPendingReportsBadge');
    if (repBadge) {
        if (pendingReps > 0) {
            repBadge.textContent = `${pendingReps}`;
            repBadge.classList.remove('hidden');
        } else {
            repBadge.classList.add('hidden');
        }
    }
}

function renderAdminAll(forceUpdate = false) {
    if (typeof renderAdminSharedOverview === 'function') {
        renderAdminSharedOverview(forceUpdate);
    }

    const sysCfg = getSystemConfig();
    const batch = sysCfg.currentBatch;
    const currentSched = getBatchScheduleInfo(batch);
    const users = getUsers();

    let maxUserBatch = 1;
    users.forEach(u => {
        (u.registeredSessions || []).forEach(s => {
            const m = String(s || '').match(/^第\s*(\d+)\s*屆/);
            if (m) maxUserBatch = Math.max(maxUserBatch, parseInt(m[1], 10));
        });
    });
    const regHistMap = getActivityRegHistory();
    Object.values(regHistMap).forEach(rec => {
        if (rec && rec.kind === 'regular' && rec.session) {
            const m = String(rec.session).match(/^第\s*(\d+)\s*屆/);
            if (m) maxUserBatch = Math.max(maxUserBatch, parseInt(m[1], 10));
        }
    });
    const maxDisplayBatch = Math.max(4, batch + 2, maxUserBatch);

    if (typeof renderMemberPageSection === 'function') {
        renderMemberPageSection(users, sysCfg, batch, currentSched, maxDisplayBatch, forceUpdate);
    }
    if (typeof renderActivitiesPageSection === 'function') {
        renderActivitiesPageSection(users, batch, maxDisplayBatch);
    }
    if (typeof renderChatsPageSection === 'function') {
        renderChatsPageSection(users, forceUpdate);
    }
    if (typeof renderOpsPageSection === 'function') {
        renderOpsPageSection(batch, currentSched, maxDisplayBatch);
    }
    if (typeof renderLogsPageSection === 'function') {
        renderLogsPageSection();
    }
}
