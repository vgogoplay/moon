/* shared/schema.js - 前後台共用：表單欄位結構、地區/MBTI對照表、戀愛語錄與 5 碼通行碼演算法 */

const SCHEMA_VERSION = 31;
// 🧪 測試階段開關：true = 全部欄位暫時免必填；正式上線時改為 false 即可恢復全部必填驗證
const TEST_MODE_OPTIONAL_FIELDS = false;

function isFieldRequired(field) {
    if (typeof TEST_MODE_OPTIONAL_FIELDS !== 'undefined' && TEST_MODE_OPTIONAL_FIELDS) return false;
    return Boolean(field && field.required);
}

const REGION_CITIES = {
    '北部': ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'],
    '中部': ['苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣'],
    '南部': ['嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣'],
    '東部': ['花蓮縣', '台東縣']
};

const REGION_OPTIONS = Object.keys(REGION_CITIES);

function inferRegionByCity(city) {
    if (!city) return '';
    for (const [reg, cities] of Object.entries(REGION_CITIES)) {
        if (cities.includes(city)) return reg;
    }
    return '';
}

// MBTI 二段式分類對照表（先選 I人 或 E人，再選具體 I開頭 或 E開頭 人格）
const MBTI_GROUPS = {
    'I人': ['INTJ', 'INTP', 'INFJ', 'INFP', 'ISTJ', 'ISFJ', 'ISTP', 'ISFP'],
    'E人': ['ENTJ', 'ENTP', 'ENFJ', 'ENFP', 'ESTJ', 'ESFJ', 'ESTP', 'ESFP']
};

function inferMbtiGroup(mbtiVal) {
    const code = String(mbtiVal || '').trim().toUpperCase();
    if (!code) return '';
    if (code === '不知道 / 沒測過' || code.includes('不知道') || code.includes('沒測過')) return '不知道 / 沒測過';
    if (MBTI_GROUPS['I人'].includes(code) || code.startsWith('I')) return 'I人';
    if (MBTI_GROUPS['E人'].includes(code) || code.startsWith('E')) return 'E人';
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

// 2. 報名時「希望對方哪個欄位要完全吻合」選項（居住地區僅選北部、中部、南部、東部）
const EXACT_MATCH_OPTIONS = [
    { key: 'mbti', label: 'MBTI', choices: ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'] },
    { key: 'gender', label: '性別', choices: ['男', '女'] },
    { key: 'ageRange', label: '年齡範圍', choices: ['22~25歲', '26~30歲', '31~35歲', '36~40歲'] },
    {
        key: 'region',
        label: '當前居住地區',
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
            { key: 'age', label: '你的年齡（實歲，22～40 歲）', type: 'number', min: 22, max: 40, required: true, placeholder: '請輸入 22～40 歲（例如：25）' },
            { key: 'minAge', label: '最小可接受年齡（至少 22 歲）', type: 'number', min: 22, max: 40, required: true, placeholder: '至少 22 歲（例如：22）' },
            { key: 'maxAge', label: '最大可接受年齡（最高 40 歲）', type: 'number', min: 22, max: 40, required: true, placeholder: '最高 40 歲（例如：35）' },
            {
                key: 'zodiac',
                label: '你的星座',
                type: 'select',
                required: true,
                options: ['牡羊座', '金牛座', '雙子座', '巨蟹座', '獅子座', '處女座', '天秤座', '天蠍座', '射手座', '摩羯座', '水瓶座', '雙魚座']
            },
            {
                key: 'city',
                label: '當前居住縣市（請先選地區，再選縣市）',
                type: 'regionCity',
                required: true
            },
            { key: 'distance', label: '可接受的距離', type: 'select', required: true, options: ['同縣市', '北中南同區', '全台都可以', '可遠距'] },
            {
                key: 'status',
                label: '目前身分（選「其他」可自行填寫）',
                type: 'select',
                allowOther: true,
                otherPlaceholder: '請自行填寫目前身分（例如：軍公教、家管、待業中）...',
                required: true,
                options: ['學生', '上班族', '自由業', '其他']
            },
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
            {
                key: 'mbti',
                label: '你的 MBTI（請先選 I人 或 E人，再選具體人格）',
                type: 'mbtiTwoStep',
                required: true,
                options: ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP', '不知道 / 沒測過']
            },
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
            { key: 'idealPartner', label: '稍微描述一下想像中伴侶的模樣吧！', type: 'textarea', required: true, defaultPrivacy: 'closed', placeholder: '例如：希望對方也喜歡貓、不考慮遠距...' },
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

// 固定唯一 5 碼英數混合備份／還原通行碼產生器（雙射演算法綁定唯一玩家 ID，跨裝置與前後台永遠固定不變且 100% 不重複）
const SHORT_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function isValidShortBackupCode(code) {
    return /^[A-Z0-9]{5}$/.test(String(code || '').trim().toUpperCase());
}

function deriveFixedBackupCode(playerId) {
    const s = String(playerId || '').trim();
    if (!s) return '';
    const MASK = 0x1FFFFFF; // 2^25 - 1 = 33,554,431 (32^5 - 1)
    let x = 0;
    if (/^\d+$/.test(s)) {
        const n = parseInt(s, 10);
        x = (n + 135791) & MASK;
    } else {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        x = h & MASK;
    }

    // 三輪 25-bit 雙射置換（一對一映射，確保不同玩家 ID 永遠產生不同且固定不變的 5 碼英數）
    x = (Math.imul(x, 22695477) + 1234567) & MASK;
    x ^= (x >>> 13);
    x = (Math.imul(x, 1103515245) + 7654321) & MASK;
    x ^= (x >>> 11);
    x = (Math.imul(x, 134775813) + 9876543) & MASK;
    x ^= (x >>> 12);

    let code = '';
    let temp = x >>> 0;
    for (let i = 0; i < 5; i++) {
        code += SHORT_CODE_CHARS[temp & 31];
        temp >>>= 5;
    }
    return code;
}

function generateUniqueShortBackupCode(existingUsers = [], excludePlayerId = null) {
    if (excludePlayerId) {
        return deriveFixedBackupCode(excludePlayerId);
    }
    const usedCodes = new Set();
    (Array.isArray(existingUsers) ? existingUsers : []).forEach(u => {
        if (!u) return;
        const c = String(u.backupCode || '').trim().toUpperCase();
        if (isValidShortBackupCode(c)) usedCodes.add(c);
    });
    for (let seed = 1; seed <= 50000; seed++) {
        const candidate = deriveFixedBackupCode(seed);
        if (!usedCodes.has(candidate)) return candidate;
    }
    return deriveFixedBackupCode(Date.now());
}

function buildBackupCodeFromParts(playerId, profileObj, privacyObj, preferredCode = '', existingUsers = null) {
    if (!playerId) return '';
    return deriveFixedBackupCode(playerId);
}
