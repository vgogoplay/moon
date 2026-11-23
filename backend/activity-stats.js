/* backend/activity-stats.js - 後台某屆／單場／自定義活動報名、配對成功與失敗名單統計紀錄 */

let showAllActivitiesStatsTable = false;
let actDetailRosterStatusFilter = 'ALL'; // 'ALL' | 'MATCHED' | 'UNMATCHED'
let actDetailRosterGenderFilter = 'ALL'; // 'ALL' | '男' | '女'
let actDetailRosterSearchKeyword = '';
let actDetailRosterPageSize = '10';
let currentActDetailRosterPage = 1;
let lastActDetailTargetKey = '';

function escapeActStatHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toggleAllActivitiesStatsTable() {
    showAllActivitiesStatsTable = !showAllActivitiesStatsTable;
    const wrap = document.getElementById('allActivitiesStatsTableWrap');
    const btn = document.getElementById('toggleAllStatsTableBtn');
    if (wrap) wrap.classList.toggle('hidden', !showAllActivitiesStatsTable);
    if (btn) btn.textContent = showAllActivitiesStatsTable ? '🔼 收合全部活動總覽' : '📋 展開全部活動總覽';
    renderAdminAll();
}

function selectActivityStatsTarget(targetVal) {
    const sel = document.getElementById('activityStatsTargetSelect');
    if (sel) {
        sel.value = targetVal;
        currentActDetailRosterPage = 1;
        renderAdminAll();
    }
}

function setActDetailRosterStatusFilter(val) {
    actDetailRosterStatusFilter = ['ALL', 'MATCHED', 'UNMATCHED'].includes(val) ? val : 'ALL';
    currentActDetailRosterPage = 1;
    renderAdminAll();
}

function setActDetailRosterGenderFilter(val) {
    actDetailRosterGenderFilter = ['ALL', '男', '女'].includes(val) ? val : 'ALL';
    currentActDetailRosterPage = 1;
    renderAdminAll();
}

function onActDetailRosterSearchInput(val) {
    actDetailRosterSearchKeyword = String(val || '').trim();
    currentActDetailRosterPage = 1;
    renderAdminAll();
}

function onActDetailRosterPageSizeChange(val) {
    actDetailRosterPageSize = ['5', '10', '30', 'all'].includes(String(val)) ? String(val) : '10';
    currentActDetailRosterPage = 1;
    renderAdminAll();
}

function goToActDetailRosterPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    currentActDetailRosterPage = p;
    renderAdminAll();
}

let pendingSupplementaryMatchPlan = null;
let suppPreviewStatusFilter = 'ALL'; // 'ALL' | 'WILL_MATCH' | 'NO_MATCH'
let suppPreviewGenderFilter = 'ALL'; // 'ALL' | '男' | '女'
let suppPreviewSearchKeyword = '';

function closeSupplementaryMatchPreviewModal() {
    pendingSupplementaryMatchPlan = null;
    const modal = document.getElementById('supplementaryMatchPreviewModal');
    if (modal) modal.classList.add('hidden');
}

function setSuppPreviewStatusFilter(val) {
    suppPreviewStatusFilter = ['ALL', 'WILL_MATCH', 'NO_MATCH'].includes(val) ? val : 'ALL';
    renderSupplementaryMatchPreviewModalBody();
}

function setSuppPreviewGenderFilter(val) {
    suppPreviewGenderFilter = ['ALL', '男', '女'].includes(val) ? val : 'ALL';
    renderSupplementaryMatchPreviewModalBody();
}

function onSuppPreviewSearchInput(val) {
    suppPreviewSearchKeyword = String(val || '').trim();
    renderSupplementaryMatchPreviewModalBody();
}

