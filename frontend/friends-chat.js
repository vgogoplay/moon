/* frontend/friends-chat.js - 前台七日限定好友名單、聊天室、心動抉擇、信箱與問題回報 */

// ==================== 前台玩家信件箱（管理員發送信件／文字查看） ====================
function getPlayerMails() {
    const allMails = Store.getMailbox();
    return allMails.filter(m => {
        if (!m) return false;
        if (m.targetId === 'ALL') return true;
        return appState.playerId && String(m.targetId) === String(appState.playerId);
    });
}

function updateMailboxBadge() {
    const mails = getPlayerMails();
    const readSet = new Set(appState.readMailIds || []);
    const unreadCount = mails.filter(m => !readSet.has(m.id)).length;
    const badge = document.getElementById('mailboxUnreadBadge');
    if (!badge) return;

    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

async function openMailboxModal() {
    backToMailboxList();
    renderMailboxList();
    document.getElementById('mailboxModal').classList.remove('hidden');
    if (typeof CloudSync !== 'undefined' && CloudSync.initialized && !CloudSync.isLocalSandboxMode() && typeof CloudSync.pollPlayerNodes === 'function') {
        await CloudSync.pollPlayerNodes([MAILBOX_KEY]);
        syncOpenMailboxModalView();
    }
}

let currentViewingMailId = null;

function closeMailboxModal() {
    currentViewingMailId = null;
    document.getElementById('mailboxModal').classList.add('hidden');
}

function renderMailboxList() {
    const listEl = document.getElementById('mailboxListView');
    const mails = getPlayerMails();
    const readSet = new Set(appState.readMailIds || []);

    if (mails.length === 0) {
        listEl.innerHTML = `
            <div class="text-center py-8 text-xs text-gray-400 bg-pink-50/40 rounded-2xl border border-dashed border-pink-200">
                目前信箱還沒有管理員寄來的信件 🌸
            </div>
        `;
        return;
    }

    listEl.innerHTML = mails.map(m => {
        const isRead = readSet.has(m.id);
        return `
            <div onclick="viewMailDetail('${m.id}')" class="cursor-pointer p-3 rounded-2xl border transition-all ${isRead ? 'bg-white border-pink-100 hover:border-pink-300' : 'bg-pink-50/85 border-[#c96a7b] shadow-2xs'}">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0 font-bold ${isRead ? 'bg-gray-100 text-gray-500' : 'bg-rose-500 text-white'}">
                            ${isRead ? '已讀' : '未讀'}
                        </span>
                        <h4 class="text-xs font-bold text-[#8f4452] truncate">${m.title || '管理員通知信件'}</h4>
                    </div>
                    <span class="text-[10px] text-gray-400 shrink-0">${m.createdAt || ''}</span>
                </div>
                <p class="text-[11px] text-gray-500 truncate mt-1">${m.content || ''}</p>
            </div>
        `;
    }).join('');
}

function recordSinglePlayerMailReadReceipt(mailObj) {
    if (!mailObj || !mailObj.id) return;
    const targetId = String(mailObj.targetId || '').trim();
    if (!targetId || targetId.toUpperCase() === 'ALL') return;
    const myPid = String((typeof appState !== 'undefined' && appState && appState.playerId) || '').trim();
    if (!myPid || myPid !== targetId) return;
    if (mailObj.isReadByTarget) return;

    const nowTs = Date.now();
    const readAtStr = new Date(nowTs).toLocaleString('zh-TW', { hour12: false });
    const readerName = String((appState.profile && appState.profile.nickname) || '').trim();
    const patchPayload = {
        isReadByTarget: true,
        readByPlayerId: myPid,
        readByPlayerName: readerName,
        readAtTs: nowTs,
        readAtStr: readAtStr
    };

    try {
        const allMails = Store.getMailbox();
        const idx = allMails.findIndex(m => m && String(m.id) === String(mailObj.id));
        if (idx >= 0) {
            allMails[idx] = { ...allMails[idx], ...patchPayload };
            localStorage.setItem(MAILBOX_KEY, JSON.stringify(allMails));
            if (typeof LocalJsonCache !== 'undefined') {
                LocalJsonCache.invalidate(MAILBOX_KEY);
            }
        }
    } catch (e) {}

    if (typeof CloudSync !== 'undefined') {
        if (CloudSync.initialized && typeof CloudSync.patchNode === 'function') {
            CloudSync.patchNode(`${MAILBOX_KEY}/${mailObj.id}`, patchPayload);
        } else if (typeof CloudSync.putNode === 'function') {
            CloudSync.putNode(`${MAILBOX_KEY}/${mailObj.id}`, { ...mailObj, ...patchPayload });
        }
    }
}

function syncAlreadyReadSingleMailsReceipts() {
    const myPid = String((typeof appState !== 'undefined' && appState && appState.playerId) || '').trim();
    if (!myPid || !Array.isArray(appState.readMailIds) || appState.readMailIds.length === 0) return;
    const readSet = new Set(appState.readMailIds.map(String));
    const allMails = Store.getMailbox();
    allMails.forEach(m => {
        if (!m || !m.id) return;
        const tId = String(m.targetId || '').trim();
        if (tId && tId.toUpperCase() !== 'ALL' && tId === myPid && !m.isReadByTarget && readSet.has(String(m.id))) {
            recordSinglePlayerMailReadReceipt(m);
        }
    });
}

function viewMailDetail(mailId) {
    const mails = getPlayerMails();
    const mail = mails.find(m => m.id === mailId);
    if (!mail) return;

    currentViewingMailId = String(mailId);

    if (!Array.isArray(appState.readMailIds)) appState.readMailIds = [];
    if (!appState.readMailIds.includes(mailId)) {
        appState.readMailIds.push(mailId);
        Store.save(appState);
        updateMailboxBadge();
    }
    recordSinglePlayerMailReadReceipt(mail);

    document.getElementById('mailDetailTitle').textContent = mail.title || '管理員通知信件';
    document.getElementById('mailDetailTime').textContent = mail.updatedAt ? `${mail.createdAt || ''}（已更新）` : (mail.createdAt || '');
    document.getElementById('mailDetailBody').textContent = mail.content || '';

    document.getElementById('mailboxListView').classList.add('hidden');
    document.getElementById('mailboxDetailView').classList.remove('hidden');
}

function backToMailboxList() {
    currentViewingMailId = null;
    document.getElementById('mailboxDetailView').classList.add('hidden');
    document.getElementById('mailboxListView').classList.remove('hidden');
    renderMailboxList();
}

function syncOpenMailboxModalView() {
    const modalEl = document.getElementById('mailboxModal');
    if (!modalEl || modalEl.classList.contains('hidden')) return;
    const listViewEl = document.getElementById('mailboxListView');
    const detailViewEl = document.getElementById('mailboxDetailView');
    if (listViewEl && !listViewEl.classList.contains('hidden')) {
        renderMailboxList();
    } else if (detailViewEl && !detailViewEl.classList.contains('hidden') && currentViewingMailId) {
        const mails = getPlayerMails();
        const latestMail = mails.find(m => String(m.id) === String(currentViewingMailId));
        if (!latestMail) {
            backToMailboxList();
            return;
        }
        document.getElementById('mailDetailTitle').textContent = latestMail.title || '管理員通知信件';
        document.getElementById('mailDetailTime').textContent = latestMail.updatedAt ? `${latestMail.createdAt || ''}（已更新）` : (latestMail.createdAt || '');
        document.getElementById('mailDetailBody').textContent = latestMail.content || '';
    }
}

// ==================== 問題回報（送出後可查看送出內容、處理狀態與管理員回覆） ====================
const MY_REPORT_IDS_KEY = 'yuelao_my_report_ids';
const READ_REPORT_REPLIES_KEY = 'yuelao_read_report_replies';

function escapeReportHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getMyLocalReportIds() {
    try {
        const arr = JSON.parse(localStorage.getItem(MY_REPORT_IDS_KEY) || '[]');
        return Array.isArray(arr) ? arr.map(String) : [];
    } catch (e) {
        return [];
    }
}

function rememberMyLocalReportId(repId) {
    if (!repId) return;
    const set = new Set(getMyLocalReportIds());
    set.add(String(repId));
    try {
        localStorage.setItem(MY_REPORT_IDS_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {}
}

function getReadReportReplyKeys() {
    try {
        const arr = JSON.parse(localStorage.getItem(READ_REPORT_REPLIES_KEY) || '[]');
        return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch (e) {
        return new Set();
    }
}

function makeReportReplyReceiptKey(rep) {
    return `${rep.id}_${rep.repliedAt || rep.adminReply || ''}`;
}

function getPlayerSubmittedReports() {
    const allReports = (typeof Store !== 'undefined' && typeof Store.getReports === 'function')
        ? Store.getReports()
        : JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
    const myIdSet = new Set(getMyLocalReportIds());
    const pid = appState && appState.playerId ? String(appState.playerId).trim() : '';

    return allReports
        .filter(r => {
            if (!r || !r.id) return false;
            if (myIdSet.has(String(r.id))) return true;
            if (pid) {
                if (String(r.playerId || '').trim() === pid) return true;
                if (String(r.contact || '').includes(`ID:${pid}`)) return true;
            }
            return false;
        })
        .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
}

function updateReportReplyBadge() {
    const badge = document.getElementById('reportReplyUnreadBadge');
    if (!badge) return;
    const myReps = getPlayerSubmittedReports();
    const readSet = getReadReportReplyKeys();
    const unreadReplies = myReps.filter(r => String(r.adminReply || '').trim() !== '' && !readSet.has(makeReportReplyReceiptKey(r))).length;

    if (unreadReplies > 0) {
        badge.textContent = unreadReplies > 99 ? '99+' : String(unreadReplies);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function markMyReportRepliesAsRead() {
    const myReps = getPlayerSubmittedReports();
    const readSet = getReadReportReplyKeys();
    let changed = false;
    myReps.forEach(r => {
        if (String(r.adminReply || '').trim() !== '') {
            const k = makeReportReplyReceiptKey(r);
            if (!readSet.has(k)) {
                readSet.add(k);
                changed = true;
            }
        }
    });
    if (changed) {
        try {
            localStorage.setItem(READ_REPORT_REPLIES_KEY, JSON.stringify(Array.from(readSet)));
        } catch (e) {}
    }
    updateReportReplyBadge();
}

const expandedMyReportIds = new Set();

function toggleMyIssueReportExpand(reportId) {
    const key = String(reportId || '').trim();
    if (!key) return;
    if (expandedMyReportIds.has(key)) {
        expandedMyReportIds.delete(key);
    } else {
        expandedMyReportIds.add(key);
    }
    renderMyIssueReportsList();
}

function renderMyIssueReportsList() {
    const listEl = document.getElementById('myIssueReportsList');
    const countBadge = document.getElementById('myReportsCountBadge');
    if (!listEl) return;

    const myReps = getPlayerSubmittedReports();
    if (countBadge) countBadge.textContent = `${myReps.length} 筆`;

    if (myReps.length === 0) {
        listEl.innerHTML = `
            <div class="text-center py-5 text-xs text-gray-400 bg-pink-50/35 rounded-2xl border border-dashed border-pink-200">
                目前尚無問題回報紀錄 🌸<br>送出後可在此查看處理狀態與管理員回覆。
            </div>
        `;
        return;
    }

    listEl.innerHTML = myReps.map(r => {
        const repId = String(r.id);
        const isExpanded = expandedMyReportIds.has(repId);
        const isResolved = r.status === '已解決';
        const replyText = String(r.adminReply || '').trim();
        const titleText = String(r.title || r.category || '問題回報').trim();

        const statusBadge = isResolved
            ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold shrink-0">✅ 已解決</span>`
            : `<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold shrink-0">⏳ 待處理</span>`;

        const repliedTag = replyText
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-[#8f4452] font-bold shrink-0">💬 已回覆</span>`
            : '';

        const replyBlockHtml = replyText
            ? `
                <div class="p-2.5 rounded-xl bg-gradient-to-r from-rose-50 to-pink-50 border border-pink-300 space-y-1">
                    <div class="flex items-center justify-between gap-2 text-[11px]">
                        <span class="font-bold text-[#8f4452]">💌 管理員回覆</span>
                        <span class="text-[10px] text-gray-400">${escapeReportHtml(r.repliedAt || '')}</span>
                    </div>
                    <p class="text-xs text-[#6e3a43] leading-relaxed whitespace-pre-line">${escapeReportHtml(replyText)}</p>
                </div>
            `
            : `
                <div class="text-[11px] text-gray-400 bg-gray-50/80 px-2.5 py-1.5 rounded-lg border border-gray-100">
                    💬 管理員尚未回覆（管理員回覆後將即時顯示於此）
                </div>
            `;

        const detailBodyHtml = isExpanded ? `
            <div class="px-3 pb-3 pt-2 border-t border-pink-100 bg-pink-50/15 space-y-2">
                <div class="flex items-center justify-between text-[10px] text-gray-400">
                    <span>單號：${escapeReportHtml(repId)}</span>
                    <span>送出時間：${escapeReportHtml(r.createdAt || '')}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-pink-50/45 border border-pink-100 text-xs text-gray-700 leading-relaxed whitespace-pre-line">
                    <span class="text-[10px] font-bold text-[#c96a7b] block mb-0.5">我送出的內容：</span>${escapeReportHtml(r.content || '')}
                </div>
                ${replyBlockHtml}
            </div>
        ` : '';

        return `
            <div class="rounded-2xl bg-white border ${isExpanded ? 'border-[#c96a7b] shadow-2xs' : (replyText ? 'border-pink-300' : 'border-pink-100')} overflow-hidden transition">
                <button type="button" onclick="toggleMyIssueReportExpand('${escapeReportHtml(repId)}')" class="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-pink-50/40 transition">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="text-xs font-bold text-[#5e464a] truncate">${escapeReportHtml(titleText)}</span>
                        ${repliedTag}
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        ${statusBadge}
                        <span class="text-[11px] text-[#c96a7b] font-semibold">${isExpanded ? '▴' : '▾'}</span>
                    </div>
                </button>
                ${detailBodyHtml}
            </div>
        `;
    }).join('');
}

async function fetchReportsOnDemand() {
    if (typeof CloudSync === 'undefined' || !CloudSync.initialized || CloudSync.isLocalSandboxMode()) return;
    if (typeof CloudSync.pollPlayerNodes === 'function') {
        await CloudSync.pollPlayerNodes([REPORTS_KEY]);
    }
}

async function refreshMyIssueReports() {
    await fetchReportsOnDemand();
    markMyReportRepliesAsRead();
    renderMyIssueReportsList();
}

async function openReportModal() {
    const contactInput = document.getElementById('reportContact');
    if (contactInput && !contactInput.value && (appState.playerId || appState.profile.nickname)) {
        contactInput.value = `ID:${appState.playerId || '未產生'} / ${appState.profile.nickname || ''}`;
    }
    markMyReportRepliesAsRead();
    renderMyIssueReportsList();
    document.getElementById('reportModal').classList.remove('hidden');
    await fetchReportsOnDemand();
    markMyReportRepliesAsRead();
    renderMyIssueReportsList();
}

function closeReportModal() {
    document.getElementById('reportModal').classList.add('hidden');
}

document.getElementById('issueReportForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const category = document.getElementById('reportCategory').value;
    const contact = document.getElementById('reportContact').value.trim();
    const content = document.getElementById('reportContent').value.trim();
    if (!content) return;

    const created = Store.addIssueReport({
        playerId: appState.playerId || '',
        category,
        contact,
        content
    });
    if (created && created.id) {
        rememberMyLocalReportId(created.id);
    }

    const contentBox = document.getElementById('reportContent');
    if (contentBox) contentBox.value = '';
    if (!contact && (appState.playerId || appState.profile.nickname)) {
        document.getElementById('reportContact').value = `ID:${appState.playerId || '未產生'} / ${appState.profile.nickname || ''}`;
    }

    renderMyIssueReportsList();
    const listSec = document.getElementById('myIssueReportsSection');
    if (listSec) {
        listSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    showMiniNotice('📮 問題回報已送出', '已送出至後台！您可直接在此視窗下方查看送出內容、處理狀態與管理員回覆。');
});

// ==================== 好友名單未讀紅點狀態管理（純本地輕量紀錄） ====================
const FRIEND_READ_RECEIPTS_PREFIX = 'yuelao_friend_read_receipts_';
let cachedFriendReadReceiptsKey = '';
let cachedFriendReadReceiptsObj = null;

function getFriendReadReceiptsStorageKey() {
    const pid = (typeof appState !== 'undefined' && appState && appState.playerId)
        ? String(appState.playerId).trim()
        : 'guest';
    return `${FRIEND_READ_RECEIPTS_PREFIX}${pid || 'guest'}`;
}

function loadFriendReadReceiptsMap() {
    const key = getFriendReadReceiptsStorageKey();
    if (key === cachedFriendReadReceiptsKey && cachedFriendReadReceiptsObj) {
        return cachedFriendReadReceiptsObj;
    }
    try {
        const raw = JSON.parse(localStorage.getItem(key) || '{}');
        cachedFriendReadReceiptsKey = key;
        cachedFriendReadReceiptsObj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
        return cachedFriendReadReceiptsObj;
    } catch (e) {
        return {};
    }
}

function saveFriendReadReceiptsMap(mapObj) {
    const key = getFriendReadReceiptsStorageKey();
    cachedFriendReadReceiptsKey = key;
    cachedFriendReadReceiptsObj = mapObj || {};
    try {
        localStorage.setItem(key, JSON.stringify(cachedFriendReadReceiptsObj));
    } catch (e) {}
}

function getFriendLatestActivityReceiptKey(friend) {
    if (!friend || !friend.id) return '';
    const fid = String(friend.id);
    const myPid = (typeof appState !== 'undefined' && appState && appState.playerId)
        ? String(appState.playerId).trim()
        : '';
    const isRealFriend = !fid.startsWith('MOCK_FRIEND_') && !!myPid;
    let msgs = Array.isArray(friend.messages) ? friend.messages : [];
    if (isRealFriend && typeof ChatStore !== 'undefined' && typeof ChatStore.getMessages === 'function') {
        const shared = ChatStore.getMessages(myPid, fid);
        if (shared.length > 0) msgs = shared;
    }

    const incomingOrSysMsgs = msgs.filter(m => {
        if (!m) return false;
        if (m.senderId === 'system' || m.sender === 'system') return true;
        if (m.senderId) return String(m.senderId).trim() !== myPid;
        return m.sender !== 'me';
    });
    const lastIncoming = incomingOrSysMsgs[incomingOrSysMsgs.length - 1];
    if (lastIncoming) {
        return `in_${incomingOrSysMsgs.length}_${lastIncoming.id || lastIncoming.ts || lastIncoming.text || ''}_${friend.matchedAt || 0}`;
    }
    return `match_${friend.matchedAt || 0}`;
}

function isFriendUnread(friend, receiptsMap = null) {
    if (!friend || !friend.id) return false;
    const map = receiptsMap || loadFriendReadReceiptsMap();
    const latestKey = getFriendLatestActivityReceiptKey(friend);
    if (!latestKey) return false;
    return map[String(friend.id)] !== latestKey;
}

function markFriendChatAsRead(friend) {
    if (!friend || !friend.id) return;
    const fid = String(friend.id);
    const latestKey = getFriendLatestActivityReceiptKey(friend);
    if (!latestKey) return;
    const map = loadFriendReadReceiptsMap();
    if (map[fid] !== latestKey) {
        map[fid] = latestKey;
        saveFriendReadReceiptsMap(map);
    }
}

function removeFriendReadReceipt(friendId) {
    if (!friendId) return;
    const fid = String(friendId);
    const map = loadFriendReadReceiptsMap();
    if (Object.prototype.hasOwnProperty.call(map, fid)) {
        delete map[fid];
        saveFriendReadReceiptsMap(map);
    }
}

function updateFriendUnreadDot() {
    const dotEl = document.getElementById('navFriendDot');
    if (!dotEl) return;
    const friendsList = (typeof appState !== 'undefined' && appState && Array.isArray(appState.friends))
        ? appState.friends
        : [];
    if (friendsList.length === 0) {
        dotEl.classList.add('hidden');
        return;
    }
    const receiptsMap = loadFriendReadReceiptsMap();
    const hasUnread = friendsList.some(f => isFriendUnread(f, receiptsMap));
    dotEl.classList.toggle('hidden', !hasUnread);
}

// ==================== 好友名單與對話（含禁止玩家發話：顯示「請聯繫管理員」） ====================
function renderFriendsSection() {
    const listEl = document.getElementById('friendsListContainer');
    const countBadge = document.getElementById('friendCountBadge');
    const workspace = document.getElementById('activeChatWorkspace');

    countBadge.textContent = `${appState.friends.length} 位好友`;

    if (appState.friends.length === 0) {
        listEl.innerHTML = `
            <div class="md:col-span-2 text-center py-10 text-sm text-gray-400 bg-white/60 rounded-2xl border border-dashed border-pink-200">
                目前好友名單還是空的 🌸<br>選擇屆數場次並完成報名後，將在該場次 20:00 為你牽起七日緣分。
            </div>
        `;
        workspace.classList.add('hidden');
        updateFriendUnreadDot();
        return;
    }

    if (!appState.activeFriendId || !appState.friends.some(f => String(f.id) === String(appState.activeFriendId))) {
        appState.activeFriendId = String(appState.friends[0].id);
    }

    const friendsTabEl = document.getElementById('tab-friends');
    const isFriendsTabOpen = Boolean(friendsTabEl && !friendsTabEl.classList.contains('hidden'));
    if (isFriendsTabOpen) {
        const activeFriendObj = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
        if (activeFriendObj) {
            markFriendChatAsRead(activeFriendObj);
        }
    }

    const receiptsMap = loadFriendReadReceiptsMap();
    const nowTs = Date.now();
    listEl.innerHTML = appState.friends.map(friend => {
        const isActive = String(friend.id) === String(appState.activeFriendId);
        const hasCardUnread = !isActive && isFriendUnread(friend, receiptsMap);
        const remainDays = calcRemainingDays(friend.matchedAt, nowTs);
        const isMockFriend = String(friend.id).startsWith('MOCK_FRIEND_');
        const canManualUnfriend = canManuallyUnfriendFriend(friend, nowTs);
        return `
            <div onclick="selectFriend('${friend.id}')" class="cursor-pointer p-4 rounded-2xl border transition-all ${isActive ? 'bg-pink-50/90 border-[#c96a7b] shadow-md' : 'bg-white/80 border-pink-100 hover:border-pink-300'}">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="relative w-11 h-11 rounded-full bg-gradient-to-br from-pink-200 to-rose-300 text-white font-bold flex items-center justify-center text-lg shrink-0">
                            ${friend.nickname.slice(0, 1)}
                            ${hasCardUnread ? `<span class="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-rose-500 ring-2 ring-white"></span>` : ''}
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 min-w-0">
                                <h4 class="font-bold text-[#8f4452] text-sm truncate">${friend.nickname} <span class="text-[11px] font-normal text-[#c96a7b]">(${friend.profile.gender || '保密'})</span></h4>
                                ${canManualUnfriend ? `
                                    <button type="button" onclick="event.stopPropagation(); openManualUnfriendModal('${yuelaoEscapeHtml(friend.id)}')" title="手動解除好友（配對第二天起開放）" aria-label="解除好友 ${friend.nickname}" class="w-5 h-5 rounded-full bg-rose-50 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-200 hover:border-rose-500 flex items-center justify-center text-[11px] font-bold leading-none transition shrink-0">
                                        ✕
                                    </button>
                                ` : ''}
                                ${hasCardUnread ? `<span class="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-bold shrink-0">新訊息</span>` : ''}
                            </div>
                            <p class="text-[11px] text-gray-500 truncate">${yuelaoEscapeHtml(String(friend.sessionLabel || '七日緣分').replace(/・?強制補齊/g, '').trim() || '七日緣分')}</p>
                        </div>
                    </div>
                    <div class="flex flex-col items-end gap-1.5 shrink-0">
                        <span class="text-[11px] px-2.5 py-1 rounded-full ${remainDays === 0 ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-white text-[#c96a7b] border border-pink-200'}">
                            ${remainDays === 0 ? '⏳ 剩餘 0 天（禁止發話）' : `剩餘 ${remainDays} 天`}
                        </span>
                        ${isMockFriend ? `
                            <button type="button" onclick="event.stopPropagation(); removeMockTestFriend('${friend.id}')" title="刪除此測試好友" class="text-[11px] px-2.5 py-0.5 rounded-full bg-rose-50 border border-rose-300 text-rose-600 font-bold hover:bg-rose-100 transition">
                                🗑️ 刪除測試好友
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    workspace.classList.remove('hidden');
    renderActiveFriendWorkspace();
    updateFriendUnreadDot();
}

function removeMockTestFriend(friendId) {
    const target = appState.friends.find(f => String(f.id) === String(friendId) && String(f.id).startsWith('MOCK_FRIEND_'));
    if (!target) return;
    appState.friends = appState.friends.filter(f => String(f.id) !== String(friendId));
    if (String(appState.activeFriendId) === String(friendId)) {
        appState.activeFriendId = appState.friends[0] ? String(appState.friends[0].id) : null;
    }
    if (appState.friends.length < 2) {
        appState.multiFriendSince = null;
        appState.confessionUnlockAt = null;
    }
    Store.save(appState);
    refreshAllUI();
    showMiniNotice('🍃 已刪除測試好友', `已將測試好友「${target.nickname}」從好友名單移除。`);
}

let pendingManualUnfriendId = null;

function canManuallyUnfriendFriend(friend, nowTs = Date.now()) {
    if (!friend || !friend.id) return false;
    if (friend.igUnlocked) return true;
    const remainDays = calcRemainingDays(friend.matchedAt, nowTs);
    // 配對當天為第 1 天（remainDays === 7）；過第一個 20:00 進入第 2 天（remainDays <= 6）即開放手動解除好友
    return remainDays <= 6;
}

function openManualUnfriendModal(friendId) {
    const fid = String(friendId || '').trim();
    if (!fid) return;
    const friend = appState.friends.find(f => String(f.id) === fid);
    if (!friend) return;

    if (!canManuallyUnfriendFriend(friend, Date.now())) {
        showMiniNotice('⏳ 尚未開放解除好友', '配對後的第二天（過第一個 20:00）起，才可手動解除好友喔！');
        return;
    }

    pendingManualUnfriendId = fid;
    const textEl = document.getElementById('manualUnfriendConfirmText');
    if (textEl) {
        textEl.textContent = `確定要與「${friend.nickname}」解除好友關係嗎？`;
    }
    const modal = document.getElementById('manualUnfriendModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeManualUnfriendModal() {
    pendingManualUnfriendId = null;
    const modal = document.getElementById('manualUnfriendModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function confirmManualUnfriend() {
    const fid = String(pendingManualUnfriendId || '').trim();
    closeManualUnfriendModal();
    if (!fid) return;

    const friend = appState.friends.find(f => String(f.id) === fid);
    if (!friend) return;

    if (!canManuallyUnfriendFriend(friend, Date.now())) {
        showMiniNotice('⏳ 尚未開放解除好友', '配對後的第二天起才可手動解除好友。');
        return;
    }

    if (String(friend.id).startsWith('MOCK_FRIEND_')) {
        removeMockTestFriend(friend.id);
        return;
    }

    // 將玩家手動解除配對的操作記錄寫入「玩家操作日誌」（保留最近 30 筆）
    const myName = String(appState.profile.nickname || appState.playerId);
    const partnerName = String(friend.nickname || friend.id);
    const opDetailText = `手動解除與 ID:${friend.id} (${partnerName}) 的配對`;
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.recordPlayerOpLog === 'function') {
        CloudSync.recordPlayerOpLog(appState.playerId, myName, '解除配對', opDetailText, Date.now());
    } else {
        const opKey = (typeof PLAYER_OP_LOGS_KEY !== 'undefined') ? PLAYER_OP_LOGS_KEY : 'yuelao_player_op_logs';
        const rawLogs = localStorage.getItem(opKey) || '[]';
        let logs = [];
        try { logs = JSON.parse(rawLogs); } catch (e) { logs = []; }
        const nowTs = Date.now();
        logs.unshift({
            id: 'PO_' + nowTs + '_' + Math.random().toString(36).slice(2, 6),
            playerId: String(appState.playerId || '').trim(),
            playerName: myName,
            actionType: '解除配對',
            detail: opDetailText,
            ts: nowTs,
            createdAt: new Date(nowTs).toLocaleString('zh-TW', { hour12: false })
        });
        if (logs.length > 30) logs.length = 30;
        localStorage.setItem(opKey, JSON.stringify(logs));
    }

    clearMutualFriendship(
        friend,
        `🍃 你已與「${friend.nickname}」手動解除好友關係，雙方好友名單與聊天紀錄已同步清除。`
    );
}

function selectFriend(friendId) {
    appState.activeFriendId = String(friendId);
    resetChatVisibleBatch(true);
    Store.save(appState, false, true); // 優化：切換好友純本地化，不推雲端
    renderFriendsSection();

    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
    }
}

let lastRenderedUnlockedSignature = '';

function deterministicSortPartnerFields(items, seedStr) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    const nextRand = () => {
        h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
        return h / 4294967296;
    };
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(nextRand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getProgressiveUnlockCounts(totalCount, remainDays, isIgUnlocked) {
    if (totalCount <= 0) return { dayNum: 1, unlockedCount: 0, lockedCount: 0 };
    const dayNum = isIgUnlocked ? 3 : Math.max(1, 8 - Number(remainDays ?? 7));
    const day1Count = Math.ceil(totalCount / 2);
    const day2Count = day1Count + Math.ceil((totalCount - day1Count) / 2);

    let unlockedCount = totalCount;
    if (dayNum <= 1) {
        unlockedCount = day1Count;
    } else if (dayNum === 2) {
        unlockedCount = day2Count;
    } else {
        unlockedCount = totalCount;
    }
    unlockedCount = Math.min(totalCount, Math.max(0, unlockedCount));
    return {
        dayNum,
        unlockedCount,
        lockedCount: Math.max(0, totalCount - unlockedCount)
    };
}

const CHAT_BATCH_STEP = 30;
let chatVisibleBatchLimit = CHAT_BATCH_STEP;
let activeChatWindowFriendKey = '';
let lastObservedChatTotalCount = 0;
let wasFriendsTabVisibleLastRender = false;
let pendingPreserveScrollOnPrepend = false;
let isAutoScrollingChatBottom = false;
let lastChatPrependTriggerTs = 0;
let lastRenderedChatMeta = {
    friendKey: '',
    totalCount: 0,
    visibleCount: 0,
    firstId: '',
    lastId: '',
    hasOlderBanner: false
};

function getWishWallQaSummaryForFriend(friend) {
    if (!friend || !friend.id || !appState || !appState.playerId) return '';
    if (typeof Store === 'undefined' || typeof Store.getWishWallPosts !== 'function') return '';
    const myPid = String(appState.playerId).trim();
    const partnerPid = String(friend.id).trim();
    if (!myPid || !partnerPid) return '';

    const wishes = Store.getWishWallPosts();
    const matchedWish = wishes.find(w => {
        if (!w || !w.settled || !w.matchedResponderId) return false;
        const aId = String(w.authorId || '').trim();
        const rId = String(w.matchedResponderId || '').trim();
        return (aId === myPid && rId === partnerPid) || (aId === partnerPid && rId === myPid);
    });
    if (!matchedWish) return '';

    const responderId = String(matchedWish.matchedResponderId || '').trim();
    const chosenResp = (matchedWish.responses || []).find(r => String(r.responderId || '').trim() === responderId);
    if (!chosenResp) return '';

    if (typeof buildWishMatchSummaryText === 'function') {
        return buildWishMatchSummaryText(matchedWish, chosenResp);
    }
    const title = String(matchedWish.title || '紅線祈願牆默契問答').trim();
    const questions = Array.isArray(matchedWish.questions) ? matchedWish.questions : [];
    const answers = Array.isArray(chosenResp.answers) ? chosenResp.answers : [];
    const ansByQIdx = new Map();
    answers.forEach((a, i) => {
        if (a && typeof a === 'object') ansByQIdx.set(Number(a.qIndex || (i + 1)), a);
    });
    const qLines = questions.map((q, idx) => {
        const qNum = Number(q.qIndex || (idx + 1));
        const ans = ansByQIdx.get(qNum);
        const optCode = ans && ans.chosenOption ? String(ans.chosenOption).trim() : '';
        const optText = ans && ans.chosenText ? String(ans.chosenText).trim() : (optCode === 'A' ? (q.optionA || '') : (optCode === 'B' ? (q.optionB || '') : ''));
        return `Q${qNum}. ${String(q.question || '').trim()}\n👉 選擇答案：${optCode ? `選項 ${optCode}：${optText}` : (optText || '未作答')}`;
    });
    const lines = [`🏮【紅線祈願牆・默契問答紀錄】`, `📌 題目主題：${title}`, ...qLines];
    if (String(chosenResp.note || '').trim()) {
        lines.push(`💬 補充留言：${String(chosenResp.note).trim()}`);
    }
    return lines.join('\n');
}

function renderSingleChatBubbleHtml(m, friend) {
    if (m.senderId === 'system' || m.sender === 'system') {
        const rawText = String(m.text || '');
        const isMultiLineCard = rawText.includes('\n') || rawText.includes('【紅線祈願牆・默契問答紀錄】');
        if (isMultiLineCard) {
            return `
                <div class="my-2 px-1">
                    <div class="max-w-[92%] mx-auto px-4 py-3 rounded-2xl bg-gradient-to-br from-rose-50 via-pink-50/80 to-amber-50/60 border border-pink-200 text-xs text-[#6e3a43] leading-relaxed whitespace-pre-line break-words shadow-2xs text-left">
                        ${yuelaoEscapeHtml(rawText)}
                    </div>
                </div>
            `;
        }
        return `
            <div class="text-center my-2">
                <span class="inline-block px-3.5 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-[11px] text-[#8f4452] leading-relaxed">
                    ${yuelaoEscapeHtml(rawText)}
                </span>
            </div>
        `;
    }
    const isMe = m.senderId
        ? (String(m.senderId) === String(appState.playerId))
        : (m.sender === 'me');
    return `
        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'}">
            ${!isMe ? `<span class="text-[10px] text-[#c96a7b] font-semibold mb-0.5 px-1">${yuelaoEscapeHtml(friend.nickname)}</span>` : ''}
            <div class="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-2xs ${isMe ? 'bg-gradient-to-r from-[#e598a6] to-[#c96a7b] text-white rounded-br-xs' : 'bg-white border border-pink-100 text-gray-700 rounded-bl-xs'}">
                ${yuelaoEscapeHtml(m.text)}
            </div>
            <span class="text-[10px] text-gray-400 mt-1 px-1">${m.time || ''}</span>
        </div>
    `;
}

function resetChatVisibleBatch(scrollBottom = true) {
    chatVisibleBatchLimit = CHAT_BATCH_STEP;
    pendingPreserveScrollOnPrepend = false;
    lastRenderedChatSignature = '';
    lastRenderedChatMeta = { friendKey: '', totalCount: 0, visibleCount: 0, firstId: '', lastId: '', hasOlderBanner: false };
    if (scrollBottom) {
        shouldScrollChatToLatest = true;
    }
}

async function loadMoreOlderChatMessages() {
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend || !Array.isArray(friend.messages)) return;

    if (chatVisibleBatchLimit < friend.messages.length) {
        chatVisibleBatchLimit = Math.min(friend.messages.length, chatVisibleBatchLimit + CHAT_BATCH_STEP);
        pendingPreserveScrollOnPrepend = true;
        renderActiveFriendWorkspace();
        return;
    }

    const isRealFriend = !String(friend.id).startsWith('MOCK_FRIEND_') && Boolean(appState && appState.playerId);
    if (
        isRealFriend &&
        !friend._fetchingOlderCloud &&
        !friend._noMoreCloudHistory &&
        friend.messages.length >= CHAT_BATCH_STEP &&
        friend.messages.length < 200 &&
        typeof CloudSync !== 'undefined' &&
        typeof CloudSync.fetchActiveChatRoomNow === 'function'
    ) {
        friend._fetchingOlderCloud = true;
        const nextCloudLimit = Math.min(200, friend.messages.length + CHAT_BATCH_STEP);
        const roomPath = `${CHATS_KEY}/${ChatStore.getPairKey(appState.playerId, friend.id)}`;
        try {
            const changed = await CloudSync.fetchActiveChatRoomNow(roomPath, { limit: nextCloudLimit, force: true });
            const latestMsgs = ChatStore.getMessages(appState.playerId, friend.id);
            if (changed && latestMsgs.length > friend.messages.length) {
                friend.messages = latestMsgs;
                chatVisibleBatchLimit = Math.min(latestMsgs.length, chatVisibleBatchLimit + CHAT_BATCH_STEP);
                pendingPreserveScrollOnPrepend = true;
                renderActiveFriendWorkspace();
            } else {
                friend._noMoreCloudHistory = true;
                renderActiveFriendWorkspace();
            }
        } finally {
            friend._fetchingOlderCloud = false;
        }
    }
}

function ensureChatBoxScrollPagination(chatBox) {
    if (!chatBox || chatBox.dataset.scrollPaginationBound === '1') return;
    chatBox.dataset.scrollPaginationBound = '1';

    chatBox.addEventListener('scroll', () => {
        if (isAutoScrollingChatBottom || shouldScrollChatToLatest) return;
        if (chatBox.scrollTop > 24) return;

        const now = Date.now();
        if (now - lastChatPrependTriggerTs < 250) return;

        const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
        if (!friend || !Array.isArray(friend.messages)) return;
        const canFetchMoreCloud = (
            !String(friend.id).startsWith('MOCK_FRIEND_') &&
            Boolean(appState && appState.playerId) &&
            !friend._fetchingOlderCloud &&
            !friend._noMoreCloudHistory &&
            friend.messages.length >= CHAT_BATCH_STEP &&
            friend.messages.length < 200
        );
        if (chatVisibleBatchLimit >= friend.messages.length && !canFetchMoreCloud) return;

        lastChatPrependTriggerTs = now;
        loadMoreOlderChatMessages();
    }, { passive: true });
}

function renderActiveFriendWorkspace() {
    // 方案 C：僅在「好友清單」分頁開啟時，對目前開啟的單一聊天室建立即時 SSE；離開該分頁時關閉以節省連線
    if (typeof CloudSync !== 'undefined' && CloudSync.isPlayerSyncMode && CloudSync.isPlayerSyncMode()) {
        const friendsTabEl = document.getElementById('tab-friends');
        const isFriendsTabVisible = Boolean(friendsTabEl && !friendsTabEl.classList.contains('hidden'));
        if (!isFriendsTabVisible) {
            CloudSync.closeActiveChatRoom();
        } else {
            const activeId = appState && appState.activeFriendId ? String(appState.activeFriendId) : '';
            CloudSync.setActiveChatRoom(activeId && appState.playerId
                ? `${CHATS_KEY}/${ChatStore.getPairKey(appState.playerId, activeId)}`
                : '');
        }
    }
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    document.getElementById('partnerCardName').textContent = `🌸 ${friend.nickname} 的開放檔案`;
    document.getElementById('chatHeaderTitle').textContent = `與 ${friend.nickname} 的戀愛對話窗`;

    const remainDays = calcRemainingDays(friend.matchedAt, Date.now());
    document.getElementById('partnerCardTimer').textContent = remainDays === 0
        ? '⚠️ 剩餘 0 天！聊天室已禁止發話，請決定要不要繼續配對'
        : `⏳ 剩餘 ${remainDays} 天（每天 20:00 自動 -1 天）`;

    const unlockedBox = document.getElementById('partnerUnlockedFields');
    const openFieldItems = [];
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.key === 'nickname') return;
            const isVisible = f.alwaysOpen || (f.autoOpenAfter7Days ? Boolean(friend.igUnlocked) : (friend.privacy && friend.privacy[f.key] === 'open'));
            const val = friend.profile[f.key];
            if (isVisible && val && (!Array.isArray(val) || val.length > 0)) {
                let displayVal = val;
                if (f.key === 'city' && friend.profile.region) {
                    displayVal = `${friend.profile.region} ・ ${val}`;
                } else if (f.key === 'hasPet' && val && val !== '沒有養寵物' && val !== '有養寵物') {
                    displayVal = `有養寵物（${val}）`;
                } else if (Array.isArray(val)) {
                    const otherTxt = friend.profile[`${f.key}Other`];
                    displayVal = val.map(v => (v === '其他' && otherTxt) ? `其他（${otherTxt}）` : v).join('、');
                } else if (f.allowOther && val === '其他' && friend.profile[`${f.key}Other`]) {
                    displayVal = `其他（${friend.profile[`${f.key}Other`]}）`;
                }
                openFieldItems.push({
                    key: f.key,
                    label: f.label.split('（')[0],
                    required: Boolean(f.required),
                    displayVal: String(displayVal)
                });
            }
        });
    });

    const pairSeed = [String(appState.playerId || 'guest'), String(friend.id)].sort().join('_');
    const orderedItems = deterministicSortPartnerFields(openFieldItems, pairSeed);
    const totalOpen = orderedItems.length;
    const { dayNum, unlockedCount, lockedCount } = getProgressiveUnlockCounts(totalOpen, remainDays, Boolean(friend.igUnlocked));

    let unlockedHtml = '';
    if (totalOpen > 0) {
        const displayDayLabel = dayNum >= 3 ? '第 3 天以上（已全部解鎖）' : `第 ${dayNum} 天`;
        const progressBadgeHtml = lockedCount > 0
            ? `<div class="p-3 rounded-xl bg-gradient-to-r from-pink-50 to-rose-50 border border-pink-200 space-y-1 text-xs leading-relaxed">
                    <div class="font-bold text-[#8f4452]">📅 ${displayDayLabel}・逐步解鎖中</div>
                    <div class="font-semibold text-[#c96a7b]">已顯示 ${unlockedCount} / ${totalOpen} 個欄位</div>
                    <div class="font-semibold text-[#c96a7b]">（${lockedCount} 個待明日顯示）</div>
               </div>`
            : `<div class="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1 text-xs leading-relaxed">
                    <div class="font-bold text-emerald-800">✨ ${displayDayLabel}</div>
                    <div class="font-semibold text-emerald-700">已顯示全部 ${totalOpen} 個開放欄位</div>
               </div>`;

        const revealedCardsHtml = orderedItems.slice(0, unlockedCount).map(item => `
            <div class="p-2.5 rounded-xl bg-white border border-pink-100">
                <span class="text-[11px] text-[#c96a7b] block">${item.label}${item.required ? ' <span class="text-rose-500">*</span>' : ''}</span>
                <span class="font-medium text-gray-700">${item.displayVal}</span>
            </div>
        `).join('');

        const pendingCardsHtml = orderedItems.slice(unlockedCount).map(item => `
            <div class="p-2.5 rounded-xl bg-pink-50/45 border border-dashed border-pink-200 space-y-1">
                <span class="text-[11px] text-[#c96a7b] font-medium block">${item.label}${item.required ? ' <span class="text-rose-500">*</span>' : ''}</span>
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs text-gray-400 font-medium">內容：待明日顯示</span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-white text-[#c96a7b] border border-pink-200 font-semibold shrink-0">🔒 明日解鎖</span>
                </div>
            </div>
        `).join('');

        unlockedHtml = progressBadgeHtml + revealedCardsHtml + pendingCardsHtml;
    }

    const nextUnlockedSig = `${friend.id}_${remainDays}_${friend.igUnlocked ? 1 : 0}_${unlockedHtml}`;
    if (nextUnlockedSig !== lastRenderedUnlockedSignature) {
        lastRenderedUnlockedSignature = nextUnlockedSig;
        unlockedBox.innerHTML = unlockedHtml || `
            <div class="text-center py-6 text-gray-400">
                對方目前尚未開啟其他進階資料欄位，<br>先從聊天室打聲招呼吧！
            </div>
        `;
    }

    const isChatBanned = Boolean(appState.isChatBanned);
    const pendingChoice = isEveningConfessionPending();
    const isZeroDays = remainDays === 0;
    const chatBannedBanner = document.getElementById('chatBannedBanner');
    const lockBanner = document.getElementById('confessionLockBanner');
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');

    if (isChatBanned) {
        if (chatBannedBanner) chatBannedBanner.classList.remove('hidden');
        if (lockBanner) lockBanner.classList.add('hidden');
        if (chatInput) {
            chatInput.disabled = true;
            chatInput.value = '';
            chatInput.placeholder = '🚫 請聯繫管理員';
            chatInput.classList.add('!bg-gray-100', '!text-gray-400');
        }
        if (chatSendBtn) chatSendBtn.disabled = true;
    } else if (pendingChoice) {
        if (chatBannedBanner) chatBannedBanner.classList.add('hidden');
        if (lockBanner) lockBanner.classList.remove('hidden');
        if (chatInput) {
            chatInput.disabled = true;
            chatInput.value = '';
            chatInput.placeholder = '🔒 請先完成 20:00 心動抉擇才能聊天...';
            chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        }
        if (chatSendBtn) chatSendBtn.disabled = true;
    } else if (isZeroDays) {
        if (chatBannedBanner) chatBannedBanner.classList.add('hidden');
        if (lockBanner) lockBanner.classList.add('hidden');
        if (chatInput) {
            chatInput.disabled = true;
            chatInput.value = '';
            chatInput.placeholder = '🚫 剩餘 0 天，聊天室已禁止發話（請先選擇是否繼續配對）';
            chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        }
        if (chatSendBtn) chatSendBtn.disabled = true;
    } else {
        if (chatBannedBanner) chatBannedBanner.classList.add('hidden');
        if (lockBanner) lockBanner.classList.add('hidden');
        if (chatInput) {
            chatInput.disabled = false;
            chatInput.placeholder = '寫下想對他說的話...';
            chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        }
        if (chatSendBtn) chatSendBtn.disabled = false;
    }
    updateRandomTopicButtonState();

    const banner = document.getElementById('sevenDayDecisionBanner');
    const statusText = document.getElementById('sevenDayDecisionStatus');
    if (isZeroDays) {
        banner.classList.remove('hidden');
        if (friend.myContinue === true && friend.partnerContinue !== true) {
            statusText.innerHTML = `💖 你已按下「繼續配對」，聊天室仍暫停發話，正在等待 <strong>${yuelaoEscapeHtml(friend.nickname)}</strong> 按下繼續（雙方都按下後將再延後 7 天並重新開放聊天）...`;
        } else if (friend.partnerContinue === true && friend.myContinue !== true) {
            statusText.innerHTML = `💌 <strong>${yuelaoEscapeHtml(friend.nickname)}</strong> 已經按下「繼續配對」！只要你也按下「繼續配對」，雙方將再延後 7 天並繼續聊天！`;
        } else {
            statusText.textContent = '目前聊天室已暫停發話；兩個人都按「繼續配對」即可再延後 7 天並繼續聊天，其中一人放棄則兩邊好友名單清空刪除。';
        }
    } else {
        banner.classList.add('hidden');
    }

    const isRealFriend = !String(friend.id).startsWith('MOCK_FRIEND_') && !!appState.playerId;
    if (isRealFriend) {
        const sharedMsgs = ChatStore.getMessages(appState.playerId, friend.id);
        if (sharedMsgs.length > 0) {
            friend.messages = sharedMsgs;
        }
    }

    const chatBox = document.getElementById('chatMessagesBox');
    ensureChatBoxScrollPagination(chatBox);
    const friendsTabEl = document.getElementById('tab-friends');
    const isFriendsTabVisible = Boolean(friendsTabEl && !friendsTabEl.classList.contains('hidden'));

    const currentFriendKey = `${appState.playerId || ''}_${friend.id}`;
    const totalMsgCount = friend.messages.length;

    if (currentFriendKey !== activeChatWindowFriendKey) {
        activeChatWindowFriendKey = currentFriendKey;
        chatVisibleBatchLimit = CHAT_BATCH_STEP;
        lastObservedChatTotalCount = totalMsgCount;
        shouldScrollChatToLatest = true;
    } else if (isFriendsTabVisible && !wasFriendsTabVisibleLastRender) {
        // 重新切回好友分頁時，恢復只顯示最新近 30 則訊息
        chatVisibleBatchLimit = CHAT_BATCH_STEP;
        lastObservedChatTotalCount = totalMsgCount;
        shouldScrollChatToLatest = true;
    } else if (totalMsgCount > lastObservedChatTotalCount && chatVisibleBatchLimit > CHAT_BATCH_STEP && !shouldScrollChatToLatest) {
        // 正在往上瀏覽歷史訊息時若收到新訊息，保持上方閱讀位置不偏移
        chatVisibleBatchLimit += (totalMsgCount - lastObservedChatTotalCount);
    }
    wasFriendsTabVisibleLastRender = isFriendsTabVisible;
    lastObservedChatTotalCount = totalMsgCount;

    const effectiveVisibleCount = Math.min(totalMsgCount, Math.max(CHAT_BATCH_STEP, chatVisibleBatchLimit));
    const visibleMessages = effectiveVisibleCount < totalMsgCount
        ? friend.messages.slice(-effectiveVisibleCount)
        : friend.messages;
    const remainingOlderCount = Math.max(0, totalMsgCount - visibleMessages.length);

    const lastMsgObj = visibleMessages[visibleMessages.length - 1];
    const firstMsgObj = visibleMessages[0];
    const firstMsgKey = String(firstMsgObj?.id || firstMsgObj?.ts || '');
    const lastMsgKey = String(lastMsgObj?.id || lastMsgObj?.text || '');
    const hasOlderBanner = remainingOlderCount > 0 || totalMsgCount > CHAT_BATCH_STEP;
    const currentSignature = `${currentFriendKey}_${totalMsgCount}_${visibleMessages.length}_${firstMsgKey}_${lastMsgKey}`;

    if (currentSignature !== lastRenderedChatSignature) {
        const prevScrollTop = chatBox.scrollTop;
        const prevScrollHeight = chatBox.scrollHeight;
        const isPrependingOlder = pendingPreserveScrollOnPrepend;
        pendingPreserveScrollOnPrepend = false;

        const canAppendSingleBubble = Boolean(
            lastMsgObj &&
            !isPrependingOlder &&
            lastRenderedChatMeta.friendKey === currentFriendKey &&
            lastRenderedChatMeta.totalCount > 0 &&
            totalMsgCount === lastRenderedChatMeta.totalCount + 1 &&
            visibleMessages.length === lastRenderedChatMeta.visibleCount + 1 &&
            firstMsgKey === lastRenderedChatMeta.firstId &&
            hasOlderBanner === lastRenderedChatMeta.hasOlderBanner &&
            chatBox.children.length > 0
        );

        lastRenderedChatSignature = currentSignature;
        lastRenderedChatMeta = {
            friendKey: currentFriendKey,
            totalCount: totalMsgCount,
            visibleCount: visibleMessages.length,
            firstId: firstMsgKey,
            lastId: lastMsgKey,
            hasOlderBanner
        };

        if (canAppendSingleBubble) {
            chatBox.insertAdjacentHTML('beforeend', renderSingleChatBubbleHtml(lastMsgObj, friend));
        } else {
            const canLoadMoreCloudOlder = Boolean(
                isRealFriend &&
                !friend._noMoreCloudHistory &&
                totalMsgCount >= CHAT_BATCH_STEP &&
                totalMsgCount < 200
            );
            let topStatusHtml = '';
            if (remainingOlderCount > 0) {
                const nextLoadCount = Math.min(CHAT_BATCH_STEP, remainingOlderCount);
                topStatusHtml = `
                    <div class="text-center pb-1">
                        <button type="button" onclick="loadMoreOlderChatMessages()" class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white border border-pink-200 text-[11px] text-[#8f4452] font-semibold hover:bg-pink-50 transition shadow-2xs">
                            <span>⬆️ 往上滑動或點擊載入更早 ${nextLoadCount} 則（還有 ${remainingOlderCount} 則）</span>
                        </button>
                    </div>
                `;
            } else if (canLoadMoreCloudOlder) {
                topStatusHtml = `
                    <div class="text-center pb-1">
                        <button type="button" onclick="loadMoreOlderChatMessages()" class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white border border-pink-200 text-[11px] text-[#8f4452] font-semibold hover:bg-pink-50 transition shadow-2xs">
                            <span>⬆️ 往上滑動或點擊載入更早 ${CHAT_BATCH_STEP} 則歷史訊息</span>
                        </button>
                    </div>
                `;
            } else if (totalMsgCount > CHAT_BATCH_STEP || friend._noMoreCloudHistory) {
                topStatusHtml = `
                    <div class="text-center pb-1">
                        <span class="inline-block px-3 py-0.5 rounded-full bg-pink-50/80 text-[10px] text-gray-400">
                            🌸 已顯示全部 ${totalMsgCount} 則對話紀錄
                        </span>
                    </div>
                `;
            }

            const hasVisibleWishQa = visibleMessages.some(m => String((m && m.text) || '').includes('【紅線祈願牆・默契問答紀錄】'));
            let wishQaBannerHtml = '';
            if (!hasVisibleWishQa) {
                const wishQaText = getWishWallQaSummaryForFriend(friend);
                if (wishQaText) {
                    wishQaBannerHtml = `
                        <div class="my-1.5 px-1">
                            <div class="max-w-[92%] mx-auto px-4 py-3 rounded-2xl bg-gradient-to-br from-rose-50 via-pink-50/80 to-amber-50/60 border border-pink-200 text-xs text-[#6e3a43] leading-relaxed whitespace-pre-line break-words shadow-2xs text-left">
                                ${yuelaoEscapeHtml(wishQaText)}
                            </div>
                        </div>
                    `;
                }
            }

            const bubblesHtml = visibleMessages.map(m => renderSingleChatBubbleHtml(m, friend)).join('');
            chatBox.innerHTML = topStatusHtml + wishQaBannerHtml + bubblesHtml;
        }

        if (!shouldScrollChatToLatest) {
            if (isPrependingOlder) {
                const newScrollHeight = chatBox.scrollHeight;
                chatBox.scrollTop = Math.max(28, prevScrollTop + (newScrollHeight - prevScrollHeight));
            } else {
                chatBox.scrollTop = prevScrollTop;
            }
        }
    }

    if (isFriendsTabVisible) {
        markFriendChatAsRead(friend);
        updateFriendUnreadDot();
    }

    if (isFriendsTabVisible && shouldScrollChatToLatest) {
        shouldScrollChatToLatest = false;
        isAutoScrollingChatBottom = true;
        const scrollToLatest = () => {
            chatBox.scrollTop = chatBox.scrollHeight;
        };
        scrollToLatest();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(scrollToLatest);
        }
        setTimeout(() => {
            scrollToLatest();
            isAutoScrollingChatBottom = false;
        }, 60);
    }
}

// ==================== 🎲 月老互動題目（感情 / 生活 各 30 題單身認識話題，5 秒冷卻） ====================
const LOVE_INTERACTIVE_TOPICS = [
    '第一次見面時，對方哪個小細節最容易吸引你的注意？（例如：笑容、眼神、談吐還是穿搭？）',
    '在感情裡，你比較偏向「一見鍾情派」還是「慢慢相處、日久生情派」呢？',
    '你心目中最理想的「第一次約會行程」會是什麼樣子？（喝咖啡散步、看電影吃飯還是逛市集？）',
    '在認識新對象的階段，你通常會主動開啟話題，還是先觀察對方、慢慢熟起來？',
    '談戀愛時，你比較是「每天都想分享生活大小事」還是「各自保有適當空間」的人？',
    '對你來說，另一半做過或具備什麼特質，會讓你瞬間覺得「這個人好加分」？',
    '你相信「互補的兩個人」比較適合，還是「三觀與個性相似」走得更長久？',
    '在感情中，對你而言最有「安全感」的相處模式是什麼樣子？',
    '如果兩個人意見不同或有小摩擦，你比較習慣當下溝通清楚，還是先冷靜一下再好好聊？',
    '你喜歡和另一半有共同的興趣嗜好，還是各自有不同領域可以互相帶對方體驗？',
    '在一段感情裡，你覺得「儀式感」重要嗎？哪種小儀式會讓你覺得特別暖心？',
    '戀愛二選一：下雨天在家一起煮飯追劇 vs 撐傘去逛夜市吃小吃，你會選哪一個？',
    '你比較喜歡「照顧對方、替對方安排好行程」，還是「被對方偏愛、偶爾依賴一下」？',
    '如果晚上下班心情有點累，你希望喜歡的人「安靜陪在身邊」還是「講笑話帶你去吃好吃的」？',
    '你覺得兩個人在一起後，最幸福、最療癒的日常畫面是什麼？',
    '在感情裡，如果對方工作很忙回訊息比較慢，你通常會怎麼調適或溝通？',
    '如果要在第一次見面挑一間餐廳，你會偏好安靜好聊天的咖啡廳，還是輕鬆熱鬧的餐酒館／燒肉？',
    '你覺得一段健康的感情裡，彼此最不能缺少的三個元素是什麼？',
    '單身這段期間，你在感情觀上有沒有什麼新的體悟，或更確定自己想要什麼樣的伴侶？',
    '你理想中的另一半，在朋友面前和在你面前會有反差萌嗎？你喜歡哪一種反差？',
    '紀念日或彼此生日時，你比較喜歡手寫卡片、實用小禮物，還是一起去吃頓好料？',
    '如果有機會和未來另一半一起規劃三天兩夜的小旅行，你最想去國內或國外的哪裡？',
    '在感情中，你最在意或最無法接受的相處地雷是什麼？',
    '如果可以用三個關鍵字形容「談戀愛時的自己」，你會選哪三個詞？',
    '你睡前習慣和另一半小聊幾句今天發生的事、互道晚安再睡嗎？',
    '對你來說，從「剛認識的朋友」升溫成「心動對象」最關鍵的瞬間是什麼？',
    '你比較嚮往「像好朋友一樣無話不談的戀愛」，還是「帶點浪漫驚喜感的戀愛」？',
    '如果這週末我們約出來見面聊天，你第一眼最希望給對方留下什麼樣的印象？',
    '你覺得各自忙碌時，兩個人要靠什麼小習慣來維持感情的溫度？',
    '如果今天月老送你一張「戀愛許願券」，你最希望在下一段感情裡實現什麼心願？'
];

const LIFE_INTERACTIVE_TOPICS = [
    '放假沒有安排出門的時候，你最常在家怎麼度過一整天？（追劇、補眠、打電動還是看書？）',
    '下班或下課後，你最喜歡做什麼事情來幫自己充電、轉換心情？',
    '你平常是「早睡早起晨型人」還是「越晚精神越好的夜貓子」？',
    '說到美食，你最近吃到最念念不忘的一道料理或餐廳是什麼？',
    '你是「咖啡派」、「手搖飲派」還是「無糖茶／白開水派」？平常最常點哪一杯？',
    '如果突然多出一天不用上班上課的自由假期，你最想立刻去哪裡走走？',
    '旅遊時，你是「事前把行程排得滿滿的規劃控」，還是「睡到自然醒、走到哪逛到哪的隨性派」？',
    '你平常有運動的習慣嗎？最喜歡哪一種運動或戶外活動？（散步、健身、羽球、爬山等）',
    '最近有沒有哪一部電影、影集或動漫讓你一看再看，或想推薦給新朋友？',
    '你平常喜歡聽哪一類型的音樂？有沒有最近一直在單曲循環的一首歌？',
    '你比較喜歡「海邊看海吹風」還是「山上走走吸芬多精」？為什麼呢？',
    '在生活裡，有什麼小習慣或小堅持是認識你之後一定會發現的？',
    '你是「貓派」、「狗派」，還是喜歡其他小動物？如果可以養寵物最想養什麼？',
    '平常三餐你比較常自己下廚料理，還是外食探店居多？拿手菜或最愛吃的是什麼？',
    '逛街或網購時，哪一類東西最容易讓你忍不住下手？（美食、3C、衣服香氛還是居家小物？）',
    '在朋友眼裡，大家通常怎麼形容你的個性？跟你自己覺得的個性一樣嗎？',
    '休假出門時，你比較喜歡熱鬧好逛的市區百貨，還是安靜有特色的小巷咖啡廳？',
    '你覺得自己是一個「說走就走的行動派」，還是「會先在心裡想很多再出發」的人？',
    '一年四季（春、夏、秋、冬）裡面，你最喜歡哪一個季節？最喜歡那個季節的什麼氛圍？',
    '如果週末下午要選一個放鬆活動，你會選「去按摩／泡湯」、「逛展覽／書店」還是「約朋友吃下午茶」？',
    '你目前最想嘗試或正在學習的一項新興趣／新技能是什麼？',
    '生活壓力大的時候，你通常會用什麼方式讓自己快速恢復好心情？',
    '你平常喜歡拍照記錄生活嗎？手機相簿裡最多的是風景、美食、寵物還是自拍？',
    '宵夜時間如果肚子餓了，你最無法抗拒的罪惡美食是哪一樣？（鹹酥雞、泡麵、滷味還是甜點？）',
    '在台灣的縣市裡，除了目前居住的地方，你最喜歡哪一座城市的生活步調？',
    '你覺得自己比較是「熱鬧聚會會很開心」的人，還是「一對一深度聊天更自在」的人？',
    '如果可以擁有一個超能力來讓日常生活更方便，你最想要哪一種超能力？',
    '最近生活中有沒有發生什麼雖然很小、但讓你開心了一整天的幸運小事？',
    '你心目中理想的日常生活節奏是什麼樣子？（例如：忙碌充實、慢活愜意，還是工作與旅行並重？）',
    '如果我們有機會一起去探索美食或踩點，你會想先從哪一類餐廳或景點開始？'
];

const INTERACTIVE_TOPICS_BY_CATEGORY = {
    love: { label: '感情', topics: LOVE_INTERACTIVE_TOPICS },
    life: { label: '生活', topics: LIFE_INTERACTIVE_TOPICS }
};

const RANDOM_TOPIC_COOLDOWN_MS = 5000;
let randomTopicCooldownUntil = 0;
let randomTopicCooldownTimer = null;
const recentRandomTopicIndicesByCategory = {
    love: [],
    life: []
};
let selectedRandomTopicCategory = '';

function pickNextLoveInteractiveTopic(category = 'love') {
    const catKey = Object.prototype.hasOwnProperty.call(INTERACTIVE_TOPICS_BY_CATEGORY, category) ? category : 'love';
    const topics = INTERACTIVE_TOPICS_BY_CATEGORY[catKey].topics;
    const total = topics.length;
    if (total === 0) return '';
    const historyArr = recentRandomTopicIndicesByCategory[catKey];
    const maxHistory = Math.min(20, total - 1);
    const candidates = [];
    for (let i = 0; i < total; i++) {
        if (!historyArr.includes(i)) {
            candidates.push(i);
        }
    }
    const pool = candidates.length > 0 ? candidates : Array.from({ length: total }, (_, i) => i);
    const chosenIdx = pool[Math.floor(Math.random() * pool.length)];
    historyArr.push(chosenIdx);
    while (historyArr.length > maxHistory) {
        historyArr.shift();
    }
    return topics[chosenIdx] || '';
}

function updateRandomTopicButtonState() {
    const btn = document.getElementById('randomTopicBtn');
    if (!btn) return;

    const friend = (typeof appState !== 'undefined' && appState && Array.isArray(appState.friends))
        ? appState.friends.find(f => String(f.id) === String(appState.activeFriendId))
        : null;
    const isLocked = Boolean(
        !friend ||
        (appState && appState.isChatBanned) ||
        (typeof isEveningConfessionPending === 'function' && isEveningConfessionPending()) ||
        (typeof calcRemainingDays === 'function' && calcRemainingDays(friend.matchedAt, Date.now()) === 0)
    );

    if (isLocked) {
        btn.disabled = true;
        btn.textContent = '🎲 互動';
        return;
    }

    const remainMs = randomTopicCooldownUntil - Date.now();
    if (remainMs > 0) {
        const remainSec = Math.max(1, Math.ceil(remainMs / 1000));
        btn.disabled = true;
        btn.textContent = `⏳ 互動 (${remainSec}s)`;
    } else {
        btn.disabled = false;
        btn.textContent = '🎲 互動';
        if (randomTopicCooldownTimer) {
            clearInterval(randomTopicCooldownTimer);
            randomTopicCooldownTimer = null;
        }
    }
}

function startRandomTopicCooldown() {
    randomTopicCooldownUntil = Date.now() + RANDOM_TOPIC_COOLDOWN_MS;
    updateRandomTopicButtonState();
    if (randomTopicCooldownTimer) {
        clearInterval(randomTopicCooldownTimer);
    }
    randomTopicCooldownTimer = setInterval(() => {
        updateRandomTopicButtonState();
    }, 250);
}

function syncRandomTopicModalSelectionUI() {
    const confirmBtn = document.getElementById('confirmRandomTopicBtn');
    const hintEl = document.getElementById('randomTopicSelectHint');
    const hasSelection = Boolean(selectedRandomTopicCategory);

    ['love', 'life'].forEach(cat => {
        const cardEl = document.getElementById(`randomTopicCard_${cat}`);
        const radioEl = document.getElementById(`randomTopicRadio_${cat}`);
        const isSelected = selectedRandomTopicCategory === cat;
        if (radioEl) {
            radioEl.checked = isSelected;
        }
        if (cardEl) {
            if (isSelected) {
                cardEl.classList.remove('border-pink-200', 'bg-white');
                cardEl.classList.add('border-[#c96a7b]', 'bg-pink-50/80', 'shadow-sm');
            } else {
                cardEl.classList.remove('border-[#c96a7b]', 'bg-pink-50/80', 'shadow-sm');
                cardEl.classList.add('border-pink-200', 'bg-white');
            }
        }
    });

    if (confirmBtn) {
        confirmBtn.classList.toggle('opacity-60', !hasSelection);
    }
    if (hintEl && hasSelection) {
        hintEl.classList.add('hidden');
    }
}

function selectRandomTopicCategory(category) {
    if (category !== 'love' && category !== 'life') return;
    selectedRandomTopicCategory = category;
    syncRandomTopicModalSelectionUI();
}

function selectRandomTopicModeOption() {
    selectRandomTopicCategory('love');
}

function openRandomTopicModal() {
    if (appState.isChatBanned) {
        showMiniNotice('🚫 禁止發話', '請聯繫管理員');
        return;
    }
    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
        return;
    }
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    if (calcRemainingDays(friend.matchedAt, Date.now()) === 0) {
        showMiniNotice('🚫 聊天室已禁止發話', '剩餘 0 天！請先決定是否繼續配對，雙方都按下繼續後才會重新開放聊天。');
        return;
    }

    if (Date.now() < randomTopicCooldownUntil) {
        updateRandomTopicButtonState();
        return;
    }

    selectedRandomTopicCategory = '';
    const hintEl = document.getElementById('randomTopicSelectHint');
    if (hintEl) hintEl.classList.add('hidden');
    syncRandomTopicModalSelectionUI();

    const modal = document.getElementById('randomTopicModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeRandomTopicModal() {
    const modal = document.getElementById('randomTopicModal');
    if (modal) modal.classList.add('hidden');
}

function confirmSendRandomLoveTopic() {
    if (selectedRandomTopicCategory !== 'love' && selectedRandomTopicCategory !== 'life') {
        const hintEl = document.getElementById('randomTopicSelectHint');
        if (hintEl) hintEl.classList.remove('hidden');
        return;
    }

    if (appState.isChatBanned) {
        closeRandomTopicModal();
        showMiniNotice('🚫 禁止發話', '請聯繫管理員');
        return;
    }
    if (isEveningConfessionPending()) {
        closeRandomTopicModal();
        openEveningConfessionModal();
        return;
    }
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) {
        closeRandomTopicModal();
        return;
    }

    if (calcRemainingDays(friend.matchedAt, Date.now()) === 0) {
        closeRandomTopicModal();
        showMiniNotice('🚫 聊天室已禁止發話', '剩餘 0 天！請先決定是否繼續配對，雙方都按下繼續後才會重新開放聊天。');
        return;
    }

    if (Date.now() < randomTopicCooldownUntil) {
        closeRandomTopicModal();
        updateRandomTopicButtonState();
        return;
    }

    const catMeta = INTERACTIVE_TOPICS_BY_CATEGORY[selectedRandomTopicCategory];
    const question = pickNextLoveInteractiveTopic(selectedRandomTopicCategory);
    if (!question || !catMeta) {
        closeRandomTopicModal();
        return;
    }

    const topicMessageText = `🎲【月老互動・${catMeta.label}】${question}`;
    const nowStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const isMockFriend = String(friend.id).startsWith('MOCK_FRIEND_') || !appState.playerId;

    closeRandomTopicModal();
    startRandomTopicCooldown();

    if (!isMockFriend) {
        const updatedMsgs = ChatStore.appendMessage(appState.playerId, friend.id, {
            senderId: String(appState.playerId),
            senderName: appState.profile.nickname || String(appState.playerId),
            text: topicMessageText,
            time: nowStr
        });
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
        friend.messages = updatedMsgs;
        shouldScrollChatToLatest = true;
        Store.save(appState);
        renderActiveFriendWorkspace();
    } else {
        friend.messages.push({ sender: 'me', text: topicMessageText, time: nowStr });
        shouldScrollChatToLatest = true;
        Store.save(appState);
        renderActiveFriendWorkspace();

        setTimeout(() => {
            friend.messages.push({
                sender: 'partner',
                text: `這題好有意思！讓我想一下怎麼回答你 🌸`,
                time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
            });
            Store.save(appState);
            renderActiveFriendWorkspace();
        }, 900);
    }
}

function handleLockedChatClick() {
    if (appState.isChatBanned) {
        showMiniNotice('🚫 禁止發話', '請聯繫管理員');
        return;
    }
    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
        return;
    }
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (friend && calcRemainingDays(friend.matchedAt, Date.now()) === 0) {
        showMiniNotice('🚫 聊天室已禁止發話', '目前好友剩餘 0 天，請先在上方選擇「繼續配對」或「不繼續」。');
    }
}

document.getElementById('chatSendForm').addEventListener('submit', function(e) {
    e.preventDefault();

    if (appState.isChatBanned) {
        showMiniNotice('🚫 禁止發話', '請聯繫管理員');
        return;
    }

    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
        return;
    }

    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    if (calcRemainingDays(friend.matchedAt, Date.now()) === 0) {
        showMiniNotice('🚫 聊天室已禁止發話', '剩餘 0 天！請先決定是否繼續配對，雙方都按下繼續後才會重新開放聊天。');
        return;
    }

    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const nowStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const isMockFriend = String(friend.id).startsWith('MOCK_FRIEND_') || !appState.playerId;

    if (!isMockFriend) {
        const updatedMsgs = ChatStore.appendMessage(appState.playerId, friend.id, {
            senderId: String(appState.playerId),
            senderName: appState.profile.nickname || String(appState.playerId),
            text,
            time: nowStr
        });
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
        friend.messages = updatedMsgs;
        input.value = '';
        shouldScrollChatToLatest = true;
        Store.save(appState, false, true); // 優化：發送訊息與個資儲存解耦，不推雲端
        renderActiveFriendWorkspace();
    } else {
        friend.messages.push({ sender: 'me', text, time: nowStr });
        input.value = '';
        shouldScrollChatToLatest = true;
        Store.save(appState);
        renderActiveFriendWorkspace();

        setTimeout(() => {
            friend.messages.push({
                sender: 'partner',
                text: `收到你的訊息了！很高興在月老七日計畫認識你 🌸`,
                time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
            });
            Store.save(appState);
            renderActiveFriendWorkspace();
        }, 900);
    }
});

