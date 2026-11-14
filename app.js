/* app.js - 男女生人數限制、性別限選男女、先選地區再選縣市、禁止玩家發話、前台信件箱 */

let appState = Store.load();
let lastControlsSnapshot = JSON.stringify(Store.getSystemConfig());
let lastGenderQuotaSnapshot = JSON.stringify(Store.getGenderQuotaStatus());
let lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
let lastUsersStatsSnapshot = '';
let lastActiveBatch = getCurrentBatchNumber();
let lastRenderedChatSignature = '';

function getCurrentBatchNumber() {
    return Store.getActiveBatchNumber();
}

function showMiniNotice(title, body) {
    document.getElementById('miniNoticeTitle').textContent = title;
    document.getElementById('miniNoticeBody').textContent = body;
    document.getElementById('miniNoticeWindow').classList.remove('hidden');
}

function closeMiniNotice() {
    document.getElementById('miniNoticeWindow').classList.add('hidden');
}

function calcRemainingDays(matchedAt, nowTs = Date.now()) {
    if (!matchedAt) return 7;
    const first2000 = new Date(matchedAt);
    first2000.setHours(20, 0, 0, 0);
    if (first2000.getTime() <= matchedAt) {
        first2000.setDate(first2000.getDate() + 1);
    }
    if (nowTs < first2000.getTime()) return 7;
    const passed2000Count = 1 + Math.floor((nowTs - first2000.getTime()) / (24 * 60 * 60 * 1000));
    return Math.max(0, 7 - passed2000Count);
}

function isEveningConfessionPending() {
    const todayStr = new Date().toDateString();
    return (
        appState.friends.length >= 2 &&
        appState.confessionUnlockAt &&
        Date.now() >= appState.confessionUnlockAt &&
        appState.lastConfessionDate !== todayStr
    );
}

// ==================== 初始化與前後台即時同步監聽 ====================
document.addEventListener('DOMContentLoaded', async () => {
    initSakuraPetals();
    renderRandomMoment();
    if (typeof CloudSync !== 'undefined') {
        await CloudSync.init(() => {
            syncFromSharedStorage();
            updateMailboxBadge();
            if (!document.getElementById('mailboxModal').classList.contains('hidden') &&
                !document.getElementById('mailboxListView').classList.contains('hidden')) {
                renderMailboxList();
            }
        });
        appState = Store.load();
    }
    syncFromSharedStorage();
    renderProfileForm();
    refreshAllUI();
    updateMailboxBadge();

    setInterval(() => {
        updateNextMatchCountdown();
        syncFromSharedStorage();
    }, 1000);
    updateNextMatchCountdown();

    window.addEventListener('storage', (e) => {
        if ([USERS_KEY, SYSTEM_STATE_KEY, BANNED_RULES_KEY, MAILBOX_KEY, CHATS_KEY, 'yuelao_test_event'].includes(e.key)) {
            syncFromSharedStorage();
            updateMailboxBadge();
            if (!document.getElementById('mailboxModal').classList.contains('hidden') &&
                !document.getElementById('mailboxListView').classList.contains('hidden')) {
                renderMailboxList();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.multiselect-wrapper')) {
            document.querySelectorAll('.multiselect-menu').forEach(m => m.classList.add('hidden'));
        }
    });

    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
    }
});

