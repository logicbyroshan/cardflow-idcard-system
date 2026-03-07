/**
 * Adarsh Mail — Alpine.js Component
 * 3-panel email client: folders | list | detail
 * Supports internal user-to-user mail + external email address sending
 */
function adarshMail() {
  return {
    // State
    currentFolder: 'inbox',
    messages: [],
    filteredMessages: [],
    searchQuery: '',
    selectedMessage: null,
    selectedDetail: null,
    loadingList: false,
    loadingDetail: false,
    counts: { inbox_unread: 0, inbox_total: 0, sent_total: 0, trash_total: 0 },

    // Compose state
    showCompose: false,
    composeMode: 'new',   // 'new' | 'reply' | 'forward'
    composeTarget: 'user', // 'user' | 'email'
    composeTo: '',
    composeToEmail: '',
    composeSubject: '',
    composeBody: '',
    sending: false,
    recipients: [],

    // Dev tools
    simulating: false,

    // Base URL — auto-detect from <script> tag or fallback
    baseUrl: '',

    init() {
      // Determine base URL for API calls
      const path = window.location.pathname;
      // Strip trailing slash, then use as base
      this.baseUrl = path.endsWith('/') ? path.slice(0, -1) : path;

      this.loadCounts();
      this.loadFolder('inbox');
      this.loadRecipients();
    },

    // ── Folder Navigation ──────────────────────────────────────────────
    switchFolder(folder) {
      this.currentFolder = folder;
      this.selectedMessage = null;
      this.selectedDetail = null;
      this.searchQuery = '';
      this.loadFolder(folder);
    },

    folderTitle() {
      const titles = { inbox: 'Inbox', sent: 'Sent', trash: 'Trash' };
      return titles[this.currentFolder] || 'Mail';
    },

    // ── Load Messages ──────────────────────────────────────────────────
    async loadFolder(folder) {
      this.loadingList = true;
      try {
        const res = await fetch(`${this.baseUrl}/api/folder/${folder}/`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const data = await res.json();
        if (data.status === 'ok') {
          this.messages = data.messages;
          this.filterMessages();
        }
      } catch (e) {
        console.error('Failed to load folder:', e);
      } finally {
        this.loadingList = false;
      }
    },

    async loadCounts() {
      try {
        const res = await fetch(`${this.baseUrl}/api/counts/`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const data = await res.json();
        if (data.status === 'ok') {
          this.counts = {
            inbox_unread: data.inbox_unread,
            inbox_total: data.inbox_total,
            sent_total: data.sent_total,
            trash_total: data.trash_total,
          };
        }
      } catch (e) {
        console.error('Failed to load counts:', e);
      }
    },

    filterMessages() {
      const q = this.searchQuery.toLowerCase().trim();
      if (!q) {
        this.filteredMessages = this.messages;
        return;
      }
      this.filteredMessages = this.messages.filter(m =>
        m.subject.toLowerCase().includes(q) ||
        m.sender_name.toLowerCase().includes(q) ||
        m.recipient_name.toLowerCase().includes(q) ||
        m.preview.toLowerCase().includes(q)
      );
    },

    // ── Select & View Message ──────────────────────────────────────────
    async selectMessage(msg) {
      this.selectedMessage = msg;
      this.loadingDetail = true;
      try {
        const res = await fetch(`${this.baseUrl}/api/message/${msg.id}/`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const data = await res.json();
        if (data.status === 'ok') {
          this.selectedDetail = data.message;
          // Mark as read in the list too
          if (this.currentFolder === 'inbox') {
            msg.is_read = true;
            this.loadCounts();
          }
        }
      } catch (e) {
        console.error('Failed to load message:', e);
      } finally {
        this.loadingDetail = false;
      }
    },

    // ── Compose ────────────────────────────────────────────────────────
    openCompose() {
      this.composeMode = 'new';
      this.composeTarget = 'user';
      this.composeTo = '';
      this.composeToEmail = '';
      this.composeSubject = '';
      this.composeBody = '';
      this.showCompose = true;
    },

    replyTo(msg) {
      this.composeMode = 'reply';
      // Find the sender in recipients list
      const sender = this.recipients.find(r => r.name === msg.sender_name);
      this.composeTo = sender ? String(sender.id) : '';
      this.composeSubject = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`;
      this.composeBody = '';
      this.showCompose = true;
    },

    forwardMessage(msg) {
      this.composeMode = 'forward';
      this.composeTo = '';
      this.composeSubject = msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`;
      this.composeBody = `\n\n---------- Forwarded message ----------\nFrom: ${msg.sender_name}\nDate: ${msg.created_at}\nSubject: ${msg.subject}\n\n${msg.body}`;
      this.showCompose = true;
    },

    async sendMessage() {
      // Validate based on target mode
      if (this.composeTarget === 'user' && !this.composeTo) {
        this.showToast('Please select a recipient', 'error');
        return;
      }
      if (this.composeTarget === 'email' && !this.composeToEmail.trim()) {
        this.showToast('Please enter an email address', 'error');
        return;
      }
      if (!this.composeSubject.trim() || !this.composeBody.trim()) {
        this.showToast('Please fill in subject and message', 'error');
        return;
      }

      this.sending = true;
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

      try {
        let url, payload;

        if (this.composeTarget === 'email') {
          // Send via email infrastructure API
          url = `${this.baseUrl}/api/email/send/`;
          payload = {
            to_email: this.composeToEmail.trim(),
            subject: this.composeSubject.trim(),
            body: this.composeBody.trim(),
          };
        } else {
          // Send via internal user-to-user API
          url = `${this.baseUrl}/api/compose/`;
          payload = {
            recipient_id: parseInt(this.composeTo),
            subject: this.composeSubject.trim(),
            body: this.composeBody.trim(),
          };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.status === 'ok') {
          this.showToast('Message sent!', 'success');
          this.showCompose = false;
          this.loadCounts();
          if (this.currentFolder === 'sent') {
            this.loadFolder('sent');
          }
        } else {
          this.showToast(data.message || 'Failed to send', 'error');
        }
      } catch (e) {
        this.showToast('Failed to send message', 'error');
      } finally {
        this.sending = false;
      }
    },

    // ── Recipients ─────────────────────────────────────────────────────
    async loadRecipients() {
      try {
        const res = await fetch(`${this.baseUrl}/api/recipients/`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const data = await res.json();
        if (data.status === 'ok') {
          this.recipients = data.recipients;
        }
      } catch (e) {
        console.error('Failed to load recipients:', e);
      }
    },

    // ── Trash / Restore ────────────────────────────────────────────────
    async trashMessage(msgId) {
      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        const res = await fetch(`${this.baseUrl}/api/trash/${msgId}/`, {
          method: 'POST',
          headers: {
            'X-CSRFToken': csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        const data = await res.json();
        if (data.status === 'ok') {
          this.showToast('Moved to trash', 'success');
          this.selectedDetail = null;
          this.selectedMessage = null;
          this.loadFolder(this.currentFolder);
          this.loadCounts();
        }
      } catch (e) {
        this.showToast('Failed to trash message', 'error');
      }
    },

    async restoreMessage(msgId) {
      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        const res = await fetch(`${this.baseUrl}/api/restore/${msgId}/`, {
          method: 'POST',
          headers: {
            'X-CSRFToken': csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        const data = await res.json();
        if (data.status === 'ok') {
          this.showToast('Message restored', 'success');
          this.selectedDetail = null;
          this.selectedMessage = null;
          this.loadFolder(this.currentFolder);
          this.loadCounts();
        }
      } catch (e) {
        this.showToast('Failed to restore message', 'error');
      }
    },

    // ── Print ──────────────────────────────────────────────────────────
    printMessage() {
      if (!this.selectedDetail) return;
      const w = window.open('', '_blank');
      w.document.write(`
        <html><head><title>${this.selectedDetail.subject}</title>
        <style>body{font-family:sans-serif;padding:40px;max-width:700px;margin:0 auto;}
        h1{font-size:1.3rem;} .meta{color:#666;font-size:0.9rem;margin-bottom:20px;}
        .body{line-height:1.7;white-space:pre-wrap;}</style></head>
        <body><h1>${this.selectedDetail.subject}</h1>
        <div class="meta">From: ${this.selectedDetail.sender_name}<br>
        To: ${this.selectedDetail.recipient_name}<br>
        Date: ${this.selectedDetail.created_at}</div>
        <div class="body">${this.selectedDetail.body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </body></html>
      `);
      w.document.close();
      w.print();
    },

    // ── Simulate Incoming Email (Dev Tool) ────────────────────────────
    async simulateIncoming() {
      this.simulating = true;
      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        const res = await fetch(`${this.baseUrl}/dev/simulate-incoming-email/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (data.status === 'ok') {
          this.showToast('Simulated incoming email received!', 'success');
          this.loadCounts();
          if (this.currentFolder === 'inbox') {
            this.loadFolder('inbox');
          }
        } else {
          this.showToast(data.message || 'Simulation failed', 'error');
        }
      } catch (e) {
        this.showToast('Failed to simulate incoming email', 'error');
      } finally {
        this.simulating = false;
      }
    },

    // ── Toast (uses Alpine global toast if available) ──────────────────
    showToast(message, type) {
      if (typeof Alpine !== 'undefined') {
        const root = document.querySelector('[x-data]');
        if (root && root.__x && root.__x.$data.addToast) {
          root.__x.$data.addToast(message, type);
          return;
        }
      }
      // Fallback: use the layout's Alpine toast
      try {
        Alpine.store('toast')?.add?.(message, type);
      } catch {
        // Silently fail
      }
    },
  };
}
