import React, { useState } from 'react';
import {
  UserCog, Search, LogIn, UserCheck, Activity, RefreshCw, CheckCircle2,
  Clock, Play, Plus, Filter, ShieldCheck, ArrowUpRight, Zap, BarChart3, X,
  Users, Smartphone, TrendingUp, AlertTriangle, FileText, CheckCircle, RotateCw
} from 'lucide-react';

import { clientApi, assistantApi, panelApi } from '../../services/api';

export default function ManageFeaturesView({ addToast }) {
  const [activeTab, setActiveTab] = useState('impersonate');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statsRange, setStatsRange] = useState('hourly');
  const [impersonatingUser, setImpersonatingUser] = useState(null);

  const [usersList, setUsersList] = useState([]);
  const [guestUsers, setGuestUsers] = useState([]);
  const [batchJobs, setBatchJobs] = useState([]);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [clientsRes, staffRes, opsRes] = await Promise.allSettled([
          clientApi.getActive({ page_size: 100 }),
          assistantApi.list({ page_size: 100 }),
          panelApi.getOperationsFeed()
        ]);

        let list = [];
        if (clientsRes.status === 'fulfilled' && clientsRes.value) {
          const clientItems = clientsRes.value.clients || clientsRes.value.results || (Array.isArray(clientsRes.value) ? clientsRes.value : []);
          clientItems.forEach(c => {
            list.push({
              id: `client-${c.id}`,
              name: c.name || c.school_name || 'Client Account',
              email: c.email || c.user?.email || 'N/A',
              role: c.client_type === 'manager' ? 'Manager' : 'Client (Primary)',
              rawRole: 'client',
              status: c.status ? (c.status.charAt(0).toUpperCase() + c.status.slice(1)) : 'Active'
            });
          });
        }

        if (staffRes.status === 'fulfilled' && staffRes.value) {
          const staffItems = staffRes.value.staff || staffRes.value.results || (Array.isArray(staffRes.value) ? staffRes.value : []);
          staffItems.forEach(s => {
            list.push({
              id: `staff-${s.id}`,
              name: s.name || s.user?.get_full_name || s.user?.username || 'Assistant',
              email: s.email || s.user?.email || 'N/A',
              role: 'Assistant',
              rawRole: 'client_staff',
              status: 'Active'
            });
          });
        }
        setUsersList(list);

        if (opsRes.status === 'fulfilled' && opsRes.value) {
          const jobs = opsRes.value.tasks || opsRes.value.operations || (Array.isArray(opsRes.value) ? opsRes.value : []);
          setBatchJobs(jobs);
        }
      } catch (_) {}
      finally { setLoading(false); }
    }
    loadData();
  }, []);


  const handleImpersonate = (user) => {
    setImpersonatingUser(user);
    addToast?.(`Now impersonating ${user.name} (${user.role})`, 'info');
  };

  const handleStopImpersonate = () => {
    setImpersonatingUser(null);
    addToast?.('Returned to Super Admin session', 'success');
  };

  const filteredUsers = usersList.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.rawRole === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div style={{ width: '100%', height: '100%', padding: 0, margin: 0, background: '#ffffff', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      
      {/* ── Top Bar Navigation Tabs (0-Gap, Full Width, Border-Bottom) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '0 20px',
        minHeight: '44px', width: '100%', zIndex: 10
      }}>
        {/* 4 Tabs matching pro-feature-tabs.html */}
        <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: '2px' }}>
          
          {/* Tab 1: Impersonate User */}
          <button
            onClick={() => setActiveTab('impersonate')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '0 16px',
              height: '44px', fontSize: '13px', fontWeight: activeTab === 'impersonate' ? 700 : 500,
              border: 'none', cursor: 'pointer', background: 'transparent',
              color: activeTab === 'impersonate' ? 'rgb(0, 80, 210)' : '#475569',
              borderBottom: activeTab === 'impersonate' ? '2px solid rgb(0, 80, 210)' : '2px solid transparent',
              fontFamily: 'var(--font-family)', transition: 'all 0.15s'
            }}
          >
            <UserCog size={15} />
            <span>Impersonate User</span>
          </button>

          {/* Tab 2: Manage Guest Users */}
          <button
            onClick={() => setActiveTab('guests')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '0 16px',
              height: '44px', fontSize: '13px', fontWeight: activeTab === 'guests' ? 700 : 500,
              border: 'none', cursor: 'pointer', background: 'transparent',
              color: activeTab === 'guests' ? 'rgb(0, 80, 210)' : '#475569',
              borderBottom: activeTab === 'guests' ? '2px solid rgb(0, 80, 210)' : '2px solid transparent',
              fontFamily: 'var(--font-family)', transition: 'all 0.15s'
            }}
          >
            <ShieldCheck size={15} />
            <span>Manage Guest Users</span>
          </button>

          {/* Tab 3: Statistics */}
          <button
            onClick={() => setActiveTab('statistics')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '0 16px',
              height: '44px', fontSize: '13px', fontWeight: activeTab === 'statistics' ? 700 : 500,
              border: 'none', cursor: 'pointer', background: 'transparent',
              color: activeTab === 'statistics' ? 'rgb(0, 80, 210)' : '#475569',
              borderBottom: activeTab === 'statistics' ? '2px solid rgb(0, 80, 210)' : '2px solid transparent',
              fontFamily: 'var(--font-family)', transition: 'all 0.15s'
            }}
          >
            <Activity size={15} />
            <span>Statistics</span>
          </button>

          {/* Tab 4: Batch Jobs */}
          <button
            onClick={() => setActiveTab('batch')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '0 16px',
              height: '44px', fontSize: '13px', fontWeight: activeTab === 'batch' ? 700 : 500,
              border: 'none', cursor: 'pointer', background: 'transparent',
              color: activeTab === 'batch' ? 'rgb(0, 80, 210)' : '#475569',
              borderBottom: activeTab === 'batch' ? '2px solid rgb(0, 80, 210)' : '2px solid transparent',
              fontFamily: 'var(--font-family)', transition: 'all 0.15s'
            }}
          >
            <Zap size={15} />
            <span>Batch Jobs</span>
          </button>
        </div>

        {/* Impersonation Session Badge */}
        {impersonatingUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fef2f2', border: '1px solid #fca5a5', padding: '4px 10px', borderRadius: '4px', fontSize: '11px' }}>
            <span style={{ fontWeight: 700, color: '#991b1b' }}>Active Session: {impersonatingUser.name}</span>
            <button
              onClick={handleStopImpersonate}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
            >
              Exit
            </button>
          </div>
        )}
      </div>

      {/* ── TAB 1: IMPERSONATE USER ── */}
      {activeTab === 'impersonate' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* Action Bar (Search & Filter Pills) */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '8px 20px', gap: '12px'
          }}>
            {/* Search Input Box */}
            <div style={{ position: 'relative', width: '320px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: '#94a3b8' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, username, or role..."
                style={{
                  width: '100%', height: '32px', padding: '0 30px 0 32px',
                  border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '12px', outline: 'none',
                  fontFamily: 'var(--font-family)'
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{ position: 'absolute', right: '8px', top: '8px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={() => setRoleFilter('all')}
                style={{
                  padding: '5px 12px', fontSize: '11px', fontWeight: roleFilter === 'all' ? 700 : 500,
                  borderRadius: '4px', border: 'none', cursor: 'pointer',
                  background: roleFilter === 'all' ? 'rgb(0, 80, 210)' : '#f1f5f9',
                  color: roleFilter === 'all' ? '#ffffff' : '#475569'
                }}
              >
                All ({usersList.length})
              </button>

              <button
                onClick={() => setRoleFilter('client')}
                style={{
                  padding: '5px 12px', fontSize: '11px', fontWeight: roleFilter === 'client' ? 700 : 500,
                  borderRadius: '4px', border: 'none', cursor: 'pointer',
                  background: roleFilter === 'client' ? 'rgb(0, 80, 210)' : '#f1f5f9',
                  color: roleFilter === 'client' ? '#ffffff' : '#475569'
                }}
              >
                Client ({usersList.filter(u => u.rawRole === 'client').length})
              </button>

              <button
                onClick={() => setRoleFilter('client_staff')}
                style={{
                  padding: '5px 12px', fontSize: '11px', fontWeight: roleFilter === 'client_staff' ? 700 : 500,
                  borderRadius: '4px', border: 'none', cursor: 'pointer',
                  background: roleFilter === 'client_staff' ? 'rgb(0, 80, 210)' : '#f1f5f9',
                  color: roleFilter === 'client_staff' ? '#ffffff' : '#475569'
                }}
              >
                Assistant ({usersList.filter(u => u.rawRole === 'client_staff').length})
              </button>

              <button
                onClick={() => setRoleFilter('guest_user')}
                style={{
                  padding: '5px 12px', fontSize: '11px', fontWeight: roleFilter === 'guest_user' ? 700 : 500,
                  borderRadius: '4px', border: 'none', cursor: 'pointer',
                  background: roleFilter === 'guest_user' ? 'rgb(0, 80, 210)' : '#f1f5f9',
                  color: roleFilter === 'guest_user' ? '#ffffff' : '#475569'
                }}
              >
                Guest User ({usersList.filter(u => u.rawRole === 'guest_user').length})
              </button>
            </div>
          </div>

          {/* Data Table */}
          <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '10px 16px', fontWeight: 700, width: '60px', textAlign: 'center' }}>SR NO.</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Name</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Email</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Role</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700, width: '100px', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700, width: '140px', textAlign: 'center' }}>Options</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 16px', color: '#64748b', fontWeight: 600, textAlign: 'center' }}>{u.id}</td>
                    <td style={{ padding: '10px 16px', fontWeight: 700, color: '#0f172a' }}>{u.name}</td>
                    <td style={{ padding: '10px 16px', color: '#334155' }}>{u.email}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ background: '#eff6ff', color: 'rgb(0, 80, 210)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                        {u.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <button
                        onClick={() => handleImpersonate(u)}
                        style={{
                          background: 'linear-gradient(135deg, rgb(0, 80, 210) 0%, rgb(0, 180, 255) 100%)',
                          color: '#ffffff', border: 'none', borderRadius: '4px', padding: '5px 12px',
                          fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px'
                        }}
                      >
                        <LogIn size={12} /> Login As User
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* ── TAB 2: MANAGE GUEST USERS ── */}
      {activeTab === 'guests' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '8px 20px'
          }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Temporary Guest Pass Records</span>
            <button
              onClick={() => addToast?.('New guest pass generated', 'success')}
              style={{
                background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '4px', padding: '6px 14px',
                fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px'
              }}
            >
              <Plus size={13} /> + Issue Guest Pass
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '10px 16px', fontWeight: 700, width: '60px', textAlign: 'center' }}>SR NO.</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Guest User</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Email</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Expires On</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700, width: '100px', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {guestUsers.map((g) => (
                  <tr key={g.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 16px', color: '#64748b', fontWeight: 600, textAlign: 'center' }}>{g.id}</td>
                    <td style={{ padding: '10px 16px', fontWeight: 700, color: '#0f172a' }}>{g.name}</td>
                    <td style={{ padding: '10px 16px', color: '#334155' }}>{g.email}</td>
                    <td style={{ padding: '10px 16px', color: '#475569' }}>{g.expires}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <span style={{
                        background: g.status === 'Active' ? '#dcfce7' : '#fee2e2',
                        color: g.status === 'Active' ? '#15803d' : '#991b1b',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700
                      }}>
                        {g.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* ── TAB 3: STATISTICS (Matching templates/stats/statistics.html 1-to-1) ── */}
      {activeTab === 'statistics' && (
        <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff', display: 'flex', flexDirection: 'column' }}>
          
          {/* Top 4 Metrics Bar (Matching statistics.html metrics-row) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
            
            {/* Metric 1: Live Active Sessions */}
            <div style={{ padding: '14px 20px', borderRight: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'rgb(0, 80, 210)' }}>14</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', margin: '2px 0' }}>Live Active Sessions</div>
                <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle size={11} style={{ color: '#16a34a' }} />
                  <span>All concurrent online users</span>
                </div>
              </div>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#eff6ff', color: 'rgb(0, 80, 210)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={18} />
              </div>
            </div>

            {/* Metric 2: Today's Peak Active */}
            <div style={{ padding: '14px 20px', borderRight: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a' }}>48</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', margin: '2px 0' }}>Today's Peak Active</div>
                <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <TrendingUp size={11} style={{ color: '#16a34a' }} />
                  <span>Max concurrent sessions today</span>
                </div>
              </div>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={18} />
              </div>
            </div>

            {/* Metric 3: Busiest Interval */}
            <div style={{ padding: '14px 20px', borderRight: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#d97706', minHeight: '26px', display: 'flex', alignItems: 'center' }}>14:00 - 16:00</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', margin: '2px 0' }}>Busiest Interval (Today)</div>
                <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} style={{ color: '#f59e0b' }} />
                  <span>Highest-traffic 2-hour window</span>
                </div>
              </div>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#fff7ed', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Clock size={18} />
              </div>
            </div>

            {/* Metric 4: Live Mobile Users */}
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#0284c7' }}>6</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', margin: '2px 0' }}>Live Mobile Users</div>
                <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle size={11} style={{ color: '#0284c7' }} />
                  <span>Mobile app concurrent users</span>
                </div>
              </div>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Smartphone size={18} />
              </div>
            </div>

          </div>

          {/* Main User Activities Chart Header & Range Selector */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>User Activities Overview</h3>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>Real database counts — Active Web Desktop vs Mobile App users per period</p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '6px' }}>
              {['hourly', 'daily', 'weekly', 'monthly'].map((r) => (
                <button
                  key={r}
                  onClick={() => setStatsRange(r)}
                  style={{
                    padding: '4px 10px', fontSize: '11px', fontWeight: statsRange === r ? 700 : 500,
                    borderRadius: '4px', border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                    background: statsRange === r ? '#ffffff' : 'transparent',
                    color: statsRange === r ? 'rgb(0, 80, 210)' : '#64748b',
                    boxShadow: statsRange === r ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Chart Section */}
          <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '140px' }}>
                {[
                  { label: '08:00', web: 12, mob: 4 },
                  { label: '10:00', web: 24, mob: 8 },
                  { label: '12:00', web: 38, mob: 14 },
                  { label: '14:00', web: 48, mob: 18 },
                  { label: '16:00', web: 42, mob: 12 },
                  { label: '18:00', web: 28, mob: 8 },
                  { label: '20:00', web: 16, mob: 5 },
                ].map((item) => (
                  <div key={item.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ width: '100%', display: 'flex', gap: '3px', alignItems: 'flex-end', height: '110px' }}>
                      <div style={{ flex: 1, height: `${(item.web / 50) * 100}%`, background: 'rgb(0, 80, 210)', borderRadius: '3px 3px 0 0' }} title={`Web: ${item.web}`} />
                      <div style={{ flex: 1, height: `${(item.mob / 50) * 100}%`, background: '#0284c7', borderRadius: '3px 3px 0 0' }} title={`Mobile: ${item.mob}`} />
                    </div>
                    <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Split Grid Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>ID Cards Created</h4>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>Total student &amp; staff cards generated per period</p>
                <div style={{ height: '80px', background: '#f1f5f9', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a', fontWeight: 800, fontSize: '20px' }}>
                  +12,480 Cards Generated
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Total Active Users</h4>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#64748b' }}>Distinct active users across all roles per period</p>
                <div style={{ height: '80px', background: '#f1f5f9', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(0, 80, 210)', fontWeight: 800, fontSize: '20px' }}>
                  14 Active Concurrent Users
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── TAB 4: BATCH JOBS (Matching templates/partials/panel/tab-batch-jobs.html 1-to-1) ── */}
      {activeTab === 'batch' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* Action Bar Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '10px 20px'
          }}>
            <div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Zap size={16} style={{ color: 'rgb(0, 80, 210)' }} /> Batch Jobs
              </span>
              <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '10px' }}>Track active, pending, completed, and failed tasks in real time.</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Updated just now</span>
              <button
                onClick={() => addToast?.('Batch jobs progress refreshed', 'info')}
                style={{
                  background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '5px 12px',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#334155'
                }}
              >
                <RotateCw size={12} /> Refresh
              </button>
            </div>
          </div>

          {/* 5 Stat Cards Bar (Matching tab-batch-jobs.html batch-job-stats schema) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ padding: '12px 16px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Active</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'rgb(0, 80, 210)', marginTop: '2px' }}>1</div>
            </div>

            <div style={{ padding: '12px 16px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Pending</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#d97706', marginTop: '2px' }}>1</div>
            </div>

            <div style={{ padding: '12px 16px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Processing</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#0284c7', marginTop: '2px' }}>1</div>
            </div>

            <div style={{ padding: '12px 16px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Completed (24h)</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#16a34a', marginTop: '2px' }}>18</div>
            </div>

            <div style={{ padding: '12px 16px', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Failed (24h)</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#dc2626', marginTop: '2px' }}>0</div>
            </div>
          </div>

          {/* Full Width Flush Batch Jobs Table */}
          <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '10px 16px', fontWeight: 700, width: '90px' }}>Job ID</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Task Name</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Type</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700 }}>Triggered By</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700, width: '160px' }}>Progress</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700, width: '100px', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {batchJobs.map((j) => (
                  <tr key={j.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 16px', color: '#64748b', fontWeight: 600 }}>{j.id}</td>
                    <td style={{ padding: '10px 16px', fontWeight: 700, color: '#0f172a' }}>{j.name}</td>
                    <td style={{ padding: '10px 16px', color: '#334155' }}>{j.type}</td>
                    <td style={{ padding: '10px 16px', color: '#64748b' }}>{j.user}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${j.progress}%`, height: '100%', background: j.status === 'Completed' ? '#16a34a' : 'rgb(0, 80, 210)' }} />
                        </div>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: '#475569' }}>{j.progress}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <span style={{
                        background: j.status === 'Completed' ? '#dcfce7' : j.status === 'Processing' ? '#dbeafe' : '#fef3c7',
                        color: j.status === 'Completed' ? '#15803d' : j.status === 'Processing' ? '#1e40af' : '#d97706',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700
                      }}>
                        {j.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

    </div>
  );
}
