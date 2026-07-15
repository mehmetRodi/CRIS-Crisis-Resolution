import { useState } from 'react';
import type { FormEvent } from 'react';
import { Category, Urgency } from '@crisismap/shared';
import { useAuth } from './AuthContext';

const CATEGORY_OPTIONS = Object.values(Category);
const URGENCY_OPTIONS = Object.values(Urgency);

export function ReportForm() {
  const { user } = useAuth();

  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [urgency, setUrgency] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [contact, setContact] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);

  const isFormValid = text.trim().length > 10 && category !== '' && urgency !== '';

  const report = {
    text: text.trim(),
    category,
    subcategory,
    urgency,
    contact: anonymous ? null : contact,
    anonymous,
    photo,
    userId: anonymous ? null : user?.username, 
    userEmail: anonymous ? null : user?.email,
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log('Submitting report:', report);
      setSubmitted(true);
      setText('');
      setCategory('');
      setSubcategory('');
      setUrgency('');
      setContact('');
      setAnonymous(false);
      setPhoto(null);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-8 w-8 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-green-800">Report Submitted</h3>
        <p className="mt-2 text-sm text-green-700">
          Thank you for your report. Emergency coordinators will review it shortly.
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          Submit another report
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Description */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-900">
          Description <span className="text-red-500">*</span>
        </label>
        <textarea
          placeholder="Provide clear details about what's happening and what's needed."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={1000}
          className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors lg:p-4"
        />
        <div className="flex justify-end text-xs text-gray-400">
          <span>{text.length}/1000 characters</span>
        </div>
      </div>

      {/* Category */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-900">
          Category <span className="text-red-500">*</span>
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors lg:p-3"
        >
          <option value="">Select a category</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Subcategory */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-900">Supply Type (Subcategory)</label>
        <input
          type="text"
          value={subcategory}
          onChange={(e) => setSubcategory(e.target.value)}
          placeholder="e.g., Water, Food, Medical"
          className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        />
      </div>

      {/* Photo Upload */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-900">Add Photo (Optional)</label>
        <div
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-6 transition-colors hover:border-blue-400 ${
            photo ? 'border-green-400 bg-green-50' : ''
          }`}
          onClick={() => document.getElementById('photo-upload')?.click()}
        >
          <input
            type="file"
            accept="image/*"
            id="photo-upload"
            className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          {photo ? (
            <div className="text-center">
              <div className="text-2xl">📷</div>
              <p className="mt-1 text-sm font-medium text-green-600">{photo.name}</p>
              <p className="text-xs text-gray-400">Tap to change photo</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-3xl">📷</div>
              <p className="mt-1 text-sm font-medium text-gray-700">Tap to add a photo</p>
              <p className="text-xs text-gray-400">
                Images help responders understand the situation
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Urgency */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-gray-900">
          Urgency <span className="text-red-500">*</span>
        </span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {URGENCY_OPTIONS.map((u) => (
            <button
              type="button"
              key={u}
              onClick={() => setUrgency(u)}
              className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                urgency === u
                  ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Anonymous */}
      <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 cursor-pointer hover:bg-gray-100 transition-colors">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
        />
        <div>
          <p className="text-sm font-medium text-gray-900">Anonymous Report</p>
          <p className="text-xs text-gray-500">Hide my identity from other users and responders</p>
        </div>
      </label>

      {/* Contact Info (only shown when not anonymous) */}
      {!anonymous && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-900">Contact Info (Optional)</label>
          <input
            type="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Phone or email"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors lg:p-3"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={submitting || !isFormValid}
        className="w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Submitting…' : 'Submit Report'}
      </button>

      {/* Footer */}
      <p className="text-center text-xs text-gray-400">All reports are secure and encrypted</p>
    </form>
  );
}
