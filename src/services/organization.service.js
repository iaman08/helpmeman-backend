const prisma = require('../config/prisma');

// Curated list of verified organizations with official logos and branding
const CURATED_ORGANIZATIONS = [
  // Tech Giants & FAANG
  {
    name: 'Google',
    slug: 'google',
    type: 'COMPANY',
    logoUrl: '/logos/google.svg',
    website: 'https://google.com',
    domain: 'google.com',
    isVerified: true,
  },
  {
    name: 'Meta',
    slug: 'meta',
    type: 'COMPANY',
    logoUrl: '/logos/meta.svg',
    website: 'https://about.meta.com',
    domain: 'meta.com',
    isVerified: true,
  },
  {
    name: 'Amazon',
    slug: 'amazon',
    type: 'COMPANY',
    logoUrl: '/logos/amazon.svg',
    website: 'https://amazon.com',
    domain: 'amazon.com',
    isVerified: true,
  },
  {
    name: 'Microsoft',
    slug: 'microsoft',
    type: 'COMPANY',
    logoUrl: '/logos/microsoft.svg',
    website: 'https://microsoft.com',
    domain: 'microsoft.com',
    isVerified: true,
  },
  {
    name: 'Apple',
    slug: 'apple',
    type: 'COMPANY',
    logoUrl: '/logos/apple.svg',
    website: 'https://apple.com',
    domain: 'apple.com',
    isVerified: true,
  },
  {
    name: 'Netflix',
    slug: 'netflix',
    type: 'COMPANY',
    logoUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/netflix.svg',
    website: 'https://netflix.com',
    domain: 'netflix.com',
    isVerified: true,
  },
  {
    name: 'Uber',
    slug: 'uber',
    type: 'COMPANY',
    logoUrl: '/logos/uber.svg',
    website: 'https://uber.com',
    domain: 'uber.com',
    isVerified: true,
  },
  {
    name: 'Spotify',
    slug: 'spotify',
    type: 'COMPANY',
    logoUrl: '/logos/spotify.svg',
    website: 'https://spotify.com',
    domain: 'spotify.com',
    isVerified: true,
  },
  {
    name: 'Adobe',
    slug: 'adobe',
    type: 'COMPANY',
    logoUrl: '/logos/adobe.svg',
    website: 'https://adobe.com',
    domain: 'adobe.com',
    isVerified: true,
  },
  {
    name: 'Airbnb',
    slug: 'airbnb',
    type: 'COMPANY',
    logoUrl: '/logos/airbnb.svg',
    website: 'https://airbnb.com',
    domain: 'airbnb.com',
    isVerified: true,
  },
  {
    name: 'Figma',
    slug: 'figma',
    type: 'COMPANY',
    logoUrl: '/logos/figma.svg',
    website: 'https://figma.com',
    domain: 'figma.com',
    isVerified: true,
  },
  {
    name: 'Slack',
    slug: 'slack',
    type: 'COMPANY',
    logoUrl: '/logos/slack.svg',
    website: 'https://slack.com',
    domain: 'slack.com',
    isVerified: true,
  },
  {
    name: 'Cultfit',
    slug: 'cultfit',
    type: 'COMPANY',
    logoUrl: '/logos/cultfit.svg',
    website: 'https://cult.fit',
    domain: 'cult.fit',
    isVerified: true,
  },
  {
    name: 'Apollo',
    slug: 'apollo',
    type: 'COMPANY',
    logoUrl: '/logos/apollo.svg',
    website: 'https://apollo.io',
    domain: 'apollo.io',
    isVerified: true,
  },
  {
    name: 'Unilever',
    slug: 'unilever',
    type: 'COMPANY',
    logoUrl: '/logos/unilever.svg',
    website: 'https://unilever.com',
    domain: 'unilever.com',
    isVerified: true,
  },
  {
    name: 'Goldman Sachs',
    slug: 'goldman-sachs',
    type: 'COMPANY',
    logoUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/goldmansachs.svg',
    website: 'https://goldmansachs.com',
    domain: 'goldmansachs.com',
    isVerified: true,
  },
  {
    name: 'McKinsey & Company',
    slug: 'mckinsey',
    type: 'COMPANY',
    logoUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/mckinsey.svg',
    website: 'https://mckinsey.com',
    domain: 'mckinsey.com',
    isVerified: true,
  },

  // Elite Universities & Institutes
  {
    name: 'IIT Delhi',
    slug: 'iit-delhi',
    type: 'UNIVERSITY',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://home.iitd.ac.in',
    domain: 'iitd.ac.in',
    isVerified: true,
  },
  {
    name: 'IIT Bombay',
    slug: 'iit-bombay',
    type: 'UNIVERSITY',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://iitb.ac.in',
    domain: 'iitb.ac.in',
    isVerified: true,
  },
  {
    name: 'IIT Jodhpur',
    slug: 'iit-jodhpur',
    type: 'UNIVERSITY',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://iitj.ac.in',
    domain: 'iitj.ac.in',
    isVerified: true,
  },
  {
    name: 'IIT Madras',
    slug: 'iit-madras',
    type: 'UNIVERSITY',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://iitm.ac.in',
    domain: 'iitm.ac.in',
    isVerified: true,
  },
  {
    name: 'IIT Kharagpur',
    slug: 'iit-kharagpur',
    type: 'UNIVERSITY',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://iitkgp.ac.in',
    domain: 'iitkgp.ac.in',
    isVerified: true,
  },
  {
    name: 'IIT Roorkee',
    slug: 'iit-roorkee',
    type: 'UNIVERSITY',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://iitr.ac.in',
    domain: 'iitr.ac.in',
    isVerified: true,
  },
  {
    name: 'IIT Kanpur',
    slug: 'iit-kanpur',
    type: 'UNIVERSITY',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://iitk.ac.in',
    domain: 'iitk.ac.in',
    isVerified: true,
  },
  {
    name: 'NIT Jalandhar',
    slug: 'nit-jalandhar',
    type: 'COLLEGE',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://nitj.ac.in',
    domain: 'nitj.ac.in',
    isVerified: true,
  },
  {
    name: 'NIT Trichy',
    slug: 'nit-trichy',
    type: 'COLLEGE',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://nitt.edu',
    domain: 'nitt.edu',
    isVerified: true,
  },
  {
    name: 'BITS Pilani',
    slug: 'bits-pilani',
    type: 'UNIVERSITY',
    logoUrl: 'https://api.iconify.design/lucide:graduation-cap.svg?color=%232563eb',
    website: 'https://bits-pilani.ac.in',
    domain: 'bits-pilani.ac.in',
    isVerified: true,
  },
  {
    name: 'AIIMS Delhi',
    slug: 'aiims-delhi',
    type: 'COLLEGE',
    logoUrl: '/aiimsdelhi.png',
    website: 'https://aiims.edu',
    domain: 'aiims.edu',
    isVerified: true,
  },
  {
    name: 'NLSIU',
    slug: 'nlsiu',
    type: 'COLLEGE',
    logoUrl: '/nlsiu.png',
    website: 'https://nls.ac.in',
    domain: 'nls.ac.in',
    isVerified: true,
  },
  {
    name: 'Stanford University',
    slug: 'stanford',
    type: 'UNIVERSITY',
    logoUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/stanford.svg',
    website: 'https://stanford.edu',
    domain: 'stanford.edu',
    isVerified: true,
  },
  {
    name: 'Harvard University',
    slug: 'harvard',
    type: 'UNIVERSITY',
    logoUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/harvard.svg',
    website: 'https://harvard.edu',
    domain: 'harvard.edu',
    isVerified: true,
  },
  {
    name: 'MIT',
    slug: 'mit',
    type: 'UNIVERSITY',
    logoUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/mit.svg',
    website: 'https://mit.edu',
    domain: 'mit.edu',
    isVerified: true,
  },
];

