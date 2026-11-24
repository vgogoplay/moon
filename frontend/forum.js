// ==================== 📋 月老粉嫩風 PTT 討論區 (緊湊列表版・一般文章30天自動刪除・後台公告不限時間) ====================
let forumPosts = [];
let currentForumFilter = '公告';
let currentViewingPostId = null;
let viewingPostData = null;

const FORUM_INDEX_KEY = 'yuelao_forum_index';
const FORUM_POSTS_KEY = 'yuelao_forum_posts'; // yuelao_forum_posts/{postId} 存放完整內文與留言
const FORUM_RETENTION_DAYS = 30;
const FORUM_RETENTION_MS = FORUM_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const FORUM_POSTS_PER_PAGE = 5;
let forumCurrentPage = 1;

function countForumPostReplies(postObj) {
    if (!postObj || typeof postObj !== 'object') return 0;
    const repliesRaw = postObj.replies;
    let actualCount = null;
    if (Array.isArray(repliesRaw)) {
        actualCount = repliesRaw.filter(r => r && typeof r === 'object').length;
    } else if (repliesRaw && typeof repliesRaw === 'object') {
        actualCount = Object.values(repliesRaw).filter(r => r && typeof r === 'object').length;
    }
    const storedCount = Number(postObj.replyCount || 0);
    if (actualCount !== null) {
        if (actualCount === 0 && storedCount > 0) return storedCount;
        return actualCount;
    }
    return Math.max(0, storedCount);
}

function isBackendForumPost(post) {
    if (!post || typeof post !== 'object') return false;
    return Boolean(
        post.isAdminPost ||
        post.tag === '公告' ||
        String(post.authorId || '').trim() === 'ADMIN'
    );
}

function isUnlimitedForumPostFrontend(post) {
    if (!post || typeof post !== 'object') return false;
    return Boolean(
        post.unlimitedRetention ||
        isBackendForumPost(post) ||
        Number(post.customRetentionDays) === -1
    );
}

function getForumPostRetentionMsFrontend(post) {
    if (post && post.customRetentionDays && Number(post.customRetentionDays) > 0) {
        return Number(post.customRetentionDays) * 24 * 60 * 60 * 1000;
    }
    return FORUM_RETENTION_MS;
}

function isForumPostExpiredFrontend(post, nowTs = Date.now()) {
    if (!post || typeof post !== 'object') return true;
    if (isUnlimitedForumPostFrontend(post)) return false; // 後台發佈的文章／官方公告保存時間不限制
    const createdTs = Number(post.createdAt || 0);
    if (!createdTs || Number.isNaN(createdTs)) return false;
    return (nowTs - createdTs) >= getForumPostRetentionMsFrontend(post);
}

function purgeExpiredForumPostsFrontend(rawPosts) {
    const nowTs = Date.now();
    const valid = [];
    const expiredIds = [];

    (Array.isArray(rawPosts) ? rawPosts : []).forEach(p => {
        if (!p || !p.id) return;
        if (isForumPostExpiredFrontend(p, nowTs)) {
            expiredIds.push(String(p.id).trim());
        } else {
            valid.push(p);
        }
    });

    // 前台僅本地過濾過期文章避免多端同時發送重複 DELETE；由後台或沙盒模式執行實際節點清理
    if (expiredIds.length > 0 && typeof CloudSync !== 'undefined' && (CloudSync.isLocalSandboxMode() || CloudSync.isBackendContext())) {
        expiredIds.forEach(pid => {
            CloudSync.deleteNode(`${FORUM_INDEX_KEY}/${pid}`).catch(() => {});
            CloudSync.deleteNode(`${FORUM_POSTS_KEY}/${pid}`).catch(() => {});
        });
    }

    return valid;
}