async function recordMutualContinueVote(myId, partnerId, voterNickname, isSimulatedPartner = false) {
    const idA = String(myId);
    const idB = String(partnerId);
    const voterId = isSimulatedPartner ? idB : idA;

    let userA = null;
    let userB = null;

    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        const [resA, resB] = await Promise.all([
            CloudSync.getNodeOnce(`${USERS_KEY}/${idA}`),
            CloudSync.getNodeOnce(`${USERS_KEY}/${idB}`)
        ]);
        if (resA && typeof resA === 'object') userA = { ...resA, id: idA };
        if (resB && typeof resB === 'object') userB = { ...resB, id: idB };
    }

    if (!userA || !userB) {
        const users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
        if (!userA) userA = users.find(u => String(u.id) === idA);
        if (!userB) userB = users.find(u => String(u.id) === idB);
    }
    if (!userA || !userB) return false;

    const getOrCreateHistItem = (owner, other) => {
        if (!Array.isArray(owner.matchedHistory)) owner.matchedHistory = [];
        let item = owner.matchedHistory.find(h => String(h.partnerId) === String(other.id));
        if (!item) {
            item = {
                session: owner.matchedSession || `第 ${getCurrentBatchNumber()} 屆`,
                partnerId: String(other.id),
                partnerName: other.nickname || '',
                matchedAt: owner.matchedAt || Date.now(),
                continueVotes: []
            };
            owner.matchedHistory.push(item);
        }
        if (!Array.isArray(item.continueVotes)) item.continueVotes = [];
        return item;
    };

    const itemA = getOrCreateHistItem(userA, userB);
    const itemB = getOrCreateHistItem(userB, userA);

    const voteSet = new Set([
        ...itemA.continueVotes.map(String),
        ...itemB.continueVotes.map(String),
        voterId
    ]);

    const bothAgreed = voteSet.has(idA) && voteSet.has(idB);

    if (bothAgreed) {
        const extendedMatchedAt = Date.now();
        itemA.matchedAt = extendedMatchedAt;
        itemB.matchedAt = extendedMatchedAt;
        itemA.igUnlocked = true;
        itemB.igUnlocked = true;
        itemA.continueVotes = [];
        itemB.continueVotes = [];

        if (String(userA.matchedWithId) === idB) userA.matchedAt = extendedMatchedAt;
        if (String(userB.matchedWithId) === idA) userB.matchedAt = extendedMatchedAt;

        if (typeof CloudSync !== 'undefined') {
            await Promise.all([
                CloudSync.upsertUser(userA, true, { isMatchMutation: true }),
                CloudSync.upsertUser(userB, true, { isMatchMutation: true })
            ]);
        }

        const sysText = `🌸 雙方皆按下「繼續配對」成為好友！緣分已再延後 7 天（剩餘 7 天），聊天室已重新開放並自動解鎖彼此 IG 帳號，可以繼續聊天囉！`;
        const updatedMsgs = ChatStore.appendMessage(idA, idB, { senderId: 'system', text: sysText });
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';

        if (String(appState.playerId) === idA) {
            const fObj = appState.friends.find(f => String(f.id) === idB);
            if (fObj) {
                fObj.matchedAt = extendedMatchedAt;
                fObj.igUnlocked = true;
                fObj.myContinue = false;
                fObj.partnerContinue = false;
                fObj.messages = updatedMsgs;
            }
        }
        return true;
    } else {
        const votesArr = Array.from(voteSet);
        itemA.continueVotes = votesArr;
        itemB.continueVotes = votesArr;
        if (typeof CloudSync !== 'undefined') {
            await Promise.all([
                CloudSync.upsertUser(userA, true, { isMatchMutation: true }),
                CloudSync.upsertUser(userB, true, { isMatchMutation: true })
            ]);
        }

        const sysText = `💖 ${voterNickname} 已按下「繼續配對」，等待另一方也按下繼續中...`;
        const updatedMsgs = ChatStore.appendMessage(idA, idB, { senderId: 'system', text: sysText });
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';

        if (String(appState.playerId) === idA) {
            const fObj = appState.friends.find(f => String(f.id) === idB);
            if (fObj) {
                fObj.myContinue = votesArr.includes(idA);
                fObj.partnerContinue = votesArr.includes(idB);
                fObj.messages = updatedMsgs;
            }
        }
        return false;
    }
}

