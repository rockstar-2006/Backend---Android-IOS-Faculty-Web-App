// routes/studentAuthQuiz.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const StudentAuth = require('../models/StudentAuth');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const gradingService = require('../services/gradingService');

// Middleware to verify student token (duplicated here for completeness)
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
      return res.status(403).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    const student = await StudentAuth.findById(decoded.id);

    if (!student || !student.isVerified) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or not verified'
      });
    }

    req.student = student;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
};

// ✅ Get quiz details for student - REMOVED /student-auth prefix
router.get('/quiz/:quizId', verifyStudentToken, async (req, res) => {
  try {
    const { quizId } = req.params;
    const student = req.student;

    console.log('🔵 [GET QUIZ DETAILS] Student:', student.email, 'Quiz ID:', quizId);

    // Find quiz
    const quiz = await Quiz.findOne({
      _id: quizId,
      sharedWith: {
        $elemMatch: {
          $regex: new RegExp("^" + student.email.toLowerCase() + "$", "i")
        }
      }
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found or not shared with you'
      });
    }

    console.log('✅ Quiz found:', quiz.title, 'Questions:', quiz.questions.length);

    // Check scheduling constraints
    const accessibility = quiz.isAccessible();
    if (!accessibility.accessible) {
      console.log('🚫 [ACCESS DENIED] Quiz not accessible:', accessibility.message);
      return res.status(403).json({
        success: false,
        message: accessibility.message,
        isScheduled: true,
        startsAt: accessibility.startsAt,
        endedAt: accessibility.endedAt
      });
    }

    // Check for existing attempt
    const existingAttempt = await QuizAttempt.findOne({
      quizId: quizId,
      studentEmail: student.email.toLowerCase()
    }).sort('-createdAt');

    res.json({
      success: true,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        questions: quiz.questions.map(q => ({
          id: q._id,
          question: q.question,
          type: q.type,
          options: q.options || [],
          marks: q.marks || 1,
          difficulty: q.difficulty
        })),
        numQuestions: quiz.numQuestions,
        totalMarks: quiz.totalMarks,
        duration: quiz.duration,
        difficulty: quiz.difficulty,
        questionType: quiz.questionType,
        createdAt: quiz.createdAt,
        createdBy: quiz.createdBy
      },
      existingAttempt: existingAttempt ? {
        id: existingAttempt._id,
        status: existingAttempt.status,
        startedAt: existingAttempt.startedAt,
        submittedAt: existingAttempt.submittedAt,
        score: existingAttempt.totalMarks
      } : null
    });

  } catch (error) {
    console.error('❌ Get quiz details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quiz details',
      error: error.message
    });
  }
});

// ✅ Start quiz attempt - REMOVED /student-auth prefix
router.post('/quiz/start', verifyStudentToken, async (req, res) => {
  try {
    const { quizId } = req.body;
    const student = req.student;

    console.log('🔵 [START QUIZ] Student:', student.email);
    console.log('📦 Request body:', { quizId });

    if (!quizId) {
      return res.status(400).json({
        success: false,
        message: 'Quiz ID is required'
      });
    }

    // Find quiz
    const quiz = await Quiz.findOne({
      _id: quizId,
      sharedWith: {
        $elemMatch: {
          $regex: new RegExp("^" + student.email.toLowerCase() + "$", "i")
        }
      }
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found or not shared with you'
      });
    }

    console.log('✅ Quiz found:', quiz.title, 'Questions:', quiz.questions.length);

    // Check if student has already submitted this quiz
    const submittedAttempt = await QuizAttempt.findOne({
      quizId: quizId,
      studentEmail: student.email.toLowerCase(),
      status: { $in: ['submitted', 'graded'] }
    });

    if (submittedAttempt) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted this quiz'
      });
    }

    // Check for existing in-progress attempt
    let existingAttempt = await QuizAttempt.findOne({
      quizId: quizId,
      studentEmail: student.email.toLowerCase(),
      status: { $in: ['started', 'in-progress'] }
    });

    if (existingAttempt) {
      // Check if expired
      if (existingAttempt.isExpired()) {
        existingAttempt.status = 'expired';
        existingAttempt.submittedAt = new Date();
        await existingAttempt.save();
      } else {
        // Resume existing attempt
        return res.json({
          success: true,
          message: 'Resuming existing attempt',
          attempt: {
            id: existingAttempt._id,
            status: existingAttempt.status,
            startedAt: existingAttempt.startedAt,
            timeRemaining: existingAttempt.timeRemaining,
            answers: existingAttempt.answers || []
          }
        });
      }
    }

    // Create new attempt
    const attempt = new QuizAttempt({
      quizId: quizId,
      teacherId: quiz.userId,
      studentId: student._id,
      studentName: student.name,
      studentEmail: student.email.toLowerCase(),
      studentUSN: student.usn || '',
      studentBranch: student.branch || '',
      studentYear: student.year || '',
      studentSemester: student.semester || '',
      maxMarks: quiz.totalMarks,
      duration: quiz.duration || 30,
      status: 'started',
      startedAt: new Date()
    });

    await attempt.save();

    console.log('✅ Quiz attempt created:', attempt._id);

    res.json({
      success: true,
      message: 'Quiz attempt started successfully',
      attempt: {
        id: attempt._id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        duration: attempt.duration,
        maxMarks: attempt.maxMarks,
        timeRemaining: attempt.timeRemaining
      }
    });

  } catch (error) {
    console.error('❌ Start quiz error:', error);

    if (error.name === 'ValidationError') {
      console.error('Validation errors:', Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      })));

      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }))
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to start quiz attempt',
      error: error.message
    });
  }
});

