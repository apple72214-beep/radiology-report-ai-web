import fs from 'node:fs';import assert from 'node:assert/strict';
const {build}=JSON.parse(fs.readFileSync(new URL('../release.json',import.meta.url)));
const app=fs.readFileSync(new URL(`../app.${build}.js`,import.meta.url),'utf8'),ui=fs.readFileSync(new URL(`../ui.${build}.html`,import.meta.url),'utf8');
for(const id of ['dual-toggle','dual-layout','dual-secondary','dual-frame','dual-slice'])assert(ui.includes(`id="${id}"`));
assert(app.includes('dualOn && dualActive===2'));assert(app.includes('dualStep(wanted-dualIndex)'));assert(ui.includes('flex:0 0 88px'));assert(app.includes('let overviewSync = false;'));
console.log('DUAL TEST PASS');
