import test from 'node:test';
import assert from 'node:assert/strict';
import {LAYOUT_WIDGETS,layoutOrder,validateScreenLayouts,shiftLayout,insertLayoutBefore,layoutSpans} from '../assets/screen-layout.mjs';

test('Layouts normalize old/malformed settings without accepting unknown IDs or losing available widgets',()=>{
  const defaults=LAYOUT_WIDGETS.dashboard.map(item=>item.id);
  for(const raw of [undefined,null,1,'bad',[],{dashboard:null},{dashboard:Array(33).fill('next')}])assert.deepEqual(layoutOrder('dashboard',validateScreenLayouts(raw)),defaults);
  const clean=validateScreenLayouts(JSON.parse('{"dashboard":["recent","<script>","recent",null,"next"],"planner":["annual"],"__proto__":{"x":1}}'));
  assert.deepEqual(clean.dashboard.slice(0,2),['recent','next']);assert.equal(clean.dashboard.length,defaults.length);
  assert.equal(new Set(clean.dashboard).size,defaults.length);assert.equal(clean.planner[0],'annual');
  assert.equal(Object.hasOwn(clean,'__proto__'),false);assert.deepEqual(layoutOrder('constructor',clean),[]);
});
test('Arrow moves and drag insertion are immutable, bounded and retain every widget exactly once',()=>{
  const original=layoutOrder('planner'),copy=[...original];
  assert.deepEqual(shiftLayout(original,'calendar',-1),original);assert.deepEqual(shiftLayout(original,'annual',1),original);
  assert.deepEqual(shiftLayout(original,'calendar',1),['plans','calendar','restrictions','annual']);
  assert.deepEqual(insertLayoutBefore(original,'annual','calendar'),['annual','calendar','plans','restrictions']);
  assert.deepEqual(insertLayoutBefore(original,'calendar',null),['plans','restrictions','annual','calendar']);
  for(const bad of [insertLayoutBefore(original,'bad',null),insertLayoutBefore(original,'calendar','bad'),shiftLayout(original,'bad',1),shiftLayout(original,'calendar',100)])assert.deepEqual(bad,original);
  assert.deepEqual(original,copy);
});
test('Wide layouts pair adjacent cards and group metrics while isolated widgets fill their row',()=>{
  const defaults=layoutOrder('dashboard'),spans=layoutSpans('dashboard',defaults);
  assert.equal(spans.balance,3);assert.equal(spans.next,3);assert.equal(spans['whole-count'],2);assert.equal(spans.recent,6);
  const scattered=layoutSpans('dashboard',['whole-count','recent','next','plan-count','upcoming','releases']);
  assert.equal(scattered['whole-count'],6);assert.equal(scattered.next,6);assert.equal(scattered['plan-count'],6);assert.equal(scattered.upcoming,3);assert.equal(scattered.releases,3);
  assert.deepEqual(Object.values(layoutSpans('planner',layoutOrder('planner'))),[6,6,6,6]);
});
