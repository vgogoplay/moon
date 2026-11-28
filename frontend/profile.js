/* frontend/profile.js - 前台個人資料表單、隱私控制與 5 碼專屬通行碼備份還原 */

let hasUnsavedProfileDraft = false;
let pendingProfileFormRerender = false;

function isUserInteractingWithProfileForm() {
    const profileTabEl = document.getElementById('tab-profile');
    if (!profileTabEl || profileTabEl.classList.contains('hidden')) return false;
    const dynamicBox = document.getElementById('dynamicProfileSections');
    if (!dynamicBox) return false;

    const hasOpenMultiSelect = Array.from(dynamicBox.querySelectorAll('.multiselect-menu'))
        .some(m => !m.classList.contains('hidden'));
    if (hasOpenMultiSelect) return true;

    const activeEl = document.activeElement;
    if (activeEl && dynamicBox.contains(activeEl)) {
        const tag = String(activeEl.tagName || '').toUpperCase();
        if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') {
            return true;
        }
    }
    return false;
}

function flushPendingProfileFormRerender() {
    if (!pendingProfileFormRerender) return;
    if (isUserInteractingWithProfileForm()) return;
    pendingProfileFormRerender = false;
    renderProfileForm();
}

function syncProfileDomToDraft() {
    const formEl = document.getElementById('profileForm');
    if (!formEl) return;
    const fd = new FormData(formEl);

    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.type === 'regionCity') {
                const regEl = document.getElementById('profileRegionSelect');
                const cityEl = document.getElementById('profileCitySelect');
                if (regEl || cityEl) {
                    const cityVal = cityEl ? cityEl.value.trim() : '';
                    const regVal = (regEl && regEl.value.trim()) || inferRegionByCity(cityVal);
                    appState.profile.region = regVal;
                    appState.profile.city = cityVal;
                }
            } else if (f.type === 'mbtiTwoStep') {
                const grpEl = document.getElementById('profileMbtiGroupSelect');
                const selMbtiEl = document.getElementById('profileMbtiSelect');
                const hidMbtiEl = document.getElementById('profileMbtiHidden');
                if (grpEl || selMbtiEl || hidMbtiEl) {
                    const rawGrpVal = grpEl ? grpEl.value.trim() : '';
                    const rawMbtiVal = (selMbtiEl && !selMbtiEl.disabled && selMbtiEl.value)
                        ? selMbtiEl.value.trim()
                        : (hidMbtiEl ? hidMbtiEl.value.trim() : '');
                    const finalMbti = (rawGrpVal === '不知道 / 沒測過') ? '不知道 / 沒測過' : rawMbtiVal;
                    const finalGrp = rawGrpVal || inferMbtiGroup(finalMbti);
                    appState.profile.mbtiGroup = finalGrp;
                    appState.profile.mbti = finalMbti;
                }
            } else if (f.type === 'petTwoStep') {
                const statusEl = document.getElementById('profileHasPetStatusSelect');
                const selPetEl = document.getElementById('profileHasPetSelect');
                const hidPetEl = document.getElementById('profileHasPetHidden');
                if (statusEl || selPetEl || hidPetEl) {
                    const rawStatus = statusEl ? statusEl.value.trim() : '';
                    const rawPet = (selPetEl && !selPetEl.disabled && selPetEl.value)
                        ? selPetEl.value.trim()
                        : (hidPetEl ? hidPetEl.value.trim() : '');
                    const finalPet = (rawStatus === '沒有養寵物') ? '沒有養寵物' : rawPet;
                    const finalStatus = rawStatus || (typeof inferPetStatus === 'function' ? inferPetStatus(finalPet) : '');
                    appState.profile.hasPetStatus = finalStatus;
                    appState.profile.hasPet = finalPet;
                }
            } else if (f.type === 'multiselect') {
                const menu = document.getElementById(`ms-menu-${f.key}`);
                if (menu) {
                    appState.profile[f.key] = Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
                }
                if (f.allowOther) {
                    const otherEl = document.getElementById(`ms-other-${f.key}`);
                    appState.profile[`${f.key}Other`] = otherEl ? otherEl.value : (fd.get(`${f.key}Other`) ? String(fd.get(`${f.key}Other`)) : '');
                }
            } else {
                const el = formEl.querySelector(`[name="${f.key}"]`);
                if (el && !el.disabled) {
                    appState.profile[f.key] = el.value;
                } else if (fd.has(f.key)) {
                    appState.profile[f.key] = String(fd.get(f.key) || '');
                }
                if (f.allowOther) {
                    const otherEl = document.getElementById(`select-other-${f.key}`);
                    const curVal = appState.profile[f.key];
                    appState.profile[`${f.key}Other`] = (curVal === '其他' && otherEl)
                        ? otherEl.value
                        : '';
                }
            }
        });
    });
}

// ==================== 個人資料表單（男女生人數限制、先選地區再選縣市、鎖定反灰、隱私可自由調整） ====================
function getMissingRequiredFields() {
    const missing = [];
    for (const sec of FIELD_SECTIONS) {
        for (const f of sec.fields) {
            if (!isFieldRequired(f)) continue;
            const cleanLabel = f.label.split('（')[0];
            if (f.type === 'regionCity') {
                const cityVal = String(appState.profile.city || '').trim();
                const regVal = String(appState.profile.region || inferRegionByCity(cityVal) || '').trim();
                if (!regVal || !Object.prototype.hasOwnProperty.call(REGION_CITIES, regVal)) {
                    missing.push({ key: 'region', label: `${cleanLabel}（地區）` });
                } else if (!cityVal) {
                    missing.push({ key: 'city', label: `${cleanLabel}（縣市）` });
                }
            } else if (f.type === 'mbtiTwoStep') {
                const code = String(appState.profile.mbti || '').trim();
                const grp = String(appState.profile.mbtiGroup || inferMbtiGroup(code) || '').trim();
                if (!grp) {
                    missing.push({ key: 'mbti', label: `${cleanLabel}（請先選 I人 或 E人）` });
                } else if (grp !== '不知道 / 沒測過' && !code) {
                    missing.push({ key: 'mbti', label: `${cleanLabel}（請選擇 ${grp} 具體人格）` });
                }
            } else if (f.type === 'petTwoStep') {
                const petVal = String(appState.profile.hasPet || '').trim();
                const petStatus = String(appState.profile.hasPetStatus || (typeof inferPetStatus === 'function' ? inferPetStatus(petVal) : '') || '').trim();
                if (!petStatus) {
                    missing.push({ key: 'hasPet', label: `${cleanLabel}（請先選 有養寵物 或 沒有養寵物）` });
                } else if (petStatus === '有養寵物' && (!petVal || petVal === '沒有養寵物' || petVal === '有養寵物')) {
                    missing.push({ key: 'hasPet', label: `${cleanLabel}（請選擇養什麼動物）` });
                }
            } else if (f.type === 'multiselect') {
                const val = appState.profile[f.key];
                if (!Array.isArray(val) || val.length === 0) {
                    missing.push({ key: f.key, label: cleanLabel });
                } else if (f.allowOther && val.includes('其他') && !String(appState.profile[`${f.key}Other`] || '').trim()) {
                    missing.push({ key: `${f.key}Other`, label: `${cleanLabel}（其他說明）` });
                }
            } else {
                const val = appState.profile[f.key];
                if (val === undefined || val === null || String(val).trim() === '') {
                    missing.push({ key: f.key, label: cleanLabel });
                } else if (f.type === 'number' && (f.min !== undefined || f.max !== undefined)) {
                    const numVal = Number(val);
                    if (isNaN(numVal) || (f.min !== undefined && numVal < f.min) || (f.max !== undefined && numVal > f.max)) {
                        missing.push({ key: f.key, label: `${cleanLabel}（需介於 ${f.min ?? ''}～${f.max ?? ''} 歲）` });
                    }
                } else if (f.allowOther && String(val).trim() === '其他' && !String(appState.profile[`${f.key}Other`] || '').trim()) {
                    missing.push({ key: `${f.key}Other`, label: `${cleanLabel}（其他說明）` });
                }
            }
        }
    }
    return missing;
}

function isProfileComplete() {
    return getMissingRequiredFields().length === 0;
}

