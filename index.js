require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

// Configuración de CORS para producción con orígenes configurables
const parseOrigins = (value) =>
	value
		? value.split(',').map((s) => s.trim()).filter(Boolean)
		: [];

// CORS permisivo - permite cualquier origen
const corsOptions = {
	origin: true, // Permite cualquier origen
	credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Límite para diagramas grandes

// Importar modelos y base de datos
const { sequelize } = require('./models');

// Importar rutas
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const parseRoutes = require('./routes/parse');

// Usar rutas
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/parse', parseRoutes);

// Probar conexión y sincronizar modelos con reintentos (útil en Render al levantar servicios)
const connectWithRetry = async (retries = 5, delayMs = 3000) => {
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			console.log(`Intentando conectar a la base de datos (intento ${attempt}/${retries})...`);
			await sequelize.authenticate();
			console.log('Conexión a la base de datos exitosa');
			await sequelize.sync({ alter: true });
			console.log('Modelos sincronizados con la base de datos');
			return;
		} catch (err) {
			console.error(`Error al conectar/sincronizar (intento ${attempt}):`, err.code || err.message || err);
			if (attempt < retries) {
				console.log(`Reintentando en ${delayMs}ms...`);
				await new Promise(r => setTimeout(r, delayMs));
			} else {
				console.error('No se pudo conectar a la base de datos después de varios intentos. Continuando sin DB.');
			}
		}
	}
};

connectWithRetry();

app.get('/', (req, res) => {
	res.json({
		message: 'Backend del Diagramador UML funcionando',
		status: 'OK',
		timestamp: new Date().toISOString(),
		version: '1.0.0'
	});
});

// Health check endpoint para Render
app.get('/health', (req, res) => {
	res.status(200).json({
		status: 'healthy',
		uptime: process.uptime(),
		timestamp: Date.now()
	});
});

// Manejo de errores global
app.use((err, req, res, next) => {
	console.error(err.stack);
	res.status(500).json({ error: 'Algo salió mal!' });
});

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// --- WebSocket integrado: wss://<host>/ws ---
const rooms = new Map(); // roomCode -> { id, code, clients: Set<WebSocket>, diagram, createdAt }

const wss = new WebSocket.Server({ server, path: '/ws' });
console.log('🧩 WebSocket integrado habilitado en path /ws');

function getDefaultDiagram() {
	return {
		id: 'default-diagram',
		name: 'Collaborative Diagram',
		entities: [],
		relations: [],
		metadata: { created: new Date(), modified: new Date(), version: '1.0.0' }
	};
}

function wsSend(ws, message) {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(message));
	}
}

function broadcastToRoom(roomCode, message, exclude) {
	const room = rooms.get(roomCode);
	if (!room) return;
	room.clients.forEach((client) => {
		if (client !== exclude && client.readyState === WebSocket.OPEN) {
			wsSend(client, message);
		}
	});
}

function handleMessage(ws, data) {
	const { type, payload } = data || {};
	switch (type) {
		case 'CREATE_ROOM': {
			const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
			const room = {
				id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
				code: roomCode,
				clients: new Set([ws]),
				diagram: (payload && payload.diagram) || getDefaultDiagram(),
				createdAt: new Date(),
			};
			rooms.set(roomCode, room);
			ws.roomCode = roomCode;
			wsSend(ws, { type: 'ROOM_CREATED', payload: { roomCode, diagram: room.diagram, clientCount: room.clients.size } });
			break;
		}
		case 'JOIN_ROOM': {
			const roomCode = (payload && payload.roomCode || '').toUpperCase();
			const room = rooms.get(roomCode);
			if (!room) {
				wsSend(ws, { type: 'ERROR', payload: { message: 'Room not found' } });
				return;
			}
			if (ws.roomCode && ws.roomCode !== roomCode) {
				// leave previous
				const prev = rooms.get(ws.roomCode);
				if (prev) {
					prev.clients.delete(ws);
					broadcastToRoom(ws.roomCode, { type: 'CLIENT_LEFT', payload: { clientCount: prev.clients.size } });
				}
			}
			room.clients.add(ws);
			ws.roomCode = roomCode;
			wsSend(ws, { type: 'ROOM_JOINED', payload: { roomCode, diagram: room.diagram, clientCount: room.clients.size } });
			broadcastToRoom(roomCode, { type: 'CLIENT_JOINED', payload: { clientCount: room.clients.size } }, ws);
			break;
		}
		case 'LEAVE_ROOM': {
			const roomCode = (payload && payload.roomCode || ws.roomCode || '').toUpperCase();
			const room = rooms.get(roomCode);
			if (!room) return;
			room.clients.delete(ws);
			ws.roomCode = null;
			if (room.clients.size === 0) {
				rooms.delete(roomCode);
			} else {
				broadcastToRoom(roomCode, { type: 'CLIENT_LEFT', payload: { clientCount: room.clients.size } });
			}
			break;
		}
		case 'UPDATE_DIAGRAM': {
			const roomCode = (payload && payload.roomCode || ws.roomCode || '').toUpperCase();
			const diagram = payload && payload.diagram;
			const room = rooms.get(roomCode);
			if (!room || !room.clients.has(ws)) {
				wsSend(ws, { type: 'ERROR', payload: { message: 'Not in room or room not found' } });
				return;
			}
			room.diagram = diagram;
			broadcastToRoom(roomCode, { type: 'DIAGRAM_UPDATED', payload: { diagram } }, ws);
			break;
		}
		case 'PING':
			wsSend(ws, { type: 'PONG' });
			break;
		default:
			wsSend(ws, { type: 'ERROR', payload: { message: `Unknown message type: ${type}` } });
	}
}

wss.on('connection', (ws) => {
	ws.on('message', (raw) => {
		try { handleMessage(ws, JSON.parse(raw)); } catch (e) { wsSend(ws, { type: 'ERROR', payload: { message: 'Invalid message format' } }); }
	});
	ws.on('close', () => {
		if (ws.roomCode) {
			const room = rooms.get(ws.roomCode);
			if (room) {
				room.clients.delete(ws);
				if (room.clients.size === 0) rooms.delete(ws.roomCode);
				else broadcastToRoom(ws.roomCode, { type: 'CLIENT_LEFT', payload: { clientCount: room.clients.size } });
			}
			ws.roomCode = null;
		}
	});
});

server.on('error', (err) => {
	if (err.code === 'EADDRINUSE') {
		console.error(`❌ Error: El puerto ${PORT} ya está en uso por otro proceso.`);
		console.error(`💡 Sugerencia: Puedes detener el proceso que ocupa el puerto ${PORT} o cambiar PORT en .env`);
	} else {
		console.error('Error al iniciar el servidor:', err);
	}
	process.exit(1);
});

server.listen(PORT, () => {
	console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
