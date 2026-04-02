// Gmail Follow-Up Reminder — Background Service Worker
// Manages reminders, alarms, notifications, and calendar integration

// ── Message handler from content script ────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CREATE_REMINDER') {
    createReminder(message.reminder).then(() => sendResponse({ ok: true }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'GET_REMINDERS') {
    getReminders().then(reminders => sendResponse({ reminders }));
    return true;
  }

  if (message.type === 'UPDATE_REMINDER') {
    updateReminder(message.id, message.updates).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'DELETE_REMINDER') {
    deleteReminder(message.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'SNOOZE_REMINDER') {
    snoozeReminder(message.id, message.newRemindAt).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ── Create a new reminder ──────────────────────────────────────
async function createReminder(reminder) {
  const reminders = await getReminders();
  reminders.push(reminder);
  await chrome.storage.local.set({ reminders });

  // Schedule the alarm
  await chrome.alarms.create(`reminder_${reminder.id}`, {
    when: new Date(reminder.remindAt).getTime()
  });

  // If user wants Google Calendar integration
  if (reminder.addToCalendar) {
    try {
      const eventId = await createCalendarEvent(reminder);
      if (eventId) {
        await updateReminder(reminder.id, { calendarEventId: eventId });
      }
    } catch (err) {
      console.warn('Failed to create calendar event:', err);
    }
  }
}

// ── Get all reminders from storage ─────────────────────────────
async function getReminders() {
  const data = await chrome.storage.local.get('reminders');
  return data.reminders || [];
}

// ── Update a reminder by ID ────────────────────────────────────
async function updateReminder(id, updates) {
  const reminders = await getReminders();
  const index = reminders.findIndex(r => r.id === id);
  if (index !== -1) {
    reminders[index] = { ...reminders[index], ...updates };
    await chrome.storage.local.set({ reminders });
  }
}

// ── Delete a reminder by ID ────────────────────────────────────
async function deleteReminder(id) {
  const reminders = await getReminders();
  const filtered = reminders.filter(r => r.id !== id);
  await chrome.storage.local.set({ reminders: filtered });
  await chrome.alarms.clear(`reminder_${id}`);
}

// ── Snooze a reminder ──────────────────────────────────────────
async function snoozeReminder(id, newRemindAt) {
  await updateReminder(id, {
    remindAt: newRemindAt,
    status: 'pending'
  });
  await chrome.alarms.clear(`reminder_${id}`);
  await chrome.alarms.create(`reminder_${id}`, {
    when: new Date(newRemindAt).getTime()
  });
}

// ── Alarm handler — fires when a reminder is due ───────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('reminder_')) return;

  const reminderId = alarm.name.replace('reminder_', '');
  const reminders = await getReminders();
  const reminder = reminders.find(r => r.id === reminderId);

  if (!reminder || reminder.status !== 'pending') return;

  // Show notification
  chrome.notifications.create(`notif_${reminderId}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Follow-up Reminder',
    message: `Follow up with ${reminder.to || 'recipient'} about: ${reminder.subject || '(no subject)'}`,
    priority: 2,
    requireInteraction: true
  });

  // Mark as notified
  await updateReminder(reminderId, { status: 'notified' });
});

// ── Notification click — open Gmail search for the thread ──────
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith('notif_')) return;

  const reminderId = notificationId.replace('notif_', '');
  const reminders = await getReminders();
  const reminder = reminders.find(r => r.id === reminderId);

  if (reminder) {
    // Open Gmail with a search for the sent email
    const searchQuery = encodeURIComponent(`in:sent to:${reminder.to} subject:${reminder.subject}`);
    chrome.tabs.create({
      url: `https://mail.google.com/mail/u/0/#search/${searchQuery}`
    });
  }

  chrome.notifications.clear(notificationId);
});

// ── Google Calendar integration ────────────────────────────────
async function createCalendarEvent(reminder) {
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });

    const remindDate = new Date(reminder.remindAt);
    const endDate = new Date(remindDate.getTime() + 30 * 60 * 1000); // 30 min event

    const gmailSearchQuery = encodeURIComponent(`in:sent to:${reminder.to} subject:${reminder.subject}`);
    const gmailLink = `https://mail.google.com/mail/u/0/#search/${gmailSearchQuery}`;

    const event = {
      summary: `Follow up: ${reminder.subject || '(no subject)'}`,
      description: `Reminder to follow up with ${reminder.to || 'recipient'} about "${reminder.subject || ''}".\n\nSent on: ${new Date(reminder.sentAt).toLocaleString()}\n\nOpen email: ${gmailLink}`,
      start: {
        dateTime: remindDate.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 0 }
        ]
      }
    };

    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      throw new Error(`Calendar API error: ${response.status}`);
    }

    const created = await response.json();
    return created.id;
  } catch (err) {
    console.error('Calendar event creation failed:', err);
    return null;
  }
}
