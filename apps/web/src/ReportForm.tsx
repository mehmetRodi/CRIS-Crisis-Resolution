import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { Category, Urgency } from '@crisismap/shared';


const CATEGORY_OPTIONS = Object.values(Category);
const URGENCY_OPTIONS = Object.values(Urgency);

export function ReportForm() {
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [urgency, setUrgency] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const isFormValid =   text.trim().length > 10 &&   category !== '' &&   urgency !== '';
  const report = {text: text.trim(),category, urgency, photo,};
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
 

  // Get user's location on mount
useEffect(() => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      },
      (error) => {
        setLocationError('Unable to get location. Please enter manually in description.');
      }
    );
  }else {
      setLocationError('Geolocation is not supported by your browser.');
    }
}, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
        //TODO replace this with actual API call to submit the report

      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log('Submitting report:', report);
      setSubmitted(true);
      setText('');
      setCategory('');
      setUrgency('');
      setPhoto(null);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return <div className="rounded-lg border border-green-200 bg-green-50 p-4">
    <h3 className="font-semibold text-green-800">
        Report Submitted
    </h3>

    <p className="mt-1 text-sm text-green-700">
        Thank you for your report. Emergency coordinators will review it shortly.
    </p>
    </div>
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-900">Description</span>
        <textarea
          placeholder="Describe what happened, where it happened, and whether anyone is injured..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="rounded-md border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-right text-xs text-slate-500">
        {text.length}/1000 characters
        </p>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-900">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select a category</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-gray-900">Urgency</span>
        <div className="flex gap-2">
          {URGENCY_OPTIONS.map((u) => (
            <button
              type="button"
              key={u}
              onClick={() => setUrgency(u)}
              className={`rounded-md border px-3 py-1 text-sm ${
                urgency === u
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-900'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-900">Add photo (optional)</span>
        <input
            type="file"
            accept="image/*"
            className="rounded border border-slate-300 p-2"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
      </label>

{photo && <p className="text-xs text-gray-500">Selected: {photo.name}</p>}

<div className="text-xs"> 
{location ? (
  <p className="text-xs text-green-600">📍 Location captured: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}</p>
) : locationError ? (
          <p className="text-amber-600">⚠️ {locationError}</p>
        ) : (
          <p className="text-amber-600">⏳ Detecting your location...</p>
        )}
</div>

      <button
        type="submit"
        disabled={submitting || !isFormValid}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit Report'}
      </button>
    </form>
  );
}