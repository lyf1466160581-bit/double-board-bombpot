'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {rankFive,bestHand,createRoom,joinRoom,startHand,performAction,readyNext,snapshot}=require('../game');
function setup(mode='holdem'){const r=createRoom('ABC123','Alice',mode);joinRoom(r,'Bob');return r;}
function checkBoth(r){let i=r.hand.turn;performAction(r,i,'check');performAction(r,r.hand.turn,'check');}
test('5-card evaluator handles wheel straight, straight flush, and full house',()=>{
  assert.deepEqual(rankFive(['As','2h','3d','4c','5h']),[4,5]);
  assert.deepEqual(rankFive(['As','2s','3s','4s','5s']),[8,5]);
  assert.deepEqual(rankFive(['Qh','Qs','Qc','9c','9s']),[6,12,9]);
  assert.deepEqual(rankFive(['Ah','Ad','2h','2d','5c']),[2,14,2,5]);
  assert.deepEqual(rankFive(['Ac','Ad','Ah','As','Kd']),[7,14,13]);
});
test('Omaha requires exactly 2 private and 3 community cards',()=>{
  const board=['9s','Ts','Js','Qs','Ks'];
  const omaha=bestHand(['2h','3h','4d','5c'],board,'omaha');
  assert.notEqual(omaha.rank[0],8);
  const holdem=bestHand(['2h','3h'],board,'holdem');
  assert.equal(holdem.rank[0],8);
});
test('one room has exactly 2 players, unique cards, and private cards are hidden',()=>{
  const r=setup('omaha');
  const h=r.hand;
  assert.equal(h.phase,'flop');
  assert.equal(h.pot,40);
  assert.equal(h.hole[0].length,4);
  assert.equal(new Set([...h.hole.flat(),...h.fullBoards.flat()]).size,18);
  assert.equal(snapshot(r,0).hand.opponentCards.length,0);
  assert.equal(snapshot(r,0).hand.ownCards.length,4);
  assert.equal(snapshot(r,0).hand.boards[0].length,3);
  assert.throws(()=>joinRoom(r,'Eve'),/满员/);
});
test('two players can check, bet, call and showdown, then ready next hand',()=>{
  const r=setup();
  checkBoth(r);
  assert.equal(r.hand.phase,'turn');
  const actor=r.hand.turn;
  performAction(r,actor,'bet',80);
  assert.equal(r.hand.pot,120);
  assert.equal(r.hand.currentBet,80);
  assert.throws(()=>performAction(r,actor,'check'),/不是你的操作/);
  performAction(r,r.hand.turn,'call');
  assert.equal(r.hand.phase,'river');
  assert.equal(r.hand.pot,200);
  checkBoth(r);
  assert.equal(r.hand.phase,'complete');
  assert.equal(r.hand.result.type,'showdown');
  assert.equal(r.players[0].stack+r.players[1].stack,2000);
  assert.equal(snapshot(r,0).hand.opponentCards.length,2);
  readyNext(r,0);
  assert.equal(r.handNumber,1);
  readyNext(r,1);
  assert.equal(r.handNumber,2);
  assert.equal(r.hand.pot,40);
});
test('fold awards whole pot, without disclosing cards',()=>{
  const r=setup();
  performAction(r,r.hand.turn,'fold');
  assert.equal(r.hand.phase,'complete');
  assert.equal(r.hand.result.type,'fold');
  assert.equal(r.players[0].stack+r.players[1].stack,2000);
  assert.equal(snapshot(r,0).hand.opponentCards.length,0);
  assert.equal(snapshot(r,0).hand.boards[0].length,3);
});
test('effective all-in is capped by opponent stack and runs out both boards',()=>{
  const r=setup();
  r.players[0].stack=200;
  r.players[1].stack=800;
  startHand(r);
  const i=r.hand.turn;
  assert.equal(i,0);
  performAction(r,i,'allin');
  assert.equal(r.hand.currentBet,180);
  performAction(r,r.hand.turn,'call');
  assert.equal(r.hand.phase,'complete');
  assert.equal(r.hand.revealCount,5);
  assert.equal(r.players[0].stack+r.players[1].stack,1000);
});
test('short non-all-in raises and invalid amounts are rejected',()=>{
  const r=setup();
  assert.throws(()=>performAction(r,r.hand.turn,'bet',10),/最小下注/);
  assert.throws(()=>performAction(r,r.hand.turn,'bet',1.5),/下注总额/);
  assert.throws(()=>performAction(r,r.hand.turn,'bet',10000),/下注总额/);
  const i=r.hand.turn;
  performAction(r,i,'bet',40);
  assert.throws(()=>performAction(r,r.hand.turn,'bet',60),/最小下注/);
  performAction(r,r.hand.turn,'bet',80);
  performAction(r,r.hand.turn,'call');
  assert.equal(r.hand.phase,'turn');
});
