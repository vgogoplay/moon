/* shared/schedule.js - 前後台共用：屆數、週三／週六場次推算與日期格式化 */

function getMondayOfWeek(dateObj = new Date()) {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMonday);
    return d;
}

function formatMonthDay(dateObj) {
    return `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
}

function getBatchScheduleInfo(batchNum) {
    const b = Math.max(1, Number(batchNum || 1));
    const baseMonday = new Date(2026, 10, 9, 0, 0, 0, 0); // 2026/11/09 (一) -> 第1屆11/11(三)、第1屆11/14(六)
    const monday = new Date(baseMonday);
    monday.setDate(baseMonday.getDate() + (b - 1) * 7);

    const wed = new Date(monday);
    wed.setDate(monday.getDate() + 2);

    const sat = new Date(monday);
    sat.setDate(monday.getDate() + 5);

    const wedDateStr = formatMonthDay(wed);
    const satDateStr = formatMonthDay(sat);
    const wedLabel = `第${b}屆${wedDateStr}(三)`;
    const satLabel = `第${b}屆${satDateStr}(六)`;

    return {
        batch: b,
        batchPrefix: `第${b}屆`,
        monday,
        wed,
        sat,
        wedDateStr,
        satDateStr,
        wedLabel,
        satLabel,
        sessions: [wedLabel, satLabel]
    };
}

function normalizeSessionLabel(sessionStr) {
    const raw = String(sessionStr || '').trim();
    if (!raw) return '';
    const batchMatch = raw.match(/^第\s*(\d+)\s*屆/);
    if (!batchMatch) return raw;
    const b = Math.max(1, parseInt(batchMatch[1], 10));
    const info = getBatchScheduleInfo(b);
    if (/(三|星期三|週三)/.test(raw)) return info.wedLabel;
    if (/(六|星期六|週六)/.test(raw)) return info.satLabel;
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

function calcAutoBatchNumber(now = new Date()) {
    const baseMonday = new Date(2026, 10, 9, 0, 0, 0, 0);
    const currentMonday = getMondayOfWeek(now);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const diffWeeks = Math.round((currentMonday.getTime() - baseMonday.getTime()) / weekMs);
    return Math.max(1, 1 + diffWeeks);
}
// ==================== 🎪 第 2 種自定義活動：開始～結束時間與自動配對排程引擎 ====================
function parseLocalDateTimeTs(dtVal) {
    if (!dtVal) return 0;
    if (typeof dtVal === 'number') return isNaN(dtVal) ? 0 : dtVal;
    const str = String(dtVal).trim();
    if (!str) return 0;
    const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (m) {
        const d = new Date(
            parseInt(m[1], 10),
            parseInt(m[2], 10) - 1,
            parseInt(m[3], 10),
            parseInt(m[4], 10),
            parseInt(m[5], 10),
            m[6] ? parseInt(m[6], 10) : 0,
            0
        );
        return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    const fallback = Date.parse(str);
    return isNaN(fallback) ? 0 : fallback;
}

function formatLocalDateTimeInputValue(ts) {
    const num = Number(ts) || 0;
    if (!num || isNaN(num)) return '';
    const d = new Date(num);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function formatShortDateTime(dtVal, includeYearIfDifferent = true) {
    const ts = parseLocalDateTimeTs(dtVal);
    if (!ts) return '';
    const d = new Date(ts);
    const nowYear = new Date().getFullYear();
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    if (includeYearIfDifferent && d.getFullYear() !== nowYear) {
        return `${d.getFullYear()}/${mm}/${dd} ${hh}:${min}`;
    }
    return `${mm}/${dd} ${hh}:${min}`;
}

function formatCustomActivityTimeSummary(act) {
    if (!act || typeof act !== 'object') {
        return { hasSchedule: false, windowText: '', matchText: '' };
    }
    const startTs = parseLocalDateTimeTs(act.startTime || act.startTimeTs);
    const endTs = parseLocalDateTimeTs(act.endTime || act.endTimeTs);
    const matchTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);

    let windowText = '';
    if (startTs && endTs) {
        const sDate = new Date(startTs);
        const eDate = new Date(endTs);
        const sameDay = sDate.getFullYear() === eDate.getFullYear() &&
                        sDate.getMonth() === eDate.getMonth() &&
                        sDate.getDate() === eDate.getDate();
        if (sameDay) {
            const endHH = String(eDate.getHours()).padStart(2, '0');
            const endMM = String(eDate.getMinutes()).padStart(2, '0');
            windowText = `${formatShortDateTime(startTs)} ~ ${endHH}:${endMM}`;
        } else {
            windowText = `${formatShortDateTime(startTs)} ~ ${formatShortDateTime(endTs)}`;
        }
    } else if (startTs) {
        windowText = `${formatShortDateTime(startTs)} 起開放`;
    } else if (endTs) {
        windowText = `截止至 ${formatShortDateTime(endTs)}`;
    }

    const matchText = matchTs ? formatShortDateTime(matchTs) : '';
    return {
        hasSchedule: Boolean(startTs || endTs || matchTs),
        startTs,
        endTs,
        matchTs,
        windowText,
        matchText
    };
}

function getCustomActivityScheduleState(act, nowTs = Date.now()) {
    const summary = formatCustomActivityTimeSummary(act);
    const isOpen = Boolean(act && act.isOpen);
    const autoMatchedDone = Boolean(act && act.autoMatchedDone);

    if (!isOpen) {
        return {
            ...summary,
            status: 'closed',
            canRegister: false,
            canCancel: false,
            label: '已關閉'
        };
    }

    if (summary.startTs > 0 && nowTs < summary.startTs) {
        return {
            ...summary,
            status: 'upcoming',
            canRegister: false,
            canCancel: false,
            label: `尚未開始（${formatShortDateTime(summary.startTs)} 開放）`
        };
    }

    if (summary.endTs > 0 && nowTs >= summary.endTs) {
        if ((summary.matchTs > 0 && nowTs >= summary.matchTs) || autoMatchedDone) {
            return {
                ...summary,
                status: 'matched',
                canRegister: false,
                canCancel: false,
                label: '已完成配對'
            };
        }
        return {
            ...summary,
            status: 'waiting_match',
            canRegister: false,
            canCancel: false,
            label: summary.matchText ? `報名已截止・等待 ${summary.matchText} 配對` : '報名已截止・等待配對'
        };
    }

    if ((summary.matchTs > 0 && nowTs >= summary.matchTs) || autoMatchedDone) {
        return {
            ...summary,
            status: 'matched',
            canRegister: false,
            canCancel: false,
            label: '已完成配對'
        };
    }

    return {
        ...summary,
        status: 'open',
        canRegister: true,
        canCancel: true,
        label: summary.endTs ? `開放報名中（${formatShortDateTime(summary.endTs)} 截止）` : '開放報名中'
    };
}

function sharedShuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function normalizeGenderCode(rawVal) {
    const s = String(rawVal || '').trim();
    if (s === '男' || s === '男生') return '男';
    if (s === '女' || s === '女生') return '女';
    if (s === '都可以' || s === '不限') return '都可以';
    return '';
}

function resolveUserActualGender(user) {
    if (!user) return '';
    const g = normalizeGenderCode(user.gender);
    if (g === '男' || g === '女') return g;
    const uid = String(user.id || '').trim();
    if (uid.startsWith('1')) return '男';
    if (uid.startsWith('2')) return '女';
    return '';
}

function sharedMatchesGenderPreference(seeker, candidate, criteria = {}) {
    if (!seeker || !candidate) return false;
    const candidateGender = resolveUserActualGender(candidate);
    if (candidateGender !== '男' && candidateGender !== '女') return false;

    // 1. 個人資料「你想配對的性別」(男生 / 女生 / 都可以) 為硬性條件，不可被 OR 條件覆蓋
    const profilePref = normalizeGenderCode(seeker.targetGender);
    if (profilePref === '男' && candidateGender !== '男') return false;
    if (profilePref === '女' && candidateGender !== '女') return false;

    // 2. 報名彈窗「希望完全吻合條件」若有勾選性別，同樣為硬性條件
    const critGender = normalizeGenderCode(criteria && criteria.gender);
    if (critGender === '男' && candidateGender !== '男') return false;
    if (critGender === '女' && candidateGender !== '女') return false;

    return true;
}

function sharedCheckSingleCriterion(key, desiredVal, candidate, seekerCriteria = {}) {
    if (!candidate) return false;
    if (key === 'mbti') {
        const want = String(desiredVal || '').trim();
        if (!want) return false;
        const candRaw = String(candidate.mbti || '').trim().toUpperCase();
        const candGroup = String(
            candidate.mbtiGroup ||
            (typeof inferMbtiGroup === 'function' ? inferMbtiGroup(candRaw) : '') ||
            (candRaw.startsWith('I') ? 'I人' : (candRaw.startsWith('E') ? 'E人' : ''))
        ).trim();
        if (want === 'I人' || want === 'E人') {
            return candGroup === want;
        }
        return candRaw === want.toUpperCase();
    }
    if (key === 'region') {
        const candidateRegion = candidate.region || (typeof inferRegionByCity === 'function' ? inferRegionByCity(candidate.city) : '');
        const regionCities = (typeof REGION_CITIES !== 'undefined' && REGION_CITIES[desiredVal]) ? REGION_CITIES[desiredVal] : [];
        return candidateRegion === desiredVal || regionCities.includes(candidate.city);
    }
    if (key === 'gender') {
        const candidateGender = resolveUserActualGender(candidate);
        const wantGender = normalizeGenderCode(desiredVal);
        if (wantGender === '女') return candidateGender === '女';
        if (wantGender === '男') return candidateGender === '男';
        return candidateGender === desiredVal;
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
        const candHasAnyPet = candPet !== '沒有養寵物';
        if (want === '沒有養寵物') {
            return candPet === '沒有養寵物';
        }
        const parsed = (typeof parsePetCriterionValue === 'function')
            ? parsePetCriterionValue(want)
            : (() => {
                const m = want.match(/^有養寵物[（(](.+)[）)]$/);
                const t = m ? m[1].trim() : want;
                return { status: '有養寵物', petType: (t === '有養寵物' || t.startsWith('不限')) ? '不限' : t };
            })();
        if (parsed.status === '沒有養寵物') {
            return candPet === '沒有養寵物';
        }
        if (!candHasAnyPet) return false;
        if (!parsed.petType || parsed.petType === '不限' || parsed.petType.startsWith('不限')) {
            return true;
        }
        return candPet === parsed.petType;
    }
    return candidate[key] === desiredVal;
}

function normalizeMustMatchKeysList(rawKeys, criteriaObj = {}) {
    const crit = (criteriaObj && typeof criteriaObj === 'object' && !Array.isArray(criteriaObj)) ? criteriaObj : {};
    const arr = Array.isArray(rawKeys)
        ? rawKeys
        : (rawKeys && typeof rawKeys === 'object' ? Object.values(rawKeys) : []);
    const result = [];
    const seen = new Set();
    arr.forEach(k => {
        const keyStr = String(k || '').trim();
        if (!keyStr || seen.has(keyStr)) return;
        if (keyStr === 'city' && Object.prototype.hasOwnProperty.call(crit, 'region')) return;
        if (!Object.prototype.hasOwnProperty.call(crit, keyStr)) return;
        seen.add(keyStr);
        if (result.length < 2) {
            result.push(keyStr);
        }
    });
    return result;
}

function sharedEvaluateMatchCriteria(seeker, candidate, criteria = {}, mustMatchKeys = []) {
    const crit = (criteria && typeof criteria === 'object' && !Array.isArray(criteria)) ? criteria : {};
    if (!sharedMatchesGenderPreference(seeker, candidate, crit)) return false;

    const activeKeys = Object.keys(crit).filter(k => k !== 'gender' && !(k === 'city' && crit.region));
    if (activeKeys.length === 0) return true;

    const mustKeys = normalizeMustMatchKeysList(mustMatchKeys, crit).filter(k => k !== 'gender');
    const mustSet = new Set(mustKeys);
    const orKeys = activeKeys.filter(k => !mustSet.has(k));

    // 1. 必須吻合條件（最多 2 項）：每一項皆須完全符合
    for (const mk of mustKeys) {
        if (!sharedCheckSingleCriterion(mk, crit[mk], candidate, crit)) {
            return false;
        }
    }

    // 2. 選填條件（OR）：其中一項符合即可配對
    if (orKeys.length === 0) return true;
    return orKeys.some(ok => sharedCheckSingleCriterion(ok, crit[ok], candidate, crit));
}

function sharedRecordCustomPairMatch(userA, userB, targetSession, nowTs, activityId, matchDetail = '') {
    // 終極安全閥：寫入第 2 種活動配對前再次確認 3 大條件（1.活動開啟 2.防呆開啟 3.日期為今日起）
    if (activityId && typeof CUSTOM_ACTIVITIES_KEY !== 'undefined') {
        try {
            const acts = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
            const targetAct = Array.isArray(acts) ? acts.find(a => String(a.id) === String(activityId)) : null;
            if (targetAct && typeof checkCustomActivityThreeConditions === 'function') {
                const checkRes = checkCustomActivityThreeConditions(targetAct, nowTs || Date.now());
                if (!checkRes.allowed) {
                    console.warn('已攔截違反 3 大防呆條件的專屬活動配對寫入：', targetAct.name, checkRes.reason);
                    return false;
                }
            }
        } catch (e) {}
    }
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.clearPairUnmatched === 'function') {
        CloudSync.clearPairUnmatched(userA.id, userB.id);
    }
    if (!Array.isArray(userA.matchedHistory)) userA.matchedHistory = [];
    if (!Array.isArray(userB.matchedHistory)) userB.matchedHistory = [];

    const itemForA = { session: targetSession, partnerId: String(userB.id), partnerName: userB.nickname, matchedAt: nowTs };
    const itemForB = { session: targetSession, partnerId: String(userA.id), partnerName: userA.nickname, matchedAt: nowTs };
    if (activityId) {
        itemForA.activityId = String(activityId);
        itemForB.activityId = String(activityId);
    }
    if (matchDetail) {
        itemForA.matchDetail = String(matchDetail);
        itemForB.matchDetail = String(matchDetail);
    }

    userA.matchedHistory.push(itemForA);
    userA.matchedSession = targetSession;
    userA.matchedWithId = String(userB.id);
    userA.matchedWithName = userB.nickname;
    userA.matchedAt = nowTs;

    userB.matchedHistory.push(itemForB);
    userB.matchedSession = targetSession;
    userB.matchedWithId = String(userA.id);
    userB.matchedWithName = userA.nickname;
    userB.matchedAt = nowTs;

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.recordMatchLog === 'function') {
        CloudSync.recordMatchLog(userA, userB, targetSession, nowTs, matchDetail || '專屬活動配對');
    }
    return true;
}

const CUSTOM_ACT_LOCK_PREFIX = 'yuelao_custom_act_lock_';
const CUSTOM_ACT_CLOUD_LOCKS_NODE = 'yuelao_custom_act_locks';
const CUSTOM_ACT_AUTO_MATCH_GRACE_MS = 15 * 60 * 1000; // 超過設定配對時間 15 分鐘即視為逾期，絕不在更新重整時自動補跑
const customActivityAutoLockInFlight = new Set();

function isCustomActivityMatchSafetyEnabled(act) {
    return Boolean(act && typeof act === 'object' && act.matchSafetyEnabled);
}

function getCustomActivityAllowedMinTs(nowTs = Date.now()) {
    const d = new Date(Number(nowTs) || Date.now());
    const todayStartTs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
    const floor20261118Ts = new Date(2026, 10, 18, 0, 0, 0, 0).getTime(); // 2026/11/18 00:00:00
    return Math.max(todayStartTs, floor20261118Ts);
}

function isCustomActivityBeforeAllowedDate(act, nowTs = Date.now()) {
    if (!act || typeof act !== 'object') return true;
    const cutoffTs = getCustomActivityAllowedMinTs(nowTs);
    const matchTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);
    const endTs = parseLocalDateTimeTs(act.endTime || act.endTimeTs);
    const startTs = parseLocalDateTimeTs(act.startTime || act.startTimeTs);
    const createdAtTs = Number(act.createdAtTs || 0);

    if (matchTs > 0) {
        return matchTs < cutoffTs;
    }
    if (endTs > 0) {
        return endTs < cutoffTs;
    }
    if (startTs > 0) {
        return startTs < cutoffTs;
    }

    const nameDateMatch = String(act.name || '').match(/(\d{1,2})\s*[\/月.-]\s*(\d{1,2})/);
    if (nameDateMatch) {
        const mNum = parseInt(nameDateMatch[1], 10);
        const dNum = parseInt(nameDateMatch[2], 10);
        if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
            const refYear = new Date(cutoffTs).getFullYear();
            const namedDateTs = new Date(refYear, mNum - 1, dNum, 0, 0, 0, 0).getTime();
            if (namedDateTs < cutoffTs) return true;
        }
    }

    if (createdAtTs > 0 && createdAtTs < cutoffTs) {
        return true;
    }
    return false;
}

function checkCustomActivityThreeConditions(act, nowTs = Date.now()) {
    if (!act || typeof act !== 'object') {
        return { allowed: false, reason: 'not_found' };
    }
    // 條件 1：活動必須為「開啟中」（活動關閉時絕對不可配對）
    if (!Boolean(act.isOpen)) {
        return { allowed: false, reason: 'closed' };
    }
    // 條件 2：防呆開關必須為「開啟」（防呆關閉時絕對不可配對）
    if (!isCustomActivityMatchSafetyEnabled(act)) {
        return { allowed: false, reason: 'safety_locked' };
    }
    // 條件 3：活動日期必須為「今天（含）起」（今天之前的歷史活動絕對不可配對）
    if (isCustomActivityBeforeAllowedDate(act, nowTs)) {
        return { allowed: false, reason: 'before_today_cutoff' };
    }
    return { allowed: true, reason: 'ok' };
}

function lockCustomActivityInCloudLocks(act) {
    if (!act || !act.id || typeof CloudSync === 'undefined' || !CloudSync.initialized) return;
    const aid = String(act.id).trim();
    const candidateTsList = new Set([0]);
    const mTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);
    const eTs = parseLocalDateTimeTs(act.endTime || act.endTimeTs);
    if (mTs > 0) candidateTsList.add(mTs);
    if (eTs > 0) candidateTsList.add(eTs);

    candidateTsList.forEach(tsVal => {
        const lockNodeKey = makeCustomActLockNodeKey(aid, tsVal);
        const existingCloudLock = (CloudSync.tree && CloudSync.tree[CUSTOM_ACT_CLOUD_LOCKS_NODE])
            ? CloudSync.tree[CUSTOM_ACT_CLOUD_LOCKS_NODE][lockNodeKey]
            : null;
        if (!existingCloudLock || !existingCloudLock.claimedBy) {
            CloudSync.putNode(`${CUSTOM_ACT_CLOUD_LOCKS_NODE}/${lockNodeKey}`, {
                activityId: aid,
                matchTs: Number(tsVal || 0),
                claimedBy: 'ADMIN_LOCKED_CLOSED',
                claimedAt: Date.now()
            });
        }
        try {
            localStorage.setItem(`${CUSTOM_ACT_LOCK_PREFIX}${lockNodeKey}`, `DONE_${Date.now()}`);
        } catch (e) {}
    });
}

function enforceClosedCustomActivityCloudLocks() {
    if (typeof CUSTOM_ACTIVITIES_KEY === 'undefined') return;
    if (typeof CloudSync === 'undefined' || !CloudSync.initialized) return;
    let acts = [];
    try {
        acts = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
    } catch (e) {
        return;
    }
    if (!Array.isArray(acts) || acts.length === 0) return;

    const nowTs = Date.now();
    let listChanged = false;
    acts.forEach(act => {
        if (!act || !act.id) return;
        const cond = checkCustomActivityThreeConditions(act, nowTs);
        if (!cond.allowed) {
            lockCustomActivityInCloudLocks(act);
            if (!act.autoMatchedDone) {
                act.autoMatchedDone = true;
                listChanged = true;
                CloudSync.patchNode(`${CUSTOM_ACTIVITIES_KEY}/${act.id}`, { autoMatchedDone: true });
            }
        }
    });
    if (listChanged) {
        try {
            localStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(acts));
        } catch (e) {}
    }
}

function makeCustomActLockNodeKey(activityId, matchTs) {
    return `${String(activityId || '').trim()}_${Number(matchTs || 0)}`;
}

function getCustomActivityMatchedUserIdSet(act, usersList = null) {
    const idSet = new Set();
    if (!act || typeof act !== 'object') return idSet;

    if (Array.isArray(act.matchedUserIds)) {
        act.matchedUserIds.forEach(uid => {
            const clean = String(uid || '').trim();
            if (clean) idSet.add(clean);
        });
    } else if (act.matchedUserIds && typeof act.matchedUserIds === 'object') {
        Object.values(act.matchedUserIds).forEach(uid => {
            const clean = String(uid || '').trim();
            if (clean) idSet.add(clean);
        });
    }

    if (act.matchedUserMap && typeof act.matchedUserMap === 'object' && !Array.isArray(act.matchedUserMap)) {
        Object.keys(act.matchedUserMap).forEach(uid => {
            const clean = String(uid || '').trim();
            if (clean) idSet.add(clean);
        });
    }

    const usersArr = Array.isArray(usersList) ? usersList : [];
    const actIdStr = String(act.id || '').trim();
    const actNameStr = String(act.name || '').trim();
    usersArr.forEach(u => {
        if (!u || !u.id || !Array.isArray(u.matchedHistory)) return;
        const hasActHist = u.matchedHistory.some(h =>
            (actIdStr && String(h.activityId || '').trim() === actIdStr) ||
            (actNameStr && String(h.session || '').trim() === actNameStr)
        );
        if (hasActHist) {
            idSet.add(String(u.id).trim());
        }
    });

    return idSet;
}

async function executeCustomActivityMatchCore(activityId, options = {}) {
    const { isAuto = false, markScheduledDone = false, forceManualOverride = false } = options;

    let acts = [];
    try {
        acts = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
    } catch (e) {
        acts = [];
    }
    const act = Array.isArray(acts) ? acts.find(a => String(a.id) === String(activityId)) : null;
    if (!act) return { executed: false, reason: 'not_found', pairCount: 0, unmatchedCount: 0 };

    const nowCheckTs = Date.now();
    const scheduledMatchTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);

    // 嚴格 3 大必要條件（1.活動開啟 2.防呆開啟 3.日期為今日起）：任何一項不達成皆一律禁止配對
    const threeCond = checkCustomActivityThreeConditions(act, nowCheckTs);
    if (!threeCond.allowed) {
        return { executed: false, reason: threeCond.reason, actName: act.name, pairCount: 0, unmatchedCount: 0 };
    }
    if (Boolean(act.autoMatchedDone)) {
        return { executed: false, reason: 'already_done', actName: act.name, pairCount: 0, unmatchedCount: 0 };
    }
    if (!forceManualOverride && scheduledMatchTs > 0 && (nowCheckTs - scheduledMatchTs) > CUSTOM_ACT_AUTO_MATCH_GRACE_MS) {
        return { executed: false, reason: 'expired', actName: act.name, pairCount: 0, unmatchedCount: 0 };
    }

    if (isAuto || markScheduledDone) {
        act.autoMatchedDone = true;
        act.isOpen = false;
        localStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(acts));
    }

    const actType = act.activityType || 'classic';
    let users = [];
    try {
        users = (typeof getUsers === 'function')
            ? getUsers()
            : JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
    } catch (e) {
        users = [];
    }

    const areFriendsFn = (A, B) =>
        (A.matchedHistory || []).some(h => String(h.partnerId) === String(B.id)) ||
        String(A.matchedWithId) === String(B.id) ||
        (typeof CloudSync !== 'undefined' && typeof CloudSync.isPairRecentlyUnmatched === 'function' && CloudSync.isPairRecentlyUnmatched(A.id, B.id));

    const acceptsCustomFn = (seeker, candidate) => {
        const reg = seeker.customActivityRegs && seeker.customActivityRegs[act.id];
        const criteria = (reg && reg.exactMatchCriteria) ? reg.exactMatchCriteria : {};
        const mustKeys = (reg && Array.isArray(reg.mustMatchKeys)) ? reg.mustMatchKeys : [];
        return sharedEvaluateMatchCriteria(seeker, candidate, criteria, mustKeys);
    };

    const permanentMatchedSet = getCustomActivityMatchedUserIdSet(act, users);
    const eligiblePool = sharedShuffleArray(users.filter(u => {
        if (!u || !u.id || u.isWarned || u.isMatchBanned) return false;
        const uid = String(u.id).trim();
        // 永久名單保護：曾在此活動配對過的玩家即使後續解除好友，也絕不在同一活動再次重複配對
        if (permanentMatchedSet.has(uid)) return false;
        const hasReg = Boolean(u.customActivityRegs && u.customActivityRegs[act.id]);
        if (!hasReg) return false;
        const alreadyMatchedThisAct = (u.matchedHistory || []).some(h =>
            String(h.activityId || '') === String(act.id) || String(h.session || '') === String(act.name)
        );
        return !alreadyMatchedThisAct;
    }));

    const pairedThisRunIds = new Set();
    let pairCount = 0;
    const nowTs = Date.now();
    const triggerTag = isAuto ? '[第2種活動到點自動配對]' : '[第2種活動配對執行]';

    if (typeof appendLog === 'function') {
        appendLog(`<span class="text-amber-300">${triggerTag}</span> 開始執行專屬活動「<strong>${act.name}</strong>」自動配對（符合資格待配對人數：${eligiblePool.length} 人）...`);
    }

    if (actType === 'fortune_number') {
        const buckets = {};
        eligiblePool.forEach(u => {
            const reg = u.customActivityRegs && u.customActivityRegs[act.id];
            const num = reg && reg.fortuneNumber ? String(reg.fortuneNumber).trim() : '';
            const numInt = parseInt(num, 10);
            if (!num || isNaN(numInt) || numInt < 1 || numInt > 5) return;
            const key = String(numInt);
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(u);
        });

        Object.keys(buckets).sort((a, b) => Number(a) - Number(b)).forEach(num => {
            const males = sharedShuffleArray(buckets[num].filter(u => resolveUserActualGender(u) === '男'));
            const females = sharedShuffleArray(buckets[num].filter(u => resolveUserActualGender(u) === '女'));
            for (let i = 0; i < males.length; i++) {
                const M = males[i];
                if (pairedThisRunIds.has(String(M.id))) continue;
                for (let j = 0; j < females.length; j++) {
                    const F = females[j];
                    if (pairedThisRunIds.has(String(F.id))) continue;
                    if (!areFriendsFn(M, F)) {
                        pairedThisRunIds.add(String(M.id));
                        pairedThisRunIds.add(String(F.id));
                        sharedRecordCustomPairMatch(M, F, act.name, nowTs, act.id, `同抽中月老籤詩第 ${num} 首`);
                        pairCount++;
                        if (typeof appendLog === 'function') {
                            appendLog(`<span class="text-emerald-400">[${act.name}・第${num}首 男女配對成功 #${pairCount}]</span> ID:${M.id}（${M.nickname}・男）⇄ ID:${F.id}（${F.nickname}・女）`);
                        }
                        break;
                    }
                }
            }
        });
    } else if (actType === 'two_choice') {
        const buckets = {};
        eligiblePool.forEach(u => {
            const reg = u.customActivityRegs && u.customActivityRegs[act.id];
            const choice = reg && reg.twoChoiceValue ? String(reg.twoChoiceValue).trim() : '';
            if (!choice) return;
            if (!buckets[choice]) buckets[choice] = [];
            buckets[choice].push(u);
        });

        Object.keys(buckets).forEach(choice => {
            const males = sharedShuffleArray(buckets[choice].filter(u => resolveUserActualGender(u) === '男'));
            const females = sharedShuffleArray(buckets[choice].filter(u => resolveUserActualGender(u) === '女'));
            for (let i = 0; i < males.length; i++) {
                const M = males[i];
                if (pairedThisRunIds.has(String(M.id))) continue;
                for (let j = 0; j < females.length; j++) {
                    const F = females[j];
                    if (pairedThisRunIds.has(String(F.id))) continue;
                    if (!areFriendsFn(M, F)) {
                        pairedThisRunIds.add(String(M.id));
                        pairedThisRunIds.add(String(F.id));
                        sharedRecordCustomPairMatch(M, F, act.name, nowTs, act.id, `默契大考驗皆選「${choice}」`);
                        pairCount++;
                        if (typeof appendLog === 'function') {
                            appendLog(`<span class="text-emerald-400">[${act.name}・${choice} 男女配對成功 #${pairCount}]</span> ID:${M.id}（${M.nickname}・男）⇄ ID:${F.id}（${F.nickname}・女）`);
                        }
                        break;
                    }
                }
            }
        });
    } else {
        for (let i = 0; i < eligiblePool.length; i++) {
            const A = eligiblePool[i];
            if (pairedThisRunIds.has(String(A.id))) continue;

            const candidates = [];
            for (let j = i + 1; j < eligiblePool.length; j++) {
                const B = eligiblePool[j];
                if (pairedThisRunIds.has(String(B.id))) continue;
                if (!areFriendsFn(A, B) && acceptsCustomFn(A, B) && acceptsCustomFn(B, A)) {
                    candidates.push(B);
                }
            }

            if (candidates.length > 0) {
                const B = candidates[Math.floor(Math.random() * candidates.length)];
                pairedThisRunIds.add(String(A.id));
                pairedThisRunIds.add(String(B.id));
                sharedRecordCustomPairMatch(A, B, act.name, nowTs, act.id);
                pairCount++;
                if (typeof appendLog === 'function') {
                    appendLog(`<span class="text-emerald-400">[${act.name} 配對成功 #${pairCount}]</span> ID:${A.id}（${A.nickname}）⇄ ID:${B.id}（${B.nickname}）`);
                }
            }
        }
    }

    const unmatchedCount = Math.max(0, eligiblePool.length - pairedThisRunIds.size);
    const nextMatchedMap = (act.matchedUserMap && typeof act.matchedUserMap === 'object' && !Array.isArray(act.matchedUserMap))
        ? { ...act.matchedUserMap }
        : {};
    permanentMatchedSet.forEach(uid => {
        if (!nextMatchedMap[uid]) nextMatchedMap[uid] = nowTs;
    });
    pairedThisRunIds.forEach(uid => {
        nextMatchedMap[String(uid)] = nowTs;
    });

    act.matchedUserMap = nextMatchedMap;
    act.matchedUserIds = Object.keys(nextMatchedMap);
    act.matchCount = Number(act.matchCount || 0) + pairCount;
    act.lastMatchedAt = new Date().toLocaleString('zh-TW');
    act.lastMatchedTs = nowTs;
    if (isAuto || markScheduledDone) {
        act.autoMatchedDone = true;
        act.isOpen = false;
    }

    localStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(acts));
    if (typeof CloudSync !== 'undefined') {
        await CloudSync.putNode(`${CUSTOM_ACTIVITIES_KEY}/${act.id}`, act);
    }

    if (typeof appendLog === 'function') {
        const autoCloseNote = (isAuto || markScheduledDone) ? '，活動已同步自動關閉' : '';
        appendLog(`<span class="text-pink-300">[${act.name} 結算完成]</span> 本次共配對成功 <strong>${pairCount} 對</strong>${unmatchedCount > 0 ? `（另有 ${unmatchedCount} 人因號碼／選項落單暫未配對）` : ''}${autoCloseNote}。`);
    }

    // 僅更新本次配對成功的那幾位玩家資料，避免全庫整批重寫互相覆蓋
    const matchedUsersToPush = [];
    users.forEach(u => {
        if (u && u.id) {
            if (typeof deriveFixedBackupCode === 'function') {
                u.backupCode = deriveFixedBackupCode(u.id);
            }
            if (pairedThisRunIds.has(String(u.id))) {
                matchedUsersToPush.push(u);
            }
        }
    });

    localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
    if (matchedUsersToPush.length > 0 && typeof CloudSync !== 'undefined') {
        await Promise.all(matchedUsersToPush.map(u => CloudSync.upsertUser(u, true, { isMatchMutation: true })));
    }

    if (typeof renderAdminAll === 'function') {
        renderAdminAll();
    }

    return { executed: true, actName: act.name, pairCount, unmatchedCount };
}

