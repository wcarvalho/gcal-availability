import { GOOGLE_API_KEY, GOOGLE_CLIENT_ID, CALENDAR_SCOPES, DISCOVERY_DOCS } from '../constants';
import type { GApi, GoogleCalendar, GoogleCalendarEvent, GISTokenClient, TokenResponse } from '../types';

let gapiInstance: GApi | null = null;
let tokenClient: GISTokenClient | null = null;
let accessToken: string | null = null;
let isSignedIn = false;
let authStatusCallback: ((isSignedIn: boolean) => void) | null = null;

const TOKEN_STORAGE_KEY = 'gapi_access_token';
const TOKEN_EXPIRY_KEY = 'gapi_token_expiry';

// Helper to store token
const storeToken = (token: string, expiresIn: number) => {
  const expiryTime = new Date().getTime() + expiresIn * 1000;
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
  accessToken = token;
};

// Helper to retrieve and validate token
const getStoredToken = (): string | null => {
  const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  const expiryTime = localStorage.getItem(TOKEN_EXPIRY_KEY);

  if (storedToken && expiryTime && new Date().getTime() < parseInt(expiryTime, 10)) {
    accessToken = storedToken;
    return storedToken;
  }
  
  clearStoredToken();
  return null;
};

// Helper to clear token
const clearStoredToken = () => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  accessToken = null;
};

export const loadGapiScript = (): Promise<GApi> => {
  return new Promise((resolve, reject) => {
    if (window.gapi) {
      gapiInstance = window.gapi;
      resolve(gapiInstance);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      gapiInstance = window.gapi;
      if (gapiInstance) {
        resolve(gapiInstance);
      } else {
        reject(new Error("Failed to load GAPI script (window.gapi still null after script.onload)."));
      }
    };
    script.onerror = () => reject(new Error('Failed to load GAPI script (script.onerror).'));
    document.body.appendChild(script);
  });
};

export const initGoogleClient = async (
  updateAuthStatus: (isSignedIn: boolean) => void
): Promise<void> => {
  authStatusCallback = updateAuthStatus;
  
  // Debug: Log environment variables
  console.log('Debug: Environment variables check:');
  console.log('GOOGLE_CLIENT_ID:', GOOGLE_CLIENT_ID ? 'Set (length: ' + GOOGLE_CLIENT_ID.length + ')' : 'NOT SET');
  console.log('GOOGLE_API_KEY:', GOOGLE_API_KEY ? 'Set (length: ' + GOOGLE_API_KEY.length + ')' : 'NOT SET');
  
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google Client ID is not configured. Please check environment variables.");
  }
  if (!GOOGLE_API_KEY) {
    console.warn("Google API Key is not configured. API calls might fail.");
  }

  // Load GAPI if not already loaded
  if (!gapiInstance) {
    try {
      gapiInstance = await loadGapiScript();
    } catch (error) {
      console.error("Failed to load GAPI script in initGoogleClient:", error);
      throw error;
    }
  }

  // Use a local variable for gapiInstance to satisfy TypeScript's non-null assertion
  const currentGapi = gapiInstance;

  return new Promise((resolve, reject) => {
    currentGapi.load('client', async () => {
      try {
        console.log('Debug: Initializing Google API Client...');
        
        // Initialize the API client library (for making API calls)
        await currentGapi.client.init({
          apiKey: GOOGLE_API_KEY,
          discoveryDocs: DISCOVERY_DOCS,
        });
        
        console.log('Debug: API Client initialized successfully');
        
        // Initialize the new Google Identity Services token client
        if (!window.google || !window.google.accounts) {
          throw new Error('Google Identity Services library not loaded. Make sure the GIS script is included in your HTML.');
        }
        
        console.log('Debug: Initializing Google Identity Services token client...');
        
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: CALENDAR_SCOPES,
          callback: (response: TokenResponse) => {
            console.log('Debug: Token response received');
            if (response.error) {
              console.error('Token error:', response.error, response.error_description);
              handleAuthError(response.error_description || response.error);
              return;
            }
            
            // Store the access token and update gapi client
            storeToken(response.access_token, response.expires_in);
            currentGapi.client.setToken({ access_token: response.access_token });
            
            // Update signed-in status
            isSignedIn = true;
            if (authStatusCallback) {
              authStatusCallback(true);
            }
          },
          error_callback: (error: any) => {
            console.error('Token client error:', error);
            handleAuthError(error.message || 'Authentication failed');
          }
        });
        
        console.log('Debug: Token client initialized successfully');
        
        // Check if we have a valid stored token
        const storedToken = getStoredToken();
        if (storedToken) {
          console.log('Debug: Found valid stored token. Setting user as signed in.');
          currentGapi.client.setToken({ access_token: storedToken });
          isSignedIn = true;
          updateAuthStatus(true);
        } else {
          console.log('Debug: No valid stored token found.');
          updateAuthStatus(false);
        }
        
        resolve();

      } catch (error: any) {
        console.error('Error initializing Google Client:', error);
        console.error('Full error object:', JSON.stringify(error, null, 2));
        
        let errorMessage = "Failed to initialize Google services.";
        if (error.message) {
          errorMessage += ` Message: ${error.message}`;
        }
        reject(new Error(errorMessage));
      }
    });
  });
};

const handleAuthError = (errorMessage: string) => {
  isSignedIn = false;
  accessToken = null;
  if (authStatusCallback) {
    authStatusCallback(false);
  }
  console.error('Authentication error:', errorMessage);
};

export const signIn = async (): Promise<void> => {
  if (!tokenClient) {
    throw new Error('Google Identity Services not initialized. Cannot sign in.');
  }
  
  // Request an access token
  tokenClient.requestAccessToken({ prompt: '' });
};

export const signOut = async (): Promise<void> => {
  if (accessToken) {
    window.google.accounts.oauth2.revoke(accessToken, () => {
      console.log('Access token revoked');
    });
  }
  
  // Clear the token from gapi client
  if (gapiInstance) {
    gapiInstance.client.setToken({ access_token: '' });
  }
  
  clearStoredToken();
  
  isSignedIn = false;
  if (authStatusCallback) {
    authStatusCallback(false);
  }
};

export const listCalendars = async (): Promise<GoogleCalendar[]> => {
  if (!gapiInstance || !isSignedIn || !accessToken) {
    throw new Error('User not signed in or GAPI not initialized for listing calendars.');
  }
  try {
    const response = await gapiInstance.client.calendar.calendarList.list();
    return response.result.items as GoogleCalendar[];
  } catch (error) {
    console.error('Error fetching calendars:', error);
    throw error;
  }
};

export const listEvents = async (
  calendarId: string,
  timeMin: string, // ISO string
  timeMax: string  // ISO string
): Promise<GoogleCalendarEvent[]> => {
  if (!gapiInstance || !isSignedIn || !accessToken) {
    throw new Error('User not signed in or GAPI not initialized for listing events.');
  }
  try {
    const response = await gapiInstance.client.calendar.events.list({
      calendarId: calendarId,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500, 
    });
    return response.result.items as GoogleCalendarEvent[];
  } catch (error) {
    console.error(`Error fetching events for calendar ${calendarId}:`, error);
    throw error;
  }
};
