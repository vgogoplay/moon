/* backend/chats.js - 後台玩家聊天紀錄查詢（房間索引快取 + 每頁 10/20/50 間分頁 + 增量無閃爍渲染 + 近 30 則懶加載） */

let selectedAdminChatPairKey = '';
let adminChatSearchKeyword = '';
let adminChatRoomsPage = 1;
let adminChatRoomsPerPage = 10;

const ADMIN_CHAT_BATCH_STEP = 30;
let adminChatVisibleBatchLimit = ADMIN_CHAT_BATCH_STEP;
let activeAdminChatDetailPairKey = '';
let lastObservedAdminChatMsgCount = 0;
let shouldScrollAdminChatToLatest = true;
let pendingPreserveAdminChatScrollOnPrepend = false;
let isAutoScrollingAdminChatBottom = false;
let lastAdminChatPrependTriggerTs = 0;

let lastAdminChatRoomsSig = '';
let lastAdminChatDetailSig = '';
let renderedAdminChatRoomKey = '';
let renderedAdminChatKeyword = '';
let renderedAdminChatMsgKeys = new Set();

// 快取已解析排序好的全站房間索引，避免大量聊天室時每次輪詢或換頁重複排序掃描
let cachedAdminChatSourceRef = null;
let cachedAdminChatUsersNameSig = '';
let cachedAdminChatRoomEntries = [];
let cachedAdminChatTotalMessages = 0;

function escapeChatAdminHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAdminChatDateTime(msg) {
    if (!msg || typeof msg !== 'object') return '';
    if (msg.dateTime && String(msg.dateTime).trim()) {
        return String(msg.dateTime).trim();
    }
    const tsNum = Number(msg.ts || 0);
    if (tsNum > 0 && !Number.isNaN(tsNum)) {
        const d = new Date(tsNum);
        if (!Number.isNaN(d.getTime())) {
            const datePart = `${d.getMonth() + 1}/${d.getDate()}`;
            const timePart = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
            return `${datePart} ${timePart}`;
        }
    }
    return String(msg.time || '').trim();
}

function highlightChatKeywordHtml(text, keyword) {
    const safeText = escapeChatAdminHtml(text);
    const kw = String(keyword || '').trim();
    if (!kw) return safeText;
    const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedKw})`, 'gi');
    return safeText.replace(regex, '<mark class="bg-amber-200 text-[#8f4452] px-0.5 rounded">$1</mark>');
}

function getAdminChatMessageUniqueKey(m, fallbackIdx = 0) {
    if (!m || typeof m !== 'object') return `EMPTY_${fallbackIdx}`;
    if (m.id && String(m.id).trim()) {
        return String(m.id).trim();
    }
    return `${String(m.senderId || '')}_${Number(m.ts || 0)}_${String(m.text || '').slice(0, 24)}_${fallbackIdx}`;
}

function resetRenderedAdminChatDomState() {
    lastAdminChatDetailSig = '';
    renderedAdminChatRoomKey = '';
    renderedAdminChatKeyword = '';
    renderedAdminChatMsgKeys = new Set();
}

let adminChatSearchDebounceTimer = null;

function onAdminChatSearchInput(val) {
    adminChatSearchKeyword = String(val || '').trim();
    adminChatRoomsPage = 1;
    const clearBtn = document.getElementById('clearAdminChatSearchBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', adminChatSearchKeyword === '');
    }
    lastAdminChatRoomsSig = '';
    resetRenderedAdminChatDomState();
    if (adminChatSearchDebounceTimer) clearTimeout(adminChatSearchDebounceTimer);
    adminChatSearchDebounceTimer = setTimeout(() => {
        adminChatSearchDebounceTimer = null;
        renderAdminAll(true);
    }, 150);
}

function clearAdminChatSearch() {
    adminChatSearchKeyword = '';
    adminChatRoomsPage = 1;
    const inputEl = document.getElementById('adminChatSearchInput');
    if (inputEl) inputEl.value = '';
    const clearBtn = document.getElementById('clearAdminChatSearchBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    lastAdminChatRoomsSig = '';
    resetRenderedAdminChatDomState();
    renderAdminAll(true);
}

function onAdminChatRoomsPerPageChange(val) {
    const parsed = parseInt(val, 10);
    adminChatRoomsPerPage = [10, 20, 50].includes(parsed) ? parsed : 10;
    adminChatRoomsPage = 1;
    lastAdminChatRoomsSig = '';
    renderAdminAll(true);
}

function goToAdminChatRoomsPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    adminChatRoomsPage = p;
    lastAdminChatRoomsSig = '';
    renderAdminAll(true);
}

function getLoadedAdminRoomMessages(pairKey) {
    if (!pairKey) return null;
    if (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[CHATS_KEY] && CloudSync.tree[CHATS_KEY][pairKey]) {
        const raw = CloudSync.tree[CHATS_KEY][pairKey];
        const arr = Array.isArray(raw)
            ? raw.filter(m => m && typeof m === 'object')
            : (raw && typeof raw === 'object' ? Object.values(raw).filter(m => m && typeof m === 'object') : []);
        arr.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
        return arr;
    }
    return null;
}

async function selectAdminChatRoom(pairKey) {
    const nextKey = String(pairKey || '');
    selectedAdminChatPairKey = nextKey;
    activeAdminChatDetailPairKey = nextKey;
    adminChatVisibleBatchLimit = ADMIN_CHAT_BATCH_STEP;
    lastObservedAdminChatMsgCount = 0;
    shouldScrollAdminChatToLatest = true;
    pendingPreserveAdminChatScrollOnPrepend = false;
    lastAdminChatRoomsSig = '';
    cachedAdminChatSourceRef = null;
    resetRenderedAdminChatDomState();

    const detailMsgsBox = document.getElementById('adminChatDetailMessages');
    if (detailMsgsBox && nextKey) {
        detailMsgsBox.innerHTML = '<div class="h-80 flex items-center justify-center text-xs text-gray-400">⏳ 正在載入對話紀錄...</div>';
    }

    if (nextKey && typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        const res = await CloudSync.readNodeCached(`${CHATS_KEY}/${nextKey}`, { force: true });
        if (res && res.data && typeof res.data === 'object') {
            if (!CloudSync.tree[CHATS_KEY]) CloudSync.tree[CHATS_KEY] = {};
            CloudSync.tree[CHATS_KEY][nextKey] = res.data;
            CloudSync.chatsTreeVersion++;
            cachedAdminChatSourceRef = null;
            if (typeof AdminMemoryCache !== 'undefined') AdminMemoryCache.invalidate('chats');
        }
    }

    renderAdminAll(true);
}

function loadMoreOlderAdminChatMessages() {
    const loadedMsgs = getLoadedAdminRoomMessages(selectedAdminChatPairKey);
    const chatsMap = typeof getAdminChatsMap === 'function'
        ? getAdminChatsMap()
        : JSON.parse(localStorage.getItem(typeof ADMIN_CHATS_KEY !== 'undefined' ? ADMIN_CHATS_KEY : CHATS_KEY) || '{}');
    const rawThread = loadedMsgs || (selectedAdminChatPairKey ? chatsMap[selectedAdminChatPairKey] : null);
    const totalCount = Array.isArray(rawThread)
        ? rawThread.length
        : (rawThread && typeof rawThread === 'object' && !rawThread.lastMsg ? Object.keys(rawThread).length : 0);
    if (totalCount <= adminChatVisibleBatchLimit) return;

    adminChatVisibleBatchLimit = Math.min(totalCount, adminChatVisibleBatchLimit + ADMIN_CHAT_BATCH_STEP);
    pendingPreserveAdminChatScrollOnPrepend = true;
    shouldScrollAdminChatToLatest = false;
    lastAdminChatDetailSig = '';
    renderAdminAll(true);
}

function ensureAdminChatDetailScrollPagination(detailMsgsBox) {
    if (!detailMsgsBox || detailMsgsBox.dataset.adminScrollBound === '1') return;
    detailMsgsBox.dataset.adminScrollBound = '1';

    detailMsgsBox.addEventListener('scroll', () => {
        if (isAutoScrollingAdminChatBottom || shouldScrollAdminChatToLatest || pendingPreserveAdminChatScrollOnPrepend) return;
        if (detailMsgsBox.scrollTop > 16) return;

        const now = Date.now();
        if (now - lastAdminChatPrependTriggerTs < 350) return;

        const loadedMsgs = getLoadedAdminRoomMessages(selectedAdminChatPairKey);
        const chatsMap = typeof getAdminChatsMap === 'function'
            ? getAdminChatsMap()
            : JSON.parse(localStorage.getItem(typeof ADMIN_CHATS_KEY !== 'undefined' ? ADMIN_CHATS_KEY : CHATS_KEY) || '{}');
        const rawThread = loadedMsgs || (selectedAdminChatPairKey ? chatsMap[selectedAdminChatPairKey] : null);
        const totalCount = Array.isArray(rawThread)
            ? rawThread.length
            : (rawThread && typeof rawThread === 'object' && !rawThread.lastMsg ? Object.keys(rawThread).length : 0);
        if (adminChatVisibleBatchLimit >= totalCount) return;

        lastAdminChatPrependTriggerTs = now;
        loadMoreOlderAdminChatMessages();
    }, { passive: true });
}

function getIndexedAdminChatRooms(users, chatsMap) {
    const validUsers = Array.isArray(users) ? users : [];
    const usersNameSig = validUsers.map(u => (u && u.id) ? `${u.id}:${u.nickname || ''}:${u.gender || ''}` : '').join('|');
    const loadedTreeVer = (typeof CloudSync !== 'undefined') ? Number(CloudSync.chatsTreeVersion || 0) : 0;
    const combinedSig = `${usersNameSig}#${loadedTreeVer}#${selectedAdminChatPairKey}`;

    if (chatsMap === cachedAdminChatSourceRef && combinedSig === cachedAdminChatUsersNameSig) {
        return {
            rooms: cachedAdminChatRoomEntries,
            totalMessages: cachedAdminChatTotalMessages
        };
    }

    const userMap = new Map();
    validUsers.forEach(u => {
        if (u && u.id) userMap.set(String(u.id), u);
    });

    const rooms = [];
    let totalMessages = 0;

    Object.keys(chatsMap || {}).forEach(pairKey => {
        const entry = chatsMap[pairKey];
        if (!entry || typeof entry !== 'object') return;

        const loadedMsgs = getLoadedAdminRoomMessages(pairKey);
        const isSummaryMeta = Boolean(entry.lastMsg && typeof entry.lastMsg === 'object');
        let msgs = loadedMsgs || [];
        let lastMsg = null;
        let msgCount = 0;

        if (isSummaryMeta) {
            lastMsg = entry.lastMsg;
            msgCount = Math.max(Number(entry.msgCount || 1), msgs.length);
            if (msgs.length === 0) {
                msgs = [lastMsg];
            }
        } else {
            if (!loadedMsgs) {
                msgs = Array.isArray(entry)
                    ? entry.filter(m => m && typeof m === 'object')
                    : Object.values(entry).filter(m => m && typeof m === 'object');
                msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
            }
            if (msgs.length === 0) return;
            lastMsg = msgs[msgs.length - 1] || {};
            msgCount = msgs.length;
        }

        totalMessages += msgCount;

        const parts = String(pairKey).split('__');
        const idA = parts[0] || '';
        const idB = parts[1] || '';
        const userA = userMap.get(idA);
        const userB = userMap.get(idB);

        const inferNameFromMsgs = (targetId) => {
            const found = msgs.find(m => m && String(m.senderId) === String(targetId) && m.senderName);
            return found ? String(found.senderName) : '';
        };

        const nameA = (userA && userA.nickname) || inferNameFromMsgs(idA) || `玩家_${idA}`;
        const nameB = (userB && userB.nickname) || inferNameFromMsgs(idB) || `玩家_${idB}`;
        const genderA = (userA && userA.gender) || (idA.startsWith('1') ? '男' : (idA.startsWith('2') ? '女' : ''));
        const genderB = (userB && userB.gender) || (idB.startsWith('1') ? '男' : (idB.startsWith('2') ? '女' : ''));

        const lastTs = Number((lastMsg && lastMsg.ts) || entry.lastTs || 0);
        const msgTextsJoined = msgs.map(m => String((m && m.text) || '')).join('\n');
        const searchBlob = `${idA} ${idB} ${nameA} ${nameB} ${msgTextsJoined}`.toLowerCase();

        rooms.push({
            pairKey,
            idA,
            idB,
            nameA,
            nameB,
            genderA,
            genderB,
            messages: msgs,
            msgCount,
            lastMsg: lastMsg || {},
            lastTs,
            searchBlob
        });
    });

    rooms.sort((a, b) => Number(b.lastTs) - Number(a.lastTs));

    cachedAdminChatSourceRef = chatsMap;
    cachedAdminChatUsersNameSig = combinedSig;
    cachedAdminChatRoomEntries = rooms;
    cachedAdminChatTotalMessages = totalMessages;

    return { rooms, totalMessages };
}

