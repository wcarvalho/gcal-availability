import React, { useState, useEffect, useCallback } from 'react';
import { initGoogleClient, signIn, signOut, listCalendars, listEvents } from './services/googleCalendarService';
import { CalendarCategory } from './types';
import type { GoogleCalendar, GoogleCalendarEvent, CategorizedCalendar, DailyAvailability, ProjectTask, ProjectSummary, TimeConfig, ProcessedData, FungibleTimeSummary, DailyEventDetail, DailyDetails } from './types';
import { DEFAULT_START_TIME, DEFAULT_END_TIME, PROJECT_COLORS, CATEGORY_DETAILS, TASK_CALENDAR_BLOCK_KEYWORDS, CogIcon, CalendarDaysIcon, EyeIcon, EyeSlashIcon, PlayIcon, NoSymbolIcon, CheckCircleIcon, ListBulletIcon, DEFAULT_TIME_BUFFER_FACTOR, COMMON_TIMEZONES } from './constants.tsx';
import { TimeAvailableChart, ProjectTimeChart, FungibleTimeChart } from './components/ChartComponents';

// Helper: Get user's current timezone
const getUserTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

// Helper: Convert date to timezone-aware date
const toTimezoneDate = (date: Date, timezone: string): Date => {
  const dateStr = date.toLocaleString('en-US', { timeZone: timezone });
  return new Date(dateStr);
};

// Helper: Format date to YYYY-MM-DD in specific timezone
const formatDateToYMD = (date: Date, timezone?: string): string => {
  if (timezone) {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return formatter.format(date);
  }
  return date.toISOString().split('T')[0];
};

// Helper: Get dates in range considering timezone
const getDatesInRange = (startDateStr: string, endDateStr: string, timezone: string): Date[] => {
  const dates: Date[] = [];
  
  // Create dates explicitly in the target timezone by using the date string directly
  // This avoids timezone conversion issues when creating Date objects
  let currentDate = new Date(startDateStr + 'T12:00:00'); // Use noon to avoid DST issues
  const endDate = new Date(endDateStr + 'T12:00:00');

  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  return dates;
};

