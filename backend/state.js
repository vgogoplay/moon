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
let lastFateWallAdminSnapshot = '';
let lastWishWallAdminSnapshot = '';
let lastMailboxAdminSnapshot = '';
let lastSessionMatchResultsSnapshot = '';
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
    fateWallRaw: null,
    fateWall: null,
    bannedRulesRaw: null,
    bannedRules: null,
    forceRulesRaw: null,
    forceRules: null,
    chatsRaw: null,
    chats: null,
    regHistoryRaw: null,
    regHistory: null,
    wishWallRaw: null,
    wishWall: null,
    matchLogsRaw: null,
    matchLogs: null,
    invalidate(key) {
        if (!key) {
            this.usersRaw = this.reportsRaw = this.systemRaw = this.mailboxRaw = this.fateWallRaw = this.bannedRulesRaw = this.forceRulesRaw = this.chatsRaw = this.regHistoryRaw = this.wishWallRaw = this.matchLogsRaw = null;
            this.users = this.reports = this.system = this.mailbox = this.fateWall = this.bannedRules = this.forceRules = this.chats = this.regHistory = this.wishWall = this.matchLogs = null;
            this.chatsTreeVersion = -1;
            return;
        }
        this[key + 'Raw'] = null;
        this[key] = null;
        if (key === 'chats') {
            this.chatsTreeVersion = -1;
        }
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
        genderLimitMax: sys.genderLimitMax !== undefined ? Math.max(1, Number(sys.genderLimitMax)) : 30,
        wishEarlyCloseCanMatch: sys.wishEarlyCloseCanMatch !== undefined ? Boolean(sys.wishEarlyCloseCanMatch) : true
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

function toggleWishEarlyCloseCanMatch() {
    const cfg = getSystemConfig();
    const nextVal = !cfg.wishEarlyCloseCanMatch;
    setSystemConfig({ wishEarlyCloseCanMatch: nextVal });
    const label = nextVal
        ? '🟢 可進行好友配對（玩家提前結束題目後，仍可挑選匿名答案配對成好友）'
        : '🚫 不可進行好友配對（玩家提前結束題目後，直接結束本輪不開放配對）';
    appendLog(`<span class="text-pink-300">[紅線祈願牆設定]</span> 前台提前結束配對權限已切換為：<strong>${label}</strong>`);
    renderAdminAll(true);
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
            const normMatched = String(u.matchedSession).includes('強制')
                ? String(u.matchedSession).trim()
                : normalizeSessionLabel(u.matchedSession);
            if (normMatched !== u.matchedSession) {
                u.matchedSession = normMatched;
                userMigrated = true;
            }
        }
        if (Array.isArray(u.matchedHistory)) {
            u.matchedHistory.forEach(h => {
                if (!h || typeof h !== 'object') return;
                const isForceProtected = Boolean(
                    h.isForceRepaired ||
                    String(h.session || '').includes('強制') ||
                    String(h.matchDetail || '').includes('強制')
                );
                if (isForceProtected) {
                    h.isForceRepaired = true;
                    if (!h.matchDetail) h.matchDetail = '・強制補齊';
                }
                if (h.session) {
                    const normHist = isForceProtected
                        ? String(h.session).trim()
                        : normalizeSessionLabel(h.session);
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

function getAdminChatsStorageKey() {
    return (typeof ADMIN_CHATS_KEY !== 'undefined') ? ADMIN_CHATS_KEY : 'yuelao_admin_chats';
}

function getAdminChatsMap() {
    if (
        typeof CloudSync !== 'undefined' &&
        CloudSync.initialized &&
        CloudSync.hasLoadedFullTree &&
        CloudSync.tree &&
        CloudSync.tree[CHATS_KEY] &&
        typeof CloudSync.tree[CHATS_KEY] === 'object'
    ) {
        const ver = Number(CloudSync.chatsTreeVersion || 0);
        if (AdminMemoryCache.chatsTreeVersion === ver && AdminMemoryCache.chats && typeof AdminMemoryCache.chats === 'object') {
            return AdminMemoryCache.chats;
        }
        const liveMap = (typeof CloudSync.chatsMapToLocal === 'function')
            ? CloudSync.chatsMapToLocal(CloudSync.tree[CHATS_KEY])
            : CloudSync.tree[CHATS_KEY];
        AdminMemoryCache.chatsTreeVersion = ver;
        AdminMemoryCache.chats = liveMap;
        return liveMap;
    }

    const adminKey = getAdminChatsStorageKey();
    let raw = localStorage.getItem(adminKey);
    if (raw === null) {
        raw = localStorage.getItem(CHATS_KEY) || '{}';
    }
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
        isReadByTarget: false,
        readAtTs: null,
        readAtStr: '',
        ts: Date.now(),
        createdAt: new Date().toLocaleString('zh-TW')
    };
    mails.unshift(newMail);
    saveMailbox(mails);
    CloudSync.putNode(`${MAILBOX_KEY}/${newMail.id}`, newMail);
    if (typeof checkSinglePlayerMailReadStatusDaily === 'function') {
        checkSinglePlayerMailReadStatusDaily({ force: true, skipRemoteFetch: true });
    }

    document.getElementById('mailTitleInput').value = '';
    document.getElementById('mailContentInput').value = '';
    appendLog(`<span class="text-pink-300">[信件已發送]</span> 已發送信件「<strong>${title}</strong>」給 <strong>${targetLabel}</strong>，前台玩家可於信件欄位點開查看。`);
}

function openEditAdminMailboxModal(mailId) {
    const mid = String(mailId || '').trim();
    if (!mid) return;
    const target = getMailbox().find(m => String(m.id) === mid);
    if (!target) return;

    const modal = document.getElementById('editMailboxModal');
    const idInput = document.getElementById('editMailTargetMailId');
    const recipientInput = document.getElementById('editMailRecipientInput');
    const titleInput = document.getElementById('editMailTitleInput');
    const contentInput = document.getElementById('editMailContentInput');
    if (!modal || !idInput || !titleInput || !contentInput) return;

    idInput.value = mid;
    if (recipientInput) recipientInput.value = String(target.targetId || 'ALL');
    titleInput.value = String(target.title || '');
    contentInput.value = String(target.content || '');
    modal.classList.remove('hidden');
    setTimeout(() => {
        contentInput.focus();
        contentInput.select();
    }, 40);
}

function closeEditAdminMailboxModal() {
    const modal = document.getElementById('editMailboxModal');
    if (modal) modal.classList.add('hidden');
}

function saveEditedAdminMailboxMessage(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const mid = String(document.getElementById('editMailTargetMailId')?.value || '').trim();
    const recipientInput = document.getElementById('editMailRecipientInput');
    const titleInput = document.getElementById('editMailTitleInput');
    const contentInput = document.getElementById('editMailContentInput');
    if (!mid || !titleInput || !contentInput) return;

    const rawTarget = (recipientInput ? recipientInput.value.trim() : '') || 'ALL';
    const nextTargetId = rawTarget.toUpperCase() === 'ALL' ? 'ALL' : rawTarget;
    const nextTitle = titleInput.value.trim();
    const nextContent = contentInput.value.trim();

    if (!nextTitle || !nextContent) {
        alert('請輸入信件標題與文字內容！');
        if (!nextTitle) titleInput.focus();
        else contentInput.focus();
        return;
    }

    const mails = getMailbox();
    const idx = mails.findIndex(m => String(m.id) === mid);
    if (idx < 0) {
        closeEditAdminMailboxModal();
        return;
    }

    const users = getUsers();
    const targetUser = nextTargetId === 'ALL' ? null : users.find(u => String(u.id) === String(nextTargetId));
    const nextTargetLabel = nextTargetId === 'ALL'
        ? '全體玩家'
        : (targetUser ? `${targetUser.nickname} (ID:${nextTargetId})` : `玩家 ID:${nextTargetId}`);
    const updatedAtStr = new Date().toLocaleString('zh-TW');

    const recipientChanged = String(mails[idx].targetId || '') !== String(nextTargetId);
    const nextReadState = recipientChanged
        ? { isReadByTarget: false, readByPlayerId: null, readByPlayerName: null, readAtTs: null, readAtStr: '' }
        : {
            isReadByTarget: Boolean(mails[idx].isReadByTarget),
            readByPlayerId: mails[idx].readByPlayerId || null,
            readByPlayerName: mails[idx].readByPlayerName || null,
            readAtTs: mails[idx].readAtTs || null,
            readAtStr: mails[idx].readAtStr || ''
        };

    mails[idx] = {
        ...mails[idx],
        targetId: nextTargetId,
        targetLabel: nextTargetLabel,
        title: nextTitle,
        content: nextContent,
        ...nextReadState,
        updatedAt: updatedAtStr
    };
    saveMailbox(mails);

    if (typeof CloudSync !== 'undefined') {
        if (CloudSync.initialized && typeof CloudSync.patchNode === 'function') {
            CloudSync.patchNode(`${MAILBOX_KEY}/${mid}`, {
                targetId: nextTargetId,
                targetLabel: nextTargetLabel,
                title: nextTitle,
                content: nextContent,
                ...nextReadState,
                updatedAt: updatedAtStr
            });
        } else {
            CloudSync.putNode(`${MAILBOX_KEY}/${mid}`, mails[idx]);
        }
    }
    if (typeof checkSinglePlayerMailReadStatusDaily === 'function') {
        checkSinglePlayerMailReadStatusDaily({ force: true, skipRemoteFetch: true });
    }

    closeEditAdminMailboxModal();
    appendLog(`<span class="text-sky-300">[編輯信件內容]</span> 已更新發送給 <strong>${nextTargetLabel}</strong> 的信件「<strong>${nextTitle}</strong>」，並同步至前台玩家信箱。`);
}

function deleteMailboxMessage(mailId) {
    saveMailbox(getMailbox().filter(m => m.id !== mailId));
    CloudSync.deleteNode(`${MAILBOX_KEY}/${mailId}`);
    if (typeof checkSinglePlayerMailReadStatusDaily === 'function') {
        checkSinglePlayerMailReadStatusDaily({ force: true, skipRemoteFetch: true });
    }
}

const DAILY_MAIL_READ_CHECK_DAY_KEY = 'yuelao_last_daily_mail_read_check_day';
const DAILY_MAIL_READ_CHECK_REPORT_KEY = 'yuelao_daily_mail_read_check_report';

function getDailySingleMailReadReport() {
    try {
        const raw = localStorage.getItem(DAILY_MAIL_READ_CHECK_REPORT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (e) {
        return null;
    }
}

async function checkSinglePlayerMailReadStatusDaily(options = {}) {
    const { force = false, skipRemoteFetch = false } = options;
    const nowTs = Date.now();
    const todayStr = new Date(nowTs).toDateString();

    if (!force) {
        try {
            if (localStorage.getItem(DAILY_MAIL_READ_CHECK_DAY_KEY) === todayStr) {
                return getDailySingleMailReadReport();
            }
        } catch (e) {}
    }

    if (!skipRemoteFetch && typeof CloudSync !== 'undefined' && CloudSync.dbUrl && CloudSync.inFlightWrites === 0) {
        try {
            const encodedMailPath = CloudSync.encodePath(MAILBOX_KEY);
            const res = await fetch(`${CloudSync.dbUrl}/${encodedMailPath}.json${CloudSync.authQuery()}`, { method: 'GET', cache: 'no-store' });
            if (res.ok) {
                const remoteMailRaw = await res.json();
                const remoteMails = CloudSync.mapToArray(remoteMailRaw);
                remoteMails.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
                const nextMailJson = JSON.stringify(remoteMails);
                if (localStorage.getItem(MAILBOX_KEY) !== nextMailJson) {
                    localStorage.setItem(MAILBOX_KEY, nextMailJson);
                    if (typeof AdminMemoryCache !== 'undefined') AdminMemoryCache.invalidate('mailbox');
                }
            }
        } catch (e) {}
    }

    const mails = getMailbox();
    const users = getUsers();
    const userById = new Map();
    users.forEach(u => {
        if (u && u.id) userById.set(String(u.id).trim(), u);
    });

    let mailboxPatched = false;
    const checkedItems = [];

    mails.forEach(m => {
        if (!m || !m.id) return;
        const tId = String(m.targetId || '').trim();
        if (!tId || tId.toUpperCase() === 'ALL') return;

        const targetU = userById.get(tId);
        const userReadIds = (targetU && Array.isArray(targetU.readMailIds)) ? targetU.readMailIds.map(String) : [];
        let isRead = Boolean(m.isReadByTarget);

        if (!isRead && userReadIds.includes(String(m.id))) {
            isRead = true;
            m.isReadByTarget = true;
            m.readByPlayerId = tId;
            if (targetU && targetU.nickname) m.readByPlayerName = String(targetU.nickname);
            if (!m.readAtTs) m.readAtTs = nowTs;
            if (!m.readAtStr) m.readAtStr = new Date(nowTs).toLocaleString('zh-TW', { hour12: false });
            mailboxPatched = true;
            if (typeof CloudSync !== 'undefined' && CloudSync.initialized && typeof CloudSync.patchNode === 'function') {
                CloudSync.patchNode(`${MAILBOX_KEY}/${m.id}`, {
                    isReadByTarget: true,
                    readByPlayerId: tId,
                    readByPlayerName: m.readByPlayerName || '',
                    readAtTs: m.readAtTs,
                    readAtStr: m.readAtStr
                });
            }
        }

        const recipientName = (targetU && targetU.nickname)
            ? `${targetU.nickname} (ID:${tId})`
            : (m.targetLabel || `ID:${tId}`);

        checkedItems.push({
            mailId: String(m.id),
            targetId: tId,
            recipientLabel: recipientName,
            title: String(m.title || ''),
            isRead,
            readAtStr: String(m.readAtStr || '')
        });
    });

    if (mailboxPatched) {
        const nextRaw = JSON.stringify(mails);
        if (typeof AdminMemoryCache !== 'undefined') {
            AdminMemoryCache.mailboxRaw = nextRaw;
            AdminMemoryCache.mailbox = mails;
        }
        localStorage.setItem(MAILBOX_KEY, nextRaw);
    }

    const checkedAtStr = new Date(nowTs).toLocaleString('zh-TW', { hour12: false });
    const report = {
        checkedDateStr: todayStr,
        checkedAtTs: nowTs,
        checkedAtStr,
        totalSingleCount: checkedItems.length,
        readCount: checkedItems.filter(i => i.isRead).length,
        unreadCount: checkedItems.filter(i => !i.isRead).length,
        items: checkedItems.slice(0, 15)
    };

    try {
        localStorage.setItem(DAILY_MAIL_READ_CHECK_DAY_KEY, todayStr);
        localStorage.setItem(DAILY_MAIL_READ_CHECK_REPORT_KEY, JSON.stringify(report));
    } catch (e) {}

    if (typeof renderAdminAll === 'function') {
        renderAdminAll(true);
    }
    return report;
}

async function runManualSingleMailReadCheck() {
    const report = await checkSinglePlayerMailReadStatusDaily({ force: true, skipRemoteFetch: false });
    if (!report) return;
    if (report.totalSingleCount === 0) {
        alert('📅 目前尚無指定單一玩家的信件需要追蹤。');
        return;
    }
    const lines = report.items.map(item =>
        item.isRead
            ? `✅ ${item.recipientLabel}「${item.title}」：已讀${item.readAtStr ? `（${item.readAtStr}）` : ''}`
            : `⏳ ${item.recipientLabel}「${item.title}」：尚未讀取`
    );
    alert(`📅 單一玩家信件已讀檢查完成（${report.checkedAtStr}）\n\n總計 ${report.totalSingleCount} 封（✅ 已讀 ${report.readCount} 封 ／ ⏳ 尚未讀取 ${report.unreadCount} 封）：\n\n${lines.join('\n')}`);
}

function getFateWallPosts() {
    const keyName = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
    const raw = localStorage.getItem(keyName) || '[]';
    if (raw === AdminMemoryCache.fateWallRaw && Array.isArray(AdminMemoryCache.fateWall)) {
        return AdminMemoryCache.fateWall;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) parsed = [];
    } catch (e) {
        parsed = [];
    }
    parsed.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    AdminMemoryCache.fateWallRaw = raw;
    AdminMemoryCache.fateWall = parsed;
    return parsed;
}

function saveFateWallPosts(posts) {
    const keyName = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
    const sorted = (Array.isArray(posts) ? posts : []).sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    const nextRaw = JSON.stringify(sorted);
    AdminMemoryCache.fateWallRaw = nextRaw;
    AdminMemoryCache.fateWall = sorted;
    localStorage.setItem(keyName, nextRaw);
    renderAdminAll(true);
}

function insertFateWallToken(inputId, tokenStr) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    const start = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : inputEl.value.length;
    const end = typeof inputEl.selectionEnd === 'number' ? inputEl.selectionEnd : inputEl.value.length;
    const before = inputEl.value.slice(0, start);
    const after = inputEl.value.slice(end);
    inputEl.value = before + tokenStr + after;
    inputEl.focus();
    const nextPos = start + tokenStr.length;
    if (typeof inputEl.setSelectionRange === 'function') {
        inputEl.setSelectionRange(nextPos, nextPos);
    }
    if (inputId === 'fateWallContentInput') {
        previewAdminFateWallInput(true);
    }
}

function fillFateWallRandomTemplate(inputId) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    inputEl.value = '{地區} {年齡} 歲 {MBTI} 女生與{地區} {年齡} 歲 {MBTI} 男生好友配對成功';
    inputEl.focus();
    if (inputId === 'fateWallContentInput') {
        previewAdminFateWallInput(true);
    }
}

function previewAdminFateWallInput(silentIfEmpty = false) {
    const inputEl = document.getElementById('fateWallContentInput');
    const previewEl = document.getElementById('fateWallLiveRandomPreview');
    if (!inputEl || !previewEl) return;
    const raw = inputEl.value.trim();
    if (!raw) {
        previewEl.classList.add('hidden');
        previewEl.textContent = '';
        if (!silentIfEmpty) {
            alert('請先輸入動態內容或點擊「✨ 填入配對範本」再預覽喔！');
        }
        return;
    }
    const sample = (typeof resolveFateWallDynamicText === 'function')
        ? resolveFateWallDynamicText(raw)
        : raw;
    previewEl.textContent = `🎲 前台刷新隨機顯示範例：${sample}`;
    previewEl.classList.remove('hidden');
}

function addAdminFateWallEntry() {
    const tagSel = document.getElementById('fateWallTagSelect');
    const contentInput = document.getElementById('fateWallContentInput');
    if (!contentInput) return;

    const tag = (tagSel ? tagSel.value.trim() : '') || '🌸 月老動態';
    const content = contentInput.value.trim();
    if (!content) {
        alert('請輸入動態牆文字內容！');
        contentInput.focus();
        return;
    }

    const keyName = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
    const nowTs = Date.now();
    const newPost = {
        id: 'FW_' + nowTs + '_' + Math.random().toString(36).slice(2, 6),
        tag: tag,
        content: content,
        ts: nowTs,
        createdAt: new Date(nowTs).toLocaleString('zh-TW', { hour12: false })
    };

    const posts = getFateWallPosts();
    posts.unshift(newPost);
    saveFateWallPosts(posts);
    if (typeof CloudSync !== 'undefined') {
        CloudSync.putNode(`${keyName}/${newPost.id}`, newPost);
    }

    contentInput.value = '';
    const previewEl = document.getElementById('fateWallLiveRandomPreview');
    if (previewEl) {
        previewEl.classList.add('hidden');
        previewEl.textContent = '';
    }
    appendLog(`<span class="text-pink-300">[即時緣分動態牆]</span> 已發布新動態「<strong>${content}</strong>」，並同步顯示於前台首頁。`);
}

function openEditAdminFateWallModal(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return;
    const target = getFateWallPosts().find(p => String(p.id) === pid);
    if (!target) return;

    const modal = document.getElementById('editFateWallModal');
    const idInput = document.getElementById('editFateWallTargetId');
    const tagSel = document.getElementById('editFateWallTagSelect');
    const contentInput = document.getElementById('editFateWallContentInput');
    if (!modal || !idInput || !contentInput) return;

    idInput.value = pid;
    const curTag = String(target.tag || '🌸 月老動態').trim();
    if (tagSel) {
        if (!Array.from(tagSel.options).some(opt => opt.value === curTag)) {
            const extraOpt = document.createElement('option');
            extraOpt.value = curTag;
            extraOpt.textContent = curTag;
            tagSel.appendChild(extraOpt);
        }
        tagSel.value = curTag;
    }
    contentInput.value = String(target.content || '');
    modal.classList.remove('hidden');
    setTimeout(() => {
        contentInput.focus();
        contentInput.select();
    }, 40);
}

function closeEditAdminFateWallModal() {
    const modal = document.getElementById('editFateWallModal');
    if (modal) modal.classList.add('hidden');
}

function saveEditedAdminFateWallEntry(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const pid = String(document.getElementById('editFateWallTargetId')?.value || '').trim();
    const tagSel = document.getElementById('editFateWallTagSelect');
    const contentInput = document.getElementById('editFateWallContentInput');
    if (!pid || !contentInput) return;

    const nextTag = (tagSel ? tagSel.value.trim() : '') || '🌸 月老動態';
    const nextContent = contentInput.value.trim();
    if (!nextContent) {
        alert('請輸入動態牆文字內容！');
        contentInput.focus();
        return;
    }

    const posts = getFateWallPosts();
    const idx = posts.findIndex(p => String(p.id) === pid);
    if (idx < 0) {
        closeEditAdminFateWallModal();
        return;
    }

    posts[idx] = {
        ...posts[idx],
        tag: nextTag,
        content: nextContent
    };
    saveFateWallPosts(posts);

    const keyName = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
    if (typeof CloudSync !== 'undefined') {
        if (CloudSync.initialized && typeof CloudSync.patchNode === 'function') {
            CloudSync.patchNode(`${keyName}/${pid}`, { tag: nextTag, content: nextContent });
        } else {
            CloudSync.putNode(`${keyName}/${pid}`, posts[idx]);
        }
    }

    closeEditAdminFateWallModal();
    appendLog(`<span class="text-sky-300">[編輯緣分動態牆]</span> 已更新動態牆內容為「<strong>${nextContent}</strong>」，並同步至前台首頁。`);
}

function deleteAdminFateWallEntry(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return;
    const keyName = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
    saveFateWallPosts(getFateWallPosts().filter(p => String(p.id) !== pid));
    if (typeof CloudSync !== 'undefined') {
        CloudSync.deleteNode(`${keyName}/${pid}`);
    }
}

function getAdminWishWallPosts() {
    const keyName = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
    const raw = localStorage.getItem(keyName) || '[]';
    if (raw === AdminMemoryCache.wishWallRaw && Array.isArray(AdminMemoryCache.wishWall)) {
        return AdminMemoryCache.wishWall;
    }
    try {
        const arr = JSON.parse(raw);
        const normalized = Array.isArray(arr)
            ? arr
                .map(w => (typeof normalizeWishWallItem === 'function' ? normalizeWishWallItem(w) : w))
                .filter(Boolean)
                .sort((a, b) => (typeof compareWishWallItems === 'function')
                    ? compareWishWallItems(a, b)
                    : (Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0)))
            : [];
        AdminMemoryCache.wishWallRaw = raw;
        AdminMemoryCache.wishWall = normalized;
        return normalized;
    } catch (e) {
        return [];
    }
}

function toggleAdminWishWallPin(wishId) {
    const wid = String(wishId || '').trim();
    if (!wid) return;
    const keyName = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
    const wishes = getAdminWishWallPosts();
    const target = wishes.find(w => String(w.id) === wid);
    if (!target) return;

    const nextPinned = !Boolean(target.isPinned);
    const nextPinnedAtTs = nextPinned ? Date.now() : 0;
    target.isPinned = nextPinned;
    target.pinnedAtTs = nextPinnedAtTs;

    wishes.sort((a, b) => (typeof compareWishWallItems === 'function')
        ? compareWishWallItems(a, b)
        : (Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0)));
    localStorage.setItem(keyName, JSON.stringify(wishes));

    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        CloudSync.patchNode(`${keyName}/${wid}`, {
            isPinned: nextPinned,
            pinnedAtTs: nextPinnedAtTs
        });
    }
    renderAdminAll(true);
}