// 流量修復：前台只做精準單節點刷新，嚴禁整包 /.json；後台維持原行為
async function refreshCustomActFresh(isFrontendCaller) {
    if (isFrontendCaller && typeof CloudSync.refreshPlayerFresh === 'function') return CloudSync.refreshPlayerFresh();
    if (typeof CloudSync.fetchFullTree === 'function') return CloudSync.fetchFullTree();
    return false;
}

async function claimAndRunScheduledCustomActivity(activityId, matchTs, lockKey, isFrontendCaller = false) {
    const lockNodeKey = makeCustomActLockNodeKey(activityId, matchTs);
    let claimedSuccessfully = false;
    try {
        const nowGuardTs = Date.now();
        // 為 11/18 之前日期或本地活動未開啟配對防呆開關時，絕不自動搶鎖執行
        if (Number(matchTs || 0) < getCustomActivityAllowedMinTs(nowGuardTs)) {
            return;
        }
        try {
            const localCheckActs = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
            const localTargetAct = Array.isArray(localCheckActs) ? localCheckActs.find(a => String(a.id) === String(activityId)) : null;
            if (!localTargetAct || !checkCustomActivityThreeConditions(localTargetAct, nowGuardTs).allowed || localTargetAct.autoMatchedDone) {
                return;
            }
        } catch (e) {}
        // 逾期保護：距離設定配對時間超過 15 分鐘即不再背景自動觸發
        if (nowGuardTs - Number(matchTs || 0) > CUSTOM_ACT_AUTO_MATCH_GRACE_MS) {
            return;
        }

        // 前台稍微錯開 450~1250ms，讓同時在線的多支手機不會在同一毫秒搶寫
        const jitterMs = isFrontendCaller ? (450 + Math.floor(Math.random() * 800)) : 0;
        if (jitterMs > 0) {
            await new Promise(resolve => setTimeout(resolve, jitterMs));
        }

        if (Date.now() - Number(matchTs || 0) > CUSTOM_ACT_AUTO_MATCH_GRACE_MS) {
            return;
        }

        if (typeof CloudSync !== 'undefined' && !CloudSync.isLocalSandboxMode() && CloudSync.dbUrl) {
            const encodedActPath = CloudSync.encodePath(`${CUSTOM_ACTIVITIES_KEY}/${activityId}`);
            const encodedLockPath = CloudSync.encodePath(`${CUSTOM_ACT_CLOUD_LOCKS_NODE}/${lockNodeKey}`);

            const [actRes, lockRes] = await Promise.all([
                fetch(`${CloudSync.dbUrl}/${encodedActPath}.json${CloudSync.authQuery()}`, { method: 'GET', cache: 'no-store' }),
                fetch(`${CloudSync.dbUrl}/${encodedLockPath}.json${CloudSync.authQuery()}`, { method: 'GET', cache: 'no-store' })
            ]);

            // 若查詢雲端鎖失敗（網路逾時或離線），允許 12 秒後重試而不永久鎖死
            if (!actRes.ok || !lockRes.ok) {
                return;
            }

            const remoteAct = await actRes.json();
            const remoteLock = await lockRes.json();

            // 若雲端活動違反 3 大條件（關閉 / 防呆關閉 / 早於今日日期）、已標記 autoMatchedDone，或已有其他裝置搶先寫入雲端鎖，立即停止不再執行第二次
            if (!remoteAct || !checkCustomActivityThreeConditions(remoteAct, Date.now()).allowed || remoteAct.autoMatchedDone || (remoteLock && remoteLock.claimedBy)) {
                claimedSuccessfully = true;
                try { localStorage.setItem(lockKey, `DONE_${Date.now()}`); } catch (e) {}
                if (remoteAct && typeof remoteAct === 'object') {
                    try {
                        const localActs = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
                        const idx = localActs.findIndex(a => String(a.id) === String(activityId));
                        if (idx >= 0) {
                            localActs[idx] = { ...localActs[idx], ...remoteAct };
                            localStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(localActs));
                        }
                    } catch (e) {}
                }
                if (typeof CloudSync.fetchFullTree === 'function') {
                    await refreshCustomActFresh(isFrontendCaller);
                }
                if (typeof renderAdminAll === 'function') renderAdminAll();
                if (typeof refreshAllUI === 'function') refreshAllUI();
                return;
            }

            // 寫入雲端單次搶占鎖並二次驗證是否為唯一勝出者
            const claimToken = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            await CloudSync.putNode(`${CUSTOM_ACT_CLOUD_LOCKS_NODE}/${lockNodeKey}`, {
                activityId: String(activityId),
                matchTs: Number(matchTs),
                claimedBy: claimToken,
                claimedAt: Date.now()
            });

            await new Promise(resolve => setTimeout(resolve, 180));

            const verifyRes = await fetch(`${CloudSync.dbUrl}/${encodedLockPath}.json${CloudSync.authQuery()}`, { method: 'GET', cache: 'no-store' });
            if (!verifyRes.ok) {
                return;
            }
            const verifyLock = await verifyRes.json();
            if (!verifyLock || verifyLock.claimedBy !== claimToken) {
                claimedSuccessfully = true;
                try { localStorage.setItem(lockKey, `DONE_${Date.now()}`); } catch (e) {}
                if (typeof CloudSync.fetchFullTree === 'function') {
                    await refreshCustomActFresh(isFrontendCaller);
                }
                if (typeof renderAdminAll === 'function') renderAdminAll();
                if (typeof refreshAllUI === 'function') refreshAllUI();
                return;
            }

            claimedSuccessfully = true;
            try { localStorage.setItem(lockKey, `DONE_${Date.now()}`); } catch (e) {}

            // 等待其他寫入完成後拉取最新完整玩家資料，避免 inFlightWrites > 0 導致 fetchFullTree 跳過
            let waitTries = 0;
            while (CloudSync.inFlightWrites > 0 && waitTries < 10) {
                await new Promise(resolve => setTimeout(resolve, 150));
                waitTries++;
            }
            if (typeof CloudSync.fetchFullTree === 'function') {
                await refreshCustomActFresh(isFrontendCaller);
            }
        } else {
            claimedSuccessfully = true;
            try { localStorage.setItem(lockKey, `DONE_${Date.now()}`); } catch (e) {}
        }

        await executeCustomActivityMatchCore(activityId, { isAuto: true, markScheduledDone: true });
    } catch (e) {
        console.warn('claimAndRunScheduledCustomActivity 異常', e);
    } finally {
        if (!claimedSuccessfully) {
            try { localStorage.removeItem(lockKey); } catch (e) {}
        }
        customActivityAutoLockInFlight.delete(lockKey);
    }
}

