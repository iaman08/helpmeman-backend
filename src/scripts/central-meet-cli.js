#!/usr/bin/env node
/**
 * Central Google Meet CLI Utility
 *
 * Usage:
 *   node src/scripts/central-meet-cli.js status
 *   node src/scripts/central-meet-cli.js auth-url
 *   node src/scripts/central-meet-cli.js test <mentorEmail> <menteeEmail>
 *   node src/scripts/central-meet-cli.js save-token <refreshToken>
 */

require('dotenv').config();
const {
  checkCentralAccountStatus,
  generateCentralAuthUrl,
  createCentralMeeting,
  saveCentralTokens,
  getCentralAuthedClient,
} = require('../services/centralMeet.service');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  console.log('====================================================');
  console.log('   HelpMeMan Centralized Google Meet CLI Utility    ');
  console.log('====================================================\n');

  switch (command) {
    case 'status': {
      console.log('Checking Central Google Account Status...');
      const status = await checkCentralAccountStatus();
      console.log(JSON.stringify(status, null, 2));
      break;
    }

    case 'auth-url': {
      const returnPath = args[1] || '/superadmin/settings';
      console.log('Generating Central Account Google OAuth Consent URL...\n');
      const url = generateCentralAuthUrl(returnPath);
      console.log('Open this link in your browser to authorize the central Google account:\n');
      console.log(url);
      console.log('\nMake sure to sign in with the central Google account (e.g. admin.helpmeman@gmail.com).');
      break;
    }

    case 'save-token': {
      const token = args[1];
      if (!token) {
        console.error('Error: Please provide a refresh token: node src/scripts/central-meet-cli.js save-token <token>');
        process.exit(1);
      }
      console.log('Saving provided refresh token to PlatformSetting in DB...');
      await saveCentralTokens({ refresh_token: token });
      console.log('Testing connection with new token...');
      const status = await checkCentralAccountStatus();
      console.log(JSON.stringify(status, null, 2));
      break;
    }

    case 'test': {
      const mentorEmail = args[1] || 'mentor.test@helpmeman.com';
      const menteeEmail = args[2] || 'mentee.test@helpmeman.com';

      console.log(`Creating test meeting for Mentor: ${mentorEmail}, Mentee: ${menteeEmail}...`);
      try {
        const meeting = await createCentralMeeting({
          clientId: 'cli-test-client',
          mentorId: 'mentor-cli-01',
          menteeId: 'mentee-cli-01',
          mentorEmail,
          menteeEmail,
          topic: 'HelpMeMan CLI Test Meeting',
          durationMinutes: 30,
        });

        console.log('\n[SUCCESS] Meeting Provisioned:');
        console.log(JSON.stringify(meeting, null, 2));
      } catch (err) {
        console.error('\n[FAILED] Could not create meeting:', err.message);
      }
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Available commands: status, auth-url, save-token, test');
      break;
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err.message);
  process.exit(1);
});
