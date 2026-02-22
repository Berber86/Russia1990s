// ========== ИМПОРТЫ И КОНФИГУРАЦИЯ ==========
import OpenAI from 'https://cdn.jsdelivr.net/npm/openai@4.28.0/+esm';
import {
    MODEL, SEASONS, HISTORY_LIMIT, SUMMARY_INTERVAL,
    STATS_INFO, GENDER_INFO,
    LOCATION_TYPES, REGIONS, CITIES, LOCATION_DETAILS,
    NPC_POOLS, ITEM_POOLS, REGIONAL_ITEM_POOLS
} from './constants.js';

// ========== СОСТОЯНИЕ ИГРЫ ==========
const DEFAULT_STATE = {
    gender: 'male',
    locationType: 'capital',
    region: 'central',
    city: 'moscow',
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
    originalHistory: [],       // массив оригинальных текстов (без улучшений)
    enhancedHistory: [],       // массив улучшенных текстов (для отображения)
    compressedSummary: "",     // сжатая история (после каждого 4-го хода)
    lastCompressTurn: 0,       // номер хода последнего сжатия
    gameOver: false,
    miracleUsed: false,
    miracleAvailable: true,
    turnCount: 0,
    lifeSummary: "",
    lastSummaryTurn: 0
};

let state = { ...DEFAULT_STATE };
let generatedStart = null;
let userApiKey = null;

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
    locationDesc: document.getElementById('location-description'),
    regionRow: document.getElementById('region-select-row'),
    cityRow: document.getElementById('city-select-row'),
    regionSelect: document.getElementById('region-select'),
    citySelect: document.getElementById('city-select')
};

// ========== УТИЛИТЫ ==========
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rollChance(percent) { return Math.random() * 100 < percent; }

function parseJSON(text) {
    if (!text) return null;
    try { return JSON.parse(text); }
    catch (e1) {
        try {
            let clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/g, '').trim();
            const startIdx = clean.indexOf('{');
            if (startIdx === -1) throw new Error('No JSON');
            let braceCount = 0, endIdx = -1;
            for (let i = startIdx; i < clean.length; i++) {
                if (clean[i] === '{') braceCount++;
                else if (clean[i] === '}') braceCount--;
                if (braceCount === 0 && clean[i] === '}') { endIdx = i; break; }
            }
            if (endIdx === -1) throw new Error('Unbalanced');
            return JSON.parse(clean.substring(startIdx, endIdx + 1));
        } catch (e2) {
            console.error("JSON parse error:", e2, text.substring(0,200));
            return null;
        }
    }
}

function renderMarkdown(text) {
    if (!text) return '';
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/^---+$/gm, '<hr>').replace(/^\*\*\*+$/gm, '<hr>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>').replace(/<\/blockquote>\n<blockquote>/g, '\n');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^[\-\•] (.+)$/gm, '<li>$1</li>').replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    let paragraphs = html.split(/\n{2,}/).map(p => {
        p = p.trim();
        if (!p) return '';
        if (/^<(h[1-3]|hr|blockquote|ul|ol|div|li)/.test(p)) return p.replace(/\n/g, '<br>');
        return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    });
    return paragraphs.join('\n');
}

function setLoading(b) {
    els.loader.style.display = b ? 'block' : 'none';
    document.querySelectorAll('.choice-btn').forEach(btn => btn.disabled = b);
}

function save() { localStorage.setItem('rpg90_state', JSON.stringify(state)); }
window.resetGame = () => { localStorage.removeItem('rpg90_state'); location.reload(); };

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
    if (locationType === 'capital' && city && NPC_POOLS.cities?.[city]) availablePools.push(NPC_POOLS.cities[city]);
    const result = [], usedDescs = new Set();
    function pickFromPools(category) {
        const options = [];
        for (const pool of availablePools) if (pool[category]) options.push(...pool[category]);
        const fresh = options.filter(opt => !usedDescs.has(opt.desc));
        return fresh.length ? pick(fresh) : null;
    }
    if (rollChance(90)) { const m = pickFromPools('mothers'); if (m) { result.push({ ...m }); usedDescs.add(m.desc); } }
    if (rollChance(70)) { const d = pickFromPools('fathers'); if (d) { result.push({ ...d }); usedDescs.add(d.desc); } }
    const hasParent = result.length > 0;
    if (!hasParent) { const gp = pickFromPools('grandparents'); if (gp) { result.push({ ...gp }); usedDescs.add(gp.desc); } }
    if (rollChance(60)) { const gp = pickFromPools('grandparents'); if (gp) { result.push({ ...gp }); usedDescs.add(gp.desc); } }
    if (rollChance(30)) { const gp = pickFromPools('grandparents'); if (gp) { result.push({ ...gp }); usedDescs.add(gp.desc); } }
    if (rollChance(50)) { const s = pickFromPools('siblings'); if (s) { result.push({ ...s }); usedDescs.add(s.desc); } }
    if (rollChance(25)) { const s = pickFromPools('siblings'); if (s) { result.push({ ...s }); usedDescs.add(s.desc); } }
    if (rollChance(70)) { const f = pickFromPools('friends'); if (f) { result.push({ ...f }); usedDescs.add(f.desc); } }
    if (rollChance(40)) { const f = pickFromPools('friends'); if (f) { result.push({ ...f }); usedDescs.add(f.desc); } }
    if (rollChance(50)) { const n = pickFromPools('neighbors'); if (n) { result.push({ ...n }); usedDescs.add(n.desc); } }
    if (rollChance(45)) { const a = pickFromPools('animals'); if (a) { result.push({ ...a }); usedDescs.add(a.desc); } }
    return result;
}

function generateRandomItems(locationType, gender, region = null, city = null) {
    console.log('=== Генерация предметов ===', { locationType, gender, region, city });
    let allItems = [];
    // Базовый пул
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
    // Региональный пул
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
    // Убираем дубли по имени
    const unique = [];
    const names = new Set();
    for (const it of allItems) {
        if (!names.has(it.name)) { names.add(it.name); unique.push(it); }
    }
    if (unique.length === 0) return { items: [], statMods: {} };
    const shuffled = unique.sort(() => Math.random() - 0.5);
    const result = [], usedNames = new Set(), statMods = {};
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
    console.log('Итоговые предметы:', result.map(i => i.name));
    return { items: result, statMods };
}

