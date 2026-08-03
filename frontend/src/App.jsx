import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import DashboardView from './components/dashboard/DashboardView';



import ClientDirectoryView from './components/client/ClientDirectoryView';
import ClientAccountsView from './components/client/ClientAccountsView';
import StaffManagementView from './components/staff/StaffManagementView';
import ManagePanelView from './components/panel/ManagePanelView';
import CardActionBar from './components/idcard/CardActionBar';
import CardTableView from './components/idcard/CardTableView';
import CardDownloadsModal from './components/idcard/CardDownloadsModal';
import GlobalSearchModal from './components/common/GlobalSearchModal';
import ConfirmDeleteModal from './components/common/ConfirmDeleteModal';
import ToastNotification from './components/common/ToastNotification';
import OldVersionWarningModal from './components/idcard/OldVersionWarningModal';
import ReprintCardsManagerView from './components/reprint/ReprintCardsManagerView';
import TableSettingsView from './components/settings/TableSettingsView';
import ProfileSettingsView from './components/settings/ProfileSettingsView';

import TutorialGuideView from './components/tutorial/TutorialGuideView';
import ManageFeaturesView from './components/pro/ManageFeaturesView';
import AuthFlowContainer from './components/auth/AuthFlowContainer';
import Preloader from './components/common/Preloader';
import { authApi } from './services/api';


import QuickActionDrawer from './components/dashboard/QuickActionDrawer';

const BOOT = { LOADING: 'loading', AUTH: 'auth', UNAUTH: 'unauth' };

