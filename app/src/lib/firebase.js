import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

export const app = initializeApp({
  projectId: 'demo-field-survey',
  apiKey: 'local-field-survey',
  authDomain: window.location.hostname,
});
export const auth = getAuth(app);
connectAuthEmulator(auth, window.location.origin, { disableWarnings: true });
