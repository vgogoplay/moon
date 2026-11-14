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

function renderOpsPageSection(batch, currentSched, maxDisplayBatch) {
    const reports = getReports();
    const rBody = document.getElementById('reportsTableBody');
    if (rBody) {
        if (reports.length === 0) {
            rBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400">目前尚無玩家提交問題回報。</td></tr>`;
        } else {
            rBody.innerHTML = reports.map(r => `
                <tr class="hover:bg-pink-50/30">
                    <td class="p-3.5 text-xs">
                        <div class="font-bold text-[#8f4452]">${r.id}</div>
                        <div class="text-gray-400">${r.createdAt}</div>
                    </td>
                    <td class="p-3.5 text-xs font-medium">${r.category}</td>
                    <td class="p-3.5 text-xs">${r.contact}</td>
                    <td class="p-3.5 text-xs text-gray-700 max-w-md">${r.content}</td>
                    <td class="p-3.5 text-xs">
                        <button onclick="toggleReportStatus('${r.id}')" class="px-2.5 py-1 rounded-full font-semibold ${r.status === '已解決' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}">
                            ${r.status}
                        </button>
                    </td>
                    <td class="p-3.5 text-xs whitespace-nowrap">
                        <button type="button" onclick="deleteIssueReport('${r.id}')" class="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-300 text-rose-700 font-semibold hover:bg-rose-100 transition">
                            🗑️ 刪除
                        </button>
                    </td>
                </tr>
            `).join('');
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

    const mailListBox = document.getElementById('adminSentMailsList');
    if (mailListBox) {
        const sentMails = getMailbox();
        if (sentMails.length === 0) {
            mailListBox.innerHTML = `<p class="text-xs text-gray-400">尚未發送任何信件給前台玩家。</p>`;
        } else {
            mailListBox.innerHTML = sentMails.slice(0, 10).map(m => `
                <div class="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-pink-200 text-xs">
                    <div class="min-w-0 flex-1">
                        <span class="px-2 py-0.5 rounded bg-pink-100 text-[#8f4452] font-bold mr-1.5">收件：${m.targetLabel || m.targetId}</span>
                        <strong class="text-[#5e464a]">${m.title}</strong>
                        <span class="text-gray-500 ml-1.5">— ${m.content}</span>
                        <span class="text-[10px] text-gray-400 ml-2">(${m.createdAt})</span>
                    </div>
                    <button onclick="deleteMailboxMessage('${m.id}')" class="text-rose-500 hover:underline shrink-0">收回刪除</button>
                </div>
            `).join('');
        }
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