function adminFastForwardWishExpiry(wishId) {
    const wid = String(wishId || '').trim();
    if (!wid) return;
    const keyName = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
    const wishes = getAdminWishWallPosts();
    const target = wishes.find(w => String(w.id) === wid);
    if (!target) return;

    const pastTs = Date.now() - 1000;
    target.expiresAtTs = pastTs;
    localStorage.setItem(keyName, JSON.stringify(wishes));
    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        CloudSync.patchNode(`${keyName}/${wid}`, { expiresAtTs: pastTs });
    }
    renderAdminAll(true);
    alert(`⏩ 已將祈願「${target.title}」推進至到期狀態！\n發起人「${target.authorNickname} (ID:${target.authorId})」現在可在前台選擇喜歡的匿名答案並配對成好友。`);
}

function deleteAdminWishWallEntry(wishId) {
    const wid = String(wishId || '').trim();
    if (!wid) return;
    if (!confirm('確定要刪除此則祈願題目嗎？')) return;
    const keyName = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
    const remaining = getAdminWishWallPosts().filter(w => String(w.id) !== wid);
    localStorage.setItem(keyName, JSON.stringify(remaining));
    if (typeof CloudSync !== 'undefined') {
        CloudSync.deleteNode(`${keyName}/${wid}`);
    }
    renderAdminAll(true);
}

