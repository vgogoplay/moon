/* shared/cloud-store.js - 前後台共用：Firebase 即時雲端同步、玩家資料庫、信箱與聊天室管理器 */

const STORAGE_KEY = 'yuelao_romance_app_v2';
const USERS_KEY = 'yuelao_users';
const REPORTS_KEY = 'yuelao_reports';
const REPORTS_MAX_COUNT = 15;
const ID_COUNTER_KEY = 'yuelao_id_counters';
const SYSTEM_STATE_KEY = 'yuelao_system_batch';
const BANNED_RULES_KEY = 'yuelao_banned_rules';
const MAILBOX_KEY = 'yuelao_mailbox';
const CHATS_KEY = 'yuelao_chats';
const CUSTOM_ACTIVITIES_KEY = 'yuelao_custom_activities';
const REG_HISTORY_KEY = 'yuelao_activity_reg_history';
const FORCE_KEY = 'yuelao_force_matches';
const AUTO_RUN_LOG_KEY = 'yuelao_auto_matched_sessions';
const FRONTEND_STORAGE_KEY = 'yuelao_romance_app_v2';
const TAB_PLAYER_ID_KEY = 'yuelao_tab_player_id';
const PLAYER_STATE_PREFIX = 'yuelao_player_state_';
const PENDING_USERS_SYNC_KEY = 'yuelao_pending_users_sync';
const DELETED_USERS_SYNC_KEY = 'yuelao_deleted_users_sync';
const UNMATCHED_PAIRS_SYNC_KEY = 'yuelao_unmatched_pairs_sync';
const UNMATCHED_PAIRS_CLOUD_NODE = 'yuelao_unmatched_pairs';
const MATCH_LOGS_KEY = 'yuelao_match_logs';
const MATCH_LOGS_MAX_COUNT = 30;
const FATE_WALL_KEY = 'yuelao_fate_wall';
const WISH_WALL_KEY = 'yuelao_wish_wall';

const FIREBASE_DB_URL = 'https://moon-8b627-default-rtdb.asia-southeast1.firebasedatabase.app';

