# Mentor onboarding: developer guide

Checked locally on 25 October 2026. The frontend and backend are separate repositories.

## Workflow

1. Entry points: the mentor signup modal and /apply-mentor support email/password plus email OTP or Google sign-in. /become-a-mentor offers LinkedIn import or the manual interview. Signup collects a name, email, password, terms/privacy consent and an optional phone number; email OTP verifies the signup address.
2. Authentication lives in the frontend AuthProvider (lib/auth-context.tsx). The Express auth controller syncs the Supabase identity to the Prisma User. New mentor signup initializes a MentorProfile and MentorOnboarding draft, without making the candidate publicly bookable. Returning Google users retain their existing admin approval or rejection.
3. /onboarding?role=mentor selects the mentor role and offers LinkedIn or manual entry. The manual page first asks for a name and then displays one question at a time. The backend owns the real questionnaire and chooses one of four fixed question sets from the track answer. Ruth is conversational presentation around this fixed interview; it does not independently choose new questions.
4. Each POST saves the answer, conversation messages, question position and a MentorMemory in a transaction. GET resumes these saved answers after refresh. The client sends questionKey; the server checks it and uses a conditional question-position update to reject stale or simultaneous submissions with HTTP 409.
5. Once the final answer is saved, the backend synthesizes a MentorProfile, stores a transcript memory, creates or updates the public-facing Mentor, and marks the interview completed in a transaction. New mentors remain PENDING and inactive. If synthesis or persistence fails after the last answer, the page shows a recovery action; POST can finish without repeating the interview.
6. Completion attempts confirmation emails to the mentor and admin. COMPLETED_EMAIL_SENT is recorded only if both providers report success. Delivery failure leaves COMPLETED; checkAndSendConfirmationEmail can retry. This helper is not a durable email queue and does not guarantee exactly-once delivery if a provider partially succeeds or concurrent attempts occur.
7. /mentor/status displays pending, rejected or approved status. Admin review loads the original answers and generated profile through MentorApplicationModal. mentorApproval.service.js sets APPROVED and active when an admin approves. Public mentor search requires approval and active status. The frontend mentor layout also checks saved onboarding state before opening the dashboard.

## Architecture and files

| Responsibility | Source |
| --- | --- |
| Manual interview UI, progress and recovery | frontend/app/onboarding/page.tsx |
| Email/Google mentor signup | frontend/app/apply-mentor/page.tsx; frontend/components/AuthModal.tsx |
| Session state and post-login destination | frontend/lib/auth-context.tsx |
| Dashboard guard and application status | frontend/app/mentor/layout.tsx; frontend/app/mentor/status/page.tsx |
| LinkedIn import, review and preferences | frontend/components/mentor/LinkedInOnboarding.tsx |
| Authentication and draft initialization | helpmeman-backend/src/controllers/auth.controller.js |
| Question definitions, state, persistence, synthesis | helpmeman-backend/src/services/mentorOnboarding.service.js |
| Authenticated interview API | helpmeman-backend/src/routes/onboarding.routes.js; src/controllers/onboarding.controller.js |
| LinkedIn submission | helpmeman-backend/src/controllers/linkedin.controller.js |
| LinkedIn input validation | helpmeman-backend/src/utils/mentorApplication.js |
| Admin decision and notifications | helpmeman-backend/src/services/mentorApproval.service.js |
| PostgreSQL data models | helpmeman-backend/prisma/schema.prisma |

Main tables: User stores account and onboarding role. MentorOnboarding stores answers/messages JSON, currentQuestion and completed. MentorProfile stores the synthesized background, expertise, bio, summary and completion/email status. MentorMemory stores per-answer and transcript content plus a small deterministic hashed embedding. Mentor stores the public profile, pricing, category, approval and active flag. Availability stores bookable weekly hours. MentorOnboardingAnswer exists in the schema but this interview currently uses MentorOnboarding.answers JSON instead.

## API

All three interview operations require a bearer token.

