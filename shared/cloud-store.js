/* shared/cloud-store.js - 前後台共用：Firebase 即時雲端同步、玩家資料庫、信箱與聊天室管理器 */

/* 全站共用 HTML 跳脫（所有使用者輸入插入 innerHTML 前必須經過此函式） */
function yuelaoEscapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


const STORAGE_KEY = 'yuelao_romance_app_v2';
const USERS_KEY = 'yuelao_users';
const USER_INDEX_KEY = 'yuelao_user_index';
const PAIR_PROFILES_KEY = 'yuelao_pair_profiles';
const PAIR_IG_KEY = 'yuelao_pair_ig';
const REPORTS_KEY = 'yuelao_reports';
const REPORTS_MAX_COUNT = 15;
const ID_COUNTER_KEY = 'yuelao_id_counters';
const SYSTEM_STATE_KEY = 'yuelao_system_batch';
const BANNED_RULES_KEY = 'yuelao_banned_rules';
const MAILBOX_KEY = 'yuelao_mailbox';
const CHATS_KEY = 'yuelao_chats';
const CHAT_META_KEY = 'yuelao_chat_meta';
const ADMIN_CHATS_KEY = 'yuelao_admin_chats';
const CUSTOM_ACTIVITIES_KEY = 'yuelao_custom_activities';
const REG_HISTORY_KEY = 'yuelao_activity_reg_history';
const SESSION_MATCH_RESULTS_KEY = 'yuelao_session_match_results';
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
const PLAYER_OP_LOGS_KEY = 'yuelao_player_op_logs';
const PLAYER_OP_LOGS_MAX_COUNT = 30;
const FATE_WALL_KEY = 'yuelao_fate_wall';
const WISH_WALL_KEY = 'yuelao_wish_wall';

const FIREBASE_DB_URL = 'https://moon1-cb403-default-rtdb.asia-southeast1.firebasedatabase.app';

// ==================== ⚡ 本地 JSON 解析記憶體快取（避免重複 JSON.parse 造成 CPU 與 GC 負擔） ====================
const LocalJsonCache = {
    entries: Object.create(null),
    get(key, fallbackFactory) {
        let raw = null;
        try {
            raw = localStorage.getItem(key);
        } catch (e) {}
        if (raw === null || raw === '') {
            delete this.entries[key];
            return typeof fallbackFactory === 'function' ? fallbackFactory() : fallbackFactory;
        }
        const cached = this.entries[key];
        if (cached && cached.raw === raw) {
            return cached.val;
        }
        try {
            const parsed = JSON.parse(raw);
            this.entries[key] = { raw, val: parsed };
            return parsed;
        } catch (e) {
            delete this.entries[key];
            return typeof fallbackFactory === 'function' ? fallbackFactory() : fallbackFactory;
        }
    },
    invalidate(key) {
        if (!key) {
            this.entries = Object.create(null);
        } else {
            delete this.entries[key];
        }
    }
};

