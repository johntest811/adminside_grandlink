"use client";
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/app/Clients/Supabase/SupabaseClients';
import { logActivity } from '@/app/lib/activity';

type AdminUser = {
  id: string;
  username: string;
  password: string;
  position?: string | null;
  full_name?: string | null;
  employee_number?: string | null;
  role: 'superadmin' | 'admin' | 'manager' | 'employee';
  created_at: string;
  last_login?: string;
  is_active: boolean;
};

const DEFAULT_POSITIONS = [
  'Sales Manager',
  'Site Manager',
  'Media Handler',
  'Supervisor',
  'Employee',
  'Manager',
  'Admin',
  'Superadmin',
];

export default function AdminsPage() {
  const router = useRouter();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);

  // RBAC (page + capability permissions)
  const [allowedPaths, setAllowedPaths] = useState<string[] | null>(null);

  // Positions list (for dropdowns)
  const [positionsList, setPositionsList] = useState<string[]>(DEFAULT_POSITIONS);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedAdminForPassword, setSelectedAdminForPassword] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newAdmin, setNewAdmin] = useState({
    username: '',
    position: 'Employee',
    role: 'employee' as AdminUser['role'],
    password: ''
  });
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);

  useEffect(() => {
    loadCurrentAdmin();
  }, []);

  useEffect(() => {
    const loadPositions = async () => {
      try {
        const res = await fetch('/api/rbac/positions');
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        const names: string[] = Array.isArray(json?.positions)
          ? json.positions.map((p: any) => String(p?.name || '')).filter(Boolean)
          : [];
        if (names.length) setPositionsList(names);
      } catch {
        // ignore - fallback list stays
      }
    };

    loadPositions();
  }, []);

  const ensurePositionOptions = (currentValue?: string | null) => {
    const v = String(currentValue || '').trim();
    if (!v) return positionsList;
    return positionsList.includes(v) ? positionsList : [v, ...positionsList];
  };

  const norm = (v?: string) => String(v || '').toLowerCase().replace(/[\s_-]/g, '');
  const isSuperadmin = useMemo(() => {
    const roleNorm = norm(currentAdmin?.role);
    const posNorm = norm(currentAdmin?.position);
    return roleNorm === 'superadmin' || posNorm === 'superadmin';
  }, [currentAdmin]);

  const canViewPage = useMemo(() => {
    if (isSuperadmin) return true;
    return Array.isArray(allowedPaths) && allowedPaths.includes('/dashboard/admins');
  }, [allowedPaths, isSuperadmin]);

  const canEditAdmins = useMemo(() => {
    if (isSuperadmin) return true;
    return Array.isArray(allowedPaths) && allowedPaths.includes('/dashboard/admins#edit');
  }, [allowedPaths, isSuperadmin]);

  const canChangeAdminPasswords = useMemo(() => {
    if (isSuperadmin) return true;
    return Array.isArray(allowedPaths) && allowedPaths.includes('/dashboard/admins#password');
  }, [allowedPaths, isSuperadmin]);

  useEffect(() => {
    // If we have a session and RBAC has loaded, enforce view permission.
    if (!currentAdmin) return;
    if (allowedPaths === null && !isSuperadmin) return;
    if (!canViewPage) {
      router.replace('/dashboard/unauthorized');
    }
  }, [allowedPaths, canViewPage, currentAdmin, isSuperadmin, router]);

  useEffect(() => {
    const loadAllowedPaths = async () => {
      try {
        if (!currentAdmin?.id) return;
        const res = await fetch(`/api/rbac/allowed-pages?adminId=${encodeURIComponent(currentAdmin.id)}`);
        if (!res.ok) {
          setAllowedPaths(['/dashboard']);
          return;
        }
        const json = await res.json().catch(() => ({}));
        setAllowedPaths(Array.isArray(json?.allowedPaths) ? json.allowedPaths : ['/dashboard']);
      } catch {
        setAllowedPaths(['/dashboard']);
      }
    };

    // Superadmins don't need RBAC lookup for access decisions.
    if (isSuperadmin) {
      setAllowedPaths(['*']);
      return;
    }

    loadAllowedPaths();
  }, [currentAdmin?.id, isSuperadmin]);

  const loadCurrentAdmin = () => {
    const sessionData = localStorage.getItem('adminSession');
    if (sessionData) {
      setCurrentAdmin(JSON.parse(sessionData));
    }
  };

  const loadAdmins = useCallback(async () => {
    try {
      setLoading(true);

      // Require view permission (or superadmin)
      if (!canViewPage) {
        setAdmins([]);
        return;
      }

      const { data, error } = await supabase
        .from('admins')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setAdmins(data || []);
    } catch (error) {
      console.error('Error loading admins:', error);
    } finally {
      setLoading(false);
    }
  }, [canViewPage]);

  useEffect(() => {
    // Once permissions are known, load the list
    if (!currentAdmin) return;
    if (allowedPaths === null && !isSuperadmin) return;
    if (!canViewPage) return;
    loadAdmins();
  }, [allowedPaths, canViewPage, currentAdmin, isSuperadmin, loadAdmins]);

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAdmin) return;
    if (!isSuperadmin) {
      alert('Only a superadmin can manage admin accounts.');
      return;
    }

    if (!newAdmin.username || !newAdmin.password) {
      alert('Username and password are required.');
      return;
    }

    if (
      String(newAdmin.role || '').toLowerCase().replace(/[\s_-]/g, '') === 'superadmin' &&
      !isSuperadmin
    ) {
      alert('Only a superadmin can create another superadmin.');
      return;
    }

    try {
      // Create admin (let DB generate uuid id)
      const payload = {
        username: newAdmin.username,
        password: newAdmin.password,
        role: newAdmin.role,
        position: newAdmin.position,
        is_active: true,
      };
      const { data: insertedRow, error: insertError } = await supabase
        .from('admins')
        .insert(payload)
        .select('id')
        .maybeSingle();

      if (insertError) throw insertError;
      const createdId = insertedRow?.id || '';

      // Match Settings page: create notification record
      await supabase.from('notifications').insert({
        title: 'Admin created',
        message: `Admin "${newAdmin.username}" created with role "${newAdmin.role}".`,
        type: 'general',
        recipient_role: 'admin',
        metadata: { created_by: currentAdmin?.username || 'system', admin_id: createdId || undefined },
      });

      setShowAddModal(false);
      setNewAdmin({ username: '', position: 'Employee', role: 'employee', password: '' });
      await loadAdmins();
      alert('Admin account created.');
    } catch (error: any) {
      console.error('Error adding admin:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleUpdateAdmin = async (adminId: string, updates: Partial<AdminUser>) => {
    if (!currentAdmin) return;
    if (!canEditAdmins) {
      alert('You do not have permission to edit accounts.');
      return;
    }

    try {
      const { error } = await supabase
        .from('admins')
        .update(updates)
        .eq('id', adminId);

      if (error) throw error;

      const adminToUpdate = admins.find(a => a.id === adminId);
      
      // Log activity
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "update",
        entity_type: "admin",
        entity_id: adminId,
        details: `Updated admin account: ${adminToUpdate?.username || adminId}`,
        page: "admins",
        metadata: {
          updatedAdmin: adminToUpdate?.username,
          updates
        }
      });

      loadAdmins();
      setEditingAdmin(null);
    } catch (error: any) {
      console.error('Error updating admin:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleUpdatePassword = async () => {
    if (!selectedAdminForPassword || !newPassword) return;
    if (!canChangeAdminPasswords) {
      alert('You do not have permission to change passwords.');
      return;
    }

    try {
      const { error } = await supabase
        .from('admins')
        .update({ password: newPassword })
        .eq('id', selectedAdminForPassword.id);

      if (error) throw error;

      // Log activity (don't block UX if logging fails)
      try {
        await logActivity({
          admin_id: currentAdmin?.id,
          admin_name: currentAdmin?.username,
          action: "update",
          entity_type: "admin",
          entity_id: selectedAdminForPassword.id,
          details: `Updated password for admin: ${selectedAdminForPassword.username}`,
          page: "admins",
          metadata: {
            updatedAdmin: selectedAdminForPassword.username,
            action: "password_change"
          }
        });
      } catch {
        // ignore
      }

      setShowPasswordModal(false);
      setSelectedAdminForPassword(null);
      setNewPassword('');

      // Refresh list so the UI reflects the new password
      await loadAdmins();
      alert('Password updated successfully!');
    } catch (error: any) {
      console.error('Error updating password:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleToggleStatus = async (adminId: string, currentStatus: boolean) => {
    if (!currentAdmin || adminId === currentAdmin.id) return;

    if (!canEditAdmins) {
      alert('You do not have permission to edit accounts.');
      return;
    }

    await handleUpdateAdmin(adminId, { is_active: !currentStatus });
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'superadmin': return 'bg-purple-100 text-purple-800';
      case 'admin': return 'bg-blue-100 text-blue-800';
      case 'manager': return 'bg-amber-100 text-amber-800';
      case 'employee': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'superadmin': return '👑';
      case 'admin': return '👤';
      case 'manager': return '🧑‍💼';
      case 'employee': return '👷';
      default: return '👤';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (currentAdmin && !canViewPage) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Admin & Employee Accounts</h1>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={!isSuperadmin}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          Add New Account
        </button>
      </div>

      {/* Admin Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {admins.map((admin) => (
          <div key={admin.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-lg font-semibold text-indigo-600">
                    {admin.username.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{admin.username}</h3>
                  <p className="text-sm text-gray-700">{admin.position || '—'}</p>
                </div>
              </div>
              
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(admin.role)}`}>
                {getRoleIcon(admin.role)} {admin.role}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Status:</span>
                <span className={`font-medium ${admin.is_active ? 'text-green-600' : 'text-red-600'}`}>
                  {admin.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Password:</span>
                <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                  {admin.password}
                </span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Created:</span>
                <span>{new Date(admin.created_at).toLocaleDateString()}</span>
              </div>
              
              {admin.last_login && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Last Login:</span>
                  <span>{new Date(admin.last_login).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            {currentAdmin?.id !== admin.id && (
              <div className="space-y-2">
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      if (!canEditAdmins) {
                        alert('You do not have permission to edit accounts.');
                        return;
                      }
                      setEditingAdmin(admin);
                    }}
                    className="flex-1 bg-gray-100 text-gray-700 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (!canChangeAdminPasswords) {
                        alert('You do not have permission to change passwords.');
                        return;
                      }
                      setSelectedAdminForPassword(admin);
                      setShowPasswordModal(true);
                    }}
                    className="flex-1 bg-blue-100 text-blue-700 px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-200 transition-colors"
                  >
                    Change Password
                  </button>
                </div>
                <button
                  onClick={() => handleToggleStatus(admin.id, admin.is_active)}
                  className={`w-full px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    admin.is_active 
                      ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  {admin.is_active ? 'Deactivate Account' : 'Activate Account'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Admin Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white/95 rounded-lg max-w-md w-full p-6 shadow-xl border border-gray-200">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Add New Account</h2>
            <form onSubmit={handleAddAdmin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900">Username</label>
                <input
                  type="text"
                  required
                  value={newAdmin.username}
                  onChange={(e) => setNewAdmin({...newAdmin, username: e.target.value})}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter username"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-900">Password</label>
                <input
                  type="text"
                  required
                  value={newAdmin.password}
                  onChange={(e) => setNewAdmin({...newAdmin, password: e.target.value})}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter password"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-900">Position</label>
                <select
                  value={newAdmin.position}
                  onChange={(e) => setNewAdmin({ ...newAdmin, position: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {ensurePositionOptions(newAdmin.position).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-900">Role</label>
                <select
                  value={newAdmin.role}
                  onChange={(e) => setNewAdmin({...newAdmin, role: e.target.value as AdminUser['role']})}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                  {isSuperadmin && <option value="superadmin">Superadmin</option>}
                </select>
              </div>
              
              <div className="flex space-x-3">
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && selectedAdminForPassword && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white/95 rounded-lg max-w-md w-full p-6 shadow-xl border border-gray-200">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Change Password</h2>
            <p className="text-gray-800 mb-4">
              Changing password for: <strong>{selectedAdminForPassword.username}</strong>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900">New Password</label>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter new password"
                />
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={handleUpdatePassword}
                  className="flex-1 bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  Update Password
                </button>
                <button
                  onClick={() => {
                    setShowPasswordModal(false);
                    setSelectedAdminForPassword(null);
                    setNewPassword('');
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Admin Modal */}
      {editingAdmin && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white/95 rounded-lg max-w-md w-full p-6 shadow-xl border border-gray-200">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Edit Account</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdateAdmin(editingAdmin.id, {
                username: editingAdmin.username,
                position: editingAdmin.position,
                role: editingAdmin.role
              });
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900">Username</label>
                <input
                  type="text"
                  required
                  value={editingAdmin.username}
                  onChange={(e) => setEditingAdmin({...editingAdmin, username: e.target.value})}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-900">Position</label>
                <select
                  value={editingAdmin.position || ''}
                  onChange={(e) => setEditingAdmin({ ...editingAdmin, position: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {ensurePositionOptions(editingAdmin.position).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-900">Role</label>
                <select
                  value={editingAdmin.role}
                  onChange={(e) => setEditingAdmin({...editingAdmin, role: e.target.value as any})}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                  <option value="superadmin">Superadmin</option>
                </select>
              </div>
              
              <div className="flex space-x-3">
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  Update
                </button>
                <button
                  type="button"
                  onClick={() => setEditingAdmin(null)}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}