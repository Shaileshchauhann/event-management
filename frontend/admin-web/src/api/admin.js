import { request } from './client';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

export const login = (email, password) =>
  request('/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const listEvents = (token) =>
  request('/admin/events', { headers: auth(token) });

export const createEvent = (token, body) =>
  request('/admin/events', {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(body),
  });

export const updateEvent = (token, id, body) =>
  request(`/admin/events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: auth(token),
    body: JSON.stringify(body),
  });

export const getEvent = (token, id) =>
  request(`/admin/events/${encodeURIComponent(id)}`, { headers: auth(token) });

export const getStats = (token, id) =>
  request(`/admin/events/${encodeURIComponent(id)}/stats`, { headers: auth(token) });

export const listTickets = (token, id) =>
  request(`/admin/events/${encodeURIComponent(id)}/tickets`, { headers: auth(token) });

export const cancelTicket = (token, id, body = {}) =>
  request(`/admin/tickets/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(body),
  });

export const resendTicket = (token, id) =>
  request(`/admin/tickets/${encodeURIComponent(id)}/resend`, {
    method: 'POST',
    headers: auth(token),
  });

export const getAnalytics = (token, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.append(k, v);
  });
  const qs = query.toString() ? `?${query.toString()}` : '';
  return request(`/admin/analytics${qs}`, { headers: auth(token) });
};

export const listPayments = (token, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.append(k, v);
  });
  const qs = query.toString() ? `?${query.toString()}` : '';
  return request(`/admin/payments${qs}`, { headers: auth(token) });
};

export const refundPayment = (token, paymentId, body = {}) =>
  request(`/admin/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(body),
  });
