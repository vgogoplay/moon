/* frontend/activities.js - 前台首頁即時緣分動態牆、即時統計圖表、常規場次報名與第 2 種專屬活動報名 */

let lastHomeFateWallContentSig = '';
let sessionShuffledFateWallOrder = [];
const LAST_FATE_WALL_ORDER_SESSION_KEY = 'yuelao_last_fate_wall_order_sig';
const LAST_FATE_WALL_RENDERED_TEXT_KEY = 'yuelao_last_fate_wall_rendered_text';

function escapeFateWallHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildRandomizedFateWallVisitList(posts) {
    const list = Array.isArray(posts) ? [...posts] : [];
    if (list.length === 0) return [];

    let prevOrderSig = '';
    let prevRenderedSig = '';
    try {
        prevOrderSig = sessionStorage.getItem(LAST_FATE_WALL_ORDER_SESSION_KEY) || '';
        prevRenderedSig = sessionStorage.getItem(LAST_FATE_WALL_RENDERED_TEXT_KEY) || '';
    } catch (e) {}

    const doFisherYates = (arr) => {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };

    const resolveItem = (item) => {
        const rawContent = String(item.content || '').trim();
        const resolvedContent = (typeof resolveFateWallDynamicText === 'function')
            ? resolveFateWallDynamicText(rawContent)
            : rawContent;
        return {
            ...item,
            resolvedContent
        };
    };

    let shuffled = doFisherYates(list);
    if (list.length > 1) {
        for (let attempt = 0; attempt < 6; attempt++) {
            const orderSig = shuffled.map(p => String(p.id || p.content)).join('|');
            if (!prevOrderSig || orderSig !== prevOrderSig) {
                break;
            }
            shuffled = doFisherYates(list);
        }
    }

    let resolvedList = shuffled.map(resolveItem);
    // 確保每次前台重新刷新時，生成的地區／年齡／MBTI 與文案內容皆與上一次不同
    for (let attempt = 0; attempt < 8; attempt++) {
        const renderedSig = resolvedList.map(p => `${p.tag || ''}:${p.resolvedContent}`).join('||');
        if (!prevRenderedSig || renderedSig !== prevRenderedSig) {
            break;
        }
        shuffled = doFisherYates(list);
        resolvedList = shuffled.map(resolveItem);
    }

    try {
        const finalOrderSig = resolvedList.map(p => String(p.id || p.content)).join('|');
        const finalRenderedSig = resolvedList.map(p => `${p.tag || ''}:${p.resolvedContent}`).join('||');
        sessionStorage.setItem(LAST_FATE_WALL_ORDER_SESSION_KEY, finalOrderSig);
        sessionStorage.setItem(LAST_FATE_WALL_RENDERED_TEXT_KEY, finalRenderedSig);
    } catch (e) {}

    return resolvedList;
}

function renderHomeFateWall(forceRender = false) {
    const marqueeBox = document.getElementById('homeFateWallMarqueeBox');
    if (!marqueeBox) return;

    const keyName = (typeof FATE_WALL_KEY !== 'undefined') ? FATE_WALL_KEY : 'yuelao_fate_wall';
    const rawStr = localStorage.getItem(keyName) || '[]';

    let posts = [];
    try {
        const parsed = JSON.parse(rawStr);
        if (Array.isArray(parsed)) {
            posts = parsed
                .filter(item => item && typeof item === 'object' && String(item.content || '').trim() !== '');
        }
    } catch (e) {
        posts = [];
    }

    // 每次網頁刷新載入時 lastHomeFateWallContentSig 為空，會重新洗牌並隨機產生新的地區/年齡/MBTI；
    // 同一趟瀏覽期間若後台未修改清單，則維持該趟已隨機出的內容，避免跑馬燈每秒重繪跳動
    const contentSig = JSON.stringify(
        posts
            .map(p => [String(p.id || ''), String(p.tag || ''), String(p.content || '')])
            .sort((a, b) => a[0].localeCompare(b[0]))
    );

    if (contentSig !== lastHomeFateWallContentSig || sessionShuffledFateWallOrder.length !== posts.length) {
        lastHomeFateWallContentSig = contentSig;
        sessionShuffledFateWallOrder = buildRandomizedFateWallVisitList(posts);
        forceRender = true;
    }

    if (!forceRender && marqueeBox.dataset.rendered === '1') {
        return;
    }
    marqueeBox.dataset.rendered = '1';

    if (sessionShuffledFateWallOrder.length === 0) {
        marqueeBox.innerHTML = `
            <div class="fate-marquee-track" style="--marquee-duration: 18s;">
                <div class="fate-marquee-group">
                    <span class="fate-marquee-item text-xs md:text-sm text-[#6e3a43] font-medium">
                        🌸 目前尚無最新動態，管理月老隨時會在此分享最新喜訊！
                    </span>
                </div>
                <div class="fate-marquee-group" aria-hidden="true">
                    <span class="fate-marquee-item text-xs md:text-sm text-[#6e3a43] font-medium">
                        🌸 目前尚無最新動態，管理月老隨時會在此分享最新喜訊！
                    </span>
                </div>
            </div>
        `;
        return;
    }

    let totalChars = 0;
    const itemsHtml = sessionShuffledFateWallOrder.map(item => {
        const tagText = String(item.tag || '🌸 月老動態').trim();
        const contentText = String(item.resolvedContent || item.content || '').trim();
        totalChars += tagText.length + contentText.length + 4;
        return `
            <span class="fate-marquee-item">
                <span class="px-2 py-0.5 rounded-full bg-rose-100/90 border border-pink-200 text-[#8f4452] text-[11px] font-bold">
                    ${escapeFateWallHtml(tagText)}
                </span>
                <span class="text-xs md:text-sm text-[#5e343c] font-semibold">
                    ${escapeFateWallHtml(contentText)}
                </span>
                <span class="text-pink-300 text-xs mx-1">✦</span>
            </span>
        `;
    }).join('');

    const durationSec = Math.max(12, Math.min(90, Math.round(totalChars * 0.34)));

    marqueeBox.innerHTML = `
        <div class="fate-marquee-track" style="--marquee-duration: ${durationSec}s;">
            <div class="fate-marquee-group">
                ${itemsHtml}
            </div>
            <div class="fate-marquee-group" aria-hidden="true">
                ${itemsHtml}
            </div>
        </div>
    `;
}

// ==================== 前台首頁：即時男女比例與 I人 / E人 / 不知道・沒測過 統計圖表（30 秒節流冷卻） ====================
const HOME_STATS_COOLDOWN_MS = 30000;
let lastHomeStatsRenderTs = 0;

