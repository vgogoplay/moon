/* backend/roster.js - 後台玩家資料庫列表、分頁、禁用控制、編輯玩家資料與問題回報 */

const rosterMultiFilterState = {
    genders: new Set(),
    regions: new Set()
};

function syncRosterMultiFilterUI() {
    const menu = document.getElementById('rosterMultiFilterMenu');
    if (menu) {
        menu.querySelectorAll('input[type="checkbox"][data-roster-filter-type]').forEach(cb => {
            const type = cb.dataset.rosterFilterType;
            const val = cb.value;
            if (type === 'gender') {
                cb.checked = rosterMultiFilterState.genders.has(val);
            } else if (type === 'region') {
                cb.checked = rosterMultiFilterState.regions.has(val);
            }
        });
    }

    const summaryEl = document.getElementById('rosterMultiFilterSummary');
    const clearBtn = document.getElementById('clearRosterMultiFilterBtn');
    const genderLabels = { '男': '男生', '女': '女生' };
    const chips = [];

    ['男', '女'].forEach(g => {
        if (rosterMultiFilterState.genders.has(g)) {
            chips.push(`
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 border border-rose-300 text-[#8f4452] text-[11px] font-bold">
                    ${genderLabels[g] || g}
                    <span role="button" tabindex="0" onclick="event.stopPropagation(); removeRosterMultiFilter('gender', '${g}')" title="移除此條件" class="hover:text-rose-700 cursor-pointer ml-0.5">✕</span>
                </span>
            `);
        }
    });

    ['北部', '中部', '南部', '東部'].forEach(r => {
        if (rosterMultiFilterState.regions.has(r)) {
            chips.push(`
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-bold">
                    ${r}
                    <span role="button" tabindex="0" onclick="event.stopPropagation(); removeRosterMultiFilter('region', '${r}')" title="移除此條件" class="hover:text-rose-700 cursor-pointer ml-0.5">✕</span>
                </span>
            `);
        }
    });

    if (summaryEl) {
        summaryEl.innerHTML = chips.length > 0
            ? chips.join('')
            : '<span class="text-gray-500">全部（可複選）</span>';
    }
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', chips.length === 0);
    }
}

window.toggleRosterMultiFilterMenu = function(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('rosterMultiFilterMenu');
    if (!menu) return;
    syncRosterMultiFilterUI();
    menu.classList.toggle('hidden');
};

window.closeRosterMultiFilterMenu = function() {
    const menu = document.getElementById('rosterMultiFilterMenu');
    if (menu) menu.classList.add('hidden');
};

window.onRosterMultiFilterCheckboxChange = function(cb) {
    if (!cb) return;
    const type = cb.dataset.rosterFilterType;
    const val = cb.value;
    const targetSet = type === 'gender' ? rosterMultiFilterState.genders : rosterMultiFilterState.regions;
    if (cb.checked) targetSet.add(val);
    else targetSet.delete(val);
    syncRosterMultiFilterUI();
    currentRosterPage = 1;
    renderAdminAll();
};

window.removeRosterMultiFilter = function(type, val) {
    const targetSet = type === 'gender' ? rosterMultiFilterState.genders : rosterMultiFilterState.regions;
    targetSet.delete(val);
    syncRosterMultiFilterUI();
    currentRosterPage = 1;
    renderAdminAll();
};

window.clearRosterMultiFilters = function() {
    rosterMultiFilterState.genders.clear();
    rosterMultiFilterState.regions.clear();
    syncRosterMultiFilterUI();
    currentRosterPage = 1;
    renderAdminAll();
};

if (typeof document !== 'undefined' && !window._rosterMultiFilterOutsideBound) {
    window._rosterMultiFilterOutsideBound = true;
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('rosterMultiFilterWrap');
        const menu = document.getElementById('rosterMultiFilterMenu');
        if (wrap && menu && !menu.classList.contains('hidden') && !wrap.contains(e.target)) {
            menu.classList.add('hidden');
        }
    });
}

let rosterSearchDebounceTimer = null;
window.onRosterSearchInput = function(val) {
    rosterSearchKeyword = String(val || '').trim();
    const clearBtn = document.getElementById('clearRosterSearchBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', rosterSearchKeyword === '');
    }
    currentRosterPage = 1;
    if (rosterSearchDebounceTimer) clearTimeout(rosterSearchDebounceTimer);
    rosterSearchDebounceTimer = setTimeout(() => {
        rosterSearchDebounceTimer = null;
        renderAdminAll();
    }, 180);
};

function clearPlayerRegularSession(playerId, sessionLabel) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;

    const normTarget = normalizeSessionLabel(sessionLabel);
    if (!confirm(`確定要取消玩家「${target.nickname} (ID:${target.id})」在【${normTarget}】的場次報名嗎？\n取消後前台將即時同步更新為未勾選狀態。`)) {
        return;
    }

    const prevSessions = Array.isArray(target.registeredSessions) ? target.registeredSessions : [];
    target.registeredSessions = prevSessions.filter(s => !isSameSession(s, normTarget));
    delete target.registeredSession;
    if (target.registeredSessions.length === 0) {
        target.exactMatchCriteria = {};
        target.mustMatchKeys = [];
    }

    if (typeof ActivityRegArchive !== 'undefined') {
        ActivityRegArchive.removeRegular(normTarget, target.id);
    }
    if (typeof saveSingleUserPatch === 'function') {
        saveSingleUserPatch(users, target, {
            registeredSessions: target.registeredSessions,
            registeredSession: null,
            exactMatchCriteria: target.exactMatchCriteria || {},
            mustMatchKeys: target.mustMatchKeys || []
        });
    } else {
        saveUsers(users);
    }
    appendLog(`<span class="text-amber-300">[取消場次報名]</span> 已取消玩家 <strong>${target.nickname} (ID:${target.id})</strong> 在「<strong>${normTarget}</strong>」的報名，並同步至前台。`);
}

let pendingAdminActionCallback = null;
let currentDetailModalPlayerId = null;

function requestAdminPasswordForAction(actionLabel, onVerifiedCallback) {
    // C2-a：權限改由 Firebase 管理員登入與資料庫規則保護，不再使用本地寫死的密碼
    if (typeof isAdminAuthenticated === 'function' && !isAdminAuthenticated()) {
        alert('請先登入後台管理員帳號');
        return;
    }
    if (!confirm(`確定要執行「${actionLabel}」嗎？`)) return;
    if (typeof onVerifiedCallback === 'function') onVerifiedCallback();
}

function closeAdminActionPasswordModal() {
    pendingAdminActionCallback = null;
    const modal = document.getElementById('adminActionPasswordModal');
    const inputEl = document.getElementById('adminActionPwdInput');
    const errEl = document.getElementById('adminActionPwdError');
    if (modal) modal.classList.add('hidden');
    if (inputEl) inputEl.value = '';
    if (errEl) errEl.classList.add('hidden');
}

function submitAdminActionPassword(e) {
    if (e) e.preventDefault();
    const cb = pendingAdminActionCallback;
    closeAdminActionPasswordModal();
    if (typeof cb === 'function') cb();
}

