'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../Clients/Supabase/SupabaseClients';
import { logActivity } from '../lib/activity';
import Logo from '../../components/Logo';
import ToastPopup, { ToastPopupState } from '../../components/ToastPopup';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<ToastPopupState>({
    open: false,
    type: 'info',
    title: undefined,
    message: '',
  });
  const router = useRouter();

  const showToast = (next: Omit<ToastPopupState, 'open'>) =>
    setToast({ open: true, ...next });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setToast((t) => ({ ...t, open: false }));
    setIsLoading(true);

    if (!username || !password) {
      showToast({
        type: 'error',
        title: 'Missing details',
        message: 'Please fill in all fields.',
      });
      setIsLoading(false);
      return;
    }

    try {
      console.log('🔐 Attempting to authenticate with username:', username);
      
      // Find admin by username
      const { data: adminData, error: adminError } = await supabase
        .from('admins')
        .select('id, username, password, position, role, is_active')
        .eq('username', username)
        .single();

      if (adminError || !adminData) {
        console.error('❌ Admin not found:', adminError);
        showToast({
          type: 'error',
          title: 'Account not found',
          message: 'This admin account does not exist. Please check the username.',
        });
        setIsLoading(false);
        return;
      }

      console.log('✅ Admin found:', adminData.username, 'ID:', adminData.id);

      // Check if account is active
      if (!adminData.is_active) {
        showToast({
          type: 'error',
          title: 'Account not activated',
          message: 'Your account is not activated. Please contact an administrator.',
        });
        setIsLoading(false);
        return;
      }

      // Direct password comparison (plain text)
      if (adminData.password !== password) {
        showToast({
          type: 'error',
          title: 'Wrong password',
          message: 'The password you entered is incorrect.',
        });
        setIsLoading(false);
        return;
      }

      console.log('✅ Password verified for user:', adminData.username);

      // Update last login
      const { error: updateError } = await supabase
        .from('admins')
        .update({ last_login: new Date().toISOString() })
        .eq('id', adminData.id);

      if (updateError) {
        console.warn('⚠️ Failed to update last login:', updateError);
      }

      // Store admin session data in localStorage
      const sessionData = {
        id: adminData.id.toString(), // Ensure it's a string
        username: adminData.username,
        position: adminData.position,
        role: adminData.role,
        loginTime: new Date().toISOString()
      };
      localStorage.setItem('adminSession', JSON.stringify(sessionData));

      // Log login activity with better error handling
      try {
        console.log('📝 Logging login activity for admin ID:', adminData.id);
        const activityResult = await logActivity({
          admin_id: adminData.id.toString(), // Convert UUID to string
          admin_name: adminData.username,
          action: "login",
          entity_type: "admin",
          details: `Admin "${adminData.username}" logged into the system`,
          page: "auth",
          metadata: {
            loginTime: new Date().toISOString(),
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
            role: adminData.role,
            position: adminData.position
          }
        });

        if (activityResult.success) {
          console.log('✅ Login activity logged successfully');
        } else {
          console.error('❌ Failed to log login activity:', activityResult.error);
        }
      } catch (logError) {
        console.error('💥 Exception while logging activity:', logError);
        // Don't block login if activity logging fails
      }

      console.log('🎉 Login successful, redirecting to dashboard');
      router.push('/dashboard');

    } catch (error: any) {
      console.error('💥 Login exception:', error);
      showToast({
        type: 'error',
        title: 'Login failed',
        message: 'An unexpected error occurred. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <ToastPopup state={toast} onClose={() => setToast((t) => ({ ...t, open: false }))} />
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="large" />
        </div>

        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">Admin Login</h1>

        {/* Errors now show as popup notifications */}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              id="username"
              className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-black"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              id="password"
              className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-black"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Signing in...
                </>
              ) : 'Sign in'}
            </button>
          </div>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">Admin access only</span>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            Use your assigned username and password to access the admin panel
          </p>
        </div>
      </div>

      <p className="mt-8 text-center text-sm text-gray-600">
        &copy; {new Date().getFullYear()} GrandLink Glass and Aluminium. All rights reserved.
      </p>
    </div>
  );
}