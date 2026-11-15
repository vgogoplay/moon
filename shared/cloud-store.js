/* shared/cloud-store.js - 前後台共用：Firebase 即時雲端同步、玩家資料庫、信箱與聊天室管理器 */

const STORAGE_KEY = 'yuelao_romance_app_v2';
const USERS_KEY = 'yuelao_users';
const REPORTS_KEY = 'yuelao_reports';
const ID_COUNTER_KEY = 'yuelao_id_counters';
const SYSTEM_STATE_KEY = 'yuelao_system_batch';
const BANNED_RULES_KEY = 'yuelao_banned_rules';
const MAILBOX_KEY = 'yuelao_mailbox';
const CHATS_KEY = 'yuelao_chats';
const CUSTOM_ACTIVITIES_KEY = 'yuelao_custom_activities';
const FORCE_KEY = 'yuelao_force_matches';
const AUTO_RUN_LOG_KEY = 'yuelao_auto_matched_sessions';
const FRONTEND_STORAGE_KEY = 'yuelao_romance_app_v2';
const TAB_PLAYER_ID_KEY = 'yuelao_tab_player_id';
const PLAYER_STATE_PREFIX = 'yuelao_player_state_';
const PENDING_USERS_SYNC_KEY = 'yuelao_pending_users_sync';
const DELETED_USERS_SYNC_KEY = 'yuelao_deleted_users_sync';

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
    pendingUsers: {},
    deletedUsers: {},

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

    setSharedPendingUser(pid, record, ttlMs = 15000) {
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

    mapToArray(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter(item => item && typeof item === 'object');
        if (typeof raw === 'object') return Object.values(raw).filter(item => item && typeof item === 'object');
        return [];
    },

    chatsMapToLocal(raw) {
        const result = {};
        if (!raw || typeof raw !== 'object') return result;
        Object.keys(raw).forEach(pairKey => {
            const threadRaw = raw[pairKey];
            const msgs = this.mapToArray(threadRaw);
            msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
            result[pairKey] = msgs;
        });
        return result;
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
            cleanUser.registeredSessions = Array.isArray(cleanUser.registeredSessions)
                ? Array.from(new Set(cleanUser.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)))
                : [];
            cleanUser.exactMatchCriteria = (cleanUser.exactMatchCriteria && typeof cleanUser.exactMatchCriteria === 'object' && !Array.isArray(cleanUser.exactMatchCriteria))
                ? cleanUser.exactMatchCriteria
                : {};
            cleanUser.customActivityRegs = (cleanUser.customActivityRegs && typeof cleanUser.customActivityRegs === 'object' && !Array.isArray(cleanUser.customActivityRegs))
                ? cleanUser.customActivityRegs
                : {};
            return cleanUser;
        });
        localStorage.setItem(USERS_KEY, JSON.stringify(usersArr));
        usersArr.forEach(u => {
            if (u && u.id) {
                this.lastPushedUsersJson[String(u.id)] = JSON.stringify(u);
            }
        });

        // 2. 聊天紀錄
        localStorage.setItem(CHATS_KEY, JSON.stringify(this.chatsMapToLocal(t[CHATS_KEY])));

        // 3. 系統開關與期數設定
        if (t[SYSTEM_STATE_KEY] && typeof t[SYSTEM_STATE_KEY] === 'object') {
            localStorage.setItem(SYSTEM_STATE_KEY, JSON.stringify(t[SYSTEM_STATE_KEY]));
        } else {
            localStorage.removeItem(SYSTEM_STATE_KEY);
        }

        // 4. 管理員信箱（依時間新到舊排序）
        const mailsArr = this.mapToArray(t[MAILBOX_KEY]);
        mailsArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        localStorage.setItem(MAILBOX_KEY, JSON.stringify(mailsArr));

        // 5. 問題回報（依時間新到舊排序）
        const reportsArr = this.mapToArray(t[REPORTS_KEY]);
        reportsArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        localStorage.setItem(REPORTS_KEY, JSON.stringify(reportsArr));

        // 6. 禁止字眼規則
        if (t[BANNED_RULES_KEY] !== undefined) {
            localStorage.setItem(BANNED_RULES_KEY, JSON.stringify(this.mapToArray(t[BANNED_RULES_KEY])));
        }

        // 7. 後台秘密強制配對與自動執行紀錄
        if (t[FORCE_KEY] !== undefined) {
            localStorage.setItem(FORCE_KEY, JSON.stringify(this.mapToArray(t[FORCE_KEY])));
        }
        if (t[AUTO_RUN_LOG_KEY] && typeof t[AUTO_RUN_LOG_KEY] === 'object') {
            localStorage.setItem(AUTO_RUN_LOG_KEY, JSON.stringify(t[AUTO_RUN_LOG_KEY]));
        }

        // 8. ID 計數器
        if (t[ID_COUNTER_KEY] && typeof t[ID_COUNTER_KEY] === 'object') {
            localStorage.setItem(ID_COUNTER_KEY, JSON.stringify(t[ID_COUNTER_KEY]));
        }

        // 9. 後台自定義專屬活動（第 2 種活動）
        if (t[CUSTOM_ACTIVITIES_KEY] !== undefined) {
            const actsArr = this.mapToArray(t[CUSTOM_ACTIVITIES_KEY]);
            actsArr.sort((a, b) => Number(a.createdAtTs || 0) - Number(b.createdAtTs || 0));
            localStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(actsArr));
        } else {
            localStorage.setItem(CUSTOM_ACTIVITIES_KEY, '[]');
        }

        // 10. 互動流程測試指令（支援跨瀏覽器即時連動新增／刪除測試好友）
        if (t['yuelao_test_event'] && typeof t['yuelao_test_event'] === 'object') {
            localStorage.setItem('yuelao_test_event', JSON.stringify(t['yuelao_test_event']));
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

    updateCloudBadge(isOnline) {
        const badge = document.getElementById('cloudStatusBadge');
        if (!badge) return;
        if (isOnline) {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 font-semibold';
            badge.textContent = '☁️ Firebase 雲端已即時同步';
        } else {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-700 font-semibold';
            badge.textContent = '⚠️ 雲端重連中（暫用本地快取）';
        }
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

        if (!this.pollTimer) {
            this.pollTimer = setInterval(async () => {
                const ok = await this.fetchFullTree();
                if (ok && typeof this.onUpdateCallback === 'function') {
                    this.onUpdateCallback();
                }
            }, 3500);
        }

        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
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
        }
    },

    async patchNode(path, patchObj) {
        this.inFlightWrites++;
        this.writeEpoch++;
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
        }
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

    async upsertUser(record, forcePush = false) {
        if (!record || !record.id) return;
        const pid = String(record.id);
        if (!forcePush && this.isUserDeleted(pid)) return;
        const cleanRecord = { ...record };
        delete cleanRecord.registeredSession;
        cleanRecord.registeredSessions = Array.isArray(cleanRecord.registeredSessions)
            ? Array.from(new Set(cleanRecord.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)))
            : [];
        cleanRecord.exactMatchCriteria = (cleanRecord.exactMatchCriteria && typeof cleanRecord.exactMatchCriteria === 'object' && !Array.isArray(cleanRecord.exactMatchCriteria))
            ? cleanRecord.exactMatchCriteria
            : {};
        cleanRecord.customActivityRegs = (cleanRecord.customActivityRegs && typeof cleanRecord.customActivityRegs === 'object' && !Array.isArray(cleanRecord.customActivityRegs))
            ? cleanRecord.customActivityRegs
            : {};
        const serialized = JSON.stringify(cleanRecord);
        if (!forcePush && this.lastPushedUsersJson[pid] === serialized) return;
        this.lastPushedUsersJson[pid] = serialized;
        this.setSharedPendingUser(pid, cleanRecord, 15000);

        await this.putNode(`${USERS_KEY}/${pid}`, cleanRecord);
        const cleanupTasks = [];
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
            this.setSharedPendingUser(pid, cleanRecord, 8000);
        }
    },

    syncUsersArray(usersArr) {
        const list = Array.isArray(usersArr) ? usersArr : [];
        // 僅同步更新名單內的玩家，絕不因舊快照暫時缺少某 ID 而誤發 DELETE 刪除雲端玩家（刪除僅由管理員明確刪除操作觸發）
        list.forEach(u => {
            if (u && u.id && !this.isUserDeleted(u.id)) {
                this.upsertUser(u);
            }
        });
    },

    async clearAll() {
        this.tree = {};
        this.lastPushedUsersJson = {};
        this.pendingUsers = {};
        this.deletedUsers = {};
        try {
            localStorage.removeItem(PENDING_USERS_SYNC_KEY);
            localStorage.removeItem(DELETED_USERS_SYNC_KEY);
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
                genderLimitMax: sys.genderLimitMax !== undefined ? Math.max(1, Number(sys.genderLimitMax)) : 30
            };
        } catch (e) {
            return {
                currentBatch: autoBatch,
                autoBatch: autoBatch,
                batchOffset: 0,
                registrationOpen: true,
                profileLocked: false,
                genderLimitEnabled: false,
                genderLimitMax: 30
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
        const femaleFull = enabled && counts.female >= limit;
        const bothFull = enabled && maleFull && femaleFull;
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
            lastConfessionDate: null
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

        if (state.profile && state.profile.city && !state.profile.region) {
            state.profile.region = inferRegionByCity(state.profile.city);
        }
        if (state.profile && state.profile.mbti && !state.profile.mbtiGroup) {
            state.profile.mbtiGroup = inferMbtiGroup(state.profile.mbti);
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
            const existingRecord = idx >= 0 ? users[idx] : {};

            const mergedProfileForRecord = {
                ...state.profile,
                nickname: (state.profile.nickname && String(state.profile.nickname).trim()) || `玩家_${state.playerId}`,
                region: state.profile.region || inferRegionByCity(state.profile.city),
                mbtiGroup: state.profile.mbtiGroup || inferMbtiGroup(state.profile.mbti)
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
                isMatchBanned: Boolean(existingRecord.isMatchBanned),
                isChatBanned: Boolean(existingRecord.isChatBanned),
                registeredSessions: state.isWarnedAccount ? [] : (Array.isArray(state.registeredSessions) ? state.registeredSessions : []),
                exactMatchCriteria: state.exactMatchCriteria || {},
                customActivityRegs: state.isWarnedAccount ? {} : (state.customActivityRegs || {}),
                matchedHistory: Array.isArray(existingRecord.matchedHistory) ? existingRecord.matchedHistory : [],
                matchedSession: state.matchedSession || existingRecord.matchedSession || null,
                matchedWithId: existingRecord.matchedWithId || null,
                matchedWithName: state.friends.map(f => f.nickname).join(', ') || existingRecord.matchedWithName || null,
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

    saveSharedUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
        if (typeof CloudSync !== 'undefined') CloudSync.syncUsersArray(users);
    },

    addIssueReport(report) {
        const reports = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
        const newRep = {
            id: 'R' + Date.now().toString().slice(-6),
            category: report.category,
            contact: report.contact || '匿名玩家',
            content: report.content,
            status: '待處理',
            ts: Date.now(),
            createdAt: new Date().toLocaleString('zh-TW')
        };
        reports.unshift(newRep);
        localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
        if (typeof CloudSync !== 'undefined') CloudSync.putNode(`${REPORTS_KEY}/${newRep.id}`, newRep);
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

    ensureThread(id1, id2, initialMessages = []) {
        if (!id1 || !id2) return [];
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        if (!Array.isArray(all[key]) || all[key].length === 0) {
            all[key] = initialMessages.map((m, idx) => ({
                id: m.id || `INIT_${key}_${idx}`,
                senderId: String(m.senderId || 'system'),
                senderName: m.senderName || '',
                text: m.text || '',
                time: m.time || '',
                ts: m.ts || (Date.now() + idx)
            }));
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
        const savedMsg = {
            id: msg.id || `MSG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            senderId: String(msg.senderId),
            senderName: msg.senderName || '',
            text: msg.text,
            time: msg.time || '',
            ts: msg.ts || Date.now()
        };
        all[key].push(savedMsg);
        this.saveAll(all);
        if (typeof CloudSync !== 'undefined') {
            CloudSync.putNode(`${CHATS_KEY}/${key}/${savedMsg.id}`, savedMsg);
        }
        return all[key];
    },

    clearChat(id1, id2) {
        if (!id1 || !id2) return;
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
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
    }
};
