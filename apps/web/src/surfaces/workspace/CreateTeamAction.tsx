import { useState } from 'react';
import { Plus } from 'lucide-react';
import { client } from '../../lib/amplify';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import type { TeamOption } from '../coordinator/useTeams';

/** Mounted only inside coordinator/admin assignment controls. Team model auth enforces writes. */
export function CreateTeamAction({ onCreated }: { onCreated: (team: TeamOption) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (busy) return;
    if (!name.trim()) {
      setError('Give the response team a name.');
      document.getElementById('new-team-name')?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await client.models.Team.create({
        name: name.trim(),
        ...(region.trim() ? { regionId: region.trim() } : {}),
        active: true,
      });
      if (result.errors?.[0] || !result.data)
        throw new Error(result.errors?.[0]?.message ?? 'Could not create the team.');
      onCreated({ id: result.data.id, name: result.data.name });
      setName('');
      setRegion('');
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the team.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        onClick={() => {
          if (!busy) setOpen((value) => !value);
        }}
      >
        <Plus aria-hidden="true" />
        {open ? 'Cancel new team' : 'Create response team'}
      </Button>
      {open ? (
        <div className="space-y-3 rounded-xl border border-border bg-bg p-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-team-name">Team name</Label>
            <Input
              id="new-team-name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-team-region">Region (optional)</Label>
            <Input
              id="new-team-region"
              value={region}
              maxLength={100}
              onChange={(event) => setRegion(event.target.value)}
            />
          </div>
          <Button size="sm" aria-disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create team'}
          </Button>
        </div>
      ) : null}
      <p role="alert" className={error ? 'text-xs text-danger' : 'sr-only'}>
        {error}
      </p>
    </div>
  );
}
