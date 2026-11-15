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
let rosterPageSize = '5';
let currentRosterPage = 1;

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
    const sys = JSON.parse(localStorage.getItem(SYSTEM_STATE_KEY) || '{}');
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
    localStorage.setItem(SYSTEM_STATE_KEY, JSON.stringify(updated));
    CloudSync.putNode(SYSTEM_STATE_KEY, updated);
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
        ? `🟢 已開啟男女生人數限制（男上限 ${inputVal} 人 / 女上限 ${inputVal} 人）`
        : '⚪ 已關閉男女生人數限制';
    appendLog(`<span class="text-pink-300">[男女生人數限制]</span> ${label}`);
    renderAdminAll();
}

function updateGenderLimitMax() {
    const rawVal = parseInt(document.getElementById('genderLimitMaxInput').value, 10);
    const validMax = (!isNaN(rawVal) && rawVal >= 1) ? rawVal : 30;
    document.getElementById('genderLimitMaxInput').value = validMax;
    setSystemConfig({ genderLimitMax: validMax });
    appendLog(`<span class="text-pink-300">[男女生人數上限更新]</span> 男 / 女各自上限人數已調整為 <strong>${validMax} 人</strong>。`);
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
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    let migrated = false;
    users.forEach(u => {
        if (Array.isArray(u.registeredSessions)) {
            const norm = Array.from(new Set(u.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
            if (JSON.stringify(norm) !== JSON.stringify(u.registeredSessions)) {
                u.registeredSessions = norm;
                migrated = true;
            }
        } else {
            u.registeredSessions = [];
        }
        if (Object.prototype.hasOwnProperty.call(u, 'registeredSession')) {
            delete u.registeredSession;
            migrated = true;
        }
        if (u.matchedSession) {
            const normMatched = normalizeSessionLabel(u.matchedSession);
            if (normMatched !== u.matchedSession) {
                u.matchedSession = normMatched;
                migrated = true;
            }
        }
        if (Array.isArray(u.matchedHistory)) {
            u.matchedHistory.forEach(h => {
                if (h.session) {
                    const normHist = normalizeSessionLabel(h.session);
                    if (normHist !== h.session) {
                        h.session = normHist;
                        migrated = true;
                    }
                }
            });
        }
    });
    users.forEach(u => {
        if (u && u.id) {
            const expectedCode = generatePlayerBackupCode(u, users);
            if (expectedCode && u.backupCode !== expectedCode) {
                u.backupCode = expectedCode;
                migrated = true;
            }
        }
    });
    if (migrated) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
        if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
            CloudSync.syncUsersArray(users);
        }
    }
    return users;
}

function saveUsers(users) {
    if (Array.isArray(users)) {
        users.forEach(u => {
            if (u && u.id) {
                u.backupCode = generatePlayerBackupCode(u, users);
            }
        });
    }
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    CloudSync.syncUsersArray(users);
    renderAdminAll();
}

function getMailbox() {
    return JSON.parse(localStorage.getItem(MAILBOX_KEY) || '[]');
}

function saveMailbox(mails) {
    localStorage.setItem(MAILBOX_KEY, JSON.stringify(mails));
    renderAdminAll();
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
        localStorage.setItem(BANNED_RULES_KEY, JSON.stringify(initial));
        return initial;
    }
    return JSON.parse(raw);
}

function saveBannedRules(rules) {
    localStorage.setItem(BANNED_RULES_KEY, JSON.stringify(rules));
    CloudSync.putNode(BANNED_RULES_KEY, rules);
    renderAdminAll();
}

function getForceRules() {
    return JSON.parse(localStorage.getItem(FORCE_KEY) || '[]');
}

function saveForceRules(rules) {
    localStorage.setItem(FORCE_KEY, JSON.stringify(rules));
    CloudSync.putNode(FORCE_KEY, rules);
    renderAdminAll();
}

function getReports() {
    return JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
}

