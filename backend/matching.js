/* backend/matching.js - 後台 20:00 自動配對演算法、秘密強制配對通道與測試工具 */

function escapeMaintenanceHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function collectMatchAndChatDiscrepancies() {
    const users = getUsers();
    const chatsMap = (typeof getAdminChatsMap === 'function')
        ? getAdminChatsMap()
        : JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');

    const userMap = new Map();
    users.forEach(u => {
        if (u && u.id) {
            const pid = String(u.id).trim();
            if (pid) userMap.set(pid, u);
        }
    });

    const getUserMatchedPartnerIds = (u) => {
        const set = new Set();
        if (!u || typeof u !== 'object') return set;
        if (Array.isArray(u.matchedHistory)) {
            u.matchedHistory.forEach(h => {
                const pid = String((h && h.partnerId) || '').trim();
                if (pid && pid !== String(u.id).trim()) set.add(pid);
            });
        }
        const curMid = String(u.matchedWithId || '').trim();
        if (curMid && curMid !== String(u.id).trim()) {
            set.add(curMid);
        }
        return set;
    };

    const userMatchSets = new Map();
    users.forEach(u => {
        if (u && u.id) {
            const uid = String(u.id).trim();
            userMatchSets.set(uid, getUserMatchedPartnerIds(u));
        }
    });

    const allPairKeys = new Set();
    const chatInfoByPair = new Map();

    // 1. Collect pairs from member list
    userMatchSets.forEach((partnerSet, uid) => {
        partnerSet.forEach(pid => {
            if (!uid || !pid || uid === pid) return;
            const pk = [uid, pid].sort().join('__');
            allPairKeys.add(pk);
        });
    });

    // 2. Collect pairs from chat rooms
    Object.entries(chatsMap || {}).forEach(([pairKey, rawThread]) => {
        const parts = String(pairKey || '').split('__').map(s => s.trim()).filter(Boolean);
        if (parts.length !== 2 || parts[0] === parts[1]) return;
        const msgs = Array.isArray(rawThread)
            ? rawThread.filter(m => m && typeof m === 'object')
            : (rawThread && typeof rawThread === 'object'
                ? Object.values(rawThread).filter(m => m && typeof m === 'object')
                : []);
        if (msgs.length === 0) return;

        msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
        const lastMsg = msgs[msgs.length - 1] || {};
        const canonicalKey = [parts[0], parts[1]].sort().join('__');
        allPairKeys.add(canonicalKey);
        chatInfoByPair.set(canonicalKey, {
            msgCount: msgs.length,
            lastTime: String(lastMsg.dateTime || lastMsg.time || '').trim()
        });
    });

    const discrepancies = [];
    Array.from(allPairKeys).sort().forEach(pk => {
        const [idA, idB] = pk.split('__');
        const userA = userMap.get(idA) || null;
        const userB = userMap.get(idB) || null;
        const setA = userMatchSets.get(idA) || new Set();
        const setB = userMatchSets.get(idB) || new Set();

        const aHasB = Boolean(userA && setA.has(idB));
        const bHasA = Boolean(userB && setB.has(idA));
        const chatInfo = chatInfoByPair.get(pk) || null;
        const hasChat = Boolean(chatInfo && chatInfo.msgCount > 0);

        const isConsistent = Boolean(userA && userB && aHasB && bHasA && hasChat);
        if (isConsistent) return;

        const nameA = userA ? (userA.nickname || `玩家_${idA}`) : `不存在/已刪除玩家_${idA}`;
        const nameB = userB ? (userB.nickname || `玩家_${idB}`) : `不存在/已刪除玩家_${idB}`;

        let reasonBadge = '';
        let memberStatusDesc = '';
        let chatStatusDesc = '';

        if ((aHasB || bHasA) && !hasChat) {
            if (aHasB && bHasA) {
                reasonBadge = '⚠️ 會員列表有配對・聊天紀錄無對話';
                memberStatusDesc = `雙方名單皆有對方（${idA} 有 ${idB}、${idB} 有 ${idA}）`;
            } else if (aHasB) {
                reasonBadge = '⚠️ 會員列表僅單方有配對・聊天紀錄無對話';
                memberStatusDesc = `僅 ${idA} 名單有 ${idB}（${idB} 名單無 ${idA}）`;
            } else {
                reasonBadge = '⚠️ 會員列表僅單方有配對・聊天紀錄無對話';
                memberStatusDesc = `僅 ${idB} 名單有 ${idA}（${idA} 名單無 ${idB}）`;
            }
            chatStatusDesc = '無聊天室對話紀錄（0 則訊息）';
        } else if (hasChat && (aHasB !== bHasA)) {
            reasonBadge = '⚠️ 會員列表單方遺漏配對・聊天紀錄有對話';
            memberStatusDesc = aHasB
                ? `僅 ${idA} 名單有 ${idB}（${idB} 名單遺漏 ${idA}）`
                : `僅 ${idB} 名單有 ${idA}（${idA} 名單遺漏 ${idB}）`;
            chatStatusDesc = `有聊天室紀錄（共 ${chatInfo.msgCount} 則${chatInfo.lastTime ? `・最後 ${chatInfo.lastTime}` : ''}）`;
        } else if (hasChat && !aHasB && !bHasA) {
            reasonBadge = '⚠️ 會員列表雙方皆無配對・聊天紀錄仍殘留';
            memberStatusDesc = `雙方名單皆無對方`;
            chatStatusDesc = `殘留聊天室紀錄（共 ${chatInfo.msgCount} 則${chatInfo.lastTime ? `・最後 ${chatInfo.lastTime}` : ''}）`;
        } else {
            reasonBadge = '⚠️ 配對對象不存在於會員列表';
            memberStatusDesc = `${!userA ? `ID:${idA} 不存在` : ''}${(!userA && !userB) ? '、' : ''}${!userB ? `ID:${idB} 不存在` : ''}`;
            chatStatusDesc = hasChat ? `有聊天室紀錄（共 ${chatInfo.msgCount} 則）` : '無聊天室紀錄（0 則）';
        }

        discrepancies.push({
            pairKey: pk,
            idA,
            idB,
            nameA,
            nameB,
            userAExists: Boolean(userA),
            userBExists: Boolean(userB),
            aHasB,
            bHasA,
            hasChat,
            msgCount: chatInfo ? chatInfo.msgCount : 0,
            reasonBadge,
            memberStatusDesc,
            chatStatusDesc
        });
    });

    return discrepancies;
}

