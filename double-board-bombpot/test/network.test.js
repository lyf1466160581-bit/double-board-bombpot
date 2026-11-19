'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {server}=require('../server');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=5000){const start=Date.now();while(Date.now()-start<ms){const val=fn();if(val)return val;await pause(15);}throw new Error('Timed out waiting for websocket state');}
function connect(base,credentials){
  const socket=new WebSocket(`${base.replace('http','ws')}/ws?room=${credentials.code}&token=${credentials.token}`);
  const messages=[];
  socket.addEventListener('message',e=>{messages.push(JSON.parse(e.data));});
  return {socket,messages,latest:()=>messages.filter(m=>m.type==='state').at(-1)?.data};
}
test('two real WebSocket clients create, join, synchronize turns and finish a game',async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const clients=[];
  try{
    const index=await fetch(base+'/');
    assert.equal(index.status,200);
    assert.match(await index.text(),/DUAL BOARD/);
    async function api(route,body){const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
    const one=await api('create',{name:'澳洲玩家',mode:'holdem'});
    const two=await api('join',{name:'中国玩家',code:one.code});
    clients.push(connect(base,one),connect(base,two));
    await until(()=>clients.every(c=>c.latest()?.players.every(p=>p.connected)));
    let states=clients.map(c=>c.latest());
    assert.equal(states[0].hand.pot,40);
    assert.equal(states[1].hand.pot,40);
    assert.equal(states[0].hand.opponentCards.length,0);
    assert.equal(states[1].hand.opponentCards.length,0);
    assert.notDeepEqual(states[0].hand.ownCards,states[1].hand.ownCards);
    for(let j=0;j<6;j++){
      states=clients.map(c=>c.latest());
      const seat=states[0].hand.turn;
      const phase=states[0].hand.phase;
      const num=clients[seat].messages.length;
      clients[seat].socket.send(JSON.stringify({type:'action',action:'check'}));
      await until(()=>clients[seat].messages.length>num);
      if(phase==='complete')break;
    }
    await until(()=>clients.every(c=>c.latest()?.hand.phase==='complete'));
    states=clients.map(c=>c.latest());
    assert.equal(states[0].hand.result.type,'showdown');
    assert.equal(states[1].hand.opponentCards.length,2);
    assert.equal(states[0].players[0].stack+states[0].players[1].stack,2000);
    for(let seat=0;seat<2;seat++)clients[seat].socket.send(JSON.stringify({type:'ready'}));
    await until(()=>clients.every(c=>c.latest()?.handNumber===2));
    assert.equal(clients[0].latest().hand.pot,40);
    assert.equal(clients[1].latest().hand.phase,'flop');
  }finally{
    clients.forEach(c=>c.socket.close());
    await pause(80);
    await new Promise(resolve=>server.close(resolve));
  }
});