| Method | Endpoint | Payload / purpose |
| --- | --- | --- |
| GET | /api/mentor/onboarding | Saved state, question, answers, profile and approval metadata |
| PATCH | /api/mentor/onboarding | { role: MENTOR or MENTEE } |
| POST | /api/mentor/onboarding | { answer: string, skip: boolean, questionKey: string }; empty payload retries PROCESSING completion |
| POST | /api/linkedin/publish | Confirmed profile, topics, pricing, languages and availability |
| GET | /api/admin/mentors/pending | Submitted pending profiles and answers for review |
| POST | /api/admin/mentors/:id/approve | Admin approval |
| POST | /api/admin/mentors/:id/reject | Admin rejection with reason |

## AI behavior

Groq model openai/gpt-oss-120b generates brief acknowledgments and the final profile. The next question is appended by application code so a long scenario prompt cannot disappear through token truncation. Acknowledgments fall back after 3.5 seconds; synthesis falls back after 4 seconds or if the provider fails. Profile fields are restricted to valid schema fields and types; submitted name is authoritative. Without GROQ_API_KEY the same fixed questionnaire still works using deterministic profile synthesis. This is profile generation, not verification of credentials or quality.

## Questions asked now

Name, email and track are required. Later questions can be skipped. Text questions require a non-empty answer of at most 10,000 characters; email format and offered choice values are checked. The email answer is profile context; it does not replace or re-verify the account login email.

The three common questions are followed by the chosen track: Medical has **17 total questions**; JEE, Law and Career each have **15**. These lists are fixed within a track. For example, selecting no prior experience does not hide the experience-details question, and NEET-UG-only mentors still see the MBBS questions (which can be skipped). The initial progress denominator is 3 until a track is selected.

### Common questions

1. **full_name** (text, Identity): Let's begin with your full name.

2. **email_address** (text, Identity): What is your email address?

3. **mentor_track** (single_choice, Identity): Which primary mentorship track are you joining to guide students in?
   Options: NEET & Medical Mentorship; JEE & Engineering Mentorship; Law & CLAT Mentorship; Career Guidance & Professional Mentorship.

### Medical / NEET — 14 additional questions

1. **institution** (text, Background): Which College or University did you attend or are currently studying at?

2. **branch_year** (text, Background): What is your Branch / Specialization and your current year or graduation year?

3. **current_status** (single_choice, Background): What is your current status?
   Options: Medical Student (MBBS/BDS); Junior Resident / Intern; Working Professional; Other.

4. **exam_background** (text, Background): What is your medical entrance examination background? Mention your NEET-UG year & percentile or NEET-PG rank if applicable.

5. **mentor_areas** (multi_choice, Expertise): Which areas can you confidently mentor NEET aspirants in?
   Options: Physics; Chemistry; Biology (Botany); Biology (Zoology); Study Planning and Strategy; Mental Health and Stress Management; Revision Techniques.

6. **prior_experience** (single_choice, Expertise): Have you previously taught, mentored, guided or coached students?
   Options: Yes; No.

7. **experience_details** (text, Expertise): Briefly describe your mentoring or teaching experience. Mention who you mentored, approximate number of students, what you helped with and duration.

8. **scenario_mock_scores** (text, Mentoring Scenario): SCENARIO: A NEET aspirant says: 'I have studied for months, but my mock-test scores are not improving. I feel I am working hard but do not know what I am doing wrong.' How would you approach the student's first mentoring session?

9. **scenario_biology_retention** (text, Mentoring Scenario): SCENARIO: A student is struggling with the high volume of syllabus in Biology and feels overwhelmed. They are forgetting topics as soon as they study them. How would you help them improve their retention?

10. **comfortable_mentees** (multi_choice, Preferences): Which NEET aspirants would you be most comfortable mentoring?
   Options: Dropper students; First-time test takers (Class 11/12); Students aiming for top 100 ranks; Students struggling to pass; All types of students.