// ========== ФУНКЦИЯ ПОЛУЧЕНИЯ ИНФОРМАЦИИ О ЛОКАЦИИ ==========
function getLocationInfo() {
    if (state.locationType === 'capital') {
        const city = CITIES[state.city];
        const detail = LOCATION_DETAILS[`city_${state.city}`];
        return {
            type: 'capital', typeName: LOCATION_TYPES.capital.name, typeIcon: LOCATION_TYPES.capital.icon,
            name: city.name, icon: city.icon, region: REGIONS[city.region],
            fullName: `${city.icon} ${city.name}`, desc: detail.desc, legacyLocation: 'capital'
        };
    } else {
        const region = REGIONS[state.region];
        const type = LOCATION_TYPES[state.locationType];
        const detailKey = `${state.locationType}_${state.region}`;
        const detail = LOCATION_DETAILS[detailKey];
        return {
            type: state.locationType, typeName: type.name, typeIcon: type.icon, region: region,
            fullName: `${type.icon} ${type.name}, ${region.icon} ${region.name}`,
            desc: detail ? detail.desc : `${type.name} в ${region.name}`,
            legacyLocation: state.locationType
        };
    }
}

function updateLocationDescription() {
    const info = getLocationInfo();
    els.locationDesc.innerHTML = `<strong>${info.fullName}</strong><br>${info.desc}`;
    if (state.locationType === 'capital') {
        els.regionRow.style.display = 'none';
        els.cityRow.style.display = 'flex';
    } else {
        els.regionRow.style.display = 'flex';
        els.cityRow.style.display = 'none';
    }
}