function checkScheduledCustomActivities(isFrontendCaller = false) {
    if (typeof CUSTOM_ACTIVITIES_KEY === 'undefined') return false;
    if (typeof CloudSync !== 'undefined' && !CloudSync.initialized) return false;

    let acts = [];
    try {
        acts = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
    } catch (e) {
        return false;
    }
    if (!Array.isArray(acts) || acts.length === 0) return false;

    const nowTs = Date.now();
    let triggeredAny = false;

    acts.forEach(act => {
        if (!act || !act.id || act.autoMatchedDone) return;
        if (!checkCustomActivityThreeConditions(act, nowTs).allowed) return;
        const matchTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);
        if (!matchTs || nowTs < matchTs) return;
        // 逾期保護：距離設定配對時間超過 15 分鐘不再自動補跑，避免版本更新重整時意外觸發歷史活動
        if (nowTs - matchTs > CUSTOM_ACT_AUTO_MATCH_GRACE_MS) return;

        const lockNodeKey = makeCustomActLockNodeKey(act.id, matchTs);
        const lockKey = `${CUSTOM_ACT_LOCK_PREFIX}${lockNodeKey}`;
        if (customActivityAutoLockInFlight.has(lockKey)) return;

        const existingLockVal = localStorage.getItem(lockKey) || '';
        if (existingLockVal.startsWith('DONE_')) return;
        if (existingLockVal) {
            const attemptTs = Number(existingLockVal) || 0;
            // 若前一次嘗試超過 12 秒仍未標記 DONE_，允許自動重試，避免暫時網路抖動導致永不執行
            if (attemptTs > 0 && (nowTs - attemptTs) < 12000) return;
        }

        customActivityAutoLockInFlight.add(lockKey);
        localStorage.setItem(lockKey, String(nowTs));
        claimAndRunScheduledCustomActivity(act.id, matchTs, lockKey, isFrontendCaller);
        triggeredAny = true;
    });

    return triggeredAny;
}


