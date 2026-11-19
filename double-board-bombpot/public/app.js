(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const S={session:null,game:null,ws:null,reconnectTimer:null,reconnectDelay:700,tab:'create',busy:false};
  const fmt=n=>Number(n||0).toLocaleString('en-US');
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const suitSymbol={s:'♠',h:'♥',d:'♦',c:'♣'};
  const suitColor=s=>s==='h'||s==='d'?'red':'';
  let toastTimer;
  function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000);}
  function connection(label,connected){$('connection-label').textContent=label;document.querySelector('.dot').style.background=connected?'#76e2aa':'#cba56f';}
  function tab(which){S.tab=which;$('tab-create').classList.toggle('active',which==='create');$('tab-join').classList.toggle('active',which==='join');$('create-fields').hidden=which!=='create';$('join-fields').hidden=which!=='join';$('entry-submit').innerHTML=which==='create'?'创建私人房间 <span>→</span>':'加入好友牌桌 <span>→</span>';$('entry-error').textContent='';}
  async function post(route,body){
    const res=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let data;try{data=await res.json();}catch{throw new Error('服务器暂时不可用');}
    if(!res.ok)throw new Error(data.error||'操作失败');return data;
  }
  function showGame(){ $('home').hidden=true;$('game').hidden=false;}
  function showHome(){ $('home').hidden=false;$('game').hidden=true;connection('娱乐筹码 · 无真钱',true);}
  function attachSession(session){
    clearTimeout(S.reconnectTimer);
    if(S.ws){const old=S.ws;S.ws=null;old.close();}
    S.session=session;localStorage.setItem('bombpot-session',JSON.stringify(session));
    showGame();$('room-code').textContent=session.code;
    const u=new URL(location.href);u.searchParams.set('room',session.code);history.replaceState(null,'',u);
    connect();
  }
  function connect(){
    if(!S.session)return;
    const {code,token}=S.session;
    connection('连接服务器中…',false);
    const proto=location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(`${proto}//${location.host}/ws?room=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
    S.ws=ws;
    ws.onopen=()=>{S.reconnectDelay=700;connection('已连接 · 实时同步',true);};
    ws.onmessage=e=>{
      try{const msg=JSON.parse(e.data);if(msg.type==='state'){S.game=msg.data;S.busy=false;render();}else if(msg.type==='error'){S.busy=false;toast(msg.message);renderActions();}}
      catch(err){console.error('Bad message',err);}
    };
    ws.onclose=()=>{
      if(S.ws!==ws||!S.session)return;
      connection('连接断开 · 正在重连',false);
      S.busy=false;
      S.reconnectTimer=setTimeout(connect,S.reconnectDelay);
      S.reconnectDelay=Math.min(S.reconnectDelay*1.65,8000);
    };
    ws.onerror=()=>{};
  }
  function send(type,extras={}){
    if(!S.ws||S.ws.readyState!==WebSocket.OPEN){toast('连接断开，请等待重连');return;}
    if(S.busy)return;
    S.busy=true;
    S.ws.send(JSON.stringify({type,...extras}));
    renderActions();
  }
  function cardsMarkup(cards,count,small=false){
    let html='';
    for(let i=0;i<count;i++){
      const code=cards[i];
      if(code){const rank=code[0]==='T'?'10':code[0];html+=`<div class="playing-card ${small?'small ':''}${suitColor(code[1])}" aria-label="${esc(rank+suitSymbol[code[1]])}"><span class="rank">${esc(rank)}</span><span class="suit">${suitSymbol[code[1]]}</span></div>`;}
      else html+=`<div class="playing-card ${small?'small ':''}${cards===false?'hidden-card':'placeholder'}" aria-hidden="true"></div>`;
    }
    return html;
  }
  function render(){
    const g=S.game;if(!g)return;
    const me=g.players[g.yourSeat],other=g.players[1-g.yourSeat],h=g.hand;
    $('room-code').textContent=g.code;
    $('info-mode').textContent=g.mode==='omaha'?'双牌面奥马哈 (4 张底牌)':'双牌面德州 (2 张底牌)';
    $('round-label').textContent=g.handNumber?`第 ${g.handNumber} 局`:'等待开局';
    $('your-name').textContent=me.name;
    $('your-avatar').textContent=[...me.name][0]||'你';
    $('your-stack').textContent=`${fmt(me.stack)} 筹码`;
    $('opponent-name').textContent=other?other.name:'等待朋友加入...';
    $('opponent-avatar').textContent=other?[...other.name][0]:'?';
    $('opponent-stack').textContent=other?`${fmt(other.stack)} 筹码 · ${other.connected?'在线':'离线'}`:'请分享房间链接';
    $('your-marker').textContent=g.dealer===g.yourSeat?'D':'';
    $('opponent-marker').textContent=g.dealer===1-g.yourSeat?'D':'';
    if(!h){$('street-label').textContent='等待开局';$('turn-status').textContent='邀请第二位玩家';$('action-panel').innerHTML='<div class="waiting"><span class="spinner"></span> 等待朋友加入房间，复制上方邀请链接发送给对方</div>';$('hand-log').innerHTML='<p>等待第二位玩家...</p>';return;}
    const holeCount=g.mode==='omaha'?4:2;
    $('your-hole').innerHTML=cardsMarkup(h.ownCards,holeCount,true);
    $('opponent-hole').innerHTML=h.opponentCards.length?cardsMarkup(h.opponentCards,holeCount,true):cardsMarkup(false,holeCount,true);
    $('board-top').innerHTML=cardsMarkup(h.boards[0],5);
    $('board-bottom').innerHTML=cardsMarkup(h.boards[1],5);
    $('pot-total').textContent=fmt(h.pot);
    $('street-label').textContent=({flop:'翻牌 · FLOP',turn:'转牌 · TURN',river:'河牌 · RIVER',complete:'本局结束 · SHOWDOWN'})[h.phase];
    $('turn-status').textContent=h.phase==='complete'?'已结算':h.turn===g.yourSeat?'轮到你操作':`等待 ${g.players[h.turn]?.name||'对手'} 操作`;
    $('hand-log').innerHTML=h.log.map(x=>`<div class="log-item">${esc(x)}</div>`).join('');
    renderActions();
  }
  function renderActions(){
    const g=S.game,area=$('action-panel');if(!g||!g.hand)return;
    const h=g.hand,me=g.players[g.yourSeat],op=g.players[1-g.yourSeat];
    if(h.phase==='complete'){
      const r=h.result;
      let detail='';
      if(r?.type==='showdown')detail=r.boards.map(b=>`<div class="result-board">${b.board===0?'上':'下'}牌面 · ${fmt(b.amount)} 筹码：<b>${b.winners.length===2?'平分':esc(g.players[b.winners[0]].name)+' 赢'}</b>（${esc(b.names[0])} / ${esc(b.names[1])}）</div>`).join('');
      const ready=me.ready;
      area.innerHTML=`<div class="end-result"><h3>✦ 本局结算</h3><p>${esc(r?.summary||'本局结束')}</p>${detail}<div class="ready-row"><button id="ready-button" class="btn btn-main" style="width:auto;margin:0;gap:20px" ${ready||S.busy?'disabled':''}>${ready?'已准备':'准备下一局'} <span>→</span></button><span>${op?.ready?'对手已准备': '等待双方准备'}${me.stack===0||op?.stack===0?' · 下一局重置双方筹码':''}</span></div></div>`;
      $('ready-button').addEventListener('click',()=>send('ready'));
      return;
    }
    const a=h.legal||{};
    if(!a.isTurn){area.innerHTML=`<div class="waiting"><span class="spinner"></span> ${esc(g.players[h.turn]?.name||'对手')} 正在操作${op?.connected?'':'（对手目前离线）'}</div>`;return;}
    const buttons=[];
    buttons.push('<button class="btn action-btn danger" data-action="fold">弃牌</button>');
    if(a.canCheck)buttons.push('<button class="btn action-btn" data-action="check">让牌</button>');
    if(a.canCall)buttons.push(`<button class="btn action-btn strong" data-action="call">跟注 ${fmt(a.toCall)}</button>`);
    if(a.canBet){
      const minimum=Math.min(a.minTarget,a.maxTarget);
      buttons.push(`<div class="bet-field"><label for="bet-amount">${a.currentBet?'加注到':'下注到'}</label><input class="amount-input" id="bet-amount" inputmode="numeric" type="number" min="${minimum}" max="${a.maxTarget}" value="${minimum}"><button class="btn action-btn strong" data-action="bet">确定</button></div>`);
      buttons.push(`<button class="btn action-btn" data-action="allin">有效全下 ${fmt(a.maxTarget)}</button>`);
    }
    area.innerHTML=buttons.join('')+`<div class="bet-hint">当前街已投入 ${fmt(h.streetBets[g.yourSeat])} · 最高可下注到 ${fmt(a.maxTarget)} · ${a.maxTarget<a.minTarget?'允许有效全下':'最小下注／加注到 '+fmt(a.minTarget)}</div>`;
    area.querySelectorAll('[data-action]').forEach(button=>{
      button.disabled=S.busy;
      button.addEventListener('click',()=>{
        const action=button.dataset.action;
        if(action==='bet'){
          const raw=$('bet-amount').value.trim(),n=Number(raw);
          if(!raw||!Number.isSafeInteger(n)){toast('请输入整数筹码');return;}
          send('action',{action,target:n});
        }else send('action',{action});
      });
    });
  }
  $('tab-create').addEventListener('click',()=>tab('create'));
  $('tab-join').addEventListener('click',()=>tab('join'));
  $('entry-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=$('entry-submit');btn.disabled=true;
    $('entry-error').textContent='';
    try{
      const name=$('nickname').value.trim();
      const data=S.tab==='create'?await post('create',{name,mode:$('mode').value}):await post('join',{name,code:$('room-input').value.trim()});
      localStorage.setItem('bombpot-nickname',name);
      attachSession(data);
    }catch(err){$('entry-error').textContent=err.message;}
    finally{btn.disabled=false;}
  });
  $('copy-link').addEventListener('click',async()=>{
    if(!S.session)return;
    const u=new URL(location.href);u.searchParams.set('room',S.session.code);
    try{await navigator.clipboard.writeText(u.toString());toast('邀请链接已复制，发给朋友即可加入');}
    catch{window.prompt('复制这个邀请链接：',u.toString());}
  });
  $('leave-room').addEventListener('click',()=>{
    clearTimeout(S.reconnectTimer);
    S.session=null;S.game=null;S.busy=false;
    localStorage.removeItem('bombpot-session');
    if(S.ws){const old=S.ws;S.ws=null;old.close();}
    const u=new URL(location.href);u.searchParams.delete('room');history.replaceState(null,'',u);
    showHome();
  });
  const params=new URLSearchParams(location.search),invite=params.get('room');
  $('nickname').value=localStorage.getItem('bombpot-nickname')||'';
  if(invite){$('room-input').value=invite.toUpperCase();tab('join');}
  let saved;try{saved=JSON.parse(localStorage.getItem('bombpot-session'));}catch{}
  if(saved?.code&&saved?.token&&(!invite||saved.code===invite.toUpperCase()))attachSession(saved);
})();
