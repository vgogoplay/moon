/* shared/auth.js - Firebase 匿名登入（階段 C 第一步）
 * 金鑰未填寫時此模組完全停用，不影響現有網站行為。
 * 取得方式：Firebase Console → 專案設定 → 一般 → 「網頁 API 金鑰」。
 * 此金鑰本身不是秘密（會出現在前端程式碼中），真正的存取控制由 Security Rules 負責。 */
const FIREBASE_WEB_API_KEY = 'AIzaSyDaxEsjb85uhiP2y2xsi4nn_Er9ziwQIiI';
const FIREBASE_AUTH_TOKEN_REFRESH_MS = 45 * 60 * 1000;

const yuelaoAuth = {
    STORAGE_KEY: 'yuelao_auth_session_v1',
    session: null,          // { uid, idToken, refreshToken, expiresAt }
    refreshTimer: null,
    apiKey: FIREBASE_WEB_API_KEY,

    isEnabled() {
        return Boolean(this.apiKey && String(this.apiKey).trim());
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

    // 同步取得目前可用的 idToken（供資料庫請求附加；過期或不存在時回傳空字串）
    getIdTokenSync() {
        if (!this.isEnabled() || !this.session || !this.session.idToken) return '';
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

    // 初始化：有舊會話就更新權杖，沒有就建立匿名帳號；失敗時不拋錯（退回未驗證狀態）
    async init() {
        if (!this.isEnabled()) return null;
        this.loadSession();
        try {
            if (this.session && this.session.refreshToken) await this.refreshSession();
            else await this.signInAnonymously();
        } catch (e) {
            try { await this.signInAnonymously(); } catch (err) { console.warn('[auth] 匿名登入失敗', err); }
        }
        this.startRefreshTimer();
        return this.session;
    },

    startRefreshTimer() {
        if (this.refreshTimer || typeof setInterval === 'undefined') return;
        this.refreshTimer = setInterval(() => {
            this.refreshSession().catch(() => {});
        }, FIREBASE_AUTH_TOKEN_REFRESH_MS);
    }
};