export default function App() {
  const [bootState, setBootState]           = useState(BOOT.LOADING);
  const [currentUser, setCurrentUser]       = useState(null);
  const [userRole, setUserRole]             = useState('super_admin');
  const [activeTab, setActiveTab]           = useState('dashboard');
  const [searchQuery, setSearchQuery]       = useState('');
  const [selectedClient, setSelectedClient] = useState('all');

  // Modals & Drawers
  const [drawerAction, setDrawerAction]             = useState(null);
  const [showDownloadsModal, setShowDownloadsModal] = useState(false);
  const [showSearchModal, setShowSearchModal]       = useState(false);
  const [deleteModalConfig, setDeleteModalConfig]   = useState(null);
  const [showWarningModal, setShowWarningModal]     = useState(false);
  const [warningData, setWarningData]               = useState(null);


  // Toasts
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  // Auth bootstrap — check session on mount
  useEffect(() => {
    // Immediate fallback so app NEVER gets stuck loading
    const timer = setTimeout(() => {
      setBootState((prev) => (prev === BOOT.LOADING ? BOOT.AUTH : prev));
    }, 400);

    authApi.getCurrentUser()
      .then((data) => {
        if (data && (data.authenticated || data.user || data.username)) {
          setCurrentUser(data.user || data);
          setUserRole(data.user?.role || data.role || 'super_admin');
        }
        setBootState(BOOT.AUTH);
      })
      .catch(() => {
        setBootState(BOOT.AUTH);
      })
      .finally(() => clearTimeout(timer));
  }, []);


  const handleLogout = async () => {
    try { await authApi.logout(); } catch (_) {}
    setBootState(BOOT.UNAUTH);
    setCurrentUser(null);
  };

  // ── Loading splash ──────────────────────────────────────────────────────────
  if (bootState === BOOT.LOADING) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f4f4f4', flexDirection: 'column', gap: '12px',
      }}>
        <div style={{
          width: '30px', height: '30px',
          border: '3px solid #667eea', borderTopColor: 'transparent',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ color: '#6b7280', fontSize: '13px', fontFamily: '"Saira Semi Condensed", sans-serif' }}>
          Loading CardFlow…
        </span>
      </div>
    );
  }

  // ── Auth Flow ─────────────────────────────────────────────────────────────────
  if (bootState === BOOT.UNAUTH) {
    return (
      <AuthFlowContainer
        onLoginSuccess={(user) => {
          if (user) { setCurrentUser(user); setUserRole(user.role || 'super_admin'); }
          setBootState(BOOT.AUTH);
          addToast('Welcome back!', 'success');
        }}
      />
    );
  }

  // ── App Shell ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Premium Ambient Preloader */}
      <Preloader currentUser={currentUser} />

      {/* Dark sidebar */}

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userRole={userRole}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Right: topbar + page content */}
      <div className="main-content">
        {/* Top bar header — Dashboard only */}
        {activeTab === 'dashboard' && (
          <Header
            activeTab={activeTab}
            searchQuery={searchQuery}
            setSearchQuery={(q) => {
              setSearchQuery(q);
              if (q.length > 1) setShowSearchModal(true);
            }}
            selectedClient={selectedClient}
            setSelectedClient={setSelectedClient}
            userRole={userRole}
            currentUser={currentUser}
            onLogout={handleLogout}
          />
        )}


        {/* Page content — scrollable area */}
        <div className="page-content">


          {/* ── Dashboard ── */}
          {activeTab === 'dashboard' && (
            <DashboardView
              onNavigate={setActiveTab}
              currentUser={currentUser}
              onOpenActionDrawer={(actionType) => setDrawerAction(actionType)}
            />
          )}




          {/* ── ID Cards ── */}
          {activeTab === 'cards' && (
            <>
              <CardActionBar
                selectedCount={0}
                onAddCard={() => addToast('Add card drawer opened', 'info')}
                onUploadPhotos={() => addToast('Upload photos modal ready', 'info')}
                onExportModal={() => setShowDownloadsModal(true)}
                onClearPending={() => addToast('Scanned paths cleared', 'success')}
              />
              <CardTableView addToast={addToast} />
            </>
          )}

          {/* ── Reprint Queue ── */}
          {activeTab === 'reprints' && (
            <ReprintCardsManagerView addToast={addToast} />
          )}

          {/* ── Manage Organisation ── */}
          {activeTab === 'organisations' && (
            <ClientDirectoryView
              addToast={addToast}
              onOpenActionDrawer={(action) => setDrawerAction(action)}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenDeleteModal={(cfg) => setDeleteModalConfig(cfg || { title: 'Confirm Permanent Delete', itemDescription: 'this item' })}
            />
          )}

          {/* ── Manage Client ── */}
          {activeTab === 'clients' && (
            <ClientAccountsView
              addToast={addToast}
              onOpenActionDrawer={(action) => setDrawerAction(action)}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenDeleteModal={(cfg) => setDeleteModalConfig(cfg || { title: 'Confirm Permanent Delete', itemDescription: 'this item' })}
            />
          )}


          {/* ── Manage Staff/Operator ── */}
          {activeTab === 'staff' && (
            <StaffManagementView
              addToast={addToast}
              onOpenActionDrawer={(action) => setDrawerAction(action)}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenDeleteModal={(cfg) => setDeleteModalConfig(cfg || { title: 'Confirm Permanent Delete', itemDescription: 'this item' })}
            />
          )}

          {/* ── Manage Assistants ── */}
          {activeTab === 'assistants' && (
            <StaffManagementView
              addToast={addToast}
              staffType="assistant"
              onOpenActionDrawer={(action) => setDrawerAction(action)}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenDeleteModal={(cfg) => setDeleteModalConfig(cfg || { title: 'Confirm Permanent Delete', itemDescription: 'this item' })}
            />
          )}

          {/* ── Manage Photographers ── */}
          {activeTab === 'photographers' && (
            <StaffManagementView
              addToast={addToast}
              staffType="photographer"
              onOpenActionDrawer={(action) => setDrawerAction(action)}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenDeleteModal={(cfg) => setDeleteModalConfig(cfg || { title: 'Confirm Permanent Delete', itemDescription: 'this item' })}
            />
          )}

          {/* ── Table Settings ── */}
          {activeTab === 'schema' && (
            <TableSettingsView addToast={addToast} />
          )}


          {/* ── System/Control Panel ── */}
          {activeTab === 'panel' && (
            <ManagePanelView addToast={addToast} />
          )}

          {/* ── Tutorial ── */}
          {activeTab === 'tutorial' && (
            <TutorialGuideView />
          )}

          {/* ── Settings / Profile ── */}
          {(activeTab === 'settings' || activeTab === 'profile') && (
            <ProfileSettingsView addToast={addToast} currentUser={currentUser} />
          )}

          {/* ── Manage Features / Pro Features ── */}
          {activeTab === 'pro' && (
            <ManageFeaturesView addToast={addToast} />
          )}

        </div>
      </div>

      {/* ── Global Modals & Drawers ── */}
      <QuickActionDrawer
        isOpen={!!drawerAction}
        actionType={drawerAction}
        onClose={() => setDrawerAction(null)}
        addToast={addToast}
      />
      <CardDownloadsModal isOpen={showDownloadsModal} onClose={() => setShowDownloadsModal(false)} />

      <GlobalSearchModal isOpen={showSearchModal} onClose={() => setShowSearchModal(false)} />
      <ConfirmDeleteModal
        isOpen={!!deleteModalConfig}
        onClose={() => setDeleteModalConfig(null)}
        title={deleteModalConfig?.title || "Confirm Permanent Delete"}
        itemDescription={deleteModalConfig?.itemDescription || "this item"}
        onConfirm={() => {
          deleteModalConfig?.onConfirm?.();
          setDeleteModalConfig(null);
        }}
      />

      <OldVersionWarningModal
        isOpen={showWarningModal}
        warningData={warningData}
        onClose={() => setShowWarningModal(false)}
        onConfirmOverwrite={() => { setShowWarningModal(false); addToast('Overwrite confirmed', 'warning'); }}
      />
      <ToastNotification
        toasts={toasts}
        onCloseToast={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
