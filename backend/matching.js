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

        // 正常狀態：雙方名單皆有對方，就算尚無聊天紀錄（因未登入前台）也視為正常待開聊配對
        const isConsistent = Boolean(userA && userB && aHasB && bHasA);
        if (isConsistent) return;

        const nameA = userA ? (userA.nickname || `玩家_${idA}`) : `不存在/已刪除玩家_${idA}`;
        const nameB = userB ? (userB.nickname || `玩家_${idB}`) : `不存在/已刪除玩家_${idB}`;

        let reasonBadge = '';
        let memberStatusDesc = '';
        let chatStatusDesc = '';

        if ((aHasB || bHasA) && !hasChat) {
            if (aHasB && !bHasA) {
                reasonBadge = '⚠️ 會員列表僅單方有配對・聊天紀錄無對話';
                memberStatusDesc = `僅 ${idA} 名單有 ${idB}（${idB} 名單無 ${idA}）`;
            } else if (!aHasB && bHasA) {
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

async function runRepairMatchesFromChats(silentWhenClean = false) {
    const resultEl = document.getElementById('repairMatchesResult');
    if (!resultEl) return;

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.ensureBackendNodes === 'function') {
        resultEl.classList.remove('hidden');
        resultEl.innerHTML = `<div class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-semibold">⏳ 正在比對會員名單與聊天紀錄...</div>`;
        await CloudSync.ensureBackendNodes([USERS_KEY, CHATS_KEY, UNMATCHED_PAIRS_CLOUD_NODE]);
    }
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
        const isUnmatchedPair = Boolean(
            typeof CloudSync !== 'undefined' &&
            typeof CloudSync.isPairRecentlyUnmatched === 'function' &&
            CloudSync.isPairRecentlyUnmatched(item.idA, item.idB)
        );
        const canRepairBoth = item.userAExists && item.userBExists && !isUnmatchedPair;
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
                        <button type="button" onclick="manualResolveSyncPair('${escapeMaintenanceHtml(item.idA)}', '${escapeMaintenanceHtml(item.idB)}', this)"
                            class="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 text-[11px] font-semibold transition">
                            🔄 補齊雙向配對與聊天室
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    const repairableDiscrepancies = discrepancies.filter(item =>
        item.userAExists &&
        item.userBExists &&
        !(typeof CloudSync !== 'undefined' && typeof CloudSync.isPairRecentlyUnmatched === 'function' && CloudSync.isPairRecentlyUnmatched(item.idA, item.idB))
    );
    resultEl.innerHTML = `
        <div class="p-3 rounded-xl bg-amber-50 border border-amber-300 space-y-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-bold text-amber-900">
                    ⚠️ 共檢查出 ${discrepancies.length} 組「會員列表」與「聊天紀錄」數據不一致的配對，請手動選擇處理方式：
                </span>
                <div class="flex flex-wrap items-center gap-2">
                    ${repairableDiscrepancies.length > 0 ? `
                        <button type="button" onclick="manualBatchSyncAllDiscrepancies(this)"
                            class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-2xs transition">
                            🔄 一鍵補齊 雙方好友名單 (${repairableDiscrepancies.length} 組)
                        </button>
                    ` : ''}
                    ${discrepancies.length > 1 ? `
                        <button type="button" onclick="manualBatchUnmatchAllDiscrepancies()"
                            class="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-bold shadow-2xs transition">
                            💔 一鍵全部解除異常配對 (${discrepancies.length} 組)
                        </button>
                    ` : ''}
                </div>
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

let manualSyncDiscrepancyInFlight = false;

function syncSingleDiscrepancyPairToUsers(users, idA, idB, nowTs = Date.now()) {
    const pidA = String(idA || '').trim();
    const pidB = String(idB || '').trim();
    if (!pidA || !pidB || pidA === pidB) return null;

    const uA = users.find(u => u && String(u.id).trim() === pidA);
    const uB = users.find(u => u && String(u.id).trim() === pidB);
    if (!uA || !uB) return null;

    let clearUnmatchedPromise = Promise.resolve();
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.clearPairUnmatched === 'function') {
        clearUnmatchedPromise = CloudSync.clearPairUnmatched(pidA, pidB) || Promise.resolve();
    }

    uA.matchedHistory = Array.isArray(uA.matchedHistory)
        ? uA.matchedHistory
        : (uA.matchedHistory && typeof uA.matchedHistory === 'object' ? Object.values(uA.matchedHistory) : []);
    uB.matchedHistory = Array.isArray(uB.matchedHistory)
        ? uB.matchedHistory
        : (uB.matchedHistory && typeof uB.matchedHistory === 'object' ? Object.values(uB.matchedHistory) : []);

    const existingInA = uA.matchedHistory.find(h => h && String(h.partnerId).trim() === pidB);
    const existingInB = uB.matchedHistory.find(h => h && String(h.partnerId).trim() === pidA);
    const rawSharedSession = (existingInA && existingInA.session) || (existingInB && existingInB.session) || uA.matchedSession || uB.matchedSession || '資料維護補齊配對';
    const sharedSession = rawSharedSession.includes('・強制補齊') ? rawSharedSession : `${rawSharedSession}・強制補齊`;
    const sharedMatchedAt = Number((existingInA && existingInA.matchedAt) || (existingInB && existingInB.matchedAt) || uA.matchedAt || uB.matchedAt || nowTs);

    if (!existingInA) {
        uA.matchedHistory.push({
            partnerId: pidB,
            partnerName: uB.nickname || `玩家_${pidB}`,
            session: sharedSession,
            matchedAt: sharedMatchedAt,
            igUnlocked: Boolean(existingInB && existingInB.igUnlocked),
            isForceRepaired: true,
            matchDetail: '・強制補齊',
            continueVotes: []
        });
    } else {
        existingInA.partnerName = uB.nickname || existingInA.partnerName || `玩家_${pidB}`;
        existingInA.isForceRepaired = true;
        existingInA.session = sharedSession;
        existingInA.matchDetail = '・強制補齊';
    }
    if (!existingInB) {
        uB.matchedHistory.push({
            partnerId: pidA,
            partnerName: uA.nickname || `玩家_${pidA}`,
            session: sharedSession,
            matchedAt: sharedMatchedAt,
            igUnlocked: Boolean(existingInA && existingInA.igUnlocked),
            isForceRepaired: true,
            matchDetail: '・強制補齊',
            continueVotes: []
        });
    } else {
        existingInB.partnerName = uA.nickname || existingInB.partnerName || `玩家_${pidA}`;
        existingInB.isForceRepaired = true;
        existingInB.session = sharedSession;
        existingInB.matchDetail = '・強制補齊';
    }

    if (!uA.matchedWithId || String(uA.matchedWithId).trim() === pidB) {
        uA.matchedWithId = pidB;
        uA.matchedWithName = uB.nickname || `玩家_${pidB}`;
        uA.matchedSession = sharedSession;
        uA.matchedAt = sharedMatchedAt;
    }
    if (!uB.matchedWithId || String(uB.matchedWithId).trim() === pidA) {
        uB.matchedWithId = pidA;
        uB.matchedWithName = uA.nickname || `玩家_${pidA}`;
        uB.matchedSession = sharedSession;
        uB.matchedAt = sharedMatchedAt;
    }

    const updatedStamp = new Date(nowTs).toLocaleString('zh-TW') + ' (強制補齊)';
    uA.updatedAt = updatedStamp;
    uB.updatedAt = updatedStamp;

    if (typeof generatePlayerBackupCode === 'function') {
        uA.backupCode = generatePlayerBackupCode(uA, users);
        uB.backupCode = generatePlayerBackupCode(uB, users);
    }

    return { uA, uB, pidA, pidB, clearUnmatchedPromise };
}

async function persistRepairedUsersToLocalAndCloud(users, affectedUserIds, expectedPartnerMap = null) {
    const targetUsers = [];
    affectedUserIds.forEach(uid => {
        const cleanUid = String(uid).trim();
        const uObj = users.find(u => u && String(u.id).trim() === cleanUid);
        if (uObj) {
            if (typeof CloudSync !== 'undefined' && typeof CloudSync.setSharedPendingUser === 'function') {
                CloudSync.setSharedPendingUser(cleanUid, { ...uObj }, 60000);
            }
            targetUsers.push(uObj);
        }
    });

    const nextRaw = JSON.stringify(users);
    if (typeof AdminMemoryCache !== 'undefined') {
        AdminMemoryCache.usersRaw = nextRaw;
        AdminMemoryCache.users = users;
        if (typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('chats');
        }
    }
    localStorage.setItem(USERS_KEY, nextRaw);

    if (typeof CloudSync !== 'undefined' && CloudSync.dbUrl && targetUsers.length > 0) {
        await Promise.all(
            targetUsers.map(uObj => CloudSync.upsertUser(uObj, true, { isMatchMutation: true, throwOnError: true }))
        );

        // 寫入後向 Firebase RTDB 進行回讀驗證，精準確認每一位玩家的預期對象 ID 都已寫入雲端節點
        await Promise.all(
            targetUsers.map(async (uObj) => {
                const pid = String(uObj.id).trim();
                // 流量修復：改用去重＋快取的單節點讀取（寫入後會使快取失效，以 ETag 驗證）
                const readRes = await CloudSync.readNodeCached(`${USERS_KEY}/${pid}`, { force: true });
                if (readRes.status === 'error') {
                    throw new Error(`回讀驗證失敗 (ID:${pid})`);
                }
                const remoteUser = readRes.data;
                const remoteHistArr = Array.isArray(remoteUser && remoteUser.matchedHistory)
                    ? remoteUser.matchedHistory
                    : (remoteUser && remoteUser.matchedHistory && typeof remoteUser.matchedHistory === 'object'
                        ? Object.values(remoteUser.matchedHistory)
                        : []);
                const remotePartnerSet = new Set(
                    remoteHistArr.map(h => String((h && h.partnerId) || '').trim()).filter(Boolean)
                );
                if (remoteUser && remoteUser.matchedWithId) {
                    remotePartnerSet.add(String(remoteUser.matchedWithId).trim());
                }

                const expectedPartners = expectedPartnerMap && expectedPartnerMap.get(pid)
                    ? Array.from(expectedPartnerMap.get(pid))
                    : [];
                const missingPartner = expectedPartners.find(expId => !remotePartnerSet.has(String(expId).trim()));

                if (!remoteUser || remotePartnerSet.size === 0 || missingPartner) {
                    throw new Error(`雲端寫入驗證未通過 (ID:${pid}${missingPartner ? ` 缺少對象 ${missingPartner}` : ''})`);
                }
                if (CloudSync.tree && typeof CloudSync.tree === 'object') {
                    if (!CloudSync.tree[USERS_KEY] || typeof CloudSync.tree[USERS_KEY] !== 'object') {
                        CloudSync.tree[USERS_KEY] = {};
                    }
                    CloudSync.tree[USERS_KEY][pid] = remoteUser;
                }
                CloudSync.setSharedPendingUser(pid, remoteUser, 60000);
            })
        );
    }
}

async function manualResolveSyncPair(idA, idB, btnEl = null) {
    if (manualSyncDiscrepancyInFlight) return;
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

    manualSyncDiscrepancyInFlight = true;
    const origBtnText = btnEl ? btnEl.textContent : '';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = '⏳ 正在寫入雲端...';
    }

    try {
        if (typeof CloudSync !== 'undefined' && !CloudSync.initialized && CloudSync.dbUrl && typeof CloudSync.fetchFullTree === 'function') {
            await CloudSync.fetchFullTree();
        }
        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('users');
        }
        const latestUsers = getUsers();
        const res = syncSingleDiscrepancyPairToUsers(latestUsers, pidA, pidB, Date.now());
        if (res && res.clearUnmatchedPromise) {
            await res.clearUnmatchedPromise;
        }
        const expMap = new Map([
            [pidA, new Set([pidB])],
            [pidB, new Set([pidA])]
        ]);
        await persistRepairedUsersToLocalAndCloud(latestUsers, [pidA, pidB], expMap);

        appendLog(`<span class="text-emerald-300">[資料維護補齊]</span> 管理員已補齊 <strong>${uA.nickname} (ID:${pidA})</strong> ⇄ <strong>${uB.nickname} (ID:${pidB})</strong> 的雙向配對與聊天室紀錄。`);
        runRepairMatchesFromChats(true);
        if (typeof renderAdminAll === 'function') {
            renderAdminAll(true);
        }
        alert(`✅ 已成功補齊「${uA.nickname} (ID:${pidA})」與「${uB.nickname} (ID:${pidB})」的雙方好友名單並同步寫入雲端！`);
    } catch (err) {
        console.error('單筆補齊寫入雲端失敗:', err);
        alert(`⚠️ 補齊寫入雲端時發生網路異常（${err && err.message ? err.message : '連線逾時'}），請確認網路後再試一次！`);
    } finally {
        manualSyncDiscrepancyInFlight = false;
        if (btnEl && document.body.contains(btnEl)) {
            btnEl.disabled = false;
            btnEl.textContent = origBtnText;
        }
    }
}

async function manualBatchSyncAllDiscrepancies(btnEl = null) {
    if (manualSyncDiscrepancyInFlight) return;
    const discrepancies = collectMatchAndChatDiscrepancies();
    const repairable = discrepancies.filter(item =>
        item.userAExists &&
        item.userBExists &&
        !(typeof CloudSync !== 'undefined' && typeof CloudSync.isPairRecentlyUnmatched === 'function' && CloudSync.isPairRecentlyUnmatched(item.idA, item.idB))
    );
    if (repairable.length === 0) {
        alert('✅ 目前所有聊天室與會員列表的雙向配對皆已一致，沒有需要補齊的遺漏配對！');
        return;
    }

    const previewLines = repairable.slice(0, 10).map((it, i) => `#${i + 1} ${it.nameA} (ID:${it.idA}) ⇄ ${it.nameB} (ID:${it.idB})`);
    if (repairable.length > 10) {
        previewLines.push(`...其餘 ${repairable.length - 10} 組`);
    }

    if (!confirm(`偵測到 ${repairable.length} 組可雙向補齊的配對：\n\n${previewLines.join('\n')}\n\n確定要一鍵補齊全部 ${repairable.length} 組的雙方好友名單並同步寫入雲端嗎？`)) {
        return;
    }

    manualSyncDiscrepancyInFlight = true;
    const origBtnText = btnEl ? btnEl.textContent : '';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = '⏳ 正在寫入雲端補齊中...';
    }

    try {
        if (typeof CloudSync !== 'undefined' && CloudSync.dbUrl && typeof CloudSync.fetchFullTree === 'function') {
            await CloudSync.fetchFullTree();
        }
        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('users');
        }
        const users = getUsers();
        const nowTs = Date.now();
        const affectedIds = new Set();
        const expectedPartnerMap = new Map();
        const clearPromises = [];
        let syncedCount = 0;

        const addExpectedPartner = (uid, pid) => {
            if (!expectedPartnerMap.has(uid)) expectedPartnerMap.set(uid, new Set());
            expectedPartnerMap.get(uid).add(pid);
        };

        repairable.forEach(item => {
            const res = syncSingleDiscrepancyPairToUsers(users, item.idA, item.idB, nowTs);
            if (res) {
                affectedIds.add(res.pidA);
                affectedIds.add(res.pidB);
                addExpectedPartner(res.pidA, res.pidB);
                addExpectedPartner(res.pidB, res.pidA);
                if (res.clearUnmatchedPromise) clearPromises.push(res.clearUnmatchedPromise);
                syncedCount++;
            }
        });

        if (clearPromises.length > 0) {
            await Promise.all(clearPromises);
        }
        await persistRepairedUsersToLocalAndCloud(users, Array.from(affectedIds), expectedPartnerMap);

        appendLog(`<span class="text-emerald-300">[資料維護一鍵補齊]</span> 管理員已一鍵補齊全部 ${syncedCount} 組的雙方好友名單與聊天室紀錄。`);
        runRepairMatchesFromChats(true);
        if (typeof renderAdminAll === 'function') {
            renderAdminAll(true);
        }
        alert(`✅ 已成功一鍵補齊 ${syncedCount} 組的雙方好友名單與聊天室紀錄，並確認寫入雲端！`);
    } catch (err) {
        console.error('一鍵補齊寫入雲端失敗:', err);
        alert(`⚠️ 一鍵補齊寫入雲端時發生網路異常（${err && err.message ? err.message : '連線逾時'}），請確認網路後再點擊重試！`);
    } finally {
        manualSyncDiscrepancyInFlight = false;
        if (btnEl && document.body.contains(btnEl)) {
            btnEl.disabled = false;
            btnEl.textContent = origBtnText;
        }
    }
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
        hasPetStatus: '有養寵物',
        hasPet: '貓',
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