// ==================== ⏱️ 活動結束後 3 分鐘自動清除「報名場次」選項（不影響會員已配對紀錄） ====================
const POST_ACTIVITY_REG_CLEAR_DELAY_MS = 3 * 60 * 1000;
const RECOVERED_ACT_REG_GRACE_MS = 15 * 60 * 1000;
let lastRegCleanupCheckTs = 0;
let isCustomActivityRecoveryInProgress = false;

function getRegularSessionEndTs(sessionStr) {
    const norm = normalizeSessionLabel(sessionStr);
    if (!norm) return 0;
    const batchMatch = norm.match(/^第\s*(\d+)\s*屆/);
    if (!batchMatch) return 0;
    const b = Math.max(1, parseInt(batchMatch[1], 10));
    const info = getBatchScheduleInfo(b);
    let targetDate = null;
    if (/(三|星期三|週三)/.test(norm)) {
        targetDate = new Date(info.wed);
    } else if (/(六|星期六|週六)/.test(norm)) {
        targetDate = new Date(info.sat);
    } else {
        targetDate = new Date(info.sat);
    }
    targetDate.setHours(20, 0, 0, 0);
    return targetDate.getTime();
}

function isRegularSessionRegistrationClosed(sessionStr, nowTs = Date.now()) {
    const endTs = getRegularSessionEndTs(sessionStr);
    return endTs > 0 && Number(nowTs) >= endTs;
}