// ✅ Save quiz progress - REMOVED /student-auth prefix
router.post('/quiz/save-progress', verifyStudentToken, async (req, res) => {
  try {
    const { attemptId, answers } = req.body;
    const student = req.student;

    if (!attemptId) {
      return res.status(400).json({
        success: false,
        message: 'Attempt ID is required'
      });
    }

    // Find attempt
    const attempt = await QuizAttempt.findOne({
      _id: attemptId,
      studentEmail: student.email.toLowerCase(),
      status: { $in: ['started', 'in-progress'] }
    });

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Attempt not found or already submitted'
      });
    }

    // Update answers
    attempt.answers = answers || [];
    attempt.timeSpent = Math.floor((new Date() - attempt.startedAt) / 1000);

    await attempt.save();

    res.json({
      success: true,
      message: 'Progress saved successfully'
    });

  } catch (error) {
    console.error('❌ Save progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save progress',
      error: error.message
    });
  }
});

// ✅ Submit quiz - REMOVED /student-auth prefix
router.post('/quiz/submit', verifyStudentToken, async (req, res) => {
  try {
    const { attemptId, answers, isAutoSubmit = false } = req.body;
    const student = req.student;

    if (!attemptId) {
      return res.status(400).json({
        success: false,
        message: 'Attempt ID is required'
      });
    }

    // Find attempt
    const attempt = await QuizAttempt.findOne({
      _id: attemptId,
      studentEmail: student.email.toLowerCase(),
      status: { $in: ['started', 'in-progress'] }
    });

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Attempt not found or already submitted'
      });
    }

    // Get quiz for grading
    const quiz = await Quiz.findById(attempt.quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Map student answers and start grading
    const formattedAnswers = Array.isArray(answers) ? answers : [];
    let totalScore = 0;
    const finalQuestionResults = [];

    console.log(`📊 [GRADING] Starting evaluation for attempt: ${attemptId}`);

    for (const question of quiz.questions) {
      const qId = question._id.toString();
      const studentAnswerObj = formattedAnswers.find(a => a.questionId === qId);
      const studentAnswer = studentAnswerObj ? studentAnswerObj.studentAnswer : '';

      console.log(`🔍 Checking Question ${qId}: Student Answer = "${studentAnswer}"`);

      let grade = { isCorrect: false, marks: 0, feedback: '' };

      if (question.type === 'short-answer') {
        try {
          const aiGrade = await gradingService.gradeShortAnswer(question.question, question.answer, studentAnswer);
          grade.isCorrect = aiGrade.isCorrect;
          grade.marks = aiGrade.marks;
          grade.feedback = aiGrade.feedback;
        } catch (e) {
          console.error(`❌ AI Grading failed for ${qId}:`, e);
          grade.feedback = 'AI Grading error fallback.';
        }
      } else {
        // MCQ / TrueFalse
        const sAns = gradingService.normalizeMCQAnswer(studentAnswer);
        const cAns = gradingService.normalizeMCQAnswer(question.answer);

        console.log(`   Normalize: Student="${sAns}", Correct="${cAns}"`);

        let isCorrect = (sAns === cAns);

        // Extended matching for letters vs text
        if (!isCorrect && question.options?.length > 0) {
          const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
          if (letterMap[cAns] !== undefined) {
            const correctText = gradingService.normalizeMCQAnswer(question.options[letterMap[cAns]]);
            if (sAns === correctText) isCorrect = true;
          }
          if (!isCorrect && letterMap[sAns] !== undefined) {
            const studentText = gradingService.normalizeMCQAnswer(question.options[letterMap[sAns]]);
            if (studentText === cAns) isCorrect = true;
          }
        }

        grade.isCorrect = isCorrect;
        grade.marks = isCorrect ? (question.marks || 1) : 0;
        grade.feedback = isCorrect ? 'Optimal response.' : 'Response mismatch.';
      }

      totalScore += grade.marks;
      console.log(`   Result: ${grade.isCorrect ? 'CORRECT' : 'WRONG'} (+${grade.marks} pts)`);

      finalQuestionResults.push({
        questionId: question._id,
        question: question.question,
        type: question.type,
        options: question.options,
        studentAnswer: studentAnswer,
        correctAnswer: question.answer,
        isCorrect: grade.isCorrect,
        marks: grade.marks,
        explanation: question.explanation || grade.feedback
      });
    }

    const percentage = quiz.totalMarks > 0 ? (totalScore / quiz.totalMarks) * 100 : 0;
    const { reason = '' } = req.body;

    attempt.answers = finalQuestionResults;
    attempt.totalMarks = totalScore;
    attempt.percentage = percentage;
    attempt.status = reason ? 'blocked' : 'submitted';
    attempt.violationReason = reason;
    attempt.submittedAt = new Date();
    attempt.isAutoSubmit = isAutoSubmit;
    attempt.timeSpent = Math.floor((new Date() - attempt.startedAt) / 1000);

    await attempt.save();

    res.json({
      success: true,
      message: reason ? 'Quiz blocked due to violation' : (isAutoSubmit ? 'Quiz auto-submitted' : 'Quiz submitted successfully'),
      results: {
        score: totalScore,
        totalMarks: quiz.totalMarks,
        percentage: percentage.toFixed(1),
        questions: quiz.questions.length,
        correctAnswers: finalQuestionResults.filter(q => q.isCorrect).length,
        isBlocked: !!reason,
        blockReason: reason,
        breakdown: finalQuestionResults.map(r => ({
          questionId: r.questionId,
          question: r.question,
          type: r.type,
          options: r.options,
          isCorrect: r.isCorrect,
          studentAnswer: r.studentAnswer,
          correctAnswer: r.correctAnswer,
          explanation: r.explanation,
          marks: r.marks
        }))
      }
    });

  } catch (error) {
    console.error('❌ Submit quiz error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit quiz',
      error: error.message
    });
  }
});

// ✅ Get quiz results - REMOVED /student-auth prefix
router.get('/quiz/:quizId/results', verifyStudentToken, async (req, res) => {
  try {
    const { quizId } = req.params;
    const student = req.student;

    // Find submitted attempt
    const attempt = await QuizAttempt.findOne({
      quizId: quizId,
      studentEmail: student.email.toLowerCase(),
      status: 'submitted'
    }).sort('-submittedAt');

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'No submitted attempt found'
      });
    }

    // Get quiz details
    const quiz = await Quiz.findById(quizId);

    res.json({
      success: true,
      results: {
        id: attempt._id,
        score: attempt.totalMarks,
        maxMarks: attempt.maxMarks,
        percentage: attempt.percentage,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        timeSpent: attempt.timeSpent,
        isAutoSubmit: attempt.isAutoSubmit,
        answers: attempt.answers,
        quizTitle: quiz ? quiz.title : 'Unknown Quiz'
      }
    });

  } catch (error) {
    console.error('❌ Get results error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch results',
      error: error.message
    });
  }
});

module.exports = router;