function buildMockTestFriendRoomAndState(targetId, existingCount = 0) {
    const pid = String(targetId || '').trim();
    const users = typeof getUsers === 'function' ? getUsers() : [];
    const targetUser = users.find(u => u && String(u.id).trim() === pid) || null;
    const isMale = targetUser
        ? (String(targetUser.gender || '').trim() === '男')
        : pid.startsWith('1');

    const mockNamesFemale = ['知夏 (C)', '柚子 (D)', '千尋 (E)', '美咲 (F)', '星奈 (G)', '綾乃 (H)'];
    const mockNamesMale = ['子豪 (C)', '柏翰 (D)', '冠宇 (E)', '承恩 (F)', '彥廷 (G)', '品叡 (H)'];
    const mockIndex = Math.max(0, Number(existingCount) || 0);
    const chosenName = isMale
        ? (mockNamesFemale[mockIndex] || `測試好友_${mockIndex + 1}`)
        : (mockNamesMale[mockIndex] || `測試好友_${mockIndex + 1}`);

    const now = Date.now();
    const newMockId = `MOCK_FRIEND_${now}_${mockIndex}`;
    const pairKey = (typeof ChatStore !== 'undefined' && typeof ChatStore.getPairKey === 'function')
        ? ChatStore.getPairKey(pid, newMockId)
        : [pid, newMockId].sort().join('__');

    const timeStr = new Date(now).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const initialMsgs = [
        {
            id: `INIT_${pairKey}_0`,
            senderId: 'system',
            senderName: '',
            text: `🌸【測試好友連動】月老紅線牽起！已為你與「${chosenName}」建立專屬聊天室（支援文字與圖片測試）。`,
            time: timeStr,
            dateTime: (typeof ChatStore !== 'undefined' && typeof ChatStore.formatChatDateTimeStr === 'function') ? ChatStore.formatChatDateTimeStr(now) : timeStr,
            ts: now,
            weight: 1
        },
        {
            id: `INIT_${pairKey}_1`,
            senderId: newMockId,
            senderName: chosenName,
            text: '你好呀！很高興在紅線企劃與你相遇～可以試著傳文字或圖片給我喔 🌸',
            time: timeStr,
            dateTime: (typeof ChatStore !== 'undefined' && typeof ChatStore.formatChatDateTimeStr === 'function') ? ChatStore.formatChatDateTimeStr(now + 1) : timeStr,
            ts: now + 1,
            weight: 1
        }
    ];

    if (typeof ChatStore !== 'undefined' && typeof ChatStore.ensureThread === 'function') {
        ChatStore.ensureThread(pid, newMockId, initialMsgs);
    }
    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        const lastMsgObj = initialMsgs[initialMsgs.length - 1];
        CloudSync.patchNode(`${CHAT_META_KEY}/${pairKey}`, {
            lastMsg: lastMsgObj,
            lastTs: Number(lastMsgObj.ts || now),
            msgCount: initialMsgs.length
        });
    }

    const sessionLabel = (typeof getBatchScheduleInfo === 'function' && typeof getCurrentBatchNumber === 'function')
        ? getBatchScheduleInfo(getCurrentBatchNumber() + mockIndex + 1).tueLabel
        : '測試場次';

    const friendObj = {
        id: newMockId,
        nickname: chosenName,
        sessionLabel,
        matchedAt: now,
        myContinue: false,
        partnerContinue: false,
        profile: {
            gender: isMale ? '女' : '男',
            region: (targetUser && targetUser.region) || '中部',
            city: (targetUser && targetUser.city) || '台中市',
            mbti: 'ENFP',
            hobbies: ['音樂', '攝影', '藝文展覽'],
            oneSentence: '你好呀！很高興在紅線企劃與你相遇～',
            icebreakerQuestion: '最近有沒有讓你單曲循環的一首歌？'
        },
        privacy: { gender: 'open', icebreakerQuestion: 'open', city: 'open', mbti: 'open', hobbies: 'open', oneSentence: 'open' },
        messages: initialMsgs
    };

    const syncLocalFriendState = (storageKey) => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const st = JSON.parse(raw);
            if (!st || String(st.playerId || '') !== pid) return;
            if (!Array.isArray(st.friends)) st.friends = [];
            if (!st.friends.some(f => f && String(f.id) === newMockId)) {
                st.friends.push(friendObj);
            }
            st.activeFriendId = newMockId;
            localStorage.setItem(storageKey, JSON.stringify(st));
        } catch (e) {}
    };
    syncLocalFriendState(PLAYER_STATE_PREFIX + pid);
    syncLocalFriendState(FRONTEND_STORAGE_KEY);

    return friendObj;
}

function cleanupMockFriendChatRooms(targetId, mockIds = []) {
    const pid = String(targetId || '').trim();
    if (!pid || !Array.isArray(mockIds) || mockIds.length === 0) return;
    mockIds.forEach(mid => {
        const cleanMid = String(mid || '').trim();
        if (!cleanMid) return;
        if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
            ChatStore.clearChat(pid, cleanMid);
        }
    });
}

function adminLinkFriendCToPlayer() {
    const targetId = resolveLinkFriendCTargetId();
    if (!targetId) {
        alert('請輸入需要聯動的玩家 ID！');
        return;
    }

    const existingMocks = getLinkedMockFriendsForTarget(targetId);
    const createdFriend = buildMockTestFriendRoomAndState(targetId, existingMocks.length);

    triggerFrontendTestEvent('ADD_FRIEND_C', targetId, {
        mockFriend: createdFriend
    });
    renderLinkedMockFriendsList();
    setTimeout(renderLinkedMockFriendsList, 350);
    setTimeout(renderLinkedMockFriendsList, 1200);
    if (typeof appendLog === 'function') {
        appendLog(`<span class="text-pink-300">[新增測試好友]</span> 已為玩家 ID:<strong>${targetId}</strong> 新增測試好友「<strong>${createdFriend.nickname}</strong>」並同步建立專屬聊天室！`);
    }
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
        cleanupMockFriendChatRooms(targetId, [String(lastMock.id)]);
        mutateLocalMockFriendsForTarget(targetId, f => String(f.id) !== String(lastMock.id));
        triggerFrontendTestEvent('REMOVE_FRIEND_C', targetId, { mockFriendId: String(lastMock.id) });
        appendLog(`<span class="text-amber-300">[刪除測試好友]</span> 已移除玩家 ID:<strong>${targetId}</strong> 的測試好友「<strong>${lastMock.nickname}</strong>」並清除聊天室。`);
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
    cleanupMockFriendChatRooms(pid, [mid]);
    mutateLocalMockFriendsForTarget(pid, f => String(f.id) !== mid);
    triggerFrontendTestEvent('REMOVE_FRIEND_C', pid, { mockFriendId: mid });
    renderLinkedMockFriendsList();
    appendLog(`<span class="text-amber-300">[刪除測試好友]</span> 已移除玩家 ID:<strong>${pid}</strong> 的測試好友${targetFriend ? `「<strong>${targetFriend.nickname}</strong>」` : ''}並清除聊天室。`);
}

function adminClearAllFriendCFromPlayer() {
    const targetId = resolveLinkFriendCTargetId();
    if (!targetId) {
        alert('請輸入要清空測試好友的玩家 ID！');
        return;
    }

    const mockList = getLinkedMockFriendsForTarget(targetId);
    cleanupMockFriendChatRooms(targetId, mockList.map(f => String(f.id)));
    const removed = mutateLocalMockFriendsForTarget(targetId, () => false);
    triggerFrontendTestEvent('CLEAR_ALL_FRIEND_C', targetId);
    renderLinkedMockFriendsList();
    appendLog(`<span class="text-amber-300">[清空測試好友]</span> 已清空玩家 ID:<strong>${targetId}</strong> 的全部測試 C 連動好友${removed > 0 ? `（共 ${removed} 位）` : ''}與聊天室。`);
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
        alert(`⚠️ 玩家「${yuelaoEscapeHtml(targetUser.nickname || targetId)} (ID:${yuelaoEscapeHtml(targetId)})」目前僅有 ${totalFriendCount} 位好友。\n\n必須擁有「2 位以上好友」才能觸發心動抉擇！\n（可先為該玩家配對或使用下方「連動新增一位好友」加至 2 位以上好友）`);
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
        statusEl.innerHTML = `<span class="text-emerald-700 font-bold">✅ 已於 ${new Date().toLocaleTimeString('zh-TW')} 為玩家「${yuelaoEscapeHtml(targetUser.nickname || targetId)} (ID:${yuelaoEscapeHtml(targetId)})」（目前 ${totalFriendCount} 位好友）觸發心動抉擇！</span>`;
    }
    appendLog(`<span class="text-pink-300">[指定觸發心動抉擇]</span> 已為玩家 <strong>${targetUser.nickname || targetId} (ID:${targetId})</strong>（共 ${totalFriendCount} 位好友）直接觸發 20:00 心動抉擇！`);
    alert(`💘 已成功為玩家「${yuelaoEscapeHtml(targetUser.nickname || targetId)} (ID:${yuelaoEscapeHtml(targetId)})」觸發心動抉擇！\n\n目前好友數：${totalFriendCount} 位\n該玩家前台（含目前在線或稍後開啟／重新整理）將立即彈出心動抉擇視窗。`);
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

    if ([2, 4, 6].includes(target.getDay()) && now >= target) {
        target.setDate(target.getDate() + 1);
    }
    while (![2, 4, 6].includes(target.getDay())) {
        target.setDate(target.getDate() + 1);
    }

    const diff = target - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    const dayMap = { 2: '週二', 4: '週四', 6: '週六' };
    const dayLabel = dayMap[target.getDay()] || '週二';
    const cdEl = document.getElementById('adminCountdownText'); if (cdEl) cdEl.textContent =
        `距離下次 ${dayLabel} 20:00 自動配對：${days}天 ${String(hours).padStart(2, '0')}時 ${String(mins).padStart(2, '0')}分 ${String(secs).padStart(2, '0')}秒`;

    const day = now.getDay();
    const isAutoWindow = [2, 4, 6].includes(day) && now.getHours() === 20 && now.getMinutes() <= 15;
    if (isAutoWindow && typeof CloudSync !== 'undefined' && CloudSync.initialized && CloudSync.inFlightWrites === 0 && !sessionMatchRunInProgress) {
        const dateKey = `${now.toDateString()}_2000`;
        const executedMap = JSON.parse(localStorage.getItem(AUTO_RUN_LOG_KEY) || '{}');
        if (!executedMap[dateKey]) {
            executedMap[dateKey] = true;
            localStorage.setItem(AUTO_RUN_LOG_KEY, JSON.stringify(executedMap));
            claimAndRunAutoSchedule2000(dateKey, day);
        }
    }

    if (typeof checkScheduledCustomActivities === 'function') {
        checkScheduledCustomActivities(false);
    }

    if (typeof cleanupExpiredActivityRegistrations === 'function') {
        cleanupExpiredActivityRegistrations(false);
    }
}

