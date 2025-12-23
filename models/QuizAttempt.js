const mongoose = require('mongoose');
const crypto = require('crypto');

const attemptAnswerSchema = new mongoose.Schema({
  questionId: String,
  question: String,
  type: {
    type: String,
    enum: ['mcq', 'short-answer']
  },
  options: [String],
  studentAnswer: String,
  correctAnswer: String,
  isCorrect: Boolean,
  marks: Number,
  explanation: String
});

const quizAttemptSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentAuth'
  },
  studentName: {
    type: String,
    required: true,
    trim: true
  },
  studentUSN: {
    type: String,
    trim: true,
    uppercase: true
  },
  studentEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  studentBranch: {
    type: String,
    trim: true
  },
  studentYear: {
    type: String
  },
  studentSemester: {
    type: String
  },
  answers: [attemptAnswerSchema],
  totalMarks: {
    type: Number,
    default: 0
  },
  maxMarks: Number,
  percentage: Number,
  status: {
    type: String,
    enum: ['started', 'submitted', 'graded', 'in-progress', 'expired', 'blocked'],
    default: 'started'
  },
  violationReason: String,
  startedAt: {
    type: Date,
    default: Date.now
  },
  submittedAt: Date,
  gradedAt: Date,
  uniqueToken: {
    type: String,
    required: true,
    unique: true,
    default: function () {
      return crypto.randomBytes(16).toString('hex');
    }
  },
  duration: {
    type: Number,
    default: 30
  },
  timeSpent: {
    type: Number,
    default: 0
  },
  isAutoSubmit: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for faster queries
quizAttemptSchema.index({ teacherId: 1, quizId: 1 });
quizAttemptSchema.index({ studentEmail: 1, quizId: 1 });
quizAttemptSchema.index({ status: 1 });

// Virtual for elapsed time
quizAttemptSchema.virtual('elapsedTime').get(function () {
  if (!this.startedAt) return 0;
  const now = this.submittedAt || new Date();
  return Math.floor((now - this.startedAt) / 1000);
});

// Virtual for time remaining
quizAttemptSchema.virtual('timeRemaining').get(function () {
  if (!['started', 'in-progress'].includes(this.status)) return 0;
  const elapsedSeconds = this.elapsedTime;
  const totalSeconds = (this.duration || 30) * 60;
  return Math.max(0, totalSeconds - elapsedSeconds);
});

// Check if expired
quizAttemptSchema.methods.isExpired = function () {
  if (!['started', 'in-progress'].includes(this.status)) return false;
  const elapsedSeconds = this.elapsedTime;
  const totalSeconds = (this.duration || 30) * 60;
  return elapsedSeconds >= totalSeconds;
};

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);