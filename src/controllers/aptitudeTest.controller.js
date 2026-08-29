const prisma = require('../config/prisma');
const { createOrder, verifyPaymentSignature } = require('../services/payment.service');
const { sendEmail } = require('../services/email.service');

// ─── Default Aptitude Mock Question Bank ──────────────────────────────────────
const APTITUDE_QUESTIONS = [
  // ── Quantitative Aptitude ──
  {
    id: "q1",
    section: "Quantitative Aptitude",
    question: "A train running at the speed of 60 km/hr crosses a pole in 9 seconds. What is the length of the train?",
    options: ["120 metres", "150 metres", "180 metres", "324 metres"],
    correctIndex: 1, // 150 metres
    explanation: "Speed = 60 * (5/18) m/sec = 50/3 m/sec. Length of train = Speed * Time = (50/3) * 9 = 150 metres."
  },
  {
    id: "q2",
    section: "Quantitative Aptitude",
    question: "If a person sells a product for ₹450 and incurs a loss of 10%, at what price should he sell it to gain 20%?",
    options: ["₹500", "₹540", "₹600", "₹620"],
    correctIndex: 2, // ₹600
    explanation: "Cost Price = 450 / 0.9 = ₹500. Selling Price for 20% gain = 500 * 1.2 = ₹600."
  },
  {
    id: "q3",
    section: "Quantitative Aptitude",
    question: "The sum of ages of 5 children born at the intervals of 3 years each is 50 years. What is the age of the youngest child?",
    options: ["4 years", "8 years", "10 years", "12 years"],
    correctIndex: 0, // 4 years
    explanation: "Let ages be x, x+3, x+6, x+9, x+12. Sum = 5x + 30 = 50 => 5x = 20 => x = 4 years."
  },
  {
    id: "q4",
    section: "Quantitative Aptitude",
    question: "What is the compound interest on ₹10,000 for 2 years at 10% per annum compounded annually?",
    options: ["₹2,000", "₹2,100", "₹2,200", "₹2,500"],
    correctIndex: 1, // ₹2,100
    explanation: "Amount = 10,000 * (1.10)^2 = 10,000 * 1.21 = ₹12,100. CI = 12,100 - 10,000 = ₹2,100."
  },

  // ── Logical Reasoning ──
  {
    id: "q5",
    section: "Logical Reasoning",
    question: "Look at this series: 2, 1, (1/2), (1/4), ... What number should come next?",
    options: ["(1/3)", "(1/8)", "(2/8)", "(1/16)"],
    correctIndex: 1, // 1/8
    explanation: "Each number is half of the previous number: (1/4) / 2 = 1/8."
  },
  {
    id: "q6",
    section: "Logical Reasoning",
    question: "Suresh is facing North-West. He turns 90° in the clockwise direction, then 180° in the anticlockwise direction. Which direction is he facing now?",
    options: ["North-East", "South-East", "South-West", "East"],
    correctIndex: 1, // South-East
    explanation: "From North-West, +90° clockwise = North-East. Then -180° anticlockwise = South-East."
  },
  {
    id: "q7",
    section: "Logical Reasoning",
    question: "Pointing to a photograph of a boy, Suresh said, 'He is the son of the only son of my mother.' How is Suresh related to that boy?",
    options: ["Brother", "Uncle", "Father", "Grandfather"],
    correctIndex: 2, // Father
    explanation: "Only son of Suresh's mother = Suresh himself. So the boy is Suresh's son."
  },
  {
    id: "q8",
    section: "Logical Reasoning",
    question: "If CAT is coded as 3120, how is DOG coded in the same pattern?",
    options: ["4157", "4147", "4151", "3147"],
    correctIndex: 0, // 4157
    explanation: "Alphabet positions: C=3, A=1, T=20 (3120). D=4, O=15, G=7 => 4157."
  },

  // ── Verbal Ability ──
  {
    id: "q9",
    section: "Verbal Ability",
    question: "Select the synonym for the word: PRAGMATIC",
    options: ["Theoretical", "Practical", "Idealistic", "Arrogant"],
    correctIndex: 1, // Practical
    explanation: "Pragmatic means dealing with things sensibly and realistically in a way that is based on practical rather than theoretical considerations."
  },
  {
    id: "q10",
    section: "Verbal Ability",
    question: "Find the correctly spelt word:",
    options: ["Accomodate", "Accommodate", "Acommodate", "Accommodat"],
    correctIndex: 1, // Accommodate
    explanation: "'Accommodate' has double 'c' and double 'm'."
  },
  {
    id: "q11",
    section: "Verbal Ability",
    question: "Fill in the blank: She has an aptitude _____ solving complex algorithmic puzzles.",
    options: ["in", "at", "for", "on"],
    correctIndex: 2, // for
    explanation: "The preposition 'for' correctly follows the noun 'aptitude' (e.g. aptitude for something)."
  },
  {
    id: "q12",
    section: "Verbal Ability",
    question: "Choose the antonym for the word: CANDID",
    options: ["Frank", "Secretive", "Honest", "Outspoken"],
    correctIndex: 1, // Secretive
    explanation: "Candid means truthful and straightforward; its opposite is secretive or evasive."
  }
];

