const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quiz');
const folderRoutes = require('./routes/folder');
const bookmarkRoutes = require('./routes/bookmark');
const studentRoutes = require('./routes/student');
const studentQuizRoutes = require('./routes/studentQuiz');
const studentAuthRoutes = require('./routes/studentAuth');
const studentAuthQuizRoutes = require('./routes/studentAuthQuiz');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { createIndexes } = require('./config/dbIndexes');

const app = express();

/* =========================
   CORS CONFIG
========================= */
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost:3000',
  'http://localhost:4200',
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isAllowed = allowedOrigins.some(allowed => {
        if (!allowed) return false;
        const cleanAllowed = allowed.replace(/\/$/, "");
        const cleanOrigin = origin.replace(/\/$/, "");
        return cleanOrigin === cleanAllowed || cleanOrigin.startsWith(cleanAllowed);
      });
      const isLocalIP = /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin);
      if (isAllowed || isLocalIP) return callback(null, true);
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  })
);

app.options('*', cors());

/* =========================
   MIDDLEWARE
========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
  console.log(`📦 ${req.method} ${req.originalUrl}`);
  next();
});

/* =========================
   PRODUCTION DATABASE CONFIG
========================= */
let lastDbError = null;
let cachedConnection = global.mongoose;

if (!cachedConnection) {
  cachedConnection = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cachedConnection.conn) {
    return cachedConnection.conn;
  }

  if (!cachedConnection.promise) {
    const rawUri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quiz_app').trim();
    const opts = {
      bufferCommands: false,
      maxPoolSize: 100,      // Scale for 1000+ users
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      family: 4,             // IPv4 Preference for performance
    };

    console.log('🚀 Establishing Production Connection...');
    cachedConnection.promise = mongoose.connect(rawUri, opts).then((mongooseInstance) => {
      console.log('✅ Production Database Connected');
      lastDbError = null;
      // Re-index on new connection
      createIndexes().catch(e => console.error('Index error:', e));
      return mongooseInstance;
    });
  }

  try {
    cachedConnection.conn = await cachedConnection.promise;
  } catch (e) {
    cachedConnection.promise = null;
    lastDbError = e.message;
    console.error('❌ Connection Error:', e.message);
    throw e;
  }

  return cachedConnection.conn;
};

// Start background connection
connectDB().catch(() => { });

/* =========================
   PROTECTION MIDDLEWARE
========================= */
const ensureDb = async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }
    next();
  } catch (err) {
    res.status(503).json({
      success: false,
      message: 'Server Warming Up',
      error: 'Establishing secure connection. Please retry in 3 seconds.'
    });
  }
};

/* =========================
   ROUTES
========================= */
app.use('/api', ensureDb); // Apply to all API routes

app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/student-quiz', studentQuizRoutes);

app.use('/api/student', studentAuthRoutes);
app.use('/api/student', studentAuthQuizRoutes);

// Fast Health Check
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  res.json({
    status: 'OK',
    database: {
      status: dbStatus === 1 ? 'connected' : 'connecting',
      readyState: dbStatus,
      error: lastDbError
    }
  });
});

// Root route
app.get('/', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    try { await connectDB(); } catch (e) { }
  }

  const dbState = mongoose.connection.readyState;
  const statusClass = dbState === 1 ? 'online' : 'offline';
  const statusText = dbState === 1 ? 'Connected' : 'Connecting...';

  res.send(`
    <html>
      <head>
        <title>SmartQuiz AI Backend</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f0f2f5; }
          .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
          h1 { color: #1a73e8; }
          .status { display: inline-block; padding: 10px 24px; border-radius: 20px; font-weight: bold; margin: 15px 0; font-size: 1.1rem; }
          .online { background: #e6f4ea; color: #1e8e3e; }
          .offline { background: #fce8e6; color: #d93025; }
          .btn { display: inline-block; margin-top: 1rem; color: #1a73e8; text-decoration: none; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🚀 SmartQuiz AI Backend</h1>
          <p>Production Environment Live</p>
          <div class="status ${statusClass}">Database: ${statusText}</div>
          <p><small>API Base: <code>/api</code></small></p>
          <a href="/api/health" class="btn">View JSON Health Check</a>
        </div>
      </body>
    </html>
  `);
});

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
module.exports = app;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}