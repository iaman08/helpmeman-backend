const { google } = require('googleapis');
const config = require('../config/env');

const oauth2Client = new google.auth.OAuth2(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri
);

oauth2Client.setCredentials({ refresh_token: config.google.refreshToken });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

async function createMeetingEvent({ booking, mentor, user }) {
  try {
    const event = {
      summary: `HelpMeMan: ${user.name} with ${mentor.displayName}`,
      description: `Mentorship session. Booking: ${booking.id}`,
      start: { dateTime: new Date(booking.scheduledAt).toISOString(), timeZone: 'Asia/Kolkata' },
      end: {
        dateTime: new Date(new Date(booking.scheduledAt).getTime() + booking.durationMinutes * 60000).toISOString(),
        timeZone: 'Asia/Kolkata',
      },
      attendees: [
        { email: user.email, displayName: user.name },
        { email: mentor.user?.email || mentor.institutionEmail, displayName: mentor.displayName },
      ],
      conferenceData: {
        createRequest: { requestId: `hmm-${booking.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 15 }] },
    };
    const response = await calendar.events.insert({ calendarId: 'primary', resource: event, conferenceDataVersion: 1, sendUpdates: 'all' });
    return {
      googleEventId: response.data.id,
      meetLink: response.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || null,
    };
  } catch (error) {
    console.error('Google Meet error:', error);
    return { googleEventId: null, meetLink: null };
  }
}

async function updateMeetingEvent(googleEventId, newScheduledAt, durationMinutes) {
  try {
    const event = {
      start: { dateTime: new Date(newScheduledAt).toISOString(), timeZone: 'Asia/Kolkata' },
      end: {
        dateTime: new Date(new Date(newScheduledAt).getTime() + durationMinutes * 60000).toISOString(),
        timeZone: 'Asia/Kolkata',
      },
    };
    await calendar.events.patch({ calendarId: 'primary', eventId: googleEventId, resource: event, sendUpdates: 'all' });
  } catch (error) {
    console.error('Update event error:', error);
  }
}

async function cancelMeetingEvent(googleEventId) {
  try { await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId, sendUpdates: 'all' }); } catch (e) { console.error('Cancel event error:', e); }
}

module.exports = { createMeetingEvent, cancelMeetingEvent, updateMeetingEvent };
