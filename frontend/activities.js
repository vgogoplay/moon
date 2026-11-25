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
        applyBtn.textContent = `✅ 已報名【${currentBatchSessions.join('、')}】（點此修改）`;
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
                        <button type="button" disabled class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg bg-gray-200 text-gray-400 cursor-not-allowed">
                            ⚠️ ${act.name}（警告帳號不提供配對）
                        </button>
                    `;
                }
                if (schedState.status === 'upcoming') {
                    return `
                        <button type="button" disabled class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg bg-gray-100 border border-gray-300 text-gray-500 cursor-not-allowed">
                            ⏳ 尚未開始【${act.name}】（${formatShortDateTime(schedState.startTs)} 開放）
                        </button>
                    `;
                }
                if (schedState.status === 'waiting_match') {
                    if (isReg) {
                        return `
                            <button type="button" disabled class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg bg-amber-100 border border-amber-300 text-amber-900 cursor-not-allowed">
                                ⌛ 已報名【${act.name}】（等待 ${schedState.matchText || '配對時間'} 開獎）
                            </button>
                        `;
                    }
                    return `
                        <button type="button" disabled class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg bg-gray-100 border border-gray-300 text-gray-400 cursor-not-allowed">
                            🔒【${act.name}】報名已截止（${schedState.matchText || ''} 配對）
                        </button>
                    `;
                }
                if (schedState.status === 'matched') {
                    if (matchedItem) {
                        return `
                            <button type="button" onclick="handleCustomActivityClick('${act.id}')" class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg shadow-lg tracking-wider bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-95 transition">
                                💘【${act.name}】配對成功！前往好友聊天
                            </button>
                        `;
                    }
                    if (isReg) {
                        return `
                            <button type="button" disabled class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg bg-gray-100 border border-gray-300 text-gray-500 cursor-not-allowed">
                                🍃【${act.name}】已開獎（本次未配對成功）
                            </button>
                        `;
                    }
                    return `
                        <button type="button" disabled class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg bg-gray-100 border border-gray-300 text-gray-400 cursor-not-allowed">
                            ⏰【${act.name}】活動已結束
                        </button>
                    `;
                }

                if (isReg) {
                    return `
                        <button type="button" onclick="handleCustomActivityClick('${act.id}')" class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg shadow-lg tracking-wider bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:opacity-95 transition">
                            ✅ 已報名【${act.name}】（點此查看 / 取消）
                        </button>
                    `;
                }
                return `
                    <button type="button" onclick="handleCustomActivityClick('${act.id}')" class="px-8 py-4 rounded-2xl font-bold text-base md:text-lg shadow-lg tracking-wider bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 text-white hover:opacity-95 transition">
                        🎪 報名【${act.name}】
                    </button>
                `;
            }).join('');

            const statusLines = openCustomActs.map(act => {
                const actType = act.activityType || 'classic';
                const reg = myCustomRegs[act.id];
                const schedState = getCustomActivityScheduleState(act);
                const matchedItem = (meUserRec && Array.isArray(meUserRec.matchedHistory))
                    ? meUserRec.matchedHistory.find(h => String(h.activityId || '') === String(act.id) || String(h.session || '') === String(act.name))
                    : null;

                const timeTag = schedState.hasSchedule
                    ? `<br><span class="text-[11px] text-[#8f4452] font-semibold">⏰ 活動時間：${schedState.windowText || '不限'}${schedState.matchText ? ` ｜ 💘 配對時間：${schedState.matchText}` : ''}</span>`
                    : '';

                if (schedState.status === 'matched') {
                    if (matchedItem) {
                        return `💘 專屬活動 <strong>【${act.name}】</strong> 配對成功！你已與 <strong>${matchedItem.partnerName}</strong> 成為好友，請至「好友名單」開啟對話！${timeTag}`;
                    }
                    if (reg) {
                        return `🍃 專屬活動 <strong>【${act.name}】</strong> 已完成配對結算（本次未配對成功，未加入好友名單）。${timeTag}`;
                    }
                    return `⏰ 專屬活動 <strong>【${act.name}】</strong> 報名已截止並完成配對結算。${timeTag}`;
                }

                if (schedState.status === 'waiting_match') {
                    if (reg) {
                        return `⌛ 已報名專屬活動 <strong>【${act.name}】</strong>（報名已於 ${formatShortDateTime(schedState.endTs)} 截止，將於 <strong>${schedState.matchText}</strong> 準時配對，配對成功才會加入好友）。${timeTag}`;
                    }
                    return `🔒 專屬活動 <strong>【${act.name}】</strong> 已於 ${formatShortDateTime(schedState.endTs)} 截止報名，將於 <strong>${schedState.matchText}</strong> 進行配對。${timeTag}`;
                }

                if (schedState.status === 'upcoming') {
                    const descTxt = act.description ? ` — ${act.description}` : '';
                    return `⏳ 專屬活動 <strong>【${act.name}】</strong> 即將於 <strong>${formatShortDateTime(schedState.startTs)}</strong> 開放報名${descTxt}${timeTag}`;
                }

                if (reg) {
                    if (actType === 'fortune_number' && reg.fortuneNumber) {
                        return `✅ 已報名專屬活動 <strong>【${act.name}】</strong>（月老籤詩已選：<strong>第 ${reg.fortuneNumber} 首</strong>，同號碼配對）${timeTag}`;
                    }
                    if (actType === 'two_choice' && reg.twoChoiceValue) {
                        return `✅ 已報名專屬活動 <strong>【${act.name}】</strong>（默契大考驗二選一已選：<strong>「${reg.twoChoiceValue}」</strong>）${timeTag}`;
                    }
                    const cSummary = formatCriteriaSummaryText(reg.exactMatchCriteria || {}, reg.mustMatchKeys || []);
                    return `✅ 已報名專屬活動 <strong>【${act.name}】</strong>（配對條件：<strong>${cSummary}</strong>）${timeTag}`;
                }
                const typeHint = actType === 'fortune_number'
                    ? '（月老籤詩請選擇1~5首號碼）'
                    : (actType === 'two_choice' ? `（默契大考驗二選一：${act.optionA || ''} / ${act.optionB || ''}）` : '');
                const descTxt = act.description ? ` — ${act.description}` : '';
                return `🎪 專屬活動 <strong>【${act.name}】</strong> 開放報名中${typeHint}${descTxt}${timeTag}`;
            });

            customAlertBox.classList.remove('hidden');
            customAlertBox.innerHTML = `
                <div class="text-xs space-y-2">
                    <p class="font-bold text-[#8f4452]">✨ 獨立專屬活動通知（與上方週二／週四／週六場次互不影響）：</p>
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
    renderFriendsSection();
}