function renderSupplementaryMatchPreviewModalBody() {
    if (!pendingSupplementaryMatchPlan) return;
    const { sessions, sessionPreviews, allCandidateRows, totalPlannedPairs } = pendingSupplementaryMatchPlan;
    const showSessionTag = sessions.length > 1;

    const totalUnmatched = allCandidateRows.length;
    const maleUnmatched = allCandidateRows.filter(r => r.gender === '男').length;
    const femaleUnmatched = allCandidateRows.filter(r => r.gender === '女').length;
    const willMatchRows = allCandidateRows.filter(r => r.willMatch);
    const noMatchRows = allCandidateRows.filter(r => !r.willMatch);

    const sessBadge = document.getElementById('suppPreviewSessionBadge');
    if (sessBadge) sessBadge.textContent = sessions.join(' ＋ ');

    const totEl = document.getElementById('suppPreviewTotalCount');
    if (totEl) totEl.textContent = `${totalUnmatched} 人`;

    const genEl = document.getElementById('suppPreviewGenderBreakdown');
    if (genEl) genEl.textContent = `男 ${maleUnmatched} 人 ／ 女 ${femaleUnmatched} 人`;

    const matchEl = document.getElementById('suppPreviewMatchedCount');
    if (matchEl) matchEl.textContent = `${totalPlannedPairs} 對（${willMatchRows.length} 人）`;

    const remEl = document.getElementById('suppPreviewRemainUnmatchedCount');
    if (remEl) remEl.textContent = `${noMatchRows.length} 人`;

    const statusBar = document.getElementById('suppPreviewStatusFilterBar');
    if (statusBar) {
        const mkStatusBtn = (code, label, activeCls) => {
            const act = suppPreviewStatusFilter === code;
            return `<button type="button" onclick="setSuppPreviewStatusFilter('${code}')" class="px-3 py-1.5 rounded-xl text-xs font-bold transition ${act ? activeCls : 'bg-white border border-pink-200 text-gray-600 hover:bg-pink-50'}">${label}</button>`;
        };
        statusBar.innerHTML = [
            mkStatusBtn('ALL', `全部補跑名單 (${totalUnmatched}人)`, 'bg-[#8f4452] text-white shadow-2xs'),
            mkStatusBtn('WILL_MATCH', `✅ 預計可配對 (${willMatchRows.length}人)`, 'bg-emerald-600 text-white shadow-2xs'),
            mkStatusBtn('NO_MATCH', `🍃 暫無對象 (${noMatchRows.length}人)`, 'bg-amber-600 text-white shadow-2xs')
        ].join('');
    }

    const genderBar = document.getElementById('suppPreviewGenderFilterBar');
    if (genderBar) {
        const mkGenBtn = (code, label) => {
            const act = suppPreviewGenderFilter === code;
            return `<button type="button" onclick="setSuppPreviewGenderFilter('${code}')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${act ? 'bg-[#8f4452] text-white' : 'bg-white border border-pink-200 text-gray-600 hover:bg-pink-50'}">${label}</button>`;
        };
        genderBar.innerHTML = `<span class="text-[11px] text-gray-500 font-bold">性別：</span>` +
            mkGenBtn('ALL', '全部') + mkGenBtn('男', '男') + mkGenBtn('女', '女');
    }

    const kw = suppPreviewSearchKeyword.toLowerCase();
    const filtered = allCandidateRows.filter(r => {
        if (suppPreviewStatusFilter === 'WILL_MATCH' && !r.willMatch) return false;
        if (suppPreviewStatusFilter === 'NO_MATCH' && r.willMatch) return false;
        if (suppPreviewGenderFilter !== 'ALL' && r.gender !== suppPreviewGenderFilter) return false;
        if (kw) {
            const hay = `${r.playerId} ${r.nickname} ${r.partnerId} ${r.partnerName} ${r.reasonText} ${r.session}`.toLowerCase();
            if (!hay.includes(kw)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('suppPreviewTableBody');
    if (tbody) {
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-gray-400">目前篩選條件下沒有符合的補跑名單資料。</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(r => {
                const statusBadge = r.willMatch
                    ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-[11px] font-bold">✅ 預計可配對</span>`
                    : (r.isExcluded
                        ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-100 border border-rose-300 text-rose-700 text-[11px] font-bold">🚫 排除不配對</span>`
                        : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-800 text-[11px] font-bold">🍃 暫無對象</span>`);

                const gBadge = r.gender === '男'
                    ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-bold text-[11px] ml-1">男</span>`
                    : (r.gender === '女' ? `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold text-[11px] ml-1">女</span>` : '');
                const metaText = [r.age ? `${r.age}歲` : '', r.region || ''].filter(Boolean).join('・');
                const sessTag = showSessionTag
                    ? `<div class="text-[10px] text-pink-600 font-semibold mt-0.5">[${escapeActStatHtml(r.session)}]</div>`
                    : '';

                let detailCellHtml = '';
                if (r.willMatch) {
                    const pGBadge = r.partnerGender === '男'
                        ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-bold text-[10px] ml-1">男</span>`
                        : (r.partnerGender === '女' ? `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold text-[10px] ml-1">女</span>` : '');
                    detailCellHtml = `💘 預計配對：<strong>${escapeActStatHtml(r.partnerName)}</strong>${pGBadge} <span class="font-mono text-gray-500">(ID:${escapeActStatHtml(r.partnerId)})</span>`;
                } else {
                    detailCellHtml = `<span class="text-amber-800 font-medium">${escapeActStatHtml(r.reasonText)}</span>`;
                }

                return `
                    <tr class="${r.willMatch ? 'bg-emerald-50/20 hover:bg-emerald-50/40' : 'hover:bg-amber-50/35'} transition">
                        <td class="p-3 text-xs whitespace-nowrap">${statusBadge}</td>
                        <td class="p-3 text-xs whitespace-nowrap">
                            <span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-mono font-bold mr-1">${escapeActStatHtml(r.playerId)}</span>
                            <span class="font-bold text-gray-800">${escapeActStatHtml(r.nickname)}</span>
                            ${gBadge}
                            ${metaText ? `<span class="text-[11px] text-gray-400 ml-1">(${escapeActStatHtml(metaText)})</span>` : ''}
                            ${sessTag}
                        </td>
                        <td class="p-3 text-[11px] leading-relaxed">${formatStatsUserCriteriaHtml(r.userObj)}</td>
                        <td class="p-3 text-xs leading-relaxed">${detailCellHtml}</td>
                        <td class="p-3 text-xs font-bold text-gray-500 whitespace-nowrap">${escapeActStatHtml(r.roleTypeText)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    const confirmBtn = document.getElementById('confirmRunSuppMatchBtn');
    if (confirmBtn) {
        confirmBtn.textContent = totalPlannedPairs > 0
            ? `💘 確認執行補跑名單（預計配對 ${totalPlannedPairs} 對）`
            : `💘 確認執行補跑名單`;
    }
}

function openSupplementaryMatchPreviewModal(sessionLabels) {
    const sessions = (Array.isArray(sessionLabels) ? sessionLabels : [sessionLabels])
        .map(s => String(s || '').trim())
        .filter(Boolean);
    if (sessions.length === 0) return;

    if (typeof previewSessionSupplementaryMatch !== 'function' || typeof runSessionMatch !== 'function') {
        alert('配對模組尚未載入，請重新整理頁面後再試。');
        return;
    }

    const sessionPreviews = sessions
        .map(s => previewSessionSupplementaryMatch(s))
        .filter(Boolean);

    const allCandidateRows = [];
    let totalPlannedPairs = 0;
    sessionPreviews.forEach(sp => {
        totalPlannedPairs += (sp.plannedPairs || []).length;
        (sp.candidateRows || []).forEach(row => allCandidateRows.push(row));
    });

    if (allCandidateRows.length === 0) {
        alert(`ℹ️【${sessions.join(' ＋ ')}】目前所有報名玩家皆已完成配對，沒有尚未配對的補跑名單！`);
        return;
    }

    pendingSupplementaryMatchPlan = {
        sessions,
        sessionPreviews,
        allCandidateRows,
        totalPlannedPairs
    };
    suppPreviewStatusFilter = 'ALL';
    suppPreviewGenderFilter = 'ALL';
    suppPreviewSearchKeyword = '';

    const searchInput = document.getElementById('suppPreviewSearchInput');
    if (searchInput) searchInput.value = '';

    renderSupplementaryMatchPreviewModalBody();

    const modal = document.getElementById('supplementaryMatchPreviewModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function confirmAndRunSupplementaryMatch() {
    if (!pendingSupplementaryMatchPlan) return;
    if (typeof runSessionMatch !== 'function') {
        alert('配對模組尚未載入，請重新整理頁面後再試。');
        return;
    }

    const plan = pendingSupplementaryMatchPlan;
    closeSupplementaryMatchPreviewModal();

    const summaries = plan.sessionPreviews.map(sp =>
        runSessionMatch(false, sp.session, { preferredPairs: sp.plannedPairs || [] })
    ).filter(Boolean);

    renderAdminAll(true);

    if (summaries.length === 1) {
        const res = summaries[0];
        alert(`💘【${res.session}】補跑結算完成！\n\n・報名總人數：${res.totalRegCount} 人（男 ${res.maleRegCount} ／ 女 ${res.femaleRegCount}）\n・最新成功配對：${res.matchedCount} 人（共 ${res.matchedPairCount} 對）\n・尚未配對人數：${res.unmatchedCount} 人`);
    } else if (summaries.length > 1) {
        const lines = summaries.map(res =>
            `【${res.session}】報名 ${res.totalRegCount} 人 → 成功 ${res.matchedCount} 人（${res.matchedPairCount} 對）、未配對 ${res.unmatchedCount} 人`
        );
        alert(`💘 整屆場次補跑結算完成！\n\n${lines.join('\n')}`);
    }
}

function runSupplementaryMatchForBatch(...sessionLabels) {
    const labels = sessionLabels.flat().map(s => String(s || '').trim()).filter(Boolean);
    openSupplementaryMatchPreviewModal(labels);
}

function runSupplementaryMatchForSession(sessionLabel) {
    openSupplementaryMatchPreviewModal([sessionLabel]);
}

window.closeSupplementaryMatchPreviewModal = closeSupplementaryMatchPreviewModal;
window.setSuppPreviewStatusFilter = setSuppPreviewStatusFilter;
window.setSuppPreviewGenderFilter = setSuppPreviewGenderFilter;
window.onSuppPreviewSearchInput = onSuppPreviewSearchInput;
window.confirmAndRunSupplementaryMatch = confirmAndRunSupplementaryMatch;

function getMergedActivityRegHistoryList() {
    const map = (typeof getActivityRegHistory === 'function')
        ? getActivityRegHistory()
        : (() => {
            try {
                const raw = JSON.parse(localStorage.getItem('yuelao_activity_reg_history') || '{}');
                return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
            } catch (e) {
                return {};
            }
        })();
    return Object.values(map).filter(item => item && typeof item === 'object' && item.playerId);
}

function getSavedSessionMatchResultsMap() {
    const key = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined')
        ? SESSION_MATCH_RESULTS_KEY
        : 'yuelao_session_match_results';
    const merged = {};
    try {
        const localRaw = JSON.parse(localStorage.getItem(key) || '{}');
        if (localRaw && typeof localRaw === 'object' && !Array.isArray(localRaw)) {
            Object.assign(merged, localRaw);
        }
    } catch (e) {}
    if (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[key] && typeof CloudSync.tree[key] === 'object') {
        Object.entries(CloudSync.tree[key]).forEach(([docK, cSnap]) => {
            if (!cSnap || typeof cSnap !== 'object') return;
            const lSnap = merged[docK];
            if (!lSnap) {
                merged[docK] = cSnap;
            } else {
                const lPairs = Array.isArray(lSnap.matchedPairs) ? lSnap.matchedPairs : [];
                const cPairs = Array.isArray(cSnap.matchedPairs) ? cSnap.matchedPairs : [];
                if (cPairs.length > lPairs.length) {
                    merged[docK] = cSnap;
                }
            }
        });
    }
    return merged;
}

function formatStatsUserCriteriaHtml(u, archiveRec = null) {
    const crit = (u && u.exactMatchCriteria && typeof u.exactMatchCriteria === 'object' && Object.keys(u.exactMatchCriteria).length > 0)
        ? u.exactMatchCriteria
        : ((archiveRec && archiveRec.exactMatchCriteria && typeof archiveRec.exactMatchCriteria === 'object') ? archiveRec.exactMatchCriteria : {});
    const rawMust = (u && Array.isArray(u.mustMatchKeys) && u.mustMatchKeys.length > 0)
        ? u.mustMatchKeys
        : ((archiveRec && Array.isArray(archiveRec.mustMatchKeys)) ? archiveRec.mustMatchKeys : []);

    const keys = Object.keys(crit).filter(k => !(k === 'city' && crit.region));
    if (keys.length === 0) {
        return '<span class="text-gray-400">不限制（隨機配對）</span>';
    }
    const mustSet = new Set(rawMust.map(String).filter(k => keys.includes(k)).slice(0, 2));
    const renderItem = (k) => {
        if (k === 'region') return `地區:<strong>${escapeActStatHtml(crit.region)}</strong>`;
        const lbl = (typeof FIELD_LABELS !== 'undefined' && FIELD_LABELS[k]) ? FIELD_LABELS[k] : k;
        return `${escapeActStatHtml(lbl)}:<strong>${escapeActStatHtml(crit[k])}</strong>`;
    };
    const mustItems = keys.filter(k => mustSet.has(k)).map(renderItem);
    const orItems = keys.filter(k => !mustSet.has(k)).map(renderItem);
    const parts = [];
    if (mustItems.length > 0) {
        parts.push(`<span class="inline-block px-1.5 py-0.2 rounded bg-rose-100 border border-rose-300 text-[#8f4452] text-[10px] font-bold mr-1">🔒必須</span>${mustItems.join(' 且 ')}`);
    }
    if (orItems.length > 0) {
        parts.push(`<span class="inline-block px-1.5 py-0.2 rounded bg-pink-50 border border-pink-200 text-[#c96a7b] text-[10px] font-bold mr-1">✨選填</span>${orItems.join(' 或 ')}`);
    }
    return parts.join('<br>');
}

function diagnoseUnmatchedPlayerForStats(u, regUsersPool, savedFailReason = '') {
    if (!u) return savedFailReason || '尚未配對';
    if (u.isWarned) return '⚠️ 警告帳號（系統不提供配對）';
    if (u.isMatchBanned) return '🚫 管理員設定「禁止配對」';
    if (typeof diagnoseSessionUnmatchedReason === 'function' && Array.isArray(regUsersPool) && regUsersPool.length > 0) {
        return diagnoseSessionUnmatchedReason(u, regUsersPool, new Set());
    }
    return savedFailReason || '🔍 報名後尚未找到互相符合條件的配對對象';
}

function computeSingleActivityStats(targetKey, users, customActsList) {
    const validUsers = (users || []).filter(u => u && u.id);
    const userById = new Map();
    validUsers.forEach(u => userById.set(String(u.id).trim(), u));
    const archivedRecords = getMergedActivityRegHistoryList();
    const savedResultsMap = getSavedSessionMatchResultsMap();

    const getHist = (u) => {
        const rawHist = Array.isArray(u.matchedHistory)
            ? u.matchedHistory
            : (u.matchedHistory && typeof u.matchedHistory === 'object' ? Object.values(u.matchedHistory) : []);
        const hArr = rawHist.filter(h => h && h.partnerId).map(h => ({ ...h }));
        const dirId = String(u.matchedWithId || '').trim();
        if (dirId && !hArr.some(h => String(h.partnerId).trim() === dirId)) {
            hArr.push({
                session: u.matchedSession || '',
                partnerId: dirId,
                partnerName: u.matchedWithName || `玩家_${dirId}`
            });
        }
        return hArr;
    };

    if (targetKey.startsWith('batch:')) {
        const bNum = targetKey.split(':')[1];
        const targetPrefix = `第${bNum}屆`;
        const info = getBatchScheduleInfo(bNum);

        // 合併「目前仍在報名場次中」、「統計封存紀錄」與「場次結算快照」的整屆報名名單
        const regUserMap = new Map();
        const archiveByPid = new Map();
        const savedUnmatchedByPid = new Map();
        const savedMatchedByPid = new Map();

        validUsers.forEach(u => {
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
            if (sessions.some(s => extractBatchLabel(s) === targetPrefix)) {
                regUserMap.set(String(u.id).trim(), u);
            }
        });
        archivedRecords.forEach(rec => {
            if (rec.kind === 'regular' && rec.session && extractBatchLabel(rec.session) === targetPrefix) {
                const pid = String(rec.playerId).trim();
                archiveByPid.set(pid, rec);
                if (!regUserMap.has(pid)) {
                    const liveUser = userById.get(pid);
                    regUserMap.set(pid, liveUser || {
                        id: pid,
                        nickname: rec.nickname || `玩家_${pid}`,
                        gender: rec.gender || '',
                        exactMatchCriteria: rec.exactMatchCriteria || {},
                        mustMatchKeys: rec.mustMatchKeys || []
                    });
                }
            }
        });
        Object.values(savedResultsMap).forEach(snap => {
            if (!snap || extractBatchLabel(snap.session || '') !== targetPrefix) return;
            (snap.matchedUsers || []).forEach(mu => {
                const pid = String(mu.playerId || '').trim();
                if (!pid) return;
                savedMatchedByPid.set(pid, mu);
                if (!regUserMap.has(pid)) {
                    regUserMap.set(pid, userById.get(pid) || { id: pid, nickname: mu.nickname || `玩家_${pid}`, gender: mu.gender || '' });
                }
            });
            (snap.unmatchedUsers || []).forEach(uu => {
                const pid = String(uu.playerId || '').trim();
                if (!pid) return;
                savedUnmatchedByPid.set(pid, uu);
                if (!regUserMap.has(pid)) {
                    regUserMap.set(pid, userById.get(pid) || { id: pid, nickname: uu.nickname || `玩家_${pid}`, gender: uu.gender || '' });
                }
            });
        });

        const regUsers = Array.from(regUserMap.values());

        // 雙向對稱補齊該屆所有已配對玩家（避免強制配對或單邊未入列造成人數奇數差 1）
        const partnerLinksByPid = new Map();
        const ensureBatchLink = (ownerId, linkObj) => {
            const oid = String(ownerId || '').trim();
            const pid = String((linkObj && linkObj.partnerId) || '').trim();
            if (!oid || !pid || oid === pid) return;
            if (!partnerLinksByPid.has(oid)) partnerLinksByPid.set(oid, new Map());
            const sessNorm = normalizeSessionLabel(linkObj.session || '') || String(linkObj.session || '').trim();
            const dedupKey = `${pid}|${sessNorm}`;
            if (!partnerLinksByPid.get(oid).has(dedupKey)) {
                partnerLinksByPid.get(oid).set(dedupKey, {
                    partnerId: pid,
                    partnerName: linkObj.partnerName || '',
                    session: sessNorm
                });
            }
        };

        validUsers.forEach(u => {
            const uid = String(u.id).trim();
            const links = getHist(u).filter(h => !h.activityId && extractBatchLabel(h.session) === targetPrefix);
            links.forEach(lk => {
                const pId = String(lk.partnerId || '').trim();
                if (!pId) return;
                if (!regUserMap.has(uid)) regUserMap.set(uid, u);
                if (!regUserMap.has(pId)) {
                    regUserMap.set(pId, userById.get(pId) || { id: pId, nickname: lk.partnerName || `玩家_${pId}`, gender: pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : '') });
                }
                ensureBatchLink(uid, lk);
                ensureBatchLink(pId, { partnerId: uid, partnerName: u.nickname || `玩家_${uid}`, session: lk.session });
            });
        });

        savedMatchedByPid.forEach((savedM, uid) => {
            const pId = String(savedM.partnerId || '').trim();
            if (!pId) return;
            if (!regUserMap.has(uid)) {
                regUserMap.set(uid, userById.get(uid) || { id: uid, nickname: savedM.nickname || `玩家_${uid}`, gender: savedM.gender || '' });
            }
            if (!regUserMap.has(pId)) {
                regUserMap.set(pId, userById.get(pId) || { id: pId, nickname: savedM.partnerName || `玩家_${pId}`, gender: pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : '') });
            }
            ensureBatchLink(uid, savedM);
            ensureBatchLink(pId, { partnerId: uid, partnerName: savedM.nickname || `玩家_${uid}`, session: savedM.session });
        });

        const finalBatchRegUsers = Array.from(regUserMap.values());
        const uniquePairKeys = new Set();
        const matchedUsers = [];
        const rosterDetails = [];
        const matchedIdSet = new Set();

        finalBatchRegUsers.forEach(u => {
            const pid = String(u.id).trim();
            const liveU = userById.get(pid) || u;
            const linksMap = partnerLinksByPid.get(pid);
            const links = linksMap ? Array.from(linksMap.values()) : [];
            if (links.length > 0) {
                matchedIdSet.add(pid);
                matchedUsers.push(liveU);
                const partnerDesc = links.map(lk => {
                    const pId = String(lk.partnerId || '').trim();
                    const sessNorm = normalizeSessionLabel(lk.session || '') || String(lk.session || '').trim();
                    const pairKey = `${[pid, pId].sort().join('__')}|${sessNorm}`;
                    uniquePairKeys.add(pairKey);
                    const pUser = userById.get(pId);
                    const pName = (pUser && pUser.nickname) || lk.partnerName || `玩家_${pId}`;
                    const pGender = (pUser && pUser.gender) || (pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : ''));
                    const gBadgeHtml = pGender === '男' 
                        ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-bold text-[10px] ml-1">男</span>`
                        : (pGender === '女' ? `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold text-[10px] ml-1">女</span>` : '');
                    return `💘 <strong>${escapeActStatHtml(pName)}</strong>${gBadgeHtml} <span class="font-mono text-gray-500">(ID:${escapeActStatHtml(pId)})</span> <span class="text-[11px] text-pink-600">[${escapeActStatHtml(lk.session || '')}]</span>`;
                }).join('<br>');
                const roleDesc = links.map(lk => {
                    const pId = String(lk.partnerId || '').trim();
                    const pUser = userById.get(pId);
                    const pGender = (pUser && pUser.gender) || (pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : ''));
                    return `${liveU.gender || '?'} > ${pGender}`;
                }).join('<br>');
                rosterDetails.push({
                    playerId: pid,
                    nickname: liveU.nickname || `玩家_${pid}`,
                    gender: liveU.gender || '',
                    age: liveU.age || '',
                    region: liveU.region || '',
                    isMatched: true,
                    criteriaHtml: formatStatsUserCriteriaHtml(liveU, archiveByPid.get(pid)),
                    resultHtml: partnerDesc,
                    roleTypeHtml: roleDesc,
                    searchText: `${pid} ${liveU.nickname || ''} ${links.map(l => `${l.partnerId} ${l.partnerName} ${l.session}`).join(' ')} 配對成功`
                });
            }
        });

        const unmatchedUsers = finalBatchRegUsers.filter(u => !matchedIdSet.has(String(u.id).trim()));
        unmatchedUsers.forEach(u => {
            const pid = String(u.id).trim();
            const liveU = userById.get(pid) || u;
            const savedU = savedUnmatchedByPid.get(pid);
            const reason = diagnoseUnmatchedPlayerForStats(liveU, finalBatchRegUsers, savedU && savedU.failReason);
            rosterDetails.push({
                playerId: pid,
                nickname: liveU.nickname || `玩家_${pid}`,
                gender: liveU.gender || '',
                age: liveU.age || '',
                region: liveU.region || '',
                isMatched: false,
                criteriaHtml: formatStatsUserCriteriaHtml(liveU, archiveByPid.get(pid)),
                resultHtml: `<span class="text-amber-800 font-medium">${escapeActStatHtml(reason)}</span>`,
                roleTypeHtml: `${liveU.gender || '?'} > 未配對`,
                searchText: `${pid} ${liveU.nickname || ''} ${reason} 配對失敗 尚未配對`
            });
        });

        const isLegacyTwoDayBatch = Number(bNum) <= 2;
        return {
            key: targetKey,
            label: isLegacyTwoDayBatch
                ? `${info.batchPrefix}（${info.wedDateStr}(三) + ${info.satDateStr}(六)）`
                : `${info.batchPrefix}（${info.tueDateStr}(二) + ${info.thuDateStr}(四) + ${info.satDateStr}(六)）`,
            typeLabel: '常規屆數（整屆）',
            regUsers: finalBatchRegUsers,
            matchedUsers,
            matchedPairs: uniquePairKeys.size,
            unmatchedUsers,
            rosterDetails,
            singleSessionLabel: '',
            batchSessions: isLegacyTwoDayBatch
                ? [info.wedLabel, info.satLabel]
                : [info.tueLabel, info.thuLabel, info.satLabel],
            savedSnapshotAt: '',
            extraHtml: ''
        };
    }

    if (targetKey.startsWith('session:')) {
        const sessionLabel = targetKey.slice('session:'.length);
        const docKey = (typeof ActivityRegArchive !== 'undefined' && typeof ActivityRegArchive.sanitizeSeg === 'function')
            ? ActivityRegArchive.sanitizeSeg(sessionLabel)
            : sessionLabel.replace(/[\/.#$\[\]\s]+/g, '_');
        const snap = savedResultsMap[docKey] || Object.values(savedResultsMap).find(s => s && isSameSession(s.session, sessionLabel)) || null;

        const regUserMap = new Map();
        const archiveByPid = new Map();
        const savedUnmatchedByPid = new Map();
        const savedMatchedByPid = new Map();

        validUsers.forEach(u => {
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
            if (sessions.some(s => isSameSession(s, sessionLabel))) {
                regUserMap.set(String(u.id).trim(), u);
            }
        });
        archivedRecords.forEach(rec => {
            if (rec.kind === 'regular' && rec.session && isSameSession(rec.session, sessionLabel)) {
                const pid = String(rec.playerId).trim();
                archiveByPid.set(pid, rec);
                if (!regUserMap.has(pid)) {
                    const liveUser = userById.get(pid);
                    regUserMap.set(pid, liveUser || {
                        id: pid,
                        nickname: rec.nickname || `玩家_${pid}`,
                        gender: rec.gender || '',
                        exactMatchCriteria: rec.exactMatchCriteria || {},
                        mustMatchKeys: rec.mustMatchKeys || []
                    });
                }
            }
        });
        if (snap) {
            (snap.matchedUsers || []).forEach(mu => {
                const pid = String(mu.playerId || '').trim();
                if (!pid) return;
                savedMatchedByPid.set(pid, mu);
                if (!regUserMap.has(pid)) {
                    regUserMap.set(pid, userById.get(pid) || { id: pid, nickname: mu.nickname || `玩家_${pid}`, gender: mu.gender || '' });
                }
            });
            (snap.unmatchedUsers || []).forEach(uu => {
                const pid = String(uu.playerId || '').trim();
                if (!pid) return;
                savedUnmatchedByPid.set(pid, uu);
                if (!regUserMap.has(pid)) {
                    regUserMap.set(pid, userById.get(pid) || { id: pid, nickname: uu.nickname || `玩家_${pid}`, gender: uu.gender || '' });
                }
            });
        }

        // 嚴格 1 對 1 雙向互鎖配對表：唯有雙方皆尚未在本場次配對時才建立雙向連線，確保 成功配對人數 = 成功對數 × 2（如 72 人 = 36 對）
        let hasRawDuplicateInSession = false;
        const sessionLinksByPid = new Map();
        const tryBindSymmetric1to1Pair = (idA, nameA, idB, nameB, isForce = false) => {
            const a = String(idA || '').trim();
            const b = String(idB || '').trim();
            if (!a || !b || a === b) return;
            const mapA = sessionLinksByPid.get(a);
            const mapB = sessionLinksByPid.get(b);
            if (mapA && mapA.has(b) && mapB && mapB.has(a)) {
                if (isForce) {
                    mapA.get(b).isForceRepaired = true;
                    mapB.get(a).isForceRepaired = true;
                }
                return;
            }
            if ((mapA && mapA.size >= 1) || (mapB && mapB.size >= 1)) {
                hasRawDuplicateInSession = true;
                return;
            }
            const nextA = new Map();
            nextA.set(b, { partnerId: b, partnerName: nameB || '', isForceRepaired: Boolean(isForce) });
            const nextB = new Map();
            nextB.set(a, { partnerId: a, partnerName: nameA || '', isForceRepaired: Boolean(isForce) });
            sessionLinksByPid.set(a, nextA);
            sessionLinksByPid.set(b, nextB);
        };

        validUsers.forEach(u => {
            const uid = String(u.id).trim();
            const links = getHist(u)
                .filter(h => !h.activityId && isSameSession(h.session, sessionLabel))
                .sort((a, b) => Number(a.matchedAt || 0) - Number(b.matchedAt || 0));
            if (links.length > 1) {
                hasRawDuplicateInSession = true;
            }
            links.forEach(lk => {
                const pId = String(lk.partnerId || '').trim();
                if (!pId) return;
                if (!regUserMap.has(uid)) regUserMap.set(uid, u);
                if (!regUserMap.has(pId)) {
                    regUserMap.set(pId, userById.get(pId) || { id: pId, nickname: lk.partnerName || `玩家_${pId}`, gender: pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : '') });
                }
                const pUser = userById.get(pId);
                const isForceLk = Boolean(lk.isForceRepaired || String(lk.session || '').includes('・強制補齊') || String(lk.matchDetail || '').includes('強制補齊'));
                tryBindSymmetric1to1Pair(
                    uid,
                    u.nickname || `玩家_${uid}`,
                    pId,
                    (pUser && pUser.nickname) || lk.partnerName || `玩家_${pId}`,
                    isForceLk
                );
            });
        });

        let missingUserHistPairsCount = 0;
        const checkedRestorePairKeys = new Set();
        savedMatchedByPid.forEach((savedM, uid) => {
            const pId = String(savedM.partnerId || '').trim();
            if (!pId || uid === pId) return;
            if (typeof CloudSync !== 'undefined' && typeof CloudSync.isPairRecentlyUnmatched === 'function' && CloudSync.isPairRecentlyUnmatched(uid, pId)) {
                return;
            }
            const liveA = userById.get(uid);
            const liveB = userById.get(pId);
            if (!liveA && !liveB) {
                if (!regUserMap.has(uid)) regUserMap.set(uid, { id: uid, nickname: savedM.nickname || `玩家_${uid}`, gender: savedM.gender || '' });
                if (!regUserMap.has(pId)) regUserMap.set(pId, { id: pId, nickname: savedM.partnerName || `玩家_${pId}`, gender: pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : '') });
                tryBindSymmetric1to1Pair(uid, savedM.nickname || `玩家_${uid}`, pId, savedM.partnerName || `玩家_${pId}`);
                return;
            }
            // 若玩家仍在會員資料庫中，但因舊版前台快取覆蓋導致 matchedHistory 遺失，且雙方目前在本場次皆尚未綁定其他對象，自動補齊顯示並計算可還原對數
            const mapA = sessionLinksByPid.get(uid);
            const mapB = sessionLinksByPid.get(pId);
            if ((!mapA || mapA.size === 0) && (!mapB || mapB.size === 0)) {
                if (!regUserMap.has(uid)) regUserMap.set(uid, liveA || { id: uid, nickname: savedM.nickname || `玩家_${uid}`, gender: savedM.gender || '' });
                if (!regUserMap.has(pId)) regUserMap.set(pId, liveB || { id: pId, nickname: savedM.partnerName || `玩家_${pId}`, gender: pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : '') });
                tryBindSymmetric1to1Pair(
                    uid,
                    (liveA && liveA.nickname) || savedM.nickname || `玩家_${uid}`,
                    pId,
                    (liveB && liveB.nickname) || savedM.partnerName || `玩家_${pId}`
                );
                const pk = [uid, pId].sort().join('__');
                if (!checkedRestorePairKeys.has(pk)) {
                    checkedRestorePairKeys.add(pk);
                    missingUserHistPairsCount++;
                }
            }
        });

        const finalSessionRegUsers = Array.from(regUserMap.values());
        const uniqueSessionPairKeys = new Set();
        const matchedUsers = [];
        const rosterDetails = [];
        const matchedIdSet = new Set();

        finalSessionRegUsers.forEach(u => {
            const pid = String(u.id).trim();
            const liveU = userById.get(pid) || u;
            const linksMap = sessionLinksByPid.get(pid);
            const links = linksMap ? Array.from(linksMap.values()) : [];
            if (links.length > 0) {
                matchedIdSet.add(pid);
                matchedUsers.push(liveU);
                const partnerDesc = links.map(lk => {
                    const pId = String(lk.partnerId || '').trim();
                    uniqueSessionPairKeys.add([pid, pId].sort().join('__'));
                    const pUser = userById.get(pId);
                    const pName = (pUser && pUser.nickname) || lk.partnerName || `玩家_${pId}`;
                    const pGender = (pUser && pUser.gender) || (pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : ''));
                    const gBadgeHtml = pGender === '男' 
                        ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-bold text-[10px] ml-1">男</span>`
                        : (pGender === '女' ? `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold text-[10px] ml-1">女</span>` : '');
                    const forceTagHtml = lk.isForceRepaired
                        ? `<span class="text-[10px] text-amber-800 font-bold ml-1">・強制補齊</span>`
                        : '';
                    return `💘 <strong>${escapeActStatHtml(pName)}</strong>${gBadgeHtml} <span class="font-mono text-gray-500">(ID:${escapeActStatHtml(pId)})</span>${forceTagHtml}`;
                }).join('<br>');
                const roleDesc = links.map(lk => {
                    const pId = String(lk.partnerId || '').trim();
                    const pUser = userById.get(pId);
                    const pGender = (pUser && pUser.gender) || (pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : ''));
                    return `${liveU.gender || '?'} > ${pGender}`;
                }).join('<br>');
                rosterDetails.push({
                    playerId: pid,
                    nickname: liveU.nickname || `玩家_${pid}`,
                    gender: liveU.gender || '',
                    age: liveU.age || '',
                    region: liveU.region || '',
                    isMatched: true,
                    criteriaHtml: formatStatsUserCriteriaHtml(liveU, archiveByPid.get(pid)),
                    resultHtml: partnerDesc,
                    roleTypeHtml: roleDesc,
                    searchText: `${pid} ${liveU.nickname || ''} ${links.map(l => `${l.partnerId} ${l.partnerName}`).join(' ')} 配對成功`
                });
            }
        });

        const unmatchedUsers = finalSessionRegUsers.filter(u => !matchedIdSet.has(String(u.id).trim()));
        unmatchedUsers.forEach(u => {
            const pid = String(u.id).trim();
            const liveU = userById.get(pid) || u;
            const savedU = savedUnmatchedByPid.get(pid);
            const reason = diagnoseUnmatchedPlayerForStats(liveU, finalSessionRegUsers, savedU && savedU.failReason);
            rosterDetails.push({
                playerId: pid,
                nickname: liveU.nickname || `玩家_${pid}`,
                gender: liveU.gender || '',
                age: liveU.age || '',
                region: liveU.region || '',
                isMatched: false,
                criteriaHtml: formatStatsUserCriteriaHtml(liveU, archiveByPid.get(pid)),
                resultHtml: `<span class="text-amber-800 font-medium">${escapeActStatHtml(reason)}</span>`,
                roleTypeHtml: `${liveU.gender || '?'} > 未配對`,
                searchText: `${pid} ${liveU.nickname || ''} ${reason} 配對失敗 尚未配對`
            });
        });

        return {
            key: targetKey,
            label: sessionLabel,
            typeLabel: '常規單一場次',
            regUsers: finalSessionRegUsers,
            matchedUsers,
            matchedPairs: uniqueSessionPairKeys.size,
            unmatchedUsers,
            rosterDetails,
            singleSessionLabel: sessionLabel,
            hasRawDuplicateInSession,
            missingUserHistPairsCount,
            savedSnapshotAt: snap ? (snap.executedAtStr || '') : '',
            extraHtml: ''
        };
    }

    if (targetKey.startsWith('customAct:')) {
        const actId = targetKey.slice('customAct:'.length);
        const act = (customActsList || []).find(a => String(a.id) === String(actId));
        const actName = act ? act.name : actId;
        const actType = act ? (act.activityType || 'classic') : 'classic';

        const regUserMap = new Map();
        const archivedRegDetailByPid = new Map();
        validUsers.forEach(u => {
            if (u.customActivityRegs && u.customActivityRegs[actId]) {
                regUserMap.set(String(u.id).trim(), u);
            }
        });
        archivedRecords.forEach(rec => {
            if (rec.kind === 'custom' && String(rec.activityId) === String(actId)) {
                const pid = String(rec.playerId).trim();
                archivedRegDetailByPid.set(pid, rec);
                if (!regUserMap.has(pid)) {
                    const liveUser = userById.get(pid);
                    regUserMap.set(pid, liveUser || {
                        id: pid,
                        nickname: rec.nickname || `玩家_${pid}`,
                        gender: rec.gender || ''
                    });
                }
            }
        });
        const regUsers = Array.from(regUserMap.values());

        let totalLinks = 0;
        const matchedUsers = [];
        const rosterDetails = [];
        const matchedIdSet = new Set();

        regUsers.forEach(u => {
            const pid = String(u.id).trim();
            const liveU = userById.get(pid) || u;
            const links = getHist(liveU).filter(h =>
                String(h.activityId || '') === String(actId) || (actName && String(h.session || '') === String(actName))
            );
            const archRec = archivedRegDetailByPid.get(pid);
            let choiceBadgeHtml = formatStatsUserCriteriaHtml(liveU, archRec);
            if (actType === 'fortune_number') {
                const fn = (liveU.customActivityRegs && liveU.customActivityRegs[actId]?.fortuneNumber) || (archRec && archRec.fortuneNumber);
                choiceBadgeHtml = fn ? `<span class="px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-[#8f4452] font-bold">🎋 第 ${escapeActStatHtml(fn)} 首</span>` : '-';
            } else if (actType === 'two_choice') {
                const tc = (liveU.customActivityRegs && liveU.customActivityRegs[actId]?.twoChoiceValue) || (archRec && archRec.twoChoiceValue);
                choiceBadgeHtml = tc ? `<span class="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900 font-bold">⚖️ ${escapeActStatHtml(tc)}</span>` : '-';
            }

            if (links.length > 0) {
                matchedIdSet.add(pid);
                matchedUsers.push(liveU);
                totalLinks += links.length;
                const partnerDesc = links.map(lk => {
                    const pId = String(lk.partnerId || '').trim();
                    const pUser = userById.get(pId);
                    const pName = (pUser && pUser.nickname) || lk.partnerName || `玩家_${pId}`;
                    const pGender = (pUser && pUser.gender) || (pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : ''));
                    const gBadgeHtml = pGender === '男' 
                        ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-bold text-[10px] ml-1">男</span>`
                        : (pGender === '女' ? `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold text-[10px] ml-1">女</span>` : '');
                    return `💘 <strong>${escapeActStatHtml(pName)}</strong>${gBadgeHtml} <span class="font-mono text-gray-500">(ID:${escapeActStatHtml(pId)})</span>`;
                }).join('<br>');
                const roleDesc = links.map(lk => {
                    const pId = String(lk.partnerId || '').trim();
                    const pUser = userById.get(pId);
                    const pGender = (pUser && pUser.gender) || (pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : ''));
                    return `${liveU.gender || '?'} > ${pGender}`;
                }).join('<br>');
                rosterDetails.push({
                    playerId: pid,
                    nickname: liveU.nickname || `玩家_${pid}`,
                    gender: liveU.gender || '',
                    age: liveU.age || '',
                    region: liveU.region || '',
                    isMatched: true,
                    criteriaHtml: choiceBadgeHtml,
                    resultHtml: partnerDesc,
                    roleTypeHtml: roleDesc,
                    searchText: `${pid} ${liveU.nickname || ''} ${links.map(l => `${l.partnerId} ${l.partnerName}`).join(' ')} 配對成功`
                });
            }
        });

        const unmatchedUsers = regUsers.filter(u => !matchedIdSet.has(String(u.id).trim()));
        unmatchedUsers.forEach(u => {
            const pid = String(u.id).trim();
            const liveU = userById.get(pid) || u;
            const archRec = archivedRegDetailByPid.get(pid);
            let choiceBadgeHtml = formatStatsUserCriteriaHtml(liveU, archRec);
            let reasonText = '🔍 報名後尚未成功配對（同條件／異性名額不足或尚未開獎）';
            if (actType === 'fortune_number') {
                const fn = (liveU.customActivityRegs && liveU.customActivityRegs[actId]?.fortuneNumber) || (archRec && archRec.fortuneNumber);
                choiceBadgeHtml = fn ? `<span class="px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-[#8f4452] font-bold">🎋 第 ${escapeActStatHtml(fn)} 首</span>` : '-';
                reasonText = fn ? `🎋 選擇「第 ${fn} 首」的異性人數不足或已配對完畢` : '尚未選擇籤詩號碼';
            } else if (actType === 'two_choice') {
                const tc = (liveU.customActivityRegs && liveU.customActivityRegs[actId]?.twoChoiceValue) || (archRec && archRec.twoChoiceValue);
                choiceBadgeHtml = tc ? `<span class="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900 font-bold">⚖️ ${escapeActStatHtml(tc)}</span>` : '-';
                reasonText = tc ? `⚖️ 選擇「${tc}」的異性人數不足或已配對完畢` : '尚未完成二選一';
            }
            rosterDetails.push({
                playerId: pid,
                nickname: liveU.nickname || `玩家_${pid}`,
                gender: liveU.gender || '',
                age: liveU.age || '',
                region: liveU.region || '',
                isMatched: false,
                criteriaHtml: choiceBadgeHtml,
                resultHtml: `<span class="text-amber-800 font-medium">${escapeActStatHtml(reasonText)}</span>`,
                roleTypeHtml: `${liveU.gender || '?'} > 未配對`,
                searchText: `${pid} ${liveU.nickname || ''} ${reasonText} 配對失敗 尚未配對`
            });
        });

        let extraHtml = '';
        if (actType === 'fortune_number' && regUsers.length > 0) {
            const numCounts = {};
            regUsers.forEach(u => {
                const pid = String(u.id).trim();
                const n = (u.customActivityRegs && u.customActivityRegs[actId]?.fortuneNumber) ||
                          (archivedRegDetailByPid.get(pid)?.fortuneNumber);
                if (n) numCounts[n] = (numCounts[n] || 0) + 1;
            });
            const chips = Object.keys(numCounts).sort((a, b) => Number(a) - Number(b))
                .map(n => `<span class="px-2 py-0.5 rounded-full bg-white border border-amber-300 font-mono font-bold">第${n}首：${numCounts[n]}人</span>`)
                .join(' ');
            if (chips) extraHtml = `<span class="font-bold">🎋 籤詩號碼分布：</span>${chips}`;
        } else if (actType === 'two_choice' && regUsers.length > 0) {
            const choiceCounts = {};
            regUsers.forEach(u => {
                const pid = String(u.id).trim();
                const c = (u.customActivityRegs && u.customActivityRegs[actId]?.twoChoiceValue) ||
                          (archivedRegDetailByPid.get(pid)?.twoChoiceValue);
                if (c) choiceCounts[c] = (choiceCounts[c] || 0) + 1;
            });
            const chips = Object.entries(choiceCounts)
                .map(([c, cnt]) => `<span class="px-2 py-0.5 rounded-full bg-white border border-amber-300 font-bold">「${c}」：${cnt}人</span>`)
                .join(' ');
            if (chips) extraHtml = `<span class="font-bold">⚖️ 二選一分布：</span>${chips}`;
        }

        const typeLabel = actType === 'fortune_number'
            ? '自定義（月老籤詩1~5）'
            : (actType === 'two_choice' ? `自定義（二選一：${act?.twoChoiceText || ''}）` : '自定義（條件配對）');

        return {
            key: targetKey,
            label: `🎪 ${actName}`,
            typeLabel,
            regUsers,
            matchedUsers,
            matchedPairs: Math.floor(totalLinks / 2),
            unmatchedUsers,
            rosterDetails,
            singleSessionLabel: '',
            savedSnapshotAt: '',
            extraHtml
        };
    }

    return null;
}

