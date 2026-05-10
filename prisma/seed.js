const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function hashPw(pw) {
  return bcrypt.hash(pw, 12);
}

async function main() {
  console.log('🌱 Seeding HelpMeMan database...\n');

  // ─── Categories ───
  const categories = await Promise.all([
    prisma.category.upsert({ where: { slug: 'jee-neet-prep' }, update: {}, create: { name: 'JEE/NEET Prep', slug: 'jee-neet-prep', icon: '📚', description: 'Guidance from IIT/AIIMS students' } }),
    prisma.category.upsert({ where: { slug: 'campus-placements' }, update: {}, create: { name: 'Campus Placements', slug: 'campus-placements', icon: '🎓', description: 'Crack campus placement interviews' } }),
    prisma.category.upsert({ where: { slug: 'faang' }, update: {}, create: { name: 'FAANG & Big Tech', slug: 'faang', icon: '💻', description: 'Get into top tech companies' } }),
    prisma.category.upsert({ where: { slug: 'mba' }, update: {}, create: { name: 'MBA', slug: 'mba', icon: '📊', description: 'MBA prep and career advice' } }),
    prisma.category.upsert({ where: { slug: 'law' }, update: {}, create: { name: 'Law', slug: 'law', icon: '⚖️', description: 'CLAT prep and law career' } }),
    prisma.category.upsert({ where: { slug: 'startup' }, update: {}, create: { name: 'Startup', slug: 'startup', icon: '🚀', description: 'Build and scale startups' } }),
    prisma.category.upsert({ where: { slug: 'upsc' }, update: {}, create: { name: 'UPSC', slug: 'upsc', icon: '🏛️', description: 'Civil services preparation' } }),
    prisma.category.upsert({ where: { slug: 'design' }, update: {}, create: { name: 'Design', slug: 'design', icon: '🎨', description: 'UI/UX and product design' } }),
  ]);
  console.log(`✅ ${categories.length} categories created`);

  const catMap = {};
  categories.forEach((c) => (catMap[c.slug] = c.id));

  // ─── Admin User ───
  const adminHash = await hashPw('admin123456');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@helpmeman.com' },
    update: {},
    create: { name: 'HelpMeMan Admin', email: 'admin@helpmeman.com', passwordHash: adminHash, role: 'ADMIN', isEmailVerified: true },
  });
  console.log(`✅ Admin: ${admin.email}`);

  // ─── Mentors ───
  const mentorPw = await hashPw('mentor123456');

  const mentorProfiles = [
    {
      user: { name: 'Aarav Mehta', email: 'aarav.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Aarav Mehta',
        bio: 'IIT Bombay CS \'23. Interned at Google and Jane Street. Currently SDE-2 at Google Bangalore. I help students navigate JEE prep, branch selection, and the transition from college to top tech companies. I\'ve been through the exact pipeline — JEE AIR 156, CS at IITB, Google internship, PPO, and now working on Search infra.',
        institutionType: 'COLLEGE', institutionName: 'IIT Bombay', institutionEmail: 'aarav@iitb.ac.in',
        department: 'Computer Science', graduationYear: 2023,
        currentRole: 'SDE-2', company: 'Google',
        linkedinUrl: 'https://linkedin.com/in/aaravmehta',
        expertise: ['JEE Preparation', 'DSA', 'System Design', 'Google Interview', 'Competitive Programming'],
        pricePerSession: 49900, sessionDuration: 60, rating: 4.8, totalSessions: 47,
        categorySlug: 'jee-neet-prep',
      },
    },
    {
      user: { name: 'Priya Sharma', email: 'priya.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Dr. Priya Sharma',
        bio: 'AIIMS Delhi \'21, currently PG resident in Cardiology. Cracked NEET with AIR 89. I guide pre-med students through NEET strategy, MBBS life at AIIMS, and choosing the right PG specialization. My approach is structured — I share the exact study plans, resources, and mindset shifts that worked for me.',
        institutionType: 'COLLEGE', institutionName: 'AIIMS Delhi', institutionEmail: 'priya@aiims.edu',
        department: 'Cardiology', graduationYear: 2021,
        currentRole: 'PG Resident', company: 'AIIMS Delhi',
        linkedinUrl: 'https://linkedin.com/in/drpriyasharma',
        expertise: ['NEET Preparation', 'MBBS Guidance', 'PG Entrance', 'Medical Residency', 'Study Planning'],
        pricePerSession: 29900, sessionDuration: 30, rating: 4.9, totalSessions: 63,
        categorySlug: 'jee-neet-prep',
      },
    },
    {
      user: { name: 'Rohan Kapoor', email: 'rohan.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Rohan Kapoor',
        bio: 'BITS Pilani \'20, ex-Amazon, now Senior PM at Microsoft. I\'ve navigated the switch from SDE to Product Management and can help you with PM interview prep, resume building, and understanding what top tech companies look for. I also mentor on side-project strategy and standing out in campus placements.',
        institutionType: 'COMPANY', institutionName: 'Microsoft', institutionEmail: 'rohan@microsoft.com',
        department: 'Product Management', graduationYear: 2020,
        currentRole: 'Senior Product Manager', company: 'Microsoft',
        linkedinUrl: 'https://linkedin.com/in/rohankapoor',
        expertise: ['Product Management', 'PM Interviews', 'Career Switching', 'Resume Building', 'BITS Pilani'],
        pricePerSession: 39900, sessionDuration: 45, rating: 4.7, totalSessions: 35,
        categorySlug: 'campus-placements',
      },
    },
    {
      user: { name: 'Ananya Reddy', email: 'ananya.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Ananya Reddy',
        bio: 'NLU Bangalore \'22, currently Associate at AZB & Partners. Cracked CLAT with AIR 23. I help aspiring law students with CLAT preparation, choosing the right NLU, and building a legal career in corporate law. I\'ve worked on M&A deals worth ₹2000 Cr+ and can give you a realistic picture of BigLaw life in India.',
        institutionType: 'COLLEGE', institutionName: 'NLU Bangalore', institutionEmail: 'ananya@nlu.ac.in',
        department: 'Corporate Law', graduationYear: 2022,
        currentRole: 'Associate', company: 'AZB & Partners',
        linkedinUrl: 'https://linkedin.com/in/ananyareddy',
        expertise: ['CLAT Preparation', 'Corporate Law', 'NLU Life', 'Legal Career', 'M&A'],
        pricePerSession: 24900, sessionDuration: 30, rating: 4.6, totalSessions: 28,
        categorySlug: 'law',
      },
    },
    {
      user: { name: 'Vikram Singh', email: 'vikram.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Vikram Singh',
        bio: 'IIT Delhi \'19, ex-Goldman Sachs quant, now ML Engineer at Meta. I specialize in helping engineers transition into ML/AI roles and quant finance. If you\'re deciding between finance and tech, or want to break into FAANG as an ML engineer, I share a battle-tested playbook from my own journey.',
        institutionType: 'COMPANY', institutionName: 'Meta', institutionEmail: 'vikram@meta.com',
        department: 'Machine Learning', graduationYear: 2019,
        currentRole: 'ML Engineer', company: 'Meta',
        linkedinUrl: 'https://linkedin.com/in/vikramsingh',
        expertise: ['Machine Learning', 'Quant Finance', 'FAANG Interviews', 'IIT Guidance', 'Career Transition'],
        pricePerSession: 59900, sessionDuration: 60, rating: 4.9, totalSessions: 52,
        categorySlug: 'faang',
      },
    },
    {
      user: { name: 'Meera Joshi', email: 'meera.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Meera Joshi',
        bio: 'IIT Madras \'20, YC-backed founder building in edtech. Raised $2M seed. I mentor on early-stage startup building — from idea validation to your first 100 users, fundraising, and product-market fit. If you\'re a student with a startup idea or a young founder figuring out the early chaos, I\'ve been there.',
        institutionType: 'STARTUP', institutionName: 'EdTech Startup (YC W23)', institutionEmail: 'meera@startup.io',
        department: 'Founding CEO', graduationYear: 2020,
        currentRole: 'Founder & CEO', company: 'LearnLoop (YC W23)',
        linkedinUrl: 'https://linkedin.com/in/meerajoshi',
        expertise: ['Startup Building', 'Fundraising', 'Product-Market Fit', 'EdTech', 'IIT to Startup'],
        pricePerSession: 49900, sessionDuration: 45, rating: 4.8, totalSessions: 31,
        categorySlug: 'startup',
      },
    },
    {
      user: { name: 'Arjun Patel', email: 'arjun.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Arjun Patel',
        bio: 'NIT Trichy \'21, SDE-1 at Amazon. I focus on helping Tier-2 college students crack top product companies. I didn\'t have the IIT tag, so I had to work twice as hard — and I can show you the exact system I used for DSA practice, off-campus applications, and interview prep that landed me Amazon.',
        institutionType: 'COMPANY', institutionName: 'Amazon', institutionEmail: 'arjun@amazon.com',
        department: 'Software Engineering', graduationYear: 2021,
        currentRole: 'SDE-1', company: 'Amazon',
        linkedinUrl: 'https://linkedin.com/in/arjunpatel',
        expertise: ['DSA', 'Off-Campus Placement', 'Amazon Interview', 'NIT Life', 'Tier-2 to FAANG'],
        pricePerSession: 19900, sessionDuration: 30, rating: 4.5, totalSessions: 89,
        categorySlug: 'faang',
      },
    },
    {
      user: { name: 'Kavya Nair', email: 'kavya.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Kavya Nair',
        bio: 'SRCC Delhi \'20, Analyst at Goldman Sachs IBD. I guide commerce students on how to break into investment banking from Indian colleges. From building the right profile in college to cracking IB interviews, I cover the entire pipeline. I also help with CA vs MBA vs IB decision-making.',
        institutionType: 'COMPANY', institutionName: 'Goldman Sachs', institutionEmail: 'kavya@goldmansachs.com',
        department: 'Investment Banking', graduationYear: 2020,
        currentRole: 'Analyst', company: 'Goldman Sachs',
        linkedinUrl: 'https://linkedin.com/in/kavyanair',
        expertise: ['Investment Banking', 'Finance Career', 'IB Interviews', 'CA vs MBA', 'Commerce Guidance'],
        pricePerSession: 44900, sessionDuration: 45, rating: 4.7, totalSessions: 41,
        categorySlug: 'mba',
      },
    },
  ];

  for (const md of mentorProfiles) {
    const { categorySlug, ...mentorFields } = md.mentor;
    const user = await prisma.user.upsert({
      where: { email: md.user.email },
      update: {},
      create: {
        name: md.user.name,
        email: md.user.email,
        passwordHash: mentorPw,
        role: 'MENTOR',
        isEmailVerified: true,
      },
    });

    const existing = await prisma.mentor.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.mentor.create({
        data: {
          userId: user.id,
          ...mentorFields,
          categoryId: catMap[categorySlug],
          approvalStatus: 'APPROVED',
          isActive: true,
        },
      });
    }
    console.log(`  ✅ ${mentorFields.displayName} (${mentorFields.institutionName})`);
  }

  // ─── Sample Student ───
  const studentPw = await hashPw('student123456');
  await prisma.user.upsert({
    where: { email: 'student@helpmeman.com' },
    update: {},
    create: { name: 'Riya Gupta', email: 'student@helpmeman.com', passwordHash: studentPw, role: 'USER', isEmailVerified: true },
  });
  console.log(`  ✅ Student: student@helpmeman.com`);

  console.log('\n🎉 Seeding complete!\n');
  console.log('Test accounts:');
  console.log('  Admin:   admin@helpmeman.com / admin123456');
  console.log('  Student: student@helpmeman.com / student123456');
  console.log('  Mentors: [name].mentor@helpmeman.com / mentor123456');
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
