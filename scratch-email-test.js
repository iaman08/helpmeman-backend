const { sendOtpEmail } = require('./src/services/email.service');

async function test() {
  console.log('Sending test OTP email to teamgantavai@gmail.com...');
  try {
    const res = await sendOtpEmail({
      email: 'teamgantavai@gmail.com',
      name: 'Test User',
      otp: '123456',
      purpose: 'verify'
    });
    console.log('Result:', res);
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

test();
