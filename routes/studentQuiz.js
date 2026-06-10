const express = require('express');
const crypto = require('crypto');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const Student = require('../models/Student');
const gradingService = require('../services/gradingService');

const router = express.Router();

// Get quiz by token (for student)
router.get('/attempt/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find existing attempt with this token
    const existingAttempt = await QuizAttempt.findOne({ uniqueToken: token })
      .populate('quizId');

    if (existingAttempt) {
      // Check if already submitted
      if (existingAttempt.status === 'submitted' || existingAttempt.status === 'graded') {
        return res.status(400).json({
          message: 'This quiz has already been submitted',
          alreadySubmitted: true
        });
      }

      // Return quiz with attempt data
      const quiz = existingAttempt.quizId;

      // Check scheduling constraints
      const accessibility = quiz.isAccessible();
      if (!accessibility.accessible) {
        return res.status(403).json({ message: accessibility.message });
      }

      // Check if blocked
      if (existingAttempt.status === 'blocked') {
        return res.json({
          quiz: {
            id: quiz._id,
            title: quiz.title,
            description: quiz.description,
            duration: quiz.duration,
            numQuestions: quiz.questions.length
          },
          attemptId: existingAttempt._id,
          studentInfo: {
            name: existingAttempt.studentName,
            usn: existingAttempt.studentUSN,
            email: existingAttempt.studentEmail,
            branch: existingAttempt.studentBranch,
            year: existingAttempt.studentYear,
            semester: existingAttempt.studentSemester
          },
          isBlocked: true,
          violationReason: existingAttempt.violationReason || 'Security violations detected during attempt',
          violationCount: existingAttempt.violationCount || 0,
          hasStarted: true
        });
      }

      // Check if expired
      const elapsedSeconds = Math.floor((new Date() - existingAttempt.startedAt) / 1000);
      const totalSeconds = (existingAttempt.duration || quiz.duration || 30) * 60;
      if (existingAttempt.status === 'started' && elapsedSeconds >= totalSeconds) {
        existingAttempt.status = 'expired';
        existingAttempt.submittedAt = new Date();
        await existingAttempt.save();
        return res.status(400).json({
          message: 'Quiz session has expired',
          alreadySubmitted: true
        });
      }

      // Calculate time remaining for resumed attempts
      let timeRemaining = null;
      if (existingAttempt.status === 'started') {
        timeRemaining = Math.max(0, totalSeconds - elapsedSeconds);
      }

      return res.json({
        quiz: {
          id: quiz._id,
          title: quiz.title,
          description: quiz.description,
          duration: quiz.duration,
          questions: quiz.questions.map(q => ({
            id: q.id,
            type: q.type,
            question: q.question,
            options: q.options
            // Don't send answers or explanations
          }))
        },
        attemptId: existingAttempt._id,
        studentInfo: {
          name: existingAttempt.studentName,
          usn: existingAttempt.studentUSN,
          email: existingAttempt.studentEmail,
          branch: existingAttempt.studentBranch,
          year: existingAttempt.studentYear,
          semester: existingAttempt.studentSemester
        },
        answers: quiz.questions.map(q => {
          const qId = (q.id || q._id).toString();
          const savedAns = existingAttempt.answers.find(a => a.questionId === qId);
          return savedAns ? savedAns.studentAnswer : '';
        }),
        timeRemaining,
        violationCount: existingAttempt.violationCount || 0,
        isBlocked: false,
        hasStarted: true
      });
    }

    // Decode token to get quiz ID and email
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [email, quizId] = decoded.split('||');

    if (!email || !quizId) {
      return res.status(400).json({ message: 'Invalid quiz link' });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check scheduling constraints
    const accessibility = quiz.isAccessible();
    if (!accessibility.accessible) {
      return res.status(403).json({ message: accessibility.message });
    }

    // Query Student collection by email (case-insensitive)
    const student = await Student.findOne({ email: email.toLowerCase() });

    // Return quiz with student info if found (needs to fill form first otherwise)
    res.json({
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        numQuestions: quiz.questions.length
      },
      email: email,
      studentInfo: student ? {
        name: student.name,
        usn: student.usn,
        branch: student.branch,
        year: student.year,
        semester: student.semester
      } : null,
      hasStarted: false
    });
  } catch (error) {
    console.error('Error fetching quiz:', error);
    res.status(400).json({ message: error.message });
  }
});

