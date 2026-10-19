/**
 * Google Meet / Calendar Service
 *
 * Creates, updates, and cancels Google Calendar events with Google Meet
 * conference links — using the *mentor's own* connected Google account.
 *
 * Falls back gracefully if the mentor hasn't connected Google Calendar,
 * returning { googleEventId: null, meetLink: null }.
 */

const { google } = require('googleapis');
const { getAuthedClientForMentor } = require('./googleOAuth.service');
const config = require('../config/env');

/**
 * Format a DateTime in the mentor's configured timezone for the Calendar API.
 */
function makeDateTime(isoDate, timezone) {
  return {
    dateTime: new Date(isoDate).toISOString(),
    timeZone: timezone || 'Asia/Kolkata',
  };
}

/**
 * Build authorized client for the platform's Google account
 */
function getPlatformAuthedClient() {
  if (!config.google?.clientId || !config.google?.clientSecret || !config.google?.refreshToken) {
    return null;
  }
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
  oauth2Client.setCredentials({
    refresh_token: config.google.refreshToken,
  });
  return oauth2Client;
}

const DEFAULT_MEET_LINK = 'https://meet.google.com/qhs-wase-kny?pli=1';

/**
 * Create a Google Calendar event with a Google Meet link.
 *
 * @param {Object} params
 * @param {Object} params.booking  - Prisma Booking record
 * @param {Object} params.mentor   - Prisma Mentor record (with googleCalendarConnected, etc.)
 * @param {Object} params.user     - Prisma User record (the mentee)
 * @param {string} [params.timezone] - IANA timezone string (overrides mentor.googleCalendarTimezone)
 *
 * @returns {{ googleEventId: string|null, meetLink: string }}
 */