function buildAdminChatTopBannerHtml(remainingOlderCount, totalRoomMsgs) {
    if (remainingOlderCount > 0) {
        const nextLoadCount = Math.min(ADMIN_CHAT_BATCH_STEP, remainingOlderCount);
        return `
            <div data-chat-banner="1" class="text-center pb-1.5">
                <button type="button" onclick="loadMoreOlderAdminChatMessages()" class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white border border-pink-200 text-[11px] text-[#8f4452] font-semibold hover:bg-pink-50 transition shadow-2xs">
                    <span>⬆️ 往上滑動或點擊載入更早 ${nextLoadCount} 則（還有 ${remainingOlderCount} 則）</span>
                </button>
            </div>
        `;
    }
    if (totalRoomMsgs > ADMIN_CHAT_BATCH_STEP) {
        return `
            <div data-chat-banner="1" class="text-center pb-1.5">
                <span class="inline-block px-3 py-0.5 rounded-full bg-pink-50/90 text-[10px] text-gray-400">
                    🌸 已顯示全部 ${totalRoomMsgs} 則對話紀錄
                </span>
            </div>
        `;
    }
    return '';
}

function buildAdminChatSingleBubbleHtml(m, activeRoom, msgKey) {
    const senderId = String(m.senderId || '');
    const timeDisplay = formatAdminChatDateTime(m);
    const safeKeyAttr = escapeChatAdminHtml(msgKey);

    if (senderId === 'system' || m.sender === 'system') {
        return `
            <div data-msg-key="${safeKeyAttr}" class="text-center my-2">
                <span class="inline-block px-3.5 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-[11px] text-[#8f4452] leading-relaxed">
                    ${highlightChatKeywordHtml(m.text || '', adminChatSearchKeyword)}
                </span>
                ${timeDisplay ? `<div class="text-[10px] text-gray-400 mt-0.5">${escapeChatAdminHtml(timeDisplay)}</div>` : ''}
            </div>
        `;
    }

    const isSideB = (senderId === String(activeRoom.idB));
    const senderLabel = isSideB
        ? `${activeRoom.nameB} (ID:${activeRoom.idB})`
        : `${activeRoom.nameA} (ID:${activeRoom.idA})`;

    return `
        <div data-msg-key="${safeKeyAttr}" class="flex flex-col ${isSideB ? 'items-end' : 'items-start'}">
            <span class="text-[10px] font-semibold mb-0.5 px-1 ${isSideB ? 'text-[#c96a7b]' : 'text-sky-700'}">
                ${escapeChatAdminHtml(senderLabel)}
            </span>
            <div class="max-w-[82%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed shadow-2xs whitespace-pre-wrap break-words ${isSideB ? 'bg-gradient-to-r from-[#e598a6] to-[#c96a7b] text-white rounded-br-xs' : 'bg-white border border-pink-200 text-gray-700 rounded-bl-xs'}">
                ${highlightChatKeywordHtml(m.text || '', adminChatSearchKeyword)}
            </div>
            <span class="text-[10px] text-gray-400 mt-0.5 px-1">${escapeChatAdminHtml(timeDisplay)}</span>
        </div>
    `;
}