function closePlayerDetailModal() {
    currentDetailModalPlayerId = null;
    const modal = document.getElementById('playerDetailModal');
    if (modal) modal.classList.add('hidden');
}

function refreshDetailModalIfOpen(playerId) {
    const modal = document.getElementById('playerDetailModal');
    if (modal && !modal.classList.contains('hidden') && String(currentDetailModalPlayerId) === String(playerId)) {
        viewPlayerDetail(playerId);
    }
}

function executeTogglePlayerMatchBan(playerId) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;

    target.isMatchBanned = !target.isMatchBanned;
    if (typeof saveSingleUserPatch === 'function') {
        saveSingleUserPatch(users, target, { isMatchBanned: target.isMatchBanned });
    } else {
        saveUsers(users);
    }
    refreshDetailModalIfOpen(playerId);

    if (target.isMatchBanned) {
        appendLog(`<span class="text-rose-400">[禁止配對]</span> 已將玩家 <strong>${target.nickname} (ID:${target.id})</strong> 設為「禁止配對」，該玩家即使在前台報名也不會被配對到。`);
    } else {
        appendLog(`<span class="text-emerald-400">[解除限制]</span> 已解除玩家 <strong>${target.nickname} (ID:${target.id})</strong> 的禁止配對限制，恢復正常參與配對。`);
    }
}

function togglePlayerMatchBan(playerId) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;
    const actionLabel = target.isMatchBanned ? '解除配對限制' : '禁止配對';
    requestAdminPasswordForAction(actionLabel, () => executeTogglePlayerMatchBan(playerId));
}

function executeTogglePlayerChatBan(playerId) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;

    target.isChatBanned = !target.isChatBanned;
    if (typeof saveSingleUserPatch === 'function') {
        saveSingleUserPatch(users, target, { isChatBanned: target.isChatBanned });
    } else {
        saveUsers(users);
    }
    refreshDetailModalIfOpen(playerId);

    if (target.isChatBanned) {
        appendLog(`<span class="text-rose-400">[禁止發話]</span> 已將玩家 <strong>${target.nickname} (ID:${target.id})</strong> 設為「禁止發話」，前台聊天室已鎖定並顯示「請聯繫管理員」。`);
    } else {
        appendLog(`<span class="text-emerald-400">[解除禁言]</span> 已解除玩家 <strong>${target.nickname} (ID:${target.id})</strong> 的禁止發話限制，前台聊天室已恢復正常。`);
    }
}

function togglePlayerChatBan(playerId) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;
    const actionLabel = target.isChatBanned ? '解除禁言' : '禁止發話';
    requestAdminPasswordForAction(actionLabel, () => executeTogglePlayerChatBan(playerId));
}

function addBannedRule() {
    const field = document.getElementById('banFieldSelect').value;
    const keyword = document.getElementById('banKeywordInput').value.trim();
    if (!keyword) {
        alert('請輸入要禁止的字眼！');
        return;
    }
    const rules = getBannedRules();
    rules.push({ id: 'BR_' + Date.now(), field, keyword });
    saveBannedRules(rules);
    document.getElementById('banKeywordInput').value = '';
    appendLog(`<span class="text-rose-300">[禁止規則新增]</span> 欄位「${BAN_FIELD_NAMES[field]}」禁止包含「<strong>${keyword}</strong>」，觸犯者將標記為警告帳號且不提供配對。`);
}

function removeBannedRule(ruleId) {
    saveBannedRules(getBannedRules().filter(r => r.id !== ruleId));
}

function executeDeletePlayerEntirely(playerId) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;

    if (!confirm(`確定要將玩家「${target.nickname} (ID:${target.id})」的整個資料徹底刪除嗎？\n此動作無法復原，且會同步清除其配對關係。`)) {
        return;
    }

    users.forEach(u => {
        if (Array.isArray(u.matchedHistory)) {
            u.matchedHistory = u.matchedHistory.filter(h => String(h.partnerId) !== String(playerId));
        }
        if (String(u.matchedWithId) === String(playerId)) {
            u.matchedSession = null;
            u.matchedWithId = null;
            u.matchedWithName = null;
            u.matchedAt = null;
        }
    });

    const allChats = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
    Object.keys(allChats).forEach(k => {
        if (k.split('__').includes(String(playerId))) {
            delete allChats[k];
        }
    });
    localStorage.setItem(CHATS_KEY, JSON.stringify(allChats));

    const remaining = users.filter(u => String(u.id) !== String(playerId));
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.deleteUser === 'function') {
        CloudSync.deleteUser(playerId);
    } else if (typeof CloudSync !== 'undefined') {
        CloudSync.deleteNode(`${USERS_KEY}/${playerId}`);
    }
    saveUsers(remaining, { isMatchMutation: true });
    closePlayerDetailModal();
    appendLog(`<span class="text-rose-400">[刪除玩家資料]</span> 已將玩家 <strong>${target.nickname} (ID:${target.id})</strong> 的整個資料徹底刪除。`);
}

function deletePlayerEntirely(playerId) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;
    requestAdminPasswordForAction('刪除資料', () => executeDeletePlayerEntirely(playerId));
}

// 直接共用 shared/schema.js 的 FIELD_SECTIONS，避免前後台重複維護欄位清單
const ADMIN_EDIT_SECTIONS = FIELD_SECTIONS.map(sec => ({
    title: sec.title,
    defaultPrivacy: sec.defaultPrivacy,
    fields: sec.fields.map(f => ({
        ...f,
        lockPrivacy: Boolean(f.lockPrivacy || f.alwaysOpen || f.autoOpenAfter7Days)
    }))
}));

