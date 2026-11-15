/* backend/matching.js - 後台 20:00 自動配對演算法、秘密強制配對通道與測試工具 */

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

    const pairKey = [String(userId), String(targetPartnerId)].sort().join('__');
    const allChats = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
    if (Object.prototype.hasOwnProperty.call(allChats, pairKey)) {
        delete allChats[pairKey];
        localStorage.setItem(CHATS_KEY, JSON.stringify(allChats));
    }
    CloudSync.deleteNode(`${CHATS_KEY}/${pairKey}`);

    saveUsers(users);
    appendLog(`<span class="text-amber-300">[彈性解除配對]</span> 管理員已解除 <strong>${userA.nickname}</strong> ⇄ <strong>${partnerName}</strong> 的好友關係並清空聊天紀錄，前台名單已同步更新。`);
}

function checkSingleCriterion(key, desiredVal, candidate, seekerCriteria = {}) {
    if (!candidate) return false;
    if (key === 'region') {
        if (seekerCriteria.city) {
            return candidate.city === seekerCriteria.city;
        }
        const candidateRegion = candidate.region || inferRegionByCity(candidate.city);
        const regionCities = REGION_CITIES[desiredVal] || [];
        return candidateRegion === desiredVal || regionCities.includes(candidate.city);
    }
    if (key === 'gender') {
        const cid = String(candidate.id);
        if (desiredVal === '女') return candidate.gender === '女' && cid.startsWith('2');
        if (desiredVal === '男') return candidate.gender === '男' && cid.startsWith('1');
        return candidate.gender === desiredVal;
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
    const keys = Object.keys(criteria).filter(k => !(k === 'city' && criteria.region));
    if (keys.length === 0) return true;
    return keys.some(k => checkSingleCriterion(k, criteria[k], candidate, criteria));
}

function canPair(A, B) {
    const alreadyFriends = (A.matchedHistory || []).some(h => String(h.partnerId) === String(B.id)) ||
                           String(A.matchedWithId) === String(B.id);
    if (alreadyFriends) return false;
    return acceptsCandidate(A, B) && acceptsCandidate(B, A);
}

function recordPairMatch(userA, userB, targetSession, nowTs, activityId = null, matchDetail = '') {
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
    saveUsers(users);
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
