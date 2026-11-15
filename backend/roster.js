/* backend/roster.js - 後台玩家資料庫列表、分頁、禁用控制、編輯玩家資料與問題回報 */

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
    }

    saveUsers(users);
    appendLog(`<span class="text-amber-300">[取消場次報名]</span> 已取消玩家 <strong>${target.nickname} (ID:${target.id})</strong> 在「<strong>${normTarget}</strong>」的報名，並同步至前台。`);
}

function togglePlayerMatchBan(playerId) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;

    target.isMatchBanned = !target.isMatchBanned;
    saveUsers(users);

    if (target.isMatchBanned) {
        appendLog(`<span class="text-rose-400">[禁止配對]</span> 已將玩家 <strong>${target.nickname} (ID:${target.id})</strong> 設為「禁止配對」，該玩家即使在前台報名也不會被配對到。`);
    } else {
        appendLog(`<span class="text-emerald-400">[解除限制]</span> 已解除玩家 <strong>${target.nickname} (ID:${target.id})</strong> 的禁止配對限制，恢復正常參與配對。`);
    }
}

function togglePlayerChatBan(playerId) {
    const users = getUsers();
    const target = users.find(u => String(u.id) === String(playerId));
    if (!target) return;

    target.isChatBanned = !target.isChatBanned;
    saveUsers(users);

    if (target.isChatBanned) {
        appendLog(`<span class="text-rose-400">[禁止發話]</span> 已將玩家 <strong>${target.nickname} (ID:${target.id})</strong> 設為「禁止發話」，前台聊天室已鎖定並顯示「請聯繫管理員」。`);
    } else {
        appendLog(`<span class="text-emerald-400">[解除禁言]</span> 已解除玩家 <strong>${target.nickname} (ID:${target.id})</strong> 的禁止發話限制，前台聊天室已恢復正常。`);
    }
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

function deletePlayerEntirely(playerId) {
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
    saveUsers(remaining);
    appendLog(`<span class="text-rose-400">[刪除玩家資料]</span> 已將玩家 <strong>${target.nickname} (ID:${target.id})</strong> 的整個資料徹底刪除。`);
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

    container.innerHTML = ADMIN_EDIT_SECTIONS.map(sec => `
        <div class="space-y-3 p-4 rounded-2xl bg-pink-50/40 border-2 border-pink-200">
            <h4 class="text-sm md:text-base font-bold font-serif-jp text-[#8f4452] border-b border-pink-200/80 pb-1.5">${sec.title}</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                ${sec.fields.map(f => {
                    const val = u[f.key];
                    const curPriv = privMap[f.key] || sec.defaultPrivacy || 'closed';
                    const isWide = (f.type === 'textarea' || f.type === 'multiselect' || f.type === 'regionCity' || f.type === 'mbtiTwoStep');
                    const privSelectHtml = f.lockPrivacy ? '' : `
                        <select id="edit-priv-${f.key}" class="text-[11px] px-2.5 py-1 admin-input-box text-[#8f4452] font-semibold">
                            <option value="open" ${curPriv === 'open' ? 'selected' : ''}>開放給好友</option>
                            <option value="closed" ${curPriv === 'closed' ? 'selected' : ''}>不開放</option>
                        </select>
                    `;

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

    document.getElementById('editPlayerModal').classList.remove('hidden');
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

function onAdminEditSelectOtherChange(key, val) {
    const el = document.getElementById(`edit-field-${key}Other`);
    if (!el) return;
    if (val === '其他') el.classList.remove('hidden');
    else {
        el.classList.add('hidden');
        el.value = '';
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

    const u = { ...users[idx] };
    const nextPrivacy = { ...(u.privacy || {}) };

    ADMIN_EDIT_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (!f.lockPrivacy) {
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

    if (u.mbtiGroup && u.mbtiGroup !== '不知道 / 沒測過' && !u.mbti) {
        alert(`請為該玩家選擇「${u.mbtiGroup}」開頭的具體 MBTI 人格！`);
        return;
    }

    nextPrivacy.gender = 'open';
    nextPrivacy.ig = 'closed';
    nextPrivacy.hobbies = 'open';
    nextPrivacy.oneSentence = 'open';
    nextPrivacy.bio = 'open';
    nextPrivacy.idealPartner = 'open';
    nextPrivacy.icebreakerQuestion = 'open';

    u.privacy = nextPrivacy;
    u.updatedAt = new Date().toLocaleString('zh-TW') + ' (管理員編輯)';
    u.backupCode = generatePlayerBackupCode(u, users);

    users[idx] = u;
    saveUsers(users);

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
    const latestCode = generatePlayerBackupCode(u, users);
    if (u.backupCode !== latestCode) {
        u.backupCode = latestCode;
        saveUsers(users);
    }
    document.getElementById('detailModalTitle').textContent = `🆔 玩家 ID：${u.id}（${u.nickname}）完整資料記錄`;
    const entries = Object.entries(u).filter(([k]) => k !== 'privacy' && k !== 'backupCode');
    const backupBannerHtml = `
        <div class="md:col-span-2 p-3.5 rounded-2xl bg-gradient-to-r from-pink-50 to-rose-50 border border-pink-300 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-bold text-[#8f4452]">🔑 玩家專屬 5 碼英數通行碼（若玩家遺忘可複製提供給對方）</span>
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="document.getElementById('playerDetailModal').classList.add('hidden'); openEditPlayerModal('${u.id}')" class="px-3 py-1 rounded-xl bg-sky-600 text-white text-xs font-bold shadow-sm hover:bg-sky-700 transition">
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
    document.getElementById('detailModalBody').innerHTML = backupBannerHtml + entries.map(([k, v]) => `
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

function formatCriteriaHtml(criteria) {
    const cKeys = Object.keys(criteria || {}).filter(k => !(k === 'city' && criteria.region));
    if (cKeys.length === 0) {
        return '<span class="text-gray-400">未選（不限制隨機配對）</span>';
    }
    return cKeys.map(k => {
        if (k === 'region') {
            const desc = criteria.city ? `${criteria.region}（${criteria.city}）` : `${criteria.region}（全區皆可）`;
            return `居住地區：<strong>${desc}</strong>`;
        }
        return `${FIELD_LABELS[k] || k}：<strong>${criteria[k]}</strong>`;
    }).join(' <span class="text-pink-400">OR</span> ');
}

function renderMemberPageSection(users, sysCfg, batch, currentSched, maxDisplayBatch) {
    const maleCount = users.filter(u => u && u.id && u.gender === '男').length;
    const femaleCount = users.filter(u => u && u.id && u.gender === '女').length;

    const regDesc = document.getElementById('regSwitchDesc');
    const regBtn = document.getElementById('toggleRegSwitchBtn');
    if (regDesc && regBtn) {
        if (sysCfg.registrationOpen) {
            regDesc.className = 'text-[11px] text-emerald-600 font-semibold mt-0.5';
            regDesc.textContent = '目前狀態：🟢 開始報名（玩家可點擊報名）';
            regBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold shadow transition shrink-0 bg-rose-600 text-white hover:bg-rose-700';
            regBtn.textContent = '切換為「人數已滿 不可報名」';
        } else {
            regDesc.className = 'text-[11px] text-rose-600 font-semibold mt-0.5';
            regDesc.textContent = '目前狀態：🚫 人數已滿 不可報名（前台已鎖定報名）';
            regBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold shadow transition shrink-0 bg-emerald-600 text-white hover:bg-emerald-700';
            regBtn.textContent = '切換為「開始報名」';
        }
    }

    const lockDesc = document.getElementById('profileLockSwitchDesc');
    const lockBtn = document.getElementById('toggleProfileLockBtn');
    if (lockDesc && lockBtn) {
        if (!sysCfg.profileLocked) {
            lockDesc.className = 'text-[11px] text-emerald-600 font-semibold mt-0.5';
            lockDesc.textContent = '目前狀態：🟢 開放填寫（玩家可編輯與保存資料）';
            lockBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold shadow transition shrink-0 bg-amber-600 text-white hover:bg-amber-700';
            lockBtn.textContent = '切換為「不讓玩家填寫資料」';
        } else {
            lockDesc.className = 'text-[11px] text-amber-700 font-semibold mt-0.5';
            lockDesc.textContent = '目前狀態：🔒 不讓玩家填寫資料（所有欄位反灰鎖定，隱私設定仍可修改）';
            lockBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold shadow transition shrink-0 bg-emerald-600 text-white hover:bg-emerald-700';
            lockBtn.textContent = '解除鎖定（開放填寫資料）';
        }
    }

    const limitInput = document.getElementById('genderLimitMaxInput');
    if (limitInput && document.activeElement !== limitInput) {
        limitInput.value = sysCfg.genderLimitMax;
    }
    const liveCountBadge = document.getElementById('genderQuotaLiveCount');
    if (liveCountBadge) {
        liveCountBadge.textContent = `目前玩家人數：男生 ${maleCount} 人 ／ 女生 ${femaleCount} 人`;
    }
    const genderLimitDesc = document.getElementById('genderLimitSwitchDesc');
    const genderLimitBtn = document.getElementById('toggleGenderLimitBtn');
    if (genderLimitDesc && genderLimitBtn) {
        if (sysCfg.genderLimitEnabled) {
            const max = sysCfg.genderLimitMax;
            const maleStatus = maleCount >= max ? '（已滿）' : '';
            const femaleStatus = femaleCount >= max ? '（已滿）' : '';
            genderLimitDesc.className = 'text-[11px] text-emerald-600 font-semibold';
            genderLimitDesc.textContent = `目前狀態：🟢 已開啟限制（男上限 ${max} 人${maleStatus} ／ 女上限 ${max} 人${femaleStatus}）`;
            genderLimitBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold shadow transition bg-gray-700 text-white hover:bg-gray-800';
            genderLimitBtn.textContent = '關閉「男女生人數限制」';
        } else {
            genderLimitDesc.className = 'text-[11px] text-gray-500 font-semibold';
            genderLimitDesc.textContent = '目前狀態：⚪ 未開啟（不限制男女生人數）';
            genderLimitBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold shadow transition bg-[#c96a7b] text-white hover:opacity-95';
            genderLimitBtn.textContent = '開啟「男女生人數限制」';
        }
    }

    const forceBatchSel = document.getElementById('forceBatchSelect');
    if (forceBatchSel) {
        const prevForceBatch = forceBatchSel.value;
        const batchOpts = [];
        for (let b = 1; b <= maxDisplayBatch; b++) {
            const info = getBatchScheduleInfo(b);
            batchOpts.push({
                value: info.batchPrefix,
                label: `${info.batchPrefix}（${info.wedDateStr}(三)、${info.satDateStr}(六)）`
            });
        }
        forceBatchSel.innerHTML = batchOpts.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
        if (batchOpts.some(o => o.value === prevForceBatch)) forceBatchSel.value = prevForceBatch;
        else forceBatchSel.value = currentSched.batchPrefix;
    }

    const rulesBox = document.getElementById('forceMatchRulesList');
    if (rulesBox) {
        const rules = getForceRules();
        if (rules.length === 0) {
            rulesBox.innerHTML = `<p class="text-xs text-gray-400">目前尚未設定秘密強制配對規則。</p>`;
        } else {
            rulesBox.innerHTML = rules.map(r => `
                <div class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-white border border-rose-200 text-xs">
                    <div>
                        <span class="px-2 py-0.5 rounded bg-rose-100 text-[#8f4452] font-bold mr-2">${r.batch}</span>
                        <span>管理員 ID: <strong>${r.adminId}</strong> ⇄ 強制配對對象 ID: <strong>${r.targetId}</strong></span>
                        <span class="ml-2 text-[11px] ${r.executed ? 'text-emerald-600 font-bold' : 'text-amber-600'}">
                            ${r.executed ? '（✓ 已無痕配對完成）' : '（🔒 已鎖定）'}
                        </span>
                    </div>
                    <button onclick="removeForceRule('${r.id}')" class="text-rose-500 hover:underline">移除規則</button>
                </div>
            `).join('');
        }
    }

    const filterSelect = document.getElementById('filterBatchRoster');
    const pBody = document.getElementById('playersTableBody');
    if (!filterSelect || !pBody) return;

    const customActsList = (typeof getCustomActivities === 'function')
        ? getCustomActivities()
        : JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
    const prevFilterVal = filterSelect.value || 'all';
    const dynamicFilterOpts = [
        { value: 'all', label: '顯示全部玩家' },
        { value: 'gender:男', label: '只看【性別男】玩家' },
        { value: 'gender:女', label: '只看【性別女】玩家' }
    ];
    for (let b = 1; b <= maxDisplayBatch; b++) {
        const info = getBatchScheduleInfo(b);
        dynamicFilterOpts.push({
            value: `batch:${b}`,
            label: `只看【${info.wedLabel} / ${info.satLabel}】報名名單`
        });
    }
    customActsList.forEach(act => {
        dynamicFilterOpts.push({
            value: `customAct:${act.id}`,
            label: `只看【🎪 ${act.name}】報名名單`
        });
    });
    dynamicFilterOpts.push(
        { value: 'matched', label: '只看已配對中（可彈性解除）' },
        { value: 'banned', label: '只看已禁止配對玩家' },
        { value: 'chatBanned', label: '只看禁止發話玩家' },
        { value: 'warned', label: '只看警告帳號' },
        { value: 'unmatched', label: '只看未配對' }
    );
    filterSelect.innerHTML = dynamicFilterOpts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    if (dynamicFilterOpts.some(o => o.value === prevFilterVal)) {
        filterSelect.value = prevFilterVal;
    }

    const rosterFilter = filterSelect.value;
    const filteredUsers = users.filter(u => {
        const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
        const hasAnyMatch = (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0) || !!u.matchedWithId;
        if (rosterFilter === 'all') return true;
        if (rosterFilter === 'gender:男') return u.gender === '男';
        if (rosterFilter === 'gender:女') return u.gender === '女';
        if (rosterFilter === 'matched') return hasAnyMatch;
        if (rosterFilter === 'banned') return !!u.isMatchBanned;
        if (rosterFilter === 'chatBanned') return !!u.isChatBanned;
        if (rosterFilter === 'warned') return !!u.isWarned;
        if (rosterFilter === 'unmatched') return !hasAnyMatch && !u.isWarned;
        if (rosterFilter.startsWith('customAct:')) {
            const targetActId = rosterFilter.split(':')[1];
            return Boolean(u.customActivityRegs && u.customActivityRegs[targetActId]);
        }
        if (rosterFilter.startsWith('batch:')) {
            const targetPrefix = `第${rosterFilter.split(':')[1]}屆`;
            return sessions.some(s => extractBatchLabel(s) === targetPrefix);
        }
        return sessions.some(s => s.startsWith(rosterFilter));
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

    if (pageUsers.length === 0) {
        pBody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-400">尚無符合篩選條件的玩家資料。</td></tr>`;
    } else {
        pBody.innerHTML = pageUsers.map(u => {
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
            const criteriaHtml = formatCriteriaHtml(u.exactMatchCriteria || {});
            const displayRegion = u.region || inferRegionByCity(u.city);
            const locationLabel = displayRegion ? `${displayRegion}・${u.city || '-'}` : (u.city || '-');
            const displayMbtiGrp = u.mbtiGroup || inferMbtiGroup(u.mbti);
            const mbtiLabel = (u.mbti && u.mbti !== '不知道 / 沒測過' && (displayMbtiGrp === 'I人' || displayMbtiGrp === 'E人'))
                ? `${displayMbtiGrp}(${u.mbti})`
                : (u.mbti || '-');

            const historyList = Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0
                ? u.matchedHistory
                : (u.matchedWithId ? [{ partnerId: u.matchedWithId, partnerName: u.matchedWithName }] : []);

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
                    statusParts.push(`
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                            💘 ${h.partnerName} (ID:${h.partnerId})
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
                    <td class="p-3 min-w-[125px]">
                        <div class="font-bold text-gray-800">${u.nickname}</div>
                        <div class="text-[11px] text-gray-400 break-all">${u.ig || ''} ・ ${u.age || '-'}歲</div>
                    </td>
                    <td class="p-3 text-xs min-w-[175px] leading-relaxed">${u.gender} ・ ${u.zodiac || '-'} ・ ${mbtiLabel}<br><span class="text-gray-500">${u.status === '其他' && u.statusOther ? `其他（${u.statusOther}）` : (u.status || '-')} ・ ${locationLabel}</span></td>
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
                    <td class="p-3 text-xs min-w-[235px]">
                        <div class="flex flex-wrap gap-1.5">
                            <button onclick="viewPlayerDetail('${u.id}')" class="px-2 py-1 rounded-lg border border-pink-200 text-[#8f4452] hover:bg-pink-50 whitespace-nowrap">詳情</button>
                            <button onclick="openEditPlayerModal('${u.id}')" title="編輯此玩家的個人資料" class="px-2 py-1 rounded-lg bg-sky-600 text-white font-semibold hover:bg-sky-700 whitespace-nowrap">✏️ 編輯資料</button>
                            <button onclick="copyPlayerBackupCode('${u.id}')" title="一鍵複製此玩家的 5 碼備份／還原通行碼" class="px-2 py-1 rounded-lg bg-pink-100 border border-pink-300 text-[#8f4452] font-mono font-bold hover:bg-pink-200 whitespace-nowrap">🔑 ${u.backupCode || '備份碼'}</button>
                            <button onclick="togglePlayerMatchBan('${u.id}')" class="px-2 py-1 rounded-lg font-semibold text-white whitespace-nowrap ${u.isMatchBanned ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-700 hover:bg-gray-800'}">
                                ${u.isMatchBanned ? '✅ 解除配對限制' : '🚫 禁止配對'}
                            </button>
                            <button onclick="togglePlayerChatBan('${u.id}')" class="px-2 py-1 rounded-lg font-semibold text-white whitespace-nowrap ${u.isChatBanned ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}">
                                ${u.isChatBanned ? '🔊 解除禁言' : '🔇 禁止發話'}
                            </button>
                            <button onclick="deletePlayerEntirely('${u.id}')" class="px-2 py-1 rounded-lg bg-rose-600 text-white font-semibold hover:bg-rose-700 whitespace-nowrap">🗑️ 刪除資料</button>
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
        privacy: { ...freshBase.privacy, gender: 'open', ig: 'closed' }
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
