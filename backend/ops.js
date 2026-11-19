/* backend/ops.js - 後台信件發送、玩家問題回報、禁止字眼規則與互動流程測試工具 */

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

function deleteIssueReport(reportId) {
    const reports = getReports();
    const target = reports.find(r => String(r.id) === String(reportId));
    if (!target) return;
    if (!confirm(`確定要刪除問題回報單號「${target.id}」的資料嗎？\n刪除後將同步移除雲端紀錄且無法復原。`)) {
        return;
    }
    const remaining = reports.filter(r => String(r.id) !== String(reportId));
    localStorage.setItem(REPORTS_KEY, JSON.stringify(remaining));
    CloudSync.deleteNode(`${REPORTS_KEY}/${target.id}`);
    renderAdminAll();
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

const expandedAdminReportIds = new Set();
let reportsPageSize = '5';
let currentReportsPage = 1;

function getSortedAdminReports(rawReports) {
    const list = Array.isArray(rawReports) ? [...rawReports] : [];
    const getReportTimestamp = (item) => {
        const directTs = Number(item && item.ts);
        if (!Number.isNaN(directTs) && directTs > 0) return directTs;
        if (item && item.createdAt) {
            const parsed = Date.parse(String(item.createdAt));
            if (!Number.isNaN(parsed)) return parsed;
        }
        return 0;
    };

    list.sort((a, b) => {
        const aResolved = (a && a.status === '已解決') ? 1 : 0;
        const bResolved = (b && b.status === '已解決') ? 1 : 0;
        // 1. 「待處理」排在「已解決」前面
        if (aResolved !== bResolved) {
            return aResolved - bResolved;
        }
        // 2. 同狀態內依最新時間排在前面（新到舊）
        const tsDiff = getReportTimestamp(b) - getReportTimestamp(a);
        if (tsDiff !== 0) return tsDiff;
        return String((b && b.id) || '').localeCompare(String((a && a.id) || ''));
    });
    return list;
}

function onReportsPageSizeChange(newSize) {
    reportsPageSize = String(newSize || '5');
    currentReportsPage = 1;
    renderAdminAll(true);
}

function goToReportsPage(pageNum) {
    const targetPage = parseInt(pageNum, 10);
    if (Number.isNaN(targetPage) || targetPage < 1) return;
    currentReportsPage = targetPage;
    renderAdminAll(true);
}

function toggleAdminReportExpand(reportId) {
    const key = String(reportId || '').trim();
    if (!key) return;
    if (expandedAdminReportIds.has(key)) {
        expandedAdminReportIds.delete(key);
    } else {
        expandedAdminReportIds.add(key);
    }
    renderAdminAll(true);
}

function expandAllAdminReports() {
    const reports = getReports();
    reports.forEach(r => expandedAdminReportIds.add(String(r.id)));
    renderAdminAll(true);
}

function collapseAllAdminReports() {
    expandedAdminReportIds.clear();
    renderAdminAll(true);
}

function renderOpsPageSection(batch, currentSched, maxDisplayBatch) {
    const sysCfg = (typeof getSystemConfig === 'function')
        ? getSystemConfig()
        : { registrationOpen: true, profileLocked: false, genderLimitEnabled: false, genderLimitMax: 30, wishEarlyCloseCanMatch: true };

    let effectiveUsers = (typeof getUsers === 'function') ? getUsers() : [];
    if ((!Array.isArray(effectiveUsers) || effectiveUsers.length === 0) && typeof CloudSync !== 'undefined' && CloudSync.tree && typeof USER_INDEX_KEY !== 'undefined' && CloudSync.tree[USER_INDEX_KEY] && typeof CloudSync.tree[USER_INDEX_KEY] === 'object') {
        effectiveUsers = Object.values(CloudSync.tree[USER_INDEX_KEY]).filter(u => u && typeof u === 'object' && u.id);
    }
    const maleCount = effectiveUsers.filter(u => u && u.id && u.gender === '男').length;
    const femaleCount = effectiveUsers.filter(u => u && u.id && u.gender === '女').length;

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
        liveCountBadge.textContent = `目前玩家人數：男生 ${maleCount} 人 ／ 女生 ${femaleCount} 人（女生不限）`;
    }
    const genderLimitDesc = document.getElementById('genderLimitSwitchDesc');
    const genderLimitBtn = document.getElementById('toggleGenderLimitBtn');
    if (genderLimitDesc && genderLimitBtn) {
        if (sysCfg.genderLimitEnabled) {
            const max = sysCfg.genderLimitMax;
            const maleStatus = maleCount >= max ? '（已滿）' : '';
            genderLimitDesc.className = 'text-[11px] text-emerald-600 font-semibold';
            genderLimitDesc.textContent = `目前狀態：🟢 已開啟限制（男生上限 ${max} 人${maleStatus} ／ 女生不限人數）`;
            genderLimitBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold shadow transition bg-gray-700 text-white hover:bg-gray-800';
            genderLimitBtn.textContent = '關閉「男生人數限制」';
        } else {
            genderLimitDesc.className = 'text-[11px] text-gray-500 font-semibold';
            genderLimitDesc.textContent = '目前狀態：⚪ 未開啟（男女生皆不限制人數）';
            genderLimitBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold shadow transition bg-[#c96a7b] text-white hover:opacity-95';
            genderLimitBtn.textContent = '開啟「男生人數限制」';
        }
    }

    const forceBatchSel = document.getElementById('forceBatchSelect');
    if (forceBatchSel && typeof getBatchScheduleInfo === 'function') {
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
        else if (currentSched && currentSched.batchPrefix) forceBatchSel.value = currentSched.batchPrefix;
    }

    const rulesBox = document.getElementById('forceMatchRulesList');
    if (rulesBox && typeof getForceRules === 'function') {
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

    const escapeAdminHtml = (str) => String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const maxReportsLimit = (typeof REPORTS_MAX_COUNT !== 'undefined') ? REPORTS_MAX_COUNT : 15;
    let rawReports = getReports();
    if (rawReports.length > maxReportsLimit) {
        const byTimeDesc = [...rawReports].sort((a, b) => {
            const diff = Number((b && b.ts) || 0) - Number((a && a.ts) || 0);
            if (diff !== 0) return diff;
            return String((b && b.id) || '').localeCompare(String((a && a.id) || ''));
        });
        const keptReports = byTimeDesc.slice(0, maxReportsLimit);
        const removedOldest = byTimeDesc.slice(maxReportsLimit);
        localStorage.setItem(REPORTS_KEY, JSON.stringify(keptReports));
        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('reports');
        }
        if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
            removedOldest.forEach(oldRep => {
                if (oldRep && oldRep.id) {
                    if (CloudSync.tree && CloudSync.tree[REPORTS_KEY] && typeof CloudSync.tree[REPORTS_KEY] === 'object') {
                        delete CloudSync.tree[REPORTS_KEY][oldRep.id];
                    }
                    CloudSync.deleteNode(`${REPORTS_KEY}/${oldRep.id}`);
                }
            });
        }
        rawReports = keptReports;
    }

    const sortedReports = getSortedAdminReports(rawReports);
    const pendingTotal = sortedReports.filter(r => r && r.status !== '已解決').length;
    const resolvedTotal = sortedReports.length - pendingTotal;

    const summaryBadgeEl = document.getElementById('reportsStatusSummaryBadge');
    if (summaryBadgeEl) {
        summaryBadgeEl.textContent = `待處理 ${pendingTotal} 則 ／ 已解決 ${resolvedTotal} 則`;
    }

    const pageSizeSelEl = document.getElementById('reportsPageSizeSelect');
    if (pageSizeSelEl && pageSizeSelEl.value !== reportsPageSize) {
        pageSizeSelEl.value = reportsPageSize;
    }

    const totalReports = sortedReports.length;
    const isShowAllReports = (reportsPageSize === 'all');
    const numericRepPageSize = isShowAllReports ? Math.max(1, totalReports) : Math.max(1, parseInt(reportsPageSize, 10) || 5);
    const totalReportPages = isShowAllReports ? 1 : Math.max(1, Math.ceil(totalReports / numericRepPageSize));
    if (currentReportsPage > totalReportPages) currentReportsPage = totalReportPages;
    if (currentReportsPage < 1) currentReportsPage = 1;
    const repStartIdx = isShowAllReports ? 0 : (currentReportsPage - 1) * numericRepPageSize;
    const pagedReports = isShowAllReports ? sortedReports : sortedReports.slice(repStartIdx, repStartIdx + numericRepPageSize);

    const rListBox = document.getElementById('reportsAccordionList');
    if (rListBox) {
        if (totalReports === 0) {
            rListBox.innerHTML = `<div class="p-6 text-center text-xs text-gray-400 bg-pink-50/30 rounded-2xl border border-dashed border-pink-200">目前尚無玩家提交問題回報。</div>`;
        } else {
            rListBox.innerHTML = pagedReports.map((r, idx) => {
                const repId = String(r.id);
                const globalOrder = repStartIdx + idx + 1;
                const isExpanded = expandedAdminReportIds.has(repId);
                const isResolved = r.status === '已解決';
                const replyText = String(r.adminReply || '').trim();
                const titleText = String(r.title || r.category || '問題回報').trim();
                const contactLabel = String(r.contact || '匿名玩家').trim();
                const timeLabel = String(r.createdAt || '').trim();

                const statusBadge = isResolved
                    ? `<span class="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold shrink-0">✅ 已解決</span>`
                    : `<span class="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold shrink-0">⏳ 待處理</span>`;

                const replyTag = replyText
                    ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-[#8f4452] font-bold shrink-0">💬 已回覆</span>`
                    : '';

                const replyPreviewHtml = replyText
                    ? `<div class="p-3 rounded-xl bg-rose-50/80 border border-pink-200 text-xs text-[#6e3a43] space-y-1">
                            <div class="flex items-center justify-between gap-2 text-[11px]">
                                <span class="font-bold text-[#8f4452]">💬 管理員回覆</span>
                                <span class="text-[10px] text-gray-400">${escapeAdminHtml(r.repliedAt || '')}</span>
                            </div>
                            <p class="whitespace-pre-line leading-relaxed">${escapeAdminHtml(replyText)}</p>
                       </div>`
                    : `<div class="text-[11px] text-gray-400 bg-gray-50 px-3 py-2 rounded-xl border border-gray-100">（尚未回覆此問題）</div>`;

                const detailBodyHtml = isExpanded ? `
                    <div class="p-4 pt-3 border-t border-pink-100 bg-pink-50/20 space-y-3">
                        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-mono font-bold text-[#8f4452] bg-white px-2.5 py-0.5 rounded-lg border border-pink-200">單號：${escapeAdminHtml(repId)}</span>
                                <span class="bg-white px-2.5 py-0.5 rounded-lg border border-pink-200">回報玩家：<strong>${escapeAdminHtml(contactLabel)}</strong></span>
                            </div>
                            <span class="text-[11px] text-gray-400">送出時間：${escapeAdminHtml(timeLabel)}</span>
                        </div>

                        <div class="p-3 rounded-xl bg-white border border-pink-200 text-xs text-gray-700 space-y-1">
                            <span class="text-[11px] font-bold text-[#c96a7b] block">問題內容描述：</span>
                            <div class="whitespace-pre-line leading-relaxed">${escapeAdminHtml(r.content || '')}</div>
                        </div>

                        ${replyPreviewHtml}

                        <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
                            <button type="button" onclick="toggleReportStatus('${escapeAdminHtml(repId)}')" class="px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${isResolved ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100' : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'}">
                                ${isResolved ? '↩ 改回「待處理」' : '✅ 標記為「已解決」'}
                            </button>
                            <button type="button" onclick="openReplyReportModal('${escapeAdminHtml(repId)}')" class="px-3.5 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 transition shadow-2xs">
                                ${replyText ? '✏️ 編輯回覆' : '💬 回覆問題'}
                            </button>
                            <button type="button" onclick="deleteIssueReport('${escapeAdminHtml(repId)}')" class="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-100 transition">
                                🗑️ 刪除
                            </button>
                        </div>
                    </div>
                ` : '';

                return `
                    <div class="rounded-2xl bg-white border ${isExpanded ? 'border-[#c96a7b] shadow-sm' : (isResolved ? 'border-pink-200/70 opacity-90 hover:opacity-100 hover:border-pink-300' : 'border-amber-300/90 hover:border-[#c96a7b]')} overflow-hidden transition">
                        <button type="button" onclick="toggleAdminReportExpand('${escapeAdminHtml(repId)}')" class="w-full px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-left hover:bg-pink-50/35 transition">
                            <div class="flex flex-wrap items-center gap-2 min-w-0">
                                <span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md ${isResolved ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-800 border border-amber-200'} shrink-0">#${globalOrder}</span>
                                <span class="text-sm shrink-0">📮</span>
                                <span class="text-xs md:text-sm font-bold text-[#8f4452] truncate">${escapeAdminHtml(titleText)}</span>
                                ${replyTag}
                                <span class="text-[11px] text-gray-500 truncate">・${escapeAdminHtml(contactLabel)}</span>
                                ${timeLabel ? `<span class="text-[10px] text-gray-400 font-mono shrink-0">(${escapeAdminHtml(timeLabel)})</span>` : ''}
                            </div>
                            <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                ${statusBadge}
                                <span class="text-xs font-semibold text-[#c96a7b]">${isExpanded ? '▴ 收合明細' : '▾ 點開查看明細'}</span>
                            </div>
                        </button>
                        ${detailBodyHtml}
                    </div>
                `;
            }).join('');
        }
    }

    const repPaginationBar = document.getElementById('reportsPaginationBar');
    if (repPaginationBar) {
        const sizeQuickBtnsHtml = [
            { val: '5', label: '5 則' },
            { val: '10', label: '10 則' },
            { val: 'all', label: '全部' }
        ].map(opt => {
            const active = reportsPageSize === opt.val;
            return `<button type="button" onclick="onReportsPageSizeChange('${opt.val}')" class="px-2.5 h-7 rounded-lg font-bold transition ${active ? 'bg-[#c96a7b] text-white shadow-sm' : 'bg-white border border-pink-300 text-[#8f4452] hover:bg-pink-100'}">${opt.label}</button>`;
        }).join('');

        if (totalReports === 0) {
            repPaginationBar.innerHTML = `
                <span class="text-gray-400">共 0 則問題回報</span>
                <div class="flex items-center gap-1.5">
                    <span class="text-gray-500 font-semibold">每頁顯示：</span>
                    ${sizeQuickBtnsHtml}
                </div>
            `;
        } else {
            const showFrom = repStartIdx + 1;
            const showTo = isShowAllReports ? totalReports : Math.min(repStartIdx + numericRepPageSize, totalReports);
            const pageBtns = [];
            for (let p = 1; p <= totalReportPages; p++) {
                if (p === 1 || p === totalReportPages || Math.abs(p - currentReportsPage) <= 1) {
                    const isCur = p === currentReportsPage;
                    pageBtns.push(`
                        <button type="button" onclick="goToReportsPage(${p})" class="min-w-[30px] h-7 px-2 rounded-lg font-bold transition ${isCur ? 'bg-[#c96a7b] text-white shadow-sm' : 'bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50'}">
                            ${p}
                        </button>
                    `);
                } else if (pageBtns[pageBtns.length - 1] !== '<span class="px-1 text-gray-400">...</span>') {
                    pageBtns.push('<span class="px-1 text-gray-400">...</span>');
                }
            }
            const modeSummaryText = isShowAllReports
                ? `目前已顯示全部 <strong>${totalReports}</strong> 則`
                : `第 <strong>${currentReportsPage}</strong> / ${totalReportPages} 頁，每頁 ${numericRepPageSize} 則`;

            repPaginationBar.innerHTML = `
                <div class="text-gray-600 font-medium">
                    顯示第 <strong class="text-[#8f4452]">${showFrom}～${showTo}</strong> 則，共 <strong class="text-[#8f4452]">${totalReports}</strong> 則（${modeSummaryText}）
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <div class="flex items-center gap-1.5 bg-pink-50/60 px-2.5 py-1 rounded-xl border border-pink-200">
                        <span class="text-gray-500 font-bold">顯示則數：</span>
                        ${sizeQuickBtnsHtml}
                    </div>
                    ${isShowAllReports ? '' : `
                        <div class="flex flex-wrap items-center gap-1.5">
                            <button type="button" onclick="goToReportsPage(${currentReportsPage - 1})" ${currentReportsPage <= 1 ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                                ◀ 上一頁
                            </button>
                            ${pageBtns.join('')}
                            <button type="button" onclick="goToReportsPage(${currentReportsPage + 1})" ${currentReportsPage >= totalReportPages ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                                下一頁 ▶
                            </button>
                        </div>
                    `}
                </div>
            `;
        }
    }

    const sessionSel = document.getElementById('adminSessionSelect');
    if (sessionSel) {
        const prevSessionVal = sessionSel.value;
        const sessionOpts = [];
        for (let b = 1; b <= maxDisplayBatch; b++) {
            const info = getBatchScheduleInfo(b);
            sessionOpts.push(info.wedLabel, info.satLabel);
        }
        sessionSel.innerHTML = sessionOpts.map(s => `<option value="${s}">${s}</option>`).join('');
        if (sessionOpts.includes(prevSessionVal)) {
            sessionSel.value = prevSessionVal;
        } else {
            const nowObj = new Date();
            const isAfterWed20 = (nowObj.getDay() > 3) || (nowObj.getDay() === 3 && nowObj.getHours() >= 20);
            sessionSel.value = isAfterWed20 ? currentSched.satLabel : currentSched.wedLabel;
        }
    }

    const mailSummaryBox = document.getElementById('adminMailReadCheckSummaryBox');
    const mailListBox = document.getElementById('adminSentMailsList');
    if (mailListBox || mailSummaryBox) {
        const sentMails = getMailbox();
        const usersList = (typeof getUsers === 'function') ? getUsers() : [];
        const userByIdMap = new Map();
        usersList.forEach(u => {
            if (u && u.id) userByIdMap.set(String(u.id).trim(), u);
        });

        const resolveSingleMailReadInfo = (m) => {
            const tId = String((m && m.targetId) || '').trim();
            if (!tId || tId.toUpperCase() === 'ALL') {
                return { isSingle: false, isRead: false, readAtStr: '' };
            }
            const targetU = userByIdMap.get(tId);
            const userReadIds = (targetU && Array.isArray(targetU.readMailIds)) ? targetU.readMailIds.map(String) : [];
            const isRead = Boolean(m.isReadByTarget || userReadIds.includes(String(m.id)));
            return {
                isSingle: true,
                isRead,
                readAtStr: String(m.readAtStr || '').trim()
            };
        };

        if (mailSummaryBox) {
            const dailyReport = (typeof getDailySingleMailReadReport === 'function') ? getDailySingleMailReadReport() : null;
            const singleMails = sentMails.filter(m => {
                const tId = String((m && m.targetId) || '').trim();
                return tId !== '' && tId.toUpperCase() !== 'ALL';
            });
            const readSingleMails = singleMails.filter(m => resolveSingleMailReadInfo(m).isRead);
            const unreadSingleMails = singleMails.filter(m => !resolveSingleMailReadInfo(m).isRead);
            const lastCheckedLabel = (dailyReport && dailyReport.checkedAtStr)
                ? `最近檢查：${escapeAdminHtml(dailyReport.checkedAtStr)}`
                : '每日自動檢查 1 次';

            const chipsHtml = singleMails.length === 0
                ? `<span class="text-[11px] text-gray-400">目前尚無指定單一玩家的信件（發給單一玩家時將自動追蹤已讀狀態）。</span>`
                : singleMails.slice(0, 8).map(m => {
                    const info = resolveSingleMailReadInfo(m);
                    const recLabel = escapeAdminHtml(m.targetLabel || `ID:${m.targetId}`);
                    const titleShort = escapeAdminHtml(m.title || '');
                    if (info.isRead) {
                        return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] font-bold">✅ ${recLabel}「${titleShort}」已讀${info.readAtStr ? `（${escapeAdminHtml(info.readAtStr)}）` : ''}</span>`;
                    }
                    return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-800 text-[11px] font-bold">⏳ ${recLabel}「${titleShort}」尚未讀取</span>`;
                }).join('');

            mailSummaryBox.innerHTML = `
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="font-bold text-[#8f4452]">📅 單一玩家信件已讀追蹤（每日自動檢查 1 次）</span>
                        <span class="px-2 py-0.5 rounded-full bg-pink-50 border border-pink-200 text-[#8f4452] text-[11px] font-semibold">
                            單一信件 ${singleMails.length} 封：✅ 已讀 ${readSingleMails.length} ／ ⏳ 未讀 ${unreadSingleMails.length}
                        </span>
                        <span class="text-[11px] text-gray-400">${lastCheckedLabel}</span>
                    </div>
                    <button type="button" onclick="runManualSingleMailReadCheck()" class="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-300 text-[#8f4452] text-[11px] font-bold hover:bg-rose-100 transition shrink-0">
                        🔍 立即檢查已讀狀態
                    </button>
                </div>
                <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                    ${chipsHtml}
                </div>
            `;
        }

        if (mailListBox) {
            if (sentMails.length === 0) {
                mailListBox.innerHTML = `<p class="text-xs text-gray-400">尚未發送任何信件給前台玩家。</p>`;
            } else {
                mailListBox.innerHTML = sentMails.slice(0, 10).map(m => {
                    const editedTag = m.updatedAt
                        ? `<span class="text-[10px] px-1.5 py-0.2 rounded bg-sky-50 border border-sky-200 text-sky-700 font-semibold ml-1.5">已編輯</span>`
                        : '';
                    const readInfo = resolveSingleMailReadInfo(m);
                    let readBadgeHtml = '';
                    if (!readInfo.isSingle) {
                        readBadgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold mr-1.5">📢 全體公告</span>`;
                    } else if (readInfo.isRead) {
                        readBadgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-[10px] font-bold mr-1.5">✅ 玩家已讀${readInfo.readAtStr ? `（${escapeAdminHtml(readInfo.readAtStr)}）` : ''}</span>`;
                    } else {
                        readBadgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-bold mr-1.5">⏳ 尚未讀取</span>`;
                    }
                    return `
                    <div class="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-pink-200 text-xs">
                        <div class="min-w-0 flex-1">
                            <span class="px-2 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold mr-1.5">收件：${escapeAdminHtml(m.targetLabel || m.targetId)}</span>
                            ${readBadgeHtml}
                            <strong class="text-[#5e464a]">${escapeAdminHtml(m.title)}</strong>
                            <span class="text-gray-500 ml-1.5">— ${escapeAdminHtml(m.content)}</span>
                            <span class="text-[10px] text-gray-400 ml-2">(${escapeAdminHtml(m.createdAt || '')})</span>
                            ${editedTag}
                        </div>
                        <div class="flex items-center gap-2.5 shrink-0">
                            <button type="button" onclick="openEditAdminMailboxModal('${escapeAdminHtml(m.id)}')" class="text-sky-600 hover:underline font-semibold">✏️ 編輯</button>
                            <button type="button" onclick="deleteMailboxMessage('${escapeAdminHtml(m.id)}')" class="text-rose-500 hover:underline font-semibold">收回刪除</button>
                        </div>
                    </div>
                    `;
                }).join('');
            }
        }
    }

    const fateWallListBox = document.getElementById('adminFateWallList');
    const fateWallCountBadge = document.getElementById('adminFateWallCountBadge');
    if (fateWallListBox) {
        const posts = (typeof getFateWallPosts === 'function') ? getFateWallPosts() : [];
        if (fateWallCountBadge) {
            fateWallCountBadge.textContent = `共 ${posts.length} 則動態`;
        }
        if (posts.length === 0) {
            fateWallListBox.innerHTML = `<p class="text-xs text-gray-400">尚未新增任何緣分動態牆內容，新增後將即時顯示於前台首頁。</p>`;
        } else {
            const escFw = (str) => String(str ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            fateWallListBox.innerHTML = posts.map(p => {
                const isDynamic = (typeof hasFateWallDynamicFields === 'function') && hasFateWallDynamicFields(p.content);
                const dynamicBadge = isDynamic
                    ? `<span class="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold shrink-0">🎲 地區・年齡・MBTI 每次刷新隨機</span>`
                    : '';
                return `
                <div class="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-pink-200 text-xs">
                    <div class="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                        <span class="px-2 py-0.5 rounded-full bg-pink-100 text-[#8f4452] font-bold shrink-0">${escFw(p.tag || '🌸 月老動態')}</span>
                        <span class="font-semibold text-[#5e464a] break-all">${escFw(p.content)}</span>
                        ${dynamicBadge}
                        <span class="text-[10px] font-mono text-gray-400 ml-1">(${escFw(p.createdAt || '')})</span>
                    </div>
                    <div class="flex items-center gap-2.5 shrink-0">
                        <button type="button" onclick="openEditAdminFateWallModal('${escFw(p.id)}')" class="text-sky-600 hover:underline font-semibold">✏️ 編輯</button>
                        <button type="button" onclick="deleteAdminFateWallEntry('${escFw(p.id)}')" class="text-rose-500 hover:underline font-semibold">🗑️ 刪除</button>
                    </div>
                </div>
                `;
            }).join('');
        }
    }

    const earlyCloseDescEl = document.getElementById('wishEarlyCloseMatchDesc');
    const earlyCloseBtnEl = document.getElementById('toggleWishEarlyCloseMatchBtn');
    if (earlyCloseDescEl && earlyCloseBtnEl) {
        const sysCfg = (typeof getSystemConfig === 'function') ? getSystemConfig() : { wishEarlyCloseCanMatch: true };
        const canMatch = Boolean(sysCfg.wishEarlyCloseCanMatch);
        if (canMatch) {
            earlyCloseDescEl.className = 'text-[11px] text-emerald-600 font-semibold mt-0.5';
            earlyCloseDescEl.textContent = '目前狀態：🟢 可進行好友配對（玩家提前結束題目後，仍可挑選匿名答案配對成好友）';
            earlyCloseBtnEl.className = 'px-4 py-2 rounded-xl text-xs font-bold shadow-2xs transition shrink-0 bg-gray-700 text-white hover:bg-gray-800';
            earlyCloseBtnEl.textContent = '切換為「提前結束不可配對」';
        } else {
            earlyCloseDescEl.className = 'text-[11px] text-rose-600 font-semibold mt-0.5';
            earlyCloseDescEl.textContent = '目前狀態：🚫 不可進行好友配對（玩家提前結束題目後，直接結束本輪不開放配對）';
            earlyCloseBtnEl.className = 'px-4 py-2 rounded-xl text-xs font-bold shadow-2xs transition shrink-0 bg-emerald-600 text-white hover:bg-emerald-700';
            earlyCloseBtnEl.textContent = '切換為「提前結束可進行配對」';
        }
    }

    if (typeof renderLinkedMockFriendsList === 'function') {}

    if (typeof renderLinkedMockFriendsList === 'function') {
        renderLinkedMockFriendsList();
    }

    const bannedRulesBox = document.getElementById('bannedRulesList');
    if (bannedRulesBox) {
        const bannedRules = getBannedRules();
        bannedRulesBox.innerHTML = bannedRules.map(r => `
            <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-xs text-rose-800 font-semibold">
                <span>[${BAN_FIELD_NAMES[r.field] || r.field}] 禁止「${r.keyword}」</span>
                <button onclick="removeBannedRule('${r.id}')" class="text-rose-500 hover:text-rose-800 font-bold">✕</button>
            </span>
        `).join('');
    }
}


function openReplyReportModal(reportId) {
    const reports = getReports();
    const target = reports.find(r => String(r.id) === String(reportId));
    if (!target) return;

    const escapeHtml = (str) => String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    document.getElementById('replyReportTargetId').value = String(target.id);
    document.getElementById('replyReportTextarea').value = target.adminReply || '';
    const markResolvedEl = document.getElementById('replyReportMarkResolved');
    if (markResolvedEl) markResolvedEl.checked = true;

    const infoBox = document.getElementById('replyReportInfoBox');
    if (infoBox) {
        infoBox.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-pink-100 pb-1.5">
                <span class="font-bold text-[#8f4452]">單號：${escapeHtml(target.id)} ・ ${escapeHtml(target.category || '')}</span>
                <span class="text-[11px] text-gray-500">回報玩家：<strong>${escapeHtml(target.contact || '匿名玩家')}</strong></span>
            </div>
            <div class="text-[11px] text-gray-400">送出時間：${escapeHtml(target.createdAt || '')}</div>
            <div class="pt-1 text-gray-700 whitespace-pre-line leading-relaxed">${escapeHtml(target.content || '')}</div>
        `;
    }

    document.getElementById('replyReportModal').classList.remove('hidden');
    setTimeout(() => {
        const ta = document.getElementById('replyReportTextarea');
        if (ta) ta.focus();
    }, 50);
}

function closeReplyReportModal() {
    document.getElementById('replyReportModal').classList.add('hidden');
}

function submitAdminReportReply(e) {
    e.preventDefault();
    const targetId = document.getElementById('replyReportTargetId').value.trim();
    const replyText = document.getElementById('replyReportTextarea').value.trim();
    const markResolved = Boolean(document.getElementById('replyReportMarkResolved')?.checked);

    if (!replyText) {
        alert('請輸入回覆內容！');
        return;
    }

    const reports = getReports();
    const target = reports.find(r => String(r.id) === String(targetId));
    if (!target) return;

    target.adminReply = replyText;
    target.repliedAt = new Date().toLocaleString('zh-TW');
    if (markResolved) {
        target.status = '已解決';
    }

    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    if (typeof CloudSync !== 'undefined') {
        CloudSync.putNode(`${REPORTS_KEY}/${target.id}`, target);
    }

    closeReplyReportModal();
    renderAdminAll();
    appendLog(`<span class="text-sky-300">[回覆問題回報]</span> 已回覆玩家 <strong>${target.contact || '匿名玩家'}</strong> 的問題單號 <strong>${target.id}</strong>（狀態：${target.status}），已同步至前台！`);
}

// 資料維護工具：手動回填公開索引與配對節點（可重複執行，結果一致）
async function runBackfillDerivedNodes() {
    if (typeof CloudSync === 'undefined' || typeof CloudSync.backfillDerivedNodes !== 'function') {
        alert('雲端同步模組尚未載入，請重新整理後再試。');
        return;
    }
    try {
        if (typeof CloudSync.ensureBackendNodes === 'function') {
            await CloudSync.ensureBackendNodes([USERS_KEY, USER_INDEX_KEY]);
        }
        const r = await CloudSync.backfillDerivedNodes();
        alert(`✅ 公開索引回填完成：會員 ${r.users} 位，寫入 ${r.writes} 筆（已一致的資料不會重複寫入）`);
    } catch (e) {
        alert('回填失敗：' + (e && e.message ? e.message : e));
    }
}

/* ===== 流量修復：資料庫瘦身清理（玩家操作日誌 7 天前 + 已解除配對且超過 7 天的聊天室）===== */
const DB_CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function collectDbCleanupTargets() {
    const cutoff = Date.now() - DB_CLEANUP_RETENTION_MS;
    const tree = (typeof CloudSync !== 'undefined' && CloudSync.tree) ? CloudSync.tree : {};
    const opLogs = (tree[PLAYER_OP_LOGS_KEY] && typeof tree[PLAYER_OP_LOGS_KEY] === 'object') ? tree[PLAYER_OP_LOGS_KEY] : {};
    const opKeys = Object.keys(opLogs).filter(k => Number((opLogs[k] || {}).ts || 0) < cutoff);
    const unmatched = (tree[UNMATCHED_PAIRS_CLOUD_NODE] && typeof tree[UNMATCHED_PAIRS_CLOUD_NODE] === 'object') ? tree[UNMATCHED_PAIRS_CLOUD_NODE] : {};
    const chats = (tree[CHATS_KEY] && typeof tree[CHATS_KEY] === 'object') ? tree[CHATS_KEY] : {};
    const roomKeys = Object.keys(unmatched).filter(pk => {
        const item = unmatched[pk] || {};
        if (item.permanent || Number(item.graceUntil || 0) > Date.now()) return false;
        const at = Number(item.unmatchedAt || 0);
        return at > 0 && at < cutoff && Boolean(chats[pk]);
    });
    return { opKeys, roomKeys };
}

async function previewDbCleanup() {
    const box = document.getElementById('dbCleanupResult');
    if (!box) return;
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.ensureBackendNodes === 'function') {
        await CloudSync.ensureBackendNodes([PLAYER_OP_LOGS_KEY, UNMATCHED_PAIRS_CLOUD_NODE, CHATS_KEY]);
    }
    const t = collectDbCleanupTargets();
    const tree = (typeof CloudSync !== 'undefined' && CloudSync.tree) ? CloudSync.tree : {};
    let freed = 0;
    t.opKeys.forEach(k => { freed += JSON.stringify(tree[PLAYER_OP_LOGS_KEY][k]).length + k.length; });
    t.roomKeys.forEach(pk => { freed += JSON.stringify(tree[CHATS_KEY][pk]).length + pk.length; });
    const totalKB = Math.round(JSON.stringify(tree).length / 1024);
    box.innerHTML = `預覽：玩家操作日誌 <strong>${t.opKeys.length}</strong> 筆、已解除配對的舊聊天室 <strong>${t.roomKeys.length}</strong> 間，預估可釋放約 <strong>${Math.round(freed / 1024)} KB</strong>（後台目前快取約 ${totalKB} KB）。`;
    box.classList.remove('hidden');
}

async function runDbCleanup() {
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.ensureBackendNodes === 'function') {
        await CloudSync.ensureBackendNodes([PLAYER_OP_LOGS_KEY, UNMATCHED_PAIRS_CLOUD_NODE, CHATS_KEY]);
    }
    const t = collectDbCleanupTargets();
    if (!t.opKeys.length && !t.roomKeys.length) {
        alert('目前沒有需要清理的資料。');
        return;
    }
    if (!confirm(`確定執行清理？\n・玩家操作日誌：${t.opKeys.length} 筆（7 天前）\n・已解除配對的舊聊天室：${t.roomKeys.length} 間\n清理後雲端與本地皆會刪除，無法復原。`)) return;
    try {
        if (t.opKeys.length) {
            const p = {};
            t.opKeys.forEach(k => { p[k] = null; });
            await CloudSync.patchNode(PLAYER_OP_LOGS_KEY, p, { throwOnError: true });
        }
        if (t.roomKeys.length) {
            const chatPatch = {};
            const unPatch = {};
            t.roomKeys.forEach(pk => { chatPatch[pk] = null; unPatch[pk] = null; });
            await CloudSync.patchNode(CHATS_KEY, chatPatch, { throwOnError: true });
            await CloudSync.patchNode(UNMATCHED_PAIRS_CLOUD_NODE, unPatch, { throwOnError: true });
        }
        alert('清理完成。');
        if (typeof renderAdminAll === 'function') renderAdminAll(true);
        previewDbCleanup();
    } catch (err) {
        alert('清理失敗，請稍後重試（已完成的部分不會重複刪除）。');
    }
}