function getCustomActivityClearRegsTs(act) {
    if (!act || typeof act !== 'object') return 0;
    const endTs = parseLocalDateTimeTs(act.endTime || act.endTimeTs);
    const matchTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);
    const lastMatchedTs = Number(act.lastMatchedTs || 0);
    const recoveredAtTs = Number(act.recoveredAtTs || 0);
    const hasCompletedMatch = Boolean(act.autoMatchedDone) || Number(act.matchCount || 0) > 0 || lastMatchedTs > 0;

    // 若剛透過後台「找回名單」還原報名資料，給予 15 分鐘安全保留期，避免 1 秒後又被自動清理清除
    if (recoveredAtTs > 0) {
        const recoveryGraceUntil = recoveredAtTs + RECOVERED_ACT_REG_GRACE_MS;
        if (lastMatchedTs > recoveredAtTs) {
            return Math.max(recoveryGraceUntil, lastMatchedTs + POST_ACTIVITY_REG_CLEAR_DELAY_MS);
        }
        return recoveryGraceUntil;
    }

    // 若活動設有配對時間但尚未完成配對，先保留報名資料 30 分鐘以供補跑或恢復，避免在還沒配對前 3 分鐘就被自動清空
    if (matchTs > 0 && !hasCompletedMatch) {
        return matchTs + (30 * 60 * 1000);
    }

    const effectiveEndTs = (matchTs > 0 || endTs > 0)
        ? Math.max(matchTs, endTs, lastMatchedTs)
        : (lastMatchedTs > 0 ? lastMatchedTs : 0);
    if (!effectiveEndTs) return 0;
    return effectiveEndTs + POST_ACTIVITY_REG_CLEAR_DELAY_MS;
}

