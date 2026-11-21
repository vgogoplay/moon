/* frontend/wishes.js - 紅線祈願牆（男女皆可發起 N 題 2 選 1・男生每日限3位 20:00 重置・女生不限・提出後需等結束才能再新增） */

let wishDraftTitle = '';
let wishDraftOpenDays = 3;
let expandedPublicWishes = new Set();
let expandedWishAnonLists = new Set();
let expandedMyActiveWish = false;
let isEditingMyActiveWish = false;
let editMyWishId = '';
let editMyWishTitle = '';
let editMyWishQuestions = [];
let wishPublicListPage = 1;
let wishPastHistoryPage = 1;
let wishPublicGenderFilter = 'ALL';
const WISH_PUBLIC_PER_PAGE = 5;
const WISH_PAST_PER_PAGE = 5;
const WISH_PAST_MAX_RECORDS = 5;
const WISH_MIN_OPEN_DAYS = 3;
const WISH_MAX_OPEN_DAYS = 7;
const WISH_MAX_EXTRA_QUESTIONS = 4;
let wishDraftQuestions = [
    { question: '', optionA: '', optionB: '' }
];
let isWishCreatorFormOpen = false;
let wishDraftSelections = {}; // { [wishId]: { [qIndex]: 'A' | 'B' } }
let wishDraftNotes = {};      // { [wishId]: string }
let lastWishWallRenderSig = '';

function togglePublicWishExpand(wishId) {
    const wid = String(wishId || '').trim();
    const willExpand = !expandedPublicWishes.has(wid);
    if (willExpand) {
        expandedPublicWishes.add(wid);
    } else {
        expandedPublicWishes.delete(wid);
    }
    lastWishWallRenderSig = '';
    renderWishWallTab(true);

    if (willExpand && wid) {
        requestAnimationFrame(() => {
            setTimeout(() => {
                const cardEl = document.getElementById(`publicWishCard_${wid}`);
                if (!cardEl) return;
                const rect = cardEl.getBoundingClientRect();
                const topHeaderSafe = 84;
                const bottomNavSafe = 104;
                const visibleBottom = window.innerHeight - bottomNavSafe;
                if (rect.bottom > visibleBottom) {
                    const maxScrollDown = Math.max(0, rect.top - topHeaderSafe);
                    const neededScroll = rect.bottom - visibleBottom + 24;
                    const delta = Math.min(maxScrollDown, neededScroll);
                    if (delta > 0) {
                        window.scrollBy({ top: delta, behavior: 'smooth' });
                    }
                }
            }, 40);
        });
    }
}

function toggleWishAnonListExpand(wishId) {
    const wid = String(wishId || '').trim();
    if (!wid) return;
    if (expandedWishAnonLists.has(wid)) {
        expandedWishAnonLists.delete(wid);
    } else {
        expandedWishAnonLists.add(wid);
    }
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
}

function toggleMyActiveWishExpand() {
    if (isEditingMyActiveWish && expandedMyActiveWish) {
        return;
    }
    expandedMyActiveWish = !expandedMyActiveWish;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
}

function openEditMyActiveWish(wishId = '') {
    const myPid = appState && appState.playerId ? String(appState.playerId).trim() : '';
    if (!myPid) return;
    const wishes = (typeof Store !== 'undefined' && typeof Store.getWishWallPosts === 'function')
        ? Store.getWishWallPosts()
        : [];
    const nowTs = Date.now();
    const target = wishes.find(w =>
        String(w.authorId) === myPid &&
        !isWishWallEnded(w, nowTs) &&
        (!wishId || String(w.id) === String(wishId).trim())
    );
    if (!target) {
        showMiniNotice('⏳ 無法編輯', '目前沒有進行中的祈願題目可編輯喔！');
        return;
    }

    isEditingMyActiveWish = true;
    editMyWishId = String(target.id);
    editMyWishTitle = String(target.title || '');
    editMyWishQuestions = (target.questions || []).map((q, idx) => ({
        qIndex: Number(q.qIndex || (idx + 1)),
        question: String(q.question || ''),
        optionA: String(q.optionA || ''),
        optionB: String(q.optionB || '')
    }));
    expandedMyActiveWish = true;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);

    const card = document.getElementById('myActiveWishCard');
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstInput = card.querySelector('input[type="text"]');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 160);
        }
    }
}

function cancelEditMyActiveWish() {
    isEditingMyActiveWish = false;
    editMyWishId = '';
    editMyWishTitle = '';
    editMyWishQuestions = [];
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
}

function onEditMyWishTitleInput(val) {
    editMyWishTitle = String(val || '');
}

function onEditMyWishQuestionFieldInput(idx, field, val) {
    if (!editMyWishQuestions[idx]) return;
    if (field !== 'question' && field !== 'optionA' && field !== 'optionB') return;
    editMyWishQuestions[idx][field] = String(val || '');
}

async function saveEditedMyActiveWish(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    const myPid = appState && appState.playerId ? String(appState.playerId).trim() : '';
    if (!myPid || !editMyWishId) return;

    const wishes = (typeof Store !== 'undefined' && typeof Store.getWishWallPosts === 'function')
        ? Store.getWishWallPosts()
        : [];
    const target = wishes.find(w => String(w.id) === editMyWishId && String(w.authorId) === myPid);
    if (!target) {
        cancelEditMyActiveWish();
        return;
    }

    if (isWishWallEnded(target, Date.now())) {
        showMiniNotice('⏳ 題目已結束', '這則祈願題目已經結束，無法再編輯內容囉！');
        cancelEditMyActiveWish();
        return;
    }

    const updatedQuestions = [];
    for (let i = 0; i < editMyWishQuestions.length; i++) {
        const item = editMyWishQuestions[i] || {};
        const qText = String(item.question || '').trim();
        const optA = String(item.optionA || '').trim();
        const optB = String(item.optionB || '').trim();
        if (!qText || !optA || !optB) {
            showMiniNotice('✍️ 請填寫完整題目', `請將第 ${i + 1} 題的「題目內容」與「兩個選項」都填寫完整喔！`);
            return;
        }
        if (optA === optB) {
            showMiniNotice('⚠️ 選項不能相同', `第 ${i + 1} 題的兩個選項不能完全相同喔！`);
            return;
        }
        updatedQuestions.push({
            qIndex: i + 1,
            question: qText,
            optionA: optA,
            optionB: optB
        });
    }

    const nextTitle = String(editMyWishTitle || '').trim() || updatedQuestions[0].question;

    // 禁止關鍵字檢查
    if (typeof Store !== 'undefined' && typeof Store.checkProfileBanned === 'function') {
        const combinedCheckText = [nextTitle, ...updatedQuestions.map(q => `${q.question} ${q.optionA} ${q.optionB}`)].join(' ');
        const hitRule = Store.checkProfileBanned({ bio: combinedCheckText, nickname: nextTitle });
        if (hitRule) {
            showMiniNotice('🚫 內容包含受限制字眼', '祈願題目或選項包含系統限制的字眼，請修改後再儲存。');
            return;
        }
    }

    target.title = nextTitle;
    target.questions = updatedQuestions;

    localStorage.setItem(WISH_WALL_KEY, JSON.stringify(wishes));
    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        await CloudSync.patchNode(`${WISH_WALL_KEY}/${target.id}`, {
            title: nextTitle,
            questions: updatedQuestions
        });
    }

    isEditingMyActiveWish = false;
    editMyWishId = '';
    editMyWishTitle = '';
    editMyWishQuestions = [];
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    showMiniNotice('✅ 祈願題目已更新！', '你的祈願文字標題與二選一選項內容已同步更新。');
}

function onWishPublicGenderFilterChange(val) {
    const cleanVal = ['ALL', '男', '女'].includes(String(val || '').trim()) ? String(val || '').trim() : 'ALL';
    wishPublicGenderFilter = cleanVal;
    wishPublicListPage = 1;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
}

function goToWishPublicPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    wishPublicListPage = p;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
}

function goToWishPastPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    wishPastHistoryPage = p;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
}

function escapeWishHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatWishShortDateTime(ts) {
    const num = Number(ts || 0);
    if (!num || Number.isNaN(num)) return '';
    const d = new Date(num);
    if (Number.isNaN(d.getTime())) return '';
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${min}`;
}

function hasCompletedWishWallProfile() {
    const pid = appState && appState.playerId ? String(appState.playerId).trim() : '';
    if (!pid) return false;
    if (typeof isProfileComplete === 'function' && isProfileComplete()) return true;
    const g = String((appState.profile && appState.profile.gender) || '').trim();
    return g === '男' || g === '女';
}

function resolveWishWallUserGender() {
    const pid = appState && appState.playerId ? String(appState.playerId).trim() : '';
    const g = String((appState.profile && appState.profile.gender) || '').trim();
    if (g === '男' || g === '女') return g;
    if (pid.startsWith('2')) return '女';
    if (pid.startsWith('1')) return '男';
    return '';
}

function focusWishCreatorForm() {
    isWishCreatorFormOpen = true;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    const card = document.getElementById('wishCreatorFormCard');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const firstInput = card.querySelector('input[type="text"]');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 200);
    }
}

function closeWishCreatorForm() {
    isWishCreatorFormOpen = false;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
}

function handleHeaderAddWishClick() {
    if (!hasCompletedWishWallProfile()) {
        showMiniNotice('📝 請先完成個人資料', '請先前往「個人與隱私」分頁填寫並保存基本資料，才能新增祈願題目喔！');
        switchTab('profile');
        return;
    }
    if (appState.isWarnedAccount) {
        showMiniNotice('⚠️ 無法發起祈願', '目前警告帳號不提供發起祈願與配對功能。');
        return;
    }
    const myGender = resolveWishWallUserGender();
    if (myGender !== '男' && myGender !== '女') {
        showMiniNotice('📝 請先確認性別資料', '請先於「個人與隱私」設定性別（男 / 女）後再發起祈願題目喔！');
        switchTab('profile');
        return;
    }

    const myPid = String(appState.playerId || '').trim();
    const allWishes = (typeof Store !== 'undefined' && typeof Store.getWishWallPosts === 'function')
        ? Store.getWishWallPosts()
        : [];
    const nowTs = Date.now();

    const existingActive = allWishes.find(w => String(w.authorId) === myPid && !isWishWallEnded(w, nowTs));
    if (existingActive) {
        showMiniNotice('⏳ 已有進行中的祈願', '提出問題後，需等目前問題結束或自行關閉後，才能再新增下一個題目喔！');
        const activeCard = document.getElementById('myActiveWishCard');
        if (activeCard) {
            activeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    if (myGender === '男') {
        const maleQuota = getMaleWishDailyQuotaStatus(allWishes, nowTs);
        if (maleQuota.isFull) {
            const resetTimeLabel = formatWishShortDateTime(maleQuota.resetAtTs);
            showMiniNotice(
                `⏳ 今日新增名額已滿（${maleQuota.usedCount} / ${maleQuota.limit} 位）`,
                `每天僅限 3 位新增祈願題目，今日名額已滿！\n將於 ${resetTimeLabel}（20:00）重置次數後才可再新增喔。`
            );
            return;
        }
    }

    isWishCreatorFormOpen = true;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    const card = document.getElementById('wishCreatorFormCard');
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstInput = card.querySelector('input[type="text"]');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 180);
        }
    }
}

async function refreshWishWallManual() {
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.fetchPlayerPaths === 'function' && CloudSync.inFlightWrites === 0) {
        await CloudSync.fetchPlayerPaths([WISH_WALL_KEY]);
    }
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    updateWishNavBadge();
}

function updateWishNavBadge() {
    const dotEl = document.getElementById('navWishDot');
    if (!dotEl) return;
    const myPid = appState && appState.playerId ? String(appState.playerId).trim() : '';
    const myGender = resolveWishWallUserGender();
    if (!myPid || (myGender !== '男' && myGender !== '女')) {
        dotEl.classList.add('hidden');
        return;
    }
    const wishes = (typeof Store !== 'undefined' && typeof Store.getWishWallPosts === 'function')
        ? Store.getWishWallPosts()
        : [];
    const nowTs = Date.now();
    const hasPendingSelection = wishes.some(w =>
        w && String(w.authorId) === myPid &&
        isWishWallEnded(w, nowTs) &&
        !w.settled &&
        Array.isArray(w.responses) && w.responses.length > 0
    );
    dotEl.classList.toggle('hidden', !hasPendingSelection);
}

// ==================== 女性玩家草稿表單互動（新增／刪除 2 選 1 題目） ====================
function onWishDraftTitleInput(val) {
    wishDraftTitle = String(val || '');
}

function onWishDraftDaysChange(val) {
    const n = Math.max(WISH_MIN_OPEN_DAYS, Math.min(WISH_MAX_OPEN_DAYS, parseInt(val, 10) || WISH_MIN_OPEN_DAYS));
    wishDraftOpenDays = n;
    const previewEl = document.getElementById('wishDraftExpiryPreview');
    if (previewEl) {
        const expTs = calcWishExpiresAtTs(Date.now(), n);
        previewEl.textContent = `預計將於 ${formatWishShortDateTime(expTs)} 結束（以每日 20:00 計算 ${n} 天）`;
    }
}

function onWishDraftQuestionFieldInput(idx, field, val) {
    if (!wishDraftQuestions[idx]) return;
    wishDraftQuestions[idx][field] = String(val || '');
}

function addWishDraftQuestionRow() {
    const addedCount = Math.max(0, wishDraftQuestions.length - 1);
    if (addedCount >= WISH_MAX_EXTRA_QUESTIONS) {
        showMiniNotice('🏮 題數上限提醒', `「新增一題 2 選 1」最多只能新增 ${WISH_MAX_EXTRA_QUESTIONS} 次（共 ${WISH_MAX_EXTRA_QUESTIONS + 1} 題）喔！`);
        return;
    }
    wishDraftQuestions.push({ question: '', optionA: '', optionB: '' });
    renderWishWallTab(true);
}

function removeWishDraftQuestionRow(idx) {
    if (wishDraftQuestions.length <= 1) {
        showMiniNotice('🏮 保留題目提醒', '至少需保留 1 題二選一題目喔！');
        return;
    }
    wishDraftQuestions.splice(idx, 1);
    renderWishWallTab(true);
}

async function submitCreateWishPost(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    if (!hasCompletedWishWallProfile()) {
        showMiniNotice('📝 請先完成個人資料', '請先前往「個人與隱私」分頁填寫並保存基本資料，再使用紅線祈願牆喔！');
        switchTab('profile');
        return;
    }
    if (appState.isWarnedAccount) {
        showMiniNotice('⚠️ 無法發起祈願', '目前警告帳號不提供發起祈願與配對功能。');
        return;
    }
    const myGender = resolveWishWallUserGender();
    if (myGender !== '男' && myGender !== '女') {
        showMiniNotice('📝 請先確認性別資料', '請先於「個人與隱私」設定性別（男 / 女）後再發起祈願題目喔！');
        switchTab('profile');
        return;
    }

    const myPid = String(appState.playerId).trim();
    let allWishes = Store.getWishWallPosts();
    const nowTs = Date.now();

    // 不分男女：提出問題後，必須等目前問題結束（到期或自行關閉）才能再新增下一個
    const existingActive = allWishes.find(w => String(w.authorId) === myPid && !isWishWallEnded(w, nowTs));
    if (existingActive) {
        showMiniNotice('⏳ 已有進行中的祈願', '提出問題後，需等目前問題結束或自行關閉後，才能再新增下一個題目喔！');
        renderWishWallTab(true);
        return;
    }

    // 男生限制：一天只能 3 位男生新增，要等每日 20:00 才會重置次數（女生不受任何次數限制）
    if (myGender === '男') {
        if (typeof CloudSync !== 'undefined' && !CloudSync.isLocalSandboxMode() && CloudSync.dbUrl && CloudSync.inFlightWrites === 0) {
            try {
                const encodedWishPath = CloudSync.encodePath(WISH_WALL_KEY);
                const res = await fetch(`${CloudSync.dbUrl}/${encodedWishPath}.json${CloudSync.authQuery()}`, { method: 'GET', cache: 'no-store' });
                if (res.ok) {
                    const remoteData = await res.json();
                    const remoteArr = CloudSync.mapToArray(remoteData)
                        .map(w => (typeof normalizeWishWallItem === 'function' ? normalizeWishWallItem(w) : w))
                        .filter(Boolean);
                    localStorage.setItem(WISH_WALL_KEY, JSON.stringify(remoteArr));
                    allWishes = remoteArr;
                }
            } catch (e) {}
        }

        const recheckActive = allWishes.find(w => String(w.authorId) === myPid && !isWishWallEnded(w, nowTs));
        if (recheckActive) {
            showMiniNotice('⏳ 已有進行中的祈願', '提出問題後，需等目前問題結束或自行關閉後，才能再新增下一個題目喔！');
            renderWishWallTab(true);
            return;
        }

        const maleQuota = getMaleWishDailyQuotaStatus(allWishes, nowTs);
        if (maleQuota.isFull) {
            const resetTimeLabel = formatWishShortDateTime(maleQuota.resetAtTs);
            showMiniNotice(
                `⏳ 今日新增名額已滿（${maleQuota.usedCount} / ${maleQuota.limit} 位）`,
                `每天僅限 3 位新增祈願題目，今日名額已滿！\n將於 ${resetTimeLabel}（20:00）重置次數後才可再新增喔。`
            );
            lastWishWallRenderSig = '';
            renderWishWallTab(true);
            return;
        }
    }

    const cleanQuestions = [];
    for (let i = 0; i < wishDraftQuestions.length; i++) {
        const item = wishDraftQuestions[i] || {};
        const qText = String(item.question || '').trim();
        const optA = String(item.optionA || '').trim();
        const optB = String(item.optionB || '').trim();
        if (!qText || !optA || !optB) {
            showMiniNotice('✍️ 請填寫完整題目', `請將第 ${i + 1} 題的「題目內容」與「兩個選項」都填寫完整喔！`);
            return;
        }
        if (optA === optB) {
            showMiniNotice('⚠️ 選項不能相同', `第 ${i + 1} 題的兩個選項不能完全相同喔！`);
            return;
        }
        cleanQuestions.push({
            qIndex: i + 1,
            question: qText,
            optionA: optA,
            optionB: optB
        });
    }

    const titleText = String(wishDraftTitle || '').trim() || cleanQuestions[0].question;
    const openDays = Math.max(WISH_MIN_OPEN_DAYS, Math.min(WISH_MAX_OPEN_DAYS, parseInt(wishDraftOpenDays, 10) || WISH_MIN_OPEN_DAYS));

    // 禁止關鍵字檢查
    if (typeof Store !== 'undefined' && typeof Store.checkProfileBanned === 'function') {
        const combinedCheckText = [titleText, ...cleanQuestions.map(q => `${q.question} ${q.optionA} ${q.optionB}`)].join(' ');
        const hitRule = Store.checkProfileBanned({ bio: combinedCheckText, nickname: titleText });
        if (hitRule) {
            showMiniNotice('🚫 內容包含受限制字眼', '祈願題目或選項包含系統限制的字眼，請修改後再發布。');
            return;
        }
    }

    // 若之前有已結束但尚未按結算的舊題目，自動標記為已結算歸檔，維持「一次僅一則主祈願」
    const prevUnsettledEnded = allWishes.filter(w => String(w.authorId) === myPid && isWishWallEnded(w, nowTs) && !w.settled);
    for (const oldW of prevUnsettledEnded) {
        oldW.settled = true;
        oldW.settledWithoutMatch = true;
        oldW.settledAtTs = nowTs;
        if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
            await CloudSync.patchNode(`${WISH_WALL_KEY}/${oldW.id}`, {
                settled: true,
                settledWithoutMatch: true,
                settledAtTs: nowTs
            });
        }
    }

    const expiresAtTs = calcWishExpiresAtTs(nowTs, openDays);
    const newWish = {
        id: 'WISH_' + nowTs + '_' + Math.random().toString(36).slice(2, 6),
        authorId: myPid,
        authorNickname: String(appState.profile.nickname || `玩家_${myPid}`).trim(),
        authorGender: myGender,
        authorCity: String(appState.profile.city || '').trim(),
        authorMbti: String(appState.profile.mbti || '').trim(),
        title: titleText,
        openDays: openDays,
        createdAtTs: nowTs,
        expiresAtTs: expiresAtTs,
        manuallyClosed: false,
        closedAtTs: 0,
        settled: false,
        settledWithoutMatch: false,
        matchedAnonNumber: null,
        matchedResponderId: null,
        settledAtTs: 0,
        questions: cleanQuestions,
        responses: {}
    };

    const nextList = [normalizeWishWallItem(newWish), ...allWishes].filter(Boolean);
    localStorage.setItem(WISH_WALL_KEY, JSON.stringify(nextList));
    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        await CloudSync.putNode(`${WISH_WALL_KEY}/${newWish.id}`, newWish);
    }

    // 重置草稿表單並收合建立區
    wishDraftTitle = '';
    wishDraftOpenDays = 3;
    wishDraftQuestions = [{ question: '', optionA: '', optionB: '' }];
    isWishCreatorFormOpen = false;

    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    updateWishNavBadge();
    showMiniNotice('🏮 紅線祈願已發布！', `你的 ${cleanQuestions.length} 題二選一祈願已上架，開放 ${openDays} 天（將於 ${formatWishShortDateTime(expiresAtTs)} 結束）！`);
}

async function closeMyWishEarly(wishId) {
    const wid = String(wishId || '').trim();
    if (!wid) return;
    const myPid = String(appState.playerId || '').trim();
    const wishes = Store.getWishWallPosts();
    const target = wishes.find(w => String(w.id) === wid && String(w.authorId) === myPid);
    if (!target) return;

    const sysCfg = (typeof Store !== 'undefined' && typeof Store.getSystemConfig === 'function')
        ? Store.getSystemConfig()
        : { wishEarlyCloseCanMatch: true };
    const canMatchOnEarlyClose = Boolean(sysCfg.wishEarlyCloseCanMatch);

    const confirmMsg = canMatchOnEarlyClose
        ? '確定要現在「自行關閉題目」嗎？\n關閉後將停止接收新回答，並可立即檢視匿名答案挑選配對好友（或直接發起下一個祈願）。'
        : '確定要現在「自行關閉題目」嗎？\n目前後台設定提前結束「不可進行好友配對」，關閉後將直接結束本輪且不開放挑選配對。';

    if (!confirm(confirmMsg)) {
        return;
    }

    const nowTs = Date.now();
    target.manuallyClosed = true;
    target.closedAtTs = nowTs;
    target.earlyClosedCanMatch = canMatchOnEarlyClose;

    const cloudPatch = {
        manuallyClosed: true,
        closedAtTs: nowTs,
        earlyClosedCanMatch: canMatchOnEarlyClose
    };

    if (!canMatchOnEarlyClose) {
        target.settled = true;
        target.settledWithoutMatch = true;
        target.settledAtTs = nowTs;
        cloudPatch.settled = true;
        cloudPatch.settledWithoutMatch = true;
        cloudPatch.settledAtTs = nowTs;
    }

    localStorage.setItem(WISH_WALL_KEY, JSON.stringify(wishes));

    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        await CloudSync.patchNode(`${WISH_WALL_KEY}/${wid}`, cloudPatch);
    }

    expandedMyActiveWish = false;
    isEditingMyActiveWish = false;
    editMyWishId = '';
    editMyWishTitle = '';
    editMyWishQuestions = [];
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    updateWishNavBadge();
    if (canMatchOnEarlyClose) {
        showMiniNotice('🔒 已關閉祈願題目', '題目已提前結束！若已有玩家回覆，現在就可以選擇喜歡的匿名答案並配對成好友囉。');
    } else {
        showMiniNotice('🔒 已提前關閉祈願題目', '題目已提前結束（目前設定提前結束不可進行好友配對，本輪已直接結束）。');
    }
}

// ==================== 男／女玩家回答祈願題目 ====================
function selectWishAnswerOption(wishId, qIndex, optionCode) {
    const wid = String(wishId || '').trim();
    if (!wishDraftSelections[wid]) wishDraftSelections[wid] = {};
    wishDraftSelections[wid][Number(qIndex)] = optionCode;
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
}

function onWishResponseNoteInput(wishId, val) {
    const wid = String(wishId || '').trim();
    wishDraftNotes[wid] = String(val || '');
}

async function submitWishResponse(wishId) {
    const wid = String(wishId || '').trim();
    if (!wid) return;

    if (!hasCompletedWishWallProfile()) {
        showMiniNotice('📝 請先完成個人資料', '請先前往「個人與隱私」分頁填寫並保存基本資料，才能回答祈願題目喔！');
        switchTab('profile');
        return;
    }
    if (appState.isWarnedAccount) {
        showMiniNotice('⚠️ 無法回答題目', '目前警告帳號不提供參與配對互動。');
        return;
    }

    const myPid = String(appState.playerId).trim();
    const wishes = Store.getWishWallPosts();
    const target = wishes.find(w => String(w.id) === wid);
    if (!target) return;

    if (String(target.authorId) === myPid) {
        showMiniNotice('🌸 提醒', '不能回答自己發起的祈願題目喔！');
        return;
    }
    if (isWishWallEnded(target, Date.now())) {
        showMiniNotice('⏳ 題目已結束', '這則祈願題目已經截止囉，請回答其他開放中的題目吧！');
        renderWishWallTab(true);
        return;
    }
    if ((target.responses || []).some(r => String(r.responderId) === myPid)) {
        showMiniNotice('✅ 你已回答過囉', '每位玩家對同一則祈願題目只能回答一次喔！');
        renderWishWallTab(true);
        return;
    }

    const pickedMap = wishDraftSelections[wid] || {};
    const answers = [];
    for (const q of (target.questions || [])) {
        const code = pickedMap[Number(q.qIndex)];
        if (code !== 'A' && code !== 'B') {
            showMiniNotice('✍️ 請完成所有題目', `請先選擇第 ${q.qIndex} 題的二選一答案再送出喔！`);
            return;
        }
        answers.push({
            qIndex: Number(q.qIndex),
            chosenOption: code,
            chosenText: code === 'A' ? q.optionA : q.optionB
        });
    }

    const noteText = String(wishDraftNotes[wid] || '').trim();
    if (noteText && typeof Store !== 'undefined' && typeof Store.checkProfileBanned === 'function') {
        const hitRule = Store.checkProfileBanned({ bio: noteText, nickname: noteText });
        if (hitRule) {
            showMiniNotice('🚫 內容包含受限制字眼', '補充留言包含系統限制的字眼，請修改後再送出。');
            return;
        }
    }

    const nowTs = Date.now();
    const respPayload = {
        responderId: myPid,
        responderNickname: String(appState.profile.nickname || `玩家_${myPid}`).trim(),
        responderGender: String(appState.profile.gender || '').trim(),
        answers: answers,
        note: noteText,
        createdAtTs: nowTs
    };

    // 先寫入 Firebase 獨立子節點（responses/{myPid}），避免多人同時回覆互相覆蓋
    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        await CloudSync.putNode(`${WISH_WALL_KEY}/${wid}/responses/${myPid}`, respPayload);
    }

    // 同步更新本地快取並推算匿名編號
    const rawArr = JSON.parse(localStorage.getItem(WISH_WALL_KEY) || '[]');
    const idx = rawArr.findIndex(item => item && String(item.id) === wid);
    if (idx >= 0) {
        const curW = rawArr[idx];
        if (!curW.responses || Array.isArray(curW.responses)) {
            const mapObj = {};
            (Array.isArray(curW.responses) ? curW.responses : []).forEach(r => {
                if (r && r.responderId) mapObj[String(r.responderId)] = r;
            });
            curW.responses = mapObj;
        }
        curW.responses[myPid] = respPayload;
        rawArr[idx] = normalizeWishWallItem(curW);
        localStorage.setItem(WISH_WALL_KEY, JSON.stringify(rawArr));
    }

    delete wishDraftSelections[wid];
    delete wishDraftNotes[wid];

    const updatedWish = Store.getWishWallPosts().find(w => String(w.id) === wid);
    const myEntry = updatedWish ? (updatedWish.responses || []).find(r => String(r.responderId) === myPid) : null;
    const assignedNum = myEntry ? myEntry.anonNumber : ((target.responses || []).length + 1);

    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    showMiniNotice('💌 回答已送出！', `你已成功回答此祈願題目，你的匿名代號為「匿名${assignedNum}號」！
題主將於截止後檢視所有匿名答案並決定配對。`);
}

function buildWishMatchSummaryText(wishObj, respObj) {
    if (!wishObj || !respObj) return '';
    const title = String(wishObj.title || '紅線祈願牆默契問答').trim();
    const questions = Array.isArray(wishObj.questions) ? wishObj.questions : [];
    const answers = Array.isArray(respObj.answers) ? respObj.answers : [];
    const ansByQIdx = new Map();
    answers.forEach((a, i) => {
        if (a && typeof a === 'object') {
            ansByQIdx.set(Number(a.qIndex || (i + 1)), a);
        }
    });

    const qLines = questions.map((q, idx) => {
        const qNum = Number(q.qIndex || (idx + 1));
        const ans = ansByQIdx.get(qNum);
        const optCode = ans && ans.chosenOption ? String(ans.chosenOption).trim() : '';
        const optText = ans && ans.chosenText
            ? String(ans.chosenText).trim()
            : (optCode === 'A' ? (q.optionA || '') : (optCode === 'B' ? (q.optionB || '') : ''));
        const answerDisplay = optCode
            ? `選項 ${optCode}：${optText}`
            : (optText || '未作答');
        return `Q${qNum}. ${String(q.question || '').trim()}\n👉 選擇答案：${answerDisplay}`;
    });

    if (qLines.length === 0 && answers.length > 0) {
        answers.forEach((a, idx) => {
            const qNum = Number(a.qIndex || (idx + 1));
            const optCode = String(a.chosenOption || '').trim();
            const optText = String(a.chosenText || '').trim();
            qLines.push(`Q${qNum}. 題目 ${qNum}\n👉 選擇答案：${optCode ? `選項 ${optCode}：${optText}` : optText}`);
        });
    }

    const lines = [
        `🏮【紅線祈願牆・默契問答紀錄】`,
        `📌 題目主題：${title}`,
        ...qLines
    ];
    const noteText = String(respObj.note || '').trim();
    if (noteText) {
        lines.push(`💬 補充留言：${noteText}`);
    }
    return lines.join('\n');
}
window.buildWishMatchSummaryText = buildWishMatchSummaryText;

// ==================== 結束後女方選擇喜歡的匿名答案並配對成好友（或選擇都不喜歡） ====================
async function selectWishResponderAndMatch(wishId, anonNumber) {
    const wid = String(wishId || '').trim();
    const targetAnonNum = Number(anonNumber || 0);
    if (!wid || !targetAnonNum) return;

    const myPid = String(appState.playerId || '').trim();
    const wishes = Store.getWishWallPosts();
    const targetWish = wishes.find(w => String(w.id) === wid && String(w.authorId) === myPid);
    if (!targetWish) return;

    if (!isWishWallEnded(targetWish, Date.now())) {
        showMiniNotice('⏳ 尚未結束', '需等開放天數到期（20:00）或自行關閉題目後，才可選擇配對對象喔！');
        return;
    }
    const sysCfgNow = (typeof Store !== 'undefined' && typeof Store.getSystemConfig === 'function')
        ? Store.getSystemConfig()
        : { wishEarlyCloseCanMatch: true };
    if (targetWish.manuallyClosed && (targetWish.earlyClosedCanMatch === false || !sysCfgNow.wishEarlyCloseCanMatch)) {
        showMiniNotice('🚫 提前結束不可配對', '目前設定提前結束的祈願題目不開放進行好友配對。');
        return;
    }
    if (targetWish.settled) {
        showMiniNotice('✅ 已完成選擇', '這則祈願題目已經完成配對選擇囉！');
        return;
    }

    const chosenResp = (targetWish.responses || []).find(r => Number(r.anonNumber) === targetAnonNum);
    if (!chosenResp) return;

    const partnerPid = String(chosenResp.responderId || '').trim();
    if (!partnerPid || partnerPid === myPid) return;

    const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
    const meUser = users.find(u => String(u.id).trim() === myPid);
    const partnerUser = users.find(u => String(u.id).trim() === partnerPid);
    if (!meUser || !partnerUser) {
        showMiniNotice('⚠️ 找不到玩家資料', '該回覆者的帳號資料已不存在，請選擇其他匿名回覆者。');
        return;
    }

    const alreadyFriends = (Array.isArray(meUser.matchedHistory) && meUser.matchedHistory.some(h => String(h.partnerId) === partnerPid)) ||
        appState.friends.some(f => String(f.id) === partnerPid);
    if (alreadyFriends) {
        showMiniNotice('💘 你們已經是好友囉', `匿名${targetAnonNum}號（${partnerUser.nickname}）已經在你的七日好友名單中囉！`);
        return;
    }

    if (!confirm(`確定要選擇「匿名${targetAnonNum}號」的答案，並與對方配對成七日好友嗎？
配對後將立即加入雙方好友名單並開啟聊天室！`)) {
        return;
    }

    const nowTs = Date.now();
    const sessionLabel = '紅線祈願牆';
    const matchDetail = `祈願牆挑選匿名${targetAnonNum}號配對`;

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.clearPairUnmatched === 'function') {
        CloudSync.clearPairUnmatched(myPid, partnerPid);
    }

    if (!Array.isArray(meUser.matchedHistory)) meUser.matchedHistory = [];
    if (!Array.isArray(partnerUser.matchedHistory)) partnerUser.matchedHistory = [];

    meUser.matchedHistory.push({
        session: sessionLabel,
        partnerId: partnerPid,
        partnerName: partnerUser.nickname,
        matchedAt: nowTs,
        activityId: wid,
        matchDetail: matchDetail,
        continueVotes: []
    });
    meUser.matchedSession = sessionLabel;
    meUser.matchedWithId = partnerPid;
    meUser.matchedWithName = partnerUser.nickname;
    meUser.matchedAt = nowTs;

    partnerUser.matchedHistory.push({
        session: sessionLabel,
        partnerId: myPid,
        partnerName: meUser.nickname,
        matchedAt: nowTs,
        activityId: wid,
        matchDetail: matchDetail,
        continueVotes: []
    });
    partnerUser.matchedSession = sessionLabel;
    partnerUser.matchedWithId = myPid;
    partnerUser.matchedWithName = meUser.nickname;
    partnerUser.matchedAt = nowTs;

    localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));

    // 寫入配對日誌與建立雙方聊天室開場白
    if (typeof CloudSync !== 'undefined') {
        if (typeof CloudSync.recordMatchLog === 'function') {
            CloudSync.recordMatchLog(meUser, partnerUser, sessionLabel, nowTs, matchDetail);
        }
        await Promise.all([
            CloudSync.upsertUser(meUser, true, { isMatchMutation: true }),
            CloudSync.upsertUser(partnerUser, true, { isMatchMutation: true })
        ]);
    }

    if (typeof ChatStore !== 'undefined' && typeof ChatStore.ensureThread === 'function') {
        const timeNowStr = new Date(nowTs).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
        const initialThread = [
            {
                senderId: 'system',
                text: `🏮【紅線祈願牆】月老牽線成功！（${meUser.nickname} 選擇了匿名${targetAnonNum}號的答案）好友名單將保留 7 天，現在可以開始聊天囉！`,
                time: timeNowStr,
                ts: nowTs
            }
        ];
        const wishQaSummaryText = buildWishMatchSummaryText(targetWish, chosenResp);
        if (wishQaSummaryText) {
            initialThread.push({
                senderId: 'system',
                text: wishQaSummaryText,
                time: timeNowStr,
                ts: nowTs + 1
            });
        }
        if (meUser.oneSentence) {
            initialThread.push({ senderId: myPid, senderName: meUser.nickname || '', text: meUser.oneSentence, time: '20:01', ts: nowTs + 2 });
        }
        if (partnerUser.oneSentence) {
            initialThread.push({ senderId: partnerPid, senderName: partnerUser.nickname || '', text: partnerUser.oneSentence, time: '20:01', ts: nowTs + 3 });
        }
        ChatStore.ensureThread(myPid, partnerPid, initialThread);
    }

    // 標記祈願已完成配對結算
    targetWish.settled = true;
    targetWish.settledWithoutMatch = false;
    targetWish.matchedAnonNumber = targetAnonNum;
    targetWish.matchedResponderId = partnerPid;
    targetWish.settledAtTs = nowTs;
    localStorage.setItem(WISH_WALL_KEY, JSON.stringify(wishes));

    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        await CloudSync.patchNode(`${WISH_WALL_KEY}/${wid}`, {
            settled: true,
            settledWithoutMatch: false,
            matchedAnonNumber: targetAnonNum,
            matchedResponderId: partnerPid,
            settledAtTs: nowTs
        });
    }

    syncFromSharedStorage();
    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    updateWishNavBadge();
    showMiniNotice(
        '💘 祈願牽線配對成功！',
        `你已選擇「匿名${targetAnonNum}號（${partnerUser.nickname}）」並成功配對成好友！
快前往「💌 好友名單」開啟對話吧！`
    );
}

async function skipWishSelectionAndSettle(wishId) {
    const wid = String(wishId || '').trim();
    if (!wid) return;
    const myPid = String(appState.playerId || '').trim();
    const wishes = Store.getWishWallPosts();
    const targetWish = wishes.find(w => String(w.id) === wid && String(w.authorId) === myPid);
    if (!targetWish) return;

    if (!confirm('確定這輪「都不喜歡（不選）」並結束本輪祈願嗎？\n結束後不會配對任何好友，你可以隨時新增下一個祈願題目。')) {
        return;
    }

    const nowTs = Date.now();
    targetWish.settled = true;
    targetWish.settledWithoutMatch = true;
    targetWish.settledAtTs = nowTs;
    localStorage.setItem(WISH_WALL_KEY, JSON.stringify(wishes));

    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        await CloudSync.patchNode(`${WISH_WALL_KEY}/${wid}`, {
            settled: true,
            settledWithoutMatch: true,
            settledAtTs: nowTs
        });
    }

    lastWishWallRenderSig = '';
    renderWishWallTab(true);
    updateWishNavBadge();
    showMiniNotice('🍃 已結束本輪祈願', '你已選擇本輪不配對好友，現在可以隨時發布新的祈願題目囉！');
}

// ==================== 渲染紅線祈願牆分頁 ====================
function renderWishWallTab(forceRender = false) {
    const creatorBox = document.getElementById('wishWallFemaleCreatorSection');
    const publicListBox = document.getElementById('wishWallPublicList');
    const pastHistoryBox = document.getElementById('wishWallPastHistorySection');
    const openBadge = document.getElementById('wishWallOpenCountBadge');
    if (!creatorBox || !publicListBox) return;

    const wishes = (typeof Store !== 'undefined' && typeof Store.getWishWallPosts === 'function')
        ? Store.getWishWallPosts()
        : [];
    const nowTs = Date.now();
    const myPid = appState && appState.playerId ? String(appState.playerId).trim() : '';
    const myComplete = hasCompletedWishWallProfile();
    const myGender = resolveWishWallUserGender();
    const canCreateWishPlayer = myComplete && (myGender === '男' || myGender === '女');
    const maleQuota = getMaleWishDailyQuotaStatus(wishes, nowTs);

    const openWishes = wishes.filter(w => !isWishWallEnded(w, nowTs));
    const endedWishes = wishes.filter(w => isWishWallEnded(w, nowTs));

    if (openBadge) {
        openBadge.textContent = `開放中 ${openWishes.length} 則`;
    }

    const genderFilterGroup = document.getElementById('wishWallGenderFilterGroup');
    if (genderFilterGroup) {
        genderFilterGroup.querySelectorAll('button[data-wish-gender]').forEach(btn => {
            const isSel = btn.dataset.wishGender === wishPublicGenderFilter;
            btn.className = isSel
                ? 'text-xs px-3 py-1.5 rounded-full bg-[#c96a7b] text-white border border-[#c96a7b] font-bold shadow-2xs transition'
                : 'text-xs px-3 py-1.5 rounded-full bg-white border border-pink-200 text-[#8f4452] font-bold hover:bg-pink-50 transition';
        });
    }

    const sysCfg = (typeof Store !== 'undefined' && typeof Store.getSystemConfig === 'function')
        ? Store.getSystemConfig()
        : { wishEarlyCloseCanMatch: true };
    const earlyCloseCanMatch = Boolean(sysCfg.wishEarlyCloseCanMatch);

    const renderSig = JSON.stringify({
        myPid,
        myComplete,
        myGender,
        earlyCloseCanMatch,
        maleUsed: maleQuota.usedCount,
        maleReset: maleQuota.resetAtTs,
        pubGenderFilter: wishPublicGenderFilter,
        pubPage: wishPublicListPage,
        pastPage: wishPastHistoryPage,
        expPub: Array.from(expandedPublicWishes),
        expAnon: Array.from(expandedWishAnonLists),
        expMy: expandedMyActiveWish,
        editMy: isEditingMyActiveWish,
        editMyId: editMyWishId,
        wishes: wishes.map(w => [
            w.id, w.title, Boolean(w.isPinned), Number(w.pinnedAtTs || 0), w.authorGender, w.manuallyClosed, w.earlyClosedCanMatch, w.settled, w.matchedAnonNumber,
            isWishWallEnded(w, nowTs), calcWishRemainingDays(w, nowTs),
            (w.questions || []).map(q => [q.question, q.optionA, q.optionB]),
            (w.responses || []).length
        ]),
        creatorOpen: isWishCreatorFormOpen,
        draftQCount: wishDraftQuestions.length,
        draftDays: wishDraftOpenDays,
        draftSelections: wishDraftSelections
    });

    if (!forceRender && renderSig === lastWishWallRenderSig && publicListBox.dataset.rendered === '1') {
        return;
    }
    lastWishWallRenderSig = renderSig;
    publicListBox.dataset.rendered = '1';

    // 1. 渲染「我的祈願管理」區（男／女皆可發起；男生每日限 3 位並於 20:00 重置，女生不限次數；皆需等題目結束才能再新增）
    if (!canCreateWishPlayer) {
        creatorBox.innerHTML = `
            <div class="glass-card rounded-3xl p-5 border border-pink-200 bg-white/85 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div class="text-xs text-[#6e3a43] leading-relaxed">
                    <p class="font-bold text-[#8f4452] text-sm">🔐 尚未建立個人檔案</p>
                    <p class="mt-0.5">完成個人資料建檔後，即可發起專屬二選一祈願題目，或回答其他玩家的祈願問題喔！</p>
                </div>
                <button type="button" onclick="switchTab('profile')" class="btn-sakura px-5 py-2.5 rounded-xl text-xs font-bold shrink-0">
                    📝 前往填寫資料
                </button>
            </div>
        `;
    } else {
        const myActiveWish = openWishes.find(w => String(w.authorId) === myPid) || null;
        const myPendingSelectionWish = endedWishes.find(w => String(w.authorId) === myPid && !w.settled) || null;

        let pendingSelectionHtml = '';
        if (myPendingSelectionWish) {
            const isEarlyClosedDisallowed = Boolean(
                myPendingSelectionWish.manuallyClosed &&
                (myPendingSelectionWish.earlyClosedCanMatch === false || !earlyCloseCanMatch)
            );
            const resps = myPendingSelectionWish.responses || [];
            const qs = myPendingSelectionWish.questions || [];
            const respCardsHtml = resps.length === 0
                ? `<div class="p-4 rounded-2xl bg-white border border-pink-200 text-center text-xs text-gray-500">🍃 本輪祈願期間暫無玩家回覆答案。</div>`
                : resps.map(r => {
                    const ansListHtml = qs.map(q => {
                        const foundAns = (r.answers || []).find(a => Number(a.qIndex) === Number(q.qIndex));
                        const chosenText = foundAns ? foundAns.chosenText : '-';
                        return `
                            <div class="flex items-start justify-between gap-2 text-[11px] py-1 border-b border-pink-100/70 last:border-b-0">
                                <span class="text-gray-500">Q${q.qIndex}. ${escapeWishHtml(q.question)}</span>
                                <span class="font-bold text-[#8f4452] shrink-0">👉 ${escapeWishHtml(chosenText)}</span>
                            </div>
                        `;
                    }).join('');

                    return `
                        <div class="p-4 rounded-2xl bg-white border-2 border-pink-200 space-y-2.5 shadow-2xs">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="flex items-center gap-2">
                                    <span class="px-2.5 py-0.5 rounded-full bg-[#c96a7b] text-white text-xs font-bold">
                                        匿名${r.anonNumber}號
                                    </span>
                                    <span class="text-[11px] text-gray-400 font-mono">
                                        ${formatWishShortDateTime(r.createdAtTs)} 回覆
                                    </span>
                                </div>
                                ${isEarlyClosedDisallowed ? `
                                    <span class="px-3 py-1 rounded-xl bg-gray-100 border border-gray-200 text-[11px] font-bold text-gray-500">
                                        🚫 提前結束不開放配對
                                    </span>
                                ` : `
                                    <button type="button" onclick="selectWishResponderAndMatch('${escapeWishHtml(myPendingSelectionWish.id)}', ${r.anonNumber})"
                                        class="btn-sakura px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-2xs">
                                        💘 喜歡匿名${r.anonNumber}號・配對成好友
                                    </button>
                                `}
                            </div>
                            <div class="p-2.5 rounded-xl bg-pink-50/45 border border-pink-100 space-y-0.5">
                                ${ansListHtml}
                            </div>
                            ${r.note ? `<p class="text-xs text-[#6e3a43] bg-amber-50/70 border border-amber-200/80 rounded-xl px-3 py-2">💬 補充留言：「${escapeWishHtml(r.note)}」</p>` : ''}
                        </div>
                    `;
                }).join('');

            pendingSelectionHtml = `
                <div class="glass-card rounded-3xl p-5 md:p-6 border-2 border-[#c96a7b] bg-gradient-to-br from-rose-50/90 via-white to-pink-50/80 space-y-4 shadow-md">
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-pink-200 pb-3">
                        <div>
                            <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-rose-600 text-white font-bold">
                                ${isEarlyClosedDisallowed ? '🔒 已提前關閉（目前設定不可進行好友配對）' : '⏰ 祈願時間已結束・請挑選心動答案'}
                            </span>
                            <h3 class="text-base font-bold font-serif-jp text-[#8f4452] mt-1.5">🏮 ${escapeWishHtml(myPendingSelectionWish.title)}</h3>
                            <p class="text-xs text-gray-500 mt-0.5">
                                ${isEarlyClosedDisallowed
                                    ? '由於此題目為提前關閉且目前系統設定提前結束不可進行好友配對，請點擊下方按鈕結束本輪歸檔。'
                                    : `共有 <strong>${resps.length} 位</strong>匿名玩家回答了你的題目；請檢視答案並選擇喜歡的幾號配對成好友（若都不喜歡也可以不選）。`}
                            </p>
                        </div>
                    </div>

                    <div class="space-y-3">
                        ${respCardsHtml}
                    </div>

                    <div class="pt-2 border-t border-pink-200 flex flex-wrap items-center justify-between gap-2">
                        <span class="text-[11px] text-gray-500">${isEarlyClosedDisallowed ? '確認結束並歸檔本輪祈願：' : '如果以上答案都不喜歡，可直接結束本輪不配對：'}</span>
                        <button type="button" onclick="skipWishSelectionAndSettle('${escapeWishHtml(myPendingSelectionWish.id)}')"
                            class="px-4 py-2 rounded-xl bg-white border border-gray-300 text-xs font-bold text-gray-600 hover:bg-gray-50 transition">
                            ${isEarlyClosedDisallowed ? '✓ 確認結束本輪' : '🍃 都不喜歡（不選・結束本輪）'}
                        </button>
                    </div>
                </div>
            `;
        }

        if (myActiveWish) {
            if (isEditingMyActiveWish && editMyWishId !== String(myActiveWish.id)) {
                isEditingMyActiveWish = false;
                editMyWishId = '';
                editMyWishTitle = '';
                editMyWishQuestions = [];
            }

            const remDays = calcWishRemainingDays(myActiveWish, nowTs);
            const resps = myActiveWish.responses || [];
            const qs = myActiveWish.questions || [];
            const isEditingThisActive = Boolean(isEditingMyActiveWish && editMyWishId === String(myActiveWish.id));

            const livePreviewResps = resps.length === 0
                ? `<p class="text-xs text-gray-400">目前尚無玩家回覆，開放期間內玩家送出回答後會即時顯示於此。</p>`
                : resps.map(r => {
                    const summaryChips = (r.answers || []).map(a => `<span class="px-2 py-0.5 rounded bg-pink-50 border border-pink-200 text-[11px] text-[#8f4452]">Q${a.qIndex}: ${escapeWishHtml(a.chosenText)}</span>`).join(' ');
                    return `
                        <div class="p-3 rounded-xl bg-white border border-pink-100 space-y-1.5">
                            <div class="flex items-center justify-between text-xs">
                                <span class="font-bold text-[#8f4452]">🎭 匿名${r.anonNumber}號</span>
                                <span class="text-[10px] font-mono text-gray-400">${formatWishShortDateTime(r.createdAtTs)}</span>
                            </div>
                            <div class="flex flex-wrap gap-1.5">${summaryChips}</div>
                            ${r.note ? `<p class="text-[11px] text-gray-600">💬 「${escapeWishHtml(r.note)}」</p>` : ''}
                        </div>
                    `;
                }).join('');

            const editRowsHtml = editMyWishQuestions.map((eq, idx) => `
                <div class="p-3 rounded-2xl bg-pink-50/55 border border-pink-200 space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-[#8f4452]">第 ${idx + 1} 題（二選一・僅可修改文字）</span>
                    </div>
                    <input type="text" value="${escapeWishHtml(eq.question)}" oninput="onEditMyWishQuestionFieldInput(${idx}, 'question', this.value)"
                        placeholder="輸入題目問題..." class="input-jp !py-2 !text-xs" required>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input type="text" value="${escapeWishHtml(eq.optionA)}" oninput="onEditMyWishQuestionFieldInput(${idx}, 'optionA', this.value)"
                            placeholder="選項 A..." class="input-jp !py-2 !text-xs" required>
                        <input type="text" value="${escapeWishHtml(eq.optionB)}" oninput="onEditMyWishQuestionFieldInput(${idx}, 'optionB', this.value)"
                            placeholder="選項 B..." class="input-jp !py-2 !text-xs" required>
                    </div>
                </div>
            `).join('');

            const expandedBodyHtml = isEditingThisActive
                ? `
                    <form onsubmit="saveEditedMyActiveWish(event)" class="space-y-3 pt-3 border-t border-emerald-200">
                        <div class="p-2.5 rounded-xl bg-amber-50/85 border border-amber-200 text-[11px] text-amber-900 font-semibold flex flex-wrap items-center justify-between gap-1">
                            <span>✏️ 編輯模式：僅可修改「文字標題」與「二選一題目／選項內容」</span>
                            <span class="text-gray-500 font-normal">開放 ${myActiveWish.openDays} 天（${formatWishShortDateTime(myActiveWish.expiresAtTs)} 截止）・題數固定 ${qs.length} 題</span>
                        </div>
                        <div class="space-y-1">
                            <label class="block text-xs font-bold text-[#8f4452]">祈願主題 / 文字標題（選填，留空則自動帶入第 1 題問題）</label>
                            <input type="text" value="${escapeWishHtml(editMyWishTitle)}" oninput="onEditMyWishTitleInput(this.value)"
                                placeholder="輸入祈願標題..." class="input-jp !py-2 !text-xs">
                        </div>
                        <div class="space-y-2.5">
                            ${editRowsHtml}
                        </div>
                        <div class="flex items-center justify-end gap-2 pt-1">
                            <button type="button" onclick="cancelEditMyActiveWish()" class="px-3.5 py-2 rounded-xl border border-gray-300 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 transition">
                                取消
                            </button>
                            <button type="submit" class="btn-sakura px-5 py-2 rounded-xl text-xs font-bold shadow-2xs">
                                💾 儲存文字修改
                            </button>
                        </div>
                    </form>
                `
                : `
                    <div class="space-y-2 pt-2.5 border-t border-emerald-100">
                        <div class="flex items-center justify-between gap-2">
                            <p class="text-xs font-bold text-[#8f4452]">📋 我的二選一題目（共 ${qs.length} 題）：</p>
                            <button type="button" onclick="openEditMyActiveWish('${escapeWishHtml(myActiveWish.id)}')"
                                class="px-2.5 py-1 rounded-lg bg-pink-50 border border-pink-200 text-[#8f4452] text-[11px] font-bold hover:bg-pink-100 transition">
                                ✏️ 編輯標題／選項文字
                            </button>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                            ${qs.map(q => `
                                <div class="p-3 rounded-xl bg-white border border-pink-200 text-xs">
                                    <p class="font-bold text-[#5e343c]">Q${q.qIndex}. ${escapeWishHtml(q.question)}</p>
                                    <p class="text-[11px] text-[#c96a7b] mt-1">選項 A：${escapeWishHtml(q.optionA)} ／ 選項 B：${escapeWishHtml(q.optionB)}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="space-y-2 pt-2 border-t border-emerald-100">
                        <p class="text-xs font-bold text-[#8f4452]">🎭 目前收到的匿名答案預覽（共 ${resps.length} 人已回答，結束後開放挑選配對）：</p>
                        <div class="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                            ${livePreviewResps}
                        </div>
                    </div>
                `;

            creatorBox.innerHTML = `
                <div class="space-y-4">
                    ${pendingSelectionHtml}
                    <div id="myActiveWishCard" class="glass-card rounded-2xl px-4 py-3 border-2 border-emerald-300 bg-gradient-to-r from-emerald-50/45 via-white to-pink-50/40 space-y-3">
                        <div class="flex items-center justify-between gap-2 cursor-pointer select-none" onclick="toggleMyActiveWishExpand()">
                            <div class="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 overflow-x-auto">
                                <h3 class="text-xs sm:text-sm font-bold font-serif-jp text-[#8f4452] truncate">🏮 ${escapeWishHtml(myActiveWish.title)}</h3>
                                <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold shrink-0 whitespace-nowrap">🟢 我的題目</span>
                                <span class="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold shrink-0 whitespace-nowrap">
                                    ⏳ 剩餘 ${remDays} 天（${formatWishShortDateTime(myActiveWish.expiresAtTs)} 截止）
                                </span>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                                ${!isEditingThisActive ? `
                                    <button type="button" onclick="event.stopPropagation(); openEditMyActiveWish('${escapeWishHtml(myActiveWish.id)}')"
                                        class="px-2.5 py-1 rounded-xl bg-white border border-pink-300 hover:bg-pink-50 text-[#8f4452] text-[11px] font-bold shadow-2xs transition whitespace-nowrap">
                                        ✏️ 編輯題目
                                    </button>
                                ` : ''}
                                <button type="button" onclick="event.stopPropagation(); closeMyWishEarly('${escapeWishHtml(myActiveWish.id)}')"
                                    class="px-2.5 py-1 rounded-xl bg-gray-800 hover:bg-gray-900 text-white text-[11px] font-bold shadow-2xs transition whitespace-nowrap">
                                    🔒 自行關閉題目
                                </button>
                                <span class="text-base text-[#c96a7b] px-1 transform transition-transform ${expandedMyActiveWish ? 'rotate-180' : ''}">▾</span>
                            </div>
                        </div>

                        ${expandedMyActiveWish ? expandedBodyHtml : ''}
                    </div>
                </div>
            `;
        } else if ((myGender === '男' && maleQuota.isFull) || !isWishCreatorFormOpen) {
            creatorBox.innerHTML = pendingSelectionHtml ? `<div class="space-y-4">${pendingSelectionHtml}</div>` : '';
        } else {
            const expPreviewTs = calcWishExpiresAtTs(nowTs, wishDraftOpenDays);
            const resetTimeStr = formatWishShortDateTime(maleQuota.resetAtTs);
            const genderRuleBadgeHtml = myGender === '男'
                ? `<span class="text-[11px] px-2.5 py-0.5 rounded-full bg-sky-100 border border-sky-200 text-sky-800 font-bold">🙋‍♂️ 今日新增名額：已用 ${maleQuota.usedCount} / ${maleQuota.limit} 位</span>`
                : '';

            const draftRowsHtml = wishDraftQuestions.map((q, idx) => `
                <div class="p-3.5 rounded-2xl bg-pink-50/45 border border-pink-200 space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-[#8f4452]">第 ${idx + 1} 題（二選一）</span>
                        ${wishDraftQuestions.length > 1 ? `
                            <button type="button" onclick="removeWishDraftQuestionRow(${idx})" class="text-[11px] text-rose-500 hover:underline font-semibold">
                                ✕ 移除此題
                            </button>
                        ` : ''}
                    </div>
                    <input type="text" value="${escapeWishHtml(q.question)}" oninput="onWishDraftQuestionFieldInput(${idx}, 'question', this.value)"
                        placeholder="輸入題目問題（例如：週末約會更喜歡哪一種行程？）" class="input-jp !py-2 !text-xs" required>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input type="text" value="${escapeWishHtml(q.optionA)}" oninput="onWishDraftQuestionFieldInput(${idx}, 'optionA', this.value)"
                            placeholder="選項 A（例如：看海吹風）" class="input-jp !py-2 !text-xs" required>
                        <input type="text" value="${escapeWishHtml(q.optionB)}" oninput="onWishDraftQuestionFieldInput(${idx}, 'optionB', this.value)"
                            placeholder="選項 B（例如：森林咖啡廳）" class="input-jp !py-2 !text-xs" required>
                    </div>
                </div>
            `).join('');

            const addedExtraCount = Math.max(0, wishDraftQuestions.length - 1);
            const canAddMoreQuestions = addedExtraCount < WISH_MAX_EXTRA_QUESTIONS;
            const safeSelectedDays = Math.max(WISH_MIN_OPEN_DAYS, Math.min(WISH_MAX_OPEN_DAYS, Number(wishDraftOpenDays) || WISH_MIN_OPEN_DAYS));

            creatorBox.innerHTML = `
                <div class="space-y-4">
                    ${pendingSelectionHtml}
                    <div id="wishCreatorFormCard" class="glass-card rounded-3xl p-5 md:p-6 border-2 border-pink-200 bg-white/95 space-y-4">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-pink-100 pb-3">
                            <div class="flex flex-wrap items-center gap-2">
                                <h3 class="text-base font-bold font-serif-jp text-[#8f4452]">✨ 發起新的紅線祈願題目</h3>
                                ${genderRuleBadgeHtml}
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <button type="button" onclick="addWishDraftQuestionRow()" ${canAddMoreQuestions ? '' : 'disabled'}
                                    class="px-3.5 py-1.5 rounded-xl border text-xs font-bold transition ${canAddMoreQuestions ? 'bg-pink-100 border-pink-300 text-[#8f4452] hover:bg-pink-200' : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'}">
                                    ${canAddMoreQuestions ? `➕ 新增一題 2 選 1（已新增 ${addedExtraCount}/${WISH_MAX_EXTRA_QUESTIONS} 次）` : `➕ 已達新增上限（${WISH_MAX_EXTRA_QUESTIONS}/${WISH_MAX_EXTRA_QUESTIONS} 次）`}
                                </button>
                                <button type="button" onclick="closeWishCreatorForm()" class="px-3 py-1.5 rounded-xl border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition">
                                    ✕ 收合
                                </button>
                            </div>
                        </div>

                        <form onsubmit="submitCreateWishPost(event)" class="space-y-4">
                            <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
                                <div class="md:col-span-8 space-y-1">
                                    <label class="block text-xs font-bold text-[#8f4452]">祈願主題 / 想對回答者說的話（選填）</label>
                                    <input type="text" value="${escapeWishHtml(wishDraftTitle)}" oninput="onWishDraftTitleInput(this.value)"
                                        placeholder="例如：想找一個三觀合拍、週末能一起探店的對象～" class="input-jp !py-2 !text-xs">
                                </div>
                                <div class="md:col-span-4 space-y-1">
                                    <label class="block text-xs font-bold text-[#8f4452]">開放天數（3～7 天・每日 20:00 計算）</label>
                                    <div class="flex items-center gap-2">
                                        <select onchange="onWishDraftDaysChange(this.value)" class="input-jp !py-2 !text-xs font-bold text-center text-[#8f4452]" required>
                                            <option value="3" ${safeSelectedDays === 3 ? 'selected' : ''}>3 天</option>
                                            <option value="4" ${safeSelectedDays === 4 ? 'selected' : ''}>4 天</option>
                                            <option value="5" ${safeSelectedDays === 5 ? 'selected' : ''}>5 天</option>
                                            <option value="6" ${safeSelectedDays === 6 ? 'selected' : ''}>6 天</option>
                                            <option value="7" ${safeSelectedDays === 7 ? 'selected' : ''}>7 天</option>
                                        </select>
                                    </div>
                                    <p id="wishDraftExpiryPreview" class="text-[10px] text-[#c96a7b] font-semibold">
                                        預計將於 ${formatWishShortDateTime(expPreviewTs)} 結束
                                    </p>
                                </div>
                            </div>

                            <div class="space-y-3">
                                ${draftRowsHtml}
                            </div>

                            <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-pink-100">
                                <span class="text-[11px] text-gray-500">目前已設定 <strong>${wishDraftQuestions.length}</strong> 題二選一（最多可新增 ${WISH_MAX_EXTRA_QUESTIONS} 次，共 ${WISH_MAX_EXTRA_QUESTIONS + 1} 題）</span>
                                <button type="submit" class="btn-sakura px-6 py-2.5 rounded-xl text-xs md:text-sm font-bold shadow">
                                    🏮 發布紅線祈願題目
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            `;
        }
    }

    // 2. 渲染公開「開放回答中」的祈願牆列表（支援全部/男/女篩選；最多顯示 5 個，第 6 個顯示在第二頁）
    const publicPaginationBar = document.getElementById('wishWallPublicPaginationBar');
    const filteredOpenWishes = openWishes.filter(w => {
        if (wishPublicGenderFilter === '男' || wishPublicGenderFilter === '女') {
            if (wishPublicGenderFilter === '男' && Boolean(w.isPinned)) {
                return true;
            }
            const g = String(w.authorGender || '').trim() === '男' ? '男' : '女';
            return g === wishPublicGenderFilter;
        }
        return true;
    });

    if (filteredOpenWishes.length === 0) {
        const emptyTitle = openWishes.length === 0
            ? '目前祈願牆上尚無開放中的題目'
            : `目前沒有「${wishPublicGenderFilter}」發起的開放中祈願題目`;
        const emptySub = openWishes.length === 0
            ? '點擊右上角「➕ 新增祈願題目」發布二選一祈願後，將即時顯示於此！'
            : '可切換上方篩選為「全部」查看其他開放中的祈願題目！';
        publicListBox.innerHTML = `
            <div class="glass-card rounded-3xl p-8 text-center text-xs text-gray-400 border border-dashed border-pink-200 space-y-1.5">
                <span class="text-3xl block">🎐</span>
                <p class="font-semibold text-gray-500">${emptyTitle}</p>
                <p>${emptySub}</p>
            </div>
        `;
        if (publicPaginationBar) {
            publicPaginationBar.classList.add('hidden');
            publicPaginationBar.innerHTML = '';
        }
    } else {
        const totalOpenCount = filteredOpenWishes.length;
        const totalOpenPages = Math.max(1, Math.ceil(totalOpenCount / WISH_PUBLIC_PER_PAGE));
        if (wishPublicListPage > totalOpenPages) wishPublicListPage = totalOpenPages;
        if (wishPublicListPage < 1) wishPublicListPage = 1;
        const openStartIdx = (wishPublicListPage - 1) * WISH_PUBLIC_PER_PAGE;
        const pageOpenWishes = filteredOpenWishes.slice(openStartIdx, openStartIdx + WISH_PUBLIC_PER_PAGE);

        publicListBox.innerHTML = pageOpenWishes.map(w => {
            const remDays = calcWishRemainingDays(w, nowTs);
            const resps = w.responses || [];
            const qs = w.questions || [];
            const isMine = myPid && String(w.authorId) === myPid;
            const myResp = myPid ? resps.find(r => String(r.responderId) === myPid) : null;

            const isAnonListExpanded = expandedWishAnonLists.has(String(w.id));
            const visibleAnonResps = (resps.length > 3 && !isAnonListExpanded) ? resps.slice(0, 3) : resps;
            const anonMoreToggleHtml = resps.length > 3
                ? (isAnonListExpanded
                    ? `<button type="button" onclick="toggleWishAnonListExpand('${escapeWishHtml(w.id)}')" title="收合匿名名單" class="px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-500 hover:bg-gray-200 text-[11px] font-bold transition cursor-pointer">收合</button>`
                    : `<button type="button" onclick="toggleWishAnonListExpand('${escapeWishHtml(w.id)}')" title="點擊展開全部 ${resps.length} 位匿名名單" class="px-2 py-0.5 rounded-full bg-pink-50 border border-pink-300 text-[#8f4452] hover:bg-pink-100 text-[11px] font-bold transition cursor-pointer">...</button>`)
                : '';

            const anonSummaryHtml = resps.length === 0
                ? `<span class="text-[11px] text-gray-400">💭 目前尚無玩家回答，快來搶當「匿名1號」吧！</span>`
                : `
                    <div class="flex flex-wrap items-center gap-1.5 text-xs">
                        <span class="text-[#8f4452] font-bold">👥</span>
                        ${visibleAnonResps.map(r => `<span class="px-2 py-0.5 rounded-full bg-rose-100/90 text-[#8f4452] text-[11px] font-bold">匿名${r.anonNumber}號</span>`).join('')}
                        ${anonMoreToggleHtml}
                        <span class="text-xs font-semibold text-gray-600">已回答問題（共 ${resps.length} 人）</span>
                    </div>
                `;

            const pickedForThisWish = wishDraftSelections[w.id] || {};
            const noteVal = wishDraftNotes[w.id] || '';

            const questionsBlockHtml = qs.map(q => {
                const pickedCode = pickedForThisWish[Number(q.qIndex)] || '';
                const canInteractivePick = myComplete && !isMine && !myResp;

                if (!canInteractivePick) {
                    return `
                        <div class="p-3 rounded-2xl bg-pink-50/40 border border-pink-100 space-y-1.5">
                            <p class="text-xs font-bold text-[#5e343c]">Q${q.qIndex}. ${escapeWishHtml(q.question)}</p>
                            <div class="grid grid-cols-2 gap-2 text-[11px]">
                                <div class="px-3 py-1.5 rounded-xl bg-white border border-pink-200 text-gray-700">A. ${escapeWishHtml(q.optionA)}</div>
                                <div class="px-3 py-1.5 rounded-xl bg-white border border-pink-200 text-gray-700">B. ${escapeWishHtml(q.optionB)}</div>
                            </div>
                        </div>
                    `;
                }

                return `
                    <div class="p-3 rounded-2xl bg-pink-50/40 border border-pink-200/80 space-y-2">
                        <p class="text-xs font-bold text-[#5e343c]">Q${q.qIndex}. ${escapeWishHtml(q.question)}</p>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button type="button" onclick="selectWishAnswerOption('${escapeWishHtml(w.id)}', ${q.qIndex}, 'A')"
                                class="px-3.5 py-2 rounded-xl text-xs font-bold border text-left transition flex items-center justify-between ${pickedCode === 'A' ? 'bg-gradient-to-r from-[#e79aa8] to-[#c96a7b] text-white border-[#c96a7b] shadow-2xs' : 'bg-white border-pink-200 text-[#6e3a43] hover:bg-pink-50'}">
                                <span>A. ${escapeWishHtml(q.optionA)}</span>
                                <span>${pickedCode === 'A' ? '✓' : ''}</span>
                            </button>
                            <button type="button" onclick="selectWishAnswerOption('${escapeWishHtml(w.id)}', ${q.qIndex}, 'B')"
                                class="px-3.5 py-2 rounded-xl text-xs font-bold border text-left transition flex items-center justify-between ${pickedCode === 'B' ? 'bg-gradient-to-r from-[#e79aa8] to-[#c96a7b] text-white border-[#c96a7b] shadow-2xs' : 'bg-white border-pink-200 text-[#6e3a43] hover:bg-pink-50'}">
                                <span>B. ${escapeWishHtml(q.optionB)}</span>
                                <span>${pickedCode === 'B' ? '✓' : ''}</span>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            let actionFooterHtml = '';
            if (isMine) {
                actionFooterHtml = `
                    <div class="flex items-center justify-end pt-1">
                        <button type="button" onclick="openEditMyActiveWish('${escapeWishHtml(w.id)}')"
                            class="px-3.5 py-1.5 rounded-xl bg-pink-50 border border-pink-300 text-[#8f4452] text-xs font-bold hover:bg-pink-100 transition">
                            ✏️ 編輯我的題目（僅限標題／選項文字）
                        </button>
                    </div>
                `;
            } else if (myResp) {
                actionFooterHtml = `
                    <div class="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200 text-xs text-emerald-800 font-semibold">
                        ✅ 已回答，請等待題主於截止後揭曉配對結果！
                    </div>
                `;
            } else if (!myComplete) {
                actionFooterHtml = `
                    <div class="flex items-center justify-between gap-2 pt-1">
                        <span class="text-[11px] text-gray-500">建立個人檔案後即可點選答案參與匿名回覆</span>
                        <button type="button" onclick="switchTab('profile')" class="px-4 py-2 rounded-xl bg-pink-100 text-[#8f4452] text-xs font-bold hover:bg-pink-200 transition">
                            先去建檔
                        </button>
                    </div>
                `;
            } else {
                const nextAnonNum = resps.length + 1;
                actionFooterHtml = `
                    <div class="space-y-2.5 pt-2 border-t border-pink-100">
                        <input type="text" value="${escapeWishHtml(noteVal)}" oninput="onWishResponseNoteInput('${escapeWishHtml(w.id)}', this.value)"
                            placeholder="選填：寫一句補充理由給題主（僅題主可見，其他玩家看不到）..." class="input-jp !py-2 !text-xs">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="text-[11px] text-gray-500">送出後你的匿名代號將顯示為 <strong class="text-[#8f4452]">匿名${nextAnonNum}號</strong></span>
                            <button type="button" onclick="submitWishResponse('${escapeWishHtml(w.id)}')"
                                class="btn-sakura px-5 py-2 rounded-xl text-xs font-bold shadow-2xs">
                                💌 送出回答（成為匿名${nextAnonNum}號）
                            </button>
                        </div>
                    </div>
                `;
            }

            const authorG = String(w.authorGender || '').trim() === '男' ? '男' : '女';
            const authorBadgeStyle = authorG === '男'
                ? 'bg-sky-100 text-sky-800 border border-sky-200'
                : 'bg-rose-100 text-[#8f4452]';
            let authorIdentityLabel = `匿名(${authorG})`;
            if (isMine) {
                authorIdentityLabel = `匿名(${authorG})(自己的題目)`;
            } else if (myResp) {
                authorIdentityLabel = `匿名(${authorG})(已回答)`;
            }
            const isPubExpanded = expandedPublicWishes.has(String(w.id));
            const isPinnedWish = Boolean(w.isPinned);
            const pinnedPillHtml = isPinnedWish
                ? `<span class="px-2 py-0.5 rounded-full bg-gradient-to-r from-[#e79aa8] to-[#c96a7b] text-white text-[11px] font-bold shrink-0 whitespace-nowrap shadow-2xs">📌</span>`
                : '';

            return `
                <div id="publicWishCard_${escapeWishHtml(w.id)}" class="glass-card rounded-2xl px-4 py-3 ${isPinnedWish ? 'border-2 border-[#c96a7b] bg-gradient-to-r from-rose-50/55 via-white to-pink-50/45 shadow-sm' : 'border border-pink-200 shadow-2xs'} space-y-3 transition-all duration-300">
                    <div class="flex items-center justify-between gap-2 cursor-pointer select-none" onclick="togglePublicWishExpand('${escapeWishHtml(w.id)}')">
                        <div class="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 overflow-x-auto">
                            ${pinnedPillHtml}
                            <h4 class="text-xs sm:text-sm font-bold font-serif-jp text-[#7a3542] truncate">🏮 ${escapeWishHtml(w.title)}</h4>
                            <span class="px-2 py-0.5 rounded-full ${authorBadgeStyle} text-[10px] font-bold shrink-0 whitespace-nowrap">
                                ${authorIdentityLabel}
                            </span>
                        </div>
                        <span class="text-base text-[#c96a7b] shrink-0 transform transition-transform ${isPubExpanded ? 'rotate-180' : ''}">▾</span>
                    </div>

                    ${isPubExpanded ? `
                    <div class="pt-3 border-t border-pink-100 space-y-3">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                                ⏳ 剩餘 ${remDays} 天（${formatWishShortDateTime(w.expiresAtTs)} 截止）
                            </span>
                        </div>
                        <div class="space-y-2.5">
                            ${questionsBlockHtml}
                        </div>

                        <div class="p-3 rounded-2xl bg-white/90 border border-pink-100">
                            ${anonSummaryHtml}
                        </div>

                        ${actionFooterHtml}
                    </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        if (publicPaginationBar) {
            if (totalOpenPages <= 1) {
                publicPaginationBar.classList.add('hidden');
                publicPaginationBar.innerHTML = '';
            } else {
                publicPaginationBar.classList.remove('hidden');
                const showFrom = openStartIdx + 1;
                const showTo = Math.min(openStartIdx + WISH_PUBLIC_PER_PAGE, totalOpenCount);
                const pageBtns = [];
                for (let p = 1; p <= totalOpenPages; p++) {
                    const isCur = p === wishPublicListPage;
                    pageBtns.push(`
                        <button type="button" onclick="goToWishPublicPage(${p})" class="min-w-[28px] h-7 px-2 rounded-lg font-bold transition ${isCur ? 'bg-[#c96a7b] text-white shadow-2xs' : 'bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50'}">
                            ${p}
                        </button>
                    `);
                }
                publicPaginationBar.innerHTML = `
                    <span class="text-gray-500 font-medium">顯示第 ${showFrom}～${showTo} 則，共 ${totalOpenCount} 則（第 ${wishPublicListPage}/${totalOpenPages} 頁）</span>
                    <div class="flex items-center gap-1.5">
                        <button type="button" onclick="goToWishPublicPage(${wishPublicListPage - 1})" ${wishPublicListPage <= 1 ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                            ◀ 上一頁
                        </button>
                        ${pageBtns.join('')}
                        <button type="button" onclick="goToWishPublicPage(${wishPublicListPage + 1})" ${wishPublicListPage >= totalOpenPages ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                            下一頁 ▶
                        </button>
                    </div>
                `;
            }
        }
    }

    // 3. 渲染近期已結束祈願紀錄（僅記錄近 10 筆，最多顯示 5 個，第 6 個顯示在第二頁）
    if (pastHistoryBox) {
        const recentEndedTen = endedWishes.slice(0, WISH_PAST_MAX_RECORDS);
        if (recentEndedTen.length === 0) {
            pastHistoryBox.classList.add('hidden');
            pastHistoryBox.innerHTML = '';
        } else {
            pastHistoryBox.classList.remove('hidden');
            const totalPastCount = recentEndedTen.length;
            const totalPastPages = Math.max(1, Math.ceil(totalPastCount / WISH_PAST_PER_PAGE));
            if (wishPastHistoryPage > totalPastPages) wishPastHistoryPage = totalPastPages;
            if (wishPastHistoryPage < 1) wishPastHistoryPage = 1;
            const pastStartIdx = (wishPastHistoryPage - 1) * WISH_PAST_PER_PAGE;
            const pageEndedWishes = recentEndedTen.slice(pastStartIdx, pastStartIdx + WISH_PAST_PER_PAGE);

            const pastPageBtns = [];
            for (let p = 1; p <= totalPastPages; p++) {
                const isCur = p === wishPastHistoryPage;
                pastPageBtns.push(`
                    <button type="button" onclick="goToWishPastPage(${p})" class="min-w-[28px] h-7 px-2 rounded-lg font-bold transition ${isCur ? 'bg-[#c96a7b] text-white shadow-2xs' : 'bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50'}">
                        ${p}
                    </button>
                `);
            }

            const pastPaginationHtml = totalPastPages > 1 ? `
                <div class="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span class="text-gray-500 font-medium">顯示第 ${pastStartIdx + 1}～${Math.min(pastStartIdx + WISH_PAST_PER_PAGE, totalPastCount)} 筆，近 ${totalPastCount} 筆紀錄（第 ${wishPastHistoryPage}/${totalPastPages} 頁）</span>
                    <div class="flex items-center gap-1.5">
                        <button type="button" onclick="goToWishPastPage(${wishPastHistoryPage - 1})" ${wishPastHistoryPage <= 1 ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                            ◀ 上一頁
                        </button>
                        ${pastPageBtns.join('')}
                        <button type="button" onclick="goToWishPastPage(${wishPastHistoryPage + 1})" ${wishPastHistoryPage >= totalPastPages ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                            下一頁 ▶
                        </button>
                    </div>
                </div>
            ` : '';

            pastHistoryBox.innerHTML = `
                <div class="flex items-center justify-between px-1">
                    <h3 class="text-sm font-bold font-serif-jp text-gray-500">📜 近期已結束的祈願紀錄（僅保留近 5 筆）</h3>
                </div>
                <div class="space-y-2">
                    ${pageEndedWishes.map(w => {
                        const resps = w.responses || [];
                        let resultBadge = `<span class="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold">已結束・等待題主選擇中</span>`;
                        if (w.settled && w.matchedAnonNumber) {
                            resultBadge = `<span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">💘 已挑選「匿名${w.matchedAnonNumber}號」配對成功</span>`;
                        } else if (w.settled && w.settledWithoutMatch) {
                            resultBadge = `<span class="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold">🍃 本輪未選擇配對對象</span>`;
                        }
                        const pAuthorG = String(w.authorGender || '').trim() === '男' ? '男' : '女';
                        const isMineEnded = myPid && String(w.authorId) === myPid;
                        const myEndedResp = myPid ? resps.find(r => String(r.responderId) === myPid) : null;
                        let endedAuthorLabel = `匿名(${pAuthorG})`;
                        if (isMineEnded) endedAuthorLabel = `匿名(${pAuthorG})(自己的題目)`;
                        else if (myEndedResp) endedAuthorLabel = `匿名(${pAuthorG})(已回答)`;
                        return `
                            <div class="px-4 py-3 rounded-2xl bg-white/80 border border-pink-100 flex items-center justify-between gap-2 text-xs shadow-2xs">
                                <div class="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto">
                                    <span class="font-bold text-[#8f4452] truncate">🏮 ${escapeWishHtml(w.title)}</span>
                                    <span class="text-[11px] text-gray-500 shrink-0 whitespace-nowrap">${endedAuthorLabel}・共 ${resps.length} 人回答</span>
                                </div>
                                <div class="shrink-0">${resultBadge}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
                ${pastPaginationHtml}
            `;
        }
    }
}

window.handleHeaderAddWishClick = handleHeaderAddWishClick;
window.refreshWishWallManual = refreshWishWallManual;
window.togglePublicWishExpand = togglePublicWishExpand;
window.toggleWishAnonListExpand = toggleWishAnonListExpand;
window.toggleMyActiveWishExpand = toggleMyActiveWishExpand;
window.onWishPublicGenderFilterChange = onWishPublicGenderFilterChange;
window.goToWishPublicPage = goToWishPublicPage;
window.goToWishPastPage = goToWishPastPage;
window.openEditMyActiveWish = openEditMyActiveWish;
window.cancelEditMyActiveWish = cancelEditMyActiveWish;
window.saveEditedMyActiveWish = saveEditedMyActiveWish;