async function unmatchPlayerPair(userId, specificPartnerId = null) {
    const users = getUsers();
    const userA = users.find(u => String(u.id) === String(userId));
    if (!userA) return;

    const targetPartnerId = specificPartnerId || userA.matchedWithId;
    if (!targetPartnerId) return;

    const userB = users.find(u => String(u.id) === String(targetPartnerId));
    const partnerName = userB ? `${userB.nickname} (ID:${userB.id})` : `ID:${targetPartnerId}`;

    if (!confirm(`確定要彈性解除「${userA.nickname} (ID:${userA.id})」與「${partnerName}」的配對嗎？\n解除後兩邊對應的好友名單將同步移除，且系統不會再將雙方重新配對或自動回補。`)) {
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
        await CloudSync.markPairUnmatched(userId, targetPartnerId, 315360000000);
    }

    const nextRaw = JSON.stringify(users);
    if (typeof AdminMemoryCache !== 'undefined') {
        AdminMemoryCache.usersRaw = nextRaw;
        AdminMemoryCache.users = users;
        if (typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('chats');
        }
    }
    localStorage.setItem(USERS_KEY, nextRaw);
    if (typeof renderAdminAll === 'function') {
        renderAdminAll(true);
    }

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.unmatchUsersInCloud === 'function') {
        await CloudSync.unmatchUsersInCloud(userId, targetPartnerId, userA, userB);
    } else if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
        ChatStore.clearChat(userId, targetPartnerId);
    }
    if (typeof renderAdminAll === 'function') {
        renderAdminAll(true);
    }
    appendLog(`<span class="text-amber-300">[彈性解除配對]</span> 管理員已解除 <strong>${userA.nickname}</strong> ⇄ <strong>${partnerName}</strong> 的好友關係並清空聊天紀錄，前後台資料庫已同步且不再自動回補。`);
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
    if (key === 'hasPet') {
        const want = String(desiredVal || '').trim();
        if (!want) return false;
        const candPet = String(candidate.hasPet || '').trim();
        if (!candPet) return false;
        const candHasAnyPet = candPet !== '沒有養寵物';
        if (want === '沒有養寵物') return candPet === '沒有養寵物';
        const parsed = (typeof parsePetCriterionValue === 'function')
            ? parsePetCriterionValue(want)
            : { status: '有養寵物', petType: want };
        if (parsed.status === '沒有養寵物') return candPet === '沒有養寵物';
        if (!candHasAnyPet) return false;
        if (!parsed.petType || parsed.petType === '不限' || parsed.petType.startsWith('不限')) return true;
        return candPet === parsed.petType;
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
    if (!A || !B) return false;
    const idA = String(A.id || '').trim();
    const idB = String(B.id || '').trim();
    if (!idA || !idB || idA === idB) return false;
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.isPairRecentlyUnmatched === 'function' && CloudSync.isPairRecentlyUnmatched(idA, idB)) {
        return false;
    }
    const aHasB = (A.matchedHistory || []).some(h => String(h.partnerId).trim() === idB) ||
                  String(A.matchedWithId || '').trim() === idB;
    const bHasA = (B.matchedHistory || []).some(h => String(h.partnerId).trim() === idA) ||
                  String(B.matchedWithId || '').trim() === idA;
    if (aHasB || bHasA) return false;
    return acceptsCandidate(A, B) && acceptsCandidate(B, A);
}

function hasUserMatchedInRegularSession(user, targetSession) {
    if (!user || !targetSession) return false;
    const normTarget = (typeof normalizeSessionLabel === 'function')
        ? normalizeSessionLabel(targetSession)
        : String(targetSession).trim();
    if (!normTarget || String(normTarget).includes('強制')) return false;

    const rawHist = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
        ? CloudSync.mapToArray(user.matchedHistory)
        : (Array.isArray(user.matchedHistory) ? user.matchedHistory : []);
    if (rawHist.some(h => h && !h.activityId && isSameSession(h.session, normTarget))) {
        return true;
    }
    if (user.matchedWithId && user.matchedSession && isSameSession(user.matchedSession, normTarget)) {
        return true;
    }
    return false;
}

function recordPairMatch(userA, userB, targetSession, nowTs, activityId = null, matchDetail = '') {
    if (!userA || !userB || String(userA.id) === String(userB.id)) return false;

    // 嚴格 1 對 1 保護：常規週二／週四／週六場次每人當場最多只能配對 1 人，絕不允許 1 人配對 2 人
    // 但若明確帶有「強制補齊」的標記（代表秘密強制通道等管理員介入），則允許 1 對多配對
    const isForceMatching = String(targetSession).includes('強制') || String(matchDetail).includes('強制');
    if (!activityId && targetSession && !isForceMatching) {
        if (hasUserMatchedInRegularSession(userA, targetSession) || hasUserMatchedInRegularSession(userB, targetSession)) {
            console.warn('已攔截同場次重複配對（每人限 1 對 1）：', userA.id, userB.id, targetSession);
            return false;
        }
    }

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.clearPairUnmatched === 'function') {
        CloudSync.clearPairUnmatched(userA.id, userB.id);
    }
    if (!Array.isArray(userA.matchedHistory)) {
        userA.matchedHistory = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
            ? CloudSync.mapToArray(userA.matchedHistory)
            : [];
    }
    if (!Array.isArray(userB.matchedHistory)) {
        userB.matchedHistory = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
            ? CloudSync.mapToArray(userB.matchedHistory)
            : [];
    }

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
    return true;
}

function findMaximumCompatibilityMatching(pool, adj) {
    const n = pool.length;
    const matchOf = new Array(n).fill(-1);
    if (n < 2) return matchOf;

    // 1. 先依「可配對對象數最少優先（MRV）」進行貪心初始配對，優先保障條件較嚴格的玩家
    const order = Array.from({ length: n }, (_, idx) => idx).sort((a, b) => adj[a].length - adj[b].length);
    order.forEach(u => {
        if (matchOf[u] !== -1) return;
        const neighbors = [...adj[u]].sort((a, b) => adj[a].length - adj[b].length);
        for (let k = 0; k < neighbors.length; k++) {
            const v = neighbors[k];
            if (matchOf[v] === -1) {
                matchOf[u] = v;
                matchOf[v] = u;
                break;
            }
        }
    });

    // 2. Edmonds Blossom 增廣路徑演算法：在 100% 遵守雙方條件前提下，透過調整重排找出全場最大配對數
    const p = new Array(n).fill(-1);
    const base = new Array(n).fill(0);
    const used = new Array(n).fill(false);
    const blossom = new Array(n).fill(false);

    const lca = (a, b) => {
        const visited = new Array(n).fill(false);
        while (true) {
            a = base[a];
            visited[a] = true;
            if (matchOf[a] === -1) break;
            a = p[matchOf[a]];
        }
        while (true) {
            b = base[b];
            if (visited[b]) return b;
            b = p[matchOf[b]];
        }
    };

    const markPath = (v, b, children) => {
        while (base[v] !== b) {
            blossom[base[v]] = blossom[base[matchOf[v]]] = true;
            p[v] = children;
            children = matchOf[v];
            v = p[matchOf[v]];
        }
    };

    const findAugmentingPath = (root) => {
        used.fill(false);
        p.fill(-1);
        for (let i = 0; i < n; i++) base[i] = i;

        const q = [root];
        used[root] = true;
        let qHead = 0;

        while (qHead < q.length) {
            const v = q[qHead++];
            for (let idx = 0; idx < adj[v].length; idx++) {
                const to = adj[v][idx];
                if (base[v] === base[to] || matchOf[v] === to) continue;
                if (to === root || (matchOf[to] !== -1 && p[matchOf[to]] !== -1)) {
                    const curBase = lca(v, to);
                    blossom.fill(false);
                    markPath(v, curBase, to);
                    markPath(to, curBase, v);
                    for (let i = 0; i < n; i++) {
                        if (blossom[base[i]]) {
                            base[i] = curBase;
                            if (!used[i]) {
                                used[i] = true;
                                q.push(i);
                            }
                        }
                    }
                } else if (p[to] === -1) {
                    p[to] = v;
                    if (matchOf[to] === -1) return to;
                    const nextV = matchOf[to];
                    used[nextV] = true;
                    q.push(nextV);
                }
            }
        }
        return -1;
    };

    for (let i = 0; i < n; i++) {
        if (matchOf[i] === -1 && adj[i].length > 0) {
            const v = findAugmentingPath(i);
            let cur = v;
            while (cur !== -1) {
                const pv = p[cur];
                const ppv = matchOf[pv];
                matchOf[cur] = pv;
                matchOf[pv] = cur;
                cur = ppv;
            }
        }
    }

    return matchOf;
}

function diagnoseSessionUnmatchedReason(user, allSessionUsers, reservedIds = new Set()) {
    if (!user) return '資料異常';
    const uid = String(user.id || '').trim();
    if (user.isWarned) return '⚠️ 警告帳號（系統不提供配對）';
    if (user.isMatchBanned) return '🚫 管理員設定「禁止配對」';
    if (reservedIds.has(uid)) return '🔒 秘密強制配對保留名單未觸發';

    const others = (allSessionUsers || []).filter(other => other && String(other.id).trim() !== uid && !other.isWarned && !other.isMatchBanned);
    if (others.length === 0) {
        return '🔍 本場次無其他可參與配對的玩家';
    }

    let uAcceptsCount = 0;
    let othersAcceptUCount = 0;
    let mutualCompatCount = 0;

    others.forEach(other => {
        const uOk = acceptsCandidate(user, other);
        const oOk = acceptsCandidate(other, user);
        if (uOk) uAcceptsCount++;
        if (oOk) othersAcceptUCount++;
        if (uOk && oOk) mutualCompatCount++;
    });

    if (mutualCompatCount > 0) {
        return `⏳ 場內有 ${mutualCompatCount} 位互相符合的對象，但名額已被其他玩家優先配對走（可補跑配對）`;
    }
    if (uAcceptsCount === 0) {
        return '🔍 自身開出的條件過嚴（場內異性無人同時符合此玩家條件）';
    }
    if (othersAcceptUCount === 0) {
        return '🔍 未符合其他異性玩家開出的條件（場內無人同時接受此玩家條件）';
    }
    return '🔍 單向有符合對象，但雙方條件未同時互中（互選交集為 0）';
}

function formatUserCriteriaPlainText(u) {
    if (!u || typeof u !== 'object') return '不限制（隨機配對）';
    const crit = (u.exactMatchCriteria && typeof u.exactMatchCriteria === 'object') ? u.exactMatchCriteria : {};
    const keys = Object.keys(crit).filter(k => !(k === 'city' && crit.region));
    if (keys.length === 0) return '不限制（隨機配對）';
    const mustSet = new Set(
        (Array.isArray(u.mustMatchKeys) ? u.mustMatchKeys : [])
            .map(String)
            .filter(k => keys.includes(k))
            .slice(0, 2)
    );
    const labelOf = (k) => k === 'region' ? `居住地區:${crit.region}` : `${(typeof FIELD_LABELS !== 'undefined' && FIELD_LABELS[k]) || k}:${crit[k]}`;
    const mustList = keys.filter(k => mustSet.has(k)).map(labelOf);
    const orList = keys.filter(k => !mustSet.has(k)).map(labelOf);
    const parts = [];
    if (mustList.length > 0) parts.push(`🔒必須:${mustList.join('+')}`);
    if (orList.length > 0) parts.push(`✨選填:${orList.join('/')}`);
    return parts.join(' ｜ ') || '不限制（隨機配對）';
}