11. **daily_time_commitment** (single_choice, Availability): How much time can you realistically dedicate each day at HelpMeMan?
   Options: Less than 1 hour; 1-2 hours; 3-4 hours; More than 4 hours.

12. **target_student_level** (single_choice, Preferences): Which level of student are you most interested in mentoring based on your current qualifications?
   Options: NEET-UG aspirants (11th/12th/Droppers); MBBS students preparing for PG entrance exams; Both levels.

13. **mbbs_specialization** (multi_choice, Expertise): If mentoring MBBS students, which specific subjects or exam modules (e.g., NExT/NEET-PG strategy) are you best equipped to guide?
   Options: Clinical Subjects; Pre-clinical / Para-clinical Subjects; Exam Strategy & Time Management; Subject-wise Resource Guidance; Not applicable (I am only mentoring NEET-UG).

14. **scenario_mbbs_guidance** (text, Mentoring Scenario): How would you structure a guidance plan for an MBBS student struggling to balance clinical postings with PG preparation?

### JEE / Engineering — 12 additional questions

1. **institution** (text, Background): Which College or University did you attend or are currently studying at?

2. **branch_year** (text, Background): What is your Branch / Specialization and your current year or graduation year?

3. **current_status** (single_choice, Background): What is your current status?
   Options: Engineering Student; Engineering Graduate; Working Professional; Teacher / Faculty; Other.

4. **exam_background** (single_choice, Background): What is your JEE / engineering entrance examination background?
   Options: JEE Main; JEE Advanced; Both JEE Main & JEE Advanced; Other engineering entrance exam; Did not appear for JEE.

5. **exam_details** (text, Background): If applicable, mention your JEE year and JEE Main percentile / JEE Advanced rank.

6. **mentor_areas** (multi_choice, Expertise): Which areas can you confidently mentor JEE aspirants in?
   Options: Physics; Chemistry; Mathematics; JEE Main strategy; JEE Advanced strategy; Study planning; Time management; Mock-test analysis; Exam strategy; Other.

7. **prior_experience** (single_choice, Expertise): Have you previously taught, mentored, guided or coached students?
   Options: Yes, formally; Yes, informally; No, but I have guided peers; No previous experience.

8. **experience_details** (text, Expertise): Briefly describe your mentoring or teaching experience. Mention who you mentored, approximate number of students, what you helped with and duration.

9. **scenario_mock_scores** (text, Mentoring Scenario): SCENARIO: A JEE aspirant says: 'I have studied for months, but my mock-test scores are not improving. I feel I am working hard but dont know what Im doing wrong.' How would you approach the student's first mentoring session?

10. **scenario_main_vs_advanced** (text, Mentoring Scenario): SCENARIO: A student is confused about whether to focus mainly on JEE Main or also prepare seriously for JEE Advanced. They are unsure about their current level. How would you help them decide?

11. **comfortable_mentees** (multi_choice, Preferences): Which JEE aspirants would you be most comfortable mentoring?
   Options: Class 9-10; Class 11; Class 12; Droppers; JEE Main-focused; JEE Advanced-focused; Students unsure about their preparation strategy.

12. **daily_time_commitment** (single_choice, Availability): How much time can you realistically dedicate each day at HelpMeMan?
   Options: Less than 1 hour; 1-2 hours; 2-4 hours; More than 4 hours.

### Law / CLAT — 12 additional questions

1. **institution** (text, Background): Which College / University and Course / Degree + Current Year or Graduation Year?

2. **current_status** (single_choice, Background): What is your current status?
   Options: Law Student; Law Graduate; Working Professional; Teacher / Faculty; Other.

3. **exam_background** (single_choice, Background): What is your CLAT / law entrance examination background?
   Options: CLAT; AILET; Did not appear for a law entrance examination; Other.

4. **clat_score_rank** (text, Background): What was your CLAT rank/score? If you appeared for multiple attempts, mention each performance.

