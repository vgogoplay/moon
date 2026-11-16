/* backend/custom-activities.js - 後台第 2 種自定義活動（新增、編輯、配對與清除已報名名單） */

// ==================== 🎪 第 2 種活動（自定義活動）管理與 3 種配對引擎 ====================
const expandedCustomActivityCards = new Set();

function toggleCustomActivityCardExpand(activityId) {
    const key = String(activityId || '').trim();
    if (!key) return;
    if (expandedCustomActivityCards.has(key)) {
        expandedCustomActivityCards.delete(key);
    } else {
        expandedCustomActivityCards.add(key);
    }
    renderAdminAll();
}

function openCreateCustomActivityModal() {
    const modal = document.getElementById('createCustomActivityModal');
    if (modal) {
        modal.classList.remove('hidden');
        const nameInput = document.getElementById('newCustomActivityName');
        if (nameInput) setTimeout(() => nameInput.focus(), 50);
    }
}

function closeCreateCustomActivityModal() {
    const modal = document.getElementById('createCustomActivityModal');
    if (modal) modal.classList.add('hidden');
}

function onCustomActivityTypeChange(typeVal) {
    const twoChoiceWrap = document.getElementById('newCustomTwoChoiceWrap');
    const descWrap = document.getElementById('newCustomDescWrap');
    const nameInput = document.getElementById('newCustomActivityName');
    if (!twoChoiceWrap || !descWrap) return;

    if (typeVal === 'two_choice') {
        twoChoiceWrap.classList.remove('hidden');
        descWrap.classList.add('hidden');
        if (nameInput && !nameInput.value.trim()) {
            nameInput.placeholder = '例如：默契大考驗';
        }
    } else if (typeVal === 'fortune_number') {
        twoChoiceWrap.classList.add('hidden');
        descWrap.classList.remove('hidden');
        if (nameInput && !nameInput.value.trim()) {
            nameInput.placeholder = '例如：月老籤詩';
        }
    } else {
        twoChoiceWrap.classList.add('hidden');
        descWrap.classList.remove('hidden');
        if (nameInput && !nameInput.value.trim()) {
            nameInput.placeholder = '例如：a活動、七夕特別場';
        }
    }
}

function getCustomActivities() {
    try {
        const arr = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
        return Array.isArray(arr) ? arr.filter(a => a && typeof a === 'object' && a.id) : [];
    } catch (e) {
        return [];
    }
}

function saveCustomActivities(list) {
    const clean = Array.isArray(list) ? list : [];
    localStorage.setItem(CUSTOM_ACTIVITIES_KEY, JSON.stringify(clean));
    renderAdminAll();
}

