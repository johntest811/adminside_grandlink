/**
 * Test Email Sending Script
 * Run this to verify your email setup is working
 * 
 * Usage:
 *   node test-email.js your-email@example.com
 *   node test-email.js your-email@example.com --backup
 */

require('dotenv').config({ path: '.env.local' });

function cleanPass(pass) {
  return String(pass || "").replace(/\s+/g, "");
}

function createGmailTransporter({ user, pass }) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass: cleanPass(pass),
    },
  });
}

async function sendTestMail({ transporter, from, to, subject, html }) {
  await transporter.sendMail({ from, to, subject, html });
}

async function testGmail({ preferBackup = false } = {}) {
  console.log('\n🧪 Testing Gmail SMTP (Primary + Backup Failover)...\n');

  const to = process.argv.find((arg) => arg && !arg.startsWith('-') && arg.includes('@')) || process.env.GMAIL_USER;
  if (!to) {
    console.log('❌ Missing recipient email.');
    console.log('   Usage: node test-email.js your-email@example.com');
    return { ok: false };
  }

  const primaryConfigured = Boolean(process.env.GMAIL_USER && process.env.GMAIL_PASS);
  const backupConfigured = Boolean(process.env.GMAIL_BACKUP_USER && process.env.GMAIL_BACKUP_PASS);

  if (!primaryConfigured && !backupConfigured) {
    console.log('❌ No Gmail credentials configured.');
    console.log('   Set GMAIL_USER/GMAIL_PASS and optionally GMAIL_BACKUP_USER/GMAIL_BACKUP_PASS in .env.local');
    return { ok: false };
  }

  const providers = [];
  if (primaryConfigured) {
    providers.push({
      key: 'gmail_primary',
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
      from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
    });
  }
  if (backupConfigured) {
    providers.push({
      key: 'gmail_backup',
      user: process.env.GMAIL_BACKUP_USER,
      pass: process.env.GMAIL_BACKUP_PASS,
      from: process.env.GMAIL_BACKUP_FROM || process.env.GMAIL_BACKUP_USER,
    });
  }

  const ordered = preferBackup && providers.length > 1
    ? [providers.find((p) => p.key === 'gmail_backup'), providers.find((p) => p.key === 'gmail_primary')].filter(Boolean)
    : providers;

  console.log(`📧 Sending test email to: ${to}`);

  let lastErr = null;
  for (const provider of ordered) {
    console.log(`\n➡️  Trying provider: ${provider.key} (${provider.user})`);
    try {
      const transporter = createGmailTransporter({ user: provider.user, pass: provider.pass });
      await sendTestMail({
        transporter,
        from: provider.from,
        to,
        subject: `✅ Gmail SMTP Test (${provider.key}) - Grand Link`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>✅ Gmail SMTP Test Email</h2>
            <p>This email confirms your <strong>${provider.key}</strong> credentials can send via SMTP.</p>
            <p><strong>From:</strong> ${provider.from}</p>
            <p><strong>To:</strong> ${to}</p>
            <p style="color: #666; font-size: 12px;">Grand Link admin system test.</p>
          </div>
        `,
      });
      console.log('✅ Email sent successfully!');
      return { ok: true, provider: provider.key };
    } catch (err) {
      lastErr = err;
      console.error('❌ Send failed:', err && err.message ? err.message : String(err));
    }
  }

  return { ok: false, error: lastErr && lastErr.message ? lastErr.message : String(lastErr) };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  📧 Grand Link Email Configuration Test');
  console.log('═══════════════════════════════════════════════');

  const preferBackup = process.argv.includes('--backup') || process.argv.includes('--prefer-backup');
  const result = await testGmail({ preferBackup });

  console.log('\n═══════════════════════════════════════════════');
  console.log('  📊 Test Results Summary');
  console.log('═══════════════════════════════════════════════');

  if (result.ok) {
    console.log(`\n✅ OK: Email sent via ${result.provider}`);
    console.log('   Check inbox (and Spam) for the test email.\n');
  } else {
    console.log('\n❌ FAILED: Could not send test email via Gmail SMTP');
    if (result.error) console.log(`   Error: ${result.error}`);
    console.log('\n💡 Tips:');
    console.log('   - Use a Gmail App Password (not your normal password)');
    console.log('   - Ensure 2-Step Verification is enabled on the sending Gmail');
    console.log('   - Confirm GMAIL_USER/GMAIL_PASS (and optional GMAIL_BACKUP_*) are set');
  }

  console.log('═══════════════════════════════════════════════\n');
}

// Run tests
main().catch(console.error);
