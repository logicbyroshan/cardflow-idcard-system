(function (window, document) {
  'use strict';

  var OfficeLeads = {
    state: {
      items: [],
      loaded: false,
    },

    ui: {
      list: document.getElementById('officeLeadsList'),
      modal: document.getElementById('officeLeadModal'),
      modalBackdrop: document.getElementById('officeLeadModal-backdrop'),
      form: document.getElementById('officeLeadForm'),
      editId: document.getElementById('officeLeadEditId'),
      name: document.getElementById('officeLeadName'),
      contact: document.getElementById('officeLeadContact'),
      location: document.getElementById('officeLeadLocation'),
      description: document.getElementById('officeLeadDescription'),
      titleText: document.getElementById('officeLeadModal-title-text'),
    },

    init: function () {
      // Logic for leads can be loaded on demand when the tab is clicked
    },

    load: async function () {
      var endpoints = window.OfficeWorkConfig.endpoints;
      if (!endpoints.leadsList) return;
      try {
        var res = await window.ApiClient.get(endpoints.leadsList);
        if (res.success) {
          this.state.items = res.data || [];
          this.state.loaded = true;
          this.render();
        }
      } catch (e) {
        if (window.OfficeWork) window.OfficeWork.notify('Failed to load leads', 'error');
      }
    },

    render: function () {
      if (!this.ui.list) return;
      var self = this;
      this.ui.list.innerHTML = this.state.items.map(function (l) {
        return `
          <tr>
            <td><strong>${self.escapeHtml(l.customer_name)}</strong></td>
            <td>${self.escapeHtml(l.contact || '-')}</td>
            <td>${self.escapeHtml(l.location || '-')}</td>
            <td>${self.escapeHtml(l.description || '-')}</td>
            <td class="text-center">
              <button class="btn btn-sm btn-neutral" onclick="window.OfficeLeads.edit(${l.id})">Edit</button>
            </td>
          </tr>`;
      }).join('');
    },

    edit: function (id) {
      var lead = this.state.items.find(l => Number(l.id) === Number(id));
      if (lead) {
        this.ui.titleText.textContent = 'Edit Lead';
        this.ui.editId.value = lead.id;
        this.ui.name.value = lead.customer_name;
        this.ui.contact.value = lead.contact;
        this.ui.location.value = lead.location;
        this.ui.description.value = lead.description;
        this.ui.modal.hidden = false;
        this.ui.modalBackdrop.hidden = false;
      }
    },

    delete: async function (id) {
      if (!confirm('Are you sure you want to delete this lead?')) return;
      try {
        var res = await window.ApiClient.post(window.OfficeWorkConfig.endpoints.leadDeleteBase + id + '/delete/');
        if (res.success) {
          if (window.OfficeWork) window.OfficeWork.notify('Lead deleted', 'success');
          this.load();
        }
      } catch (e) {}
    },

    submit: async function (e) {
      e.preventDefault();
      var id = this.ui.editId.value;
      var payload = {
        customer_name: this.ui.name.value,
        contact: this.ui.contact.value,
        location: this.ui.location.value,
        description: this.ui.description.value,
      };
      var url = id ? (window.OfficeWorkConfig.endpoints.leadUpdateBase + id + '/update/') : window.OfficeWorkConfig.endpoints.leadCreate;
      try {
        var res = await window.ApiClient.post(url, payload);
        if (res.success) {
          if (window.OfficeWork) window.OfficeWork.notify(id ? 'Lead updated' : 'Lead created', 'success');
          this.closeModal();
          this.load();
        }
      } catch (err) {}
    },

    closeModal: function () {
      this.ui.modal.hidden = true;
      this.ui.modalBackdrop.hidden = true;
      this.ui.form.reset();
    },

    // Templates & Search placeholders
    loadTemplates: function() {
      var self = this;
      var url = window.OfficeWorkConfig.endpoints.leadTemplatesList;
      if (!url) return;
      window.ApiClient.get(url).then(res => {
        if (res.success) {
          self.state.templates = res.templates || { whatsapp: '', email: '' };
          self.render(); // Refresh links
        }
      });
    },

    saveTemplate: function() {
      var self = this;
      var txt = document.getElementById('officeTemplateText');
      if (!txt) return;
      var type = this.state.activeTemplateType || 'whatsapp';
      window.ApiClient.post(window.OfficeWorkConfig.endpoints.leadTemplateSave, {
        template_type: type,
        content: txt.value
      }).then(res => {
        if (res.success) {
          self.state.templates[type] = txt.value;
          if (window.OfficeWork) window.OfficeWork.notify('Template saved', 'success');
          self.render();
        }
      });
    },

    openTemplates: function() { 
      var m = document.getElementById('officeTemplateModal'); 
      if(m) {
        m.hidden = false;
        this.switchTemplateTab('whatsapp');
      }
    },

    switchTemplateTab: function(type) {
      this.state.activeTemplateType = type;
      document.querySelectorAll('.office-template-tab-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.templateType === type);
      });
      var txt = document.getElementById('officeTemplateText');
      if (txt) txt.value = (this.state.templates && this.state.templates[type]) || '';
    },
    openSearch: function() { var m = document.getElementById('officeSearchClientsModal'); if(m) m.hidden = false; },
    openXlsx: function() { var m = document.getElementById('officeXlsxUploadModal'); if(m) m.hidden = false; },

    escapeHtml: function (val) {
      return String(val || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  };

  // Bind UI events
  if (OfficeLeads.ui.form) OfficeLeads.ui.form.addEventListener('submit', e => OfficeLeads.submit(e));
  
  var addBtn = document.getElementById('officeCreateLeadBtn');
  if (addBtn) addBtn.addEventListener('click', () => {
    OfficeLeads.ui.titleText.textContent = 'Add New Lead';
    OfficeLeads.ui.editId.value = '';
    OfficeLeads.ui.form.reset();
    OfficeLeads.ui.modal.hidden = false;
    OfficeLeads.ui.modalBackdrop.hidden = false;
  });

  // Global hooks for HTML onclicks
  window.OfficeLeads = OfficeLeads;
  window.OfficeWorkEditLead = id => OfficeLeads.edit(id);
  window.OfficeWorkDeleteLead = id => OfficeLeads.delete(id);

  // Extra buttons
  ['officeLeadTemplateBtn', 'officeLeadSearchNewBtn', 'officeXlsxUploadBtn', 'officeSaveTemplateBtn'].forEach(id => {
    var btn = document.getElementById(id);
    if(btn) btn.addEventListener('click', () => {
        if(id.includes('TemplateBtn')) OfficeLeads.openTemplates();
        if(id.includes('Search')) OfficeLeads.openSearch();
        if(id.includes('Xlsx')) OfficeLeads.openXlsx();
        if(id.includes('SaveTemplate')) OfficeLeads.saveTemplate();
    });
  });

  document.querySelectorAll('.office-template-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => OfficeLeads.switchTemplateTab(btn.dataset.templateType));
  });

  OfficeLeads.loadTemplates();

})(window, document);

