// ========== ИМПОРТЫ И КОНФИГУРАЦИЯ ==========
import OpenAI from 'https://cdn.jsdelivr.net/npm/openai@4.28.0/+esm';
import {
    MODEL, SEASONS, HISTORY_LIMIT, SUMMARY_INTERVAL,
    STATS_INFO, GENDER_INFO,
    LOCATION_TYPES, REGIONS, CITIES, LOCATION_DETAILS,
    NPC_POOLS, ITEM_POOLS
} from './constants.js';

// ========== СОСТОЯНИЕ ИГРЫ ==========

// Начальное состояние по умолчанию (обновлено с новыми полями)
const DEFAULT_STATE = {
    gender: 'male',
    locationType: 'capital',  // village, town, capital
    region: 'central',        // для сел и городов
    city: 'moscow',           // для столиц
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
    gameOver: false,
    miracleUsed: false,
    miracleAvailable: true,
    turnCount: 0,
    lifeSummary: "",
    lastSummaryTurn: 0
};

// Текущее состояние игры
let state = { ...DEFAULT_STATE };
let openai = null;
let generatedStart = null;

// ========== ЭЛЕМЕНТЫ DOM ==========
const els = {
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-ui'),
    keyInput: document.getElementById('api-key'),
    startBtn: document.getElementById('start-btn'),
    dateText: document.getElementById('date-text'),
    locationDisplay: document.getElementById('location-display'),
    story: document.getElementById('story-display'),
    choices: document.getElementById('choices-display'),
    stats: document.getElementById('stats-display'),
    npcs: document.getElementById('npcs-display'),
    inv: document.getElementById('inventory-display'),
    loader: document.getElementById('loader'),
    modeDisplay: document.getElementById('mode-display'),
    preview: document.getElementById('start-preview'),
    // Новые элементы
    locationDesc: document.getElementById('location-description'),
    regionRow: document.getElementById('region-select-row'),
    cityRow: document.getElementById('city-select-row'),
    regionSelect: document.getElementById('region-select'),
    citySelect: document.getElementById('city-select')
};

// ========== УТИЛИТЫ ==========

/**
 * Выбирает случайный элемент из массива
 */
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Проверяет вероятность в процентах
 */
function rollChance(percent) {
    return Math.random() * 100 < percent;
}

/**
 * Парсит JSON из ответа нейросети
 */
function parseJSON(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e1) {
        try {
            let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            return JSON.parse(clean);
        } catch (e2) {
            try {
                const start = text.indexOf('{');
                const end = text.lastIndexOf('}');
                if (start !== -1 && end !== -1 && end > start) {
                    return JSON.parse(text.substring(start, end + 1));
                }
            } catch (e3) {
                console.error("JSON parse error (all attempts failed):", e3, text.substring(0, 200));
            }
            console.error("JSON parse error:", e2, text.substring(0, 200));
            return null;
        }
    }
}

/**
 * Конвертирует Markdown-подобный текст в HTML
 */
function renderMarkdown(text) {
    if (!text) return '';
    let html = text;

    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/^\*\*\*+$/gm, '<hr>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^[\-\•] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    let paragraphs = html.split(/\n{2,}/);
    paragraphs = paragraphs.map(p => {
        p = p.trim();
        if (!p) return '';
        if (/^<(h[1-3]|hr|blockquote|ul|ol|div|li)/.test(p)) {
            return p.replace(/\n/g, '<br>');
        }
        return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    });

    html = paragraphs.join('\n');
    return html;
}

/**
 * Управление индикатором загрузки
 */
function setLoading(b) {
    els.loader.style.display = b ? 'block' : 'none';
    const btns = document.querySelectorAll('.choice-btn');
    btns.forEach(btn => btn.disabled = b);
}

/**
 * Сохранение состояния в localStorage
 */
function save() {
    localStorage.setItem('rpg90_state', JSON.stringify(state));
}

/**
 * Глобальная функция сброса игры
 */
window.resetGame = () => {
    localStorage.removeItem('rpg90_state');
    location.reload();
};

// ========== НОВАЯ ФУНКЦИЯ ПОЛУЧЕНИЯ ИНФОРМАЦИИ О ЛОКАЦИИ ==========

/**
 * Возвращает полную информацию о текущей локации
 */
function getLocationInfo() {
    if (state.locationType === 'capital') {
        const city = CITIES[state.city];
        const detail = LOCATION_DETAILS[`city_${state.city}`];
        return {
            type: 'capital',
            typeName: LOCATION_TYPES.capital.name,
            typeIcon: LOCATION_TYPES.capital.icon,
            name: city.name,
            icon: city.icon,
            region: REGIONS[city.region],
            fullName: `${city.icon} ${city.name}`,
            desc: detail.desc,
            // Для совместимости со старым кодом
            legacyLocation: 'capital'
        };
    } else {
        const region = REGIONS[state.region];
        const type = LOCATION_TYPES[state.locationType];
        const detailKey = `${state.locationType}_${state.region}`;
        const detail = LOCATION_DETAILS[detailKey];
        
        return {
            type: state.locationType,
            typeName: type.name,
            typeIcon: type.icon,
            region: region,
            fullName: `${type.icon} ${type.name}, ${region.icon} ${region.name}`,
            desc: detail ? detail.desc : `${type.name} в ${region.name}`,
            // Для совместимости со старым кодом
            legacyLocation: state.locationType
        };
    }
}

/**
 * Обновляет описание локации в интерфейсе
 */
function updateLocationDescription() {
    const info = getLocationInfo();
    els.locationDesc.innerHTML = `<strong>${info.fullName}</strong><br>${info.desc}`;
    
    // Показываем/скрываем соответствующие селекты
    if (state.locationType === 'capital') {
        els.regionRow.style.display = 'none';
        els.cityRow.style.display = 'flex';
    } else {
        els.regionRow.style.display = 'flex';
        els.cityRow.style.display = 'none';
    }
}

// ========== НАСТРОЙКА ИНТЕРФЕЙСА ==========

/**
 * Настраивает кнопки-переключатели в меню настроек
 */
function setupOptionButtons(containerId, stateKey, callback) {
    const container = document.getElementById(containerId);
    const buttons = container.querySelectorAll('.option-btn');
    buttons.forEach(btn => {
        btn.onclick = () => {
            buttons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            state[stateKey] = btn.dataset.value;
            if (callback) callback(btn.dataset.value);
            if (stateKey === 'pace') updatePaceInfo(btn.dataset.value);
            if (stateKey === 'difficulty') updateDifficultyInfo(btn.dataset.value);
            if (stateKey === 'locationType' || stateKey === 'gender') rollStartPreview();
        };
    });
}

/**
 * Обновляет информацию о темпе повествования
 */
function updatePaceInfo(pace) {
    const info = document.getElementById('pace-info');
    if (pace === 'season') {
        info.innerHTML = `<strong>По сезонам:</strong> каждый ход = новый сезон<br><span class="pace-example">Зима 1993 → Весна 1993 → Лето 1993 → …</span>`;
    } else {
        info.innerHTML = `<strong>По годам:</strong> каждый ход = 9 месяцев <br><span class="pace-example">лето 1993 → Весна 1994 → Зима 1995 → …</span>`;
    }
}

/**
 * Обновляет информацию о сложности
 */
