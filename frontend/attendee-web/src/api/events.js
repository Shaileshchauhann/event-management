import { request } from './client';
export const listEvents = () => request('/events');
export const getEvent = eventId => request(`/events/${encodeURIComponent(eventId)}`);