function renderChatsPageSection(users, forceRender = false) {
    const roomsListBox = document.getElementById('adminChatRoomsList');
    const roomsPaginationBar = document.getElementById('adminChatRoomsPaginationBar');
    const detailHeaderBox = document.getElementById('adminChatDetailHeader');
    const detailMsgsBox = document.getElementById('adminChatDetailMessages');
    if (!roomsListBox || !detailHeaderBox || !detailMsgsBox) return;

    ensureAdminChatDetailScrollPagination(detailMsgsBox);

    const perPageSel = document.getElementById('adminChatRoomsPerPageSelect');
    if (perPageSel && String(perPageSel.value) !== String(adminChatRoomsPerPage)) {
        perPageSel.value = String(adminChatRoomsPerPage);
    }
    const headerTitleEl = document.getElementById('adminChatRoomsListHeaderTitle');
    if (headerTitleEl) {
        headerTitleEl.textContent = `💞 配對聊天室列表（每頁 ${adminChatRoomsPerPage} 間）`;
    }

    const chatsMap = typeof getAdminChatsMap === 'function'
        ? getAdminChatsMap()
        : JSON.parse(localStorage.getItem(typeof ADMIN_CHATS_KEY !== 'undefined' ? ADMIN_CHATS_KEY : CHATS_KEY) || '{}');

    const { rooms: allRooms, totalMessages: totalMessagesAll } = getIndexedAdminChatRooms(users, chatsMap);

    const summaryBadge = document.getElementById('chatRoomsSummaryBadge');
    if (summaryBadge) {
        summaryBadge.textContent = `聊天室 ${allRooms.length} 間 ／ 訊息 ${totalMessagesAll} 則`;
    }
    const lowRemainBtn = document.getElementById('openLowRemainCleanupBtn');
    if (lowRemainBtn) {
        const nowCheckTs = Date.now();
        const lowCount = allRooms.filter(r => {
            if (!r || !r.lastTs || r.lastTs <= 0) return false;
            const remMs = Math.max(0, (r.lastTs + 3 * 24 * 60 * 60 * 1000) - nowCheckTs);
            const remHrs = Math.ceil(remMs / (60 * 60 * 1000));
            return remHrs < 6;
        }).length;
        lowRemainBtn.textContent = lowCount > 0
            ? `🧹 檢查剩餘 < 6 小時（${lowCount} 間）`
            : '🧹 檢查剩餘 < 6 小時';
    }

    const kw = adminChatSearchKeyword.toLowerCase();
    const filteredRooms = kw
        ? allRooms.filter(r => r.searchBlob.includes(kw))
        : allRooms;

    const totalFilteredRooms = filteredRooms.length;
    const totalRoomPages = Math.max(1, Math.ceil(totalFilteredRooms / adminChatRoomsPerPage));
    if (adminChatRoomsPage > totalRoomPages) adminChatRoomsPage = totalRoomPages;
    if (adminChatRoomsPage < 1) adminChatRoomsPage = 1;

    const pageStartIdx = (adminChatRoomsPage - 1) * adminChatRoomsPerPage;
    const pageRooms = filteredRooms.slice(pageStartIdx, pageStartIdx + adminChatRoomsPerPage);

    const countTextEl = document.getElementById('filteredChatRoomsCountText');
    if (countTextEl) {
        countTextEl.textContent = kw
            ? `篩選 ${totalFilteredRooms} / ${allRooms.length} 間（第 ${adminChatRoomsPage}/${totalRoomPages} 頁）`
            : `共 ${allRooms.length} 間（第 ${adminChatRoomsPage}/${totalRoomPages} 頁）`;
    }

    const roomsSig = JSON.stringify({
        selected: selectedAdminChatPairKey,
        kw,
        perPage: adminChatRoomsPerPage,
        page: adminChatRoomsPage,
        totalPages: totalRoomPages,
        totalFiltered: totalFilteredRooms,
        rooms: pageRooms.map(r => [r.pairKey, r.nameA, r.nameB, r.messages.length, r.lastTs, r.lastMsg.text])
    });

    if (roomsSig !== lastAdminChatRoomsSig || roomsListBox.children.length === 0) {
        lastAdminChatRoomsSig = roomsSig;
        if (pageRooms.length === 0) {
            roomsListBox.innerHTML = `
                <div class="p-8 text-center text-xs text-gray-400">
                    ${kw ? '找不到符合搜尋條件的聊天室 🌸' : '目前尚無任何玩家聊天紀錄 🌸'}
                </div>
            `;
        } else {
            roomsListBox.innerHTML = pageRooms.map((r, idxOnPage) => {
                const rankNum = pageStartIdx + idxOnPage + 1;
                const isSelected = r.pairKey === selectedAdminChatPairKey;
                const badgeA = r.genderA === '男' ? 'bg-sky-100 text-sky-700' : (r.genderA === '女' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600');
                const badgeB = r.genderB === '男' ? 'bg-sky-100 text-sky-700' : (r.genderB === '女' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600');
                const lastTimeStr = formatAdminChatDateTime(r.lastMsg);
                const remainMs = Math.max(0, (r.lastTs + 3 * 24 * 60 * 60 * 1000) - Date.now());
                const remainHours = Math.ceil(remainMs / (60 * 60 * 1000));
                const expireHint = r.lastTs > 0
                    ? (remainHours >= 24 ? `剩 ${Math.floor(remainHours / 24)}天${remainHours % 24}時` : `剩 ${remainHours}小時`)
                    : '';

                return `
                    <button type="button" onclick="selectAdminChatRoom('${escapeChatAdminHtml(r.pairKey)}')" class="w-full p-3.5 text-left transition block ${isSelected ? 'bg-pink-50/95 border-l-4 border-l-[#c96a7b]' : 'hover:bg-pink-50/35'}">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex flex-wrap items-center gap-1.5 min-w-0 text-xs">
                                <span class="text-[10px] font-mono text-gray-400">#${rankNum}</span>
                                <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${badgeA}">${escapeChatAdminHtml(r.idA)}</span>
                                <span class="font-bold text-[#8f4452] truncate max-w-[84px]">${highlightChatKeywordHtml(r.nameA, adminChatSearchKeyword)}</span>
                                <span class="text-pink-400 font-bold">⇄</span>
                                <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${badgeB}">${escapeChatAdminHtml(r.idB)}</span>
                                <span class="font-bold text-[#8f4452] truncate max-w-[84px]">${highlightChatKeywordHtml(r.nameB, adminChatSearchKeyword)}</span>
                            </div>
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-[#8f4452] font-bold shrink-0">
                                ${r.msgCount || r.messages.length} 則
                            </span>
                        </div>
                        <div class="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-gray-500">
                            <p class="truncate flex-1">${highlightChatKeywordHtml(r.lastMsg.text || '', adminChatSearchKeyword)}</p>
                            <span class="text-[10px] text-gray-400 shrink-0">${escapeChatAdminHtml(lastTimeStr)}${expireHint ? `（${expireHint}）` : ''}</span>
                        </div>
                    </button>
                `;
            }).join('');
        }

        if (roomsPaginationBar) {
            if (totalFilteredRooms === 0) {
                roomsPaginationBar.innerHTML = `<span class="text-gray-400">第 0 / 0 頁（共 0 間）</span>`;
            } else {
                const showFrom = pageStartIdx + 1;
                const showTo = Math.min(pageStartIdx + adminChatRoomsPerPage, totalFilteredRooms);
                const pageBtns = [];
                for (let p = 1; p <= totalRoomPages; p++) {
                    if (p === 1 || p === totalRoomPages || Math.abs(p - adminChatRoomsPage) <= 1) {
                        const isCur = p === adminChatRoomsPage;
                        pageBtns.push(`
                            <button type="button" onclick="goToAdminChatRoomsPage(${p})" class="min-w-[26px] h-6 px-1.5 rounded-lg font-bold transition ${isCur ? 'bg-[#c96a7b] text-white shadow-2xs' : 'bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50'}">
                                ${p}
                            </button>
                        `);
                    } else if (pageBtns[pageBtns.length - 1] !== '<span class="px-0.5 text-gray-400">...</span>') {
                        pageBtns.push('<span class="px-0.5 text-gray-400">...</span>');
                    }
                }
                roomsPaginationBar.innerHTML = `
                    <span class="text-gray-600 font-medium">顯示 ${showFrom}～${showTo} / 共 ${totalFilteredRooms} 間</span>
                    <div class="flex items-center gap-1">
                        <button type="button" onclick="goToAdminChatRoomsPage(${adminChatRoomsPage - 1})" ${adminChatRoomsPage <= 1 ? 'disabled' : ''} class="px-2 h-6 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                            ◀
                        </button>
                        ${pageBtns.join('')}
                        <button type="button" onclick="goToAdminChatRoomsPage(${adminChatRoomsPage + 1})" ${adminChatRoomsPage >= totalRoomPages ? 'disabled' : ''} class="px-2 h-6 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                            ▶
                        </button>
                    </div>
                `;
            }
        }
    }

    const activeRoom = allRooms.find(r => r.pairKey === selectedAdminChatPairKey) || null;
    if (activeRoom && activeRoom.msgCount > activeRoom.messages.length && typeof CloudSync !== 'undefined' && CloudSync.initialized && !activeRoom._fetchingFullNow) {
        activeRoom._fetchingFullNow = true;
        CloudSync.readNodeCached(`${CHATS_KEY}/${activeRoom.pairKey}`, { force: true }).then(res => {
            activeRoom._fetchingFullNow = false;
            if (res && res.data && typeof res.data === 'object') {
                if (!CloudSync.tree[CHATS_KEY]) CloudSync.tree[CHATS_KEY] = {};
                CloudSync.tree[CHATS_KEY][activeRoom.pairKey] = res.data;
                CloudSync.chatsTreeVersion++;
                cachedAdminChatSourceRef = null;
                if (typeof AdminMemoryCache !== 'undefined') AdminMemoryCache.invalidate('chats');
                renderAdminAll(true);
            }
        }).catch(() => { activeRoom._fetchingFullNow = false; });
    }
    if (!activeRoom) {
        const isCloudSyncing = (typeof CloudSync !== 'undefined' && (!CloudSync.initialized || !CloudSync.hasLoadedFullTree));
        if (selectedAdminChatPairKey && isCloudSyncing && detailMsgsBox.children.length > 0) {
            return;
        }
        const emptySig = `EMPTY|${selectedAdminChatPairKey}`;
        if (emptySig === lastAdminChatDetailSig && detailMsgsBox.children.length > 0) return;
        lastAdminChatDetailSig = emptySig;
        renderedAdminChatRoomKey = '';
        renderedAdminChatKeyword = '';
        renderedAdminChatMsgKeys = new Set();

        detailHeaderBox.innerHTML = `
            <div>
                <h3 class="text-sm font-bold text-[#8f4452]">對話內容檢視視窗</h3>
                <p class="text-[11px] text-gray-400">請從左側點選任一組配對查看對話紀錄（預設顯示最新 30 則，往上滑動載入更早 30 則）</p>
            </div>
        `;
        detailMsgsBox.innerHTML = `
            <div class="h-80 flex flex-col items-center justify-center text-center text-xs text-gray-400 space-y-2">
                <span class="text-3xl">💌</span>
                <p>點選左側配對聊天室後，將在此顯示雙方的對話紀錄</p>
            </div>
        `;
        return;
    }

    const totalRoomMsgs = activeRoom.messages.length;
    if (activeRoom.pairKey !== activeAdminChatDetailPairKey) {
        activeAdminChatDetailPairKey = activeRoom.pairKey;
        adminChatVisibleBatchLimit = ADMIN_CHAT_BATCH_STEP;
        lastObservedAdminChatMsgCount = totalRoomMsgs;
        shouldScrollAdminChatToLatest = true;
    } else if (totalRoomMsgs > lastObservedAdminChatMsgCount) {
        if (adminChatVisibleBatchLimit > ADMIN_CHAT_BATCH_STEP && !shouldScrollAdminChatToLatest) {
            adminChatVisibleBatchLimit += (totalRoomMsgs - lastObservedAdminChatMsgCount);
        } else {
            shouldScrollAdminChatToLatest = true;
        }
    }
    lastObservedAdminChatMsgCount = totalRoomMsgs;

    const effectiveVisibleCount = Math.min(totalRoomMsgs, Math.max(ADMIN_CHAT_BATCH_STEP, adminChatVisibleBatchLimit));
    const sliceStartIdx = Math.max(0, totalRoomMsgs - effectiveVisibleCount);
    const visibleMsgs = sliceStartIdx > 0
        ? activeRoom.messages.slice(sliceStartIdx)
        : activeRoom.messages;
    const remainingOlderCount = Math.max(0, totalRoomMsgs - visibleMsgs.length);

    const visibleKeyedItems = visibleMsgs.map((m, idx) => ({
        msg: m,
        key: getAdminChatMessageUniqueKey(m, sliceStartIdx + idx)
    }));

    const firstKey = visibleKeyedItems[0]?.key || '';
    const lastKey = visibleKeyedItems[visibleKeyedItems.length - 1]?.key || '';
    const detailSig = `${activeRoom.pairKey}|${activeRoom.nameA}|${activeRoom.nameB}|${totalRoomMsgs}|${visibleKeyedItems.length}|${firstKey}|${lastKey}|${kw}`;

    if (detailSig !== lastAdminChatDetailSig || detailMsgsBox.children.length === 0) {
        const prevScrollTop = detailMsgsBox.scrollTop;
        const prevScrollHeight = detailMsgsBox.scrollHeight;
        const isPrependingOlder = pendingPreserveAdminChatScrollOnPrepend;
        pendingPreserveAdminChatScrollOnPrepend = false;

        lastAdminChatDetailSig = detailSig;

        detailHeaderBox.innerHTML = `
            <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-1.5 text-sm font-bold text-[#8f4452]">
                    <span>💬 ${escapeChatAdminHtml(activeRoom.nameA)} (ID:${escapeChatAdminHtml(activeRoom.idA)})</span>
                    <span class="text-pink-400">⇄</span>
                    <span>${escapeChatAdminHtml(activeRoom.nameB)} (ID:${escapeChatAdminHtml(activeRoom.idB)})</span>
                </div>
                <p class="text-[11px] text-gray-500 mt-0.5">房間代號：<span class="font-mono">${escapeChatAdminHtml(activeRoom.pairKey)}</span> ・ 目前顯示最新 ${visibleKeyedItems.length} / 共 ${totalRoomMsgs} 則訊息</p>
            </div>
            <button type="button" id="manualDeleteAndUnmatchRoomBtn" onclick="manualDeleteChatAndUnmatchPair('${escapeChatAdminHtml(activeRoom.pairKey)}', '${escapeChatAdminHtml(activeRoom.idA)}', '${escapeChatAdminHtml(activeRoom.idB)}')" class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-2xs transition shrink-0 whitespace-nowrap">
                🗑️ 刪除聊天紀錄並解除雙方好友
            </button>
        `;

        const canIncrementalPatch = (
            renderedAdminChatRoomKey === activeRoom.pairKey &&
            renderedAdminChatKeyword === kw &&
            renderedAdminChatMsgKeys.size > 0 &&
            detailMsgsBox.querySelector('[data-msg-key]') !== null
        );

        let didIncrementalPatch = false;
        if (canIncrementalPatch) {
            const nextKeysSet = new Set(visibleKeyedItems.map(item => item.key));
            let allPrevStillPresent = true;
            for (const oldKey of renderedAdminChatMsgKeys) {
                if (!nextKeysSet.has(oldKey)) {
                    allPrevStillPresent = false;
                    break;
                }
            }

            if (allPrevStillPresent) {
                // 1. 找出新增在最前面的更早訊息（向上載入歷史紀錄）
                const leadingNewItems = [];
                for (let i = 0; i < visibleKeyedItems.length; i++) {
                    if (renderedAdminChatMsgKeys.has(visibleKeyedItems[i].key)) break;
                    leadingNewItems.push(visibleKeyedItems[i]);
                }

                // 2. 找出新增在最尾端的最新訊息（即時收到新對話）
                const trailingNewItems = [];
                for (let i = visibleKeyedItems.length - 1; i >= 0; i--) {
                    if (renderedAdminChatMsgKeys.has(visibleKeyedItems[i].key)) break;
                    trailingNewItems.unshift(visibleKeyedItems[i]);
                }

                // 3. 更新頂部提示條（不影響下方既有的訊息氣泡 DOM）
                const topBannerHtml = buildAdminChatTopBannerHtml(remainingOlderCount, totalRoomMsgs);
                const existingBanner = detailMsgsBox.querySelector('[data-chat-banner="1"]');
                if (existingBanner) {
                    if (topBannerHtml) {
                        existingBanner.outerHTML = topBannerHtml;
                    } else {
                        existingBanner.remove();
                    }
                } else if (topBannerHtml) {
                    detailMsgsBox.insertAdjacentHTML('afterbegin', topBannerHtml);
                }

                if (leadingNewItems.length > 0) {
                    const prependHtml = leadingNewItems
                        .map(item => buildAdminChatSingleBubbleHtml(item.msg, activeRoom, item.key))
                        .join('');
                    const firstBubbleEl = detailMsgsBox.querySelector('[data-msg-key]');
                    if (firstBubbleEl) {
                        firstBubbleEl.insertAdjacentHTML('beforebegin', prependHtml);
                    } else {
                        detailMsgsBox.insertAdjacentHTML('beforeend', prependHtml);
                    }
                }

                if (trailingNewItems.length > 0) {
                    const appendHtml = trailingNewItems
                        .map(item => buildAdminChatSingleBubbleHtml(item.msg, activeRoom, item.key))
                        .join('');
                    detailMsgsBox.insertAdjacentHTML('beforeend', appendHtml);
                }

                renderedAdminChatMsgKeys = nextKeysSet;
                didIncrementalPatch = true;
            }
        }

        if (!didIncrementalPatch) {
            const topBannerHtml = buildAdminChatTopBannerHtml(remainingOlderCount, totalRoomMsgs);
            const bubblesHtml = visibleKeyedItems
                .map(item => buildAdminChatSingleBubbleHtml(item.msg, activeRoom, item.key))
                .join('');
            detailMsgsBox.innerHTML = topBannerHtml + bubblesHtml;
            renderedAdminChatRoomKey = activeRoom.pairKey;
            renderedAdminChatKeyword = kw;
            renderedAdminChatMsgKeys = new Set(visibleKeyedItems.map(item => item.key));
        }

        if (!shouldScrollAdminChatToLatest) {
            isAutoScrollingAdminChatBottom = true;
            if (isPrependingOlder) {
                const newScrollHeight = detailMsgsBox.scrollHeight;
                detailMsgsBox.scrollTop = Math.max(24, prevScrollTop + (newScrollHeight - prevScrollHeight));
            } else if (!didIncrementalPatch) {
                detailMsgsBox.scrollTop = prevScrollTop;
            }
            requestAnimationFrame(() => {
                isAutoScrollingAdminChatBottom = false;
            });
        }
    }

    if (shouldScrollAdminChatToLatest) {
        shouldScrollAdminChatToLatest = false;
        isAutoScrollingAdminChatBottom = true;
        const scrollToLatest = () => {
            detailMsgsBox.scrollTop = detailMsgsBox.scrollHeight;
        };
        scrollToLatest();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(scrollToLatest);
        }
        setTimeout(() => {
            scrollToLatest();
            isAutoScrollingAdminChatBottom = false;
        }, 80);
    }
}


let _hasBackfilledLocalChatMetaThisSession = false;

async function backfillMissingAdminChatMetaToCloud() {
    if (_hasBackfilledLocalChatMetaThisSession) return;
    if (typeof CloudSync === 'undefined' || !CloudSync.initialized || CloudSync.isLocalSandboxMode()) return;
    const metaKey = (typeof CHAT_META_KEY !== 'undefined') ? CHAT_META_KEY : 'yuelao_chat_meta';
    const cloudMeta = (CloudSync.tree && CloudSync.tree[metaKey] && typeof CloudSync.tree[metaKey] === 'object')
        ? CloudSync.tree[metaKey]
        : {};
    const mergedMap = (typeof getAdminChatsMap === 'function') ? getAdminChatsMap() : {};
    const missingPatch = {};
    Object.keys(mergedMap).forEach(pk => {
        if (!Object.prototype.hasOwnProperty.call(cloudMeta, pk)) {
            const entry = mergedMap[pk];
            if (entry && entry.lastMsg) {
                missingPatch[pk] = {
                    lastMsg: entry.lastMsg,
                    lastTs: Number(entry.lastTs || entry.lastMsg.ts || 0),
                    msgCount: Math.max(1, Number(entry.msgCount || 1))
                };
            }
        }
    });
    _hasBackfilledLocalChatMetaThisSession = true;
    const missingCount = Object.keys(missingPatch).length;
    if (missingCount > 0) {
        await CloudSync.patchNode(metaKey, missingPatch);
        if (typeof AdminMemoryCache !== 'undefined') AdminMemoryCache.invalidate('chats');
        cachedAdminChatSourceRef = null;
        renderAdminAll(true);
    }
}

async function syncAllChatMetaFromCloudNow() {
    if (typeof CloudSync === 'undefined' || !CloudSync.initialized) return;
    const btn = document.getElementById('syncAllChatMetaBtn');
    const origText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 同步全部房間索引中...';
    }
    try {
        const rawAllChats = await CloudSync.getNodeOnce(CHATS_KEY);
        if (rawAllChats && typeof rawAllChats === 'object') {
            const metaKey = (typeof CHAT_META_KEY !== 'undefined') ? CHAT_META_KEY : 'yuelao_chat_meta';
            const unmatchedMap = (typeof CloudSync.loadSharedUnmatchedPairs === 'function')
                ? CloudSync.loadSharedUnmatchedPairs()
                : {};
            const rebuiltMeta = {};
            Object.keys(rawAllChats).forEach(pk => {
                if (unmatchedMap[pk]) return;
                const sum = (typeof buildAdminChatSummaryEntry === 'function')
                    ? buildAdminChatSummaryEntry(rawAllChats[pk])
                    : null;
                if (sum && sum.lastMsg) {
                    rebuiltMeta[pk] = sum;
                }
            });
            if (Object.keys(rebuiltMeta).length > 0) {
                await CloudSync.patchNode(metaKey, rebuiltMeta);
            }
            if (typeof AdminMemoryCache !== 'undefined') AdminMemoryCache.invalidate('chats');
            cachedAdminChatSourceRef = null;
            renderAdminAll(true);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = origText || '☁️ 同步全部索引';
        }
    }
}