function saveSessionMatchResultRecord(targetSession, allSessionUsers, users, reservedIds, nowTs) {
    const normSession = (typeof normalizeSessionLabel === 'function')
        ? normalizeSessionLabel(targetSession)
        : String(targetSession || '').trim();
    if (!normSession) return null;

    const storageKey = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined')
        ? SESSION_MATCH_RESULTS_KEY
        : 'yuelao_session_match_results';
    const docKey = (typeof ActivityRegArchive !== 'undefined' && typeof ActivityRegArchive.sanitizeSeg === 'function')
        ? ActivityRegArchive.sanitizeSeg(normSession)
        : normSession.replace(/[\/.#$\[\]\s]+/g, '_');

    const userById = new Map();
    (users || []).forEach(u => {
        if (u && u.id) userById.set(String(u.id).trim(), u);
    });

    const matchedUsers = [];
    const unmatchedUsers = [];
    const seenPairs = new Set();
    const matchedPairs = [];

    allSessionUsers.forEach(regU => {
        const pid = String(regU.id).trim();
        const liveU = userById.get(pid) || regU;
        const histLinks = (Array.isArray(liveU.matchedHistory) ? liveU.matchedHistory : [])
            .filter(h => !h.activityId && isSameSession(h.session, normSession));

        if (histLinks.length > 0) {
            const firstLink = histLinks[0];
            const partnerId = String(firstLink.partnerId || '').trim();
            const partnerU = userById.get(partnerId);
            const partnerName = (partnerU && partnerU.nickname) || firstLink.partnerName || `玩家_${partnerId}`;
            matchedUsers.push({
                playerId: pid,
                nickname: liveU.nickname || `玩家_${pid}`,
                gender: liveU.gender || '',
                age: liveU.age || '',
                region: liveU.region || '',
                partnerId,
                partnerName,
                session: normSession,
                matchedAt: Number(firstLink.matchedAt || nowTs),
                criteriaSummary: formatUserCriteriaPlainText(liveU)
            });
            if (partnerId) {
                const pk = [pid, partnerId].sort().join('__');
                if (!seenPairs.has(pk)) {
                    seenPairs.add(pk);
                    matchedPairs.push({
                        idA: pid,
                        nameA: liveU.nickname || `玩家_${pid}`,
                        genderA: liveU.gender || '',
                        idB: partnerId,
                        nameB: partnerName,
                        genderB: (partnerU && partnerU.gender) || '',
                        matchedAt: Number(firstLink.matchedAt || nowTs)
                    });
                }
            }
        } else {
            unmatchedUsers.push({
                playerId: pid,
                nickname: liveU.nickname || `玩家_${pid}`,
                gender: liveU.gender || '',
                age: liveU.age || '',
                region: liveU.region || '',
                criteriaSummary: formatUserCriteriaPlainText(liveU),
                failReason: diagnoseSessionUnmatchedReason(liveU, allSessionUsers, reservedIds)
            });
        }
    });

    // 單調遞增保護：合併本地與雲端既有場次結算快照，保留所有有效 1 對 1 配對（且未被管理員或玩家解除配對）不倒退
    let localSnap = null;
    let cloudSnap = null;
    try {
        const existingMap = JSON.parse(localStorage.getItem(storageKey) || '{}');
        if (existingMap && typeof existingMap === 'object' && existingMap[docKey]) {
            localSnap = existingMap[docKey];
        }
    } catch (e) {}
    if (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[storageKey] && CloudSync.tree[storageKey][docKey]) {
        cloudSnap = CloudSync.tree[storageKey][docKey];
    }

    const mergedPrevPairsMap = new Map();
    [localSnap, cloudSnap].forEach(sp => {
        if (!sp || !Array.isArray(sp.matchedPairs)) return;
        sp.matchedPairs.forEach(p => {
            if (!p || !p.idA || !p.idB) return;
            const pk = [String(p.idA).trim(), String(p.idB).trim()].sort().join('__');
            if (!mergedPrevPairsMap.has(pk)) {
                mergedPrevPairsMap.set(pk, { ...p });
            }
        });
    });

    const prevTotalReg = Math.max(Number((localSnap && localSnap.totalRegCount) || 0), Number((cloudSnap && cloudSnap.totalRegCount) || 0));
    const prevMaleReg = Math.max(Number((localSnap && localSnap.maleRegCount) || 0), Number((cloudSnap && cloudSnap.maleRegCount) || 0));
    const prevFemaleReg = Math.max(Number((localSnap && localSnap.femaleRegCount) || 0), Number((cloudSnap && cloudSnap.femaleRegCount) || 0));

    if (mergedPrevPairsMap.size > 0) {
        const currentPairedIds = new Set();
        matchedPairs.forEach(p => {
            if (p && p.idA) currentPairedIds.add(String(p.idA).trim());
            if (p && p.idB) currentPairedIds.add(String(p.idB).trim());
        });
        mergedPrevPairsMap.forEach(oldP => {
            const idA = String(oldP.idA).trim();
            const idB = String(oldP.idB).trim();
            if (!idA || !idB || idA === idB) return;
            if (currentPairedIds.has(idA) || currentPairedIds.has(idB)) return;
            if (typeof CloudSync !== 'undefined' && typeof CloudSync.isPairRecentlyUnmatched === 'function' && CloudSync.isPairRecentlyUnmatched(idA, idB)) {
                return;
            }
            const uA = userById.get(idA);
            const uB = userById.get(idB);
            if (!uA || !uB) return;

            currentPairedIds.add(idA);
            currentPairedIds.add(idB);
            matchedPairs.push({ ...oldP });

            const addRestoredMatchedUser = (uObj, pObj, pFallbackName) => {
                const uid = String(uObj.id).trim();
                if (!matchedUsers.some(m => String(m.playerId).trim() === uid)) {
                    matchedUsers.push({
                        playerId: uid,
                        nickname: uObj.nickname || `玩家_${uid}`,
                        gender: uObj.gender || '',
                        age: uObj.age || '',
                        region: uObj.region || '',
                        partnerId: String(pObj.id).trim(),
                        partnerName: pObj.nickname || pFallbackName || `玩家_${pObj.id}`,
                        session: normSession,
                        matchedAt: Number(oldP.matchedAt || nowTs),
                        criteriaSummary: formatUserCriteriaPlainText(uObj)
                    });
                }
            };
            addRestoredMatchedUser(uA, uB, oldP.nameB);
            addRestoredMatchedUser(uB, uA, oldP.nameA);
        });

        const finalMatchedSet = new Set(matchedUsers.map(m => String(m.playerId).trim()));
        for (let i = unmatchedUsers.length - 1; i >= 0; i--) {
            if (finalMatchedSet.has(String(unmatchedUsers[i].playerId).trim())) {
                unmatchedUsers.splice(i, 1);
            }
        }
    }

    const record = {
        id: docKey,
        session: normSession,
        batchLabel: extractBatchLabel(normSession),
        executedAtTs: nowTs,
        executedAtStr: new Date(nowTs).toLocaleString('zh-TW', { hour12: false }),
        totalRegCount: Math.max(allSessionUsers.length, prevTotalReg),
        maleRegCount: Math.max(allSessionUsers.filter(u => u.gender === '男').length, prevMaleReg),
        femaleRegCount: Math.max(allSessionUsers.filter(u => u.gender === '女').length, prevFemaleReg),
        matchedCount: matchedUsers.length,
        matchedPairCount: matchedPairs.length,
        unmatchedCount: unmatchedUsers.length,
        matchedPairs,
        matchedUsers,
        unmatchedUsers
    };

    try {
        const existingMap = JSON.parse(localStorage.getItem(storageKey) || '{}');
        const mapObj = (existingMap && typeof existingMap === 'object' && !Array.isArray(existingMap)) ? existingMap : {};
        mapObj[docKey] = record;
        localStorage.setItem(storageKey, JSON.stringify(mapObj));
        if (typeof LocalJsonCache !== 'undefined') {
            LocalJsonCache.invalidate(storageKey);
        }
    } catch (e) {}

    if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
        CloudSync.putNode(`${storageKey}/${docKey}`, record);
    }

    return record;
}

function restoreSessionMatchesFromSnapshot(rawSessionLabel) {
    const normSession = (typeof normalizeSessionLabel === 'function')
        ? normalizeSessionLabel(rawSessionLabel)
        : String(rawSessionLabel || '').trim();
    if (!normSession) return 0;

    if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
        AdminMemoryCache.invalidate('users');
    }
    const users = getUsers();
    const userById = new Map();
    users.forEach(u => {
        if (u && u.id) userById.set(String(u.id).trim(), u);
    });

    const storageKey = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined')
        ? SESSION_MATCH_RESULTS_KEY
        : 'yuelao_session_match_results';
    const docKey = (typeof ActivityRegArchive !== 'undefined' && typeof ActivityRegArchive.sanitizeSeg === 'function')
        ? ActivityRegArchive.sanitizeSeg(normSession)
        : normSession.replace(/[\/.#$\[\]\s]+/g, '_');

    let localSnap = null;
    let cloudSnap = null;
    try {
        const localMap = JSON.parse(localStorage.getItem(storageKey) || '{}');
        localSnap = localMap[docKey] || Object.values(localMap || {}).find(s => s && isSameSession(s.session, normSession)) || null;
    } catch (e) {}
    if (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[storageKey]) {
        const treeMap = CloudSync.tree[storageKey];
        cloudSnap = treeMap[docKey] || Object.values(treeMap || {}).find(s => s && isSameSession(s.session, normSession)) || null;
    }

    const candidatePairs = [];
    [localSnap, cloudSnap].forEach(sp => {
        if (sp && Array.isArray(sp.matchedPairs)) {
            sp.matchedPairs.forEach(p => {
                if (p && p.idA && p.idB) {
                    candidatePairs.push({
                        idA: String(p.idA).trim(),
                        idB: String(p.idB).trim(),
                        matchedAt: Number(p.matchedAt || sp.executedAtTs || Date.now())
                    });
                }
            });
        }
    });

    // 同時掃描全站聊天室中屬於本場次系統開場訊息的配對（補齊任何尚未寫入結算快照的配對）
    const chatsMap = (typeof getAdminChatsMap === 'function')
        ? getAdminChatsMap()
        : (() => { try { return JSON.parse(localStorage.getItem(CHATS_KEY) || '{}'); } catch (e) { return {}; } })();
    Object.entries(chatsMap || {}).forEach(([pk, rawThread]) => {
        const parts = String(pk || '').split('__').map(s => s.trim()).filter(Boolean);
        if (parts.length !== 2 || parts[0] === parts[1]) return;
        const msgs = Array.isArray(rawThread)
            ? rawThread
            : (rawThread && typeof rawThread === 'object' ? Object.values(rawThread) : []);
        const sysMatchMsg = msgs.find(m => m && m.senderId === 'system' && typeof m.text === 'string' && m.text.includes(normSession));
        if (sysMatchMsg) {
            candidatePairs.push({
                idA: parts[0],
                idB: parts[1],
                matchedAt: Number(sysMatchMsg.ts || Date.now())
            });
        }
    });

    const currentlyPairedIds = new Set();
    users.forEach(u => {
        if (u && u.id && hasUserMatchedInRegularSession(u, normSession)) {
            currentlyPairedIds.add(String(u.id).trim());
        }
    });

    const restoredPairs = [];
    const affectedUserIds = new Set();

    candidatePairs.forEach(cp => {
        const { idA, idB, matchedAt } = cp;
        if (!idA || !idB || idA === idB) return;
        if (currentlyPairedIds.has(idA) || currentlyPairedIds.has(idB)) return;
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.isPairRecentlyUnmatched === 'function' && CloudSync.isPairRecentlyUnmatched(idA, idB)) {
            return;
        }
        const uA = userById.get(idA);
        const uB = userById.get(idB);
        if (!uA || !uB || uA.isWarned || uA.isMatchBanned || uB.isWarned || uB.isMatchBanned) return;

        const protectedRestoreSession = normSession.includes('・強制補齊') ? normSession : `${normSession}・強制補齊`;
        if (recordPairMatch(uA, uB, protectedRestoreSession, matchedAt, null, '・強制補齊')) {
            [uA, uB].forEach(uObj => {
                const lastEntry = Array.isArray(uObj.matchedHistory) ? uObj.matchedHistory[uObj.matchedHistory.length - 1] : null;
                if (lastEntry) {
                    lastEntry.isForceRepaired = true;
                    lastEntry.session = protectedRestoreSession;
                    lastEntry.matchDetail = '・強制補齊';
                }
            });
            currentlyPairedIds.add(idA);
            currentlyPairedIds.add(idB);
            affectedUserIds.add(idA);
            affectedUserIds.add(idB);
            restoredPairs.push({ idA, nameA: uA.nickname, idB, nameB: uB.nickname });
        }
    });

    if (restoredPairs.length === 0) {
        alert(`ℹ️【${normSession}】目前所有有效配對紀錄皆已完整同步，沒有需要還原的遺失配對。`);
        return 0;
    }

    const previewLines = restoredPairs.slice(0, 12).map(p => `・${p.nameA} (${p.idA}) ⇄ ${p.nameB} (${p.idB})`);
    if (restoredPairs.length > 12) {
        previewLines.push(`...其餘 ${restoredPairs.length - 12} 對`);
    }

    const { allSessionUsers } = collectSessionParticipantsAndMatchedIds(normSession, users);
    saveSessionMatchResultRecord(normSession, allSessionUsers, users, new Set(), Date.now());
    saveUsers(users, { isMatchMutation: true, targetIds: Array.from(affectedUserIds) });
    appendLog(`<span class="text-emerald-300">[還原場次配對紀錄]</span> 已從結算快照與聊天室紀錄為「<strong>${normSession}</strong>」還原 <strong>${restoredPairs.length} 對</strong>（${restoredPairs.length * 2} 人）配對紀錄。`);
    alert(`✅ 已成功還原【${normSession}】遺失的 ${restoredPairs.length} 對（${restoredPairs.length * 2} 人）配對紀錄並同步寫入雲端！\n\n${previewLines.join('\n')}`);
    return restoredPairs.length;
}

window.restoreSessionMatchesFromSnapshot = restoreSessionMatchesFromSnapshot;

let autoSchedule2000ClaimInFlight = false;

async function claimAndRunAutoSchedule2000(dateKey, dayOfWeek) {
    if (autoSchedule2000ClaimInFlight) return;
    autoSchedule2000ClaimInFlight = true;
    try {
        const sched = getBatchScheduleInfo(getCurrentBatch());
        const autoSession = dayOfWeek === 2 ? sched.tueLabel : (dayOfWeek === 4 ? sched.thuLabel : sched.satLabel);

        // 1. 先從雲端確認今天 20:00 是否已被其他後台分頁／裝置執行過，若已執行則直接同步本地鎖並停止
        if (typeof CloudSync !== 'undefined' && !CloudSync.isLocalSandboxMode() && CloudSync.dbUrl) {
            try {
                const encodedLogPath = CloudSync.encodePath(AUTO_RUN_LOG_KEY);
                const res = await fetch(`${CloudSync.dbUrl}/${encodedLogPath}.json${CloudSync.authQuery()}`, { method: 'GET', cache: 'no-store' });
                if (res.ok) {
                    const remoteMap = await res.json();
                    if (remoteMap && typeof remoteMap === 'object' && remoteMap[dateKey]) {
                        localStorage.setItem(AUTO_RUN_LOG_KEY, JSON.stringify(remoteMap));
                        return;
                    }
                }
            } catch (e) {}
        }

        // 2. 檢查該場次是否已有配對成功紀錄或結算快照；若已有紀錄代表已結算過，補寫鎖定旗標後立即停止不再重跑
        const latestUsers = getUsers();
        const alreadyHasSessionMatches = latestUsers.some(u => u && hasUserMatchedInRegularSession(u, autoSession));
        let hasSavedSnap = false;
        try {
            const smrKey = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined') ? SESSION_MATCH_RESULTS_KEY : 'yuelao_session_match_results';
            const smrMap = JSON.parse(localStorage.getItem(smrKey) || '{}');
            hasSavedSnap = Object.values(smrMap || {}).some(s => s && isSameSession(s.session, autoSession) && Number(s.matchedPairCount || 0) > 0);
        } catch (e) {}

        const executedMap = JSON.parse(localStorage.getItem(AUTO_RUN_LOG_KEY) || '{}');
        executedMap[dateKey] = true;
        localStorage.setItem(AUTO_RUN_LOG_KEY, JSON.stringify(executedMap));
        if (typeof CloudSync !== 'undefined') {
            await CloudSync.putNode(AUTO_RUN_LOG_KEY, executedMap);
        }

        if (alreadyHasSessionMatches || hasSavedSnap) {
            return;
        }

        const autoSelEl = document.getElementById('adminSessionSelect');
        if (autoSelEl) autoSelEl.value = autoSession;
        runSessionMatch(true, autoSession);
    } finally {
        autoSchedule2000ClaimInFlight = false;
    }
}

let sessionMatchRunInProgress = false;

function collectSessionParticipantsAndMatchedIds(targetSession, users) {
    const pairedThisSessionIds = new Set();
    const userById = new Map();
    const sessionRegUserMap = new Map();

    (users || []).forEach(u => {
        if (!u || !u.id) return;
        const uid = String(u.id).trim();
        userById.set(uid, u);

        if (hasUserMatchedInRegularSession(u, targetSession)) {
            pairedThisSessionIds.add(uid);
        }
        const rawHist = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
            ? CloudSync.mapToArray(u.matchedHistory)
            : (Array.isArray(u.matchedHistory) ? u.matchedHistory : []);
        rawHist.forEach(h => {
            if (h && !h.activityId && isSameSession(h.session, targetSession)) {
                pairedThisSessionIds.add(uid);
                const pId = String(h.partnerId || '').trim();
                if (pId) pairedThisSessionIds.add(pId);
            }
        });
        if (u.matchedWithId && u.matchedSession && isSameSession(u.matchedSession, targetSession)) {
            pairedThisSessionIds.add(uid);
            pairedThisSessionIds.add(String(u.matchedWithId).trim());
        }

        const sessions = Array.isArray(u.registeredSessions)
            ? u.registeredSessions
            : (u.registeredSession ? [u.registeredSession] : []);
        if (sessions.some(s => isSameSession(s, targetSession))) {
            sessionRegUserMap.set(uid, u);
        }
    });

    try {
        const smrKey = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined') ? SESSION_MATCH_RESULTS_KEY : 'yuelao_session_match_results';
        const smrMap = JSON.parse(localStorage.getItem(smrKey) || '{}');
        const snap = Object.values(smrMap || {}).find(s => s && isSameSession(s.session, targetSession));
        if (snap) {
            (snap.matchedUsers || []).forEach(mu => {
                if (mu && mu.playerId) pairedThisSessionIds.add(String(mu.playerId).trim());
                if (mu && mu.partnerId) pairedThisSessionIds.add(String(mu.partnerId).trim());
            });
            (snap.matchedPairs || []).forEach(mp => {
                if (mp && mp.idA) pairedThisSessionIds.add(String(mp.idA).trim());
                if (mp && mp.idB) pairedThisSessionIds.add(String(mp.idB).trim());
            });
        }
    } catch (e) {}

    if (typeof getActivityRegHistory === 'function') {
        const regHist = getActivityRegHistory();
        Object.values(regHist).forEach(rec => {
            if (rec && rec.kind === 'regular' && rec.session && isSameSession(rec.session, targetSession)) {
                const pid = String(rec.playerId || '').trim();
                const liveU = userById.get(pid);
                if (liveU && !sessionRegUserMap.has(pid)) {
                    sessionRegUserMap.set(pid, liveU);
                }
            }
        });
    }

    return {
        pairedThisSessionIds,
        userById,
        allSessionUsers: Array.from(sessionRegUserMap.values())
    };
}

function previewSessionSupplementaryMatch(rawTargetSession) {
    const targetSession = (typeof normalizeSessionLabel === 'function')
        ? normalizeSessionLabel(rawTargetSession)
        : String(rawTargetSession || '').trim();
    if (!targetSession) return null;

    if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
        AdminMemoryCache.invalidate('users');
    }
    const users = getUsers();
    const rules = getForceRules();
    const batchName = extractBatchLabel(targetSession);
    const activeBatchRules = rules.filter(r => extractBatchLabel(r.batch) === batchName);
    const reservedIds = new Set();
    activeBatchRules.forEach(r => {
        reservedIds.add(String(r.adminId));
        reservedIds.add(String(r.targetId));
    });

    const { pairedThisSessionIds, allSessionUsers } = collectSessionParticipantsAndMatchedIds(targetSession, users);

    // 所有該場次尚未配對成功的報名玩家
    const allUnmatchedSessionUsers = allSessionUsers.filter(u => {
        const uidStr = String(u.id).trim();
        return !pairedThisSessionIds.has(uidStr) && !hasUserMatchedInRegularSession(u, targetSession);
    });

    const dryRunPairedIds = new Set(pairedThisSessionIds);
    const plannedPairs = [];
    const plannedPartnerByPid = new Map();

    // 1. 先模擬尚未執行的秘密強制配對規則
    activeBatchRules.forEach(rule => {
        if (rule.executed) return;
        const adminIdStr = String(rule.adminId || '').trim();
        const targetIdStr = String(rule.targetId || '').trim();
        if (dryRunPairedIds.has(targetIdStr)) return;

        const adminUser = allUnmatchedSessionUsers.find(u => String(u.id).trim() === adminIdStr) || users.find(u => String(u.id).trim() === adminIdStr);
        const targetUser = allUnmatchedSessionUsers.find(u => String(u.id).trim() === targetIdStr) || users.find(u => String(u.id).trim() === targetIdStr);

        if (adminUser && targetUser && !adminUser.isWarned && !adminUser.isMatchBanned && !targetUser.isWarned && !targetUser.isMatchBanned) {
            dryRunPairedIds.add(targetIdStr);
            plannedPairs.push({
                idA: adminIdStr,
                nameA: adminUser.nickname || `玩家_${adminIdStr}`,
                genderA: adminUser.gender || '',
                idB: targetIdStr,
                nameB: targetUser.nickname || `玩家_${targetIdStr}`,
                genderB: targetUser.gender || '',
                session: targetSession,
                isForceRule: true
            });
            plannedPartnerByPid.set(adminIdStr, { partner: targetUser, isForceRule: true });
            plannedPartnerByPid.set(targetIdStr, { partner: adminUser, isForceRule: true });
        }
    });

    // 2. 篩選出可進入補跑池的未配對玩家
    const eligiblePool = allUnmatchedSessionUsers.filter(u => {
        if (u.isWarned || u.isMatchBanned) return false;
        const uidStr = String(u.id).trim();
        if (dryRunPairedIds.has(uidStr)) return false;
        if (reservedIds.has(uidStr)) return false;
        return true;
    });

    const adj = Array.from({ length: eligiblePool.length }, () => []);
    for (let i = 0; i < eligiblePool.length; i++) {
        for (let j = i + 1; j < eligiblePool.length; j++) {
            if (canPair(eligiblePool[i], eligiblePool[j])) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }

    const matchOf = findMaximumCompatibilityMatching(eligiblePool, adj);
    for (let i = 0; i < eligiblePool.length; i++) {
        const j = matchOf[i];
        if (j > i) {
            const A = eligiblePool[i];
            const B = eligiblePool[j];
            const idA = String(A.id).trim();
            const idB = String(B.id).trim();
            if (dryRunPairedIds.has(idA) || dryRunPairedIds.has(idB)) continue;
            dryRunPairedIds.add(idA);
            dryRunPairedIds.add(idB);
            plannedPairs.push({
                idA,
                nameA: A.nickname || `玩家_${idA}`,
                genderA: A.gender || '',
                idB,
                nameB: B.nickname || `玩家_${idB}`,
                genderB: B.gender || '',
                session: targetSession,
                isForceRule: false
            });
            plannedPartnerByPid.set(idA, { partner: B, isForceRule: false });
            plannedPartnerByPid.set(idB, { partner: A, isForceRule: false });
        }
    }

    const candidateRows = allUnmatchedSessionUsers.map(u => {
        const pid = String(u.id).trim();
        const plan = plannedPartnerByPid.get(pid) || null;
        if (plan && plan.partner) {
            const pObj = plan.partner;
            const pId = String(pObj.id).trim();
            const pGender = pObj.gender || (pId.startsWith('1') ? '男' : (pId.startsWith('2') ? '女' : ''));
            return {
                session: targetSession,
                playerId: pid,
                nickname: u.nickname || `玩家_${pid}`,
                gender: u.gender || '',
                age: u.age || '',
                region: u.region || '',
                userObj: u,
                willMatch: true,
                isExcluded: false,
                partnerId: pId,
                partnerName: pObj.nickname || `玩家_${pId}`,
                partnerGender: pGender,
                reasonText: plan.isForceRule ? '⚡ 秘密強制通道配對' : '💘 條件雙向吻合（1對1補跑成功）',
                roleTypeText: `${u.gender || '?'} > ${pGender || '?'}`
            };
        }

        const isExcluded = Boolean(u.isWarned || u.isMatchBanned);
        const failReason = diagnoseSessionUnmatchedReason(u, allUnmatchedSessionUsers, reservedIds);
        return {
            session: targetSession,
            playerId: pid,
            nickname: u.nickname || `玩家_${pid}`,
            gender: u.gender || '',
            age: u.age || '',
            region: u.region || '',
            userObj: u,
            willMatch: false,
            isExcluded,
            partnerId: '',
            partnerName: '',
            partnerGender: '',
            reasonText: failReason,
            roleTypeText: `${u.gender || '?'} > 未配對`
        };
    });

    return {
        session: targetSession,
        totalSessionUsersCount: allSessionUsers.length,
        alreadyMatchedCount: pairedThisSessionIds.size,
        unmatchedPoolCount: allUnmatchedSessionUsers.length,
        plannedPairs,
        candidateRows
    };
}

function runSessionMatch(isAuto = false, overrideSession = null, options = {}) {
    if (sessionMatchRunInProgress) {
        if (!isAuto) alert('⏳ 系統正在執行本場次配對結算中，請稍候再試！');
        return null;
    }
    if (typeof CloudSync !== 'undefined' && CloudSync.inFlightWrites > 0) {
        if (!isAuto) alert('⏳ 雲端資料尚在寫入同步中，請稍候 2 秒再點擊執行，避免重複配對！');
        return null;
    }

    const targetSessionSel = document.getElementById('adminSessionSelect');
    const rawTargetSession = overrideSession || (targetSessionSel ? targetSessionSel.value : getBatchScheduleInfo(getCurrentBatch()).tueLabel);
    const targetSession = (typeof normalizeSessionLabel === 'function')
        ? normalizeSessionLabel(rawTargetSession)
        : String(rawTargetSession || '').trim();
    const batchName = extractBatchLabel(targetSession);

    const sessionLockKey = `yuelao_session_match_lock_${targetSession.replace(/[\/.#$\[\]\s]+/g, '_')}`;
    const nowTs = Date.now();
    try {
        const prevLockTs = Number(localStorage.getItem(sessionLockKey) || 0);
        if (prevLockTs > 0 && (nowTs - prevLockTs) < 8000) {
            if (!isAuto) alert('⏳ 剛剛已執行過本場次配對，請稍候 8 秒再操作，避免重疊觸發！');
            return null;
        }
        localStorage.setItem(sessionLockKey, String(nowTs));
    } catch (e) {}

    sessionMatchRunInProgress = true;
    try {
        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('users');
        }
        let users = getUsers();
        if ((!Array.isArray(users) || users.length === 0) && typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[USERS_KEY]) {
            users = CloudSync.mapToArray(CloudSync.tree[USERS_KEY]);
        }
        const rules = getForceRules();

        // 先確保本場次既有配對皆為嚴格 1 對 1（若有任何歷史殘留 1 對多重複紀錄先自動整理為 1 對 1）
        const activeBatchRules = rules.filter(r => extractBatchLabel(r.batch) === batchName);
        const reservedIds = new Set();
        activeBatchRules.forEach(r => {
            reservedIds.add(String(r.adminId));
            reservedIds.add(String(r.targetId));
        });

        // 雙向收集本場次所有已配對玩家 ID（包含本人紀錄、對方紀錄的 partnerId、以及場次結算快照），確保已配對的 A 與 B 絕不再進入補跑名單
        const { pairedThisSessionIds, userById, allSessionUsers } = collectSessionParticipantsAndMatchedIds(targetSession, users);

        let pairCount = 0;
        const triggerLabel = isAuto ? '20:00 到點自動配對' : '20:00 配對執行';

        appendLog(`<span class="text-yellow-300">[${triggerLabel}]</span> 場次：<strong>${targetSession}</strong>...`);

        let forceRulesChanged = false;
        activeBatchRules.forEach(rule => {
            if (rule.executed) return;
            const adminIdStr = String(rule.adminId || '').trim();
            const targetIdStr = String(rule.targetId || '').trim();
            // 允許 adminId 重複配對 (1對多)，但 targetId (一般玩家) 只能配對一次
            if (pairedThisSessionIds.has(targetIdStr)) return;

            const adminUser = users.find(u => String(u.id).trim() === adminIdStr);
            const targetUser = users.find(u => String(u.id).trim() === targetIdStr);

            if (adminUser && targetUser && !adminUser.isMatchBanned && !targetUser.isMatchBanned) {
                // 傳入 matchDetail 標記為強制補齊以略過 recordPairMatch 的 1 對 1 阻擋
                if (recordPairMatch(adminUser, targetUser, targetSession, nowTs, null, '・強制補齊')) {
                    // 不把 adminId 加入 pairedThisSessionIds，讓他可以繼續配下一個人
                    // 但要把 targetId 加入，避免 B/C/D 跑去跟別人配對
                    pairedThisSessionIds.add(targetIdStr);
                    rule.executed = true;
                    forceRulesChanged = true;
                    pairCount++;

                    appendLog(`<span class="text-rose-400">[秘密強制配對完成]</span> ID:<strong>${adminUser.id}</strong>（${adminUser.nickname}）⇄ ID:<strong>${targetUser.id}</strong>（${targetUser.nickname}）`);
                }
            }
        });
        if (forceRulesChanged) {
            saveForceRules(rules);
        }

        // 若管理員已透過「補跑名單預覽視窗」確認名單，優先套用預覽清單中的 1 對 1 組合，確保預覽與執行 100% 一致
        const preferredPairs = (options && Array.isArray(options.preferredPairs)) ? options.preferredPairs : [];
        preferredPairs.forEach(pair => {
            if (!pair || !pair.idA || !pair.idB) return;
            const idA = String(pair.idA).trim();
            const idB = String(pair.idB).trim();
            if (!idA || !idB || idA === idB) return;
            if (pairedThisSessionIds.has(idA) || pairedThisSessionIds.has(idB)) return;
            const uA = userById.get(idA);
            const uB = userById.get(idB);
            if (!uA || !uB || uA.isWarned || uA.isMatchBanned || uB.isWarned || uB.isMatchBanned) return;
            if (!canPair(uA, uB)) return;
            if (recordPairMatch(uA, uB, targetSession, nowTs)) {
                pairedThisSessionIds.add(idA);
                pairedThisSessionIds.add(idB);
                pairCount++;
                if (pairCount <= 15) {
                    appendLog(`<span class="text-emerald-400">[補跑配對成功 #${pairCount}]</span> ID:${uA.id}（${uA.nickname}）⇄ ID:${uB.id}（${uB.nickname}）`);
                }
            }
        });

        // 嚴格過濾：只把「本場次尚未配對過（1對1）」且符合資格的玩家放進待配對池
        const eligiblePool = shuffle(allSessionUsers.filter(u => {
            if (u.isWarned || u.isMatchBanned) return false;
            const uidStr = String(u.id).trim();
            if (pairedThisSessionIds.has(uidStr)) return false;
            if (hasUserMatchedInRegularSession(u, targetSession)) return false;
            if (reservedIds.has(uidStr)) return false;
            return true;
        }));

        // 建立 100% 符合雙方必填／選填條件的相容圖，並使用最大基數配對演算法找出最多可配對組合（每人最多 1 位對象）
        const adj = Array.from({ length: eligiblePool.length }, () => []);
        for (let i = 0; i < eligiblePool.length; i++) {
            for (let j = i + 1; j < eligiblePool.length; j++) {
                if (canPair(eligiblePool[i], eligiblePool[j])) {
                    adj[i].push(j);
                    adj[j].push(i);
                }
            }
        }

        const matchOf = findMaximumCompatibilityMatching(eligiblePool, adj);
        for (let i = 0; i < eligiblePool.length; i++) {
            const j = matchOf[i];
            if (j > i) {
                const A = eligiblePool[i];
                const B = eligiblePool[j];
                const idA = String(A.id).trim();
                const idB = String(B.id).trim();
                if (pairedThisSessionIds.has(idA) || pairedThisSessionIds.has(idB)) continue;
                if (recordPairMatch(A, B, targetSession, nowTs)) {
                    pairedThisSessionIds.add(idA);
                    pairedThisSessionIds.add(idB);
                    pairCount++;

                    if (pairCount <= 15) {
                        appendLog(`<span class="text-emerald-400">[配對成功 #${pairCount}]</span> ID:${A.id}（${A.nickname}）⇄ ID:${B.id}（${B.nickname}）`);
                    }
                }
            }
        }

    if (pairCount > 15) {
        appendLog(`<span class="text-emerald-400">...（其餘成功配對明細已省略，共完成 ${pairCount} 對）</span>`);
    }

    const bannedSkippedCount = allSessionUsers.filter(u => u.isMatchBanned).length;

    // 扣點機制：男生每週前 2 場使用原本免費額度（不扣加場次數）；只有當該屆「已開獎結算場次」累計達到第 3 場（前 2 場免費額度已用完，本場為第 3 場開獎）時，才扣除 1 次額外加場次數
    const targetBatchPrefix = (typeof extractBatchLabel === 'function') ? extractBatchLabel(targetSession) : '';
    const extraCreditDeductedIds = new Set();
    const smrForCreditCheck = (() => {
        try {
            const k = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined') ? SESSION_MATCH_RESULTS_KEY : 'yuelao_session_match_results';
            return JSON.parse(localStorage.getItem(k) || '{}') || {};
        } catch (e) { return {}; }
    })();

    allSessionUsers.forEach(regUser => {
        if (!regUser || !regUser.id) return;
        const pid = String(regUser.id).trim();
        const uObj = userById.get(pid);
        if (!uObj || typeof isMalePlayerRecord !== 'function' || !isMalePlayerRecord(uObj)) return;
        const treeRecForCred = (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[USERS_KEY]) ? CloudSync.tree[USERS_KEY][pid] : null;
        const localCredVal = (typeof getUserExtraMatchCredits === 'function') ? getUserExtraMatchCredits(uObj) : Math.max(0, parseInt(uObj.extraMatchCredits, 10) || 0);
        const treeCredVal = (treeRecForCred && typeof getUserExtraMatchCredits === 'function') ? getUserExtraMatchCredits(treeRecForCred) : (treeRecForCred ? Math.max(0, parseInt(treeRecForCred.extraMatchCredits, 10) || 0) : 0);
        const curCredits = Math.max(localCredVal, treeCredVal);
        if (curCredits <= 0) return;

        // 防止 10 秒內重複連點重疊扣次
        const lastDeductTs = Number(uObj.lastExtraCreditDeductTs || 0);
        if (lastDeductTs > 0 && (nowTs - lastDeductTs) < 10000) return;

        // 僅統計「已實際開獎結算過」的同屆常規場次（結算快照、配對歷史，加上本次正在開獎的 targetSession）
        // 尚未開獎的未來報名場次不計入，確保第 1、2 場開獎先消耗原本 2 場免費額度，第 3 場實際開獎時才扣 1 次加場次數
        const drawnSessionsInBatch = new Set();
        const addIfDrawnSameBatch = (rawS) => {
            const normS = (typeof normalizeSessionLabel === 'function') ? normalizeSessionLabel(rawS) : String(rawS || '').trim();
            if (normS && targetBatchPrefix && typeof extractBatchLabel === 'function' && extractBatchLabel(normS) === targetBatchPrefix) {
                drawnSessionsInBatch.add(normS);
            }
        };

        Object.values(smrForCreditCheck).forEach(snap => {
            if (!snap || !snap.session) return;
            const inMatched = Array.isArray(snap.matchedUsers) && snap.matchedUsers.some(m => m && String(m.playerId).trim() === pid);
            const inUnmatched = Array.isArray(snap.unmatchedUsers) && snap.unmatchedUsers.some(m => m && String(m.playerId).trim() === pid);
            if (inMatched || inUnmatched) {
                addIfDrawnSameBatch(snap.session);
            }
        });

        (Array.isArray(uObj.matchedHistory) ? uObj.matchedHistory : []).forEach(h => {
            if (!h || h.activityId) return;
            const isForce = Boolean(h.isForceRepaired || String(h.session || '').includes('強制') || String(h.matchDetail || '').includes('強制'));
            if (isForce) return;
            addIfDrawnSameBatch(h.session);
        });
        addIfDrawnSameBatch(targetSession);

        if (drawnSessionsInBatch.size > MAX_MALE_REGULAR_SESSIONS) {
            uObj.extraMatchCredits = Math.max(0, curCredits - 1);
            uObj.lastExtraCreditDeductTs = nowTs;
            uObj.extraCreditDeductedBatches = [];
            extraCreditDeductedIds.add(pid);
            const matchedThisRound = pairedThisSessionIds.has(pid);
            appendLog(`<span class="text-amber-300">[加場扣次]</span> 玩家 <strong>${uObj.nickname} (ID:${uObj.id})</strong> 本屆原本 2 場免費額度已用完，第 ${drawnSessionsInBatch.size} 場開獎（${matchedThisRound ? '配對成功' : '未配對成功，依規則照常扣次'}）自動扣除 1 次加場次數（剩餘 <strong>${uObj.extraMatchCredits}</strong> 次）。`);
        }
    });

    // 永久保存本場次「配對成功名單」與「配對失敗名單及原因」
    const summaryRec = saveSessionMatchResultRecord(targetSession, allSessionUsers, users, reservedIds, nowTs);

    const allMutatedIds = Array.from(new Set([...pairedThisSessionIds, ...extraCreditDeductedIds]));
    appendLog(`<span class="text-pink-300">[結算完成]</span> 本場次共配對成功 <strong>${pairCount} 對</strong>${bannedSkippedCount > 0 ? `（另有 ${bannedSkippedCount} 名已報名玩家因設定「禁止配對」而未配對）` : ''}。`);
    if (extraCreditDeductedIds.size > 0) {
        extraCreditDeductedIds.forEach(pid => {
            const uObj = userById.get(String(pid));
            if (!uObj) return;
            const nextCred = Math.max(0, parseInt(uObj.extraMatchCredits, 10) || 0);
            uObj.extraMatchCredits = nextCred;
            uObj.extraCreditDeductedBatches = [];
            uObj.lastExtraCreditDeductTs = nowTs;
            if (typeof CloudSync !== 'undefined') {
                if (CloudSync.tree && CloudSync.tree[USERS_KEY] && CloudSync.tree[USERS_KEY][pid]) {
                    CloudSync.tree[USERS_KEY][pid].extraMatchCredits = nextCred;
                    CloudSync.tree[USERS_KEY][pid].extraCreditDeductedBatches = [];
                    CloudSync.tree[USERS_KEY][pid].lastExtraCreditDeductTs = nowTs;
                }
                if (typeof CloudSync.setSharedPendingUser === 'function') {
                    CloudSync.setSharedPendingUser(pid, { ...uObj }, 45000);
                }
                if (typeof CloudSync.invalidatePersistedEtag === 'function') {
                    CloudSync.invalidatePersistedEtag(USERS_KEY);
                }
            }
            // 同步更新同瀏覽器前台本地玩家狀態快取
            [PLAYER_STATE_PREFIX + pid, FRONTEND_STORAGE_KEY].forEach(stKey => {
                try {
                    const rawSt = localStorage.getItem(stKey);
                    if (!rawSt) return;
                    const parsedSt = JSON.parse(rawSt);
                    if (parsedSt && String(parsedSt.playerId || '') === pid) {
                        parsedSt.extraMatchCredits = nextCred;
                        if (parsedSt.profile) parsedSt.profile.extraMatchCredits = nextCred;
                        localStorage.setItem(stKey, JSON.stringify(parsedSt));
                    }
                } catch (e) {}
            });
        });
    }
    try {
        localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
        if (typeof LocalJsonCache !== 'undefined') LocalJsonCache.invalidate(USERS_LOCAL_KEY);
        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('users');
        }
    } catch (e) {}
    saveUsers(users, { isMatchMutation: true, targetIds: allMutatedIds });
    if (!isAuto && !(options && options.preferredPairs)) {
        const deductedNames = Array.from(extraCreditDeductedIds).map(pid => {
            const u = userById.get(String(pid));
            return u ? `${u.nickname} (ID:${u.id}，剩餘 ${u.extraMatchCredits} 次)` : `ID:${pid}`;
        });
        const deductedSummary = deductedNames.length > 0
            ? `\n・本次扣除第 3 場加場次數（${deductedNames.length} 人）：${deductedNames.join('、')}`
            : '\n・本次扣除第 3 場加場次數：0 人（未達本屆第 3 場或無加場次數）';
        alert(`🌙【${targetSession}】模擬 20:00 開獎結算完成！\n\n・本場次報名人數：${allSessionUsers.length} 人\n・本場次成功配對：${pairCount} 對（${pairCount * 2} 人）${deductedSummary}`);
    }
    return summaryRec;
    } finally {
        sessionMatchRunInProgress = false;
    }
}