function cleanupExpiredActivityRegistrations(isFrontendCaller = false, nowTs = Date.now()) {
    if (isCustomActivityRecoveryInProgress) return false;
    if (typeof USERS_KEY === 'undefined') return false;
    if (typeof CloudSync !== 'undefined' && !CloudSync.initialized) return false;
    if (nowTs - lastRegCleanupCheckTs < 1500) return false;
    lastRegCleanupCheckTs = nowTs;

    let users = [];
    try {
        users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
    } catch (e) {
        return false;
    }
    if (!Array.isArray(users) || users.length === 0) return false;

    let customActs = [];
    try {
        customActs = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
    } catch (e) {
        customActs = [];
    }

    const expiredCustomActMap = new Map();
    (Array.isArray(customActs) ? customActs : []).forEach(act => {
        if (!act || !act.id) return;
        const recoveredAtTs = Number(act.recoveredAtTs || 0);
        if (recoveredAtTs > 0 && (nowTs - recoveredAtTs) < RECOVERED_ACT_REG_GRACE_MS) {
            return;
        }
        const clearTs = getCustomActivityClearRegsTs(act);
        const matchTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);
        const isClosedAndDone = !act.isOpen && (Boolean(act.autoMatchedDone) || (matchTs > 0 && nowTs >= matchTs));
        if ((clearTs > 0 && nowTs >= clearTs) || isClosedAndDone) {
            expiredCustomActMap.set(String(act.id), {
                name: act.name || String(act.id),
                clearTs: clearTs > 0 ? clearTs : nowTs
            });
        }
    });

    const currentPlayerId = (isFrontendCaller && typeof appState !== 'undefined' && appState && appState.playerId)
        ? String(appState.playerId).trim()
        : '';

    const changedUsers = [];
    const clearedRegularSummary = new Map();
    const clearedCustomSummary = new Map();

    users.forEach(u => {
        if (!u || !u.id) return;
        const uid = String(u.id).trim();
        // 前台玩家裝置僅允許清理「自己登入的帳號」，嚴禁改寫其他玩家的雲端資料（防止舊快取手機覆蓋他人配對紀錄）
        if (isFrontendCaller && (!currentPlayerId || uid !== currentPlayerId)) {
            return;
        }
        let userModified = false;
        let regularChanged = false;
        let customChanged = false;

        // 1. 檢查常規場次（例如：第2屆11/21(六) 於 20:00 結束後，等到 20:03 自動清除選項）
        const prevSessions = Array.isArray(u.registeredSessions)
            ? u.registeredSessions
            : (u.registeredSession ? [u.registeredSession] : []);
        if (prevSessions.length > 0) {
            const keptSessions = [];
            prevSessions.forEach(s => {
                const endTs = getRegularSessionEndTs(s);
                const clearTs = endTs > 0 ? (endTs + POST_ACTIVITY_REG_CLEAR_DELAY_MS) : 0;
                if (clearTs > 0 && nowTs >= clearTs) {
                    const label = normalizeSessionLabel(s) || String(s);
                    if (typeof ActivityRegArchive !== 'undefined') {
                        ActivityRegArchive.recordRegular(u, label, true);
                    }
                    clearedRegularSummary.set(label, (clearedRegularSummary.get(label) || 0) + 1);
                    userModified = true;
                    regularChanged = true;
                } else {
                    keptSessions.push(s);
                }
            });

            if (regularChanged) {
                u.registeredSessions = keptSessions;
                delete u.registeredSession;
                if (keptSessions.length === 0) {
                    u.exactMatchCriteria = {};
                    u.mustMatchKeys = [];
                }
            }
        }

        // 2. 檢查第 2 種自定義活動（活動結束後經過 3 分鐘自動清除報名選項）
        if (u.customActivityRegs && typeof u.customActivityRegs === 'object' && !Array.isArray(u.customActivityRegs)) {
            Object.keys(u.customActivityRegs).forEach(actId => {
                const regEntry = u.customActivityRegs[actId];
                const entryRecoveredAt = Number((regEntry && regEntry.recoveredAt) || 0);
                if (entryRecoveredAt > 0 && (nowTs - entryRecoveredAt) < RECOVERED_ACT_REG_GRACE_MS) return;
                const info = expiredCustomActMap.get(String(actId));
                if (!info) return;
                if (typeof ActivityRegArchive !== 'undefined') {
                    ActivityRegArchive.recordCustom(u, actId, u.customActivityRegs[actId], true);
                }
                delete u.customActivityRegs[actId];
                clearedCustomSummary.set(info.name, (clearedCustomSummary.get(info.name) || 0) + 1);
                userModified = true;
                customChanged = true;
            });
        }

        if (userModified) {
            const patchFields = {};
            if (regularChanged) {
                patchFields.registeredSessions = Array.isArray(u.registeredSessions) ? [...u.registeredSessions] : [];
                patchFields.registeredSession = null;
                if (patchFields.registeredSessions.length === 0) {
                    patchFields.exactMatchCriteria = {};
                    patchFields.mustMatchKeys = [];
                }
            }
            if (customChanged) {
                patchFields.customActivityRegs = (u.customActivityRegs && typeof u.customActivityRegs === 'object') ? { ...u.customActivityRegs } : {};
            }
            changedUsers.push({ user: u, patchFields });
        }
    });

    if (changedUsers.length === 0) return false;

    localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
    if (typeof LocalJsonCache !== 'undefined') {
        LocalJsonCache.invalidate(USERS_LOCAL_KEY);
    }

    if (isFrontendCaller && currentPlayerId && typeof appState !== 'undefined' && appState) {
        const me = users.find(u => String(u.id).trim() === currentPlayerId);
        if (me) {
            delete appState.registeredSession;
            appState.registeredSessions = Array.isArray(me.registeredSessions) ? [...me.registeredSessions] : [];
            appState.exactMatchCriteria = (me.exactMatchCriteria && typeof me.exactMatchCriteria === 'object') ? { ...me.exactMatchCriteria } : {};
            appState.mustMatchKeys = Array.isArray(me.mustMatchKeys) ? [...me.mustMatchKeys] : [];
            appState.customActivityRegs = (me.customActivityRegs && typeof me.customActivityRegs === 'object') ? { ...me.customActivityRegs } : {};
        }
    }

    // 僅以 PATCH 局部更新報名欄位，絕不整筆 PUT 覆蓋會員物件，確保 matchedHistory 100% 不受影響
    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        changedUsers.forEach(({ user, patchFields }) => {
            if (typeof CloudSync.patchUserFields === 'function') {
                CloudSync.patchUserFields(user.id, patchFields, user);
            }
        });
    }

    if (!isFrontendCaller && typeof appendLog === 'function') {
        clearedRegularSummary.forEach((cnt, label) => {
            appendLog(`<span class="text-sky-300">[自動清除報名選項]</span> 場次「<strong>${label}</strong>」結束已滿 3 分鐘，已自動清除 <strong>${cnt} 位</strong>玩家的報名場次選項（不影響已配對好友）。`);
        });
        clearedCustomSummary.forEach((cnt, actName) => {
            appendLog(`<span class="text-sky-300">[自動清除活動報名]</span> 自定義活動「<strong>${actName}</strong>」結束已滿 3 分鐘，已自動清除 <strong>${cnt} 位</strong>玩家的報名選項（不影響已配對好友）。`);
        });
    }

    if (!isFrontendCaller && typeof renderAdminAll === 'function') {
        renderAdminAll();
    }

    return true;
}


