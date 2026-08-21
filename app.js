// ========== ИМПОРТЫ И КОНФИГУРАЦИЯ ==========

import {

    MODEL,

    DEFAULT_PROVIDER,

    LLM_PROVIDERS,

    ENHANCE_MODEL_OPTIONS,

    DAILY_STORY_START_LIMIT,

    DAILY_TURNS_PER_STORY_LIMIT,

    ILLUSTRATIONS_ENABLED,

    SEASONS,

    HISTORY_LIMIT,

    SUMMARY_INTERVAL,

    STATS_INFO,

    GENDER_INFO,

    LOCATION_TYPES,

    REGIONS,

    CITIES,

    LOCATION_DETAILS,

    NPC_POOLS,

    ITEM_POOLS,

    REGIONAL_ITEM_POOLS

} from './constants.js';

const STATE_STORAGE_KEY = 'rpg90_state';
const LEGACY_KEY_STORAGE = 'rpg90_key';
const PROVIDER_STORAGE_KEY = 'rpg90_provider';
const ADMIN_TOOLS_STORAGE_KEY = 'rpg90_admin_tools';
const READING_MODE_STORAGE_KEY = 'rpg90_reading_mode';
const READING_BOOKMARK_STORAGE_KEY = 'rpg90_reading_bookmark';
const READING_MODES = new Set(['standard', 'calm', 'high-contrast']);

function getStoredProvider() {
    try {
        return localStorage.getItem(PROVIDER_STORAGE_KEY) || DEFAULT_PROVIDER;
    } catch {
        return DEFAULT_PROVIDER;
    }
}

function persistProviderChoice(provider) {
    try {
        localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
    } catch (e) {
        console.warn('Не удалось сохранить provider:', e);
    }
}

function getStoredReadingMode() {
    try {
        const mode = localStorage.getItem(READING_MODE_STORAGE_KEY);
        return READING_MODES.has(mode) ? mode : 'standard';
    } catch {
        return 'standard';
    }
}

function syncReadingModeControls(mode = getStoredReadingMode()) {
    document.querySelectorAll('#settings-reading-mode-btns .option-btn').forEach((button) => {
        const selected = button.dataset.readingMode === mode;
        setToggleSelected(button, selected);
    });

    const info = document.getElementById('settings-reading-mode-info');
    if (!info) return;
    const descriptions = {
        standard: 'Обычный: исходная типографика и архивные детали страницы.',
        calm: 'Спокойное чтение: больше воздуха между строками и менее заметные детали страницы.',
        'high-contrast': 'Высокая читаемость: более контрастная страница, увеличенный интерлиньяж и минимум декора.'
    };
    info.textContent = descriptions[mode] || descriptions.standard;
}

function applyReadingMode(mode) {
    const nextMode = READING_MODES.has(mode) ? mode : 'standard';
    document.body.dataset.readingMode = nextMode;
    try {
        localStorage.setItem(READING_MODE_STORAGE_KEY, nextMode);
    } catch {}
    syncReadingModeControls(nextMode);
}

function getCurrentReadingBookmarkKey() {
    const currentEntry = getSelectedArchiveEntry();
    if (isArchiveMode() || !currentEntry?.turn) return '';
    return `turn:${currentEntry.turn}`;
}

function getReadingBookmark() {
    try {
        const saved = JSON.parse(localStorage.getItem(READING_BOOKMARK_STORAGE_KEY) || 'null');
        if (!saved || typeof saved.key !== 'string' || !Number.isFinite(saved.progress)) return null;
        return saved;
    } catch {
        return null;
    }
}

function persistReadingBookmark(progress) {
    const key = getCurrentReadingBookmarkKey();
    if (!key || progress < 0.06 || progress > 0.97) return;
    try {
        localStorage.setItem(READING_BOOKMARK_STORAGE_KEY, JSON.stringify({ key, progress }));
    } catch {}
}

function updateContinueReadingButton() {
    const button = els.continueReadingBtn;
    if (!button) return;
    const bookmark = getReadingBookmark();
    const available = Boolean(bookmark && bookmark.key === getCurrentReadingBookmarkKey() && !isArchiveMode());
    button.classList.toggle('hidden', !available);
    button.setAttribute('aria-hidden', String(!available));
}

function continueReadingFromBookmark() {
    const bookmark = getReadingBookmark();
    const storyShell = document.querySelector('.story-shell');
    if (!bookmark || bookmark.key !== getCurrentReadingBookmarkKey() || !storyShell) return;

    const shellTop = window.scrollY + storyShell.getBoundingClientRect().top;
    const target = Math.max(0, shellTop + (storyShell.offsetHeight * bookmark.progress) - (window.innerHeight * 0.2));
    window.scrollTo({ top: target, behavior: 'smooth' });
    showToast('Продолжаем чтение');
}

let readingBookmarkFrame = null;
function trackReadingPosition() {
    if (readingBookmarkFrame || document.body.dataset.screen !== 'game' || isArchiveMode()) return;
    readingBookmarkFrame = window.requestAnimationFrame(() => {
        readingBookmarkFrame = null;
        const storyShell = document.querySelector('.story-shell');
        const storyText = els.story?.textContent?.trim();
        if (!storyShell || !storyText || !getCurrentReadingBookmarkKey()) return;
        const shellTop = window.scrollY + storyShell.getBoundingClientRect().top;
        const progress = (window.scrollY - shellTop + (window.innerHeight * 0.2)) / Math.max(storyShell.offsetHeight, 1);
        persistReadingBookmark(Math.max(0, Math.min(progress, 1)));
    });
}

function createDefaultState() {
    return {
        gender: 'male',
        locationType: 'capital',
        region: 'central',
        city: 'moscow',
        provider: getStoredProvider(),
        pace: 'season',
        difficulty: 'normal',
        startAge: 7,
        year: 1992,
        seasonIdx: 0,
        age: 7,
        stats: { mind: 5, body: 5, family: 5, friends: 5, health: 5, looks: 5, wealth: 5, authority: 5 },
        inventory: [],
        npcs: [],
        history: [],
        originalHistory: [],
        enhancedHistory: [],
        compressedSummary: '',
        lastCompressTurn: 0,
        dialogArchive: '',      // сжатый архив истории диалога (все кроме хвоста)
        lastDialogCompress: 0,  // turnCount последнего сжатия диалога
        archiveEntries: [],
        archiveViewIndex: null,
        gameOver: false,
        miracleUsed: false,
        miracleAvailable: true,
        turnCount: 0,
        lifeSummary: '',
        lastSummaryTurn: 0,
        lastStory: '',
        lastChoices: null,
        lastStatDeltas: null,
        verbosity: 'normal',
        enhanceModel: ENHANCE_MODEL_OPTIONS[0],
        storyId: null,
        lastMiracle: null,
        gameOverData: null
    };
}

const QUOTA_STORAGE_KEY = 'rpg90_daily_quota';

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadQuota() {
    try {
        const raw = JSON.parse(localStorage.getItem(QUOTA_STORAGE_KEY) || 'null');
        if (!raw || raw.date !== todayKey()) {
            return { date: todayKey(), storiesStarted: 0, storyTurns: {} };
        }
        return {
            date: raw.date,
            storiesStarted: Number(raw.storiesStarted) || 0,
            storyTurns: raw.storyTurns && typeof raw.storyTurns === 'object' ? raw.storyTurns : {}
        };
    } catch {
        return { date: todayKey(), storiesStarted: 0, storyTurns: {} };
    }
}

function saveQuota(quota) {
    try {
        localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quota));
    } catch (e) {
        console.warn('Не удалось сохранить лимиты:', e);
    }
}

function getStoryTurnsToday(storyId) {
    if (!storyId) return 0;
    return Number(loadQuota().storyTurns[storyId]) || 0;
}

function canStartNewStory() {
    return loadQuota().storiesStarted < DAILY_STORY_START_LIMIT;
}

function canPlayTurn(storyId) {
    return getStoryTurnsToday(storyId) < DAILY_TURNS_PER_STORY_LIMIT;
}

function recordStoryStart() {
    const quota = loadQuota();
    quota.storiesStarted += 1;
    saveQuota(quota);
}

function recordStoryTurn(storyId) {
    if (!storyId) return;
    const quota = loadQuota();
    quota.storyTurns[storyId] = (Number(quota.storyTurns[storyId]) || 0) + 1;
    saveQuota(quota);
}

function quotaStoryStartMessage() {
    return `Сегодня уже начато ${DAILY_STORY_START_LIMIT} ${pluralizeRu(DAILY_STORY_START_LIMIT, ['история', 'истории', 'историй'])}. Новую можно начать завтра.`;
}

function quotaTurnMessage(storyId) {
    const used = getStoryTurnsToday(storyId);
    return `Лимит ходов на сегодня исчерпан (${used} из ${DAILY_TURNS_PER_STORY_LIMIT}). Эта история продолжится завтра.`;
}

let state = createDefaultState();
let generatedStart = null;
let userApiKey = null;
let userApiKeys = {
    hydra: '',
    openrouter: ''
};
let setupStepIndex = 0;

// Три коротких этапа создания героя и отдельный, не считающийся шагом,
// экран подтверждения. Входная обложка живёт отдельно от мастера.
const SETUP_STEP_COUNT = 3;
const SETUP_STEPS = [
    { title: 'Кто ты', caption: 'Герой', badge: 'Возраст задаёт интонацию всей истории.' },
    { title: 'Где ты живёшь', caption: 'Место', badge: 'Город, село или регион — это часть судьбы героя.' },
    { title: 'Как прожить историю', caption: 'Ритм', badge: 'Выбери темп, сложность и количество деталей.' },
    { title: 'Первый день', caption: 'Всё готово', badge: 'Последний взгляд перед началом истории.' }
];

// ========== ЭЛЕМЕНТЫ DOM ==========

// ========== СИСТЕМА ЛОГИРОВАНИЯ (ОТЛАДКА НЕЙРОСЕТЕЙ) ==========
window.appSystemLogs = [];
function addSystemLog(title, content, isError = false) {
    const time = new Date().toLocaleTimeString();
    window.appSystemLogs.unshift({ time, title, content, isError });
    renderDebugLogs();
}

function escapeDebugHTML(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderDebugLogs() {
    const container = document.getElementById('debug-log-container');
    if (!container) return;
    
    if (window.appSystemLogs.length === 0) {
        container.innerHTML = '<div style="color: var(--muted); text-align: center; padding: 2rem;">Лог пуст. Запросы и ошибки появятся здесь.</div>';
        return;
    }

    container.innerHTML = window.appSystemLogs.map((log, i) => `
        <div style="background: var(--surface-1); border: 1px solid ${log.isError ? 'var(--danger)' : 'var(--border)'}; border-radius: 6px; padding: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <strong style="color: ${log.isError ? 'var(--danger)' : 'var(--ink)'};">${log.title}</strong>
                <span style="font-size: 0.85em; color: var(--muted);">${log.time}</span>
            </div>
            <pre style="white-space: pre-wrap; word-wrap: break-word; font-size: 0.85em; background: var(--surface-2); padding: 0.5rem; border-radius: 4px; color: var(--ink); margin: 0; max-height: 300px; overflow-y: auto;"><code>${escapeDebugHTML(typeof log.content === 'object' ? JSON.stringify(log.content, null, 2) : log.content)}</code></pre>
        </div>
    `).join('');
}

function initDebugUI() {
    const fab = document.getElementById('debug-log-fab');
    const modal = document.getElementById('debug-modal');
    const closeBtn = document.getElementById('debug-close-btn');
    const clearBtn = document.getElementById('debug-clear-btn');
    const backdrop = document.getElementById('debug-backdrop');

    if (fab && modal) {
        const closeDebug = () => closeOverlay(modal);
        fab.addEventListener('click', () => {
            renderDebugLogs();
            openOverlay(modal, closeBtn);
        });

        closeBtn?.addEventListener('click', closeDebug);
        backdrop?.addEventListener('click', closeDebug);

        clearBtn?.addEventListener('click', () => {
            window.appSystemLogs = [];
            renderDebugLogs();
            showToast('Системный лог очищен');
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented && getTopDialogRoot() === modal) {
                event.preventDefault();
                closeDebug();
            }
        });
    }
}
// Вызовем initDebugUI при загрузке
document.addEventListener('DOMContentLoaded', initDebugUI);


const els = {
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-ui'),
    keyInput: document.getElementById('api-key'),
    apiProviderTitle: document.getElementById('api-provider-title'),
    apiKeyHint: document.getElementById('api-key-hint'),
    startBtn: document.getElementById('start-btn'),
    dateText: document.getElementById('date-text'),
    locationDisplay: document.getElementById('location-display'),
    story: document.getElementById('story-display'),
    storyErrorSlot: document.getElementById('story-error-slot'),
    continueReadingBtn: document.getElementById('continue-reading-btn'),
    choices: document.getElementById('choices-display'),
    stats: document.getElementById('stats-display'),
    npcs: document.getElementById('npcs-display'),
    inv: document.getElementById('inventory-display'),
    loader: document.getElementById('loader'),
    loaderMessage: document.getElementById('loader-message'),
    modeDisplay: document.getElementById('mode-display'),
    preview: document.getElementById('start-preview'),
    locationDesc: document.getElementById('location-description'),
    regionRow: document.getElementById('region-select-row'),
    cityRow: document.getElementById('city-select-row'),
    regionSelect: document.getElementById('region-select'),
    citySelect: document.getElementById('city-select'),
    startAge: document.getElementById('start-age'),
    choicesWrap: document.getElementById('choices-wrap'),
    setupPrevBtn: document.getElementById('setup-prev-btn'),
    setupNextBtn: document.getElementById('setup-next-btn'),
    setupStepCounter: document.getElementById('setup-step-counter'),
    setupStepCaption: document.getElementById('setup-step-caption'),
    setupStepTitle: document.getElementById('setup-step-title'),
    setupStepHintBadge: document.getElementById('setup-step-hint-badge'),
    setupSettingsBtn: document.getElementById('setup-settings-btn'),
    gameSettingsBtn: document.getElementById('game-settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    settingsBackdrop: document.getElementById('settings-backdrop'),
    settingsCloseBtn: document.getElementById('settings-close-btn'),
    resetConfirmModal: document.getElementById('reset-confirm-modal'),
    resetConfirmBackdrop: document.getElementById('reset-confirm-backdrop'),
    resetCancelBtn: document.getElementById('reset-cancel-btn'),
    resetConfirmBtn: document.getElementById('reset-confirm-btn'),
    setupProgressFill: document.getElementById('setup-progress-fill'),
    archiveStrip: document.getElementById('archive-strip'),
    archivePrevBtn: document.getElementById('archive-prev-btn'),
    archiveNextBtn: document.getElementById('archive-next-btn'),
    archiveCurrentBtn: document.getElementById('archive-current-btn'),
    archiveCopyBtn: document.getElementById('archive-copy-btn'),
    archiveLabel: document.getElementById('archive-label'),
    archiveRange: document.getElementById('archive-range'),
    // lore panels
    npcsPanel: document.getElementById('npcs-panel'),
    npcsBackdrop: document.getElementById('npcs-backdrop'),
    npcsClose: document.getElementById('npcs-close'),
    npcsGrid: document.getElementById('npcs-grid'),
    npcsEmpty: document.getElementById('npcs-empty'),
    itemsPanel: document.getElementById('items-panel'),
    itemsBackdrop: document.getElementById('items-backdrop'),
    itemsClose: document.getElementById('items-close'),
    itemsGrid: document.getElementById('items-grid'),
    itemsEmpty: document.getElementById('items-empty'),
    npcsTrigger: document.getElementById('npcs-trigger'),
    itemsTrigger: document.getElementById('items-trigger'),
    npcsCount: document.getElementById('npcs-count'),
    itemsCount: document.getElementById('items-count'),
    gameSidebar: document.getElementById('game-sidebar'),
    gameStatusBtn: document.getElementById('game-status-btn'),
    gameSidebarClose: document.getElementById('game-sidebar-close'),
    sidebarDrawerBackdrop: document.getElementById('sidebar-drawer-backdrop'),
    statusMiniRing: document.getElementById('status-mini-ring'),
    statusAvatarUse: document.getElementById('status-avatar-use'),
    gameStatusBrief: document.getElementById('game-status-brief'),
    dossierBalanceRing: document.getElementById('dossier-balance-ring'),
    dossierAvatarUse: document.getElementById('dossier-avatar-use'),
    dossierSummaryTitle: document.getElementById('dossier-summary-title'),
    dossierSummaryText: document.getElementById('dossier-summary-text'),
    dossierRiskCount: document.getElementById('dossier-risk-count'),
    appToast: document.getElementById('app-toast')
};

// ========== ЕДИНАЯ МОДЕЛЬ МОДАЛЬНЫХ СЛОЁВ ==========
// Все диалоги используют один стек: он удерживает фокус внутри верхнего слоя,
// возвращает его на кнопку-источник и не даёт фону прокручиваться.
const overlayReturnFocus = new WeakMap();
const openOverlayStack = [];
const FOCUSABLE_SELECTOR = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

function syncBodyInteractionLock() {
    document.body.classList.toggle('dialog-open', openOverlayStack.length > 0);
}

function openOverlay(root, preferredFocus = null) {
    if (!root) return;
    if (!openOverlayStack.includes(root)) {
        overlayReturnFocus.set(root, document.activeElement);
        openOverlayStack.push(root);
    }
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    syncBodyInteractionLock();
    requestAnimationFrame(() => {
        const dialog = root.querySelector('[role="dialog"]') || root;
        (preferredFocus || dialog.querySelector(FOCUSABLE_SELECTOR) || dialog).focus?.();
    });
}

function releaseOverlay(root, { restoreFocus = true } = {}) {
    if (!root) return;
    const index = openOverlayStack.lastIndexOf(root);
    if (index !== -1) openOverlayStack.splice(index, 1);
    syncBodyInteractionLock();
    if (restoreFocus) overlayReturnFocus.get(root)?.focus?.();
    overlayReturnFocus.delete(root);
}

function closeOverlay(root, options = {}) {
    if (!root) return;
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    releaseOverlay(root, options);
}

function getTopDialogRoot() {
    const stacked = openOverlayStack[openOverlayStack.length - 1];
    if (stacked) return stacked;
    if (document.body.classList.contains('sidebar-drawer-open')) return els.gameSidebar;
    return null;
}

function getVisibleFocusable(root) {
    return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) =>
        !element.closest('.hidden') && element.getClientRects().length > 0
    );
}

function setupDialogFocusManagement() {
    document.addEventListener('keydown', (event) => {
        const root = getTopDialogRoot();
        if (event.key === 'Escape' && root?.id === 'illustration-zoom-modal') {
            event.preventDefault();
            window.closeIllustrationModal?.();
            return;
        }
        if (event.key !== 'Tab' || !root) return;
        const focusable = getVisibleFocusable(root);
        if (!focusable.length) {
            event.preventDefault();
            (root.querySelector('[role="dialog"]') || root).focus?.();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!root.contains(active)) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

// ========== УТИЛИТЫ ==========
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function rollChance(percent) {
    return Math.random() * 100 < percent;
}

// ── БЕЛЫЙ СПИСОК РАЗРЕШЁННЫХ ПОЛЕЙ В "updates" ──
// Всё что не в этом списке — молча удаляется.
const UPDATES_ALLOWED = new Set([
    'mind','body','family','friends','health','looks','wealth','authority',
    'add_item','remove_item','update_item',
    'add_npc','remove_npc','update_npc'
]);

// Исправляет типичные ошибки которые делают LLM в JSON
function sanitizeJSON(raw) {
    let s = raw
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/g, '').trim();

    const start = s.indexOf('{');
    if (start === -1) return s;
    s = s.substring(start);

    // 1. Двойные открывающие скобки: {{"key" → {"key"
    s = s.replace(/\{\{/g, '{');

    // 2. Двойные кавычки перед ключом: ""key" → "key"
    //    Модель иногда пишет: "update_npc": {"name":"X", ""desc":"Y"}
    s = s.replace(/""/g, '"');

    // 3. Trailing commas перед } или ]
    //    Несколько проходов — ловим вложенные случаи
    for (let i = 0; i < 3; i++) s = s.replace(/,(\s*[}\]])/g, '$1');

    // 4. Лишние поля в "updates" — фильтруем по белому списку.
    //    Используем посимвольный разбор чтобы корректно найти границу объекта updates,
    //    даже если внутри есть вложенные объекты с запятыми.
    const updKey = '"updates"';
    const updIdx = s.indexOf(updKey);
    if (updIdx !== -1) {
        let objStart = s.indexOf('{', updIdx + updKey.length);
        if (objStart !== -1) {
            // Находим закрывающую } с учётом вложенности
            let depth = 0, inStr = false, esc = false, objEnd = -1;
            for (let i = objStart; i < s.length; i++) {
                const c = s[i];
                if (esc)       { esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (c === '{') depth++;
                else if (c === '}') { depth--; if (depth === 0) { objEnd = i; break; } }
            }
            if (objEnd !== -1) {
                // Парсим пары ключ-значение внутри updates и оставляем только разрешённые
                const inner = s.substring(objStart + 1, objEnd);
                const filtered = filterUpdatesFields(inner);
                s = s.substring(0, objStart + 1) + filtered + s.substring(objEnd);
            }
        }
    }

    // 5. Лишние блоки в корневом объекте: "stats":{...}, "inventory":[...]
    //    Корневой объект должен содержать только story, choices, updates.
    //    Удаляем любые другие ключи верхнего уровня с произвольными значениями.
    const ROOT_ALLOWED = new Set(['story','choices','updates']);
    s = removeExtraRootKeys(s, ROOT_ALLOWED);

    // 5б. Закрываем незакрытую строку (обрыв внутри "story" или другого значения)
    //     Посимвольно ищем: если по завершении разбора мы всё ещё inString — добавляем "
    {
        let inStr = false, esc = false;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') inStr = !inStr;
        }
        if (inStr) {
            // Строка не закрыта — закрываем её
            s = s + '"';
            if (typeof addSystemLog === 'function')
                addSystemLog('sanitizeJSON: закрыта незакрытая строка', '', false);
        }
    }

    // 6. Незакрытый корневой объект
    let depth2 = 0, inString2 = false, escape2 = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (escape2)         { escape2 = false; continue; }
        if (c === '\\')      { escape2 = true; continue; }
        if (c === '"')       { inString2 = !inString2; continue; }
        if (inString2) continue;
        if (c === '{' || c === '[') depth2++;
        else if (c === '}' || c === ']') depth2--;
    }
    if (depth2 > 0) {
        s = s + '}'.repeat(depth2);
        if (typeof addSystemLog === 'function')
            addSystemLog('sanitizeJSON: добавлено закрывающих скобок', String(depth2), false);
    }

    return s;
}

// Оставляет в строке inner только разрешённые ключи updates
function filterUpdatesFields(inner) {
    // Посимвольно собираем пары ключ:значение.
    // При дублировании ключей берём ПЕРВОЕ значение — это критично:
    // модель при дописывании может повторить числовые поля с нулями,
    // JSON.parse взял бы последние (нули), мы берём первые (реальные дельты).
    const parts = [];
    const seen = new Set();
    let i = 0;
    while (i < inner.length) {
        while (i < inner.length && /[\s,]/.test(inner[i])) i++;
        if (i >= inner.length) break;
        if (inner[i] !== '"') { i++; continue; }
        i++;
        let key = '', esc = false;
        while (i < inner.length) {
            const c = inner[i++];
            if (esc) { esc = false; key += c; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') break;
            key += c;
        }
        while (i < inner.length && /[\s:]/.test(inner[i])) i++;
        const valStart = i;
        i = skipValue(inner, i);
        const valStr = inner.substring(valStart, i).trim();

        if (UPDATES_ALLOWED.has(key) && !seen.has(key)) {
            parts.push(`"${key}": ${valStr}`);
            seen.add(key);
        }
        // дубль или запрещённый ключ — молча пропускаем
    }
    return parts.join(', ');
}

// Пропускает одно JSON-значение начиная с позиции i, возвращает позицию после него
function skipValue(s, i) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return i;
    const c = s[i];
    if (c === '"') {
        i++;
        let esc = false;
        while (i < s.length) {
            const ch = s[i++];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') break;
        }
        return i;
    }
    if (c === '{' || c === '[') {
        const close = c === '{' ? '}' : ']';
        let depth = 0, inStr = false, esc = false;
        while (i < s.length) {
            const ch = s[i++];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === c) depth++;
            else if (ch === close) { depth--; if (depth === 0) break; }
        }
        return i;
    }
    // null, true, false, number
    while (i < s.length && !/[\s,}\]]/.test(s[i])) i++;
    return i;
}

