'use strict';

const nodemailer = require('nodemailer');
const config = require('../config/config');

let ResendClient = null;
try {
  const { Resend } = require('resend');
  ResendClient = Resend;
} catch (e) {
  // Loaded dynamically if installed
}

/**
 * Build the branded Spider-Sense HTML template for OTP verification
 */
const getEmailTemplate = (otp, type = 'login') => {
  const isLogin = type === 'login';
  const title = isLogin ? 'Your Spider-Sense Login Code' : 'Verify Your NYC Citizen Account';
  const subtitle = isLogin
    ? 'Use the single-use 6-digit verification code below to securely authenticate to the Spider-Sense Emergency Response Network.'
    : 'Welcome to the Spider-Sense Emergency Network. Enter this 6-digit verification code to complete your account registration.';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background-color: #0b0f19;
          color: #f0f6fc;
          margin: 0;
          padding: 30px 15px;
        }
        .container {
          max-width: 520px;
          margin: 0 auto;
          background-color: #161b22;
          border: 2px solid #e63946;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(230, 57, 70, 0.25);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #1f242c 0%, #161b22 100%);
          border-bottom: 2px solid #30363d;
          padding: 24px;
          text-align: center;
        }
        .spider-badge {
          display: inline-block;
          background-color: #e63946;
          color: #ffffff;
          padding: 6px 14px;
          font-weight: 800;
          font-size: 12px;
          letter-spacing: 1.5px;
          border-radius: 999px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .content {
          padding: 32px 24px;
          text-align: center;
        }
        .title {
          font-size: 22px;
          font-weight: 800;
          margin: 0 0 12px 0;
          color: #ffffff;
        }
        .subtitle {
          font-size: 14px;
          color: #8b949e;
          line-height: 1.6;
          margin: 0 0 24px 0;
        }
        .otp-container {
          margin: 20px 0 26px 0;
        }
        .otp-box {
          background-color: #0d1117;
          border: 2px solid #e63946;
          border-radius: 8px;
          padding: 16px 28px;
          display: inline-block;
          font-size: 38px;
          font-weight: 900;
          letter-spacing: 12px;
          color: #f0f6fc;
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          box-shadow: 0 0 16px rgba(230, 57, 70, 0.35);
        }
        .security-note {
          background-color: rgba(230, 57, 70, 0.1);
          border: 1px solid rgba(230, 57, 70, 0.3);
          border-radius: 8px;
          padding: 12px 16px;
          font-size: 12px;
          color: #ff949b;
          font-weight: 600;
          margin-top: 20px;
          line-height: 1.5;
        }
        .footer {
          border-top: 1px solid #30363d;
          padding: 18px 24px;
          text-align: center;
          font-size: 12px;
          color: #6e7681;
          background-color: #0d1117;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="spider-badge">🕷️ SPIDER-SENSE NYC</div>
          <div style="font-weight: 800; font-size: 18px; color: #ffffff;">EMERGENCY DISPATCH NETWORK</div>
          <div style="font-size: 12px; color: #8b949e; margin-top: 4px;">Verified Citizen & Superhero Authentication</div>
        </div>
        <div class="content">
          <h1 class="title">${title}</h1>
          <p class="subtitle">${subtitle}</p>
          <div class="otp-container">
            <div class="otp-box">${otp}</div>
          </div>
          <div class="security-note">
            ⚠️ This code expires in 10 minutes and can only be used once.<br>
            Never share this emergency verification code with anyone.
          </div>
        </div>
        <div class="footer">
          If you did not request this verification code, please ignore this email.<br>
          © 2026 Spider-Sense Emergency Alert Network • Five Boroughs Command
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Send OTP Verification Email via Gmail SMTP or Resend API fallback
 */
const sendOtpEmail = async (email, otp, type = 'login') => {
  const cleanEmail = email.toLowerCase().trim();
  const htmlContent = getEmailTemplate(otp, type);
  const textContent = `Your Spider-Sense verification code is: ${otp}\n\nThis code expires in 10 minutes and can only be used once.\nNever share this code with anyone.`;
  const subject = `[Spider-Sense] ${otp} is your verification code`;

  const errors = [];

  // 1. Try Gmail SMTP first (Universal: sends to ANY email domain without restriction)
  if (config.emailUser && config.emailPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: config.emailUser,
          pass: config.emailPass
        }
      });

      const fromAddress = `"Spider-Sense Dispatch" <${config.emailUser}>`;
      const info = await transporter.sendMail({
        from: fromAddress,
        to: cleanEmail,
        subject,
        text: textContent,
        html: htmlContent
      });

      console.log(`✉️ [Gmail SMTP] Verification email sent to ${cleanEmail} (ID: ${info.messageId})`);
      return { success: true, provider: 'smtp', id: info.messageId };
    } catch (smtpErr) {
      console.warn(`⚠️ [SMTP Notice] SMTP delivery failed to ${cleanEmail}: ${smtpErr.message}`);
      errors.push(`Gmail SMTP: ${smtpErr.message}`);
    }
  } else {
    errors.push('Gmail SMTP: credentials not configured');
  }

  // 2. Try Resend API (Secondary/Fallback)
  if (config.resendApiKey && config.resendApiKey.trim() !== '') {
    try {
      if (!ResendClient) {
        const { Resend } = require('resend');
        ResendClient = Resend;
      }
      const resend = new ResendClient(config.resendApiKey.trim());
      const fromAddress = config.emailFrom || 'Spider-Sense Dispatch <onboarding@resend.dev>';

      const response = await resend.emails.send({
        from: fromAddress,
        to: cleanEmail,
        subject,
        text: textContent,
        html: htmlContent
      });

      if (response && response.error) {
        throw new Error(response.error.message || 'Resend delivery rejected');
      }

      console.log(`✉️ [Resend] Verification email delivered to ${cleanEmail} (ID: ${response?.data?.id || 'OK'})`);
      return { success: true, provider: 'resend', id: response?.data?.id };
    } catch (resendErr) {
      console.warn(`⚠️ [Resend Notice] Resend delivery failed to ${cleanEmail}: ${resendErr.message}`);
      errors.push(`Resend: ${resendErr.message}`);
    }
  } else {
    errors.push('Resend: API key not configured');
  }

  // 3. Fallback print in console and return transparent diagnostics
  console.log(`\n======================================================`);
  console.log(`🔑 FALLBACK OTP FOR ${cleanEmail}: >>> [ ${otp} ] <<<`);
  console.log(`⚠️ REASON: ${errors.join('; ')}`);
  console.log(`======================================================\n`);

  return {
    success: false,
    error: errors.join('; '),
    provider: 'failed',
    devOtp: otp
  };
};

module.exports = {
  sendOtpEmail,
  getEmailTemplate
};

