const { BrevoClient } = require('@getbrevo/brevo');

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

const sendEmail = async (options) => {
    const result = await brevo.transactionalEmails.sendTransacEmail({
        sender: {
            email: process.env.EMAIL_FROM || 'bhushan.23ad026@sode-edu.in',
            name: process.env.EMAIL_FROM_NAME || 'Faculty Quest'
        },
        to: [{ email: options.email }],
        subject: options.subject,
        htmlContent: options.html || `<p>${options.message || ''}</p>`,
        textContent: options.message
    });

    console.log('✅ Email sent via Brevo. MessageId:', result?.body?.messageId || 'sent');
    return result;
};

module.exports = sendEmail;