// Удаляет из корневого объекта ключи не входящие в allowedSet
function removeExtraRootKeys(s, allowedSet) {
    const rootStart = s.indexOf('{');
    if (rootStart === -1) return s;
    // Находим конец корневого объекта
    let depth = 0, inStr = false, esc = false, rootEnd = -1;
    for (let i = rootStart; i < s.length; i++) {
        const c = s[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { rootEnd = i; break; } }
    }
    if (rootEnd === -1) return s;
    const inner = s.substring(rootStart + 1, rootEnd);
    const filtered = filterKeysByAllowlist(inner, allowedSet);
    return s.substring(0, rootStart + 1) + filtered + s.substring(rootEnd);
}

function filterKeysByAllowlist(inner, allowedSet) {
    const parts = [];
    let i = 0;
    while (i < inner.length) {
        while (i < inner.length && /[\s,]/.test(inner[i])) i++;
        if (i >= inner.length) break;
        if (inner[i] !== '"') { i++; continue; }
        i++;
        let key = '', esc = false;
        while (i < inner.length) {
            const c = inner[i++];
            if (esc) { esc = false; key += c; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') break;
            key += c;
        }
        while (i < inner.length && /[\s:]/.test(inner[i])) i++;
        const valStart = i;
        i = skipValue(inner, i);
        const valStr = inner.substring(valStart, i).trim();
        if (allowedSet.has(key)) {
            parts.push(`"${key}": ${valStr}`);
        }
    }
    return parts.join(', ');
}

function parseJSON(text, contextTitle = 'LLM Ответ') {
    if (!text) return null;
    if (typeof addSystemLog === 'function') addSystemLog(contextTitle + ' (Сырой текст)', text, false);

    // Попытка 1: прямой парсинг
    try { return JSON.parse(text); } catch (_) {}

    // Попытка 2: санитайзер + парсинг
    try {
        const sanitized = sanitizeJSON(text);
        const result = JSON.parse(sanitized);
        if (typeof addSystemLog === 'function')
            addSystemLog(contextTitle + ' (Парсинг после санитайзера)', 'OK', false);
        return result;
    } catch (e2) {
        // Попытка 3: найти первый валидный JSON-объект в тексте (как раньше)
        try {
            const clean = sanitizeJSON(text);
            const startIdx = clean.indexOf('{');
            if (startIdx === -1) throw new Error('No JSON object found');
            let braceCount = 0, endIdx = -1;
            let inStr = false, esc = false;
            for (let i = startIdx; i < clean.length; i++) {
                const c = clean[i];
                if (esc)       { esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (c === '{') braceCount++;
                else if (c === '}') { braceCount--; if (braceCount === 0) { endIdx = i; break; } }
            }
            if (endIdx === -1) throw new Error('Unbalanced JSON');
            return JSON.parse(clean.substring(startIdx, endIdx + 1));
        } catch (e3) {
            console.error('JSON parse error:', e3, text.substring(0, 300));
            if (typeof addSystemLog === 'function')
                addSystemLog('Ошибка парсинга JSON (' + contextTitle + ')', text, true);
            return null;
        }
    }
}

function renderMarkdown(text) {
    if (!text) return '';
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    html = html
        .replace(/^---+$/gm, '<hr>')
        .replace(/^\*\*\*+$/gm, '<hr>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/<\/blockquote>\n<blockquote>/g, '\n')
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^[\-•] (.+)$/gm, '<li>$1</li>')
        .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    const paragraphs = html.split(/\n{2,}/).map((p) => {
        p = p.trim();
        if (!p) return '';
        if (/^<(h[1-3]|hr|blockquote|ul|ol|div|li)/.test(p)) return p.replace(/\n/g, '<br>');
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    });
    return paragraphs.join('\n');
}

function escapeHTML(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

let toastTimer = null;
function showToast(message, kind = 'success') {
    if (!els.appToast) return;
    window.clearTimeout(toastTimer);
    els.appToast.textContent = message;
    els.appToast.dataset.kind = kind;
    els.appToast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => {
        els.appToast.classList.remove('is-visible');
    }, 2600);
}

function setToggleSelected(button, selected) {
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
}

function uiIcon(name, label = '') {
    const safeName = String(name || 'pin').replace(/[^a-z0-9_-]/gi, '') || 'pin';
    const title = label ? ` aria-label="${escapeHTML(label)}" role="img"` : ' aria-hidden="true"';
    return `<svg class="ui-icon"${title} focusable="false"><use href="#icon-${safeName}"></use></svg>`;
}

const STAT_VISUALS = {
    mind: { icon: 'brain', short: 'мышление' },
    body: { icon: 'body', short: 'сила и ловкость' },
    family: { icon: 'home', short: 'дом и опора' },
    friends: { icon: 'users', short: 'свои люди' },
    health: { icon: 'health', short: 'самочувствие' },
    looks: { icon: 'sparkle', short: 'впечатление' },
    wealth: { icon: 'money', short: 'деньги и быт' },
    authority: { icon: 'crown', short: 'вес во дворе' }
};

function getStatClass(value) {
    const dist = Math.abs(value - 5);
    if (dist === 0) return 'val-norm';
    if (dist === 1) return 'val-flavor';
    if (dist === 2) return 'val-skew';
    if (dist === 3) return 'val-bad';
    return 'val-crit';
}

function getStatDescriptor(value) {
    if (value <= 1) return 'крайняя точка';
    if (value <= 3) return 'опасный перекос';
    if (value === 4) return 'лёгкая трещина';
    if (value === 5) return 'условная норма';
    if (value === 6) return 'заметный сдвиг';
    if (value <= 8) return 'тревожный избыток';
    return 'почти катастрофа';
}

function pluralizeRu(number, forms) {
    const mod10 = number % 10;
    const mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
}

function getStatusRingColor(value) {
    const distance = Math.abs(value - 5);
    if (distance === 0) return 'var(--moss)';
    if (distance === 1) return 'var(--amber)';
    if (distance === 2) return 'var(--amber-deep)';
    return 'var(--rust)';
}

function buildStatusRingGradient(stats) {
    const keys = Object.keys(STAT_VISUALS);
    const wedge = 360 / keys.length;
    const gap = 2.2;
    const stops = [];
    keys.forEach((key, index) => {
        const start = index * wedge;
        const end = (index + 1) * wedge;
        stops.push(`transparent ${start}deg ${start + gap}deg`);
        stops.push(`${getStatusRingColor(stats[key] ?? 5)} ${start + gap}deg ${end - gap}deg`);
        stops.push(`transparent ${end - gap}deg ${end}deg`);
    });
    return `conic-gradient(from -22.5deg, ${stops.join(', ')})`;
}

function renderStatusGraphic() {
    const entries = Object.entries(state.stats)
        .filter(([key]) => STATS_INFO[key])
        .map(([key, value]) => ({ key, value, distance: Math.abs(value - 5) }))
        .sort((a, b) => b.distance - a.distance);
    if (!entries.length) return;

    const maxDistance = entries[0].distance;
    const attention = entries.filter((entry) => entry.distance >= 2);
    const risks = entries.filter((entry) => entry.distance >= 3);
    const tone = maxDistance >= 4 ? 'critical' : maxDistance >= 3 ? 'danger' : maxDistance >= 2 ? 'watch' : 'balanced';
    const title = {
        balanced: maxDistance === 0 ? 'Полный баланс' : 'Ровный период',
        watch: 'Баланс смещён',
        danger: 'Нужна осторожность',
        critical: 'Критическая грань'
    }[tone];
    const brief = attention.length
        ? `${attention.length} ${pluralizeRu(attention.length, ['отклонение', 'отклонения', 'отклонений'])}`
        : 'всё близко к балансу';
    const focusNames = attention.slice(0, 2).map((entry) => STATS_INFO[entry.key].name.toLowerCase());
    const summary = focusNames.length
        ? `${focusNames.join(' и ')} дальше всего от отметки 5.`
        : 'Все восемь показателей находятся рядом с отметкой 5.';
    const riskText = risks.length
        ? `${risks.length} ${pluralizeRu(risks.length, ['зона риска', 'зоны риска', 'зон риска'])}`
        : 'критических рисков нет';
    const gradient = buildStatusRingGradient(state.stats);
    const avatarHref = state.gender === 'female' ? '#icon-girl' : '#icon-child';

    [els.statusMiniRing, els.dossierBalanceRing].forEach((ring) => {
        ring?.style.setProperty('--status-ring', gradient);
        ring?.setAttribute('data-tone', tone);
    });
    els.statusAvatarUse?.setAttribute('href', avatarHref);
    els.dossierAvatarUse?.setAttribute('href', avatarHref);
    els.gameStatusBtn?.setAttribute('data-tone', tone);
    els.gameStatusBtn?.setAttribute('aria-label', `Открыть состояние героя. ${title}. ${brief}.`);
    if (els.gameStatusBrief) els.gameStatusBrief.textContent = brief;
    if (els.dossierSummaryTitle) els.dossierSummaryTitle.textContent = title;
    if (els.dossierSummaryText) els.dossierSummaryText.textContent = summary;
    if (els.dossierRiskCount) els.dossierRiskCount.textContent = riskText;
}

function buildChoiceMarkup(choice, index = 0) {
    const label = choice.text || choice.action || `Выбор ${index + 1}`;
    return `
        <span class="choice-btn__index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        <span class="choice-btn__body choice-btn__body--single">
            <span class="choice-btn__title">${escapeHTML(label)}</span>
        </span>
        <span class="choice-btn__arrow" aria-hidden="true">→</span>
    `;
}

function applyVisualMood(screen = (els.game.classList.contains('hidden') ? 'setup' : 'game')) {
    const seasonMap = ['winter', 'spring', 'summer', 'autumn'];
    document.body.dataset.season = seasonMap[state.seasonIdx] || 'winter';
    document.body.dataset.provider = getActiveProvider();
    document.body.dataset.difficulty = state.difficulty || 'normal';
    document.body.dataset.locationType = state.locationType || 'capital';
    document.body.dataset.screen = screen;
}

function cloneData(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : null;
}

function getDateLabel(seasonIdx = state.seasonIdx, year = state.year) {
    return `${SEASONS[seasonIdx]} ${year}`;
}

function buildArchiveStoryMarkup(entry) {
    if (!entry) return renderMarkdown(state.lastStory || '');
    let html = renderMarkdown(entry.storyEnhanced || entry.storyOriginal || entry.story || '');



    if (ILLUSTRATIONS_ENABLED && entry) {
        if (entry.illustrationStatus === 'loading') {
            html += `
                <div class="illustration-box illustration-box--loading">
                    <div class="illustration-spinner"></div>
                    <div class="illustration-text">${uiIcon('film')} Проявляется набросок воспоминания...</div>
                </div>
            `;
        } else if (entry.illustrationStatus === 'success' && entry.illustration) {
            html += `
                <div class="illustration-box">
                    <img src="${entry.illustration}" class="illustration-img" alt="Иллюстрация к событию" onclick="openIllustrationModal('${entry.illustration}')" style="cursor: zoom-in;" />
                    <button type="button" class="illustration-btn" onclick="downloadIllustration('${escapeHTML(entry.dateLabel || '')}', '${entry.illustration}')">${uiIcon('copy')} Скачать рисунок</button>
                </div>
            `;
        } else if (entry.illustrationStatus === 'limit_reached') {
            html += `
                <div class="illustration-box illustration-box--limit">
                    <div class="illustration-text">${uiIcon('film')} Лимит иллюстраций на сегодня исчерпан (макс. 20 в сутки).</div>
                </div>
            `;
        } else if (entry.illustrationStatus === 'failed') {
            html += `
                <div class="illustration-box illustration-box--failed">
                    <div class="illustration-text">${uiIcon('refresh')} Не удалось воссоздать рисунок воспоминания.</div>
                    <button class="btn" style="margin-top:0.5rem;" onclick="window.retryGenImg('${entry.turn}')">Попробовать снова</button>
                </div>
            `;
        } else if (!entry.illustrationStatus || entry.illustrationStatus === 'pending') {
            html += `
                <div class="illustration-box illustration-box--pending" id="img-pending-${entry.turn}" style="background:var(--surface-1); padding: 1rem; border-radius:8px; border: 1px dashed var(--border); margin-top:1rem;">
                    <div style="font-weight:600; margin-bottom:0.5rem;">${uiIcon('sparkle')} Создать визуальное воспоминание</div>
                    <div style="margin-bottom:0.5rem; font-size:0.9em; color:var(--muted);">Выберите стиль:</div>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;" id="img-style-group-${entry.turn}">
                        <button type="button" class="option-btn selected" style="flex:1;" onclick="window.selectImgStyle('${entry.turn}', 'photo', this)">${uiIcon('film')} Фотография</button>
                        <button type="button" class="option-btn" style="flex:1;" onclick="window.selectImgStyle('${entry.turn}', 'book', this)">${uiIcon('book')} Книжная</button>
                        <button type="button" class="option-btn" style="flex:1;" onclick="window.selectImgStyle('${entry.turn}', 'child', this)">${uiIcon('child')} Детская</button>
                    </div>
                    <input type="hidden" id="img-style-val-${entry.turn}" value="photo">
                    <div style="display:flex; gap:1rem; font-size:0.9em; color:var(--muted); align-items:center; margin-bottom: 1rem;">
                        <span>Текста в промпт (абзацы):</span>
                        <label><input type="radio" name="img_paras_${entry.turn}" value="3"> 3</label>
                        <label><input type="radio" name="img_paras_${entry.turn}" value="5" checked> 5</label>
                        <label><input type="radio" name="img_paras_${entry.turn}" value="7"> 7</label>
                    </div>
                    <button type="button" class="btn primary" style="width: 100%;" onclick="window.startGenImgUI('${entry.turn}')">Начать создание иллюстрации</button>
                </div>
            `;
        }
    }

    if (entry.miracleStory) {
        html += `<hr><div class="miracle-banner"><h2>${uiIcon('sparkle')} ЧУДЕСНОЕ СПАСЕНИЕ</h2><p>Судьба смилостивилась...</p></div>`;
        html += renderMarkdown(entry.miracleStory);
    }
    if (entry.gameOverData) {
        const god = entry.gameOverData;
        html += `<hr><div class="game-over-banner"><h2>${uiIcon('skull')} GAME OVER</h2><p>${escapeHTML(entry.dateLabel || '')}, ${escapeHTML(String(entry.age || ''))} лет</p></div>`;
        html += `<h2 style="color:var(--accent);">${uiIcon('sparkle')} Эпилог</h2>${renderMarkdown(god.epilogue || '')}`;
        html += `<div class="game-over-reasons"><strong>Что привело:</strong><ul>${(god.reasons || []).map((r) => `<li>${escapeHTML(r)}</li>`).join('')}</ul></div>`;
        html += renderMarkdown(`> "${god.epitaph || ''}"`);
    }
    return html;
}

function getSelectedArchiveEntry() {
    if (!state.archiveEntries?.length) return null;
    if (state.archiveViewIndex === null || state.archiveViewIndex === undefined) {
        return state.archiveEntries[state.archiveEntries.length - 1] || null;
    }
    return state.archiveEntries[state.archiveViewIndex] || null;
}

function isArchiveMode() {
    return state.archiveViewIndex !== null && state.archiveViewIndex !== undefined;
}

function advanceTimeSnapshot(snapshot) {
    if (snapshot.pace === 'year') {
        snapshot.year += 1;
        snapshot.age += 1;
        snapshot.seasonIdx = (snapshot.seasonIdx + 3) % 4;
    } else {
        snapshot.seasonIdx += 1;
        if (snapshot.seasonIdx > 3) {
            snapshot.seasonIdx = 0;
            snapshot.year += 1;
            snapshot.age += 1;
        }
    }
}

function backfillArchiveEntriesFromHistory() {
    if (state.archiveEntries?.length || !state.enhancedHistory?.length) return;
    const snapshot = {
        year: 1993,
        seasonIdx: 0,
        age: state.startAge || state.age || 7,
        pace: state.pace || 'season'
    };
    state.archiveEntries = state.enhancedHistory.map((story, index) => {
        advanceTimeSnapshot(snapshot);
        return {
            turn: index + 1,
            dateLabel: getDateLabel(snapshot.seasonIdx, snapshot.year),
            seasonIdx: snapshot.seasonIdx,
            year: snapshot.year,
            age: snapshot.age,
            storyEnhanced: story,
            storyOriginal: state.originalHistory?.[index] || story,
            action: null,
            miracleStory: null,
            gameOverData: null
        };
    });
    if (state.archiveEntries.length) {
        const last = state.archiveEntries[state.archiveEntries.length - 1];
        if (state.lastMiracle) last.miracleStory = state.lastMiracle;
        if (state.gameOverData) last.gameOverData = cloneData(state.gameOverData);
    }
    if (state.archiveViewIndex === undefined) state.archiveViewIndex = null;
}

function pushArchiveEntry(entry) {
    if (!state.archiveEntries) state.archiveEntries = [];
    state.archiveEntries.push(entry);
    state.archiveViewIndex = null;
}

function renderArchiveStrip() {
    if (!els.archiveStrip) return;
    const entries = state.archiveEntries || [];
    const hasArchive = entries.length > 0;
    els.archiveStrip.style.display = hasArchive ? 'flex' : 'none';
    if (!hasArchive) return;

    const entry = getSelectedArchiveEntry();
    const isArchive = isArchiveMode();
    const currentIndex = isArchive ? state.archiveViewIndex : entries.length - 1;
    const position = currentIndex + 1;
    const firstEntry = entries[0];
    const lastEntry = entries[entries.length - 1];
    const firstDate = firstEntry?.dateLabel || '';
    const lastDate = lastEntry?.dateLabel || '';

    els.archiveLabel.textContent = `Запись ${position} из ${entries.length} · ${isArchive ? 'архив' : 'сейчас'}`;
    els.archiveRange.textContent = firstDate && lastDate
        ? `Хроника: ${firstDate}${firstDate !== lastDate ? ` — ${lastDate}` : ''}`
        : 'Личная хроника';
    els.archiveLabel.title = els.archiveLabel.textContent;
    els.archiveRange.title = els.archiveRange.textContent;
    els.archivePrevBtn.disabled = currentIndex <= 0;
    els.archiveNextBtn.disabled = !isArchive;
    els.archiveCurrentBtn.disabled = !isArchive;
    els.archiveCopyBtn.disabled = !entry;
}

function setArchiveView(index = null) {
    state.archiveViewIndex = index;
    save();
    renderUI();
}

async function copyArchiveEntryToClipboard(entry) {
    if (!entry) return;
    const locInfo = getLocationInfo();
    let text = `=== ${entry.dateLabel || ''} ===\n`;
    text += `Персонаж: ${GENDER_INFO[state.gender].name}, ${entry.age || state.age} лет\n`;
    text += `Локация: ${locInfo.fullName}\n\n`;
    if (entry.action) text += `Выбор: ${entry.action}\n\n`;
    text += `${entry.storyEnhanced || entry.story || ''}`;
    if (entry.miracleStory) text += `\n\n[Чудесное спасение]\n${entry.miracleStory}`;
    if (entry.gameOverData?.epilogue) text += `\n\n[Эпилог]\n${entry.gameOverData.epilogue}`;
    await navigator.clipboard.writeText(text);
}

// ========== СВОДКА ВЫБОРОВ НА ФИНАЛЬНОМ ШАГЕ ==========
function renderStartSummary() {
    const el = document.getElementById('start-summary');
    if (!el) return;
    const locInfo = getLocationInfo();
    const gender = GENDER_INFO[state.gender]?.name || state.gender;
    const pace = state.pace === 'year' ? 'темп: по годам' : 'темп: по сезонам';
    const diff = state.difficulty === 'hardcore' ? 'сложность: хардкор' : 'сложность: норма';
    const chips = [
        { icon: 'child', text: gender },
        { icon: 'book', text: `${state.startAge} лет` },
        { icon: locInfo.icon || 'pin', text: locInfo.fullName },
        { icon: 'film', text: pace },
        { icon: 'theatre', text: diff }
    ];
    el.innerHTML = chips
        .map((c) => `<span class="start-summary__chip">${uiIcon(c.icon)} ${escapeHTML(c.text)}</span>`)
        .join('');
}

// ========== ОНБОРДИНГ ПЕРВОГО ХОДА ==========
const ONBOARDING_KEY = 'rpg90_onboarded';
function maybeShowOnboarding() {
    const slot = document.getElementById('onboarding-slot');
    if (!slot || slot.childElementCount > 0) return;
    try {
        if (localStorage.getItem(ONBOARDING_KEY)) return;
    } catch { /* ignore */ }
    slot.innerHTML = `
        <div class="onboarding-card">
            <div class="onboarding-card__title">${uiIcon('sparkle')} Как читать эту историю</div>
            <p>В панели «Состояние героя» восемь шкал от 0 до 10: 5 — условная норма, а любая крайность имеет свою цену. После каждого хода выбирай один из вариантов — они и сдвигают шкалы. Полоса над историей хранит архив прошедших периодов.</p>
            <button type="button" class="control-btn onboarding-card__close">Понятно, начинаем</button>
        </div>
    `;
    slot.querySelector('.onboarding-card__close')?.addEventListener('click', () => {
        slot.innerHTML = '';
        try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch { /* ignore */ }
    });
}

function setupLoaderCancel() {
    document.getElementById('loader-cancel-btn')?.addEventListener('click', cancelCurrentTurn);
}

function renderSetupWizard() {
    const steps = document.querySelectorAll('.setup-step');
    const lastIndex = SETUP_STEPS.length - 1;
    const safeIndex = Math.max(0, Math.min(lastIndex, setupStepIndex));
    setupStepIndex = safeIndex;
    steps.forEach((step, index) => {
        const group = Number(step.dataset.wizardGroup ?? step.dataset.step ?? index);
        const visible = group === safeIndex;
        step.classList.toggle('active', visible);
        step.classList.toggle('hidden', !visible);
    });
    const meta = SETUP_STEPS[safeIndex];
    if (els.setupStepTitle) els.setupStepTitle.textContent = meta.title;
    if (els.setupStepCaption) els.setupStepCaption.textContent = meta.caption;
    const isReview = safeIndex === lastIndex;
    if (els.setupStepCounter) {
        els.setupStepCounter.textContent = isReview ? 'Настройка завершена' : `Шаг ${safeIndex + 1} из ${SETUP_STEP_COUNT}`;
    }
    if (els.setupStepHintBadge) els.setupStepHintBadge.textContent = meta.badge;
    if (els.setupProgressFill) {
        els.setupProgressFill.style.width = `${(Math.min(safeIndex + 1, SETUP_STEP_COUNT) / SETUP_STEP_COUNT) * 100}%`;
    }
    document.querySelectorAll('[data-progress-step]').forEach((step) => {
        const index = Number(step.dataset.progressStep);
        step.classList.toggle('is-current', index === safeIndex);
        step.classList.toggle('is-complete', index < safeIndex);
    });
    if (els.setupPrevBtn) els.setupPrevBtn.disabled = safeIndex === 0;
    if (els.setupNextBtn) {
        els.setupNextBtn.style.display = isReview ? 'none' : 'inline-flex';
        els.setupNextBtn.textContent = safeIndex === SETUP_STEP_COUNT - 1 ? 'Проверить героя' : 'Дальше';
    }
    if (els.startBtn) {
        els.startBtn.style.display = safeIndex === lastIndex ? 'inline-flex' : 'none';
    }
    renderStartSummary();
}

function openSettingsModal() {
    if (!els.settingsModal) return;
    syncSettingsVerbosityBtns();
    syncReadingModeControls();
    openOverlay(els.settingsModal, els.settingsCloseBtn);
}

function closeSettingsModal() {
    closeOverlay(els.settingsModal);
}

function syncSettingsVerbosityBtns() {
    // Синхронизирует кнопки verbosity в модалке настроек с текущим state.verbosity
    const btns = document.querySelectorAll('#settings-verbosity-btns .option-btn');
    btns.forEach((button) => setToggleSelected(button, button.dataset.value === state.verbosity));
    // Обновляем info-блок
    const info = document.getElementById('settings-verbosity-info');
    if (info) {
        const map = {
            concise:  '<strong>Лаконично:</strong> короткие ходы, только суть. Лимит ответа — 3 500 токенов.',
            normal:   '<strong>Обычно:</strong> сбалансированный объём текста, живые детали без излишеств. Лимит — 5 000 токенов.',
            detailed: '<strong>Подробно:</strong> развёрнутые описания, диалоги, неожиданная деталь при смене сезона. Лимит — 6 500 токенов.',
        };
        info.innerHTML = map[state.verbosity] || map.normal;
    }
}


function areAdminToolsEnabled() {
    try { return localStorage.getItem(ADMIN_TOOLS_STORAGE_KEY) === 'true'; }
    catch { return false; }
}

function setAdminToolsEnabled(enabled) {
    const active = Boolean(enabled);
    document.body.classList.toggle('admin-tools-enabled', active);
    const toggle = document.getElementById('admin-tools-toggle');
    if (toggle) toggle.checked = active;
    try { localStorage.setItem(ADMIN_TOOLS_STORAGE_KEY, String(active)); } catch {}
}

function setupSettingsModal() {
    els.setupSettingsBtn?.addEventListener('click', openSettingsModal);
    els.gameSettingsBtn?.addEventListener('click', openSettingsModal);
    els.settingsCloseBtn?.addEventListener('click', closeSettingsModal);
    els.settingsBackdrop?.addEventListener('click', closeSettingsModal);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && getTopDialogRoot() === els.settingsModal) {
            event.preventDefault();
            closeSettingsModal();
        }
    });

    setAdminToolsEnabled(areAdminToolsEnabled());
    document.getElementById('admin-tools-toggle')?.addEventListener('change', (event) => {
        setAdminToolsEnabled(event.target.checked);
    });

    // ── Табы внутри модалки настроек ──
    const settingsTabs = [...document.querySelectorAll('.settings-tab-btn')];
    const activateSettingsTab = (target, moveFocus = false) => {
        settingsTabs.forEach((button) => {
            const selected = button.dataset.stab === target;
            button.classList.toggle('selected', selected);
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && moveFocus) button.focus();
        });
        document.querySelectorAll('.settings-tab-panel').forEach((panel) => {
            const selected = panel.id === 'stab-' + target;
            panel.classList.toggle('hidden', !selected);
            panel.setAttribute('aria-hidden', String(!selected));
        });
    };

    settingsTabs.forEach((button, index) => {
        button.addEventListener('click', () => activateSettingsTab(button.dataset.stab));
        button.addEventListener('keydown', (event) => {
            let nextIndex = null;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % settingsTabs.length;
            if (event.key === 'ArrowLeft') nextIndex = (index - 1 + settingsTabs.length) % settingsTabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = settingsTabs.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            activateSettingsTab(settingsTabs[nextIndex].dataset.stab, true);
        });
    });
    activateSettingsTab(settingsTabs.find((button) => button.classList.contains('selected'))?.dataset.stab || 'connection');

    // ── Локальные режимы чтения: не входят в игровое сохранение. ──
    document.querySelectorAll('#settings-reading-mode-btns .option-btn').forEach((button) => {
        button.addEventListener('click', () => applyReadingMode(button.dataset.readingMode));
    });

    // ── Кнопки verbosity в модалке настроек ──
    document.querySelectorAll('#settings-verbosity-btns .option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.verbosity = btn.dataset.value;
            syncSettingsVerbosityBtns();
            // Синхронизируем кнопки в визарде (если открыт)
            document.querySelectorAll('#verbosity-btns .option-btn').forEach((button) =>
                setToggleSelected(button, button.dataset.value === state.verbosity));
            updateVerbosityInfo(state.verbosity);
            if (hasActiveRun()) save();
        });
    });

    // ── Переключатель модели полировки в модалке настроек ──
    document.querySelectorAll('#settings-enhance-model-btns .option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.enhanceModel = btn.dataset.value;
                    renderProviderSwitcher();
            if (hasActiveRun()) save();
        });
    });
}

