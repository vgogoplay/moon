/* backend/logs.js - 後台玩家操作日誌（近 30 筆＋搜尋＋預設 0 筆）、紅線祈願牆紀錄、配對成功日誌（近 30 筆＋預設 0 筆）與後台防護日誌（預設 0 筆） */

let playerOpLogSearchKeyword = '';
let playerOpLogPageSize = '0';
let currentPlayerOpLogPage = 1;
let playerOpLogSearchTimer = null;

let matchLogsPageSize = '0';
let currentMatchLogsPage = 1;

let loginLogsPageSize = '0';
let currentLoginLogsPage = 1;

let lastLogsRenderSig = '';

function onPlayerOpLogSearchInput(val) {
    playerOpLogSearchKeyword = String(val || '').trim();
    currentPlayerOpLogPage = 1;
    const clearBtn = document.getElementById('clearPlayerOpLogSearchBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', playerOpLogSearchKeyword === '');
    }
    if (playerOpLogSearchTimer) clearTimeout(playerOpLogSearchTimer);
    playerOpLogSearchTimer = setTimeout(() => {
        playerOpLogSearchTimer = null;
        renderLogsPageSection(true);
    }, 160);
}

function clearPlayerOpLogSearch() {
    playerOpLogSearchKeyword = '';
    currentPlayerOpLogPage = 1;
    const inputEl = document.getElementById('playerOpLogSearchInput');
    if (inputEl) inputEl.value = '';
    const clearBtn = document.getElementById('clearPlayerOpLogSearchBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderLogsPageSection(true);
}

function onPlayerOpLogPageSizeChange(newSize) {
    const val = ['0', '5', '10', '30'].includes(String(newSize)) ? String(newSize) : '0';
    playerOpLogPageSize = val;
    currentPlayerOpLogPage = 1;
    renderLogsPageSection(true);
}

function goToPlayerOpLogPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    currentPlayerOpLogPage = p;
    renderLogsPageSection(true);
}

function onMatchLogsPageSizeChange(newSize) {
    const val = ['0', '5', '10', '30'].includes(String(newSize)) ? String(newSize) : '0';
    matchLogsPageSize = val;
    currentMatchLogsPage = 1;
    renderLogsPageSection(true);
}

function goToMatchLogsPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    currentMatchLogsPage = p;
    renderLogsPageSection(true);
}

function onLoginLogsPageSizeChange(newSize) {
    const val = ['0', '5', '10'].includes(String(newSize)) ? String(newSize) : '0';
    loginLogsPageSize = val;
    currentLoginLogsPage = 1;
    renderLogsPageSection(true);
}

function goToLoginLogsPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    currentLoginLogsPage = p;
    renderLogsPageSection(true);
}

function getPlayerOpLogs() {
    const key = (typeof PLAYER_OP_LOGS_KEY !== 'undefined') ? PLAYER_OP_LOGS_KEY : 'yuelao_player_op_logs';
    const maxCount = (typeof PLAYER_OP_LOGS_MAX_COUNT !== 'undefined') ? PLAYER_OP_LOGS_MAX_COUNT : 30;
    const raw = localStorage.getItem(key) || '[]';

    if (typeof AdminMemoryCache !== 'undefined' && raw === AdminMemoryCache.playerOpLogsRaw && Array.isArray(AdminMemoryCache.playerOpLogs)) {
        return AdminMemoryCache.playerOpLogs;
    }

    let list = [];
    try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            list = arr.filter(item => item && typeof item === 'object');
        }
    } catch (e) {}

    list.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    const res = list.slice(0, maxCount);
    if (typeof AdminMemoryCache !== 'undefined') {
        AdminMemoryCache.playerOpLogsRaw = raw;
        AdminMemoryCache.playerOpLogs = res;
    }
    return res;
}