function runRepairMatchesFromChats(silentWhenClean = false) {
    const resultEl = document.getElementById('repairMatchesResult');
    if (!resultEl) return;

    const discrepancies = collectMatchAndChatDiscrepancies();
    resultEl.classList.remove('hidden');

    if (discrepancies.length === 0) {
        resultEl.innerHTML = `
            <div class="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 font-semibold">
                ✅ 檢查完成：所有「會員列表配對」與「玩家聊天紀錄」數據皆完全一致，沒有異常項目。
            </div>
        `;
        return;
    }

    const cardsHtml = discrepancies.map((item, idx) => {
        const canRepairBoth = item.userAExists && item.userBExists;
        return `
            <div class="p-3 rounded-xl bg-rose-50/65 border border-rose-200 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 text-xs">
                <div class="min-w-0 flex-1 space-y-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-[10px] font-mono text-gray-500">#${idx + 1}</span>
                        <span class="px-2 py-0.5 rounded-full bg-rose-100 border border-rose-300 text-rose-800 text-[11px] font-bold">
                            ${escapeMaintenanceHtml(item.reasonBadge)}
                        </span>
                    </div>
                    <div class="font-bold text-[#8f4452] text-xs sm:text-sm">
                        ${escapeMaintenanceHtml(item.nameA)} (ID:${escapeMaintenanceHtml(item.idA)})
                        <span class="text-pink-400 mx-1">⇄</span>
                        ${escapeMaintenanceHtml(item.nameB)} (ID:${escapeMaintenanceHtml(item.idB)})
                    </div>
                    <div class="text-[11px] text-gray-600 space-y-0.5">
                        <div>📋 <strong>會員列表：</strong>${escapeMaintenanceHtml(item.memberStatusDesc)}</div>
                        <div>💬 <strong>聊天紀錄：</strong>${escapeMaintenanceHtml(item.chatStatusDesc)}</div>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 shrink-0">
                    <button type="button" onclick="manualResolveUnmatchPair('${escapeMaintenanceHtml(item.idA)}', '${escapeMaintenanceHtml(item.idB)}')"
                        class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold shadow-2xs transition">
                        💔 解除配對（同步移除）
                    </button>
                    ${canRepairBoth ? `
                        <button type="button" onclick="manualResolveSyncPair('${escapeMaintenanceHtml(item.idA)}', '${escapeMaintenanceHtml(item.idB)}')"
                            class="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 text-[11px] font-semibold transition">
                            🔄 補齊雙向配對與聊天室
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    resultEl.innerHTML = `
        <div class="p-3 rounded-xl bg-amber-50 border border-amber-300 space-y-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-bold text-amber-900">
                    ⚠️ 共檢查出 ${discrepancies.length} 組「會員列表」與「聊天紀錄」數據不一致的配對，請手動選擇處理方式：
                </span>
                ${discrepancies.length > 1 ? `
                    <button type="button" onclick="manualBatchUnmatchAllDiscrepancies()"
                        class="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-bold shadow-2xs transition">
                        💔 一鍵全部解除異常配對 (${discrepancies.length} 組)
                    </button>
                ` : ''}
            </div>
            <div class="space-y-2">
                ${cardsHtml}
            </div>
        </div>
    `;
}

function applyUnmatchPairToUsersList(users, idA, idB) {
    const pidA = String(idA || '').trim();
    const pidB = String(idB || '').trim();
    if (!pidA || !pidB) return false;

    let changed = false;
    users.forEach(u => {
        if (!u || !u.id) return;
        const uid = String(u.id).trim();
        if (uid !== pidA && uid !== pidB) return;

        const partnerId = (uid === pidA) ? pidB : pidA;
        if (Array.isArray(u.matchedHistory)) {
            const nextHist = u.matchedHistory.filter(h => String(h.partnerId) !== partnerId);
            if (nextHist.length !== u.matchedHistory.length) {
                u.matchedHistory = nextHist;
                changed = true;
            }
        }
        if (String(u.matchedWithId) === partnerId) {
            const lastItem = (Array.isArray(u.matchedHistory) && u.matchedHistory.length > 0)
                ? u.matchedHistory[u.matchedHistory.length - 1]
                : null;
            u.matchedSession = lastItem ? (lastItem.session || null) : null;
            u.matchedWithId = lastItem ? (lastItem.partnerId || null) : null;
            u.matchedWithName = lastItem ? (lastItem.partnerName || null) : null;
            u.matchedAt = lastItem ? (lastItem.matchedAt || null) : null;
            changed = true;
        }
    });

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.markPairUnmatched === 'function') {
        CloudSync.markPairUnmatched(pidA, pidB);
    }
    if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
        ChatStore.clearChat(pidA, pidB);
    } else {
        const pairKey = [pidA, pidB].sort().join('__');
        const allChats = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
        if (Object.prototype.hasOwnProperty.call(allChats, pairKey)) {
            delete allChats[pairKey];
            localStorage.setItem(CHATS_KEY, JSON.stringify(allChats));
        }
        if (typeof CloudSync !== 'undefined') {
            CloudSync.deleteNode(`${CHATS_KEY}/${pairKey}`);
        }
    }

    return changed;
}

function manualResolveUnmatchPair(idA, idB) {
    const pidA = String(idA || '').trim();
    const pidB = String(idB || '').trim();
    if (!pidA || !pidB) return;

    const users = getUsers();
    const uA = users.find(u => String(u.id) === pidA);
    const uB = users.find(u => String(u.id) === pidB);
    const labelA = uA ? `${uA.nickname} (ID:${pidA})` : `ID:${pidA}`;
    const labelB = uB ? `${uB.nickname} (ID:${pidB})` : `ID:${pidB}`;

    if (!confirm(`確定要手動解除「${labelA}」與「${labelB}」的配對嗎？
解除後將同步移除雙方會員列表配對紀錄與殘留聊天室，前台好友名單亦會同步更新。`)) {
        return;
    }

    applyUnmatchPairToUsersList(users, pidA, pidB);
    if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
        AdminMemoryCache.invalidate('users');
        AdminMemoryCache.invalidate('chats');
    }
    saveUsers(users, { isMatchMutation: true });
    appendLog(`<span class="text-amber-300">[資料維護解除配對]</span> 管理員已手動解除異常配對 <strong>${labelA}</strong> ⇄ <strong>${labelB}</strong>，雙方名單與聊天紀錄已同步清理。`);
    runRepairMatchesFromChats(true);
}

function manualBatchUnmatchAllDiscrepancies() {
    const discrepancies = collectMatchAndChatDiscrepancies();
    if (discrepancies.length === 0) return;

    if (!confirm(`確定要一鍵解除全部 ${discrepancies.length} 組異常配對嗎？
解除後將同步移除這些組合的會員列表配對與殘留聊天紀錄，此動作無法復原。`)) {
        return;
    }

    const users = getUsers();
    discrepancies.forEach(item => {
        applyUnmatchPairToUsersList(users, item.idA, item.idB);
    });

    if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
        AdminMemoryCache.invalidate('users');
        AdminMemoryCache.invalidate('chats');
    }
    saveUsers(users, { isMatchMutation: true });
    appendLog(`<span class="text-amber-300">[資料維護批次解除]</span> 管理員已一鍵解除全部 ${discrepancies.length} 組不一致的配對紀錄。`);
    runRepairMatchesFromChats(true);
}

function manualResolveSyncPair(idA, idB) {
    const pidA = String(idA || '').trim();
    const pidB = String(idB || '').trim();
    if (!pidA || !pidB) return;

    const users = getUsers();
    const uA = users.find(u => String(u.id) === pidA);
    const uB = users.find(u => String(u.id) === pidB);
    if (!uA || !uB) {
        alert('其中一方玩家已不存在於會員列表中，無法補齊雙向配對，請改用「解除配對」。');
        return;
    }

    if (!confirm(`確定要保留並補齊「${uA.nickname} (ID:${pidA})」與「${uB.nickname} (ID:${pidB})」的雙向配對與聊天室紀錄嗎？`)) {
        return;
    }

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.clearPairUnmatched === 'function') {
        CloudSync.clearPairUnmatched(pidA, pidB);
    }

    const nowTs = Date.now();
    uA.matchedHistory = Array.isArray(uA.matchedHistory) ? uA.matchedHistory : [];
    uB.matchedHistory = Array.isArray(uB.matchedHistory) ? uB.matchedHistory : [];

    const existingInA = uA.matchedHistory.find(h => String(h.partnerId) === pidB);
    const existingInB = uB.matchedHistory.find(h => String(h.partnerId) === pidA);
    const sharedSession = (existingInA && existingInA.session) || (existingInB && existingInB.session) || uA.matchedSession || uB.matchedSession || '資料維護補齊配對';
    const sharedMatchedAt = Number((existingInA && existingInA.matchedAt) || (existingInB && existingInB.matchedAt) || nowTs);

    if (!existingInA) {
        uA.matchedHistory.push({
            partnerId: pidB,
            partnerName: uB.nickname || `玩家_${pidB}`,
            session: sharedSession,
            matchedAt: sharedMatchedAt,
            igUnlocked: Boolean(existingInB && existingInB.igUnlocked),
            continueVotes: []
        });
    }
    if (!existingInB) {
        uB.matchedHistory.push({
            partnerId: pidA,
            partnerName: uA.nickname || `玩家_${pidA}`,
            session: sharedSession,
            matchedAt: sharedMatchedAt,
            igUnlocked: Boolean(existingInA && existingInA.igUnlocked),
            continueVotes: []
        });
    }

    if (!uA.matchedWithId) {
        uA.matchedWithId = pidB;
        uA.matchedWithName = uB.nickname || `玩家_${pidB}`;
        uA.matchedSession = sharedSession;
        uA.matchedAt = sharedMatchedAt;
    }
    if (!uB.matchedWithId) {
        uB.matchedWithId = pidA;
        uB.matchedWithName = uA.nickname || `玩家_${pidA}`;
        uB.matchedSession = sharedSession;
        uB.matchedAt = sharedMatchedAt;
    }

    if (typeof ChatStore !== 'undefined' && typeof ChatStore.ensureThread === 'function') {
        ChatStore.ensureThread(pidA, pidB, [{
            senderId: 'system',
            text: '🌸 月老已為你們補齊雙向紅線配對紀錄，祝聊天愉快！',
            ts: nowTs
        }]);
    }

    if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
        AdminMemoryCache.invalidate('users');
        AdminMemoryCache.invalidate('chats');
    }
    saveUsers(users, { isMatchMutation: true });
    appendLog(`<span class="text-emerald-300">[資料維護補齊]</span> 管理員已補齊 <strong>${uA.nickname} (ID:${pidA})</strong> ⇄ <strong>${uB.nickname} (ID:${pidB})</strong> 的雙向配對與聊天室紀錄。`);
    runRepairMatchesFromChats(true);
}

