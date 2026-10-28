const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const Student = require('../models/Student');
const StudentAuth = require('../models/StudentAuth');
const Folder = require('../models/Folder');
const Bookmark = require('../models/Bookmark');
const { protect } = require('../middleware/auth');
const quizCache = require('../utils/quizCache');

// 🔒 Admin Protection Middleware
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Super Admin privileges required'
      });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Admin verification error', error: err.message });
  }
};

router.use(protect);
router.use(requireAdmin);

// 📊 1. System Overview Metrics
router.get('/stats', async (req, res) => {
  try {
    const [
      totalFaculty,
      totalQuizzes,
      totalAttempts,
      totalStudents,
      recentAttempts
    ] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      Quiz.countDocuments(),
      QuizAttempt.countDocuments(),
      StudentAuth.countDocuments(),
      QuizAttempt.find().sort({ createdAt: -1 }).limit(10).lean()
    ]);

    res.json({
      success: true,
      data: {
        totalFaculty,
        totalQuizzes,
        totalAttempts,
        totalStudents,
        recentAttempts
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve stats', error: error.message });
  }
});

// 👥 2. Get All Faculty Accounts with their Quizzes AND Enrolled Students
router.get('/faculty', async (req, res) => {
  try {
    const faculty = await User.find({ role: { $ne: 'admin' } })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    // Attach quizzes and all associated students (roster, exam takers, sharedWith)
    const enhanced = await Promise.all(
      faculty.map(async (f) => {
        try {
          const fId = f._id;
          const fIdStr = f._id.toString();

          const quizzes = await Quiz.find({
            $or: [
              { userId: fId },
              { createdBy: fIdStr },
              { createdBy: f.name },
              { createdBy: f.email }
            ]
          }).select('title totalMarks duration questions sharedWith createdAt isPublished').lean();

          const quizIds = quizzes.map(q => q._id);

          // Check roster students safely using ObjectId only (avoid CastError on string emails)
          let rosterQuery = { userId: fId };
          if (faculty.length === 1) {
            rosterQuery = {
              $or: [
                { userId: fId },
                { userId: null },
                { userId: { $exists: false } }
              ]
            };
          }

          const attemptConditions = [{ teacherId: fId }];
          if (quizIds.length > 0) {
            attemptConditions.push({ quizId: { $in: quizIds } });
          }

          const [rosterStudents, attempts] = await Promise.all([
            Student.find(rosterQuery).lean(),
            QuizAttempt.find({ $or: attemptConditions })
              .select('studentName studentEmail studentUSN studentBranch score percentage totalMarks quizId createdAt')
              .lean()
          ]);

          // Merge roster students, exam attempt students, and sharedWith students
          const studentMap = new Map();

          // 1. Roster students
          (rosterStudents || []).forEach(st => {
            const key = (st.usn || st.email || st._id.toString()).toUpperCase();
            studentMap.set(key, {
              _id: st._id,
              name: st.name,
              usn: st.usn || 'N/A',
              email: st.email || 'N/A',
              branch: st.branch || 'General',
              semester: st.semester,
              source: 'Roster Upload',
              attemptsCount: 0
            });
          });

          // 2. Exam attempts students
          (attempts || []).forEach(att => {
            const key = (att.studentUSN || att.studentEmail || att._id.toString()).toUpperCase();
            if (studentMap.has(key)) {
              const existing = studentMap.get(key);
              existing.attemptsCount = (existing.attemptsCount || 0) + 1;
              if ((!existing.branch || existing.branch === 'General') && att.studentBranch) {
                existing.branch = att.studentBranch;
              }
            } else {
              studentMap.set(key, {
                _id: att._id,
                name: att.studentName || 'Student',
                usn: att.studentUSN || 'N/A',
                email: att.studentEmail || 'N/A',
                branch: att.studentBranch || 'General',
                source: 'Exam Taker',
                attemptsCount: 1
              });
            }
          });

          // 3. Quizzes sharedWith list
          (quizzes || []).forEach(q => {
            if (Array.isArray(q.sharedWith)) {
              q.sharedWith.forEach(idStr => {
                if (!idStr) return;
                const key = idStr.trim().toUpperCase();
                if (!studentMap.has(key)) {
                  studentMap.set(key, {
                    _id: idStr,
                    name: idStr.includes('@') ? idStr.split('@')[0] : idStr,
                    usn: idStr.includes('@') ? 'N/A' : idStr,
                    email: idStr.includes('@') ? idStr : 'N/A',
                    branch: 'Assigned',
                    source: 'Assigned in Quiz',
                    attemptsCount: 0
                  });
                }
              });
            }
          });

          // 4. Fallback for single faculty setup: if studentMap is empty, associate all platform students
          if (studentMap.size === 0 && faculty.length === 1) {
            const allAuth = await StudentAuth.find().select('-password -passwordSetupOTP').lean();
            allAuth.forEach(st => {
              const key = (st.usn || st.email || st._id.toString()).toUpperCase();
              studentMap.set(key, {
                _id: st._id,
                authId: st._id.toString(),
                name: st.name,
                usn: st.usn || 'N/A',
                email: st.email || 'N/A',
                branch: st.branch || 'General',
                semester: st.semester,
                source: 'Registered Student',
                attemptsCount: 0
              });
            });
          }

          // Find auth accounts for these students safely
          if (studentMap.size > 0) {
            const emails = Array.from(studentMap.values())
              .map(s => s.email?.toLowerCase())
              .filter(e => e && e !== 'n/a' && e.includes('@'));
            const usns = Array.from(studentMap.values())
              .map(s => s.usn?.toUpperCase())
              .filter(u => u && u !== 'n/a');

            const orConditions = [];
            if (emails.length > 0) orConditions.push({ email: { $in: emails } });
            if (usns.length > 0) orConditions.push({ usn: { $in: usns } });

            if (orConditions.length > 0) {
              const authAccounts = await StudentAuth.find({ $or: orConditions })
                .select('_id email usn')
                .lean();

              const authByEmail = new Map();
              const authByUsn = new Map();
              authAccounts.forEach(a => {
                if (a.email) authByEmail.set(a.email.toLowerCase(), a._id.toString());
                if (a.usn) authByUsn.set(a.usn.toUpperCase(), a._id.toString());
              });

              studentMap.forEach(st => {
                if (!st.authId) {
                  const matchedAuthId = (st.email && authByEmail.get(st.email.toLowerCase())) ||
                                        (st.usn && authByUsn.get(st.usn.toUpperCase()));
                  if (matchedAuthId) {
                    st.authId = matchedAuthId;
                  }
                }
              });
            }
          }

          const students = Array.from(studentMap.values());
          const attemptCount = (attempts || []).length;

          return {
            ...f,
            quizCount: (quizzes || []).length,
            studentCount: students.length,
            attemptCount,
            quizzes: quizzes || [],
            students
          };
        } catch (fErr) {
          console.error(`Error processing faculty details for ${f.email}:`, fErr);
          return {
            ...f,
            quizCount: 0,
            studentCount: 0,
            attemptCount: 0,
            quizzes: [],
            students: []
          };
        }
      })
    );

    res.json({ success: true, data: enhanced });
  } catch (error) {
    console.error('Admin faculty list error:', error);
    res.status(500).json({ success: false, message: 'Failed to list faculty', error: error.message });
  }
});

// 🔑 3. Admin Reset Password for Any Faculty Account
router.put('/faculty/:facultyId/reset-password', async (req, res) => {
  try {
    const { facultyId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const faculty = await User.findById(facultyId);
    if (!faculty) {
      return res.status(404).json({ success: false, message: 'Faculty not found' });
    }

    faculty.password = newPassword;
    await faculty.save();

    res.json({
      success: true,
      message: `Password for ${faculty.name} (${faculty.email}) reset successfully!`
    });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password', error: error.message });
  }
});

// 🗑️ 4. Full Cascade Deletion of a Faculty Account
router.delete('/faculty/:facultyId', async (req, res) => {
  try {
    const { facultyId } = req.params;

    const faculty = await User.findById(facultyId);
    if (!faculty) {
      return res.status(404).json({ success: false, message: 'Faculty not found' });
    }

    if (faculty.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot delete the Super Admin account' });
    }

    const fId = faculty._id;
    const fIdStr = fId.toString();

    // Find all quizzes owned by this faculty
    const quizzes = await Quiz.find({
      $or: [
        { userId: fId },
        { createdBy: fIdStr },
        { createdBy: faculty.name },
        { createdBy: faculty.email }
      ]
    }).select('_id');
    const quizIds = quizzes.map(q => q._id);

    // 💣 Complete Cascade Purge:
    const deletedAttempts = await QuizAttempt.deleteMany({ quizId: { $in: quizIds } });
    const deletedQuizzes = await Quiz.deleteMany({ _id: { $in: quizIds } });
    await Folder.deleteMany({ userId: fId });
    await Bookmark.deleteMany({ userId: fId });
    const deletedStudents = await Student.deleteMany({ userId: fId });
    await User.findByIdAndDelete(facultyId);

    res.json({
      success: true,
      message: `Faculty account ${faculty.email} and all associated ${deletedQuizzes.deletedCount} quizzes, ${deletedStudents.deletedCount} students, and ${deletedAttempts.deletedCount} attempts purged successfully.`
    });
  } catch (error) {
    console.error('Admin delete faculty error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete faculty account', error: error.message });
  }
});

// 📝 5. Get All Quizzes Across All Accounts
router.get('/quizzes', async (req, res) => {
  try {
    const quizzes = await Quiz.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const withAttempts = await Promise.all(
      quizzes.map(async (q) => {
        const attemptCount = await QuizAttempt.countDocuments({ quizId: q._id });
        return {
          ...q,
          attemptCount
        };
      })
    );

    res.json({ success: true, data: withAttempts });
  } catch (error) {
    console.error('Admin quizzes list error:', error);
    res.status(500).json({ success: false, message: 'Failed to list quizzes', error: error.message });
  }
});

// 🗑️ 6. Delete Specific Quiz + Cascade Submissions
router.delete('/quiz/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found' });
    }

    const deletedAttempts = await QuizAttempt.deleteMany({ quizId });
    await Quiz.findByIdAndDelete(quizId);
    quizCache.del(quizId);

    res.json({
      success: true,
      message: `Quiz "${quiz.title}" and ${deletedAttempts.deletedCount} student submissions deleted permanently.`
    });
  } catch (error) {
    console.error('Admin delete quiz error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete quiz', error: error.message });
  }
});

