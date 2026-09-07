import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

/**
 * The Supabase client for the native app.
 *
 * `AsyncStorage` rather than the web's cookie jar: a native app has no cookies, which is also
 * why every API call sends the access token as a Bearer header (see api.ts). The server
 * accepts both and verifies either the same way.
 *
 * `detectSessionInUrl: false` because there is no URL bar to read a session out of; leaving it
 * on makes the client try to parse deep links as auth callbacks.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