function clearAdminPlayerOpLogs() {
    if (!confirm('確定要清空所有的玩家操作日誌嗎？此動作無法復原。')) return;
    const key = (typeof PLAYER_OP_LOGS_KEY !== 'undefined') ? PLAYER_OP_LOGS_KEY : 'yuelao_player_op_logs';
    localStorage.removeItem(key);
    if (typeof AdminMemoryCache !== 'undefined') {
        AdminMemoryCache.invalidate('playerOpLogs');
    }
    if (typeof CloudSync !== 'undefined') {
        if (CloudSync.tree && typeof CloudSync.tree === 'object') {
            delete CloudSync.tree[key];
        }
        CloudSync.deleteNode(key);
    }
    // 同步清理舊表殘留的 [解除配對] 項目，避免清空後又從相容層復活
    try {
        const legacyArr = JSON.parse(localStorage.getItem('yuelao_admin_login_logs') || '[]');
        if (Array.isArray(legacyArr)) {
            const removedLegacy = legacyArr.filter(lg => lg && String(lg.accountTried || '').includes('[解除配對]'));
            if (removedLegacy.length > 0) {
                const keptSecurity = legacyArr.filter(lg => !lg || !String(lg.accountTried || '').includes('[解除配對]'));
                localStorage.setItem('yuelao_admin_login_logs', JSON.stringify(keptSecurity));
                if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
                    removedLegacy.forEach(item => {
                        if (item && item.id) CloudSync.deleteNode(`yuelao_admin_login_logs/${item.id}`);
                    });
                }
            }
        }
    } catch (e) {}
    currentPlayerOpLogPage = 1;
    renderAdminAll(true);
}

function getAdminMatchLogs() {
    const key = (typeof MATCH_LOGS_KEY !== 'undefined') ? MATCH_LOGS_KEY : 'yuelao_match_logs';
    const raw = localStorage.getItem(key) || '[]';
    if (typeof AdminMemoryCache !== 'undefined' && raw === AdminMemoryCache.matchLogsRaw && Array.isArray(AdminMemoryCache.matchLogs)) {
        return AdminMemoryCache.matchLogs;
    }
    try {
        const arr = JSON.parse(raw);
        const list = Array.isArray(arr) ? arr : [];
        list.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        const res = list.slice(0, 30);
        if (typeof AdminMemoryCache !== 'undefined') {
            AdminMemoryCache.matchLogsRaw = raw;
            AdminMemoryCache.matchLogs = res;
        }
        return res;
    } catch (e) {
        return [];
    }
}

function clearAdminMatchLogs() {
    if (!confirm('確定要清空所有的配對成功日誌嗎？此動作無法復原。')) return;
    const key = (typeof MATCH_LOGS_KEY !== 'undefined') ? MATCH_LOGS_KEY : 'yuelao_match_logs';
    localStorage.removeItem(key);
    if (typeof AdminMemoryCache !== 'undefined') {
        AdminMemoryCache.invalidate('matchLogs');
    }
    if (typeof CloudSync !== 'undefined') {
        if (CloudSync.tree && typeof CloudSync.tree === 'object') {
            delete CloudSync.tree[key];
        }
        CloudSync.deleteNode(key);
    }
    currentMatchLogsPage = 1;
    renderAdminAll(true);
}

function getAdminLoginLogs() {
    try {
        const arr = JSON.parse(localStorage.getItem('yuelao_admin_login_logs') || '[]');
        if (!Array.isArray(arr)) return [];
        // 僅保留後台防護／登入失敗紀錄（排除已拆分至玩家操作日誌的 [解除配對] 項目）
        return arr.filter(lg => lg && typeof lg === 'object' && !String(lg.accountTried || '').includes('[解除配對]'));
    } catch (e) {
        return [];
    }
}

