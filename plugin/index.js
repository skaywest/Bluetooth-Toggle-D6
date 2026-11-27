'use strict';
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let socket;
let connected = false;
let handshakeBuffer = Buffer.alloc(0);
let rx = Buffer.alloc(0);
let fragmented = Buffer.alloc(0);
let fragmentOpcode = 0;

const port = Number(process.argv[3]);
const uuid = process.argv[5];
const registerEvent = process.argv[7];

function sendFrame(opcode, payload) {
  if (!socket || socket.destroyed || !connected) return;
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  const masked = Buffer.from(body);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  socket.write(Buffer.concat([header, mask, masked]));
}

function send(obj) {
  sendFrame(1, Buffer.from(JSON.stringify(obj), 'utf8'));
}

function imageData(name) {
  const file = path.join(__dirname, 'images', name);
  const data = fs.readFileSync(file);
  return 'data:image/svg+xml;base64,' + data.toString('base64');
}

function setState(context, state) {
  const on = state === 'on';
  const title = on ? 'ВКЛЮЧЕНО' : state === 'off' ? 'ВЫКЛЮЧЕНО' : 'ОШИБКА';
  const image = on ? 'bt-on.svg' : state === 'off' ? 'bt-off.svg' : 'bt-error.svg';
  send({ event: 'setTitle', context, payload: { title, target: 0 } });
  send({ event: 'setImage', context, payload: { image: imageData(image), target: 0 } });
}

function native(mode) {
  return new Promise((resolve, reject) => {
    const exe = path.join(__dirname, 'bin', 'BluetoothNative.exe');
    const child = spawn(exe, [mode], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => out += d.toString('utf8'));
    child.stderr.on('data', d => err += d.toString('utf8'));
    child.on('error', reject);
    child.on('close', code => {
      try {
        const result = JSON.parse(out.trim());
        if (code === 0 && result.ok) resolve(result.state);
        else reject(new Error(result.error || err || 'Native helper failed'));
      } catch (e) {
        reject(new Error(err || out || e.message));
      }
    });
  });
}

async function refresh(context) {
  try {
    setState(context, await native('status'));
  } catch (e) {
    console.error('Bluetooth status:', e.message);
    setState(context, 'error');
  }
}

function handleMessage(message) {
  if (message.event === 'willAppear') refresh(message.context);
  else if (message.event === 'keyDown') {
    native('toggle')
      .then(state => setState(message.context, state))
      .catch(error => {
        console.error('Bluetooth toggle:', error.message);
        setState(message.context, 'error');
      });
  }
}

function parseFrames() {
  while (rx.length >= 2) {
    const first = rx[0];
    const second = rx[1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (rx.length < 4) return;
      length = rx.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (rx.length < 10) return;
      const bigLength = rx.readBigUInt64BE(2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        console.error('WebSocket frame too large');
        socket.destroy();
        return;
      }
      length = Number(bigLength);
      offset = 10;
    }

    let mask;
    if (masked) {
      if (rx.length < offset + 4) return;
      mask = rx.subarray(offset, offset + 4);
      offset += 4;
    }
    if (rx.length < offset + length) return;

    const payload = Buffer.from(rx.subarray(offset, offset + length));
    rx = rx.subarray(offset + length);
    if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

    if (opcode === 8) {
      socket.end();
      return;
    }
    if (opcode === 9) {
      sendFrame(10, payload);
      continue;
    }
    if (opcode === 10) continue;

    if (opcode === 1 || opcode === 2) {
      fragmentOpcode = opcode;
      fragmented = payload;
    } else if (opcode === 0) {
      fragmented = Buffer.concat([fragmented, payload]);
    } else {
      continue;
    }

    if (fin && fragmentOpcode) {
      if (fragmentOpcode === 1) {
        try { handleMessage(JSON.parse(fragmented.toString('utf8'))); }
        catch (e) { console.error('Invalid host message:', e.message); }
      }
      fragmented = Buffer.alloc(0);
      fragmentOpcode = 0;
    }
  }
}

function connect() {
  const key = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket = net.connect(port, '127.0.0.1', () => {
    socket.write(
      'GET / HTTP/1.1\r\n' +
      'Host: 127.0.0.1:' + port + '\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n'
    );
  });

  socket.on('data', chunk => {
    if (!connected) {
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      const end = handshakeBuffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const headers = handshakeBuffer.subarray(0, end).toString('latin1');
      if (!/^HTTP\/1\.1 101\b/m.test(headers) ||
          !new RegExp('^Sec-WebSocket-Accept:\\s*' + expectedAccept.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '\\s*$', 'im').test(headers)) {
        console.error('FIFINE WebSocket handshake rejected:', headers.split('\r\n')[0]);
        socket.destroy();
        return;
      }
      connected = true;
      const rest = handshakeBuffer.subarray(end + 4);
      handshakeBuffer = Buffer.alloc(0);
      send({ event: registerEvent, uuid });
      if (rest.length) {
        rx = Buffer.concat([rx, rest]);
        parseFrames();
      }
      return;
    }
    rx = Buffer.concat([rx, chunk]);
    parseFrames();
  });

  socket.on('error', error => console.error('FIFINE connection:', error.message));
  socket.on('close', () => { connected = false; });
}

if (Number.isFinite(port) && port > 0 && uuid && registerEvent) connect();
else console.error('Invalid FIFINE host arguments');