function renderSelectedActivityRosterDetails(activeStats) {
    const detailSec = document.getElementById('selActMatchDetailSection');
    if (!detailSec) return;

    if (!activeStats) {
        detailSec.classList.add('hidden');
        detailSec.innerHTML = '';
        return;
    }

    if (lastActDetailTargetKey !== activeStats.key) {
        lastActDetailTargetKey = activeStats.key;
        currentActDetailRosterPage = 1;
    }

    const allItems = Array.isArray(activeStats.rosterDetails) ? activeStats.rosterDetails : [];
    const matchedItems = allItems.filter(it => it.isMatched);
    const unmatchedItems = allItems.filter(it => !it.isMatched);

    const kw = actDetailRosterSearchKeyword.toLowerCase();
    const filteredItems = allItems.filter(it => {
        if (actDetailRosterStatusFilter === 'MATCHED' && !it.isMatched) return false;
        if (actDetailRosterStatusFilter === 'UNMATCHED' && it.isMatched) return false;
        if (actDetailRosterGenderFilter !== 'ALL' && it.gender !== actDetailRosterGenderFilter) return false;
        if (kw && !String(it.searchText || '').toLowerCase().includes(kw)) return false;
        return true;
    });

    const totalFiltered = filteredItems.length;
    const isShowAll = actDetailRosterPageSize === 'all';
    const perPage = isShowAll ? Math.max(1, totalFiltered) : (parseInt(actDetailRosterPageSize, 10) || 10);
    const totalPages = isShowAll ? 1 : Math.max(1, Math.ceil(totalFiltered / perPage));
    if (currentActDetailRosterPage > totalPages) currentActDetailRosterPage = totalPages;
    if (currentActDetailRosterPage < 1) currentActDetailRosterPage = 1;
    const startIdx = isShowAll ? 0 : (currentActDetailRosterPage - 1) * perPage;
    const pagedItems = isShowAll ? filteredItems : filteredItems.slice(startIdx, startIdx + perPage);

    const statusBtn = (code, label, activeCls) => {
        const isAct = actDetailRosterStatusFilter === code;
        return `<button type="button" onclick="setActDetailRosterStatusFilter('${code}')" class="px-3 py-1.5 rounded-xl text-xs font-bold transition ${isAct ? activeCls : 'bg-white border border-pink-200 text-gray-600 hover:bg-pink-50'}">${label}</button>`;
    };

    const genderBtn = (code, label) => {
        const isAct = actDetailRosterGenderFilter === code;
        return `<button type="button" onclick="setActDetailRosterGenderFilter('${code}')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${isAct ? 'bg-[#8f4452] text-white' : 'bg-white border border-pink-200 text-gray-600 hover:bg-pink-50'}">${label}</button>`;
    };

    const hasDuplicateSameSessionMatch = Boolean(activeStats.singleSessionLabel) && (Boolean(activeStats.hasRawDuplicateInSession) || matchedItems.some(it => String(it.resultHtml || '').includes('<br>')));
    const repairDupBtnHtml = hasDuplicateSameSessionMatch
        ? `<button type="button" onclick="repairDuplicateSameSessionMatches('${escapeActStatHtml(activeStats.singleSessionLabel)}')" class="px-3.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold shadow-sm hover:bg-rose-700 transition">🧹 修正1對1</button>`
        : '';
    const restoreLostPairsBtnHtml = (activeStats.singleSessionLabel && Number(activeStats.missingUserHistPairsCount || 0) > 0)
        ? `<button type="button" onclick="restoreSessionMatchesFromSnapshot('${escapeActStatHtml(activeStats.singleSessionLabel)}')" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm hover:bg-emerald-700 transition">🔄 還原遺失配對（${activeStats.missingUserHistPairsCount}對）</button>`
        : '';

    let suppMatchBtnHtml = `${restoreLostPairsBtnHtml}${repairDupBtnHtml}`;
    if (activeStats.singleSessionLabel && unmatchedItems.length > 0) {
        suppMatchBtnHtml += `<button type="button" onclick="runSupplementaryMatchForSession('${escapeActStatHtml(activeStats.singleSessionLabel)}')" class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#e79aa8] to-[#c96a7b] text-white text-xs font-bold shadow-sm hover:opacity-95 transition">💘 補跑名單(未配對)</button>`;
    } else if (Array.isArray(activeStats.batchSessions) && activeStats.batchSessions.length >= 2 && unmatchedItems.length > 0) {
        const batchArgsStr = activeStats.batchSessions.map(lbl => `'${escapeActStatHtml(lbl)}'`).join(', ');
        const perSessionBtnsHtml = activeStats.batchSessions.map(sLbl =>
            `<button type="button" onclick="runSupplementaryMatchForSession('${escapeActStatHtml(sLbl)}')" class="px-3 py-1.5 rounded-xl bg-white border border-pink-300 text-[#8f4452] text-xs font-bold hover:bg-pink-50 transition">💘 補跑 ${escapeActStatHtml(sLbl)}</button>`
        ).join('\n            ');
        suppMatchBtnHtml += `
            ${perSessionBtnsHtml}
            <button type="button" onclick="runSupplementaryMatchForBatch(${batchArgsStr})" class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#e79aa8] to-[#c96a7b] text-white text-xs font-bold shadow-sm hover:opacity-95 transition">💘 補跑名單(未配對)</button>
        `;
    }

    const rowsHtml = pagedItems.length === 0
        ? `<tr><td colspan="5" class="p-6 text-center text-gray-400">目前篩選條件下沒有符合的報名／配對紀錄。</td></tr>`
        : pagedItems.map(it => {
            const statusBadge = it.isMatched
                ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-[11px] font-bold">💘 配對成功</span>`
                : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-800 text-[11px] font-bold">🍃 配對失敗</span>`;
            const gBadge = it.gender === '男'
                ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-bold text-[11px]">男</span>`
                : (it.gender === '女' ? `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold text-[11px]">女</span>` : '');
            const metaText = [it.age ? `${it.age}歲` : '', it.region || ''].filter(Boolean).join('・');
            return `
                <tr class="${it.isMatched ? 'bg-emerald-50/15 hover:bg-emerald-50/35' : 'hover:bg-amber-50/35'} transition">
                    <td class="p-3 text-xs whitespace-nowrap">${statusBadge}</td>
                    <td class="p-3 text-xs whitespace-nowrap">
                        <span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-mono font-bold mr-1">${escapeActStatHtml(it.playerId)}</span>
                        <span class="font-bold text-gray-800">${escapeActStatHtml(it.nickname)}</span>
                        ${gBadge}
                        ${metaText ? `<span class="text-[11px] text-gray-400 ml-1">(${escapeActStatHtml(metaText)})</span>` : ''}
                    </td>
                    <td class="p-3 text-[11px] leading-relaxed">${it.criteriaHtml}</td>
                    <td class="p-3 text-xs leading-relaxed">${it.resultHtml}</td>
                    <td class="p-3 text-xs font-bold text-gray-500 whitespace-nowrap">${it.roleTypeHtml || ''}</td>
                </tr>
            `;
        }).join('');

    const showFrom = totalFiltered === 0 ? 0 : startIdx + 1;
    const showTo = Math.min(startIdx + perPage, totalFiltered);
    const pageBtns = [];
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - currentActDetailRosterPage) <= 1) {
            const isCur = p === currentActDetailRosterPage;
            pageBtns.push(`<button type="button" onclick="goToActDetailRosterPage(${p})" class="min-w-[28px] h-7 px-2 rounded-lg font-bold transition ${isCur ? 'bg-[#c96a7b] text-white shadow-2xs' : 'bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50'}">${p}</button>`);
        } else if (pageBtns[pageBtns.length - 1] !== '<span class="px-1 text-gray-400">...</span>') {
            pageBtns.push('<span class="px-1 text-gray-400">...</span>');
        }
    }

    detailSec.classList.remove('hidden');
    detailSec.innerHTML = `
        <div class="rounded-2xl border border-pink-200 bg-pink-50/25 p-4 space-y-3">
            <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-sm font-bold text-[#8f4452]">📋 配對成功與失敗（尚未配對）人員名單紀錄</h3>
                        ${activeStats.savedSnapshotAt ? `<span class="text-[11px] px-2 py-0.5 rounded-full bg-white border border-pink-200 text-gray-500">結算紀錄時間：${escapeActStatHtml(activeStats.savedSnapshotAt)}</span>` : ''}
                    </div>
                    <p class="text-[11px] text-gray-500 mt-0.5">完整紀錄本場次／該屆所有報名者的配對結果，以及每位未配對玩家的具體原因診斷</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    ${suppMatchBtnHtml}
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-1.5">
                    ${statusBtn('ALL', `全部報名 (${allItems.length}人)`, 'bg-[#8f4452] text-white shadow-2xs')}
                    ${statusBtn('MATCHED', `💘 配對成功 (${matchedItems.length}人)`, 'bg-emerald-600 text-white shadow-2xs')}
                    ${statusBtn('UNMATCHED', `🍃 配對失敗 (${unmatchedItems.length}人)`, 'bg-amber-600 text-white shadow-2xs')}
                </div>
                <div class="flex flex-wrap items-center gap-2 text-xs">
                    <div class="inline-flex items-center gap-1 bg-white px-2 py-1 rounded-xl border border-pink-200">
                        <span class="text-[11px] text-gray-500 font-bold">性別：</span>
                        ${genderBtn('ALL', '全部')}
                        ${genderBtn('男', '男')}
                        ${genderBtn('女', '女')}
                    </div>
                    <input type="text" value="${escapeActStatHtml(actDetailRosterSearchKeyword)}" oninput="onActDetailRosterSearchInput(this.value)" placeholder="搜尋 ID、暱稱或未配對原因..." class="h-8 w-44 sm:w-52 px-2.5 admin-input-box text-xs text-[#8f4452]">
                    <select onchange="onActDetailRosterPageSizeChange(this.value)" class="h-8 px-2 admin-input-box text-xs font-bold text-[#8f4452]">
                        <option value="5" ${actDetailRosterPageSize === '5' ? 'selected' : ''}>5 筆</option>
                        <option value="10" ${actDetailRosterPageSize === '10' ? 'selected' : ''}>10 筆</option>
                        <option value="30" ${actDetailRosterPageSize === '30' ? 'selected' : ''}>30 筆</option>
                        <option value="all" ${actDetailRosterPageSize === 'all' ? 'selected' : ''}>全部</option>
                    </select>
                </div>
            </div>

            <div class="overflow-x-auto bg-white rounded-xl border border-pink-200 p-2">
                <table class="admin-grid-table text-left text-xs">
                    <thead>
                        <tr class="text-xs">
                            <th class="p-3 w-28">配對結果</th>
                            <th class="p-3 w-48">報名玩家</th>
                            <th class="p-3 w-64">報名條件設定</th>
                            <th class="p-3">配對對象 / 未配對原因明細</th>
                            <th class="p-3 w-32">角色型別</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>

            <div class="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-600 pt-1">
                <div>顯示第 <strong class="text-[#8f4452]">${showFrom}～${showTo}</strong> 筆，共 <strong class="text-[#8f4452]">${totalFiltered}</strong> 筆（第 <strong>${currentActDetailRosterPage}</strong> / ${totalPages} 頁）</div>
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="goToActDetailRosterPage(${currentActDetailRosterPage - 1})" ${currentActDetailRosterPage <= 1 ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">◀ 上一頁</button>
                    ${pageBtns.join('')}
                    <button type="button" onclick="goToActDetailRosterPage(${currentActDetailRosterPage + 1})" ${currentActDetailRosterPage >= totalPages ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">下一頁 ▶</button>
                </div>
            </div>
        </div>
    `;
}

