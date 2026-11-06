import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
type AuthState = { session: Session | null; loading: boolean; configured: boolean }
const AuthContext = createContext<AuthState>({ session: null, loading: true, configured: false })
export function AuthProvider({ children }: { children: ReactNode }) { const [state, setState] = useState<AuthState>({ session: null, loading: isSupabaseConfigured, configured: isSupabaseConfigured }); useEffect(() => { if (!supabase) return; void supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false, configured: true })); const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, loading: false, configured: true })); return () => listener.subscription.unsubscribe() }, []); return <AuthContext.Provider value={state}>{children}</AuthContext.Provider> }
export const useAuth = () => useContext(AuthContext)