function appendLog(html) {
    const box = document.getElementById('matchLogs');
    if (!box) return;
    const div = document.createElement('div');
    div.innerHTML = html;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

let clearAllPasswordVerified = false;

function clearAllAdminData() {
    clearAllPasswordVerified = false;
    const modal = document.getElementById('clearAllConfirmModal');
    if (modal) {
        const step1 = document.getElementById('clearAllStep1');
        const step2 = document.getElementById('clearAllStep2');
        const passInput = document.getElementById('clearAllAdminPassInput');
        const errBox = document.getElementById('clearAllPassError');
        if (step1) step1.classList.remove('hidden');
        if (step2) step2.classList.add('hidden');
        if (passInput) passInput.value = '';
        if (errBox) errBox.classList.add('hidden');
        modal.classList.remove('hidden');
        if (passInput) setTimeout(() => passInput.focus(), 50);
        return;
    }

    // 備援驗證流程（若無彈窗元素時）
    const inputPwd = prompt('【第一關安全驗證】請輸入管理員密碼以清空全部資料：');
    if (inputPwd === null) return;
    if (inputPwd !== VALID_ADMIN_PASS) {
        alert('🚫 管理員密碼錯誤，無法執行清空全部資料！');
        return;
    }
    if (!confirm('⚠️【二次確定】密碼驗證通過！確定要永久清空所有玩家、秘密規則、信件與問題回報資料嗎？此動作無法復原！')) {
        return;
    }
    executeClearAllAdminDataConfirmed(true);
}

function closeClearAllConfirmModal() {
    clearAllPasswordVerified = false;
    const modal = document.getElementById('clearAllConfirmModal');
    if (modal) modal.classList.add('hidden');
}

function verifyClearAllPassword() {
    const passInput = document.getElementById('clearAllAdminPassInput');
    const errBox = document.getElementById('clearAllPassError');
    const pwd = passInput ? passInput.value : '';

    if (pwd !== VALID_ADMIN_PASS) {
        clearAllPasswordVerified = false;
        if (errBox) errBox.classList.remove('hidden');
        if (passInput) {
            passInput.value = '';
            passInput.focus();
        }
        return;
    }

    clearAllPasswordVerified = true;
    if (errBox) errBox.classList.add('hidden');
    const step1 = document.getElementById('clearAllStep1');
    const step2 = document.getElementById('clearAllStep2');
    if (step1) step1.classList.add('hidden');
    if (step2) step2.classList.remove('hidden');
}

function backToClearAllStep1() {
    clearAllPasswordVerified = false;
    const step1 = document.getElementById('clearAllStep1');
    const step2 = document.getElementById('clearAllStep2');
    const passInput = document.getElementById('clearAllAdminPassInput');
    if (step2) step2.classList.add('hidden');
    if (step1) step1.classList.remove('hidden');
    if (passInput) {
        passInput.value = '';
        passInput.focus();
    }
}

function executeClearAllAdminDataConfirmed(bypassModalFlag = false) {
    if (!bypassModalFlag && !clearAllPasswordVerified) {
        alert('🚫 尚未通過管理員密碼驗證！');
        return;
    }

    localStorage.removeItem(USERS_KEY);
    localStorage.removeItem(REPORTS_KEY);
    localStorage.removeItem(FORCE_KEY);
    localStorage.removeItem('yuelao_id_counters');
    localStorage.removeItem(SYSTEM_STATE_KEY);
    localStorage.removeItem(AUTO_RUN_LOG_KEY);
    localStorage.removeItem(BANNED_RULES_KEY);
    localStorage.removeItem(MAILBOX_KEY);
    localStorage.removeItem(CHATS_KEY);
    localStorage.removeItem(CUSTOM_ACTIVITIES_KEY);
    CloudSync.clearAll();

    closeClearAllConfirmModal();
    const logsBox = document.getElementById('matchLogs');
    if (logsBox) {
        logsBox.innerHTML = '<div class="text-pink-300/70">[系統就緒] 已通過管理員密碼驗證並完成二次確定，全部資料已清空...</div>';
    }
    renderAdminAll();
    alert('✅ 已通過密碼驗證並完成二次確定，全部資料已清空！');
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

function handleAdminLogin(e) {
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
    const curUsers = localStorage.getItem(USERS_KEY) || '';
    const curReports = localStorage.getItem(REPORTS_KEY) || '';
    const curSys = localStorage.getItem(SYSTEM_STATE_KEY) || '';
    const curBatch = getCurrentBatch();
    if (curUsers !== lastUsersSnapshot || curReports !== lastReportsSnapshot || curSys !== lastSystemSnapshot || curBatch !== lastRenderedBatchNumber) {
        renderAdminAll();
    }
}

window.addEventListener('storage', (e) => {
    if (!isAdminAuthenticated()) return;
    if ([USERS_KEY, REPORTS_KEY, SYSTEM_STATE_KEY, MAILBOX_KEY, CUSTOM_ACTIVITIES_KEY].includes(e.key)) {
        renderAdminAll();
    }
});

window.addEventListener('focus', pollSharedStorageChanges);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollSharedStorageChanges();
});