async function createMeetingEvent({ booking, mentor, user, timezone }) {
  try {
    const tz = timezone || mentor.googleCalendarTimezone || 'Asia/Kolkata';
    let authClient = await getAuthedClientForMentor(mentor);

    // Fallback to platform-level Google account if mentor hasn't connected theirs
    if (!authClient && config.google?.refreshToken) {
      console.log(`[googleMeet] Mentor ${mentor.id} has no calendar connected — using platform Google account.`);
      authClient = getPlatformAuthedClient();
    }

    const mentorEmail = mentor.user?.email || mentor.institutionEmail;
    const menteeEmail = user.email;

    const startTime = new Date(booking.scheduledAt);
    const endTime = new Date(startTime.getTime() + booking.durationMinutes * 60 * 1000);

    const cleanId = booking.id ? String(booking.id).replace(/[^a-zA-Z0-9]/g, '').slice(-9) : Math.random().toString(36).slice(2, 11);
    const fallbackMeetLink = `https://meet.google.com/lookup/hmm-${cleanId}`;

    if (!authClient) {
      console.warn(`[googleMeet] No Google account configured — using unique fallback Meet link.`);
      return { googleEventId: null, meetLink: fallbackMeetLink };
    }

    const calendar = google.calendar({ version: 'v3', auth: authClient });

    const event = {
      summary: `HelpMeMan: Session with ${mentor.displayName}`,
      description: [
        `Mentorship session on HelpMeMan.`,
        ``,
        `Mentor: ${mentor.displayName}`,
        `Mentee: ${user.name}`,
        `Duration: ${booking.durationMinutes} minutes`,
        `Booking ID: ${booking.id}`,
        ``,
        `Please join 5 minutes early to test your audio & video.`,
      ].join('\n'),
      start: makeDateTime(startTime, tz),
      end: makeDateTime(endTime, tz),
      attendees: [
        { email: menteeEmail, displayName: user.name },
        ...(mentorEmail ? [{ email: mentorEmail, displayName: mentor.displayName }] : []),
      ],
      conferenceData: {
        createRequest: {
          requestId: `hmm-${booking.id}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 60 },  // 1 hour before
          { method: 'popup', minutes: 15 },  // 15 min before
        ],
      },
      guestsCanModify: false,
      guestsCanInviteOthers: false,
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,  // Required to generate Meet link
      sendUpdates: 'all',        // Send calendar invites to attendees
    });

    const dynamicMeetLink =
      response.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
      response.data.hangoutLink ||
      null;

    const finalMeetLink = dynamicMeetLink || fallbackMeetLink;

    console.log(`[googleMeet] Event created: ${response.data.id} | Meet: ${finalMeetLink}`);

    // Update event description to explicitly include Google Meet Link
    if (dynamicMeetLink && response.data.id) {
      try {
        await calendar.events.patch({
          calendarId: 'primary',
          eventId: response.data.id,
          resource: {
            description: [
              `Mentorship session on HelpMeMan.`,
              ``,
              `Mentor: ${mentor.displayName}`,
              `Mentee: ${user.name}`,
              `Duration: ${booking.durationMinutes} minutes`,
              `Booking ID: ${booking.id}`,
              ``,
              `Google Meet Link: ${dynamicMeetLink}`,
              `Please join 5 minutes early to test your connection.`,
            ].join('\n'),
          },
        });
      } catch (_) {}
    }

    return {
      googleEventId: response.data.id,
      meetLink: finalMeetLink,
    };
  } catch (error) {
    console.error('[googleMeet] createMeetingEvent error:', error.message);
    const cleanId = booking?.id ? String(booking.id).replace(/[^a-zA-Z0-9]/g, '').slice(-9) : 'session';
    return { googleEventId: null, meetLink: `https://meet.google.com/lookup/hmm-${cleanId}` };
  }
}

/**
 * Update (reschedule) an existing Google Calendar event.
 *
 * @param {Object} mentor          - Mentor record (for auth)
 * @param {string} googleEventId   - The event ID to update
 * @param {string} newScheduledAt  - ISO date string for the new start time
 * @param {number} durationMinutes
 * @param {string} [timezone]
 */
async function updateMeetingEvent(mentor, googleEventId, newScheduledAt, durationMinutes, timezone) {
  try {
    const tz = timezone || mentor.googleCalendarTimezone || 'Asia/Kolkata';
    let authClient = await getAuthedClientForMentor(mentor);
    if (!authClient && config.google?.refreshToken) {
      authClient = getPlatformAuthedClient();
    }
    if (!authClient || !googleEventId) return;

    const calendar = google.calendar({ version: 'v3', auth: authClient });

    const startTime = new Date(newScheduledAt);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    await calendar.events.patch({
      calendarId: 'primary',
      eventId: googleEventId,
      resource: {
        start: makeDateTime(startTime, tz),
        end: makeDateTime(endTime, tz),
      },
      sendUpdates: 'all',
    });

    console.log(`[googleMeet] Event ${googleEventId} rescheduled to ${newScheduledAt}`);
  } catch (error) {
    console.error('[googleMeet] updateMeetingEvent error:', error.message);
  }
}

/**
 * Cancel (delete) a Google Calendar event.
 *
 * @param {Object} mentor        - Mentor record (for auth)
 * @param {string} googleEventId - The event ID to delete
 */
async function cancelMeetingEvent(mentor, googleEventId) {
  try {
    let authClient = await getAuthedClientForMentor(mentor);
    if (!authClient && config.google?.refreshToken) {
      authClient = getPlatformAuthedClient();
    }
    if (!authClient || !googleEventId) return;

    const calendar = google.calendar({ version: 'v3', auth: authClient });

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: googleEventId,
      sendUpdates: 'all',
    });

    console.log(`[googleMeet] Event ${googleEventId} cancelled`);
  } catch (error) {
    console.error('[googleMeet] cancelMeetingEvent error:', error.message);
  }
}

module.exports = { createMeetingEvent, updateMeetingEvent, cancelMeetingEvent };
