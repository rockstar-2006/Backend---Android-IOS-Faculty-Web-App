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

// ✅ Student login - NEW: Guides password setup first
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
    console.log('🔍 [STUDENT LOGIN] Normalized Email:', normalizedEmail);
    console.log('🔍 [STUDENT LOGIN] Provided Password (might be USN):', password);

    // 1. Try to find existing student auth record
    let studentAuth = await StudentAuth.findOne({ email: normalizedEmail });
    console.log('🔍 [STUDENT LOGIN] Existing StudentAuth record found:', !!studentAuth);

    // 2. If no auth record exists, check if they are in the teacher's Student list
    if (!studentAuth) {
      console.log('🔍 [STUDENT LOGIN] No Auth record. Searching Student collection for:', normalizedEmail);

      const studentRecord = await Student.findOne({
        email: { $regex: new RegExp("^" + normalizedEmail + "$", "i") }
      });

      if (!studentRecord) {
        console.log('❌ [STUDENT LOGIN] Student email NOT found in Teacher records:', normalizedEmail);
        return res.status(401).json({
          success: false,
          message: 'Access Denied: Your email is not in the system. Please ensure you are using the email provided to the faculty, or contact your teacher to be added.'
        });
      }

      console.log('✅ [STUDENT LOGIN] Student record found in Teacher database. USN in record:', studentRecord.usn);

      // 🔐 NEW: Allow login with USN as default password (case-insensitive & trimmed)
      const providedUSN = password.toString().trim().toUpperCase();
      const dbUSN = studentRecord.usn.toString().trim().toUpperCase();

      if (providedUSN !== dbUSN) {
        console.log(`❌ [STUDENT LOGIN] USN mismatch. Provided: "${providedUSN}", DB: "${dbUSN}"`);
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. For your first login, please use your USN as the password provided by your teacher.',
          requiresUSN: true
        });
      }

      console.log('✅ [STUDENT LOGIN] First login with USN successful. Creating new StudentAuth for:', normalizedEmail);
      
      // Create student auth record automatically
      studentAuth = new StudentAuth({
        email: normalizedEmail,
        password: password, // This will be USN, and will be hashed by pre-save hook
        name: studentRecord.name,
        usn: studentRecord.usn,
        branch: studentRecord.branch,
        year: studentRecord.year,
        semester: studentRecord.semester,
        isVerified: true
      });

      await studentAuth.save();
    } else {
      // 3. Existing auth record found, check password normally
      console.log('🔍 [STUDENT LOGIN] Auth record found. Verifying password for:', normalizedEmail);

      // Check if account is locked
      if (studentAuth.isLocked()) {
        const remainingTime = Math.ceil((studentAuth.lockUntil - Date.now()) / 60000);
        console.log('❌ [STUDENT LOGIN] Account is currently locked for:', normalizedEmail);
        return res.status(423).json({
          success: false,
          message: `Account locked. Try again in ${remainingTime} minutes`
        });
      }

      // Compare password
      let isMatch = await studentAuth.comparePassword(password);
      console.log('🔍 [STUDENT LOGIN] Normal password match result:', isMatch);

      // 🔐 ALSO: Allow login with USN anytime (as per user request)
      const providedFallbackUSN = password.toString().trim().toUpperCase();
      const dbFallbackUSN = studentAuth.usn.toString().trim().toUpperCase();

      if (!isMatch && providedFallbackUSN === dbFallbackUSN) {
        console.log('✅ [STUDENT LOGIN] Login with USN fallback successful for existing student:', normalizedEmail);
        isMatch = true;
      }

      if (!isMatch) {
        console.log('❌ [STUDENT LOGIN] ALL password attempts failed for:', normalizedEmail);
        await studentAuth.incrementFailedAttempts();
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Use your password or your USN.'
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

        // Map attempt status to display status
        let displayStatus = 'available';  // Default for no attempts
        let attemptStatus = 'not_started';

        if (attempt) {
          attemptStatus = attempt.status;

          // EXPLICIT status mapping (no 'active' status - either available, completed, or disqualified)
          if (attempt.status === 'submitted' || attempt.status === 'graded') {
            displayStatus = 'completed';  // Quiz completed/graded - show in Completed tab
          } else if (attempt.status === 'blocked' || attempt.status === 'expired') {
            displayStatus = 'disqualified'; // Quiz blocked/failed - show in Blocked tab
          } else if (attempt.status === 'started' || attempt.status === 'in-progress') {
            // If quiz is started but not submitted yet - don't show in AVAILABLE
            // Instead, treat it as disqualified/blocked so it doesn't appear in available
            displayStatus = 'in-progress';
          } else {
            // Any other status: not available for new attempt
            displayStatus = 'disqualified';
          }
        }

        console.log(`   Quiz: ${quiz.title} | Attempt Status: ${attemptStatus} | Display Status: ${displayStatus}`);

        return {
          id: quiz._id,
          title: quiz.title,
          description: quiz.description || '',
          duration: quiz.duration,
          totalMarks: quiz.totalMarks,
          questionCount: quiz.questions?.length || 0,
          createdAt: quiz.createdAt,
          createdBy: quiz.createdBy,
          status: displayStatus,  // PRIMARY STATUS FOR FRONTEND CATEGORIZATION
          attemptStatus: attemptStatus,  // Detailed status 
          passingGrade: quiz.passingGrade || 40,  // 🔒 Dynamic passing grade from quiz config
          attemptId: attempt?._id,
          score: attempt?.totalMarks,
          reason: attempt?.violationReason,
          percentage: attempt?.percentage,
          submittedAt: attempt?.submittedAt,
          result: attempt && (attempt.status === 'submitted' || attempt.status === 'graded') ? {
            score: attempt.totalMarks,
            totalQuestions: quiz.questions?.length || 0,
            percentage: attempt.percentage,
            isPassed: (attempt.percentage || 0) >= (quiz.passingGrade || 40)  // 🔒 Use quiz passing grade
          } : null
        };
      })
    );

    res.json({
      success: true,
      count: quizzesWithStatus.length,
      data: quizzesWithStatus,
      quizzes: quizzesWithStatus  // Support both response formats
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

// 🔒 NEW: Request OTP for password setup (students who haven't set password yet)
router.post('/request-setup-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find student auth record
    let studentAuth = await StudentAuth.findOne({ email: normalizedEmail });

    if (!studentAuth) {
      // Not in system yet - check Student collection
      const Student = require('../models/Student');
      const studentRecord = await Student.findOne({
        email: { $regex: new RegExp(`^${normalizedEmail}$`, 'i') }
      });

      if (!studentRecord) {
        return res.status(404).json({
          success: false,
          message: 'Email not found in the system. Please contact your faculty.'
        });
      }

      // Create new StudentAuth record
      studentAuth = new StudentAuth({
        email: normalizedEmail,
        name: studentRecord.name,
        usn: studentRecord.usn,
        branch: studentRecord.branch,
        year: studentRecord.year,
        semester: studentRecord.semester,
        password: 'temp_' + Math.random().toString(36)  // Temporary, will be changed
      });

      await studentAuth.save();
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpireTime = new Date(Date.now() + 10 * 60 * 1000);  // 10 minutes

    studentAuth.passwordSetupOTP = otp;
    studentAuth.passwordSetupOTPExpire = otpExpireTime;
    studentAuth.passwordSetupOTPEmail = normalizedEmail;
    studentAuth.passwordSetupAttempts = 0;

    await studentAuth.save();

    // 📧 Send OTP email
    try {
      const emailService = require('../services/emailService');
      await emailService.sendPasswordSetupOTP(normalizedEmail, otp, studentAuth.name || 'Student');
      console.log(`✅ [OTP SENT] Email: ${normalizedEmail}, OTP: ${otp}`);
    } catch (emailError) {
      console.error('⚠️ Email send failed:', emailError);
      // Still allow OTP but with console fallback
    }

    res.json({
      success: true,
      message: 'OTP sent to your email. Valid for 10 minutes.',
      email: normalizedEmail
    });

  } catch (error) {
    console.error('❌ Request OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: error.message
    });
  }
});

// 🔒 NEW: Verify OTP and set password
router.post('/verify-setup-otp', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, OTP, and new password are required'
      });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain uppercase, lowercase, and number'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find student auth record
    const studentAuth = await StudentAuth.findOne({
      email: normalizedEmail,
      passwordSetupOTP: otp
    });

    if (!studentAuth) {
      return res.status(401).json({
        success: false,
        message: 'Invalid OTP or email'
      });
    }

    // Check OTP expiry
    if (!studentAuth.passwordSetupOTPExpire || studentAuth.passwordSetupOTPExpire < Date.now()) {
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Request a new one.'
      });
    }

    // Check attempt limit
    if ((studentAuth.passwordSetupAttempts || 0) >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Too many attempts. Request a new OTP.'
      });
    }

    // Update password and mark as verified
    studentAuth.password = newPassword;
    studentAuth.isVerified = true;
    studentAuth.passwordSetupOTP = undefined;
    studentAuth.passwordSetupOTPExpire = undefined;
    studentAuth.passwordSetupAttempts = 0;

    await studentAuth.save();

    res.json({
      success: true,
      message: 'Password set successfully! You can now login.'
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: error.message
    });
  }
});

module.exports = router;