function batchDeleteAdminWishWallEntries() {
    const filterSel = document.getElementById('adminWishWallFilter');
    const filterVal = (filterSel && filterSel.value) ? filterSel.value : '';

    if (!filterVal) {
        alert('請先在左側「狀態過濾」選擇要刪除的狀態（例如：🏁 已結束、🟢 開放中 或 全部狀態）！');
        if (filterSel) filterSel.focus();
        return;
    }

    const allWishes = (typeof getAdminWishWallPosts === 'function') ? getAdminWishWallPosts() : [];
    const nowTs = Date.now();
    const openWishes = [];
    const endedWishes = [];

    allWishes.forEach(w => {
        const timeEnded = (typeof isWishWallEnded === 'function') ? isWishWallEnded(w, nowTs) : false;
        const isClosedStatus = timeEnded || Boolean(w.settled);
        if (isClosedStatus) {
            endedWishes.push(w);
        } else {
            openWishes.push(w);
        }
    });

    let targetsToDelete = [];
    let remainingWishes = [];
    let confirmMsg = '';

    if (filterVal === 'ENDED') {
        if (endedWishes.length === 0) {
            alert('目前沒有「🏁 已結束」的祈願紀錄可刪除！');
            return;
        }
        targetsToDelete = endedWishes;
        remainingWishes = openWishes;
        confirmMsg = `確定要一鍵刪除全部 ${endedWishes.length} 則「🏁 已結束」的祈願紀錄嗎？\n（「🟢 開放中」的題目將會完整保留，不會被刪除，此動作無法復原。）`;
    } else if (filterVal === 'OPEN') {
        if (openWishes.length === 0) {
            alert('目前沒有「🟢 開放中」的祈願紀錄可刪除！');
            return;
        }
        targetsToDelete = openWishes;
        remainingWishes = endedWishes;
        confirmMsg = `確定要一鍵刪除全部 ${openWishes.length} 則「🟢 開放中」的祈願紀錄嗎？\n（「🏁 已結束」的紀錄將會完整保留，不會被刪除，此動作無法復原。）`;
    } else if (filterVal === 'ALL') {
        if (allWishes.length === 0) {
            alert('目前沒有任何祈願紀錄可刪除！');
            return;
        }
        targetsToDelete = allWishes;
        remainingWishes = [];
        confirmMsg = `確定要一鍵刪除全部 ${allWishes.length} 則祈願紀錄（包含開放中與已結束）嗎？\n此動作無法復原。`;
    } else {
        return;
    }

    if (!confirm(confirmMsg)) return;

    const keyName = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
    localStorage.setItem(keyName, JSON.stringify(remainingWishes));

    if (typeof CloudSync !== 'undefined') {
        targetsToDelete.forEach(w => {
            if (w && w.id) {
                CloudSync.deleteNode(`${keyName}/${String(w.id).trim()}`);
            }
        });
    }

    renderAdminAll(true);
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


const ADMIN_AUTH_KEY = 'yuelao_admin_auth'; // 舊版 sessionStorage 鍵，僅供登出時清除

// C2-a：以 Firebase 管理員會話為準（獨立鍵 yuelao_admin_auth_session_v1），不再比對本地密碼
function isAdminAuthenticated() {
    if (typeof yuelaoAuth === 'undefined' || !yuelaoAuth) return false;
    return Boolean(yuelaoAuth.adminSession || yuelaoAuth.loadAdminSession());
}

async function unlockAdminUI() {
    document.getElementById('adminLoginOverlay').classList.add('hidden');
    document.getElementById('adminMainContent').classList.remove('hidden');

    // 1. 本地快取秒開：立即以本地最新快取渲染畫面，無需等待雲端全庫下載
    const badge = document.getElementById('cloudStatusBadge');
    if (badge) {
        badge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-800 font-semibold';
        badge.textContent = '⚡ 已載入本地快取（雲端背景同步中...）';
    }
    renderAdminAll(true);

    // 2. 雲端背景靜默同步：下載完成後自動比對更新並開啟即時 SSE 推播
    CloudSync.init(() => {
        renderAdminAll(false);
    }).then(() => {
        checkAutoSchedule2000();
        if (typeof ChatStore !== 'undefined' && typeof ChatStore.purgeInactiveRooms === 'function') {
            const purgedOnLoad = ChatStore.purgeInactiveRooms(Date.now());
            if (purgedOnLoad.length > 0 && typeof AdminMemoryCache !== 'undefined') {
                AdminMemoryCache.invalidate('chats');
                AdminMemoryCache.invalidate('users');
            }
        }
        if (typeof enforceClosedCustomActivityCloudLocks === 'function') {
            enforceClosedCustomActivityCloudLocks();
        }
        if (typeof checkSinglePlayerMailReadStatusDaily === 'function') {
            checkSinglePlayerMailReadStatusDaily({ force: false, skipRemoteFetch: true });
        }
        renderAdminAll(false);
    }).catch(() => {});
}

async function recordAdminLoginSuccess(email) {
    try {
        let ip = 'Unknown IP';
        try {
            const res = await fetch('https://api.ipify.org?format=json');
            if (res.ok) {
                const data = await res.json();
                ip = data.ip || 'Unknown IP';
            }
        } catch (err) {}

        const logEntry = {
            id: 'AL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: 'success',
            accountTried: email,
            ipAddress: ip,
            userAgent: navigator.userAgent || 'Unknown Browser',
            ts: Date.now(),
            createdAt: new Date().toLocaleString('zh-TW')
        };
        const logs = JSON.parse(localStorage.getItem('yuelao_admin_login_logs') || '[]');
        logs.unshift(logEntry);
        const removedLogs = logs.length > 10 ? logs.slice(10) : [];
        localStorage.setItem('yuelao_admin_login_logs', JSON.stringify(logs.slice(0, 10)));

        // 雲端：以剛取得的管理員權杖寫入（不依賴 CloudSync 是否已初始化）
        const token = yuelaoAuth.getIdTokenSync();
        const dbUrl = yuelaoAuth.dbUrl();
        if (!token || !dbUrl) return;
        await fetch(`${dbUrl}/yuelao_admin_login_logs/${encodeURIComponent(logEntry.id)}.json?auth=${encodeURIComponent(token)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(logEntry)
        });
        removedLogs.forEach(old => {
            if (old && old.id) {
                fetch(`${dbUrl}/yuelao_admin_login_logs/${encodeURIComponent(old.id)}.json?auth=${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
            }
        });
    } catch (err) {
        console.warn('[admin] 登入紀錄寫入失敗', err);
    }
}

