/* backend/logs.js - 後台安全與登入日誌顯示 */

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
    renderAdminAll();
}

function renderLogsPageSection() {
    const logs = getAdminLoginLogs();
    const tbody = document.getElementById('loginLogsTableBody');
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400">目前尚無任何紀錄。</td></tr>`;
        return;
    }

    const escapeHtml = (str) => String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

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
