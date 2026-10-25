function validateMentorApplication(body) {
  function requireValid(condition, message) {
    if (!condition) throw Object.assign(new Error(message), { statusCode: 400 });
  }
  requireValid(body && typeof body === 'object' && !Array.isArray(body), 'Enter a valid mentor application.');
  requireValid(typeof body.displayName === 'string' && body.displayName.trim().length > 0 && body.displayName.length <= 100, 'Enter a display name (up to 100 characters).');
  requireValid(typeof body.bio === 'string' && body.bio.trim().length > 0 && body.bio.length <= 10000, 'Enter a bio (up to 10,000 characters).');
  for (const key of ['headline', 'currentRole', 'company', 'location', 'categorySlug', 'avatar']) {
    requireValid(body[key] === undefined || (typeof body[key] === 'string' && body[key].length <= 2000), `${key} must be text.`);
  }
  const price = body.pricePerSession ?? 0;
  requireValid(typeof price === 'number' && Number.isFinite(price) && price >= 0 && price <= 1000000 && Math.abs(price * 100 - Math.round(price * 100)) < 0.000001, 'Enter a valid session price with at most two decimal places.');
  requireValid(body.sessionDuration === undefined || [15, 30, 45, 60].includes(body.sessionDuration), 'Choose a session duration of 15, 30, 45 or 60 minutes.');
  requireValid(body.experienceYears === undefined || (Number.isInteger(body.experienceYears) && body.experienceYears >= 0 && body.experienceYears <= 100), 'Experience must be a whole number from 0 to 100.');
  for (const key of ['languages', 'expertise', 'mentoringTopics']) {
    requireValid(body[key] === undefined || (Array.isArray(body[key]) && body[key].length <= 50 && body[key].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500)), `${key} must be a list of non-empty text values.`);
  }
  const availability = body.availabilities ?? [];
  requireValid(Array.isArray(availability) && availability.length <= 50, 'Enter a valid availability schedule.');
  for (const slot of availability) {
    requireValid(slot && Number.isInteger(slot.dayOfWeek) && slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6
      && typeof slot.startTime === 'string' && typeof slot.endTime === 'string'
      && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.endTime)
      && slot.startTime < slot.endTime, 'Each availability must have a valid day and an end time after its start time.');
  }
  for (let i = 0; i < availability.length; i++) {
    for (let j = i + 1; j < availability.length; j++) {
      const a = availability[i], b = availability[j];
      requireValid(a.dayOfWeek !== b.dayOfWeek || a.endTime <= b.startTime || b.endTime <= a.startTime, 'Availability slots cannot overlap.');
    }
  }
  return { ...body, displayName: body.displayName.trim(), bio: body.bio.trim(), pricePerSession: price };
}

module.exports = { validateMentorApplication };
