/* backend/chats.js - 後台玩家聊天紀錄查詢（每頁 10 間分頁 + 增量無閃爍渲染 + 近 30 則懶加載） */

let selectedAdminChatPairKey = '';
let adminChatSearchKeyword = '';
let adminChatRoomsPage = 1;
const ADMIN_CHAT_ROOMS_PER_PAGE = 10;

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
    }, 180);
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

function goToAdminChatRoomsPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    adminChatRoomsPage = p;
    lastAdminChatRoomsSig = '';
    renderAdminAll(true);
}

function selectAdminChatRoom(pairKey) {
    const nextKey = String(pairKey || '');
    selectedAdminChatPairKey = nextKey;
    activeAdminChatDetailPairKey = nextKey;
    adminChatVisibleBatchLimit = ADMIN_CHAT_BATCH_STEP;
    lastObservedAdminChatMsgCount = 0;
    shouldScrollAdminChatToLatest = true;
    pendingPreserveAdminChatScrollOnPrepend = false;
    lastAdminChatRoomsSig = '';
    resetRenderedAdminChatDomState();
    renderAdminAll(true);
}

function loadMoreOlderAdminChatMessages() {
    const chatsMap = typeof getAdminChatsMap === 'function'
        ? getAdminChatsMap()
        : JSON.parse(localStorage.getItem(typeof ADMIN_CHATS_KEY !== 'undefined' ? ADMIN_CHATS_KEY : CHATS_KEY) || '{}');
    const rawThread = selectedAdminChatPairKey ? chatsMap[selectedAdminChatPairKey] : null;
    const totalCount = Array.isArray(rawThread)
        ? rawThread.length
        : (rawThread && typeof rawThread === 'object' ? Object.keys(rawThread).length : 0);
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

        const chatsMap = typeof getAdminChatsMap === 'function'
            ? getAdminChatsMap()
            : JSON.parse(localStorage.getItem(typeof ADMIN_CHATS_KEY !== 'undefined' ? ADMIN_CHATS_KEY : CHATS_KEY) || '{}');
        const rawThread = selectedAdminChatPairKey ? chatsMap[selectedAdminChatPairKey] : null;
        const totalCount = Array.isArray(rawThread)
            ? rawThread.length
            : (rawThread && typeof rawThread === 'object' ? Object.keys(rawThread).length : 0);
        if (adminChatVisibleBatchLimit >= totalCount) return;

        lastAdminChatPrependTriggerTs = now;
        loadMoreOlderAdminChatMessages();
    }, { passive: true });
}

function buildAdminChatRoomEntries(users, chatsMap) {
    const userMap = new Map();
    (Array.isArray(users) ? users : []).forEach(u => {
        if (u && u.id) userMap.set(String(u.id), u);
    });

    const rooms = [];
    Object.keys(chatsMap || {}).forEach(pairKey => {
        const rawThread = chatsMap[pairKey];
        const msgs = Array.isArray(rawThread)
            ? rawThread.filter(m => m && typeof m === 'object')
            : (rawThread && typeof rawThread === 'object'
                ? Object.values(rawThread).filter(m => m && typeof m === 'object')
                : []);
        if (msgs.length === 0) return;
        msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

        const parts = String(pairKey).split('__');
        const idA = parts[0] || '';
        const idB = parts[1] || '';
        const userA = userMap.get(idA);
        const userB = userMap.get(idB);

        const inferNameFromMsgs = (targetId) => {
            const found = msgs.find(m => String(m.senderId) === String(targetId) && m.senderName);
            return found ? String(found.senderName) : '';
        };

        const nameA = (userA && userA.nickname) || inferNameFromMsgs(idA) || `玩家_${idA}`;
        const nameB = (userB && userB.nickname) || inferNameFromMsgs(idB) || `玩家_${idB}`;
        const genderA = (userA && userA.gender) || (idA.startsWith('1') ? '男' : (idA.startsWith('2') ? '女' : ''));
        const genderB = (userB && userB.gender) || (idB.startsWith('1') ? '男' : (idB.startsWith('2') ? '女' : ''));

        const lastMsg = msgs[msgs.length - 1] || {};
        const lastTs = Number(lastMsg.ts || 0);

        rooms.push({
            pairKey,
            idA,
            idB,
            nameA,
            nameB,
            genderA,
            genderB,
            messages: msgs,
            lastMsg,
            lastTs
        });
    });

    rooms.sort((a, b) => Number(b.lastTs) - Number(a.lastTs));
    return rooms;
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

    const chatsMap = typeof getAdminChatsMap === 'function'
        ? getAdminChatsMap()
        : JSON.parse(localStorage.getItem(typeof ADMIN_CHATS_KEY !== 'undefined' ? ADMIN_CHATS_KEY : CHATS_KEY) || '{}');

    const allRooms = buildAdminChatRoomEntries(users, chatsMap);
    const totalMessagesAll = allRooms.reduce((sum, r) => sum + r.messages.length, 0);

    const summaryBadge = document.getElementById('chatRoomsSummaryBadge');
    if (summaryBadge) {
        summaryBadge.textContent = `聊天室 ${allRooms.length} 間 ／ 訊息 ${totalMessagesAll} 則`;
    }

    const kw = adminChatSearchKeyword.toLowerCase();
    const filteredRooms = kw
        ? allRooms.filter(r => {
            if (r.idA.toLowerCase().includes(kw) || r.idB.toLowerCase().includes(kw)) return true;
            if (r.nameA.toLowerCase().includes(kw) || r.nameB.toLowerCase().includes(kw)) return true;
            return r.messages.some(m => String(m.text || '').toLowerCase().includes(kw));
        })
        : allRooms;

    const totalFilteredRooms = filteredRooms.length;
    const totalRoomPages = Math.max(1, Math.ceil(totalFilteredRooms / ADMIN_CHAT_ROOMS_PER_PAGE));
    if (adminChatRoomsPage > totalRoomPages) adminChatRoomsPage = totalRoomPages;
    if (adminChatRoomsPage < 1) adminChatRoomsPage = 1;

    const pageStartIdx = (adminChatRoomsPage - 1) * ADMIN_CHAT_ROOMS_PER_PAGE;
    const pageRooms = filteredRooms.slice(pageStartIdx, pageStartIdx + ADMIN_CHAT_ROOMS_PER_PAGE);

    const countTextEl = document.getElementById('filteredChatRoomsCountText');
    if (countTextEl) {
        countTextEl.textContent = kw
            ? `篩選 ${totalFilteredRooms} / ${allRooms.length} 間（第 ${adminChatRoomsPage}/${totalRoomPages} 頁）`
            : `共 ${allRooms.length} 間（第 ${adminChatRoomsPage}/${totalRoomPages} 頁）`;
    }

    const roomsSig = JSON.stringify({
        selected: selectedAdminChatPairKey,
        kw,
        page: adminChatRoomsPage,
        totalPages: totalRoomPages,
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
                                ${r.messages.length} 則
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
                const showTo = Math.min(pageStartIdx + ADMIN_CHAT_ROOMS_PER_PAGE, totalFilteredRooms);
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
    if (!activeRoom) {
        const isCloudSyncing = (typeof CloudSync !== 'undefined' && !CloudSync.initialized);
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