function createCustomActivity() {
    const typeSelect = document.getElementById('newCustomActivityType');
    const nameInput = document.getElementById('newCustomActivityName');
    const twoChoiceInput = document.getElementById('newCustomTwoChoiceText');
    const descInput = document.getElementById('newCustomActivityDesc');
    const openSelect = document.getElementById('newCustomActivityInitialOpen');
    const startInput = document.getElementById('newCustomActStartTime');
    const endInput = document.getElementById('newCustomActEndTime');
    const matchInput = document.getElementById('newCustomActMatchTime');

    const activityType = typeSelect ? typeSelect.value : 'classic';
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    const isOpen = openSelect.value === 'true';
    const startTime = startInput ? startInput.value.trim() : '';
    const endTime = endInput ? endInput.value.trim() : '';
    const matchTime = matchInput ? matchInput.value.trim() : '';

    if (!name) {
        alert('請輸入自定義活動名稱！');
        nameInput.focus();
        return;
    }

    const startTimeTs = parseLocalDateTimeTs(startTime);
    const endTimeTs = parseLocalDateTimeTs(endTime);
    const matchTimeTs = parseLocalDateTimeTs(matchTime);

    if (startTimeTs && endTimeTs && endTimeTs <= startTimeTs) {
        alert('「報名結束時間」必須晚於「活動開始時間」！');
        if (endInput) endInput.focus();
        return;
    }
    if (endTimeTs && matchTimeTs && matchTimeTs < endTimeTs) {
        alert('「自動配對時間」不能早於「報名結束時間」（需等報名截止後才能進行配對）！');
        if (matchInput) matchInput.focus();
        return;
    }

    let optionA = '';
    let optionB = '';
    let twoChoiceText = '';

    if (activityType === 'two_choice') {
        twoChoiceText = (twoChoiceInput ? twoChoiceInput.value : '').trim();
        const parts = twoChoiceText.split(/[\/／]/).map(s => s.trim()).filter(Boolean);
        if (parts.length !== 2 || parts[0] === parts[1]) {
            alert('第 3 類「二選一活動」請手動輸入兩個不相同的選項，並以 / 分隔（例如：大海/森林）！');
            if (twoChoiceInput) twoChoiceInput.focus();
            return;
        }
        optionA = parts[0];
        optionB = parts[1];
        twoChoiceText = `${optionA}/${optionB}`;
    }

    const list = getCustomActivities();
    if (list.some(a => String(a.name).trim() === name)) {
        alert(`已存在名稱為「${name}」的活動，請使用不同名稱！`);
        return;
    }

    const newAct = {
        id: 'ACT_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        name: name,
        activityType: activityType,
        twoChoiceText: twoChoiceText,
        optionA: optionA,
        optionB: optionB,
        description: description,
        startTime: startTime,
        endTime: endTime,
        matchTime: matchTime,
        startTimeTs: startTimeTs,
        endTimeTs: endTimeTs,
        matchTimeTs: matchTimeTs,
        autoMatchedDone: false,
        isOpen: isOpen,
        matchCount: 0,
        lastMatchedAt: '',
        createdAtTs: Date.now(),
        createdAt: new Date().toLocaleString('zh-TW')
    };

    expandedCustomActivityCards.add(String(newAct.id));
    list.push(newAct);
    saveCustomActivities(list);
    CloudSync.putNode(`${CUSTOM_ACTIVITIES_KEY}/${newAct.id}`, newAct);

    nameInput.value = '';
    descInput.value = '';
    if (twoChoiceInput) twoChoiceInput.value = '';
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    if (matchInput) matchInput.value = '';
    closeCreateCustomActivityModal();

    const schedSummary = formatCustomActivityTimeSummary(newAct);
    const timeNote = schedSummary.hasSchedule
        ? `，時間：${schedSummary.windowText || '不限'}${schedSummary.matchText ? `、配對：${schedSummary.matchText}` : ''}`
        : '';
    const typeLabelMap = {
        classic: '第1類：原本機制報名',
        fortune_number: '第2類：月老籤詩 1~5 號（僅限男女配對）',
        two_choice: `第3類：二選一（${twoChoiceText}・僅限男女配對）`
    };
    appendLog(`<span class="text-amber-300">[新增第2種活動]</span> 已建立「<strong>${newAct.name}</strong>」（${typeLabelMap[activityType] || ''}${timeNote}，狀態：<strong>${isOpen ? '🟢 開啟中，前台已顯示報名按鈕' : '⚪ 已關閉，前台暫不顯示'}</strong>）。`);
}

function openEditCustomActivityModal(activityId) {
    const list = getCustomActivities();
    const act = list.find(a => String(a.id) === String(activityId));
    if (!act) return;

    document.getElementById('editActId').value = act.id;
    document.getElementById('editActType').value = act.activityType || 'classic';
    document.getElementById('editActName').value = act.name || '';
    document.getElementById('editActTwoChoiceText').value = act.twoChoiceText || '';
    document.getElementById('editActDesc').value = act.description || '';
    const editStartEl = document.getElementById('editActStartTime');
    const editEndEl = document.getElementById('editActEndTime');
    const editMatchEl = document.getElementById('editActMatchTime');
    if (editStartEl) editStartEl.value = act.startTime || '';
    if (editEndEl) editEndEl.value = act.endTime || '';
    if (editMatchEl) editMatchEl.value = act.matchTime || '';

    onEditCustomActivityTypeChange(act.activityType || 'classic');
    document.getElementById('editCustomActivityModal').classList.remove('hidden');
}

