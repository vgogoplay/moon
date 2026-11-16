/* frontend/activities.js - 前台首頁即時統計圖表、常規場次報名與第 2 種專屬活動報名 */

// ==================== 前台首頁：即時男女比例與 I人 / E人 / 不知道・沒測過 統計圖表 ====================
function renderHomeStatsCharts() {
    const totalBadge = document.getElementById('homeStatsTotalBadge');
    const donutBox = document.getElementById('genderDonutChartBox');
    const ieDonutBox = document.getElementById('ieDonutChartBox');
    if (!totalBadge || !donutBox || !ieDonutBox) return;

    const rawUsersStr = localStorage.getItem(USERS_KEY) || '[]';
    lastUsersStatsSnapshot = rawUsersStr;

    let users = [];
    try {
        users = JSON.parse(rawUsersStr);
        if (!Array.isArray(users)) users = [];
    } catch (e) {
        users = [];
    }

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

    const genderTotal = maleCount + femaleCount;
    const malePct = genderTotal > 0 ? Math.round((maleCount / genderTotal) * 100) : 0;
    const femalePct = genderTotal > 0 ? (100 - malePct) : 0;

    totalBadge.textContent = `總計 ${totalCount} 人`;
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
            <span class="text-lg font-bold font-serif-jp text-[#8f4452] leading-tight">${totalCount} 人</span>
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

    openRegisterModal();
}

