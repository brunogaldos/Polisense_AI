import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'sturdy-quarter-479808-p0.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'sturdy-quarter-479808-p0',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'sturdy-quarter-479808-p0.appspot.com',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Validate required Firebase configuration
if (!firebaseConfig.apiKey) {
  const errorMessage = `
❌ Firebase API Key is missing!

Please set NEXT_PUBLIC_FIREBASE_API_KEY in your .env.local file.

To get your Firebase API key:
1. Go to https://console.firebase.google.com/project/sturdy-quarter-479808-p0/settings/general
2. Scroll down to "Your apps" section
3. Click on the web app (or create one if it doesn't exist)
4. Copy the "apiKey" value
5. Add it to your .env.local file:

NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key-here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=sturdy-quarter-479808-p0.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=sturdy-quarter-479808-p0
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=sturdy-quarter-479808-p0.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id

After adding the variables, restart your development server.
  `;
  
  if (typeof window === 'undefined') {
    // Server-side: throw error
    throw new Error(errorMessage);
  } else {
    // Client-side: log error and show user-friendly message
    console.error(errorMessage);
    // Don't throw to prevent app crash, but Firebase will fail gracefully
  }
}

// Initialize Firebase only if it hasn't been initialized already
// This prevents duplicate app errors during Next.js hot reloading
let app;
try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
} catch (error) {
  console.error('❌ Firebase initialization error:', error);
  console.error('Please check your Firebase configuration in .env.local');
  throw error;
}

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;