function closeEditCustomActivityModal() {
    document.getElementById('editCustomActivityModal').classList.add('hidden');
}

function onEditCustomActivityTypeChange(typeVal) {
    const twoChoiceWrap = document.getElementById('editActTwoChoiceWrap');
    if (twoChoiceWrap) {
        if (typeVal === 'two_choice') {
            twoChoiceWrap.classList.remove('hidden');
        } else {
            twoChoiceWrap.classList.add('hidden');
        }
    }
}

function saveEditedCustomActivity(e) {
    e.preventDefault();
    const actId = document.getElementById('editActId').value;
    const actType = document.getElementById('editActType').value;
    const actName = document.getElementById('editActName').value.trim();
    const actTwoChoiceText = document.getElementById('editActTwoChoiceText').value.trim();
    const actDesc = document.getElementById('editActDesc').value.trim();
    const actStartTime = document.getElementById('editActStartTime')?.value.trim() || '';
    const actEndTime = document.getElementById('editActEndTime')?.value.trim() || '';
    const actMatchTime = document.getElementById('editActMatchTime')?.value.trim() || '';

    if (!actName) {
        alert('請輸入活動名稱！');
        return;
    }

    const startTimeTs = parseLocalDateTimeTs(actStartTime);
    const endTimeTs = parseLocalDateTimeTs(actEndTime);
    const matchTimeTs = parseLocalDateTimeTs(actMatchTime);

    if (startTimeTs && endTimeTs && endTimeTs <= startTimeTs) {
        alert('「報名結束時間」必須晚於「活動開始時間」！');
        document.getElementById('editActEndTime')?.focus();
        return;
    }
    if (endTimeTs && matchTimeTs && matchTimeTs < endTimeTs) {
        alert('「自動配對時間」不能早於「報名結束時間」！');
        document.getElementById('editActMatchTime')?.focus();
        return;
    }

    let optionA = '';
    let optionB = '';
    let twoChoiceText = '';

    if (actType === 'two_choice') {
        twoChoiceText = actTwoChoiceText;
        const parts = twoChoiceText.split(/[\/／]/).map(s => s.trim()).filter(Boolean);
        if (parts.length !== 2 || parts[0] === parts[1]) {
            alert('第 3 類「二選一活動」請手動輸入兩個不相同的選項，並以 / 分隔（例如：大海/森林）！');
            document.getElementById('editActTwoChoiceText').focus();
            return;
        }
        optionA = parts[0];
        optionB = parts[1];
        twoChoiceText = `${optionA}/${optionB}`;
    }

    const list = getCustomActivities();
    const actIdx = list.findIndex(a => String(a.id) === String(actId));
    if (actIdx === -1) return;

    if (list.some(a => String(a.id) !== String(actId) && String(a.name).trim() === actName)) {
        alert(`已存在名稱為「${actName}」的活動，請使用不同名稱！`);
        return;
    }

    const prevAct = list[actIdx];
    const isFutureMatchReset = matchTimeTs > Date.now() && Number(prevAct.matchTimeTs || 0) !== matchTimeTs;

    const updatedAct = {
        ...prevAct,
        name: actName,
        activityType: actType,
        twoChoiceText: twoChoiceText,
        optionA: optionA,
        optionB: optionB,
        description: actDesc,
        startTime: actStartTime,
        endTime: actEndTime,
        matchTime: actMatchTime,
        startTimeTs: startTimeTs,
        endTimeTs: endTimeTs,
        matchTimeTs: matchTimeTs,
        autoMatchedDone: isFutureMatchReset ? false : Boolean(prevAct.autoMatchedDone)
    };

    if (isFutureMatchReset && prevAct.matchTimeTs) {
        const oldLockNodeKey = `${actId}_${Number(prevAct.matchTimeTs)}`;
        try {
            localStorage.removeItem(`yuelao_custom_act_lock_${oldLockNodeKey}`);
        } catch (e) {}
        if (typeof CloudSync !== 'undefined') {
            CloudSync.deleteNode(`yuelao_custom_act_locks/${oldLockNodeKey}`);
        }
    }

    list[actIdx] = updatedAct;
    saveCustomActivities(list);
    CloudSync.putNode(`${CUSTOM_ACTIVITIES_KEY}/${actId}`, updatedAct);

    closeEditCustomActivityModal();
    appendLog(`<span class="text-sky-300">[編輯自定義活動]</span> 已更新自定義活動「<strong>${actName}</strong>」的設定。`);
}