// ==================== ☁️ Firebase Realtime Database 跨裝置即時雲端同步中樞 ====================
const CloudSync = {
    dbUrl: FIREBASE_DB_URL.replace(/\/+$/, ''),
    tree: {},
    initialized: false,
    eventSource: null,
    pollTimer: null,
    onUpdateCallback: null,
    lastPushedUsersJson: {},
    inFlightWrites: 0,
    writeEpoch: 0,
    isOnline: true,
    beforeUnloadBound: false,
    pendingUsers: {},
    deletedUsers: {},
    unmatchedPairs: {},

    loadSharedPendingUsers() {
        const now = Date.now();
        const merged = { ...this.pendingUsers };
        try {
            const raw = JSON.parse(localStorage.getItem(PENDING_USERS_SYNC_KEY) || '{}');
            if (raw && typeof raw === 'object') {
                Object.keys(raw).forEach(pid => {
                    const entry = raw[pid];
                    if (entry && entry.record && now <= Number(entry.graceUntil || 0)) {
                        if (!merged[pid] || Number(entry.graceUntil) >= Number(merged[pid].graceUntil || 0)) {
                            merged[pid] = entry;
                        }
                    }
                });
            }
        } catch (e) {}
        let changed = false;
        Object.keys(merged).forEach(pid => {
            if (!merged[pid] || now > Number(merged[pid].graceUntil || 0)) {
                delete merged[pid];
                changed = true;
            }
        });
        this.pendingUsers = merged;
        if (changed) {
            try { localStorage.setItem(PENDING_USERS_SYNC_KEY, JSON.stringify(merged)); } catch (e) {}
        }
        return merged;
    },

    setSharedPendingUser(pid, record, ttlMs = 25000) {
        const key = String(pid || '').trim();
        if (!key || !record) return;
        this.clearSharedDeletedUser(key);
        const map = this.loadSharedPendingUsers();
        map[key] = { record, graceUntil: Date.now() + ttlMs };
        this.pendingUsers = map;
        try { localStorage.setItem(PENDING_USERS_SYNC_KEY, JSON.stringify(map)); } catch (e) {}
    },

    removeSharedPendingUser(pid) {
        const key = String(pid || '').trim();
        if (!key) return;
        const map = this.loadSharedPendingUsers();
        if (Object.prototype.hasOwnProperty.call(map, key)) {
            delete map[key];
            this.pendingUsers = map;
            try { localStorage.setItem(PENDING_USERS_SYNC_KEY, JSON.stringify(map)); } catch (e) {}
        }
    },

    loadSharedDeletedUsers() {
        const now = Date.now();
        const merged = { ...this.deletedUsers };
        try {
            const raw = JSON.parse(localStorage.getItem(DELETED_USERS_SYNC_KEY) || '{}');
            if (raw && typeof raw === 'object') {
                Object.keys(raw).forEach(pid => {
                    const exp = Number(raw[pid] || 0);
                    if (now <= exp) {
                        merged[pid] = Math.max(Number(merged[pid] || 0), exp);
                    }
                });
            }
        } catch (e) {}
        let changed = false;
        Object.keys(merged).forEach(pid => {
            if (now > Number(merged[pid] || 0)) {
                delete merged[pid];
                changed = true;
            }
        });
        this.deletedUsers = merged;
        if (changed) {
            try { localStorage.setItem(DELETED_USERS_SYNC_KEY, JSON.stringify(merged)); } catch (e) {}
        }
        return merged;
    },

    markSharedDeletedUser(pid, ttlMs = 20000) {
        const key = String(pid || '').trim();
        if (!key) return;
        this.removeSharedPendingUser(key);
        delete this.lastPushedUsersJson[key];
        const map = this.loadSharedDeletedUsers();
        map[key] = Date.now() + ttlMs;
        this.deletedUsers = map;
        try { localStorage.setItem(DELETED_USERS_SYNC_KEY, JSON.stringify(map)); } catch (e) {}
    },

    clearSharedDeletedUser(pid) {
        const key = String(pid || '').trim();
        if (!key) return;
        const map = this.loadSharedDeletedUsers();
        if (Object.prototype.hasOwnProperty.call(map, key)) {
            delete map[key];
            this.deletedUsers = map;
            try { localStorage.setItem(DELETED_USERS_SYNC_KEY, JSON.stringify(map)); } catch (e) {}
        }
    },

    isUserPending(pid) {
        const key = String(pid || '').trim();
        if (!key) return false;
        const map = this.loadSharedPendingUsers();
        return Boolean(map[key] && Date.now() <= Number(map[key].graceUntil || 0));
    },

    isUserDeleted(pid) {
        const key = String(pid || '').trim();
        if (!key) return false;
        const map = this.loadSharedDeletedUsers();
        return Boolean(map[key] && Date.now() <= Number(map[key] || 0));
    },

    makeUnmatchedPairKey(idA, idB) {
        const a = String(idA || '').trim();
        const b = String(idB || '').trim();
        if (!a || !b || a === b) return '';
        return [a, b].sort().join('__');
    },

    loadSharedUnmatchedPairs() {
        const now = Date.now();
        const merged = { ...this.unmatchedPairs };
        try {
            const raw = JSON.parse(localStorage.getItem(UNMATCHED_PAIRS_SYNC_KEY) || '{}');
            if (raw && typeof raw === 'object') {
                Object.keys(raw).forEach(pk => {
                    const exp = Number(raw[pk] || 0);
                    if (now <= exp) {
                        merged[pk] = Math.max(Number(merged[pk] || 0), exp);
                    }
                });
            }
        } catch (e) {}
        if (this.tree && this.tree[UNMATCHED_PAIRS_CLOUD_NODE] && typeof this.tree[UNMATCHED_PAIRS_CLOUD_NODE] === 'object') {
            Object.keys(this.tree[UNMATCHED_PAIRS_CLOUD_NODE]).forEach(pk => {
                const val = this.tree[UNMATCHED_PAIRS_CLOUD_NODE][pk];
                const exp = (val && typeof val === 'object') ? Number(val.graceUntil || 0) : Number(val || 0);
                if (now <= exp) {
                    merged[pk] = Math.max(Number(merged[pk] || 0), exp);
                }
            });
        }
        let changed = false;
        Object.keys(merged).forEach(pk => {
            if (now > Number(merged[pk] || 0)) {
                delete merged[pk];
                changed = true;
            }
        });
        this.unmatchedPairs = merged;
        if (changed) {
            try { localStorage.setItem(UNMATCHED_PAIRS_SYNC_KEY, JSON.stringify(merged)); } catch (e) {}
        }
        return merged;
    },

    markPairUnmatched(idA, idB, ttlMs = 600000) {
        const pk = this.makeUnmatchedPairKey(idA, idB);
        if (!pk) return Promise.resolve();
        const graceUntil = Date.now() + ttlMs;
        const map = this.loadSharedUnmatchedPairs();
        map[pk] = graceUntil;
        this.unmatchedPairs = map;
        try { localStorage.setItem(UNMATCHED_PAIRS_SYNC_KEY, JSON.stringify(map)); } catch (e) {}
        if (this.initialized) {
            return this.putNode(`${UNMATCHED_PAIRS_CLOUD_NODE}/${pk}`, { unmatchedAt: Date.now(), graceUntil });
        }
        return Promise.resolve();
    },

    async unmatchUsersInCloud(idA, idB, userA, userB) {
        const pidA = String(idA || '').trim();
        const pidB = String(idB || '').trim();
        if (!pidA || !pidB) return;

        // 1. 先將解除配對墓碑寫入本地與 Firebase，確保任何先抵達後台的 SSE 事件都不會誤判為單邊遺漏而復活配對
        await this.markPairUnmatched(pidA, pidB, 600000);

        // 2. 同步強制寫入雙方最新配對紀錄（isMatchMutation: true）
        const tasks = [];
        if (userA && userA.id) {
            tasks.push(this.upsertUser(userA, true, { isMatchMutation: true }));
        }
        if (userB && userB.id) {
            tasks.push(this.upsertUser(userB, true, { isMatchMutation: true }));
        }
        if (tasks.length > 0) {
            await Promise.all(tasks);
        }

        // 3. 清除雙方聊天紀錄節點
        if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
            ChatStore.clearChat(pidA, pidB);
        }
    },

    clearPairUnmatched(idA, idB) {
        const pk = this.makeUnmatchedPairKey(idA, idB);
        if (!pk) return;
        const map = this.loadSharedUnmatchedPairs();
        if (Object.prototype.hasOwnProperty.call(map, pk)) {
            delete map[pk];
            this.unmatchedPairs = map;
            try { localStorage.setItem(UNMATCHED_PAIRS_SYNC_KEY, JSON.stringify(map)); } catch (e) {}
        }
        if (this.tree && this.tree[UNMATCHED_PAIRS_CLOUD_NODE] && Object.prototype.hasOwnProperty.call(this.tree[UNMATCHED_PAIRS_CLOUD_NODE], pk)) {
            delete this.tree[UNMATCHED_PAIRS_CLOUD_NODE][pk];
        }
        if (this.initialized) {
            this.deleteNode(`${UNMATCHED_PAIRS_CLOUD_NODE}/${pk}`);
        }
    },

    isPairRecentlyUnmatched(idA, idB) {
        const pk = this.makeUnmatchedPairKey(idA, idB);
        if (!pk) return false;
        const map = this.loadSharedUnmatchedPairs();
        return Boolean(map[pk] && Date.now() <= Number(map[pk] || 0));
    },

    recordMatchLog(userA, userB, sessionLabel = '', matchTs = Date.now(), sourceLabel = '') {
        if (!userA || !userB || !userA.id || !userB.id) return null;
        const tsNum = Number(matchTs) || Date.now();
        const d = new Date(tsNum);
        const matchedAtStr = Number.isNaN(d.getTime())
            ? new Date().toLocaleString('zh-TW', { hour12: false })
            : d.toLocaleString('zh-TW', { hour12: false });

        const entry = {
            id: 'ML_' + tsNum + '_' + Math.random().toString(36).slice(2, 6),
            idA: String(userA.id).trim(),
            nameA: String(userA.nickname || `玩家_${userA.id}`).trim(),
            genderA: String(userA.gender || '').trim(),
            idB: String(userB.id).trim(),
            nameB: String(userB.nickname || `玩家_${userB.id}`).trim(),
            genderB: String(userB.gender || '').trim(),
            session: String(sessionLabel || '').trim(),
            source: String(sourceLabel || '').trim(),
            ts: tsNum,
            matchedAtStr
        };

        let logs = [];
        try {
            const raw = JSON.parse(localStorage.getItem(MATCH_LOGS_KEY) || '[]');
            if (Array.isArray(raw)) logs = raw;
        } catch (e) {}

        logs.unshift(entry);
        logs.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        const removedLogs = logs.length > MATCH_LOGS_MAX_COUNT ? logs.slice(MATCH_LOGS_MAX_COUNT) : [];
        const keptLogs = logs.slice(0, MATCH_LOGS_MAX_COUNT);

        try {
            localStorage.setItem(MATCH_LOGS_KEY, JSON.stringify(keptLogs));
        } catch (e) {}

        if (this.tree && typeof this.tree === 'object') {
            if (!this.tree[MATCH_LOGS_KEY] || typeof this.tree[MATCH_LOGS_KEY] !== 'object') {
                this.tree[MATCH_LOGS_KEY] = {};
            }
            this.tree[MATCH_LOGS_KEY][entry.id] = { ...entry };
            removedLogs.forEach(oldItem => {
                if (oldItem && oldItem.id && Object.prototype.hasOwnProperty.call(this.tree[MATCH_LOGS_KEY], oldItem.id)) {
                    delete this.tree[MATCH_LOGS_KEY][oldItem.id];
                }
            });
        }

        if (this.initialized) {
            this.putNode(`${MATCH_LOGS_KEY}/${entry.id}`, entry);
            removedLogs.forEach(oldItem => {
                if (oldItem && oldItem.id) {
                    this.deleteNode(`${MATCH_LOGS_KEY}/${oldItem.id}`);
                }
            });
        }
        return entry;
    },

    mapToArray(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter(item => item && typeof item === 'object');
        if (typeof raw === 'object') return Object.values(raw).filter(item => item && typeof item === 'object');
        return [];
    },

    normalizeStringArray(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map(v => String(v ?? '').trim()).filter(Boolean);
        if (typeof raw === 'object') return Object.values(raw).map(v => String(v ?? '').trim()).filter(Boolean);
        return [];
    },

    normalizeMatchedHistoryList(rawHistory) {
        const items = this.mapToArray(rawHistory);
        const byPartner = new Map();
        items.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const pid = String(item.partnerId || '').trim();
            if (!pid) return;
            const votes = Array.from(new Set(this.normalizeStringArray(item.continueVotes)));
            const normalizedItem = {
                ...item,
                partnerId: pid,
                partnerName: String(item.partnerName || '').trim(),
                session: String(item.session || '').trim(),
                matchedAt: Number(item.matchedAt || 0) || Date.now(),
                igUnlocked: Boolean(item.igUnlocked),
                continueVotes: votes
            };
            const prev = byPartner.get(pid);
            if (!prev) {
                byPartner.set(pid, normalizedItem);
            } else {
                const mergedVotes = Array.from(new Set([...(prev.continueVotes || []), ...votes]));
                byPartner.set(pid, {
                    ...prev,
                    ...normalizedItem,
                    partnerName: normalizedItem.partnerName || prev.partnerName,
                    session: normalizedItem.session || prev.session,
                    matchedAt: Math.max(Number(prev.matchedAt || 0), Number(normalizedItem.matchedAt || 0)),
                    igUnlocked: Boolean(prev.igUnlocked || normalizedItem.igUnlocked),
                    continueVotes: mergedVotes
                });
            }
        });
        return Array.from(byPartner.values());
    },

    reconcileSymmetricMatches(usersArr, autoPersistRepaired = false, options = {}) {
        if (!Array.isArray(usersArr) || usersArr.length === 0) return false;
        const includeChatsRepair = Boolean(options && options.includeChatsRepair);
        
        let chatsMap = {};
        if (includeChatsRepair) {
            try {
                chatsMap = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
            } catch (_) {}
        }

        const userMap = new Map();
        usersArr.forEach(u => {
            if (u && u.id) {
                const pid = String(u.id).trim();
                if (pid && !this.isUserDeleted(pid)) {
                    userMap.set(pid, u);
                }
            }
        });

        const repairedUsers = new Map();

        // 1. 僅在管理員手動執行「以聊天室為基準修復」時，才掃描現存聊天室補齊遺失的配對（排除剛手動解除配對的組合）
        if (includeChatsRepair) {
            Object.entries(chatsMap).forEach(([pairKey, roomData]) => {
                const parts = String(pairKey || '').split('__');
                if (parts.length !== 2) return;

                const [idA, idB] = parts.map(s => s.trim());
                if (!idA || !idB || idA === idB) return;
                if (this.isPairRecentlyUnmatched(idA, idB)) return;

                const userA = userMap.get(idA);
                const userB = userMap.get(idB);
                if (!userA || !userB) return;

            const messages = Array.isArray(roomData)
                ? roomData
                : (Array.isArray(roomData?.messages) ? roomData.messages : []);
            if (messages.length === 0) return;

            const firstMsg = messages[0] || {};
            const fallbackTs = Number(firstMsg.timestamp || firstMsg.ts || roomData?.updatedAt) || Date.now();

            userA.matchedHistory = Array.isArray(userA.matchedHistory) ? userA.matchedHistory : [];
            userB.matchedHistory = Array.isArray(userB.matchedHistory) ? userB.matchedHistory : [];

            const recInA = userA.matchedHistory.find(h => String(h.partnerId) === idB);
            const recInB = userB.matchedHistory.find(h => String(h.partnerId) === idA);

            let changedA = false;
            let changedB = false;

            if (!recInA) {
                userA.matchedHistory.push({
                    partnerId: idB,
                    partnerName: userB.nickname || idB,
                    session: recInB?.session || userA.matchedSession || userB.matchedSession || '系統補回配對',
                    matchedAt: Number(recInB?.matchedAt) || fallbackTs,
                    igUnlocked: Boolean(recInB?.igUnlocked),
                    continueVotes: []
                });
                if (!userA.matchedWithId) {
                    userA.matchedWithId = idB;
                    userA.matchedWithName = userB.nickname || idB;
                    userA.matchedAt = Number(recInB?.matchedAt) || fallbackTs;
                }
                changedA = true;
            }

            if (!recInB) {
                userB.matchedHistory.push({
                    partnerId: idA,
                    partnerName: userA.nickname || idA,
                    session: recInA?.session || userB.matchedSession || userA.matchedSession || '系統補回配對',
                    matchedAt: Number(recInA?.matchedAt) || fallbackTs,
                    igUnlocked: Boolean(recInA?.igUnlocked),
                    continueVotes: []
                });
                if (!userB.matchedWithId) {
                    userB.matchedWithId = idA;
                    userB.matchedWithName = userA.nickname || idA;
                    userB.matchedAt = Number(recInA?.matchedAt) || fallbackTs;
                }
                changedB = true;
            }

                if (changedA) repairedUsers.set(idA, userA);
                if (changedB) repairedUsers.set(idB, userB);
            });
        }

        // 2. 原本的單邊配對補齊邏輯
        usersArr.forEach(u => {
            if (!u || !u.id) return;
            const uid = String(u.id).trim();
            if (!uid || this.isUserDeleted(uid)) return;

            const uHist = this.normalizeMatchedHistoryList(u.matchedHistory);
            if (u.matchedWithId && !uHist.some(h => String(h.partnerId) === String(u.matchedWithId).trim())) {
                uHist.push({
                    partnerId: String(u.matchedWithId).trim(),
                    partnerName: String(u.matchedWithName || '').trim(),
                    session: String(u.matchedSession || '').trim(),
                    matchedAt: Number(u.matchedAt || 0) || Date.now(),
                    igUnlocked: false,
                    continueVotes: []
                });
            }

            uHist.forEach(h => {
                const partnerId = String(h.partnerId || '').trim();
                if (!partnerId || partnerId === uid) return;
                if (this.isPairRecentlyUnmatched(uid, partnerId)) return;
                const partner = userMap.get(partnerId);
                if (!partner) return;

                const partnerHist = this.normalizeMatchedHistoryList(partner.matchedHistory);
                const existingMirror = partnerHist.find(ph => String(ph.partnerId) === uid);

                if (!existingMirror) {
                    const mirrorEntry = {
                        partnerId: uid,
                        partnerName: String(u.nickname || '').trim(),
                        session: String(h.session || u.matchedSession || '').trim(),
                        matchedAt: Number(h.matchedAt || u.matchedAt || 0) || Date.now(),
                        igUnlocked: Boolean(h.igUnlocked),
                        continueVotes: Array.isArray(h.continueVotes) ? [...h.continueVotes] : []
                    };
                    if (h.activityId) mirrorEntry.activityId = String(h.activityId);
                    if (h.matchDetail) mirrorEntry.matchDetail = String(h.matchDetail);

                    partnerHist.push(mirrorEntry);
                    partner.matchedHistory = this.normalizeMatchedHistoryList(partnerHist);

                    if (!partner.matchedWithId) {
                        partner.matchedWithId = uid;
                        partner.matchedWithName = String(u.nickname || '').trim() || null;
                        partner.matchedSession = mirrorEntry.session || null;
                        partner.matchedAt = mirrorEntry.matchedAt;
                    }
                    repairedUsers.set(partnerId, partner);
                } else {
                    const mergedVotes = Array.from(new Set([
                        ...(Array.isArray(existingMirror.continueVotes) ? existingMirror.continueVotes.map(String) : []),
                        ...(Array.isArray(h.continueVotes) ? h.continueVotes.map(String) : [])
                    ]));
                    const nextIg = Boolean(existingMirror.igUnlocked || h.igUnlocked);
                    const nextMatchedAt = Math.max(Number(existingMirror.matchedAt || 0), Number(h.matchedAt || 0)) || existingMirror.matchedAt;
                    if (
                        mergedVotes.length !== (existingMirror.continueVotes || []).length ||
                        Boolean(existingMirror.igUnlocked) !== nextIg ||
                        Number(existingMirror.matchedAt || 0) !== nextMatchedAt
                    ) {
                        existingMirror.continueVotes = mergedVotes;
                        existingMirror.igUnlocked = nextIg;
                        existingMirror.matchedAt = nextMatchedAt;
                        partner.matchedHistory = this.normalizeMatchedHistoryList(partnerHist);
                        if (String(partner.matchedWithId) === uid) {
                            partner.matchedAt = nextMatchedAt;
                        }
                        repairedUsers.set(partnerId, partner);
                    }
                }
            });
        });

        if (repairedUsers.size === 0) return false;

        repairedUsers.forEach((repairedUser, pid) => {
            if (this.tree && this.tree[USERS_KEY] && typeof this.tree[USERS_KEY] === 'object') {
                this.tree[USERS_KEY][pid] = { ...repairedUser };
            }
            if (autoPersistRepaired && this.initialized && this.inFlightWrites === 0) {
                this.upsertUser(repairedUser, true, { isMatchMutation: true });
            }
        });

        return true;
    },

    chatsMapToLocal(raw) {
        const result = {};
        if (!raw || typeof raw !== 'object') return result;
        Object.keys(raw).forEach(pairKey => {
            const threadRaw = raw[pairKey];
            const msgs = this.mapToArray(threadRaw);
            msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
            // 同步雲端回本地時，也強制裁切至最近 500 則
            result[pairKey] = msgs.slice(-500);
        });
        return result;
    },

    writeLocalIfChanged(key, nextStr) {
        if (localStorage.getItem(key) !== nextStr) {
            localStorage.setItem(key, nextStr);
        }
    },

    applyTreeToLocalStorage() {
        const t = this.tree || {};
        if (!t[USERS_KEY] || typeof t[USERS_KEY] !== 'object') {
            t[USERS_KEY] = {};
        }

        // 1) 過濾剛被管理員徹底刪除的玩家（跨分頁墓碑保護，避免舊快照或殘留 SSE 事件復活已刪除帳號）
        const deletedMap = this.loadSharedDeletedUsers();
        Object.keys(deletedMap).forEach(pid => {
            if (t[USERS_KEY] && Object.prototype.hasOwnProperty.call(t[USERS_KEY], pid)) {
                delete t[USERS_KEY][pid];
            }
        });

        // 2) 保留跨分頁剛寫入或尚未完成雲端同步的玩家資料，避免舊快照覆蓋造成資料一下出現一下消失
        const sharedPending = this.loadSharedPendingUsers();
        Object.keys(sharedPending).forEach(pid => {
            if (deletedMap[pid]) return;
            const entry = sharedPending[pid];
            if (entry && entry.record) {
                t[USERS_KEY][pid] = entry.record;
            }
        });

        // 1. 玩家名單（Firebase RTDB 會自動省略空陣列 [] 與空物件 {}，還原時需明確補回 [] / {} 以確保取消勾選場次能雙向連動）
        const usersArr = this.mapToArray(t[USERS_KEY]).map(u => {
            if (!u || typeof u !== 'object') return u;
            const cleanUser = { ...u };
            delete cleanUser.registeredSession;
            cleanUser.city = String(cleanUser.city || '').trim();
            cleanUser.region = String(cleanUser.region || inferRegionByCity(cleanUser.city) || '').trim();
            cleanUser.mbti = String(cleanUser.mbti || '').trim();
            cleanUser.mbtiGroup = String(cleanUser.mbtiGroup || inferMbtiGroup(cleanUser.mbti) || '').trim();
            cleanUser.registeredSessions = Array.from(new Set(
                this.normalizeStringArray(cleanUser.registeredSessions).map(s => normalizeSessionLabel(s)).filter(Boolean)
            ));
            cleanUser.matchedHistory = this.normalizeMatchedHistoryList(cleanUser.matchedHistory);
            cleanUser.exactMatchCriteria = (cleanUser.exactMatchCriteria && typeof cleanUser.exactMatchCriteria === 'object' && !Array.isArray(cleanUser.exactMatchCriteria))
                ? cleanUser.exactMatchCriteria
                : {};
            cleanUser.customActivityRegs = (cleanUser.customActivityRegs && typeof cleanUser.customActivityRegs === 'object' && !Array.isArray(cleanUser.customActivityRegs))
                ? cleanUser.customActivityRegs
                : {};
            return cleanUser;
        });
        const unmatchedPairsMap = this.loadSharedUnmatchedPairs();
        if (Object.keys(unmatchedPairsMap).length > 0) {
            usersArr.forEach(u => {
                if (!u || !u.id) return;
                const uid = String(u.id).trim();
                if (Array.isArray(u.matchedHistory)) {
                    u.matchedHistory = u.matchedHistory.filter(h => !this.isPairRecentlyUnmatched(uid, h.partnerId));
                }
                if (u.matchedWithId && this.isPairRecentlyUnmatched(uid, u.matchedWithId)) {
                    const lastH = (u.matchedHistory || [])[u.matchedHistory.length - 1];
                    u.matchedSession = lastH ? (lastH.session || null) : null;
                    u.matchedWithId = lastH ? (lastH.partnerId || null) : null;
                    u.matchedWithName = lastH ? (lastH.partnerName || null) : null;
                    u.matchedAt = lastH ? (lastH.matchedAt || null) : null;
                }
            });
            if (t[CHATS_KEY] && typeof t[CHATS_KEY] === 'object') {
                Object.keys(unmatchedPairsMap).forEach(pk => {
                    if (Object.prototype.hasOwnProperty.call(t[CHATS_KEY], pk)) {
                        delete t[CHATS_KEY][pk];
                    }
                });
            }
        }
        this.reconcileSymmetricMatches(usersArr, this.initialized);
        this.writeLocalIfChanged(USERS_KEY, JSON.stringify(usersArr));
        usersArr.forEach(u => {
            if (u && u.id) {
                this.lastPushedUsersJson[String(u.id)] = JSON.stringify(u);
            }
        });

        // 1b. 活動歷史報名紀錄同步（確保活動結束 3 分鐘自動清除會員「報名場次」後，後台統計人數仍完整保留）
        if (typeof ActivityRegArchive !== 'undefined') {
            ActivityRegArchive.mergeCloudTreeAndUsers(t[REG_HISTORY_KEY], usersArr);
        }

        // 2. 聊天紀錄
        this.writeLocalIfChanged(CHATS_KEY, JSON.stringify(this.chatsMapToLocal(t[CHATS_KEY])));

        // 3. 系統開關與期數設定
        if (t[SYSTEM_STATE_KEY] && typeof t[SYSTEM_STATE_KEY] === 'object') {
            this.writeLocalIfChanged(SYSTEM_STATE_KEY, JSON.stringify(t[SYSTEM_STATE_KEY]));
        } else if (localStorage.getItem(SYSTEM_STATE_KEY) !== null) {
            localStorage.removeItem(SYSTEM_STATE_KEY);
        }

        // 4. 管理員信箱（依時間新到舊排序）
        const mailsArr = this.mapToArray(t[MAILBOX_KEY]);
        mailsArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        this.writeLocalIfChanged(MAILBOX_KEY, JSON.stringify(mailsArr));

        // 5. 問題回報（依時間新到舊排序，最多保留最新 15 則，超過自動刪除最舊紀錄）
        const reportsArr = this.mapToArray(t[REPORTS_KEY]);
        reportsArr.sort((a, b) => {
            const diff = Number(b.ts || 0) - Number(a.ts || 0);
            if (diff !== 0) return diff;
            return String((b && b.id) || '').localeCompare(String((a && a.id) || ''));
        });
        const keptReportsArr = reportsArr.slice(0, REPORTS_MAX_COUNT);
        const overflowReportsArr = reportsArr.slice(REPORTS_MAX_COUNT);
        if (overflowReportsArr.length > 0 && t[REPORTS_KEY] && typeof t[REPORTS_KEY] === 'object') {
            overflowReportsArr.forEach(oldRep => {
                if (oldRep && oldRep.id) {
                    delete t[REPORTS_KEY][oldRep.id];
                    if (this.initialized && this.inFlightWrites === 0) {
                        this.deleteNode(`${REPORTS_KEY}/${oldRep.id}`);
                    }
                }
            });
        }
        this.writeLocalIfChanged(REPORTS_KEY, JSON.stringify(keptReportsArr));

        // 6. 禁止字眼規則
        if (t[BANNED_RULES_KEY] !== undefined) {
            this.writeLocalIfChanged(BANNED_RULES_KEY, JSON.stringify(this.mapToArray(t[BANNED_RULES_KEY])));
        }

        // 7. 後台秘密強制配對與自動執行紀錄
        if (t[FORCE_KEY] !== undefined) {
            this.writeLocalIfChanged(FORCE_KEY, JSON.stringify(this.mapToArray(t[FORCE_KEY])));
        }
        if (t[AUTO_RUN_LOG_KEY] && typeof t[AUTO_RUN_LOG_KEY] === 'object') {
            this.writeLocalIfChanged(AUTO_RUN_LOG_KEY, JSON.stringify(t[AUTO_RUN_LOG_KEY]));
        }
        if (t[MATCH_LOGS_KEY] !== undefined) {
            const matchLogsArr = this.mapToArray(t[MATCH_LOGS_KEY]);
            matchLogsArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
            this.writeLocalIfChanged(MATCH_LOGS_KEY, JSON.stringify(matchLogsArr.slice(0, MATCH_LOGS_MAX_COUNT)));
        }

        // 8. ID 計數器
        if (t[ID_COUNTER_KEY] && typeof t[ID_COUNTER_KEY] === 'object') {
            this.writeLocalIfChanged(ID_COUNTER_KEY, JSON.stringify(t[ID_COUNTER_KEY]));
        }

        // 9. 後台自定義專屬活動（第 2 種活動）
        if (t[CUSTOM_ACTIVITIES_KEY] !== undefined) {
            const actsArr = this.mapToArray(t[CUSTOM_ACTIVITIES_KEY]).map(act => {
                if (!act || typeof act !== 'object') return act;
                const cleanAct = { ...act };
                const mapObj = (cleanAct.matchedUserMap && typeof cleanAct.matchedUserMap === 'object' && !Array.isArray(cleanAct.matchedUserMap))
                    ? { ...cleanAct.matchedUserMap }
                    : {};
                this.normalizeStringArray(cleanAct.matchedUserIds).forEach(uid => {
                    if (uid && !mapObj[uid]) mapObj[uid] = Number(cleanAct.lastMatchedTs || 0) || Date.now();
                });
                cleanAct.matchedUserMap = mapObj;
                cleanAct.matchedUserIds = Object.keys(mapObj);
                return cleanAct;
            });
            actsArr.sort((a, b) => Number(a.createdAtTs || 0) - Number(b.createdAtTs || 0));
            this.writeLocalIfChanged(CUSTOM_ACTIVITIES_KEY, JSON.stringify(actsArr));
        } else {
            this.writeLocalIfChanged(CUSTOM_ACTIVITIES_KEY, '[]');
        }

        // 10. 互動流程測試指令（支援跨瀏覽器即時連動新增／刪除測試好友）
        if (t['yuelao_test_event'] && typeof t['yuelao_test_event'] === 'object') {
            this.writeLocalIfChanged('yuelao_test_event', JSON.stringify(t['yuelao_test_event']));
        }

        // 11. 後台登入失敗日誌同步（僅保留最近 10 筆）
        if (t['yuelao_admin_login_logs'] !== undefined) {
            const logsArr = this.mapToArray(t['yuelao_admin_login_logs']);
            logsArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
            this.writeLocalIfChanged('yuelao_admin_login_logs', JSON.stringify(logsArr.slice(0, 10)));
        }

        // 12. 第 2 種活動雲端單次執行鎖定同步（防止其他分頁或裝置重複觸發第二次配對）
        if (t['yuelao_custom_act_locks'] && typeof t['yuelao_custom_act_locks'] === 'object') {
            Object.keys(t['yuelao_custom_act_locks']).forEach(lockNodeKey => {
                const lockObj = t['yuelao_custom_act_locks'][lockNodeKey];
                if (lockObj && lockObj.claimedBy) {
                    try {
                        localStorage.setItem(`yuelao_custom_act_lock_${lockNodeKey}`, String(lockObj.claimedAt || Date.now()));
                    } catch (e) {}
                }
            });
        }

        // 13. 即時緣分動態牆同步（依時間新到舊排序，供前台訪問時即時顯示）
        if (t[FATE_WALL_KEY] !== undefined) {
            const fateWallArr = this.mapToArray(t[FATE_WALL_KEY]).filter(item => item && typeof item === 'object' && item.content);
            fateWallArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
            this.writeLocalIfChanged(FATE_WALL_KEY, JSON.stringify(fateWallArr));
        } else {
            this.writeLocalIfChanged(FATE_WALL_KEY, '[]');
        }

        // 14. 紅線祈願牆（女性發起 2 選 1 題目、男女回覆匿名編號、到期後女方選擇配對）
        if (t[WISH_WALL_KEY] !== undefined) {
            const rawWishes = this.mapToArray(t[WISH_WALL_KEY]);
            const normWishes = rawWishes
                .map(w => (typeof normalizeWishWallItem === 'function' ? normalizeWishWallItem(w) : w))
                .filter(Boolean);
            normWishes.sort((a, b) => Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0));
            this.writeLocalIfChanged(WISH_WALL_KEY, JSON.stringify(normWishes));
        } else {
            this.writeLocalIfChanged(WISH_WALL_KEY, '[]');
        }
    },

    applyStreamPatch(path, data) {
        const cleanPath = String(path || '/').replace(/^\/+|\/+$/g, '');
        if (!cleanPath) {
            this.tree = (data && typeof data === 'object') ? data : {};
            return;
        }
        const parts = cleanPath.split('/');
        let curr = this.tree;
        for (let i = 0; i < parts.length - 1; i++) {
            const seg = parts[i];
            if (!curr[seg] || typeof curr[seg] !== 'object') {
                curr[seg] = {};
            }
            curr = curr[seg];
        }
        const lastKey = parts[parts.length - 1];
        if (data === null) {
            delete curr[lastKey];
        } else {
            curr[lastKey] = data;
        }
    },

    refreshCloudBadge() {
        const badge = document.getElementById('cloudStatusBadge');
        if (!badge) return;
        if (this.inFlightWrites > 0) {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-800 font-semibold animate-pulse';
            badge.textContent = `⏳ 正在同步至雲端（${this.inFlightWrites} 筆寫入中）...`;
            return;
        }
        if (this.isOnline) {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 font-semibold';
            badge.textContent = '☁️ Firebase 雲端已即時同步';
        } else {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-700 font-semibold';
            badge.textContent = '⚠️ 雲端重連中（暫用本地快取）';
        }
    },

    updateCloudBadge(isOnline) {
        this.isOnline = Boolean(isOnline);
        this.refreshCloudBadge();
    },

    async fetchFullTree() {
        if (this.inFlightWrites > 0) return false;
        const epochBefore = this.writeEpoch;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        try {
            const res = await fetch(`${this.dbUrl}/.json`, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) return false;
            const data = await res.json();
            if (this.inFlightWrites > 0 || this.writeEpoch !== epochBefore) {
                return false;
            }
            this.tree = (data && typeof data === 'object') ? data : {};
            this.applyTreeToLocalStorage();
            this.updateCloudBadge(true);
            return true;
        } catch (e) {
            clearTimeout(timer);
            this.updateCloudBadge(false);
            return false;
        }
    },

    startRealtimeStream() {
        if (typeof EventSource === 'undefined') return;
        if (this.eventSource) {
            try { this.eventSource.close(); } catch (e) {}
        }
        try {
            const es = new EventSource(`${this.dbUrl}/.json`);
            const handleEvent = (e) => {
                if (this.inFlightWrites > 0) return;
                try {
                    const payload = JSON.parse(e.data);
                    if (!payload) return;
                    if (e.type === 'patch' && payload.data && typeof payload.data === 'object') {
                        const base = String(payload.path || '/').replace(/^\/+|\/+$/g, '');
                        Object.keys(payload.data).forEach(k => {
                            const subPath = base ? `${base}/${k}` : k;
                            this.applyStreamPatch(subPath, payload.data[k]);
                        });
                    } else {
                        this.applyStreamPatch(payload.path, payload.data);
                    }
                    this.applyTreeToLocalStorage();
                    if (typeof this.onUpdateCallback === 'function') {
                        this.onUpdateCallback();
                    }
                } catch (err) {}
            };
            es.onopen = () => {
                this.updateCloudBadge(true);
            };
            es.onerror = () => {
                this.updateCloudBadge(false);
            };
            es.addEventListener('put', handleEvent);
            es.addEventListener('patch', handleEvent);
            this.eventSource = es;
        } catch (e) {}
    },

    async init(onUpdate) {
        this.onUpdateCallback = onUpdate || null;
        await this.fetchFullTree();
        this.initialized = true;
        this.startRealtimeStream();

        // 已關閉多餘的 3.5 秒全庫輪詢，完全改由 EventSource 即時推播與分頁聚焦同步
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        if (!this.beforeUnloadBound && typeof window !== 'undefined') {
            this.beforeUnloadBound = true;
            window.addEventListener('beforeunload', (e) => {
                if (this.inFlightWrites > 0) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        }

        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden && this.inFlightWrites === 0) {
                const ok = await this.fetchFullTree();
                if (ok && typeof this.onUpdateCallback === 'function') {
                    this.onUpdateCallback();
                }
            }
        });
    },

    encodePath(path) {
        return String(path || '').split('/').filter(Boolean).map(seg => encodeURIComponent(seg)).join('/');
    },

    async putNode(path, value) {
        this.applyStreamPatch(path, value);
        this.inFlightWrites++;
        this.writeEpoch++;
        this.refreshCloudBadge();
        try {
            const encoded = this.encodePath(path);
            await fetch(`${this.dbUrl}/${encoded}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value)
            });
        } catch (e) {
            console.warn('CloudSync putNode 同步失敗', path, e);
        } finally {
            this.inFlightWrites = Math.max(0, this.inFlightWrites - 1);
            this.writeEpoch++;
            this.refreshCloudBadge();
        }
    },

    async patchNode(path, patchObj) {
        if (!patchObj || typeof patchObj !== 'object') return;
        const cleanBase = String(path || '').replace(/^\/+|\/+$/g, '');
        Object.entries(patchObj).forEach(([k, v]) => {
            const subPath = cleanBase ? `${cleanBase}/${k}` : k;
            this.applyStreamPatch(subPath, v);
        });
        this.inFlightWrites++;
        this.writeEpoch++;
        this.refreshCloudBadge();
        try {
            const encoded = this.encodePath(path);
            await fetch(`${this.dbUrl}/${encoded}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patchObj)
            });
        } catch (e) {
            console.warn('CloudSync patchNode 同步失敗', path, e);
        } finally {
            this.inFlightWrites = Math.max(0, this.inFlightWrites - 1);
            this.writeEpoch++;
            this.refreshCloudBadge();
        }
    },

    async patchUserFields(playerId, patchFields, updatedUserRecord = null) {
        const pid = String(playerId || '').trim();
        if (!pid || !patchFields || typeof patchFields !== 'object') return;
        if (this.isUserDeleted(pid)) return;

        const firebasePatch = {};
        const localPatch = {};
        Object.entries(patchFields).forEach(([k, v]) => {
            if (v === undefined) return;
            localPatch[k] = v;
            if (Array.isArray(v) && v.length === 0) {
                firebasePatch[k] = null;
            } else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
                firebasePatch[k] = null;
            } else {
                firebasePatch[k] = v;
            }
        });

        if (Object.keys(firebasePatch).length === 0) return;

        const existingTreeUser = (this.tree && this.tree[USERS_KEY] && this.tree[USERS_KEY][pid] && typeof this.tree[USERS_KEY][pid] === 'object')
            ? this.tree[USERS_KEY][pid]
            : {};
        const mergedRecord = {
            ...(updatedUserRecord && typeof updatedUserRecord === 'object' ? updatedUserRecord : {}),
            ...existingTreeUser,
            ...localPatch,
            id: pid
        };
        delete mergedRecord.registeredSession;
        this.lastPushedUsersJson[pid] = JSON.stringify(mergedRecord);
        this.setSharedPendingUser(pid, mergedRecord, 18000);

        await this.patchNode(`${USERS_KEY}/${pid}`, firebasePatch);
    },

    async deleteNode(path) {
        this.applyStreamPatch(path, null);
        const pathParts = String(path || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        if (pathParts.length === 2 && pathParts[0] === USERS_KEY) {
            const pid = pathParts[1];
            if (pid) this.markSharedDeletedUser(pid, 20000);
        }
        this.inFlightWrites++;
        this.writeEpoch++;
        this.refreshCloudBadge();
        try {
            const encoded = this.encodePath(path);
            await fetch(`${this.dbUrl}/${encoded}.json`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.warn('CloudSync deleteNode 同步失敗', path, e);
        } finally {
            this.inFlightWrites = Math.max(0, this.inFlightWrites - 1);
            this.writeEpoch++;
            this.refreshCloudBadge();
        }
    },

    async deleteUser(playerId) {
        const pid = String(playerId || '').trim();
        if (!pid) return;
        this.markSharedDeletedUser(pid, 20000);
        try {
            localStorage.removeItem(PLAYER_STATE_PREFIX + pid);
        } catch (e) {}
        await this.deleteNode(`${USERS_KEY}/${pid}`);
    },

    async upsertUser(record, forcePush = false, options = {}) {
        if (!record || !record.id) return;
        const pid = String(record.id);
        if (!forcePush && this.isUserDeleted(pid)) return;
        const isMatchMutation = Boolean(options && options.isMatchMutation);
        const existingTreeUser = (this.tree && this.tree[USERS_KEY] && this.tree[USERS_KEY][pid] && typeof this.tree[USERS_KEY][pid] === 'object')
            ? this.tree[USERS_KEY][pid]
            : null;
        const cleanRecord = { ...record };
        delete cleanRecord.registeredSession;
        cleanRecord.city = String(cleanRecord.city || '').trim();
        cleanRecord.region = String(cleanRecord.region || inferRegionByCity(cleanRecord.city) || '').trim();
        cleanRecord.mbti = String(cleanRecord.mbti || '').trim();
        cleanRecord.mbtiGroup = String(cleanRecord.mbtiGroup || inferMbtiGroup(cleanRecord.mbti) || '').trim();
        cleanRecord.registeredSessions = Array.from(new Set(
            this.normalizeStringArray(cleanRecord.registeredSessions).map(s => normalizeSessionLabel(s)).filter(Boolean)
        ));
        cleanRecord.matchedHistory = this.normalizeMatchedHistoryList(cleanRecord.matchedHistory)
            .filter(h => !this.isPairRecentlyUnmatched(pid, h.partnerId));
        if (!isMatchMutation && existingTreeUser) {
            // 非配對／解除配對異動時，合併雲端與本地配對歷史（排除近期已解除配對的對象），絕不以舊快照覆蓋新配對好友
            const cloudHist = this.normalizeMatchedHistoryList(existingTreeUser.matchedHistory)
                .filter(h => !this.isPairRecentlyUnmatched(pid, h.partnerId));
            cleanRecord.matchedHistory = this.normalizeMatchedHistoryList([...cloudHist, ...cleanRecord.matchedHistory])
                .filter(h => !this.isPairRecentlyUnmatched(pid, h.partnerId));
            const rawPrimaryId = String(existingTreeUser.matchedWithId || cleanRecord.matchedWithId || '').trim();
            if (rawPrimaryId && !this.isPairRecentlyUnmatched(pid, rawPrimaryId)) {
                cleanRecord.matchedSession = existingTreeUser.matchedSession || cleanRecord.matchedSession || null;
                cleanRecord.matchedWithId = rawPrimaryId;
                cleanRecord.matchedWithName = existingTreeUser.matchedWithName || cleanRecord.matchedWithName || null;
                cleanRecord.matchedAt = existingTreeUser.matchedAt || cleanRecord.matchedAt || null;
            } else {
                const fallbackPrimary = cleanRecord.matchedHistory[cleanRecord.matchedHistory.length - 1] || null;
                cleanRecord.matchedSession = fallbackPrimary ? (fallbackPrimary.session || null) : null;
                cleanRecord.matchedWithId = fallbackPrimary ? (fallbackPrimary.partnerId || null) : null;
                cleanRecord.matchedWithName = fallbackPrimary ? (fallbackPrimary.partnerName || null) : null;
                cleanRecord.matchedAt = fallbackPrimary ? (fallbackPrimary.matchedAt || null) : null;
            }
        }
        cleanRecord.exactMatchCriteria = (cleanRecord.exactMatchCriteria && typeof cleanRecord.exactMatchCriteria === 'object' && !Array.isArray(cleanRecord.exactMatchCriteria))
            ? cleanRecord.exactMatchCriteria
            : {};
        cleanRecord.customActivityRegs = (cleanRecord.customActivityRegs && typeof cleanRecord.customActivityRegs === 'object' && !Array.isArray(cleanRecord.customActivityRegs))
            ? cleanRecord.customActivityRegs
            : {};
        const serialized = JSON.stringify(cleanRecord);
        if (!forcePush && this.lastPushedUsersJson[pid] === serialized) return;
        this.lastPushedUsersJson[pid] = serialized;
        this.setSharedPendingUser(pid, cleanRecord, 25000);

        await this.putNode(`${USERS_KEY}/${pid}`, cleanRecord);
        const cleanupTasks = [];
        if (isMatchMutation) {
            if (!Array.isArray(cleanRecord.matchedHistory) || cleanRecord.matchedHistory.length === 0) {
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedHistory`));
            }
            if (!cleanRecord.matchedWithId) {
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedWithId`));
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedWithName`));
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedSession`));
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedAt`));
            }
        }
        if (cleanRecord.registeredSessions.length === 0) {
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/registeredSessions`));
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/registeredSession`));
        }
        if (Object.keys(cleanRecord.exactMatchCriteria).length === 0) {
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/exactMatchCriteria`));
        }
        const prevTreeUser = (this.tree && this.tree[USERS_KEY] && this.tree[USERS_KEY][pid]) ? this.tree[USERS_KEY][pid] : null;
        const prevCustomKeys = (prevTreeUser && prevTreeUser.customActivityRegs && typeof prevTreeUser.customActivityRegs === 'object')
            ? Object.keys(prevTreeUser.customActivityRegs)
            : [];
        if (Object.keys(cleanRecord.customActivityRegs).length === 0) {
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/customActivityRegs`));
        } else {
            prevCustomKeys.forEach(oldActKey => {
                if (!Object.prototype.hasOwnProperty.call(cleanRecord.customActivityRegs, oldActKey)) {
                    cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/customActivityRegs/${oldActKey}`));
                }
            });
        }
        if (cleanupTasks.length > 0) {
            await Promise.all(cleanupTasks);
        }
        if (!this.isUserDeleted(pid)) {
            this.setSharedPendingUser(pid, cleanRecord, 15000);
        }
        if (typeof ActivityRegArchive !== 'undefined') {
            ActivityRegArchive.syncFromUserRecord(cleanRecord, true);
        }
    },

    syncUsersArray(usersArr, options = { isMatchMutation: false }) {
        const list = Array.isArray(usersArr) ? usersArr : [];
        const forcePush = Boolean(options && options.isMatchMutation);
        // 僅同步更新名單內的玩家，絕不因舊快照暫時缺少某 ID 而誤發 DELETE 刪除雲端玩家（刪除僅由管理員明確刪除操作觸發）
        list.forEach(u => {
            if (u && u.id && !this.isUserDeleted(u.id)) {
                this.upsertUser(u, forcePush, options);
            }
        });
    },

    async clearAll() {
        this.tree = {};
        this.lastPushedUsersJson = {};
        this.pendingUsers = {};
        this.deletedUsers = {};
        this.unmatchedPairs = {};
        try {
            localStorage.removeItem(PENDING_USERS_SYNC_KEY);
            localStorage.removeItem(DELETED_USERS_SYNC_KEY);
            localStorage.removeItem(UNMATCHED_PAIRS_SYNC_KEY);
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('yuelao_custom_act_lock_')) {
                    localStorage.removeItem(k);
                }
            });
        } catch (e) {}
        try {
            await fetch(`${this.dbUrl}/.json`, { method: 'DELETE' });
        } catch (e) {}
    }
};

