// utils
import { logger } from 'utils/logs';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase/config';

import type { User, UserData, UserWithToken } from 'types/user';

/**
 * Logs in a user based on the email + password combination
 * Now handled by Firebase Auth through AuthContext
 * @param {Object} options
 * @returns {Object}
 */
export const loginUser = ({ email, password }) => {
  logger.info('Login user - use AuthContext.login instead');
  // This is now handled by AuthContext.login
  throw new Error('Use AuthContext.login instead');
};

/**
 * This function sends a request to reset the user's password using Firebase Auth
 * @param {Object} options
 * @returns {Object}
 */
export const forgotPassword = async ({ email }) => {
  logger.info('Forgot password');
  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (error) {
    logger.error(`Error requesting password reset: ${error.message}`);
    throw new Error(`Error requesting password reset: ${error.message}`);
  }
};

/**
 * Register a new user - now handled by Firebase Auth through AuthContext
 * @param {Object} options
 * @returns {Object}
 */
export const registerUser = ({ email }) => {
  logger.info('Register user - use AuthContext.signup instead');
  // This is now handled by AuthContext.signup
  throw new Error('Use AuthContext.signup instead');
};

/**
 * Upload user photo
 * @param {Blob} file file data
 * @param {Object} user
 */
// Upload photo - now handled by AuthContext.updateUserProfile
export const uploadPhoto = async (file, user) => {
  // Convert file to base64
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = async () => {
      try {
        // Update user profile with photo URL
        // This should be called through AuthContext.updateUserProfile
        const photoUrl = reader.result;
        resolve(photoUrl);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => {
      reject(error);
    };
  });
};

// Fetch user from Firestore
export const fetchUser = async (userToken: string): Promise<User> => {
  try {
    // Extract UID from token or use current user
    // For Firebase, we need the user ID directly
    // This function signature is kept for compatibility but should use AuthContext
    throw new Error('Use AuthContext.userProfile instead');
  } catch (error) {
    throw Error('unable to fetch user');
  }
};

// Fetch user data from Firestore
export const fetchUserData = async (userToken: string): Promise<UserData> => {
  try {
    // This is now handled by AuthContext.userProfile
    // Keeping for compatibility but should use context directly
    throw new Error('Use AuthContext.userProfile instead');
  } catch (error) {
    throw new Error(`Error getting user data: ${error.message}`);
  }
};

// Update user data in Firestore
export const updateUserData = async (
  user: UserWithToken,
  userData: Partial<UserData>,
): Promise<UserData> => {
  // This is now handled by AuthContext.updateUserProfile
  // Keeping for compatibility but should use context directly
  throw new Error('Use AuthContext.updateUserProfile instead');
};

// Create user data in Firestore
export const createUserData = async (userToken: string, user: Partial<User>): Promise<UserData> => {
  // User data is automatically created on signup via AuthContext
  // Keeping for compatibility
  throw new Error('User data is automatically created on signup');
};