function toggleCustomActivityOpen(activityId) {
    const list = getCustomActivities();
    const act = list.find(a => String(a.id) === String(activityId));
    if (!act) return;

    act.isOpen = !act.isOpen;
    saveCustomActivities(list);
    CloudSync.putNode(`${CUSTOM_ACTIVITIES_KEY}/${act.id}`, act);

    const statusStr = act.isOpen ? '🟢 開啟中（前台首頁已顯示報名按鈕）' : '⚪ 已關閉（前台首頁已隱藏按鈕）';
    appendLog(`<span class="text-amber-300">[活動狀態切換]</span> 自定義活動「<strong>${act.name}</strong>」已切換為：<strong>${statusStr}</strong>。`);
}

async function clearCustomActivityRegistrations(activityId) {
    const list = getCustomActivities();
    const act = list.find(a => String(a.id) === String(activityId));
    if (!act) return;

    const users = getUsers();
    const regUsers = users.filter(u => u && u.id && u.customActivityRegs && u.customActivityRegs[act.id]);
    if (regUsers.length === 0) {
        alert(`【${act.name}】目前尚無已報名的玩家。`);
        return;
    }

    if (!confirm(`確定要清除【${act.name}】當前所有已報名的玩家（共 ${regUsers.length} 人）嗎？\n\n清除後，這些玩家在【${act.name}】的報名狀態與勾選的條件／號碼／二選一選項都會一併取消（不影響其他活動報名與已配對好友）。`)) {
        return;
    }

    const clearedNames = [];
    const affectedUsers = [];
    users.forEach(u => {
        if (u && u.customActivityRegs && Object.prototype.hasOwnProperty.call(u.customActivityRegs, act.id)) {
            delete u.customActivityRegs[act.id];
            if (Object.keys(u.customActivityRegs).length === 0) {
                delete u.customActivityRegs;
            }
            u.updatedAt = new Date().toLocaleString('zh-TW');
            clearedNames.push(`${u.id}(${u.nickname})`);
            affectedUsers.push(u);
        }
    });

    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    renderAdminAll();

    if (typeof ActivityRegArchive !== 'undefined') {
        affectedUsers.forEach(u => ActivityRegArchive.removeCustom(act.id, u.id));
    }
    if (typeof CloudSync !== 'undefined') {
        for (const u of affectedUsers) {
            await CloudSync.upsertUser(u, true);
            await CloudSync.deleteNode(`${USERS_KEY}/${u.id}/customActivityRegs/${act.id}`);
        }
    }
    renderAdminAll();
    appendLog(`<span class="text-amber-300">[清除活動報名名單]</span> 已清除專屬活動「<strong>${act.name}</strong>」當前所有已報名玩家（共 ${clearedNames.length} 人：${clearedNames.join('、')}），並取消其勾選的活動選項（其他活動報名不受影響）。`);
}

