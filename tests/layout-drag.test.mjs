import test from 'node:test';
import assert from 'node:assert/strict';
import {installLayoutDrag} from '../assets/layout-drag.mjs';

function harness(){
  const timers=new Map(),frames=new Map(),drops=[],active=[],messages=[],scrolls=[];let serial=0,scroll=0;
  class Node{
    constructor(id=null){this.dataset=id?{layoutId:id,layoutLabel:id}:{};this.children=[];this.parentNode=null;this.style={};this.listeners=new Map();this.attrs=new Map();this.classList={add(){},remove(){}};}
    addEventListener(name,fn){const list=this.listeners.get(name)||[];list.push(fn);this.listeners.set(name,list);}
    removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)||[]).filter(x=>x!==fn));}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}
    closest(selector){if(selector==='[data-layout-id]')return this.dataset.layoutId?this:this.parentNode?.closest(selector)||null;return null;}
    querySelectorAll(){return this.children.filter(child=>child.dataset.layoutId);}
    appendChild(node){this.insertBefore(node,null);}
    insertBefore(node,before){if(node===before)return;node.remove();const index=before===null?this.children.length:this.children.indexOf(before);assert.ok(index>=0);this.children.splice(index,0,node);node.parentNode=this;}
    remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}
    get nextElementSibling(){if(!this.parentNode)return null;return this.parentNode.children[this.parentNode.children.indexOf(this)+1]||null;}
    setAttribute(key,value){this.attrs.set(key,value);}
    getAttribute(key){return this.attrs.get(key)??null;}
    removeAttribute(key){this.attrs.delete(key);if(key==='style')this.style={};}
    getBoundingClientRect(){
      if(this.style.position==='fixed')return {top:Number.parseFloat(this.style.top),left:20,width:320,height:Number.parseFloat(this.style.height)};
      const previous=this.parentNode?.children.slice(0,this.parentNode.children.indexOf(this))||[];
      const top=100-scroll+previous.reduce((sum,node)=>sum+(node.style.position==='fixed'?0:(Number.parseFloat(node.style.height)||120)+12),0);
      return {top,left:20,width:320,height:Number.parseFloat(this.style.height)||120};
    }
  }
  const root=new Node(),document=new Node(),view=new Node();view.innerHeight=800;view.scrollBy=({top})=>{scroll+=top;scrolls.push(top);};document.visibilityState='visible';document.createElement=()=>new Node();
  for(const id of ['a','b','c'])root.appendChild(new Node(id));
  const node=id=>root.querySelectorAll().find(item=>item.dataset.layoutId===id);
  const emit=(target,name,props={})=>{let prevented=false,stopped=false;const event={target:node('a'),pointerType:'mouse',pointerId:1,isPrimary:true,button:0,detail:1,...props,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}};for(const fn of [...target.listeners.get(name)||[]])fn(event);return {prevented,stopped};};
  const api=installLayoutDrag(root,{view,document,onDrop:(...args)=>drops.push(args),onActive:value=>active.push(value),onMessage:message=>messages.push(message),
    setTimer:(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id),requestFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id)});
  const point=(id,x=100,y=150)=>({identifier:id,clientX:x,clientY:y});
  return {root,document,view,node,emit,api,timers,frames,drops,active,messages,scrolls,point,
    ids:()=>root.querySelectorAll().map(item=>item.dataset.layoutId),
    hold(){for(const [id,entry] of timers){timers.delete(id);assert.equal(entry.delay,450);entry.fn();}},
    tick(){const next=frames.entries().next().value;if(next){frames.delete(next[0]);next[1]();}},
    touch(name,{id='a',x=100,y=150,touches,changedTouches}={}){return emit(root,name,{target:node(id),touches:touches??[point(1,x,y)],changedTouches:changedTouches??[point(1,x,y)]});}
  };
}
test('A touch hold lifts, moves and drops the original widget once, restoring styles and stopping every frame',()=>{
  const h=harness();assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  h.touch('touchstart');assert.equal(h.api.isDragging(),false);h.hold();assert.equal(h.api.isDragging(),true);
  assert.equal(h.node('a').style.position,'fixed');assert.equal(h.frames.size,1);
  assert.equal(h.touch('touchmove',{y:620}).prevented,true);assert.equal(h.touch('touchend',{y:620}).prevented,true);
  assert.deepEqual(h.ids(),['b','c','a']);assert.deepEqual(h.drops,[['a',null]]);assert.deepEqual(h.active,[true,false]);
  assert.equal(h.node('a').style.position,undefined);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  assert.equal(h.emit(h.root,'click').stopped,true);assert.equal(h.emit(h.root,'click',{detail:0}).stopped,false);
});
test('A card can be dragged upward before another without duplicating or losing any cards',()=>{
  const h=harness();h.touch('touchstart',{id:'c',y:410});h.hold();h.touch('touchmove',{id:'c',y:105});h.touch('touchend',{id:'c',y:105});
  assert.deepEqual(h.ids(),['c','a','b']);assert.deepEqual(h.drops,[['c','a']]);assert.equal(h.root.children.length,3);
});
test('Scrolling before a hold, a short tap, two fingers and touch cancellation never commit a move',()=>{
  const h=harness();h.touch('touchstart');assert.equal(h.touch('touchmove',{y:180}).prevented,false);h.hold();assert.equal(h.api.isDragging(),false);h.touch('touchend');
  h.touch('touchstart');h.touch('touchend');h.hold();assert.equal(h.api.isDragging(),false);
  h.touch('touchstart');h.emit(h.view,'scroll');h.hold();assert.equal(h.api.isDragging(),false);
  h.touch('touchstart',{touches:[h.point(1),h.point(2)]});h.hold();assert.equal(h.api.isDragging(),false);
  h.touch('touchstart');h.hold();h.touch('touchmove',{y:620});h.touch('touchcancel');
  assert.deepEqual(h.ids(),['a','b','c']);assert.deepEqual(h.drops,[]);assert.equal(h.frames.size,0);
  h.touch('touchstart');h.hold();h.touch('touchstart',{touches:[h.point(1),h.point(2)]});assert.equal(h.api.isDragging(),false);assert.deepEqual(h.ids(),['a','b','c']);
});
test('Edge scrolling runs during an active hold only, and leaving the app restores the draft without a drop',()=>{
  const h=harness();h.touch('touchstart');h.hold();h.touch('touchmove',{y:790});h.tick();assert.ok(h.scrolls[0]>0);
  h.emit(h.view,'blur');assert.equal(h.api.isDragging(),false);assert.equal(h.frames.size,0);assert.deepEqual(h.drops,[]);assert.deepEqual(h.ids(),['a','b','c']);
  h.touch('touchstart');h.hold();h.document.visibilityState='hidden';h.emit(h.document,'visibilitychange');assert.equal(h.api.isDragging(),false);assert.equal(h.frames.size,0);
  h.document.visibilityState='visible';h.touch('touchstart');h.hold();h.emit(h.view,'resize');assert.equal(h.api.isDragging(),false);assert.equal(h.frames.size,0);assert.deepEqual(h.ids(),['a','b','c']);
});
test('Mouse/pen holds use the same ordering, and destroying the editor cancels pending work and removes listeners',()=>{
  const h=harness();h.emit(h.root,'pointerdown',{clientX:100,clientY:150});h.hold();h.emit(h.document,'pointermove',{clientX:100,clientY:620});h.emit(h.document,'pointerup');
  assert.deepEqual(h.ids(),['b','c','a']);assert.deepEqual(h.drops,[['a',null]]);
  h.emit(h.root,'pointerdown',{pointerType:'pen',clientX:100,clientY:150});assert.equal(h.timers.size,1);h.api.destroy();h.hold();
  assert.equal(h.api.isDragging(),false);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
  for(const node of [h.root,h.document,h.view])assert.equal([...node.listeners.values()].flat().length,0);
});
