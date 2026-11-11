const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Estructura simple para manejar salas (KISS)
const rooms = new Map(); // roomCode -> { id, clients: Set<WebSocket>, diagram: UMLDiagram }

class CollaborationServer {
  constructor(port = 8081) {
    // KISS: Usar solo WebSocket sin SSL para desarrollo
    console.log('🔧 [WebSocket] Usando WS sin SSL para simplicidad');
    this.wss = new WebSocket.Server({ 
      port,
      host: '0.0.0.0', // Permitir conexiones desde cualquier IP (localhost + red)
      verifyClient: () => true
    });
    console.log(`🚀 WebSocket server (WS) running on port ${port}`);
    console.log(`🏠 Local access: ws://localhost:${port}`);
    console.log(`🌐 Network access: ws://192.168.0.18:${port}`);
    
    this.setupWebSocketHandlers();
  }

  setupWebSocketHandlers() {
    this.wss.on('connection', (ws) => {
      console.log('👤 New client connected');
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('❌ Error parsing message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        console.log('👤 Client disconnected');
        this.removeClientFromAllRooms(ws);
      });

      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
      });
    });
  }

  handleMessage(ws, data) {
    const { type, payload } = data;

    switch (type) {
      case 'CREATE_ROOM':
        this.createRoom(ws, payload);
        break;
      case 'JOIN_ROOM':
        this.joinRoom(ws, payload);
        break;
      case 'LEAVE_ROOM':
        this.leaveRoom(ws, payload);
        break;
      case 'UPDATE_DIAGRAM':
        this.updateDiagram(ws, payload);
        break;
      case 'PING':
        this.sendMessage(ws, { type: 'PONG' });
        break;
      default:
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  createRoom(ws, { diagram }) {
    // Generar código de sala simple (YAGNI - solo 6 caracteres)
    const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    
    const room = {
      id: uuidv4(),
      code: roomCode,
      clients: new Set([ws]),
      diagram: diagram || this.getDefaultDiagram(),
      createdAt: new Date()
    };

    rooms.set(roomCode, room);
    ws.roomCode = roomCode;

    this.sendMessage(ws, {
      type: 'ROOM_CREATED',
      payload: {
        roomCode,
        diagram: room.diagram,
        clientCount: room.clients.size
      }
    });

    console.log(`🏠 Room created: ${roomCode}`);
  }

  joinRoom(ws, { roomCode }) {
    const room = rooms.get(roomCode.toUpperCase());
    
    if (!room) {
      this.sendError(ws, 'Room not found');
      return;
    }

    // Remover cliente de sala anterior si existe
    if (ws.roomCode) {
      this.leaveRoom(ws, { roomCode: ws.roomCode });
    }

    room.clients.add(ws);
    ws.roomCode = roomCode.toUpperCase();

    // Enviar diagrama actual al nuevo cliente
    this.sendMessage(ws, {
      type: 'ROOM_JOINED',
      payload: {
        roomCode: roomCode.toUpperCase(),
        diagram: room.diagram,
        clientCount: room.clients.size
      }
    });

    // Notificar a otros clientes
    this.broadcastToRoom(roomCode.toUpperCase(), {
      type: 'CLIENT_JOINED',
      payload: { clientCount: room.clients.size }
    }, ws);

    console.log(`👤 Client joined room: ${roomCode.toUpperCase()} (${room.clients.size} clients)`);
  }

  leaveRoom(ws, { roomCode }) {
    const room = rooms.get(roomCode?.toUpperCase());
    if (!room) return;

    room.clients.delete(ws);
    ws.roomCode = null;

    if (room.clients.size === 0) {
      // Eliminar sala vacía (KISS)
      rooms.delete(roomCode.toUpperCase());
      console.log(`🗑️ Empty room deleted: ${roomCode.toUpperCase()}`);
    } else {
      // Notificar a clientes restantes
      this.broadcastToRoom(roomCode.toUpperCase(), {
        type: 'CLIENT_LEFT',
        payload: { clientCount: room.clients.size }
      });
    }

    console.log(`👤 Client left room: ${roomCode.toUpperCase()}`);
  }

  updateDiagram(ws, { roomCode, diagram }) {
    const room = rooms.get(roomCode?.toUpperCase());
    if (!room || !room.clients.has(ws)) {
      this.sendError(ws, 'Not in room or room not found');
      return;
    }

    // Actualizar diagrama en la sala
    room.diagram = diagram;

    // Enviar actualización a todos los otros clientes (KISS)
    this.broadcastToRoom(roomCode.toUpperCase(), {
      type: 'DIAGRAM_UPDATED',
      payload: { diagram }
    }, ws);

    console.log(`📊 Diagram updated in room: ${roomCode.toUpperCase()}`);
  }

  broadcastToRoom(roomCode, message, excludeClient = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.clients.forEach((client) => {
      if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
        this.sendMessage(client, message);
      }
    });
  }

  removeClientFromAllRooms(ws) {
    if (ws.roomCode) {
      this.leaveRoom(ws, { roomCode: ws.roomCode });
    }
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  sendError(ws, error) {
    this.sendMessage(ws, {
      type: 'ERROR',
      payload: { message: error }
    });
  }

  getDefaultDiagram() {
    return {
      id: 'default-diagram',
      name: 'Collaborative Diagram',
      entities: [],
      relations: [],
      metadata: {
        created: new Date(),
        modified: new Date(),
        version: '1.0.0'
      }
    };
  }

  // Método para obtener estadísticas (opcional)
  getStats() {
    const totalRooms = rooms.size;
    const totalClients = Array.from(rooms.values()).reduce((sum, room) => sum + room.clients.size, 0);
    
    return { totalRooms, totalClients };
  }
}

// Iniciar servidor
const server = new CollaborationServer(8081);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down WebSocket server...');
  server.wss.close(() => {
    console.log('✅ WebSocket server closed');
    process.exit(0);
  });
});

module.exports = CollaborationServer;