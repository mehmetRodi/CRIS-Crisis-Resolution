/**
 * Minimal design tokens for the mobile app, mirroring the web app's Tailwind
 * palette (slate + blue) so both surfaces read as one product. Replace with a
 * proper theme system if/when the mobile surface grows beyond CRIS-6.
 */
export const colors = {
  background: '#f8fafc', // slate-50
  surface: '#ffffff',
  border: '#e2e8f0', // slate-200
  inputBorder: '#cbd5e1', // slate-300
  textPrimary: '#0f172a', // slate-900
  textSecondary: '#64748b', // slate-500
  textMuted: '#94a3b8', // slate-400
  primary: '#2563eb', // blue-600
  primaryPressed: '#1d4ed8', // blue-700
  onPrimary: '#ffffff',
  required: '#ef4444', // red-500
  errorBg: '#fef2f2', // red-50
  errorBorder: '#fecaca', // red-200
  errorText: '#b91c1c', // red-700
  successBg: '#f0fdf4', // green-50
  successBorder: '#bbf7d0', // green-200
  successAccent: '#16a34a', // green-600
  successText: '#166534', // green-800
  warningBg: '#fffbeb', // amber-50
  warningBorder: '#fde68a', // amber-200
  warningText: '#92400e', // amber-800
} as const;

export const radii = {
  md: 8,
  lg: 12,
  xl: 16,
} as const;
