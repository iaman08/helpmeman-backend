/**
 * Mentor Match Service
 *
 * Turns a free-text user query into ranked mentors with an explainable "fit %".
 *
 * Pipeline:
 *   1. Build "concepts" from the query (LLM-extracted entities + raw keywords),
 *      each concept being a group of synonyms (e.g. FAANG -> google, meta, amazon ...).
 *   2. Score every concept against each mentor field with field weights
 *      (expertise > role/headline > company/institution > category > bio).
 *   3. Relevance = weighted concept coverage. Quality = rating, reviews, sessions,
 *      experience, availability. Final fit blends both (relevance dominates).
 *   4. Return top-N with human readable reasons so the UI can show *why* it fits.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'from', 'by', 'about',
  'i', 'me', 'my', 'we', 'you', 'your', 'is', 'are', 'am', 'be', 'been', 'it', 'this', 'that', 'these',
  'need', 'want', 'looking', 'look', 'help', 'find', 'get', 'give', 'please', 'someone', 'somebody',
  'who', 'which', 'how', 'what', 'can', 'could', 'should', 'would', 'will', 'do', 'does', 'have', 'has',
  'as', 'into', 'like', 'any', 'some', 'more', 'good', 'best', 'expert', 'mentor', 'mentors', 'guidance',
  'advice', 'session', 'call', 'person', 'people', 'than', 'also', 'just', 'new', 'being', 'become', 'doing',
  'make', 'made', 'prepare', 'preparing', 'preparation', 'improve', 'learn', 'learning', 'career', 'job',
  'mentoring', 'mentorship', 'mentored', 'guide', 'guiding', 'support', 'us', 'usa', 'india', 'indian', 'role', 'roles',
]);

/** Synonym groups: any term in a group can stand in for the others. */
const SYNONYM_GROUPS = [
  ['faang', 'maang', 'google', 'meta', 'facebook', 'amazon', 'apple', 'netflix', 'microsoft', 'big tech', 'bigtech'],
  ['dsa', 'data structures', 'algorithms', 'algorithm', 'leetcode', 'competitive programming', 'coding interview'],
  ['system design', 'hld', 'lld', 'distributed systems', 'architecture', 'scalability'],
  ['swe', 'sde', 'software engineer', 'software developer', 'software development', 'developer', 'programmer'],
  ['pm', 'product manager', 'product management', 'product'],
  ['data science', 'data scientist', 'machine learning', 'ml', 'ai', 'deep learning', 'analytics', 'data analyst', 'mlops'],
  ['frontend', 'front end', 'react', 'nextjs', 'next.js', 'ui', 'javascript', 'typescript'],
  ['backend', 'back end', 'node', 'nodejs', 'api', 'java', 'spring', 'golang', 'django'],
  ['fintech', 'finance', 'banking', 'payments', 'investment banking', 'trading', 'quant'],
  ['startup', 'startups', 'founder', 'cofounder', 'co-founder', 'entrepreneur', 'entrepreneurship', 'yc', 'y combinator', 'gtm', 'go to market', 'mvp', 'fundraising', 'growth'],
  ['mba', 'cat', 'iim', 'management', 'b-school', 'business school', 'consulting', 'case interview'],
  ['jee', 'iit', 'iit jee', 'jee advanced', 'jee main', 'engineering entrance'],
  ['neet', 'aiims', 'medical', 'medicine', 'mbbs', 'doctor'],
  ['upsc', 'ias', 'civil services', 'ips', 'civil service'],
  ['gate', 'gate exam', 'psu'],
  ['resume', 'cv', 'ats', 'resume review', 'portfolio'],
  ['mock interview', 'interview', 'interviews', 'mock'],
  ['ux', 'ui ux', 'design', 'designer', 'product design', 'figma'],
  ['law', 'legal', 'clat', 'lawyer', 'nlsiu', 'llb'],
  ['gsoc', 'google summer of code', 'open source', 'opensource'],
  ['devops', 'cloud', 'aws', 'kubernetes', 'docker', 'sre'],
  ['marketing', 'digital marketing', 'seo', 'brand', 'content'],
  ['abroad', 'ms', 'masters', 'study abroad', 'gre', 'ielts', 'toefl', 'gmat', 'admissions'],
  ['internship', 'internships', 'intern', 'placement', 'placements', 'campus'],
  ['switch', 'transition', 'career switch', 'career change', 'pivot'],
];