// Start quiz attempt (after student fills info)
router.post('/attempt/start', async (req, res) => {
  try {
    const { token, studentName, studentUSN, studentBranch, studentYear, studentSemester } = req.body;

    // Validate required fields
    if (!token || !studentName || !studentUSN || !studentBranch || !studentYear || !studentSemester) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Decode token
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [email, quizId] = decoded.split('||');

    if (!email || !quizId) {
      return res.status(400).json({ message: 'Invalid quiz link' });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check scheduling constraints
    const accessibility = quiz.isAccessible();
    if (!accessibility.accessible) {
      return res.status(403).json({ message: accessibility.message });
    }

    // Check if already attempted
    const existingAttempt = await QuizAttempt.findOne({
      uniqueToken: token
    });

    if (existingAttempt) {
      if (existingAttempt.status === 'blocked') {
        return res.status(400).json({ message: 'Quiz access blocked due to security violations' });
      }
      if (existingAttempt.status !== 'started') {
        return res.status(400).json({ message: 'Quiz already submitted' });
      }
      // Return existing attempt
      return res.json({
        success: true,
        attemptId: existingAttempt._id,
        quiz: {
          id: quiz._id,
          title: quiz.title,
          description: quiz.description,
          duration: quiz.duration,
          questions: quiz.questions.map(q => ({
            id: q.id,
            type: q.type,
            question: q.question,
            options: q.options
          }))
        }
      });
    }

    // Create new attempt
    const attempt = await QuizAttempt.create({
      quizId: quiz._id,
      teacherId: quiz.userId,
      studentName: studentName.trim(),
      studentUSN: studentUSN.trim().toUpperCase(),
      studentEmail: email,
      studentBranch: studentBranch.trim(),
      studentYear: studentYear,
      studentSemester: studentSemester,
      uniqueToken: token,
      status: 'started',
      maxMarks: quiz.questions.length
    });

    res.json({
      success: true,
      attemptId: attempt._id,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        questions: quiz.questions.map(q => ({
          id: q.id,
          type: q.type,
          question: q.question,
          options: q.options
        }))
      }
    });
  } catch (error) {
    console.error('Error starting quiz:', error);
    res.status(400).json({ message: error.message });
  }
});

// Submit quiz answers
router.post('/attempt/submit', async (req, res) => {
  try {
    const { attemptId, answers, isAutoSubmit = false, reason = '' } = req.body;

    if (!attemptId || !answers) {
      return res.status(400).json({ message: 'Attempt ID and answers are required' });
    }

    const attempt = await QuizAttempt.findById(attemptId).populate('quizId');
    if (!attempt) {
      return res.status(404).json({ message: 'Quiz attempt not found' });
    }

    if (attempt.status !== 'started') {
      return res.status(400).json({ message: 'Quiz already submitted or blocked' });
    }

    const quiz = attempt.quizId;

    // Grade the quiz
    const grading = await gradingService.gradeQuizAttempt(
      quiz.questions,
      answers
    );

    // Update attempt with graded results
    attempt.answers = grading.gradedAnswers;
    attempt.totalMarks = grading.totalMarks;
    attempt.maxMarks = grading.maxMarks;
    attempt.percentage = grading.percentage;
    attempt.status = reason ? 'blocked' : 'graded';
    attempt.violationReason = reason || undefined;
    attempt.isAutoSubmit = isAutoSubmit;
    attempt.submittedAt = new Date();
    attempt.gradedAt = new Date();
    attempt.timeSpent = Math.floor((new Date() - attempt.startedAt) / 1000);

    await attempt.save();

    res.json({
      success: true,
      message: reason ? 'Quiz blocked due to violation' : 'Quiz submitted successfully',
      results: {
        score: grading.totalMarks,
        totalMarks: grading.totalMarks,
        maxMarks: grading.maxMarks,
        percentage: grading.percentage,
        isBlocked: !!reason,
        blockReason: reason,
        detailedResults: grading.gradedAnswers
      }
    });
  } catch (error) {
    console.error('Error submitting quiz:', error);
    res.status(400).json({ message: error.message });
  }
});

// Log violation for web student quiz
router.post('/attempt/log-violation', async (req, res) => {
  try {
    const { attemptId, violationType, reason } = req.body;

    if (!attemptId || !violationType) {
      return res.status(400).json({
        success: false,
        message: 'Attempt ID and violation type are required'
      });
    }

    // Find attempt
    const attempt = await QuizAttempt.findById(attemptId);

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Attempt not found'
      });
    }

    if (attempt.status !== 'started') {
      return res.status(400).json({
        success: false,
        message: 'Attempt is already submitted or blocked'
      });
    }

    const allowedTypes = ['app-switch', 'focus-loss', 'split-screen', 'overlay', 'keyboard-shortcut'];
    const safeType = allowedTypes.includes(violationType) ? violationType : 'focus-loss';

    const violationRecord = {
      violationType: safeType,
      timestamp: new Date(),
      reason: reason || 'No reason provided',
      severity: safeType === 'app-switch' || safeType === 'overlay' ? 'critical' : 'warning'
    };

    attempt.violations.push(violationRecord);
    attempt.violationCount = (attempt.violationCount || 0) + 1;
    attempt.lastViolationAt = new Date();

    console.log(`🚨 [WEB VIOLATION LOGGED] ${attempt.studentEmail} - Type: ${violationType}, Count: ${attempt.violationCount}, Reason: ${reason}`);

    // If 3+ violations, auto-block
    if (attempt.violationCount >= 3) {
      console.log(`❌ [WEB AUTO-BLOCK] Student reached 3 violations. Auto-submitting and blocking.`);
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

// Save quiz progress (during attempt)
router.post('/attempt/save-progress', async (req, res) => {
  try {
    const { attemptId, answers } = req.body;

    if (!attemptId) {
      return res.status(400).json({
        success: false,
        message: 'Attempt ID is required'
      });
    }

    // Find attempt
    const attempt = await QuizAttempt.findById(attemptId).populate('quizId');

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Attempt not found'
      });
    }

    if (attempt.status !== 'started') {
      return res.status(400).json({
        success: false,
        message: 'Attempt is already submitted or blocked'
      });
    }

    const quiz = attempt.quizId;

    // Map the string array of answers from frontend to the schema format
    attempt.answers = quiz.questions.map((q, idx) => ({
      questionId: q.id || q._id,
      question: q.question,
      type: q.type,
      options: q.options || [],
      studentAnswer: answers[idx] || ''
    }));

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

module.exports = router;
