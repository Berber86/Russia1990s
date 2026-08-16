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

console.log('UI contract checks passed');