function updateDifficultyInfo(diff) {
    const info = document.getElementById('difficulty-info');
    if (diff === 'normal') {
        info.innerHTML = `<strong>Норма:</strong> 4 варианта выбора. Одно чудесное спасение за игру.`;
    } else {
        info.innerHTML = `<strong>Хардкор:</strong> 3 варианта выбора. Никаких спасений.`;
    }
}

/**
 * Генерирует и отображает превью стартовых данных
 */
function rollStartPreview() {
    // Используем legacyLocation для совместимости с генераторами
    const locInfo = getLocationInfo();
    const npcs = generateRandomNPCs(locInfo.legacyLocation);
    const { items, statMods } = generateRandomItems(locInfo.legacyLocation, state.gender);
    generatedStart = { npcs, items, statMods };
    renderStartPreview();
}

/**
 * Отрисовывает превью стартовых данных
 */
function renderStartPreview() {
    if (!generatedStart) return;
    const { npcs, items, statMods } = generatedStart;
    const locInfo = getLocationInfo();

    let html = '<h4>🎲 Стартовые данные</h4>';
    
    // Добавляем информацию о локации в превью
    html += `<div style="margin-bottom:10px; padding:5px; background:#1c2128; border-radius:4px;">`;
    html += `<strong>📍 ${locInfo.fullName}</strong><br>`;
    html += `<span style="font-size:0.8rem;">${locInfo.desc.substring(0, 100)}...</span>`;
    html += `</div>`;

    html += '<div style="margin-bottom:10px"><strong style="color:var(--text-main);font-size:0.85rem;">Близкие люди:</strong></div>';
    npcs.forEach(n => {
        html += `<div class="preview-item">• <strong>${n.name}</strong> — ${n.desc}</div>`;
    });

    html += '<div style="margin:10px 0 5px 0"><strong style="color:var(--text-main);font-size:0.85rem;">Вещи:</strong></div>';
    items.forEach(i => {
        const modSign = i.mod > 0 ? '+' : '';
        const modClass = i.mod > 0 ? 'pos' : 'neg';
        const statName = STATS_INFO[i.stat]?.name || i.stat;
        html += `<div class="preview-item">• <strong>${i.name}</strong> — ${i.desc} <span class="stat-mod ${modClass}">${modSign}${i.mod} ${statName}</span></div>`;
    });

    const modEntries = Object.entries(statMods).filter(([k, v]) => v !== 0);
    if (modEntries.length > 0) {
        html += '<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border-color);font-size:0.8rem;color:var(--text-dim);">';
        html += 'Итого статы: ';
        html += modEntries.map(([k, v]) => {
            const sign = v > 0 ? '+' : '';
            return `${STATS_INFO[k].name} ${sign}${v}`;
        }).join(', ');
        html += ' (от базы 5)';
        html += '</div>';
    }

    html += '<button class="reroll-btn" id="reroll-btn">🎲 Перебросить</button>';

    els.preview.innerHTML = html;
    document.getElementById('reroll-btn').onclick = rollStartPreview;
}

// Инициализация кнопок настроек
setupOptionButtons('gender-btns', 'gender');
setupOptionButtons('pace-btns', 'pace');
setupOptionButtons('difficulty-btns', 'difficulty');

// Обработчик для типа локации
setupOptionButtons('location-type-btns', 'locationType', (value) => {
    updateLocationDescription();
    rollStartPreview();
});

// Обработчики для селектов
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

// Слушатель изменения возраста
document.getElementById('start-age').onchange = (e) => {
    state.startAge = parseInt(e.target.value);
};

// Генерация первого превью и обновление описания
updateLocationDescription();
rollStartPreview();

// ========== ЗАПУСК ИГРЫ ==========

els.startBtn.onclick = () => {
    const key = els.keyInput.value.trim();
    if (!key) return alert("Нужен ключ API");
    localStorage.setItem('rpg90_key', key);
    initGame(key);
};

function initGame(key) {
    openai = new OpenAI({
        baseURL: "https://api.hydraai.ru/v1",
        apiKey: key,
        dangerouslyAllowBrowser: true
    });
    
    const saved = localStorage.getItem('rpg90_state');
    if (saved) {
        try {
            state = JSON.parse(saved);
            // Обратная совместимость
            if (!state.locationType) {
                state.locationType = state.location || 'capital';
                state.region = 'central';
                state.city = 'moscow';
            }
            if (state.difficulty === undefined) state.difficulty = 'normal';
            if (state.miracleUsed === undefined) state.miracleUsed = false;
            if (state.miracleAvailable === undefined) state.miracleAvailable = (state.difficulty === 'normal');
            if (state.turnCount === undefined) state.turnCount = 0;
            if (state.lifeSummary === undefined) state.lifeSummary = "";
            if (state.lastSummaryTurn === undefined) state.lastSummaryTurn = 0;
            if (state.stats.wealth === undefined) state.stats.wealth = 5;
            if (state.stats.authority === undefined) state.stats.authority = 5;
        } catch (e) {
            applyStartSettings();
        }
    } else {
        applyStartSettings();
    }

    els.setup.classList.add('hidden');
    els.game.classList.remove('hidden');
    
    const locInfo = getLocationInfo();
    els.locationDisplay.textContent = locInfo.fullName;

    renderUI();

    if (state.history.length === 0 && !state.gameOver) {
        turn("Начало игры. Опиши обстановку и представь героя.");
    }
}

function applyStartSettings() {
    state.age = state.startAge;
    state.year = 1993;
    state.seasonIdx = 0;
    state.miracleUsed = false;
    state.miracleAvailable = (state.difficulty === 'normal');
    state.turnCount = 0;
    state.lifeSummary = "";
    state.lastSummaryTurn = 0;
    state.stats = { mind: 5, body: 5, family: 5, friends: 5, health: 5, looks: 5, wealth: 5, authority: 5 };

    if (generatedStart) {
        state.npcs = generatedStart.npcs.map(n => ({ name: n.name, desc: n.desc }));
        state.inventory = generatedStart.items.map(i => ({ name: i.name, desc: i.desc }));
        for (let [stat, mod] of Object.entries(generatedStart.statMods)) {
            state.stats[stat] = Math.max(0, Math.min(10, state.stats[stat] + mod));
        }
    } else {
        state.npcs = [{ name: "Мама", desc: "Рядом, как всегда." }];
        state.inventory = [];
    }
}

// ========== ФОРМИРОВАНИЕ КОНТЕКСТА ДЛЯ НЕЙРОСЕТИ ==========

function buildContextBlock() {
    let ctx = "\n=== ЛЮДИ вокруг ===\n";
    if (state.npcs.length > 0) {
        state.npcs.forEach(n => { ctx += `- ${n.name}: ${n.desc}\n`; });
    } else {
        ctx += "Никого рядом нет.\n";
    }

    ctx += "\n=== ВЕЩИ и перки ГЕРОЯ ===\n";
    if (state.inventory.length > 0) {
        state.inventory.forEach(i => { ctx += `- ${i.name}: ${i.desc}\n`; });
    } else {
        ctx += "Ничего нет.\n";
    }

    return ctx;
}