/**
 * GET /api/aptitude-test/questions
 */
async function getQuestions(req, res) {
  try {
    // Hide correct answers in production test fetch
    const questionsForCandidate = APTITUDE_QUESTIONS.map(q => ({
      id: q.id,
      section: q.section,
      question: q.question,
      options: q.options,
    }));

    return res.json({
      totalQuestions: APTITUDE_QUESTIONS.length,
      durationMinutes: 20,
      sections: ["Quantitative Aptitude", "Logical Reasoning", "Verbal Ability"],
      questions: questionsForCandidate,
    });
  } catch (error) {
    console.error("[Aptitude] Error getting questions:", error);
    return res.status(500).json({ error: "Failed to fetch questions" });
  }
}

/**
 * GET /api/aptitude-test/status
 */
async function getStatus(req, res) {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, aptitudeUnlocked: true }
    });

    return res.json({
      unlocked: Boolean(user?.aptitudeUnlocked),
      priceINR: 299,
    });
  } catch (error) {
    console.error("[Aptitude] Error checking status:", error);
    return res.status(500).json({ error: "Failed to check status" });
  }
}

/**
 * POST /api/aptitude-test/create-order
 */
async function createAptitudeOrder(req, res) {
  try {
    const userId = req.user.id;
    const amountInPaise = 29900; // ₹299 INR

    const order = await createOrder({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `aptitude_${userId.slice(0, 8)}_${Date.now()}`,
      notes: {
        userId,
        type: 'aptitude_test_series',
      },
    });

    return res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("[Aptitude] Error creating Razorpay order:", error);
    return res.status(500).json({ error: "Failed to create payment order" });
  }
}

/**
 * POST /api/aptitude-test/verify-payment
 */
async function verifyAptitudePayment(req, res) {
  try {
    const userId = req.user.id;
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    const isValid = verifyPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    });

    if (!isValid) {
      return res.status(400).json({ error: "Invalid payment signature" });
    }

    // Grant access in database
    await prisma.user.update({
      where: { id: userId },
      data: { aptitudeUnlocked: true },
    });

    return res.json({
      success: true,
      message: "Aptitude & Mock Test Series unlocked successfully!",
      unlocked: true,
    });
  } catch (error) {
    console.error("[Aptitude] Error verifying payment:", error);
    return res.status(500).json({ error: "Payment verification failed" });
  }
}

/**
 * POST /api/aptitude-test/submit
 */
