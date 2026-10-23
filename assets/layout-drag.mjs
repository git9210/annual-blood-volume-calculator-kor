// No animation or timer runs while idle. Touch scrolling stays native before a hold.
export function installLayoutDrag(root,{onDrop,onActive=()=>{},onMessage=()=>{},view,document,
  setTimer=setTimeout,clearTimer=clearTimeout,requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}){
  let pending=null,active=null,hold=null,frame=null,suppressUntil=0;
  const listeners=[];
  const listen=(node,name,fn,options)=>{node.addEventListener(name,fn,options);listeners.push([node,name,fn,options]);};
  const cards=()=>[...root.querySelectorAll('[data-layout-id]')];
  const clearHold=()=>{if(hold!==null)clearTimer(hold);hold=null;pending=null;};
  const stopFrame=()=>{if(frame!==null)cancelFrame(frame);frame=null;};
  function finish(commit){
    clearHold();stopFrame();const drag=active;active=null;if(!drag)return;
    const before=drag.placeholder.nextElementSibling;
    // The lifted card is still in the same parent until it is dropped.
    const target=before===drag.card?drag.card.nextElementSibling:before;
    const beforeId=target?.dataset.layoutId||null;
    if(commit)drag.parent.insertBefore(drag.card,drag.placeholder);
    drag.placeholder.remove();drag.card.classList.remove('layout-dragging');
    if(drag.style===null)drag.card.removeAttribute('style');else drag.card.setAttribute('style',drag.style);
    suppressUntil=Date.now()+400;onActive(false);
    if(commit)onDrop(drag.id,beforeId);
    else onMessage('항목 이동을 취소했습니다.');
  }
  function place(y){
    if(!active)return;
    const drag=active,others=cards().filter(card=>card!==drag.card);
    const target=others.find(card=>{const r=card.getBoundingClientRect();return y<r.top+r.height/2;});
    if(target)drag.parent.insertBefore(drag.placeholder,target);
    else drag.parent.appendChild(drag.placeholder);
    drag.card.style.top=(y-drag.offset)+'px';
  }
  function scrollFrame(){
    frame=null;if(!active)return;
    const y=active.y,top=84,bottom=view.innerHeight-100;
    const speed=y<top?-Math.min(14,(top-y)/4):y>bottom?Math.min(14,(y-bottom)/4):0;
    if(speed){view.scrollBy({top:speed,left:0,behavior:'auto'});place(y);}
    frame=requestFrame(scrollFrame);
  }
  function lift(){
    hold=null;if(!pending)return;
    const point=pending;pending=null;
    if(!root.contains(point.card)||document.visibilityState==='hidden')return;
    const card=point.card,r=card.getBoundingClientRect(),placeholder=document.createElement('div');
    placeholder.className='layout-placeholder';placeholder.style.height=r.height+'px';placeholder.setAttribute('aria-hidden','true');
    const parent=card.parentNode;parent.insertBefore(placeholder,card);
    active={...point,id:card.dataset.layoutId,parent,placeholder,offset:point.y-r.top,style:card.getAttribute('style')};
    card.classList.add('layout-dragging');
    Object.assign(card.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',margin:'0',zIndex:'60',pointerEvents:'none'});
    onActive(true);onMessage((card.dataset.layoutLabel||'항목')+' 이동 중입니다. 위아래로 옮긴 뒤 손을 떼세요.');
    frame=requestFrame(scrollFrame);
  }
  function start(event,point,kind){
    finish(false);clearHold();suppressUntil=0;
    const card=event.target.closest?.('[data-layout-id]');if(!card||!root.contains(card))return;
    if(event.target.closest?.('button,a,input,select,textarea')&&!event.target.closest?.('[data-widget-preview]'))return;
    pending={card,x:point.clientX,y:point.clientY,key:point.identifier??event.pointerId,kind};
    hold=setTimer(lift,450);
  }
  function move(event,point,kind){
    const drag=active||pending;if(!drag||drag.kind!==kind)return;
    const key=point.identifier??event.pointerId;if(key!==drag.key)return;
    if(active){
      if(kind==='touch'&&event.cancelable===false){finish(false);return;}
      event.preventDefault();active.y=point.clientY;place(point.clientY);
    }
    else if(Math.abs(point.clientX-pending.x)>10||Math.abs(point.clientY-pending.y)>10)clearHold();
  }
  listen(root,'touchstart',event=>{
    if(event.touches.length!==1){finish(false);clearHold();return;}
    start(event,event.touches[0],'touch');
  },{passive:true});
  listen(root,'touchmove',event=>{
    if(event.touches.length!==1){finish(false);clearHold();return;}
    move(event,event.touches[0],'touch');
  },{passive:false});
  listen(root,'touchend',event=>{
    const drag=active||pending;if(!drag||drag.kind!=='touch')return;
    if(![...event.changedTouches].some(point=>point.identifier===drag.key))return;
    if(active)event.preventDefault();finish(true);clearHold();
  },{passive:false});
  listen(root,'touchcancel',()=>{finish(false);clearHold();},{passive:true});
  listen(root,'pointerdown',event=>{
    if(!['mouse','pen'].includes(event.pointerType)||event.button!==0||event.isPrimary===false)return;
    start(event,event,'pointer');
  });
  listen(document,'pointermove',event=>move(event,event,'pointer'),{passive:false});
  listen(document,'pointerup',event=>{
    const drag=active||pending;if(drag?.kind!=='pointer'||drag.key!==event.pointerId)return;
    if(active)event.preventDefault();finish(true);clearHold();
  });
  listen(document,'pointercancel',()=>{finish(false);clearHold();});
  listen(root,'contextmenu',event=>event.preventDefault());
  listen(root,'click',event=>{if(event.detail!==0&&Date.now()<=suppressUntil){suppressUntil=0;event.preventDefault();event.stopPropagation();}},true);
  listen(view,'blur',()=>{finish(false);clearHold();});
  listen(view,'resize',()=>{finish(false);clearHold();});
  listen(view,'scroll',()=>{if(pending)clearHold();},{passive:true});
  listen(document,'visibilitychange',()=>{if(document.visibilityState==='hidden'){finish(false);clearHold();}});
  return {cancel:()=>{finish(false);clearHold();},isDragging:()=>!!active,destroy(){finish(false);clearHold();for(const args of listeners)args[0].removeEventListener(args[1],args[2],args[3]);}};
}