function syncFromSharedStorage() {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    let stateChanged = false;

    const sysCfgNow = Store.getSystemConfig();
    const currentControlsStr = JSON.stringify(sysCfgNow);
    if (currentControlsStr !== lastControlsSnapshot || sysCfgNow.currentBatch !== lastActiveBatch) {
        lastControlsSnapshot = currentControlsStr;
        lastActiveBatch = sysCfgNow.currentBatch;
        stateChanged = true;
        if (!sysCfgNow.registrationOpen) {
            closeRegisterModal();
        }
    }

    const currentQuotaStr = JSON.stringify(Store.getGenderQuotaStatus());
    if (currentQuotaStr !== lastGenderQuotaSnapshot) {
        lastGenderQuotaSnapshot = currentQuotaStr;
        stateChanged = true;
    }

    let chatsChanged = false;
    const currentChatsRaw = localStorage.getItem(CHATS_KEY) || '';
    if (currentChatsRaw !== lastChatsSnapshot) {
        lastChatsSnapshot = currentChatsRaw;
        chatsChanged = true;
    }

    // 1. 檢查後台測試指令
    const testCmdRaw = localStorage.getItem('yuelao_test_event');
    if (testCmdRaw) {
        try {
            const cmd = JSON.parse(testCmdRaw);
            if (cmd && cmd.id && cmd.id !== appState.lastProcessedTestCmdId) {
                appState.lastProcessedTestCmdId = cmd.id;
                applyBackendTestEvent(cmd, users);
                stateChanged = true;
            }
        } catch (err) {}
    }

    if (appState.playerId) {
        const me = users.find(u => String(u.id) === String(appState.playerId));

        // 2. 若雲端已初始化且玩家資料已被後台管理員整筆刪除，同步重置前台本地狀態
        const isPendingSync = (typeof CloudSync !== 'undefined' && typeof CloudSync.isUserPending === 'function' && CloudSync.isUserPending(appState.playerId));
        if (!me && !isPendingSync && (typeof CloudSync === 'undefined' || CloudSync.initialized)) {
            appState = Store.getDefaultState();
            appState.lastProcessedTestCmdId = JSON.parse(localStorage.getItem('yuelao_test_event') || '{}').id || null;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
            renderProfileForm();
            refreshAllUI();
            updateMailboxBadge();
            return;
        }

        // 若管理員於後台編輯了此玩家的個人資料，自動同步更新至前台
        if (me && me.updatedAt && me.updatedAt !== appState.lastSyncedCloudUpdatedAt) {
            appState.lastSyncedCloudUpdatedAt = me.updatedAt;
            const skipSyncKeys = new Set([
                'id', 'privacy', 'backupCode', 'isWarned', 'warningReason',
                'isMatchBanned', 'isChatBanned', 'registeredSessions', 'registeredSession',
                'exactMatchCriteria', 'matchedHistory', 'matchedSession',
                'matchedWithId', 'matchedWithName', 'matchedAt', 'updatedAt'
            ]);
            Object.entries(me).forEach(([k, v]) => {
                if (!skipSyncKeys.has(k)) {
                    appState.profile[k] = v;
                }
            });
            if (!appState.profile.region && appState.profile.city) {
                appState.profile.region = inferRegionByCity(appState.profile.city);
            }
            if (appState.profile.mbti && !appState.profile.mbtiGroup) {
                appState.profile.mbtiGroup = inferMbtiGroup(appState.profile.mbti);
            }
            if (me.privacy && typeof me.privacy === 'object') {
                appState.privacy = { ...appState.privacy, ...me.privacy };
            }
            if (typeof deriveFixedBackupCode === 'function') {
                appState.backupCode = deriveFixedBackupCode(appState.playerId);
            }
            stateChanged = true;
        }
        if (appState.playerId && typeof deriveFixedBackupCode === 'function') {
            const fixedCode = deriveFixedBackupCode(appState.playerId);
            if (appState.backupCode !== fixedCode) {
                appState.backupCode = fixedCode;
            }
        }

        // 同步後台禁止發話狀態
        const nextChatBanned = Boolean(me.isChatBanned);
        if (Boolean(appState.isChatBanned) !== nextChatBanned) {
            appState.isChatBanned = nextChatBanned;
            stateChanged = true;
        }


        // 同步並正規化後台已儲存的報名場次格式（統一為 第X屆M/D(三) / 第X屆M/D(六)）
        if (Array.isArray(me.registeredSessions)) {
            const normUserSessions = Array.from(new Set(me.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
            const normAppSessions = Array.from(new Set((appState.registeredSessions || []).map(s => normalizeSessionLabel(s)).filter(Boolean)));
            if (JSON.stringify(normUserSessions) !== JSON.stringify(normAppSessions)) {
                appState.registeredSessions = normUserSessions;
                stateChanged = true;
            }
        }

        // 3. 同步所有已配對好友（不限數量，支援 matchedHistory 與單筆 matchedWithId）
        const historyList = Array.isArray(me.matchedHistory) ? [...me.matchedHistory] : [];
        if (me.matchedSession && me.matchedWithId && !historyList.some(h => String(h.partnerId) === String(me.matchedWithId))) {
            historyList.push({
                session: me.matchedSession,
                partnerId: String(me.matchedWithId),
                partnerName: me.matchedWithName || '',
                matchedAt: me.matchedAt || Date.now(),
                continueVotes: []
            });
        }

        historyList.forEach(item => {
            const partner = users.find(u => String(u.id) === String(item.partnerId));
            if (partner && !appState.friends.some(f => String(f.id) === String(partner.id))) {
                const now = item.matchedAt || Date.now();
                const willReachMulti = appState.friends.length >= 1;
                if (willReachMulti && !appState.confessionUnlockAt) {
                    appState.multiFriendSince = now;
                    appState.confessionUnlockAt = calcConfessionUnlockTime(now);
                }

                const initialThread = [
                    { senderId: 'system', text: `🌸【${item.session}】20:00 月老牽線成功！好友名單將保留 7 天（聊天紀錄將永久保留，直到直接解除配對才會清空）。`, time: '' }
                ];
                if (me.oneSentence) {
                    initialThread.push({ senderId: String(me.id), senderName: me.nickname || '', text: me.oneSentence, time: '20:01' });
                }
                if (partner.oneSentence) {
                    initialThread.push({ senderId: String(partner.id), senderName: partner.nickname || '', text: partner.oneSentence, time: '20:01' });
                }
                const syncedMsgs = ChatStore.ensureThread(me.id, partner.id, initialThread);
                const votes = Array.isArray(item.continueVotes) ? item.continueVotes.map(String) : [];

                appState.friends.push({
                    id: String(partner.id),
                    nickname: partner.nickname,
                    sessionLabel: item.session,
                    matchedAt: now,
                    igUnlocked: Boolean(item.igUnlocked),
                    myContinue: votes.includes(String(me.id)),
                    partnerContinue: votes.includes(String(partner.id)),
                    profile: { ...partner },
                    privacy: partner.privacy || { gender: 'open', icebreakerQuestion: 'open' },
                    messages: syncedMsgs
                });

                appState.matchedSession = item.session;
                appState.activeFriendId = String(partner.id);
                stateChanged = true;
            }
        });

        // 4. 檢查後台是否已彈性解除特定配對（僅移除被解除的那位好友，其餘好友完整保留）
        const activeBackendPartnerIds = new Set(historyList.map(h => String(h.partnerId)));
        const beforeCount = appState.friends.length;
        appState.friends = appState.friends.filter(f => {
            if (String(f.id).startsWith('MOCK_FRIEND_')) return true;
            return activeBackendPartnerIds.has(String(f.id));
        });
        if (appState.friends.length !== beforeCount) {
            if (appState.friends.length < 2) {
                appState.multiFriendSince = null;
                appState.confessionUnlockAt = null;
            }
            stateChanged = true;
        }

        // 5. 同步所有真實配對好友的最新資料、延長後的 matchedAt、雙方繼續配對狀態與共享聊天紀錄
        appState.friends.forEach(f => {
            if (String(f.id).startsWith('MOCK_FRIEND_')) return;
            const latestPartner = users.find(u => String(u.id) === String(f.id));
            if (latestPartner) {
                f.nickname = latestPartner.nickname || f.nickname;
                f.profile = { ...latestPartner };
                f.privacy = latestPartner.privacy || f.privacy;
            }
            const histItem = historyList.find(h => String(h.partnerId) === String(f.id));
            if (histItem) {
                if (histItem.matchedAt && Number(f.matchedAt) !== Number(histItem.matchedAt)) {
                    f.matchedAt = Number(histItem.matchedAt);
                    stateChanged = true;
                }
                const nextIgUnlocked = Boolean(histItem.igUnlocked);
                if (Boolean(f.igUnlocked) !== nextIgUnlocked) {
                    f.igUnlocked = nextIgUnlocked;
                    stateChanged = true;
                }
                const votes = Array.isArray(histItem.continueVotes) ? histItem.continueVotes.map(String) : [];
                const nextMyCont = votes.includes(String(appState.playerId));
                const nextPartnerCont = votes.includes(String(f.id));
                if (Boolean(f.myContinue) !== nextMyCont || Boolean(f.partnerContinue) !== nextPartnerCont) {
                    f.myContinue = nextMyCont;
                    f.partnerContinue = nextPartnerCont;
                    stateChanged = true;
                }
            }
            const sharedMsgs = ChatStore.getMessages(appState.playerId, f.id);
            if (sharedMsgs.length > 0) {
                f.messages = sharedMsgs;
            }
        });
    }

    updateMailboxBadge();

    if (stateChanged) {
        Store.save(appState);
        renderProfileForm();
        refreshAllUI();
        if (isEveningConfessionPending()) {
            openEveningConfessionModal();
        }
    } else {
        if (chatsChanged) {
            Store.save(appState);
        }
        const curUsersRaw = localStorage.getItem(USERS_KEY) || '[]';
        if (curUsersRaw !== lastUsersStatsSnapshot) {
            renderHomeStatsCharts();
        }
        if (!document.getElementById('tab-friends').classList.contains('hidden')) {
            renderFriendsSection();
        }
        const curSched = getBatchScheduleInfo(getCurrentBatchNumber());
        document.getElementById('currentPeriodBadge').textContent = `目前開放：${curSched.batchPrefix}（${curSched.wedDateStr}(三) / ${curSched.satDateStr}(六)）`;
    }
}

function applyBackendTestEvent(cmd, latestUsers) {
    const targetId = cmd.targetPlayerId ? String(cmd.targetPlayerId).trim() : '';

    if (cmd.type === 'FILL_PLAYER_DATA') {
        if (!appState.playerId || String(appState.playerId) === targetId) {
            const userRecord = latestUsers.find(u => String(u.id) === targetId);
            if (userRecord) {
                appState.playerId = String(userRecord.id);
                appState.profile = { ...appState.profile, ...userRecord };
                if (!appState.profile.region && appState.profile.city) {
                    appState.profile.region = inferRegionByCity(appState.profile.city);
                }
                appState.isWarnedAccount = !!userRecord.isWarned;
                appState.warningReason = userRecord.warningReason || '';
                appState.isChatBanned = !!userRecord.isChatBanned;
            }
        }
    } else if (cmd.type === 'ADD_FRIEND_C') {
        if (targetId && String(appState.playerId) !== targetId) return;

        const mockNamesFemale = ['知夏 (C)', '柚子 (D)', '千尋 (E)', '美咲 (F)', '星奈 (G)', '綾乃 (H)'];
        const mockNamesMale = ['子豪 (C)', '柏翰 (D)', '冠宇 (E)', '承恩 (F)', '彥廷 (G)', '品叡 (H)'];
        const mockIndex = appState.friends.filter(f => String(f.id).startsWith('MOCK_FRIEND_')).length;
        const isMale = String(appState.playerId || '1').startsWith('1');
        const chosenName = isMale
            ? (mockNamesFemale[mockIndex] || `新好友_${mockIndex + 2}`)
            : (mockNamesMale[mockIndex] || `新好友_${mockIndex + 2}`);

        const now = Date.now();
        const willReachMulti = appState.friends.length >= 1;
        if (willReachMulti && !appState.confessionUnlockAt) {
            appState.multiFriendSince = now;
            appState.confessionUnlockAt = calcConfessionUnlockTime(now);
        }

        const newMockId = `MOCK_FRIEND_${Date.now()}_${mockIndex}`;
        const unlockAt = appState.confessionUnlockAt || calcConfessionUnlockTime(now);

        appState.friends.push({
            id: newMockId,
            nickname: chosenName,
            sessionLabel: getBatchScheduleInfo(getCurrentBatchNumber() + mockIndex + 1).wedLabel,
            matchedAt: now,
            myContinue: false,
            partnerContinue: false,
            profile: {
                gender: isMale ? '女' : '男',
                region: appState.profile.region || '中部',
                city: appState.profile.city || '台中市',
                mbti: 'ENFP',
                hobbies: ['音樂', '攝影', '藝文展覽'],
                oneSentence: '你好呀！很高興在紅線企劃與你相遇～',
                icebreakerQuestion: '最近有沒有讓你單曲循環的一首歌？'
            },
            privacy: { gender: 'open', icebreakerQuestion: 'open', city: 'open', mbti: 'open', hobbies: 'open', oneSentence: 'open' },
            messages: [
                { sender: 'system', text: `🌸 月老紅線牽起！因好友達 2 人以上，將於每隔 2 天的「${formatUnlockDateTime(unlockAt)}」觸發 20:00 心動抉擇。` },
                { sender: 'partner', text: '你好呀！很高興在這裡與你相遇～', time: '20:02' }
            ]
        });
        appState.activeFriendId = newMockId;
    } else if (cmd.type === 'ADVANCE_CONFESSION_2000') {
        if (appState.friends.length >= 2) {
            appState.confessionUnlockAt = Date.now() - 1000;
            appState.lastConfessionDate = null;
        }
    } else if (cmd.type === 'MINUS_ONE_DAY') {
        appState.friends.forEach(f => {
            if (String(f.id).startsWith('MOCK_FRIEND_')) {
                f.matchedAt = (f.matchedAt || Date.now()) - 24 * 60 * 60 * 1000;
            }
        });
    } else if (cmd.type === 'EXPIRE_TO_ZERO_DAYS') {
        appState.friends.forEach(f => {
            if (String(f.id).startsWith('MOCK_FRIEND_')) {
                f.matchedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
            }
        });
    } else if (cmd.type === 'PARTNER_ACCEPT_CONTINUE') {
        const target = appState.friends.find(f => String(f.id) === String(appState.activeFriendId)) || appState.friends[0];
        if (target) {
            if (!String(target.id).startsWith('MOCK_FRIEND_') && appState.playerId) {
                recordMutualContinueVote(appState.playerId, target.id, target.nickname, true);
            } else {
                target.partnerContinue = true;
                if (target.myContinue) {
                    completeMutualContinuation(target);
                } else {
                    target.messages.push({ sender: 'system', text: `💖 ${target.nickname} 已按下「繼續配對」，只要你也按下繼續即配對成功！` });
                }
            }
        }
    } else if (cmd.type === 'PARTNER_DECLINE_OR_TIMEOUT') {
        const target = appState.friends.find(f => String(f.id) === String(appState.activeFriendId)) || appState.friends[0];
        if (target) {
            clearMutualFriendship(target, `🍃 由於 ${target.nickname} 未按下繼續配對，兩邊好友名單已清空刪除。`);
        }
    }
}

function initSakuraPetals() {
    const container = document.getElementById('sakuraContainer');
    if (!container) return;
    for (let i = 0; i < 16; i++) {
        const petal = document.createElement('div');
        petal.className = 'petal';
        const size = Math.random() * 10 + 8;
        petal.style.width = `${size}px`;
        petal.style.height = `${size * 0.75}px`;
        petal.style.left = `${Math.random() * 100}%`;
        petal.style.animationDuration = `${Math.random() * 7 + 7}s`;
        petal.style.animationDelay = `${Math.random() * 5}s`;
        container.appendChild(petal);
    }
}

function renderRandomMoment() {
    const item = ROMANCE_MOMENTS[Math.floor(Math.random() * ROMANCE_MOMENTS.length)];
    document.getElementById('momentTag').textContent = item.category;
    document.getElementById('momentArt').textContent = item.art;
    document.getElementById('momentTitle').textContent = item.title;
    document.getElementById('momentText').textContent = item.text;
}

// ==================== 前台首頁：即時男女比例與 I人 / E人 / 不知道・沒測過 統計圖表 ====================
function renderHomeStatsCharts() {
    const totalBadge = document.getElementById('homeStatsTotalBadge');
    const donutBox = document.getElementById('genderDonutChartBox');
    const ieDonutBox = document.getElementById('ieDonutChartBox');
    if (!totalBadge || !donutBox || !ieDonutBox) return;

    const rawUsersStr = localStorage.getItem(USERS_KEY) || '[]';
    lastUsersStatsSnapshot = rawUsersStr;

    let users = [];
    try {
        users = JSON.parse(rawUsersStr);
        if (!Array.isArray(users)) users = [];
    } catch (e) {
        users = [];
    }

    const validUsers = users.filter(u => u && typeof u === 'object' && u.id);
    const totalCount = validUsers.length;
    let maleCount = 0;
    let femaleCount = 0;
    let iPersonCount = 0;
    let ePersonCount = 0;
    let untestedMbtiCount = 0;

    validUsers.forEach(u => {
        if (u.gender === '男') maleCount++;
        else if (u.gender === '女') femaleCount++;

        const rawMbti = String(u.mbti || '').trim().toUpperCase();
        const grp = u.mbtiGroup || inferMbtiGroup(rawMbti);

        if (!rawMbti || rawMbti.includes('不知道') || rawMbti.includes('沒測過') || grp === '不知道 / 沒測過') {
            if (grp === 'I人') iPersonCount++;
            else if (grp === 'E人') ePersonCount++;
            else untestedMbtiCount++;
        } else {
            if (grp === 'I人' || rawMbti.startsWith('I')) iPersonCount++;
            else if (grp === 'E人' || rawMbti.startsWith('E')) ePersonCount++;
            else untestedMbtiCount++;
        }
    });

    const genderTotal = maleCount + femaleCount;
    const malePct = genderTotal > 0 ? Math.round((maleCount / genderTotal) * 100) : 0;
    const femalePct = genderTotal > 0 ? (100 - malePct) : 0;

    totalBadge.textContent = `總計 ${totalCount} 人`;
    document.getElementById('genderRatioSummaryTag').textContent = `男 ${maleCount} 女 ${femaleCount}`;
    document.getElementById('statMaleText').textContent = `${maleCount} 人 (${malePct}%)`;
    document.getElementById('statFemaleText').textContent = `${femaleCount} 人 (${femalePct}%)`;
    document.getElementById('statMaleBar').style.width = `${malePct}%`;
    document.getElementById('statFemaleBar').style.width = `${femalePct}%`;

    // 更新 I人 / E人 / 不知道・沒測過 數量紀錄與比例條
    const mbtiAllTotal = iPersonCount + ePersonCount + untestedMbtiCount;
    const iPct = mbtiAllTotal > 0 ? Math.round((iPersonCount / mbtiAllTotal) * 100) : 0;
    const ePct = mbtiAllTotal > 0 ? Math.round((ePersonCount / mbtiAllTotal) * 100) : 0;
    const untestedPct = mbtiAllTotal > 0 ? Math.round((untestedMbtiCount / mbtiAllTotal) * 100) : 0;

    const iTextEl = document.getElementById('statMbtiIText');
    const eTextEl = document.getElementById('statMbtiEText');
    const untestedTextEl = document.getElementById('statMbtiUntestedText');
    const iBarEl = document.getElementById('statMbtiIBar');
    const eBarEl = document.getElementById('statMbtiEBar');
    const untestedBarEl = document.getElementById('statMbtiUntestedBar');

    if (iTextEl) iTextEl.textContent = `${iPersonCount} 人 (${iPct}%)`;
    if (eTextEl) eTextEl.textContent = `${ePersonCount} 人 (${ePct}%)`;
    if (untestedTextEl) untestedTextEl.textContent = `${untestedMbtiCount} 人 (${untestedPct}%)`;
    if (iBarEl) iBarEl.style.width = `${iPct}%`;
    if (eBarEl) eBarEl.style.width = `${ePct}%`;
    if (untestedBarEl) untestedBarEl.style.width = `${untestedPct}%`;

    // SVG 雙色圓環圖（男：天藍色 #38bdf8 / 女：櫻花粉 #fb7185）
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const maleArc = genderTotal > 0 ? (maleCount / genderTotal) * circumference : 0;
    const femaleArc = genderTotal > 0 ? (femaleCount / genderTotal) * circumference : 0;

    donutBox.innerHTML = `
        <svg viewBox="0 0 132 132" class="w-36 h-36 -rotate-90">
            <circle cx="66" cy="66" r="${radius}" fill="none" stroke="#fce7f3" stroke-width="16"></circle>
            ${genderTotal > 0 ? `
                <circle cx="66" cy="66" r="${radius}" fill="none" stroke="#fb7185" stroke-width="16"
                    stroke-dasharray="${femaleArc} ${circumference}" stroke-dashoffset="0"></circle>
                <circle cx="66" cy="66" r="${radius}" fill="none" stroke="#38bdf8" stroke-width="16"
                    stroke-dasharray="${maleArc} ${circumference}" stroke-dashoffset="${-femaleArc}"></circle>
            ` : ''}
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <span class="text-[10px] text-gray-400 font-medium">已登記人數</span>
            <span class="text-lg font-bold font-serif-jp text-[#8f4452] leading-tight">${totalCount} 人</span>
        </div>
    `;

    // SVG 三色圓環圖（I人：靛紫色 #818cf8 / E人：暖琥珀 #fbbf24 / 不知道・沒測過：霧灰藍 #94a3b8）
    const iArc = mbtiAllTotal > 0 ? (iPersonCount / mbtiAllTotal) * circumference : 0;
    const eArc = mbtiAllTotal > 0 ? (ePersonCount / mbtiAllTotal) * circumference : 0;
    const untestedArc = mbtiAllTotal > 0 ? (untestedMbtiCount / mbtiAllTotal) * circumference : 0;

    ieDonutBox.innerHTML = `
        <svg viewBox="0 0 132 132" class="w-36 h-36 -rotate-90">
            <circle cx="66" cy="66" r="${radius}" fill="none" stroke="#fce7f3" stroke-width="16"></circle>
            ${mbtiAllTotal > 0 ? `
                <circle cx="66" cy="66" r="${radius}" fill="none" stroke="#818cf8" stroke-width="16"
                    stroke-dasharray="${iArc} ${circumference}" stroke-dashoffset="0"></circle>
                <circle cx="66" cy="66" r="${radius}" fill="none" stroke="#fbbf24" stroke-width="16"
                    stroke-dasharray="${eArc} ${circumference}" stroke-dashoffset="${-iArc}"></circle>
                <circle cx="66" cy="66" r="${radius}" fill="none" stroke="#94a3b8" stroke-width="16"
                    stroke-dasharray="${untestedArc} ${circumference}" stroke-dashoffset="${-(iArc + eArc)}"></circle>
            ` : ''}
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <span class="text-[10px] text-gray-400 font-medium">已登記人數</span>
            <span class="text-lg font-bold font-serif-jp text-[#8f4452] leading-tight">${mbtiAllTotal} 人</span>
        </div>
    `;
}


function switchTab(tabName) {
    document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tabBtn === tabName);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabName === 'friends') {
        renderFriendsSection();
        if (isEveningConfessionPending()) {
            openEveningConfessionModal();
        }
    }
}

// ==================== 前台玩家信件箱（管理員發送信件／文字查看） ====================
function getPlayerMails() {
    const allMails = Store.getMailbox();
    return allMails.filter(m => {
        if (!m) return false;
        if (m.targetId === 'ALL') return true;
        return appState.playerId && String(m.targetId) === String(appState.playerId);
    });
}

