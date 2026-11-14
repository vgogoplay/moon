/* backend/layout.js - 後台共用左側選單（Sidebar）、登入驗證遮罩與頂部概覽列（無需伺服器，支援直接雙擊開啟） */

function ensureAdminCoreStyles() {
    if (document.getElementById('adminCoreFallbackStyles')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'adminCoreFallbackStyles';
    styleEl.textContent = `
        .card-jp { background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(14px); box-shadow: 0 10px 30px rgba(201, 106, 123, 0.1); }
        .admin-shell { display: flex; min-height: 100vh; }
        .admin-shell.hidden { display: none !important; }
        .admin-sidebar { width: 256px; flex-shrink: 0; background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(14px); border-right: 1px solid #f5dce2; box-shadow: 4px 0 24px rgba(201, 106, 123, 0.06); padding: 1.5rem 1rem; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; z-index: 30; }
        .admin-sidebar-nav { display: flex; flex-direction: column; gap: 0.45rem; }
        .sidebar-nav-link { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 0.95rem; border-radius: 0.9rem; font-size: 0.85rem; font-weight: 600; color: #7d5b61; background: #fff9fa; border: 1.5px solid #f2ced7; text-decoration: none; transition: all 0.2s ease; }
        .sidebar-nav-link:hover { background: #fff1f4; color: #8f4452; border-color: #f3d2da; }
        .sidebar-nav-link.active { background: linear-gradient(135deg, #e79aa8 0%, #c96a7b 100%); color: #ffffff; border-color: #c96a7b; box-shadow: 0 6px 18px rgba(201, 106, 123, 0.26); }
        .admin-content-area { flex: 1; min-width: 0; padding: 1.25rem 1.5rem 2.5rem; }
        @media (max-width: 900px) {
            .admin-shell { flex-direction: column; }
            .admin-sidebar { width: 100%; height: auto; position: static; border-right: none; border-bottom: 1px solid #f5dce2; padding: 1rem; }
            .admin-sidebar-nav { flex-direction: row; flex-wrap: wrap; }
            .admin-content-area { padding: 1rem; }
        }
        .admin-grid-table { width: 100%; border-collapse: collapse; border: 1.5px solid #eebcc9; background-color: #ffffff; }
        .admin-grid-table thead th { border: 1px solid #eab7c4; background-color: #fff0f4; color: #8f4452; font-weight: 700; white-space: nowrap; }
        .admin-grid-table tbody td { border: 1px solid #f3cfd8; vertical-align: middle; }
        .admin-grid-table tbody tr:hover td { background-color: #fff8fa; }
        .admin-field-box { background-color: #fff9fa; border: 1.5px solid #f1c4d0; border-radius: 0.95rem; padding: 0.72rem 0.85rem; }
        .admin-input-box { border: 1.5px solid #e5b0bd !important; background-color: #ffffff !important; border-radius: 0.75rem; }
        .sim-btn { display: flex; align-items: center; gap: 0.45rem; width: 100%; padding: 0.65rem 0.85rem; border: 1.5px solid #e5b0bd; border-radius: 0.85rem; background-color: #fff9fa; color: #6e3a43; font-size: 0.78rem; font-weight: 600; line-height: 1.4; text-align: left; box-shadow: 0 1px 3px rgba(201, 106, 123, 0.08); cursor: pointer; }
    `;
    document.head.appendChild(styleEl);
}

function getCurrentAdminPageKey() {
    const pageAttr = document.body ? document.body.dataset.adminPage : '';
    if (pageAttr) return pageAttr;
    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('backend-activities')) return 'activities';
    if (path.includes('backend-ops')) return 'ops';
    return 'member';
}

