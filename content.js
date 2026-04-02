// Gmail Follow-Up Reminder — Content Script
// Intercepts Gmail's Send button and shows a reminder modal

(function () {
  'use strict';

  const SEND_SELECTORS = [
    '[aria-label*="Send"]',
    '[data-tooltip*="Send"]'
  ];

  const PROCESSED_ATTR = 'data-followup-processed';
  let modalVisible = false;

  // ── Utility: Generate unique ID ──────────────────────────────
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ── Utility: Get a date at 10:00 AM, N days from today ────────
  function dateAtTenAM(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    date.setHours(10, 0, 0, 0);
    return date;
  }

  // ── Utility: Compute reminder date from preset ───────────────
  function getPresetDate(preset) {
    switch (preset) {
      case 'tomorrow':
        return dateAtTenAM(1);
      case '2days':
        return dateAtTenAM(2);
      case '3days':
        return dateAtTenAM(3);
      case 'endofweek': {
        const now = new Date();
        const day = now.getDay(); // 0=Sun, 5=Fri
        const daysUntilFriday = day <= 5 ? (5 - day) : (5 + 7 - day);
        return dateAtTenAM(daysUntilFriday === 0 ? 7 : daysUntilFriday);
      }
      case '1week':
        return dateAtTenAM(7);
      case '2weeks':
        return dateAtTenAM(14);
      default:
        return null;
    }
  }

  // ── DOM helper: create element with props and children ───────
  function el(tag, attrs, ...children) {
    const element = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className') {
          element.className = value;
        } else if (key.startsWith('on')) {
          element.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
          element.setAttribute(key, value);
        }
      }
    }
    for (const child of children) {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child) {
        element.appendChild(child);
      }
    }
    return element;
  }

  // ── Extract email metadata from compose window ───────────────
  function extractEmailMeta(composeWindow) {
    let to = '';
    let subject = '';

    // Recipient — try multiple selectors
    const chips = composeWindow.querySelectorAll('[data-hovercard-id]');
    if (chips.length > 0) {
      to = Array.from(chips).map(c => c.getAttribute('data-hovercard-id') || c.textContent.trim()).join(', ');
    } else {
      const toField =
        composeWindow.querySelector('[aria-label="To recipients"]') ||
        composeWindow.querySelector('input[name="to"]');
      if (toField) {
        to = toField.value || toField.textContent.trim();
      }
    }

    // Subject
    const subjectField =
      composeWindow.querySelector('input[name="subjectbox"]') ||
      composeWindow.querySelector('[aria-label="Subject"]');
    if (subjectField) {
      subject = subjectField.value || subjectField.textContent.trim();
    }

    return { to, subject };
  }

  // ── Find the compose window that contains a given element ────
  function findComposeWindow(element) {
    return element.closest('[role="dialog"]') || element.closest('.nH .dw');
  }

  // ── Create and show the reminder modal ───────────────────────
  function showReminderModal(sendButton, emailMeta, onDone) {
    if (modalVisible) return;
    modalVisible = true;

    let selectedDate = null;
    const toDisplay = emailMeta.to || '(no recipient)';
    const subjectDisplay = emailMeta.subject || '(no subject)';

    // Set & Send button (created early so presets can enable it)
    const setSendBtn = el('button', {
      className: 'gfr-btn gfr-btn-send',
      id: 'gfr-set-send',
      disabled: 'true'
    }, 'Set & Send');

    // Preset buttons
    const presetButtons = [];
    const presets = [
      { key: 'tomorrow', label: 'Tomorrow' },
      { key: '2days', label: 'In 2 days' },
      { key: '3days', label: 'In 3 days' },
      { key: 'endofweek', label: 'End of week' },
      { key: '1week', label: 'In 1 week' },
      { key: '2weeks', label: 'In 2 weeks' }
    ];

    presets.forEach(({ key, label }) => {
      const btn = el('button', {
        className: 'gfr-preset-btn',
        'data-preset': key,
        onClick: () => {
          presetButtons.forEach(b => b.classList.remove('gfr-active'));
          btn.classList.add('gfr-active');
          selectedDate = getPresetDate(key);
          dateInput.value = '';
          setSendBtn.removeAttribute('disabled');
        }
      }, label);
      presetButtons.push(btn);
    });

    // Custom date input
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISO = new Date(now - tzOffset).toISOString().slice(0, 16);

    const dateInput = el('input', {
      type: 'datetime-local',
      id: 'gfr-custom-date',
      className: 'gfr-date-input',
      min: localISO,
      onChange: (e) => {
        if (e.target.value) {
          presetButtons.forEach(b => b.classList.remove('gfr-active'));
          selectedDate = new Date(e.target.value);
          setSendBtn.removeAttribute('disabled');
        }
      }
    });

    // Calendar checkbox
    const calendarCheckbox = el('input', {
      type: 'checkbox',
      id: 'gfr-add-calendar'
    });

    // Build the modal DOM
    const modal = el('div', { className: 'gfr-modal' },
      el('div', { className: 'gfr-header' }, 'Set a follow-up reminder?'),
      el('div', { className: 'gfr-meta' },
        el('div', { className: 'gfr-meta-row' },
          el('span', { className: 'gfr-label' }, 'To:'),
          el('span', { className: 'gfr-value' }, ' ' + toDisplay)
        ),
        el('div', { className: 'gfr-meta-row' },
          el('span', { className: 'gfr-label' }, 'Subject:'),
          el('span', { className: 'gfr-value' }, ' ' + subjectDisplay)
        )
      ),
      el('div', { className: 'gfr-presets' }, ...presetButtons),
      el('div', { className: 'gfr-custom' },
        el('label', { className: 'gfr-custom-label', for: 'gfr-custom-date' }, 'Custom date & time:'),
        dateInput
      ),
      el('div', { className: 'gfr-calendar-option' },
        el('label', { className: 'gfr-checkbox-label' },
          calendarCheckbox,
          ' Also add to Google Calendar'
        )
      ),
      el('div', { className: 'gfr-actions' },
        el('button', {
          className: 'gfr-btn gfr-btn-skip',
          id: 'gfr-skip',
          onClick: () => {
            closeModal(overlay);
            onDone(null);
          }
        }, 'No thanks'),
        setSendBtn
      )
    );

    // Set & Send click handler
    setSendBtn.addEventListener('click', () => {
      if (!selectedDate) return;
      const addToCalendar = calendarCheckbox.checked;
      closeModal(overlay);
      onDone({
        id: generateId(),
        to: emailMeta.to,
        subject: emailMeta.subject,
        sentAt: new Date().toISOString(),
        remindAt: selectedDate.toISOString(),
        status: 'pending',
        addToCalendar,
        calendarEventId: null
      });
    });

    // Overlay
    const overlay = el('div', { className: 'gfr-overlay' }, modal);

    // Close on overlay background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(overlay);
      }
    });

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal(overlay);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
  }

  function closeModal(overlay) {
    modalVisible = false;
    overlay.remove();
  }

  // ── Programmatically click Send (bypassing our interceptor) ──
  function triggerRealSend(sendButton) {
    sendButton.removeAttribute(PROCESSED_ATTR);
    sendButton._gfrBypassing = true;
    sendButton.click();
    // Re-mark after a tick so future clicks are intercepted again
    requestAnimationFrame(() => {
      sendButton._gfrBypassing = false;
      sendButton.setAttribute(PROCESSED_ATTR, 'true');
    });
  }

  // ── Attach interceptor to a Send button ──────────────────────
  function interceptSendButton(sendButton) {
    if (sendButton.getAttribute(PROCESSED_ATTR)) return;
    sendButton.setAttribute(PROCESSED_ATTR, 'true');

    sendButton.addEventListener('click', function handler(e) {
      // Allow our own programmatic re-click through
      if (sendButton._gfrBypassing) return;

      e.stopPropagation();
      e.preventDefault();

      const composeWindow = findComposeWindow(sendButton);
      const emailMeta = composeWindow ? extractEmailMeta(composeWindow) : { to: '', subject: '' };

      showReminderModal(sendButton, emailMeta, (reminder) => {
        if (reminder) {
          // Send reminder data to background service worker
          chrome.runtime.sendMessage({
            type: 'CREATE_REMINDER',
            reminder
          }, () => {
            triggerRealSend(sendButton);
          });
        } else {
          // User chose "No thanks" — just send
          triggerRealSend(sendButton);
        }
      });
    }, true); // Capturing phase — fires before Gmail's handlers
  }

  // ── Scan for Send buttons in the DOM ─────────────────────────
  function scanForSendButtons(root) {
    SEND_SELECTORS.forEach(selector => {
      root.querySelectorAll(selector).forEach(el => {
        // Filter to actual Send buttons (not "Send and Archive" etc)
        const label = (el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || '').trim();
        if (label === 'Send' || label === 'Send \u202A(\u2318Enter)\u202C' || label === 'Send \u202A(Ctrl+Enter)\u202C') {
          interceptSendButton(el);
        }
      });
    });
  }

  // ── MutationObserver: watch for compose windows ──────────────
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        scanForSendButtons(node);
      }
    }
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Initial scan for any already-open compose windows
  scanForSendButtons(document.body);
})();