// C2-a：僅記錄成功登入；失敗不再寫入紀錄（失敗時尚未取得管理員權杖）
async function handleAdminLogin(e) {
    e.preventDefault();
    const email = document.getElementById('adminLoginAccount').value.trim();
    const pwdEl = document.getElementById('adminLoginPassword');
    const errBox = document.getElementById('adminLoginError');
    const btn = e.target && e.target.querySelector ? e.target.querySelector('button[type="submit"]') : null;
    if (btn) btn.disabled = true;

    try {
        await yuelaoAuth.signInAdmin(email, pwdEl.value);
    } catch (err) {
        errBox.textContent = '🚫 ' + ((err && err.message) || '登入失敗，請稍後再試');
        errBox.classList.remove('hidden');
        pwdEl.value = '';
        pwdEl.focus();
        if (btn) btn.disabled = false;
        return;
    }

    errBox.classList.add('hidden');
    pwdEl.value = '';
    if (btn) btn.disabled = false;
    recordAdminLoginSuccess(email);
    unlockAdminUI();
}

function logoutAdmin() {
    sessionStorage.removeItem(ADMIN_AUTH_KEY);
    if (typeof yuelaoAuth !== 'undefined' && yuelaoAuth) yuelaoAuth.clearAdminSession();
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
    if (typeof CloudSync !== 'undefined' && (!CloudSync.initialized || CloudSync.inFlightWrites > 0)) return;
    const curUsers = localStorage.getItem(USERS_KEY) || '';
    const curReports = localStorage.getItem(REPORTS_KEY) || '';
    const curSys = localStorage.getItem(SYSTEM_STATE_KEY) || '';
    const curChats = `${typeof CloudSync !== 'undefined' ? Number(CloudSync.chatsTreeVersion || 0) : 0}|${localStorage.getItem(getAdminChatsStorageKey()) || ''}`;
    const curMatchLogs = localStorage.getItem(MATCH_LOGS_KEY) || '';
    const pOpKey = (typeof PLAYER_OP_LOGS_KEY !== 'undefined') ? PLAYER_OP_LOGS_KEY : 'yuelao_player_op_logs';
    const curPlayerOpLogs = localStorage.getItem(pOpKey) || '';
    const fwKey = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
    const wwKey = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
    const curFateWall = localStorage.getItem(fwKey) || '';
    const curWishWall = localStorage.getItem(wwKey) || '';
    const curMailbox = localStorage.getItem(MAILBOX_KEY) || '';
    const smrKey = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined') ? SESSION_MATCH_RESULTS_KEY : 'yuelao_session_match_results';
    const curSessionMatchResults = localStorage.getItem(smrKey) || '';
    const curBatch = getCurrentBatch();
    if (curUsers !== lastUsersSnapshot || curReports !== lastReportsSnapshot || curSys !== lastSystemSnapshot || curChats !== lastChatsAdminSnapshot || curMatchLogs !== lastMatchLogsAdminSnapshot || curPlayerOpLogs !== lastPlayerOpLogsAdminSnapshot || curFateWall !== lastFateWallAdminSnapshot || curWishWall !== lastWishWallAdminSnapshot || curMailbox !== lastMailboxAdminSnapshot || curSessionMatchResults !== lastSessionMatchResultsSnapshot || curBatch !== lastRenderedBatchNumber) {
        renderAdminAll(false);
    }
}