function renderHomeStatsCharts(forceRender = false) {
    const totalBadge = document.getElementById('homeStatsTotalBadge');
    const donutBox = document.getElementById('genderDonutChartBox');
    const ieDonutBox = document.getElementById('ieDonutChartBox');
    if (!totalBadge || !donutBox || !ieDonutBox) return;

    const nowTs = Date.now();
    const sysCfgForStats = (typeof Store !== 'undefined' && typeof Store.getSystemConfig === 'function')
        ? Store.getSystemConfig()
        : { maleDisplayOffset: 0 };
    const maleOffset = Math.max(0, Number(sysCfgForStats.maleDisplayOffset || 0));
    const rawUsersStr = localStorage.getItem(USERS_LOCAL_KEY) || '[]';
    const statsCacheSig = `${maleOffset}|${rawUsersStr}`;

    if (!forceRender && donutBox.dataset.rendered === '1') {
        if (statsCacheSig === lastUsersStatsSnapshot) {
            lastHomeStatsRenderTs = nowTs;
            return;
        }
        const prevOffsetPart = String(lastUsersStatsSnapshot || '').split('|')[0];
        if (prevOffsetPart === String(maleOffset) && (nowTs - lastHomeStatsRenderTs) < HOME_STATS_COOLDOWN_MS) {
            return;
        }
    }
    lastUsersStatsSnapshot = statsCacheSig;
    lastHomeStatsRenderTs = nowTs;
    donutBox.dataset.rendered = '1';

    const users = (typeof Store !== 'undefined' && typeof Store.getUsersArray === 'function')
        ? Store.getUsersArray()
        : (() => {
            try {
                const parsed = JSON.parse(rawUsersStr);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        })();

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

    // 前台顯示：男生人數依後台設定固定加成，女生人數固定加 5 人，且 (maleOffset + 5) 同步計入 MBTI 的 I 人
    maleCount += maleOffset;
    femaleCount += 5;
    iPersonCount += (maleOffset + 5);
    const displayTotalCount = totalCount + maleOffset + 5;

    const genderTotal = maleCount + femaleCount;
    const malePct = genderTotal > 0 ? Math.round((maleCount / genderTotal) * 100) : 0;
    const femalePct = genderTotal > 0 ? (100 - malePct) : 0;

    totalBadge.textContent = `總計 ${displayTotalCount} 人`;
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
            <span class="text-lg font-bold font-serif-jp text-[#8f4452] leading-tight">${displayTotalCount} 人</span>
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

// ==================== 複選場次與完全吻合條件（當前居住地區僅選北部、中部、南部、東部） ====================
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

    const schedCheck = getBatchScheduleInfo(getCurrentBatchNumber());
    const nowCheckTs = Date.now();
    const isTueClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(schedCheck.tueLabel, nowCheckTs);
    const isThuClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(schedCheck.thuLabel, nowCheckTs);
    const isSatClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(schedCheck.satLabel, nowCheckTs);
    if (isTueClosed && isThuClosed && isSatClosed) {
        showMiniNotice('⏳ 本屆場次已截止報名', `${schedCheck.batchPrefix}（${schedCheck.tueLabel}、${schedCheck.thuLabel}、${schedCheck.satLabel}）皆已過 20:00 截止時間，請靜待下一期開放報名！`);
        return;
    }

    openRegisterModal();
}

function getClosedRegisteredSessionsInCurrentBatch(nowTs = Date.now()) {
    const sched = getBatchScheduleInfo(getCurrentBatchNumber());
    const savedSessions = Array.isArray(appState.registeredSessions) ? appState.registeredSessions : [];
    const pid = String(appState.playerId || '').trim();
    const seen = new Set();
    const result = [];

    const tryAddClosedSession = (sessionLabel) => {
        const norm = normalizeSessionLabel(sessionLabel);
        if (!norm || seen.has(norm)) return;
        const inCurrentBatch = sched.sessions.some(target => isSameSession(norm, target));
        const isClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(norm, nowTs);
        if (inCurrentBatch && isClosed) {
            seen.add(norm);
            result.push(norm);
        }
    };

    // 1. 檢查尚未清理的 registeredSessions
    savedSessions.forEach(s => tryAddClosedSession(s));

    // 2. 檢查已過 20:03 被清理轉入 ActivityRegArchive 封存歷史的本屆已報名場次
    if (pid && typeof ActivityRegArchive !== 'undefined') {
        const archiveMap = (typeof ActivityRegArchive.getAllMap === 'function') ? ActivityRegArchive.getAllMap() : {};
        sched.sessions.forEach(targetSession => {
            const isClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(targetSession, nowTs);
            if (!isClosed) return;
            const regKey = (typeof ActivityRegArchive.makeRegularKey === 'function')
                ? ActivityRegArchive.makeRegularKey(targetSession, pid)
                : '';
            let wasArchived = Boolean(regKey && archiveMap && archiveMap[regKey]);
            if (!wasArchived && archiveMap && typeof archiveMap === 'object') {
                wasArchived = Object.values(archiveMap).some(rec =>
                    rec && rec.kind === 'regular' &&
                    String(rec.playerId || '').trim() === pid &&
                    rec.session && isSameSession(rec.session, targetSession)
                );
            }
            if (wasArchived) {
                tryAddClosedSession(targetSession);
            }
        });
    }

    // 3. 檢查本屆常規場次配對紀錄（matchedHistory / 場次結算快照），防止封存尚未寫入時漏計
    if (pid) {
        try {
            const users = (typeof Store !== 'undefined' && typeof Store.getUsersArray === 'function')
                ? Store.getUsersArray()
                : JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
            const me = Array.isArray(users) ? users.find(u => u && String(u.id).trim() === pid) : null;
            if (me && Array.isArray(me.matchedHistory)) {
                me.matchedHistory.forEach(h => {
                    if (!h || h.activityId || !h.session) return;
                    const isForce = Boolean(h.isForceRepaired || String(h.session).includes('強制') || String(h.matchDetail || '').includes('強制'));
                    if (!isForce) tryAddClosedSession(h.session);
                });
            }
        } catch (e) {}
    }

    return result;
}

function renderRegisterModalSessionOptions(nowTs = Date.now()) {
    const listEl = document.getElementById('sessionOptionsList');
    if (!listEl) return;

    const sched = getBatchScheduleInfo(getCurrentBatchNumber());
    const tueLabel = sched.tueLabel;
    const thuLabel = sched.thuLabel;
    const satLabel = sched.satLabel;
    const savedSessions = Array.isArray(appState.registeredSessions) ? appState.registeredSessions : [];
    const maxAllowed = (typeof getMaxRegularSessionsForUser === 'function') ? getMaxRegularSessionsForUser(appState) : Infinity;
    const isMaleLimited = Number.isFinite(maxAllowed);

    const step1LabelEl = listEl.previousElementSibling;
    if (step1LabelEl) {
        const extraCredits = (typeof getUserExtraMatchCredits === 'function') ? getUserExtraMatchCredits(appState) : 0;
        const hasExtraPrivilege = (typeof hasMaleExtraRegularSessionPrivilege === 'function') && hasMaleExtraRegularSessionPrivilege(appState);
        if (isMaleLimited && hasExtraPrivilege) {
            const creditTag = extraCredits > 0 ? `｜🎟️ 剩餘加場次數：${extraCredits} 次（報名第3場開獎即扣次）` : '';
            step1LabelEl.innerHTML = `1. 請選擇要參加的配對場次（選填，✨ 已解鎖最多可選 ${maxAllowed} 場${creditTag}）`;
        } else if (isMaleLimited) {
            step1LabelEl.innerHTML = `1. 請選擇要參加的配對場次（選填，最多可選 ${maxAllowed} 場）<br><span class="text-[11px] text-red-600 font-bold">（・🔒贊助 可增加1場選擇）</span>`;
        } else {
            step1LabelEl.innerHTML = '1. 請選擇要參加的配對場次（選填，可複選）';
        }
    }

    const closedUsedSessions = getClosedRegisteredSessionsInCurrentBatch(nowTs);
    let initialCheckedCount = closedUsedSessions.length;
    listEl.innerHTML = [tueLabel, thuLabel, satLabel].map(opt => {
        const isClosed = (typeof isRegularSessionRegistrationClosed === 'function')
            ? isRegularSessionRegistrationClosed(opt, nowTs)
            : false;
        const wasRegistered = savedSessions.some(s => isSameSession(s, opt)) || closedUsedSessions.some(s => isSameSession(s, opt));
        let checked = !isClosed && wasRegistered;
        if (checked && initialCheckedCount >= maxAllowed) {
            checked = false;
        }
        if (checked) initialCheckedCount++;

        if (isClosed) {
            const closedStatusText = wasRegistered
                ? '✅ 已報名並結束（計入本週已使用 1 場）'
                : '🚫 已截止報名（20:00 已過）';
            return `
                <label data-session-closed="1" ${wasRegistered ? 'data-closed-registered="1"' : ''} title="${wasRegistered ? '此場次已報名並結束，已計入本週場次額度' : '此場次已於當日 20:00 截止報名，無法再勾選'}" class="flex items-center gap-2.5 p-3 rounded-2xl border ${wasRegistered ? 'border-amber-200 bg-amber-50/60 text-gray-500' : 'border-gray-200 bg-gray-100/90 text-gray-400 opacity-80'} cursor-not-allowed select-none">
                    <input type="checkbox" name="regSessionCheck" value="${opt}" ${wasRegistered ? 'checked' : ''} disabled data-time-closed="1" class="w-4 h-4 accent-amber-500 cursor-not-allowed">
                    <div class="min-w-0">
                        <div class="font-bold text-xs ${wasRegistered ? 'text-gray-600' : 'text-gray-400 line-through'}">${opt}</div>
                        <div class="text-[10px] ${wasRegistered ? 'text-amber-700' : 'text-rose-500'} font-bold mt-0.5">${closedStatusText}</div>
                    </div>
                </label>
            `;
        }

        return `
            <label data-session-card="1" class="flex items-center gap-2.5 p-3 rounded-2xl border border-pink-200 bg-pink-50/40 cursor-pointer hover:bg-pink-50 transition">
                <input type="checkbox" name="regSessionCheck" value="${opt}" ${checked ? 'checked' : ''} onchange="onRegSessionCheckChange()" class="accent-[#c96a7b] w-4 h-4">
                <div class="min-w-0">
                    <div data-session-title="1" class="font-bold text-xs text-[#8f4452]">${opt}</div>
                    <div data-session-sub="1" class="text-[10px] text-emerald-700 font-semibold mt-0.5">🟢 開放報名中（當日 20:00 截止）</div>
                </div>
            </label>
        `;
    }).join('');

    onRegSessionCheckChange();
    const activeSavedOpenSessions = savedSessions.filter(s =>
        !(typeof isRegularSessionRegistrationClosed === 'function' && isRegularSessionRegistrationClosed(s, nowTs))
    );
    const cancelRegBtn = document.getElementById('cancelRegularRegBtn');
    if (cancelRegBtn) {
        cancelRegBtn.classList.toggle('hidden', activeSavedOpenSessions.length === 0);
    }
}

function openRegisterModal() {
    if (!Store.getSystemConfig().registrationOpen) {
        showMiniNotice('🚫 人數已滿 不可報名', '本屆報名名額已滿，目前暫不開放報名。');
        return;
    }

    const sched = getBatchScheduleInfo(getCurrentBatchNumber());
    const nowTs = Date.now();
    const isTueClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(sched.tueLabel, nowTs);
    const isThuClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(sched.thuLabel, nowTs);
    const isSatClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(sched.satLabel, nowTs);
    if (isTueClosed && isThuClosed && isSatClosed) {
        closeRegisterModal();
        showMiniNotice('⏳ 本屆場次已截止報名', `${sched.batchPrefix}（${sched.tueLabel}、${sched.thuLabel}、${sched.satLabel}）皆已過 20:00 截止時間，請靜待下一期開放報名！`);
        return;
    }

    renderRegisterModalSessionOptions(nowTs);

    const savedCriteria = appState.exactMatchCriteria || {};
    const savedMustKeys = Array.isArray(appState.mustMatchKeys) ? appState.mustMatchKeys : [];
    renderDualCriteriaOptionsList('regular', savedCriteria, savedMustKeys);

    document.getElementById('registerModal').classList.remove('hidden');
}

const MAX_MUST_MATCH_COUNT = 2;

function getCriteriaDomPrefix(scope) {
    return scope === 'custom'
        ? {
            listId: 'customActExactOptionsList',
            summaryId: 'customActCriteriaSummaryBar',
            checkName: 'customActExactCheck',
            selectPrefix: 'custom-exact-select-',
            mustInputPrefix: 'custom-must-flag-',
            cardPrefix: 'custom-crit-card-'
        }
        : {
            listId: 'exactMatchOptionsList',
            summaryId: 'regMatchCriteriaSummaryBar',
            checkName: 'exactFieldCheck',
            selectPrefix: 'exact-select-',
            mustInputPrefix: 'reg-must-flag-',
            cardPrefix: 'reg-crit-card-'
        };
}

function renderDualCriteriaOptionsList(scope, savedCriteria = {}, savedMustKeys = []) {
    const cfg = getCriteriaDomPrefix(scope);
    const listEl = document.getElementById(cfg.listId);
    if (!listEl) return;

    const validMustSet = new Set(
        (Array.isArray(savedMustKeys) ? savedMustKeys : [])
            .map(String)
            .filter(k => Object.prototype.hasOwnProperty.call(savedCriteria, k))
            .slice(0, MAX_MUST_MATCH_COUNT)
    );

    listEl.innerHTML = EXACT_MATCH_OPTIONS.map(item => {
        const isChecked = Object.prototype.hasOwnProperty.call(savedCriteria, item.key);
        const modeVal = isChecked ? (validMustSet.has(item.key) ? '1' : '0') : '';
        const isMust = modeVal === '1';
        const isOr = modeVal === '0';
        const isPetTwoStep = item.type === 'petTwoStep';
        const spanClass = isPetTwoStep ? 'sm:col-span-2 ' : '';

        let selectorHtml = '';
        if (isPetTwoStep) {
            const hasSavedPet = isChecked && Boolean(savedCriteria[item.key]);
            const parsedPet = hasSavedPet
                ? ((typeof parsePetCriterionValue === 'function')
                    ? parsePetCriterionValue(savedCriteria[item.key])
                    : { status: '有養寵物', petType: '不限' })
                : { status: '', petType: '' };
            const isUnsetPet = parsedPet.status === '';
            const isNoPetCrit = parsedPet.status === '沒有養寵物';
            const petOptionsList = typeof PET_TYPE_OPTIONS !== 'undefined'
                ? PET_TYPE_OPTIONS
                : ['狗', '貓', '貓狗都有', '兔子', '倉鼠 / 鼠類', '鳥類', '爬蟲類 / 兩棲', '水族 / 魚蝦', '其他寵物'];
            selectorHtml = `
                <div id="${cfg.cardPrefix}pet_wrap_${item.key}" class="${isChecked ? 'grid grid-cols-1 sm:grid-cols-2 gap-1.5' : 'hidden'}">
                    <select id="${cfg.selectPrefix}${item.key}_status" onchange="onDualCriterionPetStatusChange('${scope}', '${item.key}')" class="input-jp !py-1 !text-xs">
                        <option value="" ${isUnsetPet ? 'selected' : ''}>請選擇...</option>
                        <option value="有養寵物" ${parsedPet.status === '有養寵物' ? 'selected' : ''}>有養寵物</option>
                        <option value="沒有養寵物" ${isNoPetCrit ? 'selected' : ''}>沒有養寵物</option>
                    </select>
                    <select id="${cfg.selectPrefix}${item.key}_type" ${(isUnsetPet || isNoPetCrit) ? 'disabled' : ''} class="input-jp !py-1 !text-xs">
                        ${isUnsetPet
                            ? '<option value="" selected>請先選擇左側...</option>'
                            : (isNoPetCrit
                                ? '<option value="沒有養寵物" selected>沒有養寵物</option>'
                                : `
                                    <option value="" ${parsedPet.petType === '' ? 'selected' : ''}>請選擇寵物類型...</option>
                                    <option value="不限" ${parsedPet.petType === '不限' ? 'selected' : ''}>不限（有養任何寵物皆可）</option>
                                    ${petOptionsList.map(pt => `<option value="${pt}" ${parsedPet.petType === pt ? 'selected' : ''}>${pt}</option>`).join('')}
                                `)
                        }
                    </select>
                </div>
            `;
        } else {
            const hasSavedVal = isChecked && Boolean(savedCriteria[item.key]);
            const selectedVal = hasSavedVal ? String(savedCriteria[item.key]) : '';
            selectorHtml = `
                <select id="${cfg.selectPrefix}${item.key}" class="input-jp !py-1 !text-xs ${isChecked ? '' : 'hidden'}">
                    <option value="" ${selectedVal === '' ? 'selected' : ''}>請選擇...</option>
                    ${item.choices.map(c => `<option value="${c}" ${selectedVal === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            `;
        }

        return `
            <div id="${cfg.cardPrefix}${item.key}" class="${spanClass}p-2.5 rounded-xl border transition space-y-1.5 ${isChecked ? (isMust ? 'border-[#c96a7b] bg-rose-50/55 shadow-2xs' : (isOr ? 'border-pink-200 bg-pink-50/20' : 'border-amber-300 bg-amber-50/30')) : 'border-pink-100 bg-white'}">
                <div class="flex items-center justify-between gap-1.5">
                    <label class="flex items-center gap-2 text-xs font-semibold text-[#5e464a] cursor-pointer min-w-0">
                        <input type="checkbox" name="${cfg.checkName}" value="${item.key}" ${isChecked ? 'checked' : ''} onchange="onDualCriterionCheckChange('${scope}', '${item.key}')" class="accent-[#c96a7b] shrink-0">
                        <span class="truncate">${item.label}</span>
                    </label>
                    <input type="hidden" id="${cfg.mustInputPrefix}${item.key}" value="${modeVal}">
                </div>
                ${selectorHtml}
                <div id="${cfg.cardPrefix}mode_${item.key}" class="${isChecked ? 'grid grid-cols-2 gap-1 pt-0.5' : 'hidden'}">
                    <div data-role="mode-hint" class="${modeVal === '' ? 'col-span-2 text-[10px] text-rose-500 font-semibold' : 'hidden'}">請選擇條件類型：</div>
                    <button type="button" data-role="must-btn" onclick="setDualCriterionMode('${scope}', '${item.key}', true)"
                        class="py-1 px-1.5 rounded-lg text-[11px] font-bold border transition text-center ${isMust ? 'bg-gradient-to-r from-[#e79aa8] to-[#c96a7b] text-white border-[#c96a7b] shadow-2xs' : 'bg-white border-pink-200 text-[#8f4452] hover:bg-rose-50'}">
                        🔒 必須吻合
                    </button>
                    <button type="button" data-role="or-btn" onclick="setDualCriterionMode('${scope}', '${item.key}', false)"
                        class="py-1 px-1.5 rounded-lg text-[11px] font-bold border transition text-center ${isOr ? 'bg-pink-100 text-[#8f4452] border-pink-300' : 'bg-white border-pink-200 text-[#8f4452] hover:bg-pink-50'}">
                        ✨ 任一符合
                    </button>
                </div>
            </div>
        `;
    }).join('');

    syncDualCriteriaUIState(scope);
}

function syncDualCriteriaUIState(scope) {
    const cfg = getCriteriaDomPrefix(scope);
    const checkedBoxes = Array.from(document.querySelectorAll(`input[name="${cfg.checkName}"]:checked`));
    let mustCount = 0;
    let orCount = 0;

    checkedBoxes.forEach(cb => {
        const key = cb.value;
        const flagEl = document.getElementById(`${cfg.mustInputPrefix}${key}`);
        const val = flagEl ? flagEl.value : '';
        if (val === '1') {
            if (mustCount < MAX_MUST_MATCH_COUNT) {
                mustCount++;
            } else if (orCount < MAX_MUST_MATCH_COUNT) {
                flagEl.value = '0';
                orCount++;
            } else {
                flagEl.value = '';
            }
        } else if (val === '0') {
            if (orCount < MAX_MUST_MATCH_COUNT) {
                orCount++;
            } else {
                flagEl.value = '';
            }
        }
    });

    const isMustFull = mustCount >= MAX_MUST_MATCH_COUNT;
    const isOrFull = orCount >= MAX_MUST_MATCH_COUNT;

    EXACT_MATCH_OPTIONS.forEach(item => {
        const key = item.key;
        const isPetTwoStep = item.type === 'petTwoStep';
        const spanClass = isPetTwoStep ? 'sm:col-span-2 ' : '';
        const cb = document.querySelector(`input[name="${cfg.checkName}"][value="${key}"]`);
        const sel = isPetTwoStep
            ? document.getElementById(`${cfg.cardPrefix}pet_wrap_${key}`)
            : document.getElementById(`${cfg.selectPrefix}${key}`);
        const flagEl = document.getElementById(`${cfg.mustInputPrefix}${key}`);
        const cardEl = document.getElementById(`${cfg.cardPrefix}${key}`);
        const modeBox = document.getElementById(`${cfg.cardPrefix}mode_${key}`);
        if (!cb || !sel || !flagEl || !cardEl || !modeBox) return;

        const isChecked = cb.checked;
        if (!isChecked) {
            flagEl.value = '';
            if (isPetTwoStep) {
                sel.className = 'hidden';
            } else {
                sel.classList.add('hidden');
            }
            modeBox.className = 'hidden';
            cardEl.className = `${spanClass}p-2.5 rounded-xl border transition space-y-1.5 border-pink-100 bg-white`;
            return;
        }

        const modeVal = flagEl.value;
        const isMust = modeVal === '1';
        const isOr = modeVal === '0';
        if (isPetTwoStep) {
            sel.className = 'grid grid-cols-1 sm:grid-cols-2 gap-1.5';
        } else {
            sel.classList.remove('hidden');
        }
        modeBox.className = 'grid grid-cols-2 gap-1 pt-0.5';
        cardEl.className = isMust
            ? `${spanClass}p-2.5 rounded-xl border transition space-y-1.5 border-[#c96a7b] bg-rose-50/55 shadow-2xs`
            : (isOr
                ? `${spanClass}p-2.5 rounded-xl border transition space-y-1.5 border-pink-200 bg-pink-50/20`
                : `${spanClass}p-2.5 rounded-xl border transition space-y-1.5 border-amber-300 bg-amber-50/30`);

        const modeHint = modeBox.querySelector('[data-role="mode-hint"]');
        if (modeHint) {
            modeHint.className = modeVal === ''
                ? 'col-span-2 text-[10px] text-rose-500 font-semibold'
                : 'hidden';
        }

        const mustBtn = modeBox.querySelector('[data-role="must-btn"]');
        const orBtn = modeBox.querySelector('[data-role="or-btn"]');
        if (mustBtn) {
            if (isMust) {
                mustBtn.disabled = false;
                mustBtn.className = 'py-1 px-1.5 rounded-lg text-[11px] font-bold border transition text-center bg-gradient-to-r from-[#e79aa8] to-[#c96a7b] text-white border-[#c96a7b] shadow-2xs';
            } else if (isMustFull) {
                mustBtn.disabled = true;
                mustBtn.className = 'py-1 px-1.5 rounded-lg text-[11px] font-bold border transition text-center bg-gray-100 border-gray-200 text-gray-400 opacity-55 cursor-not-allowed';
            } else {
                mustBtn.disabled = false;
                mustBtn.className = 'py-1 px-1.5 rounded-lg text-[11px] font-bold border transition text-center bg-white border-pink-200 text-[#8f4452] hover:bg-rose-50';
            }
        }
        if (orBtn) {
            if (isOr) {
                orBtn.disabled = false;
                orBtn.className = 'py-1 px-1.5 rounded-lg text-[11px] font-bold border transition text-center bg-pink-100 text-[#8f4452] border-pink-300';
            } else if (isOrFull) {
                orBtn.disabled = true;
                orBtn.className = 'py-1 px-1.5 rounded-lg text-[11px] font-bold border transition text-center bg-gray-100 border-gray-200 text-gray-400 opacity-55 cursor-not-allowed';
            } else {
                orBtn.disabled = false;
                orBtn.className = 'py-1 px-1.5 rounded-lg text-[11px] font-bold border transition text-center bg-white border-pink-200 text-[#8f4452] hover:bg-pink-50';
            }
        }
    });

    const summaryEl = document.getElementById(cfg.summaryId);
    if (summaryEl) {
        summaryEl.innerHTML = `
            <span class="px-2.5 py-0.5 rounded-full font-bold ${mustCount > 0 ? 'bg-rose-100 border border-rose-300 text-[#8f4452]' : 'bg-gray-100 text-gray-500'}">
                🔒 必須吻合：${mustCount} / ${MAX_MUST_MATCH_COUNT} 項
            </span>
            <span class="px-2.5 py-0.5 rounded-full font-bold ${orCount > 0 ? 'bg-pink-100 border border-pink-300 text-[#c96a7b]' : 'bg-gray-100 text-gray-500'}">
                ✨ 選填：${orCount} / ${MAX_MUST_MATCH_COUNT} 項
            </span>
        `;
    }
}

window.onDualCriterionCheckChange = function(scope, key) {
    const cfg = getCriteriaDomPrefix(scope);
    const cb = document.querySelector(`input[name="${cfg.checkName}"][value="${key}"]`);
    const flagEl = document.getElementById(`${cfg.mustInputPrefix}${key}`);

    if (cb && cb.checked) {
        const otherChecked = Array.from(document.querySelectorAll(`input[name="${cfg.checkName}"]:checked`))
            .map(el => el.value)
            .filter(k => k !== key);
        const otherMustCount = otherChecked.filter(k => document.getElementById(`${cfg.mustInputPrefix}${k}`)?.value === '1').length;
        const otherOrCount = otherChecked.filter(k => document.getElementById(`${cfg.mustInputPrefix}${k}`)?.value === '0').length;
        if (otherMustCount >= MAX_MUST_MATCH_COUNT && otherOrCount >= MAX_MUST_MATCH_COUNT) {
            cb.checked = false;
            if (flagEl) flagEl.value = '';
            showMiniNotice('⚠️ 配對條件已達上限', '「🔒 必須吻合」與「✨ 任一符合」皆已達上限（各最多 2 項），請先取消其他勾選項目後再設定！');
            return;
        }
        if (flagEl) flagEl.value = '';
    }

    if (cb && !cb.checked) {
        if (flagEl) flagEl.value = '';
        const optMeta = EXACT_MATCH_OPTIONS.find(o => o.key === key);
        if (optMeta && optMeta.type === 'petTwoStep') {
            const statusSel = document.getElementById(`${cfg.selectPrefix}${key}_status`);
            const typeSel = document.getElementById(`${cfg.selectPrefix}${key}_type`);
            if (statusSel) statusSel.value = '';
            if (typeSel) {
                typeSel.disabled = true;
                typeSel.innerHTML = '<option value="" selected>請先選擇左側...</option>';
            }
        } else {
            const sel = document.getElementById(`${cfg.selectPrefix}${key}`);
            if (sel) sel.value = '';
        }
    }
    syncDualCriteriaUIState(scope);
};

window.setDualCriterionMode = function(scope, key, makeMust) {
    const cfg = getCriteriaDomPrefix(scope);
    const cb = document.querySelector(`input[name="${cfg.checkName}"][value="${key}"]`);
    const flagEl = document.getElementById(`${cfg.mustInputPrefix}${key}`);
    if (!cb || !flagEl) return;
    if (!cb.checked) cb.checked = true;

    if (makeMust) {
        const currentMustKeys = Array.from(document.querySelectorAll(`input[name="${cfg.checkName}"]:checked`))
            .map(el => el.value)
            .filter(k => k !== key && document.getElementById(`${cfg.mustInputPrefix}${k}`)?.value === '1');
        if (currentMustKeys.length >= MAX_MUST_MATCH_COUNT) {
            showMiniNotice('🔒 必須吻合已達上限（2 項）', '「必須吻合」條件最多只能選擇 2 項喔！請先將其中一項切換為「✨ 任一符合」或取消勾選後再設定。');
            return;
        }
        flagEl.value = '1';
    } else {
        const currentOrKeys = Array.from(document.querySelectorAll(`input[name="${cfg.checkName}"]:checked`))
            .map(el => el.value)
            .filter(k => k !== key && document.getElementById(`${cfg.mustInputPrefix}${k}`)?.value === '0');
        if (currentOrKeys.length >= MAX_MUST_MATCH_COUNT) {
            showMiniNotice('✨ 選填條件已達上限（2 項）', '「✨ 任一符合」條件最多只能選擇 2 項喔！請先將其中一項切換為「🔒 必須吻合」或取消勾選後再設定。');
            return;
        }
        flagEl.value = '0';
    }
    syncDualCriteriaUIState(scope);
};

window.onDualCriterionPetStatusChange = function(scope, key) {
    const cfg = getCriteriaDomPrefix(scope);
    const statusSel = document.getElementById(`${cfg.selectPrefix}${key}_status`);
    const typeSel = document.getElementById(`${cfg.selectPrefix}${key}_type`);
    if (!statusSel || !typeSel) return;

    if (!statusSel.value) {
        typeSel.disabled = true;
        typeSel.innerHTML = '<option value="" selected>請先選擇左側...</option>';
    } else if (statusSel.value === '沒有養寵物') {
        typeSel.disabled = true;
        typeSel.innerHTML = '<option value="沒有養寵物" selected>沒有養寵物</option>';
    } else {
        const petOptionsList = typeof PET_TYPE_OPTIONS !== 'undefined'
            ? PET_TYPE_OPTIONS
            : ['狗', '貓', '貓狗都有', '兔子', '倉鼠 / 鼠類', '鳥類', '爬蟲類 / 兩棲', '水族 / 魚蝦', '其他寵物'];
        typeSel.disabled = false;
        typeSel.innerHTML = '<option value="" selected>請選擇寵物類型...</option>' +
            '<option value="不限">不限（有養任何寵物皆可）</option>' +
            petOptionsList.map(pt => `<option value="${pt}">${pt}</option>`).join('');
    }
};

function collectDualCriteriaFromDom(scope) {
    const cfg = getCriteriaDomPrefix(scope);
    const criteria = {};
    const mustMatchKeys = [];
    const incompleteLabels = [];
    document.querySelectorAll(`input[name="${cfg.checkName}"]:checked`).forEach(cb => {
        const key = cb.value;
        const optMeta = EXACT_MATCH_OPTIONS.find(o => o.key === key);
        const optLabel = optMeta ? optMeta.label : key;
        const flagEl = document.getElementById(`${cfg.mustInputPrefix}${key}`);

        const modeVal = flagEl ? flagEl.value : '';
        const hasChosenMode = (modeVal === '1' || modeVal === '0');

        if (optMeta && optMeta.type === 'petTwoStep') {
            const statusSel = document.getElementById(`${cfg.selectPrefix}${key}_status`);
            const typeSel = document.getElementById(`${cfg.selectPrefix}${key}_type`);
            if (!statusSel || !statusSel.value) {
                incompleteLabels.push(hasChosenMode ? optLabel : `${optLabel}（選項與條件類型）`);
                return;
            }
            if (statusSel.value === '沒有養寵物') {
                if (!hasChosenMode) {
                    incompleteLabels.push(`${optLabel}（請選「必須吻合」或「任一符合」）`);
                    return;
                }
                criteria[key] = '沒有養寵物';
            } else {
                const chosenType = (typeSel && !typeSel.disabled) ? String(typeSel.value || '').trim() : '';
                if (!chosenType) {
                    incompleteLabels.push(hasChosenMode ? `${optLabel}（寵物類型）` : `${optLabel}（寵物類型與條件類型）`);
                    return;
                }
                if (!hasChosenMode) {
                    incompleteLabels.push(`${optLabel}（請選「必須吻合」或「任一符合」）`);
                    return;
                }
                criteria[key] = `有養寵物（${chosenType}）`;
            }
            if (modeVal === '1' && mustMatchKeys.length < MAX_MUST_MATCH_COUNT) {
                mustMatchKeys.push(key);
            }
            return;
        }

        const sel = document.getElementById(`${cfg.selectPrefix}${key}`);
        if (!sel || !sel.value) {
            incompleteLabels.push(hasChosenMode ? optLabel : `${optLabel}（選項與條件類型）`);
            return;
        }
        if (!hasChosenMode) {
            incompleteLabels.push(`${optLabel}（請選「必須吻合」或「任一符合」）`);
            return;
        }
        criteria[key] = sel.value;
        if (modeVal === '1' && mustMatchKeys.length < MAX_MUST_MATCH_COUNT) {
            mustMatchKeys.push(key);
        }
    });
    return { criteria, mustMatchKeys, incompleteLabels };
}

window.onRegSessionCheckChange = function() {
    const rawMax = (typeof getMaxRegularSessionsForUser === 'function') ? getMaxRegularSessionsForUser(appState) : Infinity;
    const maxAllowed = (typeof rawMax === 'number' && rawMax >= 0) ? rawMax : Infinity;
    const isMaleLimited = Number.isFinite(maxAllowed);
    const closedUsedCount = getClosedRegisteredSessionsInCurrentBatch(Date.now()).length;
    const openCheckboxes = Array.from(document.querySelectorAll('input[name="regSessionCheck"]:not([data-time-closed="1"])'));
    let openCheckedCount = 0;
    openCheckboxes.forEach(cb => {
        if (cb.checked) {
            if ((closedUsedCount + openCheckedCount) >= maxAllowed) {
                cb.checked = false;
            } else {
                openCheckedCount++;
            }
        }
    });

    const totalUsedCount = closedUsedCount + openCheckedCount;
    const reachedLimit = isMaleLimited && totalUsedCount >= maxAllowed;
    openCheckboxes.forEach(cb => {
        const shouldDisable = reachedLimit && !cb.checked;
        cb.disabled = shouldDisable;
        const cardEl = cb.closest('label[data-session-card="1"]');
        if (!cardEl) return;
        const titleEl = cardEl.querySelector('[data-session-title="1"]');
        const subEl = cardEl.querySelector('[data-session-sub="1"]');
        if (shouldDisable) {
            cardEl.title = `每屆最多只能選 ${maxAllowed} 個場次`;
            cardEl.className = 'flex items-center gap-2.5 p-3 rounded-2xl border border-gray-200 bg-gray-100/90 text-gray-400 opacity-75 cursor-not-allowed select-none transition';
            cb.className = 'w-4 h-4 accent-gray-400 cursor-not-allowed';
            if (titleEl) titleEl.className = 'font-bold text-xs text-gray-400';
            if (subEl) {
                subEl.className = 'text-[10px] text-amber-700 font-semibold mt-0.5';
                subEl.textContent = `🔒 最多選 ${maxAllowed} 場（取消其他場次可改選）`;
            }
        } else {
            cardEl.removeAttribute('title');
            cardEl.className = 'flex items-center gap-2.5 p-3 rounded-2xl border border-pink-200 bg-pink-50/40 cursor-pointer hover:bg-pink-50 transition';
            cb.className = 'accent-[#c96a7b] w-4 h-4';
            if (titleEl) titleEl.className = 'font-bold text-xs text-[#8f4452]';
            if (subEl) {
                subEl.className = 'text-[10px] text-emerald-700 font-semibold mt-0.5';
                subEl.textContent = '🟢 開放報名中（當日 20:00 截止）';
            }
        }
    });

    const listEl = document.getElementById('sessionOptionsList');
    if (listEl) {
        let quotaBannerEl = document.getElementById('regSessionQuotaStatusBanner');
        if (!quotaBannerEl) {
            quotaBannerEl = document.createElement('div');
            quotaBannerEl.id = 'regSessionQuotaStatusBanner';
            listEl.parentNode.insertBefore(quotaBannerEl, listEl);
        }
        if (isMaleLimited) {
            const isFull = totalUsedCount >= maxAllowed;
            quotaBannerEl.className = `px-3 py-2 rounded-xl border text-xs font-bold ${isFull ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-pink-50/70 border-pink-200 text-[#8f4452]'}`;
            quotaBannerEl.textContent = isFull
                ? `本週配對場次額度已用完（已使用 ${totalUsedCount} / ${maxAllowed} 場）`
                : `本週配對場次額度（已使用 ${totalUsedCount} / ${maxAllowed} 場）`;
            quotaBannerEl.classList.remove('hidden');
        } else {
            quotaBannerEl.classList.add('hidden');
        }
    }

    const checkedSessions = openCheckboxes.filter(cb => cb.checked).map(cb => cb.value);
    const submitBtn = document.querySelector('#registerModal button[onclick="confirmRegistration()"]');
    if (submitBtn) {
        if (checkedSessions.length === 0 && closedUsedCount === 0) {
            submitBtn.textContent = '💾 保存設定（取消場次報名）';
        } else if (checkedSessions.length === 0 && closedUsedCount > 0) {
            submitBtn.textContent = isMaleLimited
                ? `💾 保存設定（已使用 ${totalUsedCount} / ${maxAllowed} 場）`
                : '💾 保存設定（取消未結束場次）';
        } else if (isMaleLimited) {
            submitBtn.textContent = `✨ 確認送出報名（已使用 ${totalUsedCount} / ${maxAllowed} 場）`;
        } else {
            submitBtn.textContent = `✨ 確認送出報名（已選 ${checkedSessions.length} 場）`;
        }
    }
};

window.toggleExactSelect = function(key) {
    onDualCriterionCheckChange('regular', key);
};

function closeRegisterModal() {
    document.getElementById('registerModal').classList.add('hidden');
}

function formatSingleCriterionLabel(k, criteria) {
    if (k === 'region') {
        return `當前居住地區：${criteria.region}`;
    }
    const label = EXACT_MATCH_OPTIONS.find(o => o.key === k)?.label || k;
    return `${label}：${criteria[k]}`;
}

function formatCriteriaDisplayList(criteria, mustMatchKeys = []) {
    const keys = Object.keys(criteria || {}).filter(k => k !== 'city');
    if (keys.length === 0) return [];
    const mustSet = new Set(
        (Array.isArray(mustMatchKeys) ? mustMatchKeys : [])
            .map(String)
            .filter(k => keys.includes(k))
            .slice(0, MAX_MUST_MATCH_COUNT)
    );
    const mustLabels = keys.filter(k => mustSet.has(k)).map(k => formatSingleCriterionLabel(k, criteria));
    const orLabels = keys.filter(k => !mustSet.has(k)).map(k => formatSingleCriterionLabel(k, criteria));

    const parts = [];
    if (mustLabels.length > 0) {
        parts.push(`🔒 必須吻合：${mustLabels.join(' 且 ')}`);
    }
    if (orLabels.length > 0) {
        parts.push(`✨ 任一符合：${orLabels.join(' 或 ')}`);
    }
    return parts;
}

function formatCriteriaSummaryText(criteria, mustMatchKeys = []) {
    const parts = formatCriteriaDisplayList(criteria, mustMatchKeys);
    return parts.length > 0 ? parts.join(' ＋ ') : '不限制（隨機配對）';
}

async function cancelRegularRegistration() {
    const nowTs = Date.now();
    const prevCancelledSessions = Array.isArray(appState.registeredSessions) ? [...appState.registeredSessions] : [];
    const preservedClosedSessions = getClosedRegisteredSessionsInCurrentBatch(nowTs);
    document.querySelectorAll('input[name="regSessionCheck"]:not([data-time-closed="1"])').forEach(cb => {
        cb.checked = false;
    });
    delete appState.registeredSession;
    appState.registeredSessions = preservedClosedSessions;
    if (preservedClosedSessions.length === 0) {
        appState.exactMatchCriteria = {};
        appState.mustMatchKeys = [];
    }
    if (appState.playerId && typeof ActivityRegArchive !== 'undefined') {
        prevCancelledSessions.forEach(s => {
            const wasAlreadyClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(s, nowTs);
            if (!wasAlreadyClosed) {
                ActivityRegArchive.removeRegular(s, appState.playerId);
            }
        });
    }

    closeRegisterModal();
    refreshAllUI();
    await Store.save(appState, true);
    refreshAllUI();

    showMiniNotice(
        '🌸 已取消場次報名 暫不進入配對池',
        '前後台名單已同步更新為未報名，之後隨時可再點選場次報名。'
    );
}

async function confirmRegistration() {
    if (!Store.getSystemConfig().registrationOpen) {
        closeRegisterModal();
        showMiniNotice('🚫 人數已滿 不可報名', '本屆報名名額已滿，目前暫不開放報名。');
        return;
    }

    const nowSubmitTs = Date.now();
    const rawCheckedSessions = Array.from(document.querySelectorAll('input[name="regSessionCheck"]:not(:disabled):checked')).map(cb => cb.value);
    const blockedClosedSessions = rawCheckedSessions.filter(s =>
        (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(s, nowSubmitTs)
    );
    const selectedSessions = rawCheckedSessions.filter(s =>
        !(typeof isRegularSessionRegistrationClosed === 'function' && isRegularSessionRegistrationClosed(s, nowSubmitTs))
    );
    const preservedClosedSessions = getClosedRegisteredSessionsInCurrentBatch(nowSubmitTs);
    const combinedSessions = Array.from(new Set([...preservedClosedSessions, ...selectedSessions]));
    const maxAllowedSessions = (typeof getMaxRegularSessionsForUser === 'function') ? getMaxRegularSessionsForUser(appState) : Infinity;
    if (combinedSessions.length > maxAllowedSessions) {
        renderRegisterModalSessionOptions(nowSubmitTs);
        showMiniNotice(`🚫 最多只能選 ${maxAllowedSessions} 場`, `本屆已使用 ${preservedClosedSessions.length} 場，最多只能再勾選 ${Math.max(0, maxAllowedSessions - preservedClosedSessions.length)} 個配對場次！`);
        return;
    }
    if (blockedClosedSessions.length > 0 && selectedSessions.length === 0) {
        renderRegisterModalSessionOptions(nowSubmitTs);
        showMiniNotice('🚫 該場次已截止報名', `【${blockedClosedSessions.join('、')}】已超過 20:00 報名截止時間，請改選其他尚未截止的場次！`);
        return;
    }

    const { criteria, mustMatchKeys, incompleteLabels } = collectDualCriteriaFromDom('regular');
    if (selectedSessions.length > 0 && incompleteLabels.length > 0) {
        showMiniNotice(
            '⚠️ 請完成配對條件設定',
            `您已勾選「${incompleteLabels.join('、')}」，請先選擇具體選項及條件類型（🔒 必須吻合 或 ✨ 任一符合），或取消勾選該欄位後再送出報名喔！`
        );
        return;
    }

    const prevRegisteredList = Array.isArray(appState.registeredSessions) ? [...appState.registeredSessions] : [];
    const finalCriteria = combinedSessions.length === 0 ? {} : criteria;
    const finalMustKeys = combinedSessions.length === 0 ? [] : mustMatchKeys;
    delete appState.registeredSession;
    appState.registeredSessions = combinedSessions;
    appState.exactMatchCriteria = finalCriteria;
    appState.mustMatchKeys = finalMustKeys;
    if (appState.playerId && typeof ActivityRegArchive !== 'undefined') {
        prevRegisteredList.forEach(oldS => {
            const wasAlreadyClosed = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(oldS, nowSubmitTs);
            const stillSelected = selectedSessions.some(ns => isSameSession(ns, oldS));
            if (!stillSelected && !wasAlreadyClosed) {
                ActivityRegArchive.removeRegular(oldS, appState.playerId);
            }
        });
    }

    closeRegisterModal();
    refreshAllUI();
    await Store.save(appState, true);
    refreshAllUI();

    const displayItems = formatCriteriaDisplayList(finalCriteria, finalMustKeys);
    const desc = displayItems.length > 0
        ? '已指定配對條件：\n' + displayItems.map(item => `・${item}`).join('\n')
        : '未勾選額外條件（不限制，將進行隨機配對）';

    if (selectedSessions.length === 0) {
        showMiniNotice(
            '🌸 已取消場次報名 暫不進入配對池',
            '前後台名單已同步更新為未報名，之後隨時可再點選場次報名。'
        );
        return;
    }

    showMiniNotice('🌸 報名成功', `已登錄場次：【${selectedSessions.join('、')}】\n\n${desc}`);
}

// ==================== 第 2 種活動：後台創建專屬活動（獨立報名與條件設定） ====================
function handleCustomActivityClick(activityId) {
    const act = Store.getOpenCustomActivities().find(a => String(a.id) === String(activityId));
    if (!act) {
        refreshAllUI();
        showMiniNotice('🌸 活動已關閉', '此專屬活動目前已關閉或結束報名。');
        return;
    }

    const schedState = getCustomActivityScheduleState(act);
    if (schedState.status === 'upcoming') {
        showMiniNotice('⏳ 活動尚未開始', `【${act.name}】將於 ${formatShortDateTime(schedState.startTs)} 開放報名，請稍候再來！`);
        return;
    }
    if (schedState.status === 'waiting_match') {
        const matchHint = schedState.matchText ? `將於 ${schedState.matchText} 準時進行配對` : '請等待管理員進行配對';
        showMiniNotice('⌛ 報名已截止', `【${act.name}】已於 ${formatShortDateTime(schedState.endTs)} 截止報名，${matchHint}！`);
        return;
    }
    if (schedState.status === 'matched') {
        const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
        const me = appState.playerId ? users.find(u => String(u.id) === String(appState.playerId)) : null;
        const matchedHist = (me && Array.isArray(me.matchedHistory))
            ? me.matchedHistory.find(h => String(h.activityId || '') === String(act.id) || String(h.session || '') === String(act.name))
            : null;
        if (matchedHist) {
            switchTab('friends');
            showMiniNotice('💘 配對成功', `恭喜你在【${act.name}】與「${matchedHist.partnerName}」配對成功，已加入好友名單！`);
        } else {
            showMiniNotice('🍃 已完成開獎配對', `【${act.name}】已於 ${schedState.matchText || '配對時間'} 完成配對結算（只有配對成功的玩家才會加入好友名單）。`);
        }
        return;
    }

    if (appState.isWarnedAccount) {
        showMiniNotice('⚠️ 無法報名', '目前警告帳號 不提供配對');
        return;
    }

    if (!isProfileComplete() || !appState.playerId) {
        switchTab('profile');
        showMiniNotice('📝 請先完成個人資料', `請先填寫必填個人資料並按「保存」產生玩家 ID 後，即可報名【${act.name}】！`);
        return;
    }

    openCustomActivityModal(activityId);
}

function renderCustomFortuneButtons(selectedNum, isLocked = false) {
    const grid = document.getElementById('customActFortuneGrid');
    if (!grid) return;
    const sel = String(selectedNum || '');
    grid.innerHTML = Array.from({ length: 5 }, (_, idx) => {
        const num = String(idx + 1);
        const isSelected = sel === num;

        if (isLocked) {
            if (isSelected) {
                return `
                    <button type="button" disabled
                        class="py-3 px-2 rounded-2xl border text-xs font-bold flex flex-col items-center justify-center gap-0.5 bg-gradient-to-br from-[#e79aa8] to-[#c96a7b] text-white border-[#c96a7b] shadow-md cursor-not-allowed">
                        <span class="text-sm font-mono font-extrabold">${num}</span>
                        <span class="text-[10px] opacity-95">第${num}首 ✓</span>
                    </button>
                `;
            }
            return `
                <button type="button" disabled
                    class="py-3 px-2 rounded-2xl border text-xs font-bold flex flex-col items-center justify-center gap-0.5 bg-gray-100 border-gray-300 text-gray-400 opacity-70 cursor-not-allowed select-none">
                    <span class="text-sm font-mono font-extrabold">${num}</span>
                    <span class="text-[10px]">第${num}首</span>
                </button>
            `;
        }

        return `
            <button type="button" onclick="selectCustomFortuneNumber('${num}')"
                class="py-3 px-2 rounded-2xl border text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 ${isSelected
                    ? 'bg-gradient-to-br from-[#e79aa8] to-[#c96a7b] text-white border-[#c96a7b] shadow-md scale-[1.03]'
                    : 'bg-white border-pink-200 text-[#8f4452] hover:bg-pink-50 hover:border-[#c96a7b]'}">
                <span class="text-sm font-mono font-extrabold">${num}</span>
                <span class="text-[10px] opacity-85">第${num}首</span>
            </button>
        `;
    }).join('');
}

window.selectCustomFortuneNumber = function(num) {
    const actId = String(document.getElementById('customActModalId')?.value || '').trim();
    const act = Store.getOpenCustomActivities().find(a => String(a.id) === actId);
    const regs = (appState.customActivityRegs && typeof appState.customActivityRegs === 'object') ? appState.customActivityRegs : {};
    if (act && regs[act.id]) {
        // 已保存報名後，號碼已鎖定，不可再選擇或更改其他號碼
        return;
    }

    const chosenStr = String(num || '').trim();
    const chosenNum = parseInt(chosenStr, 10);
    if (isNaN(chosenNum) || chosenNum < 1 || chosenNum > 5) return;

    const hiddenEl = document.getElementById('customActSelectedFortune');
    if (hiddenEl) hiddenEl.value = String(chosenNum);
    renderCustomFortuneButtons(chosenNum, false);

    const statusBox = document.getElementById('customActStatusBadgeBox');
    if (act && statusBox) {
        statusBox.innerHTML = `🎋 <strong>【${act.name}】目前已勾選：第 ${chosenNum} 首</strong><br>請點擊下方「✨ 確認報名【${act.name}】」保存（保存後其他號碼將反灰鎖定不可更改）！`;
    }
};

function renderCustomTwoChoiceButtons(optA, optB, selectedChoice, isLocked = false) {
    const grid = document.getElementById('customActTwoChoiceGrid');
    if (!grid) return;
    const sel = String(selectedChoice || '');
    const choices = [
        { label: optA, badge: '選項 A' },
        { label: optB, badge: '選項 B' }
    ];
    grid.innerHTML = choices.map(ch => {
        const isSelected = sel === ch.label;
        const safeArg = ch.label.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        if (isLocked) {
            if (isSelected) {
                return `
                    <button type="button" disabled
                        class="p-4 rounded-2xl border-2 text-center flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-amber-400 via-orange-400 to-rose-500 text-white border-rose-500 shadow-lg cursor-not-allowed">
                        <span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-white/25 text-white">${ch.badge} ✓</span>
                        <span class="text-base font-bold font-serif-jp">${ch.label}</span>
                    </button>
                `;
            }
            return `
                <button type="button" disabled
                    class="p-4 rounded-2xl border-2 text-center flex flex-col items-center justify-center gap-1.5 bg-gray-100 border-gray-300 text-gray-400 opacity-70 cursor-not-allowed select-none">
                    <span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-gray-200 text-gray-500">${ch.badge}</span>
                    <span class="text-base font-bold font-serif-jp">${ch.label}</span>
                </button>
            `;
        }

        return `
            <button type="button" onclick="selectCustomTwoChoiceOption('${safeArg}')"
                class="p-4 rounded-2xl border-2 text-center transition flex flex-col items-center justify-center gap-1.5 ${isSelected
                    ? 'bg-gradient-to-br from-amber-400 via-orange-400 to-rose-500 text-white border-rose-500 shadow-lg scale-[1.02]'
                    : 'bg-white border-pink-200 text-[#8f4452] hover:bg-amber-50/60 hover:border-amber-400'}">
                <span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold ${isSelected ? 'bg-white/25 text-white' : 'bg-pink-100 text-[#8f4452]'}">${ch.badge}</span>
                <span class="text-base font-bold font-serif-jp">${ch.label}</span>
            </button>
        `;
    }).join('');
}

window.selectCustomTwoChoiceOption = function(choiceText) {
    const actId = String(document.getElementById('customActModalId')?.value || '').trim();
    const act = Store.getOpenCustomActivities().find(a => String(a.id) === actId);
    const regs = (appState.customActivityRegs && typeof appState.customActivityRegs === 'object') ? appState.customActivityRegs : {};
    if (act && regs[act.id]) {
        // 已保存報名後，選項已鎖定，不可再選擇或更新其他選項
        return;
    }

    document.getElementById('customActSelectedTwoChoice').value = String(choiceText);
    if (act) {
        renderCustomTwoChoiceButtons(act.optionA || '選項A', act.optionB || '選項B', choiceText, false);
        const statusBox = document.getElementById('customActStatusBadgeBox');
        if (statusBox) {
            statusBox.innerHTML = `⚖️ <strong>【${act.name}】目前已選擇：「${choiceText}」</strong><br>請點擊下方「✨ 確認報名【${act.name}】」保存（保存後其他選項將反灰鎖定不可更改）！`;
        }
    }
};

function openCustomActivityModal(activityId) {
    const act = Store.getOpenCustomActivities().find(a => String(a.id) === String(activityId));
    if (!act) return;

    const schedState = getCustomActivityScheduleState(act);
    if (!schedState.canRegister) {
        closeCustomActivityModal();
        refreshAllUI();
        return;
    }

    const actType = act.activityType || 'classic';
    const regs = (appState.customActivityRegs && typeof appState.customActivityRegs === 'object') ? appState.customActivityRegs : {};
    const existingReg = regs[act.id] || null;
    const savedCriteria = (existingReg && existingReg.exactMatchCriteria) ? existingReg.exactMatchCriteria : {};
    const savedMustKeys = (existingReg && Array.isArray(existingReg.mustMatchKeys)) ? existingReg.mustMatchKeys : [];
    const savedFortune = (existingReg && existingReg.fortuneNumber) ? String(existingReg.fortuneNumber) : '';
    const savedTwoChoice = (existingReg && existingReg.twoChoiceValue) ? String(existingReg.twoChoiceValue) : '';

    document.getElementById('customActModalId').value = String(act.id);
    document.getElementById('customActModalType').value = actType;
    document.getElementById('customActSelectedFortune').value = savedFortune;
    document.getElementById('customActSelectedTwoChoice').value = savedTwoChoice;

    const modalTimeNote = schedState.hasSchedule
        ? `⏰ 活動時間：${schedState.windowText || '不限'}${schedState.matchText ? ` ｜ 💘 配對時間：${schedState.matchText}` : ''}`
        : '此為後台創建的獨立專屬活動，與週二／週四／週六常規自動配對互不影響';
    document.getElementById('customActModalTitle').textContent = `🎪 報名專屬活動：【${act.name}】`;
    document.getElementById('customActModalSubtitle').textContent = act.description
        ? `${act.description}（${modalTimeNote}）`
        : modalTimeNote;

    const statusBox = document.getElementById('customActStatusBadgeBox');
    const cancelBtn = document.getElementById('cancelCustomActRegBtn');
    const confirmBtn = document.getElementById('confirmCustomActRegBtn');

    const classicSec = document.getElementById('customActClassicSection');
    const fortuneSec = document.getElementById('customActFortuneSection');
    const twoChoiceSec = document.getElementById('customActTwoChoiceSection');

    classicSec.classList.add('hidden');
    fortuneSec.classList.add('hidden');
    twoChoiceSec.classList.add('hidden');

    confirmBtn.classList.remove('hidden');

    if (actType === 'fortune_number') {
        fortuneSec.classList.remove('hidden');
        if (existingReg) {
            renderCustomFortuneButtons(savedFortune, true);
            statusBox.innerHTML = `🔒 <strong>你目前已報名【${act.name}】（已鎖定：第 ${savedFortune} 首）！</strong><br>號碼保存後其他選項已反灰鎖定，不可再選擇或更新號碼（若要退出活動請點擊「🍃 取消報名」）。`;
            cancelBtn.classList.remove('hidden');
            confirmBtn.classList.add('hidden');
        } else {
            renderCustomFortuneButtons(savedFortune, false);
            statusBox.innerHTML = `🎋 <strong>【${act.name}】月老籤詩請選擇1~5首號碼！</strong><br>選擇相同號碼的玩家將於管理員執行配對時成功牽線（單獨號碼不會配對；送出保存後不可更改號碼）。`;
            cancelBtn.classList.add('hidden');
            confirmBtn.classList.remove('hidden');
            confirmBtn.textContent = `✨ 確認報名【${act.name}】`;
        }
    } else if (actType === 'two_choice') {
        twoChoiceSec.classList.remove('hidden');
        const optA = act.optionA || '選項A';
        const optB = act.optionB || '選項B';
        if (existingReg) {
            renderCustomTwoChoiceButtons(optA, optB, savedTwoChoice, true);
            statusBox.innerHTML = `🔒 <strong>你目前已報名【${act.name}】（已鎖定：「${savedTwoChoice}」）！</strong><br>選擇保存後其他選項已反灰鎖定，不可再選擇或更新選項（若要退出活動請點擊「🍃 取消報名」）。`;
            cancelBtn.classList.remove('hidden');
            confirmBtn.classList.add('hidden');
        } else {
            renderCustomTwoChoiceButtons(optA, optB, savedTwoChoice, false);
            statusBox.innerHTML = `⚖️ <strong>【${act.name}】默契大考驗二選一（${optA} / ${optB}）！</strong><br>選擇相同答案的玩家將會隨機配對牽線（送出保存後不可更改選項）。`;
            cancelBtn.classList.add('hidden');
            confirmBtn.classList.remove('hidden');
            confirmBtn.textContent = `✨ 確認報名【${act.name}】`;
        }
    } else {
        classicSec.classList.remove('hidden');
        if (existingReg) {
            statusBox.innerHTML = `✅ <strong>你目前已報名【${act.name}】！</strong><br>可於下方調整此活動專屬的「希望對方完全吻合條件」並按更新，或點擊「取消報名」退出此活動。`;
            cancelBtn.classList.remove('hidden');
            confirmBtn.classList.remove('hidden');
            confirmBtn.textContent = '✨ 更新條件並保持報名';
        } else {
            statusBox.innerHTML = `📣 <strong>【${act.name}】開放獨立報名中！</strong><br>確認報名後，管理員將於後台進行配對（完全不影響您週二／週四／週六的常規配對）。`;
            cancelBtn.classList.add('hidden');
            confirmBtn.classList.remove('hidden');
            confirmBtn.textContent = `✨ 確認報名【${act.name}】`;
        }

        renderDualCriteriaOptionsList('custom', savedCriteria, savedMustKeys);
    }

    document.getElementById('customActivityModal').classList.remove('hidden');
}

window.toggleCustomActExactSelect = function(key) {
    onDualCriterionCheckChange('custom', key);
};

function closeCustomActivityModal() {
    document.getElementById('customActivityModal').classList.add('hidden');
}

let customActivitySyncSuppressUntil = 0;

async function confirmCustomActivityRegistration() {
    const actId = String(document.getElementById('customActModalId').value || '').trim();
    const act = Store.getOpenCustomActivities().find(a => String(a.id) === actId);
    if (!act) {
        closeCustomActivityModal();
        refreshAllUI();
        showMiniNotice('🌸 活動已關閉', '此專屬活動目前已關閉報名。');
        return;
    }

    const schedState = getCustomActivityScheduleState(act);
    if (!schedState.canRegister) {
        closeCustomActivityModal();
        refreshAllUI();
        const reasonMsg = schedState.status === 'upcoming'
            ? `【${act.name}】將於 ${formatShortDateTime(schedState.startTs)} 才開放報名！`
            : `【${act.name}】已於 ${formatShortDateTime(schedState.endTs || schedState.matchTs)} 截止報名，無法再送出或修改！`;
        showMiniNotice('⏰ 無法報名', reasonMsg);
        return;
    }

    const actType = act.activityType || 'classic';
    if (!appState.customActivityRegs || typeof appState.customActivityRegs !== 'object') {
        appState.customActivityRegs = {};
    }

    if (actType === 'fortune_number') {
        if (appState.customActivityRegs[act.id]) {
            const lockedNum = appState.customActivityRegs[act.id].fortuneNumber || '';
            showMiniNotice('🔒 號碼已鎖定', `您已報名【${act.name}】（第 ${lockedNum} 首），保存後不可更改號碼。`);
            return;
        }
        const chosenNum = parseInt(document.getElementById('customActSelectedFortune').value, 10);
        if (isNaN(chosenNum) || chosenNum < 1 || chosenNum > 5) {
            showMiniNotice('🎋 請選擇籤詩號碼', '月老籤詩請選擇1~5首號碼後再送出報名！');
            return;
        }
        customActivitySyncSuppressUntil = Date.now() + 6000;
        appState.customActivityRegs[act.id] = {
            activityId: String(act.id),
            activityName: act.name,
            activityType: 'fortune_number',
            fortuneNumber: chosenNum,
            registeredAt: Date.now(),
            exactMatchCriteria: {}
        };
        closeCustomActivityModal();
        refreshAllUI();
        await Store.save(appState, true);
        customActivitySyncSuppressUntil = Date.now() + 2500;
        refreshAllUI();
        showMiniNotice(
            '🎋 月老籤詩報名成功',
            `已成功報名【${act.name}】！\n您選擇的籤詩號碼：第 ${chosenNum} 首（已鎖定，其他號碼已反灰不可更改）`
        );
        return;
    }

    if (actType === 'two_choice') {
        if (appState.customActivityRegs[act.id]) {
            const lockedChoice = appState.customActivityRegs[act.id].twoChoiceValue || '';
            showMiniNotice('🔒 選項已鎖定', `您已報名【${act.name}】（「${lockedChoice}」），保存後不可更改選項。`);
            return;
        }
        const chosenOpt = document.getElementById('customActSelectedTwoChoice').value.trim();
        const validOpts = [act.optionA, act.optionB].filter(Boolean);
        if (!chosenOpt || (validOpts.length > 0 && !validOpts.includes(chosenOpt))) {
            showMiniNotice('⚖️ 請完成二選一', '請先在「默契大考驗二選一」中點選其中一個選項再送出報名！');
            return;
        }
        customActivitySyncSuppressUntil = Date.now() + 6000;
        appState.customActivityRegs[act.id] = {
            activityId: String(act.id),
            activityName: act.name,
            activityType: 'two_choice',
            twoChoiceValue: chosenOpt,
            registeredAt: Date.now(),
            exactMatchCriteria: {}
        };
        closeCustomActivityModal();
        refreshAllUI();
        await Store.save(appState, true);
        customActivitySyncSuppressUntil = Date.now() + 2500;
        refreshAllUI();
        showMiniNotice(
            '⚖️ 默契大考驗報名成功',
            `已成功報名【${act.name}】！\n默契大考驗二選一您的選擇：「${chosenOpt}」（已鎖定，其他選項已反灰不可更改）`
        );
        return;
    }

    const { criteria, mustMatchKeys, incompleteLabels } = collectDualCriteriaFromDom('custom');
    if (incompleteLabels.length > 0) {
        showMiniNotice(
            '⚠️ 請完成配對條件設定',
            `您已勾選「${incompleteLabels.join('、')}」，請先選擇具體選項及條件類型（🔒 必須吻合 或 ✨ 任一符合），或取消勾選該欄位後再送出報名喔！`
        );
        return;
    }

    customActivitySyncSuppressUntil = Date.now() + 6000;
    appState.customActivityRegs[act.id] = {
        activityId: String(act.id),
        activityName: act.name,
        activityType: 'classic',
        registeredAt: Date.now(),
        exactMatchCriteria: criteria,
        mustMatchKeys: mustMatchKeys
    };

    closeCustomActivityModal();
    refreshAllUI();
    await Store.save(appState, true);
    customActivitySyncSuppressUntil = Date.now() + 2500;
    refreshAllUI();

    const displayItems = formatCriteriaDisplayList(criteria, mustMatchKeys);
    const desc = displayItems.length > 0
        ? '此活動指定條件：\n' + displayItems.map(item => `・${item}`).join('\n')
        : '未勾選額外條件（不限制，將進行隨機配對）';

    showMiniNotice('🎪 專屬活動報名成功', `已成功報名【${act.name}】！\n（此為獨立活動，不影響週二／週四／週六場次）\n\n${desc}`);
}

async function cancelCustomActivityRegistration() {
    const actId = String(document.getElementById('customActModalId').value || '').trim();
    const act = Store.getCustomActivities().find(a => String(a.id) === actId);
    const actName = act ? act.name : '此專屬活動';

    if (act) {
        const schedState = getCustomActivityScheduleState(act);
        if (!schedState.canCancel) {
            closeCustomActivityModal();
            refreshAllUI();
            showMiniNotice('⏰ 已過截止時間', `【${actName}】報名時間已截止，無法再取消報名。`);
            return;
        }
    }

    customActivitySyncSuppressUntil = Date.now() + 6000;
    if (!appState.customActivityRegs || typeof appState.customActivityRegs !== 'object') {
        appState.customActivityRegs = {};
    }
    Object.keys(appState.customActivityRegs).forEach(k => {
        if (String(k).trim() === actId) {
            delete appState.customActivityRegs[k];
        }
    });

    closeCustomActivityModal();
    refreshAllUI();

    await Store.save(appState, true);
    if (appState.playerId && actId && typeof ActivityRegArchive !== 'undefined') {
        ActivityRegArchive.removeCustom(actId, appState.playerId);
    }
    if (appState.playerId && actId && typeof CloudSync !== 'undefined') {
        await CloudSync.deleteNode(`${USERS_KEY}/${appState.playerId}/customActivityRegs/${actId}`);
    }
    customActivitySyncSuppressUntil = Date.now() + 2500;
    refreshAllUI();

    showMiniNotice('🍃 已取消報名', `已取消報名【${actName}】（不影響週二／週四／週六常規配對）。`);
}

function refreshAllUI() {
    const sysConfig = Store.getSystemConfig();
    const quota = Store.getGenderQuotaStatus();
    const complete = isProfileComplete() && !!appState.playerId;
    const isBothGenderFullForNew = !appState.playerId && quota.bothFull;
    const batchNum = sysConfig.currentBatch;
    const sched = getBatchScheduleInfo(batchNum);
    const nowRefreshTs = Date.now();
    const isTueClosedNow = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(sched.tueLabel, nowRefreshTs);
    const isThuClosedNow = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(sched.thuLabel, nowRefreshTs);
    const isSatClosedNow = (typeof isRegularSessionRegistrationClosed === 'function') && isRegularSessionRegistrationClosed(sched.satLabel, nowRefreshTs);
    const isAllBatchSessionsClosed = isTueClosedNow && isThuClosedNow && isSatClosedNow;
    const openBatchSessionLabels = [
        !isTueClosedNow ? sched.tueLabel : '',
        !isThuClosedNow ? sched.thuLabel : '',
        !isSatClosedNow ? sched.satLabel : ''
    ].filter(Boolean);
    const closedBatchSessionLabels = [
        isTueClosedNow ? sched.tueLabel : '',
        isThuClosedNow ? sched.thuLabel : '',
        isSatClosedNow ? sched.satLabel : ''
    ].filter(Boolean);

    const normalizedAllSessions = Array.from(new Set((appState.registeredSessions || []).map(s => normalizeSessionLabel(s)).filter(Boolean)));
    const currentBatchSessions = normalizedAllSessions.filter(s =>
        sched.sessions.some(target => isSameSession(s, target)) &&
        !(typeof isRegularSessionRegistrationClosed === 'function' && isRegularSessionRegistrationClosed(s, nowRefreshTs))
    );

    const periodBadgeEl = document.getElementById('currentPeriodBadge');
    if (periodBadgeEl) {
        periodBadgeEl.textContent = `目前開放：${sched.batchPrefix}（${sched.tueDateStr}(二) / ${sched.thuDateStr}(四) / ${sched.satDateStr}(六)）`;
    }

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
        alertBox.innerHTML = `<span class="text-rose-600 font-bold">本屆報名人數已滿，目前暫停開放報名！</span><br>已成功報名的玩家將如期於週二 / 週四 / 週六 20:00 進行配對。`;
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
    } else if (isAllBatchSessionsClosed) {
        badge.textContent = `⏳ ${sched.batchPrefix}已截止報名`;
        applyBtn.disabled = true;
        applyBtn.textContent = `⏳ ${sched.batchPrefix}已截止報名（請靜待下期開放）`;
        alertBox.innerHTML = `<span class="text-gray-500 font-bold">${sched.tueLabel}、${sched.thuLabel} 與 ${sched.satLabel} 皆已過 20:00 截止報名</span>，請靜待下一期開放報名！`;
    } else if (currentBatchSessions.length > 0) {
        const criteriaSummary = formatCriteriaSummaryText(appState.exactMatchCriteria || {}, appState.mustMatchKeys || []);
        const closedHint = closedBatchSessionLabels.length > 0
            ? `<br><span class="text-[11px] text-gray-400">（${closedBatchSessionLabels.join('、')} 已於 20:00 截止報名）</span>`
            : '';
        badge.textContent = `⏳ 已報名 (${currentBatchSessions.length}場)`;
        applyBtn.disabled = false;
        applyBtn.textContent = '✅ 已報名';
        alertBox.innerHTML = `你已成功報名 <strong>${currentBatchSessions.join('、')}</strong>！<br>配對條件：<strong>${criteriaSummary}</strong>。${closedHint}`;
    } else {
        badge.textContent = `✨ ${sched.batchPrefix}開始報名中`;
        applyBtn.disabled = false;
        applyBtn.textContent = `🌸 開始報名（${sched.batchPrefix}）`;
        const maxRegHintCount = (typeof getMaxRegularSessionsForUser === 'function') ? getMaxRegularSessionsForUser(appState) : Infinity;
        const homeExtraCredits = (typeof getUserExtraMatchCredits === 'function') ? getUserExtraMatchCredits(appState) : 0;
        const multiHintText = Number.isFinite(maxRegHintCount)
            ? (maxRegHintCount > 2
                ? `✨ 已解鎖最多可選 ${maxRegHintCount} 場${homeExtraCredits > 0 ? `・剩餘加場 ${homeExtraCredits} 次` : ''}`
                : `最多可選 ${maxRegHintCount} 場`)
            : '可複選';
        if (closedBatchSessionLabels.length > 0) {
            const closedStrikeHtml = closedBatchSessionLabels.map(lbl => `<span class="text-gray-400 line-through">${lbl}</span>`).join('、');
            alertBox.innerHTML = `目前開放報名 <strong>${openBatchSessionLabels.join('</strong> 或 <strong>')}</strong>（${closedStrikeHtml} 已於 20:00 截止報名），有報名才會參與配對！`;
        } else {
            alertBox.innerHTML = `目前開放報名 <strong>${openBatchSessionLabels.join('</strong>、<strong>')}</strong>（${multiHintText}），有報名才會參與配對！`;
        }
    }

    // 渲染第 2 種活動（後台創建並開啟的專屬活動按鈕，僅在後台開啟時顯示）
    const customSectionBox = document.getElementById('customActivitySection');
    const customBtnBox = document.getElementById('customActivitiesBtnContainer');
    const customAlertBox = document.getElementById('customActivityAlertBox');
    const openCustomActs = (typeof Store.getOpenCustomActivities === 'function') ? Store.getOpenCustomActivities() : [];
    const myCustomRegs = (appState.customActivityRegs && typeof appState.customActivityRegs === 'object') ? appState.customActivityRegs : {};

    if (customBtnBox && customAlertBox) {
        if (openCustomActs.length === 0) {
            if (customSectionBox) customSectionBox.classList.add('hidden');
            customBtnBox.classList.add('hidden');
            customBtnBox.innerHTML = '';
            customAlertBox.classList.add('hidden');
            customAlertBox.innerHTML = '';
        } else {
            if (customSectionBox) customSectionBox.classList.remove('hidden');
            const allUsersForActCheck = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
            const meUserRec = appState.playerId ? allUsersForActCheck.find(u => String(u.id) === String(appState.playerId)) : null;

            customBtnBox.classList.remove('hidden');
            customBtnBox.innerHTML = openCustomActs.map(act => {
                const isReg = Boolean(myCustomRegs[act.id]);
                const schedState = getCustomActivityScheduleState(act);
                const matchedItem = (meUserRec && Array.isArray(meUserRec.matchedHistory))
                    ? meUserRec.matchedHistory.find(h => String(h.activityId || '') === String(act.id) || String(h.session || '') === String(act.name))
                    : null;

                if (appState.isWarnedAccount) {
                    return `
                        <button type="button" disabled class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm bg-gray-200 text-gray-400 cursor-not-allowed">
                            ⚠️ ${act.name}（警告帳號不提供配對）
                        </button>
                    `;
                }
                if (schedState.status === 'upcoming') {
                    return `
                        <button type="button" disabled class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm bg-gray-100 border border-gray-300 text-gray-500 cursor-not-allowed">
                            ⏳ 尚未開始【${act.name}】（${formatShortDateTime(schedState.startTs)} 開放）
                        </button>
                    `;
                }
                if (schedState.status === 'waiting_match') {
                    if (isReg) {
                        return `
                            <button type="button" disabled class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm bg-amber-100 border border-amber-300 text-amber-900 cursor-not-allowed">
                                ⌛ 已報名【${act.name}】（等待 ${schedState.matchText || '配對時間'} 開獎）
                            </button>
                        `;
                    }
                    return `
                        <button type="button" disabled class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm bg-gray-100 border border-gray-300 text-gray-400 cursor-not-allowed">
                            🔒【${act.name}】報名已截止（${schedState.matchText || ''} 配對）
                        </button>
                    `;
                }
                if (schedState.status === 'matched') {
                    if (matchedItem) {
                        return `
                            <button type="button" onclick="handleCustomActivityClick('${act.id}')" class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm shadow-lg tracking-wider bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-95 transition">
                                💘【${act.name}】配對成功！前往好友聊天
                            </button>
                        `;
                    }
                    if (isReg) {
                        return `
                            <button type="button" disabled class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm bg-gray-100 border border-gray-300 text-gray-500 cursor-not-allowed">
                                🍃【${act.name}】已開獎（本次未配對成功）
                            </button>
                        `;
                    }
                    return `
                        <button type="button" disabled class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm bg-gray-100 border border-gray-300 text-gray-400 cursor-not-allowed">
                            ⏰【${act.name}】活動已結束
                        </button>
                    `;
                }

                if (isReg) {
                    return `
                        <button type="button" onclick="handleCustomActivityClick('${act.id}')" class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm shadow-lg tracking-wider bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:opacity-95 transition">
                            ✅ 已報名
                        </button>
                    `;
                }
                return `
                    <button type="button" onclick="handleCustomActivityClick('${act.id}')" class="px-5 py-2 rounded-xl font-bold text-xs sm:text-sm shadow-lg tracking-wider bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 text-white hover:opacity-95 transition">
                        🎪 報名【${act.name}】
                    </button>
                `;
            }).join('');

            const statusLines = openCustomActs.map(act => {
                const schedState = getCustomActivityScheduleState(act);
                const timeLine = schedState.hasSchedule
                    ? `<br><span class="text-[11px] text-[#8f4452] font-semibold">⏰ 活動時間：${schedState.windowText || '不限'}</span>`
                    : '';
                return `<span class="font-bold text-[#8f4452]">✨ 獨立專屬活動【${act.name}】</span>${timeLine}`;
            });

            customAlertBox.classList.remove('hidden');
            customAlertBox.innerHTML = `
                <div class="text-xs space-y-2">
                    ${statusLines.map(line => `<p>${line}</p>`).join('')}
                </div>
            `;
        }
    }

    if (typeof updateFriendUnreadDot === 'function') {
        updateFriendUnreadDot();
    } else {
        document.getElementById('navFriendDot').classList.toggle('hidden', appState.friends.length === 0);
    }
    if (typeof renderHomeFateWall === 'function') {
        renderHomeFateWall();
    }
    renderHomeStatsCharts();
    if (typeof renderDailyFortuneCard === 'function') renderDailyFortuneCard();
    if (typeof renderDailyLovePollCard === 'function') renderDailyLovePollCard();
    renderFriendsSection();
}


// ==================== 🌸 前台首頁：每日一抽月老戀愛籤詩 ＋ 每日戀愛價值觀二選一共鳴牆（v27・Firebase 原子遞增真實計票・滿10票純真實比例） ====================
const DAILY_FORTUNE_STORAGE_KEY = 'yuelao_daily_fortune_draw_v1';
const DAILY_LOVE_POLL_STORAGE_KEY = 'yuelao_daily_love_poll_v1';
const DAILY_POLL_CLOUD_BASE_PATH = 'yuelao_fate_wall/_daily_poll_stats';
const DAILY_POLL_REAL_THRESHOLD = 10; // 累積滿 10 票後顯示 100% 純真實站內投票比例

const YUELAO_DAILY_FORTUNE_LEVELS = [
    '🔮 大吉 🔮',
    '🔮 吉 🔮', '🔮 吉 🔮', '🔮 吉 🔮', '🔮 吉 🔮', '🔮 吉 🔮', '🔮 吉 🔮', '🔮 吉 🔮',
    '🔮 中吉 🔮', '🔮 中吉 🔮',
    '🔮 小吉 🔮', '🔮 小吉 🔮', '🔮 小吉 🔮', '🔮 小吉 🔮',
    '🔮 末吉 🔮', '🔮 末吉 🔮'
];

const YUELAO_DAILY_FORTUNE_POEMS = [
    { keyword: '雙向奔赴', poem: '春風拂柳正當時，莫問前程幾許遲；今日回眸微笑處，恰逢心動那個人。' },
    { keyword: '不期而遇', poem: '千山萬水一線牽，靜待花開月正圓；無須刻意尋覓去，溫柔自會到身邊。' },
    { keyword: '一拍即合', poem: '靈犀一點通心意，笑語盈盈夜未央；莫道相逢猶太晚，良緣從來不打烊。' },
    { keyword: '溫柔治癒', poem: '月色如水照歸人，一盞清茶話夜深；懂你沉默與歡喜，便是此生有緣人。' },
    { keyword: '靈魂共鳴', poem: '星河璀璨落凡塵，萬千人海唯見君；心有靈犀無需猜，紅線早已繫三分。' },
    { keyword: '真誠相待', poem: '和風吹散舊時愁，新綠枝頭喜事留；但將真心付明月，明月自然照溝渠。' },
    { keyword: '心想事成', poem: '喜鵲枝頭報佳音，春風得意遇知音；莫負良辰與美景，勇敢邁出第一步。' },
    { keyword: '自然心動', poem: '風鈴輕響喚良緣，心靜自然福氣連；自在做回真自我，自有欣賞在眼前。' },
    { keyword: '細水長流', poem: '細雨潤物無聲處，日久見心最真誠；一句晚安勝千語，便是人間好時節。' },
    { keyword: '輕鬆自在', poem: '人間煙火最撫心，並肩同行笑意深；不求轟烈驚天地，只願三餐共黃昏。' },
    { keyword: '安心陪伴', poem: '慢火細熬茶更香，真心不急在一朝；循序漸進相知暖，方得長久伴身旁。' },
    { keyword: '貼心細節', poem: '細微之處見真情，風雨無阻伴君行；平淡日常藏浪漫，便是人間最美風景。' },
    { keyword: '默契升溫', poem: '燈火闌珊映笑顏，棋逢對手話投緣；卸下防備輕聲語，微光之中見真情。' },
    { keyword: '微甜日常', poem: '柴米油鹽皆詩意，一粥一飯總關情；平凡日子添暖色，便是人間小確幸。' },
    { keyword: '靜待花開', poem: '雲開霧散終有時，莫為一時起波瀾；先把自己照顧好，良人自會在轉彎。' },
    { keyword: '循序漸進', poem: '好事多磨莫心急，春風尚在路途中；多一份耐心與微笑，緣分自會慢慢靠近。' }
];

const YUELAO_DAILY_FORTUNE_MBTIS = [
    'ENFP', 'INFJ', 'ENTP', 'INFP',
    'INTJ', 'ENFJ', 'ESFJ', 'ISFP',
    'ISFJ', 'ESFP', 'ISTJ', 'ISTP',
    'ENTJ', 'ESTJ', 'INTP', 'ESTP'
];

const YUELAO_DAILY_FORTUNE_SPOTS = [
    '星巴克門市',
    '手搖飲料店排隊時',
    '麥當勞點餐區',
    '7-11 或全家便利商店',
    '全聯或家樂福生鮮區',
    '夜市小吃攤前',
    '捷運車廂或月台',
    '路易莎咖啡廳',
    '百貨美食街座位區',
    '社區公園散步步道',
    '誠品書店或文具店',
    '早午餐店窗邊座位',
    '電影院售票處旁',
    '健身房或運動公園',
    '公車站牌候車亭',
    '拉麵店或深夜食堂'
];

const YUELAO_DAILY_LOVE_POLLS = [
    { id: 'p01', q: '曖昧期訊息「隔 3 小時以上才回」，你能接受嗎？', optA: '能接受，大家都有各自的生活與工作', optB: '很難接受，喜歡一個人再忙也會抽空回', baseM: [58, 42], baseF: [36, 64] },
    { id: 'p02', q: '第一次跟網友見面約會，餐費怎麼分最舒服？', optA: '各自付清（AA 制），互不相欠最自在', optB: '一人請吃飯、另一人請喝飲料或甜點', baseM: [44, 56], baseF: [38, 62] },
    { id: 'p03', q: '另一半手機裡「還留著前任的合照」，你會在意嗎？', optA: '很在意，希望交往後能整理刪除乾淨', optB: '不太在意，那只是過去生活的一部分', baseM: [52, 48], baseF: [71, 29] },
    { id: 'p04', q: '吵架冷戰時，你比較傾向哪一種處理方式？', optA: '當天睡前一定要把話講開、不留隔夜仇', optB: '先各自冷靜半天，等情緒平復再好好溝通', baseM: [49, 51], baseF: [66, 34] },
    { id: 'p05', q: '理想中的週末約會，你更喜歡哪一種？', optA: '出門踩點美食、看展或到外縣市小旅行', optB: '宅在家一起煮飯、看電影耍廢一整天', baseM: [47, 53], baseF: [55, 45] },
    { id: 'p06', q: '你相信「日久生情」還是「一見鍾情」？', optA: '日久生情，相處後的默契與細節才可靠', optB: '一見鍾情，第一眼的眼緣與感覺最重要', baseM: [61, 39], baseF: [68, 32] },
    { id: 'p07', q: '伴侶有關係很好的「異性純友誼」，你的底線是？', optA: '只要透明報備、不單獨過夜都能尊重', optB: '有伴侶後應該自動保持距離、避免單獨約', baseM: [45, 55], baseF: [32, 68] },
    { id: 'p08', q: '感情裡「儀式感（節日驚喜、手寫卡片）」重要嗎？', optA: '很重要，生活需要特別的日子留下回憶', optB: '還好，平常日常的貼心陪伴比節日更實際', baseM: [35, 65], baseF: [63, 37] },
    { id: 'p09', q: '遇到非常有好感的對象，你會選擇主動出擊嗎？', optA: '會！主動丟球約見面，不想留下遺憾', optB: '偏被動，會先默默觀察並給予暗示等對方約', baseM: [64, 36], baseF: [28, 72] },
    { id: 'p10', q: '選伴侶時，「三觀契合」與「外貌心動」哪個優先？', optA: '三觀與溝通頻率契合，相處不累最重要', optB: '外貌與氣質要先過關，才有動力深入了解', baseM: [54, 46], baseF: [69, 31] },
    { id: 'p11', q: '睡前習慣跟另一半「講電話掛睡」還是「文字道晚安」？', optA: '講電話聊聊天，聽見聲音特別有安全感', optB: '傳訊息互道晚安就好，保留一點睡前空間', baseM: [39, 61], baseF: [48, 52] },
    { id: 'p12', q: '交往後公開放閃（發限動合照）是必須的嗎？', optA: '偶爾發一下很好，代表大方承認彼此存在', optB: '低調派，感情是兩個人的事不需要刻意曬', baseM: [41, 59], baseF: [57, 43] },
    { id: 'p13', q: '你能夠接受「遠距離戀愛（不同縣市）」嗎？', optA: '可以，只要有共同目標與信任就能克服距離', optB: '比較難，希望難過或想見面時能很快見到對方', baseM: [53, 47], baseF: [44, 56] },
    { id: 'p14', q: '交往後會想跟另一半「互看手機密碼或定位」嗎？', optA: '不需要，彼此保留隱私與信任感更健康', optB: '希望可以知道密碼或定位，會更有安全感', baseM: [62, 38], baseF: [46, 54] },
    { id: 'p15', q: '如果另一半比你大或小「5 歲以上」，你在意年齡差嗎？', optA: '不在意，心智成熟與聊得來比實際年齡重要', optB: '會在意，希望年齡相近、成長背景比較有共鳴', baseM: [67, 33], baseF: [58, 42] },
    { id: 'p16', q: '你比較喜歡「互補型（一靜一動）」還是「相似型（興趣相同）」伴侶？', optA: '相似型，喜歡一樣的事物能一起分享超快樂', optB: '互補型，彼此帶對方體驗不同的生活視角', baseM: [56, 44], baseF: [60, 40] },
    { id: 'p17', q: '曖昧多久沒有確認關係，你就會選擇慢慢下船？', optA: '1～2 個月內沒結果就會果斷止損', optB: '順其自然，只要相處愉快願意多觀察幾個月', baseM: [51, 49], baseF: [59, 41] },
    { id: 'p18', q: '出門旅行時，你是「事前排滿行程派」還是「睡飽隨興走走派」？', optA: '規劃派，先查好美食與交通才不會浪費時間', optB: '隨興派，走到哪逛到哪、放鬆不趕行程最棒', baseM: [43, 57], baseF: [56, 44] },
    { id: 'p19', q: '感情裡你最看重哪一種「愛的語言」？', optA: '肯定的言詞與貼心行動（誇獎、記得小細節）', optB: '高品質的陪伴與肢體接觸（專心陪在身邊、牽手抱抱）', baseM: [42, 58], baseF: [53, 47] },
    { id: 'p20', q: '如果伴侶跟前任「因為養寵物或工作還有聯絡」，你能接受嗎？', optA: '完全無法接受，分手就應該徹底斷乾淨', optB: '只要界線清楚、事先告知且不私下約就能理解', baseM: [48, 52], baseF: [68, 32] },
    { id: 'p21', q: '你覺得交往後「多久見一次面」最剛剛好？', optA: '每週見 1～2 次，保有各自空間又維持熱度', optB: '只要有空就想天天膩在一起，越常見越好', baseM: [63, 37], baseF: [59, 41] },
    { id: 'p22', q: '遇到生活或工作壓力大時，你希望另一半怎麼陪你？', optA: '先聽我吐苦水、給予情緒價值與抱抱安慰', optB: '幫我一起分析問題、提供實際解決建議', baseM: [38, 62], baseF: [74, 26] },
    { id: 'p23', q: '你會介意另一半「非常愛打遊戲或追劇到深夜」嗎？', optA: '不介意，每個人都需要自己的放鬆娛樂時間', optB: '會介意，希望作息同步、多留點時間聊天相處', baseM: [69, 31], baseF: [45, 55] },
    { id: 'p24', q: '對於「同居試婚（婚前先一起住）」，你的看法是？', optA: '非常贊成，生活習慣合不合住過才知道', optB: '傾向保留各自空間，等確定要結婚再同居', baseM: [72, 28], baseF: [64, 36] },
    { id: 'p25', q: '在感情中，你是「容易吃醋佔有慾強」還是「佛系給足自由」？', optA: '表面裝沒事其實超容易吃醋，希望對方多哄我', optB: '偏佛系信任派，給彼此足夠的社交自由空間', baseM: [46, 54], baseF: [62, 38] },
    { id: 'p26', q: '如果伴侶忘記你們的「交往紀念日」，你會怎麼反應？', optA: '會失落不開心，覺得對方不夠重視這段感情', optB: '還好，直接提醒對方一起補吃頓大餐就好', baseM: [31, 69], baseF: [58, 42] },
    { id: 'p27', q: '你比較容易被「幽默風趣會逗你笑」還是「溫柔穩重很可靠」吸引？', optA: '幽默風趣，相處起來輕鬆開心、每天都笑得出聲', optB: '溫柔穩重，情緒穩定讓人覺得很有依靠感', baseM: [55, 45], baseF: [43, 57] },
    { id: 'p28', q: '交往穩定後，你會想「把另一半介紹給家人朋友認識」嗎？', optA: '會！想讓對方融入自己的生活圈與重要的人', optB: '等非常穩定再說，初期想先享受兩人世界', baseM: [51, 49], baseF: [47, 53] },
    { id: 'p29', q: '吃飯口味「一個愛吃辣、一個完全不吃辣」，你覺得影響大嗎？', optA: '影響很大，吃不到一起約會少了很多樂趣', optB: '完全沒差，各自點喜歡的或找鴛鴦鍋就好', baseM: [34, 66], baseF: [39, 61] },
    { id: 'p30', q: '如果能重來，你會選擇「早點遇到對的人」還是「先成為更好的自己再相遇」？', optA: '成為更好的自己再相遇，才能好好接住這份緣分', optB: '早點遇到對的人，一起經歷成長、陪彼此變好', baseM: [57, 43], baseF: [52, 48] }
];

let dailyLovePollTestOffset = 0;
let dailyPollCloudCountsCache = {}; // { [key]: { mA, mB, fA, fB } }
let dailyPollInFlightKeys = new Set();

function getTaipeiTodayDateStr() {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Taipei',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        const y = parts.find(p => p.type === 'year')?.value || '2026';
        const m = parts.find(p => p.type === 'month')?.value || '01';
        const d = parts.find(p => p.type === 'day')?.value || '01';
        return `${y}-${m}-${d}`;
    } catch (e) {
        const dt = new Date(Date.now() + 8 * 3600 * 1000);
        return dt.toISOString().slice(0, 10);
    }
}

function getTodayPollObject() {
    const dateStr = getTaipeiTodayDateStr();
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
        hash |= 0;
    }
    const idx = (Math.abs(hash) + dailyLovePollTestOffset) % YUELAO_DAILY_LOVE_POLLS.length;
    return { dateStr, poll: YUELAO_DAILY_LOVE_POLLS[idx] };
}

function rollFortuneRandomCount10To30() {
    return 10 + Math.floor(Math.random() * 21); // 10 ~ 30 隨機亂數
}

function buildRandomDailyFortuneCombo(dateStr) {
    const level = YUELAO_DAILY_FORTUNE_LEVELS[Math.floor(Math.random() * YUELAO_DAILY_FORTUNE_LEVELS.length)];
    const poemObj = YUELAO_DAILY_FORTUNE_POEMS[Math.floor(Math.random() * YUELAO_DAILY_FORTUNE_POEMS.length)];
    const mbti = YUELAO_DAILY_FORTUNE_MBTIS[Math.floor(Math.random() * YUELAO_DAILY_FORTUNE_MBTIS.length)];
    const spot = YUELAO_DAILY_FORTUNE_SPOTS[Math.floor(Math.random() * YUELAO_DAILY_FORTUNE_SPOTS.length)];
    const matchCount = rollFortuneRandomCount10To30();
    return {
        dateStr,
        level,
        keyword: poemObj.keyword,
        poem: poemObj.poem,
        mbti,
        spot,
        matchCount,
        drawnAt: Date.now()
    };
}

function getSavedDailyFortune() {
    const today = getTaipeiTodayDateStr();
    try {
        const raw = localStorage.getItem(DAILY_FORTUNE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.dateStr === today) {
            // 相容新格式（獨立隨機組合）與舊格式（index）
            if (parsed.level && parsed.keyword && parsed.poem && parsed.mbti && parsed.spot) {
                const randCount = (typeof parsed.matchCount === 'number' && parsed.matchCount >= 10 && parsed.matchCount <= 30)
                    ? parsed.matchCount
                    : rollFortuneRandomCount10To30();
                return {
                    dateStr: today,
                    level: parsed.level,
                    keyword: parsed.keyword,
                    poem: parsed.poem,
                    mbti: parsed.mbti,
                    spot: parsed.spot,
                    matchCount: randCount
                };
            }
            if (typeof parsed.index === 'number') {
                const poemObj = YUELAO_DAILY_FORTUNE_POEMS[parsed.index % YUELAO_DAILY_FORTUNE_POEMS.length];
                const level = YUELAO_DAILY_FORTUNE_LEVELS[parsed.index % YUELAO_DAILY_FORTUNE_LEVELS.length];
                const mbti = YUELAO_DAILY_FORTUNE_MBTIS[parsed.index % YUELAO_DAILY_FORTUNE_MBTIS.length];
                const spot = YUELAO_DAILY_FORTUNE_SPOTS[parsed.index % YUELAO_DAILY_FORTUNE_SPOTS.length];
                const randCount = (typeof parsed.matchCount === 'number' && parsed.matchCount >= 10 && parsed.matchCount <= 30)
                    ? parsed.matchCount
                    : rollFortuneRandomCount10To30();
                return { dateStr: today, level, keyword: poemObj.keyword, poem: poemObj.poem, mbti, spot, matchCount: randCount };
            }
        }
    } catch (e) {}
    return null;
}

function drawTodayYuelaoFortune() {
    const today = getTaipeiTodayDateStr();
    let drawn = getSavedDailyFortune();
    if (!drawn) {
        drawn = buildRandomDailyFortuneCombo(today);
        try {
            localStorage.setItem(DAILY_FORTUNE_STORAGE_KEY, JSON.stringify(drawn));
        } catch (e) {}
    }
    renderDailyFortuneCard(true);
}

function resetDailyFortuneForTest() {
    try {
        localStorage.removeItem(DAILY_FORTUNE_STORAGE_KEY);
    } catch (e) {}
    drawTodayYuelaoFortune();
}

function copyDailyFortuneShareText() {
    const drawn = getSavedDailyFortune();
    if (!drawn) return;
    const today = getTaipeiTodayDateStr();
    const shareText = `🌸 今日月老戀愛籤（${today}）\n【${drawn.level}】關鍵字：#${drawn.keyword}\n「${drawn.poem}」\n✨ 今日契合人格：${drawn.mbti}｜幸運地點：${drawn.spot}\n👉 一起來月老牽線計畫抽今日紅線運勢吧！`;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(shareText).then(() => {
            if (typeof showMiniNotice === 'function') {
                showMiniNotice('📋 籤詩已複製', '已複製今日月老籤詩文案，可直接貼到 Threads 分享喔！');
            }
        }).catch(() => {});
    } else if (typeof showMiniNotice === 'function') {
        showMiniNotice('🌸 今日月老籤詩', shareText);
    }
}

function handleFortuneCtaClick() {
    const hasProfile = Boolean(typeof appState !== 'undefined' && appState && appState.playerId);
    if (!hasProfile) {
        if (typeof switchTab === 'function') switchTab('profile');
        if (typeof showMiniNotice === 'function') {
            showMiniNotice('📝 填寫個人資料領取紅線', '完成基本資料並按下「保存」後，即可參加週二／四／六 20:00 月老牽線配對！');
        }
    } else {
        if (typeof handleApplyClick === 'function') handleApplyClick();
    }
}

function renderDailyFortuneCard(forceRender = false) {
    const bodyEl = document.getElementById('dailyFortuneCardBody');
    const dateBadge = document.getElementById('dailyFortuneDateBadge');
    if (!bodyEl) return;

    const today = getTaipeiTodayDateStr();
    const isSandbox = (typeof isLocalSandboxEnv === 'function' && isLocalSandboxEnv());
    if (dateBadge) {
        dateBadge.innerHTML = isSandbox
            ? `${today.slice(5).replace('-', '/')} 每日一籤 <button type="button" onclick="resetDailyFortuneForTest()" class="ml-1 px-1.5 py-0.5 rounded bg-teal-50 border border-teal-300 text-teal-800 text-[10px] font-bold hover:bg-teal-100">🧪 重抽</button>`
            : `${today.slice(5).replace('-', '/')} 每日一籤`;
    }

    const drawn = getSavedDailyFortune();
    const sig = drawn ? `drawn:${today}:${drawn.level}:${drawn.keyword}:${drawn.mbti}:${drawn.spot}:${drawn.matchCount}:${isSandbox}` : `undrawn:${today}:${isSandbox}`;
    if (!forceRender && bodyEl.dataset.sig === sig) return;
    bodyEl.dataset.sig = sig;

    if (!drawn) {
        bodyEl.innerHTML = `
            <div class="p-4 rounded-2xl bg-gradient-to-br from-pink-50/90 via-white to-rose-50/90 border border-dashed border-pink-300 text-center space-y-3 my-auto">
                <div class="w-16 h-16 mx-auto rounded-2xl bg-white border border-pink-200 shadow-inner flex items-center justify-center text-3xl">
                    🏮
                </div>
                <div class="space-y-1">
                    <h3 class="text-base font-bold font-serif-jp text-[#7a3542]">求一支今日的月老戀愛籤</h3>
                    <p class="text-xs text-gray-500 leading-relaxed">
                        誠心默念你的名字，看看今天月老為你準備了什麼緣分提示與契合人格！
                    </p>
                </div>
                <div class="pt-1">
                    <button type="button" onclick="drawTodayYuelaoFortune()" class="btn-sakura px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md tracking-wider">
                        ✨ 誠心抽今日戀愛籤
                    </button>
                </div>
            </div>
        `;
        return;
    }

    const matchCount = drawn.matchCount;
    const hasProfile = Boolean(typeof appState !== 'undefined' && appState && appState.playerId);
    const ctaText = hasProfile ? '🌸 去報名' : '📝 免費建檔領取紅線';

    bodyEl.innerHTML = `
        <div class="p-4 rounded-2xl bg-gradient-to-br from-rose-50/90 via-white to-pink-50/90 border border-pink-200/90 space-y-3 shadow-2xs">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-pink-100 pb-2.5">
                <span class="text-sm font-extrabold font-serif-jp text-[#8f4452]">${escapeFateWallHtml(drawn.level)}</span>
                <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-white border border-pink-200 text-[#c96a7b] font-bold">
                    #${escapeFateWallHtml(drawn.keyword)}
                </span>
            </div>

            <p class="text-xs sm:text-sm text-[#5e343c] font-serif-jp leading-relaxed bg-white/80 p-3 rounded-xl border border-pink-100/80">
                「${escapeFateWallHtml(drawn.poem)}」
            </p>

            <div class="grid grid-cols-2 gap-2 text-[11px]">
                <div class="p-2 rounded-xl bg-white/85 border border-pink-100">
                    <span class="text-gray-400 block">💞 今日契合人格</span>
                    <strong class="text-[#8f4452] font-bold">${escapeFateWallHtml(drawn.mbti)}（站內 ${matchCount} 人）</strong>
                </div>
                <div class="p-2 rounded-xl bg-white/85 border border-pink-100">
                    <span class="text-gray-400 block">📍 幸運相遇地點</span>
                    <strong class="text-[#8f4452] font-bold">${escapeFateWallHtml(drawn.spot)}</strong>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-2 pt-1">
                <button type="button" onclick="copyDailyFortuneShareText()" class="w-full py-2 px-3 rounded-xl bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50 text-xs font-bold transition whitespace-nowrap flex items-center justify-center">
                    📋 分享籤詩
                </button>
                <button type="button" onclick="handleFortuneCtaClick()" class="w-full btn-sakura py-2 px-3 rounded-xl text-xs font-bold shadow-sm whitespace-nowrap flex items-center justify-center">
                    ${ctaText}
                </button>
            </div>
        </div>
    `;
}

function getSavedDailyLovePollVote(dateStr, pollId) {
    try {
        const raw = localStorage.getItem(DAILY_LOVE_POLL_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.dateStr === dateStr && parsed.pollId === pollId && (parsed.choice === 'A' || parsed.choice === 'B')) {
            return parsed;
        }
    } catch (e) {}
    return null;
}

function makeDailyPollStatKey(dateStr, pollId) {
    return `${String(dateStr).replace(/[^0-9-]/g, '')}_${String(pollId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function normalizePollCounts(rawObj) {
    const obj = (rawObj && typeof rawObj === 'object') ? rawObj : {};
    return {
        mA: Math.max(0, Number(obj.mA || 0)),
        mB: Math.max(0, Number(obj.mB || 0)),
        fA: Math.max(0, Number(obj.fA || 0)),
        fB: Math.max(0, Number(obj.fB || 0))
    };
}

async function fetchDailyPollCloudCounts(dateStr, pollId, forceRefresh = false) {
    const statKey = makeDailyPollStatKey(dateStr, pollId);
    if (!forceRefresh && dailyPollCloudCountsCache[statKey]) {
        return dailyPollCloudCountsCache[statKey];
    }
    if (dailyPollInFlightKeys.has(statKey)) {
        return dailyPollCloudCountsCache[statKey] || null;
    }
    if (typeof CloudSync === 'undefined' || CloudSync.isLocalSandboxMode() || !CloudSync.dbUrl) {
        return dailyPollCloudCountsCache[statKey] || null;
    }

    dailyPollInFlightKeys.add(statKey);
    try {
        if (!CloudSync.initialized && typeof yuelaoAuth !== 'undefined' && typeof yuelaoAuth.init === 'function') {
            await yuelaoAuth.init().catch(() => {});
        }
        const encodedPath = CloudSync.encodePath(`${DAILY_POLL_CLOUD_BASE_PATH}/${statKey}`);
        const res = await fetch(`${CloudSync.dbUrl}/${encodedPath}.json${CloudSync.authQuery()}`, {
            method: 'GET',
            cache: 'no-store'
        });
        if (!res.ok) return dailyPollCloudCountsCache[statKey] || null;
        const data = await res.json();
        const normalized = normalizePollCounts(data);
        dailyPollCloudCountsCache[statKey] = normalized;
        return normalized;
    } catch (e) {
        return dailyPollCloudCountsCache[statKey] || null;
    } finally {
        dailyPollInFlightKeys.delete(statKey);
    }
}

async function incrementDailyPollCloudVote(dateStr, pollId, gender, choice) {
    const statKey = makeDailyPollStatKey(dateStr, pollId);
    const fieldName = (gender === '男' ? 'm' : 'f') + (choice === 'A' ? 'A' : 'B');

    // 先樂觀更新本地記憶體快取，確保使用者點選後 0ms 立即看到票數+1
    const prevLocal = normalizePollCounts(dailyPollCloudCountsCache[statKey]);
    prevLocal[fieldName] = prevLocal[fieldName] + 1;
    dailyPollCloudCountsCache[statKey] = prevLocal;

    if (typeof CloudSync === 'undefined' || CloudSync.isLocalSandboxMode() || !CloudSync.dbUrl) {
        return prevLocal;
    }

    try {
        if (!CloudSync.initialized && typeof yuelaoAuth !== 'undefined' && typeof yuelaoAuth.init === 'function') {
            await yuelaoAuth.init().catch(() => {});
        }
        const encodedPath = CloudSync.encodePath(`${DAILY_POLL_CLOUD_BASE_PATH}/${statKey}`);
        const patchPayload = {
            [fieldName]: { '.sv': { increment: 1 } },
            updatedAt: Date.now()
        };
        const res = await fetch(`${CloudSync.dbUrl}/${encodedPath}.json${CloudSync.authQuery()}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchPayload)
        });
        if (res.ok) {
            // 寫入成功後讀取最新全站票數（僅 ~45 Bytes），確保畫面顯示全站最新總票數
            const freshCounts = await fetchDailyPollCloudCounts(dateStr, pollId, true);
            if (freshCounts) {
                renderDailyLovePollCard(true);
                return freshCounts;
            }
        }
    } catch (e) {}
    return prevLocal;
}