// 4. 唯一玩家 ID 分配器（男 10001 起 / 女 20001 起）
const IdAllocator = {
    allocate(gender) {
        const counters = JSON.parse(localStorage.getItem(ID_COUNTER_KEY) || '{"male":10001,"female":20001,"other":30001}');
        const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
        const usedIds = new Set(users.map(u => String(u.id)));

        if (gender === '男') {
            let candidate = Math.max(10001, Number(counters.male || 10001));
            while (usedIds.has(String(candidate))) candidate++;
            counters.male = candidate + 1;
            localStorage.setItem(ID_COUNTER_KEY, JSON.stringify(counters));
            if (typeof CloudSync !== 'undefined') CloudSync.putNode(ID_COUNTER_KEY, counters);
            return String(candidate);
        } else if (gender === '女') {
            let candidate = Math.max(20001, Number(counters.female || 20001));
            while (usedIds.has(String(candidate))) candidate++;
            counters.female = candidate + 1;
            localStorage.setItem(ID_COUNTER_KEY, JSON.stringify(counters));
            if (typeof CloudSync !== 'undefined') CloudSync.putNode(ID_COUNTER_KEY, counters);
            return String(candidate);
        } else {
            let candidate = Math.max(30001, Number(counters.other || 30001));
            while (usedIds.has(String(candidate))) candidate++;
            counters.other = candidate + 1;
            localStorage.setItem(ID_COUNTER_KEY, JSON.stringify(counters));
            if (typeof CloudSync !== 'undefined') CloudSync.putNode(ID_COUNTER_KEY, counters);
            return String(candidate);
        }
    }
};

