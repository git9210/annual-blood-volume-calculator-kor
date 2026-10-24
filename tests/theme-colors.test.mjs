import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../assets/style.css',import.meta.url),'utf8');
const rgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16));
const luminance=channels=>channels.map(v=>v/255).reduce((sum,v,i)=>sum+[.2126,.7152,.0722][i]*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4),0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

for(const theme of ['blood','pastel'])test(`${theme}: body, controls and every calendar status token retain at least 4.5:1 text contrast`,()=>{
  const block=css.match(new RegExp(`\\[data-theme=${theme}\\]\\{([^}]+)\\}`))[1];
  const colors=Object.fromEntries([...block.matchAll(/--([\w-]+):(#\w{6})/g)].map(m=>[m[1],m[2]]));
  const pairs=[['ink','bg'],['ink','paper'],['muted','bg'],['muted','paper'],['muted','surface'],['green','paper'],['green','green-soft'],
    ['on-primary','primary'],['can-ink','can'],['cannot-ink','cannot'],['past-ink','past'],['holiday-ink','holiday'],
    ['plan-ink','plan'],['restriction-ink','restriction'],['warning-ink','warning'],['error-ink','error']];
  for(const [foreground,background] of pairs){
    const score=contrast(rgb(colors[foreground]),rgb(colors[background]));
    assert.ok(score>=4.5,`${foreground}/${background}: ${score.toFixed(2)}`);
  }
  for(const name of ['record-strong','can-ink','cannot-ink','past-ink','restriction-ink']){
    assert.ok(contrast(rgb(colors[name]),[255,255,255])>=4.5,`white status marks on ${name}`);
  }
});
test('All pastel balance gradients keep dark text readable at endpoints and interpolated colors',()=>{
  const gradients=[...css.matchAll(/\[data-theme=pastel\] \.balance-card[^{]*\{[^}]*linear-gradient\(115deg,(#\w{6}),(#\w{6})\)/g)];
  assert.equal(gradients.length,6);
  for(const match of gradients){
    const start=rgb(match[1]),end=rgb(match[2]);
    for(let i=0;i<=100;i++){
      const background=start.map((v,k)=>v+(end[k]-v)*i/100);
      assert.ok(contrast(rgb('#40384f'),background)>=4.5,`gradient ${match[1]} → ${match[2]}, step ${i}`);
    }
  }
});