function setupArchiveControls() {
    els.archivePrevBtn?.addEventListener('click', () => {
        if (!state.archiveEntries?.length) return;
        // Из текущего периода сразу уходим на действительно предыдущий,
        // а не открываем тот же самый ход под ярлыком «архив».
        if (!isArchiveMode()) setArchiveView(Math.max(0, state.archiveEntries.length - 2));
        else if (state.archiveViewIndex > 0) setArchiveView(state.archiveViewIndex - 1);
    });
    els.archiveNextBtn?.addEventListener('click', () => {
        if (!isArchiveMode()) return;
        if (state.archiveViewIndex < state.archiveEntries.length - 1) setArchiveView(state.archiveViewIndex + 1);
        else setArchiveView(null);
    });
    els.archiveCurrentBtn?.addEventListener('click', () => setArchiveView(null));
    els.archiveCopyBtn?.addEventListener('click', async () => {
        try {
            await copyArchiveEntryToClipboard(getSelectedArchiveEntry());
            showToast('Период скопирован');
        } catch (e) {
            console.error('Archive copy error:', e);
            showToast('Не удалось скопировать период', 'error');
        }
    });
}

function setLoading(value, message = 'Пожалуйста, подождите. Ветер перемен наполняет паруса истории...') {
    // Инлайн-лоадер под историей: текст хода остаётся на экране и читаемым,
    // полноэкранный оверлей больше не блокирует интерфейс.
    if (els.loader) {
        els.loader.classList.toggle('is-hidden', !value);
    }
    if (els.loaderMessage && value) {
        els.loaderMessage.textContent = message;
    }
    document.querySelectorAll('.choice-btn').forEach((btn) => {
        btn.disabled = value;
    });
    document.body.classList.toggle('is-loading', value);
}

function isLoading() {
    return els.loader ? !els.loader.classList.contains('is-hidden') : false;
}

function save() {
    try {
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            console.warn('Quota exceeded, pruning older illustrations...');
            if (state.archiveEntries) {
                for (let i = 0; i < state.archiveEntries.length; i++) {
                    if (state.archiveEntries[i].illustration) {
                        delete state.archiveEntries[i].illustration;
                        delete state.archiveEntries[i].illustrationStatus;
                        try {
                            localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
                            console.log('Saved successfully after pruning an older illustration.');
                            return;
                        } catch (err) {}
                    }
                }
            }
        }
        console.error('Save error:', e);
    }
}

window.resetGame = () => {
    localStorage.removeItem(STATE_STORAGE_KEY);
    location.reload();
};

function closeResetConfirmation() {
    closeOverlay(els.resetConfirmModal);
}

window.requestResetGame = () => {
    if (!els.resetConfirmModal) {
        if (window.confirm('Сбросить текущую историю? Это действие нельзя отменить.')) window.resetGame();
        return;
    }
    openOverlay(els.resetConfirmModal, els.resetCancelBtn);
};

function setupResetConfirmation() {
    els.resetCancelBtn?.addEventListener('click', closeResetConfirmation);
    els.resetConfirmBackdrop?.addEventListener('click', closeResetConfirmation);
    els.resetConfirmBtn?.addEventListener('click', () => window.resetGame());
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && getTopDialogRoot() === els.resetConfirmModal) {
            event.preventDefault();
            closeResetConfirmation();
        }
    });
}