function renderProfileForm() {
    const container = document.getElementById('dynamicProfileSections');
    const isTestOptional = (typeof TEST_MODE_OPTIONAL_FIELDS !== 'undefined' && TEST_MODE_OPTIONAL_FIELDS);
    const idDisplay = appState.playerId
        ? appState.playerId
        : (isTestOptional ? '尚未產生（測試階段免必填，可直接按保存產生）' : '尚未產生（填完必填並保存後自動產生）');
    const sysConfig = Store.getSystemConfig();
    const quota = Store.getGenderQuotaStatus();
    const isBothGenderFullForNew = !appState.playerId && quota.bothFull;
    const isLocked = sysConfig.profileLocked || isBothGenderFullForNew;

    // 隱私快捷全開/全隱藏按鈕不受個人資料鎖定限制
    const profileTab = document.getElementById('tab-profile');
    if (profileTab) {
        profileTab.querySelectorAll('button[onclick^="setAllFieldsPrivacy"]').forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        });
    }

    const submitBtn = document.querySelector('#profileForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = isLocked;
        if (isBothGenderFullForNew) {
            submitBtn.textContent = '🚫 男/女人數已滿';
        } else if (sysConfig.profileLocked) {
            submitBtn.textContent = '🔒 個人資料已鎖定（不開放修改或新增）';
        } else {
            submitBtn.textContent = '保存';
        }
    }

    let topNoticeHtml = '';
    if (isBothGenderFullForNew) {
        topNoticeHtml = `
            <div class="p-4 rounded-2xl bg-rose-50 border-2 border-rose-400 text-xs text-rose-700 font-bold flex items-center gap-2">
                <span>🚫</span>
                <span>男/女人數已滿（目前男生 ${quota.maleCount}/${quota.limit} 人、女生 ${quota.femaleCount}/${quota.limit} 人），目前不開放未填寫資料的新玩家填寫。</span>
            </div>
        `;
    } else if (sysConfig.profileLocked) {
        topNoticeHtml = `
            <div class="p-4 rounded-2xl bg-gray-100 border border-gray-300 text-xs text-gray-700 font-semibold flex items-center gap-2">
                <span>🔒</span>
                <span>管理員已開啟「不讓玩家填寫資料」，所有個人資料欄位已反灰鎖定（不可修改或新增），但「個人隱私開放／隱藏」仍可自由調整。</span>
            </div>
        `;
    } else if (isTestOptional) {
        topNoticeHtml = `
            <div class="p-3.5 rounded-2xl bg-pink-50/80 border border-pink-200 text-xs text-[#8f4452] font-medium flex items-center gap-2">
                <span>🧪</span>
                <span>測試階段模式：目前所有欄位皆免必填，可直接按「保存」產生玩家 ID 並同步至後台（正式上線時於 shared/schema.js 將 TEST_MODE_OPTIONAL_FIELDS 改為 false 即可恢復必填）。</span>
            </div>
        `;
    }

    container.innerHTML = `
        ${topNoticeHtml}
        ${FIELD_SECTIONS.map((sec, sIdx) => `
            <div class="space-y-4">
                <h3 class="text-lg font-bold font-serif-jp text-[#8f4452] border-b border-pink-100 pb-2">${sec.title}</h3>

                ${sIdx === 0 ? `
                    <div class="p-4 rounded-2xl ${isLocked ? 'bg-gray-100 border-gray-300' : 'bg-gradient-to-r from-pink-50 to-rose-50/80 border-pink-200'} border space-y-2">
                        <label class="text-sm md:text-base font-bold ${isLocked ? 'text-gray-500' : 'text-[#8f4452]'} block">玩家專屬 ID</label>
                        <input type="text" value="${idDisplay}" readonly class="input-jp font-mono font-bold text-sm ${isLocked ? '!bg-gray-200 !text-gray-500 !border-gray-300' : ''}">
                    </div>
                ` : ''}

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${sec.fields.map(f => renderSingleFieldCard(f, sec.defaultPrivacy, isLocked, quota)).join('')}
                </div>
            </div>
        `).join('')}
    `;
}