5. **clat_prep_strategy** (text, Background): Briefly describe your CLAT preparation strategy, including resources, study schedule, mock tests, and major strategies that helped you.

6. **prior_experience** (single_choice, Expertise): Have you previously mentored or taught CLAT aspirants?
   Options: Yes, formally; Yes, informally / helped friends or juniors; No, but I have strong CLAT preparation experience; No previous experience.

7. **clat_sections** (multi_choice, Expertise): Which CLAT sections are you most confident in mentoring students on?
   Options: English Language; Current Affairs & General Knowledge; Legal Reasoning; Logical Reasoning; Quantitative Techniques; Overall CLAT Strategy & Mock Analysis; Study Planning; Time Management; Mock-Test Analysis; Exam-Day Strategy; Other.

8. **experience_details** (text, Expertise): Briefly describe your mentoring or teaching experience. Mention who you mentored, approximate number of students, what you helped with and duration.

9. **scenario_mock_scores** (text, Mentoring Scenario): SCENARIO: A CLAT aspirant says: 'I have studied for months, but my mock-test scores are not improving. I feel I am working hard but don't know what I'm doing wrong.' How would you approach the student's first mentoring session?

10. **scenario_gk_weakness** (text, Mentoring Scenario): SCENARIO: A student is performing well in Legal Reasoning and Logical Reasoning but consistently struggles with Current Affairs and General Knowledge. How would you help them improve without affecting their preparation for other sections?

11. **comfortable_mentees** (multi_choice, Preferences): Which Law aspirants would you be most comfortable mentoring?
   Options: Class 11; Class 12; Droppers; CLAT-focused aspirants; AILET / Other Law Entrance-focused aspirants; Students struggling with specific CLAT sections; Students unsure about their preparation strategy.

12. **daily_time_commitment** (single_choice, Availability): How much time can you realistically dedicate each day to mentoring?
   Options: Less than 1 hour; 1-2 hours; 2-4 hours; More than 4 hours.

### Career guidance — 12 additional questions

1. **current_role** (text, Background): What is your Current Role / Profession?

2. **educational_background** (text, Background): What is your Educational Background? (Degree/Course, College/University, Specialization)

3. **mentor_areas** (multi_choice, Expertise): Which career areas can you guide students in?
   Options: Engineering & Technology; Medicine & Healthcare; Law; Management & Business; Finance & Economics; Government Jobs / Civil Services; Research & Academia; Design & Creative Careers; Data Science / AI; Entrepreneurship; Defence & Armed Forces; Other.

4. **comfortable_mentees** (multi_choice, Preferences): Which students are you most comfortable mentoring?
   Options: Classes 8–10; Classes 11–12; Entrance/competitive exam aspirants; College students; Final-year students; Fresh graduates; Students considering a career switch; Other.

5. **experience_years** (single_choice, Background): How much professional/career experience do you have?
   Options: Less than 1 year; 1–3 years; 3–5 years; 5–10 years; 10+ years.

6. **guidance_types** (multi_choice, Expertise): What kind of guidance can you provide?
   Options: Career exploration & career selection; Course/degree selection; College & higher-education guidance; Skill development & learning roadmap; Industry insights; Internship & early-career guidance; Resume/CV guidance; Interview preparation; Career transition guidance; Long-term career planning; Other.

7. **career_journey** (text, Background): Briefly describe your career journey and what makes you qualified to guide students.

8. **motivation** (text, Mentoring style): What motivates you to mentor students through HelpMeMan?

9. **scenario_confused_student** (text, Mentoring Scenario): How would you approach a student who is confused about which career path to choose?

10. **biggest_mistakes** (text, Mentoring Scenario): What do you think is one of the biggest mistakes students make while choosing a career?

11. **daily_time_commitment** (single_choice, Availability): How much time can you realistically dedicate to mentoring?
   Options: Less than 1 hour/day; 1-2 hours/day; 2–4 hours/day; 4+ hours/day; Flexible depending on availability.

