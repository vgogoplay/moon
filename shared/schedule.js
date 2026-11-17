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
    return candidate[key] === desiredVal;
}

function sharedRecordCustomPairMatch(userA, userB, targetSession, nowTs, activityId, matchDetail = '') {
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
}

const CUSTOM_ACT_LOCK_PREFIX = 'yuelao_custom_act_lock_';
const CUSTOM_ACT_CLOUD_LOCKS_NODE = 'yuelao_custom_act_locks';
const CUSTOM_ACT_AUTO_MATCH_GRACE_MS = 15 * 60 * 1000; // 超過設定配對時間 15 分鐘即視為逾期，絕不在更新重整時自動補跑
const customActivityAutoLockInFlight = new Set();

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
    const { isAuto = false, markScheduledDone = false } = options;
    let acts = [];
    try {
        acts = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
    } catch (e) {
        acts = [];
    }
    const act = Array.isArray(acts) ? acts.find(a => String(a.id) === String(activityId)) : null;
    if (!act) return { executed: false, pairCount: 0, unmatchedCount: 0 };

    // 單次執行保護：若為到點自動配對且活動已關閉或已標記完成，絕不重複執行第二次
    if (isAuto && (!act.isOpen || act.autoMatchedDone)) {
        return { executed: false, pairCount: 0, unmatchedCount: 0 };
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
            : JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    } catch (e) {
        users = [];
    }

    const areFriendsFn = (A, B) =>
        (A.matchedHistory || []).some(h => String(h.partnerId) === String(B.id)) ||
        String(A.matchedWithId) === String(B.id);

    const acceptsCustomFn = (seeker, candidate) => {
        const reg = seeker.customActivityRegs && seeker.customActivityRegs[act.id];
        const criteria = (reg && reg.exactMatchCriteria) ? reg.exactMatchCriteria : {};
        if (!sharedMatchesGenderPreference(seeker, candidate, criteria)) return false;
        const otherKeys = Object.keys(criteria).filter(k => k !== 'gender' && !(k === 'city' && criteria.region));
        if (otherKeys.length === 0) return true;
        return otherKeys.some(k => sharedCheckSingleCriterion(k, criteria[k], candidate, criteria));
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

    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    if (matchedUsersToPush.length > 0 && typeof CloudSync !== 'undefined') {
        await Promise.all(matchedUsersToPush.map(u => CloudSync.upsertUser(u, true, { isMatchMutation: true })));
    }

    if (typeof renderAdminAll === 'function') {
        renderAdminAll();
    }

    return { executed: true, actName: act.name, pairCount, unmatchedCount };
}

async function claimAndRunScheduledCustomActivity(activityId, matchTs, lockKey, isFrontendCaller = false) {
    const lockNodeKey = makeCustomActLockNodeKey(activityId, matchTs);
    try {
        // 逾期保護：距離設定配對時間超過 15 分鐘即不再背景自動觸發
        if (Date.now() - Number(matchTs || 0) > CUSTOM_ACT_AUTO_MATCH_GRACE_MS) {
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

        if (typeof CloudSync !== 'undefined' && CloudSync.dbUrl) {
            const encodedActPath = CloudSync.encodePath(`${CUSTOM_ACTIVITIES_KEY}/${activityId}`);
            const encodedLockPath = CloudSync.encodePath(`${CUSTOM_ACT_CLOUD_LOCKS_NODE}/${lockNodeKey}`);

            const [actRes, lockRes] = await Promise.all([
                fetch(`${CloudSync.dbUrl}/${encodedActPath}.json`, { method: 'GET', cache: 'no-store' }),
                fetch(`${CloudSync.dbUrl}/${encodedLockPath}.json`, { method: 'GET', cache: 'no-store' })
            ]);

            // 若查詢雲端鎖失敗（網路逾時或離線），立即中止而不盲目執行配對
            if (!actRes.ok || !lockRes.ok) {
                return;
            }

            const remoteAct = await actRes.json();
            const remoteLock = await lockRes.json();

            // 若雲端活動已關閉、已標記 autoMatchedDone，或已有其他裝置搶先寫入雲端鎖，立即停止不再執行第二次
            if (!remoteAct || !remoteAct.isOpen || remoteAct.autoMatchedDone || (remoteLock && remoteLock.claimedBy)) {
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
                    await CloudSync.fetchFullTree();
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

            const verifyRes = await fetch(`${CloudSync.dbUrl}/${encodedLockPath}.json`, { method: 'GET', cache: 'no-store' });
            if (!verifyRes.ok) {
                return;
            }
            const verifyLock = await verifyRes.json();
            if (!verifyLock || verifyLock.claimedBy !== claimToken) {
                if (typeof CloudSync.fetchFullTree === 'function') {
                    await CloudSync.fetchFullTree();
                }
                if (typeof renderAdminAll === 'function') renderAdminAll();
                if (typeof refreshAllUI === 'function') refreshAllUI();
                return;
            }

            // 確認取得唯一執行權後，先拉取最新完整玩家資料再進行配對
            if (typeof CloudSync.fetchFullTree === 'function') {
                await CloudSync.fetchFullTree();
            }
        }

        await executeCustomActivityMatchCore(activityId, { isAuto: true, markScheduledDone: true });
    } catch (e) {
        // 發生網路或同步異常時嚴禁無條件補跑，避免重複配對
        console.warn('claimAndRunScheduledCustomActivity 異常（已安全中止自動補跑）', e);
    } finally {
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
        if (!act || !act.id || !act.isOpen || act.autoMatchedDone) return;
        const matchTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);
        if (!matchTs || nowTs < matchTs) return;
        // 逾期保護：距離設定配對時間超過 15 分鐘不再自動補跑，避免版本更新重整時意外觸發歷史活動
        if (nowTs - matchTs > CUSTOM_ACT_AUTO_MATCH_GRACE_MS) return;

        const lockNodeKey = makeCustomActLockNodeKey(act.id, matchTs);
        const lockKey = `${CUSTOM_ACT_LOCK_PREFIX}${lockNodeKey}`;
        if (customActivityAutoLockInFlight.has(lockKey) || localStorage.getItem(lockKey)) return;

        customActivityAutoLockInFlight.add(lockKey);
        localStorage.setItem(lockKey, String(nowTs));
        claimAndRunScheduledCustomActivity(act.id, matchTs, lockKey, isFrontendCaller);
        triggeredAny = true;
    });

    return triggeredAny;
}