function submitDailyLovePollVote(choice) {
    if (choice !== 'A' && choice !== 'B') return;
    const { dateStr, poll } = getTodayPollObject();
    let voterGender = '';
    if (typeof appState !== 'undefined' && appState && appState.profile && (appState.profile.gender === '男' || appState.profile.gender === '女')) {
        voterGender = appState.profile.gender;
    } else {
        const sel = document.querySelector('input[name="dailyPollGuestGender"]:checked');
        voterGender = sel ? sel.value : '女';
    }
    try {
        localStorage.setItem(DAILY_LOVE_POLL_STORAGE_KEY, JSON.stringify({
            dateStr,
            pollId: poll.id,
            choice,
            gender: voterGender,
            votedAt: Date.now()
        }));
    } catch (e) {}

    // 立即寫入 Firebase 原子遞增並重繪畫面
    incrementDailyPollCloudVote(dateStr, poll.id, voterGender, choice);
    renderDailyLovePollCard(true);
}

function resetDailyLovePollForTest(nextQuestion = false) {
    try {
        localStorage.removeItem(DAILY_LOVE_POLL_STORAGE_KEY);
    } catch (e) {}
    if (nextQuestion) {
        dailyLovePollTestOffset = (dailyLovePollTestOffset + 1) % YUELAO_DAILY_LOVE_POLLS.length;
    }
    renderDailyLovePollCard(true);
}

