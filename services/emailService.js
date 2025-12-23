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
}

module.exports = new EmailService();
