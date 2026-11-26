#!/usr/bin/env node
/**
 * scripts/auto-match-2000.js
 * 月老牽線計畫：免開分頁雲端全自動 20:00 配對腳本（供 GitHub Actions 定時排程執行）
 *
 * 環境變數（請設定於 GitHub Repository Secrets）：
 *   FIREBASE_ADMIN_EMAIL    - 後台管理員登入 Email
 *   FIREBASE_ADMIN_PASSWORD - 後台管理員登入密碼
 *   FORCE_RUN_SESSION       - （選填）手動測試時指定場次名稱，例如 "第3屆11/26(四)"
 *   DRY_RUN                 - （選填）設為 "1" 時僅試算不寫入雲端
 */

const FIREBASE_DB_URL = 'https://moon1-cb403-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_WEB_API_KEY = 'AIzaSyDaxEsjb85uhiP2y2xsi4nn_Er9ziwQIiI';

const USERS_KEY = 'yuelao_users';
const USER_INDEX_KEY = 'yuelao_user_index';
const PAIR_PROFILES_KEY = 'yuelao_pair_profiles';
const PAIR_IG_KEY = 'yuelao_pair_ig';
const SYSTEM_STATE_KEY = 'yuelao_system_batch';
const FORCE_KEY = 'yuelao_force_matches';
const AUTO_RUN_LOG_KEY = 'yuelao_auto_matched_sessions';
const REG_HISTORY_KEY = 'yuelao_activity_reg_history';
const SESSION_MATCH_RESULTS_KEY = 'yuelao_session_match_results';
const UNMATCHED_PAIRS_CLOUD_NODE = 'yuelao_unmatched_pairs';
const CHATS_KEY = 'yuelao_chats';
const CHAT_META_KEY = 'yuelao_chat_meta';

const MAX_MALE_REGULAR_SESSIONS = 2;

const REGION_CITIES = {
    '北部': ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'],
    '中部': ['苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣'],
    '南部': ['嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣', '澎湖縣'],
    '東部': ['花蓮縣', '台東縣', '金門縣', '連江縣']
};

const FIELD_LABELS = {
    gender: '性別', mbti: 'MBTI', ageRange: '年齡範圍', region: '居住地區', city: '居住縣市',
    height: '身高', hasPet: '養寵物', smoking: '抽煙', drinking: '喝酒', lookingFor: '想找關係'
};

// ==================== 台灣時間（UTC+8）排程與場次計算 ====================
function getTaipeiNow(dateObj = new Date()) {
    const utcMs = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000;
    return new Date(utcMs + 8 * 3600000);
}

function getSundayOfWeek(dateObj) {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
}

function formatMonthDay(dateObj) {
    return `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
}

function getBatchScheduleInfo(batchNum) {
    const b = Math.max(1, Number(batchNum || 1));
    const baseSunday = new Date(2026, 10, 8, 0, 0, 0, 0); // 2026/11/08 (日) 起算第1屆
    const sunday = new Date(baseSunday);
    sunday.setDate(baseSunday.getDate() + (b - 1) * 7);

    const tue = new Date(sunday); tue.setDate(sunday.getDate() + 2);
    const wed = new Date(sunday); wed.setDate(sunday.getDate() + 3);
    const thu = new Date(sunday); thu.setDate(sunday.getDate() + 4);
    const sat = new Date(sunday); sat.setDate(sunday.getDate() + 6);

    const tueDateStr = formatMonthDay(tue);
    const wedDateStr = formatMonthDay(wed);
    const thuDateStr = formatMonthDay(thu);
    const satDateStr = formatMonthDay(sat);

    const tueLabel = `第${b}屆${tueDateStr}(二)`;
    const wedLabel = `第${b}屆${wedDateStr}(三)`;
    const thuLabel = `第${b}屆${thuDateStr}(四)`;
    const satLabel = `第${b}屆${satDateStr}(六)`;

    return {
        batch: b,
        batchPrefix: `第${b}屆`,
        sunday, tue, wed, thu, sat,
        tueLabel, wedLabel, thuLabel, satLabel,
        sessions: [tueLabel, thuLabel, satLabel]
    };
}

function calcAutoBatchNumber(tpeNow) {
    const baseSunday = new Date(2026, 10, 8, 0, 0, 0, 0);
    const currentSunday = getSundayOfWeek(tpeNow);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const diffWeeks = Math.round((currentSunday.getTime() - baseSunday.getTime()) / weekMs);
    return Math.max(1, 1 + diffWeeks);
}

function normalizeSessionLabel(sessionStr) {
    const raw = String(sessionStr || '').trim();
    if (!raw) return '';
    const batchMatch = raw.match(/^第\s*(\d+)\s*屆/);
    if (!batchMatch) return raw;
    const b = Math.max(1, parseInt(batchMatch[1], 10));
    const info = getBatchScheduleInfo(b);
    if (/(二|星期二|週二)/.test(raw)) return info.tueLabel;
    if (/(四|星期四|週四)/.test(raw)) return info.thuLabel;
    if (/(六|星期六|週六)/.test(raw)) return info.satLabel;
    if (/(三|星期三|週三)/.test(raw)) return info.wedLabel;
    return info.batchPrefix;
}

function isSameSession(s1, s2) {
    const n1 = normalizeSessionLabel(s1);
    const n2 = normalizeSessionLabel(s2);
    return n1 !== '' && n1 === n2;
}

function extractBatchLabel(sessionStr) {
    const m = String(sessionStr || '').match(/^第\s*\d+\s*屆/);
    return m ? m[0].replace(/\s+/g, '') : String(sessionStr || '');
}

// ==================== Firebase Auth & REST API 輔助 ====================
function encodePath(p) {
    return String(p || '').split('/').filter(Boolean).map(s => encodeURIComponent(s)).join('/');
}

async function signInAdmin(email, password) {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const data = await res.json();
    if (!res.ok || !data.idToken) {
        throw new Error(`管理員登入失敗: ${(data.error && data.error.message) || res.status}`);
    }
    return data.idToken;
}

async function fbGet(path, idToken) {
    const res = await fetch(`${FIREBASE_DB_URL}/${encodePath(path)}.json?auth=${encodeURIComponent(idToken)}`, {
        method: 'GET'
    });
    if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`);
    return await res.json();
}

