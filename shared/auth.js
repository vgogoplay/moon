/* shared/auth.js - Firebase Auth 整合（C2-a）
 * 玩家端：匿名登入，會話存於 yuelao_auth_session_v1。
 * 管理員端：Email／密碼登入，會話存於 yuelao_admin_auth_session_v1（與玩家會話分開）。
 *   登入後檢查 yuelao_admin_uids/{uid} 白名單，通過才視為管理員。
 * 後台頁面（body[data-admin-page]）若有有效的管理員會話，資料庫請求改用管理員權杖。
 * 金鑰本身不是秘密；真正的存取控制由 Security Rules 負責。 */
const FIREBASE_WEB_API_KEY = 'AIzaSyDaxEsjb85uhiP2y2xsi4nn_Er9ziwQIiI';
const FIREBASE_AUTH_TOKEN_REFRESH_MS = 45 * 60 * 1000;

const yuelaoAuth = {
    STORAGE_KEY: 'yuelao_auth_session_v1',
    ADMIN_STORAGE_KEY: 'yuelao_admin_auth_session_v1',
    session: null,          // { uid, idToken, refreshToken, expiresAt }
    adminSession: null,     // { uid, email, idToken, refreshToken, expiresAt }
    refreshTimer: null,
    adminRefreshTimer: null,
    apiKey: FIREBASE_WEB_API_KEY,

    isLocalSandbox() {
        return typeof isLocalSandboxEnv === 'function' && isLocalSandboxEnv();
    },

    isEnabled() {
        if (this.isLocalSandbox()) return false;
        return Boolean(this.apiKey && String(this.apiKey).trim());
    },

    isBackendPage() {
        return typeof document !== 'undefined' && Boolean(document.body && document.body.dataset && document.body.dataset.adminPage);
    },

    dbUrl() {
        return (typeof FIREBASE_DB_URL !== 'undefined' ? String(FIREBASE_DB_URL) : '').replace(/\/+$/, '');
    },

    loadSession() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            this.session = raw ? JSON.parse(raw) : null;
        } catch (e) {
            this.session = null;
        }
        return this.session;
    },

    saveSession() {
        try {
            if (this.session) localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.session));
            else localStorage.removeItem(this.STORAGE_KEY);
        } catch (e) {}
    },

    loadAdminSession() {
        try {
            const raw = localStorage.getItem(this.ADMIN_STORAGE_KEY);
            this.adminSession = raw ? JSON.parse(raw) : null;
        } catch (e) {
            this.adminSession = null;
        }
        return this.adminSession;
    },

    saveAdminSession() {
        try {
            if (this.adminSession) localStorage.setItem(this.ADMIN_STORAGE_KEY, JSON.stringify(this.adminSession));
            else localStorage.removeItem(this.ADMIN_STORAGE_KEY);
        } catch (e) {}
    },

    clearAdminSession() {
        this.adminSession = null;
        try { localStorage.removeItem(this.ADMIN_STORAGE_KEY); } catch (e) {}
        if (this.adminRefreshTimer) {
            clearInterval(this.adminRefreshTimer);
            this.adminRefreshTimer = null;
        }
    },

    // 同步取得目前可用的 idToken（供資料庫請求附加）
    // 後台頁面且管理員會話有效 → 使用管理員權杖；否則使用匿名權杖。過期或不存在時回傳空字串。
    getIdTokenSync() {
        if (!this.isEnabled()) return '';
        if (this.isBackendPage() && this.adminSession && this.adminSession.idToken
            && Date.now() < Number(this.adminSession.expiresAt || 0) - 60000) {
            return this.adminSession.idToken;
        }
        if (!this.session || !this.session.idToken) return '';
        if (Date.now() >= Number(this.session.expiresAt || 0) - 60000) return '';
        return this.session.idToken;
    },

    async signInAnonymously() {
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(this.apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ returnSecureToken: true })
        });
        if (!res.ok) throw new Error('匿名登入失敗：' + res.status);
        const data = await res.json();
        this.session = {
            uid: data.localId,
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000
        };
        this.saveSession();
        return this.session;
    },

    async refreshSession() {
        if (!this.session || !this.session.refreshToken) return null;
        const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.session.refreshToken)}`
        });
        if (!res.ok) throw new Error('權杖更新失敗：' + res.status);
        const data = await res.json();
        this.session = {
            uid: data.user_id,
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
        };
        this.saveSession();
        return this.session;
    },

    mapAdminAuthError(code) {
        const c = String(code || '');
        if (c.includes('TOO_MANY_ATTEMPTS')) return '嘗試次數過多，請稍後再試';
        if (c.includes('USER_DISABLED')) return '此帳號已停用';
        if (c.includes('INVALID_EMAIL')) return 'Email 格式不正確';
        if (c.includes('EMAIL_NOT_FOUND') || c.includes('INVALID_PASSWORD')
            || c.includes('INVALID_LOGIN_CREDENTIALS') || c.includes('MISSING_PASSWORD')) {
            return '帳號或密碼錯誤，無法訪問後台管理中心！';
        }
        return '登入失敗，請稍後再試';
    },

    // 管理員登入：Email／密碼 → 白名單檢查 → 保存管理員會話
    async signInAdmin(email, password) {
        if (this.isLocalSandbox()) {
            const cleanEmail = String(email || '').trim();
            const cleanPwd = String(password || '');
            if (!cleanEmail || !cleanPwd) throw new Error('請輸入管理員 Email 與密碼');
            const session = {
                uid: 'LOCAL_SANDBOX_ADMIN',
                email: cleanEmail,
                idToken: '',
                refreshToken: '',
                expiresAt: Date.now() + 24 * 60 * 60 * 1000
            };
            this.adminSession = session;
            this.saveAdminSession();
            return session;
        }
        if (!this.isEnabled()) throw new Error('尚未設定 Firebase 金鑰');
        if (!this.dbUrl()) throw new Error('尚未設定資料庫網址');
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(this.apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: String(email || '').trim(), password: String(password || ''), returnSecureToken: true })
        });
        if (!res.ok) {
            let code = '';
            try {
                const j = await res.json();
                code = (j && j.error && j.error.message) || '';
            } catch (e) {}
            throw new Error(this.mapAdminAuthError(code));
        }
        const data = await res.json();
        const session = {
            uid: data.localId,
            email: data.email || '',
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000
        };
        const isAdmin = await this.checkAdminWhitelist(session.uid, session.idToken);
        if (!isAdmin) throw new Error('此帳號不是管理員，無法進入後台');
        this.adminSession = session;
        this.saveAdminSession();
        this.startAdminRefreshTimer();
        return session;
    },

    async checkAdminWhitelist(uid, idToken) {
        try {
            const url = `${this.dbUrl()}/yuelao_admin_uids/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(idToken)}`;
            const res = await fetch(url);
            if (!res.ok) return false;
            return (await res.json()) === true;
        } catch (e) {
            return false;
        }
    },

    async refreshAdminSession() {
        if (!this.adminSession || !this.adminSession.refreshToken) return null;
        const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.adminSession.refreshToken)}`
        });
        if (!res.ok) throw new Error('管理員權杖更新失敗：' + res.status);
        const data = await res.json();
        this.adminSession = {
            uid: data.user_id,
            email: this.adminSession.email || '',
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
        };
        this.saveAdminSession();
        return this.adminSession;
    },

    // 還原管理員會話：更新權杖；失敗則清除，需重新登入
    async restoreAdminSession() {
        this.loadAdminSession();
        if (!this.adminSession) return null;
        if (this.isLocalSandbox()) return this.adminSession;
        try {
            await this.refreshAdminSession();
        } catch (e) {
            console.warn('[auth] 管理員會話已失效，請重新登入', e);
            this.clearAdminSession();
            return null;
        }
        this.startAdminRefreshTimer();
        return this.adminSession;
    },

    // 初始化：玩家匿名會話（與原行為相同）；後台頁面另外還原管理員會話
    async init() {
        if (this.isLocalSandbox()) {
            this.session = {
                uid: 'LOCAL_SANDBOX_USER',
                idToken: '',
                refreshToken: '',
                expiresAt: Date.now() + 24 * 60 * 60 * 1000
            };
            if (this.isBackendPage()) {
                this.loadAdminSession();
            }
            return this.session;
        }
        if (!this.isEnabled()) return null;
        this.loadSession();
        const hasFreshToken = Boolean(
            this.session &&
            this.session.idToken &&
            Date.now() < Number(this.session.expiresAt || 0) - 10 * 60 * 1000
        );
        if (!hasFreshToken) {
            try {
                if (this.session && this.session.refreshToken) await this.refreshSession();
                else await this.signInAnonymously();
            } catch (e) {
                try { await this.signInAnonymously(); } catch (err) { console.warn('[auth] 匿名登入失敗', err); }
            }
        }
        this.startRefreshTimer();
        if (this.isBackendPage() && this.loadAdminSession()) {
            await this.restoreAdminSession();
        }
        return this.session;
    },

    startRefreshTimer() {
        if (this.refreshTimer || typeof setInterval === 'undefined') return;
        this.refreshTimer = setInterval(() => {
            this.refreshSession().catch(() => {});
        }, FIREBASE_AUTH_TOKEN_REFRESH_MS);
    },

    startAdminRefreshTimer() {
        if (this.adminRefreshTimer || typeof setInterval === 'undefined') return;
        this.adminRefreshTimer = setInterval(() => {
            this.refreshAdminSession().catch(() => {});
        }, FIREBASE_AUTH_TOKEN_REFRESH_MS);
    }
};
