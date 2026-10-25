const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// Exercise the real service without loading prisma.js (which runs schema-changing
// startup SQL), contacting providers, or writing test mentors to a shared DB.
function setup({ aiResult, emailSuccess = true } = {}) {
  let rows = {
    user: [{ id: 'candidate', name: 'Test Mentor', email: 'mentor@example.test', role: 'STUDENT' }],
    mentorProfile: [], mentorOnboarding: [], mentor: [], mentorMemory: [], availability: [],
    category: ['medical-neet', 'jee-neet-prep', 'law', 'general-mentorship'].map(slug => ({ id: slug, slug })),
  };
  const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const profileFields = new Set(schema.match(/model MentorProfile \{([\s\S]*?)\n\}/)[1]
    .split('\n').map(line => line.trim().split(/\s/)[0]).filter(Boolean));
  const controls = { failProfile: false, emailSuccess, emails: 0 };
  const clone = value => structuredClone(value);
  const matches = (row, where) => Object.entries(where || {}).every(([key, value]) => row[key] === value);
  const prisma = {};
  for (const model of Object.keys(rows)) {
    function validate(data) {
      if (model !== 'mentorProfile') return;
      if (controls.failProfile && data.completedAt) throw new Error('Database temporarily unavailable');
      for (const key of Object.keys(data)) assert.ok(profileFields.has(key), `Unknown MentorProfile field: ${key}`);
    }
    prisma[model] = {
      async findFirst({ where }) { return clone(rows[model].find(row => matches(row, where)) || null); },
      async deleteMany({ where }) { rows[model] = rows[model].filter(row => !matches(row, where)); },
      async createMany({ data }) { for (const item of data) await this.create({ data: item }); },
      async findUnique({ where }) { return clone(rows[model].find(row => matches(row, where)) || null); },
      async create({ data }) {
        validate(data);
        const row = { id: `${model}-${rows[model].length}`, ...(model === 'mentor' ? { approvalStatus: 'PENDING', isActive: false } : {}), ...clone(data) };
        rows[model].push(row);
        return clone(row);
      },
      async update({ where, data }) {
        validate(data);
        const row = rows[model].find(row => matches(row, where));
        assert.ok(row, `${model} record must exist`);
        Object.assign(row, clone(data));
        return clone(row);
      },
      async updateMany({ where, data }) {
        validate(data);
        const found = rows[model].filter(row => matches(row, where));
        found.forEach(row => Object.assign(row, clone(data)));
        return { count: found.length };
      },
      async upsert({ where, create, update }) {
        return rows[model].some(row => matches(row, where))
          ? this.update({ where, data: update }) : this.create({ data: create });
      },
    };
  }
  let transaction = Promise.resolve();
  prisma.$transaction = work => {
    const run = async () => {
      const before = clone(rows);
      try { return typeof work === 'function' ? await work(prisma) : await Promise.all(work); }
      catch (error) { rows = before; throw error; }
    };
    const result = transaction.then(run);
    transaction = result.catch(() => {});
    return result;
  };
  const emails = {
    async sendMentorUnderReviewEmail() { controls.emails++; return { success: controls.emailSuccess }; },
    async sendMentorApplicationToAdminEmail() { controls.emails++; return { success: controls.emailSuccess }; },
  };
  class Groq {
    chat = { completions: { create: async ({ response_format }) => ({ choices: [{ message: {
      content: response_format ? JSON.stringify(aiResult) : 'Acknowledged.',
    } }] }) } };
  }
  const filename = path.join(__dirname, 'mentorOnboarding.service.js');
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  instance.require = name => {
    if (name === '../config/prisma') return prisma;
    if (name === '../config/env') return { groq: { apiKey: aiResult === undefined ? null : 'test-key' } };
    if (name === 'groq-sdk') return Groq;
    if (name === './email.service') return emails;
    if (name === './auth.service') return { invalidateCachedUser() {} };
    if (name === 'node:crypto') return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  };
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  return { service: instance.exports, prisma, controls, rows: () => rows };
}

function loadController(name, ctx, extra = {}) {
  const noop = async () => {};
  const mocks = {
    '../config/prisma': ctx.prisma,
    '../config/env': {},
    '../config/supabase': { auth: {
      admin: { createUser: async () => ({ data: { user: { id: 'candidate' } } }) },
      signInWithPassword: async () => ({ data: { session: { access_token: 'test-session', refresh_token: 'test-refresh' } } }),
    } },
    jsonwebtoken: {}, '../utils/hash': {}, '../utils/jwt': {},
    '../utils/otp': { verifyOTP: async () => ({ valid: true }) },
    '../utils/emailDomains': {}, '../services/email.service': {},
    '../services/notification.service': { sendNotification: noop, getOrCreatePreferences: noop },
    '../services/userProfile.service': {}, '../services/captcha.service': {},
    '../services/linkedin.service': {}, '../services/ruthMentor.service': {},
    '../services/roleSync.service': { syncUserRole: async user => user },
    '../services/mentorOnboarding.service': ctx.service,
    '../services/auth.service': { verifySession: async () => structuredClone(ctx.rows().user[0]), invalidateCachedUser() {} },
    '../services/auditLog.service': { logAuditEvent: noop },
    '../utils/mentorApplication': require('../utils/mentorApplication'),
    ...extra,
  };
  const filename = path.join(__dirname, '../controllers', `${name}.controller.js`);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  instance.require = dependency => {
    if (dependency in mocks) return mocks[dependency];
    if (Module.isBuiltin(dependency)) return require(dependency);
    throw new Error(`Unexpected dependency: ${dependency}`);
  };
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  return instance.exports;
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
}

module.exports = { setup, loadController, response };
