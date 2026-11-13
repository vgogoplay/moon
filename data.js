/* data.js - SCHEMA_VERSION 14：男女生人數限制開關、性別限選男女、地區與縣市聯動 */

const SCHEMA_VERSION = 22;
// 🧪 測試階段開關：true = 全部欄位暫時免必填；正式上線時改為 false 即可恢復全部必填驗證
const TEST_MODE_OPTIONAL_FIELDS = false;

function isFieldRequired(field) {
    if (typeof TEST_MODE_OPTIONAL_FIELDS !== 'undefined' && TEST_MODE_OPTIONAL_FIELDS) return false;
    return Boolean(field && field.required);
}
const STORAGE_KEY = 'yuelao_romance_app_v2';
const USERS_KEY = 'yuelao_users';
const REPORTS_KEY = 'yuelao_reports';
const ID_COUNTER_KEY = 'yuelao_id_counters';
const SYSTEM_STATE_KEY = 'yuelao_system_batch';

// 每週期數自動計算器（基準：2026/11/09 週一為第 1 屆，每逢週一自動推進至下一屆）
function getMondayOfWeek(dateObj = new Date()) {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMonday);
    return d;
}

function formatMonthDay(dateObj) {
    return `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
}

function getBatchScheduleInfo(batchNum) {
    const b = Math.max(1, Number(batchNum || 1));
    const baseMonday = new Date(2026, 10, 9, 0, 0, 0, 0); // 2026/11/09 (一) -> 第1屆11/11(三)、第1屆11/14(六)
    const monday = new Date(baseMonday);
    monday.setDate(baseMonday.getDate() + (b - 1) * 7);

    const wed = new Date(monday);
    wed.setDate(monday.getDate() + 2);

    const sat = new Date(monday);
    sat.setDate(monday.getDate() + 5);

    const wedDateStr = formatMonthDay(wed);
    const satDateStr = formatMonthDay(sat);
    const wedLabel = `第${b}屆${wedDateStr}(三)`;
    const satLabel = `第${b}屆${satDateStr}(六)`;

    return {
        batch: b,
        batchPrefix: `第${b}屆`,
        monday,
        wed,
        sat,
        wedDateStr,
        satDateStr,
        wedLabel,
        satLabel,
        sessions: [wedLabel, satLabel]
    };
}


function normalizeSessionLabel(sessionStr) {
    const raw = String(sessionStr || '').trim();
    if (!raw) return '';
    const batchMatch = raw.match(/^第\s*(\d+)\s*屆/);
    if (!batchMatch) return raw;
    const b = Math.max(1, parseInt(batchMatch[1], 10));
    const info = getBatchScheduleInfo(b);
    if (/(三|星期三|週三)/.test(raw)) return info.wedLabel;
    if (/(六|星期六|週六)/.test(raw)) return info.satLabel;
    return info.batchPrefix;
}

function isSameSession(s1, s2) {
    const n1 = normalizeSessionLabel(s1);
    const n2 = normalizeSessionLabel(s2);
    return n1 !== '' && n1 === n2;
}

function calcAutoBatchNumber(now = new Date()) {
    const baseMonday = new Date(2026, 10, 9, 0, 0, 0, 0); // 2026/11/09 (一)
    const currentMonday = getMondayOfWeek(now);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const diffWeeks = Math.round((currentMonday.getTime() - baseMonday.getTime()) / weekMs);
    return Math.max(1, 1 + diffWeeks);
}

const BANNED_RULES_KEY = 'yuelao_banned_rules';
const MAILBOX_KEY = 'yuelao_mailbox';
const CHATS_KEY = 'yuelao_chats';
const TAB_PLAYER_ID_KEY = 'yuelao_tab_player_id';
const PLAYER_STATE_PREFIX = 'yuelao_player_state_';

const FIREBASE_DB_URL = 'https://moon-8b627-default-rtdb.asia-southeast1.firebasedatabase.app';

// ==================== ☁️ Firebase Realtime Database 跨裝置即時雲端同步中樞 ====================
const CloudSync = {
    dbUrl: FIREBASE_DB_URL.replace(/\/+$/, ''),
    tree: {},
    initialized: false,
    eventSource: null,
    pollTimer: null,
    onUpdateCallback: null,
    lastPushedUsersJson: {},

    mapToArray(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter(item => item && typeof item === 'object');
        if (typeof raw === 'object') return Object.values(raw).filter(item => item && typeof item === 'object');
        return [];
    },

    chatsMapToLocal(raw) {
        const result = {};
        if (!raw || typeof raw !== 'object') return result;
        Object.keys(raw).forEach(pairKey => {
            const threadRaw = raw[pairKey];
            const msgs = this.mapToArray(threadRaw);
            msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
            result[pairKey] = msgs;
        });
        return result;
    },

    applyTreeToLocalStorage() {
        const t = this.tree || {};

        // 1. 玩家名單
        const usersArr = this.mapToArray(t[USERS_KEY]);
        localStorage.setItem(USERS_KEY, JSON.stringify(usersArr));
        usersArr.forEach(u => {
            if (u && u.id) {
                this.lastPushedUsersJson[String(u.id)] = JSON.stringify(u);
            }
        });

        // 2. 聊天紀錄
        const chatsObj = this.chatsMapToLocal(t[CHATS_KEY]);
        localStorage.setItem(CHATS_KEY, JSON.stringify(chatsObj));

        // 3. 系統開關與期數設定
        if (t[SYSTEM_STATE_KEY] && typeof t[SYSTEM_STATE_KEY] === 'object') {
            localStorage.setItem(SYSTEM_STATE_KEY, JSON.stringify(t[SYSTEM_STATE_KEY]));
        } else {
            localStorage.removeItem(SYSTEM_STATE_KEY);
        }

        // 4. 管理員信箱（依時間新到舊排序）
        const mailsArr = this.mapToArray(t[MAILBOX_KEY]);
        mailsArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        localStorage.setItem(MAILBOX_KEY, JSON.stringify(mailsArr));

        // 5. 問題回報（依時間新到舊排序）
        const reportsArr = this.mapToArray(t[REPORTS_KEY]);
        reportsArr.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        localStorage.setItem(REPORTS_KEY, JSON.stringify(reportsArr));

        // 6. 禁止字眼規則
        if (t[BANNED_RULES_KEY] !== undefined) {
            localStorage.setItem(BANNED_RULES_KEY, JSON.stringify(this.mapToArray(t[BANNED_RULES_KEY])));
        }

        // 7. ID 計數器
        if (t[ID_COUNTER_KEY] && typeof t[ID_COUNTER_KEY] === 'object') {
            localStorage.setItem(ID_COUNTER_KEY, JSON.stringify(t[ID_COUNTER_KEY]));
        }
    },

    applyStreamPatch(path, data) {
        const cleanPath = String(path || '/').replace(/^\/+|\/+$/g, '');
        if (!cleanPath) {
            this.tree = (data && typeof data === 'object') ? data : {};
            return;
        }
        const parts = cleanPath.split('/');
        let curr = this.tree;
        for (let i = 0; i < parts.length - 1; i++) {
            const seg = parts[i];
            if (!curr[seg] || typeof curr[seg] !== 'object') {
                curr[seg] = {};
            }
            curr = curr[seg];
        }
        const lastKey = parts[parts.length - 1];
        if (data === null) {
            delete curr[lastKey];
        } else {
            curr[lastKey] = data;
        }
    },

    async fetchFullTree() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        try {
            const res = await fetch(`${this.dbUrl}/.json`, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) return false;
            const data = await res.json();
            this.tree = (data && typeof data === 'object') ? data : {};
            this.applyTreeToLocalStorage();
            return true;
        } catch (e) {
            clearTimeout(timer);
            return false;
        }
    },

    startRealtimeStream() {
        if (typeof EventSource === 'undefined') return;
        if (this.eventSource) {
            try { this.eventSource.close(); } catch (e) {}
        }
        try {
            const es = new EventSource(`${this.dbUrl}/.json`);
            const handleEvent = (e) => {
                try {
                    const payload = JSON.parse(e.data);
                    if (!payload) return;
                    if (e.type === 'patch' && payload.data && typeof payload.data === 'object') {
                        const base = String(payload.path || '/').replace(/^\/+|\/+$/g, '');
                        Object.keys(payload.data).forEach(k => {
                            const subPath = base ? `${base}/${k}` : k;
                            this.applyStreamPatch(subPath, payload.data[k]);
                        });
                    } else {
                        this.applyStreamPatch(payload.path, payload.data);
                    }
                    this.applyTreeToLocalStorage();
                    if (typeof this.onUpdateCallback === 'function') {
                        this.onUpdateCallback();
                    }
                } catch (err) {}
            };
            es.addEventListener('put', handleEvent);
            es.addEventListener('patch', handleEvent);
            es.onerror = () => {
                // 若串流暫時中斷，背景定時輪詢會自動接手並在恢復後重連
            };
            this.eventSource = es;
        } catch (e) {}
    },

    async init(onUpdate) {
        this.onUpdateCallback = onUpdate || null;
        await this.fetchFullTree();
        this.initialized = true;
        this.startRealtimeStream();

        if (!this.pollTimer) {
            this.pollTimer = setInterval(async () => {
                const ok = await this.fetchFullTree();
                if (ok && typeof this.onUpdateCallback === 'function') {
                    this.onUpdateCallback();
                }
            }, 3500);
        }

        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                const ok = await this.fetchFullTree();
                if (ok && typeof this.onUpdateCallback === 'function') {
                    this.onUpdateCallback();
                }
            }
        });
    },

    encodePath(path) {
        return String(path || '').split('/').filter(Boolean).map(seg => encodeURIComponent(seg)).join('/');
    },

    async putNode(path, value) {
        try {
            const encoded = this.encodePath(path);
            await fetch(`${this.dbUrl}/${encoded}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value)
            });
        } catch (e) {
            console.warn('CloudSync putNode 同步失敗', path, e);
        }
    },

    async patchNode(path, patchObj) {
        try {
            const encoded = this.encodePath(path);
            await fetch(`${this.dbUrl}/${encoded}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patchObj)
            });
        } catch (e) {
            console.warn('CloudSync patchNode 同步失敗', path, e);
        }
    },

    async deleteNode(path) {
        try {
            const encoded = this.encodePath(path);
            await fetch(`${this.dbUrl}/${encoded}.json`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.warn('CloudSync deleteNode 同步失敗', path, e);
        }
    },

    upsertUser(record) {
        if (!record || !record.id) return;
        const pid = String(record.id);
        const serialized = JSON.stringify(record);
        if (this.lastPushedUsersJson[pid] === serialized) return;
        this.lastPushedUsersJson[pid] = serialized;
        this.putNode(`${USERS_KEY}/${pid}`, record);
    },

    syncUsersArray(usersArr) {
        const list = Array.isArray(usersArr) ? usersArr : [];
        const currentIds = new Set(list.filter(u => u && u.id).map(u => String(u.id)));
        Object.keys(this.lastPushedUsersJson).forEach(oldId => {
            if (!currentIds.has(oldId)) {
                delete this.lastPushedUsersJson[oldId];
                this.deleteNode(`${USERS_KEY}/${oldId}`);
            }
        });
        list.forEach(u => this.upsertUser(u));
    }
};


// 台灣地區與縣市對照表（先選地區、再選縣市）
const REGION_CITIES = {
    '北部': ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'],
    '中部': ['苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣'],
    '南部': ['嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣'],
    '東部': ['花蓮縣', '台東縣'],
    '離島地區': ['澎湖縣', '金門縣', '連江縣'],
    '海外地區': ['海外地區']
};

const REGION_OPTIONS = Object.keys(REGION_CITIES);

function inferRegionByCity(city) {
    if (!city) return '';
    for (const [reg, cities] of Object.entries(REGION_CITIES)) {
        if (cities.includes(city)) return reg;
    }
    return '';
}

// 1. 戀愛點滴時刻隨機庫
const ROMANCE_MOMENTS = [
    {
        category: '💘 心動時刻',
        art: '💓',
        title: '在幾千人的擦肩裡，演算法剛好停在了你面前',
        text: '訊息跳出來的那一秒，原本平淡的夜晚突然有了溫度。原來心動不是轟轟烈烈，而是開始期待手機螢幕亮起。'
    },
    {
        category: '🥹 感人瞬間',
        art: '🕯️',
        title: '謝謝你願意在忙碌的生活裡，留一段時間聽我說話',
        text: '被一個人認真記住喜好、在疲憊時收到一句「今天辛苦了」，是這座城市裡最溫柔的救贖。'
    },
    {
        category: '🌧️ 負荷與磨合',
        art: '🫧',
        title: '靠近一個人總會伴隨一點點不安，慢慢來也沒關係',
        text: '害怕太黏會造成對方負荷，又怕太冷淡會錯過彼此。別忘了，真正適合你的人，接得住你的小心翼翼。'
    },
    {
        category: '🍂 分開與釋懷',
        art: '🎐',
        title: '有些相遇只有七天，但足以照亮某個平凡的夜晚',
        text: '如果七天後我們選擇走向不同的方向，也謝謝你曾陪我走過這一小段路，願我們都能遇見更契合的靈魂。'
    },
    {
        category: '💔 分手後的成長',
        art: '🩹',
        title: '把上一段故事的眼淚收好，你依然擁有去愛的能力',
        text: '曾經以為再也不會對誰敞開心扉了，但時間會慢慢把傷口變成溫柔的養分，帶你走向真正懂得珍惜你的人。'
    },
    {
        category: '🌅 重聚與珍惜',
        art: '🌸',
        title: '謝謝你在七天倒數結束前，也剛好選擇了留下',
        text: '在無數個可以轉身離開的瞬間裡，兩個人同時按下「繼續」，這份雙向奔赴比任何巧合都還要浪漫。'
    },
    {
        category: '🎡 一起開心難過的點滴',
        art: '☕',
        title: '分享同一首音樂的快樂，也分擔下雨天的低落',
        text: '無論是週末探店吃到好吃甜點的雀躍，還是加班後想找人傾訴的委屈，有人並肩同行的日子就不算孤單。'
    }
];

// 2. 報名時「希望對方哪個欄位要完全吻合」選項（居住改為先選地區、可再選縣市）
const EXACT_MATCH_OPTIONS = [
    { key: 'mbti', label: 'MBTI', choices: ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'] },
    { key: 'gender', label: '性別', choices: ['男', '女'] },
    { key: 'ageRange', label: '年齡範圍', choices: ['18~22歲', '23~26歲', '27~30歲', '31~35歲', '36歲以上'] },
    {
        key: 'region',
        label: '當前居住地區（選地區可配對全區，亦可指定縣市）',
        type: 'regionCity',
        choices: REGION_OPTIONS
    },
    { key: 'height', label: '你的身高', choices: ['150cm以上', '155cm以上', '160cm以上', '165cm以上', '170cm以上', '175cm以上', '180cm以上'] },
    { key: 'hasPet', label: '是否有養動物 / 寵物', choices: ['沒有養寵物', '狗', '貓', '貓狗都有', '兔子', '倉鼠 / 鼠類', '鳥類', '爬蟲類 / 兩棲', '水族 / 魚蝦', '其他寵物'] },
    { key: 'smoking', label: '抽煙', choices: ['不會', '偶爾', '會'] },
    { key: 'drinking', label: '喝酒', choices: ['不喝', '社交場合', '常喝'] },
    { key: 'lookingFor', label: '想找關係', choices: ['認真交往', '先當朋友', '看感覺', '純找朋友'] }
];

// 3. 完整表單欄位結構
const FIELD_SECTIONS = [
    {
        id: 'sec1',
        title: 'A. 基本資料',
        defaultPrivacy: 'closed',
        fields: [
            { key: 'nickname', label: '暱稱（好友名單顯示名稱）', type: 'text', required: true, placeholder: '希望對方怎麼稱呼你' },
            { key: 'ig', label: 'IG 帳號（預設不開放，當雙方7天後成為好友時，會自動開放）', type: 'text', required: true, autoOpenAfter7Days: true, placeholder: '@your_instagram' },
            {
                key: 'gender',
                label: '你的性別',
                type: 'select',
                required: true,
                alwaysOpen: true,
                options: ['男', '女']
            },
            { key: 'targetGender', label: '你想配對的性別', type: 'select', required: true, options: ['男生', '女生', '都可以'] },
            { key: 'age', label: '你的年齡（實歲）', type: 'number', required: true, placeholder: '例如：25' },
            { key: 'minAge', label: '最小可接受年齡', type: 'number', required: true, placeholder: '例如：22' },
            { key: 'maxAge', label: '最大可接受年齡', type: 'number', required: true, placeholder: '例如：32' },
            {
                key: 'city',
                label: '當前居住縣市（請先選地區，再選縣市）',
                type: 'regionCity',
                required: true
            },
            { key: 'distance', label: '可接受的距離', type: 'select', required: true, options: ['同縣市', '北中南同區', '全台都可以', '可遠距'] },
            { key: 'status', label: '目前身分', type: 'select', required: true, options: ['學生', '上班族', '自由業', '其他'] },
            { key: 'school', label: '學校（選填）', type: 'text', required: false, placeholder: '選填' },
            { key: 'job', label: '科系 / 工作／產業（選填）', type: 'text', required: false, placeholder: '選填' },
            { key: 'height', label: '你的身高（公分，選填）', type: 'number', required: false, placeholder: '只填數字，例如 168' },
            { key: 'minHeight', label: '期望對方身高：最低（選填）', type: 'text', required: false, placeholder: '不限或填數字' },
            { key: 'bmi', label: '你的 BMI（選填）', type: 'select', required: false, options: ['小於18.5', '18.5~24(正常區間)', '24以上'] },
            { key: 'targetBmi', label: '期望對方的 BMI（選填）', type: 'select', required: false, options: ['小於18.5', '18.5~24(正常區間)', '24以上', '都可以'] }
        ]
    },
    {
        id: 'sec2',
        title: 'B. 生活習慣、寵物與戀愛觀',
        defaultPrivacy: 'open',
        fields: [
            {
                key: 'hasPet',
                label: '是否有養動物 / 寵物',
                type: 'select',
                required: true,
                options: ['沒有養寵物', '狗', '貓', '貓狗都有', '兔子', '倉鼠 / 鼠類', '鳥類', '爬蟲類 / 兩棲', '水族 / 魚蝦', '其他寵物']
            },
            {
                key: 'likesPets',
                label: '是否喜歡動物 / 寵物',
                type: 'select',
                required: true,
                options: ['是', '否']
            },
            { key: 'smoking', label: '你抽菸嗎？', type: 'select', required: true, options: ['會', '偶爾', '不會'] },
            { key: 'acceptSmoking', label: '可接受對方抽菸嗎？', type: 'select', required: true, options: ['可以', '偶爾可以', '不行'] },
            { key: 'drinking', label: '你喝酒嗎？', type: 'select', required: true, options: ['常喝', '社交場合', '不喝'] },
            { key: 'acceptDrinking', label: '可接受對方喝酒的程度', type: 'select', required: true, options: ['都可以', '社交場合就好', '不行'] },
            { key: 'lookingFor', label: '想找關係', type: 'select', required: true, options: ['認真交往', '先當朋友', '看感覺', '純找朋友'] },
            {
                key: 'relationshipStatus',
                label: '你目前的感情狀況',
                type: 'select',
                required: true,
                options: [
                    '已經準備好認識新的人了（可以進入戀愛的狀態）',
                    '剛結束一段感情，還在調適中',
                    '還沒確定自己是否準備好了',
                    '想先認識適合的人從朋友開始，不急著進入戀愛',
                    '還沒準備好'
                ]
            },
            {
                key: 'appearancePriority',
                label: '外表在你挑對象時有多重要？',
                type: 'select',
                required: true,
                options: [
                    '幾乎不看，聊得來最重要(重要性：個性 9 外表 1)',
                    '有點在意，但個性優先(重要性：個性 7 外表 3)',
                    '外表跟個性一樣重要(重要性：個性 5 外表 5)',
                    '很在意，要有一定程度的眼緣(重要性：個性3 外表7)',
                    '非常卡顏，沒感覺就很難開始(重要性：個性1 外表9)'
                ]
            },
            {
                key: 'contactFrequency',
                label: '理想的聯絡頻率',
                type: 'select',
                required: true,
                options: [
                    '很黏人：最好整天都能聊，訊息秒回最安心',
                    '稍微黏人：每天都想聊上幾輪，分享生活大小事',
                    '剛剛好：每天聊一下就好，有空就多聊一點',
                    '偏向獨立：不用天天聊，想到再傳就好',
                    '很獨立：有事再找對方，各自忙也很自在'
                ]
            },
            {
                key: 'connectWay',
                label: '你偏好或可接受的認識方式',
                type: 'select',
                required: true,
                options: [
                    '先文字訊息聊天再說',
                    '只接受文字訊息聊天',
                    '語音訊息',
                    '語音通話',
                    '視訊通話',
                    '直接約出來見面',
                    '都可以，看對方習慣'
                ]
            },
            {
                key: 'datingPace',
                label: '你的交友步調',
                type: 'select',
                required: true,
                options: [
                    '很慢熱，要聊很久、剛認識不要太頻繁傳訊息',
                    '偏慢，慢慢聊、等有感覺再說',
                    '順其自然，看相處狀況',
                    '偏快，聊得來就願意盡快見面',
                    '很快，感覺對了就快速推進'
                ]
            },
            {
                key: 'loveExp',
                label: '你的戀愛經驗（選填）',
                type: 'select',
                required: false,
                options: ['沒有談過', '1～2 任', '3～4 任', '5 任以上']
            },
            {
                key: 'targetLoveExp',
                label: '你期望對方的戀愛經驗（選填）',
                type: 'select',
                required: false,
                options: ['不介意', '最好沒談過', '最好 2 任以內', '最好 4 任以內', '至少4 任以上']
            },
            {
                key: 'conflictStyle',
                label: '吵架時你通常會',
                type: 'select',
                required: true,
                options: ['當場講清楚', '稍微緩一下再說', '看情況', '需要一段時間', '傾向迴避']
            },
            { key: 'personalSpace', label: '你需要多少個人空間？（1很少 ~ 5很多）', type: 'select', required: true, options: ['1（很少）', '2', '3（適中）', '4', '5（很多）'] },
            { key: 'dateCost', label: '約會費用怎麼分', type: 'select', required: true, options: ['AA', '輪流請', '看情況', '一方多付'] },
            {
                key: 'attachmentSelf',
                label: '你覺得自己在感情中比較像哪一種？',
                subtitle: '憑直覺選就好，沒有好壞之分',
                type: 'select',
                required: true,
                options: [
                    '安全型：信任對方，能親密也能各自獨立',
                    '焦慮型：很在乎對方回應，容易擔心被冷落',
                    '逃避型：重視自由，太親密會想退一步',
                    '混亂型：想靠近又怕受傷，情緒比較起伏',
                    '不確定'
                ]
            },
            {
                key: 'attachmentTarget',
                label: '你希望對方是哪一種？（單選）',
                type: 'select',
                required: true,
                options: ['安全型', '焦慮型', '逃避型', '混亂型', '不在意']
            },
            { key: 'mbti', label: '你的 MBTI', type: 'select', required: true, options: ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP', '不知道 / 沒測過'] },
            {
                key: 'relationshipGoal',
                label: '你／妳期待一段感情走向哪裡？',
                type: 'select',
                required: true,
                options: [
                    '長期：以結婚為前提，想找一輩子的伴侶',
                    '中長期：認真交往，希望走得長久，未來再看是否結婚',
                    '中期：想談一段穩定的戀愛，先好好相處，不急著想未來',
                    '短中期：先從朋友開始，慢慢認識，有感覺再發展',
                    '短期：想要體驗看看，或是有人陪伴，一起跨年等等，之後再看',
                    '不確定：還不確定，先認識看看再說'
                ]
            }
        ]
    },
    {
        id: 'sec3',
        title: 'C. 你的興趣嗜好',
        defaultPrivacy: 'open',
        fields: [
            {
                key: 'hobbies',
                label: '興趣嗜好（下拉複選，選好會顯示在欄位上；選「其他」可自行填寫）',
                type: 'multiselect',
                allowOther: true,
                required: true,
                alwaysOpen: true,
                options: [
                    '聽講故事', '追劇', '投資理財', '電影', '音樂', '動漫', '遊戲', '唱歌',
                    '運動健身', '爬山戶外', '旅行', '美食咖啡廳', '閱讀', '攝影', '手作',
                    '寵物', '桌遊', '藝文展覽', '其他'
                ]
            }
        ]
    },
    {
        id: 'sec4',
        title: 'D. 讓對方更認識你',
        defaultPrivacy: 'open',
        fields: [
            { key: 'oneSentence', label: '想對未來配對對象說的一句話或一個問題', type: 'text', required: true, alwaysOpen: true, placeholder: '一句話就好，不用想太久' },
            { key: 'bio', label: '自我介紹（推薦認真寫）', type: 'textarea', required: true, alwaysOpen: true, placeholder: '個性、平常在忙什麼、喜歡怎麼過週末' },
            { key: 'idealPartner', label: '稍微描述一下想像中伴侶的模樣吧！', type: 'textarea', required: true, alwaysOpen: true, placeholder: '例如：希望對方也喜歡貓、不考慮遠距...' },
            {
                key: 'icebreakerQuestion',
                label: '破冰提問（第一句話你希望對方問你什麼？）',
                type: 'textarea',
                required: true,
                alwaysOpen: true,
                placeholder: '',
                hints: [
                    '舉例 1：你週末最喜歡去哪裡放鬆或探店？',
                    '舉例 2：最近有沒有讓你單曲循環的一首歌，或想推薦的影集？',
                    '舉例 3：如果突然多出三天連假，你最想飛去哪裡或做什麼？',
                    '舉例 4：你覺得兩個人相處時，最讓你覺得心動的小細節是什麼？',
                    '舉例 5：分享一件最近讓你覺得很開心或很有成就感的小事吧！'
                ]
            }
        ]
    }
];

// 4. 唯一玩家 ID 分配器（男 10001 起 / 女 20001 起）
const IdAllocator = {
    allocate(gender) {
        const counters = JSON.parse(localStorage.getItem(ID_COUNTER_KEY) || '{"male":10001,"female":20001,"other":30001}');
        const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
        const usedIds = new Set(users.map(u => String(u.id)));

        if (gender === '男') {
            let candidate = Math.max(10001, Number(counters.male || 10001));
            while (usedIds.has(String(candidate))) candidate++;
            counters.male = candidate + 1;
            localStorage.setItem(ID_COUNTER_KEY, JSON.stringify(counters));
            if (typeof CloudSync !== 'undefined') CloudSync.putNode(ID_COUNTER_KEY, counters);
            return String(candidate);
        } else if (gender === '女') {
            let candidate = Math.max(20001, Number(counters.female || 20001));
            while (usedIds.has(String(candidate))) candidate++;
            counters.female = candidate + 1;
            localStorage.setItem(ID_COUNTER_KEY, JSON.stringify(counters));
            if (typeof CloudSync !== 'undefined') CloudSync.putNode(ID_COUNTER_KEY, counters);
            return String(candidate);
        } else {
            let candidate = Math.max(30001, Number(counters.other || 30001));
            while (usedIds.has(String(candidate))) candidate++;
            counters.other = candidate + 1;
            localStorage.setItem(ID_COUNTER_KEY, JSON.stringify(counters));
            if (typeof CloudSync !== 'undefined') CloudSync.putNode(ID_COUNTER_KEY, counters);
            return String(candidate);
        }
    }
};

// 5. 跨版本永久儲存管理器、禁止字眼、信件與系統開關控制
const Store = {
    getSystemConfig() {
        const autoBatch = calcAutoBatchNumber(new Date());
        try {
            const sys = JSON.parse(localStorage.getItem(SYSTEM_STATE_KEY) || '{}');
            const batchOffset = Number(sys.batchOffset || 0);
            const effectiveBatch = Math.max(1, autoBatch + batchOffset);
            return {
                currentBatch: effectiveBatch,
                autoBatch: autoBatch,
                batchOffset: batchOffset,
                registrationOpen: sys.registrationOpen !== undefined ? Boolean(sys.registrationOpen) : true,
                profileLocked: sys.profileLocked !== undefined ? Boolean(sys.profileLocked) : false,
                genderLimitEnabled: sys.genderLimitEnabled !== undefined ? Boolean(sys.genderLimitEnabled) : false,
                genderLimitMax: sys.genderLimitMax !== undefined ? Math.max(1, Number(sys.genderLimitMax)) : 30
            };
        } catch (e) {
            return {
                currentBatch: autoBatch,
                autoBatch: autoBatch,
                batchOffset: 0,
                registrationOpen: true,
                profileLocked: false,
                genderLimitEnabled: false,
                genderLimitMax: 30
            };
        }
    },

    setSystemConfig(patch) {
        const current = this.getSystemConfig();
        const updated = { ...current, ...patch };
        localStorage.setItem(SYSTEM_STATE_KEY, JSON.stringify(updated));
        if (typeof CloudSync !== 'undefined') CloudSync.putNode(SYSTEM_STATE_KEY, updated);
        return updated;
    },

    getGenderCounts() {
        try {
            const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
            let male = 0;
            let female = 0;
            users.forEach(u => {
                if (!u || !u.id) return;
                if (u.gender === '男') male++;
                else if (u.gender === '女') female++;
            });
            return { male, female };
        } catch (e) {
            return { male: 0, female: 0 };
        }
    },

    getGenderQuotaStatus() {
        const cfg = this.getSystemConfig();
        const counts = this.getGenderCounts();
        const limit = Math.max(1, Number(cfg.genderLimitMax || 30));
        const enabled = Boolean(cfg.genderLimitEnabled);
        const maleFull = enabled && counts.male >= limit;
        const femaleFull = enabled && counts.female >= limit;
        const bothFull = enabled && maleFull && femaleFull;
        return {
            enabled,
            limit,
            maleCount: counts.male,
            femaleCount: counts.female,
            maleFull,
            femaleFull,
            bothFull
        };
    },

    getBannedRules() {
        const raw = localStorage.getItem(BANNED_RULES_KEY);
        if (!raw) {
            const initial = [{ id: 'BR_DEFAULT_1', field: 'ig', keyword: 'gak' }];
            localStorage.setItem(BANNED_RULES_KEY, JSON.stringify(initial));
            return initial;
        }
        try {
            return JSON.parse(raw);
        } catch (e) {
            return [];
        }
    },

    checkProfileBanned(profile) {
        const rules = this.getBannedRules();
        for (const rule of rules) {
            const kw = String(rule.keyword || '').trim().toLowerCase();
            if (!kw) continue;

            if (rule.field === 'all') {
                for (const val of Object.values(profile)) {
                    const str = Array.isArray(val) ? val.join(' ') : String(val || '');
                    if (str.toLowerCase().includes(kw)) {
                        return rule;
                    }
                }
            } else {
                const rawVal = profile[rule.field];
                const str = Array.isArray(rawVal) ? rawVal.join(' ') : String(rawVal || '');
                const normalized = rule.field === 'ig' ? str.replace(/^@+/, '').toLowerCase() : str.toLowerCase();
                if (normalized.includes(kw)) {
                    return rule;
                }
            }
        }
        return null;
    },

    getActiveBatchNumber() {
        return this.getSystemConfig().currentBatch;
    },

    setActiveBatchNumber(num) {
        const autoBatch = calcAutoBatchNumber(new Date());
        this.setSystemConfig({ batchOffset: Number(num) - autoBatch });
    },

    getMailbox() {
        try {
            return JSON.parse(localStorage.getItem(MAILBOX_KEY) || '[]');
        } catch (e) {
            return [];
        }
    },

    getDefaultState() {
        const privacy = {};
        FIELD_SECTIONS.forEach(sec => {
            sec.fields.forEach(f => {
                if (f.alwaysOpen) {
                    privacy[f.key] = 'open';
                } else {
                    privacy[f.key] = sec.defaultPrivacy || 'closed';
                }
            });
        });
        return {
            version: SCHEMA_VERSION,
            playerId: null,
            isWarnedAccount: false,
            warningReason: '',
            isChatBanned: false,
            readMailIds: [],
            profile: {
                region: '',
                city: '',
                hobbies: [],
                hobbiesOther: ''
            },
            privacy: privacy,
            registeredSessions: [],
            exactMatchCriteria: {},
            matchedSession: null,
            friends: [],
            activeFriendId: null,
            multiFriendSince: null,
            confessionUnlockAt: null,
            lastConfessionDate: null
        };
    },

    normalizeParsedState(parsed) {
        const base = this.getDefaultState();
        if (!parsed || typeof parsed !== 'object') return base;

        const mergedPrivacy = { ...base.privacy, ...(parsed.privacy || {}) };
        Object.keys(mergedPrivacy).forEach(k => {
            if (mergedPrivacy[k] === 'never') mergedPrivacy[k] = 'closed';
        });
        FIELD_SECTIONS.forEach(sec => {
            sec.fields.forEach(f => {
                if (f.alwaysOpen) mergedPrivacy[f.key] = 'open';
            });
        });
        mergedPrivacy.ig = 'closed';

        let sessions = Array.isArray(parsed.registeredSessions) ? parsed.registeredSessions : [];
        if (sessions.length === 0 && parsed.registeredSession) {
            sessions = [parsed.registeredSession];
        }
        sessions = Array.from(new Set(sessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));

        const mergedProfile = { ...base.profile, ...(parsed.profile || {}) };
        if (!mergedProfile.region && mergedProfile.city) {
            mergedProfile.region = inferRegionByCity(mergedProfile.city);
        }
        if (mergedProfile.gender && mergedProfile.gender !== '男' && mergedProfile.gender !== '女') {
            if (!parsed.playerId) mergedProfile.gender = '';
        }
        if (mergedProfile.targetGender === '男') mergedProfile.targetGender = '男生';
        else if (mergedProfile.targetGender === '女') mergedProfile.targetGender = '女生';
        else if (mergedProfile.targetGender === '非二元') mergedProfile.targetGender = '都可以';

        return {
            ...base,
            ...parsed,
            version: SCHEMA_VERSION,
            isChatBanned: Boolean(parsed.isChatBanned),
            readMailIds: Array.isArray(parsed.readMailIds) ? parsed.readMailIds : [],
            profile: mergedProfile,
            privacy: mergedPrivacy,
            registeredSessions: sessions,
            exactMatchCriteria: (parsed.exactMatchCriteria && typeof parsed.exactMatchCriteria === 'object') ? parsed.exactMatchCriteria : {},
            friends: Array.isArray(parsed.friends) ? parsed.friends : []
        };
    },

    loadByPlayerId(targetPlayerId) {
        const base = this.getDefaultState();
        const pid = String(targetPlayerId || '').trim();
        if (!pid) return base;

        try {
            const perPlayerRaw = localStorage.getItem(PLAYER_STATE_PREFIX + pid);
            if (perPlayerRaw) {
                const state = this.normalizeParsedState(JSON.parse(perPlayerRaw));
                state.playerId = pid;
                sessionStorage.setItem(TAB_PLAYER_ID_KEY, pid);
                return state;
            }
        } catch (e) {}

        // 若本地尚未有該玩家緩存，從共享資料庫 yuelao_users 還原
        try {
            const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
            const userRec = users.find(u => String(u.id) === pid);
            if (userRec) {
                const state = this.normalizeParsedState({
                    playerId: pid,
                    isWarnedAccount: Boolean(userRec.isWarned),
                    warningReason: userRec.warningReason || '',
                    isChatBanned: Boolean(userRec.isChatBanned),
                    profile: { ...userRec },
                    privacy: userRec.privacy || {},
                    registeredSessions: Array.isArray(userRec.registeredSessions) ? Array.from(new Set(userRec.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean))) : [],
                    exactMatchCriteria: userRec.exactMatchCriteria || {}
                });
                sessionStorage.setItem(TAB_PLAYER_ID_KEY, pid);
                return state;
            }
        } catch (e) {}

        return base;
    },

    load() {
        const base = this.getDefaultState();
        try {
            // 1. 優先支援網址參數 ?playerId=10001
            const urlParams = new URLSearchParams(window.location.search);
            const queryPid = urlParams.get('playerId');
            if (queryPid) {
                return this.loadByPlayerId(queryPid);
            }

            // 2. 檢查目前分頁是否已綁定特定玩家 ID（支援同瀏覽器多分頁同時登入不同玩家互不覆蓋）
            const tabPid = sessionStorage.getItem(TAB_PLAYER_ID_KEY);
            if (tabPid) {
                return this.loadByPlayerId(tabPid);
            }

            // 3. 首次開啟分頁時讀取預設本地儲存
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return base;
            const state = this.normalizeParsedState(JSON.parse(raw));
            if (state.playerId) {
                sessionStorage.setItem(TAB_PLAYER_ID_KEY, String(state.playerId));
            }
            return state;
        } catch (e) {
            console.error('讀取本地資料異常', e);
            return base;
        }
    },

    save(state) {
        state.version = SCHEMA_VERSION;
        FIELD_SECTIONS.forEach(sec => {
            sec.fields.forEach(f => {
                if (f.alwaysOpen) state.privacy[f.key] = 'open';
            });
        });
        state.privacy.ig = 'closed';

        if (state.profile && state.profile.city && !state.profile.region) {
            state.profile.region = inferRegionByCity(state.profile.city);
        }

        if (Array.isArray(state.registeredSessions)) {
            state.registeredSessions = Array.from(new Set(state.registeredSessions.map(s => normalizeSessionLabel(s)).filter(Boolean)));
        }
        if (state.matchedSession) {
            state.matchedSession = normalizeSessionLabel(state.matchedSession);
        }

        if (state.playerId) {
            sessionStorage.setItem(TAB_PLAYER_ID_KEY, String(state.playerId));
            localStorage.setItem(PLAYER_STATE_PREFIX + String(state.playerId), JSON.stringify(state));
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

        if (state.playerId && state.profile) {
            const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
            const idx = users.findIndex(u => String(u.id) === String(state.playerId));
            const existingRecord = idx >= 0 ? users[idx] : {};

            const record = {
                ...existingRecord,
                id: String(state.playerId),
                ...state.profile,
                nickname: (state.profile.nickname && String(state.profile.nickname).trim()) || `玩家_${state.playerId}`,
                region: state.profile.region || inferRegionByCity(state.profile.city),
                privacy: state.privacy,
                isWarned: !!state.isWarnedAccount,
                warningReason: state.warningReason || '',
                isMatchBanned: Boolean(existingRecord.isMatchBanned),
                isChatBanned: Boolean(existingRecord.isChatBanned),
                registeredSessions: state.isWarnedAccount ? [] : (state.registeredSessions || []),
                exactMatchCriteria: state.exactMatchCriteria || {},
                matchedHistory: Array.isArray(existingRecord.matchedHistory) ? existingRecord.matchedHistory : [],
                matchedSession: state.matchedSession || existingRecord.matchedSession || null,
                matchedWithId: existingRecord.matchedWithId || null,
                matchedWithName: state.friends.map(f => f.nickname).join(', ') || existingRecord.matchedWithName || null,
                updatedAt: new Date().toLocaleString('zh-TW')
            };
            if (idx >= 0) users[idx] = record;
            else users.push(record);
            localStorage.setItem(USERS_KEY, JSON.stringify(users));
            if (typeof CloudSync !== 'undefined') CloudSync.upsertUser(record);
        }
    },

    saveSharedUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
        if (typeof CloudSync !== 'undefined') CloudSync.syncUsersArray(users);
    },

    addIssueReport(report) {
        const reports = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
        const newRep = {
            id: 'R' + Date.now().toString().slice(-6),
            category: report.category,
            contact: report.contact || '匿名玩家',
            content: report.content,
            status: '待處理',
            ts: Date.now(),
            createdAt: new Date().toLocaleString('zh-TW')
        };
        reports.unshift(newRep);
        localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
        if (typeof CloudSync !== 'undefined') CloudSync.putNode(`${REPORTS_KEY}/${newRep.id}`, newRep);
    }
};

// 6. 雙方即時共享聊天歷史紀錄管理器（永久保留，直到直接解除配對才清空）
const ChatStore = {
    getPairKey(id1, id2) {
        return [String(id1), String(id2)].sort().join('__');
    },

    getAll() {
        try {
            return JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
        } catch (e) {
            return {};
        }
    },

    saveAll(allChats) {
        localStorage.setItem(CHATS_KEY, JSON.stringify(allChats));
    },

    getMessages(id1, id2) {
        if (!id1 || !id2) return [];
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        return Array.isArray(all[key]) ? all[key] : [];
    },

    ensureThread(id1, id2, initialMessages = []) {
        if (!id1 || !id2) return [];
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        if (!Array.isArray(all[key]) || all[key].length === 0) {
            all[key] = initialMessages.map((m, idx) => ({
                id: m.id || `INIT_${key}_${idx}`,
                senderId: String(m.senderId || 'system'),
                senderName: m.senderName || '',
                text: m.text || '',
                time: m.time || '',
                ts: m.ts || (Date.now() + idx)
            }));
            this.saveAll(all);
            if (typeof CloudSync !== 'undefined') {
                all[key].forEach(mObj => CloudSync.putNode(`${CHATS_KEY}/${key}/${mObj.id}`, mObj));
            }
        }
        return all[key];
    },

    appendMessage(id1, id2, msg) {
        if (!id1 || !id2) return [];
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        if (!Array.isArray(all[key])) all[key] = [];
        const savedMsg = {
            id: msg.id || `MSG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            senderId: String(msg.senderId),
            senderName: msg.senderName || '',
            text: msg.text,
            time: msg.time || '',
            ts: msg.ts || Date.now()
        };
        all[key].push(savedMsg);
        this.saveAll(all);
        if (typeof CloudSync !== 'undefined') {
            CloudSync.putNode(`${CHATS_KEY}/${key}/${savedMsg.id}`, savedMsg);
        }
        return all[key];
    },

    clearChat(id1, id2) {
        if (!id1 || !id2) return;
        const all = this.getAll();
        const key = this.getPairKey(id1, id2);
        if (Object.prototype.hasOwnProperty.call(all, key)) {
            delete all[key];
            this.saveAll(all);
        }
        if (typeof CloudSync !== 'undefined') {
            CloudSync.deleteNode(`${CHATS_KEY}/${key}`);
        }
    },

    clearAllForPlayer(playerId) {
        const pid = String(playerId);
        const all = this.getAll();
        let changed = false;
        Object.keys(all).forEach(k => {
            if (k.split('__').includes(pid)) {
                delete all[k];
                changed = true;
            }
        });
        if (changed) this.saveAll(all);
    }
};
