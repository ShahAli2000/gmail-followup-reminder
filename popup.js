// Gmail Follow-Up Reminder — Popup Dashboard

document.addEventListener('DOMContentLoaded', () => {
  let currentTab = 'pending';
  const listEl = document.getElementById('reminder-list');
  const emptyEl = document.getElementById('empty-state');

  // ── Tab switching ────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      loadReminders();
    });
  });

  // ── Load and render reminders ────────────────────────────────
  function loadReminders() {
    chrome.runtime.sendMessage({ type: 'GET_REMINDERS' }, (response) => {
      const reminders = response?.reminders || [];

      let filtered;
      if (currentTab === 'pending') {
        filtered = reminders.filter(r => r.status === 'pending' || r.status === 'notified');
      } else {
        filtered = reminders.filter(r => r.status === 'completed');
      }

      // Sort by reminder date
      filtered.sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));

      renderReminders(filtered);
    });
  }

  // ── Render reminder list ─────────────────────────────────────
  function renderReminders(reminders) {
    // Clear existing content
    while (listEl.firstChild) {
      listEl.removeChild(listEl.firstChild);
    }

    if (reminders.length === 0) {
      listEl.style.display = 'none';
      emptyEl.style.display = 'block';
      emptyEl.querySelector('.empty-text').textContent =
        currentTab === 'pending' ? 'No pending reminders' : 'No completed reminders';
      return;
    }

    listEl.style.display = 'block';
    emptyEl.style.display = 'none';

    reminders.forEach(reminder => {
      const item = createReminderElement(reminder);
      listEl.appendChild(item);
    });
  }

  // ── Create a single reminder DOM element ─────────────────────
  function createReminderElement(reminder) {
    const item = document.createElement('div');
    item.className = 'reminder-item';

    // Top row: subject + status badge
    const top = document.createElement('div');
    top.className = 'reminder-top';

    const subject = document.createElement('span');
    subject.className = 'reminder-subject';
    subject.textContent = reminder.subject || '(no subject)';

    const status = document.createElement('span');
    status.className = `reminder-status status-${reminder.status}`;
    status.textContent = reminder.status === 'notified' ? 'due' : reminder.status;

    top.appendChild(subject);
    top.appendChild(status);

    // Recipient
    const toEl = document.createElement('div');
    toEl.className = 'reminder-to';
    toEl.textContent = `To: ${reminder.to || '(unknown)'}`;

    // Date info
    const dateEl = document.createElement('div');
    dateEl.className = 'reminder-date';
    const remindDate = new Date(reminder.remindAt);
    const sentDate = new Date(reminder.sentAt);
    dateEl.textContent = `Sent ${formatRelative(sentDate)} · Reminder ${formatRelative(remindDate)}`;

    item.appendChild(top);
    item.appendChild(toEl);
    item.appendChild(dateEl);

    // Actions (only for pending/notified)
    if (reminder.status !== 'completed') {
      const actions = document.createElement('div');
      actions.className = 'reminder-actions';

      // Done button
      const doneBtn = document.createElement('button');
      doneBtn.className = 'action-btn done-btn';
      doneBtn.textContent = 'Done';
      doneBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: 'UPDATE_REMINDER',
          id: reminder.id,
          updates: { status: 'completed' }
        }, () => loadReminders());
      });

      // Snooze dropdown
      const snoozeSelect = document.createElement('select');
      snoozeSelect.className = 'snooze-select';

      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Snooze...';
      snoozeSelect.appendChild(defaultOption);

      const snoozeOptions = [
        { value: '1h', label: '1 hour' },
        { value: '1d', label: 'Tomorrow' },
        { value: '3d', label: 'In 3 days' },
        { value: '1w', label: 'In 1 week' }
      ];

      snoozeOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        snoozeSelect.appendChild(option);
      });

      snoozeSelect.addEventListener('change', () => {
        if (!snoozeSelect.value) return;
        const newDate = computeSnoozeDate(snoozeSelect.value);
        chrome.runtime.sendMessage({
          type: 'SNOOZE_REMINDER',
          id: reminder.id,
          newRemindAt: newDate.toISOString()
        }, () => loadReminders());
      });

      // Dismiss button
      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'action-btn dismiss-btn';
      dismissBtn.textContent = 'Dismiss';
      dismissBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: 'DELETE_REMINDER',
          id: reminder.id
        }, () => loadReminders());
      });

      actions.appendChild(doneBtn);
      actions.appendChild(snoozeSelect);
      actions.appendChild(dismissBtn);
      item.appendChild(actions);
    }

    return item;
  }

  // ── Compute snooze date (defaults to 10 AM) ──────────────────
  function snoozeAtTenAM(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    date.setHours(10, 0, 0, 0);
    return date;
  }

  function computeSnoozeDate(value) {
    switch (value) {
      case '1h':
        return new Date(Date.now() + 60 * 60 * 1000);
      case '1d':
        return snoozeAtTenAM(1);
      case '3d':
        return snoozeAtTenAM(3);
      case '1w':
        return snoozeAtTenAM(7);
      default:
        return snoozeAtTenAM(1);
    }
  }

  // ── Format relative date ─────────────────────────────────────
  function formatRelative(date) {
    const now = new Date();
    const diffMs = date - now;
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

    if (Math.abs(diffMs) < 60 * 60 * 1000) {
      const mins = Math.round(Math.abs(diffMs) / (60 * 1000));
      if (diffMs < 0) return `${mins}m ago`;
      return `in ${mins}m`;
    }

    if (Math.abs(diffMs) < 24 * 60 * 60 * 1000) {
      const hours = Math.round(Math.abs(diffMs) / (60 * 60 * 1000));
      if (diffMs < 0) return `${hours}h ago`;
      return `in ${hours}h`;
    }

    if (Math.abs(diffDays) <= 14) {
      if (diffDays < 0) return `${Math.abs(diffDays)}d ago`;
      return `in ${diffDays}d`;
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ── Initial load ─────────────────────────────────────────────
  loadReminders();
});