function updateMailboxBadge() {
    const mails = getPlayerMails();
    const readSet = new Set(appState.readMailIds || []);
    const unreadCount = mails.filter(m => !readSet.has(m.id)).length;
    const badge = document.getElementById('mailboxUnreadBadge');
    if (!badge) return;

    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function openMailboxModal() {
    backToMailboxList();
    renderMailboxList();
    document.getElementById('mailboxModal').classList.remove('hidden');
}

function closeMailboxModal() {
    document.getElementById('mailboxModal').classList.add('hidden');
}

function renderMailboxList() {
    const listEl = document.getElementById('mailboxListView');
    const mails = getPlayerMails();
    const readSet = new Set(appState.readMailIds || []);

    if (mails.length === 0) {
        listEl.innerHTML = `
            <div class="text-center py-8 text-xs text-gray-400 bg-pink-50/40 rounded-2xl border border-dashed border-pink-200">
                目前信箱還沒有管理員寄來的信件 🌸
            </div>
        `;
        return;
    }

    listEl.innerHTML = mails.map(m => {
        const isRead = readSet.has(m.id);
        return `
            <div onclick="viewMailDetail('${m.id}')" class="cursor-pointer p-3 rounded-2xl border transition-all ${isRead ? 'bg-white border-pink-100 hover:border-pink-300' : 'bg-pink-50/85 border-[#c96a7b] shadow-2xs'}">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0 font-bold ${isRead ? 'bg-gray-100 text-gray-500' : 'bg-rose-500 text-white'}">
                            ${isRead ? '已讀' : '未讀'}
                        </span>
                        <h4 class="text-xs font-bold text-[#8f4452] truncate">${m.title || '管理員通知信件'}</h4>
                    </div>
                    <span class="text-[10px] text-gray-400 shrink-0">${m.createdAt || ''}</span>
                </div>
                <p class="text-[11px] text-gray-500 truncate mt-1">${m.content || ''}</p>
            </div>
        `;
    }).join('');
}

function viewMailDetail(mailId) {
    const mails = getPlayerMails();
    const mail = mails.find(m => m.id === mailId);
    if (!mail) return;

    if (!Array.isArray(appState.readMailIds)) appState.readMailIds = [];
    if (!appState.readMailIds.includes(mailId)) {
        appState.readMailIds.push(mailId);
        Store.save(appState);
        updateMailboxBadge();
    }

    document.getElementById('mailDetailTitle').textContent = mail.title || '管理員通知信件';
    document.getElementById('mailDetailTime').textContent = mail.createdAt || '';
    document.getElementById('mailDetailBody').textContent = mail.content || '';

    document.getElementById('mailboxListView').classList.add('hidden');
    document.getElementById('mailboxDetailView').classList.remove('hidden');
}

function backToMailboxList() {
    document.getElementById('mailboxDetailView').classList.add('hidden');
    document.getElementById('mailboxListView').classList.remove('hidden');
    renderMailboxList();
}

// ==================== 週三 (3) 與週六 (6) 20:00 倒數計時 ====================
function updateNextMatchCountdown() {
    const now = new Date();
    let target = new Date(now);
    target.setHours(20, 0, 0, 0);

    if ((target.getDay() === 3 || target.getDay() === 6) && now >= target) {
        target.setDate(target.getDate() + 1);
    }

    while (target.getDay() !== 3 && target.getDay() !== 6) {
        target.setDate(target.getDate() + 1);
    }

    const diff = target - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);

    const dayLabel = target.getDay() === 3 ? '週三' : '週六';
    document.getElementById('nextMatchCountdown').textContent =
        `${dayLabel} 20:00｜${days}天 ${String(hours).padStart(2, '0')}時 ${String(mins).padStart(2, '0')}分 ${String(secs).padStart(2, '0')}秒`;
}

function calcConfessionUnlockTime(baseTs = Date.now()) {
    const d = new Date(baseTs);
    d.setHours(20, 0, 0, 0);
    d.setDate(d.getDate() + 2);
    return d.getTime();
}

function formatUnlockDateTime(ts) {
    const d = new Date(ts);
    const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    return `${days[d.getDay()]} 20:00（${d.getMonth() + 1}/${d.getDate()} 20:00）`;
}

// ==================== 問題回報（僅後台可見） ====================
function openReportModal() {
    const contactInput = document.getElementById('reportContact');
    if (!contactInput.value && (appState.playerId || appState.profile.nickname)) {
        contactInput.value = `ID:${appState.playerId || '未產生'} / ${appState.profile.nickname || ''}`;
    }
    document.getElementById('reportModal').classList.remove('hidden');
}

function closeReportModal() {
    document.getElementById('reportModal').classList.add('hidden');
}

document.getElementById('issueReportForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const category = document.getElementById('reportCategory').value;
    const contact = document.getElementById('reportContact').value.trim();
    const content = document.getElementById('reportContent').value.trim();
    if (!content) return;

    Store.addIssueReport({ category, contact, content });
    this.reset();
    closeReportModal();
    showMiniNotice('📮 問題回報已送出', '此內容僅後台管理員看得到，我們會盡快確認處理。');
});

// ==================== 個人資料表單（男女生人數限制、先選地區再選縣市、鎖定反灰、隱私可自由調整） ====================
function getMissingRequiredFields() {
    const missing = [];
    for (const sec of FIELD_SECTIONS) {
        for (const f of sec.fields) {
            if (!isFieldRequired(f)) continue;
            const cleanLabel = f.label.split('（')[0];
            if (f.type === 'regionCity') {
                if (!String(appState.profile.region || '').trim()) {
                    missing.push({ key: 'region', label: `${cleanLabel}（地區）` });
                } else if (!String(appState.profile.city || '').trim()) {
                    missing.push({ key: 'city', label: `${cleanLabel}（縣市）` });
                }
            } else if (f.type === 'mbtiTwoStep') {
                const grp = String(appState.profile.mbtiGroup || inferMbtiGroup(appState.profile.mbti) || '').trim();
                const code = String(appState.profile.mbti || '').trim();
                if (!grp) {
                    missing.push({ key: 'mbti', label: `${cleanLabel}（請先選 I人 或 E人）` });
                } else if (grp !== '不知道 / 沒測過' && !code) {
                    missing.push({ key: 'mbti', label: `${cleanLabel}（請選擇 ${grp} 具體人格）` });
                }
            } else if (f.type === 'multiselect') {
                const val = appState.profile[f.key];
                if (!Array.isArray(val) || val.length === 0) {
                    missing.push({ key: f.key, label: cleanLabel });
                } else if (f.allowOther && val.includes('其他') && !String(appState.profile[`${f.key}Other`] || '').trim()) {
                    missing.push({ key: `${f.key}Other`, label: `${cleanLabel}（其他說明）` });
                }
            } else {
                const val = appState.profile[f.key];
                if (val === undefined || val === null || String(val).trim() === '') {
                    missing.push({ key: f.key, label: cleanLabel });
                } else if (f.type === 'number' && (f.min !== undefined || f.max !== undefined)) {
                    const numVal = Number(val);
                    if (isNaN(numVal) || (f.min !== undefined && numVal < f.min) || (f.max !== undefined && numVal > f.max)) {
                        missing.push({ key: f.key, label: `${cleanLabel}（需介於 ${f.min ?? ''}～${f.max ?? ''} 歲）` });
                    }
                } else if (f.allowOther && String(val).trim() === '其他' && !String(appState.profile[`${f.key}Other`] || '').trim()) {
                    missing.push({ key: `${f.key}Other`, label: `${cleanLabel}（其他說明）` });
                }
            }
        }
    }
    return missing;
}

function isProfileComplete() {
    return getMissingRequiredFields().length === 0;
}

function renderProfileForm() {
    const container = document.getElementById('dynamicProfileSections');
    const isTestOptional = (typeof TEST_MODE_OPTIONAL_FIELDS !== 'undefined' && TEST_MODE_OPTIONAL_FIELDS);
    const idDisplay = appState.playerId
        ? appState.playerId
        : (isTestOptional ? '尚未產生（測試階段免必填，可直接按保存產生）' : '尚未產生（填完必填並保存後自動產生）');
    const sysConfig = Store.getSystemConfig();
    const quota = Store.getGenderQuotaStatus();
    const isBothGenderFullForNew = !appState.playerId && quota.bothFull;
    const isLocked = sysConfig.profileLocked || isBothGenderFullForNew;

    // 隱私快捷全開/全隱藏按鈕不受個人資料鎖定限制
    const profileTab = document.getElementById('tab-profile');
    if (profileTab) {
        profileTab.querySelectorAll('button[onclick^="setAllFieldsPrivacy"]').forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        });
    }

    const submitBtn = document.querySelector('#profileForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = isLocked;
        if (isBothGenderFullForNew) {
            submitBtn.textContent = '🚫 男/女人數已滿';
        } else if (sysConfig.profileLocked) {
            submitBtn.textContent = '🔒 個人資料已鎖定（不開放修改或新增）';
        } else {
            submitBtn.textContent = '保存';
        }
    }

    let topNoticeHtml = '';
    if (isBothGenderFullForNew) {
        topNoticeHtml = `
            <div class="p-4 rounded-2xl bg-rose-50 border-2 border-rose-400 text-xs text-rose-700 font-bold flex items-center gap-2">
                <span>🚫</span>
                <span>男/女人數已滿（目前男生 ${quota.maleCount}/${quota.limit} 人、女生 ${quota.femaleCount}/${quota.limit} 人），目前不開放未填寫資料的新玩家填寫。</span>
            </div>
        `;
    } else if (sysConfig.profileLocked) {
        topNoticeHtml = `
            <div class="p-4 rounded-2xl bg-gray-100 border border-gray-300 text-xs text-gray-700 font-semibold flex items-center gap-2">
                <span>🔒</span>
                <span>管理員已開啟「不讓玩家填寫資料」，所有個人資料欄位已反灰鎖定（不可修改或新增），但「個人隱私開放／隱藏」仍可自由調整。</span>
            </div>
        `;
    } else if (!appState.playerId && (quota.maleFull || quota.femaleFull)) {
        const fullText = quota.maleFull
            ? `男生人數已滿（${quota.maleCount}/${quota.limit} 人），男生禁止選取，性別只能選擇「女生」。`
            : `女生人數已滿（${quota.femaleCount}/${quota.limit} 人），女生禁止選取，性別只能選擇「男生」。`;
        topNoticeHtml = `
            <div class="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-xs text-amber-800 font-semibold flex items-center gap-2">
                <span>⚠️</span>
                <span>${fullText}</span>
            </div>
        `;
    } else if (isTestOptional) {
        topNoticeHtml = `
            <div class="p-3.5 rounded-2xl bg-pink-50/80 border border-pink-200 text-xs text-[#8f4452] font-medium flex items-center gap-2">
                <span>🧪</span>
                <span>測試階段模式：目前所有欄位皆免必填，可直接按「保存」產生玩家 ID 並同步至後台（正式上線時於 data.js 將 TEST_MODE_OPTIONAL_FIELDS 改為 false 即可恢復必填）。</span>
            </div>
        `;
    }

    container.innerHTML = `
        ${topNoticeHtml}
        ${FIELD_SECTIONS.map((sec, sIdx) => `
            <div class="space-y-4">
                <h3 class="text-lg font-bold font-serif-jp text-[#8f4452] border-b border-pink-100 pb-2">${sec.title}</h3>

                ${sIdx === 0 ? `
                    <div class="p-4 rounded-2xl ${isLocked ? 'bg-gray-100 border-gray-300' : 'bg-gradient-to-r from-pink-50 to-rose-50/80 border-pink-200'} border space-y-2">
                        <label class="text-sm md:text-base font-bold ${isLocked ? 'text-gray-500' : 'text-[#8f4452]'} block">玩家專屬 ID</label>
                        <input type="text" value="${idDisplay}" readonly class="input-jp font-mono font-bold text-sm ${isLocked ? '!bg-gray-200 !text-gray-500 !border-gray-300' : ''}">
                    </div>
                ` : ''}

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${sec.fields.map(f => renderSingleFieldCard(f, sec.defaultPrivacy, isLocked, quota)).join('')}
                </div>
            </div>
        `).join('')}
    `;
}

