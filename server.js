/**
 * BoothTogether - Real-Time Virtual Photobooth for LDR Couples
 * Zero-dependency Node.js HTTP & WebSocket Signaling Server
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

// Rooms registry: roomId -> Map<clientId, { socket, userId, role, joinedAt }>
const rooms = new Map();
// Socket to room mapping for fast cleanup: socket -> { roomId, clientId }
const socketMeta = new Map();

/**
 * Handle HTTP requests (Serve static files & health check)
 */
const server = http.createServer((req, res) => {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Status endpoint
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  if (urlObj.pathname === '/api/status') {
    const roomSummaries = [];
    for (const [id, clients] of rooms.entries()) {
      roomSummaries.push({
        roomId: id,
        usersCount: clients.size,
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      app: 'BoothTogether',
      version: '1.0.0',
      activeRooms: rooms.size,
      rooms: roomSummaries,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Static file serving
  let reqPath = urlObj.pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  // Prevent directory traversal attacks
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // If requesting a room route or unknown file, fall back to index.html for SPA routing
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(content);
    });
  });
});

/**
 * RFC 6455 WebSocket Implementation in Pure Node.js
 */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

server.on('upgrade', (req, socket, head) => {
  const upgrade = req.headers.upgrade;
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  // Compute accept hash
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
  ];

  socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');

  // Socket buffer & state
  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (buffer.length < offset + 2) break;
        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (buffer.length < offset + 8) break;
        payloadLength = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskingKey = null;
      if (isMasked) {
        if (buffer.length < offset + 4) break;
        maskingKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + payloadLength) {
        // Incomplete frame, wait for more chunks
        break;
      }

      const rawPayload = buffer.subarray(offset, offset + payloadLength);
      const payload = Buffer.alloc(payloadLength);

      if (isMasked && maskingKey) {
        for (let i = 0; i < payloadLength; i++) {
          payload[i] = rawPayload[i] ^ maskingKey[i % 4];
        }
      } else {
        rawPayload.copy(payload);
      }

      // Advance buffer past current frame
      buffer = buffer.subarray(offset + payloadLength);

      // Handle WebSocket Opcodes
      if (opcode === 0x8) {
        // Connection Close
        sendWsFrame(socket, Buffer.alloc(0), 0x8);
        cleanupSocket(socket);
        socket.end();
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        sendWsFrame(socket, payload, 0xA);
      } else if (opcode === 0x1) {
        // Text frame
        const messageStr = payload.toString('utf8');
        handleClientMessage(socket, messageStr);
      }
    }
  });

  socket.on('close', () => {
    cleanupSocket(socket);
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
    cleanupSocket(socket);
  });
});

/**
 * Send an unmasked RFC 6455 frame to client
 */
function sendWsFrame(socket, data, opcode = 1) {
  if (socket.destroyed || !socket.writable) return;

  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  try {
    socket.write(Buffer.concat([header, payload]));
  } catch (err) {
    console.error('Failed to send WS frame:', err.message);
  }
}

/**
 * Send a JSON message to a specific client
 */
function sendJson(socket, obj) {
  sendWsFrame(socket, JSON.stringify(obj), 0x1);
}

/**
 * Broadcast message to other peer in the room
 */