function adminFillPlayerFullData() {
    let targetId = document.getElementById('fillTargetPlayerId').value.trim();
    const frontendState = JSON.parse(localStorage.getItem(FRONTEND_STORAGE_KEY) || '{}');
    if (!targetId && frontendState.playerId) {
        targetId = String(frontendState.playerId);
        document.getElementById('fillTargetPlayerId').value = targetId;
    }
    if (!targetId) {
        targetId = '10001';
        document.getElementById('fillTargetPlayerId').value = targetId;
    }

    const isFemale = String(targetId).startsWith('2');
    const fullDemoData = {
        id: String(targetId),
        nickname: isFemale ? `晴子_${targetId}` : `阿哲_${targetId}`,
        ig: `@user_${targetId}`,
        gender: isFemale ? '女' : '男',
        targetGender: isFemale ? '男生' : '女生',
        age: '26',
        minAge: '22',
        maxAge: '32',
        region: '中部',
        city: '台中市',
        zodiac: isFemale ? '天秤座' : '射手座',
        distance: '同縣市',
        status: '上班族',
        statusOther: '',
        school: '逢甲大學',
        job: '產品設計 / 行銷企劃',
        height: isFemale ? '163' : '178',
        minHeight: isFemale ? '170' : '155',
        bmi: '18.5~24(正常區間)',
        targetBmi: '都可以',
        hasPet: '貓',
        likesPets: '是',
        smoking: '不會',
        acceptSmoking: '不行',
        drinking: '社交場合',
        acceptDrinking: '都可以',
        lookingFor: '認真交往',
        relationshipStatus: '已經準備好認識新的人了（可以進入戀愛的狀態）',
        appearancePriority: '有點在意，但個性優先(重要性：個性 7 外表 3)',
        contactFrequency: '剛剛好：每天聊一下就好，有空就多聊一點',
        connectWay: '先文字訊息聊天再說',
        datingPace: '順其自然，看相處狀況',
        loveExp: '1～2 任',
        targetLoveExp: '不介意',
        conflictStyle: '稍微緩一下再說',
        personalSpace: '3（適中）',
        dateCost: '輪流請',
        attachmentSelf: '安全型：信任對方，能親密也能各自獨立',
        attachmentTarget: '安全型',
        mbti: isFemale ? 'INFJ' : 'ENFP',
        relationshipGoal: '中長期：認真交往，希望走得長久，未來再看是否結婚',
        hobbies: ['美食咖啡廳', '電影', '旅行', '寵物'],
        hobbiesOther: '',
        oneSentence: '嗨！希望在七天的時間裡，能跟你分享彼此的生活點滴。',
        bio: '平常喜歡週末探店喝咖啡、看電影與散步，個性溫和好相處，期待遇見頻率契合的你。',
        idealPartner: '善良、情緒穩定、願意溝通分享日常的人。',
        icebreakerQuestion: '你週末最喜歡去哪裡放鬆或探店？',
        isWarned: false,
        warningReason: ''
    };

    const users = getUsers();
    const idx = users.findIndex(u => String(u.id) === String(targetId));
    if (idx >= 0) {
        users[idx] = { ...users[idx], ...fullDemoData };
    } else {
        users.push({ ...fullDemoData, isMatchBanned: false, isChatBanned: false, registeredSessions: [], exactMatchCriteria: {}, matchedHistory: [], matchedSession: null, matchedWithId: null, matchedWithName: null });
    }
    saveUsers(users);

    localStorage.setItem('yuelao_test_event', JSON.stringify({
        id: 'CMD_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        type: 'FILL_PLAYER_DATA',
        targetPlayerId: String(targetId),
        ts: Date.now()
    }));

    appendLog(`<span class="text-emerald-300">[一鍵填滿資料]</span> 已將玩家 ID:<strong>${targetId}</strong> 的全部個人資料填寫完成並同步至前台！`);
}

function resolveLinkFriendCTargetId() {
    const inputEl = document.getElementById('linkFriendCTargetId');
    let targetId = inputEl ? inputEl.value.trim() : '';
    const frontendState = JSON.parse(localStorage.getItem(FRONTEND_STORAGE_KEY) || '{}');
    if (!targetId && frontendState.playerId) {
        targetId = String(frontendState.playerId);
        if (inputEl) inputEl.value = targetId;
    }
    return targetId;
}

function getLinkedMockFriendsForTarget(targetId) {
    const pid = String(targetId || '').trim();
    if (!pid) return [];
    const seen = new Map();
    const collectFromState = (rawStr) => {
        if (!rawStr) return;
        try {
            const st = JSON.parse(rawStr);
            if (!st || String(st.playerId || '') !== pid || !Array.isArray(st.friends)) return;
            st.friends.forEach(f => {
                if (f && String(f.id).startsWith('MOCK_FRIEND_')) {
                    seen.set(String(f.id), f);
                }
            });
        } catch (e) {}
    };
    collectFromState(localStorage.getItem(PLAYER_STATE_PREFIX + pid));
    collectFromState(localStorage.getItem(FRONTEND_STORAGE_KEY));
    return Array.from(seen.values());
}

function mutateLocalMockFriendsForTarget(targetId, filterKeepFn) {
    const pid = String(targetId || '').trim();
    if (!pid) return 0;
    let removedCount = 0;

    const patchStateKey = (storageKey) => {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        try {
            const st = JSON.parse(raw);
            if (!st || String(st.playerId || '') !== pid || !Array.isArray(st.friends)) return;
            const beforeLen = st.friends.length;
            st.friends = st.friends.filter(f => {
                if (!f || !String(f.id).startsWith('MOCK_FRIEND_')) return true;
                return filterKeepFn(f);
            });
            const diff = beforeLen - st.friends.length;
            if (diff > removedCount) removedCount = diff;
            if (diff > 0) {
                if (st.activeFriendId && !st.friends.some(f => String(f.id) === String(st.activeFriendId))) {
                    st.activeFriendId = st.friends[0] ? String(st.friends[0].id) : null;
                }
                if (st.friends.length < 2) {
                    st.multiFriendSince = null;
                    st.confessionUnlockAt = null;
                }
                localStorage.setItem(storageKey, JSON.stringify(st));
            }
        } catch (e) {}
    };

    patchStateKey(PLAYER_STATE_PREFIX + pid);
    patchStateKey(FRONTEND_STORAGE_KEY);
    return removedCount;
}

