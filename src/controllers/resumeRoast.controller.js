const multer = require('multer');
const pdfParse = require('pdf-parse');
const Groq = require('groq-sdk');
const config = require('../config/env');
const prisma = require('../config/prisma');

// Memory storage for file upload
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(pdf|txt|doc|docx)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload a PDF or TXT file.'));
    }
  },
}).single('resume');

let groqClient = null;
function getGroq() {
  if (!config.groq.apiKey) throw new Error('GROQ_API_KEY not configured');
  if (!groqClient) groqClient = new Groq({ apiKey: config.groq.apiKey });
  return groqClient;
}

/**
 * Controller to handle resume upload/text analysis & ATS roast
 */
async function analyzeResume(req, res) {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }

    try {
      const { targetRole, portfolioUrl, rawText } = req.body;
      let resumeText = '';

      // Extract text from uploaded file or text input
      if (req.file) {
        if (req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
          const pdfData = await pdfParse(req.file.buffer);
          resumeText = pdfData.text || '';
        } else {
          resumeText = req.file.buffer.toString('utf-8');
        }
      } else if (rawText && typeof rawText === 'string') {
        resumeText = rawText;
      }

      if (!resumeText || resumeText.trim().length < 30) {
        return res.status(400).json({
          error: 'Unable to extract readable text from the uploaded resume. Please upload a clear PDF or paste text directly.',
        });
      }

      const role = targetRole && targetRole.trim() ? targetRole.trim() : 'Software Engineer';
      const portfolio = portfolioUrl ? portfolioUrl.trim() : '';

      const groq = getGroq();

      const systemPrompt = `You are the World's Most Elite ATS (Applicant Tracking System) Expert & High-Tech Resume Roaster.
Your mission is to analyze resumes strictly against modern HR ATS parsers and real-world hiring standards for the target role: "${role}".

Respond ONLY with a valid JSON object matching the following structure exactly (no markdown wrapping, no extra keys):
{
  "atsScore": <number between 35 and 98 representing overall ATS score>,
  "ratingTier": "<'Top 5% Elite' | 'Competitive' | 'Needs Optimization' | 'High Risk of ATS Rejection'>",
  "subScores": {
    "keywords": <number 0-100>,
    "formatting": <number 0-100>,
    "impactMetrics": <number 0-100>,
    "roleRelevance": <number 0-100>
  },
  "summary": "<2 sentence crisp summary of the resume candidate>",
  "theRoast": "<A witty, sharp, humorous yet highly constructive 2-3 sentence roast calling out cliché buzzwords, lack of numbers, or formatting quirks>",
  "strengths": [
    "<Strength 1>",
    "<Strength 2>",
    "<Strength 3>"
  ],
  "missingKeywords": [
    "<High-yield missing keyword 1>",
    "<High-yield missing keyword 2>",
    "<High-yield missing keyword 3>",
    "<High-yield missing keyword 4>",
    "<High-yield missing keyword 5>"
  ],
  "bulletRewrites": [
    {
      "original": "<original weak bullet from resume>",
      "optimized": "<AI action-verb + metric-driven STAR bullet>",
      "reasoning": "<why this change improves ATS scoring>"
    },
    {
      "original": "<original weak bullet from resume>",
      "optimized": "<AI action-verb + metric-driven STAR bullet>",
      "reasoning": "<why this change improves ATS scoring>"
    },
    {
      "original": "<original weak bullet from resume>",
      "optimized": "<AI action-verb + metric-driven STAR bullet>",
      "reasoning": "<why this change improves ATS scoring>"
    }
  ],
  "correctedResumeText": "<Fully edited, clean, ATS-optimized markdown text version of the entire resume>",
  "portfolioTips": [
    "<Actionable tip 1 for GitHub/portfolio/projects>",
    "<Actionable tip 2 for interview readiness>"
  ]
}`;

      const userPrompt = `TARGET ROLE: ${role}
PORTFOLIO URL: ${portfolio || 'N/A'}

RESUME TEXT CONTENT:
"""
${resumeText.slice(0, 7000)}
"""`;

      const completion = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const responseText = completion.choices[0]?.message?.content || '{}';
      let jsonResult;
      try {
        jsonResult = JSON.parse(responseText);
      } catch (pErr) {
        console.error('Failed to parse AI JSON response:', responseText);
        return res.status(500).json({ error: 'AI analysis output error. Please try again.' });
      }

      // Fetch top 3 matching mentors for this role to recommend
      let mentors = [];
      try {
        const queryRole = role.toLowerCase();
        mentors = await prisma.mentor.findMany({
          where: {
            approvalStatus: 'APPROVED',
            isActive: true,
          },
          take: 3,
          select: {
            id: true,
            displayName: true,
            currentRole: true,
            company: true,
            institutionName: true,
            avatar: true,
            pricePerSession: true,
            rating: true,
          },
          orderBy: { rating: 'desc' },
        });
      } catch (mErr) {
        console.warn('Could not fetch mentors for recommendation:', mErr);
      }

      return res.json({
        success: true,
        role,
        analysis: jsonResult,
        recommendedMentors: mentors,
      });
    } catch (error) {
      console.error('Resume roast error:', error);
      return res.status(500).json({ error: error.message || 'Internal server error analyzing resume' });
    }
  });
}

module.exports = {
  analyzeResume,
};