function buildSummaryBlock() {
    if (!state.lifeSummary) return "";
    return `\n=== КРАТКАЯ ИСТОРИЯ ЖИЗНИ ГЕРОЯ (сводка предыдущих событий) ===\n${state.lifeSummary}\n`;
}

function buildStatsDescription() {
    let desc = "ТЕКУЩЕЕ СОСТОЯНИЕ ГЕРОЯ:\n";
    for (let [key, val] of Object.entries(state.stats)) {
        const info = STATS_INFO[key];
        if (!info) continue;
        let status = "";
        let impact = "";

        if (val === 0) { status = `GAME OVER (0/10)`; impact = "Полный крах: " + info.low; }
        else if (val === 1) { status = `ТРАГИЗМ ситуации (1/10)`; impact = "На грани гибели, катастрофа в любой момент: " + info.low; }
        else if (val === 2) { status = `ОЧЕВИДНЫЕ и сильные ПРОБЛЕМЫ (2/10)`; impact = "Даже герой видит беду: " + info.low; }
        else if (val === 3) { status = `ЗНАЧИТЕЛЬНОЕ ОТКЛОНЕНИЕ (3/10)`; impact = "Герой считает нормой, читатель видит проблемы: " + info.low; }
        else if (val === 4) { status = `ЛЁГКОЕ ОТКЛОНЕНИЕ (4/10)`; impact = "Пока еще не трагедия: — " + info.low; }
        else if (val === 5) { status = `НОРМА (5/10)`; impact = "Средний уровень, обычная жизнь"; }
        else if (val === 6) { status = `ЛЁГКОЕ ОТКЛОНЕНИЕ (6/10)`; impact = "Придаёт характер, не трагедия: лёгкий привкус счастья — " + info.high; }
        else if (val === 7) { status = `ЗНАЧИТЕЛЬНОЕ ОТКЛОНЕНИЕ (7/10)`; impact = "Герой считает ситуацию благом, но читатель видит проблемы: " + info.high; }
        else if (val === 8) { status = `ОЧЕВИДНЫЕ ПРОБЛЕМЫ (8/10)`; impact = "Даже герой видит перебор: " + info.high; }
        else if (val === 9) { status = `ТРАГИЗМ ситуации (9/10)`; impact = "На грани катастрофы, пипец в любой момент: " + info.high; }
        else if (val === 10) { status = `GAME OVER (10/10)`; impact = "Полный крах от избытка: " + info.high; }

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
    } else {
        if (nextSeasonIdx > 3) {
            nextSeasonIdx = 0;
            nextYear++;
        }
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

function buildMainSystemPrompt(nextSeasonName, nextYear, choicesCount) {
    const statsDesc = buildStatsDescription();
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    const contextBlock = buildContextBlock();
    const summaryBlock = buildSummaryBlock();
    
    let choicesTemplate = '';
    for (let i = 1; i <= choicesCount; i++) {
        choicesTemplate += `        {"text": "Действие ${i}", "action": "художественное описание действия ${i}"}`;
        if (i < choicesCount) choicesTemplate += ',\n';
    }
    
    return `
Ты — мастер драматической и детально атмосферной текстовой RPG о жизни в России 90-х. драма и атмосферная ностальгия - это вся твоя суть.

ГЕРОЙ: ${genderInfo.name} (${state.age} лет)
ЛОКАЦИЯ: ${locInfo.fullName} — ${locInfo.desc}

Жанр: социальная драма, реализм, атмосферная ностальгия, историческая хороника.
Пиши интересно, подробно, атмосферно, с деталями быта 90-х и учётом шеографической локации. Придумывай запоминающиеся яркие диалоги и используй в своём ответе детали от которых бы йокало сердце у тех кто был ребёнком в 90-е.

Текущее время: ${SEASONS[state.seasonIdx]} ${state.year}. Возраст: ${state.age}.
Следующий сезон: ${nextSeasonName} ${nextYear}.
${summaryBlock}
${contextBlock}
${statsDesc}

!!! КРИТИЧЕСКИЕ ПРАВИЛА !!!

1. 
   Если появляется новый NPC персонаж — добавь его через add_npc

2. Шкала 0-10. Середина = 5 (норма). И НИЗКИЕ и ВЫСОКИЕ крайности — ПРОБЛЕМЫ.

ВЫСОКИЕ ПАРАМЕТРЫ — НЕ ПРОСТО ХОРОШО! Это источник напряжения:
- Ум 8-9: гений-одиночка, завистники, не по возрасту умный
- Тело 8-9: агрессия, травмы от переоценки сил
- Семья 8-9: гиперопека, удушающий контроль
- Друзья 8-9: дурная компания, давление группы
- Здоровье 8-9: безрассудство, лезет в опасность
- Внешность 8-9: нездоровое внимание, зависть
- Достаток 8-9: криминал, рэкет, похищения, опасные деньги
- Авторитет у сверстников 8-9: упрямец, лезет на рожон, конфликтует с авторитетами, не отступает

НИЗКИЕ ПАРАМЕТРЫ — тоже проблемы:
 друзья 1-3: одиночество
 семья 1-3: разводы, уходы из семьи
- Достаток 1-3: нищета, голод, обноски, долги, отключают свет
- Авторитет у сверстников 1-3: тряпка, жертва буллинга, не может сказать «нет»
и т.п.
ДИАПАЗОНЫ:
- 4 и 6: лёгкое отклонение — вкус жизни, атмосфера, не трагедия
- 3 и 7: значительное — герой считает нормой/благом, но ЧИТАТЕЛЬ видит проблемы
- 2 и 8: очевидные — даже САМ герой понимает беду
- 1 и 9: полный трагизм — катастрофа В ЛЮБОЙ МОМЕНТ
- 0 и 10: GAME OVER (не генерируй — обрабатывается системой)

3. Учитывай пол (${genderInfo.name}), локацию (${locInfo.fullName} — ${locInfo.desc}), возраст (${state.age}).

4. Достаток влияет на доступные варианты, одежду, еду, отношение окружающих и возможность лечить плохое здоровье! помни о том что здоровье лечится деньгами отдыхом и вниманием к нему

5. Авторитет у сверстников влияет на то, боятся или презирают героя его сверстники, может ли он отказать, ведёт или ведомый. это параметр который склонен к снижению.

!!! ПРЕДМЕТЫ И ЛЮДИ — ЭТО ВАЖНО !!!

6. КАЖДЫЙ ХОД думай о предметах и людях! Герой живёт, а значит:

- знакомится с разными людьми

   - Находит вещи 
   - Получает подарки 
   - заводит питомцев
   - приобретает яркие черты личности или перки, которые в игровой механике называются "предметы" 
   
   Добавляй 1 предмет/перк-черту,  или нового NPC если этот предмет/перк/персонаж упоминался в тексте. если не упоминается, то ничего не добавляй, а лучше дополни описание старых

7. Дополняй описания существующих людей и предметов когда с ними что-то происходит! но не заменяй весь их текст, а дописывай новый с пометкой сезона-года дополнения, так чтобы прошлая информация не исчезала.
   - Мама поседела от переживаний? дополни её описание.
   - Велосипед сломался? дополнительно или удали.
   - Друг предал? дополняй его описание
   
   Используй update_npc и update_item в updates.

ЗАДАЧА:
1. Опиши последствия выбора с учётом статов, пола, локации(${locInfo.fullName} — ${locInfo.desc}). (60% текста)
2. описывай текст глазами ребёнка через призму его ума. не пиши "папа обнял меня как свой последний якорь, держащий его в этом мире" - это взрослые слова, а пиши "папа крепко обнял меня и старался не плакать, но не смог этого скрыть - я почувствовала его слезу своей щекой"
3. ПЕРЕХОД к ${nextSeasonName} ${nextYear} (40% текста). Опиши последовательно смену времени к новому периоду через призму возраста, личности героя и его географическо локации. события периода должны иметь корреляцию к предыдущему  выбору игрока. делай связанные флешбеки или воспоминания и осмысления из истории героя(вспоминай мелкие детали из его предыдущих лет жизни которые я передал тебе). упомини изменения затрагивающие до 3 случайных людей из списка NPC случившиеся с ними в тот или иной фрагмент переходного периода. региональный эксклюзив будет очень кстати для атмосферы и реализма. 

ВЯЗКОСТЬ СТАТОВ. шанс того что стат поменяется от затрагивающего его действия игрок не одинаков. если в настоящее время он:
${JSON.stringify(state.stats)}
- 4-6: то статы легко меняются
- 3, 7: сложнее меняется 
- 2, 8: очень вязкие статы, предпочитающие не меняться.
- 1, 9: почти всегда без изменений
НЕ меняй без веской причины! 

Максимум ±2 за ход.
общая сумма сдаигаемых в ту или иную сторону параметров за ход не должна быть выше 3

РОВНО ${choicesCount} варианта выбора! Не больше, не меньше.
обязательно должны быть действия помогающие увеличить самые низкие из статов
КАЖДЫЙ придуманный тобой вариант — это РАЗВЁРНУТОЕ описание действия длиной 1-2 предложения (10 слов минимум!).
НЕ ПИШИ короткие варианты типа "Помочь маме" или "Пойти гулять" — это ЗАПРЕЩЕНО.
ПИШИ подробно: "Помочь маме донести тяжёлые сумки с рынка и по дороге рассказать ей про проблемы в школе".
не пиши какие статы затронет вариант действия. 

ОТВЕТ СТРОГО В JSON (никакого текста до или после, только валидный JSON):
{
    "story": "Текст истории. Markdown.",
    "choices": [
${choicesTemplate}
    ],
    "updates": {
        "mind": 0, "body": 0, "family": 0, "friends": 0, "health": 0, "looks": 0, "wealth": 0, "authority": 0,
        "add_item": {"name": "Название", "desc": "Описание"} или null,
        "remove_item": "Название предмета" или null,
        "update_item": {"name": "Существующий предмет", "desc": "Новое описание"},
        "add_npc": {"name": "Имя", "desc": "Описание"},
        "remove_npc": "Имя" или null,
        "update_npc": {"name": "Существующий NPC", "desc": "Новое описание"}
    }
}

ВАЖНО: Все строки в JSON должны быть правильно экранированы. Переносы строк — через \\n. Кавычки — через \\".`;
}

// ========== ОСНОВНОЙ ИГРОВОЙ ЦИКЛ ==========

async function generateLifeSummary() {
    const genderInfo = GENDER_INFO[state.gender];
    const locationInfo = LOCATION_INFO[state.location];

    const fullHistory = state.history
        .map(h => h.role === "user" ? `>> Выбор: ${h.content}` : `<< ${h.content}`)
        .join("\n\n");

    const npcsDesc = state.npcs.map(n => `- ${n.name}: ${n.desc}`).join("\n");
    const invDesc = state.inventory.map(i => `- ${i.name}: ${i.desc}`).join("\n");
    const prevSummary = state.lifeSummary ? `\nПРЕДЫДУЩАЯ СВОДКА:\n${state.lifeSummary}\n` : '';

    const prompt = `
Ты — архивариус. Твоя задача — составить КРАТКУЮ СВОДКУ жизни персонажа.

ГЕРОЙ: ${genderInfo.name}, сейчас ${state.age} лет
ЛОКАЦИЯ: ${locationInfo.name}
СТАТЫ: ${JSON.stringify(state.stats)}
${prevSummary}
БЛИЗКИЕ ЛЮДИ:
${npcsDesc || "Нет"}

ВЕЩИ:
${invDesc || "Нет"}

НЕДАВНЯЯ ИСТОРИЯ:
${fullHistory}

ЗАДАЧА: Напиши сжатую сводку (10-15 предложений) ВСЕЙ жизни героя. Включи:
1. Ключевые события (травмы, переезды, смерти близких, дружбы, конфликты)
2. Как менялись отношения с каждым NPC
3. Значимые приобретения/потери
4. Эмоциональные шрамы и радости
5. Текущее состояние дел

НЕ ВЫДУМЫВАЙ того, чего не было! Только факты из истории.

ОТВЕТ В JSON:
{
    "summary": "Сводка жизни..."
}`;

    try {
        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: "Составь сводку." }
            ],
            response_format: { type: "json_object" }
        });

        const data = parseJSON(completion.choices[0].message.content);
        if (data && data.summary) {
            state.lifeSummary = data.summary;

            if (state.history.length > 6) {
                state.history = state.history.slice(-6);
            }

            state.lastSummaryTurn = state.turnCount;
        }
    } catch (e) {
        console.error("Summary generation error:", e);
    }
}

