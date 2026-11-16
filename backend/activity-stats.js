/* backend/activity-stats.js - 後台某屆／單場／自定義活動報名與成功配對人數統計（永久保留歷史報名人數紀錄） */

let showAllActivitiesStatsTable = false;

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
        renderAdminAll();
    }
}

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

function computeSingleActivityStats(targetKey, users, customActsList) {
    const validUsers = (users || []).filter(u => u && u.id);
    const userById = new Map();
    validUsers.forEach(u => userById.set(String(u.id).trim(), u));
    const archivedRecords = getMergedActivityRegHistoryList();

    const getHist = (u) => {
        if (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0) return u.matchedHistory;
        if (u.matchedWithId) return [{ session: u.matchedSession || '', partnerId: u.matchedWithId, partnerName: u.matchedWithName || '' }];
        return [];
    };

    if (targetKey.startsWith('batch:')) {
        const bNum = targetKey.split(':')[1];
        const targetPrefix = `第${bNum}屆`;
        const info = getBatchScheduleInfo(bNum);

        // 合併「目前仍在報名場次中」與「活動結束後已封存保留」的報名名單（依玩家 ID 去重）
        const regUserMap = new Map();
        validUsers.forEach(u => {
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
            if (sessions.some(s => extractBatchLabel(s) === targetPrefix)) {
                regUserMap.set(String(u.id).trim(), u);
            }
        });
        archivedRecords.forEach(rec => {
            if (rec.kind === 'regular' && rec.session && extractBatchLabel(rec.session) === targetPrefix) {
                const pid = String(rec.playerId).trim();
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
        validUsers.forEach(u => {
            const links = getHist(u).filter(h => !h.activityId && extractBatchLabel(h.session) === targetPrefix);
            if (links.length > 0) {
                matchedUsers.push(u);
                totalLinks += links.length;
            }
        });
        const matchedIdSet = new Set(matchedUsers.map(u => String(u.id).trim()));
        const unmatchedUsers = regUsers.filter(u => !matchedIdSet.has(String(u.id).trim()));
        return {
            key: targetKey,
            label: `${info.batchPrefix}（${info.wedDateStr}(三) + ${info.satDateStr}(六)）`,
            typeLabel: '常規屆數（整屆）',
            regUsers,
            matchedUsers,
            matchedPairs: Math.floor(totalLinks / 2),
            unmatchedUsers,
            extraHtml: ''
        };
    }

    if (targetKey.startsWith('session:')) {
        const sessionLabel = targetKey.slice('session:'.length);

        const regUserMap = new Map();
        validUsers.forEach(u => {
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
            if (sessions.some(s => isSameSession(s, sessionLabel))) {
                regUserMap.set(String(u.id).trim(), u);
            }
        });
        archivedRecords.forEach(rec => {
            if (rec.kind === 'regular' && rec.session && isSameSession(rec.session, sessionLabel)) {
                const pid = String(rec.playerId).trim();
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
        validUsers.forEach(u => {
            const links = getHist(u).filter(h => !h.activityId && isSameSession(h.session, sessionLabel));
            if (links.length > 0) {
                matchedUsers.push(u);
                totalLinks += links.length;
            }
        });
        const matchedIdSet = new Set(matchedUsers.map(u => String(u.id).trim()));
        const unmatchedUsers = regUsers.filter(u => !matchedIdSet.has(String(u.id).trim()));
        return {
            key: targetKey,
            label: sessionLabel,
            typeLabel: '常規單一場次',
            regUsers,
            matchedUsers,
            matchedPairs: Math.floor(totalLinks / 2),
            unmatchedUsers,
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
        validUsers.forEach(u => {
            const links = getHist(u).filter(h =>
                String(h.activityId || '') === String(actId) || (actName && String(h.session || '') === String(actName))
            );
            if (links.length > 0) {
                matchedUsers.push(u);
                totalLinks += links.length;
            }
        });
        const matchedIdSet = new Set(matchedUsers.map(u => String(u.id).trim()));
        const unmatchedUsers = regUsers.filter(u => !matchedIdSet.has(String(u.id).trim()));

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
            extraHtml
        };
    }

    return null;
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

        const matchedPeople = activeStats.matchedUsers.length;
        const matchedPairs = activeStats.matchedPairs;
        const unmatchedTotal = activeStats.unmatchedUsers.length;
        const ratePct = regTotal > 0 ? Math.min(100, Math.round((matchedPeople / regTotal) * 1000) / 10) : 0;

        document.getElementById('selActStatRegCount').textContent = `${regTotal} 人`;
        document.getElementById('selActStatRegGender').textContent = `男 ${regMale} 人 ／ 女 ${regFemale} 人`;
        document.getElementById('selActStatMatchedPeople').textContent = `${matchedPeople} 人`;
        document.getElementById('selActStatMatchedPairs').textContent = `共 ${matchedPairs} 對配對成功`;
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
                const uTot = st.unmatchedUsers.length;
                const pct = rTot > 0 ? Math.min(100, Math.round((mPpl / rTot) * 1000) / 10) : 0;
                const isSelected = sel.value === k;
                return `
                    <tr onclick="selectActivityStatsTarget('${k}')" class="cursor-pointer transition ${isSelected ? 'bg-pink-50/90 font-semibold' : 'hover:bg-pink-50/40'}">
                        <td class="p-3 font-bold text-[#8f4452]">${st.label}</td>
                        <td class="p-3 text-gray-500">${st.typeLabel}</td>
                        <td class="p-3"><strong class="text-[#c96a7b]">${rTot} 人</strong> <span class="text-gray-400">（男 ${rM} / 女 ${rF}）</span></td>
                        <td class="p-3"><strong class="text-emerald-600">${mPpl} 人</strong> <span class="text-gray-500">（${st.matchedPairs} 對）</span></td>
                        <td class="p-3 text-amber-700 font-semibold">${uTot} 人</td>
                        <td class="p-3 font-mono font-bold text-[#8f4452]">${pct}%</td>
                    </tr>
                `;
            }).join('');
        }
    }
}