function openEditPlayerModal(playerId) {
    const u = getUsers().find(item => String(item.id) === String(playerId));
    if (!u) return;

    document.getElementById('editPlayerTargetId').value = String(u.id);
    document.getElementById('editPlayerModalTitle').textContent = `✏️ 編輯玩家資料：${u.nickname}（ID：${u.id}）`;

    const privMap = u.privacy || {};
    const container = document.getElementById('adminEditPlayerFieldsBody');

    const adminSettingsHtml = `
        <div class="space-y-3 p-4 rounded-2xl bg-rose-50/40 border-2 border-rose-200">
            <h4 class="text-sm md:text-base font-bold font-serif-jp text-rose-800 border-b border-rose-200/80 pb-1.5">🛡️ 後台管理員專屬設定</h4>
            <div class="grid grid-cols-1 gap-3.5">
                <div class="p-3.5 rounded-xl bg-white border-2 border-rose-100 space-y-2 shadow-sm">
                    <label class="flex items-center justify-between gap-2 cursor-pointer">
                        <span class="text-xs font-bold text-rose-700">禁止此玩家觸發「20:00 心動抉擇」</span>
                        <input type="checkbox" id="edit-admin-disableConfession" ${u.disableConfession ? 'checked' : ''} class="w-4 h-4 accent-rose-600">
                    </label>
                    <p class="text-[11px] text-gray-500">勾選後，該玩家即使擁有 2 位以上好友，也不會彈出心動抉擇視窗。</p>
                </div>
            </div>
        </div>
    `;

    const sectionsHtml = ADMIN_EDIT_SECTIONS.map(sec => `
        <div class="space-y-3 p-4 rounded-2xl bg-pink-50/40 border-2 border-pink-200">
            <h4 class="text-sm md:text-base font-bold font-serif-jp text-[#8f4452] border-b border-pink-200/80 pb-1.5">${sec.title}</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                ${sec.fields.map(f => {
                    const val = u[f.key];
                    const curPriv = privMap[f.key] || f.defaultPrivacy || sec.defaultPrivacy || 'closed';
                    const isWide = (f.type === 'textarea' || f.type === 'multiselect' || f.type === 'regionCity' || f.type === 'mbtiTwoStep' || f.type === 'petTwoStep');
                    const isNicknameField = (f.key === 'nickname');
                    const curNickLocked = Boolean(u.lockNickname);
                    const privSelectHtml = isNicknameField ? `
                        <select id="edit-priv-${f.key}" onchange="onAdminEditNicknameOptionChange(this.value)" class="text-[11px] px-2.5 py-1 admin-input-box text-[#8f4452] font-semibold">
                            <option value="open" ${(!curNickLocked && curPriv === 'open') ? 'selected' : ''}>開放好友</option>
                            <option value="closed" ${(!curNickLocked && curPriv !== 'open') ? 'selected' : ''}>不開放</option>
                            <option value="no_edit" ${curNickLocked ? 'selected' : ''}>禁止前台修改</option>
                        </select>
                    ` : (f.lockPrivacy ? '' : `
                        <select id="edit-priv-${f.key}" class="text-[11px] px-2.5 py-1 admin-input-box text-[#8f4452] font-semibold">
                            <option value="open" ${curPriv === 'open' ? 'selected' : ''}>開放給好友</option>
                            <option value="closed" ${curPriv === 'closed' ? 'selected' : ''}>不開放</option>
                        </select>
                    `);

                    let controlHtml = '';
                    if (f.type === 'regionCity') {
                        const selReg = u.region || inferRegionByCity(val) || '';
                        const selCity = val || '';
                        const cities = selReg ? (REGION_CITIES[selReg] || []) : [];
                        controlHtml = `
                            <div class="grid grid-cols-2 gap-2">
                                <select id="edit-field-region" onchange="onAdminEditRegionChange(this.value)" class="w-full p-2 admin-input-box text-xs">
                                    <option value="">選擇地區...</option>
                                    ${Object.keys(REGION_CITIES).map(r => `<option value="${r}" ${selReg === r ? 'selected' : ''}>${r}</option>`).join('')}
                                </select>
                                <select id="edit-field-city" class="w-full p-2 admin-input-box text-xs">
                                    <option value="">選擇縣市...</option>
                                    ${cities.map(c => `<option value="${c}" ${selCity === c ? 'selected' : ''}>${c}</option>`).join('')}
                                </select>
                            </div>
                        `;
                    } else if (f.type === 'mbtiTwoStep') {
                        const selGrp = u.mbtiGroup || inferMbtiGroup(val) || '';
                        const selCode = val || '';
                        const subCodes = (selGrp === 'I人' || selGrp === 'E人') ? (MBTI_GROUPS[selGrp] || []) : [];
                        const isUntested = selGrp === '不知道 / 沒測過';
                        controlHtml = `
                            <div class="grid grid-cols-2 gap-2">
                                <select id="edit-field-mbtiGroup" onchange="onAdminEditMbtiGroupChange(this.value)" class="w-full p-2 admin-input-box text-xs">
                                    <option value="">先選 I人 或 E人...</option>
                                    <option value="I人" ${selGrp === 'I人' ? 'selected' : ''}>I人（內向型）</option>
                                    <option value="E人" ${selGrp === 'E人' ? 'selected' : ''}>E人（外向型）</option>
                                    <option value="不知道 / 沒測過" ${isUntested ? 'selected' : ''}>不知道 / 沒測過</option>
                                </select>
                                <select id="edit-field-mbti" ${isUntested ? 'disabled' : ''} class="w-full p-2 admin-input-box text-xs">
                                    ${isUntested
                                        ? '<option value="不知道 / 沒測過" selected>不知道 / 沒測過</option>'
                                        : `
                                            <option value="">再選具體人格...</option>
                                            ${subCodes.map(c => `<option value="${c}" ${selCode === c ? 'selected' : ''}>${c}</option>`).join('')}
                                        `
                                    }
                                </select>
                            </div>
                        `;
                    } else if (f.type === 'petTwoStep') {
                        const selPetStatus = u.hasPetStatus || (typeof inferPetStatus === 'function' ? inferPetStatus(val) : '') || '';
                        const selPetType = (selPetStatus === '有養寵物' && val && val !== '沒有養寵物' && val !== '有養寵物') ? val : '';
                        const isNoPet = selPetStatus === '沒有養寵物';
                        const petOpts = typeof PET_TYPE_OPTIONS !== 'undefined'
                            ? PET_TYPE_OPTIONS
                            : ['狗', '貓', '貓狗都有', '兔子', '倉鼠 / 鼠類', '鳥類', '爬蟲類 / 兩棲', '水族 / 魚蝦', '其他寵物'];
                        controlHtml = `
                            <div class="grid grid-cols-2 gap-2">
                                <select id="edit-field-hasPetStatus" onchange="onAdminEditHasPetStatusChange(this.value)" class="w-full p-2 admin-input-box text-xs">
                                    <option value="">先選是否有養寵物...</option>
                                    <option value="有養寵物" ${selPetStatus === '有養寵物' ? 'selected' : ''}>有養寵物</option>
                                    <option value="沒有養寵物" ${isNoPet ? 'selected' : ''}>沒有養寵物</option>
                                </select>
                                <select id="edit-field-hasPet" ${(!selPetStatus || isNoPet) ? 'disabled' : ''} class="w-full p-2 admin-input-box text-xs">
                                    ${isNoPet
                                        ? '<option value="沒有養寵物" selected>沒有養寵物</option>'
                                        : `
                                            <option value="">${selPetStatus === '有養寵物' ? '再選養什麼動物...' : '先選左側是否有養...'}</option>
                                            ${petOpts.map(pt => `<option value="${pt}" ${selPetType === pt ? 'selected' : ''}>${pt}</option>`).join('')}
                                        `
                                    }
                                </select>
                            </div>
                        `;
                    } else if (f.type === 'select') {
                        const otherTxt = u[`${f.key}Other`] || '';
                        const showOther = f.allowOther && val === '其他';
                        controlHtml = `
                            <select id="edit-field-${f.key}" ${f.allowOther ? `onchange="onAdminEditSelectOtherChange('${f.key}', this.value)"` : ''} class="w-full p-2 admin-input-box text-xs">
                                <option value="">未選擇</option>
                                ${f.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                            </select>
                            ${f.allowOther ? `
                                <input type="text" id="edit-field-${f.key}Other" value="${otherTxt}" placeholder="請填寫其他說明..." class="w-full p-2 mt-1.5 rounded-xl border border-pink-200 bg-white text-xs ${showOther ? '' : 'hidden'}">
                            ` : ''}
                        `;
                    } else if (f.type === 'textarea') {
                        controlHtml = `<textarea id="edit-field-${f.key}" rows="2" class="w-full p-2 admin-input-box text-xs resize-y">${val || ''}</textarea>`;
                    } else if (f.type === 'multiselect') {
                        const arr = Array.isArray(val) ? val : [];
                        const otherTxt = u[`${f.key}Other`] || '';
                        controlHtml = `
                            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 rounded-xl bg-pink-50/30 border border-pink-200">
                                ${f.options.map(opt => `
                                    <label class="flex items-center gap-1.5 text-xs cursor-pointer px-2.5 py-1.5 rounded-lg bg-white border border-pink-200 hover:border-[#c96a7b]">
                                        <input type="checkbox" name="edit-ms-${f.key}" value="${opt}" ${arr.includes(opt) ? 'checked' : ''} onchange="onAdminEditHobbiesChange()" class="accent-[#c96a7b]">
                                        <span>${opt}</span>
                                    </label>
                                `).join('')}
                            </div>
                            <input type="text" id="edit-field-${f.key}Other" value="${otherTxt}" placeholder="請填寫其他興趣..." class="w-full p-2 mt-1.5 rounded-xl border border-pink-200 bg-white text-xs ${arr.includes('其他') ? '' : 'hidden'}">
                        `;
                    } else {
                        const minAttr = f.min !== undefined ? `min="${f.min}"` : '';
                        const maxAttr = f.max !== undefined ? `max="${f.max}"` : '';
                        controlHtml = `<input type="${f.type}" id="edit-field-${f.key}" value="${val ?? ''}" ${minAttr} ${maxAttr} class="w-full p-2 admin-input-box text-xs">`;
                    }

                    return `
                        <div class="${isWide ? 'md:col-span-2' : ''} p-3.5 rounded-xl bg-white border-2 border-pink-200/80 space-y-2 shadow-sm">
                            <div class="flex items-center justify-between gap-2">
                                <label class="text-xs font-bold text-[#5e464a]">${f.label}</label>
                                ${privSelectHtml}
                            </div>
                            ${controlHtml}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');

    container.innerHTML = adminSettingsHtml + sectionsHtml;

    const editModalEl = document.getElementById('editPlayerModal');
    editModalEl.classList.remove('hidden');
    const modalScrollBox = editModalEl.firstElementChild;
    if (modalScrollBox) modalScrollBox.scrollTop = 0;
}

function closeEditPlayerModal() {
    document.getElementById('editPlayerModal').classList.add('hidden');
}

function onAdminEditRegionChange(regionVal) {
    const citySel = document.getElementById('edit-field-city');
    if (!citySel) return;
    const cities = regionVal ? (REGION_CITIES[regionVal] || []) : [];
    citySel.innerHTML = '<option value="">選擇縣市...</option>' +
        cities.map(c => `<option value="${c}">${c}</option>`).join('');
    if (cities.length === 1) citySel.value = cities[0];
}

function onAdminEditMbtiGroupChange(groupVal) {
    const mbtiSel = document.getElementById('edit-field-mbti');
    if (!mbtiSel) return;
    if (groupVal === '不知道 / 沒測過') {
        mbtiSel.disabled = true;
        mbtiSel.innerHTML = '<option value="不知道 / 沒測過" selected>不知道 / 沒測過</option>';
        return;
    }
    if (!groupVal || !MBTI_GROUPS[groupVal]) {
        mbtiSel.disabled = true;
        mbtiSel.innerHTML = '<option value="">先選 I人 或 E人...</option>';
        return;
    }
    const subCodes = MBTI_GROUPS[groupVal];
    mbtiSel.disabled = false;
    mbtiSel.innerHTML = `<option value="">請選擇 ${groupVal} 開頭的人格...</option>` +
        subCodes.map(c => `<option value="${c}">${c}</option>`).join('');
}

function onAdminEditHasPetStatusChange(statusVal) {
    const petSel = document.getElementById('edit-field-hasPet');
    if (!petSel) return;
    if (statusVal === '沒有養寵物') {
        petSel.disabled = true;
        petSel.innerHTML = '<option value="沒有養寵物" selected>沒有養寵物</option>';
        return;
    }
    if (statusVal !== '有養寵物') {
        petSel.disabled = true;
        petSel.innerHTML = '<option value="">先選左側是否有養...</option>';
        return;
    }
    const petOpts = typeof PET_TYPE_OPTIONS !== 'undefined'
        ? PET_TYPE_OPTIONS
        : ['狗', '貓', '貓狗都有', '兔子', '倉鼠 / 鼠類', '鳥類', '爬蟲類 / 兩棲', '水族 / 魚蝦', '其他寵物'];
    petSel.disabled = false;
    petSel.innerHTML = '<option value="">請選擇養什麼動物...</option>' +
        petOpts.map(pt => `<option value="${pt}">${pt}</option>`).join('');
}

function onAdminEditSelectOtherChange(key, val) {
    const el = document.getElementById(`edit-field-${key}Other`);
    if (!el) return;
    if (val === '其他') el.classList.remove('hidden');
    else {
        el.classList.add('hidden');
        el.value = '';
    }
}

function onAdminEditNicknameOptionChange(optVal) {
    if (optVal === 'no_edit') {
        const nickInput = document.getElementById('edit-field-nickname');
        if (nickInput) nickInput.focus();
    }
}

function onAdminEditHobbiesChange() {
    const checked = Array.from(document.querySelectorAll('input[name="edit-ms-hobbies"]:checked')).map(cb => cb.value);
    const otherEl = document.getElementById('edit-field-hobbiesOther');
    if (otherEl) {
        if (checked.includes('其他')) otherEl.classList.remove('hidden');
        else {
            otherEl.classList.add('hidden');
            otherEl.value = '';
        }
    }
}

function saveAdminEditedPlayer(e) {
    e.preventDefault();
    const targetId = document.getElementById('editPlayerTargetId').value.trim();
    const users = getUsers();
    const idx = users.findIndex(u => String(u.id) === String(targetId));
    if (idx < 0) return;

    const prevUser = users[idx];
    const u = { ...prevUser };
    const nextPrivacy = { ...(u.privacy || {}) };

    let nextLockNickname = Boolean(u.lockNickname);
    ADMIN_EDIT_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.key === 'nickname') {
                const nickPrivEl = document.getElementById(`edit-priv-${f.key}`);
                if (nickPrivEl) {
                    const chosenNickOpt = nickPrivEl.value;
                    if (chosenNickOpt === 'no_edit') {
                        nextLockNickname = true;
                        nextPrivacy[f.key] = (nextPrivacy[f.key] === 'open') ? 'open' : 'closed';
                    } else {
                        nextLockNickname = false;
                        nextPrivacy[f.key] = chosenNickOpt === 'open' ? 'open' : 'closed';
                    }
                }
            } else if (!f.lockPrivacy) {
                const privEl = document.getElementById(`edit-priv-${f.key}`);
                if (privEl) nextPrivacy[f.key] = privEl.value;
            }

            if (f.type === 'regionCity') {
                const regVal = document.getElementById('edit-field-region')?.value || '';
                const cityVal = document.getElementById('edit-field-city')?.value || '';
                u.region = regVal || inferRegionByCity(cityVal);
                u.city = cityVal;
            } else if (f.type === 'mbtiTwoStep') {
                const grpVal = document.getElementById('edit-field-mbtiGroup')?.value || '';
                const mbtiVal = document.getElementById('edit-field-mbti')?.value || '';
                u.mbtiGroup = grpVal;
                u.mbti = (grpVal === '不知道 / 沒測過') ? '不知道 / 沒測過' : mbtiVal;
            } else if (f.type === 'petTwoStep') {
                const petStatusVal = document.getElementById('edit-field-hasPetStatus')?.value || '';
                const petVal = document.getElementById('edit-field-hasPet')?.value || '';
                u.hasPetStatus = petStatusVal;
                u.hasPet = (petStatusVal === '沒有養寵物') ? '沒有養寵物' : petVal;
            } else if (f.type === 'multiselect') {
                const checked = Array.from(document.querySelectorAll(`input[name="edit-ms-${f.key}"]:checked`)).map(cb => cb.value);
                u[f.key] = checked;
                if (f.allowOther) {
                    u[`${f.key}Other`] = checked.includes('其他')
                        ? (document.getElementById(`edit-field-${f.key}Other`)?.value.trim() || '')
                        : '';
                }
            } else {
                const el = document.getElementById(`edit-field-${f.key}`);
                if (el) {
                    u[f.key] = el.value.trim();
                }
                if (f.allowOther) {
                    u[`${f.key}Other`] = (u[f.key] === '其他')
                        ? (document.getElementById(`edit-field-${f.key}Other`)?.value.trim() || '')
                        : '';
                }
            }
        });
    });

    const disableConfessionEl = document.getElementById('edit-admin-disableConfession');
    if (disableConfessionEl) {
        u.disableConfession = disableConfessionEl.checked;
    }

    if (u.mbtiGroup && u.mbtiGroup !== '不知道 / 沒測過' && !u.mbti) {
        alert(`請為該玩家選擇「${u.mbtiGroup}」開頭的具體 MBTI 人格！`);
        return;
    }
    if (u.hasPetStatus === '有養寵物' && (!u.hasPet || u.hasPet === '沒有養寵物' || u.hasPet === '有養寵物')) {
        alert('請為該玩家選擇養什麼動物！');
        return;
    }

    nextPrivacy.gender = 'open';
    nextPrivacy.ig = 'closed';
    nextPrivacy.hobbies = 'open';
    nextPrivacy.oneSentence = 'open';
    nextPrivacy.bio = 'open';
    nextPrivacy.icebreakerQuestion = 'open';

    u.lockNickname = nextLockNickname;
    u.privacy = nextPrivacy;
    u.updatedAt = new Date().toLocaleString('zh-TW') + ' (管理員編輯)';
    u.backupCode = (typeof deriveFixedBackupCode === 'function') ? deriveFixedBackupCode(u.id) : (typeof generatePlayerBackupCode === 'function' ? generatePlayerBackupCode(u, users) : u.backupCode);

    users[idx] = u;
    const patchFields = {};
    const skipPatchKeys = new Set([
        'id', 'matchedHistory', 'matchedSession', 'matchedWithId', 'matchedWithName', 'matchedAt',
        'registeredSessions', 'registeredSession', 'exactMatchCriteria', 'customActivityRegs'
    ]);
    Object.keys(u).forEach(k => {
        if (skipPatchKeys.has(k)) return;
        if (JSON.stringify(u[k]) !== JSON.stringify(prevUser[k])) {
            patchFields[k] = u[k];
        }
    });
    if (typeof saveSingleUserPatch === 'function') {
        saveSingleUserPatch(users, u, patchFields);
    } else {
        saveUsers(users);
    }

    localStorage.setItem('yuelao_test_event', JSON.stringify({
        id: 'CMD_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        type: 'FILL_PLAYER_DATA',
        targetPlayerId: String(u.id),
        ts: Date.now()
    }));

    closeEditPlayerModal();
    appendLog(`<span class="text-sky-300">[管理員編輯資料]</span> 已更新玩家 <strong>${u.nickname} (ID:${u.id})</strong> 的個人資料與備份碼，並即時同步至前台！`);
}