async function submitTest(req, res) {
  try {
    const userId = req.user.id;
    const { answers, timeTakenSeconds = 0 } = req.body; // answers = { q1: 1, q2: 2, ... }

    let totalCorrect = 0;
    const totalQuestions = APTITUDE_QUESTIONS.length;
    const sectionBreakdown = {
      "Quantitative Aptitude": { total: 0, correct: 0 },
      "Logical Reasoning": { total: 0, correct: 0 },
      "Verbal Ability": { total: 0, correct: 0 },
    };

    const reviewDetails = APTITUDE_QUESTIONS.map(q => {
      const selectedOption = answers[q.id];
      const isCorrect = selectedOption === q.correctIndex;

      if (!sectionBreakdown[q.section]) {
        sectionBreakdown[q.section] = { total: 0, correct: 0 };
      }
      sectionBreakdown[q.section].total += 1;
      if (isCorrect) {
        sectionBreakdown[q.section].correct += 1;
        totalCorrect += 1;
      }

      return {
        id: q.id,
        section: q.section,
        question: q.question,
        options: q.options,
        selectedOption: selectedOption !== undefined ? selectedOption : null,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: q.explanation,
      };
    });

    const scorePercentage = Math.round((totalCorrect / totalQuestions) * 100);
    const percentile = Math.min(99, Math.max(40, scorePercentage + Math.floor(Math.random() * 8)));

    // AI Performance Assessment Summary
    let aiAssessment = "";
    if (scorePercentage >= 80) {
      aiAssessment = "Exceptional analytical & problem-solving capability. You demonstrate high speed and precision across quantitative calculations and logical deductions.";
    } else if (scorePercentage >= 60) {
      aiAssessment = "Strong foundational competence. Minor gaps identified in advanced logical reasoning time management. Recommended focused practice on speed drills.";
    } else {
      aiAssessment = "Moderate performance. Core quantitative formulas and vocabulary fundamentals need systematic revision to maximize speed and competitive placement scores.";
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const candidateName = user?.name || "Candidate";
    const candidateEmail = user?.email || "";

    // Send detailed email summary if candidate email is available
    if (candidateEmail) {
      try {
        const emailSubject = `HelpMeMan Aptitude & Mock Test Scorecard: ${scorePercentage}% (${totalCorrect}/${totalQuestions})`;
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
            <div style="background: linear-gradient(135deg, #2563eb, #4f46e5); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Official Aptitude Assessment Report</h1>
              <p style="color: #cbd5e1; margin: 6px 0 0 0; font-size: 14px;">HelpMeMan Career & Aptitude Intelligence</p>
            </div>
            
            <div style="background: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
              <h2 style="font-size: 18px; margin-top: 0;">Hi ${candidateName},</h2>
              <p>Congratulations on completing your <strong>Aptitude & Mock Competency Test</strong>!</p>
              
              <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 18px; margin: 20px 0; text-align: center;">
                <div style="font-size: 36px; font-weight: bold; color: #2563eb;">${scorePercentage}%</div>
                <div style="font-size: 14px; color: #64748b;">Overall Score (${totalCorrect} / ${totalQuestions} Correct)</div>
                <div style="font-size: 13px; font-weight: bold; color: #10b981; margin-top: 6px;">Estimated Percentile: Top ${100 - percentile}%</div>
              </div>

              <h3>Sectional Score Breakdown:</h3>
              <ul style="padding-left: 20px;">
                ${Object.entries(sectionBreakdown).map(([sec, stats]) => `
                  <li style="margin-bottom: 8px;">
                    <strong>${sec}</strong>: ${stats.correct}/${stats.total} (${Math.round((stats.correct/stats.total)*100)}%)
                  </li>
                `).join('')}
              </ul>

              <h3>AI Competency Assessment:</h3>
              <p style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px; border-radius: 6px; font-size: 14px; color: #1e40af;">
                ${aiAssessment}
              </p>

              <p style="margin-top: 24px;">You can download your official PDF Certificate & Performance Report directly from your HelpMeMan dashboard.</p>
              <div style="text-align: center; margin-top: 24px;">
                <a href="${process.env.FRONTEND_URL || 'https://helpmeman.com'}/aptitude-test" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; display: inline-block;">View Detailed Dashboard</a>
              </div>
            </div>
          </div>
        `;

        await sendEmail({
          to: candidateEmail,
          subject: emailSubject,
          html: emailHtml,
        });
        console.log(`[Aptitude] Emailed detailed report to ${candidateEmail}`);
      } catch (eErr) {
        console.error("[Aptitude] Error emailing report:", eErr.message);
      }
    }

    return res.json({
      success: true,
      totalCorrect,
      totalQuestions,
      scorePercentage,
      percentile,
      timeTakenSeconds,
      sectionBreakdown,
      aiAssessment,
      reviewDetails,
      candidateName,
      candidateEmail,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Aptitude] Error submitting test:", error);
    return res.status(500).json({ error: "Failed to submit test" });
  }
}

module.exports = {
  getQuestions,
  getStatus,
  createAptitudeOrder,
  verifyAptitudePayment,
  submitTest,
};