// ==================== 🏮 紅線祈願牆：以每日 20:00 計算天數、男生每日3位限額與狀態判斷 ====================
const WISH_MALE_DAILY_LIMIT = 3;

function getWishNext2000ResetTs(nowTs = Date.now()) {
    const d = new Date(Number(nowTs) || Date.now());
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= Number(nowTs)) {
        d.setDate(d.getDate() + 1);
    }
    return d.getTime();
}

function getWishCurrent2000CycleWindow(nowTs = Date.now()) {
    const nextResetTs = getWishNext2000ResetTs(nowTs);
    const cycleStartTs = nextResetTs - 24 * 60 * 60 * 1000;
    return { cycleStartTs, nextResetTs };
}

function getMaleWishDailyQuotaStatus(wishesList = [], nowTs = Date.now()) {
    const { cycleStartTs, nextResetTs } = getWishCurrent2000CycleWindow(nowTs);
    const list = Array.isArray(wishesList) ? wishesList : [];
    const maleWishesToday = list.filter(w => {
        if (!w || typeof w !== 'object') return false;
        const g = String(w.authorGender || '').trim();
        const inferredG = (g === '男' || g === '女')
            ? g
            : (String(w.authorId || '').startsWith('1') ? '男' : (String(w.authorId || '').startsWith('2') ? '女' : ''));
        if (inferredG !== '男') return false;
        const cTs = Number(w.createdAtTs || 0);
        return cTs >= cycleStartTs && cTs < nextResetTs;
    });
    const usedCount = maleWishesToday.length;
    const remaining = Math.max(0, WISH_MALE_DAILY_LIMIT - usedCount);
    return {
        limit: WISH_MALE_DAILY_LIMIT,
        usedCount,
        remaining,
        isFull: usedCount >= WISH_MALE_DAILY_LIMIT,
        cycleStartTs,
        resetAtTs: nextResetTs
    };
}

function calcWishExpiresAtTs(createdAtTs, openDays = 1) {
    const baseTs = Number(createdAtTs) || Date.now();
    const days = Math.max(1, Math.min(30, parseInt(openDays, 10) || 1));
    const first2000 = new Date(baseTs);
    first2000.setHours(20, 0, 0, 0);
    if (first2000.getTime() <= baseTs) {
        first2000.setDate(first2000.getDate() + 1);
    }
    return first2000.getTime() + (days - 1) * 24 * 60 * 60 * 1000;
}

function isWishWallEnded(wish, nowTs = Date.now()) {
    if (!wish || typeof wish !== 'object') return true;
    if (wish.manuallyClosed) return true;
    const expTs = Number(wish.expiresAtTs || 0);
    if (expTs > 0 && nowTs >= expTs) return true;
    return false;
}

function calcWishRemainingDays(wish, nowTs = Date.now()) {
    if (isWishWallEnded(wish, nowTs)) return 0;
    const expTs = Number(wish.expiresAtTs || 0);
    if (!expTs || expTs <= nowTs) return 0;
    const dayMs = 24 * 60 * 60 * 1000;
    return Math.max(1, Math.ceil((expTs - nowTs) / dayMs));
}