function repairDuplicateSameSessionMatches(targetSessionFilter = '') {
    const normFilter = targetSessionFilter
        ? ((typeof normalizeSessionLabel === 'function') ? normalizeSessionLabel(targetSessionFilter) : String(targetSessionFilter).trim())
        : '';

    if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
        AdminMemoryCache.invalidate('users');
    }
    const users = getUsers();
    const userById = new Map();
    users.forEach(u => {
        if (u && u.id) userById.set(String(u.id).trim(), u);
    });

    // 1. 合併掃描雲端原始節點（CloudSync.tree）與本地會員清單，找出所有「同一常規週二／週四／週六場次配對超過 1 人」的異常重複組合
    const extraPairsToRemove = new Map(); // pairKey -> { idA, idB, session }
    const inspectUserHistoryForDup = (u) => {
        if (!u || !u.id) return;
        const uid = String(u.id).trim();
        const rawHist = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
            ? CloudSync.mapToArray(u.matchedHistory)
            : (Array.isArray(u.matchedHistory) ? u.matchedHistory : []);
        const sortedHist = [...rawHist].sort((a, b) => Number(a.matchedAt || 0) - Number(b.matchedAt || 0));

        const keptPartnerBySession = new Map();
        sortedHist.forEach(h => {
            if (!h || h.activityId || !h.session || String(h.session).includes('強制')) return;
            const normSess = (typeof normalizeSessionLabel === 'function')
                ? normalizeSessionLabel(h.session)
                : String(h.session).trim();
            if (!/^第\s*\d+\s*屆.+\([二三四六]\)$/.test(normSess)) return;
            if (normFilter && normSess !== normFilter) return;

            const pid = String(h.partnerId || '').trim();
            if (!pid || pid === uid) return;

            if (!keptPartnerBySession.has(normSess)) {
                keptPartnerBySession.set(normSess, pid);
            } else if (keptPartnerBySession.get(normSess) !== pid) {
                const pk = [uid, pid].sort().join('__');
                extraPairsToRemove.set(pk, { idA: uid, idB: pid, session: normSess });
            }
        });
    };

    if (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[USERS_KEY] && typeof CloudSync.tree[USERS_KEY] === 'object') {
        Object.values(CloudSync.tree[USERS_KEY]).forEach(rawTreeU => inspectUserHistoryForDup(rawTreeU));
    }
    users.forEach(u => inspectUserHistoryForDup(u));

    if (extraPairsToRemove.size === 0) {
        alert('ℹ️ 目前沒有發現同場次 1 對多重複配對的異常紀錄（所有玩家皆為 1 對 1）。');
        return 0;
    }

    const detailLines = Array.from(extraPairsToRemove.values()).map(item => {
        const uA = userById.get(item.idA);
        const uB = userById.get(item.idB);
        return `・[${item.session}] ${uA ? uA.nickname : item.idA} (ID:${item.idA}) ⇄ ${uB ? uB.nickname : item.idB} (ID:${item.idB})`;
    });

    if (!confirm(`偵測到 ${extraPairsToRemove.size} 組同場次多餘的重複配對（違反 1 對 1 規則）：\n\n${detailLines.join('\n')}\n\n確定要保留每位玩家的第一組 1 對 1 配對，並解除多餘的重複配對（讓多出來的對象回到未配對名單以便重新 1 對 1 配對）嗎？`)) {
        return 0;
    }

    const affectedUserIds = new Set();
    extraPairsToRemove.forEach(({ idA, idB }) => {
        affectedUserIds.add(idA);
        affectedUserIds.add(idB);
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.markPairUnmatched === 'function') {
            CloudSync.markPairUnmatched(idA, idB, 315360000000);
        }
        if (typeof ChatStore !== 'undefined' && typeof ChatStore.clearChat === 'function') {
            ChatStore.clearChat(idA, idB);
        }
        const uA = userById.get(idA);
        const uB = userById.get(idB);
        if (uA && Array.isArray(uA.matchedHistory)) {
            uA.matchedHistory = uA.matchedHistory.filter(h => String(h.partnerId).trim() !== idB);
            if (String(uA.matchedWithId || '').trim() === idB) {
                const lastA = uA.matchedHistory[uA.matchedHistory.length - 1] || null;
                uA.matchedSession = lastA ? (lastA.session || null) : null;
                uA.matchedWithId = lastA ? (lastA.partnerId || null) : null;
                uA.matchedWithName = lastA ? (lastA.partnerName || null) : null;
                uA.matchedAt = lastA ? (lastA.matchedAt || null) : null;
            }
        }
        if (uB && Array.isArray(uB.matchedHistory)) {
            uB.matchedHistory = uB.matchedHistory.filter(h => String(h.partnerId).trim() !== idA);
            if (String(uB.matchedWithId || '').trim() === idA) {
                const lastB = uB.matchedHistory[uB.matchedHistory.length - 1] || null;
                uB.matchedSession = lastB ? (lastB.session || null) : null;
                uB.matchedWithId = lastB ? (lastB.partnerId || null) : null;
                uB.matchedWithName = lastB ? (lastB.partnerName || null) : null;
                uB.matchedAt = lastB ? (lastB.matchedAt || null) : null;
            }
        }
    });

    // 同步更新場次結算快照（yuelao_session_match_results），移除舊快照中的多餘重複配對
    const affectedSessions = new Set(Array.from(extraPairsToRemove.values()).map(x => x.session));
    affectedSessions.forEach(sess => {
        const regList = users.filter(u => {
            if (!u || !u.id) return false;
            const sArr = Array.isArray(u.registeredSessions) ? u.registeredSessions : [];
            if (sArr.some(s => isSameSession(s, sess))) return true;
            if (hasUserMatchedInRegularSession(u, sess)) return true;
            if (typeof getActivityRegHistory === 'function') {
                const histMap = getActivityRegHistory();
                return Object.values(histMap).some(r => r && r.kind === 'regular' && isSameSession(r.session, sess) && String(r.playerId) === String(u.id));
            }
            return false;
        });
        saveSessionMatchResultRecord(sess, regList, users, new Set(), Date.now());
    });

    saveUsers(users, { isMatchMutation: true, targetIds: Array.from(affectedUserIds) });
    appendLog(`<span class="text-emerald-300">[修正同場重複配對]</span> 已清理 ${extraPairsToRemove.size} 組同場次多餘重複配對，恢復所有玩家 1 對 1 狀態。`);
    alert(`✅ 已成功修正 ${extraPairsToRemove.size} 組同場次重複配對！\n\n・原本的第一組 1 對 1 配對已完整保留\n・多出來的重複對象已恢復為「未配對」，您現在可點擊「補跑配對」為他們重新 1 對 1 配對！`);
    return extraPairsToRemove.size;
}

