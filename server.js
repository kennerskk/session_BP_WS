
import express from 'express';
import { Sequelize } from 'sequelize';
import cors from 'cors';
import dotenv from 'dotenv';
import expressWs from 'express-ws'; // Added express-ws
import statRoutes from './routes/statRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import { initStatModel } from './models/stat_schema.js';
import { initSessionModel } from './models/session_schema.js';

dotenv.config();

const app = express();
expressWs(app);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_DEPLOY_URL,
].filter(Boolean);

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
});

// init db models
initStatModel(sequelize);
initSessionModel(sequelize);

const clients = new Set(); 

app.ws("/data", (ws) => {
  console.log("Python client connected");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      for (const c of clients) {
        if (c.readyState === 1) c.send(JSON.stringify(data));
      }
    } catch (e) {
      console.error("Invalid message:", e);
    }
  });

  ws.on("close", () => console.log("Python client disconnected"));
});

app.ws("/readdata", (ws) => {
  clients.add(ws);
  console.log("Dashboard client connected")
  ws.on("close", () => clients.delete(ws));
});

app.use('/api/stat', statRoutes);
app.use('/api/session', sessionRoutes);
app.get('/', (req, res) => res.json({ status: 'ok' }));

(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  app.listen(PORT, () => console.log(`running on http://localhost:${PORT}`));
})();