// ========== НАСТРОЙКА ИНТЕРФЕЙСА ==========
function setupOptionButtons(containerId, stateKey, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;
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

function updatePaceInfo(pace) {
    const info = document.getElementById('pace-info');
    if (pace === 'season') info.innerHTML = `<strong>По сезонам:</strong> каждый ход = новый сезон<br><span class="pace-example">Зима 1993 → Весна 1993 → Лето 1993 → …</span>`;
    else info.innerHTML = `<strong>По годам:</strong> каждый ход = 9 месяцев <br><span class="pace-example">лето 1993 → Весна 1994 → Зима 1995 → …</span>`;
}

function updateDifficultyInfo(diff) {
    const info = document.getElementById('difficulty-info');
    if (diff === 'normal') info.innerHTML = `<strong>Норма:</strong> 4 варианта выбора. Одно чудесное спасение за игру.`;
    else info.innerHTML = `<strong>Хардкор:</strong> 3 варианта выбора. Никаких спасений.`;
}

function rollStartPreview() {
    const locInfo = getLocationInfo();
    let region = locInfo.type === 'capital' ? CITIES[state.city].region : state.region;
    const npcs = generateRandomNPCs(locInfo.legacyLocation, region, locInfo.type === 'capital' ? state.city : null);
    const { items, statMods } = generateRandomItems(locInfo.legacyLocation, state.gender, region, locInfo.type === 'capital' ? state.city : null);
    generatedStart = { npcs, items, statMods };
    renderStartPreview();
}

function renderStartPreview() {
    if (!generatedStart) return;
    const { npcs, items, statMods } = generatedStart;
    const locInfo = getLocationInfo();
    let html = '<h4>🎲 Стартовые данные</h4>';
    html += `<div style="margin-bottom:10px; padding:5px; background:#1c2128; border-radius:4px;"><strong>📍 ${locInfo.fullName}</strong><br><span style="font-size:0.8rem;">${locInfo.desc.substring(0,100)}...</span></div>`;
    html += '<div style="margin-bottom:10px"><strong style="color:var(--text-main);font-size:0.85rem;">Близкие люди:</strong></div>';
    npcs.forEach(n => html += `<div class="preview-item">• <strong>${n.name}</strong> — ${n.desc}</div>`);
    html += '<div style="margin:10px 0 5px 0"><strong style="color:var(--text-main);font-size:0.85rem;">Вещи:</strong></div>';
    items.forEach(i => {
        const modSign = i.mod > 0 ? '+' : '';
        const modClass = i.mod > 0 ? 'pos' : 'neg';
        const statName = STATS_INFO[i.stat]?.name || i.stat;
        html += `<div class="preview-item">• <strong>${i.name}</strong> — ${i.desc} <span class="stat-mod ${modClass}">${modSign}${i.mod} ${statName}</span></div>`;
    });
    const modEntries = Object.entries(statMods).filter(([k, v]) => v !== 0);
    if (modEntries.length) {
        html += '<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border-color);font-size:0.8rem;color:var(--text-dim);">Итого статы: ';
        html += modEntries.map(([k, v]) => `${STATS_INFO[k].name} ${v>0?'+':''}${v}`).join(', ');
        html += ' (от базы 5)</div>';
    }
    html += '<button class="reroll-btn" id="reroll-btn">🎲 Перебросить</button>';
    els.preview.innerHTML = html;
    document.getElementById('reroll-btn').onclick = rollStartPreview;
}

// ========== ЗАПУСК ИГРЫ ==========
function initGame(key) {
    userApiKey = key;
    els.setup.classList.add('hidden');
    els.game.classList.remove('hidden');
    const locInfo = getLocationInfo();
    els.locationDisplay.textContent = locInfo.fullName;
    renderUI();
    if (state.history.length === 0 && !state.gameOver) turn("Начало игры. Опиши обстановку и представь героя.");
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
    state.stats = { mind:5, body:5, family:5, friends:5, health:5, looks:5, wealth:5, authority:5 };
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

// ========== ФОРМИРОВАНИЕ КОНТЕКСТА ==========
function buildContextBlock() {
    let ctx = "\n=== ЛЮДИ вокруг ===\n";
    if (state.npcs.length) state.npcs.forEach(n => ctx += `- ${n.name}: ${n.desc}\n`);
    else ctx += "Никого рядом нет.\n";
    ctx += "\n=== ВЕЩИ и перки ГЕРОЯ ===\n";
    if (state.inventory.length) state.inventory.forEach(i => ctx += `- ${i.name}: ${i.desc}\n`);
    else ctx += "Ничего нет.\n";
    return ctx;
}
function buildSummaryBlock() { return state.lifeSummary ? `\n=== КРАТКАЯ ИСТОРИЯ ЖИЗНИ ГЕРОЯ ===\n${state.lifeSummary}\n` : ""; }
function buildStatsDescription() {
    let desc = "ТЕКУЩЕЕ СОСТОЯНИЕ ГЕРОЯ:\n";
    for (let [key, val] of Object.entries(state.stats)) {
        const info = STATS_INFO[key]; if (!info) continue;
        let status = "", impact = "";
        if (val === 0) { status = "GAME OVER (0/10)"; impact = "Полный крах: " + info.low; }
        else if (val === 1) { status = "ТРАГИЗМ ситуации (1/10)"; impact = "На грани гибели: " + info.low; }
        else if (val === 2) { status = "ОЧЕВИДНЫЕ и сильные ПРОБЛЕМЫ (2/10)"; impact = "Даже герой видит беду: " + info.low; }
        else if (val === 3) { status = "ЗНАЧИТЕЛЬНОЕ ОТКЛОНЕНИЕ (3/10)"; impact = "Герой считает нормой, но проблемы есть: " + info.low; }
        else if (val === 4) { status = "ЛЁГКОЕ ОТКЛОНЕНИЕ (4/10)"; impact = "Пока ещё не трагедия: — " + info.low; }
        else if (val === 5) { status = "НОРМА (5/10)"; impact = "Средний уровень, обычная жизнь"; }
        else if (val === 6) { status = "ЛЁГКОЕ ОТКЛОНЕНИЕ (6/10)"; impact = "Лёгкий привкус счастья — " + info.high; }
        else if (val === 7) { status = "ЗНАЧИТЕЛЬНОЕ ОТКЛОНЕНИЕ (7/10)"; impact = "Герой считает благом, но читатель видит проблемы: " + info.high; }
        else if (val === 8) { status = "ОЧЕВИДНЫЕ ПРОБЛЕМЫ (8/10)"; impact = "Даже герой видит перебор: " + info.high; }
        else if (val === 9) { status = "ТРАГИЗМ ситуации (9/10)"; impact = "На грани катастрофы: " + info.high; }
        else if (val === 10) { status = "GAME OVER (10/10)"; impact = "Полный крах от избытка: " + info.high; }
        desc += `- **${info.name}**: ${status} — ${impact}\n`;
    }
    return desc;
}
function getChoicesCount() { return state.difficulty === 'hardcore' ? 3 : 4; }
function getNextTime() {
    let nextSeasonIdx = state.seasonIdx + 1, nextYear = state.year;
    if (state.pace === 'year') { nextYear++; nextSeasonIdx = (state.seasonIdx + 3) % 4; }
    else if (nextSeasonIdx > 3) { nextSeasonIdx = 0; nextYear++; }
    return { nextSeasonIdx: nextSeasonIdx % 4, nextYear };
}
function advanceTime() {
    if (state.pace === 'year') { state.year++; state.age++; state.seasonIdx = (state.seasonIdx + 3) % 4; }
    else { state.seasonIdx++; if (state.seasonIdx > 3) { state.seasonIdx = 0; state.year++; state.age++; } }
}
function buildMainSystemPrompt(nextSeasonName, nextYear, choicesCount) {
    const statsDesc = buildStatsDescription(), genderInfo = GENDER_INFO[state.gender], locInfo = getLocationInfo();
    const contextBlock = buildContextBlock(), summaryBlock = buildSummaryBlock();
    let choicesTemplate = '';
    for (let i=1; i<=choicesCount; i++) {
        choicesTemplate += `        {"text": "Действие ${i}", "action": "художественное описание действия ${i}"}`;
        if (i<choicesCount) choicesTemplate += ',\n';
    }
    return `
Ты — мастер драматической и детально атмосферной текстовой RPG о жизни в России 90-х. драма и атмосферная ностальгия - это вся твоя суть.

ГЕРОЙ: ${genderInfo.name} (${state.age} лет)
ЛОКАЦИЯ: ${locInfo.fullName} — ${locInfo.desc}

Жанр: социальная драма, реализм, атмосферная ностальгия, историческая хроника.
Пиши интересно, подробно, атмосферно, с деталями быта 90-х и учётом географической локации. Придумывай запоминающиеся яркие диалоги и используй в своём ответе детали от которых бы ёкало сердце у тех кто был ребёнком в 90-е.

Текущее время: ${SEASONS[state.seasonIdx]} ${state.year}. Возраст: ${state.age}.
Следующий сезон: ${nextSeasonName} ${nextYear}.
${summaryBlock}
${contextBlock}
${statsDesc}

!!! КРИТИЧЕСКИЕ ПРАВИЛА !!!

1. Если появляется новый NPC — добавь его через add_npc.

2. Шкала 0-10. Середина = 5 (норма). И НИЗКИЕ и ВЫСОКИЕ крайности — ПРОБЛЕМЫ.
   ВЫСОКИЕ ПАРАМЕТРЫ — НЕ ПРОСТО ХОРОШО! Это источник напряжения.
   НИЗКИЕ ПАРАМЕТРЫ — тоже проблемы.

3. Учитывай пол (${genderInfo.name}), локацию (${locInfo.fullName} — ${locInfo.desc}), возраст (${state.age}).

4. Достаток влияет на доступные варианты, одежду, еду, отношение окружающих и возможность лечить плохое здоровье.

5. Авторитет у сверстников влияет на то, боятся или презирают героя, может ли он отказать, ведёт или ведомый. Это параметр склонен к снижению.

!!! ПРЕДМЕТЫ И ЛЮДИ — ЭТО ВАЖНО !!!

6. КАЖДЫЙ ХОД думай о предметах и людях. Добавляй 1 предмет/перк/персонажа, если он упоминался в тексте. Если не упоминается, лучше дополни описание старых.

7. Дополняй описания существующих людей и предметов, когда с ними что-то происходит, с пометкой сезона-года (используй update_npc / update_item).

ЗАДАЧА:
1. Опиши последствия выбора с учётом статов, пола, локации (60% текста).
2. Описывай текст глазами ребёнка, уместным возрасту языком.
3. ПЕРЕХОД к ${nextSeasonName} ${nextYear} (40% текста). Опиши смену времени, корреляцию с предыдущим выбором, флешбеки, изменения NPC.

ВЯЗКОСТЬ СТАТОВ: 
${JSON.stringify(state.stats)}
- 4-6: легко меняются
- 3,7: сложнее
- 2,8: очень вязкие
- 1,9: почти без изменений
Максимум ±2 за ход, общая сумма сдвигов ≤3.

РОВНО ${choicesCount} варианта выбора! КАЖДЫЙ вариант — развёрнутое описание (1-2 предложения, минимум 5 слов).
НЕ ПИШИ короткие варианты типа "Помочь маме". ПИШИ умеренно подробно.

ОТВЕТ СТРОГО В JSON:
{
    "story": "Текст истории. Markdown.",
    "choices": [ ${choicesTemplate} ],
    "updates": {
        "mind":0, "body":0, "family":0, "friends":0, "health":0, "looks":0, "wealth":0, "authority":0,
        "add_item": {"name":"...", "desc":"..."} или null,
        "remove_item": "..." или null,
        "update_item": {"name":"...", "desc":"..."} или null,
        "add_npc": {"name":"...", "desc":"..."} или null,
        "remove_npc": "..." или null,
        "update_npc": {"name":"...", "desc":"..."} или null
    }
}`;
}

// ========== УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ВЫЗОВА LLM ==========
async function callLLM({ messages, model, temperature, max_tokens, response_format }, retries = 2) {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    console.log('========== ПОЛНЫЙ ПРОМПТ К LLM ==========');
    console.log('Модель:', model || MODEL, 'Темп:', temperature || 0.6, 'Max tokens:', max_tokens || 2500);
    messages.forEach((msg,i) => {
        console.log(`[${i}] ${msg.role}:`);
        console.log(msg.content.substring(0,500) + (msg.content.length>500?'...':''));
    });
    window.lastPrompt = messages;

    const makeRequest = async (attempt) => {
        // Пробуем пользовательский ключ
        if (userApiKey && userApiKey.trim() !== '') {
            try {
                console.log(`Попытка ${4-attempt}/3 с пользовательским ключом...`);
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 минут
                const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userApiKey}` };
                const requestBody = {
                    model: model || MODEL,
                    messages: messages,
                    temperature: temperature || 0.6,
                    max_tokens: max_tokens || 2500
                };
                if (response_format) requestBody.response_format = response_format;
                const response = await fetch('https://api.hydraai.ru/v1/chat/completions', {
                    method: 'POST', headers, body: JSON.stringify(requestBody), signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const err = await response.text();
                    throw new Error(`HTTP ${response.status}: ${err}`);
                }
                return await response.json();
            } catch (err) {
                console.error(`Попытка с пользовательским ключом не удалась:`, err);
                if (attempt > 1) {
                    await new Promise(r => setTimeout(r, 2000 * (3-attempt)));
                    return makeRequest(attempt-1);
                }
                if (!isLocal) console.log('Переключаемся на серверный ключ');
                else throw new Error('Не удалось подключиться с вашим ключом. Проверьте ключ.');
            }
        }

        // Если локально и нет ключа – ошибка
        if (isLocal && (!userApiKey || userApiKey.trim() === '')) {
            throw new Error('Для локальной разработки необходимо ввести API ключ Hydra в поле ввода.');
        }

        // Пробуем серверный эндпоинт (только не локально)
        if (!isLocal) {
            try {
                console.log(`Попытка ${4-attempt}/3 с серверным ключом...`);
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 600000);
                const response = await fetch('/api/hydra', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages, model: model||MODEL,
                        temperature: temperature||0.6,
                        max_tokens: max_tokens||2500,
                        response_format
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const err = await response.json().catch(()=>({}));
                    throw new Error(`Сервер вернул ${response.status}: ${err.error||''}`);
                }
                return await response.json();
            } catch (err) {
                console.error(`Ошибка серверного вызова:`, err);
                if (attempt > 1) {
                    await new Promise(r => setTimeout(r, 2000 * (3-attempt)));
                    return makeRequest(attempt-1);
                }
                throw new Error(`Не удалось получить ответ после нескольких попыток.`);
            }
        }
        throw new Error('Нет доступных способов подключения. Введите API ключ.');
    };
    return makeRequest(3);
}

// ========== ГЕНЕРАЦИЯ СВОДКИ ==========
async function generateLifeSummary() {
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    const fullHistory = state.history.map(h => h.role==='user'?`>> Выбор: ${h.content}`:`<< ${h.content}`).join("\n\n");
    const npcsDesc = state.npcs.map(n=>`- ${n.name}: ${n.desc}`).join("\n");
    const invDesc = state.inventory.map(i=>`- ${i.name}: ${i.desc}`).join("\n");
    const prevSummary = state.lifeSummary ? `\nПРЕДЫДУЩАЯ СВОДКА:\n${state.lifeSummary}\n` : '';
    const prompt = `Ты — архивариус. Составь КРАТКУЮ СВОДКУ (10-15 предложений) всей жизни персонажа.

ГЕРОЙ: ${genderInfo.name}, сейчас ${state.age} лет
ЛОКАЦИЯ: ${locInfo.fullName}
СТАТЫ: ${JSON.stringify(state.stats)}
${prevSummary}
БЛИЗКИЕ ЛЮДИ:
${npcsDesc||"Нет"}

ВЕЩИ:
${invDesc||"Нет"}

НЕДАВНЯЯ ИСТОРИЯ:
${fullHistory}

ОТВЕТ В JSON: { "summary": "Сводка..." }`;
    try {
        const completion = await callLLM({
            messages: [{ role: "system", content: prompt }, { role: "user", content: "Составь сводку." }],
            model: MODEL,
            response_format: { type: "json_object" }
        });
        const data = parseJSON(completion.choices[0].message.content);
        if (data?.summary) {
            state.lifeSummary = data.summary;
            if (state.history.length > 6) state.history = state.history.slice(-6);
            state.lastSummaryTurn = state.turnCount;
        }
    } catch (e) { console.error("Summary error:", e); }
}

// ========== СЖАТИЕ ИСТОРИИ ==========
async function compressHistory(oldSummary, recentTexts) {
    const prompt = `Ты архивариус. Составь краткую сводку (не больше 5 предложений) истории жизни персонажа на основе предыдущей сводки и последних событий. Используй только факты, ничего не выдумывай.

Предыдущая сводка:
${oldSummary || 'Нет'}

Последние события:
${recentTexts.map((t,i)=>`Событие ${i+1}:\n${t}`).join('\n\n')}

Сводка:`;
    try {
        const completion = await callLLM({
            messages: [{ role: "user", content: prompt }],
            model: MODEL,
            temperature: 0.3,
            max_tokens: 500
        });
        return completion.choices[0].message.content.trim();
    } catch (e) {
        console.error("Ошибка сжатия истории:", e);
        return oldSummary;
    }
}

// ========== ОСНОВНОЙ ХОД ==========
async function turn(action) {
    if (state.gameOver) return;
    setLoading(true);
    state.turnCount++;

    const needSummary = (state.turnCount - state.lastSummaryTurn) >= SUMMARY_INTERVAL && state.history.length >= 10;
    if (needSummary) await generateLifeSummary();

    const { nextSeasonIdx, nextYear } = getNextTime();
    const nextSeasonName = SEASONS[nextSeasonIdx];
    const choicesCount = getChoicesCount();

    // ===== Формируем контекст для первого прохода =====
    let contextForFirstPass = [];
    if (state.turnCount <= 4) {
        contextForFirstPass = state.originalHistory.slice(); // все предыдущие оригиналы
    } else {
        const lastCompress = state.lastCompressTurn;
        const unsqueezed = state.originalHistory.slice(lastCompress);
        if (unsqueezed.length <= 3) {
            contextForFirstPass = [state.compressedSummary, ...unsqueezed];
        } else {
            contextForFirstPass = [state.compressedSummary, ...unsqueezed.slice(-4)];
        }
    }
    const contextText = contextForFirstPass.length > 0
        ? "=== КОНТЕКСТ ИСТОРИИ ===\n" + contextForFirstPass.join('\n\n---\n\n')
        : "";

    const systemPrompt = buildMainSystemPrompt(nextSeasonName, nextYear, choicesCount);
    const fullSystemPrompt = contextText ? contextText + "\n\n" + systemPrompt : systemPrompt;

    // ===== ПЕРВЫЙ ВЫЗОВ (генерация) =====
    const historyForLLM = state.history.map(msg => ({
        role: msg.role,
        content: msg.role === 'assistant' ? msg.original || msg.content : msg.content
    }));

    const completion1 = await callLLM({
        messages: [
            { role: "system", content: fullSystemPrompt },
            ...historyForLLM,
            { role: "user", content: `Мой выбор: ${action}. (Сгенерируй атмосферно описанный результат и переход в ${nextSeasonName} ${nextYear})` }
        ],
        model: MODEL,
        temperature: 0.5,
        max_tokens: 2500,
        response_format: { type: "json_object" }
    });

    const raw1 = completion1.choices[0].message.content;
    const data = parseJSON(raw1);
    if (!data?.story || !data?.choices) {
        console.error("Invalid JSON:", raw1);
        els.story.innerHTML = renderMarkdown("**Ошибка:** некорректный ответ.\n\nПовторите ход.");
        showRetryButton(action);
        setLoading(false);
        return;
    }

    const originalStory = data.story;
    state.originalHistory.push(originalStory);

    // ===== ВТОРОЙ ВЫЗОВ (улучшение) =====
    const lastEnhanced = state.enhancedHistory.length ? state.enhancedHistory[state.enhancedHistory.length-1] : null;
    const prevOriginal = state.originalHistory.length > 1 ? state.originalHistory[state.originalHistory.length-2] : null;

    const locInfo = getLocationInfo();
    const genderInfo = GENDER_INFO[state.gender];
    const npcList = state.npcs.map(n=>`- ${n.name}: ${n.desc}`).join('\n');
    const itemList = state.inventory.map(i=>`- ${i.name}: ${i.desc}`).join('\n');
    const summary = state.lifeSummary ? `Краткая история жизни: ${state.lifeSummary}` : '';
    const locationTypeStr = { capital:'большой город (столица)', town:'город', village:'село' }[state.locationType] || 'город';

    let statsGuidance = '';
    for (let [key,val] of Object.entries(state.stats)) {
        const info = STATS_INFO[key]; if (!info) continue;
        let levelDesc = '';
        if (val === 5) continue;
        else if (val === 4) levelDesc = `У героя слегка низкий параметр ${info.name}. Лёгкий намёк в тексте, без трагизма.`;
        else if (val === 6) levelDesc = `У героя слегка высокий параметр ${info.name}. Лёгкий намёк в тексте, без трагизма.`;
        else if (val === 3) levelDesc = `У героя тревожно низкий параметр ${info.name}. Сам он не видит проблемы, но проблемы есть. Отрази.`;
        else if (val === 7) levelDesc = `У героя тревожно высокий параметр ${info.name}. Сам он не видит проблемы, но проблемы есть. Отрази.`;
        else if (val === 2) levelDesc = `У героя очень низкий параметр ${info.name}. Красной нитью по всему тексту.`;
        else if (val === 8) levelDesc = `У героя очень высокий параметр ${info.name}. Красной нитью по всему тексту.`;
        else if (val <=1 || val >=9) {
            const critical = val <=1 ? 'критически низкий' : 'критически высокий';
            levelDesc = `У героя ${critical} параметр ${info.name}. Треть текста должна быть обращена на это.`;
        }
        if (levelDesc) statsGuidance += levelDesc + '\n';
    }

    const enhancementPrompt = `Ты мастер социально драматической художественной текстовой игры про детство в 1990-х. Ниже текст увеличь в 1,5 раза, насытив аутентичными диалогами и описаниями. Исправь очевидные ляпы, ориентируйся на поедыдущую историю как на абсолютный канон. Не пиши предисловий и послесловий. не используй пост-знания и мета размышления героя об эпохе. повествование должно исходить изнутри эпохи, а не над эпохой.
    
    ТЕКСТ ДЛЯ УЛУЧШЕНИЯ (только его нужно переписать, остальное ниже — справочная информация):

${originalStory}

Контекст для лучшего понимания предыдущего сюжета(справочно. не для улучшения):
- последний ход: ${lastEnhanced || 'нет'}
- предпоследний ход: ${prevOriginal || 'нет'}

Общий контекст:
- герой: ${genderInfo.name}, ${state.age} лет.
- локация: ${locInfo.fullName} (${locationTypeStr}) — ${locInfo.desc}
- знакомые люди:
${npcList || 'Нет'}
- предметы:
${itemList || 'Нет'}
${summary ? '\n' + summary : ''}

${statsGuidance ? `Особые указания по параметрам персонажа (вплетай органично, если уместно, иначе игнорируй). Повествование от лица ${state.age} лет, язык повесивования должен быть уместен возрасту и уму героя. не используй в повествовании термины не свойственные возрасту героя:
${statsGuidance}` : ''}`;

    let enhancedStory = originalStory;
    try {
        const completion2 = await callLLM({
            messages: [{ role: "user", content: enhancementPrompt }],
            model: "hydra-gemini-3-pro",
            temperature: 0.7,
            max_tokens: 3000
        });
        const raw2 = completion2.choices[0].message.content;
        if (raw2?.trim()) enhancedStory = raw2.trim();
    } catch (e) { console.error("Ошибка улучшения:", e); }

    state.enhancedHistory.push(enhancedStory);

    // ===== СЖАТИЕ ПОСЛЕ КАЖДОГО 4-ГО ХОДА =====
    if (state.turnCount % 4 === 0 && state.turnCount > 0) {
        const recent = state.originalHistory.slice(-4);
        const newSummary = await compressHistory(state.compressedSummary, recent);
        state.compressedSummary = newSummary;
        state.lastCompressTurn = state.turnCount;
    }

    // ===== СОХРАНЕНИЕ В ИСТОРИЮ =====
    state.history.push({ role: "user", content: action });
    state.history.push({ role: "assistant", content: raw1, original: originalStory, enhanced: enhancedStory });
    if (state.history.length > HISTORY_LIMIT) state.history = state.history.slice(-HISTORY_LIMIT);

    applyUpdates(data.updates);
    state.lastStory = enhancedStory;
    state.lastChoices = data.choices;
    advanceTime();

    await checkCriticalStats(state.lastStory);
    save();
    renderUI();
    setLoading(false);
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

// ========== ПРОВЕРКА КРИТИЧЕСКИХ СТАТОВ ==========
async function checkCriticalStats(precedingStory) {
    const crits = [];
    for (let [k,v] of Object.entries(state.stats)) {
        if (STATS_INFO[k] && (v <= 0 || v >= 10))
            crits.push({ stat:k, value:v, name:STATS_INFO[k].name, low:STATS_INFO[k].low, high:STATS_INFO[k].high });
    }
    if (crits.length === 0) return;
    if (state.difficulty === 'normal' && state.miracleAvailable && !state.miracleUsed) {
        state.miracleUsed = true; state.miracleAvailable = false;
        for (let c of crits) {
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
    setLoading(true);
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    const npcsDesc = state.npcs.map(n=>`- ${n.name}: ${n.desc}`).join("\n");
    const choicesCount = getChoicesCount();
    let critsDesc = crits.map(c => `- ${c.name}: ${c.value<=0?c.low:c.high} (было ${c.value}/10, откатилось до ${c.value<=0?3:7}/10)`).join("\n");
    const summaryBlock = state.lifeSummary ? `\n=== ИСТОРИЯ ЖИЗНИ ===\n${state.lifeSummary}\n` : '';
    let choicesTemplate = '';
    const exampleTexts = ["Пойти к Серёге и попросить помощи", "Промолчать и проглотить обиду", "Рассказать маме правду", "Взять дело в свои руки"];
    for (let i=1; i<=choicesCount; i++) {
        const ex = exampleTexts[i-1] || `Подробное описание действия ${i}`;
        choicesTemplate += `        {"text": "${ex}", "action": "Подробная инструкция"}`;
        if (i<choicesCount) choicesTemplate += ',\n';
    }
    const systemPrompt = `Ты мастер драматических RPG. Произошло ЧУДЕСНОЕ СПАСЕНИЕ.

=== ГЕРОЙ ===
Пол: ${genderInfo.name}, Возраст: ${state.age}, Локация: ${locInfo.fullName} — ${locInfo.desc}
=== КРИТИЧЕСКИЕ ПАРАМЕТРЫ ===
${critsDesc}
=== БЛИЗКИЕ ЛЮДИ ===
${npcsDesc || "Никого"}
${summaryBlock}
=== ЧТО ПРОИЗОШЛО ===
${precedingStory}
=== КОНЕЦ ===

Задача: Напиши ПРОДОЛЖЕНИЕ — чудесное спасение (3-4 абзаца) и ${choicesCount} варианта действий ПОСЛЕ спасения. Варианты должны учитывать НОВУЮ ситуацию.

ОТВЕТ JSON: { "miracle_story": "...", "choices": [${choicesTemplate}] }`;
    try {
        const completion = await callLLM({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Продолжи историю" }],
            model: MODEL,
            response_format: { type: "json_object" }
        });
        const data = parseJSON(completion.choices[0].message.content);
        if (data?.miracle_story) {
            state.lastMiracle = data.miracle_story;
            if (data.choices) state.lastChoices = data.choices;
            state.history.push({ role: "assistant", content: JSON.stringify({
                story: state.lastStory + "\n\n---\n\n**✨ ЧУДЕСНОЕ СПАСЕНИЕ**\n\n" + data.miracle_story,
                choices: data.choices
            })});
        }
    } catch (e) {
        console.error("Miracle error:", e);
        state.lastMiracle = "Но судьба смилостивилась. Каким-то чудом всё обошлось...";
        state.lastChoices = [
            { text: "Попытаться осмыслить произошедшее", action: "Герой пытается понять, что произошло" },
            { text: "Поблагодарить того, кто помог", action: "Герой благодарит спасителя" },
            { text: "Двигаться дальше", action: "Герой решает забыть" }
        ];
        if (getChoicesCount() === 4) state.lastChoices.push({ text: "Извлечь урок", action: "Решает изменить жизнь" });
    }
    setLoading(false);
}

async function generateGameOverStory(crits, precedingStory) {
    setLoading(true);
    const fullHistory = state.history.map(h => h.role==='user'?`>> ${h.content}`:`<< ${h.content}`).join("\n\n");
    const npcsDesc = state.npcs.map(n=>`- ${n.name}: ${n.desc}`).join("\n");
    const invDesc = state.inventory.map(i=>`- ${i.name}: ${i.desc}`).join("\n");
    const genderInfo = GENDER_INFO[state.gender];
    const locInfo = getLocationInfo();
    let critsDesc = crits.map(c => `- ${c.name}: ${c.value<=0?c.low:c.high} (значение ${c.value}/10)`).join("\n");
    const summaryBlock = state.lifeSummary ? `\n=== КРАТКАЯ ИСТОРИЯ ===\n${state.lifeSummary}\n` : '';
    const systemPrompt = `Ты мастер драматических RPG. Игра завершена трагически.

=== ГЕРОЙ ===
Пол: ${genderInfo.name}, Возраст: ${state.age}, Локация: ${locInfo.fullName} — ${locInfo.desc}
=== КРИТИЧЕСКИЕ ПАРАМЕТРЫ ===
${critsDesc}
=== БЛИЗКИЕ ЛЮДИ ===
${npcsDesc || "Никого"}
=== ВЕЩИ ===
${invDesc || "Ничего"}
${summaryBlock}
=== ЧТО ПРОИЗОШЛО ===
${precedingStory}
=== НЕДАВНЯЯ ИСТОРИЯ ===
${fullHistory}

Задача: Напиши ТРАГИЧЕСКИЙ ЭПИЛОГ (7-10 абзацев), продолжающий историю. Объясни причины, опиши последствия для каждого близкого. Не выдумывай новых персонажей.

ОТВЕТ JSON: { "epilogue": "...", "reasons": ["..."], "epitaph": "..." }`;
    try {
        const completion = await callLLM({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Напиши трагический финал" }],
            model: MODEL,
            response_format: { type: "json_object" }
        });
        const data = parseJSON(completion.choices[0].message.content);
        if (data) state.gameOverData = data;
    } catch (e) {
        console.error("Game Over error:", e);
        state.gameOverData = {
            epilogue: `Судьба ${genderInfo.name} оборвалась в ${state.age} лет.`,
            reasons: crits.map(c => c.name + " достиг критического уровня"),
            epitaph: "Эпоха перемен забрала рано"
        };
    }
    setLoading(false);
}

// ========== ПРИМЕНЕНИЕ ОБНОВЛЕНИЙ ==========
function getCurrentDateString() { return `${SEASONS[state.seasonIdx]} ${state.year}`; }
function applyUpdates(u) {
    if (!u) return;
    
    // Собираем все дельты статов
    const deltas = {};
    let totalDeltaSum = 0;
    for (let k in state.stats) {
        if (u[k] !== undefined && typeof u[k] === 'number') {
            let delta = u[k];
            // Ограничиваем каждое изменение до ±2
            if (delta > 2) delta = 2;
            if (delta < -2) delta = -2;
            deltas[k] = delta;
            totalDeltaSum += Math.abs(delta);
        }
    }
    
    // Если сумма изменений превышает 3, масштабируем все дельты
    if (totalDeltaSum > 3) {
        const scale = 3 / totalDeltaSum;
        for (let k in deltas) {
            deltas[k] = Math.round(deltas[k] * scale); // округление для целых чисел
        }
        // Из-за округления сумма может снова стать >3, но это редкость
    }
    
    // Применяем изменения с учётом вязкости и первого хода
    for (let k in deltas) {
        let delta = deltas[k];
        const current = state.stats[k];
        let apply = true;
        
        // На первом ходу изменения статов не применяем (только для истории)
        if (state.turnCount === 1) {
            apply = false;
            console.log(`🚫 Первый ход: изменение ${STATS_INFO[k]?.name || k} заблокировано (${current} → ${current+delta})`);
        } else {
            // Вязкость: экстремальные значения сложнее менять
            if (delta > 0 && current >= 6) {
                const chance = (state.pace === 'season') ? 0.25 : 0.5;
                apply = Math.random() < chance;
                if (!apply) console.log(`🛡️ Вязкость: повышение ${STATS_INFO[k]?.name || k} заблокировано (${current} → ${current+delta}) в ${state.pace} режиме`);
            } else if (delta < 0 && current <= 4) {
                const chance = (state.pace === 'season') ? 0.25 : 0.5;
                apply = Math.random() < chance;
                if (!apply) console.log(`🛡️ Вязкость: понижение ${STATS_INFO[k]?.name || k} заблокировано (${current} → ${current+delta}) в ${state.pace} режиме`);
            }
        }
        
        if (apply) {
            state.stats[k] = current + delta;
            if (state.stats[k] > 10) state.stats[k] = 10;
            if (state.stats[k] < 0) state.stats[k] = 0;
        }
    }
    
    // Обработка предметов и NPC (без изменений)
    if (u.add_item?.name && !state.inventory.find(i => i.name === u.add_item.name)) {
        state.inventory.push({ name: u.add_item.name, desc: u.add_item.desc || "Без описания" });
    }
    if (u.remove_item && typeof u.remove_item === 'string') {
        state.inventory = state.inventory.filter(i => i.name !== u.remove_item);
    }
    if (u.update_item?.name) {
        const item = state.inventory.find(i => i.name === u.update_item.name);
        if (item && u.update_item.desc) {
            const dateStr = getCurrentDateString();
            item.desc += `\n\n*(${dateStr})* ${u.update_item.desc}`;
        }
    }
    if (u.add_npc?.name && !state.npcs.find(n => n.name === u.add_npc.name)) {
        state.npcs.push({ name: u.add_npc.name, desc: u.add_npc.desc || "Без описания" });
    }
    if (u.remove_npc && typeof u.remove_npc === 'string') {
        state.npcs = state.npcs.filter(n => n.name !== u.remove_npc);
    }
    if (u.update_npc?.name) {
        const npc = state.npcs.find(n => n.name === u.update_npc.name);
        if (npc && u.update_npc.desc) {
            const dateStr = getCurrentDateString();
            npc.desc += `\n\n*(${dateStr})* ${u.update_npc.desc}`;
        }
    }
}

// ========== ОТРИСОВКА ==========
function renderUI() {
    const locInfo = getLocationInfo();
    els.dateText.innerText = `${SEASONS[state.seasonIdx]} ${state.year} | ${state.age} лет`;
    els.locationDisplay.textContent = locInfo.fullName;

    let modeHTML = '';
    if (state.difficulty === 'hardcore') modeHTML = `<span class="mode-badge hardcore">💀 ХАРДКОР</span>`;
    else {
        modeHTML = `<span class="mode-badge normal">🛡️ НОРМА</span>`;
        if (!state.miracleUsed) modeHTML += `<span class="miracle-badge available">✨ Спасение доступно</span>`;
        else modeHTML += `<span class="miracle-badge used">✨ Спасение использовано</span>`;
    }
    if (state.lifeSummary) modeHTML += `<span class="summary-badge">📝 Сводка: ход ${state.lastSummaryTurn}</span>`;
    els.modeDisplay.innerHTML = modeHTML;

    if (state.gameOver && state.gameOverData) {
        const god = state.gameOverData;
        els.story.innerHTML = renderMarkdown(state.lastStory||'') +
            `<hr><div class="game-over-banner"><h2>💀 GAME OVER</h2><p>${SEASONS[state.seasonIdx]} ${state.year}, ${state.age} лет</p></div>` +
            `<h2 style="color:var(--accent);">🕯️ Эпилог</h2>${renderMarkdown(god.epilogue||'')}` +
            `<div class="game-over-reasons"><strong>Что привело:</strong><ul>${god.reasons?.map(r=>`<li>${r}</li>`).join('')||''}</ul></div>` +
            renderMarkdown(`> *"${god.epitaph||''}"*`);
    } else if (state.lastMiracle) {
        els.story.innerHTML = renderMarkdown(state.lastStory||'') +
            `<hr><div class="miracle-banner"><h2>✨ ЧУДЕСНОЕ СПАСЕНИЕ</h2><p>Судьба смилостивилась...</p></div>` +
            renderMarkdown(state.lastMiracle) + `<hr><p><em>Спасение использовано.</em></p>`;
        state.lastMiracle = null;
    } else {
        els.story.innerHTML = renderMarkdown(state.lastStory || 'Загрузка...');
    }

    els.choices.innerHTML = "";
    if (state.gameOver) {
        const btn = document.createElement('button');
        btn.className = "choice-btn";
        btn.style.borderColor = "var(--danger)";
        btn.innerText = "🔄 Начать новую жизнь";
        btn.onclick = resetGame;
        els.choices.appendChild(btn);
    } else if (state.lastChoices) {
        state.lastChoices.forEach(ch => {
            const btn = document.createElement('button');
            btn.className = "choice-btn";
            btn.innerText = ch.action || ch.text;
            btn.onclick = () => turn(ch.action);
            els.choices.appendChild(btn);
        });
    }

    els.stats.innerHTML = "";
    for (let [k, v] of Object.entries(state.stats)) {
        if (!STATS_INFO[k]) continue;
        const dist = Math.abs(v-5);
        let colorClass = "val-norm";
        if (dist === 1) colorClass = "val-flavor";
        else if (dist === 2) colorClass = "val-skew";
        else if (dist === 3) colorClass = "val-bad";
        else if (dist >= 4) colorClass = "val-crit";
        els.stats.innerHTML += `<div class="stat-row"><span>${STATS_INFO[k].name}</span><span class="${colorClass}">${v}</span></div>`;
    }

    renderLoreList(els.inv, state.inventory);
    renderLoreList(els.npcs, state.npcs);
}

function renderLoreList(container, items) {
    container.innerHTML = "";
    if (!items?.length) { container.innerHTML = "<div style='font-size:0.8em; color:#555'>Пусто...</div>"; return; }
    items.forEach(item => {
        const d = document.createElement('details');
        d.innerHTML = `<summary>${item.name}</summary><div class="lore-desc">${item.desc || "Нет описания."}</div>`;
        container.appendChild(d);
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========
function tryLoadSavedGame() {
    const saved = localStorage.getItem('rpg90_state');
    const key = localStorage.getItem('rpg90_key');
    if (!saved || !key) return false;
    try {
        state = JSON.parse(saved);
        if (!state.locationType) { state.locationType = state.location || 'capital'; state.region = 'central'; state.city = 'moscow'; }
        if (state.difficulty === undefined) state.difficulty = 'normal';
        if (state.miracleUsed === undefined) state.miracleUsed = false;
        if (state.miracleAvailable === undefined) state.miracleAvailable = (state.difficulty === 'normal');
        if (state.turnCount === undefined) state.turnCount = 0;
        if (state.lifeSummary === undefined) state.lifeSummary = "";
        if (state.lastSummaryTurn === undefined) state.lastSummaryTurn = 0;
        if (state.stats.wealth === undefined) state.stats.wealth = 5;
        if (state.stats.authority === undefined) state.stats.authority = 5;
        if (!state.originalHistory) state.originalHistory = [];
        if (!state.enhancedHistory) state.enhancedHistory = [];
        if (!state.compressedSummary) state.compressedSummary = "";
        if (!state.lastCompressTurn) state.lastCompressTurn = 0;

        userApiKey = key;
        els.setup.classList.add('hidden');
        els.game.classList.remove('hidden');
        const locInfo = getLocationInfo();
        els.locationDisplay.textContent = locInfo.fullName;
        renderUI();
        return true;
    } catch (e) {
        console.error('Ошибка загрузки сохранения:', e);
        localStorage.removeItem('rpg90_state');
        return false;
    }
}

window.copyHistoryToClipboard = async function() {
    try {
        let historyText = '';
        if (state.enhancedHistory.length) {
            historyText = state.enhancedHistory.map((text, i) => `📖 Ход ${i+1}:\n${text}`).join('\n\n---\n\n');
        } else {
            historyText = 'История пока пуста.';
        }
        const locInfo = getLocationInfo();
        const header = `=== ЭПОХА ПЕРЕМЕН: 1993 ===\nПерсонаж: ${GENDER_INFO[state.gender].name}, ${state.age} лет\nЛокация: ${locInfo.fullName}\nДата: ${SEASONS[state.seasonIdx]} ${state.year}\n\n`;
        const statsText = Object.entries(state.stats).map(([k,v])=>`${STATS_INFO[k].name}: ${v}`).join(', ');
        await navigator.clipboard.writeText(header + `Текущие параметры: ${statsText}\n\n=== ИСТОРИЯ ===\n${historyText}`);
        alert('✅ История скопирована!');
    } catch (err) {
        console.error('Ошибка копирования:', err);
        alert('❌ Не удалось скопировать историю.');
    }
};

const savedGameLoaded = tryLoadSavedGame();

if (!savedGameLoaded) {
    els.setup.classList.remove('hidden');
    els.game.classList.add('hidden');
    if (localStorage.getItem('rpg90_key')) els.keyInput.value = localStorage.getItem('rpg90_key');

    setupOptionButtons('gender-btns', 'gender');
    setupOptionButtons('location-type-btns', 'locationType', value => { updateLocationDescription(); rollStartPreview(); });
    setupOptionButtons('pace-btns', 'pace');
    setupOptionButtons('difficulty-btns', 'difficulty');

    els.regionSelect.onchange = e => { state.region = e.target.value; updateLocationDescription(); rollStartPreview(); };
    els.citySelect.onchange = e => { state.city = e.target.value; updateLocationDescription(); rollStartPreview(); };
    document.getElementById('start-age').onchange = e => state.startAge = parseInt(e.target.value);

    updateLocationDescription();
    rollStartPreview();
}

els.startBtn.onclick = () => {
    const key = els.keyInput.value.trim();
    if (!key) console.log('Поле API ключа пусто, будет использован серверный ключ');
    userApiKey = key || null;
    localStorage.setItem('rpg90_key', key);
    applyStartSettings();
    initGame(key);
};