window.backfillMissingAdminChatMetaToCloud = backfillMissingAdminChatMetaToCloud;
window.syncAllChatMetaFromCloudNow = syncAllChatMetaFromCloudNow;

let _lowRemainCandidateRooms = [];
let _lowRemainSelectedKeys = new Set();
let _lowRemainCleanupInFlight = false;

function collectLowRemainHoursChatRooms(thresholdHours = 6) {
    const users = (typeof getUsers === 'function') ? getUsers() : [];
    const chatsMap = typeof getAdminChatsMap === 'function'
        ? getAdminChatsMap()
        : JSON.parse(localStorage.getItem(typeof ADMIN_CHATS_KEY !== 'undefined' ? ADMIN_CHATS_KEY : CHATS_KEY) || '{}');
    const { rooms: allRooms } = getIndexedAdminChatRooms(users, chatsMap);
    const nowTs = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

    const matched = [];
    allRooms.forEach(r => {
        if (!r || !r.lastTs || r.lastTs <= 0) return;
        const remainMs = Math.max(0, (r.lastTs + threeDaysMs) - nowTs);
        const remainHours = Math.ceil(remainMs / (60 * 60 * 1000));
        if (remainHours < thresholdHours) {
            matched.push({
                ...r,
                remainMs,
                remainHours
            });
        }
    });

    matched.sort((a, b) => Number(a.remainMs) - Number(b.remainMs));
    return matched;
}

