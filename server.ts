import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import Database from 'better-sqlite3';

const db = new Database('projects.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    resolution INTEGER NOT NULL,
    strokes TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

try {
  db.exec('ALTER TABLE projects ADD COLUMN layers TEXT DEFAULT \'[{"id":"layer-1","name":"Layer 1","visible":true,"locked":false}]\';');
} catch (e) {
  // Column might already exist
}

const app = express();
app.use(express.json({ limit: '50mb' }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;

interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

interface Stroke {
  id: string;
  userId: string;
  userName: string;
  mode: 'pixel' | 'freehand' | 'eraser';
  color: string;
  size: number;
  layerId: string;
  points: { x: number; y: number }[];
}

interface Room {
  id: string;
  type: 'pixel' | 'freehand';
  resolution: number;
  strokes: Stroke[];
  layers: Layer[];
  users: Set<WebSocket>;
}

const rooms = new Map<string, Room>();
const clientInfo = new Map<WebSocket, { roomId: string, userId: string, userName: string }>();

function getRoom(roomId: string): Room | undefined {
  if (rooms.has(roomId)) return rooms.get(roomId);
  
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const row = stmt.get(roomId) as any;
  if (row) {
    const room: Room = {
      id: row.id,
      type: row.type,
      resolution: row.resolution,
      strokes: JSON.parse(row.strokes),
      layers: JSON.parse(row.layers || '[{"id":"layer-1","name":"Layer 1","visible":true,"locked":false}]'),
      users: new Set()
    };
    rooms.set(roomId, room);
    return room;
  }
  return undefined;
}

function saveRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (room) {
    const stmt = db.prepare('UPDATE projects SET strokes = ?, resolution = ?, layers = ? WHERE id = ?');
    stmt.run(JSON.stringify(room.strokes), room.resolution, JSON.stringify(room.layers), roomId);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'join') {
        const { roomId, userId, userName } = data;
        clientInfo.set(ws, { roomId, userId, userName });
        
        let room = getRoom(roomId);
        if (!room) return;
        
        room.users.add(ws);
        
        ws.send(JSON.stringify({
          type: 'init',
          projectType: room.type,
          resolution: room.resolution,
          strokes: room.strokes,
          layers: room.layers
        }));
        
        const userCount = room.users.size;
        room.users.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'user_count', count: userCount }));
          }
        });
      } else if (data.type === 'draw') {
        const info = clientInfo.get(ws);
        if (info) {
          const room = rooms.get(info.roomId);
          if (room) {
            room.strokes.push(data.stroke);
            saveRoom(info.roomId);
            
            room.users.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'draw', stroke: data.stroke }));
              }
            });
          }
        }
      } else if (data.type === 'undo') {
        const info = clientInfo.get(ws);
        if (info) {
          const room = rooms.get(info.roomId);
          if (room) {
            room.strokes = room.strokes.filter(s => s.id !== data.strokeId);
            saveRoom(info.roomId);
            
            room.users.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'undo', strokeId: data.strokeId }));
              }
            });
          }
        }
      } else if (data.type === 'clear') {
        const info = clientInfo.get(ws);
        if (info) {
          const room = rooms.get(info.roomId);
          if (room) {
            room.strokes = [];
            saveRoom(info.roomId);
            
            room.users.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'clear' }));
              }
            });
          }
        }
      } else if (data.type === 'change_resolution') {
        const info = clientInfo.get(ws);
        if (info) {
          const room = rooms.get(info.roomId);
          if (room) {
            room.resolution = data.resolution;
            // Optionally clear strokes on resolution change, or keep them. Let's keep them for now, but scale might be off.
            // Actually, clearing is safer for pixel art.
            room.strokes = [];
            saveRoom(info.roomId);
            
            room.users.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'change_resolution', resolution: data.resolution }));
              }
            });
          }
        }
      } else if (data.type === 'update_layers') {
        const info = clientInfo.get(ws);
        if (info) {
          const room = rooms.get(info.roomId);
          if (room) {
            room.layers = data.layers;
            saveRoom(info.roomId);
            
            room.users.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'update_layers', layers: data.layers }));
              }
            });
          }
        }
      } else if (data.type === 'import_project') {
        const info = clientInfo.get(ws);
        if (info) {
          const room = rooms.get(info.roomId);
          if (room) {
            room.strokes = data.strokes;
            room.layers = data.layers;
            room.resolution = data.resolution;
            saveRoom(info.roomId);
            
            room.users.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ 
                  type: 'init', 
                  projectType: room.type,
                  resolution: room.resolution,
                  strokes: room.strokes,
                  layers: room.layers
                }));
              }
            });
          }
        }
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  ws.on('close', () => {
    const info = clientInfo.get(ws);
    if (info) {
      const room = rooms.get(info.roomId);
      if (room) {
        room.users.delete(ws);
        const userCount = room.users.size;
        room.users.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'user_count', count: userCount }));
          }
        });
        if (room.users.size === 0) {
          rooms.delete(info.roomId);
        }
      }
    }
    clientInfo.delete(ws);
  });
});

async function startServer() {
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/projects', (req, res) => {
    const stmt = db.prepare('SELECT id, type, resolution, created_at FROM projects ORDER BY created_at DESC');
    const projects = stmt.all();
    res.json(projects);
  });

  app.post('/api/projects', (req, res) => {
    const { type, resolution } = req.body;
    const id = Math.random().toString(36).substring(2, 9);
    const stmt = db.prepare('INSERT INTO projects (id, type, resolution, strokes, layers) VALUES (?, ?, ?, ?, ?)');
    stmt.run(id, type, resolution || 32, '[]', '[{"id":"layer-1","name":"Layer 1","visible":true,"locked":false}]');
    res.json({ id, type, resolution });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
