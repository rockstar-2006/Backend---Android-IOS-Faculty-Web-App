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
        return origin === allowed || origin.startsWith(allowed);
      });

      // Allow common local network IPs for development
      const isLocalIP = /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin);

      if (isAllowed || isLocalIP || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.error('❌ CORS BLOCKED:', origin);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quiz_app')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await createIndexes();
  })
  .catch((err) => console.error('❌ MongoDB error:', err));

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
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend reachable',
    port: process.env.PORT || 3001,
    time: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Test endpoint for students
app.get('/api/students/test', (req, res) => {
  console.log('🔵 Student test endpoint called');
  res.json({
    status: 'success',
    message: 'Student routes are working',
    endpoints: {
      getAll: '/api/students/all',
      addSingle: '/api/students/add',
      uploadBulk: '/api/students/upload',
      update: '/api/students/:id',
      delete: '/api/students/:id'
    }
  });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
  console.log('🔵 Debug endpoint called from:', req.ip);
  res.json({
    status: 'debug',
    server: {
      port: process.env.PORT || 3001,
      nodeVersion: process.version
    },
    client: {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    },
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    endpoints: {
      teacherAuth: '/api/auth',
      studentManagement: '/api/students', // ✅ This is for teacher to manage students
      studentAuth: '/api/student', // ✅ This is for student login/register
      studentQuiz: '/api/student/quiz' // ✅ This is for student quiz operations
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

app.listen(PORT, HOST, () => {
  console.log(`=================================`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`=================================`);
  console.log(`🌐 Local: http://localhost:${PORT}`);
  console.log(`🔧 Health: /api/health`);
  console.log(`🔧 Debug: /api/debug`);
  console.log(`📚 Available routes:`);
  console.log(`   Teacher Auth: /api/auth`);
  console.log(`   Teacher Quiz: /api/quiz`);
  console.log(`   Student Management: /api/students (add, update, delete, upload)`);
  console.log(`   Student Auth: /api/student (login, register, me)`);
  console.log(`   Student Quiz: /api/student/quiz (start, submit, results)`);
  console.log(`=================================`);
});