function renderForumList() {
    const container = document.getElementById('forumPostList');
    if (!container) return;

    const nowTs = Date.now();
    const activePosts = forumPosts.filter(p => p && p.id && !isForumPostExpiredFrontend(p, nowTs));
    if (activePosts.length !== forumPosts.length) {
        forumPosts = purgeExpiredForumPostsFrontend(forumPosts);
    }

    let filtered = activePosts;
    const myPid = (typeof appState !== 'undefined' && appState && appState.playerId)
        ? String(appState.playerId).trim()
        : '';

    // Sort & Filter logic:
    // 從後台發佈的文章只會顯示在「公告」跟「最新」的類別，不會出現在「熱門」或其他玩家分類
    if (currentForumFilter === '公告') {
        filtered = activePosts.filter(p => isBackendForumPost(p));
        filtered.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    } else if (currentForumFilter === '最新') {
        filtered = activePosts.slice();
        filtered.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    } else if (currentForumFilter === '熱門') {
        const cutoffTs = Date.now() - 4 * 24 * 60 * 60 * 1000; // 近3天內 (放寬涵蓋到第4天午夜)
        filtered = activePosts.filter(p => !isBackendForumPost(p) && Number(p.createdAt || 0) >= cutoffTs).sort((a, b) => {
            const scoreA = Number(a.pushCount || 0) + countForumPostReplies(a);
            const scoreB = Number(b.pushCount || 0) + countForumPostReplies(b);
            if (scoreB !== scoreA) return scoreB - scoreA;
            return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        });
        filtered = filtered.slice(0, 5); // 只顯示近 5 則
    } else if (currentForumFilter === '自己') {
        if (!myPid) {
            filtered = [];
        } else {
            filtered = activePosts.filter(p => !isBackendForumPost(p) && String(p.authorId || '').trim() === myPid);
            filtered.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        }
    } else {
        // Specific player tags (感情 / 心情 / 女孩 / 男孩 / 討論 / 閒聊 / 寵物)
        filtered = activePosts.filter(p => !isBackendForumPost(p) && p.tag === currentForumFilter);
        filtered.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    }

    if (filtered.length === 0) {
        let emptyMsg = '目前還沒有文章，來當第一個發文的人吧！';
        if (currentForumFilter === '公告') {
            emptyMsg = '目前尚無官方公告。';
        } else if (currentForumFilter === '自己') {
            emptyMsg = !myPid
                ? '請先完成個人資料儲存，即可查看自己發表的文章喔！'
                : '你目前還沒有發表過文章喔，點擊右上角「➕ 發文」分享想法吧！';
        }
        container.innerHTML = `<div class="p-8 text-center text-gray-400 text-xs font-medium">${emptyMsg}</div>`;
        const pagEl = document.getElementById('forumPaginationBar');
        if (pagEl) pagEl.innerHTML = '';
        return;
    }

    const totalPages = currentForumFilter === '熱門' ? 1 : Math.max(1, Math.ceil(filtered.length / FORUM_POSTS_PER_PAGE));
    if (forumCurrentPage > totalPages) forumCurrentPage = totalPages;
    if (forumCurrentPage < 1) forumCurrentPage = 1;

    const startIdx = (forumCurrentPage - 1) * FORUM_POSTS_PER_PAGE;
    const pagePosts = currentForumFilter === '熱門' ? filtered : filtered.slice(startIdx, startIdx + FORUM_POSTS_PER_PAGE);

    const html = pagePosts.map(p => {
        const ts = new Date(Number(p.createdAt || Date.now()));
        const mm = String(ts.getMonth() + 1).padStart(2, '0');
        const dd = String(ts.getDate()).padStart(2, '0');
        const dateStr = `${mm}/${dd}`;
        
        const icons = {
            '公告': '📌',
            '感情': '🌸',
            '心情': '💭',
            '女孩': '🎀',
            '男孩': '⚾',
            '討論': '💬',
            '閒聊': '☕',
            '寵物': '🐾'
        };
        const colors = {
            '公告': 'text-rose-600',
            '感情': 'text-pink-500',
            '心情': 'text-purple-500',
            '女孩': 'text-rose-400',
            '男孩': 'text-blue-500',
            '討論': 'text-amber-500',
            '閒聊': 'text-emerald-500',
            '寵物': 'text-orange-500'
        };
        const displayTag = isBackendForumPost(p) ? '公告' : (p.tag || '討論');
        const colorClass = colors[displayTag] || 'text-gray-500';
        const tagIcon = icons[displayTag] || '📌';
        const tagBadge = `<span class="${colorClass} text-[10px] font-bold shrink-0">${tagIcon}[${displayTag}]</span>`;

        let authorName = p.authorName || `匿名.${p.authorGender || '?'}`;
        // 已移除發文者暱稱 4 字限制，完整顯示
        const dateAuthorStr = `${dateStr} ${authorName}`;
        const likes = Number(p.pushCount || 0);
        const replies = countForumPostReplies(p);
        const statsHtml = `<div class="flex items-center gap-2 text-gray-400 text-[11px] shrink-0"><span>❤️${likes}</span><span>💬${replies}</span></div>`;

        return `
            <div onclick="viewForumPost('${yuelaoEscapeHtml(p.id)}')" class="px-3.5 py-2.5 flex flex-col gap-1 hover:bg-pink-50/70 cursor-pointer transition">
                <div class="flex items-center gap-1.5 min-w-0">
                    ${tagBadge}
                    <div class="flex-1 min-w-0 text-[#5e464a] text-[13px] font-bold truncate">${yuelaoEscapeHtml(p.title)}</div>
                </div>
                <div class="flex items-center gap-3 text-gray-400 text-[11px] font-medium">
                    <span class="truncate">${dateAuthorStr}</span>
                    ${statsHtml}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;

    const pagBar = document.getElementById('forumPaginationBar');
    if (!pagBar) return;

    if (currentForumFilter === '熱門' || totalPages <= 1) {
        const noteText = currentForumFilter === '公告'
            ? `共 ${filtered.length} 則`
            : `共 ${filtered.length} 篇（僅保留 ${FORUM_RETENTION_DAYS} 天自動刪除）`;
        pagBar.innerHTML = `<span class="text-gray-400 mt-2 ml-2 mb-2 inline-block">${noteText}</span>`;
    } else {
        const pageBtns = [];
        for (let p = 1; p <= totalPages; p++) {
            const isCur = p === forumCurrentPage;
            pageBtns.push(`
                <button type="button" onclick="goToForumPage(${p})" class="min-w-[28px] h-7 px-2 rounded-lg font-bold transition ${isCur ? 'bg-[#c96a7b] text-white shadow-2xs' : 'bg-white border border-pink-200 text-[#8f4452] hover:bg-pink-50'}">
                    ${p}
                </button>
            `);
        }
        pagBar.innerHTML = `
            <div class="w-full flex flex-wrap items-center justify-between gap-2 text-xs py-2 px-1">
                <span class="text-gray-500 font-medium">顯示第 ${startIdx + 1}～${Math.min(startIdx + FORUM_POSTS_PER_PAGE, filtered.length)} 則，共 ${filtered.length} 則（第 ${forumCurrentPage}/${totalPages} 頁）</span>
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="goToForumPage(${forumCurrentPage - 1})" ${forumCurrentPage <= 1 ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                        ◀ 上一頁
                    </button>
                    ${pageBtns.join('')}
                    <button type="button" onclick="goToForumPage(${forumCurrentPage + 1})" ${forumCurrentPage >= totalPages ? 'disabled' : ''} class="px-2.5 h-7 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-semibold hover:bg-pink-50 disabled:opacity-40 disabled:cursor-not-allowed">
                        下一頁 ▶
                    </button>
                </div>
            </div>
        `;
    }
}

function goToForumPage(p) {
    forumCurrentPage = p;
    renderForumList();
}

function filterForum(tag) {
    currentForumFilter = tag;
    forumCurrentPage = 1;
    document.querySelectorAll('.forum-filter-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-[#8f4452]', 'text-white');
        btn.classList.add('bg-pink-100', 'text-[#8f4452]');
    });
    const activeBtn = Array.from(document.querySelectorAll('.forum-filter-btn')).find(b => b.textContent.includes(tag));
    if (activeBtn) {
        activeBtn.classList.remove('bg-pink-100', 'text-[#8f4452]');
        activeBtn.classList.add('active', 'bg-[#8f4452]', 'text-white');
    }
    renderForumList();
}

let forumRefreshInFlight = null;

function loadForumIndexFromLocalCache() {
    try {
        const raw = localStorage.getItem(FORUM_INDEX_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const arr = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
            ? CloudSync.mapToArray(parsed)
            : (Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? Object.values(parsed) : []));
        return purgeExpiredForumPostsFrontend(arr);
    } catch (e) {
        return [];
    }
}

function saveForumIndexToLocalCache(postsList) {
    try {
        const mapObj = {};
        (Array.isArray(postsList) ? postsList : []).forEach(p => {
            if (p && p.id) mapObj[String(p.id)] = p;
        });
        localStorage.setItem(FORUM_INDEX_KEY, JSON.stringify(mapObj));
        if (typeof LocalJsonCache !== 'undefined' && typeof LocalJsonCache.invalidate === 'function') {
            LocalJsonCache.invalidate(FORUM_INDEX_KEY);
        }
    } catch (e) {}
}

async function refreshForum() {
    if (forumRefreshInFlight) return forumRefreshInFlight;

    // 1. 先立即從本地快取還原（0ms 秒開，避免每次重整都先閃現空白）
    if (forumPosts.length === 0) {
        const cached = loadForumIndexFromLocalCache();
        if (cached.length > 0) {
            forumPosts = cached;
            renderForumList();
        } else {
            const container = document.getElementById('forumPostList');
            if (container) {
                container.innerHTML = '<div class="p-8 text-center text-gray-400 text-xs font-medium">⏳ 載入看板文章中...</div>';
            }
        }
    }

    const isSandbox = (typeof CloudSync !== 'undefined' && CloudSync.isLocalSandboxMode());
    forumRefreshInFlight = (async () => {
        try {
            if (typeof CloudSync !== 'undefined') {
                // 若 CloudSync 仍在初始化（例如剛開網頁立刻點討論區），先等待初始化或匿名登入完成，絕不直接跳過讀取
                if (!CloudSync.initialized && !isSandbox) {
                    if (CloudSync._initPromise) {
                        await Promise.race([
                            CloudSync._initPromise.catch(() => {}),
                            new Promise(r => setTimeout(r, 4000))
                        ]);
                    } else if (typeof yuelaoAuth !== 'undefined' && typeof yuelaoAuth.init === 'function') {
                        await yuelaoAuth.init().catch(() => {});
                    }
                }

                if (!isSandbox && typeof CloudSync.conditionalGetNode === 'function') {
                    // 若目前記憶體與快取仍無資料，強制重新向雲端抓取（避免舊 ETag 回傳 304 導致空列表）
                    const forceFresh = forumPosts.length === 0;
                    let r = await CloudSync.conditionalGetNode(FORUM_INDEX_KEY, { force: forceFresh });
                    if (r.status === 'error') {
                        await new Promise(rDelay => setTimeout(rDelay, 350));
                        r = await CloudSync.conditionalGetNode(FORUM_INDEX_KEY, { force: true });
                    }
                    if (r.status === 'changed') {
                        CloudSync.applyStreamPatch(FORUM_INDEX_KEY, r.data);
                        const rawArr = CloudSync.mapToArray(r.data || {});
                        forumPosts = purgeExpiredForumPostsFrontend(rawArr);
                        saveForumIndexToLocalCache(forumPosts);
                    } else if (r.status === 'unchanged' && forumPosts.length === 0) {
                        const treeArr = (CloudSync.tree && CloudSync.tree[FORUM_INDEX_KEY])
                            ? CloudSync.mapToArray(CloudSync.tree[FORUM_INDEX_KEY])
                            : loadForumIndexFromLocalCache();
                        forumPosts = purgeExpiredForumPostsFrontend(treeArr);
                    }
                } else {
                    const res = await CloudSync.getNodeOnce(FORUM_INDEX_KEY);
                    if (res !== undefined) {
                        const rawArr = CloudSync.mapToArray(res || {});
                        forumPosts = purgeExpiredForumPostsFrontend(rawArr);
                        if (!isSandbox) saveForumIndexToLocalCache(forumPosts);
                    }
                }
            }
            renderForumList();
        } catch (e) {
            renderForumList();
        } finally {
            forumRefreshInFlight = null;
        }
    })();

    return forumRefreshInFlight;
}

function openForumPostModal() {
    if (!appState.playerId) {
        showMiniNotice('⚠️ 尚未登入', '發文前請先完成個人資料登錄並保存。');
        return;
    }
    if (appState.isWarnedAccount) {
        showMiniNotice('🚫 警告帳號', '您的帳號處於警告狀態，暫時無法發文。');
        return;
    }
    const gender = appState.profile.gender || '?';
    const nick = (appState.profile.nickname || '未命名');
    const anonEl = document.getElementById('forumPostIdentityAnon');
    const nickEl = document.getElementById('forumPostIdentityNick');
    if (anonEl) anonEl.textContent = `匿名.${gender}`;
    if (nickEl) nickEl.textContent = nick;

    const titleEl = document.getElementById('forumPostTitle');
    const contentEl = document.getElementById('forumPostContent');
    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
    
    document.getElementById('forumPostModal').classList.remove('hidden');
}

function closeForumPostModal() {
    document.getElementById('forumPostModal').classList.add('hidden');
}

async function submitForumPost() {
    const titleEl = document.getElementById('forumPostTitle');
    const contentEl = document.getElementById('forumPostContent');
    const title = titleEl.value.trim();
    const content = contentEl.value.trim();
    
    if (!title || !content) {
        showMiniNotice('⚠️ 資料不齊', '標題與內文皆不可留白喔！');
        return;
    }
    if (typeof containsBannedWords === 'function' && (containsBannedWords(title) || containsBannedWords(content))) {
        showMiniNotice('🚫 違規字眼', '請勿包含禁止的字眼或外部聯絡方式！');
        return;
    }

    const tagEl = document.querySelector('input[name="forumPostTag"]:checked');
    const tag = tagEl ? tagEl.value : '討論';
    
    const replyLimitEl = document.querySelector('input[name="forumReplyLimit"]:checked');
    const whoCanReply = replyLimitEl ? replyLimitEl.value : 'ALL';
    const idTypeEl = document.querySelector('input[name="forumPostIdentity"]:checked');
    const idType = idTypeEl ? idTypeEl.value : 'anon';
    const authorName = idType === 'nickname' ? (appState.profile.nickname || '未命名') : `匿名.${appState.profile.gender || '?'}`;
    
    const nowTs = Date.now();
    const postId = 'post_' + nowTs + '_' + Math.random().toString(36).substr(2, 5);
    
    const postIndexData = {
        id: postId,
        title,
        tag,
        whoCanReply,
        authorName,
        authorGender: appState.profile.gender || '男',
        authorId: appState.playerId,
        createdAt: nowTs,
        lastUpdatedAt: nowTs,
        pushCount: 0,
        replyCount: 0
    };

    const postFullData = {
        ...postIndexData,
        content,
        replies: {}
    };

    closeForumPostModal();
    showMiniNotice('⏳ 發佈中...', '文章正在寫入伺服器，請稍候。');

    try {
        if (typeof CloudSync !== 'undefined') {
            await CloudSync.patchNode(`${FORUM_INDEX_KEY}/${postId}`, postIndexData, { throwOnError: true });
            await CloudSync.putNode(`${FORUM_POSTS_KEY}/${postId}`, postFullData, { throwOnError: true });
        }
        forumPosts.unshift(postIndexData);
        saveForumIndexToLocalCache(forumPosts);
        filterForum('最新');
        showMiniNotice('🌸 發佈成功', '文章已經成功發佈到月老看板！');
    } catch (e) {
        showMiniNotice('❌ 發佈失敗', '網路異常，請稍後再試。');
    }
}

function syncForumReplyBarGuestState(isGuest) {
    const inputBar = document.getElementById('forumReplyInputBar');
    const guestBar = document.getElementById('forumReplyGuestBar');
    if (inputBar) inputBar.classList.toggle('hidden', Boolean(isGuest));
    if (guestBar) guestBar.classList.toggle('hidden', !isGuest);
}

// 觀看內文（訪客亦可瀏覽文章與留言，但無法按愛心與留言）
async function viewForumPost(postId) {
    const isGuest = !(typeof appState !== 'undefined' && appState && appState.playerId);
    currentViewingPostId = postId;
    syncForumReplyBarGuestState(isGuest);
    const anonCb = document.getElementById('forumReplyAnonCheckbox');
    if (anonCb) {
        anonCb.checked = false;
        if (anonCb.parentElement) anonCb.parentElement.classList.remove('hidden');
    }
    document.getElementById('forumPostHeader').innerHTML = '<div class="text-center text-gray-400 py-10 text-xs">下載文章中...</div>';
    document.getElementById('forumRepliesList').innerHTML = '';
    
    const modal = document.getElementById('forumViewModal');
    const panel = document.getElementById('forumViewPanel');
    modal.classList.remove('hidden');
    setTimeout(() => {
        panel.classList.remove('translate-y-full');
    }, 10);

    await refreshForumPost(postId);
}

function closeForumViewModal() {
    const modal = document.getElementById('forumViewModal');
    const panel = document.getElementById('forumViewPanel');
    panel.classList.add('translate-y-full');
    setTimeout(() => {
        modal.classList.add('hidden');
        currentViewingPostId = null;
    }, 300);
}

async function refreshForumPost(forceId = null) {
    const pid = forceId || currentViewingPostId;
    if (!pid) return;

    try {
        if (typeof CloudSync !== 'undefined') {
            const isSandbox = (typeof CloudSync.isLocalSandboxMode === 'function' && CloudSync.isLocalSandboxMode());
            if (!CloudSync.initialized && !isSandbox) {
                if (CloudSync._initPromise) {
                    await Promise.race([
                        CloudSync._initPromise.catch(() => {}),
                        new Promise(r => setTimeout(r, 4000))
                    ]);
                } else if (typeof yuelaoAuth !== 'undefined' && typeof yuelaoAuth.init === 'function') {
                    await yuelaoAuth.init().catch(() => {});
                }
            }
            let res = await CloudSync.getNodeOnce(`${FORUM_POSTS_KEY}/${pid}`);
            if (res === undefined && !isSandbox) {
                await new Promise(r => setTimeout(r, 350));
                res = await CloudSync.getNodeOnce(`${FORUM_POSTS_KEY}/${pid}`);
            }
            if (res && typeof res === 'object') {
                if (isForumPostExpiredFrontend(res, Date.now())) {
                    purgeExpiredForumPostsFrontend([{ ...res, id: pid }]);
                    forumPosts = forumPosts.filter(p => String(p.id) !== String(pid));
                    renderForumList();
                    document.getElementById('forumPostHeader').innerHTML = `<div class="text-center text-amber-600 font-bold py-10">此文章已超過 ${FORUM_RETENTION_DAYS} 天保留期限並自動刪除。</div>`;
                    return;
                }
                viewingPostData = { ...res, id: res.id || pid };
                let listNeedSync = false;
                const idxPost = forumPosts.find(p => String(p.id) === String(pid));
                if (viewingPostData.likes && typeof viewingPostData.likes === 'object') {
                    const actualLikesCount = Object.keys(viewingPostData.likes).filter(k => Boolean(viewingPostData.likes[k])).length;
                    viewingPostData.pushCount = actualLikesCount;
                    if (idxPost && Number(idxPost.pushCount || 0) !== actualLikesCount) {
                        idxPost.pushCount = actualLikesCount;
                        listNeedSync = true;
                    }
                }
                const actualRepliesCount = countForumPostReplies(viewingPostData);
                viewingPostData.replyCount = actualRepliesCount;
                if (idxPost && (Number(idxPost.replyCount || 0) !== actualRepliesCount || JSON.stringify(idxPost.replies || {}) !== JSON.stringify(viewingPostData.replies || {}))) {
                    idxPost.replyCount = actualRepliesCount;
                    if (viewingPostData.replies && typeof viewingPostData.replies === 'object') {
                        idxPost.replies = viewingPostData.replies;
                    }
                    listNeedSync = true;
                }
                if (listNeedSync) {
                    renderForumList();
                }
                renderForumPostDetail();
            } else {
                document.getElementById('forumPostHeader').innerHTML = '<div class="text-center text-rose-500 font-bold py-10">此文章不存在或已被刪除。</div>';
            }
        }
    } catch (e) {}
}

function renderForumPostDetail() {
    if (!viewingPostData) return;
    const p = viewingPostData;
    const headerEl = document.getElementById('forumPostHeader');
    const repliesEl = document.getElementById('forumRepliesList');
    
    const ts = new Date(Number(p.createdAt || 0));
    const dateStr = ts.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    
    const colors = {
        '公告': 'text-rose-600 border-rose-300',
        '感情': 'text-pink-500 border-pink-300',
        '心情': 'text-purple-500 border-purple-300',
        '女孩': 'text-rose-400 border-rose-300',
        '男孩': 'text-blue-500 border-blue-300',
        '討論': 'text-amber-500 border-amber-300',
        '閒聊': 'text-emerald-500 border-emerald-300',
        '寵物': 'text-orange-500 border-orange-300'
    };
    const displayTag = isBackendForumPost(p) ? '公告' : (p.tag || '討論');
    const colorClass = colors[displayTag] || 'text-gray-500 border-gray-300';
    const tagBadge = `<span class="${colorClass}">📌${displayTag}</span>`;

    const editedTag = (!isBackendForumPost(p) && p.isEdited)
        ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-500 font-semibold ml-2 align-middle">已編輯</span>`
        : '';
    const formattedContent = yuelaoEscapeHtml(p.content || '').replace(/\n/g, '<br>');
    
    let limitBadge = '';
    if (p.whoCanReply === 'MALE') limitBadge = `<span class="px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 text-[10px] ml-1">限男生留言</span>`;
    else if (p.whoCanReply === 'FEMALE') limitBadge = `<span class="px-2 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-200 text-[10px] ml-1">限女生留言</span>`;

    let authorDisplay = p.authorName || `匿名.${p.authorGender || '?'}`;
    
    const isGuest = !(typeof appState !== 'undefined' && appState && appState.playerId);
    syncForumReplyBarGuestState(isGuest);

    const likesMap = (viewingPostData.likes && typeof viewingPostData.likes === 'object') ? viewingPostData.likes : {};
    const hasLiked = Boolean(!isGuest && likesMap[appState.playerId]);
    const totalLikesCount = Object.keys(likesMap).filter(k => Boolean(likesMap[k])).length || Number(p.pushCount || 0);
    
    const postAuthorId = !isBackendForumPost(p) ? String(p.authorId || '').trim() : '';
    const isMyOwnPost = Boolean(postAuthorId && !isGuest && postAuthorId === String(appState.playerId).trim());
    const replyAnonCb = document.getElementById('forumReplyAnonCheckbox');
    if (replyAnonCb && replyAnonCb.parentElement) {
        replyAnonCb.parentElement.classList.toggle('hidden', isMyOwnPost);
    }

    let ownerActionBtnsHtml = '';
    if (isMyOwnPost) {
        ownerActionBtnsHtml = `
            <button type="button" onclick="editMyForumPost('${yuelaoEscapeHtml(p.id)}')" class="px-2.5 py-1 rounded-xl bg-sky-50 border border-sky-200 text-sky-600 hover:bg-sky-100 text-[11px] font-bold shadow-2xs transition shrink-0 whitespace-nowrap ml-2">✏️ 編輯文章</button>
            <button type="button" onclick="deleteMyForumPost('${yuelaoEscapeHtml(p.id)}')" class="px-2.5 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 text-[11px] font-bold shadow-2xs transition shrink-0 whitespace-nowrap ml-1.5">🗑️ 刪除文章</button>
        `;
    }

    const likeBtnHtml = isGuest
        ? `<div class="flex items-center gap-2">
               <button type="button" disabled aria-disabled="true" title="訪客無法按愛心，請先建立個人資料" class="inline-flex items-center justify-center w-9 h-9 rounded-full border bg-gray-100 border-gray-200 text-gray-300 text-sm font-bold opacity-60 cursor-not-allowed">🤍</button>
               <span class="text-xs text-gray-400 font-medium">${totalLikesCount} 個愛心・訪客無法按愛心與留言</span>
           </div>`
        : `<div class="flex items-center gap-2">
               <button type="button" onclick="likeForumPost()" aria-pressed="${hasLiked ? 'true' : 'false'}" title="${hasLiked ? '已按愛心（點擊可取消）' : '按愛心支持'}" class="inline-flex items-center justify-center w-9 h-9 rounded-full border ${hasLiked ? 'bg-rose-100 border-rose-300 text-rose-600 shadow-2xs scale-105' : 'bg-gray-100 border-gray-200 text-gray-400 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-500'} text-sm font-bold transition active:scale-95">${hasLiked ? '❤️' : '🤍'}</button>
               <span class="text-xs text-gray-400 font-medium">${totalLikesCount}</span>
           </div>`;

    headerEl.innerHTML = `
        <div class="flex items-center gap-2 mb-3">
            <div class="px-2 py-0.5 rounded border text-[11px] font-bold">${tagBadge}</div>
            <div class="text-gray-400 text-xs font-medium">${dateStr}</div>
            <div class="ml-auto text-xs font-bold text-gray-500 flex items-center flex-wrap justify-end">
                ${authorDisplay} ${limitBadge} ${ownerActionBtnsHtml}
            </div>
        </div>
        <h2 class="text-lg sm:text-xl font-bold font-serif-jp text-[#5e464a] leading-snug break-words">${yuelaoEscapeHtml(p.title)}${editedTag}</h2>
        <div class="text-gray-700 text-sm leading-relaxed break-words pt-2 whitespace-pre-wrap">${formattedContent}</div>
        <div class="flex items-center mt-4 pt-3 border-t border-pink-50">
            ${likeBtnHtml}
        </div>
    `;

    const repliesRaw = p.replies || {};
    const repliesArr = Array.isArray(repliesRaw)
        ? repliesRaw.filter(r => r && typeof r === 'object')
        : (typeof repliesRaw === 'object'
            ? Object.entries(repliesRaw)
                .filter(([, r]) => r && typeof r === 'object')
                .map(([k, r]) => ({ ...r, id: r.id || k }))
            : []);
    repliesArr.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

    if (repliesArr.length === 0) {
        repliesEl.innerHTML = `<div class="p-4 text-center text-gray-400 text-xs font-medium">還沒有人推文，搶頭香吧！</div>`;
    } else {
        repliesEl.innerHTML = repliesArr.map(r => {
            const rTs = new Date(Number(r.ts || 0));
            const rTimeStr = rTs.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            const rType = r.type === '推' ? `<span class="text-emerald-600 font-bold w-4">推</span>` : `<span class="text-gray-500 font-bold w-4">→</span>`;
            const isMe = appState.playerId && String(r.authorId || '') === String(appState.playerId);
            const isOp = Boolean(postAuthorId && String(r.authorId || '').trim() === postAuthorId);
            const replyAuthorName = isOp ? '原Po' : resolveForumReplyAuthorName(r, p);
            const authorTag = isOp
                ? `<span class="px-1.5 py-0.5 rounded bg-rose-100 text-[#8f4452] font-bold">原Po</span>`
                : (isMe
                    ? `<span class="text-[#8f4452] font-bold">${yuelaoEscapeHtml(replyAuthorName)}</span>`
                    : `<span class="text-gray-600 font-semibold">${yuelaoEscapeHtml(replyAuthorName)}</span>`);
            let editReplyHtml = '';
            const editedReplyTag = r.isEdited ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-500 font-semibold ml-1.5">已編輯</span>` : '';
            if (isMe && r.id) {
                editReplyHtml = `<button type="button" onclick="editMyForumReply('${yuelaoEscapeHtml(p.id)}', '${yuelaoEscapeHtml(r.id)}')" class="px-2 py-0.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 hover:bg-sky-100 text-[10px] font-bold shrink-0 transition whitespace-nowrap">✏️ 編輯</button>`;
            }

            return `
                <div class="flex gap-2 text-xs py-1.5 border-b border-pink-200 hover:bg-white transition px-2 rounded">
                    <div class="shrink-0 pt-0.5">${rType}</div>
                    <div class="shrink-0 pt-0.5 min-w-[4rem] max-w-[7rem] truncate" title="${yuelaoEscapeHtml(replyAuthorName)}">${authorTag}</div>
                    <div class="flex-1 min-w-0 text-gray-800 break-words leading-relaxed">${yuelaoEscapeHtml(r.content)}${editedReplyTag}</div>
                    <div class="shrink-0 text-gray-400 text-[10px] pt-0.5 flex items-center gap-1.5 whitespace-nowrap">${editReplyHtml}<span>${rTimeStr}</span></div>
                </div>
            `;
        }).join('');
    }
}

async function submitForumReply() {
    if (!currentViewingPostId || !viewingPostData) return;
    if (!appState.playerId) {
        showMiniNotice('⚠️ 尚未登入', '留言前請先完成個人資料登錄並保存。');
        return;
    }
    if (appState.isWarnedAccount) {
        showMiniNotice('🚫 警告帳號', '您的帳號處於警告狀態，無法留言推文。');
        return;
    }
    
    // Validate whoCanReply
    const myGender = appState.profile.gender;
    const rule = viewingPostData.whoCanReply || 'ALL';
    if (rule === 'MALE' && myGender !== '男') {
        showMiniNotice('🚫 權限不足', '發文者設定此篇僅限男生留言喔！');
        return;
    }
    if (rule === 'FEMALE' && myGender !== '女') {
        showMiniNotice('🚫 權限不足', '發文者設定此篇僅限女生留言喔！');
        return;
    }
    
    const contentEl = document.getElementById('forumReplyContent');
    const content = contentEl.value.trim();
    if (!content) return;
    
    if (typeof containsBannedWords === 'function' && containsBannedWords(content)) {
        showMiniNotice('🚫 違規字眼', '請勿包含禁止的字眼或外部聯絡方式！');
        return;
    }
    
    const type = '💬';
    const nowTs = Date.now();
    const replyId = 'r_' + nowTs + '_' + Math.random().toString(36).substr(2, 4);
    
    const postAuthorId = !isBackendForumPost(viewingPostData) ? String(viewingPostData.authorId || '').trim() : '';
    const isPostAuthor = Boolean(postAuthorId && String(appState.playerId || '').trim() === postAuthorId);
    const anonCheckboxEl = document.getElementById('forumReplyAnonCheckbox');
    const isAnon = isPostAuthor ? false : Boolean(anonCheckboxEl && anonCheckboxEl.checked);
    const genderLabel = String((appState.profile && appState.profile.gender) || '').trim() || '?';
    const rawNickname = String((appState.profile && appState.profile.nickname) || '').trim();
    const replyAuthorName = isPostAuthor
        ? '原Po'
        : (isAnon ? `匿名.${genderLabel}` : (rawNickname || `匿名.${genderLabel}`));
    const replyData = {
        id: replyId,
        authorId: appState.playerId,
        authorName: replyAuthorName,
        isAnonymous: isAnon,
        isOp: isPostAuthor,
        gender: genderLabel,
        type: type,
        content: content,
        ts: nowTs
    };

    contentEl.value = '';
    contentEl.style.height = '';

    // Optimistic UI update
    if (!viewingPostData.replies) viewingPostData.replies = {};
    viewingPostData.replies[replyId] = replyData;
    renderForumPostDetail();

    try {
        if (typeof CloudSync !== 'undefined') {
            await CloudSync.putNode(`${FORUM_POSTS_KEY}/${currentViewingPostId}/replies/${replyId}`, replyData);
            
            const curReplyCount = Number(viewingPostData.replyCount || 0) + 1;
            viewingPostData.replyCount = curReplyCount;
            
            await CloudSync.patchNode(`${FORUM_INDEX_KEY}/${currentViewingPostId}`, { 
                replyCount: curReplyCount,
                lastUpdatedAt: nowTs
            });
            // Update local index cache
            const idxPost = forumPosts.find(p => p.id === currentViewingPostId);
            if (idxPost) {
                idxPost.replyCount = curReplyCount;
                idxPost.lastUpdatedAt = nowTs;
                renderForumList();
            }
        }
    } catch (e) {
        showMiniNotice('❌ 留言失敗', '網路連線異常，請稍後再試。');
    }
}

function resolveForumReplyAuthorName(replyObj, postObj = null) {
    if (!replyObj || typeof replyObj !== 'object') return '匿名';
    const targetPost = postObj || viewingPostData;
    const postAuthorId = (targetPost && !isBackendForumPost(targetPost)) ? String(targetPost.authorId || '').trim() : '';
    if (replyObj.isOp === true || (postAuthorId && String(replyObj.authorId || '').trim() === postAuthorId)) {
        return '原Po';
    }
    const storedName = String(replyObj.authorName || '').trim();
    const genderLabel = String(replyObj.gender || '').trim() || '?';
    if (replyObj.isAnonymous === true || storedName.startsWith('匿名')) {
        return storedName || `匿名.${genderLabel}`;
    }
    const aid = String(replyObj.authorId || '').trim();
    if (aid) {
        const usersArr = (typeof Store !== 'undefined' && typeof Store.getUsersArray === 'function')
            ? Store.getUsersArray()
            : [];
        const foundUser = usersArr.find(u => u && String(u.id || '').trim() === aid);
        if (foundUser && String(foundUser.nickname || '').trim()) {
            return String(foundUser.nickname).trim();
        }
        if (typeof CloudSync !== 'undefined' && CloudSync.tree && CloudSync.tree[USER_INDEX_KEY] && CloudSync.tree[USER_INDEX_KEY][aid]) {
            const idxNick = String(CloudSync.tree[USER_INDEX_KEY][aid].nickname || '').trim();
            if (idxNick) return idxNick;
        }
    }
    if (storedName) return storedName;
    return `匿名.${genderLabel}`;
}

async function likeForumPost() {
    if (!currentViewingPostId || !viewingPostData) return;
    if (!appState.playerId) {
        showMiniNotice('⚠️ 尚未登入', '按愛心前請先完成個人資料登錄並保存。');
        return;
    }

    if (!viewingPostData.likes || typeof viewingPostData.likes !== 'object' || Array.isArray(viewingPostData.likes)) {
        const normalizedLikes = {};
        if (Array.isArray(viewingPostData.likes)) {
            viewingPostData.likes.forEach((val, idx) => {
                if (val) normalizedLikes[String(idx)] = true;
            });
        }
        viewingPostData.likes = normalizedLikes;
    }
    const hasLiked = Boolean(viewingPostData.likes[appState.playerId]);
    
    // Toggle
    if (hasLiked) {
        delete viewingPostData.likes[appState.playerId];
    } else {
        viewingPostData.likes[appState.playerId] = true;
    }
    
    // Recalculate pushes
    const newPushCount = Object.keys(viewingPostData.likes).filter(k => Boolean(viewingPostData.likes[k])).length;
    viewingPostData.pushCount = newPushCount;
    
    // Optimistic UI update (detail heart button + outer forum list count)
    const idxPost = forumPosts.find(p => String(p.id) === String(currentViewingPostId));
    if (idxPost) {
        idxPost.pushCount = newPushCount;
        renderForumList();
    }
    renderForumPostDetail();

    try {
        if (typeof CloudSync !== 'undefined') {
            if (hasLiked) {
                await CloudSync.deleteNode(`${FORUM_POSTS_KEY}/${currentViewingPostId}/likes/${appState.playerId}`);
            } else {
                await CloudSync.putNode(`${FORUM_POSTS_KEY}/${currentViewingPostId}/likes/${appState.playerId}`, true);
            }
            await CloudSync.patchNode(`${FORUM_INDEX_KEY}/${currentViewingPostId}`, { 
                pushCount: newPushCount
            });
        }
    } catch (e) {}
}

async function deleteMyForumPost(postId) {
    if (!confirm('確定要刪除這篇文章嗎？刪除後無法復原。')) return;
    
    try {
        if (typeof CloudSync !== 'undefined') {
            await Promise.all([
                CloudSync.deleteNode(`${FORUM_INDEX_KEY}/${postId}`),
                CloudSync.deleteNode(`${FORUM_POSTS_KEY}/${postId}`)
            ]);
        }
        
        forumPosts = forumPosts.filter(p => String(p.id) !== String(postId));
        saveForumIndexToLocalCache(forumPosts);
        
        if (typeof CloudSync !== 'undefined' && typeof CloudSync.recordPlayerOpLog === 'function') {
            const myName = String(appState.profile.nickname || appState.playerId);
            CloudSync.recordPlayerOpLog(appState.playerId, myName, '刪除討論區文章', `刪除文章 ID:${postId}`);
        }
        
        closeForumViewModal();
        renderForumList();
        showMiniNotice('🗑️ 刪除成功', '文章已成功刪除。');
    } catch (e) {
        showMiniNotice('❌ 刪除失敗', '網路異常，請稍後再試。');
    }
}

let editTargetType = ''; // 'post' or 'reply'
let editTargetPostId = '';
let editTargetReplyId = '';

function openEditContentModal(type, postId, replyId, oldContent, oldTitle = '') {
    editTargetType = type;
    editTargetPostId = postId;
    editTargetReplyId = replyId;

    const modal = document.getElementById('editContentModal');
    const titleWrap = document.getElementById('editContentTitleWrap');
    const titleInput = document.getElementById('editContentTitle');
    const contentInput = document.getElementById('editContentTextarea');

    if (type === 'post') {
        titleWrap.classList.remove('hidden');
        titleInput.value = oldTitle;
    } else {
        titleWrap.classList.add('hidden');
        titleInput.value = '';
    }
    
    contentInput.value = oldContent;
    modal.classList.remove('hidden');
    setTimeout(() => contentInput.focus(), 50);
}

function closeEditContentModal() {
    const modal = document.getElementById('editContentModal');
    if (modal) modal.classList.add('hidden');
    editTargetType = '';
    editTargetPostId = '';
    editTargetReplyId = '';
}

async function submitEditContent() {
    const titleInput = document.getElementById('editContentTitle');
    const contentInput = document.getElementById('editContentTextarea');
    
    const newContent = contentInput.value.trim();
    if (!newContent) {
        showMiniNotice('⚠️ 資料不齊', '內文不可留白喔！');
        return;
    }

    if (typeof containsBannedWords === 'function' && containsBannedWords(newContent)) {
        showMiniNotice('🚫 違規字眼', '請勿包含禁止的字眼或外部聯絡方式！');
        return;
    }

    const nowTs = Date.now();
    const myName = String(appState.profile.nickname || appState.playerId);

    if (editTargetType === 'post') {
        const newTitle = titleInput.value.trim();
        if (!newTitle) {
            showMiniNotice('⚠️ 資料不齊', '標題不可留白喔！');
            return;
        }
        if (typeof containsBannedWords === 'function' && containsBannedWords(newTitle)) {
            showMiniNotice('🚫 違規字眼', '請勿包含禁止的字眼或外部聯絡方式！');
            return;
        }

        const oldPost = forumPosts.find(p => String(p.id) === String(editTargetPostId));
        const oldTitleStr = viewingPostData ? String(viewingPostData.title || '') : (oldPost ? String(oldPost.title || '') : '');
        const oldContentStr = viewingPostData ? String(viewingPostData.content || '') : '';

        if (newTitle === oldTitleStr && newContent === oldContentStr) {
            closeEditContentModal();
            return;
        }

        const prevEditHistory = (viewingPostData && Array.isArray(viewingPostData.editHistory))
            ? viewingPostData.editHistory
            : [];
        const nextEditHistory = [
            ...prevEditHistory,
            {
                beforeTitle: oldTitleStr,
                beforeContent: oldContentStr,
                afterTitle: newTitle,
                afterContent: newContent,
                editedAt: nowTs
            }
        ];
        
        if (oldPost) {
            oldPost.title = newTitle;
            oldPost.isEdited = true;
        }
        if (viewingPostData) {
            viewingPostData.title = newTitle;
            viewingPostData.content = newContent;
            viewingPostData.isEdited = true;
            viewingPostData.editedAt = nowTs;
            viewingPostData.editHistory = nextEditHistory;
            renderForumPostDetail();
        }

        try {
            if (typeof CloudSync !== 'undefined') {
                await CloudSync.patchNode(`${FORUM_POSTS_KEY}/${editTargetPostId}`, {
                    title: newTitle,
                    content: newContent,
                    isEdited: true,
                    editedAt: nowTs,
                    editHistory: nextEditHistory
                });
                await CloudSync.patchNode(`${FORUM_INDEX_KEY}/${editTargetPostId}`, {
                    title: newTitle,
                    isEdited: true,
                    lastUpdatedAt: nowTs
                });
                if (typeof CloudSync.recordPlayerOpLog === 'function') {
                    CloudSync.recordPlayerOpLog(appState.playerId, myName, '編輯討論區文章', `文章 ID:${editTargetPostId}\n編輯前：[${oldTitleStr}] ${oldContentStr}\n編輯後：[${newTitle}] ${newContent}`);
                }
            }
            saveForumIndexToLocalCache(forumPosts);
            renderForumList();
            closeEditContentModal();
            showMiniNotice('✅ 編輯成功', '文章已成功更新。');
        } catch (e) {
            showMiniNotice('❌ 編輯失敗', '網路異常，請稍後再試。');
        }

    } else if (editTargetType === 'reply') {
        const replyObj = viewingPostData && viewingPostData.replies && viewingPostData.replies[editTargetReplyId];
        const oldContent = replyObj ? String(replyObj.content || '') : '';
        
        if (newContent === oldContent) {
            closeEditContentModal();
            return;
        }

        const prevReplyHistory = (replyObj && Array.isArray(replyObj.editHistory))
            ? replyObj.editHistory
            : [];
        const nextReplyHistory = [
            ...prevReplyHistory,
            {
                before: oldContent,
                after: newContent,
                editedAt: nowTs
            }
        ];
        
        if (viewingPostData && viewingPostData.replies && viewingPostData.replies[editTargetReplyId]) {
            viewingPostData.replies[editTargetReplyId].content = newContent;
            viewingPostData.replies[editTargetReplyId].isEdited = true;
            viewingPostData.replies[editTargetReplyId].editedAt = nowTs;
            viewingPostData.replies[editTargetReplyId].prevContent = oldContent;
            viewingPostData.replies[editTargetReplyId].editHistory = nextReplyHistory;
            renderForumPostDetail();
        }
        
        try {
            if (typeof CloudSync !== 'undefined') {
                await CloudSync.patchNode(`${FORUM_POSTS_KEY}/${editTargetPostId}/replies/${editTargetReplyId}`, {
                    content: newContent,
                    isEdited: true,
                    editedAt: nowTs,
                    prevContent: oldContent,
                    editHistory: nextReplyHistory
                });
                if (typeof CloudSync.recordPlayerOpLog === 'function') {
                    CloudSync.recordPlayerOpLog(appState.playerId, myName, '編輯討論區留言', `文章 ${editTargetPostId} 內的留言 ${editTargetReplyId}\n編輯前：${oldContent}\n編輯後：${newContent}`);
                }
            }
            closeEditContentModal();
            showMiniNotice('✅ 編輯成功', '留言已成功更新。');
        } catch (e) {
            showMiniNotice('❌ 編輯失敗', '網路異常，請稍後再試。');
        }
    }
}

async function editMyForumReply(postId, replyId) {
    const replyObj = viewingPostData && viewingPostData.replies && viewingPostData.replies[replyId];
    const oldContent = replyObj ? String(replyObj.content || '') : '';
    openEditContentModal('reply', postId, replyId, oldContent);
}

async function editMyForumPost(postId) {
    if (!viewingPostData) return;
    const oldTitle = viewingPostData.title || '';
    const oldContent = viewingPostData.content || '';
    openEditContentModal('post', postId, '', oldContent, oldTitle);
}

window.renderForumList = renderForumList;
window.goToForumPage = goToForumPage;
window.filterForum = filterForum;
window.refreshForum = refreshForum;
window.openForumPostModal = openForumPostModal;
window.closeForumPostModal = closeForumPostModal;
window.submitForumPost = submitForumPost;
window.viewForumPost = viewForumPost;
window.closeForumViewModal = closeForumViewModal;
window.refreshForumPost = refreshForumPost;
window.submitForumReply = submitForumReply;
window.likeForumPost = likeForumPost;
window.deleteMyForumPost = deleteMyForumPost;
window.openEditContentModal = openEditContentModal;
window.closeEditContentModal = closeEditContentModal;
window.submitEditContent = submitEditContent;
window.editMyForumReply = editMyForumReply;
window.editMyForumPost = editMyForumPost;

forumPosts = loadForumIndexFromLocalCache();
window.loadForumIndexFromLocalCache = loadForumIndexFromLocalCache;