async function turn(action) {
    if (state.gameOver) return;
    setLoading(true);
    
    state.turnCount++;
    
    const needSummary = (state.turnCount - state.lastSummaryTurn) >= SUMMARY_INTERVAL &&
        state.history.length >= 10;
    
    if (needSummary) {
        await generateLifeSummary();
    }
    
    const { nextSeasonIdx, nextYear } = getNextTime();
    const nextSeasonName = SEASONS[nextSeasonIdx];
    const choicesCount = getChoicesCount();
    
    const systemPrompt = buildMainSystemPrompt(nextSeasonName, nextYear, choicesCount);
    
    try {
        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                ...state.history,
                { role: "user", content: `Мой выбор: ${action}. (Сгенерируй атмосферно описанный  результат выбранного мною действия и последующий переход в ${nextSeasonName} ${nextYear})` }
            ],
            max_tokens: 2500,
            temperature: 0.5,
            response_format: { type: "json_object" }
        });
        
        const raw = completion.choices[0].message.content;
        const data = parseJSON(raw);
        
        if (data && data.story && data.choices) {
            state.history.push({ role: "user", content: action });
            state.history.push({ role: "assistant", content: raw });
            
            if (state.history.length > HISTORY_LIMIT) {
                state.history = state.history.slice(-HISTORY_LIMIT);
            }
            
            applyUpdates(data.updates);
            state.lastStory = data.story;
            state.lastChoices = data.choices;
            advanceTime();
            
            await checkCriticalStats(state.lastStory);
            
            save();
            renderUI();
        } else {
            console.error("Invalid JSON structure:", raw);
            els.story.innerHTML = renderMarkdown("**Ошибка:** нейросеть вернула некорректный ответ.\n\nПопробуйте повторить ход.");
            showRetryButton(action);
        }
    } catch (e) {
        console.error(e);
        els.story.innerHTML = renderMarkdown("**Ошибка нейросети:**\n\n" + e.message);
        showRetryButton(action);
    } finally {
        setLoading(false);
    }
}

