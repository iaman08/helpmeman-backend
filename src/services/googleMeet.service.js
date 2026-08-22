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

/**
 * Format a DateTime in the mentor's configured timezone for the Calendar API.
 */
function makeDateTime(isoDate, timezone) {
  return {
    dateTime: new Date(isoDate).toISOString(),
    timeZone: timezone || 'Asia/Kolkata',
  };
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
    const authClient = await getAuthedClientForMentor(mentor);

    if (!authClient) {
      console.warn(`[googleMeet] Mentor ${mentor.id} has no Google Calendar connected — using default Meet link.`);
      return { googleEventId: null, meetLink: DEFAULT_MEET_LINK };
    }

    const calendar = google.calendar({ version: 'v3', auth: authClient });

    const mentorEmail = mentor.user?.email || mentor.institutionEmail;
    const menteeEmail = user.email;

    const startTime = new Date(booking.scheduledAt);
    const endTime = new Date(startTime.getTime() + booking.durationMinutes * 60 * 1000);

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
        `Meeting Link: ${DEFAULT_MEET_LINK}`,
        `Please join 5 minutes early to test your connection.`,
      ].join('\n'),
      start: makeDateTime(startTime, tz),
      end: makeDateTime(endTime, tz),
      attendees: [
        { email: menteeEmail, displayName: user.name },
        { email: mentorEmail, displayName: mentor.displayName, organizer: true },
      ],
      conferenceData: {
        createRequest: {
          requestId: `hmm-${booking.id}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email',  minutes: 60 },  // 1 hour before
          { method: 'popup',  minutes: 15 },  // 15 min before
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
      null;

    const finalMeetLink = dynamicMeetLink || DEFAULT_MEET_LINK;

    console.log(`[googleMeet] Event created: ${response.data.id} | Meet: ${finalMeetLink}`);

    return {
      googleEventId: response.data.id,
      meetLink: finalMeetLink,
    };
  } catch (error) {
    console.error('[googleMeet] createMeetingEvent error:', error.message);
    // Fallback to default Meet link so booking always has a valid link
    return { googleEventId: null, meetLink: DEFAULT_MEET_LINK };
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
    const authClient = await getAuthedClientForMentor(mentor);
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
    const authClient = await getAuthedClientForMentor(mentor);
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