function clearAdminLoginLogs() {
    if (!confirm('確定要清空所有的後台防護日誌嗎？此動作無法復原。')) return;
    localStorage.removeItem('yuelao_admin_login_logs');
    if (typeof CloudSync !== 'undefined') {
        if (CloudSync.tree && typeof CloudSync.tree === 'object') {
            delete CloudSync.tree['yuelao_admin_login_logs'];
        }
        CloudSync.deleteNode('yuelao_admin_login_logs');
    }
    currentLoginLogsPage = 1;
    renderAdminAll(true);
}

function buildLogsPaginationHtml(options) {
    const {
        totalItems,
        pageSizeStr,
        currentPage,
        totalPages,
        startIdx,
        perPage,
        sizeOptions = ['0', '5', '10', '30'],
        onPageSizeFnName,
        onGoPageFnName,
        accentBgClass = 'bg-[#c96a7b]',
        accentBorderClass = 'border-pink-200',
        accentHoverClass = 'hover:bg-pink-50',
        accentTextClass = 'text-[#8f4452]'
    } = options;

    const sizeBtnsHtml = sizeOptions.map(sz => {
        const active = String(pageSizeStr) === String(sz);
        return `<button type="button" onclick="${onPageSizeFnName}('${sz}')" class="px-2.5 h-7 rounded-lg font-bold transition ${active ? `${accentBgClass} text-white shadow-sm` : `bg-white border ${accentBorderClass} ${accentTextClass} ${accentHoverClass}`}">${sz} 筆</button>`;
    }).join('');

    if (String(pageSizeStr) === '0' || perPage === 0) {
        return `
            <span class="text-gray-500 font-medium">目前顯示 <strong class="${accentTextClass}">0</strong> 筆，共 <strong class="${accentTextClass}">${totalItems}</strong> 筆紀錄</span>
            <div class="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border ${accentBorderClass}">
                <span class="text-gray-500 font-bold">每頁顯示：</span>
                ${sizeBtnsHtml}
            </div>
        `;
    }

    if (totalItems === 0) {
        return `
            <span class="text-gray-400">共 0 筆紀錄</span>
            <div class="flex items-center gap-1.5">
                <span class="text-gray-500 font-semibold">每頁顯示：</span>
                ${sizeBtnsHtml}
            </div>
        `;
    }

    const showFrom = startIdx + 1;
    const showTo = Math.min(startIdx + perPage, totalItems);
    const pageBtns = [];
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) {
            const isCur = p === currentPage;
            pageBtns.push(`
                <button type="button" onclick="${onGoPageFnName}(${p})" class="min-w-[30px] h-7 px-2 rounded-lg font-bold transition ${isCur ? `${accentBgClass} text-white shadow-sm` : `bg-white border ${accentBorderClass} ${accentTextClass} ${accentHoverClass}`}">
                    ${p}
                </button>
            `);
        } else if (pageBtns[pageBtns.length - 1] !== '<span class="px-1 text-gray-400">...</span>') {
            pageBtns.push('<span class="px-1 text-gray-400">...</span>');
        }
    }

    return `
        <div class="text-gray-600 font-medium">
            顯示第 <strong class="${accentTextClass}">${showFrom}～${showTo}</strong> 筆，共 <strong class="${accentTextClass}">${totalItems}</strong> 筆（第 <strong>${currentPage}</strong> / ${totalPages} 頁，每頁 ${perPage} 筆）
        </div>
        <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border ${accentBorderClass}">
                <span class="text-gray-500 font-bold">顯示筆數：</span>
                ${sizeBtnsHtml}
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
                <button type="button" onclick="${onGoPageFnName}(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border ${accentBorderClass} ${accentTextClass} font-semibold ${accentHoverClass} disabled:opacity-40 disabled:cursor-not-allowed">
                    ◀ 上一頁
                </button>
                ${pageBtns.join('')}
                <button type="button" onclick="${onGoPageFnName}(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border ${accentBorderClass} ${accentTextClass} font-semibold ${accentHoverClass} disabled:opacity-40 disabled:cursor-not-allowed">
                    下一頁 ▶
                </button>
            </div>
        </div>
    `;
}