function showRetryButton(action) {
    els.choices.innerHTML = "";
    const btn = document.createElement('button');
    btn.className = "choice-btn";
    btn.style.borderColor = "var(--warning)";
    btn.innerText = "🔄 Повторить ход";
    btn.onclick = () => { state.turnCount--; turn(action); };
    els.choices.appendChild(btn);
}

async function checkCriticalStats(precedingStory) {
    const crits = [];
    for (let [k, v] of Object.entries(state.stats)) {
        if (STATS_INFO[k] && (v <= 0 || v >= 10)) {
            crits.push({ stat: k, value: v, name: STATS_INFO[k].name,
                low: STATS_INFO[k].low, high: STATS_INFO[k].high });
        }
    }

    if (crits.length === 0) return;

    // Чудесное спасение (только в режиме "Норма", один раз)
    if (state.difficulty === 'normal' && state.miracleAvailable && !state.miracleUsed) {
        state.miracleUsed = true;
        state.miracleAvailable = false;

        for (let c of crits) {
            if (c.value <= 0) state.stats[c.stat] = 3;
            else if (c.value >= 10) state.stats[c.stat] = 7;
        }

        await generateMiracleStory(crits, precedingStory);
        
        return true;
    }

    // Настоящий Game Over
    state.gameOver = true;
    await generateGameOverStory(crits, precedingStory);
    return true;
}

async function generateMiracleStory(crits, precedingStory) {
    setLoading(true);
    
    const genderInfo = GENDER_INFO[state.gender];
    const locationInfo = LOCATION_INFO[state.location];
    const npcsDesc = state.npcs.map(n => `- ${n.name}: ${n.desc}`).join("\n");
    const choicesCount = getChoicesCount();
    
    let critsDesc = crits.map(c => {
        const isLow = c.value <= 0;
        return `- ${c.name}: ${isLow ? c.low : c.high} (было ${c.value}/10, откатилось до ${isLow ? 3 : 7}/10)`;
    }).join("\n");
    
    const summaryBlock = state.lifeSummary ? `\n=== ИСТОРИЯ ЖИЗНИ ===\n${state.lifeSummary}\n` : '';
    
    let choicesTemplate = '';
    const exampleTexts = [
        "Пойти к Серёге и попросить помощи — он единственный, кто может понять",
        "Промолчать и сделать вид, что ничего не случилось, проглотить обиду",
        "Рассказать маме всю правду, даже если она расстроится и будет ругать",
        "Взять дело в свои руки и разобраться самому, без взрослых"
    ];
    for (let i = 1; i <= choicesCount; i++) {
        const ex = exampleTexts[i - 1] || `Подробное описание действия ${i} в 2 предложениях`;
        choicesTemplate += `        {"text": "${ex}", "action": "Подробная инструкция что именно делает герой, к кому идёт, что говорит"}`;
        if (i < choicesCount) choicesTemplate += ',\n';
    }
    
    const systemPrompt = `
Ты — мастер драматических RPG. Произошло ЧУДЕСНОЕ СПАСЕНИЕ.

=== ГЕРОЙ ===
Пол: ${genderInfo.name}
Возраст: ${state.age} лет
Локация: ${locationInfo.name} — ${locationInfo.desc}

=== КРИТИЧЕСКИЕ ПАРАМЕТРЫ (должны были привести к гибели, но чудо спасло ===
${critsDesc}

=== БЛИЗКИЕ ЛЮДИ ===
${npcsDesc || "Никого"}
${summaryBlock}

=== ЧТО ТОЛЬКО ЧТО ПРОИЗОШЛО (текст последнего хода — ЭТО КАНОН, ты ПРОДОЛЖАЕШЬ эту историю!) ===
${precedingStory}
=== КОНЕЦ ТЕКСТА ПОСЛЕДНЕГО ХОДА ===

ЗАДАЧА:
Напиши ПРОДОЛЖЕНИЕ текста выше — чудесное спасение (3-4 абзаца).
Затем предложи ${choicesCount} варианта действий для героя ПОСЛЕ спасения.

КРИТИЧЕСКИ ВАЖНО:
1. Ты ПРОДОЛЖАЕШЬ историю, описанную в тексте последнего хода!
2. Если в тексте выше кто-то умер — он МЁРТВ, не воскрешай!
3. Если в тексте что-то случилось — это СЛУЧИЛОСЬ, не игнорируй!
4. Чудо должно логично вытекать из событий последнего хода
5. Используй персонажей из списка «БЛИЗКИЕ ЛЮДИ» и других известных из истории NPC
6. Чудо должно быть правдоподобным: удачное стечение обстоятельств, неожиданная помощь реального NPC, случайность
7. Варианты выбора должны учитывать НОВУЮ ситуацию после спасения, а не ситуацию до него!

ОТВЕТ В JSON:
{
    "miracle_story": "Продолжение истории — чудесное спасение. 3-4 абзаца. Markdown.",
    "choices": [
${choicesTemplate}
    ]
}`;
    
    try {
        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Продолжи историю — опиши чудесное спасение и предложи варианты действий после него." }
            ],
            response_format: { type: "json_object" }
        });
        
        const data = parseJSON(completion.choices[0].message.content);
        if (data && data.miracle_story) {
            state.lastMiracle = data.miracle_story;
            
            if (data.choices && data.choices.length > 0) {
                state.lastChoices = data.choices;
            }
            
            state.history.push({
                role: "assistant",
                content: JSON.stringify({
                    story: state.lastStory + "\n\n---\n\n**✨ ЧУДЕСНОЕ СПАСЕНИЕ**\n\n" + data.miracle_story,
                    choices: data.choices
                })
            });
        }
    } catch (e) {
        console.error("Miracle error:", e);
        state.lastMiracle = "Но судьба в последний момент смилостивилась. Каким-то чудом всё обошлось...";
        state.lastChoices = [
            { text: "Попытаться осмыслить произошедшее", action: "Герой пытается понять, что произошло и как он выжил" },
            { text: "Поблагодарить того, кто помог", action: "Герой благодарит спасителя" },
            { text: "Двигаться дальше, не оглядываясь", action: "Герой решает забыть о случившемся и идти вперёд" }
        ];
        if (getChoicesCount() === 4) {
            state.lastChoices.push({ text: "Извлечь урок и изменить поведение", action: "Герой решает изменить свою жизнь после пережитого" });
        }
    }
    
    setLoading(false);
}