// 🧹 7. Purge Database / Reset Submissions
router.post('/purge-attempts', async (req, res) => {
  try {
    const { quizId } = req.body;
    const filter = quizId ? { quizId } : {};
    const result = await QuizAttempt.deleteMany(filter);

    res.json({
      success: true,
      message: `Purged ${result.deletedCount} attempt records from database.`
    });
  } catch (error) {
    console.error('Admin purge error:', error);
    res.status(500).json({ success: false, message: 'Purge failed', error: error.message });
  }
});

// 💣 8. FACTORY RESET / WIPE ENTIRE PLATFORM DATABASE
router.post('/wipe-entire-database', async (req, res) => {
  try {
    const { confirmationText } = req.body;
    if (confirmationText !== 'WIPE_ALL_DATA') {
      return res.status(400).json({
        success: false,
        message: 'Invalid confirmation phrase. Please type WIPE_ALL_DATA to confirm.'
      });
    }

    const attempts = await QuizAttempt.deleteMany({});
    const quizzes = await Quiz.deleteMany({});
    const students = await Student.deleteMany({});
    const studentAuths = await StudentAuth.deleteMany({});
    const bookmarks = await Bookmark.deleteMany({});
    const folders = await Folder.deleteMany({});
    const faculty = await User.deleteMany({ role: { $ne: 'admin' } });
    quizCache.clear();

    res.json({
      success: true,
      message: `Complete platform wipe finished: Purged ${faculty.deletedCount} faculty accounts, ${quizzes.deletedCount} quizzes, and ${attempts.deletedCount} student submissions. System reset to pristine state.`
    });
  } catch (error) {
    console.error('Admin wipe-all error:', error);
    res.status(500).json({ success: false, message: 'Wipe failed', error: error.message });
  }
});

