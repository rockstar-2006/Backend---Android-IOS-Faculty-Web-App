const express = require('express');
const crypto = require('crypto');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
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

    // Return quiz without student info (needs to fill form first)
    res.json({
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        numQuestions: quiz.questions.length
      },
      email: email,
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
    const { attemptId, answers } = req.body;

    if (!attemptId || !answers) {
      return res.status(400).json({ message: 'Attempt ID and answers are required' });
    }

    const attempt = await QuizAttempt.findById(attemptId).populate('quizId');
    if (!attempt) {
      return res.status(404).json({ message: 'Quiz attempt not found' });
    }

    if (attempt.status !== 'started') {
      return res.status(400).json({ message: 'Quiz already submitted' });
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
    attempt.status = 'graded';
    attempt.submittedAt = new Date();
    attempt.gradedAt = new Date();

    await attempt.save();

    res.json({
      success: true,
      message: 'Quiz submitted successfully',
      results: {
        totalMarks: grading.totalMarks,
        maxMarks: grading.maxMarks,
        percentage: grading.percentage
      }
    });
  } catch (error) {
    console.error('Error submitting quiz:', error);
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
