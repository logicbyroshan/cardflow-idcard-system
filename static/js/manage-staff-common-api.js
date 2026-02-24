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
        catch (_) { return { success: false, message: 'Network error. Please try again.' }; }
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
        catch (_) { return { success: false, message: 'Network error. Please try again.' }; }
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
        catch (_) { return { success: false, message: 'Network error. Please try again.' }; }
    },

    /**
     * Toggle a staff member's active/inactive status.
     * @param {Object} cfg - Page config object
     * @param {string|number} id - Staff ID
     * @returns {Object} API response
     */
    toggleStaffStatus: async function (cfg, id) {
        try { return await ApiClient.post(cfg.api.toggleUrl(id)); }
        catch (_) { return { success: false, message: 'Network error. Please try again.' }; }
    },

    /**
     * Fetch assignment items (clients or groups) for multi-select.
     * @param {Object} cfg - Page config object
     * @returns {Array} List of items
     */
    fetchAssignmentItems: async function (cfg) {
        try {
            var data = await ApiClient.get(cfg.assignment.apiUrl);
            if (data.success) return data[cfg.assignment.responseKey] || [];
        } catch (_) { /* swallow */ }
        return [];
    }
};

})();
