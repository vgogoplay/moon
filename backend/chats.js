/* backend/chats.js - 後台玩家聊天紀錄查詢（房間列表篩選與按需展開對話明細） */

let selectedAdminChatPairKey = '';
let adminChatSearchKeyword = '';
let adminChatShowAllMessages = false;
let lastAdminChatRoomsSig = '';
let lastAdminChatDetailSig = '';

function escapeChatAdminHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function highlightChatKeywordHtml(text, keyword) {
    const safeText = escapeChatAdminHtml(text);
    const kw = String(keyword || '').trim();
    if (!kw) return safeText;
    const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedKw})`, 'gi');
    return safeText.replace(regex, '<mark class="bg-amber-200 text-[#8f4452] px-0.5 rounded">$1</mark>');
}

function onAdminChatSearchInput(val) {
    adminChatSearchKeyword = String(val || '').trim();
    const clearBtn = document.getElementById('clearAdminChatSearchBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', adminChatSearchKeyword === '');
    }
    lastAdminChatRoomsSig = '';
    lastAdminChatDetailSig = '';
    renderAdminAll(true);
}

function clearAdminChatSearch() {
    adminChatSearchKeyword = '';
    const inputEl = document.getElementById('adminChatSearchInput');
    if (inputEl) inputEl.value = '';
    const clearBtn = document.getElementById('clearAdminChatSearchBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    lastAdminChatRoomsSig = '';
    lastAdminChatDetailSig = '';
    renderAdminAll(true);
}

function selectAdminChatRoom(pairKey) {
    selectedAdminChatPairKey = String(pairKey || '');
    adminChatShowAllMessages = false;
    lastAdminChatRoomsSig = '';
    lastAdminChatDetailSig = '';
    renderAdminAll(true);
}

function toggleAdminChatShowAllMessages() {
    adminChatShowAllMessages = !adminChatShowAllMessages;
    lastAdminChatDetailSig = '';
    renderAdminAll(true);
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

function renderChatsPageSection(users, forceRender = false) {
    const roomsListBox = document.getElementById('adminChatRoomsList');
    const detailHeaderBox = document.getElementById('adminChatDetailHeader');
    const detailMsgsBox = document.getElementById('adminChatDetailMessages');
    if (!roomsListBox || !detailHeaderBox || !detailMsgsBox) return;

    const chatsMap = typeof getAdminChatsMap === 'function'
        ? getAdminChatsMap()
        : JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');

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

    const countTextEl = document.getElementById('filteredChatRoomsCountText');
    if (countTextEl) {
        countTextEl.textContent = kw ? `篩選符合 ${filteredRooms.length} / ${allRooms.length} 間` : `共 ${allRooms.length} 間`;
    }

    const roomsSig = JSON.stringify({
        selected: selectedAdminChatPairKey,
        kw,
        rooms: filteredRooms.map(r => [r.pairKey, r.nameA, r.nameB, r.messages.length, r.lastTs, r.lastMsg.text])
    });

    if (forceRender || roomsSig !== lastAdminChatRoomsSig) {
        lastAdminChatRoomsSig = roomsSig;
        if (filteredRooms.length === 0) {
            roomsListBox.innerHTML = `
                <div class="p-8 text-center text-xs text-gray-400">
                    ${kw ? '找不到符合搜尋條件的聊天室 🌸' : '目前尚無任何玩家聊天紀錄 🌸'}
                </div>
            `;
        } else {
            roomsListBox.innerHTML = filteredRooms.map(r => {
                const isSelected = r.pairKey === selectedAdminChatPairKey;
                const badgeA = r.genderA === '男' ? 'bg-sky-100 text-sky-700' : (r.genderA === '女' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600');
                const badgeB = r.genderB === '男' ? 'bg-sky-100 text-sky-700' : (r.genderB === '女' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600');
                const lastTimeStr = r.lastMsg.time || (r.lastTs ? new Date(r.lastTs).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

                return `
                    <button type="button" onclick="selectAdminChatRoom('${escapeChatAdminHtml(r.pairKey)}')" class="w-full p-3.5 text-left transition block ${isSelected ? 'bg-pink-50/95 border-l-4 border-l-[#c96a7b]' : 'hover:bg-pink-50/35'}">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex flex-wrap items-center gap-1.5 min-w-0 text-xs">
                                <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${badgeA}">${escapeChatAdminHtml(r.idA)}</span>
                                <span class="font-bold text-[#8f4452] truncate max-w-[90px]">${highlightChatKeywordHtml(r.nameA, adminChatSearchKeyword)}</span>
                                <span class="text-pink-400 font-bold">⇄</span>
                                <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${badgeB}">${escapeChatAdminHtml(r.idB)}</span>
                                <span class="font-bold text-[#8f4452] truncate max-w-[90px]">${highlightChatKeywordHtml(r.nameB, adminChatSearchKeyword)}</span>
                            </div>
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-[#8f4452] font-bold shrink-0">
                                ${r.messages.length} 則
                            </span>
                        </div>
                        <div class="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-gray-500">
                            <p class="truncate flex-1">${highlightChatKeywordHtml(r.lastMsg.text || '', adminChatSearchKeyword)}</p>
                            <span class="text-[10px] text-gray-400 shrink-0">${escapeChatAdminHtml(lastTimeStr)}</span>
                        </div>
                    </button>
                `;
            }).join('');
        }
    }

    const activeRoom = allRooms.find(r => r.pairKey === selectedAdminChatPairKey) || null;
    const detailSig = activeRoom
        ? `${activeRoom.pairKey}|${activeRoom.messages.length}|${activeRoom.lastTs}|${adminChatShowAllMessages}|${kw}`
        : `EMPTY|${selectedAdminChatPairKey}`;

    if (!forceRender && detailSig === lastAdminChatDetailSig) {
        return;
    }
    lastAdminChatDetailSig = detailSig;

    if (!activeRoom) {
        detailHeaderBox.innerHTML = `
            <div>
                <h3 class="text-sm font-bold text-[#8f4452]">對話內容檢視視窗</h3>
                <p class="text-[11px] text-gray-400">請從左側點選任一組配對查看對話紀錄</p>
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
    const LIMIT_RECENT = 80;
    const isTruncated = !adminChatShowAllMessages && totalRoomMsgs > LIMIT_RECENT;
    const visibleMsgs = isTruncated ? activeRoom.messages.slice(-LIMIT_RECENT) : activeRoom.messages;

    detailHeaderBox.innerHTML = `
        <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5 text-sm font-bold text-[#8f4452]">
                <span>💬 ${escapeChatAdminHtml(activeRoom.nameA)} (ID:${escapeChatAdminHtml(activeRoom.idA)})</span>
                <span class="text-pink-400">⇄</span>
                <span>${escapeChatAdminHtml(activeRoom.nameB)} (ID:${escapeChatAdminHtml(activeRoom.idB)})</span>
            </div>
            <p class="text-[11px] text-gray-500 mt-0.5">房間代號：<span class="font-mono">${escapeChatAdminHtml(activeRoom.pairKey)}</span> ・ 共 ${totalRoomMsgs} 則訊息</p>
        </div>
        ${totalRoomMsgs > LIMIT_RECENT ? `
            <button type="button" onclick="toggleAdminChatShowAllMessages()" class="px-3 py-1.5 rounded-xl bg-white border border-pink-300 text-[#8f4452] text-xs font-semibold hover:bg-pink-50 transition shrink-0">
                ${adminChatShowAllMessages ? `🔽 僅顯示最近 ${LIMIT_RECENT} 則` : `📜 展開全部 ${totalRoomMsgs} 則訊息`}
            </button>
        ` : ''}
    `;

    const truncatedBannerHtml = isTruncated
        ? `<div class="text-center py-1.5">
                <button type="button" onclick="toggleAdminChatShowAllMessages()" class="text-[11px] px-3 py-1 rounded-full bg-pink-100 text-[#8f4452] font-semibold hover:bg-pink-200 transition">
                    ⬆️ 前方還有 ${totalRoomMsgs - LIMIT_RECENT} 則較早訊息（點擊展開全部）
                </button>
           </div>`
        : '';

    detailMsgsBox.innerHTML = truncatedBannerHtml + visibleMsgs.map(m => {
        const senderId = String(m.senderId || '');
        if (senderId === 'system' || m.sender === 'system') {
            return `
                <div class="text-center my-2">
                    <span class="inline-block px-3.5 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-[11px] text-[#8f4452] leading-relaxed">
                        ${highlightChatKeywordHtml(m.text || '', adminChatSearchKeyword)}
                    </span>
                </div>
            `;
        }

        const isSideB = (senderId === String(activeRoom.idB));
        const senderLabel = isSideB
            ? `${activeRoom.nameB} (ID:${activeRoom.idB})`
            : `${activeRoom.nameA} (ID:${activeRoom.idA})`;
        const timeDisplay = m.time || (m.ts ? new Date(Number(m.ts)).toLocaleString('zh-TW') : '');

        return `
            <div class="flex flex-col ${isSideB ? 'items-end' : 'items-start'}">
                <span class="text-[10px] font-semibold mb-0.5 px-1 ${isSideB ? 'text-[#c96a7b]' : 'text-sky-700'}">
                    ${escapeChatAdminHtml(senderLabel)}
                </span>
                <div class="max-w-[82%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed shadow-2xs whitespace-pre-wrap break-words ${isSideB ? 'bg-gradient-to-r from-[#e598a6] to-[#c96a7b] text-white rounded-br-xs' : 'bg-white border border-pink-200 text-gray-700 rounded-bl-xs'}">
                    ${highlightChatKeywordHtml(m.text || '', adminChatSearchKeyword)}
                </div>
                <span class="text-[10px] text-gray-400 mt-0.5 px-1">${escapeChatAdminHtml(timeDisplay)}</span>
            </div>
        `;
    }).join('');
}