function viewPlayerDetail(playerId) {
    const users = getUsers();
    const u = users.find(item => String(item.id) === String(playerId));
    if (!u) return;
    currentDetailModalPlayerId = String(u.id);
    const latestCode = (typeof deriveFixedBackupCode === 'function') ? deriveFixedBackupCode(u.id) : (typeof generatePlayerBackupCode === 'function' ? generatePlayerBackupCode(u, users) : u.backupCode);
    if (u.backupCode !== latestCode) {
        u.backupCode = latestCode;
        saveUsers(users);
    }
    document.getElementById('detailModalTitle').textContent = `🆔 玩家 ID：${u.id}（${u.nickname}）完整資料記錄`;
    const entries = Object.entries(u).filter(([k]) => !['privacy', 'backupCode', 'lastSaveIp', 'lastSaveRegion', 'lastSaveIpAt'].includes(k));

    const topAdminActionsHtml = `
        <div class="md:col-span-2 p-3.5 rounded-2xl bg-rose-50/75 border-2 border-rose-200 flex flex-wrap items-center justify-between gap-2.5">
            <span class="text-xs font-bold text-[#8f4452]">🛡️ 帳號管理操作（需驗證管理員密碼）：</span>
            <div class="flex flex-wrap items-center gap-2">
                <button type="button" onclick="togglePlayerMatchBan('${u.id}')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm transition ${u.isMatchBanned ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-700 hover:bg-gray-800'}">
                    ${u.isMatchBanned ? '✅ 解除配對限制' : '🚫 禁止配對'}
                </button>
                <button type="button" onclick="togglePlayerChatBan('${u.id}')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm transition ${u.isChatBanned ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}">
                    ${u.isChatBanned ? '🔊 解除禁言' : '🔇 禁止發話'}
                </button>
                <button type="button" onclick="deletePlayerEntirely('${u.id}')" class="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold shadow-sm hover:bg-rose-700 transition">
                    🗑️ 刪除資料
                </button>
            </div>
        </div>
    `;

    const backupBannerHtml = `
        <div class="md:col-span-2 p-3.5 rounded-2xl bg-gradient-to-r from-pink-50 to-rose-50 border border-pink-300 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-bold text-[#8f4452]">🔑 玩家專屬 5 碼英數通行碼（若玩家遺忘可複製提供給對方）</span>
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="closePlayerDetailModal(); openEditPlayerModal('${u.id}')" class="px-3 py-1 rounded-xl bg-sky-600 text-white text-xs font-bold shadow-sm hover:bg-sky-700 transition">
                        ✏️ 編輯此玩家資料
                    </button>
                    <button type="button" onclick="copyPlayerBackupCode('${u.id}')" class="px-3 py-1 rounded-xl bg-[#c96a7b] text-white text-xs font-bold shadow-sm hover:opacity-95 transition">
                        📋 一鍵複製 5 碼通行碼
                    </button>
                </div>
            </div>
            <input type="text" readonly onclick="this.select()" value="${latestCode}" class="w-full p-2.5 rounded-xl border border-pink-200 bg-white text-lg font-mono font-bold tracking-[0.28em] text-center text-[#8f4452]">
        </div>
    `;
    const ipGeoBannerHtml = `
        <div class="md:col-span-2 p-3.5 rounded-2xl bg-sky-50/75 border border-sky-200 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div>
                <span class="text-[11px] text-sky-700 font-bold block">🌐 保存資料時 IP 位址</span>
                <span class="font-mono font-bold text-gray-800 break-all">${u.lastSaveIp ? String(u.lastSaveIp).replace(/</g, '&lt;') : '尚未紀錄（待玩家再次保存）'}</span>
            </div>
            <div>
                <span class="text-[11px] text-sky-700 font-bold block">🕒 IP 紀錄時間</span>
                <span class="font-mono text-gray-600">${u.lastSaveIpAt ? String(u.lastSaveIpAt).replace(/</g, '&lt;') : '-'}</span>
            </div>
        </div>
    `;
    document.getElementById('detailModalBody').innerHTML = topAdminActionsHtml + backupBannerHtml + ipGeoBannerHtml + entries.map(([k, v]) => `
        <div class="p-2.5 rounded-xl bg-pink-50/50 border border-pink-100">
            <span class="text-[11px] text-[#c96a7b] font-mono block">${k}</span>
            <span class="font-semibold break-all">${typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '未填')}</span>
        </div>
    `).join('');
    document.getElementById('playerDetailModal').classList.remove('hidden');
}

