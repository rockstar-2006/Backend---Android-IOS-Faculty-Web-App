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

    // Calculate time remaining for resumed attempts
    let timeRemaining = null;
    if (existingAttempt && existingAttempt.status === 'started') {
      const startTime = new Date(existingAttempt.startedAt).getTime();
      const nowTime = Date.now();
      const elapsedSeconds = Math.floor((nowTime - startTime) / 1000);
      const totalSeconds = (quiz.duration || 30) * 60;
      timeRemaining = Math.max(0, totalSeconds - elapsedSeconds);
      console.log('⏱️ Time Remaining Calculated:', { 
        startedAt: existingAttempt.startedAt,
        elapsed: elapsedSeconds,
        total: totalSeconds,
        remaining: timeRemaining 
      });
    }

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
        score: existingAttempt.totalMarks,
        timeRemaining: timeRemaining,
        isBlocked: existingAttempt.status === 'blocked',
        violationReason: existingAttempt.violationReason || null
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

    // Check if student has already submitted this quiz OR has been blocked
    const submittedAttempt = await QuizAttempt.findOne({
      quizId: quizId,
      studentEmail: student.email.toLowerCase(),
      status: { $in: ['submitted', 'graded', 'blocked', 'expired'] }
    });

    if (submittedAttempt) {
      const reason = submittedAttempt.status === 'blocked' 
        ? `You have been blocked from retaking this quiz${submittedAttempt.violationReason ? ': ' + submittedAttempt.violationReason : ''}`
        : submittedAttempt.status === 'expired'
        ? 'Your quiz attempt expired - you cannot re-attempt'
        : 'You have already submitted this quiz';
      
      return res.status(400).json({
        success: false,
        message: reason,
        isPreviouslySubmitted: submittedAttempt.status === 'submitted' || submittedAttempt.status === 'graded',
        isBlocked: submittedAttempt.status === 'blocked',
        blockReason: submittedAttempt.violationReason
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
        // Resume existing attempt - calculate time remaining explicitly
        const elapsedSeconds = Math.floor((new Date() - existingAttempt.startedAt) / 1000);
        const totalSeconds = (existingAttempt.duration || 30) * 60;
        const timeRemaining = Math.max(0, totalSeconds - elapsedSeconds);
        
        return res.json({
          success: true,
          message: 'Resuming existing attempt',
          attempt: {
            id: existingAttempt._id,
            status: existingAttempt.status,
            startedAt: existingAttempt.startedAt,
            timeRemaining: timeRemaining,
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

    // Calculate time remaining explicitly (virtual properties don't serialize by default)
    const elapsedSeconds = Math.floor((new Date() - attempt.startedAt) / 1000);
    const totalSeconds = (attempt.duration || 30) * 60;
    const timeRemaining = Math.max(0, totalSeconds - elapsedSeconds);

    res.json({
      success: true,
      message: 'Quiz attempt started successfully',
      attempt: {
        id: attempt._id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        duration: attempt.duration,
        maxMarks: attempt.maxMarks,
        timeRemaining: timeRemaining
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

    // 🔒 TIMER RACE CONDITION CHECK - Verify submission within time limit
    const serverStartTime = new Date(attempt.startedAt).getTime();
    const serverCurrentTime = new Date().getTime();
    const elapsedServerTime = Math.floor((serverCurrentTime - serverStartTime) / 1000);
    const totalAllowedSeconds = (attempt.duration || 30) * 60;

    console.log(`⏱️  [TIMER CHECK] Elapsed: ${elapsedServerTime}s, Allowed: ${totalAllowedSeconds}s`);

    // Allow 5-second grace period for network/processing latency
    if (elapsedServerTime > totalAllowedSeconds + 5) {
      console.log(`❌ [TIMER EXPIRED] Submission rejected (${elapsedServerTime - totalAllowedSeconds}s over)`);
      attempt.status = 'expired';
      attempt.violationReason = 'Time limit exceeded';
      attempt.utcSubmitTime = new Date().toISOString();
      await attempt.save();

      return res.status(403).json({
        success: false,
        message: 'Quiz time limit exceeded. Submission rejected.',
        timeExpired: true,
        elapsedSeconds: elapsedServerTime,
        maxSeconds: totalAllowedSeconds
      });
    }

    // 🌐 STORE UTC TIMES for consistent timezone handling
    attempt.utcStartTime = new Date(attempt.startedAt).toISOString();
    attempt.utcSubmitTime = new Date().toISOString();

    // Validate that student has answered at least one question
    const formattedAnswers = Array.isArray(answers) ? answers : [];
    const answeredQuestions = formattedAnswers.filter(a => 
      a.studentAnswer && a.studentAnswer.toString().trim().length > 0
    );

    if (answeredQuestions.length === 0) {
      console.log('❌ [VALIDATION] No questions answered');
      return res.status(400).json({
        success: false,
        message: 'You must answer at least one question before submitting',
        errorCode: 'NO_ANSWERS_PROVIDED'
      });
    }

    const formattedAnswersForGrading = Array.isArray(answers) ? answers : [];
    let totalScore = 0;
    const finalQuestionResults = [];

    console.log(`📊 [GRADING] Starting evaluation for attempt: ${attemptId}`);

    for (const question of quiz.questions) {
      const qId = question._id.toString();
      const studentAnswerObj = formattedAnswersForGrading.find(a => a.questionId === qId);
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

    // Find submitted attempt (including blocked and graded attempts)
    const attempt = await QuizAttempt.findOne({
      quizId: quizId,
      studentEmail: student.email.toLowerCase(),
      status: { $in: ['submitted', 'graded', 'blocked'] }
    }).sort('-submittedAt');

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'No completed attempt found'
      });
    }

    // Get quiz details
    const quiz = await Quiz.findById(quizId);

    res.json({
      success: true,
      data: {
        id: attempt._id,
        score: attempt.totalMarks,
        maxMarks: attempt.maxMarks,
        percentage: attempt.percentage,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        timeSpent: attempt.timeSpent,
        isAutoSubmit: attempt.isAutoSubmit,
        isBlocked: attempt.status === 'blocked',
        blockReason: attempt.violationReason,
        detailedResults: attempt.answers,
        results: attempt.answers,
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

// ✅ LOG VIOLATION - New endpoint for server-side violation tracking
router.post('/quiz/log-violation', verifyStudentToken, async (req, res) => {
  try {
    const { attemptId, violationType, reason } = req.body;
    const student = req.student;

    if (!attemptId || !violationType) {
      return res.status(400).json({
        success: false,
        message: 'Attempt ID and violation type are required'
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
        message: 'Attempt not found'
      });
    }

    // 🔒 CRITICAL: Log violation to backend (audit trail)
    const violationRecord = {
      type: violationType,
      timestamp: new Date(),
      reason: reason || 'No reason provided',
      severity: violationType === 'app-switch' ? 'critical' : 'warning'
    };

    attempt.violations.push(violationRecord);
    attempt.violationCount = (attempt.violationCount || 0) + 1;
    attempt.lastViolationAt = new Date();

    console.log(`🚨 [VIOLATION LOGGED] ${student.email} - Type: ${violationType}, Count: ${attempt.violationCount}, Reason: ${reason}`);

    // If 3+ violations, auto-block
    if (attempt.violationCount >= 3) {
      console.log(`❌ [AUTO-BLOCK] Student reached 3 violations. Auto-submitting and blocking.`);
      attempt.status = 'blocked';
      attempt.violationReason = `Permanently blocked after ${attempt.violationCount} security violations: ${reason}`;
      attempt.submittedAt = new Date();
      attempt.utcSubmitTime = new Date().toISOString();
    }

    await attempt.save();

    res.json({
      success: true,
      message: 'Violation logged successfully',
      violationCount: attempt.violationCount,
      blocked: attempt.violationCount >= 3,
      blockReason: attempt.violationReason
    });

  } catch (error) {
    console.error('❌ Log violation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log violation',
      error: error.message
    });
  }
});

module.exports = router;