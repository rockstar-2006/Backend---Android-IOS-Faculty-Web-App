const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  options: [{
    type: String,
    trim: true
  }],
  answer: {
    type: String,
    required: true,
    trim: true
  },
  explanation: {
    type: String,
    trim: true,
    default: ''
  },
  marks: {
    type: Number,
    default: 1,
    min: 0.5
  },
  type: {
    type: String,
    enum: ['mcq', 'short-answer', 'mixed'],
    default: 'mcq'
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'mixed'],
    default: 'medium'
  }
});

const quizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  questions: [questionSchema],
  numQuestions: {
    type: Number,
    default: 0,
    min: 1
  },
  totalMarks: {
    type: Number,
    default: 0
  },
  duration: {
    type: Number,
    default: 30,
    min: 1
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'mixed'],
    default: 'medium'
  },
  questionType: {
    type: String,
    enum: ['mcq', 'short-answer', 'mixed'],
    default: 'mcq'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null
  },
  createdBy: {
    type: String,
    required: true
  },
  sharedWith: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  isPublished: {
    type: Boolean,
    default: false
  },
  publishedAt: {
    type: Date,
    default: null
  },
  // Quiz Scheduling Fields
  isScheduled: {
    type: Boolean,
    default: false
  },
  startDate: {
    type: Date,
    default: null
  },
  startTime: {
    type: String, // Format: "HH:MM" (24-hour)
    default: null
  },
  endDate: {
    type: Date,
    default: null
  },
  endTime: {
    type: String, // Format: "HH:MM" (24-hour)
    default: null
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata'
  }
}, {
  timestamps: true
});

// Index for faster queries
quizSchema.index({ userId: 1, createdAt: -1 });
quizSchema.index({ sharedWith: 1, createdAt: -1 });
quizSchema.index({ title: 'text', description: 'text' });

// Method to check if quiz is currently accessible
quizSchema.methods.isAccessible = function () {
  // If not scheduled, always accessible
  if (!this.isScheduled) {
    return {
      accessible: true,
      message: 'Quiz is available'
    };
  }

  const now = new Date();

  // Combine date and time for start
  const startDateTime = new Date(this.startDate);
  if (this.startTime) {
    const [hours, minutes] = this.startTime.split(':');
    startDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  }

  // Combine date and time for end
  const endDateTime = new Date(this.endDate);
  if (this.endTime) {
    const [hours, minutes] = this.endTime.split(':');
    endDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  }

  // Check if quiz hasn't started yet
  if (now < startDateTime) {
    return {
      accessible: false,
      message: `Quiz will start on ${startDateTime.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: this.timezone
      })}`,
      startsAt: startDateTime
    };
  }

  // Check if quiz has ended
  if (now > endDateTime) {
    return {
      accessible: false,
      message: `Quiz ended on ${endDateTime.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: this.timezone
      })}`,
      endedAt: endDateTime
    };
  }

  // Quiz is currently active
  return {
    accessible: true,
    message: 'Quiz is currently active',
    endsAt: endDateTime
  };
};

// Pre-save middleware to calculate numQuestions and totalMarks
quizSchema.pre('save', function (next) {
  this.numQuestions = this.questions.length;
  this.totalMarks = this.questions.reduce((sum, q) => sum + (q.marks || 1), 0);
  next();
});

const Quiz = mongoose.model('Quiz', quizSchema);

module.exports = Quiz;