12. **mentoring_goals** (text, Personal): What are you hoping to achieve through mentoring on HelpMeMan?

## LinkedIn alternative

LinkedIn OAuth imports the available identity/profile fields; import depends on provider permissions and configured credentials. It does not run the 15/17-question interview. Ruth suggests a headline, bio, expertise and topics. The candidate reviews/edits these, then confirms professional experience, session price, languages and weekly availability before previewing and submitting. Current UI defaults are 3 years, ₹499, 30-minute sessions, English/Hindi, and Monday/Wednesday evenings plus Saturday daytime. These are suggested defaults, not verified facts.

The confirmed headline, profile, topics, price and availability are saved for admin review. Price is converted to integer paise. Invalid prices, durations, weekdays, times and overlapping slots are rejected before persistence. The profile, schedule, role and completed submission save in one transaction. New profiles await admin review; existing admin decisions are preserved.

The callback page forwards the OAuth response to the backend. On return, /onboarding restores a supplied application session before requiring login, then loads the imported profile. External OAuth/token exchange still needs real-provider staging verification.

## Fixes made during this check

- Removed automatic approval/activation from OTP signup, Google login and new LinkedIn submission.
- Routed incomplete mentors into onboarding, pending/rejected applicants into status, and approved completed mentors into the dashboard.
- Preserved completed profile/email state when reselecting mentor.
- Kept failed answer text/selections, exposed name errors, and added interrupted-completion recovery.
- Validated required identity/track answers, email and choice values; prevented stale/simultaneous answer writes.
- Restricted AI output to valid profile fields and preserved the submitted name; updated existing mentor category/institution from the track.
- Required actual email-provider success before marking confirmations sent.
- Saved LinkedIn headline and review answers and made submission atomic.
- Restored first-time LinkedIn sessions before the onboarding sign-in redirect, and allowed switching to manual before a draft exists.
- Preserved the optional signup phone number through OTP request validation.

Changes do not retroactively revoke approvals or repair historical accounts already auto-approved by older code. Those records require a separate data review. The manual flow does not ask for exact calendar slots, session pricing, languages or verification documents; new manual profiles default to a free 30-minute session, English, and no bookable weekly availability. Availability/profile setup is still needed after approval. The frontend demo-token questionnaire is a separate medical-only preview and differs from the real API questionnaire.

## Local verification

Run npm run test:onboarding in helpmeman-backend. All 33 backend regression checks passed locally. The Node test suite executes the real onboarding service and auth/LinkedIn controller code with an in-memory Prisma substitute and mocked providers; it never imports the schema-mutating Prisma startup module. It covers all four tracks, resume state, validation, AI malformed output, completion retries, concurrent/stale answers, concurrent role initialization, malformed requests, failed emails, OTP/Google initialization, preserved admin decisions and atomic LinkedIn submission.

Browser verification used the local frontend with an isolated API running the real service and an in-memory data store. It confirmed first-time LinkedIn session restoration to profile review, retained name on a simulated save failure, invalid-email feedback with input retention, four-track selection, multiple-choice input, refresh/resume, all 15 career interview answers through submission, the pending-review page, and redirecting a pending candidate away from /mentor. No real provider login or emails were involved.

The optional-phone OTP schema was separately checked using the installed Zod package.

The frontend adds 12 routing-policy regression checks (npm run test:onboarding). Its production build passed on the isolated PR branch using placeholder public service settings (npm run build -- --webpack).

The frontend TypeScript check is ./node_modules/.bin/tsc --noEmit --incremental false. The touched frontend files already have lint errors in HEAD; compare against that baseline rather than claiming a clean repository lint.

Real PostgreSQL transaction behavior, Supabase OTP/Google login, external LinkedIn OAuth, Groq output quality and actual email delivery have not been validated against live services in this local audit. Do a staging run with a disposable mentor through signup → interview/import → submission → admin approval → availability → public listing/booking before calling the workflow production-ready.