function syncLowRemainSelectionControls() {
    const total = _lowRemainCandidateRooms.length;
    const selectedCount = _lowRemainSelectedKeys.size;

    const selectAllCb = document.getElementById('lowRemainSelectAllCheckbox');
    if (selectAllCb) {
        selectAllCb.disabled = total === 0;
        selectAllCb.checked = total > 0 && selectedCount === total;
        selectAllCb.indeterminate = selectedCount > 0 && selectedCount < total;
    }

    const badgeEl = document.getElementById('lowRemainFoundCountBadge');
    if (badgeEl) {
        badgeEl.textContent = `共找到 ${total} 間（已勾選 ${selectedCount} 間）`;
    }

    const nextBtn = document.getElementById('lowRemainToStep2Btn');
    if (nextBtn) {
        nextBtn.disabled = selectedCount === 0;
        nextBtn.textContent = `🗑️ 下一步：二次確認清除 (${selectedCount} 間)`;
    }
}

function toggleLowRemainRoomCheckbox(pairKey, checked) {
    const pk = String(pairKey || '').trim();
    if (!pk) return;
    if (checked) {
        _lowRemainSelectedKeys.add(pk);
    } else {
        _lowRemainSelectedKeys.delete(pk);
    }
    syncLowRemainSelectionControls();
}

