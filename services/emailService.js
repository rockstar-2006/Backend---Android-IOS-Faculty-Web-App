const { BrevoClient } = require('@getbrevo/brevo');

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

class EmailService {
  constructor() {
    this.sender = {
      email: process.env.EMAIL_FROM || 'bhushan.23ad026@sode-edu.in',
      name: process.env.EMAIL_FROM_NAME || 'Faculty Quest'
    };
  }

  async _send(to, subject, htmlContent) {
    const result = await brevo.transactionalEmails.sendTransacEmail({
      sender: this.sender,
      to: [{ email: to }],
      subject,
      htmlContent
    });
    const messageId = result?.body?.messageId || 'sent';
    console.log(`📧 Brevo email sent to ${to}. ID: ${messageId}`);
    return { success: true, messageId };
  }

  async sendQuizInvitation(studentEmail, quizTitle, uniqueLink, teacherName) {
    const html = `
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
              <li>Complete the quiz within the allocated time</li>
              <li>Make sure you have a stable internet connection</li>
              <li>Do not switch tabs or apps during the quiz</li>
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
    `;

    try {
      return await this._send(studentEmail, `Quiz Invitation: ${quizTitle}`, html);
    } catch (error) {
      console.error(`❌ Error sending quiz invitation to ${studentEmail}:`, error.message);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendPasswordSetupOTP(studentEmail, otp, studentName) {
    const html = `
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
            <p>You requested to set up your password for Faculty Quest. Use the OTP below:</p>
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
              <li>Create a strong password</li>
            </ol>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>Faculty Quest © 2024</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      return await this._send(studentEmail, `Your Password Setup OTP - Faculty Quest`, html);
    } catch (error) {
      console.error(`❌ Error sending OTP to ${studentEmail}:`, error.message);
      throw new Error(`Failed to send OTP email: ${error.message}`);
    }
  }

  async verifyConnection() {
    try {
      if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set');
      console.log('✅ Email service (Brevo) is configured');
      return true;
    } catch (error) {
      console.error('Email service error:', error);
      return false;
    }
  }
}

module.exports = new EmailService();