setInterval(() => {
    if (!isAdminAuthenticated()) return;
    checkAutoSchedule2000();
    pollSharedStorageChanges();
}, 1000);

// 由 backend/layout.js 渲染側邊欄骨架後自動檢查登入狀態


function renderAdminSharedOverview() {
    lastUsersSnapshot = localStorage.getItem(USERS_KEY) || '';
    lastReportsSnapshot = localStorage.getItem(REPORTS_KEY) || '';
    lastSystemSnapshot = localStorage.getItem(SYSTEM_STATE_KEY) || '';

    const sysCfg = getSystemConfig();
    const batch = sysCfg.currentBatch;
    lastRenderedBatchNumber = batch;
    const currentSched = getBatchScheduleInfo(batch);
    const users = getUsers();
    const reports = getReports();
    const customActsList = (typeof getCustomActivities === 'function')
        ? getCustomActivities()
        : JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');

    const batchBadge = document.getElementById('adminCurrentBatchBadge');
    if (batchBadge) {
        batchBadge.textContent = `目前系統：${currentSched.batchPrefix}（${currentSched.wedDateStr}(三) / ${currentSched.satDateStr}(六)）`;
    }

    const statTotalEl = document.getElementById('statTotal');
    if (statTotalEl) statTotalEl.textContent = `${users.length} 人`;

    const statRegEl = document.getElementById('statRegistered');
    if (statRegEl) {
        statRegEl.textContent = `${users.filter(u => (Array.isArray(u.registeredSessions) && u.registeredSessions.length > 0) || (u.customActivityRegs && Object.keys(u.customActivityRegs).length > 0)).length} 人`;
    }

    const statMatchedEl = document.getElementById('statMatched');
    if (statMatchedEl) {
        const totalHistoryLinks = users.reduce((acc, u) => acc + (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0 ? u.matchedHistory.length : (u.matchedWithId ? 1 : 0)), 0);
        statMatchedEl.textContent = `${Math.floor(totalHistoryLinks / 2)} 對`;
    }

    const statRepEl = document.getElementById('statReports');
    if (statRepEl) statRepEl.textContent = `${reports.length} 則`;

    // Update Sidebar badges
    const customBadge = document.getElementById('sidebarCustomActBadge');
    if (customBadge) {
        const openCount = customActsList.filter(a => Boolean(a && a.isOpen)).length;
        if (customActsList.length > 0) {
            customBadge.textContent = openCount > 0 ? `${openCount} 開啟` : `${customActsList.length}`;
            customBadge.classList.remove('hidden');
        } else {
            customBadge.classList.add('hidden');
        }
    }

    const repBadge = document.getElementById('sidebarPendingReportsBadge');
    if (repBadge) {
        const pendingReps = reports.filter(r => r && r.status === '待處理').length;
        if (pendingReps > 0) {
            repBadge.textContent = `${pendingReps}`;
            repBadge.classList.remove('hidden');
        } else {
            repBadge.classList.add('hidden');
        }
    }
}

function renderAdminAll() {
    if (typeof renderAdminSharedOverview === 'function') {
        renderAdminSharedOverview();
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
    const maxDisplayBatch = Math.max(4, batch + 2, maxUserBatch);

    if (typeof renderMemberPageSection === 'function') {
        renderMemberPageSection(users, sysCfg, batch, currentSched, maxDisplayBatch);
    }
    if (typeof renderActivitiesPageSection === 'function') {
        renderActivitiesPageSection(users, batch, maxDisplayBatch);
    }
    if (typeof renderOpsPageSection === 'function') {
        renderOpsPageSection(batch, currentSched, maxDisplayBatch);
    }
}
