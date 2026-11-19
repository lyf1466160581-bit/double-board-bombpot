'use strict';
// Dependency-free Node.js 20+ real-time poker server; HTTPS/WSS via your host's proxy.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRoom,joinRoom,performAction,readyNext,snapshot}=require('./game');

const rooms=new Map();
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PUBLIC=path.join(__dirname,'public');
const ASSETS={
  '/':['index.html','text/html; charset=utf-8'],
  '/index.html':['index.html','text/html; charset=utf-8'],
  '/style.css':['style.css','text/css; charset=utf-8'],
  '/app.js':['app.js','text/javascript; charset=utf-8']
};
function roomCode(){let code;do{code=Array.from({length:6},()=>ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');}while(rooms.has(code));return code;}
function playerName(v){if(typeof v!=='string')throw new Error('请输入昵称');const s=v.trim();if(s.length<1||s.length>16)throw new Error('昵称需要 1–16 个字符');return s;}
function findPlayer(room,token){return room?.players.findIndex(p=>p.token===token)??-1;}
function respond(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
function send(socket,data){if(socket?.open)socket.send(JSON.stringify(data));}
function broadcast(room){room.lastActive=Date.now();room.players.forEach((p,i)=>send(p.socket,{type:'state',data:snapshot(room,i)}));}
async function readJSON(req){
  let total=0;const chunks=[];
  for await(const chunk of req){total+=chunk.length;if(total>4096)throw new Error('请求体过大');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('无效请求内容');}
}
const server=http.createServer(async(req,res)=>{
  // Static assets have no external dependencies, including fonts.
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  let pathname;
  try{pathname=new URL(req.url,'http://localhost').pathname;}catch{return respond(res,400,{error:'Invalid URL'});}
  if(req.method==='GET'&&pathname==='/api/health')return respond(res,200,{ok:true});
  if(req.method==='GET'&&ASSETS[pathname]){
    const [file,type]=ASSETS[pathname];
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});
    fs.createReadStream(path.join(PUBLIC,file)).pipe(res);
    return;
  }
  if(req.method==='POST'&&pathname==='/api/create'){
    try{
      const body=await readJSON(req),name=playerName(body?.name);
      if(rooms.size>=10000)throw new Error('服务器房间已满');
      const mode=body.mode==='omaha'?'omaha':'holdem';
      const code=roomCode(),room=createRoom(code,name,mode);
      rooms.set(code,room);
      return respond(res,200,{code,token:room.players[0].token,seat:0});
    }catch(e){return respond(res,400,{error:e.message});}
  }
  if(req.method==='POST'&&pathname==='/api/join'){
    try{
      const body=await readJSON(req),code=String(body?.code||'').toUpperCase().trim();
      const room=rooms.get(code);
      if(!room)return respond(res,404,{error:'找不到这个房间，请检查房间号'});
      const player=joinRoom(room,playerName(body?.name));
      respond(res,200,{code,token:player.token,seat:1});
      broadcast(room);
      return;
    }catch(e){return respond(res,400,{error:e.message});}
  }
  return respond(res,404,{error:'Not found'});
});

function frame(opcode,payload=Buffer.alloc(0)){
  if(!Buffer.isBuffer(payload))payload=Buffer.from(payload);
  const len=payload.length;
  const head=Buffer.allocUnsafe(len<126?2:len<=65535?4:10);
  head[0]=0x80|opcode;
  if(len<126)head[1]=len;
  else if(len<=65535){head[1]=126;head.writeUInt16BE(len,2);}
  else{head[1]=127;head.writeBigUInt64BE(BigInt(len),2);}
  return Buffer.concat([head,payload]);
}
class SocketPeer {
  constructor(socket){
    this.socket=socket;this.open=true;this.buffer=Buffer.alloc(0);this.fragment=null;this.fragmentSize=0;
    this.onMessage=()=>{};this.onClose=()=>{};this.alive=true;
    socket.setKeepAlive(true,30000);
    socket.on('data',chunk=>this.receive(chunk));
    socket.on('end',()=>this.closed());
    socket.on('close',()=>this.closed());
    socket.on('error',()=>this.closed());
    this.heartbeat=setInterval(()=>{
      if(!this.open)return;
      if(!this.alive)return this.close();
      this.alive=false;this.sendFrame(0x9);
    },25000);
    this.heartbeat.unref();
  }
  sendFrame(op,payload){if(this.open&&!this.socket.destroyed)this.socket.write(frame(op,payload));}
  send(text){this.sendFrame(0x1,Buffer.from(text,'utf8'));}
  close(){if(!this.open)return;this.sendFrame(0x8);this.socket.end();this.closed();}
  closed(){if(!this.open)return;this.open=false;clearInterval(this.heartbeat);this.onClose();}
  receive(chunk){
    if(!this.open)return;
    this.buffer=Buffer.concat([this.buffer,chunk]);
    if(this.buffer.length>16000)return this.close();
    while(this.buffer.length>=2){
      const a=this.buffer[0],b=this.buffer[1],opcode=a&15,fin=Boolean(a&0x80),masked=Boolean(b&0x80);
      let len=b&127,offset=2;
      if(!masked || (a&0x70)!==0)return this.close();
      if(len===126){if(this.buffer.length<4)return;len=this.buffer.readUInt16BE(2);offset=4;}
      else if(len===127){if(this.buffer.length<10)return;const large=this.buffer.readBigUInt64BE(2);if(large>4096n)return this.close();len=Number(large);offset=10;}
      if(len>4096||this.buffer.length<offset+4+len){if(len>4096)return this.close();return;}
      const mask=this.buffer.subarray(offset,offset+4);offset+=4;
      const payload=Buffer.from(this.buffer.subarray(offset,offset+len));
      for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
      this.buffer=this.buffer.subarray(offset+len);
      if(opcode===0x8)return this.close();
      if(opcode===0x9){this.sendFrame(0xA,payload);continue;}
      if(opcode===0xA){this.alive=true;continue;}
      if(opcode===0x1){
        if(this.fragment)return this.close();
        if(fin)this.onMessage(payload.toString('utf8'));
        else{this.fragment=[payload];this.fragmentSize=len;}
      }else if(opcode===0x0&&this.fragment){
        this.fragment.push(payload);this.fragmentSize+=len;
        if(this.fragmentSize>4096)return this.close();
        if(fin){const text=Buffer.concat(this.fragment).toString('utf8');this.fragment=null;this.fragmentSize=0;this.onMessage(text);}
      }else return this.close();
      if(!this.open)return;
    }
  }
}
server.on('upgrade',(req,socket,head)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const code=(url.searchParams.get('room')||'').toUpperCase();
    const token=url.searchParams.get('token')||'';
    const room=rooms.get(code);
    const key=req.headers['sec-websocket-key'];
    if(url.pathname!=='/ws'||!room||findPlayer(room,token)<0||typeof key!=='string'||req.headers['sec-websocket-version']!=='13'){
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;
    }
    const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    const peer=new SocketPeer(socket),seat=findPlayer(room,token),p=room.players[seat];
    if(p.socket&&p.socket!==peer)p.socket.close();
    p.socket=peer;p.connected=true;
    peer.onMessage=raw=>{
      let msg;
      try{msg=JSON.parse(raw);}catch{send(peer,{type:'error',message:'无效消息'});return;}
      if(p.socket!==peer)return;
      try{
        if(msg.type==='action')performAction(room,seat,msg.action,msg.target);
        else if(msg.type==='ready')readyNext(room,seat);
        else throw new Error('未知操作');
        broadcast(room);
      }catch(e){send(peer,{type:'error',message:e.message});}
    };
    peer.onClose=()=>{if(p.socket===peer){p.socket=null;p.connected=false;broadcast(room);}};
    if(head?.length)peer.receive(head);
    broadcast(room);
  }catch{socket.destroy();}
});
const cleanup=setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of rooms)if(now-room.lastActive>12*60*60*1000&&room.players.every(p=>!p.connected))rooms.delete(code);
},60*60*1000);
cleanup.unref();
const port=Number(process.env.PORT)||3000;
if(require.main===module)server.listen(port,'0.0.0.0',()=>console.log(`Bomb Pot ready on http://localhost:${port}`));
module.exports={server,rooms,SocketPeer};
