// Dashboard quick action bridge for Manage Clients group message drawer
(function () {
    function showToastSafe(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type || 'info');
            return;
        }
        if (message) window.alert(message);
    }

    function escHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    document.addEventListener('DOMContentLoaded', function () {
        var drawer = document.getElementById('group-message-drawer');
        if (!drawer || typeof ApiClient === 'undefined') return;

        var closeDrawerBtn = document.getElementById('closeGroupMessageDrawer');
        var cancelBtn = document.getElementById('cancelGroupMessageBtn');
        var searchInput = document.getElementById('groupMessageClientSearch');
        var clientsList = document.getElementById('groupMessageClientsList');
        var targetSummary = document.getElementById('groupMessageTargetSummary');
        var historyContainer = document.getElementById('groupMessageHistory');
        var selectAllBtn = document.getElementById('groupMessageSelectAllVisibleBtn');
        var clearSelectionBtn = document.getElementById('groupMessageClearSelectionBtn');
        var messageText = document.getElementById('groupMessageText');
        var messageCounter = document.getElementById('groupMessageCounter');
        var durationWrap = document.getElementById('groupMessageDurationWrap');
        var temporaryDuration = document.getElementById('groupMessageTemporaryDuration');
        var sendBtn = document.getElementById('sendGroupMessageBtn');

        var state = {
            selectedClientIds: new Set(),
            clients: [],
            focusedClientId: null,
            lastClickedClientId: null,
        };

        function renderHistory(messages) {
            if (!historyContainer) return;
            if (!messages || !messages.length) {
                historyContainer.innerHTML = '<div class="group-msg-history-state">No messages sent yet.</div>';
                return;
            }

            historyContainer.innerHTML = messages.map(function (item) {
                var expiryHtml = '';
                if (item.visibility === 'temporary' && item.expires_at_display) {
                    expiryHtml = '<div class="group-msg-history-expiry">Temporary message. Expires: ' + escHtml(item.expires_at_display) + '</div>';
                }

                var statusText = item.notification_active
                    ? 'Visible to recipients'
                    : 'Manually removed from recipients';
                var rowClass = item.notification_active ? 'group-msg-history-item' : 'group-msg-history-item is-removed';
                var deleteHtml = item.notification_active
                    ? '<button type="button" class="group-msg-history-delete" title="Delete message" aria-label="Delete message" data-delete-client-message="' + escHtml(item.id) + '"><i class="fa-solid fa-trash"></i></button>'
                    : '';

                return ''
                    + '<article class="' + rowClass + '">'
                    + '<div class="group-msg-history-top">'
                    + '<div style="display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap;">'
                    + '<span class="group-msg-history-title">' + escHtml(item.sent_by_name || 'System') + '</span>'
                    + '<span class="group-msg-history-time">' + escHtml(item.created_at_display || '-') + '</span>'
                    + '</div>'
                    + deleteHtml
                    + '</div>'
                    + '<div class="group-msg-history-text">' + escHtml(item.message || '') + '</div>'
                    + '<div class="group-msg-history-meta">'
                    + '<span>Recipients: ' + escHtml(item.recipient_count || 0) + '</span>'
                    + '<span>' + escHtml(statusText) + '</span>'
                    + '</div>'
                    + expiryHtml
                    + '</article>';
            }).join('');
        }

        function renderHistoryPlaceholder(text) {
            if (!historyContainer) return;
            historyContainer.innerHTML = '<div class="group-msg-history-state">' + escHtml(text || 'Select a client to view history.') + '</div>';
        }

        function renderTargetSummary() {
            if (!targetSummary) return;
            var count = state.selectedClientIds.size;
            if (!count) {
                targetSummary.textContent = 'Sending to all clients';
            } else if (count === 1) {
                targetSummary.textContent = 'Sending to 1 selected client';
            } else {
                targetSummary.textContent = 'Sending to ' + String(count) + ' selected clients';
            }

            if (!sendBtn) return;
            if (!count) {
                sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send To All';
            } else if (count === 1) {
                sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send To 1 Client';
            } else {
                sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send To ' + String(count) + ' Clients';
            }
        }

        function getVisibleClientById(clientId) {
            var id = String(clientId);
            for (var i = 0; i < state.clients.length; i++) {
                if (String(state.clients[i].id) === id) return state.clients[i];
            }
            return null;
        }

        function selectRange(anchorId, targetId) {
            var orderedIds = state.clients.map(function (item) { return String(item.id); });
            var anchorIndex = orderedIds.indexOf(String(anchorId));
            var targetIndex = orderedIds.indexOf(String(targetId));
            if (anchorIndex < 0 || targetIndex < 0) return;

            var start = Math.min(anchorIndex, targetIndex);
            var end = Math.max(anchorIndex, targetIndex);
            for (var i = start; i <= end; i++) {
                state.selectedClientIds.add(orderedIds[i]);
            }
        }

        function renderClientList() {
            if (!clientsList) return;
            if (!state.clients.length) {
                clientsList.innerHTML = '<div class="group-msg-history-state">No clients found.</div>';
                renderTargetSummary();
                return;
            }

            clientsList.innerHTML = state.clients.map(function (client) {
                var clientId = String(client.id);
                var isSelected = state.selectedClientIds.has(clientId);
                var isFocused = String(state.focusedClientId || '') === clientId;
                var className = 'group-msg-client-row';
                if (isSelected) className += ' selected';
                if (isFocused) className += ' active';

                var statusText = client.status === 'active' ? 'Active' : 'Inactive';
                var userText = client.is_user_active ? 'Login active' : 'Login inactive';

                return ''
                    + '<div class="' + className + '" data-client-id="' + escHtml(clientId) + '">'
                    + '<div class="group-msg-client-meta">'
                    + '<span class="group-msg-client-name">' + escHtml(client.name || '-') + '</span>'
                    + '<span class="group-msg-client-sub">' + escHtml(statusText) + ' | ' + escHtml(userText) + '</span>'
                    + '</div>'
                    + '</div>';
            }).join('');

            renderTargetSummary();
        }

        function syncTemporaryVisibility() {
            if (!durationWrap) return;
            var selected = document.querySelector('input[name="groupMessageVisibility"]:checked');
            durationWrap.style.display = selected && selected.value === 'temporary' ? '' : 'none';
        }

        async function fetchTargets(query) {
            var q = encodeURIComponent(String(query || '').trim());
            var url = '/api/client/messages/targets/?limit=800';
            if (q) url += '&q=' + q;
            return ApiClient.get(url);
        }

        async function fetchMessages(clientId) {
            return ApiClient.get('/api/client/' + clientId + '/messages/');
        }

        async function deleteMessage(clientId, messageId) {
            return ApiClient.post('/api/client/' + clientId + '/messages/' + messageId + '/delete/', {});
        }

        async function sendGroupMessage(payload) {
            return ApiClient.post('/api/client/messages/group-send/', payload);
        }

        async function loadFocusedClientHistory() {
            if (!state.focusedClientId) {
                renderHistoryPlaceholder('Select a client from the left list to view message history.');
                return;
            }

            historyContainer.innerHTML = '<div class="group-msg-history-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading history...</div>';
            try {
                var result = await fetchMessages(state.focusedClientId);
                if (!result || !result.success) {
                    throw new Error((result && result.message) || 'Failed to load history');
                }
                renderHistory(result.messages || []);
            } catch (error) {
                historyContainer.innerHTML = '<div class="group-msg-history-state" style="color:#ef4444;">Failed to load history.</div>';
                showToastSafe(error.message || 'Failed to load message history', 'error');
            }
        }

        async function loadClients(query) {
            if (!clientsList) return;
            clientsList.innerHTML = '<div class="group-msg-history-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading clients...</div>';

            try {
                var response = await fetchTargets(query || '');
                if (!response || !response.success) {
                    throw new Error((response && response.message) || 'Failed to load clients');
                }

                state.clients = Array.isArray(response.clients) ? response.clients : [];
                if (state.focusedClientId && !getVisibleClientById(state.focusedClientId)) {
                    state.focusedClientId = null;
                }

                renderClientList();

                if (!state.focusedClientId && state.selectedClientIds.size === 1) {
                    state.focusedClientId = Array.from(state.selectedClientIds)[0];
                    renderClientList();
                }

                if (state.focusedClientId) {
                    loadFocusedClientHistory();
                } else {
                    renderHistoryPlaceholder('Select a client from the left list to view message history.');
                }
            } catch (error) {
                clientsList.innerHTML = '<div class="group-msg-history-state" style="color:#ef4444;">Failed to load clients.</div>';
                showToastSafe(error.message || 'Failed to load clients', 'error');
            }
        }

        function openDrawer(preselectedClientIds, focusedClientId) {
            var selectedIds = [];
            if (Array.isArray(preselectedClientIds) && preselectedClientIds.length) {
                selectedIds = preselectedClientIds;
            }

            state.selectedClientIds = new Set(selectedIds.map(function (item) { return String(item); }));
            state.clients = [];
            state.focusedClientId = focusedClientId
                ? String(focusedClientId)
                : (state.selectedClientIds.size === 1 ? Array.from(state.selectedClientIds)[0] : null);
            state.lastClickedClientId = state.focusedClientId;

            if (messageText) messageText.value = '';
            if (messageCounter) messageCounter.textContent = '0 / 2000';
            if (searchInput) searchInput.value = '';
            if (temporaryDuration) temporaryDuration.value = '6h';

            var scopeRadio = document.querySelector('input[name="groupMessageScope"][value="client_only"]');
            if (scopeRadio) scopeRadio.checked = true;
            var visibilityRadio = document.querySelector('input[name="groupMessageVisibility"][value="permanent"]');
            if (visibilityRadio) visibilityRadio.checked = true;

            syncTemporaryVisibility();
            renderTargetSummary();
            renderHistoryPlaceholder('Select a client from the left list to view message history.');

            drawer.classList.add('open');
            document.body.style.overflow = 'hidden';

            loadClients('');
        }

        function closeDrawer() {
            drawer.classList.remove('open');
            document.body.style.overflow = '';
        }

        window.DashboardClientMessageDrawer = {
            open: openDrawer,
            close: closeDrawer,
        };

        var quickActionButtons = Array.from(document.querySelectorAll('[data-dashboard-quick-action="open-client-message"]'));
        quickActionButtons.forEach(function (button) {
            button.addEventListener('click', function (event) {
                event.preventDefault();
                if (window.DashboardPage && typeof window.DashboardPage.setQuickActionActive === 'function') {
                    window.DashboardPage.setQuickActionActive('open-client-message');
                } else {
                    quickActionButtons.forEach(function (node) {
                        node.classList.add('is-active');
                    });
                }
                openDrawer();
            });
        });

        if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);
        if (cancelBtn) cancelBtn.addEventListener('click', closeDrawer);

        if (messageText && messageCounter) {
            messageText.addEventListener('input', function () {
                messageCounter.textContent = String(messageText.value.length) + ' / 2000';
            });
        }

        if (searchInput) {
            var searchTimer = null;
            searchInput.addEventListener('input', function () {
                if (searchTimer) window.clearTimeout(searchTimer);
                searchTimer = window.setTimeout(function () {
                    loadClients(searchInput.value || '');
                }, 250);
            });
        }

        if (clientsList) {
            clientsList.addEventListener('click', function (event) {
                var row = event.target.closest('.group-msg-client-row');
                if (!row) return;
                var clientId = String(row.getAttribute('data-client-id') || '');
                if (!clientId) return;

                var isShift = !!event.shiftKey && !!state.lastClickedClientId;
                if (isShift) {
                    selectRange(state.lastClickedClientId, clientId);
                } else if (state.selectedClientIds.has(clientId)) {
                    state.selectedClientIds.delete(clientId);
                } else {
                    state.selectedClientIds.add(clientId);
                }

                state.focusedClientId = clientId;
                state.lastClickedClientId = clientId;
                renderClientList();
                loadFocusedClientHistory();
            });
        }

        if (historyContainer) {
            historyContainer.addEventListener('click', async function (event) {
                var deleteBtn = event.target.closest('[data-delete-client-message]');
                if (!deleteBtn || !state.focusedClientId) return;

                var messageId = deleteBtn.getAttribute('data-delete-client-message');
                if (!messageId) return;

                deleteBtn.disabled = true;
                deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

                try {
                    var result = await deleteMessage(state.focusedClientId, messageId);
                    if (!result || !result.success) {
                        throw new Error((result && result.message) || 'Failed to remove message');
                    }
                    showToastSafe(result.message || 'Message removed from client inbox', 'success');
                } catch (error) {
                    showToastSafe(error.message || 'Failed to remove message', 'error');
                }

                loadFocusedClientHistory();
            });
        }

        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', function () {
                state.clients.forEach(function (item) {
                    state.selectedClientIds.add(String(item.id));
                });
                renderClientList();
            });
        }

        if (clearSelectionBtn) {
            clearSelectionBtn.addEventListener('click', function () {
                state.selectedClientIds = new Set();
                state.focusedClientId = null;
                state.lastClickedClientId = null;
                renderClientList();
                renderHistoryPlaceholder('Select a client from the left list to view message history.');
            });
        }

        var visibilityInputs = document.querySelectorAll('input[name="groupMessageVisibility"]');
        visibilityInputs.forEach(function (input) {
            input.addEventListener('change', syncTemporaryVisibility);
        });
        syncTemporaryVisibility();

        async function handleSend() {
            var message = String(messageText && messageText.value ? messageText.value : '').trim();
            if (!message) {
                showToastSafe('Message is required', 'error');
                return;
            }

            var scopeInput = document.querySelector('input[name="groupMessageScope"]:checked');
            var visibilityInput = document.querySelector('input[name="groupMessageVisibility"]:checked');
            var visibilityValue = visibilityInput ? visibilityInput.value : 'permanent';
            var selectedIds = Array.from(state.selectedClientIds);
            var targetMode = selectedIds.length ? 'selected' : 'all';

            var payload = {
                message: message,
                scope: scopeInput ? scopeInput.value : 'client_only',
                visibility: visibilityValue,
                target_mode: targetMode,
            };

            if (visibilityValue === 'temporary') {
                payload.temporary_duration = temporaryDuration ? temporaryDuration.value : '';
                if (!payload.temporary_duration) {
                    showToastSafe('Please select temporary duration', 'error');
                    return;
                }
            }

            if (targetMode === 'selected') {
                payload.client_ids = selectedIds;
            }

            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.dataset.originalHtml = sendBtn.innerHTML;
                sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
            }

            try {
                var result = await sendGroupMessage(payload);
                if (!result || !result.success) {
                    throw new Error((result && result.message) || 'Failed to send group message');
                }

                showToastSafe(result.message || 'Group message sent', 'success');
                if (messageText) messageText.value = '';
                if (messageCounter) messageCounter.textContent = '0 / 2000';
                if (state.focusedClientId) loadFocusedClientHistory();
                renderTargetSummary();
            } catch (error) {
                showToastSafe(error.message || 'Failed to send group message', 'error');
            } finally {
                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = sendBtn.dataset.originalHtml || sendBtn.innerHTML;
                }
            }
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', function () {
                handleSend();
            });
        }

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && drawer.classList.contains('open')) {
                closeDrawer();
            }
        });
    });
})();
