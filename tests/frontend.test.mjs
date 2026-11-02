import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ANGLES, buildGroups, filterItems, groupKey, listEntries, readLocal, writeLocal } from '../js/lib/store.js';

const items = JSON.parse(await readFile(new URL('../data/pose-pt.json', import.meta.url), 'utf8'));
const state = { query:'', system:'', category:'', angle:'', collection:'all' };

test('groups include system identity and preserve all existing angles', () => {
    const groups = buildGroups(items);
    assert.equal(groups.size,288);
    assert.equal([...groups.values()].filter(group=>group.items.length===4).length,1);
    const sameNumber = items.filter(item=>item.numero==='P001');
    assert.equal(new Set(sameNumber.map(groupKey)).size,4);
    for (const group of groups.values()) {
        const ranks = group.items.map(item=>ANGLES.indexOf(item.angulo));
        assert.deepEqual(ranks,[...ranks].sort((a,b)=>a-b));
    }
});
test('combined Portuguese search and filters match every criterion', () => {
    const results=filterItems(items,{...state,query:'P001 sentada',system:'Corpo inteiro 1 pessoa · padrão',angle:'Frente'},[],[]);
    assert.equal(results.length,1);
    assert.equal(results[0].id,'full_single_P001_front');
    assert.equal(listEntries(items,true).length,288);
    assert.equal(listEntries(items,false).length,1439);
});
test('search ignores accents and case in both directions', () => {
    const accented=filterItems(items,{...state,query:'joelho ERGUIDO'},[],[]);
    assert.deepEqual(filterItems(items,{...state,query:'JOELHO erguido'},[],[]),accented);
    assert.ok(filterItems(items,{...state,query:'padrao'},[],[]).length>0);
    assert.equal(filterItems(items,{...state,query:'padrao'},[],[]).length,
                 filterItems(items,{...state,query:'padrão'},[],[]).length);
});
test('favorites and recents keep exact view identity and order', () => {
    const ids=['full_single_P001_side','full_single_P001_front'];
    assert.deepEqual(filterItems(items,{...state,collection:'recent'},[],ids).map(item=>item.id),ids);
    assert.deepEqual(filterItems(items,{...state,collection:'favorites'},[ids[0]],[]).map(item=>item.id),[ids[0]]);
});
test('unavailable or corrupt browser storage is harmless', () => {
    const storage=new Map();
    globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
    writeLocal('favorites.builtin',['x']);
    assert.deepEqual(readLocal('favorites.builtin',[]),['x']);
    storage.set('pose-gallery-pt.v1.favorites.builtin','{broken');
    assert.deepEqual(readLocal('favorites.builtin',[]),[]);
    globalThis.localStorage={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};
    assert.deepEqual(readLocal('favorites.builtin',[]),[]);
    assert.doesNotThrow(()=>writeLocal('favorites.builtin',[]));
});