let isInitialized = false;

async function ensureOrganizationsSeeded() {
  if (isInitialized) return;
  try {
    const count = await prisma.organization.count();
    if (count === 0) {
      console.log('[ORG SERVICE] Seeding curated organizations...');
      for (const org of CURATED_ORGANIZATIONS) {
        await prisma.organization.upsert({
          where: { slug: org.slug },
          update: {},
          create: org,
        }).catch(err => console.error(`Failed to seed ${org.name}:`, err.message));
      }
      console.log('[ORG SERVICE] Curated organizations seeded successfully.');
    }
    isInitialized = true;
  } catch (err) {
    console.warn('[ORG SERVICE] Could not seed organizations automatically:', err.message);
  }
}

// Initial fire-and-forget
ensureOrganizationsSeeded().catch(() => {});

/**
 * Search organizations by name or slug with prefix / fuzzy matching
 */
async function searchOrganizations(query = '', type = null, limit = 10) {
  await ensureOrganizationsSeeded();
  const trimmed = query.trim().toLowerCase();

  const where = {};
  if (type) where.type = type;
  if (trimmed) {
    where.OR = [
      { name: { contains: trimmed, mode: 'insensitive' } },
      { slug: { contains: trimmed, mode: 'insensitive' } },
      { domain: { contains: trimmed, mode: 'insensitive' } },
    ];
  }

  const results = await prisma.organization.findMany({
    where,
    take: limit,
    orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
  });

  return results;
}

/**
 * Identify and resolve organization details for a given company or university string
 */
async function resolveOrganization(nameOrSlug, preferredType = null) {
  if (!nameOrSlug || typeof nameOrSlug !== 'string') return null;
  const input = nameOrSlug.trim();
  if (!input) return null;

  // 1. Check in curated static memory first for instant resolution without DB roundtrip
  const normalized = input.toLowerCase().replace(/[^a-z0-9]/g, '');
  const staticMatch = CURATED_ORGANIZATIONS.find(org => {
    const orgNorm = org.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const slugNorm = org.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    return orgNorm === normalized || slugNorm === normalized || orgNorm.includes(normalized) || normalized.includes(orgNorm);
  });

  if (staticMatch) {
    return {
      ...staticMatch,
      isCurated: true,
    };
  }

  // 2. Query Postgres Organization table
  try {
    const dbMatch = await prisma.organization.findFirst({
      where: {
        OR: [
          { name: { equals: input, mode: 'insensitive' } },
          { name: { contains: input, mode: 'insensitive' } },
          { slug: { equals: input.toLowerCase().replace(/[^a-z0-9]+/g, '-'), mode: 'insensitive' } },
        ],
      },
    });

    if (dbMatch) return dbMatch;
  } catch (e) {
    // ignore db error, fall back to synthesized representation
  }

  // 3. Fallback: synthesize a polished, verifiable object with a deterministic fallback badge
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id: `custom-${slug}`,
    name: input,
    slug,
    type: preferredType || (input.toLowerCase().includes('university') || input.toLowerCase().includes('institute') || input.toLowerCase().includes('college') ? 'UNIVERSITY' : 'COMPANY'),
    logoUrl: null, // UI will render high-contrast initials badge
    website: null,
    domain: null,
    isVerified: false,
  };
}

module.exports = {
  CURATED_ORGANIZATIONS,
  ensureOrganizationsSeeded,
  searchOrganizations,
  resolveOrganization,
};