async function respondSevenDayDecision(isContinue) {
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    if (!isContinue) {
        clearMutualFriendship(friend, `🍃 你選擇不繼續與 ${friend.nickname} 配對，兩邊好友名單已清空刪除。`);
        return;
    }

    const myNick = appState.profile.nickname || String(appState.playerId || '對方');
    const isRealFriend = !String(friend.id).startsWith('MOCK_FRIEND_') && !!appState.playerId;

    if (isRealFriend) {
        const completed = await recordMutualContinueVote(appState.playerId, friend.id, myNick, false);
        Store.save(appState, false, true); // 優化：繼續配對時不推送整包 appState 到雲端，避免覆蓋最新名單
        refreshAllUI();
        if (completed) {
            showMiniNotice('🌸 繼續配對成功', `你與 ${friend.nickname} 皆已按下繼續配對！\n緣分已再延後 7 天（剩餘 7 天），現在可以繼續在聊天室聊天了！`);
        } else {
            showMiniNotice('💖 已送出繼續意願', `你已按下「繼續配對」，只要 ${friend.nickname} 也按下繼續配對，就會立即再延後 7 天並開放聊天！`);
        }
        return;
    }

    friend.myContinue = true;
    friend.messages.push({ sender: 'system', text: `💖 ${myNick} 已按下「繼續配對」，等待另一方也按下繼續中...` });
    Store.save(appState, false, true); // 優化：測試好友按下繼續配對，純本地存檔
    renderActiveFriendWorkspace();

    if (friend.partnerContinue) {
        completeMutualContinuation(friend);
    }
}