async function generateGameOverStory(crits, precedingStory) {
    setLoading(true);

    const fullHistory = state.history
        .map(h => h.role === "user" ? `>> Игрок: ${h.content}` : `<< ${h.content}`)
        .join("\n\n");

    const npcsDesc = state.npcs.map(n => `- ${n.name}: ${n.desc}`).join("\n");
    const invDesc = state.inventory.map(i => `- ${i.name}: ${i.desc}`).join("\n");
    const genderInfo = GENDER_INFO[state.gender];
    const locationInfo = LOCATION_INFO[state.location];

    let critsDesc = crits.map(c => {
        const isLow = c.value <= 0;
        return `- ${c.name}: ${isLow ? c.low : c.high} (значение ${c.value}/10)`;
    }).join("\n");

    const summaryBlock = state.lifeSummary ? `\n=== КРАТКАЯ ИСТОРИЯ ВСЕЙ ЖИЗНИ ===\n${state.lifeSummary}\n` : '';

    const systemPrompt = `
Ты — мастер драматических RPG. Игра завершена трагически.

=== ГЕРОЙ ===
Пол: ${genderInfo.name}
Возраст: ${state.age} лет
Локация: ${locationInfo.name} — ${locationInfo.desc}

=== КРИТИЧЕСКИЕ ПАРАМЕТРЫ (привели к Game Over) ===
${critsDesc}

=== БЛИЗКИЕ ЛЮДИ ===
${npcsDesc || "Никого"}

=== ВЕЩИ ГЕРОЯ ===
${invDesc || "Ничего"}
${summaryBlock}

=== ЧТО ТОЛЬКО ЧТО ПРОИЗОШЛО (текст последнего хода — ЭТО КАНОН, ты ПРОДОЛЖАЕШЬ!) ===
${precedingStory}
=== КОНЕЦ ТЕКСТА ПОСЛЕДНЕГО ХОДА ===

=== НЕДАВНЯЯ ИСТОРИЯ ===
${fullHistory}

=== ЗАДАЧА ===
Напиши ОГРОМНЫЙ ТРАГИЧЕСКИЙ ЭПИЛОГ (7-10 абзацев минимум!), который ПРОДОЛЖАЕТ текст последнего хода.

КРИТИЧЕСКИ ВАЖНО:
1. Эпилог — это ПРОДОЛЖЕНИЕ текста выше, а не альтернативная реальность!
2. Если в тексте кто-то умер — он МЁРТВ, не воскрешай!
3. Если что-то произошло — это ПРОИЗОШЛО, не переигрывай!
4. Используй ТОЛЬКО персонажей из списка (и только тех, кто ещё жив по сюжету!)
5. НЕ ВЫДУМЫВАЙ новых персонажей!
6. Опиши последствия для каждого близкого человека
7. Объясни, как критические параметры привели к трагедии
8. Соответствуй локации (${locationInfo.name}) и времени (90-е)

ОТВЕТ В JSON:
{
    "epilogue": "Огромный эпилог 7-10+ абзацев, продолжающий историю. Markdown.",
    "reasons": ["Конкретная причина 1 из истории", "Причина 2", ...],
    "epitaph": "Короткая эпитафия"
}`;

    try {
        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Продолжи историю — напиши трагический финал, который логично вытекает из событий выше. Пиши МНОГО, подробно." }
            ],
            response_format: { type: "json_object" }
        });

        const data = parseJSON(completion.choices[0].message.content);
        if (data) {
            state.gameOverData = data;
        }
    } catch (e) {
        console.error("Game Over error:", e);
        state.gameOverData = {
            epilogue: `Судьба ${genderInfo.name} оборвалась в ${state.age} лет. ${locationInfo.name} 90-х не пощадил${genderInfo.pronoun === 'он' ? '' : 'а'} ${genderInfo.pronoun === 'он' ? 'его' : 'её'}...`,
            reasons: crits.map(c => c.name + " достиг критического уровня"),
            epitaph: "Эпоха перемен забрала рано"
        };
    }

    setLoading(false);
}

// ========== ПРИМЕНЕНИЕ ОБНОВЛЕНИЙ ==========

// ========== ПРИМЕНЕНИЕ ОБНОВЛЕНИЙ ==========
// ========== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ ТЕКУЩЕЙ ДАТЫ ==========
function getCurrentDateString() {
    return `${SEASONS[state.seasonIdx]} ${state.year}`;
}

// ========== ПРИМЕНЕНИЕ ОБНОВЛЕНИЙ ==========
function applyUpdates(u) {
    if (!u) return;
    
    // Статы
    for (let k in state.stats) {
        if (u[k] !== undefined) {
            let delta = u[k];
            if (typeof delta !== 'number') continue;
            
            // Ограничение изменения за ход
            if (delta > 2) delta = 2;
            if (delta < -2) delta = -2;
            
            const current = state.stats[k];
            let apply = true;
            
            // Вязкость: экстремальные значения сложнее менять
            if (delta > 0 && current >= 6) {
                // Повышение при высоком значении — шанс 50%
                apply = Math.random() < 0.5;
                if (!apply) console.log(`🛡️ Вязкость: повышение ${STATS_INFO[k]?.name || k} заблокировано (${current} → ${current+delta})`);
            } else if (delta < 0 && current <= 4) {
                // Понижение при низком значении — шанс 50%
                apply = Math.random() < 0.5;
                if (!apply) console.log(`🛡️ Вязкость: понижение ${STATS_INFO[k]?.name || k} заблокировано (${current} → ${current+delta})`);
            }
            
            if (apply) {
                state.stats[k] = current + delta;
                // Ограничиваем в пределах 0-10
                if (state.stats[k] > 10) state.stats[k] = 10;
                if (state.stats[k] < 0) state.stats[k] = 0;
            }
        }
    }
    
    // Добавление предмета
    if (u.add_item && typeof u.add_item === 'object' && u.add_item.name) {
        if (!state.inventory.find(i => i.name === u.add_item.name)) {
            state.inventory.push({ name: u.add_item.name, desc: u.add_item.desc || "Без описания" });
        }
    }
    
    // Удаление предмета
    if (u.remove_item && typeof u.remove_item === 'string') {
        state.inventory = state.inventory.filter(i => i.name !== u.remove_item);
    }
    
    // Обновление описания предмета (ДОПОЛНЯЕМ, а не заменяем)
    if (u.update_item && typeof u.update_item === 'object' && u.update_item.name) {
        const item = state.inventory.find(i => i.name === u.update_item.name);
        if (item && u.update_item.desc) {
            const dateStr = getCurrentDateString();
            // Добавляем новую запись с датой, сохраняя старое описание
            item.desc = item.desc + `\n\n*(${dateStr})* ${u.update_item.desc}`;
        }
    }
    
    // Добавление NPC
    if (u.add_npc && typeof u.add_npc === 'object' && u.add_npc.name) {
        if (!state.npcs.find(n => n.name === u.add_npc.name)) {
            state.npcs.push({ name: u.add_npc.name, desc: u.add_npc.desc || "Без описания" });
        }
    }
    
    // Удаление NPC
    if (u.remove_npc && typeof u.remove_npc === 'string') {
        state.npcs = state.npcs.filter(n => n.name !== u.remove_npc);
    }
    
    // Обновление описания NPC (ДОПОЛНЯЕМ, а не заменяем)
    if (u.update_npc && typeof u.update_npc === 'object' && u.update_npc.name) {
        const npc = state.npcs.find(n => n.name === u.update_npc.name);
        if (npc && u.update_npc.desc) {
            const dateStr = getCurrentDateString();
            npc.desc = npc.desc + `\n\n*(${dateStr})* ${u.update_npc.desc}`;
        }
    }
}

// ========== ОТРИСОВКА ИНТЕРФЕЙСА ==========

