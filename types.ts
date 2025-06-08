// Base Google Calendar API types (simplified)
export interface GoogleCalendar {
  id: string;
  summary: string;
  backgroundColor: string; // Or use for our category color
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  [key: string]: any; // Allow other properties
}

// Application specific types
export enum CalendarCategory {
  Inactive = 'inactive',
  Fungible = 'fungible',
  Task = 'task',
}

export interface CategorizedCalendar extends GoogleCalendar {
  category: CalendarCategory;
}

export interface DailyAvailability {
  date: string; // Formatted date string for chart label
  availableHours: number;
  totalHours: number; // Max possible hours for that day after buffer
}

export interface ProjectTask {
  project: string;
  task: string;
  hours: number;
  color: string;
}

export interface ProjectSummary {
  project: string;
  totalHours: number;
  color: string;
}

export interface FungibleTimeSummary {
  project: string; // Calendar summary in this context
  totalHours: number;
  color: string;
}

export interface DailyEventDetail {
  summary: string;
  calendarName: string;
  category: CalendarCategory;
  startTime: string;
  endTime: string;
  duration: number; // in hours
  impactType: 'reduces_available' | 'task_tracked' | 'ignored'; // How this event affects calculations
}

export interface DailyDetails {
  date: string; // Same format as DailyAvailability.date
  events: DailyEventDetail[];
}

export interface TimeConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  weekdayStartTime: string; // HH:MM
  weekdayEndTime: string; // HH:MM
  weekendStartTime: string; // HH:MM
  weekendEndTime: string; // HH:MM
  timezone: string; // IANA timezone string (e.g., 'America/New_York')
  timeBufferFactor: number; // Fraction of available time to display (0.8 = 20% buffer)
}

export interface ProcessedData {
  dailyAvailability: DailyAvailability[];
  projectTasks: ProjectTask[];
  projectSummaries: ProjectSummary[];
  fungibleTimeSummary: FungibleTimeSummary[];
  dailyDetails: DailyDetails[];
}

export interface GApiAuthInstance {
  signIn: () => Promise<any>;
  signOut: () => Promise<any>;
  isSignedIn: {
    get: () => boolean;
    listen: (listener: (isSignedIn: boolean) => void) => void;
  };
  currentUser: {
    get: () => {
      hasGrantedScopes: (scopes: string) => boolean;
    };
  };
}

// New Google Identity Services types
export interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

export interface GISTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
  callback: (response: TokenResponse) => void;
}

export interface GApi {
  load: (apiName: string, callback: () => void) => void;
  client: {
    init: (args: { apiKey: string; clientId?: string; discoveryDocs: string[]; scope?: string; }) => Promise<void>;
    setToken: (token: { access_token: string }) => void;
    calendar: {
      calendarList: {
        list: () => Promise<{ result: { items: GoogleCalendar[] } }>;
      };
      events: {
        list: (args: {
          calendarId: string;
          timeMin: string;
          timeMax: string;
          singleEvents: boolean;
          orderBy: string;
          maxResults: number;
        }) => Promise<{ result: { items: GoogleCalendarEvent[] } }>;
      };
    };
  };
  auth2: {
    getAuthInstance: () => GApiAuthInstance;
    // Corrected: gapi.auth2.init expects client_id (snake_case)
    init: (args: { client_id: string; scope: string; }) => Promise<GApiAuthInstance>;
  };
}

declare global {
  interface Window {
    gapi: GApi;
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: any) => void;
          }) => GISTokenClient;
          hasGrantedAllScopes: (tokenResponse: TokenResponse, firstScope: string, ...restScopes: string[]) => boolean;
          hasGrantedAnyScope: (tokenResponse: TokenResponse, firstScope: string, ...restScopes: string[]) => boolean;
          revoke: (accessToken: string, callback?: () => void) => void;
        };
      };
    };
  }
}