function renderLinkedMockFriendsList() {
    const box = document.getElementById('linkedMockFriendsList');
    if (!box) return;
    const inputEl = document.getElementById('linkFriendCTargetId');
    let targetId = inputEl ? inputEl.value.trim() : '';
    if (!targetId) {
        const frontendState = JSON.parse(localStorage.getItem(FRONTEND_STORAGE_KEY) || '{}');
        if (frontendState.playerId) {
            targetId = String(frontendState.playerId);
            if (inputEl && document.activeElement !== inputEl) {
                inputEl.value = targetId;
            }
        }
    }
    if (!targetId) {
        box.innerHTML = `<span class="text-[11px] text-gray-400">請輸入玩家 ID 後可新增或刪除測試好友。</span>`;
        return;
    }

    const mockList = getLinkedMockFriendsForTarget(targetId);
    if (mockList.length === 0) {
        box.innerHTML = `<span class="text-[11px] text-gray-400">玩家 ID：<strong>${targetId}</strong> 目前尚無測試 C 連動好友（若前台在另一瀏覽器開啟，可直接點「刪除一位測試好友」或「清空測試好友」同步移除）。</span>`;
        return;
    }

    box.innerHTML = `
        <div class="flex flex-wrap items-center gap-1.5 pt-1">
            <span class="text-[11px] font-bold text-[#8f4452]">玩家 ID:${targetId} 目前測試好友（${mockList.length} 位）：</span>
            ${mockList.map(f => `
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-pink-100 border border-pink-300 text-[#8f4452] font-semibold text-[11px]">
                    <span>💞 ${f.nickname}</span>
                    <button type="button" onclick="adminRemoveSpecificFriendC('${targetId}', '${f.id}')" title="刪除此測試好友" class="text-rose-600 hover:text-rose-900 font-bold ml-0.5">✕</button>
                </span>
            `).join('')}
        </div>
    `;
}

function adminLinkFriendCToPlayer() {
    const targetId = resolveLinkFriendCTargetId();
    if (!targetId) {
        alert('請輸入需要聯動的玩家 ID！');
        return;
    }

    triggerFrontendTestEvent('ADD_FRIEND_C', targetId);
    setTimeout(renderLinkedMockFriendsList, 350);
    setTimeout(renderLinkedMockFriendsList, 1200);
}

function adminRemoveOneFriendCFromPlayer() {
    const targetId = resolveLinkFriendCTargetId();
    if (!targetId) {
        alert('請輸入要刪除測試好友的玩家 ID！');
        return;
    }

    const mockList = getLinkedMockFriendsForTarget(targetId);
    const lastMock = mockList[mockList.length - 1];
    if (lastMock) {
        mutateLocalMockFriendsForTarget(targetId, f => String(f.id) !== String(lastMock.id));
        triggerFrontendTestEvent('REMOVE_FRIEND_C', targetId, { mockFriendId: String(lastMock.id) });
        appendLog(`<span class="text-amber-300">[刪除測試好友]</span> 已移除玩家 ID:<strong>${targetId}</strong> 的測試好友「<strong>${lastMock.nickname}</strong>」。`);
    } else {
        triggerFrontendTestEvent('REMOVE_FRIEND_C', targetId);
        appendLog(`<span class="text-amber-300">[刪除測試好友]</span> 已發送移除指令至玩家 ID:<strong>${targetId}</strong>，前台將刪除最後一位測試好友。`);
    }
    renderLinkedMockFriendsList();
}

function adminRemoveSpecificFriendC(targetId, mockFriendId) {
    const pid = String(targetId || '').trim();
    const mid = String(mockFriendId || '').trim();
    if (!pid || !mid) return;

    const mockList = getLinkedMockFriendsForTarget(pid);
    const targetFriend = mockList.find(f => String(f.id) === mid);
    mutateLocalMockFriendsForTarget(pid, f => String(f.id) !== mid);
    triggerFrontendTestEvent('REMOVE_FRIEND_C', pid, { mockFriendId: mid });
    renderLinkedMockFriendsList();
    appendLog(`<span class="text-amber-300">[刪除測試好友]</span> 已移除玩家 ID:<strong>${pid}</strong> 的測試好友${targetFriend ? `「<strong>${targetFriend.nickname}</strong>」` : ''}。`);
}

function adminClearAllFriendCFromPlayer() {
    const targetId = resolveLinkFriendCTargetId();
    if (!targetId) {
        alert('請輸入要清空測試好友的玩家 ID！');
        return;
    }

    const removed = mutateLocalMockFriendsForTarget(targetId, () => false);
    triggerFrontendTestEvent('CLEAR_ALL_FRIEND_C', targetId);
    renderLinkedMockFriendsList();
    appendLog(`<span class="text-amber-300">[清空測試好友]</span> 已清空玩家 ID:<strong>${targetId}</strong> 的全部測試 C 連動好友${removed > 0 ? `（共 ${removed} 位）` : ''}。`);
}

function adminTriggerConfessionForPlayer() {
    const inputEl = document.getElementById('triggerConfessionTargetId');
    const statusEl = document.getElementById('triggerConfessionStatusText');
    const targetId = inputEl ? inputEl.value.trim() : '';

    if (!targetId) {
        alert('請先輸入要觸發心動抉擇的玩家 ID（例如：10001）！');
        if (inputEl) inputEl.focus();
        return;
    }

    const users = getUsers();
    const targetUser = users.find(u => String(u.id) === String(targetId));
    if (!targetUser) {
        alert(`找不到玩家 ID「${targetId}」，請確認該玩家已完成資料保存！`);
        if (inputEl) inputEl.focus();
        return;
    }

    const partnerIdSet = new Set();
    const normHist = (typeof CloudSync !== 'undefined' && typeof CloudSync.normalizeMatchedHistoryList === 'function')
        ? CloudSync.normalizeMatchedHistoryList(targetUser.matchedHistory)
        : (Array.isArray(targetUser.matchedHistory) ? targetUser.matchedHistory : []);
    normHist.forEach(h => {
        if (h && h.partnerId) partnerIdSet.add(String(h.partnerId).trim());
    });
    if (targetUser.matchedWithId) {
        partnerIdSet.add(String(targetUser.matchedWithId).trim());
    }
    const mockFriends = getLinkedMockFriendsForTarget(targetId);
    mockFriends.forEach(mf => {
        if (mf && mf.id) partnerIdSet.add(String(mf.id).trim());
    });

    const totalFriendCount = partnerIdSet.size;
    if (totalFriendCount < 2) {
        alert(`⚠️ 玩家「${targetUser.nickname || targetId} (ID:${targetId})」目前僅有 ${totalFriendCount} 位好友。\n\n必須擁有「2 位以上好友」才能觸發心動抉擇！\n（可先為該玩家配對或使用下方「連動新增一位好友」加至 2 位以上好友）`);
        return;
    }

    const triggerToken = 'CONF_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    targetUser.forceConfessionTriggerId = triggerToken;
    saveUsers(users);

    // 同步更新同瀏覽器本地快取中的玩家狀態（若該玩家已於本機登入）
    const patchLocalPlayerConfession = (storageKey) => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const st = JSON.parse(raw);
            if (!st || String(st.playerId || '') !== String(targetId)) return;
            st.confessionUnlockAt = Date.now() - 1000;
            st.lastConfessionDate = null;
            localStorage.setItem(storageKey, JSON.stringify(st));
        } catch (e) {}
    };
    patchLocalPlayerConfession(PLAYER_STATE_PREFIX + String(targetId));
    patchLocalPlayerConfession(FRONTEND_STORAGE_KEY);

    triggerFrontendTestEvent('ADVANCE_CONFESSION_2000', targetId, { triggerToken });

    if (statusEl) {
        statusEl.innerHTML = `<span class="text-emerald-700 font-bold">✅ 已於 ${new Date().toLocaleTimeString('zh-TW')} 為玩家「${targetUser.nickname || targetId} (ID:${targetId})」（目前 ${totalFriendCount} 位好友）觸發心動抉擇！</span>`;
    }
    appendLog(`<span class="text-pink-300">[指定觸發心動抉擇]</span> 已為玩家 <strong>${targetUser.nickname || targetId} (ID:${targetId})</strong>（共 ${totalFriendCount} 位好友）直接觸發 20:00 心動抉擇！`);
    alert(`💘 已成功為玩家「${targetUser.nickname || targetId} (ID:${targetId})」觸發心動抉擇！\n\n目前好友數：${totalFriendCount} 位\n該玩家前台（含目前在線或稍後開啟／重新整理）將立即彈出心動抉擇視窗。`);
}