function broadcastToRoom(roomId, senderSocket, obj, includeSender = false) {
  const room = rooms.get(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(obj);
  for (const [clientId, client] of room.entries()) {
    if (!includeSender && client.socket === senderSocket) continue;
    sendWsFrame(client.socket, messageStr, 0x1);
  }
}

/**
 * Process incoming application messages
 */
function handleClientMessage(socket, rawMessage) {
  let msg;
  try {
    msg = JSON.parse(rawMessage);
  } catch (err) {
    console.error('Invalid JSON received:', err);
    return;
  }

  const { type, roomId, clientId, payload } = msg;

  switch (type) {
    case 'JOIN_ROOM': {
      const targetRoomId = (roomId || '').trim().toUpperCase();
      if (!targetRoomId || targetRoomId.length !== 6) {
        sendJson(socket, {
          type: 'ERROR',
          message: 'Invalid room code. Room code must be 6 alphanumeric characters.'
        });
        return;
      }

      let room = rooms.get(targetRoomId);
      if (!room) {
        room = new Map();
        rooms.set(targetRoomId, room);
      }

      // Enforce the 2-user photobooth room cap!
      if (room.size >= 2) {
        sendJson(socket, {
          type: 'ROOM_FULL',
          roomId: targetRoomId,
          message: 'This booth is already occupied by two lovers! Please create your own booth or verify the code.'
        });
        return;
      }

      const assignedRole = room.size === 0 ? 'initiator' : 'receiver';
      const userMeta = {
        socket,
        clientId: clientId || `client_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        role: assignedRole,
        name: payload?.name || (assignedRole === 'initiator' ? 'Partner A' : 'Partner B'),
        joinedAt: Date.now()
      };

      room.set(userMeta.clientId, userMeta);
      socketMeta.set(socket, { roomId: targetRoomId, clientId: userMeta.clientId });

      console.log(`[ROOM ${targetRoomId}] User ${userMeta.name} (${userMeta.clientId}) joined as ${assignedRole}. Total users: ${room.size}`);

      // Notify the joining user
      sendJson(socket, {
        type: 'JOINED_SUCCESS',
        roomId: targetRoomId,
        clientId: userMeta.clientId,
        role: assignedRole,
        userCount: room.size,
        peerInfo: assignedRole === 'receiver' ? {
          name: Array.from(room.values())[0].name
        } : null
      });

      // If there was already a partner waiting, notify both that booth is ready!
      if (room.size === 2) {
        const clientsArray = Array.from(room.values());
        const initiator = clientsArray.find(c => c.role === 'initiator') || clientsArray[0];
        const receiver = clientsArray.find(c => c.role === 'receiver') || clientsArray[1];

        // Notify initiator that receiver has joined -> initiator will create WebRTC offer
        sendJson(initiator.socket, {
          type: 'PEER_JOINED',
          roomId: targetRoomId,
          peerId: receiver.clientId,
          peerName: receiver.name,
          shouldInitiateOffer: true
        });

        // Notify receiver that initiator is ready
        sendJson(receiver.socket, {
          type: 'PEER_JOINED',
          roomId: targetRoomId,
          peerId: initiator.clientId,
          peerName: initiator.name,
          shouldInitiateOffer: false
        });
      }
      break;
    }

    // WebRTC Signaling: relay Offer, Answer, ICE candidates between the 2 peers
    case 'SIGNAL': {
      const room = rooms.get(roomId);
      if (!room) return;
      broadcastToRoom(roomId, socket, {
        type: 'SIGNAL',
        senderId: clientId,
        signalData: payload
      }, false);
      break;
    }

    // Synchronized Countdown Shutter Trigger
    case 'TRIGGER_COUNTDOWN': {
      const syncTimestamp = Date.now() + 150; // Add small sync buffer for clock drift
      console.log(`[ROOM ${roomId}] Synchronized countdown triggered by ${clientId}`);
      broadcastToRoom(roomId, socket, {
        type: 'SYNCED_COUNTDOWN_START',
        triggeredBy: clientId,
        syncTimestamp,
        shotMode: payload?.shotMode || 'single', // 'single', 'strip3', 'strip4'
        shotCount: payload?.shotCount || 1,
        shotIndex: payload?.shotIndex || 0
      }, true); // include sender so both trigger at exact same moment!
      break;
    }

    case 'CANCEL_COUNTDOWN': {
      broadcastToRoom(roomId, socket, {
        type: 'SYNCED_COUNTDOWN_CANCELLED',
        cancelledBy: clientId
      }, true);
      break;
    }

    // Live Filter & Brightness Synchronization
    case 'SYNC_FILTER': {
      broadcastToRoom(roomId, socket, {
        type: 'FILTER_UPDATED',
        senderId: clientId,
        filterPreset: payload?.filterPreset || 'natural',
        brightness: payload?.brightness ?? 100,
        warmth: payload?.warmth ?? 0,
        syncMode: payload?.syncMode || false
      }, false);
      break;
    }

    // Screen Flashlight (Ring Light Mode) state sync
    case 'SYNC_FLASHLIGHT': {
      broadcastToRoom(roomId, socket, {
        type: 'FLASHLIGHT_UPDATED',
        senderId: clientId,
        active: !!payload?.active
      }, false);
      break;
    }

    // Synced Photostrip Layout & Customization
    case 'SYNC_STRIP_CONFIG': {
      broadcastToRoom(roomId, socket, {
        type: 'STRIP_CONFIG_UPDATED',
        senderId: clientId,
        config: payload
      }, false);
      break;
    }

    // Real-Time Love Reactions & Floating Hearts
    case 'SEND_REACTION': {
      broadcastToRoom(roomId, socket, {
        type: 'REACTION_RECEIVED',
        senderId: clientId,
        emoji: payload?.emoji || '❤️',
        x: payload?.x || 0.5,
        y: payload?.y || 0.5
      }, true);
      break;
    }

    // Partner chat message / cute whispers
    case 'SEND_MESSAGE': {
      broadcastToRoom(roomId, socket, {
        type: 'MESSAGE_RECEIVED',
        senderId: clientId,
        senderName: payload?.senderName || 'Partner',
        text: payload?.text || '',
        timestamp: Date.now()
      }, true);
      break;
    }

    default:
      console.log(`Unhandled message type: ${type}`);
  }
}

/**
 * Clean up disconnected socket from room
 */
function cleanupSocket(socket) {
  const meta = socketMeta.get(socket);
  if (!meta) return;

  const { roomId, clientId } = meta;
  socketMeta.delete(socket);

  const room = rooms.get(roomId);
  if (!room) return;

  const user = room.get(clientId);
  room.delete(clientId);
  console.log(`[ROOM ${roomId}] User ${user ? user.name : clientId} disconnected. Remaining users: ${room.size}`);

  if (room.size === 0) {
    rooms.delete(roomId);
    console.log(`[ROOM ${roomId}] Room closed and cleaned up.`);
  } else {
    // Notify the remaining partner
    broadcastToRoom(roomId, null, {
      type: 'PEER_LEFT',
      roomId,
      peerId: clientId,
      message: 'Your partner has disconnected. Waiting for them to rejoin...'
    }, true);
  }
}

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`  ★ BoothTogether - Virtual LDR Photobooth Server ★   `);
  console.log(`  Local URL:        http://localhost:${PORT}          `);
  console.log(`  WebSocket Server: ws://localhost:${PORT}           `);
  console.log(`  Max Capacity:     Strictly 2 lovers per room        `);
  console.log(`=======================================================`);
});
