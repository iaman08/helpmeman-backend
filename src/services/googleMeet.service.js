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

/**
 * Validate that a meeting link is a valid, working Google Meet URL.
 * Rejects broken enterprise lookup links (meet.google.com/lookup/...) and old dead links.
 */
function isValidMeetLink(link) {
  if (!link || typeof link !== 'string') return false;
  const trimmed = link.trim().toLowerCase();
  if (trimmed.includes('meet.google.com/lookup/')) return false;
  if (trimmed.includes('qhs-wase-kny')) return false;
  if (!trimmed.includes('meet.google.com/')) return false;
  const match = trimmed.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  return Boolean(match && match[1] && match[1].length >= 3);
}

/**
 * Create a Google Calendar event with a Google Meet link.
 *
 * @param {Object} params
 * @param {Object} params.booking  - Prisma Booking record
 * @param {Object} params.mentor   - Prisma Mentor record (with googleCalendarConnected, customMeetLink, etc.)
 * @param {Object} params.user     - Prisma User record (the mentee)
 * @param {string} [params.timezone] - IANA timezone string (overrides mentor.googleCalendarTimezone)
 *
 * @returns {{ googleEventId: string|null, meetLink: string|null }}
 */
async function createMeetingEvent({ booking, mentor, user, timezone }) {
  try {
    const tz = timezone || mentor?.googleCalendarTimezone || 'Asia/Kolkata';

    // 1. Primary: If mentor has connected their own Google Calendar,
    // creating the event on their calendar makes the MENTOR the official host!
    let authClient = await getAuthedClientForMentor(mentor);

    if (authClient) {
      try {
        const mentorEmail = mentor.user?.email || mentor.institutionEmail;
        const menteeEmail = user.email;

        const startTime = new Date(booking.scheduledAt);
        const endTime = new Date(startTime.getTime() + booking.durationMinutes * 60 * 1000);

        const calendar = google.calendar({ version: 'v3', auth: authClient });

        const event = {
          summary: `HelpMeMan: Session with ${mentor.displayName}`,
          description: [
            `Mentorship session on HelpMeMan.`,
            ``,
            `Mentor: ${mentor.displayName} (Host)`,
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
              { method: 'email', minutes: 60 },
              { method: 'popup', minutes: 15 },
            ],
          },
          guestsCanModify: false,
          guestsCanInviteOthers: false,
        };

        const response = await calendar.events.insert({
          calendarId: 'primary',
          resource: event,
          conferenceDataVersion: 1,
          sendUpdates: 'all',
        });

        const dynamicMeetLink =
          response.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
          response.data.hangoutLink ||
          null;

        if (dynamicMeetLink && isValidMeetLink(dynamicMeetLink)) {
          console.log(`[googleMeet] Dynamic Meet created via mentor Calendar: ${dynamicMeetLink}`);
          return {
            googleEventId: response.data.id,
            meetLink: dynamicMeetLink,
          };
        }
      } catch (calErr) {
        console.warn(`[googleMeet] Mentor calendar event insertion failed: ${calErr.message}`);
      }
    }

    // 2. Secondary: If mentor provided a personal/custom Google Meet link,
    // use it! Because the mentor created this room on their own account, the mentor IS the host!
    const mentorCustomMeet = mentor?.customMeetLink || mentor?.googleCalendarId;
    if (mentorCustomMeet && isValidMeetLink(mentorCustomMeet)) {
      console.log(`[googleMeet] Using mentor custom Meet link (mentor is host): ${mentorCustomMeet}`);
      return {
        googleEventId: null,
        meetLink: mentorCustomMeet.trim(),
      };
    }

    // 3. Tertiary: Fallback to centralized platform Google Meet service
    try {
      const { createCentralMeeting } = require('./centralMeet.service');
      const mentorEmail = mentor.user?.email || mentor.institutionEmail;
      const menteeEmail = user.email;

      if (mentorEmail && menteeEmail) {
        const centralMeeting = await createCentralMeeting({
          clientId: 'helpmeman-booking',
          mentorId: mentor.id,
          menteeId: user.id || booking.userId,
          mentorEmail,
          menteeEmail,
          topic: `HelpMeMan: Session with ${mentor.displayName}`,
          startTime: booking.scheduledAt,
          durationMinutes: booking.durationMinutes,
          idempotencyKey: `booking-${booking.id}`,
        });

        if (centralMeeting?.meetUrl && isValidMeetLink(centralMeeting.meetUrl)) {
          console.log(`[googleMeet] Event created via central Meet service: ${centralMeeting.meetUrl}`);
          return {
            googleEventId: centralMeeting.googleEventId,
            meetLink: centralMeeting.meetUrl,
          };
        }
      }
    } catch (centralErr) {
      console.warn(`[googleMeet] Central Meet service creation fallback failed: ${centralErr.message}`);
    }

    // Never return broken enterprise lookup links!
    // Return null so the mentor can set their Google Meet room as host.
    return {
      googleEventId: null,
      meetLink: null,
    };
  } catch (error) {
    console.error('[googleMeet] createMeetingEvent error:', error.message);
    const fallback = mentor?.customMeetLink || mentor?.googleCalendarId || null;
    return {
      googleEventId: null,
      meetLink: isValidMeetLink(fallback) ? fallback : null,
    };
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

module.exports = { createMeetingEvent, updateMeetingEvent, cancelMeetingEvent, isValidMeetLink };