function triggerFrontendTestEvent(type, targetPlayerId = '', extraPayload = {}) {
    if (type === 'MINUS_ONE_DAY' || type === 'EXPIRE_TO_ZERO_DAYS') {
        const users = getUsers();
        const dayMs = 24 * 60 * 60 * 1000;
        const expiredTs = Date.now() - 8 * dayMs;
        let updatedAny = false;

        users.forEach(u => {
            if (Array.isArray(u.matchedHistory)) {
                u.matchedHistory.forEach(h => {
                    h.matchedAt = (type === 'MINUS_ONE_DAY')
                        ? ((h.matchedAt || Date.now()) - dayMs)
                        : expiredTs;
                    updatedAny = true;
                });
            }
            if (u.matchedWithId) {
                u.matchedAt = (type === 'MINUS_ONE_DAY')
                    ? ((u.matchedAt || Date.now()) - dayMs)
                    : expiredTs;
                updatedAny = true;
            }
        });

        if (updatedAny) {
            saveUsers(users);
        }
    }

    const cmdObj = {
        id: 'CMD_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        type: type,
        targetPlayerId: String(targetPlayerId || '').trim(),
        ts: Date.now(),
        ...extraPayload
    };
    localStorage.setItem('yuelao_test_event', JSON.stringify(cmdObj));
    if (typeof CloudSync !== 'undefined') {
        CloudSync.putNode('yuelao_test_event', cmdObj);
    }
    const targetDesc = targetPlayerId ? `（指定玩家 ID：${targetPlayerId}）` : '';
    appendLog(`<span class="text-sky-300">[連動前台指令]</span> 已發送 <strong>${type}</strong>${targetDesc}，前台視窗將即時同步更新！`);
}

function checkAutoSchedule2000() {
    const now = new Date();
    let target = new Date(now);
    target.setHours(20, 0, 0, 0);

    if ((target.getDay() === 3 || target.getDay() === 6) && now >= target) {
        target.setDate(target.getDate() + 1);
    }
    while (target.getDay() !== 3 && target.getDay() !== 6) {
        target.setDate(target.getDate() + 1);
    }

    const diff = target - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    const dayLabel = target.getDay() === 3 ? '週三' : '週六';
    const cdEl = document.getElementById('adminCountdownText'); if (cdEl) cdEl.textContent =
        `距離下次 ${dayLabel} 20:00 自動配對：${days}天 ${String(hours).padStart(2, '0')}時 ${String(mins).padStart(2, '0')}分 ${String(secs).padStart(2, '0')}秒`;

    const day = now.getDay();
    if ((day === 3 || day === 6) && now.getHours() >= 20) {
        const dateKey = `${now.toDateString()}_2000`;
        const executedMap = JSON.parse(localStorage.getItem(AUTO_RUN_LOG_KEY) || '{}');
        if (!executedMap[dateKey]) {
            executedMap[dateKey] = true;
            localStorage.setItem(AUTO_RUN_LOG_KEY, JSON.stringify(executedMap));
            CloudSync.putNode(AUTO_RUN_LOG_KEY, executedMap);
            const sched = getBatchScheduleInfo(getCurrentBatch());
            const autoSession = day === 3 ? sched.wedLabel : sched.satLabel;
            const autoSelEl = document.getElementById('adminSessionSelect'); if (autoSelEl) autoSelEl.value = autoSession;
            runSessionMatch(true);
        }
    }

    if (typeof checkScheduledCustomActivities === 'function') {
        checkScheduledCustomActivities(false);
    }

    if (typeof cleanupExpiredActivityRegistrations === 'function') {
        cleanupExpiredActivityRegistrations(false);
    }
}

function unmatchPlayerPair(userId, specificPartnerId = null) {
    const users = getUsers();
    const userA = users.find(u => String(u.id) === String(userId));
    if (!userA) return;

    const targetPartnerId = specificPartnerId || userA.matchedWithId;
    if (!targetPartnerId) return;

    const userB = users.find(u => String(u.id) === String(targetPartnerId));
    const partnerName = userB ? `${userB.nickname} (ID:${userB.id})` : `ID:${targetPartnerId}`;

    if (!confirm(`確定要彈性解除「${userA.nickname} (ID:${userA.id})」與「${partnerName}」的配對嗎？\n解除後兩邊對應的好友名單將同步移除。`)) {
        return;
    }

    if (Array.isArray(userA.matchedHistory)) {
        userA.matchedHistory = userA.matchedHistory.filter(h => String(h.partnerId) !== String(targetPartnerId));
    }
    if (String(userA.matchedWithId) === String(targetPartnerId)) {
        const lastA = (userA.matchedHistory || [])[userA.matchedHistory.length - 1];
        userA.matchedSession = lastA ? lastA.session : null;
        userA.matchedWithId = lastA ? lastA.partnerId : null;
        userA.matchedWithName = lastA ? lastA.partnerName : null;
        userA.matchedAt = lastA ? lastA.matchedAt : null;
    }

    if (userB) {
        if (Array.isArray(userB.matchedHistory)) {
            userB.matchedHistory = userB.matchedHistory.filter(h => String(h.partnerId) !== String(userId));
        }
        if (String(userB.matchedWithId) === String(userId)) {
            const lastB = (userB.matchedHistory || [])[userB.matchedHistory.length - 1];
            userB.matchedSession = lastB ? lastB.session : null;
            userB.matchedWithId = lastB ? lastB.partnerId : null;
            userB.matchedWithName = lastB ? lastB.partnerName : null;
            userB.matchedAt = lastB ? lastB.matchedAt : null;
        }
    }

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.markPairUnmatched === 'function') {
        CloudSync.markPairUnmatched(userId, targetPartnerId, 600000);
    }
    saveUsers(users, { isMatchMutation: true, targetIds: [String(userId), String(targetPartnerId)] });
    if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
        ChatStore.clearChat(userId, targetPartnerId);
    } else {
        const pairKey = [String(userId), String(targetPartnerId)].sort().join('__');
        const allChats = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
        if (Object.prototype.hasOwnProperty.call(allChats, pairKey)) {
            delete allChats[pairKey];
            localStorage.setItem(CHATS_KEY, JSON.stringify(allChats));
        }
        if (typeof CloudSync !== 'undefined') {
            CloudSync.deleteNode(`${CHATS_KEY}/${pairKey}`);
        }
    }
    appendLog(`<span class="text-amber-300">[彈性解除配對]</span> 管理員已解除 <strong>${userA.nickname}</strong> ⇄ <strong>${partnerName}</strong> 的好友關係並清空聊天紀錄，前台名單已同步更新。`);
}

function checkSingleCriterion(key, desiredVal, candidate, seekerCriteria = {}) {
    if (typeof sharedCheckSingleCriterion === 'function') {
        return sharedCheckSingleCriterion(key, desiredVal, candidate, seekerCriteria);
    }
    if (!candidate) return false;
    if (key === 'mbti') {
        const want = String(desiredVal || '').trim();
        if (!want) return false;
        const candRaw = String(candidate.mbti || '').trim().toUpperCase();
        const candGroup = String(
            candidate.mbtiGroup ||
            (typeof inferMbtiGroup === 'function' ? inferMbtiGroup(candRaw) : '') ||
            (candRaw.startsWith('I') ? 'I人' : (candRaw.startsWith('E') ? 'E人' : ''))
        ).trim();
        if (want === 'I人' || want === 'E人') {
            return candGroup === want;
        }
        return candRaw === want.toUpperCase();
    }
    if (key === 'region') {
        const candidateRegion = candidate.region || inferRegionByCity(candidate.city);
        const regionCities = REGION_CITIES[desiredVal] || [];
        return candidateRegion === desiredVal || regionCities.includes(candidate.city);
    }
    if (key === 'gender') {
        const cid = String(candidate.id || '');
        const cGender = (candidate.gender === '男' || candidate.gender === '女')
            ? candidate.gender
            : (cid.startsWith('1') ? '男' : (cid.startsWith('2') ? '女' : ''));
        if (desiredVal === '女' || desiredVal === '女生') return cGender === '女';
        if (desiredVal === '男' || desiredVal === '男生') return cGender === '男';
        return cGender === desiredVal;
    }
    if (key === 'ageRange') {
        const age = Number(candidate.age);
        if (!age) return false;
        if (desiredVal === '22~25歲') return age >= 22 && age <= 25;
        if (desiredVal === '26~30歲') return age >= 26 && age <= 30;
        if (desiredVal === '31~35歲') return age >= 31 && age <= 35;
        if (desiredVal === '36~40歲') return age >= 36 && age <= 40;
        if (desiredVal === '18~22歲') return age >= 18 && age <= 22;
        if (desiredVal === '23~26歲') return age >= 23 && age <= 26;
        if (desiredVal === '27~30歲') return age >= 27 && age <= 30;
        if (desiredVal === '36歲以上') return age >= 36;
        return false;
    }
    if (key === 'height') {
        const h = Number(candidate.height);
        const minH = parseInt(desiredVal, 10);
        return !isNaN(h) && !isNaN(minH) && h >= minH;
    }
    return candidate[key] === desiredVal;
}

