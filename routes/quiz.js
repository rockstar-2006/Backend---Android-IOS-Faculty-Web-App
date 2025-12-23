const express = require('express');
const Quiz = require('../models/Quiz');
const Student = require('../models/Student');
const { protect } = require('../middleware/auth');
const router = express.Router();

// Get all quizzes with attempt statistics
router.get('/results/all', protect, async (req, res) => {
  try {
    const QuizAttempt = require('../models/QuizAttempt');

    const quizzes = await Quiz.find({ userId: req.user._id })
      .sort('-createdAt')
      .lean();

    const quizzesWithStats = await Promise.all(
      quizzes.map(async (quiz) => {
        const attempts = await QuizAttempt.find({
          quizId: quiz._id,
          teacherId: req.user._id
        });

        const submittedAttempts = attempts.filter(a => a.status === 'submitted' || a.status === 'graded' || a.status === 'blocked');
        const averageScore = submittedAttempts.length > 0
          ? submittedAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / submittedAttempts.length
          : 0;

        return {
          ...quiz,
          attemptCount: attempts.length,
          submittedCount: submittedAttempts.length,
          averageScore
        };
      })
    );

    res.json(quizzesWithStats);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get all quizzes
router.get('/all', protect, async (req, res) => {
  try {
    const quizzes = await Quiz.find({ userId: req.user._id })
      .populate('folderId')
      .sort('-createdAt');
    res.json(quizzes);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get quiz by ID
router.get('/:id', protect, async (req, res) => {
  try {
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('folderId');

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    res.json(quiz);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Save quiz
router.post('/save', protect, async (req, res) => {
  try {
    console.log('📝 Saving quiz for user:', req.user.email);

    const {
      title,
      description,
      questions,
      duration,
      difficulty,
      questionType,
      isScheduled,
      startDate,
      startTime,
      endDate,
      endTime,
      timezone
    } = req.body;

    // Validate required fields
    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Quiz title is required'
      });
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one question is required'
      });
    }

    // Validate each question
    const validatedQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

      if (!q.question || q.question.trim() === '') {
        return res.status(400).json({
          success: false,
          message: `Question ${i + 1} has empty question text`
        });
      }

      if (q.type === 'mcq') {
        if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
          return res.status(400).json({
            success: false,
            message: `Question ${i + 1}: MCQ must have at least 2 options`
          });
        }
      }

      // Handle both naming conventions: correctAnswer or answer
      validatedQuestions.push({
        question: q.question.trim(),
        options: q.options || [],
        answer: q.correctAnswer || q.answer || '',
        explanation: q.explanation || '',
        marks: q.marks || 1,
        type: q.type || 'mcq',
        difficulty: q.difficulty || 'medium'
      });
    }

    // Calculate total marks
    const totalMarks = validatedQuestions.reduce((sum, q) => sum + (q.marks || 1), 0);

    // Create quiz object
    const quizData = {
      title: title.trim(),
      description: (description || `Quiz with ${validatedQuestions.length} questions`).trim(),
      questions: validatedQuestions,
      numQuestions: validatedQuestions.length,
      totalMarks: totalMarks,
      duration: duration || 30,
      difficulty: difficulty || 'medium',
      questionType: questionType || 'mcq',
      userId: req.user._id,
      createdBy: req.user.email,
      sharedWith: [], // Initialize empty shared list
      isScheduled: isScheduled || false,
      startDate: startDate || null,
      startTime: startTime || null,
      endDate: endDate || null,
      endTime: endTime || null,
      timezone: timezone || 'Asia/Kolkata'
    };

    const quiz = new Quiz(quizData);
    await quiz.save();

    console.log('✅ Quiz saved successfully. ID:', quiz._id);

    res.json({
      success: true,
      message: 'Quiz saved successfully',
      quizId: quiz._id,
      quiz: quiz
    });

  } catch (error) {
    console.error('❌ Error saving quiz:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save quiz',
      error: error.message
    });
  }
});

// Update quiz
router.put('/:id', protect, async (req, res) => {
  try {
    console.log('🔄 Updating quiz:', req.params.id);

    const {
      title,
      description,
      questions,
      duration,
      difficulty,
      questionType,
      isScheduled,
      startDate,
      startTime,
      endDate,
      endTime,
      timezone
    } = req.body;

    // Prepare update data
    const updateData = {
      title,
      description,
      duration,
      difficulty,
      questionType,
      isScheduled,
      startDate,
      startTime,
      endDate,
      endTime,
      timezone,
      updatedAt: Date.now()
    };

    // If updating questions, validate and process them
    if (questions && Array.isArray(questions)) {
      const validatedQuestions = questions.map(q => ({
        question: q.question.trim(),
        options: q.options || [],
        answer: q.correctAnswer || q.answer || '',
        explanation: q.explanation || '',
        marks: q.marks || 1,
        type: q.type || 'mcq',
        difficulty: q.difficulty || 'medium'
      }));

      // Calculate total marks
      const totalMarks = validatedQuestions.reduce((sum, q) => sum + (q.marks || 1), 0);

      updateData.questions = validatedQuestions;
      updateData.numQuestions = validatedQuestions.length;
      updateData.totalMarks = totalMarks;
    }

    const quiz = await Quiz.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found or unauthorized'
      });
    }

    console.log('✅ Quiz updated successfully');

    res.json({
      success: true,
      message: 'Quiz updated successfully',
      quiz
    });
  } catch (error) {
    console.error('❌ Error updating quiz:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Delete quiz
router.delete('/:id', protect, async (req, res) => {
  try {
    const quiz = await Quiz.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    res.json({
      success: true,
      message: 'Quiz deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Share quiz with students
router.post('/share', protect, async (req, res) => {
  try {
    const { quizId, studentEmails } = req.body;

    console.log('📨 Sharing quiz:', quizId, 'with emails:', studentEmails);
    console.log('👤 Teacher:', req.user.email);

    // Find the quiz
    const quiz = await Quiz.findOne({
      _id: quizId,
      userId: req.user._id
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found or unauthorized'
      });
    }

    // Get existing students from database
    const allStudents = await Student.find({}, 'email name');
    const existingEmails = allStudents.map(s => s.email.toLowerCase());
    const studentMap = new Map(allStudents.map(s => [s.email.toLowerCase(), s]));

    const shared = [];
    const failed = [];

    // Add each valid student email to sharedWith array
    for (const email of studentEmails) {
      const normalizedEmail = email.toLowerCase().trim();

      if (!normalizedEmail) continue;

      // Check if student exists in system
      if (!existingEmails.includes(normalizedEmail)) {
        failed.push({
          email: normalizedEmail,
          reason: 'Student not found in system. Please upload student list first.'
        });
        continue;
      }

      // Add to shared list if not already present
      if (!quiz.sharedWith.includes(normalizedEmail)) {
        quiz.sharedWith.push(normalizedEmail);
        shared.push({
          email: normalizedEmail,
          name: studentMap.get(normalizedEmail)?.name || 'Unknown',
          sharedAt: new Date(),
          status: 'new'
        });
      } else {
        // Already shared, but user wants to "update"
        shared.push({
          email: normalizedEmail,
          name: studentMap.get(normalizedEmail)?.name || 'Unknown',
          sharedAt: new Date(),
          status: 'updated'
        });
      }
    }

    // Save the updated quiz
    await quiz.save();

    console.log('✅ Quiz shared successfully. Shared:', shared.length, 'Failed:', failed.length);

    // Prepare response
    const response = {
      success: true,
      message: `Quiz "${quiz.title}" shared with ${shared.length} student(s)`,
      shared,
      failed: failed.length > 0 ? failed : undefined
    };

    if (failed.length > 0) {
      response.warning = `Failed to share with ${failed.length} student(s)`;
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Error sharing quiz:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share quiz',
      error: error.message
    });
  }
});

// Get shared quizzes for a specific student
router.get('/student/shared', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const normalizedEmail = email.toLowerCase();

    // Find quizzes shared with this student
    const sharedQuizzes = await Quiz.find({
      sharedWith: normalizedEmail
    })
      .select('title description numQuestions totalMarks duration difficulty questionType createdAt createdBy isScheduled startDate startTime endDate endTime timezone')
      .sort('-createdAt');

    res.json({
      success: true,
      count: sharedQuizzes.length,
      quizzes: sharedQuizzes
    });

  } catch (error) {
    console.error('❌ Error fetching shared quizzes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shared quizzes',
      error: error.message
    });
  }
});

// Get results
router.get('/:id/results', protect, async (req, res) => {
  try {
    const QuizAttempt = require('../models/QuizAttempt');
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    const attempts = await QuizAttempt.find({
      quizId: req.params.id,
      teacherId: req.user._id
    }).sort('-submittedAt');

    res.json({
      success: true,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        numQuestions: quiz.questions.length,
        totalMarks: quiz.totalMarks
      },
      attempts
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Download results
router.get('/:id/results/download', protect, async (req, res) => {
  try {
    const QuizAttempt = require('../models/QuizAttempt');
    const excelService = require('../services/excelService');
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    const attempts = await QuizAttempt.find({
      quizId: req.params.id,
      teacherId: req.user._id,
      status: { $in: ['submitted', 'graded', 'blocked'] }
    }).sort('-submittedAt');

    if (attempts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No attempts found'
      });
    }

    const detailed = req.query.detailed === 'true';
    const excelBuffer = detailed
      ? excelService.generateDetailedQuizResultsExcel(quiz.title, quiz, attempts)
      : excelService.generateQuizResultsExcel(quiz.title, attempts);

    const filename = `${quiz.title.replace(/[^a-z0-9]/gi, '_')}_results.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;