function toggleReportStatus(reportId) {
    const reports = getReports();
    const target = reports.find(r => r.id === reportId);
    if (target) {
        target.status = target.status === '待處理' ? '已解決' : '待處理';
        localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
        CloudSync.putNode(`${REPORTS_KEY}/${target.id}`, target);
        renderAdminAll();
    }
}

function formatCriteriaHtml(criteria, mustMatchKeys = []) {
    const cKeys = Object.keys(criteria || {}).filter(k => !(k === 'city' && criteria.region));
    if (cKeys.length === 0) {
        return '<span class="text-gray-400">未選（不限制隨機配對）</span>';
    }
    const mustSet = new Set(
        (Array.isArray(mustMatchKeys) ? mustMatchKeys : [])
            .map(String)
            .filter(k => cKeys.includes(k))
            .slice(0, 2)
    );
    const renderOne = (k) => {
        if (k === 'region') {
            return `當前居住地區：<strong>${criteria.region}</strong>`;
        }
        return `${FIELD_LABELS[k] || k}：<strong>${criteria[k]}</strong>`;
    };
    const mustList = cKeys.filter(k => mustSet.has(k)).map(renderOne);
    const orList = cKeys.filter(k => !mustSet.has(k)).map(renderOne);

    const blocks = [];
    if (mustList.length > 0) {
        blocks.push(`<div class="leading-relaxed"><span class="inline-block px-1.5 py-0.2 rounded bg-rose-100 border border-rose-300 text-[#8f4452] text-[10px] font-bold mr-1">🔒 必須吻合</span>${mustList.join(' <span class="text-rose-500 font-bold">AND</span> ')}</div>`);
    }
    if (orList.length > 0) {
        blocks.push(`<div class="leading-relaxed"><span class="inline-block px-1.5 py-0.2 rounded bg-pink-50 border border-pink-200 text-[#c96a7b] text-[10px] font-bold mr-1">✨ 任一符合</span>${orList.join(' <span class="text-pink-400">OR</span> ')}</div>`);
    }
    return blocks.join('');
}