function completeMutualContinuation(friend) {
    friend.matchedAt = Date.now();
    friend.igUnlocked = true;
    friend.myContinue = false;
    friend.partnerContinue = false;
    friend.messages.push({
        sender: 'system',
        text: `🌸 雙方皆按下「繼續配對」成為好友！緣分已再延後 7 天（剩餘 7 天），聊天室已重新開放並自動解鎖彼此的 IG 帳號！`
    });
    Store.save(appState, false, true); // 優化：測試好友完成繼續配對，純本地存檔
    refreshAllUI();
}

async function clearMutualFriendship(friend, noticeMsg) {
    const myPid = String(appState.playerId || '').trim();
    const partnerPid = String(friend.id || '').trim();

    // 1. 立即寫入永久解除配對墓碑（本地 + 雲端），防止任何同步快照或自動補齊復活配對
    if (myPid && partnerPid && typeof CloudSync !== 'undefined' && typeof CloudSync.markPairUnmatched === 'function') {
        await CloudSync.markPairUnmatched(myPid, partnerPid, 315360000000);
    }

    // 2. 合併本地與雲端快取的玩家資料，確保雙方紀錄都能完整移除彼此
    let users = [];
    try {
        users = JSON.parse(localStorage.getItem(USERS_LOCAL_KEY) || '[]');
        if (!Array.isArray(users)) users = [];
    } catch (e) {
        users = [];
    }

    const ensureUserLoaded = (targetId) => {
        if (!targetId) return null;
        let rec = users.find(u => u && String(u.id).trim() === targetId);
        const cloudRec = (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[USERS_KEY] && CloudSync.tree[USERS_KEY][targetId])
            ? CloudSync.tree[USERS_KEY][targetId]
            : null;
        if (!rec && cloudRec && typeof cloudRec === 'object') {
            rec = { ...cloudRec, id: targetId };
            users.push(rec);
        } else if (rec && cloudRec && typeof cloudRec === 'object') {
            Object.assign(rec, { ...cloudRec, ...rec, id: targetId });
        }
        return rec || null;
    };

    const myUserRec = ensureUserLoaded(myPid);
    const partnerUserRec = ensureUserLoaded(partnerPid);

    const removePartnerFromUserRecord = (u, removeTargetId) => {
        if (!u || !removeTargetId) return;
        const normHist = (typeof CloudSync !== 'undefined' && typeof CloudSync.normalizeMatchedHistoryList === 'function')
            ? CloudSync.normalizeMatchedHistoryList(u.matchedHistory)
            : (Array.isArray(u.matchedHistory) ? u.matchedHistory : []);
        u.matchedHistory = normHist.filter(h => String(h.partnerId).trim() !== removeTargetId);

        if (!u.matchedWithId || String(u.matchedWithId).trim() === removeTargetId) {
            const fallbackHist = u.matchedHistory.length > 0
                ? u.matchedHistory[u.matchedHistory.length - 1]
                : null;
            u.matchedSession = fallbackHist ? (fallbackHist.session || null) : null;
            u.matchedWithId = fallbackHist ? (fallbackHist.partnerId || null) : null;
            u.matchedWithName = fallbackHist ? (fallbackHist.partnerName || null) : null;
            u.matchedAt = fallbackHist ? (fallbackHist.matchedAt || null) : null;
        }
    };

    removePartnerFromUserRecord(myUserRec, partnerPid);
    removePartnerFromUserRecord(partnerUserRec, myPid);

    localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
    if (typeof LocalJsonCache !== 'undefined') {
        LocalJsonCache.invalidate(USERS_LOCAL_KEY);
    }

    removeFriendReadReceipt(partnerPid);
    appState.friends = appState.friends.filter(f => String(f.id) !== partnerPid);
    if (String(appState.activeFriendId) === partnerPid) {
        appState.activeFriendId = appState.friends[0] ? String(appState.friends[0].id) : null;
    }
    if (appState.matchedSession === friend.sessionLabel) {
        appState.matchedSession = null;
    }
    if (appState.friends.length < 2) {
        appState.multiFriendSince = null;
        appState.confessionUnlockAt = null;
    }
    // 傳入 skipCloudPush = true，避免重複觸發非配對異動的 upsertUser 覆蓋剛送出的解除配對狀態
    Store.save(appState, false, true);
    refreshAllUI();

    // 3. 同步更新雲端雙方會員節點、配對快照與聊天室
    if (myPid && partnerPid && typeof CloudSync !== 'undefined') {
        if (typeof CloudSync.unmatchUsersInCloud === 'function') {
            await CloudSync.unmatchUsersInCloud(myPid, partnerPid, myUserRec, partnerUserRec);
        } else {
            if (myUserRec) await CloudSync.upsertUser(myUserRec, true, { isMatchMutation: true });
            if (partnerUserRec) await CloudSync.upsertUser(partnerUserRec, true, { isMatchMutation: true });
            ChatStore.clearChat(myPid, partnerPid);
        }
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
    } else if (myPid && partnerPid) {
        ChatStore.clearChat(myPid, partnerPid);
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
    }

    if (noticeMsg) showMiniNotice('🍃 已解除好友', noticeMsg);
}