function isLocalEnvironment() {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function hasActiveRun() {
    return state.history.length > 0 || !els.game.classList.contains('hidden');
}

// ========== ПРОВАЙДЕРЫ LLM ==========
function getActiveProvider() {
    return LLM_PROVIDERS[state.provider] ? state.provider : DEFAULT_PROVIDER;
}

function getProviderConfig(provider = getActiveProvider()) {
    return LLM_PROVIDERS[provider] || LLM_PROVIDERS[DEFAULT_PROVIDER];
}

function getProviderModel(kind = 'main', provider = getActiveProvider()) {
    const cfg = getProviderConfig(provider);
    if (kind === 'enhance') return state.enhanceModel || cfg.models.enhance || MODEL;
    return cfg.models?.[kind] || cfg.models.main || MODEL;
}

function resolveExecutionProvider(kind = 'main', provider = getActiveProvider()) {
    const cfg = getProviderConfig(provider);
    return cfg.executionProviders?.[kind] || cfg.executionProviders?.main || provider;
}

function syncCurrentApiKey() {
    userApiKey = userApiKeys[getActiveProvider()] || null;
}

function loadStoredApiKeys() {
    userApiKeys.hydra = localStorage.getItem(LLM_PROVIDERS.hydra.storageKey) || localStorage.getItem(LEGACY_KEY_STORAGE) || '';
    userApiKeys.openrouter = localStorage.getItem(LLM_PROVIDERS.openrouter?.storageKey) || '';
}

function saveApiKey(provider, key) {
    const cfg = getProviderConfig(provider);
    if (provider === 'hybrid') {
        syncCurrentApiKey();
        return;
    }
    userApiKeys[provider] = key || '';
    if (cfg.storageKey) localStorage.setItem(cfg.storageKey, key || '');
    if (provider === 'hydra') {
        localStorage.setItem(LEGACY_KEY_STORAGE, key || '');
    }
    syncCurrentApiKey();
}

function updateApiKeyInput() {
    const provider = getActiveProvider();
    const cfg = getProviderConfig(provider);
    if (els.apiProviderTitle) {
        els.apiProviderTitle.innerHTML = `${uiIcon('plug')} API ключ — ${escapeHTML(cfg.label)}`;
    }
    if (els.apiKeyHint) {
        els.apiKeyHint.textContent = 'Ключ Hydra хранится в переменных окружения Vercel (HYDRA_API_KEY). Поле ниже не нужно.';
    }
    if (els.keyInput) {
        els.keyInput.value = '';
        els.keyInput.placeholder = 'Ключ задаётся в Vercel env';
        els.keyInput.disabled = true;
    }
}

function renderProviderSwitcher() {
    const provider = getActiveProvider();
    const cfg = getProviderConfig(provider);
    const mainExec = resolveExecutionProvider('main', provider);
    const enhanceExec = resolveExecutionProvider('enhance', provider);
    const mainExecCfg = getProviderConfig(mainExec);
    const enhanceExecCfg = getProviderConfig(enhanceExec);
    const enhanceModel = getProviderModel('enhance', provider);
    document.querySelectorAll('.provider-btn').forEach((button) => {
        setToggleSelected(button, button.dataset.provider === provider);
    });
    document.querySelectorAll('[data-provider-models]').forEach((el) => {
        el.innerHTML = `
            <div><strong>${uiIcon(cfg.icon)} ${cfg.label}</strong></div>
            <div>Модель: <code>glm-5.2</code></div>
            <div class="provider-hint">Gemini на Hydra пока недоступен.</div>
        `;
    });
    document.querySelectorAll('#settings-enhance-model-btns .option-btn').forEach((button) => {
        const isGemini = button.dataset.value === 'gemini-3.1-pro';
        button.disabled = isGemini;
        button.style.opacity = isGemini ? '0.4' : '';
        button.style.filter = isGemini ? 'grayscale(1)' : '';
        button.title = isGemini ? 'Gemini на Hydra пока недоступен' : '';
        setToggleSelected(button, button.dataset.value === 'glm-5.2');
    });
}

function switchProvider(nextProvider) {
    if (!LLM_PROVIDERS[nextProvider]) return;
    if (nextProvider === state.provider) return;
    if (isLoading()) return;
    state.provider = nextProvider;
    persistProviderChoice(nextProvider);
    syncCurrentApiKey();
    updateApiKeyInput();
    renderProviderSwitcher();
    applyVisualMood(hasActiveRun() ? 'game' : 'setup');
    if (hasActiveRun()) {
        save();
        renderUI();
    }
}

function setupProviderSwitcher() {
    document.querySelectorAll('.provider-btn').forEach((btn) => {
        btn.onclick = () => switchProvider(btn.dataset.provider);
    });
}

// ========== ФУНКЦИИ ГЕНЕРАЦИИ NPC И ПРЕДМЕТОВ ==========
function generateRandomNPCs(locationType, region = null, city = null) {
    const availablePools = [];
    if (locationType === 'capital' && NPC_POOLS.capital) availablePools.push(NPC_POOLS.capital);
    else if (locationType === 'town' && NPC_POOLS.town) availablePools.push(NPC_POOLS.town);
    else if (locationType === 'village' && NPC_POOLS.village) availablePools.push(NPC_POOLS.village);
    if (region && (locationType === 'town' || locationType === 'capital')) {
        if (NPC_POOLS.regions?.[region]?.town) availablePools.push(NPC_POOLS.regions[region].town);
    }
    if (region && locationType === 'village') {
        if (NPC_POOLS.regions?.[region]?.village) availablePools.push(NPC_POOLS.regions[region].village);
    }
    if (locationType === 'capital' && city && NPC_POOLS.cities?.[city]) {
        availablePools.push(NPC_POOLS.cities[city]);
    }
    const result = [];
    const usedDescs = new Set();
    function pickFromPools(category) {
        const options = [];
        for (const pool of availablePools) {
            if (pool[category]) options.push(...pool[category]);
        }
        const fresh = options.filter((opt) => !usedDescs.has(opt.desc));
        return fresh.length ? pick(fresh) : null;
    }
    if (rollChance(90)) {
        const m = pickFromPools('mothers');
        if (m) { result.push({ ...m }); usedDescs.add(m.desc); }
    }
    if (rollChance(70)) {
        const d = pickFromPools('fathers');
        if (d) { result.push({ ...d }); usedDescs.add(d.desc); }
    }
    const hasParent = result.length > 0;
    if (!hasParent) {
        const gp = pickFromPools('grandparents');
        if (gp) { result.push({ ...gp }); usedDescs.add(gp.desc); }
    }
    if (rollChance(60)) {
        const gp = pickFromPools('grandparents');
        if (gp) { result.push({ ...gp }); usedDescs.add(gp.desc); }
    }
    if (rollChance(30)) {
        const gp = pickFromPools('grandparents');
        if (gp) { result.push({ ...gp }); usedDescs.add(gp.desc); }
    }
    if (rollChance(50)) {
        const s = pickFromPools('siblings');
        if (s) { result.push({ ...s }); usedDescs.add(s.desc); }
    }
    if (rollChance(25)) {
        const s = pickFromPools('siblings');
        if (s) { result.push({ ...s }); usedDescs.add(s.desc); }
    }
    if (rollChance(70)) {
        const f = pickFromPools('friends');
        if (f) { result.push({ ...f }); usedDescs.add(f.desc); }
    }
    if (rollChance(40)) {
        const f = pickFromPools('friends');
        if (f) { result.push({ ...f }); usedDescs.add(f.desc); }
    }
    if (rollChance(50)) {
        const n = pickFromPools('neighbors');
        if (n) { result.push({ ...n }); usedDescs.add(n.desc); }
    }
    if (rollChance(45)) {
        const a = pickFromPools('animals');
        if (a) { result.push({ ...a }); usedDescs.add(a.desc); }
    }
    return result;
}

function generateRandomItems(locationType, gender, region = null, city = null) {
    console.log('=== Генерация предметов ===', { locationType, gender, region, city });
    let allItems = [];
    if (locationType === 'capital' && ITEM_POOLS.capital) {
        allItems = allItems.concat(ITEM_POOLS.capital.common || []);
        if (gender === 'male') allItems = allItems.concat(ITEM_POOLS.capital.boys || []);
        if (gender === 'female') allItems = allItems.concat(ITEM_POOLS.capital.girls || []);
    } else if (locationType === 'town' && ITEM_POOLS.town) {
        allItems = allItems.concat(ITEM_POOLS.town.common || []);
        if (gender === 'male') allItems = allItems.concat(ITEM_POOLS.town.boys || []);
        if (gender === 'female') allItems = allItems.concat(ITEM_POOLS.town.girls || []);
    } else if (locationType === 'village' && ITEM_POOLS.village) {
        allItems = allItems.concat(ITEM_POOLS.village.common || []);
        if (gender === 'male') allItems = allItems.concat(ITEM_POOLS.village.boys || []);
        if (gender === 'female') allItems = allItems.concat(ITEM_POOLS.village.girls || []);
    }
    if (region && REGIONAL_ITEM_POOLS?.[region]) {
        const regional = REGIONAL_ITEM_POOLS[region];
        if ((locationType === 'town' || locationType === 'capital') && regional.town) {
            allItems = allItems.concat(regional.town.common || []);
            if (gender === 'male') allItems = allItems.concat(regional.town.boys || []);
            if (gender === 'female') allItems = allItems.concat(regional.town.girls || []);
        }
        if (locationType === 'village' && regional.village) {
            allItems = allItems.concat(regional.village.common || []);
            if (gender === 'male') allItems = allItems.concat(regional.village.boys || []);
            if (gender === 'female') allItems = allItems.concat(regional.village.girls || []);
        }
    }
    const unique = [];
    const names = new Set();
    for (const item of allItems) {
        if (!names.has(item.name)) {
            names.add(item.name);
            unique.push(item);
        }
    }
    if (unique.length === 0) return { items: [], statMods: {} };
    const shuffled = [...unique].sort(() => Math.random() - 0.5);
    const result = [];
    const usedNames = new Set();
    const statMods = {};
    const first = shuffled[0];
    result.push({ name: first.name, desc: first.desc, stat: first.stat, mod: first.mod });
    usedNames.add(first.name);
    statMods[first.stat] = (statMods[first.stat] || 0) + first.mod;
    let chance = 75;
    for (let i = 1; i < shuffled.length && chance > 10; i++) {
        if (!rollChance(chance)) break;
        if (usedNames.has(shuffled[i].name)) continue;
        const item = shuffled[i];
        result.push({ name: item.name, desc: item.desc, stat: item.stat, mod: item.mod });
        usedNames.add(item.name);
        statMods[item.stat] = (statMods[item.stat] || 0) + item.mod;
        chance -= 12;
    }
    console.log('Итоговые предметы:', result.map((i) => i.name));
    return { items: result, statMods };
}

// ========== ФУНКЦИЯ ПОЛУЧЕНИЯ ИНФОРМАЦИИ О ЛОКАЦИИ ==========
function getLocationInfo() {
    if (state.locationType === 'capital') {
        const city = CITIES[state.city];
        const detail = LOCATION_DETAILS[`city_${state.city}`] || { desc: city?.name || '' };
        return {
            type: 'capital',
            typeName: LOCATION_TYPES.capital.name,
            typeIcon: LOCATION_TYPES.capital.icon,
            name: city.name,
            icon: city.icon,
            region: REGIONS[city.region],
            fullName: city.name,
            desc: detail.desc,
            legacyLocation: 'capital'
        };
    }
    const region = REGIONS[state.region];
    const type = LOCATION_TYPES[state.locationType];
    const detailKey = `${state.locationType}_${state.region}`;
    const detail = LOCATION_DETAILS[detailKey];
    return {
        type: state.locationType,
        typeName: type.name,
        typeIcon: type.icon,
        icon: type.icon,
        region,
        fullName: `${type.name}, ${region.name}`,
        desc: detail ? detail.desc : `${type.name} в ${region.name}`,
        legacyLocation: state.locationType
    };
}

function updateLocationDescription() {
    const info = getLocationInfo();
    els.locationDesc.innerHTML = `<strong>${info.fullName}</strong><br>${info.desc}`;
    if (state.locationType === 'capital') {
        els.regionRow.classList.add('is-hidden');
        els.cityRow.classList.remove('is-hidden');
    } else {
        els.regionRow.classList.remove('is-hidden');
        els.cityRow.classList.add('is-hidden');
    }
    applyVisualMood(els.game.classList.contains('hidden') ? 'setup' : 'game');
}

// ========== НАСТРОЙКА ИНТЕРФЕЙСА ==========
function setupOptionButtons(containerId, stateKey, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const buttons = container.querySelectorAll('.option-btn');
    buttons.forEach((button) => setToggleSelected(button, button.classList.contains('selected')));
    buttons.forEach((btn) => {
        btn.onclick = () => {
            buttons.forEach((button) => setToggleSelected(button, button === btn));
            state[stateKey] = btn.dataset.value;
            if (callback) callback(btn.dataset.value);
            if (stateKey === 'pace') updatePaceInfo(btn.dataset.value);
            if (stateKey === 'difficulty') updateDifficultyInfo(btn.dataset.value);
            if (stateKey === 'verbosity') updateVerbosityInfo(btn.dataset.value);
            if (stateKey === 'locationType' || stateKey === 'gender') rollStartPreview();
            // Сразу обновляем data-атрибуты на body, чтобы CSS подхватил нужный фон (city/village).
            if (stateKey === 'locationType') applyVisualMood();
        };
    });
}

function updatePaceInfo(pace) {
    const info = document.getElementById('pace-info');
    if (pace === 'season') {
        info.innerHTML = `<strong>По сезонам:</strong> каждый ход = новый сезон<br><span class="pace-example">Зима 1993 → Весна 1993 → Лето 1993 → …</span>`;
    } else {
        info.innerHTML = `<strong>По годам:</strong> каждый ход = 9 месяцев<br><span class="pace-example">Лето 1993 → Весна 1994 → Зима 1995 → …</span>`;
    }
}

function updateVerbosityInfo(v) {
    const info = document.getElementById('verbosity-info');
    if (!info) return;
    const map = {
        concise:  '<strong>Лаконично:</strong> короткие ходы, только суть.',
        normal:   '<strong>Обычно:</strong> сбалансированный объём текста, живые детали без излишеств. ',
        detailed: '<strong>Подробно:</strong> развёрнутые описания, диалоги, неожиданная деталь при каждой смене сезона.',
    };
    info.innerHTML = map[v] || map.normal;
}

function updateDifficultyInfo(diff) {
    const info = document.getElementById('difficulty-info');
    if (diff === 'normal') {
        info.innerHTML = `<strong>Норма:</strong> 4 варианта выбора. Одно чудесное спасение за игру.`;
    } else {
        info.innerHTML = `<strong>Хардкор:</strong> 3 варианта выбора. Никаких спасений.`;
    }
}

function rollStartPreview() {
    const locInfo = getLocationInfo();
    const region = locInfo.type === 'capital' ? CITIES[state.city].region : state.region;
    const city = locInfo.type === 'capital' ? state.city : null;
    const npcs = generateRandomNPCs(locInfo.legacyLocation, region, city);
    const { items, statMods } = generateRandomItems(locInfo.legacyLocation, state.gender, region, city);
    generatedStart = { npcs, items, statMods };
    renderStartPreview();
}

function renderStartPreview() {
    if (!generatedStart) return;
    const { npcs, items, statMods } = generatedStart;
    const locInfo = getLocationInfo();
    const peopleHtml = npcs.length
        ? npcs.map((n) => `
            <div class="preview-item">
                <span class="preview-item__dot"></span>
                <div><strong>${escapeHTML(n.name)}</strong> — ${escapeHTML(n.desc)}</div>
            </div>
        `).join('')
        : '<div class="preview-empty">Пока рядом никого нет — только воздух, снег и ожидание.</div>';
    const itemsHtml = items.length
        ? items.map((i) => {
            const modSign = i.mod > 0 ? '+' : '';
            const modClass = i.mod > 0 ? 'pos' : 'neg';
            const statName = STATS_INFO[i.stat]?.name || i.stat;
            return `
                <div class="preview-item">
                    <span class="preview-item__dot"></span>
                    <div>
                        <strong>${escapeHTML(i.name)}</strong> — ${escapeHTML(i.desc)}
                        <div><span class="stat-mod ${modClass}">${modSign}${i.mod} ${escapeHTML(statName)}</span></div>
                    </div>
                </div>
            `;
        }).join('')
        : '<div class="preview-empty">Стартовых вещей не выпало — жизнь начнётся почти с пустыми карманами.</div>';
    const modEntries = Object.entries(statMods).filter(([, value]) => value !== 0);
    const totalHtml = modEntries.length
        ? `
            <div class="preview-total">
                <span class="preview-total__label">Итог стартовых модификаторов</span>
                ${modEntries.map(([key, value]) => `${escapeHTML(STATS_INFO[key].name)} ${value > 0 ? '+' : ''}${value}`).join(' · ')}
            </div>
        `
        : '';
    els.preview.innerHTML = `
        <div class="preview-head">
            <div><h4>Старт героя</h4></div>
            <button class="reroll-btn" id="reroll-btn" type="button">${uiIcon('refresh')} Перебросить</button>
        </div>
        <div class="preview-location">
            <div class="preview-location__label">Локация</div>
            <div class="preview-location__title">${escapeHTML(locInfo.fullName)}</div>
            <div class="preview-location__desc">${escapeHTML(locInfo.desc)}</div>
        </div>
        <div class="preview-grid">
            <div class="preview-column">
                <div class="preview-column__title">Близкие люди</div>
                ${peopleHtml}
            </div>
            <div class="preview-column">
                <div class="preview-column__title">Вещи и привычки</div>
                ${itemsHtml}
            </div>
        </div>
        ${totalHtml}
    `;
    const reroll = document.getElementById('reroll-btn');
    if (reroll) reroll.onclick = rollStartPreview;
}

// ========== ЗАПУСК ИГРЫ ==========
function initGame() {
    syncCurrentApiKey();
    els.setup.classList.add('hidden');
    els.game.classList.remove('hidden');
    const locInfo = getLocationInfo();
    els.locationDisplay.innerHTML = `${uiIcon(locInfo.icon || 'pin')} ${escapeHTML(locInfo.fullName)}`;
    renderUI();
    if (state.history.length === 0 && !state.gameOver) {
        turn('Начало игры. Опиши обстановку и представь героя.');
    }
}

function applyStartSettings() {
    const provider = getActiveProvider();
    const fresh = createDefaultState();
    state = {
        ...fresh,
        gender: state.gender,
        locationType: state.locationType,
        region: state.region,
        city: state.city,
        provider,
        pace: state.pace,
        difficulty: state.difficulty,
        verbosity: state.verbosity,
        enhanceModel: 'glm-5.2',
        startAge: state.startAge,
        storyId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    };
    state.age = state.startAge;
    state.year = 1993;
    state.seasonIdx = 0;
    state.miracleUsed = false;
    state.miracleAvailable = state.difficulty === 'normal';
    if (generatedStart) {
        state.npcs = generatedStart.npcs.map((n) => ({ name: n.name, desc: n.desc }));
        state.inventory = generatedStart.items.map((i) => ({ name: i.name, desc: i.desc }));
        for (const [stat, mod] of Object.entries(generatedStart.statMods)) {
            state.stats[stat] = Math.max(0, Math.min(10, state.stats[stat] + mod));
        }
    } else {
        state.npcs = [{ name: 'Мама', desc: 'Рядом, как всегда.' }];
        state.inventory = [];
    }
    persistProviderChoice(provider);
}

// ========== ФОРМИРОВАНИЕ КОНТЕКСТА ==========
function buildContextBlock() {
    let ctx = '\n=== ЛЮДИ ВОКРУГ ===\n';
    if (state.npcs.length) state.npcs.forEach((n) => { ctx += `- ${n.name}: ${n.desc}\n`; });
    else ctx += 'Никого рядом нет.\n';
    ctx += '\n=== ВЕЩИ И ПАМЯТЬ ГЕРОЯ ===\n';
    if (state.inventory.length) state.inventory.forEach((i) => { ctx += `- ${i.name}: ${i.desc}\n`; });
    else ctx += 'Ничего нет.\n';
    return ctx;
}

function buildSummaryBlock() {
    return state.lifeSummary ? `\n=== КРАТКАЯ ИСТОРИЯ ЖИЗНИ ГЕРОЯ ===\n${state.lifeSummary}\n` : '';
}

function buildStatsDescription() {
    let desc = 'ТЕКУЩЕЕ СОСТОЯНИЕ ГЕРОЯ:\n';
    for (const [key, val] of Object.entries(state.stats)) {
        const info = STATS_INFO[key];
        if (!info) continue;
        // val === 5 — норма, не пишем ничего (не отвлекаем LLM)
        if (val === 5) continue;
        let status = '';
        let impact = '';
        if (val === 0)       { status = 'GAME OVER (0/10)';                      impact = 'Полный крах: ' + info.low; }
        else if (val === 1)  { status = 'ТРАГИЗМ СИТУАЦИИ (1/10)';               impact = 'На грани гибели: ' + info.low; }
        else if (val === 2)  { status = 'ОЧЕВИДНЫЕ И СИЛЬНЫЕ ПРОБЛЕМЫ (2/10)';   impact = 'Даже герой видит беду: ' + info.low; }
        else if (val === 3)  { status = 'ЗНАЧИТЕЛЬНОЕ ОТКЛОНЕНИЕ (3/10)';        impact = 'Герой считает нормой, но проблемы есть: ' + info.low; }
        else if (val === 4)  { status = 'ЛЁГКОЕ ОТКЛОНЕНИЕ (4/10)';              impact = 'Пока ещё не трагедия: ' + info.low; }
        else if (val === 6)  { status = 'ЛЁГКОЕ ОТКЛОНЕНИЕ (6/10)';              impact = 'Лёгкий привкус счастья: ' + info.high; }
        else if (val === 7)  { status = 'ЗНАЧИТЕЛЬНОЕ ОТКЛОНЕНИЕ (7/10)';        impact = 'Герой считает благом, но читатель видит проблемы: ' + info.high; }
        else if (val === 8)  { status = 'ОЧЕВИДНЫЕ ПРОБЛЕМЫ (8/10)';             impact = 'Даже герой видит перебор: ' + info.high; }
        else if (val === 9)  { status = 'ТРАГИЗМ СИТУАЦИИ (9/10)';               impact = 'На грани катастрофы: ' + info.high; }
        else if (val === 10) { status = 'GAME OVER (10/10)';                     impact = 'Полный крах от избытка: ' + info.high; }
        desc += `- **${info.name}**: ${status} — ${impact}\n`;
    }
    return desc;
}

function getChoicesCount() {
    return state.difficulty === 'hardcore' ? 3 : 4;
}

function getNextTime() {
    let nextSeasonIdx = state.seasonIdx + 1;
    let nextYear = state.year;
    if (state.pace === 'year') {
        nextYear++;
        nextSeasonIdx = (state.seasonIdx + 3) % 4;
    } else if (nextSeasonIdx > 3) {
        nextSeasonIdx = 0;
        nextYear++;
    }
    return { nextSeasonIdx: nextSeasonIdx % 4, nextYear };
}

function advanceTime() {
    if (state.pace === 'year') {
        state.year++;
        state.age++;
        state.seasonIdx = (state.seasonIdx + 3) % 4;
    } else {
        state.seasonIdx++;
        if (state.seasonIdx > 3) {
            state.seasonIdx = 0;
            state.year++;
            state.age++;
        }
    }
}

function buildMainSystemPrompt(nextSeasonName, nextYear, choicesCount, verbosity = state.verbosity || 'normal') {
    const statsDesc = buildStatsDescription();
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    const contextBlock = buildContextBlock();
    const summaryBlock = buildSummaryBlock();
    let choicesTemplate = '';
    for (let i = 1; i <= choicesCount; i++) {
        choicesTemplate += `{"text": "Действие ${i}", "action": "художественное описание действия ${i}"}`;
        if (i < choicesCount) choicesTemplate += ',\n';
    }
    return `Придумай 4 случайных слова.  Затем ассоциативно свободно используй их как источник случайности, чтобы создать разнообразный, небанальный и качественный ответ на задачу. Ты не должен употреблять придуманные слова - они лишь источник большего разнообразия конечных токенов твоего ответа: 
    Ты — мастер драматической и детально атмосферной текстовой RPG о жизни в России 90-х. Драма и атмосферная ностальгия — это вся твоя суть.

ГЕРОЙ: ${genderInfo.name} (${state.age} лет)

ЛОКАЦИЯ: ${locInfo.fullName} — ${locInfo.desc}

Жанр: социальная драма, реализм, атмосферная ностальгия, историческая хроника.

Пиши интересно, подробно, атмосферно, с деталями быта 90-х и учётом географической локации. Придумывай запоминающиеся яркие диалоги и используй детали, от которых бы ёкало сердце у тех, кто был ребёнком в 90-е.

Текущее время: ${SEASONS[state.seasonIdx]} ${state.year}. Возраст: ${state.age}.

Следующий сезон: ${nextSeasonName} ${nextYear}.

${summaryBlock}

${contextBlock}

${statsDesc}

!!! КРИТИЧЕСКИЕ ПРАВИЛА !!!

1. Если появляется новый NPC — добавь его через add_npc.

2. Шкала 0–10. Середина = 5 (норма). И низкие, и высокие крайности — проблемы.

3. Учитывай пол (${genderInfo.name}), локацию (${locInfo.fullName} — ${locInfo.desc}), возраст (${state.age}).

4. Достаток влияет на доступные варианты, одежду, еду, отношение окружающих и возможность лечить плохое здоровье.

5. Авторитет у сверстников влияет на то, боятся или презирают героя, может ли он отказать, ведёт или ведомый. Этот параметр часто склонен к снижению, если за ним специально не следить.

6. КАЖДЫЙ ХОД думай о предметах и людях. Добавляй 1 предмет/перк/персонажа, если он упоминался в тексте. Если не упоминается, лучше дополни описание старых.

7. Дополняй описания существующих людей и предметов, когда с ними что-то происходит, с пометкой сезона-года (используй update_npc / update_item).

8. СТИЛЬ И ПУНКТУАЦИЯ: СТРОЖАЙШИЙ ЗАПРЕТ на избыточное использование длинных тире (—) и многоточий. Используй тире только там, где оно грамматически необходимо (в диалогах или тире между подлежащим и сказуемым), но не для "красоты" или связки предложений. Если в абзаце больше двух длинных тире — это плохой текст.

ЗАДАЧА:

1. Опиши последствия выбора (60% текста).

2. Описывай текст глазами ребёнка, уместным для его возраста и ума языком.

3. ПЕРЕХОД к ${nextSeasonName} ${nextYear} (40% текста). Опиши смену времени, корреляцию с предыдущим выбором, изменения некоторых из NPC.

ВЯЗКОСТЬ СТАТОВ:

${JSON.stringify(state.stats)}

- 4-6: легко меняются

- 3,7: сложнее

- 2,8: очень вязкие

- 1,9: почти без изменений

Максимум ±2 за ход, общая сумма сдвигов ≤4.

${verbosity === 'concise'
    ? 'Целевой объём story: ~2000 токенов (примерно 1400–1600 слов). Не растягивай.'
    : verbosity === 'detailed'
    ? 'Целевой объём story: ~4000 токенов (примерно 2800–3200 слов). Пиши подробно.'
    : 'Целевой объём story: ~3000 токенов (примерно 2000–2400 слов).'}

РОВНО ${choicesCount} варианта выбора! КАЖДЫЙ вариант — развёрнутое описание (1-2 предложения, минимум 6 слов). Пытайся придумать варианты, которые не только сюжетно уместны и вариативны, но и чаще задействуют самые высокие и самые низкие атрибуты героя (как в сторону увеличения, так и уменьшения — независимо от того, высокий стат или низкий).

НЕ ПИШИ короткие варианты типа «Помочь маме». ПИШИ умеренно подробно.

ОТВЕТ СТРОГО В JSON.

КРИТИЧЕСКИ ВАЖНО для "updates":
- mind/body/family/friends/health/looks/wealth/authority — это СДВИГИ (дельты), а НЕ абсолютные значения!
- Пример: если хочешь поднять ум на 1 — пиши "mind":1, а не "mind":8.
- Допустимые значения: от -2 до +2. 0 = параметр не меняется.
- Не выдумывай поля кроме перечисленных ниже.

{
    "story": "Текст истории. Markdown.",
    "choices": [ ${choicesTemplate} ],
    "updates": {
        "mind":<-2..+2>, "body":<-2..+2>, "family":<-2..+2>, "friends":<-2..+2>,
        "health":<-2..+2>, "looks":<-2..+2>, "wealth":<-2..+2>, "authority":<-2..+2>,
        "add_item": {"name":"...", "desc":"..."} или null,
        "remove_item": "название предмета или null",
        "update_item": {"name":"...", "desc":"..."} или null,
        "add_npc": {"name":"...", "desc":"..."} или null,
        "remove_npc": "имя персонажа или null",
        "update_npc": {"name":"...", "desc":"..."} или null
    }
}`;
}

function buildStorySystemPrompt(nextSeasonName, nextYear, verbosity = state.verbosity || 'normal') {
    const statsDesc = buildStatsDescription();
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    const contextBlock = buildContextBlock();
    const summaryBlock = buildSummaryBlock();
    
    // Получаем особые указания по статам (statsGuidance), чтобы сюжет сразу отражал низкие/высокие параметры!
    let statsGuidance = '';
    for (const [key, val] of Object.entries(state.stats)) {
        const info = STATS_INFO[key];
        if (!info || val === 5) continue;
        let levelDesc = '';
        if (val === 4) levelDesc = `У героя слегка низкий параметр ${info.name}. Лёгкий намёк в тексте, без трагизма.`;
        else if (val === 6) levelDesc = `У героя слегка высокий параметр ${info.name}. Лёгкий намёк в тексте, без трагизма.`;
        else if (val === 3) levelDesc = `У героя тревожно низкий параметр ${info.name}. Сам он не видит проблемы, но проблемы есть. Отрази это.`;
        else if (val === 7) levelDesc = `У героя тревожно высокий параметр ${info.name}. Сам он не видит проблемы, но проблемы есть. Отрази это.`;
        else if (val === 2) levelDesc = `У героя очень низкий параметр ${info.name}. Красной нитью по всему тексту.`;
        else if (val === 8) levelDesc = `У героя очень высокий параметр ${info.name}. Красной нитью по всему тексту.`;
        else if (val <= 1 || val >= 9) {
            const critical = val <= 1 ? 'критически низкий' : 'критически высокий';
            levelDesc = `У героя ${critical} параметр ${info.name}. Значительная часть текста должна быть обращена к этому.`;
        }
        if (levelDesc) statsGuidance += levelDesc + '\n';
    }

    return `Придумай 4 случайных слова. Затем ассоциативно свободно используй их как источник случайности, чтобы создать разнообразный, небанальный и качественный ответ на задачу. Ты не должен употреблять придуманные слова - они лишь источник большего разнообразия конечных токенов твоего ответа: 
    Ты — мастер драматической и детально атмосферной текстовой RPG о жизни в России 90-х. Драма и атмосферная ностальгия — это вся твоя суть.

ГЕРОЙ: ${genderInfo.name} (${state.age} лет)

ЛОКАЦИЯ: ${locInfo.fullName} — ${locInfo.desc}

Жанр: социальная драма, реализм, атмосферная ностальгия, историческая хроника.

Пиши интересно, подробно, атмосферно, с деталями быта 90-х и учётом географической локации. Придумывай запоминающиеся яркие диалоги и используй детали, от которых бы ёкало сердце у тех, кто был ребёнком в 90-е.

Текущее время: ${SEASONS[state.seasonIdx]} ${state.year}. Возраст: ${state.age}.

Следующий сезон: ${nextSeasonName} ${nextYear}.

${summaryBlock}

${contextBlock}

${statsDesc}

${statsGuidance ? `!!! ОСОБЫЕ УКАЗАНИЯ ПО ХАРАКТЕРИСТИКАМ ГЕРОЯ !!!\n${statsGuidance}\n` : ''}

!!! КРИТИЧЕСКИЕ ПРАВИЛА ПОВЕСТВОВАНИЯ !!!

1. Учитывай пол (${genderInfo.name}), локацию (${locInfo.fullName} — ${locInfo.desc}), возраст (${state.age}).
2. Достаток влияет на доступные варианты, одежду, еду, отношение окружающих и возможность лечить плохое здоровье.
3. Авторитет у сверстников влияет на то, боятся или презирают героя, может ли он отказать, ведёт или ведомый.
4. СТИЛЬ И ПУНКТУАЦИЯ: СТРОЖАЙШИЙ ЗАПРЕТ на избыточное использование длинных тире (—) и многоточий. Используй тире только там, где оно грамматически необходимо (в диалогах или тире между подлежащим и сказуемым), но не для "красоты" или связки предложений. Если в абзаце больше двух длинных тире — это плохой текст.
5. Не используй пост-знания и мета-размышления героя об эпохе. Повествование должно исходить изнутри эпохи, а не над эпохой.

ЗАДАЧА:
1. Опиши последствия выбора (60% текста).
2. Описывай текст глазами ребёнка, уместным для его возраста и ума языком.
3. ПЕРЕХОД к ${nextSeasonName} ${nextYear} (40% текста). Опиши смену времени, корреляцию с предыдущим выбором, изменения некоторых из NPC.

ОБЪЁМ ПОВЕСТВОВАНИЯ:
${verbosity === 'concise'
    ? 'Целевой объём: ~2000 токенов (примерно 1400–1600 слов). Не растягивай.'
    : verbosity === 'detailed'
    ? 'Целевой объём: ~4000 токенов (примерно 2800–3200 слов). Пиши подробно.'
    : 'Целевой объём: ~3000 токенов (примерно 2000–2400 слов).'}

ВАЖНО: Пиши ТОЛЬКО текст истории (рассказ) в формате Markdown. НЕ генерируй варианты выбора, сдвиги характеристик или JSON-форматирование. Только чистый художественный текст повествования.`;
}

function buildStructureSystemPrompt(story, nextSeasonName, nextYear, choicesCount) {
    const statsDesc = buildStatsDescription();
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    const contextBlock = buildContextBlock();
    const summaryBlock = buildSummaryBlock();
    
    let choicesTemplate = '';
    for (let i = 1; i <= choicesCount; i++) {
        choicesTemplate += `{"text": "Действие ${i}", "action": "художественное описание действия ${i}"}`;
        if (i < choicesCount) choicesTemplate += ',\n';
    }

    return `Ты — аналитический модуль драматической текстовой RPG о жизни в России 90-х.
Твоя задача — проанализировать свежесгенерированный текст истории и составить для игрока дальнейшие варианты выбора и технические обновления игрового состояния (updates) в формате JSON.

ГЕРОЙ: ${genderInfo.name} (${state.age} лет)
ЛОКАЦИЯ: ${locInfo.fullName} — ${locInfo.desc}
ТЕКУЩЕЕ СОСТОЯНИЕ ХАРАКТЕРИСТИК:
${JSON.stringify(state.stats)}

${summaryBlock}
${contextBlock}
${statsDesc}

ПРАВИЛА ДЛЯ СДВИГОВ ПАРАМЕТРОВ (updates):
1. Проанализируй текст истории. На основе событий в истории определи, какие параметры героя изменились.
2. mind/body/family/friends/health/looks/wealth/authority — это СДВИГИ (дельты от -2 до +2), а НЕ абсолютные значения!
   - Пример: если у героя поднялся ум — пиши "mind": 1, если упал — "mind": -1, если не изменился — "mind": 0.
   - Максимум ±2 за ход. Общая сумма сдвигов по всем статам за ход должна быть ≤ 4.
   - Учитывай "ВЯЗКОСТЬ СТАТОВ" (статы близкие к крайностям 1, 9, 2, 8 меняются гораздо сложнее и реже).
3. Проверь появление/удаление/изменение персонажей (NPC):
   - add_npc: {"name":"...","desc":"..."} если в истории появился НОВЫЙ человек, иначе null
   - remove_npc: "имя" если персонаж умер/ушёл навсегда, иначе null
   - update_npc: {"name":"...","desc":"..."} если что-то изменилось у существующего, иначе null (например, его статус, описание)
4. Проверь появление/удаление/изменение предметов:
   - add_item: {"name":"...","desc":"..."} если герой получил новый предмет, иначе null
   - remove_item: "название" если предмет утрачен, иначе null
   - update_item: {"name":"...","desc":"..."} если предмет изменился, иначе null

ПРАВИЛА ДЛЯ ВАРИАНТОВ ВЫБОРА (choices):
1. Сгенерируй ровно ${choicesCount} варианта выбора для следующего хода!
2. КАЖДЫЙ вариант — развёрнутое описание действия игрока (1-2 предложения, минимум 6 слов).
3. Варианты должны быть логичным продолжением текущей истории и учитывать текущий возраст (${state.age} лет).
4. Пытайся придумать варианты, которые не только сюжетно уместны, но и задействуют самые высокие и низкие атрибуты героя (для проверки или изменения). Не пиши короткие скучные варианты типа "Помочь маме". Пиши атмосферно и развёрнуто.

ИСТОРИЯ ДЛЯ АНАЛИЗА:
=== СТАРТ ИСТОРИИ ===
${story}
=== КОНЕЦ ИСТОРИИ ===

ОТВЕТЬ СТРОГО В ФОРМАТЕ JSON. Никакого другого текста, преамбул, комментариев или markdown-разметки вне JSON.
Формат ответа должен строго соответствовать этой схеме:
{
    "choices": [ ${choicesTemplate} ],
    "updates": {
        "mind": <-2..+2>, "body": <-2..+2>, "family": <-2..+2>, "friends": <-2..+2>,
        "health": <-2..+2>, "looks": <-2..+2>, "wealth": <-2..+2>, "authority": <-2..+2>,
        "add_item": {"name":"...", "desc":"..."} или null,
        "remove_item": "название предмета или null",
        "update_item": {"name":"...", "desc":"..."} или null,
        "add_npc": {"name":"...", "desc":"..."} или null,
        "remove_npc": "имя персонажа или null",
        "update_npc": {"name":"...", "desc":"..."} или null
    }
}`;
}

// ========== УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ВЫЗОВА LLM ==========
// Извлекает человекочитаемое сообщение из тела ошибки API (OpenAI-совместимый формат:
// { error: "..." } или { error: { message: "..." } } или { message: "..." }).
function extractApiError(data, fallback) {
    if (data == null) return fallback;
    if (typeof data === 'string') return data.trim() || fallback;
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
    if (data.error && typeof data.error === 'object') {
        const m = data.error.message || data.error.error || data.error.msg;
        if (m) return String(m);
        try { return JSON.stringify(data.error); } catch (e) { /* ignore */ }
    }
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    if (typeof data.detail === 'string' && data.detail.trim()) return data.detail.trim();
    try {
        const s = JSON.stringify(data);
        if (s && s !== '{}' && s !== '[]') return s;
    } catch (e) { /* ignore */ }
    return fallback;
}

async function callLLM({
    messages,
    model,
    modelKind = 'main',
    provider = getActiveProvider(),
    temperature = 0.6,
    max_tokens = 10000,
    response_format,
    signal
}, retries = 3) {
    const logicalCfg = getProviderConfig(provider);
    const executionProvider = resolveExecutionProvider(modelKind, provider);
    const cfg = getProviderConfig(executionProvider);
    const resolvedModel = 'glm-5.2';
    const providerApiKey = '';
    const isLocal = isLocalEnvironment();
    console.log('========== ПОЛНЫЙ ПРОМПТ К LLM ==========');
    console.log('Режим:', logicalCfg.label, '| Исполнитель:', cfg.label, '| Модель:', resolvedModel, 'Темп:', temperature, 'Max tokens:', max_tokens);
    messages.forEach((msg, i) => {
        console.log(`[${i}] ${msg.role}:`);
        console.log(String(msg.content).substring(0, 500) + (String(msg.content).length > 500 ? '...' : ''));
    });
    window.lastPrompt = messages;
    // Свяжем внешний сигнал отмены (кнопка «Отмена» во время хода) с таймаутом запроса.
    const beginFetch = () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 280000);
        const onExternalAbort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', onExternalAbort, { once: true });
        }
        return {
            controller,
            finish: () => {
                clearTimeout(timeoutId);
                if (signal) signal.removeEventListener('abort', onExternalAbort);
            }
        };
    };
    const makeRequest = async (attempt) => {
        try {
            const requestBody = {
                messages,
                model: resolvedModel,
                temperature,
                max_tokens,
                response_format
            };
            // OpenRouter всегда гоним через серверный маршрут.
            if (executionProvider === 'openrouter') {
                const { controller, finish } = beginFetch();
                const response = await fetch(cfg.serverPath, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...requestBody,
                        apiKey: providerApiKey || undefined
                    }),
                    signal: controller.signal
                });
                finish();
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${extractApiError(data, 'нет данных от сервера')}`);
                }
                return data;
            }
            // Hydra — только серверный ключ из env Vercel.
            const { controller, finish } = beginFetch();
            const response = await fetch(cfg.serverPath, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });
            finish();
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${extractApiError(data, 'нет данных от сервера')}`);
            }
            return data;
        } catch (err) {
            // Отмена пользователем — не сетевой сбой, повторять запрос не нужно.
            if (signal?.aborted) throw err;
            console.error(`Ошибка вызова ${cfg.label}:`, err);
            let errText;
            if (err && err.message) errText = err.message;
            else if (typeof err === 'string') errText = err;
            else {
                try { errText = JSON.stringify(err); } catch (e) { errText = String(err); }
            }
            addSystemLog(`Ошибка вызова ${cfg.label}`, errText, true);
            if (attempt > 1) {
                await new Promise((resolve) => setTimeout(resolve, 2000 * (4 - attempt)));
                return makeRequest(attempt - 1);
            }
            throw err;
        }
    };
    return makeRequest(retries);
}