// ==================== ⏱️ 活動結束後 3 分鐘自動清除「報名場次」選項（不影響會員已配對紀錄） ====================
const POST_ACTIVITY_REG_CLEAR_DELAY_MS = 3 * 60 * 1000;
let lastRegCleanupCheckTs = 0;

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

function getCustomActivityClearRegsTs(act) {
    if (!act || typeof act !== 'object') return 0;
    const endTs = parseLocalDateTimeTs(act.endTime || act.endTimeTs);
    const matchTs = parseLocalDateTimeTs(act.matchTime || act.matchTimeTs);
    const lastMatchedTs = Number(act.lastMatchedTs || 0);
    const effectiveEndTs = (matchTs > 0 || endTs > 0)
        ? Math.max(matchTs, endTs)
        : (lastMatchedTs > 0 ? lastMatchedTs : 0);
    if (!effectiveEndTs) return 0;
    return effectiveEndTs + POST_ACTIVITY_REG_CLEAR_DELAY_MS;
}

function cleanupExpiredActivityRegistrations(isFrontendCaller = false, nowTs = Date.now()) {
    if (typeof USERS_KEY === 'undefined') return false;
    if (typeof CloudSync !== 'undefined' && !CloudSync.initialized) return false;
    if (nowTs - lastRegCleanupCheckTs < 1500) return false;
    lastRegCleanupCheckTs = nowTs;

    let users = [];
    try {
        users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
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
        const clearTs = getCustomActivityClearRegsTs(act);
        if (clearTs > 0 && nowTs >= clearTs) {
            expiredCustomActMap.set(String(act.id), { name: act.name || String(act.id), clearTs });
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
        let userModified = false;

        // 1. 檢查常規場次（例如：第2屆11/21(六) 於 20:00 結束後，等到 20:03 自動清除選項）
        const prevSessions = Array.isArray(u.registeredSessions)
            ? u.registeredSessions
            : (u.registeredSession ? [u.registeredSession] : []);
        if (prevSessions.length > 0) {
            const keptSessions = [];
            prevSessions.forEach(s => {
                const endTs = getRegularSessionEndTs(s);
                const clearTs = endTs > 0 ? (endTs + POST_ACTIVITY_REG_CLEAR_DELAY_MS) : 0;
                // 前台僅在輪到自己帳號，或已超過緩衝 10 秒仍未清除時協助清理，避免多台手機同時搶寫
                const canCleanThis = !isFrontendCaller || uid === currentPlayerId || nowTs >= (clearTs + 10000);
                if (clearTs > 0 && nowTs >= clearTs && canCleanThis) {
                    const label = normalizeSessionLabel(s) || String(s);
                    if (typeof ActivityRegArchive !== 'undefined') {
                        ActivityRegArchive.recordRegular(u, label, true);
                    }
                    clearedRegularSummary.set(label, (clearedRegularSummary.get(label) || 0) + 1);
                    userModified = true;
                } else {
                    keptSessions.push(s);
                }
            });

            if (userModified) {
                u.registeredSessions = keptSessions;
                delete u.registeredSession;
                if (keptSessions.length === 0) {
                    u.exactMatchCriteria = {};
                }
            }
        }

        // 2. 檢查第 2 種自定義活動（活動結束後經過 3 分鐘自動清除報名選項）
        if (u.customActivityRegs && typeof u.customActivityRegs === 'object' && !Array.isArray(u.customActivityRegs)) {
            Object.keys(u.customActivityRegs).forEach(actId => {
                const info = expiredCustomActMap.get(String(actId));
                if (!info) return;
                const canCleanThis = !isFrontendCaller || uid === currentPlayerId || nowTs >= (info.clearTs + 10000);
                if (canCleanThis) {
                    if (typeof ActivityRegArchive !== 'undefined') {
                        ActivityRegArchive.recordCustom(u, actId, u.customActivityRegs[actId], true);
                    }
                    delete u.customActivityRegs[actId];
                    clearedCustomSummary.set(info.name, (clearedCustomSummary.get(info.name) || 0) + 1);
                    userModified = true;
                }
            });
        }

        if (userModified) {
            changedUsers.push(u);
        }
    });

    if (changedUsers.length === 0) return false;

    localStorage.setItem(USERS_KEY, JSON.stringify(users));

    if (isFrontendCaller && currentPlayerId && typeof appState !== 'undefined' && appState) {
        const me = users.find(u => String(u.id).trim() === currentPlayerId);
        if (me) {
            delete appState.registeredSession;
            appState.registeredSessions = Array.isArray(me.registeredSessions) ? [...me.registeredSessions] : [];
            appState.exactMatchCriteria = (me.exactMatchCriteria && typeof me.exactMatchCriteria === 'object') ? { ...me.exactMatchCriteria } : {};
            appState.customActivityRegs = (me.customActivityRegs && typeof me.customActivityRegs === 'object') ? { ...me.customActivityRegs } : {};
        }
    }

    if (typeof CloudSync !== 'undefined') {
        changedUsers.forEach(u => {
            CloudSync.upsertUser(u, true);
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