window.addEventListener('storage', (e) => {
    if (!isAdminAuthenticated()) return;
    if (typeof CloudSync !== 'undefined' && !CloudSync.initialized) return;
    const pOpKey = (typeof PLAYER_OP_LOGS_KEY !== 'undefined') ? PLAYER_OP_LOGS_KEY : 'yuelao_player_op_logs';
    const fwKey = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
    const wwKey = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
    const smrKey = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined') ? SESSION_MATCH_RESULTS_KEY : 'yuelao_session_match_results';
    if ([USERS_KEY, REPORTS_KEY, SYSTEM_STATE_KEY, MAILBOX_KEY, CUSTOM_ACTIVITIES_KEY, getAdminChatsStorageKey(), REG_HISTORY_KEY, smrKey, 'yuelao_admin_login_logs', MATCH_LOGS_KEY, pOpKey, fwKey, wwKey].includes(e.key)) {
        renderAdminAll(false);
    }
});

window.addEventListener('focus', pollSharedStorageChanges);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollSharedStorageChanges();
});

let lastDailyChatPurgeTickTs = 0;
setInterval(() => {
    if (!isAdminAuthenticated()) return;
    if (typeof CloudSync !== 'undefined' && !CloudSync.initialized) return;
    checkAutoSchedule2000();
    const nowTickTs = Date.now();
    if (nowTickTs - lastDailyChatPurgeTickTs >= 15000) {
        lastDailyChatPurgeTickTs = nowTickTs;
        if (typeof ChatStore !== 'undefined' && typeof ChatStore.purgeInactiveRooms === 'function') {
            const purged = ChatStore.purgeInactiveRooms(nowTickTs);
            if (purged.length > 0 && typeof AdminMemoryCache !== 'undefined') {
                AdminMemoryCache.invalidate('chats');
                AdminMemoryCache.invalidate('users');
            }
        }
        if (typeof checkSinglePlayerMailReadStatusDaily === 'function') {
            checkSinglePlayerMailReadStatusDaily({ force: false, skipRemoteFetch: true });
        }
    }
    pollSharedStorageChanges();
}, 3000);