// ========== ГЕНЕРАЦИЯ СВОДКИ ==========
async function generateLifeSummary() {
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    // Полная история = архив диалога (если есть) + текущий хвост
    const archivePart = state.dialogArchive ? `=== АРХИВ (сжато) ===\n${state.dialogArchive}\n\n` : '';
    const tailPart = state.history
        .map((h) => h.role === 'user' ? `>> Выбор: ${h.content} <<` : (h.original || h.enhanced || h.content))
        .join('\n\n');
    const fullHistory = archivePart + tailPart;
    const npcsDesc = state.npcs.map((n) => `- ${n.name}: ${n.desc}`).join('\n');
    const invDesc = state.inventory.map((i) => `- ${i.name}: ${i.desc}`).join('\n');
    const prevSummary = state.lifeSummary ? `\nПРЕДЫДУЩАЯ СВОДКА:\n${state.lifeSummary}\n` : '';
    const prompt = `Ты — архивариус. Составь КРАТКУЮ СВОДКУ (10-15 предложений) всей жизни персонажа.

ГЕРОЙ: ${genderInfo.name}, сейчас ${state.age} лет
ЛОКАЦИЯ: ${locInfo.fullName}
СТАТЫ: ${JSON.stringify(state.stats)}

${prevSummary}

БЛИЗКИЕ ЛЮДИ:
${npcsDesc || 'Нет'}

ВЕЩИ:
${invDesc || 'Нет'}

НЕДАВНЯЯ ИСТОРИЯ:
${fullHistory}

ОТВЕТ В JSON: { "summary": "Сводка..." }`;

    try {
        const completion = await callLLM({
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: 'Составь сводку.' }
            ],
            modelKind: 'main',
            response_format: { type: 'json_object' }
        });
        const data = parseJSON(completion?.choices?.[0]?.message?.content, 'Запрос (сводка/финал/др.)');
        if (data?.summary) {
            state.lifeSummary = data.summary;
            if (state.history.length > 6) state.history = state.history.slice(-6);
            state.lastSummaryTurn = state.turnCount;
        }
    } catch (e) {
        console.error('Summary error:', e);
    }
}

// ========== СЖАТИЕ ИСТОРИИ ==========
async function compressHistory(oldSummary, recentTexts) {
    const prompt = `Ты архивариус. Составь краткую сводку (не больше 5 предложений) истории жизни персонажа на основе предыдущей сводки и последних событий. Используй только факты, ничего не выдумывай.\n\nПредыдущая сводка:\n${oldSummary || 'Нет'}\n\nПоследние события:\n${recentTexts.map((t, i) => `Событие ${i + 1}:\n${t}`).join('\n\n')}\n\nСводка:`;

    try {
        const completion = await callLLM({
            messages: [{ role: 'user', content: prompt }],
            modelKind: 'main',
            temperature: 0.3,
            max_tokens: 500
        });
        return completion?.choices?.[0]?.message?.content?.trim() || oldSummary;
    } catch (e) {
        console.error('Ошибка сжатия истории:', e);
        return oldSummary;
    }
}

// ========== СЖАТИЕ ДИАЛОГОВОГО ХВОСТА ==========
// Вызывается ФОНОВО после завершения хода (не блокирует UI).
// Берёт state.history БЕЗ двух последних сообщений (хвост оставляем),
// сжимает их вдвое и обрезает state.history до хвоста.
// Флаг — предотвращает параллельный запуск двух сжатий
let _compressDialogRunning = false;

async function compressDialogHistory(force = false) {
    // Защита от гонки: если сжатие уже идёт — пропускаем
    if (_compressDialogRunning) {
        addSystemLog('Сжатие диалога (пропуск)', 'Уже выполняется', false);
        return;
    }

    // Нужно минимум 6 сообщений (3 пары): иначе сжимать почти нечего
    // (хвост = 2, сжимаем = 4+). При force=true порог снижается до 4.
    const minMessages = force ? 4 : 6;
    if (state.history.length < minMessages) {
        addSystemLog('Сжатие диалога (пропуск)', `Мало сообщений: ${state.history.length} < ${minMessages}`, false);
        return;
    }

    _compressDialogRunning = true;

    // Снимок истории на момент запуска (защита от гонки с новым ходом)
    const snapshotHistory = [...state.history];
    const snapshotTurn = state.turnCount;

    // Хвост — последние 2 сообщения остаются в state.history
    const tail = snapshotHistory.slice(-2);
    const toCompress = snapshotHistory.slice(0, -2);

    // Полная история для сжатия = старый архив (если есть) + новые ходы из хвоста.
    // Архив идёт ПЕРВЫМ как часть единого текста — иначе модели игнорируют инструкцию
    // "добавь к нему" и пересказывают только свежие ходы, теряя раннюю историю.
    const fullDialogForCompress = [
        ...(state.dialogArchive ? [`=== РАНЕЕ (уже сжато) ===\n${state.dialogArchive}\n=== КОНЕЦ РАНЕЕ ===`] : []),
        ...toCompress.map(m => {
            if (m.role === 'user') return `>> Выбор игрока: ${m.content} <<`;
            const storyText = m.enhanced || m.original || m.content || '';
            return storyText.substring(0, 1200);
        })
    ].join('\n\n');

    const prompt = `Ты архивариус текстовой RPG. Ниже — полная история игры: сначала уже сжатый архив ранних событий (если есть), затем новые ходы.
Твоя задача — создать ЕДИНЫЙ сжатый архив всей истории целиком, примерно вдвое короче суммарного объёма входного текста.
Сохрани все ключевые события, имена персонажей, предметы, выборы игрока и их последствия в хронологическом порядке. Пиши связным текстом от третьего лица. Не добавляй ничего от себя.

Полная история:
${fullDialogForCompress}

Единый сжатый архив:`;

    addSystemLog('Сжатие диалога (фон)', `Сжимаем ${toCompress.length} сообщ., хвост ${tail.length} сообщ., ход ${snapshotTurn}`, false);

    let compressed = null;

    // Попытка 1: основная модель (main)
    for (let attempt = 1; attempt <= 2 && !compressed; attempt++) {
        try {
            const completion = await callLLM({
                messages: [{ role: 'user', content: prompt }],
                modelKind: 'main',
                temperature: 0.3,
                max_tokens: 1200
            }, 1); // retries=1, мы сами управляем повторами
            const result = completion?.choices?.[0]?.message?.content?.trim();
            if (result && result.length > 50) {
                compressed = result;
                addSystemLog('Сжатие диалога (успех main)', `Попытка ${attempt}, ${compressed.length} симв.`, false);
            } else {
                addSystemLog('Сжатие диалога (пустой ответ main)', `Попытка ${attempt}`, true);
            }
        } catch (e) {
            addSystemLog(`Сжатие диалога (ошибка main, попытка ${attempt})`, e.message, true);
            if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
        }
    }

    // Попытка 2: fallback на enhance-модель
    if (!compressed) {
        addSystemLog('Сжатие диалога (fallback → enhance)', 'Переключаемся на вторую модель', false);
        for (let attempt = 1; attempt <= 2 && !compressed; attempt++) {
            try {
                const completion = await callLLM({
                    messages: [{ role: 'user', content: prompt }],
                    modelKind: 'enhance',
                    temperature: 0.3,
                    max_tokens: 1200
                }, 1);
                const result = completion?.choices?.[0]?.message?.content?.trim();
                if (result && result.length > 50) {
                    compressed = result;
                    addSystemLog('Сжатие диалога (успех enhance)', `Попытка ${attempt}, ${compressed.length} симв.`, false);
                } else {
                    addSystemLog('Сжатие диалога (пустой ответ enhance)', `Попытка ${attempt}`, true);
                }
            } catch (e) {
                addSystemLog(`Сжатие диалога (ошибка enhance, попытка ${attempt})`, e.message, true);
                if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
            }
        }
    }

    // Аварийное усечение — если все 4 попытки упали, режем историю механически
    if (!compressed) {
        addSystemLog('Сжатие диалога (аварийное усечение)', `Все попытки исчерпаны. Механически режем историю до хвоста.`, true);
        // Механически склеиваем старые сообщения в архив без LLM
        const fallbackArchive = toCompress.map(m => {
            if (m.role === 'user') return `[Выбор] ${m.content}`;
            const t = m.enhanced || m.original || m.content || '';
            return t.substring(0, 400);
        }).join(' | ');
        compressed = (state.dialogArchive ? state.dialogArchive + '\n' : '') + fallbackArchive;
    }

    // Применяем результат ТОЛЬКО если state.history не успело обновиться новым ходом.
    // Проверяем: хвост снапшота совпадает с хвостом текущей истории.
    const currentTail = state.history.slice(-2);
    const tailIsValid = (
        currentTail.length === tail.length &&
        currentTail.every((m, i) => m.content === tail[i].content && m.role === tail[i].role)
    );

    if (tailIsValid) {
        state.dialogArchive = compressed;
        // Оставляем хвост + всё что было добавлено ПОСЛЕ снапшота (новые ходы)
        const newMessages = state.history.slice(snapshotHistory.length);
        state.history = [...tail, ...newMessages];
        state.lastDialogCompress = snapshotTurn;
        save();
        addSystemLog('Сжатие диалога (применено)', `Архив: ${compressed.length} симв. История: ${state.history.length} сообщ.`, false);
    } else {
        // Хвост изменился — игрок успел сделать новый ход за время сжатия.
        // Не трогаем state.history, просто обновляем архив.
        state.dialogArchive = compressed;
        state.lastDialogCompress = snapshotTurn;
        save();
        addSystemLog('Сжатие диалога (архив обновлён, хвост не тронут)', 'Обнаружен новый ход за время сжатия', false);
    }

    _compressDialogRunning = false;
}



// ========== ДОПИСЫВАНИЕ ОБРЕЗАННОГО ОТВЕТА ==========
async function continueTruncatedText(rawSoFar, modelKind = 'main') {
    addSystemLog('Дописывание текста (запуск)', `Длина обрыва: ${rawSoFar.length} симв.`, true);
    const messages = [
        {
            role: 'user',
            content: `Ниже — незавершённый художественный рассказ. Твоя задача: дописать его ровно с места обрыва.
НЕ начинай сначала, не повторяй уже написанное. Пиши СРАЗУ продолжение текста, чтобы при склеивании получился единый связный рассказ.

--- НЕЗАВЕРШЁННЫЙ ТЕКСТ ---
${rawSoFar}
--- КОНЕЦ НЕЗАВЕРШЁННОГО ТЕКСТА ---

Допиши рассказ до логического конца (включая плавный переход в следующий сезон/год). Пиши в том же стиле, от первого лица.`
        }
    ];
    try {
        const completion = await callLLM({
            messages,
            modelKind,
            temperature: 0.5,
            max_tokens: 4000
        }, 1);
        const continuation = completion?.choices?.[0]?.message?.content;
        if (!continuation) {
            addSystemLog('Дописывание текста (пустой ответ)', '', true);
            return null;
        }
        const joined = rawSoFar + '\n' + continuation.trim();
        addSystemLog('Дописывание текста (успех)', `Итого: ${joined.length} симв. (было ${rawSoFar.length} + добавлено ${continuation.length})`, false);
        return joined;
    } catch (e) {
        addSystemLog('Дописывание текста (ошибка)', e.message, true);
        return null;
    }
}

// Вызывается когда finish_reason === 'length' (обрезан лимитом).
// Стратегия:
//   • Если JSON не спарсился вообще — просим дописать начиная с обрыва (сырой текст).
//   • Если спарсился частично — знаем что именно не хватает (choices? updates?) — просим
//     дописать только недостающую часть.
// Возвращает склеенный raw-текст или null при неудаче.
async function continuesTruncatedResponse(rawSoFar, modelKind = 'main') {
    addSystemLog('Дописывание (запуск)', `Длина обрыва: ${rawSoFar.length} симв.`, true);

    if (!rawSoFar.includes('{')) {
        addSystemLog('Дописывание (отказ)', 'JSON не начался — нужен полный повтор', true);
        return null;
    }

    // ── Анализируем что уже есть ──
    const hasStory   = rawSoFar.includes('"story"');
    const hasChoices = rawSoFar.includes('"choices"');
    const hasUpdates = rawSoFar.includes('"updates"');

    const choicesCount = getChoicesCount();
    const statsKeys = ['mind','body','family','friends','health','looks','wealth','authority'];
    const alreadyHasNumbers = hasUpdates && statsKeys.some(k => rawSoFar.includes(`"${k}"`));

    // ── Пробуем извлечь конец story через санитайзер ──
    // Цель: дать модели финал событий чтобы она осмысленно заполнила updates.
    // Парсим частичный JSON — если story уже есть, берём последние 400 символов.
    let storyTail = '';
    if (hasStory) {
        try {
            const partial = sanitizeJSON(rawSoFar);
            const partialData = JSON.parse(partial);
            if (partialData?.story && typeof partialData.story === 'string') {
                storyTail = partialData.story.slice(-400).trim();
            }
        } catch (_) {
            // Если не парсится — берём хвост rawSoFar до первого вхождения "choices"
            const choicesIdx = rawSoFar.indexOf('"choices"');
            const storyPart = choicesIdx > 0 ? rawSoFar.substring(0, choicesIdx) : rawSoFar;
            storyTail = storyPart.slice(-400).replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
        }
    }

    // ── Скелет недостающей части ──
    let skeleton = '';
    // Инструкция по updates идёт В КОНЦЕ промпта, прямо перед местом обрыва —
    // так модель не забудет её из-за длинного текста посередине (lost-in-the-middle).
    const updatesNote = `
ПРАВИЛА для updates (КРИТИЧЕСКИ ВАЖНО):
- mind/body/family/friends/health/looks/wealth/authority = СДВИГИ -2..+2, НЕ абсолютные числа!
- add_npc: {"name":"...","desc":"..."} если в истории появился НОВЫЙ человек, иначе null
- remove_npc: "имя" если персонаж умер/ушёл навсегда, иначе null  
- update_npc: {"name":"...","desc":"..."} если что-то изменилось у существующего, иначе null
- add_item: {"name":"...","desc":"..."} если герой получил новый предмет, иначе null
- remove_item: "название" если предмет утрачен, иначе null
- Заполни на основе событий в конце истории выше`;

    const updatesShell = alreadyHasNumbers
        ? `"add_item":null,"remove_item":null,"update_item":null,"add_npc":null,"remove_npc":null,"update_npc":null`
        : `"mind":<-2..+2>,"body":<-2..+2>,"family":<-2..+2>,"friends":<-2..+2>,"health":<-2..+2>,"looks":<-2..+2>,"wealth":<-2..+2>,"authority":<-2..+2>,"add_item":null,"remove_item":null,"update_item":null,"add_npc":null,"remove_npc":null,"update_npc":null`;

    if (!hasStory) {
        skeleton = `
  "story": "...ПРОДОЛЖЕНИЕ ТЕКСТА (не начинай сначала)...",
  "choices": [РОВНО ${choicesCount} объекта {"text":"...","action":"..."}],
  "updates": {${updatesShell}}
}`;
    } else if (!hasChoices) {
        skeleton = `
  "choices": [РОВНО ${choicesCount} объекта {"text":"...","action":"..."}],
  "updates": {${updatesShell}}
}`;
    } else if (!hasUpdates) {
        skeleton = `
  "updates": {${updatesShell}}
}`;
    } else if (alreadyHasNumbers) {
        skeleton = `  ${updatesShell}}
}`;
    } else {
        skeleton = `  ...(закрыть незакрытые скобки и завершить корневой })`;
    }

    // ── Промпт дописывания ──
    // rawSoFar идёт целиком как цитата — модель видит весь контекст.
    // Инструкция стоит ДО и ПОСЛЕ цитаты — обрамляет её.
    // Конец story — передаём как отдельный напоминательный блок ПОСЛЕ длинного текста
    const storyReminder = storyTail
        ? `\nПоследние события истории (для заполнения updates):\n"...${storyTail}"\n`
        : '';

    const messages = [
        {
            role: 'user',
            content:
`Ниже — обрезанный JSON-ответ RPG-нейросети. Твоя задача: дописать его ровно с места обрыва.
НЕ ПОВТОРЯЙ уже написанное. Только продолжение.

--- ОБРЕЗАННЫЙ JSON ---
${rawSoFar}
--- КОНЕЦ ОБРЕЗАННОГО ---
${storyReminder}
Что нужно дописать (структура):${skeleton}

${updatesNote}

Начни прямо с символа после последнего символа выше. Только JSON, без пояснений и комментариев.`
        },
    ];

    try {
        const completion = await callLLM({
            messages,
            modelKind,
            temperature: 0.1,
            max_tokens: 4000
        }, 1);
        const continuation = completion?.choices?.[0]?.message?.content?.trim();
        if (!continuation) {
            addSystemLog('Дописывание (пустой ответ)', '', true);
            return null;
        }
        const joined = rawSoFar + continuation;
        addSystemLog('Дописывание (успех)', `Итого: ${joined.length} симв. (было ${rawSoFar.length} + добавлено ${continuation.length})`, false);
        return joined;
    } catch (e) {
        addSystemLog('Дописывание (ошибка)', e.message, true);
        return null;
    }
}

