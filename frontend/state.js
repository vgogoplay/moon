/* frontend/state.js - 前台全域狀態、Firebase 即時同步、戀愛語錄與分頁切換 */

/* app.js - 男女生人數限制、性別限選男女、先選地區再選縣市、禁止玩家發話、前台信件箱 */

let appState = Store.load();
let lastControlsSnapshot = JSON.stringify(Store.getSystemConfig());
let lastCustomActivitiesSnapshot = localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]';
let lastCustomActivityPhaseSnapshot = '';
let lastGenderQuotaSnapshot = JSON.stringify(Store.getGenderQuotaStatus());
let lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
let lastReportsFrontendSnapshot = localStorage.getItem(REPORTS_KEY) || '[]';
let lastFateWallFrontendSnapshot = '';
let lastWishWallFrontendSnapshot = '';
let lastReconciledUsersRaw = '';
let lastUsersStatsSnapshot = '';
let lastActiveBatch = getCurrentBatchNumber();
let lastRenderedChatSignature = '';
let shouldScrollChatToLatest = true;

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
    if (appState.disableConfession) return false;
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
    if (typeof isLocalSandboxEnv === 'function' && isLocalSandboxEnv()) {
        const hdr = document.querySelector('header .max-w-4xl');
        if (hdr && !document.getElementById('localSandboxTopNotice')) {
            const pill = document.createElement('div');
            pill.id = 'localSandboxTopNotice';
            pill.className = 'text-[11px] px-2.5 py-1 rounded-full bg-teal-50 border border-teal-300 text-teal-800 font-bold shrink-0';
            pill.textContent = '🧪 本地測試模式（不影響正式庫）';
            hdr.insertBefore(pill, hdr.lastElementChild);
        }
    }
    initSakuraPetals();
    renderRandomMoment();
    if (typeof CloudSync !== 'undefined') {
        await CloudSync.init(() => {
            syncFromSharedStorage();
            if (typeof renderHomeFateWall === 'function') renderHomeFateWall();
            if (typeof updateWishNavBadge === 'function') updateWishNavBadge();
            if (!document.getElementById('tab-wishes')?.classList.contains('hidden') && typeof renderWishWallTab === 'function') {
                renderWishWallTab();
            }
            if (!document.getElementById('tab-forum')?.classList.contains('hidden') && typeof refreshForum === 'function') {
                refreshForum();
            }
            updateMailboxBadge();
    if (typeof updateFriendUnreadDot === 'function') updateFriendUnreadDot();
    const currentReportsRaw = localStorage.getItem(REPORTS_KEY) || '[]';
    if (currentReportsRaw !== lastReportsFrontendSnapshot) {
        lastReportsFrontendSnapshot = currentReportsRaw;
        if (typeof updateReportReplyBadge === 'function') updateReportReplyBadge();
        const repModal = document.getElementById('reportModal');
        if (repModal && !repModal.classList.contains('hidden') && typeof renderMyIssueReportsList === 'function') {
            if (typeof markMyReportRepliesAsRead === 'function') markMyReportRepliesAsRead();
            renderMyIssueReportsList();
        }
    }
            if (typeof updateReportReplyBadge === 'function') updateReportReplyBadge();
            if (typeof syncOpenMailboxModalView === 'function') {
                syncOpenMailboxModalView();
            } else if (!document.getElementById('mailboxModal').classList.contains('hidden') &&
                !document.getElementById('mailboxListView').classList.contains('hidden')) {
                renderMailboxList();
            }
            const repModal = document.getElementById('reportModal');
            if (repModal && !repModal.classList.contains('hidden') && typeof renderMyIssueReportsList === 'function') {
                if (typeof markMyReportRepliesAsRead === 'function') markMyReportRepliesAsRead();
                renderMyIssueReportsList();
            }
        });
        appState = Store.load();
    }
    syncFromSharedStorage();
    if (typeof renderHomeFateWall === 'function') renderHomeFateWall(true);
    if (typeof updateWishNavBadge === 'function') updateWishNavBadge();
    if (typeof renderWishWallTab === 'function') renderWishWallTab(true);
    if (!document.getElementById('tab-forum')?.classList.contains('hidden') && typeof refreshForum === 'function') {
        refreshForum();
    }
    renderProfileForm();
    refreshAllUI();
    if (typeof syncAlreadyReadSingleMailsReceipts === 'function') {
        syncAlreadyReadSingleMailsReceipts();
    }
    updateMailboxBadge();
    if (typeof updateReportReplyBadge === 'function') updateReportReplyBadge();

    const FRONTEND_MAIN_SYNC_INTERVAL_MS = 30000;
    // 倒數計時維持每秒更新（分頁隱藏時暫停省電）；主同步改為事件驅動＋15 秒低頻時間檢查
    setInterval(() => {
        if (!document.hidden) {
            updateNextMatchCountdown();
        }
    }, 1000);
    setInterval(() => {
        if (!document.hidden) {
            syncFromSharedStorage();
        }
    }, FRONTEND_MAIN_SYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        updateSakuraAnimationState();
        if (!document.hidden) {
            updateNextMatchCountdown();
            syncFromSharedStorage();
            const friendsTabEl = document.getElementById('tab-friends');
            if (friendsTabEl && !friendsTabEl.classList.contains('hidden') && typeof renderFriendsSection === 'function') {
                renderFriendsSection();
            }
        }
    });
    updateNextMatchCountdown();

    window.addEventListener('storage', (e) => {
        const fwKey = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
        const wwKey = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
        if ([USERS_LOCAL_KEY, SYSTEM_STATE_KEY, CUSTOM_ACTIVITIES_KEY, BANNED_RULES_KEY, MAILBOX_KEY, REPORTS_KEY, CHATS_KEY, fwKey, wwKey, 'yuelao_forum_index', 'yuelao_test_event'].includes(e.key)) {
            if (e.key === 'yuelao_forum_index' && typeof refreshForum === 'function') {
                refreshForum();
            }
            if (e.key === fwKey && typeof renderHomeFateWall === 'function') {
                renderHomeFateWall(true);
            }
            if (e.key === wwKey) {
                if (typeof updateWishNavBadge === 'function') updateWishNavBadge();
                if (!document.getElementById('tab-wishes')?.classList.contains('hidden') && typeof renderWishWallTab === 'function') {
                    renderWishWallTab(true);
                }
            }
            syncFromSharedStorage();
            updateMailboxBadge();
            if (typeof updateReportReplyBadge === 'function') updateReportReplyBadge();
            if (typeof syncOpenMailboxModalView === 'function') {
                syncOpenMailboxModalView();
            } else if (!document.getElementById('mailboxModal').classList.contains('hidden') &&
                !document.getElementById('mailboxListView').classList.contains('hidden')) {
                renderMailboxList();
            }
            const repModal = document.getElementById('reportModal');
            if (repModal && !repModal.classList.contains('hidden') && typeof renderMyIssueReportsList === 'function') {
                if (typeof markMyReportRepliesAsRead === 'function') markMyReportRepliesAsRead();
                renderMyIssueReportsList();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.multiselect-wrapper')) {
            const hadOpenMenu = Array.from(document.querySelectorAll('.multiselect-menu'))
                .some(m => !m.classList.contains('hidden'));
            document.querySelectorAll('.multiselect-menu').forEach(m => m.classList.add('hidden'));
            if (hadOpenMenu && typeof flushPendingProfileFormRerender === 'function' && !hasUnsavedProfileDraft) {
                flushPendingProfileFormRerender();
            }
        }
    });

    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
    }
});