// ==================== 每隔 2 天 20:00 多好友心動抉擇 ====================
function openEveningConfessionModal() {
    if (appState.friends.length < 2) return;
    if (appState.confessionUnlockAt && Date.now() < appState.confessionUnlockAt) return;

    const listEl = document.getElementById('confessionTargetList');
    listEl.innerHTML = appState.friends.map((f, idx) => `
        <label class="flex items-center justify-between p-2.5 rounded-xl border border-pink-200 bg-pink-50/40 cursor-pointer hover:bg-pink-50">
            <div class="flex items-center gap-2">
                <input type="radio" name="confessionTarget" value="${f.id}" ${idx === 0 ? 'checked' : ''} class="accent-[#c96a7b]">
                <span class="font-bold text-xs text-[#8f4452]">${f.nickname}</span>
            </div>
            <span class="text-[11px] text-gray-500">${f.profile.city || ''} ・ ${f.profile.mbti || ''}</span>
        </label>
    `).join('');

    document.getElementById('confessionModal').classList.remove('hidden');
}

function closeEveningConfessionModal() {
    document.getElementById('confessionModal').classList.add('hidden');
    renderActiveFriendWorkspace();
}

function submitEveningConfession() {
    const selectedRadio = document.querySelector('input[name="confessionTarget"]:checked');
    const msgText = document.getElementById('confessionMessageInput').value.trim();

    if (!selectedRadio || !msgText) {
        showMiniNotice('💘 提醒', '請選擇一位好友，並寫下今天讓人心動的一句話喔！');
        return;
    }

    const chosenId = String(selectedRadio.value);
    const chosenFriend = appState.friends.find(f => String(f.id) === chosenId);
    const myName = appState.profile.nickname || '阿哲 (A)';
    const nowStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    let notifiedOthersCount = 0;

    appState.friends.forEach(friend => {
        const isReal = !String(friend.id).startsWith('MOCK_FRIEND_') && !!appState.playerId;
        if (String(friend.id) === chosenId) {
            const sysMsg = `💘【20:00 今日心動專屬】${myName} 選擇了你，並對你說出心動的話：`;
            const loveMsg = `💌「${msgText}」`;
            if (isReal) {
                ChatStore.appendMessage(appState.playerId, friend.id, { senderId: 'system', text: sysMsg });
                friend.messages = ChatStore.appendMessage(appState.playerId, friend.id, {
                    senderId: String(appState.playerId),
                    senderName: myName,
                    text: loveMsg,
                    time: nowStr
                });
            } else {
                friend.messages.push({ sender: 'system', text: sysMsg });
                friend.messages.push({ sender: 'me', text: loveMsg, time: nowStr });
            }
        } else {
            notifiedOthersCount++;
            const warnMsg = `⚠️【20:00 心動通知】${myName} 已發送今日好感內容給「另外一位好友」。`;
            if (isReal) {
                friend.messages = ChatStore.appendMessage(appState.playerId, friend.id, { senderId: 'system', text: warnMsg });
            } else {
                friend.messages.push({ sender: 'system', text: warnMsg });
            }
        }
    });
    lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';

    appState.lastConfessionDate = new Date().toDateString();
    appState.confessionUnlockAt = calcConfessionUnlockTime(Date.now());
    persistConfessionState();
    document.getElementById('confessionMessageInput').value = '';
    closeEveningConfessionModal();
    appState.activeFriendId = chosenId;
    Store.save(appState);
    switchTab('friends');
    refreshAllUI();

    showMiniNotice(
        '💘 心動訊息已送出',
        `已發送給「${chosenFriend ? chosenFriend.nickname : ''}」，其餘 ${notifiedOthersCount} 位好友的對話窗已同步收到好感通知提示！`
    );
}

