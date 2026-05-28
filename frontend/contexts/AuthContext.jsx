import { createContext, useContext, useEffect, useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, db } from '../firebase/config';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Sign up function - creates user in Firebase Auth and profile in Firestore
  const signup = async (email, password, displayName) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Create user profile document in Firestore matching the structure from integration doc
    const userProfileData = {
      uid: user.uid,
      email: user.email,
      displayName: displayName || user.email,
      name: displayName || user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      role: 'USER', // Default role
      provider: 'email',
    };

    await setDoc(doc(db, 'users', user.uid), userProfileData);
    setUserProfile(userProfileData);

    return userCredential;
  };

  // Login function - authenticates with Firebase Auth
  const login = async (email, password) => {
    return await signInWithEmailAndPassword(auth, email, password);
  };

  // Logout function - signs out from Firebase Auth
  const logout = async () => {
    await signOut(auth);
    setUserProfile(null);
  };

  // Update user profile in both Firestore and React state
  const updateUserProfile = async (updates) => {
    if (!currentUser) return;

    const updatedProfile = {
      ...userProfile,
      ...updates,
      updatedAt: serverTimestamp(),
    };

    // Update Firestore
    await updateDoc(doc(db, 'users', currentUser.uid), updatedProfile);

    // Update React state
    setUserProfile(updatedProfile);
  };

  // Load user profile from Firestore
  const loadUserProfile = async (uid) => {
    try {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setUserProfile({
          ...data,
          id: uid,
          _id: uid,
        });
      } else {
        // Create profile if it doesn't exist (for legacy users)
        try {
          const newProfile = {
            uid,
            email: currentUser?.email || '',
            displayName: currentUser?.displayName || currentUser?.email || '',
            name: currentUser?.displayName || currentUser?.email || '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            role: 'USER',
            provider: 'email',
          };
          await setDoc(doc(db, 'users', uid), newProfile);
          setUserProfile({
            ...newProfile,
            id: uid,
            _id: uid,
          });
        } catch (createError) {
          console.error('Error creating user profile:', createError);
          // Set a minimal profile from auth data if Firestore fails
          if (currentUser) {
            setUserProfile({
              uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || currentUser.email || '',
              name: currentUser.displayName || currentUser.email || '',
              role: 'USER',
              provider: 'email',
              id: uid,
              _id: uid,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
      // If Firestore fails, create a minimal profile from auth data
      if (currentUser) {
        setUserProfile({
          uid,
          email: currentUser.email || '',
          displayName: currentUser.displayName || currentUser.email || '',
          name: currentUser.displayName || currentUser.email || '',
          role: 'USER',
          provider: 'email',
          id: uid,
          _id: uid,
        });
      }
    }
  };

  // Listen to authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await loadUserProfile(user.uid);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Create session-like object for compatibility with existing code
  // Firebase Auth doesn't provide accessToken directly, we use the UID as identifier
  const session = currentUser ? {
    accessToken: currentUser.uid || null,
    user: currentUser,
  } : null;

  const value = {
    currentUser,
    userProfile,
    session,
    signup,
    login,
    logout,
    updateUserProfile,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