function openRegisterModal() {
    if (!Store.getSystemConfig().registrationOpen) {
        showMiniNotice('🚫 人數已滿 不可報名', '本屆報名名額已滿，目前暫不開放報名。');
        return;
    }

    const sched = getBatchScheduleInfo(getCurrentBatchNumber());
    const wedLabel = sched.wedLabel;
    const satLabel = sched.satLabel;
    const savedSessions = Array.isArray(appState.registeredSessions) ? appState.registeredSessions : [];

    document.getElementById('sessionOptionsList').innerHTML = [wedLabel, satLabel].map(opt => {
        const checked = savedSessions.some(s => isSameSession(s, opt));
        return `
            <label class="flex items-center gap-2.5 p-3 rounded-2xl border border-pink-200 bg-pink-50/40 cursor-pointer hover:bg-pink-50">
                <input type="checkbox" name="regSessionCheck" value="${opt}" ${checked ? 'checked' : ''} onchange="onRegSessionCheckChange()" class="accent-[#c96a7b] w-4 h-4">
                <div>
                    <div class="font-bold text-xs text-[#8f4452]">${opt}</div>
                    <div class="text-[10px] text-gray-500">20:00 準時進行配對</div>
                </div>
            </label>
        `;
    }).join('');
    onRegSessionCheckChange();
    const cancelRegBtn = document.getElementById('cancelRegularRegBtn');
    if (cancelRegBtn) {
        cancelRegBtn.classList.toggle('hidden', savedSessions.length === 0);
    }

    const savedCriteria = appState.exactMatchCriteria || {};
    document.getElementById('exactMatchOptionsList').innerHTML = EXACT_MATCH_OPTIONS.map(item => {
        const isChecked = Object.prototype.hasOwnProperty.call(savedCriteria, item.key);
        const selectedVal = savedCriteria[item.key] || item.choices[0];
        return `
            <div class="p-2 rounded-xl border border-pink-100 bg-white space-y-1.5">
                <label class="flex items-center gap-2 text-xs font-semibold text-[#5e464a] cursor-pointer">
                    <input type="checkbox" name="exactFieldCheck" value="${item.key}" ${isChecked ? 'checked' : ''} onchange="toggleExactSelect('${item.key}')" class="accent-[#c96a7b]">
                    <span>${item.label}</span>
                </label>
                <select id="exact-select-${item.key}" class="input-jp !py-1 !text-xs ${isChecked ? '' : 'hidden'}">
                    ${item.choices.map(c => `<option value="${c}" ${selectedVal === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
        `;
    }).join('');

    document.getElementById('registerModal').classList.remove('hidden');
}

window.onRegSessionCheckChange = function() {
    const checkedSessions = Array.from(document.querySelectorAll('input[name="regSessionCheck"]:checked')).map(cb => cb.value);
    const submitBtn = document.querySelector('#registerModal button[onclick="confirmRegistration()"]');
    if (submitBtn) {
        if (checkedSessions.length === 0) {
            submitBtn.textContent = '💾 保存設定（取消場次報名）';
        } else {
            submitBtn.textContent = `✨ 確認送出報名（已選 ${checkedSessions.length} 場）`;
        }
    }
};

window.toggleExactSelect = function(key) {
    const cb = document.querySelector(`input[name="exactFieldCheck"][value="${key}"]`);
    const sel = document.getElementById(`exact-select-${key}`);
    if (cb && sel) {
        sel.classList.toggle('hidden', !cb.checked);
    }
};

function closeRegisterModal() {
    document.getElementById('registerModal').classList.add('hidden');
}

function formatCriteriaDisplayList(criteria) {
    const keys = Object.keys(criteria || {}).filter(k => k !== 'city');
    return keys.map(k => {
        if (k === 'region') {
            return `當前居住地區：${criteria.region}`;
        }
        const label = EXACT_MATCH_OPTIONS.find(o => o.key === k)?.label || k;
        return `${label}：${criteria[k]}`;
    });
}

async function cancelRegularRegistration() {
    const prevCancelledSessions = Array.isArray(appState.registeredSessions) ? [...appState.registeredSessions] : [];
    document.querySelectorAll('input[name="regSessionCheck"]').forEach(cb => {
        cb.checked = false;
    });
    delete appState.registeredSession;
    appState.registeredSessions = [];
    appState.exactMatchCriteria = {};
    if (appState.playerId && typeof ActivityRegArchive !== 'undefined') {
        prevCancelledSessions.forEach(s => ActivityRegArchive.removeRegular(s, appState.playerId));
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

    const selectedSessions = Array.from(document.querySelectorAll('input[name="regSessionCheck"]:checked')).map(cb => cb.value);

    const criteria = {};
    document.querySelectorAll('input[name="exactFieldCheck"]:checked').forEach(cb => {
        const key = cb.value;
        const sel = document.getElementById(`exact-select-${key}`);
        if (sel && sel.value) {
            criteria[key] = sel.value;
        }
    });

    const prevRegisteredList = Array.isArray(appState.registeredSessions) ? [...appState.registeredSessions] : [];
    const finalCriteria = selectedSessions.length === 0 ? {} : criteria;
    delete appState.registeredSession;
    appState.registeredSessions = selectedSessions;
    appState.exactMatchCriteria = finalCriteria;
    if (appState.playerId && typeof ActivityRegArchive !== 'undefined') {
        prevRegisteredList.forEach(oldS => {
            const stillSelected = selectedSessions.some(ns => isSameSession(ns, oldS));
            if (!stillSelected) {
                ActivityRegArchive.removeRegular(oldS, appState.playerId);
            }
        });
    }

    closeRegisterModal();
    refreshAllUI();
    await Store.save(appState, true);
    refreshAllUI();

    const displayItems = formatCriteriaDisplayList(finalCriteria);
    const desc = displayItems.length > 0
        ? '已指定條件（其中一項符合即可配對）：\n' + displayItems.map(item => `・${item}`).join('\n')
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
        const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
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
    const savedFortune = (existingReg && existingReg.fortuneNumber) ? String(existingReg.fortuneNumber) : '';
    const savedTwoChoice = (existingReg && existingReg.twoChoiceValue) ? String(existingReg.twoChoiceValue) : '';

    document.getElementById('customActModalId').value = String(act.id);
    document.getElementById('customActModalType').value = actType;
    document.getElementById('customActSelectedFortune').value = savedFortune;
    document.getElementById('customActSelectedTwoChoice').value = savedTwoChoice;

    const modalTimeNote = schedState.hasSchedule
        ? `⏰ 活動時間：${schedState.windowText || '不限'}${schedState.matchText ? ` ｜ 💘 配對時間：${schedState.matchText}` : ''}`
        : '此為後台創建的獨立專屬活動，與週三／週六常規自動配對互不影響';
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
            statusBox.innerHTML = `📣 <strong>【${act.name}】開放獨立報名中！</strong><br>確認報名後，管理員將於後台進行配對（完全不影響您週三／週六的常規配對）。`;
            cancelBtn.classList.add('hidden');
            confirmBtn.classList.remove('hidden');
            confirmBtn.textContent = `✨ 確認報名【${act.name}】`;
        }

        document.getElementById('customActExactOptionsList').innerHTML = EXACT_MATCH_OPTIONS.map(item => {
            const isChecked = Object.prototype.hasOwnProperty.call(savedCriteria, item.key);
            const selectedVal = savedCriteria[item.key] || item.choices[0];
            return `
                <div class="p-2 rounded-xl border border-pink-100 bg-white space-y-1.5">
                    <label class="flex items-center gap-2 text-xs font-semibold text-[#5e464a] cursor-pointer">
                        <input type="checkbox" name="customActExactCheck" value="${item.key}" ${isChecked ? 'checked' : ''} onchange="toggleCustomActExactSelect('${item.key}')" class="accent-[#c96a7b]">
                        <span>${item.label}</span>
                    </label>
                    <select id="custom-exact-select-${item.key}" class="input-jp !py-1 !text-xs ${isChecked ? '' : 'hidden'}">
                        ${item.choices.map(c => `<option value="${c}" ${selectedVal === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
            `;
        }).join('');
    }

    document.getElementById('customActivityModal').classList.remove('hidden');
}

window.toggleCustomActExactSelect = function(key) {
    const cb = document.querySelector(`input[name="customActExactCheck"][value="${key}"]`);
    const sel = document.getElementById(`custom-exact-select-${key}`);
    if (cb && sel) sel.classList.toggle('hidden', !cb.checked);
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

    const criteria = {};
    document.querySelectorAll('input[name="customActExactCheck"]:checked').forEach(cb => {
        const key = cb.value;
        const sel = document.getElementById(`custom-exact-select-${key}`);
        if (sel && sel.value) criteria[key] = sel.value;
    });

    customActivitySyncSuppressUntil = Date.now() + 6000;
    appState.customActivityRegs[act.id] = {
        activityId: String(act.id),
        activityName: act.name,
        activityType: 'classic',
        registeredAt: Date.now(),
        exactMatchCriteria: criteria
    };

    closeCustomActivityModal();
    refreshAllUI();
    await Store.save(appState, true);
    customActivitySyncSuppressUntil = Date.now() + 2500;
    refreshAllUI();

    const displayItems = formatCriteriaDisplayList(criteria);
    const desc = displayItems.length > 0
        ? '此活動指定條件（其中一項符合即可配對）：\n' + displayItems.map(item => `・${item}`).join('\n')
        : '未勾選額外條件（不限制，將進行隨機配對）';

    showMiniNotice('🎪 專屬活動報名成功', `已成功報名【${act.name}】！\n（此為獨立活動，不影響週三／週六場次）\n\n${desc}`);
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

    showMiniNotice('🍃 已取消報名', `已取消報名【${actName}】（不影響週三／週六常規配對）。`);
}

function refreshAllUI() {
    const sysConfig = Store.getSystemConfig();
    const quota = Store.getGenderQuotaStatus();
    const complete = isProfileComplete() && !!appState.playerId;
    const isBothGenderFullForNew = !appState.playerId && quota.bothFull;
    const batchNum = sysConfig.currentBatch;
    const sched = getBatchScheduleInfo(batchNum);
    const normalizedAllSessions = Array.from(new Set((appState.registeredSessions || []).map(s => normalizeSessionLabel(s)).filter(Boolean)));
    const currentBatchSessions = normalizedAllSessions.filter(s =>
        sched.sessions.some(target => isSameSession(s, target))
    );

    const periodBadgeEl = document.getElementById('currentPeriodBadge');
    if (periodBadgeEl) {
        periodBadgeEl.textContent = `目前開放：${sched.batchPrefix}（${sched.wedDateStr}(三) / ${sched.satDateStr}(六)）`;
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
        alertBox.innerHTML = `<span class="text-rose-600 font-bold">本屆報名人數已滿，目前暫停開放報名！</span><br>已成功報名的玩家將如期於週三 / 週六 20:00 進行配對。`;
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
    } else if (currentBatchSessions.length > 0) {
        const displayItems = formatCriteriaDisplayList(appState.exactMatchCriteria || {});
        const criteriaSummary = displayItems.length > 0
            ? displayItems.join(' 或 ')
            : '不限制（隨機配對）';
        badge.textContent = `⏳ 已報名 (${currentBatchSessions.length}場)`;
        applyBtn.disabled = false;
        applyBtn.textContent = `✅ 已報名【${currentBatchSessions.join('、')}】（點此修改）`;
        alertBox.innerHTML = `你已成功報名 <strong>${currentBatchSessions.join('、')}</strong>！<br>配對條件：<strong>${criteriaSummary}</strong>。`;
    } else {
        badge.textContent = `✨ ${sched.batchPrefix}開始報名中`;
        applyBtn.disabled = false;
        applyBtn.textContent = `🌸 開始報名（${sched.wedLabel} / ${sched.satLabel}）`;
        alertBox.innerHTML = `目前開放報名 <strong>${sched.wedLabel}</strong> 或 <strong>${sched.satLabel}</strong>（可複選），有報名才會參與配對！`;
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
            const allUsersForActCheck = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
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
                    const cList = formatCriteriaDisplayList(reg.exactMatchCriteria || {});
                    const cSummary = cList.length > 0 ? cList.join(' 或 ') : '不限制（隨機配對）';
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
                    <p class="font-bold text-[#8f4452]">✨ 獨立專屬活動通知（與上方週三／週六場次互不影響）：</p>
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
    renderHomeStatsCharts();
    renderFriendsSection();
}
