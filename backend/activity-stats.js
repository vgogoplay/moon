/* backend/activity-stats.js - 後台某屆／單場／自定義活動報名與成功配對人數統計 */

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

function computeSingleActivityStats(targetKey, users, customActsList) {
    const validUsers = (users || []).filter(u => u && u.id);
    const getHist = (u) => {
        if (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0) return u.matchedHistory;
        if (u.matchedWithId) return [{ session: u.matchedSession || '', partnerId: u.matchedWithId, partnerName: u.matchedWithName || '' }];
        return [];
    };

    if (targetKey.startsWith('batch:')) {
        const bNum = targetKey.split(':')[1];
        const targetPrefix = `第${bNum}屆`;
        const info = getBatchScheduleInfo(bNum);
        const regUsers = validUsers.filter(u => {
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
            return sessions.some(s => extractBatchLabel(s) === targetPrefix);
        });
        let totalLinks = 0;
        const matchedUsers = [];
        validUsers.forEach(u => {
            const links = getHist(u).filter(h => !h.activityId && extractBatchLabel(h.session) === targetPrefix);
            if (links.length > 0) {
                matchedUsers.push(u);
                totalLinks += links.length;
            }
        });
        const matchedIdSet = new Set(matchedUsers.map(u => String(u.id)));
        const unmatchedUsers = regUsers.filter(u => !matchedIdSet.has(String(u.id)));
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
        const regUsers = validUsers.filter(u => {
            const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
            return sessions.some(s => isSameSession(s, sessionLabel));
        });
        let totalLinks = 0;
        const matchedUsers = [];
        validUsers.forEach(u => {
            const links = getHist(u).filter(h => !h.activityId && isSameSession(h.session, sessionLabel));
            if (links.length > 0) {
                matchedUsers.push(u);
                totalLinks += links.length;
            }
        });
        const matchedIdSet = new Set(matchedUsers.map(u => String(u.id)));
        const unmatchedUsers = regUsers.filter(u => !matchedIdSet.has(String(u.id)));
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
        const regUsers = validUsers.filter(u => Boolean(u.customActivityRegs && u.customActivityRegs[actId]));
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
        const matchedIdSet = new Set(matchedUsers.map(u => String(u.id)));
        const unmatchedUsers = regUsers.filter(u => !matchedIdSet.has(String(u.id)));

        let extraHtml = '';
        if (actType === 'fortune_number' && regUsers.length > 0) {
            const numCounts = {};
            regUsers.forEach(u => {
                const n = u.customActivityRegs[actId]?.fortuneNumber;
                if (n) numCounts[n] = (numCounts[n] || 0) + 1;
            });
            const chips = Object.keys(numCounts).sort((a, b) => Number(a) - Number(b))
                .map(n => `<span class="px-2 py-0.5 rounded-full bg-white border border-amber-300 font-mono font-bold">第${n}首：${numCounts[n]}人</span>`)
                .join(' ');
            if (chips) extraHtml = `<span class="font-bold">🎋 籤詩號碼分布：</span>${chips}`;
        } else if (actType === 'two_choice' && regUsers.length > 0) {
            const choiceCounts = {};
            regUsers.forEach(u => {
                const c = u.customActivityRegs[actId]?.twoChoiceValue;
                if (c) choiceCounts[c] = (choiceCounts[c] || 0) + 1;
            });
            const chips = Object.entries(choiceCounts)
                .map(([c, cnt]) => `<span class="px-2 py-0.5 rounded-full bg-white border border-amber-300 font-bold">「${c}」：${cnt}人</span>`)
                .join(' ');
            if (chips) extraHtml = `<span class="font-bold">⚖️ 二選一分布：</span>${chips}`;
        }

        const typeLabel = actType === 'fortune_number'
            ? '自定義（月老籤詩1~10）'
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

    const defaultKey = `batch:${currentBatch}`;
    const prevVal = sel.value || defaultKey;
    const opts = [];

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
    } else if (opts.some(o => o.value === defaultKey)) {
        sel.value = defaultKey;
    }

    const activeStats = computeSingleActivityStats(sel.value, users, customActsList);
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
