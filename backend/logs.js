/* backend/logs.js - 後台配對成功日誌（近 30 筆）與安全防護日誌顯示 */

function getAdminMatchLogs() {
    try {
        const key = (typeof MATCH_LOGS_KEY !== 'undefined') ? MATCH_LOGS_KEY : 'yuelao_match_logs';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        const list = Array.isArray(arr) ? arr : [];
        list.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        return list.slice(0, 30);
    } catch (e) {
        return [];
    }
}

function clearAdminMatchLogs() {
    if (!confirm('確定要清空所有的配對成功日誌嗎？此動作無法復原。')) return;
    const key = (typeof MATCH_LOGS_KEY !== 'undefined') ? MATCH_LOGS_KEY : 'yuelao_match_logs';
    localStorage.removeItem(key);
    if (typeof CloudSync !== 'undefined') {
        if (CloudSync.tree && typeof CloudSync.tree === 'object') {
            delete CloudSync.tree[key];
        }
        CloudSync.deleteNode(key);
    }
    renderAdminAll(true);
}

function getAdminLoginLogs() {
    try {
        const arr = JSON.parse(localStorage.getItem('yuelao_admin_login_logs') || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function clearAdminLoginLogs() {
    if (!confirm('確定要清空所有的防護與操作紀錄嗎？此動作無法復原。')) return;
    
    localStorage.removeItem('yuelao_admin_login_logs');
    if (typeof CloudSync !== 'undefined') {
        CloudSync.deleteNode('yuelao_admin_login_logs');
    }
    renderAdminAll(true);
}

function renderLogsPageSection() {
    const escapeHtml = (str) => String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // 1. 渲染配對成功日誌（近 30 筆）
    const matchLogs = getAdminMatchLogs();
    const matchBadge = document.getElementById('matchLogsCountBadge');
    if (matchBadge) {
        matchBadge.textContent = `近 ${matchLogs.length} / 30 筆`;
    }
    const matchTbody = document.getElementById('matchLogsTableBody');
    if (matchTbody) {
        if (matchLogs.length === 0) {
            matchTbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400">目前尚無任何配對成功日誌紀錄。</td></tr>`;
        } else {
            matchTbody.innerHTML = matchLogs.map(item => {
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

    // 2. 渲染後台防護與玩家解除配對操作日誌
    const logs = getAdminLoginLogs();
    const tbody = document.getElementById('loginLogsTableBody');
    if (tbody) {
        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400">目前尚無任何紀錄。</td></tr>`;
        } else {
            tbody.innerHTML = logs.map(log => {
                const isUnmatch = String(log.accountTried || '').includes('[解除配對]');
                const ipCell = isUnmatch
                    ? `<span class="text-emerald-700 font-bold">${escapeHtml(log.ipAddress)}</span>`
                    : `<a href="https://whatismyipaddress.com/ip/${escapeHtml(log.ipAddress)}" target="_blank" class="hover:underline text-rose-600" title="點擊查詢 IP 來源">${escapeHtml(log.ipAddress)}</a>`;
                const accountCell = isUnmatch
                    ? `<span class="text-emerald-600 font-bold">${escapeHtml(log.accountTried)}</span>`
                    : `<span class="text-[#8f4452] font-bold">${escapeHtml(log.accountTried)}</span>`;

                return `
                <tr class="hover:bg-rose-50/30 transition">
                    <td class="p-3.5 text-xs font-mono text-gray-500 whitespace-nowrap">${escapeHtml(log.createdAt)}</td>
                    <td class="p-3.5 text-xs whitespace-nowrap">${accountCell}</td>
                    <td class="p-3.5 text-xs font-mono whitespace-nowrap">${ipCell}</td>
                    <td class="p-3.5 text-[11px] ${isUnmatch ? 'text-emerald-700 font-semibold' : 'text-gray-600'} break-all leading-relaxed">${escapeHtml(log.userAgent)}</td>
                </tr>
                `;
            }).join('');
        }
    }

    // 3. 渲染紅線祈願牆發布與回覆紀錄（不受上方日誌是否為空影響）
    if (typeof renderAdminWishWallList === 'function') {
        renderAdminWishWallList();
    }
}