async function fbPut(path, value, idToken) {
    const res = await fetch(`${FIREBASE_DB_URL}/${encodePath(path)}.json?auth=${encodeURIComponent(idToken)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
    });
    if (!res.ok) throw new Error(`PUT ${path} failed: HTTP ${res.status}`);
    return await res.json();
}

async function fbPatch(path, value, idToken) {
    const res = await fetch(`${FIREBASE_DB_URL}/${encodePath(path)}.json?auth=${encodeURIComponent(idToken)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: HTTP ${res.status}`);
    return await res.json();
}

function mapToArray(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(x => x && typeof x === 'object');
    if (typeof raw === 'object') return Object.values(raw).filter(x => x && typeof x === 'object');
    return [];
}

function normalizeStringArray(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(v => String(v ?? '').trim()).filter(Boolean);
    if (typeof raw === 'object') return Object.values(raw).map(v => String(v ?? '').trim()).filter(Boolean);
    return [];
}

// ==================== 條件相容與配對演算法（與 backend/matching.js 完全一致） ====================
function inferRegionByCity(city) {
    const c = String(city || '').trim();
    if (!c) return '';
    for (const [reg, list] of Object.entries(REGION_CITIES)) {
        if (list.includes(c)) return reg;
    }
    return '';
}

function inferMbtiGroup(mbti) {
    const m = String(mbti || '').trim().toUpperCase();
    if (!m || m.includes('不知道') || m.includes('沒測過')) return '不知道 / 沒測過';
    if (m.startsWith('I')) return 'I人';
    if (m.startsWith('E')) return 'E人';
    return '';
}

function parsePetCriterionValue(rawVal) {
    const s = String(rawVal || '').trim();
    if (!s) return { status: '', petType: '' };
    if (s === '沒有養寵物') return { status: '沒有養寵物', petType: '' };
    const m = s.match(/^有養寵物[（(](.+)[）)]$/);
    if (m) return { status: '有養寵物', petType: m[1].trim() };
    if (s === '有養寵物') return { status: '有養寵物', petType: '不限' };
    return { status: '有養寵物', petType: s };
}

function resolveUserActualGender(u) {
    if (!u || typeof u !== 'object') return '';
    const g = String(u.gender || '').trim();
    if (g === '男' || g === '男生') return '男';
    if (g === '女' || g === '女生') return '女';
    const pid = String(u.id || '').trim();
    if (pid.startsWith('1')) return '男';
    if (pid.startsWith('2')) return '女';
    return '';
}

function isMalePlayerRecord(u) {
    return resolveUserActualGender(u) === '男';
}

function checkSingleCriterion(key, desiredVal, candidate) {
    if (!candidate) return false;
    if (key === 'mbti') {
        const want = String(desiredVal || '').trim();
        if (!want) return false;
        const candRaw = String(candidate.mbti || '').trim().toUpperCase();
        const candGroup = String(candidate.mbtiGroup || inferMbtiGroup(candRaw)).trim();
        if (want === 'I人' || want === 'E人') return candGroup === want;
        return candRaw === want.toUpperCase();
    }
    if (key === 'region') {
        const candReg = candidate.region || inferRegionByCity(candidate.city);
        const list = REGION_CITIES[desiredVal] || [];
        return candReg === desiredVal || list.includes(candidate.city);
    }
    if (key === 'gender') {
        const cGender = resolveUserActualGender(candidate);
        if (desiredVal === '女' || desiredVal === '女生') return cGender === '女';
        if (desiredVal === '男' || desiredVal === '男生') return cGender === '男';
        return cGender === desiredVal;
    }
    if (key === 'ageRange') {
        const age = Number(candidate.age);
        if (!age) return false;
        if (desiredVal === '22~25歲') return age >= 22 && age <= 25;
        if (desiredVal === '26~30歲') return age >= 26 && age <= 30;
        if (desiredVal === '31~35歲') return age >= 31 && age <= 35;
        if (desiredVal === '36~40歲') return age >= 36 && age <= 40;
        if (desiredVal === '18~22歲') return age >= 18 && age <= 22;
        if (desiredVal === '23~26歲') return age >= 23 && age <= 26;
        if (desiredVal === '27~30歲') return age >= 27 && age <= 30;
        if (desiredVal === '36歲以上') return age >= 36;
        return false;
    }
    if (key === 'height') {
        const h = Number(candidate.height);
        const minH = parseInt(desiredVal, 10);
        return !isNaN(h) && !isNaN(minH) && h >= minH;
    }
    if (key === 'hasPet') {
        const want = String(desiredVal || '').trim();
        if (!want) return false;
        const candPet = String(candidate.hasPet || '').trim();
        if (!candPet) return false;
        if (want === '沒有養寵物') return candPet === '沒有養寵物';
        const parsed = parsePetCriterionValue(want);
        if (parsed.status === '沒有養寵物') return candPet === '沒有養寵物';
        if (candPet === '沒有養寵物') return false;
        if (!parsed.petType || parsed.petType === '不限' || parsed.petType.startsWith('不限')) return true;
        return candPet === parsed.petType;
    }
    return candidate[key] === desiredVal;
}

function acceptsCandidate(seeker, candidate) {
    const cGender = resolveUserActualGender(candidate);
    if (cGender !== '男' && cGender !== '女') return false;

    const criteria = (seeker.exactMatchCriteria && typeof seeker.exactMatchCriteria === 'object') ? seeker.exactMatchCriteria : {};
    const mustKeys = Array.isArray(seeker.mustMatchKeys) ? seeker.mustMatchKeys : [];

    const pref = String(seeker.targetGender || '').trim();
    if ((pref === '男生' || pref === '男') && cGender !== '男') return false;
    if ((pref === '女生' || pref === '女') && cGender !== '女') return false;

    const critG = String(criteria.gender || '').trim();
    if ((critG === '男生' || critG === '男') && cGender !== '男') return false;
    if ((critG === '女生' || critG === '女') && cGender !== '女') return false;

    const activeKeys = Object.keys(criteria).filter(k => k !== 'gender' && !(k === 'city' && criteria.region));
    if (activeKeys.length === 0) return true;

    const validMust = mustKeys.filter(k => k !== 'gender' && Object.prototype.hasOwnProperty.call(criteria, k)).slice(0, 2);
    const mustSet = new Set(validMust);
    const orKeys = activeKeys.filter(k => !mustSet.has(k));

    for (const mk of validMust) {
        if (!checkSingleCriterion(mk, criteria[mk], candidate)) return false;
    }
    if (orKeys.length === 0) return true;
    return orKeys.some(k => checkSingleCriterion(k, criteria[k], candidate));
}

function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function findMaximumCompatibilityMatching(pool, adj) {
    const n = pool.length;
    const matchOf = new Array(n).fill(-1);
    if (n < 2) return matchOf;

    const order = Array.from({ length: n }, (_, idx) => idx).sort((a, b) => adj[a].length - adj[b].length);
    order.forEach(u => {
        if (matchOf[u] !== -1) return;
        const neighbors = [...adj[u]].sort((a, b) => adj[a].length - adj[b].length);
        for (const v of neighbors) {
            if (matchOf[v] === -1) {
                matchOf[u] = v;
                matchOf[v] = u;
                break;
            }
        }
    });

    const p = new Array(n).fill(-1);
    const base = new Array(n).fill(0);
    const used = new Array(n).fill(false);
    const blossom = new Array(n).fill(false);

    const lca = (a, b) => {
        const visited = new Array(n).fill(false);
        while (true) {
            a = base[a]; visited[a] = true;
            if (matchOf[a] === -1) break;
            a = p[matchOf[a]];
        }
        while (true) {
            b = base[b];
            if (visited[b]) return b;
            b = p[matchOf[b]];
        }
    };

    const markPath = (v, b, children) => {
        while (base[v] !== b) {
            blossom[base[v]] = blossom[base[matchOf[v]]] = true;
            p[v] = children;
            children = matchOf[v];
            v = p[matchOf[v]];
        }
    };

    const findAugmentingPath = (root) => {
        used.fill(false);
        p.fill(-1);
        for (let i = 0; i < n; i++) base[i] = i;
        const q = [root];
        used[root] = true;
        let qHead = 0;
        while (qHead < q.length) {
            const v = q[qHead++];
            for (const to of adj[v]) {
                if (base[v] === base[to] || matchOf[v] === to) continue;
                if (to === root || (matchOf[to] !== -1 && p[matchOf[to]] !== -1)) {
                    const curBase = lca(v, to);
                    blossom.fill(false);
                    markPath(v, curBase, to);
                    markPath(to, curBase, v);
                    for (let i = 0; i < n; i++) {
                        if (blossom[base[i]]) {
                            base[i] = curBase;
                            if (!used[i]) { used[i] = true; q.push(i); }
                        }
                    }
                } else if (p[to] === -1) {
                    p[to] = v;
                    if (matchOf[to] === -1) return to;
                    const nextV = matchOf[to];
                    used[nextV] = true;
                    q.push(nextV);
                }
            }
        }
        return -1;
    };

    for (let i = 0; i < n; i++) {
        if (matchOf[i] === -1 && adj[i].length > 0) {
            const v = findAugmentingPath(i);
            let cur = v;
            while (cur !== -1) {
                const pv = p[cur];
                const ppv = matchOf[pv];
                matchOf[cur] = pv;
                matchOf[pv] = cur;
                cur = ppv;
            }
        }
    }
    return matchOf;
}

function hasUserMatchedInRegularSession(user, targetSession) {
    if (!user || !targetSession) return false;
    const normTarget = normalizeSessionLabel(targetSession);
    if (!normTarget || String(normTarget).includes('強制')) return false;
    const rawHist = mapToArray(user.matchedHistory);
    if (rawHist.some(h => h && !h.activityId && isSameSession(h.session, normTarget))) return true;
    if (user.matchedWithId && user.matchedSession && isSameSession(user.matchedSession, normTarget)) return true;
    return false;
}

function formatUserCriteriaPlainText(u) {
    if (!u || typeof u !== 'object') return '不限制（隨機配對）';
    const crit = (u.exactMatchCriteria && typeof u.exactMatchCriteria === 'object') ? u.exactMatchCriteria : {};
    const keys = Object.keys(crit).filter(k => !(k === 'city' && crit.region));
    if (keys.length === 0) return '不限制（隨機配對）';
    const mustSet = new Set((Array.isArray(u.mustMatchKeys) ? u.mustMatchKeys : []).map(String).filter(k => keys.includes(k)).slice(0, 2));
    const labelOf = (k) => k === 'region' ? `居住地區:${crit.region}` : `${FIELD_LABELS[k] || k}:${crit[k]}`;
    const mustList = keys.filter(k => mustSet.has(k)).map(labelOf);
    const orList = keys.filter(k => !mustSet.has(k)).map(labelOf);
    const parts = [];
    if (mustList.length > 0) parts.push(`🔒必須:${mustList.join('+')}`);
    if (orList.length > 0) parts.push(`✨選填:${orList.join('/')}`);
    return parts.join(' ｜ ') || '不限制（隨機配對）';
}

function diagnoseSessionUnmatchedReason(user, allSessionUsers, reservedIds) {
    if (!user) return '資料異常';
    const uid = String(user.id || '').trim();
    if (user.isWarned) return '⚠️ 警告帳號（系統不提供配對）';
    if (user.isMatchBanned) return '🚫 管理員設定「禁止配對」';
    if (reservedIds.has(uid)) return '🔒 秘密強制配對保留名單未觸發';

    const others = allSessionUsers.filter(other => other && String(other.id).trim() !== uid && !other.isWarned && !other.isMatchBanned);
    if (others.length === 0) return '🔍 本場次無其他可參與配對的玩家';

    let uAcceptsCount = 0;
    let othersAcceptUCount = 0;
    let mutualCompatCount = 0;
    others.forEach(other => {
        const uOk = acceptsCandidate(user, other);
        const oOk = acceptsCandidate(other, user);
        if (uOk) uAcceptsCount++;
        if (oOk) othersAcceptUCount++;
        if (uOk && oOk) mutualCompatCount++;
    });
    if (mutualCompatCount > 0) return `⏳ 場內有 ${mutualCompatCount} 位互相符合的對象，但名額已被其他玩家優先配對走（可補跑配對）`;
    if (uAcceptsCount === 0) return '🔍 自身開出的條件過嚴（場內異性無人同時符合此玩家條件）';
    if (othersAcceptUCount === 0) return '🔍 未符合其他異性玩家開出的條件（場內無人同時接受此玩家條件）';
    return '🔍 單向有符合對象，但雙方條件未同時互中（互選交集為 0）';
}

function buildPairProfileRecord(u) {
    if (!u || !u.id) return null;
    const priv = (u.privacy && typeof u.privacy === 'object') ? u.privacy : {};
    const out = { id: String(u.id), privacy: priv };
    const alwaysKeys = ['nickname', 'gender', 'age', 'region', 'city', 'mbti', 'mbtiGroup', 'oneSentence', 'bio', 'icebreakerQuestion', 'hobbies', 'hobbiesOther'];
    alwaysKeys.forEach(k => { if (u[k] !== undefined) out[k] = u[k]; });
    Object.keys(priv).forEach(k => {
        if (k !== 'ig' && priv[k] === 'open' && u[k] !== undefined) out[k] = u[k];
    });
    return out;
}

// ==================== 主流程 ====================
async function main() {
    const email = (process.env.FIREBASE_ADMIN_EMAIL || '').trim();
    const password = (process.env.FIREBASE_ADMIN_PASSWORD || '').trim();
    const dryRun = process.env.DRY_RUN === '1';

    if (!email || !password) {
        console.error('❌ 缺少環境變數 FIREBASE_ADMIN_EMAIL 或 FIREBASE_ADMIN_PASSWORD');
        process.exit(1);
    }

    const tpeNow = getTaipeiNow(new Date());
    const dayOfWeek = tpeNow.getDay(); // 2=週二, 4=週四, 6=週六
    console.log(`[auto-match-2000] 目前台灣時間：${tpeNow.toISOString().replace('T', ' ').slice(0, 19)} (星期${['日','一','二','三','四','五','六'][dayOfWeek]})`);

    const idToken = await signInAdmin(email, password);
    console.log('✅ Firebase 管理員驗證成功');

    const [sysRaw, usersRaw, forceRaw, autoLogRaw, regHistRaw, smrRaw, unmatchedRaw] = await Promise.all([
        fbGet(SYSTEM_STATE_KEY, idToken),
        fbGet(USERS_KEY, idToken),
        fbGet(FORCE_KEY, idToken),
        fbGet(AUTO_RUN_LOG_KEY, idToken),
        fbGet(REG_HISTORY_KEY, idToken),
        fbGet(SESSION_MATCH_RESULTS_KEY, idToken),
        fbGet(UNMATCHED_PAIRS_CLOUD_NODE, idToken)
    ]);

    const sys = (sysRaw && typeof sysRaw === 'object') ? sysRaw : {};
    const autoBatch = calcAutoBatchNumber(tpeNow);
    const currentBatch = Math.max(1, autoBatch + Number(sys.batchOffset || 0));
    const sched = getBatchScheduleInfo(currentBatch);

    let targetSession = (process.env.FORCE_RUN_SESSION || '').trim();
    if (!targetSession) {
        if (![2, 4, 6].includes(dayOfWeek)) {
            console.log('ℹ️ 今日非週二、週四或週六開獎日，結束執行。');
            return;
        }
        targetSession = dayOfWeek === 2 ? sched.tueLabel : (dayOfWeek === 4 ? sched.thuLabel : sched.satLabel);
    }
    targetSession = normalizeSessionLabel(targetSession);
    const batchName = extractBatchLabel(targetSession);
    const dateKey = `${tpeNow.toDateString()}_2000`;

    console.log(`🎯 目標配對場次：【${targetSession}】（dateKey: ${dateKey}）`);

    const executedMap = (autoLogRaw && typeof autoLogRaw === 'object') ? { ...autoLogRaw } : {};
    if (!process.env.FORCE_RUN_SESSION && executedMap[dateKey]) {
        console.log(`✅ 今日 (${dateKey}) 已完成過自動配對（雲端鎖定已存在），不重複執行。`);
        return;
    }

    const usersMap = (usersRaw && typeof usersRaw === 'object') ? usersRaw : {};
    const users = Object.entries(usersMap)
        .filter(([, u]) => u && typeof u === 'object')
        .map(([k, u]) => ({
            ...u,
            id: String(u.id || k).trim(),
            registeredSessions: Array.from(new Set(normalizeStringArray(u.registeredSessions).map(normalizeSessionLabel).filter(Boolean))),
            matchedHistory: mapToArray(u.matchedHistory)
        }));

    const userById = new Map();
    users.forEach(u => userById.set(u.id, u));

    const unmatchedMap = (unmatchedRaw && typeof unmatchedRaw === 'object') ? unmatchedRaw : {};
    const isPairUnmatched = (idA, idB) => {
        const a = String(idA || '').trim();
        const b = String(idB || '').trim();
        if (!a || !b || a === b) return false;
        const pk = [a, b].sort().join('__');
        const entry = unmatchedMap[pk];
        if (!entry) return false;
        if (entry.permanent) return true;
        return Date.now() <= Number(entry.graceUntil || 0);
    };

    // 雙向收集本場次已配對玩家與所有報名玩家（含 ActivityRegArchive 封存名單）
    const pairedThisSessionIds = new Set();
    const sessionRegUserMap = new Map();

    users.forEach(u => {
        if (hasUserMatchedInRegularSession(u, targetSession)) {
            pairedThisSessionIds.add(u.id);
        }
        u.matchedHistory.forEach(h => {
            if (h && !h.activityId && isSameSession(h.session, targetSession)) {
                pairedThisSessionIds.add(u.id);
                if (h.partnerId) pairedThisSessionIds.add(String(h.partnerId).trim());
            }
        });
        if (u.registeredSessions.some(s => isSameSession(s, targetSession))) {
            sessionRegUserMap.set(u.id, u);
        }
    });

    const regHistMap = (regHistRaw && typeof regHistRaw === 'object') ? regHistRaw : {};
    Object.values(regHistMap).forEach(rec => {
        if (rec && rec.kind === 'regular' && rec.session && isSameSession(rec.session, targetSession)) {
            const pid = String(rec.playerId || '').trim();
            const liveU = userById.get(pid);
            if (liveU && !sessionRegUserMap.has(pid)) {
                sessionRegUserMap.set(pid, liveU);
            }
        }
    });

    const allSessionUsers = Array.from(sessionRegUserMap.values());
    console.log(`📋 本場次總報名人數：${allSessionUsers.length} 人（此前已配對：${pairedThisSessionIds.size} 人）`);

    const forceRules = mapToArray(forceRaw);
    const activeBatchRules = forceRules.filter(r => extractBatchLabel(r.batch) === batchName);
    const reservedIds = new Set();
    activeBatchRules.forEach(r => {
        reservedIds.add(String(r.adminId || '').trim());
        reservedIds.add(String(r.targetId || '').trim());
    });

    const nowTs = Date.now();
    const mutatedUserIds = new Set();
    const newPairs = [];
    let forceRulesChanged = false;

    const recordPair = (userA, userB, matchDetail = '') => {
        if (!userA || !userB || userA.id === userB.id) return false;
        const isForce = String(targetSession).includes('強制') || String(matchDetail).includes('強制');
        if (!isForce && (pairedThisSessionIds.has(userA.id) || pairedThisSessionIds.has(userB.id))) {
            return false;
        }
        const itemForA = { session: targetSession, partnerId: userB.id, partnerName: userB.nickname, matchedAt: nowTs, continueVotes: [] };
        const itemForB = { session: targetSession, partnerId: userA.id, partnerName: userA.nickname, matchedAt: nowTs, continueVotes: [] };
        if (matchDetail) {
            itemForA.matchDetail = matchDetail;
            itemForB.matchDetail = matchDetail;
        }
        userA.matchedHistory.push(itemForA);
        userA.matchedSession = targetSession;
        userA.matchedWithId = userB.id;
        userA.matchedWithName = userB.nickname;
        userA.matchedAt = nowTs;

        userB.matchedHistory.push(itemForB);
        userB.matchedSession = targetSession;
        userB.matchedWithId = userA.id;
        userB.matchedWithName = userA.nickname;
        userB.matchedAt = nowTs;

        mutatedUserIds.add(userA.id);
        mutatedUserIds.add(userB.id);
        newPairs.push({ userA, userB });
        return true;
    };

    // 1. 秘密強制配對規則
    activeBatchRules.forEach(rule => {
        if (rule.executed) return;
        const adminIdStr = String(rule.adminId || '').trim();
        const targetIdStr = String(rule.targetId || '').trim();
        if (pairedThisSessionIds.has(targetIdStr)) return;
        const adminUser = userById.get(adminIdStr);
        const targetUser = userById.get(targetIdStr);
        if (adminUser && targetUser && !adminUser.isMatchBanned && !targetUser.isMatchBanned) {
            if (recordPair(adminUser, targetUser, '・強制補齊')) {
                pairedThisSessionIds.add(targetIdStr);
                rule.executed = true;
                forceRulesChanged = true;
                console.log(`🔒 [秘密強制配對] ${adminUser.nickname}(${adminUser.id}) ⇄ ${targetUser.nickname}(${targetUser.id})`);
            }
        }
    });

    // 2. 一般池最大相容 1 對 1 配對
    const eligiblePool = shuffle(allSessionUsers.filter(u => {
        if (u.isWarned || u.isMatchBanned) return false;
        if (pairedThisSessionIds.has(u.id)) return false;
        if (hasUserMatchedInRegularSession(u, targetSession)) return false;
        if (reservedIds.has(u.id)) return false;
        return true;
    }));

    const canPair = (A, B) => {
        if (!A || !B || A.id === B.id) return false;
        if (isPairUnmatched(A.id, B.id)) return false;
        if (A.matchedHistory.some(h => String(h.partnerId).trim() === B.id) || String(A.matchedWithId || '').trim() === B.id) return false;
        if (B.matchedHistory.some(h => String(h.partnerId).trim() === A.id) || String(B.matchedWithId || '').trim() === A.id) return false;
        return acceptsCandidate(A, B) && acceptsCandidate(B, A);
    };

    const adj = Array.from({ length: eligiblePool.length }, () => []);
    for (let i = 0; i < eligiblePool.length; i++) {
        for (let j = i + 1; j < eligiblePool.length; j++) {
            if (canPair(eligiblePool[i], eligiblePool[j])) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }

    const matchOf = findMaximumCompatibilityMatching(eligiblePool, adj);
    for (let i = 0; i < eligiblePool.length; i++) {
        const j = matchOf[i];
        if (j > i) {
            const A = eligiblePool[i];
            const B = eligiblePool[j];
            if (pairedThisSessionIds.has(A.id) || pairedThisSessionIds.has(B.id)) continue;
            if (recordPair(A, B)) {
                pairedThisSessionIds.add(A.id);
                pairedThisSessionIds.add(B.id);
                console.log(`💘 [配對成功 #${newPairs.length}] ${A.nickname}(${A.id}) ⇄ ${B.nickname}(${B.id})`);
            }
        }
    }

    // 3. 男生加場次數扣次（當屆第 3 場開獎時扣除 1 次）
    const smrMap = (smrRaw && typeof smrRaw === 'object') ? smrRaw : {};
    allSessionUsers.forEach(regUser => {
        const uObj = userById.get(regUser.id);
        if (!uObj || !isMalePlayerRecord(uObj)) return;
        const curCredits = Math.max(0, parseInt(uObj.extraMatchCredits, 10) || 0);
        if (curCredits <= 0) return;

        const drawnSessionsInBatch = new Set();
        const addIfSameBatch = (rawS) => {
            const normS = normalizeSessionLabel(rawS);
            if (normS && batchName && extractBatchLabel(normS) === batchName) {
                drawnSessionsInBatch.add(normS);
            }
        };

        Object.values(smrMap).forEach(snap => {
            if (!snap || !snap.session) return;
            const inM = Array.isArray(snap.matchedUsers) && snap.matchedUsers.some(m => m && String(m.playerId).trim() === uObj.id);
            const inU = Array.isArray(snap.unmatchedUsers) && snap.unmatchedUsers.some(m => m && String(m.playerId).trim() === uObj.id);
            if (inM || inU) addIfSameBatch(snap.session);
        });
        uObj.matchedHistory.forEach(h => {
            if (!h || h.activityId) return;
            const isForce = Boolean(h.isForceRepaired || String(h.session || '').includes('強制') || String(h.matchDetail || '').includes('強制'));
            if (!isForce) addIfSameBatch(h.session);
        });
        addIfSameBatch(targetSession);

        if (drawnSessionsInBatch.size > MAX_MALE_REGULAR_SESSIONS) {
            uObj.extraMatchCredits = Math.max(0, curCredits - 1);
            uObj.lastExtraCreditDeductTs = nowTs;
            uObj.extraCreditDeductedBatches = [];
            mutatedUserIds.add(uObj.id);
            console.log(`🎟️ [加場扣次] ${uObj.nickname}(${uObj.id}) 第 ${drawnSessionsInBatch.size} 場開獎扣 1 次，剩餘 ${uObj.extraMatchCredits} 次`);
        }
    });

    // 4. 建立場次結算快照（yuelao_session_match_results）
    const docKey = targetSession.replace(/[\/.#$\[\]\s]+/g, '_');
    const matchedUsers = [];
    const unmatchedUsers = [];
    const seenPairs = new Set();
    const matchedPairs = [];

    allSessionUsers.forEach(regU => {
        const liveU = userById.get(regU.id) || regU;
        const histLinks = liveU.matchedHistory.filter(h => !h.activityId && isSameSession(h.session, targetSession));
        if (histLinks.length > 0) {
            const firstLink = histLinks[0];
            const partnerId = String(firstLink.partnerId || '').trim();
            const partnerU = userById.get(partnerId);
            const partnerName = (partnerU && partnerU.nickname) || firstLink.partnerName || `玩家_${partnerId}`;
            matchedUsers.push({
                playerId: liveU.id,
                nickname: liveU.nickname || `玩家_${liveU.id}`,
                gender: liveU.gender || '',
                age: liveU.age || '',
                region: liveU.region || '',
                partnerId,
                partnerName,
                session: targetSession,
                matchedAt: Number(firstLink.matchedAt || nowTs),
                criteriaSummary: formatUserCriteriaPlainText(liveU)
            });
            if (partnerId) {
                const pk = [liveU.id, partnerId].sort().join('__');
                if (!seenPairs.has(pk)) {
                    seenPairs.add(pk);
                    matchedPairs.push({
                        idA: liveU.id,
                        nameA: liveU.nickname || `玩家_${liveU.id}`,
                        genderA: liveU.gender || '',
                        idB: partnerId,
                        nameB: partnerName,
                        genderB: (partnerU && partnerU.gender) || '',
                        matchedAt: Number(firstLink.matchedAt || nowTs)
                    });
                }
            }
        } else {
            unmatchedUsers.push({
                playerId: liveU.id,
                nickname: liveU.nickname || `玩家_${liveU.id}`,
                gender: liveU.gender || '',
                age: liveU.age || '',
                region: liveU.region || '',
                criteriaSummary: formatUserCriteriaPlainText(liveU),
                failReason: diagnoseSessionUnmatchedReason(liveU, allSessionUsers, reservedIds)
            });
        }
    });

    const summaryRecord = {
        id: docKey,
        session: targetSession,
        batchLabel: batchName,
        executedAtTs: nowTs,
        executedAtStr: tpeNow.toLocaleString('zh-TW', { hour12: false }),
        totalRegCount: allSessionUsers.length,
        maleRegCount: allSessionUsers.filter(u => resolveUserActualGender(u) === '男').length,
        femaleRegCount: allSessionUsers.filter(u => resolveUserActualGender(u) === '女').length,
        matchedCount: matchedUsers.length,
        matchedPairCount: matchedPairs.length,
        unmatchedCount: unmatchedUsers.length,
        matchedPairs,
        matchedUsers,
        unmatchedUsers
    };

    console.log(`🎉 結算摘要：本次新增配對 ${newPairs.length} 對，總成功 ${matchedPairs.length} 對，未配對 ${unmatchedUsers.length} 人`);

    if (dryRun) {
        console.log('🧪 DRY_RUN=1 試算模式完成，不寫入 Firebase。');
        return;
    }

    // 5. 寫入 Firebase（先寫入單次執行鎖，再寫入每位受影響玩家的配對結果、公開配對資料卡與聊天室開場白）
    executedMap[dateKey] = true;
    await fbPut(AUTO_RUN_LOG_KEY, executedMap, idToken);
    if (forceRulesChanged) {
        await fbPut(FORCE_KEY, forceRules, idToken);
    }

    for (const uid of mutatedUserIds) {
        const uObj = userById.get(uid);
        if (!uObj) continue;
        await fbPatch(`${USERS_KEY}/${uid}`, {
            matchedHistory: uObj.matchedHistory,
            matchedSession: uObj.matchedSession || null,
            matchedWithId: uObj.matchedWithId || null,
            matchedWithName: uObj.matchedWithName || null,
            matchedAt: uObj.matchedAt || null,
            extraMatchCredits: Math.max(0, parseInt(uObj.extraMatchCredits, 10) || 0),
            extraCreditDeductedBatches: (Array.isArray(uObj.extraCreditDeductedBatches) && uObj.extraCreditDeductedBatches.length > 0) ? uObj.extraCreditDeductedBatches : null,
            lastExtraCreditDeductTs: uObj.lastExtraCreditDeductTs || null
        }, idToken);
    }

    const timeStr = `${String(tpeNow.getHours()).padStart(2, '0')}:${String(tpeNow.getMinutes()).padStart(2, '0')}`;
    const dateTimeStr = `${tpeNow.getMonth() + 1}/${tpeNow.getDate()} ${timeStr}`;

    for (const { userA, userB } of newPairs) {
        const pk = [userA.id, userB.id].sort().join('__');
        const profA = buildPairProfileRecord(userA);
        const profB = buildPairProfileRecord(userB);
        if (profA) await fbPut(`${PAIR_PROFILES_KEY}/${pk}/${userA.id}`, profA, idToken);
        if (profB) await fbPut(`${PAIR_PROFILES_KEY}/${pk}/${userB.id}`, profB, idToken);

        const initMsgs = {};
        const sysId = `INIT_${pk}_0`;
        const sysMsg = {
            id: sysId,
            senderId: 'system',
            senderName: '',
            text: `🌸【${targetSession}】月老牽線成功！好友名單將保留 7 天（每天 20:00 倒數），現在可以開始聊天囉！`,
            time: timeStr,
            dateTime: dateTimeStr,
            ts: nowTs
        };
        initMsgs[sysId] = sysMsg;
        let lastMsg = sysMsg;
        let msgCount = 1;

        if (userA.oneSentence) {
            const mId = `INIT_${pk}_1`;
            const mObj = { id: mId, senderId: userA.id, senderName: userA.nickname || '', text: userA.oneSentence, time: '20:01', dateTime: dateTimeStr, ts: nowTs + 1 };
            initMsgs[mId] = mObj;
            lastMsg = mObj;
            msgCount++;
        }
        if (userB.oneSentence) {
            const mId = `INIT_${pk}_2`;
            const mObj = { id: mId, senderId: userB.id, senderName: userB.nickname || '', text: userB.oneSentence, time: '20:01', dateTime: dateTimeStr, ts: nowTs + 2 };
            initMsgs[mId] = mObj;
            lastMsg = mObj;
            msgCount++;
        }

        await fbPatch(`${CHATS_KEY}/${pk}`, initMsgs, idToken);
        await fbPatch(`${CHAT_META_KEY}/${pk}`, { lastMsg, lastTs: lastMsg.ts, msgCount }, idToken);
    }

    await fbPut(`${SESSION_MATCH_RESULTS_KEY}/${docKey}`, summaryRecord, idToken);
    console.log('✅ 全部配對資料、聊天室開場白與結算快照已成功寫入 Firebase！');
}

main().catch(err => {
    console.error('❌ 自動配對腳本執行發生錯誤:', err);
    process.exit(1);
});