async function clearSinglePlayerCustomActivityReg(activityId, playerId) {
    const list = getCustomActivities();
    const act = list.find(a => String(a.id) === String(activityId));
    if (!act) return;

    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target || !target.customActivityRegs || !target.customActivityRegs[act.id]) return;

    if (!confirm(`確定要取消玩家「${target.nickname} (ID:${target.id})」在【${act.name}】的報名與所有勾選選項嗎？\n（不影響該玩家在其他活動的報名與已配對好友）`)) {
        return;
    }

    delete target.customActivityRegs[act.id];
    if (Object.keys(target.customActivityRegs).length === 0) {
        delete target.customActivityRegs;
    }
    target.updatedAt = new Date().toLocaleString('zh-TW');

    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    renderAdminAll();

    if (typeof ActivityRegArchive !== 'undefined') {
        ActivityRegArchive.removeCustom(act.id, target.id);
    }
    if (typeof CloudSync !== 'undefined') {
        await CloudSync.upsertUser(target, true);
        await CloudSync.deleteNode(`${USERS_KEY}/${target.id}/customActivityRegs/${act.id}`);
    }
    renderAdminAll();
    appendLog(`<span class="text-amber-300">[取消單人活動報名]</span> 已取消玩家 <strong>${target.nickname} (ID:${target.id})</strong> 在「<strong>${act.name}</strong>」的報名與勾選選項。`);
}

function deleteCustomActivity(activityId) {
    const list = getCustomActivities();
    const act = list.find(a => String(a.id) === String(activityId));
    if (!act) return;

    if (!confirm(`確定要刪除自定義活動「${act.name}」嗎？\n（已配對成功的好友名單仍會安全保留，僅移除此活動報名入口）`)) {
        return;
    }

    if (act.matchTimeTs) {
        const oldLockNodeKey = `${activityId}_${Number(act.matchTimeTs)}`;
        try {
            localStorage.removeItem(`yuelao_custom_act_lock_${oldLockNodeKey}`);
        } catch (e) {}
        if (typeof CloudSync !== 'undefined') {
            CloudSync.deleteNode(`yuelao_custom_act_locks/${oldLockNodeKey}`);
        }
    }
    if (typeof ActivityRegArchive !== 'undefined') {
        ActivityRegArchive.removeAllForCustomActivity(activityId);
    }
    const remaining = list.filter(a => String(a.id) !== String(activityId));
    saveCustomActivities(remaining);
    CloudSync.deleteNode(`${CUSTOM_ACTIVITIES_KEY}/${activityId}`);
    appendLog(`<span class="text-rose-300">[刪除自定義活動]</span> 已刪除自定義活動「<strong>${act.name}</strong>」。`);
}

function areAlreadyFriends(userA, userB) {
    return (userA.matchedHistory || []).some(h => String(h.partnerId) === String(userB.id)) ||
           String(userA.matchedWithId) === String(userB.id);
}

function acceptsCandidateForCustomActivity(seeker, candidate, activityId) {
    const reg = seeker.customActivityRegs && seeker.customActivityRegs[activityId];
    const criteria = (reg && reg.exactMatchCriteria) ? reg.exactMatchCriteria : {};
    if (typeof sharedMatchesGenderPreference === 'function' && !sharedMatchesGenderPreference(seeker, candidate, criteria)) {
        return false;
    }
    const otherKeys = Object.keys(criteria).filter(k => k !== 'gender' && !(k === 'city' && criteria.region));
    if (otherKeys.length === 0) return true;
    return otherKeys.some(k => sharedCheckSingleCriterion(k, criteria[k], candidate, criteria));
}

function canPairInCustomActivity(A, B, activityId) {
    if (areAlreadyFriends(A, B)) return false;
    return acceptsCandidateForCustomActivity(A, B, activityId) &&
           acceptsCandidateForCustomActivity(B, A, activityId);
}

async function runCustomActivityMatch(activityId, isAuto = false) {
    const res = await executeCustomActivityMatchCore(activityId, { isAuto, markScheduledDone: isAuto });
    if (!res || !res.executed) return;

    if (!isAuto) {
        if (res.pairCount > 0) {
            alert(`🎉【${res.actName}】自動配對完成！\n\n本次共成功配對 ${res.pairCount} 對${res.unmatchedCount > 0 ? `（${res.unmatchedCount} 人落單未配對）` : ''}，已即時同步至雙方前台好友名單！`);
        } else {
            alert(`ℹ️【${res.actName}】目前尚無可配對的組合。\n\n（可能原因：同號碼異性／同選項異性待配對人數不足，或報名玩家的指定條件尚未遇到符合對象。）`);
        }
    }
}