function renderActivityMatchStatsPanel(users, customActsList, currentBatch, maxDisplayBatch) {
    const sel = document.getElementById('activityStatsTargetSelect');
    if (!sel) return;

    const prevVal = sel.value || '';
    const opts = [
        { value: '', label: '請選擇' }
    ];

    for (let b = 1; b <= maxDisplayBatch; b++) {
        const info = getBatchScheduleInfo(b);
        const curTag = b === currentBatch ? '【目前】' : '';
        if (b <= 2) {
            opts.push({
                value: `batch:${b}`,
                label: `${curTag}${info.batchPrefix} 全部場次（${info.wedDateStr}(三) + ${info.satDateStr}(六)）`
            });
            opts.push({
                value: `session:${info.wedLabel}`,
                label: `　└ 單場：${info.wedLabel}`
            });
            opts.push({
                value: `session:${info.satLabel}`,
                label: `　└ 單場：${info.satLabel}`
            });
        } else {
            opts.push({
                value: `batch:${b}`,
                label: `${curTag}${info.batchPrefix} 全部場次（${info.tueDateStr}(二) + ${info.thuDateStr}(四) + ${info.satDateStr}(六)）`
            });
            opts.push({
                value: `session:${info.tueLabel}`,
                label: `　└ 單場：${info.tueLabel}`
            });
            opts.push({
                value: `session:${info.thuLabel}`,
                label: `　└ 單場：${info.thuLabel}`
            });
            opts.push({
                value: `session:${info.satLabel}`,
                label: `　└ 單場：${info.satLabel}`
            });
        }
    }

    (customActsList || []).forEach(act => {
        const statusIcon = act.isOpen ? '🟢' : '⚪';
        opts.push({
            value: `customAct:${act.id}`,
            label: `${statusIcon} 自定義活動：【${act.name}】`
        });
    });

    sel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    if (opts.some(o => o.value === prevVal)) {
        sel.value = prevVal;
    } else {
        sel.value = '';
    }

    const activeStats = sel.value ? computeSingleActivityStats(sel.value, users, customActsList) : null;
    if (activeStats) {
        const regTotal = activeStats.regUsers.length;
        const regMale = activeStats.regUsers.filter(u => u.gender === '男').length;
        const regFemale = activeStats.regUsers.filter(u => u.gender === '女').length;

        const isSingleSessionMode = String(activeStats.key || '').startsWith('session:');
        const matchedPeople = activeStats.matchedUsers.length;
        const matchedPairs = activeStats.matchedPairs;
        const unmatchedTotal = activeStats.unmatchedUsers.length;
        const ratePct = regTotal > 0 ? Math.min(100, Math.round((matchedPeople / regTotal) * 1000) / 10) : 0;

        document.getElementById('selActStatRegCount').textContent = `${regTotal} 人`;
        document.getElementById('selActStatRegGender').textContent = isSingleSessionMode
            ? `男 ${regMale} 人 ／ 女 ${regFemale} 人（僅統計 ${activeStats.label}）`
            : `男 ${regMale} 人 ／ 女 ${regFemale} 人`;
        document.getElementById('selActStatMatchedPeople').textContent = `${matchedPeople} 人`;
        document.getElementById('selActStatMatchedPairs').textContent = isSingleSessionMode
            ? `共 ${matchedPairs} 對配對成功（僅統計 ${activeStats.label}）`
            : `共 ${matchedPairs} 對配對成功`;
        document.getElementById('selActStatUnmatchedCount').textContent = `${unmatchedTotal} 人`;
        document.getElementById('selActStatMatchRate').textContent = `${ratePct}%`;
        document.getElementById('selActStatRateBar').style.width = `${ratePct}%`;

        const extraBox = document.getElementById('selActStatExtraBreakdown');
        if (extraBox) {
            if (activeStats.extraHtml) {
                extraBox.innerHTML = activeStats.extraHtml;
                extraBox.classList.remove('hidden');
            } else {
                extraBox.classList.add('hidden');
                extraBox.innerHTML = '';
            }
        }
        renderSelectedActivityRosterDetails(activeStats);
    } else {
        document.getElementById('selActStatRegCount').textContent = '0 人';
        document.getElementById('selActStatRegGender').textContent = '請先選擇統計對象';
        document.getElementById('selActStatMatchedPeople').textContent = '0 人';
        document.getElementById('selActStatMatchedPairs').textContent = '共 0 對配對成功';
        document.getElementById('selActStatUnmatchedCount').textContent = '0 人';
        document.getElementById('selActStatMatchRate').textContent = '0%';
        document.getElementById('selActStatRateBar').style.width = '0%';

        const extraBox = document.getElementById('selActStatExtraBreakdown');
        if (extraBox) {
            extraBox.classList.add('hidden');
            extraBox.innerHTML = '';
        }
        renderSelectedActivityRosterDetails(null);
    }

    if (showAllActivitiesStatsTable) {
        const tbody = document.getElementById('allActivitiesStatsTableBody');
        if (tbody) {
            const summaryKeys = [];
            for (let b = 1; b <= maxDisplayBatch; b++) {
                summaryKeys.push(`batch:${b}`);
            }
            (customActsList || []).forEach(act => {
                summaryKeys.push(`customAct:${act.id}`);
            });

            tbody.innerHTML = summaryKeys.map(k => {
                const st = computeSingleActivityStats(k, users, customActsList);
                if (!st) return '';
                const rTot = st.regUsers.length;
                const rM = st.regUsers.filter(u => u.gender === '男').length;
                const rF = st.regUsers.filter(u => u.gender === '女').length;
                const mPpl = st.matchedUsers.length;
                const mPeopleText = `${mPpl} 人`;
                const uTot = st.unmatchedUsers.length;
                const pct = rTot > 0 ? Math.min(100, Math.round((mPpl / rTot) * 1000) / 10) : 0;
                const isSelected = sel.value === k;
                return `
                    <tr onclick="selectActivityStatsTarget('${k}')" class="cursor-pointer transition ${isSelected ? 'bg-pink-50/90 font-semibold' : 'hover:bg-pink-50/40'}">
                        <td class="p-3 font-bold text-[#8f4452]">${st.label}</td>
                        <td class="p-3 text-gray-500">${st.typeLabel}</td>
                        <td class="p-3"><strong class="text-[#c96a7b]">${rTot} 人</strong> <span class="text-gray-400">（男 ${rM} / 女 ${rF}）</span></td>
                        <td class="p-3"><strong class="text-emerald-600">${mPeopleText}</strong> <span class="text-gray-500">（${st.matchedPairs} 對）</span></td>
                        <td class="p-3 text-amber-700 font-semibold">${uTot} 人</td>
                        <td class="p-3 font-mono font-bold text-[#8f4452]">${pct}%</td>
                    </tr>
                `;
            }).join('');
        }
    }
}
