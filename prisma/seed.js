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
  const adminHash = await hashPw('password123');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@helpmeman.com' },
    update: { passwordHash: adminHash },
    create: { name: 'HelpMeMan Admin', email: 'admin@helpmeman.com', passwordHash: adminHash, role: 'ADMIN', isEmailVerified: true },
  });
  console.log(`✅ Admin: ${admin.email}`);

  // ───   // Clear old mentors to keep the database fresh with the new set
  const oldMentorEmails = [
    'aarav.mentor@helpmeman.com',
    'priya.mentor@helpmeman.com',
    'rohan.mentor@helpmeman.com',
    'ananya.mentor@helpmeman.com',
    'vikram.mentor@helpmeman.com',
    'meera.mentor@helpmeman.com',
    'arjun.mentor@helpmeman.com',
    'kavya.mentor@helpmeman.com'
  ];

  const oldUsers = await prisma.user.findMany({
    where: { email: { in: oldMentorEmails } },
    select: { id: true }
  });
  const oldUserIds = oldUsers.map(u => u.id);

  if (oldUserIds.length > 0) {
    const oldMentors = await prisma.mentor.findMany({
      where: { userId: { in: oldUserIds } },
      select: { id: true }
    });
    const oldMentorIds = oldMentors.map(m => m.id);

    if (oldMentorIds.length > 0) {
      await prisma.chatMessage.deleteMany({
        where: { thread: { mentorId: { in: oldMentorIds } } }
      });
      await prisma.chatThread.deleteMany({ where: { mentorId: { in: oldMentorIds } } });
      await prisma.availability.deleteMany({ where: { mentorId: { in: oldMentorIds } } });
      await prisma.review.deleteMany({ where: { mentorId: { in: oldMentorIds } } });
      
      const oldBookings = await prisma.booking.findMany({
        where: { mentorId: { in: oldMentorIds } },
        select: { id: true }
      });
      const oldBookingIds = oldBookings.map(b => b.id);
      if (oldBookingIds.length > 0) {
        await prisma.aiSession.updateMany({
          where: { bookingId: { in: oldBookingIds } },
          data: { bookingId: null }
        });
        await prisma.booking.deleteMany({ where: { id: { in: oldBookingIds } } });
      }

      await prisma.verificationDoc.deleteMany({ where: { mentorId: { in: oldMentorIds } } });
      await prisma.complaint.deleteMany({ where: { mentorId: { in: oldMentorIds } } });
      await prisma.earning.deleteMany({ where: { mentorId: { in: oldMentorIds } } });
      await prisma.notification.deleteMany({ where: { mentorId: { in: oldMentorIds } } });

      await prisma.mentor.deleteMany({ where: { id: { in: oldMentorIds } } });
    }

    await prisma.mentorProfile.deleteMany({ where: { mentorId: { in: oldUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: oldUserIds } } });
  }

  const mentorPw = await hashPw('password123');

  const mentorProfiles = [
    {
      user: { name: 'Anwesh das', email: 'anwesh.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Anwesh das',
        bio: 'Software Engineer with a 1Cr+ package at Rubrik. Specialist in System Design, Data Structures, and Algorithms (DSA). Helping students prepare for high-paying big tech roles and crack FAANG/Tier-1 engineering interviews.',
        institutionType: 'COMPANY',
        institutionName: 'Rubrik',
        institutionEmail: 'anwesh@rubrik.com',
        department: 'Computer Science',
        graduationYear: 2023,
        currentRole: 'Software Engineer',
        company: 'Rubrik',
        linkedinUrl: 'https://linkedin.com/in/anweshdas',
        expertise: ['System Design', 'DSA', 'Tech Prep', 'Big Tech Interviews'],
        pricePerSession: 49900,
        sessionDuration: 45,
        rating: 5.0,
        totalSessions: 48,
        categorySlug: 'faang',
        location: 'Bangalore, India',
        activeStatus: 'Active today',
        averageResponseTime: '1 hour',
        languages: 'Speaks English and Hindi',
        experienceYears: 3,
        isOnline: true,
        avatar: '/mentor3.jpg',
      },
    },
    {
      user: { name: 'Prakhar Shrivastava', email: 'prakhar.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Prakhar Shrivastava',
        bio: 'Co-founder at TrenchersAI, IIT Madras alum. Mentoring on tech architecture, operations strategy, and raising early-stage capital. I help students and founders turn ideas into scalable startups.',
        institutionType: 'STARTUP',
        institutionName: 'TrenchersAI',
        institutionEmail: 'prakhar@trenchers.ai',
        department: 'Aerospace Engineering',
        graduationYear: 2022,
        currentRole: 'Co-founder',
        company: 'TrenchersAI',
        linkedinUrl: 'https://linkedin.com/in/prakharshrivastava',
        expertise: ['Tech', 'Ops', 'Startup Strategy', 'Early Stage Fundraising'],
        pricePerSession: 99900,
        sessionDuration: 60,
        rating: 5.0,
        totalSessions: 36,
        categorySlug: 'startup',
        location: 'Chennai, India',
        activeStatus: 'Active yesterday',
        averageResponseTime: '3 hours',
        languages: 'Speaks English and Hindi',
        experienceYears: 4,
        isOnline: true,
        avatar: '/mentor5.jpeg',
      },
    },
    {
      user: { name: 'Aryan Gupta', email: 'aryan.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Aryan Gupta',
        bio: 'SDE at Cohesity. Specialist in startup growth, scaling tech infrastructure, and early-stage fundraising strategies. Helping builders design robust products and plan their career trajectories.',
        institutionType: 'COMPANY',
        institutionName: 'Cohesity',
        institutionEmail: 'aryan@cohesity.com',
        department: 'Information Technology',
        graduationYear: 2023,
        currentRole: 'SDE',
        company: 'Cohesity',
        linkedinUrl: 'https://linkedin.com/in/aryangupta',
        expertise: ['Startups', 'Fundraising', 'Backend Development', 'Scale'],
        pricePerSession: 59900,
        sessionDuration: 30,
        rating: 5.0,
        totalSessions: 24,
        categorySlug: 'faang',
        location: 'Pune, India',
        activeStatus: 'Active this week',
        averageResponseTime: '4 hours',
        languages: 'Speaks English and Hindi',
        experienceYears: 3,
        isOnline: false,
        avatar: '/mentor6.jpeg',
      },
    },
    {
      user: { name: 'Vineet', email: 'vineet.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Vineet',
        bio: "GSoC '25 & '26 mentor, student at IIT Roorkee. Expert in Open Source contribution, GSoC prep, and campus placements. I help students select the right open source projects and write winning proposals.",
        institutionType: 'COLLEGE',
        institutionName: 'IIT Roorkee',
        institutionEmail: 'vineet@iitr.ac.in',
        department: 'Computer Science',
        graduationYear: 2025,
        currentRole: 'GSoC Mentor / Student',
        company: 'IIT Roorkee',
        linkedinUrl: 'https://linkedin.com/in/vineetiitr',
        expertise: ['Open Source', 'GSoC', 'C++', 'Algorithms'],
        pricePerSession: 29900,
        sessionDuration: 45,
        rating: 5.0,
        totalSessions: 62,
        categorySlug: 'campus-placements',
        location: 'Roorkee, India',
        activeStatus: 'Active today',
        averageResponseTime: '2 hours',
        languages: 'Speaks English and Hindi',
        experienceYears: 2,
        isOnline: true,
        avatar: '/mentor1.png',
      },
    },
    {
      user: { name: 'Sunny Sharma', email: 'sunny.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Sunny Sharma',
        bio: 'Tech Lead at Salesforce. Expert in backend engineering, cloud architectures, and database design. Mentoring on how to transition to leadership roles and pass top tech company technical rounds.',
        institutionType: 'COMPANY',
        institutionName: 'Salesforce',
        institutionEmail: 'sunny@salesforce.com',
        department: 'Computer Engineering',
        graduationYear: 2019,
        currentRole: 'Tech Lead',
        company: 'Salesforce',
        linkedinUrl: 'https://linkedin.com/in/sunnysharma',
        expertise: ['Backend', 'Cloud', 'System Architecture', 'Salesforce Interview'],
        pricePerSession: 34900,
        sessionDuration: 45,
        rating: 4.0,
        totalSessions: 31,
        categorySlug: 'faang',
        location: 'Bangalore, India',
        activeStatus: 'Active yesterday',
        averageResponseTime: '2 hours',
        languages: 'Speaks English and Hindi',
        experienceYears: 7,
        isOnline: true,
        avatar: '/mentor4.jpg',
      },
    },
    {
      user: { name: 'Omi Shourya', email: 'omi.mentor@helpmeman.com' },
      mentor: {
        displayName: 'Omi Shourya',
        bio: 'Electrical Engineer, DTU student. Specializing in electrical engineering core, hardware-software integration, and core engineering prep. Guide for students pursuing careers in core engineering sectors.',
        institutionType: 'COLLEGE',
        institutionName: 'Delhi Technical University',
        institutionEmail: 'omi@dtu.ac.in',
        department: 'Electrical Engineering',
        graduationYear: 2024,
        currentRole: 'Electrical Engineer',
        company: 'Delhi Technical University',
        linkedinUrl: 'https://linkedin.com/in/omishourya',
        expertise: ['Electrical Engineering', 'EE Core', 'Hardware Integration'],
        pricePerSession: 29900,
        sessionDuration: 30,
        rating: 5.0,
        totalSessions: 55,
        categorySlug: 'campus-placements',
        location: 'Delhi, India',
        activeStatus: 'Active this week',
        averageResponseTime: '5 hours',
        languages: 'Speaks English and Hindi',
        experienceYears: 2,
        isOnline: false,
        avatar: '/mentor7.jpeg',
      },
    },
    {
      user: { name: 'Demo Mentor', email: 'mentor@helpmeman.com' },
      mentor: {
        displayName: 'Demo Mentor',
        bio: 'Experienced software builder and career guide. Helping students navigate tech recruitment and software engineering careers.',
        institutionType: 'COMPANY', institutionName: 'HelpMeMan Inc.', institutionEmail: 'mentor@helpmeman.com',
        department: 'Engineering', graduationYear: 2018,
        currentRole: 'Principal SDE', company: 'HelpMeMan',
        linkedinUrl: 'https://linkedin.com/in/demomentor',
        expertise: ['Software Engineering', 'System Design', 'Career Advice'],
        pricePerSession: 0, sessionDuration: 30, rating: 5.0, totalSessions: 12,
        categorySlug: 'faang',
        location: 'Bangalore, India',
        activeStatus: 'Active today',
        averageResponseTime: '1 hour',
        languages: 'Speaks English',
        experienceYears: 8,
        isOnline: true,
      },
    },
  ];

  for (const md of mentorProfiles) {
    const { categorySlug, ...mentorFields } = md.mentor;

    // Dynamically parse location e.g. "Bangalore, India" or "San Francisco, USA"
    let country = 'India';
    let state = '';
    let city = '';
    if (mentorFields.location) {
      const parts = mentorFields.location.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        city = parts[0];
        country = parts[parts.length - 1];
        state = parts.length === 3 ? parts[1] : '';
      } else {
        city = mentorFields.location;
      }
    }

    // Dynamically parse languages e.g. "Speaks English and Hindi" -> ["English", "Hindi"]
    let languagesArray = ['English'];
    if (mentorFields.languages) {
      const cleaned = mentorFields.languages.replace(/Speaks\s+/i, '');
      const parts = cleaned.split(/,|\band\b/).map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        languagesArray = parts;
      }
    }

    const finalMentorFields = {
      ...mentorFields,
      country,
      state: state || null,
      city,
      locality: null,
      postalCode: null,
      languages: languagesArray
    };

    const user = await prisma.user.upsert({
      where: { email: md.user.email },
      update: {
        role: 'MENTOR',
        onboardingRole: 'MENTOR',
        passwordHash: mentorPw,
      },
      create: {
        name: md.user.name,
        email: md.user.email,
        passwordHash: mentorPw,
        role: 'MENTOR',
        onboardingRole: 'MENTOR',
        isEmailVerified: true,
      },
    });

    const existing = await prisma.mentor.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.mentor.create({
        data: {
          userId: user.id,
          ...finalMentorFields,
          categoryId: catMap[categorySlug],
          approvalStatus: 'APPROVED',
          isActive: true,
        },
      });
    } else {
      await prisma.mentor.update({
        where: { id: existing.id },
        data: {
          ...finalMentorFields,
          categoryId: catMap[categorySlug],
        },
      });
    }

    // Seed Completed MentorProfile so they bypass onboarding
    await prisma.mentorProfile.upsert({
      where: { mentorId: user.id },
      update: {
        name: md.user.name,
        preferredName: mentorFields.displayName,
        role: mentorFields.currentRole,
        company: mentorFields.company,
        location: mentorFields.location,
        skills: mentorFields.expertise,
        experienceYears: mentorFields.experienceYears,
        bio: mentorFields.bio,
        onboardingStatus: 'COMPLETED',
        completedAt: new Date(),
        currentQuestion: 17,
      },
      create: {
        mentorId: user.id,
        name: md.user.name,
        preferredName: mentorFields.displayName,
        role: mentorFields.currentRole,
        company: mentorFields.company,
        location: mentorFields.location,
        skills: mentorFields.expertise,
        experienceYears: mentorFields.experienceYears,
        bio: mentorFields.bio,
        onboardingStatus: 'COMPLETED',
        completedAt: new Date(),
        currentQuestion: 17,
      },
    });

    console.log(`  ✅ ${mentorFields.displayName} (${mentorFields.institutionName})`);
  }

  // ─── Sample Student ───
  const studentPw = await hashPw('password123');
  await prisma.user.upsert({
    where: { email: 'student@helpmeman.com' },
    update: {
      passwordHash: studentPw,
      onboardingRole: 'MENTEE',
    },
    create: {
      name: 'Riya Gupta',
      email: 'student@helpmeman.com',
      passwordHash: studentPw,
      role: 'USER',
      onboardingRole: 'MENTEE',
      isEmailVerified: true,
    },
  });
  console.log(`  ✅ Student: student@helpmeman.com`);

  console.log('\n🎉 Seeding complete!\n');
  console.log('Test accounts:');
  console.log('  Admin:   admin@helpmeman.com / password123');
  console.log('  Student: student@helpmeman.com / password123');
  console.log('  Mentors: mentor@helpmeman.com / password123');
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