// 5. 跨版本永久儲存管理器、禁止字眼、信件與系統開關控制
const Store = {
    getSystemConfig() {
        const autoBatch = calcAutoBatchNumber(new Date());
        try {
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
                genderLimitMax: sys.genderLimitMax !== undefined ? Math.max(1, Number(sys.genderLimitMax)) : 30,
                wishEarlyCloseCanMatch: sys.wishEarlyCloseCanMatch !== undefined ? Boolean(sys.wishEarlyCloseCanMatch) : true
            };
        } catch (e) {
            return {
                currentBatch: autoBatch,
                autoBatch: autoBatch,
                batchOffset: 0,
                registrationOpen: true,
                profileLocked: false,
                genderLimitEnabled: false,
                genderLimitMax: 30,
                wishEarlyCloseCanMatch: true
            };
        }
    },

    setSystemConfig(patch) {
        const current = this.getSystemConfig();
        const updated = { ...current, ...patch };
        localStorage.setItem(SYSTEM_STATE_KEY, JSON.stringify(updated));
        if (typeof CloudSync !== 'undefined') CloudSync.putNode(SYSTEM_STATE_KEY, updated);
        return updated;
    },

    getGenderCounts() {
        try {
            const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
            let male = 0;
            let female = 0;
            users.forEach(u => {
                if (!u || !u.id) return;
                if (u.gender === '男') male++;
                else if (u.gender === '女') female++;
            });
            return { male, female };
        } catch (e) {
            return { male: 0, female: 0 };
        }
    },

    getGenderQuotaStatus() {
        const cfg = this.getSystemConfig();
        const counts = this.getGenderCounts();
        const limit = Math.max(1, Number(cfg.genderLimitMax || 30));
        const enabled = Boolean(cfg.genderLimitEnabled);
        const maleFull = enabled && counts.male >= limit;
        const femaleFull = false; // 女生不限制人數上限
        const bothFull = false;   // 女生不限制上限，不會出現男女皆滿鎖定
        return {
            enabled,
            limit,
            maleCount: counts.male,
            femaleCount: counts.female,
            maleFull,
            femaleFull,
            bothFull
        };
    },

    getBannedRules() {
        const raw = localStorage.getItem(BANNED_RULES_KEY);
        if (!raw) {
            const initial = [{ id: 'BR_DEFAULT_1', field: 'ig', keyword: 'gak' }];
            localStorage.setItem(BANNED_RULES_KEY, JSON.stringify(initial));
            return initial;
        }
        try {
            return JSON.parse(raw);
        } catch (e) {
            return [];
        }
    },

    checkProfileBanned(profile) {
        const rules = this.getBannedRules();
        for (const rule of rules) {
            const kw = String(rule.keyword || '').trim().toLowerCase();
            if (!kw) continue;

            if (rule.field === 'all') {
                for (const val of Object.values(profile)) {
                    const str = Array.isArray(val) ? val.join(' ') : String(val || '');
                    if (str.toLowerCase().includes(kw)) {
                        return rule;
                    }
                }
            } else {
                const rawVal = profile[rule.field];
                const str = Array.isArray(rawVal) ? rawVal.join(' ') : String(rawVal || '');
                const normalized = rule.field === 'ig' ? str.replace(/^@+/, '').toLowerCase() : str.toLowerCase();
                if (normalized.includes(kw)) {
                    return rule;
                }
            }
        }
        return null;
    },

    getActiveBatchNumber() {
        return this.getSystemConfig().currentBatch;
    },

    setActiveBatchNumber(num) {
        const autoBatch = calcAutoBatchNumber(new Date());
        this.setSystemConfig({ batchOffset: Number(num) - autoBatch });
    },

    getMailbox() {
        try {
            return JSON.parse(localStorage.getItem(MAILBOX_KEY) || '[]');
        } catch (e) {
            return [];
        }
    },

    getFateWallPosts() {
        try {
            const arr = JSON.parse(localStorage.getItem(FATE_WALL_KEY) || '[]');
            if (!Array.isArray(arr)) return [];
            return arr
                .filter(item => item && typeof item === 'object' && String(item.content || '').trim() !== '')
                .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        } catch (e) {
            return [];
        }
    },

    getWishWallPosts() {
        try {
            const arr = JSON.parse(localStorage.getItem(WISH_WALL_KEY) || '[]');
            if (!Array.isArray(arr)) return [];
            return arr
                .map(w => (typeof normalizeWishWallItem === 'function' ? normalizeWishWallItem(w) : w))
                .filter(Boolean)
                .sort((a, b) => Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0));
        } catch (e) {
            return [];
        }
    },

    getCustomActivities() {
        try {
            const arr = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
            return Array.isArray(arr) ? arr.filter(a => a && typeof a === 'object' && a.id) : [];
        } catch (e) {
            return [];
        }
    },

    getOpenCustomActivities() {
        return this.getCustomActivities().filter(a => Boolean(a.isOpen));
    },

    getDefaultState() {
        const privacy = {};
        FIELD_SECTIONS.forEach(sec => {
            sec.fields.forEach(f => {
                if (f.alwaysOpen) {
                    privacy[f.key] = 'open';
                } else if (f.defaultPrivacy) {
                    privacy[f.key] = f.defaultPrivacy;
                } else {
                    privacy[f.key] = sec.defaultPrivacy || 'closed';
                }
            });
        });
        return {
            version: SCHEMA_VERSION,
            playerId: null,
            backupCode: '',
            lastSyncedCloudUpdatedAt: '',
            isWarnedAccount: false,
            warningReason: '',
            isChatBanned: false,
            readMailIds: [],
            profile: {
                zodiac: '',
                statusOther: '',
                region: '',
                city: '',
                mbtiGroup: '',
                mbti: '',
                hobbies: [],
                hobbiesOther: ''
            },
            privacy: privacy,
            registeredSessions: [],
            exactMatchCriteria: {},
            customActivityRegs: {},
            matchedSession: null,
            friends: [],
            activeFriendId: null,
            multiFriendSince: null,
            confessionUnlockAt: null,
            lastConfessionDate: null,
            lastHandledForceConfessionId: null
        };
    },

    normalizeParsedState(parsed) {
        const base = this.getDefaultState();
        if (!parsed || typeof parsed !== 'object') return base;

        const mergedPrivacy = { ...base.privacy, ...(parsed.privacy || {}) };
        Object.keys(mergedPrivacy).forEach(k => {
            if (mergedPrivacy[k] === 'never') mergedPrivacy[k] = 'closed';
        });
        FIELD_SECTIONS.forEach(sec => {
            sec.fields.forEach(f => {
                if (f.alwaysOpen) mergedPrivacy[f.key] = 'open';
            });
        });
        mergedPrivacy.ig = 'closed';

        let sessions = Array.isArray(parsed.registeredSessions) ? parsed.registeredSessions : [];
        if (sessions.length === 0 && parsed.registeredSession) {
            sessions = [parsed.registeredSession];
        }
        sessions = Array.from(new Set(sessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));

        const mergedProfile = { ...base.profile, ...(parsed.profile || {}) };
        if (!mergedProfile.region && mergedProfile.city) {
            mergedProfile.region = inferRegionByCity(mergedProfile.city);
        }
        if (!mergedProfile.mbtiGroup && mergedProfile.mbti) {
            mergedProfile.mbtiGroup = inferMbtiGroup(mergedProfile.mbti);
        }
        if (mergedProfile.gender && mergedProfile.gender !== '男' && mergedProfile.gender !== '女') {
            if (!parsed.playerId) mergedProfile.gender = '';
        }
        if (mergedProfile.targetGender === '男') mergedProfile.targetGender = '男生';
        else if (mergedProfile.targetGender === '女') mergedProfile.targetGender = '女生';
        else if (mergedProfile.targetGender === '非二元') mergedProfile.targetGender = '都可以';

        return {
            ...base,
            ...parsed,
            version: SCHEMA_VERSION,
            isChatBanned: Boolean(parsed.isChatBanned),
            readMailIds: Array.isArray(parsed.readMailIds) ? parsed.readMailIds : [],
            profile: mergedProfile,
            privacy: mergedPrivacy,
            registeredSessions: sessions,
            exactMatchCriteria: (parsed.exactMatchCriteria && typeof parsed.exactMatchCriteria === 'object') ? parsed.exactMatchCriteria : {},
            customActivityRegs: (parsed.customActivityRegs && typeof parsed.customActivityRegs === 'object' && !Array.isArray(parsed.customActivityRegs)) ? parsed.customActivityRegs : {},
            friends: Array.isArray(parsed.friends) ? parsed.friends : []
        };
    },

    loadByPlayerId(targetPlayerId) {
        const base = this.getDefaultState();
        const pid = String(targetPlayerId || '').trim();
        if (!pid) return base;

        try {
            const perPlayerRaw = localStorage.getItem(PLAYER_STATE_PREFIX + pid);
            if (perPlayerRaw) {
                const state = this.normalizeParsedState(JSON.parse(perPlayerRaw));
                state.playerId = pid;
                sessionStorage.setItem(TAB_PLAYER_ID_KEY, pid);
                try {
                    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
                    const userRec = users.find(u => String(u.id) === pid);
                    if (userRec) {
                        if (!state.profile.city && userRec.city) state.profile.city = String(userRec.city).trim();
                        if (!state.profile.region) {
                            state.profile.region = String(userRec.region || inferRegionByCity(state.profile.city) || '').trim();
                        }
                        if (!state.profile.mbti && userRec.mbti) state.profile.mbti = String(userRec.mbti).trim();
                        if (!state.profile.mbtiGroup) {
                            state.profile.mbtiGroup = String(userRec.mbtiGroup || inferMbtiGroup(state.profile.mbti) || '').trim();
                        }
                        if (userRec.updatedAt && userRec.updatedAt !== state.lastSyncedCloudUpdatedAt) {
                            const skipKeys = new Set([
                                'id', 'privacy', 'backupCode', 'isWarned', 'warningReason',
                                'isMatchBanned', 'isChatBanned', 'registeredSessions', 'registeredSession',
                                'exactMatchCriteria', 'customActivityRegs', 'matchedHistory', 'matchedSession',
                                'matchedWithId', 'matchedWithName', 'matchedAt', 'updatedAt'
                            ]);
                            Object.entries(userRec).forEach(([k, v]) => {
                                if (!skipKeys.has(k) && v !== undefined && v !== null) {
                                    state.profile[k] = v;
                                }
                            });
                            if (!state.profile.region && state.profile.city) {
                                state.profile.region = inferRegionByCity(state.profile.city);
                            }
                            if (!state.profile.mbtiGroup && state.profile.mbti) {
                                state.profile.mbtiGroup = inferMbtiGroup(state.profile.mbti);
                            }
                            state.lastSyncedCloudUpdatedAt = userRec.updatedAt;
                        }
                    }
                } catch (err) {}
                return state;
            }
        } catch (e) {}

        // 若本地尚未有該玩家緩存，從共享資料庫 yuelao_users 還原
        try {
            const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
            const userRec = users.find(u => String(u.id) === pid);
            if (userRec) {
                const state = this.normalizeParsedState({
                    playerId: pid,
                    backupCode: deriveFixedBackupCode(pid),
                    lastSyncedCloudUpdatedAt: userRec.updatedAt || '',
                    isWarnedAccount: Boolean(userRec.isWarned),
                    warningReason: userRec.warningReason || '',
                    isChatBanned: Boolean(userRec.isChatBanned),
                    profile: { ...userRec },
                    privacy: userRec.privacy || {},
                    registeredSessions: Array.isArray(userRec.registeredSessions) ? Array.from(new Set(userRec.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean))) : [],
                    exactMatchCriteria: userRec.exactMatchCriteria || {},
                    customActivityRegs: (userRec.customActivityRegs && typeof userRec.customActivityRegs === 'object' && !Array.isArray(userRec.customActivityRegs)) ? userRec.customActivityRegs : {}
                });
                sessionStorage.setItem(TAB_PLAYER_ID_KEY, pid);
                return state;
            }
        } catch (e) {}

        return base;
    },

    load() {
        const base = this.getDefaultState();
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const queryPid = urlParams.get('playerId');
            if (queryPid) {
                return this.loadByPlayerId(queryPid);
            }

            const tabPid = sessionStorage.getItem(TAB_PLAYER_ID_KEY);
            if (tabPid) {
                return this.loadByPlayerId(tabPid);
            }

            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return base;
            const state = this.normalizeParsedState(JSON.parse(raw));
            if (state.playerId) {
                sessionStorage.setItem(TAB_PLAYER_ID_KEY, String(state.playerId));
            }
            return state;
        } catch (e) {
            console.error('讀取本地資料異常', e);
            return base;
        }
    },

    save(state, forceCloudPush = false, skipCloudPush = false) {
        state.version = SCHEMA_VERSION;
        FIELD_SECTIONS.forEach(sec => {
            sec.fields.forEach(f => {
                if (f.alwaysOpen) state.privacy[f.key] = 'open';
            });
        });
        state.privacy.ig = 'closed';

        if (state.profile) {
            state.profile.city = String(state.profile.city || '').trim();
            state.profile.region = String(state.profile.region || inferRegionByCity(state.profile.city) || '').trim();
            state.profile.mbti = String(state.profile.mbti || '').trim();
            state.profile.mbtiGroup = String(state.profile.mbtiGroup || inferMbtiGroup(state.profile.mbti) || '').trim();
        }

        if (Array.isArray(state.registeredSessions)) {
            state.registeredSessions = Array.from(new Set(state.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
        }
        if (state.matchedSession) {
            state.matchedSession = normalizeSessionLabel(state.matchedSession);
        }

        if (state.playerId && state.profile) {
            if (!forceCloudPush && typeof CloudSync !== 'undefined' && typeof CloudSync.isUserDeleted === 'function' && CloudSync.isUserDeleted(state.playerId)) {
                return;
            }
            const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
            const idx = users.findIndex(u => String(u.id) === String(state.playerId));
            const hasCloudTreeRec = Boolean(typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[USERS_KEY] && CloudSync.tree[USERS_KEY][String(state.playerId)]);
            const cloudTreeRec = hasCloudTreeRec ? CloudSync.tree[USERS_KEY][String(state.playerId)] : {};
            const existingRecord = idx >= 0 ? { ...cloudTreeRec, ...users[idx] } : { ...cloudTreeRec };
            // 配對歷史與封鎖狀態合併雲端與本地最新紀錄，避免本地或未完成同步的雲端快取覆蓋新配對好友
            const authMatchSource = hasCloudTreeRec ? cloudTreeRec : existingRecord;
            const isPairUnmatchedCheck = (pidA, pidB) => (
                typeof CloudSync !== 'undefined' &&
                typeof CloudSync.isPairRecentlyUnmatched === 'function' &&
                CloudSync.isPairRecentlyUnmatched(pidA, pidB)
            );
            const rawCombinedHistory = [
                ...(typeof CloudSync !== 'undefined' && typeof CloudSync.normalizeMatchedHistoryList === 'function'
                    ? CloudSync.normalizeMatchedHistoryList(cloudTreeRec.matchedHistory)
                    : (Array.isArray(cloudTreeRec.matchedHistory) ? cloudTreeRec.matchedHistory : [])),
                ...(typeof CloudSync !== 'undefined' && typeof CloudSync.normalizeMatchedHistoryList === 'function'
                    ? CloudSync.normalizeMatchedHistoryList(existingRecord.matchedHistory)
                    : (Array.isArray(existingRecord.matchedHistory) ? existingRecord.matchedHistory : []))
            ];
            const preservedMatchedHistory = ((typeof CloudSync !== 'undefined' && typeof CloudSync.normalizeMatchedHistoryList === 'function')
                ? CloudSync.normalizeMatchedHistoryList(rawCombinedHistory)
                : rawCombinedHistory
            ).filter(h => !isPairUnmatchedCheck(state.playerId, h && h.partnerId));

            const resolvedCity = String(state.profile.city || existingRecord.city || '').trim();
            const resolvedRegion = String(state.profile.region || inferRegionByCity(resolvedCity) || existingRecord.region || '').trim();
            const resolvedMbti = String(state.profile.mbti || existingRecord.mbti || '').trim();
            const resolvedMbtiGroup = String(state.profile.mbtiGroup || inferMbtiGroup(resolvedMbti) || existingRecord.mbtiGroup || '').trim();

            state.profile.city = resolvedCity;
            state.profile.region = resolvedRegion;
            state.profile.mbti = resolvedMbti;
            state.profile.mbtiGroup = resolvedMbtiGroup;

            const mergedProfileForRecord = {
                ...state.profile,
                nickname: (state.profile.nickname && String(state.profile.nickname).trim()) || `玩家_${state.playerId}`,
                region: resolvedRegion,
                city: resolvedCity,
                mbtiGroup: resolvedMbtiGroup,
                mbti: resolvedMbti
            };
            const generatedBackupCode = deriveFixedBackupCode(state.playerId);
            state.backupCode = generatedBackupCode;
            const nowUpdatedStr = new Date().toLocaleString('zh-TW');
            state.lastSyncedCloudUpdatedAt = nowUpdatedStr;

            const record = {
                ...existingRecord,
                id: String(state.playerId),
                ...mergedProfileForRecord,
                privacy: state.privacy,
                backupCode: generatedBackupCode,
                isWarned: !!state.isWarnedAccount,
                warningReason: state.warningReason || '',
                isMatchBanned: Boolean(authMatchSource.isMatchBanned),
                isChatBanned: Boolean(authMatchSource.isChatBanned),
                registeredSessions: state.isWarnedAccount ? [] : (Array.isArray(state.registeredSessions) ? state.registeredSessions : []),
                exactMatchCriteria: state.exactMatchCriteria || {},
                customActivityRegs: state.isWarnedAccount ? {} : (state.customActivityRegs || {}),
                matchedHistory: preservedMatchedHistory,
                matchedSession: (authMatchSource.matchedWithId && !isPairUnmatchedCheck(state.playerId, authMatchSource.matchedWithId))
                    ? (authMatchSource.matchedSession || state.matchedSession || null)
                    : (preservedMatchedHistory[preservedMatchedHistory.length - 1]?.session || null),
                matchedWithId: (authMatchSource.matchedWithId && !isPairUnmatchedCheck(state.playerId, authMatchSource.matchedWithId))
                    ? authMatchSource.matchedWithId
                    : (preservedMatchedHistory[preservedMatchedHistory.length - 1]?.partnerId || null),
                matchedWithName: (authMatchSource.matchedWithId && !isPairUnmatchedCheck(state.playerId, authMatchSource.matchedWithId))
                    ? (authMatchSource.matchedWithName || state.friends.map(f => f.nickname).join(', ') || null)
                    : (preservedMatchedHistory[preservedMatchedHistory.length - 1]?.partnerName || null),
                updatedAt: nowUpdatedStr
            };
            delete record.registeredSession;
            if (idx >= 0) users[idx] = record;
            else users.push(record);
            localStorage.setItem(USERS_KEY, JSON.stringify(users));
            if (!skipCloudPush && typeof CloudSync !== 'undefined') {
                const pushPromise = CloudSync.upsertUser(record, forceCloudPush);
                if (state.playerId) {
                    sessionStorage.setItem(TAB_PLAYER_ID_KEY, String(state.playerId));
                    localStorage.setItem(PLAYER_STATE_PREFIX + String(state.playerId), JSON.stringify(state));
                }
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                return pushPromise;
            }
        }

        if (state.playerId) {
            sessionStorage.setItem(TAB_PLAYER_ID_KEY, String(state.playerId));
            localStorage.setItem(PLAYER_STATE_PREFIX + String(state.playerId), JSON.stringify(state));
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },

    saveSharedUsers(users, options = { isMatchMutation: false }) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
        if (typeof CloudSync !== 'undefined') {
            const list = Array.isArray(users) ? users : [];
            const forcePush = Boolean(options && options.isMatchMutation);
            list.forEach(u => {
                if (u && u.id && !CloudSync.isUserDeleted(u.id)) {
                    CloudSync.upsertUser(u, forcePush, options);
                }
            });
        }
    },

    getReports() {
        try {
            const arr = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
            return Array.isArray(arr) ? arr.filter(r => r && typeof r === 'object' && r.id) : [];
        } catch (e) {
            return [];
        }
    },

    addIssueReport(report) {
        const reports = this.getReports();
        const nowTs = Date.now();
        const newRep = {
            id: 'R' + nowTs.toString().slice(-6) + '_' + Math.random().toString(36).slice(2, 4),
            playerId: report.playerId ? String(report.playerId).trim() : '',
            category: report.category,
            contact: report.contact || '匿名玩家',
            content: report.content,
            status: '待處理',
            adminReply: '',
            repliedAt: '',
            ts: nowTs,
            createdAt: new Date(nowTs).toLocaleString('zh-TW')
        };
        reports.unshift(newRep);
        reports.sort((a, b) => {
            const diff = Number(b.ts || 0) - Number(a.ts || 0);
            if (diff !== 0) return diff;
            return String((b && b.id) || '').localeCompare(String((a && a.id) || ''));
        });

        const keptReports = reports.slice(0, REPORTS_MAX_COUNT);
        const removedOldestReports = reports.slice(REPORTS_MAX_COUNT);

        localStorage.setItem(REPORTS_KEY, JSON.stringify(keptReports));
        if (typeof CloudSync !== 'undefined') {
            CloudSync.putNode(`${REPORTS_KEY}/${newRep.id}`, newRep);
            removedOldestReports.forEach(oldRep => {
                if (oldRep && oldRep.id) {
                    if (CloudSync.tree && CloudSync.tree[REPORTS_KEY] && typeof CloudSync.tree[REPORTS_KEY] === 'object') {
                        delete CloudSync.tree[REPORTS_KEY][oldRep.id];
                    }
                    CloudSync.deleteNode(`${REPORTS_KEY}/${oldRep.id}`);
                }
            });
        }
        return newRep;
    }
};

// 6. 雙方即時共享聊天歷史紀錄管理器（永久保留，直到直接解除配對才清空）
const ChatStore = {
    getPairKey(id1, id2) {
        return [String(id1), String(id2)].sort().join('__');
    },

    getAll() {
        try {
            return JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
        } catch (e) {
            return {};
        }
    },

    saveAll(allChats) {
        localStorage.setItem(CHATS_KEY, JSON.stringify(allChats));
    },

    getMessages(id1, id2) {
        if (!id1 || !id2) return [];
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        return Array.isArray(all[key]) ? all[key] : [];
    },

    formatChatDateTimeStr(ts = Date.now()) {
        const d = new Date(Number(ts) || Date.now());
        if (Number.isNaN(d.getTime())) return '';
        const datePart = `${d.getMonth() + 1}/${d.getDate()}`;
        const timePart = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
        return `${datePart} ${timePart}`;
    },

    ensureThread(id1, id2, initialMessages = []) {
        if (!id1 || !id2) return [];
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.isPairRecentlyUnmatched === 'function' && CloudSync.isPairRecentlyUnmatched(id1, id2)) {
            return [];
        }
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        if (!Array.isArray(all[key]) || all[key].length === 0) {
            all[key] = initialMessages.map((m, idx) => {
                const msgTs = Number(m.ts) || (Date.now() + idx);
                return {
                    id: m.id || `INIT_${key}_${idx}`,
                    senderId: String(m.senderId || 'system'),
                    senderName: m.senderName || '',
                    text: m.text || '',
                    time: m.time || '',
                    dateTime: m.dateTime || this.formatChatDateTimeStr(msgTs),
                    ts: msgTs
                };
            });
            this.saveAll(all);
            if (typeof CloudSync !== 'undefined') {
                all[key].forEach(mObj => CloudSync.putNode(`${CHATS_KEY}/${key}/${mObj.id}`, mObj));
            }
        }
        return all[key];
    },

    appendMessage(id1, id2, msg) {
        if (!id1 || !id2) return [];
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        if (!Array.isArray(all[key])) all[key] = [];
        const msgTs = Number(msg.ts) || Date.now();
        const savedMsg = {
            id: msg.id || `MSG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            senderId: String(msg.senderId),
            senderName: msg.senderName || '',
            text: msg.text,
            time: msg.time || '',
            dateTime: msg.dateTime || this.formatChatDateTimeStr(msgTs),
            ts: msgTs
        };
        all[key].push(savedMsg);
        
        // 限制每個聊天室最多保留最近 500 則訊息，避免 DOM 卡頓與超過 localStorage 容量
        let removedIds = [];
        if (all[key].length > 500) {
            const removedMsgs = all[key].slice(0, all[key].length - 500);
            removedIds = removedMsgs.map(m => m.id).filter(Boolean);
            all[key] = all[key].slice(-500);
        }
        
        this.saveAll(all);
        
        if (typeof CloudSync !== 'undefined') {
            CloudSync.putNode(`${CHATS_KEY}/${key}/${savedMsg.id}`, savedMsg);
            removedIds.forEach(delId => {
                CloudSync.deleteNode(`${CHATS_KEY}/${key}/${delId}`);
            });
        }
        return all[key];
    },

    clearChat(id1, id2) {
        if (!id1 || !id2) return;
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.markPairUnmatched === 'function') {
            CloudSync.markPairUnmatched(id1, id2);
        }
        if (Object.prototype.hasOwnProperty.call(all, key)) {
            delete all[key];
            this.saveAll(all);
        }
        if (typeof CloudSync !== 'undefined') {
            CloudSync.deleteNode(`${CHATS_KEY}/${key}`);
        }
    },

    clearAllForPlayer(playerId) {
        const pid = String(playerId);
        const all = this.getAll();
        let changed = false;
        Object.keys(all).forEach(k => {
            if (k.split('__').includes(pid)) {
                delete all[k];
                changed = true;
            }
        });
        if (changed) this.saveAll(all);
    },

    // 超過 4 天（96 小時）無更新或無新訊息：刪除聊天紀錄（刪除不保存）並自動解除會員列表雙方好友配對
    purgeInactiveRooms(nowTs = Date.now(), maxInactiveMs = 4 * 24 * 60 * 60 * 1000) {
        if (typeof CloudSync !== 'undefined' && (!CloudSync.initialized || CloudSync.inFlightWrites > 0)) {
            return [];
        }

        const allChats = this.getAll();
        const expiredPairs = [];

        Object.keys(allChats || {}).forEach(pairKey => {
            const rawThread = allChats[pairKey];
            const msgs = Array.isArray(rawThread)
                ? rawThread.filter(m => m && typeof m === 'object')
                : (rawThread && typeof rawThread === 'object'
                    ? Object.values(rawThread).filter(m => m && typeof m === 'object')
                    : []);
            if (msgs.length === 0) return;

            msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
            const lastMsg = msgs[msgs.length - 1] || {};
            const lastTs = Number(lastMsg.ts || 0);
            if (lastTs <= 0) return;

            if (nowTs >= lastTs + maxInactiveMs) {
                const parts = String(pairKey).split('__');
                if (parts.length === 2 && parts[0] && parts[1]) {
                    expiredPairs.push({
                        pairKey,
                        idA: String(parts[0]).trim(),
                        idB: String(parts[1]).trim(),
                        lastTs,
                        msgCount: msgs.length
                    });
                }
            }
        });

        if (expiredPairs.length === 0) return [];

        let users = [];
        try {
            users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
            if (!Array.isArray(users)) users = [];
        } catch (e) {
            users = [];
        }

        const touchedUsersMap = new Map();

        expiredPairs.forEach(item => {
            const { idA, idB } = item;
            // 1. 刪除聊天紀錄（不保存）並標記近期解除配對防止舊快照回補
            this.clearChat(idA, idB);

            // 2. 會員列表雙方自動解除配對
            users.forEach(u => {
                if (!u || !u.id) return;
                const uid = String(u.id).trim();
                if (uid !== idA && uid !== idB) return;

                const partnerId = (uid === idA) ? idB : idA;
                let modified = false;

                if (Array.isArray(u.matchedHistory)) {
                    const nextHist = u.matchedHistory.filter(h => String(h.partnerId) !== partnerId);
                    if (nextHist.length !== u.matchedHistory.length) {
                        u.matchedHistory = nextHist;
                        modified = true;
                    }
                }

                if (String(u.matchedWithId) === partnerId) {
                    const fallbackHist = (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0)
                        ? u.matchedHistory[u.matchedHistory.length - 1]
                        : null;
                    u.matchedSession = fallbackHist ? (fallbackHist.session || null) : null;
                    u.matchedWithId = fallbackHist ? (fallbackHist.partnerId || null) : null;
                    u.matchedWithName = fallbackHist ? (fallbackHist.partnerName || null) : null;
                    u.matchedAt = fallbackHist ? (fallbackHist.matchedAt || null) : null;
                    modified = true;
                }

                if (modified) {
                    touchedUsersMap.set(uid, u);
                }
            });
        });

        if (touchedUsersMap.size > 0) {
            localStorage.setItem(USERS_KEY, JSON.stringify(users));
            if (typeof CloudSync !== 'undefined') {
                touchedUsersMap.forEach(u => {
                    CloudSync.upsertUser(u, true, { isMatchMutation: true });
                });
            }
        }

        return expiredPairs;
    }
};


// 7. 活動報名歷史統計封存器（永久保留各屆／單場／自定義活動報名人數與選項，不因活動結束 3 分鐘自動清除而歸零）
const ActivityRegArchive = {
    sanitizeSeg(str) {
        return String(str ?? '').trim().replace(/[\/.#$\[\]\s]+/g, '_');
    },

    makeRegularKey(sessionStr, playerId) {
        const norm = (typeof normalizeSessionLabel === 'function')
            ? normalizeSessionLabel(sessionStr)
            : String(sessionStr || '').trim();
        const pid = String(playerId || '').trim();
        if (!norm || !pid) return '';
        return `S__${this.sanitizeSeg(norm)}__${this.sanitizeSeg(pid)}`;
    },

    makeCustomKey(actId, playerId) {
        const aid = String(actId || '').trim();
        const pid = String(playerId || '').trim();
        if (!aid || !pid) return '';
        return `C__${this.sanitizeSeg(aid)}__${this.sanitizeSeg(pid)}`;
    },

    getAllMap() {
        try {
            const parsed = JSON.parse(localStorage.getItem(REG_HISTORY_KEY) || '{}');
            return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
        } catch (e) {
            return {};
        }
    },

    saveAllMap(mapObj) {
        const nextStr = JSON.stringify(mapObj || {});
        if (localStorage.getItem(REG_HISTORY_KEY) !== nextStr) {
            localStorage.setItem(REG_HISTORY_KEY, nextStr);
        }
    },

    buildRegularEntry(user, sessionStr, existingEntry = null) {
        const norm = (typeof normalizeSessionLabel === 'function')
            ? normalizeSessionLabel(sessionStr)
            : String(sessionStr || '').trim();
        const pid = String((user && user.id) || (existingEntry && existingEntry.playerId) || '').trim();
        const key = this.makeRegularKey(norm, pid);
        if (!key) return null;
        const batchLbl = (typeof extractBatchLabel === 'function')
            ? extractBatchLabel(norm)
            : ((norm.match(/^第\s*(\d+)\s*屆/) || [])[0] || '');
        return {
            id: key,
            kind: 'regular',
            session: norm,
            batchLabel: batchLbl,
            playerId: pid,
            nickname: String((user && user.nickname) || (existingEntry && existingEntry.nickname) || '').trim(),
            gender: String((user && user.gender) || (existingEntry && existingEntry.gender) || '').trim(),
            recordedAt: Number((existingEntry && existingEntry.recordedAt) || Date.now())
        };
    },

    buildCustomEntry(user, actId, regObj, existingEntry = null) {
        const aid = String(actId || '').trim();
        const pid = String((user && user.id) || (existingEntry && existingEntry.playerId) || '').trim();
        const key = this.makeCustomKey(aid, pid);
        if (!key) return null;
        const r = (regObj && typeof regObj === 'object') ? regObj : {};
        return {
            id: key,
            kind: 'custom',
            activityId: aid,
            activityName: String(r.activityName || (existingEntry && existingEntry.activityName) || '').trim(),
            activityType: String(r.activityType || (existingEntry && existingEntry.activityType) || '').trim(),
            fortuneNumber: r.fortuneNumber || (existingEntry && existingEntry.fortuneNumber) || null,
            twoChoiceValue: String(r.twoChoiceValue || (existingEntry && existingEntry.twoChoiceValue) || '').trim(),
            playerId: pid,
            nickname: String((user && user.nickname) || (existingEntry && existingEntry.nickname) || '').trim(),
            gender: String((user && user.gender) || (existingEntry && existingEntry.gender) || '').trim(),
            recordedAt: Number(r.registeredAt || (existingEntry && existingEntry.recordedAt) || Date.now())
        };
    },

    recordRegular(user, sessionStr, pushToCloud = true) {
        if (!user || !user.id || !sessionStr) return null;
        const map = this.getAllMap();
        const key = this.makeRegularKey(sessionStr, user.id);
        if (!key) return null;
        const prev = map[key] || null;
        const entry = this.buildRegularEntry(user, sessionStr, prev);
        if (!entry) return null;
        if (!prev || prev.nickname !== entry.nickname || prev.gender !== entry.gender || prev.session !== entry.session) {
            map[key] = entry;
            this.saveAllMap(map);
            if (pushToCloud && typeof CloudSync !== 'undefined' && CloudSync.initialized) {
                CloudSync.putNode(`${REG_HISTORY_KEY}/${key}`, entry);
            }
        }
        return entry;
    },

    recordCustom(user, actId, regObj, pushToCloud = true) {
        if (!user || !user.id || !actId) return null;
        const map = this.getAllMap();
        const key = this.makeCustomKey(actId, user.id);
        if (!key) return null;
        const prev = map[key] || null;
        const entry = this.buildCustomEntry(user, actId, regObj, prev);
        if (!entry) return null;
        if (!prev || JSON.stringify(prev) !== JSON.stringify(entry)) {
            map[key] = entry;
            this.saveAllMap(map);
            if (pushToCloud && typeof CloudSync !== 'undefined' && CloudSync.initialized) {
                CloudSync.putNode(`${REG_HISTORY_KEY}/${key}`, entry);
            }
        }
        return entry;
    },

    syncFromUserRecord(user, pushToCloud = true) {
        if (!user || !user.id) return;
        const sessions = Array.isArray(user.registeredSessions)
            ? user.registeredSessions
            : (user.registeredSession ? [user.registeredSession] : []);
        sessions.forEach(s => {
            if (s) this.recordRegular(user, s, pushToCloud);
        });
        if (user.customActivityRegs && typeof user.customActivityRegs === 'object' && !Array.isArray(user.customActivityRegs)) {
            Object.keys(user.customActivityRegs).forEach(actId => {
                if (actId && user.customActivityRegs[actId]) {
                    this.recordCustom(user, actId, user.customActivityRegs[actId], pushToCloud);
                }
            });
        }
    },

    mergeCloudTreeAndUsers(cloudRegNode, usersArr) {
        const merged = this.getAllMap();
        if (cloudRegNode && typeof cloudRegNode === 'object' && !Array.isArray(cloudRegNode)) {
            Object.keys(cloudRegNode).forEach(k => {
                const item = cloudRegNode[k];
                if (item && typeof item === 'object' && item.playerId) {
                    merged[k] = item;
                }
            });
        }
        (Array.isArray(usersArr) ? usersArr : []).forEach(u => {
            if (!u || !u.id) return;
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : [];
            sessions.forEach(s => {
                const key = this.makeRegularKey(s, u.id);
                if (key) {
                    const entry = this.buildRegularEntry(u, s, merged[key] || null);
                    if (entry) merged[key] = entry;
                }
            });
            if (u.customActivityRegs && typeof u.customActivityRegs === 'object' && !Array.isArray(u.customActivityRegs)) {
                Object.keys(u.customActivityRegs).forEach(actId => {
                    const key = this.makeCustomKey(actId, u.id);
                    if (key) {
                        const entry = this.buildCustomEntry(u, actId, u.customActivityRegs[actId], merged[key] || null);
                        if (entry) merged[key] = entry;
                    }
                });
            }
        });
        this.saveAllMap(merged);
    },

    removeRegular(sessionStr, playerId) {
        const key = this.makeRegularKey(sessionStr, playerId);
        if (!key) return;
        const map = this.getAllMap();
        if (Object.prototype.hasOwnProperty.call(map, key)) {
            delete map[key];
            this.saveAllMap(map);
        }
        if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
            CloudSync.deleteNode(`${REG_HISTORY_KEY}/${key}`);
        }
    },

    removeCustom(actId, playerId) {
        const key = this.makeCustomKey(actId, playerId);
        if (!key) return;
        const map = this.getAllMap();
        if (Object.prototype.hasOwnProperty.call(map, key)) {
            delete map[key];
            this.saveAllMap(map);
        }
        if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
            CloudSync.deleteNode(`${REG_HISTORY_KEY}/${key}`);
        }
    },

    removeAllForCustomActivity(actId) {
        const prefix = `C__${this.sanitizeSeg(actId)}__`;
        const map = this.getAllMap();
        const removedKeys = [];
        Object.keys(map).forEach(k => {
            if (k.startsWith(prefix)) {
                delete map[k];
                removedKeys.push(k);
            }
        });
        if (removedKeys.length > 0) {
            this.saveAllMap(map);
            if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
                removedKeys.forEach(k => CloudSync.deleteNode(`${REG_HISTORY_KEY}/${k}`));
            }
        }
    }
};
