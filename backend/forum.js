/* backend/forum.js - 後台討論區管理（發佈官方公告、公告名稱列表刪除、14天自動刪除、省流量分離讀取索引／內文、刪文、刪留言） */

const ADMIN_FORUM_INDEX_KEY = 'yuelao_forum_index';
const ADMIN_FORUM_POSTS_KEY = 'yuelao_forum_posts';
const ADMIN_FORUM_RETENTION_DAYS = 10;
const ADMIN_FORUM_RETENTION_MS = ADMIN_FORUM_RETENTION_DAYS * 24 * 60 * 60 * 1000;

let adminForumIndexList = [];
let adminForumTagFilter = 'ALL';
let adminForumSearchKeyword = '';
let adminForumCurrentPage = 1;
let adminForumPerPage = 5;

let selectedAdminForumPostId = '';
let selectedAdminForumPostDetail = null;
let adminForumInitialLoaded = false;

const ADMIN_FORUM_TAG_META = {
    '公告': { icon: '📌', badgeClass: 'bg-rose-100 text-rose-700 border-rose-300' },
    '感情': { icon: '🌸', badgeClass: 'bg-pink-50 text-pink-600 border-pink-200' },
    '心情': { icon: '💭', badgeClass: 'bg-purple-50 text-purple-600 border-purple-200' },
    '女孩': { icon: '🎀', badgeClass: 'bg-rose-50 text-rose-500 border-rose-200' },
    '男孩': { icon: '⚾', badgeClass: 'bg-blue-50 text-blue-600 border-blue-200' },
    '討論': { icon: '💬', badgeClass: 'bg-amber-50 text-amber-600 border-amber-200' },
    '閒聊': { icon: '☕', badgeClass: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    '寵物': { icon: '🐾', badgeClass: 'bg-orange-50 text-orange-600 border-orange-200' }
};

function escapeForumAdminHtml(str) {
    if (typeof yuelaoEscapeHtml === 'function') return yuelaoEscapeHtml(str);
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAdminForumTime(ts) {
    const num = Number(ts || 0);
    if (!num || Number.isNaN(num)) return '--/-- --:--';
    const d = new Date(num);
    if (Number.isNaN(d.getTime())) return '--/-- --:--';
    return d.toLocaleString('zh-TW', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getPostRetentionMs(post) {
    if (post && post.customRetentionDays) {
        return Number(post.customRetentionDays) * 24 * 60 * 60 * 1000;
    }
    return ADMIN_FORUM_RETENTION_MS;
}

function isAdminForumPostExpired(post, nowTs = Date.now()) {
    if (!post || typeof post !== 'object') return true;
    const createdTs = Number(post.createdAt || 0);
    if (!createdTs || Number.isNaN(createdTs)) return false;
    return (nowTs - createdTs) >= getPostRetentionMs(post);
}

function calcAdminForumRemainingDays(post, nowTs = Date.now()) {
    const createdTs = Number((post && post.createdAt) || 0);
    if (!createdTs || Number.isNaN(createdTs)) return ADMIN_FORUM_RETENTION_DAYS;
    const retentionMs = getPostRetentionMs(post);
    const remainMs = Math.max(0, (createdTs + retentionMs) - nowTs);
    return Math.max(1, Math.ceil(remainMs / (24 * 60 * 60 * 1000)));
}

function getSandboxForumStore(key) {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
}

function setSandboxForumStore(key, mapObj) {
    try {
        localStorage.setItem(key, JSON.stringify(mapObj || {}));
    } catch (e) {}
}

async function purgeExpiredAdminForumPosts(rawList) {
    const nowTs = Date.now();
    const valid = [];
    const expiredIds = [];

    (Array.isArray(rawList) ? rawList : []).forEach(p => {
        if (!p || !p.id) return;
        if (isAdminForumPostExpired(p, nowTs)) {
            expiredIds.push(String(p.id).trim());
        } else {
            valid.push(p);
        }
    });

    if (expiredIds.length > 0) {
        if (typeof CloudSync !== 'undefined' && CloudSync.isLocalSandboxMode()) {
            const idxMap = getSandboxForumStore(ADMIN_FORUM_INDEX_KEY);
            const postsMap = getSandboxForumStore(ADMIN_FORUM_POSTS_KEY);
            expiredIds.forEach(pid => {
                delete idxMap[pid];
                delete postsMap[pid];
            });
            setSandboxForumStore(ADMIN_FORUM_INDEX_KEY, idxMap);
            setSandboxForumStore(ADMIN_FORUM_POSTS_KEY, postsMap);
        } else if (typeof CloudSync !== 'undefined') {
            await Promise.all(
                expiredIds.flatMap(pid => [
                    CloudSync.deleteNode(`${ADMIN_FORUM_INDEX_KEY}/${pid}`),
                    CloudSync.deleteNode(`${ADMIN_FORUM_POSTS_KEY}/${pid}`)
                ])
            ).catch(() => {});
        }
        if (typeof appendLog === 'function') {
            appendLog(`<span class="text-amber-300">[討論區自動清理]</span> 已自動刪除 <strong>${expiredIds.length} 篇</strong>超過 ${ADMIN_FORUM_RETENTION_DAYS} 天的討論區文章。`);
        }
    }

    return valid;
}

async function fetchForumNodeAdmin(path) {
    if (typeof CloudSync !== 'undefined' && CloudSync.isLocalSandboxMode()) {
        const clean = String(path || '').replace(/^\/+|\/+$/g, '');
        const parts = clean.split('/');
        if (parts[0] === ADMIN_FORUM_INDEX_KEY) {
            const map = getSandboxForumStore(ADMIN_FORUM_INDEX_KEY);
            return parts[1] ? (map[parts[1]] || null) : map;
        }
        if (parts[0] === ADMIN_FORUM_POSTS_KEY) {
            const map = getSandboxForumStore(ADMIN_FORUM_POSTS_KEY);
            return parts[1] ? (map[parts[1]] || null) : map;
        }
        return null;
    }
    if (typeof CloudSync !== 'undefined' && typeof CloudSync.getNodeOnce === 'function') {
        return await CloudSync.getNodeOnce(path);
    }
    return null;
}

async function refreshAdminForumIndex(showFeedback = false) {
    const btn = document.getElementById('adminForumRefreshBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '讀取中...';
    }
    try {
        const res = await fetchForumNodeAdmin(ADMIN_FORUM_INDEX_KEY);
        if (res === undefined) {
            if (showFeedback) alert('⚠️ 讀取討論區索引失敗，請檢查網路或管理員登入狀態。');
            return;
        }
        const rawList = (typeof CloudSync !== 'undefined' && typeof CloudSync.mapToArray === 'function')
            ? CloudSync.mapToArray(res)
            : (res && typeof res === 'object' ? Object.values(res).filter(Boolean) : []);
        const validList = await purgeExpiredAdminForumPosts(rawList);
        validList.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        adminForumIndexList = validList;
        renderAdminForumList();

        if (selectedAdminForumPostId) {
            const stillExists = adminForumIndexList.some(p => String(p.id) === String(selectedAdminForumPostId));
            if (!stillExists) {
                selectedAdminForumPostId = '';
                selectedAdminForumPostDetail = null;
                renderAdminForumDetail();
            }
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '↻ 刷新列表';
        }
    }
}

function onAdminForumFilterChange() {
    const sel = document.getElementById('adminForumTagFilter');
    adminForumTagFilter = sel ? sel.value : 'ALL';
    adminForumCurrentPage = 1;
    renderAdminForumList();
}

function onAdminForumSearchInput(val) {
    adminForumSearchKeyword = String(val || '').trim();
    adminForumCurrentPage = 1;
    const clearBtn = document.getElementById('clearAdminForumSearchBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', adminForumSearchKeyword === '');
    }
    renderAdminForumList();
}

function clearAdminForumSearch() {
    adminForumSearchKeyword = '';
    adminForumCurrentPage = 1;
    const inputEl = document.getElementById('adminForumSearchInput');
    if (inputEl) inputEl.value = '';
    const clearBtn = document.getElementById('clearAdminForumSearchBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderAdminForumList();
}

function onAdminForumPerPageChange(val) {
    const parsed = parseInt(val, 10);
    adminForumPerPage = [10, 20, 50].includes(parsed) ? parsed : 10;
    adminForumCurrentPage = 1;
    renderAdminForumList();
}

function goToAdminForumPage(pageNum) {
    const p = parseInt(pageNum, 10);
    if (isNaN(p) || p < 1) return;
    adminForumCurrentPage = p;
    renderAdminForumList();
}

function renderAdminForumAnnouncementsList(nowTs = Date.now()) {
    const boxEl = document.getElementById('adminForumAnnouncementsList');
    const countBadge = document.getElementById('adminForumAnnouncementsCountBadge');
    if (!boxEl) return;

    const announcements = adminForumIndexList.filter(p => p && p.tag === '公告' && !isAdminForumPostExpired(p, nowTs));
    if (countBadge) {
        countBadge.textContent = `共 ${announcements.length} 則公告`;
    }

    if (announcements.length === 0) {
        boxEl.innerHTML = `<p class="text-xs text-gray-400">目前尚無官方公告（可於上方區塊發佈新公告）。</p>`;
        return;
    }

    boxEl.innerHTML = announcements.map(a => {
        const pid = String(a.id);
        const isSelected = pid === String(selectedAdminForumPostId);
        const remainDays = calcAdminForumRemainingDays(a, nowTs);
        const replies = Number(a.replyCount || 0);
        const likes = Number(a.pushCount || 0);

        return `
            <div onclick="selectAdminForumPost('${escapeForumAdminHtml(pid)}')" class="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border text-xs cursor-pointer transition ${isSelected ? 'bg-rose-100/85 border-[#c96a7b] shadow-2xs' : 'bg-white border-rose-200 hover:bg-rose-50/70'}">
                <div class="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                    <span class="px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-300 text-[10px] font-bold shrink-0">📌 公告</span>
                    <strong class="text-[#8f4452] truncate">${escapeForumAdminHtml(a.title || '(無標題公告)')}</strong>${a.isEdited ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-bold shrink-0">✏️ 已編輯</span>' : ''}
                    <span class="text-[11px] text-gray-500">（署名：${escapeForumAdminHtml(a.authorName || '月老管理')}）</span>
                    <span class="text-[10px] text-gray-400">• ${formatAdminForumTime(a.createdAt)}</span>
                    <span role="button" tabindex="0" onclick="event.stopPropagation(); openExtendRetentionModal('${escapeForumAdminHtml(pid)}')" title="點擊延長保留期限" class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 font-semibold hover:bg-amber-100 hover:border-amber-400 transition cursor-pointer">剩 ${remainDays} 天</span>
                    <span class="text-[10px] text-gray-400">❤️ ${likes} 💬 ${replies}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button type="button" onclick="event.stopPropagation(); deleteAdminForumPost('${escapeForumAdminHtml(pid)}')" class="px-2.5 py-1 rounded-lg bg-rose-600 text-white hover:bg-rose-700 text-[11px] font-bold shadow-2xs transition">
                        🗑️ 刪除
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminForumList() {
    const listEl = document.getElementById('adminForumPostList');
    const paginationEl = document.getElementById('adminForumPaginationBar');
    const statusBadge = document.getElementById('adminForumStatusBadge');
    const countTextEl = document.getElementById('adminForumFilteredCountText');
    if (!listEl) return;

    const nowTs = Date.now();
    const activePosts = adminForumIndexList.filter(p => p && p.id && !isAdminForumPostExpired(p, nowTs));
    if (activePosts.length !== adminForumIndexList.length) {
        purgeExpiredAdminForumPosts(adminForumIndexList);
        adminForumIndexList = activePosts;
    }

    renderAdminForumAnnouncementsList(nowTs);

    const announceCount = activePosts.filter(p => p && p.tag === '公告').length;
    if (statusBadge) {
        statusBadge.textContent = `文章索引 ${activePosts.length} 篇（公告 ${announceCount} 篇）`;
    }

    const kw = adminForumSearchKeyword.toLowerCase();
    const filtered = activePosts.filter(p => {
        if (!p || !p.id) return false;
        if (adminForumTagFilter !== 'ALL' && p.tag !== adminForumTagFilter) return false;
        if (!kw) return true;
        const hay = `${p.title || ''} ${p.authorName || ''} ${p.authorId || ''} ${p.id || ''} ${p.tag || ''}`.toLowerCase();
        return hay.includes(kw);
    });

    if (countTextEl) {
        countTextEl.textContent = `符合 ${filtered.length} 篇`;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / adminForumPerPage));
    if (adminForumCurrentPage > totalPages) adminForumCurrentPage = totalPages;
    if (adminForumCurrentPage < 1) adminForumCurrentPage = 1;

    const startIdx = (adminForumCurrentPage - 1) * adminForumPerPage;
    const pageItems = filtered.slice(startIdx, startIdx + adminForumPerPage);

    if (pageItems.length === 0) {
        listEl.innerHTML = `<div class="p-8 text-center text-xs text-gray-400">目前沒有符合條件的討論區文章</div>`;
    } else {
        listEl.innerHTML = pageItems.map(p => {
            const pid = String(p.id);
            const isSelected = pid === String(selectedAdminForumPostId);
            const meta = ADMIN_FORUM_TAG_META[p.tag] || { icon: '📌', badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' };
            const likes = Number(p.pushCount || 0);
            const replies = Number(p.replyCount || 0);
            const authorIdLabel = p.authorId ? `ID:${escapeForumAdminHtml(p.authorId)}` : 'ID:未知';
            const remainDays = calcAdminForumRemainingDays(p, nowTs);

            return `
                <div onclick="selectAdminForumPost('${escapeForumAdminHtml(pid)}')" class="p-3.5 cursor-pointer transition flex items-start justify-between gap-3 ${isSelected ? 'bg-rose-50/90 border-l-4 border-l-[#c96a7b]' : 'hover:bg-pink-50/40'}">
                    <div class="min-w-0 flex-1 space-y-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="px-2 py-0.5 rounded border text-[10px] font-bold ${meta.badgeClass}">
                                ${meta.icon} ${escapeForumAdminHtml(p.tag || '討論')}
                            </span>
                            <span class="text-xs font-bold text-[#5e464a] truncate">${escapeForumAdminHtml(p.title || '(無標題)')}</span>${p.isEdited ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-bold shrink-0">✏️ 已編輯</span>' : ''}
                        </div>
                        <div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                            <span class="font-semibold text-gray-700">${escapeForumAdminHtml(p.authorName || '匿名')}</span>
                            <span class="font-mono text-[10px] text-gray-400">(${authorIdLabel})</span>
                            <span>• ${formatAdminForumTime(p.createdAt)}</span>
                            <span role="button" tabindex="0" onclick="event.stopPropagation(); openExtendRetentionModal('${escapeForumAdminHtml(pid)}')" title="點擊延長保留期限" class="text-[10px] text-amber-700 font-semibold hover:text-amber-900 cursor-pointer transition">• 剩 ${remainDays} 天</span>
                            <span>• ❤️ ${likes} 💬 ${replies}</span>
                        </div>
                    </div>
                    <button type="button" onclick="event.stopPropagation(); deleteAdminForumPost('${escapeForumAdminHtml(pid)}')" class="px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] font-bold shrink-0 transition">
                        🗑️ 刪除
                    </button>
                </div>
            `;
        }).join('');
    }

    if (paginationEl) {
        if (filtered.length <= adminForumPerPage && totalPages <= 1) {
            paginationEl.innerHTML = `<span class="text-gray-500">共 ${filtered.length} 篇文章</span>`;
        } else {
            const showFrom = filtered.length === 0 ? 0 : startIdx + 1;
            const showTo = Math.min(startIdx + adminForumPerPage, filtered.length);
            paginationEl.innerHTML = `
                <span class="text-gray-500">顯示 ${showFrom}～${showTo} 篇（第 ${adminForumCurrentPage}/${totalPages} 頁）</span>
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="goToAdminForumPage(${adminForumCurrentPage - 1})" ${adminForumCurrentPage <= 1 ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-bold hover:bg-pink-50 disabled:opacity-40">
                        ◀ 上一頁
                    </button>
                    <button type="button" onclick="goToAdminForumPage(${adminForumCurrentPage + 1})" ${adminForumCurrentPage >= totalPages ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg bg-white border border-pink-200 text-[#8f4452] font-bold hover:bg-pink-50 disabled:opacity-40">
                        下一頁 ▶
                    </button>
                </div>
            `;
        }
    }
}

async function selectAdminForumPost(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return;
    selectedAdminForumPostId = pid;
    selectedAdminForumPostDetail = null;
    renderAdminForumList();

    const detailBody = document.getElementById('adminForumDetailBody');
    if (detailBody) {
        detailBody.innerHTML = `<div class="h-72 flex items-center justify-center text-xs text-gray-400">正在下載文章內文與留言明細...</div>`;
    }

    const fullPost = await fetchForumNodeAdmin(`${ADMIN_FORUM_POSTS_KEY}/${pid}`);
    if (selectedAdminForumPostId !== pid) return;

    if (!fullPost || typeof fullPost !== 'object') {
        selectedAdminForumPostDetail = null;
        renderAdminForumDetail(true);
        return;
    }

    if (isAdminForumPostExpired(fullPost, Date.now())) {
        await purgeExpiredAdminForumPosts([{ ...fullPost, id: pid }]);
        adminForumIndexList = adminForumIndexList.filter(p => String(p.id) !== pid);
        selectedAdminForumPostId = '';
        selectedAdminForumPostDetail = null;
        renderAdminForumList();
        renderAdminForumDetail(false, true);
        return;
    }

    selectedAdminForumPostDetail = { ...fullPost, id: pid };
    renderAdminForumDetail(false, false);
}

function renderAdminForumDetail(notFound = false, expiredDeleted = false) {
    const headerEl = document.getElementById('adminForumDetailHeader');
    const bodyEl = document.getElementById('adminForumDetailBody');
    if (!headerEl || !bodyEl) return;

    if (expiredDeleted) {
        headerEl.innerHTML = `
            <div>
                <h3 class="text-sm font-bold text-amber-700">⏳ 此文章已超過 14 天保留期限</h3>
                <p class="text-[11px] text-gray-500">系統已自動將此文章從前後台資料庫刪除</p>
            </div>
        `;
        bodyEl.innerHTML = `<div class="p-8 text-center text-xs text-amber-700 font-bold">此討論區文章已超過 ${ADMIN_FORUM_RETENTION_DAYS} 天保留期限並自動刪除。</div>`;
        return;
    }

    if (!selectedAdminForumPostId) {
        headerEl.innerHTML = `
            <div>
                <h3 class="text-sm font-bold text-[#8f4452]">文章內文與推文檢視視窗</h3>
                <p class="text-[11px] text-gray-400">點選左側任一篇文章或上方公告名稱，即可檢視完整內容、刪除文章或刪除違規留言</p>
            </div>
        `;
        bodyEl.innerHTML = `
            <div class="h-80 flex flex-col items-center justify-center text-center text-xs text-gray-400 space-y-2">
                <span class="text-3xl">📋</span>
                <p>請從左側或上方公告列表點選任一篇文章進行內容查核與留言管理</p>
            </div>
        `;
        return;
    }

    if (notFound || !selectedAdminForumPostDetail) {
        headerEl.innerHTML = `
            <div class="flex items-center justify-between w-full gap-2">
                <h3 class="text-sm font-bold text-rose-600">⚠️ 找不到完整文章節點</h3>
                <button type="button" onclick="deleteAdminForumPost('${escapeForumAdminHtml(selectedAdminForumPostId)}')" class="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                    🗑️ 清除殘留索引
                </button>
            </div>
        `;
        bodyEl.innerHTML = `<div class="p-8 text-center text-xs text-rose-500 font-bold">此文章內文節點不存在或已被刪除，可點擊右上角清除索引。</div>`;
        return;
    }

    const p = selectedAdminForumPostDetail;
    const pid = String(p.id);
    const meta = ADMIN_FORUM_TAG_META[p.tag] || { icon: '📌', badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' };
    const limitLabel = p.whoCanReply === 'MALE' ? '⚾ 僅限男生留言' : (p.whoCanReply === 'FEMALE' ? '🎀 僅限女生留言' : '🌍 全部人可留言');
    const formattedContent = escapeForumAdminHtml(p.content || '').replace(/\n/g, '<br>');
    const remainDays = calcAdminForumRemainingDays(p, Date.now());

    const postEditHistoryArr = Array.isArray(p.editHistory)
        ? p.editHistory.filter(item => item && typeof item === 'object')
        : (p.editHistory && typeof p.editHistory === 'object' ? Object.values(p.editHistory).filter(Boolean) : []);
    const isPostEdited = Boolean(p.isEdited || postEditHistoryArr.length > 0);
    const postEditedBadgeHtml = isPostEdited
        ? `<button type="button" onclick="toggleAdminForumPostEditHistory()" class="px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-800 hover:bg-amber-200 text-[10px] font-bold transition cursor-pointer">✏️ 已編輯（點擊查看編輯前／後）</button>`
        : '';

    const postEditHistoryBoxHtml = isPostEdited ? `
        <div id="adminForumPostEditHistoryBox" class="hidden p-3 rounded-xl bg-amber-50/85 border border-amber-300 space-y-2 text-xs">
            <div class="font-bold text-amber-900 flex items-center justify-between">
                <span>📜 文章編輯紀錄明細</span>
                ${p.editedAt ? `<span class="text-[10px] text-amber-700 font-normal">最後編輯：${formatAdminForumTime(p.editedAt)}</span>` : ''}
            </div>
            ${postEditHistoryArr.length > 0 ? postEditHistoryArr.map((rec, i) => `
                <div class="p-2.5 rounded-lg bg-white border border-amber-200 space-y-1.5">
                    <div class="text-[10px] text-gray-400 font-mono">第 ${i + 1} 次編輯 • ${formatAdminForumTime(rec.editedAt)}</div>
                    <div class="text-[11px] text-rose-700 bg-rose-50/70 p-2 rounded border border-rose-100">
                        <span class="font-bold">編輯前：</span>[${escapeForumAdminHtml(rec.beforeTitle || '')}] ${escapeForumAdminHtml(rec.beforeContent || '')}
                    </div>
                    <div class="text-[11px] text-emerald-700 bg-emerald-50/70 p-2 rounded border border-emerald-100">
                        <span class="font-bold">編輯後：</span>[${escapeForumAdminHtml(rec.afterTitle || '')}] ${escapeForumAdminHtml(rec.afterContent || '')}
                    </div>
                </div>
            `).join('') : `<div class="text-[11px] text-amber-800">此文章已標記為已編輯（請至「操作與防護日誌」查看完整字串紀錄）。</div>`}
        </div>
    ` : '';

    const repliesRaw = p.replies || {};
    const repliesArr = Array.isArray(repliesRaw)
        ? repliesRaw.filter(r => r && typeof r === 'object')
        : (typeof repliesRaw === 'object'
            ? Object.entries(repliesRaw)
                .filter(([, r]) => r && typeof r === 'object')
                .map(([k, r]) => ({ ...r, id: r.id || k }))
            : []);
    repliesArr.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

    headerEl.innerHTML = `
        <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
                <span class="px-2 py-0.5 rounded border text-[10px] font-bold ${meta.badgeClass}">${meta.icon} ${escapeForumAdminHtml(p.tag || '討論')}</span>
                <span role="button" tabindex="0" onclick="openExtendRetentionModal('${escapeForumAdminHtml(pid)}')" title="點擊延長保留期限" class="text-[10px] px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-800 font-bold hover:bg-amber-200 transition cursor-pointer shadow-2xs">保留期限：剩 ${remainDays} 天</span>
                ${postEditedBadgeHtml}
                <span class="text-[11px] font-mono text-gray-500">${escapeForumAdminHtml(pid)}</span>
            </div>
            <h3 class="text-sm font-bold text-[#8f4452] mt-1 truncate">${escapeForumAdminHtml(p.title || '(無標題)')}</h3>
        </div>
        <div class="flex items-center gap-2 shrink-0">
            <button type="button" onclick="selectAdminForumPost('${escapeForumAdminHtml(pid)}')" class="px-3 py-1.5 rounded-xl bg-white border border-pink-300 text-[#8f4452] text-xs font-semibold hover:bg-pink-50">
                ↻ 重讀內文
            </button>
            <button type="button" onclick="deleteAdminForumPost('${escapeForumAdminHtml(pid)}')" class="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold shadow hover:bg-rose-700">
                🗑️ 刪除此文章
            </button>
        </div>
    `;

    const repliesHtml = repliesArr.length === 0
        ? `<div class="p-6 text-center text-xs text-gray-400 bg-white rounded-xl border border-dashed border-pink-200">目前尚無任何留言推文</div>`
        : repliesArr.map((r, idx) => {
            const rid = String(r.id || '');
            const typeBadge = r.type === '推'
                ? `<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold text-[10px]">推</span>`
                : `<span class="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold text-[10px]">→</span>`;
            const authorInfo = `匿名(${escapeForumAdminHtml(r.gender || '?')}) ・ ID:${escapeForumAdminHtml(r.authorId || '未知')}`;

            const replyHistArr = Array.isArray(r.editHistory)
                ? r.editHistory.filter(item => item && typeof item === 'object')
                : (r.editHistory && typeof r.editHistory === 'object' ? Object.values(r.editHistory).filter(Boolean) : []);
            const hasReplyEdit = Boolean(r.isEdited || r.prevContent || replyHistArr.length > 0);
            const editedBtnHtml = (hasReplyEdit && rid)
                ? `<button type="button" onclick="toggleAdminForumReplyEditHistory('${escapeForumAdminHtml(rid)}')" class="px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-800 hover:bg-amber-200 text-[10px] font-bold transition cursor-pointer">✏️ 已編輯（點擊查看編輯前／後）</button>`
                : '';

            let replyHistoryBoxHtml = '';
            if (hasReplyEdit && rid) {
                const recordsToRender = replyHistArr.length > 0
                    ? replyHistArr
                    : [{ before: r.prevContent || '(無舊紀錄)', after: r.content || '', editedAt: r.editedAt || r.ts }];
                replyHistoryBoxHtml = `
                    <div id="adminForumReplyEditHistory_${escapeForumAdminHtml(rid)}" class="hidden mt-2 p-2.5 rounded-lg bg-amber-50/90 border border-amber-300 space-y-1.5 text-[11px]">
                        <div class="font-bold text-amber-900">📜 留言編輯前／後對照紀錄</div>
                        ${recordsToRender.map((rec, hIdx) => `
                            <div class="p-2 rounded bg-white border border-amber-200 space-y-1">
                                <div class="text-[10px] text-gray-400 font-mono">第 ${hIdx + 1} 次編輯 • ${formatAdminForumTime(rec.editedAt)}</div>
                                <div class="text-rose-700"><span class="font-bold">編輯前：</span>${escapeForumAdminHtml(rec.before || '')}</div>
                                <div class="text-emerald-700"><span class="font-bold">編輯後：</span>${escapeForumAdminHtml(rec.after || '')}</div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            return `
                <div class="p-3 rounded-xl bg-white border border-pink-100 flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1 space-y-1">
                        <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span class="font-mono text-gray-400">#${idx + 1}</span>
                            ${typeBadge}
                            <span class="font-bold text-gray-700">${authorInfo}</span>
                            <span class="text-gray-400">• ${formatAdminForumTime(r.ts)}</span>
                            ${editedBtnHtml}
                        </div>
                        <p class="text-xs text-gray-800 break-words leading-relaxed">${escapeForumAdminHtml(r.content || '')}</p>
                        ${replyHistoryBoxHtml}
                    </div>
                    ${rid ? `
                        <button type="button" onclick="deleteAdminForumReply('${escapeForumAdminHtml(pid)}', '${escapeForumAdminHtml(rid)}')" class="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 text-[11px] font-bold shrink-0 transition">
                            🗑️ 刪留言
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');

    bodyEl.innerHTML = `
        <div class="p-4 rounded-2xl bg-white border border-pink-200 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-pink-100 text-xs">
                <div>
                    <span class="font-bold text-[#8f4452]">發文者：${escapeForumAdminHtml(p.authorName || '匿名')}</span>
                    <span class="font-mono text-[11px] text-gray-500 ml-1">(ID:${escapeForumAdminHtml(p.authorId || '未知')} / ${escapeForumAdminHtml(p.authorGender || '?')})</span>
                </div>
                <div class="flex items-center gap-2 text-[11px] text-gray-500">
                    <span class="px-2 py-0.5 rounded bg-pink-50 border border-pink-200 text-[#8f4452] font-semibold">${limitLabel}</span>
                    <span>${formatAdminForumTime(p.createdAt)}</span>
                </div>
            </div>
            ${postEditHistoryBoxHtml}
            <div class="text-sm text-gray-800 leading-relaxed break-words whitespace-pre-wrap">${formattedContent}</div>
            <div class="pt-2 border-t border-pink-50 text-xs text-gray-500 flex items-center gap-3">
                <span>❤️ 愛心數：<strong>${Number(p.pushCount || 0)}</strong></span>
                <span>💬 實際留言數：<strong>${repliesArr.length}</strong></span>
            </div>
        </div>

        <div class="space-y-2">
            <div class="text-xs font-bold text-[#8f4452]">💬 留言推文管理（共 ${repliesArr.length} 則）</div>
            ${repliesHtml}
        </div>
    `;
}

async function submitAdminForumAnnouncement(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const authorEl = document.getElementById('adminForumAnnounceAuthor');
    const limitEl = document.getElementById('adminForumAnnounceReplyLimit');
    const titleEl = document.getElementById('adminForumAnnounceTitle');
    const contentEl = document.getElementById('adminForumAnnounceContent');
    const btn = document.getElementById('adminForumPublishBtn');

    const authorName = ((authorEl && authorEl.value.trim()) || '月老管理').substring(0, 4);
    const whoCanReply = (limitEl && limitEl.value) ? limitEl.value : 'ALL';
    const title = titleEl ? titleEl.value.trim() : '';
    const content = contentEl ? contentEl.value.trim() : '';

    if (!title || !content) {
        alert('請填寫公告標題與內文！');
        return;
    }

    const nowTs = Date.now();
    const postId = 'post_' + nowTs + '_admin_' + Math.random().toString(36).substr(2, 4);

    const postIndexData = {
        id: postId,
        title,
        tag: '公告',
        whoCanReply,
        authorName,
        authorGender: '管理員',
        authorId: 'ADMIN',
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

    if (btn) {
        btn.disabled = true;
        btn.textContent = '發佈中...';
    }

    try {
        if (typeof CloudSync !== 'undefined' && CloudSync.isLocalSandboxMode()) {
            const idxMap = getSandboxForumStore(ADMIN_FORUM_INDEX_KEY);
            const postsMap = getSandboxForumStore(ADMIN_FORUM_POSTS_KEY);
            idxMap[postId] = postIndexData;
            postsMap[postId] = postFullData;
            setSandboxForumStore(ADMIN_FORUM_INDEX_KEY, idxMap);
            setSandboxForumStore(ADMIN_FORUM_POSTS_KEY, postsMap);
        } else if (typeof CloudSync !== 'undefined') {
            await CloudSync.patchNode(`${ADMIN_FORUM_INDEX_KEY}/${postId}`, postIndexData, { throwOnError: true });
            await CloudSync.putNode(`${ADMIN_FORUM_POSTS_KEY}/${postId}`, postFullData, { throwOnError: true });
        }

        if (titleEl) titleEl.value = '';
        if (contentEl) contentEl.value = '';

        adminForumIndexList.unshift(postIndexData);
        renderAdminForumList();
        await selectAdminForumPost(postId);

        if (typeof appendLog === 'function') {
            appendLog(`<span class="text-pink-300">[討論區公告]</span> 已發佈官方公告「<strong>${escapeForumAdminHtml(title)}</strong>」`);
        }
        alert('📌 官方公告已成功發佈至前台討論區！');
    } catch (err) {
        console.error('[admin-forum] 發佈公告失敗', err);
        alert('❌ 發佈公告失敗，請檢查 Firebase 權限規則或網路連線後再試。');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📌 發佈公告';
        }
    }
}

async function deleteAdminForumPost(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return;
    const targetPost = adminForumIndexList.find(p => String(p.id) === pid);
    const titleLabel = targetPost ? `「${targetPost.title}」` : pid;
    if (!confirm(`確定要永久刪除討論區文章 ${titleLabel} 嗎？\n（包含該篇文章的所有內文與留言皆會一併刪除，無法復原）`)) {
        return;
    }

    try {
        if (typeof CloudSync !== 'undefined' && CloudSync.isLocalSandboxMode()) {
            const idxMap = getSandboxForumStore(ADMIN_FORUM_INDEX_KEY);
            const postsMap = getSandboxForumStore(ADMIN_FORUM_POSTS_KEY);
            delete idxMap[pid];
            delete postsMap[pid];
            setSandboxForumStore(ADMIN_FORUM_INDEX_KEY, idxMap);
            setSandboxForumStore(ADMIN_FORUM_POSTS_KEY, postsMap);
        } else if (typeof CloudSync !== 'undefined') {
            await Promise.all([
                CloudSync.deleteNode(`${ADMIN_FORUM_INDEX_KEY}/${pid}`),
                CloudSync.deleteNode(`${ADMIN_FORUM_POSTS_KEY}/${pid}`)
            ]);
        }

        adminForumIndexList = adminForumIndexList.filter(p => String(p.id) !== pid);
        if (selectedAdminForumPostId === pid) {
            selectedAdminForumPostId = '';
            selectedAdminForumPostDetail = null;
            renderAdminForumDetail();
        }
        renderAdminForumList();

        if (typeof appendLog === 'function') {
            appendLog(`<span class="text-rose-300">[討論區刪文]</span> 已刪除文章 ${escapeForumAdminHtml(titleLabel)}`);
        }
    } catch (err) {
        console.error('[admin-forum] 刪除文章失敗', err);
        alert('❌ 刪除文章失敗，請稍後再試。');
    }
}

async function deleteAdminForumReply(postId, replyId) {
    const pid = String(postId || '').trim();
    const rid = String(replyId || '').trim();
    if (!pid || !rid) return;
    if (!confirm('確定要刪除此則留言推文嗎？刪除後無法復原。')) {
        return;
    }

    try {
        if (typeof CloudSync !== 'undefined' && CloudSync.isLocalSandboxMode()) {
            const postsMap = getSandboxForumStore(ADMIN_FORUM_POSTS_KEY);
            if (postsMap[pid] && postsMap[pid].replies) {
                delete postsMap[pid].replies[rid];
                const nextCount = Object.keys(postsMap[pid].replies).length;
                postsMap[pid].replyCount = nextCount;
                setSandboxForumStore(ADMIN_FORUM_POSTS_KEY, postsMap);

                const idxMap = getSandboxForumStore(ADMIN_FORUM_INDEX_KEY);
                if (idxMap[pid]) {
                    idxMap[pid].replyCount = nextCount;
                    setSandboxForumStore(ADMIN_FORUM_INDEX_KEY, idxMap);
                }
            }
        } else if (typeof CloudSync !== 'undefined') {
            await CloudSync.deleteNode(`${ADMIN_FORUM_POSTS_KEY}/${pid}/replies/${rid}`);
        }

        if (selectedAdminForumPostDetail && String(selectedAdminForumPostDetail.id) === pid) {
            if (selectedAdminForumPostDetail.replies) {
                delete selectedAdminForumPostDetail.replies[rid];
            }
            const remainingCount = Object.keys(selectedAdminForumPostDetail.replies || {}).length;
            selectedAdminForumPostDetail.replyCount = remainingCount;

            if (typeof CloudSync !== 'undefined' && !CloudSync.isLocalSandboxMode()) {
                await Promise.all([
                    CloudSync.patchNode(`${ADMIN_FORUM_POSTS_KEY}/${pid}`, { replyCount: remainingCount }),
                    CloudSync.patchNode(`${ADMIN_FORUM_INDEX_KEY}/${pid}`, { replyCount: remainingCount })
                ]);
            }

            const idxPost = adminForumIndexList.find(p => String(p.id) === pid);
            if (idxPost) idxPost.replyCount = remainingCount;

            renderAdminForumDetail(false);
            renderAdminForumList();
        }

        if (typeof appendLog === 'function') {
            appendLog(`<span class="text-amber-300">[討論區刪留言]</span> 已刪除文章 ${escapeForumAdminHtml(pid)} 內的留言 ${escapeForumAdminHtml(rid)}`);
        }
    } catch (err) {
        console.error('[admin-forum] 刪除留言失敗', err);
        alert('❌ 刪除留言失敗，請稍後再試。');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const waitAndLoadForum = setInterval(() => {
        if (typeof isAdminAuthenticated === 'function' && !isAdminAuthenticated()) return;
        if (typeof CloudSync !== 'undefined' && CloudSync.initialized) {
            clearInterval(waitAndLoadForum);
            if (!adminForumInitialLoaded) {
                adminForumInitialLoaded = true;
                refreshAdminForumIndex(false);
            }
        }
    }, 200);
});

window.refreshAdminForumIndex = refreshAdminForumIndex;
window.onAdminForumFilterChange = onAdminForumFilterChange;
window.onAdminForumSearchInput = onAdminForumSearchInput;
window.clearAdminForumSearch = clearAdminForumSearch;
window.onAdminForumPerPageChange = onAdminForumPerPageChange;
window.goToAdminForumPage = goToAdminForumPage;
window.selectAdminForumPost = selectAdminForumPost;
window.submitAdminForumAnnouncement = submitAdminForumAnnouncement;
window.deleteAdminForumPost = deleteAdminForumPost;
window.deleteAdminForumReply = deleteAdminForumReply;


function toggleAdminForumPostEditHistory() {
    const box = document.getElementById('adminForumPostEditHistoryBox');
    if (box) box.classList.toggle('hidden');
}

function toggleAdminForumReplyEditHistory(replyId) {
    const box = document.getElementById(`adminForumReplyEditHistory_${replyId}`);
    if (box) box.classList.toggle('hidden');
}

window.toggleAdminForumPostEditHistory = toggleAdminForumPostEditHistory;
window.toggleAdminForumReplyEditHistory = toggleAdminForumReplyEditHistory;


function openExtendRetentionModal(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return;
    
    document.getElementById('extendRetentionPostId').value = pid;
    document.getElementById('extendRetentionModal').classList.remove('hidden');
}

function closeExtendRetentionModal() {
    document.getElementById('extendRetentionPostId').value = '';
    document.getElementById('extendRetentionModal').classList.add('hidden');
}

async function submitExtendRetention(e) {
    if (e) e.preventDefault();
    const pid = document.getElementById('extendRetentionPostId').value;
    const daysSel = document.getElementById('extendRetentionDaysSelect');
    
    if (!pid || !daysSel) return;
    const extendDays = Number(daysSel.value);
    
    const targetPost = adminForumIndexList.find(p => String(p.id) === pid);
    if (!targetPost) {
        closeExtendRetentionModal();
        return;
    }
    
    const nowTs = Date.now();
    // Update both createdAt to now and set custom retention days
    targetPost.createdAt = nowTs;
    targetPost.customRetentionDays = extendDays;
    
    if (selectedAdminForumPostDetail && String(selectedAdminForumPostDetail.id) === pid) {
        selectedAdminForumPostDetail.createdAt = nowTs;
        selectedAdminForumPostDetail.customRetentionDays = extendDays;
        renderAdminForumDetail(false, false);
    }

    try {
        if (typeof CloudSync !== 'undefined' && CloudSync.isLocalSandboxMode()) {
            const idxMap = getSandboxForumStore(ADMIN_FORUM_INDEX_KEY);
            const postsMap = getSandboxForumStore(ADMIN_FORUM_POSTS_KEY);
            if (idxMap[pid]) {
                idxMap[pid].createdAt = nowTs;
                idxMap[pid].customRetentionDays = extendDays;
            }
            if (postsMap[pid]) {
                postsMap[pid].createdAt = nowTs;
                postsMap[pid].customRetentionDays = extendDays;
            }
            setSandboxForumStore(ADMIN_FORUM_INDEX_KEY, idxMap);
            setSandboxForumStore(ADMIN_FORUM_POSTS_KEY, postsMap);
        } else if (typeof CloudSync !== 'undefined') {
            await Promise.all([
                CloudSync.patchNode(`${ADMIN_FORUM_INDEX_KEY}/${pid}`, { 
                    createdAt: nowTs, 
                    customRetentionDays: extendDays 
                }),
                CloudSync.patchNode(`${ADMIN_FORUM_POSTS_KEY}/${pid}`, { 
                    createdAt: nowTs, 
                    customRetentionDays: extendDays 
                })
            ]);
        }
        
        renderAdminForumList();
        closeExtendRetentionModal();
        
        if (typeof appendLog === 'function') {
            const dayStr = extendDays > 300 ? '永久' : `${extendDays} 天`;
            appendLog(`<span class="text-amber-300">[延長文章期限]</span> 已將文章 ${escapeForumAdminHtml(targetPost.title || pid)} 從今日起重新保留 ${dayStr}。`);
        }
        alert(`✅ 已將該文章從今天起算，重新保留 ${extendDays > 300 ? '999 (永久)' : extendDays} 天！`);
        
    } catch (err) {
        console.error('延長期限失敗', err);
        alert('❌ 延長失敗，請稍後再試。');
    }
}

window.openExtendRetentionModal = openExtendRetentionModal;
window.closeExtendRetentionModal = closeExtendRetentionModal;
window.submitExtendRetention = submitExtendRetention;
