/**
 * Test Email Sending Script
 * Run this to verify your email setup is working
 * 
 * Usage:
 *   node test-email.js your-email@example.com
 */

require('dotenv').config({ path: '.env.local' });

async function testSendGrid() {
  console.log('\n🧪 Testing SendGrid Email Setup...\n');
  
  // Check if SendGrid is configured
  if (!process.env.SENDGRID_API_KEY) {
    console.log('❌ SENDGRID_API_KEY not found in .env.local');
    console.log('⚠️  Please add your SendGrid API key to .env.local\n');
    return false;
  }

  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const testEmail = process.argv[2] || process.env.SENDGRID_FROM_EMAIL || 'test@example.com';
  
  console.log(`📧 Sending test email to: ${testEmail}`);
  console.log(`📤 From: ${process.env.SENDGRID_FROM_EMAIL || 'Not configured'}\n`);

  const msg = {
    to: testEmail,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@grandlink.com',
      name: process.env.SENDGRID_FROM_NAME || 'Grand Link'
    },
    subject: '✅ SendGrid Test Email - Grand Link',
    text: 'This is a test email from Grand Link. If you received this, SendGrid is working correctly!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #4CAF50;">✅ Email Setup Successful!</h1>
        <p>Congratulations! Your SendGrid email integration is working correctly.</p>
        <p><strong>Configuration Details:</strong></p>
        <ul>
          <li>From Email: ${process.env.SENDGRID_FROM_EMAIL}</li>
          <li>From Name: ${process.env.SENDGRID_FROM_NAME}</li>
          <li>To Email: ${testEmail}</li>
        </ul>
        <p>You can now send unlimited emails to your users!</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is a test email sent from Grand Link admin system.
        </p>
      </div>
    `,
  };

  try {
    const response = await sgMail.send(msg);
    console.log('✅ Email sent successfully!');
    console.log(`📊 Status Code: ${response[0].statusCode}`);
    console.log(`\n🎉 SendGrid is configured correctly!\n`);
    console.log(`💡 Next steps:`);
    console.log(`   1. Check your inbox at ${testEmail}`);
    console.log(`   2. Check spam folder if not found`);
    console.log(`   3. View sending stats at https://app.sendgrid.com/statistics\n`);
    return true;
  } catch (error) {
    console.error('❌ Error sending email:');
    
    if (error.response) {
      console.error('Status:', error.response.statusCode);
      console.error('Body:', error.response.body);
      
      if (error.response.body.errors) {
        error.response.body.errors.forEach(err => {
          console.error(`  - ${err.message}`);
          if (err.field) console.error(`    Field: ${err.field}`);
        });
      }
    } else {
      console.error(error.message);
    }
    
    console.log('\n💡 Common Issues:');
    console.log('   1. Invalid API key - Check your SENDGRID_API_KEY in .env.local');
    console.log('   2. Sender not verified - Verify your sender email in SendGrid dashboard');
    console.log('   3. API key lacks permissions - Ensure "Mail Send" permission is enabled');
    console.log('\n📖 Documentation: https://docs.sendgrid.com/\n');
    return false;
  }
}

async function testGmail() {
  console.log('\n🧪 Testing Gmail Fallback (Has Daily Limits)...\n');
  
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.log('⚠️  Gmail not configured (GMAIL_USER or GMAIL_PASS missing)');
    console.log('   This is OK - SendGrid is your primary email service\n');
    return false;
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  const testEmail = process.argv[2] || process.env.GMAIL_USER;
  
  console.log(`📧 Sending test email to: ${testEmail}`);
  console.log(`📤 From: ${process.env.GMAIL_FROM || process.env.GMAIL_USER}\n`);

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
      to: testEmail,
      subject: '✅ Gmail Test Email - Grand Link (Fallback)',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #FFA500;">⚠️ Gmail Fallback Working</h1>
          <p>This email was sent using Gmail (fallback method).</p>
          <p><strong>Important:</strong> Gmail has a daily limit of 500 emails.</p>
          <p>We recommend using SendGrid for production.</p>
        </div>
      `,
    });
    
    console.log('✅ Gmail email sent successfully!');
    console.log('⚠️  Remember: Gmail has a 500 emails/day limit\n');
    return true;
  } catch (error) {
    console.error('❌ Gmail error:', error.message);
    
    if (error.message.includes('Daily user sending limit exceeded')) {
      console.log('\n🚨 You\'ve hit Gmail\'s daily limit!');
      console.log('   This is why you need SendGrid.\n');
    }
    
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  📧 Grand Link Email Configuration Test');
  console.log('═══════════════════════════════════════════════');
  
  const sendGridWorks = await testSendGrid();
  
  console.log('\n───────────────────────────────────────────────\n');
  
  await testGmail();
  
  console.log('\n═══════════════════════════════════════════════');
  console.log('  📊 Test Results Summary');
  console.log('═══════════════════════════════════════════════');
  
  if (sendGridWorks) {
    console.log('\n✅ PRIMARY: SendGrid is working correctly!');
    console.log('   Your emails will be sent via SendGrid.');
    console.log('   No more daily limit issues! 🎉\n');
  } else {
    console.log('\n❌ PRIMARY: SendGrid needs configuration');
    console.log('   Follow the setup guide in EMAIL_SETUP_GUIDE.md\n');
  }
  
  console.log('═══════════════════════════════════════════════\n');
}

// Run tests
main().catch(console.error);