window.repairDuplicateSameSessionMatches = repairDuplicateSameSessionMatches;

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
    // 允許同一個 adminId 在同一屆擁有多個不同的 targetId (支援 1 對多)
    const filtered = rules.filter(r => !(r.batch === targetBatch && r.targetId === targetId));
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
    appendLog(`<span class="text-amber-300">[屆數刷新]</span> 系統已推進至 <strong>${nextInfo.batchPrefix}（${nextInfo.tueLabel} / ${nextInfo.thuLabel} / ${nextInfo.satLabel}）</strong>！`);
    renderAdminAll();
}

function getSelectedAdminSession() {
    const sel = document.getElementById('adminSessionSelect');
    if (sel && sel.value) return normalizeSessionLabel(sel.value);
    return getBatchScheduleInfo(getCurrentBatch()).tueLabel;
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
window.manualBatchSyncAllDiscrepancies = manualBatchSyncAllDiscrepancies;


async function runAuditUserIdIntegrity() {
    const resultEl = document.getElementById('auditUserIdResult');
    if (!resultEl) return;
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<div class="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 font-semibold">⏳ 正在掃描全站會員 ID 與資料完整性...</div>`;

    if (typeof CloudSync !== 'undefined' && typeof CloudSync.ensureBackendNodes === 'function') {
        await CloudSync.ensureBackendNodes([USERS_KEY, USER_INDEX_KEY, ID_COUNTER_KEY]);
    }
    const users = getUsers();
    const anomalies = [];
    const igMap = new Map();

    users.forEach(u => {
        if (!u || !u.id) return;
        const pid = String(u.id).trim();
        const gender = String(u.gender || '').trim();
        const igClean = String(u.ig || '').trim().replace(/^@+/, '').toLowerCase();

        // 1. 檢查號段與性別不符（男應為 1xxxx，女應為 2xxxx，極高機率為重複分配覆蓋）
        if ((pid.startsWith('1') && gender === '女') || (pid.startsWith('2') && gender === '男')) {
            anomalies.push({
                id: pid,
                nickname: u.nickname || '-',
                gender,
                ig: u.ig || '-',
                updatedAt: u.updatedAt || '-',
                reason: `⚠️ ID 號段（${pid.startsWith('1') ? '1xxxx 男號段' : '2xxxx 女號段'}）與目前性別「${gender}」不符，極可能遭重複分配覆蓋！`
            });
        }

        if (igClean) {
            if (!igMap.has(igClean)) igMap.set(igClean, []);
            igMap.get(igClean).push(u);
        }
    });

    igMap.forEach((list, igVal) => {
        if (list.length > 1) {
            const idsDesc = list.map(x => `ID:${x.id}(${x.nickname || '-'})`).join('、');
            anomalies.push({
                id: list.map(x => x.id).join(' / '),
                nickname: list.map(x => x.nickname || '-').join(' / '),
                gender: list.map(x => x.gender || '-').join(' / '),
                ig: `@${igVal}`,
                updatedAt: list.map(x => x.updatedAt || '-').join(' / '),
                reason: `⚠️ 相同 IG（@${igVal}）出現在多個 ID：${idsDesc}`
            });
        }
    });

    if (anomalies.length === 0) {
        resultEl.innerHTML = `
            <div class="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 font-semibold">
                ✅ 掃描完成（共 ${users.length} 位會員）：目前資料庫中無號段性別衝突或重複 IG 帳號；若受影響玩家仍在舊分頁，請對方重新整理網頁並重新填寫保存即可取得全新不重複 ID。
            </div>
        `;
        return;
    }

    resultEl.innerHTML = `
        <div class="p-3 rounded-xl bg-rose-50 border border-rose-300 space-y-2 text-xs">
            <div class="font-bold text-rose-800">🚨 共發現 ${anomalies.length} 筆異常帳號（建議通知玩家重新整理網頁並重新填寫保存取得新 ID）：</div>
            ${anomalies.map((a, i) => `
                <div class="p-2.5 rounded-lg bg-white border border-rose-200 space-y-0.5">
                    <div class="font-bold text-[#8f4452]">#${i + 1} ID：${escapeMaintenanceHtml(a.id)} ｜ 暱稱：${escapeMaintenanceHtml(a.nickname)}（${escapeMaintenanceHtml(a.gender)}）｜ IG：${escapeMaintenanceHtml(a.ig)}</div>
                    <div class="text-[11px] text-rose-700">${escapeMaintenanceHtml(a.reason)}</div>
                    <div class="text-[10px] text-gray-400">最後更新：${escapeMaintenanceHtml(a.updatedAt)}</div>
                </div>
            `).join('')}
        </div>
    `;
}
window.runAuditUserIdIntegrity = runAuditUserIdIntegrity;


// ==================== 💞 活動管理：依該活動「配對成功名單」回補目前不是好友的雙方配對 ====================
function areUsersCurrentlyFriends(userA, userB) {
    if (!userA || !userB || !userA.id || !userB.id) return false;
    const idA = String(userA.id).trim();
    const idB = String(userB.id).trim();
    if (!idA || !idB || idA === idB) return false;

    const hasPartnerInUser = (owner, targetPid) => {
        if (!owner) return false;
        if (String(owner.matchedWithId || '').trim() === targetPid) return true;
        const rawHist = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
            ? CloudSync.mapToArray(owner.matchedHistory)
            : (Array.isArray(owner.matchedHistory) ? owner.matchedHistory : []);
        return rawHist.some(h => h && String(h.partnerId || '').trim() === targetPid);
    };

    // 必須雙方名單都互有對方才算「當前已經是好友」；若任一方缺少或雙方都沒有，則需要回補！
    return hasPartnerInUser(userA, idB) && hasPartnerInUser(userB, idA);
}

function collectMatchedPairsForSelectedTarget(rawTargetVal, users) {
    const targetVal = String(rawTargetVal || '').trim();
    if (!targetVal) return { label: '', pairs: [] };

    const smrKey = (typeof SESSION_MATCH_RESULTS_KEY !== 'undefined')
        ? SESSION_MATCH_RESULTS_KEY
        : 'yuelao_session_match_results';
    let localSmrMap = {};
    try {
        localSmrMap = JSON.parse(localStorage.getItem(smrKey) || '{}') || {};
    } catch (e) {}
    const cloudSmrMap = (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[smrKey] && typeof CloudSync.tree[smrKey] === 'object')
        ? CloudSync.tree[smrKey]
        : {};
    const allSnapshots = [...Object.values(localSmrMap), ...Object.values(cloudSmrMap)];

    const pairMap = new Map(); // canonical pairKey -> { idA, idB, session, activityId, matchedAt, matchDetail }
    const addPairCandidate = (id1, id2, sessionStr, actId = null, ts = Date.now(), detail = '') => {
        const a = String(id1 || '').trim();
        const b = String(id2 || '').trim();
        if (!a || !b || a === b) return;
        const pk = [a, b].sort().join('__');
        if (!pairMap.has(pk)) {
            pairMap.set(pk, {
                idA: a,
                idB: b,
                session: String(sessionStr || '').trim(),
                activityId: actId ? String(actId).trim() : null,
                matchedAt: Number(ts) || Date.now(),
                matchDetail: String(detail || '').trim()
            });
        }
    };

    // 1. 自定義活動 (`custom:ACT_ID` 或 `ACT_ID`)
    const isCustomTarget = targetVal.startsWith('custom:') || targetVal.startsWith('ACT_');
    if (isCustomTarget) {
        const actId = targetVal.replace(/^custom:/, '').trim();
        const acts = (typeof getCustomActivities === 'function')
            ? getCustomActivities()
            : JSON.parse(localStorage.getItem(CUSTOM_ACTIVITIES_KEY) || '[]');
        const actObj = (Array.isArray(acts) ? acts : []).find(a => a && String(a.id).trim() === actId) || null;
        const actLabel = actObj ? String(actObj.name || actId).trim() : actId;

        allSnapshots.forEach(snap => {
            if (!snap || typeof snap !== 'object') return;
            const matchSnap = String(snap.activityId || '').trim() === actId ||
                String(snap.id || '').includes(actId) ||
                (actLabel && String(snap.session || '').trim() === actLabel);
            if (!matchSnap) return;
            (snap.matchedPairs || []).forEach(p => {
                if (p && p.idA && p.idB) {
                    addPairCandidate(p.idA, p.idB, actLabel, actId, p.matchedAt || snap.executedAtTs, p.matchDetail || '');
                }
            });
            (snap.matchedUsers || []).forEach(mu => {
                if (mu && mu.playerId && mu.partnerId) {
                    addPairCandidate(mu.playerId, mu.partnerId, actLabel, actId, mu.matchedAt || snap.executedAtTs, mu.matchDetail || '');
                }
            });
        });

        // 同步從配對日誌 (`yuelao_match_logs`) 撈取該專屬活動的配對成功紀錄
        let matchLogs = [];
        try { matchLogs = JSON.parse(localStorage.getItem(MATCH_LOGS_KEY) || '[]'); } catch (e) {}
        if (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[MATCH_LOGS_KEY]) {
            matchLogs = [...matchLogs, ...CloudSync.mapToArray(CloudSync.tree[MATCH_LOGS_KEY])];
        }
        matchLogs.forEach(ml => {
            if (!ml || !ml.idA || !ml.idB) return;
            if ((actLabel && String(ml.session || '').trim() === actLabel) || String(ml.session || '').includes(actId)) {
                addPairCandidate(ml.idA, ml.idB, actLabel, actId, ml.ts, ml.source || '');
            }
        });

        return { label: actLabel, pairs: Array.from(pairMap.values()) };
    }

    // 2. 整屆統計 (`batch:第X屆`)
    if (targetVal.startsWith('batch:')) {
        const batchLabel = targetVal.replace(/^batch:/, '').trim();
        allSnapshots.forEach(snap => {
            if (!snap || typeof snap !== 'object') return;
            const snapBatch = String(snap.batchLabel || (typeof extractBatchLabel === 'function' ? extractBatchLabel(snap.session || '') : '')).trim();
            if (snapBatch !== batchLabel) return;
            const sessName = String(snap.session || batchLabel).trim();
            (snap.matchedPairs || []).forEach(p => {
                if (p && p.idA && p.idB) {
                    addPairCandidate(p.idA, p.idB, sessName, null, p.matchedAt || snap.executedAtTs, p.matchDetail || '');
                }
            });
            (snap.matchedUsers || []).forEach(mu => {
                if (mu && mu.playerId && mu.partnerId) {
                    addPairCandidate(mu.playerId, mu.partnerId, sessName, null, mu.matchedAt || snap.executedAtTs, mu.matchDetail || '');
                }
            });
        });
        return { label: batchLabel, pairs: Array.from(pairMap.values()) };
    }

    // 3. 單一場次 (`session:第X屆...` 或直接場次字串)
    const rawSess = targetVal.startsWith('session:') ? targetVal.replace(/^session:/, '').trim() : targetVal;
    const normSession = (typeof normalizeSessionLabel === 'function') ? normalizeSessionLabel(rawSess) : rawSess;
    const docKey = (typeof ActivityRegArchive !== 'undefined' && typeof ActivityRegArchive.sanitizeSeg === 'function')
        ? ActivityRegArchive.sanitizeSeg(normSession)
        : normSession.replace(/[\/.#$\[\]\s]+/g, '_');

    allSnapshots.forEach(snap => {
        if (!snap || typeof snap !== 'object') return;
        const isMatch = String(snap.id || '') === docKey ||
            (snap.session && (typeof isSameSession === 'function' ? isSameSession(snap.session, normSession) : String(snap.session).trim() === normSession));
        if (!isMatch) return;
        (snap.matchedPairs || []).forEach(p => {
            if (p && p.idA && p.idB) {
                addPairCandidate(p.idA, p.idB, normSession, null, p.matchedAt || snap.executedAtTs, p.matchDetail || '');
            }
        });
        (snap.matchedUsers || []).forEach(mu => {
            if (mu && mu.playerId && mu.partnerId) {
                addPairCandidate(mu.playerId, mu.partnerId, normSession, null, mu.matchedAt || snap.executedAtTs, mu.matchDetail || '');
            }
        });
    });

    // 同時掃描會員資料中仍留有該場次歷史配對紀錄的組合
    (users || []).forEach(u => {
        if (!u || !u.id) return;
        const uid = String(u.id).trim();
        const rawHist = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
            ? CloudSync.mapToArray(u.matchedHistory)
            : (Array.isArray(u.matchedHistory) ? u.matchedHistory : []);
        rawHist.forEach(h => {
            if (!h || h.activityId || !h.partnerId) return;
            const sameSess = (typeof isSameSession === 'function') ? isSameSession(h.session, normSession) : String(h.session || '').trim() === normSession;
            if (sameSess) {
                addPairCandidate(uid, h.partnerId, normSession, null, h.matchedAt || Date.now(), h.matchDetail || '');
            }
        });
    });

    return { label: normSession, pairs: Array.from(pairMap.values()) };
}

let _rematchMissingActivityInFlight = false;

async function rematchMissingActivityPairsFromSelected(overrideTargetVal = null) {
    if (_rematchMissingActivityInFlight) return;
    const selEl = document.getElementById('activityStatsTargetSelect');
    const targetVal = String(overrideTargetVal || (selEl && selEl.value) || '').trim();
    if (!targetVal) {
        alert('請先在「統計對象」下拉選單選擇要回補的屆數、場次或專屬活動！');
        if (selEl) selEl.focus();
        return;
    }

    _rematchMissingActivityInFlight = true;
    const topBtn = document.getElementById('rematchMissingActivityPairsBtn');
    const inlineBtn = document.getElementById('inlineRematchMissingActivityBtn');
    const origTopText = topBtn ? topBtn.textContent : '';
    const origInlineText = inlineBtn ? inlineBtn.textContent : '';
    if (topBtn) {
        topBtn.disabled = true;
        topBtn.textContent = '⏳ 檢查名單中...';
    }
    if (inlineBtn) {
        inlineBtn.disabled = true;
        inlineBtn.textContent = '⏳ 檢查名單中...';
    }

    try {
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.ensureBackendNodes === 'function') {
            await CloudSync.ensureBackendNodes([USERS_KEY, SESSION_MATCH_RESULTS_KEY, CUSTOM_ACTIVITIES_KEY, MATCH_LOGS_KEY, UNMATCHED_PAIRS_CLOUD_NODE]);
        }
        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('users');
        }

        const users = getUsers();
        const userById = new Map();
        users.forEach(u => {
            if (u && u.id) userById.set(String(u.id).trim(), u);
        });

        const { label, pairs } = collectMatchedPairsForSelectedTarget(targetVal, users);
        if (pairs.length === 0) {
            alert(`ℹ️【${label || targetVal}】目前沒有找到歷史配對成功名單紀錄。`);
            return;
        }

        const toRematch = [];
        let alreadyFriendsCount = 0;
        let missingAccountCount = 0;

        pairs.forEach(p => {
            const uA = userById.get(p.idA);
            const uB = userById.get(p.idB);
            if (!uA || !uB) {
                missingAccountCount++;
                return;
            }
            if (areUsersCurrentlyFriends(uA, uB)) {
                alreadyFriendsCount++;
                return;
            }
            toRematch.push({ ...p, uA, uB });
        });

        if (toRematch.length === 0) {
            alert(`✅【${label}】檢查完成！

・該活動配對成功總對數：${pairs.length} 對
・當前已經是好友（已略過）：${alreadyFriendsCount} 對${missingAccountCount > 0 ? `
・帳號已不存在：${missingAccountCount} 對` : ''}

所有有效配對目前都已經是好友，無需重新回補！`);
            return;
        }

        const previewLines = toRematch.slice(0, 12).map((item, idx) =>
            `#${idx + 1} ${item.uA.nickname || item.idA} (${item.idA}) ⇄ ${item.uB.nickname || item.idB} (${item.idB})`
        );
        if (toRematch.length > 12) {
            previewLines.push(`...其餘 ${toRematch.length - 12} 對`);
        }

        const confirmMsg = `【${label}】比對結果：

・該活動歷史配對成功：${pairs.length} 對
・當前已經是好友（將自動略過）：${alreadyFriendsCount} 對
・目前雙方不是好友（即將重新回補配對）：${toRematch.length} 對

確定要將以下 ${toRematch.length} 對重新配對成好友並開啟聊天室嗎？

${previewLines.join('\n')}`;
        if (!confirm(confirmMsg)) {
            return;
        }

        if (topBtn) topBtn.textContent = `⏳ 正在回補 ${toRematch.length} 對...`;
        if (inlineBtn) inlineBtn.textContent = `⏳ 正在回補 ${toRematch.length} 對...`;

        const nowMs = Date.now();
        const nowTimeStr = new Date(nowMs).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
        const affectedUserIds = new Set();
        const expectedPartnerMap = new Map();
        const addExp = (uid, pid) => {
            if (!expectedPartnerMap.has(uid)) expectedPartnerMap.set(uid, new Set());
            expectedPartnerMap.get(uid).add(pid);
        };

        for (const item of toRematch) {
            const { idA, idB, uA, uB, session, activityId, matchDetail } = item;

            // 1. 清除先前可能存在的永久解除配對墓碑，確保雙方可重新恢復好友關係
            if (typeof CloudSync !== 'undefined' && typeof CloudSync.clearPairUnmatched === 'function') {
                await CloudSync.clearPairUnmatched(idA, idB);
            }

            // 2. 移除單邊殘留的舊紀錄（避免重複），再重新寫入雙向配對紀錄
            const cleanHalf = (owner, partnerId) => {
                if (!Array.isArray(owner.matchedHistory)) owner.matchedHistory = [];
                owner.matchedHistory = owner.matchedHistory.filter(h => String(h.partnerId || '').trim() !== partnerId);
            };
            cleanHalf(uA, idB);
            cleanHalf(uB, idA);

            const baseSess = session || label || '活動回補配對';
            const protectedSess = baseSess.includes('・強制補齊') ? baseSess : `${baseSess}・強制補齊`;
            const detailTag = matchDetail ? `${matchDetail}・強制補齊` : '活動名單回補・強制補齊';

            recordPairMatch(uA, uB, protectedSess, nowMs, activityId, detailTag);
            [uA, uB].forEach(uObj => {
                const lastEntry = Array.isArray(uObj.matchedHistory) ? uObj.matchedHistory[uObj.matchedHistory.length - 1] : null;
                if (lastEntry) {
                    lastEntry.isForceRepaired = true;
                    lastEntry.session = protectedSess;
                    lastEntry.matchDetail = detailTag;
                }
            });

            // 3. 強制同步雙方公開資料快照 (`yuelao_pair_profiles` / `yuelao_pair_ig`)，確保前台即時顯示好友卡片與聊天室
            if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
                const pk = CloudSync.pairKeyOf(idA, idB);
                const profA = (typeof buildPairProfileRecord === 'function') ? buildPairProfileRecord(uA) : null;
                const profB = (typeof buildPairProfileRecord === 'function') ? buildPairProfileRecord(uB) : null;
                const igA = (typeof buildPairIgRecord === 'function') ? buildPairIgRecord(uA) : null;
                const igB = (typeof buildPairIgRecord === 'function') ? buildPairIgRecord(uB) : null;
                if (profA) await CloudSync.putNode(`${PAIR_PROFILES_KEY}/${pk}/${idA}`, profA);
                if (profB) await CloudSync.putNode(`${PAIR_PROFILES_KEY}/${pk}/${idB}`, profB);
                await CloudSync.putNode(`${PAIR_IG_KEY}/${pk}/${idA}`, igA);
                await CloudSync.putNode(`${PAIR_IG_KEY}/${pk}/${idB}`, igB);
            }

            // 4. 補建聊天室開場訊息（若該房間目前無訊息）
            const sysText = `💞【${baseSess}】管理員已依據活動配對成功名單為你們重新回補好友關係，現在可以繼續聊天囉！`;
            if (typeof ChatStore !== 'undefined' && typeof ChatStore.ensureThread === 'function') {
                ChatStore.ensureThread(idA, idB, [
                    { senderId: 'system', text: sysText, time: nowTimeStr, ts: nowMs }
                ]);
            }

            affectedUserIds.add(idA);
            affectedUserIds.add(idB);
            addExp(idA, idB);
            addExp(idB, idA);
        }

        await persistRepairedUsersToLocalAndCloud(users, Array.from(affectedUserIds), expectedPartnerMap);

        if (typeof AdminMemoryCache !== 'undefined' && typeof AdminMemoryCache.invalidate === 'function') {
            AdminMemoryCache.invalidate('users');
            AdminMemoryCache.invalidate('chats');
        }
        if (typeof appendLog === 'function') {
            appendLog(`<span class="text-emerald-300">[活動名單回補配對]</span> 管理員已針對「<strong>${escapeMaintenanceHtml(label)}</strong>」重新回補 <strong>${toRematch.length} 對</strong>目前非好友的歷史配對（略過已為好友 ${alreadyFriendsCount} 對）。`);
        }
        if (typeof renderAdminAll === 'function') {
            renderAdminAll(true);
        }

        alert(`✅【${label}】回補完成！

・已重新回補配對：${toRematch.length} 對（${toRematch.length * 2} 人）
・原本已是好友（已略過）：${alreadyFriendsCount} 對

雙方前後台好友名單與聊天室已同步恢復！`);
    } catch (err) {
        console.error('[rematch-missing-activity] 回補失敗', err);
        alert(`⚠️ 回補過程中發生異常（${(err && err.message) || '連線逾時'}），請稍後再試！`);
    } finally {
        _rematchMissingActivityInFlight = false;
        if (topBtn) {
            topBtn.disabled = false;
            topBtn.textContent = origTopText || '💞 回補此活動遺漏好友';
        }
        if (inlineBtn) {
            inlineBtn.disabled = false;
            inlineBtn.textContent = origInlineText || '💞 一鍵回補非好友配對';
        }
    }
}