const SYNONYM_INDEX = (() => {
  const map = new Map();
  SYNONYM_GROUPS.forEach((group, idx) => group.forEach((t) => {
    if (!map.has(t)) map.set(t, new Set());
    map.get(t).add(idx);
  }));
  return map;
})();

const FIELD_WEIGHTS = {
  expertise: 1.0,
  role: 0.8,
  company: 0.7,
  category: 0.55,
  bio: 0.4,
  department: 0.35,
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').replace(/\s+/g, ' ').trim();

/** Light stemmer so "interviews" ~ "interview", "engineering" ~ "engineer". */
function stem(word) {
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  return w;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a word-boundary-ish regex that tolerates simple stem variants. */
function termRegex(term) {
  const parts = norm(term).split(' ').filter(Boolean).map((p) => escapeRegex(stem(p)));
  if (!parts.length) return null;
  return new RegExp(`(^|[^a-z0-9])${parts.join('[a-z0-9]*\\s+')}[a-z0-9]*($|[^a-z0-9])`, 'i');
}

/**
 * A concept = { label, terms:[...], weight }.
 * Terms are the term itself plus its synonym group members.
 */
function buildConcept(label, weight, source) {
  const base = norm(label);
  if (!base) return null;
  const terms = new Set([base]);
  const groups = SYNONYM_INDEX.get(base);
  if (groups) groups.forEach((gi) => SYNONYM_GROUPS[gi].forEach((t) => terms.add(t)));
  // Also try the stemmed single word in the synonym index.
  const stemmed = stem(base);
  const g2 = SYNONYM_INDEX.get(stemmed);
  if (g2) g2.forEach((gi) => SYNONYM_GROUPS[gi].forEach((t) => terms.add(t)));
  return { label: label.trim(), terms: [...terms], weight, source, regexes: [...terms].map(termRegex).filter(Boolean) };
}

/** Extract multi-word known phrases ("system design", "mock interview") before tokenising. */
function extractKnownPhrases(text) {
  const found = [];
  const lower = ` ${norm(text)} `;
  const phrases = [...SYNONYM_INDEX.keys()].filter((k) => k.includes(' ')).sort((a, b) => b.length - a.length);
  let remaining = lower;
  for (const p of phrases) {
    if (remaining.includes(` ${p} `)) {
      found.push(p);
      remaining = remaining.replace(` ${p} `, ' ');
    }
  }
  return { phrases: found, remaining: remaining.trim() };
}

/**
 * Merge LLM-extracted entities with raw keywords into a deduplicated concept list.
 * entities: { skills[], companies[], roles[], domains[] }
 */
function buildConcepts(query, entities = {}) {
  const concepts = [];
  const seen = new Set();
  const add = (label, weight, source) => {
    const key = norm(label);
    if (!key || seen.has(key) || STOPWORDS.has(key)) return;
    const c = buildConcept(label, weight, source);
    if (!c) return;
    // If this concept's synonym group overlaps an existing concept, merge instead of double counting.
    const overlap = concepts.find((x) => x.terms.some((t) => c.terms.includes(t) && SYNONYM_INDEX.has(t)));
    if (overlap) {
      overlap.weight = Math.max(overlap.weight, weight);
      seen.add(key);
      return;
    }
    seen.add(key);
    concepts.push(c);
  };

  // LLM entities are the most reliable signal.
  (entities.skills || []).forEach((t) => add(t, 1.0, 'skill'));
  (entities.roles || []).forEach((t) => add(t, 0.9, 'role'));
  (entities.companies || []).forEach((t) => add(t, 0.85, 'company'));
  (entities.domains || []).forEach((t) => add(t, 0.8, 'domain'));

  // Raw keyword fallback (also guards against LLM misses). When the LLM understood
  // the request, stray words ("boy", "delhi") only get a light weight so they can't
  // drag down an otherwise excellent match.
  const hasAI = ['skills', 'roles', 'companies', 'domains'].some((k) => (entities[k] || []).length > 0);
  const { phrases, remaining } = extractKnownPhrases(query);
  phrases.forEach((p) => add(p, hasAI ? 0.5 : 0.75, 'keyword'));
  remaining.split(' ').forEach((tok) => {
    if (tok.length >= 3 && !STOPWORDS.has(tok)) add(tok, hasAI ? 0.18 : 0.5, 'keyword');
  });

  return concepts.slice(0, 10);
}

/** Pulls a mentor into searchable fields. */
function mentorFields(m) {
  return {
    expertise: (m.expertise || []).map(norm),
    role: norm([m.currentRole, m.headline].filter(Boolean).join(' | ')),
    company: norm([m.company, m.institutionName].filter(Boolean).join(' | ')),
    category: norm(m.category?.name),
    bio: norm(m.bio),
    department: norm(m.department),
  };
}

const FIELD_LABEL = {
  expertise: 'Expertise',
  role: 'Role',
  company: 'Background',
  category: 'Category',
  bio: 'Profile',
  department: 'Department',
};

/** Best field hit for a concept on a mentor: { field, weight, evidence } or null. */
function matchConcept(concept, fields, mentor) {
  let best = null;
  const consider = (field, evidence) => {
    const w = FIELD_WEIGHTS[field];
    if (!best || w > best.weight) best = { field, weight: w, evidence };
  };

  for (const rx of concept.regexes) {
    // expertise is an array: attach the actual tag as evidence.
    for (let i = 0; i < fields.expertise.length; i++) {
      if (rx.test(fields.expertise[i])) consider('expertise', mentor.expertise[i]);
    }
    if (rx.test(fields.role)) consider('role', mentor.currentRole || mentor.headline);
    if (rx.test(fields.company)) consider('company', mentor.company || mentor.institutionName);
    if (rx.test(fields.category)) consider('category', mentor.category?.name);
    if (rx.test(fields.department)) consider('department', mentor.department);
    if (rx.test(fields.bio)) consider('bio', null);
    if (best && best.weight >= FIELD_WEIGHTS.expertise) break;
  }
  return best;
}

/** Quality prior 0..1 — rating (Bayesian smoothed), social proof, experience, availability. */
function qualityScore(m) {
  const rating = m.avgRating || m.rating || 0;
  const reviews = m.totalReviews || 0;
  // Bayesian average toward 4.2 with prior weight 5 reviews, so 1 review of 5.0 doesn't dominate.
  const bayes = (rating * reviews + 4.2 * 5) / (reviews + 5);
  const ratingPart = Math.max(0, Math.min(1, (bayes - 3.5) / 1.5));
  const proofPart = Math.min(1, Math.log10(1 + (m.totalSessions || 0)) / 2); // 100 sessions ~ 1
  const expPart = Math.min(1, (m.experienceYears || 0) / 10);
  const onlinePart = m.isOnline ? 1 : 0;
  return ratingPart * 0.45 + proofPart * 0.25 + expPart * 0.2 + onlinePart * 0.1;
}

function fitLabel(fit) {
  if (fit >= 85) return 'Excellent fit';
  if (fit >= 70) return 'Strong fit';
  if (fit >= 55) return 'Good fit';
  return 'Partial fit';
}

/**
 * Score a single mentor against concepts.
 */
function scoreMentor(m, concepts, opts = {}) {
  const fields = mentorFields(m);
  let earned = 0;
  let possible = 0;
  const matches = [];
  const missing = [];

  for (const c of concepts) {
    possible += c.weight * FIELD_WEIGHTS.expertise; // max achievable per concept
    const hit = matchConcept(c, fields, m);
    if (hit) {
      earned += c.weight * hit.weight;
      matches.push({ concept: c.label, field: hit.field, evidence: hit.evidence });
    } else {
      missing.push(c.label);
    }
  }

  const relevance = possible > 0 ? earned / possible : 0; // 0..1
  const quality = qualityScore(m);

  // Relevance dominates; quality breaks ties and lifts well-reviewed mentors.
  // Mapping keeps a perfect match near ~95-98 rather than a flat 100.
  const matchedRatio = concepts.length ? matches.length / concepts.length : 0;
  const raw = relevance * 0.82 + quality * 0.1 + matchedRatio * 0.08;
  // Gentle curve so a mentor who covers the core of the request reads as a strong fit.
  const curved = 1 - Math.pow(1 - Math.min(1, raw), 1.4);
  let fit = Math.round(Math.min(0.98, curved) * 100);
  if (matches.length === 0) fit = Math.min(fit, 20 + Math.round(quality * 10));

  // Budget awareness (soft): nudge down if far above stated budget.
  if (opts.maxBudgetPaise && m.pricePerSession > opts.maxBudgetPaise) {
    fit = Math.max(0, fit - 8);
  }

  return { fit, relevance, quality, matches, missing };
}

function buildReasons(m, scored, concepts) {
  const reasons = [];
  // Strongest evidence first (expertise > role > company ...)
  const order = ['expertise', 'role', 'company', 'category', 'department', 'bio'];
  const sorted = [...scored.matches].sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));

  for (const mt of sorted.slice(0, 3)) {
    switch (mt.field) {
      case 'expertise':
        reasons.push(`Expert in ${mt.evidence || mt.concept}`);
        break;
      case 'role':
        reasons.push(`${mt.evidence || 'Works'} — relevant to "${mt.concept}"`);
        break;
      case 'company':
        reasons.push(`${mt.evidence || 'Background'} experience matches "${mt.concept}"`);
        break;
      case 'category':
        reasons.push(`Specialises in ${mt.evidence}`);
        break;
      default:
        reasons.push(`Profile mentions "${mt.concept}"`);
    }
  }

  const rating = m.avgRating || m.rating || 0;
  if (rating >= 4.5 && (m.totalReviews || 0) >= 3) {
    reasons.push(`Rated ${rating.toFixed(1)}/5 across ${m.totalReviews} reviews`);
  } else if ((m.totalSessions || 0) >= 10) {
    reasons.push(`${m.totalSessions}+ sessions completed`);
  }
  if (m.isOnline) reasons.push('Online right now');

  return reasons.slice(0, 4);
}

