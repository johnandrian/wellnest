import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("delete expired telegram link codes", { hourUTC: 9, minuteUTC: 0 }, internal.telegram.deleteExpiredLinks);
crons.hourly("proactive check-ins", { minuteUTC: 5 }, internal.checkins.scan, {});
crons.daily("local weather and air quality", { hourUTC: 11, minuteUTC: 20 }, internal.weather.scan, {});
crons.hourly("weekly summaries", { minuteUTC: 10 }, internal.weekly.scan, {});
crons.hourly("flare forecasts", { minuteUTC: 15 }, internal.forecast.scan, {});
crons.hourly("agent morning check", { minuteUTC: 25 }, internal.agentScan.scan, {});
export default crons;
