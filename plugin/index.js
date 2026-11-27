'use strict';
const net=require('net');
const {spawn}=require('child_process');
const path=require('path');
const crypto=require('crypto');
let socket,rx=Buffer.alloc(0);
const port=Number(process.argv[3]), uuid=process.argv[5], registerEvent=process.argv[7];
function send(obj){
 if(!socket||socket.destroyed)return;
 const b=Buffer.from(JSON.stringify(obj)); let h;
 if(b.length<126)h=Buffer.from([0x81,0x80|b.length]);
 else if(b.length<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=0xFE;h.writeUInt16BE(b.length,2);} else return;
 const mask=crypto.randomBytes(4),m=Buffer.from(b);
 for(let i=0;i<m.length;i++)m[i]^=mask[i&3];
 socket.write(Buffer.concat([h,mask,m]));
}
function setState(context,state){
 const on=state==='on';
 send({event:'setTitle',context,payload:{title:on?'ВКЛЮЧЕНО':state==='off'?'ВЫКЛЮЧЕНО':'ОШИБКА',target:0}});
 send({event:'setImage',context,payload:{image:path.join(__dirname,'images',on?'bt-on.svg':state==='off'?'bt-off.svg':'bt-error.svg'),target:0}});
}
function native(mode){return new Promise((resolve,reject)=>{
 const exe=path.join(__dirname,'bin','BluetoothNative.exe');
 const p=spawn(exe,[mode],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);
 p.on('close',code=>{try{const v=JSON.parse(out.trim());if(code===0&&v.ok)resolve(v.state);else reject(new Error(v.error||err||'Native helper failed'));}catch(e){reject(new Error(err||out||e.message));}});
});}
async function refresh(context){try{setState(context,await native('status'));}catch(e){console.error('Bluetooth status:',e.message);setState(context,'error');}}
function handle(m){
 if(m.event==='willAppear')refresh(m.context);
 else if(m.event==='keyDown')native('toggle').then(s=>setState(m.context,s)).catch(e=>{console.error('Bluetooth toggle:',e.message);setState(m.context,'error');});
}
function connect(){
 socket=net.connect(port,'127.0.0.1',()=>{
  send({event:registerEvent,uuid:uuid});
 });
 socket.on('data',chunk=>{
  rx=Buffer.concat([rx,chunk]);
  while(rx.length>=2){
   let n=rx[1]&127,o=2;if(n===126){if(rx.length<4)return;n=rx.readUInt16BE(2);o=4;}else if(n===127)return;
   if(rx.length<o+n)return;
   const op=rx[0]&15,b=rx.subarray(o,o+n);rx=rx.subarray(o+n);
   if(op===1){try{handle(JSON.parse(b.toString()));}catch(e){console.error(e);}}
  }
 });
 socket.on('error',e=>console.error('Host connection:',e.message));
}
if(Number.isFinite(port)&&uuid&&registerEvent)connect();else console.error('Invalid FIFINE host arguments');
