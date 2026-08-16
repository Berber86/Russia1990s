import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');

for (const id of ['settings-modal', 'reset-confirm-modal', 'npcs-panel', 'items-panel', 'debug-modal', 'prompt-modal']) {
    assert.match(html, new RegExp(`id="${id}"[\\s\\S]*?role="dialog"`, 'm'), `${id} must contain a dialog`);
}

assert.match(html, /class="settings-tabs" role="tablist"/, 'Settings must expose a tablist');
assert.equal((html.match(/class="settings-tab-btn[^\"]*"[^>]*role="tab"/g) || []).length, 3, 'Settings must expose three tabs');
assert.match(html, /id="prompt-content" role="tabpanel"/, 'Prompt inspector content must expose a tabpanel');
assert.match(html, /id="app-toast" role="status" aria-live="polite"/, 'Toast must be a polite live region');
assert.match(html, /id="game-status-btn"[\s\S]*?Состояние героя/, 'Status control must clearly name the hero state');
assert.match(html, /id="status-mini-ring"/, 'Status control must expose a graphical state preview');
assert.match(html, /class="dossier-summary"/, 'Dossier must contain a graphical summary');
assert.match(html, /aria-describedby="reset-confirm-description"/, 'Destructive confirmation must expose its consequence');
assert.match(html, /<nav class="archive-strip" id="archive-strip" aria-label="Навигация по личной хронике">/, 'Archive must expose named navigation');
assert.match(html, /id="archive-label" role="status" aria-live="polite"/, 'Archive position must be announced as text');
assert.match(html, /id="archive-range"/, 'Archive must expose its chronological span');
assert.match(html, /id="archive-current-btn" aria-label="К текущей записи"/, 'Archive must offer an explicit way back to the current entry');
assert.match(html, /id="settings-reading-mode-btns" role="group"/, 'Reading preferences must be a named control group');
assert.match(html, /data-reading-mode="high-contrast"/, 'Reading preferences must offer a high-readability option');
assert.match(html, /id="continue-reading-btn"/, 'Story stage must expose an explicit continue-reading action');
assert.match(html, /Личная закладка/, 'Continue-reading action must explain its purpose');

assert.match(js, /const recordKind = archiveMode \? 'Архивная запись' : 'Текущая запись'/, 'Story record must clearly distinguish archive and current modes');
assert.match(js, /const recordHeader = hasStory \?/, 'Record passport must not render before a story exists');
assert.match(js, /class="story-record-header" aria-label="Сведения о записи"/, 'Story record passport must have a semantic label');
assert.match(js, /<time class="story-record-header__context">/, 'Record date and location must be exposed as time context');
assert.match(js, /Запись \$\{position\} из \$\{entries\.length\} · \$\{isArchive \? 'архив' : 'сейчас'\}/, 'Archive must name its current position and mode');
assert.match(js, /Хроника: \$\{firstDate\}/, 'Archive span must be derived from saved entries');
assert.match(js, /const READING_MODE_STORAGE_KEY = 'rpg90_reading_mode'/, 'Reading preference must stay outside game state');
assert.match(js, /function applyReadingMode\(mode\)/, 'Reading mode must apply immediately');
assert.match(js, /localStorage\.setItem\(READING_MODE_STORAGE_KEY, nextMode\)/, 'Reading mode must persist locally');
assert.match(js, /const READING_BOOKMARK_STORAGE_KEY = 'rpg90_reading_bookmark'/, 'Reading bookmark must stay outside game state');
assert.match(js, /function continueReadingFromBookmark\(\)/, 'Bookmark restoration must require an explicit action');
assert.match(js, /window\.scrollTo\(\{ top: target, behavior: 'smooth' \}\)/, 'Bookmark should scroll only after the explicit action');
assert.match(js, /if \(readingBookmarkFrame \|\| document\.body\.dataset\.screen !== 'game' \|\| isArchiveMode\(\)\) return/, 'Archive browsing must not create reading bookmarks');

assert.doesNotMatch(js, /\balert\s*\(/, 'Blocking alert() calls are not allowed');
assert.match(js, /openOverlay\(els\.resetConfirmModal, els\.resetCancelBtn\)/, 'Reset confirmation must focus the safe action first');
assert.match(js, /function openOverlay\(/, 'Shared overlay opening is required');
assert.match(js, /function closeOverlay\(/, 'Shared overlay closing is required');
assert.match(js, /event\.key !== 'Tab'/, 'Dialog focus trap must handle Tab');
assert.match(js, /setAttribute\('aria-pressed'/, 'Toggle buttons must expose aria-pressed');
assert.match(js, /setAttribute\('aria-selected'/, 'Tabs must expose aria-selected');
assert.match(js, /function renderStatusGraphic\(/, 'State preview must be derived from live stats');
assert.match(js, /buildStatusRingGradient\(state\.stats\)/, 'State ring must visualize live stats');

assert.match(css, /body\.dialog-open\s*\{[^}]*overflow:\s*hidden/s, 'Open dialogs must lock page scrolling');
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.game-status-btn\s*\{[\s\S]*?position:\s*fixed/s, 'Status control must stay reachable beside long mobile stories');
assert.match(css, /\.confirm-modal\s*\{\s*z-index:\s*1900/s, 'Reset confirmation must sit above the mobile dossier');
assert.match(css, /\.story-record-header\s*\{[\s\S]*?flex-wrap:\s*wrap/s, 'Record passport must wrap instead of truncating on narrow screens');
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.story-record-header__context\s*\{[\s\S]*?flex-basis:\s*100%/s, 'Mobile record context must remain readable on its own line');
assert.match(css, /body\[data-reading-mode="high-contrast"\] \.story-shell/, 'High-readability mode must alter the reading surface');
assert.match(css, /body\[data-reading-mode="calm"\] \.story-content/, 'Calm mode must alter reading rhythm');
assert.match(css, /\.continue-reading\s*\{/, 'Continue-reading action needs dedicated visible styling');

console.log('UI contract checks passed');