// 🎓 9. Get All Registered Student Accounts Across Platform
router.get('/students', async (req, res) => {
  try {
    const students = await StudentAuth.find()
      .select('-password -passwordSetupOTP')
      .sort({ createdAt: -1 })
      .lean();

    const withAttempts = await Promise.all(
      students.map(async (st) => {
        const attemptCount = await QuizAttempt.countDocuments({
          $or: [
            { studentId: st._id },
            { studentEmail: st.email },
            ...(st.usn ? [{ studentUSN: st.usn }] : [])
          ]
        });
        return {
          ...st,
          attemptCount
        };
      })
    );

    res.json({ success: true, data: withAttempts });
  } catch (error) {
    console.error('Admin students list error:', error);
    res.status(500).json({ success: false, message: 'Failed to list students', error: error.message });
  }
});

// 🔑 10. Admin Reset Password for Any Student Account
router.put('/student/:studentId/reset-password', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    // Try finding by _id first, fallback to email or USN
    let student = null;
    if (studentId.match(/^[0-9a-fA-F]{24}$/)) {
      student = await StudentAuth.findById(studentId);
    }
    if (!student) {
      student = await StudentAuth.findOne({
        $or: [
          { email: studentId.toLowerCase() },
          { usn: studentId.toUpperCase() }
        ]
      });
    }

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student account not found in database' });
    }

    student.password = newPassword;
    student.failedAttempts = 0;
    student.lockUntil = null;
    student.passwordSetupOTP = undefined;
    student.passwordSetupOTPExpire = undefined;
    await student.save();

    res.json({
      success: true,
      message: `Password for student ${student.name} (${student.email || student.usn}) reset successfully!`
    });
  } catch (error) {
    console.error('Admin reset student password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset student password', error: error.message });
  }
});