function renderSingleFieldCard(field, sectionDefaultPriv, isProfileLocked, quota) {
    let val = appState.profile[field.key];
    const priv = field.alwaysOpen ? 'open' : (appState.privacy[field.key] || sectionDefaultPriv || 'closed');
    const fullWidthClass = (field.type === 'textarea' || field.type === 'multiselect' || field.type === 'regionCity' || field.type === 'mbtiTwoStep') ? 'md:col-span-2' : '';
    const isGenderLocked = (field.key === 'gender' && !!appState.playerId);
    const isInputDisabled = isProfileLocked || isGenderLocked;
    const lockedInputStyle = isProfileLocked ? '!bg-gray-100 !text-gray-400 !border-gray-300 cursor-not-allowed' : '';

    let inputHtml = '';
    let extraGenderNoticeHtml = '';

    if (field.type === 'regionCity') {
        const selectedRegion = appState.profile.region || inferRegionByCity(val) || '';
        const selectedCity = val || '';
        const cityList = selectedRegion ? (REGION_CITIES[selectedRegion] || []) : [];

        inputHtml = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 1：先選地區</label>
                    <select name="region" id="profileRegionSelect" onchange="onProfileRegionChange(this.value)" class="input-jp ${lockedInputStyle}" ${isProfileLocked ? 'disabled' : ''}>
                        <option value="">請先選擇地區...</option>
                        ${REGION_OPTIONS.map(reg => `<option value="${reg}" ${selectedRegion === reg ? 'selected' : ''}>${reg}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 2：再選縣市</label>
                    <select name="city" id="profileCitySelect" onchange="onProfileCityChange(this.value)" class="input-jp ${lockedInputStyle}" ${(isProfileLocked || !selectedRegion) ? 'disabled' : ''}>
                        <option value="">${selectedRegion ? '請選擇縣市...' : '請先選擇左側地區...'}</option>
                        ${cityList.map(c => `<option value="${c}" ${selectedCity === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
    } else if (field.type === 'mbtiTwoStep') {
        const selectedGroup = appState.profile.mbtiGroup || inferMbtiGroup(val) || '';
        const selectedMbti = val || '';
        const subMbtiList = (selectedGroup === 'I人' || selectedGroup === 'E人') ? (MBTI_GROUPS[selectedGroup] || []) : [];
        const isUntested = selectedGroup === '不知道 / 沒測過';

        inputHtml = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 1：先選 I人 或 E人</label>
                    <select name="mbtiGroup" id="profileMbtiGroupSelect" onchange="onProfileMbtiGroupChange(this.value)" class="input-jp ${lockedInputStyle}" ${isProfileLocked ? 'disabled' : ''}>
                        <option value="">請先選擇 I人 或 E人...</option>
                        <option value="I人" ${selectedGroup === 'I人' ? 'selected' : ''}>I人（內向型）</option>
                        <option value="E人" ${selectedGroup === 'E人' ? 'selected' : ''}>E人（外向型）</option>
                        <option value="不知道 / 沒測過" ${isUntested ? 'selected' : ''}>不知道 / 沒測過</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 2：再選具體 MBTI 人格</label>
                    <select name="mbti" id="profileMbtiSelect" onchange="onProfileMbtiChange(this.value)" class="input-jp ${lockedInputStyle}" ${(isProfileLocked || !selectedGroup || isUntested) ? 'disabled' : ''}>
                        ${isUntested
                            ? '<option value="不知道 / 沒測過" selected>不知道 / 沒測過</option>'
                            : `
                                <option value="">${selectedGroup ? `請選擇 ${selectedGroup} 開頭的人格...` : '請先選擇左側 I人 或 E人...'}</option>
                                ${subMbtiList.map(code => `<option value="${code}" ${selectedMbti === code ? 'selected' : ''}>${code}</option>`).join('')}
                            `
                        }
                    </select>
                    <input type="hidden" id="profileMbtiHidden" name="mbti" value="${isUntested ? '不知道 / 沒測過' : selectedMbti}">
                </div>
            </div>
        `;
    } else if (field.type === 'select') {
        if (field.key === 'gender') {
            const isMaleBlocked = !appState.playerId && !isProfileLocked && quota.maleFull;
            const isFemaleBlocked = !appState.playerId && !isProfileLocked && quota.femaleFull;

            if (isMaleBlocked && val === '男') {
                appState.profile.gender = '';
                val = '';
            }
            if (isFemaleBlocked && val === '女') {
                appState.profile.gender = '';
                val = '';
            }

            inputHtml = `
                <select name="gender" id="profileGenderSelect" onchange="onProfileGenderChange(this.value)" class="input-jp ${lockedInputStyle}" ${isFieldRequired(field) ? 'required' : ''} ${isInputDisabled ? 'disabled' : ''}>
                    <option value="">請選擇性別（僅限男 / 女）...</option>
                    <option value="男" ${val === '男' ? 'selected' : ''} ${isMaleBlocked ? 'disabled' : ''}>
                        ${isMaleBlocked ? '男（男生人數已滿，禁止選取）' : '男'}
                    </option>
                    <option value="女" ${val === '女' ? 'selected' : ''} ${isFemaleBlocked ? 'disabled' : ''}>
                        ${isFemaleBlocked ? '女（女生人數已滿，禁止選取）' : '女'}
                    </option>
                </select>
                ${isGenderLocked ? `<input type="hidden" name="gender" value="${val}">` : ''}
            `;

            if (isMaleBlocked) {
                extraGenderNoticeHtml = `<p class="text-xs font-bold text-rose-600">🚫 男生人數已滿（${quota.maleCount}/${quota.limit} 人），男生禁止選取，性別只能選擇「女」。</p>`;
            } else if (isFemaleBlocked) {
                extraGenderNoticeHtml = `<p class="text-xs font-bold text-rose-600">🚫 女生人數已滿（${quota.femaleCount}/${quota.limit} 人），女生禁止選取，性別只能選擇「男」。</p>`;
            } else if (quota.enabled && !appState.playerId && !isProfileLocked) {
                extraGenderNoticeHtml = `<p class="text-[11px] text-[#8f4452] font-medium">📊 目前男女名額統計：男生 ${quota.maleCount}/${quota.limit} 人、女生 ${quota.femaleCount}/${quota.limit} 人</p>`;
            }
        } else {
            const otherText = appState.profile[`${field.key}Other`] || '';
            const hasOther = field.allowOther && val === '其他';
            inputHtml = `
                <select name="${field.key}" ${field.allowOther ? `onchange="onSelectWithOtherChange('${field.key}', this.value)"` : ''} class="input-jp ${lockedInputStyle}" ${isFieldRequired(field) ? 'required' : ''} ${isInputDisabled ? 'disabled' : ''}>
                    <option value="">請選擇...</option>
                    ${field.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
                ${field.allowOther ? `
                    <input type="text" id="select-other-${field.key}" name="${field.key}Other" value="${otherText}" ${isInputDisabled ? 'disabled' : ''} oninput="onSelectOtherInput('${field.key}', this.value)" class="input-jp mt-2 ${lockedInputStyle} ${hasOther ? '' : 'hidden'}" placeholder="${field.otherPlaceholder || '請自行填寫其他說明...'}">
                ` : ''}
            `;
        }
    } else if (field.type === 'textarea') {
        inputHtml = `<textarea name="${field.key}" rows="3" class="input-jp resize-y ${lockedInputStyle}" placeholder="${field.placeholder || ''}" ${isFieldRequired(field) ? 'required' : ''} ${isProfileLocked ? 'disabled' : ''}>${val || ''}</textarea>`;
    } else if (field.type === 'multiselect') {
        const arr = Array.isArray(val) ? val : [];
        const otherText = appState.profile[`${field.key}Other`] || '';
        const hasOther = arr.includes('其他');

        inputHtml = `
            <div class="multiselect-wrapper relative ${isProfileLocked ? 'opacity-65 pointer-events-none select-none' : ''}" id="ms-wrap-${field.key}">
                <div class="multiselect-trigger ${isProfileLocked ? '!bg-gray-100 !border-gray-300 !text-gray-400 cursor-not-allowed' : ''}" onclick="toggleMultiSelectMenu('${field.key}')">
                    <div id="ms-chips-${field.key}" class="flex flex-wrap gap-1.5 flex-1">
                        ${renderMultiSelectChipsHtml(field.key, arr, otherText, isProfileLocked)}
                    </div>
                    <span class="text-xs ${isProfileLocked ? 'text-gray-400' : 'text-[#c96a7b]'} font-bold shrink-0">▾ 選擇</span>
                </div>
                <div id="ms-menu-${field.key}" class="multiselect-menu hidden">
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        ${field.options.map(opt => `
                            <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-pink-50 text-xs cursor-pointer">
                                <input type="checkbox" value="${opt}" ${arr.includes(opt) ? 'checked' : ''} ${isProfileLocked ? 'disabled' : ''} onchange="onMultiSelectChange('${field.key}', ${!!field.allowOther})" class="accent-[#c96a7b]">
                                <span>${opt}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                ${field.allowOther ? `
                    <input type="text" id="ms-other-${field.key}" name="${field.key}Other" value="${otherText}" ${isProfileLocked ? 'disabled' : ''} oninput="onMultiSelectOtherInput('${field.key}')" class="input-jp mt-2 ${lockedInputStyle} ${hasOther ? '' : 'hidden'}" placeholder="請自行填寫其他興趣（例如：衝浪、調酒、露營）...">
                ` : ''}
            </div>
        `;
    } else {
        const minAttr = field.min !== undefined ? `min="${field.min}"` : '';
        const maxAttr = field.max !== undefined ? `max="${field.max}"` : '';
        inputHtml = `<input type="${field.type}" name="${field.key}" value="${val || ''}" ${minAttr} ${maxAttr} class="input-jp ${lockedInputStyle}" placeholder="${field.placeholder || ''}" ${isFieldRequired(field) ? 'required' : ''} ${isProfileLocked ? 'disabled' : ''}>`;
    }

    let hintsHtml = '';
    if (Array.isArray(field.hints) && field.hints.length > 0) {
        hintsHtml = `
            <div class="mt-2 p-3 rounded-xl ${isProfileLocked ? 'bg-gray-100/80 border-gray-200 text-gray-400' : 'bg-pink-50/70 border-pink-100 text-[#7a3b46]'} border text-[11px] space-y-1">
                <p class="font-semibold ${isProfileLocked ? 'text-gray-500' : 'text-[#8f4452]'}">💡 不知道寫什麼？參考以下 5 個破冰提問舉例：</p>
                <ul class="list-disc list-inside space-y-0.5 ${isProfileLocked ? 'text-gray-400' : 'text-gray-600'}">
                    ${field.hints.map(h => `<li>${h}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    // 個人隱私「開放 / 隱藏」控制完全不受 isProfileLocked 限制
    let privacyControlHtml = '';
    let privHint = '';

    if (field.alwaysOpen) {
        privacyControlHtml = `
            <span class="text-[11px] px-2.5 py-1 rounded-full bg-pink-100 text-[#8f4452] font-semibold">
                🌸 固定開放（不可隱藏）
            </span>
        `;
        privHint = '🌸 此欄位為固定開放，配對好友可直接看到';
    } else if (field.autoOpenAfter7Days) {
        privacyControlHtml = `
            <span class="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 font-semibold">
                ⏳ 預設不開放（雙方7天後成為好友自動開放）
            </span>
        `;
        privHint = '🔒 前 7 天預設隱藏；滿 7 天雙方皆按下「繼續配對」成為好友時，系統會自動開放給對方';
    } else {
        privacyControlHtml = `
            <div class="flex items-center gap-1.5" id="priv-group-${field.key}">
                <button type="button" onclick="setFieldPrivacy('${field.key}', 'closed')" class="privacy-pill ${priv === 'closed' ? 'active-closed' : ''}">
                    不開放
                </button>
                <button type="button" onclick="setFieldPrivacy('${field.key}', 'open')" class="privacy-pill ${priv === 'open' ? 'active-open' : ''}">
                    開放給好友
                </button>
            </div>
        `;
        privHint = priv === 'open'
            ? '🌸 已對目前配對好友開放顯示'
            : '🙈 目前不開放（需點選「開放給好友」對方才看得到）';
    }

    return `
        <div id="field-card-${field.key}" class="${fullWidthClass} p-3.5 rounded-2xl ${isProfileLocked ? 'bg-gray-50/90 border-gray-200' : 'bg-white/75 border-pink-100/90'} border space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <label class="text-sm md:text-base font-bold leading-snug ${isProfileLocked ? 'text-gray-400' : 'text-[#5e464a]'}">
                        ${field.label} ${isFieldRequired(field) ? '<span class="text-rose-500">*</span>' : ''}
                    </label>
                    ${field.subtitle ? `<p class="text-[11px] text-gray-400">${field.subtitle}</p>` : ''}
                </div>
                ${privacyControlHtml}
            </div>
            ${inputHtml}
            ${extraGenderNoticeHtml}
            ${hintsHtml}
            <p id="priv-hint-${field.key}" class="text-[11px] text-gray-400">${privHint}</p>
        </div>
    `;
}

window.onProfileGenderChange = function(genderVal) {
    if (appState.playerId || Store.getSystemConfig().profileLocked) return;
    const quota = Store.getGenderQuotaStatus();
    if (genderVal === '男' && quota.maleFull) {
        appState.profile.gender = '';
        renderProfileForm();
        showMiniNotice('🚫 男生人數已滿', '男生人數已滿，男生禁止選取，性別只能選擇「女」。');
        return;
    }
    if (genderVal === '女' && quota.femaleFull) {
        appState.profile.gender = '';
        renderProfileForm();
        showMiniNotice('🚫 女生人數已滿', '女生人數已滿，女生禁止選取，性別只能選擇「男」。');
        return;
    }
    appState.profile.gender = genderVal || '';
};

window.onProfileRegionChange = function(regionVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.region = regionVal || '';
    appState.profile.city = '';

    const citySel = document.getElementById('profileCitySelect');
    if (citySel) {
        if (!regionVal) {
            citySel.disabled = true;
            citySel.innerHTML = '<option value="">請先選擇左側地區...</option>';
        } else {
            const cities = REGION_CITIES[regionVal] || [];
            citySel.disabled = false;
            citySel.innerHTML = '<option value="">請選擇縣市...</option>' +
                cities.map(c => `<option value="${c}">${c}</option>`).join('');
            if (cities.length === 1) {
                citySel.value = cities[0];
                appState.profile.city = cities[0];
            }
        }
    }
};

window.onProfileCityChange = function(cityVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.city = cityVal || '';
};

window.onProfileMbtiGroupChange = function(groupVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.mbtiGroup = groupVal || '';
    const mbtiSel = document.getElementById('profileMbtiSelect');
    const mbtiHidden = document.getElementById('profileMbtiHidden');

    if (groupVal === '不知道 / 沒測過') {
        appState.profile.mbti = '不知道 / 沒測過';
        if (mbtiSel) {
            mbtiSel.disabled = true;
            mbtiSel.innerHTML = '<option value="不知道 / 沒測過" selected>不知道 / 沒測過</option>';
        }
        if (mbtiHidden) mbtiHidden.value = '不知道 / 沒測過';
        return;
    }

    if (!groupVal || !MBTI_GROUPS[groupVal]) {
        appState.profile.mbti = '';
        if (mbtiSel) {
            mbtiSel.disabled = true;
            mbtiSel.innerHTML = '<option value="">請先選擇左側 I人 或 E人...</option>';
        }
        if (mbtiHidden) mbtiHidden.value = '';
        return;
    }

    const validList = MBTI_GROUPS[groupVal];
    if (!validList.includes(appState.profile.mbti)) {
        appState.profile.mbti = '';
    }
    if (mbtiSel) {
        mbtiSel.disabled = false;
        mbtiSel.innerHTML = `<option value="">請選擇 ${groupVal} 開頭的人格...</option>` +
            validList.map(code => `<option value="${code}" ${appState.profile.mbti === code ? 'selected' : ''}>${code}</option>`).join('');
    }
    if (mbtiHidden) mbtiHidden.value = appState.profile.mbti || '';
};

window.onProfileMbtiChange = function(mbtiVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.mbti = mbtiVal || '';
    if (mbtiVal && !appState.profile.mbtiGroup) {
        appState.profile.mbtiGroup = inferMbtiGroup(mbtiVal);
    }
    const mbtiHidden = document.getElementById('profileMbtiHidden');
    if (mbtiHidden) mbtiHidden.value = mbtiVal || '';
};

window.onSelectWithOtherChange = function(key, val) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile[key] = val || '';
    const otherInput = document.getElementById(`select-other-${key}`);
    if (otherInput) {
        if (val === '其他') {
            otherInput.classList.remove('hidden');
            otherInput.focus();
        } else {
            otherInput.classList.add('hidden');
            otherInput.value = '';
            appState.profile[`${key}Other`] = '';
        }
    }
};

window.onSelectOtherInput = function(key, val) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile[`${key}Other`] = val || '';
};

function renderMultiSelectChipsHtml(key, selectedArr, otherText, isLocked = false) {
    if (!selectedArr || selectedArr.length === 0) {
        return `<span class="text-xs text-gray-400 py-0.5">${isLocked ? '未選擇（已鎖定）' : '點擊下拉選單選擇（可複選）...'}</span>`;
    }
    return selectedArr.map(item => {
        const displayLabel = (item === '其他' && otherText) ? `其他：${otherText}` : item;
        return `<span class="multiselect-chip ${isLocked ? '!bg-gray-200 !border-gray-300 !text-gray-500' : ''}">${displayLabel}</span>`;
    }).join('');
}

window.toggleMultiSelectMenu = function(key) {
    const quota = Store.getGenderQuotaStatus();
    if (Store.getSystemConfig().profileLocked || (!appState.playerId && quota.bothFull)) return;
    const menu = document.getElementById(`ms-menu-${key}`);
    const isHidden = menu.classList.contains('hidden');
    document.querySelectorAll('.multiselect-menu').forEach(m => m.classList.add('hidden'));
    if (isHidden) menu.classList.remove('hidden');
};

window.onMultiSelectChange = function(key, allowOther) {
    const quota = Store.getGenderQuotaStatus();
    if (Store.getSystemConfig().profileLocked || (!appState.playerId && quota.bothFull)) return;
    const menu = document.getElementById(`ms-menu-${key}`);
    const checked = Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    appState.profile[key] = checked;

    if (allowOther) {
        const otherInput = document.getElementById(`ms-other-${key}`);
        if (checked.includes('其他')) {
            otherInput.classList.remove('hidden');
            otherInput.focus();
        } else {
            otherInput.classList.add('hidden');
            otherInput.value = '';
            appState.profile[`${key}Other`] = '';
        }
    }

    const otherText = appState.profile[`${key}Other`] || '';
    document.getElementById(`ms-chips-${key}`).innerHTML = renderMultiSelectChipsHtml(key, checked, otherText, false);
    Store.save(appState);
};

window.onMultiSelectOtherInput = function(key) {
    const quota = Store.getGenderQuotaStatus();
    if (Store.getSystemConfig().profileLocked || (!appState.playerId && quota.bothFull)) return;
    const val = document.getElementById(`ms-other-${key}`).value;
    appState.profile[`${key}Other`] = val;
    const checked = appState.profile[key] || [];
    document.getElementById(`ms-chips-${key}`).innerHTML = renderMultiSelectChipsHtml(key, checked, val, false);
    Store.save(appState);
};

// 個人隱私開放或隱藏不受資料鎖定限制
window.setFieldPrivacy = function(key, mode) {
    let isLockedPrivacy = (key === 'gender' || key === 'icebreakerQuestion' || key === 'ig');
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.key === key && (f.alwaysOpen || f.autoOpenAfter7Days)) {
                isLockedPrivacy = true;
            }
        });
    });
    if (isLockedPrivacy) return;
    appState.privacy[key] = mode;
    Store.save(appState);

    const group = document.getElementById(`priv-group-${key}`);
    if (group) {
        const btns = group.querySelectorAll('.privacy-pill');
        btns[0].className = `privacy-pill ${mode === 'closed' ? 'active-closed' : ''}`;
        btns[1].className = `privacy-pill ${mode === 'open' ? 'active-open' : ''}`;
    }

    const hint = document.getElementById(`priv-hint-${key}`);
    if (hint) {
        hint.textContent = mode === 'open'
            ? '🌸 已對目前配對好友開放顯示'
            : '🙈 目前不開放（需點選「開放給好友」對方才看得到）';
    }
};

