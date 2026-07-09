const fs = require('fs');
const path = require('path');

// Dynamically load pdfkit or install it first
async function main() {
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch (err) {
    console.log("pdfkit not found, installing...");
    const { execSync } = require('child_process');
    execSync('npm install pdfkit', { cwd: __dirname, stdio: 'inherit' });
    PDFDocument = require('pdfkit');
  }

  const doc = new PDFDocument({ margin: 50 });
  const outputPath = path.join(__dirname, 'HelpMeMan_Data_And_Permissions.pdf');
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // Styling helpers
  const primaryColor = '#4F46E5'; // Indigo
  const secondaryColor = '#1E293B'; // Dark Slate
  const textColor = '#334155'; // Muted Slate
  const lightBg = '#F8FAFC'; // Very light slate
  const accentColor = '#0EA5E9'; // Sky blue

  // Title / Header Banner
  doc.rect(0, 0, 612, 120).fill(primaryColor);
  
  doc.fillColor('#FFFFFF')
     .font('Helvetica-Bold')
     .fontSize(24)
     .text('HelpMeMan', 50, 40)
     .fontSize(14)
     .font('Helvetica')
     .text('Data Access & Permissions Report', 50, 70);

  let y = 140;

  function checkPageBreak(neededHeight) {
    if (y + neededHeight > 750) {
      doc.addPage();
      y = 50;
    }
  }

  // Subtitle
  doc.fillColor(secondaryColor)
     .font('Helvetica-Oblique')
     .fontSize(10)
     .text('Generated on: ' + new Date().toLocaleDateString() + ' | Platform Data Privacy Audit', 50, y);
  y += 25;

  // Horizontal line
  doc.moveTo(50, y).lineTo(562, y).strokeColor('#E2E8F0').lineWidth(1).stroke();
  y += 15;

  // Introduction
  doc.fillColor(textColor)
     .font('Helvetica')
     .fontSize(10)
     .text('This document outlines the data elements collected, stored, and processed by the HelpMeMan mentorship platform, along with the device-level and third-party API permissions required from Users (Mentees) and Mentors to deliver mentorship sessions.', 50, y, { width: 512, align: 'justify' });
  y += 45;

  // SECTION 1: Users (Mentees)
  checkPageBreak(150);
  doc.fillColor(primaryColor)
     .font('Helvetica-Bold')
     .fontSize(14)
     .text('1. Data Collected from Users (Mentees)', 50, y);
  y += 20;

  const userData = [
    { title: 'Account & Profile Data', desc: 'Name, Preferred Name, Email Address, Phone Number (Optional), Avatar URL, and Password Hash.' },
    { title: 'Booking & Session Data', desc: 'Meeting dates/times, duration, transaction/payment status, amount paid, meeting join links, and customized session notes.' },
    { title: 'Chat & Communication', desc: 'Full transcript of text messages exchanged with mentors, status of message reading, and interaction timestamps.' },
    { title: 'AI Assistant & Memory', desc: 'AI conversation history, session counts, and a rolling distilled summary (≤150 tokens) used to retain context across AI interactions.' },
    { title: 'Logs & User Preferences', desc: 'Notification settings (email preferences for updates, marketing, and messages), device push token logs, and system email delivery/retry records.' }
  ];

  userData.forEach(item => {
    checkPageBreak(50);
    // Draw small square bullet
    doc.rect(50, y + 3, 6, 6).fill(primaryColor);
    doc.fillColor(secondaryColor)
       .font('Helvetica-Bold')
       .fontSize(10)
       .text(item.title + ':', 65, y);
    
    const textWidth = doc.widthOfString(item.title + ': ');
    doc.fillColor(textColor)
       .font('Helvetica')
       .text(item.desc, 65 + textWidth, y, { width: 512 - (15 + textWidth), align: 'justify' });
    
    const descHeight = doc.heightOfString(item.desc, { width: 512 - (15 + textWidth) });
    y += Math.max(18, descHeight) + 8;
  });

  y += 10;

  // SECTION 2: Mentors
  checkPageBreak(150);
  doc.fillColor(primaryColor)
     .font('Helvetica-Bold')
     .fontSize(14)
     .text('2. Data Collected from Mentors', 50, y);
  y += 20;

  const mentorData = [
    { title: 'Core Professional Info', desc: 'Display Name, detailed bio, summary of professional background, skills, and areas of mentoring expertise.' },
    { title: 'Verification & Credentials', desc: 'Institution Type (College/Company/Startup), name of organization, verified institutional/work email, department, graduation year, current role, and LinkedIn URL.' },
    { title: 'Identity Documents', desc: 'Uploaded verification files (e.g., credentials, degrees, company ID cards) hosted securely on Cloudinary to prove background credentials.' },
    { title: 'Availability & Rates', desc: 'Pricing per session, default session duration (default 30 mins), and weekly recurring availability days and time-slots.' },
    { title: 'Onboarding & Screening', desc: 'Custom responses submitted during the mentor screening questionnaire, onboarding status, and administrator screening feedback.' },
    { title: 'Financial logs', desc: 'Accumulated earnings tracker, payout records, amounts paid, status of booking fee distributions, and transaction IDs.' }
  ];

  mentorData.forEach(item => {
    checkPageBreak(50);
    doc.rect(50, y + 3, 6, 6).fill(accentColor);
    doc.fillColor(secondaryColor)
       .font('Helvetica-Bold')
       .fontSize(10)
       .text(item.title + ':', 65, y);
    
    const textWidth = doc.widthOfString(item.title + ': ');
    doc.fillColor(textColor)
       .font('Helvetica')
       .text(item.desc, 65 + textWidth, y, { width: 512 - (15 + textWidth), align: 'justify' });
    
    const descHeight = doc.heightOfString(item.desc, { width: 512 - (15 + textWidth) });
    y += Math.max(18, descHeight) + 8;
  });

  y += 10;

  // SECTION 3: System & Integration Permissions
  checkPageBreak(150);
  doc.fillColor(primaryColor)
     .font('Helvetica-Bold')
     .fontSize(14)
     .text('3. Permissions & Third-Party Services Access', 50, y);
  y += 20;

  const integrationData = [
    { name: 'Browser Push Notifications', details: 'Requests native system permissions via Notification.requestPermission() to register browser device push tokens for instant message alerts.' },
    { name: 'Google Calendar & Meet', details: 'Integrates with calendar scopes to schedule bookings, invite attendees by email, update slots dynamically, and generate standard Google Meet links.' },
    { name: 'Firebase / Google Authentication', details: 'Accesses user Name, Email, and Profile photo link from the Google ID Token via Google sign-in popups.' },
    { name: 'Razorpay Payment Gateway', details: 'Accesses payment details, signature hashes, order status, and webhook payloads to securely facilitate and verify transactions.' },
    { name: 'Cloudinary Media Storage', details: 'Uploads and hosts public avatars and encrypted verification documents.' },
    { name: 'Brevo SMTP Email', details: 'Uses SMTP keys to send transactional emails, onboarding verifications, OTP verification codes, and booking status alerts.' }
  ];

  integrationData.forEach(item => {
    checkPageBreak(70);
    // Draw shaded background box for integrations
    doc.rect(50, y, 512, 45).fill(lightBg);
    
    doc.fillColor(secondaryColor)
       .font('Helvetica-Bold')
       .fontSize(9.5)
       .text(item.name, 60, y + 6);
       
    doc.fillColor(textColor)
       .font('Helvetica')
       .fontSize(8.5)
       .text(item.details, 60, y + 20, { width: 492, align: 'left' });
       
    y += 52;
  });

  // Footer on each page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor('#94A3B8')
       .font('Helvetica')
       .fontSize(8)
       .text('HelpMeMan Security & Privacy Directory | Confidential & Proprietary Information', 50, 755, { align: 'center', width: 512 });
  }

  doc.end();

  stream.on('finish', () => {
    console.log(`PDF successfully generated at: ${outputPath}`);
  });
}

main().catch(err => {
  console.error("Error executing script:", err);
  process.exit(1);
});