// 自動在「配對成功名單」區塊標題列旁同步插入回補按鈕，方便直接對照名單點擊
(function bindActivityDetailRematchButtonObserver() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    document.addEventListener('DOMContentLoaded', () => {
        const detailSec = document.getElementById('selActMatchDetailSection');
        if (!detailSec) return;
        const injectInlineBtn = () => {
            if (detailSec.classList.contains('hidden')) return;
            if (document.getElementById('inlineRematchMissingActivityBtn')) return;
            const headings = detailSec.querySelectorAll('h3, h4, div, span');
            for (const el of headings) {
                if (el.children.length === 0 && el.textContent && el.textContent.includes('配對成功名單')) {
                    const parentRow = el.parentElement;
                    if (parentRow && !parentRow.querySelector('#inlineRematchMissingActivityBtn')) {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.id = 'inlineRematchMissingActivityBtn';
                        btn.onclick = () => rematchMissingActivityPairsFromSelected();
                        btn.className = 'ml-auto px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-bold shadow-2xs hover:opacity-95 transition shrink-0';
                        btn.textContent = '💞 一鍵回補非好友配對';
                        parentRow.classList.add('flex', 'flex-wrap', 'items-center', 'justify-between', 'gap-2');
                        parentRow.appendChild(btn);
                    }
                    break;
                }
            }
        };
        const obs = new MutationObserver(() => injectInlineBtn());
        obs.observe(detailSec, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        injectInlineBtn();
    });
})();

window.rematchMissingActivityPairsFromSelected = rematchMissingActivityPairsFromSelected;
window.areUsersCurrentlyFriends = areUsersCurrentlyFriends;
window.collectMatchedPairsForSelectedTarget = collectMatchedPairsForSelectedTarget;