function renderAdminSharedShell() {
    ensureAdminCoreStyles();
    const currentPage = getCurrentAdminPageKey();
    const mountEl = document.getElementById('adminLayoutMount');
    if (!mountEl) return;

    const existingPageContent = mountEl.innerHTML;
    const navItems = [
        {
            key: 'member',
            href: 'backend.html',
            icon: '📋',
            label: '會員列表與系統設定',
            sub: '玩家資料・開關・秘密配對'
        },
        {
            key: 'activities',
            href: 'backend-activities.html',
            icon: '🎪',
            label: '活動管理與人數統計',
            sub: '第2種活動・報名與配對統計',
            badgeId: 'sidebarCustomActBadge'
        },
        {
            key: 'ops',
            href: 'backend-ops.html',
            icon: '✉️',
            label: '信件・回報與測試',
            sub: '問題回報・發信・禁止規則',
            badgeId: 'sidebarPendingReportsBadge'
        }
    ];

    const topHeaderAndOverviewHtml = currentPage === 'member' ? `
                    <!-- 頂部控制列 -->
                    <div class="card-jp rounded-2xl p-5 md:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-2 border-pink-300">
                        <div>
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-xs tracking-[0.2em] text-[#c96a7b] font-serif-jp">YUELAO ADMIN CENTER</span>
                                <span id="adminCurrentBatchBadge" class="text-xs px-2.5 py-0.5 rounded-full bg-rose-100 text-[#8f4452] font-bold">目前系統：第 1 屆</span>
                                <span id="cloudStatusBadge" class="text-xs px-2.5 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 font-semibold">
                                    ☁️ Firebase 雲端連線中...
                                </span>
                                <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
                                    ⏰ 每週三 / 週六 20:00 自動配對
                                </span>
                            </div>
                            <h1 class="text-xl md:text-2xl font-bold font-serif-jp text-[#8f4452] mt-1">⛩️ 月老牽線計畫・後台管理中心</h1>
                            <p id="adminCountdownText" class="text-xs text-[#c96a7b] font-semibold mt-1">距離下次 20:00 自動配對：計算中...</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2.5">
                            <button type="button" onclick="advanceToNextBatch()" class="px-3.5 py-2.5 rounded-xl bg-amber-50 border-2 border-amber-400 text-amber-900 text-xs font-bold hover:bg-amber-100 transition">
                                🔄 刷新至下一屆（釋放鎖定名單）
                            </button>
                            <button type="button" onclick="clearAllAdminData()" class="px-4 py-2.5 rounded-xl border-2 border-rose-500 bg-rose-50 text-rose-800 text-xs font-bold hover:bg-rose-100 transition shadow-sm">
                                🗑️ 清空全部資料
                            </button>
                        </div>
                    </div>

                    <!-- 數據概覽（加深框架顏色） -->
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div class="card-jp rounded-2xl p-4 border-2 border-[#c96a7b] bg-white shadow-sm">
                            <p class="text-xs font-bold text-[#8f4452]">資料庫總玩家數</p>
                            <p class="text-2xl font-bold text-[#8f4452] mt-1" id="statTotal">0 人</p>
                        </div>
                        <div class="card-jp rounded-2xl p-4 border-2 border-[#c96a7b] bg-white shadow-sm">
                            <p class="text-xs font-bold text-[#8f4452]">已報名場次人數</p>
                            <p class="text-2xl font-bold text-[#c96a7b] mt-1" id="statRegistered">0 人</p>
                        </div>
                        <div class="card-jp rounded-2xl p-4 border-2 border-emerald-500 bg-white shadow-sm">
                            <p class="text-xs font-bold text-emerald-800">已配對成功對數</p>
                            <p class="text-2xl font-bold text-emerald-600 mt-1" id="statMatched">0 對</p>
                        </div>
                        <div class="card-jp rounded-2xl p-4 border-2 border-amber-500 bg-white shadow-sm">
                            <p class="text-xs font-bold text-amber-800">玩家問題回報數</p>
                            <p class="text-2xl font-bold text-amber-600 mt-1" id="statReports">0 則</p>
                        </div>
                    </div>

                    <!-- ==================== 🔐 清空全部資料：管理員密碼驗證 ＋ 二次確定視窗 ==================== -->
                    <div id="clearAllConfirmModal" class="hidden fixed inset-0 bg-black/55 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div class="bg-white rounded-3xl max-w-md w-full p-6 md:p-7 shadow-2xl border-2 border-rose-400 space-y-4">
                            <div class="flex items-center justify-between border-b border-rose-100 pb-3">
                                <div class="flex items-center gap-2">
                                    <span class="text-2xl">⚠️</span>
                                    <div>
                                        <h3 class="text-base md:text-lg font-bold font-serif-jp text-rose-800">清空全部資料・安全驗證</h3>
                                        <p class="text-[11px] text-gray-500">高風險操作，需驗證管理員密碼並進行二次確定</p>
                                    </div>
                                </div>
                                <button type="button" onclick="closeClearAllConfirmModal()" class="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
                            </div>

                            <!-- 步驟 1：輸入管理員密碼 -->
                            <div id="clearAllStep1" class="space-y-3.5">
                                <div class="p-3 rounded-xl bg-rose-50/80 border border-rose-200 text-xs text-rose-800 leading-relaxed">
                                    <strong>第一關驗證：</strong>請輸入後台管理員密碼，驗證通過後將進入二次確定畫面。
                                </div>
                                <div class="admin-field-box !border-rose-300">
                                    <label class="block text-xs font-bold text-rose-800 mb-1.5">管理員密碼 <span class="text-rose-600">*</span></label>
                                    <input type="password" id="clearAllAdminPassInput" placeholder="請輸入管理員密碼" onkeydown="if(event.key==='Enter'){event.preventDefault();verifyClearAllPassword();}" class="w-full p-2.5 admin-input-box text-sm">
                                </div>
                                <div id="clearAllPassError" class="hidden p-2.5 rounded-xl bg-rose-100 border border-rose-400 text-xs text-rose-800 font-bold text-center">
                                    🚫 管理員密碼錯誤，無法執行清空全部資料！
                                </div>
                                <div class="flex justify-end gap-2 pt-1">
                                    <button type="button" onclick="closeClearAllConfirmModal()" class="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                                        取消
                                    </button>
                                    <button type="button" onclick="verifyClearAllPassword()" class="px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition shadow">
                                        下一步：進行二次確定 →
                                    </button>
                                </div>
                            </div>

                            <!-- 步驟 2：二次確定警告畫面 -->
                            <div id="clearAllStep2" class="hidden space-y-4">
                                <div class="p-4 rounded-2xl bg-rose-50 border-2 border-rose-500 space-y-2 text-xs text-rose-900">
                                    <p class="text-sm font-bold text-rose-700">🚨 二次確定：您確定要永久清空全部資料嗎？</p>
                                    <p class="leading-relaxed">
                                        按下確認後，系統將會<strong>同時清空本地與 Firebase 雲端</strong>的所有資料（包含：全部玩家檔案、配對歷史、聊天紀錄、秘密強制配對規則、管理員信件、問題回報與自定義活動），<strong>此動作無法復原！</strong>
                                    </p>
                                </div>
                                <div class="flex flex-wrap justify-end gap-2 pt-1">
                                    <button type="button" onclick="backToClearAllStep1()" class="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                                        ← 返回上一步
                                    </button>
                                    <button type="button" onclick="executeClearAllAdminDataConfirmed()" class="px-5 py-2.5 rounded-xl bg-rose-700 text-white text-xs font-bold hover:bg-rose-800 transition shadow-md">
                                        🗑️ 二次確定・立即清空全部資料
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
    ` : '';

    mountEl.innerHTML = `
        <!-- ==================== 🔐 後台管理員登入驗證視窗 ==================== -->
        <div id="adminLoginOverlay" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-[#fff4f6] via-[#ffe6ec] to-[#fdf2f5]">
            <div class="card-jp rounded-3xl w-full max-w-sm p-7 md:p-8 space-y-5 border-2 border-pink-200 shadow-2xl">
                <div class="text-center space-y-1.5">
                    <div class="w-14 h-14 mx-auto rounded-2xl bg-pink-50 border border-pink-200 flex items-center justify-center text-3xl shadow-inner">
                        ⛩️
                    </div>
                    <p class="text-[11px] tracking-[0.22em] text-[#c96a7b] font-serif-jp pt-1">YUELAO ADMIN ACCESS</p>
                    <h2 class="text-xl font-bold font-serif-jp text-[#8f4452]">月老牽線計畫・後台驗證</h2>
                    <p class="text-xs text-gray-500">請輸入管理員帳號與密碼以進入後台管理中心</p>
                </div>

                <form id="adminLoginForm" onsubmit="handleAdminLogin(event)" class="space-y-3.5">
                    <div class="admin-field-box">
                        <label class="block text-xs font-bold text-[#8f4452] mb-1.5">管理員帳號</label>
                        <input type="text" id="adminLoginAccount" autocomplete="username" placeholder="請輸入管理員帳號" class="w-full p-2.5 admin-input-box text-sm" required>
                    </div>
                    <div class="admin-field-box">
                        <label class="block text-xs font-bold text-[#8f4452] mb-1.5">管理員密碼</label>
                        <input type="password" id="adminLoginPassword" autocomplete="current-password" placeholder="請輸入管理員密碼" class="w-full p-2.5 admin-input-box text-sm" required>
                    </div>

                    <div id="adminLoginError" class="hidden p-3 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-700 font-bold text-center">
                        🚫 帳號或密碼錯誤，無法訪問後台管理中心！
                    </div>

                    <button type="submit" class="w-full py-3 rounded-xl bg-gradient-to-r from-[#e79aa8] to-[#c96a7b] text-white text-sm font-bold shadow-md hover:opacity-95 transition">
                        🔓 登入後台管理中心
                    </button>
                </form>
            </div>
        </div>

        <!-- ==================== ⛩️ 後台主工作區（左側選單 ＋ 右側獨立頁面） ==================== -->
        <div id="adminMainContent" class="hidden admin-shell">
            <!-- 左側固定導覽選單 -->
            <aside class="admin-sidebar">
                <div class="px-2 pb-4 mb-3 border-b border-pink-100">
                    <div class="flex items-center gap-2.5">
                        <span class="text-2xl">⛩️</span>
                        <div>
                            <h2 class="text-base font-bold font-serif-jp text-[#8f4452] leading-tight">月老神社後台</h2>
                            <p class="text-[10px] tracking-widest text-[#c96a7b]">YUELAO ADMIN</p>
                        </div>
                    </div>
                </div>

                <nav class="admin-sidebar-nav flex-1">
                    ${navItems.map(item => {
                        const isActive = currentPage === item.key;
                        const badgeHtml = item.badgeId
                            ? `<span id="${item.badgeId}" class="hidden text-[10px] px-2 py-0.5 rounded-full ${isActive ? 'bg-white/25 text-white' : 'bg-rose-500 text-white'} font-bold shrink-0">0</span>`
                            : '';
                        return `
                            <a href="${item.href}" class="sidebar-nav-link ${isActive ? 'active' : ''}">
                                <div class="flex items-center gap-2.5 min-w-0">
                                    <span class="text-base shrink-0">${item.icon}</span>
                                    <div class="min-w-0">
                                        <div class="truncate">${item.label}</div>
                                        <div class="text-[10px] font-normal ${isActive ? 'text-pink-100' : 'text-gray-400'} truncate">${item.sub}</div>
                                    </div>
                                </div>
                                ${badgeHtml}
                            </a>
                        `;
                    }).join('')}
                </nav>

                <div class="pt-4 mt-4 border-t border-pink-100 space-y-2">
                    <a href="index.html" target="_blank" class="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-pink-50 border border-pink-200 text-[#8f4452] text-xs font-semibold hover:bg-pink-100 transition">
                        <span>🌸</span>
                        <span>開啟前台首頁</span>
                    </a>
                    <button type="button" onclick="logoutAdmin()" class="w-full py-2 px-3 rounded-xl bg-rose-50 border border-rose-200 text-[#8f4452] text-xs font-semibold hover:bg-rose-100 transition">
                        🔒 登出管理後台
                    </button>
                </div>
            </aside>

            <!-- 右側頁面內容區 -->
            <div class="admin-content-area">
                <div class="max-w-7xl mx-auto space-y-6">
                    ${topHeaderAndOverviewHtml}

                    <!-- 當前頁面專屬內容 -->
                    ${existingPageContent}
                </div>
            </div>
        </div>
    `;
}

renderAdminSharedShell();

if (typeof isAdminAuthenticated === 'function' && isAdminAuthenticated()) {
    unlockAdminUI();
}
