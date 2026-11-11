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
const { sequelize, Project } = require('./models');

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
const rooms = new Map(); // roomCode -> { id, code, projectId, clients: Set<WebSocket>, diagram, history, createdAt }

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

function getDefaultHistory() {
	return {
		messages: [],
		activities: [],
		contributors: []
	};
}

function normalizeHistory(rawHistory) {
	let parsed = rawHistory;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch (e) {
			parsed = null;
		}
	}
	if (!parsed || typeof parsed !== 'object') {
		return getDefaultHistory();
	}
	return {
		messages: Array.isArray(parsed.messages) ? parsed.messages : [],
		activities: Array.isArray(parsed.activities) ? parsed.activities : [],
		contributors: Array.isArray(parsed.contributors) ? parsed.contributors : []
	};
}

function getRoomParticipants(room) {
	if (!room || !room.clients) return [];
	const seen = new Set();
	const participants = [];
	room.clients.forEach((client) => {
		if (client.user && client.user.id !== undefined && client.user.id !== null) {
			const key = String(client.user.id);
			if (!seen.has(key)) {
				seen.add(key);
				participants.push(client.user);
			}
		}
	});
	return participants;
}

function registerContributor(room, user, incrementAction = false) {
	if (!room || !user) return;
	if (!room.history) {
		room.history = getDefaultHistory();
	}
	if (!Array.isArray(room.history.contributors)) {
		room.history.contributors = [];
	}

	const userId = user.id || 'unknown';
	const userName = user.nombre || user.name || 'Invitado';
	const userCorreo = user.correo || user.email || '';
	const now = new Date().toISOString();

	const existingIndex = room.history.contributors.findIndex(
		(c) => String(c.id) === String(userId)
	);

	if (existingIndex >= 0) {
		const existing = room.history.contributors[existingIndex];
		room.history.contributors[existingIndex] = {
			...existing,
			id: existing.id || userId,
			nombre: userName || existing.nombre,
			correo: userCorreo || existing.correo || '',
			lastActive: now,
			actionsCount: (existing.actionsCount || 0) + (incrementAction ? 1 : 0)
		};
	} else {
		room.history.contributors.push({
			id: userId,
			nombre: userName,
			correo: userCorreo,
			lastActive: now,
			actionsCount: incrementAction ? 1 : 0
		});
	}
}

