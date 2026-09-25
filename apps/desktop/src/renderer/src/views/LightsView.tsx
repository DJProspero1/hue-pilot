import { Lightbulb, RadioTower } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, SectionTitle } from '../components/ui';
import { useApp } from '../store';
import { LightRow } from './RoomView';

export default function LightsView() {
  const home = useApp((s) => s.home);
  const search = useApp((s) => s.search.trim().toLowerCase());
  const toast = useApp((s) => s.toast);
  const [searching, setSearching] = useState(false);
  const lights = home.lights.filter((l) => !search || l.name.toLowerCase().includes(search) || l.roomName?.toLowerCase().includes(search));
  const byRoom = new Map<string, typeof lights>();
  for (const l of lights) {
    const key = l.roomName ?? '\u0000';
    byRoom.set(key, [...(byRoom.get(key) ?? []), l]);
  }
  const sections = [...byRoom.entries()].sort(([a], [b]) => (a === '\u0000' ? 1 : b === '\u0000' ? -1 : a.localeCompare(b)));

  const searchNew = async () => {
    setSearching(true);
    try {
      await window.hue.searchLights();
      toast('Searching for new lights for 40 seconds. New lights appear automatically.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setTimeout(() => setSearching(false), 40_000);
    }
  };

  return (
    <div className="fade-in">
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lights</h1>
          <p className="text-sm text-muted mt-0.5">{home.totalLightsOn} of {home.lights.length} on</p>
        </div>
        <Button variant="outline" icon={<RadioTower size={15} />} loading={searching} onClick={searchNew}>
          Search for new lights
        </Button>
      </div>
      {!sections.length && <EmptyState icon={<Lightbulb size={40} />} title={search ? 'No lights match' : 'No lights found'} />}
      {sections.map(([room, list]) => (
        <div key={room} className="mb-5">
          <SectionTitle>{room === '\u0000' ? 'Not in a room' : room}</SectionTitle>
          <div className="space-y-2">
            {list.map((l) => (
              <LightRow key={l.id} light={l} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
