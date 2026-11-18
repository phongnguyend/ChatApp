export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