function acceptsCandidate(seeker, candidate) {
    const criteria = seeker.exactMatchCriteria || {};
    const mustKeys = Array.isArray(seeker.mustMatchKeys) ? seeker.mustMatchKeys : [];
    if (typeof sharedEvaluateMatchCriteria === 'function') {
        return sharedEvaluateMatchCriteria(seeker, candidate, criteria, mustKeys);
    }
    if (typeof sharedMatchesGenderPreference === 'function') {
        if (!sharedMatchesGenderPreference(seeker, candidate, criteria)) return false;
    } else {
        const cid = String(candidate.id || '');
        const cGender = (candidate.gender === '男' || candidate.gender === '女')
            ? candidate.gender
            : (cid.startsWith('1') ? '男' : (cid.startsWith('2') ? '女' : ''));
        if (cGender !== '男' && cGender !== '女') return false;
        const pref = String(seeker.targetGender || '').trim();
        if ((pref === '男生' || pref === '男') && cGender !== '男') return false;
        if ((pref === '女生' || pref === '女') && cGender !== '女') return false;
        const critG = String(criteria.gender || '').trim();
        if ((critG === '男生' || critG === '男') && cGender !== '男') return false;
        if ((critG === '女生' || critG === '女') && cGender !== '女') return false;
    }
    const activeKeys = Object.keys(criteria).filter(k => k !== 'gender' && !(k === 'city' && criteria.region));
    if (activeKeys.length === 0) return true;
    const validMust = mustKeys.filter(k => k !== 'gender' && Object.prototype.hasOwnProperty.call(criteria, k)).slice(0, 2);
    const mustSet = new Set(validMust);
    const orKeys = activeKeys.filter(k => !mustSet.has(k));
    for (const mk of validMust) {
        if (!checkSingleCriterion(mk, criteria[mk], candidate, criteria)) return false;
    }
    if (orKeys.length === 0) return true;
    return orKeys.some(k => checkSingleCriterion(k, criteria[k], candidate, criteria));
}

function canPair(A, B) {
    const alreadyFriends = (A.matchedHistory || []).some(h => String(h.partnerId) === String(B.id)) ||
                           String(A.matchedWithId) === String(B.id);
    if (alreadyFriends) return false;
    return acceptsCandidate(A, B) && acceptsCandidate(B, A);
}

function recordPairMatch(userA, userB, targetSession, nowTs, activityId = null, matchDetail = '') {
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.clearPairUnmatched === 'function') {
        CloudSync.clearPairUnmatched(userA.id, userB.id);
    }
    if (!Array.isArray(userA.matchedHistory)) userA.matchedHistory = [];
    if (!Array.isArray(userB.matchedHistory)) userB.matchedHistory = [];

    const itemForA = { session: targetSession, partnerId: String(userB.id), partnerName: userB.nickname, matchedAt: nowTs };
    const itemForB = { session: targetSession, partnerId: String(userA.id), partnerName: userA.nickname, matchedAt: nowTs };
    if (activityId) {
        itemForA.activityId = String(activityId);
        itemForB.activityId = String(activityId);
    }
    if (matchDetail) {
        itemForA.matchDetail = String(matchDetail);
        itemForB.matchDetail = String(matchDetail);
    }

    userA.matchedHistory.push(itemForA);
    userA.matchedSession = targetSession;
    userA.matchedWithId = String(userB.id);
    userA.matchedWithName = userB.nickname;
    userA.matchedAt = nowTs;

    userB.matchedHistory.push(itemForB);
    userB.matchedSession = targetSession;
    userB.matchedWithId = String(userA.id);
    userB.matchedWithName = userA.nickname;
    userB.matchedAt = nowTs;

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.recordMatchLog === 'function') {
        const srcLabel = matchDetail || (String(targetSession).includes('強制') ? '管理員手動配對' : '場次配對');
        CloudSync.recordMatchLog(userA, userB, targetSession, nowTs, srcLabel);
    }
}

function runSessionMatch(isAuto = false) {
    const targetSessionSel = document.getElementById('adminSessionSelect'); const targetSession = targetSessionSel ? targetSessionSel.value : getBatchScheduleInfo(getCurrentBatch()).wedLabel;
    const batchName = extractBatchLabel(targetSession);
    const users = getUsers();
    const rules = getForceRules();

    const activeBatchRules = rules.filter(r => extractBatchLabel(r.batch) === batchName);
    const reservedIds = new Set();
    activeBatchRules.forEach(r => {
        reservedIds.add(String(r.adminId));
        reservedIds.add(String(r.targetId));
    });

    const pairedThisSessionIds = new Set();
    let pairCount = 0;
    const nowTs = Date.now();
    const triggerLabel = isAuto ? '20:00 到點自動配對' : '20:00 配對執行';

    appendLog(`<span class="text-yellow-300">[${triggerLabel}]</span> 場次：<strong>${targetSession}</strong>...`);

    activeBatchRules.forEach(rule => {
        if (rule.executed) return;
        const adminUser = users.find(u => String(u.id) === String(rule.adminId));
        const targetUser = users.find(u => String(u.id) === String(rule.targetId));

        if (adminUser && targetUser && !adminUser.isMatchBanned && !targetUser.isMatchBanned) {
            recordPairMatch(adminUser, targetUser, targetSession, nowTs);
            pairedThisSessionIds.add(String(adminUser.id));
            pairedThisSessionIds.add(String(targetUser.id));
            rule.executed = true;
            pairCount++;

            appendLog(`<span class="text-rose-400">[秘密強制配對完成]</span> ID:<strong>${adminUser.id}</strong>（${adminUser.nickname}）⇄ ID:<strong>${targetUser.id}</strong>（${targetUser.nickname}）`);
        }
    });
    saveForceRules(rules);

    const eligiblePool = shuffle(users.filter(u => {
        if (u.isWarned || u.isMatchBanned) return false;
        const sessions = Array.isArray(u.registeredSessions)
            ? u.registeredSessions
            : (u.registeredSession ? [u.registeredSession] : []);
        const alreadyMatchedThisSession = (u.matchedHistory || []).some(h => isSameSession(h.session, targetSession)) ||
                                          isSameSession(u.matchedSession, targetSession);
        return sessions.some(s => isSameSession(s, targetSession)) &&
               !alreadyMatchedThisSession &&
               !pairedThisSessionIds.has(String(u.id)) &&
               !reservedIds.has(String(u.id));
    }));

    for (let i = 0; i < eligiblePool.length; i++) {
        const A = eligiblePool[i];
        if (pairedThisSessionIds.has(String(A.id))) continue;

        const candidates = [];
        for (let j = i + 1; j < eligiblePool.length; j++) {
            const B = eligiblePool[j];
            if (pairedThisSessionIds.has(String(B.id))) continue;
            if (canPair(A, B)) {
                candidates.push(B);
            }
        }

        if (candidates.length > 0) {
            const B = candidates[Math.floor(Math.random() * candidates.length)];
            pairedThisSessionIds.add(String(A.id));
            pairedThisSessionIds.add(String(B.id));
            recordPairMatch(A, B, targetSession, nowTs);
            pairCount++;

            if (pairCount <= 15) {
                appendLog(`<span class="text-emerald-400">[配對成功 #${pairCount}]</span> ID:${A.id}（${A.nickname}）⇄ ID:${B.id}（${B.nickname}）`);
            }
        }
    }

    if (pairCount > 15) {
        appendLog(`<span class="text-emerald-400">...（其餘成功配對明細已省略，共完成 ${pairCount} 對）</span>`);
    }

    const bannedSkippedCount = users.filter(u => {
        const sessions = Array.isArray(u.registeredSessions) ? u.registeredSessions : (u.registeredSession ? [u.registeredSession] : []);
        return sessions.some(s => isSameSession(s, targetSession)) && u.isMatchBanned;
    }).length;

    appendLog(`<span class="text-pink-300">[結算完成]</span> 本場次共配對成功 <strong>${pairCount} 對</strong>${bannedSkippedCount > 0 ? `（另有 ${bannedSkippedCount} 名已報名玩家因設定「禁止配對」而未配對）` : ''}。`);
    saveUsers(users, { isMatchMutation: true, targetIds: Array.from(pairedThisSessionIds) });
}