async function saveRoomToDatabase(room) {
	if (!room || !room.projectId) return;
	try {
		const project = await Project.findByPk(room.projectId);
		if (project) {
			await project.update({
				contenido_diagrama: room.diagram,
				historial_colaboracion: room.history
			});
		}
	} catch (err) {
		console.error(`Error al persistir la sala ${room.code} en el proyecto ${room.projectId}:`, err.message || err);
	}
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

async function handleMessage(ws, data) {
	const { type, payload } = data || {};
	switch (type) {
		case 'CREATE_ROOM': {
			ws.user = payload?.user || { id: 'anon-' + Date.now(), nombre: 'Invitado' };
			const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
			const projectId = payload?.projectId || null;

			let initialHistory = getDefaultHistory();
			let initialDiagram = (payload && payload.diagram) || null;

			if (projectId) {
				try {
					const project = await Project.findByPk(projectId);
					if (project) {
						if (project.historial_colaboracion) {
							initialHistory = normalizeHistory(project.historial_colaboracion);
						}
						if (!initialDiagram && project.contenido_diagrama) {
							initialDiagram = typeof project.contenido_diagrama === 'string'
								? JSON.parse(project.contenido_diagrama)
								: project.contenido_diagrama;
						}
					}
				} catch (dbErr) {
					console.error('Error al cargar historial del proyecto en CREATE_ROOM:', dbErr.message || dbErr);
				}
			}

			const room = {
				id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
				code: roomCode,
				projectId,
				clients: new Set([ws]),
				diagram: initialDiagram || getDefaultDiagram(),
				history: initialHistory,
				createdAt: new Date(),
			};

			registerContributor(room, ws.user, false);

			rooms.set(roomCode, room);
			ws.roomCode = roomCode;

			await saveRoomToDatabase(room);

			wsSend(ws, {
				type: 'ROOM_CREATED',
				payload: {
					roomCode,
					projectId: room.projectId,
					diagram: room.diagram,
					clientCount: room.clients.size,
					participants: getRoomParticipants(room),
					history: room.history
				}
			});
			break;
		}
		case 'JOIN_ROOM': {
			const roomCode = (payload && payload.roomCode || '').toUpperCase();
			const room = rooms.get(roomCode);
			if (!room) {
				wsSend(ws, { type: 'ERROR', payload: { message: 'Room not found' } });
				return;
			}

			ws.user = payload?.user || { id: 'anon-' + Date.now(), nombre: 'Invitado' };

			if (ws.roomCode && ws.roomCode !== roomCode) {
				// leave previous
				const prev = rooms.get(ws.roomCode);
				if (prev) {
					prev.clients.delete(ws);
					if (prev.clients.size === 0) {
						await saveRoomToDatabase(prev);
						rooms.delete(ws.roomCode);
					} else {
						broadcastToRoom(ws.roomCode, {
							type: 'CLIENT_LEFT',
							payload: {
								clientCount: prev.clients.size,
								user: ws.user,
								participants: getRoomParticipants(prev)
							}
						});
					}
				}
			}

			room.clients.add(ws);
			ws.roomCode = roomCode;

			registerContributor(room, ws.user, false);
			await saveRoomToDatabase(room);

			wsSend(ws, {
				type: 'ROOM_JOINED',
				payload: {
					roomCode,
					projectId: room.projectId,
					diagram: room.diagram,
					clientCount: room.clients.size,
					participants: getRoomParticipants(room),
					history: room.history
				}
			});

			broadcastToRoom(roomCode, {
				type: 'CLIENT_JOINED',
				payload: {
					clientCount: room.clients.size,
					user: ws.user,
					participants: getRoomParticipants(room),
					history: room.history
				}
			}, ws);
			break;
		}
		case 'LEAVE_ROOM': {
			const roomCode = (payload && payload.roomCode || ws.roomCode || '').toUpperCase();
			const room = rooms.get(roomCode);
			if (!room) return;
			room.clients.delete(ws);
			ws.roomCode = null;
			if (room.clients.size === 0) {
				await saveRoomToDatabase(room);
				rooms.delete(roomCode);
			} else {
				broadcastToRoom(roomCode, {
					type: 'CLIENT_LEFT',
					payload: {
						clientCount: room.clients.size,
						user: ws.user,
						participants: getRoomParticipants(room)
					}
				});
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

			const actor = payload?.user || ws.user || { id: 'unknown', nombre: 'Usuario' };
			let activity = null;

			if (payload && payload.actionSummary) {
				activity = {
					id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					userId: actor.id,
					userName: actor.nombre,
					action: payload.actionSummary,
					timestamp: new Date().toISOString()
				};
				room.history.activities.push(activity);
				// Mantener máximo las últimas 100 actividades
				if (room.history.activities.length > 100) room.history.activities.shift();
				registerContributor(room, actor, true);
			}

			await saveRoomToDatabase(room);

			broadcastToRoom(roomCode, {
				type: 'DIAGRAM_UPDATED',
				payload: {
					diagram,
					user: actor,
					activity,
					contributors: room.history.contributors
				}
			}, ws);

			if (activity) {
				wsSend(ws, {
					type: 'ACTIVITY_SYNCED',
					payload: {
						history: room.history
					}
				});
			}
			break;
		}
		case 'CHAT_MESSAGE': {
			const roomCode = (payload && payload.roomCode || ws.roomCode || '').toUpperCase();
			const room = rooms.get(roomCode);
			if (!room || !room.clients.has(ws)) {
				wsSend(ws, { type: 'ERROR', payload: { message: 'Not in room or room not found' } });
				return;
			}

			const chatMsg = {
				id: payload.message?.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
				senderId: payload.message?.senderId || ws.user?.id || 'unknown',
				senderName: payload.message?.senderName || ws.user?.nombre || 'Usuario',
				senderRole: payload.message?.senderRole || 'user', // 'user' | 'ai' | 'system'
				content: payload.message?.content || '',
				replyToUser: payload.message?.replyToUser || null,
				actionSummary: payload.message?.actionSummary || null,
				timestamp: payload.message?.timestamp || new Date().toISOString()
			};

			room.history.messages.push(chatMsg);
			if (room.history.messages.length > 100) room.history.messages.shift();

			if (chatMsg.senderRole === 'user') {
				registerContributor(room, { id: chatMsg.senderId, nombre: chatMsg.senderName, correo: ws.user?.correo }, false);
			}

			await saveRoomToDatabase(room);

			room.clients.forEach((client) => {
				wsSend(client, {
					type: 'CHAT_MESSAGE_RECEIVED',
					payload: {
						message: chatMsg,
						history: room.history
					}
				});
			});
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
	ws.on('message', async (raw) => {
		try {
			const parsed = JSON.parse(raw);
			await handleMessage(ws, parsed);
		} catch (e) {
			console.error('Error procesando mensaje WS:', e);
			wsSend(ws, { type: 'ERROR', payload: { message: 'Invalid message format' } });
		}
	});
	ws.on('close', async () => {
		if (ws.roomCode) {
			const currentRoomCode = ws.roomCode;
			ws.roomCode = null;
			const room = rooms.get(currentRoomCode);
			if (room) {
				room.clients.delete(ws);
				if (room.clients.size === 0) {
					await saveRoomToDatabase(room);
					rooms.delete(currentRoomCode);
				} else {
					broadcastToRoom(currentRoomCode, {
						type: 'CLIENT_LEFT',
						payload: {
							clientCount: room.clients.size,
							user: ws.user,
							participants: getRoomParticipants(room)
						}
					});
				}
			}
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
