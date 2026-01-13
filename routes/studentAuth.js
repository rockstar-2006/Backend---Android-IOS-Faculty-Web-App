// routes/studentAuth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const StudentAuth = require('../models/StudentAuth');
const Student = require('../models/Student');
const rateLimit = require('express-rate-limit');
const sendEmail = require('../utils/sendEmail');
const crypto = require('crypto');

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
      console.log('❌ Student email not found in records:', normalizedEmail);
      return res.status(403).json({
        success: false,
        message: 'Your email is not registered in our records. Please ensure you are using the email provided to the faculty, or contact your teacher to be added.'
      });
    }

    console.log('✅ Student record found. Proceeding with registration.');

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

// ✅ Student login - PRE-AUTH ENABLED (Zero Friction)
router.post('/login', studentAuthLimiter, async (req, res) => {
  try {
    console.log('🔵 [STUDENT LOGIN] Processing login request...');

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Try to find existing student auth record
    let studentAuth = await StudentAuth.findOne({ email: normalizedEmail });

    // 2. If no auth record exists, check if they are in the teacher's Student list
    if (!studentAuth) {
      console.log('🔍 Student not found in Auth system, checking Teacher records:', normalizedEmail);

      const studentRecord = await Student.findOne({
        email: { $regex: new RegExp("^" + normalizedEmail + "$", "i") }
      });

      if (!studentRecord) {
        return res.status(401).json({
          success: false,
          message: 'Access Denied: Your email is not in the system. Please contact your faculty.'
        });
      }

      // If they are in the record, check if they are using their USN as the initial password
      if (password.toUpperCase() === studentRecord.usn.toUpperCase()) {
        console.log('✨ [PRE-AUTH] USN match found. Auto-creating Auth record for:', normalizedEmail);

        studentAuth = new StudentAuth({
          email: normalizedEmail,
          password: password, // This will be hashed by pre-save middleware
          name: studentRecord.name,
          usn: studentRecord.usn,
          branch: studentRecord.branch,
          year: studentRecord.year,
          semester: studentRecord.semester,
          isVerified: true
        });

        await studentAuth.save();
      } else {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. If this is your first login, use your USN as the password.'
        });
      }
    } else {
      // 3. Existing auth record found, check password normally

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
        // Fallback: Check if they are trying to use USN even after having an account
        // (This helps students who forgot they changed their password)
        if (password.toUpperCase() === studentAuth.usn.toUpperCase()) {
          // If they use USN and it's their current password (unlikely if changed, but possible)
          // If they changed it but forgot, we should probably force them to use forgot password
        }

        await studentAuth.incrementFailedAttempts();
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }
    }

    // 4. Reset failed attempts and prepare token
    await studentAuth.resetFailedAttempts();

    const token = generateStudentToken(studentAuth._id);
    console.log('✅ Student session established:', studentAuth.email);

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
      message: 'Processing failed',
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

// ✅ Forgot Password - Student
router.post('/forgot-password', async (req, res) => {
  try {
    const student = await StudentAuth.findOne({ email: req.body.email.toLowerCase() });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found with this email' });
    }

    // Get reset token
    const resetToken = student.createPasswordResetToken();

    await student.save({ validateBeforeSave: false });

    // Create reset URL
    const resetUrl = `${req.headers.origin || process.env.FRONTEND_URL}/student/reset-password/${resetToken}`;

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password for your Student account. Please click the link below: \n\n ${resetUrl}`;

    try {
      await sendEmail({
        email: student.email,
        subject: 'Student Password Reset',
        message,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #6366f1;">Student Password Reset</h2>
            <p>You requested a password reset for your Student account on Faculty Quest.</p>
            <p>Please click the button below to reset your password. This link is valid for 10 minutes.</p>
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0;">Reset Password</a>
            <p>If you did not request this, please ignore this email.</p>
          </div>
        `
      });

      res.status(200).json({ success: true, message: 'Reset email sent successfully' });
    } catch (err) {
      console.error(err);
      student.resetPasswordToken = undefined;
      student.resetPasswordExpire = undefined;
      await student.save({ validateBeforeSave: false });

      return res.status(500).json({ success: false, message: 'Email could not be sent' });
    }
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ✅ Reset Password - Student
router.put('/reset-password/:resetToken', async (req, res) => {
  try {
    // Get hashed token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.resetToken)
      .digest('hex');

    const student = await StudentAuth.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!student) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    // Set new password
    student.password = req.body.password;
    student.resetPasswordToken = undefined;
    student.resetPasswordExpire = undefined;
    await student.save();

    res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ✅ Update Password - Student (Logged in)
router.put('/update-password', verifyStudentToken, async (req, res) => {
  try {
    const student = await StudentAuth.findById(req.student.id);

    // Check current password
    if (!(await student.comparePassword(req.body.currentPassword))) {
      return res.status(401).json({ success: false, message: 'Incorrect current password' });
    }

    student.password = req.body.newPassword;
    await student.save();

    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;