function toggleSelectAllLowRemainRooms(checked) {
    if (checked) {
        _lowRemainSelectedKeys = new Set(_lowRemainCandidateRooms.map(r => r.pairKey));
    } else {
        _lowRemainSelectedKeys.clear();
    }
    const listBox = document.getElementById('lowRemainRoomsListContainer');
    if (listBox) {
        listBox.querySelectorAll('input[type="checkbox"][data-low-remain-pk]').forEach(cb => {
            cb.checked = Boolean(checked);
        });
    }
    syncLowRemainSelectionControls();
}

function renderLowRemainRoomsStep1List() {
    const listBox = document.getElementById('lowRemainRoomsListContainer');
    if (!listBox) return;

    if (_lowRemainCandidateRooms.length === 0) {
        listBox.innerHTML = `
            <div class="p-8 text-center text-xs text-gray-400 space-y-1.5">
                <div class="text-2xl">🌸</div>
                <p class="font-semibold text-gray-500">目前沒有剩餘小時低於 6 小時的配對聊天室！</p>
                <p class="text-[11px]">所有配對聊天室的剩餘有效期皆為 6 小時以上。</p>
            </div>
        `;
        syncLowRemainSelectionControls();
        return;
    }

    listBox.innerHTML = _lowRemainCandidateRooms.map((r, idx) => {
        const isChecked = _lowRemainSelectedKeys.has(r.pairKey);
        const badgeA = r.genderA === '男' ? 'bg-sky-100 text-sky-700' : (r.genderA === '女' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600');
        const badgeB = r.genderB === '男' ? 'bg-sky-100 text-sky-700' : (r.genderB === '女' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600');
        const remainBadgeHtml = r.remainHours === 0
            ? `<span class="px-2 py-0.5 rounded-full bg-rose-600 text-white font-bold text-[10px] shrink-0">⚠️ 剩 0 小時（已到期）</span>`
            : `<span class="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-900 font-bold text-[10px] shrink-0">⏳ 剩 ${r.remainHours} 小時</span>`;
        const lastTimeStr = formatAdminChatDateTime(r.lastMsg);

        return `
            <label class="flex items-start gap-3 p-3.5 hover:bg-pink-50/40 cursor-pointer transition select-none">
                <input type="checkbox" data-low-remain-pk="${escapeChatAdminHtml(r.pairKey)}" onchange="toggleLowRemainRoomCheckbox('${escapeChatAdminHtml(r.pairKey)}', this.checked)" ${isChecked ? 'checked' : ''} class="mt-1 w-4 h-4 accent-[#c96a7b] rounded shrink-0 cursor-pointer">
                <div class="flex-1 min-w-0 space-y-1">
                    <div class="flex flex-wrap items-center justify-between gap-1.5">
                        <div class="flex flex-wrap items-center gap-1.5 text-xs min-w-0">
                            <span class="text-[10px] font-mono text-gray-400">#${idx + 1}</span>
                            <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${badgeA}">${escapeChatAdminHtml(r.idA)}</span>
                            <span class="font-bold text-[#8f4452] truncate max-w-[96px]">${escapeChatAdminHtml(r.nameA)}</span>
                            <span class="text-pink-400 font-bold">⇄</span>
                            <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${badgeB}">${escapeChatAdminHtml(r.idB)}</span>
                            <span class="font-bold text-[#8f4452] truncate max-w-[96px]">${escapeChatAdminHtml(r.nameB)}</span>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            ${remainBadgeHtml}
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 border border-pink-200 text-[#8f4452] font-bold">
                                ${r.msgCount || r.messages.length} 則
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center justify-between gap-2 text-[11px] text-gray-500">
                        <p class="truncate flex-1">最後訊息：${escapeChatAdminHtml(r.lastMsg.text || '（無文字）')}</p>
                        <span class="text-[10px] text-gray-400 shrink-0">${escapeChatAdminHtml(lastTimeStr)}</span>
                    </div>
                </div>
            </label>
        `;
    }).join('');

    syncLowRemainSelectionControls();
}

function openLowRemainHoursCleanupModal() {
    if (_lowRemainCleanupInFlight) return;
    _lowRemainCandidateRooms = collectLowRemainHoursChatRooms(6);
    _lowRemainSelectedKeys = new Set(_lowRemainCandidateRooms.map(r => r.pairKey));

    const step1 = document.getElementById('lowRemainStep1View');
    const step2 = document.getElementById('lowRemainStep2View');
    if (step1) step1.classList.remove('hidden');
    if (step2) step2.classList.add('hidden');

    renderLowRemainRoomsStep1List();

    const modal = document.getElementById('lowRemainChatsModal');
    if (modal) modal.classList.remove('hidden');
}

function closeLowRemainHoursCleanupModal() {
    if (_lowRemainCleanupInFlight) return;
    const modal = document.getElementById('lowRemainChatsModal');
    if (modal) modal.classList.add('hidden');
}

function proceedLowRemainSecondConfirm() {
    if (_lowRemainCleanupInFlight) return;
    const selectedRooms = _lowRemainCandidateRooms.filter(r => _lowRemainSelectedKeys.has(r.pairKey));
    if (selectedRooms.length === 0) {
        alert('請先勾選至少一間要清除的聊天室！');
        return;
    }

    const confirmCountEl = document.getElementById('lowRemainConfirmCountText');
    if (confirmCountEl) {
        confirmCountEl.textContent = `共 ${selectedRooms.length} 間聊天室（將解除 ${selectedRooms.length} 組雙方好友）`;
    }

    const confirmListEl = document.getElementById('lowRemainConfirmTargetList');
    if (confirmListEl) {
        confirmListEl.innerHTML = selectedRooms.map((r, idx) => {
            const remainText = r.remainHours === 0 ? '剩 0 小時（已到期）' : `剩 ${r.remainHours} 小時`;
            return `
                <div class="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div class="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span class="text-[10px] font-mono text-gray-400">#${idx + 1}</span>
                        <span class="font-bold text-[#8f4452]">${escapeChatAdminHtml(r.nameA)} (ID:${escapeChatAdminHtml(r.idA)})</span>
                        <span class="text-pink-400 font-bold">⇄</span>
                        <span class="font-bold text-[#8f4452]">${escapeChatAdminHtml(r.nameB)} (ID:${escapeChatAdminHtml(r.idB)})</span>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0 text-[10px]">
                        <span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold">${remainText}</span>
                        <span class="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">${r.msgCount || r.messages.length} 則</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    const step1 = document.getElementById('lowRemainStep1View');
    const step2 = document.getElementById('lowRemainStep2View');
    if (step1) step1.classList.add('hidden');
    if (step2) step2.classList.remove('hidden');
}

function backToLowRemainStep1() {
    if (_lowRemainCleanupInFlight) return;
    const step1 = document.getElementById('lowRemainStep1View');
    const step2 = document.getElementById('lowRemainStep2View');
    if (step2) step2.classList.add('hidden');
    if (step1) step1.classList.remove('hidden');
}

async function executeLowRemainRoomsCleanup() {
    if (_lowRemainCleanupInFlight) return;
    const targetRooms = _lowRemainCandidateRooms.filter(r => _lowRemainSelectedKeys.has(r.pairKey));
    if (targetRooms.length === 0) return;

    _lowRemainCleanupInFlight = true;
    const execBtn = document.getElementById('lowRemainExecuteBtn');
    const backBtn = document.getElementById('lowRemainBackStep1Btn');
    const xBtn = document.getElementById('closeLowRemainModalXBtn');
    const origExecText = execBtn ? execBtn.textContent : '';
    if (execBtn) execBtn.disabled = true;
    if (backBtn) backBtn.disabled = true;
    if (xBtn) xBtn.disabled = true;

    try {
        const users = (typeof getUsers === 'function') ? getUsers() : [];
        const userById = new Map();
        users.forEach(u => {
            if (u && u.id) userById.set(String(u.id).trim(), u);
        });

        const clearedPairKeys = new Set();
        const metaKey = (typeof CHAT_META_KEY !== 'undefined') ? CHAT_META_KEY : 'yuelao_chat_meta';
        const adminChatsKey = (typeof ADMIN_CHATS_KEY !== 'undefined') ? ADMIN_CHATS_KEY : 'yuelao_admin_chats';

        for (let i = 0; i < targetRooms.length; i++) {
            const room = targetRooms[i];
            if (execBtn) {
                execBtn.textContent = `⏳ 正在解除好友並清空紀錄 (${i + 1} / ${targetRooms.length})...`;
            }

            const pidA = String(room.idA || '').trim();
            const pidB = String(room.idB || '').trim();
            const pk = String(room.pairKey || '').trim();
            if (!pidA || !pidB || !pk) continue;

            const userA = userById.get(pidA) || null;
            const userB = userById.get(pidB) || null;

            // 1. 雲端與本地解除雙方好友配對、寫入永久解除墓碑、刪除配對快照與清空聊天紀錄（不保存）
            if (typeof CloudSync !== 'undefined' && typeof CloudSync.unmatchUsersInCloud === 'function') {
                await CloudSync.unmatchUsersInCloud(pidA, pidB, userA, userB);
            } else {
                if (typeof CloudSync !== 'undefined' && typeof CloudSync.markPairUnmatched === 'function') {
                    await CloudSync.markPairUnmatched(pidA, pidB, 315360000000);
                }
                if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
                    ChatStore.clearChat(pidA, pidB);
                }
            }

            // 2. 確保記憶體樹中的聊天紀錄與摘要節點立即移除
            if (typeof CloudSync !== 'undefined' && CloudSync.tree) {
                if (CloudSync.tree[CHATS_KEY] && Object.prototype.hasOwnProperty.call(CloudSync.tree[CHATS_KEY], pk)) {
                    delete CloudSync.tree[CHATS_KEY][pk];
                }
                if (CloudSync.tree[metaKey] && Object.prototype.hasOwnProperty.call(CloudSync.tree[metaKey], pk)) {
                    delete CloudSync.tree[metaKey][pk];
                }
            }

            // 3. 若本地 users 快取存在，同步移除該組好友配對紀錄
            if (typeof applyUnmatchPairToUsersList === 'function') {
                applyUnmatchPairToUsersList(users, pidA, pidB);
            }

            clearedPairKeys.add(pk);
        }

        // 4. 同步清理 localStorage 中的聊天快取與本地會員快取（聊天紀錄不保存）
        [adminChatsKey, CHATS_KEY].forEach(lsKey => {
            try {
                const raw = localStorage.getItem(lsKey);
                if (!raw) return;
                const obj = JSON.parse(raw);
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                    let changed = false;
                    clearedPairKeys.forEach(pk => {
                        if (Object.prototype.hasOwnProperty.call(obj, pk)) {
                            delete obj[pk];
                            changed = true;
                        }
                    });
                    if (changed) {
                        localStorage.setItem(lsKey, JSON.stringify(obj));
                        if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate(lsKey);
                    }
                }
            } catch (e) {}
        });

        try {
            if (localStorage.getItem(USERS_KEY) !== null) {
                localStorage.setItem(USERS_KEY, JSON.stringify(users));
                if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate(USERS_KEY);
            }
        } catch (e) {}

        // 5. 若右側明細視窗正開啟被清除的聊天室，立即重設
        if (selectedAdminChatPairKey && clearedPairKeys.has(selectedAdminChatPairKey)) {
            selectedAdminChatPairKey = '';
            activeAdminChatDetailPairKey = '';
            resetRenderedAdminChatDomState();
        }

        if (typeof CloudSync !== 'undefined') {
            CloudSync.chatsTreeVersion++;
        }
        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('chats');
            AdminMemoryCache.invalidate('users');
        }
        cachedAdminChatSourceRef = null;
        lastAdminChatRoomsSig = '';

        if (typeof appendLog === 'function') {
            appendLog(`<span class="text-rose-300">[手動清除低時數聊天室]</span> 管理員已手動清除 <strong>${clearedPairKeys.size}</strong> 間剩餘低於 6 小時的聊天室，同步解除雙方好友配對並永久清空聊天紀錄（不保存）。`);
        }

        _lowRemainCleanupInFlight = false;
        closeLowRemainHoursCleanupModal();
        renderAdminAll(true);
        alert(`✅ 已完成手動清除！

・共處理 ${clearedPairKeys.size} 間剩餘低於 6 小時的聊天室
・前後台已同步解除雙方好友配對
・聊天紀錄已永久清空（不保存）`);
    } catch (err) {
        console.error('[low-remain-cleanup] 手動清除失敗', err);
        alert(`❌ 清除過程中發生異常：${(err && err.message) || '請稍後再試'}`);
    } finally {
        _lowRemainCleanupInFlight = false;
        if (execBtn) {
            execBtn.disabled = false;
            execBtn.textContent = origExecText || '🔥 確認解除雙方好友並清空聊天紀錄';
        }
        if (backBtn) backBtn.disabled = false;
        if (xBtn) xBtn.disabled = false;
    }
}

window.openLowRemainHoursCleanupModal = openLowRemainHoursCleanupModal;
window.closeLowRemainHoursCleanupModal = closeLowRemainHoursCleanupModal;
window.toggleLowRemainRoomCheckbox = toggleLowRemainRoomCheckbox;
window.toggleSelectAllLowRemainRooms = toggleSelectAllLowRemainRooms;
window.proceedLowRemainSecondConfirm = proceedLowRemainSecondConfirm;
window.backToLowRemainStep1 = backToLowRemainStep1;
window.executeLowRemainRoomsCleanup = executeLowRemainRoomsCleanup;


let _manualSingleRoomActionInFlight = false;

async function manualDeleteChatAndUnmatchPair(pairKey, idA, idB) {
    if (_manualSingleRoomActionInFlight) return;
    const pk = String(pairKey || '').trim() || ((typeof ChatStore !== 'undefined' && typeof ChatStore.getPairKey === 'function') ? ChatStore.getPairKey(idA, idB) : '');
    const parts = pk.split('__');
    const pidA = String(idA || parts[0] || '').trim();
    const pidB = String(idB || parts[1] || '').trim();
    if (!pidA || !pidB) {
        alert('找不到完整的雙方玩家 ID，無法執行解除配對。');
        return;
    }

    const users = (typeof getUsers === 'function') ? getUsers() : [];
    const userA = users.find(u => u && String(u.id).trim() === pidA) || null;
    const userB = users.find(u => u && String(u.id).trim() === pidB) || null;
    const nameA = (userA && userA.nickname) ? userA.nickname : `玩家_${pidA}`;
    const nameB = (userB && userB.nickname) ? userB.nickname : `玩家_${pidB}`;

    if (!confirm(`確定要刪除「${nameA} (ID:${pidA}) ⇄ ${nameB} (ID:${pidB})」的聊天紀錄（不保存），並解除會員列表雙方好友配對嗎？

此操作會同步更新前後台名單與清空聊天室，無法復原。`)) {
        return;
    }

    _manualSingleRoomActionInFlight = true;
    const actBtn = document.getElementById('manualDeleteAndUnmatchRoomBtn');
    if (actBtn) actBtn.disabled = true;

    try {
        const cleanUserObj = (srcUser, selfId, partnerId) => {
            if (!srcUser || typeof srcUser !== 'object') return null;
            const u = { ...srcUser, id: selfId };
            if (Array.isArray(u.matchedHistory)) {
                u.matchedHistory = u.matchedHistory.filter(h => String(h && h.partnerId).trim() !== partnerId);
            }
            if (String(u.matchedWithId || '').trim() === partnerId) {
                const fallbackLast = (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0)
                    ? u.matchedHistory[u.matchedHistory.length - 1]
                    : null;
                u.matchedSession = fallbackLast ? (fallbackLast.session || null) : null;
                u.matchedWithId = fallbackLast ? (fallbackLast.partnerId || null) : null;
                u.matchedWithName = fallbackLast ? (fallbackLast.partnerName || null) : null;
                u.matchedAt = fallbackLast ? (fallbackLast.matchedAt || null) : null;
            }
            return u;
        };

        const cleanedA = cleanUserObj(userA, pidA, pidB);
        const cleanedB = cleanUserObj(userB, pidB, pidA);

        users.forEach((u, idx) => {
            if (!u || !u.id) return;
            const uid = String(u.id).trim();
            if (uid === pidA && cleanedA) users[idx] = cleanedA;
            if (uid === pidB && cleanedB) users[idx] = cleanedB;
        });

        if (typeof CloudSync !== 'undefined') {
            if (typeof CloudSync.unmatchUsersInCloud === 'function') {
                await CloudSync.unmatchUsersInCloud(pidA, pidB, cleanedA || userA, cleanedB || userB);
            } else {
                if (typeof CloudSync.markPairUnmatched === 'function') {
                    await CloudSync.markPairUnmatched(pidA, pidB, 315360000000);
                }
                if (cleanedA && typeof CloudSync.upsertUser === 'function') {
                    await CloudSync.upsertUser(cleanedA, true, { isMatchMutation: true });
                }
                if (cleanedB && typeof CloudSync.upsertUser === 'function') {
                    await CloudSync.upsertUser(cleanedB, true, { isMatchMutation: true });
                }
                if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
                    ChatStore.clearChat(pidA, pidB);
                }
            }
        } else if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
            ChatStore.clearChat(pidA, pidB);
        }

        // 同步清除本地聊天室快取與更新本地會員名單
        [ADMIN_CHATS_KEY, CHATS_KEY].forEach(cKey => {
            try {
                const rawC = localStorage.getItem(cKey);
                if (rawC) {
                    const parsedC = JSON.parse(rawC);
                    if (parsedC && typeof parsedC === 'object' && pk && Object.prototype.hasOwnProperty.call(parsedC, pk)) {
                        delete parsedC[pk];
                        localStorage.setItem(cKey, JSON.stringify(parsedC));
                        if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate(cKey);
                    }
                }
            } catch (e) {}
        });

        try {
            localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
            if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate(USERS_LOCAL_KEY);
        } catch (e) {}

        if (selectedAdminChatPairKey === pk || activeAdminChatDetailPairKey === pk) {
            selectedAdminChatPairKey = '';
            activeAdminChatDetailPairKey = '';
            resetRenderedAdminChatDomState();
        }

        if (typeof CloudSync !== 'undefined') {
            CloudSync.chatsTreeVersion++;
        }
        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('chats');
            AdminMemoryCache.invalidate('users');
        }
        cachedAdminChatSourceRef = null;
        lastAdminChatRoomsSig = '';

        renderAdminAll(true);
        alert(`✅ 已刪除聊天紀錄（不保存）並解除雙方好友配對！\n\n・對象：${nameA} (ID:${pidA}) ⇄ ${nameB} (ID:${pidB})`);
    } catch (err) {
        console.error('[manual-unmatch] 解除配對失敗', err);
        alert(`❌ 操作失敗：${(err && err.message) || '請稍後再試'}`);
    } finally {
        _manualSingleRoomActionInFlight = false;
        const latestBtn = document.getElementById('manualDeleteAndUnmatchRoomBtn');
        if (latestBtn) latestBtn.disabled = false;
    }
}

window.manualDeleteChatAndUnmatchPair = manualDeleteChatAndUnmatchPair;

window.onAdminChatRoomsPerPageChange = onAdminChatRoomsPerPageChange;