function renderActivitiesPageSection(users, batch, maxDisplayBatch) {
    const customActsList = getCustomActivities();
    const customActsAdminBox = document.getElementById('customActivitiesAdminList');
    if (customActsAdminBox) {
        if (customActsList.length === 0) {
            customActsAdminBox.innerHTML = `<p class="text-xs text-gray-400">尚未創建任何第 2 種自定義活動（可點擊右上角「➕ 新增活動」建立）。</p>`;
        } else {
            customActsAdminBox.innerHTML = customActsList.map(act => {
                const isExpanded = expandedCustomActivityCards.has(String(act.id));
                const actType = act.activityType || 'classic';
                const typeBadgeHtml = actType === 'fortune_number'
                    ? `<span class="text-[11px] px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold">🎋 第2類：月老籤詩 1~5 號（男女配對）</span>`
                    : (actType === 'two_choice'
                        ? `<span class="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold">⚖️ 第3類：二選一（${act.optionA || ''} / ${act.optionB || ''}・男女配對）</span>`
                        : `<span class="text-[11px] px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold">🎯 第1類：原本機制報名</span>`);

                const regUsers = users.filter(u => u && u.id && u.customActivityRegs && u.customActivityRegs[act.id]);
                const regSummary = regUsers.length > 0
                    ? regUsers.map(u => {
                        const regObj = u.customActivityRegs[act.id] || {};
                        const alreadyMatched = (u.matchedHistory || []).some(h =>
                            String(h.activityId || '') === String(act.id) || String(h.session || '') === String(act.name)
                        );
                        let pickTag = '';
                        if (actType === 'fortune_number' && regObj.fortuneNumber) {
                            pickTag = ` [第${regObj.fortuneNumber}首]`;
                        } else if (actType === 'two_choice' && regObj.twoChoiceValue) {
                            pickTag = ` [${regObj.twoChoiceValue}]`;
                        }
                        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono ${alreadyMatched ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}">${u.id}(${u.nickname})${pickTag}${alreadyMatched ? ' ✓已配對' : ''}<button type="button" onclick="clearSinglePlayerCustomActivityReg('${act.id}', '${u.id}')" title="取消此玩家在【${act.name}】的報名與勾選選項" class="text-rose-600 hover:text-rose-900 font-bold ml-0.5">✕</button></span>`;
                    }).join(' ')
                    : '<span class="text-gray-400">尚無玩家報名</span>';

                const schedState = getCustomActivityScheduleState(act);
                let scheduleBadgeHtml = '';
                if (schedState.hasSchedule) {
                    const phaseBadgeColor = schedState.status === 'matched'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : (schedState.status === 'waiting_match'
                            ? 'bg-amber-50 border-amber-300 text-amber-900'
                            : (schedState.status === 'upcoming'
                                ? 'bg-sky-50 border-sky-300 text-sky-800'
                                : 'bg-rose-50 border-rose-200 text-[#8f4452]'));
                    scheduleBadgeHtml = `
                        <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                            ${schedState.windowText ? `<span class="px-2.5 py-0.5 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold">⏰ 活動時間：${schedState.windowText}</span>` : ''}
                            ${schedState.matchText ? `<span class="px-2.5 py-0.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-semibold">💘 配對時間：${schedState.matchText}</span>` : ''}
                            ${act.isOpen ? `<span class="px-2.5 py-0.5 rounded-lg border font-bold ${phaseBadgeColor}">${schedState.label}</span>` : ''}
                        </div>
                    `;
                }

                const expandedBodyHtml = isExpanded ? `
                    <div class="p-4 pt-3 border-t border-pink-100 bg-pink-50/20 flex flex-col lg:flex-row lg:items-stretch justify-between gap-3">
                        <div class="space-y-2 min-w-0 flex-1 p-3 rounded-xl bg-white border border-pink-200">
                            <div class="flex flex-wrap items-center gap-2">
                                ${typeBadgeHtml}
                                <span class="text-[11px] px-2 py-0.5 rounded-full bg-pink-50 border border-pink-200 text-[#c96a7b] font-semibold">
                                    累計配對 ${act.matchCount || 0} 對
                                </span>
                            </div>
                            ${scheduleBadgeHtml}
                            ${act.description ? `<p class="text-xs text-gray-600 bg-pink-50/40 px-2.5 py-1.5 rounded-lg border border-pink-100">${act.description}</p>` : ''}
                            <div class="text-xs text-gray-600 flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-pink-50/25 border border-pink-100">
                                <span class="font-bold text-[#5e464a]">已報名（${regUsers.length} 人）：</span>
                                ${regSummary}
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 shrink-0 p-3 rounded-xl bg-amber-50/35 border border-amber-200">
                            <button type="button" onclick="openEditCustomActivityModal('${act.id}')" class="px-3.5 py-2 rounded-xl border border-sky-200 text-xs font-bold transition bg-sky-50 text-sky-700 hover:bg-sky-100">
                                ✏️ 編輯
                            </button>
                            <button type="button" onclick="toggleCustomActivityOpen('${act.id}')" class="px-3.5 py-2 rounded-xl text-xs font-bold transition ${act.isOpen ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-emerald-600 text-white hover:bg-emerald-700'}">
                                ${act.isOpen ? '切換為「關閉」' : '開啟活動（前台顯示）'}
                            </button>
                            <button type="button" onclick="runCustomActivityMatch('${act.id}')" class="px-4 py-2 rounded-xl bg-gradient-to-r from-[#e598a6] to-[#c96a7b] text-white text-xs font-bold shadow hover:opacity-95 transition">
                                💘 執行【${act.name}】配對
                            </button>
                            <button type="button" onclick="clearCustomActivityRegistrations('${act.id}')" ${regUsers.length === 0 ? 'disabled' : ''} title="清除此活動當前所有已報名玩家，並取消其勾選的活動選項" class="px-3.5 py-2 rounded-xl border text-xs font-bold transition ${regUsers.length === 0 ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed' : 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'}">
                                🧹 清除已報名（${regUsers.length}人）
                            </button>
                            <button type="button" onclick="deleteCustomActivity('${act.id}')" class="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold hover:bg-rose-100">
                                🗑️ 刪除
                            </button>
                        </div>
                    </div>
                ` : '';

                return `
                    <div class="rounded-2xl bg-white border ${act.isOpen ? 'border-emerald-300' : 'border-pink-200'} overflow-hidden transition shadow-2xs">
                        <button type="button" onclick="toggleCustomActivityCardExpand('${act.id}')" class="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-amber-50/35 transition">
                            <div class="flex flex-wrap items-center gap-2 min-w-0">
                                <span class="text-[11px] px-2.5 py-0.5 rounded-full font-bold ${act.isOpen ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-gray-100 text-gray-600 border border-gray-300'}">
                                    ${act.isOpen ? '🟢 開啟中' : '⚪ 已關閉'}
                                </span>
                                <span class="text-xs md:text-sm font-bold text-[#8f4452] truncate">🎪 ${act.name}</span>
                            </div>
                            <span class="text-xs font-semibold text-[#c96a7b] shrink-0">
                                ${isExpanded ? '▴ 收合管理' : '▾ 點開管理活動'}
                            </span>
                        </button>
                        ${expandedBodyHtml}
                    </div>
                `;
            }).join('');
        }
    }

    if (typeof renderActivityMatchStatsPanel === 'function') {
        renderActivityMatchStatsPanel(users, customActsList, batch, maxDisplayBatch);
    }
}
