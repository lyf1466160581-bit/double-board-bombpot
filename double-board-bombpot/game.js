'use strict';
const { randomInt, randomBytes } = require('node:crypto');

const STARTING_STACK = 1000;
const MIN_BET = 20;
const SUITS = ['s', 'h', 'd', 'c'];
const RANKS = '23456789TJQKA';
const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

function newToken() { return randomBytes(24).toString('hex'); }
function shuffledDeck() {
  const cards = SUITS.flatMap(s => [...RANKS].map(r => r + s));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function combinations(cards, n) {
  const out = [];
  function step(index, subset) {
    if (subset.length === n) { out.push(subset.slice()); return; }
    for (let i = index; i <= cards.length - (n - subset.length); i++) {
      subset.push(cards[i]); step(i + 1, subset); subset.pop();
    }
  }
  step(0, []);
  return out;
}
function cmpRanks(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = (a[i] ?? 0) - (b[i] ?? 0);
    if (x) return Math.sign(x);
  }
  return 0;
}
function straightHigh(values) {
  const nums = [...new Set(values)].sort((a, b) => b - a);
  if (nums.includes(14)) nums.push(1);
  for (let i = 0; i <= nums.length - 5; i++) {
    if (nums[i] - nums[i + 4] === 4) return nums[i];
  }
  return 0;
}
function rankFive(cards) {
  if (cards.length !== 5) throw new Error('Must evaluate exactly five cards');
  const vals = cards.map(c => RANKS.indexOf(c[0]) + 2);
  const byValue = new Map();
  for (const v of vals) byValue.set(v, (byValue.get(v) || 0) + 1);
  const groups = [...byValue].map(([v, count]) => ({v, count}))
    .sort((a, b) => b.count - a.count || b.v - a.v);
  const flush = cards.every(c => c[1] === cards[0][1]);
  const straight = straightHigh(vals);
  const sorted = vals.slice().sort((a, b) => b - a);
  if (flush && straight) return [8, straight];
  if (groups[0].count === 4) return [7, groups[0].v, groups[1].v];
  if (groups[0].count === 3 && groups[1].count === 2) return [6, groups[0].v, groups[1].v];
  if (flush) return [5, ...sorted];
  if (straight) return [4, straight];
  if (groups[0].count === 3) return [3, groups[0].v, ...groups.slice(1).map(g => g.v).sort((a,b) => b-a)];
  if (groups[0].count === 2 && groups[1].count === 2) {
    return [2, Math.max(groups[0].v,groups[1].v), Math.min(groups[0].v,groups[1].v),groups[2].v];
  }
  if (groups[0].count === 2) return [1, groups[0].v, ...groups.slice(1).map(g => g.v).sort((a,b) => b-a)];
  return [0, ...sorted];
}
function bestHand(hole, board, mode) {
  const hands = mode === 'omaha'
    ? combinations(hole, 2).flatMap(h => combinations(board, 3).map(b => h.concat(b)))
    : combinations(hole.concat(board), 5);
  if (!hands.length) throw new Error('Not enough cards');
  let best = null;
  for (const cards of hands) {
    const rank = rankFive(cards);
    if (!best || cmpRanks(rank, best.rank) > 0) best = { rank, cards };
  }
  return { ...best, name: HAND_NAMES[best.rank[0]] };
}
function createRoom(code, name, mode='holdem') {
  if (!['holdem','omaha'].includes(mode)) throw new Error('Invalid mode');
  return {
    code, mode, ante:20, dealer:-1, handNumber:0,
    players:[{ token:newToken(), name, stack:STARTING_STACK, ready:false, connected:false, socket:null }],
    hand:null, lastActive:Date.now()
  };
}
function joinRoom(room, name) {
  if (room.players.length >= 2) throw new Error('房间已经满员（只支持两个人）。');
  const player = { token:newToken(), name, stack:STARTING_STACK, ready:false, connected:false, socket:null };
  room.players.push(player);
  startHand(room);
  return player;
}
function putChips(room, index, amount) {
  const p=room.players[index], h=room.hand;
  if (!Number.isSafeInteger(amount) || amount<0 || amount>p.stack) throw new Error('筹码数无效');
  p.stack -= amount;
  h.pot += amount;
  h.streetBets[index] += amount;
}
function log(room, s) {
  room.hand.log.unshift(s);
  if (room.hand.log.length>12) room.hand.log.pop();
}
function startHand(room) {
  if (room.players.length!==2) throw new Error('需要两名玩家');
  if (room.players.some(p => p.stack === 0)) {
    room.players.forEach(p => p.stack=STARTING_STACK);
  }
  const deck=shuffledDeck(), holeCount=room.mode==='omaha'?4:2;
  const hole=[[],[]];
  for (let j=0; j<holeCount; j++) for(let i=0;i<2;i++) hole[i].push(deck.pop());
  const fullBoards=[Array.from({length:5},()=>deck.pop()),Array.from({length:5},()=>deck.pop())];
  room.dealer=(room.dealer+1)%2;
  room.handNumber++;
  room.players.forEach(p=>p.ready=false);
  room.hand = {
    phase:'flop', hole, fullBoards, pot:0, streetBets:[0,0], currentBet:0,
    minRaise:MIN_BET, acted:[false,false], turn:(room.dealer+1)%2,
    result:null, revealCount:3, log:[]
  };
  const ante=Math.min(room.ante,room.players[0].stack,room.players[1].stack);
  for(let i=0;i<2;i++) putChips(room,i,ante);
  room.hand.streetBets=[0,0];
  log(room,`第 ${room.handNumber} 局 · 双牌面 · 每人投入 ${ante} 筹码`);
  if (room.players.some(p=>p.stack===0)) showdown(room);
}
function showdown(room) {
  const h=room.hand;
  if(h.phase==='complete') return;
  h.phase='complete'; h.revealCount=5;
  const firstPot=Math.ceil(h.pot/2), secondPot=h.pot-firstPot;
  const payouts=[0,0]; const boards=[];
  [firstPot,secondPot].forEach((amount,k)=>{
    const b0=bestHand(h.hole[0],h.fullBoards[k],room.mode);
    const b1=bestHand(h.hole[1],h.fullBoards[k],room.mode);
    const cmp=cmpRanks(b0.rank,b1.rank);
    const winners=cmp===0?[0,1]:[cmp>0?0:1];
    if (winners.length===1) payouts[winners[0]]+=amount;
    else {payouts[0]+=Math.ceil(amount/2);payouts[1]+=Math.floor(amount/2);}
    boards.push({board:k,amount,winners,names:[b0.name,b1.name]});
  });
  room.players.forEach((p,i)=>p.stack+=payouts[i]);
  const winnerText=boards.map(b=>`${b.board===0?'上':'下'}牌面：${b.winners.length===2?'平局':room.players[b.winners[0]].name+' 获胜'}`).join(' · ');
  log(room,`摊牌！${winnerText}`);
  h.result={type:'showdown',boards,payouts,summary:winnerText};
  h.turn=null;
}
function nextStreet(room) {
  const h=room.hand;
  if (room.players.some(p=>p.stack===0) || h.phase==='river') return showdown(room);
  h.phase=h.phase==='flop'?'turn':'river';
  h.revealCount=h.phase==='turn'?4:5;
  h.streetBets=[0,0];h.currentBet=0;h.minRaise=MIN_BET;h.acted=[false,false];
  h.turn=(room.dealer+1)%2;
  log(room,h.phase==='turn'?'两组转牌已发出':'两组河牌已发出');
}
function legalActions(room, seat) {
  const h=room.hand;
  if(!h || h.phase==='complete' || h.turn!==seat) return {isTurn:false};
  const p=room.players[seat], o=room.players[1-seat];
  const toCall=h.currentBet-h.streetBets[seat];
  const maxTarget=Math.min(h.streetBets[seat]+p.stack,h.streetBets[1-seat]+o.stack);
  const minTarget=h.currentBet===0?MIN_BET:h.currentBet+h.minRaise;
  return {
    isTurn:true,toCall,maxTarget,minTarget,
    canCheck:toCall===0,canCall:toCall>0,canFold:true,
    canBet:maxTarget>h.currentBet,canAllIn:maxTarget>h.streetBets[seat],
    currentBet:h.currentBet
  };
}
function performAction(room,seat,action,target) {
  const h=room.hand, p=room.players[seat];
  if(!h || h.phase==='complete' || h.turn!==seat) throw new Error('现在不是你的操作回合');
  const legal=legalActions(room,seat);
  const other=1-seat;
  if (action==='fold') {
    const amount=h.pot;
    room.players[other].stack+=amount;
    h.result={type:'fold',winner:other,amount,summary:`${p.name} 弃牌，${room.players[other].name} 赢得 ${amount} 筹码`};
    h.phase='complete';h.turn=null;
    log(room,h.result.summary);
    return;
  }
  if (action==='check') {
    if(!legal.canCheck) throw new Error('必须跟注或弃牌');
    h.acted[seat]=true;
    log(room,`${p.name} 让牌`);
  } else if(action==='call') {
    if(!legal.canCall) throw new Error('当前不需要跟注');
    putChips(room,seat,legal.toCall);
    h.acted[seat]=true;
    log(room,`${p.name} 跟注 ${legal.toCall}`);
  } else if(action==='bet'||action==='allin') {
    const n=action==='allin'?legal.maxTarget:Number(target);
    if(!Number.isSafeInteger(n)||n<=h.currentBet||n>legal.maxTarget)
      throw new Error(`下注总额必须大于 ${h.currentBet} 且不超过 ${legal.maxTarget}`);
    if(n<legal.minTarget && n!==legal.maxTarget)
      throw new Error(`最小下注/加注到 ${legal.minTarget}（有效全下除外）`);
    const old=h.currentBet;
    putChips(room,seat,n-h.streetBets[seat]);
    h.currentBet=n;
    if(n-old>=h.minRaise) h.minRaise=n-old;
    h.acted=[false,false];h.acted[seat]=true;
    log(room,`${p.name} ${old===0?'下注':'加注到'} ${n}${action==='allin'?'（有效全下）':''}`);
  } else throw new Error('未知操作');
  if(h.acted.every(Boolean)) nextStreet(room);
  else h.turn=other;
}
function readyNext(room,seat) {
  if(!room.hand || room.hand.phase!=='complete') throw new Error('本局尚未结束');
  room.players[seat].ready=true;
  if(room.players.length===2 && room.players.every(p=>p.ready)) startHand(room);
}
function snapshot(room, seat) {
  const h=room.hand;
  const info={
    code:room.code,mode:room.mode,ante:room.ante,handNumber:room.handNumber,
    yourSeat:seat,dealer:room.dealer,
    players:room.players.map((p,i)=>({seat:i,name:p.name,stack:p.stack,ready:p.ready,connected:p.connected})),
    hand:null
  };
  if(h) {
    info.hand={phase:h.phase,pot:h.pot,turn:h.turn,currentBet:h.currentBet,
      streetBets:h.streetBets.slice(), boards:h.fullBoards.map(b=>b.slice(0,h.revealCount)),
      ownCards:h.hole[seat].slice(),
      opponentCards:h.result?.type==='showdown'?h.hole[1-seat].slice():[],
      result:h.result,log:h.log.slice(),legal:legalActions(room,seat)};
  }
  return info;
}
module.exports={STARTING_STACK,MIN_BET,newToken,shuffledDeck,rankFive,bestHand,cmpRanks,createRoom,joinRoom,startHand,performAction,readyNext,snapshot};
