import fs from 'node:fs';import assert from 'node:assert/strict';
const {build}=JSON.parse(fs.readFileSync(new URL('../release.json',import.meta.url)));
const ui=fs.readFileSync(new URL(`../ui.${build}.html`,import.meta.url),'utf8'),app=fs.readFileSync(new URL(`../app.${build}.js`,import.meta.url),'utf8');
assert(ui.includes('<details id="series-preview-fold" hidden>'));
assert(ui.includes('id="series-preview-summary"'));
assert(app.includes('rrai-series-preview-open'));
assert(ui.includes('#series-overview .series-live-grid { width:100%;max-width:100%;min-width:0;overflow-x:auto;'));
assert(ui.includes('.fs-fake #series-preview-fold,#viewer-card:fullscreen #series-preview-fold'));
console.log('SERIES FOLD TEST PASS');