function syncFromSharedStorage() {
    const rawUsersStr = localStorage.getItem(USERS_LOCAL_KEY) || '[]';
    const currentChatsRaw = localStorage.getItem(CHATS_KEY) || '';
    const users = (typeof Store !== 'undefined' && typeof Store.getUsersArray === 'function')
        ? Store.getUsersArray()
        : JSON.parse(rawUsersStr);
    if (rawUsersStr !== lastReconciledUsersRaw || currentChatsRaw !== lastChatsSnapshot) {
        lastReconciledUsersRaw = rawUsersStr;
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.reconcileSymmetricMatches === 'function') {
            if (CloudSync.reconcileSymmetricMatches(users, false)) {
                localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
                if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate(USERS_LOCAL_KEY);
            }
        }
    }
    let stateChanged = false;
    let formLockStateChanged = false;

    const sysCfgNow = Store.getSystemConfig();
    const prevSysCfg = (() => { try { return JSON.parse(lastControlsSnapshot || '{}'); } catch (e) { return {}; } })();
    const currentControlsStr = JSON.stringify(sysCfgNow);
    if (currentControlsStr !== lastControlsSnapshot || sysCfgNow.currentBatch !== lastActiveBatch) {
        if (Boolean(prevSysCfg.profileLocked) !== Boolean(sysCfgNow.profileLocked)) {
            formLockStateChanged = true;
        }
        lastControlsSnapshot = currentControlsStr;
        lastActiveBatch = sysCfgNow.currentBatch;
        stateChanged = true;
        if (!sysCfgNow.registrationOpen) {
            closeRegisterModal();
        }
    }

    if (typeof checkScheduledCustomActivities === 'function') {
        const autoMatchedNow = checkScheduledCustomActivities(true);
        if (autoMatchedNow) {
            users.splice(0, users.length, ...JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]'));
            stateChanged = true;
        }
    }

    if (typeof cleanupExpiredActivityRegistrations === 'function') {
        const regCleanedNow = cleanupExpiredActivityRegistrations(true);
        if (regCleanedNow) {
            users.splice(0, users.length, ...JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]'));
            stateChanged = true;
        }
    }

    const currentCustomActsRaw = localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]';
    const openActsNow = (typeof Store.getOpenCustomActivities === 'function') ? Store.getOpenCustomActivities() : [];
    const currentPhaseSnap = (typeof getCustomActivityScheduleState === 'function')
        ? openActsNow.map(a => `${a.id}:${getCustomActivityScheduleState(a).status}`).join('|')
        : '';
    if (currentCustomActsRaw !== lastCustomActivitiesSnapshot || currentPhaseSnap !== lastCustomActivityPhaseSnapshot) {
        lastCustomActivitiesSnapshot = currentCustomActsRaw;
        lastCustomActivityPhaseSnapshot = currentPhaseSnap;
        stateChanged = true;
        const openModalActId = document.getElementById('customActModalId')?.value;
        if (openModalActId) {
            const targetOpenAct = openActsNow.find(a => String(a.id) === String(openModalActId));
            if (!targetOpenAct || (typeof getCustomActivityScheduleState === 'function' && !getCustomActivityScheduleState(targetOpenAct).canRegister)) {
                closeCustomActivityModal();
            }
        }
    }

    const quotaObjNow = Store.getGenderQuotaStatus();
    const prevQuotaObj = (() => { try { return JSON.parse(lastGenderQuotaSnapshot || '{}'); } catch (e) { return {}; } })();
    const effectiveQuotaSnapshot = JSON.stringify({
        enabled: quotaObjNow.enabled,
        limit: quotaObjNow.limit,
        maleFull: quotaObjNow.maleFull,
        femaleFull: quotaObjNow.femaleFull,
        bothFull: quotaObjNow.bothFull,
        maleCount: quotaObjNow.enabled ? quotaObjNow.maleCount : 0,
        femaleCount: quotaObjNow.enabled ? quotaObjNow.femaleCount : 0
    });
    if (effectiveQuotaSnapshot !== lastGenderQuotaSnapshot) {
        const lockBooleansChanged = (
            Boolean(prevQuotaObj.enabled) !== Boolean(quotaObjNow.enabled) ||
            Boolean(prevQuotaObj.maleFull) !== Boolean(quotaObjNow.maleFull) ||
            Boolean(prevQuotaObj.femaleFull) !== Boolean(quotaObjNow.femaleFull) ||
            Boolean(prevQuotaObj.bothFull) !== Boolean(quotaObjNow.bothFull)
        );
        lastGenderQuotaSnapshot = effectiveQuotaSnapshot;
        stateChanged = true;
        if (lockBooleansChanged) {
            formLockStateChanged = true;
        }
    }

    let chatsChanged = false;
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
                const isFreshCmd = !cmd.ts || (Date.now() - Number(cmd.ts) <= 60000);
                if (isFreshCmd) {
                    applyBackendTestEvent(cmd, users);
                    stateChanged = true;
                }
            }
        } catch (err) {}
    }

    if (appState.playerId) {
        const userById = new Map();
        users.forEach(u => {
            if (u && u.id) userById.set(String(u.id), u);
        });
        const me = userById.get(String(appState.playerId));
        if (me && mergeConfessionFromCloud(appState, me)) stateChanged = true;

        // 2. 若雲端已初始化且玩家資料已被後台管理員整筆刪除，同步重置前台本地狀態
        const isDeletedByAdmin = (typeof CloudSync !== 'undefined' && typeof CloudSync.isUserDeleted === 'function' && CloudSync.isUserDeleted(appState.playerId));
        const isPendingSync = !isDeletedByAdmin && (typeof CloudSync !== 'undefined' && typeof CloudSync.isUserPending === 'function' && CloudSync.isUserPending(appState.playerId));
        if ((!me && !isPendingSync && (typeof CloudSync === 'undefined' || CloudSync.initialized)) || isDeletedByAdmin) {
            appState = Store.getDefaultState();
            appState.lastProcessedTestCmdId = JSON.parse(localStorage.getItem('yuelao_test_event') || '{}').id || null;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
            renderProfileForm();
            refreshAllUI();
            updateMailboxBadge();
            return;
        }

        // 若管理員於後台編輯了此玩家的個人資料，或本地快取缺少居住地/MBTI，自動從雲端補齊（玩家正在編輯或展開下拉選單時不覆蓋）
        const isActivelyInteractingNow = (typeof isUserInteractingWithProfileForm === 'function' && isUserInteractingWithProfileForm());
        const isEditingProfileNow = (typeof hasUnsavedProfileDraft !== 'undefined' && hasUnsavedProfileDraft) || isActivelyInteractingNow;
        const isMissingCloudCoreFields = Boolean(
            me && !isEditingProfileNow && (
                (!appState.profile.city && me.city) ||
                (!appState.profile.region && (me.region || inferRegionByCity(me.city))) ||
                (!appState.profile.mbti && me.mbti) ||
                (!appState.profile.mbtiGroup && (me.mbtiGroup || inferMbtiGroup(me.mbti)))
            )
        );
        if (me && !isEditingProfileNow && ((me.updatedAt && me.updatedAt !== appState.lastSyncedCloudUpdatedAt) || isMissingCloudCoreFields)) {
            appState.lastSyncedCloudUpdatedAt = me.updatedAt;
            const prevRegion = appState.profile.region || '';
            const prevCity = appState.profile.city || '';
            const prevMbtiGroup = appState.profile.mbtiGroup || '';
            const prevMbti = appState.profile.mbti || '';

            const skipSyncKeys = new Set([
                'id', 'privacy', 'backupCode', 'isWarned', 'warningReason',
                'isMatchBanned', 'isChatBanned', 'disableConfession', 'registeredSessions', 'registeredSession',
                'exactMatchCriteria', 'customActivityRegs', 'matchedHistory', 'matchedSession',
                'matchedWithId', 'matchedWithName', 'matchedAt', 'updatedAt',
                'forceConfessionTriggerId'
            ]);
            Object.entries(me).forEach(([k, v]) => {
                if (!skipSyncKeys.has(k)) {
                    appState.profile[k] = v;
                }
            });

            if (!appState.profile.city && prevCity) appState.profile.city = prevCity;
            if (!appState.profile.region) {
                appState.profile.region = inferRegionByCity(appState.profile.city) || prevRegion;
            }
            if (!appState.profile.mbti && prevMbti) appState.profile.mbti = prevMbti;
            if (!appState.profile.mbtiGroup) {
                appState.profile.mbtiGroup = inferMbtiGroup(appState.profile.mbti) || prevMbtiGroup;
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

        if (me) {
            // 同步後台禁止發話狀態與禁止心動抉擇設定
            const nextChatBanned = Boolean(me.isChatBanned);
            if (Boolean(appState.isChatBanned) !== nextChatBanned) {
                appState.isChatBanned = nextChatBanned;
                stateChanged = true;
            }
            const nextDisableConfession = Boolean(me.disableConfession);
            if (Boolean(appState.disableConfession) !== nextDisableConfession) {
                appState.disableConfession = nextDisableConfession;
                stateChanged = true;
            }

            // 同步並正規化前後台已儲存的報名場次與條件（Firebase RTDB 會省略空陣列 []，故 undefined 視同 []）
            const rawCloudSessions = Array.isArray(me.registeredSessions) ? me.registeredSessions : [];
            const normUserSessions = Array.from(new Set(rawCloudSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
            const normAppSessions = Array.from(new Set((appState.registeredSessions || []).map(s => normalizeSessionLabel(s)).filter(Boolean)));
            if (JSON.stringify(normUserSessions) !== JSON.stringify(normAppSessions)) {
                delete appState.registeredSession;
                appState.registeredSessions = normUserSessions;
                stateChanged = true;
                const regModalEl = document.getElementById('registerModal');
                if (regModalEl && !regModalEl.classList.contains('hidden') && typeof openRegisterModal === 'function') {
                    openRegisterModal();
                }
            }

            const cloudExactCriteria = (me.exactMatchCriteria && typeof me.exactMatchCriteria === 'object' && !Array.isArray(me.exactMatchCriteria))
                ? me.exactMatchCriteria
                : {};
            const localExactCriteria = (appState.exactMatchCriteria && typeof appState.exactMatchCriteria === 'object' && !Array.isArray(appState.exactMatchCriteria))
                ? appState.exactMatchCriteria
                : {};
            const cloudMustKeys = (typeof normalizeMustMatchKeysList === 'function')
                ? normalizeMustMatchKeysList(me.mustMatchKeys, cloudExactCriteria)
                : (Array.isArray(me.mustMatchKeys) ? me.mustMatchKeys.slice(0, 2) : []);
            const localMustKeys = (typeof normalizeMustMatchKeysList === 'function')
                ? normalizeMustMatchKeysList(appState.mustMatchKeys, localExactCriteria)
                : (Array.isArray(appState.mustMatchKeys) ? appState.mustMatchKeys.slice(0, 2) : []);
            if (
                JSON.stringify(cloudExactCriteria) !== JSON.stringify(localExactCriteria) ||
                JSON.stringify(cloudMustKeys) !== JSON.stringify(localMustKeys)
            ) {
                appState.exactMatchCriteria = { ...cloudExactCriteria };
                appState.mustMatchKeys = [...cloudMustKeys];
                stateChanged = true;
            }

            // 同步第 2 種活動（自定義專屬活動）報名紀錄（本地剛送出或取消的 6 秒保護期內不覆蓋，避免閃爍）
            const isSuppressingCustomSync = (typeof customActivitySyncSuppressUntil !== 'undefined' && Date.now() < customActivitySyncSuppressUntil);
            if (!isSuppressingCustomSync) {
                const cloudCustomRegs = (me.customActivityRegs && typeof me.customActivityRegs === 'object' && !Array.isArray(me.customActivityRegs))
                    ? me.customActivityRegs
                    : {};
                if (JSON.stringify(cloudCustomRegs) !== JSON.stringify(appState.customActivityRegs || {})) {
                    appState.customActivityRegs = { ...cloudCustomRegs };
                    stateChanged = true;
                    const modalEl = document.getElementById('customActivityModal');
                    const openModalActId = document.getElementById('customActModalId')?.value;
                    if (modalEl && !modalEl.classList.contains('hidden') && openModalActId) {
                        openCustomActivityModal(openModalActId);
                    }
                }
            }
        }

        // 3. 同步所有已配對好友（不限數量，聯集 matchedHistory 與 matchedWithId 並排除已解除配對組合）
        const historyList = (me && typeof CloudSync !== 'undefined' && typeof CloudSync.normalizeMatchedHistoryList === 'function')
            ? CloudSync.normalizeMatchedHistoryList(me.matchedHistory)
            : ((me && Array.isArray(me.matchedHistory)) ? [...me.matchedHistory] : []);
        const meDirectPartnerId = me && me.matchedWithId ? String(me.matchedWithId).trim() : '';
        const isDirectUnmatched = Boolean(
            me && meDirectPartnerId &&
            typeof CloudSync !== 'undefined' &&
            typeof CloudSync.isPairRecentlyUnmatched === 'function' &&
            CloudSync.isPairRecentlyUnmatched(me.id, meDirectPartnerId)
        );
        if (me && meDirectPartnerId && !isDirectUnmatched && !historyList.some(h => String(h.partnerId) === meDirectPartnerId)) {
            const directSessStr = String(me.matchedSession || '').trim();
            historyList.push({
                session: directSessStr,
                partnerId: meDirectPartnerId,
                partnerName: me.matchedWithName || '',
                matchedAt: me.matchedAt || Date.now(),
                isForceRepaired: Boolean(directSessStr.includes('・強制補齊')),
                continueVotes: []
            });
        }

        historyList.forEach(item => {
            const partner = userById.get(String(item.partnerId));
            if (partner && !appState.friends.some(f => String(f.id) === String(partner.id))) {
                const now = item.matchedAt || Date.now();
                const willReachMulti = appState.friends.length >= 1;
                if (willReachMulti && !appState.confessionUnlockAt) {
                    appState.multiFriendSince = now;
                    appState.confessionUnlockAt = calcConfessionUnlockTime(now);
                }

                const cleanDisplaySession = String(item.session || '').replace(/・?強制補齊/g, '').trim();
                const cleanDisplayDetail = String(item.matchDetail || '').replace(/・?強制補齊/g, '').trim();
                const detailPart = cleanDisplayDetail ? `（${cleanDisplayDetail}）` : '';
                const matchPrefix = item.activityId
                    ? `🌸【${cleanDisplaySession}】月老牽線成功！${detailPart}`
                    : `🌸【${cleanDisplaySession}】20:00 月老牽線成功！`;
                const initialThread = [
                    { senderId: 'system', text: `${matchPrefix}好友名單將保留 7 天（聊天紀錄將永久保留，直到直接解除配對才會清空）。`, time: '' }
                ];
                if (me.oneSentence) {
                    initialThread.push({ senderId: String(me.id), senderName: me.nickname || '', text: me.oneSentence, time: '20:01' });
                }
                if (partner.oneSentence) {
                    initialThread.push({ senderId: String(partner.id), senderName: partner.nickname || '', text: partner.oneSentence, time: '20:01' });
                }
                const syncedMsgs = ChatStore.ensureThread(me.id, partner.id, initialThread);
                const votes = Array.isArray(item.continueVotes) ? item.continueVotes.map(String) : [];

                const isForceProtectedItem = Boolean(
                    item.isForceRepaired ||
                    String(item.session || '').includes('・強制補齊') ||
                    String(item.matchDetail || '').includes('強制補齊')
                );
                appState.friends.push({
                    id: String(partner.id),
                    nickname: partner.nickname,
                    sessionLabel: item.session,
                    matchedAt: now,
                    igUnlocked: Boolean(item.igUnlocked),
                    isForceRepaired: isForceProtectedItem,
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

        // 4. 檢查後台是否已彈性解除特定配對（僅移除被解除的那位好友，其餘好友完整保留，並去重防止重複卡片）
        const activeBackendPartnerIds = new Set(historyList.map(h => String(h.partnerId)));
        const beforeCount = appState.friends.length;
        const seenFriendIds = new Set();
        appState.friends = appState.friends.filter(f => {
            const fid = String(f.id);
            if (seenFriendIds.has(fid)) return false;
            seenFriendIds.add(fid);
            if (fid.startsWith('MOCK_FRIEND_')) return true;
            return activeBackendPartnerIds.has(fid);
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
            const latestPartner = userById.get(String(f.id));
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
                const nextForceProt = Boolean(
                    histItem.isForceRepaired ||
                    String(histItem.session || '').includes('・強制補齊') ||
                    String(histItem.matchDetail || '').includes('強制補齊')
                );
                if (Boolean(f.isForceRepaired) !== nextForceProt) {
                    f.isForceRepaired = nextForceProt;
                    stateChanged = true;
                }
                if (histItem.session && f.sessionLabel !== histItem.session) {
                    f.sessionLabel = histItem.session;
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

        // 6. 檢查後台是否指定此玩家 ID 直接觸發 20:00 心動抉擇（支援在線即時與離線補觸發）
        if (me && me.forceConfessionTriggerId && String(me.forceConfessionTriggerId) !== String(appState.lastHandledForceConfessionId || '')) {
            appState.lastHandledForceConfessionId = String(me.forceConfessionTriggerId);
            if (appState.friends.length >= 2) {
                appState.confessionUnlockAt = Date.now() - 1000;
                appState.lastConfessionDate = null;
                stateChanged = true;
            }
            persistConfessionState();
        }
    }

    updateMailboxBadge();

    if (stateChanged) {
        const isEditingDraft = (typeof hasUnsavedProfileDraft !== 'undefined' && hasUnsavedProfileDraft);
        if (isEditingDraft && typeof syncProfileDomToDraft === 'function') {
            syncProfileDomToDraft();
        }
        const isActivelyInteracting = (typeof isUserInteractingWithProfileForm === 'function' && isUserInteractingWithProfileForm());
        Store.save(appState, false, true);
        const profileTabEl = document.getElementById('tab-profile');
        const isOnProfileTab = profileTabEl && !profileTabEl.classList.contains('hidden');
        if (!isOnProfileTab) {
            renderProfileForm();
        } else if (isActivelyInteracting) {
            if (formLockStateChanged || !isEditingDraft) {
                if (typeof pendingProfileFormRerender !== 'undefined') {
                    pendingProfileFormRerender = true;
                }
            }
        } else if (formLockStateChanged || !isEditingDraft) {
            renderProfileForm();
        }
        refreshAllUI();
        if (isEveningConfessionPending()) {
            openEveningConfessionModal();
        }
    } else {
        if (chatsChanged) {
            Store.save(appState, false, true);
            if (typeof updateFriendUnreadDot === 'function') updateFriendUnreadDot();
        }
        const fwKey = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
        const curFateWallRaw = localStorage.getItem(fwKey) || '[]';
        if (curFateWallRaw !== lastFateWallFrontendSnapshot) {
            lastFateWallFrontendSnapshot = curFateWallRaw;
            if (typeof renderHomeFateWall === 'function') {
                renderHomeFateWall();
            }
        }
        const wwKey = (typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall';
        const curWishWallRaw = localStorage.getItem(wwKey) || '[]';
        if (curWishWallRaw !== lastWishWallFrontendSnapshot) {
            lastWishWallFrontendSnapshot = curWishWallRaw;
            if (typeof updateWishNavBadge === 'function') {
                updateWishNavBadge();
            }
            if (!document.getElementById('tab-wishes')?.classList.contains('hidden') && typeof renderWishWallTab === 'function') {
                renderWishWallTab();
            }
        }
        if (typeof renderHomeStatsCharts === 'function') {
            renderHomeStatsCharts(false);
        }
        if (chatsChanged && !document.getElementById('tab-friends').classList.contains('hidden')) {
            renderFriendsSection();
        }
        const curSched = getBatchScheduleInfo(getCurrentBatchNumber());
        const periodBadgeEl = document.getElementById('currentPeriodBadge');
        if (periodBadgeEl) {
            periodBadgeEl.textContent = `目前開放：${curSched.batchPrefix}（${curSched.wedDateStr}(三) / ${curSched.satDateStr}(六)）`;
        }
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
                if (!appState.profile.mbtiGroup && appState.profile.mbti) {
                    appState.profile.mbtiGroup = inferMbtiGroup(appState.profile.mbti);
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
    } else if (cmd.type === 'REMOVE_FRIEND_C') {
        if (targetId && String(appState.playerId) !== targetId) return;
        const targetMockId = cmd.mockFriendId ? String(cmd.mockFriendId) : '';
        if (targetMockId && appState.friends.some(f => String(f.id) === targetMockId)) {
            appState.friends = appState.friends.filter(f => String(f.id) !== targetMockId);
        } else {
            let lastMockIdx = -1;
            for (let i = appState.friends.length - 1; i >= 0; i--) {
                if (String(appState.friends[i].id).startsWith('MOCK_FRIEND_')) {
                    lastMockIdx = i;
                    break;
                }
            }
            if (lastMockIdx >= 0) {
                appState.friends.splice(lastMockIdx, 1);
            }
        }
        if (appState.activeFriendId && !appState.friends.some(f => String(f.id) === String(appState.activeFriendId))) {
            appState.activeFriendId = appState.friends[0] ? String(appState.friends[0].id) : null;
        }
        if (appState.friends.length < 2) {
            appState.multiFriendSince = null;
            appState.confessionUnlockAt = null;
        }
    } else if (cmd.type === 'CLEAR_ALL_FRIEND_C') {
        if (targetId && String(appState.playerId) !== targetId) return;
        appState.friends = appState.friends.filter(f => !String(f.id).startsWith('MOCK_FRIEND_'));
        if (appState.activeFriendId && !appState.friends.some(f => String(f.id) === String(appState.activeFriendId))) {
            appState.activeFriendId = appState.friends[0] ? String(appState.friends[0].id) : null;
        }
        if (appState.friends.length < 2) {
            appState.multiFriendSince = null;
            appState.confessionUnlockAt = null;
        }
    } else if (cmd.type === 'ADVANCE_CONFESSION_2000') {
        if (targetId && String(appState.playerId) !== targetId) return;
        if (cmd.triggerToken) {
            appState.lastHandledForceConfessionId = String(cmd.triggerToken);
        }
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

function updateSakuraAnimationState(activeTabName = null) {
    const container = document.getElementById('sakuraContainer');
    if (!container) return;
    const isHomeActive = activeTabName
        ? activeTabName === 'home'
        : !document.getElementById('tab-home')?.classList.contains('hidden');
    container.classList.toggle('sakura-paused', Boolean(document.hidden || !isHomeActive));
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tabBtn === tabName);
    });
    updateSakuraAnimationState(tabName);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabName === 'home' && typeof renderHomeStatsCharts === 'function') {
        renderHomeStatsCharts(true);
    }

    if (tabName === 'forum' && typeof refreshForum === 'function') {
        refreshForum();
    }

    if (tabName === 'wishes' && typeof renderWishWallTab === 'function') {
        renderWishWallTab(true);
    }

    if (tabName !== 'friends') {
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.closeActiveChatRoom === 'function') {
            CloudSync.closeActiveChatRoom();
        }
    }

    if (tabName === 'friends') {
        shouldScrollChatToLatest = true;
        renderFriendsSection();
        if (typeof CloudSync !== 'undefined' && CloudSync.initialized && !CloudSync.isLocalSandboxMode() && typeof CloudSync.pollPlayerHot === 'function') {
            CloudSync.pollPlayerHot();
        }
        if (isEveningConfessionPending()) {
            openEveningConfessionModal();
        }
    }
}

// ==================== 週三 (3) 與週六 (6) 20:00 倒數計時 ====================
let lastRegularSessionCutoffSig = '';

function updateNextMatchCountdown() {
    const now = new Date();
    const nowMs = now.getTime();
    if (typeof getBatchScheduleInfo === 'function' && typeof getCurrentBatchNumber === 'function' && typeof isRegularSessionRegistrationClosed === 'function') {
        const curSched = getBatchScheduleInfo(getCurrentBatchNumber());
        const wedClosed = isRegularSessionRegistrationClosed(curSched.wedLabel, nowMs);
        const satClosed = isRegularSessionRegistrationClosed(curSched.satLabel, nowMs);
        const cutoffSig = `${curSched.batch}:${wedClosed}:${satClosed}`;
        if (lastRegularSessionCutoffSig && cutoffSig !== lastRegularSessionCutoffSig) {
            lastRegularSessionCutoffSig = cutoffSig;
            if (typeof refreshAllUI === 'function') refreshAllUI();
            const regModalEl = document.getElementById('registerModal');
            if (regModalEl && !regModalEl.classList.contains('hidden') && typeof renderRegisterModalSessionOptions === 'function') {
                renderRegisterModalSessionOptions(nowMs);
            }
        } else {
            lastRegularSessionCutoffSig = cutoffSig;
        }
    }
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
