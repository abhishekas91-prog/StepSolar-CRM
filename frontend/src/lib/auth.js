export const SUPER_ADMIN_EMAIL = 'super@stepsolar.in';

export function isSuperAdmin(user) {
  return (user?.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}
