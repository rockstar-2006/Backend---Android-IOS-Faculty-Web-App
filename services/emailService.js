const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    // Configure nodemailer with Gmail
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  }

  async sendQuizInvitation(studentEmail, quizTitle, uniqueLink, teacherName) {
    const mailOptions = {
      from: `"${teacherName}" <${process.env.EMAIL_USER}>`,
      to: studentEmail,
      subject: `Quiz Invitation: ${quizTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 15px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            .info-box { background: white; padding: 15px; border-left: 4px solid #667eea; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📝 Quiz Invitation</h1>
            </div>
            <div class="content">
              <h2>Hello!</h2>
              <p>You have been invited by <strong>${teacherName}</strong> to attempt a quiz.</p>
              
              <div class="info-box">
                <h3 style="margin-top: 0;">Quiz: ${quizTitle}</h3>
                <p style="margin-bottom: 0;">Click the button below to access your personalized quiz link.</p>
              </div>

              <p style="text-align: center;">
                <a href="${uniqueLink}" class="button">Start Quiz</a>
              </p>

              <p><strong>Important Instructions:</strong></p>
              <ul>
                <li>This link is unique to you and should not be shared</li>
                <li>You'll need to enter your details before starting</li>
                <li>Complete the quiz within the allocated time</li>
                <li>Make sure you have a stable internet connection</li>
              </ul>

              <div class="info-box">
                <p style="margin: 0;"><strong>Link:</strong> <a href="${uniqueLink}">${uniqueLink}</a></p>
              </div>

              <p>Good luck with your quiz!</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  // Verify email configuration
  async verifyConnection() {
    try {
      await this.transporter.verify();
      console.log('Email service is ready');
      return true;
    } catch (error) {
      console.error('Email service error:', error);
      return false;
    }
  }

  // 🔒 NEW: Send OTP for password setup
  async sendPasswordSetupOTP(studentEmail, otp, studentName) {
    const mailOptions = {
      from: `"Faculty Quest" <${process.env.EMAIL_USER}>`,
      to: studentEmail,
      subject: `Your Password Setup OTP - Faculty Quest`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .otp-box { background: white; padding: 30px; border: 2px solid #667eea; border-radius: 10px; text-align: center; margin: 20px 0; }
            .otp-code { font-size: 48px; font-weight: bold; color: #667eea; letter-spacing: 5px; font-family: monospace; }
            .timer { color: #e74c3c; font-weight: bold; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Password Setup</h1>
            </div>
            <div class="content">
              <h2>Hello ${studentName}!</h2>
              <p>You requested to set up your password for Faculty Quest. Use the OTP below to verify your identity:</p>
              
              <div class="otp-box">
                <p style="margin-top: 0; color: #666;">Your One-Time Password</p>
                <div class="otp-code">${otp}</div>
              </div>

              <div class="warning">
                <strong>⚠️ Important:</strong>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>This OTP is valid for <span class="timer">10 minutes only</span></li>
                  <li>Never share this OTP with anyone</li>
                  <li>If you didn't request this, ignore this email</li>
                </ul>
              </div>

              <h3>How to proceed:</h3>
              <ol>
                <li>Go to the Faculty Quest password setup page</li>
                <li>Enter your email: <strong>${studentEmail}</strong></li>
                <li>Enter the OTP: <strong>${otp}</strong></li>
                <li>Create a strong password (min 8 chars: uppercase, lowercase, number)</li>
                <li>Click "Set Password"</li>
              </ol>

              <p>Once set, you can use your email and password to login to Faculty Quest.</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply.</p>
              <p>Faculty Quest © 2024</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('OTP email sent successfully:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error sending OTP email:', error);
      throw new Error(`Failed to send OTP email: ${error.message}`);
    }
  }
}

module.exports = new EmailService();