window.setAllFieldsPrivacy = function(mode) {
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (!f.alwaysOpen && !f.autoOpenAfter7Days) {
                setFieldPrivacy(f.key, mode);
            }
        });
    });
};

// 點保存
document.getElementById('profileForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const quota = Store.getGenderQuotaStatus();
    if (!appState.playerId && quota.bothFull) {
        showMiniNotice('🚫 男/女人數已滿', '目前男生與女生人數皆已達上限，暫不開放新玩家填寫資料。');
        return;
    }

    if (Store.getSystemConfig().profileLocked) {
        showMiniNotice('🔒 個人資料已鎖定', '管理員目前已開啟「不讓玩家填寫資料」，所有欄位已反灰鎖定。');
        return;
    }

    const fd = new FormData(this);

    const nextProfile = { ...appState.profile };
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.type === 'regionCity') {
                const regVal = fd.get('region') ? fd.get('region').trim() : (document.getElementById('profileRegionSelect')?.value || '');
                const cityVal = fd.get('city') ? fd.get('city').trim() : (document.getElementById('profileCitySelect')?.value || '');
                nextProfile.region = regVal;
                nextProfile.city = cityVal;
            } else if (f.type === 'mbtiTwoStep') {
                const grpVal = document.getElementById('profileMbtiGroupSelect')?.value || (fd.get('mbtiGroup') ? fd.get('mbtiGroup').trim() : '');
                const selMbtiVal = document.getElementById('profileMbtiSelect')?.value || document.getElementById('profileMbtiHidden')?.value || '';
                nextProfile.mbtiGroup = grpVal;
                nextProfile.mbti = (grpVal === '不知道 / 沒測過') ? '不知道 / 沒測過' : selMbtiVal.trim();
            } else if (f.type === 'multiselect') {
                if (f.allowOther) {
                    nextProfile[`${f.key}Other`] = fd.get(`${f.key}Other`) ? fd.get(`${f.key}Other`).trim() : '';
                }
            } else {
                nextProfile[f.key] = fd.get(f.key) ? fd.get(f.key).trim() : '';
                if (f.allowOther) {
                    nextProfile[`${f.key}Other`] = (nextProfile[f.key] === '其他' && fd.get(`${f.key}Other`))
                        ? fd.get(`${f.key}Other`).trim()
                        : '';
                }
            }
        });
    });

    // 性別只能選男或女，並即時檢查男女生名額上限
    if (nextProfile.gender && nextProfile.gender !== '男' && nextProfile.gender !== '女') {
        showMiniNotice('⚠️ 性別限制', '你的性別只能選擇「男」或「女」！');
        return;
    }

    // 年齡限制驗證：實歲 22～40 歲，最小可接受年齡至少 22 歲，最大可接受年齡最高 40 歲
    if (nextProfile.age !== '') {
        const ageNum = Number(nextProfile.age);
        if (!Number.isInteger(ageNum) || ageNum < 22 || ageNum > 40) {
            const card = document.getElementById('field-card-age');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMiniNotice('⚠️ 年齡限制', '「你的年齡（實歲）」限制至少要 22 歲、最高 40 歲！');
            return;
        }
    }
    if (nextProfile.minAge !== '') {
        const minAgeNum = Number(nextProfile.minAge);
        if (!Number.isInteger(minAgeNum) || minAgeNum < 22 || minAgeNum > 40) {
            const card = document.getElementById('field-card-minAge');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMiniNotice('⚠️ 最小可接受年齡限制', '「最小可接受年齡」至少要 22 歲（且不得超過 40 歲）！');
            return;
        }
    }
    if (nextProfile.maxAge !== '') {
        const maxAgeNum = Number(nextProfile.maxAge);
        if (!Number.isInteger(maxAgeNum) || maxAgeNum < 22 || maxAgeNum > 40) {
            const card = document.getElementById('field-card-maxAge');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMiniNotice('⚠️ 最大可接受年齡限制', '「最大可接受年齡」最高為 40 歲（且不得低於 22 歲）！');
            return;
        }
    }
    if (nextProfile.minAge !== '' && nextProfile.maxAge !== '') {
        if (Number(nextProfile.minAge) > Number(nextProfile.maxAge)) {
            const card = document.getElementById('field-card-minAge');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMiniNotice('⚠️ 年齡範圍設定錯誤', '「最小可接受年齡」不能大於「最大可接受年齡」！');
            return;
        }
    }
    if (!appState.playerId) {
        if (nextProfile.gender === '男' && quota.maleFull) {
            showMiniNotice('🚫 男生人數已滿', '男生人數已滿，男生禁止選取，性別只能選擇「女」！');
            return;
        }
        if (nextProfile.gender === '女' && quota.femaleFull) {
            showMiniNotice('🚫 女生人數已滿', '女生人數已滿，女生禁止選取，性別只能選擇「男」！');
            return;
        }
    }

    const normalizedIg = String(nextProfile.ig || '').trim().replace(/^@+/, '').toLowerCase();
    if (normalizedIg) {
        const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
        const isDuplicate = users.some(u => {
            if (appState.playerId && String(u.id) === String(appState.playerId)) return false;
            const existingIg = String(u.ig || '').trim().replace(/^@+/, '').toLowerCase();
            return existingIg !== '' && existingIg === normalizedIg;
        });

        if (isDuplicate) {
            showMiniNotice('⚠️ 註冊提示', '已重複註冊');
            return;
        }
    }

    appState.profile = nextProfile;

    const violatedRule = Store.checkProfileBanned(nextProfile);
    if (violatedRule) {
        appState.isWarnedAccount = true;
        appState.warningReason = `偵測到受限制內容（${violatedRule.keyword}），目前警告帳號 不提供配對`;
        appState.registeredSessions = [];

        if (isProfileComplete() && !appState.playerId) {
            appState.playerId = IdAllocator.allocate(appState.profile.gender);
        }

        Store.save(appState);
        renderProfileForm();
        refreshAllUI();
        showMiniNotice('⚠️ 帳號狀態警告', '目前警告帳號 不提供配對');
        return;
    } else {
        appState.isWarnedAccount = false;
        appState.warningReason = '';
    }

    const missingFields = getMissingRequiredFields();
    if (missingFields.length > 0) {
        Store.save(appState);
        refreshAllUI();

        const firstCard = document.getElementById(`field-card-${missingFields[0].key === 'region' ? 'city' : missingFields[0].key}`);
        if (firstCard) {
            firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        const previewNames = missingFields.slice(0, 6).map(m => `・${m.label}`).join('\n');
        const moreText = missingFields.length > 6 ? `\n...等共 ${missingFields.length} 項必填欄位` : '';
        showMiniNotice(
            '⚠️ 尚有必填欄位未完成',
            `請先補齊以下必填欄位並再按一次「保存」，系統才會產生玩家 ID 並送出至後台：\n\n${previewNames}${moreText}`
        );
        return;
    }

    if (!appState.playerId) {
        appState.playerId = IdAllocator.allocate(appState.profile.gender);
    }

    Store.save(appState);
    renderProfileForm();
    refreshAllUI();

    const compText = document.getElementById('profileCompletenessText');
    if (compText) {
        compText.innerHTML = `✨ <strong>已保存（玩家專屬 ID：${appState.playerId}，已同步至後台）</strong>`;
    }
    showMiniNotice(
        '✨ 保存成功',
        `玩家專屬 ID：${appState.playerId}\n5 碼專屬通行碼：${appState.backupCode || ''}\n（換手機或瀏覽器時輸入此 5 碼即可讀取紀錄）\n\n現在可前往「緣分首頁」勾選場次報名配對。`
    );
});

// ==================== 複選場次與完全吻合條件（居住先選地區，可配對全區或指定縣市） ====================
function handleApplyClick() {
    const sysConfig = Store.getSystemConfig();
    const quota = Store.getGenderQuotaStatus();

    if (appState.isWarnedAccount) {
        showMiniNotice('⚠️ 無法報名', '目前警告帳號 不提供配對');
        return;
    }

    if (!sysConfig.registrationOpen) {
        showMiniNotice('🚫 人數已滿 不可報名', '本屆報名名額已滿，目前暫不開放報名，請靜待下一期開放！');
        return;
    }

    if (!appState.playerId && quota.bothFull) {
        showMiniNotice('🚫 男/女人數已滿', `目前男生（${quota.maleCount}/${quota.limit} 人）與女生（${quota.femaleCount}/${quota.limit} 人）人數皆已額滿。`);
        return;
    }

    if (!isProfileComplete() || !appState.playerId) {
        switchTab('profile');
        return;
    }

    openRegisterModal();
}

