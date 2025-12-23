const express = require('express');
const Student = require('../models/Student');
const { protect } = require('../middleware/auth');

const router = express.Router();

console.log('📚 Student routes loaded');

// Add logging middleware
router.use((req, res, next) => {
  console.log(`[STUDENT API] ${req.method} ${req.originalUrl}`);
  next();
});

// Get all students
router.get('/all', protect, async (req, res) => {
  console.log('GET /all called for user:', req.user._id);
  try {
    const students = await Student.find({ userId: req.user._id }).sort('-createdAt');
    res.json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(400).json({ message: error.message });
  }
});

// Upload students
router.post('/upload', protect, async (req, res) => {
  console.log('POST /upload called with data count:', req.body.students?.length);
  try {
    const { students } = req.body;

    if (!students || !Array.isArray(students)) {
      return res.status(400).json({ message: 'Invalid students data' });
    }

    // Use bulkWrite for high-speed upserts (Update or Insert)
    const operations = students.map(student => ({
      updateOne: {
        filter: {
          usn: student.usn,
          userId: req.user._id
        },
        update: {
          $set: {
            name: student.name,
            email: student.email,
            branch: student.branch,
            year: student.year,
            semester: student.semester,
            userId: req.user._id
          }
        },
        upsert: true
      }
    }));

    await Student.bulkWrite(operations);

    res.json({ success: true, count: students.length });
  } catch (error) {
    console.error('Error uploading students:', error);
    res.status(400).json({ message: error.message });
  }
});

// Add single student
router.post('/add', protect, async (req, res) => {
  console.log('POST /add called with:', req.body);
  try {
    const { name, usn, email, branch, year, semester } = req.body;

    // Validate required fields
    if (!name || !usn || !email || !branch || !year || !semester) {
      return res.status(400).json({
        message: 'All fields are required: name, usn, email, branch, year, semester'
      });
    }

    // Check if student with same USN or email already exists
    const existingStudent = await Student.findOne({
      $or: [
        { usn, userId: req.user._id },
        { email, userId: req.user._id }
      ]
    });

    if (existingStudent) {
      return res.status(400).json({
        message: existingStudent.usn === usn
          ? 'Student with this USN already exists'
          : 'Student with this email already exists'
      });
    }

    const student = new Student({
      name,
      usn,
      email,
      branch,
      year,
      semester,
      userId: req.user._id
    });

    await student.save();

    console.log('Student created:', student._id);
    res.json({ success: true, student });
  } catch (error) {
    console.error('Error adding student:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update student
router.put('/:id', protect, async (req, res) => {
  console.log('PUT /:id called for student:', req.params.id, 'data:', req.body);
  try {
    const { name, usn, email, branch, year, semester } = req.body;

    // Check if another student with same USN or email exists (excluding current student)
    const existingStudent = await Student.findOne({
      $and: [
        { _id: { $ne: req.params.id } },
        { userId: req.user._id },
        { $or: [{ usn }, { email }] }
      ]
    });

    if (existingStudent) {
      return res.status(400).json({
        message: existingStudent.usn === usn
          ? 'Another student with this USN already exists'
          : 'Another student with this email already exists'
      });
    }

    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { name, usn, email, branch, year, semester },
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json({ success: true, student });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get single student
router.get('/:id', protect, async (req, res) => {
  console.log('GET /:id called for student:', req.params.id);
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json(student);
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete student
router.delete('/:id', protect, async (req, res) => {
  console.log('DELETE /:id called for student:', req.params.id);
  try {
    const student = await Student.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json({ success: true, message: 'Student deleted' });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete multiple students
router.post('/delete-multiple', protect, async (req, res) => {
  console.log('POST /delete-multiple called with IDs:', req.body.studentIds);
  try {
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds)) {
      return res.status(400).json({ message: 'Invalid student IDs' });
    }

    const result = await Student.deleteMany({
      _id: { $in: studentIds },
      userId: req.user._id
    });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} students`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting multiple students:', error);
    res.status(400).json({ message: error.message });
  }
});

// Debug endpoint to list all routes
router.get('/debug/routes', (req, res) => {
  const routes = router.stack
    .filter(r => r.route)
    .map(r => ({
      path: r.route.path,
      method: Object.keys(r.route.methods)[0],
      fullPath: `/api/students${r.route.path}`
    }));

  res.json({
    message: 'Available student routes',
    count: routes.length,
    routes: routes,
    basePath: '/api/students'
  });
});

module.exports = router;