// routes/studentAuth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const StudentAuth = require('../models/StudentAuth');
const Student = require('../models/Student');
const rateLimit = require('express-rate-limit');

// Rate limiter for student auth
const studentAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Generate JWT for student
const generateStudentToken = (id) => {
  return jwt.sign({
    id,
    role: 'student'
  }, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: '7d'
  });
};

// Middleware to verify student token
const verifyStudentToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

    if (decoded.role !== 'student') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    const studentAuth = await StudentAuth.findById(decoded.id);

    if (!studentAuth) {
      return res.status(401).json({
        success: false,
        message: 'Student not found'
      });
    }

    req.student = studentAuth;
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
};

// ✅ Register student - REMOVED /student-auth prefix
router.post('/register', studentAuthLimiter, async (req, res) => {
  try {
    console.log('🔵 [STUDENT REGISTER] Starting...');

    const { email, password, name, usn, branch, year, semester } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and name are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log('🔍 Checking student in teacher database:', normalizedEmail);

    // Check if student exists in teacher's database
    const studentRecord = await Student.findOne({
      email: { $regex: new RegExp("^" + normalizedEmail + "$", "i") }
    });

    if (!studentRecord) {
      return res.status(403).json({
        success: false,
        message: 'This email is not in the system. Contact your teacher to be added.'
      });
    }

    // Check if already registered
    const alreadyRegistered = await StudentAuth.findOne({ email: normalizedEmail });
    if (alreadyRegistered) {
      return res.status(400).json({
        success: false,
        message: 'Account already exists. Please login.'
      });
    }

    // Create student auth record
    const studentAuth = new StudentAuth({
      email: normalizedEmail,
      password,
      name: name.trim(),
      usn: usn || studentRecord.usn,
      branch: branch || studentRecord.branch,
      year: year || studentRecord.year,
      semester: semester || studentRecord.semester,
      isVerified: true
    });

    await studentAuth.save();

    const token = generateStudentToken(studentAuth._id);
    console.log('✅ Student registered:', studentAuth.email);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      student: {
        id: studentAuth._id,
        email: studentAuth.email,
        name: studentAuth.name,
        usn: studentAuth.usn,
        branch: studentAuth.branch,
        year: studentAuth.year,
        semester: studentAuth.semester
      }
    });

  } catch (error) {
    console.error('❌ Registration error:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }))
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

// ✅ Student login - REMOVED /student-auth prefix
router.post('/login', studentAuthLimiter, async (req, res) => {
  try {
    console.log('🔵 [STUDENT LOGIN] Starting...');

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find student auth record
    const studentAuth = await StudentAuth.findOne({ email: email.toLowerCase() });

    if (!studentAuth) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials or account not found'
      });
    }

    // Check if account is locked
    if (studentAuth.isLocked()) {
      const remainingTime = Math.ceil((studentAuth.lockUntil - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account locked. Try again in ${remainingTime} minutes`
      });
    }

    // Compare password
    const isMatch = await studentAuth.comparePassword(password);

    if (!isMatch) {
      await studentAuth.incrementFailedAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Reset failed attempts
    await studentAuth.resetFailedAttempts();

    // Generate token
    const token = generateStudentToken(studentAuth._id);
    console.log('✅ Student logged in:', studentAuth.email);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      student: {
        id: studentAuth._id,
        email: studentAuth.email,
        name: studentAuth.name,
        usn: studentAuth.usn,
        branch: studentAuth.branch,
        year: studentAuth.year,
        semester: studentAuth.semester
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// ✅ Verify student token - REMOVED /student-auth prefix
router.get('/me', verifyStudentToken, async (req, res) => {
  try {
    res.json({
      success: true,
      valid: true,
      student: {
        id: req.student._id,
        email: req.student.email,
        name: req.student.name,
        usn: req.student.usn,
        branch: req.student.branch,
        year: req.student.year,
        semester: req.student.semester
      }
    });
  } catch (error) {
    console.error('❌ Token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      valid: false
    });
  }
});

// ✅ Get available quizzes for student - REMOVED /student-auth prefix
router.get('/quizzes', verifyStudentToken, async (req, res) => {
  try {
    console.log('🔵 [GET STUDENT QUIZZES] Starting...');
    const student = req.student;
    const studentEmail = student.email.toLowerCase();

    console.log('🔍 Searching quizzes for student:', studentEmail);

    const Quiz = require('../models/Quiz');
    const QuizAttempt = require('../models/QuizAttempt');

    // Find quizzes shared with this student's email
    const quizzes = await Quiz.find({
      sharedWith: {
        $elemMatch: {
          $regex: new RegExp("^" + studentEmail + "$", "i")
        }
      }
    });

    console.log('✅ Quizzes found for student:', quizzes.length);

    // Get attempt status for each quiz
    const quizzesWithStatus = await Promise.all(
      quizzes.map(async (quiz) => {
        const attempt = await QuizAttempt.findOne({
          quizId: quiz._id,
          studentEmail: studentEmail
        }).sort('-createdAt');

        return {
          id: quiz._id,
          title: quiz.title,
          description: quiz.description || '',
          duration: quiz.duration,
          totalMarks: quiz.totalMarks,
          questionCount: quiz.questions?.length || 0,
          createdAt: quiz.createdAt,
          createdBy: quiz.createdBy,
          attemptStatus: attempt ? attempt.status : 'not_started',
          attemptId: attempt?._id,
          score: attempt?.totalMarks,
          reason: attempt?.violationReason,
          percentage: attempt?.percentage,
          submittedAt: attempt?.submittedAt
        };
      })
    );

    res.json({
      success: true,
      count: quizzesWithStatus.length,
      quizzes: quizzesWithStatus
    });
  } catch (error) {
    console.error('❌ Get student quizzes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quizzes',
      error: error.message
    });
  }
});

// ✅ Debug endpoint - REMOVED /student-auth prefix
router.get('/debug/check-student/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();

    const studentRecord = await Student.findOne({
      email: { $regex: new RegExp("^" + email + "$", "i") }
    });

    const studentAuth = await StudentAuth.findOne({ email });

    res.json({
      success: true,
      email,
      existsInStudents: !!studentRecord,
      existsInStudentAuth: !!studentAuth,
      studentRecord: studentRecord || null,
      studentAuth: studentAuth ? {
        name: studentAuth.name,
        email: studentAuth.email,
        createdAt: studentAuth.createdAt
      } : null
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;