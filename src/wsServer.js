/**
 * The Darkhold Exchange - Zero-Dependency RFC 6455 WebSocket Server
 * Native Node.js implementation for high-throughput live market data streaming
 */

import crypto from 'node:crypto';
import EventEmitter from 'node:events';

export class NativeWebSocketServer extends EventEmitter {
  constructor(httpServer) {
    super();
    this.clients = new Set();
    this.httpServer = httpServer;

    this.httpServer.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head);
    });
  }

  handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const acceptKey = crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`
    ];

    socket.write(headers.join('\r\n') + '\r\n\r\n');

    const client = new WebSocketConnection(socket, req);
    this.clients.add(client);

    client.on('close', () => {
      this.clients.delete(client);
      this.emit('disconnect', client);
    });

    client.on('error', () => {
      this.clients.delete(client);
    });

    client.on('message', (msg) => {
      this.emit('message', client, msg);
    });

    this.emit('connection', client, req);
  }

  broadcast(data, filterFn = null) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const client of this.clients) {
      if (!filterFn || filterFn(client)) {
        try {
          client.send(payload);
        } catch {
          this.clients.delete(client);
        }
      }
    }
  }

  getClientCount() {
    return this.clients.size;
  }
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.buffer = Buffer.alloc(0);
    this.subscriptions = new Set(['DAY1-PASS', 'VIP-RELIC', 'CHRONO-WRISTBAND']);
    this.remoteAddress = req.socket.remoteAddress;

    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    this.socket.on('close', () => this.emit('close'));
    this.socket.on('error', () => {
      try {
        this.socket.destroy();
      } catch {}
    });
  }

  processBuffer() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];

      const fin = (firstByte & 0x80) === 0x80;
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) === 0x80;
      let payloadLength = secondByte & 0x7f;

      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLength) {
        return; // Wait for full frame
      }

      const rawPayload = this.buffer.subarray(offset, offset + payloadLength);
      this.buffer = this.buffer.subarray(offset + payloadLength);

      // Unmask
      let payload = rawPayload;
      if (isMasked && maskKey) {
        payload = Buffer.alloc(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
          payload[i] = rawPayload[i] ^ maskKey[i % 4];
        }
      }

      // Handle Opcode
      if (opcode === 0x1) {
        // Text frame
        const text = payload.toString('utf8');
        try {
          const parsed = JSON.parse(text);
          this.emit('message', parsed);
        } catch {
          this.emit('message', text);
        }
      } else if (opcode === 0x8) {
        // Close frame
        this.close();
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        this.sendPong(payload);
      }
    }
  }

  send(data) {
    if (this.socket.destroyed) return;
    const stringData = typeof data === 'string' ? data : JSON.stringify(data);
    const payloadBuffer = Buffer.from(stringData, 'utf8');
    const length = payloadBuffer.length;

    let header;
    if (length <= 125) {
      header = Buffer.from([0x81, length]);
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    try {
      this.socket.write(Buffer.concat([header, payloadBuffer]));
    } catch {
      // Ignored if socket closed during write
    }
  }

  sendPong(payload) {
    if (this.socket.destroyed) return;
    const header = Buffer.from([0x8a, payload.length]);
    this.socket.write(Buffer.concat([header, payload]));
  }

  close() {
    if (!this.socket.destroyed) {
      const closeFrame = Buffer.from([0x88, 0x00]);
      this.socket.write(closeFrame);
      this.socket.end();
    }
  }
}