// 🗑️ 11. Delete Specific Student Account & Their Submissions
router.delete('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    let student = null;
    if (studentId.match(/^[0-9a-fA-F]{24}$/)) {
      student = await StudentAuth.findById(studentId);
    }
    if (!student) {
      student = await StudentAuth.findOne({
        $or: [
          { email: studentId.toLowerCase() },
          { usn: studentId.toUpperCase() }
        ]
      });
    }

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student account not found' });
    }

    const deletedAttempts = await QuizAttempt.deleteMany({
      $or: [
        { studentId: student._id },
        { studentEmail: student.email },
        ...(student.usn ? [{ studentUSN: student.usn }] : [])
      ]
    });

    await StudentAuth.findByIdAndDelete(student._id);

    res.json({
      success: true,
      message: `Student account ${student.email} and ${deletedAttempts.deletedCount} submissions deleted successfully.`
    });
  } catch (error) {
    console.error('Admin delete student error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete student', error: error.message });
  }
});

// 🗑️ 12. Batch Delete Faculty Accounts
router.post('/faculty/batch-delete', async (req, res) => {
  try {
    const { facultyIds } = req.body;
    if (!facultyIds || !Array.isArray(facultyIds) || facultyIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No faculty selected for deletion' });
    }

    const faculty = await User.find({ _id: { $in: facultyIds }, role: { $ne: 'admin' } });
    const validIds = faculty.map(f => f._id);
    const validIdStrs = validIds.map(id => id.toString());
    const validNames = faculty.map(f => f.name).filter(Boolean);
    const validEmails = faculty.map(f => f.email).filter(Boolean);

    const quizzes = await Quiz.find({
      $or: [
        { userId: { $in: validIds } },
        { createdBy: { $in: [...validIdStrs, ...validNames, ...validEmails] } }
      ]
    }).select('_id');
    const quizIds = quizzes.map(q => q._id);

    const [delAttempts, delQuizzes, delStudents, delUsers] = await Promise.all([
      QuizAttempt.deleteMany({
        $or: [
          { quizId: { $in: quizIds } },
          { teacherId: { $in: validIds } }
        ]
      }),
      Quiz.deleteMany({ _id: { $in: quizIds } }),
      Student.deleteMany({ userId: { $in: validIds } }),
      User.deleteMany({ _id: { $in: validIds } }),
      Folder.deleteMany({ userId: { $in: validIds } }),
      Bookmark.deleteMany({ userId: { $in: validIds } })
    ]);

    (quizIds || []).forEach(id => quizCache.del(id));

    res.json({
      success: true,
      message: `Batch purge completed: Removed ${delUsers.deletedCount} faculty, ${delQuizzes.deletedCount} quizzes, and ${delAttempts.deletedCount} student submissions.`
    });
  } catch (error) {
    console.error('Admin batch delete faculty error:', error);
    res.status(500).json({ success: false, message: 'Batch deletion failed', error: error.message });
  }
});

// 🗑️ 13. Batch Delete Quizzes
router.post('/quiz/batch-delete', async (req, res) => {
  try {
    const { quizIds } = req.body;
    if (!quizIds || !Array.isArray(quizIds) || quizIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No quizzes selected for deletion' });
    }

    const [delAttempts, delQuizzes] = await Promise.all([
      QuizAttempt.deleteMany({ quizId: { $in: quizIds } }),
      Quiz.deleteMany({ _id: { $in: quizIds } })
    ]);

    (quizIds || []).forEach(id => quizCache.del(id));

    res.json({
      success: true,
      message: `Batch deleted ${delQuizzes.deletedCount} quizzes and ${delAttempts.deletedCount} student submissions.`
    });
  } catch (error) {
    console.error('Admin batch delete quizzes error:', error);
    res.status(500).json({ success: false, message: 'Batch deletion failed', error: error.message });
  }
});

// 🗑️ 14. Batch Delete Students
router.post('/student/batch-delete', async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No students selected for deletion' });
    }

    const students = await StudentAuth.find({ _id: { $in: studentIds } }).select('email usn');
    const emails = students.map(s => s.email).filter(Boolean);
    const usns = students.map(s => s.usn).filter(Boolean);

    const [delAttempts, delStudents] = await Promise.all([
      QuizAttempt.deleteMany({
        $or: [
          { studentId: { $in: studentIds } },
          ...(emails.length > 0 ? [{ studentEmail: { $in: emails } }] : []),
          ...(usns.length > 0 ? [{ studentUSN: { $in: usns } }] : [])
        ]
      }),
      StudentAuth.deleteMany({ _id: { $in: studentIds } })
    ]);

    res.json({
      success: true,
      message: `Batch deleted ${delStudents.deletedCount} student accounts and ${delAttempts.deletedCount} submissions.`
    });
  } catch (error) {
    console.error('Admin batch delete students error:', error);
    res.status(500).json({ success: false, message: 'Batch deletion failed', error: error.message });
  }
});

module.exports = router;