function addSecretForceMatch() {
    const adminId = document.getElementById('forceAdminId').value.trim();
    const targetId = document.getElementById('forceTargetId').value.trim();
    const targetBatch = document.getElementById('forceBatchSelect').value;

    if (!adminId || !targetId) {
        alert('請輸入「我的帳號 ID」與「強制配對對象 ID」！');
        return;
    }
    if (adminId === targetId) {
        alert('兩個 ID 不能相同！');
        return;
    }

    const rules = getForceRules();
    const filtered = rules.filter(r => !(r.batch === targetBatch && (r.targetId === targetId || r.adminId === adminId)));
    filtered.push({
        id: 'FM_' + Date.now(),
        adminId: String(adminId),
        targetId: String(targetId),
        batch: targetBatch,
        executed: false,
        createdAt: new Date().toLocaleString('zh-TW')
    });

    saveForceRules(filtered);
    appendLog(`<span class="text-rose-300">[秘密通道已鎖定]</span> 已設定【${targetBatch}】管理員 ID:<strong>${adminId}</strong> ⇄ 對象 ID:<strong>${targetId}</strong> 強制配對。`);
}

function removeForceRule(ruleId) {
    saveForceRules(getForceRules().filter(r => r.id !== ruleId));
}

function advanceToNextBatch() {
    const nextBatch = getCurrentBatch() + 1;
    setCurrentBatch(nextBatch);
    const nextInfo = getBatchScheduleInfo(nextBatch);
    appendLog(`<span class="text-amber-300">[屆數刷新]</span> 系統已推進至 <strong>${nextInfo.batchPrefix}（${nextInfo.wedLabel} / ${nextInfo.satLabel}）</strong>！`);
    renderAdminAll();
}

function getSelectedAdminSession() {
    const sel = document.getElementById('adminSessionSelect');
    if (sel && sel.value) return normalizeSessionLabel(sel.value);
    return getBatchScheduleInfo(getCurrentBatch()).wedLabel;
}

function seedSampleABCDE() {
    const session = getSelectedAdminSession();
    const users = getUsers();

    const sampleList = [
        { id: '10001', nickname: 'A男生 (選中部全區)', gender: '男', targetGender: '女生', age: 26, zodiac: '射手座', status: '上班族', region: '中部', city: '台中市', mbti: 'ENFP', registeredSessions: [session], exactMatchCriteria: { region: '中部' } },
        { id: '10002', nickname: 'B男生 (選性別:女)', gender: '男', targetGender: '女生', age: 27, zodiac: '摩羯座', status: '上班族', region: '中部', city: '彰化縣', mbti: 'ISTJ', registeredSessions: [session], exactMatchCriteria: { gender: '女' } },
        { id: '10003', nickname: 'C男生 (隨機不選)', gender: '男', targetGender: '女生', age: 25, zodiac: '水瓶座', status: '學生', region: '北部', city: '台北市', mbti: 'INTP', registeredSessions: [session], exactMatchCriteria: {} },
        { id: '20001', nickname: 'D女生 (南投/中部)', gender: '女', targetGender: '男生', age: 24, zodiac: '巨蟹座', status: '學生', region: '中部', city: '南投縣', mbti: 'INFJ', registeredSessions: [session], exactMatchCriteria: {} },
        { id: '20002', nickname: 'E女生 (高雄/南部)', gender: '女', targetGender: '男生', age: 25, zodiac: '雙魚座', status: '自由業', region: '南部', city: '高雄市', mbti: 'ENFP', registeredSessions: [session], exactMatchCriteria: {} }
    ];

    sampleList.forEach(s => {
        const idx = users.findIndex(u => String(u.id) === s.id);
        const fullObj = { ...s, ig: `@user_${s.id}`, isWarned: false, isMatchBanned: false, isChatBanned: false, matchedHistory: [], matchedSession: null, matchedWithId: null, matchedWithName: null, matchedAt: null };
        if (idx >= 0) users[idx] = fullObj;
        else users.push(fullObj);
    });

    saveUsers(users);
    appendLog(`<span class="text-pink-300">[匯入 A~E 完成]</span> 已加入 A/B/C 三位男生與 D/E 兩位女生報名「${session}」。`);
}

function seedAdminAndXiaomeiExample() {
    const session = getSelectedAdminSession();
    const users = getUsers();
    const upsert = (obj) => {
        const idx = users.findIndex(u => String(u.id) === String(obj.id));
        if (idx >= 0) users[idx] = { ...users[idx], ...obj };
        else users.push(obj);
    };
    upsert({ id: '1', nickname: '管理員 (我)', ig: '@admin_01', gender: '男', targetGender: '女生', age: 27, region: '中部', city: '台中市', isWarned: false, isMatchBanned: false, isChatBanned: false, matchedHistory: [], registeredSessions: [session], exactMatchCriteria: {}, matchedSession: null, matchedWithId: null, matchedWithName: null });
    upsert({ id: '2', nickname: '小美', ig: '@xiaomei_02', gender: '女', targetGender: '男生', age: 24, region: '中部', city: '台中市', isWarned: false, isMatchBanned: false, isChatBanned: false, matchedHistory: [], registeredSessions: [session], exactMatchCriteria: {}, matchedSession: null, matchedWithId: null, matchedWithName: null });
    saveUsers(users);
    document.getElementById('forceAdminId').value = '1';
    document.getElementById('forceTargetId').value = '2';
}

function seedAsymmetricPool() {
    const session = getSelectedAdminSession();
    const users = getUsers();

    for (let i = 1; i <= 100; i++) {
        const id = String(10000 + i);
        if (!users.some(u => String(u.id) === id)) {
            users.push({ id, nickname: `男玩家_${id}`, ig: `@boy_${id}`, gender: '男', targetGender: '女生', age: 25, region: '中部', city: '台中市', isWarned: false, isMatchBanned: false, isChatBanned: false, matchedHistory: [], registeredSessions: [session], exactMatchCriteria: { gender: '女' }, matchedSession: null, matchedWithId: null, matchedWithName: null });
        }
    }
    for (let j = 1; j <= 10; j++) {
        const id = String(20000 + j);
        if (!users.some(u => String(u.id) === id)) {
            users.push({ id, nickname: `女玩家_${id}`, ig: `@girl_${id}`, gender: '女', targetGender: '男生', age: 24, region: '中部', city: '台中市', isWarned: false, isMatchBanned: false, isChatBanned: false, matchedHistory: [], registeredSessions: [session], exactMatchCriteria: { gender: '男' }, matchedSession: null, matchedWithId: null, matchedWithName: null });
        }
    }

    saveUsers(users);
    appendLog(`<span class="text-pink-300">[測試池建立]</span> 已加入 100 名男生與 10 名女生報名「${session}」，執行配對後將只會成功 10 對！`);
}