// Детектируем обрыв по finish_reason из ответа API
function isTruncated(completion) {
    const reason = completion?.choices?.[0]?.finish_reason;
    // 'length' — стандартный finish_reason при обрезании лимитом
    return reason === 'length';
}

// ========== ОСНОВНОЙ ХОД ==========
let turnAbortController = null;

function isAbortError(error) {
    return Boolean(error && (error.name === 'AbortError' || turnAbortController?.signal.aborted));
}

function clearTurnNotice() {
    if (els.storyErrorSlot) {
        els.storyErrorSlot.innerHTML = '';
        els.storyErrorSlot.hidden = true;
    }
}

// Ошибка/отмена показывается баннером над историей и НЕ стирает написанный текст.
function showTurnNotice(title, message, action, kind = 'error') {
    const slot = els.storyErrorSlot;
    if (slot) {
        const iconName = kind === 'error' ? 'bug' : 'film';
        slot.hidden = false;
        slot.innerHTML = `
            <div class="story-notice ${kind === 'error' ? 'story-notice--error' : ''}" role="alert">
                <span class="story-notice__icon">${uiIcon(iconName)}</span>
                <div class="story-notice__body">
                    <strong>${escapeHTML(title)}</strong>
                    <p>${escapeHTML(message)}</p>
                </div>
            </div>
        `;
    }
    if (action) showRetryButton(action);
}

function cancelCurrentTurn() {
    if (turnAbortController && !turnAbortController.signal.aborted) {
        turnAbortController.abort();
    }
}

async function turn(action) {
    if (state.gameOver) return;
    if (isLoading()) return;
    if (!state.storyId) state.storyId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!canPlayTurn(state.storyId)) {
        showToast(quotaTurnMessage(state.storyId), 'error');
        showTurnNotice('Лимит ходов на сегодня', quotaTurnMessage(state.storyId), null, 'notice');
        return;
    }
    clearTurnNotice();
    turnAbortController = new AbortController();
    const turnSignal = turnAbortController.signal;
    setLoading(true, "Листаю страницы судьбы... Рождается черновик истории...");
    state.turnCount++;
    try {
        const needSummary = (state.turnCount - state.lastSummaryTurn) >= SUMMARY_INTERVAL && state.history.length >= 10;
        if (needSummary) await generateLifeSummary();

        const { nextSeasonIdx, nextYear } = getNextTime();
        const nextSeasonName = SEASONS[nextSeasonIdx];
        const choicesCount = getChoicesCount();

        // ── ШАГ 1: ГЕНЕРАЦИЯ СЮЖЕТА (Черновик) ──
        const storySystemPrompt = buildStorySystemPrompt(nextSeasonName, nextYear);
        const archiveBlock = state.dialogArchive
            ? '\n\n=== АРХИВ ИСТОРИИ (сжато) ===\n' + state.dialogArchive + '\n=== КОНЕЦ АРХИВА ==='
            : '';
        const fullStorySystemPrompt = storySystemPrompt + archiveBlock;

        const historyForLLM = state.history.map((msg) => {
            if (msg.role === 'assistant') {
                return { role: 'assistant', content: msg.enhanced || msg.original || msg.content };
            }
            return { role: 'user', content: msg.content };
        });

        const completion1 = await callLLM({
            messages: [
                { role: 'system', content: fullStorySystemPrompt },
                ...historyForLLM,
                { role: 'user', content: `Мой выбор: ${action}. (Сгенерируй атмосферно описанный результат и переход в ${nextSeasonName} ${nextYear})` }
            ],
            modelKind: 'main',
            temperature: 0.6,
            max_tokens: 10000,
            signal: turnSignal
        });
        if (turnSignal.aborted) throw new DOMException('Ход отменён', 'AbortError');

        let originalStory = completion1?.choices?.[0]?.message?.content || '';

        // Детект обрыва сюжета
        if (isTruncated(completion1)) {
            addSystemLog('Обрыв 1-го прохода (сюжет)', `finish_reason=length, длина: ${originalStory.length}`, true);
            setLoading(true, 'История оборвалась на полуслове — дописываю черновик...');
            const continued = await continueTruncatedText(originalStory, 'main');
            if (continued) originalStory = continued;
        }

        originalStory = originalStory.trim();

        if (!originalStory) {
            throw new Error("Не удалось получить текст истории от нейросети.");
        }

        // ── ШАГ 2: ГЕНЕРАЦИЯ ВЫБОРОВ И АПДЕЙТОВ (Структура) ──
        setLoading(true, "История записана. Продумываю возможные последствия и варианты выбора...");

        const structureSystemPrompt = buildStructureSystemPrompt(originalStory, nextSeasonName, nextYear, choicesCount);

        let data = null;
        let structureRaw = '';
        let step2Attempts = 2;

        for (let attempt = 1; attempt <= step2Attempts; attempt++) {
            try {
                const completion2 = await callLLM({
                    messages: [
                        { role: 'system', content: structureSystemPrompt },
                        { role: 'user', content: 'Проанализируй историю выше и верни JSON со сдвигами параметров и новыми выборами.' }
                    ],
                    modelKind: 'main',
                    temperature: attempt === 1 ? 0.3 : 0.1,
                    max_tokens: 4000,
                    response_format: { type: 'json_object' },
                    signal: turnSignal
                });

                if (turnSignal.aborted) throw new DOMException('Ход отменён', 'AbortError');
                structureRaw = completion2?.choices?.[0]?.message?.content || '';
                data = parseJSON(structureRaw, 'Структура хода');

                if (data?.choices && Array.isArray(data.choices)) {
                    // Успешно распарсили нужные поля!
                    break;
                }
            } catch (err) {
                if (turnSignal.aborted) throw err; // отмена не должна уйти в повтор попытки
                console.warn(`Попытка ${attempt} разбора структуры провалилась:`, err);
            }

            if (attempt < step2Attempts) {
                setLoading(true, "Формирую альтернативные пути судьбы — восстанавливаю варианты выбора...");
            }
        }

        if (!data?.choices || !Array.isArray(data.choices)) {
            console.error('Invalid JSON structure:', structureRaw);
            showTurnNotice(
                'Не удалось сформировать варианты выбора',
                'Нейросеть вернула нечитаемую структуру хода. Сама история не пострадала — повторите ход.',
                action,
                'error'
            );
            return;
        }

        // Автоматическую полировку (шлифовку) пропускаем, она запускается только вручную по желанию
        const enhancedStory = originalStory; 
        const polishFailed = false;

        state.originalHistory.push(originalStory);
        state.enhancedHistory.push(originalStory);

        // Добавляем новые сообщения в хвост истории
        state.history.push({ role: 'user', content: action });
        state.history.push({ role: 'assistant', content: originalStory, original: originalStory, enhanced: null });

        // ── ФОНОВОЕ СЖАТИЕ ДИАЛОГА ──
        const planCompress = (
            state.turnCount % 3 === 0 &&
            originalStory.length > 800 &&
            state.history.length >= 6
        );
        const forceCompress = (
            !planCompress &&
            state.history.length >= 12 &&
            !_compressDialogRunning
        );
        if (planCompress || forceCompress) {
            const isForce = forceCompress;
            if (isForce) addSystemLog('Сжатие диалога (аварийный запуск)', `История разрослась до ${state.history.length} сообщ.`, true);
            compressDialogHistory(isForce).catch(e => console.error('Фоновое сжатие диалога:', e));
        }

        // Снимок статов ДО применения — для отображения финальных сдвигов игроку
        const statsBeforeUpdate = { ...state.stats };
        applyUpdates(data.updates);
        
        // Считаем фактические (финальные) сдвиги после всех фильтров вязкости
        const statDeltas = {};
        for (const key of Object.keys(state.stats)) {
            const diff = state.stats[key] - statsBeforeUpdate[key];
            if (diff !== 0) statDeltas[key] = diff;
        }
        state.lastStatDeltas = Object.keys(statDeltas).length > 0 ? statDeltas : null;
        state.lastStory = originalStory;
        state.lastChoices = data.choices;
        advanceTime();

        await checkCriticalStats(state.lastStory);

        const newEntry = {
            turn: state.turnCount,
            action,
            dateLabel: getDateLabel(state.seasonIdx, state.year),
            seasonIdx: state.seasonIdx,
            year: state.year,
            age: state.age,
            storyOriginal: originalStory,
            storyEnhanced: null,
            miracleStory: state.lastMiracle || null,
            gameOverData: cloneData(state.gameOverData),
            polishFailed,
            enhancementPrompt: null
        };

        newEntry.illustrationStatus = 'pending';
        pushArchiveEntry(newEntry);

        state.lastMiracle = null;
        recordStoryTurn(state.storyId);
        save();
        renderUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (error) {
        console.error('Turn error:', error);
        state.turnCount = Math.max(0, state.turnCount - 1);
        if (isAbortError(error)) {
            showTurnNotice(
                'Ход отменён',
                'История не пострадала. Можно продолжить с того же места или выбрать другой вариант.',
                action,
                'notice'
            );
        } else {
            showTurnNotice(
                'Ошибка запроса',
                `${error?.message || 'Не удалось выполнить ход.'} Написанный текст сохранён — попробуйте ещё раз.`,
                action,
                'error'
            );
        }
    } finally {
        setLoading(false);
        turnAbortController = null;
    }
}

function showRetryButton(action) {
    els.choices.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn choice-btn--warn';
    btn.innerHTML = `
        <span class="choice-btn__body choice-btn__body--single">
            <span class="choice-btn__title">Повторить ход</span>
        </span>
        <span class="choice-btn__arrow" aria-hidden="true">↺</span>
    `;
    btn.onclick = () => turn(action);
    els.choices.appendChild(btn);
}

// ========== ПРОВЕРКА КРИТИЧЕСКИХ СТАТОВ ==========
async function checkCriticalStats(precedingStory) {
    const crits = [];
    for (const [key, value] of Object.entries(state.stats)) {
        if (STATS_INFO[key] && (value <= 0 || value >= 10)) {
            crits.push({
                stat: key,
                value,
                name: STATS_INFO[key].name,
                low: STATS_INFO[key].low,
                high: STATS_INFO[key].high
            });
        }
    }
    if (crits.length === 0) return false;
    if (state.difficulty === 'normal' && state.miracleAvailable && !state.miracleUsed) {
        state.miracleUsed = true;
        state.miracleAvailable = false;
        for (const c of crits) {
            if (c.value <= 0) state.stats[c.stat] = 3;
            else if (c.value >= 10) state.stats[c.stat] = 7;
        }
        await generateMiracleStory(crits, precedingStory);
        return true;
    }
    state.gameOver = true;
    await generateGameOverStory(crits, precedingStory);
    return true;
}

async function generateMiracleStory(crits, precedingStory) {
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    const npcsDesc = state.npcs.map((n) => `- ${n.name}: ${n.desc}`).join('\n');
    const choicesCount = getChoicesCount();
    const critsDesc = crits.map((c) => `- ${c.name}: ${c.value <= 0 ? c.low : c.high} (было ${c.value}/10, откатилось до ${c.value <= 0 ? 3 : 7}/10)`).join('\n');
    const summaryBlock = state.lifeSummary ? `\n=== ИСТОРИЯ ЖИЗНИ ===\n${state.lifeSummary}\n` : '';

    let choicesTemplate = '';
    const exampleTexts = [
        'Пойти к Серёге и попросить помощи',
        'Промолчать и проглотить обиду',
        'Рассказать маме правду',
        'Взять дело в свои руки'
    ];
    for (let i = 1; i <= choicesCount; i++) {
        const ex = exampleTexts[i - 1] || `Подробное описание действия ${i}`;
        choicesTemplate += `{"text": "${ex}", "action": "Подробная инструкция"}`;
        if (i < choicesCount) choicesTemplate += ',\n';
    }

    const systemPrompt = `Ты мастер драматических RPG. Произошло ЧУДЕСНОЕ СПАСЕНИЕ.

=== ГЕРОЙ ===
Пол: ${genderInfo.name}, Возраст: ${state.age}, Локация: ${locInfo.fullName} — ${locInfo.desc}

=== КРИТИЧЕСКИЕ ПАРАМЕТРЫ ===
${critsDesc}

=== БЛИЗКИЕ ЛЮДИ ===
${npcsDesc || 'Никого'}

${summaryBlock}

=== ЧТО ПРОИЗОШЛО ===
${precedingStory}

Задача: Напиши ПРОДОЛЖЕНИЕ — чудесное спасение (3-4 абзаца) и ${choicesCount} варианта действий ПОСЛЕ спасения. Варианты должны учитывать НОВУЮ ситуацию.

ОТВЕТ JSON: { "miracle_story": "...", "choices": [${choicesTemplate}] }`;

    try {
        const completion = await callLLM({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Продолжи историю' }
            ],
            modelKind: 'main',
            response_format: { type: 'json_object' }
        });
        const data = parseJSON(completion?.choices?.[0]?.message?.content, 'Запрос (сводка/финал/др.)');
        if (data?.miracle_story) {
            state.lastMiracle = data.miracle_story;
            if (data.choices) state.lastChoices = data.choices;
        }
    } catch (e) {
        console.error('Miracle error:', e);
        state.lastMiracle = 'Но судьба смилостивилась. Каким-то чудом всё обошлось...';
        state.lastChoices = [
            { text: 'Попытаться осмыслить произошедшее', action: 'Герой пытается понять, что произошло' },
            { text: 'Поблагодарить того, кто помог', action: 'Герой благодарит спасителя' },
            { text: 'Двигаться дальше', action: 'Герой решает забыть' }
        ];
        if (getChoicesCount() === 4) {
            state.lastChoices.push({ text: 'Извлечь урок', action: 'Решает изменить жизнь' });
        }
    }
}

async function generateGameOverStory(crits, precedingStory) {
    // Полная история = архив + хвост
    const archivePartGO = state.dialogArchive ? `=== АРХИВ (сжато) ===\n${state.dialogArchive}\n\n` : '';
    const fullHistory = archivePartGO + state.history
        .map((h) => h.role === 'user' ? `>> ${h.content} <<` : (h.original || h.enhanced || h.content))
        .join('\n\n');
    const npcsDesc = state.npcs.map((n) => `- ${n.name}: ${n.desc}`).join('\n');
    const invDesc = state.inventory.map((i) => `- ${i.name}: ${i.desc}`).join('\n');
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    const critsDesc = crits.map((c) => `- ${c.name}: ${c.value <= 0 ? c.low : c.high} (значение ${c.value}/10)`).join('\n');
    const summaryBlock = state.lifeSummary ? `\n=== КРАТКАЯ ИСТОРИЯ ===\n${state.lifeSummary}\n` : '';

    const systemPrompt = `Ты мастер драматических RPG. Игра завершена трагически.

=== ГЕРОЙ ===
Пол: ${genderInfo.name}, Возраст: ${state.age}, Локация: ${locInfo.fullName} — ${locInfo.desc}

=== КРИТИЧЕСКИЕ ПАРАМЕТРЫ ===
${critsDesc}

=== БЛИЗКИЕ ЛЮДИ ===
${npcsDesc || 'Никого'}

=== ВЕЩИ ===
${invDesc || 'Ничего'}

${summaryBlock}

=== ЧТО ПРОИЗОШЛО ===
${precedingStory}

=== НЕДАВНЯЯ ИСТОРИЯ ===
${fullHistory}

Задача: Напиши ТРАГИЧЕСКИЙ ЭПИЛОГ (7-10 абзацев), продолжающий историю. Объясни причины, опиши последствия для каждого близкого. Не выдумывай новых персонажей.

ОТВЕТ JSON: { "epilogue": "...", "reasons": ["..."], "epitaph": "..." }`;

    try {
        const completion = await callLLM({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Напиши трагический финал' }
            ],
            modelKind: 'main',
            response_format: { type: 'json_object' }
        });
        const data = parseJSON(completion?.choices?.[0]?.message?.content, 'Запрос (сводка/финал/др.)');
        if (data) state.gameOverData = data;
    } catch (e) {
        console.error('Game Over error:', e);
        state.gameOverData = {
            epilogue: `Судьба ${genderInfo.name} оборвалась в ${state.age} лет.`,
            reasons: crits.map((c) => `${c.name} достиг критического уровня`),
            epitaph: 'Эпоха перемен забрала рано'
        };
    }
}

// ========== ПРИМЕНЕНИЕ ОБНОВЛЕНИЙ ==========
function getCurrentDateString() {
    return `${SEASONS[state.seasonIdx]} ${state.year}`;
}

// Извлекает числовые дельты из объекта updates, беря ПЕРВОЕ значение при дублировании.
// JSON.parse при дублировании ключей берёт последнее — это ломает нас когда модель
// при дописывании повторяет ключи с нулями.
function extractFirstStatDeltas(u) {
    if (!u) return {};
    const result = {};
    for (const key of ['mind','body','family','friends','health','looks','wealth','authority']) {
        if (u[key] === undefined || typeof u[key] !== 'number') continue;
        let val = u[key];
        // Защита от абсолютных значений: если |val| > 2, то это скорее всего
        // абсолютный стат (7, 15, 20...) а не дельта.
        // Вычитаем текущее значение чтобы получить настоящую дельту.
        if (Math.abs(val) > 2) {
            const current = state.stats[key] ?? 5;
            const impliedDelta = val - current;
            console.warn(`updates.${key}=${val} выглядит как абсолютное значение (текущее=${current}), конвертируем в дельту ${impliedDelta > 0 ? '+' : ''}${impliedDelta}`);
            val = impliedDelta;
        }
        result[key] = val;
    }
    return result;
}

function applyUpdates(u) {
    if (!u) return;
    const rawDeltas = extractFirstStatDeltas(u);
    // Зажимаем каждую дельту до ±2
    const clamped = {};
    for (const key in state.stats) {
        if (rawDeltas[key] !== undefined) {
            let delta = rawDeltas[key];
            if (delta > 2) delta = 2;
            if (delta < -2) delta = -2;
            if (delta !== 0) clamped[key] = delta;
        }
    }

    // Бюджет суммы ≤ 3. Если превышен — берём самые значимые дельты, остальные отбрасываем.
    // Math.round при сильном масштабировании обнуляет ВСЕ дельты (баг), поэтому
    // вместо масштабирования используем жадный алгоритм по убыванию |delta|.
    const deltas = {};
    const totalRaw = Object.values(clamped).reduce((s, v) => s + Math.abs(v), 0);
    if (totalRaw <= 3) {
        Object.assign(deltas, clamped);
    } else {
        // Сортируем по убыванию важности (|delta|), затем заполняем бюджет
        const entries = Object.entries(clamped).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        let budget = 3;
        for (const [key, val] of entries) {
            if (budget <= 0) break;
            const abs = Math.abs(val);
            if (abs <= budget) {
                deltas[key] = val;
                budget -= abs;
            } else {
                // Частично вписываем остаток бюджета
                deltas[key] = val > 0 ? budget : -budget;
                budget = 0;
            }
        }
    }
    for (const key in deltas) {
        const delta = deltas[key];
        const current = state.stats[key];
        let apply = true;
        if (state.turnCount === 1) {
            apply = false;
            console.log(`Первый ход: изменение ${STATS_INFO[key]?.name || key} заблокировано (${current} → ${current + delta})`);
        } else {
            // ── ВЯЗКОСТЬ СТАТОВ ──
            // Блокируется только движение ОТ центра (5) — всё дальше к краям.
            // Движение К центру — никогда не блокируется.
            //
            // Формула: p = max(decay^dist, floor)
            // Параметры подобраны так чтобы при целенаправленном движении +1 каждый ход:
            //   Normal:   ~16 ходов от 5 до game over  (season)
            //   Hardcore: ~12 ходов от 5 до game over  (season)
            //
            // Шансы по шагам (season):
            //   Normal  (decay=0.62): 6→7:62% 7→8:38% 8→9:24% 9→10:15%
            //   Hardcore(decay=0.69): 6→7:69% 7→8:48% 8→9:33% 9→10:23%
            // Годовой темп: decay^0.7 — чуть мягче (ход охватывает больше времени)
            const movingAwayFromCenter = (delta > 0 && current >= 5) || (delta < 0 && current <= 5);
            if (movingAwayFromCenter) {
                const dist = Math.abs(current - 5); // 1..5
                const decay = state.difficulty === 'hardcore'
                    ? (state.pace === 'season' ? 0.69 : Math.pow(0.69, 0.7))
                    : (state.pace === 'season' ? 0.62 : Math.pow(0.62, 0.7));
                const floor = 0.10; // минимум 10% — дотянуться до края всегда возможно
                const chance = Math.max(Math.pow(decay, dist), floor);
                apply = Math.random() < chance;
                if (!apply) console.log(`Вязкость [${state.difficulty}/${state.pace}]: ${STATS_INFO[key]?.name || key} (${current}→${current + delta}) dist=${dist} шанс=${(chance*100).toFixed(0)}%`);
            }
            // Движение к центру: никогда не блокируется
        }
        if (apply) {
            state.stats[key] = Math.max(0, Math.min(10, current + delta));
        }
    }
    if (u.add_item?.name && !state.inventory.find((i) => i.name === u.add_item.name)) {
        state.inventory.push({ name: u.add_item.name, desc: u.add_item.desc || 'Без описания' });
    }
    if (u.remove_item && typeof u.remove_item === 'string') {
        state.inventory = state.inventory.filter((i) => i.name !== u.remove_item);
    }
    if (u.update_item?.name) {
        const item = state.inventory.find((i) => i.name === u.update_item.name);
        if (item && u.update_item.desc) {
            item.desc += `\n\n*(${getCurrentDateString()})* ${u.update_item.desc}`;
        }
    }
    if (u.add_npc?.name && !state.npcs.find((n) => n.name === u.add_npc.name)) {
        state.npcs.push({ name: u.add_npc.name, desc: u.add_npc.desc || 'Без описания' });
    }
    if (u.remove_npc && typeof u.remove_npc === 'string') {
        state.npcs = state.npcs.filter((n) => n.name !== u.remove_npc);
    }
    if (u.update_npc?.name) {
        const npc = state.npcs.find((n) => n.name === u.update_npc.name);
        if (npc && u.update_npc.desc) {
            npc.desc += `\n\n*(${getCurrentDateString()})* ${u.update_npc.desc}`;
        }
    }
}