function openRegisterModal() {
    if (!Store.getSystemConfig().registrationOpen) {
        showMiniNotice('🚫 人數已滿 不可報名', '本屆報名名額已滿，目前暫不開放報名。');
        return;
    }

    const sched = getBatchScheduleInfo(getCurrentBatchNumber());
    const wedLabel = sched.wedLabel;
    const satLabel = sched.satLabel;
    const savedSessions = Array.isArray(appState.registeredSessions) ? appState.registeredSessions : [];

    document.getElementById('sessionOptionsList').innerHTML = [wedLabel, satLabel].map(opt => {
        const checked = savedSessions.some(s => isSameSession(s, opt));
        return `
            <label class="flex items-center gap-2.5 p-3 rounded-2xl border border-pink-200 bg-pink-50/40 cursor-pointer hover:bg-pink-50">
                <input type="checkbox" name="regSessionCheck" value="${opt}" ${checked ? 'checked' : ''} class="accent-[#c96a7b] w-4 h-4">
                <div>
                    <div class="font-bold text-xs text-[#8f4452]">${opt}</div>
                    <div class="text-[10px] text-gray-500">20:00 準時進行配對</div>
                </div>
            </label>
        `;
    }).join('');

    const savedCriteria = appState.exactMatchCriteria || {};
    document.getElementById('exactMatchOptionsList').innerHTML = EXACT_MATCH_OPTIONS.map(item => {
        if (item.type === 'regionCity') {
            const isChecked = Object.prototype.hasOwnProperty.call(savedCriteria, 'region');
            const selectedReg = savedCriteria.region || REGION_OPTIONS[0];
            const selectedCity = savedCriteria.city || '';
            const regCities = REGION_CITIES[selectedReg] || [];
            return `
                <div class="sm:col-span-2 p-2.5 rounded-xl border border-pink-200 bg-pink-50/30 space-y-1.5">
                    <label class="flex items-center gap-2 text-xs font-semibold text-[#5e464a] cursor-pointer">
                        <input type="checkbox" name="exactFieldCheck" value="region" ${isChecked ? 'checked' : ''} onchange="toggleExactSelect('region')" class="accent-[#c96a7b]">
                        <span>${item.label}</span>
                    </label>
                    <div id="exact-region-wrap" class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 ${isChecked ? '' : 'hidden'}">
                        <select id="exact-select-region" onchange="onExactRegionChange()" class="input-jp !py-1.5 !text-xs">
                            ${REGION_OPTIONS.map(r => `<option value="${r}" ${selectedReg === r ? 'selected' : ''}>${r}（全區）</option>`).join('')}
                        </select>
                        <select id="exact-select-region-city" class="input-jp !py-1.5 !text-xs">
                            <option value="">不限縣市（整個${selectedReg}皆可配對）</option>
                            ${regCities.map(c => `<option value="${c}" ${selectedCity === c ? 'selected' : ''}>限定：${c}</option>`).join('')}
                        </select>
                    </div>
                </div>
            `;
        }

        const isChecked = Object.prototype.hasOwnProperty.call(savedCriteria, item.key);
        const selectedVal = savedCriteria[item.key] || item.choices[0];
        return `
            <div class="p-2 rounded-xl border border-pink-100 bg-white space-y-1.5">
                <label class="flex items-center gap-2 text-xs font-semibold text-[#5e464a] cursor-pointer">
                    <input type="checkbox" name="exactFieldCheck" value="${item.key}" ${isChecked ? 'checked' : ''} onchange="toggleExactSelect('${item.key}')" class="accent-[#c96a7b]">
                    <span>${item.label}</span>
                </label>
                <select id="exact-select-${item.key}" class="input-jp !py-1 !text-xs ${isChecked ? '' : 'hidden'}">
                    ${item.choices.map(c => `<option value="${c}" ${selectedVal === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
        `;
    }).join('');

    document.getElementById('registerModal').classList.remove('hidden');
}

window.toggleExactSelect = function(key) {
    const cb = document.querySelector(`input[name="exactFieldCheck"][value="${key}"]`);
    if (key === 'region') {
        const wrap = document.getElementById('exact-region-wrap');
        if (cb && wrap) {
            wrap.classList.toggle('hidden', !cb.checked);
        }
        return;
    }
    const sel = document.getElementById(`exact-select-${key}`);
    if (cb && sel) {
        sel.classList.toggle('hidden', !cb.checked);
    }
};

window.onExactRegionChange = function() {
    const regSel = document.getElementById('exact-select-region');
    const citySel = document.getElementById('exact-select-region-city');
    if (!regSel || !citySel) return;
    const regVal = regSel.value;
    const cities = REGION_CITIES[regVal] || [];
    citySel.innerHTML = `<option value="">不限縣市（整個${regVal}皆可配對）</option>` +
        cities.map(c => `<option value="${c}">限定：${c}</option>`).join('');
};

function closeRegisterModal() {
    document.getElementById('registerModal').classList.add('hidden');
}

function formatCriteriaDisplayList(criteria) {
    const keys = Object.keys(criteria || {}).filter(k => k !== 'city');
    return keys.map(k => {
        if (k === 'region') {
            const regName = criteria.region;
            const cityName = criteria.city;
            return cityName ? `居住地區：${regName}（${cityName}）` : `居住地區：${regName}（全區所有縣市皆可）`;
        }
        const label = EXACT_MATCH_OPTIONS.find(o => o.key === k)?.label || k;
        return `${label}：${criteria[k]}`;
    });
}

function confirmRegistration() {
    if (!Store.getSystemConfig().registrationOpen) {
        closeRegisterModal();
        showMiniNotice('🚫 人數已滿 不可報名', '本屆報名名額已滿，目前暫不開放報名。');
        return;
    }

    const selectedSessions = Array.from(document.querySelectorAll('input[name="regSessionCheck"]:checked')).map(cb => cb.value);
    if (selectedSessions.length === 0) {
        showMiniNotice('🌸 提醒', '請至少勾選一個要參加的配對場次（星期三 或 星期六）！');
        return;
    }

    const criteria = {};
    document.querySelectorAll('input[name="exactFieldCheck"]:checked').forEach(cb => {
        const key = cb.value;
        if (key === 'region') {
            const regSel = document.getElementById('exact-select-region');
            const citySel = document.getElementById('exact-select-region-city');
            if (regSel && regSel.value) {
                criteria.region = regSel.value;
                if (citySel && citySel.value) {
                    criteria.city = citySel.value;
                }
            }
        } else {
            const sel = document.getElementById(`exact-select-${key}`);
            if (sel) {
                criteria[key] = sel.value;
            }
        }
    });

    appState.registeredSessions = selectedSessions;
    appState.exactMatchCriteria = criteria;
    Store.save(appState);
    closeRegisterModal();
    refreshAllUI();

    const displayItems = formatCriteriaDisplayList(criteria);
    const desc = displayItems.length > 0
        ? '已指定條件（其中一項符合即可配對）：\n' + displayItems.map(item => `・${item}`).join('\n')
        : '未勾選額外條件（不限制，將進行隨機配對）';

    showMiniNotice('🌸 報名成功', `已登錄場次：【${selectedSessions.join('、')}】\n\n${desc}`);
}

function refreshAllUI() {
    const sysConfig = Store.getSystemConfig();
    const quota = Store.getGenderQuotaStatus();
    const complete = isProfileComplete() && !!appState.playerId;
    const isBothGenderFullForNew = !appState.playerId && quota.bothFull;
    const batchNum = sysConfig.currentBatch;
    const sched = getBatchScheduleInfo(batchNum);
    const normalizedAllSessions = Array.from(new Set((appState.registeredSessions || []).map(s => normalizeSessionLabel(s)).filter(Boolean)));
    const currentBatchSessions = normalizedAllSessions.filter(s =>
        sched.sessions.some(target => isSameSession(s, target))
    );

    document.getElementById('currentPeriodBadge').textContent = `目前開放：${sched.batchPrefix}（${sched.wedDateStr}(三) / ${sched.satDateStr}(六)）`;

    const warnBanner = document.getElementById('warningAccountBanner');
    if (appState.isWarnedAccount) {
        warnBanner.classList.remove('hidden');
        document.getElementById('warningAccountReason').textContent = appState.warningReason || '目前警告帳號 不提供配對';
    } else {
        warnBanner.classList.add('hidden');
    }

    const badge = document.getElementById('headerStatusBadge');
    const compText = document.getElementById('profileCompletenessText');
    const alertBox = document.getElementById('registrationAlertBox');
    const applyBtn = document.getElementById('mainApplyBtn');

    if (isBothGenderFullForNew) {
        compText.innerHTML = '<span class="text-rose-600 font-bold">🚫 男/女人數已滿</span>';
    } else if (sysConfig.profileLocked) {
        compText.innerHTML = '<span class="text-gray-600 font-bold">🔒 個人資料已鎖定（欄位反灰不可修改或新增，隱私設定仍可調整）</span>';
    } else if (appState.isWarnedAccount) {
        compText.innerHTML = '<span class="text-rose-600 font-bold">⚠️ 目前警告帳號 不提供配對</span>';
    } else if (complete) {
        compText.innerHTML = `✨ <strong>個人資料已準備就緒（玩家 ID：${appState.playerId}）</strong>`;
    } else {
        compText.innerHTML = '⚠️ <strong>尚有必填資料未完成（填完按保存後產生 ID）</strong>';
    }

    if (appState.isWarnedAccount) {
        badge.textContent = '⚠️ 警告帳號';
        applyBtn.disabled = true;
        applyBtn.textContent = '⚠️ 目前警告帳號 不提供配對';
        alertBox.innerHTML = `<span class="text-rose-600 font-bold">目前警告帳號 不提供配對</span><br>請前往「個人與隱私」修正受限制的資料欄位並重新保存。`;
    } else if (!sysConfig.registrationOpen) {
        badge.textContent = '🚫 人數已滿 不可報名';
        applyBtn.disabled = true;
        applyBtn.textContent = '🚫 人數已滿 不可報名';
        alertBox.innerHTML = `<span class="text-rose-600 font-bold">本屆報名人數已滿，目前暫停開放報名！</span><br>已成功報名的玩家將如期於週三 / 週六 20:00 進行配對。`;
    } else if (isBothGenderFullForNew) {
        badge.textContent = '🚫 男/女人數已滿';
        applyBtn.disabled = true;
        applyBtn.textContent = '🚫 男/女人數已滿';
        alertBox.innerHTML = `<span class="text-rose-600 font-bold">男/女人數已滿</span><br>目前男生（${quota.maleCount}/${quota.limit} 人）與女生（${quota.femaleCount}/${quota.limit} 人）皆已達人數上限，暫不開放新玩家填寫資料。`;
    } else if (!complete) {
        badge.textContent = sysConfig.profileLocked ? '🔒 個人資料鎖定中' : '📝 尚未完成檔案';
        applyBtn.disabled = false;
        applyBtn.textContent = sysConfig.profileLocked ? '🔒 個人資料已鎖定（檢視或調整隱私）' : '📝 前往填寫個人資料';
        if (sysConfig.profileLocked) {
            alertBox.innerHTML = `管理員目前已鎖定個人資料填寫功能（欄位反灰不可修改或新增），僅可調整個人隱私設定。`;
        } else if (quota.maleFull) {
            alertBox.innerHTML = `<span class="text-amber-700 font-bold">⚠️ 目前男生人數已滿（${quota.maleCount}/${quota.limit} 人），僅開放女生填寫資料！</span><br>有報名選擇場次的玩家才會進入配對池。`;
        } else if (quota.femaleFull) {
            alertBox.innerHTML = `<span class="text-amber-700 font-bold">⚠️ 目前女生人數已滿（${quota.femaleCount}/${quota.limit} 人），僅開放男生填寫資料！</span><br>有報名選擇場次的玩家才會進入配對池。`;
        } else {
            alertBox.innerHTML = `有報名選擇場次的玩家才會進入配對池，未報名不會配對！`;
        }
    } else if (currentBatchSessions.length > 0) {
        const displayItems = formatCriteriaDisplayList(appState.exactMatchCriteria || {});
        const criteriaSummary = displayItems.length > 0
            ? displayItems.join(' 或 ')
            : '不限制（隨機配對）';
        badge.textContent = `⏳ 已報名 (${currentBatchSessions.length}場)`;
        applyBtn.disabled = false;
        applyBtn.textContent = `✅ 已報名【${currentBatchSessions.join('、')}】（點此修改）`;
        alertBox.innerHTML = `你已成功報名 <strong>${currentBatchSessions.join('、')}</strong>！<br>配對條件：<strong>${criteriaSummary}</strong>。`;
    } else {
        badge.textContent = `✨ ${sched.batchPrefix}開始報名中`;
        applyBtn.disabled = false;
        applyBtn.textContent = `🌸 開始報名（${sched.wedLabel} / ${sched.satLabel}）`;
        alertBox.innerHTML = `目前開放報名 <strong>${sched.wedLabel}</strong> 或 <strong>${sched.satLabel}</strong>（可複選），有報名才會參與配對！`;
    }

    document.getElementById('navFriendDot').classList.toggle('hidden', appState.friends.length === 0);
    renderHomeStatsCharts();
    renderFriendsSection();
}

// ==================== 好友名單與對話（含禁止玩家發話：顯示「請聯繫管理員」） ====================
function renderFriendsSection() {
    const listEl = document.getElementById('friendsListContainer');
    const countBadge = document.getElementById('friendCountBadge');
    const workspace = document.getElementById('activeChatWorkspace');

    countBadge.textContent = `${appState.friends.length} 位好友`;

    if (appState.friends.length === 0) {
        listEl.innerHTML = `
            <div class="md:col-span-2 text-center py-10 text-sm text-gray-400 bg-white/60 rounded-2xl border border-dashed border-pink-200">
                目前好友名單還是空的 🌸<br>選擇屆數場次並完成報名後，將在該場次 20:00 為你牽起七日緣分。
            </div>
        `;
        workspace.classList.add('hidden');
        return;
    }

    if (!appState.activeFriendId || !appState.friends.some(f => String(f.id) === String(appState.activeFriendId))) {
        appState.activeFriendId = String(appState.friends[0].id);
    }

    const nowTs = Date.now();
    listEl.innerHTML = appState.friends.map(friend => {
        const isActive = String(friend.id) === String(appState.activeFriendId);
        const remainDays = calcRemainingDays(friend.matchedAt, nowTs);
        return `
            <div onclick="selectFriend('${friend.id}')" class="cursor-pointer p-4 rounded-2xl border transition-all ${isActive ? 'bg-pink-50/90 border-[#c96a7b] shadow-md' : 'bg-white/80 border-pink-100 hover:border-pink-300'}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-11 h-11 rounded-full bg-gradient-to-br from-pink-200 to-rose-300 text-white font-bold flex items-center justify-center text-lg">
                            ${friend.nickname.slice(0, 1)}
                        </div>
                        <div>
                            <h4 class="font-bold text-[#8f4452] text-sm">${friend.nickname} <span class="text-[11px] font-normal text-[#c96a7b]">(${friend.profile.gender || '保密'})</span></h4>
                            <p class="text-[11px] text-gray-500">${friend.sessionLabel || '七日緣分'} ・ ${friend.profile.region ? friend.profile.region + ' ' : ''}${friend.profile.city || '同城緣分'}</p>
                        </div>
                    </div>
                    <span class="text-[11px] px-2.5 py-1 rounded-full ${remainDays === 0 ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-white text-[#c96a7b] border border-pink-200'}">
                        ${remainDays === 0 ? '⏳ 剩餘 0 天（禁止發話）' : `剩餘 ${remainDays} 天`}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    workspace.classList.remove('hidden');
    renderActiveFriendWorkspace();
}

function selectFriend(friendId) {
    appState.activeFriendId = String(friendId);
    Store.save(appState);
    renderFriendsSection();

    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
    }
}

function renderActiveFriendWorkspace() {
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    document.getElementById('partnerCardName').textContent = `🌸 ${friend.nickname} 的開放檔案`;
    document.getElementById('chatHeaderTitle').textContent = `與 ${friend.nickname} 的戀愛對話窗`;

    const remainDays = calcRemainingDays(friend.matchedAt, Date.now());
    document.getElementById('partnerCardTimer').textContent = remainDays === 0
        ? '⚠️ 剩餘 0 天！聊天室已禁止發話，請決定要不要繼續配對'
        : `⏳ 剩餘 ${remainDays} 天（每天 20:00 自動 -1 天）`;

    const unlockedBox = document.getElementById('partnerUnlockedFields');
    let unlockedHtml = '';
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.key === 'nickname') return;
            const isVisible = f.alwaysOpen || (f.autoOpenAfter7Days ? Boolean(friend.igUnlocked) : (friend.privacy && friend.privacy[f.key] === 'open'));
            const val = friend.profile[f.key];
            if (isVisible && val && (!Array.isArray(val) || val.length > 0)) {
                let displayVal = val;
                if (f.key === 'city' && friend.profile.region) {
                    displayVal = `${friend.profile.region} ・ ${val}`;
                } else if (Array.isArray(val)) {
                    const otherTxt = friend.profile[`${f.key}Other`];
                    displayVal = val.map(v => (v === '其他' && otherTxt) ? `其他（${otherTxt}）` : v).join('、');
                } else if (f.allowOther && val === '其他' && friend.profile[`${f.key}Other`]) {
                    displayVal = `其他（${friend.profile[`${f.key}Other`]}）`;
                }
                unlockedHtml += `
                    <div class="p-2.5 rounded-xl bg-white border border-pink-100">
                        <span class="text-[11px] text-[#c96a7b] block">${f.label.split('（')[0]}</span>
                        <span class="font-medium text-gray-700">${displayVal}</span>
                    </div>
                `;
            }
        });
    });

    unlockedBox.innerHTML = unlockedHtml || `
        <div class="text-center py-6 text-gray-400">
            對方目前尚未開啟其他進階資料欄位，<br>先從聊天室打聲招呼吧！
        </div>
    `;

    const isChatBanned = Boolean(appState.isChatBanned);
    const pendingChoice = isEveningConfessionPending();
    const isZeroDays = remainDays === 0;
    const chatBannedBanner = document.getElementById('chatBannedBanner');
    const lockBanner = document.getElementById('confessionLockBanner');
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');

    if (isChatBanned) {
        chatBannedBanner.classList.remove('hidden');
        lockBanner.classList.add('hidden');
        chatInput.disabled = true;
        chatInput.value = '';
        chatInput.placeholder = '🚫 請聯繫管理員';
        chatInput.classList.add('!bg-gray-100', '!text-gray-400');
        chatSendBtn.disabled = true;
    } else if (pendingChoice) {
        chatBannedBanner.classList.add('hidden');
        lockBanner.classList.remove('hidden');
        chatInput.disabled = true;
        chatInput.value = '';
        chatInput.placeholder = '🔒 請先完成 20:00 心動抉擇才能聊天...';
        chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        chatSendBtn.disabled = true;
    } else if (isZeroDays) {
        chatBannedBanner.classList.add('hidden');
        lockBanner.classList.add('hidden');
        chatInput.disabled = true;
        chatInput.value = '';
        chatInput.placeholder = '🚫 剩餘 0 天，聊天室已禁止發話（請先選擇是否繼續配對）';
        chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        chatSendBtn.disabled = true;
    } else {
        chatBannedBanner.classList.add('hidden');
        lockBanner.classList.add('hidden');
        chatInput.disabled = false;
        chatInput.placeholder = '寫下想對他說的話...';
        chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        chatSendBtn.disabled = false;
    }

    const banner = document.getElementById('sevenDayDecisionBanner');
    const statusText = document.getElementById('sevenDayDecisionStatus');
    if (isZeroDays) {
        banner.classList.remove('hidden');
        if (friend.myContinue === true && friend.partnerContinue !== true) {
            statusText.innerHTML = `💖 你已按下「繼續配對」，聊天室仍暫停發話，正在等待 <strong>${friend.nickname}</strong> 按下繼續（雙方都按下後將再延後 7 天並重新開放聊天）...`;
        } else if (friend.partnerContinue === true && friend.myContinue !== true) {
            statusText.innerHTML = `💌 <strong>${friend.nickname}</strong> 已經按下「繼續配對」！只要你也按下「繼續配對」，雙方將再延後 7 天並繼續聊天！`;
        } else {
            statusText.textContent = '目前聊天室已暫停發話；兩個人都按「繼續配對」即可再延後 7 天並繼續聊天，其中一人放棄則兩邊好友名單清空刪除。';
        }
    } else {
        banner.classList.add('hidden');
    }

    const isRealFriend = !String(friend.id).startsWith('MOCK_FRIEND_') && !!appState.playerId;
    if (isRealFriend) {
        const sharedMsgs = ChatStore.getMessages(appState.playerId, friend.id);
        if (sharedMsgs.length > 0) {
            friend.messages = sharedMsgs;
        }
    }

    const chatBox = document.getElementById('chatMessagesBox');
    const currentSignature = `${appState.playerId || ''}_${friend.id}_${friend.messages.length}_${friend.messages[friend.messages.length - 1]?.id || friend.messages[friend.messages.length - 1]?.text || ''}`;

    chatBox.innerHTML = friend.messages.map(m => {
        if (m.senderId === 'system' || m.sender === 'system') {
            return `
                <div class="text-center my-2">
                    <span class="inline-block px-3.5 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-[11px] text-[#8f4452] leading-relaxed">
                        ${m.text}
                    </span>
                </div>
            `;
        }
        const isMe = m.senderId
            ? (String(m.senderId) === String(appState.playerId))
            : (m.sender === 'me');
        return `
            <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'}">
                ${!isMe ? `<span class="text-[10px] text-[#c96a7b] font-semibold mb-0.5 px-1">${friend.nickname}</span>` : ''}
                <div class="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-2xs ${isMe ? 'bg-gradient-to-r from-[#e598a6] to-[#c96a7b] text-white rounded-br-xs' : 'bg-white border border-pink-100 text-gray-700 rounded-bl-xs'}">
                    ${m.text}
                </div>
                <span class="text-[10px] text-gray-400 mt-1 px-1">${m.time || ''}</span>
            </div>
        `;
    }).join('');

    if (currentSignature !== lastRenderedChatSignature) {
        lastRenderedChatSignature = currentSignature;
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

function handleLockedChatClick() {
    if (appState.isChatBanned) {
        showMiniNotice('🚫 禁止發話', '請聯繫管理員');
        return;
    }
    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
        return;
    }
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (friend && calcRemainingDays(friend.matchedAt, Date.now()) === 0) {
        showMiniNotice('🚫 聊天室已禁止發話', '目前好友剩餘 0 天，請先在上方選擇「繼續配對」或「不繼續」。');
    }
}