/**
 * Public API.
 * @param {Array} mentors  prisma mentor rows
 * @param {string} query
 * @param {object} entities LLM-extracted { skills, roles, companies, domains, maxBudgetInr }
 * @param {number} limit
 */
function matchMentors(mentors, query, entities = {}, limit = 3) {
  const concepts = buildConcepts(query, entities);
  const maxBudgetPaise = entities.maxBudgetInr ? Number(entities.maxBudgetInr) * 100 : null;

  const ranked = mentors
    .map((m) => {
      const scored = scoreMentor(m, concepts, { maxBudgetPaise });
      return { m, scored };
    })
    .filter(({ scored }) => scored.matches.length > 0 && scored.fit >= 40)
    .sort((a, b) => b.scored.fit - a.scored.fit || b.scored.quality - a.scored.quality)
    .slice(0, limit)
    .map(({ m, scored }) => ({
      id: m.id,
      name: m.displayName,
      avatar: m.avatar || null,
      role: m.currentRole || m.headline || 'Mentor',
      company: m.company || m.institutionName || '',
      institution: m.institutionName || '',
      expertise: (m.expertise || []).slice(0, 4),
      rating: Math.round(((m.avgRating || m.rating || 0)) * 10) / 10,
      totalReviews: m.totalReviews || 0,
      totalSessions: m.totalSessions || 0,
      pricePerSession: m.pricePerSession,
      sessionDuration: m.sessionDuration,
      isOnline: !!m.isOnline,
      fit: scored.fit,
      fitLabel: fitLabel(scored.fit),
      reasons: buildReasons(m, scored, concepts),
      matchedOn: scored.matches.map((x) => x.concept),
      gaps: scored.missing.slice(0, 3),
      // Transparent breakdown for the UI
      breakdown: {
        relevance: Math.round(scored.relevance * 100),
        credibility: Math.round(scored.quality * 100),
        coverage: concepts.length ? Math.round((scored.matches.length / concepts.length) * 100) : 0,
      },
    }));

  return { concepts: concepts.map((c) => c.label), results: ranked };
}

module.exports = { matchMentors, buildConcepts, scoreMentor, fitLabel };