let lastMemberRenderSig = '';

function renderMemberPageSection(users, sysCfg, batch, currentSched, maxDisplayBatch, forceRender = false) {
    const pBodyPre = document.getElementById('playersTableBody');
    if (!pBodyPre) return;

    const selectedGendersList = Array.from(rosterMultiFilterState.genders).sort();
    const selectedRegionsList = Array.from(rosterMultiFilterState.regions).sort();
    const memberSig = JSON.stringify({
        batchPrefix: currentSched.batchPrefix,
        filterGenders: selectedGendersList,
        filterRegions: selectedRegionsList,
        search: rosterSearchKeyword,
        pageSize: rosterPageSize,
        page: currentRosterPage,
        users: users.map(u => [
            u.id, u.nickname, u.gender, u.age, u.ig, u.region, u.city,
            u.registeredSessions, u.customActivityRegs, u.exactMatchCriteria, u.mustMatchKeys,
            u.isMatchBanned, u.isChatBanned, u.isWarned,
            u.matchedHistory, u.matchedWithId, u.matchedWithName, u.matchedSession
        ])
    });

    if (!forceRender && memberSig === lastMemberRenderSig) {
        return;
    }
    lastMemberRenderSig = memberSig;

    const pBody = document.getElementById('playersTableBody');
    if (!pBody) return;

    syncRosterMultiFilterUI();

    const kw = (typeof rosterSearchKeyword === 'string' ? rosterSearchKeyword : '').trim().toLowerCase();
    const filteredUsers = users.filter(u => {
        if (selectedGendersList.length > 0 && !selectedGendersList.includes(String(u.gender || '').trim())) {
            return false;
        }
        if (selectedRegionsList.length > 0) {
            const userRegion = String(u.region || (typeof inferRegionByCity === 'function' ? inferRegionByCity(u.city) : '') || '').trim();
            if (!selectedRegionsList.includes(userRegion)) return false;
        }
        if (!kw) return true;

        const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
        const cRegs = (u.customActivityRegs && typeof u.customActivityRegs === 'object') ? Object.values(u.customActivityRegs) : [];
        const hist = Array.isArray(u.matchedHistory) ? u.matchedHistory : [];
        const haystack = [
            u.id,
            u.nickname,
            u.ig,
            u.gender,
            u.age,
            u.region,
            u.city,
            u.mbti,
            u.backupCode,
            ...sessions,
            ...cRegs.map(cr => cr && cr.activityName),
            ...hist.map(h => `${h.partnerId || ''} ${h.partnerName || ''}`),
            u.matchedWithId,
            u.matchedWithName
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(kw);
    });

    const pageSizeSelectEl = document.getElementById('rosterPageSizeSelect');
    if (pageSizeSelectEl && pageSizeSelectEl.value !== rosterPageSize) {
        pageSizeSelectEl.value = rosterPageSize;
    }

    const totalFiltered = filteredUsers.length;
    const isShowAll = (rosterPageSize === 'all');
    const numericPageSize = isShowAll ? Math.max(1, totalFiltered) : Math.max(1, parseInt(rosterPageSize, 10) || 5);
    const totalRosterPages = isShowAll ? 1 : Math.max(1, Math.ceil(totalFiltered / numericPageSize));
    if (currentRosterPage > totalRosterPages) currentRosterPage = totalRosterPages;
    if (currentRosterPage < 1) currentRosterPage = 1;
    const pageStartIdx = isShowAll ? 0 : (currentRosterPage - 1) * numericPageSize;
    const pageUsers = isShowAll ? filteredUsers : filteredUsers.slice(pageStartIdx, pageStartIdx + numericPageSize);

    const paginationBar = document.getElementById('rosterPaginationBar');
    if (paginationBar) {
        const sizeQuickBtnsHtml = [
            { val: '5', label: '5 人' },
            { val: '10', label: '10 人' },
            { val: '50', label: '50 人' },
            { val: 'all', label: '全部' }
        ].map(opt => {
            const active = rosterPageSize === opt.val;
            return `<button type="button" onclick="onRosterPageSizeChange('${opt.val}')" class="px-2.5 h-7 rounded-lg font-bold transition ${active ? 'bg-[#c96a7b] text-white shadow-sm' : 'bg-white border border-pink-300 text-[#8f4452] hover:bg-pink-100'}">${opt.label}</button>`;
        }).join('');

        if (totalFiltered === 0) {
            paginationBar.innerHTML = `
                <span class="text-gray-400">共 0 筆玩家資料</span>
                <div class="flex items-center gap-1.5">
                    <span class="text-gray-500 font-semibold">每頁顯示：</span>
                    ${sizeQuickBtnsHtml}
                </div>
            `;
        } else {
            const showFrom = pageStartIdx + 1;
            const showTo = isShowAll ? totalFiltered : Math.min(pageStartIdx + numericPageSize, totalFiltered);
            const pageBtns = [];
            for (let p = 1; p <= totalRosterPages; p++) {
                if (p === 1 || p === totalRosterPages || Math.abs(p - currentRosterPage) <= 1) {
                    const isCur = p === currentRosterPage;
                    pageBtns.push(`
                        <button type="button" onclick="goToRosterPage(${p})" class="min-w-[30px] h-7 px-2 rounded-lg font-bold transition ${isCur ? 'bg-[#c96a7b] text-white shadow-sm' : 'bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50'}">
                            ${p}
                        </button>
                    `);
                } else if (pageBtns[pageBtns.length - 1] !== '<span class="px-1 text-gray-400">...</span>') {
                    pageBtns.push('<span class="px-1 text-gray-400">...</span>');
                }
            }
            const modeSummaryText = isShowAll
                ? `目前已顯示全部 <strong>${totalFiltered}</strong> 人`
                : `第 <strong>${currentRosterPage}</strong> / ${totalRosterPages} 頁，每頁 ${numericPageSize} 人`;

            paginationBar.innerHTML = `
                <div class="text-gray-600 font-medium">
                    顯示第 <strong class="text-[#8f4452]">${showFrom}～${showTo}</strong> 人，共 <strong class="text-[#8f4452]">${totalFiltered}</strong> 人（${modeSummaryText}）
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <div class="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-pink-200">
                        <span class="text-gray-500 font-bold">顯示人數：</span>
                        ${sizeQuickBtnsHtml}
                    </div>
                    ${isShowAll ? '' : `
                        <div class="flex flex-wrap items-center gap-1.5">
                            <button type="button" onclick="goToRosterPage(${currentRosterPage - 1})" ${currentRosterPage <= 1 ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                                ◀ 上一頁
                            </button>
                            ${pageBtns.join('')}
                            <button type="button" onclick="goToRosterPage(${currentRosterPage + 1})" ${currentRosterPage >= totalRosterPages ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                                下一頁 ▶
                            </button>
                        </div>
                    `}
                </div>
            `;
        }
    }

    const userNicknameById = new Map();
    users.forEach(item => {
        if (item && item.id) {
            userNicknameById.set(String(item.id).trim(), String(item.nickname || '').trim());
        }
    });

    if (pageUsers.length === 0) {
        const activeFilterNames = [
            ...selectedGendersList.map(g => g === '男' ? '男生' : (g === '女' ? '女生' : g)),
            ...selectedRegionsList
        ];
        const filterDesc = activeFilterNames.length > 0
            ? `尚無同時符合「<strong class="text-[#8f4452]">${activeFilterNames.join(' ＋ ')}</strong>」篩選條件的玩家資料。`
            : '尚無符合篩選條件的玩家資料。';
        const clearLinkHtml = activeFilterNames.length > 0
            ? `<button type="button" onclick="clearRosterMultiFilters()" class="ml-2 px-2.5 py-1 rounded-lg bg-pink-50 border border-pink-300 text-[#8f4452] font-bold hover:bg-pink-100 transition">清除篩選條件</button>`
            : '';
        pBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400">${filterDesc}${clearLinkHtml}</td></tr>`;
    } else {
        pBody.innerHTML = pageUsers.map(u => {
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
            const criteriaHtml = formatCriteriaHtml(u.exactMatchCriteria || {}, u.mustMatchKeys || []);
            const displayRegion = u.region || inferRegionByCity(u.city);
            const locationLabel = displayRegion ? `${displayRegion}・${u.city || '-'}` : (u.city || '-');
            const displayMbtiGrp = u.mbtiGroup || inferMbtiGroup(u.mbti);
            const mbtiLabel = (u.mbti && u.mbti !== '不知道 / 沒測過' && (displayMbtiGrp === 'I人' || displayMbtiGrp === 'E人'))
                ? `${displayMbtiGrp}(${u.mbti})`
                : (u.mbti || '-');

            const selfIdStr = String(u.id || '').trim();
            const rawHistArr = Array.isArray(u.matchedHistory)
                ? u.matchedHistory
                : (u.matchedHistory && typeof u.matchedHistory === 'object' ? Object.values(u.matchedHistory) : []);
            const mergedHistoryMap = new Map();

            rawHistArr.forEach(h => {
                if (!h || typeof h !== 'object') return;
                const pid = String(h.partnerId || '').trim();
                if (!pid || pid === selfIdStr) return;
                const resolvedName = String(h.partnerName || '').trim() || userNicknameById.get(pid) || `玩家_${pid}`;
                const prev = mergedHistoryMap.get(pid);
                if (!prev) {
                    mergedHistoryMap.set(pid, {
                        ...h,
                        partnerId: pid,
                        partnerName: resolvedName
                    });
                } else {
                    mergedHistoryMap.set(pid, {
                        ...prev,
                        ...h,
                        partnerId: pid,
                        partnerName: resolvedName || prev.partnerName,
                        isForceRepaired: Boolean(
                            prev.isForceRepaired ||
                            h.isForceRepaired ||
                            String(prev.session || '').includes('・強制補齊') ||
                            String(h.session || '').includes('・強制補齊') ||
                            String(prev.matchDetail || '').includes('強制補齊') ||
                            String(h.matchDetail || '').includes('強制補齊')
                        )
                    });
                }
            });

            const directPartnerId = String(u.matchedWithId || '').trim();
            if (directPartnerId && directPartnerId !== selfIdStr) {
                const directPartnerName = String(u.matchedWithName || '').trim() || userNicknameById.get(directPartnerId) || `玩家_${directPartnerId}`;
                const directSess = String(u.matchedSession || '').trim();
                const directForceFlag = Boolean(directSess.includes('・強制補齊'));
                const existingDirect = mergedHistoryMap.get(directPartnerId);
                if (!existingDirect) {
                    mergedHistoryMap.set(directPartnerId, {
                        partnerId: directPartnerId,
                        partnerName: directPartnerName,
                        session: directSess,
                        matchedAt: u.matchedAt || 0,
                        isForceRepaired: directForceFlag,
                        matchDetail: directForceFlag ? '・強制補齊' : ''
                    });
                } else {
                    existingDirect.partnerName = existingDirect.partnerName || directPartnerName;
                    if (directForceFlag) {
                        existingDirect.isForceRepaired = true;
                        if (!String(existingDirect.session || '').includes('・強制補齊')) {
                            existingDirect.session = directSess;
                        }
                    }
                }
            }

            const historyList = Array.from(mergedHistoryMap.values());

            let statusParts = [];
            if (u.isMatchBanned) {
                statusParts.push(`<span class="inline-block px-2.5 py-0.5 rounded-full bg-rose-600 text-white font-bold">🚫 禁止配對中</span>`);
            }
            if (u.isChatBanned) {
                statusParts.push(`<span class="inline-block px-2.5 py-0.5 rounded-full bg-amber-600 text-white font-bold">🔇 禁止發話中</span>`);
            }
            if (u.isWarned) {
                statusParts.push(`<span class="inline-block px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold">⚠️ 警告帳號</span>`);
            }
            if (historyList.length > 0) {
                historyList.forEach(h => {
                    const isForceProtected = Boolean(
                        h.isForceRepaired ||
                        String(h.session || '').includes('・強制補齊') ||
                        String(h.matchDetail || '').includes('強制補齊')
                    );
                    const forceTagHtml = isForceProtected
                        ? `<span class="text-[10px] text-amber-800 font-bold">・強制補齊</span>`
                        : '';
                    statusParts.push(`
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                            💘 ${h.partnerName} (ID:${h.partnerId})${forceTagHtml}
                            <button onclick="unmatchPlayerPair('${u.id}', '${h.partnerId}')" title="解除此配對" class="text-rose-600 hover:text-rose-900 font-bold ml-0.5">✕</button>
                        </span>
                    `);
                });
            }
            if (statusParts.length === 0) {
                statusParts.push(`<span class="text-gray-400">未配對</span>`);
            }

            return `
                <tr class="hover:bg-pink-50/30">
                    <td class="p-3 font-mono font-bold text-[#8f4452] whitespace-nowrap">${u.id}</td>
                    <td class="p-3 text-xs min-w-[180px] leading-relaxed">
                        <div class="font-bold text-gray-800">${u.nickname} <span class="font-normal text-[#c96a7b]">（${u.gender || '-'} ・ ${u.age || '-'}歲）</span></div>
                        <div class="text-[11px] text-gray-500 break-all mt-0.5">${u.ig || '-'} ・ ${locationLabel}</div>
                    </td>
                    <td class="p-3 text-xs min-w-[140px]">
                        ${(() => {
                            const regBadges = sessions.map(s => `<span class="inline-flex items-center gap-1 px-2 py-0.5 mr-1 mb-1 rounded-full bg-pink-100 text-[#8f4452] font-semibold whitespace-nowrap">${s}<button type="button" onclick="clearPlayerRegularSession('${u.id}', '${s}')" title="取消此場次報名並同步至前台" class="text-rose-600 hover:text-rose-900 font-bold ml-0.5">✕</button></span>`);
                            const cRegs = (u.customActivityRegs && typeof u.customActivityRegs === 'object') ? Object.values(u.customActivityRegs) : [];
                            cRegs.forEach(cr => {
                                if (cr && cr.activityName) {
                                    const extraPick = cr.fortuneNumber
                                        ? `・第${cr.fortuneNumber}首`
                                        : (cr.twoChoiceValue ? `・${cr.twoChoiceValue}` : '');
                                    regBadges.push(`<span class="inline-block px-2 py-0.5 mr-1 mb-1 rounded-full bg-amber-100 text-amber-900 font-semibold whitespace-nowrap">🎪 ${cr.activityName}${extraPick}</span>`);
                                }
                            });
                            return regBadges.length > 0
                                ? regBadges.join('')
                                : `<span class="px-2.5 py-1 rounded-full bg-gray-100 text-gray-400 whitespace-nowrap">未報名</span>`;
                        })()}
                    </td>
                    <td class="p-3 text-xs min-w-[145px] leading-relaxed">${criteriaHtml}</td>
                    <td class="p-3 text-xs min-w-[140px] space-y-1">${statusParts.join('<br>')}</td>
                    <td class="p-3 text-xs min-w-[135px]">
                        <div class="flex flex-wrap gap-1.5">
                            <button onclick="viewPlayerDetail('${u.id}')" class="px-2.5 py-1 rounded-lg border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 whitespace-nowrap">詳情</button>
                            <button onclick="openEditPlayerModal('${u.id}')" title="編輯此玩家的個人資料" class="px-2.5 py-1 rounded-lg bg-sky-600 text-white font-semibold hover:bg-sky-700 whitespace-nowrap">✏️ 編輯資料</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
}

// ==================== 後台手動新增空白會員 ====================
function openAddNewPlayerModal() {
    document.getElementById('newPlayerGenderSelect').value = '';
    document.getElementById('addNewPlayerModal').classList.remove('hidden');
}

function closeAddNewPlayerModal() {
    document.getElementById('addNewPlayerModal').classList.add('hidden');
}

function submitAddNewPlayer(e) {
    e.preventDefault();
    const gender = document.getElementById('newPlayerGenderSelect').value;
    if (!gender) {
        alert('請選擇性別！');
        return;
    }
    
    const newId = IdAllocator.allocate(gender);
    const newBackupCode = deriveFixedBackupCode(newId);
    const freshBase = Store.getDefaultState();
    
    const newUser = {
        id: newId,
        gender: gender,
        nickname: `未命名玩家_${newId}`,
        region: '',
        city: '',
        mbtiGroup: '',
        mbti: '',
        backupCode: newBackupCode,
        isWarned: false,
        warningReason: '',
        isMatchBanned: false,
        isChatBanned: false,
        registeredSessions: [],
        exactMatchCriteria: {},
        customActivityRegs: {},
        matchedHistory: [],
        matchedSession: null,
        matchedWithId: null,
        matchedWithName: null,
        updatedAt: new Date().toLocaleString('zh-TW'),
        privacy: { ...freshBase.privacy, gender: 'open', ig: 'closed', idealPartner: 'closed' }
    };
    
    const users = getUsers();
    users.unshift(newUser);
    saveUsers(users);
    
    closeAddNewPlayerModal();
    appendLog(`<span class="text-emerald-400">[新增會員]</span> 已為前台新增空白帳號 <strong>ID:${newId}</strong>（性別：${gender}）。通行碼為 <strong>${newBackupCode}</strong>，請交由玩家登入填寫其餘資料。`);
    
    setTimeout(() => {
        alert(`✅ 新增會員成功！\n\n唯一玩家 ID：${newId}\n性別：${gender}\n🔑 通行碼：${newBackupCode}\n\n請將此 5 碼通行碼交給玩家，請對方前往前台「個人與隱私 -> 備份/還原碼」輸入並讀取，即可自行完成後續資料填寫。`);
    }, 100);
}
