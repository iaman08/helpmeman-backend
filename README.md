# HelpMeMan Backend API 🚀

The backend server for **HelpMeMan** — an AI-powered 1:1 mentorship platform connecting learners with verified mentors from leading institutions (IITs, AIIMS, FAANG, YC startups).

Powered by Node.js, Express, Prisma ORM, Supabase, Groq AI (Ruth AI engine), Socket.IO, and Razorpay.

---

## 🛠️ Tech Stack

| Category | Technology |
| :--- | :--- |
| **Runtime & Framework** | Node.js, Express.js |
| **Database & ORM** | PostgreSQL (Supabase), Prisma ORM |
| **Authentication** | Supabase Auth, Custom JWT, OTP Verification, Google OAuth 2.0 |
| **AI Companion (Ruth AI)** | Groq SDK, Google Generative AI (Gemini) |
| **Real-time WebSockets** | Socket.IO |
| **Payments** | Razorpay Gateway |
| **Caching & Queues** | Redis (Upstash), BullMQ |
| **Email & Notifications** | Nodemailer (Brevo / Gmail SMTP), Resend, Web Push (VAPID) |
| **Email Templates** | React Email (`@react-email/components`) |

---

## ✨ Features

- **🤖 Ruth AI Engine & Onboarding**:
  - Conversational AI companion powered by Groq SDK & Gemini.
  - Adaptive, multi-phase mentor onboarding conversation that builds mentor memory layers.
  - Toggleable **Ruthless Mode** personality engine.
- **🔐 Auth & Identity System**:
  - Supabase Auth sync with custom Prisma User models.
  - 6-digit OTP verification for signup & password resets.
  - Role-based authorization & upgrade-only Role Synchronization (`STUDENT`, `MENTOR`, `ADMIN`, `SUPER_ADMIN`).
- **📅 Session Booking & Payments**:
  - 1:1 mentorship booking flow with flexible session durations (15, 30, 45, 60 min).
  - Integrated Razorpay payments and webhook signature verification.
- **💬 Real-Time Chat**:
  - Socket.IO WebSockets for instant mentor-mentee messaging.
  - Message persistence in PostgreSQL.
- **🛡️ Admin & Mentor Approval Workflow**:
  - Mentor profile submission upon Ruth AI onboarding completion.
  - Admin review dashboard (`PENDING`, `APPROVED`, `REJECTED`).
  - Automated email notifications dispatched to mentors and admins.
- **🔔 Multi-Channel Notifications**:
  - Web Push notifications using VAPID keys.
  - Transactional & welcome emails via Brevo SMTP / Resend.

---

## 📁 Project Structure

```
helpmeman-backend/
├── prisma/
│   ├── schema.prisma      # Database schema (User, Mentor, Booking, Message, Onboarding)
│   └── seed.js            # Initial seed script
├── src/
│   ├── config/            # Environment & service configurations
│   ├── controllers/       # Route request handlers
│   ├── middleware/        # Auth, rate limiting, and error middlewares
│   ├── routes/            # Express endpoint route definitions
│   ├── services/          # Business logic (AI, Auth, Mentor Onboarding, Notifications)
│   ├── sockets/           # Socket.IO handlers for real-time chat
│   ├── utils/             # Helper utilities (OTP, JWT, Crypto)
│   ├── index.js           # Server entry point
│   └── db-check-startup.js# Database connection verifier on boot
├── .env                   # Environment configuration (git-ignored)
└── package.json           # Dependencies and scripts
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v18.x or higher)
- **npm** or **bun** / **yarn**
- **PostgreSQL** database (or Supabase project)

### 1. Installation

Clone the repository and install dependencies:

```bash
cd helpmeman-backend
npm install
```

### 2. Environment Setup

Create a `.env` file in the root directory (`helpmeman-backend/.env`):

```env
# App Configuration
NODE_ENV=development
PORT=8080
FRONTEND_URL=http://localhost:3000
JWT_SECRET=your_jwt_secret_key
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key

# Database (Supabase PostgreSQL)
DATABASE_URL="postgresql://user:password@host:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://user:password@host:5432/postgres"

# Supabase Credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Groq AI (Ruth AI)
GROQ_API_KEY=gsk_your_groq_api_key

# Razorpay Payments
RAZORPAY_KEY_ID=rzp_test_xxxxxx
RAZORPAY_KEY_SECRET=xxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxx

# Email (SMTP / Brevo)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
FROM_EMAIL=noreply@helpmeman.com

# Redis / Upstash
REDIS_URL=rediss://default:token@host:6739
UPSTASH_REDIS_REST_URL=https://host.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token

# Admin & Notifications
ADMIN_EMAIL=admin@helpmeman.com
ADMIN_NOTIFICATION_EMAIL=admin@helpmeman.com
SUPER_ADMIN_EMAILS=superadmin@helpmeman.com
```

### 3. Database Migration & Prisma Setup

Generate the Prisma client and push the schema to your database:

```bash
# Generate Prisma Client
npm run db:generate

# Push schema changes to database
npm run db:push

# (Optional) Seed the database with initial categories & mentors
npm run db:seed
```

---

## 🏃 Running the Server

### Development Mode (with Nodemon auto-reload)

```bash
npm run dev
```

The API server will start on `http://localhost:8080`.

### Production Mode

```bash
npm run start
```

---

## 🛣️ Primary API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **POST** | `/api/auth/register` | Register a new user account |
| **POST** | `/api/auth/verify-signup-otp` | Verify 6-digit email OTP and activate account |
| **POST** | `/api/auth/login` | Login with email & password |
| **POST** | `/api/auth/google` | Sync Google OAuth session with backend |
| **GET / POST** | `/api/mentor/onboarding` | Fetch status or submit answer to Ruth AI mentor onboarding |
| **PATCH** | `/api/mentor/onboarding` | Choose onboarding role (`MENTOR` / `MENTEE`) |
| **POST** | `/api/ai/chat` | Send a message to Ruth AI companion |
| **GET** | `/api/mentors` | List all verified and approved mentors |
| **POST** | `/api/booking` | Create a mentorship session booking |
| **GET** | `/api/admin/mentors/pending` | List mentor profiles pending Admin review |
| **POST** | `/api/admin/mentors/:id/approve` | Approve a mentor application |

---

## 🛠️ Handy CLI Commands

```bash
# Open Prisma Studio to view database GUI
npm run db:studio

# Run database connectivity test script
npm run db:test

# Test SMTP email sending
npm run test-smtp
```

---

## 📄 License

This project is proprietary and confidential. All rights reserved. &copy; HelpMeMan.