// Helper: Parse HH:MM time to minutes from midnight
const parseTimeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// Helper: Calculate overlap between event time and work hours (in minutes)
const calculateWorkHoursOverlap = (
  eventStart: Date, 
  eventEnd: Date, 
  workStartTime: string, 
  workEndTime: string,
  timezone: string
): number => {
  // Get the date for the event in the specified timezone
  const eventDateStr = formatDateToYMD(eventStart, timezone);
  
  // Create work start and end times for the event's date in the specified timezone
  // Parse work hours (e.g., "09:00" -> 9 hours, 0 minutes)
  const [workStartHour, workStartMin] = workStartTime.split(':').map(Number);
  const [workEndHour, workEndMin] = workEndTime.split(':').map(Number);
  
  // Create work boundary times as Date objects in the target timezone
  // We need to create these dates carefully to ensure they're in the correct timezone
  const workStartInTZ = new Date();
  workStartInTZ.setTime(eventStart.getTime()); // Start with event's time
  workStartInTZ.setUTCFullYear(
    parseInt(eventDateStr.split('-')[0]), 
    parseInt(eventDateStr.split('-')[1]) - 1, 
    parseInt(eventDateStr.split('-')[2])
  );
  
  // Convert to the target timezone and set work hours
  const workStartStr = `${eventDateStr}T${workStartTime.padStart(5, '0')}:00`;
  const workEndStr = `${eventDateStr}T${workEndTime.padStart(5, '0')}:00`;
  
  // Create Date objects and adjust for timezone
  const tempWorkStart = new Date(workStartStr);
  const tempWorkEnd = new Date(workEndStr);
  
  // Get timezone offset and adjust
  const sampleDate = new Date(workStartStr);
  const utcTime = sampleDate.getTime();
  const tzOffsetMs = sampleDate.getTimezoneOffset() * 60000;
  
  // For more reliable timezone handling, let's use a simpler approach:
  // Convert everything to the same timezone-aware comparison
  const eventStartTime = eventStart.toLocaleString('en-US', { 
    timeZone: timezone, 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  const eventEndTime = eventEnd.toLocaleString('en-US', { 
    timeZone: timezone, 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  // Parse event times to minutes for comparison
  const eventStartMinutes = parseTimeToMinutes(eventStartTime);
  const eventEndMinutes = parseTimeToMinutes(eventEndTime);
  const workStartMinutes = parseTimeToMinutes(workStartTime);
  const workEndMinutes = parseTimeToMinutes(workEndTime);
  
  // Check if the event is on the same day as we're analyzing
  const eventDateInTZ = eventStart.toLocaleDateString('en-CA', { timeZone: timezone });
  if (eventDateInTZ !== eventDateStr) {
    return 0; // Event is on a different day
  }
  
  // Calculate overlap in minutes
  const overlapStart = Math.max(eventStartMinutes, workStartMinutes);
  const overlapEnd = Math.min(eventEndMinutes, workEndMinutes);
  
  // If overlap start is after overlap end, there's no overlap
  if (overlapStart >= overlapEnd) {
    return 0;
  }
  
  // Return overlap duration in minutes
  return overlapEnd - overlapStart;
};

// Helper: Check if a date is a weekend
const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday (0) or Saturday (6)
};

const App: React.FC = () => {
  const [gapiReady, setGapiReady] = useState<boolean>(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Storage keys
  const STORAGE_KEYS = {
    TIME_CONFIG: 'calendarTimeManager_timeConfig',
    CALENDAR_CATEGORIES: 'calendarTimeManager_calendarCategories',
  };

  // Helper: Load saved time config or return defaults
  const loadTimeConfig = (): TimeConfig => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TIME_CONFIG);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate that all required fields exist
        if (parsed.startDate && parsed.endDate && parsed.weekdayStartTime && parsed.weekdayEndTime && 
            parsed.weekendStartTime && parsed.weekendEndTime && parsed.timezone) {
          // Add default timeBufferFactor if not present for backward compatibility
          if (typeof parsed.timeBufferFactor !== 'number') {
            parsed.timeBufferFactor = DEFAULT_TIME_BUFFER_FACTOR;
          }
          return parsed;
        }
      }
    } catch (e) {
      console.error('Error loading saved time config:', e);
    }
    
    // Return defaults if no saved config or error
    const today = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(today.getDate() + 7);
    const userTimezone = getUserTimezone();
    return {
      startDate: formatDateToYMD(today, userTimezone),
      endDate: formatDateToYMD(sevenDaysFromNow, userTimezone),
      weekdayStartTime: DEFAULT_START_TIME,
      weekdayEndTime: DEFAULT_END_TIME,
      weekendStartTime: "10:00",
      weekendEndTime: "18:00",
      timezone: userTimezone,
      timeBufferFactor: DEFAULT_TIME_BUFFER_FACTOR,
    };
  };

  // Helper: Load saved calendar categories
  const loadCalendarCategories = (): Record<string, CalendarCategory> | null => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CALENDAR_CATEGORIES);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Error loading saved calendar categories:', e);
    }
    return null;
  };

  // Helper: Save time config to localStorage
  const saveTimeConfig = (config: TimeConfig) => {
    try {
      localStorage.setItem(STORAGE_KEYS.TIME_CONFIG, JSON.stringify(config));
    } catch (e) {
      console.error('Error saving time config:', e);
    }
  };

  // Helper: Save calendar categories to localStorage
  const saveCalendarCategories = (categories: Record<string, CalendarCategory>) => {
    try {
      localStorage.setItem(STORAGE_KEYS.CALENDAR_CATEGORIES, JSON.stringify(categories));
    } catch (e) {
      console.error('Error saving calendar categories:', e);
    }
  };

  const [timeConfig, setTimeConfig] = useState<TimeConfig>(loadTimeConfig);
  const [allCalendars, setAllCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarCategories, setCalendarCategories] = useState<Record<string, CalendarCategory>>({});
  const [showInactive, setShowInactive] = useState<boolean>(true);
  
  const [processedData, setProcessedData] = useState<ProcessedData | null>(null);
  const [showDailyDetails, setShowDailyDetails] = useState<boolean>(false);
  const [showFungibleDetails, setShowFungibleDetails] = useState<boolean>(false);

  const updateAuthStatus = useCallback((signedIn: boolean) => {
    setIsSignedIn(signedIn);
    if (signedIn) {
      setError(null);
      fetchUserCalendars();
    } else {
      setAllCalendars([]);
      setCalendarCategories({});
      setProcessedData(null);
    }
  }, []); // fetchUserCalendars will be added to deps later if needed, but it causes issues if added now.

  useEffect(() => {
    initGoogleClient(updateAuthStatus)
      .then(() => setGapiReady(true))
      .catch(err => {
        console.error("Error initializing GAPI client:", err);
        setError("Failed to initialize Google services. Ensure API key and Client ID are correct and popups are allowed.");
        setGapiReady(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateAuthStatus]); 

  const fetchUserCalendars = useCallback(async () => {
    if (!isSignedIn) return;
    setIsLoading(true);
    try {
      const calendars = (await listCalendars()).sort((a, b) => a.summary.localeCompare(b.summary));
      setAllCalendars(calendars);
      
      // Try to load saved categories first
      const savedCategories = loadCalendarCategories();
      const initialCategories: Record<string, CalendarCategory> = {};
      
      calendars.forEach(cal => {
        // Use saved category if available, otherwise default to Inactive
        initialCategories[cal.id] = savedCategories?.[cal.id] || CalendarCategory.Inactive;
      });
      
      setCalendarCategories(initialCategories);
      // Save the merged categories (this handles new calendars)
      saveCalendarCategories(initialCategories);
    } catch (err) {
      console.error("Error fetching calendars:", err);
      setError("Failed to fetch calendars.");
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn]);

  // Add fetchUserCalendars to updateAuthStatus dependency once it's stable
  useEffect(() => {
    if (isSignedIn && gapiReady) { // Ensure gapi is ready before fetching
        fetchUserCalendars();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, gapiReady]); // Removed fetchUserCalendars from here to avoid loop with updateAuthStatus


  const handleTimeConfigChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setTimeConfig(prev => {
      const newConfig = { ...prev, [e.target.name]: e.target.value };
      saveTimeConfig(newConfig); // Save whenever config changes
      return newConfig;
    });
  };

  const handleCategoryChange = (calendarId: string, category: CalendarCategory) => {
    setCalendarCategories(prev => {
      const newCategories = { ...prev, [calendarId]: category };
      saveCalendarCategories(newCategories); // Save whenever categories change
      return newCategories;
    });
  };

  const handleResetSettings = () => {
    if (window.confirm('This will reset all saved settings to defaults. Are you sure?')) {
      // Clear localStorage
      localStorage.removeItem(STORAGE_KEYS.TIME_CONFIG);
      localStorage.removeItem(STORAGE_KEYS.CALENDAR_CATEGORIES);
      
      // Reset to defaults
      const defaultConfig = loadTimeConfig(); // This will now return defaults since localStorage is cleared
      setTimeConfig(defaultConfig);
      
      // Reset calendar categories to all inactive
      const resetCategories: Record<string, CalendarCategory> = {};
      allCalendars.forEach(cal => resetCategories[cal.id] = CalendarCategory.Inactive);
      setCalendarCategories(resetCategories);
      
      setError(null);
      setProcessedData(null);
    }
  };

  const processCalendarData = useCallback(async () => {
    if (!isSignedIn) {
      setError("Please sign in first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setProcessedData(null);

    try {
      const { startDate, endDate, weekdayStartTime, weekdayEndTime, weekendStartTime, weekendEndTime } = timeConfig;
      
      // Validate time ranges
      const weekdayWorkMinutes = parseTimeToMinutes(weekdayEndTime) - parseTimeToMinutes(weekdayStartTime);
      const weekendWorkMinutes = parseTimeToMinutes(weekendEndTime) - parseTimeToMinutes(weekendStartTime);
      
      if (weekdayWorkMinutes <= 0) {
        setError("Weekday end time must be after start time.");
        setIsLoading(false);
        return;
      }
      
      if (weekendWorkMinutes <= 0) {
        setError("Weekend end time must be after start time.");
        setIsLoading(false);
        return;
      }
      
      // Create timezone-aware dates for API calls
      // Start at beginning of day in selected timezone
      const startDateTime = new Date(`${startDate}T00:00:00`);
      const startInTZ = new Date(startDateTime.toLocaleString('en-US', { timeZone: timeConfig.timezone }));
      const timeMin = new Date(startDateTime.getTime() - (startDateTime.getTime() - startInTZ.getTime())).toISOString();
      
      // End at end of day in selected timezone
      const endDateTime = new Date(`${endDate}T23:59:59`);
      const endInTZ = new Date(endDateTime.toLocaleString('en-US', { timeZone: timeConfig.timezone }));
      const timeMax = new Date(endDateTime.getTime() - (endDateTime.getTime() - endInTZ.getTime()) + 24*60*60*1000).toISOString();

      const datesInRange = getDatesInRange(startDate, endDate, timeConfig.timezone);
      const dailyAvailabilityMap: Record<string, { 
        availableMinutes: number, 
        totalMinutes: number,
        fungibleMinutes: number,
        taskMinutes: number
      }> = {};
      datesInRange.forEach(date => {
        const dateStr = formatDateToYMD(date, timeConfig.timezone);
        const isWeekendDay = isWeekend(date);
        const startTime = isWeekendDay ? weekendStartTime : weekdayStartTime;
        const endTime = isWeekendDay ? weekendEndTime : weekdayEndTime;
        const dailyWorkMinutes = (parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime)) * timeConfig.timeBufferFactor;
        
        dailyAvailabilityMap[dateStr] = { 
          availableMinutes: Math.max(0, dailyWorkMinutes), 
          totalMinutes: Math.max(0, dailyWorkMinutes / timeConfig.timeBufferFactor),
          fungibleMinutes: 0,
          taskMinutes: 0
        };
      });

      const relevantEvents: (GoogleCalendarEvent & { __calendarId: string; __calendarCategory: CalendarCategory })[] = [];
      for (const cal of allCalendars) {
        const category = calendarCategories[cal.id];
        if (category === CalendarCategory.Fungible || category === CalendarCategory.Task) {
          const events = await listEvents(cal.id, timeMin, timeMax);
          events.forEach(event => relevantEvents.push({ ...event, __calendarId: cal.id, __calendarCategory: category }));
        }
      }
      
      const projectTaskMap: Record<string, { project: string, task: string, hours: number, color: string }> = {};
      const fungibleTimeMap: Record<string, { calendarSummary: string, totalHours: number, color: string }> = {};
      const dailyDetailsMap: Record<string, DailyEventDetail[]> = {};
      const projectColorMap: Record<string, string> = {};
      let nextColorIndex = 0;
      const getProjectColor = (project: string): string => {
        if (!projectColorMap[project]) {
          projectColorMap[project] = PROJECT_COLORS[nextColorIndex % PROJECT_COLORS.length];
          nextColorIndex++;
        }
        return projectColorMap[project];
      };

      relevantEvents.forEach(event => {
        if (!event.start?.dateTime || !event.end?.dateTime) return; // Skip all-day or invalid events for simplicity

        const eventStart = new Date(event.start.dateTime);
        const eventEnd = new Date(event.end.dateTime);
        const eventDurationMinutes = (eventEnd.getTime() - eventStart.getTime()) / (1000 * 60);

        // Get the event date in the selected timezone
        const eventDateStr = formatDateToYMD(eventStart, timeConfig.timezone);
        
        if (dailyAvailabilityMap[eventDateStr]) {
            const category = event.__calendarCategory;
            const eventSummaryLower = event.summary?.toLowerCase() || "";
            const calendar = allCalendars.find(c => c.id === event.__calendarId);
            const calendarName = calendar?.summary || "Unknown Calendar";
            
            // Determine work hours for this day
            const isWeekendDay = isWeekend(eventStart);
            const dayStartTime = isWeekendDay ? weekendStartTime : weekdayStartTime;
            const dayEndTime = isWeekendDay ? weekendEndTime : weekdayEndTime;
            
            // Calculate how much of this event overlaps with work hours
            const workHoursOverlapMinutes = calculateWorkHoursOverlap(
              eventStart, 
              eventEnd, 
              dayStartTime, 
              dayEndTime, 
              timeConfig.timezone
            );
            
            // Format times for display
            const startTimeStr = eventStart.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              timeZone: timeConfig.timezone 
            });
            const endTimeStr = eventEnd.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              timeZone: timeConfig.timezone 
            });

            let impactType: DailyEventDetail['impactType'] = 'ignored';

            if (category === CalendarCategory.Fungible) {
                // Track fungible time and reduce available time by the amount that overlaps with work hours
                if (workHoursOverlapMinutes > 0) {
                    dailyAvailabilityMap[eventDateStr].fungibleMinutes += workHoursOverlapMinutes;
                    dailyAvailabilityMap[eventDateStr].availableMinutes -= workHoursOverlapMinutes;
                    impactType = 'reduces_available';
                } else {
                    impactType = 'ignored'; // No overlap with work hours
                }
                
                const calendarId = event.__calendarId;
                if (calendar) {
                    if (!fungibleTimeMap[calendarId]) {
                        fungibleTimeMap[calendarId] = {
                            calendarSummary: calendar.summary,
                            totalHours: 0,
                            color: getProjectColor(calendar.summary), // Reuse color logic
                        };
                    }
                    // Only count the overlapping time toward fungible time tracking
                    fungibleTimeMap[calendarId].totalHours += workHoursOverlapMinutes / 60;
                }
            } else if (category === CalendarCategory.Task) {
                if (TASK_CALENDAR_BLOCK_KEYWORDS.some(keyword => eventSummaryLower.includes(keyword))) {
                    // Events with blocking keywords (like "block" or "new event") are ignored
                    // They don't count against available time and aren't tracked as tasks
                    impactType = 'ignored';
                } else {
                    // For task events, track them separately and reduce available time
                    if (workHoursOverlapMinutes > 0) {
                        dailyAvailabilityMap[eventDateStr].taskMinutes += workHoursOverlapMinutes;
                        dailyAvailabilityMap[eventDateStr].availableMinutes -= workHoursOverlapMinutes;
                        impactType = 'task_tracked';
                    } else {
                        // Still track the task even if it's outside work hours, but don't reduce available time
                        impactType = 'task_tracked';
                    }
                    
                    let project = "Unassigned";
                    let task = event.summary || "Unnamed Task";
                    if (event.summary?.includes(':')) {
                        [project, task] = event.summary.split(':', 2).map(s => s.trim());
                    } else if (event.summary) {
                        project = event.summary; // Assign full summary as project if no colon
                    }
                    
                    // Normalize project and task names for grouping (trim and lowercase)
                    const normalizedProject = project.trim().toLowerCase();
                    const normalizedTask = task.trim().toLowerCase();
                    const taskKey = `${normalizedProject}::${normalizedTask}`;
                    
                    if (!projectTaskMap[taskKey]) {
                        projectTaskMap[taskKey] = {
                            project,
                            task,
                            hours: 0,
                            color: getProjectColor(project),
                        };
                    }
                    projectTaskMap[taskKey].hours += eventDurationMinutes / 60;
                }
            }
            
            // Add to daily details with additional overlap information
            // Only include events that have an impact (not ignored)
            if (impactType !== 'ignored') {
                if (!dailyDetailsMap[eventDateStr]) {
                    dailyDetailsMap[eventDateStr] = [];
                }
                dailyDetailsMap[eventDateStr].push({
                    summary: event.summary || "Unnamed Event",
                    calendarName,
                    category,
                    startTime: startTimeStr,
                    endTime: endTimeStr,
                    duration: eventDurationMinutes / 60,
                    impactType,
                });
            }
        }
      });
      
      const finalDailyAvailability: DailyAvailability[] = datesInRange.map(date => {
        const dateStr = formatDateToYMD(date, timeConfig.timezone);
        const data = dailyAvailabilityMap[dateStr];
        // Format the display date using the selected timezone
        const displayDate = new Intl.DateTimeFormat('en-US', { 
          month: 'numeric', 
          day: 'numeric', 
          weekday: 'short',
          timeZone: timeConfig.timezone 
        }).format(date);
        
        // Calculate available time after only fungible is subtracted (this defines top of grey)
        const availableAfterFungible = Math.max(0, (data.totalMinutes - data.fungibleMinutes) / 60);
        
        return {
          date: displayDate,
          availableHours: Math.max(0, data.availableMinutes / 60), // Still available after both fungible and tasks
          totalHours: availableAfterFungible, // Available after only fungible (used as "total" for chart)
        };
      });

      const finalDailyDetails: DailyDetails[] = datesInRange.map(date => {
        const dateStr = formatDateToYMD(date, timeConfig.timezone);
        const displayDate = new Intl.DateTimeFormat('en-US', { 
          month: 'numeric', 
          day: 'numeric', 
          weekday: 'short',
          timeZone: timeConfig.timezone 
        }).format(date);
        return {
          date: displayDate,
          events: dailyDetailsMap[dateStr] || [],
        };
      });

      // Convert the grouped task map to arrays for final processing
      const projectTaskData: ProjectTask[] = Object.values(projectTaskMap);
      
      const projectSummariesMap: Record<string, { totalHours: number, color: string }> = {};
      projectTaskData.forEach(pt => {
        if (!projectSummariesMap[pt.project]) {
          projectSummariesMap[pt.project] = { totalHours: 0, color: pt.color };
        }
        projectSummariesMap[pt.project].totalHours += pt.hours;
      });
      const finalProjectSummaries: ProjectSummary[] = Object.entries(projectSummariesMap)
        .map(([project, data]) => ({ project, ...data }))
        .sort((a,b) => b.totalHours - a.totalHours);

      const finalFungibleSummaries: FungibleTimeSummary[] = Object.values(fungibleTimeMap)
        .map(data => ({ ...data, project: data.calendarSummary })) // Adapt for chart component
        .sort((a, b) => b.totalHours - a.totalHours);

      setProcessedData({
        dailyAvailability: finalDailyAvailability,
        projectTasks: projectTaskData.sort((a,b) => a.project.localeCompare(b.project) || a.task.localeCompare(b.task)),
        projectSummaries: finalProjectSummaries,
        fungibleTimeSummary: finalFungibleSummaries,
        dailyDetails: finalDailyDetails,
      });

    } catch (err: any) {
      console.error("Error processing calendar data:", err);
      setError(`Failed to process data: ${err.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [allCalendars, calendarCategories, isSignedIn, timeConfig]);

  // Auto-run analysis when conditions are met
  useEffect(() => {
    if (isSignedIn && allCalendars.length > 0 && !isLoading && !processedData) {
      // Check if any calendars are categorized as Task or Fungible
      const hasActiveCalendars = allCalendars.some(cal => {
        const category = calendarCategories[cal.id];
        return category === CalendarCategory.Task || category === CalendarCategory.Fungible;
      });
      
      if (hasActiveCalendars) {
        // Delay execution slightly to ensure UI is ready
        const timeoutId = setTimeout(() => {
          processCalendarData();
        }, 500);
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [isSignedIn, allCalendars, calendarCategories, isLoading, processedData, processCalendarData]);

  const displayedCalendars = showInactive ? allCalendars : allCalendars.filter(cal => calendarCategories[cal.id] !== CalendarCategory.Inactive);
  
  const totalAssignedHours = processedData?.projectTasks.reduce((sum, task) => sum + task.hours, 0) || 0;

  if (!gapiReady && !error) {
    return <div className="flex justify-center items-center h-screen text-xl font-semibold text-slate-700">Initializing Google Services...</div>;
  }
  
  return (
    <div className="min-h-screen flex flex-col text-slate-800 bg-slate-50">
      <header className="bg-slate-800 text-white p-4 shadow-md">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold flex items-center">
            <CalendarDaysIcon className="w-8 h-8 mr-2 text-teal-400"/> Calendar Time Manager
          </h1>
          {!isSignedIn ? (
            <button
              onClick={() => signIn().catch(err => setError("Sign-in failed. Check console and ensure popups are enabled."))}
              className="bg-teal-500 hover:bg-teal-600 text-white font-semibold py-2 px-4 rounded-lg shadow transition duration-150 ease-in-out"
              disabled={!gapiReady || isLoading}
            >
              Sign In with Google
            </button>
          ) : (
            <button
              onClick={() => signOut().catch(err => setError("Sign-out failed."))}
              className="bg-rose-500 hover:bg-rose-600 text-white font-semibold py-2 px-4 rounded-lg shadow transition duration-150 ease-in-out"
              disabled={isLoading}
            >
              Sign Out
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="container mx-auto mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded relative" role="alert">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
          <button onClick={() => setError(null)} className="absolute top-0 bottom-0 right-0 px-4 py-3">
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>
      )}

      {isSignedIn && (
        <div className="container mx-auto p-4 flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Sidebar: Calendars & Config */}
          <aside className="lg:col-span-1 space-y-6">
            {/* Config Panel */}
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <h2 className="text-xl font-semibold mb-4 text-slate-700 flex items-center"><CogIcon className="w-6 h-6 mr-2 text-teal-500"/>Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="timezone" className="block text-sm font-medium text-slate-600">Timezone</label>
                  <select 
                    name="timezone" 
                    id="timezone" 
                    value={timeConfig.timezone} 
                    onChange={handleTimeConfigChange} 
                    className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm p-2"
                  >
                    {COMMON_TIMEZONES.map(tz => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="startDate" className="block text-sm font-medium text-slate-600">Start Date</label>
                  <input type="date" name="startDate" id="startDate" value={timeConfig.startDate} onChange={handleTimeConfigChange} className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm p-2"/>
                </div>
                <div>
                  <label htmlFor="endDate" className="block text-sm font-medium text-slate-600">End Date</label>
                  <input type="date" name="endDate" id="endDate" value={timeConfig.endDate} onChange={handleTimeConfigChange} className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm p-2"/>
                </div>
                <div>
                  <label htmlFor="timeBufferFactor" className="block text-sm font-medium text-slate-600">
                    Available Time Display ({Math.round((1 - timeConfig.timeBufferFactor) * 100)}% buffer)
                  </label>
                  <select 
                    name="timeBufferFactor" 
                    id="timeBufferFactor" 
                    value={timeConfig.timeBufferFactor} 
                    onChange={handleTimeConfigChange} 
                    className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm p-2"
                  >
                    <option value={1.0}>100% - No buffer</option>
                    <option value={0.9}>90% - 10% buffer</option>
                    <option value={0.8}>80% - 20% buffer</option>
                    <option value={0.7}>70% - 30% buffer</option>
                    <option value={0.6}>60% - 40% buffer</option>
                    <option value={0.5}>50% - 50% buffer</option>
                  </select>
                </div>
                
                {/* Work Hours Table */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">Work Hours</label>
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Schedule</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Start Time</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">End Time</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-200">
                        <tr>
                          <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-slate-700">Weekdays</td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <input 
                              type="time" 
                              name="weekdayStartTime" 
                              value={timeConfig.weekdayStartTime} 
                              onChange={handleTimeConfigChange} 
                              className="block w-full rounded-md border-slate-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm p-2"
                            />
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <input 
                              type="time" 
                              name="weekdayEndTime" 
                              value={timeConfig.weekdayEndTime} 
                              onChange={handleTimeConfigChange} 
                              className="block w-full rounded-md border-slate-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm p-2"
                            />
                          </td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-slate-700">Weekends</td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <input 
                              type="time" 
                              name="weekendStartTime" 
                              value={timeConfig.weekendStartTime} 
                              onChange={handleTimeConfigChange} 
                              className="block w-full rounded-md border-slate-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm p-2"
                            />
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <input 
                              type="time" 
                              name="weekendEndTime" 
                              value={timeConfig.weekendEndTime} 
                              onChange={handleTimeConfigChange} 
                              className="block w-full rounded-md border-slate-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm p-2"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <button
                  onClick={processCalendarData}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center bg-teal-500 hover:bg-teal-600 text-white font-bold py-2 px-4 rounded-lg shadow transition duration-150 ease-in-out disabled:opacity-50"
                >
                  {isLoading ? (
                     <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                  ) : <PlayIcon className="w-5 h-5 mr-2"/> }
                  Run Analysis
                </button>
                <button
                  onClick={handleResetSettings}
                  className="w-full flex items-center justify-center bg-slate-500 hover:bg-slate-600 text-white font-semibold py-1.5 px-3 rounded-lg shadow transition duration-150 ease-in-out text-sm"
                >
                  Reset All Settings
                </button>
              </div>
            </div>

            {/* Calendar List */}
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <h2 className="text-xl font-semibold mb-2 text-slate-700">Calendars</h2>
              <div className="mb-4 p-3 bg-slate-100 rounded-md border border-slate-200 text-sm">
                <h3 className="font-medium mb-1 text-slate-600">Categorization Guide:</h3>
                {Object.values(CalendarCategory).map(cat => (
                  <div key={cat} className="flex items-center mb-1">
                    <span className={`w-3 h-3 rounded-full mr-2 ${CATEGORY_DETAILS[cat].color}`}></span>
                    <span className="font-semibold text-slate-700">{CATEGORY_DETAILS[cat].name}:</span>
                    <span className="ml-1 text-slate-500">{CATEGORY_DETAILS[cat].description}</span>
                  </div>
                ))}
              </div>
              <button
                  onClick={() => setShowInactive(prev => !prev)}
                  className="mb-3 text-sm text-teal-600 hover:text-teal-800 font-medium flex items-center"
              >
                {showInactive ? <EyeSlashIcon className="mr-1"/> : <EyeIcon className="mr-1"/>}
                {showInactive ? 'Hide Inactive Calendars' : 'Show All Calendars'}
              </button>
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {displayedCalendars.length === 0 && <p className="text-slate-500">No calendars to display.</p>}
                {displayedCalendars.map(cal => {
                  const currentCategory = calendarCategories[cal.id] || CalendarCategory.Inactive;
                  const categoryDetail = CATEGORY_DETAILS[currentCategory];
                  let nextCategory: CalendarCategory;
                  let nextCategoryLabel: string;
                  let buttonIcon: React.ReactNode;
                  
                  if (currentCategory === CalendarCategory.Inactive) {
                    nextCategory = CalendarCategory.Fungible;
                    nextCategoryLabel = CATEGORY_DETAILS[CalendarCategory.Fungible].name;
                    buttonIcon = <NoSymbolIcon className="w-4 h-4 mr-1"/>;
                  } else if (currentCategory === CalendarCategory.Fungible) {
                    nextCategory = CalendarCategory.Task;
                    nextCategoryLabel = CATEGORY_DETAILS[CalendarCategory.Task].name;
                    buttonIcon = <CheckCircleIcon className="w-4 h-4 mr-1 text-blue-600"/>;
                  } else { // Task
                    nextCategory = CalendarCategory.Inactive;
                    nextCategoryLabel = CATEGORY_DETAILS[CalendarCategory.Inactive].name;
                    buttonIcon = <ListBulletIcon className="w-4 h-4 mr-1 text-green-600"/>;
                  }

                  return (
                    <div key={cal.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors duration-150">
                      <div className="flex items-center truncate mr-2">
                        <span className={`w-4 h-4 rounded-full mr-3 flex-shrink-0 ${categoryDetail.color} border border-slate-300`} title={categoryDetail.name}></span>
                        <span className="text-sm text-slate-700 truncate" title={cal.summary}>{cal.summary}</span>
                      </div>
                      <button
                        onClick={() => handleCategoryChange(cal.id, nextCategory)}
                        title={`Cycle to: ${nextCategoryLabel}`}
                        className={`flex items-center px-3 py-1 text-xs font-medium rounded-full transition-all duration-150 whitespace-nowrap shadow-sm hover:shadow-md
                          ${currentCategory === CalendarCategory.Inactive ? 'bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-300' : ''}
                          ${currentCategory === CalendarCategory.Fungible ? 'bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300' : ''}
                          ${currentCategory === CalendarCategory.Task ? 'bg-green-100 hover:bg-green-200 text-green-700 border border-green-300' : ''}
                        `}
                      >
                        {buttonIcon}
                        {categoryDetail.name}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Main Content: Charts & Table */}
          <main className="lg:col-span-2 space-y-6">
            {isLoading && !processedData && (
              <div className="flex justify-center items-center h-64 bg-white rounded-xl shadow-lg">
                <svg className="animate-spin h-10 w-10 text-teal-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="ml-3 text-lg text-slate-600">Processing data...</p>
              </div>
            )}
            
            {processedData && (
              <>
                {/* Time Available Chart */}
                <section className="bg-white p-6 rounded-xl shadow-lg">
                  <h2 className="text-xl font-semibold mb-4 text-slate-700">Time Available Per Day</h2>
                  <TimeAvailableChart data={processedData.dailyAvailability} />
                  
                  {/* Details Button */}
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={() => setShowDailyDetails(!showDailyDetails)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 px-4 rounded-lg transition duration-150 ease-in-out text-sm flex items-center"
                    >
                      <span>{showDailyDetails ? 'Hide Details' : 'Show Details'}</span>
                      <svg 
                        className={`ml-2 h-4 w-4 transform transition-transform duration-200 ${showDailyDetails ? 'rotate-180' : ''}`}
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {/* Expandable Details Section */}
                  {showDailyDetails && (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <h3 className="text-lg font-medium mb-3 text-slate-600">Daily Event Breakdown</h3>
                      <div className="space-y-4 max-h-96 overflow-y-auto">
                        {processedData.dailyDetails.map((dayDetail) => (
                          <div key={dayDetail.date} className="border border-slate-200 rounded-lg p-4">
                            <h4 className="font-semibold text-slate-700 mb-2">{dayDetail.date}</h4>
                            {dayDetail.events.length === 0 ? (
                              <p className="text-slate-500 text-sm">No events scheduled</p>
                            ) : (
                              <div className="space-y-2">
                                {dayDetail.events.map((event, idx) => (
                                  <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                                    <div className="flex-1">
                                      <div className="font-medium text-slate-700 text-sm">{event.summary}</div>
                                      <div className="text-xs text-slate-500">
                                        {event.calendarName} • {event.startTime} - {event.endTime} • {event.duration.toFixed(1)}h
                                      </div>
                                    </div>
                                    <div className="flex items-center ml-4">
                                      <span className={`w-3 h-3 rounded-full mr-2 ${CATEGORY_DETAILS[event.category].color}`}></span>
                                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                        event.impactType === 'reduces_available' ? 'bg-red-100 text-red-700' :
                                        event.impactType === 'task_tracked' ? 'bg-green-100 text-green-700' :
                                        'bg-gray-100 text-gray-700'
                                      }`}>
                                        {event.impactType === 'reduces_available' ? 'Reduces Available Time' :
                                         event.impactType === 'task_tracked' ? 'Task Tracked' :
                                         'Ignored'}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                {/* Task Assignments */}
                <section className="bg-white p-6 rounded-xl shadow-lg">
                  <h2 className="text-xl font-semibold mb-4 text-slate-700">Task Assignments</h2>
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-medium mb-2 text-slate-600">Total Time Per Project</h3>
                      <ProjectTimeChart data={processedData.projectSummaries} />
                    </div>
                    <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                      <h3 className="text-lg font-medium mb-2 text-slate-600">Task Details (Total: {totalAssignedHours.toFixed(1)}h)</h3>
                      {processedData.projectTasks.length === 0 ? (
                        <p className="text-slate-500">No tasks assigned in the selected period.</p>
                      ) : (
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 sticky top-0 z-10">
                            <tr>
                              <th className="px-4 py-3 text-left font-medium text-slate-500 tracking-wider">Project</th>
                              <th className="px-4 py-3 text-left font-medium text-slate-500 tracking-wider">Task</th>
                              <th className="px-4 py-3 text-left font-medium text-slate-500 tracking-wider">Hours</th>
                              <th className="px-4 py-3 text-left font-medium text-slate-500 tracking-wider">% of Total</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-slate-200">
                            {processedData.projectTasks.map((task, idx) => (
                              <tr key={idx} style={{ borderLeft: `4px solid ${task.color}` }} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-2 whitespace-nowrap text-slate-700 font-medium">{task.project}</td>
                                <td className="px-4 py-2 whitespace-normal break-words text-slate-600">{task.task}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-slate-600">{task.hours.toFixed(1)}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                                  {totalAssignedHours > 0 ? ((task.hours / totalAssignedHours) * 100).toFixed(1) : '0.0'}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </section>

                {/* Fungible Time Analysis */}
                {processedData.fungibleTimeSummary.length > 0 && (
                  <section className="bg-white p-6 rounded-xl shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-semibold text-slate-700">Fungible Time Breakdown</h2>
                      <button
                        onClick={() => setShowFungibleDetails(!showFungibleDetails)}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 px-4 rounded-lg transition duration-150 ease-in-out text-sm flex items-center"
                      >
                        <span>{showFungibleDetails ? 'Hide Chart' : 'Show Chart'}</span>
                        <svg 
                          className={`ml-2 h-4 w-4 transform transition-transform duration-200 ${showFungibleDetails ? 'rotate-180' : ''}`}
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    
                    {showFungibleDetails && (
                      <>
                        <p className="text-sm text-slate-500 mb-4">
                          This chart shows the total time consumed by events on your 'Fungible' calendars.
                        </p>
                        <FungibleTimeChart data={processedData.fungibleTimeSummary} />
                      </>
                    )}
                  </section>
                )}
              </>
            )}
            {!isLoading && !processedData && isSignedIn && (
                <div className="bg-white p-10 rounded-xl shadow-lg text-center">
                    <CalendarDaysIcon className="w-16 h-16 text-teal-400 mx-auto mb-4"/>
                    <h2 className="text-xl font-semibold mb-2 text-slate-700">Ready to Analyze Your Time</h2>
                    <p className="text-slate-500">Configure your date range, typical work hours, and categorize your calendars on the left. Then, click "Run Analysis" to see how your time is distributed.</p>
                </div>
            )}
          </main>
        </div>
      )}
       <footer className="text-center py-4 text-sm text-slate-500 border-t border-slate-200 mt-auto bg-white">
        Calendar Time Manager &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
};

export default App;