// ========== АТМОСФЕРНЫЕ ПАНЕЛИ (NPC / Items) ==========
function openLorePanel(panel) {
    if (!panel) return;
    openOverlay(panel, panel.querySelector('.lore-panel__close'));
}
function closeLorePanel(panel) {
    closeOverlay(panel);
}
function setupLorePanels() {
    els.npcsTrigger?.addEventListener('click', () => { renderNpcPanel(); openLorePanel(els.npcsPanel); });
    els.itemsTrigger?.addEventListener('click', () => { renderItemsPanel(); openLorePanel(els.itemsPanel); });
    els.npcsBackdrop?.addEventListener('click', () => closeLorePanel(els.npcsPanel));
    els.itemsBackdrop?.addEventListener('click', () => closeLorePanel(els.itemsPanel));
    els.npcsClose?.addEventListener('click', () => closeLorePanel(els.npcsPanel));
    els.itemsClose?.addEventListener('click', () => closeLorePanel(els.itemsPanel));
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        const topRoot = getTopDialogRoot();
        if (topRoot === els.npcsPanel) {
            event.preventDefault();
            closeLorePanel(els.npcsPanel);
        } else if (topRoot === els.itemsPanel) {
            event.preventDefault();
            closeLorePanel(els.itemsPanel);
        }
    });
}

// На узких экранах досье открывается поверх длинной истории. Так игроку не
// приходится прокручивать несколько экранов вниз, чтобы проверить состояние.
function setupSidebarDrawer() {
    if (!els.gameSidebar || !els.gameStatusBtn) return;
    const compactViewport = window.matchMedia('(max-width: 1080px)');
    let returnFocus = null;

    const syncA11y = () => {
        const isOpen = document.body.classList.contains('sidebar-drawer-open');
        const isCompact = compactViewport.matches;
        els.gameStatusBtn.setAttribute('aria-expanded', String(isOpen));
        els.gameSidebar.setAttribute('aria-hidden', String(isCompact && !isOpen));
        els.gameSidebar.inert = isCompact && !isOpen;
        if (isCompact) {
            els.gameSidebar.setAttribute('role', 'dialog');
            els.gameSidebar.setAttribute('aria-modal', 'true');
        } else {
            els.gameSidebar.removeAttribute('role');
            els.gameSidebar.removeAttribute('aria-modal');
        }
        if (!isCompact && isOpen) closeDrawer(false);
    };

    const openDrawer = () => {
        if (!compactViewport.matches) return;
        returnFocus = document.activeElement;
        document.body.classList.add('sidebar-drawer-open');
        syncA11y();
        els.gameSidebarClose?.focus();
    };

    function closeDrawer(restoreFocus = true) {
        document.body.classList.remove('sidebar-drawer-open');
        syncA11y();
        if (restoreFocus) returnFocus?.focus?.();
        returnFocus = null;
    }

    els.gameStatusBtn.addEventListener('click', openDrawer);
    els.gameSidebarClose?.addEventListener('click', () => closeDrawer());
    els.sidebarDrawerBackdrop?.addEventListener('click', () => closeDrawer());
    if (compactViewport.addEventListener) compactViewport.addEventListener('change', syncA11y);
    else compactViewport.addListener?.(syncA11y);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && openOverlayStack.length === 0 && document.body.classList.contains('sidebar-drawer-open')) {
            event.preventDefault();
            closeDrawer();
        }
    });
    syncA11y();
}

const NPC_ICON_MAP = {
    'Мама': 'person', 'Папа': 'person', 'Бабушка': 'person', 'Дедушка': 'person',
    'Брат': 'child', 'Сестра': 'girl', 'Дядя': 'person', 'Тётя': 'person'
};

function getNpcIcon(name = '') {
    for (const [key, icon] of Object.entries(NPC_ICON_MAP)) {
        if (name.includes(key)) return icon;
    }
    const n = name.toLowerCase();
    const animalWords = ['кот', 'кош', 'собак', 'пёс', 'шарик', 'жучка', 'тузик', 'рекс',
        'конь', 'лошад', 'коров', 'попугай', 'хомяк', 'черепах', 'тюлень', 'нерпа',
        'краб', 'чайка', 'олень', 'белка', 'голуб', 'дельфин'];
    return animalWords.some((word) => n.includes(word)) ? 'paw' : 'person';
}

function getItemIcon(name = '') {
    const n = name.toLowerCase();
    const has = (...words) => words.some((word) => n.includes(word));
    if (has('книга', 'энциклоп', 'букварь', 'журнал', 'тетрадь', 'дневник', 'стих', 'подшивка')) return 'book';
    if (has('нож', 'кинжал', 'шашка', 'лезвие', 'пистолет', 'пугач', 'лук', 'рогатка', 'арбалет', 'оружие')) return 'shield';
    if (has('мяч')) return 'ball';
    if (has('велосипед')) return 'bike';
    if (has('плеер', 'кассет', 'магнитофон', 'радио', 'телевизор')) return 'radio';
    if (has('телефон', 'пейджер', 'приставка', 'картридж', 'игра')) return 'gamepad';
    if (has('ключ') && !has('гаечн')) return 'key';
    if (has('фото', 'альбом', 'камера')) return 'camera';
    if (has('медаль', 'значок', 'грамота')) return 'medal';
    if (has('деньги', 'рубл', 'копилк', 'монет')) return 'money';
    if (has('игрушк', 'кукла', 'мишка', 'заяц', 'плюшевый')) return 'sparkle';
    if (has('кепка', 'шапка', 'папаха', 'панама', 'куртка', 'платье', 'рубашка', 'свитер', 'штаны', 'колготки', 'кеды', 'кроссовки', 'обувь', 'сапог', 'валенки')) return 'shirt';
    if (has('варенье', 'мёд', 'конфет', 'хлеб', 'картошк', 'молоко', 'инжир', 'виноград', 'еда')) return 'food';
    if (has('камень', 'малахит', 'кристалл', 'самоцвет', 'янтар', 'аметист', 'хрустал', 'руда', 'ракушк', 'коралл')) return 'gem';
    if (has('отвёртк', 'молоток', 'гаечн', 'сверл', 'инструмент')) return 'tools';
    if (has('гитара', 'гармонь', 'барабан', 'баян', 'пианино')) return 'theatre';
    if (has('машинка', 'трактор', 'модель', 'самолёт')) return 'construction';
    if (has('шрам', 'синяк', 'ссадина', 'травма', 'болезнь', 'кашель', 'астма', 'заноза', 'ожог', 'укус', 'обморожен')) return 'health';
    if (has('письмо', 'записка', 'открытка')) return 'clipboard';
    return 'bag';
}

function renderNpcPanel() {
    if (!els.npcsGrid || !els.npcsEmpty) return;
    const npcs = state.npcs;
    if (!npcs?.length) {
        els.npcsGrid.innerHTML = '';
        els.npcsEmpty.style.display = 'block';
        return;
    }
    els.npcsEmpty.style.display = 'none';
    els.npcsGrid.innerHTML = npcs.map((npc, i) => `
        <div class="npc-card" style="animation: cardRise 0.45s ease forwards; animation-delay: ${i * 0.05}s;">
            <div class="npc-card__portrait">${uiIcon(getNpcIcon(npc.name), npc.name)}</div>
            <div class="npc-card__name">${escapeHTML(npc.name)}</div>
            <div class="npc-card__desc">${renderMarkdown(npc.desc || '')}</div>
        </div>
    `).join('');
}
function renderItemsPanel() {
    if (!els.itemsGrid || !els.itemsEmpty) return;
    const items = state.inventory;
    if (!items?.length) {
        els.itemsGrid.innerHTML = '';
        els.itemsEmpty.style.display = 'block';
        return;
    }
    els.itemsEmpty.style.display = 'none';
    els.itemsGrid.innerHTML = items.map((item, i) => `
        <div class="item-card" style="animation: cardRise 0.45s ease forwards; animation-delay: ${i * 0.05}s;">
            <div class="item-card__icon">${uiIcon(getItemIcon(item.name), item.name)}</div>
            <div class="item-card__name">${escapeHTML(item.name)}</div>
            <div class="item-card__desc">${renderMarkdown(item.desc || '')}</div>
        </div>
    `).join('');
}

// ========== ОТРИСОВКА ==========
function renderUI() {
    const locInfo = getLocationInfo();
    const providerCfg = getProviderConfig();
    const archiveEntry = getSelectedArchiveEntry();
    const archiveMode = isArchiveMode();

    applyVisualMood('game');
    renderProviderSwitcher();
    renderArchiveStrip();
    clearTurnNotice();

    const shownDate = archiveEntry?.dateLabel || getDateLabel();
    const shownAge = archiveEntry?.age ?? state.age;
    els.dateText.innerText = `${shownDate} | ${shownAge} лет`;
    els.locationDisplay.innerHTML = `${uiIcon(locInfo.icon || 'pin')} ${escapeHTML(locInfo.fullName)}`;

    let modeHTML = '';
    if (archiveMode) {
        modeHTML += `<span class="summary-badge">${uiIcon('book')} Архив</span>`;
    } else if (state.lifeSummary) {
        modeHTML += `<span class="summary-badge">${uiIcon('clipboard')} Сводка: ход ${state.lastSummaryTurn}</span>`;
    }
    els.modeDisplay.innerHTML = modeHTML;
    renderStatusGraphic();

    const storyMarkup = buildArchiveStoryMarkup(archiveEntry);
    const recordTurn = archiveEntry?.turn ?? state.turnCount;
    const hasStory = Boolean((archiveEntry?.storyEnhanced || archiveEntry?.storyOriginal || archiveEntry?.story || state.lastStory || '').trim());
    const recordKind = archiveMode ? 'Архивная запись' : 'Текущая запись';
    const recordNumber = Number.isFinite(Number(recordTurn)) && Number(recordTurn) > 0
        ? `Ход ${String(recordTurn).padStart(2, '0')}`
        : 'Первый ход';
    const recordMeta = `${shownAge} лет · ${locInfo.fullName}`;
    const recordHeader = hasStory ? `
        <header class="story-record-header" aria-label="Сведения о записи">
            <span class="story-record-header__kind">${recordKind}</span>
            <span class="story-record-header__number">${recordNumber}</span>
            <time class="story-record-header__context">${escapeHTML(shownDate)} · ${escapeHTML(recordMeta)}</time>
        </header>
    ` : '';
    els.story.innerHTML = recordHeader + storyMarkup;
    updateContinueReadingButton();

    els.choices.innerHTML = '';
    if (els.choicesWrap) {
        els.choicesWrap.style.display = archiveMode ? 'none' : '';
    }

    if (!archiveMode) {
        if (state.gameOver) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-btn choice-btn--danger';
            btn.innerHTML = `
                <span class="choice-btn__body choice-btn__body--single">
                    <span class="choice-btn__title">Начать новую жизнь</span>
                </span>
                <span class="choice-btn__arrow" aria-hidden="true">↺</span>
            `;
            btn.onclick = window.requestResetGame;
            els.choices.appendChild(btn);
        } else if (state.lastChoices) {
            // Ярлык показываем только когда игрок действительно выбирает действие.
            const choicesLabel = document.createElement('div');
            choicesLabel.className = 'choices-label';
            choicesLabel.textContent = 'Что ты сделаешь?';
            els.choices.appendChild(choicesLabel);

            // Плашка финальных сдвигов статов (после фильтров вязкости)
            if (state.lastStatDeltas && Object.keys(state.lastStatDeltas).length > 0) {
                const deltaBar = document.createElement('div');
                deltaBar.className = 'stat-delta-bar';
                const chips = Object.entries(state.lastStatDeltas).map(([key, diff]) => {
                    const info = STATS_INFO[key];
                    const name = info?.name || key;
                    const sign = diff > 0 ? '+' : '';
                    const cls  = diff > 0 ? 'stat-delta-chip stat-delta-chip--up'
                                          : 'stat-delta-chip stat-delta-chip--down';
                    return `<span class="${cls}">${escapeHTML(name)} ${sign}${diff}</span>`;
                }).join('');
                deltaBar.innerHTML = chips;
                els.choices.appendChild(deltaBar);
            }

            const turnsLeft = DAILY_TURNS_PER_STORY_LIMIT - getStoryTurnsToday(state.storyId);
            const quotaNote = document.createElement('div');
            quotaNote.className = 'choices-label';
            quotaNote.style.opacity = '0.7';
            quotaNote.textContent = turnsLeft > 0
                ? `Ходов сегодня: ${getStoryTurnsToday(state.storyId)} из ${DAILY_TURNS_PER_STORY_LIMIT}`
                : quotaTurnMessage(state.storyId);
            els.choices.appendChild(quotaNote);

            if (turnsLeft <= 0) {
                const wait = document.createElement('div');
                wait.className = 'story-notice';
                wait.innerHTML = `<div class="story-notice__body"><strong>Лимит на сегодня</strong><p>${escapeHTML(quotaTurnMessage(state.storyId))}</p></div>`;
                els.choices.appendChild(wait);
            } else {
            state.lastChoices.forEach((choice, index) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'choice-btn';
                btn.innerHTML = buildChoiceMarkup(choice, index);
                btn.onclick = () => turn(choice.action || choice.text);
                els.choices.appendChild(btn);
            });
            }
        }
    }

    els.stats.innerHTML = '';
    for (const [key, value] of Object.entries(state.stats)) {
        if (!STATS_INFO[key]) continue;
        const toneClass = getStatClass(value);
        const visual = STAT_VISUALS[key] || { icon: 'target', short: 'состояние' };
        const meterLeft = Math.min(value, 5) * 10;
        const meterWidth = Math.abs(value - 5) * 10;
        const riskHint = value < 5 ? STATS_INFO[key].low : value > 5 ? STATS_INFO[key].high : 'Сейчас показатель в условном балансе.';
        els.stats.innerHTML += `
            <div class="stat-card ${toneClass}" title="${escapeHTML(riskHint)}">
                <div class="stat-card__top">
                    <div class="stat-card__label">
                        <span class="stat-card__icon">${uiIcon(visual.icon)}</span>
                        <div>
                            <div class="stat-card__name">${escapeHTML(STATS_INFO[key].name)}</div>
                            <div class="stat-card__desc">${escapeHTML(getStatDescriptor(value))}</div>
                        </div>
                    </div>
                    <span class="stat-card__value ${toneClass}" aria-label="${value} из 10">${value}</span>
                </div>
                <div class="stat-meter" role="meter" aria-label="${escapeHTML(STATS_INFO[key].name)}" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${value}">
                    <span class="stat-meter__center" aria-hidden="true"></span>
                    <span class="stat-meter__fill ${toneClass}" style="left:${meterLeft}%; width:${meterWidth}%"></span>
                </div>
            </div>
        `;
    }

    // sidebar count badges
    if (els.npcsCount) els.npcsCount.textContent = state.npcs.length;
    if (els.itemsCount) els.itemsCount.textContent = state.inventory.length;

    // refresh open panels
    if (els.npcsPanel && !els.npcsPanel.classList.contains('hidden')) renderNpcPanel();
    if (els.itemsPanel && !els.itemsPanel.classList.contains('hidden')) renderItemsPanel();

    maybeShowOnboarding();
}

