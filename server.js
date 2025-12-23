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
].filter(Boolean); // Filter out undefined if env vars aren't set

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      const isAllowed = allowedOrigins.some(allowed => {
        if (!allowed) return false;
        // Clean both URLs for comparison (remove trailing slashes)
        const cleanAllowed = allowed.replace(/\/$/, "");
        const cleanOrigin = origin.replace(/\/$/, "");
        return cleanOrigin === cleanAllowed || cleanOrigin.startsWith(cleanAllowed);
      });

      // Allow common local network IPs for development
      const isLocalIP = /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin);

      if (isAllowed || isLocalIP) {
        return callback(null, true);
      }

      console.error('❌ CORS BLOCKED:', origin);
      // Still allow but log error - better for debugging
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

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📦 ${req.method} ${req.originalUrl}`);
  next();
});

/* =========================
   DATABASE
========================= */
let lastDbError = null;
let cachedDb = null;

const connectDB = async () => {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  const uri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quiz_app').trim();

  // LOGGING FOR DEBUGGING
  console.log('--- DATABASE CONNECTION ATTEMPT ---');
  console.log('URI Length:', uri.length);
  console.log('URI Prefix:', uri.substring(0, 20));
  console.log('Replica Set:', uri.includes('replicaSet'));
  console.log('--- END LOGGING ---');

  try {
    const opts = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
    };



    console.log('Connecting to MongoDB...');
    const db = await mongoose.connect(uri, opts);
    console.log('✅ MongoDB connected successfully to:', db.connection.name);
    lastDbError = null;
    cachedDb = db;
    await createIndexes();
    return db;
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    const host = uri.split('@')[1] ? uri.split('@')[1].split('/')[0] : 'unknown';
    const prefix = uri.substring(0, 15);
    lastDbError = `${err.message} (Cluster: ${host}) (URI Prefix: "${prefix}")`;
    cachedDb = null;
  }



};

// Start connection but don't block
connectDB();


/* =========================
   ROUTES - WITH CORRECT MOUNTING
========================= */
app.use('/api/auth', authRoutes); // Teacher auth
app.use('/api/quiz', quizRoutes); // Teacher quiz management
app.use('/api/folders', folderRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/students', studentRoutes); // Teacher student management - THIS IS THE IMPORTANT ONE
app.use('/api/student-quiz', studentQuizRoutes); // Teacher view of student quizzes

// ✅ Student routes - Mounted correctly
app.use('/api/student', studentAuthRoutes); // This will create /api/student/login
app.use('/api/student', studentAuthQuizRoutes); // This will create /api/student/quiz/*

// Health check
app.get('/api/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const statusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  let outgoingIp = 'checking...';
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json');
    const ipData = await ipRes.json();
    outgoingIp = ipData.ip;
  } catch (e) {
    outgoingIp = 'failed to detect';
  }

  res.json({
    status: 'OK',
    message: 'Backend reachable',
    time: new Date().toISOString(),
    database: {
      status: statusMap[dbStatus] || 'unknown',
      readyState: dbStatus,
      envDefined: !!process.env.MONGODB_URI,
      uriLength: process.env.MONGODB_URI ? process.env.MONGODB_URI.length : 0,
      error: lastDbError
    },
    network: {
      outgoingIp: outgoingIp,
      vercel: !!process.env.VERCEL
    }
  });
});



// Root route
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>SmartQuiz AI Backend</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f0f2f5; }
          .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
          h1 { color: #1a73e8; }
          p { color: #5f6368; line-height: 1.5; }
          .status { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; margin: 10px 0; }
          .online { background: #e6f4ea; color: #1e8e3e; }
          .offline { background: #fce8e6; color: #d93025; }
          code { background: #f1f3f4; padding: 2px 4px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🚀 SmartQuiz AI Backend</h1>
          <p>The backend is running successfully on Vercel.</p>
          
          <div class="status ${mongoose.connection.readyState === 1 ? 'online' : 'offline'}">
            Database: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}
          </div>

          ${mongoose.connection.readyState !== 1 ? `
            <p style="color: #d93025; font-size: 0.9rem;">
              ⚠️ <strong>Action Required:</strong> Check if <code>MONGODB_URI</code> is set in Vercel.
            </p>
          ` : ''}
          
          <p style="margin-top: 1rem;"><small>API Base: <code>/api</code></small></p>
        </div>
      </body>
    </html>
  `);
});


// Test endpoint for students
app.get('/api/students/test', (req, res) => {
  console.log('🔵 Student test endpoint called');
  res.json({
    status: 'success',
    message: 'Student routes are working'
  });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
  res.json({
    status: 'debug',
    server: {
      nodeVersion: process.version,
      vercel: !!process.env.VERCEL
    },
    database: {
      status: mongoose.connection.readyState,
      isDefined: !!process.env.MONGODB_URI,
      uriPrefix: process.env.MONGODB_URI ? process.env.MONGODB_URI.split(':')[0] : 'none'
    }
  });
});


// Error handlers
app.use(notFound);
app.use(errorHandler);

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

// Export app for Vercel
module.exports = app;

// Only listen if not running as a Vercel function
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`=================================`);
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`=================================`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
    console.log(`🔧 Health: /api/health`);
    console.log(`🔧 Debug: /api/debug`);
    console.log(`=================================`);
  });
}