function renderSingleFieldCard(field, sectionDefaultPriv, isProfileLocked, quota) {
    let val = appState.profile[field.key];
    const priv = field.alwaysOpen ? 'open' : (appState.privacy[field.key] || field.defaultPrivacy || sectionDefaultPriv || 'closed');
    const fullWidthClass = (field.type === 'textarea' || field.type === 'multiselect' || field.type === 'regionCity' || field.type === 'mbtiTwoStep' || field.type === 'petTwoStep') ? 'md:col-span-2' : '';
    const isGenderLocked = (field.key === 'gender' && !!appState.playerId);
    const isNicknameLocked = (field.key === 'nickname' && Boolean(appState && appState.profile && appState.profile.lockNickname));
    const isFieldSelfLocked = isProfileLocked || isNicknameLocked;
    const isInputDisabled = isFieldSelfLocked || isGenderLocked;
    const lockedInputStyle = isFieldSelfLocked ? '!bg-gray-100 !text-gray-400 !border-gray-300 cursor-not-allowed' : '';

    let inputHtml = '';
    let extraGenderNoticeHtml = '';

    if (field.type === 'regionCity') {
        let selectedRegion = appState.profile.region || inferRegionByCity(val) || '';
        if (selectedRegion && !Object.prototype.hasOwnProperty.call(REGION_CITIES, selectedRegion)) {
            selectedRegion = '';
            appState.profile.region = '';
            appState.profile.city = '';
        }
        const selectedCity = selectedRegion ? (val || '') : '';
        const cityList = selectedRegion ? (REGION_CITIES[selectedRegion] || []) : [];

        inputHtml = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 1：先選地區</label>
                    <select name="region" id="profileRegionSelect" onchange="onProfileRegionChange(this.value)" class="input-jp ${lockedInputStyle}" ${isProfileLocked ? 'disabled' : ''}>
                        <option value="">請先選擇地區...</option>
                        ${REGION_OPTIONS.map(reg => `<option value="${reg}" ${selectedRegion === reg ? 'selected' : ''}>${reg}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 2：再選縣市</label>
                    <select name="city" id="profileCitySelect" onchange="onProfileCityChange(this.value)" class="input-jp ${lockedInputStyle}" ${(isProfileLocked || !selectedRegion) ? 'disabled' : ''}>
                        <option value="">${selectedRegion ? '請選擇縣市...' : '請先選擇左側地區...'}</option>
                        ${cityList.map(c => `<option value="${c}" ${selectedCity === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
    } else if (field.type === 'mbtiTwoStep') {
        const selectedGroup = appState.profile.mbtiGroup || inferMbtiGroup(val) || '';
        const selectedMbti = val || '';
        const subMbtiList = (selectedGroup === 'I人' || selectedGroup === 'E人') ? (MBTI_GROUPS[selectedGroup] || []) : [];
        const isUntested = selectedGroup === '不知道 / 沒測過';

        inputHtml = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 1：先選 I人 或 E人</label>
                    <select name="mbtiGroup" id="profileMbtiGroupSelect" onchange="onProfileMbtiGroupChange(this.value)" class="input-jp ${lockedInputStyle}" ${isProfileLocked ? 'disabled' : ''}>
                        <option value="">請先選擇 I人 或 E人...</option>
                        <option value="I人" ${selectedGroup === 'I人' ? 'selected' : ''}>I人（內向型）</option>
                        <option value="E人" ${selectedGroup === 'E人' ? 'selected' : ''}>E人（外向型）</option>
                        <option value="不知道 / 沒測過" ${isUntested ? 'selected' : ''}>不知道 / 沒測過</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 2：再選具體 MBTI 人格</label>
                    <select name="mbti" id="profileMbtiSelect" onchange="onProfileMbtiChange(this.value)" class="input-jp ${lockedInputStyle}" ${(isProfileLocked || !selectedGroup || isUntested) ? 'disabled' : ''}>
                        ${isUntested
                            ? '<option value="不知道 / 沒測過" selected>不知道 / 沒測過</option>'
                            : `
                                <option value="">${selectedGroup ? `請選擇 ${selectedGroup} 開頭的人格...` : '請先選擇左側 I人 或 E人...'}</option>
                                ${subMbtiList.map(code => `<option value="${code}" ${selectedMbti === code ? 'selected' : ''}>${code}</option>`).join('')}
                            `
                        }
                    </select>
                    <input type="hidden" id="profileMbtiHidden" name="mbti" value="${isUntested ? '不知道 / 沒測過' : selectedMbti}">
                </div>
            </div>
        `;
    } else if (field.type === 'petTwoStep') {
        const selectedPetStatus = appState.profile.hasPetStatus || (typeof inferPetStatus === 'function' ? inferPetStatus(val) : '') || '';
        const selectedPetType = (selectedPetStatus === '有養寵物' && val && val !== '沒有養寵物' && val !== '有養寵物') ? val : '';
        const isNoPet = selectedPetStatus === '沒有養寵物';

        inputHtml = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 1：先選是否有養寵物</label>
                    <select name="hasPetStatus" id="profileHasPetStatusSelect" onchange="onProfileHasPetStatusChange(this.value)" class="input-jp ${lockedInputStyle}" ${isProfileLocked ? 'disabled' : ''}>
                        <option value="">請先選擇是否有養寵物...</option>
                        <option value="有養寵物" ${selectedPetStatus === '有養寵物' ? 'selected' : ''}>有養寵物</option>
                        <option value="沒有養寵物" ${isNoPet ? 'selected' : ''}>沒有養寵物</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[11px] text-gray-500 mb-1">步驟 2：再選養什麼動物</label>
                    <select name="hasPet" id="profileHasPetSelect" onchange="onProfileHasPetChange(this.value)" class="input-jp ${lockedInputStyle}" ${(isProfileLocked || !selectedPetStatus || isNoPet) ? 'disabled' : ''}>
                        ${isNoPet
                            ? '<option value="沒有養寵物" selected>沒有養寵物</option>'
                            : `
                                <option value="">${selectedPetStatus === '有養寵物' ? '請選擇養什麼動物...' : '請先選擇左側是否有養寵物...'}</option>
                                ${PET_TYPE_OPTIONS.map(pt => `<option value="${pt}" ${selectedPetType === pt ? 'selected' : ''}>${pt}</option>`).join('')}
                            `
                        }
                    </select>
                    <input type="hidden" id="profileHasPetHidden" name="hasPet" value="${isNoPet ? '沒有養寵物' : selectedPetType}">
                </div>
            </div>
        `;
    } else if (field.type === 'select') {
        if (field.key === 'gender') {
            const isMaleBlocked = !appState.playerId && !isProfileLocked && quota.maleFull;
            const isFemaleBlocked = !appState.playerId && !isProfileLocked && quota.femaleFull;

            if (isMaleBlocked && val === '男') {
                appState.profile.gender = '';
                val = '';
            }
            if (isFemaleBlocked && val === '女') {
                appState.profile.gender = '';
                val = '';
            }

            inputHtml = `
                <select name="gender" id="profileGenderSelect" onchange="onProfileGenderChange(this.value)" class="input-jp ${lockedInputStyle}" ${isFieldRequired(field) ? 'required' : ''} ${isInputDisabled ? 'disabled' : ''}>
                    <option value="">請選擇性別（僅限男 / 女）...</option>
                    <option value="男" ${val === '男' ? 'selected' : ''} ${isMaleBlocked ? 'disabled' : ''}>
                        ${isMaleBlocked ? '男（男生人數已滿，禁止選取）' : '男'}
                    </option>
                    <option value="女" ${val === '女' ? 'selected' : ''} ${isFemaleBlocked ? 'disabled' : ''}>
                        ${isFemaleBlocked ? '女（女生人數已滿，禁止選取）' : '女'}
                    </option>
                </select>
                ${isGenderLocked ? `<input type="hidden" name="gender" value="${val}">` : ''}
            `;

            if (isMaleBlocked) {
                extraGenderNoticeHtml = `<p class="text-xs font-bold text-rose-600">🚫 男生人數已滿（${quota.maleCount}/${quota.limit} 人），男生禁止選取，性別只能選擇「女」。</p>`;
            } else if (isFemaleBlocked) {
                extraGenderNoticeHtml = `<p class="text-xs font-bold text-rose-600">🚫 女生人數已滿（${quota.femaleCount}/${quota.limit} 人），女生禁止選取，性別只能選擇「男」。</p>`;
            } else if (quota.enabled && !appState.playerId && !isProfileLocked) {
                extraGenderNoticeHtml = `<p class="text-[11px] text-[#8f4452] font-medium">📊 目前男生名額統計：男生 ${quota.maleCount}/${quota.limit} 人</p>`;
            }
        } else {
            const otherText = appState.profile[`${field.key}Other`] || '';
            const hasOther = field.allowOther && val === '其他';
            inputHtml = `
                <select name="${field.key}" ${field.allowOther ? `onchange="onSelectWithOtherChange('${field.key}', this.value)"` : ''} class="input-jp ${lockedInputStyle}" ${isFieldRequired(field) ? 'required' : ''} ${isInputDisabled ? 'disabled' : ''}>
                    <option value="">請選擇...</option>
                    ${field.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
                ${field.allowOther ? `
                    <input type="text" id="select-other-${field.key}" name="${field.key}Other" value="${otherText}" ${isInputDisabled ? 'disabled' : ''} oninput="onSelectOtherInput('${field.key}', this.value)" class="input-jp mt-2 ${lockedInputStyle} ${hasOther ? '' : 'hidden'}" placeholder="${field.otherPlaceholder || '請自行填寫其他說明...'}">
                ` : ''}
            `;
        }
    } else if (field.type === 'textarea') {
        inputHtml = `<textarea name="${field.key}" rows="3" class="input-jp resize-y ${lockedInputStyle}" placeholder="${field.placeholder || ''}" ${isFieldRequired(field) ? 'required' : ''} ${isProfileLocked ? 'disabled' : ''}>${val || ''}</textarea>`;
    } else if (field.type === 'multiselect') {
        const arr = Array.isArray(val) ? val : [];
        const otherText = appState.profile[`${field.key}Other`] || '';
        const hasOther = arr.includes('其他');

        inputHtml = `
            <div class="multiselect-wrapper relative ${isProfileLocked ? 'opacity-65 pointer-events-none select-none' : ''}" id="ms-wrap-${field.key}">
                <div class="multiselect-trigger ${isProfileLocked ? '!bg-gray-100 !border-gray-300 !text-gray-400 cursor-not-allowed' : ''}" onclick="toggleMultiSelectMenu('${field.key}')">
                    <div id="ms-chips-${field.key}" class="flex flex-wrap gap-1.5 flex-1">
                        ${renderMultiSelectChipsHtml(field.key, arr, otherText, isProfileLocked)}
                    </div>
                    <span class="text-xs ${isProfileLocked ? 'text-gray-400' : 'text-[#c96a7b]'} font-bold shrink-0">▾ 選擇</span>
                </div>
                <div id="ms-menu-${field.key}" class="multiselect-menu hidden">
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        ${field.options.map(opt => `
                            <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-pink-50 text-xs cursor-pointer">
                                <input type="checkbox" value="${opt}" ${arr.includes(opt) ? 'checked' : ''} ${isProfileLocked ? 'disabled' : ''} onchange="onMultiSelectChange('${field.key}', ${!!field.allowOther})" class="accent-[#c96a7b]">
                                <span>${opt}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                ${field.allowOther ? `
                    <input type="text" id="ms-other-${field.key}" name="${field.key}Other" value="${otherText}" ${isProfileLocked ? 'disabled' : ''} oninput="onMultiSelectOtherInput('${field.key}')" class="input-jp mt-2 ${lockedInputStyle} ${hasOther ? '' : 'hidden'}" placeholder="請自行填寫其他興趣（例如：衝浪、調酒、露營）...">
                ` : ''}
            </div>
        `;
    } else {
        const minAttr = field.min !== undefined ? `min="${field.min}"` : '';
        const maxAttr = field.max !== undefined ? `max="${field.max}"` : '';
        inputHtml = `<input type="${field.type}" name="${field.key}" value="${val || ''}" ${minAttr} ${maxAttr} class="input-jp ${lockedInputStyle}" placeholder="${field.placeholder || ''}" ${isFieldRequired(field) ? 'required' : ''} ${isFieldSelfLocked ? 'disabled' : ''}>`;
    }

    let hintsHtml = '';
    if (Array.isArray(field.hints) && field.hints.length > 0) {
        hintsHtml = `
            <div class="mt-2 p-3 rounded-xl ${isProfileLocked ? 'bg-gray-100/80 border-gray-200 text-gray-400' : 'bg-pink-50/70 border-pink-100 text-[#7a3b46]'} border text-[11px] space-y-1">
                <p class="font-semibold ${isProfileLocked ? 'text-gray-500' : 'text-[#8f4452]'}">💡 不知道寫什麼？參考以下 5 個破冰提問舉例：</p>
                <ul class="list-disc list-inside space-y-0.5 ${isProfileLocked ? 'text-gray-400' : 'text-gray-600'}">
                    ${field.hints.map(h => `<li>${h}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    // 個人隱私「開放 / 隱藏」控制完全不受 isProfileLocked 限制
    let privacyControlHtml = '';
    let privHint = '';

    if (field.alwaysOpen) {
        privacyControlHtml = `
            <span class="text-[11px] px-2.5 py-1 rounded-full bg-pink-100 text-[#8f4452] font-semibold">
                🌸 固定開放（不可隱藏）
            </span>
        `;
        privHint = '🌸 此欄位為固定開放，配對好友可直接看到';
    } else if (field.autoOpenAfter7Days) {
        privacyControlHtml = `
            <span class="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 font-semibold">
                若不想開放，請點擊上方"回報"給管理員調整
            </span>
        `;
        privHint = '🔒 前 7 天預設隱藏；滿 7 天雙方皆按下「繼續配對」成為好友時，系統會自動開放給對方';
    } else {
        privacyControlHtml = `
            <div class="flex items-center gap-1.5" id="priv-group-${field.key}">
                <button type="button" onclick="setFieldPrivacy('${field.key}', 'closed')" class="privacy-pill ${priv === 'closed' ? 'active-closed' : ''}">
                    不開放
                </button>
                <button type="button" onclick="setFieldPrivacy('${field.key}', 'open')" class="privacy-pill ${priv === 'open' ? 'active-open' : ''}">
                    開放給好友
                </button>
            </div>
        `;
        privHint = priv === 'open'
            ? '🌸 已對目前配對好友開放顯示'
            : '🙈 目前不開放（需點選「開放給好友」對方才看得到）';
    }

    return `
        <div id="field-card-${field.key}" class="${fullWidthClass} p-3.5 rounded-2xl ${isFieldSelfLocked ? 'bg-gray-50/90 border-gray-200' : 'bg-white/75 border-pink-100/90'} border space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <label class="text-sm md:text-base font-bold leading-snug ${isFieldSelfLocked ? 'text-gray-400' : 'text-[#5e464a]'}">
                        ${field.label} ${isFieldRequired(field) ? '<span class="text-rose-500">*</span>' : ''}
                        ${isNicknameLocked ? '<span class="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold">🔒 禁止前台修改</span>' : ''}
                    </label>
                    ${field.subtitle ? `<p class="text-[11px] text-gray-400">${field.subtitle}</p>` : ''}
                </div>
                ${privacyControlHtml}
            </div>
            ${inputHtml}
            ${extraGenderNoticeHtml}
            ${hintsHtml}
            <p id="priv-hint-${field.key}" class="text-[11px] text-gray-400">${privHint}</p>
        </div>
    `;
}

window.onProfileGenderChange = function(genderVal) {
    if (appState.playerId || Store.getSystemConfig().profileLocked) return;
    const quota = Store.getGenderQuotaStatus();
    if (genderVal === '男' && quota.maleFull) {
        appState.profile.gender = '';
        renderProfileForm();
        showMiniNotice('🚫 男生人數已滿', '男生人數已滿，男生禁止選取，性別只能選擇「女」。');
        return;
    }
    if (genderVal === '女' && quota.femaleFull) {
        appState.profile.gender = '';
        renderProfileForm();
        showMiniNotice('🚫 女生人數已滿', '女生人數已滿，女生禁止選取，性別只能選擇「男」。');
        return;
    }
    appState.profile.gender = genderVal || '';
};

window.onProfileRegionChange = function(regionVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.region = regionVal || '';
    const cities = regionVal ? (REGION_CITIES[regionVal] || []) : [];
    if (!cities.includes(appState.profile.city)) {
        appState.profile.city = '';
    }

    const citySel = document.getElementById('profileCitySelect');
    if (citySel) {
        if (!regionVal) {
            citySel.disabled = true;
            citySel.innerHTML = '<option value="">請先選擇左側地區...</option>';
        } else {
            citySel.disabled = false;
            citySel.innerHTML = '<option value="">請選擇縣市...</option>' +
                cities.map(c => `<option value="${c}" ${appState.profile.city === c ? 'selected' : ''}>${c}</option>`).join('');
            if (cities.length === 1) {
                citySel.value = cities[0];
                appState.profile.city = cities[0];
            }
        }
    }
};

window.onProfileCityChange = function(cityVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.city = cityVal || '';
    if (cityVal && !appState.profile.region) {
        appState.profile.region = inferRegionByCity(cityVal);
    }
};

window.onProfileMbtiGroupChange = function(groupVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.mbtiGroup = groupVal || '';
    const mbtiSel = document.getElementById('profileMbtiSelect');
    const mbtiHidden = document.getElementById('profileMbtiHidden');

    if (groupVal === '不知道 / 沒測過') {
        appState.profile.mbti = '不知道 / 沒測過';
        if (mbtiSel) {
            mbtiSel.disabled = true;
            mbtiSel.innerHTML = '<option value="不知道 / 沒測過" selected>不知道 / 沒測過</option>';
        }
        if (mbtiHidden) mbtiHidden.value = '不知道 / 沒測過';
        return;
    }

    if (!groupVal || !MBTI_GROUPS[groupVal]) {
        appState.profile.mbti = '';
        if (mbtiSel) {
            mbtiSel.disabled = true;
            mbtiSel.innerHTML = '<option value="">請先選擇左側 I人 或 E人...</option>';
        }
        if (mbtiHidden) mbtiHidden.value = '';
        return;
    }

    const validList = MBTI_GROUPS[groupVal];
    if (!validList.includes(appState.profile.mbti)) {
        appState.profile.mbti = '';
    }
    if (mbtiSel) {
        mbtiSel.disabled = false;
        mbtiSel.innerHTML = `<option value="">請選擇 ${groupVal} 開頭的人格...</option>` +
            validList.map(code => `<option value="${code}" ${appState.profile.mbti === code ? 'selected' : ''}>${code}</option>`).join('');
    }
    if (mbtiHidden) mbtiHidden.value = appState.profile.mbti || '';
};

window.onProfileMbtiChange = function(mbtiVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.mbti = mbtiVal || '';
    if (mbtiVal && !appState.profile.mbtiGroup) {
        appState.profile.mbtiGroup = inferMbtiGroup(mbtiVal);
    }
    const mbtiHidden = document.getElementById('profileMbtiHidden');
    if (mbtiHidden) mbtiHidden.value = mbtiVal || '';
};

window.onProfileHasPetStatusChange = function(statusVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.hasPetStatus = statusVal || '';
    const petSel = document.getElementById('profileHasPetSelect');
    const petHidden = document.getElementById('profileHasPetHidden');

    if (statusVal === '沒有養寵物') {
        appState.profile.hasPet = '沒有養寵物';
        if (petSel) {
            petSel.disabled = true;
            petSel.innerHTML = '<option value="沒有養寵物" selected>沒有養寵物</option>';
        }
        if (petHidden) petHidden.value = '沒有養寵物';
        return;
    }

    if (statusVal !== '有養寵物') {
        appState.profile.hasPet = '';
        if (petSel) {
            petSel.disabled = true;
            petSel.innerHTML = '<option value="">請先選擇左側是否有養寵物...</option>';
        }
        if (petHidden) petHidden.value = '';
        return;
    }

    if (!PET_TYPE_OPTIONS.includes(appState.profile.hasPet)) {
        appState.profile.hasPet = '';
    }
    if (petSel) {
        petSel.disabled = false;
        petSel.innerHTML = '<option value="">請選擇養什麼動物...</option>' +
            PET_TYPE_OPTIONS.map(pt => `<option value="${pt}" ${appState.profile.hasPet === pt ? 'selected' : ''}>${pt}</option>`).join('');
    }
    if (petHidden) petHidden.value = appState.profile.hasPet || '';
};

window.onProfileHasPetChange = function(petVal) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile.hasPet = petVal || '';
    if (petVal && !appState.profile.hasPetStatus && typeof inferPetStatus === 'function') {
        appState.profile.hasPetStatus = inferPetStatus(petVal);
    }
    const petHidden = document.getElementById('profileHasPetHidden');
    if (petHidden) petHidden.value = petVal || '';
};

window.onSelectWithOtherChange = function(key, val) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile[key] = val || '';
    const otherInput = document.getElementById(`select-other-${key}`);
    if (otherInput) {
        if (val === '其他') {
            otherInput.classList.remove('hidden');
            otherInput.focus();
        } else {
            otherInput.classList.add('hidden');
            otherInput.value = '';
            appState.profile[`${key}Other`] = '';
        }
    }
};

window.onSelectOtherInput = function(key, val) {
    if (Store.getSystemConfig().profileLocked) return;
    appState.profile[`${key}Other`] = val || '';
};

function renderMultiSelectChipsHtml(key, selectedArr, otherText, isLocked = false) {
    if (!selectedArr || selectedArr.length === 0) {
        return `<span class="text-xs text-gray-400 py-0.5">${isLocked ? '未選擇（已鎖定）' : '點擊下拉選單選擇（可複選）...'}</span>`;
    }
    return selectedArr.map(item => {
        const displayLabel = (item === '其他' && otherText) ? `其他：${otherText}` : item;
        return `<span class="multiselect-chip ${isLocked ? '!bg-gray-200 !border-gray-300 !text-gray-500' : ''}">${displayLabel}</span>`;
    }).join('');
}

window.toggleMultiSelectMenu = function(key) {
    const quota = Store.getGenderQuotaStatus();
    if (Store.getSystemConfig().profileLocked || (!appState.playerId && quota.bothFull)) return;
    const menu = document.getElementById(`ms-menu-${key}`);
    const isHidden = menu.classList.contains('hidden');
    document.querySelectorAll('.multiselect-menu').forEach(m => m.classList.add('hidden'));
    if (isHidden) menu.classList.remove('hidden');
};

window.onMultiSelectChange = function(key, allowOther) {
    const quota = Store.getGenderQuotaStatus();
    if (Store.getSystemConfig().profileLocked || (!appState.playerId && quota.bothFull)) return;
    const menu = document.getElementById(`ms-menu-${key}`);
    const checked = Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    appState.profile[key] = checked;

    if (allowOther) {
        const otherInput = document.getElementById(`ms-other-${key}`);
        if (checked.includes('其他')) {
            otherInput.classList.remove('hidden');
            otherInput.focus();
        } else {
            otherInput.classList.add('hidden');
            otherInput.value = '';
            appState.profile[`${key}Other`] = '';
        }
    }

    syncProfileDomToDraft();
    hasUnsavedProfileDraft = true;
    const otherText = appState.profile[`${key}Other`] || '';
    document.getElementById(`ms-chips-${key}`).innerHTML = renderMultiSelectChipsHtml(key, checked, otherText, false);
    Store.save(appState, false, Boolean(appState.playerId));
};

window.onMultiSelectOtherInput = function(key) {
    const quota = Store.getGenderQuotaStatus();
    if (Store.getSystemConfig().profileLocked || (!appState.playerId && quota.bothFull)) return;
    const val = document.getElementById(`ms-other-${key}`).value;
    appState.profile[`${key}Other`] = val;
    syncProfileDomToDraft();
    hasUnsavedProfileDraft = true;
    const checked = appState.profile[key] || [];
    document.getElementById(`ms-chips-${key}`).innerHTML = renderMultiSelectChipsHtml(key, checked, val, false);
    Store.save(appState, false, Boolean(appState.playerId));
};

// 個人隱私開放或隱藏不受資料鎖定限制
window.setFieldPrivacy = function(key, mode) {
    let isLockedPrivacy = (key === 'gender' || key === 'icebreakerQuestion' || key === 'ig');
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.key === key && (f.alwaysOpen || f.autoOpenAfter7Days)) {
                isLockedPrivacy = true;
            }
        });
    });
    if (isLockedPrivacy) return;
    syncProfileDomToDraft();
    appState.privacy[key] = mode;
    Store.save(appState, false, Boolean(hasUnsavedProfileDraft && appState.playerId));

    const group = document.getElementById(`priv-group-${key}`);
    if (group) {
        const btns = group.querySelectorAll('.privacy-pill');
        btns[0].className = `privacy-pill ${mode === 'closed' ? 'active-closed' : ''}`;
        btns[1].className = `privacy-pill ${mode === 'open' ? 'active-open' : ''}`;
    }

    const hint = document.getElementById(`priv-hint-${key}`);
    if (hint) {
        hint.textContent = mode === 'open'
            ? '🌸 已對目前配對好友開放顯示'
            : '🙈 目前不開放（需點選「開放給好友」對方才看得到）';
    }
};

window.setAllFieldsPrivacy = function(mode) {
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (!f.alwaysOpen && !f.autoOpenAfter7Days) {
                setFieldPrivacy(f.key, mode);
            }
        });
    });
};

// 即時同步使用者在表單輸入或下拉選取的草稿至記憶體，避免任何畫面重繪遺失已填內容
const profileFormEl = document.getElementById('profileForm');
if (profileFormEl) {
    const handleDraftEdit = (e) => {
        if (!e.target || !e.target.closest('#dynamicProfileSections')) return;
        syncProfileDomToDraft();
        hasUnsavedProfileDraft = true;
    };
    profileFormEl.addEventListener('input', handleDraftEdit);
    profileFormEl.addEventListener('change', handleDraftEdit);
    profileFormEl.addEventListener('focusout', () => {
        setTimeout(() => {
            if (!hasUnsavedProfileDraft) {
                flushPendingProfileFormRerender();
            }
        }, 120);
    });
}

let cachedSilentClientMeta = null;
let silentClientMetaFailCooldownUntil = 0;

async function resolveSilentClientMeta() {
    if (cachedSilentClientMeta) {
        return { ...cachedSilentClientMeta, updatedAt: new Date().toLocaleString('zh-TW') };
    }
    if (Date.now() < silentClientMetaFailCooldownUntil) {
        return null;
    }
    if (typeof isLocalSandboxEnv === 'function' && isLocalSandboxEnv()) {
        cachedSilentClientMeta = { ip: '127.0.0.1 (本地測試)' };
        return { ...cachedSilentClientMeta, updatedAt: new Date().toLocaleString('zh-TW') };
    }

    const fetchWithTimeout = async (url, timeoutMs = 800) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            clearTimeout(timer);
            return null;
        }
    };

    try {
        const d1 = await fetchWithTimeout('https://api.ipify.org?format=json', 800);
        if (d1 && d1.ip) {
            cachedSilentClientMeta = { ip: String(d1.ip).trim() };
            return { ...cachedSilentClientMeta, updatedAt: new Date().toLocaleString('zh-TW') };
        }
    } catch (e) {}

    try {
        const d2 = await fetchWithTimeout('https://api64.ipify.org?format=json', 800);
        if (d2 && d2.ip) {
            cachedSilentClientMeta = { ip: String(d2.ip).trim() };
            return { ...cachedSilentClientMeta, updatedAt: new Date().toLocaleString('zh-TW') };
        }
    } catch (e) {}

    silentClientMetaFailCooldownUntil = Date.now() + 10 * 60 * 1000;
    return null;
}

// 點保存
document.getElementById('profileForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const quota = Store.getGenderQuotaStatus();
    if (!appState.playerId && quota.bothFull) {
        showMiniNotice('🚫 男/女人數已滿', '目前男生與女生人數皆已達上限，暫不開放新玩家填寫資料。');
        return;
    }

    if (Store.getSystemConfig().profileLocked) {
        showMiniNotice('🔒 個人資料已鎖定', '管理員目前已開啟「不讓玩家填寫資料」，所有欄位已反灰鎖定。');
        return;
    }

    syncProfileDomToDraft();
    const fd = new FormData(this);

    const nextProfile = { ...appState.profile };
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.type === 'regionCity') {
                const regEl = document.getElementById('profileRegionSelect');
                const cityEl = document.getElementById('profileCitySelect');
                const cityVal = (cityEl ? cityEl.value.trim() : '') || (fd.get('city') ? String(fd.get('city')).trim() : '') || String(appState.profile.city || '').trim();
                const regVal = (regEl ? regEl.value.trim() : '') || (fd.get('region') ? String(fd.get('region')).trim() : '') || String(appState.profile.region || '').trim() || inferRegionByCity(cityVal);
                nextProfile.region = regVal;
                nextProfile.city = cityVal;
            } else if (f.type === 'mbtiTwoStep') {
                const grpEl = document.getElementById('profileMbtiGroupSelect');
                const selMbtiEl = document.getElementById('profileMbtiSelect');
                const hidMbtiEl = document.getElementById('profileMbtiHidden');
                const grpVal = (grpEl ? grpEl.value.trim() : '') || (fd.get('mbtiGroup') ? String(fd.get('mbtiGroup')).trim() : '') || String(appState.profile.mbtiGroup || '').trim();
                const selMbtiVal = (selMbtiEl && !selMbtiEl.disabled && selMbtiEl.value ? selMbtiEl.value.trim() : '') ||
                                   (hidMbtiEl && hidMbtiEl.value ? hidMbtiEl.value.trim() : '') ||
                                   String(appState.profile.mbti || '').trim();
                const finalMbti = (grpVal === '不知道 / 沒測過') ? '不知道 / 沒測過' : selMbtiVal;
                nextProfile.mbtiGroup = grpVal || inferMbtiGroup(finalMbti);
                nextProfile.mbti = finalMbti;
            } else if (f.type === 'petTwoStep') {
                const statusEl = document.getElementById('profileHasPetStatusSelect');
                const selPetEl = document.getElementById('profileHasPetSelect');
                const hidPetEl = document.getElementById('profileHasPetHidden');
                const statusVal = (statusEl ? statusEl.value.trim() : '') || (fd.get('hasPetStatus') ? String(fd.get('hasPetStatus')).trim() : '') || String(appState.profile.hasPetStatus || '').trim();
                const selPetVal = (selPetEl && !selPetEl.disabled && selPetEl.value ? selPetEl.value.trim() : '') ||
                                  (hidPetEl && hidPetEl.value ? hidPetEl.value.trim() : '') ||
                                  String(appState.profile.hasPet || '').trim();
                const finalPet = (statusVal === '沒有養寵物') ? '沒有養寵物' : selPetVal;
                nextProfile.hasPetStatus = statusVal || (typeof inferPetStatus === 'function' ? inferPetStatus(finalPet) : '');
                nextProfile.hasPet = finalPet;
            } else if (f.type === 'multiselect') {
                if (f.allowOther) {
                    nextProfile[`${f.key}Other`] = fd.get(`${f.key}Other`) ? String(fd.get(`${f.key}Other`)).trim() : '';
                }
            } else {
                const rawVal = fd.get(f.key);
                if (rawVal !== null) {
                    nextProfile[f.key] = String(rawVal).trim();
                } else if (nextProfile[f.key] !== undefined && nextProfile[f.key] !== null) {
                    nextProfile[f.key] = String(nextProfile[f.key]).trim();
                } else {
                    nextProfile[f.key] = '';
                }
                if (f.allowOther) {
                    nextProfile[`${f.key}Other`] = (nextProfile[f.key] === '其他' && fd.get(`${f.key}Other`))
                        ? String(fd.get(`${f.key}Other`)).trim()
                        : '';
                }
            }
        });
    });

    // 性別只能選男或女，並即時檢查男女生名額上限
    if (nextProfile.gender && nextProfile.gender !== '男' && nextProfile.gender !== '女') {
        showMiniNotice('⚠️ 性別限制', '你的性別只能選擇「男」或「女」！');
        return;
    }

    // 年齡限制驗證：實歲 22～40 歲，最小可接受年齡至少 22 歲，最大可接受年齡最高 40 歲
    if (nextProfile.age !== '') {
        const ageNum = Number(nextProfile.age);
        if (!Number.isInteger(ageNum) || ageNum < 22 || ageNum > 40) {
            const card = document.getElementById('field-card-age');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMiniNotice('⚠️ 年齡限制', '「你的年齡（實歲）」限制至少要 22 歲、最高 40 歲！');
            return;
        }
    }
    if (nextProfile.minAge !== '') {
        const minAgeNum = Number(nextProfile.minAge);
        if (!Number.isInteger(minAgeNum) || minAgeNum < 22 || minAgeNum > 40) {
            const card = document.getElementById('field-card-minAge');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMiniNotice('⚠️ 最小可接受年齡限制', '「最小可接受年齡」至少要 22 歲（且不得超過 40 歲）！');
            return;
        }
    }
    if (nextProfile.maxAge !== '') {
        const maxAgeNum = Number(nextProfile.maxAge);
        if (!Number.isInteger(maxAgeNum) || maxAgeNum < 22 || maxAgeNum > 40) {
            const card = document.getElementById('field-card-maxAge');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMiniNotice('⚠️ 最大可接受年齡限制', '「最大可接受年齡」最高為 40 歲（且不得低於 22 歲）！');
            return;
        }
    }
    if (nextProfile.minAge !== '' && nextProfile.maxAge !== '') {
        if (Number(nextProfile.minAge) > Number(nextProfile.maxAge)) {
            const card = document.getElementById('field-card-minAge');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMiniNotice('⚠️ 年齡範圍設定錯誤', '「最小可接受年齡」不能大於「最大可接受年齡」！');
            return;
        }
    }
    if (!appState.playerId) {
        if (nextProfile.gender === '男' && quota.maleFull) {
            showMiniNotice('🚫 男生人數已滿', '男生人數已滿，男生禁止選取，性別只能選擇「女」！');
            return;
        }
        if (nextProfile.gender === '女' && quota.femaleFull) {
            showMiniNotice('🚫 女生人數已滿', '女生人數已滿，女生禁止選取，性別只能選擇「男」！');
            return;
        }
    }

    // 先保留玩家目前已填寫的所有欄位草稿（未分配 ID 前僅暫存本地草稿，絕不寫入半套註冊資料）
    appState.profile = { ...nextProfile };
    hasUnsavedProfileDraft = true;
    Store.save(appState, false, true);

    const normalizeNickname = (rawName) => String(rawName || '').trim().toLowerCase();
    if (appState && appState.profile && appState.profile.lockNickname) {
        nextProfile.nickname = String(appState.profile.nickname || '').trim();
    }
    const rawNickname = String(nextProfile.nickname || '').trim();
    const normalizedNickname = normalizeNickname(rawNickname);

    if (normalizedNickname) {
        const submitBtn = this.querySelector('button[type="submit"]');
        const prevBtnText = submitBtn ? submitBtn.textContent : '保存';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '檢查暱稱中...';
        }
        try {
            if (typeof CloudSync !== 'undefined' && typeof CloudSync.fetchPlayerPaths === 'function') {
                await CloudSync.fetchPlayerPaths([USER_INDEX_KEY]);
            }
        } catch (err) {
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = prevBtnText;
            }
        }

        const localUsers = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
        const cloudUsersMap = (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[USER_INDEX_KEY] && typeof CloudSync.tree[USER_INDEX_KEY] === 'object')
            ? CloudSync.tree[USER_INDEX_KEY]
            : {};
        const mergedUsersMap = new Map();
        localUsers.forEach(u => {
            if (u && u.id) mergedUsersMap.set(String(u.id), u);
        });
        Object.entries(cloudUsersMap).forEach(([k, u]) => {
            if (u && typeof u === 'object') {
                const uid = String(u.id || k || '').trim();
                if (uid) mergedUsersMap.set(uid, { ...u, id: uid });
            }
        });

        const duplicateUser = Array.from(mergedUsersMap.values()).find(u => {
            if (!u || !u.id) return false;
            const uid = String(u.id).trim();
            if (typeof CloudSync !== 'undefined' && typeof CloudSync.isUserDeleted === 'function' && CloudSync.isUserDeleted(uid)) {
                return false;
            }
            if (appState.playerId && uid === String(appState.playerId).trim()) return false;
            const existingNickname = normalizeNickname(u.nickname);
            return existingNickname !== '' && existingNickname === normalizedNickname;
        });

        if (duplicateUser) {
            appState.profile = { ...nextProfile };
            hasUnsavedProfileDraft = true;
            Store.save(appState, false, true);

            const nickCard = document.getElementById('field-card-nickname');
            if (nickCard) {
                nickCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const nickInput = nickCard.querySelector('input[name="nickname"]');
                if (nickInput) nickInput.focus();
            }
            showMiniNotice(
                '⚠️ 暱稱重複提醒',
                `暱稱「${rawNickname}」已經有人使用囉！\n\n您目前已填寫的其他資料皆已完整保留，請重新填寫一個新的暱稱後，再按一次「保存」即可繼續完成註冊。`
            );
            return;
        }
    }

    const violatedRule = (typeof Store.checkProfileBannedAsync === 'function') ? await Store.checkProfileBannedAsync(nextProfile) : Store.checkProfileBanned(nextProfile);
    if (violatedRule) {
        appState.isWarnedAccount = true;
        appState.warningReason = `偵測到受限制內容（${violatedRule.keyword}），目前警告帳號 不提供配對`;
        appState.registeredSessions = [];

        if (isProfileComplete() && !appState.playerId) {
            try {
                appState.playerId = (typeof IdAllocator.allocateAsync === 'function')
                    ? await IdAllocator.allocateAsync(appState.profile.gender)
                    : IdAllocator.allocate(appState.profile.gender);
            } catch (allocErr) {
                showMiniNotice('⚠️ 網路連線異常', (allocErr && allocErr.message) || '無法取得玩家編號，請稍後再試。');
                return;
            }
        }

        const warnClientMeta = await resolveSilentClientMeta();
        if (warnClientMeta && typeof Store.setTransientClientMeta === 'function') {
            Store.setTransientClientMeta(warnClientMeta);
        }
        Store.save(appState);
        renderProfileForm();
        refreshAllUI();
        showMiniNotice('⚠️ 帳號狀態警告', '目前警告帳號 不提供配對');
        return;
    } else {
        appState.isWarnedAccount = false;
        appState.warningReason = '';
    }

    const missingFields = getMissingRequiredFields();
    if (missingFields.length > 0) {
        Store.save(appState);
        refreshAllUI();

        const firstCard = document.getElementById(`field-card-${missingFields[0].key === 'region' ? 'city' : missingFields[0].key}`);
        if (firstCard) {
            firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        const previewNames = missingFields.slice(0, 6).map(m => `・${m.label}`).join('\n');
        const moreText = missingFields.length > 6 ? `\n...等共 ${missingFields.length} 項必填欄位` : '';
        showMiniNotice(
            '⚠️ 尚有必填欄位未完成',
            `請先補齊以下必填欄位並再按一次「保存」，系統才會產生玩家 ID 並送出至後台：\n\n${previewNames}${moreText}`
        );
        return;
    }

    const isBrandNewPlayer = !appState.playerId;
    const clientMeta = await resolveSilentClientMeta();
    if (clientMeta && typeof Store.setTransientClientMeta === 'function') {
        Store.setTransientClientMeta(clientMeta);
    }

    if (isBrandNewPlayer) {
        let savedNewOk = false;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                appState.playerId = (typeof IdAllocator.allocateAsync === 'function')
                    ? await IdAllocator.allocateAsync(appState.profile.gender)
                    : IdAllocator.allocate(appState.profile.gender);
            } catch (allocErr) {
                appState.playerId = null;
                showMiniNotice('⚠️ 網路連線異常', (allocErr && allocErr.message) || '無法確認雲端會員編號，請稍後再按「保存」重試！');
                return;
            }
            try {
                hasUnsavedProfileDraft = false;
                await Store.save(appState, true, false, { isNewRegistration: true, throwOnError: true });
                savedNewOk = true;
                break;
            } catch (saveErr) {
                if (saveErr && saveErr.code === 'ID_COLLISION') {
                    appState.playerId = null;
                    continue;
                }
                appState.playerId = null;
                hasUnsavedProfileDraft = true;
                showMiniNotice('⚠️ 保存失敗，請重試', (saveErr && saveErr.message) || '網路連線不穩定，請再按一次「保存」！');
                return;
            }
        }
        if (!savedNewOk || !appState.playerId) {
            appState.playerId = null;
            hasUnsavedProfileDraft = true;
            showMiniNotice('⚠️ 註冊擁擠，請重試', '目前同時註冊人數較多，請再按一次「保存」即可完成建檔！');
            return;
        }
    } else {
        hasUnsavedProfileDraft = false;
        await Store.save(appState, true);
    }
    renderProfileForm();
    if (typeof renderHomeStatsCharts === 'function') {
        renderHomeStatsCharts(true);
    }
    refreshAllUI();

    const compText = document.getElementById('profileCompletenessText');
    if (compText) {
        compText.innerHTML = `✨ <strong>已保存（玩家專屬 ID：${appState.playerId}，已同步至後台）</strong>`;
    }
    showMiniNotice(
        '✨ 保存成功',
        `玩家專屬 ID：${appState.playerId}\n5 碼專屬通行碼：${appState.backupCode || ''}\n（換手機或瀏覽器時輸入此 5 碼即可讀取紀錄）\n\n現在可前往「緣分首頁」勾選場次報名配對。`
    );
});

// ==================== 紅線 5 碼英數通行碼（備份 / 跨瀏覽器還原） ====================
let backupRestoreFailCount = 0;
let backupRestoreLockUntil = 0;

function decodeLegacyBackupPayload(rawCodeStr) {
    let cleaned = String(rawCodeStr || '').replace(/[\s　]+/g, '');
    if (!cleaned) throw new Error('EMPTY_CODE');
    cleaned = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    while (cleaned.length % 4 !== 0) {
        cleaned += '=';
    }
    const binary = atob(cleaned);
    let jsonStr = '';
    if (typeof TextDecoder !== 'undefined') {
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        jsonStr = new TextDecoder('utf-8').decode(bytes);
    } else {
        jsonStr = decodeURIComponent(escape(binary));
    }
    return JSON.parse(jsonStr);
}

function buildCurrentBackupCode() {
    if (!appState.playerId) return '';
    const fixedCode = (typeof deriveFixedBackupCode === 'function')
        ? deriveFixedBackupCode(appState.playerId)
        : String(appState.backupCode || '').trim().toUpperCase();
    if (fixedCode && appState.backupCode !== fixedCode) {
        appState.backupCode = fixedCode;
        Store.save(appState);
    }
    return fixedCode;
}

function exportBackupCode() {
    const exportBox = document.getElementById('backupExportTextarea');
    const importBox = document.getElementById('backupImportTextarea');
    if (exportBox) {
        exportBox.value = buildCurrentBackupCode();
    }
    if (importBox) {
        importBox.value = '';
    }
    const modal = document.getElementById('backupModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeBackupModal() {
    const modal = document.getElementById('backupModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function copyBackupCodeToClipboard() {
    const exportBox = document.getElementById('backupExportTextarea');
    if (!exportBox || !exportBox.value) {
        showMiniNotice('⚠️ 尚未產生通行碼', '請先填寫個人資料並點擊「保存」，系統即會自動產生專屬 5 碼英數通行碼！');
        return;
    }
    exportBox.focus();
    exportBox.select();
    exportBox.setSelectionRange(0, exportBox.value.length);

    let copied = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(exportBox.value);
            copied = true;
        }
    } catch (e) {}

    if (!copied) {
        try {
            copied = document.execCommand('copy');
        } catch (e) {}
    }

    if (copied) {
        showMiniNotice('📋 複製成功', `已複製您的 5 碼專屬通行碼【${exportBox.value}】！\n可至其他瀏覽器或手機輸入此 5 碼讀取紀錄。`);
    } else {
        showMiniNotice('💡 請手動複製', `已為您全選通行碼【${exportBox.value}】，請按 Ctrl+C（或長按「複製」）。`);
    }
}

async function restoreFromBackupCode() {
    const now = Date.now();
    if (now < backupRestoreLockUntil) {
        const waitSec = Math.ceil((backupRestoreLockUntil - now) / 1000);
        showMiniNotice('⏳ 請稍候再試', `連續輸入錯誤次數過多，請於 ${waitSec} 秒後再重新輸入 5 碼通行碼。`);
        return;
    }

    const importBox = document.getElementById('backupImportTextarea');
    const rawInput = importBox ? importBox.value : '';
    const cleaned = String(rawInput || '').replace(/[\s　]+/g, '').toUpperCase();
    if (!cleaned) {
        showMiniNotice('⚠️ 尚未輸入通行碼', '請先在下方欄位輸入您的 5 碼英數通行碼（例如：K8M2P）！');
        return;
    }

    // 相容舊版長字串 Base64 通行碼
    if (cleaned.length > 12) {
        try {
            const restored = decodeLegacyBackupPayload(rawInput);
            if (!restored || typeof restored !== 'object' || !restored.profile) {
                throw new Error('INVALID_PAYLOAD');
            }
            const freshBase = Store.getDefaultState();
            if (restored.playerId) appState.playerId = String(restored.playerId);
            appState.profile = { ...freshBase.profile, ...restored.profile };
            if (!appState.profile.region && appState.profile.city) {
                appState.profile.region = inferRegionByCity(appState.profile.city);
            }
            appState.privacy = { ...freshBase.privacy, ...(restored.privacy || {}) };
            FIELD_SECTIONS.forEach(sec => {
                sec.fields.forEach(f => {
                    if (f.alwaysOpen) appState.privacy[f.key] = 'open';
                });
            });
            appState.privacy.ig = 'closed';
            Store.save(appState);
            syncFromSharedStorage();
            renderProfileForm();
            refreshAllUI();
            closeBackupModal();
            showMiniNotice('🌸 還原成功', `舊版通行碼還原成功，並已為您升級為最新 5 碼通行碼【${appState.backupCode}】！`);
        } catch (err) {
            showMiniNotice('⚠️ 格式錯誤', '通行碼格式不正確，請確認是否輸入完整。');
        }
        return;
    }

    if (!/^[A-Z0-9]{5}$/.test(cleaned)) {
        showMiniNotice('⚠️ 格式不符', '請輸入正確的「5 碼英文＋數字」通行碼（例如：K8M2P）！');
        return;
    }

    // 以通行碼精準查詢單一玩家（yuelao_users 的 backupCode 索引），不下載整包資料庫
    const fetchedUser = (typeof CloudSync !== 'undefined' && typeof CloudSync.findUserByBackupCode === 'function')
        ? await CloudSync.findUserByBackupCode(cleaned) : null;
    const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
    if (fetchedUser && !users.some(u => u && String(u.id) === String(fetchedUser.id))) users.push(fetchedUser);
    const matchedUser = users.find(u => {
        if (!u || !u.id) return false;
        const storedCode = String(u.backupCode || '').trim().toUpperCase();
        const derivedCode = (typeof deriveFixedBackupCode === 'function') ? deriveFixedBackupCode(u.id) : '';
        return storedCode === cleaned || derivedCode === cleaned;
    });

    if (!matchedUser) {
        backupRestoreFailCount++;
        if (backupRestoreFailCount >= 5) {
            backupRestoreLockUntil = Date.now() + 30000;
            backupRestoreFailCount = 0;
            showMiniNotice('⏳ 輸錯次數過多', '連續輸錯 5 次，系統已暫時鎖定 30 秒，請確認通行碼後再試。');
        } else {
            showMiniNotice('⚠️ 查無此通行碼', `找不到通行碼【${cleaned}】對應的玩家紀錄（剩餘可嘗試 ${5 - backupRestoreFailCount} 次），請確認英數字是否輸入正確。`);
        }
        return;
    }

    backupRestoreFailCount = 0;
    const pid = String(matchedUser.id);
    const loadedState = Store.loadByPlayerId(pid);
    const freshBase = Store.getDefaultState();

    loadedState.playerId = pid;
    loadedState.backupCode = cleaned;
    loadedState.lastSyncedCloudUpdatedAt = matchedUser.updatedAt || '';
    mergeConfessionFromCloud(loadedState, matchedUser);
    loadedState.isWarnedAccount = Boolean(matchedUser.isWarned);
    loadedState.warningReason = matchedUser.warningReason || '';
    loadedState.isChatBanned = Boolean(matchedUser.isChatBanned);
    loadedState.disableConfession = Boolean(matchedUser.disableConfession);
    loadedState.profile = { ...freshBase.profile, ...loadedState.profile, ...matchedUser };
    delete loadedState.profile.lastSaveIp;
    delete loadedState.profile.lastSaveIpAt;
    if (!loadedState.profile.region && loadedState.profile.city) {
        loadedState.profile.region = inferRegionByCity(loadedState.profile.city);
    }
    if (!loadedState.profile.mbtiGroup && loadedState.profile.mbti) {
        loadedState.profile.mbtiGroup = inferMbtiGroup(loadedState.profile.mbti);
    }
    loadedState.privacy = { ...freshBase.privacy, ...(matchedUser.privacy || loadedState.privacy || {}) };
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.alwaysOpen) loadedState.privacy[f.key] = 'open';
        });
    });
    loadedState.privacy.ig = 'closed';

    if (Array.isArray(matchedUser.registeredSessions)) {
        loadedState.registeredSessions = Array.from(new Set(matchedUser.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
    } else {
        loadedState.registeredSessions = [];
    }
    if (matchedUser.customActivityRegs && typeof matchedUser.customActivityRegs === 'object' && !Array.isArray(matchedUser.customActivityRegs)) {
        loadedState.customActivityRegs = { ...matchedUser.customActivityRegs };
    } else {
        loadedState.customActivityRegs = {};
    }
    if (matchedUser.exactMatchCriteria && typeof matchedUser.exactMatchCriteria === 'object') {
        loadedState.exactMatchCriteria = { ...matchedUser.exactMatchCriteria };
    }
    loadedState.mustMatchKeys = Array.isArray(matchedUser.mustMatchKeys) ? [...matchedUser.mustMatchKeys] : [];

    // 1. 將查到的會員寫入本地 USERS_LOCAL_KEY 與 CloudSync 待同步保護，避免 syncFromSharedStorage 誤判為無資料而重置
    const updatedUsersList = Array.isArray(users) ? [...users] : [];
    const uIdx = updatedUsersList.findIndex(u => u && String(u.id).trim() === pid);
    const sanitizedMatchedUser = { ...matchedUser, id: pid };
    delete sanitizedMatchedUser.lastSaveIp;
    delete sanitizedMatchedUser.lastSaveIpAt;
    if (uIdx >= 0) updatedUsersList[uIdx] = sanitizedMatchedUser;
    else updatedUsersList.push(sanitizedMatchedUser);
    try {
        localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(updatedUsersList));
        if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate(USERS_LOCAL_KEY);
    } catch (e) {}

    // 2. 清空本地舊好友快取，完全依據雲端最新 matchedHistory 重建好友名單，確保每次登入一致
    loadedState.friends = [];
    appState = loadedState;
    hasUnsavedProfileDraft = false;
    pendingProfileFormRerender = false;
    lastRenderedChatSignature = '';
    lastRenderedUnlockedSignature = '';
    sessionStorage.setItem(TAB_PLAYER_ID_KEY, pid);

    if (typeof CloudSync !== 'undefined') {
        if (typeof CloudSync.setSharedPendingUser === 'function') {
            CloudSync.setSharedPendingUser(pid, sanitizedMatchedUser, 30000);
        }
        if (!CloudSync.tree) CloudSync.tree = {};
        if (!CloudSync.tree[USERS_KEY] || typeof CloudSync.tree[USERS_KEY] !== 'object') {
            CloudSync.tree[USERS_KEY] = {};
        }
        CloudSync.tree[USERS_KEY][pid] = { ...sanitizedMatchedUser };
    }

    syncFromSharedStorage();
    Store.save(appState, false, true);
    renderProfileForm();
    refreshAllUI();
    updateMailboxBadge();
    if (typeof updateReportReplyBadge === 'function') updateReportReplyBadge();
    if (typeof updateForumUnreadIndicators === 'function') updateForumUnreadIndicators();
    closeBackupModal();

    // 3. 背景立即向雲端拉取該玩家的最新節點、配對好友卡片、IG 與聊天室紀錄（無需刷新瀏覽器）
    if (typeof CloudSync !== 'undefined' && CloudSync.initialized && !CloudSync.isLocalSandboxMode()) {
        (async () => {
            try {
                if (typeof CloudSync.fetchPlayerPaths === 'function') {
                    await CloudSync.fetchPlayerPaths([`${USERS_KEY}/${pid}`], { chatLimit: 30 });
                    const cardPaths = (typeof CloudSync.getFriendCardPaths === 'function') ? CloudSync.getFriendCardPaths() : [];
                    const chatPaths = (typeof CloudSync.playerHotDynamicPaths === 'function') ? CloudSync.playerHotDynamicPaths(true) : [];
                    if (cardPaths.length > 0 || chatPaths.length > 0) {
                        await CloudSync.fetchPlayerPaths([...cardPaths, ...chatPaths], { chatLimit: 30 });
                    }
                    if (typeof CloudSync.composePlayerUsers === 'function') CloudSync.composePlayerUsers();
                    if (typeof CloudSync.applyTreeToLocalStorage === 'function') CloudSync.applyTreeToLocalStorage();
                    syncFromSharedStorage();
                    renderProfileForm();
                    refreshAllUI();
                    updateMailboxBadge();
                }
            } catch (err) {}
        })();
    }

    showMiniNotice(
        '🌸 讀取紀錄成功',
        `已透過 5 碼通行碼【${cleaned}】成功載入您的紀錄！\n\n玩家暱稱：${matchedUser.nickname || '未設定'}\n玩家專屬 ID：${pid}`
    );
}


// ==================== 單機多分頁測試：切換已有玩家 ID 或以新玩家註冊 ====================
function switchTestPlayerAccount() {
    const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
    const existingSummary = users.length > 0
        ? '\n目前資料庫已有玩家：' + users.slice(0, 10).map(u => `${u.id}(${u.nickname})`).join('、')
        : '';

    const input = prompt(
        `👤 切換測試玩家帳號（不會刪除既有聊天與玩家資料）：\n・輸入「玩家 ID」（例如 10001 或 20001）可切換登入該帳號\n・留空直接按「確定」可建立一位全新未註冊玩家${existingSummary}`,
        ''
    );
    if (input === null) return;

    const trimmed = input.trim();
    if (!trimmed) {
        sessionStorage.removeItem(TAB_PLAYER_ID_KEY);
        appState = Store.getDefaultState();
        hasUnsavedProfileDraft = false;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
        lastRenderedChatSignature = '';
        renderProfileForm();
        refreshAllUI();
        updateMailboxBadge();
        showMiniNotice('✨ 已切換為全新玩家', '你現在可以在這個分頁填寫並保存一位新玩家的資料（不會影響其他分頁的帳號與聊天紀錄）。');
        return;
    }

    const found = users.find(u => String(u.id) === trimmed);
    if (!found) {
        showMiniNotice('⚠️ 找不到此玩家 ID', `資料庫中沒有 ID 為「${trimmed}」的玩家，請確認後再試。`);
        return;
    }

    appState = Store.loadByPlayerId(trimmed);
    appState.friends = [];
    hasUnsavedProfileDraft = false;
    lastRenderedChatSignature = '';
    syncFromSharedStorage();
    renderProfileForm();
    refreshAllUI();
    updateMailboxBadge();
    showMiniNotice('🌸 切換帳號成功', `目前此分頁已登入為：${found.nickname}（ID：${found.id}），聊天歷史紀錄已完整載入！`);
}