function renderUI() {
    const locInfo = getLocationInfo(); // получаем информацию о локации
    els.dateText.innerText = `${SEASONS[state.seasonIdx]} ${state.year} | ${state.age} лет`;
    els.locationDisplay.textContent = locInfo.fullName; // ← исправлено
    
    // Режим и чудо
    let modeHTML = '';
    if (state.difficulty === 'hardcore') {
        modeHTML = `<span class="mode-badge hardcore">💀 ХАРДКОР</span>`;
    } else {
        modeHTML = `<span class="mode-badge normal">🛡️ НОРМА</span>`;
        if (!state.miracleUsed) {
            modeHTML += `<span class="miracle-badge available">✨ Спасение доступно</span>`;
        } else {
            modeHTML += `<span class="miracle-badge used">✨ Спасение использовано</span>`;
        }
    }
    if (state.lifeSummary) {
        modeHTML += `<span class="summary-badge">📝 Сводка: ход ${state.lastSummaryTurn}</span>`;
    }
    els.modeDisplay.innerHTML = modeHTML;
    
    // ... остальная часть функции без изменений ..
    // Рендер истории
    if (state.gameOver && state.gameOverData) {
        const god = state.gameOverData;
        const storyHtml = renderMarkdown(state.lastStory || '');
        const epilogueHtml = renderMarkdown(god.epilogue || '');
        const reasonsHtml = god.reasons ? god.reasons.map(r => `<li>${r}</li>`).join('') : '';
        const epitaphHtml = renderMarkdown(`> *"${god.epitaph || ''}"*`);

        els.story.innerHTML = `
            ${storyHtml}
            <hr>
            <div class="game-over-banner">
                <h2>💀 GAME OVER</h2>
                <p style="color: var(--text-dim); margin: 0;">${SEASONS[state.seasonIdx]} ${state.year}, ${state.age} лет</p>
            </div>
            <h2 style="color: var(--accent);">🕯️ Эпилог</h2>
            ${epilogueHtml}
            <div class="game-over-reasons">
                <strong>Что привело к трагедии:</strong>
                <ul>${reasonsHtml}</ul>
            </div>
            ${epitaphHtml}
        `;
    } else if (state.lastMiracle) {
        const storyHtml = renderMarkdown(state.lastStory || '');
        const miracleHtml = renderMarkdown(state.lastMiracle);

        els.story.innerHTML = `
            ${storyHtml}
            <hr>
            <div class="miracle-banner">
                <h2>✨ ЧУДЕСНОЕ СПАСЕНИЕ</h2>
                <p style="color: var(--text-dim); margin: 0;">Судьба смилостивилась... на этот раз.</p>
            </div>
            ${miracleHtml}
            <hr>
            <p><em>Спасение использовано. Больше чудес не будет.</em></p>
        `;
        state.lastMiracle = null;
    } else {
        els.story.innerHTML = renderMarkdown(state.lastStory || 'Загрузка...');
    }

    // Варианты выбора
    // Варианты выбора
els.choices.innerHTML = "";
if (state.gameOver) {
    const btn = document.createElement('button');
    btn.className = "choice-btn";
    btn.style.borderColor = "var(--danger)";
    btn.innerText = "🔄 Начать новую жизнь";
    btn.onclick = () => resetGame();
    els.choices.appendChild(btn);
} else if (state.lastChoices) {
    state.lastChoices.forEach(ch => {
        const btn = document.createElement('button');
        btn.className = "choice-btn";
        btn.innerText = ch.action || ch.text; // ← теперь используем длинное описание
        btn.onclick = () => turn(ch.action);
        els.choices.appendChild(btn);
    });
}

    // Статы
    els.stats.innerHTML = "";
    for (let [k, v] of Object.entries(state.stats)) {
        if (!STATS_INFO[k]) continue;
        const dist = Math.abs(v - 5);
        let colorClass = "val-norm";
        if (dist === 0) colorClass = "val-norm";
        else if (dist === 1) colorClass = "val-flavor";
        else if (dist === 2) colorClass = "val-skew";
        else if (dist === 3) colorClass = "val-bad";
        else if (dist >= 4) colorClass = "val-crit";

        els.stats.innerHTML += `
            <div class="stat-row">
                <span>${STATS_INFO[k].name}</span>
                <span class="${colorClass}">${v}</span>
            </div>
        `;
    }

    renderLoreList(els.inv, state.inventory);
    renderLoreList(els.npcs, state.npcs);
}

function generateRandomNPCs(location) {
    const pool = NPC_POOLS[location];
    const result = [];
    const usedDescs = new Set(); // чтобы не было двух одинаковых

// Мама — 90% (бывает что воспитывает бабушка, отец-одиночка, или детдом)
if (rollChance(90)) {
    const mom = pick(pool.mothers);
    result.push({ ...mom });
    usedDescs.add(mom.desc);
}

// Папа — 70% (ушёл, погиб, в тюрьме, неизвестен)
if (rollChance(70)) {
    const dad = pick(pool.fathers);
    result.push({ ...dad });
    usedDescs.add(dad.desc);
}

// Если нет ни мамы ни папы — гарантированно бабушка/дедушка (кто-то должен растить)
const hasParent = result.length > 0;
if (!hasParent) {
    const gp = pick(pool.grandparents);
    result.push({ ...gp });
    usedDescs.add(gp.desc);
}

    // 60% — один дедушка/бабушка
    if (rollChance(60)) {
        const gp = pick(pool.grandparents);
        if (!usedDescs.has(gp.desc)) {
            result.push({ ...gp });
            usedDescs.add(gp.desc);
        }
    }

    // 30% — второй дедушка/бабушка
    if (rollChance(30)) {
        const gp2Options = pool.grandparents.filter(g => !usedDescs.has(g.desc));
        if (gp2Options.length > 0) {
            const gp2 = pick(gp2Options);
            result.push({ ...gp2 });
            usedDescs.add(gp2.desc);
        }
    }

    // 50% — один брат/сестра
    if (rollChance(50)) {
        const sib = pick(pool.siblings);
        if (!usedDescs.has(sib.desc)) {
            result.push({ ...sib });
            usedDescs.add(sib.desc);
        }
    }

    // 25% — второй брат/сестра
    if (rollChance(25)) {
        const sib2Options = pool.siblings.filter(s => !usedDescs.has(s.desc));
        if (sib2Options.length > 0) {
            const sib2 = pick(sib2Options);
            result.push({ ...sib2 });
            usedDescs.add(sib2.desc);
        }
    }

    // 1-2 друга (70% первый, 40% второй)
    if (rollChance(70)) {
        const fr = pick(pool.friends);
        if (!usedDescs.has(fr.desc)) {
            result.push({ ...fr });
            usedDescs.add(fr.desc);
        }
    }
    if (rollChance(40)) {
        const fr2Options = pool.friends.filter(f => !usedDescs.has(f.desc));
        if (fr2Options.length > 0) {
            const fr2 = pick(fr2Options);
            result.push({ ...fr2 });
            usedDescs.add(fr2.desc);
        }
    }

    // 50% — сосед/учитель
    if (rollChance(50)) {
        const nb = pick(pool.neighbors);
        if (!usedDescs.has(nb.desc)) {
            result.push({ ...nb });
            usedDescs.add(nb.desc);
        }
    }

    // 45% — животное
    if (rollChance(45)) {
        const an = pick(pool.animals);
        if (!usedDescs.has(an.desc)) {
            result.push({ ...an });
            usedDescs.add(an.desc);
        }
    }

    return result;
}

