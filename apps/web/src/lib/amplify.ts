import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { 
  getCurrentUser, 
  signIn, 
  signUp, 
  signOut, 
  confirmSignUp, 
  resendSignUpCode 
} from 'aws-amplify/auth';

import outputs from '../../amplify_outputs.json';

// Configure Amplify
Amplify.configure(outputs);

// Data client
export const client = generateClient<Schema>();

// Re-export auth functions directly
export { 
  getCurrentUser, 
  signIn, 
  signUp, 
  signOut, 
  confirmSignUp, 
  resendSignUpCode 
};

// Export types
export type { AuthUser } from 'aws-amplify/auth';