// ==================== ☁️ Firebase Realtime Database 跨裝置即時雲端同步中樞 ====================
const CloudSync = {
    dbUrl: FIREBASE_DB_URL.replace(/\/+$/, ''),
    tree: {},
    initialized: false,
    hasLoadedFullTree: false,
    chatsTreeVersion: 0,
    _persistedSymmetricPairs: Object.create(null),
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
    streamFlushTimer: null,

    isLocalSandboxMode() {
        return typeof isLocalSandboxEnv === 'function' && isLocalSandboxEnv();
    },

    isBackendContext() {
        if (typeof document === 'undefined' || !document.body) return false;
        return Boolean(document.body.dataset && document.body.dataset.adminPage);
    },

    getActiveFrontendPlayerId() {
        if (this.isBackendContext()) return '';
        try {
            if (typeof appState !== 'undefined' && appState && appState.playerId) {
                return String(appState.playerId).trim();
            }
        } catch (e) {}
        try {
            const tabPid = sessionStorage.getItem(TAB_PLAYER_ID_KEY);
            if (tabPid) return String(tabPid).trim();
        } catch (e) {}
        try {
            const parsed = LocalJsonCache.get(STORAGE_KEY, null);
            if (parsed && parsed.playerId) return String(parsed.playerId).trim();
        } catch (e) {}
        return '';
    },

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
                const isPerm = Boolean(val && typeof val === 'object' && val.permanent);
                const exp = isPerm
                    ? (now + 315360000000)
                    : ((val && typeof val === 'object') ? Number(val.graceUntil || 0) : Number(val || 0));
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

    markPairUnmatched(idA, idB, ttlMs = 315360000000) {
        const pk = this.makeUnmatchedPairKey(idA, idB);
        if (!pk) return Promise.resolve();
        const graceUntil = Date.now() + ttlMs;
        const map = this.loadSharedUnmatchedPairs();
        map[pk] = graceUntil;
        this.unmatchedPairs = map;
        try { localStorage.setItem(UNMATCHED_PAIRS_SYNC_KEY, JSON.stringify(map)); } catch (e) {}
        if (this.initialized) {
            return this.putNode(`${UNMATCHED_PAIRS_CLOUD_NODE}/${pk}`, {
                unmatchedAt: Date.now(),
                graceUntil,
                permanent: true
            });
        }
        return Promise.resolve();
    },

    async unmatchUsersInCloud(idA, idB, userA, userB) {
        const pidA = String(idA || '').trim();
        const pidB = String(idB || '').trim();
        if (!pidA || !pidB) return;

        // 1. 先將永久解除配對墓碑寫入本地與 Firebase，確保任何同步事件都不會誤判為單邊遺漏而復活配對
        await this.markPairUnmatched(pidA, pidB, 315360000000);

        // 2. 從雲端讀取雙方最新完整節點，避免前台精簡索引缺少對方 matchedHistory / matchedWithId 導致清不乾淨
        const [remoteA, remoteB] = await Promise.all([
            this.getNodeOnce(`${USERS_KEY}/${pidA}`),
            this.getNodeOnce(`${USERS_KEY}/${pidB}`)
        ]);

        const buildCleanedUser = (baseRemote, fallbackLocal, selfId, removePartnerId) => {
            const src = (baseRemote && typeof baseRemote === 'object')
                ? { ...baseRemote, id: selfId }
                : (fallbackLocal && typeof fallbackLocal === 'object' ? { ...fallbackLocal, id: selfId } : null);
            if (!src) return null;
            const normHist = this.normalizeMatchedHistoryList(src.matchedHistory)
                .filter(h => String(h.partnerId).trim() !== removePartnerId && !this.isPairRecentlyUnmatched(selfId, h.partnerId));
            src.matchedHistory = normHist;
            const fallbackLast = normHist.length > 0 ? normHist[normHist.length - 1] : null;
            if (!src.matchedWithId || String(src.matchedWithId).trim() === removePartnerId || this.isPairRecentlyUnmatched(selfId, src.matchedWithId)) {
                src.matchedSession = fallbackLast ? (fallbackLast.session || null) : null;
                src.matchedWithId = fallbackLast ? (fallbackLast.partnerId || null) : null;
                src.matchedWithName = fallbackLast ? (fallbackLast.partnerName || null) : null;
                src.matchedAt = fallbackLast ? (fallbackLast.matchedAt || null) : null;
            }
            return src;
        };

        const cleanedA = buildCleanedUser(remoteA, userA, pidA, pidB);
        const cleanedB = buildCleanedUser(remoteB, userB, pidB, pidA);

        const tasks = [];
        if (cleanedA) tasks.push(this.upsertUser(cleanedA, true, { isMatchMutation: true }));
        if (cleanedB) tasks.push(this.upsertUser(cleanedB, true, { isMatchMutation: true }));
        if (tasks.length > 0) {
            await Promise.all(tasks);
        }

        // 3. 清除配對快照與雙方聊天紀錄節點
        const pk = this.pairKeyOf(pidA, pidB);
        await Promise.all([
            this.deleteNode(`${PAIR_PROFILES_KEY}/${pk}`),
            this.deleteNode(`${PAIR_IG_KEY}/${pk}`)
        ]);
        if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
            ChatStore.clearChat(pidA, pidB);
        }
    },

    clearPairUnmatched(idA, idB) {
        const pk = this.makeUnmatchedPairKey(idA, idB);
        if (!pk) return Promise.resolve();
        const map = this.loadSharedUnmatchedPairs();
        if (Object.prototype.hasOwnProperty.call(map, pk)) {
            delete map[pk];
            this.unmatchedPairs = map;
            try { localStorage.setItem(UNMATCHED_PAIRS_SYNC_KEY, JSON.stringify(map)); } catch (e) {}
        }
        if (this.tree && this.tree[UNMATCHED_PAIRS_CLOUD_NODE] && Object.prototype.hasOwnProperty.call(this.tree[UNMATCHED_PAIRS_CLOUD_NODE], pk)) {
            delete this.tree[UNMATCHED_PAIRS_CLOUD_NODE][pk];
        }
        if (this.dbUrl) {
            return this.deleteNode(`${UNMATCHED_PAIRS_CLOUD_NODE}/${pk}`);
        }
        return Promise.resolve();
    },

    isPairRecentlyUnmatched(idA, idB) {
        const pk = this.makeUnmatchedPairKey(idA, idB);
        if (!pk) return false;
        const map = this.loadSharedUnmatchedPairs();
        return Boolean(map[pk] && Date.now() <= Number(map[pk] || 0));
    },

    isRogueCustomMatchEntry(histItem, customActsList = null) {
        if (!histItem || typeof histItem !== 'object') return false;
        if (
            histItem.isForceRepaired ||
            String(histItem.session || '').includes('・強制補齊') ||
            String(histItem.matchDetail || '').includes('強制補齊')
        ) {
            return false;
        }
        const matchedAtTs = Number(histItem.matchedAt || 0);
        const floorTs = (typeof getCustomActivityAllowedMinTs === 'function')
            ? getCustomActivityAllowedMinTs(Date.now())
            : new Date(2026, 10, 18, 0, 0, 0, 0).getTime();
        // 只檢查在 11/18 00:00 之後才寫入的配對紀錄，不影響 11/18 之前原本正常的歷史配對
        if (!matchedAtTs || matchedAtTs < floorTs) return false;

        let acts = Array.isArray(customActsList) ? customActsList : null;
        if (!acts) {
            if (this.tree && this.tree[CUSTOM_ACTIVITIES_KEY] !== undefined) {
                acts = this.mapToArray(this.tree[CUSTOM_ACTIVITIES_KEY]);
            } else {
                try {
                    acts = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
                } catch (e) {
                    acts = [];
                }
            }
        }
        if (!Array.isArray(acts) || acts.length === 0) return false;

        const aid = String(histItem.activityId || '').trim();
        const sess = String(histItem.session || '').trim();
        const matchedAct = acts.find(a =>
            a && ((aid && String(a.id || '').trim() === aid) || (!aid && sess && String(a.name || '').trim() === sess))
        );
        if (!matchedAct) return false;

        // 僅攔截「活動日期早於 11/18 截止日」的歷史活動誤配對；
        // 正常活動在配對完成後可能關閉活動或防呆開關，絕不可因此清除已成立的配對紀錄！
        if (typeof isCustomActivityBeforeAllowedDate === 'function') {
            return isCustomActivityBeforeAllowedDate(matchedAct, matchedAtTs);
        }
        return false;
    },

    recordMatchLog(userA, userB, sessionLabel = '', matchTs = Date.now(), sourceLabel = '') {
        if (!userA || !userB || !userA.id || !userB.id) return null;
        // 僅紀錄自定義活動或強制手動配對，不紀錄常規場次
        const normSess = (typeof normalizeSessionLabel === 'function') ? normalizeSessionLabel(sessionLabel) : String(sessionLabel).trim();
        if (/^第\s*\d+\s*屆.+\([三六]\)$/.test(normSess) && !String(sessionLabel).includes('強制')) {
            return null;
        }
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

    recordPlayerOpLog(playerId, playerName = '', actionType = '玩家操作', detailText = '', opTs = Date.now()) {
        const pid = String(playerId || '').trim();
        if (!pid) return null;
        const tsNum = Number(opTs) || Date.now();
        const d = new Date(tsNum);
        const createdAtStr = Number.isNaN(d.getTime())
            ? new Date().toLocaleString('zh-TW', { hour12: false })
            : d.toLocaleString('zh-TW', { hour12: false });

        const entry = {
            id: 'PO_' + tsNum + '_' + Math.random().toString(36).slice(2, 6),
            playerId: pid,
            playerName: String(playerName || `玩家_${pid}`).trim(),
            actionType: String(actionType || '玩家操作').trim(),
            detail: String(detailText || '').trim(),
            ts: tsNum,
            createdAt: createdAtStr
        };

        let logs = [];
        try {
            const raw = JSON.parse(localStorage.getItem(PLAYER_OP_LOGS_KEY) || '[]');
            if (Array.isArray(raw)) logs = raw;
        } catch (e) {}

        logs.unshift(entry);
        logs.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        const removedLogs = logs.length > PLAYER_OP_LOGS_MAX_COUNT ? logs.slice(PLAYER_OP_LOGS_MAX_COUNT) : [];
        const keptLogs = logs.slice(0, PLAYER_OP_LOGS_MAX_COUNT);

        try {
            localStorage.setItem(PLAYER_OP_LOGS_KEY, JSON.stringify(keptLogs));
            if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate(PLAYER_OP_LOGS_KEY);
        } catch (e) {}

        if (this.tree && typeof this.tree === 'object') {
            if (!this.tree[PLAYER_OP_LOGS_KEY] || typeof this.tree[PLAYER_OP_LOGS_KEY] !== 'object') {
                this.tree[PLAYER_OP_LOGS_KEY] = {};
            }
            this.tree[PLAYER_OP_LOGS_KEY][entry.id] = { ...entry };
            removedLogs.forEach(oldItem => {
                if (oldItem && oldItem.id && Object.prototype.hasOwnProperty.call(this.tree[PLAYER_OP_LOGS_KEY], oldItem.id)) {
                    delete this.tree[PLAYER_OP_LOGS_KEY][oldItem.id];
                }
            });
        }

        if (this.initialized) {
            this.putNode(`${PLAYER_OP_LOGS_KEY}/${entry.id}`, entry);
            removedLogs.forEach(oldItem => {
                if (oldItem && oldItem.id) {
                    this.deleteNode(`${PLAYER_OP_LOGS_KEY}/${oldItem.id}`);
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
            const rawSess = String(item.session || '').trim();
            const rawDetail = String(item.matchDetail || '').trim();
            const hasForceProtect = Boolean(
                item.isForceRepaired ||
                rawSess.includes('・強制補齊') ||
                rawDetail.includes('強制補齊')
            );
            const normalizedItem = {
                ...item,
                partnerId: pid,
                partnerName: String(item.partnerName || '').trim(),
                session: rawSess,
                matchedAt: Number(item.matchedAt || 0) || Date.now(),
                igUnlocked: Boolean(item.igUnlocked),
                isForceRepaired: hasForceProtect,
                continueVotes: votes
            };
            if (hasForceProtect && !normalizedItem.matchDetail) {
                normalizedItem.matchDetail = '・強制補齊';
            }
            const prev = byPartner.get(pid);
            if (!prev) {
                byPartner.set(pid, normalizedItem);
            } else {
                const mergedVotes = Array.from(new Set([...(prev.continueVotes || []), ...votes]));
                const mergedForceProtect = Boolean(prev.isForceRepaired || normalizedItem.isForceRepaired);
                const chosenSession = (String(prev.session || '').includes('・強制補齊') ? prev.session : normalizedItem.session) || prev.session;
                const chosenDetail = (String(prev.matchDetail || '').includes('強制補齊') ? prev.matchDetail : normalizedItem.matchDetail) || prev.matchDetail || (mergedForceProtect ? '・強制補齊' : '');
                const mergedObj = {
                    ...prev,
                    ...normalizedItem,
                    partnerName: normalizedItem.partnerName || prev.partnerName,
                    session: chosenSession,
                    matchedAt: Math.min(Number(prev.matchedAt || 0) || Infinity, Number(normalizedItem.matchedAt || 0) || Infinity) || Date.now(),
                    igUnlocked: Boolean(prev.igUnlocked || normalizedItem.igUnlocked),
                    isForceRepaired: mergedForceProtect,
                    continueVotes: mergedVotes
                };
                if (chosenDetail) mergedObj.matchDetail = chosenDetail;
                byPartner.set(pid, mergedObj);
            }
        });

        // 嚴格 1 對 1 場次保護：同一個常規週三／週六單一場次（無 activityId 且非強制配對）每人最多只能配對 1 位對象
        const dedupedList = Array.from(byPartner.values());
        dedupedList.sort((a, b) => Number(a.matchedAt || 0) - Number(b.matchedAt || 0));
        const seenRegularSessionSet = new Set();
        const finalItems = [];
        dedupedList.forEach(entry => {
            const isEntryForceProtected = Boolean(
                entry.isForceRepaired ||
                String(entry.session || '').includes('強制') ||
                String(entry.matchDetail || '').includes('強制')
            );
            if (!entry.activityId && entry.session && !isEntryForceProtected) {
                const normSess = (typeof normalizeSessionLabel === 'function')
                    ? normalizeSessionLabel(entry.session)
                    : String(entry.session).trim();
                if (/^第\s*\d+\s*屆.+\([三六]\)$/.test(normSess)) {
                    if (seenRegularSessionSet.has(normSess)) {
                        return;
                    }
                    seenRegularSessionSet.add(normSess);
                    entry.session = normSess;
                }
            }
            finalItems.push(entry);
        });
        return finalItems;
    },

    reconcileSymmetricMatches(usersArr, autoPersistRepaired = false, options = {}) {
        if (!Array.isArray(usersArr) || usersArr.length === 0) return false;
        const includeChatsRepair = Boolean(options && options.includeChatsRepair);
        if (!this.isBackendContext() && !includeChatsRepair) return false;
        
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
                const baseSessA = String(recInB?.session || userA.matchedSession || userB.matchedSession || '系統補回配對').trim();
                const protSessA = baseSessA.includes('・強制補齊') ? baseSessA : `${baseSessA}・強制補齊`;
                userA.matchedHistory.push({
                    partnerId: idB,
                    partnerName: userB.nickname || idB,
                    session: protSessA,
                    matchedAt: Number(recInB?.matchedAt) || fallbackTs,
                    igUnlocked: Boolean(recInB?.igUnlocked),
                    isForceRepaired: true,
                    matchDetail: '・強制補齊',
                    continueVotes: []
                });
                if (!userA.matchedWithId) {
                    userA.matchedWithId = idB;
                    userA.matchedWithName = userB.nickname || idB;
                    userA.matchedSession = protSessA;
                    userA.matchedAt = Number(recInB?.matchedAt) || fallbackTs;
                }
                changedA = true;
            }

            if (!recInB) {
                const baseSessB = String(recInA?.session || userB.matchedSession || userA.matchedSession || '系統補回配對').trim();
                const protSessB = baseSessB.includes('・強制補齊') ? baseSessB : `${baseSessB}・強制補齊`;
                userB.matchedHistory.push({
                    partnerId: idA,
                    partnerName: userA.nickname || idA,
                    session: protSessB,
                    matchedAt: Number(recInA?.matchedAt) || fallbackTs,
                    igUnlocked: Boolean(recInA?.igUnlocked),
                    isForceRepaired: true,
                    matchDetail: '・強制補齊',
                    continueVotes: []
                });
                if (!userB.matchedWithId) {
                    userB.matchedWithId = idA;
                    userB.matchedWithName = userA.nickname || idA;
                    userB.matchedSession = protSessB;
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
                    const alreadyForceRepairedOnce = Boolean(
                        h.isForceRepaired ||
                        String(h.session || '').includes('・強制補齊') ||
                        String(h.matchDetail || '').includes('強制補齊')
                    );
                    if (alreadyForceRepairedOnce && !includeChatsRepair) {
                        return;
                    }
                    const rawBaseSession = String(h.session || u.matchedSession || '').trim() || '系統補回配對';
                    const protectedSession = rawBaseSession.includes('・強制補齊')
                        ? rawBaseSession
                        : `${rawBaseSession}・強制補齊`;
                    const mirrorEntry = {
                        partnerId: uid,
                        partnerName: String(u.nickname || '').trim(),
                        session: protectedSession,
                        matchedAt: Number(h.matchedAt || u.matchedAt || 0) || Date.now(),
                        igUnlocked: Boolean(h.igUnlocked),
                        isForceRepaired: true,
                        matchDetail: (h.matchDetail && String(h.matchDetail).includes('強制補齊')) ? String(h.matchDetail) : '・強制補齊',
                        continueVotes: Array.isArray(h.continueVotes) ? [...h.continueVotes] : []
                    };
                    if (h.activityId) mirrorEntry.activityId = String(h.activityId);

                    // 同步為持有方補上 ・強制補齊 保護標記，確保雙向受保護不被舊快取覆蓋
                    h.isForceRepaired = true;
                    if (!String(h.session || '').includes('・強制補齊')) {
                        h.session = protectedSession;
                    }
                    if (!h.matchDetail) {
                        h.matchDetail = '・強制補齊';
                    }
                    u.matchedHistory = this.normalizeMatchedHistoryList(uHist);
                    if (String(u.matchedWithId || '').trim() === partnerId && !String(u.matchedSession || '').includes('・強制補齊')) {
                        u.matchedSession = protectedSession;
                    }
                    repairedUsers.set(uid, u);

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
                const nowP = Date.now();
                const lastP = Number(this._persistedSymmetricPairs[pid] || 0);
                if (nowP - lastP > 15000) {
                    this._persistedSymmetricPairs[pid] = nowP;
                    this.upsertUser(repairedUser, true, { isMatchMutation: true });
                }
            }
        });

        return true;
    },

    chatsMapToLocal(raw) {
        const result = {};
        if (!raw || typeof raw !== 'object') return result;
        const isBackend = this.isBackendContext();
        const activePid = isBackend ? '' : this.getActiveFrontendPlayerId();
        // 前台未登入任何玩家 ID 時無需快取全站所有配對聊天室，避免佔用 localStorage 空間
        if (!isBackend && !activePid) return result;

        Object.keys(raw).forEach(pairKey => {
            if (!isBackend && !String(pairKey).split('__').includes(activePid)) {
                return;
            }
            const threadRaw = raw[pairKey];
            const msgs = this.mapToArray(threadRaw);
            msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
            // 同步雲端回本地時，也強制裁切至最近 200 則
            result[pairKey] = msgs.slice(-200);
        });
        return result;
    },

    writeLocalIfChanged(key, nextStr) {
        try {
            if (localStorage.getItem(key) !== nextStr) {
                localStorage.setItem(key, nextStr);
                LocalJsonCache.invalidate(key);
            }
        } catch (e) {
            console.warn('writeLocalIfChanged 寫入失敗（可能超過本地儲存容量）:', key, e);
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

        const customActsSnapshotForFilter = (t[CUSTOM_ACTIVITIES_KEY] !== undefined)
            ? this.mapToArray(t[CUSTOM_ACTIVITIES_KEY])
            : null;

        // 1. 玩家名單（僅在已載入或快取有 yuelao_users 時才覆寫本地清單，避免未抓全庫的後台分頁把名單清空）
        const hasUsersNodeData = Boolean(
            (this.fetchedTopNodes && this.fetchedTopNodes.has(USERS_KEY)) ||
            (t[USERS_KEY] && typeof t[USERS_KEY] === 'object' && Object.keys(t[USERS_KEY]).length > 0) ||
            !this.isBackendContext()
        );
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
            cleanUser.matchedHistory = this.normalizeMatchedHistoryList(cleanUser.matchedHistory)
                .filter(h => !this.isRogueCustomMatchEntry(h, customActsSnapshotForFilter));
            const directWithId = String(cleanUser.matchedWithId || '').trim();
            if (directWithId && directWithId !== String(cleanUser.id || '').trim() && !cleanUser.matchedHistory.some(h => String(h.partnerId) === directWithId)) {
                if (!this.isPairRecentlyUnmatched(cleanUser.id, directWithId)) {
                    const directSessStr = String(cleanUser.matchedSession || '').trim();
                    const isForceDirect = Boolean(directSessStr.includes('・強制補齊'));
                    cleanUser.matchedHistory = this.normalizeMatchedHistoryList([
                        ...cleanUser.matchedHistory,
                        {
                            partnerId: directWithId,
                            partnerName: String(cleanUser.matchedWithName || '').trim(),
                            session: directSessStr,
                            matchedAt: Number(cleanUser.matchedAt || 0) || Date.now(),
                            igUnlocked: false,
                            isForceRepaired: isForceDirect,
                            matchDetail: isForceDirect ? '・強制補齊' : '',
                            continueVotes: []
                        }
                    ]);
                } else {
                    const fallbackH = cleanUser.matchedHistory[cleanUser.matchedHistory.length - 1] || null;
                    cleanUser.matchedSession = fallbackH ? (fallbackH.session || null) : null;
                    cleanUser.matchedWithId = fallbackH ? (fallbackH.partnerId || null) : null;
                    cleanUser.matchedWithName = fallbackH ? (fallbackH.partnerName || null) : null;
                    cleanUser.matchedAt = fallbackH ? (fallbackH.matchedAt || null) : null;
                }
            }
            cleanUser.exactMatchCriteria = (cleanUser.exactMatchCriteria && typeof cleanUser.exactMatchCriteria === 'object' && !Array.isArray(cleanUser.exactMatchCriteria))
                ? cleanUser.exactMatchCriteria
                : {};
            cleanUser.mustMatchKeys = (typeof normalizeMustMatchKeysList === 'function')
                ? normalizeMustMatchKeysList(cleanUser.mustMatchKeys, cleanUser.exactMatchCriteria)
                : this.normalizeStringArray(cleanUser.mustMatchKeys).filter(k => Object.prototype.hasOwnProperty.call(cleanUser.exactMatchCriteria, k)).slice(0, 2);
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
        if (hasUsersNodeData) {
            const canPersistSymmetricRepair = Boolean(this.initialized && this.isBackendContext() && this.inFlightWrites === 0);
            this.reconcileSymmetricMatches(usersArr, canPersistSymmetricRepair);
            const usersForLocalCache = this.isBackendContext()
                ? usersArr
                : usersArr.map(u => {
                    if (!u || typeof u !== 'object') return u;
                    const sanitized = { ...u };
                    delete sanitized.lastSaveIp;
                    delete sanitized.lastSaveIpAt;
                    return sanitized;
                });
            this.writeLocalIfChanged(USERS_LOCAL_KEY, JSON.stringify(usersForLocalCache));
        }
        usersArr.forEach(u => {
            if (u && u.id) {
                this.lastPushedUsersJson[String(u.id)] = JSON.stringify(u);
            }
        });

        // 1b. 活動歷史報名紀錄同步（確保活動結束 3 分鐘自動清除會員「報名場次」後，後台統計人數仍完整保留）
        if (typeof ActivityRegArchive !== 'undefined') {
            ActivityRegArchive.mergeCloudTreeAndUsers(t[REG_HISTORY_KEY], usersArr);
        }

        // 1c. 週三／週六場次配對成功與失敗名單快照同步
        if (t[SESSION_MATCH_RESULTS_KEY] && typeof t[SESSION_MATCH_RESULTS_KEY] === 'object') {
            this.writeLocalIfChanged(SESSION_MATCH_RESULTS_KEY, JSON.stringify(t[SESSION_MATCH_RESULTS_KEY]));
        } else if (t[SESSION_MATCH_RESULTS_KEY] === null && localStorage.getItem(SESSION_MATCH_RESULTS_KEY) !== null) {
            localStorage.removeItem(SESSION_MATCH_RESULTS_KEY);
            LocalJsonCache.invalidate(SESSION_MATCH_RESULTS_KEY);
        }

        // 2. 聊天紀錄（P1：後台改用記憶體快取與 yuelao_chat_meta 摘要，不寫入 localStorage 避免 5MB 容量爆滿；前台維持精簡本地快取）
        if (this.isBackendContext()) {
            if (t[CHAT_META_KEY] !== undefined || t[CHATS_KEY] !== undefined) {
                this.chatsTreeVersion++;
            }
        } else {
            const scopedChatsJson = JSON.stringify(this.chatsMapToLocal(t[CHATS_KEY]));
            this.writeLocalIfChanged(CHATS_KEY, scopedChatsJson);
        }

        // 3. 系統開關與期數設定
        if (t[SYSTEM_STATE_KEY] && typeof t[SYSTEM_STATE_KEY] === 'object') {
            this.writeLocalIfChanged(SYSTEM_STATE_KEY, JSON.stringify(t[SYSTEM_STATE_KEY]));
        } else if (t[SYSTEM_STATE_KEY] === null && localStorage.getItem(SYSTEM_STATE_KEY) !== null) {
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
        if (t[PLAYER_OP_LOGS_KEY] !== undefined) {
            const playerOpArr = this.mapToArray(t[PLAYER_OP_LOGS_KEY]);
            playerOpArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
            this.writeLocalIfChanged(PLAYER_OP_LOGS_KEY, JSON.stringify(playerOpArr.slice(0, PLAYER_OP_LOGS_MAX_COUNT)));
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
                cleanAct.matchSafetyEnabled = Boolean(cleanAct.matchSafetyEnabled);
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
        } else if (t[CUSTOM_ACTIVITIES_KEY] === null) {
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
        } else if (t[FATE_WALL_KEY] === null) {
            this.writeLocalIfChanged(FATE_WALL_KEY, '[]');
        }

        // 14. 紅線祈願牆（女性發起 2 選 1 題目、男女回覆匿名編號、到期後女方選擇配對）
        if (t[WISH_WALL_KEY] !== undefined) {
            const rawWishes = this.mapToArray(t[WISH_WALL_KEY]);
            const normWishes = rawWishes
                .map(w => (typeof normalizeWishWallItem === 'function' ? normalizeWishWallItem(w) : w))
                .filter(Boolean);
            normWishes.sort((a, b) => (typeof compareWishWallItems === 'function')
                ? compareWishWallItems(a, b)
                : (Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0)));
            this.writeLocalIfChanged(WISH_WALL_KEY, JSON.stringify(normWishes));
        } else if (t[WISH_WALL_KEY] === null) {
            this.writeLocalIfChanged(WISH_WALL_KEY, '[]');
        }

        // 15. 討論區文章索引快取同步
        if (t['yuelao_forum_index'] && typeof t['yuelao_forum_index'] === 'object') {
            this.writeLocalIfChanged('yuelao_forum_index', JSON.stringify(t['yuelao_forum_index']));
        } else if (t['yuelao_forum_index'] === null) {
            this.writeLocalIfChanged('yuelao_forum_index', '{}');
        }
    },

    applyStreamPatch(path, data) {
        const cleanPath = String(path || '/').replace(/^\/+|\/+$/g, '');
        if (!cleanPath) {
            this.tree = (data && typeof data === 'object') ? data : {};
            this.hasLoadedFullTree = true;
            this.chatsTreeVersion++;
            return;
        }
        const parts = cleanPath.split('/');
        if (parts[0] === CHATS_KEY || parts[0] === CHAT_META_KEY) {
            this.chatsTreeVersion++;
            if (parts.length >= 3 && this.tree && Array.isArray(this.tree[CHATS_KEY]?.[parts[1]])) {
                const converted = {};
                this.tree[CHATS_KEY][parts[1]].forEach((m, idx) => {
                    if (m && typeof m === 'object') {
                        converted[String(m.id || `IDX_${idx}`)] = m;
                    }
                });
                this.tree[CHATS_KEY][parts[1]] = converted;
            }
        }
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
        if (this.isLocalSandboxMode()) {
            let snapNote = '';
            try {
                const snapAt = localStorage.getItem('yuelao_sandbox_last_snapshot_at') || '';
                if (snapAt) snapNote = `｜已同步 ${snapAt} 快照`;
            } catch (e) {}
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-teal-50 border border-teal-300 text-teal-800 font-bold';
            badge.textContent = `🧪 本地測試模式（純本地儲存・不影響正式環境${snapNote}）`;
            return;
        }
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

    async fetchFullTree(options = {}) {
        if (this.isLocalSandboxMode()) {
            this.hasLoadedFullTree = true;
            return true;
        }
        if (this.inFlightWrites > 0) return false;
        const force = Boolean(options && options.force);
        // 免費方案流量保護：本次工作階段已完整下載過，且 SSE 仍保持資料新鮮時，不重複下載整個資料庫
        if (!force && this.lastFullFetchAt > 0 && (Date.now() - this.lastFullFetchAt) < this.FULL_FETCH_MIN_INTERVAL_MS) {
            return true;
        }
        const epochBefore = this.writeEpoch;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch(`${this.dbUrl}/.json${this.authQuery()}`, {
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
            this.hasLoadedFullTree = true;
            this.lastFullFetchAt = Date.now();
            this.chatsTreeVersion++;
            this.applyTreeToLocalStorage();
            this.updateCloudBadge(true);
            return true;
        } catch (e) {
            clearTimeout(timer);
            this.updateCloudBadge(false);
            return false;
        }
    },

    isRelevantStreamEvent(eventType, payload) {
        if (this.isBackendContext()) return true;
        if (!payload || !payload.path) return true;
        const cleanPath = String(payload.path || '/').replace(/^\/+|\/+$/g, '');
        if (!cleanPath) return true;
        const parts = cleanPath.split('/');
        const topNode = parts[0];

        // 後台專用日誌與內部排程節點不影響前台畫面，略過重繪
        if (
            topNode === 'yuelao_admin_login_logs' ||
            topNode === 'yuelao_inactive_chat_purge_logs' ||
            topNode === PLAYER_OP_LOGS_KEY ||
            topNode === MATCH_LOGS_KEY ||
            topNode === REG_HISTORY_KEY ||
            topNode === SESSION_MATCH_RESULTS_KEY ||
            topNode === FORCE_KEY ||
            topNode === AUTO_RUN_LOG_KEY
        ) {
            return false;
        }

        // 前台只關注與自己有關的聊天室事件，忽略其他 99 位玩家的私密對話推播
        if (topNode === CHATS_KEY && parts.length >= 2) {
            const activePid = this.getActiveFrontendPlayerId();
            if (!activePid) return false;
            return String(parts[1]).split('__').includes(activePid);
        }

        return true;
    },

    scheduleStreamFlush(delayMs = 180) {
        if (this.streamFlushTimer) return;
        this.streamFlushTimer = setTimeout(() => {
            this.streamFlushTimer = null;
            if (this.inFlightWrites > 0) {
                this.scheduleStreamFlush(120);
                return;
            }
            this.applyTreeToLocalStorage();
            if (typeof this.onUpdateCallback === 'function') {
                this.onUpdateCallback();
            }
        }, delayMs);
    },

    FULL_FETCH_MIN_INTERVAL_MS: 60000,
    MAX_SCOPED_RESYNC_PATHS: 20,
    lastFullFetchAt: 0,
    sseHadError: false,
    pendingFullResync: false,
    flushingDirty: false,
    dirtyStreamPaths: null,

    settleInFlightWrite() {
        this.inFlightWrites = Math.max(0, this.inFlightWrites - 1);
        if (this.inFlightWrites === 0) this.flushDirtyStreamPaths();
    },

    queueDirtyStreamEvent(e) {
        if (!this.dirtyStreamPaths) this.dirtyStreamPaths = new Set();
        try {
            const payload = JSON.parse(e.data);
            const base = String((payload && payload.path) || '/').replace(/^\/+|\/+$/g, '');
            const isPatchMap = e.type === 'patch' && payload && payload.data && typeof payload.data === 'object';
            if (!base) {
                if (isPatchMap) {
                    Object.keys(payload.data).forEach(k => this.dirtyStreamPaths.add(k));
                } else {
                    this.pendingFullResync = true;
                }
            } else if (isPatchMap) {
                Object.keys(payload.data).forEach(k => this.dirtyStreamPaths.add(`${base}/${k}`));
            } else {
                this.dirtyStreamPaths.add(base);
            }
        } catch (err) {
            this.pendingFullResync = true;
        }
    },

    async fetchNodeIntoTree(path) {
        // 回傳 true（成功）、false（網路失敗）或 'raced'（期間有本地寫入，結果不可信）
        const epochBefore = this.writeEpoch;
        try {
            const res = await fetch(`${this.dbUrl}/${this.encodePath(path)}.json${this.authQuery()}`, {
                method: 'GET',
                cache: 'no-store'
            });
            if (!res.ok) return false;
            const data = await res.json();
            if (this.inFlightWrites > 0 || this.writeEpoch !== epochBefore) return 'raced';
            this.applyStreamPatch(path, data);
            return true;
        } catch (e) {
            return false;
        }
    },

    flushDirtyStreamPaths() {
        if (!this.dirtyStreamPaths) this.dirtyStreamPaths = new Set();
        if (this.inFlightWrites > 0 || this.flushingDirty) return;
        const needsFull = this.pendingFullResync === true;
        const dirty = Array.from(this.dirtyStreamPaths);
        if (!needsFull && dirty.length === 0) return;
        this.pendingFullResync = false;
        this.dirtyStreamPaths.clear();
        this.flushingDirty = true;
        const finish = (ok) => {
            this.flushingDirty = false;
            if (ok && typeof this.onUpdateCallback === 'function') this.onUpdateCallback();
        };
        if (needsFull || dirty.length > this.MAX_SCOPED_RESYNC_PATHS) {
            this.fetchFullTree({ force: needsFull }).then(finish);
            return;
        }
        Promise.all(dirty.map(p => this.fetchNodeIntoTree(p))).then(results => {
            let retryLater = false;
            results.forEach((r, i) => {
                if (r === 'raced') {
                    this.dirtyStreamPaths.add(dirty[i]);
                    retryLater = true;
                } else if (r === false) {
                    this.pendingFullResync = true;
                    retryLater = true;
                }
            });
            this.flushingDirty = false;
            if (results.some(r => r === true) && typeof this.onUpdateCallback === 'function') {
                this.onUpdateCallback();
            }
            if (retryLater) {
                setTimeout(() => this.flushDirtyStreamPaths(), 1500);
            }
        });
    },

    // ===================== 方案 C：前後台省流混合同步（閒置降頻 + 跨頁 ETag 快取 + 後台按頁讀取） =====================
    PLAYER_SYNC_ENABLED: true,
    PLAYER_HOT_NODES: ['yuelao_user_index', 'yuelao_mailbox', 'yuelao_wish_wall', 'yuelao_fate_wall', 'yuelao_system_batch', 'yuelao_custom_activities'],
    PLAYER_COLD_NODES: ['yuelao_reports', 'yuelao_banned_rules', 'yuelao_unmatched_pairs'],
    PLAYER_HOT_INTERVAL_MS: 75000,   // P2：熱門節點每 75 秒 + 隨機抖動檢查一次
    PLAYER_COLD_INTERVAL_MS: 240000, // 冷門節點每 4 分鐘檢查一次（3~5 分鐘區間）
    PLAYER_IDLE_TIMEOUT_MS: 180000,  // 超過 3 分鐘無滑動／點擊／輸入即自動暫停輪詢
    BACKEND_POLL_INTERVAL_MS: 60000, // P2：後台僅輪詢當前頁面所需節點，每 60 秒檢查一次
    BACKEND_IDLE_TIMEOUT_MS: 300000, // 後台超過 5 分鐘無操作自動暫停輪詢
    PLAYER_LONG_IDLE_RELOAD_MS: 900000, // 前台超過 15 分鐘未操作，回來時自動重整回首頁
    ETAG_STORAGE_KEY: 'yuelao_cloud_etags_v1',
    etagCache: null,
    fetchedTopNodes: null,
    activeRoomPath: '',
    _pausedRoomPath: '',
    _hiddenRoomPath: '',
    activeRoomEs: null,
    activeRoomFallbackTimer: null,
    playerTimersStarted: false,
    lastUserActivityAt: Date.now(),
    isPlayerIdlePaused: false,
    activityWatchersBound: false,

    bindActivityWatchers() {
        if (this.activityWatchersBound || typeof window === 'undefined') return;
        this.activityWatchersBound = true;
        this.lastUserActivityAt = Date.now();
        let lastScrollMark = 0;

        const onUserActivity = (evt) => {
            const now = Date.now();
            if (evt && evt.type === 'scroll' && (now - lastScrollMark) < 1000) {
                return;
            }
            if (evt && evt.type === 'scroll') lastScrollMark = now;
            const prevActivityAt = Number(this.lastUserActivityAt || now);
            this.lastUserActivityAt = now;

            if (this.isPlayerIdlePaused) {
                this.isPlayerIdlePaused = false;
                if (this.isBackendContext()) {
                    this.pollBackendLight();
                } else if (this.isPlayerSyncMode()) {
                    const idleDuration = now - prevActivityAt;
                    const isEditingDraft = (typeof hasUnsavedProfileDraft !== 'undefined' && hasUnsavedProfileDraft);
                    const hasForumInput = (typeof document !== 'undefined' && document.getElementById('forumPostContent') && document.getElementById('forumPostContent').value.trim());
                    const hasChatInput = (typeof document !== 'undefined' && document.getElementById('chatInput') && document.getElementById('chatInput').value.trim());
                    
                    // 若超過 15 分鐘長閒置，且無未存草稿或打到一半的字，直接重整並切回首頁
                    if (idleDuration >= this.PLAYER_LONG_IDLE_RELOAD_MS && !isEditingDraft && !hasForumInput && !hasChatInput) {
                        if (typeof window !== 'undefined' && window.location) {
                            window.location.href = 'index.html';
                            return;
                        }
                    }
                    
                    this.pollPlayerHot();
                    if (this._pausedRoomPath) {
                        const resumeRoom = this._pausedRoomPath;
                        this._pausedRoomPath = '';
                        this.setActiveChatRoom(resumeRoom);
                    }
                }
            }
        };

        ['scroll', 'click', 'touchstart', 'pointerdown', 'keydown'].forEach(evtName => {
            window.addEventListener(evtName, onUserActivity, { passive: true, capture: true });
        });
    },

    isUserIdleNow(timeoutMs) {
        const limit = Number(timeoutMs) || this.PLAYER_IDLE_TIMEOUT_MS;
        return (Date.now() - Number(this.lastUserActivityAt || 0)) >= limit;
    },

    loadPersistedEtags() {
        if (this.etagCache && typeof this.etagCache === 'object') return this.etagCache;
        try {
            const raw = localStorage.getItem(this.ETAG_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            this.etagCache = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
        } catch (e) {
            this.etagCache = {};
        }
        return this.etagCache;
    },

    savePersistedEtags() {
        if (!this.etagCache) return;
        try {
            localStorage.setItem(this.ETAG_STORAGE_KEY, JSON.stringify(this.etagCache));
        } catch (e) {}
    },

    invalidatePersistedEtag(path) {
        const clean = String(path || '').replace(/^\/+|\/+$/g, '');
        if (!clean) return;
        const topNode = clean.split('/')[0];
        const cache = this.loadPersistedEtags();
        let changed = false;
        Object.keys(cache).forEach(k => {
            const baseK = String(k).split('::')[0];
            if (baseK === clean || baseK === topNode || baseK.startsWith(clean + '/') || clean.startsWith(baseK + '/')) {
                delete cache[k];
                changed = true;
            }
        });
        if (changed) this.savePersistedEtags();
    },

    hydrateTreeFromLocalStorage() {
        if (!this.tree || typeof this.tree !== 'object') this.tree = {};
        if (!this.fetchedTopNodes) this.fetchedTopNodes = new Set();

        const hydrateArrayById = (lsKey, treeKey, idField = 'id') => {
            try {
                const raw = localStorage.getItem(lsKey);
                if (raw === null) return false;
                const arr = JSON.parse(raw);
                if (!Array.isArray(arr)) return false;
                const mapObj = {};
                arr.forEach((item, idx) => {
                    if (item && typeof item === 'object') {
                        const k = String(item[idField] || `IDX_${idx}`);
                        mapObj[k] = item;
                    }
                });
                this.tree[treeKey] = mapObj;
                return true;
            } catch (e) {
                return false;
            }
        };

        const hydrateObjectDirect = (lsKey, treeKey) => {
            try {
                const raw = localStorage.getItem(lsKey);
                if (raw === null) return false;
                const obj = JSON.parse(raw);
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
                this.tree[treeKey] = obj;
                return true;
            } catch (e) {
                return false;
            }
        };

        if (hydrateArrayById(USERS_LOCAL_KEY, USERS_KEY)) {
            this.fetchedTopNodes.add(USERS_KEY);
        }
        const chatsStorageKey = this.isBackendContext() ? ADMIN_CHATS_KEY : CHATS_KEY;
        if (hydrateObjectDirect(chatsStorageKey, CHATS_KEY)) {
            this.fetchedTopNodes.add(CHATS_KEY);
            if (!this.isBackendContext() && this.tree[CHATS_KEY] && typeof this.tree[CHATS_KEY] === 'object') {
                Object.keys(this.tree[CHATS_KEY]).forEach(pk => {
                    const rawThread = this.tree[CHATS_KEY][pk];
                    if (Array.isArray(rawThread)) {
                        const keyedMap = {};
                        rawThread.forEach((m, idx) => {
                            if (m && typeof m === 'object') {
                                keyedMap[String(m.id || `IDX_${idx}`)] = m;
                            }
                        });
                        this.tree[CHATS_KEY][pk] = keyedMap;
                    }
                });
            }
            if (this.isBackendContext() && !this.tree[CHAT_META_KEY] && this.tree[CHATS_KEY]) {
                const synthesizedMeta = {};
                Object.keys(this.tree[CHATS_KEY]).forEach(pk => {
                    const msgs = this.mapToArray(this.tree[CHATS_KEY][pk]).sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
                    if (msgs.length > 0) {
                        const lm = msgs[msgs.length - 1];
                        synthesizedMeta[pk] = { lastMsg: lm, lastTs: Number(lm.ts || 0), msgCount: msgs.length };
                    }
                });
                this.tree[CHAT_META_KEY] = synthesizedMeta;
            }
        }
        if (hydrateObjectDirect(SYSTEM_STATE_KEY, SYSTEM_STATE_KEY)) {
            this.fetchedTopNodes.add(SYSTEM_STATE_KEY);
        }
        if (hydrateArrayById(MAILBOX_KEY, MAILBOX_KEY)) {
            this.fetchedTopNodes.add(MAILBOX_KEY);
        }
        if (hydrateArrayById(REPORTS_KEY, REPORTS_KEY)) {
            this.fetchedTopNodes.add(REPORTS_KEY);
        }
        if (hydrateArrayById(BANNED_RULES_KEY, BANNED_RULES_KEY)) {
            this.fetchedTopNodes.add(BANNED_RULES_KEY);
        }
        if (hydrateArrayById(FORCE_KEY, FORCE_KEY)) {
            this.fetchedTopNodes.add(FORCE_KEY);
        }
        if (hydrateObjectDirect(AUTO_RUN_LOG_KEY, AUTO_RUN_LOG_KEY)) {
            this.fetchedTopNodes.add(AUTO_RUN_LOG_KEY);
        }
        if (hydrateArrayById(MATCH_LOGS_KEY, MATCH_LOGS_KEY)) {
            this.fetchedTopNodes.add(MATCH_LOGS_KEY);
        }
        if (hydrateArrayById(PLAYER_OP_LOGS_KEY, PLAYER_OP_LOGS_KEY)) {
            this.fetchedTopNodes.add(PLAYER_OP_LOGS_KEY);
        }
        if (hydrateObjectDirect(ID_COUNTER_KEY, ID_COUNTER_KEY)) {
            this.fetchedTopNodes.add(ID_COUNTER_KEY);
        }
        if (hydrateArrayById(CUSTOM_ACTIVITIES_KEY, CUSTOM_ACTIVITIES_KEY)) {
            this.fetchedTopNodes.add(CUSTOM_ACTIVITIES_KEY);
        }
        if (hydrateObjectDirect(REG_HISTORY_KEY, REG_HISTORY_KEY)) {
            this.fetchedTopNodes.add(REG_HISTORY_KEY);
        }
        if (hydrateObjectDirect(SESSION_MATCH_RESULTS_KEY, SESSION_MATCH_RESULTS_KEY)) {
            this.fetchedTopNodes.add(SESSION_MATCH_RESULTS_KEY);
        }
        if (hydrateArrayById(FATE_WALL_KEY, FATE_WALL_KEY)) {
            this.fetchedTopNodes.add(FATE_WALL_KEY);
        }
        if (hydrateArrayById(WISH_WALL_KEY, WISH_WALL_KEY)) {
            this.fetchedTopNodes.add(WISH_WALL_KEY);
        }
        if (hydrateArrayById('yuelao_admin_login_logs', 'yuelao_admin_login_logs')) {
            this.fetchedTopNodes.add('yuelao_admin_login_logs');
        }
        if (hydrateObjectDirect(UNMATCHED_PAIRS_SYNC_KEY, UNMATCHED_PAIRS_CLOUD_NODE)) {
            this.fetchedTopNodes.add(UNMATCHED_PAIRS_CLOUD_NODE);
        }
        if (hydrateObjectDirect('yuelao_forum_index', 'yuelao_forum_index')) {
            this.fetchedTopNodes.add('yuelao_forum_index');
        }
    },

    hasLocalCacheForPath(path) {
        const clean = String(path || '').replace(/^\/+|\/+$/g, '');
        if (!clean) return false;
        const parts = clean.split('/');
        const top = parts[0];
        if (!this.tree || this.tree[top] === undefined) return false;
        if (parts.length === 1) return true;
        let curr = this.tree[top];
        for (let i = 1; i < parts.length; i++) {
            if (!curr || typeof curr !== 'object' || curr[parts[i]] === undefined) return false;
            curr = curr[parts[i]];
        }
        if (top === CHATS_KEY && parts.length === 2) {
            if (!curr || typeof curr !== 'object' || Object.keys(curr).length === 0) return false;
        }
        return true;
    },

    getBackendPageKey() {
        if (typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.adminPage) {
            return String(document.body.dataset.adminPage).trim();
        }
        if (typeof window !== 'undefined' && window.location) {
            const p = String(window.location.pathname || '').toLowerCase();
            if (p.includes('backend-home')) return 'home';
            if (p.includes('backend-activities')) return 'activities';
            if (p.includes('backend-chats')) return 'chats';
            if (p.includes('backend-forum')) return 'forum';
            if (p.includes('backend-ops')) return 'ops';
            if (p.includes('backend-logs')) return 'logs';
        }
        return 'member';
    },

    getBackendPageNodes(pageKey = null) {
        const key = pageKey || this.getBackendPageKey();
        if (key === 'home') {
            return []; // 純文字首頁：0 資料庫讀取，完全不下載會員或聊天資料
        }
        if (key === 'forum') {
            return []; // 討論區管理頁：不下載全站會員資料，改由討論區模組按需讀取輕量索引
        }
        if (key === 'member') {
            return [USERS_KEY, SYSTEM_STATE_KEY, FORCE_KEY, UNMATCHED_PAIRS_CLOUD_NODE, ID_COUNTER_KEY, CUSTOM_ACTIVITIES_KEY];
        }
        if (key === 'activities') {
            return [USERS_KEY, CUSTOM_ACTIVITIES_KEY, REG_HISTORY_KEY, SESSION_MATCH_RESULTS_KEY, SYSTEM_STATE_KEY, FORCE_KEY, UNMATCHED_PAIRS_CLOUD_NODE];
        }
        if (key === 'chats') {
            return [CHAT_META_KEY, USER_INDEX_KEY];
        }
        if (key === 'ops') {
            return [MAILBOX_KEY, REPORTS_KEY, FATE_WALL_KEY, BANNED_RULES_KEY, SYSTEM_STATE_KEY, USER_INDEX_KEY, FORCE_KEY];
        }
        if (key === 'logs') {
            return [PLAYER_OP_LOGS_KEY, WISH_WALL_KEY, MATCH_LOGS_KEY, 'yuelao_admin_login_logs'];
        }
        return [USERS_KEY, SYSTEM_STATE_KEY];
    },

    async ensureBackendNodes(paths = []) {
        if (this.isLocalSandboxMode()) return true;
        const unique = Array.from(new Set((paths || []).filter(Boolean)));
        if (unique.length === 0) return true;
        if (!this.fetchedTopNodes) this.fetchedTopNodes = new Set();
        const results = await Promise.all(unique.map(p => {
            const top = String(p).split('/')[0];
            // 強制檢查：若為重要節點且本地快取為空物件（曾因配額或異常清除），強迫重抓
            const isCriticalEmpty = (top === USERS_KEY || top === CHATS_KEY) && 
                (!this.tree[top] || Object.keys(this.tree[top]).length === 0);
            return this.conditionalGetNode(p, { force: isCriticalEmpty }).then(r => ({ p, r }));
        }));
        let changed = false;
        results.forEach(({ p, r }) => {
            const top = String(p).split('/')[0];
            if (r.status === 'changed') {
                this.applyStreamPatch(p, r.data);
                this.fetchedTopNodes.add(top);
                changed = true;
            } else if (r.status === 'unchanged') {
                this.fetchedTopNodes.add(top);
            }
        });
        if (unique.includes(CHATS_KEY) || unique.includes(CHAT_META_KEY)) {
            this.hasLoadedFullTree = true;
        }
        if (changed) {
            this.applyTreeToLocalStorage();
            if (typeof this.onUpdateCallback === 'function') this.onUpdateCallback();
        }
        return true;
    },

    isPlayerSyncMode() {
        if (this.isBackendContext()) return false;
        // 緊急回退：網址加上 ?syncMode=off 可改回舊版完整下載模式（除錯用）
        try {
            if (typeof window !== 'undefined' && window.location
                && new URLSearchParams(window.location.search).get('syncMode') === 'off') return false;
        } catch (e) {}
        if (this.PLAYER_SYNC_ENABLED === true) return true;
        // 測試用：網址加上 ?syncMode=c 即啟用（不影響其他使用者）
        try {
            return typeof window !== 'undefined' && window.location
                && new URLSearchParams(window.location.search).get('syncMode') === 'c';
        } catch (e) {
            return false;
        }
    },

    syncStats: { notModified: 0, bodies: 0, bodyBytes: 0, errors: 0, startedAt: 0 },

    logSyncStats() {
        const s = this.syncStats;
        console.info('[syncMode=c] 304 次數:', s.notModified, '｜ 下載次數:', s.bodies,
            '｜ 下載位元組:', s.bodyBytes, '｜ 錯誤:', s.errors,
            '｜ 統計開始:', s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : '-');
    },

    async conditionalGetNode(path, options = {}) {
        if (this.isLocalSandboxMode()) return { status: 'unchanged' };
        // 以跨頁持久化 ETag 條件式讀取：資料未變動時 Firebase 回 304 且無內容，0 位元組下載流量
        const cache = this.loadPersistedEtags();
        const epochBefore = this.writeEpoch;
        const headers = { 'X-Firebase-ETag': 'true' };
        let queryParams = '';
        let etagCacheKey = path;
        let chatLimitMode = 0;
        if (path.startsWith(CHATS_KEY + '/') && !this.isBackendContext()) {
            chatLimitMode = Number(options.limit) || (path === this.activeRoomPath ? 50 : 1);
            queryParams = `orderBy="ts"&limitToLast=${chatLimitMode}`;
            etagCacheKey = `${path}::last${chatLimitMode}`;
        }
        if (!options.force && cache[etagCacheKey] && this.hasLocalCacheForPath(path)) {
            headers['If-None-Match'] = cache[etagCacheKey];
        }
        try {
            const aq = this.authQuery();
            let finalUrl = `${this.dbUrl}/${this.encodePath(path)}.json`;
            if (aq || queryParams) {
                finalUrl += (aq ? aq : '?') + (aq && queryParams ? '&' + queryParams : queryParams);
            }
            const res = await fetch(finalUrl, {
                method: 'GET',
                headers,
                cache: 'no-store'
            });
            if (this.inFlightWrites > 0 || this.writeEpoch !== epochBefore) return { status: 'raced' };
            if (!this.syncStats.startedAt) this.syncStats.startedAt = Date.now();
            if (res.status === 304) {
                this.syncStats.notModified++;
                return { status: 'unchanged' };
            }
            if ((res.status === 401 || res.status === 403) && !options._retriedAuth) {
                await this.refreshAuthForRetry();
                return this.conditionalGetNode(path, { ...options, _retriedAuth: true });
            }
            if (!res.ok) {
                this.syncStats.errors++;
                return { status: 'error' };
            }
            const etag = res.headers.get('ETag');
            const text = await res.text();
            this.syncStats.bodies++;
            this.syncStats.bodyBytes += text.length;
            const data = text ? JSON.parse(text) : null;
            if (etag) {
                cache[etagCacheKey] = etag;
            } else {
                delete cache[etagCacheKey];
            }
            this.savePersistedEtags();
            return { status: 'changed', data, _chatLimitMode: chatLimitMode };
        } catch (e) {
            this.syncStats.errors++;
            return { status: 'error' };
        }
    },

    playerSelfId() {
        return (typeof appState !== 'undefined' && appState && appState.playerId) ? String(appState.playerId) : '';
    },

    // 玩家端高頻輪詢的動態節點：本人私有記錄（好友清單 tab 開啟時一併檢查非當前聊天室）
    playerHotDynamicPaths(includeAllChats = false) {
        const me = this.playerSelfId();
        if (!me) return [];
        const paths = [`${USERS_KEY}/${me}`];
        const isFriendsTabOpen = (typeof document !== 'undefined')
            ? Boolean(document.getElementById('tab-friends') && !document.getElementById('tab-friends').classList.contains('hidden'))
            : false;
        if (includeAllChats || isFriendsTabOpen) {
            const rec = this.tree && this.tree[USERS_KEY] ? this.tree[USERS_KEY][me] : null;
            this.partnerIdsOf(rec).forEach(partnerId => {
                const pk = this.pairKeyOf(me, partnerId);
                paths.push(`${CHATS_KEY}/${pk}`);
            });
        }
        return paths;
    },

    // 玩家端低頻輪詢的動態節點（每 4 分鐘）：好友公開資料快照與 IG 解鎖節點
    playerColdDynamicPaths() {
        const me = this.playerSelfId();
        if (!me) return [];
        const paths = [];
        const rec = this.tree && this.tree[USERS_KEY] ? this.tree[USERS_KEY][me] : null;
        this.partnerIdsOf(rec).forEach(partnerId => {
            const pk = this.pairKeyOf(me, partnerId);
            paths.push(`${PAIR_PROFILES_KEY}/${pk}/${partnerId}`);
            paths.push(`${PAIR_IG_KEY}/${pk}/${partnerId}`);
        });
        return paths;
    },

    // 玩家端完整動態節點（初次載入與手動刷新時使用）
    playerDynamicPaths() {
        return [...this.playerHotDynamicPaths(true), ...this.playerColdDynamicPaths()];
    },

    // 把索引、好友卡片快照、配對 IG 與本人私有記錄合併成與原本相同形狀的 tree[USERS_KEY]，
    // 讓既有前端程式碼（人數統計、好友卡片、性別上限）不需要改動。
    composePlayerUsers() {
        const t = this.tree || {};
        const idx = t[USER_INDEX_KEY] && typeof t[USER_INDEX_KEY] === 'object' ? t[USER_INDEX_KEY] : {};
        const me = this.playerSelfId();
        const out = {};
        Object.keys(idx).forEach(pid => { out[pid] = { ...idx[pid] }; });
        const selfRaw = me && t[USERS_KEY] && t[USERS_KEY][me] && typeof t[USERS_KEY][me] === 'object'
            ? t[USERS_KEY][me] : null;
        this.partnerIdsOf(selfRaw).forEach(partnerId => {
            const pk = this.pairKeyOf(me, partnerId);
            const prof = t[PAIR_PROFILES_KEY] && t[PAIR_PROFILES_KEY][pk] ? t[PAIR_PROFILES_KEY][pk][partnerId] : null;
            const igNode = t[PAIR_IG_KEY] && t[PAIR_IG_KEY][pk] ? t[PAIR_IG_KEY][pk][partnerId] : null;
            const merged = { ...(out[partnerId] || {}), ...(prof && typeof prof === 'object' ? prof : {}) };
            if (igNode && igNode.ig) merged.ig = igNode.ig; else delete merged.ig;
            if (Object.keys(merged).length) out[partnerId] = merged;
        });
        if (me && selfRaw) {
            out[me] = { ...(out[me] || {}), ...selfRaw };
        }
        this.tree[USERS_KEY] = out;
    },

    // 登入或同步時，為本人補寫索引與配對節點（涵蓋祈願牆等由對方發起、本人無法代寫的配對）
    async ensurePlayerDerivedNodes() {
        const me = this.playerSelfId();
        const rec = me && this.tree && this.tree[USERS_KEY] ? this.tree[USERS_KEY][me] : null;
        if (!rec) return 0;
        return this.syncDerivedNodesFor(me, rec, { bothSides: false });
    },

    mergeChatRoomSnapshot(roomPath, data, limitMode = 50) {
        const clean = String(roomPath || '').replace(/^\/+|\/+$/g, '');
        const parts = clean.split('/');
        if (parts[0] !== CHATS_KEY || !parts[1]) {
            this.applyStreamPatch(roomPath, data);
            return true;
        }
        const pairKey = parts[1];
        if (!this.tree) this.tree = {};
        if (!this.tree[CHATS_KEY] || typeof this.tree[CHATS_KEY] !== 'object') {
            this.tree[CHATS_KEY] = {};
        }

        if (data === null) {
            const hadAny = Boolean(this.tree[CHATS_KEY][pairKey] && Object.keys(this.tree[CHATS_KEY][pairKey]).length > 0);
            this.tree[CHATS_KEY][pairKey] = {};
            this.chatsTreeVersion++;
            return hadAny;
        }

        if (!data || typeof data !== 'object') return false;

        let existing = this.tree[CHATS_KEY][pairKey];
        if (Array.isArray(existing)) {
            const converted = {};
            existing.forEach((m, idx) => {
                if (m && typeof m === 'object') {
                    converted[String(m.id || `IDX_${idx}`)] = m;
                }
            });
            existing = converted;
        } else if (!existing || typeof existing !== 'object') {
            existing = {};
        }

        let hasNewOrUpdated = false;
        Object.entries(data).forEach(([k, msgObj]) => {
            if (!msgObj || typeof msgObj !== 'object') return;
            const msgKey = String(msgObj.id || k);
            const prev = existing[msgKey];
            if (!prev || prev.text !== msgObj.text || Number(prev.ts || 0) !== Number(msgObj.ts || 0)) {
                hasNewOrUpdated = true;
            }
            existing[msgKey] = msgObj;
        });

        const sortedEntries = Object.entries(existing)
            .filter(([, m]) => m && typeof m === 'object')
            .sort((a, b) => Number(a[1].ts || 0) - Number(b[1].ts || 0));
        const trimmedMap = {};
        sortedEntries.slice(-200).forEach(([k, m]) => {
            trimmedMap[k] = m;
        });
        this.tree[CHATS_KEY][pairKey] = trimmedMap;
        this.chatsTreeVersion++;

        // 若背景以 limit=1 發現該聊天室有新訊息，清除 ::last50 ETag，確保玩家點開該房時必抓取完整最新 50 則
        if (Number(limitMode) === 1 && hasNewOrUpdated) {
            const cache = this.loadPersistedEtags();
            const fullKey = `${clean}::last50`;
            if (cache[fullKey]) {
                delete cache[fullKey];
                this.savePersistedEtags();
            }
        }

        return hasNewOrUpdated;
    },

    async fetchPlayerPaths(paths) {
        const unique = Array.from(new Set((paths || []).filter(Boolean)));
        await Promise.all(unique.map(p => this.conditionalGetNode(p).then(r => {
            if (r.status === 'changed') {
                if (p.startsWith(CHATS_KEY + '/') && !this.isBackendContext()) {
                    this.mergeChatRoomSnapshot(p, r.data, r._chatLimitMode || 1);
                } else {
                    this.applyStreamPatch(p, r.data);
                }
            }
        })));
    },

    async pollPlayerNodes(paths) {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (this.inFlightWrites > 0) return;
        if (this.isUserIdleNow(this.PLAYER_IDLE_TIMEOUT_MS)) {
            this.isPlayerIdlePaused = true;
            if (this.activeRoomEs && this.activeRoomPath) {
                this._pausedRoomPath = this.activeRoomPath;
                this.closeActiveChatRoom();
            }
            return;
        }
        const unique = Array.from(new Set(paths.filter(Boolean)));
        const results = await Promise.all(unique.map(p => this.conditionalGetNode(p).then(r => ({ p, r }))));
        let changed = false;
        results.forEach(({ p, r }) => {
            if (r.status === 'changed') {
                if (p.startsWith(CHATS_KEY + '/') && !this.isBackendContext()) {
                    if (this.mergeChatRoomSnapshot(p, r.data, r._chatLimitMode || 1)) {
                        changed = true;
                    }
                } else {
                    this.applyStreamPatch(p, r.data);
                    changed = true;
                }
            }
        });
        if (changed) {
            this.composePlayerUsers();
            this.chatsTreeVersion++;
            this.applyTreeToLocalStorage();
            if (typeof this.onUpdateCallback === 'function') this.onUpdateCallback();
        }
    },

    playerRoomPaths() {
        const me = (typeof appState !== 'undefined' && appState && appState.playerId) ? String(appState.playerId) : '';
        if (!me || !this.tree || !this.tree[USERS_KEY]) return [];
        const user = this.tree[USERS_KEY][me];
        const partners = new Set();
        (user && Array.isArray(user.matchedHistory) ? user.matchedHistory : []).forEach(h => {
            if (h && h.partnerId) partners.add(String(h.partnerId));
        });
        return Array.from(partners).map(pid => `${CHATS_KEY}/${ChatStore.getPairKey(me, pid)}`);
    },

    pollPlayerHot() {
        const dyn = this.playerHotDynamicPaths(false).filter(p => p !== this.activeRoomPath);
        return this.pollPlayerNodes([...this.PLAYER_HOT_NODES, ...dyn]);
    },

    pollPlayerCold() {
        const coldDyn = [
            ...this.playerColdDynamicPaths(),
            ...this.playerHotDynamicPaths(true).filter(p => p.startsWith(`${CHATS_KEY}/`) && p !== this.activeRoomPath)
        ];
        return this.pollPlayerNodes([...this.PLAYER_COLD_NODES, ...coldDyn]);
    },

    startPlayerTimers() {
        if (this.playerTimersStarted) return;
        this.playerTimersStarted = true;
        this.bindActivityWatchers();
        setInterval(() => this.logSyncStats(), 60000);
        const loopHot = () => {
            if (!this.isPlayerIdlePaused) this.pollPlayerHot();
            const jitter = Math.floor(Math.random() * 15000);
            setTimeout(loopHot, this.PLAYER_HOT_INTERVAL_MS + jitter);
        };
        setTimeout(loopHot, this.PLAYER_HOT_INTERVAL_MS);
        setInterval(() => this.pollPlayerCold(), this.PLAYER_COLD_INTERVAL_MS);
    },

    async fetchActiveChatRoomNow(roomPath, options = {}) {
        if (!roomPath || this.isLocalSandboxMode() || !this.isPlayerSyncMode()) return false;
        if (this.inFlightWrites > 0) return false;
        const r = await this.conditionalGetNode(roomPath, { limit: 50, force: Boolean(options.force) });
        if (r.status === 'changed') {
            const changed = this.mergeChatRoomSnapshot(roomPath, r.data, 50);
            this.applyTreeToLocalStorage();
            if (changed && typeof this.onUpdateCallback === 'function') {
                this.onUpdateCallback();
            }
            return changed;
        }
        return false;
    },

    _startActiveRoomFallbackPoll(roomPath) {
        if (this.activeRoomFallbackTimer) return;
        this.activeRoomFallbackTimer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            if (this.isPlayerIdlePaused || this.activeRoomPath !== roomPath) return;
            this.fetchActiveChatRoomNow(roomPath);
        }, 6000);
    },

    _stopActiveRoomFallbackPoll() {
        if (this.activeRoomFallbackTimer) {
            clearInterval(this.activeRoomFallbackTimer);
            this.activeRoomFallbackTimer = null;
        }
    },

    setActiveChatRoom(roomPath) {
        if (this.isLocalSandboxMode()) return;
        // 只對「目前開啟的單一聊天室」建立 SSE 並立即拉取最新 50 則；切換聊天室或分頁隱藏時關閉
        if (!this.isPlayerSyncMode()) return;
        if (this.isPlayerIdlePaused) {
            this._pausedRoomPath = roomPath || '';
            return;
        }
        if (roomPath === this.activeRoomPath && this.activeRoomEs) return;
        this.closeActiveChatRoom();
        if (!roomPath) return;
        this.activeRoomPath = roomPath;

        // 無論手機瀏覽器 SSE 是否順暢，切入或重新進入聊天室時立即主動以 ETag 拉取最新 50 則
        this.fetchActiveChatRoomNow(roomPath);

        if (typeof EventSource === 'undefined') {
            this._startActiveRoomFallbackPoll(roomPath);
            return;
        }
        const handler = (e) => {
            try {
                const payload = JSON.parse(e.data);
                if (!payload) return;
                const rel = String(payload.path || '/').replace(/^\/+|\/+$/g, '');
                if (!rel) {
                    this.mergeChatRoomSnapshot(roomPath, payload.data, 50);
                } else {
                    const base = `${roomPath}/${rel}`;
                    if (e.type === 'patch' && payload.data && typeof payload.data === 'object') {
                        Object.keys(payload.data).forEach(k => this.applyStreamPatch(`${base}/${k}`, payload.data[k]));
                    } else {
                        this.applyStreamPatch(base, payload.data);
                    }
                }
                this.chatsTreeVersion++;
                this.scheduleStreamFlush(60);
            } catch (err) {}
        };
        const aq = this.authQuery();
        const sep = aq ? '&' : '?';
        const es = new EventSource(`${this.dbUrl}/${this.encodePath(roomPath)}.json${aq}${sep}orderBy="ts"&limitToLast=50`);
        es.addEventListener('put', handler);
        es.addEventListener('patch', handler);
        es.onopen = () => {
            this._stopActiveRoomFallbackPoll();
        };
        es.onerror = () => {
            // 手機瀏覽器（iOS Safari / 內建瀏覽器）中斷 SSE 時，自動切換輕量 6 秒 ETag 備援輪詢（無新訊息為 304 零流量）
            if (this.activeRoomPath === roomPath) {
                this._startActiveRoomFallbackPoll(roomPath);
            }
        };
        this.activeRoomEs = es;
    },

    closeActiveChatRoom() {
        this._stopActiveRoomFallbackPoll();
        if (this.activeRoomEs) {
            try { this.activeRoomEs.close(); } catch (e) {}
        }
        this.activeRoomEs = null;
        this.activeRoomPath = '';
    },

    async initPlayerScopedSync() {
        this.tree = this.tree && typeof this.tree === 'object' ? this.tree : {};
        this.hydrateTreeFromLocalStorage();
        this.loadPersistedEtags();
        const me = this.playerSelfId();
        // 第一階段：索引、系統設定、祈願牆、專屬活動、本人私有記錄（確保手機端首屏即顯示專屬活動報名按鈕）
        const earlyNodes = [USER_INDEX_KEY, 'yuelao_system_batch', WISH_WALL_KEY, CUSTOM_ACTIVITIES_KEY];
        if (me) earlyNodes.push(`${USERS_KEY}/${me}`);
        await this.fetchPlayerPaths(earlyNodes);
        if (this.tree[CUSTOM_ACTIVITIES_KEY] === undefined && !this.isLocalSandboxMode()) {
            await new Promise(r => setTimeout(r, 500));
            await this.fetchPlayerPaths([CUSTOM_ACTIVITIES_KEY]);
        }
        // 第二階段：其餘熱門節點與聊天室（依本人記錄的配對名單決定）
        const restHot = this.PLAYER_HOT_NODES.filter(p => !earlyNodes.includes(p));
        await this.fetchPlayerPaths([...restHot, ...this.playerDynamicPaths()]);
        this.composePlayerUsers();
        this.hasLoadedFullTree = true;
        this.initialized = true;
        this.applyTreeToLocalStorage();
        this.updateCloudBadge(true);
        this.ensurePlayerDerivedNodes().catch(() => {});
        // 冷門節點於首屏渲染後背景載入，不阻塞首次開啟
        this.fetchPlayerPaths(this.PLAYER_COLD_NODES).then(() => {
            this.composePlayerUsers();
            this.chatsTreeVersion++;
            this.applyTreeToLocalStorage();
            if (typeof this.onUpdateCallback === 'function') this.onUpdateCallback();
        }).catch(() => {});
        this.startPlayerTimers();
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    if (this.activeRoomPath) {
                        this._hiddenRoomPath = this.activeRoomPath;
                    }
                    this.closeActiveChatRoom();
                } else {
                    this.lastUserActivityAt = Date.now();
                    this.isPlayerIdlePaused = false;
                    const friendsTabEl = document.getElementById('tab-friends');
                    const isFriendsTabVisible = Boolean(friendsTabEl && !friendsTabEl.classList.contains('hidden'));
                    let resumeRoom = this._hiddenRoomPath || this._pausedRoomPath || '';
                    if (!resumeRoom && isFriendsTabVisible && typeof appState !== 'undefined' && appState && appState.playerId && appState.activeFriendId && typeof ChatStore !== 'undefined') {
                        resumeRoom = `${CHATS_KEY}/${ChatStore.getPairKey(appState.playerId, appState.activeFriendId)}`;
                    }
                    this._hiddenRoomPath = '';
                    this._pausedRoomPath = '';
                    if (isFriendsTabVisible && resumeRoom) {
                        this.setActiveChatRoom(resumeRoom);
                    }
                    this.pollPlayerHot();
                }
            });
        }
        if (typeof this.onUpdateCallback === 'function') this.onUpdateCallback();
        return true;
    },

    async initBackendScopedSync() {
        this.tree = this.tree && typeof this.tree === 'object' ? this.tree : {};
        this.hydrateTreeFromLocalStorage();
        this.loadPersistedEtags();
        this.bindActivityWatchers();

        const pageKey = this.getBackendPageKey();
        const pageNodes = this.getBackendPageNodes(pageKey);
        if (!this.fetchedTopNodes) this.fetchedTopNodes = new Set();

        if (pageNodes.length > 0) {
            const results = await Promise.all(pageNodes.map(p => this.conditionalGetNode(p).then(r => ({ p, r }))));
            results.forEach(({ p, r }) => {
                const top = String(p).split('/')[0];
                if (r.status === 'changed') {
                    this.applyStreamPatch(p, r.data);
                    this.fetchedTopNodes.add(top);
                } else if (r.status === 'unchanged') {
                    this.fetchedTopNodes.add(top);
                }
            });
            if (pageNodes.includes(CHATS_KEY) || pageNodes.includes(CHAT_META_KEY)) {
                this.hasLoadedFullTree = true;
            }
            this.applyTreeToLocalStorage();
        }

        this.initialized = true;
        this.updateCloudBadge(true);
        this.startRealtimeStream();

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
                this.lastUserActivityAt = Date.now();
                this.isPlayerIdlePaused = false;
                await this.pollBackendLight();
            }
        });

        if (typeof this.onUpdateCallback === 'function') {
            this.onUpdateCallback();
        }
        return true;
    },

    startRealtimeStream() {
        if (this.isLocalSandboxMode()) return;
        // 流量修復：後台僅針對當前頁面所需節點做輕量 ETag 輪詢（純文字首頁 0 請求，其餘頁面每 30 秒檢查）
        if (this.backendPollTimer) return;
        this.backendPollTimer = setInterval(() => this.pollBackendLight(), this.BACKEND_POLL_INTERVAL_MS);
    },

    _initPromise: null,

    init(onUpdate) {
        if (onUpdate) this.onUpdateCallback = onUpdate;
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            if (typeof yuelaoAuth !== 'undefined' && yuelaoAuth && typeof yuelaoAuth.init === 'function') {
                await yuelaoAuth.init();
            }
            if (this.isLocalSandboxMode()) {
                this.initialized = true;
                this.hasLoadedFullTree = true;
                this.refreshCloudBadge();
                if (typeof this.onUpdateCallback === 'function') {
                    this.onUpdateCallback();
                }
                return true;
            }
            if (this.isPlayerSyncMode()) return this.initPlayerScopedSync();
            if (this.isBackendContext()) return this.initBackendScopedSync();
            let loadedOk = await this.fetchFullTree();
            if (!loadedOk) {
                await new Promise(r => setTimeout(r, 400));
                loadedOk = await this.fetchFullTree();
            }
            this.initialized = true;
            this.startRealtimeStream();
            return true;
        })().finally(() => {
            this._initPromise = null;
        });
        return this._initPromise;
    },

    // 階段 C：有登入權杖時附加到請求網址（未啟用匿名登入時為空字串，行為與之前相同）
    authQuery() {
        const token = (typeof yuelaoAuth !== 'undefined' && yuelaoAuth && typeof yuelaoAuth.getIdTokenSync === 'function')
            ? yuelaoAuth.getIdTokenSync() : '';
        return token ? `?auth=${encodeURIComponent(token)}` : '';
    },

    encodePath(path) {
        return String(path || '').split('/').filter(Boolean).map(seg => encodeURIComponent(seg)).join('/');
    },

    // ===== 流量修復：精準單節點讀取（嚴禁前台請求根節點 /.json）=====
    syncSandboxForumPath(path) {
        if (!this.isLocalSandboxMode()) return;
        const clean = String(path || '').replace(/^\/+|\/+$/g, '');
        const topNode = clean.split('/')[0];
        if (topNode === 'yuelao_forum_index' || topNode === 'yuelao_forum_posts') {
            try {
                const nodeData = (this.tree && this.tree[topNode] && typeof this.tree[topNode] === 'object')
                    ? this.tree[topNode]
                    : {};
                localStorage.setItem(topNode, JSON.stringify(nodeData));
            } catch (e) {}
        }
    },

    async getNodeOnce(path) {
        if (this.isLocalSandboxMode()) {
            const clean = String(path || '').replace(/^\/+|\/+$/g, '');
            const parts = clean.split('/');
            if (parts[0] === USERS_KEY && parts[1]) {
                try {
                    const arr = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
                    const found = Array.isArray(arr) ? arr.find(u => u && String(u.id).trim() === parts[1]) : null;
                    return found ? { ...found } : null;
                } catch (e) {
                    return null;
                }
            }
            if (parts[0] === 'yuelao_forum_index' || parts[0] === 'yuelao_forum_posts') {
                try {
                    const mapObj = JSON.parse(localStorage.getItem(parts[0]) || '{}');
                    if (!mapObj || typeof mapObj !== 'object') return null;
                    if (!parts[1]) return { ...mapObj };
                    let curr = mapObj;
                    for (let i = 1; i < parts.length; i++) {
                        if (!curr || typeof curr !== 'object' || curr[parts[i]] === undefined) return null;
                        curr = curr[parts[i]];
                    }
                    return (curr && typeof curr === 'object') ? JSON.parse(JSON.stringify(curr)) : curr;
                } catch (e) {
                    return null;
                }
            }
            return null;
        }
        // 回傳節點值；節點不存在為 null；網路錯誤為 undefined（呼叫端不可把 undefined 當作「不存在」）
        try {
            const res = await fetch(`${this.dbUrl}/${this.encodePath(path)}.json${this.authQuery()}`, { cache: 'no-store' });
            if (!res.ok) return undefined;
            return await res.json();
        } catch (e) {
            return undefined;
        }
    },

    // 單次唯讀拉取正式庫快照至地端 localStorage（僅執行一次 GET，絕不寫入正式庫，完成後維持純本地測試模式）
    async pullLiveSnapshotToLocalSandbox() {
        if (!this.isLocalSandboxMode()) {
            alert('目前已在正式連線模式，無需執行此操作。');
            return false;
        }
        if (!confirm('確定要從正式 Firebase 資料庫「單次下載」最新資料覆蓋地端測試資料嗎？\n\n・僅執行單向唯讀下載，絕不會修改正式庫\n・下載完成後會立即斷開並維持「🧪 本地測試模式」，不會再自動更新')) {
            return false;
        }

        const btns = document.querySelectorAll('[data-sandbox-pull-btn]');
        btns.forEach(b => {
            b.disabled = true;
            b.dataset.origText = b.textContent;
            b.textContent = '⏳ 正在從正式庫下載快照...';
        });

        try {
            let token = '';
            if (typeof yuelaoAuth !== 'undefined' && yuelaoAuth) {
                if (yuelaoAuth.adminSession && yuelaoAuth.adminSession.idToken && Date.now() < Number(yuelaoAuth.adminSession.expiresAt || 0) - 60000) {
                    token = yuelaoAuth.adminSession.idToken;
                } else {
                    if (yuelaoAuth.session && yuelaoAuth.session.refreshToken) {
                        try {
                            const refreshed = await yuelaoAuth.refreshSession();
                            if (refreshed && refreshed.idToken) token = refreshed.idToken;
                        } catch (e) {}
                    }
                    if (!token) {
                        const anon = await yuelaoAuth.signInAnonymously();
                        if (anon && anon.idToken) token = anon.idToken;
                    }
                }
            }

            const q = token ? `?auth=${encodeURIComponent(token)}` : '';
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20000);
            const res = await fetch(`${this.dbUrl}/.json${q}`, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal
            });
            clearTimeout(timer);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            if (!data || typeof data !== 'object') {
                throw new Error('正式庫回傳資料為空');
            }

            // 清除舊的本地沙盒殘留鎖定與快取，避免舊資料覆蓋剛拉取的最新快照
            this.pendingUsers = {};
            this.deletedUsers = {};
            this.unmatchedPairs = {};
            this.etagCache = {};
            const keysToRemove = [
                PENDING_USERS_SYNC_KEY,
                DELETED_USERS_SYNC_KEY,
                UNMATCHED_PAIRS_SYNC_KEY,
                this.ETAG_STORAGE_KEY,
                'yuelao_player_users_cache'
            ];
            try {
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(PLAYER_STATE_PREFIX)) {
                        keysToRemove.push(k);
                    }
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
            } catch (e) {}

            this.tree = data;
            this.hasLoadedFullTree = true;
            this.chatsTreeVersion++;
            this.applyTreeToLocalStorage();

            // 確保前後台聊天室快取皆同步取得完整對話紀錄
            const rawChats = (data[CHATS_KEY] && typeof data[CHATS_KEY] === 'object') ? data[CHATS_KEY] : {};
            const allChatsLocal = {};
            Object.keys(rawChats).forEach(pk => {
                const msgs = this.mapToArray(rawChats[pk]);
                msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
                allChatsLocal[pk] = msgs.slice(-200);
            });
            const chatsJson = JSON.stringify(allChatsLocal);
            this.writeLocalIfChanged(ADMIN_CHATS_KEY, chatsJson);
            this.writeLocalIfChanged(CHATS_KEY, chatsJson);

            // 確保前後台討論區索引與內文快取皆同步寫入本地
            const forumIdxObj = (data['yuelao_forum_index'] && typeof data['yuelao_forum_index'] === 'object') ? data['yuelao_forum_index'] : {};
            const forumPostsObj = (data['yuelao_forum_posts'] && typeof data['yuelao_forum_posts'] === 'object') ? data['yuelao_forum_posts'] : {};
            this.writeLocalIfChanged('yuelao_forum_index', JSON.stringify(forumIdxObj));
            this.writeLocalIfChanged('yuelao_forum_posts', JSON.stringify(forumPostsObj));

            // 若本地前台存有已登入玩家 ID，從最新 yuelao_users 重新載入其最新資料
            try {
                const curFrontRaw = localStorage.getItem(STORAGE_KEY);
                if (curFrontRaw && typeof Store !== 'undefined' && typeof Store.loadByPlayerId === 'function') {
                    const curFront = JSON.parse(curFrontRaw);
                    if (curFront && curFront.playerId) {
                        const refreshedFront = Store.loadByPlayerId(String(curFront.playerId));
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshedFront));
                    }
                }
            } catch (e) {}

            if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate();
            if (typeof AdminMemoryCache !== 'undefined') AdminMemoryCache.invalidate();

            const now = new Date();
            const snapTimeStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            try { localStorage.setItem('yuelao_sandbox_last_snapshot_at', snapTimeStr); } catch (e) {}
            this.refreshCloudBadge();

            if (typeof renderAdminAll === 'function') renderAdminAll(true);
            if (typeof refreshAdminForumIndex === 'function') refreshAdminForumIndex(false);

            const userCount = Object.keys(data[USERS_KEY] || {}).length;
            const forumCount = Object.keys(forumIdxObj).length;
            const chatCount = Object.keys(allChatsLocal).length;
            alert(`✅ 已成功從正式庫單次下載最新快照（${snapTimeStr}）！\n\n・會員資料：${userCount} 筆\n・討論區文章：${forumCount} 篇\n・配對聊天室：${chatCount} 間\n\n目前已自動斷開並維持「🧪 本地測試模式（不影響正式庫）」，後續操作皆僅留在地端，不會再自動連線更新。`);
            return true;
        } catch (err) {
            console.error('[sandbox-pull] 拉取正式庫快照失敗', err);
            alert(`❌ 下載正式庫快照失敗：${(err && err.message) || '網路連線異常'}\n請確認網路連線正常後再試一次。`);
            return false;
        } finally {
            btns.forEach(b => {
                b.disabled = false;
                if (b.dataset.origText) b.textContent = b.dataset.origText;
            });
        }
    },

    async refreshPlayerFresh() {
        if (this.isLocalSandboxMode()) return true;
        const me = this.playerSelfId();
        const paths = [USER_INDEX_KEY, ...this.PLAYER_HOT_NODES, ...this.PLAYER_COLD_NODES, ...(me ? [`${USERS_KEY}/${me}`] : []), ...this.playerDynamicPaths()];
        await this.fetchPlayerPaths(paths);
        this.composePlayerUsers();
        this.chatsTreeVersion++;
        this.applyTreeToLocalStorage();
        if (typeof this.onUpdateCallback === 'function') this.onUpdateCallback();
        return true;
    },

    // 通行碼還原：以 orderBy 精準查詢單一玩家（需 yuelao_users 的 backupCode 索引）
    async findUserByBackupCode(code) {
        const c = String(code || '').trim().toUpperCase();
        if (!c) return null;
        if (this.isLocalSandboxMode()) {
            try {
                const arr = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
                const found = Array.isArray(arr) ? arr.find(u => u && u.id && (String(u.backupCode || '').trim().toUpperCase() === c || (typeof deriveFixedBackupCode === 'function' && deriveFixedBackupCode(u.id) === c))) : null;
                return found ? { ...found } : null;
            } catch (e) {
                return null;
            }
        }
        const q = `orderBy=${encodeURIComponent('"backupCode"')}&equalTo=${encodeURIComponent('"' + c + '"')}&limitToFirst=1`;
        const auth = this.authQuery();
        const url = `${this.dbUrl}/${USERS_KEY}.json?${q}${auth ? '&' + auth.slice(1) : ''}`;
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return null;
            const data = await res.json();
            if (!data || typeof data !== 'object') return null;
            const key = Object.keys(data)[0];
            const rec = data[key];
            if (!rec || typeof rec !== 'object') return null;
            const uid = String(rec.id || key);
            this.applyStreamPatch(`${USERS_KEY}/${uid}`, rec);
            return { ...rec, id: uid };
        } catch (e) {
            return null;
        }
    },

    // ===== 流量修復：寫入遇 401/403 或網路錯誤時，刷新權杖後自動重試一次 =====
    async refreshAuthForRetry() {
        if (typeof yuelaoAuth === 'undefined' || !yuelaoAuth) return;
        try {
            if (yuelaoAuth.isBackendPage() && yuelaoAuth.adminSession) {
                await yuelaoAuth.refreshAdminSession();
            } else {
                await yuelaoAuth.refreshSession();
            }
        } catch (e) {
            try { await yuelaoAuth.signInAnonymously(); } catch (err) {}
        }
    },

    async writeRequest(buildInit, buildUrl) {
        let res = null;
        try { res = await fetch(buildUrl(), buildInit()); } catch (e) { res = null; }
        if (res && (res.ok || (res.status !== 401 && res.status !== 403))) return res;
        await this.refreshAuthForRetry();
        return fetch(buildUrl(), buildInit());
    },

    // ===== 流量修復：後台按頁輕量輪詢（純文字首頁 0 請求，其餘頁面僅檢查本頁節點且支援 5 分鐘閒置暫停）=====
    async pollBackendLight() {
        if (this.isLocalSandboxMode()) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        if (this.inFlightWrites > 0) return;
        const pageKey = this.getBackendPageKey();
        if (pageKey === 'home') return;
        if (this.isUserIdleNow(this.BACKEND_IDLE_TIMEOUT_MS)) {
            this.isPlayerIdlePaused = true;
            return;
        }
        const paths = this.getBackendPageNodes(pageKey);
        if (!paths || paths.length === 0) return;
        const results = await Promise.all(paths.map(p => this.conditionalGetNode(p).then(r => ({ p, r }))));
        let changed = false;
        results.forEach(({ p, r }) => {
            const top = String(p).split('/')[0];
            if (r.status === 'changed') {
                this.applyStreamPatch(p, r.data);
                if (this.fetchedTopNodes) this.fetchedTopNodes.add(top);
                changed = true;
            }
        });
        if (changed) {
            if (paths.includes(CHATS_KEY) || paths.includes(CHAT_META_KEY)) this.hasLoadedFullTree = true;
            this.applyTreeToLocalStorage();
            if (typeof this.onUpdateCallback === 'function') this.onUpdateCallback();
        }
    },

    // ===== 單節點讀取：同路徑併發合併（in-flight）＋ 30 秒 TTL；逾時以 ETag 條件式重新驗證（未變動回 304，不下載內容）=====
    readCacheTtlMs: 30000,
    nodeReadCache: null,
    nodeReadInflight: null,

    async readNodeCached(path, options = {}) {
        if (this.isLocalSandboxMode()) {
            const val = await this.getNodeOnce(path);
            return { status: 'cache', data: val };
        }
        if (!this.nodeReadCache) this.nodeReadCache = new Map();
        if (!this.nodeReadInflight) this.nodeReadInflight = new Map();
        const key = String(path || '').replace(/^\/+|\/+$/g, '');
        const clone = v => (v === undefined || v === null) ? v : JSON.parse(JSON.stringify(v));
        const hit = this.nodeReadCache.get(key);
        if (!options.force && hit && Date.now() - hit.at < this.readCacheTtlMs) {
            return { status: 'cache', data: clone(hit.value) };
        }
        if (this.nodeReadInflight.has(key)) {
            const r = await this.nodeReadInflight.get(key);
            return { status: r.status, data: clone(r.data) };
        }
        const task = (async () => {
            try {
                const headers = { 'X-Firebase-ETag': 'true' };
                if (hit && hit.etag) headers['If-None-Match'] = hit.etag;
                const res = await fetch(`${this.dbUrl}/${this.encodePath(key)}.json${this.authQuery()}`, {
                    method: 'GET', headers, cache: 'no-store'
                });
                if (res.status === 304 && hit) {
                    hit.at = Date.now();
                    return { status: 'cache', data: hit.value };
                }
                if (!res.ok) return { status: 'error', data: null };
                const etag = res.headers.get('ETag') || '';
                const text = await res.text();
                const data = text ? JSON.parse(text) : null;
                this.nodeReadCache.set(key, { value: data, etag, at: Date.now() });
                return { status: 'fresh', data };
            } catch (e) {
                return { status: 'error', data: null };
            } finally {
                this.nodeReadInflight.delete(key);
            }
        })();
        this.nodeReadInflight.set(key, task);
        const r = await task;
        return { status: r.status, data: clone(r.data) };
    },

    // 寫入後讓該路徑（及其上下層）的快取過期；保留 ETag，下次讀取以 304 驗證
    invalidateNodeReadCache(path) {
        if (!this.nodeReadCache) return;
        const key = String(path || '').replace(/^\/+|\/+$/g, '');
        for (const [k, entry] of this.nodeReadCache.entries()) {
            if (k === key || k.startsWith(key + '/') || key.startsWith(k + '/')) entry.at = 0;
        }
    },

    async putNode(path, value, options = {}) {
        this.invalidateNodeReadCache(path);
        this.invalidatePersistedEtag(path);
        this.applyStreamPatch(path, value);
        if (this.isLocalSandboxMode()) {
            this.syncSandboxForumPath(path);
            return true;
        }
        this.inFlightWrites++;
        this.writeEpoch++;
        this.refreshCloudBadge();
        try {
            const encoded = this.encodePath(path);
            const res = await this.writeRequest(
                () => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
                () => `${this.dbUrl}/${encoded}.json${this.authQuery()}`
            );
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return true;
        } catch (e) {
            console.warn('CloudSync putNode 同步失敗', path, e);
            if (options && options.throwOnError) {
                throw e;
            }
            return false;
        } finally {
            this.settleInFlightWrite();
            this.writeEpoch++;
            this.refreshCloudBadge();
        }
    },

    async patchNode(path, patchObj, options = {}) {
        this.invalidateNodeReadCache(path);
        this.invalidatePersistedEtag(path);
        if (!patchObj || typeof patchObj !== 'object') return;
        const cleanBase = String(path || '').replace(/^\/+|\/+$/g, '');
        Object.entries(patchObj).forEach(([k, v]) => {
            const subPath = cleanBase ? `${cleanBase}/${k}` : k;
            this.applyStreamPatch(subPath, v);
        });
        if (this.isLocalSandboxMode()) {
            this.syncSandboxForumPath(path);
            return true;
        }
        this.inFlightWrites++;
        this.writeEpoch++;
        this.refreshCloudBadge();
        try {
            const encoded = this.encodePath(path);
            const res = await this.writeRequest(
                () => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patchObj) }),
                () => `${this.dbUrl}/${encoded}.json${this.authQuery()}`
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return true;
        } catch (e) {
            console.warn('CloudSync patchNode 同步失敗', path, e);
            if (options && options.throwOnError) throw e;
            return false;
        } finally {
            this.settleInFlightWrite();
            this.writeEpoch++;
            this.refreshCloudBadge();
        }
    },

    pairKeyOf(a, b) {
        return [String(a), String(b)].sort().join('__');
    },

    partnerIdsOf(record) {
        const set = new Set();
        const hist = record && Array.isArray(record.matchedHistory) ? record.matchedHistory : [];
        hist.forEach(h => { if (h && h.partnerId) set.add(String(h.partnerId)); });
        return Array.from(set);
    },

    // 比對本地已知的配對節點，只把內容真正不同的項目加入寫入計畫（冪等）
    pairWritePlan(ownerId, ownerRecord, pk, plan) {
        const tree = this.tree || {};
        const profile = buildPairProfileRecord(ownerRecord);
        const ig = buildPairIgRecord(ownerRecord);
        const curP = tree[PAIR_PROFILES_KEY] && tree[PAIR_PROFILES_KEY][pk] ? tree[PAIR_PROFILES_KEY][pk][ownerId] : null;
        const curI = tree[PAIR_IG_KEY] && tree[PAIR_IG_KEY][pk] ? tree[PAIR_IG_KEY][pk][ownerId] : null;
        if (profile && canonJson(profile) !== canonJson(curP || null)) {
            plan.push([`${PAIR_PROFILES_KEY}/${pk}/${ownerId}`, profile]);
        }
        if (canonJson(ig) !== canonJson(curI || null)) {
            plan.push([`${PAIR_IG_KEY}/${pk}/${ownerId}`, ig]);
        }
    },

    // 同步一位會員的公開索引與其配對節點。options.bothSides（後台）時一併寫入對方側資料
    async syncDerivedNodesFor(pid, record, options = {}) {
        const ownerId = String(pid || '').trim();
        if (!ownerId || !record || typeof record !== 'object') return 0;
        const tree = this.tree || {};
        const plan = [];
        const idx = buildUserIndexRecord(record);
        const curIdx = tree[USER_INDEX_KEY] ? tree[USER_INDEX_KEY][ownerId] : null;
        if (idx && canonJson(idx) !== canonJson(curIdx || null)) {
            plan.push([`${USER_INDEX_KEY}/${ownerId}`, idx]);
        }
        this.partnerIdsOf(record).forEach(partnerId => {
            const pk = this.pairKeyOf(ownerId, partnerId);
            this.pairWritePlan(ownerId, record, pk, plan);
            if (options && options.bothSides) {
                const partnerRec = tree[USERS_KEY] ? tree[USERS_KEY][partnerId] : null;
                if (partnerRec && typeof partnerRec === 'object') {
                    this.pairWritePlan(partnerId, partnerRec, pk, plan);
                }
            }
        });
        const unique = new Map();
        plan.forEach(([path, value]) => unique.set(path, value));
        const entries = Array.from(unique.entries());
        for (const [path, value] of entries) {
            await this.putNode(path, value);
        }
        return entries.length;
    },

    // 比較前後快照，只產生「真正變動」的欄位（PATCH 內容）。
    // 不會因為缺少某欄位就刪除它（例如 matchedHistory）；只有明確給 null 或空值才刪除。
    buildRecordPatch(prev, next, inputRecord = null) {
        const base = prev && typeof prev === 'object' ? prev : {};
        const patch = {};
        const isEmpty = v => v === undefined || v === null || (Array.isArray(v) && v.length === 0)
            || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
        Object.keys(next || {}).forEach(k => {
            const value = next[k];
            if (value === undefined) return;
            if (inputRecord && !Object.prototype.hasOwnProperty.call(inputRecord, k)) return;
            if (canonJson(value) === canonJson(base[k] === undefined ? null : base[k])) return;
            patch[k] = isEmpty(value) ? null : value;
        });
        return patch;
    },

    // 後台回填：遍歷完整會員資料，補齊索引與雙方配對節點；可重複執行，結果一致
    async backfillDerivedNodes() {
        if (!this.isBackendContext()) return { users: 0, writes: 0, skipped: true };
        const users = (this.tree && this.tree[USERS_KEY]) || {};
        let writes = 0;
        let count = 0;
        for (const pid of Object.keys(users)) {
            const rec = users[pid];
            if (!rec || typeof rec !== 'object') continue;
            count++;
            writes += await this.syncDerivedNodesFor(pid, rec, { bothSides: true });
        }
        return { users: count, writes };
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
        Object.keys(localPatch).forEach(k => {
            if (localPatch[k] === null) {
                delete mergedRecord[k];
            }
        });
        delete mergedRecord.registeredSession;
        this.lastPushedUsersJson[pid] = JSON.stringify(mergedRecord);
        this.setSharedPendingUser(pid, mergedRecord, 18000);

        await this.patchNode(`${USERS_KEY}/${pid}`, firebasePatch);
        await this.syncDerivedNodesFor(pid, mergedRecord, { bothSides: this.isBackendContext() });
    },

    async deleteNode(path) {
        this.invalidateNodeReadCache(path);
        this.invalidatePersistedEtag(path);
        this.applyStreamPatch(path, null);
        const pathParts = String(path || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        if (pathParts.length === 2 && pathParts[0] === USERS_KEY) {
            const pid = pathParts[1];
            if (pid) this.markSharedDeletedUser(pid, 20000);
        }
        if (this.isLocalSandboxMode()) {
            this.syncSandboxForumPath(path);
            return true;
        }
        this.inFlightWrites++;
        this.writeEpoch++;
        this.refreshCloudBadge();
        try {
            const encoded = this.encodePath(path);
            const res = await this.writeRequest(
                () => ({ method: 'DELETE' }),
                () => `${this.dbUrl}/${encoded}.json${this.authQuery()}`
            );
            if (!res.ok) console.warn('CloudSync deleteNode HTTP', res.status, path);
        } catch (e) {
            console.warn('CloudSync deleteNode 同步失敗', path, e);
        } finally {
            this.settleInFlightWrite();
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
        const rec = this.tree && this.tree[USERS_KEY] ? this.tree[USERS_KEY][pid] : null;
        await this.deleteNode(`${USER_INDEX_KEY}/${pid}`);
        for (const partnerId of this.partnerIdsOf(rec)) {
            const pk = this.pairKeyOf(pid, partnerId);
            await this.deleteNode(`${PAIR_PROFILES_KEY}/${pk}/${pid}`);
            await this.deleteNode(`${PAIR_IG_KEY}/${pk}/${pid}`);
        }
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
        const hasInput = k => Object.prototype.hasOwnProperty.call(record, k);
        delete cleanRecord.registeredSession;
        cleanRecord.city = String(cleanRecord.city || '').trim();
        cleanRecord.region = String(cleanRecord.region || inferRegionByCity(cleanRecord.city) || '').trim();
        cleanRecord.mbti = String(cleanRecord.mbti || '').trim();
        cleanRecord.mbtiGroup = String(cleanRecord.mbtiGroup || inferMbtiGroup(cleanRecord.mbti) || '').trim();
        cleanRecord.registeredSessions = Array.from(new Set(
            this.normalizeStringArray(cleanRecord.registeredSessions).map(s => normalizeSessionLabel(s)).filter(Boolean)
        ));
        cleanRecord.matchedHistory = this.normalizeMatchedHistoryList(cleanRecord.matchedHistory)
            .filter(h => !this.isPairRecentlyUnmatched(pid, h.partnerId) && !this.isRogueCustomMatchEntry(h));

        if (!isMatchMutation) {
            // 非配對／解除配對異動時，同時合併雲端樹、本地快取與傳入紀錄的配對歷史（排除近期已解除配對與異常誤配對），絕不以舊快照覆蓋減少已配對好友
            let localCachedUser = null;
            try {
                const localUsers = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
                if (Array.isArray(localUsers)) {
                    localCachedUser = localUsers.find(u => u && String(u.id).trim() === pid) || null;
                }
            } catch (e) {}

            const cloudHist = (existingTreeUser && existingTreeUser.matchedHistory)
                ? this.normalizeMatchedHistoryList(existingTreeUser.matchedHistory)
                : [];
            const localHist = (localCachedUser && localCachedUser.matchedHistory)
                ? this.normalizeMatchedHistoryList(localCachedUser.matchedHistory)
                : [];

            cleanRecord.matchedHistory = this.normalizeMatchedHistoryList([...cloudHist, ...localHist, ...cleanRecord.matchedHistory])
                .filter(h => !this.isPairRecentlyUnmatched(pid, h.partnerId) && !this.isRogueCustomMatchEntry(h));

            const rawPrimaryId = String(
                (existingTreeUser && existingTreeUser.matchedWithId) ||
                (localCachedUser && localCachedUser.matchedWithId) ||
                cleanRecord.matchedWithId ||
                ''
            ).trim();
            if (rawPrimaryId && !this.isPairRecentlyUnmatched(pid, rawPrimaryId)) {
                cleanRecord.matchedSession = (existingTreeUser && existingTreeUser.matchedSession) || (localCachedUser && localCachedUser.matchedSession) || cleanRecord.matchedSession || null;
                cleanRecord.matchedWithId = rawPrimaryId;
                cleanRecord.matchedWithName = (existingTreeUser && existingTreeUser.matchedWithName) || (localCachedUser && localCachedUser.matchedWithName) || cleanRecord.matchedWithName || null;
                cleanRecord.matchedAt = (existingTreeUser && existingTreeUser.matchedAt) || (localCachedUser && localCachedUser.matchedAt) || cleanRecord.matchedAt || null;
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
        cleanRecord.mustMatchKeys = (typeof normalizeMustMatchKeysList === 'function')
            ? normalizeMustMatchKeysList(cleanRecord.mustMatchKeys, cleanRecord.exactMatchCriteria)
            : this.normalizeStringArray(cleanRecord.mustMatchKeys).filter(k => Object.prototype.hasOwnProperty.call(cleanRecord.exactMatchCriteria, k)).slice(0, 2);
        cleanRecord.customActivityRegs = (cleanRecord.customActivityRegs && typeof cleanRecord.customActivityRegs === 'object' && !Array.isArray(cleanRecord.customActivityRegs))
            ? cleanRecord.customActivityRegs
            : {};
        // 寫入前以雲端最新單節點為基準（玩家端）；只 PATCH 差異欄位，避免舊快取整包覆寫 matchedHistory
        const freshBase = await this.getNodeOnce(`${USERS_KEY}/${pid}`);
        
        const serialized = JSON.stringify(cleanRecord);
        if (!forcePush && this.lastPushedUsersJson[pid] === serialized) return;
        this.lastPushedUsersJson[pid] = serialized;
        this.setSharedPendingUser(pid, cleanRecord, 25000);
        if (freshBase === undefined) {
            console.warn('[upsertUser] 無法讀取雲端最新資料，略過寫入以免覆蓋 ID:', pid);
            return;
        }
        const baseUser = (freshBase && typeof freshBase === 'object') ? freshBase : null;
        
        // 核心修復：寫入前強制將最新雲端的配對名單合併進 cleanRecord，徹底斷絕舊網頁覆蓋好友名單的問題
        if (baseUser) {
            const latestCloudHist = this.normalizeMatchedHistoryList(baseUser.matchedHistory);
            // 即使是 isMatchMutation (例如繼續配對延長天數)，也必須先聯集合併最新雲端名單，避免覆蓋掉單方新配對的好友
            cleanRecord.matchedHistory = this.normalizeMatchedHistoryList([...latestCloudHist, ...cleanRecord.matchedHistory])
                .filter(h => !this.isPairRecentlyUnmatched(pid, h.partnerId) && !this.isRogueCustomMatchEntry(h));
                
            const rawPrimaryId = String(baseUser.matchedWithId || cleanRecord.matchedWithId || '').trim();
            if (rawPrimaryId && !this.isPairRecentlyUnmatched(pid, rawPrimaryId)) {
                cleanRecord.matchedSession = baseUser.matchedSession || cleanRecord.matchedSession || null;
                cleanRecord.matchedWithId = rawPrimaryId;
                cleanRecord.matchedWithName = baseUser.matchedWithName || cleanRecord.matchedWithName || null;
                cleanRecord.matchedAt = baseUser.matchedAt || cleanRecord.matchedAt || null;
            } else {
                const fallbackPrimary = cleanRecord.matchedHistory[cleanRecord.matchedHistory.length - 1] || null;
                cleanRecord.matchedSession = fallbackPrimary ? (fallbackPrimary.session || null) : null;
                cleanRecord.matchedWithId = fallbackPrimary ? (fallbackPrimary.partnerId || null) : null;
                cleanRecord.matchedWithName = fallbackPrimary ? (fallbackPrimary.partnerName || null) : null;
                cleanRecord.matchedAt = fallbackPrimary ? (fallbackPrimary.matchedAt || null) : null;
            }
        }

        // 不完整的記錄（例如組合出來的配對對象）不可新建整筆節點
        if (!baseUser && !hasInput('matchedHistory')) return;
        if (baseUser) {
            const diffPatch = this.buildRecordPatch(baseUser, cleanRecord, record);
            if (Object.keys(diffPatch).length) {
                await this.patchNode(`${USERS_KEY}/${pid}`, diffPatch, { throwOnError: Boolean(options && options.throwOnError) });
            }
        } else {
            await this.putNode(`${USERS_KEY}/${pid}`, cleanRecord, { throwOnError: Boolean(options && options.throwOnError) });
        }
        if (hasInput('matchedHistory')) await this.syncDerivedNodesFor(pid, cleanRecord, { bothSides: this.isBackendContext() });
        const cleanupTasks = [];
        if (isMatchMutation) {
            if (hasInput('matchedHistory') && (!Array.isArray(cleanRecord.matchedHistory) || cleanRecord.matchedHistory.length === 0)) {
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedHistory`));
            }
            if (hasInput('matchedWithId') && !cleanRecord.matchedWithId) {
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedWithId`));
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedWithName`));
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedSession`));
                cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/matchedAt`));
            }
        }
        const prevTreeUser = (this.tree && this.tree[USERS_KEY] && this.tree[USERS_KEY][pid]) ? this.tree[USERS_KEY][pid] : null;
        if (hasInput('registeredSessions') && cleanRecord.registeredSessions.length === 0 && prevTreeUser && prevTreeUser.registeredSessions) {
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/registeredSessions`));
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/registeredSession`));
        }
        if (hasInput('exactMatchCriteria') && Object.keys(cleanRecord.exactMatchCriteria).length === 0 && prevTreeUser && prevTreeUser.exactMatchCriteria) {
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/exactMatchCriteria`));
        }
        if (hasInput('mustMatchKeys') && (!Array.isArray(cleanRecord.mustMatchKeys) || cleanRecord.mustMatchKeys.length === 0) && prevTreeUser && prevTreeUser.mustMatchKeys) {
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/mustMatchKeys`));
        }
        
        const prevCustomKeys = (prevTreeUser && prevTreeUser.customActivityRegs && typeof prevTreeUser.customActivityRegs === 'object')
            ? Object.keys(prevTreeUser.customActivityRegs)
            : [];
        if (hasInput('customActivityRegs') && Object.keys(cleanRecord.customActivityRegs).length === 0 && prevCustomKeys.length > 0) {
            cleanupTasks.push(this.deleteNode(`${USERS_KEY}/${pid}/customActivityRegs`));
        } else {
            if (hasInput('customActivityRegs')) prevCustomKeys.forEach(oldActKey => {
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

    syncUsersArray(usersArr, options = { isMatchMutation: false, targetIds: [] }) {
        const list = Array.isArray(usersArr) ? usersArr : [];
        const forcePush = Boolean(options && options.isMatchMutation);
        const restrictIds = Array.isArray(options.targetIds) && options.targetIds.length > 0
            ? new Set(options.targetIds.map(String))
            : null;

        list.forEach(u => {
            if (!u || !u.id || this.isUserDeleted(u.id)) return;
            const uid = String(u.id).trim();

            if (restrictIds && !restrictIds.has(uid)) {
                // 若有指定目標，但此玩家不在目標名單內，且資料內容確實沒變，就直接跳過，大幅降低寫入風暴
                const cleanRecord = { ...u };
                delete cleanRecord.registeredSession;
                cleanRecord.city = String(cleanRecord.city || '').trim();
                cleanRecord.region = String(cleanRecord.region || (typeof inferRegionByCity === 'function' ? inferRegionByCity(cleanRecord.city) : '') || '').trim();
                cleanRecord.mbti = String(cleanRecord.mbti || '').trim();
                cleanRecord.mbtiGroup = String(cleanRecord.mbtiGroup || (typeof inferMbtiGroup === 'function' ? inferMbtiGroup(cleanRecord.mbti) : '') || '').trim();
                cleanRecord.registeredSessions = Array.from(new Set(this.normalizeStringArray(cleanRecord.registeredSessions).map(s => (typeof normalizeSessionLabel === 'function' ? normalizeSessionLabel(s) : s)).filter(Boolean)));
                cleanRecord.matchedHistory = this.normalizeMatchedHistoryList(cleanRecord.matchedHistory).filter(h => !this.isPairRecentlyUnmatched(uid, h.partnerId));
                cleanRecord.exactMatchCriteria = (cleanRecord.exactMatchCriteria && typeof cleanRecord.exactMatchCriteria === 'object' && !Array.isArray(cleanRecord.exactMatchCriteria)) ? cleanRecord.exactMatchCriteria : {};
                cleanRecord.mustMatchKeys = (typeof normalizeMustMatchKeysList === 'function')
                    ? normalizeMustMatchKeysList(cleanRecord.mustMatchKeys, cleanRecord.exactMatchCriteria)
                    : this.normalizeStringArray(cleanRecord.mustMatchKeys).filter(k => Object.prototype.hasOwnProperty.call(cleanRecord.exactMatchCriteria, k)).slice(0, 2);
                cleanRecord.customActivityRegs = (cleanRecord.customActivityRegs && typeof cleanRecord.customActivityRegs === 'object' && !Array.isArray(cleanRecord.customActivityRegs)) ? cleanRecord.customActivityRegs : {};
                
                if (this.lastPushedUsersJson[uid] === JSON.stringify(cleanRecord)) {
                    return;
                }
            }
            this.upsertUser(u, forcePush, options);
        });
    },

};

// 4. 唯一玩家 ID 分配器（男 10001 起 / 女 20001 起）
const IdAllocator = {
    allocate(gender) {
        const counters = JSON.parse(localStorage.getItem(ID_COUNTER_KEY) || '{"male":10001,"female":20001,"other":30001}');
        const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
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
    getUsersArray() {
        const arr = LocalJsonCache.get(USERS_LOCAL_KEY, () => []);
        return Array.isArray(arr) ? arr : [];
    },

    getSystemConfig() {
        const autoBatch = calcAutoBatchNumber(new Date());
        try {
            const sys = LocalJsonCache.get(SYSTEM_STATE_KEY, () => ({})) || {};
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
                maleDisplayOffset: sys.maleDisplayOffset !== undefined ? Math.max(0, Number(sys.maleDisplayOffset) || 0) : 0,
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
                maleDisplayOffset: 0,
                wishEarlyCloseCanMatch: true
            };
        }
    },

    setSystemConfig(patch) {
        const current = this.getSystemConfig();
        const updated = { ...current, ...patch };
        localStorage.setItem(SYSTEM_STATE_KEY, JSON.stringify(updated));
        LocalJsonCache.invalidate(SYSTEM_STATE_KEY);
        if (typeof CloudSync !== 'undefined') CloudSync.putNode(SYSTEM_STATE_KEY, updated);
        return updated;
    },

    getGenderCounts() {
        try {
            const users = this.getUsersArray();
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
        const realLimit = Math.max(1, Number(cfg.genderLimitMax || 30));
        const maleOffset = Math.max(0, Number(cfg.maleDisplayOffset || 0));
        const enabled = Boolean(cfg.genderLimitEnabled);
        const maleFull = enabled && counts.male >= realLimit;
        const femaleFull = false; // 女生不限制人數上限
        const bothFull = false;   // 女生不限制上限，不會出現男女皆滿鎖定
        return {
            enabled,
            limit: realLimit + maleOffset,
            realLimit,
            maleDisplayOffset: maleOffset,
            realMaleCount: counts.male,
            maleCount: counts.male + maleOffset,
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
            LocalJsonCache.invalidate(BANNED_RULES_KEY);
            return initial;
        }
        const parsed = LocalJsonCache.get(BANNED_RULES_KEY, () => []);
        return Array.isArray(parsed) ? parsed : [];
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
        const arr = LocalJsonCache.get(MAILBOX_KEY, () => []);
        return Array.isArray(arr) ? arr : [];
    },

    getFateWallPosts() {
        const arr = LocalJsonCache.get(FATE_WALL_KEY, () => []);
        if (!Array.isArray(arr)) return [];
        return arr
            .filter(item => item && typeof item === 'object' && String(item.content || '').trim() !== '')
            .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    },

    getWishWallPosts() {
        const arr = LocalJsonCache.get(WISH_WALL_KEY, () => []);
        if (!Array.isArray(arr)) return [];
        return arr
            .map(w => (typeof normalizeWishWallItem === 'function' ? normalizeWishWallItem(w) : w))
            .filter(Boolean)
            .sort((a, b) => (typeof compareWishWallItems === 'function')
                ? compareWishWallItems(a, b)
                : (Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0)));
    },

    getCustomActivities() {
        const arr = LocalJsonCache.get(CUSTOM_ACTIVITIES_KEY, () => []);
        return Array.isArray(arr) ? arr.filter(a => a && typeof a === 'object' && a.id) : [];
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
                hasPetStatus: '',
                hasPet: '',
                hobbies: [],
                hobbiesOther: ''
            },
            privacy: privacy,
            registeredSessions: [],
            exactMatchCriteria: {},
            mustMatchKeys: [],
            customActivityRegs: {},
            matchedSession: null,
            friends: [],
            activeFriendId: null,
            multiFriendSince: null,
            confessionUnlockAt: null,
            lastConfessionDate: null,
            lastHandledForceConfessionId: null,
            disableConfession: false
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
        if (!mergedProfile.hasPetStatus && mergedProfile.hasPet && typeof inferPetStatus === 'function') {
            mergedProfile.hasPetStatus = inferPetStatus(mergedProfile.hasPet);
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
            disableConfession: Boolean(parsed.disableConfession),
            readMailIds: Array.isArray(parsed.readMailIds) ? parsed.readMailIds : [],
            profile: mergedProfile,
            privacy: mergedPrivacy,
            registeredSessions: sessions,
            exactMatchCriteria: (parsed.exactMatchCriteria && typeof parsed.exactMatchCriteria === 'object') ? parsed.exactMatchCriteria : {},
            mustMatchKeys: (typeof normalizeMustMatchKeysList === 'function')
                ? normalizeMustMatchKeysList(parsed.mustMatchKeys, parsed.exactMatchCriteria || {})
                : (Array.isArray(parsed.mustMatchKeys) ? parsed.mustMatchKeys.slice(0, 2) : []),
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
                if (typeof CloudSync !== 'undefined' && CloudSync.initialized && CloudSync.tree && CloudSync.tree[CHATS_KEY]) {
                    CloudSync.writeLocalIfChanged(CHATS_KEY, JSON.stringify(CloudSync.chatsMapToLocal(CloudSync.tree[CHATS_KEY])));
                }
                try {
                    const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
                    const userRec = users.find(u => String(u.id) === pid);
                    if (userRec) mergeConfessionFromCloud(state, userRec);
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
                                'matchedWithId', 'matchedWithName', 'matchedAt', 'updatedAt',
                                'lastSaveIp', 'lastSaveIpAt'
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
            const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
            const userRec = users.find(u => String(u.id) === pid);
            if (userRec) {
                const state = this.normalizeParsedState({
                    playerId: pid,
                    backupCode: deriveFixedBackupCode(pid),
                    lastSyncedCloudUpdatedAt: userRec.updatedAt || '',
                    isWarnedAccount: Boolean(userRec.isWarned),
                    warningReason: userRec.warningReason || '',
                    isChatBanned: Boolean(userRec.isChatBanned),
                    disableConfession: Boolean(userRec.disableConfession),
                    profile: (() => {
                        const cleanProf = { ...userRec };
                        delete cleanProf.lastSaveIp;
                        delete cleanProf.lastSaveIpAt;
                        return cleanProf;
                    })(),
                    privacy: userRec.privacy || {},
                    registeredSessions: Array.isArray(userRec.registeredSessions) ? Array.from(new Set(userRec.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean))) : [],
                    exactMatchCriteria: userRec.exactMatchCriteria || {},
                    mustMatchKeys: Array.isArray(userRec.mustMatchKeys) ? [...userRec.mustMatchKeys] : [],
                    customActivityRegs: (userRec.customActivityRegs && typeof userRec.customActivityRegs === 'object' && !Array.isArray(userRec.customActivityRegs)) ? userRec.customActivityRegs : {}
                });
                sessionStorage.setItem(TAB_PLAYER_ID_KEY, pid);
                if (typeof CloudSync !== 'undefined' && CloudSync.initialized && CloudSync.tree && CloudSync.tree[CHATS_KEY]) {
                    CloudSync.writeLocalIfChanged(CHATS_KEY, JSON.stringify(CloudSync.chatsMapToLocal(CloudSync.tree[CHATS_KEY])));
                }
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

    _transientClientMeta: null,

    setTransientClientMeta(meta) {
        if (meta && typeof meta === 'object' && meta.ip) {
            this._transientClientMeta = {
                ip: String(meta.ip || '').trim(),
                updatedAt: String(meta.updatedAt || new Date().toLocaleString('zh-TW')).trim()
            };
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
            delete state.profile.lastSaveIp;
            delete state.profile.lastSaveIpAt;
            state.profile.city = String(state.profile.city || '').trim();
            state.profile.region = String(state.profile.region || inferRegionByCity(state.profile.city) || '').trim();
            state.profile.mbti = String(state.profile.mbti || '').trim();
            state.profile.mbtiGroup = String(state.profile.mbtiGroup || inferMbtiGroup(state.profile.mbti) || '').trim();
            state.profile.hasPet = String(state.profile.hasPet || '').trim();
            state.profile.hasPetStatus = String(state.profile.hasPetStatus || (typeof inferPetStatus === 'function' ? inferPetStatus(state.profile.hasPet) : '') || '').trim();
            if (state.profile.hasPetStatus === '沒有養寵物') {
                state.profile.hasPet = '沒有養寵物';
            }
        }

        if (Array.isArray(state.registeredSessions)) {
            state.registeredSessions = Array.from(new Set(state.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
        }
        if (state.matchedSession && !String(state.matchedSession).includes('強制')) {
            state.matchedSession = normalizeSessionLabel(state.matchedSession);
        }

        if (state.playerId && state.profile) {
            if (!forceCloudPush && typeof CloudSync !== 'undefined' && typeof CloudSync.isUserDeleted === 'function' && CloudSync.isUserDeleted(state.playerId)) {
                return;
            }
            const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
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
                readMailIds: Array.isArray(state.readMailIds) ? Array.from(new Set(state.readMailIds.map(String))) : [],
                registeredSessions: state.isWarnedAccount ? [] : (Array.isArray(state.registeredSessions) ? state.registeredSessions : []),
                exactMatchCriteria: state.exactMatchCriteria || {},
                mustMatchKeys: (typeof normalizeMustMatchKeysList === 'function')
                    ? normalizeMustMatchKeysList(state.mustMatchKeys, state.exactMatchCriteria || {})
                    : (Array.isArray(state.mustMatchKeys) ? state.mustMatchKeys.slice(0, 2) : []),
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
            const transientMeta = this._transientClientMeta;
            const resolvedSaveIp = (transientMeta && transientMeta.ip) || String(existingRecord.lastSaveIp || '').trim();
            const resolvedSaveIpAt = (transientMeta && transientMeta.ip)
                ? (transientMeta.updatedAt || nowUpdatedStr)
                : String(existingRecord.lastSaveIpAt || '').trim();
            if (resolvedSaveIp) record.lastSaveIp = resolvedSaveIp;
            if (resolvedSaveIpAt) record.lastSaveIpAt = resolvedSaveIpAt;

            delete record.registeredSession;
            const usersCacheCopy = (typeof CloudSync !== 'undefined' && typeof CloudSync.isBackendContext === 'function' && !CloudSync.isBackendContext())
                ? (() => {
                    const stripped = { ...record };
                    delete stripped.lastSaveIp;
                    delete stripped.lastSaveIpAt;
                    return stripped;
                })()
                : record;
            if (idx >= 0) users[idx] = usersCacheCopy;
            else users.push(usersCacheCopy);
            localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
            if (!skipCloudPush && typeof CloudSync !== 'undefined') {
                const pushPromise = CloudSync.upsertUser(record, forceCloudPush);
                if (state.playerId) {
                    sessionStorage.setItem(TAB_PLAYER_ID_KEY, String(state.playerId));
                    writeStateSafely(PLAYER_STATE_PREFIX + String(state.playerId), state);
                }
                writeStateSafely(STORAGE_KEY, state);
                return pushPromise;
            }
        }

        if (state.playerId) {
            sessionStorage.setItem(TAB_PLAYER_ID_KEY, String(state.playerId));
            writeStateSafely(PLAYER_STATE_PREFIX + String(state.playerId), state);
        }
        writeStateSafely(STORAGE_KEY, state);
    },

    saveSharedUsers(users, options = { isMatchMutation: false }) {
        localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
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
        const arr = LocalJsonCache.get(REPORTS_KEY, () => []);
        return Array.isArray(arr) ? arr.filter(r => r && typeof r === 'object' && r.id) : [];
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

    getStorageKeyForContext() {
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.isLocalSandboxMode === 'function' && CloudSync.isLocalSandboxMode()) {
            return CHATS_KEY;
        }
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.isBackendContext === 'function' && CloudSync.isBackendContext()) {
            return ADMIN_CHATS_KEY;
        }
        return CHATS_KEY;
    },

    getAll() {
        const targetKey = this.getStorageKeyForContext();
        let parsed = LocalJsonCache.get(targetKey, null);
        if (!parsed && targetKey === ADMIN_CHATS_KEY) {
            parsed = LocalJsonCache.get(CHATS_KEY, () => ({}));
        }
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    },

    saveAll(allChats) {
        const serialized = JSON.stringify(allChats);
        const targetKey = this.getStorageKeyForContext();
        localStorage.setItem(targetKey, serialized);
        LocalJsonCache.invalidate(targetKey);
        if (targetKey === ADMIN_CHATS_KEY) {
            // 若前台分頁正在觀看其中一間聊天室，同步更新已存在的 key（不覆蓋其他分頁結構）
            try {
                const feRaw = localStorage.getItem(CHATS_KEY);
                if (feRaw) {
                    const feObj = JSON.parse(feRaw);
                    if (feObj && typeof feObj === 'object' && !Array.isArray(feObj)) {
                        let feChanged = false;
                        Object.keys(feObj).forEach(pk => {
                            if (!Object.prototype.hasOwnProperty.call(allChats, pk)) {
                                delete feObj[pk];
                                feChanged = true;
                            } else if (JSON.stringify(feObj[pk]) !== JSON.stringify(allChats[pk])) {
                                feObj[pk] = allChats[pk];
                                feChanged = true;
                            }
                        });
                        if (feChanged) {
                            localStorage.setItem(CHATS_KEY, JSON.stringify(feObj));
                            LocalJsonCache.invalidate(CHATS_KEY);
                        }
                    }
                }
            } catch (e) {}
        }
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
        
        // P0：限制每個聊天室最多保留最近 200 則訊息，避免 DOM 卡頓與超過 localStorage 容量
        let removedIds = [];
        if (all[key].length > 200) {
            const removedMsgs = all[key].slice(0, all[key].length - 200);
            removedIds = removedMsgs.map(m => m.id).filter(Boolean);
            all[key] = all[key].slice(-200);
        }
        
        this.saveAll(all);
        
        if (typeof CloudSync !== 'undefined') {
            const sendPath = `${CHATS_KEY}/${key}/${savedMsg.id}`;
            CloudSync.putNode(sendPath, savedMsg, { throwOnError: true }).then(() => {
                CloudSync.patchNode(`${CHAT_META_KEY}/${key}`, {
                    lastMsg: savedMsg,
                    lastTs: savedMsg.ts,
                    msgCount: all[key].length
                });
            }).catch(() => {
                // 寫入失敗（權杖刷新後仍失敗）：撤回樂觀顯示的假訊息，並通知畫面
                try {
                    const cur = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
                    if (cur && Array.isArray(cur[key])) {
                        cur[key] = cur[key].filter(m => m && m.id !== savedMsg.id);
                        this.saveAll(cur);
                    }
                } catch (e) {}
                CloudSync.applyStreamPatch(sendPath, null);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('chat-send-failed', { detail: { key, msgId: savedMsg.id } }));
                }
            });
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
            CloudSync.deleteNode(`${CHAT_META_KEY}/${key}`);
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

    // 取得每日固定檢查時段鍵值（每日 07:00、15:00、22:00，各 15 分鐘執行視窗）
    getInactiveChatPurgeSlotKey(nowTs = Date.now()) {
        const d = new Date(Number(nowTs) || Date.now());
        if (Number.isNaN(d.getTime())) return '';
        const hr = d.getHours();
        const min = d.getMinutes();
        if (![7, 15, 22].includes(hr) || min > 15) return '';
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(hr).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}_${hh}:00`;
    },

    // 超過 3 天（72 小時）無更新或無新訊息：每日 07:00、15:00、22:00 自動檢查，刪除聊天紀錄（刪除不保存）並自動解除會員列表雙方好友配對
    purgeInactiveRooms(nowTs = Date.now(), maxInactiveMs = 3 * 24 * 60 * 60 * 1000, options = {}) {
        const forceCheck = Boolean(options && options.force);
        const slotLockKey = 'yuelao_last_inactive_chat_purge_slot';
        const cloudPurgeLogNode = 'yuelao_inactive_chat_purge_logs';
        const slotKey = this.getInactiveChatPurgeSlotKey(nowTs);

        if (!forceCheck) {
            if (!slotKey) {
                return [];
            }
            try {
                if (localStorage.getItem(slotLockKey) === slotKey) {
                    return [];
                }
            } catch (e) {}
            if (
                typeof CloudSync !== 'undefined' &&
                CloudSync.tree &&
                CloudSync.tree[cloudPurgeLogNode] &&
                CloudSync.tree[cloudPurgeLogNode][slotKey]
            ) {
                try { localStorage.setItem(slotLockKey, slotKey); } catch (e) {}
                return [];
            }
        }

        if (typeof CloudSync !== 'undefined' && (!CloudSync.initialized || !CloudSync.hasLoadedFullTree || CloudSync.inFlightWrites > 0)) {
            return [];
        }

        if (slotKey) {
            try {
                localStorage.setItem(slotLockKey, slotKey);
            } catch (e) {}
        }

        const allChats = (typeof getAdminChatsMap === 'function') ? getAdminChatsMap() : this.getAll();
        const expiredPairs = [];

        Object.keys(allChats || {}).forEach(pairKey => {
            const rawThread = allChats[pairKey];
            if (!rawThread || typeof rawThread !== 'object') return;
            let lastTs = 0;
            let msgCount = 0;
            if (rawThread.lastMsg && typeof rawThread.lastMsg === 'object') {
                lastTs = Number(rawThread.lastTs || rawThread.lastMsg.ts || 0);
                msgCount = Number(rawThread.msgCount || 1);
            } else {
                const msgs = Array.isArray(rawThread)
                    ? rawThread.filter(m => m && typeof m === 'object')
                    : Object.values(rawThread).filter(m => m && typeof m === 'object');
                if (msgs.length === 0) return;
                msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
                const lastMsg = msgs[msgs.length - 1] || {};
                lastTs = Number(lastMsg.ts || 0);
                msgCount = msgs.length;
            }
            if (lastTs <= 0) return;

            if (nowTs >= lastTs + maxInactiveMs) {
                const parts = String(pairKey).split('__');
                if (parts.length === 2 && parts[0] && parts[1]) {
                    expiredPairs.push({
                        pairKey,
                        idA: String(parts[0]).trim(),
                        idB: String(parts[1]).trim(),
                        lastTs,
                        msgCount
                    });
                }
            }
        });

        if (slotKey && typeof CloudSync !== 'undefined' && CloudSync.initialized) {
            CloudSync.putNode(`${cloudPurgeLogNode}/${slotKey}`, {
                slotKey,
                executedAtTs: nowTs,
                purgedCount: expiredPairs.length
            });
        }

        if (expiredPairs.length === 0) return [];

        let users = [];
        try {
            users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
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
            localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
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
        const parsed = LocalJsonCache.get(REG_HISTORY_KEY, () => ({}));
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    },

    saveAllMap(mapObj) {
        const nextStr = JSON.stringify(mapObj || {});
        if (localStorage.getItem(REG_HISTORY_KEY) !== nextStr) {
            localStorage.setItem(REG_HISTORY_KEY, nextStr);
            LocalJsonCache.invalidate(REG_HISTORY_KEY);
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
        const rawCrit = (user && user.exactMatchCriteria && typeof user.exactMatchCriteria === 'object' && !Array.isArray(user.exactMatchCriteria))
            ? { ...user.exactMatchCriteria }
            : ((existingEntry && existingEntry.exactMatchCriteria && typeof existingEntry.exactMatchCriteria === 'object' && !Array.isArray(existingEntry.exactMatchCriteria))
                ? { ...existingEntry.exactMatchCriteria }
                : {});
        const rawMust = (user && Array.isArray(user.mustMatchKeys))
            ? [...user.mustMatchKeys]
            : (Array.isArray(existingEntry && existingEntry.mustMatchKeys) ? [...existingEntry.mustMatchKeys] : []);
        const mustArr = (typeof normalizeMustMatchKeysList === 'function')
            ? normalizeMustMatchKeysList(rawMust, rawCrit)
            : rawMust.filter(k => Object.prototype.hasOwnProperty.call(rawCrit, k)).slice(0, 2);
        return {
            id: key,
            kind: 'regular',
            session: norm,
            batchLabel: batchLbl,
            playerId: pid,
            nickname: String((user && user.nickname) || (existingEntry && existingEntry.nickname) || '').trim(),
            gender: String((user && user.gender) || (existingEntry && existingEntry.gender) || '').trim(),
            exactMatchCriteria: rawCrit,
            mustMatchKeys: mustArr,
            recordedAt: Number((existingEntry && existingEntry.recordedAt) || Date.now())
        };
    },

    buildCustomEntry(user, actId, regObj, existingEntry = null) {
        const aid = String(actId || '').trim();
        const pid = String((user && user.id) || (existingEntry && existingEntry.playerId) || '').trim();
        const key = this.makeCustomKey(aid, pid);
        if (!key) return null;
        const r = (regObj && typeof regObj === 'object') ? regObj : {};
        const criteriaObj = (r.exactMatchCriteria && typeof r.exactMatchCriteria === 'object' && !Array.isArray(r.exactMatchCriteria))
            ? { ...r.exactMatchCriteria }
            : ((existingEntry && existingEntry.exactMatchCriteria && typeof existingEntry.exactMatchCriteria === 'object' && !Array.isArray(existingEntry.exactMatchCriteria))
                ? { ...existingEntry.exactMatchCriteria }
                : {});
        const rawMust = Array.isArray(r.mustMatchKeys)
            ? r.mustMatchKeys
            : (Array.isArray(existingEntry && existingEntry.mustMatchKeys) ? existingEntry.mustMatchKeys : []);
        const mustKeysArr = (typeof normalizeMustMatchKeysList === 'function')
            ? normalizeMustMatchKeysList(rawMust, criteriaObj)
            : rawMust.filter(k => Object.prototype.hasOwnProperty.call(criteriaObj, k)).slice(0, 2);
        return {
            id: key,
            kind: 'custom',
            activityId: aid,
            activityName: String(r.activityName || (existingEntry && existingEntry.activityName) || '').trim(),
            activityType: String(r.activityType || (existingEntry && existingEntry.activityType) || '').trim(),
            fortuneNumber: r.fortuneNumber || (existingEntry && existingEntry.fortuneNumber) || null,
            twoChoiceValue: String(r.twoChoiceValue || (existingEntry && existingEntry.twoChoiceValue) || '').trim(),
            exactMatchCriteria: criteriaObj,
            mustMatchKeys: mustKeysArr,
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
        if (!prev || prev.nickname !== entry.nickname || prev.gender !== entry.gender || prev.session !== entry.session || JSON.stringify(prev.exactMatchCriteria || {}) !== JSON.stringify(entry.exactMatchCriteria || {}) || JSON.stringify(prev.mustMatchKeys || []) !== JSON.stringify(entry.mustMatchKeys || [])) {
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

// ===== 心動抉擇狀態同步（跨裝置／重新整理不重複觸發）=====
// 三個欄位與時間戳同步寫入雲端 yuelao_users/{pid}；載入時以較新的 confessionUpdatedAt 為準合併
function persistConfessionState() {
    if (typeof CloudSync === 'undefined' || typeof appState === 'undefined' || !appState || !appState.playerId) return;
    const ts = Date.now();
    appState.confessionUpdatedAt = ts;
    try {
        const p = CloudSync.patchUserFields(String(appState.playerId), {
            lastConfessionDate: appState.lastConfessionDate || null,
            confessionUnlockAt: appState.confessionUnlockAt || null,
            lastHandledForceConfessionId: appState.lastHandledForceConfessionId || null,
            confessionUpdatedAt: ts
        });
        if (p && typeof p.catch === 'function') p.catch(err => console.warn('[confession] 雲端同步失敗', err));
    } catch (e) {
        console.warn('[confession] 雲端同步失敗', e);
    }
}

function mergeConfessionFromCloud(localState, cloudRec) {
    if (!localState || !cloudRec || typeof cloudRec !== 'object') return false;
    let changed = false;
    const cloudTs = Number(cloudRec.confessionUpdatedAt || 0);
    const localTs = Number(localState.confessionUpdatedAt || 0);
    if (cloudTs > localTs) {
        localState.lastConfessionDate = cloudRec.lastConfessionDate || null;
        localState.confessionUnlockAt = cloudRec.confessionUnlockAt || null;
        localState.confessionUpdatedAt = cloudTs;
        changed = true;
    }
    const cloudForce = cloudRec.lastHandledForceConfessionId ? String(cloudRec.lastHandledForceConfessionId) : '';
    if (cloudForce && cloudForce !== String(localState.lastHandledForceConfessionId || '')) {
        localState.lastHandledForceConfessionId = cloudForce;
        changed = true;
    }
    return changed;
}

// ===== 本機狀態存檔：好友訊息只保留最新 5 則摘要（完整訊息由 yuelao_chats 管理），並防止配額超限導致存檔失敗 =====
function compactStateForStorage(state) {
    const copy = JSON.parse(JSON.stringify(state));
    if (Array.isArray(copy.friends)) {
        copy.friends = copy.friends.map(f => {
            if (!f || typeof f !== 'object' || String(f.id || '').startsWith('MOCK_FRIEND_')) return f;
            const msgs = Array.isArray(f.messages) ? f.messages.slice(-5) : [];
            return { ...f, messages: msgs.map(m => (m && typeof m.text === 'string' && m.text.length > 120)
                ? { ...m, text: m.text.slice(0, 120) + '…' } : m) };
        });
    }
    return copy;
}

function writeStateSafely(key, state) {
    try {
        localStorage.setItem(key, JSON.stringify(compactStateForStorage(state)));
        return true;
    } catch (e) {
        console.warn('[Store] 狀態存檔失敗（可能超過容量）', key, e);
        return false;
    }
}

