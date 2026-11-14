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

function openMailboxModal() {
    backToMailboxList();
    renderMailboxList();
    document.getElementById('mailboxModal').classList.remove('hidden');
}

function closeMailboxModal() {
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

function viewMailDetail(mailId) {
    const mails = getPlayerMails();
    const mail = mails.find(m => m.id === mailId);
    if (!mail) return;

    if (!Array.isArray(appState.readMailIds)) appState.readMailIds = [];
    if (!appState.readMailIds.includes(mailId)) {
        appState.readMailIds.push(mailId);
        Store.save(appState);
        updateMailboxBadge();
    }

    document.getElementById('mailDetailTitle').textContent = mail.title || '管理員通知信件';
    document.getElementById('mailDetailTime').textContent = mail.createdAt || '';
    document.getElementById('mailDetailBody').textContent = mail.content || '';

    document.getElementById('mailboxListView').classList.add('hidden');
    document.getElementById('mailboxDetailView').classList.remove('hidden');
}

function backToMailboxList() {
    document.getElementById('mailboxDetailView').classList.add('hidden');
    document.getElementById('mailboxListView').classList.remove('hidden');
    renderMailboxList();
}

// ==================== 問題回報（僅後台可見） ====================
function openReportModal() {
    const contactInput = document.getElementById('reportContact');
    if (!contactInput.value && (appState.playerId || appState.profile.nickname)) {
        contactInput.value = `ID:${appState.playerId || '未產生'} / ${appState.profile.nickname || ''}`;
    }
    document.getElementById('reportModal').classList.remove('hidden');
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

    Store.addIssueReport({ category, contact, content });
    this.reset();
    closeReportModal();
    showMiniNotice('📮 問題回報已送出', '此內容僅後台管理員看得到，我們會盡快確認處理。');
});

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
        return;
    }

    if (!appState.activeFriendId || !appState.friends.some(f => String(f.id) === String(appState.activeFriendId))) {
        appState.activeFriendId = String(appState.friends[0].id);
    }

    const nowTs = Date.now();
    listEl.innerHTML = appState.friends.map(friend => {
        const isActive = String(friend.id) === String(appState.activeFriendId);
        const remainDays = calcRemainingDays(friend.matchedAt, nowTs);
        return `
            <div onclick="selectFriend('${friend.id}')" class="cursor-pointer p-4 rounded-2xl border transition-all ${isActive ? 'bg-pink-50/90 border-[#c96a7b] shadow-md' : 'bg-white/80 border-pink-100 hover:border-pink-300'}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-11 h-11 rounded-full bg-gradient-to-br from-pink-200 to-rose-300 text-white font-bold flex items-center justify-center text-lg">
                            ${friend.nickname.slice(0, 1)}
                        </div>
                        <div>
                            <h4 class="font-bold text-[#8f4452] text-sm">${friend.nickname} <span class="text-[11px] font-normal text-[#c96a7b]">(${friend.profile.gender || '保密'})</span></h4>
                            <p class="text-[11px] text-gray-500">${friend.sessionLabel || '七日緣分'} ・ ${friend.profile.region ? friend.profile.region + ' ' : ''}${friend.profile.city || '同城緣分'}</p>
                        </div>
                    </div>
                    <span class="text-[11px] px-2.5 py-1 rounded-full ${remainDays === 0 ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-white text-[#c96a7b] border border-pink-200'}">
                        ${remainDays === 0 ? '⏳ 剩餘 0 天（禁止發話）' : `剩餘 ${remainDays} 天`}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    workspace.classList.remove('hidden');
    renderActiveFriendWorkspace();
}

function selectFriend(friendId) {
    appState.activeFriendId = String(friendId);
    Store.save(appState);
    renderFriendsSection();

    if (isEveningConfessionPending()) {
        openEveningConfessionModal();
    }
}

function renderActiveFriendWorkspace() {
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    document.getElementById('partnerCardName').textContent = `🌸 ${friend.nickname} 的開放檔案`;
    document.getElementById('chatHeaderTitle').textContent = `與 ${friend.nickname} 的戀愛對話窗`;

    const remainDays = calcRemainingDays(friend.matchedAt, Date.now());
    document.getElementById('partnerCardTimer').textContent = remainDays === 0
        ? '⚠️ 剩餘 0 天！聊天室已禁止發話，請決定要不要繼續配對'
        : `⏳ 剩餘 ${remainDays} 天（每天 20:00 自動 -1 天）`;

    const unlockedBox = document.getElementById('partnerUnlockedFields');
    let unlockedHtml = '';
    FIELD_SECTIONS.forEach(sec => {
        sec.fields.forEach(f => {
            if (f.key === 'nickname') return;
            const isVisible = f.alwaysOpen || (f.autoOpenAfter7Days ? Boolean(friend.igUnlocked) : (friend.privacy && friend.privacy[f.key] === 'open'));
            const val = friend.profile[f.key];
            if (isVisible && val && (!Array.isArray(val) || val.length > 0)) {
                let displayVal = val;
                if (f.key === 'city' && friend.profile.region) {
                    displayVal = `${friend.profile.region} ・ ${val}`;
                } else if (Array.isArray(val)) {
                    const otherTxt = friend.profile[`${f.key}Other`];
                    displayVal = val.map(v => (v === '其他' && otherTxt) ? `其他（${otherTxt}）` : v).join('、');
                } else if (f.allowOther && val === '其他' && friend.profile[`${f.key}Other`]) {
                    displayVal = `其他（${friend.profile[`${f.key}Other`]}）`;
                }
                unlockedHtml += `
                    <div class="p-2.5 rounded-xl bg-white border border-pink-100">
                        <span class="text-[11px] text-[#c96a7b] block">${f.label.split('（')[0]}</span>
                        <span class="font-medium text-gray-700">${displayVal}</span>
                    </div>
                `;
            }
        });
    });

    unlockedBox.innerHTML = unlockedHtml || `
        <div class="text-center py-6 text-gray-400">
            對方目前尚未開啟其他進階資料欄位，<br>先從聊天室打聲招呼吧！
        </div>
    `;

    const isChatBanned = Boolean(appState.isChatBanned);
    const pendingChoice = isEveningConfessionPending();
    const isZeroDays = remainDays === 0;
    const chatBannedBanner = document.getElementById('chatBannedBanner');
    const lockBanner = document.getElementById('confessionLockBanner');
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');

    if (isChatBanned) {
        chatBannedBanner.classList.remove('hidden');
        lockBanner.classList.add('hidden');
        chatInput.disabled = true;
        chatInput.value = '';
        chatInput.placeholder = '🚫 請聯繫管理員';
        chatInput.classList.add('!bg-gray-100', '!text-gray-400');
        chatSendBtn.disabled = true;
    } else if (pendingChoice) {
        chatBannedBanner.classList.add('hidden');
        lockBanner.classList.remove('hidden');
        chatInput.disabled = true;
        chatInput.value = '';
        chatInput.placeholder = '🔒 請先完成 20:00 心動抉擇才能聊天...';
        chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        chatSendBtn.disabled = true;
    } else if (isZeroDays) {
        chatBannedBanner.classList.add('hidden');
        lockBanner.classList.add('hidden');
        chatInput.disabled = true;
        chatInput.value = '';
        chatInput.placeholder = '🚫 剩餘 0 天，聊天室已禁止發話（請先選擇是否繼續配對）';
        chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        chatSendBtn.disabled = true;
    } else {
        chatBannedBanner.classList.add('hidden');
        lockBanner.classList.add('hidden');
        chatInput.disabled = false;
        chatInput.placeholder = '寫下想對他說的話...';
        chatInput.classList.remove('!bg-gray-100', '!text-gray-400');
        chatSendBtn.disabled = false;
    }

    const banner = document.getElementById('sevenDayDecisionBanner');
    const statusText = document.getElementById('sevenDayDecisionStatus');
    if (isZeroDays) {
        banner.classList.remove('hidden');
        if (friend.myContinue === true && friend.partnerContinue !== true) {
            statusText.innerHTML = `💖 你已按下「繼續配對」，聊天室仍暫停發話，正在等待 <strong>${friend.nickname}</strong> 按下繼續（雙方都按下後將再延後 7 天並重新開放聊天）...`;
        } else if (friend.partnerContinue === true && friend.myContinue !== true) {
            statusText.innerHTML = `💌 <strong>${friend.nickname}</strong> 已經按下「繼續配對」！只要你也按下「繼續配對」，雙方將再延後 7 天並繼續聊天！`;
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
    const currentSignature = `${appState.playerId || ''}_${friend.id}_${friend.messages.length}_${friend.messages[friend.messages.length - 1]?.id || friend.messages[friend.messages.length - 1]?.text || ''}`;

    chatBox.innerHTML = friend.messages.map(m => {
        if (m.senderId === 'system' || m.sender === 'system') {
            return `
                <div class="text-center my-2">
                    <span class="inline-block px-3.5 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-[11px] text-[#8f4452] leading-relaxed">
                        ${m.text}
                    </span>
                </div>
            `;
        }
        const isMe = m.senderId
            ? (String(m.senderId) === String(appState.playerId))
            : (m.sender === 'me');
        return `
            <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'}">
                ${!isMe ? `<span class="text-[10px] text-[#c96a7b] font-semibold mb-0.5 px-1">${friend.nickname}</span>` : ''}
                <div class="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-2xs ${isMe ? 'bg-gradient-to-r from-[#e598a6] to-[#c96a7b] text-white rounded-br-xs' : 'bg-white border border-pink-100 text-gray-700 rounded-bl-xs'}">
                    ${m.text}
                </div>
                <span class="text-[10px] text-gray-400 mt-1 px-1">${m.time || ''}</span>
            </div>
        `;
    }).join('');

    if (currentSignature !== lastRenderedChatSignature) {
        lastRenderedChatSignature = currentSignature;
        chatBox.scrollTop = chatBox.scrollHeight;
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
        Store.save(appState);
        renderActiveFriendWorkspace();
    } else {
        friend.messages.push({ sender: 'me', text, time: nowStr });
        input.value = '';
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

function recordMutualContinueVote(myId, partnerId, voterNickname, isSimulatedPartner = false) {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    const idA = String(myId);
    const idB = String(partnerId);
    const voterId = isSimulatedPartner ? idB : idA;

    const userA = users.find(u => String(u.id) === idA);
    const userB = users.find(u => String(u.id) === idB);
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

        Store.saveSharedUsers(users);

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
        Store.saveSharedUsers(users);

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

function respondSevenDayDecision(isContinue) {
    const friend = appState.friends.find(f => String(f.id) === String(appState.activeFriendId));
    if (!friend) return;

    if (!isContinue) {
        clearMutualFriendship(friend, `🍃 你選擇不繼續與 ${friend.nickname} 配對，兩邊好友名單已清空刪除。`);
        return;
    }

    const myNick = appState.profile.nickname || String(appState.playerId || '對方');
    const isRealFriend = !String(friend.id).startsWith('MOCK_FRIEND_') && !!appState.playerId;

    if (isRealFriend) {
        const completed = recordMutualContinueVote(appState.playerId, friend.id, myNick, false);
        Store.save(appState);
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
    Store.save(appState);
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
    Store.save(appState);
    refreshAllUI();
}

function clearMutualFriendship(friend, noticeMsg) {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    users.forEach(u => {
        if (String(u.id) === String(appState.playerId)) {
            if (Array.isArray(u.matchedHistory)) {
                u.matchedHistory = u.matchedHistory.filter(h => String(h.partnerId) !== String(friend.id));
            }
            if (String(u.matchedWithId) === String(friend.id)) {
                u.matchedSession = null;
                u.matchedWithId = null;
                u.matchedWithName = null;
                u.matchedAt = null;
            }
        }
        if (String(u.id) === String(friend.id)) {
            if (Array.isArray(u.matchedHistory)) {
                u.matchedHistory = u.matchedHistory.filter(h => String(h.partnerId) !== String(appState.playerId));
            }
            if (String(u.matchedWithId) === String(appState.playerId)) {
                u.matchedSession = null;
                u.matchedWithId = null;
                u.matchedWithName = null;
                u.matchedAt = null;
            }
        }
    });
    Store.saveSharedUsers(users);

    // 直接解除配對時，才清空雙方聊天歷史紀錄
    if (appState.playerId && friend.id) {
        ChatStore.clearChat(appState.playerId, friend.id);
        lastChatsSnapshot = localStorage.getItem(CHATS_KEY) || '';
    }

    appState.friends = appState.friends.filter(f => String(f.id) !== String(friend.id));
    if (appState.matchedSession === friend.sessionLabel) {
        appState.matchedSession = null;
    }
    if (appState.friends.length < 2) {
        appState.multiFriendSince = null;
        appState.confessionUnlockAt = null;
    }
    Store.save(appState);
    refreshAllUI();
    if (noticeMsg) showMiniNotice('🍃 好友名單已清空', noticeMsg);
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