function renderLogsPageSection(forceUpdate = false) {
    const activePage = (typeof getCurrentAdminPageKey === 'function') ? getCurrentAdminPageKey() : 'logs';
    if (activePage !== 'logs') return;

    const playerOpLogs = getPlayerOpLogs();
    const matchLogs = getAdminMatchLogs();
    const loginLogs = getAdminLoginLogs();
    const wishWallSig = localStorage.getItem((typeof WISH_WALL_KEY !== 'undefined') ? WISH_WALL_KEY : 'yuelao_wish_wall') || '[]';

    const sig = JSON.stringify({
        pOpLogs: playerOpLogs.map(l => `${l.id}_${l.ts}`),
        pOpSearch: playerOpLogSearchKeyword,
        pOpPageSize: playerOpLogPageSize,
        pOpPage: currentPlayerOpLogPage,
        mLogs: matchLogs.map(l => `${l.id}_${l.ts}`),
        mPageSize: matchLogsPageSize,
        mPage: currentMatchLogsPage,
        lLogs: loginLogs.map(l => `${l.id || l.createdAt}_${l.accountTried}`),
        lPageSize: loginLogsPageSize,
        lPage: currentLoginLogsPage,
        wWall: wishWallSig
    });

    if (!forceUpdate && sig === lastLogsRenderSig) return;
    lastLogsRenderSig = sig;

    const escapeHtml = (str) => String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const highlightKw = (text, kw) => {
        const safe = escapeHtml(text);
        if (!kw) return safe;
        const escKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return safe.replace(new RegExp(`(${escKw})`, 'gi'), '<mark class="bg-amber-200 text-[#8f4452] px-0.5 rounded">$1</mark>');
    };

    // ==================== 1. 渲染「🕹️ 玩家操作日誌」（近 30 筆＋搜尋＋預設 0 筆） ====================
    const pOpBadge = document.getElementById('playerOpLogsCountBadge');
    if (pOpBadge) {
        pOpBadge.textContent = `近 ${playerOpLogs.length} / 30 筆`;
    }
    const pOpSizeSel = document.getElementById('playerOpLogPageSizeSelect');
    if (pOpSizeSel && pOpSizeSel.value !== playerOpLogPageSize) {
        pOpSizeSel.value = playerOpLogPageSize;
    }

    const kwLower = playerOpLogSearchKeyword.toLowerCase();
    const filteredPlayerOpLogs = kwLower
        ? playerOpLogs.filter(item => {
            const hay = [item.playerId, item.playerName, item.actionType, item.detail, item.createdAt]
                .filter(Boolean).join(' ').toLowerCase();
            return hay.includes(kwLower);
        })
        : playerOpLogs;

    const isPOpZero = (playerOpLogPageSize === '0');
    const pOpPerPage = isPOpZero ? 0 : (parseInt(playerOpLogPageSize, 10) || 5);
    const totalPOpPages = isPOpZero ? 1 : Math.max(1, Math.ceil(filteredPlayerOpLogs.length / pOpPerPage));
    if (currentPlayerOpLogPage > totalPOpPages) currentPlayerOpLogPage = totalPOpPages;
    if (currentPlayerOpLogPage < 1) currentPlayerOpLogPage = 1;
    const pOpStartIdx = isPOpZero ? 0 : (currentPlayerOpLogPage - 1) * pOpPerPage;
    const pagedPlayerOpLogs = isPOpZero ? [] : filteredPlayerOpLogs.slice(pOpStartIdx, pOpStartIdx + pOpPerPage);

    const pOpTbody = document.getElementById('playerOpLogsTableBody');
    if (pOpTbody) {
        if (isPOpZero) {
            pOpTbody.innerHTML = `<tr><td colspan="4" class="p-5 text-center text-gray-400">目前每頁顯示設為 0 筆（共 ${filteredPlayerOpLogs.length} 筆紀錄，請切換每頁顯示筆數查看明細）</td></tr>`;
        } else if (pagedPlayerOpLogs.length === 0) {
            pOpTbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400">${kwLower ? '找不到符合搜尋條件的玩家操作紀錄。' : '目前尚無任何玩家操作日誌紀錄。'}</td></tr>`;
        } else {
            pOpTbody.innerHTML = pagedPlayerOpLogs.map(item => {
                const timeText = item.createdAt || (item.ts ? new Date(Number(item.ts)).toLocaleString('zh-TW', { hour12: false }) : '-');
                const actionLabel = item.actionType || '玩家操作';
                const pidHtml = item.playerId
                    ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono font-bold mr-1">ID:${highlightKw(item.playerId, playerOpLogSearchKeyword)}</span>`
                    : '';
                return `
                    <tr class="hover:bg-emerald-50/35 transition">
                        <td class="p-3.5 text-xs font-mono text-gray-600 whitespace-nowrap">${highlightKw(timeText, playerOpLogSearchKeyword)}</td>
                        <td class="p-3.5 text-xs whitespace-nowrap">
                            <span class="px-2 py-0.5 rounded-full bg-rose-100 text-[#8f4452] font-bold">💔 ${highlightKw(actionLabel, playerOpLogSearchKeyword)}</span>
                        </td>
                        <td class="p-3.5 text-xs whitespace-nowrap">
                            ${pidHtml}
                            <span class="font-bold text-gray-800">${highlightKw(item.playerName || '-', playerOpLogSearchKeyword)}</span>
                        </td>
                        <td class="p-3.5 text-xs text-emerald-800 font-semibold break-all leading-relaxed">
                            ${highlightKw(item.detail || '-', playerOpLogSearchKeyword)}
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    const pOpPaginationBar = document.getElementById('playerOpLogsPaginationBar');
    if (pOpPaginationBar) {
        pOpPaginationBar.innerHTML = buildLogsPaginationHtml({
            totalItems: filteredPlayerOpLogs.length,
            pageSizeStr: playerOpLogPageSize,
            currentPage: currentPlayerOpLogPage,
            totalPages: totalPOpPages,
            startIdx: pOpStartIdx,
            perPage: pOpPerPage,
            sizeOptions: ['0', '5', '10', '30'],
            onPageSizeFnName: 'onPlayerOpLogPageSizeChange',
            onGoPageFnName: 'goToPlayerOpLogPage',
            accentBgClass: 'bg-emerald-600',
            accentBorderClass: 'border-emerald-200',
            accentHoverClass: 'hover:bg-emerald-50',
            accentTextClass: 'text-emerald-800'
        });
    }

    // ==================== 2. 渲染「🏮 紅線祈願牆發布與回覆紀錄」（預設 0 筆） ====================
    if (typeof renderAdminWishWallList === 'function') {
        renderAdminWishWallList();
    }

    // ==================== 3. 渲染「💘 自定義專屬活動配對日誌」（近 30 筆＋預設 0 筆） ====================
    const matchBadge = document.getElementById('matchLogsCountBadge');
    if (matchBadge) {
        matchBadge.textContent = `近 ${matchLogs.length} / 30 筆`;
    }
    const matchSizeSel = document.getElementById('matchLogsPageSizeSelect');
    if (matchSizeSel && matchSizeSel.value !== matchLogsPageSize) {
        matchSizeSel.value = matchLogsPageSize;
    }

    const isMatchZero = (matchLogsPageSize === '0');
    const matchPerPage = isMatchZero ? 0 : (parseInt(matchLogsPageSize, 10) || 5);
    const totalMatchPages = isMatchZero ? 1 : Math.max(1, Math.ceil(matchLogs.length / matchPerPage));
    if (currentMatchLogsPage > totalMatchPages) currentMatchLogsPage = totalMatchPages;
    if (currentMatchLogsPage < 1) currentMatchLogsPage = 1;
    const matchStartIdx = isMatchZero ? 0 : (currentMatchLogsPage - 1) * matchPerPage;
    const pagedMatchLogs = isMatchZero ? [] : matchLogs.slice(matchStartIdx, matchStartIdx + matchPerPage);

    const matchTbody = document.getElementById('matchLogsTableBody');
    if (matchTbody) {
        if (isMatchZero) {
            matchTbody.innerHTML = `<tr><td colspan="4" class="p-5 text-center text-gray-400">目前每頁顯示設為 0 筆（共 ${matchLogs.length} 筆紀錄，請切換每頁顯示筆數查看明細）</td></tr>`;
        } else if (pagedMatchLogs.length === 0) {
            matchTbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400">目前尚無任何配對成功日誌紀錄。</td></tr>`;
        } else {
            matchTbody.innerHTML = pagedMatchLogs.map(item => {
                const timeText = item.matchedAtStr || (item.ts ? new Date(Number(item.ts)).toLocaleString('zh-TW', { hour12: false }) : '-');
                const genderTagA = item.genderA ? `（${escapeHtml(item.genderA)}）` : '';
                const genderTagB = item.genderB ? `（${escapeHtml(item.genderB)}）` : '';
                const sourcePart = item.source ? ` ・ ${escapeHtml(item.source)}` : '';
                return `
                    <tr class="hover:bg-pink-50/35 transition">
                        <td class="p-3.5 text-xs font-mono text-gray-600 whitespace-nowrap">${escapeHtml(timeText)}</td>
                        <td class="p-3.5 text-xs whitespace-nowrap">
                            <span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-mono font-bold mr-1">${escapeHtml(item.idA)}</span>
                            <span class="font-bold text-gray-800">${escapeHtml(item.nameA || `玩家_${item.idA}`)}</span>
                            <span class="text-[11px] text-[#c96a7b]">${genderTagA}</span>
                        </td>
                        <td class="p-3.5 text-xs whitespace-nowrap">
                            <span class="px-1.5 py-0.5 rounded bg-pink-100 text-[#8f4452] font-mono font-bold mr-1">${escapeHtml(item.idB)}</span>
                            <span class="font-bold text-gray-800">${escapeHtml(item.nameB || `玩家_${item.idB}`)}</span>
                            <span class="text-[11px] text-[#c96a7b]">${genderTagB}</span>
                        </td>
                        <td class="p-3.5 text-xs text-[#8f4452] font-semibold">
                            💘 ${escapeHtml(item.session || '紅線配對')}${sourcePart}
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    const matchPaginationBar = document.getElementById('matchLogsPaginationBar');
    if (matchPaginationBar) {
        matchPaginationBar.innerHTML = buildLogsPaginationHtml({
            totalItems: matchLogs.length,
            pageSizeStr: matchLogsPageSize,
            currentPage: currentMatchLogsPage,
            totalPages: totalMatchPages,
            startIdx: matchStartIdx,
            perPage: matchPerPage,
            sizeOptions: ['0', '5', '10', '30'],
            onPageSizeFnName: 'onMatchLogsPageSizeChange',
            onGoPageFnName: 'goToMatchLogsPage',
            accentBgClass: 'bg-[#c96a7b]',
            accentBorderClass: 'border-pink-200',
            accentHoverClass: 'hover:bg-pink-50',
            accentTextClass: 'text-[#8f4452]'
        });
    }

    // ==================== 4. 渲染「🛡️ 後台防護日誌」（近 10 筆＋預設 0 筆） ====================
    const loginLogsBadge = document.getElementById('loginLogsCountBadge');
    if (loginLogsBadge) {
        loginLogsBadge.textContent = `近 ${loginLogs.length} / 10 筆`;
    }
    const loginSizeSel = document.getElementById('loginLogsPageSizeSelect');
    if (loginSizeSel && loginSizeSel.value !== loginLogsPageSize) {
        loginSizeSel.value = loginLogsPageSize;
    }

    const isLoginZero = (loginLogsPageSize === '0');
    const loginPerPage = isLoginZero ? 0 : (parseInt(loginLogsPageSize, 10) || 5);
    const totalLoginPages = isLoginZero ? 1 : Math.max(1, Math.ceil(loginLogs.length / loginPerPage));
    if (currentLoginLogsPage > totalLoginPages) currentLoginLogsPage = totalLoginPages;
    if (currentLoginLogsPage < 1) currentLoginLogsPage = 1;
    const loginStartIdx = isLoginZero ? 0 : (currentLoginLogsPage - 1) * loginPerPage;
    const pagedLoginLogs = isLoginZero ? [] : loginLogs.slice(loginStartIdx, loginStartIdx + loginPerPage);

    const tbody = document.getElementById('loginLogsTableBody');
    if (tbody) {
        if (isLoginZero) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-5 text-center text-gray-400">目前每頁顯示設為 0 筆（共 ${loginLogs.length} 筆紀錄，請切換每頁顯示筆數查看明細）</td></tr>`;
        } else if (pagedLoginLogs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400">目前尚無任何後台防護紀錄。</td></tr>`;
        } else {
            tbody.innerHTML = pagedLoginLogs.map(log => {
                const ipCell = `<a href="https://whatismyipaddress.com/ip/${escapeHtml(log.ipAddress)}" target="_blank" class="hover:underline text-rose-600" title="點擊查詢 IP 來源">${escapeHtml(log.ipAddress)}</a>`;
                const accountCell = `<span class="text-[#8f4452] font-bold">${escapeHtml(log.accountTried)}</span>`;
                return `
                <tr class="hover:bg-rose-50/30 transition">
                    <td class="p-3.5 text-xs font-mono text-gray-500 whitespace-nowrap">${escapeHtml(log.createdAt)}</td>
                    <td class="p-3.5 text-xs whitespace-nowrap">${accountCell}</td>
                    <td class="p-3.5 text-xs font-mono whitespace-nowrap">${ipCell}</td>
                    <td class="p-3.5 text-[11px] text-gray-600 break-all leading-relaxed">${escapeHtml(log.userAgent)}</td>
                </tr>
                `;
            }).join('');
        }
    }

    const loginPaginationBar = document.getElementById('loginLogsPaginationBar');
    if (loginPaginationBar) {
        loginPaginationBar.innerHTML = buildLogsPaginationHtml({
            totalItems: loginLogs.length,
            pageSizeStr: loginLogsPageSize,
            currentPage: currentLoginLogsPage,
            totalPages: totalLoginPages,
            startIdx: loginStartIdx,
            perPage: loginPerPage,
            sizeOptions: ['0', '5', '10'],
            onPageSizeFnName: 'onLoginLogsPageSizeChange',
            onGoPageFnName: 'goToLoginLogsPage',
            accentBgClass: 'bg-rose-600',
            accentBorderClass: 'border-rose-200',
            accentHoverClass: 'hover:bg-rose-50',
            accentTextClass: 'text-rose-800'
        });
    }
}

window.onPlayerOpLogSearchInput = onPlayerOpLogSearchInput;
window.clearPlayerOpLogSearch = clearPlayerOpLogSearch;
window.onPlayerOpLogPageSizeChange = onPlayerOpLogPageSizeChange;
window.goToPlayerOpLogPage = goToPlayerOpLogPage;
window.clearAdminPlayerOpLogs = clearAdminPlayerOpLogs;
window.onMatchLogsPageSizeChange = onMatchLogsPageSizeChange;
window.goToMatchLogsPage = goToMatchLogsPage;
window.onLoginLogsPageSizeChange = onLoginLogsPageSizeChange;
window.goToLoginLogsPage = goToLoginLogsPage;