// ==================== 月老籤詩號碼限制為 1~5 號 ====================
(function enforceFortune1To5Frontend() {
    function trimFortuneGridTo5() {
        const grid = document.getElementById('customActFortuneGrid');
        if (grid) {
            while (grid.children.length > 5) {
                grid.removeChild(grid.lastElementChild);
            }
        }
        const selInput = document.getElementById('customActSelectedFortune');
        if (selInput && Number(selInput.value) > 5) {
            selInput.value = '';
        }
        const statusBox = document.getElementById('customActStatusBadgeBox');
        if (statusBox && /1\s*[~～-]\s*10/.test(statusBox.innerHTML)) {
            statusBox.innerHTML = statusBox.innerHTML.replace(/1\s*[~～-]\s*10/g, '1~5');
        }
    }

    if (typeof window.openCustomActivityModal === 'function' && !window.openCustomActivityModal.__wrappedFortune5) {
        const origOpen = window.openCustomActivityModal;
        const wrapped = function(...args) {
            const res = origOpen.apply(this, args);
            trimFortuneGridTo5();
            return res;
        };
        wrapped.__wrappedFortune5 = true;
        window.openCustomActivityModal = wrapped;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const grid = document.getElementById('customActFortuneGrid');
        if (grid && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(() => trimFortuneGridTo5());
            obs.observe(grid, { childList: true });
        }
        trimFortuneGridTo5();
    });
})();

// 流量修復：訊息寫入最終失敗時，明確提示（假訊息已由 ChatStore 撤回）
window.addEventListener('chat-send-failed', () => {
    showMiniNotice('⚠️ 訊息傳送失敗，請重試', '訊息未送達雲端，已撤回顯示，請重新輸入後再送出。');
    try { renderActiveFriendWorkspace(); } catch (e) {}
});
