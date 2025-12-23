const express = require('express');
const jwt = require('jsonwebtoken');
const StudentAuth = require('../models/StudentAuth');
const router = express.Router();

// Student registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, usn, branch, year, semester } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and name are required'
      });
    }
    
    // Check if student already exists
    const existingStudent = await StudentAuth.findOne({ 
      email: email.toLowerCase() 
    });
    
    if (existingStudent) {
      return res.status(400).json({
        success: false,
        message: 'Student already registered'
      });
    }
    
    // Create new student
    const student = new StudentAuth({
      email: email.toLowerCase(),
      password: password,
      name: name.trim(),
      usn: usn ? usn.trim().toUpperCase() : '',
      branch: branch ? branch.trim() : '',
      year: year ? year.toString() : '',
      semester: semester ? semester.toString() : '',
      isVerified: true // Auto-verify for now
    });
    
    await student.save();
    
    // Generate JWT token
    const token = jwt.sign(
      {
        studentId: student._id,
        email: student.email,
        role: 'student'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );
    
    res.json({
      success: true,
      message: 'Registration successful',
      token: token,
      student: {
        id: student._id,
        email: student.email,
        name: student.name,
        usn: student.usn,
        branch: student.branch,
        year: student.year,
        semester: student.semester
      }
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

// Student login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find student
    const student = await StudentAuth.findOne({ 
      email: email.toLowerCase() 
    });
    
    if (!student) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Check if account is locked
    if (student.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account is locked. Try again later.'
      });
    }
    
    // Check password
    const isPasswordValid = await student.comparePassword(password);
    
    if (!isPasswordValid) {
      // Increment failed attempts
      await student.incrementFailedAttempts();
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Reset failed attempts on successful login
    await student.resetFailedAttempts();
    
    // Generate JWT token
    const token = jwt.sign(
      {
        studentId: student._id,
        email: student.email,
        role: 'student'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );
    
    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      student: {
        id: student._id,
        email: student.email,
        name: student.name,
        usn: student.usn,
        branch: student.branch,
        year: student.year,
        semester: student.semester
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

// Get student profile
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    if (decoded.role !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    const student = await StudentAuth.findById(decoded.studentId);
    
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }
    
    res.json({
      success: true,
      student: {
        id: student._id,
        email: student.email,
        name: student.name,
        usn: student.usn,
        branch: student.branch,
        year: student.year,
        semester: student.semester
      }
    });
    
  } catch (error) {
    console.error('❌ Get profile error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
});

module.exports = router;