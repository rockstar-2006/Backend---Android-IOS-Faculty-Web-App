const jwt = require('jsonwebtoken');
const StudentAuth = require('../models/StudentAuth');

const protectStudent = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'student') {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    const student = await StudentAuth.findById(decoded.id).select('-password');

    if (!student) {
      return res.status(401).json({ message: 'Student not found' });
    }

    if (student.isLocked()) {
      return res.status(423).json({ message: 'Account is locked' });
    }

    req.student = student;
    next();
  } catch (error) {
    console.error('Student auth middleware error:', error);
    res.status(401).json({ message: 'Not authorized, token invalid' });
  }
};

module.exports = { protectStudent };
