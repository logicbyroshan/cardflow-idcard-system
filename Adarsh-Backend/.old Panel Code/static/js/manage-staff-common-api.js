/**
 * Staff Management API Module
 * Pure API call functions used by manage-staff-common-ui.js
 * Must load BEFORE manage-staff-common-ui.js
 *
 * Provides window._StaffCommonAPI namespace.
 */
(function () {
'use strict';

window._StaffCommonAPI = {

    /**
     * Fetch a single staff member's details.
     * @param {Object} cfg - Page config object
     * @param {string|number} id - Staff ID
     * @returns {Object|null} Staff data or null on failure
     */
    fetchStaffDetails: async function (cfg, id) {
        try {
            var data = await ApiClient.get(cfg.api.fetchUrl(id));
            if (data.success) return data[cfg.api.fetchResponseKey];
            showToast(data[cfg.api.errorKey] || 'Failed to fetch staff details', 'error');
            return null;
        } catch (_) { showToast('Network error. Please try again.', 'error'); return null; }
    },

    /**
     * Create a new staff member.
     * @param {Object} cfg - Page config object
     * @param {Object} formData - Staff form payload
     * @returns {Object} API response
     */
    createStaff: async function (cfg, formData) {
        try { return await ApiClient[cfg.api.createMethod](cfg.api.createUrl, formData); }
        catch (err) {
            // 4xx errors: ApiClient throws with err.data containing the JSON body.
            // Extract the server's error message instead of showing a generic toast.
            var serverMsg = (err.data && (err.data.error || err.data.message))
                || err.message || 'Network error. Please try again.';
            return { success: false, error: serverMsg, message: serverMsg };
        }
    },

    /**
     * Update an existing staff member.
     * @param {Object} cfg - Page config object
     * @param {string|number} id - Staff ID
     * @param {Object} formData - Staff form payload
     * @returns {Object} API response
     */
    updateStaff: async function (cfg, id, formData) {
        var ep = cfg.api.updateEndpoint(id);
        try { return await ApiClient[ep.method](ep.url, formData); }
        catch (err) {
            var serverMsg = (err.data && (err.data.error || err.data.message))
                || err.message || 'Network error. Please try again.';
            return { success: false, error: serverMsg, message: serverMsg };
        }
    },

    /**
     * Delete a staff member.
     * @param {Object} cfg - Page config object
     * @param {string|number} id - Staff ID
     * @returns {Object} API response
     */
    deleteStaffApi: async function (cfg, id) {
        var ep = cfg.api.deleteEndpoint(id);
        try { return await ApiClient[ep.method](ep.url); }
        catch (err) {
            var serverMsg = (err.data && (err.data.error || err.data.message))
                || err.message || 'Network error. Please try again.';
            return { success: false, error: serverMsg, message: serverMsg };
        }
    },

    /**
     * Toggle a staff member's active/inactive status.
     * @param {Object} cfg - Page config object
     * @param {string|number} id - Staff ID
     * @returns {Object} API response
     */
    toggleStaffStatus: async function (cfg, id) {
        try { return await ApiClient.post(cfg.api.toggleUrl(id)); }
        catch (err) {
            var serverMsg = (err.data && (err.data.error || err.data.message))
                || err.message || 'Network error. Please try again.';
            return { success: false, error: serverMsg, message: serverMsg };
        }
    },

    /**
     * Fetch assignment items (clients or groups) for multi-select.
     * @param {Object} cfg - Page config object
     * @returns {Array} List of items
     */
    fetchAssignmentItems: async function (cfg) {
        try {
            var assignmentUrl = cfg.assignment && cfg.assignment.apiUrl;
            if (typeof assignmentUrl === 'function') {
                assignmentUrl = assignmentUrl();
            }
            if (!assignmentUrl) return [];

            var data = await ApiClient.get(assignmentUrl);
            if (!data) return [];
            if (data.success) {
                // Support two response shapes:
                // 1) { success: true, groups: [...] }
                // 2) { success: true, data: { groups: [...] } }
                var top = data[cfg.assignment.responseKey];
                if (Array.isArray(top)) return top;
                if (data.data && Array.isArray(data.data[cfg.assignment.responseKey])) return data.data[cfg.assignment.responseKey];
                // Generic fallbacks
                if (Array.isArray(data.groups)) return data.groups;
                if (data.data && Array.isArray(data.data.groups)) return data.data.groups;
                return [];
            }
        } catch (_) { /* swallow */ }
        return [];
    }
};

})();