// ==================== СЛУЧАЙНАЯ ГЕНЕРАЦИЯ ПРЕДМЕТОВ ====================
function generateRandomItems(location, gender) {
    const poolData = ITEM_POOLS[location];
    let pool = [...poolData.common];

    // Добавляем гендерные предметы
    if (gender === 'male' && poolData.boys) {
        pool = pool.concat(poolData.boys);
    } else if (gender === 'female' && poolData.girls) {
        pool = pool.concat(poolData.girls);
    }

    const result = [];
    const usedNames = new Set();
    const statMods = {};

    let shuffled = pool.sort(() => Math.random() - 0.5);

    // Гарантированно 1 предмет
    const first = shuffled[0];
    result.push({ name: first.name, desc: first.desc, stat: first.stat, mod: first.mod });
    usedNames.add(first.name);
    statMods[first.stat] = (statMods[first.stat] || 0) + first.mod;

    // Дальше — каждый следующий с убывающей вероятностью
    let chance = 75;
    for (let i = 1; i < shuffled.length && chance > 10; i++) {
        if (!rollChance(chance)) break;
        if (usedNames.has(shuffled[i].name)) continue;
        const item = shuffled[i];
        result.push({ name: item.name, desc: item.desc, stat: item.stat, mod: item.mod });
        usedNames.add(item.name);
        statMods[item.stat] = (statMods[item.stat] || 0) + item.mod;
        chance -= 12; // 75 → 63 → 51 → 39 → 27 → 15...
    }

    return { items: result, statMods };
}


function renderLoreList(container, items) {
    container.innerHTML = "";
    if (!items || items.length === 0) {
        container.innerHTML = "<div style='font-size:0.8em; color:#555'>Пусто...</div>";
        return;
    }
    items.forEach(item => {
        const d = document.createElement('details');
        d.innerHTML = `
            <summary>${item.name}</summary>
            <div class="lore-desc">${item.desc || "Нет описания."}</div>
        `;
        container.appendChild(d);
    });
}

// ... (весь предыдущий код до renderLoreList включительно)

// ========== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ==========

// Функция для загрузки сохранённой игры
function tryLoadSavedGame() {
    const saved = localStorage.getItem('rpg90_state');
    const key = localStorage.getItem('rpg90_key');
    
    if (!saved || !key) return false;
    
    try {
        state = JSON.parse(saved);
        
        // Обратная совместимость с разными версиями
        if (!state.locationType) {
            state.locationType = state.location || 'capital';
            state.region = 'central';
            state.city = 'moscow';
        }
        if (state.difficulty === undefined) state.difficulty = 'normal';
        if (state.miracleUsed === undefined) state.miracleUsed = false;
        if (state.miracleAvailable === undefined) state.miracleAvailable = (state.difficulty === 'normal');
        if (state.turnCount === undefined) state.turnCount = 0;
        if (state.lifeSummary === undefined) state.lifeSummary = "";
        if (state.lastSummaryTurn === undefined) state.lastSummaryTurn = 0;
        if (state.stats.wealth === undefined) state.stats.wealth = 5;
        if (state.stats.authority === undefined) state.stats.authority = 5;
        
        // Инициализация OpenAI
        openai = new OpenAI({
            baseURL: "https://api.hydraai.ru/v1",
            apiKey: key,
            dangerouslyAllowBrowser: true
        });
        
        // Переключение на игровой интерфейс
        els.setup.classList.add('hidden');
        els.game.classList.remove('hidden');
        
        // Обновление отображения
        const locInfo = getLocationInfo();
        els.locationDisplay.textContent = locInfo.fullName;
        renderUI();
        
        return true;
    } catch (e) {
        console.error('Ошибка загрузки сохранения:', e);
        localStorage.removeItem('rpg90_state'); // удаляем повреждённое сохранение
        return false;
    }
}

// Пытаемся загрузить сохранение
const savedGameLoaded = tryLoadSavedGame();

// Если сохранения нет — показываем экран настройки и настраиваем его
if (!savedGameLoaded) {
    // Убеждаемся, что экран настройки виден, а игровой скрыт
    els.setup.classList.remove('hidden');
    els.game.classList.add('hidden');
    
    // Заполняем поле API ключа, если есть сохранённый ключ
    if (localStorage.getItem('rpg90_key')) {
        els.keyInput.value = localStorage.getItem('rpg90_key');
    }
    
    // Настройка кнопок-переключателей
    setupOptionButtons('gender-btns', 'gender');
    setupOptionButtons('location-type-btns', 'locationType', (value) => {
        updateLocationDescription();
        rollStartPreview();
    });
    setupOptionButtons('pace-btns', 'pace');
    setupOptionButtons('difficulty-btns', 'difficulty');
    
    // Обработчики для селектов региона и города
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
    
    // Обработчик возраста
    document.getElementById('start-age').onchange = (e) => {
        state.startAge = parseInt(e.target.value);
    };
    
    // Первоначальное отображение
    updateLocationDescription();
    rollStartPreview();
}

// Обработчик кнопки "Начать игру" (сработает только если экран настройки виден)
els.startBtn.onclick = () => {
    const key = els.keyInput.value.trim();
    if (!key) return alert("Нужен ключ API");
    localStorage.setItem('rpg90_key', key);
    initGame(key);
};

// Загружаем сохранённый ключ API, если есть
if (localStorage.getItem('rpg90_key')) {
    els.keyInput.value = localStorage.getItem('rpg90_key');
}

// ========== КОПИРОВАНИЕ ИСТОРИИ ==========
window.copyHistoryToClipboard = async function() {
    try {
        // Собираем историю из state.history
        let historyText = '';
        
        if (state.history && state.history.length > 0) {
            historyText = state.history.map(entry => {
                const role = entry.role === 'user' ? '👉 ВЫ' : '📖 ПОВЕСТВОВАНИЕ';
                // Пытаемся извлечь текст из JSON, если это ответ ассистента
                let content = entry.content;
                if (entry.role === 'assistant') {
                    try {
                        const parsed = JSON.parse(entry.content);
                        if (parsed.story) content = parsed.story;
                    } catch (e) {
                        // не JSON, оставляем как есть
                    }
                }
                return `${role}:\n${content}\n`;
            }).join('\n---\n');
        } else {
            historyText = 'История пока пуста.';
        }
        
        // Добавляем информацию о текущем состоянии для контекста
        const locInfo = getLocationInfo();
        const header = `=== ЭПОХА ПЕРЕМЕН: 1993 ===\nПерсонаж: ${GENDER_INFO[state.gender].name}, ${state.age} лет\nЛокация: ${locInfo.fullName}\nДата: ${SEASONS[state.seasonIdx]} ${state.year}\n\n`;
        
        const statsText = Object.entries(state.stats)
            .map(([k, v]) => `${STATS_INFO[k].name}: ${v}`)
            .join(', ');
        
        const fullText = header +
            `Текущие параметры: ${statsText}\n\n` +
            `=== ИСТОРИЯ ===\n${historyText}`;
        
        await navigator.clipboard.writeText(fullText);
        
        // Визуальное подтверждение (можно добавить всплывающее уведомление)
        alert('✅ История скопирована в буфер обмена!');
    } catch (err) {
        console.error('Ошибка копирования:', err);
        alert('❌ Не удалось скопировать историю.');
    }
};