function renderLoreList(container, items) {
    container.innerHTML = '';
    if (!items?.length) {
        container.innerHTML = `<div class="lore-empty">Пока пусто. В этой жизни ещё не накопилось следов.</div>`;
        return;
    }
    items.forEach((item, index) => {
        const d = document.createElement('details');
        d.className = 'lore-card';
        d.innerHTML = `
            <summary>
                <span class="lore-summary-main">
                    <span class="lore-chip">${String(index + 1).padStart(2, '0')}</span>
                    <span class="lore-title">${escapeHTML(item.name)}</span>
                </span>
                <span class="lore-expand">развернуть</span>
            </summary>
            <div class="lore-desc">${renderMarkdown(item.desc || 'Нет описания.')}</div>
        `;
        container.appendChild(d);
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========
function tryLoadSavedGame() {
    const saved = localStorage.getItem(STATE_STORAGE_KEY);
    if (!saved) return false;
    try {
        state = JSON.parse(saved);
        if (!state.locationType) {
            state.locationType = state.location || 'capital';
            state.region = 'central';
            state.city = 'moscow';
        }
        if (!state.provider) state.provider = getStoredProvider();
        // Доступен только Hydra — старые сохранения с hybrid/openrouter сбрасываем
        if (!LLM_PROVIDERS[state.provider]) state.provider = DEFAULT_PROVIDER;
        if (state.difficulty === undefined) state.difficulty = 'normal';
        if (state.miracleUsed === undefined) state.miracleUsed = false;
        if (state.miracleAvailable === undefined) state.miracleAvailable = state.difficulty === 'normal';
        if (state.turnCount === undefined) state.turnCount = 0;
        if (state.lifeSummary === undefined) state.lifeSummary = '';
        if (state.lastSummaryTurn === undefined) state.lastSummaryTurn = 0;
        if (state.stats?.wealth === undefined) state.stats.wealth = 5;
        if (state.stats?.authority === undefined) state.stats.authority = 5;
        if (!state.originalHistory) state.originalHistory = [];
        if (!state.enhancedHistory) state.enhancedHistory = [];
        if (!state.compressedSummary) state.compressedSummary = '';
        if (!state.lastCompressTurn) state.lastCompressTurn = 0;
        if (!state.dialogArchive) state.dialogArchive = '';
        if (!state.verbosity) state.verbosity = 'normal';
        if (!state.enhanceModel) state.enhanceModel = ENHANCE_MODEL_OPTIONS[0];
        if (!state.storyId) state.storyId = `legacy-${Date.now()}`;
        state.enhanceModel = 'glm-5.2';
        if (!state.lastDialogCompress) state.lastDialogCompress = 0;
        if (!state.archiveEntries) state.archiveEntries = [];
        if (state.archiveViewIndex === undefined) state.archiveViewIndex = null;
        backfillArchiveEntriesFromHistory();
        persistProviderChoice(state.provider);
        syncCurrentApiKey();
        els.setup.classList.add('hidden');
        els.game.classList.remove('hidden');
        renderUI();
        return true;
    } catch (e) {
        console.error('Ошибка загрузки сохранения:', e);
        localStorage.removeItem(STATE_STORAGE_KEY);
        return false;
    }
}

window.copyCurrentPeriodToClipboard = async function copyCurrentPeriodToClipboard() {
    try {
        const entry = getSelectedArchiveEntry();
        await copyArchiveEntryToClipboard(entry);
        showToast('Период скопирован');
    } catch (err) {
        console.error('Ошибка копирования периода:', err);
        showToast('Не удалось скопировать период', 'error');
    }
};

window.copyHistoryToClipboard = async function copyHistoryToClipboard() {
    try {
        let historyText = '';
        if (state.archiveEntries?.length) {
            historyText = state.archiveEntries.map((entry) => {
                let block = `${entry.dateLabel || `Ход ${entry.turn}`}`;
                if (entry.age) block += ` · ${entry.age} лет`;
                block += `\n\n${entry.storyEnhanced || entry.storyOriginal || ''}`;
                if (entry.miracleStory) block += `\n\n[Чудесное спасение]\n${entry.miracleStory}`;
                if (entry.gameOverData?.epilogue) block += `\n\n[Эпилог]\n${entry.gameOverData.epilogue}`;
                return block;
            }).join('\n\n---\n\n');
        } else if (state.enhancedHistory.length) {
            historyText = state.enhancedHistory.map((text, i) => `Ход ${i + 1}:\n${text}`).join('\n\n---\n\n');
        } else {
            historyText = 'История пока пуста.';
        }
        const locInfo = getLocationInfo();
        const header = `=== ЭПОХА ПЕРЕМЕН: 1993 ===\nПерсонаж: ${GENDER_INFO[state.gender].name}, ${state.age} лет\nЛокация: ${locInfo.fullName}\nДата: ${getDateLabel()}\nПровайдер: ${getProviderConfig().label}\n\n`;
        const statsText = Object.entries(state.stats).map(([k, v]) => `${STATS_INFO[k].name}: ${v}`).join(', ');
        await navigator.clipboard.writeText(header + `Текущие параметры: ${statsText}\n\n=== ИСТОРИЯ ===\n${historyText}`);
        showToast('Вся история скопирована');
    } catch (err) {
        console.error('Ошибка копирования:', err);
        showToast('Не удалось скопировать историю', 'error');
    }
};

loadStoredApiKeys();
applyReadingMode(getStoredReadingMode());
syncCurrentApiKey();
setupDialogFocusManagement();
setupProviderSwitcher();
setupSettingsModal();
setupResetConfirmation();
setupArchiveControls();
els.continueReadingBtn?.addEventListener('click', continueReadingFromBookmark);
window.addEventListener('scroll', trackReadingPosition, { passive: true });
setupLorePanels();
setupSidebarDrawer();
setupLoaderCancel();
renderProviderSwitcher();
updateApiKeyInput();
applyVisualMood('setup');

const savedGameLoaded = tryLoadSavedGame();

if (!savedGameLoaded) {
    els.setup.classList.remove('hidden');
    els.game.classList.add('hidden');

    const setupShell = document.getElementById('setup-shell');
    const setupShowcase = setupShell?.querySelector('.setup-showcase');
    const setupForm = document.getElementById('setup-form-wrap');
    const showSetupForm = () => {
        setupShell?.classList.add('setup-shell--started');
        setupShowcase?.classList.add('hidden');
        setupForm?.classList.remove('hidden');
        setupForm?.querySelector('button, select, input')?.focus();
        document.getElementById('setup-screen')?.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const showSetupCover = () => {
        setupShell?.classList.remove('setup-shell--started');
        setupForm?.classList.add('hidden');
        setupShowcase?.classList.remove('hidden');
        document.getElementById('setup-screen')?.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('setup-intro-btn')?.focus();
    };
    document.getElementById('setup-intro-btn')?.addEventListener('click', showSetupForm);
    document.getElementById('setup-cover-btn')?.addEventListener('click', showSetupCover);

    els.regionSelect.value = state.region;
    els.citySelect.value = state.city;
    els.startAge.value = String(state.startAge);

    setupOptionButtons('gender-btns', 'gender');
    setupOptionButtons('location-type-btns', 'locationType', () => {
        updateLocationDescription();
        rollStartPreview();
    });
    setupOptionButtons('pace-btns', 'pace');
    setupOptionButtons('difficulty-btns', 'difficulty');
    setupOptionButtons('verbosity-btns', 'verbosity');

    els.regionSelect.onchange = (e) => {
        state.region = e.target.value;
        updateLocationDescription();
        rollStartPreview();
    };
    els.citySelect.onchange = (e) => {
        state.city = e.target.value;
        updateLocationDescription();
        rollStartPreview();
    };
    els.startAge.onchange = (e) => {
        state.startAge = parseInt(e.target.value, 10);
    };

    els.setupPrevBtn?.addEventListener('click', () => {
        setupStepIndex = Math.max(0, setupStepIndex - 1);
        renderSetupWizard();
    });
    els.setupNextBtn?.addEventListener('click', () => {
        setupStepIndex = Math.min(SETUP_STEPS.length - 1, setupStepIndex + 1);
        renderSetupWizard();
    });

    updatePaceInfo(state.pace);
    updateDifficultyInfo(state.difficulty);
    updateVerbosityInfo(state.verbosity);
    updateLocationDescription();
    rollStartPreview();
    renderSetupWizard();
}

els.startBtn.onclick = () => {
    if (!canStartNewStory()) {
        showToast(quotaStoryStartMessage(), 'error');
        return;
    }
    recordStoryStart();
    applyStartSettings();
    initGame();
};

// ========== ПЕРЕКЛЮЧАТЕЛЬ ТЕМЫ ==========
(function setupThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const THEME_KEY = 'rpg90_theme';
    const getTheme = () => {
        try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
    };
    const setTheme = (t) => {
        document.body.dataset.theme = t;
        try { localStorage.setItem(THEME_KEY, t); } catch {}
        // Иконка (солнце/месяц) переключается через CSS по body[data-theme].
        btn.setAttribute('aria-label', t === 'paper' ? 'Включить тёмную тему' : 'Включить светлую тему');
    };
    setTheme(getTheme());
    btn.addEventListener('click', () => {
        const next = (document.body.dataset.theme === 'paper') ? 'dark' : 'paper';
        setTheme(next);
    });
})();

// ========== ИЛЛЮСТРАЦИИ (OPENROUTER) ==========

function getFirstThreeParagraphs(text) {
    if (!text) return '';
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return paragraphs.slice(0, 3).join('\n\n');
}

async function callOpenRouterImageGeneration(promptText) {
    const providerApiKey = (userApiKeys.openrouter || '').trim();
    const requestBody = {
        model: 'google/gemini-3.1-flash-image-preview',
        messages: [
            {
                role: 'user',
                content: promptText
            }
        ],
        modalities: ['image', 'text'],
        image_config: {
            aspect_ratio: '3:4'
        }
    };

    let response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 280000); // 280 секунд тайм-аут

    try {
        response = await fetch('/api/openrouter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...requestBody,
                apiKey: providerApiKey || undefined
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(`HTTP ${response.status}: ${extractApiError(errData, 'нет данных от сервера')}`);
    }

    const result = await response.json();
    if (result.choices && result.choices[0]?.message) {
        const message = result.choices[0].message;
        if (message.images && message.images.length > 0) {
            return message.images[0].image_url.url; // Base64 data URL
        }
    }
    throw new Error('Изображение не найдено в ответе API.');
}

async function startIllustrationGenerationForEntry(entry) {
    console.log("startIllustrationGenerationForEntry called with entry turn:", entry?.turn);
    addSystemLog('startIllustrationGenerationForEntry', {turn: entry?.turn}, false);
    if (!entry) return;

    try {
        const text = entry.storyEnhanced || entry.storyOriginal || '';
        
        let pCount = entry.imgParas || 5;
        let paragraphs = text.split(/\n+/).filter(p => p.trim().length > 10).slice(0, pCount).join('\n\n');

        if (!paragraphs) {
            entry.illustrationStatus = 'failed';
            save();
            renderUI();
            return;
        }

        const genderName = GENDER_INFO[state.gender]?.name || 'герой';
        const ageText = `${entry.age || state.age} лет`;
        const characterDesc = `пол: ${genderName}, возраст: ${ageText}`;
        
        let stylePrompt = `Стиль: атмосферный и глубоко реалистичный снимок эпохи, имитирующий старую любительскую пленочную фотографию 1990-х годов или полароидный снимок (faded Polaroid snapshot). Характерное ретро-зерно пленки (film grain), слегка выцветшие приглушенные цвета, естественные тени, теплая ностальгическая дымка и аналоговое несовершенство кадра. Полное отсутствие глянца, современных элементов, текста, слов или подписей.`;
        
        if (entry.imgStyle === 'book') {
            stylePrompt = `Стиль: высокопрофессиональная книжная иллюстрация, шедевр книжной графики в традициях лучших советских художников-иллюстраторов 1980-х годов (в духе Владимирского, Владимирского или Диодорова). Виртуозное владение композицией, сложная многослойная техника (сочетание акварели, тонкой пастели и деликатного угля). Невероятно детализированная, глубокая, художественная и мастерски выполненная работа. Эстетика золотого века советской детской литературы. Никакой примитивности. Без текста и подписей.`;
        } else if (entry.imgStyle === 'child') {
            const adjustedAge = Math.max(3, (entry.age || state.age) - 1);
            stylePrompt = `Стиль: немного примитивный, наивный детский рисунок (рисовал ребенок ${adjustedAge} лет). Использованы дешевые фломастеры, ручка или обломки карандашей. Искаженные пропорции, без перспективы ("плоский" рисунок). Выход за контуры при раскрашивании, небрежные штрихи. Рисунок должен выглядеть несколько неуклюже, не опытно и аутентично по-детски. Нарисовано на мятом тетрадном листе. Без осмысленного текста.`;
        }

        const promptText = `Сделай вертикально ориентированную художественную иллюстрацию для этого фрагмента. 
Вид: строго от первого лица главного героя (${characterDesc}), показывающий сцену его глазами, но БЕЗ изображения его собственных рук, ног, пальцев или других частей тела в кадре. 
${stylePrompt}

Сама текстура и дух кадра должны сквозить эпохой 90-х в России.

Фрагмент текста:
${paragraphs}`;

        let base64Url = await callOpenRouterImageGeneration(promptText);
        
        try {
            base64Url = await downscaleImageBase64(base64Url, 800);
        } catch(err) {
            console.error('Ошибка сжатия:', err);
        }

        entry.illustration = base64Url;
        entry.illustrationStatus = 'success';
    } catch (e) {
        console.error('Ошибка генерации картинки:', e);
        entry.illustrationStatus = 'failed';
        refundImageLimit();
    }

    save();
    renderUI();
}

window.openIllustrationModal = function(base64Url) {
    const existing = document.getElementById('illustration-zoom-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'illustration-zoom-modal';
    modal.className = 'illustration-modal';
    modal.innerHTML = `
        <div class="illustration-modal__backdrop" aria-hidden="true"></div>
        <div class="illustration-modal__content" role="dialog" aria-modal="true" aria-label="Иллюстрация воспоминания" tabindex="-1">
            <button type="button" class="illustration-modal__close" aria-label="Закрыть">${uiIcon('close')}</button>
            <div class="illustration-modal__body">
                <img src="${base64Url}" class="illustration-modal__img" alt="Увеличенное изображение" />
            </div>
        </div>
    `;
    
    modal.querySelector('.illustration-modal__backdrop').onclick = window.closeIllustrationModal;
    modal.querySelector('.illustration-modal__close').onclick = window.closeIllustrationModal;
    modal.querySelector('.illustration-modal__img').onclick = window.closeIllustrationModal;

    document.body.appendChild(modal);
    openOverlay(modal, modal.querySelector('.illustration-modal__close'));
};

window.closeIllustrationModal = function() {
    const modal = document.getElementById('illustration-zoom-modal');
    if (modal) {
        releaseOverlay(modal);
        modal.classList.add('illustration-modal--closing');
        setTimeout(() => modal.remove(), 200);
    }
};

function checkImageLimitAndIncrement() {
    return true;
}

function refundImageLimit() {
    const today = new Date().toISOString().split('T')[0];
    try {
        const stored = localStorage.getItem('rpg90_image_limit');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && parsed.date === today) {
                parsed.count = Math.max(0, parsed.count - 1);
                localStorage.setItem('rpg90_image_limit', JSON.stringify(parsed));
            }
        }
    } catch (e) {}
}

window.downloadIllustration = function(dateLabel, base64Url) {
    const link = document.createElement('a');
    link.href = base64Url;
    link.download = `Эпоха_Перемен_${dateLabel.replace(/\s+/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.retryPolish = async function() {
    showToast('Полировка текста отключена', 'error');
};

window.startGenImg = function(turnStr, style) {
    if (!ILLUSTRATIONS_ENABLED) return; // иллюстрации временно отключены
    const turnNum = parseInt(turnStr, 10);
    const entry = state.archiveEntries.find(e => e.turn === turnNum);
    if (!entry) return;
    
    const radios = document.getElementsByName('img_paras_' + turnStr);
    let paras = 5;
    for (let r of radios) {
        if (r.checked) paras = parseInt(r.value, 10);
    }
    
    entry.imgStyle = style;
    entry.imgParas = paras;
    
    const canGenImg = checkImageLimitAndIncrement();
    if (canGenImg) {
        entry.illustrationStatus = 'loading';
        save();
        renderUI();
        startIllustrationGenerationForEntry(entry);
    } else {
        entry.illustrationStatus = 'limit_reached';
        save();
        renderUI();
    }
};

window.retryGenImg = function(turnStr) {
    if (!ILLUSTRATIONS_ENABLED) return; // иллюстрации временно отключены
    const turnNum = parseInt(turnStr, 10);
    const entry = state.archiveEntries.find(e => e.turn === turnNum);
    if (!entry) return;
    entry.illustrationStatus = 'pending';
    save();
    renderUI();
};

window.selectImgStyle = function(turnStr, style, btnElem) {
    const group = document.getElementById('img-style-group-' + turnStr);
    if (group) {
        const buttons = group.querySelectorAll('button');
        buttons.forEach((button) => setToggleSelected(button, button === btnElem));
    }
    const valInput = document.getElementById('img-style-val-' + turnStr);
    if (valInput) valInput.value = style;
};

window.startGenImgUI = function(turnStr) {
    const styleVal = document.getElementById('img-style-val-' + turnStr)?.value || 'photo';
    window.startGenImg(turnStr, styleVal);
};

// ========== ИНСПЕКТОР ПРОМПТА ==========

(function setupPromptInspector() {
    const fab       = document.getElementById('prompt-fab');
    const modal     = document.getElementById('prompt-modal');
    const closeBtn  = document.getElementById('prompt-close-btn');
    const backdrop  = document.getElementById('prompt-backdrop');
    const copyBtn   = document.getElementById('prompt-copy-btn');
    const refreshBtn= document.getElementById('prompt-refresh-btn');
    const content   = document.getElementById('prompt-content');
    const metaTurns = document.getElementById('prompt-meta-turns');
    const metaChars = document.getElementById('prompt-meta-chars');
    const metaMsgs  = document.getElementById('prompt-meta-msgs');
    const metaAction= document.getElementById('prompt-meta-action');
    const tabBtns   = document.querySelectorAll('.prompt-tab-btn');

    let currentTab = 'main'; // 'main' | 'structure' | 'enhance'

    // ---------- вспомогательные функции ----------

    /** Собирает тот же массив сообщений что идёт в callLLM на основном ходу,
     *  но НЕ делает реального запроса. Возвращает { messages, action }. */
    function buildInspectorPayload() {
        // Определяем "симулированный" выбор игрока:
        // первый из текущих lastChoices, либо заглушка для старта игры
        let simulatedAction = 'Начало игры. Опиши обстановку и представь героя.';
        if (state.lastChoices && state.lastChoices.length > 0) {
            const first = state.lastChoices[0];
            simulatedAction = first.action || first.text || simulatedAction;
        }

        const { nextSeasonIdx, nextYear } = getNextTime();
        const nextSeasonName = SEASONS[nextSeasonIdx];

        // Инспектор использует ту же логику что и реальный turn()
        const systemPromptI    = buildStorySystemPrompt(nextSeasonName, nextYear);
        const archiveBlockI    = state.dialogArchive
            ? '\n\n=== АРХИВ ИСТОРИИ (сжато) ===\n' + state.dialogArchive + '\n=== КОНЕЦ АРХИВА ==='
            : '';
        const fullSystemPrompt = systemPromptI + archiveBlockI;

        const historyForLLM = state.history.map((msg) => {
            if (msg.role === 'assistant') {
                return { role: 'assistant', content: msg.enhanced || msg.original || msg.content };
            }
            return { role: 'user', content: msg.content };
        });

        const messagesMain = [
            { role: 'system',    content: fullSystemPrompt },
            ...historyForLLM,
            { role: 'user', content: `Мой выбор: ${simulatedAction}. (Сгенерируй атмосферно описанный результат и переход в ${nextSeasonName} ${nextYear})` }
        ];

        return { messagesMain, simulatedAction, nextSeasonName, nextYear };
    }

    /** Строит промпт для Шага 2 (анализ и генерация выборов/апдейтов) */
    function buildStructurePayload(simulatedAction, nextSeasonName, nextYear) {
        const choicesCount = getChoicesCount();
        const placeholderStory = `[⚠ ЗАГЛУШКА: реальный текст 1-го прохода появится после запроса]\nСимулированный выбор: «${simulatedAction}»`;
        const structureSystemPrompt = buildStructureSystemPrompt(placeholderStory, nextSeasonName, nextYear, choicesCount);
        return [
            { role: 'system', content: structureSystemPrompt },
            { role: 'user', content: 'Проанализируй историю выше и верни JSON со сдвигами параметров и новыми выборами.' }
        ];
    }

    /** Строит промпт для 3-го прохода (полировки) — точная копия логики из turn().
     *  originalStory заменена заглушкой, т.к. реального ответа 1-го прохода ещё нет. */
    function buildEnhancePayload(simulatedAction) {
        const npcList  = state.npcs.map((n) => `- ${n.name}: ${n.desc}`).join('\n');
        const itemList = state.inventory.map((i) => `- ${i.name}: ${i.desc}`).join('\n');
        const summary  = state.lifeSummary ? `Краткая история жизни: ${state.lifeSummary}` : '';

        // statsGuidance — точная копия из turn()
        let statsGuidance = '';
        for (const [key, val] of Object.entries(state.stats)) {
            const info = STATS_INFO[key];
            if (!info || val === 5) continue;
            let levelDesc = '';
            if (val === 4)      levelDesc = `У героя слегка низкий параметр ${info.name}. Лёгкий намёк в тексте, без трагизма.`;
            else if (val === 6) levelDesc = `У героя слегка высокий параметр ${info.name}. Лёгкий намёк в тексте, без трагизма.`;
            else if (val === 3) levelDesc = `У героя тревожно низкий параметр ${info.name}. Сам он не видит проблемы, но проблемы есть. Отрази это.`;
            else if (val === 7) levelDesc = `У героя тревожно высокий параметр ${info.name}. Сам он не видит проблемы, но проблемы есть. Отрази это.`;
            else if (val === 2) levelDesc = `У героя очень низкий параметр ${info.name}. Красной нитью по всему тексту.`;
            else if (val === 8) levelDesc = `У героя очень высокий параметр ${info.name}. Красной нитью по всему тексту.`;
            else if (val <= 1 || val >= 9) {
                const critical = val <= 1 ? 'критически низкий' : 'критически высокий';
                levelDesc = `У героя ${critical} параметр ${info.name}. Значительная часть текста должна быть обращена к этому.`;
            }
            if (levelDesc) statsGuidance += levelDesc + '\n';
        }

        // canonTail + archiveForEnhance — точная копия из turn()
        const canonTail = state.history.slice(-4).map(m => {
            if (m.role === 'user') return `>> Выбор игрока: ${m.content} <<`;
            return m.enhanced || m.original || m.content || '';
        }).join('\n\n');

        const archiveForEnhance = state.dialogArchive
            ? `\n=== АРХИВ ИСТОРИИ (канон, сжато) ===\n${state.dialogArchive}\n=== КОНЕЦ АРХИВА ===\n`
            : '';

        const canonBlock = canonTail
            ? `\n=== ПОСЛЕДНИЕ ХОДЫ (канон, дословно) ===\n${canonTail}\n=== КОНЕЦ ===\n`
            : '';

        const placeholderStory = `[⚠ ЗАГЛУШКА: реальный текст 1-го прохода появится после запроса]\nСимулированный выбор: «${simulatedAction}»`;

        const enhancementPrompt = `Придумай 4 случайных слова.  Затем ассоциативно свободно используй их как источник случайности, чтобы создать разнообразный, небанальный и качественный ответ на задачу. Ты не должен употреблять придуманные слова - они лишь источник большего разнообразия конечных токенов твоего ответа: Ты мастер социально-драматической художественной текстовой игры про детство в 1990-х. Ниже текст — насыть его аутентичными и интересными запоминающимися диалогами и описаниями. Исправь очевидные ляпы, ориентируйся на предыдущую историю как на абсолютный канон. Не пиши предисловий и послесловий. Не используй пост-знания и мета-размышления героя об эпохе. Повествование должно исходить изнутри эпохи, а не над эпохой.

ВАЖНО: СТРОЖАЙШИЙ ЗАПРЕТ на избыток длинных тире (—). Не используй тире чаще одного раза на абзац.

ТЕКСТ ДЛЯ УЛУЧШЕНИЯ:

${placeholderStory}

Контекст для понимания (справочно):
- знакомые люди:
${npcList || 'Нет'}
- предметы:
${itemList || 'Нет'}
${summary ? '\n' + summary : ''}
${archiveForEnhance}${canonBlock}${statsGuidance ? `\nОсобые указания по параметрам:\n${statsGuidance}` : ''}`;

        return [{ role: 'user', content: enhancementPrompt }];
    }

    /** Форматирует массив messages в читаемый текст для отображения */
    function formatMessages(messages) {
        return messages.map((m, i) => {
            const roleLabel = {
                system:    '╔══ SYSTEM ══╗',
                user:      '╔══ USER ══╗',
                assistant: '╔══ ASSISTANT ══╗'
            }[m.role] || `╔══ ${m.role.toUpperCase()} ══╗`;
            const sep = '─'.repeat(72);
            return `${sep}\n[${i + 1}] ${roleLabel}\n${sep}\n${m.content}\n`;
        }).join('\n') + '\n' + '─'.repeat(72);
    }

    /** Обновляет содержимое модального окна */
    function renderPromptInspector() {
        if (!state) {
            content.textContent = '— Игра ещё не инициализирована —';
            return;
        }

        const { messagesMain, simulatedAction, nextSeasonName, nextYear } = buildInspectorPayload();

        let messages, tabLabel, modelKindForTab;
        if (currentTab === 'enhance') {
            messages = buildEnhancePayload(simulatedAction);
            tabLabel = 'Шаг 3: Полировка (ручная) — enhance-модель';
            modelKindForTab = 'enhance';
        } else if (currentTab === 'structure') {
            messages = buildStructurePayload(simulatedAction, nextSeasonName, nextYear);
            tabLabel = 'Шаг 2: Анализ/Выборы — main-модель';
            modelKindForTab = 'main';
        } else {
            messages = messagesMain;
            tabLabel = 'Шаг 1: Сюжет — main-модель';
            modelKindForTab = 'main';
        }

        const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
        const approxTokens = Math.round(totalChars / 3.8);

        // Мета-строка
        if (metaTurns)  metaTurns.textContent  = `ход: ${state.turnCount} → ${state.turnCount + 1}`;
        if (metaChars)  metaChars.textContent   = `~${approxTokens.toLocaleString()} токенов (${totalChars.toLocaleString()} симв.)`;
        if (metaMsgs)   metaMsgs.textContent    = `сообщений: ${messages.length}`;
        if (metaAction) metaAction.textContent  = `симул. выбор: «${simulatedAction.substring(0, 60)}${simulatedAction.length > 60 ? '…' : ''}»`;

        content.textContent = `═══ ${tabLabel} ═══\nМодель: ${getProviderModel(modelKindForTab)}\nПровайдер: ${getProviderConfig().label}\n\n` + formatMessages(messages);
    }

    // ---------- Tab switching ----------
    const promptTabs = [...tabBtns];
    function activatePromptTab(tab, moveFocus = false) {
        currentTab = tab;
        promptTabs.forEach((button) => {
            const isActive = button.dataset.tab === currentTab;
            button.style.background  = isActive ? 'var(--amber,#e8b061)' : 'var(--paper-2,#26201a)';
            button.style.color       = isActive ? 'var(--paper-0,#0c0a08)' : 'var(--ink-soft)';
            button.style.borderColor = isActive ? 'var(--line-warm,#c98a3a)' : 'var(--line-strong)';
            button.classList.toggle('selected', isActive);
            button.setAttribute('aria-selected', String(isActive));
            button.tabIndex = isActive ? 0 : -1;
            if (isActive) {
                content.setAttribute('aria-labelledby', button.id);
                if (moveFocus) button.focus();
            }
        });
        renderPromptInspector();
    }

    promptTabs.forEach((button, index) => {
        button.addEventListener('click', () => activatePromptTab(button.dataset.tab));
        button.addEventListener('keydown', (event) => {
            let nextIndex = null;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % promptTabs.length;
            if (event.key === 'ArrowLeft') nextIndex = (index - 1 + promptTabs.length) % promptTabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = promptTabs.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            activatePromptTab(promptTabs[nextIndex].dataset.tab, true);
        });
    });

    // ---------- Open / Close ----------
    function openModal() {
        renderPromptInspector();
        openOverlay(modal, closeBtn);
    }
    function closeModal() {
        closeOverlay(modal);
    }

    fab?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    backdrop?.addEventListener('click', closeModal);
    refreshBtn?.addEventListener('click', renderPromptInspector);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && getTopDialogRoot() === modal) {
            event.preventDefault();
            closeModal();
        }
    });

    // ---------- Copy ----------
    copyBtn?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(content.textContent);
            const orig = copyBtn.textContent;
            copyBtn.textContent = 'Скопировано';
            setTimeout(() => { copyBtn.textContent = orig; }, 1800);
        } catch {
            copyBtn.textContent = 'Ошибка';
            setTimeout(() => { copyBtn.textContent = 'Копировать'; }, 1800);
        }
    });
})();