// 由 backend/layout.js 渲染側邊欄骨架後自動檢查登入狀態


function renderAdminSharedOverview(forceUpdate = false) {
    lastUsersSnapshot = localStorage.getItem(USERS_KEY) || '';
    lastReportsSnapshot = localStorage.getItem(REPORTS_KEY) || '';
    lastSystemSnapshot = localStorage.getItem(SYSTEM_STATE_KEY) || '';
    lastChatsAdminSnapshot = `${typeof CloudSync !== 'undefined' ? Number(CloudSync.chatsTreeVersion || 0) : 0}|${localStorage.getItem(getAdminChatsStorageKey()) || ''}`;
    lastMatchLogsAdminSnapshot = localStorage.getItem(MATCH_LOGS_KEY) || '';
    lastPlayerOpLogsAdminSnapshot = localStorage.getItem((typeof PLAYER_OP_LOGS_KEY !== 'undefined') ? PLAYER_OP_LOGS_KEY : 'yuelao_player_op_logs') || '';
    lastFateWallAdminSnapshot = localStorage.getItem((typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall') || '';
    lastWishWallAdminSnapshot = localStorage.getItem((typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall') || '';
    lastMailboxAdminSnapshot = localStorage.getItem(MAILBOX_KEY) || '';
    lastSessionMatchResultsSnapshot = localStorage.getItem((typeof SESSION_MATCH_RESULTS_KEY !== 'undefined') ? SESSION_MATCH_RESULTS_KEY : 'yuelao_session_match_results') || '';

    const sysCfg = getSystemConfig();
    const batch = sysCfg.currentBatch;
    lastRenderedBatchNumber = batch;
    const currentSched = getBatchScheduleInfo(batch);
    const users = getUsers();
    const reports = getReports();

    const regCount = users.filter(u => (Array.isArray(u.registeredSessions) && u.registeredSessions.length > 0) || (u.customActivityRegs && Object.keys(u.customActivityRegs).length > 0)).length;
    const totalHistoryLinks = users.reduce((acc, u) => acc + (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0 ? u.matchedHistory.length : (u.matchedWithId ? 1 : 0)), 0);
    const matchedPairs = Math.floor(totalHistoryLinks / 2);
    const pendingReps = reports.filter(r => r && r.status === '待處理').length;

    const overviewSig = `${currentSched.batchPrefix}|${users.length}|${regCount}|${matchedPairs}|${reports.length}|${pendingReps}`;
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
        renderLogsPageSection(forceUpdate);
    }
}

const expandedAdminWishWallCards = new Set();
let wishWallPageSize = '0';
let currentWishWallPage = 1;

function onAdminWishWallFilterChange() {
    currentWishWallPage = 1;
    renderAdminWishWallList();
}

function onAdminWishWallPageSizeChange(newSize) {
    const val = ['0', '5', '10', '30'].includes(String(newSize)) ? String(newSize) : '0';
    wishWallPageSize = val;
    currentWishWallPage = 1;
    renderAdminWishWallList();
}

function goToAdminWishWallPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    currentWishWallPage = p;
    renderAdminWishWallList();
}

function toggleAdminWishWallCardExpand(wishId) {
    const wid = String(wishId || '').trim();
    if (!wid) return;
    if (expandedAdminWishWallCards.has(wid)) {
        expandedAdminWishWallCards.delete(wid);
    } else {
        expandedAdminWishWallCards.add(wid);
    }
    renderAdminWishWallList();
}

function renderAdminWishWallList() {
    const tbody = document.getElementById('adminWishWallTableBody');
    const paginationBar = document.getElementById('adminWishWallPaginationBar');
    const wishWallBadge = document.getElementById('adminWishWallCountBadge');
    const filterSel = document.getElementById('adminWishWallFilter');
    const sizeSel = document.getElementById('wishWallPageSizeSelect');
    if (!tbody) return;

    const allWishes = (typeof getAdminWishWallPosts === 'function') ? getAdminWishWallPosts() : [];
    const nowTs = Date.now();
    const filterVal = (filterSel && filterSel.value) ? filterSel.value : 'ALL';

    if (sizeSel && sizeSel.value !== wishWallPageSize) {
        sizeSel.value = wishWallPageSize;
    }

    const openWishes = [];
    const endedWishes = [];
    allWishes.forEach(w => {
        const timeEnded = (typeof isWishWallEnded === 'function') ? isWishWallEnded(w, nowTs) : false;
        const isClosedStatus = timeEnded || Boolean(w.settled);
        if (isClosedStatus) {
            endedWishes.push({ wish: w, isClosed: true });
        } else {
            openWishes.push({ wish: w, isClosed: false });
        }
    });

    if (wishWallBadge) {
        wishWallBadge.textContent = `開放中 ${openWishes.length} 則 ／ 已結束 ${endedWishes.length} 則`;
    }

    const batchDelBtn = document.getElementById('batchDeleteWishWallBtn');
    if (batchDelBtn) {
        if (filterVal === 'ENDED') {
            batchDelBtn.textContent = `🗑️ 一鍵刪除已結束 (${endedWishes.length} 則)`;
        } else if (filterVal === 'OPEN') {
            batchDelBtn.textContent = `🗑️ 一鍵刪除開放中 (${openWishes.length} 則)`;
        } else {
            batchDelBtn.textContent = `🗑️ 一鍵刪除全部 (${allWishes.length} 則)`;
        }
    }

    let targetItems = [];
    if (filterVal === 'OPEN') {
        targetItems = openWishes;
    } else if (filterVal === 'ENDED') {
        targetItems = endedWishes;
    } else {
        targetItems = [...openWishes, ...endedWishes];
    }

    const isZeroPerPage = (wishWallPageSize === '0');
    const perPage = isZeroPerPage ? 0 : (parseInt(wishWallPageSize, 10) || 5);
    const totalItems = targetItems.length;
    const totalPages = isZeroPerPage ? 1 : Math.max(1, Math.ceil(totalItems / perPage));
    if (currentWishWallPage > totalPages) currentWishWallPage = totalPages;
    if (currentWishWallPage < 1) currentWishWallPage = 1;
    const startIdx = isZeroPerPage ? 0 : (currentWishWallPage - 1) * perPage;
    const pagedItems = isZeroPerPage ? [] : targetItems.slice(startIdx, startIdx + perPage);

    const escWw = (str) => String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    if (isZeroPerPage) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-5 text-center text-gray-400">目前每頁顯示設為 0 筆（共 ${totalItems} 筆紀錄，請切換每頁顯示筆數查看明細）</td></tr>`;
    } else if (pagedItems.length === 0) {
        const emptyMsg = filterVal === 'OPEN'
            ? '目前沒有「🟢 開放中」的祈願紀錄。'
            : (filterVal === 'ENDED' ? '目前沒有「🏁 已結束」的祈願紀錄。' : '目前尚無任何紅線祈願牆發布與回覆紀錄。');
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400">${emptyMsg}</td></tr>`;
    } else {
        tbody.innerHTML = pagedItems.map(({ wish: w, isClosed }) => {
            const widStr = String(w.id || '');
            const isCardExpanded = expandedAdminWishWallCards.has(widStr);
            const resps = Array.isArray(w.responses) ? w.responses : [];
            const qsList = Array.isArray(w.questions) ? w.questions : [];
            const isMale = String(w.authorGender || '').trim() === '男';
            const genderTagHtml = isMale
                ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-bold text-[11px] mr-1">🚹 男</span>`
                : `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold text-[11px] mr-1">🚺 女</span>`;

            let statusPill = `<span class="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">🟢 開放中（剩 ${typeof calcWishRemainingDays === 'function' ? calcWishRemainingDays(w, nowTs) : '?'} 天）</span>`;
            if (isClosed) {
                if (w.settled && w.matchedAnonNumber) {
                    statusPill = `<span class="inline-block px-2 py-0.5 rounded-full bg-pink-100 text-[#8f4452] text-[11px] font-bold">🏁 已結束・💘 已選匿名${w.matchedAnonNumber}號配對</span>`;
                } else if (w.settled && w.settledWithoutMatch) {
                    statusPill = `<span class="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold">🏁 已結束（未選配對）</span>`;
                } else {
                    statusPill = `<span class="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">🏁 已結束・待題主選擇</span>`;
                }
            }

            const isPinned = Boolean(w.isPinned);
            const pinnedBadgeHtml = isPinned
                ? `<div class="mb-1"><span class="inline-block px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold shadow-2xs">📌 前台置頂中</span></div>`
                : '';

            const pinActionBtnHtml = isPinned
                ? `<button type="button" onclick="event.stopPropagation(); toggleAdminWishWallPin('${escWw(widStr)}')" class="px-2 py-1 rounded-lg bg-rose-100 border border-rose-300 text-[#8f4452] text-[11px] font-bold hover:bg-rose-200 transition">📌 取消置頂</button>`
                : (!isClosed
                    ? `<button type="button" onclick="event.stopPropagation(); toggleAdminWishWallPin('${escWw(widStr)}')" class="px-2 py-1 rounded-lg bg-pink-50 border border-pink-300 text-[#8f4452] text-[11px] font-semibold hover:bg-pink-100 transition">📌 置頂</button>`
                    : '');

            const mainRowHtml = `
                <tr onclick="toggleAdminWishWallCardExpand('${escWw(widStr)}')" class="cursor-pointer transition ${isPinned ? 'bg-rose-50/35 hover:bg-rose-50/70' : 'hover:bg-pink-50/40'}">
                    <td class="p-3.5 text-xs align-middle whitespace-nowrap">
                        ${pinnedBadgeHtml}
                        ${statusPill}
                    </td>
                    <td class="p-3.5 text-xs align-middle whitespace-nowrap">
                        ${genderTagHtml}
                        <span class="font-bold text-gray-800">${escWw(w.authorNickname || w.authorId)}</span>
                        <span class="text-[11px] font-mono text-gray-400 ml-1">(ID:${escWw(w.authorId)})</span>
                    </td>
                    <td class="p-3.5 text-xs align-middle">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex flex-wrap items-center gap-1.5 min-w-0">
                                <span class="font-bold text-[#5e464a]">🏮 「${escWw(w.title)}」</span>
                                <span class="text-[11px] px-2 py-0.5 rounded-full bg-rose-50 border border-pink-200 text-[#8f4452] font-semibold shrink-0">
                                    ${resps.length} 人已答
                                </span>
                            </div>
                            <span class="text-[11px] font-semibold text-[#c96a7b] shrink-0 whitespace-nowrap">
                                ${isCardExpanded ? '▴ 收合明細' : '▾ 展開明細'}
                            </span>
                        </div>
                    </td>
                    <td class="p-3.5 text-xs align-middle whitespace-nowrap" onclick="event.stopPropagation()">
                        <div class="flex flex-wrap items-center gap-1.5">
                            ${pinActionBtnHtml}
                            ${!isClosed ? `<button type="button" onclick="adminFastForwardWishExpiry('${escWw(widStr)}')" class="px-2 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-semibold hover:bg-amber-100 transition">⏩ 到期</button>` : ''}
                            <button type="button" onclick="deleteAdminWishWallEntry('${escWw(widStr)}')" class="px-2 py-1 rounded-lg bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] font-semibold transition">🗑️ 刪除</button>
                        </div>
                    </td>
                </tr>
            `;

            if (!isCardExpanded) {
                return mainRowHtml;
            }

            const questionsPreviewHtml = qsList.length > 0
                ? `<div class="space-y-1 p-2.5 rounded-xl bg-white border border-pink-100 text-[11px] text-gray-600">
                    <div class="font-bold text-[#8f4452]">📝 祈願題目內容（共 ${qsList.length} 題・開放 ${w.openDays} 天）：</div>
                    ${qsList.map(q => `<div class="leading-relaxed">Q${q.qIndex}. <strong class="text-gray-800">${escWw(q.question)}</strong> <span class="text-gray-400">（A. ${escWw(q.optionA)} ／ B. ${escWw(q.optionB)}）</span></div>`).join('')}
                </div>`
                : '';

            const respondersDetailHtml = resps.length === 0
                ? `<div class="text-[11px] text-gray-400 p-2.5 rounded-xl bg-white border border-dashed border-pink-200">💭 目前尚無玩家回覆此祈願題目</div>`
                : `<div class="space-y-1.5 p-2.5 rounded-xl bg-white border border-pink-100">
                    <div class="text-[11px] font-bold text-[#8f4452]">🎭 玩家匿名回覆明細（共 ${resps.length} 人已答）：</div>
                    <div class="flex flex-wrap gap-1.5">
                        ${resps.map(r => {
                            const rG = String(r.responderGender || '').trim();
                            const rTag = rG ? `（${rG}）` : '';
                            const ansSummary = (r.answers || []).map(a => `Q${a.qIndex}:${escWw(a.chosenText)}`).join(' / ');
                            const isPicked = w.matchedAnonNumber && Number(w.matchedAnonNumber) === Number(r.anonNumber);
                            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] ${isPicked ? 'bg-rose-100 border border-rose-300 text-[#8f4452] font-bold' : 'bg-pink-50/80 border border-pink-200 text-gray-700'}">
                                <span>${isPicked ? '💘' : '🎭'} 匿名${r.anonNumber}號：${escWw(r.responderNickname || r.responderId)}${rTag} (ID:${escWw(r.responderId)})</span>
                                ${ansSummary ? `<span class="text-gray-500">[${ansSummary}]</span>` : ''}
                            </span>`;
                        }).join('')}
                    </div>
                </div>`;

            const detailRowHtml = `
                <tr class="bg-pink-50/25">
                    <td colspan="4" class="p-3.5 space-y-2 text-xs">
                        ${questionsPreviewHtml}
                        ${respondersDetailHtml}
                    </td>
                </tr>
            `;

            return mainRowHtml + detailRowHtml;
        }).join('');
    }

    if (paginationBar) {
        if (typeof buildLogsPaginationHtml === 'function') {
            paginationBar.innerHTML = buildLogsPaginationHtml({
                totalItems,
                pageSizeStr: wishWallPageSize,
                currentPage: currentWishWallPage,
                totalPages,
                startIdx,
                perPage,
                onPageSizeFnName: 'onAdminWishWallPageSizeChange',
                onGoPageFnName: 'goToAdminWishWallPage',
                accentBgClass: 'bg-[#c96a7b]',
                accentBorderClass: 'border-rose-200',
                accentHoverClass: 'hover:bg-rose-50',
                accentTextClass: 'text-[#8f4452]'
            });
        } else {
            const showFrom = totalItems === 0 ? 0 : startIdx + 1;
            const showTo = Math.min(startIdx + perPage, totalItems);
            paginationBar.innerHTML = `<div class="text-gray-600 font-medium">顯示第 <strong class="text-[#8f4452]">${showFrom}～${showTo}</strong> 筆，共 <strong class="text-[#8f4452]">${totalItems}</strong> 筆（第 <strong>${currentWishWallPage}</strong> / ${totalPages} 頁，每頁 ${perPage} 筆）</div>`;
        }
    }
}

window.batchDeleteAdminWishWallEntries = batchDeleteAdminWishWallEntries;
window.renderAdminWishWallList = renderAdminWishWallList;
window.onAdminWishWallFilterChange = onAdminWishWallFilterChange;
window.onAdminWishWallPageSizeChange = onAdminWishWallPageSizeChange;
window.goToAdminWishWallPage = goToAdminWishWallPage;
window.toggleAdminWishWallCardExpand = toggleAdminWishWallCardExpand;
window.toggleAdminWishWallPin = toggleAdminWishWallPin;
