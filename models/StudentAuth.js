const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const studentAuthSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  usn: {
    type: String,
    trim: true
  },
  branch: {
    type: String,
    trim: true
  },
  year: {
    type: String,
    trim: true
  },
  semester: {
    type: String,
    trim: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  deviceId: {
    type: String,
    default: null
  },
  lastLogin: {
    type: Date,
    default: null
  },
  failedAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  // 🔒 NEW: OTP-based password setup
  passwordSetupOTP: String,
  passwordSetupOTPExpire: Date,
  passwordSetupAttempts: {
    type: Number,
    default: 0
  },
  passwordSetupOTPEmail: String
}, {
  timestamps: true
});

// Hash password before saving
studentAuthSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
studentAuthSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate and hash password token
studentAuthSchema.methods.createPasswordResetToken = function () {
  const crypto = require('crypto');
  // Generate token
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash token and set to resetPasswordToken field
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expire
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Check if account is locked
studentAuthSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

// Increment failed attempts
studentAuthSchema.methods.incrementFailedAttempts = async function () {
  this.failedAttempts += 1;

  // Lock account after 5 failed attempts for 30 minutes
  if (this.failedAttempts >= 5) {
    this.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
  }

  await this.save();
};

// Reset failed attempts on successful login
studentAuthSchema.methods.resetFailedAttempts = async function () {
  this.failedAttempts = 0;
  this.lockUntil = null;
  this.lastLogin = new Date();
  await this.save();
};

module.exports = mongoose.model('StudentAuth', studentAuthSchema);