// ==================== 即時手動強制配對（彈窗控制與立即配對） ====================
function openInstantMatchModal() {
    const modal = document.getElementById('instantMatchModal');
    if (!modal) return;
    const inputA = document.getElementById('instantMatchIdA');
    const inputB = document.getElementById('instantMatchIdB');
    if (inputA) inputA.value = '';
    if (inputB) inputB.value = '';
    updateInstantMatchPreview();
    modal.classList.remove('hidden');
    if (inputA) {
        setTimeout(() => inputA.focus(), 50);
    }
}

function closeInstantMatchModal() {
    const modal = document.getElementById('instantMatchModal');
    if (modal) modal.classList.add('hidden');
}

function updateInstantMatchPreview() {
    const inputA = document.getElementById('instantMatchIdA');
    const inputB = document.getElementById('instantMatchIdB');
    const prevA = document.getElementById('instantMatchPreviewA');
    const prevB = document.getElementById('instantMatchPreviewB');
    const statusHint = document.getElementById('instantMatchPairStatusHint');
    if (!inputA || !inputB || !prevA || !prevB) return;

    const idA = inputA.value.trim();
    const idB = inputB.value.trim();
    const users = getUsers();
    const userA = idA ? users.find(u => String(u.id) === idA) : null;
    const userB = idB ? users.find(u => String(u.id) === idB) : null;

    if (!idA) {
        prevA.textContent = '';
    } else if (userA) {
        prevA.className = 'text-[11px] text-emerald-700 font-semibold min-h-[16px]';
        prevA.textContent = `✓ 找到玩家：${userA.nickname}（${userA.gender || '-'} ・ ${userA.age || '-'}歲）`;
    } else {
        prevA.className = 'text-[11px] text-rose-600 font-semibold min-h-[16px]';
        prevA.textContent = `⚠️ 查無 ID「${idA}」的玩家`;
    }

    if (!idB) {
        prevB.textContent = '';
    } else if (userB) {
        prevB.className = 'text-[11px] text-emerald-700 font-semibold min-h-[16px]';
        prevB.textContent = `✓ 找到玩家：${userB.nickname}（${userB.gender || '-'} ・ ${userB.age || '-'}歲）`;
    } else {
        prevB.className = 'text-[11px] text-rose-600 font-semibold min-h-[16px]';
        prevB.textContent = `⚠️ 查無 ID「${idB}」的玩家`;
    }

    if (statusHint) {
        if (idA && idB && idA === idB) {
            statusHint.className = 'p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold';
            statusHint.textContent = '🚫 玩家 A 與玩家 B 的 ID 不能相同！';
            statusHint.classList.remove('hidden');
        } else if (userA && userB) {
            const alreadyMatched = (userA.matchedHistory || []).some(h => String(h.partnerId) === String(userB.id)) ||
                                   (userB.matchedHistory || []).some(h => String(h.partnerId) === String(userA.id)) ||
                                   String(userA.matchedWithId) === String(userB.id);
            if (alreadyMatched) {
                statusHint.className = 'p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold';
                statusHint.textContent = `⚠️ 「${userA.nickname}」與「${userB.nickname}」目前已經是配對好友了！`;
                statusHint.classList.remove('hidden');
            } else {
                statusHint.className = 'p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold';
                statusHint.textContent = `💞 可立即配對：「${userA.nickname}」⇄「${userB.nickname}」`;
                statusHint.classList.remove('hidden');
            }
        } else {
            statusHint.classList.add('hidden');
        }
    }
}

function executeInstantManualMatch(idA, idB) {
    const users = getUsers();
    const userA = users.find(u => String(u.id) === String(idA));
    const userB = users.find(u => String(u.id) === String(idB));

    if (!userA || !userB) {
        alert('🚫 找不到對應的玩家 ID，請確認後再試！');
        return;
    }
    if (String(userA.id) === String(userB.id)) {
        alert('🚫 玩家 ID 不能相同！');
        return;
    }

    const alreadyMatchedA = (userA.matchedHistory || []).some(h => String(h.partnerId) === String(userB.id));
    const alreadyMatchedB = (userB.matchedHistory || []).some(h => String(h.partnerId) === String(userA.id));
    if (alreadyMatchedA || alreadyMatchedB || String(userA.matchedWithId) === String(userB.id)) {
        alert('⚠️ 這兩位玩家已經是配對好友了！');
        return;
    }

    const sysCfg = getSystemConfig();
    const sessionLabel = `第${sysCfg.currentBatch}屆(強制配對)`;
    const nowMs = Date.now();
    const nowTimeStr = new Date(nowMs).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

    recordPairMatch(userA, userB, sessionLabel, nowMs);

    // 建立聊天室並寫入第一則系統訊息
    const sysText = '⚡ 管理員已為你們手動牽線成功，現在開始可以聊天囉！';
    if (typeof ChatStore !== 'undefined' && typeof ChatStore.appendMessage === 'function') {
        ChatStore.appendMessage(userA.id, userB.id, {
            senderId: 'system',
            text: sysText,
            time: nowTimeStr,
            ts: nowMs
        });
    } else {
        const pairKey = [String(userA.id), String(userB.id)].sort().join('__');
        const chatsMap = typeof getAdminChatsMap === 'function' ? getAdminChatsMap() : JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
        if (!Array.isArray(chatsMap[pairKey])) chatsMap[pairKey] = [];
        const sysMsg = {
            id: `SYS_MANUAL_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
            senderId: 'system',
            text: sysText,
            time: nowTimeStr,
            ts: nowMs
        };
        chatsMap[pairKey].push(sysMsg);
        localStorage.setItem(CHATS_KEY, JSON.stringify(chatsMap));
        if (typeof CloudSync !== 'undefined') {
            CloudSync.putNode(`${CHATS_KEY}/${pairKey}/${sysMsg.id}`, sysMsg);
        }
    }

    if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
        AdminMemoryCache.invalidate('chats');
    }

    saveUsers(users, { isMatchMutation: true, targetIds: [String(userA.id), String(userB.id)] });
    closeInstantMatchModal();
    appendLog(`<span class="text-emerald-300">[即時手動配對]</span> 管理員已手動將 <strong>${userA.nickname} (ID:${userA.id})</strong> ⇄ <strong>${userB.nickname} (ID:${userB.id})</strong> 配對為好友並開啟聊天室。`);
    alert(`✅ 成功！「${userA.nickname} (ID:${userA.id})」與「${userB.nickname} (ID:${userB.id})」已成為好友，並開啟專屬聊天室。`);
}

function triggerInstantManualMatch(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const idA = (document.getElementById('instantMatchIdA')?.value || '').trim();
    const idB = (document.getElementById('instantMatchIdB')?.value || '').trim();
    if (!idA || !idB) {
        alert('請輸入雙方的玩家 ID！');
        return;
    }
    if (idA === idB) {
        alert('🚫 玩家 ID 不能相同！');
        return;
    }

    const users = getUsers();
    const userA = users.find(u => String(u.id) === idA);
    const userB = users.find(u => String(u.id) === idB);
    if (!userA || !userB) {
        alert('🚫 找不到對應的玩家 ID，請確認後再試！');
        return;
    }
    const alreadyMatched = (userA.matchedHistory || []).some(h => String(h.partnerId) === idB) ||
                           (userB.matchedHistory || []).some(h => String(h.partnerId) === idA) ||
                           String(userA.matchedWithId) === idB;
    if (alreadyMatched) {
        alert('⚠️ 這兩位玩家已經是配對好友了！');
        return;
    }

    if (typeof requestAdminPasswordForAction === 'function') {
        requestAdminPasswordForAction('即時強制配對', () => executeInstantManualMatch(idA, idB));
    } else {
        executeInstantManualMatch(idA, idB);
    }
}

window.runRepairMatchesFromChats = runRepairMatchesFromChats;
window.manualResolveUnmatchPair = manualResolveUnmatchPair;
window.manualBatchUnmatchAllDiscrepancies = manualBatchUnmatchAllDiscrepancies;
window.manualResolveSyncPair = manualResolveSyncPair;