document.getElementById('chatSendForm').addEventListener('submit', function(e) {
    e.preventDefault();

    if (appState.isChatBanned) {
        showMiniNotice('🚫 禁止發話', '請聯繫管理員');
        return;
    }

    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
        return;
    }

    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    if (calcRemainingDays(friend.matchedAt, Date.now()) === 0) {
        showMiniNotice('🚫 聊天室已禁止發話', '剩餘 0 天！請先決定是否繼續配對，雙方都按下繼續後才會重新開放聊天。');
        return;
    }

    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const nowStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const isMockFriend = String(friend.id).startsWith('MOCK_FRIEND_') || !appState.playerId;

    if (!isMockFriend) {
        const updatedMsgs = ChatStore.appendMessage(appState.playerId, friend.id, {
            senderId: String(appState.playerId),
            senderName: appState.profile.nickname || String(appState.playerId),
            text,
            time: nowStr
        });
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
        friend.messages = updatedMsgs;
        input.value = '';
        Store.save(appState);
        renderActiveFriendWorkspace();
    } else {
        friend.messages.push({ sender: 'me', text, time: nowStr });
        input.value = '';
        Store.save(appState);
        renderActiveFriendWorkspace();

        setTimeout(() => {
            friend.messages.push({
                sender: 'partner',
                text: `收到你的訊息了！很高興在月老七日計畫認識你 🌸`,
                time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
            });
            Store.save(appState);
            renderActiveFriendWorkspace();
        }, 900);
    }
});

function recordMutualContinueVote(myId, partnerId, voterNickname, isSimulatedPartner = false) {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    const idA = String(myId);
    const idB = String(partnerId);
    const voterId = isSimulatedPartner ? idB : idA;

    const userA = users.find(u => String(u.id) === idA);
    const userB = users.find(u => String(u.id) === idB);
    if (!userA || !userB) return false;

    const getOrCreateHistItem = (owner, other) => {
        if (!Array.isArray(owner.matchedHistory)) owner.matchedHistory = [];
        let item = owner.matchedHistory.find(h => String(h.partnerId) === String(other.id));
        if (!item) {
            item = {
                session: owner.matchedSession || `第 ${getCurrentBatchNumber()} 屆`,
                partnerId: String(other.id),
                partnerName: other.nickname || '',
                matchedAt: owner.matchedAt || Date.now(),
                continueVotes: []
            };
            owner.matchedHistory.push(item);
        }
        if (!Array.isArray(item.continueVotes)) item.continueVotes = [];
        return item;
    };

    const itemA = getOrCreateHistItem(userA, userB);
    const itemB = getOrCreateHistItem(userB, userA);

    const voteSet = new Set([
        ...itemA.continueVotes.map(String),
        ...itemB.continueVotes.map(String),
        voterId
    ]);

    const bothAgreed = voteSet.has(idA) && voteSet.has(idB);

    if (bothAgreed) {
        const extendedMatchedAt = Date.now();
        itemA.matchedAt = extendedMatchedAt;
        itemB.matchedAt = extendedMatchedAt;
        itemA.igUnlocked = true;
        itemB.igUnlocked = true;
        itemA.continueVotes = [];
        itemB.continueVotes = [];

        if (String(userA.matchedWithId) === idB) userA.matchedAt = extendedMatchedAt;
        if (String(userB.matchedWithId) === idA) userB.matchedAt = extendedMatchedAt;

        Store.saveSharedUsers(users);

        const sysText = `🌸 雙方皆按下「繼續配對」成為好友！緣分已再延後 7 天（剩餘 7 天），聊天室已重新開放並自動解鎖彼此 IG 帳號，可以繼續聊天囉！`;
        const updatedMsgs = ChatStore.appendMessage(idA, idB, { senderId: 'system', text: sysText });
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';

        if (String(appState.playerId) === idA) {
            const fObj = appState.friends.find(f => String(f.id) === idB);
            if (fObj) {
                fObj.matchedAt = extendedMatchedAt;
                fObj.igUnlocked = true;
                fObj.myContinue = false;
                fObj.partnerContinue = false;
                fObj.messages = updatedMsgs;
            }
        }
        return true;
    } else {
        const votesArr = Array.from(voteSet);
        itemA.continueVotes = votesArr;
        itemB.continueVotes = votesArr;
        Store.saveSharedUsers(users);

        const sysText = `💖 ${voterNickname} 已按下「繼續配對」，等待另一方也按下繼續中...`;
        const updatedMsgs = ChatStore.appendMessage(idA, idB, { senderId: 'system', text: sysText });
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';

        if (String(appState.playerId) === idA) {
            const fObj = appState.friends.find(f => String(f.id) === idB);
            if (fObj) {
                fObj.myContinue = votesArr.includes(idA);
                fObj.partnerContinue = votesArr.includes(idB);
                fObj.messages = updatedMsgs;
            }
        }
        return false;
    }
}

function respondSevenDayDecision(isContinue) {
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    if (!isContinue) {
        clearMutualFriendship(friend, `🍃 你選擇不繼續與 ${friend.nickname} 配對，兩邊好友名單已清空刪除。`);
        return;
    }

    const myNick = appState.profile.nickname || String(appState.playerId || '對方');
    const isRealFriend = !String(friend.id).startsWith('MOCK_FRIEND_') && !!appState.playerId;

    if (isRealFriend) {
        const completed = recordMutualContinueVote(appState.playerId, friend.id, myNick, false);
        Store.save(appState);
        refreshAllUI();
        if (completed) {
            showMiniNotice('🌸 繼續配對成功', `你與 ${friend.nickname} 皆已按下繼續配對！\n緣分已再延後 7 天（剩餘 7 天），現在可以繼續在聊天室聊天了！`);
        } else {
            showMiniNotice('💖 已送出繼續意願', `你已按下「繼續配對」，只要 ${friend.nickname} 也按下繼續配對，就會立即再延後 7 天並開放聊天！`);
        }
        return;
    }

    friend.myContinue = true;
    friend.messages.push({ sender: 'system', text: `💖 ${myNick} 已按下「繼續配對」，等待另一方也按下繼續中...` });
    Store.save(appState);
    renderActiveFriendWorkspace();

    if (friend.partnerContinue) {
        completeMutualContinuation(friend);
    }
}

function completeMutualContinuation(friend) {
    friend.matchedAt = Date.now();
    friend.igUnlocked = true;
    friend.myContinue = false;
    friend.partnerContinue = false;
    friend.messages.push({
        sender: 'system',
        text: `🌸 雙方皆按下「繼續配對」成為好友！緣分已再延後 7 天（剩餘 7 天），聊天室已重新開放並自動解鎖彼此的 IG 帳號！`
    });
    Store.save(appState);
    refreshAllUI();
}

function clearMutualFriendship(friend, noticeMsg) {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    users.forEach(u => {
        if (String(u.id) === String(appState.playerId)) {
            if (Array.isArray(u.matchedHistory)) {
                u.matchedHistory = u.matchedHistory.filter(h => String(h.partnerId) !== String(friend.id));
            }
            if (String(u.matchedWithId) === String(friend.id)) {
                u.matchedSession = null;
                u.matchedWithId = null;
                u.matchedWithName = null;
                u.matchedAt = null;
            }
        }
        if (String(u.id) === String(friend.id)) {
            if (Array.isArray(u.matchedHistory)) {
                u.matchedHistory = u.matchedHistory.filter(h => String(h.partnerId) !== String(appState.playerId));
            }
            if (String(u.matchedWithId) === String(appState.playerId)) {
                u.matchedSession = null;
                u.matchedWithId = null;
                u.matchedWithName = null;
                u.matchedAt = null;
            }
        }
    });
    Store.saveSharedUsers(users);

    // 直接解除配對時，才清空雙方聊天歷史紀錄
    if (appState.playerId && friend.id) {
        ChatStore.clearChat(appState.playerId, friend.id);
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
    }

    appState.friends = appState.friends.filter(f => String(f.id) !== String(friend.id));
    if (appState.matchedSession === friend.sessionLabel) {
        appState.matchedSession = null;
    }
    if (appState.friends.length < 2) {
        appState.multiFriendSince = null;
        appState.confessionUnlockAt = null;
    }
    Store.save(appState);
    refreshAllUI();
    if (noticeMsg) showMiniNotice('🍃 好友名單已清空', noticeMsg);
}