function computePollDisplayPercentages(poll, counts) {
    const c = normalizePollCounts(counts);
    const totalVotes = c.mA + c.mB + c.fA + c.fB;
    const isPureReal = totalVotes >= DAILY_POLL_REAL_THRESHOLD;

    if (isPureReal) {
        // 累積滿 10 票後，100% 純真實站內投票比例
        const fTot = c.fA + c.fB;
        const mTot = c.mA + c.mB;
        const fA = fTot > 0 ? Math.round((c.fA / fTot) * 100) : 50;
        const mA = mTot > 0 ? Math.round((c.mA / mTot) * 100) : 50;
        return {
            fA,
            fB: 100 - fA,
            mA,
            mB: 100 - mA,
            totalVotes,
            isPureReal: true
        };
    }

    // 未滿 10 人（< 10 票）：隱藏具體百分比，顯示 A ??% ／ B ??%
    return {
        fA: null,
        fB: null,
        mA: null,
        mB: null,
        totalVotes,
        isPureReal: false
    };
}

function renderDailyLovePollCard(forceRender = false) {
    const bodyEl = document.getElementById('dailyLovePollBody');
    const badgeEl = document.getElementById('dailyPollBadge');
    if (!bodyEl) return;

    const { dateStr, poll } = getTodayPollObject();
    const savedVote = getSavedDailyLovePollVote(dateStr, poll.id);
    const hasProfile = Boolean(typeof appState !== 'undefined' && appState && appState.playerId);
    const profileGender = (hasProfile && appState.profile && (appState.profile.gender === '男' || appState.profile.gender === '女'))
        ? appState.profile.gender
        : '';
    const isSandbox = (typeof isLocalSandboxEnv === 'function' && isLocalSandboxEnv());
    const statKey = makeDailyPollStatKey(dateStr, poll.id);
    const cachedCounts = dailyPollCloudCountsCache[statKey] || null;

    // 若今天已投過票但記憶體尚未載入雲端總票數，背景讀取一次（僅 ~45 Bytes）
    if (!cachedCounts && !dailyPollInFlightKeys.has(statKey)) {
        fetchDailyPollCloudCounts(dateStr, poll.id, false).then(fetched => {
            if (fetched) renderDailyLovePollCard(true);
        });
    }

    const countsSig = cachedCounts ? `${cachedCounts.mA},${cachedCounts.mB},${cachedCounts.fA},${cachedCounts.fB}` : 'none';
    const realTotalVotes = cachedCounts ? (cachedCounts.mA + cachedCounts.mB + cachedCounts.fA + cachedCounts.fB) : 0;
    const voteCountBadgeHtml = realTotalVotes >= 15
        ? `<span class="mr-1.5 px-2 py-0.5 rounded-full bg-rose-50 border border-pink-200 text-[#8f4452] text-[10px] font-bold">已投票 ${realTotalVotes + 20} 人</span>`
        : '';
    if (badgeEl) {
        if (isSandbox) {
            badgeEl.innerHTML = `${voteCountBadgeHtml}${savedVote ? '✅ 已投票' : '免建檔投票'} <button type="button" onclick="resetDailyLovePollForTest(false)" class="ml-1 px-1.5 py-0.5 rounded bg-teal-50 border border-teal-300 text-teal-800 text-[10px] font-bold hover:bg-teal-100">🧪 重選</button><button type="button" onclick="resetDailyLovePollForTest(true)" class="ml-1 px-1.5 py-0.5 rounded bg-teal-50 border border-teal-300 text-teal-800 text-[10px] font-bold hover:bg-teal-100">換題</button>`;
        } else {
            badgeEl.innerHTML = `${voteCountBadgeHtml}${savedVote ? '✅ 已投票' : '免建檔即時投票'}`;
        }
    }

    const sig = `${dateStr}|${poll.id}|${savedVote ? savedVote.choice + ':' + savedVote.gender : 'none'}|${profileGender}|${isSandbox}|${countsSig}`;
    if (!forceRender && bodyEl.dataset.sig === sig) return;
    bodyEl.dataset.sig = sig;

    if (!savedVote) {
        const genderSelectorHtml = profileGender
            ? `<div class="text-[11px] text-gray-500">將以你的檔案性別（<strong class="text-[#8f4452]">${profileGender}生</strong>）計入即時比例</div>`
            : `<div class="flex items-center justify-between gap-2 text-[11px] bg-pink-50/70 px-3 py-1.5 rounded-xl border border-pink-100">
                   <span class="text-gray-500 font-medium">你的立場身分：</span>
                   <div class="flex items-center gap-3 font-bold text-[#8f4452]">
                       <label class="inline-flex items-center gap-1 cursor-pointer">
                           <input type="radio" name="dailyPollGuestGender" value="女" checked class="accent-[#c96a7b]"> 🎀 女生
                       </label>
                       <label class="inline-flex items-center gap-1 cursor-pointer">
                           <input type="radio" name="dailyPollGuestGender" value="男" class="accent-[#c96a7b]"> ⚾ 男生
                       </label>
                   </div>
               </div>`;

        bodyEl.innerHTML = `
            <div class="space-y-3">
                <h3 class="text-sm sm:text-base font-bold font-serif-jp text-[#6e3a43] leading-snug">
                    Q：${escapeFateWallHtml(poll.q)}
                </h3>
                ${genderSelectorHtml}
                <div class="space-y-2 pt-0.5">
                    <button type="button" onclick="submitDailyLovePollVote('A')" class="w-full text-left p-3 rounded-2xl bg-white hover:bg-pink-50/80 border border-pink-200 hover:border-[#c96a7b] transition flex items-start gap-2.5 group">
                        <span class="w-6 h-6 rounded-full bg-pink-100 text-[#8f4452] font-bold text-xs flex items-center justify-center shrink-0 group-hover:bg-[#c96a7b] group-hover:text-white transition">A</span>
                        <span class="text-xs sm:text-sm text-gray-700 font-medium leading-relaxed">${escapeFateWallHtml(poll.optA)}</span>
                    </button>
                    <button type="button" onclick="submitDailyLovePollVote('B')" class="w-full text-left p-3 rounded-2xl bg-white hover:bg-pink-50/80 border border-pink-200 hover:border-[#c96a7b] transition flex items-start gap-2.5 group">
                        <span class="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold text-xs flex items-center justify-center shrink-0 group-hover:bg-[#c96a7b] group-hover:text-white transition">B</span>
                        <span class="text-xs sm:text-sm text-gray-700 font-medium leading-relaxed">${escapeFateWallHtml(poll.optB)}</span>
                    </button>
                </div>
            </div>
            <p class="text-[11px] text-gray-400 text-right">點選選項後，立即揭曉全站男／女真實想法比例 ✨</p>
        `;
        return;
    }

    const stats = computePollDisplayPercentages(poll, cachedCounts);
    const displayVoteCount = Math.max(1, stats.totalVotes);
    const genderTagText = `${escapeFateWallHtml(savedVote.gender)}生,已選擇`;
    const isChosenA = savedVote.choice === 'A';
    const isChosenB = savedVote.choice === 'B';

    const femalePctText = stats.isPureReal ? `A ${stats.fA}% ／ B ${stats.fB}%` : 'A ??% ／ B ??%';
    const malePctText = stats.isPureReal ? `A ${stats.mA}% ／ B ${stats.mB}%` : 'A ??% ／ B ??%';
    const femaleBarHtml = stats.isPureReal
        ? `<div class="w-full h-2.5 rounded-full bg-amber-100 overflow-hidden flex">
               <div class="h-full bg-gradient-to-r from-pink-400 to-rose-500 transition-all duration-500" style="width: ${stats.fA}%"></div>
           </div>`
        : `<div class="w-full h-2.5 rounded-full bg-pink-100/80 overflow-hidden flex items-center justify-center">
               <div class="w-full h-full bg-gradient-to-r from-pink-200 via-rose-200 to-pink-200 opacity-70"></div>
           </div>`;
    const maleBarHtml = stats.isPureReal
        ? `<div class="w-full h-2.5 rounded-full bg-amber-100 overflow-hidden flex">
               <div class="h-full bg-gradient-to-r from-sky-400 to-blue-500 transition-all duration-500" style="width: ${stats.mA}%"></div>
           </div>`
        : `<div class="w-full h-2.5 rounded-full bg-sky-100/80 overflow-hidden flex items-center justify-center">
               <div class="w-full h-full bg-gradient-to-r from-sky-200 via-blue-200 to-sky-200 opacity-70"></div>
           </div>`;

    const statusBannerHtml = stats.isPureReal
        ? ''
        : `<div class="px-3 py-2 rounded-xl bg-amber-50/75 border border-amber-200 text-[11px] text-amber-900 font-semibold text-center">
               🔮 待投票數量滿 ${DAILY_POLL_REAL_THRESHOLD} 人後顯示結果（目前已有 ${displayVoteCount} 人參與）
           </div>`;

    bodyEl.innerHTML = `
        <div class="space-y-3">
            <h3 class="text-sm sm:text-base font-bold font-serif-jp text-[#6e3a43] leading-snug">
                Q：${escapeFateWallHtml(poll.q)}
            </h3>

            <div class="space-y-1.5 text-xs">
                <div class="p-2.5 rounded-xl border ${isChosenA ? 'bg-rose-50/90 border-[#c96a7b] text-[#7a3542] font-bold shadow-2xs' : 'bg-white/75 border-pink-100 text-gray-500'}">
                    A. ${escapeFateWallHtml(poll.optA)}${isChosenA ? ` <span class="text-[#c96a7b] font-extrabold">(${genderTagText})</span>` : ''}
                </div>
                <div class="p-2.5 rounded-xl border ${isChosenB ? 'bg-rose-50/90 border-[#c96a7b] text-[#7a3542] font-bold shadow-2xs' : 'bg-white/75 border-pink-100 text-gray-500'}">
                    B. ${escapeFateWallHtml(poll.optB)}${isChosenB ? ` <span class="text-[#c96a7b] font-extrabold">(${genderTagText})</span>` : ''}
                </div>
            </div>

            ${statusBannerHtml}

            <div class="space-y-2.5 text-xs">
                <div class="p-3 rounded-2xl bg-white/90 border border-pink-100 space-y-1.5">
                    <div class="flex items-center justify-between font-bold text-rose-700">
                        <span>🎀 女生立場分布</span>
                        <span>${femalePctText}</span>
                    </div>
                    ${femaleBarHtml}
                </div>

                <div class="p-3 rounded-2xl bg-white/90 border border-pink-100 space-y-1.5">
                    <div class="flex items-center justify-between font-bold text-sky-700">
                        <span>⚾ 男生立場分布</span>
                        <span>${malePctText}</span>
                    </div>
                    ${maleBarHtml}
                </div>
            </div>
        </div>

        <div class="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onclick="if(typeof switchTab==='function') switchTab('forum');" class="w-full py-2 px-3 rounded-xl bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50 text-xs font-bold transition whitespace-nowrap flex items-center justify-center">
                🔥 看大家怎麼聊
            </button>
            <button type="button" onclick="handleFortuneCtaClick()" class="w-full btn-sakura py-2 px-3 rounded-xl text-xs font-bold shadow-sm whitespace-nowrap flex items-center justify-center">
                🌸 去報名
            </button>
        </div>
    `;
}

window.drawTodayYuelaoFortune = drawTodayYuelaoFortune;
window.resetDailyFortuneForTest = resetDailyFortuneForTest;
window.copyDailyFortuneShareText = copyDailyFortuneShareText;
window.handleFortuneCtaClick = handleFortuneCtaClick;
window.renderDailyFortuneCard = renderDailyFortuneCard;
window.submitDailyLovePollVote = submitDailyLovePollVote;
window.resetDailyLovePollForTest = resetDailyLovePollForTest;
window.renderDailyLovePollCard = renderDailyLovePollCard;
