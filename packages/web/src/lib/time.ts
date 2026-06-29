/** Format an epoch-ms instant as a Prague wall-clock "HH:MM" (24h). */
export const formatClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