// ==================== 每隔 2 天 20:00 多好友心動抉擇 ====================
function openEveningConfessionModal() {
    if (appState.friends.length < 2) return;
    if (appState.confessionUnlockAt && Date.now() < appState.confessionUnlockAt) return;

    const listEl = document.getElementById('confessionTargetList');
    listEl.innerHTML = appState.friends.map((f, idx) => `
        <label class="flex items-center justify-between p-2.5 rounded-xl border border-pink-200 bg-pink-50/40 cursor-pointer hover:bg-pink-50">
            <div class="flex items-center gap-2">
                <input type="radio" name="confessionTarget" value="${f.id}" ${idx === 0 ? 'checked' : ''} class="accent-[#c96a7b]">
                <span class="font-bold text-xs text-[#8f4452]">${f.nickname}</span>
            </div>
            <span class="text-[11px] text-gray-500">${f.profile.city || ''} ・ ${f.profile.mbti || ''}</span>
        </label>
    `).join('');

    document.getElementById('confessionModal').classList.remove('hidden');
}

function closeEveningConfessionModal() {
    document.getElementById('confessionModal').classList.add('hidden');
    renderActiveFriendWorkspace();
}

function submitEveningConfession() {
    const selectedRadio = document.querySelector('input[name="confessionTarget"]:checked');
    const msgText = document.getElementById('confessionMessageInput').value.trim();

    if (!selectedRadio || !msgText) {
        showMiniNotice('💘 提醒', '請選擇一位好友，並寫下今天讓人心動的一句話喔！');
        return;
    }

    const chosenId = String(selectedRadio.value);
    const chosenFriend = appState.friends.find(f => String(f.id) === chosenId);
    const myName = appState.profile.nickname || '阿哲 (A)';
    const nowStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    let notifiedOthersCount = 0;

    appState.friends.forEach(friend => {
        const isReal = !String(friend.id).startsWith('MOCK_FRIEND_') && !!appState.playerId;
        if (String(friend.id) === chosenId) {
            const sysMsg = `💘【20:00 今日心動專屬】${myName} 選擇了你，並對你說出心動的話：`;
            const loveMsg = `💌「${msgText}」`;
            if (isReal) {
                ChatStore.appendMessage(appState.playerId, friend.id, { senderId: 'system', text: sysMsg });
                friend.messages = ChatStore.appendMessage(appState.playerId, friend.id, {
                    senderId: String(appState.playerId),
                    senderName: myName,
                    text: loveMsg,
                    time: nowStr
                });
            } else {
                friend.messages.push({ sender: 'system', text: sysMsg });
                friend.messages.push({ sender: 'me', text: loveMsg, time: nowStr });
            }
        } else {
            notifiedOthersCount++;
            const warnMsg = `⚠️【20:00 心動通知】${myName} 已發送今日好感內容給「另外一位好友」。`;
            if (isReal) {
                friend.messages = ChatStore.appendMessage(appState.playerId, friend.id, { senderId: 'system', text: warnMsg });
            } else {
                friend.messages.push({ sender: 'system', text: warnMsg });
            }
        }
    });
    lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';

    appState.lastConfessionDate = new Date().toDateString();
    appState.confessionUnlockAt = calcConfessionUnlockTime(Date.now());
    document.getElementById('confessionMessageInput').value = '';
    closeEveningConfessionModal();
    appState.activeFriendId = chosenId;
    Store.save(appState);
    switchTab('friends');
    refreshAllUI();

    showMiniNotice(
        '💘 心動訊息已送出',
        `已發送給「${chosenFriend ? chosenFriend.nickname : ''}」，其餘 ${notifiedOthersCount} 位好友的對話窗已同步收到好感通知提示！`
    );
}

// ==================== 紅線 5 碼英數通行碼（備份 / 跨瀏覽器還原） ====================
let backupRestoreFailCount = 0;
let backupRestoreLockUntil = 0;

function decodeLegacyBackupPayload(rawCodeStr) {
    let cleaned = String(rawCodeStr || '').replace(/[\s　]+/g, '');
    if (!cleaned) throw new Error('EMPTY_CODE');
    cleaned = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    while (cleaned.length % 4 !== 0) {
        cleaned += '=';
    }
    const binary = atob(cleaned);
    let jsonStr = '';
    if (typeof TextDecoder !== 'undefined') {
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        jsonStr = new TextDecoder('utf-8').decode(bytes);
    } else {
        jsonStr = decodeURIComponent(escape(binary));
    }
    return JSON.parse(jsonStr);
}

function buildCurrentBackupCode() {
    if (!appState.playerId) return '';
    const fixedCode = (typeof deriveFixedBackupCode === 'function')
        ? deriveFixedBackupCode(appState.playerId)
        : String(appState.backupCode || '').trim().toUpperCase();
    if (fixedCode && appState.backupCode !== fixedCode) {
        appState.backupCode = fixedCode;
        Store.save(appState);
    }
    return fixedCode;
}

function exportBackupCode() {
    const exportBox = document.getElementById('backupExportTextarea');
    const importBox = document.getElementById('backupImportTextarea');
    if (exportBox) {
        exportBox.value = buildCurrentBackupCode();
    }
    if (importBox) {
        importBox.value = '';
    }
    const modal = document.getElementById('backupModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeBackupModal() {
    const modal = document.getElementById('backupModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function copyBackupCodeToClipboard() {
    const exportBox = document.getElementById('backupExportTextarea');
    if (!exportBox || !exportBox.value) {
        showMiniNotice('⚠️ 尚未產生通行碼', '請先填寫個人資料並點擊「保存」，系統即會自動產生專屬 5 碼英數通行碼！');
        return;
    }
    exportBox.focus();
    exportBox.select();
    exportBox.setSelectionRange(0, exportBox.value.length);

    let copied = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(exportBox.value);
            copied = true;
        }
    } catch (e) {}

    if (!copied) {
        try {
            copied = document.execCommand('copy');
        } catch (e) {}
    }

    if (copied) {
        showMiniNotice('📋 複製成功', `已複製您的 5 碼專屬通行碼【${exportBox.value}】！\n可至其他瀏覽器或手機輸入此 5 碼讀取紀錄。`);
    } else {
        showMiniNotice('💡 請手動複製', `已為您全選通行碼【${exportBox.value}】，請按 Ctrl+C（或長按「複製」）。`);
    }
}

async function restoreFromBackupCode() {
    const now = Date.now();
    if (now < backupRestoreLockUntil) {
        const waitSec = Math.ceil((backupRestoreLockUntil - now) / 1000);
        showMiniNotice('⏳ 請稍候再試', `連續輸入錯誤次數過多，請於 ${waitSec} 秒後再重新輸入 5 碼通行碼。`);
        return;
    }

    const importBox = document.getElementById('backupImportTextarea');
    const rawInput = importBox ? importBox.value : '';
    const cleaned = String(rawInput || '').replace(/[\s　]+/g, '').toUpperCase();
    if (!cleaned) {
        showMiniNotice('⚠️ 尚未輸入通行碼', '請先在下方欄位輸入您的 5 碼英數通行碼（例如：K8M2P）！');
        return;
    }

    // 相容舊版長字串 Base64 通行碼
    if (cleaned.length > 12) {
        try {
            const restored = decodeLegacyBackupPayload(rawInput);
            if (!restored || typeof restored !== 'object' || !restored.profile) {
                throw new Error('INVALID_PAYLOAD');
            }
            const freshBase = Store.getDefaultState();
            if (restored.playerId) appState.playerId = String(restored.playerId);
            appState.profile = { ...freshBase.profile, ...restored.profile };
            if (!appState.profile.region && appState.profile.city) {
                appState.profile.region = inferRegionByCity(appState.profile.city);
            }
            appState.privacy = { ...freshBase.privacy, ...(restored.privacy || {}) };
            FIELD_SECTIONS.forEach(sec => {
                sec.fields.forEach(f => {
                    if (f.alwaysOpen) appState.privacy[f.key] = 'open';
                });
            });
            appState.privacy.ig = 'closed';
            Store.save(appState);
            syncFromSharedStorage();
            renderProfileForm();
            refreshAllUI();
            closeBackupModal();
            showMiniNotice('🌸 還原成功', `舊版通行碼還原成功，並已為您升級為最新 5 碼通行碼【${appState.backupCode}】！`);
        } catch (err) {
            showMiniNotice('⚠️ 格式錯誤', '通行碼格式不正確，請確認是否輸入完整。');
        }
        return;
    }

    if (!/^[A-Z0-9]{5}$/.test(cleaned)) {
        showMiniNotice('⚠️ 格式不符', '請輸入正確的「5 碼英文＋數字」通行碼（例如：K8M2P）！');
        return;
    }

    // 先向 Firebase 同步最新玩家資料庫，確保跨瀏覽器／新手機可即時查到
    if (typeof CloudSync !== 'undefined' && CloudSync.inFlightWrites === 0) {
        await CloudSync.fetchFullTree();
    }

    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    const matchedUser = users.find(u => {
        if (!u || !u.id) return false;
        const storedCode = String(u.backupCode || '').trim().toUpperCase();
        const derivedCode = (typeof deriveFixedBackupCode === 'function') ? deriveFixedBackupCode(u.id) : '';
        return storedCode === cleaned || derivedCode === cleaned;
    });

    if (!matchedUser) {
        backupRestoreFailCount++;
        if (backupRestoreFailCount >= 5) {
            backupRestoreLockUntil = Date.now() + 30000;
            backupRestoreFailCount = 0;
            showMiniNotice('⏳ 輸錯次數過多', '連續輸錯 5 次，系統已暫時鎖定 30 秒，請確認通行碼後再試。');
        } else {
            showMiniNotice('⚠️ 查無此通行碼', `找不到通行碼【${cleaned}】對應的玩家紀錄（剩餘可嘗試 ${5 - backupRestoreFailCount} 次），請確認英數字是否輸入正確。`);
        }
        return;
    }

    backupRestoreFailCount = 0;
    const pid = String(matchedUser.id);
    const loadedState = Store.loadByPlayerId(pid);
    const freshBase = Store.getDefaultState();

    loadedState.playerId = pid;
    loadedState.backupCode = cleaned;
    loadedState.lastSyncedCloudUpdatedAt = matchedUser.updatedAt || '';
    loadedState.isWarnedAccount = Boolean(matchedUser.isWarned);
    loadedState.warningReason = matchedUser.warningReason || '';
    loadedState.isChatBanned = Boolean(matchedUser.isChatBanned);
    loadedState.profile = { ...freshBase.profile, ...loadedState.profile, ...matchedUser };
    if (!loadedState.profile.region && loadedState.profile.city) {
        loadedState.profile.region = inferRegionByCity(loadedState.profile.city);
    }
    if (!loadedState.profile.mbtiGroup && loadedState.profile.mbti) {
        loadedState.profile.mbtiGroup = inferMbtiGroup(loadedState.profile.mbti);
    }
    loadedState.privacy = { ...freshBase.privacy, ...(matchedUser.privacy || loadedState.privacy || {}) };
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.alwaysOpen) loadedState.privacy[f.key] = 'open';
        });
    });
    loadedState.privacy.ig = 'closed';

    if (Array.isArray(matchedUser.registeredSessions)) {
        loadedState.registeredSessions = Array.from(new Set(matchedUser.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
    }
    if (matchedUser.exactMatchCriteria && typeof matchedUser.exactMatchCriteria === 'object') {
        loadedState.exactMatchCriteria = { ...matchedUser.exactMatchCriteria };
    }

    appState = loadedState;
    lastRenderedChatSignature = '';
    Store.save(appState);
    syncFromSharedStorage();
    renderProfileForm();
    refreshAllUI();
    updateMailboxBadge();
    closeBackupModal();

    showMiniNotice(
        '🌸 讀取紀錄成功',
        `已透過 5 碼通行碼【${cleaned}】成功載入您的紀錄！\n\n玩家暱稱：${matchedUser.nickname || '未設定'}\n玩家專屬 ID：${pid}`
    );
}


// ==================== 單機多分頁測試：切換已有玩家 ID 或以新玩家註冊 ====================
function switchTestPlayerAccount() {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    const existingSummary = users.length > 0
        ? '\n目前資料庫已有玩家：' + users.slice(0, 10).map(u => `${u.id}(${u.nickname})`).join('、')
        : '';

    const input = prompt(
        `👤 切換測試玩家帳號（不會刪除既有聊天與玩家資料）：\n・輸入「玩家 ID」（例如 10001 或 20001）可切換登入該帳號\n・留空直接按「確定」可建立一位全新未註冊玩家${existingSummary}`,
        ''
    );
    if (input === null) return;

    const trimmed = input.trim();
    if (!trimmed) {
        sessionStorage.removeItem(TAB_PLAYER_ID_KEY);
        appState = Store.getDefaultState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
        lastRenderedChatSignature = '';
        renderProfileForm();
        refreshAllUI();
        updateMailboxBadge();
        showMiniNotice('✨ 已切換為全新玩家', '你現在可以在這個分頁填寫並保存一位新玩家的資料（不會影響其他分頁的帳號與聊天紀錄）。');
        return;
    }

    const found = users.find(u => String(u.id) === trimmed);
    if (!found) {
        showMiniNotice('⚠️ 找不到此玩家 ID', `資料庫中沒有 ID 為「${trimmed}」的玩家，請確認後再試。`);
        return;
    }

    appState = Store.loadByPlayerId(trimmed);
    lastRenderedChatSignature = '';
    syncFromSharedStorage();
    renderProfileForm();
    refreshAllUI();
    updateMailboxBadge();
    showMiniNotice('🌸 切換帳號成功', `目前此分頁已登入為：${found.nickname}（ID：${found.id}），聊天歷史紀錄已完整載入！`);
}