function normalizeWishWallItem(rawWish) {
    if (!rawWish || typeof rawWish !== 'object' || !rawWish.id) return null;
    const w = { ...rawWish };
    w.id = String(w.id).trim();
    w.authorId = String(w.authorId || '').trim();
    w.authorNickname = String(w.authorNickname || '').trim();
    const rawG = String(w.authorGender || '').trim();
    w.authorGender = (rawG === '男' || rawG === '女')
        ? rawG
        : (w.authorId.startsWith('1') ? '男' : (w.authorId.startsWith('2') ? '女' : '女'));
    w.authorCity = String(w.authorCity || '').trim();
    w.authorMbti = String(w.authorMbti || '').trim();
    w.title = String(w.title || '').trim();
    w.openDays = Math.max(1, Math.min(30, parseInt(w.openDays, 10) || 1));
    w.createdAtTs = Number(w.createdAtTs || 0) || Date.now();
    w.expiresAtTs = Number(w.expiresAtTs || 0) || calcWishExpiresAtTs(w.createdAtTs, w.openDays);
    w.manuallyClosed = Boolean(w.manuallyClosed);
    w.closedAtTs = Number(w.closedAtTs || 0);
    w.settled = Boolean(w.settled);
    w.settledWithoutMatch = Boolean(w.settledWithoutMatch);
    w.matchedAnonNumber = w.matchedAnonNumber ? Number(w.matchedAnonNumber) : null;
    w.matchedResponderId = w.matchedResponderId ? String(w.matchedResponderId).trim() : null;
    w.settledAtTs = Number(w.settledAtTs || 0);
    w.isPinned = Boolean(rawWish.isPinned);
    w.pinnedAtTs = w.isPinned ? (Number(rawWish.pinnedAtTs || 0) || Date.now()) : 0;

    const rawQs = Array.isArray(w.questions)
        ? w.questions
        : (w.questions && typeof w.questions === 'object' ? Object.values(w.questions) : []);
    w.questions = rawQs
        .filter(q => q && typeof q === 'object' && String(q.question || '').trim() !== '')
        .map((q, idx) => ({
            qIndex: idx + 1,
            question: String(q.question || '').trim(),
            optionA: String(q.optionA || '').trim() || '選項 A',
            optionB: String(q.optionB || '').trim() || '選項 B'
        }));

    const rawResps = Array.isArray(w.responses)
        ? w.responses
        : (w.responses && typeof w.responses === 'object' ? Object.values(w.responses) : []);
    const validResps = rawResps
        .filter(r => r && typeof r === 'object' && String(r.responderId || '').trim() !== '')
        .sort((a, b) => {
            const diff = Number(a.createdAtTs || 0) - Number(b.createdAtTs || 0);
            if (diff !== 0) return diff;
            return String(a.responderId).localeCompare(String(b.responderId));
        });

    w.responses = validResps.map((r, idx) => {
        const rawAns = Array.isArray(r.answers)
            ? r.answers
            : (r.answers && typeof r.answers === 'object' ? Object.values(r.answers) : []);
        return {
            anonNumber: idx + 1,
            responderId: String(r.responderId || '').trim(),
            responderNickname: String(r.responderNickname || '').trim(),
            responderGender: String(r.responderGender || '').trim(),
            answers: rawAns.filter(a => a && typeof a === 'object').map((a, aIdx) => ({
                qIndex: Number(a.qIndex || (aIdx + 1)),
                chosenOption: String(a.chosenOption || '').trim(),
                chosenText: String(a.chosenText || '').trim()
            })),
            note: String(r.note || '').trim(),
            createdAtTs: Number(r.createdAtTs || 0) || Date.now()
        };
    });

    return w;
}

function compareWishWallItems(a, b) {
    const pinA = Boolean(a && a.isPinned) ? 1 : 0;
    const pinB = Boolean(b && b.isPinned) ? 1 : 0;
    if (pinA !== pinB) {
        return pinB - pinA;
    }
    if (pinA === 1 && pinB === 1) {
        const pinTsDiff = Number(b.pinnedAtTs || 0) - Number(a.pinnedAtTs || 0);
        if (pinTsDiff !== 0) return pinTsDiff;
    }
    return Number((b && b.createdAtTs) || 0) - Number((a && a.createdAtTs) || 0);
}

// ==================== ✨ 即時緣分動態牆：地區＆年齡＆MBTI 每次刷新動態隨機引擎 ====================
const FATE_WALL_REGIONS = ['北部', '中部', '南部', '東部'];
const FATE_WALL_MBTI_ALL = [
    'INTJ', 'INTP', 'ENTJ', 'ENTP',
    'INFJ', 'INFP', 'ENFJ', 'ENFP',
    'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
    'ISTP', 'ISFP', 'ESTP', 'ESFP'
];
const FATE_WALL_MBTI_I = ['INTJ', 'INTP', 'INFJ', 'INFP', 'ISTJ', 'ISFJ', 'ISTP', 'ISFP'];
const FATE_WALL_MBTI_E = ['ENTJ', 'ENTP', 'ENFJ', 'ENFP', 'ESTJ', 'ESFJ', 'ESTP', 'ESFP'];

function pickRandomFromArray(arr, excludeVal = '') {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    if (arr.length === 1) return arr[0];
    const filtered = excludeVal ? arr.filter(item => String(item) !== String(excludeVal)) : arr;
    const pool = filtered.length > 0 ? filtered : arr;
    return pool[Math.floor(Math.random() * pool.length)];
}

function rollRandomFateWallAge(excludeAge = null) {
    // 單身適婚熱門年齡區間：22～36 歲
    const minAge = 22;
    const maxAge = 36;
    let picked = minAge + Math.floor(Math.random() * (maxAge - minAge + 1));
    if (excludeAge !== null && Number(excludeAge) === picked) {
        picked = minAge + ((picked - minAge + 1 + Math.floor(Math.random() * (maxAge - minAge))) % (maxAge - minAge + 1));
    }
    return picked;
}

function hasFateWallDynamicFields(rawText) {
    const str = String(rawText || '');
    if (!str) return false;
    if (/\{(?:地區|年齡|MBTI|I人MBTI|E人MBTI)\}/i.test(str)) return true;
    if (/(北部|中部|南部|東部)/.test(str)) return true;
    if (/(\d{2})\s*歲/.test(str)) return true;
    if (/\b(?:INTJ|INTP|ENTJ|ENTP|INFJ|INFP|ENFJ|ENFP|ISTJ|ISFJ|ESTJ|ESFJ|ISTP|ISFP|ESTP|ESFP)\b/i.test(str)) return true;
    return false;
}

function resolveFateWallDynamicText(rawText) {
    let text = String(rawText || '');
    if (!text) return '';

    let lastRegion = '';
    let lastAge = null;
    let lastMbti = '';

    // 1. 先替換明確佔位符：{地區}、{年齡}、{MBTI}、{I人MBTI}、{E人MBTI}
    text = text.replace(/\{地區\}/g, () => {
        const nextReg = pickRandomFromArray(FATE_WALL_REGIONS, lastRegion);
        lastRegion = nextReg;
        return nextReg;
    });

    text = text.replace(/\{年齡\}/g, () => {
        const nextAge = rollRandomFateWallAge(lastAge);
        lastAge = nextAge;
        return String(nextAge);
    });

    text = text.replace(/\{I人MBTI\}/gi, () => {
        const nextM = pickRandomFromArray(FATE_WALL_MBTI_I, lastMbti);
        lastMbti = nextM;
        return nextM;
    });

    text = text.replace(/\{E人MBTI\}/gi, () => {
        const nextM = pickRandomFromArray(FATE_WALL_MBTI_E, lastMbti);
        lastMbti = nextM;
        return nextM;
    });

    text = text.replace(/\{MBTI\}/gi, () => {
        const nextM = pickRandomFromArray(FATE_WALL_MBTI_ALL, lastMbti);
        lastMbti = nextM;
        return nextM;
    });

    // 2. 若管理者直接輸入具體文字（例如「北部 26 歲 INFP 女生與中部 28 歲 ENTJ 男生好友配對成功」），
    //    每次前台刷新時同樣自動隨機替換其中的 地區、年齡 與 MBTI
    text = text.replace(/(北部|中部|南部|東部)/g, (matchedReg) => {
        const nextReg = pickRandomFromArray(FATE_WALL_REGIONS, lastRegion || matchedReg);
        lastRegion = nextReg;
        return nextReg;
    });

    text = text.replace(/(\d{2})(\s*歲)/g, (_, numStr, suffix) => {
        const origAge = parseInt(numStr, 10);
        const nextAge = rollRandomFateWallAge(lastAge !== null ? lastAge : origAge);
        lastAge = nextAge;
        return `${nextAge}${suffix}`;
    });

    text = text.replace(/\b(INTJ|INTP|ENTJ|ENTP|INFJ|INFP|ENFJ|ENFP|ISTJ|ISFJ|ESTJ|ESFJ|ISTP|ISFP|ESTP|ESFP)\b/gi, (matchedMbti) => {
        const upperOrig = String(matchedMbti).toUpperCase();
        const nextM = pickRandomFromArray(FATE_WALL_MBTI_ALL, lastMbti || upperOrig);
        lastMbti = nextM;
        return nextM;
    });

    return text;
}
